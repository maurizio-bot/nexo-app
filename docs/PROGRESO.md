# NEXO — Estado del proyecto

Última actualización: 2026-10-30 (builds **2804–2836** + **iOS Fase 0** + **limpieza del repo**): **2836 — red de seguridad de entrega: mensaje con ahorro de batería, como WhatsApp (pedido del dueño):** revisión a fondo del envío con el otro en ahorro de batería. NEXO ya usa el modelo correcto **cuando hay internet**: publica en el buzón de relés y dispara un «toque» FCM **solo-datos de ALTA prioridad** (`push-sender/index.js`) que atraviesa Doze/ahorro; el receptor arranca el foreground service al despertar (`NexoFcmService`). Confirmado en el simulador (`wakebt.js`): un contacto **dormido/congelado** igual recibe el toque (solo el token, nunca el contenido) y el mensaje queda recuperable → **entregado al despertar**. **Hueco cerrado:** cuando el Bluetooth estaba LISTO, `sendChatMessage` enviaba **solo por Bluetooth** y confiaba en el ack; si el otro dormía en ahorro (app/servicio parados por el fabricante), quedaba en «enviado» sin despertar a nadie. Nuevo `_armDeliverySafetyNet` (`ble_messages.js`, `DELIVERY_SAFETY_MS` 10 s): si no se confirma «entregado», el mensaje cae **ADEMÁS** al buzón de relés → FCM de alta prioridad. Mismo `msgId` → el receptor deduplica (nunca doble); defensivo (solo con internet + token; nada para acciones ocultas; fire-and-forget, no toca el estado del envío Bluetooth). Batería **83/83**. **Honesto:** el simulador prefiere el enlace de internet y no aísla la rama «Bluetooth con internet disponible», así que esa parte de la red de seguridad es defensiva y se confirma en los teléfonos; la garantía integrada (dormido → despertado + mensaje recuperable) sí quedó probada. APK **nightly-2836** (24,3 MB, sha256 `520087bc…`). ⚠️ A probar en los teléfonos. **2835 — Ajustes → «Confirmaciones de lectura» + A1 verificado (pedido del dueño):** nuevo ajuste en Perfil → Ajustes → «🔏 Privacidad» para encender/apagar las confirmaciones de lectura, como WhatsApp (por defecto ENCENDIDAS). Apagadas, este teléfono **no manda** el acuse de lectura → a tus contactos nunca les llega el **✓✓ AZUL** de tus mensajes; el «entregado» (dos palomitas grises) no se toca. `chat_state.js` (pref `nexo_read_receipts` en localStorage, no viaja), `main.js` (el callback `sendRead` del notificador corta temprano si está apagado), `profile.js` (tarjeta «Privacidad» con el toggle). Prueba `tests/sim/readtoggle.js` (apagado → A se queda en «entregado» tras leer B; encendido → A ve «leído»). **A1** (notificación con heads-up/contenido): verificado que **ya está en código** — el aviso de mensaje usa canal de importancia ALTA + prioridad alta + título = **nombre del remitente** + heads-up; el contenido se oculta a propósito (E2E/privacidad, no se puede descifrar con la app cerrada). Sin cambio necesario; si se ve «solo el iconito» es por el canal viejo (se corrige reinstalando) o ajustes del fabricante. Batería **82/82**. APK **nightly-2835** (24,3 MB, sha256 `9f19aebf…`). ⚠️ A probar en los teléfonos. **2834 — icono de aviso nuevo + logo provisional (elección del dueño):** el aviso de mensaje en la barra de estado dejó el icono genérico de Android por uno propio: **burbuja + «N»**, vector blanco monocromo `ic_stat_message` (el dueño eligió la opción 1 de la página de opciones). Y el **logo PROVISIONAL de la app**: icono adaptativo con **fondo negro** (#000, `ic_launcher_background`) y en primer plano una **burbuja cian (#19E0FF) con la «N» blanca** (`ic_nexo_foreground`) — dos colores sobre negro. Cambio **solo nativo**: recursos Android (2 vectores nuevos + fondo a negro + los dos `mipmap-anydpi-v26/ic_launcher*` apuntan al nuevo foreground) y 2 líneas Kotlin (`MsgNotifier.msgIcon()` resuelve el vector por nombre con `getIdentifier`, con fallback al genérico si faltara; lo usan los avisos de mensaje de `MsgNotifier` y el de FCM `NexoFcmService`). No toca `src/` ni el simulador → **batería igual que 2833 (81/81)**; lo valida que el **CI compile** los vectores + Kotlin. **APK nightly-2834** (24,3 MB, sha256 `12f55626…`; vectores adaptativos + Kotlin compilaron ✓). Los PNG legacy del launcher quedan sin tocar (minSdk 26 usa el adaptativo; es provisional). ⚠️ A ver en los teléfonos. **2833 — ✓✓ (entregado) también con la app CONGELADA en segundo plano (propuesta del dueño 29-10, #87):** algunos teléfonos (el Vivo del dueño) congelan la app en segundo plano y el JS no corre, así que no confirmaba la entrega: el emisor veía el mensaje quedarse en «enviado» (o hasta en rojo tras agotar reintentos) aunque SÍ había llegado y el nativo ya mostraba el aviso. El camino de app CERRADA (`closedReceive`) ya mandaba el ✓✓ firmado; faltaba el de segundo plano CONGELADO (`backgroundNotify`, el aviso de respaldo a los 4 s). Ahora, al avisar un mensaje por ese camino, el nativo manda también la confirmación de ENTREGA FIRMADA por Bluetooth (misma máquina C1 que el modo cerrado: firmada con la clave de la pareja, el emisor proto-2 la exige; se deduplica por tipo+id, así que si el JS luego descongela y también la manda, no molesta — dos vías, como pidió el dueño). Helper `sendDeliveredAck()` compartido por los dos caminos; el aviso por Wi-Fi/LAN va sin ack por esta vía (esa confirma la entrega por su cuenta). Reproducido antes de arreglar (escenario `frozen` del simulador, modelando el Vivo: A veía «m1: failed, m2: sending»); con el arreglo «m1/m2: delivered», sin pérdida ni duplicado al volver. Prueba nueva `background.js --scenario=frozen` en la batería. APK **nightly-2833** (24,3 MB, sha256 `d41b4c11…`; el cambio Kotlin compiló en el CI ✓). ⚠️ A confirmar en los teléfonos del dueño. **Limpieza del repo (revisión del dueño 29-10, punto 1)** — `node_modules` estaba **versionado** (4069 archivos, ≈91 % del repo) aunque ya estaba en `.gitignore` (se commiteó antes de ignorarlo); también `local.properties`. Se **dejan de rastrear** en NEXOCHAT (61588a20) y en la rama de trabajo (siguen en disco, no se borran); `.gitignore` ampliado (local.properties, artefactos de build de Android, *.backup/*.bak). Verificado seguro: el CI usa `npm ci` (`build-apk.yml`) y el simulador instala sus propias deps (`tests/sim/.deps`), así que **nada dependía del node_modules versionado**; el build de la 2832 lo confirma (`npm ci` sin node_modules versionado). **NO se reescribió la historia** (purgarlo del pasado exige force-push destructivo que afecta a las ramas base-estable y a los clones → decisión del dueño). **2832** = **el mini-juego: la «N» se reconoce como se dibuja de verdad (ARRIBA-ABAJO-ARRIBA) + velocidad gradual + estilo arcade B/N (aclaración del dueño 29-10)** — el dueño aclaró que la «N» se dibuja desde ABAJO: sube, baja en diagonal y vuelve a subir (las dos barras + la diagonal real de la N). El reconocedor anterior exigía el sentido CONTRARIO (empezar arriba), por eso una «N» bien hecha se rechazaba — **esa era la causa de fondo** del «no arranca» (la 2831 arregló además el bug del candado de eventos; las dos cosas suman). Ahora `__recognizeN` es **agnóstico al sentido**: cuenta los tramos verticales de la letra (2 vueltas = 3 tramos, 4 extremos que alternan arriba/abajo) y normaliza izq↔der, así que acepta la «N» se empiece por arriba o por abajo, y sigue rechazando rayas, diagonales, «V» (1 vuelta) y «M/W» (3+). Además: **velocidad gradual** (la dificultad sube con el TIEMPO, no solo con el puntaje: meteoros más seguidos y más rápidos) y **estilo arcade en BLANCO Y NEGRO** (todo monocromo sobre negro, tipografía monoespaciada; contactos = disco blanco, meteoros = aro blanco, nave/balas/chispas blancas, HUD y pantallas en blanco). `src/ui/nexo_game.js`; `tests/sim/juego.js` reescrita a la «N» real + variantes (estrecha/ancha/rápida/inclinada + la MISMA al revés, todas ACEPTADAS; «V» RECHAZADA). **Batería 80/80**, índice **43,4** (interfaz). Kotlin sin cambios. HONESTO: el simulador no pinta el Canvas (el look B/N lo confirma el dueño en el teléfono); la lógica (reconocer la «N», velocidad, abrir/cerrar) sí está probada. **APK nightly-2832** (24,3 MB, sha256 `209de0fa…`; publicada 13:06 UTC; confirma que `npm ci` funciona SIN node_modules versionado → la limpieza del repo NO rompió el CI); mirror hecho. ⚠️ A confirmar en los teléfonos del dueño. **2831** = **el mini-juego secreto ahora SÍ arranca dibujando la «N» (informe del dueño 29-10; el arreglo de la 2824 fue insuficiente)** — dos causas reales, las dos reproducidas en el simulador y arregladas: (1) **bug de eventos (causa principal)**: había un «candado» por tipo de entrada — el primer `pointerdown` fijaba el candado en *pointer*, y si el WebView del teléfono luego NO emitía `pointermove` de forma fiable (pasa en varios Android), los `touchmove` de respaldo quedaban **bloqueados** → el trazo se quedaba en 1 punto y la «N» nunca se reconocía; ahora *pointer* y *touch* alimentan el MISMO trazo (se mantiene `setPointerCapture` + la zona con `touch-action:none`). (2) **reconocedor frágil**: antes asumía las esquinas en los TERCIOS EXACTOS de la longitud del trazo; ahora **busca las esquinas reales** (inferior-izq = máximo y temprano, superior-der = mínimo y después) → tolera una «N» estrecha, ancha, inclinada, temblorosa o rápida, y sigue rechazando rayas/diagonales/«V»; umbral de tiempo del trazo 4 s → 6 s. `src/ui/nexo_game.js`; pruebas `tests/sim/juego.js` ampliadas (N estrecha/ancha/rápida/inclinada ACEPTADAS, «V» RECHAZADA, y un **caso mixto** pointerdown+touchmove que con el código viejo daba `gesto_mixto_abre:false` —fallo reproducido— y ahora `true`). **Batería 80/80**, índice **43,4** (arreglo de interfaz, no un modo de fallo nuevo del catálogo). Kotlin sin cambios (nada nativo). **HONESTO:** en el simulador la «N» limpia YA se reconocía, así que el síntoma exacto del dueño no se reproducía al 100 %, pero el bug del candado SÍ (prueba mixta) y es la causa más probable del «no arranca»; si tras la 2831 sigue sin abrir, hace falta el diagnóstico de los dos teléfonos. **APK publicada** (nightly-2831, 24,26 MB, sha256 `909297c7…`; firma verificada en CI); mirror a la rama de trabajo hecho. ⚠️ A confirmar en los teléfonos del dueño. **2830** = **Tres en raya — juego de 2 jugadores dentro del chat (entretenimiento #3, pedido del dueño «un entretenimiento para pegar un user a la pantalla»)** — primera entrega de los juegos de 2 jugadores (lo que mejor encaja con lo P2P/sin-servidor de NEXO y da un motivo social para volver). Una partida se juega entre dos contactos sobre el canal que YA existe (Bluetooth/Wi-Fi/Jump/internet) y cifrado; una jugada es una acción OCULTA del chat (`{type:'nexo_act', act:'game', g:'ttt', gid, b:[tablero]}`) que se entrega como un mensaje normal → ASÍNCRONO (si el otro está desconectado, llega cuando vuelve, encaja con lo offline-first). **Robustez (clave):** cada jugada lleva el TABLERO COMPLETO (idempotente: un duplicado por relé no cambia nada) y al recibir se VALIDA SIEMPRE (nunca se confía en el otro: debe ser el tablero mío con EXACTAMENTE una marca nueva del rival, en casilla vacía, y tocándole a él; si no, se ignora) → nadie puede hacer trampa ni desincronizar; el que invita es X y empieza; ganador/empate local; solo se pinta X/O y el nombre por `textContent` (nunca HTML del otro). `src/ui/ttt.js` (nuevo, overlay 3×3 con tu turno / turno del otro / resultado + «Nueva partida»/«Cerrar»), `chat_actions.js` (`_applyChatAction` enruta act 'game' a `tttOnAction`), `app_setup.js`+`index.html` (8º ítem del menú de adjuntar 🎮 abre/retoma la partida con el contacto del chat), `chat_nav.js` (el botón ATRÁS de Android cierra el overlay del juego y la hoja de stickers, no sale de la app), CSS en `nexo_theme.css`. Prueba nueva `tests/sim/ttt.js` (tag TTT): A invita a B, las jugadas se propagan en los dos sentidos, una jugada fuera de turno se ignora, A gana la fila de arriba y los dos lo ven → batería 79→**80**. Índice **43,4** (funcionalidad nueva de interfaz, no un modo de fallo del catálogo). Kotlin sin cambios (nada nativo). **APK publicada** (nightly-2830, 24,26 MB, sha256 `e56ebe4a…`; firma verificada en CI); mirror a la rama de trabajo hecho. Siguiente posible con el mismo motor: conecta-4. ⚠️ A confirmar en los teléfonos del dueño. **2829** = **stickers — pack incorporado, por el cable va solo el ID (pedido del dueño 29-10: «los stickers se deben de implementar»)** — los stickers son un PACK INCORPORADO en la app; por el cable viaja SOLO el ID (`{type:'nexo_sticker', s:'<id>'}` por el camino normal de texto, cifrado como cualquier mensaje) y el dibujo es un SVG ESTÁTICO del repo (mapa congelado en `stickers.js`, como `_VIA_ICON`). NUNCA viajan bytes de imagen del emisor → **sin superficie XSS**, sin base64, sin archivos de vault; unos pocos bytes. Un ID desconocido cae a 🎟️, jamás a bytes crudos del emisor. 10 stickers dibujados (feliz, risa, guiño, triste, sorpresa, corazón, estrella, fuego, ok, logo NEXO), se ven **grandes y SIN burbuja** (como foto/emoji, `:has(.msg-sticker)`), y entran por un 7.º ítem del menú de adjuntar (🙂) que abre una hoja de rejilla. `src/ui/stickers.js` (nuevo), `app_setup.js` (`_sendStickerTo` + ítem del menú), `chat_format.js`/`ble_helpers.js` (`_chatKind` reconoce `nexo_sticker`; vista previa «🎟️ Sticker»), `chat_actions.js` (`_fillTextBubble` dibuja el SVG por su ID; desconocido → 🎟️); render.js NO cambia (un sticker no es adjunto ni `nexo_act` → fluye al bubble de texto). Prueba nueva `tests/sim/stickers.js` (tag STICKER): B recibe el envoltorio, los dos pintan el SVG incorporado, un id desconocido cae a 🎟️ (sin svg) y NUNCA se ve el JSON crudo. **Batería 79/79**, índice **43,4** (funcionalidad nueva de interfaz, no un modo de fallo del catálogo); Kotlin sin cambios (nada nativo). **APK publicada** (nightly-2829, 24,26 MB, sha256 `63715560…`; firma verificada en CI); mirror a la rama de trabajo hecho. Nota: un contacto en una build ANTERIOR a la 2829 vería el envoltorio como texto; los dos teléfonos del dueño se actualizan juntos (como al añadir estados/reacciones). ⚠️ A confirmar en el teléfono del dueño (es visual). **2828** = **emoji solo (1–3) GRANDE y SIN burbuja, como WhatsApp** (pedido del dueño 29-10: «quita la burbuja cuando se manda emoji y aumenta el tamaño») — un mensaje que es SOLO emoji (de 1 a 3, sin texto) se pinta grande (1 = 54 px, 2 = 44 px, 3 = 34 px) y sin fondo/borde de burbuja, igual que ya se hace con fotos/vídeos (`:has()`), propios y recibidos; un 4.º emoji o cualquier letra/número vuelve a la burbuja normal; no aplica a reenviados ni a respuestas citadas (ahí manda el texto). Detección PURA y robusta (`_emojiOnly` en `chat_actions.js`): cuenta grafemas con `Intl.Segmenter` tratando bien los compuestos (familia 👨‍👩‍👧 con ZWJ, tonos de piel 👍🏽, banderas 🇦🇷 = 2 indicadores regionales); si al quitar pictográficos + combinadores queda algo, hay texto → burbuja normal; defensiva (si el navegador no soporta `\p{...}`/`Intl.Segmenter` devuelve 0, nunca rompe); expuesta en `window.__nexoEmojiOnly`. La burbuja se quita con `:has(.msg-text.emoji-jumbo)` (fondo/borde/sombra/blur a none) en `nexo_theme.css`; tamaños en `critical.css`. Pruebas `chatactions.js` ampliadas y en la batería (tag CHATACT): emoji_1, emoji_2, emoji_piel, emoji_bandera, emoji_muchos (4 → NO jumbo), emoji_texto (texto suelto → NO), emoji_mixto (emoji+texto → NO). **Batería 78/78**, índice **43,4** (interfaz, sin modos de fallo nuevos del catálogo); Kotlin sin cambios (nada nativo). **APK publicada** (nightly-2828, 24,26 MB, sha256 `2711c488…`; firma verificada en CI); mirror a la rama de trabajo hecho. ⚠️ A confirmar en el teléfono del dueño (es visual). **2827** = **leído (✓✓ azul) por Bluetooth más robusto (informe del dueño 29-10)** — el dueño vio que por Bluetooth el ✓✓ de «leído» no se ponía azul. HONESTO: el color y la lógica de estado están bien (`status-read` = azul, igual en todas las redes) y en el simulador el ✓✓ **SÍ** se pone azul por Bluetooth, incluso forzando que el enlace se caiga al leer y reconectando → el **síntoma exacto NO se reproduce** en el sim (su Bluetooth entrega mejor que un teléfono real). Pero sí hay un **hueco real** leyendo el código: el acuse de lectura (`read_receipt`) es un paquete de **control de un solo intento**; si el enlace Bluetooth no está listo al leer (caído / reconectando), se **pierde sin reintento** (el emisor queda en gris «entregado»). **Refuerzo** (aditivo, solo JS, `ble_ui.js`): si al leer no hay enlace directo, se recuerda el acuse y se **reenvía al reconectar** (`peerReady`), como ya hacen estados/avatar; un acuse duplicado es inofensivo (el emisor deduplica por tipo+id). Prueba nueva `tests/sim/readbt.js` (tag READBT). Batería **78/78**, índice **43,4**, Kotlin sin cambios. **APK publicada** (nightly-2827, 24,26 MB, sha256 `0918c361…`; firma verificada en CI). **Es REFUERZO, no arreglo confirmado** del caso del dueño: si tras la 2827 el ✓✓ sigue gris por Bluetooth, hace falta el diagnóstico de los dos teléfonos. **2826** = **detalles de interfaz (prueba real del dueño con la 2825)** — (1) la barra superior muestra el **transporte como SÍMBOLO** (icono dibujado de Wi-Fi / Internet / Bluetooth) en vez de la palabra: se ve mejor, ocupa menos y deja sitio al nombre; la palabra queda en el tooltip (`title`) y el aviso «⚠ señal débil» del Bluetooth lento se mantiene como texto (`main.js` `_subtitleFor` + iconos SVG con `currentColor`; gancho de pruebas `__nexoViaSubtitle`). (2+3) **responder a un ARCHIVO** (deslizando o por el menú) ya muestra su **NOMBRE** («📎 informe.pdf») y **NUNCA** el JSON crudo («código»): `_msgSummary` (`chat_format.js`) saca el nombre de `attachmentMeta.name`, del adjunto codificado en `content` o de un descriptor de protocolo suelto, y cualquier otro JSON de protocolo cae a una etiqueta limpia (lo mismo que se hizo con la ubicación en la 2824, extendido a archivos). (4) **barra superior rehecha**: nombre y estado en columna; el nombre pasa a `<textarea>` (se renombra igual tocándolo; Enter confirma sin meter salto) que se parte en **2 líneas** si es largo en vez de cortarse (`index.html` + `critical.css`; `_fitContactName` ajusta el alto a 1–2 líneas; la cabecera crece con `min-height`). Una prueba (`malasenal`) esperaba la palabra «Bluetooth»/«señal débil» en el subtítulo (ahora icono): se corrigió para mirar icono + `title` (verde). Pruebas `chatactions.js` (resumen de archivo por nombre/contenido/descriptor + nunca código; iconos de transporte; nombre = textarea) y `malasenal.js`. **Batería 77/77**, índice **43,4** (interfaz, sin modos de fallo nuevos); Kotlin sin cambios (nada nativo). **APK publicada** (nightly-2826, 24,26 MB, sha256 `e23f380d…`; firma verificada en CI). ⚠️ A confirmar en los teléfonos del dueño (es visual). **2825** = **entrega (✓✓) con la app CERRADA (#87)** — pedido del dueño tras probar la 2823 («que el despertador de fondo mande la confirmación de entrega aunque la app esté cerrada, como WhatsApp»; aclaró: el **✓ de enviado está bien, falta el ✓✓ de entrega, el leído sigue siendo cosa de la app**). Antes, con la app CERRADA el nativo (`NetBg`) reconocía el sobre de la pareja por los relés y AVISABA (notificación), pero **NO devolvía la confirmación** → el emisor se quedaba en ✓ hasta que el receptor ABRÍA la app (justo lo que vio el dueño: al Vivo le llega con la app cerrada, pero el S24 solo marcaba «enviado», no «enviado-recibido»). Ahora, al reconocer un mensaje NUEVO (con `msgId`), NetBg publica por el MISMO buzón de relés la confirmación EXACTA que arma la app abierta (`ble_ack._sendReceipt`→`net.send`): sobre `{t,w,p}` con `p={v:1,type:"ack",msgId,from,ts,a}`, sellado AES-GCM (AAD `NEXO-NET|yo|emisor`) y **firmado con la clave de la pareja** (`a` = HMAC `nexo-ack|ack|msgId|yo|emisor`[:12], el mismo MAC que `e2eAckTag`/`ackTag`) si la tenemos — un contacto **proto 2 EXIGE** la firma (auditoría C1), uno proto 1 la acepta sin ella; evento kind 1059 a la etiqueta del día del **EMISOR**, expiración 7 días (`TTL_MSG`), firmado con clave efímera (como la app). Solo por mensajes con `msgId` (ni saludos, ni confirmaciones, ni control, ni mensajes de otro contacto); el **leído no cambia** (lo sigue armando la app al abrir el chat). **Solo nativo**, NO toca el protocolo ni el JS: `NetBg.kt` (companions `seal`/`ackMac`/`randomSk` + campo `ackKeys` + `setAckKeys` + `publishDeliveryAck` en `onEvent` tras `onMessage`), `NexoBlePlugin.kt` (empuja `ackKeys` a NetBg en `setAckKeys` y en `netBgConfig`; la carrera entre ambas queda cubierta). Prueba Kotlin de punta a punta con un relé real (NIP-42): NetBg **publica una confirmación por cada mensaje nuevo (y SOLO por esos)**, sellada para que solo el emisor la abra y bien firmada (`NetBgTest` 5/5, comando `DUMP` en `netbg_helper.mjs`). Suite Kotlin completa verde; **batería 77/77**; índice sigue **43,4** (cambio nativo, no toca el simulador). **APK publicada** (nightly-2825, 24,26 MB, sha256 `3c9cce80…`; firma verificada en CI). El efecto real (✓✓ con el otro teléfono CERRADO) lo confirma el dueño en los teléfonos. **2824** = **tres detalles de la prueba real del dueño con la 2823**: (1) el **gesto secreto de la «N»** en Perfil no abría el juego — faltaba `setPointerCapture`: al dibujar la «N» (alta) el dedo se salía de la zona de 220 px y se perdían los `pointermove`/`up` (trazo incompleto); ahora captura el puntero + respaldo táctil (`nexo_game.js`, prueba `juego.js`); (2) **responder a una UBICACIÓN** mostraba el JSON crudo («código») en vez de «📍 Ubicación» — `_msgSummary` no miraba el adjunto codificado dentro de `content` (`{"type":"attachment","attachmentType":"location",…}`); arreglado (`chat_format.js`, gancho `__nexoMsgSummary`; `chatactions.js` comprueba las dos formas); (3) **deslizar una burbuja para responder** no daba ninguna señal — ahora una flecha ↩ que crece con el desliz y, al pasar el umbral, se ilumina y vibra, como WhatsApp (`chat_actions.js`, prueba `chatactions.js`). El **aviso con pantalla apagada se deja «destacado» (heads-up)**, como eligió el dueño (no es cambio de código). Batería **77/77**, APK **nightly-2824**. **2823** = **flake de CI (NetBgTest) — NO es de la app**: la **2822** (arreglo de archivos) estaba bien (batería 77/77) pero **no llegó a generar APK** porque una prueba Kotlin (`NetBgTest.dePuntaAPuntaConUnReleQueExigeIdentificarse`) fallaba de vez en cuando con el orden al revés (`[m2, m1]`). La causa estaba SOLO en el arnés de la prueba (`tests/kotlin/netbg_helper.mjs`): publicaba los mensajes en PARALELO (cada uno por su ws tras un `await seal`), así que dos seguidos con el MISMO `created_at` (va en segundos) corrían una carrera por llegar al relé y el suscriptor los veía a veces al revés. Ahora publica **EN SERIE** (cada evento espera su `OK` —y para entonces el relé ya lo repartió— antes del siguiente). Reproducción con la misma compuerta async: concurrente **71/200** invertidos → en serie **0/200**; prueba real **10/10**; batería **77/77** (este cambio no toca la app). Índice sigue **43,4**. **APK publicada** (nightly-2823, 24,26 MB, sha256 `0a4b6274…`; firma verificada en CI); como la 2822 no generó release, esta nightly lleva el arreglo de archivos de la 2822 + el no_service de la 2821 + la auditoría de la 2820. **2822** = **#2 (diagnóstico del S24 28-10)**: una transferencia de archivo ya NO se aborta por `Max window retries` cuando el enlace solo parpadea (vídeo/imagen a `nx0ed4a8be` por Jump, foto al Vivo por Wi-Fi que se rendían). `ble_ack.js` (ChatStream): una ventana que caduca con el enlace CAÍDO no gasta un reintento del tope; espera a que vuelva y el límite real pasa a ser el timeout global (60 s sin ACK). Solo Wi-Fi local/internet (`_linkUp`); Bluetooth crudo no se toca. 1.ª versión rompió 3 pruebas BLE (la batería lo atrapó) → acotado a lan/net → 77/77, índice 43,4. Prueba `tests/sim/fileflap.js`. **2821** = **#87 (diagnóstico del dueño 28-10, los dos teléfonos)**: un contacto con el GATT roto (`nx1e29ab2f`: `no_service` + `MTU 23`) se reconectaba por Bluetooth cada ~15 s PARA SIEMPRE → **627 «despertares por mensajes» en el Vivo** (batería) e inundación del registro. Ahora tras 4 `no_service` seguidos se **pausa SOLO su Bluetooth** (backoff 30 s→10 min) y se sigue por internet/Wi-Fi/Jump; un corte normal no cuenta; al conectar bien se olvida; el bucle de re-búsqueda no escanea mientras el único perdido está en pausa. `ble_interface.js`+`ble_connections.js`+`native_mock.js`; prueba `tests/sim/noservice.js`, batería **76/76**, índice **43,2**. El efecto real (cuántos despertares baja) se confirma en los teléfonos. **2817–2820** = **2817** el escaneo deja de inundar el registro nativo (el Token FCM y lo útil sobreviven); **2818** diagnóstico a 30 min + tope ~5000 líneas y **archivos grandes por internet Fase A ~22 MB** (Tor directo o relés; >22 MB espera Wi-Fi/WD con aviso claro, nunca «enviada» en silencio); **2819** **FCM Fase 2b** (intercambio del token en el saludo cifrado + disparo del «toque» al mandar por el buzón; falta que el dueño despliegue el enviador); **2820** **AUDITORÍA SEVERA** (pedido del dueño) con **dos revisores adversariales independientes a la vez** (seguridad + robustez/fluidez) — **7 fallas reales verificadas y arregladas**: **SEC-1 ALTA** (un `created_at` externo con fecha futura envenenaba `lastSeen` → el teléfono dejaba de recibir TODO por internet para siempre; se acota a «ahora»), **G1 GRAVE** (`startForeground` sin try/catch al despertar por FCM → posible crash Android 12+/14+), **M1** (tormenta de toques FCM → solo por mensaje nuevo + throttle), **M2** (nota de voz que seguía sonando al salir del chat), **SEC-4/L1/L2/L3** leves; descartados SSRF/path-traversal/cripto/intents/XSS; documentados para ronda propia SEC-2/SEC-3 + H3/H4/M5/M6/F6/F7/F8. Pruebas en `fcmwake.js`; batería **75/75**; índice **43,1** (el techo es B=6,8/35: casi nada confirmado en los teléfonos desde la 2765). Ver `AUDITORIA.md` §3quater, `ROBUSTEZ.md`, `COMPARATIVA.md`, `FCM.md`. **2816** = **«despertador» tipo WhatsApp (FCM) — Fase 1 «recibir» (#87)**: para que NEXO reciba aunque esté **CERRADA** y el fabricante (Vivo…) la congele, como WhatsApp — pero por Google **solo pasa un «toque» sin contenido**; el mensaje sigue P2P y cifrado de punta a punta (ver `docs/FCM.md`). Se integró Firebase (SOLO mensajería; nada de analíticas ni datos a Google): plugin `google-services` **4.5.0** en `android/build.gradle` (primero que soporta AGP 9.4; las 4.4.x fallan con AGP 9), **Firebase BOM 34.3.0 + `firebase-messaging`** en `plugins/nexo-ble`, **`NexoFcmService`** (al llegar el toque arranca el servicio de NEXO —baja el buzón por NetBg— y deja un aviso; apunta el token en `onNewToken`; todo defensivo), registrado en `AndroidManifest` (MESSAGING_EVENT), y `NexoBlePlugin.load` apunta el **token** de cada teléfono en el diagnóstico (no es secreto: es la «dirección» para despertarlo). `android/app/google-services.json` = config pública del proyecto Firebase del dueño (`nexo-7994a`, paquete `com.nexo.app`). **No se puede simular**: se compiló primero en una **rama de prueba** (`claude/fcm-build`, `workflow_dispatch`, build **#2815**, artifact `app-debug.apk` OK) ANTES de tocar NEXOCHAT, para no romper la nightly — Firebase + AGP 9 **compiló a la primera**. Batería **74/74** (no se tocó JS). **Pendiente del dueño (prueba Fase 1):** instalar la APK en los **dos** teléfonos (sobre todo el Vivo), abrir NEXO una vez, Perfil → Copiar diagnóstico (saldrá `Token FCM: …`) y pasármelo; con ese token mandamos un «toque» de prueba y vemos si el Vivo **cerrado** despierta y muestra el aviso (confirma que FCM llega al Vivo, la gran incógnita del #87). **Siguiente (Fase 2 «enviar»):** compartir el token cifrado entre contactos (en el kx/relé) + un **enviador diminuto** (Cloud Function de Firebase, gratis) que guarde la **llave de Google** (service account, **SECRETA** — no va al repo ni al chat) y dispare el «toque» al mandar a un contacto que está offline. **2811** = **aviso de ahorro de batería al instalar, COMO UN PERMISO** (pedido del dueño: «poner eso como aviso cuando se instala la app como los permisos que se piden aceptar»): al arrancar, si NEXO no está exento del ahorro de batería, sale una **pantalla a toda vista** (ya no un salto mudo al ajuste del sistema, fácil de ignorar) que explica el porqué («el teléfono congela NEXO y los mensajes/llamadas llegan tarde») y abre el ajuste con un **botón grande**; al volver comprueba si quedó bien; en los **fabricantes agresivos (Vivo, Samsung, Xiaomi…)** un **2º paso** guía al «inicio automático»; se puede **posponer** unas veces y luego queda en Perfil → Ajustes, y **no vuelve a salir** una vez exento. `src/ui/battery_prompt.js` enganchado en `main.js` (`_askBackgroundOnce`), pruebas `tests/sim/battery_prompt.js` (nueva) y `alerts.js` (actualizada), batería **72/72**. **2812** = **diagnóstico de verdad a 1 hora** (pedido del dueño: «ya quiero que recortes el tiempo! te dije que solo sea una hora!»): la «sesión anterior» del diagnóstico (Perfil → Copiar diagnóstico) iba ENTERA y lo hacía enorme; ahora también se recorta a la última hora como la actual — `diag.js` `_lastHourText` (recorta por la hora HH:MM:SS al inicio de cada línea, mantiene cabeceras) + al fichero se guarda solo la última hora; prueba `tests/sim/diaghora.js`, batería **73/73**. **2813** = **la pantalla «Agregar contactos» muestra SOLO los escaneados nuevos** (pedido del dueño «solo quiero que se vean los que se escanean»; eligió «Solo escaneados»): se quitan de ahí «En línea ahora» y «Tus contactos» (quedan en Chats); los teléfonos nuevos salen en `#ble-new-device`. `ble_ui.js` `renderPanelLists` + `ui4.js` actualizado (invierte la 2771), batería **73/73**. **2814** = **scan lento / thrash del Bluetooth (#87)** — el diagnóstico del dueño mostraba que el vigilante cortaba el enlace al fallar SOLO 2 pings aunque el otro seguía ahí («sin respuesta a 2 pings: desconectado») y cada corte disparaba escaneos que saturaban la radio (scan lento). Arreglo: `_autoScanForKnownContacts` (único punto real de auto-escaneo — el manager `_autoScan`/`window.autoScan` nunca se instancia) lleva **throttle** (`_autoScanMinMs` 8 s; el escaneo del usuario `toggleScan` no pasa por ahí) y **`_pingMaxFails` 2→4** (un enlace vivo pero lento no se corta a la primera). Prueba determinista `tests/sim/thrash.js`: reproduce el fallo pre-arreglo (sin throttle; corta a 2 pings) y con el arreglo pasa (throttle bloquea; corta a 4), batería **74/74**. El dueño aún tiene por probar **2811–2814** en los dos teléfonos (ahorro de batería, diagnóstico 1 h, agregar solo escaneados, scan lento) además de la prueba de FCM (2816). **2810** = **el gesto secreto de la «N» pasa de Ajustes a Perfil** (informe del dueño: en Ajustes el scroll se comía el trazo; ahora va en una zona dedicada del espacio negro de abajo de Perfil, con `touch-action:none`), batería **71/71**. **2809** = **auditoría P0-4 (XSS)** — confirmado que TODO el contenido del remitente se pinta como texto (nunca `innerHTML`); vigilante nuevo `tests/sim/xss.js` y CSP endurecida (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), batería **71/71**. **2808** = **rendimiento de NEXO** (pedido del dueño «rendimiento api de nexo»): nueva sección **⚡ Rendimiento** en Ajustes que mide y muestra EN VIVO lo real de la sesión — latencia (ping ida y vuelta, reusa el RTT del supervisor), contactos en línea, mensajes entregados y %, tiempo de confirmación de entrega y de transferencia; hecho **pasivo** (escucha eventos ya existentes, una sola línea nueva en el núcleo), `src/ui/perf.js` + prueba `tests/sim/perfmetrics.js`, batería **70/70**. **2807** = **Perfil y Ajustes separados** (pedido del dueño «organizar bien mi perfil con el menú ajustes»): **Perfil** = identidad (foto, NEXO ID, compartir, cómo te ven); **⚙️ Ajustes** = seguridad, avisos, llamadas/tono, internet, diagnóstico y tu cuenta (Fénix, cambiar de teléfono); el **gesto secreto de la «N»** vive ahora en **Ajustes**. Batería **69/69**. **2806** = **juego secreto «Defensor NEXO»** — mini-arcade oculto que se abre dibujando la **«N» de NEXO** con el dedo en la pantalla de **Ajustes** (pedido del dueño); nave que esquiva/destruye meteoros (amenazas), recoge mejoras de disparo y **salva contactos**, con clasificación guardada; lógica probada en `tests/sim/juego.js` (el juego real se ve en el teléfono, jsdom no tiene Canvas), batería **69/69**. En paralelo, trabajo autónomo de marca para el dueño (le mandé a escuchar/ver, sin desplegar aún): **3 sonidos originales** (tono de mensaje/llamada/videollamada) y **2 logos** (recomendado B: la N cuya diagonal une dos nodos = «nexo»). Antes: tras los 3 nativos (2801-2803), el dueño pidió **auditoría completa con pruebas destructivas** y **empezar con iOS**. **Auditoría:** hallazgo **ALTO** arreglado — DoS por un trozo BLE con «n» (total de trozos) disparatado que colgaba la interfaz (ANR), a alcance Bluetooth y sin ser contacto; tope `MAX_CHUNKS` (2804) — y 2 leves de defensa en profundidad (vault y tarjetas de contacto, 2805); todo reproducido en `tests/sim/chunkdos.js` y en la batería (**68/68**, índice **43,4**; ver `AUDITORIA.md` §3ter). **iOS Fase 0:** el proyecto iOS + el plugin Swift **COMPILAN** en el CI macOS de GitHub (sin Mac propia; arreglados el `npm install` incompleto en macOS y un uso de API de iOS 14 — `.limited` — con objetivo iOS 13), en la rama de trabajo `claude/repo-file-access-9bwl60`, sin tocar la línea de Android (meta del dueño: «que la app corra en iPhone»; falta Bluetooth real = Fase 2, y cuenta Apple para instalar en un iPhone real). Antes: trabajo autónomo por los pendientes (el dueño: «no pares hasta terminar todos los pendientes»; de madrugada dio más decisiones y pedidos — ver §«Decisiones del dueño 27-10 (madrugada)» en `PENDIENTES.md`). Al despertar, el dueño pidió los **3 nativos** (Face ID opcional, gestos atrás, descargar a galería) — **los 3 ya subidos** (2801/2802/2803), a confirmar en el teléfono. 2803: **Face ID OPCIONAL** — ajuste «desbloqueo rápido por rostro (menos seguro)» en Perfil → Seguridad (#103); el default sigue siendo biometría fuerte. 2802: **el «atrás» de Android cierra el chat/overlay** en vez de salir de la app (#101) — `MainActivity.onBackPressed` → `window.__nexoHandleBack`. 2801: **guardar foto/vídeo en la GALERÍA** (#92) — botón ⬇ en el visor (nativo `saveToGallery` por MediaStore); NO en «ver una vez». 2800: **auditoría de robustez (#106)** — arregladas 2 fallas reales de la superficie nueva (foto «de una vez» que revivía al retransmitirse = privacidad; Estado con fecha futura que no caducaba), reproducidas en `tests/sim`; ver `AUDITORIA.md` §3bis. 2799: **Stream fase 1 — Estados** tipo WhatsApp entre contactos (texto, 24 h, cifrado, «solo cercanos», #104) — pedido estrella de la madrugada. 2798: **aviso de mala señal** — «⚠ señal débil» en el subtítulo cuando el Bluetooth quedó con MTU bajo (#102). 2797: **contacto — tocar la FOTO la abre grande, tocar el NOMBRE entra al chat** (#100) + estabilizado un flake de CI (test Kotlin de tiempos). 2796: **limpieza del prototipo MUERTO de pagos** en `nexo_app.js` (sin UI que lo disparara; pendiente «antes de la tienda»). 2795: **fotos de una sola vista («ver una vez», #94)** — un botón 👁 en la revisión de la cámara marca la foto; al otro le llega como «Toca para ver · una vez» y al abrirla **se borra de verdad** (payload, texto y blob del disco) y no se reabre; el flag viaja en el chunk-0 del protocolo de archivo (`o1`). v1 solo FOTOS (el vídeo de una vez, más adelante). Antes, 2794: **buscar dentro del chat** (lupa 🔍 → barra que filtra y cuenta), que COMPLETÓ los «rápidos» de la lista `A_LA_PAR.md`. Solo interfaz + vault. Orden acordado con el dueño: **(1) rápidos** (autocorrecto ✓, moneda ✓, buscar en el chat ✓ — **completo**), **(2) internet de verdad** (#2 archivos grandes por Tor → #3 videollamada por internet) ← **siguiente**, **(3) Estados/Stream**; y en paralelo **explorar socio de pagos** (Mercado Pago/CoDi) para la billetera con saldo (lo pedido «cuenta con saldo / agregar dinero» exige licencia o socio — ver `docs/A_LA_PAR.md`). Builds recientes: 2794 (buscar en el chat), 2793 (autocorrecto + moneda), 2792 (botón de grupo + aviso de archivo), 2791 (barra de adjuntar + tarjeta Cobro). Docs nuevos: `A_LA_PAR.md`, `RENTABILIDAD_MX.md`. Fénix del dueño: 9/10 contactos elegibles (falta 1 para activarse). Ver "Ronda 2795")

## Construcción y firma
- Push a `NEXOCHAT` → `.github/workflows/build-apk.yml` publica la pre-release `nightly-<run>` (APK debug).
  En otras ramas (lanzado a mano) solo compila, verifica la firma y sube un artifact; no publica.
- Firma fija: secret `DEBUG_KEYSTORE_BASE64` → `NEXO_DEBUG_KEYSTORE` → `android/app/build.gradle`.
  El paso "Verify APK signature" exige SHA-256 `23d86688…9f865e`. Desde la 2691 se actualiza encima
  sin desinstalar. El dueño guarda copia de la llave (no está en el repo).
- Solo entra en la APK lo que importa `src/main.js` (webpack); el resto de `src/` no se usa aún.

## Qué hace la APK
Mensajería P2P por BLE sin servidores. Identidad `NX` + 8 caracteres (`_generateNexoId` en
`ble_interface.js`, guardada en `nexo_advertising_id.json`; mapas `_nexoIdToMac`/`_macToNexoId` con ID en
minúscula y MAC sin ":"). Cada teléfono es servidor GATT (servicio `0000abcd`, RX `abce`, TX `abcf`) y
cliente; anuncia el NEXO ID en manufacturer data. Chat con estados (pendiente → enviado → entregado →
leído), cola de reenvío, sincronización por `seq`, adjuntos (foto 480 px, vídeo, archivo ≤ ~2,1 MB, voz,
ubicación) y persistencia JSON (`saveToFile`/`loadFromFile`; adjuntos en `nexo_att_<msgId>.b64`).

Archivos clave: `src/main.js`, `src/ui/ble_interface.js`, `src/ui/ble_ack.js` (protocolo: trozos
`c`/`f`, ack de bloque `ba`, NACK `n`, sync `ss`/`sr`, `sendWithRetry`), `src/vault/vault_manager.js`,
`plugins/nexo-ble/.../NexoBlePlugin.kt`.

## Historial
| Build | Commit | Nota |
|---|---|---|
| 2679 | `04960e2` | Base funcional recuperada |
| 2680–2687 | | Rotura del envío (`content` vs `message`), fixes; 2687 subida sin verificar: no usar |
| 2688 | `c45f5f5` | Envío/ACK/historial OK. Fotos lentas, app trabada tras 2ª foto, PDF no llega |
| 2691 | `37152b8` | Firma fija real; sin tormenta de retransmisiones; adjuntos fuera del historial. Prueba real: textos y fotos OK pero lento; al reabrir la app se perdían 1-2 mensajes |
| 2692 | `d6c7fae` | Verificación en rama de trabajo (Kotlin compila, firma OK), sin release |
| 2693 | `c12c974` | Mensajes retenidos al reabrir, control de flujo nativo por callback, progreso visible |
| 2694 | `b75a767` | Verificación en rama de trabajo (Kotlin + firma), sin release |
| 2695 | `37ad25e` | Historial sin carreras (mensajes borrados al reabrir), textos repetidos visibles, reconexión al volver a la app |
| 2696 | `939f4ec` | Vídeo previa 240p + HD automático; lista de contactos por último mensaje |
| 2697 | `2fc0074` | Vídeo/texto a app cerrada ya no se pierden (cola por contacto), vídeo se ve más de una vez, miniatura |
| 2698 | `43256cd` | Vídeo: burbuja con miniatura sin reproductor, visor que libera, previa robusta, diagnóstico en Perfil — **BASE ESTABLE** (rama `base-estable-2698`) |
| 2699 | `d563355` | Compartir contactos (botón contacto): selección múltiple, tarjeta, alta con parpadeo — **BASE ESTABLE** (rama `base-estable-2699`) |
| 2700 | `eef24ed` | Rendimiento: historial paginado, sin congelones al recibir, escrituras agrupadas, radio libre en transferencias |
| 2701 | `cc42d09` | Vídeo: HD recodificado 720p si el original es grande, tiempo restante, tiempos en el diagnóstico |
| 2702 | `d7b85ab` | Cifrado de extremo a extremo (textos, adjuntos, nombre y miniatura); fin de los reenvíos de lo ya entregado. Actualizar todos los teléfonos |
| 2703 | `b611dbd` | Compilación de prueba en la rama de trabajo (Kotlin de archivos), sin release |
| 2704 | `b9c412f` | Archivos: PDF con miniatura y se abre al tocar, APK se instala, selector sin cierre a los 30 s |
| 2705 | `0b04628` | Jump: mensajes de varios saltos (A → B → C) por teléfonos conectados, cifrados para el destino |
| 2706 | `09da6aa` | Compilación de prueba en la rama de trabajo (Kotlin getPowerStatus), sin release |
| 2707 | `48887c1` | Jump con cualquier teléfono NEXO (bajo demanda), protección de batería, selector de camino |
| 2708 | `eeade70` | Compilación de prueba en la rama de trabajo (Kotlin Wi-Fi Direct), sin release |
| 2709 | `b5269f4` | Wi-Fi Direct para fotos, vídeos y archivos (hasta ~22 MB, vídeo original) |
| 2710 | `2947c22` | Compilación de prueba en la rama de trabajo (APK no depurable), sin release |
| 2711 | `5f3a1ad` | Seguridad fase 1: APK no depurable, sin copias, registros sin contenido, anti-suplantación |
| 2712 | `9c33e79` | Seguridad fase 2: protocolo de Signal (Double Ratchet), sobre atado al cifrado, relleno, número de seguridad. Actualizar todos los teléfonos. APK verificada (firma 23d86688…, sin depuración ni copias) |
| 2713 | `4a33565` | Wi-Fi Direct: permiso de Android 13+ (faltaba: nunca funcionaba) y vídeo/archivo que se quedaban en 1 % si fallaba. APK verificada (firma, NEARBY_WIFI_DEVICES presente) |
| 2714 | `cdb3b89` | Ubicación con aviso y alternativas (GPS → red); Wi-Fi Direct ya no reenvía por Bluetooth lo entregado; tiempos por fase. APK verificada |
| 2715 | `8a2d5e7` | Protocolo Fénix fase 1: respaldo automático de la cuenta en 10/20 contactos, pingeo y curación, recuperación con 6 confirmaciones. APK verificada |
| 2716 | `504994f` | Compilación de prueba en la rama de trabajo (limpieza de Kotlin), sin release |
| 2717 | `504994f` | Limpieza: fuera ~10.900 líneas de código sustituido o duplicado. JavaScript idéntico a la 2715; APK 0,5 MB más ligera (sin `client/android` ni iconos sobrantes). APK verificada |
| 2718 | `29bcc90` | Chat tipo WhatsApp (responder, reenviar, eliminar para mí / para todos, copiar) y cámara nueva (VÍDEO/FOTO, revisar antes de enviar, selfie en espejo, fotos a 800 px). APK verificada |
| 2719 | `a217b9e` | Compilación de prueba en la rama de trabajo (Kotlin de la fase 3), sin release |
| 2720 | `a217b9e` | Seguridad fase 3: datos cifrados en el teléfono (Keystore), bloqueo opcional con huella/PIN y bloquear capturas (Perfil → Seguridad). APK verificada (firma 23d86688…, sin copias) |
| 2721 | `e47a031` | Compilación de prueba en la rama de trabajo, sin release |
| 2722 | `e47a031` | Envío fluido: la 2720 hacía lento hasta el texto (releía todos los adjuntos en cada arranque y los archivos bloqueaban la fila única del plugin). Archivos en hilos propios, tiempos de cada texto en el diagnóstico. APK verificada |
| 2723–2724 | | Compilaciones de prueba en la rama de trabajo, sin release |
| 2725 | `3e1d507` | Fotos paradas (20 % / ○) y "mensaje de código" con la 2722: cola nativa que nunca parte un mensaje, resincronización del receptor, comprobación por trozo, paquetes dañados fuera del chat, sin avalancha de avisos nativos. Reproducido y corregido en el simulador |
| 2726–2727 | | Compilaciones de prueba en la rama de trabajo (Wi-Fi normal), sin release |
| 2728 | `93dd9ad` | Wi-Fi normal (misma red) y cambio automático Wi-Fi / Bluetooth / Wi-Fi Direct / Jump (`docs/WIFI.md`). Cabecera del chat con el camino. Probado en simulador y JVM |
| 2729 | `104dcc6` | Compilación de prueba en la rama de trabajo (latido nativo del Wi-Fi), sin release |
| 2730 | `40fe10c` | Wi-Fi según las reglas del dueño (no pasa a Bluetooth por un corte breve ni en segundo plano; mala señal medida), remitente oculto a los puentes de Jump, poscuántico (ML-KEM), QR del número de seguridad. APK verificada (firma 23d86688…, sin copias) |
| 2731 | `9b0250b` | Compilación de prueba en la rama de trabajo (Kotlin del largo alcance), sin release |
| 2732 | `fbeaaed` | Jump con más alcance (Bluetooth de largo alcance LE Coded y hasta 8 saltos), Fénix fase 2 (los mensajes de texto se respaldan en 2 contactos y vuelven al recuperar la cuenta), el "+" de agregar ya no falla. APK verificada (firma 23d86688…, sin copias) |
| 2733 | `d20e1b6` | Compilación de prueba en la rama de trabajo (Kotlin del escaneo de la red), sin release |
| 2734 | `a5f9d77` | Wi-Fi: escaneo activo de la red (idea del dueño): los teléfonos en el mismo Wi-Fi se encuentran aunque el router no deje pasar el anuncio mDNS. APK verificada (firma 23d86688…, sin copias) |
| 2735–2738 | | Compilaciones de prueba en la rama de trabajo (Tor): la 2735 y la 2738 fallaron (versiones de tor-android que el Gradle del proyecto no admite), la 2737 compiló con la 0.4.9.5 |
| 2739 | `f51dec6` | Internet: relés públicos Nostr (buzón cifrado, etiquetas diarias, sin NEXO IDs) y Tor (servicio oculto, directo y sin IP visible). Wi-Fi de módems distintos = internet antes que Bluetooth. `docs/INTERNET.md`. APK verificada (firma 23d86688…, sin copias, TorService y libtor.so ARM 64/32); pesa 26,9 MB (la 2734, 10 MB) |
| 2740–2743 | | Compilaciones de prueba en la rama de trabajo (pruebas automáticas en GitHub); la 2740–2742 pararon en las pruebas por el fallo de Jump con internet |
| 2744 | `56f6991` | Pruebas automáticas antes de cada APK, Jump: fotos ya no se atascan con el puente conectado por internet, vista previa sin medio emoji, limpieza (versiones, manifiesto, tarjetas de pago). APK verificada (firma 23d86688…, sin copias, Tor incluido) |
| 2745–2748 | | Compilaciones de prueba en la rama de trabajo (AGP 9): 2745 y 2746 fallaron (proguard-android.txt, compileSdk 37.1), 2747 (AGP 9.2) y 2748 (AGP 9.4) compilaron con la firma de siempre |
| 2749 | `3180529` | Gradle moderno (AGP 9.4.0, Gradle 9.6.0, Kotlin 2.2.20, compileSdk 37.1) y Tor 0.4.9.14. APK verificada: firma 23d86688…, manifiesto igual que la 2744 (permisos, targetSdk 34, sin copias), Tor nuevo; pesa 24,4 MB (antes 26,9) |
| 2750 | | Compilación de prueba en la rama de trabajo (Kotlin de notificaciones e internet en segundo plano): compila, pruebas en verde |
| 2751 | `769c025` | Notificaciones de mensajes (una por chat, número en el icono), no leídos por todas las vías, "leído" solo con la app a la vista, internet en segundo plano (escucha nativa de los relés), permiso de notificaciones. APK verificada: firma 23d86688…, manifiesto igual que la 2749 + POST_NOTIFICATIONS, clases nuevas presentes |
| 2752 | a468f31 | Reestructuración sin cambios de código: main.js 4.281 → 720 líneas, ble_interface.js 3.732 → 847, en 30 módulos (`docs/ESTRUCTURA.md`). Batería idéntica. APK comprobada: 24,4 MB, cert 23d86688…, sin copia de seguridad, manifiesto idéntico a 2751, clases nativas nuevas presentes. Falta probarla en teléfonos |
| 2753 | `75772b8` | Sin APK: falló en GitHub la prueba nueva `binary.js` (las pérdidas simuladas se aplicaban también al conectar y se perdió el intercambio de claves; ahora solo durante los envíos). El Kotlin compiló bien en las pruebas JVM |
| 2754 | `9dac851` | Bluetooth sin base64: trozos de archivo en binario con quien lo anuncia (−25 % de bytes por la radio, fotos y PDF ~25–35 % más rápidos en el simulador); con builds anteriores, JSON de siempre. APK verificada: 24,5 MB, firma 23d86688…, manifiesto idéntico a la 2752, `BinFrame`/`BinAssembler`/`sendBinary` presentes. Falta probarla en teléfonos |
| 2755 | `c035890` | Solo diagnóstico (el dueño dice que los archivos no llegan; sin cambio de comportamiento): en Perfil → Copiar diagnóstico salen los errores de Bluetooth del nativo (`BT_ERR`: escritura o notificación fallida, mensaje descartado, trozo binario incompleto; uno por tipo cada 5 s) y una línea `[BIN]` por cada envío/recepción en binario. APK verificada (firma 23d86688…, manifiesto igual que la 2754) |
| 2756 | `a7b3641` | Archivos grandes hasta 1 GB por el mismo Wi-Fi / Wi-Fi Direct (informe del dueño: un APK de 24 MB no salía) e ID Bluetooth rotativo (plan punto 4). APK verificada (24,5 MB, firma 23d86688…, manifiesto igual que la 2755, clases nuevas presentes). Falta probarla en teléfonos |
| 2757 | ac3a670 | MTU pequeño (punto 8), Fénix para fotos y archivos (punto 9), Jump por Wi-Fi probado (punto 10), recibir por Bluetooth con la app cerrada (punto 12). APK verificada (nightly-2757); falta probarla en teléfonos |
| 2758 | 28b3a80 | Archivos grandes por Bluetooth L2CAP sin Wi-Fi (punto 13, fase 1), chats de grupo con textos, fotos, audio y archivos (punto 14), llamadas de voz (punto 16) y videollamadas en el mismo Wi-Fi (punto 17); arreglos: foto por Jump que no se completaba al reenviarse directa, acciones ocultas visibles al reabrir el chat. APK verificada (nightly-2758); falta probarla en teléfonos |
| 2759 | aa54dbd3 | Corrección mínima sobre la 2758: botón 👤 arriba (junto al 👥) que abre Perfil, porque la barra de abajo (Chats · Gente · Mapa · Perfil) queda fuera de la pantalla y no había forma de copiar el diagnóstico; la cabecera tiene altura propia y los botones ya no se salen por arriba. En investigación: en teléfonos reales con la 2758 no llegan fotos ni archivos (falta el diagnóstico de los dos teléfonos) |
| 2760 | | Compilación de prueba (lanzada a mano en la rama de trabajo, sin APK publicada): la 2761 + lo pendiente; Kotlin y pruebas en verde |
| 2761 | a24a47f4 | Sobre la 2759 (sin las novedades pendientes): diagnóstico de los dos teléfonos del dueño → camino de envío con la regla nueva del dueño (Wi-Fi se mantiene; muy malo → internet; sin internet → Bluetooth; sin brincar), vigilante del Bluetooth que ya no corta enlaces vivos ni con un archivo en curso, enlace de MTU más alto, avisos nativos con la app en segundo plano aunque el teléfono la congele y avisos de Jump con la app cerrada. Ver "Ronda 2760" |
| 2762 | 4634f69e | La 2761 + lo que estaba pendiente: pasar la cuenta a un teléfono nuevo (punto 15 A), aviso "Llamada entrante" con la app cerrada, botón de altavoz; llamadas: códec real en oferta y respuesta (un teléfono sin Opus no oía nada), videollamada por altavoz, salida de audio Android 12+, diagnóstico `[CALL]`; pantalla de llamada y videollamada nueva (estilo WhatsApp + NEXO, girar cámara). **Sin APK**: en GitHub falló una prueba Kotlin de tiempos (`AtRestStoreTest.migrarArchivoGrandeNoBloqueaOtros`: un guardado tardó 394 ms por una pausa de la máquina; el código no tenía fallo). Todo pasa a la 2763 |
| 2763 | 5c215c86 | La 2762 + toda la app con el estilo NEXO (como la pantalla de llamadas), llamada entrante como una llamada del teléfono (tono, pantalla completa, Contestar / Rechazar), avisos de grupo con el nombre del grupo con la app cerrada o congelada, y la prueba de tiempos rehecha (determinista). Ver "Ronda 2763". APK verificada (nightly-2763, 24,5 MB) |
| 2764 | 7c9afbaa | **Informe grave del dueño (tablet + S24 + Vivo): lo que la tablet mandaba al S24 (archivos, llamadas) sonaba y avisaba en el Vivo**: cada paquete directo dice a quién va y el que no es lo ignora (no suena, no avisa, no ✓✓), avisa "no soy yo" y el emisor corrige la conexión; un sobre de Jump de paso ya no avisa en el siguiente teléfono; al buscar ya no sale "Unknown" (nombre del teléfono al conectar) y "Agregar" nunca falla en silencio. Además: grupos con vídeo HD y archivos grandes; pantalla girada sin barra gris. Ver "Ronda 2764". **Sin APK**: el comentario de `nexo_colors.xml` llevaba "--" (no permitido en XML) y falló la compilación de Android. Todo pasa a la 2765 |
| 2765 | d9366857 | La 2764 con el XML corregido (todos los XML de Android revisados con un analizador). APK publicada (nightly-2765) |
| 2766 | 3f309571 | Revisión completa, parte 1 (escaneo, agregar, conexión): los pings nunca se contestaban (el enlace se rehacía cada ~30 s), un archivo podía salir cifrado para el teléfono equivocado, el Wi-Fi se perdía al volver a la app, BUSCAR se quedaba colgado, reconexión sin esperas, caídas del Bluetooth sin avisar, Tor sin dirección .onion. Mejoras: foto de perfil, avisos y llamadas que encienden la pantalla y se ven sobre el bloqueo, Perfil → "Avisos con la pantalla apagada". Ver "Ronda 2766". APK publicada (nightly-2766, 24,5 MB) |
| 2767 | ed848800 | Revisión completa, parte 2 (mensajes y archivos): textos largos pendientes que se perdían mostrando "entregado" (al reconectar tras reiniciarse la app), nota de voz pendiente que llegaba como "[adjunto]", transferencias de más de 10 min cortadas aunque avanzaran, Wi-Fi caído a mitad de una foto con un Bluetooth lento, orden en el chat (relojes desfasados; lo recibido con la app cerrada salía "ahora"), "!" durante un corte del Wi-Fi. Ver "Ronda 2767". Batería 32/32, Kotlin 65/65. APK publicada (nightly-2767, 24,5 MB) |
| 2768 | 6e8d6a84 | Revisión completa, parte 3 (llamadas y videollamadas): un teléfono cercano con un NEXO modificado podía hacerse pasar por un contacto (textos, archivos y llamadas sin cifrar; oír la voz, colgar llamadas reales): ya no; con la app cerrada "Rechazar" volvía a sonar con cada reenvío de la oferta (ahora un aviso por llamada); la siguiente llamada de ese contacto se contestaba sola; una oferta vieja sonaba al reiniciar la app; relojes desfasados; los dos a la vez; Wi-Fi caído en uno; micrófono y cámara encendidos tras colgar; videollamada sin cámara; voz repetida. Ver "Ronda 2768". Batería 43/43, Kotlin 68/68. APK publicada (nightly-2768, 24,5 MB; GitHub compiló el Kotlin nuevo y verificó la firma) |
| 2769 | 6b5b5088 | Videollamada robusta (informe del dueño: en videollamadas Vivo ↔ S24 a veces el S24 salía sin cámara, el otro veía negro y no se le oía): cámara y micrófono por separado con reintentos y vigilante (ocupados, cortados por el sistema, sin imágenes, audio en pausa), codificadores y decodificadores de voz y vídeo que se rehacen (antes, sin voz o negro hasta colgar), foto y motivo en vez de negro, avisos de los dos, sin micrófono la llamada sigue (antes se cortaba a los 12 s), pantalla encendida en llamada y sensor de proximidad. Ver "Ronda 2769". Batería 45/45, Kotlin 68/68. APK publicada (nightly-2769, 24,5 MB; GitHub compiló el Kotlin nuevo y verificó la firma) |
| 2770 | 0a330484 | Llamadas con la pantalla bloqueada o en otra app: el micrófono sigue (servicio de tipo micrófono, Android 11+; antes el otro dejaba de oír), foco de audio (la música de otras apps se para y vuelve al colgar), todo se suelta si NEXO se cierra en plena llamada, tono de llamada según el modo del teléfono (silencio, vibración, "No molestar"; con la app oculta solo el aviso del sistema). Ver "Ronda 2770". Batería 46/46, Kotlin 68/68. APK publicada (nightly-2770, 24,5 MB; GitHub compiló el Kotlin nuevo y verificó la firma) |
| 2771 | 2bb58c12 | Revisión completa, parte 4 (interfaz): "Agregar" con tus contactos y un buscador que filtra (antes decía "No hay contactos" aunque los hubiera y el buscador era un dibujo), avisos rotos ("Permiso de Microfono no encontrado denegado"), textos sin tilde o en inglés, aviso sin contactos, botón redondo con burbuja, Perfil con tus iniciales y cómo te ven, "Cambiar nombre" en el menú ⋮. Ver "Ronda 2771". Batería 47/47. APK publicada (nightly-2771, 24,5 MB) |
| 2772 | d47415e4 | Informe del dueño del 25-10 (espejo y encuadre de la videollamada, filtros del micrófono, mensajes y avisos con la pantalla apagada por Wi-Fi) y plan de negocio: ver "Ronda 2772". **Sin APK**: en GitHub la prueba nueva de videollamada (`videoframe.js`) no arrancó porque allí no estaba Playwright (Chromium); las demás pasaron (49/49 y Kotlin 71/71). Se instala Chromium en el paso de pruebas del workflow: todo pasa a la 2773 |
| 2773 | 36cf90b6 | La 2772 (ver "Ronda 2772": espejo y encuadre de la videollamada, filtros del micrófono, mensajes y avisos con la pantalla apagada) con Chromium instalado en las pruebas de GitHub. Batería 50/50 (también en GitHub, con la videollamada de verdad), Kotlin 71/71. APK publicada (nightly-2773, 24,5 MB; GitHub compiló el Kotlin nuevo y verificó la firma) |
| 2776 | 00317fe8 | Informe del dueño tras la 2775 (ver "Ronda 2776"): escaneo que no encontraba (REGRESIÓN de la 2774: el NEXO ID va en mayúsculas y la validación del anuncio solo aceptaba minúsculas), menú ⋮ de contactos que no hacía nada (regresión del estilo NEXO: quedaba fuera de pantalla), eco/ruido reforzados en el filtro propio (−18 dB + pistas del sistema al micrófono), avisos por internet con pantalla apagada (rxWake en NetBg), y elegir el tono de llamada/videollamada (selector del teléfono; por defecto el del dispositivo). Pruebas nuevas: `AdvertisedIdTest`. Batería 51/51, Kotlin 90/90, índice de robustez 41,8 (sin cambio: no añade escenarios a la batería). APK publicada (nightly-2776, 24,5 MB; firma verificada) |
| 2777 | b1772d66 | Auditoría fase 2 — C1 arreglado (ver "Ronda 2777" y `docs/AUDITORIA.md`): las confirmaciones (✓✓/leído) ahora van firmadas con un MAC derivado del secreto de la pareja (`e2eAckTag`), también en **modo cerrado** (el ack lo firma la capa nativa con una clave por contacto que le da la app por `setAckKeys`, solo en memoria del proceso, no a disco). Una confirmación falsa se ignora, así que ya no para los reintentos ni hace perder un mensaje con ✓✓. Solo para contactos modernos (proto 2); los antiguos sin cambios. Prueba nueva: `tests/sim/ackforge.js`. Batería 52/52, Kotlin 90/90, índice de robustez 42,1. ⚠️ Falta confirmarlo en los dos teléfonos del dueño. APK publicada (nightly-2777, 24,55 MB, sha256 4ba6e872…; firma verificada) |
| 2778 | 361fbcdf | Llamadas, informe del dueño (ver "Ronda 2778"): **menos ruido** (la puerta de ruido del micrófono pasa de −10 a −22 dB; cuando no detecta tu voz el micro queda al ~8 %, no a cero, y abre al instante al hablar: así el ruido de fondo casi no se transmite), **pantalla al entrar llamada** (MainActivity pide "mostrar sobre el bloqueo" y "encender pantalla" al nacer la actividad, solo si el intent es de llamada) y **contestar deslizando hacia arriba** (el toque sigue valiendo). Batería 52/52, Kotlin 90/90, índice 42,1. ⚠️ Pantalla y desliz: a confirmar en los dos teléfonos del dueño. APK publicada (nightly-2778, 24,55 MB, sha256 587f103c…; firma verificada) |
| 2779 | _(pendiente)_ | Alta por ID, pedido del dueño (ver "Ronda 2779"): **agregar a alguien que está lejos** con su NEXO ID (te lo pasa por WhatsApp). No hay servidor donde "buscar" un ID (eso rompería la privacidad); se le deja una **solicitud** en un buzón de los relés derivado de su ID, y él la **acepta o la elimina** (anti-spam). Al aceptar, se intercambian las claves y el canal seguro se enciende solo; la clave entra "sin verificar" (número de seguridad aparte). Interfaz: Perfil → "Compartir mi ID"; Agregar → "Agregar por NEXO ID" + bandeja de solicitudes. Prueba nueva: `tests/sim/reqadd.js`. Batería 53/53, Kotlin 90/90, índice 42,1. APK publicada (nightly-2779, 24,55 MB, sha256 ced36f24…; firma verificada) |
| 2780 | 8757bc03 | Fotos/archivos por internet, informe del dueño (ver "Ronda 2780"): estando lejos, al contacto le llegaba el texto pero no la foto. Antes un adjunto solo salía por internet con los dos en Wi-Fi (`filesOk`); ahora, bajo ~6 MB, va por **Tor directo/Wi-Fi si está en línea** o **al buzón de los relés si no** (`mailboxOk`), igual que los textos (`_maxB64For` sube el tope a ~6 MB por internet, pero **no** si hay camino local de archivos grandes: ahí manda L2CAP/Wi-Fi Direct, regla del dueño). Si un envío propio no sale en ~30 s o falla, en la burbuja sale **«Reintentar»**; y al volver el internet se reenvía solo (`net_link`→`_netOnline`→`resumeOutgoingTransfers`/`_resendPendingMessages`). Pruebas: `net.js` ampliado (foto por datos móviles y por buzón llegan; sin internet sale el botón y la foto se reenvía sola al volver). Batería 53/53, Kotlin 90/90 (sin cambios nativos), índice **41,4** (baja de 42,1 porque se registró en el catálogo el punto débil grave que reportó el dueño — con Wi-Fi bueno la app se pasa a «Internet» y no deja llamar, tarea #83/2781; no es regresión de la 2780). Archivos muy grandes por internet = fase 2 (Tor nativo). ⚠️ A confirmar en los teléfonos del dueño. APK publicada (nightly-2780, 24,55 MB, sha256 4b29da67…; firma verificada en CI) |
| 2781 | 8009b5a8 | Notas de voz, informe del dueño (ver "Ronda 2781"): (1) al empezar a grabar, o al entrar/empezar una llamada o videollamada, se **para la nota de voz que esté sonando** (antes seguía sonando y se grababa el altavoz); una sola suena a la vez. (2) **Pausar/reanudar** la grabación. (3) **Borrar** la grabación antes de enviarla. Barra de grabación con 🗑 borrar · tiempo · ⏸/▶ pausar · ➤ enviar (`voice.js`); el parón del audio lo coordina `render.js` (`_stopVoicePlayback`, por `window.__nexoStopVoice` y por el evento `nexo:call`). Prueba nueva `tests/sim/voicenote.js`. Batería 54/54, Kotlin 90/90 (sin cambios nativos), índice 41,7 (sube de 41,4: un modo más cubierto por prueba). ⚠️ A confirmar en los teléfonos del dueño. APK publicada (nightly-2781, 24,55 MB, sha256 f30bc75a…; firma verificada en CI) |
| 2782 | 6ffa223c | Editar un mensaje enviado, pedido del dueño (ver "Ronda 2782"): mantén pulsado tu mensaje de texto → **✏️ Editar** → cambias el texto → se actualiza en los dos con la etiqueta **"editado"**. Ventana 15 min, solo texto, cifrado, por el molde de "eliminar para todos" (`nexo_act` act:'edit'). `vaultEditMessage`; `_startEdit`/`_editForAll`/`_applyChatAction` en `chat_actions`; barra "Editando"; `_doSend` manda la edición si hay una en curso. Prueba: `chatactions.js` ampliado y **metido en la batería** (`ci.js`, tag CHATACT — también cubre responder/deslizar/copiar/reenviar/eliminar, que no estaban). Batería 55/55, Kotlin 90/90 (sin cambios nativos), índice 42,3 (sube de 41,7: la suite del chat entra en la batería). ⚠️ A confirmar en los teléfonos del dueño. APK publicada (nightly-2782, 24,55 MB, sha256 36241808…; firma verificada en CI) |
| 2783 | b68d57a6 | Reacciones, gestos, palomitas y micrófono, pedidos del dueño (ver "Ronda 2783"): (1) **reaccionar** a un mensaje — doble toque = ❤️, menú «Reaccionar» (👍❤️😂😮😢🙏), el otro la ve (`nexo_act` act:'react', cifrado). (2) **palomitas iguales** en todas las redes — antes «entregado» era UNA palomita (como «enviado») y solo «leído» dos, así que por Bluetooth (que se queda en entregado) se veía distinto que por internet (que llega a leído); ahora enviado ✓, entregado y leído ✓✓ (se distinguen por color). (3) **gestos** — deslizar la burbuja izq/der = responder, deslizar el chat abajo (arriba del todo) = cerrar, pellizco/arrastre/doble toque = ampliar la foto en el visor. (4) **micrófono**: silencio más profundo cuando no hay voz (gate −22→−34 dB, el micro al ~2 %; medido 34 dB). `vaultReactMessage`; `chat_actions` (reacciones + doble toque + deslizar en ambos sentidos); `render.js` dibuja reacciones; `file_card.js` pellizco; `chat_nav._setupPullToClose`; `call_voice_fx.js` gate. Pruebas: `palomitas.js` (tag PALOM) y `chatactions.js` ampliado (deslizar izq, reaccionar, deslizar abajo, zoom con pellizco/doble toque); `voicefx.js` umbral a ≥20 dB. Batería 56/56, Kotlin 90/90 (sin cambios nativos), índice **42** (baja 0,3 de 42,3: se registró como punto débil GRAVE el bug de la app cerrada que reportó el dueño — no es regresión). ⚠️ A confirmar en los teléfonos. El bug de **app cerrada** (#87) va en la siguiente (nativo, con diagnóstico). APK publicada (nightly-2783, 24,56 MB, sha256 72342d40…; firma verificada en CI) |
| 2784 | 795fb295 | Llamadas a pantalla completa, zoom, contactos y diagnóstico, informe del dueño (ver "Ronda 2784"), todo JS: (1) **#81** con la app cerrada la llamada entraba solo como aviso, sin Contestar/Rechazar a pantalla completa — en Android 14 el permiso `USE_FULL_SCREEN_INTENT` hay que pedirlo (no basta declararlo); ahora `main._askBackgroundOnce` lo pide proactivamente al arrancar (primero la exención de batería si falta, luego la pantalla completa), usando `alertSettings`/`openAlertSetting` que ya existían. (2) **Zoom de foto**: el arrastre se limita al borde (no se ve negro más allá). (3) **Franja de conectados sin parpadeo**: histéresis de 60 s (un cambio de conexión < 60 s no cuenta). (4) **«Copiar diagnóstico»** recorta la sesión a la última hora para que quepa. Prueba `alerts.js` ampliada (teléfono con batería ya concedida → pide la pantalla completa). Batería 56/56, Kotlin 90/90 (sin cambios nativos), índice **42**. ⚠️ A confirmar en los teléfonos. Pendiente, y prioridad, el núcleo del **#87** (que los mensajes lleguen con la app cerrada): nativo, necesita el diagnóstico de los dos teléfonos. APK publicada (nightly-2784, ~24,5 MB; firma verificada en CI) |
| 2785 | d035ae7b | Las dos prioridades del dueño, NATIVO (ver "Ronda 2785"): **#1** la llamada entrante usa `NotificationCompat.CallStyle` de verdad (pantalla de llamada real con Contestar/Rechazar grandes; antes Samsung/Android 14 la bajaban a aviso pequeño), con repliegue a aviso normal si fallara. **#87** (mensajes con la app cerrada): WifiLock (FULL_HIGH_PERF) mientras NetBg escucha en segundo plano/cerrada (Android duerme la radio Wi-Fi con la pantalla apagada y tira el socket del relé) + **registro nativo persistente** (`NativeLog`) que ahora SÍ aparece en «Copiar diagnóstico» (antes se armaba en el WebView, muerto con la app cerrada, y el hueco salía vacío). Batería 56/56, Kotlin 95/95 (+5 `NativeLogTest`), índice 42. #87 sigue ABIERTO hasta confirmarlo en los dos teléfonos con el nuevo diagnóstico. APK publicada (nightly-2785, 24,56 MB, sha256 b2c9fb16…; firma verificada en CI) |
| 2786 | a46f0673 | Archivos grandes por internet, informe del dueño (ver "Ronda 2786"): «que permita el envío de archivos grandes cuando hay internet; otra vez no mandó nada ni avisó si es por dimensiones». El transporte ya troceaba cualquier tamaño (16 KB/evento); el bloqueo estaba solo en el tope de la interfaz. Ahora el tope por internet es **según el camino** (`_torDirect` en `media_limits.js`, mira `net.via()==='tor'`): por **Tor directo** (socket .onion P2P, sin el tope de 64 KB por evento) los grandes **salen por internet** hasta ~22 MB (`NET_TOR_MAX_B64_BYTES`, como Wi-Fi Direct); por los **relés** se quedan los medianos ~6 MB (cientos de eventos pequeños saturan los relés públicos). Sigue yendo antes el camino LOCAL de archivos grandes (regla del dueño). Clave: **nunca más «no manda nada ni avisa»** — si un archivo no cabe por el camino de ahora, aviso claro y accionable (tope + activar Tor en Perfil / mismo Wi-Fi / Wi-Fi Direct / cerca, hasta 1 GB); además el **vídeo** que no se podía preparar antes fallaba en silencio y ahora avisa. Pruebas nuevas `tests/sim/bignet.js` (relés y Tor) en la batería (tag BIGNET). Batería 58/58, Kotlin 95/95 (sin cambios nativos), índice **42,1**. ⚠️ A confirmar en los teléfonos del dueño. APK publicada (nightly-2786, 24,56 MB, sha256 5dbd6f6e…; firma verificada en CI) |
| 2787 | 69262951 | Pagos Fase 1 — «Cobros» en el chat (ver "Ronda 2787"). El dueño pidió avanzar los pendientes «todos, uno a la vez, del más rápido al más complejo»: el primero, pagos. Regla legal (`docs/PAGOS_PROPUESTA.md`): lo que exige licencia es **custodiar** el dinero; si NEXO nunca toca fondos, es **«mensajería de cobros»** (como una factura), sin licencia ni servidor. Nuevo botón **💵 Cobro** en el menú de adjuntar → hoja con importe, moneda, concepto y «cómo te pagan» (alias/CBU, `PayPal.me`, Mercado Pago, efectivo; se recuerdan). Viaja **cifrado** como cualquier mensaje (Bluetooth/Wi-Fi/Jump/internet); tarjeta en el chat con **«Copiar datos»** y **«Abrir enlace»**. Es un tipo de mensaje más (como la ubicación): `src/ui/cobro.js` (`_handleCobro`/`_sendCobro`/`_renderCobroCard`), `index.html` (item), `app_setup.js` (cablea), `main.js` (pegamento `cobroUse`), `render.js` (rama `'cobro'`). Escapa concepto/método (vienen del otro teléfono). Prueba `tests/sim/cobro.js` en la batería (tag COBRO): llega con importe/concepto/método, tarjeta en los dos, sin inyección de HTML. Batería **59/59**, Kotlin 95/95 (sin cambios nativos), índice **42,1** (funcionalidad nueva, no un modo de fallo del catálogo). Pendiente antes de la tienda: borrar el prototipo MUERTO de `payment`/`transfer` en `src/app/nexo_app.js` (sin UI que lo dispare). ⚠️ A confirmar en los teléfonos del dueño. APK publicada (nightly-2787, 24,56 MB, sha256 72805a55…; firma verificada en CI) |
| 2788 | addb7709 | Auditoría F9 — solo relés cifrados (ver "Ronda 2788"). Segundo del plan del dueño «todos, uno a la vez». NEXO aceptaba relés de internet **en claro** (`ws://`); por uno en claro un espía de la red vería las **etiquetas de tu suscripción** (las `p` de tu buzón) y podría ligarte a tus contactos. Ahora `net_link.js` `relayUrls()` + `_relaySafe`: solo **`wss://`**; `ws://` solo a **loopback** (localhost/127.0.0.1, pruebas o relé propio), nunca a un host remoto; si por error todos fueran en claro, cae a los `wss://` por defecto (nunca sin internet por esto). Los relés por defecto ya eran `wss://` → para el dueño no cambia nada salvo que ya no se puede configurar uno inseguro. Prueba `tests/sim/relaytls.js` (tag RELAYTLS): lista mezclada → se queda con wss + loopback, descarta el ws remoto, deja el aviso. Los de más riesgo (M5/M6 autenticar control, H3/H4) tocan el núcleo del protocolo (enlaces/nombres/sincronización) y solo se verifican en el simulador → se dejan para hacerlos con cuidado y que el dueño los pruebe en los teléfonos. Batería **60/60**, Kotlin 95/95 (sin cambios nativos), índice **42,5** (sube de 42,1: F9 cerrado + cubierto por prueba). ⚠️ **La APK de la 2788 NO se publicó**: el job «tests» de CI falló por un flake de `misroute.js` (conectaba a relés públicos reales; causa raíz y arreglo en la 2789). El código F9 sí quedó en `NEXOCHAT` y viaja en la APK de la 2789 |
| 2789 | b900598e | Dos detalles del dueño + 1er intento (insuficiente) de arreglar el flake que tumbó la APK de la 2788 (ver "Ronda 2789"). (1) **Palomitas** (regresión mía de la 2783): «entregado» y «leído» eran los dos ✓✓ y el color de «entregado» (#cdd9e5) se parecía al de «leído» → no se distinguían; la LÓGICA estaba bien, era el color. Ahora enviado ✓ gris · **entregado ✓✓ gris (#8696a0)** · **leído ✓✓ azul (#00d4ff) con brillo**, como WhatsApp (`nexo_theme.css`, `critical.css`). (2) **Pantalla que se encendía con cada mensaje** (regresión mía de la 2765): `wakeOnMsg()` por defecto pasa a **false** → un mensaje solo postea la notificación (la muestra el sistema sin forzar el brillo); quien lo quiera lo activa en Perfil; las **llamadas** siguen encendiendo la pantalla (`MsgNotifier.kt`). (3) **Flake de CI que tumbó la 2788**: `misroute.js` (prueba de enrutado BLE/Jump, sin internet) no aislaba la red — jsdom trae `WebSocket` y `relayUrls()` caía a relés públicos reales; en CI conectaban y el archivo «ausente» volvía «entregado». Intenté arreglarlo con un stub de `WebSocket` en `misroute.js` → pero fue **insuficiente**: otra prueba volvió a conectar a relés reales y **la APK 2789 TAMPOCO se publicó** (ver 2790 para la causa raíz y el arreglo definitivo). La 2789 lleva además el código F9 de la 2788. Batería **60/60**, índice **42,5**. ⚠️ APK NO publicada (el código va en la 2790) |
| 2790 | 89bbc107 | Arreglo de RAÍZ que impedía publicar las APK 2788 y 2789 (ver "Ronda 2790"). Causa única: el cambio F9 de la 2788 dejó `relayUrls()` con `return safe.length ? safe : DEFAULT_RELAYS`, y como el simulador marca «sin internet» con `NEXO_NET_RELAYS=[]`, esa lista vacía (tras filtrar) **caía a los relés PÚBLICOS reales** (`wss://relay.damus.io…`). En CI (con internet) varias pruebas se conectaban de verdad → resultado al azar → el job «tests» fallaba y no se construía la APK. En local no se veía (el sandbox no alcanza esos relés), por eso 2786/2787 (sin F9) pasaban y 2788/2789 (con F9) fallaban. **Arreglo** (`net_link.js`): una lista vacía explícita significa «sin relés» (se respeta); se mantiene F9 (una lista solo-en-claro cae a los `wss://` por defecto); sin configurar (producción) usa los relés por defecto, sin cambio. Revertido el stub de `misroute.js`; `relaytls.js` gana aserciones que fijan esto para siempre (lista vacía→sin relés; solo-en-claro→wss://). Esta build lleva **TODO lo de la 2789** (palomitas, pantalla) + el código F9 de la 2788, que por fin se publica. Batería **60/60**, índice **42,5** (sin cambio: arreglo de prueba). El ○+«Reintentar» y el #87 no se reproducen en el simulador → a la espera del diagnóstico del dueño. ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2790, `nexo-nightly-2790-89bbc10.apk`, 24,56 MB, sha256 7616419f…; firma verificada en CI) |
| 2791 | 6d2a7d8e | Dos detalles de interfaz del dueño (ver "Ronda 2791"). (1) **Barra de adjuntar**: con 6 iconos (se añadió «Cobro» en la 2787) la fila se salía de la pantalla y el último quedaba cortado. Ahora `nexo_theme.css`: iconos más pequeños (item 64→50 px, svg 50→40 px), el menú no pasa del ancho de la pantalla (`max-width:calc(100vw - 24px)`) y los iconos **saltan de línea** si no caben (`flex-wrap`). Al item Cobro le faltaba fondo y etiqueta (quedó a medias en la 2787): ahora círculo teal (#14b8a6) + «Cobro». (2) **Tarjeta de Cobro** en el chat: tenía un borde verde grueso y se veía «enmarcada»; ahora igual que la de Ubicación (`cobro.js`): radio 12px, fondo sutil `rgba(0,0,0,0.3)`, **sin borde**, max 260px; el verde queda en el 💵/texto/botones. Solo interfaz (CSS/HTML). Batería **60/60**, índice **42,5** (sin lógica nueva). En revisión (reportados por el dueño, para la 2792): **APK grande por internet** no avisa ni se manda (el camino de archivos grandes es local; por internet el tope real es ~6 MB relés / ~22 MB Tor — falta diagnóstico del dueño para separar «selector devuelve size 0» de «archivo grande que no cabe por internet») y **crear grupo con un contacto en línea** (investigando). ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2791, `nexo-nightly-2791-6d2a7d8.apk`, 24,56 MB, sha256 88bb2359…; firma verificada en CI) |
| 2792 | 1fb4c5f2 | Detalles del dueño, con su diagnóstico en mano (ver "Ronda 2792"). (1) **Crear grupo**: el botón no se habilitaba «como si faltara algo» — pedía nombre + 1 contacto pero no decía cuál faltaba. Ahora el texto del botón lo dice: «Elige al menos un contacto» → «Escribe un nombre del grupo» → «Crear grupo (N personas)» (`groups_ui.js`). (Los contactos del dueño tienen ID nx limpio → sí aparecen en la hoja; el problema era solo el botón mudo, no el filtro.) (2) **Aviso de archivo grande**: al elegir una APK grande el aviso «demasiado grande para internet…» salía 4 s, justo al cerrarse el selector → se perdía. El diagnóstico confirmó que el aviso SÍ se disparaba (`[ATTACH] Archivo demasiado grande: 24559074`). Ahora `_showPermissionError` acepta duración y el aviso de archivo dura 8 s (`ui_bits.js`, `pickers.js`). Solo interfaz. Batería **60/60**, índice **42,5** (sin lógica nueva). El diagnóstico aclaró lo demás: llamadas/videollamadas van con el contacto CERCA (hubo una videollamada real de 17 s) pero no por internet (prioridad #3); la APK de 23 MB no cabe por internet (#2); el ○+«Reintentar» es el Bluetooth inestable con ese contacto (MTU 23) = nativo, aparte. ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2792, `nexo-nightly-2792-1fb4c5f.apk`, 24,56 MB, sha256 82d97559…; firma verificada en CI) |
| 2793 | 9551de18 | Rápidos del dueño (lista «a la par», ver "Ronda 2793"). (1) **Autocorrecto** activado: el campo de mensaje tenía `spellcheck="false"` + `autocomplete="off"` (los apagaba); ahora `spellcheck="true"`, `autocorrect="on"`, `autocapitalize="sentences"` → el teclado de Android corrige/capitaliza/sugiere (`index.html`). (2) **Moneda del «Cobro» automática por país**: antes arrancaba fija en ARS; ahora `_defaultMoneda()` detecta el país por el idioma/región del teléfono (es-MX→MXN…) como valor inicial; si el dueño elige otra, se recuerda (`cobro.js`). Solo interfaz. Batería **60/60**, índice **42,5**. Siguiente rápido: buscar dentro del chat. ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2793, `nexo-nightly-2793-9551de1.apk`, 24,56 MB, sha256 c7d4d992…; firma verificada en CI) |
| 2794 | 3b45573c | Último rápido de la lista «a la par» (ver "Ronda 2794"): **buscar dentro del chat**. WhatsApp/Telegram/Signal lo tienen; NEXO no lo tenía. Una **lupa 🔍** en la cabecera del chat abre una **barra de búsqueda DEBAJO** (sin amontonar botones): al teclear **oculta las burbujas que no coinciden**, **resalta las que sí** (propias y recibidas) y muestra **cuántas coinciden**; insensible a mayúsculas; vaciar o cerrar (✕/Escape) restaura todo; al abrir/cerrar un chat se resetea sola. Se ve también en los **grupos** (a diferencia de llamar/videollamar). No toca almacenamiento ni envío: solo muestra/oculta burbujas ya pintadas en `#messages-container`. Nuevo módulo `src/ui/search_ui.js` (`installSearchUi`), cableado en `main.js`; CSS de `.msg-search-hidden`/`.msg-search-hit` y del botón en `nexo_theme.css`. Prueba nueva `tests/sim/search.js` en la batería (tag SEARCH). Solo interfaz. Batería **61/61**, índice **42,5** (funcionalidad nueva, no un modo de fallo del catálogo). Con esto quedan **completos los 3 rápidos**; sigue **(2) internet de verdad** (#2 archivos grandes por Tor → #3 videollamada por internet). ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2794, `nexo-nightly-2794-3b45573.apk`, 24,56 MB, sha256 6c8de6b5…; firma verificada en CI) |
| 2795 | 9f9059e5 | **Fotos de una sola vista («ver una vez», #94)**, pedido del dueño; primer pendiente del trabajo autónomo (el dueño: «no pares hasta terminar»). Como WhatsApp: en la revisión de la cámara un botón **👁** marca la FOTO para verse una vez. El receptor ve «**Toca para ver · una vez**» (sin previa); al abrirla, el medio se **CONSUME de verdad** y no se puede reabrir. Privacidad: `vaultConsumeOnceMessage` borra payload, `attachmentRef` (y el blob del disco) y **también `content`** (podía llevar el payload como JSON y lo resucitaría al reabrir), y marca `onceSeen`; una retransmisión no revive el medio (guarda en `_appendMessageNow`). El emisor ve «Foto de una vez · enviada» (sin previa). El flag viaja en el **chunk-0** del protocolo de archivo (`o1` en `ble_ack.js`, emisor y receptor) → llega como `attachmentMeta.once`; `render.js` dibuja la burbuja (3 estados) y reconstruye el adjunto consumido desde el tipo + `meta.once` para mostrar «Abierta» al reabrir. **v1 solo FOTOS** (el vídeo de una vez queda para más adelante: su mejora HD/preview podría revivir el medio; el toggle se oculta en vídeo). Prueba nueva `tests/sim/once.js` (tag ONCE); `NEXO_sendAttachment` expuesto para la prueba (como `NEXO_sendVideo`). Solo interfaz + vault. Batería **62/62**, índice **42,5** (funcionalidad nueva, no un modo de fallo del catálogo). La APK rebotó una vez por un **flake de tiempos en un test Kotlin** (`AtRestStoreTest.migrarArchivoGrandeNoBloqueaOtros`, sin relación con el cambio; re-ejecutado el CI → verde). ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2795, `nexo-nightly-2795-9f9059e.apk`, 24,56 MB, sha256 d2e3c21a…; firma verificada en CI) |
| 2796 | 195eaec4 | **Limpieza: borrado el prototipo MUERTO de pagos/transferencias** de `src/app/nexo_app.js` (pendiente «antes de la tienda»). Quitado el viejo sistema `payment`/`transfer` (flags del constructor, `_setupPaymentListeners`, `_sendPayment`, `_showPaymentModal` —con bug: usaba `self` sin definir—, `_respondToPayment`, `_handlePaymentResponse`, `_sendTransfer`, `_renderMessage`, `_renderPaymentBubble`, `_signPayment` con «firma» inventada). No tenía UI que lo disparara (nada emitía `nexo:payment:*`) y todas las referencias eran internas al archivo; los cobros reales son el adjunto 💵 Cobro (`cobro.js`, sin custodia ni licencia). Se conservan las partes vivas (`sendMessage` de respaldo, `_handleACK`, listeners BLE/vault). Solo borrado de código muerto, sin cambio de comportamiento. Batería **62/62**, Kotlin sin cambios, índice **42,5**. APK publicada (nightly-2796, `nexo-nightly-2796-195eaec.apk`, 24,56 MB, sha256 40e4fe02…; firma verificada en CI) |
| 2797 | bd2ebce9 | **Contacto: tocar la FOTO la abre grande, tocar el NOMBRE entra al chat** (#100, pedido del dueño). En la lista, el avatar recibe su propio toque: con foto → visor a tamaño grande (`__nexoOpenMedia`); sin foto → el toque cae a la fila y abre el chat. El nombre/resto de la fila entra al chat como siempre (`ble_ui.js`: importa `avatarOf`, `stopPropagation` solo cuando hay foto). Prueba nueva `tests/sim/photo_tap.js` (tag PHOTOTAP): sin foto→chat, con foto→visor, nombre→chat. **Además, robustez de CI**: estabilizado el flake de tiempos `AtRestStoreTest.migrarArchivoGrandeNoBloqueaOtros` (tumbó la APK 2795): la ventana de la migración pasa de 1,5 s a 4 s para que los 40 guardados cifrados quepan en un runner lento; la propiedad real sigue cubierta por `esperaMax<1000`; test-only, no cambia la APK. Solo interfaz. Batería **63/63**, índice **42,5**. ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2797, `nexo-nightly-2797-bd2ebce.apk`, 24,56 MB, sha256 998d42a8…; el flake Kotlin NO reapareció — el arreglo de la ventana funcionó; firma verificada en CI) |
| 2798 | 249f2737 | **Aviso de mala señal (#102, pedido del dueño)**: su diagnóstico mostró «Bluetooth muy lento» (MTU 23). En el subtítulo del chat, cuando el enlace es Bluetooth y el MTU del enlace activo quedó pequeño (<60, p. ej. 23 sin negociar), se añade «· ⚠ señal débil» para que entienda por qué va lento (no es un fallo: es la radio de ese par de teléfonos). `main.js _refreshLinkSubtitle` usa `bi.getMtu(bi._activeChatDeviceId)`. Prueba nueva `tests/sim/malasenal.js` (tag MALASENAL): MTU 23 → avisa, MTU 247 → no. Solo interfaz. Batería **64/64**, índice **42,5**. ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2798, `nexo-nightly-2798-249f273.apk`, 24,56 MB, sha256 43af9213…; firma verificada en CI) |
| 2799 | e667d58b | **Stream fase 1 — Estados tipo WhatsApp entre contactos** (#104, pedido del dueño «stream empezamos con cercanos»). Un ESTADO es **texto** con caducidad **24 h**, privado **ENTRE CONTACTOS** (no público) y **cifrado de extremo a extremo**. Viaja por lo que ya hay (Bluetooth/Wi-Fi/Jump/internet) como **acción oculta del chat** (`{type:'nexo_act', act:'st', t, ts}` por `_sendTextTo(nx, …, true)`): **sin mensaje visible ni «no leído»**; la copia oculta se borra al entregarse (ackStatus). `src/ui/estados.js` (nuevo, modelado en `avatar.js`): mi estado en `nexo_my_status.json`, el de cada contacto en `nexo_status_<NEXO ID>.json`; reparto a cada contacto al publicar y al conectar (`peerReady`, 4 s); caduca a 24 h (no muestra ni guarda lo vencido); texto acotado a 280 car. al enviar **y al recibir**; solo NEXO IDs válidos; dedup por `ts` ya enviado. Interfaz: **tira «Estados»** arriba de la lista de contactos (chip «Mi estado» + un círculo por contacto con estado activo), componer (Publicar/Quitar) y ver; texto escapado al mostrar. Recibir: `chat_actions.js` despacha `act:'st'` a `applyStatus`; arranque: `main.js` llama `estadosInit()` tras `avatarInit()`. Fase 1 solo texto; foto/clip de estado para más adelante. Prueba nueva `tests/sim/estados.js` (tag ESTADOS): A publica → llega a B y se guarda sin mensaje visible; la tira muestra a A y al tocarlo se ve el texto; B publica **por la interfaz** y le llega a A; un estado de 25 h está caducado y uno fresco sí; A lo quita y B deja de verlo; sin errores de descifrado. Solo interfaz + acción oculta del chat. Batería **65/65**, índice **42,5** (funcionalidad nueva, no un modo de fallo del catálogo). ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2799, `nexo-nightly-2799-e667d58.apk`, 24,56 MB, sha256 c53f30e3…; firma verificada en CI) |
| 2800 | 92e8100a | **Auditoría de robustez (#106, pedido del dueño «verificar robustez y fallas»)**: repaso de la superficie NUEVA de la madrugada (2794–2799) con el modelo de amenazas + una revisión adversarial independiente. Batería de ataque/caos VERDE en la 2799 (`spoof`, `ackforge`, `groupforge`, `misroute`, `relaytls`). **Dos fallas reales, alcanzables, arregladas y REPRODUCIDAS** en `tests/sim`: (1) **ALTA — la foto «de una vez» ya abierta REVIVÍA al retransmitirse** el mismo `msgId`: al consumir se borraba `content` (que por relé/internet lleva el payload como JSON) pero el *merge* de una retransmisión en `vault_manager._appendMessageNow` solo anulaba `attachmentPayload`/`ref`/`hd`, NO `content`; el reenvío del emisor al reconectar (su registro saliente no se borra, #12) devolvía ese `content` y `render.js` **volvía a mostrar la foto** (y la reescribía a disco) — rompía la privacidad del #94. Arreglo: el guard de `onceSeen` iguala al borrado de consumir (`content`/`text`='', payload/ref/hd=null, `attachmentMeta.once` forzado → burbuja «Abierta»). `tests/sim/once.js` cubre la retransmisión; confirmado que SIN el arreglo falla. (2) **MEDIA — un Estado (Stream) con fecha futura no caducaba** (`estados.applyStatus` aceptaba el `ts` del otro con solo `>0`): se acota a «ahora» (`Math.min`); `tests/sim/estados.js` (`futuro_acotado`). Resto de la superficie nueva (search_ui, avatar de ble_ui, parse de `o1`, mala señal) revisada sin hallazgos. Los dos modos entran en `robustez.json` (área auditoría) con su prueba; ver `docs/AUDITORIA.md` §3bis. Batería **65/65**, índice **42,5**. ⚠️ A confirmar en los teléfonos. APK publicada (nightly-2800, `nexo-nightly-2800-92e8100.apk`, 24,56 MB, sha256 0f21cecf…; firma verificada en CI) |
| 2801 | 42659df2 | **Guardar foto/vídeo en la GALERÍA** (#92, pedido del dueño; 1.º de los 3 nativos de la mañana). [Nativo] `NexoBlePlugin.saveToGallery(base64,name,mime)`: API 29+ por **MediaStore** (RELATIVE_PATH Pictures/Movies/Download + subcarpeta `NEXO`, IS_PENDING; **sin pedir permiso**, almacenamiento acotado); API 26-28 por carpeta pública + MediaScanner. Nunca lanza (`{saved:true}`/`{saved:false,reason}`). Interfaz: el **visor a pantalla completa** gana un botón **⬇ «Guardar en galería»** (`file_card.js`) que saca los bytes del `data:` URL (foto) o del `blob:` URL (vídeo, por `fetch`) y llama al nativo, con aviso del resultado. **NO aparece en «ver una vez»** (`noSave`): esas fotos se consumen, no se guardan. Prueba nueva `tests/sim/savegallery.js` (tag SAVEGAL): el visor normal muestra el botón y llama al nativo con base64/nombre/mime correctos; el de «ver una vez» no. Batería **66/66**, índice **42,5**. Kotlin verificado por compilación en CI (sin SDK local); **el guardado real en MediaStore se confirma en el teléfono**. APK publicada (nightly-2801, `nexo-nightly-2801-42659df.apk`, 24,56 MB, sha256 0303818328…; firma verificada en CI) |
| 2802 | 5c5b9b28 | **El «atrás» de Android cierra el chat/overlay, no sale de la app** (#101, pedido del dueño; 2.º de los 3 nativos de la mañana). [Nativo] `MainActivity.onBackPressed` pregunta al WebView por `window.__nexoHandleBack()`: si lo manejó (1) no hace nada; si no (0), comportamiento normal de Capacitor (re-entrada con bandera para llamar a `super` desde el callback asíncrono de `evaluateJavascript`). JS (`chat_nav.js`): cierra EN ORDEN el visor de foto/vídeo → overlay de Estados → cámara (con su limpieza) → chat abierto (`_doChatBack`); con nada abierto devuelve false. Closers expuestos: `__nexoCloseMedia` (file_card), `__nexoHideCamera` (camera). Así deslizar-atrás o el botón cierran el chat/overlay en vez de salir de golpe (antes el swipe propio solo valía dentro de la app; el gesto del sistema salía). Prueba nueva `tests/sim/backbtn.js` (tag BACKBTN): orden de cierre, un overlay se cierra antes que el chat, sin nada abierto da false. Batería **67/67**, índice **42,5**. Kotlin/Java verificado por compilación en CI; **el gesto/botón real se confirma en el teléfono**. APK publicada (nightly-2802, `nexo-nightly-2802-5c5b9b2.apk`, 24,56 MB, sha256 e3ab7a635e…; firma verificada en CI) |
| 2803 | 66f626c4 | **Face ID OPCIONAL — desbloqueo rápido por rostro (menos seguro), el usuario decide** (#103, pedido del dueño: «dejalo opcional que el user decida, agregá Face ID»; 3.º de los 3 nativos de la mañana). [Nativo] El bloqueo de NEXO (`biometricAuth`/`biometricStatus` en NexoBlePlugin) ya era una **puerta de presencia** (ok/no ok), no cifra nada. Por defecto exige biometría **FUERTE** (Clase 3) en API 30+, que en muchos teléfonos deja fuera el ROSTRO (Clase 2, se engaña con una foto) y solo ofrece la huella. Ajuste nuevo en Perfil → Seguridad: **«Desbloqueo rápido por rostro (menos seguro)»**; al activarlo, `biometricAuthenticators(allowWeak)` permite `BIOMETRIC_WEAK` y el rostro Clase 2 también desbloquea. **Default sigue fuerte**; sin Keystore ni cambio del cifrado en reposo. `app_lock.js`: pref `faceFast`, pasa `allowWeak` a las dos llamadas nativas, toggle visible solo con el bloqueo activo. Prueba: `tests/sim/lock.js` ampliado (paso 12): el toggle aparece, por defecto `allowWeak=false`, al activarlo `allowWeak=true` llega al nativo y se guarda, se puede quitar. Batería **67/67** (lock.js es prueba aparte, no en la batería). Kotlin compila en CI; **el rostro real se confirma en el teléfono**. APK publicada (nightly-2803, `nexo-nightly-2803-66f626c.apk`, 24,56 MB, sha256 a426164049…; firma verificada en CI) |
| 2804 | 16298846 | **Auditoría destructiva (pedido del dueño «pruebas destructivas»), hallazgo ALTO: DoS por trozo BLE con «n» disparatado.** Un teléfono a **alcance Bluetooth, sin cifrar y sin ser contacto**, escribía en el servidor GATT un trozo de chat/archivo con el total de trozos enorme (p.ej. 2.000.000.000); `_handleIncomingChunk` solo validaba `total>0`/`idx<total` → creaba el búfer y recorría `for(i<total)` en `_sendBlockAck` (y el array de huecos de L557) → miles de millones de iteraciones en el hilo principal → **congelación/ANR**. Arreglo (`ble_ack.js`): `const MAX_CHUNKS=300000` + `if(total>MAX_CHUNKS) return;` tras la validación (el mensaje real mayor, `BLE_HD_MAX_CHARS`, son ~158k trozos → el doble de margen; como `idx<total`, acota también el array de huecos). Reproducido en `tests/sim/chunkdos.js` (antes FALLA: búfer de 2e9 + block-ack/NACK gigantes; después OK) y metido en la batería (tag CHUNKDOS) → 67→**68**. Índice **43,7**. Ver `AUDITORIA.md` §3ter. APK publicada (nightly-2804, `nexo-nightly-2804-1629884.apk`, 24,56 MB, sha256 97c2664a…; firma verificada en CI). ⚠️ El ANR real se confirma en el teléfono |
| 2805 | 87f754dd | **Auditoría destructiva, 2.ª pasada (defensa en profundidad): 2 hallazgos LEVES de la misma clase «número del atacante → bucle sin tope».** (1) `vault_manager` (`vaultCreateTransfer`/`vaultAppendChunk`): el bucle `for i<totalChunks` + `join` construía un array/cadena de miles de millones; **hoy es código muerto** (expuesto en `window.*` sin llamador en `src/`: el reensamblado entrante vive en `ble_ack.js`), se acota igual (tope 300000) y `chunkdos.js` también lo vigila. (2) `share_contacts._renderContactCard` / `ble_contacts.addSharedContacts`: una tarjeta de contactos compartida (POST-E2E, de un contacto) con una lista enorme dibujaba millones de nodos del DOM → congelación; acotado a 500. Resto de superficies de entrada (QR, Estados, sobres E2E, ratchet, Fénix, LAN, net_link, llamadas, grupos) revisadas y acotadas (ver `AUDITORIA.md` §3ter). Batería **68/68**, índice **43,4**. APK publicada (nightly-2805, `nexo-nightly-2805-87f754d.apk`, 24,56 MB, sha256 8d8b5bca…; firma verificada en CI). ⚠️ A confirmar en el teléfono |
| iOS Fase 0 | af20be5e (rama trabajo) | **iOS Fase 0: el proyecto iOS + el plugin Swift COMPILAN en el CI macOS** (meta del dueño «que la app corra en iPhone»). `@capacitor/ios` 5.7.8 + `npx cap add ios`; plugin Swift `NexoBlePlugin` (archivos, Face ID, galería, Data Protection REALES; Bluetooth STUB → Fase 2). Arreglado el `npm install` incompleto en macOS (webpack caía por caniuse-lite) y un uso de `.limited` (iOS 14) con objetivo iOS 13; y un bug del propio workflow que daba falso verde. **Confirmado: build-ios run #5 (head af20be5e) = BUILD SUCCEEDED, xcodebuild exit 0.** Solo en la rama de trabajo `claude/repo-file-access-9bwl60`; NO toca Android. Falta: Bluetooth real (Fase 2, rediseñar descubrimiento — iOS no permite manufacturer data) y cuenta Apple para instalar en un iPhone real (TestFlight). Ver `docs/IOS_PROPUESTA.md` |
| 2806 | d0f45bac | **Juego secreto «Defensor NEXO» — mini-arcade oculto (pedido del dueño) + gesto de la «N» en Ajustes.** En la pantalla de Ajustes (Perfil) se dibuja la **«N» de NEXO** con el dedo (`attachNexoUnlockGesture`, pasivo: no estorba al scroll ni a los botones) y se abre un mini-juego tipo arcade que representa a NEXO (`src/ui/nexo_game.js`, **defensivo**: sin Canvas no arranca, así la batería en jsdom no revienta): la nave se desplaza, caen **amenazas** (meteoros) que destruir (+10) y **mejoras** de disparo (más rápido / triple 8 s), y aparecen **contactos** a los que alcanzar y **salvar** (+25); 3 vidas, disparo automático, **clasificación** (top 10) en `localStorage`. Reconocedor `__recognizeN` (3 tercios por longitud de arco) tolerante que rechaza recta/diagonal/trazo corto. Prueba nueva `tests/sim/juego.js` (tag JUEGO, en la batería): reconocedor, clasificación que se ordena y persiste, abre/cierra el overlay sin reventar (sin Canvas), gesto cableado en Ajustes. Batería **69/69**, sin errores. El juego real (nave, meteoros, dibujo del gesto) se ve en el teléfono. APK publicada (`nightly-2806`, `nexo-nightly-2806-d0f45ba.apk`, 24,56 MB, sha256 b6a5552b…; firma verificada en CI). ⚠️ A confirmar en el teléfono |
| 2807 | 7121caf0 | **Perfil y Ajustes separados (pedido del dueño «organizar bien mi perfil con el menú ajustes») + el gesto secreto de la «N» pasa a Ajustes.** Hasta ahora una sola hoja «Perfil» mezclaba la identidad con TODOS los ajustes. Ahora **Perfil** = identidad (foto, NEXO ID, cómo te ven, compartir ID) + botón grande **⚙️ Ajustes**; y **Ajustes** = tu cuenta (Fénix, cambiar de teléfono), Seguridad, Avisos con la pantalla apagada, Videollamadas, Tono, Internet y Diagnóstico. Una sola hoja a la vez (Ajustes reemplaza a Perfil; «‹ Perfil» la vuelve a abrir; «Cerrar» vuelve a la app). `profile.js` se parte en `_openProfileSheet`/`_openSettingsSheet` (este con `attachNexoUnlockGesture`), evento `nexo:ui:settings` + `window.__nexoOpenSettings`; `nexo_theme.css` cubre también `#nexo-settings-sheet`. Se conservan TODOS los manejadores. Pruebas actualizadas al nuevo sitio (abrir Ajustes con ⚙️ antes de tocarlos): `juego.js` (Perfil abre, Ajustes abre, gesto en Ajustes y NO en Perfil), `alerts.js`, `lock.js`, `fenix.js`, `browser.js`. Batería **69/69**. Solo interfaz web (WebView); nada nativo. APK publicada (`nightly-2807`, `nexo-nightly-2807-7121caf.apk`, 24,56 MB, sha256 ba791723…; firma verificada en CI). ⚠️ A confirmar en el teléfono |
| 2808 | dba578ae | **Rendimiento de NEXO — medir y mostrar lo REAL (pedido del dueño «rendimiento api de nexo»).** Nueva sección **⚡ Rendimiento** en Ajustes, en vivo y de la sesión: **latencia** (ping ida y vuelta, mediana+p95; reusa el RTT que el supervisor YA mide), **contactos en línea**, **mensajes entregados** (enviados/entregados + tasa %), **tiempo de confirmación de entrega** (ida y vuelta del ✓✓) y **tiempo de transferencia** de archivos. **Pasivo por diseño** (`src/ui/perf.js`): escucha eventos que la app ya emite (`nexo:ble:ackStatus`, `nexo:ble:fileProgress`) y lee `bleInterface._supervisorStates`; NO toca el núcleo salvo UNA línea en `ble_messages.js` que registra cada RTT ya medido. Todo en memoria, de la sesión; nada se guarda ni se envía. `initPerf()` en `main.js`; tarjeta en Ajustes (`profile.js`). Prueba nueva `tests/sim/perfmetrics.js` (tag PERF): un mensaje real A→B se cuenta y se cronometra (el BLE directo emite `sending→delivered`), el RTT entra en el resumen, la transferencia se cronometra, el panel se dibuja sin «undefined». Batería **70/70**. APK publicada (`nightly-2808`, `nexo-nightly-2808-dba578a.apk`, 24,57 MB, sha256 65403466…; firma verificada en CI). ⚠️ A confirmar en el teléfono |
| 2809 | 35d9972b | **Auditoría P0-4 (XSS) — el contenido del remitente se pinta como TEXTO, nunca como HTML.** Revisado todo el camino de pintado: la app ya usa `textContent` en todas las superficies con datos del otro teléfono (cuerpo del mensaje `_fillTextBubble`, nombre del remitente, nombres de contacto, cita de respuesta; la ubicación solo mete números), ninguna usa `innerHTML` con datos del remitente. No hacía falta tocar el pintado; se deja un vigilante y se endurece la CSP. Prueba nueva `tests/sim/xss.js` (tag XSS): 5 cargas típicas (`<img onerror>`, `<script>`, `<svg onload>`, `<iframe javascript:>`, `on*`) → cero elementos inyectados, cero handlers ejecutados, texto literal; si vuelve el `innerHTML` con datos del remitente, FALLA. CSP (`index.html`) + `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` (el `script-src` sigue con `'unsafe-inline'`/`'unsafe-eval'` por el WebView de Capacitor y los handlers inline). Batería **71/71**. Solo interfaz web. APK publicada (`nightly-2809`, `nexo-nightly-2809-35d9972.apk`, 24,57 MB, sha256 68306b4e…; firma verificada en CI). ⚠️ A confirmar en el teléfono |
| 2810 | 8c8c0e94 | **El gesto secreto de la «N» pasa de Ajustes a Perfil (informe del dueño).** El dueño probó en el teléfono: en Ajustes (mucho scroll) dibujar la «N» no abría el juego, porque el arrastre vertical lo tomaba el scroll (`pointercancel`) y se perdía el trazo. Ahora el gesto vive en una **zona dedicada del espacio negro de abajo de Perfil** (`#nexo-gesture-zone`, `flex:1`, `touch-action:none`) → ahí el dedo DIBUJA, no hace scroll, y la «N» se reconoce. `profile.js`: zona en Perfil + `attachNexoUnlockGesture`; retirado de `_openSettingsSheet`. `juego.js` comprueba que el gesto está en Perfil y NO en Ajustes. Batería **71/71**. Solo interfaz web. APK: a publicar (`nightly-2810`). ⚠️ A confirmar en el teléfono (dibujar la «N» en el espacio negro de Perfil) |
| 2774 | fa52b3d1 | Auditoría de seguridad y robustez «al límite» (ver "Ronda 2774" y `docs/AUDITORIA.md`): endurecido el Wi-Fi (saludo gigante, avalancha de conexiones, archivo abortado por un extraño, inundación de escaneo), cierre a distancia con JSON muy anidado, intent de llamada exportado, anuncio con ID mal formado, grupos (un miembro reescribía la lista y colaba claves) y recuperación del WebView. Pruebas nuevas: 4 de ataque en Kotlin + fuzzing con semilla + `groupforge.js`. Batería 51/51, Kotlin 87/87 (16 nuevas). Índice de robustez 41,8 (ver `docs/ROBUSTEZ.md` §4). **APK publicada: `nightly-2775` (24,5 MB, firma verificada).** La primera compilación (run 2774) falló por una carrera en `LanHub.stop()` dentro de la prueba de la avalancha (iterar la cola mientras los hilos de lectura la vaciaban); arreglada con `poll()` y comprobada 5 veces; la 2775 compila, pasa todo y publica |

## Base estable: build 2713
Probada por el dueño en teléfonos reales ("funciona como esperado", Wi-Fi Direct incluido), fijada el
22-10-2026. Anteriores: 2699 (rama `base-estable-2699`, commit `d563355`) y 2698 (`base-estable-2698`).
- Código: rama **`base-estable-2713`** (commit `4a33565`). No se toca; el proxy no deja subir etiquetas.
- APK: release `nightly-2713`. Misma llave y mismo `versionCode 1` que todas las builds: se instala
  encima de cualquier build posterior sin desinstalar (el workflow no borra releases antiguas).
- Ojo: volver a una base anterior a la 2712 deja el cifrado en el protocolo 1; los teléfonos con 2712+ no
  vuelven al 1 con un contacto que ya usa el 2 (pasadas 26 h descartan lo que llegue con el 1). Por eso
  la base es la 2713: no conviene bajar de la 2712.
- **Ojo desde la 2720:** los teléfonos con 2720+ tienen los datos cifrados en disco y la 2713 no sabe leerlos
  (vería contactos y chats vacíos y podría sobrescribirlos). Si hay que volver a la base, conservar el
  cifrado: tras el `git restore` de abajo, recuperar de NEXOCHAT `AtRestStore.kt`, los cambios de
  `saveToFile` / `loadFromFile` / `deleteFile` / `atRestDataKey` en `NexoBlePlugin.kt` y la dependencia de
  `build.gradle` del plugin. Lo mejor: fijar una base nueva ≥ 2720 cuando el dueño la confirme.
- Volver a la base (sin reescribir la historia, genera una build nueva con el código de la 2713):
  ```
  git checkout NEXOCHAT && git pull
  git restore --source=base-estable-2713 --staged --worktree -- src plugins android index.html package.json package-lock.json
  git commit -m "Volver a la base estable 2713" && git push origin NEXOCHAT
  ```

## Siguiente paso (al retomar)
- 2751: (1) Al abrir la app debe pedir permiso para notificaciones (Android 13+); aceptar. (2) Con NEXO en
  segundo plano, que el otro mande texto y foto (Bluetooth, Wi-Fi o internet): debe salir una notificación con su
  nombre y el número de mensajes, y el número en el icono de NEXO (si el lanzador lo admite). Tocarla abre ese chat.
  (3) En la lista de chats, la burbuja numerada debe contar también textos largos y fotos, y ponerse a 0 al abrir el
  chat. (4) Con la app en segundo plano el otro NO debe ver ✓✓ azul hasta que abras. (5) Internet en segundo plano:
  los dos en Wi-Fi de casas distintas, cerrar NEXO en uno (sin quitarlo de recientes) y escribirle: debe llegar la
  notificación "Mensaje nuevo". Diagnóstico: líneas `[NOTIF]`, `[NET]`. Con datos de ahorro de batería agresivos
  (Xiaomi, Huawei…) el sistema puede cortar la escucha: decir la marca del teléfono.
- 2739 (internet, decisión del dueño "2 y 3"): con los dos teléfonos en **Wi-Fi de casas distintas** (o uno con datos
  móviles) y NEXO abierto, la cabecera debe pasar a "En línea · Internet" en menos de un minuto; textos y fotos deben
  llegar (con datos móviles solo textos; las fotos esperan al Wi-Fi). Con uno cerrado, el texto queda en ✓ y llega al
  abrirlo (✓✓). Perfil → Internet: estado de los relés y de Tor (Tor tarda hasta un par de minutos la primera vez).
  Diagnóstico: líneas `[NET]` (relés conectados, "en línea por internet", "Tor listo", "conectado por Tor"). Si no
  conecta: puede que la red bloquee los relés o Tor; pedir el diagnóstico de los dos.
- 2734: los dos teléfonos en el mismo Wi-Fi (también con repetidor o red en malla): "En línea · Wi-Fi" en segundos,
  también al apagar y encender el Wi-Fi de uno. Diagnóstico: `[WIFI] nx… está en la misma red (escaneo de la red |
  anuncio mDNS)`. Entre módems distintos sigue sin Wi-Fi hasta decidir el punto de encuentro por internet.
- 2732: (1) Diagnóstico: línea `[JUMP] Largo alcance (LE Coded): sí/no` en cada teléfono (si los dos dicen "sí",
  probar Jump o un chat directo más lejos que antes). (2) Perfil → Fénix: con la cuenta protegida debe salir
  "💬 Mensajes protegidos: N"; tras recuperar la cuenta en otro teléfono, "🔥 Fénix: N mensaje(s) recuperados".
  (3) Agregar contactos: el "+" de un teléfono encontrado debe funcionar siempre.
- 2730: (1) Wi-Fi: los dos en el mismo router, NEXO abierto → "En línea · Wi-Fi"; mandar fotos, también con uno en
  segundo plano: debe seguir "· Wi-Fi" (antes pasaba a Bluetooth). (2) Chat → tocar el aviso 🔒 → "Mostrar mi QR" en
  uno y "Escanear su QR" en el otro: debe salir "✔ Número de seguridad verificado". (3) Tras escribirse, el aviso
  debe decir "Protección poscuántica activa". (4) Jump con 3 teléfonos: debe llegar igual. Diagnóstico si algo
  falla: líneas `[WIFI]`, `LAN`, `[E2E]`, `[JUMP]`.
- 2728 (Wi-Fi normal): con los dos teléfonos en la **misma red Wi-Fi** y NEXO abierto, la cabecera del chat debe
  pasar a "En línea · Wi-Fi" en unos segundos; fotos y vídeos mucho más rápidos. Probar a apagar el Wi-Fi de uno a
  mitad de un envío: debe seguir por Bluetooth ("En línea · Bluetooth"). Si no aparece Wi-Fi: diagnóstico de los
  dos (líneas `[WIFI]` y `LAN`); algunas redes de invitados bloquean hablar entre dispositivos.
- 2725: el dueño probó la 2722 (dos teléfonos a <10 cm): una foto se paró en 20 % con un "mensaje de código" y
  la del otro nunca empezó (○). Reproducido en el simulador (ver ronda 2725) y corregido. Pedir que pruebe fotos
  en las dos direcciones; si algo se para, diagnóstico de los dos: líneas `Write fallo … mensaje descartado`,
  `REASSEMBLY … resincronizado`, `Trozo … dañado`, `Paquete dañado descartado`, `[SEND]`.
- Después: Wi-Fi normal (misma red, NSD + TCP, verificado con E2E) y cambio automático Bluetooth / Wi-Fi Direct /
  Wi-Fi (pedido del dueño). Pensarlo para que sirva también en iOS (explicado al dueño el 23-10).
- 2722: el dueño dijo que con la 2720 "hasta enviar mensajes es lento". Corregido lo encontrado (ver ronda
  2722). Pedir el diagnóstico de los dos teléfonos tras mandar 5-6 textos: líneas `[SEND] Texto entregado en X
  ms (cifrar, salir por Bluetooth, reintentos)`, `[NATIVO] FILE_IO … lento` y `[LOCK] … migración`. Si sigue
  lento, esos números dicen si es el cifrado, la radio o los reintentos. No cambiar a ciegas.
- 2720 (seguridad fase 3): **lo primero**, instalarla encima y comprobar que siguen contactos, chats, NEXO ID y
  Fénix (al arrancar se cifran los archivos de antes; en el diagnóstico: `Cifrado en reposo activo; N
  archivo(s) cifrados ahora`). Perfil → Seguridad debe decir "Tus datos están cifrados en este teléfono".
  Probar: activar el bloqueo (pide huella), salir y volver (inmediatamente / 1 min), que los mensajes lleguen
  con NEXO bloqueado; bloquear capturas (captura en negro, NEXO en blanco en recientes). Si algo falla:
  diagnóstico, líneas `[LOCK]` y `AT_REST`. Volver a la 2718 o anterior tras la 2720 **no** sirve: esas no
  leen los archivos cifrados (la base estable 2713 tampoco).
- 2718: probar en el teléfono (los dos con 2718): mantener pulsada una burbuja → menú; deslizarla a la derecha
  → responder; reenviar a otro chat; eliminar para todos (el otro ve "Se eliminó este mensaje"). Cámara:
  pestañas, foto → revisar → enviar, selfie (debe verse como un espejo y la foto igual), vídeo con contador.
  Ojo: con contactos en builds anteriores a la 2715 las respuestas van como texto normal y no sale
  "Eliminar para todos". Las fotos pesan más (800 px): ~2x de tiempo por Bluetooth.
- Siguiente: seguridad fase 3 (pedido por el dueño tras pulir chat y cámara).
- 2714: probar la ubicación (dentro de casa y fuera): debe salir el aviso "Obteniendo tu ubicación…" y luego
  la burbuja, o un aviso claro. Si no, diagnóstico: líneas `[ATTACH] Ubicación…`.
- 2714 (Wi-Fi Direct lento): pedir al dueño el diagnóstico de **los dos** teléfonos tras mandar un vídeo de
  varios MB. Emisor: `[WIFI-DIRECT] … fases: grupo del otro X s, a Android X s, unirse X s, envío X s (KB/s)`;
  receptor: `Recibido … de Android a la app X s, lectura X s`. Con eso se decide qué acelerar (mantener el
  grupo abierto entre envíos, no pasar el contenido por el WebView, etc.). No cambiar a ciegas.
- 2715 (Fénix): con 10 contactos actualizados a la 2715+, Perfil → Fénix debe decir "Cuenta protegida: N de 10
  fragmentos entregados" (se entregan al estar conectados). Recuperación: en un teléfono nuevo, Perfil →
  Recuperar mi cuenta, con 6 de esos contactos cerca y NEXO abierto; a cada uno le sale el aviso "¿Quién es?".
  Diagnóstico: líneas `[FENIX]`. Pendiente de Fénix: mensajes y archivos, pingeo por Jump, huella (fase 3).
- 2713 (Wi-Fi Direct): el dueño vio en la 2711 un vídeo que se quedaba en 1 % en el emisor. Instalar en los
  dos teléfonos y mandar un vídeo de varios MB: la 1.ª vez Android puede pedir "Dispositivos cercanos" en
  cada teléfono (aceptar). Debe llegar en segundos por Wi-Fi Direct; si Wi-Fi Direct falla, debe llegar
  igualmente como previa + HD por Bluetooth (nunca quedarse en 1 %). Diagnóstico de ambos: líneas
  `[WIFI-DIRECT]` (dicen si se envió, si falló y por qué) y `[VIDEO]`.
- 2712 (cifrado como Signal): instalar en **todos** los teléfonos. Al conectar, el diagnóstico dice
  `[E2E] nx…: protocolo 2`. Tocar el aviso 🔒 del chat en los dos teléfonos: el número de 60 cifras debe ser
  idéntico; si lo es, "Marcar como verificado". Textos, fotos, vídeos y Jump deben seguir llegando.
- Seguridad fase 3 (siguiente): cifrado en reposo con el Keystore, anuncios Bluetooth rotativos, emisor oculto
  para los puentes, QR del número de seguridad, poscuántico.
- 2704: probar enviar un PDF (miniatura, tocar → se abre) y una APK pequeña (tocar → instalar; Android pide
  permiso la 1.ª vez). Una APK grande debe mostrar el aviso de tamaño.
- 2707: igual que la 2705 pero B puede ser un teléfono que NO es contacto de nadie (solo con NEXO abierto
  o en segundo plano). Comprobar también que B no ve chats ni contactos nuevos.
- 2709 (Wi-Fi Direct): con dos teléfonos cerca y NEXO actualizado, mandar una foto, un vídeo y un archivo
  de varios MB: deben llegar en segundos. La 1.ª vez Android pide permiso de "dispositivos cercanos"
  (13+) o ubicación. Diagnóstico: líneas `[WIFI-DIRECT]`.
- Revisión de seguridad hecha: `docs/SEGURIDAD.md` (comparación con Signal y plan en 3 fases). Después:
  Wi-Fi normal y datos (para datos/Wi-Fi entre redes hace falta decidir el servidor de relevo).
- 2705 (Jump): probar con 3 teléfonos A–B–C donde A y C no se alcancen (otra habitación / distancia) y B
  en medio: A escribe a C (texto y foto). Debe salir ✓ al quedar en B y ✓✓ al llegar a C. Diagnóstico:
  líneas `[JUMP]` (rutas, "Puente", "Reenviado").
- Velocidad: el dueño decidió dejar L2CAP; primero **medir** en los teléfonos (MTU, PHY, paquetes por
  segundo, esperas de confirmación) y corregir sobre GATT; L2CAP solo si eso se queda corto.
- 2702 (cifrado): el dueño debe instalarla en **todos** los teléfonos. Comprobar en el chat el aviso 🔒 y
  que textos, fotos y vídeos siguen llegando; si algo queda con reloj, Perfil → Copiar diagnóstico de
  ambos (buscar `[E2E]`: `Sin clave pública`, `No se pudo descifrar`, `La clave de … cambió`).
- Jump fase 2 (rutas de varios saltos, textos y fotos): descubrimiento de ruta por inundación pequeña
  (ttl + ids vistos), entrega salto a salto con guardado en cada puente, acks de vuelta; el contenido
  ya va cifrado para el destino final (los puentes no lo leen). En el simulador hace falta un modelo de
  alcance (A no ve a C).
- Pruebas rápidas de la 2698 en teléfonos reales: funciona (aceptable; faltan pruebas para afinar).
  Si aparece un fallo, pedir el texto de **Perfil → Copiar diagnóstico** de ambos teléfonos. Pruebas pedidas: vídeo de 5 s con la app del otro cerrada y abierta; abrir el
  vídeo varias veces; ver si aparece la miniatura, cuánto tarda la previa y si pasa a HD.
- Al recibir el diagnóstico, buscar en "eventos clave": `[VIDEO] Previa: …` (¿se generó? ¿motivo si
  no?), `Enviando HD`, `sendFile`, `Reenvi`, `Peer ready`, `El visor no pudo reproducir`, líneas ` W `/` E `.
  Reproducir lo que muestre en `tests/sim/browser.js` (Chromium real) o en el simulador antes de corregir.
- Pendientes ya hablados: transporte binario (sin base64/JSON, ~1,6x) para todos los archivos; recibir
  con la app cerrada (servidor GATT en el `BleService`).

## Ronda 2793: rápidos para estar «a la par» — autocorrecto y moneda automática
Primeros puntos «rápidos» de `docs/A_LA_PAR.md` (la lista de qué falta para estar a la par de WhatsApp/Telegram/Signal,
que pidió el dueño). Todo interfaz:
- **Autocorrecto / sugerencias del teclado.** El campo de mensaje tenía `spellcheck="false"` y `autocomplete="off"`, que
  apagaban la corrección. Ahora `spellcheck="true"`, `autocorrect="on"`, `autocapitalize="sentences"` (`index.html`): el
  teclado de Android (Gboard) corrige, capitaliza la primera letra y sugiere, como en cualquier app. El dueño tenía razón
  en que «es de Android»: solo había que dejar de apagarlo.
- **Moneda del «Cobro» automática por país.** Antes la lista arrancaba fija en ARS. Ahora `_defaultMoneda()` (`cobro.js`)
  detecta el país por el idioma/región del teléfono (es-MX→MXN, es-AR→ARS, en-US→USD…) y lo usa como valor inicial; si el
  dueño elige otra, se recuerda (`COBRO_MONEDA_KEY`) y manda esa. La prueba `cobro.js` fija la moneda explícita, no se ve afectada.

Contexto (pedido del dueño, `docs/A_LA_PAR.md`): también preguntó por **pagos con saldo** (cuenta, agregar dinero del
banco, transferir). Eso es una **billetera = custodia de dinero = licencia financiera o socio** (Mercado Pago/CoDi); no es
«código que falte» sino Fase 2 del plan. Hoy los «Cobros» son a propósito sin saldo (sin licencia). Orden que eligió el
dueño: 1) rápidos (autocorrecto ✓, moneda ✓, falta buscar en el chat), 2) internet de verdad (#2/#3), 3) Estados/Stream;
en paralelo explorar socio de pagos.

## Ronda 2792: detalles del dueño (botón de grupo + aviso de archivo) y lectura del diagnóstico
Con el diagnóstico del dueño (Samsung S24 Ultra, Android 16) en mano, dos arreglos de interfaz y claridad sobre lo demás:
- **Crear grupo — botón que no se habilitaba.** El botón pedía nombre + al menos un contacto, pero no decía cuál
  faltaba (quedaba gris y mudo → «como si faltara algo»). Ahora `groups_ui.js` pone en el propio botón: «Elige al menos
  un contacto» → «Escribe un nombre del grupo» → «Crear grupo (N personas)». El diagnóstico mostró que los contactos del
  dueño tienen ID `nx` limpio, así que **sí aparecen** en la hoja (no era el filtro de la hipótesis del subagente).
- **Aviso de archivo grande que se perdía.** El log confirma que al elegir la APK el código SÍ avisaba
  (`[ATTACH] Archivo demasiado grande: 24559074`), pero el toast duraba 4 s y salía justo al cerrarse el selector. Ahora
  `_showPermissionError(msg, ms)` acepta duración y el aviso de archivo dura 8 s (`ui_bits.js`, `pickers.js`).
- **Lo que el diagnóstico dejó claro (no son arreglos de esta build):** las **llamadas/videollamadas** funcionan con el
  contacto **cerca** (el log tiene una videollamada real de 17 s, audio Opus + vídeo VP8) pero fallan al contacto **solo
  por internet** porque la oferta no sale por internet (`calls.js _link` solo da Bluetooth/Wi-Fi) → **prioridad #3**; la
  **APK de ~23 MB** no cabe por internet (tope real ~6 MB relés / ~22 MB Tor) → **archivos grandes por internet**,
  **prioridad #2**; el **○+«Reintentar»** es el Bluetooth inestable con ese teléfono (MTU cae a 23, reconexiones cada pocos
  segundos) → nativo, se mira aparte. Orden acordado con el dueño: 1) detalles (esta build), 2) archivos grandes por
  internet, 3) videollamada por internet.
- Aparte: `docs/RENTABILIDAD_MX.md` — plan de rentabilidad para México (pedido del dueño).

## Ronda 2791: barra de adjuntar y tarjeta de Cobro (interfaz, informe del dueño)
Dos detalles de interfaz, todo CSS/HTML:
- **Barra de adjuntar que se salía de la pantalla.** Al añadir el 6º icono («Cobro», en la 2787) la fila de iconos no
  cabía y el último quedaba cortado por el borde físico. El menú era `display:flex; flex-direction:row; left:12px` sin
  tope de ancho ni salto de línea. Ahora (`nexo_theme.css`): iconos más pequeños (item 64→50 px, svg 50→40 px), el menú
  no pasa del ancho de la pantalla (`max-width: calc(100vw - 24px)`) y los iconos **saltan de línea** si no caben
  (`flex-wrap`), así nunca se corta otro aunque se añadan más. Además el item Cobro había quedado a medias en la 2787
  (sin fondo de color ni etiqueta, a diferencia de los otros 5): ahora círculo teal (#14b8a6) + etiqueta «Cobro».
- **Tarjeta de Cobro con borde grueso.** Tenía `border:1px` verde + gradiente y se veía «enmarcada» frente a la de
  Ubicación. Ahora igual que Ubicación (`cobro.js`): radio 12px, fondo sutil `rgba(0,0,0,0.3)`, **sin borde**, max 260px.
  El verde queda solo en el 💵, el texto y los botones.

En revisión para la 2792 (reportados por el dueño): (a) enviar una **APK grande por internet** no avisa ni se manda —
el camino de archivos grandes (`_sendBigFile`) es solo LOCAL (Wi-Fi/Wi-Fi Direct/L2CAP); por internet el tope real es
~6 MB (relés) / ~22 MB (Tor directo), así que una APK grande por internet hoy no cabe. Falta el diagnóstico del dueño
para separar dos casos: el selector de Android devuelve la APK con **tamaño 0** (y entonces leerla grande agota la
memoria en silencio) vs. una APK **genuinamente grande** que necesita «archivos grandes por Tor» (función nueva).
(b) **crear un grupo con un contacto en línea** falla (en investigación).

## Ronda 2790: arreglo de RAÍZ que impedía publicar las APK 2788 y 2789
Las APK de la 2788 y la 2789 **no se publicaron**: el job «tests» de CI fallaba en el simulador (2788 en `misroute.js`;
2789 en otra prueba). En la 2789 intenté arreglarlo parcheando `misroute.js` (un stub de `WebSocket`), pero fue
**insuficiente** porque el problema no era de esa prueba. Causa raíz **única**:

- El simulador marca «sin internet» con `NEXO_NET_RELAYS = []` (lo pone `native_mock`).
- El cambio de seguridad **F9** (2788) dejó `relayUrls()` como `return safe.length ? safe : DEFAULT_RELAYS`. Con la
  lista vacía, `safe` queda vacío y **caía a `DEFAULT_RELAYS`**, es decir, a los relés **PÚBLICOS reales**
  (`wss://relay.damus.io…`). En el runner de CI (con internet) esas pruebas se conectaban de verdad y su resultado
  quedaba **al azar** (p. ej. el archivo «ausente» de `misroute` volvía «entregado»). En local no se veía porque el
  sandbox no alcanza esos relés → por eso 2786/2787 (sin F9) pasaban y 2788/2789 (con F9) fallaban.

**Arreglo** (`src/net/net_link.js` `relayUrls()`): distinguir una lista **explícitamente vacía** (`[]` → «sin relés»,
se respeta) de una lista configurada pero **toda en claro** (`ws://` remoto → cae a los `wss://` por defecto, intención
de F9). Sin configurar (producción) usa los relés por defecto, igual que siempre; la app nunca fija `NEXO_NET_RELAYS`,
así que para el dueño no cambia nada. Revertido el stub de `misroute.js` (ya no hace falta). `relaytls.js` gana
aserciones que fijan esto para siempre (lista vacía → sin relés; lista toda-en-claro → `wss://`). Batería 60/60,
índice 42,5. La 2790 lleva **todo lo de la 2789** (palomitas, pantalla) + el código F9 de la 2788, y por fin publica APK.

## Ronda 2789: dos detalles del dueño (palomitas y pantalla); 1er intento (fallido) de arreglar el flake de la 2788
Informe del dueño tras instalar (en realidad la **2787**, ver abajo): (1) «las comas de recibido y leído se ponen cuando
solo se recibió sin leerlo»; (2) «al llegar un mensaje se prende toda la pantalla; solo debería aparecer la
notificación». Los dos son **regresiones mías**, verificadas en el código:

- **Palomitas (mío, de la 2783).** En la 2783 hice que «entregado» y «leído» fueran los dos ✓✓, distinguidos solo por
  color, y «entregado» quedó en un gris casi blanco (#cdd9e5) parecido al azul de «leído» → no se distinguían. La
  LÓGICA de cuándo se marca «leído» está bien (`notify.js`: solo con el chat abierto y a la vista, no al recibir). Era
  el color. **Arreglado** (`nexo_theme.css` + `critical.css`): enviado ✓ gris · **entregado ✓✓ gris (#8696a0)** ·
  **leído ✓✓ azul (#00d4ff) con brillo** — claramente distintos, como WhatsApp.
- **Pantalla que se enciende con un mensaje (mío, de la 2765).** `MsgNotifier.post` hacía `wakeScreen(5000)` con
  `SCREEN_BRIGHT_WAKE_LOCK` (brillo pleno) en cada mensaje. En la 2765 lo pidió el dueño; ahora quiere solo la
  notificación. **Arreglado** (`MsgNotifier.kt`): `wakeOnMsg()` por defecto **false** → un mensaje solo postea la
  notificación (la muestra el sistema sin forzar el brillo); quien lo quiera, lo activa en Perfil. Las **llamadas**
  siguen encendiendo la pantalla (es otro camino, `incomingCall`). Nativo: a confirmar en el teléfono.

Lo que el dueño también reportó y NO se reproduce en el simulador (pasa 60/60), así que queda a la espera de su
diagnóstico (Perfil → Copiar diagnóstico de los dos teléfonos; el registro nativo de la 2785 es para esto):
- **Al enviar, le llega al otro pero al emisor le queda ○ + «Reintentar»** (el acuse no vuelve). No es de cambios
  recientes (no tocan el envío de texto); sospecha: el Bluetooth inestable entre sus dos equipos (MTU 23, reconexiones).
- **Android dormido / no llega con la app cerrada (#87).** Nativo, sigue abierto.

**La 2788 (F9) NO llegó a generar APK**: el job «tests» de CI falló por `misroute.js`, y aquí está la causa raíz (ya
**arreglada** en la 2789). `misroute.js` es una prueba de ENRUTADO por Bluetooth/Jump, sin internet; pero no aislaba la
red: jsdom **sí** trae `WebSocket` y, al no fijar `NEXO_NET_RELAYS`, `relayUrls()` cae a los relés **PÚBLICOS reales**
(`wss://relay.damus.io`…). En local fallan (sandbox) → red offline → pasa; en CI (con internet) a veces conectan de
verdad y el archivo «ausente» del paso 4 salía al buzón real y volvía como «entregado» dentro de los 15 s → tripeaba la
aserción. No era un fallo de la app (2786 y 2787 lo pasaron) sino de la prueba. **Arreglo** (`misroute.js` `beforeParse`):
stub de `WebSocket` que construye pero nunca abre (`onopen` no dispara) → `net.online()` siempre false → B de verdad
ausente en la ventana. Determinista, no depende de la red del runner (verificado: el estado del archivo ausente queda en
`sending`, nunca `delivered`). Como la 2788 no publicó, la «última» del dueño era la **2787**; la 2789 lleva **las dos
correcciones (palomitas y pantalla) + el código F9 de la 2788 + este arreglo del flake**.

## Ronda 2788: auditoría F9 — solo relés cifrados (wss://)
Segundo del plan «todos, uno a la vez». De la auditoría (ronda 2774) quedaban puntos abiertos; empiezo por el más
**seguro y verificable**: **F9**. Los de más riesgo (M5/M6 autenticar control, H3/H4) tocan el núcleo del protocolo
(enlaces, nombres, sincronización) y solo se pueden comprobar en el simulador → se dejan para hacerlos con cuidado y
que el dueño los confirme en los teléfonos (pueden afectar justo lo sensible: mensajes/sincronización).

**F9:** NEXO aceptaba relés de internet en claro (`ws://`). Por un relé en claro, un espía de la red vería las
**etiquetas de tu suscripción** (las `p` de tu buzón) y podría ligarte a tus contactos. Ahora (`net_link.js`
`relayUrls()` + `_relaySafe`): solo **`wss://`** (cifrado); `ws://` solo a **loopback** (localhost/127.0.0.1, para
pruebas y un relé propio en el mismo equipo), nunca a un host remoto. Si por error la lista fueran todos en claro, cae
a los `wss://` por defecto (nunca te deja sin internet por esto). Los relés por defecto ya eran `wss://`, así que para
el dueño no cambia nada salvo que ahora es imposible configurar uno inseguro sin querer.

**Prueba:** `tests/sim/relaytls.js` (en la batería, tag RELAYTLS): con una lista mezclada, `relayUrls()` se queda con
el `wss://` y el `ws://127.0.0.1`, **descarta** el `ws://` remoto y deja el aviso. El resto de la batería confirma que
internet por relés (loopback) sigue igual.

## Ronda 2787: Pagos Fase 1 — "Cobros" en el chat (sin custodia, sin servidor, sin licencia)
El dueño pidió avanzar los pendientes «todos, uno a la vez, del más rápido al más complejo». El primero: **pagos**.

**Regla legal (de `docs/PAGOS_PROPUESTA.md`):** lo que exige licencia financiera es **custodiar el dinero** (guardar
saldo, recibir y reenviar fondos). Si NEXO **nunca toca los fondos**, es **"mensajería de cobros"** (como una factura o
un "Request to Pay"): no necesita licencia. Fase 1 implementa exactamente eso.

**Qué es (un tipo de mensaje más, como la ubicación):** en el menú de adjuntar hay un botón nuevo **💵 Cobro**. Abre una
hoja con **importe**, **moneda** (ARS/MXN/USD/EUR/… recordada por teléfono), **concepto** y **«cómo te pagan»** (alias/CBU,
`PayPal.me/vos`, Mercado Pago, o «efectivo» — también recordado). Al enviar, viaja **cifrado** como cualquier mensaje
(Bluetooth/Wi-Fi/Jump/internet) y en el chat aparece una **tarjeta** (importe grande + concepto + cómo pagar) con botones
**«Copiar datos»** y, si el dato es un enlace, **«Abrir enlace»**. NEXO no cobra ni guarda nada: solo lleva el pedido.

**Archivos (todo JS, aditivo, riesgo de regresión ~cero):**
- `src/ui/cobro.js` (nuevo): `_handleCobro` abre la hoja; `_sendCobro` manda `_sendAttachment('cobro', json, meta)` (el
  payload va NO vacío porque `render.js` solo arma el adjunto si hay `attachmentPayload`); `_renderCobroCard` dibuja la
  tarjeta (emisor «Cobro enviado», receptor «Te piden un cobro»), con escape del concepto/método (vienen del otro
  teléfono: nunca como HTML) y «Copiar» con reserva por `execCommand` si no hay portapapeles.
- `index.html`: item `data-type="cobro"` en el menú. `app_setup.js`: lo cablea a `_handleCobro`. `main.js`: pegamento
  `cobroUse`. `render.js`: rama `attachment.type === 'cobro'`.

**Prueba:** `tests/sim/cobro.js` (en la batería, tag COBRO): A manda un cobro a B; llega como adjunto 'cobro' con
importe/moneda/concepto/método; la tarjeta se dibuja en los dos; un concepto con `<img onerror>` **no se inyecta**; hay
botón «Copiar».

**Pendiente de limpieza (antes de la tienda):** hay un prototipo viejo y **muerto** de `payment`/`transfer` con una firma
inventada en `src/app/nexo_app.js` (sin UI que lo dispare; no choca con 'cobro'). Se borra en un pase dedicado para no
arriesgar regresión en un archivo vivo. Fase 2 (un toque con proveedor licenciado) y asesoría legal: ver
`PAGOS_PROPUESTA.md`.

## Ronda 2786: archivos grandes por internet (por Tor directo) y nunca «sin mandar y sin avisar»
Informe del dueño: «REVISA TAMBIÉN QUE PERMITA EL ENVÍO DE ARCHIVOS GRANDES CUANDO HAY INTERNET, HICE LA PRUEBA Y OTRA VEZ
NO MANDÓ NADA NI AVISÓ SI ES POR DIMENSIONES».

**Qué pasaba (reproducido en el simulador, `tests/sim/bignet.js`):** con solo internet, un archivo de 2–5 MB SÍ se manda
por los relés (5 MB en ~23 s en el sim); pero uno de 10–20 MB se quedaba en el tope de ~6 MB de internet. En el build
nuevo ya salía un aviso claro (por eso el dueño, que probaba en un build viejo, no lo veía: sus teléfonos de prueba no
tenían la 2785). Faltaban dos cosas: (1) **permitir** de verdad los archivos grandes por internet y (2) que **nunca** se
quede sin mandar y sin avisar (había un hueco en el vídeo).

**El porqué del tope.** El transporte de archivos trocea en pedazos de 16 KB y cada pedazo cabe en un evento de relé
(~64 KB); el límite real no es el transporte sino cuántos eventos aguantan los **relés públicos**: un archivo de 20 MB
serían >1200 eventos pequeños, que los relés saturan/rechazan. En cambio **Tor directo** es una conexión .onion entre los
dos teléfonos (sin relés, sin el tope de 64 KB por evento): por ahí un archivo grande va como por Wi-Fi Direct.

**Cambios (todo JS):**
- `media_limits.js`: el tope por internet (`_maxB64For`) es ahora **según el camino**. Nuevo `_torDirect(contactId)`
  (mira `net.via(contactId) === 'tor'`): si hay conexión **Tor directa**, el tope sube a **~22 MB** (`NET_TOR_MAX_B64_BYTES`
  = el de Wi-Fi Direct, mismo gasto de memoria ya probado); por los **relés** se queda en **~6 MB** (`NET_MAX_B64_BYTES`).
  Sigue respetándose la regla del dueño: si hay camino LOCAL de archivos grandes (L2CAP/Wi-Fi/Wi-Fi Direct) va por ahí,
  no por internet.
- `media_limits.js` `_tooBigMessage`: el aviso es **accionable** — por los relés dice el tope (~6 MB) y «para archivos
  grandes por internet activa Tor en Perfil»; con Tor directo dice el tope por Tor (~22 MB). (El selector `pickers.js` ya
  añade «hasta 1 GB con el contacto en el mismo Wi-Fi / Wi-Fi Direct / cerca».)
- `video_send.js`: el vídeo que **no se podía preparar** (códec/recodificación que fallaba) antes caía en un `catch` que
  solo escribía en el registro — el usuario no veía nada. Ahora **siempre** sale un aviso («No se pudo preparar el vídeo…
  prueba con uno más corto, o envía una foto»), y el aviso de «demasiado grande» del vídeo ya usa el contacto (dice bien
  si es por internet o por Bluetooth).

**Pruebas:** `tests/sim/bignet.js` (dos escenarios, metidos en la batería, tag BIGNET): (1) **relés** — un mediano (5 MB)
llega; un grande (12 MB) NO se manda y sale el aviso claro (nombra relés, Tor y Wi-Fi). (2) **Tor directo** — un grande
(12 MB) SÍ sale por internet y llega, sin aviso de tamaño. (En el sim la latencia de Tor se baja para no esperar minutos:
se prueba la lógica de la app, no la velocidad real de Tor.)

## Ronda 2785: llamada a pantalla completa de verdad (#1) y, para el #87, WifiLock + registro nativo persistente

Informe del dueño (26-10, tras probar la 2784): «solo entran las llamadas y solo aparece la notificación, no aparece
la pantalla completa con Contestar/Rechazar; también mandé mensaje y aparece enviado pero no recibido, de hecho no
llega». Son sus dos prioridades. Todo lo de esta ronda es **nativo** (Kotlin): no se puede compilar ni probar aquí (no
hay ANDROID_HOME); se verifica por el build de CI y la prueba del dueño. Lo que SÍ se pudo probar en JVM va con prueba.

- **#1 Llamada entrante a pantalla completa de verdad (`MsgNotifier.incomingCall`).** Antes el aviso de llamada era un
  aviso normal con dos botones (`addAction`) + `setFullScreenIntent`. En Android 14 y, sobre todo, en Samsung One UI,
  el sistema no lo trataba como una llamada y lo bajaba a aviso pequeño. Ahora usa **`NotificationCompat.CallStyle.forIncomingCall`**
  (androidx.core 1.12 ya lo trae): es la pantalla de llamada real, con Contestar/Rechazar grandes, y con la pantalla
  bloqueada + el permiso de pantalla completa concedido (el que pide #81) sale a pantalla completa. Si en algún teléfono
  CallStyle fallara, cae a un aviso de llamada normal (no se pierde la llamada ni se arriesga un cierre en segundo plano).
  Sigue sonando con el tono (FLAG_INSISTENT) y encendiendo la pantalla (`wakeScreen`). **El permiso de pantalla completa
  tiene que estar concedido** (Ajustes → Apps → NEXO → notificaciones a pantalla completa / «aparecer encima»): sin él,
  Android lo deja en aviso aunque sea CallStyle.

- **#87 (mensajes con la app CERRADA) — dos cambios, uno que arregla y uno que mide.** El diagnóstico del dueño mostró el
  mensaje llegando 3 s DESPUÉS de reabrir la app, y NADA en el hueco cerrado. Pero eso no probaba que la escucha nativa
  (NetBg) estuviera muerta: `remLog` solo escribía en logcat y, con la app abierta, cruzaba al WebView por el puente;
  **con la app cerrada no hay WebView ni puente, así que el diagnóstico (que se arma en el WebView, diag.js) salía vacío
  en el hueco** pasara lo que pasara por debajo. Por eso:
  1. **Registro nativo persistente (`NativeLog.kt`, nuevo, con prueba JVM `NativeLogTest`).** La parte nativa (NetBg,
     Bluetooth con la app cerrada, ciclo de vida, energía, WifiLock) deja constancia EN DISCO (anillo por tamaño, ~48 KB,
     solo metadatos — nunca el texto de un mensaje). Al abrir la app, «Copiar diagnóstico» lo incluye en una sección
     nueva («REGISTRO NATIVO»): el próximo diagnóstico del dueño **sí** mostrará si NetBg escuchó y si vio el sobre del
     relé durante el periodo cerrado. Es lo que convierte el #87 de adivinar a medir (el método del dueño: no afirmar
     nada sin comprobar). El archivo va en claro (append desde varios hilos, también con la app cerrada o bloqueada) y
     por eso se excluye del cifrado en reposo (`AtRestStore.skip`); como son solo metadatos (los mismos NEXO ID/msgId que
     ya salen en el diagnóstico que el dueño copia), el riesgo es mínimo.
  2. **WifiLock (`wifiLockHold`, FULL_HIGH_PERF).** La causa más probable: con la pantalla apagada Android pone la radio
     Wi-Fi en ahorro de energía y la conexión al relé (un socket que vive en el proceso, no un push de Google como
     WhatsApp) deja de recibir paquetes; el aviso salía al encender la pantalla. El WifiLock apaga ese ahorro mientras
     NetBg escucha (en segundo plano/cerrada) para que el paquete del relé llegue y despierte la CPU (y entonces el
     `rxWake` de 15 s da tiempo a avisar). Se toma al arrancar NetBg y se suelta al volver la app al primer plano. Solo
     aplica a Wi-Fi (en datos móviles no hay WifiLock; el dueño prueba por Wi-Fi). El diagnóstico de la tablet ya tenía la
     batería «Sin restricciones» (Doze exento), así que el WifiLock es la siguiente palanca lógica; el registro nativo
     dirá si basta.

Batería **56/56** (el cambio en JS, `diag.js`, lee el nuevo registro nativo si el método existe; en el simulador no
existe y se salta). Kotlin **95/95** (+5 de `NativeLogTest`). **#87 SIGUE ABIERTO** hasta confirmarlo en los dos
teléfonos: el dueño debe probar con la 2785 (app cerrada + pantalla apagada, mandar un mensaje, esperar ~2 min, abrir) y
mandar el diagnóstico de los dos; ahí se verá por fin qué hizo el nativo. #1 a confirmar en el teléfono con el permiso
de pantalla completa concedido.

## Ronda 2784: pantalla completa de llamadas (#81), zoom al borde, contactos sin parpadeo, diagnóstico 1 h

Informe del dueño (26-10), todo JS (sin tocar nativo):

- **#81 Llamadas/videollamadas a pantalla completa (Android 14).** El dueño: con la app cerrada y la batería ya en «Sin restricciones», la llamada entra pero solo como aviso, sin los botones Contestar/Rechazar a pantalla completa. Causa: en Android 14 el permiso `USE_FULL_SCREEN_INTENT` no basta con declararlo, hay que pedirlo. La plomería nativa ya existía (`alertSettings` reporta `canUseFullScreenIntent()`, `openAlertSetting('fullScreen')` abre los ajustes); ahora `main._askBackgroundOnce` lo pide proactivamente al arrancar: primero la exención de batería si falta (lo fundamental para recibir), y si esa ya está, la pantalla completa. También sigue en Perfil → Avisos. Prueba `alerts.js` (teléfono con batería concedida → pide la pantalla completa).

- **Zoom de foto al borde.** Al ampliar con pellizco/doble toque y arrastrar, ya no se pasa del borde de la imagen (no se ve negro): el desplazamiento se limita al tamaño ampliado y la pantalla (`file_card._openFullscreenMedia`).

- **Franja de conectados sin parpadeo.** Histéresis de 60 s (`ble_ui.renderOnlineStrip`): un contacto entra solo si lleva ≥60 s en línea y se quita solo si lleva ≥60 s sin conexión; se ignora cualquier cambio de estado que dure menos de 60 s (un corte breve no lo hace desaparecer). Umbral configurable (`window.NEXO_STRIP_MS`).

- **Diagnóstico de la última hora.** «Copiar diagnóstico» recorta la sesión actual a la última hora (hora por línea) para que quepa al pegarlo; se mantiene la sesión anterior (`diag.js`).

Batería 56/56, índice 42. Pendiente, y prioridad, el núcleo del **#87** (que los mensajes lleguen con la app cerrada): es nativo y necesita el diagnóstico de los dos teléfonos (ahora corto, por la mejora del diagnóstico). El dueño confirmó que con la batería «Sin restricciones» las llamadas ya entran (faltaba la pantalla completa, ya en #81) pero los mensajes aún no llegan con la app cerrada.

## Ronda 2783: reacciones, gestos, palomitas iguales y micrófono más silencioso

Pedidos del dueño (26-10), todo en una APK:

- **Reacciones con emoji.** Doble toque en un mensaje = ❤️; mantener pulsado → barra «Reaccionar» (👍❤️😂😮😢🙏); volver a tocar el mismo = quitarla. Se guarda en el vault (`reactions: { NEXO ID de quien reacciona: emoji }`, `vaultReactMessage`) y se manda como acción oculta cifrada si el contacto lo entiende (`{type:'nexo_act',act:'react',id,e}`, por el mismo molde que eliminar/editar). Igual por Bluetooth, Wi-Fi e internet. Se dibuja bajo la burbuja (`_renderReactions` en `render.js`).

- **Palomitas iguales en todas las redes.** El dueño vio que las de «entregado» por Bluetooth se veían distintas que por otras redes. Raíz: `render.js` dibujaba «entregado» con UNA palomita (igual que «enviado») y solo «leído» con dos; como por internet el otro suele abrir rápido (llega a «leído» = ✓✓) y por Bluetooth se queda en «entregado» (✓), parecían distintas. Ahora, como WhatsApp: enviado ✓, entregado ✓✓, leído ✓✓ (entregado y leído se distinguen por color: entregado gris claro, leído cian con brillo). Prueba `palomitas.js` (tag PALOM).

- **Gestos.** Deslizar la burbuja a la izquierda o a la derecha = responder (antes solo a la derecha). Deslizar el chat hacia abajo estando arriba del todo = cerrarlo (`_setupPullToClose`, aislado del «volver» lateral y del scroll). Ampliar una foto en el visor con **pellizco** de dos dedos, **arrastrar** con un dedo cuando está ampliada, y **doble toque** para alternar normal/2,5x (el dueño sugirió el pellizco; van los dos).

- **Micrófono.** Silencio más profundo cuando no detecta la voz: gate de −22 a −34 dB (el micro queda al ~2 % en silencio, no a cero). Medido en `voicefx.js`: el ruido de fondo baja 34 dB (antes ~22), la voz pasa entera y no se come el inicio de las palabras.

Pruebas: `chatactions.js` ampliado (deslizar izq, reaccionar doble toque ❤️ que el otro ve, menú Reaccionar, deslizar abajo cierra, zoom con pellizco/doble toque), `palomitas.js` nuevo, `voicefx.js` con el umbral de silencio a ≥20 dB. Batería 56/56, índice 42.

Lo que **no** entró: el bug GRAVE de **app cerrada** (con la app deslizada + pantalla apagada no llegan mensajes ni avisos por Wi-Fi/internet hasta abrir; el par se pasa a «Internet»). Es nativo (la recepción vive en el proceso del WebView; al cerrar se apaga el LAN y Android duerme el proceso en Doze sin WifiLock ni exención de batería). Va en la siguiente ronda con el diagnóstico de los dos teléfonos (tarea #87). También quedó anotado que el aviso, con la pantalla apagada, a veces solo sale como icono sin contenido (tarea #89).

## Ronda 2782: editar un mensaje ya enviado
Pedido del dueño: "una vez enviado un mensaje, que se pueda editar". Se añade por el mismo molde que "eliminar para
todos" (un `nexo_act` cifrado por `msgId`, dentro de una ventana de tiempo):

- Mantén pulsado tu mensaje de **texto** → **✏️ Editar** (solo aparece en mensajes propios, de texto, de menos de 15 min,
  y si el otro tiene NEXO actualizado). La caja se rellena con el texto y sale una barra "Editando mensaje".
- Al enviar, `app_setup._doSend` ve que hay una edición en curso (`_editing`) y manda la edición en vez de un mensaje
  nuevo: `chat_actions._editForAll` → `nexo_act {act:'edit', id, t}` + `vaultEditMessage` (cambia el contenido y marca
  `edited`) + re-dibuja la burbuja con la etiqueta **"editado"** (`render.js`).
- El receptor lo aplica en `_applyChatAction` solo si el mensaje es de quien lo pide (como el borrado); re-dibuja con
  "editado". No se puede editar un adjunto ni un mensaje borrado.

Prueba: `tests/sim/chatactions.js` ampliado con el paso de edición (barra, caja con el texto, A ve "editado", B recibe la
edición y la ve con "editado") y **metido en la batería** (`ci.js`, tag CHATACT): de paso, la batería diaria ahora cubre
también responder, deslizar para responder, copiar, reenviar a otro y eliminar para mí/para todos, que antes solo se
probaban a mano. Batería 55/55, índice 42,3.

## Ronda 2781: notas de voz — pausar/reanudar, borrar antes de enviar, y no pisar el audio
Informe del dueño: "cuando escuchas un audio y empiezas a grabar, el que estaba sonando no se para; e imagino que
tampoco al recibir una llamada o videollamada". Y además: "poder parar una grabación y reanudarla, y poder borrarla
antes de enviarla". Tres cosas:

1. **No pisar el audio**: cada nota de voz se reproducía con su propio `new Audio()` sin coordinación, así que varias
   podían sonar a la vez y ninguna se paraba al grabar o al entrar una llamada (se grababa el altavoz). Ahora `render.js`
   lleva un registro del reproductor que suena (`_curVoiceStop`) y `_stopVoicePlayback()` lo para. Se llama: al empezar a
   grabar (voice.js, por `window.__nexoStopVoice`), al reproducir otra nota (solo una suena a la vez) y al entrar/empezar
   una llamada o videollamada (un escucha del evento `nexo:call`, que `calls.js` emite en `calling`/`ringing`/`active`).
2. **Pausar/reanudar la grabación** (`MediaRecorder.pause()`/`resume()`), con el contador de tiempo descontando la pausa.
3. **Borrar la grabación antes de enviarla**: se para el micrófono y se descartan los trozos sin enviar.

Interfaz: barra de grabación (`voice.js`) con **🗑 borrar · ● tiempo · ⏸/▶ pausar · ➤ enviar**. El micrófono (botón de
enviar con el texto vacío) sigue empezando y, al tocarlo otra vez, envía.

Prueba nueva `tests/sim/voicenote.js` (en `ci.js`): grabar→pausar→reanudar→enviar le llega una nota a B; grabar→borrar
no envía nada; al grabar y al entrar una llamada se pide parar el audio (`window.__nexoVoiceStops`). Batería 54/54.

## Ronda 2780: fotos y archivos por internet — siempre mandables, con «Reintentar» y reenvío al volver
Informe del dueño: "estoy escribiendo a un dispositivo con la app en otra ciudad y todo va bien, pero me di cuenta de que
no le llegó la foto; igual los archivos". El texto le llegaba (buzón de los relés) pero la foto no. **Causa**: un adjunto
solo salía por internet si los dos estaban en Wi-Fi (`net.filesOk` = `canReach && bothWifi`); con datos móviles o con el
otro desconectado se quedaba esperando. El dueño pidió: "las fotos/archivos siempre se pueden mandar; pon un tope de
tiempo, si en 30 s no se pasaron pon «Reintentar» y que el usuario lo intente cuando quiera, o se reactive cuando haya Wi-Fi".

**Qué se hizo (fase 1, solo JS; los archivos muy grandes son la fase 2 por Tor nativo):**
- **El adjunto sale por internet aunque el otro no esté en Wi-Fi**: bajo un tope de ~6 MB (`NET_MAX_B64_BYTES`), va por
  Tor directo/Wi-Fi si está en línea (`filesOk`) o **al buzón de los relés** si no (`mailboxOk`), igual que los textos
  (store-and-forward: llega cuando el otro abre). `media_limits._maxB64For` sube el tope del "sobre" a ~6 MB cuando el
  contacto es de internet, **pero no si hay un camino local de archivos grandes** (`_bigLocalRoute`: Wi-Fi, Wi-Fi Direct
  o Bluetooth L2CAP): ahí el archivo grande va por L2CAP/Wi-Fi como antes (regla del dueño: lo local primero). El gate de
  `ble_messages`/`ble_ack` deja salir el adjunto al buzón (antes daba `PEER_ABSENT` y se quedaba pendiente).
- **Botón «Reintentar»**: si un envío propio (foto/archivo/texto) no sale en ~30 s o falla, aparece «↻ Reintentar» bajo la
  burbuja (`render.js`, margen configurable con `window.NEXO_RETRY_MS`); al pulsarlo reintenta (`_resendPendingMessages` +
  `resumeOutgoingTransfers`). Solo en chats 1 a 1.
- **Reenvío solo al volver el internet**: cuando los relés se reconectan, `net_link` avisa a `ble._netOnline` →
  `resumeOutgoingTransfers` + `_resendPendingMessages` de los contactos por internet (complementa a `_netUp`, que ya
  reactivaba al pasar el contacto a Wi-Fi).
- **Pruebas**: `tests/sim/net.js` ampliado — foto por datos móviles llega (`datos_moviles_foto_llega_s`), foto al buzón con
  la app cerrada llega al volver (`buzon_foto_llega_s`), y sin internet sale el botón (`boton_reintentar`) y la foto se
  reenvía sola al volver la conexión (`reintento_auto_foto_llega_s`). `ci.js` comprueba las cuatro. Batería 53/53, Kotlin
  90/90 (sin cambios nativos), índice 42,1.
- **Regresión encontrada por la batería y arreglada en la misma ronda**: el tope ampliado por internet desviaba del L2CAP
  un archivo grande a un contacto cercano (se iba en trozos lentos por el sobre). Se corrige con `_bigLocalRoute` (ver
  arriba): si hay camino local, el archivo grande vuelve a salir por L2CAP. La prueba `big.js --l2 --mb=4` vuelve a pasar.

## Ronda 2779: alta por ID — agregar a alguien que está lejos (solicitudes por internet, aceptar/eliminar)
Pedido del dueño: "si un amigo descarga la app pero no está cerca de mí, ¿cómo me puede agregar?". Hoy no se podía (solo
en persona por Bluetooth, o por un amigo común). El dueño eligió un **buscador de ID con solicitudes**: él me pasa su
NEXO ID (por WhatsApp), yo lo pego y le mando una solicitud; quien recibe una solicitud de un ID no agregado la **acepta
o la elimina** (anti-spam).

Cómo funciona (clave: NEXO no tiene directorio donde buscar un ID —eso es lo que lo hace privado—):
- **Buzón de solicitudes por ID** (`net_link.js`): además de la etiqueta diaria de cada pareja (que necesita el secreto
  ECDH de las dos claves), se deriva un buzón **solo del NEXO ID** (`_reqTag`/`_reqAesKey` = hash del ID, rota por día).
  Cada teléfono escucha su propio buzón; cualquiera que conozca tu ID puede dejarte ahí una solicitud cifrada con la
  clave de tu ID (contenido legible solo por quien tiene el ID completo).
- **Solicitud / aceptación** (`sendRequest` con tipo `req`/`acc`): lleva el NEXO ID, la **clave pública** y el nombre del
  que la manda. Al **aceptar**, cada lado agrega al otro con su clave (reusa `addSharedContacts`, con `nt`), se mandan la
  aceptación y el canal seguro de pareja se enciende solo (un `greet()` nuevo fuerza el saludo para verse en línea ya).
- **Seguridad**: la clave que llega así **no está verificada en persona** (riesgo H3 de la auditoría): el contacto entra
  "sin verificar" y el banner del chat pide comparar el número de seguridad. Cualquiera que conozca tu ID puede mandarte
  una solicitud, pero no puede agregarte ni leer nada sin tu "Aceptar" (por eso el aceptar/eliminar). Tope de solicitudes
  guardadas (anti-spam). Solo con la app abierta se reciben; si estás cerrado, la solicitud espera en el buzón del relé.
- **Interfaz**: Perfil → **"Compartir mi ID"** (usa el menú de compartir del teléfono o copia el ID); Agregar → campo
  **"Agregar por NEXO ID"** (tolera pegar un mensaje entero, saca el NX…) + **bandeja de solicitudes** (Aceptar/Eliminar).

Reproducción y prueba: `tests/sim/reqadd.js` (3 teléfonos sin conocerse: A agrega a B por su ID, B ve la solicitud y
acepta → los dos quedan de contacto por internet con clave, "sin verificar", y se ven en línea; C manda una solicitud a
A, queda pendiente y al eliminarla no agrega nada). Batería **53/53**, Kotlin **90/90**, índice **42,1** (la prueba nueva
no cambia el índice: es una funcionalidad, no un modo de fallo del catálogo). Pendiente (build aparte): el aviso
proactivo del permiso de "pantalla completa" de Android 14 (informe del dueño en 2778: la pantalla se enciende pero la
llamada no aparece sola si falta ese permiso; hoy se activa en Perfil → avisos).

## Ronda 2778: llamadas (informe del dueño: ruido, pantalla al entrar llamada, contestar deslizando)
Tres cosas que pidió el dueño tras probar la 2777:

1. **Ruido en llamada.** El dueño oía mucho ruido de fondo y propuso: "el micrófono que oye la voz se activa y el que no se
   silencia, no del todo". Es una **puerta por voz (VAD)**: en `call_voice_fx.js` la puerta de ruido pasa de −10 a **−22 dB**.
   Cuando no detecta tu voz, el micrófono queda al ~8 % (no a cero, para que no suene cortado ni bombee); abre al instante al
   hablar (ataque 2 ms) y se mantiene 220 ms tras la última sílaba. Así el ruido de fondo (ventilador, calle, electrónica)
   casi no se transmite cuando callas. Prueba `voicefx`: ruido en silencio baja **22 dB**, principio de palabra al **100 %**
   (no se come el arranque). El ruido mientras hablas lo quita la cancelación del sistema (ya pedida en getUserMedia).
2. **Pantalla apagada + llamada entrante.** El aviso de llamada ya usa un full-screen intent y un wakelock de pantalla, pero
   faltaba que la actividad encendiera la pantalla al nacer. `MainActivity.onCreate` ahora pone `setShowWhenLocked(true)` +
   `setTurnScreenOn(true)` **solo cuando el intent es de llamada** (`nexo_call_from`/`nexo_call_answer`); si se hiciera siempre,
   la app se vería sobre el bloqueo al abrirla normal. En Android 14 puede hacer falta conceder el permiso de "pantalla
   completa" (ya está en el manifest y hay un acceso a sus ajustes). ⚠️ A confirmar en los teléfonos del dueño.
3. **Contestar deslizando hacia arriba** (`calls_ui.js`): el botón verde se arrastra hacia arriba (una flecha de pista sube
   sola); al soltar por encima de ~55 px, contesta. El **toque** sigue valiendo como alternativa (contestar es idempotente,
   así que desliz + toque no contesta dos veces).

Batería **52/52**, Kotlin **90/90** (no se tocó Kotlin), índice de robustez **42,1** (sin cambio: son mejoras de calidad, no
nuevos modos de fallo con prueba). Pruebas para el dueño: hacer una llamada en sitio con ruido (¿se nota menos al callar?),
recibir una llamada con la pantalla apagada (¿se enciende y aparece?), y contestar deslizando. Siguiente: alta remota por
enlace/QR/código (aprobada por el dueño).

## Ronda 2777: auditoría fase 2 — C1 (confirmaciones ✓✓ autenticadas), también en modo cerrado
Pedido del dueño: seguir con la fase 2 de la auditoría tras los arreglos de la 2776. El hallazgo P0 era **C1**: las
confirmaciones de entrega/leído (✓✓) viajaban sin firmar y el `msgId` va en claro, así que un tercero que lo conozca
(por radio, LAN o un relé) podía mandar una confirmación falsa de «entregado» → el emisor dejaba de reintentar y el
mensaje se **perdía mostrando ✓✓**.

Un primer intento (firmar solo desde la app con `e2eAckTag`) funcionaba con los dos teléfonos abiertos pero **rompía el
✓✓ en modo cerrado**, porque ahí el ack lo manda la capa nativa, que no tiene las claves de identidad para firmarlo; lo
atrapó la batería y se revirtió. El dueño eligió el arreglo bueno: **firmar también el ack nativo**. Hecho así:
- La confirmación va firmada con un MAC derivado del secreto de la pareja: `e2eAckTag` = HMAC-SHA256 del ECDH de las dos
  identidades con la etiqueta `NEXO-ACK-v1`, ligado a `tipo|msgId|los dos NEXO ID`, recortado a 12 bytes (base64). El que
  la recibe la comprueba (comparación en tiempo constante); una falsa (sin firma o con firma que no cuadra) se **ignora**.
- **Modo cerrado**: la app le pasa a la parte nativa, por contacto, la clave de firma (`setAckKeys`): se guarda solo en
  memoria del proceso (sobrevive con la app cerrada, como la config de internet de `NetBg`), **nunca a disco**. El Kotlin
  firma el ack del buzón igual que la app. La clave se envía al arrancar y antes de irse a segundo plano
  (`visibilitychange`).
- Solo se exige a los contactos modernos (protocolo 2 con clave pública); los antiguos siguen igual (compatibilidad). El
  campo `a` es uno más del JSON del ack: un contacto viejo lo ignora.
- Reproducción y defensa: `tests/sim/ackforge.js` (A↔B proto 2; la entrega real marca ✓✓ y una confirmación falsa no, y
  el envío sigue pendiente). El `native_mock.js` firma el ack cerrado igual que el Kotlin, así que el escenario «recibir
  con la app cerrada» cubre la firma nativa.

Batería **52/52** (ackforge nuevo incluido), Kotlin **90/90** (compila `setAckKeys`/`ackTag`). Índice de robustez **42,1**
(sube de 41,8: un punto débil grave menos y una prueba más en el área de auditoría; ver `docs/ROBUSTEZ.md`). ⚠️ **Falta la
confirmación en los dos teléfonos del dueño** (con la app cerrada y abierta). Detalle en `docs/AUDITORIA.md`.

Pruebas cortas para el dueño (dos teléfonos ya emparejados, contactos modernos):
1. Mándate un texto de A→B con **B abierto**: debe salir ✓✓. 2. Con **B cerrado** (app deslizada fuera): A manda, debe
llegar el aviso y marcarse ✓✓. 3. Lee en B: a A le debe salir el doble ✓ azul (leído). 4. Repite por Wi-Fi/internet.
5. Si algo no marca ✓✓, Perfil → Copiar diagnóstico en los dos y mándamelo.

## Ronda 2776: informe del dueño (escaneo, menú ⋮, eco, avisos con pantalla apagada, tono de llamada)
Cinco cosas que pidió el dueño tras probar la 2775, antes de seguir con la fase 2 de la auditoría:
- **Escaneo que no encontraba (regresión de la 2774).** El NEXO ID se genera en MAYÚSCULAS (`_generateNexoId` → `NX…`),
  pero la validación del anuncio que metí en la 2774 solo aceptaba `nx` en minúsculas → se rechazaba el anuncio real y
  el escaneo no encontraba a nadie (o solo a quien anunciaba su código rotativo `R…`, que sí pasaba: de ahí lo de
  «lento/a veces»). Arreglado: la validación ahora acepta mayúsculas/minúsculas, movida a `AdvertisedId` (Kotlin puro,
  probado en `AdvertisedIdTest` para que no vuelva a pasar). El escaneo ya era agresivo (LOW_LATENCY + PHY largo).
- **El menú ⋮ de cada contacto no hacía nada (regresión del estilo NEXO, 2763).** En `nexo_theme.css` se metió
  `.ble-contact-menu` en la misma regla que las hojas que suben desde abajo, que le forzaba `position: relative` y lo
  mandaba fuera de pantalla (al final del `body`). Ahora es un desplegable de verdad otra vez (conserva `position:
  fixed` y su sitio junto al botón), con los colores NEXO.
- **Eco y ruido en llamada/videollamada.** NEXO no usa WebRTC, así que el cancelador del navegador no «ve» lo que NEXO
  reproduce y no puede quitar ese eco: lo tiene que quitar el filtro propio. Se reforzó: el micrófono baja más mientras
  habla el otro (−12 → −18 dB, queda al ~12 %) y se alarga la cola del eco (200 → 300 ms); y se piden al micrófono las
  pistas de cancelación/supresión del sistema (mono, `echoCancellationType: system`, `goog*`). Comprobado en
  `voicefx.js` (eco baja 18 dB; la voz propia cuando hablan los dos sigue pasando). El eco real depende del teléfono:
  puede necesitar un par de ajustes con el diagnóstico del dueño.
- **Avisos con la pantalla apagada por Wi-Fi/internet.** La escucha de internet en segundo plano (`NetBg`) avisaba sin
  renovar el wakelock `rxWake` (que sí tienen Bluetooth y Wi-Fi): ahora un mensaje por internet mantiene el teléfono
  despierto lo justo para avisar. Recordatorio: para que lleguen sí o sí sin Google Push hace falta que NEXO esté
  exenta del ahorro de batería y, en Vivo/Samsung, con autostart (Perfil → «Avisos con la pantalla apagada»).
- **Tono de llamada y videollamada.** Se puede elegir el tono de entre los guardados del teléfono (Perfil → «Tono de
  llamada y videollamada», selector del sistema) y por defecto usa el tono de llamada actual del teléfono. Vale igual
  para llamadas y videollamadas (mismo canal de avisos). Nativo: `MsgNotifier` guarda el tono y recrea el canal;
  `pickCallRingtone`/`getCallRingtone` en el plugin.

## Ronda 2774: auditoría de seguridad y robustez «al límite» (modelos de las auditorías más estrictas)
Pedido del dueño (25-10): «investiga cuáles son las auditorías más serias, severas y estrictas, qué implican sus
modelos de prueba, y haz eso con NEXO; pruebas enfocadas a llevar la app al límite en robustez y seguridad». Se
investigaron MASVS 2.1/MASTG/MASA, CSPN (ANSSI), Common Criteria/NIAP y FIPS 140-3, y los criptoanálisis públicos de la
competencia (Threema, Matrix, Bridgefy, Signal, bitchat, WhatsApp) y de Bluetooth (SweynTooth, BLESA, KNOB); el informe
completo, el modelo de amenazas y el plan están en `docs/AUDITORIA.md`. Cada fallo se reprodujo antes de arreglarlo.

Arreglado y comprobado (simulador/JVM):
- **N1/N2 Wi-Fi, el hub TCP (`LanHub`)**: el saludo se leía reservando hasta 48 MB sin autenticar (con unas pocas
  conexiones así, la app se quedaba sin memoria y Android la cerraba) y se abría un hilo por conexión sin tope. Ahora el
  saludo tiene tope de 8 KB y las conexiones sin saludar están acotadas (64; se cierra la más vieja). Un contacto de
  verdad entra igual.
- **N3 Wi-Fi, archivos grandes (`BigFile.serve`)**: una conexión ajena con basura, o que se quedaba callada, abortaba
  la recepción del archivo del contacto. Ahora cada conexión se atiende por separado y una ajena se descarta.
- **N4 Wi-Fi, escaneo de la red (`LanBeacon`)**: una inundación de preguntas con marca distinta hacía crecer el mapa de
  vistos sin fin y disparaba un aviso y una respuesta por paquete. Ahora el mapa está acotado (2048) y hay presupuesto
  por ventana (256/10 s).
- **N5 cierre a distancia con JSON muy anidado**: el analizador del sistema es recursivo; `[[[[…` provocaba un
  `StackOverflowError` que se escapaba de los `try/catch` y mataba la app con un solo paquete. Cribado `SafeJson`
  (tamaño y profundidad) antes de analizar cualquier JSON ajeno (Bluetooth, Wi-Fi, relés) + `catch(Throwable)`.
- **N6 otra app descolgaba una llamada**: la pantalla principal está exportada; otra app podía abrirla con el extra
  «contestar». Ahora solo se hace caso si el intent trae un testigo al azar que va dentro del PendingIntent del aviso.
- **N7 anuncio Bluetooth con ID mal formado**: se valida contra la forma de un NEXO ID o código rotativo antes de usarlo
  (no envenena el mapa NEXO ID→dirección).
- **C2 grupos**: cualquier miembro podía reescribir la lista entera (echar a otros, meter desconocidos) y colar la clave
  de un tercero. Ahora la lista se fija al crear el grupo (la única baja es salir) y las tarjetas solo valen para
  miembros de la lista.
- **R1 muerte del WebView**: Capacitor 5 cerraba la app si el proceso del WebView moría; `MainActivity` ahora lo rehace
  (los chats se recargan del disco) y la app no se cierra.

Pruebas nuevas: Kotlin `LanHubAttackTest`, `BigFileAttackTest`, `LanBeaconAttackTest`, `SafeJsonTest`, `ParserFuzzTest`
(fuzzing con semilla de los analizadores: 90 000 entradas adversarias sin reventar); simulador `groupforge.js` (en la
batería). Documentado para rondas propias (cambio de protocolo + prueba en los dos teléfonos): **C1** confirmaciones
(✓✓) sin autenticar —la prioridad P0—, H3 tarjetas de contacto sin verificar, H4 Fénix sin autenticar, y varios leves
(ver `docs/AUDITORIA.md`).

## Ronda 2772: informe del dueño del 25-10 (videollamada, micrófono, pantalla apagada) y plan de negocio
Pedido del dueño (25-10): primero un plan de negocio (cómo gana dinero la competencia y un plan para NEXO con pagos sin
licencia): `docs/PLAN_NEGOCIO.md` (subido aparte, sin APK). Después, uno a uno, investigando cómo lo hace la
competencia (código de Chrome, WebRTC, Signal, Telegram y Android) y "mejor que la competencia si puedes":
1. **El vídeo del otro no estaba en espejo** ("si volteo la cara a la derecha, en el otro se ve al lado contrario").
   Reproducido en `videoframe.js` (nueva): videollamada de verdad en Chromium con una cámara falsa en vertical (480x640,
   como un teléfono en la mano) que muestra rojo | azul y un cuadrado blanco. Lo que hacen las demás: todas (Zoom,
   Webex, Meet, FaceTime, Signal, Telegram) ponen en espejo solo la vista propia y al otro le llega la imagen real
   (por eso, con los dos teléfonos juntos, una se mueve al revés que la otra); mandarla en espejo haría que un papel o
   una camiseta se leyeran al revés. NEXO ahora: el espejo lo pone el que recibe, solo si la cámara del otro es la de
   delante (lo dice su estado `c`, con `front`), activado por defecto como pidió el dueño y con interruptor en
   **Perfil → Videollamadas**; con la cámara de detrás, nunca. Ninguna de las grandes deja elegirlo.
2. **"La imagen se ve muy cerca, un poco deformada"**. Causa: la imagen se metía a la fuerza en 320x240 apaisado; con
   el teléfono en vertical el navegador recortaba la de la cámara (o se estiraba) y el otro, para llenar su pantalla
   vertical, solo veía el 35 % (como un zoom de casi 3 veces). Ahora la cámara se pide sin recortes
   (`resizeMode: 'none'`), la imagen conserva su forma (en vertical, 360x480; si se gira el teléfono, el codificador
   se rehace con la forma nueva y la imagen siguiente es completa), el que recibe la dibuja con su forma y la muestra
   entera salvo que a toda la pantalla se vea al menos el 78 % (dos toques la cambian). Batería: codificador en modo
   tiempo real y una imagen completa cada 5 s (antes 2 s); 15 fps (Signal y Telegram capturan 1280x720 a 30 fps).
3. **Micrófono: "aplicar filtros" y "si uno habla, el micrófono del otro se baja un porcentaje"**. Investigación:
   Chrome en Android usa el cancelador de eco del teléfono si lo tiene, y solo trata como voz de llamada la salida de
   audio creada después de abrir el micrófono; NEXO la creaba antes (como música): el cancelador podía no tenerla en
   cuenta. Ahora: primero el micrófono y luego la salida; filtros nuevos (`call_voice_fx.js`): mientras suena el otro
   el micrófono baja 12 dB (al 25 %), salvo que se hable a la vez claramente por encima del eco (entonces solo 3 dB
   durante 200 ms: la "conversación completa a la vez" de la norma P.340, como el cancelador de WebRTC); mide solo el
   retraso y la fuerza del eco; con cascos o Bluetooth no baja; puerta de ruido suave (−10 dB en silencio, abre en
   5 ms); paso alto a 60 Hz (Chrome ya pone uno a 100 Hz); limitador. Opus en modo voz y complejidad 5. Diagnóstico:
   `[CALL] Al colgar: … filtros: bajado X %, los dos Y %, silencio Z %, eco N dB a M ms, cancelador de eco …, Opus voz`.
   Pruebas: `voicefx.js` (nueva: eco −12 dB; hablando los dos, la voz propia −2,5 dB; con cascos y sin el otro, 0 dB;
   ruido −10 dB; principio de palabra al 99 %; retumbo de 30 Hz −12 dB; voz grave de 120 Hz −0,3 dB; ~3,5 ms de
   proceso por segundo de audio) y `callmedia.js` caso 22 (dentro de la llamada: eco −12 dB, voz propia −2 dB; con la
   2771, sin filtros: 0 dB).
4. **Con Wi-Fi y la pantalla apagada no llegaban mensajes ni avisos** (llegaban al encenderla). Investigación (código de
   Android): con la pantalla apagada el teléfono duerme en cuanto nada lo mantiene despierto; un paquete lo despierta un
   instante y NEXO no pedía seguir despierto: la app no llegaba a descifrar, confirmar (✓✓) ni avisar; el aviso de
   respaldo del nativo (4 s) usaba un reloj que no avanza dormido. Reproducido en `notify.js` (fase nueva "pantalla
   apagada", con el teléfono dormido modelado en `native_mock.js`): con el comportamiento anterior, ni llega, ni avisa, ni
   ✓✓ hasta encender la pantalla; ahora, aviso en 0,2 s y entregado. Arreglo (Kotlin): al llegar un mensaje con la app
   en segundo plano, el teléfono se queda despierto 15 s (se renueva con cada mensaje; Android lo permite en reposo a
   las apps con servicio en primer plano; Google Play vigila que no pase de 2 h al día). Además, el latido del Wi-Fi
   mezclaba un reloj que se para dormido con otro que no: al despertar cortaba enlaces sanos; ahora mide con
   `elapsedRealtime` y, si el teléfono durmió, pregunta antes de cortar (ping y margen de 8 s): Kotlin `LanHubTest`, 3
   pruebas nuevas. Perfil → "Avisos con la pantalla apagada" muestra los ajustes propios del fabricante (Vivo: inicio
   automático y alto consumo en segundo plano; Samsung: batería sin restricciones; también Xiaomi, Oppo, Huawei) con
   "Abrir". Diagnóstico `[ENERGIA]` al pasar a segundo plano y al volver (segundo plano permitido, reposo, restricción,
   grupo de uso de Android, despertares por mensajes, fabricante).
5. **Escaneo**: el dueño no lo ha probado con la última versión: en sus pruebas de la 2772.
- Pruebas nuevas en la batería: `videoframe.js`, `voicefx.js` y `notify.js --via=lan` (avisos por Wi-Fi: segundo plano,
  congelada, pantalla apagada y cerrada); la fase de pantalla apagada también en `--via=ble` y `--via=jump`;
  `callmedia.js` casos 21 (girar el teléfono) y 22 (eco); `alerts.js` (fila del fabricante). Llamadas de verdad en
  Chromium (`calls_browser.js`: voz Opus, vídeo y μ-law) con los filtros: bien. Batería 50/50 (antes 47), Kotlin 71/71
  (antes 68). Índice de robustez 44 (`ROBUSTEZ.md` §4).
- En GitHub, la compilación 2772 paró en las pruebas: `videoframe.js` necesita Chromium (Playwright), que allí no
  estaba (aquí sí). El workflow lo instala ahora antes de las pruebas (`npx playwright install --with-deps chromium`,
  `tests/sim/package.json` con `playwright` 1.56.1, la misma versión que aquí). La APK sale como 2773.
- No se puede comprobar aquí (en el teléfono): que el cancelador de eco del teléfono funcione mejor con la salida nueva;
  el consumo de batería; si el Vivo congela NEXO con la pantalla apagada aunque se mantenga despierto.

## 25-10-2026: registro y medición de robustez (sin build; pedido del dueño)
Al cerrar la revisión 1 (builds 2766–2771), el dueño pidió un registro, una medición del estado de robustez y tareas
diarias: `docs/ROBUSTEZ.md` (cómo se mide, registro de la revisión 1, medición inicial, historial, rutina diaria y
calendario de la revisión 2). La medición sale de `tests/sim/robustez.js` con el catálogo `tests/sim/robustez.json`
(86 fallos conocidos por área con la prueba que los vigila, estado en los teléfonos, 26 puntos débiles abiertos y los
fallos de la última revisión) y la salida de la batería. **Medición inicial: 45,3 sobre 100** (pruebas 23,9/35,
teléfonos 6/35, puntos débiles 12,9/20, estabilidad 2,5/10). Se pasaron también las 17 pruebas del simulador que no
están en la batería (`ROBUSTEZ.md` §7): todas se comportan como se espera con la 2771, sin fallos de la app; dos
pruebas estaban desfasadas: `location.js` buscaba "Ubicacion" sin tilde (corregida) y `mixed.js` aún espera recibir
mensajes sin cifrar de una build vieja, que desde la 2768 se descartan a propósito (se corrige al meterla en la batería).

## Ronda 2771: revisión completa, parte 4 (interfaz)
Revisión de las pantallas en capturas (Chromium, 393 y 360 px de ancho, como el Vivo) y de los textos de todo el código.
Cada fallo se reprodujo con la 2770 en `ui4.js` (3 teléfonos: Vivo agrega al Galaxy; la Tablet cerca sin agregar), que
falla en 15 de sus 18 comprobaciones con la 2770 y pasa ahora.
1. **"Agregar contactos"**: las secciones "En línea ahora" y "Recientes" no se rellenaban nunca: decía "No hay contactos.
   Presiona Buscar para encontrar dispositivos." aunque los hubiera. Ahora "Tus contactos" (los últimos agregados
   primero, con su NEXO ID) y "En línea ahora"; tocar uno abre su chat.
2. **El buscador era un dibujo**: ahora filtra tus contactos y los teléfonos encontrados por nombre o NEXO ID ("Nadie
   coincide con …").
3. **Avisos rotos**: una nota de voz en un teléfono sin micrófono decía "Permiso de Microfono no encontrado denegado.";
   "Demasiado grande para un grupo…" salía como "Permiso de Demasiado grande… denegado.". Ahora el mensaje tal cual, y
   "Permiso de micrófono denegado." con dónde darlo en otra línea.
4. **Textos**: "En linea"/"Offline" → "En línea"/"Sin conexión"; "BLE ON | N conectados" → "Bluetooth activo · N
   conectados" (teléfonos, no enlaces: con dos teléfonos decía 3); "Activalo"; la pantalla de permisos ("Permisos BLE
   Requeridos", "comunicacion P2P", "continuara automaticamente", "Configuracion", "Continuar sin BLE"); Ubicación.
5. **Sin contactos**: el aviso decía "Presiona el botón +" (el botón es una burbuja) y salía abajo junto al botón: ahora
   en medio y "Toca el botón redondo de abajo…".
6. **El botón redondo**, con teléfonos nuevos cerca, cambiaba su icono por un número suelto: ahora icono y número en una
   burbuja.
7. **Perfil**: el círculo mostraba la primera cifra del NEXO ID ("0"): ahora las iniciales del nombre del teléfono y
   "Tus contactos te ven como «…»".
8. **"Cambiar nombre"** en el menú ⋮ de un contacto: ya se podía tocando el nombre en el chat, pero nada lo decía. El
   nombre puesto se queda aunque el otro vuelva a conectar (comprobado).
9. Diagnóstico de llamada: la línea de estado pasa a `[CALL] Estado: micrófono con pista …` (con la 2769 era
   `[CALL] Micrófono: pista …`, que se confundía con los avisos de error).
- También: videollamada y llamada de voz de verdad en Chromium (`calls_browser.js`, cámara y micrófono de prueba) con
  la 2769–2771: imagen en los dos sentidos (135 imágenes cada uno), 8–9 s de voz cada uno, Opus y μ-law, girar y
  colgar; y capturas de la pantalla de videollamada.
- Pruebas: `ui4.js` (nueva, en `ci.js`). Batería 47/47.
- Pendiente (decisión del dueño): "Tu nombre" en Perfil (hoy tus contactos ven el nombre Bluetooth del teléfono).

## Ronda 2770: llamadas con la pantalla bloqueada o en otra app (micrófono), foco de audio y tono en silencio
Android 11 y posteriores (NEXO apunta a Android 14) solo dejan usar el micrófono a una app que no está a la vista si su
servicio en primer plano es de tipo micrófono; si no, la app graba silencio. El servicio de NEXO (`BleService`) era solo
de tipo "dispositivo conectado": durante una llamada, al bloquear la pantalla con el botón o ir a otra app, el otro
dejaba de oír, sin ningún aviso. (Es el comportamiento documentado de Android; en el teléfono aún no se ha comprobado:
era la prueba (7) de la 2768.)
1. Manifiesto: el servicio también puede ser de tipo micrófono (y su permiso). `BleService.foreground()`: en llamada,
   "dispositivo conectado + micrófono"; fuera de ella, solo "dispositivo conectado", siempre con el tipo explícito (con
   el micrófono en el manifiesto, arrancar sin tipo lo pediría también y fallaría cuando el servicio se reinicia solo en
   segundo plano). Si la llamada empieza con NEXO en segundo plano (Android no lo deja), se reintenta al volver a la app.
   En Android 8–10 basta con el servicio. Diagnóstico: `[CALL] Sonido del teléfono: …; en segundo plano: micrófono`.
2. Foco de audio: durante la llamada la música o el vídeo de otra app se paran y vuelven al colgar (antes seguían
   sonando encima de la llamada). Diagnóstico: `foco de audio: sí`.
3. Si NEXO se cierra con una llamada en curso, se suelta todo lo de la llamada: el modo de audio, el foco, el servicio
   de micrófono y el sensor de proximidad (con la 2769 este podía seguir apagando la pantalla al taparlo hasta 4 h).
4. **Tono de una llamada entrante** (`calls2.js timbre`): con la 2769 la app pitaba siempre (como multimedia), también
   con el teléfono en silencio, en vibración o en "No molestar", y con la app en segundo plano sonaba a la vez que el
   aviso del sistema. Ahora pregunta el modo al nativo (`ringerMode`): en silencio o "No molestar", sin tono; en
   vibración, solo vibra (se añade el permiso `VIBRATE`: sin él, el navegador de la app no vibra); con la app oculta suena
   solo el aviso del sistema.
- Pruebas: en el simulador se comprueba que la app pide el servicio de micrófono y el foco al empezar y los quita al
  colgar, y que salen en el diagnóstico (`calls2.js sin-micro`), y el tono en los cinco casos (`calls2.js timbre`,
  falla con la 2769); el efecto en Android, solo en el teléfono (PENDIENTES §1). Batería 46/46, Kotlin 68/68.

## Ronda 2769: videollamada robusta (informe del dueño: Vivo ↔ S24)
Informe con la 2768: en videollamadas entre el Vivo y el S24, a veces el S24 salía como sin cámara, el Vivo veía negro
y no se le oía; tras apagar y encender la cámara (y el micrófono) volvía. Sin el diagnóstico de esa llamada no se sabe
cuál de las causas fue; se reprodujeron en el simulador (`callmedia.js`, con el `call_media.js` real y un navegador
falso que puede tener la cámara o el micrófono ocupados, cortarlos, dejar de dar imágenes o romper los codificadores)
todas las que dan esos síntomas. Con la 2768 fallan 15 de sus 20 casos; ahora pasan los 20:
1. **Cámara ocupada un momento al empezar** (la del chat, la de otra app o la que el sistema aún no soltó): con la 2768
   no había vídeo en toda la llamada ("sin cámara"). Ahora se reintenta a los 0,4/1/2 s; si sigue ocupada, la llamada
   sigue con voz y se reintenta cada 4 s (con 5 s ocupada, el vídeo entró solo).
2. **Micrófono ocupado**: se pedían juntos micrófono y cámara, y un fallo de uno tumbaba los dos. Ahora van por separado,
   cada uno con sus reintentos. **Sin micrófono** (permiso quitado): antes no salía nada y el otro cortaba a los 12 s
   ("Se cortó") sin saber por qué; ahora sale un "sigo aquí" sin voz cada 2 s, la llamada sigue (se oye al otro) y
   los dos ven el aviso: "El micrófono de B no funciona: no se le oye" / "Sin micrófono (sin permiso): A no te oye"
   (`calls2.js sin-micro`: 25 s en llamada).
3. **Cámara cortada por el sistema** (pista terminada): antes negro hasta colgar; ahora se reabre (vuelve en 0,5 s).
4. **Cámara sin imágenes** (pista viva pero sin fotogramas, típico tras pasar a segundo plano): antes negro hasta
   apagarla y encenderla, justo lo que hizo el dueño; ahora se reanuda y, si sigue igual, se reabre sola (~5 s).
5. **Audio en pausa** (el sistema suspende el audio de la página): antes silencio; ahora se reanuda (~2 s).
6. **Fallo de los codificadores** de vídeo o de voz (Opus): antes quedaban cerrados y no salía nada (sin imagen o sin
   voz hasta colgar); ahora se rehacen (el de vídeo, en 0,4 s), como mucho uno por segundo si fallan siempre.
   **Fallo del decodificador de voz** (lo que llega del otro): con la 2768, tras un solo fallo no se oía nada más hasta
   colgar (0 de 5 paquetes sonaron); ahora se rehace con el siguiente paquete (5 de 5).
7. **Fallo del decodificador del otro**: antes negro hasta colgar; ahora se rehace y pide una imagen completa (señal
   `k`). **Decodificador parado** (llega vídeo y no sale imagen): antes negro hasta colgar; ahora a los 3–4 s pide una
   imagen completa y, si sigue, a los 6 s pone un decodificador nuevo (se volvió a ver).
8. **Pantalla**: en vez de negro, la foto del otro y el motivo ("Cámara apagada", "Sin cámara: solo voz", "Su cámara no
   está disponible", "Esperando imagen…"; si la llamada pasa a Bluetooth, donde no va el vídeo, "Sin Wi-Fi: solo voz (el
   vídeo vuelve con el Wi-Fi)"); arriba, los avisos de los dos (micrófono o cámara sin funcionar), con el motivo en
   palabras ("sin permiso", "ocupado por otra app"). Cada lado manda el estado de su cámara y su micrófono (señal `c`,
   cifrada, cada 5 s; `calls2.js video-estado`).
9. **Pantalla encendida en llamada y sensor de proximidad** (Kotlin `callScreen`): si la pantalla se apaga sola a media
   videollamada, Android corta la cámara y el micrófono; ahora no se apaga durante la llamada y, con el auricular, se
   apaga al acercar la oreja y vuelve al apartarla. Solo se comprueba en el teléfono.
10. **La cámara del chat** (si estaba abierta) se cierra al empezar la llamada: tenía la cámara y el micrófono.
11. Diagnóstico: línea `[CALL] Micrófono: pista …; cámara …, pista …, imagen local …, codificador …, imágenes …; del otro:
    decodificadas …, decodificador …, su cámara …` para ver en el teléfono qué falló; los "sigo aquí" van aparte (no
    cuentan como voz enviada o recibida).
- Pruebas: `callmedia.js` (20 casos, 15 fallan con la 2768) y `calls2.js` `video-estado` y `sin-micro` (fallan con la
  2768). Batería 45/45, Kotlin 68/68.
- Pendiente: el diagnóstico de ambos teléfonos tras una videollamada que falle, para confirmar cuál fue la causa.

## Ronda 2768: revisión completa, parte 3 (llamadas y videollamadas)
Un agente revisó `calls.js`, `calls_ui.js`, `call_media.js`, el camino de las señales y el nativo con 20 escenarios
nuevos. Cada fallo se reprodujo con la 2767 y se comprobó con el arreglo (las cifras son de esas dos corridas; los
escenarios clave pasaron a `tests/sim`: `spoof.js`, `callmedia.js` y `calls2.js`, que fallan con la 2767 y pasan ahora).
1. **Suplantación (seguridad, grave)** (`spoof.js`): el servidor Bluetooth acepta escrituras de cualquiera y un mensaje
   sin cifrar se tomaba como del contacto que decía ser. Con la 2767, desde un teléfono ajeno M: un texto corto, un
   texto largo y una foto, sin cifrar y "de A", se guardaron como de A (los textos, además, se veían en su chat); una
   oferta de llamada falsa sonó con el nombre de A (si B contestaba, su voz salía cifrada con la clave de M: M descifró
   10 de 10 paquetes); un "colgar" falso cortó una llamada real; la conexión de M quedó apuntada como de A. Ahora lo
   que llega sin cifrar diciendo ser de un contacto se descarta (con aviso `[E2E] … descartado` en el registro), no
   apunta la conexión, las señales de llamada solo valen cifradas, y lo de verdad de A sigue llegando.
2. **"Rechazar" con la app cerrada** (`calls2.js rechazar-cerrada`; Kotlin `CallDedupe`, prueba JVM): el aviso volvía a
   sonar con cada reenvío de la oferta (9 avisos por una llamada); ahora un aviso por oferta (por el id de su mensaje) y
   no vuelve a sonar. Con la app viva en segundo plano, "Rechazar" le llega a la app, que rechaza cifrado: el que llama
   ve "Rechazada" en 0,6 s (`rechazar-viva`; antes, "Llamando…" hasta "No contesta"). Con la app cerrada el que llama
   sigue sin enterarse (no hay claves sin la app): decisión del dueño (PENDIENTES §4.7).
3. **Se contestaba sola** (`contestar-viejo`): "Contestar" tocado en el aviso de una llamada ya colgada hacía que la
   siguiente de ese contacto se contestara sola con el micrófono abierto. Ahora lo tocado va atado a esa oferta (el
   nativo guarda su id) y se descarta a los 15 s sin llamada.
4. **El aviso seguía sonando y NEXO quedaba encima del bloqueo** (`bloqueo`) cuando la app no hacía sonar la oferta
   (ocupado, vieja, repetida): con la 2767, una llamada durante otra hacía sonar el aviso encima de la llamada en curso
   y seguía a los 11 s; NEXO abierto por el aviso de una llamada que ya no existía seguía encima del bloqueo. Ahora el
   aviso se quita y, sin llamada, NEXO vuelve detrás del bloqueo (también a los 15 s de abrirse).
5. **Oferta guardada** (`oferta-vieja`): la oferta que no salió quedaba en el registro de envíos y, al reiniciar el que
   llamaba la app, al otro le sonaba una llamada que ya no existía (o "Llamada perdida" y un "Mensaje nuevo" falso).
   Ahora las señales de llamada no se guardan y la oferta se cancela al colgar.
6. **Relojes desfasados** (`reloj`): con el reloj del otro 90 s adelantado (sin hora de red) nunca sonaba; ahora quien
   recibe pregunta al que llama si sigue (señal `ring`) en vez de comparar relojes.
7. **Los dos se llaman a la vez** (`cruce`): "Ocupado" en los dos; ahora gana una y los dos quedan en llamada.
8. **Wi-Fi caído en un solo teléfono sin cierre limpio** (`wifi-uno`): el otro dejaba de oír y cortaba a los 12 s; ahora
   cada lado sigue el camino por el que le llega la voz y vuelve en ~0,3 s.
9. **Paquetes de voz grabados y repetidos** (`repetida`): 20 de 20 se volvían a oír; ahora 0.
10. **Micrófono y cámara** (`callmedia.js`, con el `call_media.js` real): colgar mientras se abría el micrófono lo
    dejaba abierto (12 paquetes de voz después de colgar); girar la cámara y colgar la dejaba encendida; dos toques en
    "Girar" abrían 2 cámaras; una videollamada sin cámara (denegada u ocupada) no tenía ni voz; una ráfaga de voz tras
    un atasco sonaba con hasta 4 trozos a la vez. Ahora: nada abierto, solo voz si no hay cámara, 1 trozo a la vez.
11. Una llamada que llega menos de 1,4 s después de otra sonaba sin botón "Contestar": arreglado.
- Pendiente (PENDIENTES §6): la voz por Bluetooth con MTU pequeño (con MTU 23, 6,8 s de retraso y solo 32 de 161
  paquetes; con MTU 185, 66 ms; un teléfono sin Opus con MTU 185, 3,2 s): hace falta un "carril de voz" nativo; y los
  riesgos que solo se ven en el teléfono (micrófono con la pantalla apagada en Android 11+, sensor de proximidad, tono
  con el teléfono en silencio, foco de audio).
- Pruebas: `spoof.js`, `callmedia.js` y `calls2.js` (9 casos) en `ci.js`; Kotlin `CallDedupeTest`. Batería 43/43,
  Kotlin 68/68; `fenix.js` (fuera de `ci.js`) también pasa con el descarte de lo no cifrado (cuenta, 6 de 6 mensajes y
  2 de 2 archivos recuperados). La parte nativa (avisos de llamada) solo se compila en GitHub.

## Ronda 2767: revisión completa, parte 2 (mensajes y archivos)
Revisión de los envíos y la recepción (cortos, largos, archivos, lo pendiente). Cada fallo se reprodujo primero en el
simulador con el código de la 2766 y se comprobó después con el arreglo.
- **Textos largos que se perdían mostrando "entregado"** (`pending.js`, nueva). B lejos; A escribe textos cortos y largos
  y graba una nota de voz; la app de A se reinicia (como cuando el Vivo la cierra) y B vuelve. Con la 2766: el texto
  largo L3 no llegó nunca y en A constaba como entregado; B no pudo descifrar uno; cada texto largo salió 4–6 veces a
  la vez; al rato dos burbujas pasaron a "!" (una sí había llegado). Causa: al reconectar se pedía 4–6 veces seguidas
  reenviar lo pendiente y cada vuelta lo mandaba sin mirar las demás; cada envío cifraba el texto otra vez (distinto)
  y B mezclaba los trozos de los dos, no lo podía descifrar, pero ya había confirmado. Arreglo: una sola vuelta de
  reenvíos a la vez por contacto, que mira justo antes de cada mensaje si ya está saliendo o entregado; el mismo
  mensaje no sale dos veces a la vez (se espera al envío en curso); cada intento marca sus trozos y B no mezcla dos
  intentos; **B confirma un mensaje o un archivo cuando ya lo ha podido descifrar** (si no puede, A no lo da por
  entregado); la sincronización al reconectar deja lo pendiente a esa vuelta (antes lo mandaba a la vez). Con el
  arreglo: todo llega en 3,4 s, una sola vez y legible, en el orden en que se escribió, ✓✓ en A y ninguna "!".
- **Nota de voz pendiente que llegaba como el texto "[adjunto]"** (misma prueba): el historial guarda el audio aparte y
  el texto como "[adjunto]", y al reenviarla se mandaba ese texto. Ahora va como nota de voz (también la ubicación). Un
  adjunto cuyo archivo no se puede leer ya no sale como "[adjunto]": queda como no enviado. Al reenviar directo lo que
  había salido por Jump, la nota de voz iba como archivo: ahora como nota de voz.
- **Transferencias de más de 10 min cortadas aunque avanzaran**: 700 KB por un Bluetooth de MTU 23 se cortaban a los
  631 s (al 44 %, "○ 44%") y volvían a empezar. Ahora cuenta el tiempo sin confirmaciones (no desde el principio) y el
  tiempo máximo se alarga mientras avanza (hasta 2 h): llegó a los 1.380 s sin cortes.
- **Wi-Fi caído a mitad de una foto con un Bluetooth lento**: seguía con los trozos del Wi-Fi (24 KB), que por un
  Bluetooth de MTU 23 tardan más de lo que la parte nativa del otro espera a juntarlos (los descartaba): 300 KB no
  llegaban ni en 600 s (43 paquetes descartados en el otro). Ahora empieza de nuevo por el Bluetooth con trozos a su
  medida: con MTU 23 llega en 587 s (lo que da un Bluetooth así); con MTU 185, en 55 s (antes 64 s).
- **Corte largo del Wi-Fi** (`wificut.js`, nueva): durante los 15 s que se espera a que vuelva (regla del dueño), un
  texto escrito en ese momento salía con "!" unos 10 s, aunque luego llegaba por Bluetooth. Ahora queda pendiente (con
  el reloj) y llega igual (a los 15 s). En un corte breve, como antes: llega en cuanto vuelve el Wi-Fi.
- **Orden en el chat** (`order.js`, nueva): un texto largo o un archivo llevaba la hora del reloj del otro teléfono y uno
  corto la de llegada; con el reloj de A 2 min adelantado (sin red los relojes no se ajustan), en B salía "respuesta,
  corto, largo". Ahora todo lleva la hora de llegada (la del primer trozo): "largo, respuesta, corto". Con la app
  cerrada, lo guardado por la parte nativa salía con la hora de abrir la app: ahora con la hora a la que llegó
  (`BgInbox.drain` la conserva; Kotlin, `BgInboxTest`).
- Un reintento que pisaba la entrada pendiente del mismo mensaje (los reintentos se gastaban el doble de rápido y el
  primero se quedaba esperando para siempre): ahora espera con el envío en curso. Los reenvíos de lo pendiente dicen a
  quién van (en la 2766 faltaba en ese camino).
- Pruebas: `pending.js`, `order.js` y `wificut.js` (en `ci.js`); Kotlin: `BgInboxTest` con la hora (65/65).

## Ronda 2766: revisión completa, parte 1 (escaneo, agregar, conexión) y mejoras pedidas
Pedido del dueño (24-10): revisar la app por partes (escaneo → agregar → conexión → mensajes y archivos → llamadas →
interfaz) y, de paso, mejorar (foto de perfil; avisos y llamadas con la app en segundo plano o cerrada y con la pantalla
apagada, que la enciendan). Cada fallo se reprodujo primero en el simulador con el código de la 2765 y se comprobó
después con el arreglo (las cifras son de esas dos corridas).
- **Ningún ping se contestaba** (`idle.js`): el ping y el pong se descartaban antes de llegar a su respuesta, así que el
  vigilante cortaba cada ~30 s todo enlace Bluetooth sin tráfico ("sin respuesta a 2 pings") y lo rehacía: el "Peer
  ready cada ~30 s" del diagnóstico de la ronda 2760 y los enlaces de MTU 23 al rehacerse. 2765, 80 s sin escribirse:
  7 pings, 0 pongs, 3 cortes; ahora 7 pongs, ningún corte y el mismo enlace (por Bluetooth y con Wi-Fi).
- **El arreglo de la 2764 no bastaba** (`misroute.js`, caso 4 nuevo): con el chat del S24 abierto por la conexión que
  resultó ser del Vivo y el S24 ya lejos, un archivo salía por ella **cifrado para el Vivo**: el Vivo lo guardaba y avisaba
  "📎 Archivo". Ahora cada texto y archivo dice desde el principio para quién es: se cifra para él y solo sale por una
  conexión suya; si no la hay, queda pendiente (llegó al S24 al volver).
- **Envíos por trozos que se reintentaban sin fin** por una conexión que ya no servía o que era de otro (hasta el tiempo
  máximo: 45 s un texto largo, hasta 15 min un archivo): ahora siguen por el camino bueno o quedan pendientes. En
  `misroute.js`, la llamada hecha con la conexión equivocada ahora suena en el teléfono correcto (antes no sonaba en
  ninguno).
- **Volver a la app borraba el enlace Wi-Fi** (`resume.js`; p. ej. tras elegir una foto en la galería): ya no se mandaba
  nada por Wi-Fi; un texto tardó 17 s (por Bluetooth) y un archivo de 120 KB no llegó en 60 s. Ahora: 0,2 s y 0,8 s.
- **BUSCAR se quedaba colgado**: el nativo para solo a los 15 s sin avisar y la app seguía "buscando" (botón en PARAR,
  "Agregar" sin nadie nuevo y ninguna búsqueda automática más). Ahora el nativo lo avisa (`onScanStopped`) y, por si
  acaso, la app lo da por parado a los 16 s.
- **Reconexión sin esperas**: con el otro fuera de alcance se reintentaba cada ~3 s sin fin y se buscaba en cuanto
  acababa la búsqueda anterior (Android ignora más de 5 búsquedas en 30 s). En 40 s: 21 intentos y 7 búsquedas con la
  2765; ahora 5 y 4 (esperas de 2, 4, 8, 16 y 30 s; se deja a los ~2,5 min o si ya está por otro camino; la búsqueda de
  contactos perdidos sigue aparte).
- **Caídas reales del Bluetooth** (Kotlin): las que llegan como error (fuera de alcance, el otro la cerró) no se
  avisaban a la app, que seguía viendo al contacto "en línea" y mandándole por ahí hasta que el vigilante cortaba. Ahora
  se avisa y se limpia como una desconexión normal. Solo se compila en GitHub (no hay Android aquí).
- **Tor** ("sin dirección .onion" en el diagnóstico del Vivo): la librería jtorctl devuelve `onionAddress` /
  `onionPrivKey` y se leían otros nombres. `TorOnion.kt` + prueba con la jtorctl de verdad (`TorOnionTest`).
- Mejoras pedidas:
  - **Foto de perfil** (`avatar.js`): Perfil → tocar el círculo → Cambiar foto / Quitar. Se recorta cuadrada (160 px,
    ~10–15 KB) y va cifrada a cada contacto por cualquier camino, sin aviso ni "no leído"; a un contacto nuevo, al
    conectar. Sale en la lista, en la fila de conectados, en la llamada y en Perfil.
  - **Pantalla apagada** (`alerts.js`): un mensaje nuevo enciende la pantalla (se puede quitar en Perfil); una llamada,
    siempre, y se ve encima de la pantalla de bloqueo hasta colgar. Perfil → "Avisos con la pantalla apagada":
    notificaciones, llamadas a pantalla completa y funcionar en segundo plano, con "Arreglar" si falta algo; al
    arrancar se pide una vez que el ahorro de batería no congele NEXO (el Vivo la congela). Lo nativo se comprueba en
    el teléfono.
  - Iniciales: un grupo "👥 Familia" salía "�F".
- Pruebas: `idle.js` (Bluetooth y Wi-Fi), `resume.js`, `misroute.js` con el caso 4, `alerts.js`, `avatar.js`, todas en
  `ci.js`. Batería completa 29/29 y Kotlin 65/65. Visto en la revisión y pendiente: `docs/PENDIENTES.md` §6 (lo más
  grave, para la 2767: textos largos pendientes que se pierden mostrando "entregado", reproducido en el simulador).

## Ronda 2764: lo de la tablet para el S24 llegaba al Vivo (informe grave del dueño)
Informe (2763, tablet + S24 + Vivo): al mandar archivos o llamar desde la tablet al S24, llegaba al Vivo; tras borrar
los contactos en la tablet, al buscar salían "desconocidos" y al pulsar agregar no pasaba nada. Diagnóstico recibido:
solo el del Vivo (sesión anterior, sin la prueba); falta el de la tablet para saber cómo se torció en ella.
- Causa (reproducida en `tests/sim/misroute.js`): cada conexión Bluetooth se identifica por su dirección (apuntada al
  escanear o guardada en el contacto); si en la tablet la conexión del Vivo quedaba apuntada como la del S24, lo del S24
  salía por la del Vivo, y el kx (que dice quién es) no lo corregía (solo apuntaba si no había nada). En el Vivo, la parte
  nativa (avisos con la app en segundo plano o cerrada, 2761–2763) avisaba "Mensaje nuevo" / "📎 Archivo" y **hacía sonar
  la llamada** de cualquier paquete directo, aunque no pudiera leerlo (va cifrado para el S24); y confirmaba ✓✓ a la
  tablet. En el simulador con el código anterior: C (el "Vivo") avisa del texto, del archivo y le suena la llamada; a B
  no le llega nada.
- Arreglo: cada mensaje y primer trozo directo lleva a quién va (`dn`, fijado la primera vez: un reintento sigue siendo
  para el mismo). El que no es: lo ignora (app: `_prePayload`; nativo: `BgInbox.classify` → nada: ni aviso, ni llamada,
  ni buzón, ni ✓✓) y contesta `ni` ("no soy yo"); el emisor corrige la conexión (`_remapDevice`) y lo manda por la buena
  (o queda pendiente). El kx corrige también a quién está apuntada la conexión (si su clave es la conocida). El buscador
  de conexiones no usa una dirección que consta como de otro contacto. Un trozo que sigue por una conexión que resultó
  de otro se corta y sigue por la buena.
- Visto al probarlo: un puente de Jump metía el sobre sellado de paso dentro de un mensaje suyo y el siguiente teléfono
  avisaba "Mensaje nuevo" (también podía pasar en el Vivo). Ahora el sobre va tal cual a quien lo entiende (kx ss:1).
- Escaneo (`tests/sim/readd.js`): el anuncio Bluetooth casi nunca trae el nombre y el nativo ponía "Unknown" (los
  "desconocidos"). Ahora "NEXO" + 4 letras del ID y, al conectar, el nombre del teléfono (kx `nm`). "Agregar" deja
  rastro en el diagnóstico (`[ADD]`) y, si ese teléfono ya no está en la lista, lo dice y vuelve a buscar (antes,
  nada).
- "No los ve" (el dueño no puede agregar a nadie en la tablet; reproducido en `readd.js`): tras borrar los contactos,
  los demás siguen teniendo a la tablet y anuncian su código rotativo, que la tablet ya no reconoce: no salía nadie
  (había que abrir "Agregar" en los dos). Ahora, con "Agregar" abierto, a cada NEXO cercano que no reconoce le pregunta
  quién es (kx con `rq`; si no está conectado, se conecta de paso como Jump) y sale en la lista con el nombre de su
  teléfono, aunque el otro no tenga "Agregar" abierto. Al borrar un contacto sus códigos dejan de reconocerse ya (antes,
  hasta ~30 s después). El simulador avisa del mismo teléfono cada segundo mientras dura el escaneo (como Android;
  antes una vez por escaneo).
- Pruebas: misroute.js y readd.js (añadidas a ci.js), BgInboxTest.paraOtroTelefonoNada (Kotlin 63/63).

## Ronda 2764: grupos con vídeo HD y archivos grandes; pantalla girada
- Grupos (PENDIENTES §2, faltaban): `src/ui/group_media.js`.
  - Archivo grande (más de ~1 MB en un grupo): se cifra a disco una vez (big_file.js, id del mensaje del grupo); el
    sobre del grupo lleva nombre, tamaño, la clave y quién lo manda (`big.from`); luego va a cada miembro con camino
    (mismo Wi-Fi, Wi-Fi Direct o L2CAP), en cola (una oferta a la vez por archivo). Quien no tiene camino ve "Toca para
    pedirlo" y la petición va a quien lo mandó. Reintentar en el emisor lo manda a quien falte.
  - Vídeo: la previa va al grupo como siempre; el HD va a cada miembro (como en un chat normal) cuando le llega la
    previa, y al reconectar si quedó pendiente; el receptor lo pone en el chat del grupo. Etiqueta "HD n/m" → "HD ✓".
  - Prueba: `tests/sim/group_media.js` (A, B en el mismo Wi-Fi, C solo Bluetooth: vídeo con HD a los dos; 24 MB a B
    al momento y a C cuando entra en el Wi-Fi y toca la tarjeta; idénticos por SHA-256). Añadida a ci.js.
- Pantalla girada (informe del dueño con captura, Samsung): a la izquierda salía una barra gris. Es la franja de la
  cámara frontal: Android no deja dibujar ahí a la app y la pinta con el fondo de la ventana, que en el tema del
  sistema (DayNight oscuro) es gris. Ahora el fondo de la ventana es el de NEXO (#070812, `nexo_colors.xml`,
  `styles.xml` y `MainActivity`). La parte web ya ocupaba todo el ancho (comprobado en Chromium a 851x393). No se
  puede reproducir en el simulador (es de Android): falta confirmarlo en el teléfono.

## Ronda 2763: toda la app con el estilo NEXO y la llamada entrante como una llamada del teléfono
- Estilo (pedido del dueño: como la pantalla de llamadas): `src/styles/nexo_theme.css` (se carga tras critical.css):
  fondo oscuro con brillo cian/violeta, superficies de cristal, degradado NEXO en lo principal, hojas que suben desde
  abajo con asa, menú de adjuntar como WhatsApp (iconos redondos de color con su nombre), burbujas con esquina,
  barra de escribir y cabecera del chat de cristal, Perfil en tarjetas (identidad con avatar, Fénix, Cambiar de
  teléfono, Seguridad, Internet, Diagnóstico), panel de agregar contactos (BUSCAR / PARAR), Nuevo grupo, Enviar
  contactos, Reenviar, avisos cortos y Pasar la cuenta. Botones de la cabecera con iconos dibujados (antes emojis).
  La barra de abajo (Chats · Gente · Mapa · Perfil), que no cabía en la pantalla, se oculta: Perfil y grupos están
  arriba. Capturas: `node tests/sim/ui_shots.js <build> <carpeta>` (13 pantallas en Chromium a 393x851).
- Arreglos vistos al revisar: en un chat de grupo salían los botones 📞/🎥; el aviso de cifrado del grupo decía
  "Esperando la clave de cifrado de GR…" (ahora "Mensajes del grupo cifrados…"); tocar el aviso de un grupo creaba
  un "contacto" con el id del grupo (ronda 2760).
- Llamada entrante como una llamada del teléfono (PENDIENTES §2 "sonar como una llamada"): canal "Llamadas" con el
  tono de llamada y vibración, aviso a pantalla completa si el sistema lo permite (USE_FULL_SCREEN_INTENT; si no,
  aviso grande), el tono se repite hasta atenderla (45 s), botones Contestar (abre NEXO y contesta sola) y Rechazar
  (`CallDeclineReceiver`: quita el aviso; al abrir NEXO la llamada se rechaza). Con la app cerrada (BgInbox `cl`),
  en segundo plano (nativo o la app) y congelada. Se quita al contestar, colgar o perderse. Pruebas: calls.js
  --closed (contestar y rechazar desde el aviso con la app cerrada).

- Avisos de grupo con el nombre del grupo (con la app cerrada, congelada o en segundo plano): el sobre de un mensaje de
  grupo lleva el id del grupo (`g`, también en el primer trozo de una foto); BgInbox.kt lo lee y el nativo busca el
  nombre en `nexo_groups.json` (`groupName`, 60 s de caché): "Familia: A: Mensaje nuevo" en vez de "A". Si el aviso
  nativo ya salió ("Mensaje nuevo") y luego la app sabe qué es ("📎 Archivo", "📷 Foto"), cambia el texto del mismo
  aviso sin sonar ni contar otra vez (`UnreadBook.refreshText`). Pruebas: notify.js en las 5 vías (grupo, Bluetooth,
  Jump, Wi-Fi, internet) en verde; Kotlin 62/62.
- La 2762 no salió: en GitHub falló `AtRestStoreTest.migrarArchivoGrandeNoBloqueaOtros` (mide que un guardado pequeño
  no espere a la migración de otro archivo; un guardado tardó 394 ms con el límite en 100 ms, por una pausa de la
  máquina). Rehecha sin depender de la velocidad: la migración del primer archivo se alarga 1,5 s con su candado puesto
  y los 40 guardados de otro archivo tienen que acabar mientras tanto. Comprobado que falla si el candado fuera común
  a todos los archivos (espera 5,5 s).

## Ronda 2762 (rama de trabajo): videollamada en la que un teléfono no oía nada
Informe del dueño (2758/2759, videollamada, mismo Wi-Fi): lo que se decía en el Samsung se oía en el Vivo; en el Samsung no
se oía nada (ni pegado a la oreja). El vídeo mantiene la llamada viva aunque no llegue voz (no se cortó).
Causas encontradas y corregidas (no se sabe cuál fue en sus teléfonos: el diagnóstico no guardaba las líneas [CALL]):
- Códec: la oferta decía siempre "Opus" (sin comprobarlo) y la respuesta no decía nada: si un teléfono no puede
  reproducir Opus, el otro se lo mandaba igual y no oía nada. Reproducido con `calls_browser.js --b-sin-opus` en la 2759
  (B: 0 s de audio). Ahora la oferta y la respuesta llevan lo que cada teléfono puede recibir (`callCodecs`).
- Salida de audio: la 2758/2759 ponía el modo llamada con el altavoz apagado también en videollamada; cada fabricante
  decide por dónde sale el audio de la app en ese modo. Ahora la videollamada va por altavoz (botón para cambiar) y en
  Android 12+ la salida se elige con `setCommunicationDevice` (callAudio devuelve salida y volúmenes).
- El audio se activa explícitamente (`ctx.resume`) si el sistema lo dejó en pausa.
- Diagnóstico: `[CALL]` entra en los eventos clave; cada 5 s y al colgar: voz enviada/recibida, vídeo, segundos
  reproducidos y nivel, micrófono activo y nivel, estado del audio, códecs de los dos y camino; al empezar, salida del
  teléfono y volúmenes de llamada y multimedia.
Pruebas: `calls_browser.js --b-sin-opus` y comprobación del altavoz en voz/vídeo; calls.js y calls_browser (voz, μ-law,
vídeo) en verde.
Pantalla de llamada nueva (pedido del dueño: como WhatsApp con el estilo de NEXO, `calls_ui.js` v2.0): fondo oscuro con
brillo cian/violeta, avatar del contacto (iniciales y colores de la lista) con ondas mientras suena, arriba "Cifrada de
extremo a extremo · por Wi-Fi / Bluetooth", abajo panel de cristal con iconos y nombres (Girar, Cámara, Silenciar,
Altavoz/Auricular, Colgar; entrante: Rechazar / Contestar). Videollamada: la imagen del otro a pantalla completa, la propia
pequeña (se arrastra a una esquina; tocarla cambia cuál va en grande), girar la cámara (`media.flip`), tocar la pantalla
oculta/muestra los controles (solos a los 5 s), "Conexión inestable…" si la voz no llega 3 s. Capturas en Chromium
(`CALL_SHOTS=<carpeta> node calls_browser.js …`); calls.js (Bluetooth, Wi-Fi, app cerrada) y calls_browser (voz, μ-law,
B sin Opus, vídeo + girar) en verde.

## Ronda 2760/2761: fotos por Bluetooth, camino de envío y avisos (diagnóstico de los dos teléfonos con la 2758/2759)
Diagnóstico (Vivo V2332 `NX1EBB23E7` y Samsung S24 Ultra `NX1N36C283`, Android 16):
- Las fotos SÍ llegaban por Wi-Fi (0,2 s) y por internet (3 s). Por Bluetooth no: el enlace con cada contacto se rehacía
  cada ~30 s (`Peer ready` una y otra vez, también con los dos en pantalla); al mandar, "contacto no listo
  (disconnected)" y la foto quedaba pendiente; varios enlaces con MTU 23 (~20 veces más lento).
- El vigilante (`_runSupervisorCycle`): ping cada 16 s, 3 s de espera, 2 fallos → corta y reconecta (~25–30 s). Su
  protección "no cortar con un archivo en curso" llamaba a `hasActiveTransfer`/`getOutgoingTransfers`, que NO existían
  en `ble_ack.js` (desde el principio): no protegía nada. No se ha podido reproducir en el simulador el corte cada 30 s
  (allí los pong vuelven): lo que dice el diagnóstico es que los pong no volvían a tiempo.
- El Vivo congela la app en segundo plano (31 min sin una línea; al volver, de golpe los trozos que le mandaron): ni
  confirma ni avisa (el aviso en segundo plano lo daba la app).
- Wi-Fi: a las 07:44 llevaba >12 s sin recibir (caído de verdad) y la app pasó a Bluetooth; la foto acabó saliendo por
  internet en 3 s.
Cambios:
- Regla del dueño (24-10, `PENDIENTES.md`): Wi-Fi de la misma red se mantiene; mala señal solo tras ~12 s seguidos
  (antes 8) y se vuelve tras ~30 s buenos (antes 8 s: "brincaba"); con mala señal → internet (los dos en Wi-Fi) y si no
  hay → Bluetooth; tras un corte se espera 15 s (antes 8). `lan.js` v1.3, `_lanDegraded` pasa lo que va en curso a
  internet. Con datos móviles, los textos siguen yendo por Bluetooth si está conectado y los archivos no van por datos.
- Bluetooth: `hasActiveTransfer` (envío o recepción en curso con ese teléfono → el vigilante no corta); cualquier
  paquete recibido cuenta como señal de vida; espera del pong 8 s (antes 3); cada corte del vigilante y cada
  desconexión quedan en el diagnóstico (`Enlace … desconectado`, `sin respuesta a 2 pings`); con varios enlaces listos
  con el mismo contacto se usa el de MTU más alto (`_bleReadyFor`).
- Avisos: el nativo mira lo que llega por Bluetooth o Wi-Fi con la app en segundo plano y, si a los 4 s la app no avisó
  de ese mensaje, avisa él (sin texto); el mismo mensaje no avisa dos veces y en un grupo el aviso pasa al grupo
  (`UnreadBook.hasMsg/takeFromOthers`). Con la app cerrada también avisa de lo que llega por Jump (`BgInbox.classify`
  con mi NEXO ID; con remitente oculto el aviso dice "NEXO" y al tocarlo solo abre la app). Señales de llamada (salvo la
  entrante) y textos largos ocultos llevan `q:1` (sin aviso). Tocar el aviso de un grupo abre el grupo (antes se creaba
  un "contacto" con el id del grupo).
Pruebas nuevas: `notify.js --via=ble|lan|net|tor|jump|group` (segundo plano, app congelada y cerrada; el simulador
congela la app con `setFrozen` y cierra el Wi-Fi al cerrar la app como el Kotlin), `route.js` (regla de camino),
`BgInboxTest.jumpParaMi`, `UnreadBookTest.pasaDeChatSinRepetir`. Batería bat48: todo en verde salvo pruebas de la rama
de trabajo que esperan funciones que esta build no lleva (llamadas con altavoz); con sus propias pruebas, calls.js (voz y
Wi-Fi), calls_browser.js --video y lan.js (vuelta al Wi-Fi a los ~28 s) en verde.
Pendiente de confirmar en los teléfonos: si el enlace deja de rehacerse cada 30 s (el diagnóstico lo dirá con las líneas
nuevas) y si las fotos llegan por Bluetooth.

## Ronda 2759 (en curso)
- **Pasar la cuenta a un teléfono nuevo** (plan punto 15, opción A elegida por el dueño; `AccountMove.kt`,
  `move_account.js`): Perfil → "Cambiar de teléfono". En el nuevo, "Traer mi cuenta de otro teléfono" abre un puerto y
  muestra un QR (IP, puerto y clave de un solo uso); en el viejo, "Pasar mi cuenta a un teléfono nuevo" lo lee. La
  parte nativa empaqueta todo lo de NEXO (NEXO ID, identidad y claves, sesiones de cifrado, contactos, historial,
  adjuntos, grupos, Fénix y archivos grandes), lo cifra con la clave del QR y lo manda por el Wi-Fi (mismo Wi-Fi o
  punto de acceso de uno de los dos). El nuevo lo guarda con su propio cifrado en reposo y SOLO entonces confirma; el
  viejo, al recibir la confirmación, borra lo suyo y deja de anunciarse. Mientras dura, la app no escribe nada
  (congelado nativo); al terminar los dos se reinician (el nuevo con la cuenta, el viejo vacío). Para los contactos no
  cambia nada (mismas claves): ni aviso de clave cambiada ni fallos al descifrar.
- Simulado (`move.js`, en `ci.js`): código falso → no borra nada; 12 archivos (52 KB) pasan; N arranca como A (mismo
  NEXO ID e identidad, contactos, historial con la foto, grupo); N escribe a B y B lo recibe como de A sin avisos, B
  contesta y llega a N; A queda vacío con otro NEXO ID. JVM: `AccountMoveTest` (paquete cifrado por socket, en el
  nuevo cifrado en reposo, nombres raros fuera, y si el nuevo no la guarda no confirma: el viejo conserva la cuenta).
  Falta: probarlo en teléfonos; sin Wi-Fi común (por Bluetooth) aún no.
- **Llamada con la app cerrada**: la oferta de llamada lleva la marca `cl:1` (en el sobre o en su primer trozo, que
  el nativo sí ve; el contenido sigue cifrado) y el aviso del teléfono dice "📞 Llamada entrante" en vez de "Mensaje
  nuevo"; al abrir la app antes de 60 s suena y se puede contestar (`calls.js --closed`: aviso, suena al abrir, en
  llamada). JVM: `BgInboxTest`.
- **Altavoz en llamadas**: botón 🔈/🔊 (auricular por defecto; en videollamada, altavoz); al colgar, el audio del
  teléfono vuelve a normal (`calls.js` lo comprueba).
- **Prueba de Fénix**: el fallo intermitente (5 de 6 mensajes / 1 de 2 archivos) era de la prueba: daba la copia por
  hecha sin contar los 2 mensajes de archivo y a veces "perdía el teléfono" con el último sin copiar. Ahora espera a
  todos: 6/6 y 2/2 (espejo y normal).

## Ronda 2758: videollamadas (plan del dueño punto 17)
- Botón 🎥 junto al 📞 (chat 1:1): la misma llamada con vídeo VP8 (WebCodecs, cámara frontal a 320x240 y 15 fps,
  ~300 kb/s, imagen completa cada 2 s), cifrado igual que la voz. Solo con el contacto en el mismo Wi-Fi (por
  Bluetooth no cabe: el botón lo avisa). Pantalla: la imagen del otro a pantalla completa, la propia en una esquina
  (en espejo), botones silenciar, cámara y colgar. Si el Wi-Fi se pierde en plena videollamada, el vídeo se para y la
  voz sigue por Bluetooth (si en 3 s no llega voz por el Wi-Fi se pasa al Bluetooth y, si no está conectado, se busca).
- Encontrado al probarlo y arreglado: en una llamada se seguía usando el Wi-Fi durante el margen de espera de lan.js
  tras un corte (silencio); el colgar iba por el chat y, sin Wi-Fi, el otro no se enteraba hasta 12 s después (ahora
  también va cifrado por el canal de la voz); la ruta L2CAP de archivos grandes podía tomar `lan:`/`net:` como
  dirección Bluetooth (ahora usa la conexión Bluetooth lista, `_bleReadyFor`).
- Simulado: `calls.js --wifi` (vídeo 46 imágenes por lado en 3 s; sin Wi-Fi vídeo parado y voz sigue; B se entera al
  colgar; sin Wi-Fi el 🎥 avisa). `calls_browser.js --video` (Chromium, cámara y micrófono de prueba): ~88 imágenes
  decodificadas por lado en 6 s, imagen del otro visible, vista propia, ~22 KB/s, voz Opus a la vez.

## Ronda 2758: llamadas de voz (plan del dueño punto 16)
- **Llamadas** (`calls.js`, `call_media.js`, `calls_ui.js`): botón 📞 en la cabecera de un chat 1:1. Solo con enlace
  directo: el mismo Wi-Fi / Wi-Fi Direct o Bluetooth a alcance (no por Jump ni internet: demasiado retraso). La
  señalización (llamar, contestar, rechazar, ocupado, colgar) va por el chat cifrada de extremo a extremo y no se
  guarda; la voz va en paquetes de ~100 ms cifrados con una clave propia de cada llamada (AES-GCM). Audio: Opus con
  WebCodecs (~3 KB/s en el aire: cabe de sobra por Bluetooth) o μ-law si el teléfono no tiene Opus (~11 KB/s);
  micrófono con cancelación de eco y ruido; reproducción con un colchón de ~150 ms; en Android, modo llamada
  (auricular, `callAudio`). Pantalla de llamada con timbre/vibración, tiempo, silenciar y colgar; sin contestar en
  45 s → perdida; sin voz del otro 12 s → se corta. Queda una línea en el chat ("📞 Llamada · 1:23", "Llamada
  perdida", "Llamada rechazada"…). Con la app en segundo plano: notificación "📞 Llamada entrante".
- Simulado: `calls.js` (señalización y cifrado con micrófono falso, por Bluetooth y `--wifi`): contestada, voz en los
  dos sentidos (40 de 41 paquetes cada 100 ms, en orden, nada en claro en el aire), rechazada, sin respuesta, se corta
  al alejarse (13 s), sin alcance → aviso. `calls_browser.js` (Chromium con micrófono de prueba: audio de verdad):
  Opus 5,9 s de audio del otro en 6 s, ~3 KB/s; `--ulaw` 5,8 s, ~11 KB/s.
- Pendiente (fase 2): sonar con la app cerrada (hoy la oferta llega al buzón y se ve como llamada perdida al abrir),
  altavoz/auricular con un botón, Bluetooth con MTU pequeño (μ-law no cabe; Opus sí).

## Ronda 2758: chats de grupo (plan del dueño punto 14: textos, fotos, audio y archivos)
- **Grupos** (`groups.js`, `groups_ui.js`): botón 👥 arriba en la pantalla principal → nombre y contactos → "Crear
  grupo". Sin servidor: el grupo (id `gr…`, nombre, miembros) se guarda en cada teléfono y cada mensaje va a cada
  miembro por su chat de siempre (cifrado de extremo a extremo, por Bluetooth, Jump, Wi-Fi o internet) dentro de un
  sobre `nexo_grp`; quien lo recibe crea o actualiza el grupo (solo si él y el remitente son miembros). El primer
  mensaje lleva las tarjetas de los miembros (como compartir contactos): así se pueden escribir aunque no se
  conocieran (se añaden como contactos sin resaltarlos). En el chat del grupo cada burbuja dice quién la escribió;
  la propia pasa a ✓✓ cuando les llegó a todos (y a leído cuando todos lo leyeron). Lista de chats: "👥 Nombre",
  último mensaje "B: …" y no leídos; notificación con el nombre del grupo. Menú ⋮: miembros y salir del grupo.
  Cada copia queda oculta en el chat 1:1 del miembro y se reenvía sola si no está a alcance; se borra en cuanto ese
  miembro confirma que le llegó. Fotos, notas de voz, ubicación, contactos y archivos de hasta ~1 MB van igual, dentro
  del sobre; el vídeo, solo la previa (sin HD). Pendiente: el HD de vídeo y los archivos grandes en grupos; avisar con
  la app cerrada con el nombre del grupo (hoy el aviso nativo dice el del remitente).
- Simulado (`groups.js`, en `ci.js`): A crea el grupo con B y C (que no se conocían): aparece en los tres, B y C se
  pueden escribir, ✓✓ en A; B escribe → llega a A (no leído 1, "B: hola grupo…") y a C (burbuja "B: …"), no en los
  chats 1:1; un texto largo de C llega a los dos; A manda un PDF al grupo → llega a B y a C, ✓✓ en A y las copias
  ocultas se borran; C sale → A y B lo ven y ya no le mandan.
- **Arreglado de paso**: la copia oculta de "eliminar para todos" perdía la marca al guardarse y, al reabrir el chat,
  quien borró veía una burbuja con el JSON de la acción (comprobado en `chatactions.js`: 1 burbuja antes, 0 ahora).

## Ronda 2758: arreglos encontrados en la batería
- **Jump, foto que se queda sin llegar**: si el puente empezaba a pasarle una foto al destino y se cortaba, y luego el
  emisor la mandaba directo, el destino mezclaba los trozos de los dos envíos (mismo mensaje troceado distinto) y no
  la completaba nunca (`jump.js --direct-later`: falló 3 de 3 también con la 2757; depende de si llegó algún trozo del
  puente antes del corte). Ahora, si lo que había a medias lleva 4 s parado, se empieza con el nuevo (`ble_ack.js`
  v3.14.0): llega en 12 s (2 de 2).
- Pruebas que miden el límite del Bluetooth de siempre (`files.js`, `perf.js`, `wifidirect.js`) se hacen con teléfonos
  sin L2CAP: con L2CAP esos archivos ya no se rechazan, van como archivo grande (`big.js --l2`).

## Ronda 2758: archivos grandes por Bluetooth L2CAP (plan del dueño punto 13, fase 1)
- Sin Wi-Fi ni Wi-Fi Direct, un archivo grande (más de ~2 MB, hasta 1 GB) ya no se rechaza: va por un canal L2CAP del
  Bluetooth (Android 10+ en los dos; `l2` en el kx). Es un flujo directo sobre la conexión Bluetooth, sin GATT, sin
  trozos con confirmación ni base64; usa lo mismo que el Wi-Fi (archivo cifrado en disco, `BigNet` ahora con flujos):
  A → B `gq` { via:'l2' }, B abre el canal (`bigServeL2`) → `ga` { psm, token }, A lo manda (`bigSendL2`). Orden de
  caminos: mismo Wi-Fi > Wi-Fi Direct > Bluetooth L2CAP. La tarjeta dice "(Bluetooth)"; el diagnóstico,
  `[L2CAP] … KB/s`.
- Simulado (`big.js --l2`, ~100 KB/s supuestos): 4 MB en 43 s, corte a mitad → "Toca para reintentar" → llega; con un
  teléfono sin L2CAP (`--b-no-l2`) o ninguno (`--no-route`) sale el aviso como antes. JVM: `BigFileTest` por flujos.
  La velocidad real del L2CAP no se puede simular: hay que medirla en los teléfonos (`[L2CAP]` en el diagnóstico).
- Fase 2 (pendiente): usar el L2CAP también para fotos, vídeos HD y archivos medianos (hoy por GATT, ~20 KB/s).

## Ronda 2757: MTU pequeño (punto 8), Fénix con fotos y archivos (punto 9), Jump por Wi-Fi (punto 10), app cerrada (punto 12)
- **Recibir por Bluetooth con la app cerrada** (`BgInbox.kt`): al cerrar la app (handleOnDestroy) el servidor GATT y
  las conexiones siguen (el proceso vive por el `BleService`; solo se deja de escanear). Lo que llega: un mensaje de
  un NEXO ID va al buzón en disco (`nexo_bg_inbox.jsonl`, máx. 3 MB), el Kotlin manda la confirmación de entrega
  (✓✓ en el emisor) y avisa "Mensaje nuevo" (sin texto: va cifrado; con el nombre si la escucha de internet lo tiene);
  las acciones ocultas (borrar para todos…) van marcadas `q:1` y no avisan; el primer trozo de una foto/vídeo/archivo
  solo avisa ("📷 Foto"…; el emisor lo manda al abrir). Al abrir la app, la instancia nueva retira a la vieja y
  entrega el buzón en orden. Simulado en `background.js --scenario=closed` (`--old-kotlin` = antes): antes A veía
  m1/m2 en rojo (fallido) y B nada; ahora A los ve entregados con B cerrada, B tiene la notificación (2 mensajes, sin
  duplicar) y al abrir llegan. Encontrado al probarlo: lo que llegaba al abrir la app antes de cargar el NEXO ID
  propio no se podía descifrar (va en los datos autenticados) y se perdía; ahora espera (también arregla mensajes
  retenidos al reabrir). Falta probar en teléfonos: que Android no mate el proceso con la app cerrada (depende del
  fabricante y del ahorro de batería).
- **MTU**: al conectar, el Kotlin pedía el MTU (512) y en el acto activaba las notificaciones; Android hace una sola
  operación GATT a la vez y a menudo se perdía la petición del MTU: la conexión se quedaba en 23 bytes (20 por
  escritura, todo ~20 veces más lento). Ahora: MTU primero, notificaciones al contestar (o a los 2 s); si queda en 23,
  se pide otra vez. No se puede simular (Android): el diagnóstico dice `[MTU] nx…: N` y `BT_ERR` si queda en 23.
- Trozos de texto por bytes reales (`Utf8Split`, MTU − 3, máx. 512) en vez de caracteres con 10 de margen; cada
  escritura sigue siendo UTF-8 válido (las builds anteriores la leen igual). Trozo mínimo con MTU pequeño 240 (antes
  60: con 20 bytes por escritura el 60 % de la radio eran cabeceras). Medido (foto 45 KB): MTU 23 215 → ~95 s;
  con 2 % de pérdidas, 120 → 1018 s, 240 → 423 s, 360 → 567 s (por eso 240); MTU 185/247/512 algo mejor que la 2756.
- **Fénix fase 3** (`fenix.js` v3): fotos, notas de voz, previas de vídeo y archivos de hasta ~1 MB de cada chat, cada
  uno cifrado con K en 2 contactos con Fénix 3 (kx fx:3), en archivos aparte; los de más de 300 KB solo por el mismo
  Wi-Fi; límites 30 MB del dueño y 20 MB por contacto en quien guarda; el pingeo los prueba. Al recuperar vuelven a su
  mensaje (`vaultReplaceAttachment`). No van el vídeo HD ni los archivos grandes. `fenix.js` (sim): 2 archivos en 2
  contactos cada uno, ilegibles para ellos; tras recuperar, historial 6 de 6 y los 2 archivos idénticos. Encontrado al
  probar: un medio se perdía si el archivo aún no estaba en disco al armar el segmento de texto (ahora aparte, con
  reintento) y el límite de los segmentos de texto contaba los de medios (error tras recuperar).
- **Jump por Wi-Fi**: `jump.js --wifi-ab` (A–B solo por Wi-Fi, B–C por Bluetooth): todo llega (foto en 3 s), los
  puentes no leen nada. Ya funcionaba en la 2756: no hizo falta cambiar código.

## Ronda 2756: archivos grandes (pedido del dueño 24-10) e ID Bluetooth rotativo (plan punto 4)
**Archivos grandes.** Informe del dueño con la 2755: una foto llega; un APK de 24 MB "nunca salió ni llegó" y después
no llegaban más archivos. En el simulador (`big.js` con la 2755) el APK se rechaza con el aviso "demasiado grande" (el
máximo era ~22 MB) y lo siguiente sí llega: el bloqueo de después no se reproduce (pendiente del diagnóstico de los
teléfonos). El límite existía porque todo archivo pasaba entero por la memoria de la app (base64, cifrado y copias).
- Ahora, por encima de ~22 MB y con el contacto en el mismo Wi-Fi o con Wi-Fi Direct (hasta 1 GB), como Signal: la app
  lee el archivo a trozos de 512 KB y el nativo (`BigFile.kt`) los cifra a disco con una clave al azar del archivo
  (AES-GCM por trozo, con número de trozo y "último" en los datos asociados: no se pueden quitar, reordenar ni cortar);
  un mensaje normal cifrado lleva nombre, tamaño y la clave; el archivo cifrado va de disco a disco por un socket
  (mismo Wi-Fi: el receptor abre un puerto con un token; Wi-Fi Direct: como siempre, con el token en las credenciales
  cifradas). Al tocarlo se descifra a la caché y se abre (un APK se instala). `big_file.js`, `wifi_direct.js` v1.4.
- La tarjeta del chat dice en qué va: Preparando / Enviando / Recibiendo N %, "Toca para abrir"; si se corta,
  "No se pudo enviar · Toca para reintentar" (emisor) o "Toca para pedirlo" (receptor). Nada se queda bloqueado.
- Sin Wi-Fi ni Wi-Fi Direct con el contacto: aviso claro y no se manda nada. No se pueden reenviar todavía.
- Encontrado al probar: el reenvío automático de pendientes mandaba el mensaje del archivo grande como archivo normal
  (llegaba una tarjeta que no abría nada); y un corte a mitad dejaba Wi-Fi Direct 10 min sin usar con ese contacto
  (ahora solo si falla al conectar). Corregidos.
- Pruebas: `big.js` (mismo Wi-Fi, `--wd`, `--no-route`; en `ci.js`): 24 MB llegan y se abren idénticos (SHA-256) en los
  dos, la app nunca tiene más de un trozo (683 KB en base64), lo pequeño sigue llegando, corte y reintento. Con la
  2755 el archivo no sale. Kotlin: `BigFileTest` (5: idéntico, otra clave/id, cortado/tocado, socket de disco a disco
  con un intruso con token falso, nombres). El Kotlin del plugin solo se compila en GitHub: falta el teléfono.

**ID Bluetooth rotativo** (decidido por el dueño: "empieza por el 4"; diseño de `PENDIENTES.md`):
- En el aire, en vez del NEXO ID, "R" + 9 caracteres: HMAC-SHA256(SHA-256("nexo-rid-key|" + clave pública), época de
  15 min). Solo quien tiene la clave pública (los contactos) lo reconoce; cambia cada 15 min también con la app cerrada
  (lo calcula `BleService` con `RidToken.kt`, idéntico a `ble_rid.js`). El nombre del teléfono deja de anunciarse.
- NEXO ID visible solo con "Agregar" abierto (5 min) o sin contactos. Una build anterior ignora el código ("NX…" o nada).
- Jump y Fénix: los NEXO no reconocidos son "anónimos"; se conecta de paso y el kx dice quién es (`relay.identify`).
  El 'rq' lleva los códigos de ahora del destino ('dk'): un puente que no lo conoce lo reconoce al escanear.
- Pruebas: `rid.js` (épocas de 20 s; en `ci.js`): en el aire solo códigos que cambian, ni NEXO ID ni nombre; un
  desconocido no los ve; tras 2 cambios de código se reconectan y llega lo pendiente; con "Agregar" abierto visible.
  Con la 2752 falla (el NEXO ID sale 6 veces y el desconocido los ve). Kotlin: `RidTokenTest` (vectores de la app).
  `run`, `jump` (desconocidos, cadena), `fenix` (recupera con 5 contactos) y mezcla con la 2752 en verde.
- Diagnóstico (2755, también aquí): `BT_ERR` y `[BIN]`.
- Batería completa (bat39, 62 ejecuciones): igual que bat38 salvo tiempos y textos; nuevas en verde (`rid`, `big`,
  `big --wd`, `big --no-route`); `jump --net` (que en bat38 dejó una foto en "enviando") en verde. Las 13 pruebas de
  GitHub en verde (con `rid.js` y `big.js`).

## Ronda 2753–2754: Bluetooth sin base64 (plan del dueño, punto 7)
- Antes cada trozo de un archivo viajaba como texto JSON con los datos en base64: ~450 bytes por la radio para 270
  bytes reales. Ahora los trozos de datos van en binario (`BinFrame.kt`): `0x01` + largo de la cabecera (2 bytes) +
  largo de los datos (4) + cabecera JSON + bytes. Un mensaje de texto nunca empieza por `0x01`: conviven en el mismo
  canal. Al llegar, el nativo (`BinAssembler`) junta las escrituras y entrega cabecera + datos en base64; la app
  (`_prePayload`) rehace el trozo de siempre, así que lo de arriba (comprobación `k`, cifrado, ensamblado) no cambia.
- Solo con quien lo anuncia: `bf: 1` en `kx`, pings y acks (`ba`, `n`); un `kx` sin `bf` lo quita (build anterior).
  Nunca por Jump (trozos con destino), Wi-Fi ni internet, ni el trozo 0 (lleva la miniatura). Un trozo va en binario
  solo si es base64 canónico (al volver a base64 sale idéntico); los trozos se alinean donde empiezan los datos tras
  la cabecera del cifrado. Si el nativo no tiene `sendBinary`, sigue en JSON.
- Si se pierde el final de un trozo (el emisor descarta el resto tras no poder escribir), el siguiente trozo o mensaje
  se reconoce por su inicio (`{"v":` / `{"type":`) y no se pega al roto; uno a medias más de 4 s se descarta.
- Simulador (`tests/sim/binary.js`, en `ci.js` con 2 % de pérdidas; `native_mock` replica `BinFrame`/`BinAssembler`):

  | Caso | Antes (2752) | Ahora |
  |---|---|---|
  | Foto 45 KB, MTU 512 / 247 / 185 | 6,1 / 10,6 / 15,6 s | 4,5 / 8,5 / 10,6 s |
  | PDF 150 KB, MTU 512 / 247 / 185 (`perf.js`) | 44 / 87 / 125 s | 31 / 65 / 83 s |
  | PDF 150 KB, bytes por la radio (MTU 247) | 254 KB | 190 KB |
  | MTU 185 con 2 % de escrituras perdidas: fotos / PDF | 111 y 47 s / 184 s | 34 y 50 s / 131 s |
  | MTU 23 (foto) | 252 s | 215 s (ahí pesan las cabeceras: punto 8) |

  Nueva ↔ 2752 en los dos sentidos (`--old-a`/`--old-b`): nadie manda binario y todo llega; `mixed.js` y Jump con
  puente 2752 también. Kotlin: `BinFrameTest` (8 pruebas: cualquier MTU, texto que pasa tal cual, datos que parecen
  JSON, varios teléfonos, trozo cortado, trozo sin final, cabecera rota, acentos).
- Batería completa (bat38, 58 ejecuciones): igual que bat37 salvo tiempos (HD de vídeo 42 → 30 s) y una vez la foto de
  `jump.js --net` quedó en "enviando" con ~30 pruebas a la vez; no se repitió en 9 ejecuciones (6 en paralelo) ni
  afecta a ese camino (Jump nunca usa binario). Las 11 pruebas de GitHub en verde.
- Kotlin del plugin: `sendBinary`, la cola de escritura admite bytes, lo recibido se lee como bytes
  (`processReceivedBytes`). Solo se compila en GitHub: falta probarlo en teléfonos.

## Ronda 2752: reestructuración (plan del dueño, punto 6: "con mucho cuidado de no romper nada") — `docs/ESTRUCTURA.md`
- `src/main.js` 4.281 → 720 líneas (punto de entrada) y `src/ui/ble_interface.js` 3.732 → 847 (núcleo de la clase),
  repartidos en 30 módulos por tema (chat, cámara, vídeo, archivos, perfil, Bluetooth: mensajes, conexiones, claves,
  enlaces, interfaz…). Los métodos de la clase se añaden con `Object.assign(BLEInterface.prototype, …)`.
- **Sin cambios de código**: todo se movió con herramientas (`tests/sim/extract.js`, `extract_methods.js`) que cortan
  el texto exacto; en cada paso `same_text.py` comprobó que lo quitado es exactamente lo que está en el módulo y
  `undef.js` que no queda nada sin definir (ahora también en GitHub). Lo que un módulo necesita de main.js se lo da
  main.js al arrancar (pegamento marcado `[pegamento]`); nunca se mueve una variable que otro sitio reasigna.
- Comprobado: 26 pasos; las 10 pruebas de GitHub tras cada tanda; batería completa en 3 puntos de control (bat35,
  bat36, bat37; 53 ejecuciones): idéntica (bat37 sin ninguna diferencia con bat36; antes solo variaciones de tiempo).
- Lo nativo (Kotlin) no cambia.

## Ronda 2751: notificaciones, no leídos e internet en segundo plano (pedido del dueño: puntos 11 + notificaciones + burbujas)
- **No leídos**: reproducido en `tests/sim/unread.js` con la 2744: de texto corto, texto largo y foto solo contaba el
  corto (los largos y los archivos nunca sumaban); con el chat abierto en segundo plano mandaba "leído"; al abrir el
  chat no confirmaba la lectura de lo pendiente. Nuevo `src/ui/notify.js`: un solo punto por el que pasan todos los
  mensajes recibidos (`_handleIncomingMessage`), contador por chat (`bumpUnread/clearUnread/unreadSummary` en
  `ble_interface.js`), "leído" solo con el chat abierto y la app a la vista, sin repetidos.
- **Notificaciones del teléfono** (`MsgNotifier.kt` + `UnreadBook.kt`): una por chat con el nombre y el número
  (el icono de la app muestra la suma en los lanzadores que lo admiten); con el bloqueo de la app activado sin texto;
  en la pantalla de bloqueo solo "Mensaje nuevo"; tocarla abre el chat (también con la app ya abierta:
  `handleOnNewIntent`). **Faltaba declarar `POST_NOTIFICATIONS` en el manifiesto** (en Android 13+ no se podía mostrar
  ninguna) y quien ya tenía los permisos de Bluetooth nunca lo pedía: ahora se pide al arrancar.
- **Internet en segundo plano** (`NetBg.kt`, `WsClient.kt`, `Secp256k1.kt`; `docs/INTERNET.md` § Segundo plano): el
  emisor marca `n` = msgId dentro del sobre cifrado de los mensajes nuevos; con la app en segundo plano la parte nativa
  escucha los relés con las etiquetas del día, se identifica (NIP-42) y avisa. JVM: firmas, etiquetas, sobres e ids
  iguales que la app y de punta a punta con un relé que exige identificación. Sim: 3/3 mensajes con aviso, 0 en
  saludos o confirmaciones.
- Efecto en otras pruebas: varios estados pasan de ✓✓ "entregado" a "leído" (abrir el chat ahora confirma la lectura,
  como debe ser) y en `chatactions` la burbuja de B ya no sube con el chat abierto a la vista (antes subía: fallo).
- Pruebas en GitHub: 10 escenarios del simulador + 34 JVM. Batería completa (bat34, 53 ejecuciones) sin fallos.
- **No comprobado en teléfonos**: la notificación real, el número del icono (depende del lanzador) y la escucha
  nativa con el ahorro de batería de cada marca.

## Ronda 2749: plan del dueño, punto 5 (Gradle moderno y Tor más nuevo)
- AGP 8.2.1 → **9.4.0**, Gradle 8.5 → **9.6.0**, Kotlin 1.9.20 → **2.2.20**, compileSdk 34 → **37.1**; `targetSdk` sigue
  en 34 (lo que cambia el comportamiento de la app en el teléfono no se toca). Tor 0.4.9.5 → **0.4.9.14** (misma API;
  `socksPort` pasó a privado y el código ya usaba `getSocksPort()`).
- Ajustes: `android.builtInKotlin=false` y `android.newDsl=false` (los módulos de Capacitor 5 usan el DSL antiguo y
  `kotlin-android`); `kotlinOptions` → `kotlin { compilerOptions }`; `proguard-android.txt` → `-optimize` (la
  reducción de código está apagada, no cambia la APK); `scripts/agp9-patch.sh` ajusta en GitHub los módulos de
  Capacitor que vienen de npm (después de `cap sync`).
- Comprobado en GitHub: compila (2747 con AGP 9.2, 2748 con AGP 9.4, sin avisos de versión), firma 23d86688…, y las
  pruebas (Kotlin + simulador) pasan. El JavaScript no cambió respecto a la 2744.
- **Riesgo**: compilar con otras herramientas puede cambiar detalles en tiempo de ejecución que el simulador no ve
  (el simulador prueba el JavaScript, no el Kotlin compilado). Probar en los teléfonos: Bluetooth, Wi-Fi, Wi-Fi
  Direct, huella y Tor (Perfil → Internet). Si algo nativo falla, volver a la 2744.

## Ronda 2744: plan del dueño, puntos 1–3 (limpieza, pruebas en cada build, emojis) — `docs/PENDIENTES.md` §5
- **Pruebas en cada build**: el workflow tiene un trabajo `tests` (Kotlin JVM, 25 pruebas, y `tests/sim/ci.js`, 9
  escenarios del simulador en paralelo); si alguno falla no se compila ni se publica la APK y la salida trae los
  registros. Comprobado que falla con una build vieja (`net.js` con la 40fe10c).
- **Fallo real encontrado por GitHub**: allí hay salida a internet y los "teléfonos" se conectaban a los relés
  públicos; Jump mandaba la foto al puente **por internet** (con datos móviles los archivos no van por internet) y
  se quedaba en "enviando" aunque el puente estaba al lado por Bluetooth. Reproducido con `jump.js --net` (relé
  local). `ble_relay.js` v2.3: el vecino por Bluetooth o Wi-Fi local antes que por internet, y los archivos de Jump
  solo por internet si los dos están en Wi-Fi (si no, Bluetooth). Las pruebas ya no usan relés públicos.
- **Emojis**: llegaban bien (los trozos ya respetaban los emojis), pero la vista previa de la lista y las citas cortaban
  un emoji por la mitad (salía "�"). Reproducido en `e2e.js` y corregido (`_cut`).
- **Limpieza**: registros con la versión real (decían v6.1.1 y v3.2.12), fuera `NordicMeshService` (no existe) del
  manifiesto, tarjetas de pago (función antigua) con el texto escapado.
- **ID Bluetooth rotativo**: no aplicado (ver PENDIENTES §5 punto 4).
- Batería completa (bat32, 52 ejecuciones con `jump --net`) sin cambios respecto a la 2739.

## Ronda 2739: internet por relés públicos y Tor (decisión del dueño: "2 y 3 por ahora") — `docs/INTERNET.md`
- Pedido: "si estoy en Wi-Fi y el otro también, sea el mismo módem o no, la conexión debe ser Wi-Fi" y "con Wi-Fi
  debería poder llegar a cualquier lado". Entre módems distintos hace falta un punto de encuentro en internet; el dueño
  eligió relés públicos y Tor, sin servidor propio.
- `src/net/net_link.js` (nuevo): relés Nostr públicos (cuatro a la vez). Cada pareja tiene un secreto propio (ECDH de
  las identidades); los eventos van cifrados (AES-GCM) encima del cifrado de siempre, a una etiqueta que cambia cada día
  y firmados con una clave al azar: el relé no ve texto, tipo de mensaje ni NEXO IDs. Identificación NIP-42 con la
  clave de la etiqueta. Saludos para saber quién está en línea; buzón con caducidad (✓ al guardarse, ✓✓ al confirmar).
- Enlace `net:<NEXO ID>` en `ble_interface.js`/`ble_ack.js`: mismo protocolo que Bluetooth/Wi-Fi. Orden: Wi-Fi del
  mismo router → internet si los dos están en Wi-Fi → Bluetooth → internet con datos móviles (solo textos) → Jump →
  buzón → pendiente. Solo con contactos que lo anuncian (`nt:1`).
- Tor (Kotlin, `tor-android` 0.4.9.5): servicio oculto por teléfono; la `.onion` va dentro del saludo cifrado; si los
  dos tienen Tor, la pareja habla directo por Tor (los relés no reciben nada de la conversación). Lo que no se descifra
  con la clave del contacto cierra la conexión. Arranca solo con Wi-Fi; se apaga en Perfil → Internet.
- Compilación: la 0.4.9.13 (clases Java 24) y la 0.4.9.8 (pide compileSdk 37) no compilan con AGP 8.2; la 0.4.9.5 sí
  (excluida del Jetifier, también en el workflow). Las CPU x86 no se incluyen (solo ARM) para no inflar la APK: aun así pasa de 10 MB (2734) a 26,9 MB.
- Pruebas: `net.js` con un relé Nostr local (`nostr_relay.js`): en línea 0,4 s, texto 0,2 s, foto de 300 KB 2,6 s, 0
  escrituras Bluetooth, los relés no ven nada, buzón y datos móviles correctos. `net.js --tor`: Tor 1,6 s (modelo),
  0 eventos a los relés durante el envío, impostor expulsado. JVM: `LanHubTorTest` (SOCKS real). Batería completa
  (bat30, 51 ejecuciones) igual que la de la 2734.
- **No comprobado**: relés públicos y red Tor reales (desde el entorno de desarrollo no se alcanzan); recibir por
  internet con la app en segundo plano (pendiente).

## Ronda 2734: escaneo de la red Wi-Fi (idea del dueño: "en cuanto tenga Wi-Fi, escanear a través del módem")
- El dueño pidió que, estando los dos en Wi-Fi, la conexión sea Wi-Fi. Reproducido en `tests/sim/lanscan.js`: con un
  router que no deja pasar el anuncio mDNS (habitual en repetidores, mallas y routers de operadora) la 2732 nunca los
  encontraba y, lejos de Bluetooth, el texto no llegaba.
- Kotlin `LanBeacon` (UDP 47824): pregunta a toda la red (difusión) al entrar en una red Wi-Fi (aviso de Android),
  al volver a la app y cada minuto; dirección por dirección (hasta /22) al entrar, al volver y cada 5 min. Contesta
  con la marca del día. 4 pruebas JVM con UDP real (pregunta/respuesta, basura y repetidos, direcciones de la red, del
  escaneo a la conexión LanHub). `lan.js` v1.2: busca al entrar en la red; el diagnóstico dice cómo se encontró.
- Resultado `lanscan.js`: encontrados en 0,2 s por escaneo; texto 0,2 s y foto de 300 KB 0,6 s sin Bluetooth; al volver
  al Wi-Fi 0,2 s. Módems distintos: sin camino (hace falta internet con punto de encuentro; decisión del dueño).
- Batería completa (bat28, 49 ejecuciones) sin cambios.

## Ronda 2732: Jump con más alcance y Fénix fase 2 (pedido del dueño: "termines la seguridad, fénix y mejores jump")
- **Largo alcance** (Kotlin): además del anuncio normal, anuncio extendido en **LE Coded PHY** (~4x distancia) si el
  teléfono lo tiene; el escaneo recibe los dos; se conecta en Coded solo a quien únicamente se ve por largo alcance (en
  1M es más rápido) y ese enlace no pasa a 2M (tiene menos alcance). Sin teléfono no se puede medir la distancia:
  compila (2731) y en el diagnóstico sale si el teléfono lo tiene.
- **Hasta 8 saltos** (`ble_relay` v2.2; antes 4). `jump.js --chain=7` (6 saltos): texto 0,8 s, foto 12,8 s;
  `--chain=9` (8 saltos): texto 1 s, foto 16,8 s; los puentes no ven el remitente.
- **Fénix fase 2** (`docs/FENIX.md`): mensajes de texto en segmentos cifrados con K, cada uno en 2 contactos con
  Fénix 2, pingeo de segmentos, y al recuperar la cuenta los contactos los devuelven (6 de 6 en `fenix.js` y
  `--mirror`). Fotos y archivos: siguiente fase.
- **Encontrado al probar 7 teléfonos**: el "+" de una fila de "dispositivos nuevos" no hacía nada si entretanto empezaba
  otro escaneo automático (la lista interna se vaciaba y la fila seguía en pantalla). Corregido. En las pruebas, el
  teléfono G tenía una dirección no hexadecimal (por eso no conectaba) y el emparejado no esperaba la clave.
- Batería completa (bat27, 48 ejecuciones) sin cambios de tiempos respecto a la 2730.

## Ronda 2730: Wi-Fi con las reglas del dueño + seguridad (remitente oculto, poscuántico, QR)
- **Informe del dueño con la 2728**: "estaba en Wi-Fi y al mandar una foto cambió a Bluetooth" (mismo router).
  Reglas que dio (`docs/PENDIENTES.md`): Wi-Fi del mismo router primero; un corte breve no es motivo para cambiar; con
  mala señal medida puede pasar a Bluetooth y volver. Reproducido en `lan.js`: con la app en segundo plano Android no
  ejecuta el JavaScript, el latido de la app no salía y el otro daba el Wi-Fi por caído. Corregido: latido **nativo**
  en `LanHub` (`h:0`/`h:2` cada 4 s, contestado desde Kotlin; caída a los 30 s, mide el tiempo de ida y vuelta),
  margen de 8 s antes de cambiar de camino, mala señal = ida y vuelta >1,5 s o 12 s sin nada (dos veces seguidas;
  vuelve con <0,8 s). Además: el último trozo de cada ventana esperaba 28 s cuando la cola nativa estaba llena (se
  aparcaba): ahora la cola llena responde "ocupado" y se reintenta al momento.
  Resultados `lan.js`: 40 s en segundo plano → sigue en Wi-Fi, foto en 1 s; corte breve → foto por Wi-Fi en 4,4 s,
  0 trozos por Bluetooth; mala señal → Bluetooth en 5,6 s y vuelta al Wi-Fi en 8 s; salir de la red a mitad →
  Bluetooth tras el margen (8,2 s), archivo completo; caída silenciosa → texto en 19 s.
- **Seguridad** (`docs/SEGURIDAD.md`, fase 3 segunda parte): remitente oculto a los puentes de Jump (sobres `sx`),
  acuerdo poscuántico híbrido ML-KEM-768 (`e2e_ratchet` v1.1; claves de los contactos en `nexo_ratchet_pq.json`
  para no reescribirlas con cada mensaje) y QR del número de seguridad (`src/ui/qr_verify.js`). Librerías nuevas
  (fijadas): `@noble/post-quantum` 0.5.4, `jsqr` 1.4.0, `qrcode-generator` 1.4.4.
  Encontrado y corregido al probar: con un puente 2728 el texto corto sellado no llegaba (lo envolvía como texto
  suyo) → solo se sella si el primer puente lo entiende y el destino desenvuelve ese caso; las confirmaciones
  selladas se acumulaban en la cola del puente (22) → el destino confirma cada sobre al puente (`rk`).
- Pruebas: `ratchet.js` 51/51; `jump.js` normal, cadena, compartido, desconocido, batería baja, reenvío directo y
  puente 2728 (puentes sin ver el remitente salvo con el 2728; todo llega; cola del puente vacía al final);
  `qr.js` en Chromium con cámara falsa; `mixed.js` con la 2728 y la b9c412f; batería completa (45 ejecuciones) sin
  cambios de tiempos. Arreglado en las pruebas: 13 pulsaban el "+" vacío de la barra antes de que apareciera el
  teléfono encontrado (por eso `bg_bg` fallaba a veces: no emparejaban); `bridge.js` y `qr.js` en Chromium ya
  emparejan.
- Visto y no tocado (ya pasaba con la 2728, 3 de 3): `jump.js --direct-later` no entrega la segunda foto en los
  120 s de la prueba cuando A y C quedan a alcance directo. Pendiente de investigar.

## Ronda 2728: Wi-Fi normal y cambio automático de camino (pedido del dueño) — `docs/WIFI.md`
- Kotlin `LanHub.kt` (TCP con marcos, saludo, una conexión si conectan los dos a la vez; 6 pruebas JVM con sockets
  reales) + NSD en el plugin (`lanStart/Connect/Send/Drop/Stop`, avisos `onLan*`), permiso
  `CHANGE_WIFI_MULTICAST_STATE`. `src/ui/lan.js`: marca del día (solo la reconocen contactos), comprobación con el
  cifrado (`lv`/`lw`), latido 8 s / caída a 25 s, impostor cerrado a 30 s.
- `ble_interface`: dispositivo `lan:<NEXO ID>` preferido; `_lanUp/_lanDown/_onLanPayload/linkOf`. `ble_ack`: trozos de
  24 KB por Wi-Fi; `relink` + `ChatStream.useLink` (sigue por Bluetooth a mitad); reanudar por el mejor camino; un
  envío sin camino ya no se reintenta para siempre cada 200 ms (busca otro y, a los ~2 min, queda pendiente).
  Kotlin: un mensaje mayor que la cola entera entra con la cola vacía.
- `tests/sim/lan.js` (modelo de red en `native_mock`): verificado 0,2 s; texto 0,2 s y foto de 400 KB en 1 s sin
  Bluetooth; nada en claro por la red; sin alcance Bluetooth sigue por Wi-Fi; salir de la red a mitad de un archivo de
  1,2 MB → termina por Bluetooth idéntico; caída silenciosa → texto por Bluetooth en 30 s; impostor nunca comprobado y
  cerrado; cabecera "En línea · Wi-Fi" / "· Bluetooth". Batería completa (44) sin cambios.

## Ronda 2725: fotos paradas y "mensaje de código" (informe del dueño con la 2722)
- Reproducido con un modelo fiel de la cola nativa (`native_mock`: `busyFail` = Android rechaza escrituras por
  ocupado, `kotlin2722` = reglas antiguas, `mtu`, `dropMidEvery`, `bridgeMs`): con MTU 185 y 30 % de rechazos,
  las fotos de A y B se quedan en 25 % / "!" para siempre (como en el teléfono); un paquete mutilado sale en el
  chat como "mensaje de código" (y se guardaba dos veces).
- Causas: (1) la cola nativa, tras 3 rechazos por ocupado, descartaba UN trozo del medio de un mensaje (y con la
  cola llena, también); (2) el receptor solo limpiaba el búfer tras 5 s sin trozos nuevos (con reenvíos
  llegando, nunca): todo lo siguiente quedaba tragado; (3) un trozo perdido dentro de los datos deja un JSON
  válido con datos más cortos: se aceptaba y la foto no se podía descifrar (perdida en silencio, emisor con ✓);
  (4) la 2722 escuchaba todos los registros nativos (uno por trozo): más carga en el hilo principal = más
  rechazos por ocupado (por eso "antes no pasaba").
- Correcciones: Kotlin — un mensaje entra entero en la cola o espera; rechazos: reintento 15/50 ms hasta ~1,8 s
  y luego fuera el mensaje entero; receptor: lo pendiente con más de 10 s se descarta (resincroniza); solo
  AT_REST/FILE_IO cruzan a la app. JS — cada trozo lleva comprobación `k` (FNV-1a; builds anteriores la
  ignoran) y uno dañado se vuelve a pedir al momento; paquetes con JSON roto o sin v/t/type no van al chat.
- Resultado (foto 150 KB, MTU 185): sin fallos 46 s; con 85 trozos mutilados 49 s; con 30 % de rechazos 59 s;
  siempre idénticas y sin código. Batería completa sin cambios (43 pruebas).
- Pruebas nuevas: `photos.js` (`--busy`, `--mtu`, `--drop-mid`, `--inject`, `--cut`, `--camera`, `--wd`),
  `bridge.js` (Chromium; no llega a emparejar con la CPU frenada: pendiente).

## Ronda 2722: el envío de textos se volvió lento con la 2720 (informe del dueño)
- Causa 1 (reproducida en `tests/kotlin`): la migración del cifrado en reposo releía enteros todos los
  archivos de NEXO en cada arranque, con un único cerrojo: un guardado pequeño (las claves del protocolo 2
  se guardan antes de cada envío) esperó 4,3 s con 6 archivos de 20 MB. Ahora: un cerrojo por archivo, solo
  se lee la cabecera de lo ya cifrado (240 MB → 0 leídos), migración por trozos y a prioridad baja. 4 ms.
- Causa 2: Capacitor ejecuta todas las llamadas al plugin en un hilo y en fila; guardar/leer un archivo grande
  (ahora además cifrado) retrasaba `sendMessage`. Archivos en hilos propios (adjuntos aparte; el orden de
  cada archivo se mantiene). `native_mock` modela ese hilo (`pluginThread`, `ioOffThread`) y
  `tests/sim/iolatency.js` lo mide (texto tras un archivo de 1,5 MB: 0,5 s → 0,2 s con 150 ms/MB supuestos).
- Interfaz (Chromium, CPU 4x, `stress.js`): igual que la 2717 (ráfaga de textos 7,8 s / 7,6 s; burbuja propia
  ~20 ms); fotos + textos 9,2 s / 7,6 s por las fotos de 800 px.
- El diagnóstico ahora trae el tiempo de cada texto y los avisos nativos de archivos (antes `remLog` no
  llegaba al diagnóstico).
- Ojo: el cifrado de Java en el servidor va a ~60 MB/s; en Android lo hace Conscrypt (sin medir aquí).

## Ronda 2720: seguridad fase 3, primera parte (ver `docs/SEGURIDAD.md`)
- Cifrado en reposo nativo (`AtRestStore.kt`, AES-256-GCM, clave de datos envuelta por el Android Keystore):
  transparente para el JS (`saveToFile` / `loadFromFile`), archivos antiguos se leen y se migran solos (solo
  `nexo_*`). Pruebas JVM en `tests/kotlin` (7, `gradle --no-daemon test`).
- Perfil → Seguridad (`src/ui/app_lock.js`): bloqueo opcional con huella/PIN (inmediatamente / 1 min / 30 min)
  y bloquear capturas (`FLAG_SECURE`). Prueba `tests/sim/lock.js`; encontrado al probar: con el PIN, Android
  abre otra pantalla y la app "se va" y "vuelve"; sin protección, al quitar el bloqueo volvía a pedir la huella
  (bucle). Protegido y comprobado con mutación.
- Batería completa (36 pruebas) sin cambios respecto a la 2718.

## Ronda 2718: chat tipo WhatsApp y cámara
- Chat: menú al mantener pulsado (o clic derecho), deslizar = responder, cita tocable, reenviar a varios chats,
  copiar, eliminar para mí / para todos (24 h, solo mensajes propios). Formatos `nexo_txt` / `nexo_act` solo a
  contactos con `fx` (2715+). Encontrado en la prueba y corregido: tras eliminar para todos, la lista de chats
  seguía mostrando el texto borrado.
- Cámara: rehecha (pestañas, disparador, contador con límite, linterna, galería, revisar/repetir/enviar). El
  selfie no estaba en espejo (por eso se veía "al revés"); ahora la vista frontal es espejo y la foto sale
  igual que se ve (comprobado en Chromium con una imagen asimétrica). El vídeo frontal se graba sin espejo
  (como sale de la cámara). Fotos a 800 px / 1600 con Wi-Fi Direct (antes 480).
- Pruebas: `chatactions.js`, `camera.js`. La batería separa las pruebas largas y de interfaz de las de tiempo
  real (`bg_bg` fallaba solo con la máquina muy cargada; sola pasa siempre).

## Ronda 2715: Protocolo Fénix, fase 1 (la cuenta) — `docs/FENIX.md`
- Definición del dueño en `docs/NEXO_CONTEXTO.md` §7; decisiones: cuenta primero, nodos = contactos
  (automático), 10 → 1.ª copia, 20 → 2.ª, perdido si no pinguea, recuperar con confirmación de los contactos
  (la huella no puede recuperar una clave en otro teléfono: se le explicó).
- `src/fenix/fenix.js` (reusa el Shamir de `shard_crypto.js`; ojo: `splitSecret` ya devuelve hexadecimal —
  el primer intento lo reconvertía y los nodos rechazaban los fragmentos, visto en la prueba).
- La cabecera de los flujos solo lleva campos conocidos: el tipo de paquete de Fénix va dentro del contenido.
- Prueba `tests/sim/fenix.js` (7 teléfonos, umbrales reducidos): reparto 7 s, pingeo, perdido a los 62 s y
  fragmento a otro en 0,5 s, borrado al volver, recuperación con 3 confirmaciones en 14 s (mismo NEXO ID,
  identidad y contactos; sigue hablando cifrado sin aviso de clave). `--mirror`: 2 copias. Batería OK.
- Encontrado de paso (simulador, no la app): el mock solo informa de lo visto al empezar un escaneo.

## Ronda 2714: ubicación y Wi-Fi Direct (informe del dueño con la 2713)
- Ubicación "no se envía ni llega": en el simulador el envío y la recepción funcionaban (`location.js --gps=ok`).
  Lo que fallaba era obtener la posición: sin señal de GPS (interior) no se veía nada ~35 s y el error se
  callaba. Ahora: aviso, GPS 12 s → última conocida/red → aviso claro (`--gps=indoor|timeout|off`). Causa en
  los teléfonos del dueño no confirmada (falta su diagnóstico).
- "HD por Bluetooth si ya va por Wi-Fi Direct": reproducido en `wifidirect.js` con la 2713: si se perdía el
  'wf' (confirmación por Bluetooth), el emisor daba el vídeo por fallido a los 45 s y lo reenviaba como
  previa + HD por Bluetooth aunque ya hubiera llegado. Ahora vale la confirmación del socket.
- "Wi-Fi Direct lento": sin medidas reales todavía; añadidos tiempos por fase al diagnóstico y comprobación
  del grupo cada 250 ms (antes 500).
- Base estable movida a la 2713 (`base-estable-2713`).

## Ronda 2713: Wi-Fi Direct se quedaba en 1 % (informe del dueño con la 2711)
- Causa 1: `NEARBY_WIFI_DEVICES` no estaba en el manifiesto de la app (comprobado en la APK publicada). En
  Android 13+ el permiso se deniega sin preguntar: Wi-Fi Direct nunca funcionó en esos teléfonos.
- Causa 2: con Wi-Fi Direct anunciado, el vídeo iba solo como original por Wi-Fi Direct; al fallar, no cabía
  por Bluetooth y quedaba "pendiente" para siempre (1 %), con la oferta repitiéndose en bucle.
- Reproducido en `tests/sim/wifidirect.js --broken=noperm` y `--broken=fail` con la 2711 (vídeo y archivo
  "enviando" para siempre, 24 ofertas). Corregido: permiso declarado; si falla, el vídeo pasa a previa + HD
  por Bluetooth (previa en 6,5 s) y un archivo que no cabe queda fallido con aviso; 10 min sin reintentar
  con ese contacto; 2 ofertas en vez de 24. Batería completa OK.

## Ronda 2712: seguridad fase 2 (ver `docs/SEGURIDAD.md`)
- Protocolo 2 = X3DH + Double Ratchet (`src/vault/e2e_ratchet.js`), elegido por contacto
  (`src/vault/e2e_proto.js`); kx y tarjetas con paquete de claves `b2`; sobre (emisor|destino|id) atado al
  cifrado; relleno; número de seguridad + verificado. Estado en `nexo_ratchet.json`.
- Fallo encontrado en la prueba y corregido antes de subir: al aceptar una clave nueva, lo pendiente salía
  con el protocolo 1 (el contacto aún no estaba marcado con el 2); ahora se marca antes de reenviar.
- Verificado: `ratchet.js` 40/40, batería completa (sin cambios de tiempos), `mixed.js` con la 2711 y la 2704
  (pasan al 2 al actualizarse), Chromium real (vídeo 38 s, HD 169 s, 3/3 reproducciones).

## Ronda 2711: seguridad fase 1 (ver `docs/SEGURIDAD.md`)
- APK no depurable y sin copias de seguridad; registros sin contenido; anti-suplantación (clave cambiada
  → retenido hasta que el usuario acepte o rechace en el chat). `tests/sim/impostor.js`.
- Ojo al dueño: si un contacto reinstala NEXO, ahora hay que pulsar **Aceptar clave nueva** en su chat
  (antes se aceptaba sola con un aviso). Es lo que impide que otro teléfono se haga pasar por él.

## Ronda 2709: Wi-Fi Direct para fotos, vídeos y archivos
Criterio del dueño: lo más cercano primero, con sentido común de velocidad; para archivos, Wi-Fi Direct
(directo teléfono a teléfono, sin terceros) antes que Jump/Wi-Fi/datos.
- Nativo (`NexoBlePlugin.kt`, Android 10+): `wifiDirectStatus`, `requestWifiDirectPermission`
  (NEARBY_WIFI_DEVICES en 13+, ubicación antes; se pide la primera vez que hace falta), `wifiDirectHost`
  (el que recibe crea un grupo con nombre y contraseña aleatorios en cada envío y abre un socket),
  `wifiDirectSend` (el que envía se une sin aviso del sistema con WifiP2pConfig.Builder, manda el
  contenido —ya cifrado E2E— y espera confirmación); el grupo se cierra al terminar.
- `src/ui/wifi_direct.js`: control por Bluetooth ('wq' oferta con la clave pública del emisor, 'wa'
  credenciales cifradas para el emisor, 'wn' no, 'wf' entregado). Se usa si los dos lo tienen (kx con
  `wd:1`), hay enlace directo y el contenido pasa de ~150 KB; si falla, sigue por Bluetooth (o queda
  pendiente si pasa del límite de Bluetooth). Una transferencia a la vez.
- `main.js`: con Wi-Fi Direct alcanzable el límite de archivo sube a ~22 MB y el vídeo va original sin
  previa ni HD aparte; sin él, todo como antes (el aviso de tamaño menciona Wi-Fi Direct).
- Simulador (`wifidirect.js`, ~2 MB/s): 600 KB en 4,5 s (0 trozos por Bluetooth) frente a 58 s por
  Bluetooth; 6 MB en 7 s; vídeo original en 5 s; si falla, por Bluetooth; credenciales y contenido nunca
  en claro. Batería completa (22 pruebas) en verde; Kotlin compilado en CI (2708). La velocidad real y el
  comportamiento con cada fabricante solo se ven en los teléfonos.

## Ronda 2707: Jump con cualquier teléfono NEXO (bajo demanda) + batería + selector de camino
El dueño: los únicos requisitos para ser puente son estar a alcance y tener NEXO (en la 2705 solo valían
teléfonos conectados, en la práctica contactos). Criterio de caminos acordado (seguridad y velocidad):
textos → directo, Jump, Wi-Fi, datos; archivos → directo (y Wi-Fi Direct cuando exista), Wi-Fi, Jump si el
tiempo es razonable; datos móviles siempre el último (cuestan dinero); sin señal, Jump para todo.
- Vecindario sin conectarse: cada NEXO visto al escanear (contacto o no) se anota 2 min.
- Búsqueda de camino bajo demanda ('rq'/'rp', máx. 4 saltos): cuando un mensaje propio no tiene enlace ni
  ruta; escaneo corto si hace falta, se pregunta a vecinos conectados y a cercanos (conexión de paso);
  quien vio al destino hace poco o tiene ruta contesta y la ruta queda puesta por el camino de vuelta. El
  puente conecta con el destino al usarla. Reintento con espera creciente (45 s … 10 min) solo mientras haya
  mensajes esperando: sin nada que enviar no se gasta nada extra.
- Conexiones de paso con desconocidos: máx. 3, se cierran tras 60 s sin uso; no se agregan como contacto
  ni salen en chats ni en el aviso de dispositivo nuevo. Se responde al kx (el lado que recibe la conexión
  también dice que entiende Jump) y su dirección se asocia al llegar sus paquetes.
- Batería (`getPowerStatus` en el plugin): con <15 % sin cargar o en ahorro de energía no hace de puente
  (no contesta 'rq', retira sus rutas, no da custodia); sus propios mensajes sí salen.
- Selector de camino (`relay.plan`): hoy directo o Jump (registra el tiempo estimado con la velocidad
  medida por salto); es donde se añadirán Wi-Fi Direct, Wi-Fi y datos.
- Fallos encontrados al probar y corregidos: 'rq'/'rp' sin marcar como paquetes de control (el puente los
  mostraba como mensaje y agregaba al emisor como contacto); conexión de paso que caía y no se borraba (el
  puente no volvía a conectar con el destino); al reconectar con un vecino conocido no se le repetía la
  pregunta pendiente.
- Lo más cercano primero: si el destino se vio hace <30 s se intenta directo (8 s) antes de buscar
  puente; un puente solo dice "llego" si lo vio hace <30 s (si no, escanea antes). Lo que salió por un
  puente y aún no tiene ✓✓ se reenvía directo en cuanto hay enlace con el destino (duplicado descartado
  por id): un puente que se quedó sin camino ya no deja el mensaje parado.
- Simulador: `jump.js --stranger` (B no es contacto de nadie), `--stranger --low-battery` y
  `--direct-later`. Resultados: con desconocido en medio el primer texto llega en ~15 s (incluye 8 s de
  intento directo y la búsqueda), largo y foto, ✓✓, leído, respuesta; B sin contactos ni chats;
  conexiones de paso cerradas solas (~80 s). Batería 10 %: B no hace de puente; enchufado, llega en ~55 s.
  Batería completa (21 pruebas) y Chromium real en verde. Kotlin (`getPowerStatus`) compilado en CI.

## Ronda 2705: Jump fase 2 — mensajes de varios saltos (A → B → C)
Pedido del dueño: saltos entre teléfonos, cualquier teléfono NEXO hace de puente, textos y fotos (el
cifrado de extremo a extremo de la 2702 era la fase 1). Nuevo `src/ui/ble_relay.js`:
- Rutas por vector de distancias: cada teléfono anuncia (`rt`) a sus vecinos conectados a quién alcanza y
  en cuántos saltos (máx. 4), sin devolver a un vecino lo aprendido de él; cada 30 s y al cambiar un
  enlace; caducan a los 95 s o al caer el vecino. Solo a vecinos que entienden Jump (su `kx` lleva
  `j:1`): una build anterior mostraba los paquetes desconocidos como mensajes de texto (comprobado con
  la 2701: también le pasa con el `kx` desde la 2702; con la 2704 ya no hay basura).
- Envío: si el contacto no está a alcance pero hay ruta, textos (cortos y largos) y adjuntos salen por el
  siguiente salto con su destino (`to` en paquetes, `dt`/`hp` en la cabecera de flujos), cifrados para el
  destino. El puente confirma que lo guarda (`rk` o el ack final del flujo) → ✓ en el emisor; lo apunta en
  una cola persistente (`nexo_relay_queue.json`, archivos aparte, tope 30 MB, 24 h) y lo reenvía; si se
  queda sin ruta, espera. El destino confirma de extremo a extremo (ack/leído dirigidos al origen) → ✓✓.
  Sin ruta ni enlace, el mensaje espera en el emisor y sale en cuanto aparece una ruta.
- Lo que llega por un puente no se asocia a la dirección del puente (contacto, mapeos). La clave de
  cifrado de un desconocido que escribe por un puente se guarda al crear el contacto; si falta se pide de
  extremo a extremo (`kx` dirigido; un puente nunca puede cambiar una clave ya conocida).
- Los puentes solo ven quién, a quién y los ids; no pueden leer el contenido ni lo muestran.
- Límite (resuelto en la 2707): los puentes eran solo teléfonos ya conectados (en la práctica contactos).
- Simulador: modelo de alcance (`radio.block/unblock`) y `tests/sim/jump.js` (A–B–C conocidos,
  `--shared` A nunca vio a C, `--chain` A–B–C–D con 3 saltos). Verificado: textos, largo y foto llegan,
  ✓✓ y leído vuelven, la respuesta vuelve, los puentes no leen ni guardan nada, custodia (C se aleja
  cuando B ya tiene la foto → la entrega al volver) y batería completa (19 pruebas) + Chromium real.

## Ronda 2704: archivos (APK sin aviso, PDF que no abría)
Dueño: "no puedo enviar APK (no sale ningún aviso)" y "los PDF llegan pero sin vista previa y no abren".
- Sin aviso: el `<input>` del selector se quitaba a los 30 s; si se tardaba más en elegir (buscar la APK en
  Descargas, un vídeo en la galería) lo elegido no hacía nada y sin aviso (reproducido en `files.js` con la
  2702). Ahora vive hasta que se elige (`_pickFile`), un error de lectura avisa y cada paso deja `[ATTACH]`
  en el diagnóstico. Las APK suelen pasar del límite de ~2,1 MB: ahora sale el aviso (subirlo depende de
  L2CAP, siguiente ronda).
- No abría: la burbuja de un archivo que no es foto/vídeo era solo una etiqueta, y el tipo (mime) no
  llegaba al otro teléfono (`_sendAttachment` pisaba `meta.type` con 'file'). Ahora viaja `mime`; la
  burbuja muestra icono, nombre (como texto: antes se metía como HTML), tamaño y páginas, y al tocar el
  plugin `openFile` lo escribe en la caché y lo abre con la app que corresponda (FileProvider +
  ACTION_VIEW). APK: permiso `REQUEST_INSTALL_PACKAGES`; Android pide permitir a NEXO instalar apps la
  primera vez.
- Miniatura PDF: `pdfThumbnail` (PdfRenderer de Android) dibuja la 1.ª página al enviar; viaja cifrada en
  la cabecera (`th`, páginas en `pg`); el receptor la genera si no llega.
- Verificado: batería jsdom (15 pruebas, nueva `files.js`) y Kotlin compilado en CI (run de la rama de
  trabajo, firma OK). La apertura real (lector de PDF, instalador) solo se puede comprobar en el teléfono.

## Ronda 2702: cifrado de extremo a extremo (fase 1 de "jump") + reenvíos inútiles
Plan acordado con el dueño para jump (saltos A → B → C, cualquier teléfono NEXO hace de puente, textos y
fotos): primero cifrar, después las rutas. Esta ronda es el cifrado.
- `src/vault/e2e_crypto.js` (WebCrypto): identidad ECDH P-256 por teléfono (`nexo_e2e_identity.json`,
  la privada no sale), clave por pareja ECDH → HKDF-SHA256 → AES-GCM 256, IV aleatorio por mensaje.
  Formato `E1:<pública emisor>:<iv>:<datos>`. Se cifra el contenido (textos cortos y largos, adjuntos,
  nombre y miniatura del archivo); quién/a quién/ids/acks van en claro (los necesitarán los puentes).
- Claves: paquete `kx` al conectar (y a petición, `rq`); la primera se guarda en el contacto (TOFU); si
  cambia (reinstalación) se acepta y se avisa (`keyChangedAt`). Al compartir un contacto va su clave:
  A puede cifrar para C sin haberlo visto (base de jump). Sin clave del destinatario se pide y se
  espera 5 s; si no llega → `NO_KEY` y el mensaje queda pendiente: **nunca sale en claro**.
- Chat: aviso arriba (🔒 / ⏳ esperando clave / ⚠️ clave cambió); al pulsarlo, huellas de ambos para
  comparar en persona. Líneas `[E2E]` en Perfil → Diagnóstico.
- Compatibilidad: un teléfono con una build anterior no descifra. Lo que se le envía espera (reloj) y
  llega cuando se actualiza; lo que manda él (en claro) sí se recibe. **Actualizar ambos teléfonos.**
- Fallo previo encontrado al probar (desde siempre): el registro de envíos salientes de un texto largo o
  archivo no se borraba al entregarse; al abrir la app (a los 3 s) o al reconectar con algo pendiente
  se volvían a enviar **todos** (hasta 50, vídeos incluidos), ocupando la radio minutos. Ahora se borra
  al entregar, y lo que dejó la build anterior se limpia sin reenviar (consulta el historial). Las
  escrituras de ese registro van en cola por contacto (dos borrados a la vez se pisaban).
- Otros: un ack repetido resuelve el reenvío que lo espera (antes un mensaje entregado acababa en rojo
  tras 5 reintentos si se enviaba dos veces); un mensaje cifrándose cuenta como "en vuelo" (no se
  duplica); la re-búsqueda solo se aplaza por un envío de archivo que avanza (uno parado porque el otro
  cerró la app la bloqueaba hasta su tiempo máximo).
- Verificado: batería jsdom completa (14 pruebas, con `e2e.js`, `mixed.js` contra la 2701 y
  `resend.js`), `browser.js` en Chromium real (WebCrypto real: vídeo 720p, previa 38 s, HD 169 s,
  13,3 KB/s como antes, 3/3 reproducciones). En 1 de ~10 ejecuciones de la batería el escenario
  "app cerrada + vídeo" no entregó nada (sin log; no se volvió a reproducir en 8 repeticiones).

## Ronda 2701: vídeo previa → HD revisado
El dueño no veía el cambio a HD. Causa más probable: vídeos de la galería (cámara del teléfono: 1080p/4K,
10-25 MB por 5 s) superaban `MAX_HD_B64_BYTES` y solo viajaba la previa. Ahora, si el original es >2,5 MB
o >720p, en la MISMA pasada de la previa se graba un HD 720p a 1,2 Mbps (`HD_DIRECT_MAX_BYTES`,
`HD_MAX_SIDE`, `HD_REENCODE_BPS`); si no, el HD es el original. Etiqueta con tiempo restante
("HD 45% · ~2 min"), registro `[VIDEO] Previa entregada en X s` / `HD entregado en Y s (KB, KB/s)` y la
burbuja propia se pinta desde una URL del archivo (sin decodificar base64: quitaba ~1 s de bloqueo).
Chromium real (`browser.js`, `--big`): clip 720p 972 KB → previa 227 KB en 29 s, HD (original) a 126 s;
clip 1080p 2,1 MB → HD recodificado 1,66 MB, previa 33 s, HD 198 s. El simulador va a ~13 KB/s; en los
teléfonos del dueño se midieron ~4,4 KB/s (2695): previa ~1-1,5 min y HD ~5 min. La gran mejora
pendiente de velocidad es el transporte (binario / L2CAP) — ver pendientes.

## Ronda 2700: rendimiento (medido en Chromium real con la CPU frenada 4x)
Nuevo `tests/sim/stress.js` (3 teléfonos precargados, historial de B: 400 mensajes con 8 fotos y 2
vídeos) y `tests/sim/profile.js` (perfil de CPU por función). Misma prueba en 5 builds:

| Receptor B | 2679 (base dueño) | 2691 | 2698 | 2699 | 2700 |
|---|---|---|---|---|---|
| Ráfaga 40 textos: CPU | 100 % | 82 % | 81 % | 84 % | 40 % |
| Ráfaga: congelón máx. | 43 s | 2,4 s | 1,7 s | 2,6 s | 0,08 s |
| Multi-chat: congelón máx. | 3,9 s | 0,17 s | 0,24 s | 0,24 s | 0,08 s |
| Abrir chat 400 msj: CPU | 5,4 s | 6,0 s | 4,8 s | 5,3 s | 1,1 s |
| Abrir chat: congelón máx. | 2,5 s | 2,4 s | 1,8 s | 1,9 s | 0,4 s |

Conclusión: entre 2691 y 2699 no hubo regresión de CPU; la lentitud venía de defectos antiguos que
crecen con el historial (por eso se nota más con el uso):
1. Cada mensaje dibujado programaba `scrollTop = scrollHeight` (relayout de todo el chat por mensaje).
2. Inserción de burbujas recorriendo todas las anteriores (O(n²) al abrir un chat).
3. Al abrir un chat el historial se cargaba y dibujaba DOS veces (`ble_interface.openChat` →
   `nexo:vault:messagesLoaded` con todo y sus adjuntos leídos de disco) y `nexo_app` registraba cada
   mensaje como "recibido".
4. Historial reescrito entero en disco con cada cambio de estado.
Arreglos: página de 60 mensajes (anteriores al subir), inserción desde el final, un scroll por fotograma,
mensajes nuevos al disco al momento y estados agrupados (300 ms). Además:
- **Fallo real**: "atrás" + abrir otro chat en <300 ms dejaba el chat nuevo sin contacto activo (mensajes
  pintados pero no enviados, fotos no enviadas). Afectaba a todas las builds anteriores.
- Radio: la re-búsqueda y el escaneo automático se pausan durante transferencias de archivo (comparten
  la radio). `perf.js --absent --scan-penalty=1.6`: PDF 150 KB 23,5 s (2699) → 18,4 s.
Pendiente medido: al enviar un vídeo, un bloqueo de ~1 s en el emisor (con CPU 4x; también en 2679).

## Ronda 2699 (verificada en simulador + Chromium real)
**Compartir contactos** (último botón del menú de adjuntos), como WhatsApp:
- Abre una hoja con los contactos (buscador, casillas, "Enviar (N)"); se envía un adjunto `contact`
  con `{ contacts: [{ nexoId, name }] }` por el camino de texto (como la ubicación). Sin dirección
  Bluetooth (cambia y no sirve al otro).
- En el chat aparece una tarjeta "👤 Contacto(s)". En el receptor, pulsarla (o "Agregar a contactos")
  llama a `bleInterface.addSharedContacts`: valida `NX`+8, omite el propio y los ya existentes; los
  nuevos quedan arriba **parpadeando** (`isNewShared`, clase `ble-contact-new`) hasta abrir su chat, con
  "Nuevo contacto · listo para escribir", y se empiezan a buscar por radio. "Escribir" abre su chat.
- Para que estén "listos para el uso": `openChat` ya no rechaza un contacto sin dirección conocida, y
  escribirle deja el mensaje en la cola por contacto hasta encontrarlo (antes "Dispositivo no
  encontrado"); adjuntos quedan pendientes (`PEER_ABSENT`).
- Nombres en la lista y la barra "en línea" como texto, no HTML (venían de otros teléfonos).
`tests/sim/share.js`: B nunca había visto a C → tras agregarlo, mensaje B→C en 1 s; con C fuera de
alcance queda "enviando" y llega a los 30 s al volver C. Batería completa y `browser.js` sin cambios.

## Ronda 2698 (verificada en Chromium real + simulador)
Prueba real de la 2697: el vídeo no llega, no pasa a HD, no se ve la miniatura y solo se reproduce una
vez. Nuevo `tests/sim/browser.js` (Chromium real): con la 2697 el ciclo completo funciona en Chromium
(previa real 177-230 KB, miniatura, HD, app cerrada) pero quedaban 3 reproductores vivos tras abrir el
visor 3 veces. Conclusión: lo que falla es propio del WebView de Android.
1. **Reproducir más de una vez**: cada burbuja creaba un `<video>` (preload=metadata) y el visor no se
   liberaba al cerrar; en Android cada reproductor retiene un decodificador de hardware. Ahora la burbuja
   muestra la miniatura (`<img>`), el reproductor solo existe en el visor y se libera
   (`pause`+`removeAttribute('src')`+`load`). Chromium: 0 reproductores vivos (antes 3).
2. **Previa que podía colgarse** (si el grabador no terminaba, el vídeo no se enviaba nunca): vigilante
   general, detección de atasco, vídeo temporal dentro de la pantalla (Android no decodifica ocultos),
   AudioContext reanudado o previa sin audio. Si falla: original con miniatura (`--no-preview`).
3. **Miniatura**: también sin previa (`_makeVideoThumb` del original) y, si un vídeo llega sin ella, se
   genera al dibujarlo y se guarda (`metaMerge`).
4. **Diagnóstico**: Perfil → Diagnóstico (eventos clave + últimas líneas, también de la sesión anterior)
   con botón Copiar. Es la forma de ver qué pasa en el teléfono real.

## Ronda 2697 (verificada en simulador)
Prueba real de la 2696: vídeo + texto a un teléfono con la app cerrada → al abrirla no llegó nada; la
previa no se veía; el vídeo recibido solo se reproducía una vez.
1. **Vídeo a contacto ausente perdido**: `sendFile` esperaba ~40 s a la dirección vieja, rechazaba "not
   ready", `main.js` lo trataba como transitorio y lo dejaba en 'sending'; como la transferencia no había
   empezado no había nada que reanudar y `_isResendable` excluía adjuntos en 'sending'. Ahora falla en 8 s
   (`PEER_ABSENT`), busca al contacto y el adjunto se reenvía al reconectar (adjuntos 'sending' sin
   transferencia viva son reenviables; `_sendFileJS` no duplica). El HD arranca también tras ese reenvío.
2. **Textos que no salían tras reabrir el otro**: `_pendingMessageQueue` iba por dirección Bluetooth; al
   reabrir, Android cambia la dirección y la cola vieja no se vaciaba nunca (y `_isMsgInFlight` impedía
   el reenvío). Ahora la cola es por contacto (`nx:<id>`) y se vacía en `_notifyPeerReady`.
   `background.js --scenario=closed --video --pre-wait=15000 --off=90000 --rotate`: 2696 nada; ahora
   textos 6 s, previa 11 s, HD 41 s tras reabrir.
3. **Vídeo que solo se veía una vez**: cerrar el visor revocaba la URL que usa la burbuja; además cada 50
   mensajes se revocaban todas. Ahora solo al salir del chat (`video.js`: 2696 URL destruida; ahora no).
4. **Miniatura**: fotograma JPEG de la previa en la cabecera (`th`) → `poster` del vídeo (en Android un
   `<video>` sin poster se ve gris/negro hasta reproducirlo).

## Ronda 2696 (verificada en simulador salvo la recodificación)
**Lista de contactos que saltaba**: se ordenaba por `lastSeen` (cambia con cada ping/escaneo/
reconexión). Ahora por `lastMessageAt` (último mensaje enviado o recibido; `noteContactMessage` en
`ble_interface.js`), la fila muestra ese mensaje y su hora, y se redibuja como mucho cada 300 ms (antes
con cada paquete). `window.vaultSaveContacts` no estaba expuesto: último mensaje/no leídos nunca se
guardaban. `tests/sim/contacts.js --churn`: 2695 cambiaba de orden sin mensajes; ahora estable.
**Vídeo en dos pasos** (`main.js` `_sendVideo`): previa recodificada en el teléfono (240p, 60-200
kbps, `_makeVideoPreview`: video → canvas + WebAudio → MediaRecorder) enviada como mensaje normal; al
llegar, el original va solo como transferencia `<msgId>_hd` (cabecera `hf`), con textos intercalados, y
en el receptor sustituye a la previa en el mismo mensaje (`vaultReplaceAttachment`). Estado `hdStatus`
en el historial; se retoma al reconectar (`_resumeHdTransfers`) o al reabrir. Cámara a 1,5 Mbps.
Límites: previa ≤ 60 s de vídeo, HD ≤ ~6 MB; si no se puede recodificar se envía el original como antes.
`tests/sim/video.js` (previa simulada): previa 5 s, texto durante el HD 0,2-0,4 s, HD 300 KB 35 s,
corte de enlace al 30 % → completa (59 s), A cierra la app al 30 % → completa (42 s), 2 MB 213 s.
**Sin verificar**: la recodificación real (MediaRecorder/canvas no existen en jsdom): calidad y tamaño
de la previa solo se ven en el teléfono (log `[VIDEO] Previa WxH N KB`).

## Ronda 2695 (verificada en simulador)
Prueba real de la 2693: con B en segundo plano o cerrada seguían faltando mensajes; vídeo de 5 s = ~8 min.
**Causa principal (reproducida con `--io-delay=25`)**: `vaultAppendMessage`/`vaultUpdateMessageStatus`
leían el historial, lo modificaban y lo guardaban sin exclusión. Con la caché vacía (app recién abierta)
dos mensajes seguidos (y cada uno se guarda dos veces: `ble_interface` y `main.js`) leían el mismo
archivo y el último guardado borraba los demás. A veía "entregado" y B no tenía nada. Arreglo: cola por
contacto (`_withMsgLock`), carga compartida y una lectura lenta ya no pisa una caché más nueva.
Con 2693: 0/3 guardados; ahora 3/3 (25 y 60 ms de latencia).
**Textos repetidos**: `_renderMessage` descartaba un recibido igual a uno de los 5 últimos ("ok") y A
veía ✓✓. 2693: 1 de 3 visibles; ahora 3 de 3.
**Robustez de reconexión** (no reproducía pérdida en el simulador, pero eran puntos frágiles):
`@capacitor/app` no está instalado → al volver a la app no se hacía nada; ahora aviso nativo
`onAppStateChange` + `visibilitychange`. Re-búsqueda sin tope de 10 min (15 s → 60 s; tras 30 min cada
5 min solo si hay pendientes), también oculta con escaneo filtrado (Android no da resultados sin filtro
con pantalla apagada), y 2 min de búsqueda de contactos al abrir/volver.
**Vídeo** (sin cambios aún, pendiente de decisión): grabación a 1280x720 y ~2,5 Mbps (por defecto de
MediaRecorder) = ~1,6 MB por 5 s; medido ~4,4 KB/s reales. Plan propuesto: 1) grabar/recomprimir a
640x360 ~400 kbps (~6x menos); 2) idea del dueño: vista previa rápida y HD después en segundo plano o
bajo demanda; 3) transporte binario (sin base64/JSON, ~1,6x) para todos los archivos.

## Ronda 2693 (verificada en simulador)
**Pérdida al reabrir / segundo plano** (reproducida con `tests/sim/lifecycle.js`):
1. Capacitor descarta `notifyListeners` si el JS aún no escucha → `onPayloadReceived` ahora con
   `retainUntilConsumed=true`.
2. Si el otro tenía la app cerrada, la conexión quedaba abierta sin servicio NEXO y bloqueaba la
   reconexión → se cierra (`closeClientWithoutService`) y el JS reintenta también desde ERROR.
3. Conexiones abiertas antes de que el JS arrancara → `getConnectedDevices` (con `ready`) al iniciar.
4. Cola de pendientes enviada sin ack → `sendWithRetry`; cualquier paquete del otro dispara el reenvío.
5. Sync de sesión comparaba `seq` mezclados → solo el `seq` del otro; reenvía lo propio sin confirmar.
Resultado: 3/3 mensajes llegan ~2 s después de que arranca el JS de B, estado "entregado", también
con direcciones asimétricas y `seq` altos. 2691 en el mismo escenario: perdidos o hasta 43 s.

**Velocidad**: el nativo esperaba fijo 40 ms (cliente) / 80 ms (servidor) por escritura y reintentaba
con `Thread.sleep` en el hilo principal. Ahora envía la siguiente en cuanto Android confirma
(`onCharacteristicWrite` / `onNotificationSent`, respaldo 300/200 ms), la cola solo se procesa en el
hilo principal, PHY 2M. JS: ventana de archivo 12, pausa 2 ms.
Foto 60 KB / PDF 150 KB (MTU 512): antes 11 s / 36 s → radio rápida (15 ms) 5,6 s / 18,6 s; lenta
(30 ms) 8,1 s / 26,9 s. 0 descartes de cola. Con 3 % de pérdida (3 corridas): fotos 13-21 s (una vez 45 s),
PDF 74-106 s, siempre completan; igual que la 2691 (en BLE real la capa de enlace reenvía: peor caso artificial).
**Percepción**: "○ N%" en la burbuja propia y "📷 Recibiendo foto… N%" en el chat del receptor.

## Regla de trabajo (pedida por el dueño)
Reproducir el fallo en el simulador, corregir, confirmar y solo entonces subir y avisar. Nunca dar
resultados no comprobados. Respetar la estructura existente (NEXO ID, mapas, vault). Batería mínima:
```
tests/sim/build.sh && node tests/sim/run.js tests/sim/builds/wip --content-fallback
node tests/sim/perf.js tests/sim/builds/wip --pdf-kb=150 [--pace=15,15 | --mtu=247 | --loss=0.03]
node tests/sim/lifecycle.js tests/sim/builds/wip --retain --close-no-service --asymmetric --js-delay=6000 --io-delay=25
node tests/sim/background.js tests/sim/builds/wip --scenario=closed --rotate --no-m3 --io-delay=25 --app-events
node tests/sim/contacts.js tests/sim/builds/wip --churn --io-delay=25
node tests/sim/browser.js tests/sim/builds/wip [--closed | --no-preview]   # Chromium real
node tests/sim/share.js tests/sim/builds/wip --io-delay=25 [--c-away]
node tests/sim/stress.js tests/sim/builds/wip    # rendimiento (Chromium real, CPU 4x, ~10 min)
node tests/sim/video.js tests/sim/builds/wip --io-delay=25 [--cut | --restart-a]
node tests/sim/background.js tests/sim/builds/wip --scenario=closed --video --no-m3 --pre-wait=15000 --off=90000 --rotate --io-delay=25 --app-events
```
Ver `tests/sim/README.md`. Límites: no simula la radio real (velocidad, alcance) ni Kotlin en sí.

## Problemas conocidos (sin corregir)
- Recibir con la app cerrada (deslizada) necesita mover el servidor GATT al `BleService`.
- `window.vaultSaveContacts` no expuesto: algunos cambios de contacto no se guardan.
- HTML sin escapar con datos del otro teléfono (nombre de contacto, último mensaje; el de archivo ya no).
- Transferencias en base64 dentro de JSON (+33 %). `FileTransferManager.kt` (binario) desconectado:
  siguiente gran mejora de velocidad.
- Trozos con emojis/acentos pueden superar el MTU en bytes (el nativo trocea por caracteres).
- Cifrado E2E desde la 2702 (`e2e_crypto.js`; `crypto_vault.js` sigue sin usarse). La clave de un
  contacto se acepta con aviso si cambia (sin verificación automática: comparar huellas en persona).
  `quickScanForNexoId` bloquea hasta 5 s.
- Manifest declara `.mesh.NordicMeshService` inexistente; falta `@capacitor/app`;
  `_showPaymentModal` usa `self` sin definir.

## Código no usado (visión a futuro)
Limpieza del 22-10-2026 (pedida por el dueño): se borró lo sustituido por código vivo — `src/media/*` (ahora
`ble_ack.js`), `src/mesh/*` (ahora Jump), `src/fenix/fenix_backup.js` (ahora `fenix.js`), `autoscan`,
`ble_permissions`, `utils/permissions`, `SetupManager`, `SetupWizard`, copias en `src/main/`, la app antigua
`client/` (webpack la copiaba dentro de la APK: 49 archivos + 3 iconos) y sus workflows, `dist/android/`, y en
Kotlin `FileTransferManager`, `FileTranferProtocol`, `MessageChunker`, `NexoBleServer`, `NexoGattService` y
`sendFileNative` (el JS no los usaba); después, `src/vault/chispas/` (el dueño: se puede eliminar). El JavaScript de la APK quedó idéntico byte a byte.
Se conservan para más adelante: `src/net/*` + `server/relay/` (Wi-Fi/datos), `plugins/nexo-auth` +
`src/vault/crypto_vault.js` + `src/auth/*` (huella y cifrado en reposo, fase 3). Pendiente de que el dueño
explique: nada (revisado el 22-10).
Borrados después (sin función real): `virtual_engine.js` (lista virtual, no el "motor" de la app),
`vault_fs.js` (guardado antiguo, sustituido por `vault_manager.js`), `vault_panel.js` (maqueta con contactos
inventados y Chispas), `the_stream.js` (era una lista de mensajes de chat, no el feed), `core/gesture_engine.js`.
Se conservan `src/stream/pulse_algorithm.js` (orden de publicaciones) y `src/ui/gesture_engine.js` (gestos
desde los bordes) para **Stream**: pantalla con Vídeos (arriba izq.) y Estados de contactos (arriba der.),
deslizar arriba = siguiente, doble toque = me gusta, deslizar a la izquierda = comentarios, a la derecha =
volver a contactos. El dueño decidió dejarlo para más adelante (propuesta: Estados primero, cifrados y sin
Internet; Vídeos cuando haya núcleos o servidor).
`gesture_engine.js`, `vault_fs.js`, `vault_panel.js`.
