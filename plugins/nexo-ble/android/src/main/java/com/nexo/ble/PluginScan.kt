package com.nexo.ble

import android.app.ActivityManager
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.nexo.ble.NexoBlePlugin.Companion.SCAN_TIMEOUT_MS
import com.nexo.ble.NexoBlePlugin.Companion.MANUFACTURER_ID
import com.nexo.ble.NexoBlePlugin.Companion.NEXO_MAGIC_HIGH
import com.nexo.ble.NexoBlePlugin.Companion.NEXO_MAGIC_LOW
import com.nexo.ble.NexoBlePlugin.Companion.SCAN_DEBOUNCE_MS
import com.nexo.ble.NexoBlePlugin.Companion.MIN_RSSI
import com.nexo.ble.NexoBlePlugin.Companion.netBgShared

// Bluetooth: escaneo, anuncio y servicio en primer plano.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

internal fun NexoBlePlugin.setAdvertisingDataImpl(call: PluginCall) {
    val nexoId = call.getString("nexoId") ?: run {
        call.reject("nexoId requerido")
        return
    }
    nexoAdvertisingId = nexoId
    val rk = call.getString("ridKey")
    if (rk != null && rk.length == 64 && rk.all { it in '0'..'9' || it in 'a'..'f' }) {
        ridKey = rk
        ridVisibleUntil = (call.getDouble("visibleUntil") ?: 0.0).toLong()
        ridEpochS = (call.getInt("epochS") ?: 900).toLong().coerceAtLeast(1L)
    } else if (rk != null) ridKey = null
    remLog("INFO", "ADVERTISING", "NEXO ID set: $nexoId" + if (ridKey != null) (if (System.currentTimeMillis() < ridVisibleUntil) " (visible ${(ridVisibleUntil - System.currentTimeMillis()) / 1000} s)" else " (código rotativo)") else "")
    val ctx = activity.applicationContext
    val intent = Intent(ctx, BleService::class.java)
    intent.putExtra("nexo_advertising_id", nexoId)
    putRidExtras(intent)
    intent.putExtra("action", "UPDATE_ADVERTISING_DATA")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
    } else {
        ctx.startService(intent)
    }
    call.resolve(JSObject().put("set", true).put("nexoId", nexoId))
}

internal fun NexoBlePlugin.startAdvertisingImpl(call: PluginCall) {
    remLog("INFO", "ADVERTISING", "startAdvertising")
    val ctx = activity.applicationContext
    val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = bluetoothManager.adapter
    if (adapter == null || !adapter.isEnabled) {
        call.reject("Bluetooth desactivado")
        return
    }
    if (!checkCoreBLEPermissions(ctx)) {
        call.reject("Permisos BLE no concedidos")
        return
    }
    autoStartGattServerAndAdvertising()
    call.resolve(JSObject().put("started", true))
}

internal fun NexoBlePlugin.startScanImpl(call: PluginCall) {
    remLog("INFO", "SCAN", "startScan")
    val ctx = activity.applicationContext
    val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = bluetoothManager.adapter
    if (adapter == null || !adapter.isEnabled) {
        call.reject("Bluetooth desactivado")
        return
    }
    val hasScanPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)
    } else {
        isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
    }
    if (!hasScanPermission) {
        call.reject("BLUETOOTH_SCAN/LOCATION no concedido")
        return
    }
    autoStartGattServerAndAdvertising()
    bluetoothScanner = adapter.bluetoothLeScanner
    // 3264 (S23 21-11 05:58:21: «No hay device cacheado para 40f6b02aa058, no se puede reconectar», 5 s después de verlo): los
    // teléfonos vistos ya NO se olvidan al empezar o parar un escaneo (la reconexión nativa los necesita justo entonces). 23-11: el
    // tope lo lleva scanBook (olvida los que hace más que no se oyen, nunca todos de golpe: en una multitud el tope de 400 se pasaba
    // enseguida y se olvidaba también al contacto que se iba a reconectar)
    scanBook.resetNotify()
    val settings = scanSettings()
    // filtered=true (re-búsqueda con la app oculta): solo anuncios NEXO. Sin filtro Android no
    // entrega resultados con la pantalla apagada.
    val filters = if (call.getBoolean("filtered", false) == true) listOf(
        ScanFilter.Builder()
            .setManufacturerData(MANUFACTURER_ID, byteArrayOf(NEXO_MAGIC_HIGH, NEXO_MAGIC_LOW), byteArrayOf(0xFF.toByte(), 0xFF.toByte()))
            .build()
    ) else emptyList()
    try {
        bluetoothScanner?.startScan(filters, settings, scanCallback)
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        mainHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
        call.resolve(JSObject().put("started", true))
    } catch (e: SecurityException) {
        call.reject("Permiso BLUETOOTH_SCAN no concedido")
    }
}

internal fun NexoBlePlugin.stopScanImpl(call: PluginCall) {
    stopScanInternal()
    call.resolve(JSObject().put("stopped", true))
}

internal fun NexoBlePlugin.stopScanInternal() {
    mainHandler.removeCallbacks(scanTimeoutRunnable)
    try { bluetoothScanner?.stopScan(scanCallback) } catch (e: Exception) { }
    bluetoothScanner = null
}

internal fun NexoBlePlugin.extractNexoIdFromScanRecord(scanRecord: android.bluetooth.le.ScanRecord?): String? {
    if (scanRecord == null) return null
    val manufacturerData = scanRecord.manufacturerSpecificData ?: return null
    if (manufacturerData.size() == 0) return null
    for (i in 0 until manufacturerData.size()) {
        val key = manufacturerData.keyAt(i)
        val data = manufacturerData.get(key) ?: continue
        if (data.size >= 4) {
            val b0 = data[0].toInt() and 0xFF
            val b1 = data[1].toInt() and 0xFF
            if (b0 == 0x4E && b1 == 0x58) {
                val nexoId = String(data, 2, data.size - 2, Charsets.UTF_8)
                // Auditoría (ronda 2774): el anuncio lo pone cualquiera por radio. Solo se acepta si tiene la forma de
                // un NEXO ID (nx + 8) o de un código rotativo (R + 9 en base32): así un anuncio con basura no llega a
                // la app como un "dispositivo" ni envenena el mapa NEXO ID→dirección.
                if (!AdvertisedId.valid(nexoId)) {
                    remLog("WARN", "SCAN", "Anuncio NEXO con ID mal formado en 0x${key.toString(16)}: se ignora")
                    return null
                }
                // (la línea "Device found" del escaneo ya anota el NEXO ID por dispositivo y con límite de frecuencia)
                return nexoId
            }
        }
    }
    return null
}

private fun NexoBlePlugin.codedSupported(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    return try {
        val bm = activity.applicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bm.adapter?.isLeCodedPhySupported == true
    } catch (e: Exception) { false }
}

// Escaneo: con largo alcance también los anuncios extendidos en LE Coded (setLegacy(false) entrega los dos)
internal fun NexoBlePlugin.scanSettings(): ScanSettings {
    val b = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
    if (codedSupported()) b.setLegacy(false).setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED)
    return b.build()
}

// Conectar: en LE Coded solo si ese teléfono solo se ve por largo alcance (en 1M es más rápido)
internal fun NexoBlePlugin.connectLe(ctx: Context, device: BluetoothDevice, macNorm: String): BluetoothGatt? {
    val now = System.currentTimeMillis()
    val coded = codedSupported() && now - scanBook.seenCoded(macNorm) < 60000L && now - scanBook.seen1M(macNorm) > 10000L
    if (coded) codedLinks.add(macNorm) else codedLinks.remove(macNorm)
    if (coded && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        remLog("INFO", "GATT_CLIENT", "Conectando a $macNorm por largo alcance (LE Coded)")
        return device.connectGatt(ctx, false, createGattClientCallback(macNorm), BluetoothDevice.TRANSPORT_LE,
            BluetoothDevice.PHY_LE_1M_MASK or BluetoothDevice.PHY_LE_CODED_MASK)
    }
    return device.connectGatt(ctx, false, createGattClientCallback(macNorm), BluetoothDevice.TRANSPORT_LE)
}

internal fun NexoBlePlugin.newScanCallback(): ScanCallback = object : ScanCallback() {
    // 23-11 (multitud / EDC, docs/EDC_LIMITES.md cambios 4–5): con cientos de NEXO alrededor llegan miles de anuncios por segundo.
    // Con CADA anuncio solo se hace lo mínimo (apuntar que se oyó); el resto —leer quién es, el mapa, el registro y armar el aviso—
    // una vez por segundo y dirección, y los avisos a la app salen en tandas cuando hay muchos (ScanBook.kt).
    override fun onScanResult(callbackType: Int, result: ScanResult?) {
        val device = result?.device ?: return
        val rssi = result.rssi
        if (rssi < MIN_RSSI) return
        val addr = device.address
        val macNorm = normalizeMac(addr)
        val now = System.currentTimeMillis()
        val coded = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && result.primaryPhy == BluetoothDevice.PHY_LE_CODED

        scannedDevices[macNorm] = device
        // lo que el libro olvida por el tope se suelta aquí también (salvo con quien hay enlace)
        scanBook.seen(macNorm, coded, now).forEach { if (!gattClients.containsKey(it) && !serverConnectedDevices.containsKey(it)) scannedDevices.remove(it) }
        if (!scanBook.due(macNorm, now)) return

        val nexoId = extractNexoIdFromScanRecord(result.scanRecord)
        var prio = false
        if (nexoId != null) {
            registerNexoMapping(nexoId, addr)
            // 3271/3279: para la bandeja de salida (OutboxDial). Lo anunciado casi siempre es el código rotativo: se apunta solo si
            // es de un contacto con algo pendiente (OutboxRid lo reconoce con la clave de sus códigos). Ese contacto es PRIORITARIO:
            // su aviso sale al momento aunque haya multitud
            try {
                val ob = netBgShared?.outbox
                if (ob != null && ob.size() > 0) outRid.resolve(nexoId, ob.ridKeys(), ob.ridEpochS)?.let { who ->
                    if (outSeen.size > 200) outSeen.clear()
                    outSeen[who] = macNorm to now
                    prio = true
                }
            } catch (e: Throwable) { }
        }

        val name = result.scanRecord?.deviceName ?: try { device.name } catch (e: SecurityException) { null } ?: "Unknown"
        // al registro nativo: como mucho 1 vez cada 20 s por dispositivo
        if (scanBook.shouldLog(macNorm, now)) remLog("INFO", "SCAN", "Device found: $name ($addr) NEXO=$nexoId rssi=$rssi - cacheado")

        val item = JSObject().apply {
            put("deviceId", addr)
            put("name", name)
            put("rssi", rssi)
            if (nexoId != null) {
                put("nexoId", nexoId)
            }
            // 3009: visto por el conjunto de anuncio de LARGO ALCANCE (LE Coded, otra dirección del mismo teléfono): la app no
            // se conecta a esa copia si al mismo teléfono lo ve cerca por la dirección normal (ble_interface._onScanFound)
            if (coded) put("coded", true)
        }
        if (scanBook.offer(macNorm, item, rssi, prio, now)) notifyListeners("onDeviceFound", item)
        else if (!scanFlushScheduled) { scanFlushScheduled = true; mainHandler.postDelayed(scanFlushRunnable, scanBook.batchMs) }
    }

    override fun onScanFailed(errorCode: Int) {
        notifyListeners("onScanFailed", JSObject().put("errorCode", errorCode))
    }
}

internal fun NexoBlePlugin.isBluetoothEnabledImpl(call: PluginCall) {
    val ctx = activity.applicationContext
    val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = bluetoothManager.adapter
    val enabled = adapter != null && adapter.isEnabled
    call.resolve(JSObject()
        .put("enabled", enabled)
        .put("canAdvertise", enabled && isAdvertisingActive)
        .put("serverReady", bluetoothGattServer != null)
    )
}

internal fun NexoBlePlugin.getLocalDeviceInfoImpl(call: PluginCall) {
    val ctx = activity.applicationContext
    val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = bluetoothManager.adapter
    call.resolve(JSObject()
        .put("deviceName", adapter?.name ?: "NEXO Device")
        .put("deviceAddress", try { adapter?.address ?: "" } catch (e: SecurityException) { "" })
        .put("codedPhy", codedSupported()) // largo alcance (LE Coded PHY)
    )
}

internal fun NexoBlePlugin.getConnectedDevicesImpl(call: PluginCall) {
    val devices = JSArray()
    gattClients.forEach { (mac, gatt) ->
        val state = clientConnectionStates[mac] ?: BluetoothProfile.STATE_DISCONNECTED
        if (state == BluetoothProfile.STATE_CONNECTED) {
            val addr = gatt.device?.address ?: mac.chunked(2).joinToString(":").uppercase()
            val device = JSObject()
                .put("id", addr)
                .put("address", addr)
                .put("name", try { gatt.device?.name } catch (e: SecurityException) { null } ?: "NEXO Peer")
                .put("direction", "outgoing")
                .put("role", "client")
                .put("ready", clientRxCharacteristics.containsKey(mac))
            devices.put(device)
        }
    }
    serverConnectedDevices.forEach { (mac, device) ->
        val item = JSObject()
            .put("id", device.address)
            .put("address", device.address)
            .put("name", try { device.name } catch (e: SecurityException) { null } ?: "NEXO Peer")
            .put("direction", "incoming")
            .put("role", "server")
            .put("ready", serverNotificationEnabled.getOrDefault(mac, false))
        devices.put(item)
    }
    call.resolve(JSObject().put("devices", devices))
}

internal fun NexoBlePlugin.registerServerReceivers() {
    if (messageReceiver != null) return
    messageReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED -> {
                    val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                    notifyListeners("onDeviceConnected", JSObject()
                        .put("deviceId", addr)
                        .put("direction", "incoming")
                        .put("role", "server")
                    )
                }
                NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED -> {
                    val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                    notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", addr))
                }
            }
        }
    }
    val filter = IntentFilter().apply {
        addAction(NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED)
        addAction(NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED)
        addAction(NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED)
    }
    try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            activity.registerReceiver(messageReceiver, filter)
        }
    } catch (e: Exception) { }
}

internal fun NexoBlePlugin.unregisterServerReceivers() {
    messageReceiver?.let {
        try { activity.unregisterReceiver(it) } catch (e: Exception) { }
        messageReceiver = null
    }
}

internal fun NexoBlePlugin.stopAdvertisingInternal() {
    isAdvertisingActive = false
    try { bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) } catch (e: Exception) { }
}

internal fun NexoBlePlugin.newAdvertiseCallback(): android.bluetooth.le.AdvertiseCallback = object : android.bluetooth.le.AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: android.bluetooth.le.AdvertiseSettings?) {
        isAdvertisingActive = true
        remLog("INFO", "ADVERTISING", "Started")
    }
    override fun onStartFailure(errorCode: Int) {
        isAdvertisingActive = false
        remLog("ERROR", "ADVERTISING", "Failed: $errorCode")
    }
}

internal fun NexoBlePlugin.stopAdvertisingImpl(call: PluginCall) {
    val ctx = activity.applicationContext
    try {
        isAdvertisingActive = false
        ctx.stopService(Intent(ctx, BleService::class.java))
        unregisterServerReceivers()
        call.resolve(JSObject().put("stopped", true))
    } catch (e: Exception) {
        call.reject("Error: ${e.message}")
    }
}

internal fun NexoBlePlugin.isAdvertisingImpl(call: PluginCall) {
    val ctx = activity.applicationContext
    val manager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val running = manager.getRunningServices(Integer.MAX_VALUE).any { it.service.className == BleService::class.java.name }
    call.resolve(JSObject().put("isAdvertising", running))
}

internal fun NexoBlePlugin.startListeningMessagesImpl(call: PluginCall) {
    registerServerReceivers()
    call.resolve(JSObject().put("listening", true))
}
