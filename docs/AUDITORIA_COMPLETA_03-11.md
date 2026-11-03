# NEXO — Auditoría completa + pruebas masivas (build 2900, 03-11-2026)

> Pedido del dueño: «auditoría completa y pruebas masivas en cada aspecto, y después un reporte completo».
> Método: todas las suites automáticas corridas de verdad + 3 auditorías de código independientes (seguridad, nativo/datos,
> funcional/UX). Nada afirmado sin comprobar. Honesto: se distingue riesgo REAL de teórico.

---

## 0) VEREDICTO EJECUTIVO

**La base es sólida y está muy endurecida.** Cripto E2E seria (Double Ratchet + X3DH + poscuántico ML-KEM-768 + AAD +
Shamir), entrega de mensajes/archivos resistente (store-and-forward, reintentos, cooldowns), escrituras atómicas, y una
suite de pruebas grande y verde. **Cero fallos en todas las pruebas automáticas.**

**Los 3 focos de riesgo REAL (todos conocidos o latentes, ninguno nuevo-crítico):**
1. 🔴 **SEC-2** — MITM remoto *silencioso* al agregar por ID (confidencialidad). Tu decisión: toca aceptación de claves.
2. 🔴 **Rollback del Double Ratchet** → reuso (clave, IV) si se restaura un estado viejo (traer cuenta/Fénix/backup). Latente pero catastrófico. Sin prueba.
3. 🟠 **Durabilidad de datos** — 3 caminos acotados de pérdida/cuelgue (R1 traer-cuenta no atómico, R2 fallo de escritura silencioso, R3 adjunto sin volcar en 2.º plano).

**El mayor freno NO es seguridad ni bugs: es la validación en teléfonos reales (componente B del índice).** El índice de
robustez está en **54,8 / 110**; lo frena B (teléfonos) ≈ 16/35 y D (caos extendido) ≈ 2,7/10. Subiría a ~66–74 solo con
que corras las pruebas físicas.

---

## 1) PRUEBAS MASIVAS — resultados (todo corrido hoy)

| Suite | Qué cubre | Resultado |
|---|---|---|
| **Batería funcional** (`ci.js`, 111 escenarios jsdom) | Todas las áreas (chat, archivos, llamadas, grupos, red, seguridad) | ✅ **111/111, 0 fallos** |
| **Kotlin / JVM** (`tests/kotlin`, ~24 clases) | Nativo puro: cripto en reposo, cola de escritura, WriteRetry/WritePacing, BigFile/AAD, AccountMove, SafeJson/ParserFuzz, LAN-attacks, Tor | ✅ **BUILD SUCCESSFUL, 0 fallos** |
| **VOPR caos** (`vopr.js`, 5 semillas: 1/42/777/2026/31337) | Robustez a escala determinista (dimensión D): «concierto» con N=0→5000 anunciantes de ruido | ✅ **5/5 OK.** Tiempo de descubrimiento **constante ~100 ms** con N=0,500,2000,5000 (no crece con la escala); **0 ruido** a la app; recuperación de fallos de escaneo robusta |
| **Navegador Chromium** (`calls_browser`, `browser.js`) | Audio/vídeo/DOM REALES (lo que jsdom no puede) | ✅ **Voz Opus OK** (4,7 s, codec opus, 37 frames) · **Videollamada VP8 OK** · **Vídeo HD** entregado+recibido (1039 KB) |
| **Índice de robustez** (`robustez.js`) | Media ponderada A/B/C/D sobre 12 áreas | **54,8 / 110** (A pruebas 26,9/35 · B teléfonos 15,9/35 · C débiles 9,3/20 · D caos 2,7/10) |

**Áreas del índice (las más bajas = dónde enfocar):** Seguridad frente a ataques **39,5** (A 18,5/35 porque muchas pruebas de
ataque viven en el job de Kotlin, que `ci.js` no lee; C=2 por 7 débiles abiertos), Llamadas de voz **47** (D=0: la batería diaria
no tiene audio real —se mide aparte en el navegador, voz Opus ✅), Wi-Fi/internet/Jump **49,3** (C=0 por el débil grave
Wi-Fi↔internet), Avisos/2.º plano/cerrada **49,8**. Las altas: **Interfaz 76**, **Escaneo 74**, **Grupos 63**. El patrón que
explica casi todo: **B (teléfonos) está plano en 15/35 en TODAS las áreas menos Interfaz** («funcionó antes pero cambió sin
reconfirmarse en los teléfonos desde la 2765»); por eso Interfaz —lo único reconfirmado, B=35— dispara a 76 y el resto se queda
a medias. Confirmar las pruebas físicas sube B de 15 a 35 donde pruebes (de ahí el salto estimado a ~66–74).

---

## 2) SEGURIDAD

### La cripto de base: SÓLIDA ✅
- **Double Ratchet + X3DH** (`e2e_ratchet.js`): AAD liga `emisor|destino|id` (L378) → no se puede cambiar from/to/id ni
  reenviar con otro id; descifra sobre copia y guarda estado antes de entregar.
- **Poscuántico híbrido ML-KEM-768 / PQXDH**: el secreto KEM entra al HKDF con los 3 DH; **anti-downgrade** real (`pqSeen`)
  impide quitar la clave ML-KEM a una identidad que ya la publicó.
- **Anti-replay** (`seenEk`, borrado de clave de mensaje, dedup), **anti-DoS** (`MAX_SKIP`, rechazo de n/pn disparatados).
- **Shamir** (`shard_crypto.js`): GF(256) correcto, AES-GCM con IV aleatorio.
- **Confirmado SEGURO al revisar:** XSS (ubicación solo números, cobro/estados escapan todo), traversal del puente nativo
  (`AtRestStore` valida canonicalPath), «contestar llamada» exige testigo UUID por proceso (N6 cerrado).

### Riesgos reales (impacto × realismo) — NINGUNO se tocó solo (tocan identidad/cripto → tu visto bueno)
| # | Riesgo | Veredicto | Explotable |
|---|---|---|---|
| **SEC-2** | Alta por ID: la clave que «cifra» la solicitud sale del ID PÚBLICO → un relé malicioso forja la aceptación con su clave y, si hay solicitud pendiente, **te agrega solo y en silencio** con la clave del atacante (`net_link.js:107,394-408`, `ble_links.js:156-164`) | 🔴 ABIERTO | **SÍ — el MITM remoto de confidencialidad más realista.** Barrera: comparar nº de seguridad |
| **Rollback ratchet** | IV de AES-GCM derivado del `mk` sin contador anti-rollback (`e2e_ratchet.js:100-108`) → restaurar estado viejo = reuso (clave,IV) con distinto texto | 🔴 ABIERTO (P0-1/D16) | Latente; disparador = traer cuenta/Fénix/backup (acción normal). Impacto cripto catastrófico. Sin prueba |
| **H4** | Fénix `fq` sin autenticar: el atacante impersona a la víctima «recuperando»; cada custodio engañado filtra 1 fragmento a la clave del atacante → con k, toma de cuenta (`fenix.js:712,726,738`) | 🟠 ABIERTO | SÍ pero **gated por la confirmación manual de cada custodio** |
| **H3** | Tarjetas/grupos fijan clave de un tercero sin verificar (TOFU, solo primer uso) (`ble_keys.js:64`) | 🟠 ABIERTO | SÍ en primer contacto; no pisa claves ya establecidas; banner «sin verificar» |
| **F6 + SEC-3** | Despertar/timbre remoto sin autenticar (`BgInbox.kt:48`, `/wake`) | 🟡 ABIERTO | SÍ remoto pero **solo batería/molestia** (nunca conecta audio ni filtra nada) |
| **M5 / M6** | `ni/kx/nm` reasignan mapeo y nombre; `ss/sr` filtran nº de secuencia y fuerzan reenvíos | 🟡 ABIERTO | Molestia/batería, **no brecha** (el contenido sigue E2E) |
| **F7 / F8** | FileProvider amplio (latente, `exported=false`) / reservas grandes (account-move ya acotado; Wi-Fi Direct 40 MB fijo) | 🟡 latente / parcial mitigado | NO explotable hoy |

### Hallazgos NUEVOS de esta auditoría
- **N-A (leve):** reset del ratchet sin autenticar vía `rs` en el `kx` (`ble_messages.js:221`→`ratchetResetPeer`). Quien tenga tu clave pública puede forzarte a tirar la sesión → nuevo X3DH. Auto-sana; molestia. Sin prueba.
- **N-B (leve, legado):** el **Protocolo 1 (E1) NO usa AAD** (`e2e_crypto.js:138-143`) → un E1 capturado se puede re-inyectar con otro msgId (replay/duplicación). Solo afecta contactos no migrados a proto-2. **Corrige el claim de `AUDITORIA.md` §2** («liga remitente↔sesión en el AAD» no aplica a E1).
- **N-D (muy leve):** extra `nexo_chat_device_id` sin testigo (`NexoBlePlugin.kt:284`) → otra app puede forzar abrir un chat. Molestia de UI, sin datos.
- **Privacidad (del agente de UX):** al pintar una **ubicación recibida**, `render.js:443` carga la imagen de mapa desde `static-maps.openstreetmap.de` → **filtra la ubicación a un tercero** en el render. Chico pero real y arreglable.
- **Superficie a vigilar:** `REQUEST_INSTALL_PACKAGES` (recibir/instalar APK por chat — Android pide confirmación).

### Cobertura de las pruebas destructivas
**CON prueba:** DoS de trozo (`chunkdos`), ACK falso (`ackforge`), grupo reescribe claves (`groupforge`), suplantación
(`spoof`/`impostor`), XSS (`xss`), JSON anidado (`SafeJson`/`ParserFuzz`), ataques LAN (Kotlin), relés en claro (`relaytls`),
misrouting (`misroute`), FCM (`fcmwake`), integridad en disco (`AtRest*`/`vaultdurable`/`WriteRetry`). **SIN prueba
(lagunas):** rollback del ratchet (D16), y pruebas ADVERSARIALES de SEC-2/H3/H4/M5/M6/F6/N-A/N-B.

---

## 3) NATIVO / BLE / DURABILIDAD DE DATOS

El plugin está muy endurecido (backpressure, cooldowns, reensamblado con topes, AtRestStore atómico, GCM+AAD,
`startForeground` protegido). Hallazgos de borde, rankeados:

| # | Riesgo | Dónde | Escenario |
|---|---|---|---|
| **R1** 🔴 | **Traer cuenta borra ANTES de importar (no atómico)** | `NexoBlePlugin.kt:3465-3486`, `BigFile.kt:142-155` | Si el Wi-Fi se corta tras el borrado → cuenta vieja borrada + nueva a medias + hilo cuelga ~10 min. **Atenuante:** el viejo solo borra tras el ACK → recuperable. **Fix:** importar a staging + swap atómico |
| **R2** 🔴 | **Fallo de escritura del vault tragado + clave at-rest nula** | `vault_manager.js:592,492,248,438` + `AtRestStore.kt:108` | Si la clave del Keystore está un instante no disponible, `saveToFile` lanza → `.catch` vacío → **mensaje perdido al reiniciar, SIN aviso**. El más peligroso por invisible. **Fix:** loguear/propagar + reintentar |
| **R3** 🟠 | **Adjuntos no se vuelcan al pasar a 2.º plano** | `vault_manager.js:434,606-608` | `pagehide`/`visibilitychange` vuelcan solo mensajes, no `_pendingAttachments` → si el proceso muere, mensaje apunta a adjunto inexistente. **Fix:** volcar adjuntos también en 2.º plano |
| **R4** 🟠 | **Fuga de descriptor en transferencia grande abandonada** | `BigFile.kt:45`, `NexoBlePlugin.kt:3354` | `bigWriters` no se limpia en desconexión/destroy → FD + `.enc` parcial quedan por cada id abandonado |
| **R5** 🟠 | **Fénix prueba una sola combinación de fragmentos** | `fenix.js:850-869` | Un custodio hostil con 1 fragmento malformado **traba** la recuperación (no la corrompe — GCM lo impide). **Fix:** reintento combinatorio |
| **R6** 🟡 | **Tope de 2000 mensajes por chat** | `vault_manager.js:577,617` | Historial antiguo se descarta. Decisión de diseño; que lo sepas |

**Carreras/fugas menores:** doble `onWriteDone` por timeout+confirmación tardía (auto-corrige); `_msgCache` LRU 20 →
actualización de estado puede perderse en ráfaga de >20 contactos (cosmético); `CallTelecom.active` se sobrescribe sin cerrar
(bajo). **Código muerto latente:** `vaultAppendChunk` sin lock (no cableado hoy). **Nota honesta sobre el pacing 2b (2899):**
el ítem «en vuelo» ya se saca de la cola antes de confirmar, así que el texto salta todos los trozos de archivo **menos el que
se está escribiendo** — sigue ayudando, un pelín menos de lo escrito.

**Lo que tranquiliza:** los archivos nunca se marcan perdidos (quedan ⏳ y se reenvían); el cooldown no_service corta el
martilleo en ambas puertas (2900); `startForeground` no tumba el proceso; la suite JVM cubre muchísimo.

---

## 4) FUNCIONAL / UX / PRODUCTO

### Huecos de UX (código que puedo hacer)
1. **Buscador global inexistente** (`search_ui.js` solo filtra dentro del chat abierto) — barato, alto impacto.
2. **Lista de chats sin archivar/silenciar/fijar** (`chat_actions.js`).
3. **Cámara anticuada** (estilo propio fuera del tema NEXO, `camera.js`).
4. **Pantalla de llamada de GRUPO distinta a la 1-a-1** (`groupcall_ui.js`).
5. **Estados solo texto** (`estados.js`) — sin «quién lo vio»/responder.
6. (medio) Reenviar archivos grandes no se puede; «ver una vez» solo fotos; mensajes temporales no existen; eco de grupo + proximidad abiertos; notificaciones ricas (#89, decisión de privacidad).

### Componente B — lo que espera confirmación en TELÉFONOS (el mayor freno del índice)
Ver `docs/PRUEBAS_FISICAS.md` (11 pruebas). Lo más importante: **despertador FCM / app cerrada** (probado 1 vez en S24,
falta el Vivo), **pacing (2899)**, **batería/no_service (2900)**, **logo nuevo (2897)**, **crash al subir archivo a chat viejo
(2887)**, **llamadas en el coche/Telecom**, **✓✓ con el otro cerrado**. Regla: cada ❌ con «Copiar diagnóstico» de los dos.

### Código frágil / load-bearing (congelar salvo necesidad)
`ble_ack.js` (2146 líneas, el motor de entrega, lo MÁS tocado) > `vault_manager.js` (datos) > `ble_messages.js` (router de
recepción) > `render.js` (`_renderMessage` ~400 líneas) > `main.js` (pegamento). **La mezcla ES5/ES6 ya rompió 54 pruebas una
vez** (hoisting de `var t` tapando `t()` de i18n) — disciplina máxima de «reproducir en sim antes de tocar».

### Producto para diciembre
- **Entretenimiento flojo:** solo 2 juegos (tres en raya + arcade oculto). **Honesto: no hay «motor» reutilizable** — `ttt.js`
  está hardcodeado; conecta-4 sería un archivo nuevo (barato pero no trivial). **Stream #95 NO construido** (hay un stub sin
  cablear). Stickers/reacciones sí están fuertes.
- **Monetización:** sin modelo decidido (decisión tuya; «cobros» fase 1 hecho; recargas necesitan socio).

---

## 5) ACCIONES RECOMENDADAS (rankeadas)

### 🟢 Código que puedo hacer con el método (sim/JVM + batería + build) — bajo riesgo
1. **Arreglar el leak de ubicación a openstreetmap** (`render.js:443`) — privacidad, muy barato.
2. **R2: no tragar los fallos de escritura del vault** (loguear/propagar + reintentar) — cierra pérdida silenciosa.
3. **R3: volcar adjuntos al pasar a 2.º plano** (`vaultFlushAll` en `pagehide`) — cierra adjunto perdido.
4. **R4: cerrar `bigWriters` en desconexión/destroy** — cierra fuga de FD.
5. **Corregir el claim de `AUDITORIA.md` §2** sobre AAD en E1 (y evaluar añadir AAD a E1 o apurar la migración a proto-2).
6. **Buscador global** + **conecta-4** (enganche) — si querés avanzar producto.

### 🟡 Requiere TU decisión (tocan cripto/identidad o son negocio)
1. **SEC-2** y **rollback del ratchet (P0-1)** — los 2 riesgos de seguridad reales. Tocan aceptación de claves / estado del
   ratchet; `AUDITORIA.md` pide tu visto bueno. Propuesta: SEC-2 → exigir confirmación visible antes de auto-agregar por `acc`;
   rollback → invalidar la sesión del ratchet al traer cuenta/recuperar (sin reusar estado viejo). Con una prueba adversarial cada uno.
2. **R1 (traer cuenta atómico)** — rediseño a staging+swap; es nativo y sensible.
3. **Validar en teléfonos** (componente B) — EL freno del índice; solo vos podés.
4. **Monetización** y **Stream sí/no** — negocio/arquitectura.

### 🔴 Riesgos que NO frenan diciembre pero conviene saber
- H4 (toma de cuenta por Fénix, requiere engañar a cada custodio), H3 (TOFU), F6 (timbre remoto, solo batería): aceptables
  como «leves» para el lanzamiento, con el banner de nº de seguridad como defensa.

---

## 6) CONCLUSIÓN

NEXO está **técnicamente sólido y bien probado**: cero fallos en 111 pruebas funcionales + Kotlin + 5 corridas de caos +
audio/vídeo real en navegador. La cripto es seria. El código está muy endurecido en durabilidad y ataques conocidos. Para
diciembre, el trabajo NO es más seguridad ni más features de utilidad: es **(a)** validar en teléfonos reales (sube el índice
de 55 a ~70), **(b)** cerrar los 2 riesgos de identidad/cripto cuando decidas cómo, **(c)** los arreglos baratos de datos
(R2/R3/R4) y privacidad (leak de ubicación), y **(d)** enganche + modelo de plata (producto/negocio). No hay sorpresas
críticas nuevas — el estado real coincide con lo que los docs ya decían, ahora con pruebas masivas que lo respaldan.
