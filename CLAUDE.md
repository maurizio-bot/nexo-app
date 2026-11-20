# NEXO

App de mensajería P2P por Bluetooth LE (Capacitor 5 + plugin nativo Kotlin `plugins/nexo-ble`).
El dueño habla español: responder en español.
**Horas siempre en hora de México** (Ciudad de México, UTC−6) al hablar con el dueño (16-11): nunca UTC ni otra zona; los
diagnósticos ya traen la hora local, y lo de GitHub o los avisos programados (en UTC) se convierte antes de decírselo.

**PRINCIPIO (dueño 20-11): NEXO = TODOS los caminos posibles para mantenerse comunicado** (Bluetooth, Wi-Fi, Wi-Fi Direct, internet, puente…).
WhatsApp es lo general, Signal la privacidad, Quick Share los archivos; NEXO es no quedarse sin camino. Nunca proponer ni hacer nada para
CERRAR o recortar caminos (ni «medir qué camino usan para quitar los que no se usan»): se mide si cada camino FUNCIONA para arreglarlo.
Wi-Fi Direct casi no se nota porque casi siempre hay Wi-Fi o datos; su caso es el transporte público y la multitud (vagón, EDC): debe
funcionar y por eso se revisa. Al plantear una decisión: decir A/B con lo que vive el usuario en cada una (frecuente / de vez en cuando /
una sola vez), qué prefiero yo y por qué; el usuario y que el mensaje llegue mandan sobre el ahorro.

**LO QUE EL DUEÑO REPORTA DE PRUEBAS REALES ES UN HECHO (dueño 20-11: «si yo te digo algo, tómalo como verdadero; no tiene sentido que yo mienta»):**
nunca cuestionarlo ni pedir «datos» para creerle (ej. batería/calor de una videollamada larga). Los diagnósticos sirven para EXPLICAR el porqué,
encontrar fallos y medir cuánto, no para validarlo a él. Si algo no cuadra con el diagnóstico, se dice como pregunta o contraste, sin dudar de su prueba.

**GASTO (dueño 20-11: su límite SEMANAL de uso es lo que frena; forma de trabajo «eficaz y eficiente»). Manda sobre lo de abajo:**
- **Al empezar:** leer SOLO `ESTADO.md` (bloque TRASPASO, ≤ 60 líneas) y la lista 🔴 de `docs/AREAS.md`. `PROGRESO.md`, `PENDIENTES.md`,
  `ROBUSTEZ.md`, el privado y `docs/historial/` NO se leen enteros: se busca con grep lo que haga falta. El privado se clona solo si la
  tarea lo necesita (negocio, seguridad).
- **Una sesión = un tema.** Al cerrarlo: TRASPASO al día, subir, y pedir sesión nueva (`/clear`). Nada de sesiones de un día entero.
- **Una APK por tanda:** cada subida a NEXOCHAT cuesta ~85 min de CI; juntar los cambios y subir una vez. La batería completa la corre el
  CI; aquí solo la prueba nueva y las cercanas al cambio.
- **Diagnósticos:** solo los de la última build; versiones viejas ni se abren. Un diagnóstico sin fallo de la app = una línea al dueño.
- **Sin reloj de ausencia** ni avisos programados salvo para revisar un CI (uno solo, a la hora en que debe terminar). Ayudantes en
  paralelo solo para trabajo que de verdad se reparte.
- **Modelo:** el grande (Fable/Opus) para protocolo, nativo, cifrado y depuración; lo mecánico (apuntar diagnósticos, NOVEDADES,
  documentos) no lo necesita: si el dueño está en un modelo ligero, eso se hace ahí.
- **Lo grande, justo después del reinicio semanal** del límite (el dueño lo ve en Ajustes → Uso); cerca del tope, solo lo barato.

**LO PRIMERO: leer `nexo-private/negocio/PLAN.md`** (repositorio PRIVADO `maurizio-bot/nexo-private`, desde el 15-11: conectarlo a la
sesión con add_repo y clonarlo en `/home/user/nexo-private`; ahí van el plan, lo de negocio y las auditorías de seguridad, que NO
deben volver al público) (plan maestro con etapas, fechas y la meta EDC México feb 2027; el dueño delega en Claude el orden y el ritmo) **y `ESTADO.md`** (en la raíz) — es el resumen vivo del estado y el punto de encuentro entre el
Claude de la compu y el Claude del teléfono. Mantenerlo actualizado al terminar cada bloque (es lo que lee el otro Claude).

Antes de empezar, leer `docs/PROGRESO.md` (estado, historial de builds y pendientes),
`docs/PENDIENTES.md` (todo lo que falta, decisiones pendientes y las reglas del dueño para elegir el
camino de envío) y `docs/ROBUSTEZ.md` (registro de revisiones, índice de robustez y rutina diaria), y
actualizarlos al terminar cada bloque de trabajo.

- **NUNCA esperar permiso para seguir (dueño 18-11: «no quiero volver a decirte que le sigas, tú sigue»):** al terminar algo,
  pasar SOLO al siguiente pendiente de la cola sin preguntar «¿sigo?» ni «cuando me digas». Preguntar solo lo que es del dueño
  (dinero, marca, publicar, datos de usuarios, cifrado/seguridad, irreversible) o una decisión de diseño que él debe tomar.
- **Desde el reinicio del domingo 22-11 (dueño 19-11):** trabajar TODOS los pendientes sin parar hasta terminarlos de forma robusta, con
  ayudantes en paralelo (Agent/Workflow autorizados por el dueño), y seguir en cualquier rato libre suyo sin que lo pida ni lo recuerde.
  Orden: auditoría de seguridad → Bluetooth en el servicio nativo → auditoría posterior → modo vagón → resto. Se acaba el modo ahorro.
- **Modo adelanto (dueño, 10-11):** cuando el dueño esté ocupado o dormido, avanzar solo con la cola de pulido y los pendientes
  que Claude decide, sin esperar; preguntar antes solo si es grande. Reglas y límites: `docs/COMO_TRABAJAMOS.md` §8. Léelo con
  `ESTADO.md` al empezar. **Reloj de ausencia:** al terminar cada respuesta, programar con `send_later` un aviso a 5 min; si llega y
  el dueño no escribió, empezar la cola (detalle en §8).
  **Regla de cierre por contexto (dueño 18-11, pocos tokens):** al llegar a ~30 % de la ventana de contexto (el dueño lo ve en la app;
  Claude lo estima por el largo de la plática), al terminar el tema en curso —nunca a la mitad— escribir el resumen en el bloque
  TRASPASO de `ESTADO.md` (lo pendiente, lo decidido, las pruebas en curso y los avisos programados; los diagnósticos largos van aparte,
  en `docs/diagnosticos.json`), avisar al dueño en una línea y pedirle abrir una sesión nueva. Sin esperar a que lo pida.
  Medirlo: `python3 docs/contexto_estimar.py` (18-11: 9 000 caracteres = 1 %; 30 % = 270 000 caracteres desde el último resumen; medido contra el 44-45 % que veía el dueño; se ajusta con el tiempo).
  **Higiene de contexto (§9):** mantener el bloque TRASPASO de `ESTADO.md` y sugerir `/compact` o `/clear` al cerrar un bloque.

- Rutina diaria (pedida por el dueño, `docs/ROBUSTEZ.md` §5): lo del dueño primero (sus pruebas y
  diagnósticos); luego el área del día del calendario de la revisión en curso; un punto débil abierto;
  medir (batería + `node tests/sim/robustez.js <salida de ci.js>`) y anotar la medición en el historial;
  al subir, dejar al dueño 3–5 pruebas cortas. Cada fallo nuevo entra en `tests/sim/robustez.json` con su
  prueba; cada prueba del dueño que confirma un área cambia su estado allí.

- Rama principal: `NEXOCHAT`; cada push genera una APK (`.github/workflows/build-apk.yml`).
  El dueño autorizó subir cambios directamente a `NEXOCHAT`.
- Base estable (actual): build **2882**, rama `base-estable-2882` (el dueño la guardó el 02-11 como base de emergencia tras probar nightly-2882 = commit `7a69bea9`: funcional —ConnectionService entrante+saliente por Telecom, llamada en el coche OK—; quedan detalles en curso de audio (volumen, foco/Spotify) y de envío de archivos por el diagnóstico del dueño). Anterior: build **2858**, rama `base-estable-2858` (31-10: llamada/videollamada de grupo «lo menos peor hasta ahora», el vídeo ya se ve). Probada a fondo para la ENTREGA con app cerrada + pantalla apagada ✓: build **2823**, rama `base-estable-2823` (dueño 28-10; no modificarla). Anteriores: `base-estable-2713`, `base-estable-2699`, `base-estable-2698`. Cómo volver a cualquiera: `docs/PROGRESO.md`.
- **Conteo de diagnósticos (dueño 19-11):** cada diagnóstico que manda el dueño se apunta en `docs/diagnosticos.json` (día y hora de México,
  NEXO ID, síntoma, categoría, causa) y `node tests/sim/diag_stats.js` da la estadística por día, categoría y causa (¿bajan?, ¿vuelven?).
- Diagnóstico de fallos en teléfonos reales: pedir al dueño Perfil → Copiar diagnóstico (ambos teléfonos).
- **Versiones viejas (dueño 14-11):** la app aún no está en la tienda; se arregla la ÚLTIMA versión. No dar peso a los teléfonos con
  versiones anteriores (sí o sí tendrán que actualizar) ni engordar la app con compatibilidad o avisos pensados para ellas.
- **Qué revisar de los diagnósticos (dueño 19-11):** lo que importa es que nada se pierda, que todo llegue y que sea robusto. Solo
  se investiga y se le cuenta al dueño lo que es **problema de la app** (en la última versión) o un **ajuste del teléfono** que la app
  debe detectar y explicarle al usuario para que lo arregle (ahorro de batería, avisos silenciados…). Versiones viejas y causas externas
  (memoria del teléfono, red, relés caídos…): se apuntan en `docs/diagnosticos.json` en silencio, SIN explicárselo al dueño.
- Para cambios que no deben generar APK (solo docs), añadir `[skip ci]` al mensaje del commit.
- **Novedades de cada APK (dueño 15-11):** antes de entregar una APK, escribir en `NOVEDADES.md` (bloque `<!-- APK -->`) lo nuevo,
  breve y para el usuario (formato de Google Play, ≤ 500 caracteres). **Dueño 17-11: mientras sigamos en desarrollo, SOLO en español**
  (los 5 idiomas —es, it, en, pt, fr— al acercarse la publicación; `novedades.js` e `idiomas5.js` I5 ya aceptan solo español desde la 3230). La app lo muestra
  junto al botón de actualizar; tras publicar, pasar el bloque al historial con su número.
- Método obligatorio: reproducir el fallo en `tests/sim`, corregir, confirmar con la batería y solo
  entonces subir. No afirmar nada no comprobado. Respetar la estructura existente (NEXO ID, vault).
- No usar `npm run build:web` en el repo: borra `dist/`, que tiene archivos versionados.
  Para comprobar que compila, construir en una copia aparte.
