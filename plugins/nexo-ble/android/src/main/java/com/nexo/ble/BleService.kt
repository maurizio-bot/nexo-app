package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.ParcelUuid
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat

/**
 * BleService v3.0 - ADVERTISING ONLY (Foreground Service)
 * 
 * Este servicio SOLO maneja:
 * 1. BLE Advertising (para que otros dispositivos nos encuentren)
 * 2. Foreground notification (para que Android no mate el proceso)
 * 
 * El GATT Server ahora se maneja UNICAMENTE en NexoBlePlugin.kt
 * para evitar conflictos de doble GATT Server.
 */
class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_CHANNEL_ID = "nexo_ble_channel"
        private const val NOTIFICATION_ID = 1001
    }

    private fun showToast(message: String) {
        try {
            Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show()
        } catch (e: Exception) { }
    }

    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null

    override fun onCreate() {
        super.onCreate()
        showToast("[BLE Svc] onCreate - Advertising Only")
        Log.i(TAG, "onCreate - Advertising Only Service")
        try {
            val notification = createNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            startAdvertising()
        } catch (e: Exception) {
            showToast("[BLE Svc] FATAL onCreate: ${e.message}")
            Log.e(TAG, "Fatal error in onCreate", e)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand action=${intent?.action}")
        // Ya no manejamos ACTION_BLE_SEND_MESSAGE aqui - todo va por NexoBlePlugin
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startAdvertising() {
        showToast("[BLE Svc] startAdvertising...")
        try {
            val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) {
                Log.e(TAG, "Bluetooth adapter not available")
                showToast("[BLE Svc] Bluetooth no disponible")
                return
            }
            bluetoothLeAdvertiser = adapter.bluetoothLeAdvertiser

            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true)
                .setTimeout(0)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .build()

            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(NexoBleSpec.NEXO_SERVICE_UUID))
                .build()

            bluetoothLeAdvertiser?.startAdvertising(settings, data, advertiseCallback)
            showToast("[BLE Svc] Advertising iniciado")
        } catch (e: Exception) {
            showToast("[BLE Svc] Advertising ERROR: ${e.message}")
            Log.e(TAG, "Error starting advertising", e)
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            showToast("[BLE Svc] Advertising STARTED")
            Log.i(TAG, "Advertising started")
        }
        override fun onStartFailure(errorCode: Int) {
            showToast("[BLE Svc] Advertising FAILED: $errorCode")
            Log.e(TAG, "Advertising failed: $errorCode")
        }
    }

    private fun createNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(NOTIFICATION_CHANNEL_ID, "NEXO BLE", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        } ?: Intent()
        val pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("NEXO BLE Activo")
            .setContentText("Advertising + GATT Server...")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        showToast("[BLE Svc] onDestroy")
        try { bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) } catch (e: Exception) { }
        Log.i(TAG, "Destroyed")
    }
}
