package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.NotificationCompat
import java.nio.charset.Charset

class BleService : Service() {

    companion object {
        private const val TAG = "BleService"
        // 3165 (dueño 16-11: «al querer ver una notificación de mensaje, esa [la de NEXO BLE] siempre está por delante»): canal
        // nuevo de importancia MÍNIMA (va a «Silenciosas», plegado, debajo de los mensajes); el viejo (BAJA) se borra
        internal const val CHANNEL_ID = "nexo_ble_quiet" // 3225: Ajustes abre directo esta categoría («Ocultar aviso fijo»)
        private const val OLD_CHANNEL_ID = "nexo_ble_foreground"
        private const val NOTIFICATION_ID = 1001
        private const val MANUFACTURER_ID = 0xFFFF
        private const val NEXO_MAGIC_HIGH: Byte = 0x4E
        private const val NEXO_MAGIC_LOW: Byte = 0x58
        // Ronda 2770: el servicio en marcha (para cambiar sus tipos al empezar y acabar una llamada) y si hay llamada
        @Volatile var live: BleService? = null
        @Volatile var inCall = false
        // #dueño 01-11: hay una VIDEOLLAMADA activa → al irse de la app (gesto de inicio) MainActivity entra en
        // Picture-in-Picture (miniatura flotante) sin cortar audio/vídeo. @JvmStatic para leerlo desde MainActivity (Java).
        @JvmStatic @Volatile var pipVideo = false
        /**
         * 3282 (dueño 22-11: en un chat, sin videollamada, el gesto de irse metía la app en la miniatura): al irse el usuario se pasa a
         * la miniatura SOLO con la marca puesta Y una llamada con el audio en marcha. La marca sola no basta: es de la página y podía
         * quedarse puesta de una llamada anterior.
         */
        @JvmStatic fun pipOnLeave(): Boolean = pipVideo && inCall
        /** 3275: cuándo el usuario se fue de la app (onUserLeaveHint): la miniatura automática entra justo después; en onPause aún puede no verse */
        @JvmStatic @Volatile var leaveHintAt = 0L
        // Cómo quedó el servicio la última vez (también si se reinició solo en plena llamada: al volver a la app se mira)
        @Volatile var fgsState = ""
    }

    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    private var isAdvertising = false
    private var currentNexoId: String? = null
    private var advertiseCallback: AdvertiseCallback? = null
    // Largo alcance (LE Coded PHY, ~4x distancia): anuncio extendido aparte del normal, si el teléfono lo tiene
    private var codedCallback: AdvertisingSetCallback? = null
    // ID rotativo (ronda 2755, RidToken.kt): con clave se anuncia el código de la época (cambia solo cada 15 min,
    // también con la app cerrada) y el NEXO ID solo hasta visibleUntil (pantalla "Agregar" abierta)
    private var ridKey: String? = null
    private var visibleUntil = 0L
    private var ridEpochS = 900L
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private val rotate = Runnable {
        if (!currentNexoId.isNullOrEmpty()) { stopAdvertisingInternal(); startAdvertisingInternal(currentNexoId!!) }
    }
    // 3189 (#87): la alarma de vigilancia ya está programada por este servicio (NexoRestartReceiver.arm) y por qué falló el último
    // startForeground (null = quedó en primer plano), para anotar en el registro si NEXO pudo volver sola
    private var watchdogArmed = false
    private var fgFail: String? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
        CrashLog.install(this) // 3120
        live = this
        createNotificationChannel()
    }

    // Ronda 2770: Android 11+ solo deja usar el micrófono a una app en segundo plano si su servicio en primer plano es
    // de tipo micrófono (si no, graba silencio): con la pantalla bloqueada o en otra app durante una llamada, el otro
    // dejaba de oír. En llamada: "dispositivo conectado" + micrófono; fuera de ella, solo "dispositivo conectado" (el de
    // micrófono no se puede pedir en segundo plano: si el servicio se reinicia solo, fallaría). En Android 8–10 basta
    // con tener el servicio. Devuelve cómo quedó (para el diagnóstico de la llamada).
    // 3189 (#87): mic = false al volver sola (RestartPolicy.micAllowed): solo «dispositivo conectado». Desde Android 15 un servicio
    // arrancado por BOOT_COMPLETED no puede ser de micrófono, y desde segundo plano tampoco se puede pedir.
    fun foreground(mic: Boolean = true): String { val r = foregroundTyped(mic); fgsState = r; return r }
    private fun foregroundTyped(mic: Boolean): String {
        val n = buildNotification()
        if (Build.VERSION.SDK_INT < 29) { startFg(n, 0); return if (inCall) "micrófono (Android 8–9)" else "normal" }
        val base = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        if (inCall && Build.VERSION.SDK_INT >= 30) {
            if (!mic) { startFg(n, base); return "sin micrófono (al volver sola)" }
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                startFg(n, base); return "sin micrófono (sin permiso)"
            }
            if (startFg(n, base or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)) return "micrófono"
            // Con la app en segundo plano Android no deja el tipo micrófono (se reintenta al volver a la app)
            startFg(n, base); return "sin micrófono (en segundo plano)"
        }
        startFg(n, base)
        return if (inCall) "micrófono (Android 10)" else "normal"
    }

    // G1 (auditoría 28-10): al despertar por FCM con la app cerrada, onStartCommand → foreground() corre en el hilo
    // principal del servicio; en Android 12+ startForeground puede lanzar ForegroundServiceStartNotAllowedException y en
    // 14+ SecurityException si en ese instante no se cumple la precondición del tipo (p. ej. BLUETOOTH_CONNECT revocado o
    // agotada la ventana de exención del despertar). Sin capturar = crash del proceso (la rama de micrófono ya lo sabía).
    // Este ayudante NUNCA deja escapar la excepción: reintenta sin tipo (precondiciones más laxas) y, si tampoco, se
    // detiene en vez de tumbar el proceso. Devuelve si el servicio quedó en primer plano.
    private fun startFg(n: android.app.Notification, type: Int): Boolean {
        try {
            if (type != 0 && Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, type) else startForeground(NOTIFICATION_ID, n)
            fgFail = null
            return true
        } catch (e: Throwable) {
            Log.w(TAG, "startForeground(tipo=$type) falló: ${e.javaClass.simpleName} ${e.message}")
            var last = e
            if (type != 0) { try { startForeground(NOTIFICATION_ID, n); fgFail = null; return true } catch (e2: Throwable) { Log.e(TAG, "startForeground sin tipo también falló: ${e2.message}"); last = e2 } }
            fgFail = "${last.javaClass.simpleName}: ${last.message}"
            try { stopSelf() } catch (e3: Throwable) {}
            return false
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand flags=$flags startId=$startId")

        val nexoId = intent?.getStringExtra("nexo_advertising_id")
        val action = intent?.getStringExtra("action")

        if (!nexoId.isNullOrEmpty()) {
            currentNexoId = nexoId
            Log.i(TAG, "NEXO ID actualizado: $nexoId")
        }
        if (intent?.hasExtra("rid_key") == true) {
            ridKey = intent.getStringExtra("rid_key")
            visibleUntil = intent.getLongExtra("visible_until", 0L)
            ridEpochS = intent.getLongExtra("rid_epoch_s", 900L).coerceAtLeast(1L)
        }
        // 3254 (#87, Bluetooth en el servicio, fase 1): lo que la app anuncia queda guardado y cifrado para poder anunciar y recibir
        // por Bluetooth sin ella (BleSinApp) cuando NEXO vuelve sola
        if (intent?.hasExtra("rid_key") == true && !currentNexoId.isNullOrEmpty()) BleSinApp.save(this, currentNexoId!!, ridKey, ridEpochS)

        // 3189 (#87): arrancado por NexoRestartReceiver (actualización, reinicio o alarma de vigilancia) = sin la app: solo
        // «dispositivo conectado», y el resultado al registro nativo («NEXO vuelve sola tras…» / «No se pudo volver sola tras…»)
        val restart = RestartPolicy.reasonByName(intent?.getStringExtra(RestartPolicy.EXTRA_REASON))
        foreground(RestartPolicy.micAllowed(restart))
        if (restart != null) NexoRestartReceiver.noteOutcome(this, restart, fgFail)
        // La alarma de vigilancia (cada ~15 min) la programa el servicio al arrancar, en cuanto NEXO tiene cuenta (NEXO ID guardado);
        // otra vez cuando la app le da el NEXO ID (cuenta nueva o recuperada con el servicio ya en marcha)
        if (!watchdogArmed || !nexoId.isNullOrEmpty()) watchdogArmed = NexoRestartReceiver.arm(this)
        // 3192 (#87, dueño 17-11 «Ok» a guardar cifrada la configuración): sin la app viva en este proceso (proceso nuevo: vuelta sola,
        // toque FCM o Android reinició el servicio) el servicio no escuchaba internet: ahora la escucha arranca desde lo guardado y
        // cifrado (NetBgHome; lee archivos y el Keystore: en otro hilo). Con la app viva no hace nada (la maneja ella). Si el servicio no
        // quedó en primer plano, se para: sin él el proceso se congela y no tiene sentido tener la Wi-Fi despierta.
        if (fgFail != null) NetBgHome.stopWithoutApp(this, "el servicio no pudo ponerse en primer plano")
        else if (NetBgHome.mayStart()) {
            val why = NetBgSaved.why(restart?.why, intent?.getBooleanExtra(NetBgHome.EXTRA_FCM, false) == true, intent == null)
            val app = applicationContext
            // (si el servicio ya se paró cuando le toca al hilo, nada: sin servicio no se deja escuchando)
            Thread({ try { if (live != null) NetBgHome.startWithoutApp(app, why) } catch (e: Throwable) { } }, "nexo-netbg-sinapp").start()
        }

        // 3254: sin la app en el proceso (vuelta sola, toque FCM, reinicio del servicio): anunciar y recibir desde lo guardado
        if (sinApp?.stopped == true) sinApp = null // la app tomó el relevo y luego murió con el servicio vivo: se puede volver a abrir
        if (fgFail == null && sinApp == null && !sinAppLoading && NexoBlePlugin.live == null && NexoBlePlugin.orphan == null) startSinApp(restart?.why ?: if (intent == null) "un reinicio del servicio" else "un despertar sin la app")
        if (currentNexoId.isNullOrEmpty()) {
            Log.w(TAG, "Sin nexoId, advertising postergado hasta recibir setAdvertisingData")
            return START_STICKY
        }

        if (action == "UPDATE_ADVERTISING_DATA" || !isAdvertising) {
            stopAdvertisingInternal()
            startAdvertisingInternal(currentNexoId!!)
        }

        return START_STICKY
    }

    // 3254: Bluetooth sin la app. Lo guardado se lee en otro hilo (archivos y Keystore); el servidor y el anuncio, en el principal.
    private var sinApp: BleSinApp? = null
    @Volatile private var sinAppLoading = false
    private fun startSinApp(why: String) {
        sinAppLoading = true
        val app = applicationContext
        Thread({
            val saved = try { BleSinApp.load(app) } catch (e: Throwable) { null }
            handler.post {
                sinAppLoading = false
                if (live !== this || sinApp != null || NexoBlePlugin.live != null || NexoBlePlugin.orphan != null) return@post
                if (saved == null) { BleSinApp.nlog(app, "WARN", "Bluetooth sin la app: no hay nada guardado (tras $why): no se anuncia ni se recibe hasta abrir NEXO"); return@post }
                if (currentNexoId.isNullOrEmpty()) { currentNexoId = saved.id; ridKey = saved.ridKey.ifEmpty { null }; ridEpochS = saved.epochS; visibleUntil = 0L }
                val id = currentNexoId ?: return@post
                val s = BleSinApp(app, id) { handler.post { if (live === this && !isAdvertising && !currentNexoId.isNullOrEmpty()) startAdvertisingInternal(currentNexoId!!) } }
                sinApp = s
                s.start(why)
                if (!isAdvertising) startAdvertisingInternal(id)
            }
        }, "nexo-bt-sinapp").start()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        if (live === this) live = null
        handler.removeCallbacks(rotate)
        try { sinApp?.stop("el servicio se detuvo") } catch (e: Throwable) { }
        sinApp = null
        stopAdvertisingInternal()
        NetBgHome.stopWithoutApp(this, "el servicio se detuvo") // 3192: sin la app ni el servicio, no se deja la Wi-Fi despierta
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                NativeLang.t(this, "svc_channel"),
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = NativeLang.t(this@BleService, "svc_channel_desc")
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_SECRET
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
            // 3165: el canal viejo (importancia BAJA) ya no se usa; si Android no deja borrarlo ahora, se intenta en el próximo arranque
            try { manager?.deleteNotificationChannel(OLD_CHANNEL_ID) } catch (e: Exception) { Log.w(TAG, "Canal viejo del servicio: ${e.message}") }
        }
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(NativeLang.t(this, "svc_title"))
            .setContentText(NativeLang.t(this, "svc_text"))
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            // 3165: callado, sin hora, como «servicio», en su propio grupo (no se apila con los avisos de mensajes, grupo nexo_msgs)
            // y ordenado al final; oculto en la pantalla de bloqueo
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setGroup("nexo_service")
            .setSortKey("zzz")
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .build()
    }

    private fun startAdvertisingInternal(nexoId: String) {
        if (isAdvertising) {
            Log.w(TAG, "Advertising ya activo, reiniciando con nuevo nexoId")
            stopAdvertisingInternal()
        }

        val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = bluetoothManager?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.e(TAG, "Bluetooth no disponible")
            return
        }

        bluetoothLeAdvertiser = adapter.bluetoothLeAdvertiser
        if (bluetoothLeAdvertiser == null) {
            Log.e(TAG, "BluetoothLeAdvertiser no disponible")
            return
        }

        // Lo que se anuncia: el NEXO ID (visible / sin clave) o el código rotativo; y cuándo cambiarlo
        val now = System.currentTimeMillis()
        val visible = ridKey.isNullOrEmpty() || now < visibleUntil
        val advertised = RidToken.advertised(nexoId, ridKey, visibleUntil, now, ridEpochS)
        handler.removeCallbacks(rotate)
        val next = RidToken.nextChangeMs(ridKey, visibleUntil, now, ridEpochS)
        if (next > 0) handler.postDelayed(rotate, next + 50)
        val nexoIdBytes = advertised.toByteArray(Charset.forName("UTF-8"))
        val manufacturerData = ByteArray(2 + nexoIdBytes.size)
        manufacturerData[0] = NEXO_MAGIC_HIGH
        manufacturerData[1] = NEXO_MAGIC_LOW
        System.arraycopy(nexoIdBytes, 0, manufacturerData, 2, nexoIdBytes.size)

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()

        // Advertisement principal: manufacturer data + nombre corto (truncado por Android si no cabe)
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addManufacturerData(MANUFACTURER_ID, manufacturerData)
            .build()

        // Scan Response: nombre completo del dispositivo (31 bytes extra). Solo visible: el nombre del teléfono
        // ("Teléfono de …") también sirve para seguir a alguien
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(visible)
            .build()

        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                Log.i(TAG, if (visible) "Advertising iniciado con NEXO ID: $nexoId" else "Advertising iniciado con código rotativo")
            }
            override fun onStartFailure(errorCode: Int) {
                isAdvertising = false
                Log.e(TAG, "Advertising fallo: errorCode=$errorCode")
            }
        }

        try {
            bluetoothLeAdvertiser?.startAdvertising(settings, data, scanResponse, advertiseCallback!!)
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException startAdvertising: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Error startAdvertising: ${e.message}")
        }
        startCodedAdvertising(adapter, manufacturerData)
    }

    // Mismo anuncio (NEXO ID) en LE Coded PHY: los teléfonos con largo alcance se encuentran y conectan desde ~4x
    // más lejos (Jump con más alcance). Los que no lo tienen siguen con el anuncio normal; si falla, no pasa nada.
    private fun startCodedAdvertising(adapter: BluetoothAdapter, manufacturerData: ByteArray) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        try {
            if (!adapter.isLeCodedPhySupported || !adapter.isLeExtendedAdvertisingSupported) {
                Log.i(TAG, "Largo alcance (LE Coded) no disponible en este teléfono")
                return
            }
            val params = AdvertisingSetParameters.Builder()
                .setLegacyMode(false)
                .setConnectable(true)
                .setScannable(false)
                .setPrimaryPhy(BluetoothDevice.PHY_LE_CODED)
                .setSecondaryPhy(BluetoothDevice.PHY_LE_CODED)
                .setInterval(AdvertisingSetParameters.INTERVAL_MEDIUM)
                .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
                .build()
            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .addManufacturerData(MANUFACTURER_ID, manufacturerData)
                .build()
            val cb = object : AdvertisingSetCallback() {
                override fun onAdvertisingSetStarted(advertisingSet: AdvertisingSet?, txPower: Int, status: Int) {
                    if (status == AdvertisingSetCallback.ADVERTISE_SUCCESS) Log.i(TAG, "Largo alcance (LE Coded) anunciando, tx=$txPower")
                    else Log.w(TAG, "Largo alcance (LE Coded) no arrancó: status=$status")
                }
            }
            codedCallback = cb
            bluetoothLeAdvertiser?.startAdvertisingSet(params, data, null, null, null, cb)
        } catch (e: SecurityException) {
            Log.w(TAG, "Largo alcance: sin permiso (${e.message})")
        } catch (e: Exception) {
            Log.w(TAG, "Largo alcance: ${e.message}")
        }
    }

    private fun stopAdvertisingInternal() {
        codedCallback?.let { cb ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) try { bluetoothLeAdvertiser?.stopAdvertisingSet(cb) } catch (e: Exception) { }
        }
        codedCallback = null
        if (!isAdvertising) return
        advertiseCallback?.let { callback ->
            try {
                bluetoothLeAdvertiser?.stopAdvertising(callback)
            } catch (e: Exception) {
                Log.w(TAG, "Error stopAdvertising: ${e.message}")
            }
        }
        isAdvertising = false
        advertiseCallback = null
    }
}
