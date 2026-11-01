# Análisis de conexiones — diagnóstico real 2026-11-01

Fuente: diagnóstico del dueño `50bb76f1-diagnostico1.txt` (2889 líneas), **prueba real con los dos
teléfonos SEPARADOS** (dos Wi-Fi distintas, no lado a lado). Teléfono: Samsung S23 (NX1E50C95D,
Android 16), app v9.1.0-b1273. Contacto principal: nx1n36c283 (alcanzable por internet). En todo el
log **no hay ni un ERROR ni crash**; lo grave son patrones de comportamiento y WARN.

Lista rastreable **problema → evidencia (log + código) → causa → solución robusta**. Orden de arreglo
propuesto al final. Cada arreglo se hará **uno a uno**, reproducido en `tests/sim` y con batería verde
antes de subir.

---

## P1 — (GRAVE, dueño #3+#6) La videollamada por INTERNET no transmite vídeo — ✅ HECHO (build 2859, 01-11)
**Evidencia (log):** 2 llamadas por internet con nx1n36c283. La de vídeo duró 536 s con audio perfecto
(voz enviada 4172 / recibida 4166) pero **`vídeo enviado 0 / recibido 0`** todo el rato (576 líneas).
El lado local SÍ captura y codifica (`imágenes 4774, completas 64, 360x480`) pero **no transmite**; el
decodificador del vídeo remoto **nunca se inicializa** (`del otro: decodificadas 0, decodificador no`
574×) aunque el otro reporta `su cámara on` 372×. **No hay ningún mensaje de rechazo** ("solo voz" /
"sin Wi-Fi"): la llamada se estableció y negoció VP8; falló el TRANSPORTE del vídeo.
**Evidencia (código):** `calls.js:273` → `if (kind === 'v' && link.indexOf('lan:') !== 0) return;` — los
fotogramas de vídeo solo se mandan por `lan:` (Wi-Fi misma red); por `net:` (internet) se descartan TODOS.
Incoherente con `calls.js:83 canVideo()`, que SÍ permite `net:`.
**Causa:** el vídeo está limitado a Wi-Fi misma red; por internet nunca se envía, aunque se codifique.
**Solución aplicada (2859):** nuevo `calls.js _videoLinkOk(link,nx)` + gate en `_sendPacket`: el vídeo
sale por `lan:` SIEMPRE y por `net:` **solo cuando la ruta es Tor DIRECTO** (`net.via(nx)==='tor'`); por
relés no (15 fps inundaría los relés y llegaría con segundos de retraso = inservible) ni por Bluetooth (no
cabe). El audio sigue por cualquier camino; `canVideo` queda permisivo (se PUEDE iniciar la videollamada
por internet; el audio va enseguida y el vídeo aparece al establecerse Tor). Prueba determinista
`tests/sim/netvideo.js` (en `ci.js`): OK por lan:/net:+tor; NO por net:+relés/Bluetooth/sin enlace.
**Nota — grupo fuera de P1:** la videollamada de GRUPO (`group_call.js _sendTo`) ya descarta `net:` por
completo (voz directa-solo, decisión del dueño 31-10), así que el gate de vídeo-por-Tor sería código muerto
allí. El grupo por internet (Tor directo) es un punto aparte, para otro bloque (no se tocó `group_call.js`).
Nota de la prueba real: la ruta era de 2 saltos (JUMP por nx09acdb61) y el intermediario se cayó a mitad
(ver P7); aun así el código NUNCA intentó enviar vídeo (bloqueado en la línea 273). La imagen real por
internet la confirma el dueño en los teléfonos (requiere Tor directo entre ambos, que NEXO monta con Wi-Fi).

## P2 — (GRAVE, dueño #4) No se despierta al contacto dormido ni se ve el tipo de conexión al abrir el chat — ✅ HECHO (build 2860, 01-11)
**Evidencia (log):** "No hay evidencia de toque/FCM/wake/doze"; `despertares por mensajes 0`; contactos
nx0ed4a8be y nx1793e595 "sin enlace ni ruta" toda la sesión con mensajes **pendientes** (3 y 1) que nunca
salen; solo se reintenta scan BLE + búsqueda de ruta JUMP.
**Evidencia (código):** `ble_interface.openChat` (línea 802) ponía el subtítulo a '' y, si no estaba listo,
forzaba `connectToDevice` (solo Bluetooth); NO disparaba el "toque" FCM. El toque existe (`net_link._wake`,
`calls._wakePush`) pero solo se disparaba AL ENVIAR un mensaje/llamada, no al abrir el chat.
**Causa:** al abrir el chat no se despertaba al contacto dormido; el primer mensaje esperaba (o se perdía) y
no se veía el camino de conexión.
**Solución aplicada (2860):** `net_link.js` → nuevo `wakeFor(nx)` público (toque FCM a petición, solo con
token del par + internet, reusa el throttle de `_wake`). `ble_links.js` → `_wakeSleepingPeer(nx)`: si NO hay
enlace vivo (`linkOf` ≠ wifi/bluetooth/internet) pide `net.wakeFor(nx)` y marca «despertando»; `isWaking(nx)`
caduca a los 30 s. `ble_interface.openChat` lo llama AL ABRIR (no solo al enviar). `main.js` → el subtítulo
muestra «Conectando…» (`st_connecting`, i18n es/it/en) mientras se despierta, y al formarse el enlace el tipo
real manda (Wi-Fi / Bluetooth / internet, vía `linkOf`). Así el 1er mensaje ya no espera/pierde, el enlace se
forma antes y se ve el camino. Prueba determinista `wakeopen.js` (en `ci.js`): dormido+token→toca y queda
«waking»; con enlace vivo no toca; sin token no marca «waking»; «waking» caduca; `wakeFor` solo con token e
internet. Reproduce el fallo con el código viejo (los métodos no existían).
**Nota (futuro, no bloquea):** el tipo de internet mostrado es «internet» a secas; distinguir Tor-directo vs
relés en el subtítulo (`net.via(nx)`) queda para un pulido posterior (no lo pidió explícito y el log solo
pedía «ver el tipo»). El reintento del 1er mensaje al despertar ya lo cubre la cola de pendientes existente
(`_resendPendingMessages` + reenvío al volver la presencia).

## P3 — (dueño #5) Archivo GRANDE (>~22 MB) por internet: no se manda ni se refleja
**Evidencia (log):** los archivos troceados NORMALES por internet SÍ llegan y confirman ✓✓ en ms (varios
`fxs_…`/`fx_…`). No se capturó un >22 MB, pero…
**Evidencia (código):** `big_file.js:148-152` → si no hay ruta local (`lan`/`wd`/`l2`), **rechaza** con
`code:'BIG_NO_NET'` y el texto "Archivo muy grande (N MB): por ahora solo se envía con el contacto cerca…;
por internet todavía no." (comentario línea 146: "Fase B: canal directo por Tor"). `route()` solo
devuelve lan/wd/l2, nunca net.
**Causa:** los archivos grandes (hasta 1 GB) solo tienen camino local; por internet no hay ruta → fallo.
**Solución robusta:** dar a `big_file` una ruta `net:` por **Tor directo** (streaming de slices por
`torSend`, con reanudación por trozos). Respaldo troceado por relés solo si no hay Tor (lento; avisar).

## P4 — (GRAVE, dueño #1+#2) «Escaneo lento»/mensajes lentos por BLE = congestión MTU-23 sin pacing (== #129)
**Confirmado con diagnóstico LADO A LADO** (`b792f6bd-diagnostico_scan.txt`, 1162 líneas, OPPO NX1B386248
Android 15 ↔ cercanos, el dueño: «aquí debería estar lo del scan lento»). **Ya NO hace falta más diagnóstico.**
**Evidencia (log) — el escaneo NO es lento; el enlace está congestionado:**
- El **radio de escaneo es rápido**: tras `startScan` los `Device found` llegan en **ms** (21:27:17.581
  startScan → 21:27:17.717 primer hallazgo, 136 ms; 12 hallazgos en ~4 s). No hay `133` en ráfaga (1 sola
  vez), ni `no_service`. El 2854 (pausa por Fénix) ya está aplicado.
- Lo lento es **volverse usable**: `Peer ready: nx1n36c283` a las **21:27:44**, pero la app reanudó a
  21:27:06 y encontró dispositivos a 21:27:17 → **~38 s desde reanudar y ~27 s desde el primer hallazgo**
  hasta que el contacto sirve. Eso es lo que el dueño siente como «escaneo lento».
- **La causa es la saturación de la cola de escritura BLE con MTU 23 y SIN pacing:** `141×`
  `[ChatStream] Envío nativo falló chunk N Cola de escritura llena` (12 chunks, cada uno reintentado
  **6–16×**) de **21:27:15 a 21:30:32 (3 min 17 s)**; además `[SEND] Cola llena … el mensaje espera`. Con
  **MTU 23** cada mensajito necesita ~26 escrituras BLE (`sendBinary bytes=505 writes=26` ≈ 20 B/escritura)
  → la app encola más rápido de lo que drena el enlace → desborde y reintentos.
- **Atasco en cadena:** muchas transferencias a la vez llegan a `Max window retries alcanzado` (fx_, fxs_,
  un texto `msg…kxbiz` 4×, hasta setup de llamada de grupo `gcs…`) mientras la cola está llena → el enlace
  BLE queda congestionado minutos y **retrasa** conectar/volver usable al contacto y la retroalimentación de
  estado de los mensajes (dueño GRAVE #1: «los mensajes tardan / no se retroalimenta bien»).
**Causa raíz:** es el **#129** (MTU 23, «Cola de escritura llena», falta de *pacing*). No es un problema de
escaneo ni de GATT: el escaneo es rápido y el GATT conecta (MTU 517 de entrada; la saturación es de SALIDA
por un enlace MTU-23). Los `Device no en cache → getRemoteDevice` (10×) son normales: son las direcciones
BLE **rotativas** de los anuncios recién vistos (no están en caché del stack) y sí acaban conectando.
**Solución aplicada (2864, 1ª parte — JS, testable):** el fallo concreto estaba en `ble_ack` ChatStream: una
rechazo `BLE_BUSY` («Cola de escritura llena») se trataba como FALLO del enlace → sumaba a `_nativeFails`, que a
los 3 intentaba CAMBIAR de camino (`_resolveDeviceIdForNexoId`) y a los 120 ABORTABA como PEER_ABSENT un enlace
SANO, solo congestionado (141× en el log). Ahora `BLE_BUSY` es CONTRAPRESIÓN: se espera escalonado (600→1200→2400
ms) y se reintenta el MISMO trozo SIN contar como fallo (no cambia de camino ni aborta); el contador se reinicia al
pasar un trozo; solo si NINGÚN trozo pasa ~5 min seguidos se deja pendiente. Nuevas funciones puras `_isBusyErr` /
`_busyBackoffMs` + `_giveUpPending`; prueba `busyback.js` (en `ci.js`; reproduce el fallo con el código viejo). La
cola nativa ya pacea por `onCharacteristicWrite` y el ChatStream ya ajusta ventana/trozo al MTU (no era «falta de
pacing» sino la mala clasificación de la contrapresión).
**Pendiente (2ª parte, medir en teléfonos):** con el diagnóstico del dueño antes/después (nº de «Cola de escritura
llena» y tiempo hasta «Peer ready») decidir si hace falta además limitar transferencias concurrentes por enlace o
negociar MTU mayor. La vía robusta para archivos grandes por un enlace lento es moverlos a Wi-Fi Direct (P8) en vez
de pelear con MTU 23.
**Solución robusta (= #129), nota original:** *pacing* de escritura guiado por el drenaje real del enlace (esperar al
callback `onCharacteristicWrite`/crédito antes del siguiente write, en vez de reintentar «cola llena»);
limitar transferencias BLE concurrentes por enlace (una activa + cola, no todas peleando); priorizar el
tráfico de control/presencia (que el contacto se vuelva «ready» y los ✓✓) sobre las transferencias de fondo;
negociar MTU mayor cuando el par lo permita y, con MTU 23, trocear al tamaño real para no desbordar. Medir
en `tests/sim` el tiempo hasta «Peer ready» y el nº de «cola llena» antes/después.
**Impacto/orden:** esto cubre a la vez el GRAVE #1 (mensajes lentos/feedback) y el #2 (cercano tardado), así
que es de **alto impacto**; ver la nota en el orden de abajo (candidato a adelantarlo).

## P5 — Relé público damus.io inestable (afecta la robustez de internet) — ✅ HECHO (build 2863, 01-11)
**Evidencia (log):** `wss://relay.damus.io: cerrada` **37×**, a veces 3× en <1 min, también en sesión
activa. De los 4 relés que escucha, damus.io flapea constantemente.
**Causa:** `net_link._connect` reseteaba `r.backoff = 2000` en cada `onopen`, así que un relé que abría y se
caía enseguida reconectaba a los 2 s una y otra vez (el backoff exponencial nunca llegaba a crecer).
**Solución aplicada (2863):** detección de flapeo. En `onclose` se mide cuánto estuvo abierto (`openedAt`);
una conexión de vida < `RELAY_STABLE_MS` (20 s) cuenta como flap. Con `RELAY_FLAP_MAX` (3) flaps en la ventana
de 5 min Y ≥`RELAY_MIN_OTHERS` (2) relés abiertos, el relé se aparta `RELAY_FLAP_PENALTY_MS` (5 min) en vez de
reconectar enseguida; una conexión estable olvida los flaps. **Nunca** se aparta si quedarían <2 relés abiertos
(mejor un relé que flapea que ninguno). El registro dice «Relé inestable <host>: lo aparto ~5 min». Nuevo
`_noteRelayClose` + `_openRelaysExcept` + `_relayHost`. Prueba `relayflap.js` (en `ci.js`): 3 flaps con ≥2
relés→apartado; con 1 relé→no; estable resetea; backoff normal se dobla. Reproduce el fallo con el código viejo.
Tor directo ya se prefiere aparte (net.send) cuando está arriba.

## P6 — Reensamblado BLE huérfano cuando el mismo archivo ya llegó por internet (doble ruta) — ✅ HECHO (build 2861, 01-11)
**Evidencia (log):** `[BleAckSystem] Assembly timeout` ×3 msgId; **2 de ellos ya habían sido ✓✓ por
internet** minutos antes → buffers de reensamblado BLE que nunca completan y caducan.
**Causa:** el mismo msgId llega por dos rutas (BLE troceado + net). El dedup de recepción estaba PARTIDO: los
mensajes completos por net/Jump/BLE-corto van por `ble_messages.onPayloadReceived` (dedup `_receivedMessageIds`),
pero el troceado BLE va por `ble_ack` (dedup propio `completedMessages`/`incomingBuffers`) y los dos no se
hablaban → el buffer BLE a medias quedaba colgado hasta el timeout de 120 s (con un falso «fallo» de progreso).
**Solución aplicada (2861):** dedup ENTRE transportes. (1) `ble_ack.dropAssembly(msgId)`: cierra el reensamblado
BLE a medias (cancela su temporizador) y lo llama `onPayloadReceived` al recibir/deduplicar un mensaje completo
→ no más «Assembly timeout» de algo que ya llegó. (2) En `_handleIncomingChunk`, un trozo BLE tardío de un msgId
que ya está en el dedup central (`self.ble._receivedMessageIds`) NO reabre buffer: se acusa recibo (que el emisor
pare) y se descarta. Cubre los dos órdenes (net-antes-trozos y trozos-antes-net). Sin tocar la lógica de entrega
(aditivo), así que no puede duplicar ni perder mensajes (el doble por E2E ya lo corta la protección anti-repetición).
Prueba determinista `dedupe.js` (en `ci.js`): dropAssembly cierra y cancela el timer; trozo tardío de un recibido
no reabre buffer y acusa; un msgId nuevo SÍ abre buffer (no se rompe lo normal). Reproduce el fallo con el código
viejo (`dropAssembly` no existía).

## P7 — JUMP deja de hacer de puente a 82 % de batería (texto engañoso) — rompió la ruta a mitad — ✅ HECHO (build 2862, 01-11)
**Evidencia (log):** `[JUMP] Batería baja (82 %, ahorro): dejo de hacer de puente` (y otra al 65 %); el
intermediario nx09acdb61 se cayó a mitad de la videollamada (`22:10:00 … ya no está en línea por internet`).
**Causa:** `ble_relay.canRelay()` tenía `if (p.powerSave) return false;` → el **modo-ahorro del sistema**
paraba el puente a CUALQUIER nivel de batería (82 % incluido); además el texto decía "batería baja" al 82 %.
**Solución aplicada (2862):** el modo-ahorro YA NO para el puente por sí solo; solo manda la batería —
`canRelay()`: cargando siempre; sin dato, no bloquear; si no, `level >= (powerSave ? 30 : 15)`. Así al 82 %
con ahorro SÍ se hace de puente (antes se cortaba), pero con ahorro se pide algo más de holgura (30 %) que sin
ahorro (15 %), respetando que el usuario quiere conservar. Nuevo `_relayStopReason()` y el registro dice el
motivo real («Ahorro de energía (N %)» vs «Batería baja (N %)»), en `_refreshPower` y en el descarte de paquetes.
Prueba `jumpbat.js` (en `ci.js`): 82 %+ahorro→puente; 25 %+ahorro→no (conservador); 25 % sin ahorro→sí;
10 %→no; cargando→sí; sin dato→sí; motivos correctos. Reproduce el fallo con el código viejo.

## P8 — (menor) Wi-Fi Direct disponible pero sin permiso — ⚠️ REVISADO: ya está cableado (01-11)
**Evidencia (log):** `[WIFI-DIRECT] Disponible (falta permiso)`.
**Revisión (código):** la infraestructura del permiso YA existe de punta a punta: el manifest declara
`NEARBY_WIFI_DEVICES` (android/app/src/main/AndroidManifest.xml); el nativo tiene `requestWifiDirectPermission`
y el alias `nearbyWifi` (NexoBlePlugin.kt); y el JS `wifi_direct._ensurePermission()` lo pide **cuando una
transferencia lo necesita** (lazy). `supported()` NO exige `granted`, así que Wi-Fi Direct se sigue anunciando
(kx `wd:1`) e intentando, y al intentar una transferencia grande cercana se pide el permiso. El log
«(falta permiso)» es el ESTADO al arrancar (aún no concedido/aceptado), no un request que falte.
**Conclusión:** no es un bug claro de código; es que el permiso aún no se ha concedido en ese teléfono. Mejora
posible (menor, UX): pedirlo proactivamente con una explicación la 1ª vez que haya un contacto cerca con Wi-Fi
Direct (en vez de esperar a la 1ª transferencia grande), para que esté listo. Pendiente de decidir con el dueño si
vale la pena; se confirma en los teléfonos (el simulador no tiene Wi-Fi Direct).

## P9 — (verificar) Mensaje entrante de exactamente 65536 car. (64 KB) — ✅ VERIFICADO: NO hay truncado (01-11)
**Evidencia (log):** `msg…ej5er7pj5 … (65536 car.)` — exacto 64×1024.
**Verificación (código):** NO existe un tope que trunque el CONTENIDO de un mensaje a 64 KB. Los 65536 que
aparecen en el código son otra cosa: `e2e_ratchet.RECENT_MAX_CHARS=65536` es el tope de la CACHÉ anti-repetición
(no se guarda en esa caché un mensaje mayor, pero se entrega entero); `ble_ack.LAN_PSEUDO_MTU=65535` es el tamaño
de troceo por Wi-Fi; en Kotlin `BinFrame.MAX_DATA=65536` es el máximo por trama binaria (troceo), y el resto son
búferes de E/S de 64 KB o el tamaño de trama WebSocket. El campo de escribir no tiene `maxlength`. El mensaje de
65536 del log se registró como RECIBIDO (no fallido) → llegó entero. **Conclusión:** no es un fallo; nada que
arreglar. (El único límite cercano es `net_link.MAX_CONTENT=60000` por EVENTO de relé; un texto mayor por internet
se trocea/gestiona, no se trunca en silencio — el mensaje del log llegó bien.)

---

## Orden de arreglo propuesto (uno a uno, con prueba + batería)
1. ✅ **P1 — vídeo por internet** — HECHO (build 2859). Solo `calls.js` (grupo fuera, ver P1).
2. ✅ **P2 — toque de despertar + tipo de conexión al abrir chat** — HECHO (build 2860). `net_link.wakeFor` + `ble_links._wakeSleepingPeer/isWaking` + `openChat` + subtítulo «Conectando…». Prueba `wakeopen.js`.
3. ✅ **P6 — dedupe de reensamblado entre BLE y net** — HECHO (build 2861). `ble_ack.dropAssembly` + guard con `_receivedMessageIds`. Prueba `dedupe.js`.
4. ✅ **P7 — no cortar el puente JUMP con batería alta** — HECHO (build 2862). `ble_relay.canRelay()` ya no para por modo-ahorro solo; umbral por batería (ahorro 30 %, normal 15 %) + motivo real en el registro. Prueba `jumpbat.js`.
5. ✅ **P5 — relés que flapean: prioridad/robustez** — HECHO (build 2863). `net_link` detecta flapeo y aparta el relé 5 min (si quedan ≥2 abiertos). Prueba `relayflap.js`.
6. **P3 — archivo grande por internet (canal Tor directo)** — el más grande; build propia.
7. ✅ **P9 — verificar tope 64 KB** — VERIFICADO: no hay truncado, nada que arreglar. ⚠️ **P8 — permiso Wi-Fi Direct** — REVISADO: ya está cableado (manifest + nativo + JS lazy); el «falta permiso» es estado, no un request que falte. Mejora UX menor opcional (pedirlo proactivamente); a confirmar en teléfonos.
8. ✅ **P4 — pacing de escritura BLE con MTU 23 (= #129)** — 1ª parte HECHA (build 2864): `BLE_BUSY` tratado
   como contrapresión (no como fallo del enlace) → ya no cambia de camino ni aborta un enlace sano por
   congestión. Prueba `busyback.js`. 2ª parte (medir en teléfonos si hace falta limitar concurrencia o subir
   MTU; o mover archivos grandes a Wi-Fi Direct P8) queda para con el próximo diagnóstico del dueño.

(Se irá marcando aquí el estado de cada punto conforme se arregle. **P1 ✅ 2859 · P2 ✅ 2860 · P6 ✅ 2861 · P7 ✅ 2862 · P5 ✅ 2863 · P9 ✅ verificado · P4/#129 ✅ 2864 (1ª parte) · P8 ⚠️ revisado (ya cableado).** Queda SOLO **P3** como arreglo de código nuevo: archivo grande por internet = **streaming nativo por Tor** (Kotlin), que el simulador NO puede probar — build propia + confirmación del dueño en los teléfonos. Y la 2ª parte de P4/#129 + la posible mejora UX de P8, ambas a decidir con medición en teléfonos. El dueño pidió seguir sin parar; P3 es el único que queda y es nativo-puro.)
