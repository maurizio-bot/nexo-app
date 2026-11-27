# Contrato común de los caminos y diseño del cambio entre caminos (28-11-2026, en papel)

Fase (0) de la decisión del dueño del 28-11: **(0) contrato + diseño en papel** → (1) internet → (2) Bluetooth → (3) Wi-Fi Direct →
(4) Wi-Fi local → (5) programar el cambio entre caminos. Base: `docs/AUDITORIA_CONEXIONES_28-11.md` (auditoría + §7 cómo lo hacen otros)
y `docs/ENRUTADO_27-11.md` (aprobado por el dueño). El detalle del Bluetooth (máquina de estados, zombi) va en
`docs/PLAN_BLUETOOTH_28-11.md`; aquí solo lo que el Bluetooth tiene que **cumplir** hacia afuera.

Objetivo: que otro pueda programarlo sin adivinar. Donde hay riesgo o duda real, va marcado **[RIESGO]** o **[DUDA]**.
Lo que es decisión del dueño no se decide aquí: va a la sección E y, mientras, se toma el comportamiento de hoy.

---

## 0. Principios (de los que sale todo lo demás)

1. **Un dueño por cosa.** El estado de un enlace lo lleva su camino; qué camino se usa lo decide UN enrutador (`elegir()`); cuándo se
   reintenta un mensaje lo decide UN calendario. Nadie más decide eso. PORQUÉ: hoy se decide en ~25 sitios y se reenvía en 14
   (auditoría §3–4); de ahí salen los órdenes contradictorios y los sobres de más que acaban en «banned».
2. **Los caminos informan, no deciden política.** Un camino dice «estoy listo / degradado / caído, con estas medidas»; nunca contesta
   «no» por una preferencia (hoy `lan.canReach` y `net.canReach` esconden reglas de preferencia: `src/ui/lan.js:139-155`,
   `src/net/net_link.js:256-260`).
3. **Cambiar de camino solo con causa**, de una lista cerrada (B.2.4), y cada decisión deja una línea `[RUTA]` (B.7).
4. **Tres vidas distintas** (A.3): «el camino vive» ≠ «la app del otro contesta» ≠ «el teléfono del otro tiene el mensaje».
5. **Nada se pierde y nadie se rinde con un texto** (principio de NEXO: todos los caminos). Los topes frenan el ritmo, nunca borran.
6. **Una sola política, dos ejecutores.** La app calcula; el nativo ejecuta un plan ya calculado (A.7). Nunca dos reglas distintas.
7. **Conservar lo que funciona** (lista en D.1): latido nativo del Wi-Fi, pausas por relé, histéresis 3/8 del Wi-Fi, topes del puente,
   reanudación del buzón, HalfOpenPolicy, ServerFlapPolicy, cupo de enlaces Bluetooth…

### Glosario corto
- **Camino**: `lan` (misma Wi-Fi), `net` (internet), `ble` (Bluetooth LE), `wd` (Wi-Fi Direct), `jump` (por otro NEXO).
- **Carril**: variante de un camino con capacidades propias: `ble.gatt`, `ble.l2`; `net.relay`, `net.tor`, `net.gw` (internet por un
  NEXO cercano que presta su internet), `net.own` (relé de NEXO, cuando exista); `jump.ble`, `jump.lan`, `jump.wd`.
- **Envío**: un intento de sacar un mensaje (o una parte) por un carril. **Mensaje**: lo que ve el usuario; tiene un calendario.
- **Ejecutor**: quien hace los envíos ahora: la app (a la vista o viva) o el nativo (app oculta/cerrada). Uno a la vez (A.7.3).

---

## A. CONTRATO DE UN CAMINO

Todo camino (y el puente como «camino por otro») expone la MISMA interfaz. En JS: un objeto que cumple `Camino`; en Kotlin, la parte que
corre sin la app cumple el mismo contrato en sus eventos hacia el diario compartido (A.7).

```
Camino {
  id: 'lan'|'net'|'ble'|'wd'|'jump'
  estado(nx)        -> EstadoCamino            // A.1 (síncrono, barato, sin efectos)
  medidas(nx)       -> MedidasCamino           // A.4
  capacidades(nx)   -> Capacidades             // A.4.6
  enviar(sobre)     -> Promise<Aceptado>  | rechaza con ErrorCamino   // A.5.2, A.6
  cancelar(msgId, parteId?) -> void
  abrir(nx, motivo) -> void                    // el enrutador lo pide; el camino decide cómo (escaneo, conectar, montar grupo…)
  cerrar(nx, motivo, {ordenado:true})-> Promise<void>   // A.5.3 cierre ordenado
  sondear(nx)       -> Promise<{rttMs}>        // prueba de transporte (no de la app del otro)
  on(evento, fn)                               // A.5.1
}
```

### A.1 Estado por contacto: valores y transiciones

Un camino tiene, **por contacto** (`nx`), uno de estos valores. Son los mismos para todos; lo que cambia es qué los prueba (A.2).

| Valor | Significa | Se puede enviar |
|---|---|---|
| `NO_DISPONIBLE` | Este teléfono no puede (radio apagada, sin permiso, sin red, Android no lo soporta) o el contacto no tiene la capacidad (no la anunció en su `kx`) | No |
| `INACTIVO` | Podría, pero no hay nada abierto ni señales del contacto por este camino | No (se puede pedir `abrir`) |
| `BUSCANDO` | Descubriendo al contacto (escaneo BLE, mDNS, descubrimiento WD, buscar ruta Jump) | No |
| `CONECTANDO` | Transporte en curso de montarse (GATT conectando, socket, grupo WD, relé conectando) | No |
| `COMPROBANDO` | Transporte arriba, falta la prueba cifrada de extremo a extremo con ESE contacto | Solo `CONTROL` del propio apretón de manos |
| `LISTO` | Probado de verdad (A.2) y sin señales de mala calidad | Sí |
| `DEGRADADO` | Vive pero mal: RTT alto, pérdida, escrituras fallidas, MTU mínima, relés del otro en pausa, «la app del otro calla» | Sí para lo que su `capacidades` admita; el enrutador prefiere otro |
| `MARGEN` | Acaba de caer por un corte; se espera que vuelva durante su margen (hoy el Wi-Fi: 2–5 s adaptativo, `lan.js` `_graceMs`) | No lo nuevo si hay otro camino; un archivo a medias espera |
| `CAIDO` | Cayó y pasó el margen | No |

Transiciones permitidas (cualquier otra es un error de programación y se registra):

```
NO_DISPONIBLE ⇄ INACTIVO                 (radio/permiso/red cambia; capacidad anunciada)
INACTIVO → BUSCANDO → CONECTANDO → COMPROBANDO → LISTO
LISTO ⇄ DEGRADADO                        (con histéresis: A.4.5)
LISTO|DEGRADADO → MARGEN → (LISTO | CAIDO)
CONECTANDO|COMPROBANDO → CAIDO           (falló el montaje; con causa)
CAIDO → BUSCANDO|CONECTANDO              (solo si alguien pidió abrir() o hay algo pendiente; con espera creciente del camino)
cualquiera → NO_DISPONIBLE               (radio apagada, etc.)
```

Cada transición emite `camino:estado {nx, camino, carril, de, a, causa, at}` con `causa` de la lista cerrada A.6.1.
**Un solo registro por camino** (hoy el Bluetooth tiene 5: `_deviceStates` `src/ui/ble_interface.js:97`, `_supervisorStates`
`src/ui/ble_connections.js:127`, mapas de claves distintas, y 2 en Kotlin `PluginBtState.kt:310-328`): en la fase 2 el dueño del
estado Bluetooth es el nativo y la app lo refleja.

### A.2 Qué es «LISTO» de verdad en cada camino

| Camino / carril | LISTO exige (todo) | NO basta |
|---|---|---|
| `lan` | socket del LanHub nativo arriba **y** comprobación cifrada con la sesión de ese contacto en los dos sentidos **y** latido nativo con ida y vuelta < `BAD_RTT_MS` (1,5 s) **y** no `rechecking` | estar en la misma red o verlo por mDNS |
| `net.relay` | ≥ 1 relé abierto, **no en pausa para publicar**, que esté en la **lista de lectura vigente del otro** (B.5.1), y las claves del par | «tengo relés abiertos» (hoy `net_link.js:256` mezcla eso con el saludo) |
| `net.tor` | circuito directo con `torOk` (ida y vuelta medida) | `torUp` sin prueba |
| `net.gw` | relé por el puente abierto y el puente confirmó cupo; capacidades recortadas (A.4.6) | ver al vecino |
| `net.own` | igual que `net.relay` | — |
| `ble.gatt` | conectado **y** servicios descubiertos **y** MTU negociada y conocida **y** suscripción a avisos (CCCD) confirmada **y** `kx`/sesión hecha **y** un primer ping de transporte contestado **después** de conectar | READY sin MTU ni suscripción; un enlace «recuperado» al volver la app sin comprobar (hoy entra así: auditoría §5) |
| `ble.l2` | canal abierto con el token del `kx`; existe solo mientras dura la transferencia | anunciar `l2` |
| `wd` | grupo montado, los dos unidos, socket abierto y token verificado. Además el estado `PREPARABLE` (= `INACTIVO` con capacidad y canal de control): hay **cualquier** camino listo para negociar (no solo Bluetooth, hoy `wifi_direct.js:309`) | soportar Wi-Fi Direct |
| `jump.*` | un vecino directo en `LISTO` (por `ble`/`lan`/`wd`) anuncia ruta al destino con `ts` < `ROUTE_TTL_MS` (95 s, `ble_relay_conf.js:4`) y acepta custodia | haber visto la ruta alguna vez |

`DEGRADADO` por camino (umbrales iniciales; se conservan los de hoy donde existen):
- `lan`: 3 latidos malos seguidos (~12 s) con RTT > 1,5 s o inactivo > 12 s; vuelve con 8 buenos (~30 s) (`lan.js:44-45`, se conserva).
- `net.relay`: todos los relés de lectura del otro que puedo abrir están en pausa o con > 2 rechazos en 5 min; o RTT de `OK` > 5 s.
- `ble.gatt`: ≥ 30 % de escrituras fallidas en la última ventana de 20, o RSSI < −90 dBm sostenido 20 s, o MTU ≤ `TINY_MTU` (50), o
  **la app del otro calla** (A.3) con el transporte vivo.
- `wd`: velocidad medida < 50 KB/s sostenida 20 s.
- `jump`: primer salto `DEGRADADO` o el puente avisa cola llena.

### A.3 Tres vidas separadas (obligatorio)

| Capa | Pregunta | Quién la mide | Dónde vive |
|---|---|---|---|
| **V1 transporte** | ¿El camino funciona hasta su punta? | El camino: latido LAN, ping de transporte BLE (respuesta ATT/escritura confirmada), `OK` del relé, socket WD | `EstadoCamino` por camino |
| **V2 app del otro** | ¿Su app contesta? | Cualquier paquete autenticado de su app por **cualquier** camino (saludo, acuse, pong de app) | `ContactoRuta.despierto` (B.1), por contacto, no por camino |
| **V3 su teléfono lo tiene** | ¿Su teléfono guardó MI mensaje? | Acuse de entrega firmado: de su app **o de su nativo** (BgInbox/NetBg con la app dormida) | Calendario del mensaje: ✓✓ |

Reglas que salen de separarlas:
- V1 sí y V2 no = **«la app del otro calla»**: el camino pasa a `DEGRADADO(APP_CALLA)`. **No se reconecta** (rehacer la radio no despierta
  una app). Se toca (FCM) y se usa otro camino si lo hay. Es la causa de raíz del zombi (auditoría §5).
- V1 no = caída real: el camino va a `MARGEN`/`CAIDO` y entonces sí reconecta, con espera creciente y memoria (fase 2).
- ✓✓ es V3 y es **por contacto, no por camino** (como Briar): da igual por dónde llegue el acuse; cierra el mensaje en todos los caminos.
- Un pong de app (V2) actualiza `despierto` del contacto aunque llegue por otro camino; nunca se usa como prueba de V1 de un camino.
  Hoy ocurre al revés: `_lastPongTime` (de app) alimenta decisiones de enlace, y además con clave equivocada (fallo confirmado:
  `ble_receive.js:47/303/380`, `ble_native_events.js:326` guardan con la MAC cruda; `ble_linkmgr.js:193` lee con la normalizada).

### A.4 Medidas por contacto y camino

```
MedidasCamino {             // por (nx, camino, carril); persistido, compartido con el nativo (A.7)
  ttd:   { muestras: [ms…] (últimas N=20, ≤ 7 días), mediana, p90 }   // tiempo de «enviado por este camino» a ✓✓ (V3)
  rtt:   { ewma, ultimo, at }                                         // V1: latido/ping/OK del relé
  vel:   { bps, muestras: últimas 5 transferencias ≥ 64 KB, at }      // bytes útiles / tiempo de principio a fin
  fallos:[ { at, causa, msgId? } ] (últimos 20, ≤ 24 h)               // causa ∈ lista cerrada A.6.1
  calidad: { rssi?, mtu?, perdida? (% ventanas/escrituras repetidas), phy? }
  coste:  { datosMoviles: bool (alguno de los dos extremos), bytesHoy, claseBateria: 'baja'|'media'|'alta' }
  desde:  primera vez visto por este camino; ultimoListo: at
}
```

1. **Tiempo hasta ✓✓ (ttd)**: se cuenta desde el `Aceptado` del camino hasta el acuse V3. Si el otro estaba dormido (B.1) la muestra
   **no entra** (si no, el camino «parece lento» por culpa del sueño del otro). Hoy existe pero por día y sin separar contactos
   (`src/ui/usage_stats.js:62`) y solo para el diagnóstico.
2. **Arranque en frío**: sin muestras se usan valores de partida por carril (lan 0,5 s; ble.gatt 2 s; net.relay 4 s; net.tor 3 s;
   jump 20 s; velocidades: lan 2 MB/s, wd 1 MB/s, l2 40 KB/s, gatt 15 KB/s, net 200 KB/s). Se sustituyen con las primeras 3 muestras.
3. **Fallos**: hoy `NEXO_notePathFail` los apunta y nadie los lee (`usage_stats.js:259`). Pasan a `MedidasCamino.fallos`.
4. **Pérdida**: % de ventanas/escrituras repetidas dentro del camino (las retransmisiones internas del camino se miden, no se ocultan).
5. **Histéresis de calidad**: un valor se considera cambiado solo con 3 muestras seguidas al otro lado del umbral (bajar) y 8 (subir).
6. **Capacidades** (`Capacidades`), declaradas por el camino y recortadas por el contacto (`kx`):
   `{ texto, archivo, maxBytes, vozLlamada, videoLlamada, segundoPlano (funciona con la app oculta: lo ejecuta el nativo),
     alcanzaDormido (puede entregar al nativo del otro con su app dormida), guarda (el carril guarda por mí: relé, puente) }`

| Carril | texto | archivo (máx.) | voz | vídeo | 2.º plano (nativo) | alcanza dormido | guarda |
|---|---|---|---|---|---|---|---|
| lan | sí | sí (1 GB por `big_file`) | sí | sí | sí (LanHub) | sí (nativo del otro) | no |
| net.relay | sí | buzón ~42 MB (`NET_MAX_B64_BYTES`, `media_limits.js:31`) | sí (audio) | no (fotogramas no por relés, `calls.js:164-170`) | sí (NetBg) | sí | sí (7 días `TTL_MSG`) |
| net.tor | sí | sí | sí | sí | sí (PluginTor) | no (hace falta su Tor arriba) | no |
| net.gw | sí | ≤ ~300 KB (`GW_FILE_MAX_B64`, `gw_link.js:69`) | no | no | parcial | sí | sí (el relé) |
| ble.gatt | sí | ≤ ~2,3 MB (`BLE_FILE_MAX_CHARS`, `ble_ack_shared.js:143`); HD vídeo 9,5 M car. | sí | no | sí (OutboxBle/BleSinApp) | sí | no |
| ble.l2 | no (no compensa < ~45 KB) | sí (hasta `big_file`) | no | no | **falta** (fase 2) | depende del nativo | no |
| wd | **falta** (fase 3: textos en la multitud) | 100 KB–22 MB; más con `big_file` | no (fuera, ver B.2.9) | no (fuera) | **no** (necesita la app) | no | no |
| jump | sí | ≤ topes del puente | no | no | sí (sin custodia hoy) | sí | sí (custodia 24 h en la app) |

### A.5 Eventos y operaciones

#### A.5.1 Eventos que emite todo camino
| Evento | Datos | Cuándo |
|---|---|---|
| `camino:estado` | `{nx, camino, carril, de, a, causa, at}` | toda transición A.1 |
| `camino:calidad` | `{nx, camino, que:'degradado'|'recuperado', medida, valor}` | al cruzar umbral con histéresis |
| `envio:aceptado` | `{msgId, parteId, nx, carril, guardadoPor?: {tipo:'rele',url}|{tipo:'puente',via,venceAt}, at}` | el camino lo sacó (LAN/BLE: el otro lado confirmó recepción del transporte; relé: `OK true` o `duplicate`; puente: `rk`) |
| `envio:avance` | `{msgId, parteId, bytes, total, bps, at}` | como mucho cada 2 s o cada 64 KB. **Obligatorio también en el nativo** (hoy WD y L2 no lo emiten: TRASPASO, «pendiente del 6») |
| `envio:rechazo` | `{msgId, parteId, carril, error: ErrorCamino}` | cualquier no |
| `envio:acuse` | `{msgId, de: 'app'|'nativo', tipo:'entregado'|'leido', via, at}` | llegó un acuse V3 por este camino (el camino lo pasa; el calendario lo usa) |
| `contacto:visto` | `{nx, quien:'app'|'nativo', via, at}` | cualquier paquete autenticado del otro (alimenta V2) |
| `capacidad` | `{nx, camino, capacidades}` | cambia algo de A.4.6 (p. ej. el otro anuncia `l2`) |

#### A.5.2 `enviar(sobre)` e idempotencia
```
Sobre { msgId, parteId?(trozo/índice), nx, tipo (B.2), bytes, prioridad: 'interactivo'|'normal'|'fondo',
        idem: msgId + ':' + (parteId||0),           // clave de idempotencia
        cifrado: bytes ya cifrados de extremo a extremo (se cifra UNA vez por mensaje y destinatario),
        eventoFirmado?: (net) el evento Nostr ya firmado, guardado en el calendario, para republicarlo IGUAL,
        desde?: offset para reanudar }
```
- **Idempotencia de punta a punta**: el receptor descarta por `idem` (ya lo hace por `msgId` en el camino normal; se exige en TODOS
  los caminos, incluidos Jump, WD y L2). Mandar lo mismo por dos caminos nunca produce dos mensajes.
- **Por internet se republica el MISMO evento firmado**, no uno re-cifrado: el relé que ya lo tiene contesta `duplicate` (= éxito) y no
  cuenta como sobre nuevo contra su límite. Hoy cada reintento re-cifra y crea un sobre nuevo (auditoría §4, «doble publicación»).
- `enviar` resuelve con `Aceptado` (ver `envio:aceptado`). No resuelve con «entregado»: eso es V3 y lo ve el calendario.
- Un camino puede retransmitir **dentro** de un envío (ventanas, NACK, `ble_ack_shared.js:8-22`): es su fiabilidad propia y vale
  mientras haya avance. Lo que no puede hacer es volver a mandar un mensaje entero por su cuenta: eso es del calendario (B.4).
- Plazo de un envío: **por avance, no fijo**. Se rechaza con `SIN_AVANCE` tras 60 s sin un byte confirmado (textos: 3× el p90 de ese
  carril con ese contacto, entre 8 s y 60 s). Se quitan los plazos fijos por tamaño (hoy `wifi_direct.js` ~405, `l2_fast.js:124`,
  plazo de 120 s al recibir por WD, `ASSEMBLY_TIMEOUT_MS` `ble_ack_shared.js:157`).

#### A.5.3 `cerrar(nx, motivo, {ordenado})` (tipo Nearby)
1. El enrutador marca el camino viejo «sin envíos nuevos» para ese contacto.
2. Los envíos en curso terminan (o llegan a un borde de trozo y se pasan con `desde`).
3. Por el viejo sale `ULTIMA {seqFinal}`; el otro contesta `PUEDE_CERRAR {seqFinal}` cuando recibió todo hasta `seqFinal`.
4. Se cierra. Si en 5 s no llega `PUEDE_CERRAR`, se cierra igual y lo no confirmado vuelve al calendario (idempotencia evita duplicados).
- `cerrar` sin `ordenado` solo para: radio apagada, castigo, salida de la app por el usuario.

### A.6 Errores tipificados

#### A.6.1 Lista cerrada de causas (`Causa`)
`ENLACE_CAIDO`, `SIN_AVANCE`, `LIMITADO`, `CASTIGADO`, `POLITICA` (relé `blocked`/`restricted`/web of trust), `INVALIDO` (el otro lado dice
que el sobre está mal: es un fallo nuestro), `OCUPADO_LOCAL`, `OCUPADO_REMOTO`, `APP_CALLA` (V1 sí, V2 no), `CIFRADO_DESFASE`,
`EXCEDE_TAMANO`, `SIN_CAPACIDAD`, `RADIO_APAGADA`, `SIN_PERMISO`, `SIN_RED`, `SIN_RUTA`, `MTU_MINIMA`, `CANCELADO`, `CUPO_PROPIO`
(nuestro propio limitador por relé), `DESCONOCIDO` (debe ser raro: cada `DESCONOCIDO` en un diagnóstico es un fallo a tipificar).

#### A.6.2 `ErrorCamino` y qué hace cada uno

```
ErrorCamino { tipo, causa, esperaMs?, alcance: 'envio'|'carril-contacto'|'carril-todos'|'contacto', reintentable: bool }
```

| tipo | Ejemplos de causa | ¿Cuenta como fallo del camino? | Qué hace el calendario | Qué hace el enrutador |
|---|---|---|---|---|
| `OCUPADO` | `OCUPADO_LOCAL/REMOTO` (WD con otra transferencia) | **No** | reintenta en el mismo carril tras `esperaMs` (por defecto 2–10 s con azar) o antes si el camino avisa que se liberó | puede usar la alternativa si el mensaje es interactivo; **sin castigo de 10 min** (hoy `wifi_direct.js:284/531`) |
| `FALLO` | `ENLACE_CAIDO`, `SIN_AVANCE`, `INVALIDO`, `CIFRADO_DESFASE`, `DESCONOCIDO` | Sí (`MedidasCamino.fallos`) | espera creciente con azar (B.4.4) | puede cambiar de camino (causa B.2.4) |
| `LIMITADO` | `LIMITADO`, `CASTIGADO`, `CUPO_PROPIO` (+ `esperaMs` del relé o 20 s→10 min) | **No** (es del relé, no del contacto) | ese relé queda en pausa para publicar `esperaMs`; el mensaje no espera si hay otro relé de lectura del otro | pasa a otro relé **que el otro lea**; si no queda ninguno y está cerca, a `lan`/`ble` |
| `DORMIDO` | `APP_CALLA` | No | toque FCM y esperar (no reenviar) | no cambia por esto si el mensaje ya está guardado (✓) |
| `SIN_CAMINO` | `SIN_RUTA`, `RADIO_APAGADA`, `SIN_RED`, `SIN_PERMISO` | No | `PAUSADO(SIN_CAMINO)`: **cero intentos** hasta un evento `camino:estado → LISTO` | — |
| `NO_REINTENTAR` | `POLITICA`, `EXCEDE_TAMANO`, `SIN_CAPACIDAD` | No (del relé/carril) | ese carril queda fuera para ese mensaje (política: 6 h para ese relé, como hoy) | elige otro; si no hay, `PAUSADO` con motivo visible |
| `CANCELADO` | `CANCELADO` | No | fin | — |

Respuestas de relés (Nostr) → tipo: `OK true` y `duplicate:` = aceptado; `rate-limited:` = `LIMITADO` (con su espera si la trae);
`banned`/`too many` = `CASTIGADO`; `blocked:`/`restricted:` = `POLITICA`; `invalid:` = `FALLO(INVALIDO)`, no reintentar ese evento en
ese relé; `auth-required:` = identificarse y reintentar una vez; `error:` = `FALLO`. Hoy la app lo hace en gran parte
(`net_publish.js:15`, `relelimita.js`) y **el nativo lo ignora** (`NetBg.kt:633-636` solo mira `OK true`).

### A.7 Paridad app ↔ nativo

#### A.7.1 Qué vive dónde
| Pieza | Dueño | El otro |
|---|---|---|
| Estado de enlace BLE (fase 2) | nativo | la app lo refleja por eventos |
| Estado LAN (latido, corte) | nativo (LanHub, ya hoy) | la app lo refleja |
| Relés: conexión, escucha, pausas | app cuando vive; nativo con la app oculta | **pausas y cupo compartidos** (mismo archivo): el castigo es por IP, vale para los dos |
| `ContactoRuta` (B.1) y medidas | app calcula; nativo **agrega hechos** al diario | — |
| `elegir()` y la tabla de decisiones | app (JS, módulo puro) | el nativo recibe el **plan** ya calculado |
| Calendario por mensaje | uno solo, persistido; lo ejecuta quien tiene el **testigo** (A.7.3) | — |
| Cifrado de extremo a extremo | app (y el nativo para lo que ya cifra hoy: acuses, saludo) | — |

#### A.7.2 El plan para el nativo (reglas ya calculadas)
Al ocultarse la app (y cada vez que cambia algo relevante mientras está oculta y viva) la app escribe `ruta_plan.json` (cifrado en
reposo como los demás archivos del nativo, `AtRestStore`):
```
{ v, hecho: at, ejecutor: 'nativo', testigoHasta,
  reles: { escuchar: [url…], pausas: {url: hastaAt}, cupo: {url: {porMin, usadosVentana}} },
  contactos: { nx: { leeEn: [url…], leeEnAt, lugar, despierto,
                     orden: { texto: ['net.relay','lan','ble.gatt','jump'], acuse: [...], archivoChico: [...] },   // ya filtrado por capacidades
                     siPausa: { url: [urlAlternativa…] } } },
  mensajes: [ { msgId, nx, tipo, estado, proximoAt, intentos, guardadoEn, eventoFirmado?, cifradoRef } ] }
```
El nativo **no decide** orden ni causas: ejecuta `orden` en ese orden, salta lo que su estado no tiene `LISTO`, respeta `pausas` y
`cupo`, y aplica el mismo calendario (B.4) con los mismos números. Para lo que el plan no previó (llega una Wi-Fi nueva, cambia la red)
tiene **una sola regla mecánica**: volver a evaluar `orden` con los estados nuevos; nunca inventar uno.
**[RIESGO]** Hace falta una versión Kotlin de las piezas mecánicas (calendario, pausas, cupo). Para que no se separen: las pruebas de
las dos usan **los mismos vectores JSON** (`tests/vectores/ruta/*.json`: entrada → decisión esperada), corridos por `tests/sim` y por
`tests/kotlin`. Sin eso, en seis meses volveríamos a «la app y el nativo usan reglas distintas» (auditoría §6).

#### A.7.3 Un ejecutor a la vez (testigo)
- El testigo dice quién envía: `{ejecutor, hasta}`; dura 20 s y se renueva. La app lo toma al volver a la vista o al arrancar; al
  ocultarse lo pasa con el plan. Si la app muere sin pasarlo, el nativo lo toma cuando vence.
- El nativo apunta lo que hizo en `ruta_diario.jsonl` (solo añadir: `envio:aceptado`, `envio:rechazo`, acuses, `contacto:visto`,
  pausas nuevas). La app, al volver, lo **lee y une** antes de mandar nada. PORQUÉ: hoy al volver la app reenvía lo que el nativo ya
  había subido y al ocultarse el nativo resube lo que la app ya tenía guardado en un relé (auditoría §4).
- `NetOutbox.kt` y `OutboxBle.kt` pasan a ser el **ejecutor nativo del calendario** (conservan su persistencia y sus esperas,
  `NetOutbox.kt:72/106/116`, añadiendo azar).

### A.8 Cómo cumple hoy cada camino (y qué falta)

#### Wi-Fi local (`lan`) — el más cerca del contrato
| Punto | Hoy (archivo:línea) | Falta |
|---|---|---|
| Estado | `links` con `routable/up/degraded/graceUntil/rechecking` (`src/ui/lan.js:139-155`); latido y corte nativos (`LanHub.kt`) | valores A.1 explícitos y evento `camino:estado` con causa |
| Listo de verdad | comprobación cifrada `_verify` (`lan.js:162`), latido con ida y vuelta (`lan.js:40-45`) | nada de fondo |
| Tres vidas | el latido es nativo (V1); la app sin contestar se trata con «30 s» (`lan.js:40-42`) | separar `APP_CALLA` de caída |
| Medidas | `quality()` da rtt/idle/degraded (`lan.js:195`); recuperaciones por contacto (`_recovFor`) | ttd por contacto, vel., fallos con causa |
| Política escondida | `canReach` devuelve «no» por preferencia (`lan.js:139-155`: «hay otro camino») | sacar la preferencia al enrutador |
| Errores | `LAN_DOWN` solo (`lan.js:197-200`) | tipos A.6 |
| Avance | no hay `envio:avance` para archivos | evento nativo |
| Nativo | LanHub con la app oculta: bien | recibir plan |

#### Internet (`net`) — fase 1
| Punto | Hoy | Falta |
|---|---|---|
| Estado | `canReach` = `p.up && (online || torOk) && pairs` (`net_link.js:256-260`); `p.up` es «saludo hace < 150 s» (`UP_MS`, `net_link_shared.js:53`) → **mezcla V1 con V2** | estado de transporte por contacto según relés de lectura del otro (A.2) |
| Dónde lee el otro | no existe; el saludo no lo anuncia (`net_link.js:586`) | anuncio B.5.1 |
| Publicar | a todos los abiertos sin pausa (`net_publish.js:198-203`) | solo en los de lectura del otro |
| Límites | pausas 20 s→10 min, castigo, política 6 h (`net_publish.js:15`, `:96`), cupo (`:74`): **bueno, se conserva** | compartirlo con el nativo; respetar `esperaMs` del relé |
| Escucha | app: todos (`CELL_READ_RELAYS = 99`, `net_link_shared.js:23`); **nativo: 2 con datos** (`NetBg.kt:119`) y sin reservas | misma lista en los dos |
| Nativo y castigo | ignora `OK false` (`NetBg.kt:633-636`) | aplicar A.6.2 en Kotlin |
| Reenvíos | ventanas de `ChatStream` (`chat_stream.js:637`), `_netWindowStored` (`chat_stream.js:527`, bueno), red de seguridad (`ble_send.js:409`), `resync` (`net_relays.js:274`), `NetOutbox` | todo al calendario |
| Avance | buzón sí (`blob_mailbox.js:186/221`) | igual para el directo |
| Toque | `_wake` con tope por par 8 s / 3 s / 15 s (`net_wake.js:39`, `net_link_shared.js:98-101`) | el calendario lo pide; vigilar degradación FCM |

#### Bluetooth (`ble`) — fase 2 (detalle en `PLAN_BLUETOOTH_28-11.md`)
| Punto | Hoy | Falta |
|---|---|---|
| Estado | 5 registros (A.1); `_bleReadyFor` decide «listo» (`ble_startup.js:121`) | un registro, dueño nativo |
| Listo | READY sin MTU/suscripción en 2 sitios; recuperados «sin comprobar» (`ble_connections.js:120`) | A.2 completo |
| Tres vidas | supervisor: ping sin respuesta → ZOMBIE → rehacer (`ble_connections.js:104-131`) | `APP_CALLA` sin reconectar |
| Medidas | MTU (`getMtu`, `ble_startup.js:156`), velocidad L2/WD del día (`l2_fast.js:43-100`) | por contacto; RSSI; pérdida |
| Fallo confirmado | `_lastPongTime` con claves distintas (A.3) | arreglar (suelto, se puede ya) |
| Cupo de enlaces | `ble_linkmgr.js:214-235` (bueno, se conserva) | usar `ContactoRuta` para elegir a quién soltar |
| L2 | plazos a 2 KB/s de respaldo (`l2_fast.js:28-30`), ACK 20 s (`:34`) | avance nativo; reanudación |
| Nativo | OutboxBle/BleSinApp con la app dormida; HalfOpenPolicy, ServerFlapPolicy (buenos) | mismo contrato de eventos |

#### Wi-Fi Direct (`wd`) — fase 3
| Punto | Hoy | Falta |
|---|---|---|
| Estado | `busy` global (`wifi_direct.js:152/383/431`) | estado por contacto; varias transferencias |
| Control | solo por Bluetooth listo (`wifi_direct.js:10`, `:309`) | cualquier camino listo (`lan`, `net`) |
| Grupo | uno por envío (`PluginWifiDirect.kt:144`, `:189` `removeGroup`) | grupo preparado y reutilizado (PREPARABLE→LISTO) |
| Ocupado | rechaza y castiga 10 min (`wifi_direct.js:284`, `:531`) | `OCUPADO` sin castigo |
| Plazos | `soTimeout` 90 s/60 s (`PluginWifiDirect.kt:149/281/295`); plazo fijo al recibir **[probable]** 120 s | por avance |
| No romper lo demás | **[probable]** el que recibe tira su Wi-Fi local al crear el grupo | no tocar `lan` si tiene algo en curso |
| Nativo | nada sin la app | aceptado como límite (B.2.9) |
| Jump | no lo usa | `jump.wd` en la multitud |

#### Puente (`jump`) — «camino por otro»
| Punto | Hoy | Falta |
|---|---|---|
| Rutas | `routes: destino → {via, hops, ts}` (`ble_relay.js:60`, `:195-197`), `MAX_HOPS 8`, `ROUTE_TTL_MS 95 s` (`ble_relay_conf.js:2-4`) | puntuación por calidad y carga (B.6) |
| Elección | directo primero, si no la ruta de menos saltos (`ble_relay.js:239-247`) | plan B si falla el salto |
| Custodia | `rk` = guardado (`ble_ack.js:578`); app hasta 24 h (`ble_relay.js:23`) | en el calendario: `GUARDADO(puente)` con vencimiento |
| Nativo | **sin custodia, 10 min** (`OutboxBle.kt:22/46/49`) | misma custodia (según E4) |
| Internet por puente | `net.gw`, topes por bytes (`gw_link.js:69/773/787`, `GwServe.kt:239`, buenos) | se conserva |

---

## B. DISEÑO DEL CAMBIO ENTRE CAMINOS (enrutador)

### B.1 Estado por contacto (`ContactoRuta`)
```
ContactoRuta {
  nx,
  lugar: 'MISMA_WIFI'|'CERCA'|'LEJOS'|'DESCONOCIDO', lugarPorque, lugarAt,
  despierto: 'APP'|'NATIVO'|'DORMIDO'|'DESCONOCIDO', despiertoAt,
  leeEn: { reles:[url…], at, firmado } | null,        // B.5.1
  tor: { onion?, ok, at }, fcm: { tiene: bool, degradado: bool (B.5.6) },
  caminos: { [carril]: { estado: EstadoCamino, medidas: MedidasCamino, capacidades } },
  puentes: { [vecinoNx]: { saltos, probEncuentro, at } },  // B.6
  fijadoHasta?: at, fijadoEn?: carril                  // anti-oscilación B.3
}
EstadoPropio { red: 'WIFI'|'DATOS'|'SIN'|'SOLO_PUENTE', bateria, ahorroDatos, appVisible, ejecutor }
```
**Lugar** (con caducidad, de más a menos fuerte):
- `MISMA_WIFI`: `lan` en `LISTO`/`DEGRADADO`/`MARGEN` con él. Caduca al pasar a `CAIDO`.
- `CERCA`: visto por BLE (anuncio o enlace) en los últimos 120 s, o descubierto por WD/mDNS en los últimos 120 s, o en ruta Jump de 1 salto.
- `LEJOS`: no está cerca **y** lo he oído por internet (saludo/acuse por relé o Tor) en las últimas 24 h.
- `DESCONOCIDO`: nada de lo anterior.
- Al cambiar `CERCA → LEJOS` se espera 120 s sin verlo (el BLE se pierde a ratos aunque esté al lado); `LEJOS → CERCA` es inmediato.

**Despierto** (V2): `APP` si un paquete de su app llegó hace < 150 s (`UP_MS`, se conserva); `NATIVO` si solo contesta su nativo
(acuses V3 del nativo, saludo nativo `r`) en < 10 min; `DORMIDO` si no hay nada en 10 min pero tiene toque FCM; `DESCONOCIDO` si no.
«Dormido» **no es causa de cambio de camino**: es causa de toque y espera.

### B.2 Tabla de decisiones

#### B.2.1 Tipos de envío
| Tipo | Qué es | Umbral (archivo, sin cifrar) | Prioridad |
|---|---|---|---|
| `TEXTO` | mensaje de texto, reacción, edición, borrado | — | interactivo |
| `ACUSE` | ✓✓, leído | — | interactivo, se junta |
| `CONTROL` | saludo, `kx`, anuncio de relés, «escribiendo», señalización de llamada, ofertas de archivo, `ULTIMA/PUEDE_CERRAR` | — | interactivo, sin guardar (salvo saludo/anuncio) |
| `ARCH_CHICO` | foto chica, nota de voz corta, sticker | ≤ 45 KB (`L2P_MIN_CHARS` 60 000 car.) — cabe en 1 sobre de relé (`MAX_CONTENT`) | interactivo |
| `ARCH_MEDIANO` | foto, nota de voz, archivo | 45 KB – 2,3 MB (`BLE_FILE_MAX_CHARS`) | interactivo hasta 450 KB (`INTERACTIVE_MAX_CHARS`), si no normal |
| `ARCH_GRANDE` | vídeo, documento | 2,3 – 22 MB (`WD_MAX_BYTES`) | normal |
| `ARCH_ENORME` | — | > 22 MB (`big_file`, hasta 1 GB) | fondo |
| `NOTA_VOZ` | como su tamaño, pero siempre interactivo | — | interactivo |
| `LLAMADA_VOZ`, `LLAMADA_VIDEO` | flujo en tiempo real | — | tiempo real |
| `GRUPO` | cualquiera de los de arriba a N miembros: **se decide por miembro** con la misma tabla | — | la del tipo |

#### B.2.2 Situaciones
`S1` misma Wi-Fi lista · `S2` misma Wi-Fi en margen o degradada · `S3` cerca y los dos con internet (Wi-Fi distinta o datos) ·
`S4` cerca y alguno sin internet (vagón, EDC) · `S5` lejos, los dos con internet, él `APP` · `S6` lejos, él `NATIVO`/`DORMIDO` ·
`S7` lejos, yo sin internet propio, un vecino me presta (`net.gw`) · `S8` lejos, sin internet, hay ruta Jump · `S9` sin ningún camino.

Modificadores que se aplican encima: `M1` relés del otro limitando · `M2` BLE con `APP_CALLA` (zombi) · `M3` MTU mínima · `M4` app
oculta (ejecuta el nativo: solo carriles con `segundoPlano`) · `M5` batería < 15 % · `M6` yo o él con datos móviles (coste).

Notación: **1.º** → alternativa(s) en orden. «causas» = las únicas causas (B.2.4) por las que se pasa de 1.º a la alternativa.

#### B.2.3 Tablas

**TEXTO** (y `NOTA_VOZ` ≤ 45 KB)
| Sit. | 1.º | Alternativas | Causas permitidas | Nota |
|---|---|---|---|---|
| S1 | lan | ble.gatt → net.relay | CAIDA, SIN_ACK | conserva el margen de 3022: en `MARGEN` lo nuevo va a la alternativa lista |
| S2 | net.relay (si los dos con internet) | ble.gatt; vuelve a lan con SUBIDA_ESTABLE (8 latidos buenos) | DEGRADADO_SOSTENIDO, CAIDA | regla del dueño 2760 |
| S3 | net.relay | ble.gatt → lan | CAIDA, SIN_ACK, RECHAZO_TODOS (todos los relés del otro en pausa) | regla del dueño 3079: «Bluetooth es la emergencia» |
| S4 | ble.gatt | jump (vecino con internet o con ruta) → wd (fase 3) | CAIDA, SIN_ACK, DEGRADADO_SOSTENIDO | la multitud: cupo de enlaces de `ble_linkmgr` |
| S5 | net.relay (los que lee él) | net.tor (si `torOk`) → net.own | RECHAZO → otro relé suyo; RECHAZO_TODOS → tor | **nunca** BLE/WD a uno lejano |
| S6 | net.relay, publicar una vez → `GUARDADO` + toque | — | RELE_PERDIO, LISTA_NUEVA, CADUCA (B.4) | dormido no es causa |
| S7 | net.gw | jump (custodia) | CAIDA, RECHAZO | |
| S8 | jump (mejor puntuado, B.6) | 2.º puente (copia, tope 2) | SALTO_FALLA | |
| S9 | `PAUSADO(SIN_CAMINO)` | — | sale con `camino:estado → LISTO` | cero intentos mientras tanto |

**ACUSE**: como TEXTO con tres diferencias: (a) **vuelve por el carril por el que llegó el mensaje** si sigue `LISTO` (el otro está
escuchando ahí ahora); (b) se **junta** con cualquier sobre que salga a ese contacto en los próximos 2 s, y varios acuses en uno;
(c) nunca lleva toque FCM. Resuelve la contradicción de hoy (acuses: buzón antes que Jump; textos: Jump antes que buzón): mismo orden.

**CONTROL**: va por el carril del flujo al que pertenece (señalización de llamada por el de la llamada; oferta de archivo por el del
texto). Saludo y anuncio de relés: por **todos** los carriles listos, con tope (saludo cada `HELLO_MS` 60 s con la app a la vista, se
conserva). «Escribiendo»: solo por carril interactivo listo; nunca se guarda ni se reintenta.

**ARCH_CHICO** (≤ 45 KB): como TEXTO. En S3/S5 con datos: por internet (como hoy; un sobre). M3 (MTU mínima): por GATT igual (cabe).

**ARCH_MEDIANO** (45 KB – 2,3 MB)
| Sit. | 1.º | Alternativas | Causas | Nota |
|---|---|---|---|---|
| S1 | lan | wd → ble.l2 | CAIDA, SIN_AVANCE | |
| S2 | esperar el margen si va a medias; lo nuevo: net (si los dos en Wi-Fi) | ble.l2 → ble.gatt | CAIDA | |
| S3 | **el de menor tiempo estimado** entre net (buzón) y ble.l2 / wd (`bytes / vel` medida con ese contacto) | el siguiente | SIN_AVANCE, CAIDA, MEJOR_ESTABLE (solo antes de empezar o con > 50 % por delante, B.3) | con `M6` decide E1; hoy los dos en Wi-Fi o buzón |
| S4 | ble.l2 (≥ 45 KB) o wd (≥ 100 KB) según velocidad medida hoy (`l2_fast.js:100`, se conserva) | ble.gatt | SIN_AVANCE, OCUPADO no cambia | M3: GATT no arranca > 300 K car. (`BLE_TINY_MTU_DEFER_CHARS`), espera L2/WD/otro hasta 5 min (`MTU_DEFER_MAX_WAIT_MS`) |
| S5 | net (buzón; directo por Tor si `torOk` y > 1 MB) | net.own | RECHAZO → otro relé suyo | |
| S6 | net (buzón) → `GUARDADO` + toque | — | como TEXTO S6 | |
| S7 | net.gw si ≤ ~300 KB; si no `PAUSADO(SIN_CAPACIDAD)` con explicación | jump.wd (parte 4 del puente) | — | |
| S8 | `PAUSADO` (salvo que el puente lo acepte por sus topes) | — | — | |
| S9 | `PAUSADO` | — | — | |

**ARCH_GRANDE** (2,3 – 22 MB): como MEDIANO salvo: S3 y S4 prefieren **wd** (sin datos, rápido) sobre l2; S3 con M6 → E1; S7/S8 → `PAUSADO`.
**ARCH_ENORME** (> 22 MB): solo caminos locales (lan → wd → ble.l2), como hoy (#99: límite de memoria, no de rutas). Lejos: `PAUSADO`
con «se manda cuando estéis cerca o en la misma Wi-Fi». **[DUDA]** E5: ¿por Tor directo?

**LLAMADA_VOZ**
| Sit. | 1.º | Alternativas | Causas | Nota |
|---|---|---|---|---|
| S1 | lan | ble.gatt → net | CAIDA (por trama: `_sendFrame` reelige, `calls.js:155`, se conserva) | Apple «interactive» |
| S3 | ble.gatt si RSSI > −80 | net (p2p > tor > relés) | DEGRADADO_SOSTENIDO, CAIDA | hoy BLE antes que internet en llamadas; sin coste de datos |
| S4 | ble.gatt | — | — | |
| S5 | net (p2p > tor > relés) | — | CAIDA | |
| S6 | toque de llamada (`CALL_WAKE_MIN_MS` 3 s) y luego S5 | — | — | |
| S7–S9 | no se puede (mensaje claro) | — | — | voz por puente: fuera (B.2.9) |

**LLAMADA_VIDEO**: S1 lan; S3 **net (p2p/Tor)** con voz por el mismo — arregla la videollamada rechazada estando cerca por BLE con
datos (`canVideo` solo mira el enlace elegido, `calls.js:163`); con M6 decide E2. S4: solo voz por BLE (vídeo por WD: fuera, B.2.9).
S5: net p2p/Tor; por relés solo audio (`_videoLinkOk`, `calls.js:164-170`, se conserva). S6: toque y S5.

**GRUPO**: cada miembro con su tabla y su calendario `(msgId, miembro)`; ✓✓ del grupo = todos. Lo grande en cola por miembro
(`big_file`, se conserva). Varios miembros que leen en el mismo relé: un sobre por miembro (cada uno cifrado para él), repartidos por el
cupo del relé. Llamada de grupo: cada pata con la tabla de llamada.

**Modificadores**
- `M1`: otro relé **de su lista**; si no queda: S3/S4 → lan/ble; S5/S6 → esperar la menor `esperaMs` con azar. Nunca publicar en un
  relé en pausa (app y nativo). ✓ solo si lo aceptó un relé de su lista (arregla el caso 21:53).
- `M2` (`APP_CALLA`): ese carril `DEGRADADO` 2 min para envíos; toque; alternativa. Reconexión solo con V1 caído (fase 2). Tres
  `APP_CALLA` en 10 min → carril BLE en cuarentena 10 min con ese contacto.
- `M3`: archivos ver MEDIANO S4; textos sin cambio.
- `M4`: solo carriles con `segundoPlano` (A.4.6): `net.relay`, `lan`, `ble.gatt`, `jump` (nativo). `wd` y `ble.l2` esperan a la app.
- `M5`: sin grupo WD preparado, sin arrancar Tor, sondeos al doble de intervalo; los mensajes salen igual.
- `M6`: archivos > `ARCH_CHICO` por internet según E1; llamadas de vídeo según E2. Textos, acuses, notas de voz y fotos chicas: siempre.

#### B.2.4 Causas de cambio (lista cerrada) y lo que NO es causa
| Causa | Definición exacta |
|---|---|
| `CAIDA` | el carril pasó a `MARGEN`/`CAIDO` (evento real V1) |
| `SIN_ACK` | él `APP` (despierto) y sin ✓✓ en `max(3 × p90 del carril con él, 8 s)` (texto) — tope 60 s |
| `SIN_AVANCE` | 60 s sin un byte confirmado en un archivo |
| `RECHAZO` | `LIMITADO`/`CASTIGADO`/`POLITICA` de un relé → **otro relé suyo** (mismo tipo de camino) |
| `RECHAZO_TODOS` | todos los relés de su lista en pausa → otro tipo de camino si es `CERCA` |
| `DEGRADADO_SOSTENIDO` | `camino:calidad → degradado` (ya con histéresis) |
| `MEJOR_ESTABLE` | apareció un carril mejor en la tabla y lleva ≥ 30 s `LISTO` |
| `CAPACIDAD` | el tipo/tamaño no cabe en el carril |
| `COSTE` | cambió la red propia (Wi-Fi ↔ datos) y E1/E2 lo piden |
| `SALTO_FALLA` | el puente no dio `rk` en 20 s o rechazó |
| `RELE_PERDIO`, `LISTA_NUEVA`, `CADUCA` | (solo para lo `GUARDADO`) el relé ya no lo devuelve; él anunció lista sin ese relé; faltan < 24 h para su caducidad |
| `USUARIO` | el usuario lo pidió (p. ej. «reintentar ahora») |

**No son causa**: un pico de RTT; un solo plazo vencido sin `SIN_ACK`; que él duerma; que aparezca un camino sin 30 s de estabilidad;
que el camino esté `OCUPADO`; un relé limitando cuando hay otro suyo libre (se cambia de relé, no de camino).

#### B.2.5 Cobertura de la lista consolidada (§7 de la auditoría y ENRUTADO_27-11)
| Condición | Dónde queda |
|---|---|
| Estado y prioridad por contacto, una conexión principal (Briar) | B.1; B.3.5 (soltar BLE solo con el cupo apretado) |
| Subir de camino con cierre ordenado (Nearby) | A.5.3, B.3 |
| Modos handover / interactive / aggregate (Apple) | textos y archivos = handover con `SIN_ACK`/`SIN_AVANCE`; llamadas = interactive (por trama); aggregate **fuera** (B.2.9) |
| Intentos escalonados en paralelo (Happy Eyeballs) | B.3.6: al abrir para llamada o primer envío a alguien `CERCA` |
| Relés de lectura anunciados y publicar en los del otro (NIP-65/17) | B.5.1–B.5.2 |
| Respuestas estándar de relés y «esperar N» | A.6.2 |
| Puntuar relés, relés distintos por contacto | B.5.3 |
| Bandeja por contacto con topes (bitchat) | B.4, adaptado: los topes bajan el ritmo, **no borran** (principio 5) |
| Ruta aprendida + plan B (Meshtastic), copias limitadas (Spray-and-Wait), PRoPHET | B.6 |
| «Dónde encontrarme» al estar cerca (Berty) | B.5.1: el anuncio va también por `lan`/`ble` en el `kx` |
| Vigilar degradación de prioridad FCM | B.5.6 |
| Espera creciente con azar completo (AWS) | B.4.4 |
| Histéresis / estabilidad | B.3 |
| ENRUTADO 27-11: elegir por lugar, cambio solo con causa, un calendario, no republicar lo guardado, cupo, juntar textos, quitar «2 relés con datos», Fénix parado con la app a la vista | B.2, B.2.4, B.4, B.5.4–5, B.5.2, B.4.7 |

#### B.2.9 Lo que se deja fuera de este diseño (no se cierra ningún camino: queda anotado para después)
- **Sumar caminos para un archivo** (aggregate): exige reanudación cruzada entre caminos ya madura; se revisa tras la fase 5.
- **Voz/vídeo por Wi-Fi Direct y voz por puente**: WD hoy no tiene canal de flujo ni funciona sin la app; tras la fase 3 se mide.
- **Wi-Fi Aware y hotspot local** (Nearby los usa): caminos futuros; requieren medir soporte en los teléfonos reales.
- **Inundación en la malla con espera al azar** (bitchat/Meshtastic): el puente de NEXO es por rutas; con copias ≤ 2 basta hasta
  medir la multitud real (EDC). Si la prueba del vagón muestra rutas que caducan antes de usarse, se reconsidera.
- **TTL de saltos según vecinos**: se queda `MAX_HOPS 8` fijo.

### B.3 Anti-oscilación
1. **Histéresis por camino** (A.4.5): bajar con 3 muestras malas, subir con 8 buenas (la del Wi-Fi de hoy, generalizada).
2. **Estabilidad mínima para subir**: `MEJOR_ESTABLE` exige 30 s `LISTO` seguidos.
3. **Permanencia**: tras un cambio voluntario (`MEJOR_ESTABLE`, `COSTE`, `DEGRADADO_SOSTENIDO`), 60 s sin otro voluntario con ese
   contacto y tipo. `CAIDA` siempre se atiende.
4. **Freno de oscilación**: > 4 cambios voluntarios en 10 min con un contacto → `fijadoEn` = el carril con menos fallos en esos 10 min,
   `fijadoHasta` = +10 min; solo `CAIDA` lo rompe; se registra `FIJADO_ANTIOSCILACION`.
5. **Nunca a mitad de un archivo** salvo `CAIDA` o `SIN_AVANCE`. Excepción (subida): si queda > 50 % y > 100 KB (`UPGRADE_MIN_LEFT`,
   se conserva el concepto de `ble_ack.js:134-149`), el nuevo lleva 30 s estable y el tiempo estimado por el nuevo + 5 s es < 50 % del
   que queda por el viejo → cambio ordenado en un borde de trozo con `desde` (A.5.3). Una sola subida por archivo.
   **[RIESGO]** la reanudación entre caminos distintos (de WD a LAN, de L2 a buzón) no existe hoy para todos los pares; hasta que
   exista para un par, ese par no se sube a mitad (se termina por donde va).
6. **Apertura escalonada** (Happy Eyeballs) para llamada o primer envío a alguien `CERCA`: se piden `abrir` en orden de tabla con 250 ms
   entre uno y otro; gana el primero que llega a `LISTO`; los demás se dejan abiertos solo si el cupo lo permite.
7. **Soltar el Bluetooth cuando hay Wi-Fi local** (Briar): solo si el cupo de enlaces BLE está lleno y hace falta sitio para otro
   contacto, y la LAN con ese lleva > 2 min `LISTO` sin transferencias por BLE. PORQUÉ: rehacer un BLE cuesta 2–10 s y el margen del
   Wi-Fi cubre 2–5 s; soltarlo siempre empeoraría los cortes de Wi-Fi. Con cierre ordenado.

### B.4 Un calendario por mensaje

#### B.4.1 Estados (y lo que ve el usuario)
```
CREADO → EN_CAMINO(carril, intento) → GUARDADO(dónde) → ENTREGADO (✓✓) → LEIDO
              ↘ PAUSADO(motivo, hasta?) ↗                ↑ (un acuse V3 cierra desde cualquier estado)
```
| Estado | Usuario ve | Significa |
|---|---|---|
| `CREADO`, `EN_CAMINO`, `PAUSADO` | pendiente (reloj) + motivo en la info del mensaje | nadie lo tiene aún |
| `GUARDADO` | ✓ | un relé **de su lista de lectura** lo aceptó, o un puente dio custodia, o (LAN/BLE) el transporte del otro lado lo recibió y falta V3 |
| `ENTREGADO` | ✓✓ | su teléfono lo tiene (V3) |
| `LEIDO` | leído | |

`PAUSADO` lleva motivo de lista cerrada: `SIN_CAMINO`, `LIMITADO(hasta)`, `ESPERA_WIFI` (E1), `SIN_CAPACIDAD`, `CUPO`.
Un texto **nunca** pasa a «fallido»: el único fin sin ✓✓ es que el usuario lo borre o bloquee al contacto. **[DUDA]** E6 (qué mostrar
tras días sin ✓✓).

#### B.4.2 Registro (persistido en el vault y espejado en `ruta_plan.json` para el nativo)
```
{ msgId, nx, grupoId?, tipo, bytes, prioridad, creadoAt, estado, motivo?,
  intentos: [ {carril, at, resultado:'aceptado'|ErrorCamino, rele?, bytesConfirmados?} ],
  guardadoEn: [ {tipo:'rele', url, at} | {tipo:'puente', via, at, venceAt} | {tipo:'transporte', carril, at} ],
  eventoFirmado?: (net) el mismo evento para republicar, cifradoRef (no se re-cifra),
  proximoAt, ejecutor, entregadoAt?, leidoAt?, cambios: [ {de, a, causa, at} ] }
```

#### B.4.3 Quién reintenta y cuándo
- **Solo el calendario** (en el ejecutor con testigo) llama a `enviar`. Un `tick` por evento (no por reloj fijo): `camino:estado`,
  `contacto:visto`, `envio:*`, vencimiento de `proximoAt` (un único temporizador: el `proximoAt` más cercano de todos).
- Por estado:
  - `CREADO` → `elegir()` → `EN_CAMINO` al momento.
  - `EN_CAMINO` sin aceptación: el propio plazo por avance del camino (A.5.2). Al rechazo: según A.6.2.
  - `GUARDADO`: **no se republica**. Toque FCM al entrar si él no está `APP`; luego toques a 2 min, 10 min, 30 min, 2 h (cada uno solo
    si sigue sin ✓✓ y con su tope por par de `net_wake`). Republicar (el **mismo** evento, en otro relé de su lista) solo con
    `RELE_PERDIO`, `LISTA_NUEVA` o `CADUCA`. Por puente: si vence la custodia sin ✓✓ → vuelve a `CREADO`.
  - Si él aparece `APP` por cualquier camino y el mensaje sigue sin ✓✓ tras `SIN_ACK` → un envío por el 1.º de la tabla (idempotente).
  - `PAUSADO(SIN_CAMINO)`: cero intentos; sale con `camino:estado → LISTO` de cualquier carril con ese contacto.
- **Juntar** (fase 1): al salir, los `TEXTO`/`ACUSE` pendientes al mismo contacto y carril en ese `tick` van en un solo sobre hasta
  `MAX_CONTENT` (60 000 car.). **[RIESGO]** cambia el formato en el cable: los dos teléfonos deben tener la versión nueva (permitido:
  la app no está en la tienda y se arregla la última versión, regla del 14-11).

#### B.4.4 Esperas y topes
- Espera tras `FALLO`: azar completo, `espera = random(0, min(techo, base · 2^n))`; base 2 s (texto), 15 s (archivo); techo 10 min;
  `n` = fallos seguidos de ese mensaje en ese carril.
- Topes (bajan el ritmo, no borran): ≤ 3 intentos por mensaje y carril por hora; superado → modo lento (un intento cada 30 min o con un
  evento de `LISTO`/`contacto:visto`). ≤ 6 sobres por minuto a un mismo contacto (textos juntados). Cupo por relé compartido app/nativo.
- Archivos: sin tope de duración mientras avanza (se quita el de 2 h, `NET_FILE_AUTORETRY_BUDGET_MS` `ble_ack_shared.js:80`, ya pasado
  a «sin avance» en la 3356); reanudación desde el último trozo confirmado.

#### B.4.5 Los 14 mecanismos de hoy → qué pasan a ser
| Hoy | Pasa a |
|---|---|
| 1 acuse corto 5× | retransmisión **dentro** del camino (A.5.2), limitada por `SIN_AVANCE` |
| 2 ventanas de `ChatStream` 8× y 8 modos de espera (`chat_stream.js:637`) | dentro del camino para lan/ble; **por internet desaparecen** (un `OK` del relé = aceptado) |
| 3 `_resendPendingMessages` (28 sitios, p. ej. `ble_links.js:95/157`, `render.js:936`) | `calendario.avisar('contacto_visto'|'camino_listo', nx)` |
| 4 red de seguridad +10 s (`ble_send.js:409`) | se quita: lo cubre `SIN_ACK` |
| 5 toques | paso del estado `GUARDADO` (B.4.3) |
| 6 acuses | `ACUSE` con su tabla y su juntado |
| 7 reanudación (`ble_ack_resume.js`) | `enviar` con `desde`; decide el calendario |
| 8 bandeja nativa (`NetOutbox.kt`, `OutboxBle.kt`) | ejecutor nativo del calendario (A.7.3) |
| 9 puente (5 reintentos por paquete) | `GUARDADO(puente)`/`SALTO_FALLA` (B.6) |
| 10 búsqueda de camino (re-búsqueda BLE) | `abrir()` pedido por el calendario solo si hay algo pendiente con ese contacto |
| 11 bajadas del buzón | lado receptor: fuera del calendario de envío (sigue igual) |
| 12 `resync` (`net_relays.js:274`) | lado receptor: «pedir lo reciente» con UN freno; el emisor no lo dispara por sus propios envíos |
| 13 outbox JS (`ble_outbox.js:70-109`) | se funde en el espejo del calendario hacia el nativo |
| 14 reconexión | del camino (`camino:estado`), no reenvía nada por sí misma |
Además, las dos definiciones de «reenviable» (`_isResendable` `ble_helpers.js:692` y `vaultGetPendingMessages`) pasan a UNA:
«estado ∉ {ENTREGADO, LEIDO} y no borrado».

#### B.4.6 Lo que se mide del calendario
Por mensaje: sobres/escrituras que gastó, cambios con causa, tiempo hasta ✓ y ✓✓. Por día: mediana y p90 de cada uno.

#### B.4.7 Fénix (respaldo de archivos de la app oculta)
Fénix es un usuario más del calendario con prioridad `fondo`: con la app a la vista **no ejecuta** (cualquier camino); arranca al
ocultarse, se para al volver (ampliar `_bgShouldYieldNet`, `chat_stream.js:491`, que hoy solo cede con relés limitando o a la vista
por internet).

### B.5 Internet: relés (modelo NIP-65/NIP-17 adaptado)

1. **Anunciar dónde leo.** Cada teléfono mantiene `misLecturas` (los relés que escucha de verdad, app y nativo la misma lista, hasta 8).
   Se anuncia **cifrado al contacto** (no en un evento público: NIP-65 público ataría la clave a los relés; NEXO usa claves por par) en:
   el saludo por internet, el `kx` por `lan`/`ble` (como Berty: al estar cerca te digo dónde encontrarme), y el toque cuando cambia.
   Lleva `at` y caduca a las 24 h; si cambia, se reanuncia en ≤ 60 s. **[DUDA de seguridad]** E7.
2. **Publicar donde el otro lee.** Destinos = `leeEn(él)` ∩ los que puedo abrir sin pausa, ordenados por puntuación; objetivo 2
   aceptados (`OK`) para dar ✓; si solo 1 está disponible, 1. Sin anuncio vigente: `DEFAULT_RELAYS` ∪ su último anuncio conocido.
   **✓ solo si lo aceptó uno de su lista** (caso 21:53). Las reservas propias sirven para **leer**, no para darle ✓ a lo que él no lee.
3. **Puntuar relés** (por relé, para todos los contactos): aceptación (% `OK`), tiempo hasta `OK`, «llegó» (% de mensajes publicados ahí
   que terminaron en ✓✓ sin republicar), castigos en 24 h. Sirve para ordenar destinos y elegir reservas.
4. **Cupo por relé** (por mi IP, compartido app/nativo): cubeta de sobres/min por relé. Se conserva el de hoy (`_quotaWait`,
   `net_publish.js:74`: 600 pesados/min; tras un límite 30) y se añade: tras un `LIMITADO`, la tasa de ese relé baja a la mitad 1 h
   (aumenta despacio después). Lo pesado se reparte; un texto no espera si hay otro relé suyo con cupo.
5. **Escucha**: todos los abiertos (se quita definitivamente `CELL_READ_RELAYS = 2` del nativo, `NetBg.kt:119`; la app ya está en 99).
   Luego medir datos y bajar repetidos (no cerrar puertas, ENRUTADO §5).
6. **Toque FCM**: lo pide el calendario. Vigilar `getPriority()` vs `getOriginalPriority()` en el que recibe y devolver en el saludo
   «mis toques llegan degradados»; si es así, el que envía solo toca para llamadas y para el primer mensaje pendiente (no para cada uno).
7. **Tor directo** (`net.tor`): carril propio con `LISTO` = `torOk`; preferido para vídeo y archivos medianos/grandes lejos si está
   listo; no se arranca solo con M5. Uso automático: E3.
8. **Internet por puente** (`net.gw`): carril con capacidades recortadas; topes del puente se conservan.
9. **Relé de NEXO** (`net.own`): carril con las mismas reglas (hoy `OWN_RELAYS` vacío; su organización es aparte, domingo 29-11).

### B.6 Puente (Jump): siguiente teléfono, plan B, custodia
- **Candidatos**: vecinos `LISTO` con ruta vigente al destino, más vecinos con internet propio (que lo llevan por `net`).
- **Puntuación** `s = 0,4·calidadPrimerSalto + 0,3·probEncuentro + 0,2·(1/saltos) + 0,1·(1 − cargaAnunciada)`.
  `calidadPrimerSalto` de `MedidasCamino` del vecino; `probEncuentro` tipo PRoPHET: sube a cada encuentro del vecino con el destino
  (`p ← p + (1−p)·0,75`), baja con el tiempo (`p ← p·0,98` por hora), se intercambia con las rutas. Los pesos son de partida y se
  ajustan tras medir en la multitud. **[DUDA]** con pocos teléfonos no habrá datos; hasta entonces equivale a «menos saltos y mejor enlace».
- **Plan B**: sin `rk` en 20 s o rechazo → siguiente candidato (`SALTO_FALLA`). Tope de **2 copias** por mensaje en puentes distintos
  (Spray-and-Wait). Sin candidatos → `PAUSADO(SIN_CAMINO)`.
- **Custodia**: `rk` = `GUARDADO(puente, venceAt)` y ✓. El que envía **no olvida**: si antes de `venceAt` aparece un camino directo al
  destino, manda una vez (idempotente); si vence sin ✓✓, vuelve a `CREADO`.
- **Paridad**: el nativo da la misma custodia que la app (hoy 10 min sin custodia, `OutboxBle.kt:46`), persistida, con los mismos
  topes del puente (cuánto y cuánto tiempo: E4).

### B.7 Observabilidad
Cada decisión de `elegir()` y cada cambio del calendario deja UNA línea (con tope de 1 por mensaje y segundo, y resumen por minuto si hay ráfaga):
```
[RUTA] nx=nx1e29ab2f msg=ab12 tipo=TEXTO sit=S5 elegí=net.relay(nos.lol,primal) alt=net.tor porque=RELES_DEL_OTRO datos=leeEn=4,pausa=damus
[RUTA] nx=… msg=… cambio net.relay→ble.gatt porque=RECHAZO_TODOS datos=esperaMin=40s
```
Motivos (lista cerrada): `UNICO_DISPONIBLE`, `MISMA_WIFI`, `CERCA_CON_INTERNET`, `CERCA_SIN_INTERNET`, `LEJOS_INTERNET`, `RELES_DEL_OTRO`,
`MEJOR_TIEMPO_MEDIDO`, `CAPACIDAD_TAMANO`, `CAPACIDAD_VIDEO`, `COSTE_DATOS`, `SOLO_SEGUNDO_PLANO`, `PUENTE_MEJOR_PUNTUADO`,
`FIJADO_ANTIOSCILACION`, `ESPERA_SIN_CAMINO`, `USUARIO`, más las causas de cambio de B.2.4. Contadores en el diagnóstico: envíos por
mensaje, cambios por causa, `DESCONOCIDO`s, sobres a relés en pausa (debe ser 0). Una regla de `autodiag`: «cambio sin causa» = fallo.

---

## C. MATRIZ DE ESCENARIOS (`tests/sim`)

Banco nuevo `tests/sim/mundo/`: reloj simulado, N teléfonos con `ContactoRuta`, carriles falsos que cumplen el contrato (con fallos
inyectables: caída, pérdida %, MTU, ocupado, sin avance), los relés Nostr simulados que ya existen (`tests/sim/nostr_relay`), y un
«nativo» simulado como segundo ejecutor con testigo. Cada escenario mide siempre: **envíos por mensaje**, **cambios de camino con causa**,
**tiempo hasta ✓✓**, **duplicados vistos por el receptor** (debe ser 0) y **sobres a relés en pausa** (debe ser 0).
**[RIESGO]** la radio real no se simula: 13, 14, 17, 18 piden además prueba física (se le dejarán al dueño).

| # | Escenario | Esperado | Se mide (umbral) |
|---|---|---|---|
| 1 | Misma Wi-Fi, texto | lan, 1 envío | ✓✓ < 1 s; 0 cambios |
| 2 | Misma Wi-Fi, corte de 3 s del router con BLE listo | lo nuevo por BLE durante el margen; vuelve a lan tras 30 s estable | cambios = 2 (`CAIDA`, `MEJOR_ESTABLE`); 0 duplicados |
| 3 | Misma Wi-Fi, sale de casa (corte largo) | margen → `CAIDO` → net; lugar pasa a CERCA/LEJOS | 1 cambio `CAIDA`; ✓✓ < margen + 5 s |
| 4 | Wi-Fi que parpadea (RTT 1,5 s cada 10 s) | no oscila; aparece `FIJADO_ANTIOSCILACION` | ≤ 4 cambios en 10 min |
| 5 | Lejos, los dos con internet, despierto | relés de su lista | sobres/mensaje ≤ 2; ✓ solo tras `OK` de uno suyo; ✓✓ p90 < 10 s |
| 6 | **Caso 21:53**: mis relés de siempre limitando, él lee sus 4, mis reservas abiertas | no da ✓ por reservas que él no lee; publica en los suyos al vencer la pausa | 0 ✓ falsos; llega |
| 7 | Relé castiga por IP con la app oculta | el nativo respeta la pausa compartida | 0 sobres al castigado (app + nativo) |
| 8 | Contacto dormido | 1 publicación + toques 0/2/10 min; 0 republicaciones en 30 min | sobres/mensaje = copias iniciales; ✓✓ < 5 s tras abrir él la app |
| 9 | **Caso 23:33**: 2 textos pendientes, volver a la app 8 veces | se juntan; nada se republica | ≤ 2 sobres en total (vs ~70 hoy) |
| 10 | Ráfaga de 30 textos a uno lejano | juntado y cupo | 0 `rate-limited`; sobres/min ≤ cupo |
| 11 | Cerca, BLE listo, los dos con datos, relés caen | net; `RECHAZO_TODOS` → BLE | cambio en < 3 s; llega |
| 12 | Llamada cerca con datos sin Wi-Fi común; luego vídeo | voz BLE; vídeo por net (p2p/Tor) — sin rechazo | 0 «hace falta Wi-Fi»; según E2 |
| 13 | Vagón sin internet, 9 contactos cerca (cupo 7 enlaces) | rotación de enlaces sin pérdida | todos ✓✓; p90 < 30 s |
| 14 | Multitud EDC: 20 cerca, archivo 5 MB a uno, otro a la vez | wd; el 2.º recibe `OCUPADO`, sin castigo | 2 transferencias completas; 0 castigos 10 min |
| 15 | Entra a la misma Wi-Fi a mitad de 10 MB por WD (60 % hecho) | sigue por WD (queda < 50 %) | 0 cambios |
| 16 | Igual con 20 % hecho, por internet con datos | subida ordenada a lan en borde de trozo | 1 cambio `MEJOR_ESTABLE`; bytes repetidos ≤ 1 trozo |
| 17 | BLE zombi (V1 vivo, app del otro calla) | `APP_CALLA`: no reconecta; toque + net | ≤ 1 reconexión en 10 min (hoy cada ~30 s); 0 pérdidas |
| 18 | BLE medio muerto (30 % de escrituras fallan) | `DEGRADADO`; textos siguen; archivo a otro carril | 1 cambio `DEGRADADO_SOSTENIDO` |
| 19 | MTU 23 | textos ok; archivo 1 MB no arranca por GATT; L2 si hay; si no, espera ≤ 5 min y GATT | 0 cortes a mitad |
| 20 | App oculta: texto a lejano; vuelve la app | el nativo lo publicó según plan; la app une el diario | 0 republicaciones al volver |
| 21 | Se oculta la app a mitad de un envío por internet | testigo pasa al nativo | 1 solo ejecutor; 0 duplicados |
| 22 | Grupo de 5: 2 misma Wi-Fi, 1 cerca sin internet, 2 lejos (1 dormido) | cada uno por su camino; toque al dormido | envíos = 1 por miembro; ✓✓ grupo al último |
| 23 | Puente A→B→C, B pierde a C; existe D con ruta | plan B por D; custodia | ✓ en A tras `rk`; ≤ 2 copias; 0 ráfagas de 5 reintentos |
| 24 | Yo sin internet, vecino con internet | texto y foto 200 KB por `net.gw`; archivo 3 MB `PAUSADO(SIN_CAPACIDAD)` con motivo | motivo visible; 0 intentos inútiles |
| 25 | Puente con la app del puente dormida | custodia nativa igual que la app (E4) | sobrevive a reinicio del nativo |
| 26 | Sin ningún camino 2 h; luego aparece BLE | `PAUSADO(SIN_CAMINO)` | 0 intentos en 2 h; sale < 2 s tras `LISTO` |
| 27 | Lejos, videollamada con Tor listo; Tor cae | vídeo por Tor; al caer, solo audio por relés | cambio `CAIDA`; aviso al usuario |
| 28 | Desfase de cifrado en LAN | `CIFRADO_DESFASE` → recomprobar; lo nuevo por otro 15 s (3069) | 0 mensajes descartados |
| 29 | Relé contesta `blocked: policy` | fuera 6 h para publicar; no cuenta como fallo del contacto | `MedidasCamino.fallos` sin cambio |
| 30 | Archivo 20 MB por internet a 50 KB/s que avanza; luego 70 s parado | no se corta mientras avanza; `SIN_AVANCE` a los 60 s; reanuda desde el trozo | 0 reinicios desde cero |
| 31 | Toques FCM degradados en el receptor | se detecta y se anuncia; solo llamadas y primer pendiente tocan | toques/mensaje ≤ 1 |
| 32 | Contacto nuevo sin anuncio de relés | `DEFAULT_RELAYS`; al llegar el anuncio, solo los suyos | sobres a relés que no lee → 0 tras el anuncio |
| 33 | Él anuncia lista nueva sin el relé donde quedó GUARDADO | republica el MISMO evento en uno suyo (`LISTA_NUEVA`) | 1 republicación; el relé viejo ve `duplicate` si lo recibe |
| 34 | Llamada en curso por Wi-Fi y cae la Wi-Fi | por trama a BLE/net (se conserva `_sendFrame`) | corte de audio < 2 s |
| 35 | Ráfaga de cambios de red propia (Wi-Fi ↔ datos cada 20 s) | `NET_CHANGE_SETTLE_MS` y permanencia 60 s | ≤ 1 cambio `COSTE` por minuto |

---

## D. Conservar, quitar y orden de migración

### D.1 Se conserva (funciona; se envuelve en el contrato)
Latido y corte nativos del Wi-Fi (`LanHub.kt`), comprobación cifrada y `recheck` 3069 (`lan.js:162-170`), margen adaptativo
(`_graceMs`), histéresis 3/8 (`lan.js:44-45`); pausas por tipo de rechazo y cupo (`net_publish.js:15/74/96`, `relelimita.js`);
«lo guardado no se republica» (`_netWindowStored`, `chat_stream.js:527`) que pasa a ser `GUARDADO`; reanudación del buzón
(`blob_mailbox.js`, 3356); detección de relé muerto y flapeo (`net_relays.js`); HalfOpenPolicy y ServerFlapPolicy (Kotlin); cupo de
enlaces BLE (`ble_linkmgr.js`); rutas Jump con `MAX_HOPS`/`ROUTE_TTL_MS` y custodia `rk`; topes del puente (`gw_link.js`, `GwServe.kt`);
esperas de `NetOutbox.kt` (con azar añadido); topes de toque (`net_wake`); concepto de subida a mitad (`UPGRADE_*`); elección L2 vs WD por
velocidad medida (`l2_fast.js:100`); conmutación por trama de llamadas (`_sendFrame`); cola por miembro de `big_file`; códigos de error
de WD (`wifi_direct.js:88-137`); medidas de `usage_stats.js` (pasan a alimentar `MedidasCamino`).

### D.2 Se quita al terminar (cada cosa en la fase que la sustituye, no antes ni después)
| Qué | Fase |
|---|---|
| `CELL_READ_RELAYS = 2` del nativo (`NetBg.kt:119`) y la escucha distinta app/nativo | 1 |
| La red de seguridad +10 s por internet (`ble_send.js:409`) y las ventanas ×8 de `ChatStream` por internet | 1 |
| Re-cifrar en cada reintento por internet (pasa a republicar el mismo evento) | 1 |
| Las 3 reglas de «volver a pedir lo reciente» y los 2 frenos de lo pesado que se pisan (`net_relays.js`) | 1 |
| 4 de los 5 registros de estado BLE, `_supervisorStates`/ZOMBIE como disparador de reconexión, el reconector JS que pisa al nativo, la familia «sin comprobar» | 2 |
| `busy` global y castigo de 10 min de WD; grupo por envío; plazos fijos al recibir | 3 |
| La política dentro de `lan.canReach` | 4 |
| `preferNet` (5 llamadas sin efecto desde la 3079), el orden fijo de `_resolveDeviceIdForNexoId` (`ble_startup.js:99-155`), la política en `net.canReach`/`filesOk`, los órdenes propios de `calls._link`, `ble_ack_files`, `big_file`, `ble_relay.js:234` | 5 |
| Las 28 llamadas a `_resendPendingMessages`, `_isResendable` duplicado, `ble_outbox.js` como mecanismo aparte, los 5 reintentos del puente | 1 (internet) y 5 (resto) |
| Código muerto: `mesh_relay_bridge.js`, `web_socket_client.js` (633 líneas sin importar) | 1 (barato, sin riesgo) |
| Constantes de `ble_ack_shared.js` que queden sin uso (hoy 58) | cada fase |

### D.3 Orden de migración y lo que cada fase debe cumplir para pasar a la siguiente
Arreglos sueltos que no dependen del rediseño (auditoría §9) pueden ir en cualquier APK: `_lastPongTime`, nativo que ignora el castigo,
plazo fijo de 120 s de WD, videollamada cerca con datos.

**Fase 0 — este documento** + `PLAN_BLUETOOTH_28-11.md`. Pasa con: el dueño lo revisa y contesta E.

**Fase 1 — núcleo mínimo + internet.**
- 1a. Módulos puros nuevos (`src/core/ruta/`: `contacto_ruta.js`, `elegir.js`, `calendario.js`, `politica_reles.js`, `motivos.js`) +
  banco `tests/sim/mundo/` + vectores JSON compartidos con Kotlin. En la APK, **modo sombra**: `elegir()` y el calendario calculan y
  registran `[RUTA-SOMBRA] elegiría X / se hizo Y` sin mandar nada. PORQUÉ: mide la tabla con el tráfico real antes de darle el mando,
  y enseña qué casos escondidos cubren hoy los 14 mecanismos.
- 1b. Internet cumple el contrato: anuncio de lecturas, publicar donde el otro lee, ✓ solo así, puntuación, pausas y cupo compartidos
  con el nativo, misma escucha, republicar el mismo evento, juntar textos, el calendario manda en lo que sale por internet (app y nativo
  con testigo), avance, plazos por avance.
- **Pasa con**: escenarios 5–10, 20, 21, 26, 29–33, 35 verdes; en teléfonos 48 h sin «banned» y sin `rate-limited` repetido en los
  diagnósticos; sobres por mensaje de mediana ≤ 2; ✓✓ lejos y despierto p90 < 10 s; casos 21:53 y 23:33 reproducidos y resueltos;
  `[RUTA-SOMBRA]` coincide con lo hecho en ≥ 95 % o cada diferencia explicada.
  **[RIESGO]** mientras las fases 2–4 no lleguen, los caminos no migrados entran en `elegir()` por **adaptadores** que traducen su
  estado de hoy al contrato (aproximado). La sombra lo dejará ver; por eso el mando de `elegir()` para todo no llega hasta la fase 5.

**Fase 2 — Bluetooth** (según `PLAN_BLUETOOTH_28-11.md`): un registro de estado con dueño nativo, A.2 completo, `APP_CALLA` sin
reconectar, un reconector con espera creciente y memoria, eventos de avance de L2, cumple el contrato de eventos también con la app dormida.
**Pasa con**: escenarios 13, 17, 18, 19 verdes; prueba física: el zombi de la tablet no aparece en 7 días; reconexiones por contacto
y hora < 3 de mediana.

**Fase 3 — Wi-Fi Direct**: estado por contacto, control por cualquier camino, grupo preparado y reutilizado, varias transferencias,
`OCUPADO` sin castigo, plazos por avance, no tirar la Wi-Fi local en uso, `jump.wd`; textos por WD en la multitud si la prueba lo pide.
**Pasa con**: escenarios 14, 15 y prueba física de vagón con ≥ 3 teléfonos.

**Fase 4 — Wi-Fi local**: valores A.1 explícitos, `APP_CALLA`, avance nativo, sacar la política de `canReach`, soltar BLE solo con cupo
apretado. **Pasa con**: escenarios 1–4, 16, 28, 34.

**Fase 5 — el cambio entre caminos manda**: `elegir()` sale de la sombra para todos los tipos; el calendario es el único que reintenta
(todos los caminos); se quitan los órdenes viejos (D.2). **Pasa con**: la matriz completa verde; en el diagnóstico 0 «cambio sin causa»
y 0 `DESCONOCIDO` sin tipificar en una semana de uso real; envíos por mensaje y ✓✓ iguales o mejores que en la fase 1.

**Riesgos que veo, dichos claro:**
1. El calendario único toca TODO lo que hoy reenvía; quitar un mecanismo puede destapar un caso que solo él cubría. Mitigación: sombra,
   matriz con contadores y quitar cada mecanismo en su fase, no todos juntos.
2. Dos ejecutores (app/nativo) con un archivo compartido: el testigo y el diario solo-añadir deben probarse con cortes a mitad
   (escenarios 20–21, y matar el proceso en la prueba).
3. Las medidas por contacto tardan en llenarse; con pocos mensajes por contacto, la tabla decide casi siempre con los valores de partida.
   No es grave: la tabla por lugar ya es correcta sin medidas; las medidas afinan.
4. La copia Kotlin de lo mecánico puede separarse de JS; los vectores compartidos son obligatorios, no opcionales.
5. El ✓ cambia de significado (solo si lo guardó un relé que el otro lee): habrá más tiempo en «pendiente» con relés limitando. Es lo
   correcto (hoy ese ✓ miente), pero el usuario lo notará.

---

## E. Preguntas para el dueño (solo lo que es suyo)

> **RESPUESTAS DEL DUEÑO (28-11 ~07:30 México) — MANDAN sobre las preferencias de abajo:**
> - **E1:** archivos por datos móviles **sin límite y sin aviso** (como hoy; «debe poder correr bien»). Un ajuste opcional «ahorrar
>   datos», apagado de fábrica, queda para más adelante.
> - **E3 y E5:** **Tor nunca se arranca solo** (es lento). Los archivos grandes a alguien lejos van por **conexión directa WebRTC** (la de
>   las llamadas; PLAN_CAPACIDAD §2); Tor solo si el usuario lo enciende por privacidad o como último recurso si WebRTC no conecta.
> - **E2** (videollamada con datos estando cerca: por internet, aviso la primera vez), **E4** (puente 24 h/20 MB; 72 h en modo
>   concierto), **E6** (aviso discreto a los 3 días sin ✓✓), **E7** (relés anunciados solo cifrado al contacto), **E8** (Wi-Fi Direct
>   preparado con batería > 30 %): **aprobadas como las recomendé**.
> - Del plan de Bluetooth: **9** firmar la prueba de vida: sí · **10** contacto que no contesta: pausas de 2 a 10 min · **11** avisar
>   una vez que el teléfono del otro tiene NEXO dormido · **12** juntar pasos chicos en una APK.

Mientras no conteste, se mantiene lo de hoy (indicado en cada una).

**E1. Archivos por datos móviles.** Hoy un archivo por internet va al buzón aunque alguno esté con datos (hasta ~42 MB); en directo
solo si los dos están en Wi-Fi.
- A — Como hoy: cualquier archivo puede gastar datos. Vives: llega lejos siempre; un vídeo de 20 MB puede gastar 20 MB de datos tuyos
  y otros 20 del otro, de vez en cuando.
- B — Por datos solo hasta 5 MB (fotos, notas de voz, documentos); lo mayor espera Wi-Fi o cercanía (Bluetooth/WD) con aviso «se manda
  al tener Wi-Fi» y un botón «mandar ya con datos». Vives: casi nunca notas nada; un vídeo grande tarda hasta que hay Wi-Fi, salvo que
  pulses el botón (una sola vez).
- Prefiero **B**: el mensaje llega igual (lo chico va siempre) y nadie se lleva un susto de datos; el botón respeta «que llegue manda».

**E2. Videollamada con datos móviles estando cerca.** Hoy se rechaza (fallo) estando cerca por Bluetooth con datos.
- A — Se permite por internet (~5–15 MB por minuto). Vives: la videollamada funciona siempre que haya datos (frecuente).
- B — Se avisa «gastará datos» la primera vez y luego se permite. Vives: una sola vez un aviso.
- Prefiero **B**.

**E3. Tor directo automático** (más rápido para vídeo y archivos lejos; arranca en 10–30 s y gasta algo más de batería).
- A — Automático cuando ya está arriba, sin arrancarlo solo. Vives: nada visible; algunos vídeos y archivos van más rápido.
- B — Arrancarlo solo para videollamadas y archivos > 5 MB lejos. Vives: unos segundos más al empezar una videollamada lejana; algo de batería.
- Prefiero **A** ahora y B tras medir en la fase 1.

**E4. Cuánto guarda un puente para otros** (custodia: hoy 24 h en la app y 10 min sin custodia en el nativo).
- A — 24 h y hasta 20 MB por teléfono ajeno, igual con la app dormida. Vives: tu teléfono guarda mensajes cifrados de otros un día; casi
  no gasta.
- B — 72 h y 50 MB (pensando en EDC: gente que se reencuentra al día siguiente). Vives: más espacio ocupado de vez en cuando; más
  mensajes que llegan días después.
- Prefiero **A** de base con B en el «modo concierto».

**E5. Archivos > 22 MB lejos**: hoy solo cerca. ¿Por Tor directo con los dos en Wi-Fi? A — sí (llega lejos, tarda y gasta batería, una
vez de vez en cuando); B — solo cerca como hoy. Prefiero **A** después de la fase 1, si la medida de Tor lo aguanta.

**E6. Qué ve el usuario tras días sin ✓✓** (el texto nunca se da por fallido).
- A — Sigue en pendiente con «guardado, esperando a que se conecte» en la info. Vives: nada que hacer.
- B — A los 3 días, un aviso discreto «X no se conecta desde hace 3 días». Vives: una vez por contacto perdido.
- Prefiero **B**.

**E7. Anunciar al contacto en qué relés leo** (seguridad: es tuyo).
- A — Solo cifrado al contacto (saludo/`kx`). Vives: nada; tus contactos saben qué relés usas (ya casi lo saben hoy).
- B — Además un evento público tipo NIP-65. Vives: contactos nuevos te encuentran antes, pero cualquiera puede ver qué relés usa esa
  clave. Prefiero **A** (NEXO usa claves por par: B rompería esa separación).

**E8. Wi-Fi Direct «preparado» en la multitud** (fase 3): A — grupo listo mientras haya contactos cerca con algo pendiente (archivos
salen al momento; algo de batería y Android puede mostrar el Wi-Fi Direct activo, frecuente en EDC); B — bajo demanda (3–10 s de espera
por archivo; menos batería). Prefiero **A** con batería > 30 % y B por debajo.
