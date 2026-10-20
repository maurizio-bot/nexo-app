# NEXO — Estado del proyecto y avance

Última actualización: 2026-10-20

## Cómo se construye
- Rama principal: `NEXOCHAT`. Cada push dispara `.github/workflows/build-apk.yml`, que publica una
  pre-release `nightly-<run_number>` con el APK (debug). También se puede lanzar a mano (workflow_dispatch).
- Firma: el secret `DEBUG_KEYSTORE_BASE64` ya existe (añadido 2026-10-20). Desde el build **2686**
  todas las APK se firman con la misma llave y se pueden instalar encima sin desinstalar.
  El dueño guarda una copia de la llave; no está en el repo.
- Solo entra en la APK lo que importa `src/main.js` (webpack). El resto de `src/` es código no usado.

## Qué hace la APK hoy
Mensajería P2P por Bluetooth LE sin servidores:
- Identidad `NX` + 8 caracteres, guardada en el almacenamiento interno.
- Cada teléfono es servidor GATT (servicio `0000abcd-…`) y cliente; anuncia su NEXO ID en manufacturer data.
- Chat con estados (pendiente → enviado → entregado → leído), cola de reenvío y sincronización por `seq`.
- Adjuntos: foto (comprimida 480px), vídeo, archivo, voz y ubicación, troceados por `src/ui/ble_ack.js`.
- Persistencia en JSON vía `saveToFile`/`loadFromFile` del plugin `plugins/nexo-ble`.

Archivos clave: `src/main.js`, `src/ui/ble_interface.js`, `src/ui/ble_ack.js`,
`src/vault/vault_manager.js`, `plugins/nexo-ble/android/src/main/java/com/nexo/ble/NexoBlePlugin.kt`.

## Historial reciente
| Build | Commit | Nota |
|---|---|---|
| 2679 | `04960e2` | Base funcional recuperada |
| 2680 | `7d44823` | Rompió el envío (JS mandaba `content`, el nativo lee `message`) |
| 2681–2683 | | Ajustes de tamaños y tiempos |
| 2684 | `f9f35ab` | Workflow con llave fija (pero faltaba el secret) |
| 2685 | `5962c6f` | **Fix del envío** (`_sendMessageNative` vuelve a mandar `message` + sobre v1 chat) |
| 2686 | `5962c6f` | Mismo código, primera firmada con la llave fija |

## Pendiente inmediato
- [ ] Probar la 2686 en dos teléfonos (desinstalando antes una última vez):
  texto corto, texto largo (>180 caracteres), foto, checks de entregado/leído.

## Problemas detectados (sin corregir todavía)
- `window.vaultSaveContacts` no se expone en `main.js`: algunos cambios de contacto de
  `ble_interface.js` no se guardan en disco.
- HTML sin escapar con datos del otro teléfono (nombre de archivo, nombre de contacto, último mensaje):
  riesgo de inyección.
- Transferencias lentas: trozos de 80 caracteres por JSON. `FileTransferManager.kt` (binario, FEC)
  está escrito pero desconectado.
- Los mensajes no van cifrados (`src/vault/crypto_vault.js` no se usa).
- `quickScanForNexoId` bloquea el hilo principal hasta 5 s si se pasa un NXID en vez de MAC.
- El manifest declara `.mesh.NordicMeshService`, que no existe.
- `@capacitor/app` no está instalado: el botón "Abrir Ajustes" y `appStateChange` no funcionan.
- `_showPaymentModal` en `src/app/nexo_app.js` usa `self` sin definir (pagos no se usan aún).

## Código no usado (visión a futuro)
Malla y relay (`src/mesh/`, `src/net/`, `server/relay/`), backup Fénix con guardianes Shamir 3-de-5
(`src/fenix/`), biometría (`src/auth/`, `plugins/nexo-auth`), The Stream (`src/stream/`),
Chispas (`src/vault/chispas/`). Pendiente: que el dueño comparta la visión del Proyecto de claude.ai
(idealmente como `docs/VISION.md`) para confirmar el objetivo final.
