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
 * Relevo con la app: al cargar el plugin (takeOverFromClosed) se llama a stopForApp(): esto deja de atender y la app se engancha al
 * MISMO servidor con los mismos enlaces (3263, GattServerHost: antes se cerraba y se abría otro). Lo guardado en el buzón lo recoge
 * la app al abrir, como siempre. Solo recibe: no escanea ni abre conexiones (eso sigue siendo de la app).
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
    // 3263 (fase 2): el servidor GATT y lo que se hereda de cada enlace entrante viven en GattServerHost (uno por proceso): al abrirse
    // la app no se cierra nada, la app se engancha al mismo servidor con los mismos enlaces
    private val server: BluetoothGattServer? get() = GattServerHost.server
    private val tx: BluetoothGattCharacteristic? get() = GattServerHost.tx
    private val devices get() = GattServerHost.connected
    private val notifOn get() = GattServerHost.notifOn
    private val mtu get() = GattServerHost.mtu
    private var attending = false
    private val queues = HashMap<String, ArrayDeque<ByteArray>>()
    private val busy = HashSet<String>()
    // 3262: enlaces entrantes que «tenemos» (solo así se cortan de verdad) y los que quedaron a medias (ver PluginBtState.holdServerLink)
    private val held get() = GattServerHost.held
    private val halfOpen = HalfOpenPolicy()
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
        // con la app viva en el proceso el servidor lo atiende ella: nunca dos a la vez
        if (NexoBlePlugin.live != null || NexoBlePlugin.orphan != null) return false
        if (!GattServerHost.open(ctx)) return false
        GattServerHost.attach(callback, "servicio")
        attending = true
        return true
    }

    /** La app toma el relevo (hilo principal): se deja de atender; el servidor y sus enlaces siguen (3263). Tras esto no vuelve a abrir. */
    fun stop(why: String) {
        if (stopped) return
        stopped = true
        if (current === this) current = null
        btReceiver?.let { try { ctx.unregisterReceiver(it) } catch (e: Throwable) { } }
        btReceiver = null
        val had = attending
        attending = false
        GattServerHost.detach(callback)
        devices.keys.toList().forEach { core.linkClosed(it) }
        queues.clear(); busy.clear()
        if (had) nlog(ctx, "INFO", "Bluetooth sin la app: fin ($why); recibidos ${core.received} mensaje(s); ${devices.size} enlace(s) entrante(s) siguen abiertos")
    }

    // Cierra de verdad (solo con el Bluetooth apagado o al rehacerlo): con la app abriéndose ya NO se cierra (stop)
    private fun closeServer() {
        if (GattServerHost.server == null) return
        val links = devices.keys.toList()
        attending = false
        GattServerHost.close()
        links.forEach { core.linkClosed(it) }
        queues.clear(); busy.clear()
    }

    // Bluetooth apagado: el servidor muere (se suelta); encendido otra vez: se rehace y el servicio vuelve a anunciar
    private fun watchBluetooth() {
        if (btReceiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED || stopped) return
                when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
                    BluetoothAdapter.STATE_OFF -> closeServer()
                    BluetoothAdapter.STATE_ON -> { closeServer(); if (openServer()) nlog(ctx, "INFO", "Bluetooth sin la app: Bluetooth encendido otra vez, recibiendo"); try { onBluetoothOn() } catch (e: Throwable) { } }
                }
            }
        }
        try {
            val f = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ctx.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED) else ctx.registerReceiver(r, f)
            btReceiver = r
        } catch (e: Throwable) { }
    }

    // 3262: Android solo corta un enlace ENTRANTE si esta app lo «tiene» (connect sobre el enlace ya abierto lo marca en uso); sin eso
    // cancelConnection y cerrar el servidor no cortan nada. Se toma solo a quien usa nuestro servicio (hilo principal).
    private fun hold(link: String, device: BluetoothDevice) {
        if (link in held) return
        val srv = server ?: return
        held.add(link)
        try { srv.connect(device, false) } catch (e: Throwable) { held.remove(link) }
    }
    private fun cut(link: String, device: BluetoothDevice) {
        val fresh = link !in held
        hold(link, device)
        val run = Runnable { try { server?.cancelConnection(device) } catch (e: Throwable) { } }
        if (fresh) handler.postDelayed(run, 200) else run.run()
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
                    held.remove(link); halfOpen.forget(link)
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
                hold(link, device)
                // 3262 (HalfOpenPolicy): escribe sin estar suscrito (enlace que sobrevivió a nuestro reinicio): no se le puede contestar
                // ni el pong ni el ✓✓ → se corta para que reconecte limpio (lo que mandó ya se guardó; lo reenvía si no vio el ✓✓)
                if (halfOpen.onWrite(link, notifOn[link] == true, false, System.currentTimeMillis())) {
                    nlog(ctx, "WARN", "enlace a medias con $link (escribe sin estar suscrito): se corta para que reconecte limpio")
                    cut(link, device)
                }
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
            handler.post { if (!stopped) { devices[link] = device; notifOn[link] = on; if (on) { halfOpen.forget(link); hold(link, device) } } }
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
