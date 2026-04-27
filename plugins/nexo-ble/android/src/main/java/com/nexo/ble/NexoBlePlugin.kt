package com.nexo.ble

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.nio.charset.Charset
import java.util.UUID

@CapacitorPlugin(
    name = "NexoBle",
    permissions = [
        Permission(strings = [android.Manifest.permission.BLUETOOTH_SCAN], alias = "bluetoothScan"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetoothConnect"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_ADVERTISE], alias = "bluetoothAdvertise"),
        Permission(strings = [android.Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [android.Manifest.permission.POST_NOTIFICATIONS], alias = "postNotifications"),
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE], alias = "foregroundService"),
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE], alias = "foregroundServiceConnectedDevice")
    ]
)
class NexoBlePlugin : Plugin() {

    companion object {
        private const val TAG = "NexoBlePlugin"
        private const val SCAN_TIMEOUT_MS = 15000L
    }

    private var messageReceiver: BroadcastReceiver? = null
    private var bluetoothScanner: BluetoothLeScanner? = null
    private var bluetoothGatt: BluetoothGatt? = null
    private var clientTxCharacteristic: BluetoothGattCharacteristic? = null
    private var clientRxCharacteristic: BluetoothGattCharacteristic? = null
    private val scanResults = mutableListOf<JSObject>()
    private var scanCall: PluginCall? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scanTimeoutRunnable = Runnable { stopScanInternal() }

    // ==================== PERMISSIONS ====================

    /**
     * Verifica el estado real de cada permiso BLE.
     *
     * FIX Bug 3: isPermanentlyDenied ahora requiere que el permiso haya sido
     * preguntado antes. En primera ejecución, shouldShowRationale=false NO significa
     * denegación permanente — usamos un flag en SharedPreferences para distinguirlo.
     *
     * FIX Bug 4: allGranted ya no exige POST_NOTIFICATIONS en el check inicial.
     * Las notificaciones se piden junto con BLE pero no bloquean la funcionalidad core.
     *
     * FIX Bug 5: En Android 14+, FOREGROUND_SERVICE_CONNECTED_DEVICE es runtime,
     * se verifica y se incluye en allGranted para que BleService no crashee.
     */
    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        val ctx = activity.applicationContext
        val prefs = ctx.getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
        val result = JSObject()

        val scanGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)
        val connectGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT)
        val advertiseGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE)
        val locationGranted = isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
        val notificationsGranted = isGranted(ctx, android.Manifest.permission.POST_NOTIFICATIONS)

        // FIX Bug 5: verificar FOREGROUND_SERVICE_CONNECTED_DEVICE en Android 14+
        val foregroundConnectedGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            isGranted(ctx, android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE)
        } else {
            true // No es runtime antes de Android 14
        }

        // FIX Bug 4: allGranted = permisos BLE core + foreground (necesario para BleService)
        // POST_NOTIFICATIONS es deseable pero no bloquea la funcionalidad BLE core
        val allGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            scanGranted && connectGranted && advertiseGranted && foregroundConnectedGranted
        } else {
            locationGranted
        }

        // FIX Bug 3: isPermanentlyDenied solo es true si YA se preguntó antes Y sigue denegado
        // Usamos SharedPreferences para recordar si el diálogo fue mostrado alguna vez
        val wasEverAsked = prefs.getBoolean("ble_permissions_asked", false)
        val isPermanentlyDenied = if (!allGranted && wasEverAsked) {
            val keyPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                android.Manifest.permission.BLUETOOTH_SCAN
            else
                android.Manifest.permission.ACCESS_FINE_LOCATION
            // Si nunca debe mostrar rationale Y ya fue preguntado = denegación permanente
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, keyPermission)
        } else {
            false // Primera ejecución nunca es permanently denied
        }

        result.put("scanGranted", scanGranted)
        result.put("connectGranted", connectGranted)
        result.put("advertiseGranted", advertiseGranted)
        result.put("locationGranted", locationGranted)
        result.put("notificationsGranted", notificationsGranted)
        result.put("foregroundConnectedGranted", foregroundConnectedGranted)
        result.put("allGranted", allGranted)
        result.put("isPermanentlyDenied", isPermanentlyDenied)
        result.put("wasEverAsked", wasEverAsked)

        Log.i(TAG, "checkBLEStatus: allGranted=$allGranted, permanent=$isPermanentlyDenied, wasAsked=$wasEverAsked")
        call.resolve(result)
    }

    /**
     * FIX Bug 1: Pedir TODOS los aliases en una sola llamada.
     * Android agrupa SCAN+CONNECT+ADVERTISE en "Dispositivos cercanos" —
     * si los pides separado, el sistema solo muestra el diálogo una vez
     * y descarta las solicitudes posteriores.
     *
     * FIX Bug 5: Incluir foregroundServiceConnectedDevice en Android 14+
     */
    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        val ctx = activity.applicationContext
        val alreadyGranted = checkCoreBLEPermissions(ctx)

        if (alreadyGranted) {
            Log.i(TAG, "initializeBLE: ya concedidos")
            call.resolve(JSObject().put("granted", true).put("isPermanentlyDenied", false))
            return
        }

        // Marcar que se va a preguntar (para Bug 3 fix)
        ctx.getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
            .edit().putBoolean("ble_permissions_asked", true).apply()

        // FIX Bug 1: Todos los aliases juntos en UNA sola llamada
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+: incluir foregroundServiceConnectedDevice
            requestPermissionForAliases(
                arrayOf(
                    "bluetoothScan",
                    "bluetoothConnect",
                    "bluetoothAdvertise",
                    "postNotifications",
                    "foregroundServiceConnectedDevice"
                ),
                call,
                "permissionsCallback"
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12-13
            requestPermissionForAliases(
                arrayOf(
                    "bluetoothScan",
                    "bluetoothConnect",
                    "bluetoothAdvertise",
                    "postNotifications"
                ),
                call,
                "permissionsCallback"
            )
        } else {
            // Android < 12
            requestPermissionForAliases(
                arrayOf("location", "postNotifications"),
                call,
                "permissionsCallback"
            )
        }
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        initializeBLE(call)
    }

    /**
     * FIX Bug 2: El callback ahora verifica el estado real post-diálogo
     * y devuelve granted + isPermanentlyDenied correctos al JS.
     */
    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)

        // FIX Bug 3: Ahora wasEverAsked=true, por lo que isPermanentlyDenied es confiable
        val isPermanent = if (!granted) {
            val key = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                android.Manifest.permission.BLUETOOTH_SCAN
            else
                android.Manifest.permission.ACCESS_FINE_LOCATION
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, key)
        } else {
            false
        }

        Log.i(TAG, "permissionsCallback: granted=$granted, isPermanentlyDenied=$isPermanent")
        call.resolve(
            JSObject()
                .put("dialogResponded", true)
                .put("granted", granted)
                .put("isPermanentlyDenied", isPermanent)
        )
    }

    // ==================== HELPERS ====================

    private fun isGranted(ctx: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * Verifica los permisos BLE core necesarios para que BleService funcione.
     * Separado de POST_NOTIFICATIONS que es deseable pero no crítico.
     */
    private fun checkCoreBLEPermissions(ctx: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN) &&
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT) &&
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE) &&
            isGranted(ctx, android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12-13
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN) &&
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT) &&
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE)
        } else {
            // Android < 12
            isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    // ==================== SERVER ====================

    @PluginMethod
    fun startBLEAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth desactivado")
            return
        }

        val intent = Intent(context, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }

        registerServerReceivers()
        call.resolve(JSObject().put("status", "advertising_started"))
    }

    @PluginMethod
    fun stopBLEAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        context.stopService(Intent(context, BleService::class.java))
        unregisterServerReceivers()
        call.resolve(JSObject().put("status", "advertising_stopped"))
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val message = call.getString("message") ?: ""

        if (bluetoothGatt != null && clientRxCharacteristic != null) {
            val data = message.toByteArray(Charset.defaultCharset())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val success = bluetoothGatt?.writeCharacteristic(
                    clientRxCharacteristic!!,
                    data,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                ) == BluetoothGatt.GATT_SUCCESS
                call.resolve(JSObject().put("sent", success).put("mode", "client"))
            } else {
                @Suppress("DEPRECATION")
                clientRxCharacteristic?.value = data
                @Suppress("DEPRECATION")
                val success = bluetoothGatt?.writeCharacteristic(clientRxCharacteristic) ?: false
                call.resolve(JSObject().put("sent", success).put("mode", "client"))
            }
            return
        }

        val context = activity.applicationContext
        val intent = Intent(NexoBleSpec.ACTION_BLE_SEND_MESSAGE).apply {
            putExtra(NexoBleSpec.EXTRA_MESSAGE_DATA, message)
            setPackage(context.packageName)
        }
        context.sendBroadcast(intent)
        call.resolve(JSObject().put("sent", true).put("mode", "server"))
    }

    @PluginMethod
    fun startListeningMessages(call: PluginCall) {
        registerServerReceivers()
        call.resolve(JSObject().put("listening", true))
    }

    // ==================== CLIENT ====================

    @PluginMethod
    fun scanForDevices(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth desactivado")
            return
        }

        bluetoothScanner = adapter.bluetoothLeScanner
        scanResults.clear()
        scanCall = call

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(NexoBleSpec.NEXO_SERVICE_UUID))
            .build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        try {
            bluetoothScanner?.startScan(listOf(filter), settings, scanCallback)
            mainHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
        } catch (e: SecurityException) {
            call.reject("Permiso BLUETOOTH_SCAN no concedido: ${e.message}")
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        stopScanInternal()
        call.resolve(JSObject().put("stopped", true))
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val address = call.getString("address") ?: ""
        if (address.isEmpty()) {
            call.reject("Dirección MAC requerida")
            return
        }

        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val device = bluetoothManager.adapter.getRemoteDevice(address)

        bluetoothGatt?.close()
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null

        bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattClientCallback)
        }

        call.resolve(JSObject().put("connecting", true).put("address", address))
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null
        call.resolve(JSObject().put("disconnected", true))
    }

    // ==================== CALLBACKS ====================

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.let { device ->
                val name = try { device.name } catch (e: SecurityException) { null } ?: "Unknown"
                val addr = device.address
                if (scanResults.none { it.getString("address") == addr }) {
                    val item = JSObject().apply {
                        put("name", name)
                        put("address", addr)
                        put("rssi", result.rssi)
                    }
                    scanResults.add(item)
                    notifyListeners("bleDeviceFound", JSObject().put("event", "deviceFound").put("device", item))
                }
            }
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "Scan failed: $errorCode")
            notifyListeners("bleScanFailed", JSObject().put("event", "scanFailed").put("errorCode", errorCode))
        }
    }

    private fun stopScanInternal() {
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try { bluetoothScanner?.stopScan(scanCallback) } catch (e: Exception) { Log.w(TAG, "Error stopping scan", e) }
        bluetoothScanner = null
        scanCall?.let { call ->
            if (call.isKeptAlive) {
                call.resolve(JSObject().put("devices", JSArray(scanResults)))
            }
            scanCall = null
        }
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val address = gatt.device?.address ?: ""
            Log.i(TAG, "Client connection $address status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                notifyListeners("bleClientConnected", JSObject().put("event", "clientConnected").put("address", address))
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                notifyListeners("bleClientDisconnected", JSObject().put("event", "clientDisconnected").put("address", address))
                bluetoothGatt?.close()
                bluetoothGatt = null
                clientTxCharacteristic = null
                clientRxCharacteristic = null
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            val service = gatt.getService(NexoBleSpec.NEXO_SERVICE_UUID) ?: return

            clientTxCharacteristic = service.getCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID)
            clientRxCharacteristic = service.getCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID)

            clientTxCharacteristic?.let { characteristic ->
                gatt.setCharacteristicNotification(characteristic, true)
                val descriptor = characteristic.getDescriptor(NexoBleSpec.CCCD_UUID)
                if (descriptor != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    } else {
                        @Suppress("DEPRECATION")
                        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        @Suppress("DEPRECATION")
                        gatt.writeDescriptor(descriptor)
                    }
                }
            }

            notifyListeners("bleClientReady", JSObject().put("event", "servicesDiscovered").put("ready", true))
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            // Deprecated en API 33 pero necesario para compatibilidad < API 33
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val message = characteristic.value?.toString(Charset.defaultCharset()) ?: ""
                val address = gatt.device?.address ?: ""
                Log.i(TAG, "Client received from $address: $message")
                notifyListeners(
                    "bleMessageReceived",
                    JSObject().put("event", "messageReceived").put("message", message).put("device", address)
                )
            }
        }

        // API 33+ override (evita warning de deprecación en builds modernos)
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val message = value.toString(Charset.defaultCharset())
                val address = gatt.device?.address ?: ""
                Log.i(TAG, "Client received (API33+) from $address: $message")
                notifyListeners(
                    "bleMessageReceived",
                    JSObject().put("event", "messageReceived").put("message", message).put("device", address)
                )
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            Log.i(TAG, "DescriptorWrite ${descriptor.uuid} status=$status")
        }
    }

    // ==================== RECEIVERS ====================

    private fun registerServerReceivers() {
        if (messageReceiver != null) return
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED -> {
                        val msg = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA) ?: ""
                        val device = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        notifyListeners(
                            "bleMessageReceived",
                            JSObject().put("event", "messageReceived").put("message", msg).put("device", device)
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED -> {
                        notifyListeners(
                            "bleDeviceConnected",
                            JSObject().put("event", "deviceConnected").put("device", intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS))
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED -> {
                        notifyListeners(
                            "bleDeviceDisconnected",
                            JSObject().put("event", "deviceDisconnected").put("device", intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS))
                        )
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED)
            addAction(NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED)
            addAction(NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            activity.registerReceiver(messageReceiver, filter)
        }
    }

    private fun unregisterServerReceivers() {
        messageReceiver?.let {
            try { activity.unregisterReceiver(it) } catch (e: IllegalArgumentException) {
                Log.w(TAG, "Receiver ya desregistrado")
            }
            messageReceiver = null
        }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        unregisterServerReceivers()
        stopScanInternal()
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
    }
}
