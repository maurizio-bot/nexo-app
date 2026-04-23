package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.*
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.nexo.ble.model.NexoGattService
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class BleService : Service() {
    companion object {
        const val TAG = "NAP-BLE-SVC"
        const val CHANNEL_ID = "nexo_ble_channel"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START = "com.nexo.ble.START"
        const val ACTION_STOP = "com.nexo.ble.STOP"
    }

    private val binder = LocalBinder()
    private var gattServer: BluetoothGattServer? = null
    private val serverConnections = ConcurrentHashMap<String, BluetoothDevice>()
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null
    private var isAdvertising = false
    private var serverReady = false
    private val handler = Handler(Looper.getMainLooper())

    inner class LocalBinder : Binder() {
        fun getService(): BleService = this@BleService
    }

    override fun onCreate() {
        super.onCreate()
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        createNotificationChannel()
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                startAsForeground()
                setupGattServer()
            }
        }
        return START_STICKY
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
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO BLE")
            .setContentText("Servidor P2P activo - esperando conexiones")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun setupGattServer() {
        if (gattServer != null) return
        if (!canAccessBluetooth()) {
            Log.w(TAG, "Sin permisos para setupGattServer")
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
            )
            val handshakeChar = BluetoothGattCharacteristic(
                NexoGattService.HANDSHAKE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE,
                BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            val payloadChar = BluetoothGattCharacteristic(
                NexoGattService.PAYLOAD_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            payloadChar.addDescriptor(BluetoothGattDescriptor(
                NexoGattService.CLIENT_CONFIG_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            ))
            val controlChar = BluetoothGattCharacteristic(
                NexoGattService.CONTROL_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_READ or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
            )
            controlChar.addDescriptor(BluetoothGattDescriptor(
                NexoGattService.CLIENT_CONFIG_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            ))

            service.addCharacteristic(announceChar)
            service.addCharacteristic(handshakeChar)
            service.addCharacteristic(payloadChar)
            service.addCharacteristic(controlChar)

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
                Log.i(TAG, "[NAP-BLE-SVC] Servicio NEXO registrado en stack Bluetooth")
                sendBroadcast(Intent("com.nexo.ble.SERVER_READY").apply {
                    putExtra("ready", true)
                    putExtra("serviceUuid", NexoGattService.SERVICE_UUID.toString())
                })
            } else {
                serverReady = false
                Log.e(TAG, "[NAP-BLE-SVC] Fallo al registrar servicio: status=$status uuid=${service?.uuid}")
            }
        }

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    serverConnections[device.address] = device
                    Log.i(TAG, "[NAP-BLE-SVC] Dispositivo conectado ENTRANTE: ${device.address}")
                    sendBroadcast(Intent("com.nexo.ble.DEVICE_CONNECTED").apply {
                        putExtra("deviceId", device.address)
                        putExtra("direction", "incoming")
                    })
                    handler.postDelayed({
                        sendBroadcast(Intent("com.nexo.ble.SERVICES_READY").apply {
                            putExtra("deviceId", device.address)
                            putExtra("ready", true)
                            putExtra("direction", "incoming")
                            putExtra("role", "server")
                        })
                    }, 500)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    serverConnections.remove(device.address)
                    Log.i(TAG, "[NAP-BLE-SVC] Dispositivo desconectado: ${device.address}")
                    sendBroadcast(Intent("com.nexo.ble.DEVICE_DISCONNECTED").apply {
                        putExtra("deviceId", device.address)
                    })
                }
            }
        }

        override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
            try {
                val value = when (characteristic.uuid) {
                    NexoGattService.ANNOUNCE_CHAR_UUID -> {
                        val data = org.json.JSONObject()
                        data.put("userId", "service_user")
                        data.put("userName", "NEXO Service")
                        data.put("timestamp", System.currentTimeMillis())
                        data.put("napVersion", "5.0.0-ARCH")
                        data.toString().toByteArray()
                    }
                    else -> byteArrayOf()
                }
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
            } catch (e: SecurityException) { }
        }

        override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                value?.let { data ->
                    when (characteristic.uuid) {
                        NexoGattService.PAYLOAD_CHAR_UUID -> {
                            sendBroadcast(Intent("com.nexo.ble.PAYLOAD_RECEIVED").apply {
                                putExtra("deviceId", device.address)
                                putExtra("data", data)
                                putExtra("source", "server_write_request")
                            })
                        }
                        NexoGattService.CONTROL_CHAR_UUID -> {
                            val cmd = String(data)
                            if (cmd == "ping") {
                                val svc = gattServer?.getService(NexoGattService.SERVICE_UUID)
                                val ctrl = svc?.getCharacteristic(NexoGattService.CONTROL_CHAR_UUID)
                                ctrl?.value = "pong".toByteArray()
                                gattServer?.notifyCharacteristicChanged(device, ctrl, false)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "[NAP-BLE-SVC] Excepción writeRequest: ${e.message}")
            }
        }

        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                if (descriptor.uuid == NexoGattService.CLIENT_CONFIG_UUID) {
                    descriptor.value = value
                    val enabled = value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    sendBroadcast(Intent("com.nexo.ble.NOTIFICATION_STATE").apply {
                        putExtra("deviceId", device.address)
                        putExtra("enabled", enabled)
                    })
                }
            } catch (e: SecurityException) { }
        }
    }

    fun startAdvertising(): Boolean {
        if (!canAccessBluetooth() || !canAccessAdvertising()) return false
        if (isAdvertising) return true
        if (!serverReady) {
            Log.w(TAG, "Server no listo, no se puede anunciar")
            return false
        }

        try {
            advertiser = bluetoothAdapter?.bluetoothLeAdvertiser ?: return false
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

            advertiseCallback = object : AdvertiseCallback() {
                override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                    isAdvertising = true
                    Log.i(TAG, "[NAP-BLE-SVC] Advertising iniciado")
                    sendBroadcast(Intent("com.nexo.ble.ADVERTISE_STARTED").apply {
                        putExtra("success", true)
                    })
                }
                override fun onStartFailure(errorCode: Int) {
                    isAdvertising = false
                    Log.e(TAG, "[NAP-BLE-SVC] Advertising falló: $errorCode")
                    sendBroadcast(Intent("com.nexo.ble.ADVERTISE_FAILED").apply {
                        putExtra("errorCode", errorCode)
                    })
                }
            }
            advertiser?.startAdvertising(settings, advertiseData, scanResponse, advertiseCallback!!)
            return true
        } catch (e: Exception) {
            Log.e(TAG, "[NAP-BLE-SVC] Error advertising: ${e.message}")
            return false
        }
    }

    fun stopAdvertising() {
        if (!isAdvertising) return
        try {
            advertiseCallback?.let { advertiser?.stopAdvertising(it) }
            isAdvertising = false
            advertiseCallback = null
        } catch (e: SecurityException) { }
    }

    fun isServerReady(): Boolean = serverReady
    fun isAdvertisingActive(): Boolean = isAdvertising
    fun getServerConnections(): Map<String, BluetoothDevice> = serverConnections.toMap()

    fun notifyClient(deviceId: String, data: ByteArray): Boolean {
        val device = serverConnections[deviceId] ?: return false
        val service = gattServer?.getService(NexoGattService.SERVICE_UUID) ?: return false
        val char = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID) ?: return false
        val descriptor = char.getDescriptor(NexoGattService.CLIENT_CONFIG_UUID)
        val isSubscribed = descriptor?.value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true
        if (!isSubscribed) return false
        return try {
            char.value = data
            gattServer?.notifyCharacteristicChanged(device, char, false) ?: false
        } catch (e: Exception) { false }
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
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED
        }
    }

    fun cleanup() {
        stopAdvertising()
        serverConnections.clear()
        gattServer?.close()
        gattServer = null
        serverReady = false
    }

    override fun onDestroy() {
        cleanup()
        super.onDestroy()
    }
}

