package com.nexo.ble

// Pacing de la cola de escritura BLE — pacing 2b (#141 / #129, dueño 01-11).
//
// Problema real (diagnóstico del dueño, Galaxy Tab A7 Lite con MTU 23): al mandar un archivo por un enlace lento, sus
// trozos LLENAN la cola de escritura nativa; un texto / ACK / mensaje de control que llega justo después quedaba ATRÁS
// de todos esos trozos → el texto tarda y las burbujas se quedan en ○, los ACKs llegan tarde. (La concurrencia por enlace
// ya se acotó en JS —1 archivo a la vez, build 2872—; esto es el último tramo: el orden DENTRO de la cola nativa.)
//
// Idea: marcar cada item como ALTA prioridad (texto / control / ACK, vía sendMessage) o BAJA (trozo de archivo, vía
// sendBinary). `insertIndex` dice DÓNDE meter un item nuevo para que lo ALTA salte por delante de los trozos de archivo
// ya encolados, SIN tocar el item en vuelo (índice 0 nunca se desplaza) y respetando el orden FIFO entre items de la
// misma prioridad. Pura (sin Android): se prueba en JVM (WritePacingTest). No cambia QUÉ se envía, solo el ORDEN.
object WritePacing {
    // highFlags: el isHigh de cada item ya en la cola, en orden. newIsHigh: prioridad del item a insertar.
    // Devuelve el índice de inserción (0..n):
    //  - BAJA (archivo) → al final (n): no adelanta a nadie.
    //  - ALTA (texto/control/ack) → tras el item en vuelo (índice 0) y tras los ALTA que ya lo preceden, pero DELANTE
    //    del primer BAJA → el texto no espera a que terminen los trozos de archivo. Si todos son ALTA, va al final (FIFO).
    fun insertIndex(highFlags: List<Boolean>, newIsHigh: Boolean): Int {
        val n = highFlags.size
        if (n == 0) return 0
        if (!newIsHigh) return n              // archivo: al final de la cola
        var i = 1                             // nunca desplazar el índice 0 (puede estar «en vuelo», esperando el callback)
        while (i < n && highFlags[i]) i++     // saltar los ALTA que ya están encolados (mantener FIFO entre ALTA)
        return i                              // delante del primer BAJA (o al final si no hay ninguno BAJA)
    }
}
