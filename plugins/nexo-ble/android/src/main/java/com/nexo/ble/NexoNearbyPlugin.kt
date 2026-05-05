package com.nexo.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
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

@CapacitorPlugin(name = "NexoNearby")
class NexoNearbyPlugin : Plugin() {

    companion object {
        const val TAG = "NAP-Nearby"
        const val SERVICE_ID = "com.nexo.app"
        val STRATEGY = Strategy.P2P_CLUSTER
    }

    private lateinit var connectionsClient: ConnectionsClient
    private val discoveredEndpoints = mutableMapOf<String, JSObject>()
    private val connectedEndpoints = mutableSetOf<String>()
    private val pendingConnections = mutableSetOf<String>()
    private var isAdvertising = false
    private var isDiscovering = false

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            pendingConnections.add(endpointId)
            notifyListeners("onConnectionInitiated", JSObject().apply {
                put("endpointId", endpointId)
                put("endpointName", info.endpointName)
                put("authenticationToken", info.authenticationToken)
                put("isIncomingConnection", info.isIncomingConnection)
            })
            acceptConnection(endpointId)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            pendingConnections.remove(endpointId)
            if (result.status.isSuccess) {
                connectedEndpoints.add(endpointId)
                val dev = discoveredEndpoints[endpointId]
                notifyListeners("onConnected", JSObject().apply {
                    put("endpointId", endpointId)
                    put("endpointName", dev?.getString("endpointName") ?: "Unknown")
                    put("status", "connected")
                })
            } else {
                notifyListeners("onConnectionFailed", JSObject().apply {
                    put("endpointId", endpointId)
                    put("statusCode", result.status.statusCode)
                })
            }
        }

        override fun onDisconnected(endpointId: String) {
            connectedEndpoints.remove(endpointId)
            discoveredEndpoints.remove(endpointId)
            notifyListeners("onDisconnected", JSObject().put("endpointId", endpointId))
            if (connectedEndpoints.isEmpty() && isAdvertising) restartAdvertising()
        }
    }

    private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            val data = JSObject().apply {
                put("endpointId", endpointId)
                put("endpointName", info.endpointName)
                put("serviceId", info.serviceId)
            }
            discoveredEndpoints[endpointId] = data
            notifyListeners("onEndpointFound", data)
        }

        override fun onEndpointLost(endpointId: String) {
            discoveredEndpoints.remove(endpointId)
            notifyListeners("onEndpointLost", JSObject().put("endpointId", endpointId))
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            if (payload.type == Payload.Type.BYTES) {
                val message = payload.asBytes()?.let { String(it, Charsets.UTF_8) } ?: ""
                notifyListeners("onPayloadReceived", JSObject().apply {
                    put("endpointId", endpointId)
                    put("message", message)
                    put("type", "bytes")
                })
            }
        }
        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }

    override fun load() {
        super.load()
        connectionsClient = Nearby.getConnectionsClient(context.applicationContext)
    }

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
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
        val endpointName = call.getString("endpointName", getDeviceName()) ?: getDeviceName()
        val options = AdvertisingOptions.Builder()
            .setStrategy(STRATEGY)
            .setLowPower(false)
            .build()

        connectionsClient.startAdvertising(endpointName, SERVICE_ID, connectionLifecycleCallback, options)
            .addOnSuccessListener {
                isAdvertising = true
                call.resolve(JSObject().apply {
                    put("success", true)
                    put("endpointName", endpointName)
                })
            }
            .addOnFailureListener { e ->
                call.reject("ADVERTISING_FAILED", e.message, e)
            }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        connectionsClient.stopAdvertising()
        isAdvertising = false
        call.resolve()
    }

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        val options = DiscoveryOptions.Builder()
            .setStrategy(STRATEGY)
            .setLowPower(false)
            .build()

        connectionsClient.startDiscovery(SERVICE_ID, endpointDiscoveryCallback, options)
            .addOnSuccessListener {
                isDiscovering = true
                call.resolve(JSObject().put("success", true))
            }
            .addOnFailureListener { e ->
                call.reject("DISCOVERY_FAILED", e.message, e)
            }
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        connectionsClient.stopDiscovery()
        isDiscovering = false
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
            .addOnSuccessListener { call.resolve(JSObject().put("success", true)) }
            .addOnFailureListener { e -> call.reject("SEND_FAILED", e.message, e) }
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
        } else {
            connectedEndpoints.toList().forEach { connectionsClient.disconnectFromEndpoint(it) }
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
        call.resolve()
    }

    private fun restartAdvertising() {
        if (isAdvertising) {
            connectionsClient.stopAdvertising()
            val endpointName = getDeviceName()
            val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).setLowPower(false).build()
            connectionsClient.startAdvertising(endpointName, SERVICE_ID, connectionLifecycleCallback, options)
        }
    }

    private fun getDeviceName(): String {
        return Build.MODEL ?: "NEXO Device"
    }

    override fun handleOnDestroy() {
        connectionsClient.stopAdvertising()
        connectionsClient.stopDiscovery()
        connectedEndpoints.toList().forEach { connectionsClient.disconnectFromEndpoint(it) }
        super.handleOnDestroy()
    }
}
