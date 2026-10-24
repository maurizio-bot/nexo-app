package com.nexo.ble

// Respuesta de ADD_ONION tal como la devuelve jtorctl (TorControlConnection.addOnion, la librería de tor-android):
// "onionAddress" (sin .onion) y "onionPrivKey" ("ED25519-V3:…", solo si la clave es nueva), no los nombres del
// protocolo de control de Tor (ServiceID / PrivateKey). Ronda 2765: el código leía ServiceID, nunca encontraba la
// dirección y en los teléfonos salía "Tor no disponible: sin dirección .onion" (diagnóstico del Vivo). Sin Android:
// se prueba en JVM con la jtorctl de verdad (TorOnionTest).
object TorOnion {
    fun address(res: Map<String, String>): String? =
        (res["onionAddress"] ?: res["ServiceID"])?.trim()?.removeSuffix(".onion")?.takeIf { it.isNotEmpty() }?.let { "$it.onion" }

    // Clave para guardar y volver a usar (misma dirección siempre); jtorctl exige "tipo:clave"
    fun privateKey(res: Map<String, String>): String? =
        (res["onionPrivKey"] ?: res["PrivateKey"])?.trim()?.takeIf { it.contains(':') }
}
