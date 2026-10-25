# NEXO

App de mensajería P2P por Bluetooth LE (Capacitor 5 + plugin nativo Kotlin `plugins/nexo-ble`).
El dueño habla español: responder en español.

Antes de empezar, leer `docs/PROGRESO.md` (estado, historial de builds y pendientes),
`docs/PENDIENTES.md` (todo lo que falta, decisiones pendientes y las reglas del dueño para elegir el
camino de envío) y `docs/ROBUSTEZ.md` (registro de revisiones, índice de robustez y rutina diaria), y
actualizarlos al terminar cada bloque de trabajo.

- Rutina diaria (pedida por el dueño, `docs/ROBUSTEZ.md` §5): lo del dueño primero (sus pruebas y
  diagnósticos); luego el área del día del calendario de la revisión en curso; un punto débil abierto;
  medir (batería + `node tests/sim/robustez.js <salida de ci.js>`) y anotar la medición en el historial;
  al subir, dejar al dueño 3–5 pruebas cortas. Cada fallo nuevo entra en `tests/sim/robustez.json` con su
  prueba; cada prueba del dueño que confirma un área cambia su estado allí.

- Rama principal: `NEXOCHAT`; cada push genera una APK (`.github/workflows/build-apk.yml`).
  El dueño autorizó subir cambios directamente a `NEXOCHAT`.
- Base estable: build 2713, rama `base-estable-2713` (no modificarla; las anteriores, `base-estable-2699` y `base-estable-2698`). Cómo volver a ella: `docs/PROGRESO.md`.
- Diagnóstico de fallos en teléfonos reales: pedir al dueño Perfil → Copiar diagnóstico (ambos teléfonos).
- Para cambios que no deben generar APK (solo docs), añadir `[skip ci]` al mensaje del commit.
- Método obligatorio: reproducir el fallo en `tests/sim`, corregir, confirmar con la batería y solo
  entonces subir. No afirmar nada no comprobado. Respetar la estructura existente (NEXO ID, vault).
- No usar `npm run build:web` en el repo: borra `dist/`, que tiene archivos versionados.
  Para comprobar que compila, construir en una copia aparte.
