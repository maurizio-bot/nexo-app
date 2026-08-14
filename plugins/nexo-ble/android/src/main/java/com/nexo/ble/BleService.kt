package com.nexo.ble

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import org.json.JSONObject

class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_CHANNEL_ID = "nexo_ble_channel"
        private const val NOTIFICATION_ID = 1001
        private const val MANUFACTURER_ID = 0xFFFF
        private const val NEXO_MAGIC_HIGH: Byte = 0x4E
        private const val NEXO_MAGIC_LOW: Byte = 0x58

        private const val MESSAGE_CHANNEL_ID = "nexo_messages"
        private const val MESSAGE_NOTIFICATION_ID_START = 2001
        private const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.MESSAGE_RECEIVED"
        private const val EXTRA_NEXO_CHAT_DEVICE_ID = "nexo_chat_device_id"
    }

    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    private var currentNexoId: String? = null
    private var messageReceiver: BroadcastReceiver? = null
    private var bluetoothStateReceiver: BroadcastReceiver? = null

    private fun showToast(message: String) {
        try {
            Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show()
        } catch (e: Exception) { }
    }

    override fun onCreate() {
        super.onCreate()
        showToast("[BLE Svc] onCreate - Advertising Only")
        Log.i(TAG, "onCreate - Advertising Only Service")
        try {
            createMessageNotificationChannel()
            registerMessageReceiver()
            registerBluetoothStateReceiver()
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
            // FIX: No iniciar advertising aqui si no tenemos nexoId todavia.
            // Esperamos a onStartCommand para recibirlo.
            Log.i(TAG, "onCreate: esperando nexoId via onStartCommand")
        } catch (e: Exception) {
            showToast("[BLE Svc] FATAL onCreate: ${e.message}")
            Log.e(TAG, "Fatal error in onCreate", e)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand action=${intent?.action}")
        val nexoId = intent?.getStringExtra("nexo_advertising_id")
        if (nexoId != null) {
            currentNexoId = nexoId
            Log.i(TAG, "NEXO ID recibido: $nexoId")
            restartAdvertising()
        } else if (currentNexoId == null) {
            Log.w(TAG, "onStartCommand sin nexoId y sin currentNexoId - advertising no iniciado")
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.i(TAG, "onTaskRemoved - re-lanzando service")
        val restartIntent = Intent(applicationContext, BleService::class.java).apply {
            putExtra("nexo_advertising_id", currentNexoId)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartIntent)
            } else {
                startService(restartIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error re-lanzando service", e)
        }
    }

    private fun restartAdvertising() {
        try {
            bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        } catch (e: Exception) { }
        startAdvertising()
    }

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

            val dataBuilder = AdvertiseData.Builder()
                .setIncludeDeviceName(false)

            val nexoId = currentNexoId
            if (nexoId != null && nexoId.length >= 4) {
                val manufacturerData = ByteArray(2 + nexoId.length)
                manufacturerData[0] = NEXO_MAGIC_HIGH
                manufacturerData[1] = NEXO_MAGIC_LOW
                val idBytes = nexoId.toByteArray(Charsets.UTF_8)
                System.arraycopy(idBytes, 0, manufacturerData, 2, idBytes.size)
                dataBuilder.addManufacturerData(MANUFACTURER_ID, manufacturerData)
                Log.i(TAG, "Advertising con NEXO ID: $nexoId (manufacturerData ${manufacturerData.size} bytes)")
            } else {
                Log.w(TAG, "Advertising SIN NEXO ID (no recibido aun)")
                showToast("[BLE Svc] SIN NEXO ID - esperando...")
                return  // FIX: No anunciar sin nexoId
            }

            val data = dataBuilder.build()

            val scanResponse = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .build()

            bluetoothLeAdvertiser?.startAdvertising(settings, data, scanResponse, advertiseCallback)
            Log.i(TAG, "Advertising iniciado con TX_POWER_HIGH, MODE_LOW_LATENCY")
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

    private fun createMessageNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                MESSAGE_CHANNEL_ID,
                "Mensajes NEXO",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notificaciones de mensajes recibidos"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300, 200, 300)
                setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, null)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun registerMessageReceiver() {
        if (messageReceiver != null) return
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != ACTION_MESSAGE_RECEIVED) return
                if (isAppInForeground()) {
                    Log.i(TAG, "App en foreground, notificación suprimida")
                    return
                }
                val deviceId = intent.getStringExtra("deviceId") ?: return
                val content = intent.getStringExtra("content") ?: ""
                showMessageNotification(deviceId, content)
            }
        }
        val filter = IntentFilter(ACTION_MESSAGE_RECEIVED)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(messageReceiver, filter)
            }
            Log.i(TAG, "MessageReceiver registrado")
        } catch (e: Exception) {
            Log.e(TAG, "Error registrando MessageReceiver", e)
        }
    }

    private fun registerBluetoothStateReceiver() {
        if (bluetoothStateReceiver != null) return
        bluetoothStateReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
                val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                when (state) {
                    BluetoothAdapter.STATE_OFF -> {
                        Log.w(TAG, "Bluetooth apagado, deteniendo advertising")
                        try {
                            bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
                        } catch (e: Exception) { }
                        bluetoothLeAdvertiser = null
                    }
                    BluetoothAdapter.STATE_ON -> {
                        Log.i(TAG, "Bluetooth encendido, reanudando advertising")
                        startAdvertising()
                    }
                }
            }
        }
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(bluetoothStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(bluetoothStateReceiver, filter)
            }
            Log.i(TAG, "BluetoothStateReceiver registrado")
        } catch (e: Exception) {
            Log.e(TAG, "Error registrando BluetoothStateReceiver", e)
        }
    }

    private fun isAppInForeground(): Boolean {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val runningProcesses = am.runningAppProcesses
        for (process in runningProcesses ?: emptyList()) {
            if (process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND &&
                process.processName == packageName) {
                return true
            }
        }
        return false
    }

    private fun showMessageNotification(deviceId: String, content: String) {
        try {
            val notificationId = MESSAGE_NOTIFICATION_ID_START + (deviceId.hashCode() and 0xFFFF)

            val preview = try {
                val json = JSONObject(content)
                json.optString("text", content.take(120))
            } catch (e: Exception) {
                content.take(120)
            }

            val senderName = try {
                val json = JSONObject(content)
                json.optString("senderName", "NEXO")
            } catch (e: Exception) {
                "NEXO"
            }

            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(EXTRA_NEXO_CHAT_DEVICE_ID, deviceId)
            } ?: return

            val pendingIntent = PendingIntent.getActivity(
                this,
                notificationId,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(this, MESSAGE_CHANNEL_ID)
                .setContentTitle(senderName)
                .setContentText(preview)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVibrate(longArrayOf(0, 300, 200, 300))
                .setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI)
                .setStyle(
                    NotificationCompat.MessagingStyle("Tú")
                        .addMessage(preview, System.currentTimeMillis(), senderName)
                )
                .build()

            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(notificationId, notification)
            Log.i(TAG, "Notificación mostrada para $deviceId")
        } catch (e: Exception) {
            Log.e(TAG, "Error mostrando notificación", e)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        showToast("[BLE Svc] onDestroy")
        try {
            messageReceiver?.let { unregisterReceiver(it) }
        } catch (e: Exception) { }
        try {
            bluetoothStateReceiver?.let { unregisterReceiver(it) }
        } catch (e: Exception) { }
        try {
            bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        } catch (e: Exception) { }
        Log.i(TAG, "Destroyed")
    }
}
