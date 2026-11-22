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

## Dónde estamos (actualizado: 2026-11-22 16:16 México)

### TRASPASO (empezar una sesión limpia desde aquí; MÁXIMO ~60 líneas: lo viejo pasa a `docs/historial/`)
- **Forma de trabajo:** CLAUDE.md «GASTO» (leer SOLO este bloque + 🔴 de `docs/AREAS.md`; lo demás con grep). Detalle de lo hecho del 20 al 22-11 (fases, 3254–3278):
  `docs/historial/ESTADO_traspaso_hasta_2026-11-22b.md` (grep por número). PRINCIPIO: NEXO = todos los caminos; nunca recortar caminos.
- **🚀 APK 3119 LANZADA (22-11 16:16 México, orden del dueño: «sube 3119 a ver cómo sale»):** commit «APK: …» SIN `[skip ci]`; el CI tarda ~85 min (listo ~17:45).
  Si el CI falla: mirar primero `estadovideo.js` (`hevc_sin_reproductor_roto`, falla también en este contenedor con builds viejas). Tras publicarla: pasar el bloque
  de NOVEDADES al historial con su número y archivar este bloque. Antes de lanzar se le sumaron los pendientes de abajo (todo con `[skip ci]`).
  Lleva ya: 3266–3273 (bandeja de salida nativa por internet y Bluetooth, el nativo abre enlaces, Wi-Fi sin internet, Wi-Fi Direct por tiempo estimado, Apariencia,
  fondos, medición), `_noNetSt` (el fallo que tumbó el CI de la 3118, NO publicada), 3274 QUITADO (era un error), 3275, **3276 fase 4** (+3277b «Agregar» con 9 NEXO
  cerca), **3277 miniatura** (call_pip.js: estado desde la verdad del nativo, sim `miniaturas.js`), **3278 audio** (solo una llamada TELEFÓNICA retiene la llamada
  NEXO; otra app con sonido no la pausa ni pierde el audio: `FocusPolicy.kt`, 7 JVM; `callOut` al diagnóstico). Pasadas aquí: 41 escenarios cercanos + 9 de muchos
  teléfonos/grupos, JVM, `kotlin-android`, `MainActivity` con stubs. Última PUBLICADA: **3117** (22-11 10:53 México).
  **REMATES DE LA FASE 3 (22-11 tarde, sesión nueva; pendiente 1 CERRADO):** **3279** el nativo no reconocía al contacto al buscarlo (comparaba el NEXO ID y
  el otro anuncia su código rotativo: en teléfonos reales la 3271 NUNCA abría el enlace; la sim no lo veía) → la app deja con la bandeja la clave de los
  códigos de quien tiene algo pendiente (`OutboxRid.kt`). **3280** `BleSinApp` (servicio sin la app) busca y abre el enlace (`SinAppLinks.kt`, cliente GATT
  mínimo) + DESPERTADOR (`OutboxWake.kt`: alarma inexacta para el próximo escaneo mientras algo no tenga otro camino; lo ya aceptado por un relé se busca con
  calma: 1, 2, 4, 8, 15 min… y cada hora tras ~1,5 h). **3281** fotos/notas de voz/archivos ≤ 1 MB en la bandeja: la app deja el archivo cifrado y partido en
  trozos firmados + su aviso; el nativo sube los trozos y solo con TODOS sale el aviso (20 s de margen por si la app sigue despierta; al volver la app pregunta
  al nativo antes de subir nada: `_blobNatTake`). De paso: `NOVEDADES.md` tenía un bloque repetido (arreglado). Pasado: 22 escenarios cercanos + estáticas,
  291 JVM, tipos `kotlin-android`. Sim nueva `bandejafoto.js` (contraprueba `--sin-archivos`); JVM `OutboxRidTest`, `SinAppDialTest`, `NetOutboxFilesTest`.
  Lo de la auditoría final, apuntado en el privado (puntos 8–11). Límites: > 1 MB, vídeo HD y Jump los sigue mandando la app; la foto por Bluetooth desde el
  nativo NO (solo su aviso, ya subidos los trozos); `BleSinApp` abriendo enlaces no tiene modelo en la sim (JVM + prueba del dueño g).
  **3282 MINIATURA SIN VIDEOLLAMADA (dueño 22-11, con la 3117: «en un chat deslizo hacia arriba y crea la miniatura»):** el gesto lo decide UNA marca del
  teléfono que podía quedarse puesta sin videollamada. Ahora dice la verdad (`call_pip.pipWanted()`, se corrige en los dos sentidos en cada cambio de
  llamada/foco/arranque; una llamada de VOZ nunca la deja puesta) y el nativo la quita al terminar el audio y no entra en miniatura sin llamada
  (`BleService.pipOnLeave`, `pipAutoEnter`). Reproducido con la build anterior (`miniaturas.js --nativo-viejo`: fase g FALLA) y pasa con el arreglo.
  OJO al lanzar: `estadovideo.js` falla AQUÍ en `hevc_sin_reproductor_roto` también con builds anteriores a esta sesión (no es de estos cambios; parece el
  Chromium de este contenedor con HEVC). En el CI de GitHub pasó con la 3117: si tumbara el CI de la 3119, mirar eso primero.
- **Fases del Bluetooth en el servicio:** 1 publicada (3113) · 2 publicada (3117) · 3 y 4 hechas y probadas en sim, van en la 3119. Lo más pesado de programar ya está.
- **PENDIENTES en orden (incluirlos en la 3119, dueño 22-11):** (1) HECHO (3279–3281); **SIGUIENTE →** (2) modo vagón / multitud (EDC): probar fase 4 con `multitud.js`; (3) COLA 23 entrega con app cerrada y pantalla apagada
  (a veces no suena); (4) llamadas: 17 mensaje atorado durante una videollamada, 18 hueco ~25 s al cambiar de red, 25 eco en grupo; (5) Wi-Fi Direct: «cancelar»
  (el otro queda ocupado ~90 s); (6) 14 archivos medianos por L2CAP; (7) 24 batería en segundo plano y datos repetidos de relés; (8) 22 nativo: avisar si el
  teléfono silencia NEXO (canales/No molestar); (9) grupos G1–G9 (`docs/COLA.md` §4b); (10) auditoría de seguridad final (UNA, solo al privado); (11) 26 Google Play.
  Del dueño: 31 A/B (vista previa con logo real en enlaces). Detalle de cada punto: `docs/COLA.md`.
- **PRUEBAS DEL DUEÑO con la 3119:** (a) modo avión, escribir, bloquear, quitar modo avión SIN abrir NEXO → llega y ✓✓; (b) sin internet los dos, escribir lejos,
  bloquear, acercarse → llega sin abrir NEXO; (c) videollamada → miniatura ↔ app varias veces, Ajustes y otras apps: sin chat en la ventanita, la mini responde;
  (d) en miniatura YouTube con sonido: suenan las dos, la imagen sigue; teclas = voz (volumen de llamada), multimedia = el vídeo; «Copiar diagnóstico» al terminar
  (buscar «[CALL] Salida de sonido», «[CALL] Miniatura», «LIFECYCLE»); (c2) tras una videollamada y también con una llamada de VOZ en curso: en un chat,
  deslizar hacia arriba → la app va a segundo plano, SIN miniatura («[PIP] marca … quitada»); (e) fase 4 con mucha gente cerca; (f) mandar una FOTO y bloquear el teléfono en el acto
  (y otra en modo avión → bloquear → quitar modo avión): llega sin abrir NEXO («Bandeja de salida: … trozo(s) ya están en los relés sin la app»); (g) escribir
  sin internet a alguien lejos, REINICIAR el teléfono, desbloquear SIN abrir NEXO y acercarse al otro (los dos bloqueados): llega («[BT_SINAPP] Bandeja de
  salida: hay mensajes pendientes … abre el enlace»). DECISIÓN tomada por Claude (el dueño puede cambiarla): lo que YA está en el buzón de internet se busca
  por Bluetooth con calma (hasta cada hora) para no gastar batería días con un contacto apagado; lo que no tiene otro camino, seguido y con despertador.
- **LOGO Y NOMBRE (solo en el privado `nexo-private/negocio/NOMBRE.md`):** ⭐ LOGO ELEGIDO (22-11 tarde, tras 8 rondas): la «1b» ORIGINAL de la ronda 7 (una
  burbuja cuyo contorno son 4 tramos de los colores del chat = un mensaje hecho de 4 caminos). Siguiente (cuando toque): icono final (adaptativo de Android + aviso +
  tienda 512 px) conservando su aspecto; solo quitar el bulto de la cola y enseñarle antes/después. NOMBRE: ⭐ «sigue con KINWAY» (dueño 22-11 tarde; nombre de
  trabajo: falta IMPI —KIN y KINGWAY, clases 9/38—, dominios y redes; lo consulta una persona; la app sigue diciendo NEXO hasta que él lo pida). Antes de la prueba cerrada (≤ 1-12): fijar el identificador de paquete (hoy `com.nexo.app`).
- **Herramientas:** `CI_ONLY='a.js|b.js|texto' node ci.js builds/wip` (varios con «|», por archivo si acaba en .js). `MainActivity` se compila con stubs mínimos de
  Capacitor contra `android-all-16-robolectric` (~/.gradle). Sin avisos programados activos.
- **Diagnósticos:** solo los de la última build (3117); se apuntan en `docs/diagnosticos.json` (`node tests/sim/diag_stats.js`). Abiertos de la app: mensaje atorado durante una
  videollamada (S23→S24 21:28), datos repetidos al abrir en frío, enlace repetido; costumbres del teléfono: quitar NEXO de recientes corta la recepción (Cari), Honor/Vivo congelan la app.
- **Nombres:** dueño = S24 (nx1n36c283) · Cari = S23 Ultra (nx1e50c95d) · Roberto = Motorola (nx0g6ef54e) · Austin = Honor (nx1905c1ee) · Marcos (nx01992876) · Zhelowsky (nx0x4029e6) ·
  Yael = Redmi (nx16386482) · Katy = Honor (nx126df3f4) · Vivo Y03 (nx09acdb61) · tablet A7 Lite (nx1e29ab2f).
- **Reglas vivas:** español, breve, horas de México; reproducir en `tests/sim` antes de arreglar; NOVEDADES solo en español; el Kotlin no se compila aquí (lo compila el CI, ~85 min):
  juntar cambios en UNA subida; decisiones al dueño en forma A/B con lo que vive el usuario.
- Historial anterior: `docs/historial/ESTADO_hasta_2026-11-19.md`, `ESTADO_traspaso_hasta_2026-11-22.md` y `…-22b.md`.

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
