import { FILE_CHUNK_SIZE, CHAT_CHUNK_SIZE, FILE_WINDOW_SIZE, CHAT_WINDOW_SIZE, FILE_WINDOW_TIMEOUT_MS, CHAT_WINDOW_TIMEOUT_MS, _isLanDevice, _isNetDevice, LAN_PSEUDO_MTU, LAN_FILE_CHUNK, LAN_CHAT_CHUNK, NET_FILE_CHUNK, NET_CHAT_CHUNK, SMALL_MTU_MIN_CHUNK, FILE_PACING_DELAY_MS, CHAT_PACING_DELAY_MS, GLOBAL_TIMEOUT_MS, INTERACTIVE_MAX_CHARS, MAX_WINDOW_RETRIES, BT_RECHUNK_WRITES, BLE_FILE_MAX_CHARS, TINY_MTU, BLE_TINY_MTU_DEFER_CHARS, MTU_DEFER_MAX_WAIT_MS, _noResumeTx, NET_TOR_PREFER_CHUNKS, FILE_GLOBAL_TIMEOUT_MS, PEER_SAFE_MAX_MS, BULK_PRIO, BULK_YIELD_MAX_MS, BULK_YIELD_STEP_MS, _b64BodyStart, _normMac, _isBusyErr, _busyBackoffMs, _fenixYieldBle, _netFileAutoRetry, NET_FILE_AUTORETRY_BUDGET_MS, _binOk, PROTOCOL_VERSION, _nxOf, _chunkCheck, LINK_DOWN_WAIT_FILE_MS, LINK_DOWN_WAIT_MAX_MS, TEXT_BUSY_GRACE_MS, PEER_SAFE_FIRST_MS, PEER_SAFE_CAP_MS, FENIX_SILENT_RETRIES, BRIDGE_STALL_RETRIES, _normId, BRIDGE_STALL_MS, NET_BIG_MIN_CHUNKS, NET_SILENT_FULL_RETRIES, NET_SILENT_PROBE_MS, SLEEP_FILE_RETRIES, SLEEP_PROBE_MS, SLEEP_PROBE_MAX_MS, NET_SMALL_PROBE_MS, _isFenixTx } from './ble_ack_shared.js';
// ChatStream: un envío troceado en curso (ventanas, reintentos, confirmaciones). Reestructuración 15-11: antes, al final de ble_ack.js.
function ChatStream(ackSystem, deviceId, msgId, content, meta, type) {
  this.ackSystem = ackSystem;
  this.ble = ackSystem.ble;
  this.deviceId = deviceId;
  this.msgId = msgId;
  this.content = content;
  this.meta = meta;
  var isFile = type === 'file';
  this.chunkSize = isFile ? FILE_CHUNK_SIZE : CHAT_CHUNK_SIZE;
  this.windowSize = isFile ? FILE_WINDOW_SIZE : CHAT_WINDOW_SIZE;
  this.windowTimeoutMs = isFile ? FILE_WINDOW_TIMEOUT_MS : CHAT_WINDOW_TIMEOUT_MS;
  // v3.3.0: ajustar al MTU negociado. El nativo escribe trozos de (MTU-13) caracteres, uno cada
  // 40-80 ms; con MTU pequeño un paquete grande ocupa muchas escrituras y la ventana debe ser menor
  // y esperar más (si no, timeouts espurios y la cola nativa de 500 se llena y descarta).
  var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
  // v3.10.0: por Wi-Fi (misma red) trozos grandes: no hay MTU ni escrituras de 20-500 bytes
  if (_isLanDevice(deviceId) || _isNetDevice(deviceId)) mtu = LAN_PSEUDO_MTU;
  // v3.14.0 (ronda 2757): el nativo escribe (MTU - 3) bytes reales por escritura (máx. 512), no MTU - 13 caracteres
  var perWrite = mtu ? Math.min(Math.max(mtu - 3, 20), 512) : 0;
  var overhead = 90; // cabecera JSON de un trozo ('v','t','m','i','n','d')
  if (_isLanDevice(deviceId)) { this.chunkSize = isFile ? LAN_FILE_CHUNK : LAN_CHAT_CHUNK; perWrite = this.chunkSize + overhead; }
  if (_isNetDevice(deviceId)) { this.chunkSize = isFile ? NET_FILE_CHUNK : NET_CHAT_CHUNK; perWrite = this.chunkSize + overhead; }
  // Trozos grandes aunque ocupen 2-3 escrituras (menos paquetes y acks); solo se reducen si un
  // paquete necesitaría más de 3 escrituras (MTU pequeño). Medido: MTU 247 => 18 s/foto con 360
  // frente a 27 s ajustando a una sola escritura.
  if (!perWrite) this.chunkSize = Math.min(this.chunkSize, 200);
  else if (Math.ceil((this.chunkSize + overhead) / perWrite) > 3) this.chunkSize = Math.max(SMALL_MTU_MIN_CHUNK(), 3 * perWrite - overhead);
  this.writesPerPacket = perWrite ? Math.ceil((this.chunkSize + overhead) / perWrite) : 2;
  if (this.writesPerPacket > 2) this.windowSize = Math.min(this.windowSize, 4);
  this.windowTimeoutMs = Math.max(this.windowTimeoutMs, this.windowSize * this.writesPerPacket * 100 + 3000);
  // v3.13.0: en binario caben 4/3 más caracteres de base64 en las mismas escrituras (múltiplo de 4)
  this.bin = isFile && perWrite > 0 && !(meta && meta.dst) && ackSystem.peerBin(deviceId) && !!(this.ble && typeof this.ble._sendBinaryNative === 'function');
  if (this.bin) this.chunkSize = Math.max(60, Math.floor((this.writesPerPacket * perWrite - overhead - 7) * 4 / 3 / 4) * 4);
  if (this.bin) console.log('[BIN] ' + msgId + ' en binario: MTU ' + mtu + ', trozos de ' + this.chunkSize + ' caracteres');
  this.pacingDelayMs = isFile ? FILE_PACING_DELAY_MS : CHAT_PACING_DELAY_MS;
  this.baseTimeoutMs = isFile ? GLOBAL_TIMEOUT_MS : 45000;
  this.type = type || 'chat';
  // #dueño 05-11: un ARCHIVO grande es "bulk" (cede la radio a lo interactivo). Texto, foto, sticker, voz y vídeo-previa
  // son interactivos (tienen prioridad). Umbral por tamaño del contenido.
  this._bulk = (this.type === 'file') && (typeof content === 'string') && content.length > INTERACTIVE_MAX_CHARS;
  this._yieldSince = 0;
  this.chunks = [];
  this.total = 0;
  this.sentMask = [];
  this.ackedMask = [];
  this.windowStart = 0;
  this.resolve = null;
  this.reject = null;
  this.timer = null;
  this.startTime = Date.now();
  this.aborted = false;
  this.windowRetryCount = 0;
  this.maxWindowRetries = MAX_WINDOW_RETRIES;
  this.globalTimeout = null;
  this.globalTimeoutMs = this.baseTimeoutMs;
  // Ronda 2767: marca de este intento en cada trozo ('a'): otro intento del mismo mensaje va cifrado distinto y el
  // receptor no debe mezclar sus trozos
  this.att = (meta && typeof meta._att === 'string' && meta._att) ? meta._att : Math.random().toString(36).substr(2, 3); // 3007: al seguir un envío guardado, la MISMA marca
  this._windowResolve = null;
  this._windowReject = null;
  this._windowStartAtSend = 0;
  this._windowEndAtSend = 0;
  if (isFile) {
    console.log('[ChatStream] MODO ARCHIVO. chunk=' + this.chunkSize + ' window=' + this.windowSize + ' pacing=' + this.pacingDelayMs + 'ms');
  }
}
// v3.10.0: el enlace cambió a mitad (Wi-Fi caído → Bluetooth): los trozos ya están hechos (el receptor espera esos),
// así que se adapta el ritmo: ventana pequeña y esperas largas (un trozo de Wi-Fi son muchas escrituras Bluetooth)
// Ronda 2767: ¿sus trozos son demasiado grandes para ese enlace Bluetooth? (más de 100 escrituras por trozo: con MTU 23,
// un trozo de Wi-Fi tarda más de los 10 s que el nativo del otro espera a completarlo)
ChatStream.prototype.tooBigFor = function(deviceId) {
  if (_isLanDevice(deviceId) || _isNetDevice(deviceId)) return false;
  var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
  var perWrite = mtu ? Math.min(Math.max(mtu - 3, 20), 512) : 20;
  // 3022 (prueba del dueño 12-11: un respaldo de Fénix siguió por Bluetooth con trozos de Wi-Fi de 24 000 letras —~48 escrituras
  // cada uno, por debajo del umbral de 100— y tapó el Bluetooth ~40 s: los textos de los dos lados sin confirmar). Un trozo que
  // necesita más de BT_RECHUNK_WRITES escrituras se rehace a la medida del Bluetooth (entre trozo y trozo pasan los textos).
  return Math.ceil((this.chunkSize + 90) / perWrite) > BT_RECHUNK_WRITES;
};
ChatStream.prototype.useLink = function(deviceId) {
  this.deviceId = deviceId;
  if (_isLanDevice(deviceId) || _isNetDevice(deviceId)) return;
  var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
  var perWrite = mtu ? Math.min(Math.max(mtu - 3, 20), 512) : 20;
  this.writesPerPacket = Math.ceil((this.chunkSize + 90) / perWrite);
  if (this.writesPerPacket > 3) {
    this.windowSize = Math.max(1, Math.min(this.windowSize, Math.floor(300 / this.writesPerPacket) || 1)); // cola nativa: 500
    this.windowTimeoutMs = Math.max(this.windowTimeoutMs, this.windowSize * this.writesPerPacket * 60 + 5000);
  }
  console.log('[ChatStream] ' + this.msgId + ' sigue por Bluetooth: ventana ' + this.windowSize + ', espera ' + this.windowTimeoutMs + ' ms');
};
// #87 (diagnóstico del dueño 28-10): ¿el enlace de este stream está ARRIBA ahora mismo? Si está caído (p. ej. el otro
// teléfono con el GATT roto que se reconecta a cada rato, o el Wi-Fi que parpadea), una ventana que caduca NO es que el
// receptor rechace: es que no hay por dónde. En ese caso no se gasta un reintento del tope (que abortaría el archivo).
// Sesgo seguro: ante la duda devuelve true (cuenta el reintento, como antes); solo devuelve false cuando el enlace se ve
// claramente caído. El límite real sigue siendo el timeout global (60 s sin ningún ACK) y la limpieza por inactividad.
ChatStream.prototype._linkUp = function() {
  try {
    var ble = this.ble, dev = this.deviceId;
    if (!ble || !dev) return true;
    // Solo se aplica a Wi-Fi local (lan:) e internet (net:), que es donde se vio el problema del dueño (foto por
    // lan:nx09acdb61, vídeo/imagen por net:nx0ed4a8be) y donde la señal de «caído» es fiable (canReach/online). Para
    // Bluetooth crudo NO se toca el flujo: ya tiene su propia resiliencia (_sendFailed → PEER_ABSENT → queda pendiente
    // y se reanuda al volver el camino); meter aquí connectedDevices daba falsos «caído» y colgaba transferencias BLE.
    // #124 (build 2840, informe del dueño: un archivo a un contacto offline por internet no se enviaba y storm-
    // retransmitía). Antes esto preguntaba net.online() = «¿tengo YO internet?» → con el contacto APAGADO el enlace
    // parecía arriba, la ventana reintentaba hasta el tope y fallaba. Ahora pregunta net.canReach(nx) = «¿está el
    // CONTACTO en línea?» (p.up, visto hace <150 s), igual que el camino Wi-Fi de abajo. Contacto ausente → enlace
    // «caído» → la ventana ESPERA sin tormenta ni gastar reintentos; los trozos ya quedan en el buzón de relés y, al
    // conectarse el contacto (_netUp → resumeOutgoingTransfers), fluyen los ACKs y se entrega (store-and-forward).
    if (_isNetDevice(dev)) {
      if (!(ble.net && typeof ble.net.canReach === 'function')) return true;
      var nxn = this.ackSystem && this.ackSystem._resolveNexoId ? this.ackSystem._resolveNexoId(dev) : null;
      return ble.net.canReach(nxn);
    }
    if (_isLanDevice(dev)) {
      var nx = this.ackSystem && this.ackSystem._resolveNexoId ? this.ackSystem._resolveNexoId(dev) : null;
      return !(ble.lan && typeof ble.lan.canReach === 'function') || ble.lan.canReach(nx);
    }
    return true; // Bluetooth y cualquier otro: comportamiento de siempre
  } catch (e) { return true; }
};
// #dueño 02-11 (B2): ¿este archivo es GRANDE y el único camino de ahora es un Bluetooth de MTU MÍNIMO? Entonces NO lo
// arranques (martillaría la cola nativa minutos/horas): déjalo pendiente y espera un camino mejor. Devuelve true =
// aplazar. Solo Bluetooth crudo (net:/lan:/Wi-Fi Direct no tienen cola MTU-23); solo archivos; nunca reenvíos (fwd).
ChatStream.prototype._shouldDeferTinyMtu = function() {
  try {
    if (this.type !== 'file') return false;
    var dev = this.deviceId;
    if (_isNetDevice(dev) || _isLanDevice(dev)) return false;        // Wi-Fi/internet: sin cola MTU-23 → nunca aplazar
    if (this.meta && this.meta.fwd) return false;                    // reenvío/puente Jump: no aplica
    // #dueño 06-11 (diagnóstico: un APK de 25 MB se fue por un Bluetooth SANO = 148 550 trozos y no llegó nunca): un
    // archivo DEMASIADO GRANDE para Bluetooth (> BLE_FILE_MAX_CHARS) NO se manda por Bluetooth, tenga el MTU que tenga.
    // Queda ⏳ pendiente SIEMPRE y espera Wi-Fi/internet (el resolvedor, con preferNet, lo re-rutea por ahí). La app ya
    // considera «> tope BLE» como demasiado grande para Bluetooth; antes solo frenaba el caso de MTU mínimo (≤50).
    if ((this.content ? this.content.length : 0) > BLE_FILE_MAX_CHARS) { try { this.ackSystem._mtuDeferSince.set(this.msgId, Date.now()); } catch (e) {} return true; }
    var ble = this.ble;
    var mtu = (ble && typeof ble.getMtu === 'function') ? ble.getMtu(dev) : 0;
    var tiny = (typeof window !== 'undefined' && Number(window.NEXO_TINY_MTU)) || TINY_MTU;
    // #dueño 05-11 (diagnóstico de 2 teléfonos: un archivo de 34 MB se fue por Bluetooth MTU 23 y tapó la cola para TODO
    // —textos, fotos, ACKs—). El MTU se negocia unas décimas DESPUÉS de arrancar sendFile, así que acá getMtu devolvía 0
    // (desconocido) y la condición vieja `!(mtu>0 && mtu<=tiny)` daba return false → NO aplazaba → el archivote arrancaba
    // por MTU 23. Ahora: solo un MTU CONOCIDO y SANO (> tiny) se manda ya; MTU mínimo (≤tiny) O desconocido (0, aún sin
    // negociar) cae a la decisión de aplazar de abajo (y resumeOutgoingTransfers lo re-rutea por Wi-Fi/internet; si tras el
    // tope no aparece nada mejor, se intenta igual por Bluetooth: nunca se pierde).
    if (mtu > tiny) return false;                                    // MTU conocido y sano → comportamiento de siempre
    var big = (typeof window !== 'undefined' && Number(window.NEXO_BLE_DEFER_CHARS)) || BLE_TINY_MTU_DEFER_CHARS;
    if (!this.content || this.content.length <= big) return false;   // archivo chico (foto/preview): cabe por MTU 23 → se manda
    // Anti-inanición: esperar un rato por un camino mejor; si ya esperó bastante, intentar igual por Bluetooth (no perder)
    var waitMs = (typeof window !== 'undefined' && Number(window.NEXO_MTU_DEFER_MS)) || MTU_DEFER_MAX_WAIT_MS;
    var map = this.ackSystem._mtuDeferSince, since = map.get(this.msgId), now = Date.now();
    if (!since) { map.set(this.msgId, now); return true; }
    if (now - since < waitMs) return true;
    map.delete(this.msgId);                                          // ya esperó bastante → intentar por Bluetooth igual
    return false;
  } catch (e) { return false; }
};
ChatStream.prototype.start = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    // #dueño 06-11 (paso 2b, PAREJO con el receptor): el que ENVÍA un archivo GRANDE por internet también se mantiene
    // despierto de CORRIDO (candado + Wi-Fi, vía net.xferKeepAwake) para no dormirse a mitad del envío largo con la
    // pantalla apagada. Se toma abajo (ya con self.total, solo si es archivo grande por net) y se SUELTA pase lo que pase:
    // envuelvo resolve/reject —único modo en que la promesa termina— para liberarlo tanto en éxito como en fallo. El
    // nativo igual tiene un tope duro de 20 min por si algún camino raro no soltara. self._xferHeld lo comparte con el
    // renovado de _onWindowTimeout (envíos muy lentos > 20 min).
    var _releaseXfer = function () { if (!self._xferHeld) return; self._xferHeld = false; try { if (self.ble && self.ble.net && typeof self.ble.net.xferKeepAwake === 'function') self.ble.net.xferKeepAwake(false); } catch (e) {} };
    var _rs = resolve, _rj = reject;
    resolve = function (v) { _releaseXfer(); _rs(v); };
    reject = function (e) { _releaseXfer(); _rj(e); };
    self.resolve = resolve;
    self.reject = reject;
    self.lastAckAt = Date.now();
    // #dueño 07-11 (CRASH, diagnóstico S24 «se ralentizó hasta crashear tras un par de fotos y un vídeo»): un archivo
    // que NO va por Bluetooth (demasiado grande para BT, o MTU mínimo) y que se re-resolvía a un enlace Bluetooth se
    // PARTÍA en decenas de miles de trozos (_splitChunks; un APK de 35 MB = ~99 mil) ANTES de decidir aplazarlo, y eso
    // pasaba en CADA reintento (cada ~10 s) → partir + armar máscaras + persistir llenaba la memoria y tiraba la app.
    // Ahora se DECIDE aplazar ANTES de partir (_shouldDeferTinyMtu solo mira self.content, no los trozos): si aplaza, se
    // persiste el registro para reanudar con el CONTENIDO entero como UN solo trozo (barato; resumeOutgoingTransfers lo
    // re-rutea por Wi-Fi/internet y parte con chunk grande por el camino bueno) y se rechaza, SIN partir ni armar máscaras.
    if (self.type === 'file' && self._shouldDeferTinyMtu()) {
      self.aborted = true;
      // Persistir para reanudar por internet: el contenido entero como UN trozo (vaultCreateOutgoingTransfer devuelve el
      // existente si ya estaba → no duplica; el resume reconstruye el contenido uniendo los trozos, así que [content] basta).
      if (window.vaultCreateOutgoingTransfer && !self.meta.fwd && !_noResumeTx(self.meta) && !/^cs[0-9a-f]{12}$/.test(self.msgId)) {
        var cidDefer = self.meta.dst || self.ackSystem._resolveNexoId(self.deviceId);
        try { window.vaultCreateOutgoingTransfer(cidDefer, self.msgId, self.type, 1, [self.content], self.meta, self.deviceId).catch(function(){}); } catch (e) {}
      }
      console.warn('[ChatStream] Archivo grande (' + (self.content ? self.content.length : 0) + ' b64) → ⏳ pendiente, no por Bluetooth (SIN partir); espero Wi-Fi/internet. msgId=' + self.msgId);
      self.ackSystem._dispatchStatus(self.msgId, 'pending');
      // #dueño 06-11: si YA hay internet/Wi-Fi para el contacto, re-rutear pronto por ahí (resumeOutgoingTransfers re-resuelve con preferNet).
      try {
        var cidBetter = (self.meta && self.meta.dst) ? self.meta.dst : self.ackSystem._resolveNexoId(self.deviceId);
        var netB = self.ble && self.ble.net, lanB = self.ble && self.ble.lan;
        // 2970 (diagnóstico del dueño S24 09-11, APK de 25 MB a la tablet por Bluetooth): «mejor camino» = el contacto EN LÍNEA
        // por internet (canReach) o por Wi-Fi. Con mailboxOk (= tengo internet y el contacto es de internet, esté o no) se
        // re-reanudaba cada segundo sin que hubiera camino → leía 35 MB del disco y armaba el base64 cada ~1,5 s (la
        // «ralentización» del diagnóstico). Ahora, sin camino real, queda ⏳ y lo despierta el evento de enlace (_netUp/_linkUp).
        var hasBetter = (netB && typeof netB.canReach === 'function' && netB.canReach(cidBetter)) || (lanB && lanB.canReach && lanB.canReach(cidBetter));
        if (hasBetter) setTimeout(function() { try { self.ackSystem.resumeOutgoingTransfers(); } catch (e) {} }, 1000);
      } catch (e) {}
      // El motivo SIEMPRE contiene «no cabe por Bluetooth» → send.js lo deja ⏳ pendiente (no ✗). Demasiado grande para BT
      // (cualquier MTU, el bug del APK) vs MTU mínimo/desconocido (B2, #dueño 02-11).
      var _tooBig = (self.content ? self.content.length : 0) > BLE_FILE_MAX_CHARS;
      reject(new Error('archivo grande no cabe por Bluetooth ' + (_tooBig ? '(demasiado grande)' : 'de MTU mínimo') + ' ahora: en espera de Wi-Fi/internet'));
      return;
    }
    self._splitChunks();
    if (self.total === 0) { reject(new Error('Vacio')); return; }
    if (self.type === 'file' && _isNetDevice(self.deviceId) && self.total > NET_TOR_PREFER_CHUNKS) {
      try { if (self.ble && self.ble.net && typeof self.ble.net.xferKeepAwake === 'function') { self.ble.net.xferKeepAwake(true); self._xferHeld = true; } } catch (e) {}
    }
    var estimatedWindows = Math.ceil(self.total / self.windowSize);
    var timeoutPerWindow = self.windowTimeoutMs * (MAX_WINDOW_RETRIES + 2);
    var baseTo = (self.type === 'file') ? FILE_GLOBAL_TIMEOUT_MS : self.baseTimeoutMs;
    self.globalTimeoutMs = Math.max(baseTo, estimatedWindows * timeoutPerWindow);
    // Cap razonable: 15 min max; archivos grandes (vídeo HD) hasta 60 min a un mínimo de ~1,5 KB/s
    var cap = (self.type === 'file') ? Math.min(3600000, Math.max(900000, Math.round(self.content.length / 1.5))) : 900000;
    if (self.globalTimeoutMs > cap) self.globalTimeoutMs = cap;
    console.log('[ChatStream] START msgId=' + self.msgId + ' type=' + self.type + ' totalChunks=' + self.total + ' totalWindows=' + estimatedWindows + ' timeout=' + self.globalTimeoutMs + 'ms');
    // Ronda 2768: una señal de llamada no se guarda para reanudarla (al reiniciar la app se reenviaba la oferta de una
    // llamada ya terminada)
    // 3026 (diagnósticos del S24 12-11: el mismo segmento Fénix de 800 KB salía 2-4 veces seguidas al mismo contacto): un respaldo
    // Fénix NO se guarda para reanudarlo. Fénix ya reintenta solo (con otro id, espera tras un fallo y redundancia en otros
    // custodios); el registro guardado lo volvía a mandar resumeOutgoingTransfers en paralelo → copias duplicadas en la radio.
    if (window.vaultCreateOutgoingTransfer && !self.meta.fwd && !_noResumeTx(self.meta) && !/^cs[0-9a-f]{12}$/.test(self.msgId)) {
      var cid = self.meta.dst || self.ackSystem._resolveNexoId(self.deviceId);
      window.vaultCreateOutgoingTransfer(cid, self.msgId, self.type, self.total, self.chunks, self.meta, self.deviceId).catch(function(){});
    }
    // #dueño 02-11 (B2) + #dueño 07-11 (CRASH): la decisión de NO ir por Bluetooth (demasiado grande / MTU mínimo) ahora
    // se toma ARRIBA, ANTES de _splitChunks, para no partir decenas de miles de trozos al pedo en cada reintento. El
    // registro queda ⏳ pendiente y resumeOutgoingTransfers lo reenvía por Wi-Fi/internet; anti-inanición en _shouldDeferTinyMtu.
    var armGlobal = function(ms) {
      self.globalTimeout = setTimeout(function() {
        if (self.aborted) return;
        // Ronda 2767 (revisión): si sigue avanzando (confirmaciones en el último minuto) se le da más tiempo, hasta 2 h:
        // un vídeo HD o un archivo grande por un Bluetooth lento no terminaba nunca
        if (Date.now() - (self.lastAckAt || 0) < 60000 && Date.now() - self.startTime < 7200000) { armGlobal(300000); return; }
        // 3096: texto que el teléfono del otro ya tiene (✓✓) esperando a que su app despierte: no es un fallo (ver PEER_SAFE_*)
        if (self.type === 'chat' && self.peerSafeAt && Date.now() - self.peerSafeAt < PEER_SAFE_MAX_MS && !(self.lastAckAt > self.peerSafeAt)) { armGlobal(60000); return; }
        // #124 (build 2840): el contacto está AUSENTE (sin camino; p. ej. apagado y solo por internet, net.canReach
        // falso). NO es un fallo: el archivo queda EN ESPERA (store-and-forward). Los trozos ya están en el buzón de
        // relés y, al conectarse el contacto (_netUp → resumeOutgoingTransfers) o al reabrir la app, se entrega. Se
        // marca 'pending' (⏳ «esperando», no ✗) y se re-chequea cada 5 min, hasta 2 h en memoria; luego se suelta
        // (queda persistido en el vault para reanudar). Antes se marcaba 'failed' y parecía perdido.
        if (!self._linkUp()) {
          if (!self.aborted) self.ackSystem._dispatchStatus(self.msgId, 'pending');
          if (Date.now() - self.startTime < 7200000) { armGlobal(300000); return; }
          self.abort(); reject(new Error('Contacto ausente: queda en espera')); return;
        }
        // #dueño 08-11: un archivo por INTERNET a un contacto ALCANZABLE no se marca ✗ ni pide «reintentar»: queda ⏳ y se
        // re-arma el tope; el bucle de ventanas sigue reintentando SOLO y renovando el despertador hasta que fluye. (ver
        // _netFileAutoRetry) Antes el timeout global lo marcaba 'failed' → botón de reintentar que el dueño tenía que tocar.
        if (self._netFileAutoRetryNow()) { if (!self.aborted) try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {} armGlobal(300000); return; }
        console.error('[ChatStream] GLOBAL TIMEOUT msgId=' + self.msgId);
        self.abort();
        reject(new Error('Timeout global ' + (self.type === 'file' ? '3min+' : '45s+')));
        self.ackSystem._dispatchStatus(self.msgId, 'failed');
      }, ms);
    };
    armGlobal(self.globalTimeoutMs);
    self._runWindowLoop();
  });
};
ChatStream.prototype._runWindowLoop = function() {
  var self = this;
  function next() {
    if (self.aborted) {
      console.log('[ChatStream] _runWindowLoop abortado msgId=' + self.msgId);
      return;
    }
    if (self.windowStart >= self.total) {
      console.log('[ChatStream] _runWindowLoop: windowStart >= total, finalizando msgId=' + self.msgId);
      self._finish();
      return;
    }
    // #dueño 05-11: PRIORIDAD — un archivo grande cede la radio a lo chico/interactivo que esté activo (foto/texto),
    // así la foto no espera detrás del archivo. Acotado a BULK_YIELD_MAX_MS seguidos: el archivo siempre avanza.
    if (self._bulk && BULK_PRIO() && self.ackSystem && self.ackSystem._interactiveActive(self.msgId)) {
      var nowY = Date.now();
      if (!self._yieldSince) self._yieldSince = nowY;
      if (nowY - self._yieldSince < BULK_YIELD_MAX_MS) { setTimeout(next, BULK_YIELD_STEP_MS); return; }
    } else if (self._yieldSince) { self._yieldSince = 0; }
    console.log('[ChatStream] _runWindowLoop: enviando ventana. windowStart=' + self.windowStart + ' msgId=' + self.msgId);
    self._sendWindow().then(function() {
      console.log('[ChatStream] _sendWindow RESUELTA. windowStart ahora=' + self.windowStart + ' msgId=' + self.msgId);
      self.windowRetryCount = 0;
      setTimeout(next, self.pacingDelayMs);
    }).catch(function(err) {
      console.warn('[ChatStream] _sendWindow RECHAZADA. retry=' + self.windowRetryCount + ' msgId=' + self.msgId);
      self.windowRetryCount++;
      if (self.windowRetryCount > self.maxWindowRetries) {
        self.abort();
        // #dueño 02-11 (diagnóstico coche: el archivo moría por BLE MTU 23 congestionado): un ARCHIVO que agota los
        // reintentos NO se marca ✗ ni se pierde — el registro sigue en el vault y resumeOutgoingTransfers lo reenvía
        // por el mejor camino cuando vuelva Wi-Fi/internet. Queda ⏳ 'pending'. El texto (chat) sí sigue 'failed'.
        self.ackSystem._dispatchStatus(self.msgId, self.type === 'file' ? 'pending' : 'failed');
        if (self.reject) self.reject(new Error('Max window retries'));
        return;
      }
      console.log('[ChatStream] Ventana fallo, reintentando. retry=' + self.windowRetryCount);
      setTimeout(next, 500 * self.windowRetryCount);
    });
  }
  next();
};
ChatStream.prototype._splitChunks = function() {
  var str = this.content;
  var size = this.chunkSize;
  var arr = [];
  var i = 0;
  // Chunk 0 lleva meta (fr, type, format…): limitar datos para no reventar MTU
  var firstChunkMax = (this.type === 'file') ? Math.min(size, 120) : Math.min(size, 200);
  // v3.13.0: en binario, un trozo termina justo donde empiezan los datos en base64 y los siguientes van alineados
  var body = this.bin ? _b64BodyStart(str) : -1;
  while (i < str.length) {
    var remaining = str.length - i;
    var chunkSize = (arr.length === 0) ? Math.min(firstChunkMax, remaining) : Math.min(size, remaining);
    var end = i + chunkSize;
    if (body > i && body < end) end = body;
    if (end < str.length &&
        str.charCodeAt(end - 1) >= 0xD800 && str.charCodeAt(end - 1) <= 0xDBFF &&
        str.charCodeAt(end) >= 0xDC00 && str.charCodeAt(end) <= 0xDFFF) {
      end--;
    }
    arr.push(str.substring(i, end));
    i = end;
  }
  this.chunks = arr;
  this.total = arr.length;
  this.sentMask = new Array(this.total).fill(false);
  this.ackedMask = new Array(this.total).fill(false);
  console.log('[ChatStream] _splitChunks: ' + this.total + ' chunks. chunk0=' + (this.chunks[0] ? this.chunks[0].length : 0) + ' chars, chunkN=' + (this.chunks[1] ? this.chunks[1].length : 0) + ' chars');
};
ChatStream.prototype._sendWindow = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self._windowResolve = resolve;
    self._windowReject = reject;
    self._windowStartAtSend = self.windowStart;
    self._windowEndAtSend = Math.min(self.windowStart + self.windowSize, self.total);
    var end = self._windowEndAtSend;
    var myStart = self._windowStartAtSend;
    function sendNext(idx) {
      // v3.3.0: si la ventana ya se cerró por ack (y empezó otra), este envío termina aquí
      if (self._windowStartAtSend !== myStart) return;
      if (idx >= end || self.aborted) {
        var allAcked = true;
        for (var i = self._windowStartAtSend; i < self._windowEndAtSend; i++) {
          if (!self.ackedMask[i]) { allAcked = false; break; }
        }
        if (allAcked) {
          if (self.timer) clearTimeout(self.timer);
          console.log('[ChatStream] _sendWindow RESOLVIENDO (ventana completa) msgId=' + self.msgId);
          resolve();
        } else {
          console.log('[ChatStream] _sendWindow iniciando timer (esperando ACKs) msgId=' + self.msgId);
          self._startWindowTimer();
        }
        return;
      }
      if (self.ackedMask[idx]) {
        console.log('[ChatStream] Chunk ' + idx + ' ya acked, saltando msgId=' + self.msgId);
        setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
        return;
      }
      self.sentMask[idx] = true;
      self._sendChunk(idx)
        .then(function() {
          self._nativeFails = 0; self._busyWaits = 0; // pasó un trozo: la cola drena y el enlace va bien
          setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
        })
        .catch(function(err) {
          if (self.aborted) return;
          // #dueño 08-11: un respaldo Fénix de FONDO sobre un Bluetooth ya marcado atascado se rinde YA (queda pendiente),
          // sin seguir martillando la cola nativa ni tapar la radio del usuario. Antes de tratar la contrapresión.
          if (self._bgShouldYieldBle()) { self._giveUpPending(); return; }
          // #129 (dueño 01-11): «Cola de escritura llena» (BLE_BUSY) NO es fallo del enlace: es contrapresión de la cola
          // nativa (MTU 23). Esperar más y reintentar el MISMO trozo, SIN contar como fallo (no cambiar de camino ni abortar).
          if (self._isBusyErr(err)) {
            var wait = self._busyBackoff();
            if (wait < 0) { self._giveUpPending(); return; } // ~5 min saturado sin que pase un trozo: enlace muerto
            setTimeout(function() { sendNext(idx); }, wait);
            return;
          }
          if (self._sendFailed(idx, err)) setTimeout(function() { sendNext(idx); }, self._nativeFails > 10 ? 1000 : 200);
        });
    }
    sendNext(self.windowStart);
  });
};
// Un trozo no salió. true: reintentar (quizá por otro enlace); false: el envío queda pendiente (PEER_ABSENT)
ChatStream.prototype._sendFailed = function(idx, err) {
  var self = this;
  var fails = self._nativeFails = (self._nativeFails || 0) + 1;
  if (fails === 1 || fails % 20 === 0) console.warn('[ChatStream] Envio nativo fallo chunk', idx, err && err.message, '(' + fails + ')');
  // v3.10.0: el enlace ya no sirve (p. ej. Wi-Fi caído): seguir por el mejor camino de ahora. Antes se
  // reintentaba para siempre cada 200 ms por el mismo enlace.
  var bi = self.ble, nx = self._dn || self.ackSystem._resolveNexoId(self.deviceId);
  var wrong = err && err.code === 'WRONG_PEER';
  // #dueño 06-11: un archivo grande que falla por un enlace NO debe re-rutearse a otro Bluetooth (se arrastra en miles de
  // trozos); prefiere internet/Wi-Fi si el contacto es alcanzable por ahí.
  var bigFile = self.type === 'file' && self.content && self.content.length > BLE_FILE_MAX_CHARS;
  // 3022: un ARCHIVO a medias por Wi-Fi espera el margen del corte (regla del dueño 23-10: no cambia de camino por un pico);
  // al vencer, lan._giveUp → _lanDown lo pasa al otro camino (y se rehace a su medida si hace falta)
  if (self.type === 'file' && !wrong && _isLanDevice(self.deviceId) && bi && bi.lan && typeof bi.lan.inGrace === 'function' && bi.lan.inGrace(nx)) return true;
  var best = ((fails >= 3 || wrong) && bi && typeof bi._resolveDeviceIdForNexoId === 'function') ? bi._resolveDeviceIdForNexoId(nx, bigFile) : null;
  if (best && _normMac(best) !== _normMac(self.deviceId)) {
    if (self.tooBigFor(best)) { self.ackSystem._restartStream(self, self.msgId, best); return false; }
    self.useLink(best);
  }
  if (fails > 120 || (wrong && !best)) {
    // ~2 min sin poder enviar: queda pendiente y se reanuda al volver a haber camino
    self._giveUpPending();
    return false;
  }
  return true;
};
// #129 (dueño 01-11): ¿el trozo falló porque la cola nativa está llena (contrapresión), no por el enlace? (delegan en las
// funciones puras _isBusyErr/_busyBackoffMs, exportadas para la prueba busyback.js)
ChatStream.prototype._isBusyErr = function(err) { return _isBusyErr(err); };
// #129: espera escalonada ante la cola llena. Cuenta los reintentos SEGUIDOS sin que pase ningún trozo; pasado
// BUSY_MAX_WAITS (~5 min saturado) devuelve -1 = darse por saturado. Se reinicia a 0 al pasar un trozo.
ChatStream.prototype._busyBackoff = function() {
  var n = this._busyWaits = (this._busyWaits || 0) + 1;
  if (n === 1 || n % 50 === 0) console.warn('[ChatStream] Cola nativa llena (contrapresión) en ' + this.msgId + ' (' + n + ')');
  return _busyBackoffMs(n);
};
// #129: dejar el envío pendiente (se reanuda al volver a haber camino). Reutilizado por _sendFailed y por la contrapresión.
ChatStream.prototype._giveUpPending = function() {
  var self = this;
  var e = new Error('Contacto no disponible: queda pendiente'); e.code = 'PEER_ABSENT';
  var rej = self.reject; self.reject = null;
  self.abort();
  self.ackSystem.outgoingStreams.delete(self.msgId);
  if (rej) rej(e);
};
// #dueño 08-11: ¿este stream es un respaldo Fénix de FONDO sobre un Bluetooth atascado y debe rendir la radio YA? (ver
// _fenixYieldBle). Se consulta en el bucle de trozos para que un respaldo en vuelo no siga martillando un enlace que el
// nativo ya marcó muerto (_bleCongested). El usuario (no-Fénix) nunca entra acá.
ChatStream.prototype._bgShouldYieldBle = function() {
  var dev = this.deviceId;
  var isBle = !_isNetDevice(dev) && !_isLanDevice(dev);
  var cong = false;
  try { cong = !!(this.ble && typeof this.ble._bleCongested === 'function' && this.ble._bleCongested(dev)); } catch (e) {}
  return _fenixYieldBle(this.meta && this.meta.type, isBle, cong);
};
// #dueño 08-11: ¿este archivo por INTERNET debe seguir reintentando SOLO (sin pedir «reintentar» al usuario)? Sí mientras el
// contacto siga alcanzable (_linkUp = canReach) y no se pase el presupuesto. Consultado en los dos puntos donde antes
// abortaba / marcaba ✗ (ver _netFileAutoRetry).
ChatStream.prototype._netFileAutoRetryNow = function() {
  try {
    return _netFileAutoRetry(this.type, _isNetDevice(this.deviceId), this._linkUp(),
      Date.now() - (this.startTime || Date.now()), NET_FILE_AUTORETRY_BUDGET_MS);
  } catch (e) { return false; }
};
// v3.13.0: binario si se puede (no el trozo 0, que lleva los datos del archivo y la miniatura); si no, JSON
ChatStream.prototype._sendChunk = function(idx) {
  var d = this.chunks[idx];
  // Ronda 2764: la conexión resultó ser de otro (ver _remapDevice): no seguir por ella
  if (this._dn && this.ble && typeof this.ble._destNx === 'function') {
    var cur = this.ble._destNx(this.deviceId);
    if (cur && cur !== this._dn) { var ew = new Error('la conexión es de otro contacto'); ew.code = 'WRONG_PEER'; return Promise.reject(ew); }
  }
  if (this.bin && idx > 0 && this.ackSystem.peerBin(this.deviceId) && _binOk(d)) {
    var head = JSON.parse(this._buildChunk(idx));
    delete head.d;
    var self = this;
    return this.ble._sendBinaryNative(this.deviceId, JSON.stringify(head), d).catch(function(e) {
      if (!e || e.code !== 'UNIMPLEMENTED') throw e;
      self.bin = false; // nativo sin trozos binarios: el resto como siempre
      return self.ble._sendMessageNative(self.deviceId, self._buildChunk(idx), self.msgId + '_' + idx);
    });
  }
  return this.ble._sendMessageNative(this.deviceId, this._buildChunk(idx), this.msgId + '_' + idx);
};
ChatStream.prototype._buildChunk = function(idx) {
  var isFirst = idx === 0;
  var obj = {
    v: PROTOCOL_VERSION,
    t: this.type === 'chat' ? 'c' : 'f',
    m: this.msgId,
    i: idx,
    n: this.total,
    d: this.chunks[idx],
    a: this.att
  };
  if (isFirst) {
    obj.f = (this.meta.f || 'NEXO').substring(0, 12);
    obj.fr = this.meta.fr || 'unknown';
    obj.ts = this.meta.ts || Date.now();
    if (typeof this.meta.seq === 'number') obj.seq = this.meta.seq;
    if (this.meta.type) obj.tp = this.meta.type;
    if (this.meta.name) obj.fn = this.meta.name;
    if (this.meta.mime) obj.mt = this.meta.mime;
    if (this.meta.size) obj.fs = this.meta.size;
    if (this.meta.format) obj.ft = this.meta.format;
    // 3015: nota de voz como archivo: su duración y su tipo de audio (la burbuja los muestra)
    if (this.meta.duration) obj.du = this.meta.duration;
    if (this.meta.mimeType) obj.am = this.meta.mimeType;
    // FIX: width/height se perdían (nunca se empaquetaban), quedaban null en el receptor
    if (this.meta.width) obj.w = this.meta.width;
    if (this.meta.height) obj.h = this.meta.height;
    if (this.meta.hdFor) obj.hf = this.meta.hdFor;
    if (this.meta.preview) obj.pv = 1;
    if (this.meta.once) obj.o1 = 1; // #94 «ver una vez»: el medio se consume al abrirlo en el receptor
    if (this.meta.thumb) obj.th = this.meta.thumb; // miniatura JPEG del vídeo (poster) o 1.ª página del PDF
    if (this.meta.pages) obj.pg = this.meta.pages;
    if (this.meta.dst) obj.dt = this.meta.dst;
    if (this.meta.hp) obj.hp = this.meta.hp;
    if (this._restart) obj.rs = 1; // 3080: intento nuevo del mismo envío (cambio de camino): el receptor empieza de cero al momento
    // Ronda 2764: a quién va (directo; se fija la primera vez: aunque la conexión resulte ser de otro, sigue siendo
    // para el mismo); el que lo recibe lo ignora si no es él
    var bdn = this.ble;
    if (!this.meta.dst && bdn && typeof bdn._destNx === 'function') { if (this._dn === undefined) this._dn = _nxOf(this.meta.to) || bdn._destNx(this.deviceId); if (this._dn) obj.dn = this._dn; }
    // Ronda 2759: oferta de llamada troceada: con la app del otro cerrada, su aviso dice "Llamada entrante" (BgInbox.kt)
    var bi0 = typeof window !== 'undefined' && window.bleInterface;
    if (this.type === 'chat' && bi0 && bi0._callOut && bi0._callOut.has(this.msgId)) obj.cl = 1;
    if (this.type === 'chat' && bi0 && bi0._callVideoOut && bi0._callVideoOut.has(this.msgId)) obj.cv = 1; // 3089: videollamada (aviso nativo)
    // Ronda 2760: texto largo oculto (acción, señal de llamada): sin aviso en el otro teléfono (BgInbox.kt)
    var bq = typeof window !== 'undefined' && window.bleInterface;
    if (this.type === 'chat' && bq && bq._quietOut && bq._quietOut.has(this.msgId)) obj.q = 1;
    // Ronda 2763: foto o texto largo de un grupo (directo): el id del grupo para el aviso con la app cerrada
    if (!this.meta.dst && bq && bq._groupOut && bq._groupOut.has(this.msgId)) obj.g = bq._groupOut.get(this.msgId);
  }
  obj.k = _chunkCheck(obj);
  return JSON.stringify(obj);
};
ChatStream.prototype._startWindowTimer = function(waitMs) {
  var self = this;
  if (self.timer) clearTimeout(self.timer);
  var ms = waitMs || self.windowTimeoutMs;
  console.log('[ChatStream] Timer iniciado (' + ms + 'ms) msgId=' + self.msgId);
  self.timer = setTimeout(function() {
    self._onWindowTimeout();
  }, ms);
};
ChatStream.prototype._onWindowTimeout = function() {
  var self = this;
  if (self.aborted) return;
  var allAcked = true;
  for (var i = self._windowStartAtSend; i < self._windowEndAtSend; i++) {
    if (!self.ackedMask[i]) { allAcked = false; break; }
  }
  console.log('[ChatStream] _onWindowTimeout. ventanaOriginal=[' + self._windowStartAtSend + ',' + self._windowEndAtSend + ') allAcked=' + allAcked + ' windowStartActual=' + self.windowStart + ' msgId=' + self.msgId);
  if (allAcked) {
    console.log('[ChatStream] Ventana original completa por ACKs tardios. Resolviendo. msgId=' + self.msgId);
    self.windowRetryCount = 0; self._downWaitMs = 0;
    if (self._windowResolve) {
      self._windowResolve();
      self._windowResolve = null;
      self._windowReject = null;
    }
  } else {
    // #87 (28-10): el enlace está CAÍDO ahora → esperar a que vuelva sin gastar un reintento del tope (no abortar el
    // archivo por un corte del Bluetooth/Wi-Fi). No se reenvía (saturaría la cola nativa); el timeout global (60 s sin
    // ACK) sigue siendo el límite si no vuelve nunca. Al volver y fluir los ACKs, el bucle resetea el contador.
    // #dueño 06-11 (LATIDO de despertador): un ARCHIVO por INTERNET que no avanza = el que recibe se durmió y por eso no
    // confirma. Le re-disparamos el «toque» (net_link lo throttlea a 1 cada 15 s, así que es barato) para que su app
    // vuelva, siga recibiendo y confirme; en cuanto fluyan los ACKs ya no hay timeout → no más toques. Solo net: + file.
    if (_isNetDevice(self.deviceId) && self.type === 'file' && self.ble && self.ble.net && typeof self.ble.net.wakeKeepAlive === 'function') {
      try { var _cidKa = (self.meta && self.meta.dst) ? self.meta.dst : self.ackSystem._resolveNexoId(self.deviceId); if (_cidKa) self.ble.net.wakeKeepAlive(_cidKa); } catch (e) {}
      // #dueño 06-11 (paso 2b, PAREJO): renovar el candado del que ENVÍA en un archivo grande por net (el acquire resetea
      // el tope de 20 min), para que un envío lento (> 20 min) no se duerma a mitad. Se suelta al terminar (start()).
      try { if (self.total > NET_TOR_PREFER_CHUNKS && typeof self.ble.net.xferKeepAwake === 'function') { self.ble.net.xferKeepAwake(true); self._xferHeld = true; } } catch (e) {}
    }
    if (!self._linkUp()) {
      // #dueño 07-11: el contacto de internet/Wi-Fi está AUSENTE (store-and-forward). Marcar 'pending' («esperando», reloj
      // ⏳) PRONTO para que la burbuja no se quede en ○ («clavado») hasta el tope global de 10 min; el audio/archivo ya
      // quedó para el buzón y se entrega al reconectar. Solo archivos (el texto al buzón ya muestra ✓ por otro camino).
      if (self.type === 'file') { try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {} }
      // 2985 (diagnóstico del dueño 10-11, build 2984): con el contacto ausente esto se repetía cada 3,8 s sin parar (hasta 2 h en memoria:
      // ~950 vueltas por hora y por flujo, y el registro del diagnóstico se llenaba de estas líneas). La espera ahora CRECE
      // (3,8 s → 7,6 → 15 → 30 s, tope) y vuelve a la normal en cuanto el enlace está arriba o llegan ACKs. No se gasta reintento ni se aborta.
      // Un ARCHIVO por internet re-dispara el «toque» de despertador en cada vencimiento (net_link lo frena a 1 cada 15 s): su tope es 15 s
      // para no aflojar ese latido; el resto (texto, lo demás) llega a 30 s.
      var _cap = (_isNetDevice(self.deviceId) && self.type === 'file') ? LINK_DOWN_WAIT_FILE_MS : LINK_DOWN_WAIT_MAX_MS;
      self._downWaitMs = Math.min(Math.max((self._downWaitMs || 0) * 2, self.windowTimeoutMs), _cap);
      console.log('[ChatStream] Ventana sin ACK con el enlace caído: espero a que vuelva (no gasta reintento; reviso en ' + Math.round(self._downWaitMs / 1000) + ' s) msgId=' + self.msgId);
      self._startWindowTimer(self._downWaitMs);
      return;
    }
    self._downWaitMs = 0; // el enlace está arriba: la espera vuelve a la normal
    // 2976 (primer diagnóstico AUTOMÁTICO del dueño): el nativo SOLTÓ el mensaje por ese Bluetooth («Write fallo… descartado
    // entero» → onWriteDropped → marcado muerto), pero las escrituras «sin respuesta» no fallan en JS, así que el respaldo
    // Fénix no pasaba por el catch de _sendChunk y seguía reenviando la ventana cada 8 s (7 reintentos × 12 trozos a MTU 23)
    // sobre un enlace muerto. Rendir también AQUÍ (solo Fénix; lo del usuario mantiene toda su paciencia, #129).
    if (self._bgShouldYieldBle()) {
      console.log('[ChatStream] Respaldo Fénix sobre un Bluetooth muerto: se rinde, queda pendiente msgId=' + self.msgId);
      self._giveUpPending();
      return;
    }
    // 2993: un TEXTO cuya ventana vence mientras otro envío avanza por la radio no gasta reintento ni reenvía (sería más carga): espera con
    // backoff (3,8 → 7,6 → 15 s) hasta TEXT_BUSY_GRACE_MS desde que arrancó; pasado eso, o sin otro envío avanzando, el presupuesto de siempre.
    if (self.type !== 'file' && Date.now() - self.startTime < TEXT_BUSY_GRACE_MS && self.ackSystem._otherProgressing(self.msgId)) {
      self._busyWaitMs = Math.min(Math.max((self._busyWaitMs || 0) * 2, self.windowTimeoutMs), 15000);
      console.log('[ChatStream] Ventana sin ACK mientras otro envío avanza por la radio: espero sin gastar reintento (reviso en ' + Math.round(self._busyWaitMs / 1000) + ' s) msgId=' + self.msgId);
      self._startWindowTimer(self._busyWaitMs);
      return;
    }
    self._busyWaitMs = 0;
    // 3096: el teléfono del otro ya tiene el texto (✓✓ de su nativo) y su app duerme: no se reenvía la ventana ni se gasta reintento
    // (si su app ya confirmó algún trozo después del ✓✓, está despierta: lo de siempre, para que reciba lo que le falte)
    if (self.type === 'chat' && self.peerSafeAt && Date.now() - self.peerSafeAt < PEER_SAFE_MAX_MS && !(self.lastAckAt > self.peerSafeAt)) {
      self._safeWaitMs = Math.min(Math.max((self._safeWaitMs || 0) * 2, PEER_SAFE_FIRST_MS), PEER_SAFE_CAP_MS);
      console.log('[ChatStream] El teléfono del otro ya tiene el texto (✓✓) y su app duerme: no reenvío (reviso en ' + Math.round(self._safeWaitMs / 1000) + ' s) msgId=' + self.msgId);
      self._startWindowTimer(self._safeWaitMs);
      return;
    }
    // 3002 (diagnóstico automático del 11-11, S24 14:55): un TEXTO por Bluetooth cuyo enlace el nativo ya soltó («Write fallo…
    // descartado entero» → _markBleDead) reenviaba la ventana 8 veces (~64 s) sobre un enlace muerto y acababa ✗ («Max window
    // retries»). Un texto no se pierde por eso: se rinde YA y queda ⏳ pendiente (PEER_ABSENT); se reenvía solo al volver un camino
    // (_markBleDead ya re-ruteó a internet/Wi-Fi si había; si no, lo reenvía el flujo de pendientes). Los archivos tienen su propia regla.
    if (self.type !== 'file' && self._textOnDeadBle()) {
      console.log('[ChatStream] Texto sobre un Bluetooth que el nativo ya soltó: se rinde, queda pendiente msgId=' + self.msgId);
      try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      self._giveUpPending();
      return;
    }
    self.windowRetryCount++;
    // 3044: respaldo Fénix con el enlace vivo y ni un trozo confirmado → la app del otro duerme: se rinde (ver FENIX_SILENT_RETRIES)
    if (self.meta && self.meta.type === 'fenix' && self.windowStart === 0 && self.windowRetryCount >= FENIX_SILENT_RETRIES) {
      console.log('[ChatStream] Respaldo Fénix: el otro no confirma ni un trozo en ' + self.windowRetryCount + ' ventanas (su app duerme): se rinde, queda para más tarde msgId=' + self.msgId);
      self._giveUpPending();
      return;
    }
    // 3021: archivo por un PUENTE Jump que no confirmó ni un trozo → soltar el puente (ver BRIDGE_STALL_RETRIES)
    // 3125 (diagnóstico S24 3059 00:08, «zombi …db61»: un TEXTO largo suyo por un puente con la app dormida, ventana 0 reenviada
    // entera cada 12 s): también un texto troceado por un puente se suelta a las 2 ventanas sin un trozo confirmado
    if ((self.type === 'file' || self.type === 'chat') && self.meta && self.meta.dst && self.windowStart === 0 && self.windowRetryCount >= BRIDGE_STALL_RETRIES && !_isNetDevice(self.deviceId)) {
      var dstS = _normId(self.meta.dst), viaS = '';
      try { viaS = _normId(self.ble && self.ble._macToNexoId && self.ble._macToNexoId.get(_normMac(self.deviceId))); } catch (e) {}
      console.warn('[ChatStream] Puente ' + (viaS || self.deviceId) + ' sin confirmar ni un trozo de ' + self.msgId + ' tras ' + self.windowRetryCount + ' ventanas: lo suelto y va por otro camino (buzón/internet) a ' + dstS);
      try { if (self.ble && self.ble.relay && typeof self.ble.relay.bridgeStalled === 'function') self.ble.relay.bridgeStalled(viaS || self.deviceId, BRIDGE_STALL_MS); } catch (e) {}
      try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      self._giveUpPending();
      var bleS = self.ble;
      if (dstS && bleS && typeof bleS._resendPendingMessages === 'function') setTimeout(function() { try { bleS._resendPendingMessages(dstS); } catch (e) {} }, 500);
      return;
    }
    // 3124: ARCHIVO del usuario por un enlace local con la app del otro dormida (ni un trozo confirmado, enlace vivo) → toque para
    // despertarlo y sondeo de 1 trozo cada SLEEP_PROBE_MS en vez de la ventana entera; tras SLEEP_PROBE_MAX_MS sin respuesta, ⏳
    if (self.type === 'file' && !_isNetDevice(self.deviceId) && !(self.meta && (self.meta.dst || _isFenixTx(self.meta))) &&
        self.windowStart === 0 && self.windowRetryCount >= SLEEP_FILE_RETRIES && !self._textOnDeadBle()) { // un Bluetooth atascado no es una app dormida
      var nowS = Date.now();
      if (!self._sleepSince) {
        self._sleepSince = nowS;
        var nxS = self._peerNexoId();
        console.log('[ChatStream] Archivo sin un trozo confirmado en ' + self.windowRetryCount + ' ventanas con el enlace vivo: la app del otro duerme; la despierto y pruebo con 1 trozo cada ' + Math.round(SLEEP_PROBE_MS / 1000) + ' s msgId=' + self.msgId);
        try { if (nxS && self.ble && typeof self.ble._wakeSleepingPeer === 'function') self.ble._wakeSleepingPeer(nxS, 'archivo sin confirmar'); } catch (e) {}
        try { if (nxS && self.ble && typeof self.ble._noteWakePending === 'function') self.ble._noteWakePending(nxS); } catch (e) {}
      }
      if (nowS - self._sleepSince < SLEEP_PROBE_MAX_MS) {
        self.windowRetryCount = SLEEP_FILE_RETRIES;
        self._probing = true;
        self._probe(SLEEP_PROBE_MS);
        return;
      }
      console.log('[ChatStream] La app del otro no despertó en ' + Math.round(SLEEP_PROBE_MAX_MS / 60000) + ' min: el archivo queda pendiente y sale cuando vuelva msgId=' + self.msgId);
      try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      self._giveUpPending();
      return;
    }
    // 3005: archivo grande por internet y el otro no confirma → «sondeo» (1 trozo por minuto) en vez de reenviar la ventana
    // entera cada 8 s al vacío. Mantiene el contador en el tope mientras siga el presupuesto de reintento solo (2 h, contacto
    // alcanzable); si se acaba, cae al tope de siempre (abajo).
    // 3127: también un archivo PEQUEÑO por internet del que el otro no confirmó ni un trozo (su app duerme), con 1 trozo cada 15 s
    var netBig = self.total >= NET_BIG_MIN_CHUNKS;
    if (_isNetDevice(self.deviceId) && self.type === 'file' && (netBig || self.windowStart === 0) && self.windowRetryCount > NET_SILENT_FULL_RETRIES) {
      if (self.windowRetryCount > self.maxWindowRetries && self._netFileAutoRetryNow()) {
        self.windowRetryCount = self.maxWindowRetries;
        try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      }
      if (self.windowRetryCount <= self.maxWindowRetries) {
        var gapN = netBig ? NET_SILENT_PROBE_MS : NET_SMALL_PROBE_MS;
        if (!self._probing) console.log('[ChatStream] El otro no confirma: pruebo con 1 trozo cada ' + Math.round(gapN / 1000) + ' s hasta que conteste msgId=' + self.msgId);
        self._probing = true;
        self._probe(gapN);
        return;
      }
    }
    if (self.windowRetryCount > self.maxWindowRetries && self.type !== 'file' && /^(msg|gm)[0-9a-z]+/i.test(String(self.msgId || ''))) {
      // 3009 (PENDIENTES 12b; diagnóstico b2987 «gm…_1e29ab2f»: texto de grupo a una app dormida, 8 reintentos y ✗): un TEXTO del
      // usuario (o su copia para un miembro de grupo) que agota los reintentos con el enlace ARRIBA es un otro que no confirma
      // (app congelada o dormida: su nativo avisa pero no puede confirmar un texto troceado). No es un fallo: queda ⏳ pendiente
      // (PEER_ABSENT) y lo reenvía la cola de pendientes de ese contacto cuando vuelva (app al frente, enlace nuevo), como el 3002
      // con un Bluetooth muerto. Antes quedaba ✗ y el usuario tenía que reintentar a mano.
      console.log('[ChatStream] Texto sin confirmar tras ' + self.maxWindowRetries + ' reintentos (la app del otro no contesta): queda pendiente, no ✗ msgId=' + self.msgId);
      try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      self._giveUpPending();
      return;
    }
    if (self.windowRetryCount > self.maxWindowRetries) {
      // #dueño 08-11: un archivo por INTERNET a un contacto ALCANZABLE NO aborta ni pide reintentar: resetea el contador,
      // queda ⏳ y reintenta la ventana SOLO (el despertador ya se renovó arriba). Solo aborta si el contacto no es
      // alcanzable (rama de arriba) o al pasar el tope de 2 h. (ver _netFileAutoRetry) Mantiene VIVO el mismo stream para no
      // depender de un re-disparo externo (contacto que vuelve / app al frente) que antes no llegaba solo.
      if (self._netFileAutoRetryNow()) { self.windowRetryCount = 0; try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {} self._retransmitWindow(); return; }
      console.warn('[ChatStream] Max window retries alcanzado para', self.msgId);
      try { window.dispatchEvent(new CustomEvent('nexo:diag:symptom', { detail: { kind: 'reintentos', info: self.type + ' ' + self.msgId } })); } catch (e) {} // 2974: síntoma → diagnóstico automático
      self.abort();
      if (self._windowReject) {
        self._windowReject(new Error('Max window retries'));
        self._windowReject = null;
        self._windowResolve = null;
      }
      // #dueño 02-11: un ARCHIVO que agota reintentos queda ⏳ 'pending' (persistido, se reenvía al volver una ruta),
      // no ✗ 'failed'. El texto sí sigue 'failed'.
      self.ackSystem._dispatchStatus(self.msgId, self.type === 'file' ? 'pending' : 'failed');
      return;
    }
    console.log('[ChatStream] Window timeout, reenviando ventana desde', self.windowStart, 'retry', self.windowRetryCount, 'msgId=' + self.msgId);
    self._retransmitWindow();
  }
};
// 3002: ¿el enlace de este flujo es un Bluetooth que el nativo ya marcó muerto/atascado (onWriteDropped → _markBleDead)?
ChatStream.prototype._textOnDeadBle = function() {
  var dev = this.deviceId;
  if (_isNetDevice(dev) || _isLanDevice(dev)) return false;
  try { return !!(this.ble && typeof this.ble._bleCongested === 'function' && this.ble._bleCongested(dev)); } catch (e) { return false; }
};
// 3005: «sondeo» de un archivo grande por internet cuyo receptor no confirma: reenvía SOLO el primer trozo sin confirmar y
// revisa en NET_SILENT_PROBE_MS. Si el otro lo tiene a medias, lo confirma (→ ritmo normal); si lo perdió, pide lo que falta (NACK).
ChatStream.prototype._probe = function(everyMs) {
  var self = this;
  var gapMs = everyMs || NET_SILENT_PROBE_MS; // 3124: el sondeo de una app dormida por un enlace local va cada SLEEP_PROBE_MS
  var idx = self.windowStart;
  while (idx < self.total && self.ackedMask[idx]) idx++;
  self._retxGen = (self._retxGen || 0) + 1;   // corta una cadena de reenvío en curso
  if (idx < self.total) {
    console.log('[ChatStream] Sondeo: reenvío solo el trozo ' + idx + ' (reviso en ' + Math.round(gapMs / 1000) + ' s) msgId=' + self.msgId);
    self._sendChunk(idx).then(function() { self._nativeFails = 0; }, function() {});
  }
  self._startWindowTimer(gapMs);
};
// 3124: el NEXO ID del otro extremo de este flujo (para despertarlo): el destinatario del archivo o el dueño del enlace
ChatStream.prototype._peerNexoId = function() {
  var dev = this.deviceId;
  try { if (this.meta && this.meta.to) return _normId(this.meta.to); } catch (e) {}
  try { if (_isLanDevice(dev)) return _normId(String(dev).replace(/^lan:/i, '')); } catch (e) {}
  try { return _normId(this.ble && this.ble._macToNexoId && this.ble._macToNexoId.get(_normMac(dev))) || ''; } catch (e) { return ''; }
};
ChatStream.prototype._retransmitWindow = function() {
  var self = this;
  var end = Math.min(self.windowStart + self.windowSize, self.total);
  var gen = self._retxGen = (self._retxGen || 0) + 1;   // 2995: una sola cadena de reenvío a la vez (la nueva sustituye a la vieja)
  console.log('[ChatStream] _retransmitWindow: [' + self.windowStart + ',' + end + ') msgId=' + self.msgId);
  function sendNext(idx) {
    if (self.aborted || gen !== self._retxGen) return;
    if (idx >= end) {
      self._startWindowTimer();
      return;
    }
    if (self.ackedMask[idx]) {
      setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
      return;
    }
    self._sendChunk(idx)
      .then(function() {
        self._nativeFails = 0;
        setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
      })
      .catch(function(err) {
        // Ronda 2766 (revisión): como al enviar la ventana. Antes se reintentaba cada 200 ms por el mismo enlace hasta el
        // tiempo máximo (45 s un texto, hasta 15 min un archivo), también por una conexión que resultó ser de otro
        if (self.aborted) return;
        // #dueño 08-11: respaldo Fénix de fondo sobre un Bluetooth atascado → rendir YA (igual que en _sendWindow).
        if (self._bgShouldYieldBle()) { self._giveUpPending(); return; }
        if (self._sendFailed(idx, err)) setTimeout(function() { sendNext(idx); }, self._nativeFails > 10 ? 1000 : 200);
      });
  }
  sendNext(self.windowStart);
};
var NACK_MIN_GAP_MS = 1000;   // 2995: un reenvío por NACK como mucho por segundo y flujo
ChatStream.prototype.handleNack = function(indices) {
  var self = this;
  if (self.aborted) return;
  indices = indices || [];
  // 2995 (diagnóstico del dueño 10-11 12:39, APK de 25 MB S24→vivo): el receptor repetía «faltan 0…95» cada ~150 ms y CADA aviso
  // reenviaba todos esos trozos y, si el envío fallaba (los relés no respondían), encadenaba otra vuelta de la ventana a los
  // 500 ms: ~100 reenvíos de la misma ventana en 10 s (más de 100 cadenas a la vez) y el registro lleno de líneas «handleNack».
  // Ahora hay UN reenvío por NACK en curso: los avisos que llegan mientras tanto se juntan y se atienden de una vez al acabar.
  if (self._nackBusy && Date.now() - (self._nackBusyAt || 0) < 20000) {   // (20 s de seguro por si un envío no vuelve nunca)
    self._nackPend = self._nackPend || {};
    indices.forEach(function(i) { self._nackPend[i] = true; });
    self._nackMerged = (self._nackMerged || 0) + 1;
    return;
  }
  self._nackBusy = true; self._nackBusyAt = Date.now();
  console.log('[ChatStream] handleNack: ' + indices.length + ' trozo(s)' + (indices.length ? ' [' + indices[0] + '…' + indices[indices.length - 1] + ']' : '') + (self._nackMerged ? ' (' + self._nackMerged + ' avisos juntados)' : '') + ' msgId=' + self.msgId);
  self._nackMerged = 0;
  if (self.timer) clearTimeout(self.timer);
  var promises = [];
  indices.forEach(function(idx) {
    if (idx >= 0 && idx < self.total) {
      self.sentMask[idx] = true;
      promises.push(self._sendChunk(idx));
    }
  });
  function done(failed) {
    // como mucho un reenvío por NACK cada NACK_MIN_GAP_MS (aunque el envío fallara al instante): los avisos de ese rato se juntan
    var wait = Math.max(0, NACK_MIN_GAP_MS - (Date.now() - self._nackBusyAt));
    setTimeout(function() {
      self._nackBusy = false;
      if (self.aborted) return;
      var pend = Object.keys(self._nackPend || {}).map(Number);
      self._nackPend = {};
      if (pend.length) { self.handleNack(pend); return; }
      if (failed) { if (!self._retxQueued) { self._retxQueued = true; setTimeout(function() { self._retxQueued = false; if (!self.aborted) self._retransmitWindow(); }, 500); } }
      else self._startWindowTimer();
    }, wait);
  }
  Promise.all(promises).then(function() { done(false); }).catch(function() { done(true); });
};
ChatStream.prototype.handleFinalAck = function() {
  console.log('[ChatStream] handleFinalAck msgId=' + this.msgId);
  if (this.timer) clearTimeout(this.timer);
  this._finish();
};
ChatStream.prototype._finish = function() {
  if (this.aborted) return;
  console.log('[ChatStream] _finish msgId=' + this.msgId);
  this.aborted = true;
  try { this.ackSystem._mtuDeferSince.delete(this.msgId); } catch (e) {} // #B2: entregado → fuera del registro de aplazados
  if (this.timer) clearTimeout(this.timer);
  if (this.globalTimeout) clearTimeout(this.globalTimeout);
  // Velocidad real por salto (la usa el selector de camino de Jump)
  var relay = this.ackSystem.ble && this.ackSystem.ble.relay;
  if (relay && this.type === 'file') relay.noteSpeed(this.content.length, Date.now() - this.startTime);
  // 3081: velocidad real de este envío directo hasta la ✓✓ (para el diagnóstico y el resumen diario)
  if (this.type === 'file' && !this.meta.fwd && !this.meta.dst && !_isFenixTx(this.meta) && typeof window.NEXO_noteSpeed === 'function') {
    try { window.NEXO_noteSpeed(_isLanDevice(this.deviceId) ? 'wifi' : (_isNetDevice(this.deviceId) ? 'internet' : 'bluetooth'), 'out', Math.round(String(this.content || '').length * 3 / 4), Date.now() - this.startTime); } catch (e) {}
  }
  // Jump: el ack final de un puente es custodia (✓); el ✓✓ llega con el ack del destino
  if (!this.meta.fwd) this.ackSystem._dispatchStatus(this.msgId, this.meta.dst ? 'sent' : 'delivered');
  // v3.4.0: entregado → fuera del registro de salientes (si no, se reenviaba al abrir la app o reconectar)
  if (window.vaultRemoveOutgoingTransfer && !this.meta.fwd) {
    window.vaultRemoveOutgoingTransfer(this.meta.dst || this.ackSystem._resolveNexoId(this.deviceId), this.msgId).catch(function(){});
  }
  // NO disparar fileComplete en el emisor: el receptor lo emite al ensamblar.
  // Antes se enviaba data=null y podía interferir con listeners.
  if (this.type === 'file' && !this.meta.fwd) {
    this.ackSystem._dispatchFileProgress(this.msgId, this.total, this.total, this.meta.dst ? 'sent' : 'delivered', 100);
  }
  if (this.resolve) {
    this.resolve();
    this.resolve = null;
    this.reject = null;
  }
};
ChatStream.prototype.abort = function() {
  console.log('[ChatStream] abort msgId=' + this.msgId);
  this.aborted = true;
  if (this.timer) clearTimeout(this.timer);
  if (this.globalTimeout) clearTimeout(this.globalTimeout);
  if (this._windowResolve) {
    this._windowResolve();
    this._windowResolve = null;
    this._windowReject = null;
  }
  if (this.reject) this.reject(new Error('Abortado'));
};

export { ChatStream };
