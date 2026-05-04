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
import java.util.ArrayDeque
import java.util.LinkedList
import java.util.Random
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "nexo_ble_channel"

        val SERVICE_UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6")
        val MESSAGE_CHAR_UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c7")
        val ANNOUNCE_CHAR_UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c8")
        val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

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

        const val MAX_RETRY = 3
        const val RETRY_BASE = 2000L
        const val RETRY_MAX = 16000L
        const val CONNECT_TIMEOUT = 15000L
        const val WRITE_TIMEOUT = 5000L
        const val RATE_LIMIT = 5000L
        const val SCAN_RATE_LIMIT = 30000L
        const val SCAN_AUTO_STOP = 15000L
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
    private var userName = "NEXO User"
    private val opQueue = ConcurrentHashMap<String, LinkedList<Runnable>>()
    private val opFlags = ConcurrentHashMap<String, AtomicBoolean>()

    inner class LocalBinder : Binder() { fun getService(): BleService = this@BleService }
    override fun onBind(i: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        try {
            napLog("REM-SVC-001", "onCreate() — INICIO", "INFO")
            btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            btAdapter = btManager?.adapter
            napLog("REM-SVC-002", "Adapter=${btAdapter?.address ?: "null"} enabled=${btAdapter?.isEnabled}", "INFO")
            createChannel()
            startFg()
            try {
                initGattServer()
                napLog("REM-SVC-003", "GATT Server inicializado OK", "INFO")
            } catch (e: Exception) {
                napLog("REM-SVC-004", "GATT Server ERROR: ${e.message}", "ERROR")
            }
            handler.postDelayed({
                try {
                    napLog("REM-SVC-005", "Auto-start advertising delay 1500ms expirado", "INFO")
                    if (!isAd) {
                        napLog("REM-SVC-006", "Auto-start advertising: isAd=false, llamando startAdvertising()", "INFO")
                        startAdvertising("NEXO")
                    } else {
                        napLog("REM-SVC-007", "Auto-start advertising: isAd=true, omitiendo", "INFO")
                    }
                } catch (e: Exception) {
                    napLog("REM-SVC-ERR", "Auto-start advertising crash: ${e.message}", "ERROR")
                }
            }, 1500)
            napLog("REM-SVC-008", "onCreate() — FIN", "INFO")
        } catch (e: Exception) {
            Log.e(TAG, "[REM-SVC-FATAL] onCreate crash: ${e.message}", e)
            throw e
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            napLog("REM-SVC-009", "onStartCommand() startId=$startId", "INFO")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotif("NEXO BLE activo"), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            } else {
                startForeground(NOTIFICATION_ID, buildNotif("NEXO BLE activo"))
            }
            napLog("REM-SVC-010", "Foreground service iniciado", "INFO")
        } catch (e: Exception) {
            napLog("REM-SVC-ERR", "onStartCommand crash: ${e.message}", "ERROR")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        try {
            napLog("REM-SVC-011", "onDestroy() — INICIO", "INFO")
            stopScan(); stopAdvertising(); cleanup(); gattServer?.close(); super.onDestroy()
            napLog("REM-SVC-012", "onDestroy() — FIN", "INFO")
        } catch (e: Exception) {
            Log.e(TAG, "[REM-SVC-FATAL] onDestroy crash: ${e.message}", e)
        }
    }

    private fun startFg() {
        try {
            val n = buildNotif("NEXO BLE activo")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            else startForeground(NOTIFICATION_ID, n)
        } catch (e: Exception) {
            napLog("REM-SVC-ERR", "startFg crash: ${e.message}", "ERROR")
        }
    }

    private fun buildNotif(c: String): Notification {
        return try {
            val launchIntent = packageManager?.getLaunchIntentForPackage(packageName)
            val pi = if (launchIntent != null) {
                PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            } else null
            NotificationCompat.Builder(this, CHANNEL_ID).setContentTitle("NEXO Mesh").setContentText(c).setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).setContentIntent(pi).setOngoing(true).build()
        } catch (e: Exception) {
            NotificationCompat.Builder(this, CHANNEL_ID).setContentTitle("NEXO Mesh").setContentText(c).setSmallIcon(android.R.drawable.ic_dialog_info).setOngoing(true).build()
        }
    }

    private fun createChannel() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(CHANNEL_ID, "NEXO BLE", NotificationManager.IMPORTANCE_LOW))
        } catch (e: Exception) {
            napLog("REM-SVC-ERR", "createChannel crash: ${e.message}", "ERROR")
        }
    }

    private fun initGattServer() {
        try {
            napLog("REM-GATT-001", "initGattServer() — INICIO", "INFO")
            gattServer = btManager?.openGattServer(this, gattSrvCb)
            val svc = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
            val msgChar = BluetoothGattCharacteristic(MESSAGE_CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_WRITE)
            msgChar.addDescriptor(BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ))
            svc.addCharacteristic(msgChar)
            val annChar = BluetoothGattCharacteristic(ANNOUNCE_CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ)
            svc.addCharacteristic(annChar)
            gattServer?.addService(svc)
            napLog("REM-GATT-002", "Servicio añadido: UUID=$SERVICE_UUID chars=$MESSAGE_CHAR_UUID,$ANNOUNCE_CHAR_UUID", "INFO")
        } catch (e: Exception) {
            napLog("REM-GATT-ERR", "initGattServer crash: ${e.message}", "ERROR")
        }
    }

    private val gattSrvCb = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(d: BluetoothDevice?, s: Int, ns: Int) {
            try {
                val addr = d?.address ?: "null"
                val stateName = when(ns) { BluetoothProfile.STATE_CONNECTED -> "CONNECTED"; BluetoothProfile.STATE_DISCONNECTED -> "DISCONNECTED"; else -> "OTHER($ns)" }
                napLog("REM-GATT-003", "onConnectionStateChange addr=$addr newState=$stateName", "INFO")
                when (ns) {
                    BluetoothProfile.STATE_CONNECTED -> d?.address?.let { serverConns[it] = d; bcastDev(ACTION_DEVICE_CONNECTED, d, "incoming") }
                    BluetoothProfile.STATE_DISCONNECTED -> d?.address?.let { serverConns.remove(it); bcastDev(ACTION_DEVICE_DISCONNECTED, d) }
                }
            } catch (e: Exception) {
                napLog("REM-GATT-ERR", "onConnectionStateChange crash: ${e.message}", "ERROR")
            }
        }
        override fun onCharacteristicReadRequest(d: BluetoothDevice, rId: Int, o: Int, c: BluetoothGattCharacteristic) {
            try {
                napLog("REM-GATT-004", "onCharacteristicReadRequest addr=${d.address} char=${c.uuid}", "DEBUG")
                val v = if (c.uuid == ANNOUNCE_CHAR_UUID) org.json.JSONObject().apply { put("userId", userId); put("userName", userName); put("ts", System.currentTimeMillis()) }.toString().toByteArray() else byteArrayOf()
                gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, 0, v)
            } catch (e: SecurityException) { napLog("REM-GATT-005", "SecurityException read: ${e.message}", "WARN")
            } catch (e: Exception) { napLog("REM-GATT-ERR", "onCharacteristicReadRequest crash: ${e.message}", "ERROR") }
        }
        override fun onCharacteristicWriteRequest(d: BluetoothDevice?, rId: Int, c: BluetoothGattCharacteristic?, pW: Boolean, rN: Boolean, o: Int, v: ByteArray?) {
            try {
                napLog("REM-GATT-006", "onCharacteristicWriteRequest addr=${d?.address} char=${c?.uuid} len=${v?.size}", "DEBUG")
                if (c?.uuid == MESSAGE_CHAR_UUID && v != null) {
                    val msg = String(v, Charsets.UTF_8)
                    var sn = "NEXO Peer"; var ct = msg; var mid = ""
                    try { val j = org.json.JSONObject(msg); sn = j.optString("senderName", sn); ct = j.optString("content", ct); mid = j.optString("messageId", mid) } catch (e: Exception) {}
                    napLog("REM-GATT-007", "Mensaje recibido de ${d?.address}: sender=$sn mid=$mid", "INFO")
                    sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply { putExtra(EXTRA_DEVICE_ADDRESS, d?.address); putExtra(EXTRA_DEVICE_NAME, d?.name ?: "Unknown"); putExtra(EXTRA_MESSAGE, msg); putExtra(EXTRA_CONTENT, ct); putExtra(EXTRA_SENDER_NAME, sn); putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SOURCE, "server_write_request"); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) })
                    if (rN) gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, o, null)
                }
            } catch (e: Exception) {
                napLog("REM-GATT-ERR", "onCharacteristicWriteRequest crash: ${e.message}", "ERROR")
            }
        }
        override fun onDescriptorWriteRequest(d: BluetoothDevice, rId: Int, desc: BluetoothGattDescriptor, pW: Boolean, rN: Boolean, o: Int, v: ByteArray?) {
            try {
                napLog("REM-GATT-008", "onDescriptorWriteRequest addr=${d.address} desc=${desc.uuid}", "DEBUG")
                if (rN) gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, 0, null)
                if (desc.uuid == CCCD_UUID) {
                    val enabled = v != null && v.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    napLog("REM-GATT-009", "CCCD write addr=${d.address} enabled=$enabled", "INFO")
                    sendBroadcast(Intent(ACTION_CLIENT_NOTIFICATION_STATE_CHANGED).apply { putExtra(EXTRA_DEVICE_ADDRESS, d.address); putExtra(EXTRA_ENABLED, enabled) })
                }
            } catch (e: SecurityException) { napLog("REM-GATT-010", "SecurityException desc: ${e.message}", "WARN")
            } catch (e: Exception) { napLog("REM-GATT-ERR", "onDescriptorWriteRequest crash: ${e.message}", "ERROR") }
        }
    }

    fun connectToDevice(addr: String): Boolean {
        return try {
            napLog("REM-CONN-001", "connectToDevice($addr)", "INFO")
            val a = btAdapter ?: return false.also { napLog("REM-CONN-002", "Adapter null", "ERROR") }
            val dev = a.getRemoteDevice(addr) ?: return false.also { napLog("REM-CONN-003", "getRemoteDevice null", "ERROR") }
            val cn = conns.getOrPut(addr) { Conn(addr) }
            if (cn.state == ConnState.READY || cn.state == ConnState.CONNECTING) {
                napLog("REM-CONN-004", "Ya conectando/conectado state=${cn.state}", "INFO")
                return true
            }
            enqueue(addr) { execConnect(dev, addr) }
            true
        } catch (e: Exception) {
            napLog("REM-CONN-ERR", "connectToDevice crash: ${e.message}", "ERROR")
            false
        }
    }

    private fun enqueue(id: String, op: Runnable) {
        try {
            val q = opQueue.getOrPut(id) { LinkedList() }
            synchronized(q) { q.add(op) }
            processNext(id)
        } catch (e: Exception) {
            napLog("REM-CONN-ERR", "enqueue crash: ${e.message}", "ERROR")
        }
    }

    private fun processNext(id: String) {
        try {
            val f = opFlags.getOrPut(id) { AtomicBoolean(false) }
            if (f.getAndSet(true)) return
            val q = opQueue[id] ?: return
            val n = synchronized(q) { q.pollFirst() }
            if (n == null) { f.set(false); return }
            handler.post { try { n.run() } finally { f.set(false); processNext(id) } }
        } catch (e: Exception) {
            napLog("REM-CONN-ERR", "processNext crash: ${e.message}", "ERROR")
        }
    }

    private fun execConnect(dev: BluetoothDevice, id: String) {
        try {
            val cn = conns.getOrPut(id) { Conn(id) }
            val now = System.currentTimeMillis()
            if (now - cn.lastAttempt < RATE_LIMIT && cn.retry > 0) { handler.postDelayed({ execConnect(dev, id) }, RATE_LIMIT - (now - cn.lastAttempt)); return }
            cn.state = ConnState.CONNECTING; cn.lastAttempt = now; cn.userDisc = false
            cn.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }; cn.gatt = null
            napLog("REM-CONN-005", "connectGatt() addr=$id transport=LE", "INFO")
            val g = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) dev.connectGatt(this, false, gattCb, BluetoothDevice.TRANSPORT_LE) else dev.connectGatt(this, false, gattCb)
            cn.gatt = g
            handler.postDelayed({ if (conns[id]?.state == ConnState.CONNECTING) failConn(id, "Timeout") }, CONNECT_TIMEOUT)
        } catch (e: Exception) {
            napLog("REM-CONN-ERR", "execConnect crash: ${e.message}", "ERROR")
        }
    }

    fun disconnectDevice(addr: String) {
        try {
            napLog("REM-CONN-006", "disconnectDevice($addr)", "INFO")
            conns[addr]?.let { it.userDisc = true; it.state = ConnState.DISCONNECTING; it.gatt?.let { g -> try { g.disconnect() } catch (e: Exception) {} } }
            serverConns.remove(addr)
        } catch (e: Exception) {
            napLog("REM-CONN-ERR", "disconnectDevice crash: ${e.message}", "ERROR")
        }
    }

    fun sendMessage(addr: String, msg: String): Boolean {
        return try {
            napLog("REM-SEND-001", "sendMessage($addr) len=${msg.length}", "INFO")
            val cn = conns[addr] ?: return false.also { napLog("REM-SEND-002", "No connection found", "ERROR") }
            if (cn.state != ConnState.READY) return false.also { napLog("REM-SEND-003", "State=${cn.state} not READY", "ERROR") }
            val mid = UUID.randomUUID().toString()
            val payload = try { org.json.JSONObject().apply { put("messageId", mid); put("timestamp", System.currentTimeMillis()); put("senderId", userId); put("senderName", userName); put("content", msg) }.toString().toByteArray(Charsets.UTF_8) } catch (e: Exception) { msg.toByteArray(Charsets.UTF_8) }
            doWrite(addr, payload, mid)
            true
        } catch (e: Exception) {
            napLog("REM-SEND-ERR", "sendMessage crash: ${e.message}", "ERROR")
            false
        }
    }

    private fun doWrite(id: String, payload: ByteArray, mid: String) {
        try {
            val cn = conns[id] ?: return
            val g = cn.gatt ?: return
            val ch = g.getService(SERVICE_UUID)?.getCharacteristic(MESSAGE_CHAR_UUID) ?: return
            cn.pendingMsgId = mid
            napLog("REM-SEND-004", "writeCharacteristic() mid=$mid len=${payload.size}", "INFO")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) g.writeCharacteristic(ch, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
            else { @Suppress("DEPRECATION") ch.value = payload; @Suppress("DEPRECATION") g.writeCharacteristic(ch) }
            handler.postDelayed({ if (cn.pendingMsgId == mid) { cn.pendingMsgId = null; bcastSent(id, mid, false) } }, WRITE_TIMEOUT)
        } catch (e: Exception) {
            napLog("REM-SEND-ERR", "doWrite crash: ${e.message}", "ERROR")
            bcastSent(id, mid, false)
        }
    }

    private val gattCb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, s: Int, ns: Int) {
            try {
                val a = g.device.address
                val cn = conns[a] ?: return
                val stateName = when(ns) { BluetoothProfile.STATE_CONNECTED -> "CONNECTED"; BluetoothProfile.STATE_DISCONNECTED -> "DISCONNECTED"; else -> "OTHER($ns)" }
                napLog("REM-GATT-011", "onConnectionStateChange addr=$a newState=$stateName", "INFO")
                if (ns == BluetoothProfile.STATE_CONNECTED) {
                    if (cn.state == ConnState.CONNECTING) { cn.state = ConnState.DISCOVERING; bcastDev(ACTION_DEVICE_CONNECTED, g.device, "outgoing", cn.retry); handler.postDelayed({ try { g.discoverServices() } catch (e: Exception) {} }, 800) }
                } else if (ns == BluetoothProfile.STATE_DISCONNECTED) {
                    val wr = cn.state == ConnState.READY; cn.state = ConnState.IDLE; cn.gatt = null
                    try { g.close() } catch (e: Exception) {}
                    bcastDev(ACTION_DEVICE_DISCONNECTED, g.device, wasReady = wr)
                    if (!cn.userDisc && cn.retry < MAX_RETRY) schedRetry(a)
                    else if (cn.retry >= MAX_RETRY) { cn.state = ConnState.FAILED; bcastFail(a, "Max retries", cn.retry) }
                }
            } catch (e: Exception) {
                napLog("REM-GATT-ERR", "gattCb.onConnectionStateChange crash: ${e.message}", "ERROR")
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, s: Int) {
            try {
                val a = g.device.address
                napLog("REM-GATT-012", "onServicesDiscovered addr=$a status=$s", "INFO")
                if (s != BluetoothGatt.GATT_SUCCESS) { failConn(a, "Discovery failed"); return }
                val ch = g.getService(SERVICE_UUID)?.getCharacteristic(MESSAGE_CHAR_UUID)
                if (ch == null) { failConn(a, "Service not found"); return }
                try {
                    g.setCharacteristicNotification(ch, true)
                    val d = ch.getDescriptor(CCCD_UUID)
                    if (d != null) { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) else { @Suppress("DEPRECATION") d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; @Suppress("DEPRECATION") g.writeDescriptor(d) } }
                    else markReady(a, g)
                } catch (e: SecurityException) { failConn(a, "SecurityException") }
            } catch (e: Exception) {
                napLog("REM-GATT-ERR", "onServicesDiscovered crash: ${e.message}", "ERROR")
            }
        }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, s: Int) {
            try {
                napLog("REM-GATT-013", "onDescriptorWrite addr=${g.device.address} desc=${d.uuid} status=$s", "INFO")
                if (d.uuid == CCCD_UUID && s == BluetoothGatt.GATT_SUCCESS) { sendBroadcast(Intent(ACTION_NOTIFICATIONS_ENABLED).apply { putExtra(EXTRA_DEVICE_ADDRESS, g.device.address); putExtra(EXTRA_ENABLED, true) }); markReady(g.device.address, g) }
                else if (s != BluetoothGatt.GATT_SUCCESS) failConn(g.device.address, "Descriptor failed")
            } catch (e: Exception) {
                napLog("REM-GATT-ERR", "onDescriptorWrite crash: ${e.message}", "ERROR")
            }
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            try {
                if (c.uuid == MESSAGE_CHAR_UUID) {
                    val msg = String(c.value ?: byteArrayOf(), Charsets.UTF_8)
                    napLog("REM-GATT-014", "onCharacteristicChanged addr=${g.device.address} len=${msg.length}", "INFO")
                    var sn = "NEXO Peer"; var ct = msg; var mid = ""
                    try { val j = org.json.JSONObject(msg); sn = j.optString("senderName", sn); ct = j.optString("content", ct); mid = j.optString("messageId", mid) } catch (e: Exception) {}
                    sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply { putExtra(EXTRA_DEVICE_ADDRESS, g.device.address); putExtra(EXTRA_DEVICE_NAME, g.device.name ?: "Unknown"); putExtra(EXTRA_MESSAGE, msg); putExtra(EXTRA_CONTENT, ct); putExtra(EXTRA_SENDER_NAME, sn); putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SOURCE, "client_notification"); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) })
                }
            } catch (e: Exception) {
                napLog("REM-GATT-ERR", "onCharacteristicChanged crash: ${e.message}", "ERROR")
            }
        }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, s: Int) {
            try {
                val a = g.device.address
                val mid = conns[a]?.pendingMsgId ?: ""
                conns[a]?.pendingMsgId = null
                napLog("REM-GATT-015", "onCharacteristicWrite addr=$a mid=$mid status=$s", "INFO")
                bcastSent(a, mid, s == BluetoothGatt.GATT_SUCCESS)
            } catch (e: Exception) {
                napLog("REM-GATT-ERR", "onCharacteristicWrite crash: ${e.message}", "ERROR")
            }
        }
    }

    private fun schedRetry(a: String) {
        try {
            val cn = conns[a] ?: return
            if (cn.userDisc) return
            val now = System.currentTimeMillis()
            if (now - cn.lastAttempt < RATE_LIMIT) { handler.postDelayed({ schedRetry(a) }, RATE_LIMIT - (now - cn.lastAttempt)); return }
            cn.retry++; cn.lastAttempt = now
            val delay = minOf(RETRY_BASE * (1 shl (cn.retry - 1)), RETRY_MAX) + Random().nextInt(1000)
            napLog("REM-CONN-007", "schedRetry addr=$a attempt=${cn.retry} delay=${delay}ms", "INFO")
            bcastRetry(a, delay, cn.retry)
            handler.postDelayed({ btAdapter?.getRemoteDevice(a)?.let { if (conns[a]?.state == ConnState.IDLE) execConnect(it, a) } }, delay)
        } catch (e: Exception) {
            napLog("REM-CONN-ERR", "schedRetry crash: ${e.message}", "ERROR")
        }
    }

    private fun markReady(a: String, g: BluetoothGatt) {
        try {
            val cn = conns[a] ?: return
            cn.state = ConnState.READY; cn.retry = 0; cn.gatt = g
            napLog("REM-CONN-008", "markReady addr=$a", "INFO")
            sendBroadcast(Intent(ACTION_SERVICES_READY).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_SUCCESS, true) })
        } catch (e: Exception) {
            napLog("REM-CONN-ERR", "markReady crash: ${e.message}", "ERROR")
        }
    }

    private fun failConn(a: String, r: String) {
        try {
            napLog("REM-CONN-009", "failConn addr=$a reason=$r", "ERROR")
            conns[a]?.let { it.state = ConnState.IDLE; it.gatt?.close(); it.gatt = null }
            bcastFail(a, r, conns[a]?.retry ?: 0)
        } catch (e: Exception) {
            napLog("REM-CONN-ERR", "failConn crash: ${e.message}", "ERROR")
        }
    }

    fun startScan() {
        try {
            napLog("REM-SCAN-001", "startScan() — INICIO", "INFO")
            val a = btAdapter ?: run { napLog("REM-SCAN-002", "Adapter null", "ERROR"); bcastScanFail(-1, "Adapter null"); return }
            scanner = a.bluetoothLeScanner
            if (scanner == null) { napLog("REM-SCAN-003", "Scanner null", "ERROR"); bcastScanFail(-2, "Scanner null"); return }
            val now = SystemClock.elapsedRealtime()
            while (scanTimes.isNotEmpty() && now - scanTimes.first() > SCAN_RATE_LIMIT) scanTimes.removeFirst()
            if (scanTimes.size >= 5) { napLog("REM-SCAN-004", "Rate limit activo (${scanTimes.size} scans en 30s)", "WARN"); bcastScanFail(-3, "Rate limit"); return }
            scanTimes.addLast(now)

            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
                .setNumOfMatches(ScanSettings.MATCH_NUM_ONE_ADVERTISEMENT)
                .build()

            scanResults.clear(); isScan = true
            napLog("REM-SCAN-005", "ScanSettings: mode=LOW_LATENCY callback=ALL_MATCHES match=AGGRESSIVE", "INFO")
            try {
                scanner?.startScan(null, settings, scanCb)
                napLog("REM-SCAN-006", "scanner.startScan(null, settings, cb) — LLAMADO OK", "INFO")
                handler.postDelayed({ if (isScan) { napLog("REM-SCAN-007", "Auto-stop scan 15s expirado", "INFO"); stopScan() } }, SCAN_AUTO_STOP)
            } catch (e: SecurityException) {
                isScan = false
                napLog("REM-SCAN-008", "SecurityException: ${e.message}", "ERROR")
                bcastScanFail(-4, "SecurityException")
            }
            napLog("REM-SCAN-009", "startScan() — FIN", "INFO")
        } catch (e: Exception) {
            napLog("REM-SCAN-ERR", "startScan crash: ${e.message}", "ERROR")
        }
    }

    fun stopScan() {
        try {
            if (isScan) {
                try { scanner?.stopScan(scanCb) } catch (e: Exception) { napLog("REM-SCAN-010", "Error stopScan: ${e.message}", "WARN") }
                isScan = false
                napLog("REM-SCAN-011", "stopScan() — resultados=${scanResults.size}", "INFO")
                sendBroadcast(Intent(ACTION_SCAN_STOPPED).apply { putExtra("result_count", scanResults.size) })
            } else {
                napLog("REM-SCAN-012", "stopScan() — isScan=false, nada que detener", "WARN")
            }
        } catch (e: Exception) {
            napLog("REM-SCAN-ERR", "stopScan crash: ${e.message}", "ERROR")
        }
    }

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(ct: Int, r: ScanResult?) {
            try {
                r?.let {
                    val addr: String
                    val devName: String
                    try {
                        addr = it.device.address ?: return
                        devName = it.device.name ?: it.scanRecord?.deviceName ?: "NEXO Device"
                    } catch (se: SecurityException) {
                        napLog("REM-SCAN-013", "SecurityException leyendo device: ${se.message}", "WARN")
                        return
                    }

                    val record = it.scanRecord
                    val uuids = record?.serviceUuids
                    val hasNexoUuid = uuids?.any { u -> u.uuid == SERVICE_UUID } == true
                    val rawBytes = record?.bytes?.size ?: 0
                    val flags = record?.advertiseFlags ?: -1

                    napLog("REM-SCAN-014", "RAW addr=$addr name=$devName rssi=${it.rssi} hasNexo=$hasNexoUuid uuids=${uuids?.map { u -> u.uuid.toString().take(8) }} flags=$flags rawBytes=$rawBytes", "DEBUG")

                    if (hasNexoUuid) {
                        if (scanResults[addr] == null || it.rssi > (scanResults[addr]?.rssi ?: -999)) scanResults[addr] = it
                        napLog("REM-SCAN-015", "NEXO HIT addr=$addr name=$devName rssi=${it.rssi}", "INFO")
                        sendBroadcast(Intent(ACTION_SCAN_RESULT).apply {
                            putExtra(EXTRA_DEVICE_ADDRESS, addr)
                            putExtra(EXTRA_RSSI, it.rssi)
                            putExtra(EXTRA_DEVICE_NAME, devName)
                        })
                    } else {
                        napLog("REM-SCAN-016", "NON-NEXO addr=$addr name=$devName rssi=${it.rssi}", "DEBUG")
                    }
                }
            } catch (e: Exception) {
                napLog("REM-SCAN-ERR", "onScanResult crash: ${e.message}", "ERROR")
            }
        }
        override fun onScanFailed(ec: Int) {
            try {
                isScan = false
                val err = when(ec) {
                    SCAN_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                    SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "REG_FAILED"
                    SCAN_FAILED_INTERNAL_ERROR -> "INTERNAL"
                    SCAN_FAILED_FEATURE_UNSUPPORTED -> "UNSUPPORTED"
                    SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "NO_RESOURCES"
                    SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "TOO_FREQUENT"
                    else -> "UNKNOWN($ec)"
                }
                napLog("REM-SCAN-017", "onScanFailed: $err (code=$ec)", "ERROR")
                bcastScanFail(ec, err)
            } catch (e: Exception) {
                napLog("REM-SCAN-ERR", "onScanFailed crash: ${e.message}", "ERROR")
            }
        }
    }

    fun startAdvertising(name: String) {
        try {
            napLog("REM-ADVERT-001", "startAdvertising(name=$name) — INICIO", "INFO")
            if (isAd) {
                napLog("REM-ADVERT-002", "Ya anunciando, ignorando duplicado", "WARN")
                bcastAd(true)
                return
            }

            val adapter = btAdapter
            if (adapter == null) { napLog("REM-ADVERT-003", "Adapter null", "ERROR"); bcastAd(false, "Adapter null"); return }
            if (!adapter.isEnabled) { napLog("REM-ADVERT-004", "Bluetooth apagado", "ERROR"); bcastAd(false, "Bluetooth disabled"); return }

            val freshAdvertiser = adapter.bluetoothLeAdvertiser
            if (freshAdvertiser == null) { napLog("REM-ADVERT-005", "Advertiser null", "ERROR"); bcastAd(false, "Advertiser null"); return }
            this.advertiser = freshAdvertiser

            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true)
                .setTimeout(0)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .build()

            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .setIncludeTxPowerLevel(false)
                .addServiceUuid(ParcelUuid(SERVICE_UUID))
                .build()

            val scanResponse = AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .addServiceUuid(ParcelUuid(SERVICE_UUID))
                .build()

            val nameBytes = name.toByteArray(Charsets.UTF_8).size
            val flagsBytes = 3
            val totalEst = flagsBytes + (2 + nameBytes) + (2 + 2 + 16)
            napLog("REM-ADVERT-006", "Payload estimado: flags=$flagsBytes name=${2+nameBytes} uuid=${2+2+16} TOTAL=$totalEst bytes (limite=31)", "INFO")

            try {
                freshAdvertiser.startAdvertising(settings, data, scanResponse, adCb)
                napLog("REM-ADVERT-007", "startAdvertising() LLAMADO OK", "INFO")
            } catch (e: SecurityException) {
                napLog("REM-ADVERT-008", "SecurityException: ${e.message}", "ERROR")
                isAd = false
                bcastAd(false, "SecurityException")
            } catch (e: Exception) {
                napLog("REM-ADVERT-009", "Error: ${e.message}", "ERROR")
                isAd = false
                bcastAd(false, e.message ?: "Unknown")
            }
            napLog("REM-ADVERT-010", "startAdvertising() — FIN", "INFO")
        } catch (e: Exception) {
            napLog("REM-ADVERT-ERR", "startAdvertising crash: ${e.message}", "ERROR")
        }
    }

    fun stopAdvertising() {
        try {
            napLog("REM-ADVERT-011", "stopAdvertising() — INICIO isAd=$isAd", "INFO")
            val adv = advertiser
            if (adv != null && isAd) {
                try { adv.stopAdvertising(adCb) } catch (e: Exception) { napLog("REM-ADVERT-012", "Error deteniendo: ${e.message}", "WARN") }
            }
            isAd = false
            advertiser = null
            bcastAd(false)
            napLog("REM-ADVERT-013", "stopAdvertising() — FIN", "INFO")
        } catch (e: Exception) {
            napLog("REM-ADVERT-ERR", "stopAdvertising crash: ${e.message}", "ERROR")
        }
    }

    fun setUserInfo(uid: String, uname: String) {
        try {
            this.userId = uid
            this.userName = uname
            napLog("REM-USER-001", "setUserInfo: uid=${uid.take(8)} name=$uname", "INFO")
            if (isAd && uname.isNotEmpty()) {
                napLog("REM-USER-002", "Reiniciando advertising con nuevo nombre", "INFO")
                stopAdvertising()
                handler.postDelayed({ startAdvertising(uname) }, 500)
            }
        } catch (e: Exception) {
            napLog("REM-USER-ERR", "setUserInfo crash: ${e.message}", "ERROR")
        }
    }

    fun isBluetoothEnabled() = try { btAdapter?.isEnabled == true } catch (e: Exception) { false }
    fun isScanning() = isScan
    fun isAdvertising() = isAd
    fun getScanResultCount() = scanResults.size
    fun getConnectedDevices(): List<Map<String, String>> {
        return try {
            val list = mutableListOf<Map<String, String>>()
            conns.forEach { (id, c) -> if (c.state == ConnState.READY) list.add(mapOf("deviceId" to id, "address" to id, "name" to (c.gatt?.device?.name ?: "NEXO Peer"), "direction" to "outgoing", "servicesReady" to "true")) }
            serverConns.forEach { (id, d) -> try { list.add(mapOf("deviceId" to id, "address" to id, "name" to (d.name ?: "NEXO Peer"), "direction" to "incoming", "servicesReady" to "true")) } catch (e: SecurityException) {} }
            list
        } catch (e: Exception) {
            emptyList()
        }
    }

    private val adCb = object : AdvertiseCallback() {
        override fun onStartSuccess(s: AdvertiseSettings?) {
            try {
                isAd = true
                napLog("REM-ADVERT-014", "onStartSuccess — isAd=true UUID=$SERVICE_UUID", "INFO")
                bcastAd(true)
            } catch (e: Exception) {
                napLog("REM-ADVERT-ERR", "onStartSuccess crash: ${e.message}", "ERROR")
            }
        }
        override fun onStartFailure(ec: Int) {
            try {
                isAd = false
                val err = when(ec) {
                    ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                    ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                    ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                    ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
                    ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE"
                    else -> "UNKNOWN($ec)"
                }
                napLog("REM-ADVERT-015", "onStartFailure: $err (code=$ec)", "ERROR")
                bcastAd(false, err)
            } catch (e: Exception) {
                napLog("REM-ADVERT-ERR", "onStartFailure crash: ${e.message}", "ERROR")
            }
        }
    }

    private fun bcastScanFail(c: Int, d: String) { try { sendBroadcast(Intent(ACTION_SCAN_FAILED).apply { putExtra(EXTRA_ERROR_CODE, c); putExtra(EXTRA_ERROR_DESC, d) }) } catch (e: Exception) {} }
    private fun bcastAd(v: Boolean, reason: String = "") { try { sendBroadcast(Intent(ACTION_ADVERT_STATE).apply { putExtra(EXTRA_ADVERTISING, v); if (reason.isNotEmpty()) putExtra(EXTRA_REASON, reason) }) } catch (e: Exception) {} }
    private fun bcastDev(a: String, d: BluetoothDevice?, dir: String = "", att: Int = 0, wasReady: Boolean = false) { try { sendBroadcast(Intent(a).apply { putExtra(EXTRA_DEVICE_ADDRESS, d?.address); putExtra(EXTRA_DEVICE_NAME, d?.name ?: "Unknown"); putExtra(EXTRA_DIRECTION, dir); putExtra(EXTRA_ATTEMPT, att); putExtra("wasReady", wasReady) }) } catch (e: Exception) {} }
    private fun bcastFail(a: String, r: String, att: Int) { try { sendBroadcast(Intent(ACTION_CONNECTION_FAILED).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_REASON, r); putExtra(EXTRA_ATTEMPT, att); putExtra(EXTRA_MAX_ATTEMPTS, MAX_RETRY) }) } catch (e: Exception) {} }
    private fun bcastRetry(a: String, delay: Long, att: Int) { try { sendBroadcast(Intent(ACTION_RETRY_SCHEDULED).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_DELAY_MS, delay); putExtra(EXTRA_ATTEMPT, att) }) } catch (e: Exception) {} }
    private fun bcastSent(a: String, mid: String, ok: Boolean) { try { sendBroadcast(Intent(ACTION_MESSAGE_SENT).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SUCCESS, ok) }) } catch (e: Exception) {} }
    private fun napLog(c: String, m: String, l: String = "INFO") { try { val f = "[$c] $m"; when(l) { "ERROR" -> Log.e(TAG, f); "WARN" -> Log.w(TAG, f); "DEBUG" -> Log.d(TAG, f); else -> Log.i(TAG, f) }; sendBroadcast(Intent(ACTION_NAP_AUDIT).apply { putExtra(EXTRA_NAP_CODE, c); putExtra(EXTRA_NAP_MESSAGE, m); putExtra(EXTRA_NAP_LEVEL, l); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) }) } catch (e: Exception) { Log.e(TAG, "[REM-LOG-FAIL] ${e.message}") } }
    private fun cleanup() { try { conns.forEach { (_, c) -> c.userDisc = true; c.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }; c.gatt = null; c.state = ConnState.IDLE }; serverConns.clear(); gattServer?.close(); gattServer = null } catch (e: Exception) {} }
}
