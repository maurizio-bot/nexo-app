# NEXO — Estado del proyecto

Última actualización: 2026-10-21 (build 2698)

## Construcción y firma
- Push a `NEXOCHAT` → `.github/workflows/build-apk.yml` publica la pre-release `nightly-<run>` (APK debug).
  En otras ramas (lanzado a mano) solo compila, verifica la firma y sube un artifact; no publica.
- Firma fija: secret `DEBUG_KEYSTORE_BASE64` → `NEXO_DEBUG_KEYSTORE` → `android/app/build.gradle`.
  El paso "Verify APK signature" exige SHA-256 `23d86688…9f865e`. Desde la 2691 se actualiza encima
  sin desinstalar. El dueño guarda copia de la llave (no está en el repo).
- Solo entra en la APK lo que importa `src/main.js` (webpack); el resto de `src/` no se usa aún.

## Qué hace la APK
Mensajería P2P por BLE sin servidores. Identidad `NX` + 8 caracteres (`_generateNexoId` en
`ble_interface.js`, guardada en `nexo_advertising_id.json`; mapas `_nexoIdToMac`/`_macToNexoId` con ID en
minúscula y MAC sin ":"). Cada teléfono es servidor GATT (servicio `0000abcd`, RX `abce`, TX `abcf`) y
cliente; anuncia el NEXO ID en manufacturer data. Chat con estados (pendiente → enviado → entregado →
leído), cola de reenvío, sincronización por `seq`, adjuntos (foto 480 px, vídeo, archivo ≤ ~2,1 MB, voz,
ubicación) y persistencia JSON (`saveToFile`/`loadFromFile`; adjuntos en `nexo_att_<msgId>.b64`).

Archivos clave: `src/main.js`, `src/ui/ble_interface.js`, `src/ui/ble_ack.js` (protocolo: trozos
`c`/`f`, ack de bloque `ba`, NACK `n`, sync `ss`/`sr`, `sendWithRetry`), `src/vault/vault_manager.js`,
`plugins/nexo-ble/.../NexoBlePlugin.kt`.

## Historial
| Build | Commit | Nota |
|---|---|---|
| 2679 | `04960e2` | Base funcional recuperada |
| 2680–2687 | | Rotura del envío (`content` vs `message`), fixes; 2687 subida sin verificar: no usar |
| 2688 | `c45f5f5` | Envío/ACK/historial OK. Fotos lentas, app trabada tras 2ª foto, PDF no llega |
| 2691 | `37152b8` | Firma fija real; sin tormenta de retransmisiones; adjuntos fuera del historial. Prueba real: textos y fotos OK pero lento; al reabrir la app se perdían 1-2 mensajes |
| 2692 | `d6c7fae` | Verificación en rama de trabajo (Kotlin compila, firma OK), sin release |
| 2693 | `c12c974` | Mensajes retenidos al reabrir, control de flujo nativo por callback, progreso visible |
| 2694 | `b75a767` | Verificación en rama de trabajo (Kotlin + firma), sin release |
| 2695 | `37ad25e` | Historial sin carreras (mensajes borrados al reabrir), textos repetidos visibles, reconexión al volver a la app |
| 2696 | `939f4ec` | Vídeo previa 240p + HD automático; lista de contactos por último mensaje |
| 2697 | `2fc0074` | Vídeo/texto a app cerrada ya no se pierden (cola por contacto), vídeo se ve más de una vez, miniatura |
| 2698 | `43256cd` | Vídeo: burbuja con miniatura sin reproductor, visor que libera, previa robusta, diagnóstico en Perfil — **BASE ESTABLE** (rama `base-estable-2698`) |
| 2699 | `d563355` | Compartir contactos (botón contacto): selección múltiple, tarjeta, alta con parpadeo — **BASE ESTABLE** (rama `base-estable-2699`) |
| 2700 | `eef24ed` | Rendimiento: historial paginado, sin congelones al recibir, escrituras agrupadas, radio libre en transferencias |
| 2701 | (este) | Vídeo: HD recodificado 720p si el original es grande, tiempo restante, tiempos en el diagnóstico |

## Base estable: build 2699
Probada por el dueño en teléfonos reales (compartir contactos entre 3 teléfonos incluido), fijada el
22-10-2026. Anterior: 2698 (rama `base-estable-2698`).
- Código: rama **`base-estable-2699`** (commit `d563355`). No se toca; el proxy no deja subir etiquetas.
- APK: release `nightly-2699`. Misma llave y mismo `versionCode 1` que todas las builds: se instala
  encima de cualquier build posterior sin desinstalar (el workflow no borra releases antiguas).
- Volver a la base (sin reescribir la historia, genera una build nueva con el código de la 2699):
  ```
  git checkout NEXOCHAT && git pull
  git restore --source=base-estable-2699 --staged --worktree -- src plugins android index.html package.json package-lock.json
  git commit -m "Volver a la base estable 2699" && git push origin NEXOCHAT
  ```

## Siguiente paso (al retomar)
- Pruebas rápidas de la 2698 en teléfonos reales: funciona (aceptable; faltan pruebas para afinar).
  Si aparece un fallo, pedir el texto de **Perfil → Copiar diagnóstico** de ambos teléfonos. Pruebas pedidas: vídeo de 5 s con la app del otro cerrada y abierta; abrir el
  vídeo varias veces; ver si aparece la miniatura, cuánto tarda la previa y si pasa a HD.
- Al recibir el diagnóstico, buscar en "eventos clave": `[VIDEO] Previa: …` (¿se generó? ¿motivo si
  no?), `Enviando HD`, `sendFile`, `Reenvi`, `Peer ready`, `El visor no pudo reproducir`, líneas ` W `/` E `.
  Reproducir lo que muestre en `tests/sim/browser.js` (Chromium real) o en el simulador antes de corregir.
- Pendientes ya hablados: transporte binario (sin base64/JSON, ~1,6x) para todos los archivos; recibir
  con la app cerrada (servidor GATT en el `BleService`).

## Ronda 2701: vídeo previa → HD revisado
El dueño no veía el cambio a HD. Causa más probable: vídeos de la galería (cámara del teléfono: 1080p/4K,
10-25 MB por 5 s) superaban `MAX_HD_B64_BYTES` y solo viajaba la previa. Ahora, si el original es >2,5 MB
o >720p, en la MISMA pasada de la previa se graba un HD 720p a 1,2 Mbps (`HD_DIRECT_MAX_BYTES`,
`HD_MAX_SIDE`, `HD_REENCODE_BPS`); si no, el HD es el original. Etiqueta con tiempo restante
("HD 45% · ~2 min"), registro `[VIDEO] Previa entregada en X s` / `HD entregado en Y s (KB, KB/s)` y la
burbuja propia se pinta desde una URL del archivo (sin decodificar base64: quitaba ~1 s de bloqueo).
Chromium real (`browser.js`, `--big`): clip 720p 972 KB → previa 227 KB en 29 s, HD (original) a 126 s;
clip 1080p 2,1 MB → HD recodificado 1,66 MB, previa 33 s, HD 198 s. El simulador va a ~13 KB/s; en los
teléfonos del dueño se midieron ~4,4 KB/s (2695): previa ~1-1,5 min y HD ~5 min. La gran mejora
pendiente de velocidad es el transporte (binario / L2CAP) — ver pendientes.

## Ronda 2700: rendimiento (medido en Chromium real con la CPU frenada 4x)
Nuevo `tests/sim/stress.js` (3 teléfonos precargados, historial de B: 400 mensajes con 8 fotos y 2
vídeos) y `tests/sim/profile.js` (perfil de CPU por función). Misma prueba en 5 builds:

| Receptor B | 2679 (base dueño) | 2691 | 2698 | 2699 | 2700 |
|---|---|---|---|---|---|
| Ráfaga 40 textos: CPU | 100 % | 82 % | 81 % | 84 % | 40 % |
| Ráfaga: congelón máx. | 43 s | 2,4 s | 1,7 s | 2,6 s | 0,08 s |
| Multi-chat: congelón máx. | 3,9 s | 0,17 s | 0,24 s | 0,24 s | 0,08 s |
| Abrir chat 400 msj: CPU | 5,4 s | 6,0 s | 4,8 s | 5,3 s | 1,1 s |
| Abrir chat: congelón máx. | 2,5 s | 2,4 s | 1,8 s | 1,9 s | 0,4 s |

Conclusión: entre 2691 y 2699 no hubo regresión de CPU; la lentitud venía de defectos antiguos que
crecen con el historial (por eso se nota más con el uso):
1. Cada mensaje dibujado programaba `scrollTop = scrollHeight` (relayout de todo el chat por mensaje).
2. Inserción de burbujas recorriendo todas las anteriores (O(n²) al abrir un chat).
3. Al abrir un chat el historial se cargaba y dibujaba DOS veces (`ble_interface.openChat` →
   `nexo:vault:messagesLoaded` con todo y sus adjuntos leídos de disco) y `nexo_app` registraba cada
   mensaje como "recibido".
4. Historial reescrito entero en disco con cada cambio de estado.
Arreglos: página de 60 mensajes (anteriores al subir), inserción desde el final, un scroll por fotograma,
mensajes nuevos al disco al momento y estados agrupados (300 ms). Además:
- **Fallo real**: "atrás" + abrir otro chat en <300 ms dejaba el chat nuevo sin contacto activo (mensajes
  pintados pero no enviados, fotos no enviadas). Afectaba a todas las builds anteriores.
- Radio: la re-búsqueda y el escaneo automático se pausan durante transferencias de archivo (comparten
  la radio). `perf.js --absent --scan-penalty=1.6`: PDF 150 KB 23,5 s (2699) → 18,4 s.
Pendiente medido: al enviar un vídeo, un bloqueo de ~1 s en el emisor (con CPU 4x; también en 2679).

## Ronda 2699 (verificada en simulador + Chromium real)
**Compartir contactos** (último botón del menú de adjuntos), como WhatsApp:
- Abre una hoja con los contactos (buscador, casillas, "Enviar (N)"); se envía un adjunto `contact`
  con `{ contacts: [{ nexoId, name }] }` por el camino de texto (como la ubicación). Sin dirección
  Bluetooth (cambia y no sirve al otro).
- En el chat aparece una tarjeta "👤 Contacto(s)". En el receptor, pulsarla (o "Agregar a contactos")
  llama a `bleInterface.addSharedContacts`: valida `NX`+8, omite el propio y los ya existentes; los
  nuevos quedan arriba **parpadeando** (`isNewShared`, clase `ble-contact-new`) hasta abrir su chat, con
  "Nuevo contacto · listo para escribir", y se empiezan a buscar por radio. "Escribir" abre su chat.
- Para que estén "listos para el uso": `openChat` ya no rechaza un contacto sin dirección conocida, y
  escribirle deja el mensaje en la cola por contacto hasta encontrarlo (antes "Dispositivo no
  encontrado"); adjuntos quedan pendientes (`PEER_ABSENT`).
- Nombres en la lista y la barra "en línea" como texto, no HTML (venían de otros teléfonos).
`tests/sim/share.js`: B nunca había visto a C → tras agregarlo, mensaje B→C en 1 s; con C fuera de
alcance queda "enviando" y llega a los 30 s al volver C. Batería completa y `browser.js` sin cambios.

## Ronda 2698 (verificada en Chromium real + simulador)
Prueba real de la 2697: el vídeo no llega, no pasa a HD, no se ve la miniatura y solo se reproduce una
vez. Nuevo `tests/sim/browser.js` (Chromium real): con la 2697 el ciclo completo funciona en Chromium
(previa real 177-230 KB, miniatura, HD, app cerrada) pero quedaban 3 reproductores vivos tras abrir el
visor 3 veces. Conclusión: lo que falla es propio del WebView de Android.
1. **Reproducir más de una vez**: cada burbuja creaba un `<video>` (preload=metadata) y el visor no se
   liberaba al cerrar; en Android cada reproductor retiene un decodificador de hardware. Ahora la burbuja
   muestra la miniatura (`<img>`), el reproductor solo existe en el visor y se libera
   (`pause`+`removeAttribute('src')`+`load`). Chromium: 0 reproductores vivos (antes 3).
2. **Previa que podía colgarse** (si el grabador no terminaba, el vídeo no se enviaba nunca): vigilante
   general, detección de atasco, vídeo temporal dentro de la pantalla (Android no decodifica ocultos),
   AudioContext reanudado o previa sin audio. Si falla: original con miniatura (`--no-preview`).
3. **Miniatura**: también sin previa (`_makeVideoThumb` del original) y, si un vídeo llega sin ella, se
   genera al dibujarlo y se guarda (`metaMerge`).
4. **Diagnóstico**: Perfil → Diagnóstico (eventos clave + últimas líneas, también de la sesión anterior)
   con botón Copiar. Es la forma de ver qué pasa en el teléfono real.

## Ronda 2697 (verificada en simulador)
Prueba real de la 2696: vídeo + texto a un teléfono con la app cerrada → al abrirla no llegó nada; la
previa no se veía; el vídeo recibido solo se reproducía una vez.
1. **Vídeo a contacto ausente perdido**: `sendFile` esperaba ~40 s a la dirección vieja, rechazaba "not
   ready", `main.js` lo trataba como transitorio y lo dejaba en 'sending'; como la transferencia no había
   empezado no había nada que reanudar y `_isResendable` excluía adjuntos en 'sending'. Ahora falla en 8 s
   (`PEER_ABSENT`), busca al contacto y el adjunto se reenvía al reconectar (adjuntos 'sending' sin
   transferencia viva son reenviables; `_sendFileJS` no duplica). El HD arranca también tras ese reenvío.
2. **Textos que no salían tras reabrir el otro**: `_pendingMessageQueue` iba por dirección Bluetooth; al
   reabrir, Android cambia la dirección y la cola vieja no se vaciaba nunca (y `_isMsgInFlight` impedía
   el reenvío). Ahora la cola es por contacto (`nx:<id>`) y se vacía en `_notifyPeerReady`.
   `background.js --scenario=closed --video --pre-wait=15000 --off=90000 --rotate`: 2696 nada; ahora
   textos 6 s, previa 11 s, HD 41 s tras reabrir.
3. **Vídeo que solo se veía una vez**: cerrar el visor revocaba la URL que usa la burbuja; además cada 50
   mensajes se revocaban todas. Ahora solo al salir del chat (`video.js`: 2696 URL destruida; ahora no).
4. **Miniatura**: fotograma JPEG de la previa en la cabecera (`th`) → `poster` del vídeo (en Android un
   `<video>` sin poster se ve gris/negro hasta reproducirlo).

## Ronda 2696 (verificada en simulador salvo la recodificación)
**Lista de contactos que saltaba**: se ordenaba por `lastSeen` (cambia con cada ping/escaneo/
reconexión). Ahora por `lastMessageAt` (último mensaje enviado o recibido; `noteContactMessage` en
`ble_interface.js`), la fila muestra ese mensaje y su hora, y se redibuja como mucho cada 300 ms (antes
con cada paquete). `window.vaultSaveContacts` no estaba expuesto: último mensaje/no leídos nunca se
guardaban. `tests/sim/contacts.js --churn`: 2695 cambiaba de orden sin mensajes; ahora estable.
**Vídeo en dos pasos** (`main.js` `_sendVideo`): previa recodificada en el teléfono (240p, 60-200
kbps, `_makeVideoPreview`: video → canvas + WebAudio → MediaRecorder) enviada como mensaje normal; al
llegar, el original va solo como transferencia `<msgId>_hd` (cabecera `hf`), con textos intercalados, y
en el receptor sustituye a la previa en el mismo mensaje (`vaultReplaceAttachment`). Estado `hdStatus`
en el historial; se retoma al reconectar (`_resumeHdTransfers`) o al reabrir. Cámara a 1,5 Mbps.
Límites: previa ≤ 60 s de vídeo, HD ≤ ~6 MB; si no se puede recodificar se envía el original como antes.
`tests/sim/video.js` (previa simulada): previa 5 s, texto durante el HD 0,2-0,4 s, HD 300 KB 35 s,
corte de enlace al 30 % → completa (59 s), A cierra la app al 30 % → completa (42 s), 2 MB 213 s.
**Sin verificar**: la recodificación real (MediaRecorder/canvas no existen en jsdom): calidad y tamaño
de la previa solo se ven en el teléfono (log `[VIDEO] Previa WxH N KB`).

## Ronda 2695 (verificada en simulador)
Prueba real de la 2693: con B en segundo plano o cerrada seguían faltando mensajes; vídeo de 5 s = ~8 min.
**Causa principal (reproducida con `--io-delay=25`)**: `vaultAppendMessage`/`vaultUpdateMessageStatus`
leían el historial, lo modificaban y lo guardaban sin exclusión. Con la caché vacía (app recién abierta)
dos mensajes seguidos (y cada uno se guarda dos veces: `ble_interface` y `main.js`) leían el mismo
archivo y el último guardado borraba los demás. A veía "entregado" y B no tenía nada. Arreglo: cola por
contacto (`_withMsgLock`), carga compartida y una lectura lenta ya no pisa una caché más nueva.
Con 2693: 0/3 guardados; ahora 3/3 (25 y 60 ms de latencia).
**Textos repetidos**: `_renderMessage` descartaba un recibido igual a uno de los 5 últimos ("ok") y A
veía ✓✓. 2693: 1 de 3 visibles; ahora 3 de 3.
**Robustez de reconexión** (no reproducía pérdida en el simulador, pero eran puntos frágiles):
`@capacitor/app` no está instalado → al volver a la app no se hacía nada; ahora aviso nativo
`onAppStateChange` + `visibilitychange`. Re-búsqueda sin tope de 10 min (15 s → 60 s; tras 30 min cada
5 min solo si hay pendientes), también oculta con escaneo filtrado (Android no da resultados sin filtro
con pantalla apagada), y 2 min de búsqueda de contactos al abrir/volver.
**Vídeo** (sin cambios aún, pendiente de decisión): grabación a 1280x720 y ~2,5 Mbps (por defecto de
MediaRecorder) = ~1,6 MB por 5 s; medido ~4,4 KB/s reales. Plan propuesto: 1) grabar/recomprimir a
640x360 ~400 kbps (~6x menos); 2) idea del dueño: vista previa rápida y HD después en segundo plano o
bajo demanda; 3) transporte binario (sin base64/JSON, ~1,6x) para todos los archivos.

## Ronda 2693 (verificada en simulador)
**Pérdida al reabrir / segundo plano** (reproducida con `tests/sim/lifecycle.js`):
1. Capacitor descarta `notifyListeners` si el JS aún no escucha → `onPayloadReceived` ahora con
   `retainUntilConsumed=true`.
2. Si el otro tenía la app cerrada, la conexión quedaba abierta sin servicio NEXO y bloqueaba la
   reconexión → se cierra (`closeClientWithoutService`) y el JS reintenta también desde ERROR.
3. Conexiones abiertas antes de que el JS arrancara → `getConnectedDevices` (con `ready`) al iniciar.
4. Cola de pendientes enviada sin ack → `sendWithRetry`; cualquier paquete del otro dispara el reenvío.
5. Sync de sesión comparaba `seq` mezclados → solo el `seq` del otro; reenvía lo propio sin confirmar.
Resultado: 3/3 mensajes llegan ~2 s después de que arranca el JS de B, estado "entregado", también
con direcciones asimétricas y `seq` altos. 2691 en el mismo escenario: perdidos o hasta 43 s.

**Velocidad**: el nativo esperaba fijo 40 ms (cliente) / 80 ms (servidor) por escritura y reintentaba
con `Thread.sleep` en el hilo principal. Ahora envía la siguiente en cuanto Android confirma
(`onCharacteristicWrite` / `onNotificationSent`, respaldo 300/200 ms), la cola solo se procesa en el
hilo principal, PHY 2M. JS: ventana de archivo 12, pausa 2 ms.
Foto 60 KB / PDF 150 KB (MTU 512): antes 11 s / 36 s → radio rápida (15 ms) 5,6 s / 18,6 s; lenta
(30 ms) 8,1 s / 26,9 s. 0 descartes de cola. Con 3 % de pérdida (3 corridas): fotos 13-21 s (una vez 45 s),
PDF 74-106 s, siempre completan; igual que la 2691 (en BLE real la capa de enlace reenvía: peor caso artificial).
**Percepción**: "○ N%" en la burbuja propia y "📷 Recibiendo foto… N%" en el chat del receptor.

## Regla de trabajo (pedida por el dueño)
Reproducir el fallo en el simulador, corregir, confirmar y solo entonces subir y avisar. Nunca dar
resultados no comprobados. Respetar la estructura existente (NEXO ID, mapas, vault). Batería mínima:
```
tests/sim/build.sh && node tests/sim/run.js tests/sim/builds/wip --content-fallback
node tests/sim/perf.js tests/sim/builds/wip --pdf-kb=150 [--pace=15,15 | --mtu=247 | --loss=0.03]
node tests/sim/lifecycle.js tests/sim/builds/wip --retain --close-no-service --asymmetric --js-delay=6000 --io-delay=25
node tests/sim/background.js tests/sim/builds/wip --scenario=closed --rotate --no-m3 --io-delay=25 --app-events
node tests/sim/contacts.js tests/sim/builds/wip --churn --io-delay=25
node tests/sim/browser.js tests/sim/builds/wip [--closed | --no-preview]   # Chromium real
node tests/sim/share.js tests/sim/builds/wip --io-delay=25 [--c-away]
node tests/sim/stress.js tests/sim/builds/wip    # rendimiento (Chromium real, CPU 4x, ~10 min)
node tests/sim/video.js tests/sim/builds/wip --io-delay=25 [--cut | --restart-a]
node tests/sim/background.js tests/sim/builds/wip --scenario=closed --video --no-m3 --pre-wait=15000 --off=90000 --rotate --io-delay=25 --app-events
```
Ver `tests/sim/README.md`. Límites: no simula la radio real (velocidad, alcance) ni Kotlin en sí.

## Problemas conocidos (sin corregir)
- Recibir con la app cerrada (deslizada) necesita mover el servidor GATT al `BleService`.
- `window.vaultSaveContacts` no expuesto: algunos cambios de contacto no se guardan.
- HTML sin escapar con datos del otro teléfono (nombre de archivo/contacto, último mensaje).
- Transferencias en base64 dentro de JSON (+33 %). `FileTransferManager.kt` (binario) desconectado:
  siguiente gran mejora de velocidad.
- Trozos con emojis/acentos pueden superar el MTU en bytes (el nativo trocea por caracteres).
- Sin cifrado (`crypto_vault.js` no se usa). `quickScanForNexoId` bloquea hasta 5 s.
- Manifest declara `.mesh.NordicMeshService` inexistente; falta `@capacitor/app`;
  `_showPaymentModal` usa `self` sin definir.

## Código no usado (visión a futuro)
Malla y relay (`src/mesh/`, `src/net/`, `server/relay/`), backup Fénix Shamir 3-de-5 (`src/fenix/`),
biometría (`src/auth/`, `plugins/nexo-auth`), The Stream (`src/stream/`), Chispas
(`src/vault/chispas/`). Pendiente: que el dueño comparta la visión del Proyecto (`docs/VISION.md`).
