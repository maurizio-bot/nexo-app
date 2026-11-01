# Análisis de conexiones — diagnóstico real 2026-11-01

Fuente: diagnóstico del dueño `50bb76f1-diagnostico1.txt` (2889 líneas), **prueba real con los dos
teléfonos SEPARADOS** (dos Wi-Fi distintas, no lado a lado). Teléfono: Samsung S23 (NX1E50C95D,
Android 16), app v9.1.0-b1273. Contacto principal: nx1n36c283 (alcanzable por internet). En todo el
log **no hay ni un ERROR ni crash**; lo grave son patrones de comportamiento y WARN.

Lista rastreable **problema → evidencia (log + código) → causa → solución robusta**. Orden de arreglo
propuesto al final. Cada arreglo se hará **uno a uno**, reproducido en `tests/sim` y con batería verde
antes de subir.

---

## P1 — (GRAVE, dueño #3+#6) La videollamada por INTERNET no transmite vídeo
**Evidencia (log):** 2 llamadas por internet con nx1n36c283. La de vídeo duró 536 s con audio perfecto
(voz enviada 4172 / recibida 4166) pero **`vídeo enviado 0 / recibido 0`** todo el rato (576 líneas).
El lado local SÍ captura y codifica (`imágenes 4774, completas 64, 360x480`) pero **no transmite**; el
decodificador del vídeo remoto **nunca se inicializa** (`del otro: decodificadas 0, decodificador no`
574×) aunque el otro reporta `su cámara on` 372×. **No hay ningún mensaje de rechazo** ("solo voz" /
"sin Wi-Fi"): la llamada se estableció y negoció VP8; falló el TRANSPORTE del vídeo.
**Evidencia (código):** `calls.js:273` → `if (kind === 'v' && link.indexOf('lan:') !== 0) return;` — los
fotogramas de vídeo solo se mandan por `lan:` (Wi-Fi misma red); por `net:` (internet) se descartan TODOS.
Incoherente con `calls.js:83 canVideo()`, que SÍ permite `net:`. `group_call.js _sendTo` tiene el mismo
bloqueo para el vídeo de grupo.
**Causa:** el vídeo está limitado a Wi-Fi misma red; por internet nunca se envía, aunque se codifique.
**Solución robusta:** permitir vídeo por `net:` **solo cuando la ruta es Tor DIRECTO** (`net.via(nx)==='tor'`);
por relés no (15 fps inundaría los relés y sería inservible) — el audio sigue por relés. Igual en
`calls.js` y `group_call.js`. Si hace falta, bajar bitrate/resolución del vídeo cuando va por internet.
Nota: en esta prueba la ruta era de 2 saltos (JUMP por nx09acdb61) y el intermediario se cayó a mitad
(ver P7); aun así el código NUNCA intentó enviar vídeo (bloqueado en la línea 273).

## P2 — (GRAVE, dueño #4) No se despierta al contacto dormido ni se ve el tipo de conexión al abrir el chat
**Evidencia (log):** "No hay evidencia de toque/FCM/wake/doze"; `despertares por mensajes 0`; contactos
nx0ed4a8be y nx1793e595 "sin enlace ni ruta" toda la sesión con mensajes **pendientes** (3 y 1) que nunca
salen; solo se reintenta scan BLE + búsqueda de ruta JUMP.
**Evidencia (código):** `ble_interface.openChat` (línea 802) pone el subtítulo a '' y, si no está listo,
fuerza `connectToDevice` (solo Bluetooth); NO dispara el "toque" FCM. El toque existe (`net_link._wake`,
`calls._wakePush`) pero solo se dispara AL ENVIAR un mensaje/llamada, no al abrir el chat.
**Causa:** al abrir el chat no se despierta al contacto dormido; el primer mensaje espera (o se pierde) y
no se ve el camino de conexión.
**Solución robusta:** al abrir el chat, si no hay enlace conocido (`!canReach` y sin BLE listo), disparar
el toque FCM + saludo/presencia; al confirmarse, mostrar el tipo de enlace real en el subtítulo
(Wi-Fi / Bluetooth / internet-Tor / internet-relés, usando `net.via(nx)`), y reintentar el envío del 1er
mensaje en cuanto despierte.

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

## P4 — (dueño #1+#2) Mensajes por BLE lentos / GATT nunca conecta — CON MATIZ
**Evidencia (log):** un mensaje saliente por BLE (ChatStream) tardó ~8,1 s con retransmisión de ventana
(`_onWindowTimeout … reenviando ventana … handleNack:10 … handleFinalAck`), frente a <100 ms por internet.
30 `connectToDevice` → **todos** `[WARN][GATT_CLIENT] Device no en cache, intentando getRemoteDevice`;
**0 conexiones GATT** (ningún READY_TO_CHAT/MTU/descubrimiento); 139 `startScan`.
**MATIZ:** esta prueba fue con los teléfonos **separados** (dos Wi-Fi), así que el BLE NO debía conectar
(no estaban cerca) y el contacto real se alcanzó por internet. Por eso este log **no evidencia bien** el
"escaneo lento con los dos cerca". El `Device no en cache` son reintentos a contactos ausentes (es
correcto que fallen). El build 2854 ya arregló una causa del escaneo lento (pausa por respaldo Fénix).
**Causa (BLE cercano):** por confirmar con un diagnóstico LADO A LADO.
**Solución:** pedir al dueño un diagnóstico con los dos teléfonos **cerca** (y uno enviando mientras el
otro busca) para diagnosticar el escaneo/GATT real. El "mensaje lento por BLE" es la ventana/reintento
normal de un enlace flojo; se revisa con ese diagnóstico.

## P5 — Relé público damus.io inestable (afecta la robustez de internet)
**Evidencia (log):** `wss://relay.damus.io: cerrada` **37×**, a veces 3× en <1 min, también en sesión
activa. De los 4 relés que escucha, damus.io flapea constantemente.
**Causa:** un relé público inestable que se cae y reconecta sin parar.
**Solución robusta:** detectar relés que flapean (N caídas en M min) y bajarles prioridad / sacarlos un
rato; mantener ≥N relés estables; apoyarse en Tor directo cuando esté. (Robustez de la capa internet.)

## P6 — Reensamblado BLE huérfano cuando el mismo archivo ya llegó por internet (doble ruta)
**Evidencia (log):** `[BleAckSystem] Assembly timeout` ×3 msgId; **2 de ellos ya habían sido ✓✓ por
internet** minutos antes → buffers de reensamblado BLE que nunca completan y caducan.
**Causa:** el mismo msgId llega por dos rutas (BLE + net); el buffer BLE queda colgado hasta el timeout.
**Solución robusta:** al completar/confirmar un msgId por CUALQUIER ruta, cerrar/descartar los buffers de
reensamblado de ese msgId en las otras rutas (dedupe por msgId entre transportes).

## P7 — JUMP deja de hacer de puente a 82 % de batería (texto engañoso) — rompió la ruta a mitad
**Evidencia (log):** `[JUMP] Batería baja (82 %, ahorro): dejo de hacer de puente` (y otra al 65 %); el
intermediario nx09acdb61 se cayó a mitad de la videollamada (`22:10:00 … ya no está en línea por internet`).
**Causa:** el corte del puente mesh se dispara por el **modo-ahorro del sistema** aunque la batería esté
alta; además el texto dice "batería baja" al 82 %.
**Solución robusta:** no dejar de hacer de puente solo por modo-ahorro si la batería está alta; usar un
umbral real (p. ej. <20 %). Corregir el texto del aviso.

## P8 — (menor) Wi-Fi Direct disponible pero sin permiso
**Evidencia (log):** `[WIFI-DIRECT] Disponible (falta permiso)`.
**Solución:** pedir el permiso (NEARBY_WIFI_DEVICES, Android 13+) para poder usar Wi-Fi Direct.

## P9 — (verificar) Mensaje entrante de exactamente 65536 car. (64 KB)
**Evidencia (log):** `msg…ej5er7pj5 … (65536 car.)` — exacto 64×1024.
**Solución:** verificar si hay un tope de 64 KB que trunca textos/mensajes grandes; si lo hay, trocear
bien o subir el tope con cuidado.

---

## Orden de arreglo propuesto (uno a uno, con prueba + batería)
1. **P1 — vídeo por internet** (bloqueo claro, alto impacto, pedido directo). calls.js + group_call.js.
2. **P2 — toque de despertar + tipo de conexión al abrir chat** (robustez + no perder 1er mensaje).
3. **P6 — dedupe de reensamblado entre BLE y net** (arreglo contenido, quita buffers colgados).
4. **P7 — no cortar el puente JUMP con batería alta** (afecta rutas mesh/internet).
5. **P5 — relés que flapean: prioridad/robustez.**
6. **P3 — archivo grande por internet (canal Tor directo)** — el más grande; build propia.
7. **P9 — verificar tope 64 KB.** **P8 — permiso Wi-Fi Direct.**
8. **P4 — escaneo/GATT con los dos cerca:** pedir diagnóstico lado a lado.

(Se irá marcando aquí el estado de cada punto conforme se arregle.)
