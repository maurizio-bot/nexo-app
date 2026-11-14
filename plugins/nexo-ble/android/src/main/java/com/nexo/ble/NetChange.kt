package com.nexo.ble

// 3085 (dueño 14-11: «el S24 cambia de Wi-Fi a datos en automático y muy rápido, ¿por qué nosotros somos lentos?»): la app solo se
// enteraba de «entré a un Wi-Fi». Esto decide, a partir de lo que Android dice de la red POR DEFECTO, qué tipo es y si cambió
// (solo se avisa a la app en un cambio de tipo: Android repite el aviso de capacidades con cada cambio de señal).
object NetChange {
    fun typeOf(wifi: Boolean, cell: Boolean, eth: Boolean, vpn: Boolean): String = when {
        wifi -> "wifi"
        cell -> "cell"
        eth -> "eth"
        vpn -> "vpn"
        else -> "other"
    }

    class Tracker {
        var last = ""
            private set
        // Devuelve el tipo ANTERIOR si hubo cambio (y no es el primero que se ve); null si no hay que avisar
        fun update(t: String): String? {
            if (t.isEmpty() || t == last) return null
            val prev = last
            last = t
            return if (prev.isEmpty()) null else prev
        }
    }
}
