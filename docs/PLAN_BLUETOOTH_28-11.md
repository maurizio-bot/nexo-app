# Plan de la capa Bluetooth (28-11-2026, Opus) — especificación para programar

Decisión del dueño (28-11): arreglar las conexiones **una a la vez** hasta que cada una sea sólida (Bluetooth → Wi-Fi Direct →
internet → Wi-Fi local) y **solo al final** el cambio entre caminos (enrutado). No se borra todo: se conserva lo que funciona y se quita
lo que sobra. Este documento es la parte del Bluetooth. Base: `docs/AUDITORIA_CONEXIONES_28-11.md` (§5 y §7), lectura del código de
hoy (rama NEXOCHAT, build 3166) y los diagnósticos reales de `docs/diagnosticos.json`.

Marcas: **[confirmado]** = leído en el código; **[probable]** = deducido leyendo, falta reproducirlo en `tests/sim`;
**[hipótesis]** = explica un diagnóstico pero hay que medirlo antes de darlo por cierto.

---

## 1. Alcance

**Es «la capa Bluetooth»** todo lo que hace falta para que, entre este teléfono y un contacto cercano, haya **un enlace Bluetooth que
sirva de verdad** y para decir **cómo está**:

| Pieza | Dónde vive hoy |
|---|---|
| Escaneo (cuándo, cuánto, filtro NEXO, ventana 5/30 s de Android, multitud) | JS `ble_conn_scan.js`, `ble_connections.js` (bucle de re-búsqueda), `ble_relay.js` `_scan`; Kotlin `PluginScan.kt`, `ScanBook.kt`, `PluginBackground.kt` (`outboxDialStep`), `BleSinApp.kt` |
| Anuncio y código rotativo (NEXO ID visible / código por época, LE Coded) | Kotlin `BleService.kt`, `RidToken.kt`, `AdvertisedId.kt`; JS `ble_privacy.js` (`_ridFound`), `ble_rid.js` |
| Conexión GATT como cliente (conectar, servicios, MTU, suscripción) | Kotlin `PluginGatt.kt`, `SinAppLinks.kt` (sin la app), `PluginBackground.kt` (bandeja) |
| Conexión GATT como servidor (entrantes, suscripción del otro, MTU del otro, cortar de verdad) | Kotlin `GattServerHost.kt`, `PluginBtState.kt` (callback), `BleSinApp.kt` (callback sin la app), `HalfOpenPolicy.kt`, `ServerFlapPolicy.kt` |
| Cola de escritura (una en vuelo, prioridad, reintento, atasco) | Kotlin `PluginBleSend.kt`, `WriteRetry.kt`, `WritePacing.kt` |
| Prueba de vida (ping/pong) y «zombi» | JS `ble_connections.js` (vigilante), `ble_receive.js` (pong); Kotlin `PluginBackground.kt` `nativePong`, `SinAppCore.kt` `pong` |
| Reconexión | JS `ble_connections.js` (`_attemptAutoReconnect`, bucle de re-búsqueda); Kotlin `PluginGatt.kt` `startAutoReconnect` |
| Tope de enlaces y prioridades | JS `ble_linkmgr.js`; Kotlin `OutboxDial.kt` (`MAX_CLIENT_LINKS`) |
| Enlaces de paso con NEXO anónimos (saber quién es, Jump) | JS `ble_relay.js` (`_connectAnon`, `_connect`, `transient`), `ble_relay_anon.js`, `ble_relay_pass.js` |
| LE Coded (largo alcance) | Kotlin `BleService.kt` (conjunto de anuncio), `PluginScan.kt` (`scanSettings`, `connectLe`); JS `ble_native_events.js` (copia de largo alcance) |
| Bluetooth con la app oculta, dormida o cerrada | Kotlin `PluginRx.kt`, `PluginBackground.kt`, `OutboxDial.kt`, `SinAppLinks.kt`, `BleSinApp.kt`, `SinAppCore.kt` |
| Bluetooth apagado / encendido | Kotlin `PluginBtState.kt` 36–58; JS `ble_connections.js` `_onBtState`, `_dropBtLinks` |

**NO es de esta capa** (queda para su fase o para el enrutado final, y esta capa no lo decide):
- Elegir camino (Bluetooth vs Wi-Fi local vs internet vs Wi-Fi Direct), el orden de `ble_startup._resolveDeviceIdForNexoId` (99–153), `preferNet`, `canReach`.
- Reenvío y reintentos de mensajes (ventanas de `chat_stream`, acuses, red de seguridad, `_resendPendingMessages`, calendario por mensaje).
- El toque FCM (`_tickWakePending`, `_wakeSleepingPeer`): la capa solo dice «despierto / dormido / congelado»; quién toca y cuándo es del enrutado.
- Qué se reenvía por Jump y por qué ruta (la tabla de rutas de `ble_relay.js`); esta capa solo abre y cierra las conexiones de paso que el puente pide.
- Wi-Fi Direct y L2CAP (`wifi_direct.js`, `l2_fast.js`): son la fase siguiente. Esta capa les ofrece el enlace de control (`linkReady(nx)`).
- Lo que va dentro de los paquetes (cifrado, `kx`, `sessionSync`): la capa avisa «enlace listo» y el de arriba manda su saludo.

**Regla de frontera:** la capa Bluetooth entrega y recibe **bytes de un contacto** («manda esto a nx…», «llegó esto de nx…») y publica
el **estado del enlace por contacto**. Nadie fuera de ella habla de direcciones Bluetooth.

---

## 2. Lo que está BIEN y se conserva

Cada pieza sigue, aunque cambie de sitio (casi todo pasa a una sola clase nativa, §5.1).

| # | Qué | Dónde | Por qué se conserva |
|---|---|---|---|
| B1 | **Un servidor GATT por proceso** que no se cierra al abrir/cerrar la app; quien atiende se engancha (`attach`/`detach`) | `GattServerHost.kt` 17–35, `PluginBtState.kt` 212–243 | Acabó con «abrir NEXO rompe el Bluetooth de los demás» (3263). Es el modelo a copiar para los enlaces de cliente (§5.1). |
| B2 | **Cortar de verdad un enlace entrante** («tenerlo» con `server.connect` y luego `cancelConnection`) | `PluginBtState.kt` 251–269 | Sin esto `cancelConnection` no cortaba nada (3262). Es la base de «cortar los dos papeles». |
| B3 | **HalfOpenPolicy** (escribe sin suscribirse > 6 s → cortar) | `HalfOpenPolicy.kt` 16–41; uso en `PluginBtState.kt` 368 y `BleSinApp.kt` 428 | Pura, probada (`HalfOpenPolicyTest`), detecta el enlace que sobrevivió a un reinicio del servidor. Pasa a ser una entrada más de la máquina. |
| B4 | **ServerFlapPolicy** (frena al desconocido que entra y sale) | `ServerFlapPolicy.kt`; uso `PluginBtState.kt` 315–326, `PluginRx.kt` 151 | Pura, probada; solo actúa con direcciones que nunca dijeron nada. Se queda tal cual. |
| B5 | **Orden de puesta en marcha del cliente**: MTU primero, notificaciones después; reintento de MTU a 247 | `PluginGatt.kt` 238–248, 291–304 | Android hace una operación GATT a la vez; si no, se queda en MTU 23 (ronda 2757). |
| B6 | **No escribir por el cliente hasta terminar MTU + suscripción** (esperar entero, partir con el MTU real) | `PluginBleSend.kt` 116–119, 150–166; `WriteRetry.waitForClientSetup` | Evitaba 70 escrituras de 20 bytes para 1,4 KB (3059). |
| B7 | **Cola de escritura**: una en vuelo por enlace, siguiente al confirmar Android, prioridad a texto/control sobre trozos de archivo, un mensaje entra entero o no entra, reintento escalonado del 201, vaciar y cerrar un enlace atascado | `PluginBleSend.kt` 112–210, `WritePacing.kt`, `WriteRetry.kt`, `closeStuckLink` en `PluginGatt.kt` 484–507 | Medido y probado (JVM). El cierre por atasco pasa a ser un evento de la máquina (`ATASCADO`). |
| B8 | **Reensamblado defensivo** (tope de bytes, mensaje cortado se descarta al empezar otro) | `PluginRx.kt` 108–200 | Probado en diagnósticos reales (3059). |
| B9 | **Pong nativo** (contesta el ping aunque el JS duerma), solo a contactos (12A) | `PluginBackground.kt` 175–188, `SinAppCore.kt` 171–178 | Es la semilla de la prueba de vida nativa (§5.2). Se generaliza: contesta siempre el nativo. |
| B10 | **Escaneo filtrado por fabricante NEXO** y avisos en tandas para multitud | `PluginScan.kt` 98–103, 187–239; `ScanBook.kt` | Palanca n.º 1 en un concierto (2838, 23-11). |
| B11 | **Respeto del límite de Android (5 arranques / 30 s)** con un hueco reservado al usuario, y recetas por código de `onScanFailed` | `ble_conn_scan.js` 68–99, 104–142 | Correcto; solo cambia de dueño (al nativo, para contar también los escaneos del nativo). |
| B12 | **Código rotativo** por época y reconocimiento de contactos con su clave | `BleService.kt` 65–77, 284–290; `RidToken.kt`; `OutboxRid`; `ble_privacy.js` 264–300 | Privacidad y reconocimiento sin conectar. |
| B13 | **Regla de la copia LE Coded**: si al mismo código se le vio por 1M hace < 20 s, no se conecta por la copia; si solo llega por Coded, se espera 3 s | `ble_native_events.js` 54–86 (`CODED_HOLD_MS` 3 s, `CODED_ONLY_MS` 60 s) | Bien pensada (3009/3012). Se completa con la verificación (§5.1): el caso del 26-11 08:30 fue una conexión que ya estaba abierta. |
| B14 | **Plan de tope de enlaces** (`linkPlan` / `linkTrim`, puras): 6 enlaces, 4 «por estar cerca», un hueco para quien tiene pendientes y otro de paso; desalojo por prioridad | `ble_linkmgr.js` 24–79; prueba `enlacestope.js` | Decisión del dueño 22-11. Se porta a Kotlin igual (mismos números, mismos casos de prueba). |
| B15 | **«Solo a quien está cerca»** (visto < 2 min o enlace caído < 1 min) | `ble_conn_scan.js` 297–304 (3084) | Evita llenar la cola de conexiones de Android con teléfonos ausentes. Pasa a condición del reconector. |
| B16 | **Pausa por «sin servicio» repetido** (#87): 4 seguidos → 30 s doblando hasta 10 min; la racha caduca desde el fin de la pausa | `ble_native_events.js` 232–246 | Probado (`noservice.js`). Pasa a la memoria del reconector (§5.3). |
| B17 | **Calendario de búsqueda con la app oculta** (`OutboxDial.gapMs` / `calmGapMs`, despertador) | `OutboxDial.kt` 14–64 | Puro y probado (`OutboxDialTest`). Se usa como calendario del escaneo oculto (§5.4). |
| B18 | **Bluetooth apagado/encendido**: el nativo suelta el servidor y lo rehace; la app da por cerrados los enlaces | `PluginBtState.kt` 36–58; `ble_connections.js` 625–659 | Arreglado con diagnósticos (2995, 3082, 3250). |
| B19 | **Anuncio agrupado tras ráfagas de desconexiones** | `ble_native_events.js` 268–276 | 24 `startAdvertising` en 1 ms → uno (3203). |
| B20 | **Conexiones de paso: tope, rotación con «Agregar» abierto, cierre del anónimo que resultó ser un contacto ya enlazado** | `ble_relay.js` 596–612, 690–736; `ble_relay_anon.js` | Las reglas de negocio se quedan; solo cambia que abren/cierran por la entrada única. |
| B21 | **Ping viejo de antes de congelarse la app no cuenta** | `ble_connections.js` 114–118 (3340) | La idea se conserva en el nativo (reloj que salta, §5.2). |

---

## 3. Lo que está MAL (con su evidencia)

**M1 — Claves distintas para lo mismo: `_lastPongTime` nunca se encuentra [confirmado].**
Se escribe con la dirección cruda «AA:BB:…» (`ble_receive.js` 47, 303, 380; `ble_native_events.js` 326) y se lee con la clave
normalizada «aabb…» de `_deviceStates` (`ble_native_events.js` 366): `ble_linkmgr.js` 193 (`lastAt` del gestor: «el más callado» sale
siempre el más viejo por `openedAt`) y `ble_connections.js` 186 (`heard` del desempate de repetidos: la regla 3233 «no cerrar el único
que recibe» no se aplica nunca). `ble_ack.js` 188–200 sí funciona porque compara con `_normMac`. Lo mismo pasa con `connectedDevices`,
`_pingFailCount`, `_supervisorStates` (crudas) frente a `_deviceStates`, `_mtuByDevice`, `_bleDeadUntil`, `_macToNexoId` (normalizadas);
`_cleanupStaleStates` tiene que recorrer `connectedDevices` comparando a mano (`ble_startup.js` 73–77).

**M2 — Todo va por DIRECCIÓN, no por contacto, y los dos papeles de una dirección comparten clave [confirmado].**
JS y Kotlin guardan el estado por dirección (`_deviceStates`, `gattClients`, `serverConnectedDevices`, `negotiatedMtu`). Un mismo
contacto llega por varias direcciones (rotación, anuncio 1M y Coded, cliente y servidor) y una misma dirección puede tener enlace de
cliente y de servidor a la vez: comparten `negotiatedMtu[mac]` (`PluginGatt.kt` 285 y `PluginBtState.kt` 421) y un solo estado JS
(`_deviceStates.set(_normMac(id))`, `ble_native_events.js` 366). Android avisa también al servidor del enlace que abrimos como
cliente (comentario en `PluginBtState.kt` 282–284) y ese aviso se pasa a la app como `onDeviceConnected` de **servidor**, que en JS
pone `READY_TO_CHAT` al instante (`ble_native_events.js` 129) sobre el `CONNECTING` del cliente **[probable: depende del orden de los
dos avisos]**. Por eso hacen falta el desempate de repetidos y sus 8 rondas de parches (3019, 3027, 3167, 3167b, 3233, 3257, 3262, 3327).

**M3 — «Listo» no significa listo [confirmado].**
Se marca `READY_TO_CHAT` en 4 sitios con significados distintos: (1) al conectar como servidor, antes de que el otro se suscriba ni
negocie MTU (`ble_native_events.js` 129; el nativo no avisa a la app de la suscripción: `PluginBtState.kt` 385–405); (2) a los 3 s de
`onServicesReady` sin notificaciones (`ble_native_events.js` 289–298), y el nativo manda `onServicesReady` antes de que termine la
escritura del descriptor (`PluginGatt.kt` 277); (3) con `onNotificationsEnabled` (312, el único bueno); (4) «recuperado» al volver la
app (`ble_connections.js` 412), con `ready` = «tiene característica» y no «terminó MTU y suscripción» (`PluginScan.kt` 281). El MTU la
app solo lo sabe tras el primer envío (`ble_send.js` 214–224) y mientras supone 185 (`ble_links.js` 64). Ningún «listo» comprueba que
los datos vayan y vuelvan: el 26-11 08:30 (Alex↔Roberto) un enlace a la copia LE Coded quedó «listo», los pings salieron por él y
nunca llegaron → zombi (diagnóstico 26-11 08:30, los dos lados).

**M4 — Conectan 9 sitios; solo uno pasa por el gestor [confirmado].**
JS: `ble_conn_scan._autoConnectGATT` 315–368 (el único con gestor, `_linkGo` 348); `ble_send.js` 393–397; `ble_blobs.js` 368–369;
`ble_interface.js` 394–405 (abrir chat) y 419–437 (`_prepRoute`); `ble_relay.js` 611 (`_connectAnon`) y 674 (`_connect`, también para
contactos). Kotlin: `startAutoReconnect` en cada caída de cliente (`PluginGatt.kt` 171, 217, 506; hasta 10 intentos, 3→30 s) y
`outboxDialStep` (`PluginBackground.kt` 474–482), y `SinAppLinks.connect` sin la app (`SinAppLinks.kt` 73–83). **Se pisan:**
`connectToDevice` cierra el `gattClients[mac]` que hubiera (`PluginGatt.kt` 106–108), incluido el que la reconexión nativa acababa de
abrir; y `startAutoReconnect` cierra el que abrió la app (411–413).

**M5 — Cortan 8 sitios y casi ninguno corta los dos papeles [confirmado].**
`_forceDisconnectAndReconnect` (`ble_connections.js` 365, el zombi: **sin `server:true`**), pausa de cámara (`ble_camera_pause.js` 32),
`relay._closeIdleTransient`/`releaseTransient` (`ble_relay.js` 717, 733), anónimo identificado (`ble_relay_anon.js` 37), paso libre
(`ble_linkmgr.js` 139), cortado por el otro (`ble_native_events.js` 206), `disconnect()` (`ble_conn_scan.js` 378): todos sin
`server:true`. Solo el desempate (`ble_connections.js` 210) y el tope con papel de servidor (`ble_linkmgr.js` 203) cortan el entrante.
Consecuencia: un zombi en papel de servidor no se corta; la app lo da por cerrado y el otro sigue escribiendo por él.

**M6 — El zombi se detecta en la app y se «arregla» en la radio [confirmado + hipótesis del ciclo de 30 s].**
El vigilante JS (`ble_connections.js` 76–137) manda un ping JS; contesta el JS del otro, o su nativo **solo** si su app está en
segundo plano o cerrada (`PluginRx.kt` 156). 4 pings sin respuesta → cortar y reconectar (`_forceDisconnectAndReconnect`). Pero si el
otro tiene el proceso congelado (Vivo 19-11 04:38: «el sistema congeló el proceso entero; el Bluetooth del sistema aceptaba
conexiones, MTU y avisos en su nombre») o su servidor con asas viejas, **rehacer no sirve**: vuelve a «listo» (M3) y vuelve a caer.
Casos: tablet nx1e29ab2f 27-11 21:41 («se rehace y se cae cada ~30 s durante > 7 min»), Katy 19-11 21:46 («su nativo acepta, su app no
contesta → corta por zombi y reconecta cada 1–2 min»), Vivo 27-11 05:17 (MTU 23, «stuck», reenvío sin fin), 24 diagnósticos «zombi» en
total. **[hipótesis]** el ciclo de ~30 s es el plazo de transacción ATT de Android (30 s): con el proceso del otro congelado nadie
contesta la escritura del descriptor y el sistema tumba el enlace solo. Además el pong nativo trae `nb:1` (`PluginBackground.kt` 185) y
**la app no lo mira** (ninguna lectura de `nb` en `src/`): no se distingue «radio y nativo vivos, app dormida» de «todo vivo».

**M7 — Sin memoria entre reconexiones [confirmado].**
`_reconnectAttempts` se borra al quedar listo o a los 8 intentos (`ble_connections.js` 388); `_pingFailCount` se borra al cortar
(360) y al conectar (`ble_native_events.js` 137, 325); el nativo pone `reconnectAttempts[mac] = 0` en cada conexión (`PluginGatt.kt`
123, 175). Solo «sin servicio» tiene racha (`ble_native_events.js` 232–246). Un zombi que reconecta empieza de cero cada vez → bucle.

**M8 — Cada vuelta a la app fabrica enlaces «sin comprobar» [confirmado].**
`_cleanupStaleStates` borra **todo** estado Bluetooth cuyo último cambio tenga > 10 s, también los `READY` sanos (`ble_startup.js` 64);
`_seedNativeConnections` los vuelve a meter como `READY` + `_unverified` (`ble_connections.js` 412–420) y con **un** ping sin respuesta
se rehacen (121–128). Encima `_onAppResumed` manda `sessionSync` y reenvía pendientes por cada enlace (`ble_startup.js` 339–345) y
`appStateChange` vuelve a limpiar (319). Diagnósticos: S24↔Austin 24-11 14:54 (3330), Marcos 25-11 13:53 (3340: rehízo un enlace sano
y reinició un archivo de 358 trozos).

**M9 — Dos (tres) reconectores a la vez [confirmado].**
Nativo `startAutoReconnect` (10 intentos, Equal Jitter 3→30 s, `PluginGatt.kt` 377–429), JS `_attemptAutoReconnect` (8 intentos, 2→30 s,
`ble_connections.js` 372–397, que además lanza un escaneo una vuelta sí y otra no, 375) y el bucle de re-búsqueda + presencia
(`ble_connections.js` 468–527, 574–578). Una caída dispara los tres; el de JS cierra el intento nativo en curso (M4).

**M10 — Los repetidos se crean y luego se cierran [confirmado].**
Nada impide abrir un segundo enlace con el mismo contacto: el escaneo solo lo evita si hay otro «listo» con MTU > 23
(`ble_conn_scan.js` 193–205); el puente de paso conecta a anónimos que resultan ser contactos (diag. 23-11 08:27); la copia Coded se
conecta antes de verse la normal (26-11 08:30). Después el desempate necesita un acuerdo entre teléfonos (decide el NEXO ID menor; el
mayor espera 3 min, `ble_helpers.js` 222–250). Diagnósticos «enlace_abre_cierra»: 18-11 (×4), 19-11 14:23 y 14:56, 19-11 22:22, 20-11
11:00/11:10/11:52/12:33, 23-11 08:27.

**M11 — El escaneo tiene muchos dueños y el tope de Android solo lo cuenta la app [confirmado / probable].**
Arrancan escaneos: el bucle de re-búsqueda, la presencia al volver (2 min), `_attemptAutoReconnect`, `relay._scan` (`ble_relay.js`
635–646), `appStateChange` (`ble_startup.js` 315), Bluetooth encendido, el reintento de `onScanFailed`, y en Kotlin `outboxDialStep`
(`PluginBackground.kt` 488–500, solo si no hay otro escaneo) y `BleSinApp.dialStep`. La ventana 5/30 s (`_scanStartTimes`) solo cuenta
los de la app **[probable: con la app oculta pueden coincidir el bucle JS de 60 s y la bandeja nativa]**. Con una transferencia el
escaneo se para hasta 3 min (`ble_connections.js` 497–513).

**M12 — MTU mal conocido [confirmado].**
Sin MTU apuntado se parte a 20 bytes (`PluginBleSend.kt` 122, valor por defecto 23); el servidor solo lo sabe si el otro lo negocia
(`PluginBtState.kt` 421); el cliente activa notificaciones a los 2 s aunque el MTU no haya contestado (`PluginGatt.kt` 247). Diag. 20-11
13:00: un archivo en curso se reinicia «MTU 23, trozos de 324» y 42 ms después llega «MTU 517».

**M13 — Tope de enlaces partido en tres [confirmado].** JS 6/4 (`ble_linkmgr.js` 24–25), bandeja nativa 7 de cliente
(`OutboxDial.kt` 20), relevo `MAX_TRANSIENT`; los entrantes no cuentan en ninguno de los nativos.

**M14 — App a la vista y app oculta con reglas distintas [confirmado].** A la vista mandan el gestor JS, «solo cerca» y la pausa por
«sin servicio»; oculta, `outboxDialStep`/`SinAppLinks` conectan con otras reglas (sin pausa, sin memoria de zombis, tope propio). Al
abrir la app `SinAppLinks.closeAll` cierra enlaces que funcionaban para que la app abra los suyos (`SinAppLinks.kt` 24–26): corte y
reconexión en cada apertura.

**M15 — Identidad del enlace adivinada por dirección [confirmado].** `onDeviceConnected` busca el contacto por la dirección guardada en
la libreta (`ble_native_events.js` 125), que rota; `_macToNexoId` se rellena desde 6 sitios (escaneo, `kx`, libreta al arrancar
`ble_startup.js` 8–21, `_kickPeer`, `_notifyPeerReady`, relevo). De ahí los «Enlace ? (xxxx)» y la marca «llegó a estar listo» que no se
borraba (3283).

**M16 — Un mensaje soltado deja fuera TODAS las direcciones del contacto 20 s [confirmado].** `_markBleDead` (`ble_links.js` 74–97)
marca muertas todas sus direcciones aunque otra esté sana.

**M17 — Espera con «Equal Jitter», no «Full Jitter» [confirmado].** `_jitteredBackoff` (`ble_helpers.js` 319–325) y
`getReconnectDelay` (`PluginGatt.kt` 377–386) esperan entre la mitad y el total: con muchos teléfonos a la vez (vagón, concierto) los
reintentos siguen amontonados en la mitad alta. AWS mide «Full Jitter» como el mejor (auditoría §7).

**M18 — Protecciones que se cruzan.** «Transferencia activa no se pinga» (`ble_connections.js` 86–90) + «flujo sin ACK 20 s no
protege» (`ble_ack.js` 188–200, 3037/3338) + «recuperado sin comprobar no se protege» (3330) + «ping de antes de congelarse no cuenta»
(3340): cuatro reglas para una pregunta («¿este enlace lleva datos de verdad?») que se responde mirando si **se oye** algo por él.

---

## 4. Lo que se QUITA (lista exacta)

Al terminar el paso que lo sustituye (§7), estas piezas **no quedan**: ni comentadas, ni detrás de una perilla.

**JavaScript**
- `ble_connections.js`: la parte Bluetooth de `_runSupervisorCycle` (líneas 74–139: pings, zombi, `_dedupBleLinks`); `_noteLinkFlap`
  (la cuenta pasa al nativo, §5.7); `_dedupBleLinks` y `_rebindOutgoing` (con envíos por contacto no hay nada que «pasar»);
  `_pingDevice`; `_forceDisconnectAndReconnect`; `_attemptAutoReconnect`; `_seedNativeConnections`; `_kickPeer` en su parte de enlace;
  `_markPeerLost`, `_startReconnectScanLoop`, `_stopAutoScan`, `_transferActive`, `_hasUnreadyContacts`, `_lostPeersWithPending`,
  `_startPresenceSearch` (pasa a una petición al escáner nativo), `_waitForReadyToChat`, `_resolveReadyToChat`, `_btIsOff`,
  `_noteBtOff`, `_dropBtLinks`. **Se quedan** (no son de esta capa): `_tickWakePending`, `_noteWakePending`, `_wakeStuckPending`,
  `_wakeStillPending`, `_creditBridge`, `_hasActiveFileTransfer` (lo usa el de arriba) y el arranque del supervisor para lo no-Bluetooth.
- `ble_native_events.js`: los manejadores de estado de `onDeviceConnected`, `onServicesReady`, `onNotificationsEnabled`,
  `onConnectionFailed`, `onDeviceDisconnected` (se sustituyen por UN manejador `onContactLink`); la regla de la copia Coded (pasa al
  nativo); `_notificationFallbackTimers`; `_peerCutUntil`; la racha `_noServiceStreak`/`_noServiceLast`/`_bleCooldownUntil`;
  `_linkLostAt`; `_setDeviceState`/`_getDeviceState` para Bluetooth. Se quedan los avisos de escaneo (como entrada a `onDeviceFound`
  para la interfaz: lista de cercanos, «Agregar»), invitación y servidor listo.
- `ble_conn_scan.js`: el cuerpo de `_autoConnectGATT` (queda como `_wantLink`, una línea, §5.3), `_autoScanForKnownContacts` y toda la
  compuerta de escaneo (`_scanWindowFull`, `_scanWindowFullBg`, `_noteScanStart`, `_scanWindowWaitMs`, `_onScanFailed`,
  `_scheduleScanRetry`), `_stopPingInterval`, `disconnect()`, `_btPauseKey`, `_btPaused` (pasa a leerse del estado), `_btNearby` y
  `_btFarSkip` (al nativo).
- `ble_linkmgr.js` entero (se porta a Kotlin `LinkCap.kt`; la prueba `enlacestope.js` pasa a vectores compartidos, §6).
- `ble_links.js`: `_bleReadyFor` (lo sustituye la vista del estado, misma firma, §5.6), `_markBleDead`, `_clearBleDead`, `_bleCongested`,
  `BLE_DEAD_TTL_MS`.
- `ble_startup.js`: la parte Bluetooth de `_cleanupStaleStates`; en `_onAppResumed` el bucle de `sessionSync` + reenvío por enlace
  (339–345); en `_notifyPeerReady` el borrado de la racha y la pausa; la lectura de la libreta para el mapa dirección↔contacto (8–21).
- Conexiones directas: `ble_send.js` 393–397, `ble_blobs.js` 368–369, `ble_interface.js` 394–405 y 436, `ble_relay.js` 611 y 674.
- Cortes directos: `ble_relay.js` 717 y 733, `ble_relay_anon.js` 37, `ble_camera_pause.js` 32 (pasan a `dropLink`).
- `ble_helpers.js`: `_dupBleLinksToClose`, `DUP_DECIDER_GRACE_MS`, `_jitteredBackoff`, `_scanWindowFullAt`, `SUPERVISOR_STATES`, y los
  estados `CONNECTING/CONNECTED/DISCOVERING_SERVICES/NOTIFICATIONS_READY` para Bluetooth (quedan para `lan:`/`net:` hasta su fase).
- Campos del constructor `ble_interface.js` 97–199: `_pendingPings`, `_lastPongTime`, `_pingInterval`, `_pingIntervalMs`,
  `_pingTimeoutMs`, `_pingMaxFails`, `_pingFailCount`, `_pingInFlight`, `_autoScanMinMs`, `_lastAutoScanAt`, `_scanStartTimes`,
  `_scanWindowMs`, `_scanWindowMax`, `_bgScanWindowMax`, `_scanBlockedUntil`, `_scanFailBackoff`, `_scanDeferTimer`,
  `_supervisorStates`, `_backoffTimers`, `_reconnectAttempts`, `_reconnectScanTimer`, `_reconnectScanAttempts`, `_lostPeers`,
  `_noServiceStreak`, `_bleCooldownUntil`, `_noServiceLast`, `_noServiceDecayMs`, `_noServiceThreshold`, `_bleCooldownBaseMs`,
  `_bleCooldownMaxMs`, `_dupSeenSince`, `_dupClosedUntil`, `_dupDebounceMs`, `_dupCloseCooldownMs`, `_readyResolvers`,
  `_notificationFallbackTimers`, `_bleDeadUntil`, `_mtuByDevice`, `connectedDevices` (para Bluetooth). Las entradas `lan…`/`net…` de
  `_deviceStates` se mudan a un mapa aparte `_pathStates` con la misma forma (cambio mecánico, para que no se mezclen; su rediseño es de
  su fase).
- `perf.js` 45: deja de leer `_supervisorStates` (lee el `rttMs` del estado, §5.6).

**Kotlin**
- `PluginGatt.kt`: `startAutoReconnect`, `getReconnectDelay`, `reconnectTimers`/`reconnectAttempts`/`reconnectDelays` (377–429);
  `forceReconnectImpl` y `reconnectDeviceImpl` (509–556; ninguna llamada desde `src/`); el «cierra el viejo» de `connectToDevice`
  (106–108); el aviso `onServicesReady` (277); el plazo de 15 s propio (126–139: lo lleva la máquina).
- `connectToDeviceImpl` y `disconnectDeviceImpl` como API pública de la app (quedan solo para pruebas manuales del diagnóstico, o se
  borran: §8 no lo pregunta, lo decido yo: se borran).
- `PluginBackground.kt`: `outboxDialStep` en su parte de conectar y escanear (474–500); `OutboxDial.pick`, `tried`, `MAX_CLIENT_LINKS`
  (el calendario `gapMs`/`calmGapMs`/`wakeInMs` se queda, B17).
- `SinAppLinks.kt` entero (su cliente se funde en el cliente único de `LinkHost`, §5.1); `closeAll` al abrir la app desaparece.
- `PluginRx.kt` 156: el pong condicionado a «app detrás» (lo sustituye el `lp` nativo siempre).
- `nativePong` y `SinAppCore.pong` del ping JS viejo (los sustituye `lp`; sin compatibilidad con builds viejas: regla del 14-11).
- `negotiatedMtu`, `gattClients`, `clientConnectionStates`, `clientSetupDone`, `clientSetupWaitSince`, `clientRx/TxCharacteristics`,
  `keepAliveTimers`, `writeQueues*` como campos del plugin: pasan a `LinkHost`, por **enlace** (papel + dirección), no por dirección.

---

## 5. Lo que se AGREGA: la especificación

### 5.1 Un solo dueño: `LinkHost` (nativo) con una máquina de estados POR CONTACTO

**Por qué en el nativo y no en JS.** El enlace tiene que seguir vivo y decidirse igual con la app a la vista, oculta, congelada o
cerrada. El JS se congela en segundo plano (Vivo, Honor) y el nativo no (servicio en primer plano). Hoy hay tres dueños porque el JS no
puede estar siempre (M14). Con el nativo como único dueño, la app a la vista y la oculta son la MISMA máquina; la app solo **pide**
(qué contactos quiere enlazados y con qué prioridad) y **lee** (estado por contacto). Es lo que hacen Briar y Nearby (un gestor de
conexiones por contacto en el servicio) y lo que pidió el dueño el 19-11 («Bluetooth entero en el servicio nativo»).

**Estructura (Kotlin, `plugins/nexo-ble/.../ble/`):**
- `LinkFsm.kt` — **pura** (sin Android): estados, eventos y transiciones por contacto; devuelve acciones (`Connect`, `Cut`, `SendLp`,
  `Emit`, `WakeAt`). Probada en JVM con vectores compartidos con el simulador (§6).
- `LinkMemory.kt` — **pura**: memoria de fallos por contacto, espera con Full Jitter (azar inyectable) y «congelado».
- `LinkCap.kt` — **pura**: `linkPlan`/`linkTrim` portados tal cual de `ble_linkmgr.js` (mismos números y casos).
- `ScanPlan.kt` — **pura**: quién pide escanear, cuánto y el cupo 5/30 s.
- `LinkHost.kt` — objeto **por proceso** (como `GattServerHost`): tiene los `BluetoothGatt` de cliente, recibe los avisos del servidor
  (vía `GattServerHost`), las colas de escritura por enlace, el reloj (`Handler` principal) y aplica las acciones de la máquina.
  Atienden la app, la app cerrada y el servicio sin la app (`BleSinApp`) **enganchándose** (`attach`/`detach`), sin cerrar enlaces.
- La memoria (`LinkMemory`) se guarda pequeña en `SharedPreferences` (JSON, caduca a 1 h): un reinicio del proceso no olvida que la
  tablet está congelada.

**Claves (una sola forma en todo el código, Kotlin y JS):**
- contacto `nx`: `"nx"` + 8 caracteres `[0-9a-z]`, en minúsculas (`_normId`);
- dirección `mac`: 12 hexadecimales en minúsculas sin separadores (`_normMac` / `normalizeMac`);
- enlace `link`: `"c:" + mac` (cliente: lo abrí yo) o `"s:" + mac` (servidor: lo abrió el otro);
- anónimo sin identificar: `"a:" + mac` como contacto provisional.
Todo aviso del nativo a la app trae `nx` (o `a:`), `link`, `mac`, `role`. La app **nunca** guarda nada de Bluetooth por dirección cruda.

**Estados del contacto** (uno y solo uno a la vez; además, atributos):

| Estado | Significa | Atributos |
|---|---|---|
| `SIN_ENLACE` | no hay enlace en marcha | `seenAt` (último anuncio), `near` = visto < 120 s o caído < 60 s |
| `CONECTANDO` | hay UN intento de cliente en el aire | `link`, `since`, `phy` (1M/Coded) |
| `PREPARANDO` | conectado; falta servicios / MTU / suscripción en el sentido que toca | `link`, `mtu?`, `subscribed?` |
| `VERIFICANDO` | puesta en marcha hecha; falta la prueba de ida y vuelta (`lp`) | `link`, `lpSentAt` |
| `LISTO` | enlace verificado | `link`, `mtu`, `rttMs`, `heardAt`, `awake`, `quality`, `congested` |
| `EN_PAUSA` | fallo reciente; el reconector espera | `until`, `why` (fallo, sin_servicio, cerrado_por_nosotros, tope) |
| `CONGELADO` | la radio del otro acepta pero su proceso no contesta, repetido | `until`, `count`, `why` |

Estado global aparte: `BT_APAGADO` (con el Bluetooth apagado ningún contacto sale de `SIN_ENLACE`).

**«Listo» de verdad** = existe un enlace `link` del contacto que cumple TODO:
1. ACL conectado según Android.
2. Si `c:`: servicios descubiertos con el servicio NEXO, MTU intercambiado (aviso `onMtuChanged`; si no contesta en 2 s se acepta y se
   apunta `mtu = 23` explícito) y **nuestra** suscripción confirmada (`onDescriptorWrite` con éxito).
   Si `s:`: el otro escribió el CCCD (suscrito) y su MTU está apuntado (`onMtuChanged`; si no llegó, 23 explícito).
3. **Verificado**: un `lp` (§5.2) fue y volvió **por ese mismo enlace** con identidad del contacto (y firma, si §8 P1 = A).
   Para `s:` basta un `lp` válido recibido del contacto + nuestra respuesta confirmada por `onNotificationSent` con éxito.
Hasta cumplir 3, **nada de arriba escribe por él** (la cola espera, como B6). Esto cierra M3, la copia Coded del 26-11 y el enlace a
medias: nunca llegan a `LISTO`.

**Un enlace por contacto.** Cuando un contacto llega a `LISTO` por `L`, cualquier otro enlace suyo que no esté `LISTO` se corta (los dos
papeles de esa dirección, §5.3). Si por carrera hay dos `LISTO` (los dos teléfonos se llamaron a la vez), se queda el enlace cuyo
**cliente es el teléfono de NEXO ID menor** y el otro se corta; los dos teléfonos calculan lo mismo con lo mismo. (Esta regla, la 3027,
se abandonó en la 3327 porque el enlace elegido podía ser uno viejo tras volver la app; con «listo = verificado» un enlace viejo nunca
es `LISTO`, así que la objeción ya no aplica.) Para no crear la carrera: el de NEXO ID **mayor** no llama si ve al menor y no tiene
prisa; con prisa (pendientes, chat abierto, «Agregar») espera `T_YIELD` = 3 s + azar(0–1 s) a que entre la llamada del menor y, si no
entra, llama él.

**Eventos de entrada** (la máquina solo cambia con estos):

| Evento | De dónde |
|---|---|
| `VISTO(nx, mac, rssi, coded)` | escaneo, ya resuelto el código rotativo (`OutboxRid`/libro de códigos) |
| `QUIERO(lista de {nx, prio, why, manual})` | la app (`setLinkWants`, declarativo, la lista entera) y la bandeja nativa (`outBle().wanting()`); el puente pide conexiones de paso igual (`prio = PASO`) |
| `SUELTA(nx, why)` | la app (cámara, «de paso» ya sin uso, borrar contacto) |
| `CONECTADO(link)` / `CAIDA(link, status)` | `BluetoothGattCallback` y `BluetoothGattServerCallback` |
| `SERVICIOS(link, ok)` · `SIN_SERVICIO(link)` | `onServicesDiscovered` |
| `MTU(link, mtu)` · `SUSCRITO(link)` | cliente: `onMtuChanged` / `onDescriptorWrite`; servidor: `onMtuChanged` / CCCD escrito |
| `IDENTIFICADO(link, nx)` | `lp` o `kx` recibido por ese enlace (nativo: `kxFromContact`, `nativeKx`) |
| `LP_OK(link, rtt, aw)` · `LP_FALLA(link)` | §5.2 |
| `OIDO(link)` | cualquier mensaje completo recibido por ese enlace (lo marca `PluginRx` al extraer un JSON) |
| `ATASCADO(link)` | `WriteRetry.shouldCloseStuckLink` (hoy `closeStuckLink`) |
| `A_MEDIAS(link)` | `HalfOpenPolicy.onWrite` = true |
| `BT_OFF` · `BT_ON` | `ACTION_STATE_CHANGED` |
| `RELOJ(now)` | el `Handler` (las esperas son «hasta tal hora», nunca temporizadores sueltos por mapa) |

**Transiciones permitidas** (cualquier otra combinación se ignora y se apunta en el registro como «evento fuera de lugar»):

| Desde | Evento / condición | Hacia | Acciones |
|---|---|---|---|
| `SIN_ENLACE` | `QUIERO` con `prio ≥ CERCA` y `near` y sin espera pendiente y `LinkCap` permite | `CONECTANDO` | `Connect(mac más reciente, phy)` |
| `SIN_ENLACE` | `CONECTADO(s:…)` del contacto (entrante) | `PREPARANDO` | — |
| `SIN_ENLACE` | `VISTO` y hay `QUIERO` | (misma regla que la primera fila) | |
| `CONECTANDO` | `CONECTADO(link)` | `PREPARANDO` | cliente: prioridad alta, 2M (no en Coded), `discoverServices` |
| `CONECTANDO` | `CAIDA` / plazo `T_CONNECT` (12 s) | `EN_PAUSA` | `memory.fail(nx, 'conexión')`; `Cut` (por si quedó algo) |
| `CONECTANDO` | `CONECTADO(s:…)` del mismo contacto | `PREPARANDO` (por el entrante) | `Cut(c:…)` en curso si soy el NEXO ID mayor; si soy el menor sigo con el mío y el entrante espera su verificación |
| `PREPARANDO` | `SIN_SERVICIO` | `EN_PAUSA` | `memory.noService(nx)` (B16); `Cut` |
| `PREPARANDO` | MTU + suscripción completos (fila «listo» 1–2) | `VERIFICANDO` | `SendLp(link)` (cliente) / esperar `lp` (servidor) |
| `PREPARANDO` | plazo `T_SETUP` (6 s) / `A_MEDIAS` | `EN_PAUSA` | `memory.fail(nx, 'a medias')`; `Cut` ambos papeles |
| `VERIFICANDO` | `LP_OK` / `IDENTIFICADO` + respuesta confirmada | `LISTO` | `Emit(ready)`; cortar otros enlaces del contacto |
| `VERIFICANDO` | `LP_FALLA` (plazo `T_VERIFY` 6 s) | `EN_PAUSA` | `memory.halfDead(nx)`; `Cut` ambos papeles |
| `LISTO` | `OIDO` / `LP_OK` | `LISTO` | `heardAt = now`; `rtt`, `awake` |
| `LISTO` | sin oír nada `T_QUIET` (15 s) | `LISTO` | `SendLp(link)` (prioridad alta, delante de los trozos de archivo) |
| `LISTO` | 2 `LP_FALLA` seguidos sin ningún `OIDO` entre medias / `ATASCADO` | `EN_PAUSA` | `memory.halfDead(nx)`; `Cut` ambos papeles; `Emit(lost, why)` |
| `LISTO` | `CAIDA(link)` | `SIN_ENLACE` (`near = true` 60 s) | si vivió < 60 s: `memory.shortLife(nx)`; `Emit(lost)` |
| `EN_PAUSA` | `RELOJ ≥ until` | `SIN_ENLACE` | (el reconector vuelve a mirar `QUIERO`) |
| `EN_PAUSA` | `memory.frozen(nx)` | `CONGELADO` | `Emit(frozen)` |
| `EN_PAUSA`/`CONGELADO` | `QUIERO` con `manual` (Agregar, abrir chat a mano) | `CONECTANDO` | un intento que se salta la espera UNA vez (no borra la memoria salvo que llegue a `LISTO` estable) |
| `CONGELADO` | `RELOJ ≥ until` / **evidencia de vida** | `SIN_ENLACE` | |
| `CONGELADO` | `CONECTADO(s:…)` del contacto | `PREPARANDO` | el otro nos llama: se le da su verificación (si verifica, sale del congelado) |
| cualquiera | `BT_OFF` | `SIN_ENLACE` | todo cortado; reconector parado; `Emit` de todos |
| cualquiera | `SUELTA` | `EN_PAUSA(why = cerrado_por_nosotros, T_HOLD 20 s)` | `Cut` ambos papeles (no es un fallo: no toca la memoria) |

**Evidencia de vida** (saca de `CONGELADO` antes de tiempo): algo recibido de ese contacto por cualquier enlace Bluetooth; la app avisa
de que lo oyó por internet o Wi-Fi local (`setLinkWants` lleva `alive: true` para ese contacto); el otro nos llama y verifica.
Que siga anunciando **no** es evidencia (el controlador anuncia aunque el proceso esté congelado).

### 5.2 «La radio vive» vs «la app del otro contesta»

Tres niveles, cada uno con su medida:

| Nivel | Qué prueba | Cómo se mide |
|---|---|---|
| Radio | el enlace físico existe | estado ACL de Android + `readRemoteRssi` del keepalive (`PluginGatt.kt` 348–371, se queda cada 10 s y da el RSSI) |
| Proceso del otro | su NEXO nativo recibe, procesa y contesta por este enlace | **`lp`** (ping de enlace), contestado SIEMPRE por el nativo |
| App del otro | su JS está despierto | bandera `aw` dentro de la respuesta del `lp` |

**Paquete `lp`** (JSON corto, < 120 bytes, cabe en un trozo con MTU 23 partido en 5–6):
`{"v":1,"type":"lp","id":"<8 hex>","fr":"nx…","t":"<firma opcional>"}` → respuesta
`{"v":1,"type":"lpa","id":"…","fr":"nx…","aw":0|1,"t":"…"}`. Lo contesta el nativo en `PluginRx` (app viva o no) y en `SinAppCore`
(sin la app), solo si `fr` es un contacto (regla 12A). `aw = 1` si la app está a la vista **y** su JS llamó al nativo en los últimos
15 s (cada `setLinkWants` o un latido barato de 5 s mientras está visible): así una página colgada con la app delante cuenta como
dormida. Se manda por delante de los trozos de archivo (`WritePacing` prioridad alta).
**Reloj:** las esperas se miden con `SystemClock.elapsedRealtime()`. Si un plazo se cumple con > 10 s de retraso, **nosotros** estuvimos
congelados: ese `lp` no cuenta como fallo y se manda otro (idea de la 3340, B21).

**Qué se hace en cada combinación:**

| Radio | `lp` | `aw` | Estado | Acción de esta capa | Lo que el enrutado recibe |
|---|---|---|---|---|---|
| viva | contesta | 1 | `LISTO` | nada | `ready, awake` |
| viva | contesta | 0 | `LISTO` | **nada: NO se reconecta.** Lo que llega lo guarda y confirma el nativo del otro (✓✓ nativo) | `ready, awake:false` (el enrutado decide si toca por FCM: llamadas, etc.) |
| viva | no contesta (2 seguidos) o atascado | — | `EN_PAUSA` → reintento → si repite, `CONGELADO` | cortar ambos papeles; UN reintento con su espera; al 3.er medio muerto en 10 min, congelado (§5.3) | `lost (medio muerto)` y luego `frozen` |
| cae | — | — | `SIN_ENLACE` | reconector (si cerca y alguien lo quiere) | `lost (caída)` |
| no se ve | — | — | `SIN_ENLACE`, `near = false` | no se intenta | `near:false` |

Con esto el «zombi» deja de ser «la app del otro duerme» (eso es `LISTO, awake:false`, y no se corta) y pasa a ser solo «el proceso del
otro no contesta por este enlace» (congelado o asas viejas), que se corta una vez y se recuerda.
**[hipótesis a medir]** si tras «medio muerto → reconectar» el enlace nuevo vuelve a fallar la verificación con el otro despierto (lo
dirá la cuenta `halfDeadAfterReconnect` del diagnóstico), probar `BluetoothGatt.refresh()` (caché de servicios de Android) antes de
`discoverServices` en ese reintento. No entra en la especificación hasta tener ese dato.

### 5.3 Un solo reconector, una sola entrada, memoria y cortes de los dos papeles

**Entrada única (declarativa).** La app no conecta ni corta: manda `setLinkWants({ wants: [{nx, prio, why, manual?, alive?}] })` con la
lista **entera** cada vez que cambia (con 300 ms de agrupado). Prioridades (las de `ble_linkmgr._prio`, B14): `OCUPADO` 4 (transferencia,
llamada) > `PENDIENTE` 3 (mensajes esperando; «Agregar»/abrir a mano = `manual`) > `CHAT` 2 (chat abierto) > `CERCA` 1 (contacto
reciente cerca) > `PASO` 0 (Jump, «quién es»). La bandeja nativa suma los suyos (`PENDIENTE`). Si el JS deja de llamar (congelado), sus
deseos duran `T_WANT_TTL` = 10 min y luego quedan solo los de la bandeja. Un `QUIERO` repetido no hace nada nuevo.
API de la app que queda: `setLinkWants`, `dropLink({nx, why})`, `getLinkSnapshot()`, `sendToContact({nx, payload, prio})`,
`sendBinaryToContact(...)`, evento `onContactLink`.

**El reconector** (dentro de `LinkHost`, uno solo para app, app cerrada y servicio): en cada `RELOJ` (cada 1 s mientras haya algo que
hacer; parado si no) recorre los contactos en `SIN_ENLACE` con `QUIERO`, ordenados por prioridad y luego por antigüedad del deseo, y
lanza como mucho **un `Connect` en el aire a la vez** (Android abre de uno en uno; B: «paso libre» de la 3284 queda implícito: el de más
prioridad va primero). Condiciones: `near`, sin espera pendiente (`memory.nextAt(nx) ≤ now` o `manual`), `LinkCap.plan(...)` permite (si
pide desalojar, primero `Cut` al desalojado), y no soy el NEXO ID mayor dentro de `T_YIELD` (§5.1). Un intento sin prisa (`CERCA`/`PASO`)
que lleva > 1,5 s en el aire cede ante un `PENDIENTE` nuevo (se corta y vuelve a la cola sin contar fallo).

**Memoria y espera (`LinkMemory`)**, por contacto:
- `n` = fallos seguidos (conexión que falla, sin servicio, a medias, medio muerto, vida corta < 60 s). Se pone a 0 **solo** tras
  `LISTO` estable `T_STABLE` = 2 min (no al conectar: M7).
- Espera **Full Jitter**: `delay = azar(0, min(CAP, BASE · 2^n))`, `BASE` = 1 s, `CAP` = 60 s si `prio ≥ PENDIENTE`, 5 min si no.
- Sin servicio: la regla B16 tal cual (4 seguidos → 30 s doblando hasta 10 min; la racha caduca 10 min después del fin de la pausa).
- **Congelado:** 3 «medio muerto» o 3 «vida corta» en 10 min → `CONGELADO` 10 min; si al salir vuelve a pasar dentro de 30 min, 20,
  40 y como mucho 60 min (cada vez con azar ±20 %). Sale antes con evidencia de vida (§5.1) o con un intento `manual` que verifique.
- Al encender el Bluetooth (`BT_ON`) toda la memoria vuelve a 0 (el problema podía ser nuestra radio).

**Cortar = los dos papeles, siempre.** `Cut(mac)`: cerrar el `BluetoothGatt` de cliente de esa dirección (`disconnect` + `close`) **y**
cortar el entrante de esa dirección con B2 (`hold` + `cancelConnection`), vaciar su cola y su reensamblado, y apuntar «cerrado por
nosotros» 5 s (lo que llegue para esa dirección en ese rato no se escribe, como 3267). Cortar un contacto = `Cut` de todas sus
direcciones. Nadie más llama a `disconnect`/`cancelConnection`.

**Conexiones de paso.** El puente pide `QUIERO({nx | 'a:'+mac, prio: PASO})` y suelta con `dropLink`. Sus reglas propias (tope
`MAX_TRANSIENT`, rotación con «Agregar», `passOk` por señal, `anonIdentified`) se quedan en `ble_relay.js` como **política** que decide
qué pedir; el enlace lo abre y lo cierra `LinkHost`. Un `a:` que se identifica como contacto ya `LISTO` por otra dirección se corta solo
(regla «un enlace por contacto»), sin código aparte.

**Tope.** `LinkCap` (= `linkPlan`/`linkTrim`) cuenta **todos** los enlaces del proceso: cliente y servidor, app y bandeja (M13). Los
entrantes de un contacto con prioridad baja que pasan del tope se cortan con `linkTrim` como cualquier otro. Repaso cada 6 s solo si hay
≥ `cap − 1` enlaces.

### 5.4 Escaneo: cuándo, cuánto, coordinado

Un solo escáner (`ScanPlan` puro + `LinkHost`), que cuenta **todos** los arranques del proceso en la ventana de 30 s (máximo 4; el 5.º
hueco, reservado a lo que pide el usuario). Un escaneo en marcha sirve a todos los que lo pidieron (no se reinicia; se alarga hasta el
mayor de los plazos pedidos). Siempre filtrado por fabricante NEXO salvo «Agregar» con la app a la vista (como hoy).

| Quién pide | Cuándo | Cuánto | Ritmo |
|---|---|---|---|
| Usuario: «Agregar» / «Buscar a…» | al abrir | lo que pida (15 s; «Buscar a…» hasta 10 min, `durationMs`) | inmediato, salta la espera (no el cupo de Android) |
| Vuelta a la app (presencia) | al volver a primer plano | 6 s | una vez; luego lo que pidan los deseos |
| Contacto **deseado** sin enlace y no visto en 120 s, app a la vista | mientras dure el deseo | 5 s | espera con Full Jitter: 10 s, 20 s, 40 s, tope 60 s |
| Lo mismo con la app oculta/cerrada | mientras la bandeja tenga algo | 4 s (`OutboxDial.SCAN_MS`) | `OutboxDial.gapMs` / `calmGapMs` + despertador (B17) |
| Puente Jump (buscar camino) | al pedir ruta | 4 s | como mucho 1 cada 30 s (`SCAN_FRESH_MS` de hoy) |
| Recuperar un fallo de Android (`onScanFailed`) | código 6/2: a los 31 s; 3/5: 1,5 s doblando hasta 12 s; 4: nunca más | — | B11 |

Con una transferencia Bluetooth en curso (la cola de algún enlace con trozos de archivo que avanzan) el ritmo baja a **un escaneo cada
60 s como mucho** en lugar de pararlo hasta 3 min (M11): lo pendiente de los demás no espera tanto y la radio no se satura. Sin nadie
que pida, no se escanea. Con `BT_APAGADO`, nada. La regla Coded (B13) se aplica en el nativo al recibir resultados, con `ScanBook`
(que ya guarda cuándo se vio cada dirección por 1M y por Coded); además, si llega un `VISTO` 1M de un contacto cuyo enlace actual es por
Coded y no está `LISTO`, ese enlace se corta y se llama por la normal.

### 5.5 Con la app oculta: la misma máquina

- `LinkHost` sigue igual con la app delante, detrás, congelada o cerrada; lo único que cambia es **quién consume** lo recibido (JS o
  `BgInbox`/`SinAppCore`: no es de esta capa) y la bandera `aw`.
- Los deseos de la app duran `T_WANT_TTL`; la bandeja nativa añade los suyos (hoy `outBle().wanting()`).
- Al abrir la app: **ni se cierran enlaces** (adiós `SinAppLinks.closeAll`) **ni se «recuperan»**: la app pide `getLinkSnapshot()` y
  pinta el estado; los enlaces `LISTO` siguen `LISTO` (adiós M8). Al quedar un enlace `LISTO` por primera vez en su vida («época» del
  enlace), la app manda su `kx`/`sessionSync` una sola vez; volver a la app no lo repite.
- El escáner usa el calendario oculto (§5.4) y el despertador (`OutboxWake`).
- El servicio sin la app (`BleSinApp`) se engancha a `LinkHost` igual que hoy se engancha a `GattServerHost`.

### 5.6 Lo que se expone al futuro enrutador (sin decidir caminos)

Evento `onContactLink` (al cambiar estado o cada vez que cambie un atributo de forma relevante, como mucho 1 por segundo y contacto) y
`getLinkSnapshot()` con, por contacto:

| Campo | Qué es |
|---|---|
| `nx`, `state` | contacto y estado de §5.1 |
| `ready` | `state == LISTO && !congested` (lo único que mira quien quiere mandar) |
| `link`, `role`, `mac`, `coded` | el enlace en uso |
| `mtu` | el real del enlace (no por dirección) |
| `rssi`, `rssiAt` | del keepalive (cada 10 s) o del último anuncio |
| `rttMs` | mediana de los 5 últimos `lp` |
| `heardAt` | último mensaje completo oído por Bluetooth de ese contacto |
| `awake`, `awakeAt` | la bandera `aw` y cuándo se supo |
| `quality` | `bueno` / `lento` (MTU ≤ 23 o `rtt` > 1,5 s o reintentos 201 en el último minuto) / `malo` (atascos recientes) |
| `congested` | la cola soltó un mensaje en los últimos 20 s **por este enlace** (sustituye a `_markBleDead`, sin tocar otras direcciones: M16) |
| `near`, `seenAt` | visto hace < 120 s / último anuncio |
| `readySince` | desde cuándo está listo |
| `pausedUntil`, `frozenUntil`, `why` | espera y motivo |
| `stats` | por contacto, últimos 10 min: intentos, conexiones, caídas, medio muertos, cortes nuestros, tiempo hasta listo (mediana) |

En JS, una vista pequeña (`ble_link_view.js`) guarda el último estado por `nx` y da las funciones que hoy usan 29 sitios con la misma
firma: `_bleReadyFor(nx)` (devuelve la clave del enlace o `null`), `getMtu(nx)`, `linkOf`, `btNear(nx)`, `btAwake(nx)`. Así
`calls.js`, `wifi_direct.js`, `lan.js`, `big_file.js`, `diag_state.js`, etc. no cambian en este plan.

### 5.7 Medidas y diagnóstico

El nativo cuenta, por contacto y en total, y lo pone en el diagnóstico (y en el resumen diario):
- **reconexiones por minuto** (conexiones nuevas a un contacto que ya estuvo `LISTO` en los últimos 10 min);
- **tiempo hasta listo** (desde `VISTO`+`QUIERO` o desde `CONECTADO` hasta `LISTO`; mediana y máximo);
- **cortes innecesarios** (corte nuestro de un enlace `LISTO`, no atascado, no por tope, no pedido por la app: **debe ser 0**);
- **segundos con enlace repetido** (dos enlaces del mismo contacto a la vez);
- **medio muertos**, **congelados** (con duración) y `halfDeadAfterReconnect` (§5.2);
- **escaneos por 30 s** (máximo visto; debe ser ≤ 4) y por hora.
El síntoma automático «enlace_abre_cierra» sale de aquí (≥ 3 reconexiones en 10 min con el mismo contacto **que no terminaron en
congelado**: si terminaron en congelado, la máquina hizo lo que debía y no se avisa al desarrollador). El de «zombi» se sustituye por
«congelado» (informativo, y solo si el contacto tiene la última build).

### 5.8 Constantes (todas en un solo sitio: `LinkConf.kt`, espejo `tests/sim/linkconf.json`)

| Nombre | Valor | Por qué |
|---|---|---|
| `T_CONNECT` | 12 s | hoy 15 s (`PluginGatt.kt` 139); un intento con un teléfono que ya se fue ocupa la cola de Android |
| `T_SETUP` | 6 s | = `HalfOpenPolicy.GRACE_MS`; MTU 2 s + descriptor |
| `T_VERIFY` / `LP_TIMEOUT` | 6 s | sin cola delante (`lp` va primero) basta; hoy 8 s porque esperaba detrás de la cola JS |
| `T_QUIET` | 15 s | hoy 16 s (`ble_connections.js` 94) |
| `LP_FAILS` | 2 | detección del medio muerto en ~27 s (15 + 6 + 6) frente a 40–55 s hoy |
| `T_STABLE` | 2 min | para olvidar fallos |
| `BASE` / `CAP` | 1 s / 60 s (prisa) · 5 min (sin prisa) | Full Jitter |
| congelado | 3 en 10 min → 10, 20, 40, 60 min | §8 P2 |
| `T_YIELD` | 3 s + azar(0–1 s) | evitar la llamada doble |
| `T_WANT_TTL` | 10 min | deseos de una app congelada |
| `NEAR` | 120 s visto / 60 s caído | B15 |
| tope | 6 enlaces / 4 por cercanía | B14 (dueño 22-11) |
| escaneo | ≤ 4 arranques / 30 s, 1 reservado al usuario | B11 |

---

## 6. Matriz de pruebas (`tests/sim`)

**Cómo se prueba sin compilar Kotlin aquí:** las cuatro clases puras (`LinkFsm`, `LinkMemory`, `LinkCap`, `ScanPlan`) se prueban en JVM
(`tests/kotlin`, corre en el CI; aquí si `gradle` funciona sin red). Su comportamiento se fija con **vectores compartidos**
(`tests/vectors/link/*.json`: lista de eventos con su hora y el estado y las acciones esperadas) que corren **los dos**: el test JVM y
`tests/sim/linkvectors.js` contra el gemelo JS de `native_mock.js` (`tests/sim/linkhost_twin.js`). Si el gemelo y el Kotlin difieren,
falla una de las dos pruebas: no pueden divergir sin que se note (mismo método que `NetBgTest`, que ya compara Kotlin con la app).
Los escenarios de dos o más teléfonos corren en el simulador (`native_mock.js` con el gemelo) con la app real.

Medidas comunes de cada escenario: **rpm** = reconexiones por minuto por contacto; **tL** = tiempo hasta listo; **cortes** = cortes
innecesarios; **rep** = segundos con enlace repetido; **esc** = arranques de escaneo por 30 s (máximo); **pérdidas** = mensajes perdidos.

| # | Escenario | Resultado esperado | Medidas (umbral) |
|---|---|---|---|
| S1 | Dos teléfonos sanos, se ven, A tiene un texto para B | un enlace, `LISTO` y el texto ✓✓ por Bluetooth | tL < 3 s; rep = 0; cortes = 0 |
| S2 | **B con la app dormida** (JS congelado, nativo vivo) 30 min | `LISTO`, `awake:false`; nada se corta; lo de A llega al nativo de B (✓✓ nativo) | rpm = 0; cortes = 0; `lp` cada 15 s solo si no se oye nada |
| S3 | **B con el proceso congelado** (radio acepta, nadie contesta; el sistema tumba a los 30 s) | medio muerto en ≤ 30 s; 1 reintento; al 3.º en 10 min `CONGELADO`; sin conexiones durante el congelado | rpm ≤ 0,3 en los primeros 10 min y 0 después; tiempo hasta congelado ≤ 6 min |
| S4 | S3 y luego B se descongela y escribe (evidencia de vida) | sale de `CONGELADO` y `LISTO` | tL desde la evidencia < 5 s |
| S5 | **MTU 23** (B no acepta MTU) | `LISTO` con `mtu 23`, `quality: lento`; trozos de 20 bytes; sin cortes ni reconexiones para «mejorar» | rpm = 0; cortes = 0 |
| S6 | **Caída real y vuelta**: B se aleja 60 s y vuelve | `SIN_ENLACE` (`near` 60 s, luego false); al volver a verse, reconecta | tL desde que se ve < 4 s; intentos durante la ausencia ≤ 3 (solo mientras `near`) |
| S7 | **Dos enlaces al mismo contacto**: A y B se llaman a la vez | queda uno (el del cliente de NEXO ID menor) en los dos teléfonos | rep < 3 s; cortes = 0 (el cierre del segundo no cuenta: no llegó a `LISTO`, o es el desempate de dos `LISTO`) |
| S8 | **Enlace a medias**: el servidor de B se rehace con el enlace de A abierto (sin suscripción) | B corta en ≤ 6 s (B3); A reconecta y verifica | tL < 10 s desde el corte; pérdidas = 0 |
| S9 | **Vuelta a la app** (A 20 min detrás con enlaces `LISTO`) | ningún corte ni reconexión; la app lee el estado y no repite `kx` | cortes = 0; rpm = 0; tiempo hasta que la app ve `ready` < 300 ms |
| S10 | **Multitud con tope**: A entre 10 contactos dormidos cerca + 200 NEXO anónimos; llega C con un pendiente | 6 enlaces como mucho; C consigue enlace desalojando a uno «por cercanía» | tL de C < 10 s desde que se le ve; esc ≤ 4; enlaces ≤ 6 |
| S11 | **Servidor zombi**: A es servidor de B y B congela su proceso | A detecta por `lp` (no depende de que B sea cliente), corta los dos papeles, memoria como S3 | igual que S3 |
| S12 | **Caso de la tablet** (diag. 27-11 21:41): enlace recuperado medio muerto que se rehace y cae cada ~30 s | tras ≤ 3 ciclos, `CONGELADO`; en 10 min ≤ 3 conexiones (hoy > 14) | rpm ≤ 0,3; pérdidas = 0 |
| S13 | **Caso del Vivo** (diag. 19-11 04:38 y 27-11 05:17): proceso congelado 4 h, MTU 23, texto pendiente sin otro camino | `CONGELADO` con pausas crecientes (≤ 7 intentos en 4 h); al descongelarse, el texto sale en < 10 s | intentos en 4 h ≤ 7; tL tras descongelar < 10 s |
| S14 | **Copia LE Coded primero** (diag. 26-11 08:30): A conecta a la copia Coded de B y luego ve la normal | el de Coded nunca llega a `LISTO` (no verifica) o se corta al ver la normal; un solo enlace por la normal | rep < 3 s; zombi = 0 |
| S15 | Anónimo de paso que resulta ser un contacto ya `LISTO` por otra dirección (diag. 23-11 08:27) | se corta al identificarse; no se vuelve a sondear esa dirección 15 min | rep < 2 s; sondeos repetidos = 0 |
| S16 | Bluetooth apagado y encendido (diag. 19-11 07:14) | todo `SIN_ENLACE` al momento; memoria a 0; al encender, reconecta lo deseado | tL tras encender < 5 s; envíos por un enlace viejo = 0 |
| S17 | B con la app cerrada y sin servidor GATT (sin servicio) | pausa B16 (4 → 30 s doblando) | intentos en 10 min ≤ 8 |
| S18 | Los dos con la app oculta y A con un pendiente para B (bandeja) | el nativo de A busca con el calendario oculto, conecta y entrega | esc según `OutboxDial.gapMs`; tL < 8 s desde que se ve |
| S19 | Abrir la app con enlaces del servicio sin la app (`BleSinApp`) abiertos | no se cierra ninguno | cortes = 0 |
| S20 | Archivo de 2 MB por Bluetooth y a mitad B congela su proceso | medio muerto en ≤ 30 s aunque haya transferencia (no hay regla de «transferencia activa»: lo que cuenta es oír); el de arriba reanuda al volver | detección ≤ 30 s; cortes = 0 antes de congelarse |
| S21 | «Agregar» con el contacto en `CONGELADO` o en espera | un intento inmediato | tiempo hasta el intento < 0,5 s |
| S22 | Rotación de dirección de B con el enlace abierto | el enlace sigue (la rotación no afecta a un enlace ya hecho); el siguiente se hace con la dirección nueva | cortes = 0 |
| S23 | Reloj que salta: A congelado 1 h con un `lp` en vuelo | ese `lp` no cuenta; se manda otro | cortes = 0 (caso 3340) |
| S24 | Vagón: 40 teléfonos se cortan a la vez y vuelven | los reintentos se reparten (Full Jitter) | conexiones en el peor segundo ≤ 3; tL p90 < 20 s |

**Pruebas de hoy que cambian** (se reescriben sobre la máquina en el paso que las afecta, no se borran sin sustituto):
`zombivuelta`, `zombifalso`, `zombiexfer`, `pingcongelado`, `reconndedup`, `thrash`, `xferstuck` (pasan a S2/S3/S11/S20/S23);
`bledup`, `dupserver`, `dedupreenlaza`, `dupscan`, `anondup` (S7/S14/S15); `enlacestope`, `multitud` (S10 y vectores de `LinkCap`);
`noservice`, `btoff`, `btoffsilencio` (S16/S17); `codedscan` (S14); `scancupo`, `scanhold`, `scanfenix`, `resumescan`, `escaneotanda`
(vectores de `ScanPlan`); `openstale`, `vivoarriba` (S9 y vista JS). JVM: `HalfOpenPolicyTest`, `ServerFlapPolicyTest`,
`OutboxDialTest`, `WriteRetryTest`, `WritePacingTest`, `ScanBookTest` se quedan; nuevas `LinkFsmTest`, `LinkMemoryTest`, `LinkCapTest`,
`ScanPlanTest` (con los vectores).

---

## 7. Plan de migración por pasos

Cada paso termina con **una APK que funciona**, su batería verde, 3–5 pruebas cortas para el dueño y **sin lo viejo que sustituye**. Un
paso = una subida (~85 min de CI); se sube cuando está todo el paso, no a medias (reglas de GASTO de `CLAUDE.md`).

**Paso 0 — Arreglos sueltos y línea de base (solo JS; puede ir con la siguiente APK que se suba).**
- Claves: escribir `_lastPongTime` con `_normMac` en los 4 sitios (`ble_receive.js` 47, 303, 380; `ble_native_events.js` 326) y leer
  igual en `ble_connections.js` 84, 92, 121; prueba nueva `pongclave.js` (el «más callado» del tope y el «oído» del desempate ya ven la
  hora real; contraprueba con la clave cruda).
- Contar en el diagnóstico (sin cambiar conducta) las medidas de §5.7 que ya se pueden contar en JS: reconexiones por minuto por
  contacto, cortes nuestros de enlaces listos, segundos con repetido, escaneos por 30 s. Sirve de **línea de base** para comparar.

**Paso 1 — `LinkHost` y el estado por contacto («quién sabe»).**
Kotlin: `LinkHost` con los enlaces por `link` (papel + dirección), MTU por enlace, identidad por `kx`/código rotativo, `onContactLink`
y `getLinkSnapshot` (sin `lp` todavía: «listo» = puesta en marcha completa en el sentido que toca; deja de haber `READY` a la entrada
del servidor y a los 3 s de `onServicesReady`). Aviso nuevo de suscripción del servidor y del MTU de los dos papeles.
JS: `ble_link_view.js`; `_bleReadyFor`, `getMtu`, `linkOf`, el gestor y el desempate leen de la vista. **Se quitan**: los registros
JS de Bluetooth (`_deviceStates` BT → vista; `lan`/`net` a `_pathStates`), `connectedDevices` BT, `_mtuByDevice`, `_bleDeadUntil`
(→ `congested` por enlace), `_notificationFallbackTimers`, `_cleanupStaleStates` BT, `_seedNativeConnections` (→ snapshot). El ping JS
sigue (es el paso 2), pero ya con claves únicas.
Pruebas: S1, S9, S5, S22; vectores de estado; para el dueño: abrir/cerrar la app con un contacto cerca, mandar texto y foto, MTU.

**Paso 2 — Prueba de vida nativa y «listo» verificado.**
Kotlin: `lp`/`lpa` con `aw`, `LISTO` solo verificado, `T_QUIET`/`LP_FAILS`, medio muerto, reloj que salta.
JS: **se quitan** el vigilante de pings entero (`_pingDevice`, `_pendingPings`, `_pingFailCount`, `_pingInFlight`, `_supervisorStates`
de Bluetooth, `_unverified`, el pong JS en `ble_receive.js` 368–388), `_forceDisconnectAndReconnect` (el medio muerto lo corta el
nativo por los dos papeles y avisa). Kotlin: fuera `nativePong`/`SinAppCore.pong` viejos y la condición de `PluginRx.kt` 156.
Pruebas: S2, S3 (sin memoria aún: se reintenta con la espera del nativo de hoy, que el paso 3 quita), S8, S11, S14, S20, S23.
Riesgo: dejar sin prueba de vida a una build vieja: aceptado (regla del 14-11: se arregla la última versión).

**Paso 3 — Entrada única, un reconector, memoria y tope en el nativo.**
Kotlin: `setLinkWants`/`dropLink`, reconector con Full Jitter y `LinkMemory` (congelado), `LinkCap` (port de `linkPlan`/`linkTrim`),
«un enlace por contacto» con `T_YIELD`, `Cut` de los dos papeles, bandeja nativa como un deseo más.
**Se quitan**: los 9 sitios que conectan y los 8 que cortan (§4), `ble_linkmgr.js`, `_attemptAutoReconnect`, `_dedupBleLinks`,
`_rebindOutgoing`, `_peerCutUntil`, `_noService*`/`_bleCooldownUntil`, `_linkLostAt`, `_btNearby`/`_btPaused` JS, `startAutoReconnect`,
`forceReconnect`/`reconnectDevice`, `OutboxDial.pick`/`MAX_CLIENT_LINKS`, `connectToDevice`/`disconnectDevice` públicos. Envíos por
contacto (`sendToContact`): fuera la elección de dirección en `ble_send.js`.
Pruebas: S3, S4, S6, S7, S10, S12, S13, S15, S17, S21, S24; vectores `LinkMemory`/`LinkCap`. Para el dueño: el caso de la tablet y el
Vivo (con sus apps dormidas), dos teléfonos que se ven a la vez, multitud pequeña (4–6 teléfonos).

**Paso 4 — Un solo escáner.**
Kotlin: `ScanPlan` (peticiones, cupo de todo el proceso, ritmo con transferencia), regla Coded en el nativo.
**Se quitan**: `_autoScanForKnownContacts` y su compuerta, el bucle de re-búsqueda y la presencia JS, `relay._scan` directo (pasa a
`requestScan('puente')`), el escaneo propio de `outboxDialStep` y de `BleSinApp.dialStep`, la regla Coded JS.
Pruebas: S6, S10, S14, S18, vectores de `ScanPlan`, `scancupo`/`scanhold` reescritas. Para el dueño: «Agregar», «Buscar a…», volver a
la app con un contacto que llega.

**Paso 5 — La app oculta es la misma máquina.**
Kotlin: `BleSinApp` y la app cerrada se enganchan a `LinkHost`; `SinAppLinks` se funde en el cliente único; fuera `closeAll` al abrir.
Pruebas: S18, S19, S2 con la app cerrada; para el dueño: app cerrada en los dos, mandar desde uno, abrir el otro.

**Paso 6 — Cierre de la capa.**
Quitar los restos (`BLE_STATES` para Bluetooth, `SUPERVISOR_STATES`, `_jitteredBackoff`), diagnóstico con las medidas de §5.7,
`ROBUSTEZ.md` y `docs/AREAS.md` al día, y comparar con la línea de base del paso 0. Con esto empieza la fase de Wi-Fi Direct.

**Riesgos y cómo se mitigan**

| Riesgo | Mitigación |
|---|---|
| El Kotlin no se compila aquí: un error tira 85 min de CI | clases puras primero (JVM en `tests/kotlin`; aquí si `gradle` funciona); `tests/kotlin-android` (tipos) antes de subir; el resto es pegamento corto alrededor |
| El gemelo JS del simulador se separa del Kotlin | vectores compartidos que corren los dos (§6) |
| Pasos largos con el límite semanal | cada paso cabe en una sesión de Fable; empezar los pasos 2 y 3 justo tras el reinicio semanal |
| Romper consumidores (`calls.js`, `wifi_direct.js`, Jump, Fénix, L2) | la vista JS conserva las firmas (`_bleReadyFor`, `getMtu`, `linkOf`); `grep` de los 29 usos en cada paso |
| `lp` cada 15 s gasta batería | solo con el enlace callado; < 120 bytes; con tráfico no se manda; medir %/h con la línea de base |
| El nativo con la app congelada no recibe deseos | `T_WANT_TTL` + deseos de la bandeja nativa |
| Un teléfono del dueño con build vieja durante la migración | regla del 14-11: se actualiza; los pasos 2 y 3 lo dicen en NOVEDADES («actualiza en los dos teléfonos») |
| Volver atrás | cada paso es un commit propio en NEXOCHAT; la APK anterior sigue instalable; ramas `base-estable-*` |

---

## 8. Preguntas para el dueño (solo lo que es suyo)

**P1 — Seguridad: ¿firmar la prueba de vida?** El `lp` puede ir firmado con la clave de pareja que el nativo ya tiene para el ✓✓
(`ackKeys`). Sin firma, alguien cerca que se haga pasar por un contacto puede quedarse con un enlace «listo» y retrasar sus mensajes (no
leerlos: van cifrados).
- **A (prefiero):** firmado. Lo que vives: nada visible; un enlace solo cuenta como de tu contacto si lo prueba. Una sola vez al
  programarlo.
- **B:** sin firma, como hoy el pong. Lo que vives: igual en el día a día; un atacante cerca podría hacer que un mensaje tarde (de vez en
  cuando, solo con alguien malicioso al lado).

**P2 — Cuánto esperar con un contacto cuyo teléfono congela NEXO** (Vivo, Honor, la tablet). Mientras tanto el mensaje va por
internet/toque si hay; si no hay, espera.
- **A (prefiero):** pausas de 10 → 20 → 40 → 60 min, y antes si da señal de vida o si abres su chat. Lo que vives: el Bluetooth deja de
  abrirse y cerrarse (frecuente con esos teléfonos), menos batería; sin internet, un mensaje a ese contacto puede esperar hasta que su
  teléfono despierte o abras su chat (de vez en cuando).
- **B:** pausas de 2 → 5 → 10 min. Lo que vives: algo más rápido en ese caso raro sin internet, a cambio de más intentos y batería todo
  el día con esos contactos cerca.

**P3 — ¿Decirle al usuario que el teléfono del otro está durmiendo NEXO?** Con el estado `CONGELADO` la app sabe que el sistema del otro
congela NEXO (ajuste de batería suyo).
- **A (prefiero):** una línea discreta en su chat («El teléfono de X está dormido; sus mensajes llegan cuando despierte o por
  internet»), sin decir marca ni ajuste. Lo que vives: entiendes por qué tarda; una sola vez por racha.
- **B:** no decir nada (solo en el diagnóstico). Lo que vives: igual que hoy.

**P4 — Ritmo de APKs.** El plan son 6 pasos (paso 0 va con cualquier subida).
- **A (prefiero):** una APK por paso, con 3–5 pruebas tuyas entre cada una. Lo que vives: ~5 APKs en una o dos semanas, cada una mejora
  algo concreto; si algo falla se sabe qué paso fue.
- **B:** juntar 1+2 y 3+4 en dos APKs. Lo que vives: menos esperas de CI, pero un fallo es más difícil de ubicar y el salto es mayor.
