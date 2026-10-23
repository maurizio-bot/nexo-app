# Wi-Fi normal y cambio automático de camino

Pedido del dueño (23-10-2026): "implementa wifi normal y la parte de switcheo entre bluetooth, wifi direct y wifi".

## Qué hace
- **Wi-Fi normal (misma red)**: si dos contactos están en la misma red Wi-Fi (casa, oficina, un local, el punto de
  acceso de un móvil), se encuentran solos y se hablan por la red: mucho más rápido que Bluetooth (una foto de
  400 KB en ~1 s en el simulador; por Bluetooth ~60 s) y sin montar grupo como Wi-Fi Direct. Funciona aunque no estén
  a alcance de Bluetooth (otra habitación, otra planta).
- **Cambio automático** (por contacto, en cada envío):
  1. Wi-Fi de la misma red, si hay enlace comprobado con ese contacto.
  2. Bluetooth directo; para archivos grandes, Wi-Fi Direct si los dos lo tienen (como hasta ahora).
  3. Jump (por otros teléfonos NEXO).
  4. Si no hay ninguno: queda pendiente y sale solo cuando aparece un camino.
- **Si el Wi-Fi se cae a mitad** (se sale de la red, se apaga el Wi-Fi o el router):
  - textos esperando confirmación y envíos por trozos siguen por Bluetooth donde iban (sin empezar de cero);
  - un vídeo original o un archivo que no cabe por Bluetooth pasa a previa + HD (como cuando falla Wi-Fi Direct);
  - sin Bluetooth: pendiente hasta reconectar (se reanuda solo).
  - Caída "silenciosa" (el otro no se entera, típico de TCP): latido nativo cada 4 s (lo contesta el Kotlin, también
    con la app en segundo plano); sin nada en 30 s se da por caída.
- **Reglas del dueño (ronda 2730)**: un corte breve no cambia de camino (8 s de margen para recuperar el Wi-Fi); con
  mala señal medida (ida y vuelta >1,5 s o 12 s sin nada, dos veces seguidas) lo nuevo va por Bluetooth y vuelve al
  Wi-Fi cuando mejora (<0,8 s dos veces).
- La cabecera del chat dice por dónde va: "En línea · Wi-Fi", "En línea · Bluetooth" o "Por Jump".

## Privacidad y seguridad
- En la red cada teléfono se anuncia (NSD/mDNS, `_nexo._tcp`) con una **marca del día**:
  SHA-256("nexo-lan|<NEXO ID>|<fecha UTC>") recortada. Solo quien ya conoce el NEXO ID (un contacto) la reconoce; un
  desconocido en la misma red no sabe quién eres, y la marca cambia cada día. Los contactos prueban la de hoy y la de
  ayer.
- Antes de usar una conexión se **comprueba con el cifrado de extremo a extremo**: `lv` lleva un número al azar
  cifrado para el contacto; solo el de verdad lo puede leer y devolver (`lw`). Hasta entonces no se manda ni se
  acepta nada más por ella. Un impostor con la marca de otro nunca se comprueba (se cierra a los 30 s y no ocupa el
  sitio del de verdad).
- Todo lo que viaja por la red va cifrado de extremo a extremo igual que por Bluetooth (mismo protocolo 2).

## Cómo está hecho
- Kotlin `LanHub.kt` (sin Android; probado en JVM con sockets reales, `tests/kotlin`): servidor TCP, conexiones con
  marcos `[longitud][JSON]`, saludo `{"h":1,"nx":…}`, una sola conexión si los dos conectan a la vez.
- `NexoBlePlugin`: `lanStatus`, `lanStart` (anuncio + búsqueda NSD, MulticastLock), `lanConnect`, `lanSend` (en su
  hilo, en orden), `lanDrop`, `lanStop`; avisos `onLanPeer`, `onLanUp`, `onLanDown`, `onLanMessage`. Permiso nuevo
  (normal, sin pregunta): `CHANGE_WIFI_MULTICAST_STATE`.
- `src/ui/lan.js`: marcas, conexión, comprobación, latido, `canReach`, `send`.
- `ble_interface`: el enlace es el dispositivo `lan:<NEXO ID>` (preferido en `_resolveDeviceIdForNexoId`),
  `_lanUp` / `_lanDown` / `_onLanPayload` / `linkOf`. `ble_ack`: por Wi-Fi trozos de 24 KB; `relink` y
  `ChatStream.useLink` para seguir por Bluetooth; reanudar siempre por el mejor camino del momento; un envío que no
  puede salir ya no se reintenta para siempre cada 200 ms.
- Pensado también para iPhone: Bonjour es compatible con NSD y el TCP es el mismo.

## Límites
- Hace falta que la red deje hablar a los dispositivos entre sí: algunas redes públicas o de invitados lo bloquean
  ("aislamiento de clientes"); entonces sigue por Bluetooth.
- Datos móviles / redes distintas: no (haría falta un servidor de relevo; decisión pendiente).
- Probado en el simulador (`tests/sim/lan.js`) y la parte de sockets en JVM; el descubrimiento NSD solo se puede
  confirmar en teléfonos reales.
