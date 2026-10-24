# Wi-Fi normal y cambio automático de camino

Pedido del dueño (23-10-2026): "implementa wifi normal y la parte de switcheo entre bluetooth, wifi direct y wifi".

## Qué hace
- **Wi-Fi normal (misma red)**: si dos contactos están en la misma red Wi-Fi (casa, oficina, un local, el punto de
  acceso de un móvil), se encuentran solos y se hablan por la red: mucho más rápido que Bluetooth (una foto de
  400 KB en ~1 s en el simulador; por Bluetooth ~60 s) y sin montar grupo como Wi-Fi Direct. Funciona aunque no estén
  a alcance de Bluetooth (otra habitación, otra planta).
- **Cambio automático** (por contacto, en cada envío; orden de `_resolveDeviceIdForNexoId`, al día con la 2768):
  1. Wi-Fi de la misma red, si hay enlace comprobado con ese contacto.
  2. Internet, si los dos están en Wi-Fi (aunque sean módems distintos; ronda 2739, `docs/INTERNET.md`).
  3. Bluetooth directo (si hay varias conexiones, la de MTU más alto); un archivo de ~110 KB a ~22 MB va por Wi-Fi
     Direct si los dos lo tienen. Archivos grandes (hasta 1 GB, `big_file.js`): Wi-Fi común, Wi-Fi Direct o L2CAP.
  4. Internet con datos móviles en alguno: solo textos (fotos y archivos esperan al Wi-Fi o van por Bluetooth).
  5. Jump (por otros teléfonos NEXO).
  6. Si no hay ninguno: queda pendiente y sale solo cuando aparece un camino.
- **Si el Wi-Fi se cae a mitad** (se sale de la red, se apaga el Wi-Fi o el router):
  - textos esperando confirmación y envíos por trozos siguen por Bluetooth donde iban (sin empezar de cero);
  - un vídeo original o un archivo que no cabe por Bluetooth pasa a previa + HD (como cuando falla Wi-Fi Direct);
  - sin Bluetooth: pendiente hasta reconectar (se reanuda solo).
  - Caída "silenciosa" (el otro no se entera, típico de TCP): latido nativo cada 4 s (lo contesta el Kotlin, también
    con la app en segundo plano); sin nada en 30 s se da por caída.
- **Reglas del dueño (rondas 2730 y 2760; `lan.js`)**: un corte no cambia de camino enseguida: 15 s para recuperar el
  Wi-Fi (lo escrito queda pendiente, sin "!"). Mala señal medida por el latido nativo (cada 4 s): ida y vuelta >1,5 s
  o 12 s sin recibir nada, 3 latidos seguidos (~12 s) → lo nuevo y lo que está saliendo van por internet (los dos en
  Wi-Fi) o, si no, por Bluetooth; sin otro camino, sigue por el Wi-Fi lento. Vuelve al Wi-Fi tras 8 latidos buenos
  seguidos (~30 s, ida y vuelta <0,8 s); tras un corte, en cuanto vuelve y se comprueba.
- Llamadas (`calls.js`): la voz no espera el margen: con el Wi-Fi caído o sin voz del otro en 3 s pasa al Bluetooth, y
  sigue el camino por el que llega la voz del otro (2768). No van por internet; el vídeo, solo por Wi-Fi.
- La cabecera del chat dice por dónde va: "En línea · Wi-Fi", "En línea · Bluetooth" o "Por Jump".

## Escaneo de la red (idea del dueño, ronda 2733)
El anuncio mDNS no siempre llega: muchos routers de operadora, repetidores y redes en malla no dejan pasar ese tráfico
entre teléfonos, y entonces los dos estaban en el mismo Wi-Fi sin encontrarse. Ahora, además, cada teléfono **pregunta
a toda la red** "¿hay algún NEXO?" (Kotlin `LanBeacon`, UDP puerto 47824):
- al conectarse a una red Wi-Fi (aviso de Android), al volver a la app y cada minuto: a la dirección de difusión;
- al entrar en la red, al volver a la app y cada 5 min, también **dirección por dirección** (hasta 1022 direcciones,
  redes /22 o más pequeñas), por si el router filtra también la difusión.
Quien la oye contesta con su marca del día y su puerto. Mismas reglas que con mDNS: solo un contacto reconoce la marca y
la conexión se comprueba con el cifrado antes de usarla. El diagnóstico dice cómo se encontró:
`[WIFI] nx… está en la misma red (escaneo de la red | anuncio mDNS)`.
No sirve si el router aísla a los clientes entre sí (redes de invitados): ahí tampoco pasa la conexión.

## Módems distintos (cada uno en su casa)
Dos teléfonos en redes Wi-Fi distintas no tienen camino local entre ellos: solo internet. Desde internet no se puede
"escanear" la casa de otro (los teléfonos tienen direcciones privadas detrás de su módem, que no deja entrar conexiones
que nadie pidió). Para hablar por internet hace falta un punto de encuentro donde cada teléfono diga "estoy aquí":
servidor propio, Tor o relés públicos. Decidido por el dueño y hecho en la ronda 2739: relés públicos y Tor
(`docs/INTERNET.md`).

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
- Redes distintas o datos móviles: por internet (relés y Tor, ronda 2739); con datos móviles, solo textos.
- Probado en el simulador (`tests/sim/lan.js`) y la parte de sockets en JVM; el descubrimiento NSD solo se puede
  confirmar en teléfonos reales.
