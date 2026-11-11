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
