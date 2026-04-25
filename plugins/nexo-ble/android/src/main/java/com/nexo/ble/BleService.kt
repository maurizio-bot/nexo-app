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
import com.nexo.ble.model.NexoGattService
import org.json.JSONObject
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val CHANNEL_ID = "nexo_ble_channel"
        private const val NOTIFICATION_ID = 1001
    }

    private val binder = LocalBinder()
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    private val serverConnections = ConcurrentHashMap<String, BluetoothDevice>()
    private val serverConnectionStates = ConcurrentHashMap<String, String>()
    private var isAdvertising = false
    private var serverReady = false
    private val handler = Handler(Looper.getMainLooper())
    private var advertiseCallback: AdvertiseCallback? = null

    private var localUserId: String = ""
    private var localUserName: String = "NEXO User"

    interface ServiceInterface {
        fun sendNotification(deviceId: String, data: ByteArray): Boolean
        fun getConnectedDeviceIds(): List<String>
        fun isServerReady(): Boolean
        fun startAdvertising(): Boolean
        fun stopAdvertising()
        fun isAdvertising(): Boolean
        fun setLocalUserInfo(userId: String, userName: String)
    }

    inner class LocalBinder : Binder() {
        fun getService(): ServiceInterface = object : ServiceInterface {
            override fun sendNotification(deviceId: String, data: ByteArray): Boolean =
                this@BleService.sendNotification(deviceId, data)
            override fun getConnectedDeviceIds(): List<String> =
                this@BleService.serverConnections.keys.toList()
            override fun isServerReady(): Boolean = this@BleService.serverReady
            override fun startAdvertising(): Boolean = this@BleService.startAdvertising()
            override fun stopAdvertising() = this@BleService.stopAdvertising()
            override fun isAdvertising(): Boolean = this@BleService.isAdvertising
            override fun setLocalUserInfo(userId: String, userName: String) {
                this@BleService.localUserId = userId
                this@BleService.localUserName = userName
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "[NAP-BLE-SVC] onCreate")
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "[NAP-BLE-SVC] onStartCommand")
        startAsForeground()
        localUserId = intent?.getStringExtra("userId") ?: ""
        localUserName = intent?.getStringExtra("userName") ?: "NEXO User"
        setupGattServer()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "[NAP-BLE-SVC] onDestroy")
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
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
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
            Log.w(TAG, "[NAP-BLE-SVC] Sin permisos para setupGattServer")
            return
        }
        try {
            val service = BluetoothGattService(
                NexoGattService.SERVICE_UUID,
                BluetoothGattService.SERVICE_TYPE_PRIMARY
            )

            val announceChar = BluetoothGattCharacteristic(
                NexoGattService.ANNOUNCE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ
            ).apply {
                addDescriptor(BluetoothGattDescriptor(
                    NexoGattService.CLIENT_CONFIG_UUID,
                    BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
                ))
            }

            val payloadChar = BluetoothGattCharacteristic(
                NexoGattService.PAYLOAD_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                        BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                        BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
            ).apply {
                addDescriptor(BluetoothGattDescriptor(
                    NexoGattService.CLIENT_CONFIG_UUID,
                    BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
                ))
            }

            val handshakeChar = BluetoothGattCharacteristic(
                NexoGattService.HANDSHAKE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
            )

            service.addCharacteristic(announceChar)
            service.addCharacteristic(payloadChar)
            service.addCharacteristic(handshakeChar)

            gattServer = bluetoothManager?.openGattServer(this, gattServerCallback)
            gattServer?.addService(service)
            Log.i(TAG, "[NAP-BLE-SVC] GattServer abierto, servicio en cola de registro")
        } catch (e: Exception) {
            Log.e(TAG, "[NAP-BLE-SVC] Error setupGattServer: ${e.message}")
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
            if (status == BluetoothGatt.GATT_SUCCESS && service?.uuid == NexoGattService.SERVICE_UUID) {
                serverReady = true
                Log.i(TAG, "[NAP-BLE-SVC] Servicio NEXO registrado")
                sendBroadcast(Intent("com.nexo.ble.SERVER_READY").apply {
                    putExtra("ready", true)
                })
            } else {
                serverReady = false
                Log.e(TAG, "[NAP-BLE-SVC] Fallo al registrar servicio: status=$status")
            }
        }

        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            val dev = device ?: return
            val id = dev.address ?: return
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    serverConnections[id] = dev
                    serverConnectionStates[id] = "connected"
                    Log.i(TAG, "[NAP-BLE-SVC] Dispositivo conectado ENTRANTE: $id")
                    sendBroadcast(Intent("com.nexo.ble.DEVICE_CONNECTED").apply {
                        putExtra("deviceId", id)
                        putExtra("direction", "incoming")
                        putExtra("name", dev.name ?: "NEXO Peer")
                    })
                    handler.postDelayed({
                        if (serverConnections.containsKey(id)) {
                            sendBroadcast(Intent("com.nexo.ble.SERVICES_READY").apply {
                                putExtra("deviceId", id)
                                putExtra("ready", true)
                                putExtra("direction", "incoming")
                            })
                        }
                    }, 800)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    serverConnections.remove(id)
                    serverConnectionStates.remove(id)
                    Log.i(TAG, "[NAP-BLE-SVC] Dispositivo desconectado: $id")
                    sendBroadcast(Intent("com.nexo.ble.DEVICE_DISCONNECTED").apply {
                        putExtra("deviceId", id)
                        putExtra("reason", "Server disconnected")
                    })
                }
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice?, requestId: Int, offset: Int,
            characteristic: BluetoothGattCharacteristic?
        ) {
            val dev = device ?: return
            val char = characteristic ?: return
            val value = when (char.uuid) {
                NexoGattService.ANNOUNCE_CHAR_UUID -> {
                    JSONObject().apply {
                        put("userId", localUserId)
                        put("userName", localUserName)
                        put("timestamp", System.currentTimeMillis())
                        put("appVersion", "5.1.0-ARCH")
                    }.toString().toByteArray(Charsets.UTF_8)
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
            when (char.uuid) {
                NexoGattService.PAYLOAD_CHAR_UUID -> {
                    val payload = String(data, Charsets.UTF_8)
                    Log.d(TAG, "[NAP-BLE-SVC] PAYLOAD RECIBIDO de ${dev.address}: ${payload.take(200)}")
                    sendBroadcast(Intent("com.nexo.ble.PAYLOAD_RECEIVED").apply {
                        putExtra("deviceId", dev.address)
                        putExtra("data", payload)
                        putExtra("source", "server_direct")
                    })
                }
                NexoGattService.HANDSHAKE_CHAR_UUID -> {
                    val payload = String(data, Charsets.UTF_8)
                    Log.d(TAG, "[NAP-BLE-SVC] HANDSHAKE de ${dev.address}: $payload")
                    sendBroadcast(Intent("com.nexo.ble.HANDSHAKE_RECEIVED").apply {
                        putExtra("deviceId", dev.address)
                        putExtra("data", payload)
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
            if (desc.uuid == NexoGattService.CLIENT_CONFIG_UUID) {
                val id = dev.address ?: return
                val enabled = value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true
                Log.i(TAG, "[NAP-BLE-SVC] CCCD escrito por $id: enabled=$enabled")
                if (enabled) serverConnectionStates[id] = "ready"
                sendBroadcast(Intent("com.nexo.ble.NOTIFICATION_STATE").apply {
                    putExtra("deviceId", id)
                    putExtra("enabled", enabled)
                })
            }
        }

        override fun onMtuChanged(device: BluetoothDevice?, mtu: Int) {
            val id = device?.address
            if (!id.isNullOrEmpty()) {
                Log.i(TAG, "[NAP-BLE-SVC] MTU cambiado para $id: $mtu")
            }
        }
    }

    fun startAdvertising(): Boolean {
        if (!canAccessBluetooth() || !canAccessAdvertising()) return false
        if (isAdvertising) return true
        if (!serverReady) {
            Log.w(TAG, "[NAP-BLE-SVC] Server no listo, no se puede anunciar")
            return false
        }
        val advertiser = bluetoothAdapter?.bluetoothLeAdvertiser ?: return false
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()
        val advertiseData = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(NexoGattService.SERVICE_UUID))
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
        advertiseCallback = callback
        return try {
            advertiser.startAdvertising(settings, advertiseData, scanResponse, callback)
            true
        } catch (e: Exception) {
            Log.e(TAG, "[NAP-BLE-SVC] Error advertising: ${e.message}")
            false
        }
    }

    fun stopAdvertising() {
        if (!isAdvertising) return
        try {
            advertiseCallback?.let {
                bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(it)
            }
        } catch (e: SecurityException) { }
        isAdvertising = false
        advertiseCallback = null
    }

    fun sendNotification(deviceId: String, data: ByteArray): Boolean {
        val device = serverConnections[deviceId] ?: return false
        val service = gattServer?.getService(NexoGattService.SERVICE_UUID) ?: return false
        val char = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID) ?: return false
        val descriptor = char.getDescriptor(NexoGattService.CLIENT_CONFIG_UUID)
        val isSubscribed = descriptor?.value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true
        if (!isSubscribed) {
            Log.w(TAG, "[NAP-BLE-SVC] Device $deviceId no está suscrito a notificaciones")
            return false
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gattServer?.notifyCharacteristicChanged(device, char, false, data) ?: false
        } else {
            @Suppress("DEPRECATION")
            char.value = data
            gattServer?.notifyCharacteristicChanged(device, char, false) ?: false
        }
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
