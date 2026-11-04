# 📌 ESTADO ACTUAL DE NEXO — LEER ESTO PRIMERO

> **Este archivo es el punto de encuentro entre el Claude de la compu (Claude Code) y el Claude del teléfono.**
> Quien entre —sea quien sea— lo PRIMERO que hace es leer este archivo para saber en qué punto está el proyecto.
> Vive en GitHub (rama `NEXOCHAT`), así que los dos lo pueden leer desde donde estén.

## 🔄 Cómo usar este archivo (la regla)
- **Claude de la compu (yo, Claude Code):** actualizo este archivo al terminar cada bloque de trabajo y lo subo a GitHub. Es lo primero que leo al empezar.
- **Claude del teléfono:** leé este archivo primero (pedí «traé la última versión de `ESTADO.md` de GitHub»). Si hacés algo nuevo:
  1. Anotalo en el apartado **«⚠️ Trabajo del teléfono sin subir»** de abajo.
  2. **Si podés escribir en GitHub:** commiteá tu trabajo a una rama (p. ej. `monetizacion-telefono`) y anotá acá el nombre de la rama. Así el de la compu lo trae.
  3. **Si solo podés leer GitHub:** avisale al dueño que el trabajo quedó en el teléfono, para que lo pegue en la compu. (Si no se sube a GitHub, el otro Claude NO lo puede ver.)
- **Dueño (Maurizio):** si trabajaste en el teléfono y quedó algo sin subir, decímelo en la compu y lo integro.

---

## Dónde estamos (actualizado: 2026-11-04)

- **Build actual:** **2901** — APK `nightly-2901` ✅ verde. Rama principal `NEXOCHAT` (cada push genera APK). Espejo: `claude/repo-file-access-9bwl60`.
- **Base estable de emergencia:** build **2882** (rama `base-estable-2882`).
- **Índice de robustez:** **54,8 / 110**. El freno NO es seguridad ni bugs: es la **validación en teléfonos (componente B = 15,9/35)** — eso solo lo sube el dueño probando.
- **App:** mensajería P2P por Bluetooth/Wi-Fi/Internet, serverless, E2E (Double Ratchet + poscuántico). Capacitor 5 + plugin Kotlin `plugins/nexo-ble`.

### Último trabajo hecho
- **Auditoría completa + pruebas masivas** (reporte en `docs/AUDITORIA_COMPLETA_03-11.md`): batería 111/111, Kotlin OK, VOPR 5/5, navegador voz/vídeo OK.
- **Build 2901 — «verdes» de la auditoría:** (1) cerrada la fuga de ubicación a un mapa de terceros (privacidad), (2) R2 el vault avisa+reintenta si falla una escritura, (3) R3 los adjuntos se vuelcan al 2.º plano, (4) R4 se cierran los `bigWriters` abandonados, (5) corregido un claim de AAD en `AUDITORIA.md`.

### En qué seguimos / próximo paso
- Traer el **trabajo de monetización que el dueño hizo en el teléfono** (ver apartado de abajo).
- Verde pendiente (producto): **buscador global + conecta-4** (`#6` del reporte) — espera decisión.

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
