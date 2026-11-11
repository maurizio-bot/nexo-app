# Investigación: bucle de reinicios al enviar un APK de 25 MB (11-11-2026) — documento de TRASPASO

**Para quién es:** la sesión que va a investigar el fondo del problema con más razonamiento (el dueño pasará a un modelo/esfuerzo mayor).
Léelo completo ANTES de proponer nada. Está escrito para no perder nada de lo que se sabe ni de lo que NO se sabe.
Escrito con el modelo rápido (Sonnet 5.5), así que todo lo marcado **[HIPÓTESIS]** hay que comprobarlo, no darlo por hecho.

**Datos crudos (privados, NO están en el repositorio público):** carpeta local `diagnosticos_crudos/` del contenedor (50 diagnósticos
tal cual los pegó el dueño, 10-25 a 11-11; `INDICE.md`; y `testimonio_dueno_11-11.txt` con sus mensajes textuales). Se extrajeron
del registro de la sesión `/root/.claude/projects/-home-user-nexo-app/5098f60a-…jsonl` (líneas indicadas en el nombre de cada archivo).
Si el contenedor se pierde, siguen en: la bandeja «Diagnósticos recibidos» del S24 del dueño y (un tiempo, no se sabe cuánto) los relés
(canal directo kind 1065, ver `docs/CANAL_DIAGNOSTICO.md`).

## 1. Qué pasó (relato del dueño, fiel)
1. Un amigo con NEXO le escribió: «me mandaste algo pero no lo puedo ver». El dueño dijo que le mandaba la última versión de pruebas y le
   envió el APK de NEXO (25,9 MB) por el chat.
2. Aunque el dueño tenía Wi-Fi, el archivo se quedó en ⏳ «esperando» (de los estados esperando / enviado / recibido / leído) y no se movía.
3. Tocó **«reintentar»** → la app se **cerró** (varias veces; «3 o 4»). La reabrió, reintentó, nada.
4. Apareció un **mensaje de Android** (texto exacto NO recordado): algo sobre un **conflicto** y si quería **desinstalar**. Pensó que era
   otra app y aceptó desinstalar.
5. Resultado: Android le **quitó las actualizaciones** de NEXO (volvió a una versión mucho más vieja; el dueño cree que a la primera). Al abrir,
   NEXO mostró **el recorrido inicial (presentación) desde cero** y luego ofreció la 3001 (la última publicada entonces); la instaló desde
   la propia app. Desde ahí empezó a mandar los diagnósticos que se analizan aquí.
6. **11-11 ~03:40–04:05 UTC:** a propósito, para generar diagnósticos, el dueño **volvió a provocarlo** (reenvió el APK a varios contactos
   una y otra vez). Dijo explícitamente que lo hizo adrede y que no hay que tomarlo como emergencia (me adelanté y le mandé pasos de rescate: error mío).
7. **Dato verificable que tranquiliza:** la huella de identidad es la misma antes y después (`9174 A1CC 09B4 0148 3D99` en b2989, b2993 y b3001),
   mismo NEXO ID `NX1N36C283` y los mismos 21 contactos: **no se perdió la identidad ni los contactos**. Qué pasó con los mensajes del chat: no comprobado.
   Por qué salió «desde cero» la presentación: **desconocido**.

## 2. Evidencia en los registros (hora local = UTC−6; el nativo registra en local)
Diagnóstico S24 build 3001 (`NX1N36C283`), tres tandas: 03:42, 03:56 y 04:02 UTC.

**Línea de tiempo (hora local):**
- 21:41:28 arranque de sesión; 21:42:04 y 21:42:20: el nativo vuelve a cargar (`LIFECYCLE load – auto-starting GATT server`) = **proceso nuevo**: 3 arranques en ~1 min.
- 21:55:48–49 el dueño elige el APK (`*.apk 25910 KB`) y lo manda a `nx13c1b0fe`: `[CITA] msg… (25 MB) a nx13c1b0fe ausente: … el archivo queda ⏳ hasta coincidir` (diseño correcto para ausente).
- 21:56:07, 21:56:20, 21:56:32: **nuevos arranques del proceso**, cada ~12 s.
- 21:56:33 `nx13c1b0fe en línea por internet (datos móviles)` → 21:56:35 `sendFile START … bytes(b64)=35376265 to=net:nx13c1b0fe`, `_splitChunks: 2213 chunks` (chunk 16 000), `timeout=3600000`.
  La sesión **aguanta al menos hasta las 22:00:10** (último registro de esa sesión; el siguiente reinicio es 22:01:31): la ventana [0,12) no recibe ACK, `Window timeout … retry 1…6` (21:56:49 → 21:59:23), reintentos separados 12–50 s, sin avanzar.
- 22:01:31, 22:01:40, 22:01:48, 22:01:59 (y siguen): **cuatro arranques en 28 s**, cada ~8–11 s.
- **Patrón repetido en los 8 ciclos que se pueden medir:** tras cada arranque, el nativo escribe `FILE_IO leyendo lento: 4xx–7xx ms (adjunto)` y varios `(nexo_vault_outgoing_v2)`, luego `XFER Despierto para una transferencia grande por internet (tope 20 min)` y, **5–13 s después (casi siempre 5–9), el proceso arranca de nuevo** (medido: 21:41:58→21:42:04, 21:55:59→21:56:07, 21:56:11→21:56:20, 21:56:24→21:56:32, 22:01:34→22:01:40, 22:01:43→22:01:48, 22:01:51→22:01:59; el 21:42:07→21:42:20 tardó 13 s).
- En cada arranque el JS vuelve a «cargar 1 adjunto del disco: file 25910 KB» para 3 contactos distintos (`nx13c1b0fe`, `nx0cb2b010`, `nx01992876`: el mismo APK reenviado) y escribe bloques `[BleAckSystem] Resume: N outgoing para <contacto>` **para los 21 contactos, repetidos cada ~0,5–1 s** (hasta ~9 veces en 6 s), cada uno con lectura de ~450–770 ms de `nexo_vault_outgoing_v2`.
- «Adjunto pendiente sin sus datos (aún no se lee del teléfono): queda ⏳ y se reintenta» (de 2995/2997) se repite sin freno; tras 3 intentos y 5 min pasa a «no se pudo leer… no se reenvía».
- `[DIAGCH] «pendiente_viejo» sin relé abierto: queda en la cola` → en un bucle de reinicios el diagnóstico automático **puede no salir** (cola sin relé abierto; límites 1 por 2 h/3 por día).

## 3. Hipótesis (ordenadas por cuánto las respalda la evidencia) — TODAS SIN CONFIRMAR
- **H1 [HIPÓTESIS, la que mejor encaja]: memoria del WebView.** Mandar por internet un archivo de 35 MB base64 *troceado en memoria* (en JS: string de 35 MB + `_splitChunks` + persistencia en el almacén) agota la memoria y Android mata el proceso. Respaldo: la correlación «XFER → reinicio en 5–13 s» en todos los ciclos medidos; `docs/PENDIENTES.md` ya anotaba «el archivo grande por internet sigue viajando entero por la memoria del WebView — el crash del APK de 35 MB es eso» (Fase D/E); en el código el tope por internet es `NET_MAX_B64_BYTES = 56 000 000` (`src/ui/media_limits.js:30`, subido el 01-11 a pedido del dueño: «internet rápido hasta 40 MB»).
  **Contradicción a explicar:** el 08-11 (build 2960) un archivo de **34 MB por internet entre dos redes Wi-Fi funcionó** (`docs/PENDIENTES.md`, «archivo grande AUTÓNOMO por internet… confirmado»). Qué cambió desde entonces (¿más memoria ocupada por otras cosas? ¿varias cargas a la vez? ¿thumbnails 2987/88? ¿el estado del almacén de 21 contactos?) **no se sabe**.
- **H2 [HIPÓTESIS]: tormenta de escaneos × almacén grande.** `resumeOutgoingTransfers()` recorre los 21 contactos y lee su almacén (`vaultGetPendingOutgoingTransfers`, `src/vault/vault_manager.js:~1279`), y se llamaba desde cada «Reenviando pending para X» (`src/ui/ble_messages.js:~1299`), cada evento de enlace (`ble_links.js:135`, `main.js:828`, `render.js:832`, `ble_ack.js:~2048`). Con N contactos reenviando el mismo APK eran N×21 lecturas de cientos de ms en segundos. **Corregido en la 3003** (agrupa escaneos; prueba `resumescan.js`: 252→21 lecturas en una ráfaga de 12). Si H2 era la causa dominante, la 3003 baja el problema; si H1 lo era, no.
- **H3 [HIPÓTESIS]:** el almacén `nexo_vault_outgoing_v2_<cid>` guarda los trozos base64 enteros del archivo grande en un solo JSON por contacto: por eso cada lectura cuesta 450–770 ms y por eso varios contactos con el mismo APK multiplican la carga. Sin verificar leyendo el código de `_persistOutgoingTransfers` / `vaultCreateOutgoingTransfer`.
- **NO explicado:** (a) por qué el adjunto de 25 MB sale «sin sus datos» tras reiniciar; (b) por qué la presentación salió «desde cero»; (c) qué decía el aviso de Android y por qué ofreció desinstalar (¿el instalador por «conflicto con un paquete existente»? ¿Samsung «desinstalar actualizaciones» tras un crash-loop? ¿Play Protect?). El texto NO se recuperó.
- **No hay motivo de cierre registrado:** el diagnóstico no dice si Android mató el proceso por memoria, por excepción o por ANR. Ese dato falta y es lo que más acelerará todo (ver 3004-b).

## 4. Qué ya se hizo hoy (commits en `NEXOCHAT`)
- **3001** `710b7ec7`: canal directo de diagnósticos probado; «pendiente viejo» ignora archivos grandes que esperan Wi-Fi/internet. Publicada (01:50 UTC).
- **3002** `1e14a4a8`: un texto sobre un Bluetooth que el nativo ya descartó se rinde en ~3 s y queda ⏳ en vez de ✗ tras 8 reintentos (`ble_ack.js` `_textOnDeadBle`; `textdead.js`). Publicada (04:03:44 UTC). **No cambia nada del bucle.**
- **3003** `ddd72b6a`: `resumeOutgoingTransfers` agrupado (`RESUME_SCAN_GAP_MS` 2,5 s) + enfriamiento del adjunto sin datos (`_attMissCooling`, 5→60 s). Pruebas `resumescan.js` (nueva) y `attmiss.js` (ampliada); batería **172/172**. La APK se estaba compilando al escribir esto (aviso programado 04:37 UTC).
- **Error mío corregido:** mi prueba nueva se llamó `resumestorm.js` y sobrescribió una prueba vieja de 2887 (tope de 3 reanudaciones a la vez); la restauré y la mía quedó como `resumescan.js`. Ambas pasan.
- **No cubre:** el envío de 35 MB en memoria (H1); texto de grupo a una app dormida sin Bluetooth marcado muerto (b2987); zombi falso con la app del otro dormida.

## 5. Pendiente y decisiones del dueño
- **Decisión A/B/C (sin contestar)** sobre el tope por internet: **A** bajarlo a ~12 MB (lo mayor queda ⏳ con aviso claro «muy grande para internet; se envía cuando estén cerca»; recomendada por mí con el modelo rápido), **B** dejar 40 MB y solo frenar el bucle, **C** envío nativo disco→disco sin pasar por memoria (trabajo grande). El dueño pidió explícitamente tomarlo con calma y **no avanzar más con parches** hasta la revisión de fondo.
- **3004 propuesta (NO empezada):** (a) freno anti-bucle: ≥3 arranques en pocos minutos → no reanudar envíos grandes 5 min; (b) registrar en el diagnóstico el motivo del cierre (`ActivityManager.getHistoricalProcessExitReasons`, API 30+; Kotlin, solo compila en CI); (c) aviso claro de archivo muy grande para internet.
- Cola anterior: zombi falso (pong nativo), texto de grupo sin Bluetooth muerto, logo/sonidos (#111), seguridad H3/H4/M5/F6/F8/SEC-2/SEC-3 (luz verde del dueño), marca «Nexo», tablet/Fénix.

## 6. La pregunta de fondo que planteó el dueño (para la investigación profunda)
El dueño sospecha **«un problema de fondo en el sistema de la aplicación»**, además de que él y yo trabajábamos en un modo de poco razonamiento. Mi lectura previa (sin demostrar): los fallos de los últimos días parecen **de la misma familia**:
1. **Cargas pesadas viviendo en JS/WebView y en JSON** (archivos enteros en base64, almacén de transferencias con los trozos dentro) en vez de streaming nativo disco→disco.
2. **Disparadores sin freno:** muchos eventos (enlace, «Reenviando pending», vuelta al frente, flush) cada uno lanza el mismo trabajo pesado (escaneo de 21 contactos, hidratar adjuntos).
3. **Reintentos que se alimentan solos** al reiniciar (el estado pendiente sobrevive y se reanuda en cada arranque → bucle).
4. **Observabilidad que muere con el proceso:** si la app se cae, el diagnóstico JS se pierde (queda el registro nativo y el log de la sesión anterior; no hay motivo de cierre).
Preguntas para la sesión profunda: ¿cuál es la raíz común real?; ¿qué parte de la lógica de envío debe pasar a nativo y en qué orden?; ¿cómo garantizar que un archivo pendiente NUNCA pueda causar un bucle de arranque (límite global de memoria/arranques)?; ¿qué debe quedar registrado SIEMPRE tras un cierre inesperado? Antes de rediseñar, **medir**: reproducir el cierre en el simulador con memoria limitada si es posible, y añadir el motivo de cierre (3004-b).

## 7. Cómo trabajar con el dueño (acordado en esta sesión)
- Responder en español, «tú», corto, sin jerga. Calma: el dueño pidió explícitamente no hacer muchas cosas a la vez ni tratar sus pruebas como emergencias.
- Método del proyecto: reproducir en `tests/sim`, batería completa, y solo entonces subir; un push a `NEXOCHAT` genera APK y **cancela** la compilación anterior si sigue en curso (esperar a que la anterior esté publicada). Docs-only: `[skip ci]`.
- Decir siempre qué está probado, qué no y qué es hipótesis. No guardar los diagnósticos crudos en el repositorio público.
- Modelos disponibles en su app: Opus 5.5, Fable 5.2 («desafíos más difíciles»), Sonnet 5.5 (el de esta sesión), Haiku 5.5; «Esfuerzo» mostraba «Alto». Para esta investigación el dueño quiere el modo más potente.

## 8. RESULTADOS DE LA INVESTIGACIÓN DE FONDO (modelo Fable, 11-11 ~06:45 UTC) — SUSTITUYE a las hipótesis de §3
**Estado:** 2 frentes completos (camino JS del envío; puente de Capacitor y memoria Java) + sus 2 revisiones independientes hechas por «escépticos»; 5 frentes en curso (almacén y migración, disparadores, máquina de envío, receptor/red, observabilidad). Informes completos SOLO en el contenedor (efímero): `scratchpad/investigacion/` (`01_envio_js.md`, `02_puente_nativo.md`, `*_verificacion.md`, scripts en `01_scripts/`, mediciones JVM en `02_work/resultados.txt`, tabla `00_arranques_y_webview.md`). Nada de esto cambió código.

### 8.1 El aviso de Android y la presentación «desde cero» (VERIFICADO, salvo el texto exacto del aviso)
- User-Agent del S24 en los diagnósticos: `Chrome/156.0.8078.50` hasta las 02:47 UTC (build 2998) y `Chrome/140.0.7339.207` desde las 03:42 UTC (build 3001): lo que se desinstaló fueron **las actualizaciones de Android System WebView**, no NEXO. El dueño confirmó que el aviso «era algo parecido a WebView» y que al reproducir después ya no salió (solo el cierre).
- El WebView **borra todos sus datos de la app cuando detecta que su paquete retrocedió de versión** (verificado en la fuente de la 140.0.7339.207): se perdió localStorage/IndexedDB y por eso salió la presentación inicial (`src/auth/onboarding.js` usa localStorage). El almacén nativo (identidad `9174 A1CC…`, 21 contactos, mensajes, pendientes) quedó intacto. Consecuencia de diseño: todo lo que viva solo en el almacenamiento del WebView se pierde si alguien toca el WebView.
- Por qué Android culpó al WebView (probable): el mensaje gigante del puente se convierte en String Java DENTRO del código del WebView (JNI NewString); si no cabe, Chromium mata el proceso de la app con la traza en sus clases.

### 8.2 Mecanismo del cierre — clase de causa con certeza ALTA; punto exacto de la asignación fatal SIN confirmar
- **Qué cruza el puente (medido en el simulador, builds 3001 y 3003 iguales; re-ejecutado por el revisor):** un envío NUEVO de 25,9 MB hace dos `saveToFile` con el contenido completo en ~1,5 s: el adjunto `nexo_att_<id>.b64` (35,4 M car.) y, ~0,1–0,2 s después de `xferKeepAwake(true)` («XFER»), el archivo de salientes del contacto `nexo_vault_outgoing_v2_<nx>.json` con **TODOS** sus registros pendientes y todos sus trozos: 35,7 M car. si no había ninguno, **71,3 M** si ya había uno, ~106 M con dos (`src/vault/vault_manager.js:1215-1219`, `JSON.stringify` del archivo entero y `saveToFile` sin esperar; `src/ui/ble_ack.js:2076-2092`). Una reanudación solo lee (`vault_manager.js:1227-1228` devuelve el registro existente).
- **Dónde muere (código verificado):** Capacitor 5.7.8 entrega cada mensaje JS→nativo entero al hilo principal (`WebMessageListener`) y lo analiza con `new JSObject(jsonStr)` atrapando solo `Exception` (`node_modules/@capacitor/android/.../MessageHandler.java:54` y `:96`): un `OutOfMemoryError` ahí (o antes, al crear el String en el código del WebView) mata el proceso **sin onPause/onDestroy y sin rastro**: la firma exacta de las muertes (9 arranques tras muerte en primer plano en los tres diagnósticos; todas con «XFER» 5–14 s antes cuando el registro lo alcanza a mostrar). `MainActivity.onRenderProcessGone` hace `recreate()`: la muerte del proceso de render habría dejado `handleOnPause`/`handleOnDestroy`; no los hay → no es el WebView/render (HB descartada).
- **Cuánta memoria (medido en JVM con el org.json de Android API 35 y el JSObject real de Capacitor; repetido por el revisor: 71/135/265/107/211 MiB):** analizar el guardado del archivo de salientes pide ~136 MiB de heap con 1 registro de 35,4 M car. y ~265 MiB con 2; un adjunto, 71 MiB; devolver una lectura de 35 M car., ~107 MiB (esta sí protegida: `ioRun` atrapa `Throwable`, `NexoBlePlugin.kt:2596`). El manifiesto no tiene `largeHeap`; el límite típico es 256 MiB (**no medido en el S24**; el margen del caso «2 registros en solitario» es de solo ~2 MiB, así que no es «aritmética pura»).
- **El umbral NO es simplemente «dos registros» (corrección del revisor):** un envío nuevo solapa el cifrado del adjunto en `ioBig` (~135 MiB) con el análisis del guardado del almacén (~130 MiB) y, al arrancar, con lecturas duplicadas de 35 M car. (~104 MiB cada una): ya se supera 256 MiB con UN registro. Contraejemplos reales: el 10-11 12:46 (build 2994, WebView 156) la app murió en un envío nuevo sin escritura doble; el 10-11 12:35 un guardado de ~49 M car. **no aparece tras reiniciar** aunque la app siguió viva (guardados grandes que fallan en silencio).
- **Lo que se sabe de cada muerte:** de la primera (sesión 21:41:28, 19 s) SÍ hay registro JS: envío nuevo de 25 910 KB a un contacto que ya tenía un registro de 35 MB, cuya escritura de 2 registros nunca llegó al disco. De las demás no hay registro JS (se guarda cada 20 s por el mismo puente, `src/ui/diag.js:63-72`); el registro nativo no distingue un arranque mortal del que sobrevivió (21:56:32, que fue una reanudación).
- **Bucle de arranque (verificado):** mensaje y adjunto quedan en disco antes del paso pesado; `window.vaultGetPendingMessages` no está expuesta (`src/main.js` no la importa), así que rige `_isResendable` (`ble_helpers.js:627-634`: pending, failed, sending, queued): en cada arranque se relee el adjunto (35 M car. por el puente), se resella y se reintenta el mismo guardado ~3 s después de abrir. Cada reenvío del mismo archivo crea id, adjunto y registro nuevos; `expiresAt` no se aplica y `vaultCleanupOutgoingTransfers` no tiene llamadores: nada caduca.
- **La build 3003 no toca este camino** (solo agrupa escaneos de reanudación y enfría adjuntos que fallan al leerse).

### 8.3 Fallos de corrección encontrados de paso (GRAVES, independientes de la memoria)
- **Pérdida silenciosa de archivos con «cita» (confirmado en simulador):** el marcador de cita lleva el mismo id que el archivo; el acuse de «leído» del marcador marca el ARCHIVO como leído (✓✓) en el emisor antes de entregarse (`ble_messages.js:1029, 1037`; `ble_ack.js:1514-1526, 1757-1765`). Si el emisor se reinicia antes de entregar, el mensaje deja de ser reenviable, `_dropDeliveredTransfers` borra el registro y el receptor se queda con la tarjeta para siempre. Encaja (probable) con «Me mandaste algo pero no lo puedo ver».
- **Lectura fallida = lista vacía:** `_loadOutgoingTransfers` traga cualquier error y devuelve `[]` (`vault_manager.js:1208-1209`); la siguiente escritura pisa el archivo solo con el registro nuevo (pérdida de pendientes). Por código; no ejecutado.
- Registros de salientes «zombis» que se reanudan en cada arranque sin mensaje detrás; el progreso nunca se guarda (cada reanudación empieza en el trozo 0).
- `openFile` (abrir/instalar un archivo recibido) y `saveToGallery` también pasan el base64 completo por el puente (`NexoBlePlugin.kt:3427-3485`), el primero sin protección ante `OutOfMemoryError`.
- En JS cada envío hace ~10 copias de 26–35 MB (p. ej. `send.js:97` y `vault_manager.js:677-698` serializan y analizan el adjunto entero solo para mirar un campo) y el claro queda retenido hasta que termina la transferencia.

### 8.4 Qué falta para la certeza total
- El **motivo real de salida** en el teléfono: `ActivityManager.getHistoricalProcessExitReasons` (distingue CRASH / fallo nativo / LOW_MEMORY / ANR, pero para un fallo Java NO trae la traza) + un manejador de excepciones no capturadas que escriba clase y pila en el registro nativo + `Runtime.maxMemory()` (límite de heap real del S24). Requiere una build «forense» (Kotlin; solo compila en CI). Sin eso, HA (memoria Java al cruzar el puente) queda en probable-alta; HD (fallo dentro del WebView al crear el String) es la variante del mismo problema; HC/HE poco probables.

### 8.5 Dirección del arreglo (NO implementado; lo decide el dueño)
- Regla: **ningún contenido de archivo viaja como cadena por el puente**; tope duro por mensaje (cientos de KB) comprobado en JS, en nativo y en `tests/sim/native_mock.js` (el simulador no ve la memoria, pero sí el tamaño de lo que cruza).
- Archivo en disco por trozos y por referencia para todos los caminos: generalizar `BigFile.kt`/`big_file.js` (hoy solo Wi-Fi/Wi-Fi Direct) a internet, recepción, abrir, instalar y galería.
- Almacén de salientes solo con metadatos (id, máscaras, estado, referencia al adjunto), un registro por envío, con caducidad real; **migración nativa** de los archivos gigantes que ya existen en los teléfonos (no leerlos por el puente).
- Un único dueño por id de mensaje (hoy lo arrancan envío nuevo, reenvío de pendientes, reanudación, «Reintentar», respuesta de cita y eventos de enlace, y dos corren a la vez).
- Arranque seguro (contador nativo de arranques que no llegan a N segundos sanos → no reanudar envíos grandes y avisar) y observabilidad que sobreviva al proceso.
- `largeHeap` solo como colchón temporal: mueve el precipicio, no lo quita.
- Mover a almacén nativo lo que hoy vive solo en localStorage (nivel de seguridad, consentimientos, etc.).

## 9. Primera prueba real de la 3004 (diagnóstico automático S24, 11-11 12:17 UTC)
- **Sin cierre.** Dos APK de 25 MB enviándose a la vez a `nx13c1b0fe` (el viejo `…ucw62`, reenviado una vez al arrancar —freno: 1 de 2—, y uno nuevo `…84cbb`): la app siguió viva, sin sesión nueva en la ventana.
- **El envío se para en el trozo 180 de 2213 (8 %) a las 06:14:22 (hora local).** De 0 a 180 en ~70 s (~2,6 trozos/s, ventanas resueltas en 3–4 s). Desde ahí, **ningún** ACK ni NACK del otro: ni de la ventana [180,192) (8 reintentos y vuelta a empezar) ni de la PRIMERA ventana del APK nuevo [0,12). Del lado del emisor no hay rechazos de los relés (sin «Envio nativo fallo chunk»).
- **Mismo patrón en todos los envíos de 25 MB por relés** de los diagnósticos guardados (todos a teléfonos de amigos): se paran en 96, 120, 183, 216, 396, 411 trozos. El único de 25 MB por internet que llegó completo fue **por Tor entre los dos teléfonos del dueño** (08-11 04:20, 2220 trozos).
- **Problema estructural:** 2213 trozos ≈ 14 min con los dos teléfonos despiertos y la app viva. El receptor guarda los trozos solo en memoria (`incomingBuffers`, los tira a los 120 s sin trozos nuevos, `ASSEMBLY_TIMEOUT_MS`) y cada intento nuevo se vuelve a cifrar (marca `a` distinta) → **empieza de cero**. Si el otro se duerme o cierra la app, no se completa nunca.
- **Sin confirmar:** si el otro teléfono se durmió o si los relés dejaron de pasarle los trozos. Hace falta el diagnóstico del que recibe → prueba entre los dos teléfonos del dueño (dos Wi-Fi distintos): 1) receptor con la pantalla encendida en el chat; 2) receptor con la pantalla apagada.
- **Arreglo propuesto:** (a) continuar donde se quedó (el receptor guarda los trozos en disco y dice desde cuál sigue; el emisor reanuda) — lo que ya hace `BigFile.kt` por Wi-Fi; (b) si el otro deja de contestar ~1 min, pausar sin inundar los relés y seguir cuando vuelva.
- **Reproducido en el simulador (`tests/sim/netsilence.js`, sobre la 3004, archivo de 4 MB = 340 trozos, solo relés):**
  - C1, el receptor deja de recibir 150 s a mitad (con 104/340): el emisor siguió mandando **207 trozos (83/min) sin que nadie los recibiera**; el receptor **tiró lo recibido** (120 s, `ASSEMBLY_TIMEOUT_MS`); al volver llegó en 20,6 s pero **mandando de nuevo el 125 % del archivo** (empezó de cero).
  - C2, el receptor se reinicia a mitad (102/340): llegó con solo 1 % de más, porque **los relés de prueba guardan los trozos y se los vuelven a dar al resuscribirse**. En la vida real depende de que los relés públicos los guarden (no comprobado).
  - Conclusión: el «empieza de cero» tras >2 min sin recibir está confirmado; el arreglo pequeño (no tirar lo recibido de un archivo grande por internet a los 2 min + pausar el emisor si el otro calla) se puede medir con esta prueba (hoy FALLO; objetivo < 25 % reenviado y ≤ 12 trozos/min callado).
- **3005 (arreglo pequeño, modo adelanto):** receptor guarda lo recibido de un archivo grande por internet 30 min (antes 2), emisor lo mantiene vivo 30 min sin ACK y sondea con 1 trozo/min si el otro calla. `netsilence.js` sobre la 3005: 8 trozos/min callado (antes 83), receptor conserva lo recibido, 8 % reenviado (antes 125 %), llega ≤ 60 s después de volver el otro. Batería 174/174. No cubre: corte > 30 min ni reinicio del que envía (intento nuevo = de cero) → trozos a disco, con OK del dueño.
