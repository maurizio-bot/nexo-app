# NEXO — Lo que falta (lista viva)

> **Desde el 16-11 lo vigente está ordenado por área en `docs/AREAS.md` (seguridad y negocio en el privado); esta lista queda como historial.**
> Lo nuevo se anota en `docs/AREAS.md`, en su área y con su peso, y se recalcula el % de la tabla.

Lista pedida por el dueño el 23-10-2026 para no olvidar nada. Leer al empezar cada sesión (CLAUDE.md lo indica) y
actualizar al terminar cada bloque. Estado al día de cada build: `docs/PROGRESO.md`.

## 🎯 META (dueño 15-11): Google Play para EDC México (feb 2027) — el detalle está en el repositorio PRIVADO `maurizio-bot/nexo-private`
(`negocio/PENDIENTES_NEGOCIO.md` y `negocio/PLAN.md`).

## 🧾 Revisión externa (IA del dueño, 19-11, sobre la nightly 3101) — comprobado aquí lo verificable
- **P0 publicación (CONFIRMADO):** targetSdkVersion 34 → Google Play exige 36 para apps nuevas (subirlo y probar cambios de Android 15/16:
  servicios en primer plano, edge-to-edge, permisos); el workflow hace assembleDebug → falta bundleRelease firmado; REQUEST_INSTALL_PACKAGES en el
  manifest (el actualizador propio no es uso permitido en Play: quitarlo en la versión de tienda); versión dispersa (package.json 9.0.0,
  index.html v9.0, main.js v9.9.52, nexo_config 9.1.0-b1273) → una sola fuente. Prueba cerrada de 12 personas 14 días (cuenta nueva).
- **Técnico (sin cambiar lo que funciona):** 331 asignaciones a window.* (main.js orquesta todo) → ir pasando a interfaces estables
  (Mensajes, Transferencias, Contactos, Caminos, Vault, Llamadas); ciclo grande de ~29 piezas en la UI (render ↔ chat_actions ↔ send ↔
  video_send ↔ file_card ↔ media_limits…), y main ↔ main_chats, net_link ↔ gw_link, vault_messages ↔ vault_contacts ↔ vault_big ↔
  vault_transfers; partir ble_ack.js (923 líneas) en protocolo / emisor / receptor / ventana / reintento / reanudar / estado; el Vault es una
  base de datos casera sobre JSON (leer → cambiar → escribir con cachés y candados): deuda a vigilar, no cambiar mientras esté estable.
- **Ajustes:** Perfil (foto, nombre, NEXO ID) y Ajustes en 6 secciones (Privacidad, Avisos, Llamadas, Conexión, Cuenta, Diagnóstico) con lo
  avanzado oculto. Bienvenida: enseñar 3 gestos clave (visible la primera vez, gesto rápido después). Estética: «menos efectos, más identidad».
- **Plan de lanzamiento y posicionamiento:** en el privado, `negocio/REVISION_EXTERNA_2026-11-19.md`.
- **Producto (decide el dueño):** menú + en dos filas (Cámara/Galería/Archivo arriba); enseñar Estados la primera vez; nombre cambiable con
  historial y aviso en vez de irreversible; indicador simple de camino (Directo/Wi-Fi/Internet/Puente); ajustes con avanzadas ocultas;
  no prometer «Signal Protocol» (es propio, inspirado). Código muerto sin uso desde main.js (mesh_relay_bridge, web_socket_client,
  pulse_algorithm, gesture_engine, crypto_vault): comprobar y quitar. Ciclos de dependencias: limpiar poco a poco, sin reescribir.

## 🔝 PASO 0 (dueño 19-11): auditoría de seguridad completa ANTES del cambio del Bluetooth («partir con una base limpia»)
- Como la de la noticia (IA buscando fallas): todas las puertas (Bluetooth, Wi-Fi local, Wi-Fi Direct, relés, puente, nativo, cifrado,
  vault, enlaces de invitación). Lo hallado se arregla y se prueba; el informe va al repositorio PRIVADO (no al público). Otra después del cambio.

## 🔝 PRIORIDAD 1 (dueño 19-11): Bluetooth entero en el servicio nativo
- «Las otras apps (Briar, Bitchat, Bridgefy) lo hacen bien»: todo el Bluetooth (recibir, confirmar, reenviar, anunciar con la clave cifrada) en
  el servicio en primer plano, sin depender de que la app (WebView) esté despierta. Resuelve los «zombi», el Bluetooth tras reiniciar y la
  confirmación con la app congelada. Empezar con el límite semanal recién reiniciado (no dejarlo a medias).
- **Idea del dueño (19-11): romper el tope de ~7 conexiones.** Lo que se encuentra al escanear queda en la lista SIN conectarse (ya es así
  para desconocidos); se conecta solo al usarlo. Llevarlo a los contactos: un grupo de pocas conexiones abiertas (las de uso reciente) y el
  resto a demanda (conectar ~0,5–2 s al mandar y soltar al quedar quieto). Lo pequeño (contador, presencia) por anuncios, sin conexión.
- **Modo vagón (dueño 19-11, para redes):** contador de NEXO cerca por anuncios (sin conectar ni identificar), saludo solo con nombre de pila
  y solo entre quienes lo activaron, el otro acepta. Después del punto anterior.

## 🆕 18-11 05:00 — diagnósticos del S23 (Carii), del A05 de Italia y resúmenes diarios
- richard (Redmi 14C, 3090) con Mami (A05) 17-11 22:16: su Bluetooth falla 7 veces seguidas al conectar a la dirección de Mami
  (error 133 de Android) y abre 3 enlaces con ella (el desempate cierra uno). La foto de perfil de Mami (8 KB) le llegó 3 veces en
  1,5 min: cada vez que richard abre la app (Xiaomi se la cierra solo: «SwipeUpClean») pregunta por la foto antes de que entre la
  que ya estaba en camino, y Mami la reenvía. REVISADO 18-11: eran «deslizar para actualizar» (sq con av:1, 3 veces en 5 s), que
  por decisión del dueño (3095) pide la foto otra vez aunque se tenga; freno de 15 s por contacto; se deja así.
- «Internet al abrir el chat» 13 s (resumen del dueño): NO es lentitud nuestra: el saludo sale al abrir y la respuesta se detecta al
  instante (_deliver llama a tick). Lo que tarda es que el OTRO conteste: solo su app (JS) descifra y contesta el saludo, y en segundo
  plano Android la tiene adormilada. Arreglo de raíz (grande): que la escucha nativa sin la app conteste el saludo.
- BLUETOOTH MUERTO TRAS REINICIAR EL TELÉFONO (Marcos; también Carii tras el fallo nativo 22:48): BleService arrancado sin la app
  (NexoRestartReceiver/FCM/START_STICKY) no tiene currentNexoId ni ridKey (solo en memoria) → no anuncia; y el servidor GATT lo
  arranca el plugin al cargar la app. DUEÑO 18-11: SÍ a guardar cifrada la clave, pero solo no basta (el servidor GATT y la recepción viven en el
  plugin): hace falta llevar el Bluetooth entero al servicio. EN PAUSA hasta que se reinicie su límite (domingo): «no quiero empezar
  algo y no poder terminarlo».
- BUZÓN DE ARCHIVOS LENTÍSIMO AL RECIBIR (confirmado en 3 teléfonos el 17-11): S23 recibe a 0,3 KB/s de media (envía a 164), el del dueño 3 KB/s (envía a 42), el A05 46 KB/s. Investigar la bajada (_blobPointerReceived / fetch por trozos): prioridad alta.
- S23 (3091): FALLO NATIVO de la app a las 22:48 (en segundo plano) justo cuando terminó la videollamada con el dueño (22:44–22:48:54): «colgó el S23» fue en realidad el cierre por fallo. Android reinició el servicio a las 22:49:01 y la llamada siguiente del dueño (22:49:03) sí sonó. Sin traza del fallo en el diagnóstico: añadir la causa del cierre nativo (ApplicationExitInfo trace) al diagnóstico.
- S23: «internet listo» hasta 157 s (media 9,6 s).
- A05 de Italia (3087, vieja): 3 cierres por enlace repetido con richard en 10 min (el pendiente del desempate) y un texto de 3 trozos que agotó 8 reintentos por un Bluetooth atascado; quedó pendiente y salió al reenviar (sin pérdida). 2 cierres por falta de memoria (Android) el 17-11.

## 🆕 17-11 23:40 — dueño: los estados como TikTok (3230, hecho; falta que lo pruebe en el teléfono)
- Hecho en 3230 (ver PROGRESO). Decisiones mías para revisar con el dueño: (1) el orden pone primero a los contactos con algo sin ver (el más viejo primero) y después los ya vistos; (2) el texto «1/3» junto a la hora indica que hay más de lado (sin puntitos); (3) tocar mi círculo siempre abre «publicar»; mis me gusta y comentarios se ven tocando «❤️ n 💬 n ›» abajo en mis estados; (4) un audio suena una vez (no se repite como el video).
- Pendiente: «Mis estados» (lista para quitar uno) y la ventana de publicar siguen con su diseño de antes.

## 🆕 17-11 23:15 — dueño: botones de la videollamada al voltear la cámara, novedades, botón de regreso en Ajustes
- 18-11: su diagnóstico 23:02 no traía el giro de cámara ni los botones (no se apuntaban). 3229 los apunta; preguntado al dueño si «voltear» es el botón Girar o girar el teléfono. Con el próximo diagnóstico se ve qué pasa.
- **Videollamada: «al voltear la cámara no aparecen los botones, y al regresar a la vista normal ya no aparecen».** En Chromium real
  (llamada A↔B, voltear, esperar, tocar; volver a voltear) NO se reproduce: tocar muestra/oculta bien. Sospecha: en el teléfono el cambio
  de cámara pausa/reanuda la app y la pantalla de llamada queda en otro modo (miniatura de la app «nc-appmini» o ventanita). Falta el
  diagnóstico del S24 justo después de que pase. Prueba de reproducción: scratchpad/flipbtn.js.
- ✅ **Novedades solo en español** mientras sigamos en desarrollo (CLAUDE.md actualizado; al escribir la próxima en solo español,
  ajustar novedades.js e idiomas5.js I5).
- ✅ **3228: sin botón de regreso en las secciones de Ajustes** (se vuelve con el gesto atrás, como en toda la app).

## 🆕 17-11 21:30 — dueño: Tetris, deslizar para contestar, audio de la S23, aviso fijo de Jhonnatan, Yaelito
- ✅ **3223** deslizar para contestar desde la parte izquierda de un mensaje recibido (cerraba el chat) y basura del Tetris que se
  perdía al llegar desordenada por internet. ✅ **3224** nota de voz pendiente → buzón de archivos (llegó a los 17 min). Ver PROGRESO.
- **Aviso fijo «NEXO · Listo para recibir mensajes y llamadas» (Jhonnatan, Xiaomi, 22:16):** es el aviso del servicio que mantiene a
  NEXO recibiendo con la app cerrada; Android lo exige mientras el servicio corre (WhatsApp no lo necesita porque usa el servidor de
  Google). La 3165 lo dejó al mínimo (plegado, callado, al final, oculto en bloqueo); en Xiaomi sale igual. Se puede ocultar: mantener
  pulsado → apagar esa categoría («Servicio»); NEXO sigue funcionando. ✅ **3225** (dueño: «sí»): botón «Ocultar» en Ajustes que abre
  directo esa categoría.
- **Diagnóstico automático S23 21:39 «zombi» con Yaelito (los dos en 3091):** dos enlaces Bluetooth (5d5b… saliente, 6a15… entrante).
  A las 21:39:09 el desempate cerró el ENTRANTE (el único que seguía recibiendo: RX 21:38:49 y 21:39:09) y se quedó con el saliente,
  que no recibía nada desde las 21:38:33 → 4 pings sin respuesta y reconexión a los 26 s. Parecido a la 3139 (cada teléfono cierra
  uno distinto). Además el Wi-Fi local se cortó a los 3 s (ECONNREFUSED al puerto de Yaelito). HECHO en 3233: el desempate no cierra
  el enlace que está recibiendo si el que se queda lleva > 15 s callado.
- **Diagnóstico automático de Marcos (SM-A556E, 3090) «par:zombi» pedido por Roberto, 21:49:** (1) el MISMO diagnóstico (03:49 UTC)
  llegó 3 veces (03:56, 04:24 y 04:28 UTC): el canal de diagnósticos lo reenvía; revisar que se marque como entregado. HECHO en 3240: la bandeja no guarda dos veces el mismo (contacto + hora de salida + síntoma). (2) El teléfono
  se reinició a las 20:47 y NEXO volvió SOLO con la escucha de internet («Internet sin la app»); el Bluetooth (servidor y anuncio) no
  arrancó hasta que abrió la app a las 21:49: una hora sin Bluetooth (Roberto lo veía «zombi»). Revisar el arranque tras reinicio
  (¿Android no deja arrancar el servicio de Bluetooth desde el arranque?). (3) Su Wi-Fi y sus datos se alternan cada 1–2 min
  (21:34–21:48): relés que caen y vuelven; la escucha lo maneja.
- **Yaelito (Xiaomi 2312DRA50G, 3081→3091) «no le llegaban los mensajes»:** su registro nativo calla del 17-11 00:39 («sin memoria:
  Android la cerró») a las 21:23 (abrió la app y se actualizó): ~21 h sin NEXO vivo, ni el servicio ni los toques. En Xiaomi suele ser
  «Inicio automático» apagado o la limpieza al deslizar en recientes (SwipeUpClean ×7 el 16-11). Pedirle que revise Inicio automático
  y batería «Sin restricciones». Al abrir, todo entró en 1 s.

## 🆕 17-11 09:20 — pedidos del dueño en curso (ayudantes)
- **3199** (wtgaleria): diagnóstico Motorola edge 40 neo 3086 08:35/08:48: la foto elegida de la Galería no salía («No se pudo leer el
  archivo», NotReadableError) desde la revisión de la 3160 (se leía al tocar enviar) → copiarla al elegirla. Mismo diagnóstico: zombi a
  los 62 s (3187 OK) y 3 «Foreground kill» de Motorola en 7 días (3189/3192 la revive).
- **3200** (wtestadovid): Roberto no puede subir un video como estado (captura: vista previa del video rota). Pedirle al dueño: su
  diagnóstico justo después, modelo del teléfono y de dónde sale el video.
- **3201** (wtmapa): miniatura del mapa en la ubicación — **el dueño eligió la opción A** (quien manda baja una vez las teselas de
  OpenStreetMap y las manda dentro del mensaje cifrado; quien recibe no pide nada; sin internet, la tarjeta de hoy). A escala habrá que
  usar un proveedor de mapas (costo, decide el dueño).
- Pregunta abierta: reacciones y «eliminar para todos» en grupos (hoy solo en el propio teléfono).
- **3199, 3200 y 3201 INTEGRADOS (17-11 10:00).** Para el dueño, sobre el mapa (3201): la política de uso de las teselas de
  `tile.openstreetmap.org` pide permiso de su equipo de operaciones para una app que se distribuye y un User-Agent que diga NEXO (el
  WebView manda uno genérico). Para las pruebas con pocos teléfonos el riesgo es bajo; antes de Google Play: pedir permiso a OSM o
  pasar a un proveedor (MapTiler, Stadia…; costo) — decide el dueño. La URL está en una sola constante (`TILE_URL`).
- Diagnóstico de Roberto (= Motorola edge 40 neo, nx0g6ef54e, 3087, 09:32): (1) a las 08:33 publicó un video de estado de 1,7 MB y lo
  quitó a los 8 s (no se veía: 3200, CSP `media-src` sin `data:`); (2) un teléfono SIN identificar (…0da5) se conectó y desconectó de su
  servidor GATT cada 36 s durante 14 min con la app en segundo plano (gasto de radio y batería; ¿Zhelowsky 3026, versión vieja?): falta
  freno en el lado servidor; (3) al volver a la app, 24 `startAdvertising` seguidos (uno por cada desconexión acumulada): agrupar.

## 🆕 17-11 15:40 — diagnósticos automáticos (Marcos 3090 ×2, Roberto 3090, NX…DBFE 3087 en Italia)
- Marcos 14:44–14:48 con el HONOR (…c1ee, pedido «enlace abre y cierra»): hasta 5 enlaces Bluetooth a la vez entre los dos (cada uno se
  conecta a las direcciones cambiantes del otro); la app cierra los repetidos («me quedo con el mejor») y los mensajes pasan (uno de
  23 KB llegó directo en 7 s tras salir por el puente de Roberto sin ✓✓). Su Wi-Fi es inestable: de 14:52 a 15:05 el teléfono saltó
  Wi-Fi ↔ datos cada pocos minutos; cada salto deja ~20 s sin relés y pide puente.
- Marcos 15:38 (pedido por Roberto, «zombi»): app cerrada desde 15:05, Wi-Fi apagado y los datos sin internet de verdad (relés:
  SocketException) → internet por el puente del dueño en 16 s. **Menor:** un texto pendiente para el HONOR se reanudó por el Wi-Fi
  (apagado): «Sin Wi-Fi con nx1905c1ee» 20 veces seguidas (ble_ack_resume._resumeRunOne: si lo guardado y el contacto son `lan:` y el
  Wi-Fi no lo alcanza, debería esperar como con un Bluetooth sin enlace). No se pierde (queda pendiente).
- Roberto 14:49 («zombi» con Marcos): Roberto apagó/encendió el Bluetooth 14:48:24–26; luego enlaces a MTU 23 y el vigilante normal.
  Hizo de puente (Jump) para lo de Marcos al HONOR: entregado 14:45:12. **Aviso de MTU 23 prematuro:** «W [MTU] 23 (mínimo…)» y a
  los ~3 s «517» (ruido en el diagnóstico; avisar solo si sigue en 23 unos segundos). **Hecho en 3214** (mtuaviso.js; va en la 3093).
- **Datos (sigue la investigación de arriba):** Roberto: 34,1 MB hoy (Wi-Fi 19,7 · datos 14,1); en 15 min 1,4 MB de relés, 925 de
  1146 eventos ya vistos (81 %; nos.lol 1,1 MB, repetido 842 KB). NX…DBFE: a los 2 min de abrir, 314 de 354 ya vistos (89 %, 3 relés).
  Dos causas a medir en el simulador: (1) con Wi-Fi se escucha en todos los relés y cada evento llega una vez por relé (75 % con 4);
  (2) al abrir la app o reconectar un relé se pide desde «lo último visto − 10 min» (margen para relojes desfasados), aunque la
  escucha nativa ya entregó eso. Idea: margen según el desfase de reloj medido (no 10 min fijos) y, tras la escucha nativa sin
  huecos, pedir desde donde ella terminó. Con Wi-Fi escuchar menos relés es decisión del dueño (con datos ya aprobó 2).
- HONOR …c1ee (3090) 14:27–14:48 (pedidos por Marcos y Roberto): sin internet propio usó a Roberto de puente y relay.damus.io lo
  CASTIGÓ («banned: too many rate-limit violations»): ChatStream reintentaba un texto pendiente para el dueño cada ~1 s hasta 120 veces
  (40 rechazos en el registro; antes «Sin internet con … (20)» en 19 s; Marcos 15:38 «Sin Wi-Fi con … (20)»). **3209 INTEGRADO** (sin
  APK aún): un camino que dice que no al momento y sin otro mejor deja el envío pendiente (rechazado: al primer «no»; sin Wi-Fi o
  internet: a los 3 intentos) y lo retoma el reenvío de pendientes (rechazoreles.js: 96 → 8 rechazos en 40 s). Datos del HONOR: 74,8 MB
  hoy (Wi-Fi 42,5 · datos 31,1); a los 5 min de abrir, 2 MB de relés con 306 de 522 eventos repetidos (relay.primal.net 724 KB, 721
  repetidos) y 4 cambios Wi-Fi ↔ datos en 5 min: cada cambio reconecta todos los relés y vuelve a pedir los últimos 10 min → es la
  causa principal de lo repetido (ver arriba). Marcos tenía la 3043 a las 14:30 (ya actualizó a la 3090 a las 14:41).
- HONOR 14:20 (pedido por Marcos, «zombi»): recién actualizado (14:14) y con la **optimización de batería ACTIVA y el segundo plano
  NO permitido** («ENERGIA … segundo plano permitido NO, fabricante HONOR»); a las 12:28 el gestor de batería de HONOR (PowerGenie
  «smartopt clean») cerró NEXO a la fuerza. La app mostró el aviso de batería a las 14:13 y no se aceptó → al dueño: aceptar el aviso
  o en el HONOR Ajustes → Aplicaciones → Inicio de aplicaciones → NEXO en manual con todo permitido.
- nx…5928 (3069/3077, versión vieja): resumen del 15-11 con 55,6 MB (Wi-Fi 36,2 · datos 19,4) para 36 mensajes, 3 fotos y 5 audios
  en 7 min a la vista: otra muestra del gasto de datos de arriba. Debe actualizar.
- Marcos 16:13 (copiado a mano): **2,6 MB bajados de los relés en el primer minuto tras abrir, 528 de 546 eventos repetidos** (97 %;
  primal 1 MB, nos.lol 806 KB, nostr.mom 800 KB, casi todo repetido). La escucha nativa ya había entregado 49 sobres; la app pide a
  cada relé desde «lo último visto − 10 min» → vuelve a bajar todo eso por cada relé. La escucha nativa ya trabaja SIN margen (su
  `since` = lo último visto). **3210 en curso:** margen según el desfase de reloj medido en lo que llega en vivo (mín. 2 min, máx. 10).
  Además: «Confirmación sin firma válida de nx1n36c283 … ignorada» ×6 al abrir (✓✓ de la parte nativa del dueño con la app cerrada
  que no traen la firma esperada) → el emisor reenvía hasta que el dueño abre: pedir el diagnóstico del dueño del mismo momento.
- HONOR 16:06 (zombi con Marcos): otra vez cerrado a las 15:29 por el gestor de batería de HONOR (PowerGenie) → falta el ajuste del
  teléfono. «Confirmación sin firma válida de nx0x4029e6» ×7: Zhelowsky va en la 3026 (vieja). **3211 a hacer:** un texto a Marcos pasó
  a ✗ un segundo (16:05:07) y a ✓✓ en el siguiente: la red de seguridad ya lo había dejado en el buzón (16:05:06) y el agotamiento de
  reintentos Bluetooth (_onAckTimeout) lo marcó «failed» igual → si ya salió por internet, ✓ y no ✗.
- **Audio de la S23 (nx1e50c95d) que «se clavó en 15 %» (dueño 17-11 20:44, diagnóstico del S24 3091):** es msg…874999fg4ok
  (sufijo de 5 = mensaje con archivo), enviado ~20:27:55 con la app del dueño en segundo plano. NetBg lo recibió a las 20:41:51 y
  otra vez 20:42:02 y 20:42:15 («ya estaba… reenvío»), y confirmó ✓✓ las tres. Al volver la app (20:42:30) entraron los otros 4
  mensajes de la S23, pero de fg4ok NO hay «Puntero… bajo del buzón» ni «Mensaje recibido»: se perdió en el paso de segundo plano a
  la app. Hipótesis: fue por trozos directos por internet (no por el buzón de archivos) porque la S23 lo veía «en línea»; NetBg solo
  guarda/avisa del primer trozo y la S23 se rindió → burbuja al 15 % y ✓✓ en la S23 aunque no llegó. Ojo: _drainBg traga errores
  de _onEvent sin registro. Falta el diagnóstico de la S23 para confirmarlo.
- **3221 llamadas de grupo por internet (EN PAUSA por el uso, sin código):** plan del ayudante: `_sendTo` de group_call.js hoy
  descarta los tramos por internet; `CallP2P` (call_p2p.js) ya admite varios contactos → canal directo por tramo con señal 'rtc' de
  grupo; relés solo de último recurso, midiendo el retraso y con aviso «Llega con retraso» (no puente); cortes más tolerantes por
  internet; vídeo solo de cerca o por canal directo; `mergeCheck` que permita grupo + 1-a-1 por internet; prueba `gcallnet.js` (como
  callp2p.js/cambiored.js: tres por internet, uno cerca + otro por internet, caída de internet a mitad).
- **GRAVE (hallazgo del ayudante de 3217, comprobado):** desde el 10-09 `src/styles/critical.css` («FIX #2: Ocultar REM / toasts /
  logs / debug») esconde con `display:none !important` todo lo que tenga «toast», «log», «debug» o «rem-» en el id o la clase. El aviso
  general `_showInfoToast` (ui_bits.js: `#perm-error-toast.info-toast`) cae ahí: TODOS los avisos cortos de la app («Copiado ✓»,
  errores, «Invitación copiada»…) llevan semanas sin verse. Además `[class*="log"]` atrapa cualquier clase con «log» (dialog, login…).
  Propuesta al dueño: acotar la regla a lo de depuración y dejar ver los avisos de usuario (con prueba que mire que se VEN).
- **Diagnóstico manual del dueño (S24, 3091) 17-11 19:56:** nada grave; todo a la S23 entregado y leído. (1) Dos mensajes
  grandes a richard (nx1l87f8a0, msg…966udk35f9wl y msg…989t1hnnnyml, de las 15:38) siguen en un ChatStream que espera «con el
  enlace caído» cada 30 s sin fin (ya en el diagnóstico de las 17:07): se arranca con «Resume» aunque el mismo segundo dice «sin
  enlace ni ruta». Mejor: si no hay enlace en ~2 min, devolverlos a pendientes y no tener el bucle vivo (chat_stream.js). (2) 19:51:51
  los 4 relés cayeron a la vez y volvieron en 7,7 s (datos móviles): bien. (3) 68 % de lo bajado de relés repetido (19,6 MB en 220 min):
  lo corrige 3212, va en la APK 3093. (4) La línea de tiempo del diagnóstico incluye un respaldo Fénix («dad_932a → ?» pendiente desde
  18:04): no es un mensaje del usuario, sacarlo (diag_state.js, como ya se sacan kx_/ack_).
- **Estilo único de botones (dueño 17-11, 19:40):** «revisa que todos tengan el mismo estilo; la ruedita no es igual al botón de
  perfil ni a los de enviar». Además de la misma respuesta al dedo (3181), mismo aspecto: forma, tamaño, iconos SVG de línea del
  mismo grosor/color. Plan: inventario (lo trae el ayudante de 3218) → estilo base (propuesto: los botones redondos de la pantalla
  de llamada) → aplicarlo a toda la app → prueba que lo vigile (como pressall.js). **Aprobado por el dueño (17-11, 19:45)**: tres niveles con la
  misma forma redonda e iconos SVG de línea (blanco, grosor 2): PRINCIPAL = círculo 52 px con el degradado del botón de enviar
  (#00c8ff→#a855f7), solo la acción principal de cada pantalla; SECUNDARIO = círculo 44 px discreto (rgba blanco .08 + borde .14);
  CUIDADO = círculo 52 px rojo #ef4444 (colgar, eliminar). Muestra: `docs/estilo_botones_muestra.html`. Las clases las deja listas
  3218 (cabecera); la pasada por toda la app va después de 3217/3218.
- **Diagnósticos pegados 17-11 18:15 (México)** (Roberto 14:49, Marcos 16:13 y 17:25, dueño 17:14 y 17:25, HONOR 17:05):
  · Marcos 16:13 (ya en la 3090): «Confirmación sin firma válida de nx1n36c283» ×6 a las 16:13:41.675, ANTES de cargar su NEXO ID
    (41.710) → **arreglado en 3215** (ackarranque.js). Era la causa de las «sin firma válida» (no claves viejas).
  · Marcos 17:25 / dueño 17:25 (zombi): Marcos con 11 % de batería y la app en segundo plano; el dueño lo tenía por Wi-Fi local y
    todo entregado/leído: sin efecto para el usuario. Al arrancar Marcos, 4 avisos «MTU 23» que a 1 s eran 517 → 3214 los calla.
  · Roberto 14:49: el mismo ya anotado arriba (apagó/encendió el Bluetooth). Sus «MTU 23» a los 12–16 s de 517 eran enlaces que
    sí estaban muertos (el envío fallaba): 3214 (4 s) no los calla y está bien.
  · Dueño 17:14 «enlace_abre_cierra» con el HONOR: el HONOR cambia de dirección Bluetooth (50:F3…, 70:CA…, 79:43…) y cada una abre
    un enlace repetido que se cierra; sin efecto visible. Pendiente menor: no contar como «abre y cierra» los repetidos cerrados por
    el desempate normal.
  · Hallazgo menor (dueño 17:23): un respaldo Fénix de 90 KB al HONOR iba 4 de 7 trozos por internet; al volver la app pasó al
    Bluetooth y EMPEZÓ DE CERO (165 trozos) y se rindió a las 2 ventanas. Mejor: seguir por el camino que avanzaba.
  · **Para el dueño (seguridad, no se toca sin él):** una confirmación con «from» que no es un contacto (p. ej. «unknown») se
    acepta sin firma (compatibilidad de la auditoría C1). Con 3215 las nuestras ya no salen así; cerrarlo del todo es decisión suya.
- Dueño S24 (3091) 16:59: 298,8 MB de NEXO hoy; en 43 min desde abrir, 7,8 MB de relés con 1883 de 2028 eventos repetidos (93 %);
  7 vueltas a la app de 16:16 a 16:58 (cada una vuelve a pedir 10 min a cada relé, 25 contactos) → 3212. Zhelowsky (3086, la 3090 ya
  descargada sin instalar; Motorola sin segundo plano): su ✓✓ del pedido de diagnóstico (msg…r2052km1s) llegaba «sin firma válida» y el
  S24 lo reenvió 25 min. **Investigar «confirmación sin firma válida»** (Zhelowsky→HONOR/S24, dueño→Marcos): ackTag (BT) y ackMac (NetBg)
  firman igual; sospecha: clave de pareja vieja en uno de los dos (e2eAckKey(c.publicKey) con la llave antigua del otro). Mirar cuando
  Zhelowsky actualice. Revisado 17-11 18:05 (México): descartado que sea la forma de escribir los NEXO ID (la parte nativa y la app
  usan minúsculas y los mismos campos «ack|msgId|yo|contacto») y descartado que la parte nativa guarde claves viejas (setAckKeys
  reemplaza todo el mapa y lo guarda cifrado igual). Queda solo que los dos teléfonos tengan distinta clave pública del otro (uno
  reinstaló o cambió de llave): eso se ve en el diagnóstico de los DOS lados del mismo momento.
- NX…DBFE (3087, Galaxy A05s, Italia): versión vieja; 217 MB de Wi-Fi hoy (archivos por el buzón: 18 enviados, 22 recibidos) y 2
  cierres por falta de memoria; Bluetooth con richard atascado («Write fallo ~6 s») mientras el Wi-Fi local llevaba los mensajes.

## 🆕 17-11 14:35 — diagnósticos automáticos de la tarde (Roberto 3090, Marcos 3043, nx126df3f4 3073)
- Roberto (3090): el video de estado YA sale (webm 1,7 MB, vista previa bien, subido una vez al buzón de archivos en 43 trozos). El
  «zombi» con Austin (HONOR 3087) fue el vigilante normal: 4 pings sin respuesta al volver a la app → desconecta y reconecta.
- **Investigar (datos en Wi-Fi):** Roberto bajó 8,1 MB de los relés en 9 min al abrir (nos.lol 7,4 MB; 816 eventos, 583 repetidos
  de 1,2 MB → ~233 nuevos de ~30 KB cada uno); nx126df3f4 (3073) gastó 28,7 MB en un día con 18 textos. Sospecha: copias de Fénix
  (medios de contactos: «Guardo el medio … 55 KB») y medios de estados. Medir en el simulador cuánto baja un teléfono al abrir con
  varios contactos activos y de qué tipo es cada evento; con datos móviles ya se limita (3193/3204).
- Marcos (3043): la descarga de la 3090 se cortó por 3 s sin Wi-Fi → 3208 (reintento solo). Hay que actualizar: Zhelowsky (3026),
  Marcos (3043), nubia NX10B6F4AC (3086; además se cerró a la fuerza desde recientes y tiene la batería optimizada).

## 🆕 17-11 06:28 — dueño «Ok» a 2 conexiones y 2 copias con datos móviles
- Diagnóstico S24 06:01 (entrega lenta de una nota de voz al S23 3080, 128 s): del lado del S23 (versión vieja); la subida fue a 6,8 KB/s
  porque cada trozo va a 3 relés, y 1,5 MB de 2,5 MB bajados eran repetidos. Aprobado: con datos móviles escuchar 2 relés (seguir
  publicando a todos) y 2 copias por trozo → **3193 INTEGRADO** (solo JS). Falta en el nativo (NetBg con la app en segundo plano):
  ver él mismo si hay datos móviles, conectar y suscribir solo los 2 primeros sanos en el orden de `relays`, ✓✓ en esos 2, y al volver
  al Wi-Fi suscribir los demás con un `since` por relé. Riesgo aceptado: un mensaje que solo quedó en relés no escuchados llega al
  pasar al Wi-Fi (el que manda ve ✓ sin ✓✓). **Nativo: 3204 INTEGRADO** (APK 3090). **3205 INTEGRADO** (hueco de la 3204: al volver la
  app, la escucha nativa olvidaba desde cuándo soltó cada relé; ahora se lo pasa con netBgDrain y la app se lo pide desde ahí).
- Hallazgo del ayudante de la 3193 (antes de su cambio, sin arreglar): si llega algo del contacto (p. ej. su anuncio de rutas `rt`) en el
  medio segundo entre elegir un archivo y empezar a subirlo, el archivo sale DOS veces (trozos por relés y buzón): `_prePayload` →
  `_kickPeer` → `_resendPendingMessages` → `ackSystem.sendFile`. Arreglo propuesto: que el reenvío de pendientes salte un archivo que ya
  se está subiendo al buzón. → **ARREGLADO en 3197** (pendiente menor: hueco breve en Wi-Fi Direct; el reenvío usa trozos y no el buzón con el
  contacto solo por relés).

## 🆕 17-11 04:55 — #87: NEXO muere con una actualización de WebView (o de NEXO, o un reinicio) y NO vuelve sola
- Diagnósticos de la tableta SM-T220 (3075) y del S24 (3082), dueño 17-11: la tableta con SOLO la pantalla apagada. A las 23:56 Google
  Play actualizó Android System WebView → Android mató a NEXO («stop com.google.android.webview due to installPackageLI»; el S24 vio
  caer el Wi-Fi con ella a las 23:56:35). Nada la revivió hasta que el dueño la abrió a las 04:46 (registro nativo vacío 23:07 → 04:46):
  ~5 h sin recibir. En la tableta también el 15-11 07:41. `START_STICKY` no basta; no hay receptor de reinicio/actualización ni
  alarma de vigilancia; solo un toque FCM la revive, y solo si alguien tiene algo pendiente para ella.
- **3189 + 3192 INTEGRADOS (17-11 07:00)**; prueba del dueño: reiniciar la tableta SIN abrir NEXO (no «forzar detención»: eso la deja parada hasta abrirla) y mandarle un mensaje desde el S24: debe llegar el aviso y el ✓✓, y en el diagnóstico «Internet sin la app: escuchando…» y «[VUELVE]». Antes: **3189 hecho y EN ESPERA** (commit 9dc2113f en el worktree `/home/user/wtvuelta`, sin integrar): NEXO vuelve sola tras
  MY_PACKAGE_REPLACED, BOOT_COMPLETED y una alarma de vigilancia cada ~15 min; anota «[VUELVE] NEXO vuelve sola tras …». Kotlin 183/183;
  compilado contra la API 36 (sin SDK de Android aquí: el CI lo confirma). **Pero el servicio solo NO recibe nada** en un proceso nuevo
  (sin WebView): el servidor GATT y NetBg solo los crea el plugin, y la configuración de NetBg (relés, claves de pareja) y las claves del
  ✓✓ viven en memoria. Lo mismo con el toque FCM de hoy: arranca el servicio, no baja nada y además NO avisa
  (`FcmWakePolicy.noticeAfterWake(true)` = sin aviso). **Dueño 17-11 06:30: «Ok»** → en curso **3192** (worktree `/home/user/wtheadless`, con 3189 encima de HEAD). Era la pregunta (toca cifrado): guardar esa configuración cifrada en
  reposo (AtRestStore, como los contactos y el ratchet) para que el servicio arranque NetBg solo (~100–150 líneas). Mientras: el toque
  FCM con el proceso muerto debería poner el aviso genérico. Prueba del dueño cuando salga: reiniciar la tableta SIN abrir NEXO y mandarle
  un mensaje desde el S24.
- Del mismo diagnóstico: **3187** (wtzombi) el S24 tardó 104 s en dar el zombi porque cada vuelta a la app ponía la cuenta a 0 (y el
  aviso decía «2 pings» con un límite real de 4); **3188** (hecho, 0fd9bb18) el registro nativo anota si un relé vuelve a abrir.

## 🆕 17-11 00:05 — estudio de límites para EDC hecho (`docs/EDC_LIMITES.md`): espera orden del dueño
- Se traba la interfaz antes que la memoria: con 500 NEXO alrededor el lag sube a 2,5 s y con 1000 la app se cuelga; culpa casi toda de
  redibujar «Agregar» con cada aviso del escaneo. Los contactos no tienen prioridad: con 10 contactos dormidos alrededor, otro contacto
  no conecta nunca. Un chat guarda 2000 mensajes y borra lo viejo SIN avisar. Con 5000 contactos, volver a la app congela 38 s.
- 9 cambios recomendados por importancia (1: «Agregar» con freno, horas; 2: gestor de enlaces con prioridad de contactos, 1–2 días; 3:
  índice de pendientes; 4: escaneo en Kotlin…). Propuesta: empezar por 1, 3 y 4 (pequeños) y luego 2.

## 🆕 16-11 22:25 — idea del dueño: fondos según la luz del ambiente (para después de la identidad de Runa)
- **Idea:** fondos de pantalla, burbujas y fondo de llamada según la luminosidad: de noche o con poca luz, negro puro #000 (no deslumbra);
  de día o al aire libre, más claro (como el fondo actual de la pantalla de llamada, que no es #000).
- **Opinión de Claude:** buena (al sol un fondo oscuro se lee peor; de noche el #000 no ciega y en pantallas OLED ahorra batería). Cuidar:
  sensor de luz del teléfono (nativo, TYPE_LIGHT; en web casi no existe) solo con la app a la vista; histéresis y cambio suave para no
  parpadear al pasar de sombra a sol; no cambiar a media lectura; ajuste «Automático / Siempre oscuro / Siempre claro».
- **Orden propuesto:** (1) identidad visual de Runa (logo, colores); (2) tema de día con esa identidad (líneas de luz sobre claro, cian más
  oscuro para contraste); (3) cambio automático por la luz. Espera el sí del dueño.

## 🆕 16-11 21:45 — dueño: noche de pruebas NO por ahora; estudio de límites para EDC SÍ
- **Noche de pruebas con teléfonos reales (Idea de Claude): estacionada.** El dueño solo tiene 3 (S24, vivo, tablet; el S23 no es suyo) y un
  cargador; en la misma habitación y el mismo Wi-Fi aporta poco, y pide no meter código de prueba en una actualización ahora («vamos bien»).
  Con distancia real (Jump, alcance) sí le convencería.
- **Estudio de límites para EDC (idea del dueño, en simulación, sin tocar la app):** escaneo con cientos de NEXO cerca (saturar el
  Bluetooth), escaneo por distancia/intensidad de señal con tope, conexiones masivas, número máximo de contactos, tamaño máximo de un chat,
  todos los chats llenos y cuánta memoria ocupa. Medir, encontrar dónde se rompe y proponer límites. Siguiente subagente libre.
- **El vivo siempre arriba en Contactos** (dueño): subagente en curso (3183, worktree wtorden).

## 🆕 16-11 20:40 — visto bueno del dueño («Si»)
- **Aprobado (seguridad):** (1) revisar cada adjunto que llega por su contenido real (tipo verdadero, tamaño), no por lo que dice el
  mensaje; (3) comprobar todo lo que la parte web le pasa al nativo. **Aprobada la regla de espacio:** cuota por contacto; si se llena,
  se borran primero los archivos más viejos ya vistos, nunca los textos. Por hacer (subagentes, cuando se libere la CPU).
- **Nombre:** el que mejor le suena es «Eco», pero sigue buscando. Historia del Bluetooth y nombres que salen de ella:
  `nexo-private/negocio/NOMBRE.md`.

## 🆕 16-11 mañana — decisiones del dueño tras la opinión de Grok
- **Código muerto:** quitar (p. ej. src/auth sin uso).
- **Diagnóstico visible:** SE QUEDA mientras haya probadores («es nuestra única fuente de diagnóstico»); al subir a Google Play se
  esconde pero sigue vivo por detrás.
- **Bienvenida ≤ 40 s (cuanto menos, mejor):** introducción breve + foto + retrato vivo + firma viva + huella. Implementar YA pero
  OCULTO (bandera de desarrollo): ni usuarios nuevos ni actualizaciones deben verlo hasta que el dueño lo active.
- **NO avisos de camino** («por Bluetooth», «esperando que despierte»): para el usuario es magia; solo palomitas. Lo de «conectado/
  en línea por…» queda SOLO mientras probamos y se quita en la app terminada (confunde: un usuario creyó que «conectado» = en línea).
- **Gestos:** deslizar para cancelar una nota de voz; deslizar de izquierda a derecha sobre un mensaje = responder (hoy falla a
  veces) y la cita aparece en la barra de escribir como en «Responder» del menú.
- **Invitar con un motivo fuerte:** pendiente de propuestas.
- **iPhone y relés propios:** esperan a que NEXO dé ingresos (MacBook y servidores son gasto del dueño).

## 🆕 16-11 03:17 — diagnóstico automático S24 3069 «zombi» con Yaelito (3070) + resúmenes viejos
- **3139 hecho (rama, APK 3071):** dos enlaces Bluetooth S24↔Yaelito y cada teléfono cerró uno distinto (el S24 por el MTU que creía ver,
  Yaelito por el desempate común): el S24 mandaba por el muerto (texto largo 8 reintentos sin confirmar, puente que no abre, «zombi»)
  mientras lo de Yaelito entraba por el bueno. Ahora con papeles distintos manda siempre el desempate común (bledup.js 11).
- **Contexto del dueño:** en su coche, S24 solo Bluetooth, S23 con internet, Yaelito quizá solo Bluetooth; quería probar el puente
  Bluetooth→internet. Lo que pasó: 18:43:21 el puente por el S23 SÍ funcionó (internet en 7,1 s); con la app en segundo plano ~7 min se
  cayó el enlace con el S23 (su app dormida: el puente aún necesita la app del que presta despierta, el nativo es la 3073+); al volver, el
  puente por Yaelito no abrió por el fallo de la 3139. Lo de «jump» fueron rutas para los mensajes mientras no había puente.
- Visto también: S24 sin red propia usó de puente al S23 y luego a Yaelito (bien); 15,5 MB bajados de los relés, 12,7 MB repetidos
  (relay.primal.net 9 MB): el arreglo de deslizar (3131) ya va en la 3070; si sigue alto con la 3070, mirar las reconexiones del relé.
- Wi-Fi local lento solo en builds viejas (3055: 8,6 s de media); en la 3069 del S24, 0,5 s: no hay nada que arreglar.

## 🆕 15-11 23:46 — resúmenes diarios del 14-11 (builds viejas 3055 y 3059; regla del dueño: no se arreglan versiones viejas)
- Nada roto: 5 enviados / 4 entregados (3 leídos) en uno; 1 recibido en el otro. Solo para mirar en la última versión: la conexión por
  Wi-Fi local tardó de media 4,9 s (hasta 8,8 s), más que internet (2,6 s) y Bluetooth (0,5 s). Comparar con un resumen de la 3070.

## 🆕 15-11 noche — APK 3070 (3129–3133) en batería
- Hecho en la rama: enlace de invitación (falta la página web en el GitHub del dueño: publicarla es cosa suya), foto de perfil al
  día al borrar y volver a agregar, guardar en la galería con respuesta, deslizar para actualizar sin bajar repetidos, notas de voz
  a 1,5×/2×, y **3133** saludo al contacto nuevo con internet ya abierto (fallo antiguo destapado por blobfan.js; saludonuevo.js).
- Abierto: ¿la invitación se acepta sola si trae un código válido mío? (pregunta al dueño sin respuesta; mientras, a mano, SEC-2).

## 🆕 15-11 noche — hecho en la rama para la APK 3071 (3134–3136, sin publicar)
- **3134** tono «tuuu» de la llamada saliente puesto por el teléfono (Kotlin `ringback`, ToneGenerator por el canal de llamada);
  lo que hace Telecom con la llamada (aviso, contestar y si se abrió NEXO, rechazar, colgar, por dónde suena) al registro nativo del
  diagnóstico; Xiaomi/Redmi/Poco: el aviso pide también «Ventanas emergentes en segundo plano». **Falta:** compilar el nativo (CI) y la
  prueba del dueño: oír el tono al llamar; y un diagnóstico de Jhonnatan tras contestar con manos libres.
- **3135** «¿es el mismo teléfono, reinstalado?»: avisa del impostor, segunda confirmación y chat unido en rojo «sin verificar».
- **3136** solicitud con el nombre de un contacto que ya tengo → aviso rojo en la bandeja; cobro de un contacto sin verificar →
  «antes de pagar, confirma con una llamada» (rojo con señal de riesgo).
- **Fénix revisado (sin cambios):** rehacer una cuenta pide estar CERCA (Bluetooth) de 6 de 10 guardianes y que cada uno confirme
  en pantalla quién es («ayúdale solo si la persona está contigo»), con tope de peticiones por hora: no se puede rehacer una ajena a
  distancia.
- **Queda de este bloque:** texto del mensaje en el aviso con la app cerrada (llave en el Keystore de Android; «Ocultar el texto en
  los avisos» por chat). Es nativo y toca el cifrado: va en su propio bloque, con su prueba.

## 🆕 15-11 noche (dueño) — ANTI-SUPLANTACIÓN y texto en los avisos, para la 3071 (decisiones del dueño)
- **Dueño: «lo de guardar la llave en Android es seguro, sí se puede hacer»** → con la app cerrada, el aviso lleva el texto del mensaje:
  la parte nativa descifra solo para el aviso con la llave guardada en el almacén de llaves de Android (Keystore). Por defecto se ve el
  texto; en cada chat «Ocultar el texto en los avisos» (idea del dueño tras el comentario de Jhonnatan: «que fuera más selectivo»); en la
  pantalla bloqueada, lo que diga Android (versión pública «Mensaje nuevo»). Hoy con la app viva ya sale el texto (notify.js).
- **Dueño: «vi un video de alguien a quien le entraron al WhatsApp y pedían dinero… ese tipo de cosas no quiero que puedan pasar»**.
  Ya protegido: sin número ni código SMS que robar; sin sesiones web; pasar la cuenta pide los dos teléfonos en el mismo Wi-Fi + QR del
  viejo; clave cambiada = mensajes retenidos + aviso rojo «puede ser un impostor». **HUECO encontrado:** el aviso de «¿es el mismo
  teléfono, reinstalado?» (3018, `_offerReinstallMerge`) une un NEXO ID NUEVO con el MISMO NOMBRE al chat del contacto viejo si el
  usuario dice que sí → un impostor con el nombre de tu amigo hereda su chat. Plan: (1) la pregunta advierte del impostor, por defecto
  «No», y pide verificar (llamada o número de seguridad en persona); (2) unido = «sin verificar» en rojo hasta verificarlo; (3) solicitud
  o contacto nuevo con el nombre de uno que ya tienes → aviso «es otro teléfono»; (4) cobro/petición de dinero de un contacto sin
  verificar → aviso «llámale antes de pagar». Revisar también que el respaldo Fénix no permita rehacer una cuenta ajena.

## 🆕 15-11 noche (dueño) — llamadas, para la 3071
- **Tono «tuuu… tuuu…» al llamar (dueño: «no escucho el clásico sonido de que está entrando la llamada»):** hoy es un pitido WebAudio
  de 425 Hz con volumen 0,12 (calls_ui._startTone(false)); con la llamada saliente ya en Telecom/modo llamada no se oye. Plan: tono del
  sistema (ToneGenerator TONE_SUP_RINGTONE por STREAM_VOICE_CALL: suena por auricular, altavoz o Bluetooth) mientras suena del otro lado.
- **Contestar con manos libres Bluetooth (Jhonnatan, Xiaomi, en moto: «no pudo contestar directo, se tuvo que parar»):** la entrante se
  registra en Telecom (CallTelecom.startIncoming) y NexoConnection.onAnswer abre la app con startActivity; en Xiaomi eso pide «Mostrar
  ventanas emergentes mientras se ejecuta en segundo plano» (el asistente de batería solo menciona «Inicio automático»). Además
  CallTelecom/NexoConnection solo escriben en logcat: el diagnóstico no dice si Telecom aceptó la llamada ni si el manos libres la
  contestó. Plan: pasarlo al registro nativo del diagnóstico, aviso de Xiaomi, y pedir el diagnóstico de Jhonnatan tras un intento.

## 🆕 15-11 (diagnósticos S24 3067 08:24 y 08:41) — 3127 y 3128 hechos, en la rama (APK 3069 tras la batería)
- **08:24** → 3127: nota de voz pequeña a la app dormida del S23 reenviada entera cada 8 s (sondeo cada 15 s); texto por el puente
  vivo Y reintentado cada 2 min ~10 h (espera creciente hasta 10 min); cierres «ISOLATED» contados aparte.
- **08:41** → 3128: (1) **datos**: 109,6 MB a las 08:24 → 176,1 MB a las 08:41 (Wi-Fi), +66 MB en 17 min con la videollamada (12,6 min por
  relés: el P2P con el S23 en datos móviles falló) ya colgada. Causa: las partes de llamada caducaban a 7 días y cada reconexión de un
  relé (damus.io «se cae sin parar», suscripción desde lo último visto − 10 min) volvía a bajar hasta 10 min de llamada → caducan a
  2 min + línea «bajado de los relés» en el diagnóstico para MEDIRLO en el próximo. (2) **nota de voz por internet a 2,1 KB/s** (flujo por
  trozos a un contacto en línea) → buzón de archivos (116 KB/s). (3) «entrega_lenta 217 s» falsa por una 2.ª confirmación de la foto.
- **Abierto (no hecho, por ahora):** (a) con la app en segundo plano DURANTE una llamada, la escucha nativa (NetBg) también baja cada
  parte de la llamada («500 repetidos» al volver): el doble de datos; idea: que NetBg no escuche mientras la app tiene una llamada
  activa (nativo; medir antes con la línea nueva). (b) Cada parte llega una vez POR RELÉ abierto (3×): una llamada por relés cuesta
  ~3× lo necesario; idea: partes de llamada a 2 relés. (c) La raíz: el P2P (WebRTC) falla con datos móviles (NAT de la operadora) y la
  llamada cae a los relés; sin servidor TURN propio no hay arreglo completo (decisión del dueño si algún día). (d) Velocidad de Wi-Fi
  Direct del 08:41: 1 envío al puente, 3,3 MB/s de transferencia y 3 s para unirse al grupo (la «media 255 KB/s» incluye esos 3 s):
  falta la prueba del vídeo de ~20 MB del dueño.

## 🆕 15-11 (resúmenes diarios del 14-11: S23 3057, vivo …db61 3052, …ab2f 3052)
- **Wi-Fi Direct lento:** el S23 mandó 1 archivo por Wi-Fi Direct a 53,9 KB/s (y el 15-11 373 KB en 5 s ≈ 75 KB/s). Debería ser de
  MB/s. Sin saber el tamaño no se distingue si es el armado del grupo (~4 s) o el ritmo de envío. Prueba física pedida: un vídeo de
  ~20 MB por Wi-Fi Direct y mirar «Velocidad de hoy por camino». Si sale lento con un archivo grande, investigar el ritmo (ventana,
  trozo) por ese camino.
- **Teléfonos en la 3052 (…db61 y …ab2f):** Wi-Fi local listo en ~11 s de media (hasta 81 s), internet hasta 22 s; el S23 en la 3057:
  0,3 s. Que actualicen (regla 14-11: no se arregla nada para versiones viejas).
- Internet: el S23 manda a 34,7 KB/s por relés; el vivo RECIBE archivos por internet a 872 KB/s de media (buzón de archivos).

## 🆕 15-11 tarde (plan del dueño: «primero reestructura, luego la implementación»)
- **Revisión semanal (fin de semana, dueño 15-11):** ningún archivo > 1.000 líneas (`tests/sim/tamano.js` + `tamano.json`; cada
  partición con `tools/partir_check.cjs`). Hecho: ble_ack.js (3108). Siguen: ble_messages.js, vault_manager.js, net_link.js,
  ble_interface.js, main.js, NexoBlePlugin.kt (este con compilación de prueba antes de publicar).
- **Idiomas portugués (Brasil) y francés:** tabla de textos partida por idioma; avisos del teléfono (nativo) en el idioma de la app
  (hoy siempre en español); NOVEDADES en 5 idiomas.
- **Enlace de invitación (dueño 15-11, WhatsApp y TikTok):** en «Agregar contacto», «Invitar a NEXO» con accesos a WhatsApp, TikTok y
  «Más» (menú de compartir del teléfono); sin leer la agenda. El enlace lleva NEXO ID + código de comprobación (de un uso / caduca).
  **Aprobado por el dueño (15-11: «tu ajuste me parece bien, hazlo de esa forma»)**; va después de los idiomas. Falta su decisión de la
  página web del enlace (gratis en GitHub, pública, o dominio propio); la parte de la app se hace igual, con la dirección configurable.
- **De la revisión del análisis de Grok (dueño: «agrega esos 5 puntos»):**
  1. Revisar cada adjunto que llega por su contenido real (tipo verdadero, tamaño), no solo por lo que dice el mensaje. **Visto bueno del
     dueño (seguridad).**
  2. Pruebas de Fénix con guardianes que mienten, tardan o mandan trozos dañados (no las hay).
  3. Reglas claras para cada llamada entre la parte web y la de Android (que lo que llega al nativo se compruebe).
  4. Cuotas de espacio por contacto (que nadie llene el teléfono) y qué se borra primero si se llena.
  5. Un archivo grande a una app que no contesta: despertarla primero y mandar cuando responda; enfriar un enlace que falla seguido
     (diagnóstico S23 3057 19:46: vídeo HD a …6482 con 8 reintentos en 64 s).
- **Esperan visto bueno del dueño (seguridad):** el punto 1 de arriba; relleno de los mensajes que pasan por puentes (que no se
  adivine nada por su tamaño); y los tres de antes: comprobar la identidad en la Wi-Fi (nativo), «Rechazar» firmado y confirmaciones
  firmadas.
- **Difusión:** `nexo-private/negocio/DIFUSION.md` (cómo invitar, qué decir y qué no, qué falta antes de una difusión amplia).
- **Batería real de NEXO (captura del dueño, S24, 15-11 01:18, recién puesta la APK 3061):** NEXO 0,2 % de un 3 % del teléfono en el
  día (Claude 1,1 %, Instagram 0,8 %); 21 min de uso (2 a la vista, 19 detrás); 0 activaciones, 0 min de bloqueo de suspensión, CPU
  < 1 min; 11 búsquedas Bluetooth; **62.528 paquetes por Wi-Fi** (gran parte, la descarga de la APK; el resto, a vigilar). Es la línea
  base para la meta «un día entero de batería». Siguientes: (a) la misma pantalla al final del día; (b) el martes salió en naranja
  «Problema detectado en aplicación»: ver qué app fue; (c) **datos que usa NEXO en el diagnóstico** (bytes por Wi-Fi y datos móviles,
  con la cuenta de Android de la propia app; nativo, después de partir NexoBlePlugin.kt).
- **NEXO «se bloqueó más de 10 veces en la última semana» (Samsung, captura del dueño del martes 10-11; la barra naranja) — causa
  CONOCIDA y arreglada (el dueño lo recordó):** fue el bucle del APK de 25 MB (reenvíos que se sumaban hasta cerrar la app; 10-11, 2994;
  `docs/INVESTIGACION_BUCLE_APK_2026-11-11.md`): arreglado en la 2995 (de a uno), 3004 (registro de salientes) y 3005–3007 (seguir donde
  iba, trozos en disco). Evidencia: de miércoles a sábado Samsung ya no marca problemas (barras azules). Sigue pendiente, sin urgencia,
  la «build forense» de entonces: cierres de la app y su motivo en el diagnóstico (`getHistoricalProcessExitReasons`, error guardado al
  caer), para confirmarlo con datos y porque Google Play mide los cierres (por encima de ~1 % baja la visibilidad); va con el nativo,
  tras partir NexoBlePlugin.kt. Ese 10-11: NEXO 8,4 % del día (WhatsApp 17,1 %), 1 h 11 min a la vista y 10 h 48 min detrás, CPU
  33 min, 14 min de bloqueo de suspensión, 364 búsquedas Bluetooth, 2,1 millones de paquetes por Wi-Fi y 41.717 por datos.

## 🆕 15-11 (dos llamadas a la vez, pedido del dueño tras probar la 3057)
- **Hecho (APK 3059):** 3100 invitado de grupo que no contesta → «No contestó» a los 45 s; 3101 llamada 1-a-1 + de grupo a la vez en
  pantalla dividida.
- **Hecho en la rama (APK siguiente, tras la batería):** 3102 segunda llamada 1-a-1 entrante suena abajo (`call2.js`); 3103 (#222)
  máximo dos (botones de llamar del chat y del grupo apagados, el modelo también lo rechaza), la otra pasa sola a «En espera» al
  contestar (micro en silencio, ni voz ni imagen; el otro ve «Te puso en espera»), «En espera/Reanudar» en cada mitad (también la
  de grupo), al colgar la que queda vuelve sola, llamar a un segundo contacto desde su chat, «Mensaje» (frases listas o «Escribir…»)
  en la llamada que suena estando en otra (`callwait.js`).
- **Falta (dos llamadas):** la segunda no pasa por la llamada del sistema (Telecom): con la app cerrada avisa como mensaje y no
  como llamada; «Mensaje» desde la pantalla de bloqueo; cámara: en el teléfono real, dos videollamadas a la vez comparten una sola
  cámara (sin probar).
- **Hecho 3106 (#221):** al «Agregar» a una llamada 1-a-1, el que ya estaba entra solo a la de grupo; y en grupo, dos invitados que
  contestan a destiempo ya se oyen (antes no, venía de siempre). **3105:** novedades de cada versión junto al botón de actualizar
  (`NOVEDADES.md`, formato de Google Play; regla en CLAUDE.md). Falta: el aviso del sistema «Hay una versión nueva» aún no lleva
  las novedades (solo el aviso de dentro de la app y Ajustes).

## 🆕 14-11 noche (llamadas, orden del dueño: «empieza por las llamadas»; y su idea del despertador)
- **Diagnósticos 22:12–22:21 (S24 3054, Xiaomi 3046→3055, Honor 3032→3055; S23 sigue en la 3048):** (1) **3097**: en la videollamada
  por Wi-Fi con el Xiaomi, lo del S23 (solo por Bluetooth) esperó 4,5 min a colgar («la radio es de la llamada»); ahora el
  Bluetooth solo se aparta si la llamada va por Bluetooth (`llamadawifi.js`). (2) **3098**: en 4 videollamadas el S24 nunca vio al
  Honor: su cámara de NEXO bloqueada («NotAllowedError» ×3 → solo voz); ahora el aviso lo dice y se toca para abrir los permisos
  (`camdenied.js`). Al dueño: en el Honor, Ajustes → Apps → NEXO → Permisos → Cámara, y batería sin restricciones (tiene el ahorro
  activo y «segundo plano permitido NO»: la app se cerraba al salir, 16:11 y 16:18). (3) **Pregunta al dueño:** una llamada de
  GRUPO quedó abierta 4 min en el S24 (16:15:38–16:19:43, «gcsc…» a nx16386482 y nx0ed4a8be) tras colgar con el Xiaomi: ¿agregó a
  alguien? Si nadie contesta, ¿debió cerrarse sola antes? (4) Menor: tras un corte del Wi-Fi local el registro dice «sigue por
  Bluetooth» aunque con el Honor no haya Bluetooth (va por internet). (5) Xiaomi 3046: «Confirmación sin firma válida de
  nx1e50c95d» ×6 al arrancar (el S23 en la 3048): versiones viejas, a revisar si sigue con las dos al día.
- **Diagnósticos 13:03–13:05 (vivo 3052 con el Wi-Fi recién encendido; S24 3052 en segundo plano):** la app SÍ se enteró de los
  cambios (Wi-Fi local con el S24 a las 13:03:34, internet a las 13:03:58, Bluetooth apagado 13:03:45 y encendido 13:04:31 al
  momento). Lo lento: el Wi-Fi local esperó 80,7 s porque la «comprobación» de identidad la contesta la APP del S24, que dormía
  (al abrirla, 8,3 s). **Decisión del dueño (seguridad):** que esa comprobación la conteste el nativo con la app dormida.
- **Arreglado en la 3096 (falta la prueba física 63): reenvíos inútiles de textos LARGOS por internet a una app dormida.** El vivo
  mandó 3 textos de ~20 KB (en trozos) al S24 dormido; el NetBg del S24 confirmaba ✓✓, pero el vivo seguía reenviando la ventana cada
  ~4–5 s (8 reintentos, ~50 s) esperando la confirmación de cada trozo, que solo da la app; al abrirla, 109 sobres acumulados, y tras 8
  reintentos el texto volvía a ⏳. 3096: con el ✓✓ del nativo, el texto espera sin reenviar ni gastar reintentos (15, 30, 60 s; tope
  10 min, luego lo de siempre); si la app del otro confirma algún trozo, está despierta y vuelve lo normal para que reciba lo que le
  falte. textonet.js: 3095 = 8 reenvíos en 40 s y no llega en 1 min al despertar; 3096 = 0 reenvíos, sigue ✓✓, llega en 3 s.
- **Diagnósticos automáticos 11:46–11:52 (vivo 3048 recién actualizado a 3052 y S24 3052):** sin la prueba de pantalla apagada
  (esa falta). Entregas al vivo y a la tablet bien (Wi-Fi local, internet y Bluetooth; la conexión lista en 0,3–1,8 s). Detalle
  menor, para la próxima tanda: «enlace_abre_cierra» del S24 con el vivo cuenta como «desconexión» también el enlace repetido que el
  propio S24 cierra (Dedup 6dad a las 11:50:21 y 11:51:39, ya contado como «repetido»), y el nativo lo sigue teniendo abierto
  («Conexión existente recuperada al arrancar: 7F:9A…» 8 s después). **Lo primero, hecho en la 3093** (lo cerrado por la
  deduplicación ya no cuenta como corte). **Lo segundo, analizado (14-11 noche), no se cambia:** el enlace que sigue abierto es uno
  que abrió el OTRO teléfono (el S24 es ahí el «servidor»), y el cierre nativo (`disconnectDevice`) solo cierra los que abrió uno
  mismo. La regla de la 3027 ya reparte el trabajo: ese mismo enlace lo cierra el otro teléfono desde su lado, y ahí sí se cumple;
  solo queda abierto mientras la app del otro duerme, y sin daño (al mandar se elige el mejor enlace). Cerrarlo a la fuerza desde el
  servidor sería peor: el nativo del otro lo toma como caída y reconecta solo (`startAutoReconnect`), y volvería el abrir y cerrar.
  Si hiciera falta, la vía buena es avisar al otro antes de cerrar para que no reconecte (cambio de protocolo, para más adelante).
- **Entrega:** 3084–3089 = **APK 3053** (batería 249/249, Kotlin 155/155, índice 65). Pruebas físicas 52–57 (con el S24, el vivo y
  la tablet; el S23 no está a mano).
- **Pruebas del dueño con la 3052 (14-11):** Wi-Fi local OK; videollamada por Wi-Fi OK; avisos con la app cerrada: **con la pantalla
  apagada no suena ni hay notificación** (con la pantalla encendida llegan puntuales y el audio se oye bien) → abierto en #87, esperan
  los diagnósticos del S24 y del vivo.
- **Hecho en la rama (va en la APK siguiente tras su batería):** videollamada, botones de abajo «muy anchos, el de colgar ni se ve»
  (dueño): 7 botones de 62 px mínimo no cabían en 360–412 de ancho. Ahora cada botón toma su parte del ancho (hasta 76 px), el círculo
  se encoge con él (42 px a 360) y un nombre que no cabe baja de letra (no menos de 8 px; medida fina: «Silenciado» se pasaba 0,3 px).
  `videoframe.js` mide 360/384/412 en español e italiano, también «Silenciado»/«Cámara no»/«Altoparlante»: 3089 no caben y colgar
  queda fuera; ahora caben y colgar se ve entero. En la llamada de voz (4 botones) la letra queda como antes.
- **Hecho 3087:** con la app cerrada, la llamada deja de sonar en cuanto el que llama cuelga (antes hasta 45 s): «colgar» lleva por
  fuera el id de la oferta (ce), como la oferta lleva cl:1; nativo por Bluetooth y por internet (calls2 colgar-cerrada: 0,2 s).
- **Hecho 3088 (idea del dueño: «cada mensaje a un teléfono dormido lleve su despertador hasta que haya confirmación»):** el toque FCM
  ya no se calla al ver al otro alcanzable: mientras haya algo suyo sin ✓✓ hace más de 20 s, sigue con el freno creciente (30 s → 2 m
  → 8 m → 30 m…); al confirmar, para (wakesched k). Un mensaje por Bluetooth listo sin ✓✓ a los ~10 s entra al calendario. Límite: si
  el dormido no tiene internet (el vivo a las 08:10), el toque FCM no le llega: ahí sirve la 3086 (su nativo confirma y avisa).
- **Diagnósticos S24 11:04/11:05 (3050 → 3052) y resumen del vivo:** los 2 textos al vivo se entregaron a las 11:04 al despertar su
  app (como se explicó). Lo demás que se ve ya está arreglado: «Resume: 4 outgoing» de la tablet con «Write fallo ~6 s» (3083, ya en
  la APK 3052; además la 3052 caducó esos 4 registros viejos), y 6 «connectToDevice … Device no en cache» a contactos lejanos al
  volver la app (3084, va en la próxima). La 3052 ya mide: «internet listo en 0,5 s», «Bluetooth listo en 0,6 s».
- **Hecho 3089:** con la app cerrada o dormida, el aviso dice «Videollamada entrante» si lo es (cv:1 por fuera: sobre, cabecera del
  primer trozo —la oferta va troceada— y sobre de internet; calls2 video-aviso).
- **Hecho (entorno de pruebas):** la prueba Kotlin AtRestStoreTest dejaba una carpeta temporal de hasta ~230 MB por prueba y nunca la
  borraba: 631 carpetas llenaron el disco de la sesión (las pruebas fallaban con «No space left on device»). Ahora se borran al acabar.
- **Medido, no se cambia (14-11):** «micrófono en el hilo de la interfaz → cortes». En Chromium real con el hilo atascado 200–400 ms
  cada segundo, el método actual (ScriptProcessor) perdió 0 % de muestras (llegan tarde, enteras) y AudioWorklet 0–0,5 %: el cambio no
  gana nada. Queda como punto leve hasta confirmarlo en Android.
- **Siguiente en llamadas:** con los diagnósticos que se le pidieron al dueño (videollamada por internet y llamada por Bluetooth), el
  vídeo por internet sin imagen y el eco. Y una decisión suya: «Rechazar» con la app cerrada firmado por el nativo (opción 3 de §4.7)
  para que el que llama se entere al momento.

## 🆕 14-11 tarde (dueño: «tenemos que hacer algo con los atascos… si un contacto no está al alcance del Bluetooth ni siquiera
## debería intentarlo… el S24 cambia de Wi-Fi a datos muy rápido, ¿por qué nosotros somos lentos?»)
Orden: (1) Bluetooth solo a quien está cerca · (2) Wi-Fi ↔ datos al instante · (3) atascos: prevenir y avisar.
- **(1) Hecho 3084 (en la rama, va en la APK siguiente a la 3051):** cerca = enlace listo, visto al escanear hace < 2 min o enlace
  caído hace < 1 min. Si no, ningún intento de conexión Bluetooth (repaso de pendientes, reconexión, abrir chat, mandar texto o
  archivo): va por internet/Wi-Fi o espera, y se conecta solo cuando el escaneo lo ve (btcerca.js: 3083 = 2 intentos, 3084 = 0).
- **(2) Hecho 3085 (en la rama, nativo + app):** la app solo escuchaba «entré a un Wi-Fi»; al pasar de Wi-Fi a datos sus conexiones a
  los relés quedaban colgadas de la red vieja (redcambio.js, 3084: lo que le mandaban tardaba 28 s en entrar). Ahora el nativo avisa de
  cada cambio de tipo de la red por defecto (`NetChange.kt` + `watchDefaultNetwork`, Kotlin 151/151 en JVM; el enganche Android se
  compila solo en el servidor) y la app rehace las conexiones por la nueva al momento (0,7 s en el simulador). En el diagnóstico:
  «[NET] Cambio de red: Wi-Fi → datos móviles» y «Relés listos tras el cambio de red en X s» (y en «Velocidad de hoy por camino»).
  Falta medirlo en los teléfonos: el Wi-Fi local y Wi-Fi Direct no se tocaron.
- **(3) Revisado 15-11 (3126):** el caso del vivo 08:09 era la app dormida (arreglado en 3086) y el desatasco del cifrado ya se
  detecta en los dos lados (3069). Hecho: un desatasco que se repite (3 en 30 min con el mismo contacto) manda un diagnóstico
  automático «desatasco_bucle» (`desatascobucle.js`). No se hace el reinicio a ciegas desde el que manda (podría causar el atasco)
  ni avisos para versiones viejas (regla del dueño 14-11). Texto original: avisar y prevenir atascos: si un contacto con enlace sano no confirma lo tuyo pero sí lo demás (el vivo del
  08:09), pedir el desatasco desde el que manda sin esperar al otro y avisar al usuario («el teléfono de X no puede leer tus mensajes:
  que actualice NEXO»), y avisar de contactos con versión vieja (no se sabe su versión: «build ?»).

## 🆕 14-11 (orden de trabajo acordado con el dueño: caminos) — 1, 2 y 3 hechos (3079–3081), 4 PREPARADO, falta su OK
Orden: 1) Bluetooth solo de emergencia (3079) · 2) un archivo que va por Bluetooth pasa al camino rápido al quedar listo (3080) ·
3) velocidad real por camino en el diagnóstico y el resumen diario (3081) · 4) internet rápido para archivos · 5) Wi-Fi Direct (#198)
· 6) puente con la app dormida (opción A).
- **Paso 4, propuesta (mediano-grande: se pregunta antes):** hoy por internet los archivos van por los relés (~8–10 KB/s medido en
  los teléfonos), por el buzón de archivos (trozos en relés) o por Tor directo (lento; apagado en el S24). Propuesta: usar para
  archivos la conexión DIRECTA que ya usan las llamadas (`call_p2p.js`, WebRTC con STUN público, sin servidor propio), con un canal
  fiable y ordenado. Montaje estimado 3–6 s (juntar direcciones ≤ 4 s + pasarlas por los relés 1–2 s + abrir ~1 s); velocidad = la
  del internet más lento de los dos (a medir con el paso 3). Para archivos de más de ~200 KB a un contacto en línea por internet; lo
  pequeño sigue por relés. Si la red no deja la conexión directa en 20 s (algunas redes móviles o de empresa), sigue por los relés
  como hoy, sin perder nada. Privacidad: igual que en las llamadas, el otro ve tu dirección de internet; con «Usar Tor siempre» no
  se usa. El contenido sigue cifrado de extremo a extremo. Pruebas con Chromium real en el simulador (como las llamadas).
  Sin datos reales aún de si la conexión directa abre en sus teléfonos (no hubo llamadas por internet desde la 3043).

 «mensaje que llegue, notificación que llegue, puntual, que no se repita») — 3076–3078 en la APK 3050
- **Hecho:** sin «Mensaje nuevo» por cada toque FCM; sin toques por pendientes ocultos (diagnósticos, estados, fotos de perfil); los
  mensajes de grupo reenviados vuelven a avisar y caen en el grupo (también por internet en segundo plano). Detalle en `ESTADO.md`.
- **Vigilar (FCM):** Google puede bajar de prioridad los toques de ALTA prioridad que no acaban en un aviso visible. El registro
  nativo dice en cada toque «Despierta recibido (data=…, prio=X/Y)»: si pasa a prio 2/1 (normal/alta), hay que revisar cuántos
  toques sin mensaje se mandan (el despertador al abrir un chat de la 3073 es uno).
- **Abierto (menor):** un probador con build anterior a la 3033 puede mandar un oculto sin marca → «Mensaje nuevo» que se quita al
  abrir la app (falta quitarlo en cuanto la app lo procesa en segundo plano: método nativo para olvidar un id concreto).
- **Hecho 3082 (realme 13-11, Bluetooth APAGADO):** en sus diagnósticos 3047 la app ya veía el apagado en < 1 s y dejaba lo
  pendiente en espera (lo de forzar la conexión al abrir el chat se quitó en 3040/3078). Lo que sí fallaba: el aviso nativo de
  apagado/encendido no se escuchaba y, al volver a encender el Bluetooth, la app no buscaba hasta 60 s (btonoff.js: 59,6 s → 3,6 s).

## 🆕 14-11 (diagnósticos S23 18:34, realme 3032, S24 19:10 y 19:15) — 3075 hecho, en la APK 3050
- **Hecho 3075:** los trozos de un audio/archivo del buzón se borraban con el ✓✓ que da el NATIVO del otro al llegar el aviso (antes
  de bajarlo) → «Faltan 5 de 5 trozos». Ahora solo con el «ya lo bajé» (✓✓ con `got`) o el «leído». Si el otro está en una build
  anterior (no manda `got`), los trozos esperan a su «leído» o caducan en 7 días (`blobnative.js`).
- **Hecho 3075:** el repaso de pendientes pedía al Bluetooth conectar a caminos `net:`/`lan:` (14 veces al volver al frente) y dejaba
  un enlace fantasma; con el realme, un «zombi» falso. Tapado en la propia auto-conexión (`netconn.js`).
- **Abierto (parte de la opción A, puente nativo):** el vivo (nx09acdb61) con la app dormida: su nativo contesta los pings (pong
  nativo) pero no confirma lo que el S24 le pasa como puente Bluetooth para otros contactos (ACK timeout ×5, «la app del otro no
  contesta» tras 8 reintentos; queda ⏳, no se pierde). Lo resuelve el puente nativo (que el nativo reenvíe sin despertar la app) o
  un toque FCM al puente cuando no confirma (por estudiar).
- **Hecho 3083 (diagnóstico S24 14-11 08:09):** «Resume: 4 outgoing para nx1e29ab2f» (la tablet, ausente) arrancaba sus textos
  largos por la dirección Bluetooth guardada, sin enlace, en cada vuelta de reenvío a OTRO contacto (el vivo dormido): escrituras a
  ciegas y «Write fallo ~6 s… descartado» en el nativo. Ahora espera a que ese contacto tenga enlace listo (resumeciego.js: 72 → 0).
- **Explicado (diagnóstico S24 14-11 08:09 + el del vivo 08:49, build 3048):** NO era un atasco del cifrado. El NATIVO del vivo
  recibió los dos textos a las 08:10 («RX chunk… JSON extraído len=590», una y otra vez) y contestó los pings (pong nativo), pero su
  APP estaba dormida por el sistema («reposo del sistema: sí», 1186 despertares por mensajes) y sin internet (Wi-Fi apagado, sin
  datos: el toque FCM no podía llegar). Entraron a las 08:49:05, al abrir el dueño la app. **Causa exacta (hecho 3086, Kotlin):** el
  nativo YA hacía de respaldo con la app dormida (aviso + ✓✓ a los 4 s, `backgroundNotify`), pero se lo saltaba ENTERO —✓✓ incluido y
  para siempre— si al irse a segundo plano estaba abierto el chat de ese remitente (regla del dueño 08-11, pensada para un parpadeo).
  La petición de diagnóstico (oculta, otro camino) sí se confirmó a los 4 s: por eso «parecía» atasco de cifrado. Ahora la ✓✓ sale
  siempre y el aviso solo se calla los primeros 15 s (`BgNotifyPolicy`, Kotlin 152/152; chatabierto.js: 3085 nunca ✓✓, 3086 en 4 s).
  El dueño aprobó (14-11) «app dormida = cerrada» y el desatasco desde el que manda, con su regla: nada pensado para versiones viejas. Al despertar el vivo soltó ~100 escrituras en 0,1 s a 3 direcciones (respuestas
  atrasadas): ya anotado arriba como trabajo tirado.
- **realme (nx0v74707a):** sigue en la build 3032, batería 13 %, Bluetooth apagado en su diagnóstico: que se actualice.
- **vivo (nx09acdb61), diagnósticos automáticos 14-11 01:36 UTC:** está en la **3044** (vieja). Su app estuvo congelada de 14:10 a
  19:36 (5,5 h) en segundo plano aunque Android la da por «exenta»: el nativo siguió recibiendo (60 sobres entraron al abrirla). Eso
  explica que no confirmara lo que el S24 le pasaba como puente (19:08–19:15). Al despertar: ~30 «Enlace ? desconectado» de golpe y
  una ráfaga de ~150 escrituras Bluetooth en 160 ms (respuestas a trozos atrasados de horas) a 6 enlaces que la app acababa de dar
  por caídos (inofensivo, pero es trabajo tirado: mirar si al despertar conviene descartar lo atrasado de enlaces ya caídos). Una
  línea «Server notify failed … DeadObjectException» de su servidor Bluetooth: vigilar si se repite (podría ser el servidor GATT
  muerto, como el Motorola, sin pasar por apagar/encender). El otro (20:00 UTC del 13-11, Motorola «sin servicio» ×4) es viejo: ya
  arreglado en la 3048.

## 🆕 13-11 (prueba del dueño: puente a internet con «solo Bluetooth», S24 3047 17:42–17:44) — DUEÑO ELIGIÓ A (+ búsqueda)
- **Decisión del dueño (13-11):** «la opción A está bien: cualquier NEXO, esté dormido o no, tiene que servir de puente. Lo que falta
  es que el vivo fue la única opción: si el vivo u otro no sirve, se tiene que buscar otro, y así sucesivamente hasta encontrar un
  puente válido». Plan: **3072 (JS)** búsqueda en cadena — candidatos = TODO NEXO cercano (contactos con enlace, contactos cerca SIN
  enlace —hoy no se preguntan: `_seekStrangers` excluye contactos y `_neighbors` solo ve enlaces abiertos—, desconocidos y anónimos),
  por señal; quien no contesta en pocos segundos o dice «no» → el siguiente, sin esperar el latido; los de Bluetooth roto
  (no_service) al final; cada paso en el diagnóstico («[GW] Pregunto a … / no contesta → pruebo con …»). **3073+ (nativo)**: el que
  presta con la app dormida contesta y hace de puente desde el nativo (NetBg ya tiene los relés abiertos en segundo plano).
- Hecho real del 17:42: en esos 2 min solo se veían 2 NEXO (vivo y Motorola); el Motorola se intentó 7 veces (Bluetooth sin NEXO).
- Nada se perdió: los 9 textos al S23 escritos sin internet esperaron y salieron al volver el Wi-Fi (17:44:53, ✓✓ 17:44:55).
- El puente no se armó porque ningún vecino podía prestar internet: el vivo (nx09acdb61, enlace BT listo) recibió 3 preguntas
  (17:42:46, 17:43:23, 17:44:23: los envíos de 48 bytes) y no contestó: su app estaba dormida (tampoco contestó la comprobación
  Wi-Fi en 180 s; el vivo congela el JS) y no se le veía internet. El Motorola (nx0g6ef54e, con datos) no muestra el servicio NEXO
  por Bluetooth («sin servicio» 7 veces, el mismo fallo que vio el Honor) → no se le puede hablar por BT.
- Propuesto al dueño: (A) que el NATIVO del que presta (NetBg ya tiene los relés abiertos en segundo plano) haga de puente sin
  despertar la app; (B) dejarlo así (presta solo quien tiene NEXO abierto). Grande: nativo + JS + prueba física.
- Pequeño (para la 3072): con internet caído, `sendChatMessage` forzaba `connectToDevice('net:…')` (el nativo lo ve como
  «netnx…» y no hace nada; 8 veces en 2 min): no forzar conexión Bluetooth para un destino `net:`.
- Motorola: **causa CONFIRMADA y arreglada en 3072** con sus diagnósticos automáticos viejos (3041 11:42, 3044 14:42): «Bluetooth
  apagado/encendido» de 2–4 s (10:22:52, 10:23:45, 13:54:21) → «Advertising auto-iniciado» SIN «GATT_SERVER Iniciado», y desde ahí
  ninguna conexión entrante a su servidor hasta reabrir la app. Antes del corte sí había conexiones entrantes. Queda saber quién
  apaga el Bluetooth del Motorola 2–4 s (¿la pila que se reinicia sola?).
- «Leído» del Honor: SÍ llegó (17:49:57–58, los 4 en azul). Austin abrió el chat desde el aviso a las 17:48:56 y pasó a otro chat a
  las 17:49:07; los dos primeros se marcaron leídos recién al volver a abrir el chat (~17:49:57). Por revisar en el simulador:
  ¿abrir el chat desde la notificación manda el «leído» de lo que ya estaba? (posible fallo; sin confirmar).
- 3070 funciona en la calle: el Honor (3047) registra «Relé relay.damus.io: cerrada (intento nº 5: el siguiente en 160 s)».
- 2.º diagnóstico (17:49): **el puente SÍ funcionó** con el Honor (nx1905c1ee, «Austin»): 17:49:38 «[GW] Conectado a internet por
  el puente nx1905c1ee» (2 min después de quitar el Wi-Fi: el Honor tenía el Bluetooth ocupado con sus mensajes grandes de 114 KB).
- «Leído» que no llega del Honor: sus 4 textos por BT quedaron ✓✓ entregados (17:48:53–17:49:31), ningún acuse de lectura en el
  registro nativo (los de 118 bytes son los «entregado»). O no abrió el chat, o tiene apagadas las confirmaciones de lectura, o el
  acuse se perdió (es de un solo intento si el enlace parecía listo). Pedido el diagnóstico del Honor.
- Detalle: el 1.er texto al Honor se vio ✗ 1 s (17:48:51, ACK agotado mientras el enlace BT se rehacía 17:48:45–50) y salió al
  reconectar: mientras el contacto se está reconectando, mejor «pendiente» que ✗.

## 🆕 13-11 (relé en segundo plano del Motorola, 3070) — en prueba
- Hecho: el nativo ya no reabre cada 10 s un relé que se corta enseguida (la espera crece hasta 5 min; `NetBgBackoffTest`).
- Por mirar en el próximo diagnóstico del Motorola: su enlace Wi-Fi con el vivo se rehace cada pocos minutos (sin pérdidas vistas).

## 🆕 13-11 (desatasco automático, 3069) — en prueba
- Hecho (ver ESTADO): detectar en los dos lados y al arrancar, pedir/reenviar lo ilegible, Wi-Fi comprobado al momento, sin avisos dobles.
- Falta: la causa raíz del estado atrasado (con la 3047 cada arranque deja el número de guardado en el diagnóstico); un atrasado SIN
  el paquete de claves del otro no abre sesión él (la abre el otro).
- 3071 (en prueba): los mensajes de GRUPO ya entran en el reenvío (copia guardada hasta leído o 6 h); queda fuera solo un sobre
  grande (foto dentro del sobre, sin relés).

## 🆕 13-11 (cifrado que vuelve atrás, 3067) — en prueba
- Diagnóstico S24 12:35/12:40: tras reiniciarse el Nubia en una videollamada, 8 min de «Comprobación … ilegible: Mensaje ya recibido»
  y nada llegaba. 3067 detecta el desfase y abre sesión nueva sola (pruebas físicas §0.35). **Falta la causa raíz**: por qué el estado de
  cifrado del Nubia volvió atrás (los guardados se esperan antes de mandar y el reemplazo es atómico). Pedido el diagnóstico del Nubia
  (SESIÓN ANTERIOR); hipótesis a revisar: el WebView rehecho tras morir (`onRenderProcessGone` → `recreate()`) deja vivo el plugin
  anterior con su cola de guardados (un guardado viejo puede pisar uno nuevo), o algo restaura `nexo_ratchet.json` desde una copia.
  Importa también por seguridad: reutilizar números de mensaje es reutilizar claves.

## 🆕 13-11 (Honor: mensajes grandes que no terminan de salir al S24) — abierto
- Diagnósticos automáticos del Honor 13:29 (3041) y 14:43 (3043): lleva >2 h reanudando 3 mensajes grandes al S24 (766, 206 y 158
  trozos; uno es su diagnóstico de 22 KB que el S24 SÍ recibió a las 12:26:43) por un Bluetooth a MTU 23, y además ve al S24 «internet
  fuera» (el S24 tenía 4 relés abiertos). Descartado: que el S24 no confirme una repetición tras reiniciarse (en flujos por trozos un DUP
  se confirma, `ble_ack._dispatchChunkedMessageComplete`). Por mirar con los dos diagnósticos a la vez: por qué el Honor no vio la
  confirmación de 12:26 y por qué ve al S24 sin internet; y si lo grande debería esperar a Wi-Fi/internet en vez de un BT a MTU 23.

## 🆕 13-11 (foto de perfil «mezclada» y estados, 3060–3062) — en prueba
- **Hecho:** Perfil espera a tener cargadas las fotos de los contactos (al abrir la app aceptaba la del dueño: Motorola 08:33:20);
  gana el aviso de foto más reciente; copias de fotos que fueron del dueño escondidas; estados/me gusta que llegan al abrir la app
  ya no borran ni se pierden. Pruebas físicas §0.27–0.29.
- **Falta confirmar:** por qué el S24 siguió con la foto en Roberto tras quitarla a las 08:33:43 → diagnóstico del S24 y del
  Motorola con la 3042 (línea de foto por contacto).
- **Idea si vuelve a pasar:** comparar fotos aunque estén recortadas o con borde (la huella 8×8 actual no las reconoce). Delicado:
  no debe confundir fotos distintas que se parecen.

## 🆕 13-11 (diagnóstico del dueño 07:28, 3058) — en prueba
- **Hecho 3058:** en llamada, lo de fondo por Bluetooth espera a colgar; a un contacto dormido primero una prueba; el puente
  Jump espera tras fallar; la cámara de una videollamada que sigue por Bluetooth va en imágenes cada 4 s (`radiollamada.js`).
- **Sin comprobar:** que el atasco fuera de la radio compartida del teléfono (el simulador tiene una cola por enlace y no lo
  reproduce; el registro del S24 del momento exacto de la llamada fallida venía cortado). Lo dice la prueba física §0.24.
- **Tablet …ab2f (Galaxy Tab A7 Lite):** conectada por Bluetooth pero con la app dormida y build desconocida; que el dueño la
  abra/actualice o le permita segundo plano.
- **Empezar una videollamada solo con Bluetooth:** sigue sin poder (solo voz); con 3058 solo la que ya iba sigue con imágenes.

## 🆕 13-11 (compartir pantalla parte 3, 3054) — falta
- **Hecho 3055 (dueño: «sí, manda las diapositivas también por relés»):** por internet por relés la pantalla va en diapositivas.
  **Hecho 3056 (dueño: «sí, la cámara también en baja calidad por relés»):** la cámara por relés en imágenes pequeñas (240 px cada 2 s).
- **Llamada de GRUPO por Bluetooth:** la pantalla compartida solo va por Wi-Fi (como el vídeo de grupo); diapositivas por los
  tramos Bluetooth, después.
- **Llamada de voz (sin vídeo):** no tiene botón «Pantalla»; compartir pantalla en una llamada de voz por Bluetooth, después.

## 🆕 13-11 (puente parte 4 y medición de caminos, 3050–3051)
- **Probar en teléfonos** el puente con Wi-Fi Direct (que presta conectado a su Wi-Fi a la vez) y los cambios de camino:
  `docs/PRUEBAS_FISICAS.md` §0.16–0.19. Informe del simulador: `docs/MEDICION_CAMINOS.md`.
- **Aviso nativo de «hay red» para datos móviles:** hoy solo hay `lanWatchWifi` (Wi-Fi); con datos móviles la vuelta del
  internet propio se nota por el reintento (≤ 15 s desde la 3051). Un `registerDefaultNetworkCallback` → evento a la app lo
  bajaría a ~1 s. Nativo (Kotlin): sin SDK de Android aquí para compilarlo antes; hacerlo con cuidado y vigilar la APK.
- **Hecho 3052:** soltar el puente al volver el internet propio tardaba ~24 s (latido de 15 s); ahora ~6 s.

## 🆕 13-11 (diagnósticos S24 APK 3032/3033, Honor 3031, vivo 3028) — abiertos tras la 3045
- **Respuesta (diagnóstico S24 3039, 13-11 06:31): «Tor APAGADO en Ajustes»** en el S24 → por internet nunca hubo Tor directo; desde la 3041 por relés va en imágenes pequeñas (3056). Para vídeo de verdad por internet: Tor encendido en los dos.
- **Videollamada por internet sin imagen** (S24 22:51, 199 s, «vídeo enviado 0»): por internet el vídeo solo sale con Tor
  DIRECTO (01-11, P1) y en esos 199 s no lo hubo. Desde la 3044 el diagnóstico dice «internet (relés: el vídeo no sale; Tor
  listo/sin arrancar…)». Con el próximo diagnóstico: ¿arranca Tor en sus teléfonos? Si no arranca nunca, decidir con el dueño
  vídeo de baja calidad por relés (parte 3 de «compartir pantalla»: calidad según camino).
- **Escucha nativa repetida durante una llamada en segundo plano** (S24 22:53: «500 sobres» que ya tenía): con la app viva por la
  llamada, la parte nativa (NetBg, `handleOnPause`) también abre los relés y guarda cada paquete de voz → doble descarga y
  escrituras en disco (la app los descarta al volver: `seen`; desde la 3045 el registro lo dice). Plan: no arrancar NetBg con
  `BleService.inCall`; al colgar en segundo plano, la app reconfigura `since` (`_bgConfig`) y entonces arranca NetBg (si no,
  bajaría otra vez toda la llamada). Sin prueba posible en el simulador (no modela NetBg): hacerlo con prueba física.
- **Vivo y Honor congelan NEXO en segundo plano** (Vivo «oído hace 1105 s» con el Wi-Fi local vivo; Honor «segundo plano permitido
  NO»): ajustes del dueño en cada teléfono (`docs/PRUEBAS_FISICAS.md` §0.5 y §0.9).

## 🆕 12-11 (diagnósticos S24, S23, Redmi y HONOR con la 3014) — en curso
- **Hecho 3015/3016:** nota de voz como archivo; confirmación por Wi-Fi con la app dormida; espera creciente al reenviar; envío por internet no frena la búsqueda Bluetooth (detalle en `ESTADO.md`).
- **Hecho 3017/3018/3019:** dirección vieja al abrir chat, contacto reinstalado (opción A) y segundo enlace por la dirección de anuncio (detalle en `ESTADO.md`).
- **Hecho 3020:** el «tiene internet» de un contacto recién agregado se guarda al momento (si la app se cerraba enseguida, no se leía su buzón al volver); y el plan de diagnósticos del dueño completo (A: ESTADO/línea de tiempo/compactación/síntomas nuevos/límites; B: emparejado; C: `tools/diag_analyze.cjs`; D: recogida cada hora con aviso solo si es nuevo o grave). Detalle en `ESTADO.md` y `docs/CANAL_DIAGNOSTICO.md`.
- **Hecho 3021 (era «abierto, sin reproducir»; reproducido con `jumpdead.js`):** una foto de 57 KB del S23 al S24 salió por el Redmi como puente Bluetooth (22:13:49, justo tras usar la cámara, que desconecta y reconecta todos los enlaces) con internet «no listo para archivos» (relés fallando); 73 s sin una sola confirmación, luego por internet en 2 s. Posibles causas: puente con la app dormida, enlace recién rehecho a medias, o internet descartado por un fallo pasajero de los relés. Hace falta reproducirlo antes de tocar nada.
- **Wi-Fi Direct:** sigue sin probarse (en la prueba del dueño el Wi-Fi estaba apagado).

## 🗂️ Archivos demasiado grandes (dueño 12-11: «no quiero que exageren los archivos… más adelante sí los tendremos que hacer») — PARA MÁS ADELANTE
- Los 5 más grandes (12-11): `NexoBlePlugin.kt` 4574 líneas (260 KB), `ble_ack.js` 2887 (184 KB), `ble_messages.js` 1563 (104 KB),
  `vault_manager.js` 1533 (76 KB), `ble_interface.js` 1045 (56 KB). Cada cambio en ellos arriesga romper otra cosa.
- Plan (cuando el dueño lo pida): dividirlos por partes SIN cambiar lo que hacen (mover, no reescribir), uno por build, con la batería
  completa antes y después. Mientras tanto: no hacerlos crecer sin necesidad; lo nuevo, en archivos aparte (como `diag_state.js`).

## 🔎 «Agregar»: todo NEXO cercano al instante (3012) y foto de perfil equivocada (dueño 11-11) — en prueba del dueño
- **Hecho (3012 y 3014):** detalle en `ESTADO.md` («Build actual»). Prueba: `tests/sim/addlento.js`. Desde la 3014 (dueño 12-11, opción A) NO hay filas sin
  nombre: una línea «Buscando… N teléfonos NEXO cerca» y cada teléfono sale con su nombre al contestar (las pruebas (1) y (3) de abajo cambian: no hay «+» sobre uno sin identificar).
- **Dueño 12-11 (con la 3012):** «parece funcionar mucho mejor el Bluetooth».
- **Falta del dueño (pruebas cortas):** (1) con varios teléfonos con NEXO cerca, abrir «Agregar»: deben salir todos enseguida (primero
  «NEXO cercano · identificando…», luego su nombre); (2) uno de ellos con la app en segundo plano o cerrada **y con la 3012**: también
  sale con su nombre; (3) tocar «+» en una fila «identificando…»: se agrega sola al contestar; (4) cerrar y reabrir «Agregar»: salen al instante.
- **Foto de perfil copiada — ARREGLADO en 3028 (dueño 12-11: «hay otros contactos con mi misma foto de perfil»):** el registro del Motorola mostró
  la causa: «Guardado en galería (7111 bytes)» desde el visor de la foto de un contacto y 9 s después «Foto de perfil propia puesta ahora desde Perfil».
  3028: tu teléfono no muestra la foto de un contacto que es la misma que la tuya (o la de otro contacto que la tenía antes), por huella de la
  imagen; Perfil rechaza la foto de un contacto; el visor de la foto de un contacto no tiene «Guardar». Prueba `avatardup.js`. Falta: prueba del dueño.
- (Antes) **Foto de perfil equivocada:** el registro del teléfono de Marcos dice que la foto la mandó el teléfono de Austin como suya.
  Falta: que el dueño diga si alguien puso esa foto en el Perfil de ese teléfono (o si ese teléfono fue suyo), o el diagnóstico de ese
  teléfono con la 3012 (línea `[AVATAR] Este teléfono tiene foto de perfil propia (…, puesta: …)`). Mientras: Perfil → «Quitar foto» en ese teléfono.
- **Límite conocido:** un teléfono con una versión anterior a la 3012 y la app dormida no puede decir quién es: queda como
  «NEXO cercano · no responde todavía» hasta que despierte (o se actualice).
- **Para decidir más adelante (privacidad):** desde la 3012 el teléfono dice quién es (NEXO ID, nombre del teléfono y clave pública) a
  cualquier NEXO que se conecte y lo pregunte, TAMBIÉN con la app dormida o cerrada (antes solo con la app despierta). Es lo que pide la
  regla «todos salen al instante»; el código rotativo sigue protegiendo de quien solo escucha. Si algún día se quiere un modo
  «no aparecer en Agregar de desconocidos», es un interruptor sobre `setKxCard`.

## 📶 Wi-Fi Direct no funciona en los teléfonos (dueño 11-11: «primero es Wi-Fi Direct y después, si no hay otra forma, Bluetooth») — ABIERTO
- **Hechos:** 3 intentos reales (08, 09, 10-11), 3 fallos: «No se pudo crear el grupo (2)» ×2 y «sin respuesta» ×1. El nativo es el de la 2713
  (cuando funcionó). El 2 es «ocupado» (Android no puede levantar Wi-Fi Direct). **Causa en sus teléfonos sin confirmar.**
- **Hecho (3012, JS):** Wi-Fi apagado → aviso al usuario y sin castigo de 10 min; fallo de montaje → se reprueba a los 2 min (`wdoff.js`).
- **Hecho (3013):** parte nativa aplicada (reintentos, canal nuevo, estado en el diagnóstico). **Siguiente:** pedir al
  dueño una prueba con el Wi-Fi ENCENDIDO en los dos teléfonos (sin red) + diagnóstico de ambos. Luego, bajar el umbral (hoy 150 KB).
- **Dueño (11-11):** «no apago nada» → el Wi-Fi apagado NO explica sus fallos. La causa real solo se verá con la parte nativa
  (estado en el diagnóstico). Es lo PRIMERO del siguiente bloque.
- **Foto de perfil:** el dueño no sabe si alguien puso esa foto en ese teléfono → esperar su diagnóstico con la 3012.
- **Avisos sin mensaje (3012):** falta que el dueño confirme que ya no salen (necesita la 3012 en el teléfono que RECIBE el aviso).

## 🖐️ NEXO Touch — el «feel» de los botones (dueño 09-11: «algo de calidad… que el user diga: wow») — ✅ base en 2968, a afinar con su prueba
Propuesta e investigación: `docs/FEEDBACK_TOQUE_PROPUESTA_2026-11-09.md`. Decisión del dueño: «pon lo que creas mejor y lo tomamos como
base; después de las pruebas lo vamos ajustando» → se implementaron las 5 recomendaciones: tick al presionar en todos los
botones; confirm en 5 momentos de verdad (mensaje enviado, nota de voz grabada, foto tomada, solicitud aceptada, llamada
contestada/colgada) y reject en errores; estilo C (onda Material + «pulso NEXO» cian en los redondos); barra de escribir 44
visibles + área 56; ajuste «Vibración al tocar» en Perfil → Ajustes (como el sistema / siempre / nunca).
- **Hecho (2968):** `src/ui/press.js` (motor único, pointer events delegados, Web Animations sobre `scale`, onda acotada,
  sostén ≥120 ms, cancelación por deslizamiento >12 px/scroll, áreas de toque con `_hitSlop` pura que no pisa vecinos),
  `src/ui/haptics.js` (6 sensaciones → plugin nativo `haptic({kind, mode})`, compuerta 40 ms, suplente `navigator.vibrate`),
  Kotlin `HapticKinds.kt` (mapa puro → `View.performHapticFeedback`; «siempre» → `VibrationEffect.createPredefined`) +
  `haptic`/`hapticCaps` en el plugin, retiro de los ~25 `:active` sueltos (los de tinte pasan a `.is-pressed`), `vibrate(50)`
  de gestos → `long`/`gesture`. Pruebas: `tests/sim/press.js` (34 comprobaciones con la geometría real), JVM `HapticKindsTest`.
- **Falta del dueño:** la prueba de «cómo se siente» en S24 y vivo (`docs/PRUEBAS_FISICAS_PENDIENTES_2026-11-08.md` §A.21):
  fuerza del tick, hundimiento, pulso sí/no, y si algún botón sigue costando acertarle.
- **Siguiente (build 2 del plan):** llevar las áreas de toque a lo que falte (hojas, cámara, juegos), `segment` en los snaps
  de stickers/selectores, y `hapticCaps` en el diagnóstico para ver qué motor tiene cada teléfono.

## 🩺 Diagnóstico AUTOMÁTICO al desarrollador (dueño 09-11: «que el diagnóstico se haga solo y me llegue») — ✅ base en 2974
- **09-11 16:01: llegó el PRIMER diagnóstico automático** (del propio S24 del dueño, síntoma «pendiente_viejo», build 2975): la parte
  local funciona (síntoma → bandeja → copiar). Dio para tres arreglos reales (2976: `netoffline.js`, `fenixstuck.js`). El síntoma en sí era
  un falso positivo de `linkOf` (ya corregido): el escaneo de pendientes viejos solo cuenta contactos EN LÍNEA de verdad.
- ✅ **2974:** la app manda sola el diagnóstico al detectar un síntoma (enlace zombi, reintentos agotados, pendiente > 30 min con
  camino, error de código), cifrado de extremo a extremo al NEXO ID del dueño (`DIAG_DEV_NX`, `src/ui/autodiag.js`) como mensaje
  oculto de protocolo; límites 1 cada 2 h, 3/día, mismo síntoma 1 vez/24 h; interruptor + «últimos envíos» (✓ al confirmarse) en
  Perfil; bandeja «Diagnósticos recibidos» con «Copiar los nuevos» en el teléfono del dueño. Sin servicios externos (repo público).
- ✅ **Decidido (10-11, «el sentido por defecto») y hecho en la 2991:** encendido por defecto en las builds de prueba; para externos / Google Play la compilación fija `window.NEXO_DIAG_DEFAULT='ask'` (apagado + pregunta única «Aceptar / Ahora no»). Falta poner esa marca en el index.html de la compilación de externos. Al publicar en Play: declarar «Crash logs + Diagnostics» en Data safety y en
  la política de privacidad (lo lee el desarrollador).
- Siguiente: (a) aviso/insignia en el icono de Perfil del dueño cuando llega uno; (b) más síntomas (llamada caída, ANR nativo vía
  `ApplicationExitInfo`); (c) comprimir antes de cifrar si el texto crece; (d) que el nativo conteste los pings con «app cerrada»
  (diagnóstico del vivo 13:21: `handleOnDestroy` + «IGNORE») para que el emisor pase directo al buzón y al toque sin esperar al zombi.
- Investigación de pruebas reales (nubes, Mobly, emuladores con Bluetooth virtual, ADB, FCM, fabricantes, privacidad):
  `docs/PRUEBAS_REALES_INVESTIGACION_2026-11-09.md`. Nivel 1 (laboratorio casero con los 3 aparatos) a pedido del dueño.

## ⭐ PENDIENTES IMPORTANTES (conversación del dueño 10-11) — de aquí sale el siguiente trabajo
Problemas acordados: **poco uso, poca comunicación de los usuarios y poco testeo físico**. Soluciones: que el diagnóstico sea
automático de punta a punta y que las actualizaciones sean automáticas. Orden:
1. ✅ **Actualizador automático — HECHO en la 2986, falta la prueba del dueño en el S24** (lo que más le gustó al dueño). La app consulta si hay una versión nueva en los lanzamientos
   `nightly-N` de GitHub, descarga el APK y lo instala (ya tiene el permiso de instalar y el flujo verifica la firma; Android
   rechaza una actualización con otra llave). La primera vez pide un toque; en Android 12 o posterior las siguientes podrían ir
   sin preguntar si NEXO queda como instalador, **a probar en el S24 (Android 16)**. Solo para el APK de probadores: la versión de
   Google Play no puede llevar ese permiso y se actualiza por Play (la prueba cerrada de Play actualiza sola). Aviso: los
   teléfonos que no lo tengan deben actualizarse a mano una última vez.
2. ✅ **Resumen diario por tiempo a la bandeja — HECHO en la 2989; llegan (14-11 22:05: nx1e50c95d en la 3048, día 13: 47 enviados, 45 con ✓✓, 28 leídos, 49 recibidos, 4 de 5 chats; nx126df3f4 en la 3032, día 12: 12 recibidos y nada enviado; los dos con versiones viejas)** (aunque no haya fallos): versión, mensajes enviados y recibidos, cuántos
   llegaron, tiempo mediano, enlaces usados, restricciones de batería. Solo contadores, sin contenido ni identificadores de
   terceros. Responde «¿lo usan entre ellos?» sin preguntar. Hay que avisar bien a quien lo recibe (incluidos los hijos de la
   novia del dueño). **Aclaración:** el diagnóstico automático por síntoma ya existe desde la 2974 y llega a la bandeja; los
   teléfonos con una versión anterior no pueden mandarlo.
3. ✅ **Canal directo a Claude por tiempo — HECHO en la 2993 (falta que el dueño guarde `NEXO_DIAG_PRIV`; ver `docs/CANAL_DIAGNOSTICO.md`).** Hoy el último tramo (bandeja → Claude) es copiar y pegar, y este entorno no alcanza
   los relés (error 403). Diseño: reporte cifrado a una **llave de diagnóstico aparte** (no la identidad del dueño), enviado por
   los relés que la app ya usa; la mitad privada guardada como secreto en el entorno de Claude; permitir los relés en la red del
   entorno; tarea programada que lee, descifra, analiza y deja un informe. **Visto bueno del dueño (10-11):** «lo de las llaves
   está bien, estamos en fase de testeo». Se pedirá la aprobación del entorno en el momento.
4. **Insignia en Perfil** cuando llega un diagnóstico nuevo (cola de pulido A3).
5. **El poco uso es el problema de fondo:** más telemetría lo mide, no lo cura. Hace falta que NEXO tenga una razón de uso
   cotidiano para la gente (ver `CONVERSACION_ESTRATEGIA_2026-11-10.md`).
7. **Marca «Nexo» (dueño 10-11: «sí»):** búsqueda rápida: hay un registro de marca «NEXO» (Nexo Inc., EE. UU., reg. 8226908, abril de 2026, clases 9/36/42 → software) y una app financiera «Nexo» en Google Play. Riesgo real antes de publicar en tienda: decidir si se cambia el nombre público (el NEXO ID interno puede quedar). No es dictamen legal; consultar a un abogado de marcas.
8. **Logo y sonidos (dueño 10-11: «sí»):** desplegar los elegidos (ver sección Logo y sonidos más abajo, #111) tras la 2995.
9. **Seguridad de la auditoría (dueño 10-11: «sí», luz verde):** seguir el orden propuesto (SEC-2 y autenticar control H3/M5/M6 …) tras la 2995.
12. ✅ **(a) y (b) HECHOS en la 3008 (pong nativo; texto troceado a app congelada → ⏳).** **Hallazgos de la primera lectura real del canal (11-11):** (a) **zombi falso con la app del otro dormida:** el ping Bluetooth lo contesta solo el JS (no hay pong nativo), así que un enlace vivo con la app del otro dormida siempre da «zombi»; arreglo: pong nativo en Kotlin, o que el supervisor no dé zombi mientras el latido nativo diga vivo (como la 2978 con Wi-Fi). (b) ✅ **texto sobre un Bluetooth que el nativo ya descartó** — HECHO en la 3002 (`_textOnDeadBle`; `textdead.js`): se rinde y queda ⏳. **Falta:** el texto de grupo a una app dormida SIN Bluetooth marcado muerto (diagnóstico b2987, `gm…_1e29ab2f`) sigue con 8 reintentos y ✗: ver si debe quedar ⏳ cuando el contacto no contesta nada. (c) ✅ el barrido «pendiente viejo» ya no cuenta archivos grandes que esperan Wi-Fi/internet (3001).
13. ✅ **3004 (11-11): causa encontrada y arreglada en JS** (registro de salientes reescrito entero por el puente → muerte sin rastro + bucle; ver `docs/INVESTIGACION_BUCLE_APK_2026-11-11.md` §8). **Falta:** prueba del dueño en el S24 con el APK de 25 MB; build forense (`getHistoricalProcessExitReasons` + manejador de excepciones + `Runtime.maxMemory()`); envío de archivos grandes por internet desde disco (generalizar `BigFile.kt`); por qué el receptor no confirmaba trozos por internet; `openFile`/`saveToGallery` también pasan el archivo entero por el puente. El dueño NO quiere bajar el tope por internet (40 MB). Detalle original: **Bucle de reinicios al enviar un APK de 25 MB (dueño 11-11, reproducido a propósito; diagnósticos 03:42–04:02 UTC, build 3001):** el dueño reenvió el APK a 3 contactos de internet: ⏳ «esperando» (por diseño: 35 MB base64 no caben por Bluetooth y el otro estaba ausente → cita), al «reintentar» la app se cerró varias veces y Android mostró un aviso de «conflicto, ¿desinstalar?» (texto no recuperado; el dueño desinstaló y la app volvió «desde cero» con la presentación, pero conservó identidad `9174 A1CC…`, NEXO ID y 21 contactos). Registro: la app reinicia cada 8–12 s; antes de cada reinicio aparece «XFER Despierto para una transferencia grande por internet» y `sendFile START … bytes(b64)=35376265 to=net:…` cuando el contacto está «en línea por internet». ✅ 3003: tormenta de escaneos (`resumescan.js`) y enfriamiento del adjunto sin datos. **Falta (3004):** (a) freno anti-bucle: si la app arranca ≥3 veces en pocos minutos, no reanudar envíos grandes 5 min; (b) registrar en el diagnóstico el motivo del cierre (`ActivityManager.getHistoricalProcessExitReasons`: memoria/error/ANR) para dejar de deducir; (c) aviso claro «muy grande para internet; se envía cuando estén cerca»; (d) **decisión del dueño** sobre el tope por internet (hoy `NET_MAX_B64_BYTES` = 56 MB b64 ≈ 40 MB, pedido 01-11): A bajarlo a ~12 MB (recomendada), B dejarlo y solo frenar el bucle, C envío nativo de disco a disco sin pasar por la memoria (trabajo grande). **Sin explicar:** por qué el adjunto de 25 MB sale «sin datos» tras reiniciar y por qué NEXO apareció «desde cero» (no se recuperó el texto del aviso de Android). **3005 (11-11):** primera prueba real de la 3004 sin cierre; el envío por relés se paraba porque el receptor deja de confirmar → receptor guarda 30 min + sondeo de 1 trozo/min (`netsilence.js`). **Queda (decisión del dueño):** guardar los trozos en disco en los dos lados para seguir donde iba aunque pase más de 30 min o se reinicie el que envía (como `BigFile.kt` por Wi-Fi); prueba entre los dos teléfonos del dueño con el receptor despierto y dormido para saber si el corte es el receptor dormido o los relés. **3007 (11-11):** hecho el (a) que aprobó el dueño (seguir donde iba aunque se reinicie la app o pase > 30 min; `bigresume.js`). **Queda:** prueba real entre los dos teléfonos del dueño en Wi-Fi distintos (receptor despierto y dormido); la 3009 propuesta: zombi falso con la app dormida (12a), Bluetooth apagado sin insistir (6), texto de grupo a app dormida → ⏳ (12b).
11. **(CAUSA ENCONTRADA por el dueño: reenvió el APK a 10 contactos; arreglado en 2995 con envío de a uno — queda (a): no marcar ✗ un adjunto que falta al reiniciar) App reiniciada durante el envío de un APK de 25 MB a dos contactos de internet (diagnóstico S24 build 2994, 10-11 12:46):** a las 12:45:20 empezó `sendFile` (35 MB en base64, 2212 trozos) a `net:nx13c1b0fe` y a las 12:46:11 otro igual a `nx10b6f4ac`; a las 12:46:35 la app arrancó de nuevo (sesión nueva, sin cierre limpio visible; sospecha: memoria del WebView con dos cargas de 35 MB). Tras el reinicio el segundo archivo «no se pudo leer del teléfono» y `ble_messages.js` (~l.1389) lo marca `failed` (✗) y repite el aviso en cada reenvío. Ideas: (a) no marcar ✗ un adjunto cuyo archivo aún se está escribiendo/falta: dejarlo ⏳ y reintentar con tope; (b) medir memoria al enviar 25 MB a varios contactos a la vez (cola de uno en uno); (c) buscar en `nexo_vault_outgoing_v2` si el adjunto quedó a medio escribir.
10. **Archivo grande a tablet dormida (diagnóstico 10-11 18:22):** `msg1794210332358l0kys` 2077 min pendiente: no cabe por Bluetooth y la tablet no contesta por Wi-Fi («su app no contesta»); ver cita/espera.
6. ✅ **(HECHO en la 2995, `btoff.js`; marcado el 11-11)** **Bluetooth apagado: dejar de insistir y avisar** (diagnóstico del dueño 10-11 17:49, teléfono Nubia, build 2984): con «Bluetooth desactivado» la app repite «Re-búsqueda»/«Auto-scan fallo» y llega a dar un «zombi» de un enlace que no existe por Bluetooth (genera diagnósticos de ruido). Debería saltarse el escaneo y los pings BLE y mostrar «Enciende Bluetooth» una vez. Además ese teléfono tiene las notificaciones denegadas (no verá ni mensajes ni el aviso de actualización) y está en la 2984 (sin actualizador: instalar a mano la 2993+ una vez).
Cola de tareas pequeñas para cuando el dueño no está: `docs/COLA_DE_PULIDO.md`.

## 🧭 Estrategia y negocio — en el repositorio PRIVADO `maurizio-bot/nexo-private` (`negocio/PENDIENTES_NEGOCIO.md`).

## 📬 Entrega OFFLINE sin servidor propio (diseño 08/09-11; dueño: «vamos a estudiarlo bien, no quiero fallas») — Fase A ✅ (2967) · Fase B ✅ (2969/2970) · Fase C ✅ (2971) · Fase D ✅ (2972) · E pendiente
Docs: `docs/DISENO_ENTREGA_OFFLINE_2026-11-08.md` (diseño v2: cita FCM, cifrar-una-vez, blob compartido, fan-out por
referencia, invariantes anti-crash, plan adversarial) y `docs/CONTRATOS_ENTREGA_OFFLINE_FASE_AB.md` (spec con números:
CHUNK 40 KB, ≥3 relés, techos anti-DoS, backoff, GIVE_UP, TTL 7 d, puntero v1, orden cifrar→hash→partir).
- ✅ **Fase A (2967, solo JS):** (1) **«toque» FCM POR PENDIENTES** — antes solo se tocaba al ABRIR el chat (2860), así
  que un archivo/mensaje a un contacto dormido quedaba ⏳ horas sin que nadie lo despertara (diagnóstico del dueño 08-11,
  foto+vídeo a `nx0ed4a8be`). Ahora cada contacto con pendientes y sin enlace entra a un calendario con freno creciente
  **30 s → 2 m → 8 m → 30 m → 2 h → 6 h (techo), jitter ±20 %**, y se rinde a los **20 toques o min(TTL, 7 días)** →
  **PASSIVE explícito** (deja de tocar activo; el ⏳ sigue igual y al abrir su chat se re-dispara como siempre). Cada
  contacto es independiente (uno rendido no frena a otro); si ya es alcanzable sale de la lista sin tocar; sin token/sin
  internet reintenta sin avanzar el freno (no falla ruidoso). Funciones puras en `ble_helpers.js`, tick en el supervisor
  (`_tickWakePending`, cada 30 s), alta desde el flush de pendientes y desde el envío que queda «en espera».
  (2) **Token en los dos sentidos:** la **marca del buzón** de cada mensaje NUEVO lleva también mi token FCM (antes solo
  el saludo, que caduca en el relé a los 10 min → un contacto dormido horas leía mi mensaje pero no mi token); una vez
  por mensaje, nunca por trozo; si con el token el sobre se pasa del tope del relé va sin token antes que no ir.
  Pruebas: `wakesched.js` (calendario a la vista, 20 toques exactos en 8 días simulados, PASSIVE una vez) y `netmark.js`.
  ⚠️ **Falta del dueño:** la prueba con un teléfono apagado/dormido de verdad (`docs/PRUEBAS_FISICAS_PENDIENTES_2026-11-08.md` §A.19).
  **Límite honesto:** el que toca es el teléfono del que ENVÍA, así que su app tiene que estar viva (abierta o en segundo
  plano, donde corre el supervisor); con la app cerrada del todo no hay quien toque (igual que hoy). Si hace falta, el
  siguiente paso es un tick nativo periódico (WorkManager) que revise pendientes y toque — se decide tras tu prueba.
  *No incluido en A (va en B/D):* el toque MUTUO del que recibe hacia el emisor «si falta el grueso» (solo tiene sentido
  con archivos en buzón).
- ✅ **Fase B (2969, solo JS) — BUZÓN DE ARCHIVOS en relés (`src/net/blob_mailbox.js`):** un archivo (foto/vídeo/archivo
  ≤ 5 MB) a un contacto AUSENTE por todos los caminos, teniendo yo internet, ya no queda ⏳ hasta coincidir: se cifra TODO
  una vez (AES-256-GCM, `k` + nonce aleatorios por blob, nunca reusados) → huella SHA-256 del cifrado → se parte el CIFRADO
  en trozos de 40 KB → cada trozo un evento **kind 1064** SIN etiqueta del destinatario (se baja por id: el relé no
  correlaciona), caducidad 7 días, replicado en todos los relés abiertos (objetivo ≥3), una clave por blob → un solo borrado
  (kind 5, best-effort) al confirmar; al contacto le llega un **puntero v1 E2E** chiquito por su buzón normal (TTL 7 días +
  toque FCM de la Fase A). La burbuja pasa a ✓ al guardarse el puntero; ✓✓ cuando el otro bajó, verificó y descifró. El que
  recibe VALIDA el puntero con sus números antes de reservar nada (techos anti-DoS), verifica cada trozo por su id de evento
  y el todo por la huella + GCM (un relé malicioso se detecta y se pide a otro), dedup por id de mensaje, hasta 3 bajadas a
  la vez, reintentos 30 s → 2 m → 8 m → 30 m hasta la caducidad. Decisión en el embudo `sendFile` (sin enlace listo ni ruta
  → buzón de archivos, sin esperar los 8 s si nada se está conectando), en `_sendFileBest` (enlace de internet caído) y en el
  reenvío de pendientes al volver internet; si ningún relé guarda un trozo → ⏳ (nunca ✗). Interruptor `window.NEXO_BLOB_MAILBOX=false`.
  Pruebas: `blobmail.js` (contratos adversariales §8-B: relé malicioso, relé caído, anti-DoS, huella/llave malas, borrado) y
  `blobe2e.js` (dos teléfonos: B apagado, ✓ sin esperar, 8 trozos sin etiqueta, B vuelve y recibe idéntico, ✓✓, kind 5,
  dedup, en línea no usa el buzón de archivos); `net.js` §3 ahora pasa por aquí. Lo implementado tal cual: contratos §10.
  ⚠️ **Falta del dueño:** `docs/PRUEBAS_FISICAS_PENDIENTES_2026-11-08.md` §A.22 (archivo a un teléfono apagado de verdad).
  **2970 (corrección por el diagnóstico del dueño S24 09-11 07:45):** el enganche en `_sendFileBest` actuaba sobre contenido YA
  sellado y sobre cualquier tipo (segmentos de Fénix al reanudar → «atob … not correctly encoded: queda pendiente»): se quitó; el
  buzón se decide solo antes de sellar. Un flujo de archivo por internet solo con el contacto EN LÍNEA (a un ausente no se abre).
  El APK de 25 MB a la tablet (Bluetooth sí, internet no) se re-reanudaba cada ~1,5 s leyendo 35 MB del disco (`hasBetter` con
  `mailboxOk`): ahora «mejor camino» = contacto en línea por internet o Wi-Fi. El reenvío de pendientes decide el camino antes de
  cargar adjuntos del disco. Pendiente de tu re-prueba: §A.23.
  **No incluido en B (C/D/E):** Jump/reenvíos/grupos por referencia, miniatura en el puntero, > 5 MB (sigue ⏳ hasta
  coincidir), toque mutuo del receptor, stream directo al coincidir, blob-store de terceros. **Pendiente aparte:** el crash
  del archivo de 35 MB por internet (se parte en memoria aunque vaya por `net:`) — no entró en B; va con la D.
- ✅ **Fase C (2971, solo JS) — CIFRAR UNA VEZ, BLOB COMPARTIDO, REENVÍO/FAN-OUT POR REFERENCIA:** (1) **Grupo:** una foto/
  vídeo/archivo al grupo se cifra y sube UNA sola vez al buzón de archivos y cada miembro recibe dentro del sobre `nexo_grp`
  un puntero chiquito (`stageBlobFor` + `gsA.sendText`); con internet propio el tope del grupo sube de ~1 MB a **5 MB**
  (`_groupBlobCap`, también en el selector de archivos); el receptor valida el sobre (miembro, grupo) antes de bajar, y al
  completar reinyecta el sobre con el adjunto entero; ✓✓ cuando TODOS confirman y recién entonces un solo borrado (kind 5):
  `_blobCleanup` anota por destinatario (`to`), con el remitente del ack o el sufijo del wid. Antes: el archivo entero dentro
  del sobre, una vez por miembro. (2) **Reenvío por referencia:** el puntero vigente se guarda en el propio mensaje
  (`meta.blobPtr`, en el que envía con `vaultSetMessageFields` y en el que recibe al completar); al reenviar, `_stageBlobOnce`
  ve el puntero reutilizable (`pointerReusable`) y NO sube nada: solo manda el puntero —también a un contacto en línea solo por
  internet (`sendFile.check()` con `_netNx(dev)`)—; con Bluetooth/Wi-Fi listos sigue el camino local directo. (3) **Dedup
  local por huella:** el receptor recuerda qué blobs ya tiene (`nexo_blob_seen`: huella → chat/mensaje/llave) y, ante un puntero
  al mismo blob (misma huella y llave), lo copia de su propio vault sin bajar nada (`_blobTryLocal`). (4) Un puente Jump por
  INTERNET no le gana al buzón de archivos para estos archivos (un puente por Bluetooth sí va primero). Interruptor
  `window.NEXO_BLOB_MAILBOX=false` (apaga B y C). Prueba `blobfan.js` (3 teléfonos: grupo con dos apagados → 5 trozos por relé
  —no 10—, dos punteros, ✓ y ✓✓, un kind 5; B reenvía a C: 0 subidas y C no baja nada; A reenvía a C apagado: 0 subidas, C
  vuelve y la tiene, ✓✓; nada legible en los relés). **No incluido (D/E):** > 5 MB (cita), miniatura en el puntero, sender keys.
  ⚠️ **Falta del dueño:** `docs/PRUEBAS_FISICAS_PENDIENTES_2026-11-08.md` §A.24.
- ✅ **Fase D (2972, solo JS) — la «CITA» para archivos > 5 MB a un contacto AUSENTE:** el emisor deja en el buzón del otro un
  aviso chiquito (`{type:'attachment', payload:'cita', cita:{id, bytes, name, mime}}`, una vez por archivo, `nexo_cita_out`;
  también desde el reenvío de pendientes, sin leer el archivo del disco) y el archivo queda ⏳ (nunca ✗) con toque por pendientes
  (Fase A). El receptor valida el aviso (`validateCita`), pone un MARCADOR en el chat bajo el id del archivo (tarjeta «📦 nombre ·
  tamaño · esperando que los dos estén en línea para bajarlo», sin tocar la red por el archivo), contesta «ya estoy» (`nexo_cita`,
  por el buzón → toque FCM al emisor) y entra al toque MUTUO (`_wakeStillPending` también cuenta un archivo que se espera,
  `nexo_cita_in`). El emisor, al recibir el «ya estoy», saluda y reenvía lo pendiente: el archivo va por el flujo directo de
  siempre y en el receptor el marcador se vuelve el archivo (mismo id, una sola burbuja: la tarjeta se reemplaza sola y la cita se
  da por cumplida al llegar el archivo por cualquier camino). Prueba `bigcita.js` (2 teléfonos). **Límite honesto (Fase E):**
  el archivo grande por internet sigue viajando entero por la memoria del WebView (flujo por relés/Tor en base64) — el crash del
  APK de 35 MB es eso; la salida es el canal directo nativo de disco a disco por internet, como `big_file.js` por Wi-Fi/WD/L2CAP.
- ⬜ **Fase E (opcional):** guardadero de terceros, erasure coding, sender keys de grupo.

## 🌐 Selección de idioma (#132, pedido del dueño 30-10) — ✅ COMPLETO (2845)
Idiomas: **español, italiano, inglés** (preparado para añadir más). **Por defecto** el idioma del teléfono (`navigator.language`:
`es`→español, `it`→italiano, `en`→inglés; otro→español) — NO por GPS (encaja con la privacidad). **Cambiable** en Perfil →
Ajustes (🌐 Idioma), guardado por teléfono (no viaja).
- ✅ **Fase 1 (2843):** base `src/ui/i18n.js` (`t(clave)` + `getLang/setLang`, detección por locale, persistencia, evento
  `nexo:lang`, respaldo al español si falta una clave) + selector 🌐 en Ajustes (al cambiar recarga la app) + cabecera de
  Ajustes traducida. Simulador fijado a español (`native_mock.js`) para que las pruebas sigan deterministas. Prueba
  `tests/sim/i18n.js`. Batería 88/88.
- ✅ **Fase 2a (2844):** `i18n.js` a CLAVE-primero + `applyStaticI18n()` para HTML estático; **pantalla principal** traducida
  (index.html: Contactos/Compartir/cámara/placeholders; main.js: subtítulo de conexión; ble_ui.js: «Agregar contactos»).
  Convención fijada: `t('clave','español exacto')`, solo textos que se MUESTRAN (los de lógica NO, romperían en it/en).
- ✅ **Fase 2 (2845): TODA la app traducida.** Zonas hechas: **chat** (burbujas, adjuntar, responder/reenviar/eliminar/
  copiar/editar, banner y números de seguridad E2E, stickers, tres en raya); **llamadas/videollamada** (estados, avisos
  micro/cámara, botones, registro); **multimedia** (cámara, vídeo, tarjeta de archivo, ubicación, cobro, compartir);
  **Perfil y TODA la pantalla de Ajustes** (seguridad/bloqueo, avisos y marcas por fabricante, tono, internet/Tor,
  diagnóstico, Fénix, cambiar de teléfono, rendimiento, grupos, QR); **grupos y Estados**; **avisos/toasts, buscador y
  juego**. `i18n.js`: **533 claves** (es/it/en). Desacoplado «por Wi-Fi/por Bluetooth» en llamadas (se mostraba y se
  comparaba: `_isBtLink()` para la lógica). `diag.js`/`notify.js`/`chat_state.js` son solo lógica; `rem.js` es un HUD
  técnico (se deja). Lo que quede sin clave se ve en español (respaldo de `t()`). **Batería 88/88.**
- ⚠️ **Nota para futuras traducciones (lección de la 2845):** nunca dejar un `var t`/parámetro `t` local en una función que
  llame a `t('clave',...)` — el *hoisting* de `var` tapa la `t()` importada en toda la función → `t is not a function` al
  ejecutar (webpack y la prueba unitaria NO lo ven; la batería sí). Si hay un `t` local, renombrarlo.

## 📞 Llamadas y videollamadas en GRUPO (#128, siguiente por orden del dueño) — CIMIENTO hecho (2839), falta cablear
Malla sin servidor: cada participante mantiene un tramo con cada otro (≤5 por ser N²). **Ya hecho (2839, probado en `gcall.js`):**
`src/ui/group_call.js` — `GroupCall` con señalización `nexo_gcall` (invite/offer/accept/leave/end), roster, clave de grupo
única, id de tramo determinista por par (`gid~<nx menor>-<nx mayor>`), AAD con el emisor (una voz no se hace pasar por otra),
regla «NEXO ID menor manda offer», voz por control `{type:'vf', c:<id tramo>, s, d}` y un `mediaHubFactory` INYECTADO
(agnóstico de medios). **Está sin cablear** (`createGroupCall` no se usa en ningún lado).
- **Falta (por incrementos, cada uno build+batería):**
  1. ✅ **Cableado + pantalla (2846):** hecho — `ble_interface` instancia `gcall`; `ble_messages` enruta `vf`→`gcall.onFrame` (antes que `calls`; onFrame devuelve false si el tramo no es de grupo) y `nexo_gcall`→`gcall.onSignal` (solo E2E); `main.js` igual por textos largos; pantalla `groupcall_ui.js` (participantes, aceptar/rechazar, colgar) + botón «Llamar al grupo» solo en chats de grupo; claves `grp_*` en i18n.js; prueba `gcall.js` ampliada (invariante del enrutado); batería 88/88 (CALLS verde). El detalle original era: instanciar en `ble_interface.js` (`this.gcall = createGroupCall(this, mf)`,
     como `this.calls` en la línea 110); enrutar en `ble_messages.js` los `vf` a `gcall.onFrame` ANTES que a `calls.onFrame`
     (onFrame devuelve false si el tramo no es suyo → cae a calls; los ids de grupo llevan `~`, los 1-a-1 no) y las señales
     `parseGroupCallSignal` a `gcall.onSignal` (solo si e2e, como `parseCallSignal` en las líneas 446-449; y el `main.js:518`);
     botón «Llamar al grupo» en la cabecera del chat de grupo (`groups_ui.js`/`calls_ui.js` `_installButton`); pantalla de
     grupo nueva `groupcall_ui.js` (estilo NEXO de `calls_ui.js`, lista de participantes, nexo:gcall/nexo:gcallRing/nexo:gcallEnded);
     tono de entrada reusando el de `calls_ui.js`. Ampliar `gcall.js`/añadir prueba del cableado (una señal por el enrutado real
     llega a onSignal; iniciar desde la UI emite invites). Textos ya traducibles (claves `grp_call_*` en i18n.js).
  2. ✅ **Medios reales (2847):** hecho — `call_group_media.js` sobre `call_media.js`: UNA captura compartida → difunde a
     todos los tramos; UN decodificador por tramo (instancia `noCapture` nueva de `call_media`, solo reproduce) → el SO
     mezcla las salidas. `noCapture` es un cambio mínimo y guardado en `call_media.js` (el 1-a-1 no la usa → CALLS verde).
     Cableado en `ble_interface.js`; `group_call.js` libera el decodificador del que sale. Prueba `gcallmedia.js` (estructura
     con medios simulados). Batería 89/89. ⚠️ El audio REAL solo corre en el navegador → lo confirma el dueño en los teléfonos.
  3. **Vídeo en grupo (Fase 2):** `v:1` ya viaja en la señalización; falta la rejilla de vídeo y mandar el vídeo por Wi-Fi (como
     la videollamada 1-a-1, que por Bluetooth es solo voz).
  4. ✅ **Internet + reconexión (2848 transporte + 2850 UX, pedido del dueño 31-10):** las llamadas de grupo heredan el
     transporte por internet (`group_call._link` delega en `calls._link`, 2848). Reconexión (2850): un tramo sin voz →
     «Reconectando…» (ámbar); a los 15 s → «Sin señal» (rojo) y la llamada sigue con los demás; sin nadie → corte con 5 s de
     «Volver a llamar» y vuelta al chat del grupo. `group_call.js` (GWEAK_MS, `reconnecting` por tramo, `chatId` en
     start/estado/evento `gcallEnded` con members/video), `groupcall_ui.js` (etiqueta, colores por tramo, pantalla de fin).
     Prueba `gcall.js` (débil→reconnecting, 15 s→perdido, sin nadie→`empty`). Batería 90/90.
  5. ✅ **AGREGAR un contacto a una llamada en curso (2851, pedido del dueño 31-10):** en GRUPO, `GroupCall.addMember(nx)`
     invita al nuevo con roster+clave y la marca `late:1` (incorporación tardía: el que entra ofrece a TODOS; los que ya
     estaban abren su tramo al recibir su oferta). En 1-a-1, el botón «Agregar» convierte la llamada en grupo (cuelga la 1-a-1
     y arranca un grupo con el par + el nuevo; es de voz, el vídeo de grupo es Fase 2). Selector de contactos compartido
     `_pickContact` (`ui_bits.js`, hoja inferior con los contactos del vault menos los que ya están); botón «Agregar» en la
     pantalla de grupo y en la 1-a-1 (icono `addp`). Prueba `gcall.js` (A agrega a F a la llamada A-B en curso → F entra en la
     malla, su voz llega a A y B, no se duplica). Batería 90/90. (No hizo falta tocar `groups.js`: la llamada de grupo lleva
     su propio roster, aparte de la lista del chat de grupo.)
  6. ✅ **Ciclo de vida corregido (2852, informe del dueño 31-10 en los teléfonos):** el dueño reportó «apareció la llamada
     pero sin sonido; colgué en un dispositivo y el otro seguía sonando; colgué en el otro y reapareció la pantalla». Arreglado
     + semántica pedida (llamadas y videollamadas): (a) colgar con otros TODAVÍA sonando los corta (el receptor que sigue
     sonando se cancela cuando el host sale/cuelga → «llamada perdida de grupo»; antes solo se cortaba si el grupo era de 2);
     (b) sin contestar en 30 s → perdida con aviso, los que sí contestaron siguen; (c) la pantalla ya no reaparece (se ignora
     la invitación vieja re-entregada por el buzón, por `ts` > `GINVITE_MAX_AGE` = 60 s, y la re-entrega de la misma llamada no
     manda «leave» falso); (d) sin sonido: la voz se iba por `net:` (relés, retraso de segundos) → **voz solo por enlace
     DIRECTO** (Bluetooth/Wi-Fi), como el diseño (señalización/aviso sí por internet); (e) colgar con ≥1 contestando sigue
     entre los demás hasta quedar 2 y que uno termine. `group_call.js`, `groupcall_ui.js` (aviso `grp_call_missed`), prueba
     `gcall.js`. Batería 90/90.
  7. **Controles de interfaz + VIDEOLLAMADA de grupo (pedido del dueño 31-10, tras confirmar que las llamadas funcionan):**
     - ✅ **Silenciar (2853):** `GroupCall.mute(on)` + `muted` en `state()` + botón en `groupcall_ui`. Prueba `gcall.js`.
     - ✅ **Videollamada de grupo — cámara, girar, rejilla (2855, incremento A):** la pantalla de grupo es la INTERFAZ DE
       VIDEOLLAMADA con la cámara APAGADA por defecto; activar la cámara = pasar a vídeo sin re-llamar. `call_media.js` (opción
       `cameraStart`: cámara perezosa, la 1-a-1 no cambia), `call_group_media.js` (captura compartida de vídeo + `camera`/
       `flip`/`playVideo` + un canvas por tramo), `group_call.js` (malla rutea el vídeo como `{type:'vf',k:'v'}` cifrado, SOLO
       Wi-Fi; `camera`/`flip`; `cameraOn` en `state()`), `groupcall_ui.js` (rejilla reconciliada sin parpadeo + botones Cámara/
       Girar; silenciar y agregar ya estaban). Pruebas `gcallmedia.js` + `gcall.js` ampliadas. La cámara/imagen real la confirma
       el dueño en los teléfonos (el simulador no tiene cámara/WebCodecs).
     - ✅ **Grupos como un contacto (2857, informe del dueño 31-10):** (a) crear grupo precarga nombre «Grupo N» (editable, no
       bloquea); (b) el chat de grupo tiene botones LLAMAR y VIDEOLLAMAR como un contacto (mismos iconos/estilo), no uno solo
       (`groupcall_ui._installGroupButton`→2 botones); (c) el VÍDEO ahora se activa: la videollamada de grupo abre la cámara AL
       ARRANCAR por el camino probado de la 1-a-1 (`cameraStart`; `group_call` crea el hub con `cameraStart`=videollamada); (d)
       audio con el modo de comunicación nativo (`callAudio`) como la 1-a-1 (mejor eco + altavoz/auricular; botón Altavoz, arranca
       en altavoz).
     - ⏳ **Igualar la PANTALLA de llamada/videollamada de grupo a la de la 1-a-1 (próximo, pedido del dueño):** hoy `groupcall_ui.js`
       tiene su propio diseño; el dueño quiere que se vea idéntica a la de contacto (`calls_ui.js`). Re-estilar la pantalla de
       grupo (fondo, botones, rejilla de vídeo) para que coincida.
     - ⏳ **Audio por SENSOR DE PROXIMIDAD AUTO en grupo:** el altavoz/auricular manual (botón) y el modo de comunicación ya están
       (2857, `callAudio`); falta el AUTO por el sensor (auricular al oído, altavoz si no), que no lo tiene ni la 1-a-1 todavía.
     - ⏳ **Eco (la voz propia vuelve, informe del dueño 31-10):** probable causa: cada tramo se reproduce en su propio
       AudioContext que la cancelación de eco de la captura compartida no referencia → el eco del otro lado no se cancela.
       A revisar con las pruebas del dueño (el audio real no se reproduce en el simulador). Posible arreglo: reproducir todos
       los tramos por una salida que la AEC sí referencie, o reforzar la supresión; se verá al tocar el audio de grupo (vídeo).
- Tope `GMAX_AUDIO=5`. No toca `calls.js` (1-a-1 sigue igual). Internet/Jump: la SEÑALIZACIÓN/aviso sí (despierta por FCM); la VOZ no (el retraso no sirve para hablar): solo enlace directo (Bluetooth o misma Wi-Fi).

## Bloque autónomo 28-10 (madrugada→mañana): FCM + archivos por internet + AUDITORÍA SEVERA
El dueño (1 AM): «termina lo del ping a los servidores de Google robusto y probado; luego la parte internet del tamaño
de los archivos y verifícalo (ya no quiero mandar una APK por internet y que ni la vea enviada); luego los pendientes
activos; luego la prueba de tiempo/ciclo/CPU/API y **la auditoría más severa posible** en seguridad/robustez/fluidez,
corrige lo que encuentres, y dame **una puntuación** y **la comparativa con la competencia**». Estado:
- ✅ **FCM «despertador» (#87) Fase 1+2b** (builds 2816/2817/2819): recibir (Firebase nativo), token que se intercambia
  cifrado y dispara el «toque» al mandar por el buzón. **Robusto y probado en el simulador** (`fcmwake.js`). El disparo real
  por Google no se puede simular.
  - ✅ **Enviador DESPLEGADO (03-11, build 2895).** Firebase Functions pedía plan Blaze (tarjeta + prepago, y dio errores
    de facturación OR-CBAT), así que se desplegó el equivalente en **Cloudflare Workers** (gratis, sin tarjeta):
    `push-sender/cloudflare/worker.js`, publicado por el dueño en `https://nexo-wake.maurizioamistani.workers.dev` con la
    llave de la cuenta de servicio como secreto `SA_B64`. Credenciales **verificadas con `curl`** (token falso →
    `{"error":"fcm","status":400}` = Google aceptó la llave, solo rechazó el token de prueba). La app ya apunta ahí
    (`DEFAULT_SENDER` en `net_link.js`, build 2895). **Falta del dueño:** la prueba del despertar real (token real del
    diagnóstico → `{"ok":true}` y el móvil cerrado despierta — **✅ PROBADO 03-11**: el diagnóstico mostró `[FCM] Despierta
    recibido (data=1, prio=1/1)` con la app cerrada 3 min). **SEC-3 (03-11, build 2898):** token fuera del diagnóstico (solo
    prefijo); el daño del spam de toques es solo batería (no brecha); auth por pareja diferida — razonamiento en `docs/FCM.md`.
- ✅ **Archivos grandes por internet (#99 Fase A)** (build 2818): tope ~6 MB → ~22 MB (Tor directo o relés). **Nunca más
  «enviada» en silencio**: si un archivo no cabe por el camino de ahora, sale un aviso claro (ya estaba desde la 2786; el
  revisor de robustez lo confirmó). **Falta (Fase B, pendiente):** >22 MB (p. ej. una APK de 24 MB) por **Tor directo**
  en bulk — necesita que Tor conecte de verdad en el Vivo (hoy el diagnóstico muestra internet solo por relés). Honesto:
  mandar una APK por internet de punta a punta sigue sin estar hasta la Fase B + Tor conectando.
- ✅ **Auditoría severa + puntuación + comparativa** (build 2820): dos revisores adversariales; 7 fallas reales
  arregladas (SEC-1 ALTA, G1 GRAVE, M1, M2, SEC-4/L1/L2/L3), con prueba. **Puntuación: índice de robustez 43,1/100**
  (`ROBUSTEZ.md` §4; el techo es B=confirmación en teléfonos, 6,8/35). **Comparativa** actualizada en `COMPARATIVA.md`
  (§1 tabla + §1bis puntuación). Detalle de seguridad en `AUDITORIA.md` §3quater. Quedan abiertos, para rondas propias y
  decisión del dueño (tocan el estado de claves/protocolo): **H3, H4, M5, M6, F6, F7, F8** y los nuevos **SEC-2** (alta
  por ID auto-agrega desde una `acc` forjable) y **SEC-3** (✅ 03-11, build 2898: token fuera del diagnóstico; el daño del
  spam de toques es solo batería, no brecha; autenticación por pareja diferida — ver `docs/FCM.md`).
- ✅ **#87 martilleo del Bluetooth (build 2821, con el diagnóstico de los dos teléfonos del dueño):** un contacto con el
  GATT roto (`no_service` + MTU 23, como `nx1e29ab2f`) se reconectaba por Bluetooth cada ~15 s para siempre → 627
  «despertares»/batería en el Vivo. Ahora se pausa su Bluetooth tras 4 fallos (backoff 30 s→10 min) y sigue por
  internet/Wi-Fi; prueba `noservice.js`. **A2 cerrado (build 2900, del análisis del dueño):** la auto-conexión por resultado
  de escaneo/reconexión/resume-de-cámara (`_autoConnectGATT`) TAMBIÉN respeta la pausa — antes era la otra puerta por la que
  se saltaba el backoff y re-martillaba la radio; una conexión manual («Agregar») sí pasa. Prueba `noservice.js` test 5.
  **Falta del dueño:** confirmar en los teléfonos que bajan los despertares.
- ✅ **#2 archivos que se abortaban por un enlace que parpadea (build 2822, diagnóstico del S24):** una transferencia
  (ChatStream) se abortaba tras 8 «window timeout» (`Max window retries` → `sendFile FAIL … Abortado`) aunque el enlace
  solo estuviera caído un rato y volviera (visto: video/imagen a `nx0ed4a8be`, foto al Vivo). Ahora, con el enlace caído,
  que la ventana caduque **no** gasta un reintento del tope (`_onWindowTimeout` espera a que `_linkUp()` vuelva); el
  límite real sigue siendo el timeout global (60 s sin ningún ACK). Solo afecta a enlaces `lan:`/`net:` (el Bluetooth
  crudo no se toca, para no romper transferencias BT sanas). Prueba `fileflap.js`. **Falta del dueño:** confirmar con la
  2822 que las fotos/archivos llegan tras un corte. También aclarar qué build tienen (no se vio la línea `Token FCM:` →
  quizá build anterior a la FCM). (El caso del contacto `net:` genuinamente offline con buzón sigue con el tope de antes.)
- ✅ **#50 (texto durante el margen de 15 s tras un corte de Wi-Fi) — VERIFICADO, ya funcionaba.** Al revisarlo con el
  método (reproducir antes de tocar) resultó que NO había fallo: un texto escrito mientras el Wi-Fi está cortado llega
  igual al volver, por tres caminos según cuánto dure el corte — **corte breve** (<~8 s): lo entregan los reintentos
  del ack al volver (queda en «enviando», ~0,6 s); **corte medio** (~8–15 s): agota los reintentos cortos → «pendiente»
  (con reloj, nunca «!») y se reenvía al volver dentro del margen (~2 s); **corte largo** (>15 s): al acabar el margen
  pasa a Bluetooth y llega por ahí. Ninguno muestra «!». Se **añadió un caso medio** a `tests/sim/wificut.js` (antes solo
  breve y largo) como red de seguridad; batería 77/77. Cambio solo de prueba (la app no se tocó).
- ✅ **#19 (Wi-Fi Direct: no remandar HD por Bluetooth si ya llegó) — ya resuelto en código** (`wifi_direct.js` v1.3):
  se da por entregado en cuanto el socket de Wi-Fi Direct confirma (tiene todos los bytes) y, si luego llega también
  por Bluetooth, se descarta (`completedMessages`); los tiempos por fase ya salen en el diagnóstico. La velocidad real
  («medir y acelerar») se mide en los teléfonos (el simulador no monta Wi-Fi Direct de verdad).
- ✅ **#83 (el Wi-Fi no se suelta a internet; llamadas sobre Wi-Fi) — ya resuelto en código.** El orden de camino antepone
  el Wi-Fi local (`lan:`) al internet (`net:`) (`_deviceFor`, probado por `route.js`); y las llamadas de voz y vídeo usan
  el enlace directo `lan:` cuando el Wi-Fi está arriba (`calls.js` `_link`/`canVideo`; el vídeo solo por Wi-Fi). Confirmar
  fluidez en los teléfonos.
- ▶️ **Pendientes restantes** (dependen del dueño o de pruebas en teléfonos): #89 (notif heads-up — falta decisión de
  privacidad del dueño), #93 (micrófono AEC — se afina en los teléfonos), #95 (Stream fase 2 — función grande),
  #105 (pagos — socio/licencia), #107 (iOS Fase 1 Bluetooth — función grande, necesita cuenta Apple), #111 (logo/sonidos —
  elige el dueño), #112 (campaña final de seguridad — el dueño la pidió «al final»), #117 (FCM — el dueño despliega el
  enviador). Autónomo y sin bloquear quedaría **empezar a organizar Stream fase 2 (#95)** o **más rondas de auditoría**.

## Prueba real de la 2823 (dueño 28-10 noche) → builds 2824 + 2825
El dueño probó la 2823 en los dos teléfonos: **dos pruebas, S24 → Vivo con la app CERRADA + pantalla APAGADA y
LLEGARON** (gran avance del #87: ya despertamos el otro teléfono). Reportó cuatro cosas; respondidas así:
- ✅ **Entrega ✓✓ con la app cerrada (A, #87) — build 2825.** «El S24 solo marca enviado, no enviado-recibido»: con la app
  cerrada el nativo (NetBg) avisaba pero NO devolvía la confirmación. Ahora la devuelve por el mismo buzón de relés,
  sellada y **firmada con la clave de la pareja**, igual que armaría la app abierta. El dueño aclaró: **envío (✓) bien,
  entrega (✓✓) era lo que faltaba, leído bien** (el leído sigue siendo cosa de la app al abrir el chat). Prueba Kotlin de
  punta a punta con relé real. **Falta del dueño:** confirmar en los teléfonos que el emisor ve ✓✓ con el otro CERRADO.
- ✅ **Pantalla que se enciende entera con la app cerrada (B) — sin cambio, por decisión del dueño.** Preguntado si la
  quería discreta (solo la barra) o destacada (heads-up), eligió **«destacado: que se asome arriba»**. Es comportamiento
  del fabricante para los avisos de importancia alta; se deja como está (no es cambio de código).
- ✅ **Responder a una UBICACIÓN mostraba «código» (E) — build 2824.** `_msgSummary` no leía el adjunto de ubicación
  codificado dentro de `content`; ahora muestra «📍 Ubicación» (`chat_format.js`, prueba `chatactions.js`).
- ✅ **Deslizar para responder sin realimentación (F) — build 2824.** Ahora una flecha ↩ que crece con el desliz y, al
  pasar el umbral, se ilumina y vibra, como WhatsApp (`chat_actions.js`, prueba `chatactions.js`).
- ✅ **Gesto de la «N» en Perfil no abría el juego (C) — build 2824.** Faltaba `setPointerCapture` (el dedo salía de la
  zona al dibujar la «N» alta); ahora captura el puntero + respaldo táctil (`nexo_game.js`, prueba `juego.js`).
- ✅ **Guardada la 2823 como nueva base estable** (`base-estable-2823`, commit `b8644275`), como pidió el dueño.

## Prueba real de la 2825 (dueño 29-10) → build 2826
El dueño confirmó que **el ✓✓ con la app cerrada funciona** («funciona como lo esperábamos»). Pidió cinco detalles de
interfaz, todos hechos en la 2826 (JS/CSS, sin tocar protocolo ni nativo):
- ✅ **Transporte como símbolo** en la barra superior (icono de Wi-Fi / Internet / Bluetooth) en vez de la palabra: se
  ve mejor y ocupa menos. La palabra queda en el tooltip; «⚠ señal débil» sigue como texto.
- ✅ **Responder a un archivo ya no muestra «código»** (mismo fallo que la ubicación): `_msgSummary` nunca enseña JSON
  crudo; cualquier adjunto/descriptor cae a una etiqueta limpia.
- ✅ **Responder a un archivo muestra su NOMBRE** («📎 informe.pdf») en vez de «Archivo».
- ✅ **Barra superior con sitio para el nombre**; un nombre largo se parte en **2 líneas** (el nombre es ahora un
  `<textarea>` que admite dos renglones; se renombra igual tocándolo).
- Batería 77/77; a confirmar en los teléfonos (es visual). APK **nightly-2826** publicada (sha256 `e23f380d…`).

## Prueba real de la 2826 (dueño 29-10) → build 2827
El dueño pidió «aplicar el azul a las palomitas de leído en red Bluetooth».
- ✅ **Leído (✓✓ azul) por Bluetooth más robusto — build 2827.** **Honesto:** en el simulador el ✓✓ ya se pone azul por
  Bluetooth (el color/estado es igual en todas las redes; `status-read` azul #00d4ff) incluso forzando que el enlace se
  caiga al leer y reconectando → el síntoma exacto del dueño **no se reproduce** en el simulador. Hueco real visto en el
  código: el acuse de lectura (`read_receipt`) es un paquete de CONTROL que se manda UNA vez; si el enlace Bluetooth no
  está listo al leer (caído/reconectando) se **pierde sin reintento** → el ✓✓ queda gris para siempre. Arreglo (JS,
  aditivo, `ble_ui.js`): si al leer no hay enlace directo, se recuerda el acuse y se **reenvía al reconectar** (evento
  `peerReady`), como ya hacen estados/avatar; un acuse duplicado es inofensivo. Prueba nueva `tests/sim/readbt.js`;
  batería **78/78**. APK **nightly-2827** publicada (sha256 `0918c361…`). **Falta del dueño:** confirmar en los teléfonos;
  si el ✓✓ sigue gris por Bluetooth, mandar el diagnóstico de los dos (Perfil → Copiar diagnóstico) para ver la causa real.

## Pedidos del dueño 29-10 (3 cosas) → builds 2828+
El dueño: «1 los stickers se deben de implementar, 2 quita la burbuja cuando se manda emoji y aumenta el
tamaño, 3 buscar un entretenimiento para pegar un user a la pantalla».
- ✅ **(2) Emoji solo (1–3) GRANDE y sin burbuja — build 2828.** Un mensaje que es SOLO emoji (1 a 3) se
  pinta grande (54/44/34 px) y sin burbuja (como fotos, vía `:has()`), propios y recibidos; 4+ emojis o
  texto vuelven a la burbuja. Detección pura con `Intl.Segmenter` (familia/tonos de piel/banderas bien
  contados), defensiva. Pruebas en `chatactions.js`; batería **78/78**. APK **nightly-2828** publicada (sha256 `2711c488…`).
- ✅ **(1) Stickers — build 2829.** Pack INCORPORADO; por el cable viaja **solo el ID** del sticker
  (envoltorio `{type:'nexo_sticker', s:'<id>'}` por el camino de texto, cifrado); dibujo = SVG estático
  del repo (mapa congelado en `stickers.js`, como `_VIA_ICON`) → **sin bytes del emisor → sin XSS**, sin
  base64, sin vault. 10 stickers (feliz, risa, guiño, triste, sorpresa, corazón, estrella, fuego, ok, logo
  NEXO); se ven grandes y SIN burbuja (`:has(.msg-sticker)`); entran por el 7.º ítem del menú de adjuntar
  (🙂) → hoja de rejilla. Id desconocido → 🎟️ (nunca bytes crudos). Prueba `tests/sim/stickers.js`;
  batería **79/79**. APK **nightly-2829** publicada (sha256 `63715560…`). **Falta del dueño:** confirmar en el teléfono.
- ✅ **(3) Entretenimiento para «pegar» al usuario — build 2830: TRES EN RAYA (1.ª entrega de juegos de 2
  jugadores en el chat).** Recomendación: juegos de 2 jugadores, que es lo que mejor encaja con lo P2P/sin
  servidor de NEXO y da un motivo social para volver. Tres en raya entre dos contactos sobre el canal E2E
  que ya existe, como acción oculta del protocolo (`nexo_act act:'game', g:'ttt'`), **asíncrono** (la
  jugada llega cuando el otro vuelve). Robusto: tablero completo por jugada (idempotente) + validación
  estricta al recibir (sin trampa/desorden). `src/ui/ttt.js` + overlay 3×3 + 8º ítem 🎮 del menú + atrás
  de Android cierra el overlay. Prueba `tests/sim/ttt.js`; batería **80/80**. APK **nightly-2830** publicada (sha256 `e56ebe4a…`).
  **Pendiente del dueño:** confirmar en los teléfonos y decir si quiere **conecta-4** (mismo motor) u otra
  dirección (ampliar «Defensor NEXO», rachas/logros, efectos). Detalle en scratchpad `entretenimiento-3.md`.

## Prueba real del dueño 29-10: el mini-juego no arrancaba dibujando la «N» → build 2831
- ✅ **El gesto de la «N» ahora SÍ abre el juego — build 2831.** El dueño reportó que dibujar la «N» en Perfil no
  arrancaba el juego secreto (ya lo tocamos en la 2824 con `setPointerCapture`; fue insuficiente). **Dos causas reales,
  reproducidas en el simulador:** (1) **bug de eventos (principal):** un «candado» por tipo de entrada bloqueaba los
  `touchmove` de respaldo cuando el WebView mandaba `pointerdown` pero no `pointermove` fiable → el trazo se quedaba en
  1 punto y nunca se reconocía la «N»; ahora pointer y touch alimentan el MISMO trazo. (2) **reconocedor frágil:** ahora
  busca las esquinas reales de la «N» (tolera estrecha/ancha/inclinada/rápida) en vez de asumir los tercios exactos;
  umbral 4 s→6 s. `nexo_game.js`; `tests/sim/juego.js` ampliada (caso mixto pointerdown+touchmove: viejo `false`, nuevo
  `true`). Batería **80/80**. **HONESTO:** la «N» limpia ya se reconocía en el sim, el síntoma exacto no se reproduce al
  100 %, pero el bug del candado sí. **Falta del dueño:** confirmar en los teléfonos; si sigue sin abrir, mandar el
  diagnóstico (Perfil → Copiar diagnóstico) de los dos.

## Revisión externa del dueño (29-10): verificación punto por punto (no se aceptó nada sin comprobar)
1. **Limpieza del repo — ✅ VERDAD, ARREGLADO (parcial).** `node_modules` estaba versionado (4069 archivos, ≈91 % del
   repo) y `local.properties` también. Dejados de rastrear en ambas ramas (build 2832 / 61588a20); `.gitignore` ampliado.
   El CI usa `npm ci` y el sim instala sus deps, así que fue seguro. `.backup`/carpetas `build/` de Android: NO estaban
   versionadas (esa parte del informe no aplica). **Falta (decisión del dueño):** purgar node_modules del HISTORIAL
   (force-push destructivo que afecta base-estable y clones) — no lo hago sin su OK.
2. **Rendimiento de archivos por BLE — ⚠️ PARCIAL / DESACTUALIZADO.** El «base64 + 33 %» YA se arregló (trozos binarios
   por Bluetooth, `BinFrame.kt`, build 2753). El límite real hoy es MTU bajo/ventana en enlaces malos (MTU 23 del GATT
   roto del dueño). Afinar chunk/ventana/MTU es un cambio profundo del protocolo que el dueño probó funcionando (2823) y
   **necesita medición en teléfono real** (el sim no modela el throughput BLE) → hacerlo con cuidado y su diagnóstico, no a ciegas.
3. **Huecos de seguridad (SEC-2, H3/H4/M5/M6) — ✅ VERDAD, documentados y abiertos** (`AUDITORIA.md`). SEC-2 (acc forjable
   en alta-por-ID) está ATENUADO (contacto «sin verificar» + número de seguridad); el arreglo real es MITM de primer
   contacto (como Signal con números de seguridad) → cambio de protocolo/UX a validar en teléfono. Pendiente de atacar de a uno.
4. **Entrega/ticks con app cerrada — ⚠️ MEJORADO, no 100 %.** FCM (2816-2820), ✓✓ cerrado (2825), reenvío de leído al
   reconectar (2827). Quedan casos de Bluetooth inestable; el techo es confirmación en teléfonos (índice B).
5. **Código muerto/estructura — ⚠️ PARCIAL, por diseño.** CLAUDE.md dice que **solo entra en la APK lo que importa
   `main.js`**; el resto de `src/` (fenix/net/mesh/auth experimentales) es intencional, no basura accidental. Se puede
   marcar «experimental» más claramente, pero no son un bug.
6. **Reconexión/descubrimiento — ⚠️ ITERADO, se puede endurecer.** Throttle de escaneo (2814), pausa del GATT roto
   (2821), no abortar por parpadeo (2822). Más robustez posible con diagnósticos reales.
7. **Firma/distribución — ✅ VERDAD (deuda).** Keystore debug fijo; nightlies firmados consistentes. Play Store internal
   testing = decisión del dueño (cuenta de desarrollador, etc.).
8. **Docs largas — ✅ VERDAD.** PROGRESO/PENDIENTES son largos. Propuesta: archivar el historial viejo y dejar estado +
   últimas 5-7 builds. A confirmar (son la memoria de trabajo; no recortar a ciegas).
9-11. **Vault/cifrado sólido, UX del core loop, congelar features — en línea con el plan.** El cifrado en reposo + huella
   ya existe (fase 3); el intercambio de claves + ratchet existe (fase 2). «Congelar lo divertido hasta robustez alta» es
   una decisión del dueño (yo seguí sus pedidos de emoji/stickers/juego; feliz de congelar si lo indica).

**Orden que propongo (si el dueño da luz verde):** (1) ✅ limpieza repo [hecho] → (2) SEC-2 + autenticar control (H3/M5/M6)
→ (3) medir y afinar rendimiento de archivos con diagnóstico real → (4) endurecer reconexión. Cada uno con su batería.

## Propuesta del dueño 29-10: ✓✓ (entregado) también con la app CONGELADA en segundo plano → build 2833
El dueño propuso una segunda vía de confirmación: en cuanto el otro teléfono muestra la notificación, disparar un «ping»
de vuelta que confirme la entrega, para que el que manda SÍ o SÍ reciba retroalimentación. Verificado contra el código:
- **App totalmente CERRADA:** ya estaba hecho — el nativo (`closedReceive`) manda el ✓✓ firmado al recibir y luego
  muestra la notificación. Su idea ya existía ahí.
- **Segundo plano CONGELADO (el Vivo congela la app, el JS no corre):** AQUÍ estaba el hueco — el nativo mostraba la
  notificación de respaldo a los 4 s (`backgroundNotify`) pero **no** mandaba el ✓✓. El emisor veía «enviado» (o rojo
  tras agotar reintentos) aunque el mensaje había llegado y el aviso había salido.
- ✅ **Arreglo (2833):** al avisar un mensaje por el camino de segundo plano, el nativo manda también la confirmación de
  ENTREGA FIRMADA por Bluetooth (helper `sendDeliveredAck()` compartido con el modo cerrado; firmada con la clave de la
  pareja, C1; el emisor proto-2 la exige; dedup por tipo+id → si el JS luego descongela y también la manda, no molesta,
  son las dos vías que pidió el dueño). El aviso por Wi-Fi/LAN va sin ack por esta vía (esa confirma por su cuenta).
- Reproducido antes de arreglar (simulador, escenario `frozen` modelando el Vivo): A veía «m1: failed, m2: sending».
  Con el arreglo: «m1/m2: delivered», sin pérdida ni duplicado al volver. Prueba `background.js --scenario=frozen` en la
  batería. ⚠️ A confirmar en los teléfonos del dueño.
- Nota: la notificación prueba ENTREGADO, no LEÍDO; el ✓✓ azul (leído) sigue atado a abrir el chat de verdad.

## Pedido del dueño 30-10 → build 2835 (confirmaciones de lectura + A1)
- ✅ **Ajuste «Confirmaciones de lectura» (2835).** El dueño probó 2832–2834 en los teléfonos: todo bien. Nuevo toggle en
  Perfil → Ajustes → «🔏 Privacidad» para encender/apagar el ✓✓ azul que *manda* este teléfono (como WhatsApp; por
  defecto encendido). Apagado → no se manda el acuse de lectura; el «entregado» gris no cambia. `chat_state.js` /
  `main.js` / `profile.js`; prueba `readtoggle.js`; batería 82/82.
- ✅ **A1 (notificación con heads-up/contenido) — VERIFICADO, ya estaba en código.** El aviso de mensaje usa canal de
  importancia ALTA + prioridad alta + título = nombre del remitente + heads-up; el contenido se oculta a propósito
  (E2E/privacidad). Sin cambio. Si se ve «solo el iconito»: canal viejo (reinstalar) o ajustes del fabricante. (#89)
- ✅ **Entrega con ahorro de batería (2836, prioridad del dueño «como WhatsApp siempre llega»).** Revisado: NEXO ya
  despierta al contacto dormido cuando hay internet (buzón de relés + «toque» FCM solo-datos de ALTA prioridad que
  atraviesa Doze/ahorro; el receptor arranca el foreground service). Hueco cerrado: un envío por Bluetooth no confirmado
  en ~10 s cae ADEMÁS al buzón → FCM (`_armDeliverySafetyNet`). Prueba `wakebt.js`. ⚠️ La rama «BLE con internet» (que el
  sim no aísla) a confirmar en los teléfonos; la garantía integrada (dormido → despertado + mensaje recuperable) sí
  quedó probada.
- ✅ **El «despertador» FCM cubre ya llamadas y videollamadas (2837, pedido del dueño «implementa el despertar para
  todo lo demás, incluidas llamadas y videollamada»).** El dueño vio que despertar al otro solo funcionaba para texto.
  Causa (leída en el código): `net_link._newMsgId` —lo que decide disparar el toque— solo reconocía `type:'chat'` y el
  primer trozo de archivo (foto/audio/ubicación ya despertaban), pero NO la OFERTA de llamada (`type:'nexo_call',
  op:'offer'`). Arreglo (solo JS, aditivo): `net_link.js` la reconoce como mensaje nuevo; `calls.js` publica la oferta YA
  en el buzón al mandarla (inmediato, no espera los 10 s de la red de seguridad; mismo id → `CallDedupe` deduplica);
  `ble_messages.js` deja la oferta fuera de la red de seguridad (`_callOut`) para no duplicar el toque. Prueba `wakebt.js`
  ampliada (oferta por el buzón → toque con el token). ⚠️ Que el teléfono dormido **suene** de verdad lo confirma el dueño.
- ✅ **Archivo a contacto OFFLINE por internet (reporte del dueño 30-10 con diagnóstico) — #124, build 2840.** Con el
  diagnóstico de los teléfonos quedó claro: el contacto estaba **apagado** (sin Bluetooth/Wi-Fi/Jump y offline por
  internet) y NEXO storm-retransmitía hasta fallar. Causa raíz (`ble_ack.js` `_linkUp()`): por internet miraba
  `net.online()` («¿tengo yo internet?») en vez de `net.canReach(nx)` («¿está el contacto en línea?», como ya hace
  Wi-Fi). Arreglado: `_linkUp()` por internet usa `canReach(nx)` → ausente = enlace «caído» → la ventana ESPERA sin
  tormenta; store-and-forward (buzón + `resumeOutgoingTransfers` al reconectar); el tope global marca 'pending' (⏳), no
  'failed'. Prueba `fileabsent.js`. ⚠️ La entrega real al reconectarse la confirma el dueño.
- 🔶 **Bluetooth a MTU 23: «cola de escritura llena» + ESCANEO LENTO (diagnóstico del dueño 30-10 y RE-REPORTADO 31-10:
  «escaneo demasiado lento, debería ser instantáneo») — tarea #129.** Con un teléfono (Galaxy Tab A7 Lite, `nx1e29ab2f`) el
  BT negoció el MTU mínimo (23, lentísimo) y entra en `no_service` una y otra vez; el envío de archivos/Fénix lo martillea y
  satura la cola de escritura nativa (`Envio nativo fallo chunk N Cola de escritura llena` en bucle), mientras la re-búsqueda
  reintenta cada ~15 s. Diagnóstico 31-10 confirma: trozos grandes (24000) y pacing 2 ms empujados a un enlace MTU 23, y el
  respaldo Fénix insistiendo en ese contacto roto.
  - ✅ **Escaneo lento RESUELTO (build 2854).** Causa del síntoma visible: un **respaldo Fénix de FONDO** (`type:'fenix'`)
    sobre un enlace MTU-23 «ready» pero lentísimo arrastraba hasta 15 min y mantenía `_transferActive()`=true, así que el
    bucle de re-búsqueda saltaba su turno y `_stopAutoScan` paraba el escaneo al arrancar el envío → escaneo de contactos
    PARADO. Fix: un respaldo Fénix (de fondo, nadie lo espera) **ya no pausa** el escaneo; una foto/vídeo/archivo que el
    usuario sí espera lo sigue pausando (v6.1.13). `_transferActive` ignora `meta.type==='fenix'`; `_stopAutoScan` no se
    llama para envío/recepción Fénix. Prueba `scanfenix.js` (reproduce con el código viejo y pasa con el fix; guarda de
    regresión). Confirma el dueño en los teléfonos.
  - ✅ **Concurrencia por enlace acotada (pacing parte 2a, build 2872, análisis del dueño 01-11).** Al reconectar,
    `resumeOutgoingTransfers` arrancaba TODAS las transferencias de archivo a la vez (en el diagnóstico real ~12
    «sendFile START» juntos) e inundaba la cola nativa con MTU 23; los textos/acks quedaban atrás → mensajes en ○.
    Fix: tope de **1 transferencia de archivo a la vez por enlace Bluetooth** (`_maxBleFilesPerLink`, en `ble_ack.js`
    `_sendFileJS`/`_bleFileSlots`/`_pumpFileQueue`); las demás esperan en cola y entran al liberarse un hueco
    (net:/lan:/Wi-Fi Direct no se limitan; textos/acks/control tampoco). Prueba `filecap.js` (4 archivos a la vez →
    máx. 1 stream, los 4 llegan y un texto mandado en medio llega sin quedarse atrás). Confirma el dueño.
  - ✅ **Fail-fast: no MARTILLAR el MTU mínimo con un archivo grande (B2, build 2886, diagnóstico del coche 02-11).** Un
    archivo GRANDE (base64 > 300 000) cuyo único camino es un Bluetooth de MTU mínimo (≤50) ya no se arranca: queda
    **⏳ pendiente** (registro en el vault, reanudable) y `resumeOutgoingTransfers` lo reenvía por Wi-Fi/internet/Wi-Fi
    Direct al aparecer un camino mejor; las **fotos/vistas previas chicas** SÍ se mandan por MTU 23. **Anti-inanición:**
    tras ~5 min sin camino mejor se intenta por Bluetooth igual (un contacto solo-Bluetooth nunca pierde el archivo).
    `ble_ack.js` (`_shouldDeferTinyMtu` + comprobación en `ChatStream.start`, tras crear el registro). Prueba
    `filetinymtu.js`. Esto cubre la parte JS de «preferir net/Wi-Fi para archivos con ese enlace».
  - 🔜 **Falta (pacing nativo, build propia con reproducción en sim):** (1) marcar el ritmo de escritura según la capacidad
    real del enlace (MTU bajo → trozo chico + más espera, o parar al llenarse la cola y reanudar al vaciarse en vez de
    reintentar a ciegas — el reintento con backoff ya está, WriteRetry/B1 build 2891) y **✅ priorizar en la cola nativa
    control/texto/ACK por delante de los trozos de archivo — HECHO (build 2899, `WritePacing.insertIndex`, prueba JVM
    `WritePacingTest`)**; (2) preferir net/Wi-Fi para archivos con ese enlace (parte JS hecha, B2 2886). (Fénix ya no insiste en contactos con GATT
    roto: solo envía a `ready_to_chat`, y el backoff `no_service` 2813/2814 los pausa; el caso que quedaba era el MTU-23
    «ready».) Reproducir primero en `tests/sim` el caso MTU 23 + cola llena.
- ✅ **Escaneo robusto a escala + recuperación de fallos (build 2838) (pedido del dueño 30-10, «rápido y robusto en poca
  señal, lejanía, interferencia, ahorro de batería… y un concierto con miles de NEXO escaneando»).** HECHO en JS (filtro
  NEXO siempre activo + compuerta global 5/30 s + recuperación ante onScanFailed), probado con VOPR + batería 84/84.
  Falta la parte nativa (2839, abajo) y la confirmación del dueño en los teléfonos. Revisado el código real:
  YA robusto en largo alcance (LE Coded PHY), señal débil (MIN_RSSI −95 permisivo), dedup+debounce, backoff no_service
  (2821) y vigilante tolerante (2814). HUECOS a cerrar: (1) `onScanFailed` (ble_interface.js:495) no recupera — falta
  backoff/reintento ante errorCode 3 (stack ocupado)/5 (sin recursos HW, típico en multitud)/6 (too frequently);
  (2) escala de concierto: `scanResults` (Kotlin) sin tope y dedup O(n²) → pico de CPU/ANR con miles; falta priorizar
  contactos conocidos entre el ruido; (3) modo de escaneo no adaptativo (siempre LOW_LATENCY; mal en ahorro de batería,
  máxima congestión en multitud) → degradar a BALANCED/OPPORTUNISTIC según contexto; (4) falta compuerta GLOBAL de
  arranques de escaneo (hoy el freno 5/30 s solo cubre el auto-escaneo, no la suma de todos los disparadores). Lo
  verificable en sim (compuerta global + recuperación) con batería; lo nativo (dedup O(1), tope, modo adaptativo) con
  CI-compila + prueba del dueño.
- 🟡 **VOPR — simulador de caos determinista (arrancado en 2838; escenario «concierto» hecho).** `tests/sim/vopr.js`
  con semilla fija; escenario 1 = concierto (escaneo a escala + recuperación). Falta EXTENDER a más escenarios
  (entrega de mensajes bajo caos: caídas, reorden, congelados, particiones) para subir la dimensión D del índice en
  más áreas. Con semilla fija inyecta
  fallos reproducibles (caídas, pérdida/reorden de paquetes, congelados, desfase de reloj, tormentas de escaneo,
  particiones) y comprueba invariantes duros (sin pérdida ni duplicados, entrega eventual, sin ANR, memoria/CPU
  acotadas); al fallar, imprime la semilla para re-ejecutar idéntico. El **concierto con miles de NEXO** es un escenario
  del VOPR. El dueño autorizó arrancar.
- 🔜 **Escaneo — endurecimiento NATIVO (2839, no simulable; CI-compila + prueba del dueño).** Lo que el filtro siempre
  activo (2838) no cubre y vive en Kotlin: dedup O(1) (Map por MAC en vez del `scanResults.none{}` lineal O(n²)) + tope/
  LRU+TTL de la tabla «visto» (hoy sin límite) para CPU/memoria acotadas con miles de NEXO; **modo de escaneo adaptativo**
  (LOW_LATENCY solo en primer plano con pantalla encendida; BALANCED/LOW_POWER en segundo plano/ahorro, que Android fuerza
  igual); `MATCH_MODE_STICKY` por defecto en densidad; reinicio del escaneo cada ~25 min (un escaneo largo degrada solo a
  OPPORTUNISTIC). El filtro siempre activo (2838) ya acota el flood en origen, así que esto es el caso extremo.
- 💡 **Operabilidad por IA — rumbo acordado (fase futura, DESPUÉS de la robustez; pedido/opinión del dueño 30-10).** El
  dueño: vale la pena y diferencia, pero EN EL TELÉFONO (privado), no una IA de nube leyendo los chats; su idea de
  «contrato»: permiso de entrar/leer para la operación pedida y luego borrar lo recopilado. Refinamiento acordado (más
  fuerte y más diferenciador, es lo OPUESTO a la nube que te lee): (1) solo en el dispositivo (el chat nunca sale en
  claro); (2) capacidad ACOTADA a la acción concreta («mandá esto a Pedro»), no lectura total; (3) efímero por
  construcción (que NUNCA persista) en vez de «recopilar y borrar»; (4) consentimiento por acción + registro visible;
  (5) las llaves las tiene el user (gate biométrico para acciones sensibles); (6) nube solo con lo mínimo redactado y
  opt-in. Primero capa de ACCIÓN (mandar/llamar) antes que lectura. No arrancar hasta cerrar la robustez.
- 🔜 **Resto de «implementa todo» (pedido del dueño):** palancas de velocidad (2M PHY + prioridad de conexión alta en
  transferencias), «courier» spray-and-wait (evolución de Jump), y grupo A de seguridad: SEC-2 → P0-1 → H3 → H4, cada
  una en su build propia.

## Decisiones del dueño 27-10 (madrugada) y nuevos pedidos
El dueño pidió trabajar autónomo por los pendientes, «cerrar algunos de forma robusta», orden a mi criterio. Decisiones:

**Bloque autónomo 27-10 tarde (orden del dueño: PRIMERO las implementaciones, las PRUEBAS al final «cuando esté completo todo»):**
- ✅ **Juego secreto «Defensor NEXO» — HECHO (2806).** Mini-arcade oculto (`src/ui/nexo_game.js`, `attachNexoUnlockGesture`): nave, meteoros (amenazas), mejoras de disparo, **salvar contactos**, clasificación. El dueño pidió dejarlo **sencillo** (lo simplifiqué). Prueba `tests/sim/juego.js`. El juego real se ve en el teléfono (jsdom no tiene Canvas).
  - ✅ **2810 (informe del dueño): el gesto de la «N» pasa de Ajustes a PERFIL.** En Ajustes el scroll se comía el trazo; ahora va en una zona dedicada del espacio negro de abajo de Perfil (`#nexo-gesture-zone`, `touch-action:none`). Batería 71/71.
- 💡 **Idea del dueño para #87 (app dormida): latido/ping mutuo entre contactos para mantenerse despiertos.** Honesto: por **internet** no despierta a un teléfono que Android ya congeló (Doze) sin un servidor de avisos (rompe el no-servidor); por **Bluetooth con contactos CERCA sí** ayuda (Android deja que la señal BT despierte la app un momento, como con las llamadas). Propuesta: **latido/despertar por Bluetooth entre cercanos** (lógica + prueba en sim; el efecto real del sueño solo se ve en los teléfonos → falta el «Copiar diagnóstico» de los dos). **Pendiente de que el dueño diga si arranco.**
- ⏳ **Logo y sonidos — mandados al dueño para que JUZGUE, sin desplegar (es muy exigente con la marca, rechazó un logo 2 veces).** Sonidos: 3 tonos originales (mensaje/llamada/videollamada), estéreo, campana de cristal, motivo de marca común. Logo: 2 tomas limpias (B = N cuya diagonal une dos nodos = «nexo», recomendada; C = N pura). Al elegir → pulir + generar todo el juego de iconos + cablear sonidos (res/raw + Kotlin + Web Audio). **2834 (pedido del dueño):** se puso un **logo PROVISIONAL** mientras elige el definitivo — cuadro negro #000 con burbuja cian (#19E0FF) y «N» blanca (icono adaptativo); y el **icono de aviso** de la barra de estado pasó a uno propio (burbuja + «N», opción 1 que eligió). Falta el definitivo (este reemplaza solo el adaptativo; los PNG legacy siguen viejos).
- ✅ **Reorganizar Perfil + Ajustes (2807) — HECHO.** Perfil (identidad) separado del menú **⚙️ Ajustes** (seguridad, avisos, llamadas, internet, diagnóstico, cuenta); el **gesto de la «N» ya vive en Ajustes**. Una sola hoja a la vez. Pruebas actualizadas, batería 69/69.
- ✅ **Rendimiento de NEXO (2808) — HECHO.** Sección **⚡ Rendimiento** en Ajustes que mide y muestra en vivo: latencia (ping ida y vuelta), contactos en línea, mensajes entregados y %, tiempo de confirmación de entrega y de transferencia. Pasivo (escucha eventos ya existentes + reusa el RTT del supervisor). `src/ui/perf.js` + prueba `tests/sim/perfmetrics.js`. Batería 70/70.
- ▶️ **Pendiente del dueño (sin desplegar hasta su OK): logo (B/C) y sonidos.** Al elegir → pulir + generar iconos + cablear sonidos.
- 🔒 **Campaña de seguridad/robustez (orden del dueño: al final):**
  - ✅ **P0-4 (XSS) — HECHO (2809).** Confirmado que todo el contenido del remitente se pinta como texto; vigilante `tests/sim/xss.js` + CSP endurecida. Batería 71/71.
  - ▶️ Pendientes (endurecimiento del PROTOCOLO, más delicado — tocan estado de claves/control, solo verificables en el simulador; el dueño debe probarlos en los teléfonos): **H3** (tarjetas de contacto fijan claves sin verificar → marcarlas «de oídas»), **H4** (petición Fénix sin autenticar), **M5** (control `ni`/`kx`/`nm` sin autenticar), **M6** (`ss` sin autenticar), **F6** (wakelock/sonido por flujo sin autenticar), **F7** (FileProvider acotar). También: replay del ratchet, VOPR de fallos inyectados, fuzzing de medios.
  - Haré estos con cuidado, de a uno, cada uno con su prueba; antes de los más delicados (H3) confirmo con el dueño por ser estado de claves.
- ▶️ **AL FINAL (orden del dueño): campaña de seguridad/robustez** (XSS+CSP, H3/H4/M5, replay del ratchet, inyección de fallos, fuzzing).
- **Stream**: empezar por **Estados entre contactos, solo cercanos** (sin servidor), «luego vemos». Cifrados, caducidad 24 h (molde del cobro). Ver `STREAM_PROPUESTA.md`. (#104) → ✅ **HECHO en la 2799 (fase 1)**: `src/ui/estados.js`, tira «Estados» arriba de contactos, publicar/ver/quitar, texto 24 h cifrado como acción oculta del chat, prueba `tests/sim/estados.js`. Falta (más adelante, cuando el dueño lo pida): **foto/clip** de estado, y lo público/con-servidor («luego vemos»).
- **Pagos**: **botón «Cobro» OCULTO desde la 2967 (dueño 09-11: «hasta que tengamos algo sólido no tiene caso mostrarlo»)** — una regla CSS en `nexo_theme.css` (`.attach-menu-item[data-type="cobro"] { display:none }`); el código de cobros y su prueba siguen intactos, se vuelve a mostrar borrando la regla. Antes: «lo implementamos y después vemos lo del socio». OJO: saldo/custodia real exige licencia o socio (Mercado Pago/CoDi) = Fase 2. Autónomo-seguro ahora: ampliar UX, maquetar; **recargas celulares** necesitan proveedor/API. (#105)
- **(pedido del dueño 01-11, PARA DESPUÉS) Estados con FOTO/IMAGEN y mini-vídeo**: ampliar `estados.js` (hoy solo texto) a subir foto/imagen y clips cortos (es el «falta foto/clip» de la fase 1 de Estados; el dueño lo pide explícito).
- **(idea del dueño 01-11, PARA DESPUÉS) Monetización — contenido de pago / suscripciones (tipo «OnlyFans»)**: creadores con contenido de pago como vía de ingresos. Al diseñarlo: verificación de edad, pagos (misma restricción de custodia → licencia/socio, ver Pagos), moderación y marco legal. Encaja con la fase de «Cobros»/negocio.
- **(pedido del dueño 01-11) SESIÓN DEDICADA: «cómo hacer rentable NEXO»** — retomar a fondo el plan de negocio (#63, `PLAN_NEGOCIO.md`): modelo de ingresos (cobros sin licencia, suscripciones/contenido de pago, recargas), país y requisitos legales. Plantearlo bien ANTES de implementar.
- **(plan del dueño 01-11, EN CURSO) UX primero, luego nativo — en este orden:**
  - (1) ✅ **Quitar botones de atrás, navegar SOLO por gestos** — HECHO en **2875**: `__nexoHandleBack` (el «atrás» de Android) ampliado para cerrar también Ajustes/Perfil/«Agregar» además de visor/estado/cámara/chat; botones de atrás/cerrar ocultos por CSS (siguen en el DOM para no romper handlers ni pruebas); nombre del chat recentrado; se MANTIENEN los «Cancelar» de los diálogos (son acciones, no «atrás»). Prueba `backbtn.js` ampliada, batería 102/102. ⚠️ **Falta que el dueño confirme en los teléfonos** que el gesto cierra bien (sobre todo salir del chat y del panel «Agregar») y que no se echa en falta ningún botón.
  - (2) ✅ **Botones de la pantalla de chat de GRUPO iguales a los del chat de contacto 1-a-1** — HECHO en **2876**: el grupo ya tenía los mismos botones (llamada/videollamada/lupa, iconos idénticos) en el mismo header; solo faltaba el estilo del tema en `#nexo-gcall-btn`/`#nexo-gvideo-btn` (se veían a 38px y planos). Ahora heredan el «look NEXO» (40px, superficie+borde, SVG 20×20). Solo CSS. ⚠️ Falta confirmación del dueño en los teléfonos.
  - (3) **Crear stickers (editor propio) + rediseñar los existentes** (`stickers.js`):
    - Parte 1 ✅ **rediseño de los existentes** — 1er intento en **2877** (SVG con degradados) NO gustó al dueño («se ven baratos y feos», mandó imagen de referencia con emojis 3D). **Rehecho en 2879**: pack = 15 PNG **3D** (Fluent Emoji 3D, MIT, en `src/assets/stickers/`; `nexo` propio). Sigue viajando solo el id; `stickerAsset(id)` da una ruta fija de confianza pintada como `<img>`; id desconocido → 🎟️. Nuevos ids: corazon_ojos, nerd, manos, fiesta, cohete. ⚠️ Falta prueba del dueño. 
    - Parte 2 ✅ **crear stickers propios** — HECHO en **2878** (el dueño eligió la opción **B: foto + texto/emoji encima**). Editor `src/ui/sticker_editor.js`: foto (galería/cámara) + texto (meme) + emoji → lienzo cuadrado JPEG comprimido. El sticker propio lleva la IMAGEN (el pack solo el id): viaja como la foto de perfil (base64 VALIDADA `STICKER_IMG_RE` + tope `STICKER_MAX_LEN`, cifrada E2E, pintada como `<img>` NUNCA innerHTML; inválido → 🎟️). Guardado en vault (`nexo_my_stickers.json`, máx. 30) + «+ Crear» en el selector. Prueba `stickers.js` ampliada. ⚠️ Falta prueba del dueño en los teléfonos.
    - Parte 2b ✅ **arrastrar texto/emoji sin recortar** — HECHO en **2881** (pedido del dueño 02-11): se arrastran con el dedo; el texto se parte y achica para no cortarse; ambos clampados dentro del borde. `sticker_editor.js` reescrito con `drawSticker` compartido + arrastre por pointer.
    - Mejoras posibles para después (si el dueño las pide): recorte/zoom de la foto, quitar fondo (die-cut), girar/escalar el texto, y borrar un sticker propio del selector (ya existe `removeUserSticker`, falta gesto en la UI).
  - **→ Con 2875/2876/2877/2878 queda cerrado el plan UX del dueño (puntos 1-2-3). SIGUE lo nativo UNO A UNO (abajo).**
  - **Lado nativo (con cuidado). El dueño eligió (02-11) empezar por (b) ConnectionService, en PARALELO a lo que hay (tener las dos vías) y «lo funcional primero, monetización después»:**
    - (b) **ConnectionService/Telecom autogestionado (tipo WhatsApp/Signal)** — **incrementos 1 (2880) y 2 (2882) HECHOS; compilan en CI ✓.**
      - **1 (entrante, 2880):** `CallTelecom` + `NexoConnectionService` + `NexoConnection` + `MANAGE_OWN_CALLS`/servicio en el manifest. La entrante se presenta como llamada REAL; el aviso CallStyle probado se muestra SIEMPRE (cero regresión si Telecom falla). Contestar/rechazar reusan el camino de siempre.
      - **2 (saliente + colgar desde el sistema, 2882):** la llamada que YO hago también por Telecom (`CallTelecom.startOutgoing`→`placeCall`; `NexoConnectionService.onCreateOutgoingConnection`; `setDialing`→`setActive`) → convivencia con una llamada del teléfono, mandos del coche/auriculares/reloj, foco de audio. Una llamada activa o saliente se puede COLGAR desde el sistema (`NexoConnection.onDisconnect` distingue sonando=rechazar [parte 1] de activa/saliente=`NexoBlePlugin.telecomEnded`→evento `onTelecomEnd`→`calls.hangup()`). `calls.js` avisa del ciclo de vida (`telecom` op `out`/`active`/`end`). ADITIVO + respaldo: si Telecom no está o falla (`isOutgoingCallPermitted` false, OEM raro), NEXO llama EXACTO que antes (todo try/catch; la llamada no depende de esto). NO toca el audio probado (`callAudio`) ni el camino de la entrante. Prueba `tests/sim/telecom.js` (out→active→end, video:true, respaldo sin grabar).
      - **No verificable aquí (sin SDK Android)** → se confirma compilando en CI + prueba del dueño en los teléfonos (que la saliente aparezca en el coche y se pueda colgar desde ahí).
      - **Falta incremento 3:** enrutado FINO de audio (Bluetooth/altavoz/auricular como dispositivo de la llamada, coordinado con la media de NEXO — toca el `callAudio` probado, hay que validarlo en teléfono) + mantener la ENTRANTE viva por Telecom durante la llamada activa (hoy la parte 1 la cierra al contestar) + pulir fabricantes. Es GRATIS (parte de Android) y privado (self-managed no entra en el registro de llamadas).
    - (a) **despertar-al-llamar robusto = memoria de rechazos + reenvío** (nativo: recordar ofertas ya rechazadas para no re-sonar; el re-ofrecer regresó a #2768 y se revirtió → necesita memoria nativa de rechazos). *Pendiente; se hará si el dueño lo pide tras (b).*
    - (c) **pacing 2b** — ✅ **prioridad en la cola nativa HECHA (build 2899).** Texto/control/ACK (vía `sendMessage`, ALTA
      prioridad) salta por delante de los trozos de archivo (vía `sendBinary`, BAJA) ya encolados, sin mover el item en
      vuelo (índice 0) y manteniendo FIFO entre iguales. Función pura `WritePacing.insertIndex` probada en JVM
      (`WritePacingTest`); cableada en `NexoBlePlugin` (`WriteQueueItem.isHigh`, enqueue de `sendMessage`/`sendBinary`).
      Cierra el síntoma «texto/acks atrás de un archivo en MTU 23 → burbujas en ○». *Falta (menor): ritmo por MTU más fino
      y medición real; el caso base64-fallback (archivo por sendMessage) sigue como hoy, no empeora.*
    - **Tareas secundarias de UI (dueño 02-11; para DESPUÉS de lo funcional del diagnóstico):**
      - **Fondo de pantalla elegible** para la LISTA de contactos y para los CHATS (como WhatsApp). ✅ **HECHO en la 2889** (incremento 1, local): Ajustes → «Fondo de pantalla» → elegir foto para la lista y para los chats; se reduce (lado mayor 1280, JPEG), se guarda cifrada (`nexo_wp_list.json`/`nexo_wp_chat.json`) y se pinta como fondo de `#app` con un oscurecido para que se lea el texto; al abrir un chat se pone el de chats y al volver el de la lista (independientes); sin fondo queda negro liso. `src/ui/wallpaper.js` + Ajustes (`profile.js`) + prueba `tests/sim/fondo.js`.
      - ✅ **Fondo POR chat concreto + COMPARTIR — HECHO en la 2890.** El dueño eligió **(1) opción A** (se elige desde la cabecera del chat, botón 🖼️) y **(2) compartido, con opción a compartir** (al cambiar el fondo de un chat podés tocar «Compartir» y se lo manda al otro, no automático). El fondo propio del chat manda sobre el global de chats; compartir va como acción oculta cifrada E2E (`nexo_act act:'wp'`, como la foto de perfil, imagen reducida ≤~0,5 MB) y el otro lo aplica SOLO a ese chat. `src/ui/wallpaper.js` (fondo por chat + botón de cabecera + hoja), `chat_actions.js` (recibo), prueba `tests/sim/fondo2.js` (2 teléfonos: precedencia, compartir E2E recibido sin mensaje visible, guardado por contacto, rechazo de lo que no es imagen).
      - ✅ **Burbuja de texto: borde/relleno — HECHO en la 2886** (radio 20→14px, padding 9×13→10×14). Ya no recorta.
      - **Interfaz de toma de FOTO y VÍDEO: rediseñar** — se ve antigua y distinta al resto de la app; igualarla al estilo NEXO (controles, colores, botón de captura, cambiar cámara, flash, revisión). **Siguiente de interfaz.**
    - **Monetización (OnlyFans/NEXO Plus): el dueño dijo «primero lo funcional, monetización después».** Mi opinión (02-11): empezar por NEXO Plus + suscripción/propinas a canales de creador (usa los cobros ya hechos); OnlyFans/adulto = fase final que exige socio de pagos para adultos + verificación de edad + moderación obligatoria; anti-bypass = llave-por-pago (contenido cifrado, llave al confirmar pago) + ver-una-vez + FLAG_SECURE + marca de agua por suscriptor (la filtración con otra cámara no la para nadie). Pendiente escribir en `PLAN_NEGOCIO.md`.
- **Archivos grandes + llamadas + videollamadas «siempre»** (incluido por internet). Archivos grandes por internet ya van (Tor ~22 MB). Llamada/videollamada por internet (#3) NO está y es dura (media en tiempo real sobre Tor/relés, quizá requiere TURN=servidor) — investigar y ser honesto. (#99)
- **Avisos de mala señal** (calidad de enlace). (#102)
- **Contacto**: tocar la FOTO → verla grande; tocar el NOMBRE → entrar al chat. (#100)
- **Gestos de deslizar-atrás** funcionales y ajustados. (#101)
- **Face ID** (desbloqueo por rostro) además de huella, más rápido. (#103) → **Análisis (necesita DECISIÓN del dueño; nativo, no se prueba en el simulador):** en Android no hay un «Face ID» aparte — el desbloqueo va por `BiometricPrompt` (plugin `nexo-auth`, `AuthPlugin.kt`), que **ya ofrece el rostro SI el teléfono tiene sensor facial FUERTE (Clase 3, p. ej. Pixel 4/algunos)**. Nuestro bloqueo exige `BIOMETRIC_STRONG` porque descifra la identidad con una clave del **Keystore atada a la autenticación** (`setUserAuthenticationRequired(true)`), y Android **no deja** atar esa clave a un rostro **DÉBIL (Clase 2)** — el que traen casi todos los teléfonos (cámara, se engaña con una foto). Por eso en el teléfono del dueño seguramente solo sale la huella: su rostro es Clase 2. Permitir el rostro débil significaría **soltar el cifrado del bloqueo** (autenticar solo «presencia», sin `CryptoObject`) = **menos seguro** para una app cuyo fuerte es la privacidad. **Pregunta para el dueño:** ¿quieres un «desbloqueo rápido por rostro (menos seguro)» como opción aparte, o mantener solo biometría fuerte (huella/rostro Clase 3)? **Diagnóstico útil:** ¿tu banco u otra app con biometría segura te ofrece el rostro? Si **sí** → tu sensor es Clase 3 y basta revisar por qué nuestro prompt no lo ofrece (fácil y seguro); si **no** → es Clase 2 y es la disyuntiva de arriba. NO lo toco a ciegas (método obligatorio: no afirmar/subir lo no comprobado; y no bajar la seguridad sin que lo decidas).
- **Auditoría** para verificar robustez y fallas. (#106)
- Buenas noches: el dueño se fue a dormir (~1:40 am), trabajo mientras tanto.

Orden que sigo (robusto, de a uno, con batería verde + APK): 2794 buscar ✓, 2795 ver una vez ✓, 2796 limpieza pagos ✓, 2797 foto/nombre (#100) ✓, 2798 mala señal (#102) ✓, **2799 Stream Estados fase 1 (#104) ✓**, **2800 auditoría (#106) ✓** (2 fallas reales arregladas), **2801 guardar en galería (#92) ✓**.

**Decisiones del dueño al despertar (27-10 mañana), respondiendo mis preguntas:** «1 dejalo opcional que el user decida, osea agregá Face ID. 4 ta. 5 si» →
- **#92 descargar a galería: SÍ** → ✅ **hecho en la 2801** (nativo `saveToGallery` + botón en el visor; no en «ver una vez»). **Validó mi flujo de builds NATIVOS** (sin SDK local: Kotlin se compila en CI; lo real se prueba en el teléfono).
- **#101 gestos deslizar-atrás: SÍ** («ta») → ✅ **hecho en la 2802**. `onBackPressed` en `MainActivity.java` → `window.__nexoHandleBack` (chat_nav): cierra en orden visor/estado/cámara/chat; sin dependencia nueva (`@capacitor/app` no hizo falta). Prueba `backbtn.js`. Nativo → a confirmar en el teléfono.
- **#103 Face ID: SÍ, OPCIONAL (el usuario decide)** → ✅ **hecho en la 2803**. El bloqueo real es `biometricAuth`/`biometricStatus` en **NexoBlePlugin** (el `AuthPlugin`/nexo-auth que miré primero está muerto, no se registra): es una puerta de PRESENCIA, no cifra. Ajuste «desbloqueo rápido por rostro (menos seguro)» en Perfil → Seguridad permite `BIOMETRIC_WEAK`; default fuerte, sin Keystore. Prueba `lock.js` (paso 12). Nativo → a confirmar en el teléfono.

**Los 3 nativos de la mañana subidos (2801/2802/2803), a confirmar en el teléfono.** Quedan, dependientes del dueño: pagos con saldo real/recargas (socio/proveedor #105), llamadas por internet (#99, quizá servidor TURN), y los bugs que no reproduzco en el simulador (#87 app cerrada, ○+Reintentar) que esperan su diagnóstico.

Siguen dependiendo del dueño: pagos con saldo real/recargas (socio/proveedor #105), llamadas por internet (#99, quizá servidor TURN), y los bugs que no reproduzco en el simulador (#87 app cerrada, ○+Reintentar) que esperan su diagnóstico.

## 0. Robustez: medición y tareas diarias (pedido del dueño 25-10)
`docs/ROBUSTEZ.md`: registro de la revisión 1 (24 y 25-10, builds 2766–2771: 63 fallos encontrados, 62 arreglados),
índice de robustez (medición inicial **45,3 sobre 100**; lo que más baja: casi nada confirmado en los teléfonos desde la
2765) y rutina diaria. Con la 2772: **44**. Con la 2774 (auditoría de seguridad): **41,8** — baja porque se añadió un área nueva y exigente
«Seguridad frente a ataques» (peso 10) con 9 puntos débiles abiertos que sacó la auditoría; no es regresión (la
seguridad mejoró: 8 arreglos + 16 pruebas, batería 51/51, Kotlin 87/87; ver `nexo-private/seguridad/AUDITORIA.md` y §0c). Con la 2777
(fase 2, C1 arreglado): **42,1** — las confirmaciones (✓✓) ya van firmadas con la pareja (un punto débil grave menos,
una prueba más), batería 52/52, Kotlin 90/90. Informe del dueño: 2778 (llamadas: menos ruido, pantalla al entrar llamada,
contestar deslizando) y 2779 (alta por ID: agregar a alguien lejano con su NEXO ID + solicitudes aceptar/eliminar; batería
53/53). Con la 2780 (informe del dueño: las fotos/archivos a un contacto lejano no llegaban): fotos y archivos medianos
(~6 MB) ahora SIEMPRE se pueden mandar por internet (buzón de los relés o Tor), botón «Reintentar» a los 30 s y reenvío
solo al volver la conexión; batería 53/53, índice **41,4** (baja de 42,1 al apuntar el bug del Wi-Fi→internet del dueño como punto débil grave abierto; no es regresión). Con la 2781 (informe del dueño: notas de voz): al grabar o al entrar una
llamada se para el audio que suena; pausar/reanudar la grabación; borrarla antes de enviar (`tests/sim/voicenote.js`);
batería 54/54, índice **41,7**. Con la 2782 (pedido del dueño): **editar un mensaje ya enviado** con etiqueta "editado"
(`chatactions.js` ampliada y metida en la batería, tag CHATACT); batería 55/55, índice **42,3**. Con la 2783 (pedido del dueño, todo en una APK): **reaccionar** (doble toque ❤️ + menú),
**gestos** (deslizar la burbuja izq/der para responder, deslizar el chat abajo para cerrar, pellizco/doble toque para
ampliar la foto), **palomitas iguales** en todas las redes (enviado ✓, entregado y leído ✓✓) y **micrófono** más
silencioso (gate −34 dB); `palomitas.js` + `chatactions.js` ampliada; batería 56/56, índice **42** (baja 0,3: se registró
como punto débil GRAVE el bug de la app cerrada del dueño; no es regresión). Con la 2784 (informe del dueño, todo JS): **#81** llamadas/videollamadas a pantalla completa en Android 14 — se pide el permiso al arrancar (sin él la llamada entra solo como aviso, sin Contestar/Rechazar); zoom de foto limitado al borde; franja de conectados sin parpadeo (histéresis 60 s); «Copiar diagnóstico» de la última hora. Batería 56/56, índice 42. El dueño confirmó que con la batería «Sin restricciones» las llamadas ya entran (faltaba la pantalla completa, ya en #81) pero los mensajes aún NO llegan con la app cerrada. Con la 2785 (NATIVO, las dos prioridades del dueño): **#1** la llamada entrante usa ahora `CallStyle` de verdad (pantalla de llamada real con Contestar/Rechazar grandes, en vez de un aviso normal que Samsung/Android 14 bajaba a aviso pequeño); **#87** WifiLock (FULL_HIGH_PERF) mientras NetBg escucha en segundo plano/cerrada (Android duerme la radio Wi-Fi con la pantalla apagada y tira el socket del relé) + **registro nativo persistente** (`NativeLog`) que ahora SÍ muestra en «Copiar diagnóstico» qué hizo el nativo con la app cerrada (antes el diagnóstico se armaba en el WebView, muerto con la app cerrada, y el hueco salía vacío). Batería 56/56, Kotlin 95/95 (+5 de `NativeLogTest`). **#87 sigue ABIERTO**: nativo, no reproducible en el simulador; a confirmar con el nuevo diagnóstico de los dos teléfonos (probar: app cerrada + pantalla apagada, mandar un mensaje, esperar ~2 min, abrir, copiar diagnóstico de los dos). #1 a confirmar con el permiso de pantalla completa concedido. Con la 2786 (informe del dueño: «que permita el envío de archivos grandes cuando hay internet; otra vez no mandó nada ni avisó si es por dimensiones»): el tope por internet pasa a ser **según el camino** — por los **relés** los medianos (~6 MB), por **Tor DIRECTO** también los **grandes (~22 MB)** (`_torDirect` en `media_limits.js`); y si un archivo no cabe por el camino de ahora **siempre sale un aviso claro** (tope + salida: activar Tor en Perfil o el contacto en el mismo Wi-Fi / Wi-Fi Direct / cerca), nunca más «no manda nada ni avisa»; además el **vídeo** que no se podía preparar antes fallaba en silencio y ahora avisa. Pruebas nuevas `tests/sim/bignet.js` (relés y Tor) en la batería. Con la 2787 (el dueño pidió avanzar «todos, uno a la vez, del más rápido al más complejo»): **Pagos Fase 1** — adjunto **"Cobro"** (💵) en el chat: importe, moneda, concepto y «cómo te pagan» (alias/CBU, enlace/QR de Mercado Pago/PayPal o efectivo); NEXO **nunca toca el dinero** (mensajería de cobros, sin licencia ni servidor); tarjeta con «Copiar datos»/«Abrir enlace», cifrada, por cualquier red. `src/ui/cobro.js` + prueba `tests/sim/cobro.js` en la batería (tag COBRO). Índice sin cambio (es una funcionalidad nueva, no un modo de fallo del catálogo). Con la 2788 (auditoría, lo seguro primero): **F9** — NEXO ya solo usa relés de internet **cifrados** (`wss://`); los en claro (`ws://`) quedan vetados salvo a loopback (pruebas/relé propio), porque por uno en claro un espía vería las etiquetas de tu buzón (`net_link.js` `relayUrls`+`_relaySafe`; prueba `relaytls.js`). Índice 42,1 → **42,5**. **Ojo: la APK de la 2788 NO se publicó** — el job «tests» de CI falló por un flake de `misroute.js` (la prueba, de enrutado BLE/Jump, no aislaba la red: jsdom trae `WebSocket` y `relayUrls()` caía a relés PÚBLICOS reales; en CI conectaban y el archivo «ausente» volvía «entregado»). El código F9 sí quedó en `NEXOCHAT`. La 2789 corrigió **dos detalles del dueño** —palomitas (entregado ✓✓ gris vs. leído ✓✓ azul; regresión mía de la 2783, era el color) y la **pantalla que se encendía con cada mensaje** (`wakeOnMsg()` por defecto false; regresión mía de la 2765; las llamadas siguen encendiéndola)— e intentó arreglar el flake con un stub de `WebSocket` en `misroute.js`, pero fue **INSUFICIENTE**: otra prueba volvió a conectar a relés reales y **la APK 2789 TAMPOCO se publicó**. Con la **2790** el arreglo de RAÍZ: el repliegue de F9 (`return safe.length ? safe : DEFAULT_RELAYS`) convertía la lista vacía del simulador (`NEXO_NET_RELAYS=[]`) en los relés PÚBLICOS reales; ahora `relayUrls()` respeta una lista vacía explícita como «sin relés» (se mantiene F9: una lista solo-en-claro cae a los `wss://` por defecto; producción no fija la variable → sin cambio). Revertido el stub; `relaytls.js` gana aserciones que fijan esto para siempre. La 2790 lleva TODO lo de la 2789 + F9 y por fin publica APK; índice sin cambio (42,5). El **○+«Reintentar»** (acuse que no vuelve) y el **#87** no se reproducen en el simulador → esperan el diagnóstico del dueño. El **○+«Reintentar»** (acuse que no vuelve) y el **#87** no se reproducen en el simulador → esperan el diagnóstico del dueño. **Siguiente (plan «todos, uno a la vez»): 2b) el RESTO de la auditoría (M5/M6 autenticar control, H3/H4) — toca el núcleo del protocolo (enlaces/nombres/sincronización), solo verificable en el simulador → hacerlo con cuidado y que el dueño lo pruebe en los teléfonos antes de confiarlo; 3) Stream (el más grande; además está «SIN DECIDIR»: sí/no y solo-cercanos/con-servidor). El #87 (endurecer NetBg) se intercala apenas lleguen los diagnósticos de los dos teléfonos (nativo; sin ellos no se puede medir). El bug GRAVE de
APP CERRADA (#87)** — con la app deslizada + pantalla apagada no llegan mensajes ni avisos (ni Wi-Fi ni internet) hasta
abrir; es nativo (la recepción vive en el proceso del WebView: al cerrar se apaga el LAN, y Doze duerme el proceso sin
WifiLock ni exención de batería), no reproducible en el simulador → falta el **diagnóstico de los dos teléfonos**. Después:
el aviso que solo sale como icono con la pantalla apagada (#89); el micrófono de calidad (loopback AEC de Chrome, investigado, #93),
el botón de descarga de foto/vídeo (#92); los medios de una sola vista (#94) — ✅ **fotos hechas en la 2795** («ver una vez», se borra al abrir; falta el vídeo de una vez); empezar la pantalla infinita / Stream (#95); el bug
del Wi-Fi→internet (#83, con ambas apps abiertas NO se reproduce, se mantiene en Wi-Fi); después el juego secreto (lluvia de
núcleos); y terminar la auditoría (H3, H4, M5, M6, F6–F9). El permiso de pantalla completa (#81) ya quedó hecho en la 2784.

## 0b. Hoja de ruta (opinión del 25-10, aceptada por el dueño)
Lo que más falta ya no es código nuevo, sino confirmar en el mundo real lo que existe. En orden de importancia:
1. **Confirmar en teléfonos** (3–4 distintos, uno barato o viejo) lo pendiente de §1, empezando por la 2773. Es lo que
   más fiabilidad da (y el índice: de 44 a ~65).
2. **Medir la batería**: 24 h con NEXO en segundo plano frente a WhatsApp, y recortar lo que sobre (el latido del Wi-Fi
   despierta al otro teléfono cada 4 s; búsquedas Bluetooth). Hoy no se sabe cuánto gasta.
3. **Muchos teléfonos a la vez**: todo se ha probado con 2–3; los núcleos son decenas. Simular 20 teléfonos virtuales
   (conexiones, búsquedas, Jump) y luego probar con 5–6 reales.
4. **Auditoría de seguridad externa** (plan del dueño, punto 19).
5. **Google Play**: target 36 (§3), política de privacidad, declarar los permisos (servicio en primer plano, micrófono,
   pantalla completa, batería), empresa y marca (`PLAN_NEGOCIO.md` §6–8).
6. **Núcleos y cobros**: perfil de negocio, cola de impresión de la papelería y "Cobros" sin licencia
   (`PLAN_NEGOCIO.md` §4–5, después de la consulta legal). Es lo que distingue a NEXO y lo que daría ingresos.
7. **iPhone**, después de un piloto que funcione en un núcleo.
8. **Frente a WhatsApp**: buscar en los chats, "Tu nombre" en Perfil (decisión, §6 punto 4), llamadas en grupo, estados.
- Técnico ya anotado: revisión 2 (`ROBUSTEZ.md` §6), meter en la batería las 18 pruebas de fuera, voz por un Bluetooth
  lento, AudioWorklet y DTX (§3), internet (relés y Tor) nunca probado en teléfonos.
- Decisiones del dueño: §4 y `PLAN_NEGOCIO.md` §8.
- **Semana 1 (26-10 → 1-11)**: lo del dueño primero (sus pruebas con la 2773); medir la batería; simulación de 20
  teléfonos; revisión 2, días 1–3 (avisos, grupos, seguridad).
- **Semana 2 (2-11 → 8-11)**: lo que salga de las pruebas; Google Play (target 36, permisos); diseño del perfil de
  negocio y de "Cobros".

## 0c. Auditoría de seguridad y robustez (ronda 2774): lo que queda
Informe completo, modelo de amenazas y plan: `nexo-private/seguridad/AUDITORIA.md`. En la 2774 se arreglaron 8 cosas (Wi-Fi: saludo
gigante, avalancha, archivo abortado, inundación de escaneo; JSON anidado que cerraba la app; intent de llamada
exportado; anuncio con ID mal formado; grupos que reescribían la lista y colaban claves) y la recuperación del WebView.
Queda, por prioridad (cada uno necesita un cambio de protocolo y probarse en los dos teléfonos del dueño):
1. ✅ **C1 ARREGLADO (grave, P0) en la 2777: confirmaciones (✓✓) ahora autenticadas.** Van firmadas con un MAC derivado
   del secreto de la pareja (`e2eAckTag`), también en modo cerrado: la app le pasa a la parte nativa una clave de firma
   por contacto (`setAckKeys`, en memoria del proceso, no a disco) y el Kotlin firma el ack del buzón igual. Una falsa
   (sin firma o con firma que no cuadra) se ignora, así que ya no para los reintentos ni hace perder un mensaje con ✓✓.
   Lo vigila `tests/sim/ackforge.js` (batería 52/52). ⚠️ Falta confirmarlo en los dos teléfonos del dueño.
2. **P0-1 ratchet: repetir (clave, IV)** al restaurar un estado viejo (copia, Fénix, pasar la cuenta sin apagar el
   teléfono viejo). Probar que nunca se repite y que el teléfono viejo deja de servir.
3. **H3 (media): tarjetas de contacto** fijan la clave de un contacto nuevo sin verificar. Marcarlas «de oídas»
   (pendientes) hasta el flujo normal de aceptación.
4. **H4 (media): Fénix** acepta la petición de recuperación sin autenticar. Exigir sesión E2E y mostrar solo la
   identidad verificada.
5. **Leves**: M5 (`ni`/`kx`/`nm` sin autenticar), M6 (`ss` sin autenticar), F6 (la radio renueva el wakelock/suena sin
   autenticar), F7 (FileProvider con rutas amplias), F8 (reservas de 40/512 MB de una vez), ~~F9 (`ws://` en claro)~~
   **HECHO en la 2788** (solo `wss://`; `ws://` solo a loopback), e IDs con `Math.random` (derivarlos de `getRandomValues`).
6. **Plan de pruebas «al límite»** (AUDITORIA.md §4): «VOPR de NEXO» (mundo determinista con fallos inyectados),
   fuzzing de medios (imagen/vídeo/Opus/VP8), GATT/BLE (MTU, muchas conexiones), y un modelo formal del protocolo.
   Ya hecho el primer tramo: fuzzing con semilla de los analizadores (Kotlin `ParserFuzzTest`) y pruebas de ataque de
   red y de grupos.

## Reglas para elegir el camino de envío (decididas por el dueño, 23-10-2026; revisadas el 24-10-2026, build 2761)
1. **Wi-Fi en el mismo router/módem: prioridad sobre todo** (seguro, rápido, no gasta datos) y **se mantiene, sin
   brincar**: no se deja por un pico ni por un corte breve (primero se intenta recuperar; **desde la 3023, dueño 12-11: «15 s
   son muchos… 5 s máximo»: el margen es el promedio medido de reconexión con ese contacto + 2 s, entre 2 y 5 s; sin Wi-Fi
   propio, 0 s; los textos nuevos ya van por el otro camino durante el margen desde la 3022**); solo si está muy mal
   un rato (~12 s seguidos). Se vuelve a él cuando lleva ~30 s bien. Una foto a medias no cambia de camino por un pico.
2. **Wi-Fi muy malo o caído → internet** (los dos en Wi-Fi). **Sin internet → Bluetooth** (y Jump si no hay alcance).
3. **Wi-Fi Direct**: para fotos, vídeos y archivos grandes cuando no hay Wi-Fi común ni internet, antes que Bluetooth.
4. **Con datos móviles / contacto lejano**: los textos y, desde la 2780 (nueva decisión del dueño: «las fotos/archivos
   siempre se pueden mandar»), **también las fotos y archivos medianos (~6 MB)** van por internet. Antes los archivos
   esperaban al Wi-Fi; ya no. **Desde la 2786** (informe del dueño: «que permita el envío de archivos grandes cuando hay
   internet; otra vez no mandó nada ni avisó si es por dimensiones») el tope por internet es **según el camino**: por los
   **relés** van los medianos (~6 MB; cientos de eventos pequeños saturan los relés públicos), pero por **Tor DIRECTO**
   (una conexión .onion entre los dos teléfonos, sin relés) van también los **grandes (~22 MB)**, como por Wi-Fi Direct.
   Los que no caben por internet (o >22 MB) esperan al Wi-Fi común, Wi-Fi Direct o Bluetooth cerca (hasta 1 GB). Clave:
   **nunca se queda sin mandar y sin avisar** — si un archivo no cabe por el camino de ahora, sale un aviso claro que dice
   el tope y la salida (activar Tor en Perfil, o el contacto en el mismo Wi-Fi / Wi-Fi Direct / cerca). Si algo no sale en
   30 s o falla, en la burbuja sale «Reintentar» y, al volver el internet/Wi-Fi, se reenvía solo.
5. **Ningún camino**: pendiente, intentando Bluetooth cada poco; sale por internet o Wi-Fi, lo que llegue primero.

## 0d. #87 — cómo lo hace la competencia (investigación 26-10; `docs/ENTREGA_CERRADA_INVESTIGACION.md`)
Pedida por el dueño ("no hay que inventar nada, ya existe"). Conclusión con fuentes: **no hay un tercer truco mágico.**
Para recibir con la app CERRADA solo hay dos caminos: **(A) un PUSH por servidor/puente** (FCM/APNs/UnifiedPush: alguien
con un servidor encendido conoce tu token y te "despierta"; es lo de WhatsApp/Signal-Play/Telegram) o **(B) una CONEXIÓN
VIVA** en el teléfono (servicio en primer plano + socket + exención de batería + WifiLock; es lo de Signal-sin-Google,
Briar, Pokey y **el NetBg de NEXO**). **NEXO ya va por (B), el correcto para un P2P sin servidores.** El #87 no es que
falte una pieza secreta: es que (B) todavía no sobrevive bien a Doze ni a los ahorradores de cada marca (Vivo/Xiaomi
matan la app; el dueño ya vio que con batería "Sin restricciones" las llamadas SÍ entran → el cuello es la salud del
servicio, no un push). **No hay un push de Nostr aprovechable** listo: los eventos de NEXO son a medida y doblemente
cifrados, ningún push-server genérico sabe que son "para ti"; tener push exigiría que ALGUIEN corra un puente
Nostr→FCM/UnifiedPush = un servidor (decisión del dueño; rompe en parte el "cero servidores"; iOS necesitaría APNs).
Límite honesto: **"exactamente como WhatsApp" (que suene tras horas dormido) necesita push (A)**; sin push, NEXO queda
como Briar/Signal-sin-Google (va con batería exenta y la app sin matar, pero es "lo mejor posible", no garantizado).
Plan sin servidor (orden de impacto), a cerrar con el diagnóstico de los dos teléfonos en 2785:
1. **Endurecer NetBg / modelo B** (ataca el #87): tipo de foreground service de Android 14, `START_STICKY` + reinicio en
   `onTaskRemoved` + `BOOT_COMPLETED`, websocket con reconexión/keepalive/re-auth NIP-42; guía de batería por marca.
2. **Llamada entrante con app cerrada SIN push** — ✅ **HECHO (2841, #130, informe del dueño 30-10)**: el relé ya traía
   la oferta con la marca `cl:1`, pero el clasificador de la app cerrada (`BgInbox.classify`) la PERDÍA en los dos
   caminos DIRIGIDOS (`to` = mi NEXO ID por internet/Jump/FCM, y troceada con `dt` = mi NEXO ID) → salía como aviso de
   TEXTO, no como la pantalla de llamada entrante que enciende el teléfono (el diagnóstico del que recibe mostró
   `NOTIFY_ONLY ... (msgId cs4...)`). Ahora los dos caminos propagan la marca → `what="call"` → `incomingCall`
   (CallStyle/#1, pantalla completa). Prueba Kotlin `BgInboxTest` ampliada. Lo confirma el dueño en los teléfonos. El
   emisor ya mantiene la oferta "caliente" (2837 + 2841: la llamada pide el «toque» FCM con su propio throttle, aparte
   del de textos, para despertar sí o sí). (Si NetBg está muerto, no suena — igual que Jami/SimpleX.)
   - ✅ **Ampliación 2849 (#130b, informe del dueño 31-10: «a pantalla apagada suena y llega una notificación como si fuera
     un mensaje; eso está mal»):** faltaba un camino. La 2841 arregló `BgInbox.classify` (oferta que llega como sobre
     `type:chat` con `cl:1`), pero la oferta que llega por el **buzón de los relés** (internet) la procesa `NetBg`, que **no
     pasa por `classify`**: solo leía el marcador `n` (msgId) del sobre y la sacaba con `MsgNotifier.message(...)` → aviso de
     mensaje, nunca `incomingCall`. Ahora la app marca el sobre de una oferta con `cl:1` (`net_link.js` `send`;
     `_isCallOffer`/`_newMsgId` reconocen `nexo_call/offer` y la invitación de grupo `nexo_gcall/invite`) y `NetBg` lo lee y
     la saca a pantalla completa (CallStyle), igual que por Bluetooth. **Contactos y grupos** (la invitación de grupo viaja
     igual). Paridad de la pantalla de grupo con la 1-a-1 (aviso nativo con la app viva en segundo plano, `groupcall_ui.js`);
     `BgInbox.classify` reconoce además, defensivo, la señal cruda `nexo_call`/`nexo_gcall`. Pruebas: `fcmwake.js` (el sobre
     de la oferta lleva `cl:1` de extremo a extremo y el del mensaje no), Kotlin `NetBgTest` (`cl:1`→llamada) y `BgInboxTest`.
     Batería 90/90. Lo confirma el dueño en los teléfonos (recordarle el permiso Android 14 «Llamadas a pantalla completa» +
     «Funcionar en segundo plano»; si NetBg/FCM no viven, no suena).
3. **Red de seguridad WorkManager (~15 min)**: si NetBg no vive, despertar, reconectar, bajar el buzón y avisar (sirve
   para mensajes en ≤15 min, no para llamadas).
4. (Opcional, decisión del dueño) **Fase 4**: montar/confiar un puente de push Nostr→FCM/UnifiedPush = lo único que daría
   "igual que WhatsApp" aun con el socket caído, pero es un servidor.
Siguiente paso real: el dueño instala la 2785 en los DOS teléfonos de prueba (batería "Sin restricciones") y manda el
diagnóstico con REGISTRO NATIVO; con eso se ve si el camino de internet (relé, modelo B, YA en 2785) entrega el texto
cerrado — en cuyo caso el #87 de mensajes ya está, y solo queda la llamada cerrada (punto 2).

## 1. Pendiente de pruebas del dueño en el teléfono
- **Qué APK probar (25-10)**: la 2773 (nightly-2773; la 2772 no salió) para todo. Desde la 2763 no hay pruebas completas en teléfonos:
  todo lo de abajo desde la 2765 está sin confirmar (salvo los informes de videollamada con la 2768 y del 25-10 con la
  2771, ver 2769 y la ronda 2772).
- **2773** (ronda 2772: informe del dueño del 25-10; actualizar los dos teléfonos): (1) **Pantalla apagada con Wi-Fi**: los dos en
  el mismo Wi-Fi, uno con la pantalla apagada 2–3 min; mandarle un texto y una foto: debe sonar el aviso sin encender
  la pantalla y en el que manda salir ✓✓ enseguida. Si no, en el que tenía la pantalla apagada: Perfil → "Avisos con
  la pantalla apagada" → todo en ✅ y, en el Vivo, "Abrir" en su fila (activar «Inicio automático» y «Alto consumo en
  segundo plano»), y repetir; si sigue, diagnóstico de los dos (líneas `[ENERGIA]`). (2) **Videollamada**: girar la
  cara a la derecha: en el otro teléfono se ve como en un espejo (igual que tu vista pequeña); la imagen se ve entera y
  no estirada; dos toques en la imagen la ponen a toda la pantalla (y otros dos la devuelven); con la cámara de detrás,
  sin espejo; Perfil → Videollamadas → quitar "Ver al otro como en un espejo" lo deja al derecho. (3) **Micrófono**:
  llamada con altavoz, uno habla 10 s y el otro calla: ¿se oye eco? Hablar los dos a la vez: ¿se cortan? Con cascos,
  igual. Mejor con los teléfonos en habitaciones distintas: juntos en la misma sala y con altavoz siempre hay eco entre
  ellos (en cualquier app). Diagnóstico de los dos (`[CALL] Al colgar: … filtros: …, cancelador de eco …`). (4)
  **Escaneo**: "Agregar" con la tablet y los dos teléfonos (el dueño no lo ha probado desde la 2765).
- **2771** (revisión, parte 4: interfaz): (1) "Agregar" (botón redondo): salen tus contactos y los teléfonos cerca;
  escribir en el buscador un nombre o parte del NEXO ID los filtra. (2) En la lista, ⋮ de un contacto → "Cambiar
  nombre": se abre su chat con el nombre listo para escribir; el nombre nuevo se queda. (3) Perfil: tus iniciales y
  "Tus contactos te ven como «…»". (4) Quitar el permiso del micrófono y grabar una nota de voz: el aviso dice "Permiso
  de micrófono denegado" y dónde darlo. Decir cualquier texto raro, cortado o en inglés que se vea.
- **2770** (llamadas con la pantalla bloqueada): (1) en una llamada de voz y en una videollamada, bloquear la pantalla
  con el botón 30 s y luego ir a otra app 30 s: el otro debe seguir oyendo todo el rato (diagnóstico: `en segundo plano:
  micrófono`); en la videollamada la imagen se para mientras (el otro ve tu foto) y vuelve al regresar a NEXO. (2) Con música o un vídeo sonando en otra app, hacer o recibir una llamada: se para y vuelve al colgar.
  (3) En una llamada con el teléfono en la oreja, cerrar NEXO (quitarla de recientes): al tapar el sensor ya no se apaga
  la pantalla y la música vuelve. (4) Recibir una llamada con NEXO abierto y el teléfono en silencio (no suena), en
  vibración (solo vibra) y normal (suena); y con NEXO en segundo plano: suena solo el aviso del sistema, una vez.
- **2769** (videollamada robusta; informe del dueño: el S24 a veces salía sin cámara, negro en el Vivo y no se le oía):
  (1) varias videollamadas Vivo ↔ S24 seguidas (colgar y volver a llamar enseguida; contestar con la app en segundo
  plano y con la pantalla bloqueada): imagen y voz en los dos. Si falla, sin apagar ni encender nada, decir qué se ve
  arriba (avisos amarillos) y pasar **Perfil → Copiar diagnóstico de los dos** (línea `[CALL] Micrófono: …`).
  (2) Dejar una videollamada 2–3 min sin tocar: la pantalla no se apaga. (3) Llamada de voz en la oreja: la pantalla se
  apaga al acercarla y vuelve al apartarla; el otro sigue oyendo. (4) Que el otro apague y encienda su cámara: sale su
  foto con "Cámara apagada" y luego vuelve la imagen. (5) Abrir la cámara del chat y, sin cerrarla, recibir una
  videollamada y contestar: imagen y voz.
- **2768** (revisión, parte 3: llamadas): (1) con la app del otro cerrada (quitada de recientes), llamarle y que toque
  "Rechazar": su teléfono suena una sola vez (antes volvía a sonar cada pocos segundos). (2) Con su app en segundo
  plano, "Rechazar" en el aviso: en el que llama sale "Rechazada" al momento. (3) Llamarse los dos a la vez: quedan en
  llamada. (4) Videollamada con el permiso de cámara quitado (Ajustes → Apps → NEXO → Permisos): sigue con voz. (5) En
  una videollamada, girar la cámara y colgar: se apaga la luz de la cámara. (6) Llamada por Wi-Fi y apagar el Wi-Fi de
  uno: la voz sigue por Bluetooth. (7) Llamada de 1–2 min con la pantalla apagada (el teléfono en la oreja, sin tocarlo):
  decir si el otro dejó de oír (riesgo de Android 11+; en el diagnóstico `[CALL]`, el micrófono a 0 %). Diagnóstico de
  los dos teléfonos.
- **2767** (revisión, parte 2: mensajes y archivos): con el otro teléfono lejos (o con su Bluetooth apagado), escribir
  varios textos cortos y largos y grabar una nota de voz; cerrar NEXO (quitarla de recientes) y volver a abrirla; acercar
  el otro teléfono: todo debe llegar una sola vez, legible, en el orden en que se escribió y como nota de voz (no
  "[adjunto]"); ninguna burbuja debe pasar a "!" al rato. Un vídeo o archivo grande por Bluetooth debe avanzar hasta el
  final aunque tarde más de 10 min.
- **2766** (revisión, parte 1): (1) dejar un chat abierto 1–2 min sin escribir y luego escribir: debe llegar al momento;
  en el diagnóstico no deben salir `sin respuesta a 2 pings` ni `Peer ready` cada ~30 s. (2) Repetir tablet → S24 con
  el Vivo cerca (archivo y llamada): solo el S24. (3) En el mismo Wi-Fi, mandar una foto elegida de la galería: debe ir
  por Wi-Fi (rápida). (4) BUSCAR: a los ~15 s el botón vuelve solo a BUSCAR. (5) Foto de perfil: Perfil → tocar el
  círculo → Cambiar foto; en el otro teléfono sale en la lista y en la llamada. (6) Con la pantalla apagada: un mensaje
  la enciende y una llamada suena a pantalla completa encima del bloqueo; Perfil → "Avisos con la pantalla apagada"
  todo en ✅ (con "Arreglar"). (7) Perfil → Internet: Tor con su dirección .onion (antes "sin dirección .onion").
- **2765** (la 2764 no salió): **repetir la prueba de la tablet → S24 con el Vivo cerca** (archivos y llamada: solo debe sonar/avisar el S24)
  y pasar el diagnóstico de los tres; en la tablet, "Agregar": deben salir los teléfonos cercanos con su nombre (aunque
  el otro no tenga "Agregar" abierto) y agregarse con "+"; con el teléfono girado, que no salga la barra gris a la izquierda; en un grupo, un vídeo (llega el HD a
  todos) y un archivo grande (con los demás en el mismo Wi-Fi).
- **2763** (la 2762 no llegó a salir): llamada y videollamada (que se oigan los dos; diagnóstico `[CALL]` de los dos
  teléfonos), pantalla de llamada nueva (girar cámara, imagen propia arrastrable), llamada entrante con tono y
  Contestar / Rechazar (también con la app cerrada), estilo NEXO en toda la app, avisos de grupo con su nombre,
  pasar la cuenta a un teléfono nuevo (mismo Wi-Fi).
- **2761**: fotos por Bluetooth entre los dos teléfonos (sin Wi-Fi ni internet), que el enlace no se rehaga cada ~30 s
  (diagnóstico de los dos: líneas `Enlace … desconectado` / `sin respuesta a 2 pings`), Wi-Fi sin brincar, avisos con
  la app en segundo plano en el Vivo (que congela la app) y con la app cerrada por Jump.
- 2718: chat (responder, reenviar, eliminar, copiar) y cámara nueva.
- 2720: los datos siguen tras actualizar; huella y bloqueo de capturas.
- 2725: fotos en las dos direcciones sin quedarse paradas.
- 2728: Wi-Fi normal y cambio de camino. **Informe del dueño: estando en Wi-Fi, al mandar una foto pasó a
  Bluetooth (los dos en el mismo router)** → corregido en la ronda 2730 (reglas del dueño; ver PROGRESO).
- 2730: Wi-Fi (seguir en Wi-Fi con la app en segundo plano y en cortes breves), QR del número de seguridad,
  aviso "Protección poscuántica activa", Jump con remitente oculto.
- Wi-Fi Direct: falta el diagnóstico con tiempos para acelerarlo.
- 2749: Tor nuevo (0.4.9.14) e internet en general (relés y Tor reales no se alcanzan desde el entorno de desarrollo).
- 2751/2752: notificaciones (permiso, una por chat, número en el icono, tocar abre el chat), contadores de no leídos,
  "leído" solo con la app a la vista, recibir por internet con la app en segundo plano.
- 2754: fotos, vídeo y PDF por Bluetooth en binario (deben llegar enteros y algo más rápido); y con un teléfono en la
  2752, que todo siga llegando.

## 2. Funciones nuevas
- **Llamadas de voz**: hechas en la 2758 (Bluetooth a alcance o mismo Wi-Fi / Wi-Fi Direct, Opus cifrado); con la app
  cerrada avisa "Llamada entrante" y botón de altavoz (2759); suena como una llamada del teléfono con Contestar /
  Rechazar (2763). Falta: probar en teléfonos (eco, volumen, Bluetooth con MTU pequeño).
- **Videollamadas**: hechas en la 2758 (mismo Wi-Fi). Falta: por Wi-Fi Direct (hoy su enlace es por transferencia,
  no continuo), probar en teléfonos. Cámara trasera: hecho (botón Girar, 2762).
- **Pagos**: investigación en `nexo-private/negocio/PAGOS_PROPUESTA.md` (regla de oro: lo que exige licencia es CUSTODIAR el dinero; si
  NEXO nunca toca fondos, es "mensajería de cobros" sin licencia). **Fase 1 HECHA en la 2787**: el adjunto **"Cobro"**
  en el menú (💵) — importe, moneda, concepto y "cómo te pagan" (alias/CBU, enlace/QR de Mercado Pago/PayPal, o
  efectivo); viaja cifrado como cualquier mensaje (Bluetooth/Wi-Fi/Jump/internet); tarjeta en el chat con "Copiar datos"
  y "Abrir enlace"; NEXO nunca toca el dinero (`src/ui/cobro.js`, prueba `tests/sim/cobro.js`). **Falta**: Fase 2 "un
  toque" con proveedor licenciado (Mercado Pago/PayPal, comercios) y, si el volumen lo justifica, "tipo PayPal" con un
  socio con licencia (NEXO como proveedor técnico). Marca: no "NEXO Pay". **Pendiente de limpieza antes de la tienda**:
  borrar el prototipo viejo y MUERTO de "payment/transfer" con firma inventada en `src/app/nexo_app.js` (sin UI que lo
  dispare hoy; no choca con el tipo nuevo 'cobro'). Asesoría legal del flujo (ver `PAGOS_PROPUESTA.md` §4) antes de la
  Fase 2.
- **Stream** (vídeos tipo TikTok + estados de contactos, gestos: tap arriba izq. vídeos, arriba der. estados, doble tap
  "me gusta", deslizar der→izq comentarios, izq→der volver): **SIN DECIDIR** (sí/no; solo cercanos o con servidor).
  **Propuesta en `nexo-private/negocio/STREAM_PROPUESTA.md`** (27-10): los 3 caminos (A solo-cercanos / B buzón de relés / C servidor);
  recomendación = empezar por **"Estados" entre contactos, E2E, 24 h** (sin servidor, un tipo de mensaje con caducidad,
  como el cobro); el feed público global necesitaría servidor (C). Falta que el dueño decida arquitectura y alcance.
- **Chats de grupo**: hechos en la 2758 (textos y adjuntos de hasta ~1 MB); HD de vídeo y archivos grandes (hasta
  1 GB) en grupos: hechos en la 2764. Nombre del grupo en el aviso con la app cerrada o congelada: hecho (2763).
- **Internet** (contactos lejos, Wi-Fi de módems distintos): hecho en la ronda 2739 con relés públicos Nostr y Tor
  (decisión del dueño 23-10, "2 y 3"; ver `docs/INTERNET.md`). Falta: confirmar en los teléfonos (los relés y Tor
  reales no se alcanzan desde el entorno de desarrollo); servidor propio si los relés públicos fallan o limitan.
  Recibir con la app en segundo plano: hecho en la 2751 (NetBg nativo).
- **iPhone**: plugin en Swift, cuenta Apple Developer (99 USD/año), Mac o runners macOS, iPhones para probar.
- **Núcleos** (universidad, papelería, cafetería…) y **caso papelería** (PDF → imprimir → pagar).
- **Fénix**: hecho en la ronda 2732 el respaldo de los mensajes de texto (fase 2). Falta: fotos, vídeos y archivos
  (mejor por Wi-Fi); pingeo por Jump (hoy solo con el contacto conectado).

## 3. Mejoras de lo que ya existe
- **Enlace Bluetooth «vivo pero atascado»** (2973, diagnóstico del dueño 09-11 12:15): un enlace MUDO (sin pong) ya se detecta y se
  rehace aunque haya una transferencia atascada encima (`zombiexfer.js`). Queda el caso intermedio: el otro contesta pings pero no
  confirma datos (su cola de escritura atascada, su JS saturado) → el flujo sigue con sus 8 reintentos de ventana y el siguiente
  pendiente vuelve a probar el mismo enlace. Idea: tras N flujos seguidos agotados sin un solo ACK por un enlace, marcarlo muerto
  (`_markBleDead`) para que el resolvedor salte a otro camino. Esperar al próximo diagnóstico del dueño para ver si pasa.
- **Archivo grande por Wi-Fi que se corta y vuelve a empezar de cero** (2975, diagnóstico del dueño 09-11 13:35): ya no lo corta la
  propia app por la ida y vuelta inflada por la carga (`lan.js` + `hasActiveTransferOn`) ni lo manda a Bluetooth al degradar (`relink` con
  `keepTooBig`). Queda lo de fondo: si el Wi-Fi se CAE de verdad a mitad de un archivo grande, el siguiente intento empieza desde el
  trozo 0 («llega otro intento: se empieza de nuevo» en la tablet). Reanudar desde el último trozo confirmado es un cambio de protocolo
  (el receptor guarda los trozos que ya tiene y lo dice en el saludo del flujo): va con la Fase E de la entrega offline, no antes.
- **Cuatro lecturas de disco de ~450 ms al volver al frente** (diagnósticos 16:01 y 21:58): RESUELTO el misterio. No es el reenvío de
  pendientes (el registro 2976 «se cargan N adjunto(s)» no aparece ahí): son las fotos HD del chat abierto (con NX1E50C95D) que
  `render.js` hidrata con `preferHd` al pintarlo (`_paintHydrated`), ~450 ms por foto grande, justo después de «openChat». Mejora
  posible: pintar con la previa y cargar el HD perezoso (al tocar o al entrar en pantalla).
- **Wi-Fi «sin comprobar: se cierra»** (diagnósticos 13:42 y 15:57, con la tablet y con el vivo, siempre a los 30 s): ✅ 2978. La
  comprobación la contesta el JS del otro; con su app dormida se espera hasta 3 min mientras el latido nativo lo dé por vivo y a los
  8 s se le manda un toque FCM (`lanverify.js`). Queda ver en teléfono si el toque despierta de verdad el WebView del otro (si el
  sistema lo tiene congelado, la alternativa es contestar la comprobación desde el nativo). También visto: la tablet cerró una
  conexión 11 ms después de aceptarla («cerrada: null») y la dirección guardada del vivo estaba vieja (ECONNREFUSED ×3 al puerto
  anterior): esperar su diagnóstico.
- **Archivos grandes** (pedido del dueño 24-10, un APK de 24 MB no salía): hecho en la 2756, hasta 1 GB por el mismo
  Wi-Fi o Wi-Fi Direct, a disco por trozos y con clave propia por archivo. Falta: reenviarlos, y por Bluetooth/Jump
  (demasiado lento) o internet (relés: no admiten archivos así).
- **Velocidad**: archivos en binario hecho (2754); L2CAP; Wi-Fi Direct más rápido; detectar y renegociar MTU
  pequeño (algunos teléfonos se quedan en 20 bytes por escritura).
- **Jump con más alcance**: hecho en la ronda 2731 (en el teléfono, por confirmar): Bluetooth de largo alcance (LE
  Coded PHY, ~4x distancia entre teléfonos que lo tengan; el diagnóstico dice `[JUMP] Largo alcance (LE Coded): sí/no`)
  y hasta 8 saltos (antes 4). Ya existía guardar y reenviar (el puente guarda hasta 24 h). Falta: Jump también por
  Wi-Fi; Jump con la app en segundo plano o cerrada.
- **Seguridad (resto de la fase 3)**: identificador Bluetooth rotativo hecho (2756). Hechos en la
  ronda 2730: remitente oculto a los puentes, poscuántico (ML-KEM) y QR del número de seguridad.
- **Compatibilidad (visto en la batería de la 2757)**: con un puente Jump en una build anterior a la 2755
  (`jump.js --bridge-build=builds/93dd9ad`), lo que el puente guarda tarda ~80 s en llegar al destino cuando vuelve
  (antes de la 2756, ~14 s; con el puente en la build actual, ~14 s). Pasa igual con el código de la 2756: no lo
  causan los cambios de la 2757. Causa sin confirmar (probablemente el ID rotativo: la build vieja no reconoce el
  código del destino y sus reintentos van al enlace anterior hasta que aborta y vuelve a empezar). Solo afecta si
  algún teléfono sigue en una build vieja.
- **Fiabilidad**: recibir por Bluetooth con la app cerrada hecho (2757; falta comprobar en teléfonos que Android no
  cierre el proceso); falta `@capacitor/app`.
  Hecho en la ronda 2744: fuera `NordicMeshService` del manifiesto, emojis y acentos (prueba en `e2e.js`; la vista
  previa partía emojis), nombres ya iban como texto en la lista.
- **Base estable nueva** (≥ 2725) cuando el dueño confirme.
- **Llamadas (de la investigación del 25-10, ronda 2772)**: pasar el micrófono a un AudioWorklet (hoy ScriptProcessor en
  el hilo de la interfaz: si se atasca, cortes de voz); DTX en Opus (no mandar voz en los silencios: batería y datos;
  hace falta que el que recibe rellene los huecos); avisar al otro de "estoy hablando" en cada paquete (mejor detección
  de los dos hablando a la vez); vídeo sin pasar por el lienzo (MediaStreamTrackProcessor: menos copias y batería);
  probar el codificador de vídeo por hardware en los dos teléfonos; calidad de vídeo según la conexión (240x320 a
  10 fps si va mal).
- **Batería con la pantalla apagada (2772)**: el latido del Wi-Fi (cada 4 s) despierta al otro teléfono aunque tenga la
  pantalla apagada; que el despierto mande menos latidos cuando el otro está en segundo plano (hace falta avisarlo sin
  romper las versiones anteriores).
- **Google Play (de la investigación del 25-10)**: desde el 31-08-2026 las apps nuevas y actualizaciones en Play deben
  apuntar a Android 16 (target 36; prórroga posible hasta el 1-11-2026); NEXO apunta a 34. Pasar a 36 antes de subir a
  Play (cambios de comportamiento que revisar). Además, desde 2027 Android exigirá desarrolladores verificados también
  para instalar APK fuera de Play (ya en Brasil, Indonesia, Singapur y Tailandia desde el 30-09-2026).

## 4. Decisiones pendientes del dueño
1. Stream: ¿sí o no? ¿solo cercanos o con servidor?
2. ~~Internet: punto de encuentro~~ — decidido el 23-10: relés públicos + Tor, sin servidor propio por ahora
   (ronda 2739). Queda abierto si más adelante se quiere un servidor propio.
3. Pagos: modelo y país. Propuesta en `nexo-private/negocio/PLAN_NEGOCIO.md` (25-10), con las decisiones de su §8: país, ¿código
   abierto?, empresa, nombre del módulo de pagos, precio de NEXO Plus.
4. iPhone: ¿cuenta de Apple?
5. ~~Identificador Bluetooth rotativo~~ — decidido el 24-10 ("empieza por el 4"): hecho en la ronda 2756 con la
   propuesta (ver §5 punto 4). La opción "Ayudar a la red" no hizo falta como interruptor: el código rotativo ya es
   la marca anónima de la red; queda pendiente decidir si se quiere un interruptor para no contestar a desconocidos
   (ver los límites en §5 punto 4).
6. Orden propuesto: lo que falle en sus pruebas → velocidad (binario, L2CAP) → llamadas de voz → Jump de más
   alcance → seguridad restante → grupos → videollamadas.
7. **"Rechazar" con la app cerrada** (revisión de llamadas, 2768): la parte nativa no tiene las claves (están en la
   app), así que no puede mandar nada cifrado. Opciones: (1) solo deja de sonar en este teléfono y el que llama ve "No
   contesta" a los 45 s; nada sale sin cifrar. (2) Aviso al momento sin cifrar: el que llama ve "Rechazada" enseguida,
   pero un teléfono cercano con un NEXO modificado podría hacer que sus llamadas salgan "Rechazada". (3) Aviso al
   momento firmado: con la app abierta, cada pareja de contactos se pasa (cifrada) una clave pequeña solo para estos
   avisos y la parte nativa la usa sin abrir la app; nadie lo puede falsificar y sirve también para que el aviso deje
   de sonar en cuanto el otro cuelga de verdad. Es más trabajo (una build más). Propuesta: la (3); mientras
   tanto, la 2768 va con la (1). **Decidir con el dueño.**
8. **Texto durante el margen de 15 s del Wi-Fi**: ver §6 punto 1 (propuesta: si el Bluetooth está listo, mandar los
   textos por él al momento). **Decidir con el dueño.**

## 5. Plan del dueño (23-10): completar lo que falta y mejorar los puntos débiles de la comparativa (sin iPhone)
De lo más simple a lo más complejo. Estado:
1. ✅ (2744) Limpieza: versiones reales en los registros, fuera `NordicMeshService`, tarjetas de pago escapadas.
2. ✅ (2744) Pruebas en cada build: trabajo `tests` en el workflow (Kotlin JVM + `tests/sim/ci.js`, 9 escenarios); si
   falla, no hay APK. Ya encontró un fallo real (Jump + internet, ver ronda 2744).
3. ✅ (2744) Emojis y acentos: llegan idénticos; la vista previa ya no parte emojis.
4. ✅ (2756) ID Bluetooth rotativo: en el aire, un código que cambia cada 15 min y que solo reconocen los contactos
   (sale de su clave pública); ni NEXO ID ni nombre del teléfono. El NEXO ID solo con "Agregar" abierto (5 min) o sin
   contactos todavía: **para agregarse cerca, los dos abren "Agregar"**. Jump y Fénix conectan de paso con los NEXO
   "anónimos" y saben quién es cada uno al conectar; quien busca camino manda los códigos del destino ('dk').
   Límites (honestos): quien se conecta a tu teléfono sí recibe tu NEXO ID (lo necesitan Jump y Fénix); el Wi-Fi
   local sigue usando la marca del día sacada del NEXO ID; Android cambia la dirección Bluetooth por su cuenta (no
   siempre a la vez que el código); una build anterior no reconoce el código (nosotros sí nos conectamos con ella).
5. ✅ (2749) AGP 9.4.0 / Gradle 9.6.0 / Kotlin 2.2.20 / compileSdk 37.1 y Tor 0.4.9.14 (targetSdk sigue en 34).
6. ✅ (2752) Dividir `main.js` (4.281 → 720 líneas) y `ble_interface.js` (3.732 → 847) en 30 módulos sin cambiar el
   código (`docs/ESTRUCTURA.md`). 7. ✅ (2754) Bluetooth sin base64: los trozos de datos de fotos, vídeos y archivos
   van en binario (−25 % de bytes por la radio, ~25–35 % más rápido en el simulador); solo con teléfonos que lo
   anuncian (`bf`), con builds anteriores sigue el JSON de siempre.
8. ✅ (2757) MTU pequeño: el Kotlin pedía el MTU y activaba las notificaciones a la vez (Android hace una operación
   GATT a la vez: a menudo se perdía el MTU y la conexión quedaba en 23 bytes); ahora en orden, con un reintento y
   `[MTU]` en el diagnóstico. Trozos por bytes reales (MTU − 3) y trozo mínimo 240 con MTU pequeño (foto con MTU 23:
   215 → ~95 s). 9. ✅ (2757) Fénix para fotos, notas de voz, previas de vídeo y archivos de hasta ~1 MB (fase 3).
   10. ✅ Jump por Wi-Fi: ya funcionaba (el enlace Wi-Fi es un vecino más); ahora probado (`jump.js --wifi-ab`).
11. ✅ (2751) Recibir por internet en segundo plano (NetBg nativo) + notificaciones del teléfono + número en el icono
   + contadores de no leídos por todas las vías (pedido del dueño 23-10). 12. ✅ (2757) Recibir por Bluetooth con la app
   cerrada: buzón nativo, ✓✓ al emisor y notificación; al abrir llega todo (`BgInbox.kt`). 13. L2CAP: fase 1 ✅
   (2758) archivos grandes por Bluetooth L2CAP sin Wi-Fi; fase 2: fotos, vídeo HD y archivos medianos por L2CAP.
14. Grupos ✅ (2758): textos, fotos, audio, ubicación y archivos de hasta ~1 MB; HD de vídeo y archivos grandes ✅
   (2764). 15. Varios dispositivos: decidido por el dueño el 24-10 → **opción A primero: pasar la cuenta a un teléfono nuevo**
   (QR en el nuevo, el viejo lo escanea y le pasa por Wi-Fi/L2CAP, cifrado, NEXO ID, claves, contactos, historial,
   fotos y grupos; el viejo se desactiva). La B (varios dispositivos activos a la vez) queda para más adelante.
   ✅ A hecha en la 2759 (Perfil → Cambiar de teléfono; mismo Wi-Fi). Falta: probar en teléfonos; sin Wi-Fi común. 16. Llamadas de voz ✅ (2758, fase 1: con el
   contacto cerca o en el mismo Wi-Fi; suena como una llamada del teléfono, también con la app cerrada: 2763). 17. Videollamadas ✅ (2758, mismo Wi-Fi).
- (Resuelto en la 2759: era la prueba) `fenix.js` a veces recuperaba 5 de 6 mensajes y 1 de 2 archivos.
18–20 (del dueño): pruebas reales con 3–4 teléfonos, auditoría externa, Play Store.


## 6. Revisión completa por partes (pedida por el dueño el 24-10)
**Revisión 1 cerrada el 25-10 (builds 2766–2771)**: registro, cifras y medición en `docs/ROBUSTEZ.md`; la revisión 2
sigue el calendario de ese documento (§6). Lo de abajo es el detalle de la revisión 1 y sus puntos débiles abiertos.
Orden: escaneo → agregar → conexión → mensajes cortos y largos y archivos → llamadas y videollamadas → interfaz; con
mejoras donde se vea la oportunidad. Método: cada fallo se reproduce en el simulador antes de corregirlo.
1. **Escaneo, agregar y conexión** — hecha en la 2766 (ver PROGRESO, "Ronda 2766"). Quedan puntos débiles, sin fallo
   visto todavía en las pruebas:
   - Varios enlaces con el mismo contacto a la vez (Android usa direcciones distintas) y conexiones de paso que no
     llegan a identificarse; en algunos sitios la identidad aún se deduce de la dirección.
   - Nativo: `disconnectDevice` solo cierra los enlaces en los que este teléfono es el cliente (si el otro es el
     cliente, el enlace sigue: no se usa `cancelConnection`). Señalado por la revisión, sin comprobar aún: la
     reconexión nativa necesita haberlo visto al escanear.
   - El "no soy yo" (`ni`) y las confirmaciones no van firmados (un teléfono cercano malicioso podría desviar o marcar
     ✓✓); el código rotativo se puede calcular con la clave pública (quien la tenga reconoce el código).
   - Android 8–11 necesita la ubicación activada para escanear y el nativo no lo comprueba: falta avisar si está
     apagada.
   - Wi-Fi: si se va el Wi-Fi, un texto escrito en el margen de 15 s (regla del dueño: no brincar) espera a que acabe
     y llega por Bluetooth a los ~15 s (desde la 2767 ya no sale "!" mientras tanto). Propuesta: si el Bluetooth está
     listo, mandar los textos por él al momento sin cambiar el camino (las fotos seguirían esperando al Wi-Fi).
     **Decidir con el dueño.**
2. **Mensajes y archivos** — hecha en la 2767 (ver PROGRESO, "Ronda 2767"): textos largos que se perdían mostrando
   "entregado", nota de voz como "[adjunto]", transferencias de más de 10 min cortadas, Wi-Fi caído a mitad de una foto
   con un Bluetooth lento, orden en el chat (también lo recibido con la app cerrada), reintento que pisaba la entrada
   pendiente. Quedan puntos débiles, sin fallo visto todavía en las pruebas:
   - Con la app cerrada, la parte nativa confirma ✓✓ en cuanto guarda el mensaje, antes de que la app lo descifre; si
     la app falla al arrancar, ese mensaje se pierde con ✓✓ en el otro.
   - Si el receptor perdió lo que llevaba (se reinició), pide de nuevo todos los trozos sin límite de ritmo (NACK).
   - El registro de envíos guarda el cifrado de hasta 50 transferencias en un solo archivo por contacto (riesgo de
     memoria con varios vídeos HD).
   - Si se perdió la confirmación final de un archivo, al reconectar se manda entero otra vez (el receptor solo
     recuerda 60 s lo recibido) y sale otra notificación.
3. **Llamadas y videollamadas** — hecha en la 2768 (ver PROGRESO, "Ronda 2768"): 14 fallos, arreglados 13, entre ellos
   el de seguridad (un teléfono cercano con un NEXO modificado podía hacerse pasar por un contacto en textos, archivos y
   llamadas). **2769** (informe del dueño: videollamada Vivo ↔ S24 a veces sin cámara, negra y sin voz): cámara y
   micrófono con reintentos y vigilante, codificadores y decodificadores que se rehacen, foto y motivo en vez de negro,
   avisos de los dos, sin micrófono la llamada sigue, pantalla encendida en llamada y sensor de proximidad (ver
   PROGRESO, "Ronda 2769"); falta el diagnóstico de una videollamada que falle para confirmar la causa.
   Queda: el punto 2 (voz por Bluetooth con MTU pequeño: "carril de voz" nativo y aviso "Bluetooth lento"; para el
   aviso no basta el MTU (con MTU 185 y sin Opus también hay 3,2 s de retraso): medir el retraso de la voz con la hora
   de envío en cada paquete y el mínimo de la llamada como base (así no dependen de que los relojes coincidan); solo
   afecta a teléfonos viejos: el Vivo y el S24, con Opus y MTU grande, ~66 ms);
   lo que solo se ve en el teléfono, sin probar aún: la pantalla encendida y el sensor de proximidad de la 2769; el
   micrófono con la pantalla bloqueada, el foco de audio y el tono según el modo del teléfono de la 2770; la decisión
   §4.7. Puntos débiles sin fallo visto todavía:
   - Con la app cerrada, si el que llama cuelga, el aviso sigue sonando hasta 45 s (lo arreglaría la opción (3) de §4.7).
   - Con la app cerrada, el aviso dice siempre "Llamada" (también en videollamada) y el nombre sale "NEXO" si el nativo no
     lo conoce.
   - La identidad de una conexión aún se deduce de lo que dice el paquete (el arreglo de la 2768 cubre lo que llega sin
     cifrar diciendo ser de un contacto; las confirmaciones y el `ni` siguen sin firmar, ver punto 1).
4. **Interfaz** — primera pasada en la 2771 (ver PROGRESO, "Ronda 2771"): "Agregar" con tus contactos y buscador,
   avisos rotos, textos sin tilde o en inglés, Perfil, "Cambiar nombre". Queda (decisión del dueño): "Tu nombre" en
   Perfil (hoy tus contactos ven el nombre Bluetooth del teléfono: "Galaxy S24", "vivo 1951"…).
Mejoras pendientes: la foto del contacto en sus notificaciones (como icono grande).


### Observación (12-11, diagnóstico S24 3021): puntero del buzón de archivos con miniatura grande — ✅ ARREGLADO en 3031 (`blobthumb.js`)
El puntero de un vídeo a un contacto ausente lleva la miniatura (~24 KB) y sale en trozos por el buzón; la ventana espera el ACK del contacto ausente («enlace caído: espero…» cada 30 s) y al volver la app se aborta y se re-publica. No se pierde (los trozos quedan en los relés), pero se re-suben ~24 KB por cada vuelta a la app. Idea: miniatura reducida en el puntero o ✓ al guardarse en el relé. No urgente.

## 📡 Bluetooth y Wi-Fi vistos en el diagnóstico del dueño 18-11 11:26–11:44 (build 3099) — para el siguiente bloque
- **Un texto largo (34 trozos) a Alex (nx10b6f4ac) tardó de 08:53 a 11:43 (2 h 50 min) por Bluetooth** (ventanas sin confirmar, «tiempo global», 8 reintentos una y otra vez) y llegó en 56 ms por Wi-Fi local (3 trozos de 8000) en cuanto la app de Alex arrancó (11:43:49). Con su app muerta el Bluetooth no confirma trozos. Idea: un texto largo con el otro sin app viva no debe insistir por Bluetooth (esperar Wi-Fi/internet), o partirse en menos trozos.
- **Dedup cierra el enlace donde va el texto largo** (11:43:39, `44c15d1bcd55`) y el flujo siguió escribiéndole 9 s al enlace cerrado hasta «Write fallo ~6 s: 20 trozos descartados» (11:43:48). Falta: al cerrar un enlace repetido, pasar el flujo en curso al enlace que queda (o no cerrar el que lleva un flujo de texto: hoy `busy` solo cuenta ARCHIVOS, `_hasActiveFileTransfer`). Reproducir en sim antes de tocar.
- **MTU 23** con el teléfono de Alex (11:43:05 y 11:43:46: «Bluetooth muy lento con este teléfono») entre reconexiones a 517.
- **Wi-Fi local:** 11:31:46 conectó en 0,9 s y mandó 2 archivos pequeños (43 KB en 1,9 s). Se cortó al volver el dueño de un congelado (11:43:00) y no volvió hasta que la app de Alex arrancó (11:43:48); se cortó otra vez a los 7 s (11:43:55, dos conexiones a la vez: «Socket closed») y se rindió a los 5 s. Falta ver por qué no reconecta después (sin más registro).
- **Wi-Fi Direct:** en ese rato no hubo ningún intento (solo «también lo tiene», que significa que el contacto lo soporta); se usa para archivos grandes (umbral ~150 KB) y nunca ha funcionado en teléfonos reales (ver arriba, «No se pudo crear el grupo (2)»). Con los dos en el mismo Wi-Fi se usa el Wi-Fi local.

## Vistos en los diagnósticos del 18-11 21:22 (Cari) y 21:27 (Yael) — a reproducir en tests/sim
- **Hipótesis «MTU 23»:** al reabrir la app el servidor GATT se detiene y reinicia con un enlace entrante aún abierto; ese enlace
  ya no sirve para enviar (escritura falla 6 s, mensaje descartado, MTU 23) hasta que se rehace. Encaja con el trabajo de
  PRIORIDAD 1 (Bluetooth en el servicio nativo: el servidor no debe reiniciarse al abrir la app).
- **Videollamada contestada desde el aviso:** cámara cortada a los 5 s y 63 s sin imagen propia (se mandó 2x2); la app no reintentó
  porque la página figuraba no visible aunque el nativo decía primer plano. Falta saber si la pantalla estaba bloqueada.
- **Retraso de 6,5 min en el ✓✓ de Yael por internet** con su app cerrada: sin causa (su registro empieza a las 21:23).
- **DESPERTADOR (prioridad, dueño 18-11):** en ningún diagnóstico recibido aparece «Despierta recibido» (Katy: registro completo de
  4 h sin él, con toques enviados). Comprobar el enviador (`nexo-wake…workers.dev`, del dueño: panel de Cloudflare / clave de
  Google) con la 3245, que anota la respuesta del enviador; y que NEXO vuelva sola tras reiniciar el teléfono en Honor/Xiaomi.
- **Avisos silenciados por el teléfono (dueño 19-11 00:14, Vivo Y03, build 3105):** el aviso de mensaje con la pantalla apagada
  sí salió (la pantalla se encendió) pero el Vivo lo puso en «Silenciadas»: Ajustes → NEXO → «Notificación silenciosa» ACTIVA,
  sin «Pantalla de bloqueo» ni «Emergente». Al apagar ese ajuste el aviso apareció al instante: causa confirmada (ajuste del Vivo,
  no de NEXO). Idea propuesta al dueño (pendiente de su sí): detectar que el sistema baja la importancia del canal «Mensajes» y
  mostrar «Tu teléfono silencia los avisos de NEXO» con botón al ajuste. Falta saber si Vivo lo trae activado por defecto en apps nuevas.
- **Adjunto pendiente que no se reenvía (diagnóstico auto 20-11 05:06, build 3116):** archivo de 25,9 MB a Giacomo (nx1a4471d8), 9,6 días ⏳. Al reenviar con el contacto en línea: «se cargan 1 adjunto(s) del disco» y a la vez «Adjunto pendiente sin sus datos (aún no se lee del teléfono): queda ⏳ y se reintenta» → sospecha de carrera (reenvía antes de que acabe la lectura del disco) y que el reintento no vuelve a disparar. Reproducir en tests/sim.
- **Enlace que sobrevive al reinicio (3.er caso, S24→Vivo 20-11 05:05 tras actualizar):** ~300 escrituras `status=201`, 6 s sin salir, mensaje descartado, re-ruteo, el enlace cae a los 30 s. Refuerza PRIORIDAD 1 (servidor/enlaces nativos no deben quedar a medias al reabrir la app).
- **Archivo grande por Wi-Fi local se reinicia de 0 cuando termina un envío por Wi-Fi Direct (diag 24-11 21:52, build 3150):** con varios archivos grandes al mismo contacto, cada vez que se cierra el grupo de Wi-Fi Direct se corta el enlace Wi-Fi local y el archivo de 23,5 MB vuelve a empezar (8 intentos seguidos). Ideas: no cerrar el grupo mientras otra transferencia a ese contacto use el mismo enlace; reanudar desde donde iba. Reproducir en tests/sim (dos envíos a la vez al mismo contacto).
- **Cierre nativo por Tor (4 en 2 días, S24):** SIGABRT «mutex destruido» en el hilo `tor` (tor_cond_wait). Revisar el orden de parar/arrancar Tor.
- **Wi-Fi Direct necesita el Wi-Fi encendido en el otro teléfono** (5 de 8 fallos): avisar al usuario o decidir antes por Bluetooth; hoy cae a Bluetooth solo (bien).
- **«Respuesta de sincronía … sin firma válida o sin pedirla» justo tras arrancar (2 teléfonos, 24-11):** sospecha de carrera al arrancar (la respuesta llega antes de registrar la petición); si es así, la resincronía tras reiniciar se pierde. Reproducir.

- **Videollamada 24-11 22:10 (diag S23 y S24, build 3150; revisado de nuevo con Opus) — para la próxima tanda:**
  1. **Actualizar en plena llamada la corta** (el S23 bajó e instaló la 3150 a los 3 min; a los 6 s de reiniciar volvió a llamar). No bajar ni abrir el instalador con llamada en curso; dejarlo para al colgar.
  2. **Arranque de la llamada en el S23:** llamada 1 (contestó desde el aviso) micrófono en silencio total ~5 s; llamada 2 (llamó él, app recién reiniciada) no se oía nada ~5-10 s («audio suspended», 0 salidas por «llamada»). Reanudar audio y micrófono en cuanto conecta.
  3. **Adjunto por internet atorado en 589/601 — CAUSA CONFIRMADA con el diag del vivo (22:27):** con la pantalla apagada la parte de la app que recibe archivos quedó congelada ~43 min; los 6 toques FCM (cada 3 min) solo arrancan el servicio y la escucha de mensajes (`NexoFcmService`: «Despierto: sin aviso»), que no recibe trozos de archivo, y nada despierta a la app. Arreglo: si hay un archivo a medias con ese contacto (o el toque lo indica), el toque debe despertar a la app entera (o la escucha nativa recibir/guardar los trozos). Y avisar al que envía («su teléfono no contesta»).
  3b. **Archivo grande con el Wi-Fi del otro apagado (capturas del dueño 21:40-21:50):** (a) la tarjeta dice «No se pudo enviar» y a la vez muestra ✓✓ azul (la ✓✓ es del aviso, no del archivo): en archivos grandes, las palomitas solo cuando llegó el archivo. (b) El aviso amarillo `wd_wifi_off_peer` dice «se envía por Bluetooth» pero el archivo grande no va por Bluetooth y falla: para archivos grandes decir «Pídele que encienda el Wi-Fi (no hace falta red); se manda solo al encenderlo» y dejar la tarjeta en «Esperando el Wi-Fi del otro», reintentando sola, en vez de «No se pudo enviar» (que lleva a mandarlo varias veces: el vivo recibió 6 copias). (c) El aviso rojo «demasiado grande para internet» es largo: con el otro cerca, decir lo mismo que (b).
  3c. **Diag S23 23:04:** arranque sin sonido confirmado por 3.ª vez (prioridad alta dentro de la llamada). Vídeo congelado ~6 s y voz ~3 s al recibir (23:03:11-20) a la vez que el Bluetooth con Katy se abría y cerraba cada 10-20 s: medir si el vaivén del Bluetooth estorba a la llamada; durante una llamada, frenar los reintentos de Bluetooth con un enlace que ya falló varias veces (los mensajes ya se re-rutean por internet).
  4. **Mensaje sin cifrar atribuido a la tablet (nx1e29ab2f) descartado** 21:44:53: ver qué era.
  5. Vídeo: 3 errores de decodificación en 3 min de la llamada 1 (con el adjunto subiendo a la vez) y 1 en 14 min de la llamada 2; se rehacen solos. Vigilar, no urgente.
  Descartado al revisar: la miniatura no reinicia nada; el despertador con Katy actuó bien (lo pendiente eran envíos automáticos, no mensajes); el volumen a 1 lo bajaron ellos por el eco.
  Sana: llamada de 824 s, voz 99,8 %, conexión directa en 0,7 s.

- **Videollamada: 3 fallos de pantalla que describió el dueño (25-11), para la próxima tanda (diagnósticos: la llamada en sí va bien):**
  1. **Zoom de dos dedos en videollamada normal agranda TODA la pantalla (botones incluidos):** es el zoom del WebView, no el de `calls_ui.js _pinchZoom` (ese solo va con la pantalla compartida del otro). Falta `touch-action` bloqueado en `#nexo-call-screen` (y/o no admitir el zoom del WebView ahí). Decidir con el dueño: nada, o zoom real sobre el vídeo del otro.
  2. **La ventanita del sistema (PiP) enseña Ajustes/Perfil apretados en vez de la llamada:** Perfil, Ajustes y otras 8 pantallas usan z-index 2147483646/7 y la llamada 2147483645 (calls_ui.js:179); con la llamada como mini flotante y Ajustes abierto, al entrar en PiP la ventanita enseña lo de encima. Arreglo: con `html.nx-pip` ocultar todo lo que no sea la llamada (`body>*:not(#nexo-call-screen){display:none}`) y subir la llamada por encima mientras dure la ventanita. Probar entrando en PiP desde Ajustes, Perfil, un chat y una hoja abierta.
  3. **Los botones de la llamada ya no vuelven al tocar la pantalla tras abrir/cerrar la ventanita varias veces** (solo reaparecen al volver a minimizar y reabrir): alguna marca (`nc-pipwin`, `nc-appmini`, `nc-hide`) queda mal puesta y `autoHide` no los muestra. Reproducir en tests/sim: PiP → app → mini flotante → pantalla completa → tocar; la tecla de «mostrar botones» debe quitar `nc-hide` siempre.
     DESCARTADO que sea el zoom (dueño 25-11: cuando no salen, la pantalla y el vídeo se ven de tamaño normal). El registro del S23 (22:09:08-22:09:30) muestra ~20 toques alternando «botones visibles/ocultos»: la marca `nc-hide` sí cambia, así que algo más los esconde con una regla forzada (candidatas: `nc-pipwin` o `html.nx-pip` que se quedan puestas, o la regla de ventana ≤ 300 px). Para la tanda: (a) al tocar, apuntar en el registro qué marcas tiene la pantalla y si la barra se ve de verdad (getComputedStyle); (b) autocorrección: fuera de la ventanita, si la barra debe verse y no se ve, quitar las marcas sobrantes y mandar diagnóstico «botones».
  **DECISIÓN DEL DUEÑO 25-11 (zoom y botones):** el zoom se QUEDA pero solo sobre la imagen del otro: de 1 a 4×, se mueve con el dedo sin salirse nunca de los bordes de la pantalla, y no cambia nada más. La barra de botones (colgar, micrófono, compartir pantalla…) va en una capa APARTE de la imagen: ni el tamaño ni los toques del vídeo la tocan. Bloquear el zoom de toda la pantalla (`touch-action` en la pantalla de la llamada). Propuesta mía a confirmar en la prueba: con zoom puesto, dos toques vuelven a tamaño normal; sin zoom, dos toques siguen cambiando entre «entera» y «toda la pantalla».
