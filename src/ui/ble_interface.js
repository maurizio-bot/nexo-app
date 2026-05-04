package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
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
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class BleService : Service() {

    companion object {
        const val TAG = "NexoBleService"
        val SERVICE_UUID: UUID = UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb")
        val CHAR_MESSAGE_UUID: UUID = UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb")
        val CHAR_ANNOUNCE_UUID: UUID = UUID.fromString("0000ffe2-0000-1000-8000-00805f9b34fb")

        const val ACTION_DEVICE_FOUND = "com.nexo.ble.ACTION_DEVICE_FOUND"
        const val ACTION_SCAN_FAILED = "com.nexo.ble.ACTION_SCAN_FAILED"
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.ACTION_DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.ACTION_DEVICE_DISCONNECTED"
        const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.ACTION_MESSAGE_RECEIVED"
        const val ACTION_ADVERTISE_STARTED = "com.nexo.ble.ACTION_ADVERTISE_STARTED"
        const val ACTION_ADVERTISE_FAILED = "com.nexo.ble.ACTION_ADVERTISE_FAILED"
        const val ACTION_SERVER_READY = "com.nexo.ble.ACTION_SERVER_READY"
        const val ACTION_SERVER_ERROR = "com.nexo.ble.ACTION_SERVER_ERROR"
        const val ACTION_BLUETOOTH_STACK_BROKEN = "com.nexo.ble.ACTION_BLUETOOTH_STACK_BROKEN"

        const val EXTRA_DEVICE_ADDRESS = "device_address"
        const val EXTRA_DEVICE_NAME = "device_name"
        const val EXTRA_RSSI = "rssi"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_SENDER_NAME = "sender_name"

        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "nexo_ble_channel"
        const val SCAN_AUTO_STOP = 30000L
        const val SCAN_RATE_LIMIT = 30000L
        const val MAX_SCAN_HISTORY = 4
    }

    private val binder = LocalBinder()
    private var btManager: BluetoothManager? = null
    private var btAdapter: BluetoothAdapter? = null
    private var btGattServer: BluetoothGattServer? = null
    private var scanner: BluetoothLeScanner? = null
    private var advertiser: android.bluetooth.le.BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null
    private var isScan = false
    private var isAd = false
    private var userName = "NEXO Device"

    private val scanResults = ConcurrentHashMap<String, ScanResult>()
    private val scanTimes = LinkedList<Long>()
    private val serverConns = ConcurrentHashMap<String, BluetoothDevice>()
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val messageQueue = ConcurrentHashMap<String, LinkedList<String>>()

    private val handler = Handler(Looper.getMainLooper())

    inner class LocalBinder : Binder() {
        fun getService(): BleService = this@BleService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "[NAP-001] onCreate() - INICIO")
        btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        btAdapter = btManager?.adapter
        Log.i(TAG, "[NAP-002] Adapter=${btAdapter != null}, enabled=${btAdapter?.isEnabled == true}")
        createChannel()
        startForegroundNotif()
        try { initGattServer() } catch (e: Exception) {
            Log.e(TAG, "[NAP-003] GATT server init error: ${e.message}")
        }
        Log.i(TAG, "[NAP-004] onCreate() - FIN")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "[NAP-005] onStartCommand()")
        startForegroundNotif()
        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "[NAP-006] onDestroy() - INICIO")
        stopScan()
        stopAdvertising()
        btGattServer?.close()
        gattClients.values.forEach { try { it.close() } catch (_: Exception) {} }
        gattClients.clear()
        super.onDestroy()
        Log.i(TAG, "[NAP-007] onDestroy() - FIN")
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val ch = NotificationChannel(CHANNEL_ID, "NEXO BLE", NotificationManager.IMPORTANCE_LOW)
            nm.createNotificationChannel(ch)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO BLE")
            .setContentText("Servicio BLE activo")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()
    }

    private fun startForegroundNotif() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, buildNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, buildNotification())
        }
    }

    // ===== GATT SERVER =====
    private fun initGattServer() {
        val gm = btManager ?: return
        btGattServer = gm.openGattServer(this, gattServerCallback)
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val msgChar = BluetoothGattCharacteristic(CHAR_MESSAGE_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE)
        val annChar = BluetoothGattCharacteristic(CHAR_ANNOUNCE_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ)
        service.addCharacteristic(msgChar)
        service.addCharacteristic(annChar)
        btGattServer?.addService(service)
        Log.i(TAG, "[NAP-008] GATT Server iniciado")
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            val d = device ?: return
            val addr = normalizeMacAddress(d.address)
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                serverConns[addr] = d
                bcastDev(ACTION_DEVICE_CONNECTED, addr, d.name ?: "NEXO Device")
                Log.i(TAG, "[NAP-GATT-001] Server CONNECTED: $addr")
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                serverConns.remove(addr)
                bcastDev(ACTION_DEVICE_DISCONNECTED, addr, d.name ?: "NEXO Device")
                Log.i(TAG, "[NAP-GATT-002] Server DISCONNECTED: $addr")
            }
        }

        override fun onCharacteristicWriteRequest(device: BluetoothDevice?, requestId: Int, characteristic: BluetoothGattCharacteristic?, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            val d = device ?: return
            val addr = normalizeMacAddress(d.address)
            if (characteristic?.uuid == CHAR_MESSAGE_UUID && value != null) {
                val msg = String(value, Charsets.UTF_8)
                Log.i(TAG, "[NAP-GATT-003] Mensaje recibido de $addr: ${msg.take(50)}")
                val intent = Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, addr)
                    putExtra(EXTRA_MESSAGE, msg)
                    putExtra(EXTRA_SENDER_NAME, d.name ?: "NEXO Device")
                }
                sendBroadcast(intent)
                if (responseNeeded) btGattServer?.sendResponse(d, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }
    }

    // ===== SCAN =====
    fun startScan() {
        if (isScan) {
            Log.w(TAG, "[NAP-SCAN-001] Scan already active")
            return
        }
        val a = btAdapter ?: run { bcastScanFail(-1, "Adapter null"); return }
        if (!a.isEnabled) { bcastScanFail(-1, "Bluetooth disabled"); return }
        val freshScanner = a.bluetoothLeScanner ?: run { bcastScanFail(-2, "Scanner null"); return }

        val now = SystemClock.elapsedRealtime()
        while (scanTimes.isNotEmpty() && now - scanTimes.first() > SCAN_RATE_LIMIT) scanTimes.removeFirst()
        if (scanTimes.size >= MAX_SCAN_HISTORY) { bcastScanFail(-3, "Rate limit"); return }
        scanTimes.add(now)

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        scanResults.clear()
        isScan = true
        Log.i(TAG, "[NAP-SCAN-002] startScan() SIN hardware filter (fix Samsung)")
        try {
            // FIX v3.5.0: null en lugar de listOf(filter). Samsung S23/S24 bloquea 128-bit UUID filters.
            freshScanner.startScan(null, settings, scanCb)
            handler.postDelayed({ if (isScan) stopScan() }, SCAN_AUTO_STOP)
        } catch (e: SecurityException) {
            isScan = false
            Log.e(TAG, "[NAP-SCAN-003] SecurityException: ${e.message}")
            bcastScanFail(-4, "SecurityException: ${e.message}")
        }
    }

    fun stopScan() {
        if (!isScan) return
        isScan = false
        val a = btAdapter ?: return
        try { a.bluetoothLeScanner?.stopScan(scanCb) } catch (_: Exception) {}
        Log.i(TAG, "[NAP-SCAN-004] stopScan() - Resultados=${scanResults.size}")
        scanResults.clear()
    }

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            val r = result ?: return
            val record = r.scanRecord
            val addr = normalizeMacAddress(r.device.address)
            val devName = record?.deviceName ?: r.device.name ?: "NEXO Device"

            // Filtro por SOFTWARE (no hardware) para SERVICE_UUID
            val hasNexoUuid = record?.serviceUuids?.any { it.uuid == SERVICE_UUID } == true
            if (!hasNexoUuid) return

            // Anti-duplicado
            if (scanResults.containsKey(addr)) return
            scanResults[addr] = r

            Log.i(TAG, "[NAP-SCAN-010] onScanResult: addr=$addr name=$devName rssi=${r.rssi}")
            val intent = Intent(ACTION_DEVICE_FOUND).apply {
                putExtra(EXTRA_DEVICE_ADDRESS, addr)
                putExtra(EXTRA_DEVICE_NAME, devName)
                putExtra(EXTRA_RSSI, r.rssi)
            }
            sendBroadcast(intent)
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "[NAP-SCAN-011] onScanFailed: $errorCode")
            bcastScanFail(errorCode, "Scan failed code=$errorCode")
        }
    }

    // ===== ADVERTISING =====
    fun startAdvertising(name: String = "") {
        if (isAd) return
        val a = btAdapter ?: run { bcastAd(false, "Adapter null"); return }
        if (!a.isEnabled) { bcastAd(false, "Bluetooth disabled"); return }
        val freshAdvertiser = a.bluetoothLeAdvertiser ?: run { bcastAd(false, "Advertiser null"); return }

        if (name.isNotBlank()) userName = name

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()

        val data = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .setIncludeDeviceName(true) // CRÍTICO para Samsung
            .build()

        Log.i(TAG, "[NAP-ADVERT-001] startAdvertising() - Service UUID=$SERVICE_UUID")
        try {
            advertiseCallback = object : AdvertiseCallback() {
                override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                    isAd = true
                    Log.i(TAG, "[NAP-ADVERT-002] onStartSuccess")
                    bcastAd(true, "OK")
                }
                override fun onStartFailure(errorCode: Int) {
                    isAd = false
                    Log.e(TAG, "[NAP-ADVERT-003] onStartFailure: $errorCode")
                    bcastAd(false, "Error code=$errorCode")
                }
            }
            freshAdvertiser.startAdvertising(settings, data, advertiseCallback)
        } catch (e: SecurityException) {
            isAd = false
            Log.e(TAG, "[NAP-ADVERT-004] SecurityException: ${e.message}")
            bcastAd(false, "SecurityException")
        }
    }

    fun stopAdvertising() {
        val a = btAdapter ?: return
        try { advertiser?.stopAdvertising(advertiseCallback) } catch (_: Exception) {}
        isAd = false
        advertiser = null
        advertiseCallback = null
        Log.i(TAG, "[NAP-ADVERT-005] stopAdvertising()")
    }

    // ===== GATT CLIENT / CONNECT / SEND =====
    fun connectToDevice(address: String) {
        val a = btAdapter ?: return
        val addr = normalizeMacAddress(address)
        val remote = a.getRemoteDevice(addr) ?: return
        Log.i(TAG, "[NAP-CONN-001] connectToDevice: $addr")
        try {
            val gatt = remote.connectGatt(this, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
            if (gatt != null) gattClients[addr] = gatt
        } catch (e: SecurityException) {
            Log.e(TAG, "[NAP-CONN-002] SecurityException: ${e.message}")
        }
    }

    fun disconnectDevice(address: String) {
        val addr = normalizeMacAddress(address)
        val gatt = gattClients.remove(addr)
        try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) {}
        Log.i(TAG, "[NAP-CONN-003] disconnectDevice: $addr")
    }

    fun sendMessage(address: String, message: String) {
        val addr = normalizeMacAddress(address)
        val gatt = gattClients[addr]
        if (gatt == null) {
            val queue = messageQueue.getOrPut(addr) { LinkedList() }
            queue.add(message)
            connectToDevice(addr)
            return
        }
        val service = gatt.getService(SERVICE_UUID)
        val char = service?.getCharacteristic(CHAR_MESSAGE_UUID)
        if (char != null) {
            try {
                char.value = message.toByteArray(Charsets.UTF_8)
                gatt.writeCharacteristic(char)
                Log.i(TAG, "[NAP-SEND-001] Mensaje enviado a $addr")
            } catch (e: SecurityException) {
                Log.e(TAG, "[NAP-SEND-002] SecurityException: ${e.message}")
            }
        }
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
            val d = gatt?.device ?: return
            val addr = normalizeMacAddress(d.address)
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.i(TAG, "[NAP-GATT-010] Client CONNECTED: $addr")
                bcastDev(ACTION_DEVICE_CONNECTED, addr, d.name ?: "NEXO Device")
                gatt.discoverServices()
            } else {
                Log.i(TAG, "[NAP-GATT-011] Client DISCONNECTED: $addr")
                bcastDev(ACTION_DEVICE_DISCONNECTED, addr, d.name ?: "NEXO Device")
                gattClients.remove(addr)
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
            val d = gatt?.device ?: return
            val addr = normalizeMacAddress(d.address)
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "[NAP-GATT-012] Services discovered: $addr")
                val queue = messageQueue.remove(addr)
                queue?.forEach { msg -> sendMessage(addr, msg) }
            }
        }
    }

    // ===== UTILS =====
    fun normalizeMacAddress(address: String?): String {
        if (address == null) return ""
        val clean = address.replace(":", "").replace("-", "").uppercase()
        if (clean.length != 12) return address.uppercase().trim()
        return clean.chunked(2).joinToString(":").uppercase()
    }

    private fun bcastDev(action: String, address: String, name: String) {
        sendBroadcast(Intent(action).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, address)
            putExtra(EXTRA_DEVICE_NAME, name)
        })
    }

    private fun bcastScanFail(code: Int, desc: String) {
        sendBroadcast(Intent(ACTION_SCAN_FAILED).apply {
            putExtra("errorCode", code)
            putExtra("description", desc)
        })
    }

    private fun bcastAd(success: Boolean, msg: String) {
        sendBroadcast(Intent(if (success) ACTION_ADVERTISE_STARTED else ACTION_ADVERTISE_FAILED).apply {
            putExtra("message", msg)
        })
    }

    fun isBluetoothEnabled(): Boolean = btAdapter?.isEnabled == true
    fun getLocalDeviceInfo(): Map<String, String> {
        return mapOf(
            "deviceName" to (btAdapter?.name ?: "NEXO Device"),
            "deviceAddress" to normalizeMacAddress(btAdapter?.address ?: "")
        )
    }
}
