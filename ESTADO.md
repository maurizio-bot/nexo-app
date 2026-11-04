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

- **Build actual:** **2904** — APK `nightly-2904` (trae DOS arreglos del dueño: notificaciones del chat abierto + Fénix cede al usuario; ver «Último trabajo»). Antes: `nightly-2903` (botón «Fondo de este chat»). Rama principal `NEXOCHAT` (cada push genera APK; `cancel-in-progress` → un push = un APK). Espejo: `claude/repo-file-access-9bwl60`.
- **Base estable de emergencia:** build **2882** (rama `base-estable-2882`).
- **Índice de robustez:** **54,8 / 110**. El freno NO es seguridad ni bugs: es la **validación en teléfonos (componente B = 15,9/35)** — eso solo lo sube el dueño probando.
- **App:** mensajería P2P por Bluetooth/Wi-Fi/Internet, serverless, E2E (Double Ratchet + poscuántico). Capacitor 5 + plugin Kotlin `plugins/nexo-ble`.

### Último trabajo hecho (04-11, pedidos del dueño en el teléfono)
- **Build 2904 — notificaciones del chat abierto + Fénix cede (las dos en este APK):**
  - *Notificaciones (notify.js):* «llegan avisos de un chat si estoy en ese chat abierto». Causa: al abrir/leer un chat a la vista solo se quitaba la notificación si la había puesto el JS; la que pone el NATIVO (respaldo con la app congelada, caso Samsung/Vivo) quedaba. Ahora se quita SIEMPRE + `syncNative()`. Prueba `unread.js` esc. 7.
  - *Fénix (fenix.js):* «envío de archivo grande + Fénix = crash». Regla del dueño: el usuario tiene prioridad; Fénix se para si hay transferencia del usuario y reanuda al quedar libre (gate en `_ownerTick` por `_transferActive()`). Confirma el 2.º diagnóstico (NX1N36C283, enlace MTU 23). Prueba `scanfenix.js` secc. 3.
- **Build 2903 — botón «Fondo de este chat»:** no salía por una carrera (se decidía por una clase del `<body>` que se agrega tarde); ahora se decide por el chat abierto. Prueba `fondo2.js`.
- **Build 2902 — videollamada en miniatura (PiP):** se ve solo el otro + volver a la app no reabre la llamada.
- **Build 2901 — «verdes» de la auditoría:** fuga de ubicación cerrada + durabilidad R2/R3/R4. (Auditoría completa en `docs/AUDITORIA_COMPLETA_03-11.md`.)
- Batería 112/112 verde en cada uno.

### En qué seguimos / próximo paso
- **Burbujas con adjunto (ubicación/foto): borde/relleno FINO** para que no tapen el texto (pedido del dueño 04-11, sin prisa). Tarea en curso.
- **Diagnóstico nuevo del dueño** (algo que «acaba de pasar»): revisar cuando lo mande.
- **Estados fase 2** (pedido del dueño): elegir foto/imagen/vídeo/audio y poder reaccionar («me gusta»). Hoy Estados = solo texto 24 h. Es feature, va con entretenimiento.
- Verde pendiente (producto): **buscador global + conecta-4** (`#6` del reporte) — espera decisión.

### ⚠️ Pendiente de decisión del DUEÑO (no lo toco solo)
- **SEC-2** (MITM silencioso al agregar por ID) y **rollback del Double Ratchet** (P0-1): los 2 riesgos de seguridad reales; tocan aceptación de claves / estado del ratchet.
- **R1** (traer cuenta atómico), **monetización** (modelo de plata), **Stream** sí/no.
- **Validación en teléfonos** (component B): lo que más sube el índice.
- **Lanzamiento diciembre:** faltan las 2 patas — **entretenimiento** (pegar al usuario) y **monetización**.

---

## ⚠️ Trabajo del teléfono SIN SUBIR (traer a GitHub)
> Acá se anota lo que se hizo en el teléfono y todavía no está en el repo. Cuando se integra, se borra de esta lista.

- **[PENDIENTE] Monetización** — el dueño avanzó una parte en el teléfono (un archivo aparte). **Aún NO está en GitHub**, así que el Claude de la compu no la ve. Para traerla: el dueño la pega en la compu, o el Claude del teléfono la commitea a una rama y la anota acá.

---

## Documentos de referencia (el detalle largo)
- `docs/PROGRESO.md` — historial completo de builds.
- `docs/PENDIENTES.md` — todo lo que falta + reglas del dueño.
- `docs/ROBUSTEZ.md` — índice de robustez, mediciones y rutina diaria.
- `docs/AUDITORIA_COMPLETA_03-11.md` — última auditoría completa.
- `CLAUDE.md` — instrucciones del proyecto.
