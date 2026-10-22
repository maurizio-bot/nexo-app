# NEXO — Contexto maestro del proyecto

> Documento de referencia para cualquier sesión de trabajo sobre NEXO. Leerlo **antes** de tocar código.
> Última revisión del código: rama `NEXOCHAT`, commit `f9f35ab` (16-oct-2026). Verificado contra el código el 19-oct-2026.
> `f9f35ab` solo cambia `.github/workflows/build-apk.yml`; el código JS y Kotlin es idéntico al de `009ec39` (16-sep-2026).
> Lo marcado como *(no verificado)* no se pudo comprobar desde el código.
> Actualizar la sección "Estado actual" cada vez que se cierre un avance importante.
> **Ojo (22-oct, build 2714):** las secciones 4 y 5 describen el código de `f9f35ab`. Desde entonces se corrigió
> casi todo lo que listan (hallazgo A, rendimiento, cifrado, Jump, Wi-Fi Direct...). El estado al día está en
> `docs/PROGRESO.md` y `docs/SEGURIDAD.md`; este documento vale sobre todo por la visión (1–3) y Fénix (7).

---

## 1. Qué es NEXO (visión)

NEXO es una **plataforma de comunicación e intercambio cercano**: rápida, directa y útil para la vida cotidiana. Muchas de sus funciones se hacen directamente entre dispositivos cercanos, sin depender de Internet ni de datos móviles.

- **Bluetooth es el medio, no el producto.** "Bluetooth es el comienzo. La utilidad es el producto."
- NEXO **no** se posiciona como "mensajería sin Internet" ni como "la app que funciona por Bluetooth". Debe ser útil **incluso cuando Internet funciona perfectamente**. La falta de Internet es una ventaja adicional, no la única razón para usarla.
- No intenta reemplazar a WhatsApp: busca crear **una categoría de utilidad distinta**.
- Meta de marca: que cuando alguien piense en las posibilidades de Bluetooth entre teléfonos, piense primero en NEXO.

### Experiencia de usuario

- Uso prácticamente inmediato, sin configuraciones largas. Interfaz atractiva, moderna, intuitiva y más ágil que la mensajería tradicional.
- Flujo central: **Entrar → buscar → encontrar → agregar → comunicar.**
  - El FAB es el acceso principal. Al pulsarlo, NEXO busca automáticamente usuarios cercanos y los muestra para agregarlos.
  - Al agregar un contacto, el usuario queda en su pantalla de contactos, listo para comunicarse.
- El usuario no debe pensar en la tecnología: "simplemente escribe y envía". NEXO elige el mejor medio disponible.

### Funciones

1. **Mensajes directos** entre usuarios cercanos, incluidos mensajes largos, de forma robusta.
2. **Archivos y multimedia**: fotos, imágenes de galería, archivos, documentos (PDF), notas de voz y audio, y otros contenidos en el futuro.
3. **Pagos por comunicación directa** entre personas o entre usuario y comercio, sin depender de datos en el momento de la interacción.
4. **Núcleos**: lugares con concentración natural de usuarios (universidades, escuelas, papelerías, cafeterías, eventos, tiendas). Más usuarios y dispositivos significan más utilidad.
5. **Multi-medio**: BLE primero; después Wi-Fi y datos, con una experiencia coherente.
6. **Jump**: la información avanza a través de otros dispositivos NEXO (multi-salto), lo que amplía el alcance.
7. **Fénix**: etapa posterior de esa infraestructura; una red más resistente y dinámica que aprovecha los dispositivos disponibles. Diseño detallado en la sección 7.

### Caso de uso emblema

**Estudiante → Papelería**: envía un PDF por NEXO → la papelería lo recibe → lo imprime → después se realiza el pago.
"No necesito datos para mandarte el archivo. Te lo mando por Nexo."

### Orden de construcción (acordado)

1. Primero hacer que NEXO sea una **certeza técnica**: BLE, archivos y el **YAML** (el workflow de build `.github/workflows/build-apk.yml`) completamente robustos.
2. Después, construir encima: núcleos, Jump/Fénix, Wi-Fi/datos y pagos.

> "YAML" = el pipeline de GitHub Actions que compila el APK. Ver la sección 4, "CI / YAML".

---

## 2. Identidad visual (de sesiones anteriores)

- Fondo negro puro (#000000) con acentos cian eléctrico, violeta profundo y naranja intenso.
- Logo: marca geométrica derivada de un diagrama de Venn, con anillos superpuestos.
- Principio creativo: "conectar personas" se expresa con **abstracción geométrica pura**, nunca con ilustración figurativa.

---

## 3. Forma de trabajar (método acordado)

- Repo: `github.com/maurizio-bot/nexo-app` (público). **Rama de trabajo: `NEXOCHAT`** (no `main`).
- Método de revisión para cada bug:
  1. Repo → rama NEXOCHAT → archivo específico → localizar la función.
  2. Ver quién la llama, qué parámetros recibe y qué llama después. Seguir la función a otros archivos si aplica.
  3. Comparar IDs y estado relevante (ej.: el `contactId` al guardar contra el `contactId` al actualizar).
  4. Modificar **solo** los archivos necesarios para ese bug.
  5. Entregar la ubicación exacta (archivo, función, problema, corrección) con el bloque de código listo para pegar.
  6. Build (GitHub Actions genera el APK nightly) → **prueba física en Samsung S24 Ultra**.
- Ejemplo resuelto con este método: mensajes atascados en "pending" porque `_updateMessageStorageStatus()` usaba `_getCurrentContactId()` (el contacto de la pantalla activa) en lugar de recibir el `contactId` como parámetro.

---

## 4. Arquitectura técnica

### Stack

- **App híbrida Capacitor 5** (WebView + plugins nativos). Web empaquetada con **webpack 5** (`src/main.js` → `dist/`).
- JavaScript estilo ES5 (`var`, `function`, sin template literals) en la mayoría de archivos. Mantener ese estilo.
- Plugin nativo propio **`plugins/nexo-ble`** (Kotlin) que hace todo el BLE. Android usa `plugins/nexo-ble/android` directamente (`android/capacitor.settings.gradle`).
- Plugin nativo `plugins/nexo-auth` (biometría). Se compila dentro del APK (`android/settings.gradle` y `android/app/build.gradle` incluyen `:capacitor-nexo-auth`), pero ningún archivo JS vivo lo usa.
- **CI / YAML** (`.github/workflows/build-apk.yml`): en cada push a NEXOCHAT (o manual con `workflow_dispatch`) → npm install → `npm run build:web` (webpack) → `cap sync android` → escribir `gradle.properties` → instalar keystore fijo → `gradlew clean assembleDebug` → release prerelease `nightly-N` con el APK `nexo-nightly-N-<sha7>.apk`.
  - Problema detectado (16-oct): no había `signingConfig` y cada runner generaba una llave debug nueva, así que **cada APK nightly se firmaba distinto**. Para instalarlo había que desinstalar la versión anterior, y eso borra NXID, contactos y mensajes.
  - **Corrección aplicada en `f9f35ab` (16-oct):** keystore de debug fijo desde el secret `DEBUG_KEYSTORE_BASE64` (copiado a `~/.android/debug.keystore`), permisos `contents: write`, `concurrency` con cancelación, caché de Gradle (`gradle/actions/setup-gradle@v4`), `action-gh-release@v2`, un solo paso de `gradle.properties` y nombre de APK con número de build y SHA. Antes el tag era `nightly-N-<sha completo>`; ahora es `nightly-N`.
  - Si el secret falta, el workflow solo emite un *warning* y sigue firmando con una llave nueva. Que el secret ya esté cargado en GitHub *(no verificado)*.
  - `ci.yml` (ramas main/develop) y `setup-android.yml` (para `client/`) no aplican a NEXOCHAT.
- `server/relay/websocket_server.py`: relay WebSocket (FastAPI) para un fallback por Internet. **No está conectado a la app.**

### Qué código está VIVO (entra en el APK)

Solo **9 archivos JS** llegan al bundle desde `src/main.js`:

| Archivo | Rol |
|---|---|
| `src/main.js` (~2.500 líneas) | Arranque, UI de chat, adjuntos (cámara, galería, archivo, ubicación, voz), render de mensajes, estados/ticks, listeners globales `nexo:ble:*` |
| `src/ui/ble_interface.js` (~2.400) | Puente JS ↔ plugin nativo: escaneo, conexión, estados de dispositivo, contactos BLE, FAB/panel, cola de pendientes, sessionSync, pausa BLE por cámara |
| `src/ui/ble_ack.js` (~1.000) | Protocolo de fiabilidad: ACK de mensajes cortos, `ChatStream` (chunks + ventana deslizante + block-ACK/NACK), reanudación de transferencias |
| `src/vault/vault_manager.js` | Persistencia de contactos, mensajes y transferencias en archivos JSON (vía `saveToFile` nativo) |
| `src/app/nexo_app.js` | Clase `NexoApp` (contenedor general) |
| `src/core/nexo_config.js` | Constantes y versión |
| `src/core/nap.js` | Diagnóstico y splash |
| `src/core/NexoPermissionShim.js` | Permisos BLE |
| `src/ui/rem.js` | Toasts y logs en pantalla |

Nativo vivo: `NexoBlePlugin.kt` (~2.050 líneas: GATT server + client, advertising, scan, MTU 512, cola de escritura, reconexión, notificaciones) y el foreground service `BleService.kt`. Los UUIDs están en `NexoBleSpec.kt`.

### Código que NO se usa (no se importa desde `main.js`)

`auth/*` (onboarding, WebAuthn), `fenix/*` (backup con Shamir/`shard_crypto`), `mesh/*` (nordic, hybrid), `net/*` (WebSocket, relay bridge), `stream/*`, `perf/virtual_engine.js`, `media/*` (`ble_file_transfer`, `ble_photos`, `ble_voice`, `attachment_handlers`), `vault/crypto_vault.js`, `vault/vault_fs.js`, `vault/vault_panel.js`, `vault/chispas/*`, `ui/SetupWizard.js`, `ui/autoscan.js`, `ui/gesture_engine.js`, `core/gesture_engine.js`, `core/SetupManager.js`, `core/ble_permissions.js`, `utils/permissions.js`.
En el nativo, `FileTransferManager.kt` (~1.780 líneas) y `sendFileNative` existen, pero el JS no los llama (se quitaron de `ble_interface.js`) y `ble_ack.js` descarta los chunks nativos `fm`/`fd`.

### Flujo de un mensaje de texto

`main.js` (input) → `bleInterface.sendChatMessage` → `ble_ack.sendChunkedMessage`:
- ≤150 caracteres: envío directo con reintentos y ACK (`sendWithRetry`).
- >150: `ChatStream` tipo `chat` (chunk 90, ventana 4).

→ `bleInterface._sendMessageNative` → `NexoBLE.sendMessage` (Kotlin) → escritura GATT / notify.

Recepción: evento nativo `onPayloadReceived` → `ble_interface` → `ble_ack.processIncomingFragment` (reensambla) → evento `nexo:ble:messageReceived` → `main._handleIncomingMessage` → render + vault + read receipt.

### Flujo de un adjunto (foto, video o archivo)

`main._sendAttachment` → compresión (fotos a 480px, JPEG q0.5) → `bleInterface.sendFile` → `ble_ack.sendFile` → `ChatStream` tipo `file`: chunk de **80 caracteres base64 (~60 bytes reales)**, ventana 4, pacing 25 ms, timeout de ventana 8 s, timeout global de 10 min como base, que escala con el número de chunks hasta un tope de 15 min. Los videos (webm) y archivos no se comprimen.
Recepción: `ble_ack` reensambla → `nexo:ble:fileComplete` → `main._handleIncomingMessage`. Hay **un solo flujo** de mensajes (el flujo paralelo de `attachment_handlers` ya se eliminó).

Audio y ubicación viajan como mensaje JSON por la ruta de texto.

### Estados (ticks)

`pending → queued → sending → sent → delivered → read` (más `failed`). `main.js` impide degradar el estado (`_canUpgradeStatus`).

### IDs

- `nexoId` (NXID, 10 caracteres que empiezan por `NX`, ej. `NX0AB12CD3`): identidad lógica del usuario, guardada en `nexo_advertising_id.json`.
- MAC: dirección BLE. El nativo resuelve NXID → MAC (`resolveMacForNexoId`, archivo `nexo_nxid_mac_map.json`).
- UUIDs BLE: servicio `0000abcd-…`, RX `0000abce-…`, TX `0000abcf-…`.

---

## 5. Estado actual (revisión del 19-oct-2026, commit `f9f35ab`)

| Área | Estado | Notas |
|---|---|---|
| Build / YAML (CI) | 🟡 Compila; firma fija ya en el workflow | Depende de que el secret `DEBUG_KEYSTORE_BASE64` exista *(no verificado)*. Resultado del primer build con `f9f35ab` *(no verificado)* |
| Descubrimiento y conexión BLE | 🟡 Funcional, en endurecimiento | GATT dual (server + client), reconexión con backoff, foreground service |
| Mensajes de texto (cortos y largos) | 🔴 **Bug confirmado en el código** | Ver hallazgo A. Sigue presente en `f9f35ab` |
| Ticks y estados | 🟡 Implementado | Anti-degradación de estados lista |
| Fotos | 🟡 Funciona lento | Solo fotos comprimidas a 480px |
| Archivos, PDF y video | 🔴 No viable todavía | Ver hallazgo B |
| Notas de voz y ubicación | 🟡 Implementado vía JSON | Sin pruebas de fiabilidad documentadas |
| Reescaneo/reconexión automática al volver | 🔴 No activo | `_autoScan` nunca se inicializa (`autoscan.js` no se importa) |
| Cifrado | 🔴 **No existe en el código vivo** | Mensajes en claro por BLE y en disco. `crypto_vault.js` existe, pero no se usa |
| Wi-Fi / datos / relay | ⚪ No integrado | El código existe en `net/` y en `server/`, desconectado |
| Jump / Fénix (multi-salto) | ⚪ No iniciado en código vivo | El wrapper `jump` se descarta a propósito en `main.js`. El botón "jump-to-bottom" es solo scroll, no es Jump |
| Pagos | ⚪ No iniciado | |
| Núcleos | ⚪ No iniciado | |

### Hallazgos críticos de la revisión

**A. Regresión en el envío (commit `7d44823`, "Ble interface", 16-sep). Confirmada en el código de `f9f35ab`; falta confirmarla en el teléfono.**
Esa reescritura de `_sendMessageNative` en `ble_interface.js` cambió el payload hacia el nativo:
- Antes: `{ deviceId, message: enrichedPayload }`. El texto iba envuelto con `senderNexoId`, `senderName` y `timestamp`, se validaba que el dispositivo estuviera `READY_TO_CHAT` y se resolvía NXID→MAC.
- Ahora: `{ deviceId, content, messageId, seq }`.

`NexoBlePlugin.sendMessage` (Kotlin, ~línea 1294) lee `call.getString("message") ?: ""`, y `_sendMessageNative` (`ble_interface.js`, ~línea 1276) manda `content`. Con el payload nuevo, **recibe un string vacío**. Todo lo que pasa por `_sendMessageNative` (texto, chunks de archivo, ACKs, ping) podría estar enviándose vacío. Además, sin el envoltorio, el receptor pierde `senderNexoId`.
→ Confirmar en el S24 Ultra con logs (`[SEND] sendMessage ... len=0`). Arreglo mínimo: enviar `message: content` desde JS, o hacer que Kotlin lea `content` como respaldo. También hay que revisar si el envoltorio que se eliminó era necesario para el receptor.

**B. El rendimiento de archivos no alcanza para el caso de la papelería.**
Con un chunk de 80 caracteres base64 (~60 bytes reales) más JSON, ventana 4, pacing y espera de block-ACK, la estimación ronda **~0,5–1 KB/s**:
- Una foto comprimida (~30 KB) tarda alrededor de 1 minuto.
- Un PDF de 1 MB tardaría **más de 20 minutos** y choca con el tope de timeout de 15 min.

El nativo negocia MTU 512 (~509 bytes útiles por paquete), es decir, se está usando ~1/6 de la capacidad por paquete. Además, cada chunk cruza el puente JS↔nativo y genera varios `console.log`.
→ Mejoras posibles:
1. Usar chunks dinámicos según el MTU negociado (~350–400 caracteres).
2. Una ventana más grande.
3. Quitar logs por chunk.
4. A medio plazo, mover el troceo de archivos al nativo (`FileTransferManager.kt` ya existe), con binario en lugar de base64.
5. Para archivos grandes, escalar a Wi-Fi Direct / Nearby después del handshake BLE.

**C. Inconsistencias menores**
- `MAX_BLE_B64_BYTES = 8000000` en `main.js`, pero su comentario dice "~250KB". Con el rendimiento actual, 8 MB no se completa nunca.
- La cabecera de `ble_ack.js` dice "chunk 60, ventana 3, pacing 40ms", pero las constantes reales son 80 / 4 / 25.
- `node_modules/` (4.069 archivos), `plugins/nexo-auth/android/build/` (47 archivos) y `local.properties` siguen commiteados en `f9f35ab`, aunque `.gitignore` excluye `node_modules` (no excluye `local.properties` ni `build/`). Conviene sacarlos del repo (`git rm -r --cached`) y añadirlos al `.gitignore`.
- Hay duplicados como `client/` (otra app Capacitor), `android/.github/workflows`, `src/mesh/nordic_mesh.js.backup` y `client/index.html.backup`.

---

## 6. Roadmap propuesto

**Fase 1 — Certeza técnica (actual)**
1. Resolver el hallazgo A y validar texto corto y largo entre dos teléfonos.
2. Validar los ticks completos (enviando → enviado → entregado → leído) y la cola de pendientes al reconectar.
3. Activar el reescaneo y la reconexión automática al abrir la app o tras perder la conexión.
4. Rendimiento de archivos (hallazgo B). Objetivo: un PDF de 1 MB en un tiempo razonable.
5. YAML robusto: la firma fija ya está en el workflow (`f9f35ab`); falta confirmar el secret y que un nightly actualice sin desinstalar.
6. Cifrado extremo a extremo básico (intercambio de llaves al agregar un contacto + AES-GCM por mensaje) y vault cifrado.

**Fase 2 — Utilidad cotidiana**: flujo FAB → agregar → chatear pulido, envío de PDFs y documentos, transporte Wi-Fi/Nearby para archivos grandes y caso papelería de punta a punta.

**Fase 3 — Red**: Jump (multi-salto con TTL y deduplicación), luego Fénix y los núcleos.

**Fase 4 — Pagos**: sobre la identidad y las firmas de la Fase 1. Hay que considerar el doble gasto sin conexión, la conciliación posterior y la regulación financiera aplicable.

---

## 7. Protocolo Fénix (diseño del dueño, 22-oct-2026)

> **Estado: planeado (roadmap, Fase 3).** Es la definición que dio Maurizio. El código vivo no implementa nada de esto; ver "Qué hay hoy en el código" más abajo.

Sistema de seguridad y persistencia para que la información crítica de NEXO **nunca se pierda**, sea **ilegible para terceros** y se **reconstruya sola** cuando caen nodos. "Mientras exista un camino de conectividad, la información siempre podrá resurgir de sus cenizas."

1. **Blindaje y fragmentación ("El Sacrificio")**
   - Cifrado fuerte del archivo, vinculado a la **clave maestra** del usuario, antes de moverlo.
   - **Sharding**: el archivo cifrado se divide en fragmentos pequeños; ninguno por sí solo es útil.
   - **Distribución inicial** entre **Nodos de Confianza** (dispositivos o servidores autorizados).
2. **Redundancia y expansión ("La Regla de 20")**
   - Al llegar a **20 nodos**, se activa una **copia espejo** automática de toda la estructura.
   - **Dualidad de piezas**: en todo momento, al menos **dos copias idénticas** de cada fragmento en nodos físicamente distintos.
3. **Vigilancia y autocuración ("El Pingeo Diario")**
   - **Heartbeat** diario a cada nodo.
   - Si un nodo no responde, se identifica qué fragmentos tenía.
   - **Self-healing**: se clona el fragmento desde su gemelo y se aloja en otro nodo de confianza, para volver a 2x antes de un segundo fallo.
4. **Reconstrucción ("El Renacimiento")**
   - Solo el usuario autorizado puede iniciar la reunión ("Llamada al Nexo").
   - Se piden los fragmentos a los nodos activos, se verifican con **firmas digitales** y se ensamblan en orden.
   - Con el archivo cifrado completo, se descifra con la clave maestra.

### Qué hay hoy en el código (revisado en la cabeza de `NEXOCHAT`, `312f098`, 22-oct)

- `src/fenix/fenix_backup.js` y `src/fenix/shard_crypto.js` (de marzo de 2026, ya estaban en `f9f35ab`). **No se importan desde `main.js`**: no entran en la APK. Implementan **otra idea**: respaldo de **una clave de 32 bytes** (no de archivos) con **Shamir 3-de-5** entre 5 contactos "guardianes" elegidos por puntuación de confianza, cada trozo cifrado para su guardián (ECIES P-256 + AES-GCM + HMAC) y verificado con SHA-256.
- Lo que no está: envío real (`_sendToGuardian` y `_deleteFromGuardian` son stubs), métodos del vault que llama (`wrapKeyForFenix`, `unwrapForFenix`, `generateIdentityKeyPair` no existen en ningún archivo), réplica 2x, regla de 20, heartbeat a nodos, autocuración y firmas digitales por fragmento.
- Piezas reutilizables: el Shamir de `shard_crypto.js` (probado por su propio `selfTest`) y el cifrado por destinatario de `fenix_backup.js`. El único heartbeat del repo es el de `src/net/web_socket_client.js` (cada 30 s, para la conexión WebSocket, también sin usar).
- `docs/PROGRESO.md` del repo ya anota que se esperaba que el dueño confirmara si "Fénix" era `src/fenix/`. Esta definición indica que Fénix es más amplio: almacenamiento distribuido de archivos.

### Preguntas abiertas (sin resolver)

1. **"2x" y la regla de 20.** Si siempre debe haber al menos dos copias de cada fragmento, ¿qué añade la copia espejo al llegar a 20 nodos? ¿Por debajo de 20 hay una sola copia, o el espejo sería una tercera?
2. **¿Qué cuenta para los 20?** ¿Nodos de confianza de un usuario, de la red NEXO entera, de un núcleo, o fragmentos por archivo?
3. **"Clave maestra".** ¿Es la contraseña del usuario (derivada con PBKDF2, como en `crypto_vault.js`), una clave aleatoria guardada en el teléfono, o la identidad de cifrado (Signal) ya existente? Si se pierde junto con el teléfono, los fragmentos no se pueden descifrar: ¿el Shamir de guardianes de `src/fenix/` sería su respaldo?
4. **Nodos de Confianza.** ¿Quién los autoriza: contactos, dispositivos propios, servidores de NEXO? ¿Aceptan guardar datos ajenos (espacio, batería)?
5. **Pingeo diario sin Internet.** ¿Quién hace el ping (el teléfono del dueño, que puede estar apagado, o los nodos entre sí)? ¿Cómo se llega a un nodo fuera de alcance Bluetooth: Jump o Internet? Con ping diario, una caída se detecta hasta 24 h después, no "inmediatamente".
6. **Firmas digitales.** ¿Quién firma cada fragmento (el dueño al crearlo) y con qué clave?
7. **Qué se protege.** ¿Archivos, mensajes, la identidad y las claves, o todo? Hoy el código solo respalda una clave.
8. **Relación con la visión (sección 1, punto 7).** Allí Fénix aparece como "una red más resistente y dinámica". Esta definición lo describe como almacenamiento resistente. ¿Son lo mismo o dos capas?
9. **"Grado militar".** Falta concretar el algoritmo (por coherencia, AES-256-GCM como el resto de NEXO).

---

## Registro de avances

### 22-oct-2026
- Añadida la sección 7, "Protocolo Fénix", con la definición del dueño. Queda como diseño planeado: el código de `src/fenix/` es otra idea (Shamir 3-de-5 de una clave) y no está en la APK.
- La rama `NEXOCHAT` ya va 50 commits por delante de `f9f35ab` (cabeza `312f098`). El resto del documento no se ha vuelto a verificar contra ella.

### 19-oct-2026
- Documento verificado contra el código en `f9f35ab` (cabeza de NEXOCHAT). Es la base actual de trabajo.
- `f9f35ab` (16-oct) reemplazó `build-apk.yml` con la firma fija. Es el único cambio desde `009ec39`.
- El hallazgo A sigue en el código: `_sendMessageNative` manda `content` y Kotlin lee `message`.
- Sin verificar: si el secret `DEBUG_KEYSTORE_BASE64` está cargado, el resultado del nightly de `f9f35ab`, y los datos de la release #2679 y de las pruebas en el S24 Ultra (vienen de lo que contó el usuario).

### 16-oct-2026 (noche)
- **Release de referencia que funciona:** nightly #2679, commit `04960e2`. Mensajes cortos y largos entregados correctamente en pruebas del usuario.
- **Ojo:** el commit `7d44823` (cambio de `_sendMessageNative` a `content`) es posterior a `04960e2`. Por eso la release #2679 no tiene el problema, pero **cualquier build desde `009ec39` o posterior (incluida la cabeza actual `f9f35ab`) sí lo incluye**. Si el próximo nightly sale con mensajes vacíos, esta es la causa probable.
- **Pendiente antes de instalar el siguiente nightly:**
  1. Corregir `content` / `message` (ver sección 5, hallazgo A) o revertir ese cambio.
  2. Subir el secret `DEBUG_KEYSTORE_BASE64` y reemplazar `build-apk.yml`. *(19-oct: `build-apk.yml` ya se reemplazó en `f9f35ab`; el secret no se pudo verificar.)*
  3. Hacer un respaldo de NEXO antes del cambio de firma: la primera instalación firmada con la llave fija exige desinstalar la versión actual, y eso borra NXID, contactos y mensajes.
- **Pruebas pendientes para mañana:** descargar y probar la nueva APK en el S24 Ultra con otro teléfono. Verificar ticks, cola de pendientes tras reconectar y envío de una foto.
