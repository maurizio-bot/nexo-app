# NEXO

App de mensajería P2P por Bluetooth LE (Capacitor 5 + plugin nativo Kotlin `plugins/nexo-ble`).
El dueño habla español: responder en español.

Antes de empezar, leer `docs/PROGRESO.md` (estado, historial de builds y pendientes) y
actualizarlo al terminar cada bloque de trabajo.

- Rama principal: `NEXOCHAT`; cada push genera una APK (`.github/workflows/build-apk.yml`).
  El dueño autorizó subir cambios directamente a `NEXOCHAT`.
- Base estable: build 2713, rama `base-estable-2713` (no modificarla; las anteriores, `base-estable-2699` y `base-estable-2698`). Cómo volver a ella: `docs/PROGRESO.md`.
- Diagnóstico de fallos en teléfonos reales: pedir al dueño Perfil → Copiar diagnóstico (ambos teléfonos).
- Para cambios que no deben generar APK (solo docs), añadir `[skip ci]` al mensaje del commit.
- Método obligatorio: reproducir el fallo en `tests/sim`, corregir, confirmar con la batería y solo
  entonces subir. No afirmar nada no comprobado. Respetar la estructura existente (NEXO ID, vault).
- No usar `npm run build:web` en el repo: borra `dist/`, que tiene archivos versionados.
  Para comprobar que compila, construir en una copia aparte.
