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
    private val scanTimes = ArrayDeque<Long>(5)
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
        btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        btAdapter = btManager?.adapter
        createChannel()
        startFg()
        try { initGattServer() } catch (e: Exception) { napLog("INIT", "GATT err: ${e.message}", "ERROR") }
    }

    override fun onDestroy() {
        stopScan(); stopAdvertising(); cleanup(); gattServer?.close(); super.onDestroy()
    }

    private fun startFg() {
        val n = buildNotif("NEXO BLE activo")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        else startForeground(NOTIFICATION_ID, n)
    }

    private fun buildNotif(c: String): Notification {
        val pi = PendingIntent.getActivity(this, 0, packageManager.getLaunchIntentForPackage(packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL_ID).setContentTitle("NEXO Mesh").setContentText(c).setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).setContentIntent(pi).setOngoing(true).build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(CHANNEL_ID, "NEXO BLE", NotificationManager.IMPORTANCE_LOW))
    }

    private fun initGattServer() {
        gattServer = btManager?.openGattServer(this, gattSrvCb)
        val svc = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val msgChar = BluetoothGattCharacteristic(MESSAGE_CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_WRITE)
        msgChar.addDescriptor(BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ))
        svc.addCharacteristic(msgChar)
        val annChar = BluetoothGattCharacteristic(ANNOUNCE_CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ)
        svc.addCharacteristic(annChar)
        gattServer?.addService(svc)
    }

    private val gattSrvCb = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(d: BluetoothDevice?, s: Int, ns: Int) {
            when (ns) {
                BluetoothProfile.STATE_CONNECTED -> d?.address?.let { serverConns[it] = d; bcastDev(ACTION_DEVICE_CONNECTED, d, "incoming") }
                BluetoothProfile.STATE_DISCONNECTED -> d?.address?.let { serverConns.remove(it); bcastDev(ACTION_DEVICE_DISCONNECTED, d) }
            }
        }
        override fun onCharacteristicReadRequest(d: BluetoothDevice, rId: Int, o: Int, c: BluetoothGattCharacteristic) {
            try {
                val v = if (c.uuid == ANNOUNCE_CHAR_UUID) org.json.JSONObject().apply { put("userId", userId); put("userName", userName); put("ts", System.currentTimeMillis()) }.toString().toByteArray() else byteArrayOf()
                gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, 0, v)
            } catch (e: SecurityException) {}
        }
        override fun onCharacteristicWriteRequest(d: BluetoothDevice?, rId: Int, c: BluetoothGattCharacteristic?, pW: Boolean, rN: Boolean, o: Int, v: ByteArray?) {
            if (c?.uuid == MESSAGE_CHAR_UUID && v != null) {
                val msg = String(v, Charsets.UTF_8)
                var sn = "NEXO Peer"; var ct = msg; var mid = ""
                try { val j = org.json.JSONObject(msg); sn = j.optString("senderName", sn); ct = j.optString("content", ct); mid = j.optString("messageId", mid) } catch (e: Exception) {}
                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply { putExtra(EXTRA_DEVICE_ADDRESS, d?.address); putExtra(EXTRA_DEVICE_NAME, d?.name ?: "Unknown"); putExtra(EXTRA_MESSAGE, msg); putExtra(EXTRA_CONTENT, ct); putExtra(EXTRA_SENDER_NAME, sn); putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SOURCE, "server_write_request"); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) })
                if (rN) gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, o, null)
            }
        }
        override fun onDescriptorWriteRequest(d: BluetoothDevice, rId: Int, desc: BluetoothGattDescriptor, pW: Boolean, rN: Boolean, o: Int, v: ByteArray?) {
            try {
                if (rN) gattServer?.sendResponse(d, rId, BluetoothGatt.GATT_SUCCESS, 0, null)
                if (desc.uuid == CCCD_UUID) sendBroadcast(Intent(ACTION_CLIENT_NOTIFICATION_STATE_CHANGED).apply { putExtra(EXTRA_DEVICE_ADDRESS, d.address); putExtra(EXTRA_ENABLED, v != null && v.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) })
            } catch (e: SecurityException) {}
        }
    }    fun connectToDevice(addr: String): Boolean {
        val a = btAdapter ?: return false
        val dev = a.getRemoteDevice(addr) ?: return false
        val cn = conns.getOrPut(addr) { Conn(addr) }
        if (cn.state == ConnState.READY || cn.state == ConnState.CONNECTING) return true
        enqueue(addr) { execConnect(dev, addr) }
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
        if (now - cn.lastAttempt < RATE_LIMIT && cn.retry > 0) { handler.postDelayed({ execConnect(dev, id) }, RATE_LIMIT - (now - cn.lastAttempt)); return }
        cn.state = ConnState.CONNECTING; cn.lastAttempt = now; cn.userDisc = false
        cn.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }; cn.gatt = null
        val g = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) dev.connectGatt(this, false, gattCb, BluetoothDevice.TRANSPORT_LE) else dev.connectGatt(this, false, gattCb)
        cn.gatt = g
        handler.postDelayed({ if (conns[id]?.state == ConnState.CONNECTING) failConn(id, "Timeout") }, CONNECT_TIMEOUT)
    }

    fun disconnectDevice(addr: String) {
        conns[addr]?.let { it.userDisc = true; it.state = ConnState.DISCONNECTING; it.gatt?.let { g -> try { g.disconnect() } catch (e: Exception) {} } }
        serverConns.remove(addr)
    }

    fun sendMessage(addr: String, msg: String): Boolean {
        val cn = conns[addr] ?: return false
        if (cn.state != ConnState.READY) return false
        val mid = UUID.randomUUID().toString()
        val payload = try { org.json.JSONObject().apply { put("messageId", mid); put("timestamp", System.currentTimeMillis()); put("senderId", userId); put("senderName", userName); put("content", msg) }.toString().toByteArray(Charsets.UTF_8) } catch (e: Exception) { msg.toByteArray(Charsets.UTF_8) }
        doWrite(addr, payload, mid)
        return true
    }

    private fun doWrite(id: String, payload: ByteArray, mid: String) {
        val cn = conns[id] ?: return
        val g = cn.gatt ?: return
        try {
            val ch = g.getService(SERVICE_UUID)?.getCharacteristic(MESSAGE_CHAR_UUID) ?: return
            cn.pendingMsgId = mid
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) g.writeCharacteristic(ch, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
            else { @Suppress("DEPRECATION") ch.value = payload; @Suppress("DEPRECATION") g.writeCharacteristic(ch) }
            handler.postDelayed({ if (cn.pendingMsgId == mid) { cn.pendingMsgId = null; bcastSent(id, mid, false) } }, WRITE_TIMEOUT)
        } catch (e: Exception) { bcastSent(id, mid, false) }
    }

    private val gattCb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, s: Int, ns: Int) {
            val a = g.device.address
            val cn = conns[a] ?: return
            if (ns == BluetoothProfile.STATE_CONNECTED) {
                if (cn.state == ConnState.CONNECTING) { cn.state = ConnState.DISCOVERING; bcastDev(ACTION_DEVICE_CONNECTED, g.device, "outgoing", cn.retry); handler.postDelayed({ try { g.discoverServices() } catch (e: Exception) {} }, 800) }
            } else if (ns == BluetoothProfile.STATE_DISCONNECTED) {
                val wr = cn.state == ConnState.READY; cn.state = ConnState.IDLE; cn.gatt = null
                try { g.close() } catch (e: Exception) {}
                bcastDev(ACTION_DEVICE_DISCONNECTED, g.device, wasReady = wr)
                if (!cn.userDisc && cn.retry < MAX_RETRY) schedRetry(a)
                else if (cn.retry >= MAX_RETRY) { cn.state = ConnState.FAILED; bcastFail(a, "Max retries", cn.retry) }
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, s: Int) {
            val a = g.device.address
            if (s != BluetoothGatt.GATT_SUCCESS) { failConn(a, "Discovery failed"); return }
            val ch = g.getService(SERVICE_UUID)?.getCharacteristic(MESSAGE_CHAR_UUID)
            if (ch == null) { failConn(a, "Service not found"); return }
            try {
                g.setCharacteristicNotification(ch, true)
                val d = ch.getDescriptor(CCCD_UUID)
                if (d != null) { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) else { @Suppress("DEPRECATION") d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; @Suppress("DEPRECATION") g.writeDescriptor(d) } }
                else markReady(a, g)
            } catch (e: SecurityException) { failConn(a, "SecurityException") }
        }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, s: Int) {
            if (d.uuid == CCCD_UUID && s == BluetoothGatt.GATT_SUCCESS) { sendBroadcast(Intent(ACTION_NOTIFICATIONS_ENABLED).apply { putExtra(EXTRA_DEVICE_ADDRESS, g.device.address); putExtra(EXTRA_ENABLED, true) }); markReady(g.device.address, g) }
            else if (s != BluetoothGatt.GATT_SUCCESS) failConn(g.device.address, "Descriptor failed")
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (c.uuid == MESSAGE_CHAR_UUID) {
                val msg = String(c.value ?: byteArrayOf(), Charsets.UTF_8)
                var sn = "NEXO Peer"; var ct = msg; var mid = ""
                try { val j = org.json.JSONObject(msg); sn = j.optString("senderName", sn); ct = j.optString("content", ct); mid = j.optString("messageId", mid) } catch (e: Exception) {}
                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply { putExtra(EXTRA_DEVICE_ADDRESS, g.device.address); putExtra(EXTRA_DEVICE_NAME, g.device.name ?: "Unknown"); putExtra(EXTRA_MESSAGE, msg); putExtra(EXTRA_CONTENT, ct); putExtra(EXTRA_SENDER_NAME, sn); putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SOURCE, "client_notification"); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) })
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
        if (now - cn.lastAttempt < RATE_LIMIT) { handler.postDelayed({ schedRetry(a) }, RATE_LIMIT - (now - cn.lastAttempt)); return }
        cn.retry++; cn.lastAttempt = now
        val delay = minOf(RETRY_BASE * (1 shl (cn.retry - 1)), RETRY_MAX) + Random().nextInt(1000)
        bcastRetry(a, delay, cn.retry)
        handler.postDelayed({ btAdapter?.getRemoteDevice(a)?.let { if (conns[a]?.state == ConnState.IDLE) execConnect(it, a) } }, delay)
    }

    private fun markReady(a: String, g: BluetoothGatt) {
        val cn = conns[a] ?: return
        cn.state = ConnState.READY; cn.retry = 0; cn.gatt = g
        sendBroadcast(Intent(ACTION_SERVICES_READY).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_SUCCESS, true) })
    }

    private fun failConn(a: String, r: String) {
        conns[a]?.let { it.state = ConnState.IDLE; it.gatt?.close(); it.gatt = null }
        bcastFail(a, r, conns[a]?.retry ?: 0)
    }
    fun startScan() {
        val a = btAdapter ?: run { bcastScanFail(-1, "Adapter null"); return }
        scanner = a.bluetoothLeScanner
        if (scanner == null) { bcastScanFail(-2, "Scanner null"); return }
        val now = SystemClock.elapsedRealtime()
        while (scanTimes.isNotEmpty() && now - scanTimes.first() > SCAN_RATE_LIMIT) scanTimes.removeFirst()
        if (scanTimes.size >= 5) { bcastScanFail(-3, "Rate limit"); return }
        scanTimes.addLast(now)
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setReportDelay(0).build()
        scanResults.clear(); isScan = true
        try { scanner?.startScan(null, settings, scanCb); handler.postDelayed({ if (isScan) stopScan() }, SCAN_AUTO_STOP) } catch (e: SecurityException) { isScan = false; bcastScanFail(-4, "SecurityException") }
    }

    fun stopScan() { if (isScan) { try { scanner?.stopScan(scanCb) } catch (e: Exception) {}; isScan = false; sendBroadcast(Intent(ACTION_SCAN_STOPPED).apply { putExtra("result_count", scanResults.size) }) } }

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(ct: Int, r: ScanResult?) {
            r?.let { if (it.scanRecord?.serviceUuids?.any { u -> u.uuid == SERVICE_UUID } == true) { val a = it.device.address; if (scanResults[a] == null || it.rssi > (scanResults[a]?.rssi ?: -999)) scanResults[a] = it; sendBroadcast(Intent(ACTION_SCAN_RESULT).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_RSSI, it.rssi); putExtra(EXTRA_DEVICE_NAME, it.device.name ?: it.scanRecord?.deviceName ?: "NEXO Device") }) } }
        }
        override fun onScanFailed(ec: Int) { isScan = false; bcastScanFail(ec, when(ec) { SCAN_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"; SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "REG_FAILED"; SCAN_FAILED_INTERNAL_ERROR -> "INTERNAL"; SCAN_FAILED_FEATURE_UNSUPPORTED -> "UNSUPPORTED"; SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "NO_RESOURCES"; SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "TOO_FREQUENT"; else -> "UNKNOWN($ec)" }) }
    }

    fun startAdvertising(name: String) {
        val a = btAdapter ?: return
        try { a.name = name } catch (e: Exception) {}
        advertiser = a.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(true).setTimeout(0).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).build()
        val data = AdvertiseData.Builder().setIncludeDeviceName(true).addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        advertiser?.startAdvertising(settings, data, adCb)
    }

    fun stopAdvertising() { advertiser?.stopAdvertising(adCb); isAd = false; bcastAd(false) }

    private val adCb = object : AdvertiseCallback() {
        override fun onStartSuccess(s: AdvertiseSettings?) { isAd = true; bcastAd(true) }
        override fun onStartFailure(ec: Int) { isAd = false; bcastAd(false) }
    }

    fun setUserInfo(uid: String, uname: String) { userId = uid; userName = uname }
    fun isBluetoothEnabled() = btAdapter?.isEnabled == true
    fun isScanning() = isScan
    fun isAdvertising() = isAd
    fun getScanResultCount() = scanResults.size
    fun getConnectedDevices(): List<Map<String, String>> {
        val list = mutableListOf<Map<String, String>>()
        conns.forEach { (id, c) -> if (c.state == ConnState.READY) list.add(mapOf("deviceId" to id, "address" to id, "name" to (c.gatt?.device?.name ?: "NEXO Peer"), "direction" to "outgoing", "servicesReady" to "true")) }
        serverConns.forEach { (id, d) -> try { list.add(mapOf("deviceId" to id, "address" to id, "name" to (d.name ?: "NEXO Peer"), "direction" to "incoming", "servicesReady" to "true")) } catch (e: SecurityException) {} }
        return list
    }

    private fun bcastScanFail(c: Int, d: String) { sendBroadcast(Intent(ACTION_SCAN_FAILED).apply { putExtra(EXTRA_ERROR_CODE, c); putExtra(EXTRA_ERROR_DESC, d) }) }
    private fun bcastAd(v: Boolean) { sendBroadcast(Intent(ACTION_ADVERT_STATE).apply { putExtra(EXTRA_ADVERTISING, v) }) }
    private fun bcastDev(a: String, d: BluetoothDevice?, dir: String = "", att: Int = 0, wasReady: Boolean = false) { sendBroadcast(Intent(a).apply { putExtra(EXTRA_DEVICE_ADDRESS, d?.address); putExtra(EXTRA_DEVICE_NAME, d?.name ?: "Unknown"); putExtra(EXTRA_DIRECTION, dir); putExtra(EXTRA_ATTEMPT, att); putExtra("wasReady", wasReady) }) }
    private fun bcastFail(a: String, r: String, att: Int) { sendBroadcast(Intent(ACTION_CONNECTION_FAILED).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_REASON, r); putExtra(EXTRA_ATTEMPT, att); putExtra(EXTRA_MAX_ATTEMPTS, MAX_RETRY) }) }
    private fun bcastRetry(a: String, delay: Long, att: Int) { sendBroadcast(Intent(ACTION_RETRY_SCHEDULED).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_DELAY_MS, delay); putExtra(EXTRA_ATTEMPT, att) }) }
    private fun bcastSent(a: String, mid: String, ok: Boolean) { sendBroadcast(Intent(ACTION_MESSAGE_SENT).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SUCCESS, ok) }) }

    fun startScan() {
        val a = btAdapter ?: run { bcastScanFail(-1, "Adapter null"); return }
        scanner = a.bluetoothLeScanner
        if (scanner == null) { bcastScanFail(-2, "Scanner null"); return }
        val now = SystemClock.elapsedRealtime()
        while (scanTimes.isNotEmpty() && now - scanTimes.first() > SCAN_RATE_LIMIT) scanTimes.removeFirst()
        if (scanTimes.size >= 5) { bcastScanFail(-3, "Rate limit"); return }
        scanTimes.addLast(now)
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setReportDelay(0).build()
        scanResults.clear(); isScan = true
        try { scanner?.startScan(null, settings, scanCb); handler.postDelayed({ if (isScan) stopScan() }, SCAN_AUTO_STOP) } catch (e: SecurityException) { isScan = false; bcastScanFail(-4, "SecurityException") }
    }

    fun stopScan() { if (isScan) { try { scanner?.stopScan(scanCb) } catch (e: Exception) {}; isScan = false; sendBroadcast(Intent(ACTION_SCAN_STOPPED).apply { putExtra("result_count", scanResults.size) }) } }

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(ct: Int, r: ScanResult?) {
            r?.let { if (it.scanRecord?.serviceUuids?.any { u -> u.uuid == SERVICE_UUID } == true) { val a = it.device.address; if (scanResults[a] == null || it.rssi > (scanResults[a]?.rssi ?: -999)) scanResults[a] = it; sendBroadcast(Intent(ACTION_SCAN_RESULT).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_RSSI, it.rssi); putExtra(EXTRA_DEVICE_NAME, it.device.name ?: it.scanRecord?.deviceName ?: "NEXO Device") }) } }
        }
        override fun onScanFailed(ec: Int) { isScan = false; bcastScanFail(ec, when(ec) { SCAN_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"; SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "REG_FAILED"; SCAN_FAILED_INTERNAL_ERROR -> "INTERNAL"; SCAN_FAILED_FEATURE_UNSUPPORTED -> "UNSUPPORTED"; SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "NO_RESOURCES"; SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "TOO_FREQUENT"; else -> "UNKNOWN($ec)" }) }
    }

    fun startAdvertising(name: String) {
        val a = btAdapter ?: return
        try { a.name = name } catch (e: Exception) {}
        advertiser = a.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(true).setTimeout(0).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).build()
        val data = AdvertiseData.Builder().setIncludeDeviceName(true).addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        advertiser?.startAdvertising(settings, data, adCb)
    }

    fun stopAdvertising() { advertiser?.stopAdvertising(adCb); isAd = false; bcastAd(false) }

    private val adCb = object : AdvertiseCallback() {
        override fun onStartSuccess(s: AdvertiseSettings?) { isAd = true; bcastAd(true) }
        override fun onStartFailure(ec: Int) { isAd = false; bcastAd(false) }
    }

    fun setUserInfo(uid: String, uname: String) { userId = uid; userName = uname }
    fun isBluetoothEnabled() = btAdapter?.isEnabled == true
    fun isScanning() = isScan
    fun isAdvertising() = isAd
    fun getScanResultCount() = scanResults.size
    fun getConnectedDevices(): List<Map<String, String>> {
        val list = mutableListOf<Map<String, String>>()
        conns.forEach { (id, c) -> if (c.state == ConnState.READY) list.add(mapOf("deviceId" to id, "address" to id, "name" to (c.gatt?.device?.name ?: "NEXO Peer"), "direction" to "outgoing", "servicesReady" to "true")) }
        serverConns.forEach { (id, d) -> try { list.add(mapOf("deviceId" to id, "address" to id, "name" to (d.name ?: "NEXO Peer"), "direction" to "incoming", "servicesReady" to "true")) } catch (e: SecurityException) {} }
        return list
    }

    private fun bcastScanFail(c: Int, d: String) { sendBroadcast(Intent(ACTION_SCAN_FAILED).apply { putExtra(EXTRA_ERROR_CODE, c); putExtra(EXTRA_ERROR_DESC, d) }) }
    private fun bcastAd(v: Boolean) { sendBroadcast(Intent(ACTION_ADVERT_STATE).apply { putExtra(EXTRA_ADVERTISING, v) }) }
    private fun bcastDev(a: String, d: BluetoothDevice?, dir: String = "", att: Int = 0, wasReady: Boolean = false) { sendBroadcast(Intent(a).apply { putExtra(EXTRA_DEVICE_ADDRESS, d?.address); putExtra(EXTRA_DEVICE_NAME, d?.name ?: "Unknown"); putExtra(EXTRA_DIRECTION, dir); putExtra(EXTRA_ATTEMPT, att); putExtra("wasReady", wasReady) }) }
    private fun bcastFail(a: String, r: String, att: Int) { sendBroadcast(Intent(ACTION_CONNECTION_FAILED).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_REASON, r); putExtra(EXTRA_ATTEMPT, att); putExtra(EXTRA_MAX_ATTEMPTS, MAX_RETRY) }) }
    private fun bcastRetry(a: String, delay: Long, att: Int) { sendBroadcast(Intent(ACTION_RETRY_SCHEDULED).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_DELAY_MS, delay); putExtra(EXTRA_ATTEMPT, att) }) }
    private fun bcastSent(a: String, mid: String, ok: Boolean) { sendBroadcast(Intent(ACTION_MESSAGE_SENT).apply { putExtra(EXTRA_DEVICE_ADDRESS, a); putExtra(EXTRA_MESSAGE_ID, mid); putExtra(EXTRA_SUCCESS, ok) }) }
    private fun napLog(c: String, m: String, l: String = "INFO") { val f = "[$c] $m"; when(l) { "ERROR" -> Log.e(TAG, f); "WARN" -> Log.w(TAG, f); "DEBUG" -> Log.d(TAG, f); else -> Log.i(TAG, f) }; sendBroadcast(Intent(ACTION_NAP_AUDIT).apply { putExtra(EXTRA_NAP_CODE, c); putExtra(EXTRA_NAP_MESSAGE, m); putExtra(EXTRA_NAP_LEVEL, l); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) }) }
    private fun cleanup() { conns.forEach { (_, c) -> c.userDisc = true; c.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }; c.gatt = null; c.state = ConnState.IDLE }; serverConns.clear(); gattServer?.close(); gattServer = null }
}
