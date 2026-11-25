package com.nexo.ble

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.util.Log
import java.util.concurrent.ConcurrentHashMap

/**
 * 3263 (PRIORIDAD 1 del dueño, «Bluetooth entero en el servicio nativo», FASE 2): el servidor GATT es UNO por proceso y NO se cierra
 * al abrir ni al cerrar la app.
 *
 * Antes cada «dueño» abría el suyo: la app (el plugin de la pantalla), la instancia que sigue recibiendo con la app cerrada (orphan) y
 * el servicio sin la app (BleSinApp, 3254). En cada relevo se cerraba un servidor y se abría otro: todos los enlaces que los demás
 * tenían con este teléfono se cortaban (3251) o, peor, sobrevivían apuntando al servidor viejo («enlace que sobrevive al reinicio»:
 * sin suscripción ni MTU, «Write fallo», MTU 23 y «zombi»; visto 3 veces del 17 al 20-11). Abrir NEXO —lo que más hace el usuario—
 * rompía el Bluetooth de todos sus contactos cercanos durante unos segundos.
 *
 * Ahora el servidor vive aquí (en el proceso, que el servicio en primer plano mantiene vivo) con lo que hay que heredar de cada
 * enlace entrante: quién está conectado, quién está suscrito a nuestras notificaciones, su MTU y cuáles «tenemos» (3262). Quien
 * atiende (la app, la app cerrada o el servicio) solo se ENGANCHA (attach) y se suelta (detach): el relevo no toca los enlaces. El
 * otro teléfono ni se entera de que NEXO se abrió o se cerró.
 *
 * Se cierra de verdad solo cuando el Bluetooth se apaga (Android lo mata igual), al pasar la cuenta a otro teléfono o al limpiar sin
 * permisos. Si no atiende nadie (el instante del relevo) se lleva lo mínimo: altas, bajas y suscripciones; lo escrito en ese hueco
 * no se confirma y el otro lo reenvía.
 */
internal object GattServerHost {
    private const val TAG = "NEXO_GATT_HOST"

    @Volatile var server: BluetoothGattServer? = null
    @Volatile var tx: BluetoothGattCharacteristic? = null
    @Volatile var rx: BluetoothGattCharacteristic? = null
    /** Enlaces entrantes (clave: dirección sin separadores, en minúsculas). */
    val connected = ConcurrentHashMap<String, BluetoothDevice>()
    /** Suscritos a nuestras notificaciones (sin esto no se les puede mandar nada). */
    val notifOn = ConcurrentHashMap<String, Boolean>()
    /** MTU que negoció el otro por su enlace hacia nosotros. */
    val mtu = ConcurrentHashMap<String, Int>()
    /** Los que «tenemos» (BluetoothGattServer.connect): solo esos se pueden cortar de verdad (3262). */
    val held: MutableSet<String> = ConcurrentHashMap.newKeySet()

    @Volatile private var delegate: BluetoothGattServerCallback? = null
    /** Quién atiende ahora («app», «app cerrada», «servicio» o «» = nadie). Para el registro. */
    @Volatile var owner = ""
        private set

    fun norm(addr: String) = addr.replace(":", "").replace("-", "").replace(".", "").lowercase()

    /** Quien atiende a partir de ahora lo que llega (hilo principal). */
    fun attach(cb: BluetoothGattServerCallback, who: String) { delegate = cb; owner = who }
    /** Deja de atender (solo si era él): el servidor y sus enlaces siguen. */
    fun detach(cb: BluetoothGattServerCallback) { if (delegate === cb) { delegate = null; owner = "" } }
    fun attendedBy(cb: BluetoothGattServerCallback) = delegate === cb

    /** Abre el servidor si no lo está (hilo principal). Devuelve si quedó abierto; opened = true si se abrió AHORA. */
    fun open(ctx: Context, opened: (() -> Unit)? = null): Boolean {
        if (server != null) return true
        return try {
            val bm = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager ?: return false
            val adapter = bm.adapter
            if (adapter == null || !adapter.isEnabled) return false
            val srv = bm.openGattServer(ctx.applicationContext ?: ctx, relay) ?: return false
            val service = BluetoothGattService(NexoBleSpec.NEXO_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
            val txc = BluetoothGattCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ)
            txc.addDescriptor(BluetoothGattDescriptor(NexoBleSpec.CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
            val rxc = BluetoothGattCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE, BluetoothGattCharacteristic.PERMISSION_WRITE)
            service.addCharacteristic(txc)
            service.addCharacteristic(rxc)
            if (!srv.addService(service)) { try { srv.close() } catch (e: Throwable) { }; return false }
            clearLinks()
            server = srv; tx = txc; rx = rxc
            opened?.invoke()
            true
        } catch (e: Throwable) { Log.w(TAG, "open: ${e.javaClass.simpleName} ${e.message}"); false }
    }

    /** Cierra de verdad el servidor (suelta también los enlaces que tuviéramos). Quien atendía sigue enganchado para el próximo. */
    fun close() {
        val srv = server
        server = null; tx = null; rx = null
        try { srv?.close() } catch (e: Throwable) { }
        clearLinks()
    }

    private fun clearLinks() { connected.clear(); notifOn.clear(); mtu.clear(); held.clear() }

    /** El único aviso que Android conoce: pasa todo a quien atiende y lleva lo común de cada enlace. */
    val relay: BluetoothGattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val d = delegate
            if (d != null) d.onConnectionStateChange(device, status, newState)
            else if (newState == BluetoothProfile.STATE_CONNECTED) connected[norm(device.address)] = device
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val mac = norm(device.address)
                connected.remove(mac); notifOn.remove(mac); mtu.remove(mac); held.remove(mac)
            }
        }

        override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
                                                  preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            val d = delegate
            if (d != null) { d.onCharacteristicWriteRequest(device, requestId, characteristic, preparedWrite, responseNeeded, offset, value); return }
            // nadie atiende (el instante del relevo): se contesta al sistema y el contenido se pierde (sin ✓✓ el otro lo reenvía)
            if (responseNeeded) try { server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value) } catch (e: Throwable) { }
        }

        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
                                              preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            val d = delegate
            if (d != null) { d.onDescriptorWriteRequest(device, requestId, descriptor, preparedWrite, responseNeeded, offset, value); return }
            if (descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                val on = value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true ||
                    value?.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE) == true
                val mac = norm(device.address)
                connected[mac] = device; notifOn[mac] = on
            }
            if (responseNeeded) try { server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value) } catch (e: Throwable) { }
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) { delegate?.onNotificationSent(device, status) }

        override fun onMtuChanged(device: BluetoothDevice, m: Int) {
            mtu[norm(device.address)] = if (m > 23) m else 23
            delegate?.onMtuChanged(device, m)
        }
    }
}
