package com.nexo.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import java.io.File
import org.json.JSONObject

/**
 * 3254 (PRIORIDAD 1 del dueño, fase 1; #87): el Bluetooth del SERVICIO cuando no hay app en el proceso (NEXO volvió sola tras un
 * reinicio del teléfono, una actualización, un cierre del sistema o un toque FCM). Abre su propio servidor GATT (el mismo servicio y
 * características que el de la app) y lo que llega lo trata SinAppCore: buzón, ✓✓, aviso, pong y «quién soy». El anuncio lo pone
 * BleService con lo guardado (Saved: NEXO ID tal como lo anuncia la app y la clave del código rotativo, cifrados en reposo; el dueño
 * dijo sí a guardarla cifrada el 18-11; nunca se escribe en claro).
 *
 * Relevo con la app: al cargar el plugin (takeOverFromClosed) se llama a stopForApp(): corta los enlaces entrantes ANTES de cerrar el
 * servidor (lección de 3251: si no, el otro se queda escribiendo a un servidor que ya no existe) y la app abre el suyo. Lo guardado
 * en el buzón lo recoge la app al abrir, como siempre. Solo recibe: no escanea ni abre conexiones (eso sigue siendo de la app).
 */
class BleSinApp(private val ctx: Context, private val me: String, private val onBluetoothOn: () -> Unit) {

    /** Lo que BleService necesita para anunciar sin la app. */
    class Saved(val id: String, val ridKey: String, val epochS: Long)

    companion object {
        private const val TAG = "NEXO_BT_SINAPP"
        const val FILE = "nexo_ble_sinapp.json"
        private const val NOTIFY_TIMEOUT_MS = 200L
        private const val MAX_QUEUE = 400
        @Volatile var current: BleSinApp? = null

        private fun store(ctx: Context): AtRestStore = AtRestStore(ctx.filesDir) {
            try { AtRestKey.get(ctx, create = false) } catch (e: Throwable) { null }
        }.also { it.skip = setOf(NexoBlePlugin.NXID_MAC_MAP_FILE, NexoBlePlugin.NATIVE_LOG_FILE) }

        fun json(id: String, ridKey: String, epochS: Long): String = JSONObject().put("v", 1).put("id", id).put("rk", ridKey).put("ep", epochS).toString()
        fun parse(text: String?): Saved? = try {
            if (text == null || SafeJson.reject(text)) null else JSONObject(text).let { o ->
                val id = o.optString("id").trim(); val rk = o.optString("rk")
                if (id.length != 10 || !(rk.isEmpty() || (rk.length == 64 && rk.all { it in '0'..'9' || it in 'a'..'f' }))) null
                else Saved(id, rk, o.optLong("ep", 900L).coerceAtLeast(1L))
            }
        } catch (e: Exception) { null }

        @Volatile private var lastSaved: String? = null
        /** La app le da al servicio lo que anuncia: se guarda cifrado (fuera del hilo principal). Sin clave de cifrado, no se guarda. */
        fun save(ctx: Context, id: String, ridKey: String?, epochS: Long) {
            val text = json(id, ridKey ?: "", epochS)
            if (text == lastSaved) return
            lastSaved = text
            val app = ctx.applicationContext ?: ctx
            Thread({
                try {
                    if (AtRestKey.get(app, create = false) == null) { lastSaved = null; return@Thread }
                    store(app).write(FILE, text)
                } catch (e: Throwable) { lastSaved = null; Log.w(TAG, "no se pudo guardar: ${e.javaClass.simpleName}") }
            }, "nexo-bt-sinapp-save").start()
        }

        /** Lo guardado, si es de la cuenta de este teléfono. Lee archivos y el Keystore: fuera del hilo principal. */
        fun load(ctx: Context): Saved? = try {
            val st = store(ctx)
            val s = parse(st.read(FILE))
            val account = NetBgSaved.accountIdOf(st.read(RestartPolicy.NEXO_ID_FILE))
            if (s != null && NetBgSaved.sameAccount(s.id, account)) s else null
        } catch (e: Throwable) { null }

        /** La app toma el relevo (en el hilo principal, antes de abrir su servidor GATT). */
        fun stopForApp() { val c = current ?: return; c.stop("la app se abre: el Bluetooth pasa a ella") }

        internal fun nlog(ctx: Context, level: String, msg: String) {
            Log.i(TAG, msg)
            try {
                val l = NexoBlePlugin.nativeLogShared ?: synchronized(NexoBlePlugin::class.java) {
                    NexoBlePlugin.nativeLogShared ?: NativeLog(File(ctx.filesDir, NexoBlePlugin.NATIVE_LOG_FILE)).also { NexoBlePlugin.nativeLogShared = it }
                }
                l.add(level, "BT_SINAPP", msg)
            } catch (e: Throwable) { }
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var server: BluetoothGattServer? = null
    private var tx: BluetoothGattCharacteristic? = null
    private val devices = HashMap<String, BluetoothDevice>()
    private val notifOn = HashMap<String, Boolean>()
    private val mtu = HashMap<String, Int>()
    private val queues = HashMap<String, ArrayDeque<ByteArray>>()
    private val busy = HashSet<String>()
    private var btReceiver: BroadcastReceiver? = null
    var stopped = false
        private set
    private val inbox = BgInbox(File(ctx.filesDir, "nexo_bg_inbox.jsonl"))

    private fun norm(addr: String) = addr.replace(":", "").lowercase()

    private val core = SinAppCore(me, object : SinAppCore.Sink {
        override fun send(link: String, json: String) = enqueue(link, json)
        override fun store(link: String, json: String): Boolean {
            // el teléfono despierto unos segundos para guardar, confirmar y avisar (como rxWake de la app en segundo plano)
            try {
                (ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nexo:bt-sinapp")
                    ?.apply { setReferenceCounted(false) }?.acquire(8000L)
            } catch (e: Throwable) { }
            val dev = devices[link]?.address ?: link
            return try { inbox.add(dev, json) } catch (e: Throwable) { false }
        }
        override fun notify(info: BgInbox.Info, only: Boolean) {
            try {
                val name = if (info.from.isEmpty()) "NEXO" else (NetBgHome.peek()?.nameOf(info.from) ?: "NEXO")
                if (info.call || info.what == "call") { MsgNotifier.get(ctx).incomingCall(info.from, name, info.video, info.msgId); return }
                if (info.from.isEmpty()) { MsgNotifier.get(ctx).message("nexo_jump", "NEXO", info.msgId, "", true); return }
                NetBgHome.notifyMessage(ctx, info.from, name, info.msgId, false, info.group, info.video, false, how = "por Bluetooth sin la app") { NetBgHome.groupNameOf(ctx, it) }
            } catch (e: Throwable) { nlog(ctx, "WARN", "aviso sin poner (${e.javaClass.simpleName})") }
        }
        override fun callEnded(from: String, offer: String) { try { MsgNotifier.get(ctx).cancelCallFor(from, offer) } catch (e: Throwable) { } }
        override fun kxCard(): String? = try { ctx.getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE).getString("kx_card", null) } catch (e: Throwable) { null }
        override fun ackSign(from: String, fields: String): String? = try { NexoBlePlugin.ackKeys[from]?.let { NexoBlePlugin.ackTag(it, fields) } } catch (e: Throwable) { null }
        override fun log(level: String, msg: String) = nlog(ctx, level, msg)
    })

    /** Abre el servidor GATT (hilo principal). Devuelve si quedó abierto. */
    fun start(why: String): Boolean {
        if (stopped) return false
        current = this
        watchBluetooth()
        val ok = openServer()
        nlog(ctx, if (ok) "INFO" else "WARN", if (ok) "Bluetooth sin la app: anunciando y recibiendo (tras $why)" else "Bluetooth sin la app: no se pudo abrir el servidor (tras $why): no se recibe hasta abrir NEXO")
        return ok
    }

    private fun openServer(): Boolean {
        if (server != null) return true
        // con la app viva en el proceso el servidor es suyo: nunca dos a la vez
        if (NexoBlePlugin.live != null || NexoBlePlugin.orphan != null) return false
        return try {
            val bm = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager ?: return false
            val adapter = bm.adapter
            if (adapter == null || !adapter.isEnabled) return false
            val srv = bm.openGattServer(ctx, callback) ?: return false
            val service = BluetoothGattService(NexoBleSpec.NEXO_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
            val txc = BluetoothGattCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ)
            txc.addDescriptor(BluetoothGattDescriptor(NexoBleSpec.CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
            val rxc = BluetoothGattCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE, BluetoothGattCharacteristic.PERMISSION_WRITE)
            service.addCharacteristic(txc)
            service.addCharacteristic(rxc)
            val added = srv.addService(service)
            if (!added) { try { srv.close() } catch (e: Throwable) { }; return false }
            server = srv; tx = txc
            true
        } catch (e: Throwable) { Log.w(TAG, "openServer: ${e.javaClass.simpleName} ${e.message}"); false }
    }

    /** Corta los enlaces entrantes y cierra el servidor (hilo principal). Tras esto no vuelve a abrir. */
    fun stop(why: String) {
        if (stopped) return
        stopped = true
        if (current === this) current = null
        btReceiver?.let { try { ctx.unregisterReceiver(it) } catch (e: Throwable) { } }
        btReceiver = null
        val had = server != null
        closeServer(true)
        if (had) nlog(ctx, "INFO", "Bluetooth sin la app: fin ($why); recibidos ${core.received} mensaje(s)")
    }

    private fun closeServer(cancelLinks: Boolean) {
        val srv = server ?: return
        server = null; tx = null
        if (cancelLinks) {
            val all = LinkedHashMap<String, BluetoothDevice>(devices)
            try {
                (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.getConnectedDevices(BluetoothProfile.GATT_SERVER)
                    ?.forEach { d -> all.putIfAbsent(norm(d.address), d) }
            } catch (e: Throwable) { }
            all.values.forEach { d -> try { srv.cancelConnection(d) } catch (e: Throwable) { } }
        }
        try { srv.close() } catch (e: Throwable) { }
        devices.keys.toList().forEach { core.linkClosed(it) }
        devices.clear(); notifOn.clear(); mtu.clear(); queues.clear(); busy.clear()
    }

    // Bluetooth apagado: el servidor muere (se suelta); encendido otra vez: se rehace y el servicio vuelve a anunciar
    private fun watchBluetooth() {
        if (btReceiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED || stopped) return
                when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
                    BluetoothAdapter.STATE_OFF -> closeServer(false)
                    BluetoothAdapter.STATE_ON -> { closeServer(false); if (openServer()) nlog(ctx, "INFO", "Bluetooth sin la app: Bluetooth encendido otra vez, recibiendo"); try { onBluetoothOn() } catch (e: Throwable) { } }
                }
            }
        }
        try {
            val f = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ctx.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED) else ctx.registerReceiver(r, f)
            btReceiver = r
        } catch (e: Throwable) { }
    }

    // ---- envío (pong, tarjeta, confirmaciones): una notificación detrás de otra por enlace ----
    private fun enqueue(link: String, json: String) {
        val size = ((mtu[link] ?: 23) - 3).coerceIn(20, 512)
        val q = queues.getOrPut(link) { ArrayDeque() }
        val parts = Utf8Split.split(json, size)
        if (q.size + parts.size > MAX_QUEUE) return // enlace atascado: no se acumula (el otro reintenta)
        parts.forEach { q.addLast(it.toByteArray(Charsets.UTF_8)) }
        pump(link)
    }

    private fun pump(link: String) {
        if (link in busy) return
        val q = queues[link] ?: return
        val dev = devices[link]; val srv = server; val txc = tx
        if (dev == null || srv == null || txc == null || notifOn[link] != true) { q.clear(); return }
        val data = q.removeFirstOrNull() ?: return
        val sent = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) srv.notifyCharacteristicChanged(dev, txc, false, data) == BluetoothGatt.GATT_SUCCESS
            else {
                @Suppress("DEPRECATION")
                txc.value = data
                @Suppress("DEPRECATION")
                srv.notifyCharacteristicChanged(dev, txc, false)
            }
        } catch (e: Throwable) { false }
        if (!sent) { q.clear(); return } // el otro reintenta; no se martilla un enlace que no acepta
        busy.add(link)
        handler.postDelayed({ if (busy.remove(link)) pump(link) }, NOTIFY_TIMEOUT_MS)
    }

    private val callback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val link = norm(device.address)
            handler.post {
                if (stopped) return@post
                if (newState == BluetoothProfile.STATE_CONNECTED) devices[link] = device
                else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    devices.remove(link); notifOn.remove(link); mtu.remove(link); queues.remove(link); busy.remove(link)
                    core.linkClosed(link)
                    try { onBluetoothOn() } catch (e: Throwable) { } // que el anuncio siga tras una desconexión
                }
            }
        }

        override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
                                                  preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            if (characteristic.uuid != NexoBleSpec.RX_CHARACTERISTIC_UUID) return
            if (responseNeeded) try { server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value) } catch (e: Throwable) { }
            val link = norm(device.address); val bytes = value ?: return
            handler.post {
                if (stopped) return@post
                if (!devices.containsKey(link)) devices[link] = device
                try { core.onBytes(link, bytes) } catch (e: Throwable) { nlog(ctx, "WARN", "trozo sin procesar (${e.javaClass.simpleName})") }
            }
        }

        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
                                              preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            if (descriptor.uuid != NexoBleSpec.CCCD_UUID) return
            val on = value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true ||
                value?.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE) == true
            if (responseNeeded) try { server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value) } catch (e: Throwable) { }
            val link = norm(device.address)
            handler.post { if (!stopped) { devices[link] = device; notifOn[link] = on } }
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            val link = norm(device.address)
            handler.post { if (busy.remove(link)) pump(link) }
        }

        override fun onMtuChanged(device: BluetoothDevice, m: Int) {
            val link = norm(device.address)
            handler.post { mtu[link] = if (m > 23) m else 23 }
        }
    }
}
