# NEXO — Estado del proyecto

Última actualización: 2026-10-21

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
| 2693 | (este) | Mensajes retenidos al reabrir, control de flujo nativo por callback, progreso visible |

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
node tests/sim/lifecycle.js tests/sim/builds/wip --retain --close-no-service --asymmetric --js-delay=6000
```
Ver `tests/sim/README.md`. Límites: no simula la radio real (velocidad, alcance) ni Kotlin en sí.

## Problemas conocidos (sin corregir)
- `main.js` marca "enviado" a los 12 s aunque no haya confirmación (`_sentFallbackTimers`).
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
