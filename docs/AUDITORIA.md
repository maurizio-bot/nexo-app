# NEXO — Auditoría de seguridad y robustez (ronda 2774, 25-10-2026)

Pedido del dueño: «investiga cuáles son las auditorías más serias, severas y estrictas, qué implican sus modelos de
prueba, y haz eso con NEXO; pruebas enfocadas a llevar la app al límite en robustez y seguridad».

Este documento tiene cuatro partes:
1. Qué auditorías son las más estrictas y cómo prueban (su «modelo de prueba»).
2. Modelo de amenazas de NEXO (quién ataca y qué protege).
3. Hallazgos de esta ronda, con su gravedad (estilo CVSS 4.0) y su estado (arreglado / documentado), cada arreglo con
   su prueba que lo reproduce.
4. Plan de pruebas «al límite» (lo que ya hay y lo que falta), por prioridad.

Método, como siempre (CLAUDE.md): cada fallo se reproduce en `tests/sim` o `tests/kotlin`, se arregla, se pasa la
batería y solo entonces se sube. Nada se da por bueno sin comprobarlo. Lo que no se puede comprobar aquí (en teléfonos
reales) se dice.

---

## 1. Las auditorías más estrictas y su modelo de prueba

| Auditoría / norma | Qué es | Cómo prueba (modelo) |
|---|---|---|
| **OWASP MASVS 2.1 + MASTG + MASWE** | El estándar de seguridad de apps móviles. 8 grupos de controles (STORAGE, CRYPTO, AUTH, NETWORK, PLATFORM, CODE, RESILIENCE, PRIVACY). Los antiguos «niveles» ahora son **perfiles** según el atacante: **L1** (otra app del teléfono), **L2** (no se confía en el sistema; el atacante puede tener el teléfono), **R** (ingeniería inversa) y **P** (privacidad). | Revisión manual con el código delante, no solo herramientas. Cada prueba del MASTG es concreta y hay que guardar scripts que reproduzcan cada fallo. Para NEXO el objetivo son **L2 + P**. |
| **ADA MASA** (App Defense Alliance) | Certificación que comprueba un subconjunto del MASVS. | Tres niveles (autoevaluación → laboratorio que prueba cada caso con el MASTG). Veredicto por control. Supone un teléfono sin root y un usuario no hostil. |
| **CSPN (ANSSI, Francia)** | La certificación de app más dura en la práctica: la hace un experto que **ataca de verdad**. | Tiempo fijo (~25 días + ~10 de criptografía). Revisa documentación y código, comprueba cada función y **ataca todas** (análisis de vulnerabilidades). La criptografía se juzga con una guía propia. La usa, p. ej., **Olvid**. |
| **Common Criteria / EUCC / NIAP** | El marco formal (EAL1–7). El análisis de vulnerabilidades (AVA_VAN) se mide por el atacante que resiste (.1 Básico … .5 Alto). | Conformidad exacta con un «perfil de protección» + ataque según el nivel. NIAP para apps exige sobre todo aleatoriedad y almacén de claves del sistema, canal seguro y actualizaciones firmadas. La app no puede estar ofuscada. |
| **FIPS 140-3** | Valida **solo el módulo criptográfico** (no el protocolo). | Algoritmos validados, autopruebas, borrado de claves. Con WebCrypto + @noble, NEXO **no** puede decir que es «FIPS». |

**Lo más importante que se aprende de esto:** los fallos graves de mensajería **no** los encuentran las
certificaciones de lista de control, sino los **criptoanalistas** y la **verificación formal**. Lo que de verdad
revienta apps como la nuestra es el ataque de protocolo: repetición, reordenación, reflexión, suplantación, rebaja a
un protocolo más débil, confusión de identidades, grupos, metadatos y bloqueo del servicio. Por eso el modelo de
prueba que copiamos para NEXO es el de esos trabajos (Threema 2023, Matrix 2022, Bridgefy 2021/22, Signal S&P 2026,
bitchat 2025/26) y el de las pilas Bluetooth (SweynTooth, BLESA, KNOB), más fuzzing y simulación con fallos inyectados.

**Qué encontraron en la competencia (y que hay que vigilar en NEXO):**
- **Threema:** reordenar y borrar mensajes; **repetir/reflejar** mensajes tras reinstalar (perdía el registro de lo ya
  recibido); clonar la cuenta desde la copia.
- **Matrix:** el servidor **añadía usuarios/dispositivos** a una sala; aceptaba claves reenviadas por cualquiera; la
  autenticidad se comprobaba al mostrar el mensaje y no al recibirlo.
- **Bridgefy:** intermediario en el primer contacto, difusión sin autenticar, **bomba de descompresión**, y un fallo
  entre comprobar la clave y usarla.
- **bitchat:** suplantación; **envenenamiento de la caché de la malla** (se fiaba de la identidad del paquete y lo
  guardaba antes de aceptarlo); CVE-2026-51376: bloqueo con un paquete no autenticado (atacante cercano).
- **WhatsApp:** la pertenencia a los grupos **no** está cifrada de extremo a extremo; **Careless Whisper** (las
  confirmaciones silenciosas revelan presencia y gastan batería); **Prekey Pogo** (agotar las claves de un solo uso).
- **Bluetooth:** no hay que fiarse del cifrado del propio Bluetooth (KNOB lo rebaja; BLESA se salta la reconexión);
  SweynTooth tiró decenas de pilas con paquetes malformados.

---

## 2. Modelo de amenazas de NEXO

**Qué protege NEXO:** el contenido de los mensajes, fotos, archivos, voz y vídeo (cifrado de extremo a extremo), la
identidad (NEXO ID y claves), y en lo posible los metadatos (ID rotativo por Bluetooth, remitente sellado en Jump,
etiquetas que rotan a diario en internet).

**Atacantes (igual que en los trabajos de arriba):**
1. **Radio cercano (Bluetooth):** puede conectarse al servidor GATT y escribir lo que quiera, anunciarse y escuchar
   los anuncios.
2. **En la misma red Wi-Fi/LAN:** puede abrir conexiones TCP a los puertos de NEXO y mandar UDP/mDNS.
3. **Internet / relé malicioso (Nostr, WebSocket):** controla lo que entrega un relé.
4. **Contacto malicioso** con sesión legítima (p. ej. un miembro de un grupo).
5. **Nodo de Jump** (un usuario NEXO que reenvía tráfico de otros).
6. **Otra app en el mismo teléfono** (intents a la actividad exportada).
7. **Acceso físico** a un teléfono bloqueado o robado.

**Lo que está bien (comprobado leyendo el código, resumen de la auditoría):** el cifrado liga remitente↔sesión en el
AAD (cambiar `from`/`to`/`id` o repetir con otro id no descifra); un `chat` sin cifrar que dice ser de un contacto se
descarta; el Double Ratchet limita los saltos (`MAX_SKIP` 1000) y las claves guardadas (300) **antes** del bucle (no
hay DoS de memoria ni CPU sin tope); las señales de llamada exigen E2E (un desconocido no puede hacer sonar ni
descolgar); las tramas de voz/vídeo van cifradas con la clave de la llamada y con anti-repetición; el Wi-Fi no se usa
hasta comprobar al contacto con el cifrado (reto `lv`/`lw`); internet acepta solo lo que descifra con la clave de la
pareja; borrar-para-todos solo borra lo del propio remitente; los nombres/archivos/grupos se pintan con `textContent`
(no hay XSS conocido); los secretos se guardan cifrados (AES-GCM + Keystore), no en claro; el almacén en reposo valida
rutas (no hay salida del directorio); BinFrame valida tamaños; BigFile liga cada trozo con AAD (no se puede cortar,
reordenar ni empalmar); el TLS de los WebSocket **sí** valida el nombre del servidor.

---

## 3. Hallazgos de esta ronda (gravedad estilo CVSS 4.0)

Gravedad: **Crítica** ≥ 9, **Alta** < 9, **Media** < 7, **Baja** < 4. `AV:A` = atacante cercano (Bluetooth/Wi-Fi/LAN).

### Arreglados y comprobados en esta ronda

(La fila **C1** se arregló en la **fase 2 (ronda 2777, 25-10-2026)**, no en la 2774; se deja aquí por ser un arreglo
comprobado con su prueba. Falta la confirmación en los dos teléfonos del dueño.)

| # | Gravedad | Hallazgo | Arreglo | Prueba que lo reproduce |
|---|---|---|---|---|
| **C1** | **Alta** | **Confirmaciones (✓✓) sin autenticar.** El `msgId` viaja en claro; quien lo conozca (radio, LAN o un relé) podía mandar una confirmación falsa de «entregado» → el emisor dejaba de reintentar y el mensaje se perdía mostrando ✓✓. | Con un contacto moderno (protocolo 2) la confirmación va **firmada** con un MAC derivado del secreto de la pareja (`e2eAckTag` = HMAC-SHA256 del ECDH de las dos identidades con la etiqueta `NEXO-ACK-v1`, ligado a tipo+msgId+los dos NEXO ID, 12 bytes); una falsa (sin firma o con firma que no cuadra) se ignora (comparación en tiempo constante). En **modo cerrado**, donde el ack lo manda la capa nativa (que no tiene claves de identidad), la app le pasa por contacto la clave de firma (`setAckKeys`, solo en memoria del proceso —sobrevive con la app cerrada, como la config de internet—, nunca a disco) y el Kotlin firma el ack igual. Contactos antiguos (protocolo 1): sin cambios (compatibilidad). | `tests/sim/ackforge.js` (A↔B proto 2: la entrega real marca ✓✓ y una confirmación falsa —sin firma o con firma mala— no marca entregado y el envío sigue pendiente). También pasa el escenario de modo cerrado (`recibir con la app cerrada`), que ahora firma el ack nativo. ⚠️ Falta confirmarlo en los dos teléfonos del dueño. |
| N1 | **Alta** (AV:A) | **Wi-Fi: saludo gigante.** El hub TCP reservaba hasta 48 MB nada más leer el tamaño del saludo (sin autenticar); con unas pocas conexiones así, la app se quedaba sin memoria y Android la cerraba. | El saludo se lee con tope de 8 KB (`HELLO_MAX`); los mensajes grandes de verdad (ya autenticados) siguen permitidos. | `LanHubAttackTest.saludoGiganteSeRechazaSinReservarMemoria` (antes reservaba ~142 MB con 6 conexiones) |
| N2 | **Alta** (AV:A) | **Wi-Fi: avalancha de conexiones.** Un hilo de lectura por conexión, sin tope: miles de conexiones que no saludan = memoria/hilos sin fin. | Cola de conexiones sin saludar acotada (`MAX_PREAUTH` 64); al pasarse se cierra la más vieja. Un contacto de verdad saluda al momento y entra igual. | `LanHubAttackTest.avalanchaNoDejaSinServicioNiCreaHilosSinFin` (antes 150 hilos a la vez) |
| N3 | **Media** (AV:A) | **Wi-Fi: archivo grande abortado por un extraño.** `serve` moría si alguien de la red abría una conexión con basura o se quedaba callado: la transferencia legítima no llegaba. | Cada conexión se atiende por separado; una conexión ajena se descarta y se sigue esperando la del contacto. | `BigFileAttackTest.servidorSobreviveAConexionesAjenas` |
| N4 | **Media** (AV:A) | **Wi-Fi: inundación de escaneo (LanBeacon).** Con una marca distinta por paquete, el mapa de vistos crecía sin fin y cada paquete disparaba un aviso a la app y una respuesta UDP. | Mapa acotado (`MAX_SEEN` 2048, se olvida lo más viejo) y presupuesto por ventana (256 / 10 s). | `LanBeaconAttackTest.inundacionDeMarcasNoCreceSinLimiteNiAvisaSinFin` |
| N5 | **Alta** (AV:A/Red) | **Cierre a distancia con JSON muy anidado.** El analizador de JSON de Android es recursivo y sin tope; `[[[[…` provoca un `StackOverflowError`, que no es `Exception` y se escapa de los `try/catch` → el sistema mata la app (un solo paquete). | Cribado `SafeJson` (tope de tamaño y de profundidad) antes de analizar cualquier JSON ajeno (Bluetooth, Wi-Fi, relés), más un `catch(Throwable)` en los hilos de lectura. | `SafeJsonTest`, `ParserFuzzTest` |
| N6 | **Media** (AV:L) | **Otra app descolgaba una llamada.** La pantalla principal está exportada; otra app podía abrirla con el extra «contestar» y descolgar sola una llamada que estuviera sonando (micrófono/cámara abiertos). | Las órdenes de contestar/abrir llamada solo se hacen caso si el intent trae nuestro testigo al azar, que va dentro del PendingIntent del aviso (otras apps no lo pueden leer). | Revisión de código (intent de Android; difícil de probar en JVM) |
| N7 | **Baja** (AV:A) | **Anuncio Bluetooth con ID mal formado.** El ID anunciado se aceptaba sin validar; un anuncio con basura llegaba a la app como «dispositivo» y podía envenenar el mapa NEXO ID→dirección. | Se valida contra la forma de un NEXO ID (`nx`+8) o código rotativo (`R`+9) antes de usarlo. | Revisión de código |
| C2 | **Alta** | **Grupos: un miembro reescribía la lista y colaba claves de terceros.** Cualquier miembro podía, con un sobre normal, cambiar la lista entera (echar a otros, meter desconocidos) y, con esa lista inventada, **colar la clave pública de un tercero** (envenenamiento de claves para chats 1:1). | La lista de un grupo ya conocido no se reescribe desde un sobre (se fija al crear; la única baja es que uno se vaya). Las tarjetas de miembro solo valen para miembros de la lista, que ya no se puede ampliar. | `tests/sim/groupforge.js` (reproducido en la versión vulnerable: el atacante echaba al creador, metía a `evil`/`target` y colaba sus claves) |

Robustez (no es un ataque, es que la app no se caiga):
| # | Gravedad | Hallazgo | Arreglo | Prueba |
|---|---|---|---|---|
| R1 | **Media** | **Muerte del WebView = app cerrada.** Capacitor 5 devuelve `false` en `onRenderProcessGone` si nadie lo maneja, y NEXO no registraba a nadie: si el proceso del WebView moría (memoria, o un vídeo con un fallo), Android cerraba la app. | `MainActivity` registra un `WebViewListener` que rehace la pantalla (los chats se recargan del disco) y devuelve `true`: la app no se cierra; lo nativo sigue vivo en el servicio. | Revisión de código (necesita confirmación en teléfono: botón de prueba `chrome://crash`) |

### Encontrados y **documentados** (no arreglados en esta ronda: necesitan cambio de protocolo y pruebas en los dos teléfonos del dueño)

| # | Gravedad | Hallazgo | Arreglo propuesto |
|---|---|---|---|
| **H3** | **Media-Alta** | **Tarjetas de contacto fijan claves sin verificar.** Una tarjeta compartida establece la clave pública de un contacto nuevo sin que el usuario la verifique (de palabra). En la **creación** de un grupo, un miembro que llegue antes que el creador podría fijar la clave de un tercero. | Marcar las claves de tarjeta como «de oídas» (pendientes): se usan solo tras el flujo normal de aceptación / número de seguridad. Toca el estado de claves (delicado) → ronda propia. |
| **H4** | **Media** | **Fénix: petición de recuperación sin autenticar.** La `fq` llega como control sin cifrar; el `from` y el nombre son del atacante y se le muestran al usuario. Cada confirmación engañada filtra **un** fragmento (hacen falta 6 para restaurar). | Exigir que la `fq` llegue por sesión E2E con el contacto; mostrar solo la identidad verificada y avisar «este teléfono no tiene historial de claves contigo»; limitar más las peticiones. |
| **M5** | **Baja-Media** | **Control sin autenticar (`ni`/`kx`/`nm`).** Reasignan el enlace o ponen el nombre mostrado de un contacto aún sin nombre. El contenido sigue cifrado; se puede estorbar el enlace o reetiquetar. | Exigir una señal autenticada antes de reasignar un enlace vivo; no aceptar `nm` que no esté ligado a la clave del contacto. |
| **M6** | **Baja** | **Sincronización de sesión (`ss`) sin autenticar.** Una `ss` falsa hace reenviar los propios mensajes (ya cifrados) y revela el último número de secuencia. | Ignorar `ss/sr` de un desconocido o enlace sin comprobar. |
| **F6** | **Baja-Media** | **La radio renueva el wakelock / hace sonar.** Un flujo de mensajes sin autenticar renueva un wakelock de 15 s; ofertas de llamada falsas encienden la pantalla y suenan (molestia/batería, como «Careless Whisper»). | Despertar/sonar solo tras autenticar; limitar las renovaciones. Ligado a C1/H-ring. |
| **F7** | **Baja** | **FileProvider demasiado abierto** (`external-path "."`, `cache-path "."`). Hoy solo se comparten URIs bajo `cacheDir/nexo_open`, así que está latente. | Acotar a la subcarpeta que de verdad se comparte. |
| **F8** | **Baja** | **Reservas de una sola vez grandes** en Wi-Fi Direct (40 MB) y pasar-la-cuenta (512 MB). Están protegidas por clave, pero son un riesgo de memoria. | Leerlas por flujos como `BigNet`. |
| **F9** | **Baja/Info** | **WebSocket en claro permitido** (`ws://`). Las URLs las pone el usuario y el contenido va cifrado, pero un relé `ws://` filtra las etiquetas de la suscripción. | Exigir `wss://` o una `network-security-config`. |
| **Info** | Info | **IDs con `Math.random`** (NEXO ID, msgId). No son claves (esas usan `getRandomValues`), pero el msgId predecible facilita C1. | Derivar los IDs de `crypto.getRandomValues`. |

El ratchet, además, tiene el riesgo clásico de **repetir (clave, IV)** si se restaura un estado viejo (copia, Fénix,
o seguir usando el teléfono viejo tras pasar la cuenta). Hay que probarlo (P0-1 abajo).

---

## 3bis. Revisión nocturna 27-10-2026 (builds 2794–2800) — «verificar robustez y fallas» (pedido del dueño)

Repaso de la **superficie nueva de la madrugada** (buscar en el chat 2794, ver-una-vez 2795, limpieza de pagos 2796,
foto/nombre 2797, mala señal 2798, Estados/Stream 2799) con el modelo de amenazas de §2. Método: una revisión propia +
una revisión adversarial independiente (agente), solo hallazgos **alcanzables** con una ruta real, y arreglo
proporcionado y **reproducido en `tests/sim`** antes de subir.

**Batería de ataque/caos: VERDE en la 2799 (65/65).** Vigilan la seguridad, entre otras: `spoof.js` (anti-suplantación),
`ackforge.js` (acuses ✓✓ falsos), `groupforge.js` (un miembro reescribe el grupo), `misroute.js` (enrutado BLE/Jump sin
fugas), `relaytls.js` (relés en claro vetados), `forge`/`forgetext`. Todo pasa.

### Arreglados y comprobados en esta revisión (build 2800)

| # | Gravedad | Hallazgo | Arreglo (reproducido en `tests/sim`) |
|---|---|---|---|
| **NEXO-02-ONCE1** | **Alta** | **Una foto «de una vez» ya abierta REVIVÍA al retransmitirse.** Tras consumirla, el borrado (`vaultConsumeOnceMessage`) limpiaba `content`, pero el *merge* de una retransmisión del mismo `msgId` en `_appendMessageNow` solo anulaba `attachmentPayload`/`ref`/`hd`, **no `content`**. Como por relé/internet el payload viaja DENTRO de `content` como JSON, el reenvío automático del emisor al reconectar (su registro saliente no se borra, #12) devolvía ese `content`; al reabrir el chat `render.js` lo reconstruía y **volvía a mostrar la foto** (y la reescribía a disco) — rompía la promesa de privacidad del #94. Ruta real sin malicia (reconexión) y agravable con malicia (meta sin `once`). | `vault_manager.js` (guarda `onceSeen`): se iguala al borrado de consumir — `content`/`text` a `''`, payload/ref/hd a `null`, `attachmentMeta.once` forzado → la burbuja queda «Abierta». Prueba: `tests/sim/once.js` (`retransmision_no_revive_vault`/`_ui`); confirmado que SIN el arreglo la prueba falla. |
| **NEXO-02-EST1** | **Media** | **Un Estado con fecha futura no caducaba.** `estados.applyStatus` aceptaba el `ts` del otro teléfono con solo `>0`; un `ts` en el futuro (reloj malo o malicioso) dejaba `(ahora−ts)<24 h` verdadero para siempre → el Estado de un contacto no caducaba y `_ago` mostraba tiempo negativo. | `estados.js`: el `ts` recibido se acota a «ahora» (`Math.min(ts, now)`); las 24 h quedan honestas pase lo que pase. Prueba: `tests/sim/estados.js` (`futuro_acotado`). |

**Superficie nueva sin hallazgos alcanzables:** `search_ui.js` (filtra por `textContent`, no mete texto del otro como HTML);
el toque del avatar en `ble_ui.js` (cierre por fila correcto, `stopPropagation` solo con foto); el parse de `o1` en
`ble_ack.js` (`=== 1` estricto, tolera basura sin romper); `_refreshLinkSubtitle` de mala señal en `main.js` (guardas de
tipo, `mtu>0 && mtu<60` falso para `undefined`/`NaN`, subtítulo por `textContent`, sin texto del otro). `estados.js` ya
acota el texto a 280 car. al enviar **y al recibir**, valida NEXO IDs y escapa el texto al mostrar.

**Estado del índice (42,5, sin cambio):** lo que lo frena no es la cobertura de pruebas (A alta: 65/65 + ataque verde) sino
**B** (el dueño no ha reconfirmado las builds recientes en los teléfonos reales) y **C** (puntos débiles abiertos: 9 graves
+ 4 medios + 2 leves, sobre todo los duros — entrega con la app cerrada #87, llamadas por internet #99, Bluetooth con MTU 23
inestable — que necesitan su diagnóstico o trabajo nativo/servidor, no un arreglo rápido). Los dos hallazgos de hoy ya
estaban cubiertos por el catálogo como «ver una vez» y «Estados», así que no mueven el índice; sí refuerzan la robustez real.

---

## 3ter. Auditoría destructiva 27-10-2026 (builds 2804–2805) — «auditoría completa, pruebas destructivas» (pedido del dueño)

Segunda auditoría del día, con revisión adversarial independiente centrada en la clase de fallo **«un número que
controla el atacante se convierte en un contador de bucle o en el tamaño de una asignación, sin tope»** (la peor en una
app de mensajería: un solo paquete cuelga el teléfono). Método de siempre: reproducir → arreglar → batería → subir.

**Batería de ataque/caos VERDE** (`spoof`, `ackforge`, `groupforge`, `relaytls`, `misroute`, `chunkdos` nuevo) y pruebas
Kotlin de ataque/fuzz verdes (`ParserFuzzTest`, `LanHubAttackTest`, `BigFileAttackTest`, `LanBeaconAttackTest`).

### Hallazgo NEXO-02-010 — DoS por trozo BLE con «n» disparatado (ALTA, arreglado 2804)

- **Gravedad:** ALTA. CVSS 4.0 aprox. `AV:A/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H` (disponibilidad alta; **a alcance Bluetooth, sin cifrar, sin ser contacto**).
- **Qué:** el servidor GATT acepta escrituras de cualquiera (antes del E2E). Un trozo de chat/archivo con el campo «n»
  (total de trozos) disparatado (p.ej. 2.000.000.000) pasaba `_handleIncomingChunk` (solo validaba `total>0`, `idx>=0`,
  `idx<total`). Dos caminos al mismo desastre: (a) con `idx=0` creaba el búfer con ese total y agendaba un block-ack que
  recorría `for (i<buf.total)` en `_sendBlockAck`; (b) con `idx` grande y sin búfer construía el array de huecos de L557.
  Ambos → miles de millones de iteraciones en el hilo principal → **congelación de la interfaz → ANR en Android**.
- **Ruta:** teléfono malicioso a ~alcance Bluetooth → escribe el trozo en el característico GATT de la víctima →
  `processIncomingFragment` → `_handleIncomingChunk`. No necesita ser contacto ni clave: es **antes** del cifrado E2E.
- **Arreglo (`src/ui/ble_ack.js`):** `const MAX_CHUNKS = 300000;` y `if (total > MAX_CHUNKS) return;` tras la validación.
  El mensaje real más grande (`BLE_HD_MAX_CHARS` 9,5 M troceado al mínimo ~40–60) son ~158k trozos; el tope deja el doble
  de margen y, como `idx<total`, acota también el array de huecos. Reproducido en `tests/sim/chunkdos.js` (antes: búfer de
  2e9 + block-ack/NACK gigantes; después: ignorado), en la batería (tag CHUNKDOS). El ANR real se confirma en el teléfono.

### Hallazgos NEXO-02-011 y 012 — misma clase, defensa en profundidad (LEVES, arreglados 2805)

- **011 `vault_manager` (`vaultCreateTransfer`/`vaultAppendChunk`):** el bucle `for i<totalChunks` + `join` construía un
  array/cadena de miles de millones con un `totalChunks` disparatado. **Hoy es código muerto** (expuesto en `window.*`,
  sin llamador en `src/`: el reensamblado entrante vive en `ble_ack.js` con `MAX_CHUNKS`); pero al seguir expuesto en
  `window`, cualquier recableado futuro reintroduciría el ANR. Se acota igual (tope 300000); `chunkdos.js` lo vigila.
- **012 tarjeta de contactos compartida (`share_contacts._renderContactCard` / `ble_contacts.addSharedContacts`):** sin
  tope, una lista `meta.contacts` enorme dibujaba millones de nodos del DOM → congelación. **POST-E2E** (exige ser un
  contacto aceptado) y amplificación 1:1 (hay que mandar literalmente N entradas), de ahí la gravedad leve. Acotado a 500
  (una tarjeta real son unos pocos).

### Superficies revisadas y robustas (una línea cada una)

QR del número de seguridad (`qr_verify`) y QR NEXO-MOVE (`move_account`): formato estricto, sin bucles. `estados.applyStatus`:
texto ≤280, `ts` acotado a «ahora» (2800), escapado al mostrar. Sobres E2E (`e2e_proto`/`e2e_crypto`): tamaños 1:1, sin
contadores explotables. Ratchet (`e2e_ratchet._skip`): rechaza `n>1e7` y tope `MAX_SKIP=1000`. Fénix/`shard_crypto`: share y
blob validados, tope de dueños, umbral propio. `big_file`/`wifi_direct`: acotan `p.size`, transferencia nativa. Llamadas
(`unpackCallPacket`): acotado por contador de 1 byte y por el tamaño del paquete. `net_link`/`lan`: handshake E2E, formatos
y nombre (≤40) validados. **Veredicto:** fuera de los tres de arriba, no hay un paquete único que amplifique a un bucle/asignación sin tope.

---

## 4. Plan de pruebas «al límite» (robustez y seguridad)

Adaptado de los modelos más duros: simulación determinista (FoundationDB, TigerBeetle VOPR), Jepsen/caos, fuzzing
(Jazzer), propiedades/modelos (fast-check), mutación (Stryker/PIT) y las normas (Power of 10, MC/DC de DO-178C). El
detalle y las herramientas comprobadas están en la investigación guardada; aquí va lo esencial por prioridad.

**Invariantes que toda prueba vigila** (lo que NEXO promete):
- I1: ✓✓ ⇒ el mensaje está guardado en el receptor (aunque muera justo después).
- I2: nada inventado (repetición, suplantación, paquete corrupto, llamada fantasma).
- I3: cada `msgId` sale a lo sumo una vez en pantalla. I4: el contenido llega idéntico (hash).
- I8: nada en claro (aire, relés, puentes, registros). I9: nunca la misma (clave, IV) AES-GCM.
- I10: colas con tope; I11: ninguna excepción/promesa sin manejar; I13: el camino de envío sigue las reglas del dueño.

**Ya hecho en esta ronda (primer tramo del plan):**
- Fuzzing con semilla de los analizadores nativos: `ParserFuzzTest` (BinAssembler, BgInbox, SafeJson) — 90 000 entradas
  adversarias, no revientan y el estado queda acotado.
- Pruebas de ataque de red: `LanHubAttackTest`, `LanBeaconAttackTest`, `BigFileAttackTest`.
- Prueba de ataque de protocolo de grupos: `tests/sim/groupforge.js` (en la batería).

**Por prioridad (lo que falta):**
- **P0-1** Repetir/restaurar el estado del ratchet (copia, Fénix, pasar la cuenta sin apagar el viejo) → que nunca se
  repita una (clave, IV) y que el teléfono viejo deje de servir.
- ✅ **P0 (C1) RESUELTO (ronda 2777):** las confirmaciones (✓✓/leído) ahora van firmadas con un MAC derivado del secreto
  de la pareja (`e2eAckTag`), también en **modo cerrado** (el ack lo firma la capa nativa con una clave por contacto que
  le da la app por `setAckKeys`, en memoria del proceso). Una confirmación falsa se ignora, así que ya no para los
  reintentos ni hace perder un mensaje con ✓✓. Lo vigila `tests/sim/ackforge.js` en la batería (52/52) y la firma del
  modo cerrado la cubre el escenario «recibir con la app cerrada». ⚠️ Falta la confirmación en los dos teléfonos del dueño.
- ✅ **P0-4 (XSS) RESUELTO (ronda 2809):** revisado todo el camino de pintado — la app ya usa `textContent` en TODAS las
  superficies con datos del remitente (cuerpo del mensaje `_fillTextBubble`→`t.textContent`, nombre del remitente,
  nombres de contacto, cita de respuesta; la tarjeta de ubicación solo mete números), ninguna usa `innerHTML` con datos
  del otro teléfono. Se deja el vigilante `tests/sim/xss.js` (tag XSS, en la batería): 5 cargas típicas (`<img onerror>`,
  `<script>`, `<svg onload>`, `<iframe javascript:>`, `on*`) → cero elementos inyectados, cero handlers ejecutados, texto
  literal; si alguien volviera a usar `innerHTML` con datos del remitente, FALLA. CSP (`index.html`) endurecida con
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` (el `script-src` mantiene `'unsafe-inline'`/`'unsafe-eval'`
  por el WebView de Capacitor y los handlers inline; el XSS se corta en origen con `textContent`). Batería 71/71.
- **P1** «VOPR de NEXO»: mundo determinista (reloj virtual + PRNG con semilla) con fallos inyectados (pérdida en
  ráfagas, duplicados, reordenación, cortes, reinicios, relojes desfasados, disco lleno, muerte entre guardar y
  confirmar) sobre 3–6 teléfonos, comprobando I1–I13. Nocturno, miles de semillas.
- **P1** Fuzzing de medios (imagen, vídeo, Opus, VP8) dentro del WebView (CVE-2023-4863/5217): que la app no se cierre
  (ya cubierto en parte por R1).
- **P1** GATT/BLE: escrituras sin sesión, MTU 23–517, 50 conexiones (estilo SweynTooth).
- **P2** Modelo formal (ProVerif/Tamarin) del acuerdo de claves, el ratchet y el remitente sellado.

Cada hallazgo nuevo entra en `tests/sim/robustez.json` con su prueba y su identificador (NEXO-02-xxx).

---

## Fuentes (resumen)

OWASP MASVS 2.1 / MASTG / MASWE; ADA MASA; ANSSI CSPN (y Olvid); NIAP PP_APP; FIPS 140-3. Criptoanálisis: Threema
(USENIX 2023), Matrix (2022), Bridgefy (2021/22), Signal (S&P 2026, PQXDH 2024), bitchat (2025/26), Telegram (2021),
WhatsApp (Careless Whisper / Prekey Pogo 2025). Bluetooth: SweynTooth, BLESA, KNOB. Robustez: FoundationDB, TigerBeetle
VOPR, Jepsen, Jazzer, fast-check, Stryker/PIT, Power of 10, DO-178C/MC-DC, SQLite. CVSS 4.0 (FIRST). El detalle con
enlaces y fechas está en la investigación de esta ronda (informes de los agentes, 25-10-2026).
