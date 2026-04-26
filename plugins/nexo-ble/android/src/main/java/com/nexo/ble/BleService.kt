package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.nexo.ble.model.NexoGattService

class BleService : Service() {

    private var gattServer: BluetoothGattServer? = null
    private val connectedDevices = mutableMapOf<String, BluetoothDevice>()
    private val handler = Handler(Looper.getMainLooper())

    private val commandReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_SEND_DATA -> {
                    val address = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val data = intent.getStringExtra(EXTRA_DATA) ?: return
                    val charType = intent.getStringExtra(EXTRA_CHAR_TYPE) ?: "payload"
                    sendNotificationToDevice(address, data, charType)
                }
                ACTION_STOP_SERVICE -> stopSelf()
            }
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            device ?: return
            val address = device.address
            if (address.isNullOrEmpty()) return

            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedDevices[address] = device
                    broadcastUpdate(ACTION_DEVICE_CONNECTED, address)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedDevices.remove(address)
                    broadcastUpdate(ACTION_DEVICE_DISCONNECTED, address)
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice?,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic?,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            val targetDevice = device ?: return
            val char = characteristic ?: return
            val address = targetDevice.address
            if (address.isNullOrEmpty()) return

            val charUuid = char.uuid
            if (charUuid == NexoGattService.HANDSHAKE_CHAR_UUID ||
                charUuid == NexoGattService.PAYLOAD_CHAR_UUID ||
                charUuid == NexoGattService.CONTROL_CHAR_UUID
            ) {
                if (responseNeeded) {
                    gattServer?.sendResponse(targetDevice, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
                value?.let { bytes ->
                    val data = String(bytes, Charsets.UTF_8)
                    val type = when (charUuid) {
                        NexoGattService.HANDSHAKE_CHAR_UUID -> "handshake"
                        NexoGattService.CONTROL_CHAR_UUID -> "control"
                        else -> "payload"
                    }
                    broadcastUpdate(ACTION_DATA_RECEIVED, address, data, type)
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice?,
            requestId: Int,
            descriptor: BluetoothGattDescriptor?,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
        }

        override fun onNotificationSent(device: BluetoothDevice?, status: Int) {}
    }

    override fun onCreate() {
        super.onCreate()
        startForegroundService()
        initializeGattServer()
        registerCommandReceiver()
    }

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    private fun registerCommandReceiver() {
        val filter = IntentFilter().apply {
            addAction(ACTION_SEND_DATA)
            addAction(ACTION_STOP_SERVICE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(commandReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(commandReceiver, filter)
        }
    }

    private fun initializeGattServer() {
        val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        gattServer = bluetoothManager.openGattServer(this, gattServerCallback)

        val service = android.bluetooth.BluetoothGattService(
            NexoGattService.SERVICE_UUID,
            android.bluetooth.BluetoothGattService.SERVICE_TYPE_PRIMARY
        )

        val announceChar = BluetoothGattCharacteristic(
            NexoGattService.ANNOUNCE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        val announceCccd = BluetoothGattDescriptor(
            NexoGattService.CLIENT_CONFIG_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
        announceChar.addDescriptor(announceCccd)

        val handshakeChar = BluetoothGattCharacteristic(
            NexoGattService.HANDSHAKE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        val payloadChar = BluetoothGattCharacteristic(
            NexoGattService.PAYLOAD_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        val payloadCccd = BluetoothGattDescriptor(
            NexoGattService.CLIENT_CONFIG_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
        payloadChar.addDescriptor(payloadCccd)

        val controlChar = BluetoothGattCharacteristic(
            NexoGattService.CONTROL_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        service.addCharacteristic(announceChar)
        service.addCharacteristic(handshakeChar)
        service.addCharacteristic(payloadChar)
        service.addCharacteristic(controlChar)

        gattServer?.addService(service)
    }

    private fun sendNotificationToDevice(address: String, data: String, charType: String): Boolean {
        val device = connectedDevices[address] ?: return false
        val service = gattServer?.getService(NexoGattService.SERVICE_UUID) ?: return false

        val charUuid = when (charType) {
            "announce" -> NexoGattService.ANNOUNCE_CHAR_UUID
            "payload" -> NexoGattService.PAYLOAD_CHAR_UUID
            else -> NexoGattService.PAYLOAD_CHAR_UUID
        }

        val characteristic = service.getCharacteristic(charUuid) ?: return false
        val bytes = data.toByteArray(Charsets.UTF_8)

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gattServer?.notifyCharacteristicChanged(device, characteristic, false, bytes) == true
        } else {
            @Suppress("DEPRECATION")
            characteristic.value = bytes
            gattServer?.notifyCharacteristicChanged(device, characteristic, false) == true
        }
    }

    private fun broadcastUpdate(action: String, address: String, data: String? = null, type: String? = null) {
        val intent = Intent(action).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, address)
            data?.let { putExtra(EXTRA_DATA, it) }
            type?.let { putExtra(EXTRA_CHAR_TYPE, it) }
        }
        sendBroadcast(intent)
    }

    private fun startForegroundService() {
        val channelId = createNotificationChannel()
        val notificationIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE)

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("NEXO BLE")
            .setContentText("Servicio activo - Esperando conexiones NEXO")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel(): String {
        val channelId = "nexo_ble_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "NEXO BLE Service", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
        return channelId
    }

    override fun onDestroy() {
        try { unregisterReceiver(commandReceiver) } catch (e: IllegalArgumentException) {}
        gattServer?.close()
        gattServer = null
        connectedDevices.clear()
        super.onDestroy()
    }

    companion object {
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.ACTION_DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.ACTION_DEVICE_DISCONNECTED"
        const val ACTION_DATA_RECEIVED = "com.nexo.ble.ACTION_DATA_RECEIVED"
        const val ACTION_SEND_DATA = "com.nexo.ble.ACTION_SEND_DATA"
        const val ACTION_STOP_SERVICE = "com.nexo.ble.ACTION_STOP_SERVICE"
        const val EXTRA_DEVICE_ADDRESS = "device_address"
        const val EXTRA_DATA = "data"
        const val EXTRA_CHAR_TYPE = "char_type"
        private const val NOTIFICATION_ID = 1
    }
}
