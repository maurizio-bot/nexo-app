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

## Dónde estamos (actualizado: 2026-11-04)

- **Build actual:** **2907** — APK `nightly-2907` (Estados fase 2 COMPLETO: foto + audio + **video** + «me gusta»). Antes: `nightly-2906` (foto+audio+me gusta), `nightly-2905` (burbuja: el texto largo ya no se recorta), `nightly-2904` (notis del chat abierto + Fénix cede), `nightly-2903` (botón «Fondo de este chat»). Rama principal `NEXOCHAT` (cada push genera APK; `cancel-in-progress` → un push = un APK). Espejo: `claude/repo-file-access-9bwl60` (sincronizado con los commits de código; tiene una divergencia vieja: iOS Fase 0 que NEXOCHAT no tiene, y NEXOCHAT tiene el push-sender Cloudflare que el espejo no — reconciliar aparte, sin prisa).
- **Base estable de emergencia:** build **2882** (rama `base-estable-2882`).
- **Índice de robustez:** **54,8 / 110**. El freno NO es seguridad ni bugs: es la **validación en teléfonos (componente B = 15,9/35)** — eso solo lo sube el dueño probando.
- **App:** mensajería P2P por Bluetooth/Wi-Fi/Internet, serverless, E2E (Double Ratchet + poscuántico). Capacitor 5 + plugin Kotlin `plugins/nexo-ble`.

### Último trabajo hecho (04-11, pedidos del dueño en el teléfono)
- **Build 2907 — Estados fase 2 COMPLETO (foto + audio + video + «me gusta»):** al componer un estado se puede elegir 📷 foto (720px), grabar 🎤 audio (MediaRecorder, 30 s) o elegir 🎥 video (se re-codifica a previa 240p ~250 KB reusando `_makeVideoPreview`); una media por estado. Viajan como la fase 1: acción oculta cifrada E2E entre contactos, 24 h, con tope de tamaño; al recibir se rechaza lo que no es imagen/audio/video válido. «Me gusta» (acción `act:'sl'`) le llega al dueño del estado con cuenta. `setMyStatus(text,img,mime,aud,amime,vid,vmime)`. Prueba `estados.js` ampliada (foto/audio/video + me gusta). **Estados fase 2 queda cerrado.**
- **Build 2905 — burbuja: el texto largo ya no se recorta:** en pantallas anchas (Samsung ~412dp) el texto propio se cortaba en los bordes (`overflow:hidden` del `.msg-content` + `.message{width:fit-content}`). Fix: `.msg-text{display:block}` (envuelve). Verificado en Chromium (el jsdom no calcula layout).
- **Build 2904 — notificaciones del chat abierto + Fénix cede (las dos en este APK):**
  - *Notificaciones (notify.js):* «llegan avisos de un chat si estoy en ese chat abierto». Causa: al abrir/leer un chat a la vista solo se quitaba la notificación si la había puesto el JS; la que pone el NATIVO (respaldo con la app congelada, caso Samsung/Vivo) quedaba. Ahora se quita SIEMPRE + `syncNative()`. Prueba `unread.js` esc. 7.
  - *Fénix (fenix.js):* «envío de archivo grande + Fénix = crash». Regla del dueño: el usuario tiene prioridad; Fénix se para si hay transferencia del usuario y reanuda al quedar libre (gate en `_ownerTick` por `_transferActive()`). Confirma el 2.º diagnóstico (NX1N36C283, enlace MTU 23). Prueba `scanfenix.js` secc. 3.
- **Build 2903 — botón «Fondo de este chat»:** no salía por una carrera (se decidía por una clase del `<body>` que se agrega tarde); ahora se decide por el chat abierto. Prueba `fondo2.js`.
- **Build 2902 — videollamada en miniatura (PiP):** se ve solo el otro + volver a la app no reabre la llamada.
- **Build 2901 — «verdes» de la auditoría:** fuga de ubicación cerrada + durabilidad R2/R3/R4. (Auditoría completa en `docs/AUDITORIA_COMPLETA_03-11.md`.)
- Batería 112/112 verde en cada uno.

### En qué seguimos / próximo paso
- **CÁMARA — rediseño con estética NEXO** (pedido del dueño, repetido): la interfaz parece «iPhone 1», no pega con NEXO. Restyle a gradiente cian→violeta, oscuro, redondeado. Archivos: `index.html` (HTML de la cámara) + `src/styles/critical.css` (~19 reglas «camera»); `camera.js` NO se toca (solo estilo). Tarea anotada.
- **SEC-2 / agregar contacto seguro — NUEVO RUMBO (el dueño pidió algo fresco, no estilo BlackBerry PIN):** investigado (ver más abajo). Propuesta en capas: (1) TOFU + aviso fuerte si la clave cambia (instantáneo, sin fricción), (2) **verificar con pregunta-secreto estilo SMP** (sin códigos, a distancia — lo fresco), (3) **comparar 3–5 emojis en una llamada** (SAS, la voz es el canal auténtico), (4) **QR en persona**. Olvid prueba que un messenger serverless puede hacer esto. **Espera el OK del dueño para armarlo** (empezar por TOFU+aviso, después SMP).
- **Endurecer re-ruteo (opcional, del diagnóstico 04-11):** cuando el Bluetooth descarta un mensaje tras ~9 s de congestión (NexoBlePlugin.kt:1897, `processWriteQueue`), hoy el nivel de arriba lo recupera al vencer el ACK (~8 s). Se podría avisar al toque para re-rutear más rápido. No es un bug (no se pierde), es un endurecimiento. Espera decisión.
- **Entretenimiento 15-nov:** Conecta 4 + piedra-papel-tijera (retención). Candidato a arrancar.

> **Diagnóstico 04-11 (NX1N36C283) — veredicto:** teléfono SANO, sin crashes/errores. Los fixes del día funcionan en la vida real (Fénix cede ✅, backoff de `no_service` ✅, fondo compartido ✅). La línea «mensaje descartado entero (3 trozos)» NO es pérdida: es el BT soltando un enlace casi muerto (MTU 23) a propósito, y el vault/internet/Jump lo re-rutea.

### ✅ Resuelto hoy (04-11)
- Burbuja de texto que se recortaba (2905). Botón de fondo de chat (2903). Notis del chat abierto + Fénix cede (2904). **Estados fase 2 COMPLETO: foto+audio+video+me gusta (2906+2907).** Doc de monetización con el orden «funcional primero, cobrar después». Diagnóstico 04-11 revisado (teléfono sano). Investigado el rumbo nuevo de SEC-2.

### ⚠️ Pendiente de decisión del DUEÑO (no lo toco solo)
- **SEC-2** (MITM silencioso al agregar por ID) y **rollback del Double Ratchet** (P0-1): los 2 riesgos de seguridad reales; tocan aceptación de claves / estado del ratchet.
- **R1** (traer cuenta atómico), **monetización** (modelo de plata), **Stream** sí/no.
- **Validación en teléfonos** (component B): lo que más sube el índice.
- **Lanzamiento diciembre:** faltan las 2 patas — **entretenimiento** (pegar al usuario) y **monetización**.

---

## ✅ Trabajo del teléfono — YA INTEGRADO
> Acá se anota lo que se hizo en el teléfono y se trajo al repo.

- **[✅ 04-11] Monetización + entretenimiento** — el dueño avanzó el plan en el teléfono; se integró a `docs/MONETIZACION_Y_ENTRETENIMIENTO.md`. Tiene las fuentes de ingreso (Fundador 199 MXN, Negocios, etc.), el modo entretenimiento para el **15-nov** (sala de juegos: Conecta 4 + piedra-papel-tijera) y una **checklist de decisiones del dueño**.

---

## Documentos de referencia (el detalle largo)
- `docs/PROGRESO.md` — historial completo de builds.
- `docs/PENDIENTES.md` — todo lo que falta + reglas del dueño.
- `docs/ROBUSTEZ.md` — índice de robustez, mediciones y rutina diaria.
- `docs/AUDITORIA_COMPLETA_03-11.md` — última auditoría completa.
- `CLAUDE.md` — instrucciones del proyecto.
