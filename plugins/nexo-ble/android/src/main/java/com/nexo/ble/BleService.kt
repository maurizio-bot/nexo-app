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
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelUuid
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.location.LocationManagerCompat
import java.util.ArrayDeque
import java.util.LinkedList
import java.util.Random
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * BleService v6.0-PROD
 * Basado en investigacion de fuentes oficiales:
 * - Android BLE Advertising docs (legacy 31 bytes limit)
 * - Bridgefy SDK approach (UUID persistente + scan sin filtros)
 * - BLE Advertiser 2026 (anti-throttle, foreground service connectedDevice)
 * - Punchthrough / Devsflow (Samsung quirks, serial GATT queue)
 */
class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "nexo_ble_channel"

        const val DIAGNOSTIC_MODE = true

        // UUIDs NEXO
        val SERVICE_UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6")
        val MESSAGE_CHAR_UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c7")
        val ANNOUNCE_CHAR_UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c8")
        val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        // FIX: Usar 16-bit UUID para advertising (mas pequeno, evita DATA_TOO_LARGE)
        val ADVERTISE_SERVICE_UUID_16BIT: ParcelUuid = ParcelUuid.fromString("0000FEAA-0000-1000-8000-00805f9b34fb")
        val NEXO_MAGIC_BYTES = byteArrayOf(0x4E, 0x58, 0x01, 0x00) // "NX" + version
        const val MANUFACTURER_ID_NEXO = 0xFFFF

        // Broadcast Actions
        const val ACTION_SCAN_RESULT = "com.nexo.ble.SCAN_RESULT"
        const val ACTION_SCAN_FAILED = "com.nexo.ble.SCAN_FAILED"
        const val ACTION_SCAN_STOPPED = "com.nexo.ble.SCAN_STOPPED"
        const val ACTION_ADVERT_STATE = "com.nexo.ble.ADVERT_STATE"
        const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.MESSAGE_RECEIVED"
        const val ACTION_MESSAGE_SENT = "com.nexo.ble.MESSAGE_SENT"
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.DEVICE_DISCONNECTED"
        const val ACTION_SERVICES_READY = "com.nexo.ble.SERVICES_READY"
        const val ACTION_NOTIFICATIONS_ENABLED = "com.nexo.ble.NOTIFICATIONS_ENABLED"
        const val ACTION_CONNECTION_FAILED = "com.nexo.ble.CONNECTION_FAILED"
        const val ACTION_RETRY_SCHEDULED = "com.nexo.ble.RETRY_SCHEDULED"
        const val ACTION_PEER_INFO_RECEIVED = "com.nexo.ble.PEER_INFO_RECEIVED"
        const val ACTION_CLIENT_NOTIFICATION_STATE_CHANGED = "com.nexo.ble.CLIENT_NOTIFICATION_STATE_CHANGED"
        const val ACTION_NAP_AUDIT = "com.nexo.ble.NAP_AUDIT"

        // Extras
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
        const val EXTRA_TIMESTAMP = "timestamp"
        const val EXTRA_DIRECTION = "direction"
        const val EXTRA_SOURCE = "source"
        const val EXTRA_CONTENT = "content"
        const val EXTRA_DATA = "data"
        const val EXTRA_SENDER_NAME = "sender_name"
        const val EXTRA_NAP_CODE = "nap_code"
        const val EXTRA_NAP_MESSAGE = "nap_message"
        const val EXTRA_NAP_LEVEL = "nap_level"

        // Timeouts y limites (basados en investigacion)
        const val MAX_RETRY = 3
        const val RETRY_BASE = 2000L
        const val RETRY_MAX = 16000L
        const val CONNECT_TIMEOUT = 15000L
        const val WRITE_TIMEOUT = 5000L
        const val RATE_LIMIT = 5000L
        const val SCAN_RATE_LIMIT = 30000L
        const val SCAN_AUTO_STOP = 30000L
        const val SCAN_HEALTH_TIMEOUT = 20000L
        const val MAX_SCANS_PER_WINDOW = 4 // Anti-throttle: < 5 por 30s

        fun normalizeMacAddress(addr: String): String {
            return if (addr.contains(":")) addr.uppercase()
            else addr.chunked(2).joinToString(":").uppercase()
        }
    }

    enum class ConnState { IDLE, CONNECTING, DISCOVERING, READY, DISCONNECTING, FAILED }
    data class Conn(val id: String, var gatt: BluetoothGatt? = null, var state: ConnState = ConnState.IDLE, var retry: Int = 0, var lastAttempt: Long = 0, var pendingMsgId: String? = null, var userDisc: Boolean = false)

    private val binder = LocalBinder()
    private val handler = Handler(Looper.getMainLooper())
    private var btManager: BluetoothManager? = null
    private var btAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    private var gattServer: BluetoothGattServer? = null
    private var isAd = false
    private var isScan = false
    private val scanResults = ConcurrentHashMap<String, ScanResult>()
    private val scanTimes = ArrayDeque<Long>()
    private val conns = ConcurrentHashMap<String, Conn>()
    private val serverConns = ConcurrentHashMap<String, BluetoothDevice>()
    private var userId = ""
    private var userName = "NEXO"
    private val opQueue = ConcurrentHashMap<String, LinkedList<Runnable>>()
    private val opFlags = ConcurrentHashMap<String, AtomicBoolean>()
    private var wakeLock: PowerManager.WakeLock? = null
    private var scanResultCount = 0
    private var lastScanStartTime = 0L
    private var lastScanResultTime = 0L
    private var advertisingRetryCount = 0
    private var isUsingExtendedAdvertising = false

    inner class LocalBinder : Binder() { fun getService(): BleService = this@BleService }
    override fun onBind(i: Intent?): IBinder = binder

    private fun napAudit(code: String, message: String, level: String = "INFO") {
        Log.i(TAG, "[$code] $message")
        sendLocalBroadcast(Intent(ACTION_NAP_AUDIT).apply {
            putExtra(EXTRA_NAP_CODE, code)
            putExtra(EXTRA_NAP_MESSAGE, message)
            putExtra(EXTRA_NAP_LEVEL, level)
            putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
        })
    }

    override fun onCreate() {
        super.onCreate()
        napAudit("PROD-001", "=== BleService v6.0-PROD ===", "INFO")
        btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        btAdapter = btManager?.adapter
        napAudit("PROD-002", "Adapter=${btAdapter != null}, enabled=${btAdapter?.isEnabled}", "INFO")

        val prefs = getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
        val savedId = prefs.getString("device_uuid", null)
        if (!savedId.isNullOrBlank()) { userId = savedId }

        createChannel()
        startFgImmediate()
        try { initGattServer(); napAudit("PROD-003", "GATT Server OK", "SUCCESS") } 
        catch (e: Exception) { napAudit("PROD-004", "GATT error: ${e.message}", "ERROR") }

        acquireWakeLock()
        checkLocationServices()
        checkBatteryOptimization()
        napAudit("PROD-005", "onCreate() completado", "INFO")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        napAudit("PROD-006", "onStartCommand() startId=$startId", "INFO")
        startFgImmediate()
        return START_STICKY
    }

    override fun onDestroy() {
        napAudit("PROD-008", "onDestroy() INICIO", "INFO")
        releaseWakeLock()
        stopScan(); stopAdvertising(); cleanup(); gattServer?.close(); super.onDestroy()
        napAudit("PROD-009", "onDestroy() FIN", "INFO")
    }

    // ====== FOREGROUND SERVICE (Android 15+ requiere CONNECTED_DEVICE) ======
    private fun startFgImmediate() {
        try {
            val n = buildNotif("NEXO BLE activo - v6.0-PROD")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
                napAudit("PROD-FG-001", "startForeground(3 params, CONNECTED_DEVICE) API 34+", "SUCCESS")
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
                napAudit("PROD-FG-002", "startForeground(3 params, CONNECTED_DEVICE) API 29+", "SUCCESS")
            } else {
                startForeground(NOTIFICATION_ID, n)
                napAudit("PROD-FG-003", "startForeground(2 params) legacy", "SUCCESS")
            }
        } catch (e: Exception) {
            napAudit("PROD-FG-ERR", "startForeground FAILED: ${e.message}", "ERROR")
        }
    }

    private fun buildNotif(c: String): Notification {
        val pi = PendingIntent.getActivity(this, 0, packageManager.getLaunchIntentForPackage(packageName), 
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO Mesh")
            .setContentText(c)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "NEXO BLE", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    // ====== WAKE LOCK (30 min para evitar kill por Samsung) ======
    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NexoBle::WakeLock")
                wakeLock?.setReferenceCounted(false)
                wakeLock?.acquire(30 * 60 * 1000L)
                napAudit("PROD-WL-001", "WakeLock adquirido (30min)", "SUCCESS")
            }
        } catch (e: Exception) {
            napAudit("PROD-WL-ERR", "WakeLock error: ${e.message}", "ERROR")
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (e: Exception) {}
    }

    // ====== LOCATION & BATTERY CHECKS ======
    private fun checkLocationServices() {
        val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        val enabled = lm != null && LocationManagerCompat.isLocationEnabled(lm)
        napAudit("PROD-LOC-001", "Location services enabled=$enabled", if (enabled) "SUCCESS" else "WARN")
        if (!enabled) sendLocalBroadcast(Intent("com.nexo.ble.LOCATION_DISABLED"))
    }

    private fun checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            val exempt = pm?.isIgnoringBatteryOptimizations(packageName) == true
            napAudit("PROD-BATT-001", "Battery optimization exempt=$exempt", if (exempt) "SUCCESS" else "WARN")
            if (!exempt) sendLocalBroadcast(Intent("com.nexo.ble.BATTERY_NOT_EXEMPT"))
        }
    }

    // ====== GATT SERVER ======
    private fun initGattServer() {
        gattServer = btManager?.openGattServer(this, gattSrvCb)
        val svc = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val msgChar = BluetoothGattCharacteristic(MESSAGE_CHAR_UUID, 
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY, 
            BluetoothGattCharacteristic.PERMISSION_WRITE)
        msgChar.addDescriptor(BluetoothGattDescriptor(CCCD_UUID, 
            BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ))
        svc.addCharacteristic(msgChar)
        val annChar = BluetoothGattCharacteristic(ANNOUNCE_CHAR_UUID, 
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY, 
            BluetoothGattCharacteristic.PERMISSION_READ)
        svc.addCharacteristic(annChar)
        gattServer?.addService(svc)
    }

    private val gattSrvCb = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(d: BluetoothDevice?, s: Int, ns: Int) {
            when (ns) {
                BluetoothProfile.STATE_CONNECTED -> d?.address?.let { 
                    serverConns[it] = d; bcastDev(ACTION_DEVICE_CONNECTED, d, "incoming") 
                }
                BluetoothProfile.STATE_DISCONNECTED -> d?.address?.let { 
                    serverConns.remove(it); bcastDev(ACTION_DEVICE_DISCONNECTED, d) 
                }
            }
        }
        override fun onCharacteristicReadRequest(d: BluetoothDevice, rId: Int, o: Int, c: BluetoothGattCharacteristic) {
            try {
                val v = if (c.uuid == ANNOUNCE_CHAR_UUID) {
                    org.json.JSONObject().apply { 
                        put("userId", userId); put("userName", userName); put("ts", System.currentTimeMillis()) 
                    }.toString().toByteArray()
                } else byteArrayOf()
                gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, 0, v)
            } catch (e: SecurityException) {}
        }
        override fun onCharacteristicWriteRequest(d: BluetoothDevice?, rId: Int, c: BluetoothGattCharacteristic?, 
            pW: Boolean, rN: Boolean, o: Int, v: ByteArray?) {
            if (c?.uuid == MESSAGE_CHAR_UUID && v != null) {
                val msg = String(v, Charsets.UTF_8)
                var sn = "NEXO Peer"; var ct = msg; var mid = ""
                try { 
                    val j = org.json.JSONObject(msg); 
                    sn = j.optString("senderName", sn); ct = j.optString("content", ct); mid = j.optString("messageId", mid) 
                } catch (e: Exception) {}
                sendLocalBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply { 
                    putExtra(EXTRA_DEVICE_ADDRESS, d?.address); putExtra(EXTRA_DEVICE_NAME, d?.name ?: "Unknown")
                    putExtra(EXTRA_MESSAGE, msg); putExtra(EXTRA_CONTENT, ct); putExtra(EXTRA_SENDER_NAME, sn)
                    putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SOURCE, "server_write_request")
                    putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) 
                })
                if (rN) gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, o, null)
            }
        }
        override fun onDescriptorWriteRequest(d: BluetoothDevice, rId: Int, desc: BluetoothGattDescriptor, 
            pW: Boolean, rN: Boolean, o: Int, v: ByteArray?) {
            try {
                if (rN) gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, 0, null)
                if (desc.uuid == CCCD_UUID) {
                    val enabled = v != null && v.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    sendLocalBroadcast(Intent(ACTION_CLIENT_NOTIFICATION_STATE_CHANGED).apply { 
                        putExtra(EXTRA_DEVICE_ADDRESS, d.address); putExtra(EXTRA_ENABLED, enabled) 
                    })
                }
            } catch (e: SecurityException) {}
        }
    }

    // ====== CONNECTION MANAGEMENT (Serial queue - Devsflow) ======
    fun connectToDevice(addr: String): Boolean {
        val normalizedAddr = normalizeMacAddress(addr)
        val a = btAdapter ?: return false
        val dev = try { a.getRemoteDevice(normalizedAddr) } catch (e: IllegalArgumentException) { return false }
        val cn = conns.getOrPut(normalizedAddr) { Conn(normalizedAddr) }
        if (cn.state == ConnState.READY || cn.state == ConnState.CONNECTING) return true
        enqueue(normalizedAddr) { execConnect(dev, normalizedAddr) }
        return true
    }

    private fun enqueue(id: String, op: Runnable) {
        val q = opQueue.getOrPut(id) { LinkedList() }
        synchronized(q) { q.add(op) }
        processNext(id)
    }

    private fun processNext(id: String) {
        val f = opFlags.getOrPut(id) { AtomicBoolean(false) }
        if (f.getAndSet(true)) return
        val q = opQueue[id] ?: return
        val n = synchronized(q) { q.pollFirst() }
        if (n == null) { f.set(false); return }
        handler.post { try { n.run() } finally { f.set(false); processNext(id) } }
    }

    private fun execConnect(dev: BluetoothDevice, id: String) {
        val cn = conns.getOrPut(id) { Conn(id) }
        val now = System.currentTimeMillis()
        if (now - cn.lastAttempt < RATE_LIMIT && cn.retry > 0) { 
            handler.postDelayed({ execConnect(dev, id) }, RATE_LIMIT - (now - cn.lastAttempt)); return 
        }
        cn.state = ConnState.CONNECTING; cn.lastAttempt = now; cn.userDisc = false
        cn.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }; cn.gatt = null
        val g = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) 
            dev.connectGatt(this, false, gattCb, BluetoothDevice.TRANSPORT_LE) 
        else dev.connectGatt(this, false, gattCb)
        cn.gatt = g
        handler.postDelayed({ if (conns[id]?.state == ConnState.CONNECTING) failConn(id, "Timeout") }, CONNECT_TIMEOUT)
    }

    fun disconnectDevice(addr: String) {
        val normalizedAddr = normalizeMacAddress(addr)
        conns[normalizedAddr]?.let { 
            it.userDisc = true; it.state = ConnState.DISCONNECTING
            it.gatt?.let { g -> try { g.disconnect() } catch (e: Exception) {} } 
        }
        serverConns.remove(normalizedAddr)
    }

    fun sendMessage(addr: String, msg: String): Boolean {
        val normalizedAddr = normalizeMacAddress(addr)
        val cn = conns[normalizedAddr] ?: return false
        if (cn.state != ConnState.READY) return false
        val mid = UUID.randomUUID().toString()
        val payload = try { 
            org.json.JSONObject().apply { 
                put("messageId", mid); put("timestamp", System.currentTimeMillis())
                put("senderId", userId); put("senderName", userName); put("content", msg) 
            }.toString().toByteArray(Charsets.UTF_8) 
        } catch (e: Exception) { msg.toByteArray(Charsets.UTF_8) }
        doWrite(normalizedAddr, payload, mid)
        return true
    }

    private fun doWrite(id: String, payload: ByteArray, mid: String) {
        val cn = conns[id] ?: return
        val g = cn.gatt ?: return
        try {
            val ch = g.getService(SERVICE_UUID)?.getCharacteristic(MESSAGE_CHAR_UUID) ?: return
            cn.pendingMsgId = mid
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) 
                g.writeCharacteristic(ch, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
            else { 
                @Suppress("DEPRECATION") ch.value = payload; @Suppress("DEPRECATION") g.writeCharacteristic(ch) 
            }
            handler.postDelayed({ if (cn.pendingMsgId == mid) { cn.pendingMsgId = null; bcastSent(id, mid, false) } }, WRITE_TIMEOUT)
        } catch (e: Exception) { bcastSent(id, mid, false) }
    }

    private val gattCb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, s: Int, ns: Int) {
            val a = g.device.address
            val cn = conns[a] ?: return
            if (ns == BluetoothProfile.STATE_CONNECTED) {
                if (cn.state == ConnState.CONNECTING) { 
                    cn.state = ConnState.DISCOVERING
                    bcastDev(ACTION_DEVICE_CONNECTED, g.device, "outgoing", cn.retry)
                    handler.postDelayed({ try { g.discoverServices() } catch (e: Exception) {} }, 800)
                }
            } else if (ns == BluetoothProfile.STATE_DISCONNECTED) {
                val wr = cn.state == ConnState.READY; cn.state = ConnState.IDLE; cn.gatt = null
                try { g.close() } catch (e: Exception) {}
                bcastDev(ACTION_DEVICE_DISCONNECTED, g.device, wasReady = wr)
                if (!cn.userDisc && cn.retry < MAX_RETRY) schedRetry(a)
                else if (cn.retry >= MAX_RETRY) { cn.state = ConnState.FAILED; bcastFail(a, "Max retries", cn.retry) }
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, s: Int) {
            if (s != BluetoothGatt.GATT_SUCCESS) { failConn(g.device.address, "Discovery failed"); return }
            val ch = g.getService(SERVICE_UUID)?.getCharacteristic(MESSAGE_CHAR_UUID)
            if (ch == null) { failConn(g.device.address, "Service not found"); return }
            try {
                g.setCharacteristicNotification(ch, true)
                val d = ch.getDescriptor(CCCD_UUID)
                if (d != null) { 
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) 
                        g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    else { 
                        @Suppress("DEPRECATION") d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        @Suppress("DEPRECATION") g.writeDescriptor(d) 
                    }
                } else markReady(g.device.address, g)
            } catch (e: SecurityException) { failConn(g.device.address, "SecurityException") }
        }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, s: Int) {
            if (d.uuid == CCCD_UUID && s == BluetoothGatt.GATT_SUCCESS) {
                sendLocalBroadcast(Intent(ACTION_NOTIFICATIONS_ENABLED).apply { 
                    putExtra(EXTRA_DEVICE_ADDRESS, g.device.address); putExtra(EXTRA_ENABLED, true) 
                })
                markReady(g.device.address, g)
                val announceChar = g.getService(SERVICE_UUID)?.getCharacteristic(ANNOUNCE_CHAR_UUID)
                if (announceChar != null) { try { g.readCharacteristic(announceChar) } catch (e: SecurityException) {} }
            } else if (s != BluetoothGatt.GATT_SUCCESS) { failConn(g.device.address, "Descriptor failed") }
        }
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, s: Int) {
            if (c.uuid == ANNOUNCE_CHAR_UUID && s == BluetoothGatt.GATT_SUCCESS) {
                val value = c.value ?: return
                try {
                    val json = org.json.JSONObject(String(value, Charsets.UTF_8))
                    val peerUserId = json.optString("userId", "")
                    val peerUserName = json.optString("userName", g.device.name ?: "NEXO Peer")
                    if (peerUserId.isNotBlank()) {
                        sendLocalBroadcast(Intent(ACTION_PEER_INFO_RECEIVED).apply {
                            putExtra(EXTRA_DEVICE_ADDRESS, g.device.address)
                            putExtra(EXTRA_USER_ID, peerUserId)
                            putExtra(EXTRA_USER_NAME, peerUserName)
                            putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                        })
                    }
                } catch (e: Exception) {}
            }
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (c.uuid == MESSAGE_CHAR_UUID) {
                val msg = String(c.value ?: byteArrayOf(), Charsets.UTF_8)
                var sn = "NEXO Peer"; var ct = msg; var mid = ""
                try { 
                    val j = org.json.JSONObject(msg); 
                    sn = j.optString("senderName", sn); ct = j.optString("content", ct); mid = j.optString("messageId", mid) 
                } catch (e: Exception) {}
                sendLocalBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply { 
                    putExtra(EXTRA_DEVICE_ADDRESS, g.device.address); putExtra(EXTRA_DEVICE_NAME, g.device.name ?: "Unknown")
                    putExtra(EXTRA_MESSAGE, msg); putExtra(EXTRA_CONTENT, ct); putExtra(EXTRA_SENDER_NAME, sn)
                    putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SOURCE, "client_notification")
                    putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) 
                })
            }
        }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, s: Int) {
            val a = g.device.address
            val mid = conns[a]?.pendingMsgId ?: ""
            conns[a]?.pendingMsgId = null
            bcastSent(a, mid, s == BluetoothGatt.GATT_SUCCESS)
        }
    }

    private fun schedRetry(a: String) {
        val cn = conns[a] ?: return
        if (cn.userDisc) return
        val now = System.currentTimeMillis()
        if (now - cn.lastAttempt < RATE_LIMIT) { 
            handler.postDelayed({ schedRetry(a) }, RATE_LIMIT - (now - cn.lastAttempt)); return 
        }
        cn.retry++; cn.lastAttempt = now
        val delay = minOf(RETRY_BASE * (1 shl (cn.retry - 1)), RETRY_MAX) + Random().nextInt(1000)
        bcastRetry(a, delay, cn.retry)
        handler.postDelayed({ btAdapter?.getRemoteDevice(a)?.let { if (conns[a]?.state == ConnState.IDLE) execConnect(it, a) } }, delay)
    }

    private fun markReady(a: String, g: BluetoothGatt) {
        val cn = conns[a] ?: return
        cn.state = ConnState.READY; cn.retry = 0; cn.gatt = g
        sendLocalBroadcast(Intent(ACTION_SERVICES_READY).apply { 
            putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_SUCCESS, true) 
        })
    }

    private fun failConn(a: String, r: String) {
        conns[a]?.let { it.state = ConnState.IDLE; it.gatt?.close(); it.gatt = null }
        bcastFail(a, r, conns[a]?.retry ?: 0)
    }

    // ====== SCAN CON ANTI-THROTTLE Y SIN FILTROS HARDWARE ======
    fun startScan() {
        if (isScan) {
            napAudit("PROD-SCAN-001", "Scan ya activo ($scanResultCount resultados), re-emitiendo cached", "WARN")
            emitCachedResults()
            return
        }

        val a = btAdapter ?: run { 
            napAudit("PROD-SCAN-002", "Adapter null", "ERROR")
            bcastScanFail(-1, "Adapter null"); return 
        }

        // FIX: Re-obtener scanner cada vez (Samsung invalida instancias)
        scanner = a.bluetoothLeScanner
        if (scanner == null) { 
            napAudit("PROD-SCAN-003", "Scanner null - reintentando en 2s", "WARN")
            handler.postDelayed({ startScan() }, 2000)
            return 
        }

        // Anti-throttle: max 4 scans por ventana de 30s
        val now = SystemClock.elapsedRealtime()
        while (scanTimes.isNotEmpty() && now - scanTimes.first() > SCAN_RATE_LIMIT) scanTimes.removeFirst()
        if (scanTimes.size >= MAX_SCANS_PER_WINDOW) {
            napAudit("PROD-SCAN-004", "Rate limit activo (${scanTimes.size}/$MAX_SCANS_PER_WINDOW), esperando...", "WARN")
            bcastScanFail(-3, "Rate limit - espera ${SCAN_RATE_LIMIT/1000}s")
            return
        }
        scanTimes.addLast(now)
        lastScanStartTime = now
        lastScanResultTime = now
        scanResultCount = 0

        scanResults.clear(); isScan = true
        napAudit("PROD-SCAN-005", "startScan() SIN filtros hardware - modo agresivo", "INFO")

        acquireWakeLock()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
            .setReportDelay(0L)
            .build()

        try {
            scanner?.startScan(null, settings, scanCb)
            handler.postDelayed({ checkScanHealth() }, SCAN_HEALTH_TIMEOUT)
            handler.postDelayed({ if (isScan) { napAudit("PROD-SCAN-006", "Auto-stop scan tras ${SCAN_AUTO_STOP/1000}s", "INFO"); stopScan() } }, SCAN_AUTO_STOP)
        } catch (e: SecurityException) {
            isScan = false
            napAudit("PROD-SCAN-007", "SecurityException: ${e.message}", "ERROR")
            bcastScanFail(-4, "SecurityException")
        }
    }

    private fun checkScanHealth() {
        if (!isScan) return
        val elapsed = SystemClock.elapsedRealtime() - lastScanResultTime
        if (scanResultCount == 0) {
            napAudit("PROD-SCAN-HEALTH", "ZERO resultados en ${elapsed}ms - reiniciando SCAN suave", "WARN")
            val wasScanning = isScan
            stopScan()
            if (wasScanning) handler.postDelayed({ startScan() }, 1500)
        } else {
            napAudit("PROD-SCAN-HEALTH", "Scan saludable: $scanResultCount dispositivos", "SUCCESS")
        }
    }

    fun stopScan() {
        if (isScan) {
            try { scanner?.stopScan(scanCb) } catch (e: Exception) {}
            isScan = false
            scanResults.clear()
            releaseWakeLock()
            napAudit("PROD-SCAN-008", "stopScan() ejecutado. Total: $scanResultCount", "INFO")
            sendLocalBroadcast(Intent(ACTION_SCAN_STOPPED).apply { putExtra("result_count", scanResultCount) })
        }
    }

    private fun emitCachedResults() {
        scanResults.forEach { (addr, result) ->
            val devName = try { result.device.name ?: result.scanRecord?.deviceName ?: "" } catch (e: SecurityException) { "" }
            val displayName = devName.ifBlank { "NEXO Device" }
            val isNexo = isNexoDevice(result)
            val extractedUserId = extractUserIdFromScan(result)
            sendLocalBroadcast(Intent(ACTION_SCAN_RESULT).apply {
                putExtra(EXTRA_DEVICE_ADDRESS, addr)
                putExtra(EXTRA_RSSI, result.rssi)
                putExtra(EXTRA_DEVICE_NAME, displayName)
                putExtra("isNexo", isNexo)
                putExtra(EXTRA_USER_ID, extractedUserId)
            })
        }
    }

    private fun isNexoDevice(result: ScanResult): Boolean {
        val record = result.scanRecord ?: return false
        val hasServiceUuid16 = record.serviceUuids?.any { it == ADVERTISE_SERVICE_UUID_16BIT } == true
        val mfrData = record.getManufacturerSpecificData(MANUFACTURER_ID_NEXO)
        val hasNexoMagic = mfrData != null && mfrData.size >= 4 &&
                mfrData[0] == NEXO_MAGIC_BYTES[0] && mfrData[1] == NEXO_MAGIC_BYTES[1] &&
                mfrData[2] == NEXO_MAGIC_BYTES[2] && mfrData[3] == NEXO_MAGIC_BYTES[3]
        return hasServiceUuid16 || hasNexoMagic
    }

    private fun extractUserIdFromScan(result: ScanResult): String {
        val mfrData = result.scanRecord?.getManufacturerSpecificData(MANUFACTURER_ID_NEXO)
        return if (mfrData != null && mfrData.size > 4) {
            try { String(mfrData.copyOfRange(4, mfrData.size), Charsets.UTF_8) } catch (e: Exception) { "" }
        } else ""
    }

    private val scanCb = object : ScanCallback() {
        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            napAudit("PROD-SCAN-009", "onBatchScanResults: ${results?.size ?: 0} items", "INFO")
            results?.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
        }

        override fun onScanResult(ct: Int, r: ScanResult?) {
            r?.let {
                scanResultCount++
                lastScanResultTime = SystemClock.elapsedRealtime()

                val addr = try { it.device.address } catch (e: SecurityException) { return }
                val devName = try { it.device.name } catch (e: SecurityException) { null } ?: it.scanRecord?.deviceName ?: ""

                val record = it.scanRecord
                val isNexoDevice = isNexoDevice(it)
                val extractedUserId = extractUserIdFromScan(it)
                val hasServiceUuid16 = record?.serviceUuids?.any { u -> u == ADVERTISE_SERVICE_UUID_16BIT } == true
                val mfrData = record?.getManufacturerSpecificData(MANUFACTURER_ID_NEXO)
                val hasNexoMagic = mfrData != null && mfrData.size >= 4 &&
                        mfrData[0] == NEXO_MAGIC_BYTES[0] && mfrData[1] == NEXO_MAGIC_BYTES[1]

                if (DIAGNOSTIC_MODE) {
                    val hex = mfrData?.joinToString("") { "%02X".format(it) } ?: "null"
                    napAudit("PROD-SCAN-DIAG", "addr=${addr.take(8)} name='$devName' rssi=${it.rssi} uuid16=$hasServiceUuid16 magic=$hasNexoMagic hex=$hex uid=${extractedUserId.take(8)}", 
                        if (isNexoDevice) "SUCCESS" else "INFO")

                    val displayName = if (isNexoDevice) "NEXO $devName".trim() else (devName.ifBlank { "Unknown" })
                    val shouldUpdate = scanResults[addr] == null || it.rssi > (scanResults[addr]?.rssi ?: -999)
                    if (shouldUpdate) scanResults[addr] = it

                    sendLocalBroadcast(Intent(ACTION_SCAN_RESULT).apply {
                        putExtra(EXTRA_DEVICE_ADDRESS, addr)
                        putExtra(EXTRA_DEVICE_NAME, displayName.ifBlank { "NEXO Device" })
                        putExtra(EXTRA_RSSI, it.rssi)
                        putExtra("isNexo", isNexoDevice)
                        putExtra(EXTRA_USER_ID, extractedUserId)
                    })
                } else {
                    if (!isNexoDevice) return
                    val displayName = devName.ifBlank { "NEXO Device" }
                    val shouldUpdate = scanResults[addr] == null || it.rssi > (scanResults[addr]?.rssi ?: -999)
                    if (shouldUpdate) scanResults[addr] = it
                    sendLocalBroadcast(Intent(ACTION_SCAN_RESULT).apply {
                        putExtra(EXTRA_DEVICE_ADDRESS, addr)
                        putExtra(EXTRA_DEVICE_NAME, displayName)
                        putExtra(EXTRA_RSSI, it.rssi)
                        putExtra("isNexo", true)
                        putExtra(EXTRA_USER_ID, extractedUserId)
                    })
                }
            }
        }

        override fun onScanFailed(ec: Int) {
            isScan = false
            val err = when(ec) {
                ScanCallback.SCAN_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "REG_FAILED"
                ScanCallback.SCAN_FAILED_INTERNAL_ERROR -> "INTERNAL"
                ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED -> "UNSUPPORTED"
                ScanCallback.SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "NO_RESOURCES"
                ScanCallback.SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "TOO_FREQUENT"
                else -> "UNKNOWN($ec)"
            }
            napAudit("PROD-SCAN-011", "onScanFailed: $err (code=$ec)", "ERROR")
            bcastScanFail(ec, err)
            if (ec == ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED || ec == ScanCallback.SCAN_FAILED_INTERNAL_ERROR) {
                napAudit("PROD-SCAN-012", "Error grave, reiniciando scan en 5s", "WARN")
                handler.postDelayed({ startScan() }, 5000)
            }
        }
    }

    // ====== ADVERTISING CON EXTENDED ADVERTISING (EVITA DATA_TOO_LARGE) ======
    fun startAdvertising(name: String = "") {
        if (isAd) { 
            napAudit("PROD-ADVERT-001", "Already advertising", "WARN")
            bcastAd(true); return 
        }
        val adapter = btAdapter ?: run { 
            napAudit("PROD-ADVERT-002", "Adapter null", "ERROR")
            bcastAd(false, "Adapter null"); return 
        }
        if (!adapter.isEnabled) { 
            napAudit("PROD-ADVERT-003", "Bluetooth disabled", "ERROR")
            bcastAd(false, "Bluetooth disabled"); return 
        }

        if (name.isNotBlank()) { this.userName = name }
        advertisingRetryCount = 0

        // Intentar Extended Advertising primero (BLE 5.0+, sin limite 31 bytes)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && adapter.isLeExtendedAdvertisingSupported) {
            napAudit("PROD-ADVERT-004", "Extended Advertising soportado, usando AdvertisingSet", "INFO")
            startExtendedAdvertising()
        } else {
            napAudit("PROD-ADVERT-005", "Extended Advertising NO soportado, usando legacy", "INFO")
            startLegacyAdvertising()
        }
    }

    private fun startExtendedAdvertising() {
        val adapter = btAdapter ?: return
        val freshAdvertiser = adapter.bluetoothLeAdvertiser ?: run {
            napAudit("PROD-ADVERT-006", "Advertiser null", "ERROR")
            bcastAd(false, "Advertiser null"); return
        }
        this.advertiser = freshAdvertiser
        isUsingExtendedAdvertising = true

        val params = AdvertisingSetParameters.Builder()
            .setLegacyMode(false) // Extended advertising
            .setConnectable(true)
            .setScannable(true)
            .setInterval(AdvertisingSetParameters.INTERVAL_LOW)
            .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
            .setPrimaryPhy(BluetoothDevice.PHY_LE_1M)
            .build()

        val shortUserId = userId.take(16).toByteArray(Charsets.UTF_8)
        val manufacturerPayload = NEXO_MAGIC_BYTES + shortUserId

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true) // OK en extended (hasta 1650 bytes)
            .addServiceUuid(ADVERTISE_SERVICE_UUID_16BIT)
            .addManufacturerData(MANUFACTURER_ID_NEXO, manufacturerPayload)
            .build()

        napAudit("PROD-ADVERT-007", "startExtendedAdvertising()", "INFO")

        try {
            freshAdvertiser.startAdvertisingSet(params, data, null, null, null, 0, 0, extAdCb)
        } catch (e: SecurityException) {
            isAd = false; isUsingExtendedAdvertising = false
            napAudit("PROD-ADVERT-008", "SecurityException extended: ${e.message}", "ERROR")
            bcastAd(false, "SecurityException")
        } catch (e: Exception) {
            isAd = false; isUsingExtendedAdvertising = false
            napAudit("PROD-ADVERT-009", "Extended failed: ${e.message}, fallback a legacy", "WARN")
            startLegacyAdvertising()
        }
    }

    private fun startLegacyAdvertising() {
        val adapter = btAdapter ?: return
        val freshAdvertiser = adapter.bluetoothLeAdvertiser ?: run {
            napAudit("PROD-ADVERT-010", "Advertiser null (legacy)", "ERROR")
            bcastAd(false, "Advertiser null"); return
        }
        this.advertiser = freshAdvertiser
        isUsingExtendedAdvertising = false

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build()

        val shortUserId = userId.take(8).toByteArray(Charsets.UTF_8)
        val manufacturerPayload = NEXO_MAGIC_BYTES + shortUserId

        // FIX legacy: NO incluir device name (ahorra bytes, evita DATA_TOO_LARGE)
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ADVERTISE_SERVICE_UUID_16BIT)
            .addManufacturerData(MANUFACTURER_ID_NEXO, manufacturerPayload)
            .build()

        napAudit("PROD-ADVERT-011", "startLegacyAdvertising() sin device name", "INFO")

        try {
            freshAdvertiser.startAdvertising(settings, data, legacyAdCb)
        } catch (e: SecurityException) {
            isAd = false
            napAudit("PROD-ADVERT-012", "SecurityException legacy: ${e.message}", "ERROR")
            bcastAd(false, "SecurityException")
        } catch (e: Exception) {
            isAd = false
            napAudit("PROD-ADVERT-013", "Legacy failed: ${e.message}", "ERROR")
            bcastAd(false, e.message ?: "Unknown")
        }
    }

    fun stopAdvertising() {
        if (isUsingExtendedAdvertising) {
            val adv = advertiser
            if (adv != null && isAd) {
                try { adv.stopAdvertisingSet(extAdCb) } catch (e: Exception) {}
            }
        } else {
            val adv = advertiser
            if (adv != null && isAd) {
                try { adv.stopAdvertising(legacyAdCb) } catch (e: Exception) {}
            }
        }
        isAd = false; advertiser = null
        bcastAd(false)
        napAudit("PROD-ADVERT-014", "stopAdvertising() ejecutado", "INFO")
    }

    // Extended Advertising Callback
    private val extAdCb = object : AdvertisingSetCallback() {
        override fun onAdvertisingSetStarted(advertisingSet: AdvertisingSet?, txPower: Int, status: Int) {
            if (status == ADVERTISE_SUCCESS) {
                isAd = true
                napAudit("PROD-ADVERT-015", "Extended onAdvertisingSetStarted SUCCESS", "SUCCESS")
                bcastAd(true)
            } else {
                isAd = false; isUsingExtendedAdvertising = false
                napAudit("PROD-ADVERT-016", "Extended onAdvertisingSetStarted FAILED status=$status", "ERROR")
                bcastAd(false, "Extended status=$status")
                // Fallback a legacy
                handler.postDelayed({ startLegacyAdvertising() }, 500)
            }
        }
        override fun onAdvertisingSetStopped(advertisingSet: AdvertisingSet?) {
            isAd = false
            napAudit("PROD-ADVERT-017", "Extended onAdvertisingSetStopped", "INFO")
        }
        override fun onAdvertisingDataSet(advertisingSet: AdvertisingSet?, status: Int) {
            napAudit("PROD-ADVERT-018", "Extended onAdvertisingDataSet status=$status", if (status == 0) "SUCCESS" else "ERROR")
        }
    }

    // Legacy Advertising Callback
    private val legacyAdCb = object : AdvertiseCallback() {
        override fun onStartSuccess(s: AdvertiseSettings?) {
            isAd = true
            napAudit("PROD-ADVERT-019", "Legacy onStartSuccess", "SUCCESS")
            bcastAd(true)
        }
        override fun onStartFailure(ec: Int) {
            isAd = false
            val err = when(ec) {
                AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
                AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE"
                else -> "UNKNOWN($ec)"
            }
            napAudit("PROD-ADVERT-020", "Legacy onStartFailure: $err (code=$ec)", "ERROR")
            bcastAd(false, err)
        }
    }

    fun setUserInfo(uid: String, uname: String) {
        this.userId = uid
        this.userName = uname.ifBlank { "NEXO" }
        getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
            .edit().putString("device_uuid", uid).apply()
        napAudit("PROD-USER-001", "setUserInfo: uid=${uid.take(8)} name=$userName", "INFO")
    }

    fun isBluetoothEnabled() = btAdapter?.isEnabled == true
    fun isScanning() = isScan
    fun isAdvertising() = isAd
    fun getScanResultCount() = scanResults.size
    fun getConnectedDevices(): List<Map<String, String>> {
        val list = mutableListOf<Map<String, String>>()
        conns.forEach { (id, c) -> 
            if (c.state == ConnState.READY) list.add(mapOf("deviceId" to id, "address" to id, 
                "name" to (c.gatt?.device?.name ?: "NEXO Peer"), "direction" to "outgoing", "servicesReady" to "true")) 
        }
        serverConns.forEach { (id, d) -> 
            try { list.add(mapOf("deviceId" to id, "address" to id, 
                "name" to (d.name ?: "NEXO Peer"), "direction" to "incoming", "servicesReady" to "true")) } 
            catch (e: SecurityException) {} 
        }
        return list
    }

    private fun sendLocalBroadcast(intent: Intent) {
        intent.setPackage(packageName)
        sendBroadcast(intent)
    }

    private fun bcastScanFail(c: Int, d: String) { 
        sendLocalBroadcast(Intent(ACTION_SCAN_FAILED).apply { 
            putExtra(EXTRA_ERROR_CODE, c); putExtra(EXTRA_ERROR_DESC, d) 
        }) 
    }
    private fun bcastAd(v: Boolean, reason: String = "") { 
        sendLocalBroadcast(Intent(ACTION_ADVERT_STATE).apply { 
            putExtra(EXTRA_ADVERTISING, v); if (reason.isNotEmpty()) putExtra(EXTRA_REASON, reason) 
        }) 
    }
    private fun bcastDev(a: String, d: BluetoothDevice?, dir: String = "", att: Int = 0, wasReady: Boolean = false) { 
        sendLocalBroadcast(Intent(a).apply { 
            putExtra(EXTRA_DEVICE_ADDRESS, d?.address); putExtra(EXTRA_DEVICE_NAME, d?.name ?: "Unknown")
            putExtra(EXTRA_DIRECTION, dir); putExtra(EXTRA_ATTEMPT, att); putExtra("wasReady", wasReady) 
        }) 
    }
    private fun bcastFail(a: String, r: String, att: Int) { 
        sendLocalBroadcast(Intent(ACTION_CONNECTION_FAILED).apply { 
            putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_REASON, r); putExtra(EXTRA_ATTEMPT, att)
            putExtra(EXTRA_MAX_ATTEMPTS, MAX_RETRY) 
        }) 
    }
    private fun bcastRetry(a: String, delay: Long, att: Int) { 
        sendLocalBroadcast(Intent(ACTION_RETRY_SCHEDULED).apply { 
            putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_DELAY_MS, delay); putExtra(EXTRA_ATTEMPT, att) 
        }) 
    }
    private fun bcastSent(a: String, mid: String, ok: Boolean) { 
        sendLocalBroadcast(Intent(ACTION_MESSAGE_SENT).apply { 
            putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SUCCESS, ok) 
        }) 
    }
    private fun cleanup() { 
        conns.forEach { (_, c) -> 
            c.userDisc = true; c.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }
            c.gatt = null; c.state = ConnState.IDLE 
        }
        serverConns.clear(); gattServer?.close(); gattServer = null 
    }
}
