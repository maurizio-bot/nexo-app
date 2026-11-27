// 3353 (dueño 27-11, diag. S24 23:33, build 3161; diseño docs/ENRUTADO_27-11.md §4): al volver a la app, 2 textos pendientes a un
// contacto que no confirma (4 trozos de 8000 c. cada uno) se republicaban por internet en cada vencimiento de ventana, 8 veces en 85 s
// (~70 sobres de ~8 KB) → damus «banned: too many rate-limit violations». Por internet el relé YA guarda lo publicado: un trozo que un
// relé guardó no se vuelve a publicar (ni en el mismo flujo ni en la siguiente vuelta de pendientes) durante 30 min; se espera el ✓✓
// con UN calendario (toque + revisar en 15 → 30 → 60 → 120 s) y a los 10 min queda ⏳. Con contraprueba: sin «guardado» se reenvía como
// siempre; archivos y puentes no cambian. Uso: node reenvionet.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'reenvionet' };
  const { ChatStream } = await importSrc('ui/chat_stream.js');
  const timers = [];
  const make = (over) => {
    const st = Object.create(ChatStream.prototype);
    const status = [];
    let sends = 0, wakes = 0;
    Object.assign(st, {
      aborted: false, type: 'chat', deviceId: 'net:nxb0000001', msgId: 'msgprueba01', meta: {}, total: 4, windowStart: 0, windowSize: 4,
      ackedMask: [false, false, false, false], sentMask: [true, true, true, true], _windowStartAtSend: 0, _windowEndAtSend: 4,
      windowTimeoutMs: 3800, startTime: Date.now() - 120000, windowRetryCount: 0, maxWindowRetries: 8, pacingDelayMs: 0, chunks: ['a', 'b', 'c', 'd'],
      ackSystem: { _resolveNexoId: () => 'nxb0000001', _dispatchStatus: (id, s) => status.push(s), _otherProgressing: () => false, outgoingStreams: new Map(), _netStored: shared },
      ble: { net: { resync() {}, wakeKeepAlive() { wakes++; }, canReach: () => true, online: () => true } },
      _sendChunk() { sends++; return Promise.resolve(); },
      _startWindowTimer(ms) { timers.push(ms || this.windowTimeoutMs); },
      _linkUp: () => true,
    }, over || {});
    return { st, status, get sends() { return sends; }, get wakes() { return wakes; } };
  };
  let shared = new Map();

  // (1) EL CASO: 4 trozos publicados (cada uno guardado por un relé) y el otro no confirma: 10 vencimientos seguidos → 0 republicaciones,
  // ningún reintento gastado, toque en cada uno, y la espera crece hasta 2 min.
  const a = make();
  for (let i = 0; i < 4; i++) a.st._noteNetStored(i);
  timers.length = 0;
  for (let k = 0; k < 10; k++) a.st._onWindowTimeout();
  r.vencimientos_sin_republicar = a.sends === 0;
  r.no_gasta_reintentos = a.st.windowRetryCount === 0;
  r.toque_cada_vez = a.wakes === 10;
  r.espera_crece = JSON.stringify(timers.slice(0, 5)) === JSON.stringify([15000, 30000, 60000, 120000, 120000]);

  // (2) Siguiente VUELTA de pendientes (flujo nuevo, mismo mensaje): ya guardado → no se republica nada
  const b = make();
  r.vuelta_nueva_sabe_guardado = b.st._netWindowStored() === true && b.st._netStoredRecently(0) === true;

  // (3) A los 10 min sin ✓✓: queda ⏳ (pendiente), sin republicar
  const c = make();
  c.st._storedSince = Date.now() - 11 * 60 * 1000;
  let gave = false; c.st._giveUpPending = () => { gave = true; };
  c.st._onWindowTimeout();
  r.diez_min_pendiente = gave && c.status.indexOf('pending') >= 0 && c.sends === 0;

  // (4) Pasados 30 min del guardado: ya no cuenta (se puede republicar una vez)
  const viejo = shared.get('msgprueba01'); Object.keys(viejo.idx).forEach((k) => { viejo.idx[k] -= 31 * 60 * 1000; });
  r.guardado_caduca = make().st._netStoredRecently(0) === false;

  // CONTRAPRUEBAS
  // (5) Sin «guardado» (el relé no lo tomó): reintento de siempre (gasta reintento y reenvía la ventana)
  shared = new Map();
  const d = make(); let retx = 0; d.st._retransmitWindow = () => { retx++; };
  d.st._onWindowTimeout();
  r.sin_guardado_reenvia = retx === 1 && d.st.windowRetryCount === 1;
  // (6) Un ARCHIVO por internet no entra aquí (tiene su sondeo propio)
  const e = make({ type: 'file' }); e.st._noteNetStored(0);
  r.archivo_no_cambia = !(shared.get('msgprueba01')) && e.st._netWindowStored() === false;
  // (7) Por Bluetooth (también un puente por Bluetooth) no entra aquí
  const g = make({ deviceId: 'AA:BB:CC:DD:EE:01', meta: { dst: 'nxc' } }); g.st._noteNetStored(0);
  r.bt_no_cambia = shared.size === 0;
  // (7b) EL CASO DEL DIAG. 23:33: lo que este teléfono guarda para otro (meta.dst) y sale por INTERNET sí entra: no se republica
  const f = make({ meta: { dst: 'nxb0000001', fwd: true } }); for (let i = 0; i < 4; i++) f.st._noteNetStored(i);
  for (let k = 0; k < 8; k++) f.st._onWindowTimeout();
  r.puente_por_internet_no_republica = f.sends === 0 && f.st.windowRetryCount === 0;
  shared.delete('msgprueba01');
  // (8) Si el otro ya confirmó parte, solo cuentan los trozos sin confirmar
  const h = make(); h.st._noteNetStored(2); h.st._noteNetStored(3); h.st.ackedMask = [true, true, false, false];
  r.solo_sin_confirmar = h.st._netWindowStored() === true;
  h.st.ackedMask = [true, false, false, false];
  r.falta_uno_sin_guardar = h.st._netWindowStored() === false;

  const ok = Object.keys(r).filter((k) => k !== 'prueba').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REENVIONET ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('REENVIONET FALLO:', e && e.stack); process.exit(1); });
