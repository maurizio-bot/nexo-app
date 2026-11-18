# NEXO

App de mensajería P2P por Bluetooth LE (Capacitor 5 + plugin nativo Kotlin `plugins/nexo-ble`).
El dueño habla español: responder en español.
**Horas siempre en hora de México** (Ciudad de México, UTC−6) al hablar con el dueño (16-11): nunca UTC ni otra zona; los
diagnósticos ya traen la hora local, y lo de GitHub o los avisos programados (en UTC) se convierte antes de decírselo.

**LO PRIMERO: leer `nexo-private/negocio/PLAN.md`** (repositorio PRIVADO `maurizio-bot/nexo-private`, desde el 15-11: conectarlo a la
sesión con add_repo y clonarlo en `/home/user/nexo-private`; ahí van el plan, lo de negocio y las auditorías de seguridad, que NO
deben volver al público) (plan maestro con etapas, fechas y la meta EDC México feb 2027; el dueño delega en Claude el orden y el ritmo) **y `ESTADO.md`** (en la raíz) — es el resumen vivo del estado y el punto de encuentro entre el
Claude de la compu y el Claude del teléfono. Mantenerlo actualizado al terminar cada bloque (es lo que lee el otro Claude).

Antes de empezar, leer `docs/PROGRESO.md` (estado, historial de builds y pendientes),
`docs/PENDIENTES.md` (todo lo que falta, decisiones pendientes y las reglas del dueño para elegir el
camino de envío) y `docs/ROBUSTEZ.md` (registro de revisiones, índice de robustez y rutina diaria), y
actualizarlos al terminar cada bloque de trabajo.

- **Modo adelanto (dueño, 10-11):** cuando el dueño esté ocupado o dormido, avanzar solo con la cola de pulido y los pendientes
  que Claude decide, sin esperar; preguntar antes solo si es grande. Reglas y límites: `docs/COMO_TRABAJAMOS.md` §8. Léelo con
  `ESTADO.md` al empezar. **Reloj de ausencia:** al terminar cada respuesta, programar con `send_later` un aviso a 5 min; si llega y
  el dueño no escribió, empezar la cola (detalle en §8).
  **Higiene de contexto (§9):** mantener el bloque TRASPASO de `ESTADO.md` y sugerir `/compact` o `/clear` al cerrar un bloque.

- Rutina diaria (pedida por el dueño, `docs/ROBUSTEZ.md` §5): lo del dueño primero (sus pruebas y
  diagnósticos); luego el área del día del calendario de la revisión en curso; un punto débil abierto;
  medir (batería + `node tests/sim/robustez.js <salida de ci.js>`) y anotar la medición en el historial;
  al subir, dejar al dueño 3–5 pruebas cortas. Cada fallo nuevo entra en `tests/sim/robustez.json` con su
  prueba; cada prueba del dueño que confirma un área cambia su estado allí.

- Rama principal: `NEXOCHAT`; cada push genera una APK (`.github/workflows/build-apk.yml`).
  El dueño autorizó subir cambios directamente a `NEXOCHAT`.
- Base estable (actual): build **2882**, rama `base-estable-2882` (el dueño la guardó el 02-11 como base de emergencia tras probar nightly-2882 = commit `7a69bea9`: funcional —ConnectionService entrante+saliente por Telecom, llamada en el coche OK—; quedan detalles en curso de audio (volumen, foco/Spotify) y de envío de archivos por el diagnóstico del dueño). Anterior: build **2858**, rama `base-estable-2858` (31-10: llamada/videollamada de grupo «lo menos peor hasta ahora», el vídeo ya se ve). Probada a fondo para la ENTREGA con app cerrada + pantalla apagada ✓: build **2823**, rama `base-estable-2823` (dueño 28-10; no modificarla). Anteriores: `base-estable-2713`, `base-estable-2699`, `base-estable-2698`. Cómo volver a cualquiera: `docs/PROGRESO.md`.
- Diagnóstico de fallos en teléfonos reales: pedir al dueño Perfil → Copiar diagnóstico (ambos teléfonos).
- **Versiones viejas (dueño 14-11):** la app aún no está en la tienda; se arregla la ÚLTIMA versión. No dar peso a los teléfonos con
  versiones anteriores (sí o sí tendrán que actualizar) ni engordar la app con compatibilidad o avisos pensados para ellas.
- Para cambios que no deben generar APK (solo docs), añadir `[skip ci]` al mensaje del commit.
- **Novedades de cada APK (dueño 15-11):** antes de entregar una APK, escribir en `NOVEDADES.md` (bloque `<!-- APK -->`) lo nuevo,
  breve y para el usuario (formato de Google Play, ≤ 500 caracteres). **Dueño 17-11: mientras sigamos en desarrollo, SOLO en español**
  (los 5 idiomas —es, it, en, pt, fr— al acercarse la publicación; al hacerlo, ajustar `novedades.js` e `idiomas5.js` I5, que hoy piden los 5). La app lo muestra
  junto al botón de actualizar; tras publicar, pasar el bloque al historial con su número.
- Método obligatorio: reproducir el fallo en `tests/sim`, corregir, confirmar con la batería y solo
  entonces subir. No afirmar nada no comprobado. Respetar la estructura existente (NEXO ID, vault).
- No usar `npm run build:web` en el repo: borra `dist/`, que tiene archivos versionados.
  Para comprobar que compila, construir en una copia aparte.
