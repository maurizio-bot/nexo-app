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
- **Forma de trabajo:** CLAUDE.md «GASTO» (leer SOLO este bloque + 🔴 de `docs/AREAS.md`; lo demás con grep). Todo el detalle de 3266–3311:
  `docs/historial/ESTADO_traspaso_hasta_2026-11-23.md` (y los anteriores). PRINCIPIO: NEXO = todos los caminos; nunca recortar caminos.
- **APK 3125 PUBLICADA (23-11 15:55 México; build 3314)** = 3309 (vista previa real por Tor, toque sellado 14A, «sr» firmado N10,
  limpieza) + 3310–3313. NOVEDADES: 3125 y 3123 ya en el historial (el bloque de la 3123 había quedado pegado y salió también en la
  descripción de la 3125); el de la próxima APK lleva texto provisional. Sin avisos programados activos.
- **APK 3127 PUBLICADA (23-11 19:57 México; nightly-3127) = puente nativo completo** (3315 paquetes Jump, 3315b «¿quién llega a X?»,
  3315c, 3316 textos largos y archivos por tubería; lo reenviado no se le pasa a la app dormida). Pruebas del dueño: S24 → Cari sin
  internet en ninguno, con el Vivo en medio con la app cerrada (y Cari lejos del S24): un texto, un texto largo y una foto deben llegar
  con ✓✓; lo mismo con el Vivo con la pantalla apagada un rato largo. Queda: JS vivo y nativo pueden reenviar los dos un paquete corto
  guardado (duplicado inofensivo).
- **24-11 tarde (dueño), HECHO SIN APK (commit [skip ci]):** (a) cabecera del chat: el símbolo del camino va ENTRE la foto y el nombre
  (`main.js` _viaSlot, `#chat-via-ico`) y sin «En línea»; debajo solo «señal débil»/«Conectando…». Jump y Bluetooth-internet (gw) con
  símbolo PROVISIONAL (tres puntos con saltos / ᛒ+globo; captura dada al dueño): FALTA que elija símbolo y NOMBRE de la conexión
  Bluetooth-internet (propuse «Internet prestado»). (b) La respuesta (y la edición) empezada se quedaba al cambiar de chat: ahora es solo
  de ese chat (`chat_actions._chatChanged`; `chatactions.js` resp_*, contraprueba HEAD falla).
- **SIGUIENTE (pedido del dueño 24-11): INVITACIÓN A GRUPO con Aceptar/Rechazar.** Hoy `groups.receive` mete al contacto en el grupo solo
  con el primer sobre. Plan: grupo nuevo (o me agregan) → `pending:true`, no sale en la lista, aviso «X te agregó a «Y»» en Solicitudes con
  Aceptar/Rechazar; lo que llegue mientras se guarda oculto y aparece al aceptar; Aceptar → mensaje de grupo «se unió»; Rechazar → salida
  firmada «rechazó la invitación». El nativo (NetBgSaved.groupNames) no debe avisar como grupo uno pendiente. Prueba nueva en tests/sim.
  Luego UNA APK con todo (bloqueo ya va en el CI de f73063ca; se sube otra vez con esto).
- **BLOQUEAR CONTACTO HECHO (24-11, SIN APK aún; va con el menú de la burbuja sin «Copiar»).** `src/ui/bloqueo.js` (núcleo: localStorage +
  copia cifrada `nexo_blocked.json`; `msgWhileBlocked`: lo que mandó mientras, no entra al desbloquear) y `bloqueo_ui.js` (hoja, barra del chat,
  lista en Ajustes → Seguridad → Privacidad). Filtros: entrada `ble_receive._handlePayload` y trozos `ble_ack_resume` (sin ✓✓); salida
  `ble_send.sendChatMessage` (BLOCKED) y `_contactIds` de estados/foto/datos; `net_link._hello` y `_bgConfig` (sin su clave nativa); llamadas
  `calls_ui._startCall`. Grupos siguen. Nativo: `MutedChats` (lista `blocked` en setMutedChats, cifrada) + `BgInbox.classify` → IGNORE;
  `NetBgHome.notifyMessage`; `BleSinApp.start` la carga. Pruebas: `tests/sim/bloqueo.js` (K1–K7, contraprueba NEXO_OLD_BLOCK=1 falla K5),
  JVM `BlockedContactsTest`, tipos Android OK. Límite honesto: de cerca por Bluetooth el enlace sigue (hace de puente) y él puede verme «cerca».
  NOVEDADES: bloque limpio (estaba pegado con los anteriores y la descripción de la APK salía con todo). Siguiente: subir la APK con esto.
- **APK 3148 PUBLICADA (24-11 12:50 México; nightly-3148) = 3327 + 3328 + 3329.** 3327 = ACUERDO EXPLÍCITO de enlaces repetidos (🔴 1, zombis S24↔Roberto/Alex/
  Zhelowsky): decide SOLO el de NEXO ID menor y se queda el enlace MÁS RECIENTE (el de después de volver la app); el mayor no cierra
  (salvo todos muertos o el menor > 3 min sin hacerlo); lo que el menor cerró hace < 10 min no gana por «nuevo» (sin vaivén); el chat
  abierto no frena al que decide; quitado el freno 3257 (el mayor ya puede abrir un cliente nuevo para salir de un servidor viejo).
  Pruebas: `bledup.js`, `dupserver.js` (rehecha) y vecinas OK. 3328 = con los relés limitando («rate-limited») el reenvío de pendientes
  espera 15 s → 2 min (`reenviolimite.js`). 3329 (dueño 24-11): franja del fijado: un toque salta y pasa al siguiente; pulsación larga = «Quitar» (`fijarmsg.js`). PRUEBA DEL DUEÑO: S24 con Roberto/Alex cerca, salir y volver a NEXO varias veces → sin
  «zombi» automático. Siguiente: (2) pruebas del dueño de la 3146; (3) logo A/B/C; (4) auditoría final (una).
- **APK 3146 PUBLICADA (24-11 10:25 México; nightly-3146; AAB nexo-tienda-1.0.0-3146 ✓, 16 KB OK)** = 3142 + 3324 Tor nunca se apaga
  (cierres SIGABRT del S24), 3325 enlace del puente no «muerto», 3326 sincronía firmada con varios números, pulido (esfera del audio con
  el color de la burbuja, menú del fijado arriba, menú «+» compacto con pestañita). NOMBRE: el dueño se queda con NEXO (compañeros);
  «NEXO Chat» se ve libre (falta IMPI). Zombi S24↔Roberto (desempate a MTU 23) → con el Bluetooth en el servicio nativo (🔴 1).
- **APK 3142 PUBLICADA (24-11 05:15 México; nightly-3142)** = 3317–3323 + Play (1.0.0, AAB «nexo-tienda-1.0.0-3142.aab» ✓, 16 KB OK)
  + fijados, hover, «Recibiendo…», notas de voz, menú «+», arranque con la imagen del dueño. Variantes de logo (A/B/C) dadas al dueño:
  falta que elija el ícono. Siguiente: auditoría final (una) tras sus pruebas.
- **24-11 (prueba del dueño, solo Bluetooth): 3321 PUENTE A INTERNET NATIVO** (`GwServe.kt`, la tablet dormida/cerrada presta su
  internet: antes solo la app) y **3322** (conexión de paso del Vivo cerrada «sin uso» aunque ya era el contacto). Van en la APK resubida
  24-11 ~23:40 México. **3323 RECIPROCIDAD** (decisión B del dueño): por el puente, textos a cualquiera; fotos/audios solo a quien
  me ayudó en 30 días (`gw_helpers.js`, libreta local; nativo vía netBgConfig gwHelp). El Vivo sigue en 3119: actualizarlo. Prueba: S24 sin Wi-Fi ni datos, tablet con Wi-Fi y app cerrada, S23 lejos.
- **Cierres nativos del S24 (18:24 y 21:26, SIGABRT):** causa aún desconocida; esta APK guarda en el diagnóstico el hilo que cayó y el mensaje
  del abort (tombstone). Con el siguiente cierre se ve la causa. A vigilar también: ✓✓ de Cari «sin firma válida» y un paquete de puente que reintenta horas.
- **También en esta APK (23-11 noche, pedidos del dueño):** quitar un fijado tocando la franja (también si se borró), «hover» pegado en la
  lista de contactos, «Recibiendo audio… N %» al llegar el aviso del buzón de archivos, notas de voz con barra/bolita para adelantar y
  marca de «sin escuchar» en las recibidas. Pruebas del dueño: recibir 3 audios y ver cuál falta; arrastrar la bolita; quitar un fijado borrado.
- **PLAY (hecho 23-11 noche, en esta APK):** versión 1.0.0, variante de tienda sin REQUEST_INSTALL_PACKAGES, paquete AAB firmado con la
  llave de subida (artefacto del CI «nexo-tienda-1.0.0-N.aab»). DUEÑO: poner en GitHub los secrets NEXO_UPLOAD_KEYSTORE_BASE64 y
  NEXO_UPLOAD_KEY_PASS (se los di en archivos; guardar copia fuera). Huella SHA-256 de la llave de subida: F2:C2:25:1A:…:47:C8:69:D7.
  Falta: 16 KB si el CI avisa, 5 idiomas al final, auditoría final tras la APK.
- **VAN EN LA 3125 (build 3314):** 3310 menú de la burbuja sin «Responder» (se responde
  deslizando) y «Editar» arriba; 3311 «Copiar» en la barra de la multiselección; 3312 (COLA 13) con enlace a MTU 23 los archivos desde ~6 KB
  van por el canal rápido L2CAP (`l2_fast.js`, `l2mediano.js` caso mtu23); 3313 (COLA 25) videollamada contestada desde el aviso: la cámara
  cortada se reabre aunque el WebView siga «oculto» si Android ya dice primer plano (`call_media.js`, `callmedia.js` 9b).
- **DUEÑO, PENDIENTE DE ÉL:** (1) publicar `worker.js` + secreto `WAKE_KEY` en Cloudflare (pasos: `push-sender/cloudflare/README.md` §14A;
  más adelante `ONLY_SEALED=1`); (2) icono final (solo en el privado `negocio/icono_final/`); (3) Google Play: cuenta, id de paquete,
  privacidad, 12 probadores, teléfono Android 15/16; (4) Kinway: IMPI, dominios, redes; (5) Wi-Fi Direct «grupo siempre montado» (A/B).
- **PRUEBAS DEL DUEÑO pendientes:** 3123 (arranque y nº de build, mensaje con la app del otro cerrada y sin internet, «Solicitudes», «ver una vez»
  sin captura, grupos/ruedita, S24 cerca de Alex sin «enlace repetido»); 3309 (vista previa de un contacto y de quien no lo es, aviso al abrir
  un dominio raro, que NEXO siga despertando con la app cerrada); tarjeta «silencia» en Honor/Vivo/Motorola; canal rápido L2CAP; WD «cancelar».
- **SIGUIENTE:** `docs/COLA.md` (ORDENADA 23-11 13:45; lo viejo en `docs/historial/COLA_hasta_2026-11-23.md`). Los fallos menores (A) ya
  estaban hechos (15, 27, 28, 34, 35, 36) o se hicieron hoy (13, 25 imagen propia). Queda: (1) LO GRANDE con Fable tras el reinicio semanal:
  Bluetooth entero en el servicio nativo = puente con la app dormida + que vuelva sola (🔴 1); (2) Wi-Fi Direct real; (3) llamadas: datos por
  relés; (4) Play: targetSdk 35/36; (5) auditoría final (una).
- **Herramientas:** `CI_ONLY='a.js|b.js|texto' node ci.js builds/wip`; `tests/kotlin-android` (tipos) y `tests/kotlin` (JVM); `multitud.js` (Chromium, no va en el
  CI). Ayudantes: copia aparte con `git worktree add /home/user/wt/<n> -b ayudante-<n> NEXOCHAT` + enlaces a `tests/sim/node_modules` y `.deps`. `estadovideo.js`
  falla en este contenedor (HEVC) pero pasa en el CI. Sin avisos programados activos (el del CI de la 3119 ya no hace falta).- **Nombres:** dueño = S24 (nx1n36c283) · Cari = S23 Ultra (nx1e50c95d) · Roberto = Motorola (nx0g6ef54e) · Austin = Honor (nx1905c1ee) · Marcos (nx01992876) ·
  Zhelowsky (nx0x4029e6) · Yael = Redmi (nx16386482) · Katy = Honor (nx126df3f4) · Vivo Y03 (nx09acdb61) · tablet A7 Lite (nx1e29ab2f).- **Reglas vivas:** español, breve, horas de México; reproducir en `tests/sim` antes de arreglar; NOVEDADES solo en español; el Kotlin no se compila aquí (lo
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
