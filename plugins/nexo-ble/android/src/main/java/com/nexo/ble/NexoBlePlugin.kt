package com.nexo.ble

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import androidx.activity.result.ActivityResult
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(strings = [android.Manifest.permission.BLUETOOTH_SCAN], alias = "bluetoothScan"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetoothConnect"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_ADVERTISE], alias = "bluetoothAdvertise"),
        Permission(strings = [android.Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [android.Manifest.permission.POST_NOTIFICATIONS], alias = "postNotifications"),
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE], alias = "foregroundService"),
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE], alias = "foregroundServiceConnectedDevice"),
        Permission(strings = ["android.permission.NEARBY_WIFI_DEVICES"], alias = "nearbyWifi")
    ]
)
class NexoBlePlugin : Plugin() {
    // 3118 (reestructuración 15-11): los cuerpos de casi todos los métodos están en archivos por tema del mismo paquete
    // (extensiones de esta clase, movidos tal cual):
    //   PluginLog.kt — Registros y diagnóstico: errores de Bluetooth, registro nativo (NativeLog), energía y estado de batería
    //   PluginRx.kt — Recibir por Bluetooth: juntar los trozos de cada mensaje y el mapa NEXO ID ↔ MAC
    //   PluginBackground.kt — App cerrada y segundo plano: recibir con la app cerrada, avisos de respaldo, ✓✓ y saludo nativos, FCM e internet en segundo plano (NetBg)
    //   PluginUpdate.kt — Actualizador del APK de probadores (UpdateSpec): buscar, avisar, bajar e instalar
    //   PluginBtState.kt — Bluetooth: estado, permisos, servidor GATT (arranque, sus llamadas y parada) y limpieza
    //   PluginGatt.kt — Bluetooth: conexiones GATT como cliente, keepalive y reconexión
    //   PluginBleSend.kt — Bluetooth: enviar (cola de escrituras, trozos y ritmo)
    //   PluginScan.kt — Bluetooth: escaneo, anuncio y servicio en primer plano
    //   PluginStorage.kt — Archivos de la app, cifrado en reposo, huella y pantalla segura
    //   PluginAlerts.kt — Avisos: tocar una notificación, llamada entrante, pantalla de bloqueo, tonos y notificaciones de mensajes
    //   PluginCalls.kt — Llamadas: modo de sonido, audio en llamada, foco, pantalla compartida y PiP
    //   PluginLan.kt — Wi-Fi de la misma red (LanHub + NSD) y aviso de cambio de red (Wi-Fi ↔ datos)
    //   PluginTor.kt — Tor: TorService, servicio oculto y LanHub por SOCKS
    //   PluginFiles.kt — Archivos recibidos (abrir, galería, miniatura de PDF) y archivos grandes (BigFile, red local y L2CAP)
    //   PluginMove.kt — Pasar la cuenta a un teléfono nuevo (AccountMove)
    //   PluginWifiDirect.kt — Wi-Fi Direct: fotos, vídeos y archivos con el contacto a alcance
    //   PluginHaptic.kt — NEXO Touch: háptica del sistema
    // Aquí se quedan los campos (en su orden de inicialización), el companion, los override del ciclo de vida, los
    // @Synchronized y las puertas de una línea de cada @PluginMethod (Capacitor los busca en la clase).
    companion object {
        // Ronda 2758 (punto 12): la instancia que siguió recibiendo con la app cerrada; la nueva la releva al abrir
        @Volatile internal var orphan: NexoBlePlugin? = null
        // 3192: la escucha de internet es UNA por proceso y vive en NetBgHome (también sin la app: servicio o toque FCM desde lo
        // guardado); la app usa esa misma (netBg())
        internal val netBgShared: NetBg? get() = NetBgHome.peek()
        // Ronda 2785 (#87): registro nativo persistente en disco (NativeLog.kt), compartido por el proceso (lo usan el
        // plugin y NetBg, también con la app cerrada). Para que el diagnóstico muestre qué hizo el nativo sin WebView.
        @Volatile internal var nativeLogShared: NativeLog? = null
        // Auditoría C1 (ronda 2777): clave por contacto (NEXO ID → clave de firma, derivada del secreto de la pareja por
        // la app) para FIRMAR la confirmación (✓✓) que se manda con la app cerrada. Es estática: la pone la app
        // (setAckKeys) y vive en el proceso (sobrevive con la app cerrada, como la config de internet). 3192: también se guarda
        // cifrada en el teléfono (NetBgHome.saveAck) para la escucha de internet sin la app.
        internal val ackKeys = java.util.concurrent.ConcurrentHashMap<String, ByteArray>()
        // Firma corta (base64 de 12 bytes) de una confirmación, igual que e2eAckTag en la app (HMAC-SHA256 de
        // "nexo-ack|<campos>" con la clave de la pareja).
        internal fun ackTag(key: ByteArray, fields: String): String {
            val mac = Mac.getInstance("HmacSHA256"); mac.init(SecretKeySpec(key, "HmacSHA256"))
            val full = mac.doFinal(("nexo-ack|" + fields).toByteArray(Charsets.UTF_8))
            return Base64.encodeToString(full.copyOf(12), Base64.NO_WRAP)
        }
        // Ronda 2768: la instancia con la app viva (abierta o en segundo plano), para avisarle de "Rechazar"
        @Volatile internal var live: NexoBlePlugin? = null
        // "Rechazar" en el aviso de llamada (CallDeclineReceiver): con la app viva, la app rechaza ya, cifrado (antes el
        // que llama seguía en "Llamando…" hasta "No contesta"); con la app cerrada queda apuntado para cuando se abra
        fun declinedFromNotification(tap: CallTap) { live?.onDeclineTapped(tap) }
        // Build 2882 (parte 2): Telecom (coche/auriculares/reloj/pantalla de bloqueo) pidió COLGAR una llamada activa o
        // saliente (NexoConnection.onDisconnect). Avisar al JS para que termine la llamada NEXO por su lado.
        fun telecomEnded(from: String) { live?.onTelecomEnded(from) }
        internal const val TAG = "NexoBlePlugin"
        internal const val SCAN_TIMEOUT_MS = 15000L
        internal const val RECONNECT_DELAY_MS = 3000L
        internal const val MAX_RECONNECT_DELAY_MS = 30000L
        internal const val MAX_RECONNECT_ATTEMPTS = 10
        internal const val MESSAGE_REASSEMBLY_TIMEOUT_MS = 5000L
        internal const val MESSAGE_MAX_PENDING_MS = 10000L
        // Auditoría: el reensamblado de TEXTO acumulaba por tiempo pero sin tope de bytes → un vecino podía mandar trozos
        // sin cerrar nunca el JSON y hacer crecer la memoria. Un mensaje de texto/acción legítimo de NEXO no se acerca a
        // esto (el sobre va ~1 MB como mucho); al pasarse se descarta el buffer de ese enlace y se resincroniza.
        internal const val MESSAGE_BUFFER_MAX_CHARS = 8 * 1024 * 1024
        internal const val KEEPALIVE_INTERVAL_MS = 10000L
        internal const val MTU_REQUEST = 512
        // #dueño 01-11 (velocidad BLE): si el teléfono rechaza 512 el MTU se queda en 23 (20 B/escritura, ~20× más
        // lento). Algunos stacks de Android descartan en silencio peticiones >512. Por eso el reintento pide 247 (el
        // punto óptimo con DLE: 251 B por paquete de enlace entra en uno solo), que casi todos aceptan: así un teléfono
        // que no da 512 cae a 247 (~90–100 kB/s) en vez de a 23 (~2 kB/s). La investigación (Nordic/Memfault) lo respalda.
        internal const val MTU_REQUEST_FALLBACK = 247
        internal const val BG_NOTIFY_DELAY_MS = 4000L
        private const val RX_WAKE_MS = 15000L // ronda 2772: despierto tras recibir con la app en segundo plano (rxWake)
        private val RX_EVENTS = setOf("onPayloadReceived", "onLanMessage", "onTorMessage", "onWifiDirectReceived", "onBigProgress", "onBigDone")
        internal const val MAX_QUEUE_SIZE = 500
        // === FIX F0: Pacing conservador para evitar saturación del stack BLE nativo ===
        private const val WRITE_DELAY_MS = 40L               // Client writes: 40ms entre operaciones
        private const val SERVER_NOTIFY_DELAY_MS = 80L       // Server notifications: 80ms entre notifies
        internal const val CLIENT_WRITE_TIMEOUT_MS = 300L     // Timeout de respaldo si no llega onCharacteristicWrite
        internal const val SERVER_NOTIFY_TIMEOUT_MS = 200L    // Timeout de respaldo si no llega onNotificationSent
        // === FIN FIX F0 ===
        internal const val MANUFACTURER_ID = 0xFFFF
        internal const val NEXO_MAGIC_HIGH: Byte = 0x4E
        internal const val NEXO_MAGIC_LOW: Byte = 0x58
        internal const val SCAN_DEBOUNCE_MS = 1000L
        internal const val MIN_RSSI = -95
        internal const val NXID_MAC_MAP_FILE = "nexo_nxid_mac_map.json"
        // Ronda 2785 (#87): registro nativo persistente (NativeLog.kt). En claro y en append desde varios hilos (también
        // con la app cerrada o bloqueada, cuando el cifrado en reposo puede no tener la clave); por eso se excluye del
        // cifrado en reposo (skip). Solo metadatos (nunca el contenido de un mensaje).
        internal const val NATIVE_LOG_FILE = "nexo_native_log.txt"
    }
    // 3263 (PRIORIDAD 1, fase 2): el servidor GATT y lo que se hereda de cada enlace entrante (conectados, suscritos, los que
    // «tenemos») viven en GattServerHost, UNO por proceso: abrir o cerrar la app ya no cierra el servidor ni corta sus enlaces. Los
    // nombres de siempre siguen valiendo en todo el plugin; apuntan allí.
    internal var bluetoothGattServer: BluetoothGattServer?
        get() = GattServerHost.server
        set(v) { GattServerHost.server = v }
    internal var serverTxCharacteristic: BluetoothGattCharacteristic?
        get() = GattServerHost.tx
        set(v) { GattServerHost.tx = v }
    internal var serverRxCharacteristic: BluetoothGattCharacteristic?
        get() = GattServerHost.rx
        set(v) { GattServerHost.rx = v }
    internal val serverConnectedDevices: ConcurrentHashMap<String, BluetoothDevice> get() = GattServerHost.connected
    internal val serverNotificationEnabled: ConcurrentHashMap<String, Boolean> get() = GattServerHost.notifOn
    // 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11): freno a quien entra y sale del servidor GATT sin identificarse
    internal val serverFlap = ServerFlapPolicy()
    // 3262: enlaces ENTRANTES que esta app «tiene» (BluetoothGattServer.connect): solo así cancelConnection los corta de verdad
    // (ver holdServerLink en PluginBtState.kt). Y los que quedaron «a medias» tras un reinicio (HalfOpenPolicy).
    internal val serverHeld: MutableSet<String> get() = GattServerHost.held
    internal val halfOpen = HalfOpenPolicy()
    // 3267 (COLA 36): direcciones que ESTA app acaba de cerrar a propósito (disconnectDevice) y cuándo
    internal val closedByUsAt = ConcurrentHashMap<String, Long>()
    internal val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    internal val clientRxCharacteristics = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    internal val clientTxCharacteristics = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    internal val clientConnectionStates = ConcurrentHashMap<String, Int>()
    internal var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    internal var bluetoothScanner: BluetoothLeScanner? = null
    internal val scanResults = Collections.synchronizedList(mutableListOf<JSObject>())
    internal val scannedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    // Largo alcance (LE Coded PHY): cuándo se vio por última vez cada dispositivo en 1M y en Coded
    internal val seen1M = ConcurrentHashMap<String, Long>()
    internal val seenCoded = ConcurrentHashMap<String, Long>()
    internal val codedLinks = ConcurrentHashMap.newKeySet<String>()
    internal val mainHandler = Handler(Looper.getMainLooper())
    // Ronda 2766 (revisión): al pararse sola a los 15 s, se avisa a la app (antes seguía creyendo que buscaba y ya no
    // volvía a buscar: "Agregar" sin nadie y el botón en PARAR)
    internal val scanTimeoutRunnable = Runnable { stopScanInternal(); notifyListeners("onScanStopped", JSObject().put("reason", "timeout")) }
    internal val reconnectTimers = ConcurrentHashMap<String, Runnable>()
    internal val reconnectAttempts = ConcurrentHashMap<String, Int>()
    internal val reconnectDelays = ConcurrentHashMap<String, Long>()
    internal val keepAliveTimers = ConcurrentHashMap<String, Runnable>()
    internal val pendingMessageQueue = ConcurrentHashMap<String, MutableList<String>>()
    internal val pendingCalls = ConcurrentHashMap<String, PluginCall>()
    internal var messageReceiver: BroadcastReceiver? = null
    internal var bluetoothStateReceiver: BroadcastReceiver? = null
    internal var isAdvertisingActive = false
    internal var nexoAdvertisingId: String? = null
    // ID rotativo (ronda 2755): clave de los códigos, hasta cuándo se anuncia el NEXO ID y duración de la época
    internal var ridKey: String? = null
    internal var ridVisibleUntil = 0L
    internal var ridEpochS = 900L
    internal val messageBuffers = ConcurrentHashMap<String, StringBuilder>()
    internal val messageBufferTimers = ConcurrentHashMap<String, Runnable>()
    internal val messageBufferSince = ConcurrentHashMap<String, Long>() // desde cuándo hay algo pendiente
    internal val lastScanNotifyTime = ConcurrentHashMap<String, Long>()
    // #87/diagnóstico: el scan encuentra anuncios muchas veces por segundo; escribir cada uno en el registro nativo
    // (NativeLog, anillo de 48 KB) lo inundaba y echaba fuera lo útil (p. ej. el Token FCM) en un minuto, y hacía el
    // diagnóstico enorme (queja del dueño, 2812). Al registro nativo va como mucho una línea por dispositivo cada 20 s;
    // el resto solo a logcat. No cambia nada de lo que hace el escaneo, solo cuánto se persiste.
    internal val scanLogLast = ConcurrentHashMap<String, Long>()
    internal val SCAN_LOG_MIN_MS = 20000L
    internal val negotiatedMtu = ConcurrentHashMap<String, Int>()
    internal val writeQueues = ConcurrentHashMap<String, MutableList<WriteQueueItem>>()
    internal val writeQueueProcessing = ConcurrentHashMap<String, Boolean>()
    internal val writeQueueTimeouts = ConcurrentHashMap<String, Runnable>()
    internal val writeRetryCount = ConcurrentHashMap<String, Int>()
    internal val writeDropStreak = ConcurrentHashMap<String, Int>() // #129: mensajes SEGUIDOS descartados por enlace (atasco real)
    internal val clientSetupDone = ConcurrentHashMap<String, Boolean>() // 3059: enlace cliente con MTU y notificaciones ya hechos
    // 3269 (fase 3): la bandeja de salida por Bluetooth (OutboxBle) y su repaso periódico
    @Volatile internal var outBleRef: OutboxBle? = null
    @Volatile internal var outTickOn = false
    // 3271: la bandeja abre ella el enlace: el plan (OutboxDial), lo visto en el aire (NEXO ID → dirección, cuándo) y a quién se llamó
    internal val outDial = OutboxDial()
    internal val outSeen = ConcurrentHashMap<String, Pair<String, Long>>()
    internal val outDialNx = ConcurrentHashMap<String, String>()
    @Volatile internal var outScanUntil = 0L
    internal val clientSetupWaitSince = ConcurrentHashMap<String, Long>() // 3059: desde cuándo esperan las escrituras a eso
    internal val nxidToMacMap = ConcurrentHashMap<String, String>()
    internal var quickScanLatch: java.util.concurrent.CountDownLatch? = null
    internal var quickScanResultMac: String? = null
    // msgId: de qué mensaje es el trozo (un mensaje nunca se parte: o salen todos sus trozos o ninguno más)
    // isHigh: ALTA prioridad = texto/control/ack (sendMessage); BAJA = trozo de archivo (sendBinary). Pacing 2b (#141):
    // el ALTA salta por delante de los trozos de archivo en la cola (WritePacing.insertIndex). Por defecto ALTA.
    internal data class WriteQueueItem(val macNorm: String, val rawDeviceId: String, val chunk: String, val msgId: Long = 0L, val bytes: ByteArray? = null, val isHigh: Boolean = true)
    // Trozos binarios de archivos (BinFrame.kt): se juntan aparte de los mensajes de texto
    internal val binAssembler = BinAssembler()
    internal val writeMsgCounter = java.util.concurrent.atomic.AtomicLong()
    internal data class JsonExtraction(val json: String, val remainder: String)
    // Solo estas etiquetas cruzan a la app (diagnóstico). El resto (uno por cada trozo enviado o recibido) solo
    // va a logcat: la 2722 los escuchaba todos y miles de avisos por foto saturaban el puente (fotos paradas).
    internal val remLogToJs = setOf("AT_REST", "FILE_IO", "BT_ERR", "FCM")
    // Errores de Bluetooth al enviar o recibir (ronda 2755): al diagnóstico, como mucho uno de cada tipo cada 5 s
    // (si fallan seguidas serían miles y saturarían el puente con la app, como en la 2722)
    internal val btErrLast = ConcurrentHashMap<String, Long>()

    // La actividad es singleTask: tocar una notificación con la app abierta llega aquí
    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        checkNotificationIntent(intent)
        checkInviteIntent(intent) // 3129: enlace de invitación (PluginShare.kt)
        checkSharedTextIntent(intent) // 3161: texto compartido con NEXO desde otra app (PluginShare.kt)
    }

    // ===== Recibir por Bluetooth con la app cerrada (ronda 2758, plan del dueño punto 12; BgInbox.kt) =====
    @Volatile internal var closedMode = false
    internal var appCtx: Context? = null

    // Con la app cerrada no hay a quién avisar (el puente con la app ya no existe)
    override fun notifyListeners(eventName: String?, data: JSObject?, retainUntilConsumed: Boolean) {
        if (closedMode) return
        // Ronda 2772: llega un mensaje con la app en segundo plano (o la pantalla apagada): despierto 15 s (rxWake)
        if (appInBackground && eventName != null && eventName in RX_EVENTS) rxWake()
        super.notifyListeners(eventName, data, retainUntilConsumed)
    }

    // 3118: notifyListeners de Capacitor es protected y las extensiones de los otros archivos no lo ven; estas dos
    // envolturas (y las extensiones del mismo nombre al final de este archivo) les dejan llamarlo igual que antes.
    internal fun notifyListenersExt(eventName: String?, data: JSObject?) = notifyListeners(eventName, data)
    internal fun notifyListenersExt(eventName: String?, data: JSObject?, retainUntilConsumed: Boolean) = notifyListeners(eventName, data, retainUntilConsumed)

    // ===== Ronda 2772: recibir con la pantalla apagada (informe del dueño: "aunque ambos teléfonos tienen Wi-Fi, si mando
    // un mensaje y el otro tiene la pantalla apagada no llegan los mensajes, y lo mismo con las notificaciones") =====
    // Con la pantalla apagada el teléfono duerme en cuanto nada lo mantiene despierto: el paquete que llega lo despierta
    // un instante (lo justo para leerlo) y la app no llegaba a descifrarlo, confirmarlo (✓✓) ni avisar; el aviso de
    // respaldo (BG_NOTIFY_DELAY_MS, Handler.postDelayed) usa un reloj que no avanza dormido: salía al encender la
    // pantalla. Ahora, al llegar un mensaje con la app en segundo plano, el teléfono se queda despierto 15 s (se renueva
    // con cada mensaje). Android lo permite en reposo (Doze) a las apps con servicio en primer plano (BleService); Google
    // Play vigila que no pase de 2 h al día: aquí son 15 s por mensaje. Reproducido en tests/sim/notify.js (fase 1c).
    private var rxWakeLock: android.os.PowerManager.WakeLock? = null
    @Volatile internal var rxWakes = 0
    @Synchronized internal fun rxWake() {
        val ctx = appCtx ?: return
        try {
            val wl = rxWakeLock ?: (ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager)
                .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "nexo:recibir").also { it.setReferenceCounted(false); rxWakeLock = it }
            wl.acquire(RX_WAKE_MS)
            rxWakes++
        } catch (e: Exception) { Log.w(TAG, "Despertar al recibir: ${e.message}") }
    }

    // ===== Ronda 2785 (#87, informe del dueño: con la app CERRADA y la pantalla apagada no llegan los mensajes por
    // internet, pero WhatsApp sí): mantener la Wi-Fi despierta mientras la escucha nativa (NetBg) está en marcha.
    // Con la pantalla apagada Android pone la radio Wi-Fi en ahorro de energía y la conexión al relé (un socket que vive
    // en el proceso, no un push de Google como WhatsApp) deja de recibir paquetes al momento: el aviso salía al encender
    // la pantalla. El WifiLock (FULL_HIGH_PERF) apaga ese ahorro para que el paquete del relé llegue y despierte la CPU
    // (y entonces rxWake da 15 s para avisar). Solo mientras NetBg escucha (en segundo plano/cerrada); se suelta al
    // volver a la app. No aplica a datos móviles (ahí no hay WifiLock); el dueño prueba por Wi-Fi.
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null
    @Synchronized internal fun wifiLockHold(on: Boolean) {
        try {
            val ctx = appCtx ?: return
            if (on) {
                val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? android.net.wifi.WifiManager ?: return
                @Suppress("DEPRECATION")
                val wl = wifiLock ?: wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "nexo:net")
                    .also { it.setReferenceCounted(false); wifiLock = it }
                if (!wl.isHeld) { wl.acquire(); nlog()?.add("INFO", "WIFI", "WifiLock tomado (Wi-Fi despierta para recibir por internet en segundo plano)") }
            } else {
                wifiLock?.let { if (it.isHeld) { it.release(); nlog()?.add("INFO", "WIFI", "WifiLock soltado (la app vuelve al primer plano)") } }
            }
        } catch (e: Exception) { Log.w(TAG, "WifiLock: ${e.message}") }
    }

    // ===== #dueño 06-11 (paso 2b del envío de 25 MB a alguien lejos): mientras RECIBO un archivo GRANDE por internet,
    // mantener la CPU y la Wi-Fi despiertas de CORRIDO (no solo los 15 s por evento de rxWake) para no dormirse a mitad
    // del envío largo con la pantalla apagada / la app en segundo plano. La LÓGICA (umbral, TTL, tope) vive en la clase
    // pura XferAwake.kt (probada en JVM). Acá va el I/O real, espejando rxWake/wifiLockHold:
    //   - al TOMAR: un wakelock parcial dedicado "nexo:xfer" con un TOPE DURO de seguridad (XferAwake.MAX_HOLD_MS, 20 min)
    //     para que una transferencia atascada NO deje la radio tomada para siempre; el JS lo re-toma en cada bloque, así
    //     que se renueva mientras el archivo avanza. Más la Wi-Fi despierta (idempotente; datos móviles no usan WifiLock).
    //   - al SOLTAR (archivo completo): se libera el wakelock. La Wi-Fi la maneja el ciclo de vida (onPause la toma,
    //     onResume la suelta), así que no la toco acá (NetBg puede seguir necesitándola en segundo plano).
    private var xferWakeLock: android.os.PowerManager.WakeLock? = null
    private var xferLogAt = 0L
    @Synchronized internal fun xferAwakeHold(on: Boolean) {
        val ctx = appCtx ?: return
        try {
            if (on) {
                val wl = xferWakeLock ?: (ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager)
                    .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "nexo:xfer").also { it.setReferenceCounted(false); xferWakeLock = it }
                wl.acquire(XferAwake.MAX_HOLD_MS)
                wifiLockHold(true)
                // 2995: el JS lo re-toma en cada bloque (~2 veces por segundo): una línea cada 30 s, no una por bloque (taparon el diagnóstico del dueño)
                val nowMs = System.currentTimeMillis()
                if (nowMs - xferLogAt > 30_000) { xferLogAt = nowMs; nlog()?.add("INFO", "XFER", "Despierto para una transferencia grande por internet (tope ${XferAwake.MAX_HOLD_MS / 60000} min)") }
            } else {
                xferWakeLock?.let { if (it.isHeld) it.release() }
                nlog()?.add("INFO", "XFER", "Transferencia grande terminada: liberado el wakelock")
            }
        } catch (e: Exception) { Log.w(TAG, "xferAwakeHold: ${e.message}") }
    }

    @PluginMethod fun xferKeepAwake(call: PluginCall) = xferKeepAwakeImpl(call)

    @PluginMethod fun updateCheck(call: PluginCall) = updateCheckImpl(call)

    @PluginMethod fun updateNotify(call: PluginCall) = updateNotifyImpl(call)

    @PluginMethod
    fun updateNotifyCancel(call: PluginCall) { MsgNotifier.get(context).cancelUpdate(); call.resolve() }

    @PluginMethod fun updateInstall(call: PluginCall) = updateInstallImpl(call)

    // Ronda 2763: nombre de un grupo (nexo_groups.json, cifrado en reposo) para el aviso con la app cerrada
    @Volatile internal var groupNames: Pair<Long, Map<String, String>>? = null

    // Aviso de un mensaje (con la app cerrada o en segundo plano): en un grupo, en el chat del grupo con su nombre
    internal fun notifyMessage(ctx: Context, info: BgInbox.Info) {
        val who = netBgShared?.nameOf(info.from)
        val gname = groupName(info.group)
        if (mutedNotice(info, gname != null)) return // 3219: chat o grupo silenciado: sin aviso (las llamadas no pasan por aquí)
        if (gname != null) MsgNotifier.get(ctx).message(info.group, gname, info.msgId, if (who != null) "$who: " + NativeLang.t(ctx, "msg_new") else "", true)
        else MsgNotifier.get(ctx).message(info.from, who ?: "NEXO", info.msgId, "", true)
    }

    // 3012 (regla del dueño 11-11): un teléfono con «Agregar» abierto pregunta «quién eres» (kx con rq:1) a los NEXO cercanos
    // que no reconoce. Si la app de este teléfono duerme (segundo plano congelado) o está cerrada, el JS no contesta y el teléfono
    // NO salía en la lista del otro (la tableta del dueño, registro del teléfono de Marcos 13:45). Ahora contesta el nativo con la
    // «tarjeta» que la app le dejó (setKxCard): el mismo kx que manda la app (NEXO ID, clave pública, nombre y capacidades), sin el
    // paquete de claves del protocolo 2 (ese llega cuando la app despierta). Solo datos públicos: lo mismo que ya contesta la app
    // despierta a quien pregunta. Como mucho una vez cada 8 s por conexión.
    @Volatile internal var kxCard: String? = null
    internal val kxCardSentAt = java.util.concurrent.ConcurrentHashMap<String, Long>()

    @PluginMethod fun setKxCard(call: PluginCall) = setKxCardImpl(call)

    override fun load() {
        super.load()
        appCtx = activity.applicationContext
        CrashLog.install(appCtx) // 3120: guardar las primeras líneas de un fallo al caer (diagnóstico)
        live = this
        BleService.pipVideo = false // 3277: la página nace sin llamada (si la app se rehízo en plena videollamada, la marca vieja metía el chat en la miniatura)
        takeOverFromClosed()
        NetBgHome.appTookOver(appCtx!!) // 3192: si la escucha de internet corría sin la app, ahora la maneja la app (la misma)
        watchDefaultNetwork() // 3085: avisar a la app de Wi-Fi ↔ datos al momento
        // Seguridad fase 3: cifrar en segundo plano lo que aún esté en claro (archivos de versiones anteriores)
        // (prioridad baja; de lo ya cifrado solo se lee la cabecera)
        Thread {
            try {
                val t0 = System.currentTimeMillis()
                val n = atRest().migrateAll()
                atRestMigration = if (atRestDataKey() != null) "$n archivo(s) cifrados ahora (${System.currentTimeMillis() - t0} ms)" else "sin clave"
                remLog("INFO", "AT_REST", if (atRestDataKey() != null) "Cifrado en reposo activo; $atRestMigration" else "Cifrado en reposo NO disponible")
            } catch (e: Throwable) { remLog("WARN", "AT_REST", "Migración: ${e.message}") }
        }.apply { priority = Thread.MIN_PRIORITY }.start()
        checkNotificationIntent()
        checkInviteIntent() // 3129: la app se abrió con un enlace de invitación
        checkSharedTextIntent() // 3161: la app se abrió desde «Compartir» con un texto
        loadNexoMappings()
        remLog("INFO", "LIFECYCLE", "load - auto-starting GATT server, ${nxidToMacMap.size} mapeos cargados")
        registerBluetoothStateReceiver()
        autoStartGattServerAndAdvertising()
        logFcmToken()
    }

    @PluginMethod fun getFcmToken(call: PluginCall) = getFcmTokenImpl(call)
    // 3273 (dueño 22-11: «en la miniatura de la videollamada debo poder usar otras apps sin que se pause el vídeo, y al regresar no se
    // debe trabar»): al pasar a la miniatura del sistema (PiP) Android PAUSA la pantalla aunque se siga viendo. Antes eso contaba como
    // «app en segundo plano»: se avisaba a la app (que deja de pintar y reparte trabajo de fondo) y, al volver, se hacía TODO lo de
    // «volver a la app» (reconectar, vaciar colas, pedir estados, permisos) encima de la videollamada: el tirón. Ahora la miniatura NO
    // es segundo plano: no se toca nada al entrar ni al volver. Solo si la ventanita se cierra o se tapa del todo (onStop) pasa a serlo.
    @Volatile private var pipHeld = false
    // 3275: miniatura (o a punto de entrar: el aviso de irse, onUserLeaveHint, va antes que onPause)
    @Volatile private var pauseSeq = 0
    private fun inPipReal(): Boolean = try { Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity?.isInPictureInPictureMode == true } catch (e: Exception) { false }
    private fun inPipNow(): Boolean = try {
        (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity?.isInPictureInPictureMode == true) ||
            System.currentTimeMillis() - BleService.leaveHintAt < 2500L
    } catch (e: Exception) { false }
    override fun handleOnResume() {
        super.handleOnResume()
        pauseSeq++
        if (pipHeld) {
            pipHeld = false
            if (!appInBackground) { remLog("INFO", "LIFECYCLE", "vuelve de la miniatura de la videollamada: la app nunca estuvo en segundo plano (sin reconectar ni vaciar colas)"); return }
        }
        appInBackground = false
        if (BleService.inCall && !BleService.fgsState.startsWith("micrófono")) {
            callFgs = callForeground(true)
            remLog("INFO", "CALL", "Servicio en llamada al volver a la app: $callFgs")
        }
        try { netBgShared?.stop() } catch (e: Exception) { }
        wifiLockHold(false) // la app vuelve al primer plano: suelta la Wi-Fi (la app vuelve a encargarse)
        checkNotificationIntent()
        remLog("INFO", "LIFECYCLE", "handleOnResume")
        energyLog("Al volver")
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)
        if (granted) {
            notifyListeners("onPermissionStatusChanged", JSObject()
                .put("granted", true)
                .put("source", "onResume")
            )
            autoStartGattServerAndAdvertising()
        }
        // El JS no tiene @capacitor/app: se le avisa desde aquí para reconectar y vaciar la cola
        notifyListeners("onAppStateChange", JSObject().put("isActive", true))
    }
    override fun handleOnPause() {
        super.handleOnPause()
        val seq = ++pauseSeq
        if (BleService.pipVideo) {
            // 3277: con videollamada, la pausa puede ser el paso a la miniatura, y Android avisa de la miniatura ANTES o DESPUÉS de la
            // pausa según el teléfono y los gestos (y onUserLeaveHint no siempre llega). No se decide en el acto: si a los 900 ms sigue
            // en pausa y NO quedó en miniatura, entonces sí es segundo plano. (Antes, con el aviso tardío, la miniatura contaba como
            // segundo plano: trabajos de fondo compitiendo con la llamada y, al volver, reconexiones y colas de golpe.)
            pipHeld = true
            remLog("INFO", "LIFECYCLE", "handleOnPause con videollamada" + (if (inPipNow()) ": en la miniatura, sigue a la vista" else ": se espera a ver si pasa a la miniatura"))
            mainHandler.postDelayed({
                if (seq == pauseSeq && pipHeld && !appInBackground && !inPipReal()) {
                    remLog("INFO", "LIFECYCLE", "pausa con videollamada y sin miniatura: segundo plano")
                    goBackground()
                }
            }, 900)
            return
        }
        goBackground()
    }
    // La miniatura se cerró o quedó tapada del todo con la llamada aún viva: ahora sí es segundo plano
    override fun handleOnStop() {
        super.handleOnStop()
        if (pipHeld && !appInBackground) { remLog("INFO", "LIFECYCLE", "la miniatura ya no se ve: segundo plano"); goBackground() }
    }
    private fun goBackground() {
        remLog("INFO", "LIFECYCLE", "handleOnPause")
        appInBackground = true
        bgSinceMs = System.currentTimeMillis() // 3086: desde cuándo (BgNotifyPolicy)
        energyLog("En segundo plano")
        // La app deja de estar a la vista: la escucha nativa de internet toma el relevo (la app la reconfigura al
        // ocultarse con lo último que vio)
        mainHandler.postDelayed({ if (appInBackground) try { wifiLockHold(true); netBg().start() } catch (e: Exception) { } }, 3000)
        outboxBleTick() // 3269: lo pendiente de la bandeja también por Bluetooth mientras la app no está a la vista
        notifyListeners("onAppStateChange", JSObject().put("isActive", false))
    }
    override fun handleOnDestroy() {
        super.handleOnDestroy()
        if (live === this) live = null
        BleService.pipVideo = false // 3277: sin ventana no hay videollamada que pasar a la miniatura
        unwatchDefaultNetwork() // 3085
        activeChatNx = "" // 3172: con la app cerrada no hay chat abierto: lo que llegue (Bluetooth o internet) avisa siempre
        // Ronda 2770: la app se cierra con una llamada en curso: se suelta todo lo de la llamada (si no, el sensor de
        // proximidad seguía apagando la pantalla hasta 4 h, la música de otras apps no volvía y el audio quedaba en modo
        // llamada)
        if (BleService.inCall || focusReq != null || proximityLock != null) {
            try {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
                if (Build.VERSION.SDK_INT >= 31) try { am.clearCommunicationDevice() } catch (e: Exception) { }
                am.mode = android.media.AudioManager.MODE_NORMAL
                callFocus(am, false)
            } catch (e: Exception) { }
            callScreen(false, false)
            callFgs = callForeground(false)
        }
        try { lanStopAll() } catch (e: Exception) {}
        try { torStopAll() } catch (e: Exception) {}
        // R4 (auditoría 03-11): cerrar los escritores de archivos grandes que quedaron SIN terminar (fuga de descriptor +
        // un .enc a medias por cada id abandonado). bigWriters no se limpiaba al destruir; al cerrar el Activity la UI ya no
        // puede seguir alimentándolos (bigAppend viene del WebView), así que se abortan (cierra el FD y borra el parcial).
        try { if (bigWriters.isNotEmpty()) { remLog("INFO", "FILE_IO", "handleOnDestroy - cerrando ${bigWriters.size} escritor(es) de archivo grande sin terminar"); bigWriters.values.forEach { try { it.abort() } catch (e: Exception) {} }; bigWriters.clear() } } catch (e: Exception) {}
        // Ronda 2758: con permisos y el servidor en marcha, el Bluetooth sigue recibiendo con la app cerrada
        if (bluetoothGattServer != null && appCtx != null && checkCoreBLEPermissions(appCtx!!)) {
            try { stopScanInternal() } catch (e: Exception) { }
            closedMode = true
            orphan = this
            GattServerHost.attach(gattServerCallback, "app cerrada") // 3263: sigue atendiendo esta instancia (mismo servidor, mismos enlaces)
            remLog("INFO", "LIFECYCLE", "handleOnDestroy - el Bluetooth sigue recibiendo con la app cerrada")
            return
        }
        remLog("INFO", "LIFECYCLE", "handleOnDestroy - limpiando DUAL GATT")
        cleanupAllConnections()
        try { unregisterServerReceivers() } catch (e: Exception) { }
        try { unregisterBluetoothStateReceiver() } catch (e: Exception) { }
        try { stopScanInternal() } catch (e: Exception) { }
        try { stopGattServer() } catch (e: Exception) { }
        isAdvertisingActive = false
        try { stopAdvertisingInternal() } catch (e: Exception) { }
        messageBuffers.clear()
        binAssembler.clearAll()
        messageBufferTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        messageBufferTimers.clear()
        lastScanNotifyTime.clear()
        writeQueues.clear()
        writeQueueProcessing.clear()
        writeQueueTimeouts.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        writeQueueTimeouts.clear()
        negotiatedMtu.clear()
    }

    @PluginMethod fun checkBLEStatus(call: PluginCall) = checkBLEStatusImpl(call)
    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        remLog("INFO", "PERMISSIONS", "initializeBLE")
        val ctx = activity.applicationContext
        if (checkCoreBLEPermissions(ctx)) {
            startGattServer()
            autoStartGattServerAndAdvertising()
            notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "permissions_already_granted"))
            call.resolve(JSObject().put("granted", true))
            return
        }
        ctx.getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
            .edit().putBoolean("ble_permissions_asked", true).apply()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            requestPermissionForAliases(
                arrayOf("bluetoothScan", "bluetoothConnect", "bluetoothAdvertise", "postNotifications", "foregroundServiceConnectedDevice"),
                call, "permissionsCallback"
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(
                arrayOf("bluetoothScan", "bluetoothConnect", "bluetoothAdvertise", "postNotifications"),
                call, "permissionsCallback"
            )
        } else {
            requestPermissionForAliases(arrayOf("location", "postNotifications"), call, "permissionsCallback")
        }
    }

    @PermissionCallback fun permissionsCallback(call: PluginCall) = permissionsCallbackImpl(call)

    internal val gattServerCallback = newGattServerCallback()

    @PluginMethod fun connectToDevice(call: PluginCall) = connectToDeviceImpl(call)

    @PluginMethod fun disconnectDevice(call: PluginCall) = disconnectDeviceImpl(call)

    @PluginMethod fun forceReconnect(call: PluginCall) = forceReconnectImpl(call)

    @PluginMethod fun reconnectDevice(call: PluginCall) = reconnectDeviceImpl(call)

    @PluginMethod fun sendBinary(call: PluginCall) = sendBinaryImpl(call)

    @PluginMethod fun sendMessage(call: PluginCall) = sendMessageImpl(call)

    internal data class SendResult(val sent: Boolean, val mode: String)

    @PluginMethod fun setAdvertisingData(call: PluginCall) = setAdvertisingDataImpl(call)

    @PluginMethod fun startAdvertising(call: PluginCall) = startAdvertisingImpl(call)

    @PluginMethod fun startScan(call: PluginCall) = startScanImpl(call)

    @PluginMethod fun stopScan(call: PluginCall) = stopScanImpl(call)

    internal val scanCallback = newScanCallback()

    @PluginMethod fun isBluetoothEnabled(call: PluginCall) = isBluetoothEnabledImpl(call)

    @PluginMethod fun getLocalDeviceInfo(call: PluginCall) = getLocalDeviceInfoImpl(call)

    @PluginMethod fun getConnectedDevices(call: PluginCall) = getConnectedDevicesImpl(call)

    internal val advertiseCallback = newAdvertiseCallback()

    @PluginMethod fun stopAdvertising(call: PluginCall) = stopAdvertisingImpl(call)

    @PluginMethod fun isAdvertising(call: PluginCall) = isAdvertisingImpl(call)

    @PluginMethod
    fun startBLEAdvertising(call: PluginCall) = startAdvertising(call)

    @PluginMethod
    fun stopBLEAdvertising(call: PluginCall) = stopAdvertising(call)

    @PluginMethod
    fun scanForDevices(call: PluginCall) = startScan(call)

    @PluginMethod fun startListeningMessages(call: PluginCall) = startListeningMessagesImpl(call)

    // Los archivos se leen y guardan fuera del hilo de los plugins (Capacitor los ejecuta todos en uno, en fila):
    // así guardar o leer un vídeo no hace esperar a sendMessage ni a los guardados pequeños (claves, historial).
    // Cada archivo va siempre al mismo hilo (el orden de guardar/leer un mismo archivo se mantiene); los grandes
    // (adjuntos, HD y cola de Jump) tienen el suyo.
    internal val ioSmall = java.util.concurrent.Executors.newSingleThreadExecutor()
    internal val ioBig = java.util.concurrent.Executors.newSingleThreadExecutor()

    @PluginMethod fun saveToFile(call: PluginCall) = saveToFileImpl(call)

    @PluginMethod fun loadFromFile(call: PluginCall) = loadFromFileImpl(call)

    @PluginMethod fun readNativeLog(call: PluginCall) = readNativeLogImpl(call)

    @PluginMethod fun deleteFile(call: PluginCall) = deleteFileImpl(call)

    // ===== Seguridad fase 3: cifrado en reposo, huella y capturas =====
    // Clave de datos (AES-256) aleatoria, guardada envuelta (AES-GCM) con una clave del Android Keystore que no
    // sale del chip; en memoria solo mientras la app corre. Sin requisito de huella: los mensajes deben poder
    // guardarse con la app bloqueada o en segundo plano.
    @Volatile private var atRestKey: SecretKey? = null
    @Volatile private var atRestFailed = false
    @Volatile internal var atRestMigration = "en curso"
    private var atRestStore: AtRestStore? = null

    @Synchronized
    internal fun atRest(): AtRestStore {
        atRestStore?.let { return it }
        val st = AtRestStore(context.filesDir) { atRestDataKey() }
        st.skip = setOf(NXID_MAC_MAP_FILE, NATIVE_LOG_FILE) // los lee y escribe el propio Kotlin, en claro
        st.migrateOnly = { it.startsWith("nexo_") } // solo lo de NEXO (no los archivos de librerías de Android)
        atRestStore = st
        return st
    }

    @Synchronized
    internal fun atRestDataKey(): SecretKey? {
        atRestKey?.let { return it }
        if (atRestFailed) return null
        // 3192: la clave en sí la da AtRestKey (movida tal cual desde aquí; también la usa la escucha de internet sin la app)
        return try {
            val key = AtRestKey.get(context, create = true) ?: throw Exception("sin clave")
            atRestKey = key
            key
        } catch (e: Exception) {
            atRestFailed = true
            remLog("WARN", "AT_REST", "Clave de cifrado en reposo no disponible: ${e.message}")
            null
        }
    }

    @PluginMethod fun atRestStatus(call: PluginCall) = atRestStatusImpl(call)

    @PluginMethod fun biometricStatus(call: PluginCall) = biometricStatusImpl(call)

    @PluginMethod fun biometricAuth(call: PluginCall) = biometricAuthImpl(call)

    @PluginMethod fun netBgConfig(call: PluginCall) = netBgConfigImpl(call)

    @PluginMethod fun netBgDrain(call: PluginCall) = netBgDrainImpl(call)
    // 3268 (fase 3, COLA 29): bandeja de salida nativa (los textos pendientes salen por internet aunque la app se duerma)
    @PluginMethod fun netOutboxSet(call: PluginCall) = netOutboxSetImpl(call)
    @PluginMethod fun netOutboxDrop(call: PluginCall) = netOutboxDropImpl(call)
    @PluginMethod fun netOutboxList(call: PluginCall) = netOutboxListImpl(call)

    @PluginMethod fun setAckKeys(call: PluginCall) = setAckKeysImpl(call)
    @PluginMethod fun setMutedChats(call: PluginCall) = setMutedChatsImpl(call) // 3219: chats silenciados (MutedChats)

    @PluginMethod fun notifyCall(call: PluginCall) = notifyCallImpl(call)

    @PluginMethod
    fun clearCall(call: PluginCall) { MsgNotifier.get(context).cancelCall(); call.resolve() }

    @PluginMethod fun telecom(call: PluginCall) = telecomImpl(call)

    // Acabó la llamada (o no había ninguna): la app vuelve a quedar detrás de la pantalla de bloqueo (sin desbloquear no
    // se ven los chats)
    @PluginMethod
    fun callScreenDone(call: PluginCall) { showOverLock(false); call.resolve() }

    @PluginMethod fun getCallRingtone(call: PluginCall) = getCallRingtoneImpl(call)

    @PluginMethod fun pickCallRingtone(call: PluginCall) = pickCallRingtoneImpl(call)

    @ActivityCallback private fun ringtonePicked(call: PluginCall?, result: ActivityResult) = ringtonePickedImpl(call, result)

    @PluginMethod fun alertSettings(call: PluginCall) = alertSettingsImpl(call)
    @PluginMethod
    fun setWakeOnMessage(call: PluginCall) { MsgNotifier.get(context).setWakeOnMsg(call.getBoolean("on", true) == true); call.resolve() }
    @PluginMethod fun openAlertSetting(call: PluginCall) = openAlertSettingImpl(call)
    @PluginMethod fun callAction(call: PluginCall) = callActionImpl(call)

    @PluginMethod fun markMsgsSeen(call: PluginCall) = markMsgsSeenImpl(call)

    @PluginMethod fun setNotifAvatar(call: PluginCall) = setNotifAvatarImpl(call)

    @PluginMethod fun notifyMessage(call: PluginCall) = notifyMessageImpl(call)

    // Android 13+: pedir el permiso de notificaciones si falta (quien ya tenía los de Bluetooth no pasaba por aquí)
    @PluginMethod
    fun ensureNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("postNotifications") == com.getcapacitor.PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true)); return
        }
        requestPermissionForAlias("postNotifications", call, "notificationPermCallback")
    }
    @PermissionCallback private fun notificationPermCallback(call: PluginCall) = notificationPermCallbackImpl(call)

    // #dueño 08-11: qué chat tiene abierto la app AHORA (NEXO ID en minúsculas, o "" si ninguno). Lo pone el JS al abrir/cerrar
    // un chat (notify.js). El aviso de respaldo en segundo plano (backgroundNotify) NO avisa de este chat: no debe llegar una
    // notificación de la persona que tenés en pantalla, aunque la app pase un instante a segundo plano.
    @Volatile internal var activeChatNx: String = ""

    @PluginMethod fun setActiveChat(call: PluginCall) = setActiveChatImpl(call)

    @PluginMethod fun clearChatNotification(call: PluginCall) = clearChatNotificationImpl(call)

    @PluginMethod fun syncUnread(call: PluginCall) = syncUnreadImpl(call)

    @PluginMethod fun setSecureScreen(call: PluginCall) = setSecureScreenImpl(call)

    @PluginMethod fun listFiles(call: PluginCall) = listFilesImpl(call)

    // ===== Wi-Fi normal (misma red): LanHub (TCP) + NSD (mDNS, como Bonjour en iPhone) =====
    // Cada teléfono se anuncia como "_nexo._tcp" con una marca del día (t) que solo sus contactos saben calcular
    // (sin NEXO ID a la vista). Al encontrar la marca de un contacto, la app pide conectar; los mensajes son los
    // mismos JSON que por Bluetooth (ya cifrados). La app comprueba cada conexión con el cifrado antes de usarla.
    internal var lanHub: LanHub? = null
    internal var nsdManager: android.net.nsd.NsdManager? = null
    internal var nsdReg: android.net.nsd.NsdManager.RegistrationListener? = null
    internal var nsdDisc: android.net.nsd.NsdManager.DiscoveryListener? = null
    internal var lanMcLock: WifiManager.MulticastLock? = null
    // Escaneo activo de la red (LanBeacon): por si el router no deja pasar el anuncio mDNS
    internal var lanBeacon: LanBeacon? = null
    internal var lanNetCb: android.net.ConnectivityManager.NetworkCallback? = null
    @Volatile internal var lanLastSweep = 0L
    @Volatile internal var lanMyId = ""
    internal var lanToken = ""
    internal var lanServiceName = ""
    internal val nsdResolveQueue = java.util.concurrent.ConcurrentLinkedQueue<android.net.nsd.NsdServiceInfo>()
    @Volatile internal var nsdResolving = false
    internal val lanSendExec = java.util.concurrent.Executors.newSingleThreadExecutor()

    @PluginMethod fun lanStatus(call: PluginCall) = lanStatusImpl(call)
    @PluginMethod fun reportNoInternet(call: PluginCall) = reportNoInternetImpl(call) // 3266 (COLA 27)

    @PluginMethod fun lanStart(call: PluginCall) = lanStartImpl(call)

    @PluginMethod fun lanConnect(call: PluginCall) = lanConnectImpl(call)

    @PluginMethod fun lanSend(call: PluginCall) = lanSendImpl(call)

    @PluginMethod fun lanDrop(call: PluginCall) = lanDropImpl(call)

    @PluginMethod fun lanStop(call: PluginCall) = lanStopImpl(call)

    // 3085 (dueño 14-11: «el S24 cambia de Wi-Fi a datos en automático y muy rápido, ¿por qué nosotros somos lentos?»): la app solo
    // sabía de «entré a un Wi-Fi» (lanWatchWifi); al pasar de Wi-Fi a datos sus conexiones a los relés quedaban colgadas de la red
    // vieja. Se avisa de cada cambio de TIPO de la red por defecto (NetChange) y la app reconecta al momento (net_link._onNetChange).
    internal var defNetCb: android.net.ConnectivityManager.NetworkCallback? = null
    internal val netTracker = NetChange.Tracker()

    // ===== Tor (internet sin relés, sin que nadie vea la IP): TorService + servicio oculto + LanHub por SOCKS =====
    // La app (net_link.js) pide torStart con su NEXO ID; aquí se arranca Tor (librería oficial tor-android), se crea
    // el servicio oculto (.onion, clave guardada cifrada en nexo_tor_key.json: la dirección no cambia) que lleva al
    // LanHub de Tor (solo escucha en 127.0.0.1) y se avisa con onTorReady { onion }. torConnect conecta a la .onion
    // de un contacto por el SOCKS de Tor. Lo que viaja ya va cifrado por la app (sobre de pareja + E2E).
    internal var torSvc: org.torproject.jni.TorService? = null
    @Volatile internal var appInBackground = false
    @Volatile internal var bgSinceMs = 0L // 3086: cuándo pasó la app a segundo plano
    internal var torBind: android.content.ServiceConnection? = null
    internal var torHub: LanHub? = null
    @Volatile internal var torOnion = ""
    @Volatile internal var torStarting = false
    internal val torExec = java.util.concurrent.Executors.newSingleThreadExecutor()
    internal val torSendExec = java.util.concurrent.Executors.newSingleThreadExecutor()
    internal val TOR_PORT = 9878
    internal val TOR_KEY_FILE = "nexo_tor_key.json"

    @PluginMethod fun torStatus(call: PluginCall) = torStatusImpl(call)

    @PluginMethod fun torStart(call: PluginCall) = torStartImpl(call)

    @PluginMethod fun torConnect(call: PluginCall) = torConnectImpl(call)

    @PluginMethod fun torSend(call: PluginCall) = torSendImpl(call)

    @PluginMethod fun torDrop(call: PluginCall) = torDropImpl(call)

    @PluginMethod fun torStop(call: PluginCall) = torStopImpl(call)

    @PluginMethod fun openFile(call: PluginCall) = openFileImpl(call)

    @PluginMethod fun saveToGallery(call: PluginCall) = saveToGalleryImpl(call)

    // ===== Archivos grandes (ronda 2756, BigFile.kt): nunca enteros en la memoria de la app =====
    internal val bigWriters = ConcurrentHashMap<String, BigWriter>()

    @PluginMethod fun bigBegin(call: PluginCall) = bigBeginImpl(call)

    @PluginMethod fun bigAppend(call: PluginCall) = bigAppendImpl(call)

    @PluginMethod fun bigStatus(call: PluginCall) = bigStatusImpl(call)

    @PluginMethod fun bigDelete(call: PluginCall) = bigDeleteImpl(call)

    @PluginMethod fun bigServe(call: PluginCall) = bigServeImpl(call)

    @PluginMethod fun bigSendLan(call: PluginCall) = bigSendLanImpl(call)

    // ===== Pasar la cuenta a un teléfono nuevo (ronda 2759, plan del dueño punto 15, AccountMove.kt) =====
    internal val moveSkip get() = setOf(NXID_MAC_MAP_FILE)
    // Mientras se pasa la cuenta (y hasta reiniciar) la app no escribe nada: lo que tenga en memoria ya no vale
    @Volatile internal var moveFrozen = false

    @PluginMethod fun moveReceive(call: PluginCall) = moveReceiveImpl(call)

    @PluginMethod fun moveSend(call: PluginCall) = moveSendImpl(call)

    @PluginMethod fun ringerMode(call: PluginCall) = ringerModeImpl(call)
    @PluginMethod fun ringback(call: PluginCall) = ringbackImpl(call)

    @PluginMethod fun callAudio(call: PluginCall) = callAudioImpl(call)

    // Ronda 2769 (informe del dueño: en videollamadas el S24 salía "sin cámara", el otro veía negro y no se le oía): en
    // llamada la pantalla no se apaga sola; si se apagaba por el tiempo de pantalla, NEXO pasaba a segundo plano y Android
    // le quitaba la cámara y silenciaba el micrófono. Con el auricular, el sensor de proximidad apaga la pantalla al
    // acercarla a la oreja sin sacar a NEXO de primer plano (como el teléfono). Se quita al colgar.
    @Volatile internal var proximityLock: android.os.PowerManager.WakeLock? = null

    // Ronda 2770: durante la llamada el servicio en primer plano también es de micrófono (BleService.foreground): con la
    // pantalla bloqueada o en otra app, el micrófono sigue (antes Android 11+ daba silencio y el otro dejaba de oír)
    @Volatile internal var callFgs = ""

    @PluginMethod fun screenShareStart(call: PluginCall) = screenShareStartImpl(call)

    @ActivityCallback private fun screenSharePicked(call: PluginCall?, result: ActivityResult) = screenSharePickedImpl(call, result)

    @PluginMethod fun screenShareStop(call: PluginCall) = screenShareStopImpl(call)

    @PluginMethod fun setPipActive(call: PluginCall) = setPipActiveImpl(call)

    @PluginMethod fun enterPip(call: PluginCall) = enterPipImpl(call)

    @PluginMethod fun pipState(call: PluginCall) = pipStateImpl(call)

    // Ronda 2770: foco de audio durante la llamada (la música u otro audio de otra app se para y vuelve al colgar; antes
    // seguía sonando encima de la llamada)
    @Volatile internal var focusReq: android.media.AudioFocusRequest? = null
    @Volatile internal var callFocusState = ""
    internal val focusHandler = android.os.Handler(android.os.Looper.getMainLooper())
    internal var focusTries = 0
    internal var focusRegrabAt = 0L // 3226: última vez que se volvió a pedir el foco tras perderlo sin llamada telefónica (FocusPolicy)

    @PluginMethod fun l2Info(call: PluginCall) = l2InfoImpl(call)

    @PluginMethod fun bigServeL2(call: PluginCall) = bigServeL2Impl(call)

    @PluginMethod fun bigSendL2(call: PluginCall) = bigSendL2Impl(call)

    @PluginMethod fun bigOpen(call: PluginCall) = bigOpenImpl(call)

    @PluginMethod fun pdfThumbnail(call: PluginCall) = pdfThumbnailImpl(call)

    @PluginMethod fun getPowerStatus(call: PluginCall) = getPowerStatusImpl(call)
    @PluginMethod fun getExitReasons(call: PluginCall) = getExitReasonsImpl(call)
    @PluginMethod fun setAppLang(call: PluginCall) = setAppLangImpl(call)
    @PluginMethod fun shareText(call: PluginCall) = shareTextImpl(call) // 3129: invitación por WhatsApp/TikTok/menú (PluginShare.kt)

    @PluginMethod fun openUrl(call: PluginCall) = openUrlImpl(call) // 3161: enlace del chat abierto fuera de NEXO (PluginShare.kt)

    // ===== Wi-Fi Direct: fotos, vídeos y archivos con el contacto a alcance (mucho más rápido que BLE) =====
    // El que recibe crea un grupo con nombre y contraseña aleatorios (Android 10+: el otro se une sin aviso
    // del sistema) y abre un socket; el que envía se une, manda el contenido (ya cifrado de extremo a
    // extremo) y espera la confirmación. El grupo se cierra al terminar. Bluetooth sigue siendo el canal de
    // control (por ahí viajan las credenciales, cifradas).
    internal var p2pManager: WifiP2pManager? = null
    internal var p2pChannel: WifiP2pManager.Channel? = null
    internal var wdServer: java.net.ServerSocket? = null
    internal val WD_MAX_BYTES = 40_000_000L

    @PluginMethod fun wifiDirectStatus(call: PluginCall) = wifiDirectStatusImpl(call)

    @PluginMethod
    fun requestWifiDirectPermission(call: PluginCall) {
        if (wdPermissionGranted()) { call.resolve(JSObject().put("granted", true)); return }
        requestPermissionForAlias(if (Build.VERSION.SDK_INT >= 33) "nearbyWifi" else "location", call, "wifiDirectPermCallback")
    }

    @PermissionCallback fun wifiDirectPermCallback(call: PluginCall) = wifiDirectPermCallbackImpl(call)

    @PluginMethod fun wifiDirectHost(call: PluginCall) = wifiDirectHostImpl(call)

    @PluginMethod fun wifiDirectSend(call: PluginCall) = wifiDirectSendImpl(call)

    @PluginMethod fun haptic(call: PluginCall) = hapticImpl(call)

    @PluginMethod fun hapticCaps(call: PluginCall) = hapticCapsImpl(call)
}

// 3118: desde las extensiones (PluginXxx.kt) el notifyListeners protected de Capacitor no se ve; Kotlin elige entonces
// estas, que pasan por las envolturas internal de la clase. Dentro de la clase se sigue usando el de Capacitor (y el override).
internal fun NexoBlePlugin.notifyListeners(eventName: String?, data: JSObject?) = notifyListenersExt(eventName, data)
internal fun NexoBlePlugin.notifyListeners(eventName: String?, data: JSObject?, retainUntilConsumed: Boolean) = notifyListenersExt(eventName, data, retainUntilConsumed)
