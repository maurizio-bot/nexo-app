# NEXO — Estado del proyecto y avance

Última actualización: 2026-10-21

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
| 2686 | `5962c6f` | Mismo código, primera firmada con la llave fija. Prueba real: burbuja con "○", **no llega** |
| 2687 | `2e02b1c` | Fix claves de dispositivo (MAC normalizada). Subida sin verificar: no usar |
| 2688 | (este commit) | Fixes verificados con el simulador de dos teléfonos (`tests/sim/`), ver abajo |

## Pendiente inmediato
- [ ] Probar la 2688 en los dos teléfonos (se instala encima de la 2686/2687): texto corto, largo,
  foto, ✓ entregado / ✓✓ leído, y que un mensaje enviado con el otro lejos llegue al volver.

## Regla de trabajo
Antes de cada push que genere APK: `tests/sim/build.sh && node tests/sim/run.js tests/sim/builds/wip --content-fallback`
y comprobar que todas las comprobaciones de `RESULTADO` salen bien. Ver `tests/sim/README.md`.

## Fallos encontrados y corregidos (2688), todos reproducidos y verificados en el simulador
1. **Envío atascado ("○")** — desde `7d44823` el envío buscaba el estado del dispositivo con la MAC
   normalizada (`bbbb…`) y se guardaba con la nativa (`BB:BB:…`): nunca "listo", cola sin vaciar.
2. **AckSystem nunca vinculado** (desde el primer commit): `main.js` usaba `NEXO.app.bleInterface`, que
   aún era null. Sin él: nunca "entregado"/"leído" y fotos/archivos siempre fallaban ("!").
3. Mensaje largo reensamblado marcado `fromVault` → no se guardaba y se perdía con el chat cerrado.
4. Tipo de adjunto pisado por el MIME (`image/jpeg`, `text/plain`) → galería/archivos no se dibujaban.
5. `read_receipt` descartado por el dedup del `ack` del mismo mensaje.
6. Mensajes propios de texto no se guardaban en el vault (desaparecían al reabrir el chat).
7. Estado guardado podía retroceder (entregado → enviado); y sin chat abierto no se guardaba.
8. Nadie re-buscaba a un contacto desconectado: la cola no salía hasta abrir "Gente". Ahora se re-busca
   cada 15 s (máx. ~10 min) y una conexión entrante también vacía la cola.
9. Tras reiniciar la app, mensajes en "enviando" no se reenviaban nunca.
10. Completar una transferencia podía pisar el adjunto guardado con "[Archivo]".

Comparación en el simulador: la 2679 entregaba texto pero sin ✓ entregado/leído, archivos en "!" y sin
reenvío tras reiniciar; la 2686 no entregaba nada; la 2688 pasa todas las comprobaciones (3 corridas).

## Problemas detectados (sin corregir todavía)
- `main.js` marca "enviado" a los 12 s tras entregar el mensaje al nativo aunque no llegue confirmación
  (`_sentFallbackTimers`).
- La sincronización de sesión (`ss`/`sr` en `ble_ack.js`) compara `seq` de ambos teléfonos mezclados y
  puede reenviar mensajes ya entregados al reconectar (el receptor los descarta por id; solo es tráfico).
- No simulado: direcciones Bluetooth aleatorias de Android entre escaneo y conexión, alcance real.
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
