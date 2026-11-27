# Auditoría de conexiones (28-11-2026, Opus) — qué tenemos de verdad

Pedido del dueño (28-11): «revisar toda la parte de conexiones, escaneos y lo funcional, para saber si es sólido antes de decidir cómo
enfrentarlo». Cuatro revisiones de solo lectura en paralelo (elección de camino y reenvíos · Bluetooth · internet · Wi-Fi local / Wi-Fi
Direct / L2 / puente Jump) + investigación de cómo lo hacen otras apps (sección 7). Lo marcado **[probable]** se dedujo leyendo el código y
falta reproducirlo en `tests/sim`.

## 1. Veredicto en una línea por área

| Área | Veredicto | Por qué, en corto |
|---|---|---|
| Elegir camino y reenviar | **Parchado, tirando a frágil** | Se decide en ~25 sitios con órdenes distintos; 14 mecanismos de reenvío sin calendario común |
| Bluetooth (escaneo, enlace, zombi) | **Parchado, camino de frágil** | 5 registros de estado, 9 sitios que conectan, 8 que cortan; el zombi sale del diseño, no de un fallo suelto |
| Internet (relés, Tor, toque, puente a internet) | **Parchado, frágil en las uniones** | Nadie sabe dónde escucha el otro; la app y el nativo usan reglas distintas; ~45 relojes sin coordinar |
| Wi-Fi local / Wi-Fi Direct / L2 / Jump | **Parchado, con zonas frágiles** | Piezas de base buenas; el orden entre ellas se decide en 4 sitios; Wi-Fi Direct no está listo para la multitud |

Lo bueno, para ser justos: casi cada pieza por separado está pensada, tiene su porqué y muchas su prueba (Wi-Fi local con comprobación
cifrada y latido, límites contra abusos del puente, detección de relé muerto, flapeo, HalfOpenPolicy, linkPlan). **Lo que falta es el
sistema**: un modelo único de «qué sé de este contacto» y «qué camino uso y por qué», del que salgan todas las decisiones.

## 2. Cuánto es parche (medido)

- ~22 000 líneas revisadas (JS + Kotlin de conexiones); ~1 000 comentarios citan un número de build/ronda o «#dueño».
- Peores: `chat_stream.js` (`_onWindowTimeout` con 16 salidas tempranas y 19 casos especiales en ~200 líneas), `ble_ack.js`,
  `ble_messages.js`, `net_link.js`, `ble_relay.js`, `wifi_direct.js`, `NetBg.kt`.
- `ble_ack_shared.js` exporta 58 constantes de tiempos y topes. Unos 45 relojes solo en la capa de internet.
- Código muerto que parece vivo: `preferNet` (5 llamadas que creen cambiar algo y no cambian nada desde la 3079); `mesh_relay_bridge.js`
  y `web_socket_client.js` (633 líneas que nadie importa); ramas del relé propio con `OWN_RELAYS` vacío.

## 3. Elegir camino (el «enrutado»)

- **No hay un enrutador.** `ble_startup._resolveDeviceIdForNexoId` tiene un orden fijo (Wi-Fi local → internet → Bluetooth → …), pero
  texto, acuse, archivo (3 capas), llamada, grupo, pendientes, puente y el nativo deciden cada uno a su manera.
- **Órdenes que se contradicen:**
  - texto: puente Jump antes que el buzón; acuses: buzón antes que Jump.
  - mensajes: internet antes que Bluetooth (regla del dueño 3079); llamadas: Bluetooth antes que internet.
  - archivo: L2 antes que Wi-Fi Direct si mide más (`ble_ack_files.js`), Wi-Fi Direct antes que L2 fijo (`big_file.js`).
- **La política está escondida en «¿se puede llegar?»** (`lan.canReach`, `net.canReach` responden «no» por reglas de preferencia).
- **Información que existe y no se usa para decidir:** tiempo hasta ✓✓ por camino (solo para el diagnóstico, por día y sin separar
  contactos), si el otro duerme (solo frena reintentos), fallos por camino (`NEXO_notePathFail`: nadie los lee), velocidad medida (solo
  Wi-Fi Direct/L2). **No existe** «dónde está el otro» (misma Wi-Fi / cerca / lejos) ni «en qué relés escucha».

## 4. Reenvíos y reintentos

- 14 mecanismos con su reloj y su contador en mapas distintos (acuse corto 5×, ventanas de ChatStream 8× y 8 modos de espera,
  `_resendPendingMessages` llamado desde 28 sitios, red de seguridad +10 s, toques, acuses, reanudación, bandeja nativa, puente,
  búsqueda de camino, bajadas del buzón, resync, outbox, reconexión). **No hay un calendario por mensaje.**
- Dos definiciones distintas de «reenviable» (`_isResendable` vs `vaultGetPendingMessages`).
- Un mismo evento (`_netUp`) dispara 5 mecanismos a la vez; solo un control de «ya en vuelo» evita el doble envío.
- **[probable] Doble publicación por internet:** la red de seguridad (pensada para Bluetooth) se arma también por internet; a los 10 s
  sin ✓✓ no encuentra la entrada (la borró la custodia del relé) y vuelve a cifrar y publicar. Pasa con cada texto a alguien dormido.
- **[probable] Textos ⏳ que no vuelven a salir con la app a la vista** si el otro no tiene enlace ni ruta (solo la bandeja nativa,
  que trabaja con la app oculta); y al ocultarse, el nativo los vuelve a subir sin saber que un relé ya los guardaba.

## 5. Bluetooth

- 5 registros de estado (3 en JS con claves distintas, 2 en Kotlin) y ninguno manda. «Listo» significa cosas distintas según quién lo
  ponga (READY sin MTU ni suscripción en 2 sitios; lo «recuperado» al volver la app entra «sin comprobar»).
- Conectan 9 sitios (solo uno pasa por el gestor de enlaces); cortan 8; buscan 4. **Se pisan:** una caída dispara la reconexión
  nativa y la de JS a la vez, y la de JS cierra la que el nativo tenía en curso.
- **El zombi, causa de raíz:** se detecta en la app (el otro no contesta pings) y se «arregla» en la radio (rehacer el Bluetooth). Si
  el otro duerme o va a MTU 23, rehacer no sirve: vuelve a «listo» y cae cada ~30 s. Sin memoria entre reconexiones; un zombi en papel
  de servidor ni siquiera se corta de verdad (`disconnectDevice` sin `server:true`); cada vuelta a la app fabrica enlaces «sin comprobar».
- **[CONFIRMADO leyendo el código] Fallo real:** `_lastPongTime` se guarda con la MAC cruda («AA:BB:…», `ble_receive.js:47/303/380`,
  `ble_native_events.js:326`) y se lee con la clave de `_deviceStates`, que es la normalizada (`ble_native_events.js:366`) →
  `ble_linkmgr.js:193` y `ble_connections.js:186` leen siempre 0: «el más callado» y el desempate por «oído hace poco» deciden a ciegas.

## 6. Internet, Wi-Fi local, Wi-Fi Direct, L2, puente

- **Nadie sabe dónde escucha el otro.** Todo descansa en «los dos tienen la misma lista de relés», que es falso desde que hay pausas por
  límite y reservas por teléfono. El saludo no anuncia los relés.
- **La app y el nativo (segundo plano) no usan las mismas reglas:** con datos, la app escucha todos y el nativo 2; el nativo no recibe
  las reservas de solo lectura; **el nativo no hace caso a un relé que lo castiga** y sigue publicando (el castigo es por dirección IP:
  sigue «infringiendo» con acuses y saludos); reconexión y réplica distintas. Consecuencia: **el caso 21:53 sigue abierto si el que
  recibe está en segundo plano** (que es lo normal). Corrección al TRASPASO: el nativo NO lee 9 relés.
- Tres reglas distintas para «volver a pedir lo reciente» con un freno compartido mal usado; dos frenos de lo pesado que se pisan.
- **Wi-Fi Direct NO está listo para el vagón/multitud:** solo archivos; necesita un Bluetooth conectado como control (tope ~7 enlaces);
  una transferencia a la vez y «ocupado» castiga 10 min; grupo nuevo por cada envío (el «preparado» nunca se pone); **[probable]** el
  que recibe tira su Wi-Fi local al crear el grupo aunque haya algo en curso; **[probable]** al recibir, un plazo fijo de 120 s tira lo
  recibido si el envío tarda más (con 2,9 KB/s, cualquier cosa > ~350 KB); el puente Jump no lo usa.
- **[probable] Videollamada rechazada** con el contacto cerca por Bluetooth y los dos con datos (sin la misma Wi-Fi): `canVideo` solo
  acepta Wi-Fi local o internet y `_link` elige Bluetooth.
- **Puente Jump:** topes contra abusos buenos; enrutado básico (menos saltos, sin mirar calidad ni carga; si falla un salto no prueba
  otro). El que envía da por «enviado» con la custodia del puente y deja de reintentar. **Dos puentes distintos:** el de la app (custodia
  24 h, varios saltos) y el nativo con la app dormida (sin custodia, 10 min, solo directo).

## 7. Cómo lo hacen otros (investigación con fuentes, 28-11)

- **Google Nearby Connections** (código en github.com/google/nearby, `bwu_manager.cc`): empieza por Bluetooth y, tras el apretón de manos
  cifrado, **sube** al medio más rápido que tengan los dos (Wi-Fi LAN → hotspot → Wi-Fi Direct → Aware). El cambio es **ordenado**: el
  canal nuevo se abre en pausa, por el viejo se manda «última escritura» y «ya se puede cerrar», y solo entonces se cambia (no se pierde ni
  se desordena nada). Si falla: vuelve al anterior, prueba el siguiente y, si no queda, espera creciente.
- **Apple Network.framework:** tres modos explícitos — `handover` (cambiar solo si se pierde el camino), `interactive` (cambiar si hay
  pérdida o retraso), `aggregate` (sumar; gasta datos). «Happy Eyeballs» (RFC 8305): intentos escalonados en paralelo, gana el primero.
- **Briar:** por contacto se queda **una sola conexión, la de más prioridad**; si hay Wi-Fi local con un contacto, suelta su Bluetooth
  (Bluetooth admite pocas conexiones). Sondeo por transporte con intervalo al azar; al aparecer un transporte, intenta ya. La
  confirmación de cada mensaje va **por contacto, no por camino**.
- **bitchat** (malla BLE + Nostr): orden malla → Nostr → «mensajeros»; ruta fija si hay un camino confirmado en los dos sentidos y, si
  falla, inundar; saltos (TTL) según cuántos vecinos hay; espera al azar antes de reenviar y cancelar si otro ya lo hizo; **bandeja por
  contacto con tope de mensajes, de reintentos (8) y de horas (24 h)**; se borra con la confirmación de extremo a extremo.
- **Meshtastic:** inundación controlada con espera según la señal (SNR); desde la 2.6 los directos **aprenden el siguiente salto** y en el
  último reintento vuelven a inundar.
- **Berty:** al encontrarse cerca, cada teléfono le pasa al otro **dónde encontrarlo luego por internet** («registro local»).
- **Nostr NIP-65 / NIP-17:** cada usuario **publica la lista de relés donde lee**; un mensaje privado se publica **solo en los relés de
  lectura del destinatario**. Respuestas estándar de los relés: `rate-limited` (puede traer cuánto esperar), `duplicate` = éxito,
  `blocked`/`restricted`/`invalid` = no reintentar. Los clientes buenos **puntúan cada relé** y usan relés distintos por contacto.
- **DTN (redes sin conexión continua):** Spray-and-Wait (tope de copias), PRoPHET (probabilidad de encontrarse con el destinatario, que
  sube con cada encuentro y baja con el tiempo; solo se entrega a quien tiene más probabilidad).
- **Despertar (FCM):** un aviso de prioridad alta que no termina en notificación visible **FCM lo baja a normal** (se mide 7 días por
  instalación); se puede vigilar con `getPriority()` frente a `getOriginalPriority()`. El cupo de «App Standby» también lo frena.
- **Reintentos (AWS):** espera creciente **con azar completo** («Full Jitter») y tope de intentos; sin azar es lo peor.
- Sin fuente encontrada: reglas publicadas de histéresis o batería para no oscilar (se toman como buena práctica de diseño).

**Lo que NEXO no tiene y los demás sí (lo esencial):** estado y prioridad por contacto (Briar), subida de camino con cierre ordenado
(Nearby), cambio por calidad medida con modo explícito (Apple), relés de lectura anunciados y publicar en los del otro (Nostr), puntuar
relés y respetar el «esperar N ms» del relé, bandeja por contacto con un calendario y topes (bitchat), ruta aprendida con plan B
(Meshtastic), pasarse «dónde encontrarme» al estar cerca (Berty), probabilidad de encuentro para el puente (PRoPHET), vigilar que FCM no
baje la prioridad de nuestros toques, y azar en las esperas.

## 8. Lo que haría falta para que sea sólido (coinciden las 4 revisiones)

1. **Un estado por contacto**: lugar (misma Wi-Fi / cerca / lejos), por camino la mediana hasta ✓✓ y fallos recientes, despierto o
   dormido, en qué relés escucha, salud del enlace (radio viva vs. app que contesta).
2. **Una sola función de elección** `elegir(contacto, tipo, tamaño)` que usen texto, acuse, archivo, llamada, grupo, pendientes y el
   nativo; con tabla de decisiones escrita y la causa de cada cambio en el diagnóstico. Sacar la política de `canReach`.
3. **Un calendario por mensaje**, guardado y compartido con el nativo (no publicado / guardado en relé X / sin ✓✓), el único que reenvía;
   los 14 mecanismos pasan a solo avisarle.
4. **Una máquina de estados del enlace Bluetooth por contacto**, con un solo dueño (el nativo) y un solo reconector con freno creciente;
   separar «la radio vive» de «la app del otro contesta» (si la radio vive y la app no: toque y otro camino, no reconectar).
5. **Una sola política de relés** (módulo puro, probado) que la app calcula y el nativo recibe ya hecha; el saludo anuncia dónde escucho;
   publicar donde el otro lee; ✓ solo si lo guardó uno de esos; un solo planificador de envíos por relé (también en el nativo).
6. **Plazos por avance** con eventos de avance del nativo y reanudación de archivos; Wi-Fi Direct como camino propio (grupo preparado,
   varias transferencias, no tirar un grupo en uso).
7. **Pruebas por escenario** (matriz) que cuenten envíos por mensaje y cambios de camino con su causa.
8. Borrar lo que eso deja sin sentido (preferNet, la red de seguridad por internet, la familia de reglas de duplicados y «sin comprobar»,
   código muerto).

## 9. Opciones para el dueño

**Arreglos sueltos que no dependen del rediseño** (baratos, cada uno con su prueba; se pueden hacer ya en Opus):
el `_lastPongTime` con claves distintas (confirmado); el nativo que ignora a un relé que lo castiga; la doble publicación por la red de
seguridad por internet; el plazo fijo de 120 s al recibir por Wi-Fi Direct; la videollamada rechazada estando cerca por Bluetooth con
datos; el nativo escuchando solo 2 relés con datos y sin las reservas.

**El rediseño:**
- **A — Reescribir el núcleo de conexiones de una vez** (estado por contacto, `elegir()`, calendario por mensaje, máquina de estados del
  Bluetooth en el nativo, política de relés compartida con el nativo). Lo que vives: semanas sin APK estables y un salto grande con riesgo
  alto de fallos nuevos a la vez. No lo recomiendo.
- **B — Núcleo nuevo y migrar por partes (recomendado).** 1) Diseño completo por escrito (estado por contacto, tabla de decisiones con
  cada condición de arriba, calendario por mensaje) que tú revisas antes de programar. 2) El núcleo como módulos nuevos y puros con una
  matriz de escenarios en `tests/sim` (misma Wi-Fi con corte, lejos con relés limitando, dormido, Bluetooth medio muerto, multitud,
  entrar a la Wi-Fi a mitad de un archivo, el nativo con la app oculta…) que cuenta envíos por mensaje y cambios de camino con su causa.
  3) Migrar por partes, cada una con su APK que funciona: textos y acuses → archivos → llamadas y grupos → nativo. Al migrar cada parte se
  BORRAN las reglas viejas que sustituye (no se dejan conviviendo). 4) Máquina de estados del Bluetooth (zombi). 5) Wi-Fi Direct como
  camino propio para la multitud. Lo que vives: una APK por fase que mejora algo concreto y medible, sin sustos; tarda más en total.
- **C — Seguir arreglando cada diagnóstico.** Lo que vives: lo de esta semana, cada semana. No.
