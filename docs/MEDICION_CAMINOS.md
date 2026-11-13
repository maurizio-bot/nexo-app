# Medición de caminos (dueño 13-11)

Pedido del dueño: «pruebas de robustez, velocidad, reactividad de conexión y cambio de conexión de internet, Wi-Fi, Wi-Fi
Direct, Jump, Bluetooth, y de la última implementación Bluetooth/internet y Wi-Fi Direct/internet».

Prueba: `tests/sim/caminos.js` (en la batería: «MEDICIÓN de caminos»). Tres teléfonos simulados (A, B, C), todos con Wi-Fi
Direct; A recorre los caminos uno tras otro. Los tiempos son del **simulador** (Bluetooth a ~12 KB/s, Wi-Fi Direct ~2 MB/s con
~3,5 s de montaje, relés locales): en los teléfonos reales cambian los números absolutos (Bluetooth binario medido por el dueño
~18 KB/s; montar Wi-Fi Direct ~5 s), pero el **orden de los caminos y los saltos entre ellos** son los de la app.

## Resultado (3051; columna «3050» = contraprueba, la misma prueba en la build anterior)

### Velocidad (texto = mediana de 3)
| Camino | Texto | Archivo |
|---|---|---|
| Bluetooth directo | 0,2 s | foto 60 KB: 5,3 s |
| Wi-Fi Direct (control por Bluetooth) | — | 2 MB: 6,1 s |
| Wi-Fi local (misma red) | 0,2 s | 2 MB: 1,7 s |
| Jump (A–B–C, sin internet) | 0,4 s (vuelta 0,2 s) | — |
| Internet (relés) | 0,2 s | foto 300 KB: 2,5 s |
| Puente Bluetooth → internet | 0,2 s (vuelta 0,2 s) | foto 120 KB: 9,7 s |
| Puente Wi-Fi Direct → internet | — | 2 MB: 16,2 s (3 paquetes); bajada 1,5 MB: 7,3 s |

### Reactividad (cuánto tarda en estar listo un camino)
| Qué | 3050 | 3051 |
|---|---|---|
| El puente se arma al perder el internet propio | 101,7 s | **8,4 s** |
| Vuelve el internet propio y se usa | 121,9 s (otra corrida: 74 s) | **1,0 s** |
| Se suelta el puente al volver el internet propio | 151,7 s | 24 s (3052: **6,4 s**) |
| Wi-Fi local entre los dos / internet en línea / Bluetooth al volver | 0,2 s / 0,2 s / 0 s | igual |

### Cambio (un texto mandado JUSTO al caerse el camino que se usaba)
| Cambio | 3050 | 3051 |
|---|---|---|
| Sale del Wi-Fi → Bluetooth | 12,4 s (otra corrida: 20,1 s) | **0,2 s** |
| Se corta el Bluetooth → internet | 0,2 s | 0,2 s |
| Pierde el internet → puente/Jump | 100,9 s | **0,2 s** |
| Vuelve el internet propio | 0,2 s | 0,2 s |

### Robustez
21 textos medidos: 0 perdidos, 0 duplicados.

## Lo que la medición encontró y se arregló (3051)
1. **Salir del Wi-Fi: 12–20 s.** El texto se había resuelto por el Wi-Fi un instante antes de saberse del corte; se reintentaba 5
   veces por el Wi-Fi caído (~8 s) y luego quedaba ⏳ ~12 s. Ahora, al primer «Sin Wi-Fi», va por el camino listo (`ble_ack._doSend`).
2. **El internet propio tardaba 74–122 s en volver a usarse.** La pausa entre reintentos crecía hasta 2 min. Ahora, sin ningún relé
   propio abierto, como mucho 15 s (el reintento va a su hora, no al latido de 15 s) y al entrar a un Wi-Fi, al instante.
3. **El puente tardaba ~100 s en armarse.** (a) El vecino había dicho «no tengo internet» hace poco y no se le volvía a
   preguntar en 2 min → ahora el que presta avisa en cuanto tiene internet a quien le preguntó; (b) el plazo de 8 s se contaba
   desde el latido siguiente → ahora desde el corte; (c) los contactos seguían «en línea por internet» ~2 min tras perder el
   último relé (los envíos se reintentaban por internet) → ahora dejan de estarlo al instante.
4. **2 MB por el puente con Wi-Fi Direct no llegaba.** Mientras se subía al buzón de archivos, el reenvío de pendientes lo
   volvía a mandar trozo a trozo por el puente y chocaba con su tope → lo que se está subiendo cuenta como «en vuelo» y el
   reenvío también va al buzón de archivos. En la bajada por Bluetooth, una fila larga descartaba trozos por esperar su turno →
   la espera por cola llena cuenta desde que le toca.

## Falta (teléfonos reales)
- Repetir en los teléfonos: los mismos pasos con dos o tres teléfonos (ver pruebas cortas en `ESTADO.md`).
- El aviso nativo de «hay red» solo existe para Wi-Fi (`lanWatchWifi`); con datos móviles la vuelta del internet propio se
  nota por el reintento (≤ 15 s). Un aviso nativo para cualquier red con internet lo bajaría a ~1 s.
