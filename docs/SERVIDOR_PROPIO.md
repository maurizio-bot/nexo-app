# Relé propio de NEXO (servidor Nostr de pago) — qué tiene que aceptar

Decisión del dueño (16-11): NEXO tendrá **su propio servidor de relé** (un servidor alquilado con un relé Nostr, *strfry*, detrás
de TLS) para que mensajes y archivos vayan tan rápido como en WhatsApp. Los relés públicos quedan solo de respaldo.

**Estado (build 3151):** la app ya está lista, el servidor aún no existe. `OWN_RELAYS` (en `src/net/net_link_shared.js`) está
**vacío**: la app hace exactamente lo de siempre. Para encenderlo basta con poner la dirección, por ejemplo
`var OWN_RELAYS = ['wss://relay.tu-dominio.com'];`, y sacar una APK. No hace falta tocar nada en Kotlin: la escucha en segundo
plano (NetBg) recibe la lista de relés desde la app, con el propio primero.

Este documento es público: no lleva claves, contraseñas ni direcciones privadas.

## 1. Dirección (URL)

- Formato: **`wss://<dominio>`** (o `wss://<dominio>/<ruta>` si el proxy lo sirve en una ruta). Puerto 443 recomendado (el que
  menos bloquean las redes móviles y los Wi-Fi públicos).
- **TLS obligatorio.** La app rechaza `ws://` a cualquier host que no sea `localhost` (F9, auditoría 2774: por un relé en claro un
  espía vería las etiquetas de la suscripción). Lo normal: strfry escuchando en `127.0.0.1:7777` y nginx o Caddy delante con el
  certificado (Let's Encrypt) pasando el WebSocket.
- Se pueden poner varios (`OWN_RELAYS` es una lista); todos se tratan como «propios».

## 2. Eventos que publica NEXO

Cada evento lo firma una **clave al azar de un solo uso** (salvo los trozos de un mismo archivo, que comparten la clave de ese
archivo): el relé no puede saber qué teléfono lo mandó. Por eso **no sirve limitar ni filtrar por `pubkey`**; los límites tienen que
ir por IP o por conexión.

| kind | Para qué | Etiquetas (exactas) | Contenido | Caducidad (NIP-40) |
|---|---|---|---|---|
| **1059** | Todo lo que va entre dos contactos: textos, saludos «estoy en línea», confirmaciones ✓✓, punteros a archivos, trozos de archivos en vivo, partes de llamada; también solicitudes de contacto («Agregar por NEXO ID») y lo que manda la escucha nativa en segundo plano | `["p", <64 hex>]` y `["expiration", <segundos>]` | base64 cifrado, **≤ 60 000** caracteres | saludo 10 min · parte de llamada 2 min · trozo en vivo 1 día · texto / confirmación / solicitud 7 días |
| **1064** | Trozo del buzón de archivos (archivo cifrado en trozos de 40 KB; se baja por su id) | solo `["expiration", <segundos>]` (sin `p`) | base64 de 40 960 bytes = **54 616** caracteres (el último, menos) | 7 días (estados: 26 h) |
| **5** | NIP-09: borrar los trozos de un archivo cuando todos lo recibieron (firmado con la clave del archivo) | `["e", <id>]` × hasta **128** (un archivo de 5 MB) | vacío | — |
| **1065** | Canal de diagnósticos cifrados para el desarrollador (`src/ui/diag_channel.js`) | `["t", "nexo-diag-<16 hex>"]` y `["expiration", …]` | base64, ≤ 60 000 | 7 días |
| 22242 | NIP-42 AUTH: solo si el relé manda un reto `AUTH` (no se guarda) | `["relay", url]`, `["challenge", reto]` | vacío | — |

Ningún otro kind. La hora del evento (`created_at`) es la del teléfono.

### Tamaño máximo

El evento más grande es un 1059 o 1065 de 60 000 caracteres: **~60,5 KB** con la envoltura (id, firma, etiquetas), ~60,6 KB como
mensaje WebSocket. Con **64 KB por evento** (`events.maxEventSize = 65536`) alcanza y sobra; el mensaje WebSocket tiene que
admitir al menos eso (`relay.maxWebsocketPayloadSize`). El kind 5 lleva hasta 128 etiquetas (`events.maxNumTags` ≥ 128).

Los trozos del buzón **no se agrandaron** para el relé propio (siguen en 40 KB): un puntero tiene un único tamaño de trozo y, si el
propio cae a mitad de la subida, los trozos que faltan van a los públicos (tope ~64 KB). Además el que recibe mantiene sus techos
anti-DoS (`MAX_CHUNK_BYTES` 64 KB en el puntero, `MAX_RELAY_FRAME` 300 000 caracteres por mensaje del relé).

### Caducidad (NIP-40) y borrado (NIP-09)

- **NIP-40 es obligatorio:** el relé no debe servir eventos caducados y debe borrarlos (es la garantía de limpieza: nada de NEXO
  dura más de 7 días). strfry declara NIP-40 entre los que soporta; comprobarlo en la versión instalada.
- **NIP-09 recomendado:** el kind 5 borra los trozos citados del mismo `pubkey`. Si no se aplica, igual caducan a los 7 días.
- Con relojes de teléfono adelantados, un `events.rejectEventsNewerThanSeconds` muy bajo rechazaría sus eventos: dejarlo en
  15 min o más.

### NIP-42 (AUTH)

**No hace falta.** La app contesta un reto `AUTH` firmando con las claves de sus etiquetas (no con una identidad), así que no sirve
para «solo usuarios de NEXO» y solo añade una ida y vuelta al conectar. Sin AUTH el relé igual solo ve contenido cifrado y
etiquetas que cambian cada día.

## 3. Lo que la app pide al relé (lecturas)

| Pedido | Filtro | Cuándo |
|---|---|---|
| Buzón | `{"kinds":[1059], "#p":[…], "since": <último visto − 10 min>}` | al conectar, al cambiar de contactos y al deslizar para actualizar; `#p` lleva **2 valores por contacto** (hoy y ayer) **+ 2** (solicitudes): 100 contactos = 202 valores |
| Trozos de un archivo | `{"ids":[…]}` con **hasta 16** ids | al bajar un archivo (hasta 3 archivos a la vez) |
| Comprobación | `{"ids":["000…0"], "limit":1}` | el relé tiene que contestar `EOSE`: así se detecta una conexión muerta |
| Diagnósticos | `{"kinds":[1065], "#t":[…], "since":…, "limit":200}` | solo el lector del desarrollador (`tools/diag_reader.cjs`; con el propio activo, añadirlo en `--relays`) |

Por conexión: 1 suscripción del buzón + hasta 3 bajadas por id + 1 comprobación (≤ 5 a la vez; `relay.maxSubsPerConnection`).
Por teléfono: 1 conexión de la app y, con la app en segundo plano, 1 de la escucha nativa.

## 4. Ritmo esperado por usuario

| Qué | Eventos |
|---|---|
| Saludo «en línea» | 1 por contacto al conectar; con la app abierta, **1/min** a cada contacto en línea; al abrir un chat, ≤ 1 cada 20 s por contacto |
| Texto | 1 evento (cifrado ≤ 20 000; uno más largo, trozos de 8 000) + 1–2 confirmaciones del otro (entregado, leído) |
| Archivo ≤ 5 MB (buzón) | ⌈tamaño / 40 KB⌉ eventos 1064 (2 MB = 52), **8 a la vez** hacia el propio + 1 puntero + 1 kind 5 al final |
| Archivo > 5 MB sin Tor | trozos 1059 de 16 KB en ventanas (20 MB ≈ 1 300 eventos) |
| Llamada de voz por relés | **~10 eventos/s por sentido** (paquetes de ~100 ms), caducan a los 2 min |
| Diagnóstico | unos pocos 1065 al día |

Picos por conexión: una llamada (10/s) o la subida de un archivo (8 eventos de ~55 KB en vuelo, varios MB/min). **Límite sugerido
por IP:** ≥ 30 eventos/s con ráfaga de 120 y ≥ 2 MB/s de entrada (más bajo cortaría llamadas y archivos, que es justo lo que limita
a los públicos). Almacenamiento: lo que los usuarios mandan en 7 días como mucho (los archivos se borran al recibirse todos).

## 5. Política de escritura sugerida (strfry `relay.writePolicy.plugin`)

Aceptar **solo** la forma de los eventos de NEXO; rechazar el resto (así el servidor de pago no sirve de relé gratis para otros).
Ejemplo en Node (protocolo de plugins de strfry: una línea JSON por evento en la entrada, una respuesta por línea en la salida).
**No está probado contra strfry en este repositorio**: probarlo en el servidor antes de abrirlo.

```js
#!/usr/bin/env node
// Política de escritura del relé propio de NEXO (docs/SERVIDOR_PROPIO.md).
const rl = require('readline').createInterface({ input: process.stdin });
const DAY = 86400, MAX_TTL = { 1059: 7 * DAY, 1064: 7 * DAY, 1065: 7 * DAY }, HEX = /^[0-9a-f]{64}$/;
const PER_SEC = 30, BURST = 120, buckets = new Map(); // por IP (cada evento lleva una clave al azar: por pubkey no sirve)
function allow(ip) {
  const now = Date.now(), b = buckets.get(ip) || { t: BURST, at: now };
  b.t = Math.min(BURST, b.t + (now - b.at) * PER_SEC / 1000); b.at = now; buckets.set(ip, b);
  if (b.t < 1) return false; b.t -= 1; return true;
}
function why(ev, now) {
  const tags = ev.tags || [], exp = tags.find((t) => t[0] === 'expiration');
  if (typeof ev.content !== 'string' || ev.content.length > 60000) return 'invalid: tamaño';
  if (ev.kind === 1059) { if (tags.length !== 2 || !tags.some((t) => t[0] === 'p' && HEX.test(t[1])) || !exp) return 'invalid: forma'; }
  else if (ev.kind === 1064) { if (tags.length !== 1 || !exp) return 'invalid: forma'; }
  else if (ev.kind === 1065) { if (tags.length !== 2 || !tags.some((t) => t[0] === 't' && /^nexo-diag-[0-9a-f]{16}$/.test(t[1])) || !exp) return 'invalid: forma'; }
  else if (ev.kind === 5) { if (!tags.length || tags.length > 200 || !tags.every((t) => t[0] === 'e' && HEX.test(t[1])) || ev.content) return 'invalid: forma'; }
  else return 'blocked: no es un evento de NEXO';
  if (exp) { const t = Number(exp[1]); if (!(t > now) || t > now + MAX_TTL[ev.kind] + 3600) return 'invalid: caducidad'; }
  return null;
}
rl.on('line', (line) => {
  let req; try { req = JSON.parse(line); } catch (e) { return; }
  const ev = req.event || {}, now = Math.floor(Date.now() / 1000);
  let msg = why(ev, now);
  if (!msg && req.sourceType !== 'Import' && req.sourceType !== 'Stream' && !allow(String(req.sourceInfo || ''))) msg = 'rate-limited: despacio';
  process.stdout.write(JSON.stringify({ id: ev.id, action: msg ? 'reject' : 'accept', msg: msg || '' }) + '\n');
});
```

## 6. Qué hace la app con el relé propio (3151, `src/net/net_own.js`)

- **Conectar:** el propio primero; junto a él quedan **2 públicos** de respaldo (`OWN_PUBLIC_BACKUP`); el resto de los públicos
  pasa a la reserva de 3114 (entran si falta un relé sano).
- **Leer:** con el propio **sano** (abierto y con su suscripción confirmada) se lee de él y de **un** público, el «lector» (el
  primero abierto de la lista: el mismo en los dos teléfonos). Los otros públicos siguen abiertos solo para publicar. Así cada
  evento se baja 2 veces en vez de 4, y el lector cubre a contactos que todavía publican solo en públicos o con su propio caído, y a
  un propio que muere sin cerrar la conexión (los mensajes siguen entrando por el lector mientras se detecta).
- **Publicar:** mensajes y saludos a **todos** los abiertos (propio + públicos). Lo **pesado** (partes de llamada, trozos de un
  archivo en vivo) va **solo al propio** cuando el otro dijo en su saludo que lee del propio (marca `ro` dentro del sobre cifrado);
  si el propio no lo guarda, a todos (y 30 s todo a todos).
- **Buzón de archivos:** cada trozo se sube **solo al propio** (una copia; 8 a la vez) y el propio va primero en el puntero. **No se
  deja copia en un público**: en datos móviles cada copia es pagar el archivo otra vez (sin propio, un archivo de 2 MB son ~11 MB
  subidos) y los públicos, con sus límites de ritmo, son justo la parte lenta. Si el propio no guarda un trozo, ese y los
  siguientes van a los públicos como antes. Si el propio se pierde antes de que el otro baje, la bajada se reintenta (30 s, 2 min,
  8 min, 30 min…) hasta que el propio vuelva o el puntero caduque (7 días): el servidor tiene que **guardar en disco** (strfry usa
  LMDB).
- **Si el propio cae:** al momento se vuelven a suscribir todos los públicos abiertos y se avisa con un saludo a quien me mandaba lo
  pesado solo al propio. Se reintenta como mucho cada **10 s** (`OWN_RETRY_MAX_MS`; si flapea, se aparta 1 min, no 5). Al volver
  sano, se sueltan las suscripciones de los públicos (menos el lector) y se saluda por él a quien se saludó sin él.
- **Diagnóstico:** la línea «bajado de los relés» termina en «relé propio: en uso» o «caído, leo de los públicos».
- Con `OWN_RELAYS` vacío **nada cambia** (y el simulador nunca sale al servidor real: una lista de relés de prueba sin
  `window.NEXO_OWN_RELAYS` es «sin propio»).

### Medido en el simulador (`tests/sim/releprop.js`)

Modelo (supuesto, no medido en servidores reales): 4 públicos que tardan 1,2–4,5 s en abrir, 200 ms de demora, 5 eventos/s por
conexión, 128 KB/s por conexión, uno con NIP-42; el propio: 300 ms en abrir, 40 ms, sin límite de ritmo, 1 MB/s. El mismo
escenario sin propio (contraprueba) y con él:

| (build 3151; dos vueltas dieron lo mismo ± 0,1 s) | Solo públicos | Con propio |
|---|---|---|
| Los dos en línea por internet (desde que abren las apps) | 2,1 s | 1,2 s |
| Texto de A a B (mediana) | 408 ms | 207 ms |
| Archivo de 2 MB | 50,2 s | 7,5 s |
| Subido a los relés (archivo + mensajes) | 10,8 MB | 2,8 MB |
| Eventos repetidos bajados (A + B) | 46 KB | 18 KB |

Con propio: si cae, B lee de todos los públicos en 0,1 s y un texto llega por ellos 0,5 s después de la caída; al volver el
servidor, los dos vuelven a él en ~1 s (como mucho ~10 s: el reintento) y lo siguiente pasa por él.

## 7. Pendiente

- Elegir dominio y servidor; poner la URL en `OWN_RELAYS`; probar la política de escritura en el servidor.
- La escucha nativa en segundo plano (NetBg) se suscribe a todos los relés que le pasa la app (propio + 2 públicos): ahí lo
  repetido sigue siendo ×3 (antes ×4). Si hace falta, aplicarle la misma regla del lector.
- Elegir qué 2 públicos quedan de respaldo (hoy, los dos primeros de `DEFAULT_RELAYS`: relay.damus.io y nos.lol; damus.io
  «se cae sin parar» en los diagnósticos: si sigue así, la reserva lo cubre, pero se puede cambiar el orden).
