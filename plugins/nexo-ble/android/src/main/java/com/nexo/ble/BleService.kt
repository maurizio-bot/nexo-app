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
    }

    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    private var isAdvertising = false
    private var currentNexoId: String? = null
    private var advertiseCallback: AdvertiseCallback? = null
    // Largo alcance (LE Coded PHY, ~4x distancia): anuncio extendido aparte del normal, si el teléfono lo tiene
    private var codedCallback: AdvertisingSetCallback? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand flags=$flags startId=$startId")

        val nexoId = intent?.getStringExtra("nexo_advertising_id")
        val action = intent?.getStringExtra("action")

        if (!nexoId.isNullOrEmpty()) {
            currentNexoId = nexoId
            Log.i(TAG, "NEXO ID actualizado: $nexoId")
        }

        startForeground(NOTIFICATION_ID, buildNotification())

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

        val nexoIdBytes = nexoId.toByteArray(Charset.forName("UTF-8"))
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

        // Scan Response: nombre completo del dispositivo (31 bytes extra)
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build()

        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                Log.i(TAG, "Advertising iniciado con NEXO ID: $nexoId")
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
