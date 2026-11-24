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
- **EN CURSO (sesión 23-11 noche, tema: PUENTE NATIVO, COLA 1) — sin APK aún, se junta con el paso 2:** 3315 el nativo con la app
  dormida/cerrada REENVÍA los paquetes Jump para otros por el enlace del destino (sin custodia) y el destino devuelve su ✓✓ también por
  donde llegó; 3315b el nativo contesta «¿quién llega a X?» a sus contactos si tiene enlace con X (detalle en `docs/COLA.md` punto 1).
  Kotlin: `JumpNativeTest` 11/11, tipos Android OK; sim: 33 cercanas OK. Revisión del nativo HECHA (24-11 18:10 México): un
  arreglo (3315c: si el reenvío falla con el enlace ocupado, se guarda y sale cuando hable); el JS y el nativo pueden reenviar los dos mientras la
  app está en segundo plano pero viva (duplicado inofensivo: el destino descarta repetidos). APK SUBIDA (push sin [skip ci]); CI ~85 min. Pruebas del dueño para esa APK: S24 → Cari sin internet en ninguno de los dos, con el Vivo en medio con la app
  cerrada (y Cari lejos del S24): debe llegar y verse ✓✓; lo mismo con el Vivo con la pantalla apagada un rato largo.
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
