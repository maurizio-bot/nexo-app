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

## Dónde estamos (actualizado: 2026-11-22 22:07 México)

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
  (6) Kinway: IMPI, dominios, redes.
- **SIGUIENTE, sesión principal (Fable), en orden:** (4) Wi-Fi Direct «cancelar» → (5) L2CAP → (6) llamadas 17/18 → (7) eco 25 + relés/batería 24 → revisión, UNA APK y
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
- `nexo-private/seguridad/AUDITORIA_COMPLETA_03-11.md` — última auditoría completa.
- `CLAUDE.md` — instrucciones del proyecto.
