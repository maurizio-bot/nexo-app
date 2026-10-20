# NEXO

App de mensajería P2P por Bluetooth LE (Capacitor 5 + plugin nativo Kotlin `plugins/nexo-ble`).
El dueño habla español: responder en español.

Antes de empezar, leer `docs/PROGRESO.md` (estado, historial de builds y pendientes) y
actualizarlo al terminar cada bloque de trabajo.

- Rama principal: `NEXOCHAT`; cada push genera una APK (`.github/workflows/build-apk.yml`).
  El dueño autorizó subir cambios directamente a `NEXOCHAT`.
- Para cambios que no deben generar APK (solo docs), añadir `[skip ci]` al mensaje del commit.
- No usar `npm run build:web` en el repo: borra `dist/`, que tiene archivos versionados.
  Para comprobar que compila, construir en una copia aparte.
