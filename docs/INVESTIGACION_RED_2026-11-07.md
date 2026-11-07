# Investigación red NEXO: escaneo, conexión y envío (mensajes/imágenes/archivos) vs estado del arte

Fecha: 2026-11-07 · Builds ~2942/2943 · Método: 5 investigaciones en paralelo (3 de internet con fuentes citadas + 2 mapas del código real con `archivo:línea`). Objetivo del dueño: **igualar o superar a las apps de mensajería actuales, con resultados reales y evidentes.** Honestidad primero: se distingue lo que da ganancia de *cliente* (copiable sin servidor) de lo que depende de *servidor/CDN* (no copiable en P2P puro).

---

## 0. Veredicto en una frase

NEXO **no está atrás**: en varias cosas ya hace lo que recomienda el estado del arte (multi-camino con preferencia Wi-Fi→internet→Bluetooth, envío grande cede la radio al chat, acuses firmados, guardia anti-DoS de JSON, Double Ratchet + poscuántico, store-and-forward por relés). Lo que lo frena no es la arquitectura: son **una decena de huecos concretos** en el borde nativo (reconexión, escaneo a escala, cola de operaciones Bluetooth) y en la consolidación de caminos. Casi todos son de **estabilidad y velocidad percibida**, que es exactamente lo que el dueño sufre. Abajo están priorizados con evidencia de código y de fuente.

---

## 1. Lo que NEXO YA hace bien (para no romperlo y para saber dónde estamos)

Confirmado en el código:

1. **Resolvedor de camino con el orden correcto** (`ble_interface.js:288-340`): Wi-Fi misma red → internet-si-ambos-Wi-Fi → (archivo grande) internet → Bluetooth listo → internet (datos móviles). Es el orden que piden Ditto/Nearby.
2. **El envío grande cede la radio al chat/llamada** (`ble_ack.js` `_bulk`/`BULK_PRIO`/`_interactiveActive`). Es, de hecho, el patrón "scavenger/LEDBAT" que recomienda la literatura (RFC 6817): un archivo no debe ahogar lo interactivo. **Ya lo tenemos.**
3. **Mecanismos GATT óptimos**: escritura sin respuesta (`WRITE_TYPE_NO_RESPONSE`) y notificaciones (`NexoBlePlugin.kt:1980-2033`) — los dos canales más rápidos; nunca "indications" para bulk. Correcto.
4. **MTU 517 pedido temprano** + fallback a 247 si queda en 23 (`NexoBlePlugin.kt:1541,1591-1595`). Alineado con el cambio de Android 14 (pedir MTU una vez, temprano).
5. **Acuses (✓✓) autenticados con MAC de la pareja** en protocolo 2 (`AUDITORIA.md` C1) — cierra la falsificación de "entregado". Mejor que Bridgefy.
6. **Guardia anti-DoS de parseo** (`SafeJson.reject`, `BinFrame` valida tamaños antes de parsear): protege contra la clase de ataque "zip bomb" que **colgó toda la malla de Bridgefy** (reenviaban antes de parsear). Ya estamos cubiertos ahí.
7. **Fiabilidad de aplicación por encima del transporte**: IDs por mensaje + ventana + ACK/NACK de huecos reales + resume + block-ack + outbox persistente + optimistic UI. Es el "hilo común" de Briar/Berty/Bitchat/Ditto.
8. **Store-and-forward serverless** por relés (buzón de internet) + FCM despertador: el equivalente al "Briar Mailbox" para el receptor ausente.
9. **Cripto de núcleo fuerte**: Double Ratchet (Signal) + AAD que liga emisor/destino/id + poscuántico ML-KEM-768. Por delante de casi toda app de malla.
10. **Throttle de escaneo que respeta el límite de Android** (`ble_connections.js:391-411`, ventana 4/30 s) y maneja `SCAN_FAILED_TOO_FREQUENTLY`. Muchas apps fallan justo acá; NEXO no.

Conclusión: la base es sólida. Las mejoras de abajo son **de borde**, no de rediseño.

---

## 2. ESCANEO / DESCUBRIMIENTO

### Estado del arte (fuentes)
- Límite Android: **5 `startScan` por 30 s por app**; al excederlo **falla en silencio** (Android 7-12). Best practice: **una sesión de escaneo larga**, no ciclos cortos. (developer.android.com/ScanCallback; Punch Through.)
- Para descubrir rápido: `SCAN_MODE_LOW_LATENCY` + **`MATCH_MODE_AGGRESSIVE`** + **`ScanFilter` descargado al hardware** (obligatorio en segundo plano; ahorra CPU/batería) + **`CALLBACK_TYPE_FIRST_MATCH`** para no inundarse. Anuncio conectable en `LOW_LATENCY` (~100 ms) con UUID en los 31 bytes.
- **Multitud (concierto)**: la tasa de colisión sube a 0.22-0.33 con 2-14 anunciantes; mitigar con **escaneo PASIVO** (el activo añade scan-requests y congestiona), `FIRST_MATCH`+`MATCH_LOST`, **jitter** entre anuncios, y Coded PHY **solo para alcance, no para densidad** (ocupa 2-8× más aire). (PMC6983080; capture effect HAL; BeaconZone.)

### Qué hace NEXO hoy
- Nativo: **siempre `SCAN_MODE_LOW_LATENCY`** (`NexoBlePlugin.kt:2210`); **sin `ScanFilter` por defecto** — solo filtra si el JS pasa `filtered=true` (`:2143-2147`); auto-stop a los 15 s (hay que re-armar); `MIN_RSSI=-95`; **sin `MATCH_MODE_AGGRESSIVE` ni `FIRST_MATCH`**; sin escaneo oportunista.
- JS: ventana global 4/30 s (bien), auto-scan con `filtered=true` (bien), maneja `TOO_FREQUENTLY` (bien). Pero el **escaneo de usuario** y la resolución NXID→MAC no siempre filtran.
- **Punto grave de rendimiento** (`NexoBlePlugin.kt:529-569,560-564`): al mandar a un contacto cuyo código rotativo no está en caché, hace un **escaneo BLOQUEANTE de hasta 5 s en el hilo principal** (`quickScanForNexoId` con `CountDownLatch`), alcanzable desde `sendMessage`/`connectToDevice` → **la app se congela hasta 5 s al enviar**.

### Brechas → mejoras (evidentes)
- **E-1 (alto). El escaneo por defecto no filtra y va a máxima potencia.** En un lugar lleno procesa TODOS los anuncios del aire → CPU/batería. **Mejora:** `ScanFilter` por fabricante NX **siempre** (no solo en auto-scan) + `MATCH_MODE_AGGRESSIVE` + `FIRST_MATCH`. _Dimensión: capacidad, estabilidad, batería._
- **E-2 (alto). Escaneo bloqueante de 5 s en el hilo principal.** Explica tirones reales al enviar. **Mejora:** sacarlo a un hilo/callback asíncrono; nunca bloquear el puente. _Dimensión: velocidad, estabilidad._
- **E-3 (medio). Falta "modo multitud".** Para el escenario concierto (tarea #126): escaneo **pasivo** + `FIRST_MATCH`+`MATCH_LOST` + jitter en el anuncio. _Dimensión: capacidad._
- **E-4 (bajo). Mapas de escaneo sin tope** (`scannedDevices`, `nxidToMacMap` **persistido y solo crece**). **Mejora:** LRU/evicción. _Dimensión: estabilidad a largo plazo._

---

## 3. CONEXIÓN

### Estado del arte
- **Interpretar los códigos de estado distinto** (son HCI, no ATT, aunque coincidan en número): **8** = supervision timeout (reconectar), **19** = el par cortó a propósito (**no spamear** reconexión), **133** = genérico (**`close()` + esperar + reintentar**), **147** = timeout (reconectar). (developer.android.com/BluetoothGatt; Nordic.)
- **`gatt.close()` en toda desconexión ≠ 0** (si no, fuga de recursos → más 133).
- **Backoff exponencial CON jitter** (AWS Well-Architected; Marc Brooker): sin jitter los reintentos se **sincronizan en ráfagas**.
- **Cola FIFO de operaciones GATT con timeout**: emitir UNA op a la vez (read/write/MTU/discover/notify) y esperar su callback; si lanzás varias, **solo la 1ª funciona y las demás fallan en silencio**. "Probablemente el mayor arreglo de robustez" (Punch Through, Nordic).
- **~7 conexiones** simultáneas (`GATT_MAX_PHY_CHANNEL`); planear **4-6 fiables**; a la 8ª con `autoConnect=true` el stack puede colgarse.
- `CONNECTION_PRIORITY_HIGH` solo durante ráfagas, volver a `BALANCED` (lo dice el propio doc oficial) para no fundir batería.

### Qué hace NEXO hoy
- `connectGatt(..., TRANSPORT_LE)` (bien), timeout 15 s, **`requestConnectionPriority(HIGH)` una vez, nunca lo baja** (`:1486`).
- `gatt.close()` en desconexión (bien, `:1465`).
- **Sin manejo por código**: 133/8/19/147 van todos al **mismo branch genérico** (`:1450-1469`) → un 133 persistente **quema los 10 reintentos**, y un 19 (el par colgó) **spamea reconexión**.
- **Backoff SIN jitter**: `3000·2^n` cap 30 s (`:1670-1674`). En tu diagnóstico del crasheo se ven **decenas de reintentos casi sincronizados** — esto es justo la falta de jitter.
- **La reconexión depende de tener el dispositivo en la caché del último escaneo** (`:1692-1696`); si el escaneo paró, **no hace nada**. Esto explica una línea EXACTA de tu diagnóstico: `No hay device cacheado para ... no se puede reconectar`.
- **Sin tope de conexiones** (`gattClients`/`serverConnectedDevices` sin límite).
- **Serialización GATT ad-hoc**: MTU→notificaciones con un `sleep` de 2 s (`:1541-1543`), pero no hay una cola general de operaciones → clase de bugs "fantasma".

### Brechas → mejoras (evidentes)
- **C-1 (alto). Backoff sin jitter → tormentas de reconexión.** **Mejora:** full/decorrelated jitter en `getReconnectDelay` y en `_attemptAutoReconnect` (JS). _Dimensión: estabilidad, batería._ (Impacto directo en lo que viste.)
- **C-2 (alto). Reconexión dependiente de caché de escaneo → no-op silencioso.** **Mejora:** re-escanear (o `autoConnect=true` pasivo) para reenganchar sin depender de la caché. _Dimensión: estabilidad._ (Explica el `No hay device cacheado` de tu log.)
- **C-3 (alto). Sin manejo por código de estado.** **Mejora:** 19 → no reconectar agresivo; 133 → `close()`+espera+N reintentos acotados; 8/147 → reconectar con backoff+jitter. _Dimensión: estabilidad, batería._
- **C-4 (medio). Cola general de operaciones GATT con timeout.** Hoy solo las ESCRITURAS tienen cola; las ops de control no. **Mejora:** una FIFO para toda op GATT. _Dimensión: estabilidad (bugs fantasma)._
- **C-5 (medio). `CONNECTION_PRIORITY_HIGH` nunca baja.** **Mejora:** HIGH durante ráfaga, BALANCED al terminar. _Dimensión: batería._
- **C-6 (bajo). Sin tope de conexiones.** **Mejora:** cap 4-6 + rotación en malla grande. _Dimensión: capacidad._

---

## 4. VELOCIDAD / TRANSPORTE

### Estado del arte (números reales)
- **BLE techo de aplicación ~1.2-1.3 Mbps** (2M PHY + DLE + MTU 517), **pero ~20 kB/s típico** en apps de malla reales; **L2CAP CoC vs GATT en Android: ganancia MODESTA** (~66 vs 63 KB/s) — el cuello es la radio/PHY, **no** el protocolo host. O sea: L2CAP **no** es un acelerón mágico.
- **El acelerón real para bulk es saltar a Wi-Fi**: Wi-Fi Direct 20-50 Mbps medido (teórico 250), Wi-Fi Aware 100-250+ Mbps. Patrón AirDrop/Quick Share/Nearby: **BLE descubre y arranca, Wi-Fi transporta el grueso.** A ~1 Mbps de BLE, **50 MB = 7-8 min**.
- Verificar **2M PHY y DLE en runtime** (`onPhyUpdate`): pedir 2M **no garantiza** que se use; sin DLE un MTU grande se fragmenta a PDUs de 27 y se pierde casi toda la ganancia.

### Qué hace NEXO hoy
- BLE con escritura-sin-respuesta + notificaciones (óptimo). Troceo por MTU. **L2CAP CoC implementado** (`bigSendL2`/`bigServeL2`, `NexoBlePlugin.kt:3772-3835`) — comentado como "más lento que Wi-Fi" (correcto según la evidencia).
- **Wi-Fi Direct implementado** pero **el grupo se arma y se derriba en CADA transferencia** (`wdTearDown` tras cada envío, `:3950-3959`); el "grupo caliente" persistente (`WdWarm.kt`) es **andamiaje sin cablear**. → cada media paga ~3-6 s de formar grupo.
- **No se verifica 2M/DLE** explícitamente (`setPreferredPhy(2M)` sin chequear `onPhyUpdate`).
- Dos nociones de "archivo grande" con umbrales distintos (3,1 MB in-memory vs ~22 MB disco-a-disco) y dos topes (40 MB WD vs ~1,1 GB L2CAP).

### Brechas → mejoras
- **V-1 (alto para media). Grupo Wi-Fi Direct caliente (no derribar por transferencia).** Cablear `WdWarm`: formar una vez y reusar. _Dimensión: velocidad, capacidad._ (Mandar 5 fotos seguidas hoy paga 5× la formación.)
- **V-2 (medio). Verificar 2M PHY + DLE y registrarlo en el diagnóstico.** Si un teléfono se queda en 1M/PDU 27, saberlo. _Dimensión: velocidad._
- **V-3 (medio). Unificar las dos nociones de "archivo grande" y los dos topes** (sigue la línea de la regla única 2943). _Dimensión: estabilidad._
- **Nota honesta:** migrar bulk de GATT a L2CAP CoC da poco (la evidencia dice ~5%); **no** vale la pena como "acelerón". Lo que sí vale es el camino Wi-Fi caliente (V-1).

---

## 5. MENSAJES, IMÁGENES Y ARCHIVOS

### Estado del arte (separando cliente vs servidor)
- **Copiable sin servidor (cliente):** comprimir/transcodificar **antes** de enviar (la palanca nº1 a ~1 Mbps), **BlurHash** (placeholder de ~20-50 bytes inline → la imagen "aparece" al instante), **resume** (offset tipo tus, o bitmap de chunks faltantes), **árbol de hashes Merkle** (hojas 16-64 KB = ID de contenido + verificación por chunk O(log n) + resume por índice + **dedup**, todo en una estructura), recibos por **máquina de estados monótona por destinatario**, **optimistic UI + outbox persistente** con dedup por message-id, **faststart** (mover el `moov` al frente del MP4 para reproducir mientras baja).
- **FEC/RaptorQ**: **solo gana en 1→N (difusión/grupo), canal de un sentido, o "mando y me voy"**. En 1→1 sobre BLE **no vale** (el enlace ya retransmite gratis; el decode de FEC cuesta CPU en gama baja). (RFC 6330; Nordic; AWS.)
- **NO copiable (servidor/CDN):** descarga paralela por rangos desde N datacenters, retención 45 días, store-and-forward a receptor ausente (→ equivalente serverless = relay/mailbox).

### Qué hace NEXO hoy
- Troceo + ventana (`FILE_WINDOW_SIZE=12`) + **block-ack cada 4** + **NACK solo de huecos reales** + **check por chunk (FNV)** + **resume** por registro de vault. Bien encaminado.
- **Recibos sent/delivered/read** (y hoy arreglé que 'pending'/esperando se vea — 2940). Optimistic UI + outbox persistente (`send.js`). Bien.
- **Vídeo**: previa 240p + HD automático (tareas #2/#3); **miniatura (poster) del vídeo** se manda.
- **Falta**: **BlurHash** para imágenes (hoy no hay placeholder instantáneo), **content-addressing/Merkle/dedup** (se puede reenviar algo que el otro ya tiene), **FEC para envío de archivo a GRUPO** (1→N, justo donde SÍ gana), y confirmar que las **imágenes** se transcodifican/comprimen antes de enviar (el vídeo sí; la imagen conviene verificar el objetivo ~1600 px).

### Brechas → mejoras
- **M-1 (alto, barato, muy evidente). BlurHash inline para imágenes.** La foto "aparece" borrosa al instante y se afina al cargar. ~20-50 bytes en el mensaje. _Dimensión: velocidad percibida._ (Esto es lo que hace sentir "instantáneo" a WhatsApp.)
- **M-2 (medio). Verificar/mejorar compresión de imagen antes de enviar** (objetivo ~1600 px, JPEG/WebP). Mandar menos bytes es la palanca nº1 a 1 Mbps. _Dimensión: velocidad, capacidad._
- **M-3 (medio-alto, arquitectónico). Content-addressing + Merkle + dedup.** ID por hash, no reenviar chunks que el otro ya tiene, verificación parcial. _Dimensión: capacidad, velocidad, robustez._
- **M-4 (medio, solo grupos). RaptorQ systematic para archivo a grupo (1→N).** Overhead +2-5 % sobre bloques grandes = ínfimo; evita que cada miembro pida lo suyo. Cuidar el decode en gama baja. _Dimensión: robustez/velocidad en grupo._
- **M-5 (bajo). `faststart` en el MP4** para reproducir mientras baja. _Dimensión: velocidad percibida de vídeo._

---

## 6. SEGURIDAD (lecciones de las apps de malla)

- **Bridgefy (2 papers académicos)**: sin autenticar broadcast, padding-oracle, y un **DoS "zip bomb" que colgaba toda la malla** porque reenviaban antes de parsear. **NEXO ya está cubierto** del DoS (SafeJson/BinFrame validan tamaño antes de parsear) y de la falsificación de acuses (C1). Bien.
- **Pendiente real (de la propia auditoría de NEXO):**
  - **S-1 (medio). E1 legado sin AAD** (`e2e_crypto.js:138-143`): replay/duplicación de un contacto aún en protocolo 1. **Acción:** forzar migración a protocolo 2 o añadir AAD a E1.
  - **S-2 (medio-alto). H3**: tarjetas de contacto fijan claves **sin verificar** el número de seguridad; en creación de grupo un miembro podría fijar la clave de un tercero. **Acción:** marcar esas claves "de oídas"/pendientes hasta el número de seguridad. (El envenenamiento por reescritura de lista de grupo, C2, YA se cerró.)
  - **S-3 (bajo, verificar). Jump/relé**: confirmar que valida tamaño/estructura **antes** de reenviar (lección Bridgefy) — probablemente sí (SafeJson), pero conviene una prueba explícita de "no reenviar basura/bomba".

---

## 7. Tabla priorizada (impacto/esfuerzo, para elegir el orden)

| ID | Mejora | Dimensión | Impacto | Esfuerzo | Capa |
|----|--------|-----------|---------|----------|------|
| **C-1** | Jitter en el backoff de reconexión | Estabilidad, batería | Alto | Bajo | JS (+nativo) |
| **C-2** | Reconexión sin depender de la caché de escaneo | Estabilidad | Alto | Medio | Nativo |
| **E-2** | Sacar el escaneo bloqueante de 5 s del hilo principal | Velocidad, estabilidad | Alto | Medio | Nativo |
| **E-1** | Escaneo siempre filtrado + AGGRESSIVE + FIRST_MATCH | Capacidad, batería | Alto | Medio | Nativo |
| **C-3** | Manejo por código de estado GATT (8/19/133/147) | Estabilidad, batería | Alto | Medio | Nativo |
| **M-1** | BlurHash inline en imágenes | Velocidad percibida | Alto | Bajo | JS |
| **P-3** | Consolidar caminos de envío/umbrales (sigue 2943) | Robustez, mantenim. | Alto | Medio-alto | JS |
| **C-4** | Cola general de operaciones GATT con timeout | Estabilidad | Medio-alto | Medio | Nativo |
| **V-1** | Grupo Wi-Fi Direct caliente (no derribar por envío) | Velocidad media/archivo | Medio-alto | Alto | Nativo |
| **M-2** | Compresión de imagen antes de enviar (~1600 px) | Velocidad, capacidad | Medio | Bajo-medio | JS |
| **E-3** | Modo multitud (pasivo + FIRST_MATCH + jitter anuncio) | Capacidad (concierto) | Medio | Medio | Nativo |
| **S-2** | H3: claves de tarjeta "de oídas" hasta verificar | Seguridad | Medio | Medio | JS |
| **S-1** | Cerrar E1 (AAD o migración forzada) | Seguridad | Medio | Medio | JS |
| **M-3** | Content-addressing + Merkle + dedup | Capacidad, velocidad | Medio | Alto | JS |
| **V-2** | Verificar 2M/DLE/PHY y loguearlo | Velocidad | Medio | Bajo | Nativo |
| **M-4** | RaptorQ para archivo a GRUPO (1→N) | Robustez grupo | Medio | Alto | JS/Nativo |
| **C-5/C-6** | Bajar priority tras ráfaga + tope de conexiones | Batería, capacidad | Bajo-medio | Bajo | Nativo |
| **M-5** | faststart en MP4 | Velocidad percibida | Bajo | Bajo | JS/Nativo |
| **E-4** | Evicción de mapas de escaneo | Estabilidad largo plazo | Bajo | Bajo | Nativo |

---

## 8. Orden recomendado (y por qué)

**Tanda 1 — estabilidad y velocidad que el dueño sufre HOY (todo de impacto alto, esfuerzo bajo/medio):**
- **C-1 (jitter), C-2 (reconexión sin caché), C-3 (códigos de estado)**: atacan directo lo que se ve en tu diagnóstico (tormentas de reconexión, `No hay device cacheado`).
- **E-2 (escaneo bloqueante)**: quita tirones reales al enviar.
- **M-1 (BlurHash)**: la ganancia de "se siente instantáneo" más barata que existe.

**Tanda 2 — capacidad y mantenibilidad:**
- **E-1 (escaneo filtrado)**, **C-4 (cola GATT)**, **P-3 (consolidar caminos)**, **M-2 (comprimir imagen)**.

**Tanda 3 — lo pesado/arquitectónico (cuando lo interactivo esté firme):**
- **V-1 (Wi-Fi Direct caliente)**, **M-3 (Merkle/dedup)**, **E-3 (modo multitud)**, **M-4 (RaptorQ grupo)**.

**Transversal (seguridad, cuando toque "estado de claves"):** **S-1 (E1)**, **S-2 (H3)**, **S-3 (prueba relé)**.

**Fundacional (lo del dueño, no mío):** medir en los **dos teléfonos reales** throughput/batería/2M-DLE — el simulador no lo reemplaza y es el freno del índice de robustez.

---

## 9. Honestidad sobre "igualar o superar a las apps actuales"

- **Donde NEXO ya gana:** privacidad (sin servidor, sin CDN que vea nada), funcionamiento sin internet, cripto (Double Ratchet + poscuántico), y store-and-forward propio.
- **Donde una app con servidor es intrínsecamente más rápida y NEXO no puede copiar:** descarga paralela de N datacenters, retención larga, entrega instantánea a alguien ausente. En P2P el emisor **es** la única fuente. Eso no se "arregla", se compensa con relés/mailbox y con que el camino rápido (Wi-Fi) se use bien.
- **Donde NEXO puede ponerse a la par y es lo que más se siente:** que el envío **no se trabe** (Tanda 1), que la imagen **aparezca al instante** (BlurHash), que mandar media **no pague el arranque de Wi-Fi cada vez** (grupo caliente), y que **nada pesado toque Bluetooth** si hay algo mejor (ya hecho, 2943).

---

## 10. Fuentes (resumen; el detalle con enlaces está en las investigaciones)
- BLE Android oficial: ScanSettings, ScanCallback, BluetoothGatt, cambio MTU-517 de Android 14, Wi-Fi Aware, Nearby Connections.
- Throughput/robustez BLE: Nordic, Silicon Labs, Novel Bits, Punch Through, Memfault/Interrupt, Engenius (medido).
- Transferencia fiable: RFC 6330 (RaptorQ), RFC 2018 (SACK), RFC 6817 (LEDBAT), tus.io (resume), BitTorrent v2 BEP 52 (Merkle), FastCDC, rsync.
- Media/apps: WhatsApp Security Whitepaper, Telegram API files, Signal (tus/adjuntos), BlurHash, FFmpeg faststart.
- Malla/P2P: Briar/Bramble, Bridgefy (2 papers de seguridad), Berty, Jami (DHT+ICE), Bitchat (BLE+Nostr), Nearby Connections (eval HAL).
- Código NEXO: mapa nativo (`plugins/nexo-ble/android/.../*.kt`) y JS (`src/ui/ble_*.js`, `src/net/net_link.js`, `src/ui/ble_ack.js`) con `archivo:línea` en las investigaciones internas de esta sesión.

> Nota de método: las 3 investigaciones de internet se hicieron con búsqueda (la red de la sesión bloquea la descarga directa de muchos dominios). Las cifras de estándares (RFC/docs oficiales) son fiables; los bitrates concretos de WhatsApp/Telegram y los números de L2CAP en Android conviene confirmarlos con un benchmark propio en los teléfonos del dueño antes de usarlos como base de decisión.
