# 📌 ESTADO ACTUAL DE NEXO — LEER ESTO PRIMERO

> **Este archivo es el punto de encuentro entre el Claude de la compu (Claude Code) y el Claude del teléfono.**
> Quien entre —sea quien sea— lo PRIMERO que hace es leer este archivo para saber en qué punto está el proyecto.
> Vive en GitHub (rama `NEXOCHAT`), así que los dos lo pueden leer desde donde estén.

## ⭐ Regla del dueño (prioridad SIEMPRE)
**Funcional y robustez primero.** El error que aparece se resuelve **en el momento**, no se dejan cabos sueltos.
No preguntar «¿qué priorizo?» cuando hay un error o algo roto: se corrige. (Monetización/entretenimiento van después de que lo funcional esté firme.)

## 🔄 Cómo usar este archivo (la regla)
- **Claude de la compu (yo, Claude Code):** actualizo este archivo al terminar cada bloque de trabajo y lo subo a GitHub. Es lo primero que leo al empezar.
- **Claude del teléfono:** leé este archivo primero (pedí «traé la última versión de `ESTADO.md` de GitHub»). Si hacés algo nuevo:
  1. Anotalo en el apartado **«⚠️ Trabajo del teléfono sin subir»** de abajo.
  2. **Si podés escribir en GitHub:** commiteá tu trabajo a una rama (p. ej. `monetizacion-telefono`) y anotá acá el nombre de la rama. Así el de la compu lo trae.
  3. **Si solo podés leer GitHub:** avisale al dueño que el trabajo quedó en el teléfono, para que lo pegue en la compu. (Si no se sube a GitHub, el otro Claude NO lo puede ver.)
- **Dueño (Maurizio):** si trabajaste en el teléfono y quedó algo sin subir, decímelo en la compu y lo integro.

---

## Dónde estamos (actualizado: 2026-11-23 tarde, México)

### TRASPASO (empezar una sesión limpia desde aquí; MÁXIMO ~60 líneas: lo viejo pasa a `docs/historial/`)
- **Forma de trabajo:** CLAUDE.md «GASTO» (leer SOLO este bloque + 🔴 de `docs/AREAS.md`; lo demás con grep). Lo anterior, con todo el detalle de 3266–3283:
  `docs/historial/ESTADO_traspaso_hasta_2026-11-22c.md` (y `…-22b.md`, `…-22.md`). PRINCIPIO: NEXO = todos los caminos; nunca recortar caminos.
- **✅ APK 3119 PUBLICADA (22-11 17:41 México; CI en verde a la primera).** Lleva 3266–3282: bandeja de salida nativa por internet y Bluetooth (3268–3271),
  código rotativo en el nativo (3279), el servicio sin la app abre enlaces + despertador (3280), fotos/archivos ≤ 1 MB en la bandeja (3281), fase 4 de enlaces
  (3276), miniatura (3277, 3282), audio con otras apps (3278), Apariencia, fondos, Wi-Fi Direct por tiempo estimado. Sus novedades ya están en el historial.
- **EN NEXOCHAT DESPUÉS DE LA 3119 (todo con `[skip ci]`; va en la SIGUIENTE APK, una sola, al terminar lo funcional + estético):**
  - **3283** falso «enlace_abre_cierra» con «Enlace ?» (diagnóstico S24 22-11 14:56): `ble_native_events.js`, `noservice.js` caso 7.
  - **Ayudante «silencia» (COLA 22), JUNTADO:** tarjeta «tu teléfono silencia a NEXO» (canal de mensajes/llamadas apagado o sin sonido, No molestar) con botón
    al ajuste exacto: `SilencedPolicy.kt`, `PluginSilenced.kt`, `src/ui/silenced.js`, `silenciado.js`. Elegido lo discreto (una tarjeta al día; No molestar solo
    si lleva ≥ 30 min y cada 14 días). Falta probar en teléfono que lee bien los canales y que el botón abre el ajuste en Honor/Vivo/Motorola.
  - **Ayudante «play» (COLA 26), JUNTADA SOLO LA PARTE WEB:** interruptor de tienda `NEXO_STORE=1` (sin actualizador propio ni abrir APK recibidos):
    `store_flag.js`, `updater_tienda.js`. El Gradle (tipo `store`, firma de subida, versionCode) y el manifiesto de tienda siguen SOLO en la rama
    `ayudante-play` (aquí no se puede compilar: probarlos en un workflow aparte de tienda, nunca en el de la APK). Informe completo (targetSdk 36 con 13
    cambios, tabla de permisos, CI del AAB, lo que hace el dueño) en el PRIVADO: `negocio/PLAY_CODIGO_2026-11-22.md`.
  - **GRUPOS CON ADMINISTRACIÓN (G1–G9), JUNTADOS el 22-11 noche** tras la revisión de la sesión principal (5 fallos arreglados; prueba nueva
    `gruposfork.js`, 11 casos) y las decisiones del dueño: bloquear solo el creador · «solo admins agregan» en Colegas · cambiar modo/quitar admins solo
    el creador · al EXPULSADO el grupo le DESAPARECE (si lo vuelven a agregar, vuelve) · si sale el creador sin admins manda el MIEMBRO más antiguo ·
    se firma con la clave de identidad. Cada estado firmado lleva la huella del anterior (`p`); dos cambios cruzados acaban igual en todos
    (`gsBranchWins`); el creador «reafirma» el estado para quien no engancha. Archivos: `group_state.js`, `group_admin.js`, `group_panel.js`. Seguridad,
    en el PRIVADO (`seguridad/PARA_LA_AUDITORIA_FINAL.md`, 12–26; **el 20 es un fallo PREVIO y abierto, no de grupos, para la auditoría final**).
    Al CREAR (dueño 23-11): lo primero son DOS opciones, «Todos participan» o «Personalizado» (escribir / agregar / nombre y foto: todos o solo
    administradores, y «Admin» junto a cada elegido); lo mismo en Ajustes del grupo. Falta probarlo en teléfonos.
  - **REVISIÓN DE TAMAÑOS Y CÓDIGO SIN USO (23-11, pedida por el dueño):** 134.868 líneas en total (app 74.071: JS 51.734 + traducciones 5.695 +
    CSS/HTML 2.452 + Kotlin 14.190; pruebas 59.944; herramientas 853). Ninguno pasa de 1.000 líneas, pero 13 pasan de 900 y `ble_connections.js`
    está en 999: HAY QUE PARTIRLO antes del próximo cambio ahí (siguen `fenix.js` 986, `ble_relay.js` 979, `ble_ui.js` 973, `calls_ui.js` 972,
    `NexoBlePlugin.kt` 938). Sin uso: 26 funciones exportadas (~350 líneas; juegos, `_installHeaderGroupButton`…), 3 funciones Kotlin
    (`reconnectKnownDevices`, `cancelServerLinks`, `NetBg.outboxClear`) y 48 textos de 1.111. Se quitan en la revisión previa a la APK.
  - **3288 COLA 14, archivos MEDIANOS por el canal rápido del Bluetooth (L2CAP), 23-11:** antes solo los de más de ~2 MB iban por L2CAP; lo demás, en
    trozos a ~17 KB/s (2 MB = 2 min). Ahora desde ~45 KB, si los dos lo anuncian (`l2p` en el kx), va por el canal (`l2_fast.js`; nativo
    `l2PayloadHost/Send/Cancel` en `PluginFiles.kt`; enganchado en `ble_ack_files._sendFileL2OrJS`). Si falla, sigue en trozos como siempre y con ese contacto no se prueba en 10 min. `l2mediano.js`: 400 KB en 1,6 s (26 s en trozos). Falta medirlo en teléfonos.
    Wi-Fi Direct sigue yendo PRIMERO cuando puede (decisión del dueño 12-11): el canal rápido entra cuando Wi-Fi Direct no puede o falla
    (`_sendFileL2OrJS`). **3289 (dueño 23-11: «ok solo si me aseguras que es más rápido»):** el canal rápido pasa DELANTE de Wi-Fi Direct solo si
    las medidas de HOY en ese teléfono lo dan por más rápido con margen 1,2 (`l2BeatsWd`, `fasterThanWd`; camino nuevo «Bluetooth (canal rápido)»
    en las velocidades del diagnóstico). Sin medidas, Wi-Fi Direct primero. `l2mediano.js` tiene 7 casos. Batería de archivos/fotos/voz/vídeo: 149 de 150; la que falla aquí, `fotocalidad.js` (parte de internet), falla IGUAL con el
    código del inicio de la sesión: es del contenedor (Chromium no abre los relés del simulador), como `estadovideo.js`; la corre el CI.
  - **3287 Wi-Fi Direct «CANCELAR», 23-11:** quien ofrece un archivo y no logra mandarlo (no se une al grupo, se corta, se cansa de esperar) manda «wx»
    y el otro baja el grupo YA (antes lo esperaba 90 s, ocupado para todo lo demás): `wifi_direct.js` (`_cancelPeer`, `_onCancel`), nativo
    `wifiDirectCancel` (cierra el socket que esperaba). En `wdgrupo.js` el otro queda libre a los 4,5 s. Falta verlo en teléfonos.
  - **3286 COLA 23 («app cerrada + pantalla apagada a veces no suena»), 23-11:** sin fallo de la app en el código de avisos; de los casos
    apuntados, el del Vivo fue su ajuste «Notificación silenciosa» y la tablet avisó bien. Hecho: al publicar un aviso, el registro nativo dice
    «suena» o «NO suena: motivo» (canal apagado / sin sonido, «No molestar», teléfono en silencio o vibración, el sistema no lo publicó) con la
    pantalla encendida o apagada (`MsgNotifier.logAlert`, `SilencedPolicy.alertVerdict`, línea `[AVISO]` que el diagnóstico conserva). Si vuelve
    a pasar, el diagnóstico lo explica. PRUEBA DEL DUEÑO: app cerrada + pantalla apagada, que otro le escriba; si no suena, «Copiar diagnóstico».
  - **3284 MODO VAGÓN / MULTITUD (pendiente 2, parte de la app HECHA):** `multitud.js` puesta al día (+ `--b-dormido`). Con la fase 4, entre 200/500/1000 NEXO el
    contacto DESPIERTO con pendientes enlaza en 1,1–1,6 s; lag p95 22/27/50 ms. Hueco hallado: contacto DORMIDO entre 500 NEXO → 33–50 s. Causas: el gestor no
    sabía que tenía un mensaje esperando (ahora `_linkPendNow`: lo mandado en la sesión sin confirmar) y su conexión hacía cola tras intentos sin prisa (ahora
    «paso libre»: `_connYield`/`_linkGo` en `ble_linkmgr.js`). Queda en ~9 s enlace / ~13 s entrega. **23-11: multitud en el NATIVO, HECHO** (EDC_LIMITES cambios 4–5):
    `ScanBook.kt` (lo que el escaneo recuerda, con tope; avisos a la app EN TANDA cuando hay muchos —`onDevicesFound`, `_onScanBatch`—, un contacto
    con algo esperando sale al momento), sin logcat por anuncio, mapa NEXO ID ↔ dirección con tope y guardado cada 5 s, también en `BleSinApp`.
    Pruebas: `ScanBookTest` (9), `escaneotanda.js`. Tipos del plugin comprobados (`tests/kotlin-android`). FALTA: medirlo en teléfono entre mucha gente
    y el «modo multitud» de radio (cambio 6, necesita prueba de campo).
- **RAMAS DE AYUDANTES SIN JUNTAR:**
  - `ayudante-play`: lo del Gradle (ver arriba). `ayudante-silencia`: ya juntada.
  - **Icono final (logo 1b sin el bulto de la cola): SOLO en el privado `negocio/icono_final/`** (SVG, adaptativo, monocromo, aviso, tienda 512/1024,
    `antes_despues.png`). Enseñado al dueño el 22-11 18:00; NO se pone en la app hasta que lo apruebe (falta también rehacer la pantalla de arranque).
- **DECISIONES DEL DUEÑO PENDIENTES:** (1) icono final: ¿aprobado? (ojo: sobre fondo negro el icono pierde el borde; la capa monocroma pierde los 4 tramos);
  (2) grupos: contestado y hecho (también las dos opciones al crear, 23-11);
  (3) 31 vista previa de enlaces: DECIDIDA 23-11 (la baja quien recibe, por Tor; nunca una falsa; detalle en COLA 31); (4) ritmo de búsqueda por Bluetooth de lo ya entregado al buzón (hoy hasta 1 h); (5) Google Play: cuenta de
  desarrollador (tarda días), identificador de paquete (¡la APK de GitHub y la de Play no se pueden actualizar una sobre otra!), privacidad, 12 probadores;
  (6) Kinway: IMPI, dominios, redes; (7) EMPRESAS: DECIDIDO 23-11, plan DENTRO de la misma app (pasos y fechas en el PRIVADO `negocio/EMPRESAS_PROPUESTA_2026-11-23.md`);
  (8) Ajustes: HECHO 3290, «Avisos y vibración» + «Llamadas» = «Notificaciones» (sección `notif`); (8b) COLA 23: el aviso SONÓ en su prueba Vivo → S24 (app cerrada);
  (8c) INVITACIÓN: el enlace daba 404 (la página nunca se publicó) → 3290: `web/i.html` + rama `gh-pages` (copia), GitHub Pages ya la publica; falta que él la pruebe
  (logo y nombre: «al rato», se deja como está); (9) canal rápido antes que Wi-Fi Direct: DECIDIDO 23-11 («solo si es más rápido») y HECHO (3289: por medidas del día).
- **APK PUBLICADA 23-11 04:27: lleva el número 3121** (la 3120 no salió: falló la prueba vieja `binary.js`, que contaba trozos GATT y ahora esos archivos van por L2CAP; arreglada la prueba). CI en verde, el Kotlin nuevo compiló. Falta la prueba del dueño.
- **NEGOCIO (23-11, privado):** `negocio/EMPRESAS_DISENO_2026-11-23.md` (organización dentro de la app sobre el estado firmado de los grupos; pasos dic → mar-2027) y `PLAN.md` al día. Decide el dueño cuando toque: cobro fuera/dentro de Play (a confirmar política), capturas en grupos de trabajo, empresa constituida.
- **TANDA 1 = TODA LA SEGURIDAD (23-11, subida con CI: APK 3298).** Informe y lista de lo hecho en el PRIVADO `seguridad/AUDITORIA_FINAL_2026-11-23.md`
  §6–§8. Hecho: tanda corta (S-A2, T-D1, T-D2, G-K1, I-U1), las 17 decisiones del dueño salvo 14A (toque firmado: hay que publicar el worker
  de Cloudflare a mano → tanda 2) y 11B (con Empresas), y ~25 endurecimientos (grupos G-B1…G-O4; interfaz CSP sin unsafe-*, OpenType,
  versionCode = número de build, FLAG_SECURE con «ver una vez»/bloqueo, testigos de avisos; transportes PayloadNet, topes de la malla, relé
  ajeno solo para bajar, Tor siempre = todo por Tor, VPN fuera del Wi-Fi local). 3A medido: reto 25–50 ms, entrega 16,3 → 16,5 s.
  PRUEBAS DEL DUEÑO de esta APK: que la app arranque y el diagnóstico diga el número de build (CSP nueva); mensaje con la app del otro
  cerrada y sin internet (sello + reto); que alguien que no es contacto te escriba → «Solicitudes»; foto «ver una vez» → no deja capturar.
  Avisos publicados antes de esta APK: tocarlos abre la app pero no el chat (una sola vez).
- **TANDA 2 (siguiente sesión; la última, después solo pulido):** forma de trabajo del dueño 23-11: terminar la tanda, subir (CI ~85 min), y
  mientras compila avanzar la siguiente; CI en verde → subir lo siguiente; si falla, corregir SOLO ese fallo y subir. Agrupar lo más posible.
  Aviso programado: «Revisar CI de la APK 3298» a las 09:09 México (llega a esta sesión). Contenido de la tanda 2, en orden:
  (a) ✅ **HECHO 3299 (23-11, `[skip ci]`):** por internet un texto sale en UNA ventana (antes 8 + 2 trozos: el 2.º tramo esperaba una
  confirmación que no llegaba) y, sin confirmación, se vuelve a pedir a los relés lo reciente (`net.resync`, freno 15 s, solo textos).
  `textoatorado.js` (relés que pierden todo lo que le llega en vivo a quien envía): antes no llegaba; ahora 0,6 s y ✓✓ en 4,9 s. Original:
  **17 mensaje atorado en videollamada** (diag. 19-11 21:34/21:48, `docs/diagnosticos.json`): S23 con datos + ahorro de batería no oía la
  presencia del S24 por relés («oído hace 312–1014 s»), un texto de 9 trozos por internet dio «Assembly timeout» en el S24 y «Buzón no
  disponible: Abortado» en el S23. Reproducir en tests/sim con relés que pierden eventos en un sentido y un texto largo por internet; mirar
  si un texto así debería ir en UN evento (NET_TEXT_ONE) o reanudarse en vez de abortar. (b) ✅ **18 HECHO 3300:** la conexión directa «disconnected» > 4 s = cortada (antes se esperaba el «failed» de
  ~30 s; `call_p2p.js` DISC_MS); `cambiored.js --mudo`: 29 s → 8 s. (c) ✅ **25 HECHO 3301:** en grupo los decodificadores no avisaban al filtro del micrófono lo que sonaba (y el filtro
  tiraba los tramos cruzados): ahora sí (`onFar`/`farExt`, `call_voice_fx` con solapes). `voicefx.js` eco_grupo 3,7 → 18,1 dB. Falta oírlo en teléfonos. (d) **24** datos repetidos de los relés al abrir en frío (4,4 de 5,3 MB): son las copias
  de cada relé (`_subscribe` pide a TODOS desde `lastSeen`); NO recortar relés (principio del dueño): estudiar pedir lo atrasado completo
  a 2 relés y a los demás solo lo nuevo + rellenar huecos, solo si se demuestra que no se pierde nada. (e) **31** vista previa de enlaces
  (decidida: la baja quien recibe, por Tor). (f) 14A toque firmado (cambia `push-sender/cloudflare/worker.js`: el DUEÑO lo publica con
  wrangler; preguntarle antes). (g) N10 (bajo). (h) quitar código sin uso (26 funciones, 3 Kotlin, 48 textos) y partir lo > 900 líneas
  (`ble_connections.js` 999). (i) revisión final, NOVEDADES, una APK.
- **SIGUIENTE, sesión principal (Fable), en orden:** (6) llamadas 17/18 → (7) eco 25 + relés/batería 24 → revisión, UNA APK y
  auditoría final. Plan con modelo por actividad: `docs/COLA.md` al principio. Para targetSdk 36 hace falta teléfono con Android 15/16 (borde a borde, «atrás»).
- **PRUEBAS DEL DUEÑO con la 3119 (ya publicada):** (a) modo avión, escribir, bloquear, quitar modo avión SIN abrir NEXO → llega y ✓✓; (b) sin internet los dos,
  escribir lejos, bloquear, acercarse → llega sin abrir NEXO; (c) videollamada → miniatura ↔ app varias veces: sin chat en la ventanita, la mini responde;
  (c2) tras una videollamada y con una llamada de VOZ: en un chat, deslizar hacia arriba → segundo plano, SIN miniatura; (d) en miniatura YouTube con sonido:
  suenan las dos; (e) fase 4 con mucha gente cerca; (f) mandar una FOTO y bloquear en el acto (y otra en modo avión → bloquear → quitar modo avión): llega sin
  abrir NEXO; (g) escribir sin internet a alguien lejos, REINICIAR, desbloquear SIN abrir NEXO y acercarse (los dos bloqueados): llega. «Copiar diagnóstico» al
  terminar (buscar «Bandeja de salida», «[BT_SINAPP]», «[CALL] Miniatura», «[PIP]»).
- **Herramientas:** `CI_ONLY='a.js|b.js|texto' node ci.js builds/wip`; `tests/kotlin-android` (tipos) y `tests/kotlin` (JVM); `multitud.js` (Chromium, no va en el
  CI). Ayudantes: copia aparte con `git worktree add /home/user/wt/<n> -b ayudante-<n> NEXOCHAT` + enlaces a `tests/sim/node_modules` y `.deps`. `estadovideo.js`
  falla en este contenedor (HEVC) pero pasa en el CI. Sin avisos programados activos (el del CI de la 3119 ya no hace falta).
- **Diagnósticos:** solo los de la última build (ahora 3119); se apuntan en `docs/diagnosticos.json` (`node tests/sim/diag_stats.js`).
- **Nombres:** dueño = S24 (nx1n36c283) · Cari = S23 Ultra (nx1e50c95d) · Roberto = Motorola (nx0g6ef54e) · Austin = Honor (nx1905c1ee) · Marcos (nx01992876) ·
  Zhelowsky (nx0x4029e6) · Yael = Redmi (nx16386482) · Katy = Honor (nx126df3f4) · Vivo Y03 (nx09acdb61) · tablet A7 Lite (nx1e29ab2f).
- **Reglas vivas:** español, breve, horas de México; reproducir en `tests/sim` antes de arreglar; NOVEDADES solo en español; el Kotlin no se compila aquí (lo
  compila el CI, ~85 min): UNA subida por tanda; decisiones al dueño en forma A/B con lo que vive el usuario.

## ✅ Trabajo del teléfono — YA INTEGRADO
> Acá se anota lo que se hizo en el teléfono y se trajo al repo.

- **[✅ 04-11] Monetización + entretenimiento** — el dueño avanzó el plan en el teléfono; se integró a `nexo-private/negocio/MONETIZACION_Y_ENTRETENIMIENTO.md`. Tiene las fuentes de ingreso (Fundador 199 MXN, Negocios, etc.), el modo entretenimiento para el **15-nov** (sala de juegos: Conecta 4 + piedra-papel-tijera) y una **checklist de decisiones del dueño**.

---

## Documentos de referencia (el detalle largo)
- `docs/PROGRESO.md` — historial completo de builds.
- `docs/PENDIENTES.md` — todo lo que falta + reglas del dueño.
- `docs/ROBUSTEZ.md` — índice de robustez, mediciones y rutina diaria.
- `nexo-private/seguridad/AUDITORIA_FINAL_2026-11-23.md` — última auditoría completa (anterior: `AUDITORIA_COMPLETA_03-11.md`).
- `CLAUDE.md` — instrucciones del proyecto.
