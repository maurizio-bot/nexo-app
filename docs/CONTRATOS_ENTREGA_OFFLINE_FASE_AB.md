# NEXO — Contratos Fase A + B: entrega offline (buzón de archivos + wake robusto)

**Spec para codear sin ambigüedad.** 09-11-2026. Deriva de `DISENO_ENTREGA_OFFLINE_2026-11-08.md` + los 7 puntos de endurecimiento. Incluye el puntero v1 (aunque se use pleno en Fase C) para no re-trabajar.

## 0. Alcance
- **Fase A (JS):** wake-por-pendiente con backoff + token robusto en los dos sentidos.
- **Fase B (JS):** buzón de archivos **medianos** (trozos + huellas + varios relés + verificación + resume).
- Fan-out/reenvío por referencia = Fase C; cita completa+stream = D; blob-store/erasure/sender-keys = E.

## 1. Constantes (números concretos, ajustables)
| Constante | Valor | Por qué |
|---|---|---|
| `CHUNK_RAW_BYTES` | **40 KB** | Tras cifrar + base64 (~×1,33) ≈ 53 KB + tags/JSON ≈ 56 KB < ~60 KB del relé. **(Lección 2964: el límite del relé es sobre el evento YA codificado.)** |
| `MAILBOX_MAX_BYTES` | **5 MB** (~125 trozos) | Lo que se stagea en relés en Fase B. Más grande → Fase D/E. |
| `RELAY_REPLICATION` | **3** | Cada trozo en ≥3 relés (operadores distintos si se puede). Tolera caídas/expiración. |
| `MAX_POINTER_CHUNKS` | **10000** | **Ceiling anti-DoS**: rechazo inmediato si un puntero lo supera, ANTES de reservar/iterar (clase #2804/#2941). Muy por encima de lo legítimo (~125). |
| `MAX_POINTER_BYTES` | **64 MB** | Ídem, ceiling de tamaño. |
| `FCM_BACKOFF` | 30 s → 2 m → 8 m → 30 m → 2 h → **6 h (techo)**, jitter ±20 % | No quemar batería/cuota. |
| `GIVE_UP` | parar wake activo tras **min(TTL del blob, 7 días)** **o** **20 wakes fallidos seguidos** | No tocar un teléfono muerto para siempre; el blob ya expiró igual. |
| `BLOB_TTL` | **7 días** (expiration NIP-40) | Garantía real de limpieza (ver §2). |
| `MAX_CONCURRENT` | **3** | Transferencias pesadas simultáneas; el resto en cola. |
| `THUMB_MAX_BYTES` | **16 KB** | Techo duro de la miniatura dentro del puntero (que una miniatura enorme no lo infle). |

## 2. Evento de buzón (Nostr)
- `kind`: el que ya usa NEXO para el buzón de pareja.
- tag `p`: etiqueta del destinatario (**rota por día**, como hoy).
- tag `expiration`: `now + BLOB_TTL` (NIP-40).
- `content`: **sellado E2E** (ratchet de la pareja) = el **puntero** (§3) para archivos.
- **Borrado:** se INTENTA (NIP-09) al confirmar todos, pero **la garantía es el `expiration`** — el borrado en Nostr es *best-effort* (el relé puede ignorarlo).

## 3. Puntero v1 (dentro del `content` cifrado E2E)
```
{ v:1, kind:"file-pointer",
  k:    <32 bytes base64>,      // llave del blob
  alg:  "AES-256-GCM",
  nonce:<12 bytes base64>,      // el ÚNICO nonce del blob
  hash: <SHA-256 del blob cifrado>,
  size: <bytes del blob cifrado>,
  name, mime, thumb?,           // metadata, va cifrada acá
  chunks: [ { i, hash, size, ids:[<event_id por relé>] }, ... ],
  relays: [ <url>, ... ],
  expires: <ts> }
```
**Verificación OBLIGATORIA, en orden:**
1. **Rechazar** si `chunks.length > MAX_POINTER_CHUNKS`, `size > MAX_POINTER_BYTES`, o `thumb > THUMB_MAX_BYTES` → **antes** de reservar o iterar nada.
2. Por trozo: `SHA-256(trozo) == chunks[i].hash` antes de usarlo; si no, re-bajar de otro relé.
3. Al armar: `SHA-256(blob) == hash`; descifrar con `(k, nonce)` (GCM confirma integridad).
4. Los trozos se bajan por `event_id` **aleatorio** (va en el puntero), **no** por una etiqueta ligada al destinatario → **el relé no correlaciona** quién baja qué.

## 4. Cripto (reglas duras)
- **Un blob = un `(k, nonce)` = un cifrado. NUNCA** re-cifrar otro contenido con el mismo `(k, nonce)` → reusar `(k,nonce)` **rompe AES-GCM** (revela XOR de textos y tira la autenticación).
- `k` **aleatoria por archivo** (no derivada del contenido) → sin ataque de confirmación de archivo. **Consecuencia honesta:** el **dedup es por-blob (misma `k`)**, no universal: dedupea en la **cadena de reenvío**, no entre dos emisores que cifran el mismo archivo con `k` distinta.
- El puntero (con `k`) viaja **siempre E2E**. El blob **nunca** viaja sin cifrar.
- **Orden fijo (nunca al revés):** leer disco → **cifrar TODO el archivo** con `(k, nonce)` → `hash` del ciphertext → **partir el ciphertext** en trozos ≤`CHUNK_RAW_BYTES`. Jamás partir primero y cifrar trozo por trozo (llevaría a reusar nonce = romper GCM).
- **Emisor persiste** por cada trozo la lista completa `(relay, event_id)` para poder re-bajar de otro relé si uno falla.

## 5. Máquina de estados (emisor)
```
STAGING ──(cifrar 1 vez, partir, publicar en ≥RELAY_REPLICATION relés)──▶ PUBLISHED
PUBLISHED ──(confirmado por los relés)──▶ SEND_POINTER   ◀── INVARIANTE: el puntero NO sale hasta PUBLISHED
SEND_POINTER ─┬─ dest. online+local    ─▶ STREAM_DIRECT (sin buzón)
              ├─ dest. online+internet ─▶ (puntero; él baja)
              └─ dest. offline         ─▶ POINTER_IN_MAILBOX + WAKE_LOOP
WAKE_LOOP ──(backoff hasta GIVE_UP; al despertar el otro)──▶ DELIVERING ──▶ CONFIRMED ──▶ CLEANUP
GIVE_UP alcanzado ──▶ PASSIVE (se entrega al verlo / al abrir su chat)
```
- **Sub-flujo por destinatario, independiente**: uno atascado/offline va a su WAKE_LOOP y **no frena ni crashea** a los demás.
- **CLEANUP**: intentar borrar del relé; si no, expira por TTL.

## 6. Wake (Fase A — aplica a B/C)
- **Disparadores:** (a) hay pendientes para el contacto, (b) el contacto está en un fan-out.
- **Requisitos:** tener su token FCM **y** nosotros con internet; si no, no se dispara (no falla ruidoso).
- **Backoff + jitter** (§1); **GIVE_UP** (§1) → PASSIVE.
- **Mutuo:** el que recibe, al despertar, también toca al emisor (mismo backoff) si falta el grueso.
- **Token en los dos sentidos:** se re-intercambia en cada saludo y se guarda en la marca del buzón.

## 7. Estados visibles (UX honesta)
- ⏳ **«esperando que se conecte»** (store-and-forward), **nunca ✗**.
- Grupo: ✓ al primero, ✓✓ cuando todos (como #131).

## 8. Pruebas adversariales de A+B (cierran la fase)
- **A:** el wake con backoff **no spamea** (se verifica el calendario); **GIVE_UP corta** a los 20 fallos / TTL; token presente en los dos sentidos.
- **B:** trozo malo de un relé → se re-baja de otro y arma OK; blob se **verifica** contra `hash`; puntero con `chunks`/`size` gigante → **rechazo inmediato** (anti-DoS, 0 reserva); un relé cae → la **redundancia** cubre; llega por dos vías → **dedup**, una sola copia.

## 9. Fuera de A+B (va después)
Fan-out/reenvío por referencia (C) · cita completa+stream (D) · blob-store de terceros / erasure coding / sender keys de grupo (E).

## 10. Implementado en 2969 (Fase B) — lo que quedó distinto del borrador
- **Eventos-trozo:** `kind 1064` (no el kind del buzón de pareja) y **sin etiqueta `p`**: se bajan por `id` (§3.4). Motivo: los
  relés con NIP-42 solo dejan leer kind 1059 al destinatario etiquetado; un trozo sin etiqueta tiene que poder leerlo
  cualquiera que conozca su id. Solo llevan `expiration` (now + 7 d). Una clave secp256k1 aleatoria por blob → un único
  evento de borrado kind 5 (NIP-09) con los ids al confirmar (best-effort; la caducidad es la garantía).
- **Puntero v1 real:** `{ v:1, kind:'file-pointer', alg:'AES-256-GCM', k, nonce, hash, size, raw, chunk:40960,
  chunks:[{ i, n, id, r:[índices en relays] }], relays:[url…], expires, thumb? }`. La huella por trozo es el **id del
  evento** (SHA-256 del evento entero, trozo incluido): no hace falta un `hash` aparte por trozo. `raw` = bytes en claro
  (`size` = `raw` + 16 de GCM). El puntero viaja dentro de un adjunto normal E2E (`{type:'attachment', payload:'ptr', ptr}`)
  por el buzón de pareja de siempre (un solo paquete, con marca `n` → toque FCM de la Fase A).
- **Decisión de camino (emisor):** `bleInterface.sendFile` (sin enlace listo ni ruta Jump y contacto no alcanzable por internet
  → buzón de archivos; si algo se está conectando por Bluetooth se le dan los 8 s de siempre), `_sendFileBest` (enlace `net:`
  con el contacto caído) y `_resendPendingMessages` al volver internet (solo los adjuntos foto/vídeo/archivo; el resto sigue en
  espera). Si ningún relé guarda un trozo → el archivo queda PENDIENTE (código PEER_ABSENT), nunca ✗. Con el contacto EN LÍNEA
  no cambia nada. Interruptor `window.NEXO_BLOB_MAILBOX = false`.
- **Receptor:** `validatePointer` (techos §1 + coherencia interna) → bajada por lotes de 16 ids, relé por relé (los del puntero
  primero, después cualquier relé abierto), ≤3 bajadas a la vez, reintentos 30 s → 2 m → 8 m → 30 m hasta `expires`; el
  archivo se re-inyecta como un adjunto normal (`_blobResolved`) y recién entonces se guarda, se avisa y se confirma (✓✓ = ya
  está en el teléfono). El mismo puntero por dos vías → una sola copia (dedup por id de mensaje, se re-confirma).
- **Fuera de B, confirmado:** sin miniatura en el puntero todavía (campo previsto), sin toque mutuo, sin fan-out, > 5 MB igual que antes.
- **Pruebas que cierran la fase:** `tests/sim/blobmail.js` (§8-B adversarial) y `tests/sim/blobe2e.js` (dos teléfonos, B apagado).

---
*Con esto, Fase A y B se codean sin ambigüedad. Cada fase se cierra solo cuando pasa su batería adversarial (§8) + la batería completa, antes de subir.*
