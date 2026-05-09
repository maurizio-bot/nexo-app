package com.nexo.ble

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@CapacitorPlugin(name = "NexoNearby")
class NexoNearbyPlugin : Plugin() {

    companion object {
        const val TAG = "NAP-Nearby"
        const val SERVICE_ID = "com.nexo.app"
        val STRATEGY = Strategy.P2P_CLUSTER
        const val JUMP_PREFIX = "JUMP::"
        const val JUMP_RELAY = "JUMP_RELAY"
        const val JUMP_DELIVER = "JUMP_DELIVER"
        const val MAX_HOPS = 4
        const val JUMP_ID_TTL = 60000L

        // REM broadcast para unificar con BleService
        const val ACTION_NAP_AUDIT = "com.nexo.ble.NAP_AUDIT"
        const val EXTRA_NAP_CODE = "nap_code"
        const val EXTRA_NAP_MESSAGE = "nap_message"
        const val EXTRA_NAP_LEVEL = "nap_level"
    }

    private lateinit var connectionsClient: ConnectionsClient
    private val discoveredEndpoints = mutableMapOf<String, JSObject>()
    private val connectedEndpoints = mutableSetOf<String>()
    private val pendingConnections = mutableSetOf<String>()
    private var isAdvertising = false
    private var isDiscovering = false
    private val processedJumpIds = ConcurrentHashMap<String, Long>()
    private var localUserId: String = ""
    private var localEndpointName: String = ""

    // REM v2.1: Helper para enviar audit logs al JS via Broadcast
    private fun napAudit(code: String, message: String, level: String = "INFO") {
        Log.i(TAG, "[$code] $message")
        val intent = Intent(ACTION_NAP_AUDIT).apply {
            putExtra(EXTRA_NAP_CODE, code)
            putExtra(EXTRA_NAP_MESSAGE, message)
            putExtra(EXTRA_NAP_LEVEL, level)
            putExtra("timestamp", System.currentTimeMillis())
            setPackage(context.packageName)
        }
        context.sendBroadcast(intent)
    }

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            pendingConnections.add(endpointId)
            napAudit("NAP-NEARBY-001", "Connection initiated: $endpointId name=${info.endpointName}", "INFO")
            notifyListeners("onConnectionInitiated", JSObject().apply {
                put("endpointId", endpointId)
                put("endpointName", info.endpointName)
                put("authenticationToken", info.authenticationToken)
                put("isIncomingConnection", info.isIncomingConnection)
            })
            doAcceptConnection(endpointId)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            pendingConnections.remove(endpointId)
            if (result.status.isSuccess) {
                connectedEndpoints.add(endpointId)
                val dev = discoveredEndpoints[endpointId]
                napAudit("NAP-NEARBY-002", "Connected: $endpointId", "SUCCESS")
                notifyListeners("onConnected", JSObject().apply {
                    put("endpointId", endpointId)
                    put("endpointName", dev?.getString("endpointName") ?: "Unknown")
                    put("userId", dev?.getString("userId") ?: "")
                    put("userName", dev?.getString("endpointName") ?: "Unknown")
                    put("status", "connected")
                })
            } else {
                napAudit("NAP-NEARBY-003", "Connection failed: $endpointId code=${result.status.statusCode}", "ERROR")
                notifyListeners("onConnectionFailed", JSObject().apply {
                    put("endpointId", endpointId)
                    put("statusCode", result.status.statusCode)
                })
            }
        }

        override fun onDisconnected(endpointId: String) {
            connectedEndpoints.remove(endpointId)
            discoveredEndpoints.remove(endpointId)
            napAudit("NAP-NEARBY-004", "Disconnected: $endpointId", "WARN")
            notifyListeners("onDisconnected", JSObject().put("endpointId", endpointId))
            if (connectedEndpoints.isEmpty() && isAdvertising) restartAdvertising()
        }
    }

    private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            val parts = info.endpointName.split("|")
            val userName = parts.getOrNull(0) ?: info.endpointName
            val userId = parts.getOrNull(1) ?: ""
            val data = JSObject().apply {
                put("endpointId", endpointId)
                put("endpointName", userName)
                put("userId", userId)
                put("userName", userName)
                put("serviceId", info.serviceId)
            }
            discoveredEndpoints[endpointId] = data
            napAudit("NAP-NEARBY-005", "Endpoint found: $endpointId name=$userName", "SUCCESS")
            notifyListeners("onEndpointFound", data)
            connectionsClient.requestConnection(
                "$localEndpointName|$localUserId",
                endpointId,
                connectionLifecycleCallback
            ).addOnSuccessListener {
                napAudit("NAP-NEARBY-006", "Connection requested to $endpointId", "INFO")
            }.addOnFailureListener { e ->
                napAudit("NAP-NEARBY-007", "Connection request failed: ${e.message}", "WARN")
            }
        }

        override fun onEndpointLost(endpointId: String) {
            discoveredEndpoints.remove(endpointId)
            napAudit("NAP-NEARBY-008", "Endpoint lost: $endpointId", "WARN")
            notifyListeners("onEndpointLost", JSObject().put("endpointId", endpointId))
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            if (payload.type == Payload.Type.BYTES) {
                val message = payload.asBytes()?.let { String(it, Charsets.UTF_8) } ?: ""
                if (message.startsWith(JUMP_PREFIX)) {
                    napAudit("NAP-NEARBY-009", "JUMP payload received from $endpointId", "INFO")
                    handleJumpMessage(endpointId, message.substring(JUMP_PREFIX.length))
                } else {
                    napAudit("NAP-NEARBY-010", "Payload received from $endpointId: ${message.take(30)}", "INFO")
                    notifyListeners("onPayloadReceived", JSObject().apply {
                        put("endpointId", endpointId)
                        put("message", message)
                        put("type", "bytes")
                    })
                }
            }
        }
        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }

    override fun load() {
        super.load()
        connectionsClient = Nearby.getConnectionsClient(context.applicationContext)
        localEndpointName = getDeviceName()
        napAudit("NAP-NEARBY-INIT", "NexoNearbyPlugin loaded. deviceName=$localEndpointName", "INFO")
    }

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
        napAudit("NAP-BATT-001", "requestBatteryOptimizationExemption() called", "INFO")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            val pkg = context.packageName
            if (pm != null && !pm.isIgnoringBatteryOptimizations(pkg)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$pkg")
                }
                context.startActivity(intent)
                call.resolve(JSObject().put("requested", true))
            } else {
                call.resolve(JSObject().apply {
                    put("requested", false)
                    put("alreadyExempt", true)
                })
            }
        } else {
            call.resolve(JSObject().put("requested", false))
        }
    }

    @PluginMethod
    fun startKeepAliveService(call: PluginCall) {
        napAudit("NAP-KEEPALIVE-001", "startKeepAliveService() called", "INFO")
        val intent = Intent(context, NexoKeepAliveService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve(JSObject().put("success", true))
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val userId = call.getString("userId", "") ?: ""
        val userName = call.getString("userName", getDeviceName()) ?: getDeviceName()
        if (userId.isNotBlank()) this.localUserId = userId
        this.localEndpointName = userName
        val endpointName = "$userName|$localUserId"
        val options = AdvertisingOptions.Builder()
            .setStrategy(STRATEGY)
            .setLowPower(false)
            .build()
        napAudit("NAP-NEARBY-ADVERT-001", "startAdvertising() name=$endpointName", "INFO")
        connectionsClient.startAdvertising(endpointName, SERVICE_ID, connectionLifecycleCallback, options)
            .addOnSuccessListener {
                isAdvertising = true
                napAudit("NAP-NEARBY-ADVERT-002", "Advertising started OK", "SUCCESS")
                call.resolve(JSObject().apply {
                    put("success", true)
                    put("endpointName", endpointName)
                })
            }
            .addOnFailureListener { e ->
                napAudit("NAP-NEARBY-ADVERT-003", "Advertising failed: ${e.message}", "ERROR")
                call.reject("ADVERTISING_FAILED", e.message, e)
            }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        connectionsClient.stopAdvertising()
        isAdvertising = false
        napAudit("NAP-NEARBY-ADVERT-004", "stopAdvertising() executed", "INFO")
        call.resolve()
    }

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        val options = DiscoveryOptions.Builder()
            .setStrategy(STRATEGY)
            .setLowPower(false)
            .build()
        napAudit("NAP-NEARBY-DISC-001", "startDiscovery() called", "INFO")
        connectionsClient.startDiscovery(SERVICE_ID, endpointDiscoveryCallback, options)
            .addOnSuccessListener {
                isDiscovering = true
                napAudit("NAP-NEARBY-DISC-002", "Discovery started OK", "SUCCESS")
                call.resolve(JSObject().put("success", true))
            }
            .addOnFailureListener { e ->
                napAudit("NAP-NEARBY-DISC-003", "Discovery failed: ${e.message}", "ERROR")
                call.reject("DISCOVERY_FAILED", e.message, e)
            }
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        connectionsClient.stopDiscovery()
        isDiscovering = false
        napAudit("NAP-NEARBY-DISC-004", "stopDiscovery() executed", "INFO")
        call.resolve()
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val endpointId = call.getString("endpointId")
        val message = call.getString("message")
        if (endpointId == null || message == null) {
            call.reject("INVALID_PARAMS")
            return
        }
        if (!connectedEndpoints.contains(endpointId)) {
            call.reject("NOT_CONNECTED")
            return
        }
        val payload = Payload.fromBytes(message.toByteArray(Charsets.UTF_8))
        connectionsClient.sendPayload(endpointId, payload)
            .addOnSuccessListener {
                napAudit("NAP-NEARBY-SEND-001", "Message sent to $endpointId", "INFO")
                call.resolve(JSObject().put("success", true))
            }
            .addOnFailureListener { e ->
                napAudit("NAP-NEARBY-SEND-002", "Send failed: ${e.message}", "ERROR")
                call.reject("SEND_FAILED", e.message, e)
            }
    }

    @PluginMethod
    fun broadcastMessage(call: PluginCall) {
        val message = call.getString("message")
        if (message == null) {
            call.reject("INVALID_PARAMS")
            return
        }
        if (connectedEndpoints.isEmpty()) {
            call.reject("NO_CONNECTIONS")
            return
        }
        val payload = Payload.fromBytes(message.toByteArray(Charsets.UTF_8))
        connectionsClient.sendPayload(ArrayList(connectedEndpoints), payload)
        napAudit("NAP-NEARBY-BROADCAST-001", "Broadcast to ${connectedEndpoints.size} peers", "INFO")
        call.resolve(JSObject().apply {
            put("success", true)
            put("recipients", connectedEndpoints.size)
        })
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val endpointId = call.getString("endpointId")
        if (endpointId != null) {
            connectionsClient.disconnectFromEndpoint(endpointId)
            connectedEndpoints.remove(endpointId)
            napAudit("NAP-NEARBY-DISC-005", "Disconnected from $endpointId", "INFO")
        } else {
            connectedEndpoints.toList().forEach {
                connectionsClient.disconnectFromEndpoint(it)
                napAudit("NAP-NEARBY-DISC-006", "Disconnected from $it", "INFO")
            }
            connectedEndpoints.clear()
        }
        call.resolve()
    }

    @PluginMethod
    fun getConnectedEndpoints(call: PluginCall) {
        val array = JSArray()
        connectedEndpoints.forEach { id ->
            discoveredEndpoints[id]?.let { array.put(it) }
        }
        napAudit("NAP-NEARBY-API-001", "getConnectedEndpoints: ${connectedEndpoints.size} peers", "INFO")
        call.resolve(JSObject().put("endpoints", array))
    }

    @PluginMethod
    fun acceptConnection(call: PluginCall) {
        val endpointId = call.getString("endpointId")
        if (endpointId == null) {
            call.reject("INVALID_PARAMS")
            return
        }
        connectionsClient.acceptConnection(endpointId, payloadCallback)
        napAudit("NAP-NEARBY-CONN-001", "acceptConnection: $endpointId", "INFO")
        call.resolve()
    }

    @PluginMethod
    fun sendJumpMessage(call: PluginCall) {
        val to = call.getString("to", "") ?: ""
        val payload = call.getString("payload", "") ?: ""
        val maxHops = call.getInt("maxHops", MAX_HOPS)
        if (to.isBlank()) {
            call.reject("INVALID_PARAMS", "Missing 'to' destination")
            return
        }
        if (connectedEndpoints.isEmpty()) {
            napAudit("NAP-JUMP-001", "sendJumpMessage: NO connected peers", "ERROR")
            call.reject("NO_CONNECTIONS", "No connected peers available for JUMP relay")
            return
        }
        val messageId = UUID.randomUUID().toString()
        val from = localUserId.ifBlank { localEndpointName }
        val json = JSONObject().apply {
            put("messageId", messageId)
            put("from", from)
            put("to", to)
            put("ttl", maxHops)
            put("payload", payload)
            put("route", JSONArray().apply { put(from) })
            put("type", JUMP_RELAY)
        }
        val jumpPayload = JUMP_PREFIX + json.toString()
        val bytes = jumpPayload.toByteArray(Charsets.UTF_8)
        var sentCount = 0
        connectedEndpoints.forEach { epId ->
            connectionsClient.sendPayload(epId, Payload.fromBytes(bytes))
            sentCount++
        }
        napAudit("NAP-JUMP-002", "JUMP sent $messageId to $sentCount peers, hops=$maxHops", "SUCCESS")
        call.resolve(JSObject().apply {
            put("success", true)
            put("messageId", messageId)
            put("sentToPeers", sentCount)
            put("maxHops", maxHops)
        })
    }

    private fun handleJumpMessage(fromEndpointId: String, payload: String) {
        try {
            val json = JSONObject(payload)
            val messageId = json.getString("messageId")
            val from = json.getString("from")
            val to = json.getString("to")
            val ttl = json.getInt("ttl")
            val route = json.getJSONArray("route")
            val type = json.optString("type", JUMP_RELAY)
            napAudit("NAP-JUMP-003", "handleJumpMessage: msg=${messageId.take(8)} from=$from to=$to ttl=$ttl", "INFO")

            if (processedJumpIds.containsKey(messageId)) {
                napAudit("NAP-JUMP-004", "DEDUP: $messageId already processed", "WARN")
                return
            }
            processedJumpIds[messageId] = System.currentTimeMillis()
            cleanupOldJumpIds()

            val myId = localUserId.ifBlank { localEndpointName }
            if (to == myId) {
                napAudit("NAP-JUMP-005", "I am the destination! Delivering $messageId", "SUCCESS")
                notifyListeners("onJumpMessageReceived", JSObject().apply {
                    put("messageId", messageId)
                    put("from", from)
                    put("to", to)
                    put("payload", json.optString("payload", ""))
                    put("route", route.toString())
                    put("hops", route.length())
                    put("type", JUMP_DELIVER)
                })
                return
            }

            if (ttl <= 0) {
                napAudit("NAP-JUMP-006", "TTL expired for $messageId", "WARN")
                return
            }

            for (i in 0 until route.length()) {
                if (route.getString(i) == myId) {
                    napAudit("NAP-JUMP-007", "LOOP detected! I'm already in route", "WARN")
                    return
                }
            }

            route.put(myId)
            json.put("route", route)
            json.put("ttl", ttl - 1)

            val relayPayload = JUMP_PREFIX + json.toString()
            val relayBytes = relayPayload.toByteArray(Charsets.UTF_8)
            var relayCount = 0
            connectedEndpoints.forEach { epId ->
                if (epId != fromEndpointId) {
                    connectionsClient.sendPayload(epId, Payload.fromBytes(relayBytes))
                    relayCount++
                }
            }
            napAudit("NAP-JUMP-008", "Relayed $messageId to $relayCount peers", "INFO")
        } catch (e: Exception) {
            napAudit("NAP-JUMP-009", "ERROR handling JUMP: ${e.message}", "ERROR")
        }
    }

    private fun cleanupOldJumpIds() {
        val now = System.currentTimeMillis()
        val iterator = processedJumpIds.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (now - entry.value > JUMP_ID_TTL) {
                iterator.remove()
            }
        }
    }

    private fun doAcceptConnection(endpointId: String) {
        connectionsClient.acceptConnection(endpointId, payloadCallback)
    }

    private fun restartAdvertising() {
        if (isAdvertising) {
            connectionsClient.stopAdvertising()
            val endpointName = "$localEndpointName|$localUserId"
            val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).setLowPower(false).build()
            connectionsClient.startAdvertising(endpointName, SERVICE_ID, connectionLifecycleCallback, options)
        }
    }

    private fun getDeviceName(): String {
        return Build.MODEL?.takeIf { it.isNotBlank() } ?: "NEXO Device"
    }

    override fun handleOnDestroy() {
        connectionsClient.stopAdvertising()
        connectionsClient.stopDiscovery()
        connectedEndpoints.toList().forEach { connectionsClient.disconnectFromEndpoint(it) }
        super.handleOnDestroy()
    }
}
