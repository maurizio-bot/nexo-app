package com.nexo.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall

// Bluetooth: estado, permisos, servidor GATT (arranque, sus llamadas y parada) y limpieza.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

private fun NexoBlePlugin.isScanning(): Boolean {
    return bluetoothScanner != null
}
private fun NexoBlePlugin.reconnectKnownDevices() {
    val ctx = activity.applicationContext
    val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = bluetoothManager.adapter
    if (adapter == null || !adapter.isEnabled) return
    gattClients.forEach { (macNorm, gatt) ->
        val state = clientConnectionStates[macNorm] ?: BluetoothProfile.STATE_DISCONNECTED
        if (state != BluetoothProfile.STATE_CONNECTED && state != BluetoothProfile.STATE_CONNECTING) {
            remLog("INFO", "FOREGROUND", "Auto-reconnect a $macNorm al volver de background")
            reconnectAttempts[macNorm] = 0
            reconnectDelays.remove(macNorm)
            startAutoReconnect(macNorm)
        }
    }
}
internal fun NexoBlePlugin.registerBluetoothStateReceiver() {
    if (bluetoothStateReceiver != null) return
    bluetoothStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
            val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
            when (state) {
                BluetoothAdapter.STATE_OFF -> {
                    remLog("WARN", "BT_STATE", "Bluetooth apagado")
                    isAdvertisingActive = false
                    stopScanInternal()
                    cleanupAllConnections()
                    // 3072 (diagnóstico del Motorola 13-11 17:54): al apagarse el Bluetooth (o reiniciarse solo) el servidor GATT
                    // muere, pero la referencia seguía puesta: al volver, autoStart veía «ya iniciado» y no lo rehacía → el anuncio
                    // NEXO salía pero sin servicio («sin servicio GATT» para el S24 y el Honor) hasta reabrir la app. Se suelta aquí.
                    try { stopGattServer() } catch (e: Exception) { }
                    notifyListeners("onBluetoothStateChanged", JSObject()
                        .put("state", "off")
                        .put("enabled", false)
                    )
                }
                BluetoothAdapter.STATE_ON -> {
                    remLog("INFO", "BT_STATE", "Bluetooth encendido" + if (bluetoothGattServer != null) ": rehago el servidor GATT (el de antes ya no sirve)" else "")
                    if (bluetoothGattServer != null) try { stopGattServer() } catch (e: Exception) { }
                    notifyListeners("onBluetoothStateChanged", JSObject()
                        .put("state", "on")
                        .put("enabled", true)
                    )
                    autoStartGattServerAndAdvertising()
                }
            }
        }
    }
    val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(bluetoothStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            activity.registerReceiver(bluetoothStateReceiver, filter)
        }
    } catch (e: Exception) {
        remLog("WARN", "BT_STATE", "No se pudo registrar receiver: ${e.message}")
    }
}
internal fun NexoBlePlugin.unregisterBluetoothStateReceiver() {
    bluetoothStateReceiver?.let {
        try { activity.unregisterReceiver(it) } catch (e: Exception) { }
        bluetoothStateReceiver = null
    }
}
internal fun NexoBlePlugin.autoStartGattServerAndAdvertising() {
    val ctx = activity.applicationContext
    if (!checkCoreBLEPermissions(ctx)) {
        remLog("WARN", "AUTO_START", "Permisos no concedidos, no se puede auto-start")
        return
    }
    val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = bluetoothManager.adapter
    if (adapter == null || !adapter.isEnabled) {
        remLog("WARN", "AUTO_START", "Bluetooth no disponible")
        return
    }
    if (bluetoothGattServer == null) {
        startGattServer()
    }
    if (!isAdvertisingActive) {
        try {
            val intent = Intent(ctx, BleService::class.java)
            nexoAdvertisingId?.let { id ->
                intent.putExtra("nexo_advertising_id", id)
            }
            putRidExtras(intent)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
            registerServerReceivers()
            isAdvertisingActive = true
            notifyListeners("onAdvertiseStarted", JSObject().put("started", true).put("source", "auto_start"))
            remLog("INFO", "AUTO_START", "Advertising auto-iniciado")
        } catch (e: Exception) {
            remLog("WARN", "AUTO_START", "Fallo auto-start advertising: ${e.message}")
        }
    }
}
internal fun NexoBlePlugin.cleanupAllConnections() {
    gattClients.forEach { (mac, gatt) ->
        try {
            gatt.disconnect()
            gatt.close()
            remLog("INFO", "CLEANUP", "GATT client cerrado: $mac")
        } catch (e: Exception) {
            remLog("WARN", "CLEANUP", "Error cerrando GATT client $mac: ${e.message}")
        }
    }
    gattClients.clear()
    clientRxCharacteristics.clear()
    clientTxCharacteristics.clear()
    clientConnectionStates.clear()
    reconnectTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
    reconnectTimers.clear()
    reconnectAttempts.clear()
    reconnectDelays.clear()
    keepAliveTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
    keepAliveTimers.clear()
    pendingMessageQueue.clear()
    messageBuffers.clear()
    binAssembler.clearAll()
    messageBufferTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
    messageBufferTimers.clear()
    scanBook.resetNotify()
    writeQueues.clear()
    writeQueueProcessing.clear()
    writeQueueTimeouts.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
    writeQueueTimeouts.clear()
    negotiatedMtu.clear()
}
internal fun NexoBlePlugin.checkBLEStatusImpl(call: PluginCall) {
    remLog("INFO", "PERMISSIONS", "checkBLEStatus")
    val ctx = activity.applicationContext
    val result = JSObject()
    val scanGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)
    val connectGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT)
    val advertiseGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE)
    val locationGranted = isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
    val notificationsGranted = isGranted(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
    val foregroundConnectedGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        isGranted(ctx, android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE)
    } else true
    val allGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        scanGranted && connectGranted && advertiseGranted && foregroundConnectedGranted
    } else locationGranted
    result.put("scanGranted", scanGranted)
    result.put("connectGranted", connectGranted)
    result.put("advertiseGranted", advertiseGranted)
    result.put("locationGranted", locationGranted)
    result.put("notificationsGranted", notificationsGranted)
    result.put("foregroundConnectedGranted", foregroundConnectedGranted)
    result.put("allGranted", allGranted)
    result.put("serverReady", bluetoothGattServer != null)
    call.resolve(result)
}

internal fun NexoBlePlugin.permissionsCallbackImpl(call: PluginCall) {
    val ctx = activity.applicationContext
    val granted = checkCoreBLEPermissions(ctx)
    if (granted) {
        startGattServer()
        autoStartGattServerAndAdvertising()
        notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "permissions_callback"))
    }
    call.resolve(JSObject().put("granted", granted))
}

internal fun NexoBlePlugin.isGranted(ctx: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

internal fun NexoBlePlugin.checkCoreBLEPermissions(ctx: Context): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN) &&
        isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT) &&
        isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE) &&
        isGranted(ctx, android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN) &&
        isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT) &&
        isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE)
    } else isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
}

internal fun NexoBlePlugin.normalizeMac(mac: String): String {
    return mac.replace(":", "").replace("-", "").replace(".", "").lowercase()
}

internal fun NexoBlePlugin.formatMacForAndroid(mac: String): String? {
    val clean = mac.replace(":", "").replace("-", "").replace(".", "").lowercase()
    if (clean.length != 12 || !clean.all { it in '0'..'9' || it in 'a'..'f' }) {
        return null
    }
    return clean.chunked(2).joinToString(":")
}

internal fun NexoBlePlugin.startGattServer() {
    // 3263 (fase 2): el servidor es uno por proceso (GattServerHost). Si ya está abierto —lo abrió el servicio sin la app o la
    // instancia anterior de la app— esta instancia solo se engancha: los enlaces entrantes siguen como estaban.
    if (bluetoothGattServer != null) {
        if (GattServerHost.attendedBy(gattServerCallback)) remLog("INFO", "GATT_SERVER", "Ya iniciado")
        else adoptGattServer("ya estaba abierto")
        return
    }
    try {
        val ctx = appCtx ?: activity.applicationContext
        if (!GattServerHost.open(ctx)) {
            remLog("ERROR", "GATT_SERVER", "Bluetooth no disponible o no se pudo abrir el servidor")
            return
        }
        GattServerHost.attach(gattServerCallback, if (closedMode) "app cerrada" else "app")
        remLog("INFO", "GATT_SERVER", "Iniciado: addService=true")
        notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "gatt_server_started"))
    } catch (e: Exception) {
        remLog("ERROR", "GATT_SERVER", "Error: ${e.message}")
    }
}

// 3263 (fase 2): engancharse al servidor GATT que ya estaba abierto. Hereda los enlaces entrantes con su suscripción y su MTU: el otro
// teléfono no nota que NEXO se abrió. La app los recoge con getConnectedDevices («Conexión existente recuperada al arrancar»).
internal fun NexoBlePlugin.adoptGattServer(motivo: String) {
    val antes = GattServerHost.owner
    GattServerHost.attach(gattServerCallback, if (closedMode) "app cerrada" else "app")
    serverConnectedDevices.keys.forEach { mac -> GattServerHost.mtu[mac]?.let { negotiatedMtu[mac] = it } }
    val suscritos = serverConnectedDevices.keys.count { serverNotificationEnabled[it] == true }
    remLog("INFO", "GATT_SERVER", "Servidor GATT conservado ($motivo" + (if (antes.isNotEmpty()) "; lo atendía: $antes" else "") + "): ${serverConnectedDevices.size} enlace(s) entrante(s) siguen abiertos, $suscritos suscrito(s)")
    notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "gatt_server_kept"))
}

// 3262 (COLA 16, «el nativo lo sigue listando tras disconnectDevice(server)» y el enlace repetido que «vuelve» a los ~63 s; S24↔Austin
// 19-11): Android solo corta un enlace ENTRANTE si esta app lo «tiene» (BluetoothGattServer.connect sobre el enlace ya abierto lo
// marca como en uso). Sin eso, cancelConnection —y cerrar el servidor— no hacen NADA: el enlace seguía vivo, el otro teléfono seguía
// escribiendo por él y aquí se daba por cerrado (el desempate de repetidos, el corte de 3251 y el freno de 3203 no cortaban nada).
// Se «tiene» solo a quien usa NUESTRO servicio (su primera escritura o su suscripción): nunca el reloj, los auriculares ni el enlace
// de otra app, que también pasan por este aviso. Y no si por esa dirección el cliente somos nosotros (ya lo tiene nuestro cliente).
internal fun NexoBlePlugin.holdServerLink(device: BluetoothDevice) {
    val mac = normalizeMac(device.address)
    if (gattClients.containsKey(mac) || serverHeld.contains(mac)) return
    val srv = bluetoothGattServer ?: return
    if (!serverHeld.add(mac)) return
    try { srv.connect(device, false) } catch (e: Exception) { serverHeld.remove(mac) }
}

// 3262: corta DE VERDAD un enlace entrante (si aún no se «tenía», se toma primero: ver holdServerLink)
internal fun NexoBlePlugin.cutServerLink(device: BluetoothDevice, motivo: String) {
    val srv = bluetoothGattServer ?: return
    val mac = normalizeMac(device.address)
    try {
        val fresh = serverHeld.add(mac)
        if (fresh) srv.connect(device, false)
        val cut = Runnable { try { bluetoothGattServer?.cancelConnection(device) } catch (e: Exception) { } }
        if (fresh) mainHandler.postDelayed(cut, 200) else cut.run()
    } catch (e: Exception) { remLog("WARN", "GATT_SERVER", "No se pudo cortar $mac ($motivo): ${e.message}") }
}

// 3251: corta los enlaces que los demás tienen abiertos a NUESTRO servidor GATT (antes de cerrarlo, para que reconecten al nuevo en vez de
// quedarse escribiendo a un servidor que ya no existe). 3262: solo los que usan nuestro servicio (los que «tenemos»); cerrar el servidor
// suelta además lo que tuviéramos.
internal fun NexoBlePlugin.cancelServerLinks(motivo: String) {
    val server = bluetoothGattServer ?: return
    val devices = serverConnectedDevices.filterKeys { serverHeld.contains(it) }
    if (devices.isEmpty()) return
    remLog("INFO", "GATT_SERVER", "Corto ${devices.size} enlace(s) entrante(s) antes de cerrar el servidor ($motivo)")
    devices.values.forEach { d -> try { server.cancelConnection(d) } catch (e: Exception) { } }
}

// Cierra DE VERDAD el servidor (Bluetooth apagado, cuenta pasada a otro teléfono, limpieza sin permisos). 3263: abrir o cerrar la app
// ya NO pasa por aquí (ver GattServerHost y endClosedMode).
internal fun NexoBlePlugin.stopGattServer() {
    try {
        GattServerHost.close()
        remLog("INFO", "GATT_SERVER", "Detenido")
    } catch (e: Exception) {
        remLog("WARN", "GATT_SERVER", "Error deteniendo: ${e.message}")
    }
}

// 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11 09:32): quién no se frena nunca en el servidor GATT (ServerFlapPolicy):
// una dirección con la que somos cliente (Android avisa también al servidor de los enlaces que abrimos nosotros: cerrarla cortaría el
// nuestro) o la de un contacto que el nativo conoce (mapa NEXO ID ↔ dirección). Quien habla se marca aparte (serverFlap.spoke, PluginRx).
private fun NexoBlePlugin.serverPeerTrusted(mac: String): Boolean =
    gattClients.containsKey(mac) || clientConnectionStates.containsKey(mac) || nxidToMacMap.containsValue(mac)

// Reanudar el anuncio tras una desconexión (relanza BleService: si ya anuncia, solo se asegura de que sigue en marcha)
private fun NexoBlePlugin.resumeAdvertisingAfterDisconnect() {
    if (!isAdvertisingActive) return
    remLog("INFO", "GATT_SERVER", "Reanudando advertising tras desconexion")
    try {
        val ctx = activity.applicationContext
        val intent = Intent(ctx, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
    } catch (e: Exception) {
        remLog("WARN", "GATT_SERVER", "No se pudo reanudar advertising: ${e.message}")
    }
}

internal fun NexoBlePlugin.newGattServerCallback(): BluetoothGattServerCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
        val mac = normalizeMac(device.address)
        val now = System.currentTimeMillis()
        // 3262: al «tener» un enlace (holdServerLink) Android puede avisar OTRA vez «conectado» del mismo enlace: ya está contado
        if (newState == BluetoothProfile.STATE_CONNECTED && serverHeld.contains(mac) && serverConnectedDevices.containsKey(mac)) return
        if (newState == BluetoothProfile.STATE_DISCONNECTED) { serverHeld.remove(mac); halfOpen.forget(mac) }
        // 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11 09:32): un teléfono sin identificar entraba y salía cada ~36 s
        // durante 14 min (dos líneas, un relanzamiento de BleService y dos avisos a la app por vuelta). Frenado (ServerFlapPolicy): su
        // conexión se cierra al entrar, sin registro ni aviso a la app; su salida, igual de callada y sin reanudar el anuncio.
        if (newState == BluetoothProfile.STATE_CONNECTED && serverFlap.onConnect(mac, now, serverPeerTrusted(mac))) {
            mainHandler.post { try { bluetoothGattServer?.cancelConnection(device) } catch (e: Exception) { } }
            return
        }
        val disc = if (newState == BluetoothProfile.STATE_DISCONNECTED) serverFlap.onDisconnect(mac, now, serverPeerTrusted(mac)) else null
        if (disc?.quiet == true) {
            serverConnectedDevices.remove(mac)
            serverNotificationEnabled.remove(mac)
            messageBuffers.remove(mac); binAssembler.reset(mac)
            messageBufferTimers.remove(mac)?.let { mainHandler.removeCallbacks(it) }
            return
        }
        remLog("INFO", "GATT_SERVER", "Connection $mac status=$status newState=$newState")
        if (newState == BluetoothProfile.STATE_CONNECTED) {
            serverConnectedDevices[mac] = device
            notifyListeners("onDeviceConnected", JSObject()
                .put("deviceId", device.address)
                .put("direction", "incoming")
                .put("role", "server")
                .put("servicesReady", true)
            )
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
            serverConnectedDevices.remove(mac)
            serverNotificationEnabled.remove(mac)
            messageBuffers.remove(mac); binAssembler.reset(normalizeMac(mac))
            messageBufferTimers.remove(mac)?.let { mainHandler.removeCallbacks(it) }
            notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", device.address))
            // 3203: una sola línea al frenar; y el anuncio tras la salida de quien no se identificó, agrupado (uno cada 60 s como
            // mucho; el que se pide antes sale al final del plazo si para entonces no salió otro)
            if (disc != null && disc.brakeMs > 0) remLog("INFO", "GATT_SERVER", serverFlap.brakeLine(mac, disc))
            val adv = disc?.adv ?: ServerFlapPolicy.ADV_NOW
            if (adv == ServerFlapPolicy.ADV_NOW) resumeAdvertisingAfterDisconnect()
            else if (adv > 0) mainHandler.postDelayed({ if (serverFlap.advDue(System.currentTimeMillis())) resumeAdvertisingAfterDisconnect() }, adv)
        }
    }

    override fun onCharacteristicWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        characteristic: BluetoothGattCharacteristic,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray?
    ) {
        if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
            val mac = device.address
            remLog("INFO", "GATT_SERVER", "RX chunk from $mac: len=${value?.size ?: 0}")
            val macN = normalizeMac(mac)
            holdServerLink(device) // 3262: usa nuestro servicio → lo «tenemos» (para poder cortarlo de verdad cuando toque)
            // 3262 (HalfOpenPolicy): escribe pero no está suscrito y no hay enlace de cliente nuestro por esa dirección → no podemos
            // contestarle (enlace que sobrevivió a un reinicio nuestro): se corta para que reconecte limpio
            val ownClient = gattClients.containsKey(macN) && clientConnectionStates[macN] == BluetoothProfile.STATE_CONNECTED
            if (halfOpen.onWrite(macN, serverNotificationEnabled[macN] == true, ownClient, System.currentTimeMillis())) {
                remLog("WARN", "GATT_SERVER", "Enlace a medias con $macN (escribe sin estar suscrito: no se le puede contestar): se corta para que reconecte limpio")
                cutServerLink(device, "a medias")
            }
            processReceivedBytes(mac, value ?: ByteArray(0), "gatt_server")
            if (responseNeeded) {
                bluetoothGattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    offset,
                    value
                )
            }
        }
    }

    override fun onDescriptorWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        descriptor: BluetoothGattDescriptor,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray?
    ) {
        if (descriptor.uuid == NexoBleSpec.CCCD_UUID) {
            val macNorm = normalizeMac(device.address)
            val enabled = value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true ||
                          value?.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE) == true
            serverNotificationEnabled[macNorm] = enabled
            if (enabled) { halfOpen.forget(macNorm); holdServerLink(device) } // 3262
            descriptor.value = value
            if (responseNeeded) {
                bluetoothGattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    offset,
                    value
                )
            }
            remLog("INFO", "GATT_SERVER", "CCCD escrito por ${device.address} enabled=$enabled")
        }
    }

    // Android confirma que la notificación salió: enviar la siguiente de la cola
    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
        val macNorm = normalizeMac(device.address)
        mainHandler.post { onWriteDone(macNorm) }
    }

    // FIX: Registrar MTU negociado cuando actuamos como servidor (Android 12+)
    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
        val macNorm = normalizeMac(device.address)
        val effectiveMtu = if (mtu > 23) mtu else 23
        negotiatedMtu[macNorm] = effectiveMtu
        remLog("INFO", "GATT_SERVER", "MTU changed $macNorm mtu=$effectiveMtu")
    }
}
