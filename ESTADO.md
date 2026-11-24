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
- **APK EN CURSO (subida otra vez 23-11 ~20:20 México con lo de Play; la de 20:09 se canceló, CI ~85 min, aviso programado):** 3317 preparar archivo grande sin esperas, 3318 llamada en
  segundo plano sin bajar dos veces, 3319 targetSdk 36 + borde a borde + «atrás» por el despachador + aviso de 16 KB, 3320 tope de
  reenvíos del puente. MIRAR en el CI el paso «Librerías nativas con páginas de 16 KB» (¿Tor?).
- **24-11 (prueba del dueño, solo Bluetooth): 3321 PUENTE A INTERNET NATIVO** (`GwServe.kt`, la tablet dormida/cerrada presta su
  internet: antes solo la app) y **3322** (conexión de paso del Vivo cerrada «sin uso» aunque ya era el contacto). Van en la APK resubida
  24-11 ~23:40 México. El Vivo sigue en 3119: actualizarlo. Prueba: S24 sin Wi-Fi ni datos, tablet con Wi-Fi y app cerrada, S23 lejos.
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
