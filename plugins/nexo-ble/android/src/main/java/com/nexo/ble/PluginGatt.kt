package com.nexo.ble

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.nexo.ble.NexoBlePlugin.Companion.RECONNECT_DELAY_MS
import com.nexo.ble.NexoBlePlugin.Companion.MAX_RECONNECT_DELAY_MS
import com.nexo.ble.NexoBlePlugin.Companion.MAX_RECONNECT_ATTEMPTS
import com.nexo.ble.NexoBlePlugin.Companion.KEEPALIVE_INTERVAL_MS
import com.nexo.ble.NexoBlePlugin.Companion.MTU_REQUEST
import com.nexo.ble.NexoBlePlugin.Companion.MTU_REQUEST_FALLBACK

// Bluetooth: conexiones GATT como cliente, keepalive y reconexión.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

internal fun NexoBlePlugin.connectToDeviceImpl(call: PluginCall) {
    try {
        val rawDeviceId = call.getString("deviceId") ?: call.getString("address") ?: ""
        remLog("INFO", "GATT_CLIENT", "connectToDevice raw='$rawDeviceId'")
        if (rawDeviceId.isEmpty()) {
            call.reject("deviceId requerido", "INVALID_DEVICE_ID")
            return
        }

        val idType = classifyDeviceId(rawDeviceId)
        if (idType == "invalid") {
            call.reject("ID invalido: no es NXID ni MAC", "INVALID_DEVICE_ID")
            return
        }

        val macNorm: String
        val resolvedNexoId: String?
        if (idType == "nxid") {
            resolvedNexoId = rawDeviceId.trim()
            val resolvedMac = resolveMacForNexoId(resolvedNexoId)
            if (resolvedMac == null) {
                call.reject("NXID no resuelto a MAC: $rawDeviceId. Intenta escanear primero.", "NXID_UNRESOLVED")
                return
            }
            macNorm = resolvedMac
            remLog("INFO", "GATT_CLIENT", "connectToDevice NXID='$resolvedNexoId' → MAC='$macNorm'")
        } else {
            macNorm = normalizeMac(rawDeviceId)
            resolvedNexoId = null
            remLog("INFO", "GATT_CLIENT", "connectToDevice MAC='$macNorm'")
        }

        val existingState = clientConnectionStates[macNorm]
        if (existingState == BluetoothProfile.STATE_CONNECTING) {
            remLog("WARN", "GATT_CLIENT", "Conexion ya en progreso para $macNorm")
            call.resolve(JSObject().put("connected", false).put("error", "Connection already in progress").put("deviceId", rawDeviceId))
            return
        }
        if (gattClients.containsKey(macNorm) && existingState == BluetoothProfile.STATE_CONNECTED) {
            remLog("INFO", "GATT_CLIENT", "Ya conectado a $macNorm")
            call.resolve(JSObject()
                .put("connected", true)
                .put("alreadyConnected", true)
                .put("deviceId", rawDeviceId)
            )
            return
        }

        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth no disponible", "BLUETOOTH_UNAVAILABLE")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT)) {
            call.reject("BLUETOOTH_CONNECT no concedido", "PERMISSION_DENIED")
            return
        }
        val device: BluetoothDevice = scannedDevices[macNorm] ?: run {
            remLog("WARN", "GATT_CLIENT", "Device no en cache, intentando getRemoteDevice para $macNorm")
            val macFormatted = formatMacForAndroid(rawDeviceId)
            if (macFormatted == null) {
                call.reject("MAC invalida: $rawDeviceId", "INVALID_MAC")
                return
            }
            try {
                adapter.getRemoteDevice(macFormatted)
            } catch (e: IllegalArgumentException) {
                call.reject("MAC invalida para Bluetooth API: $macFormatted", "INVALID_MAC")
                return
            } catch (e: SecurityException) {
                call.reject("Permiso BLUETOOTH_CONNECT requerido para conectar", "PERMISSION_DENIED")
                return
            }
        }
        remLog("INFO", "GATT_CLIENT", "Usando device: ${device.address} (cache=${scannedDevices.containsKey(macNorm)})")

        gattClients[macNorm]?.let { oldGatt ->
            try { oldGatt.disconnect(); oldGatt.close() } catch (e: Exception) { }
        }
        pendingCalls[macNorm] = call
        call.setKeepAlive(true)
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            connectLe(ctx, device, macNorm)
        } else {
            device.connectGatt(ctx, false, createGattClientCallback(macNorm))
        }
        if (gatt == null) {
            pendingCalls.remove(macNorm)
            call.reject("No se pudo iniciar GATT", "GATT_NULL")
            return
        }
        gattClients[macNorm] = gatt
        clientConnectionStates[macNorm] = BluetoothProfile.STATE_CONNECTING
        reconnectAttempts[macNorm] = 0
        reconnectDelays.remove(macNorm)
        remLog("INFO", "GATT_CLIENT", "Conexion iniciada a $macNorm")
        mainHandler.postDelayed({
            if (pendingCalls.containsKey(macNorm)) {
                remLog("WARN", "GATT_CLIENT", "Timeout conectando a $macNorm")
                pendingCalls.remove(macNorm)
                gattClients[macNorm]?.let { g -> try { g.disconnect(); g.close() } catch (e: Exception) { } }
                gattClients.remove(macNorm)
                clientConnectionStates.remove(macNorm)
                notifyListeners("onConnectionFailed", JSObject()
                    .put("deviceId", rawDeviceId)
                    .put("reason", "Connection timeout")
                    .put("recoverable", true)
                )
            }
        }, 15000)
    } catch (e: Exception) {
        remLog("ERROR", "GATT_CLIENT", "Fatal connectToDevice: ${e.message}")
        call.reject("Error interno: ${e.message}", "INTERNAL_ERROR")
    }
}

internal fun NexoBlePlugin.createGattClientCallback(macNorm: String): BluetoothGattCallback {
    return object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val address = gatt.device?.address ?: ""
            remLog("INFO", "GATT_CLIENT_CB", "onConnectionStateChange $address status=$status newState=$newState")
            clientConnectionStates[macNorm] = newState
            val pendingCall = pendingCalls[macNorm]
            if (status != BluetoothGatt.GATT_SUCCESS && newState != BluetoothProfile.STATE_CONNECTED) {
                remLog("WARN", "GATT_CLIENT_CB", "Error de conexion status=$status, forzando reconexion")
                pendingCall?.let {
                    it.resolve(JSObject().put("connected", false).put("deviceId", address).put("error", "Connection error $status"))
                    pendingCalls.remove(macNorm)
                }
                // Ronda 2766 (revisión): las caídas de verdad llegan así (8 = fuera de alcance, 19 = el otro la cerró):
                // se avisa a la app y se limpia como en una desconexión normal. Antes la app seguía viendo el enlace
                // listo (contacto "en línea", se le mandaba por ahí) hasta que el vigilante lo cortaba
                notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address).put("status", status))
                stopKeepAlive(macNorm)
                gattClients.remove(macNorm)
                clientRxCharacteristics.remove(macNorm)
                clientTxCharacteristics.remove(macNorm)
                clientConnectionStates.remove(macNorm)
                messageBuffers.remove(macNorm); binAssembler.reset(macNorm)
                messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
                try { gatt.close() } catch (e: Exception) { }
                startAutoReconnect(macNorm)
                return
            }
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                reconnectAttempts[macNorm] = 0
                reconnectDelays.remove(macNorm)
                pendingCall?.let {
                    it.resolve(JSObject().put("connected", true).put("alreadyConnected", false).put("deviceId", address))
                    pendingCalls.remove(macNorm)
                }
                notifyListeners("onDeviceConnected", JSObject()
                    .put("deviceId", address)
                    .put("direction", "outgoing")
                    .put("role", "client")
                    .put("servicesReady", false)
                )
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                        remLog("INFO", "GATT_CLIENT_CB", "ConnectionPriority HIGH set para $address")
                    }
                    // PHY 2M (2 Mbps) si ambos lo soportan; si no, Android se queda en 1M
                    // (no con un enlace de largo alcance: 2M tiene menos alcance y se cortaría)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !codedLinks.contains(normalizeMac(address))) {
                        gatt.setPreferredPhy(BluetoothDevice.PHY_LE_2M_MASK, BluetoothDevice.PHY_LE_2M_MASK, BluetoothDevice.PHY_OPTION_NO_PREFERRED)
                    }
                } catch (e: Exception) {
                    remLog("WARN", "GATT_CLIENT_CB", "No se pudo setear priority: ${e.message}")
                }
                try { gatt.discoverServices() } catch (e: SecurityException) {
                    remLog("ERROR", "GATT_CLIENT_CB", "SecurityException discoverServices: ${e.message}")
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                pendingCall?.let {
                    it.resolve(JSObject().put("connected", false).put("deviceId", address).put("error", "Disconnected"))
                    pendingCalls.remove(macNorm)
                }
                notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address))
                stopKeepAlive(macNorm)
                gattClients.remove(macNorm)
                clientRxCharacteristics.remove(macNorm)
                clientTxCharacteristics.remove(macNorm)
                clientConnectionStates.remove(macNorm)
                messageBuffers.remove(macNorm); binAssembler.reset(macNorm)
                messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
                try { gatt.close() } catch (e: Exception) { }
                startAutoReconnect(macNorm)
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val address = gatt.device?.address ?: ""
            remLog("INFO", "GATT_CLIENT_CB", "onServicesDiscovered $address status=$status")
            if (status != BluetoothGatt.GATT_SUCCESS) {
                notifyListeners("onConnectionFailed", JSObject().put("deviceId", address).put("reason", "Service discovery failed"))
                closeClientWithoutService(gatt, macNorm, address)
                return
            }
            val service = gatt.getService(NexoBleSpec.NEXO_SERVICE_UUID) ?: run {
                // El otro teléfono tiene la app cerrada (su servidor GATT no está). Antes la conexión
                // quedaba abierta sin servicio y "ya conectado" impedía reconectar al reabrir.
                notifyListeners("onConnectionFailed", JSObject().put("deviceId", address).put("reason", "NEXO service not found"))
                closeClientWithoutService(gatt, macNorm, address)
                return
            }
            val txChar = service.getCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID)
            val rxChar = service.getCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID)
            clientSetupDone[macNorm] = false // 3059: hasta que terminen MTU y notificaciones, las escrituras por aquí esperan
            clientTxCharacteristics[macNorm] = txChar
            clientRxCharacteristics[macNorm] = rxChar
            // Ronda 2757 (plan punto 8): Android hace UNA operación GATT a la vez. Antes se pedía el MTU y en el
            // acto se activaban las notificaciones: a menudo se perdía la petición de MTU y la conexión se quedaba
            // en 23 bytes (20 por escritura: todo ~20 veces más lento). Ahora: MTU primero; las notificaciones
            // cuando contesta (o a los 2 s si no contesta).
            val asked = try { Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && gatt.requestMtu(MTU_REQUEST) } catch (e: Exception) { false }
            remLog("INFO", "GATT_CLIENT_CB", "MTU request $MTU_REQUEST para $address: " + if (asked) "pedido" else "no se pudo pedir")
            if (asked) mainHandler.postDelayed({ startNotifications(gatt, address) }, 2000) else startNotifications(gatt, address)
        }

        private var setupDone = false
        private var mtuRetries = 0
        // Activar las notificaciones del otro (una sola vez por conexión) y avisar de que está listo
        private fun startNotifications(gatt: BluetoothGatt, address: String) {
            if (setupDone) return
            setupDone = true
            clientSetupDone[macNorm] = true // 3059: ya se puede escribir por este enlace (lo que esperaba sale ahora)
            val txChar = clientTxCharacteristics[macNorm]
            txChar?.let { characteristic ->
                try {
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
                } catch (e: SecurityException) {
                    remLog("ERROR", "GATT_CLIENT_CB", "SecurityException notifications: ${e.message}")
                }
            }
            notifyListeners("onServicesReady", JSObject().put("deviceId", address).put("servicesReady", true))
            processPendingMessages(macNorm)
            mainHandler.post { processWriteQueue(macNorm) }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            val address = gatt.device?.address ?: ""
            val effectiveMtu = if (status == BluetoothGatt.GATT_SUCCESS && mtu > 23) mtu else 23
            negotiatedMtu[macNorm] = effectiveMtu
            remLog("INFO", "GATT_CLIENT_CB", "MTU changed $address mtu=$effectiveMtu status=$status")
            if (effectiveMtu <= 23) btErr("mtu_small", "MTU mínimo (23) con $macNorm (status=$status)" + if (mtuRetries > 0) " tras reintentar" else "")
            mainHandler.post { startNotifications(gatt, address) }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            val address = gatt.device?.address ?: ""
            if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                notifyListeners("onNotificationsEnabled", JSObject().put("deviceId", address).put("notificationsEnabled", true))
                startKeepAlive(macNorm)
                // MTU aún mínimo: se pide otra vez (una), ya sin nada más en curso, pero con el valor SEGURO 247
                // (no 512): un teléfono que rechazó 512 suele aceptar 247, y así no se queda en 23 (~20× más lento).
                if ((negotiatedMtu[macNorm] ?: 23) <= 23 && mtuRetries < 1) {
                    mtuRetries++
                    val again = try { gatt.requestMtu(MTU_REQUEST_FALLBACK) } catch (e: Exception) { false }
                    remLog("INFO", "GATT_CLIENT_CB", "MTU otra vez (247, valor seguro) para $address: $again")
                }
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val address = gatt.device?.address ?: ""
            val macNormLocal = normalizeMac(address)
            if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    remLog("WARN", "GATT_CLIENT_CB", "onCharacteristicWrite FAILED $address status=$status")
                }
                mainHandler.post { onWriteDone(macNormLocal) }
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT_CLIENT_CB", "Received chunk (legacy) from $address: len=${characteristic.value?.size ?: 0}")
                processReceivedBytes(address, characteristic.value ?: ByteArray(0), "gatt_client")
            }
        }

        // NUEVO: Soporte para Android 13+ onCharacteristicChanged con payload directo
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT_CLIENT_CB", "Received chunk (API 33+) from $address: len=${value.size}")
                processReceivedBytes(address, value, "gatt_client")
            }
        }
    }
}

private fun NexoBlePlugin.closeClientWithoutService(gatt: BluetoothGatt, macNorm: String, address: String) {
    try { gatt.disconnect(); gatt.close() } catch (e: Exception) { }
    gattClients.remove(macNorm)
    clientRxCharacteristics.remove(macNorm)
    clientTxCharacteristics.remove(macNorm)
    clientConnectionStates.remove(macNorm)
    notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address).put("reason", "no_service"))
}

private fun NexoBlePlugin.startKeepAlive(macNorm: String) {
    stopKeepAlive(macNorm)
    val runnable = object : Runnable {
        override fun run() {
            val gatt = gattClients[macNorm]
            val state = clientConnectionStates[macNorm]
            if (gatt != null && state == BluetoothProfile.STATE_CONNECTED) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        gatt.readRemoteRssi()
                    }
                } catch (e: Exception) {
                    remLog("WARN", "KEEPALIVE", "Error keep-alive $macNorm: ${e.message}")
                    stopKeepAlive(macNorm)
                    return
                }
                mainHandler.postDelayed(this, KEEPALIVE_INTERVAL_MS)
            }
        }
    }
    keepAliveTimers[macNorm] = runnable
    mainHandler.postDelayed(runnable, KEEPALIVE_INTERVAL_MS)
    remLog("INFO", "KEEPALIVE", "Iniciado para $macNorm")
}

private fun NexoBlePlugin.stopKeepAlive(macNorm: String) {
    keepAliveTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
}

private fun NexoBlePlugin.getReconnectDelay(macNorm: String): Long {
    val attempts = reconnectAttempts[macNorm] ?: 0
    val exp = (RECONNECT_DELAY_MS * (1L shl attempts.coerceAtMost(4))).coerceAtMost(MAX_RECONNECT_DELAY_MS)
    // C-1 (07-11): jitter "igual" (misma regla que el JS _jitteredBackoff en ble_helpers.js): suelo = exp/2 + mitad
    // aleatoria. Sin esto, si varios teléfonos se cortan a la vez (el dueño de un grupo se va, concierto, el coche se
    // apaga) TODOS reintentaban en el MISMO instante y chocaban en la radio (GATT 133, ventana de escaneo 5/30 s llena
    // para todos a la vez). El jitter los reparte en el tiempo. Resultado en [exp/2, exp].
    val half = exp / 2
    return half + (Math.random() * half).toLong()
}

internal fun NexoBlePlugin.startAutoReconnect(macNorm: String) {
    val currentAttempts = reconnectAttempts[macNorm] ?: 0
    if (currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
        remLog("WARN", "RECONNECT", "Max reintentos alcanzado para $macNorm")
        return
    }
    reconnectAttempts[macNorm] = currentAttempts + 1
    val delayMs = getReconnectDelay(macNorm)
    reconnectDelays[macNorm] = delayMs
    reconnectTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    val runnable = Runnable {
        remLog("INFO", "RECONNECT", "Intentando reconectar a $macNorm (intento ${reconnectAttempts[macNorm]}, delay=${delayMs}ms)")
        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        if (adapter == null || !adapter.isEnabled) return@Runnable
        val device = scannedDevices[macNorm]
        if (device == null) {
            remLog("WARN", "RECONNECT", "No hay device cacheado para $macNorm, no se puede reconectar")
            return@Runnable
        }
        try {
            gattClients[macNorm]?.let { old ->
                try { old.disconnect(); old.close() } catch (e: Exception) { }
            }
            val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                connectLe(ctx, device, macNorm)
            } else {
                device.connectGatt(ctx, false, createGattClientCallback(macNorm))
            }
            if (gatt != null) {
                gattClients[macNorm] = gatt
                clientConnectionStates[macNorm] = BluetoothProfile.STATE_CONNECTING
            }
        } catch (e: Exception) {
            remLog("ERROR", "RECONNECT", "Fallo reconexion $macNorm: ${e.message}")
        }
    }
    reconnectTimers[macNorm] = runnable
    mainHandler.postDelayed(runnable, delayMs)
}

internal fun NexoBlePlugin.disconnectDeviceImpl(call: PluginCall) {
    val rawDeviceId = call.getString("deviceId") ?: ""
    if (rawDeviceId.isEmpty()) {
        call.reject("deviceId requerido")
        return
    }
    val idType = classifyDeviceId(rawDeviceId)
    val macNorm = if (idType == "nxid") {
        resolveMacForNexoId(rawDeviceId.trim()) ?: rawDeviceId.trim().lowercase()
    } else {
        normalizeMac(rawDeviceId)
    }
    remLog("INFO", "GATT_CLIENT", "disconnectDevice raw=$rawDeviceId resolved=$macNorm")
    // 3167 (diagnóstico S24↔realme 3075 16-11 15:17): el desempate de enlaces repetidos (3027) le pide al de NEXO ID menor que cierre
    // su enlace de SERVIDOR (el otro es cliente de nuestro servidor GATT). Aquí abajo solo se cierra el lado cliente: ese enlace
    // entrante seguía vivo y se seguía usando (RX y notificaciones por él). Solo con server=true (lo pasa ese desempate) se corta
    // también la conexión entrante con esa dirección; el resto de llamadas (pausa de cámara, zombi, desconectar) siguen igual.
    if (call.getBoolean("server", false) == true) {
        val srvDevice = serverConnectedDevices[macNorm]
        val srv = bluetoothGattServer
        if (srvDevice != null && srv != null) {
            // 3262: cutServerLink «toma» el enlace si hacía falta (sin eso cancelConnection no cortaba nada: el enlace cerrado «volvía»)
            cutServerLink(srvDevice, "enlace entrante repetido") // el corte lo confirma gattServerCallback (STATE_DISCONNECTED) y limpia allí
            remLog("INFO", "GATT_SERVER", "disconnectDevice server: corto $macNorm (enlace entrante repetido)")
        }
    }
    reconnectTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    reconnectAttempts.remove(macNorm)
    reconnectDelays.remove(macNorm)
    stopKeepAlive(macNorm)
    gattClients[macNorm]?.let { gatt -> try { gatt.disconnect(); gatt.close() } catch (e: Exception) { } }
    gattClients.remove(macNorm)
    clientRxCharacteristics.remove(macNorm)
    clientTxCharacteristics.remove(macNorm)
    clientConnectionStates.remove(macNorm)
    messageBuffers.remove(macNorm); binAssembler.reset(macNorm)
    messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    pendingCalls.remove(macNorm)
    pendingMessageQueue.remove(macNorm)
    writeQueues.remove(macNorm)
    writeQueueProcessing.remove(macNorm)
    writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    negotiatedMtu.remove(macNorm)
    clientSetupDone.remove(macNorm); clientSetupWaitSince.remove(macNorm)
    notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", rawDeviceId))
    call.resolve(JSObject().put("disconnected", true))
}

// 3262 (COLA 15; Motorola→S24 20-11 14:09: ≥ 20 s de «ocupado» seguidos por el enlace conservado): un enlace por el que no sale ni una
// escritura en ~12 s (WriteRetry.shouldCloseStuckLink) no se arregla esperando: se cierra (los dos papeles que tenga esa dirección) y se
// avisa a la app como una caída más, para que se rehaga limpio (reconexión normal). Antes seguía «abierto» dando 201 hasta el «zombi».
internal fun NexoBlePlugin.closeStuckLink(macNorm: String) {
    val address = gattClients[macNorm]?.device?.address ?: serverConnectedDevices[macNorm]?.address ?: (formatMacForAndroid(macNorm) ?: macNorm)
    remLog("WARN", "SEND", "Enlace $macNorm atascado (ni una escritura en ~${2 * WriteRetry.maxWaitMs() / 1000} s): se cierra para rehacerlo")
    serverConnectedDevices[macNorm]?.let { cutServerLink(it, "atascado") } // su cierre lo confirma y limpia gattServerCallback
    val gatt = gattClients.remove(macNorm)
    writeQueues.remove(macNorm)
    writeQueueProcessing.remove(macNorm)
    writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    writeRetryCount.remove(macNorm)
    if (gatt == null) return
    stopKeepAlive(macNorm)
    try { gatt.disconnect(); gatt.close() } catch (e: Exception) { }
    clientRxCharacteristics.remove(macNorm)
    clientTxCharacteristics.remove(macNorm)
    clientConnectionStates.remove(macNorm)
    messageBuffers.remove(macNorm); binAssembler.reset(macNorm)
    messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    pendingMessageQueue.remove(macNorm)
    negotiatedMtu.remove(macNorm)
    clientSetupDone.remove(macNorm); clientSetupWaitSince.remove(macNorm)
    // close() ya no deja llegar el aviso de Android: se da aquí, como en una caída (la app decide por dónde sigue y reconecta)
    notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address).put("reason", "stuck"))
    startAutoReconnect(macNorm)
}

internal fun NexoBlePlugin.forceReconnectImpl(call: PluginCall) {
    val rawDeviceId = call.getString("deviceId") ?: ""
    if (rawDeviceId.isEmpty()) {
        call.reject("deviceId requerido")
        return
    }
    val idType = classifyDeviceId(rawDeviceId)
    val macNorm = if (idType == "nxid") {
        resolveMacForNexoId(rawDeviceId.trim()) ?: rawDeviceId.trim().lowercase()
    } else {
        normalizeMac(rawDeviceId)
    }
    remLog("INFO", "GATT_CLIENT", "forceReconnect raw=$rawDeviceId resolved=$macNorm")
    reconnectAttempts[macNorm] = 0
    reconnectDelays.remove(macNorm)
    stopKeepAlive(macNorm)
    gattClients[macNorm]?.let { gatt -> try { gatt.disconnect(); gatt.close() } catch (e: Exception) { } }
    gattClients.remove(macNorm)
    clientConnectionStates.remove(macNorm)
    messageBuffers.remove(macNorm); binAssembler.reset(macNorm)
    messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    writeQueues.remove(macNorm)
    writeQueueProcessing.remove(macNorm)
    writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    negotiatedMtu.remove(macNorm)
    clientSetupDone.remove(macNorm); clientSetupWaitSince.remove(macNorm)
    mainHandler.postDelayed({ startAutoReconnect(macNorm) }, 500)
    call.resolve(JSObject().put("reconnecting", true))
}

internal fun NexoBlePlugin.reconnectDeviceImpl(call: PluginCall) {
    val rawDeviceId = call.getString("deviceId") ?: ""
    if (rawDeviceId.isEmpty()) {
        call.reject("deviceId requerido")
        return
    }
    val idType = classifyDeviceId(rawDeviceId)
    val macNorm = if (idType == "nxid") {
        resolveMacForNexoId(rawDeviceId.trim()) ?: rawDeviceId.trim().lowercase()
    } else {
        normalizeMac(rawDeviceId)
    }
    remLog("INFO", "GATT_CLIENT", "reconnectDevice manual raw=$rawDeviceId resolved=$macNorm")
    reconnectAttempts[macNorm] = 0
    reconnectDelays.remove(macNorm)
    startAutoReconnect(macNorm)
    call.resolve(JSObject().put("reconnecting", true))
}
