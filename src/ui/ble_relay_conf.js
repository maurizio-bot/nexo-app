// Constantes de la malla Jump (ble_relay.js), aparte para que ble_relay.js no pase de 1.000 líneas (23-11).
export var MAX_HOPS = 8;
export var AD_INTERVAL_MS = 30000;
export var ROUTE_TTL_MS = 95000;
export var QUEUE_FILE = 'nexo_relay_queue.json';
export var QUEUE_MAX_AGE_MS = 86400000;
export var HOP_FAIL_BASE_MS = 15000, HOP_FAIL_MAX_MS = 600000; // 3058: espera tras no poder reenviar por un camino (15 s, 30 s…); 3127: tope 10 min (antes 2)
// 3127 (diagnóstico S24 3067 15-11: un texto suyo por un puente con la app dormida se reintentaba cada 2 min desde la noche anterior, ~10 h):
// cuanto más falla un camino, más se espera, hasta 10 min; vuelve a 15 s en cuanto ese camino entrega algo.
export function _hopFailWaitMs(n) { return Math.min(HOP_FAIL_MAX_MS, HOP_FAIL_BASE_MS * Math.pow(2, Math.max(0, (n || 1) - 1))); }
export var QUEUE_MAX = 200;
export var HOP_MAX_PAR = 6; // 3239: como mucho 6 paquetes con confirmación a la vez hacia el mismo siguiente teléfono
export var QUEUE_MAX_BYTES = 30000000; // lo guardado de paso para otros (fotos, textos largos) no pasa de ~30 MB
export var SEEN_TTL_MS = 3600000;
// Auditoría 23-11 (T-J1): topes de la malla. Alguien cerca podía mandar 'rq' sin fin (cada uno se reparte a todos los vecinos y
// escanea), con un ttl enorme o un hp negativo (saltos sin fin), llenar la cola del puente él solo (200 paquetes / 30 MB para todos)
// y hacer crecer `seen` sin límite. Con estos topes un vecino o un origen solo se estorba a sí mismo.
export var SEEN_MAX = 5000;                       // ids recordados (el más viejo sale)
export var RQ_PER_LINK_MIN = 30;                  // búsquedas ('rq') por minuto que se atienden de un mismo enlace (una normal: 1–3)
export var QUEUE_PER_SOURCE = 50;                 // paquetes de paso en la cola por vecino que los trajo y por origen (de 200)
export var QUEUE_BYTES_PER_SOURCE = 10000000;     // … y bytes (de 30 MB)
export var NEARBY_TTL_MS = 120000;       // un NEXO visto al escanear cuenta como cercano 2 min
export var NEARBY_FRESH_MS = 30000;      // para decir "llego a X" o ir directo hay que haberlo visto hace <30 s
export var DISCOVER_THROTTLE_MS = 45000; // como mucho una búsqueda de camino por destino cada 45 s
export var DISCOVER_WAIT_MS = 60000;     // una búsqueda vale 60 s
export var SCAN_FRESH_MS = 30000;        // si se escaneó hace menos, no se vuelve a escanear para buscar camino
export var SCAN_MS = 6500;
export var MAX_TRANSIENT = 3;            // conexiones a la vez con teléfonos que no son contactos
// 3024 (diagnóstico del vivo 12-11 07:12: intentaba conectar «de paso» cada minuto con un NEXO a −92/−95 dBm que nunca
// conectaba): para buscar puentes Jump no se conecta de paso con NADIE (conocido o desconocido) con señal de −90 o peor, y al que
// no llega a conectar se le espera cada vez más (1, 2, 4… hasta 15 min). Así la radio queda para los cercanos que sí sirven.
export var PASS_MIN_RSSI = -90, PASS_FAIL_BASE_MS = 60000, PASS_FAIL_MAX_MS = 15 * 60000, PASS_RETRY_WINDOW_MS = 120000;
export var MAX_TRANSIENT_ADD = 6;        // 3012: con «Agregar» abierto (el usuario está esperando ver a alguien): más a la vez
export var BLE_LINKS_BUDGET = 7;         // 3012: conexiones Bluetooth que se dan por seguras a la vez (contactos + de paso)
export var ANON_NO_ANSWER_MS = 4500;     // 3012: un anónimo al que se le preguntó quién es y no contesta en este rato (app dormida) suelta su hueco
export var ANON_KNOWN_HOLD_MS = 700;     // 3012: con «Agregar» abierto y sin hueco, uno que YA dijo quién es suelta su conexión de paso tras este rato
export var PROBE_MARK_MS = 5 * 60 * 1000; // 3332: una dirección que sondeé «de paso» se recuerda como sondeo este rato (aunque se identifique por el nativo)
export var ANON_KNOWN_MS = 15 * 60 * 1000; // 3303: una dirección que ya dijo quién es no se vuelve a sondear «de paso» en 15 min (Android cambia de dirección cada ~15 min)
export var TRANSIENT_IDLE_MS = 60000;
// #dueño 02-11 (D1): un connect por nx a la vez dentro de esta ventana. Antes, en cada tick de re-búsqueda se llamaba
// connectToDevice ~12 veces en 1 ms para el MISMO contacto (tormenta «[JUMP] Conectando con»): el guard de 15 s solo
// cubría los NO-contactos (transient). Pasada la ventana, si sigue sin conectar, se reintenta.
export var CONNECT_DEDUP_MS = 15000;
export var LOW_BATTERY_PCT = 15;
// P7 (dueño 01-11): en AHORRO DE ENERGÍA el usuario quiere conservar, así que se exige la batería más holgada para hacer
// de puente — pero NO se deja de hacer de puente con la batería alta (en el diagnóstico se cortaba al 82 % «, ahorro»,
// rompiendo una ruta a mitad de la videollamada). Antes: cualquier modo-ahorro paraba el puente a cualquier nivel.
export var LOW_BATTERY_PCT_SAVER = 30;
export var DEFAULT_HOP_BPS = 4400;       // velocidad útil medida en los teléfonos del dueño (2695), por salto
