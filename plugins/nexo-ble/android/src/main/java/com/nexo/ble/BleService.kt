package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.LinkedList
import java.util.Random
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * BleService v3.0.0-ARCH — ÚNICO DUEÑO DE TODO BLE
 * * Arquitectura: Service monolítico estándar Android BLE 2026
 * - GATT Server (1 servicio, 1 característica principal + 1 announce)
 * - GATT Client (máquina de estados, queue, retries, timeouts)
 * - Scan (sin hardware filter, software filter S24 fix)
 * - Advertising (foreground + device name)
 * - Emite Broadcasts para Plugin bridge
 */
class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "nexo_ble_channel"

        // UUIDs NEXO v1.0
        val SERVICE_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6")
        val MESSAGE_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c7")
        val ANNOUNCE_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c8")
        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        // Broadcast Actions
        const val ACTION_SCAN_RESULT = "com.nexo.ble.SCAN_RESULT"
        const val ACTION_SCAN_FAILED = "com.nexo.ble.SCAN_FAILED"
        const val ACTION_SCAN_STOPPED = "com.nexo.ble.SCAN_STOPPED"
        const val ACTION_ADVERT_STATE = "com.nexo.ble.ADVERT_STATE"
        const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.MESSAGE_RECEIVED"
        const val ACTION_MESSAGE_SENT = "com.nexo.ble.MESSAGE_SENT"
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.DEVICE_DISCONNECTED"
        const val ACTION_CONNECTION_ERROR = "com.nexo.ble.CONNECTION_ERROR"
        const val ACTION_SERVICES_READY = "com.nexo.ble.SERVICES_READY"
        const val ACTION_NOTIFICATIONS_ENABLED = "com.nexo.ble.NOTIFICATIONS_ENABLED"
        const val ACTION_CONNECTION_FAILED = "com.nexo.ble.CONNECTION_FAILED"
        const val ACTION_RETRY_SCHEDULED = "com.nexo.ble.RETRY_SCHEDULED"
        const val ACTION_PEER_INFO_RECEIVED = "com.nexo.ble.PEER_INFO_RECEIVED"
        const val ACTION_CLIENT_NOTIFICATION_STATE_CHANGED = "com.nexo.ble.CLIENT_NOTIFICATION_STATE_CHANGED"
        const val ACTION_NAP_AUDIT = "com.nexo.ble.NAP_AUDIT"

        // Extra Keys
        const val EXTRA_DEVICE_ADDRESS = "device_address"
        const val EXTRA_DEVICE_NAME = "device_name"
        const val EXTRA_RSSI = "rssi"
        const val EXTRA_ERROR_CODE = "error_code"
        const val EXTRA_ERROR_DESC = "error_description"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_MESSAGE_ID = "message_id"
        const val EXTRA_ADVERTISING = "advertising"
        const val EXTRA_SUCCESS = "success"
        const val EXTRA_REASON = "reason"
        const val EXTRA_ATTEMPT = "attempt"
        const val EXTRA_MAX_ATTEMPTS = "max_attempts"
        const val EXTRA_DELAY_MS = "delay_ms"
        const val EXTRA_ENABLED = "enabled"
        const val EXTRA_USER_ID = "user_id"
        const val EXTRA_USER_NAME = "user_name"
        const val EXTRA_NAP_CODE = "nap_code"
        const val EXTRA_NAP_MESSAGE = "nap_message"
        const val EXTRA_NAP_LEVEL = "nap_level"
        const val EXTRA_TIMESTAMP = "timestamp"
        const val EXTRA_DIRECTION = "direction"
        const val EXTRA_SOURCE = "source"
        const val EXTRA_CONTENT = "content"
        const val EXTRA_DATA = "data"
        const val EXTRA_SENDER_NAME = "sender_name"

        // Constantes Operativas
        const val MAX_RETRY_ATTEMPTS = 3
        const val RETRY_BASE_DELAY_MS = 2000L
        const val RETRY_MAX_DELAY_MS = 16000L
        const val CONNECT_TIMEOUT_MS = 15000L
        const val WRITE_TIMEOUT_MS = 5000L
        const val RATE_LIMIT_MS = 5000L
        const val SCAN_RATE_LIMIT_MS = 30000L
        const val SCAN_AUTO_STOP_MS = 15000L
        const val CHUNK_SIZE = 507
    }

    enum class ConnectionState { IDLE, CONNECTING, DISCOVERING, READY, DISCONNECTING, FAILED }

    data class BLEConnection(
        val deviceId: String,
        var gatt: BluetoothGatt? = null,
        var state: ConnectionState = ConnectionState.IDLE,
        var lastStateChangeTime: Long = 0L,
        var retryCount: Int = 0,
        var lastAttemptTime: Long = 0L,
        var pendingWritePayload: ByteArray? = null,
        var pendingWriteMessageId: String? = null,
        var userDisconnected: Boolean = false,
        var servicesReady: Boolean = false,
        var notificationsEnabled: Boolean = false
    )

    private val operationQueue = ConcurrentHashMap<String, LinkedList<Runnable>>()
    private val isOperating = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicBoolean>()

    private fun enqueueOperation(deviceId: String, operation: Runnable) {
        val queue = operationQueue.getOrPut(deviceId) { LinkedList() }
        synchronized(queue) { queue.add(operation) }
        processNextOperation(deviceId)
    }

    private fun processNextOperation(deviceId: String) {
        val flag = isOperating.getOrPut(deviceId) { java.util.concurrent.atomic.AtomicBoolean(false) }
        if (flag.getAndSet(true)) return
        val queue = operationQueue[deviceId] ?: return
        val next: Runnable?
        synchronized(queue) { next = queue.pollFirst() }
        if (next == null) { flag.set(false); return }
        handler.post {
            try { next.run() } finally {
                flag.set(false)
                processNextOperation(deviceId)
            }
        }
    }

    private val binder = LocalBinder()
    private val handler = Handler(Looper.getMainLooper())
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    private var gattServer: BluetoothGattServer? = null
    private var isAdvertising = false
    private var isScanning = false
    private val scanResults = ConcurrentHashMap<String, ScanResult>()
    private val scanTimestamps = ArrayDeque<Long>(5)
    private val connectedGatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val connections = ConcurrentHashMap<String, BLEConnection>()
    private val serverConnections = ConcurrentHashMap<String, BluetoothDevice>()
    private var userId: String = ""
    private var userName: String = "NEXO User"

    inner class LocalBinder : Binder() { fun getService(): BleService = this@BleService }
    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        createNotificationChannel()
        startForegroundService()
        try { initGattServer() } catch (e: Exception) { napLog("BLE_INIT", "GATT Server error: ${e.message}", "ERROR") }
        napLog("BLE_INIT", "BleService v3.0.0-ARCH iniciado", "INFO")
    }

    override fun onDestroy() {
        cleanupAllConnections()
        super.onDestroy()
    }

    private fun startForegroundService() {
        val notification = buildNotification("NEXO BLE activo")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(content: String): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO Mesh")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "NEXO BLE Service", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun initGattServer() {
        val adapter = bluetoothAdapter ?: return
        gattServer = bluetoothManager?.openGattServer(this, gattServerCallback)
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val messageChar = BluetoothGattCharacteristic(MESSAGE_CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_WRITE)
        messageChar.addDescriptor(BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ))
        service.addCharacteristic(messageChar)
        service.addCharacteristic(BluetoothGattCharacteristic(ANNOUNCE_CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ))
        gattServer?.addService(service)
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            val addr = device?.address ?: return
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                serverConnections[addr] = device
                broadcastDeviceEvent(ACTION_DEVICE_CONNECTED, device, "incoming")
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                serverConnections.remove(addr)
                broadcastDeviceEvent(ACTION_DEVICE_DISCONNECTED, device)
            }
        }

        override fun onCharacteristicWriteRequest(device: BluetoothDevice?, requestId: Int, characteristic: BluetoothGattCharacteristic?, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            if (characteristic?.uuid == MESSAGE_CHAR_UUID && value != null) {
                val message = String(value, Charsets.UTF_8)
                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, device?.address)
                    putExtra(EXTRA_MESSAGE, message)
                    putExtra(EXTRA_SOURCE, "server_write_request")
                    putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                })
                if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }
    }

    fun connectToDevice(address: String): Boolean {
        val adapter = bluetoothAdapter ?: return false
        val device = adapter.getRemoteDevice(address) ?: return false
        enqueueOperation(address) { executeConnectInternal(device, address) }
        return true
    }

    private fun executeConnectInternal(device: BluetoothDevice, deviceId: String) {
        val conn = connections.getOrPut(deviceId) { BLEConnection(deviceId) }
        conn.state = ConnectionState.CONNECTING
        conn.lastAttemptTime = System.currentTimeMillis()
        conn.gatt?.close()
        conn.gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(this, false, unifiedGattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(this, false, unifiedGattCallback)
        }
    }

    private val unifiedGattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val deviceId = gatt.device.address
            val conn = connections[deviceId] ?: return
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                conn.state = ConnectionState.DISCOVERING
                handler.postDelayed({ try { gatt.discoverServices() } catch (e: SecurityException) {} }, 800)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                conn.state = ConnectionState.IDLE
                if (!conn.userDisconnected && conn.retryCount < MAX_RETRY_ATTEMPTS) scheduleRetry(deviceId)
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val deviceId = gatt.device.address
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(MESSAGE_CHAR_UUID)
            if (char != null) {
                gatt.setCharacteristicNotification(char, true)
                val desc = char.getDescriptor(CCCD_UUID)
                if (desc != null) {
                    desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    gatt.writeDescriptor(desc)
                } else { markConnectionReady(deviceId, gatt) }
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == CCCD_UUID) markConnectionReady(gatt.device.address, gatt)
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == MESSAGE_CHAR_UUID) {
                val message = String(characteristic.value ?: byteArrayOf(), Charsets.UTF_8)
                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, gatt.device.address)
                    putExtra(EXTRA_MESSAGE, message)
                    putExtra(EXTRA_SOURCE, "client_notification")
                })
            }
        }
    }

    private fun markConnectionReady(deviceId: String, gatt: BluetoothGatt) {
        val conn = connections[deviceId] ?: return
        conn.state = ConnectionState.READY
        conn.retryCount = 0
        sendBroadcast(Intent(ACTION_SERVICES_READY).apply { putExtra(EXTRA_DEVICE_ADDRESS, deviceId); putExtra(EXTRA_SUCCESS, true) })
    }

    private fun scheduleRetry(deviceId: String) {
        val conn = connections[deviceId] ?: return
        conn.retryCount++
        val delay = minOf(RETRY_BASE_DELAY_MS * (1 shl (conn.retryCount - 1)), RETRY_MAX_DELAY_MS)
        handler.postDelayed({ connectToDevice(deviceId) }, delay)
    }

    fun startScan() {
        val adapter = bluetoothAdapter ?: return
        scanner = adapter.bluetoothLeScanner ?: return
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        isScanning = true
        scanner?.startScan(null, settings, scanCallback)
        handler.postDelayed({ stopScan() }, SCAN_AUTO_STOP_MS)
    }

    fun stopScan() {
        if (!isScanning) return
        isScanning = false
        try { scanner?.stopScan(scanCallback) } catch (e: Exception) {}
        sendBroadcast(Intent(ACTION_SCAN_STOPPED))
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.address?.let { addr ->
                val isNexo = result.scanRecord?.serviceUuids?.any { it.uuid == SERVICE_UUID } == true
                if (isNexo) {
                    sendBroadcast(Intent(ACTION_SCAN_RESULT).apply {
                        putExtra(EXTRA_DEVICE_ADDRESS, addr)
                        putExtra(EXTRA_DEVICE_NAME, result.device.name ?: "NEXO Device")
                        putExtra(EXTRA_RSSI, result.rssi)
                    })
                }
            }
        }
    }

    fun startAdvertising(deviceName: String) {
        val adapter = bluetoothAdapter ?: return
        advertiser = adapter.bluetoothLeAdvertiser ?: return
        val settings = AdvertiseSettings.Builder().setConnectable(true).build()
        val data = AdvertiseData.Builder().setIncludeDeviceName(true).addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        advertiser?.startAdvertising(settings, data, advertiseCallback)
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) { isAdvertising = true; broadcastAdvertState(true) }
    }

    private fun broadcastAdvertState(active: Boolean) { sendBroadcast(Intent(ACTION_ADVERT_STATE).apply { putExtra(EXTRA_ADVERTISING, active) }) }

    private fun broadcastDeviceEvent(action: String, device: BluetoothDevice?, direction: String = "unknown") {
        sendBroadcast(Intent(action).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, device?.address)
            putExtra(EXTRA_DIRECTION, direction)
        })
    }

    private fun napLog(code: String, message: String, level: String) {
        sendBroadcast(Intent(ACTION_NAP_AUDIT).apply {
            putExtra(EXTRA_NAP_CODE, code); putExtra(EXTRA_NAP_MESSAGE, message); putExtra(EXTRA_NAP_LEVEL, level)
        })
    }

    private fun cleanupAllConnections() {
        connections.forEach { (_, c) -> c.gatt?.close() }
        gattServer?.close()
        stopScan()
    }
}
