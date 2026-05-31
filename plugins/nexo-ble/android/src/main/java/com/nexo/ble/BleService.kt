package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.NotificationCompat
import java.nio.charset.Charset
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_CHANNEL_ID = "nexo_ble_channel"
        private const val NOTIFICATION_ID = 1001

        // HEALTH MONITOR
        private const val HEALTH_CHECK_INTERVAL_MS = 300000L // 5 min
        private const val SERVICE_REBOOT_INTERVAL_MS = 7200000L // 2 horas
        private const val MEMORY_PRESSURE_THRESHOLD_MB = 100
        private const val MAX_MESSAGES_PER_MINUTE = 60
        private const val MAX_CONNECTED_DEVICES = 10
    }

    private var bluetoothGattServer: BluetoothGattServer? = null
    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    private var txCharacteristic: BluetoothGattCharacteristic? = null
    private var rxCharacteristic: BluetoothGattCharacteristic? = null
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val isAdvertising = AtomicBoolean(false)
    private val isDestroyed = AtomicBoolean(false)
    private val messageCount = AtomicInteger(0)
    private val lastMessageReset = AtomicBoolean(false)

    private val serviceHandler = Handler(Looper.getMainLooper())
    private var bluetoothStateReceiver: BroadcastReceiver? = null

    // Health monitor
    private var healthCheckRunnable: Runnable? = null
    private var rebootRunnable: Runnable? = null
    private var messageRateRunnable: Runnable? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")

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

            registerBluetoothStateReceiver()

            // Inicializar con delay para no bloquear onCreate
            serviceHandler.post {
                if (!isDestroyed.get()) {
                    try {
                        startGattServer()
                        startAdvertising()
                        startHealthMonitor()
                    } catch (e: Exception) {
                        Log.e(TAG, "Error delayed init", e)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Fatal error in onCreate", e)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand action=${intent?.action}")

        if (isDestroyed.get()) {
            Log.w(TAG, "Service is destroyed, ignoring onStartCommand")
            return START_NOT_STICKY
        }

        when (intent?.action) {
            NexoBleSpec.ACTION_BLE_SEND_MESSAGE -> {
                val msg = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA) ?: ""
                if (msg.isNotEmpty()) {
                    // Rate limiting
                    val currentCount = messageCount.incrementAndGet()
                    if (currentCount > MAX_MESSAGES_PER_MINUTE) {
                        Log.w(TAG, "Rate limit exceeded: $currentCount messages/min")
                        return START_STICKY
                    }
                    sendNotificationToAll(msg)
                }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ==================== HEALTH MONITOR ====================

    private fun startHealthMonitor() {
        Log.i(TAG, "Health Monitor iniciado")

        // Health check cada 5 minutos
        healthCheckRunnable = Runnable {
            performHealthCheck()
            healthCheckRunnable?.let { serviceHandler.postDelayed(it, HEALTH_CHECK_INTERVAL_MS) }
        }
        serviceHandler.postDelayed(healthCheckRunnable!!, HEALTH_CHECK_INTERVAL_MS)

        // Reboot automático cada 2 horas (evita acumulación de estado)
        rebootRunnable = Runnable {
            performServiceReboot()
            rebootRunnable?.let { serviceHandler.postDelayed(it, SERVICE_REBOOT_INTERVAL_MS) }
        }
        serviceHandler.postDelayed(rebootRunnable!!, SERVICE_REBOOT_INTERVAL_MS)

        // Reset rate limit cada minuto
        messageRateRunnable = Runnable {
            messageCount.set(0)
            messageRateRunnable?.let { serviceHandler.postDelayed(it, 60000) }
        }
        serviceHandler.postDelayed(messageRateRunnable!!, 60000)
    }

    private fun stopHealthMonitor() {
        healthCheckRunnable?.let { serviceHandler.removeCallbacks(it) }
        rebootRunnable?.let { serviceHandler.removeCallbacks(it) }
        messageRateRunnable?.let { serviceHandler.removeCallbacks(it) }
        healthCheckRunnable = null
        rebootRunnable = null
        messageRateRunnable = null
    }

    private fun performHealthCheck() {
        try {
            val runtime = Runtime.getRuntime()
            val usedMemoryMB = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
            val maxMemoryMB = runtime.maxMemory() / (1024 * 1024)

            Log.i(TAG, "Health Check - Memory: ${usedMemoryMB}MB/${maxMemoryMB}MB, Connected: ${connectedDevices.size}, Advertising: ${isAdvertising.get()}, Messages/min: ${messageCount.get()}")

            // Memory pressure
            if (usedMemoryMB > MEMORY_PRESSURE_THRESHOLD_MB) {
                Log.w(TAG, "MEMORY PRESSURE: ${usedMemoryMB}MB > ${MEMORY_PRESSURE_THRESHOLD_MB}MB")
                performCleanup()
            }

            // Too many connected devices
            if (connectedDevices.size > MAX_CONNECTED_DEVICES) {
                Log.w(TAG, "Too many connections: ${connectedDevices.size}, cleaning oldest")
                val oldest = connectedDevices.keys.firstOrNull()
                oldest?.let { connectedDevices.remove(it) }
            }

            // Check if advertising stopped unexpectedly
            if (!isAdvertising.get() && !isDestroyed.get()) {
                Log.w(TAG, "Advertising not active, restarting...")
                startAdvertising()
            }

        } catch (e: Exception) {
            Log.e(TAG, "Health check error", e)
        }
    }

    private fun performServiceReboot() {
        try {
            Log.i(TAG, "Auto-reboot: Reiniciando servicio limpiamente")

            // 1. Detener advertising
            stopAdvertisingInternal()

            // 2. Cerrar GATT server
            try { bluetoothGattServer?.close() } catch (e: Exception) { }
            bluetoothGattServer = null

            // 3. Limpiar dispositivos
            connectedDevices.clear()

            // 4. Forzar GC
            System.gc()

            // 5. Esperar 1s
            Thread.sleep(1000)

            // 6. Reiniciar todo
            if (!isDestroyed.get()) {
                startGattServer()
                startAdvertising()
                Log.i(TAG, "Auto-reboot completado")
            }

        } catch (e: Exception) {
            Log.e(TAG, "Auto-reboot failed", e)
        }
    }

    private fun performCleanup() {
        try {
            Log.i(TAG, "Performing cleanup")

            // Limpiar mensajes antiguos del characteristic
            txCharacteristic?.value = ByteArray(0)
            rxCharacteristic?.value = ByteArray(0)

            // Forzar GC
            System.gc()

            Log.i(TAG, "Cleanup completed")
        } catch (e: Exception) {
            Log.e(TAG, "Cleanup error", e)
        }
    }

    // ==================== BLUETOOTH STATE MONITORING ====================

    private fun registerBluetoothStateReceiver() {
        try {
            bluetoothStateReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    when (intent.action) {
                        BluetoothAdapter.ACTION_STATE_CHANGED -> {
                            val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                            when (state) {
                                BluetoothAdapter.STATE_OFF -> {
                                    Log.w(TAG, "Bluetooth apagado - deteniendo advertising")
                                    stopAdvertisingInternal()
                                    connectedDevices.clear()
                                }
                                BluetoothAdapter.STATE_ON -> {
                                    Log.i(TAG, "Bluetooth encendido - reiniciando advertising")
                                    serviceHandler.postDelayed({
                                        if (!isDestroyed.get()) {
                                            startAdvertising()
                                        }
                                    }, 1000)
                                }
                            }
                        }
                    }
                }
            }

            val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(bluetoothStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(bluetoothStateReceiver, filter)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error registering BT state receiver", e)
        }
    }

    private fun unregisterBluetoothStateReceiver() {
        try {
            bluetoothStateReceiver?.let {
                unregisterReceiver(it)
                bluetoothStateReceiver = null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error unregistering BT state receiver", e)
        }
    }

    // ==================== GATT SERVER ====================

    private fun startGattServer() {
        try {
            val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) {
                Log.e(TAG, "Bluetooth not available")
                return
            }

            bluetoothGattServer?.close()
            bluetoothGattServer = null

            bluetoothGattServer = bluetoothManager.openGattServer(this, gattServerCallback)

            val service = android.bluetooth.BluetoothGattService(
                NexoBleSpec.NEXO_SERVICE_UUID,
                android.bluetooth.BluetoothGattService.SERVICE_TYPE_PRIMARY
            )

            txCharacteristic = BluetoothGattCharacteristic(
                NexoBleSpec.TX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            ).apply {
                addDescriptor(BluetoothGattDescriptor(
                    NexoBleSpec.CCCD_UUID,
                    BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
                ))
            }

            rxCharacteristic = BluetoothGattCharacteristic(
                NexoBleSpec.RX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )

            service.addCharacteristic(txCharacteristic)
            service.addCharacteristic(rxCharacteristic)

            val success = bluetoothGattServer?.addService(service) ?: false
            Log.i(TAG, "GATT Server addService success=$success")
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException starting GATT server", e)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting GATT server", e)
        }
    }

    // ==================== ADVERTISING ====================

    private fun startAdvertising() {
        try {
            if (isAdvertising.get()) {
                Log.w(TAG, "Advertising already active")
                return
            }

            val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) {
                Log.e(TAG, "Bluetooth adapter not available")
                return
            }

            bluetoothLeAdvertiser = adapter.bluetoothLeAdvertiser
            if (bluetoothLeAdvertiser == null) {
                Log.e(TAG, "BluetoothLeAdvertiser is null")
                return
            }

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
        } catch (e: IllegalStateException) {
            Log.e(TAG, "IllegalStateException starting advertising", e)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting advertising", e)
        }
    }

    private fun stopAdvertisingInternal() {
        try {
            if (isAdvertising.get()) {
                bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
                isAdvertising.set(false)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping advertising", e)
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            Log.i(TAG, "Advertising started")
            isAdvertising.set(true)
        }
        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "Advertising failed: $errorCode")
            isAdvertising.set(false)
            serviceHandler.postDelayed({
                if (!isDestroyed.get()) {
                    startAdvertising()
                }
            }, 3000)
        }
    }

    // ==================== GATT SERVER CALLBACKS ====================

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            try {
                Log.i(TAG, "Connection ${device.address} status=$status newState=$newState")

                if (status != android.bluetooth.BluetoothGatt.GATT_SUCCESS && newState != BluetoothProfile.STATE_DISCONNECTED) {
                    Log.w(TAG, "Connection error status=$status for ${device.address}")
                }

                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    // Limitar conexiones
                    if (connectedDevices.size >= MAX_CONNECTED_DEVICES) {
                        Log.w(TAG, "Max connections reached, rejecting ${device.address}")
                        bluetoothGattServer?.cancelConnection(device)
                        return
                    }
                    connectedDevices[device.address] = device
                    broadcast(NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED, device.address)
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    connectedDevices.remove(device.address)
                    broadcast(NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED, device.address)
                    if (!isDestroyed.get()) {
                        serviceHandler.postDelayed({
                            try { startAdvertising() } catch (e: Exception) { Log.w(TAG, "Restart adv failed", e) }
                        }, 500)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "onConnectionStateChange crash", e)
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice, requestId: Int, offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            try {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val value = characteristic.value ?: ByteArray(0)
                    bluetoothGattServer?.sendResponse(
                        device, requestId, 
                        android.bluetooth.BluetoothGatt.GATT_SUCCESS, 
                        offset, value
                    )
                } else {
                    bluetoothGattServer?.sendResponse(
                        device, requestId, 
                        android.bluetooth.BluetoothGatt.GATT_READ_NOT_PERMITTED, 
                        offset, null
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "onCharacteristicReadRequest crash", e)
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            try {
                if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
                    if (value == null) {
                        Log.w(TAG, "Received null value from ${device.address}")
                        if (responseNeeded) {
                            bluetoothGattServer?.sendResponse(
                                device, requestId, 
                                android.bluetooth.BluetoothGatt.GATT_WRITE_NOT_PERMITTED, 
                                offset, null
                            )
                        }
                        return
                    }

                    val message = value.toString(Charset.defaultCharset())
                    Log.i(TAG, "RX from ${device.address}: $message")
                    val intent = Intent(NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED).apply {
                        putExtra(NexoBleSpec.EXTRA_MESSAGE_DATA, message)
                        putExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS, device.address)
                        setPackage(packageName)
                    }
                    sendBroadcast(intent)
                    if (responseNeeded) {
                        bluetoothGattServer?.sendResponse(
                            device, requestId, 
                            android.bluetooth.BluetoothGatt.GATT_SUCCESS, 
                            offset, value
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "onCharacteristicWriteRequest crash", e)
                if (responseNeeded) {
                    try {
                        bluetoothGattServer?.sendResponse(
                            device, requestId, 
                            android.bluetooth.BluetoothGatt.GATT_FAILURE, 
                            offset, null
                        )
                    } catch (e2: Exception) {
                        Log.e(TAG, "Error sending error response", e2)
                    }
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            try {
                if (descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                    if (value != null) {
                        descriptor.value = value
                    }
                    if (responseNeeded) {
                        bluetoothGattServer?.sendResponse(
                            device, requestId, 
                            android.bluetooth.BluetoothGatt.GATT_SUCCESS, 
                            offset, value
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "onDescriptorWriteRequest crash", e)
                if (responseNeeded) {
                    try {
                        bluetoothGattServer?.sendResponse(
                            device, requestId, 
                            android.bluetooth.BluetoothGatt.GATT_FAILURE, 
                            offset, null
                        )
                    } catch (e2: Exception) {
                        Log.e(TAG, "Error sending descriptor error response", e2)
                    }
                }
            }
        }
    }

    // ==================== MESSAGING ====================

    private fun sendNotificationToAll(message: String) {
        val data = message.toByteArray(Charset.defaultCharset())
        txCharacteristic?.value = data

        val devicesCopy = connectedDevices.values.toList()
        devicesCopy.forEach { device ->
            try {
                bluetoothGattServer?.notifyCharacteristicChanged(device, txCharacteristic, false)
            } catch (e: Exception) {
                Log.e(TAG, "Notify failed for ${device.address}", e)
                connectedDevices.remove(device.address)
            }
        }
    }

    private fun broadcast(action: String, address: String) {
        try {
            val intent = Intent(action).apply {
                putExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS, address)
                setPackage(packageName)
            }
            sendBroadcast(intent)
        } catch (e: Exception) {
            Log.e(TAG, "broadcast error", e)
        }
    }

    // ==================== NOTIFICATION ====================

    private fun createNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID, 
                "NEXO BLE", 
                NotificationManager.IMPORTANCE_LOW
            )
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        } ?: Intent()

        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent, 
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("NEXO BLE Activo")
            .setContentText("Servidor GATT + Advertising...")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    // ==================== CLEANUP ====================

    override fun onDestroy() {
        super.onDestroy()
        isDestroyed.set(true)

        Log.i(TAG, "onDestroy - cleaning up")

        stopHealthMonitor()

        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            Log.w(TAG, "stopForeground error", e)
        }

        unregisterBluetoothStateReceiver()
        stopAdvertisingInternal()

        try {
            bluetoothGattServer?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Close server error", e)
        }
        bluetoothGattServer = null

        connectedDevices.clear()

        Log.i(TAG, "Destroyed")
    }
}
