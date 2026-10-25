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
        private const val CHANNEL_ID = "nexo_ble_foreground"
        private const val NOTIFICATION_ID = 1001
        private const val MANUFACTURER_ID = 0xFFFF
        private const val NEXO_MAGIC_HIGH: Byte = 0x4E
        private const val NEXO_MAGIC_LOW: Byte = 0x58
        // Ronda 2770: el servicio en marcha (para cambiar sus tipos al empezar y acabar una llamada) y si hay llamada
        @Volatile var live: BleService? = null
        @Volatile var inCall = false
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

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
        live = this
        createNotificationChannel()
    }

    // Ronda 2770: Android 11+ solo deja usar el micrófono a una app en segundo plano si su servicio en primer plano es
    // de tipo micrófono (si no, graba silencio): con la pantalla bloqueada o en otra app durante una llamada, el otro
    // dejaba de oír. En llamada: "dispositivo conectado" + micrófono; fuera de ella, solo "dispositivo conectado" (el de
    // micrófono no se puede pedir en segundo plano: si el servicio se reinicia solo, fallaría). En Android 8–10 basta
    // con tener el servicio. Devuelve cómo quedó (para el diagnóstico de la llamada).
    fun foreground(): String { val r = foregroundTyped(); fgsState = r; return r }
    private fun foregroundTyped(): String {
        val n = buildNotification()
        if (Build.VERSION.SDK_INT < 29) { startForeground(NOTIFICATION_ID, n); return if (inCall) "micrófono (Android 8–9)" else "normal" }
        val base = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        if (inCall && Build.VERSION.SDK_INT >= 30) {
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                startForeground(NOTIFICATION_ID, n, base); return "sin micrófono (sin permiso)"
            }
            try {
                startForeground(NOTIFICATION_ID, n, base or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
                return "micrófono"
            } catch (e: Exception) {
                // Con la app en segundo plano Android no lo deja (se reintenta al volver a la app)
                Log.w(TAG, "Servicio con micrófono: ${e.message}")
                startForeground(NOTIFICATION_ID, n, base)
                return "sin micrófono (${e.javaClass.simpleName})"
            }
        }
        startForeground(NOTIFICATION_ID, n, base)
        return if (inCall) "micrófono (Android 10)" else "normal"
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

        foreground()

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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        if (live === this) live = null
        handler.removeCallbacks(rotate)
        stopAdvertisingInternal()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "NEXO BLE Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Servicio BLE en segundo plano"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO BLE")
            .setContentText("Anunciando dispositivo NEXO...")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
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
