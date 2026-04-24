package com.nexo.ble

import android.app.*
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val CHANNEL_ID = "nexo_ble_channel"
        private const val NOTIFICATION_ID = 1001
        private const val NEXO_SERVICE_UUID = "0000feed-0000-1000-8000-00805f9b34fb"
        private const val NEXO_CHAR_RX = "0000feed-0001-1000-8000-00805f9b34fb"
        private const val NEXO_CHAR_TX = "0000feed-0002-1000-8000-00805f9b34fb"
        private const val CCCD_UUID = "00002902-0000-1000-8000-00805f9b34fb"
    }

    private val binder = LocalBinder()
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    private val serverConnections = ConcurrentHashMap<String, BluetoothDevice>()
    private var isAdvertising = false
    private var serverReady = false
    private val handler = Handler(Looper.getMainLooper())

    interface ServiceInterface {
        fun sendNotification(deviceId: String, data: ByteArray): Boolean
        fun getConnectedDeviceIds(): List<String>
        fun isServerReady(): Boolean
    }

    inner class LocalBinder : Binder() {
        fun getService(): ServiceInterface = object : ServiceInterface {
            override fun sendNotification(deviceId: String, data: ByteArray): Boolean {
                return this@BleService.sendNotification(deviceId, data)
            }
            override fun getConnectedDeviceIds(): List<String> {
                return this@BleService.serverConnections.keys.toList()
            }
            override fun isServerReady(): Boolean {
                return this@BleService.serverReady
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "BleService onCreate")
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "BleService onStartCommand")
        startAsForeground()
        setupGattServer()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "BleService onDestroy")
        stopAdvertising()
        serverConnections.clear()
        gattServer?.close()
        gattServer = null
        serverReady = false
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "NEXO BLE Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene el servidor BLE activo para recibir mensajes"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun startAsForeground() {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO BLE")
            .setContentText("Servidor P2P activo - esperando conexiones")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun setupGattServer() {
        if (gattServer != null && serverReady) return
        if (!canAccessBluetooth()) {
            Log.w(TAG, "Sin permisos para setupGattServer")
            return
        }
        try {
            val service = BluetoothGattService(
                UUID.fromString(NEXO_SERVICE_UUID),
                BluetoothGattService.SERVICE_TYPE_PRIMARY
            )
            val announceChar = BluetoothGattCharacteristic(
                UUID.fromString(NEXO_CHAR_RX),
                BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            )
            val payloadChar = BluetoothGattCharacteristic(
                UUID.fromString(NEXO_CHAR_TX),
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
            ).apply {
                addDescriptor(BluetoothGattDescriptor(
                    UUID.fromString(CCCD_UUID),
                    BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
                ))
            }
            service.addCharacteristic(announceChar)
            service.addCharacteristic(payloadChar)
            gattServer = bluetoothManager?.openGattServer(this, gattServerCallback)
            gattServer?.addService(service)
            Log.i(TAG, "[NAP-BLE-SVC] GattServer abierto, servicio en cola de registro")
        } catch (e: Exception) {
            Log.e(TAG, "[NAP-BLE-SVC] Error setupGattServer: ${e.message}")
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
            if (status == BluetoothGatt.GATT_SUCCESS && service?.uuid.toString().equals(NEXO_SERVICE_UUID, ignoreCase = true)) {
                serverReady = true
                Log.i(TAG, "[NAP-BLE-SVC] Servicio NEXO registrado en stack Bluetooth")
                sendBroadcast(Intent("com.nexo.ble.SERVER_READY").apply {
                    putExtra("ready", true)
                    putExtra("serviceUuid", NEXO_SERVICE_UUID)
                })
            } else {
                serverReady = false
                Log.e(TAG, "[NAP-BLE-SVC] Fallo al registrar servicio: status=$status uuid=${service?.uuid}")
            }
        }
        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            val dev = device ?: return
            val id = dev.address.orEmpty()
            if (id.isEmpty()) return
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    serverConnections[id] = dev
                    Log.i(TAG, "[NAP-BLE-SVC] Dispositivo conectado ENTRANTE: $id")
                    sendBroadcast(Intent("com.nexo.ble.DEVICE_CONNECTED").apply {
                        putExtra("deviceId", id)
                        putExtra("direction", "incoming")
                    })
                    handler.postDelayed({
                        sendBroadcast(Intent("com.nexo.ble.SERVICES_READY").apply {
                            putExtra("deviceId", id)
                            putExtra("ready", true)
                            putExtra("direction", "incoming")
                            putExtra("role", "server")
                        })
                    }, 500)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    serverConnections.remove(id)
                    Log.i(TAG, "[NAP-BLE-SVC] Dispositivo desconectado: $id")
                    sendBroadcast(Intent("com.nexo.ble.DEVICE_DISCONNECTED").apply {
                        putExtra("deviceId", id)
                    })
                }
            }
        }
        override fun onCharacteristicReadRequest(
            device: BluetoothDevice?, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic?
        ) {
            val dev = device ?: return
            val char = characteristic ?: return
            val value = when (char.uuid.toString()) {
                NEXO_CHAR_RX -> {
                    val json = buildString {
                        append("{\"userId\":\"\",\"userName\":\"NEXO Service\",\"timestamp\":")
                        append(System.currentTimeMillis())
                        append(",\"appVersion\":\"5.0.3-ARCH\"}")
                    }
                    json.toByteArray()
                }
                else -> byteArrayOf()
            }
            gattServer?.sendResponse(dev, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        }
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice?, requestId: Int, characteristic: BluetoothGattCharacteristic?,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            val dev = device ?: return
            val data = value ?: byteArrayOf()
            if (responseNeeded) {
                gattServer?.sendResponse(dev, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
            val char = characteristic ?: return
            when (char.uuid.toString()) {
                NEXO_CHAR_TX -> {
                    val payload = String(data, Charsets.UTF_8)
                    Log.d(TAG, "[NAP-BLE-SVC] PAYLOAD RECIBIDO de ${dev.address}: ${payload.take(100)}")
                    sendBroadcast(Intent("com.nexo.ble.PAYLOAD_RECEIVED").apply {
                        putExtra("deviceId", dev.address)
                        putExtra("data", payload)
                        putExtra("source", "server_direct")
                    })
                }
            }
        }
        override fun onDescriptorWriteRequest(
            device: BluetoothDevice?, requestId: Int, descriptor: BluetoothGattDescriptor?,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            val dev = device ?: return
            val desc = descriptor ?: return
            if (responseNeeded) {
                gattServer?.sendResponse(dev, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
            if (desc.uuid.toString().equals(CCCD_UUID, ignoreCase = true)) {
                val enabled = value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true
                Log.i(TAG, "[NAP-BLE-SVC] CCCD escrito por ${dev.address}: enabled=$enabled")
                sendBroadcast(Intent("com.nexo.ble.NOTIFICATION_STATE").apply {
                    putExtra("deviceId", dev.address)
                    putExtra("enabled", enabled)
                })
            }
        }
        override fun onMtuChanged(device: BluetoothDevice?, mtu: Int) {
            val dev = device ?: return
            val id = dev.address.orEmpty()
            if (id.isNotEmpty()) {
                Log.i(TAG, "[NAP-BLE-SVC] MTU cambiado para $id: $mtu")
            }
        }
    }

    fun startAdvertising(): Boolean {
        if (!canAccessBluetooth() || !canAccessAdvertising()) return false
        if (isAdvertising) return true
        if (!serverReady) {
            Log.w(TAG, "Server no listo, no se puede anunciar")
            return false
        }
        val advertiser = bluetoothAdapter?.bluetoothLeAdvertiser ?: return false
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()
        val advertiseData = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(UUID.fromString(NEXO_SERVICE_UUID)))
            .build()
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build()
        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                Log.i(TAG, "[NAP-BLE-SVC] Advertising iniciado")
                sendBroadcast(Intent("com.nexo.ble.ADVERTISE_STARTED").apply {
                    putExtra("success", true)
                })
            }
            override fun onStartFailure(errorCode: Int) {
                isAdvertising = false
                Log.e(TAG, "[NAP-BLE-SVC] Advertising fallo: errorCode=$errorCode")
                sendBroadcast(Intent("com.nexo.ble.ADVERTISE_FAILED").apply {
                    putExtra("errorCode", errorCode)
                })
            }
        }
        try {
            advertiser.startAdvertising(settings, advertiseData, scanResponse, callback)
            return true
        } catch (e: Exception) {
            Log.e(TAG, "[NAP-BLE-SVC] Error advertising: ${e.message}")
            return false
        }
    }

    fun stopAdvertising() {
        if (!isAdvertising) return
        try {
            bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(object : AdvertiseCallback() {})
        } catch (e: SecurityException) { }
        isAdvertising = false
    }

    fun sendNotification(deviceId: String, data: ByteArray): Boolean {
        val device = serverConnections[deviceId] ?: return false
        val service = gattServer?.getService(UUID.fromString(NEXO_SERVICE_UUID)) ?: return false
        val char = service.getCharacteristic(UUID.fromString(NEXO_CHAR_TX)) ?: return false
        val descriptor = char.getDescriptor(UUID.fromString(CCCD_UUID))
        val isSubscribed = descriptor?.value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true
        if (!isSubscribed) return false
        char.value = data
        return gattServer?.notifyCharacteristicChanged(device, char, false) ?: false
    }

    private fun canAccessBluetooth(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun canAccessAdvertising(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED
        }
    }
}
