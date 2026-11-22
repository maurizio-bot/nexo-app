package com.nexo.ble

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.os.Build
import android.os.Handler

/**
 * 3280 (PRIORIDAD 1 del dueño, remate de la FASE 3: «que el servicio sin la app también abra enlaces»): los enlaces Bluetooth de
 * CLIENTE que abre el servicio cuando NO hay app en el proceso (BleSinApp).
 *
 * Hasta ahora el servicio sin la app solo tenía su servidor: escribía lo pendiente de la bandeja por los enlaces que abría el OTRO
 * teléfono. Si NEXO había vuelto sola (Android la cerró, se reinició el teléfono, se actualizó) y los dos estaban dormidos, nadie
 * conectaba y el mensaje esperaba a que alguien abriera la app. Ahora el servicio busca al contacto (BleSinApp.dialStep) y abre él el
 * enlace; aquí vive ese enlace: conectar → servicios → MTU → notificaciones → listo → escribir de a un trozo → lo que el otro contesta
 * (su ✓✓ firmada, o un mensaje suyo) va al mismo núcleo que lo recibido por el servidor (SinAppCore).
 *
 * Es lo mínimo del cliente de la app (PluginGatt), sin la app: el mismo orden (Android hace UNA operación GATT a la vez; el MTU antes
 * que las notificaciones, ronda 2757) y los mismos trozos (Utf8Split por MTU). Todo en el hilo principal. Al abrirse la app estos
 * enlaces se cierran (closeAll): ella abre los suyos. Un enlace sin nada pendiente para su contacto se cierra solo a los 45 s.
 */
internal class SinAppLinks(private val ctx: Context, private val handler: Handler, private val host: Host) {

    interface Host {
        /** El enlace quedó listo (MTU y notificaciones): ya se puede escribir por él. */
        fun ready(link: String, nx: String)
        /** Lo que el otro manda por el enlace (una notificación). */
        fun bytes(link: String, value: ByteArray)
        fun closed(link: String)
        fun log(level: String, msg: String)
    }

    companion object {
        const val CONNECT_TIMEOUT_MS = 15_000L
        const val MTU_WAIT_MS = 2_000L
        const val WRITE_TIMEOUT_MS = 6_000L
        const val IDLE_CLOSE_MS = 45_000L
        const val MAX_QUEUE = 400
        private const val PREFIX = "out:"
        /** Clave del enlace de cliente a esa dirección (distinta de la de un enlace entrante de la misma dirección). */
        fun key(mac: String) = PREFIX + mac
        fun isClient(link: String) = link.startsWith(PREFIX)
    }

    private class L(val link: String, val nx: String) {
        var gatt: BluetoothGatt? = null
        var rx: BluetoothGattCharacteristic? = null
        var tx: BluetoothGattCharacteristic? = null
        var mtu = 23
        var setup = false
        var ready = false
        val q = ArrayDeque<ByteArray>()
        var writing = false
        var writeSeq = 0
        var lastAt = 0L
    }

    private val links = HashMap<String, L>()
    private fun now() = System.currentTimeMillis()

    fun count() = links.size
    fun has(mac: String) = links.containsKey(key(mac))
    fun ready(link: String) = links[link]?.ready == true
    fun addressOf(link: String): String? = try { links[link]?.gatt?.device?.address } catch (e: Throwable) { null }

    /** Abre el enlace con ese contacto (visto en esa dirección). false = ya había uno o Android no dejó. */
    fun connect(nx: String, mac: String, device: BluetoothDevice): Boolean {
        val link = key(mac)
        if (links.containsKey(link)) return false
        val l = L(link, nx)
        val g = try { device.connectGatt(ctx, false, callback(l), BluetoothDevice.TRANSPORT_LE) } catch (e: Throwable) { null } ?: return false
        l.gatt = g; l.lastAt = now()
        links[link] = l
        handler.postDelayed({ if (links[link] === l && !l.ready) close(l, "no quedó listo en 15 s") }, CONNECT_TIMEOUT_MS)
        return true
    }

    /** Escribe un mensaje por el enlace (partido según su MTU). false = no está listo o la cola está llena: más tarde. */
    fun send(link: String, json: String): Boolean {
        val l = links[link] ?: return false
        if (!l.ready) return false
        val parts = Utf8Split.split(json, (l.mtu - 3).coerceIn(20, 512))
        if (l.q.isNotEmpty() && l.q.size + parts.size > MAX_QUEUE) return false
        parts.forEach { l.q.addLast(it.toByteArray(Charsets.UTF_8)) }
        pump(l)
        return true
    }

    /** Cierra los enlaces listos que llevan un rato sin moverse y cuyo contacto ya no tiene nada pendiente. */
    fun closeIdle(pendingFor: (String) -> Boolean) {
        val t = now()
        for (l in links.values.toList()) {
            if (l.ready && !l.writing && l.q.isEmpty() && t - l.lastAt > IDLE_CLOSE_MS && !pendingFor(l.nx)) close(l, "ya no hay nada pendiente para él")
        }
    }

    fun closeAll(why: String) { links.values.toList().forEach { close(it, why) } }

    private fun close(l: L, why: String) {
        if (links[l.link] !== l) return
        links.remove(l.link)
        l.q.clear(); l.ready = false
        try { l.gatt?.disconnect() } catch (e: Throwable) { }
        try { l.gatt?.close() } catch (e: Throwable) { }
        host.log("INFO", "Bandeja de salida: enlace abierto por el teléfono con ${l.nx}: cerrado ($why)")
        try { host.closed(l.link) } catch (e: Throwable) { }
    }

    // Las notificaciones del otro (una sola vez por enlace), después del MTU. Listo cuando Android confirma que quedaron activadas.
    private fun subscribe(l: L) {
        if (l.setup || links[l.link] !== l) return
        l.setup = true
        val g = l.gatt; val tx = l.tx
        val ok = try {
            if (g == null || tx == null) false else {
                g.setCharacteristicNotification(tx, true)
                val d = tx.getDescriptor(NexoBleSpec.CCCD_UUID)
                if (d == null) false
                else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothStatusCodes.SUCCESS
                else {
                    @Suppress("DEPRECATION")
                    d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    @Suppress("DEPRECATION")
                    g.writeDescriptor(d)
                }
            }
        } catch (e: Throwable) { false }
        if (!ok) close(l, "no se pudieron pedir las notificaciones")
    }

    // Un trozo detrás de otro (con respuesta): el siguiente sale cuando Android confirma el anterior
    private fun pump(l: L) {
        if (l.writing || !l.ready || links[l.link] !== l) return
        val g = l.gatt; val rx = l.rx
        val data = l.q.removeFirstOrNull() ?: return
        val ok = try {
            if (g == null || rx == null) false
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) g.writeCharacteristic(rx, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
            else {
                rx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                @Suppress("DEPRECATION")
                rx.value = data
                @Suppress("DEPRECATION")
                g.writeCharacteristic(rx)
            }
        } catch (e: Throwable) { false }
        if (!ok) { l.q.clear(); return } // no se martilla: la bandeja lo reintenta a su ritmo (el otro tira el resto cortado)
        l.writing = true; l.lastAt = now()
        val seq = l.writeSeq
        handler.postDelayed({ if (links[l.link] === l && l.writing && l.writeSeq == seq) close(l, "una escritura no terminó en 6 s") }, WRITE_TIMEOUT_MS)
    }

    private fun callback(l: L) = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            handler.post {
                if (links[l.link] !== l) {
                    if (newState == BluetoothProfile.STATE_CONNECTED) { try { gatt.disconnect() } catch (e: Throwable) { }; try { gatt.close() } catch (e: Throwable) { } }
                    return@post
                }
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    l.lastAt = now()
                    try { gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH) } catch (e: Throwable) { }
                    val asked = try { gatt.discoverServices() } catch (e: Throwable) { false }
                    if (!asked) close(l, "no se pudieron pedir los servicios")
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                    close(l, if (l.ready) "el enlace se cortó (estado $status)" else "no se pudo conectar (estado $status)")
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            handler.post {
                if (links[l.link] !== l) return@post
                val svc = if (status == BluetoothGatt.GATT_SUCCESS) gatt.getService(NexoBleSpec.NEXO_SERVICE_UUID) else null
                val rx = svc?.getCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID)
                val tx = svc?.getCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID)
                if (rx == null || tx == null) { close(l, "el otro no tiene abierto el servicio de NEXO"); return@post }
                l.rx = rx; l.tx = tx
                // MTU primero; las notificaciones cuando contesta (o a los 2 s si no contesta)
                val asked = try { gatt.requestMtu(NexoBlePlugin.MTU_REQUEST) } catch (e: Throwable) { false }
                if (asked) handler.postDelayed({ subscribe(l) }, MTU_WAIT_MS) else subscribe(l)
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            handler.post {
                if (links[l.link] !== l) return@post
                l.mtu = if (status == BluetoothGatt.GATT_SUCCESS && mtu > 23) mtu else 23
                subscribe(l)
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (descriptor.uuid != NexoBleSpec.CCCD_UUID) return
            handler.post {
                if (links[l.link] !== l || l.ready) return@post
                if (status != BluetoothGatt.GATT_SUCCESS) { close(l, "no aceptó las notificaciones (estado $status)"); return@post }
                l.ready = true; l.lastAt = now()
                try { host.ready(l.link, l.nx) } catch (e: Throwable) { }
                pump(l)
            }
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (characteristic.uuid != NexoBleSpec.RX_CHARACTERISTIC_UUID) return
            handler.post {
                if (links[l.link] !== l) return@post
                l.writing = false; l.writeSeq++
                if (status != BluetoothGatt.GATT_SUCCESS) l.q.clear() // el resto de ese mensaje ya no sirve: la bandeja lo reintenta entero
                pump(l)
            }
        }

        @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid != NexoBleSpec.TX_CHARACTERISTIC_UUID) return
            val v = characteristic.value?.copyOf() ?: return // copia ya: la siguiente notificación pisa el valor
            deliver(v)
        }

        // Android 13+: el valor llega aparte
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            if (characteristic.uuid != NexoBleSpec.TX_CHARACTERISTIC_UUID) return
            deliver(value)
        }

        private fun deliver(v: ByteArray) {
            handler.post {
                if (links[l.link] !== l) return@post
                l.lastAt = now()
                try { host.bytes(l.link, v) } catch (e: Throwable) { }
            }
        }
    }
}
