// 3238 (diagnóstico del dueño 18-11 11:43: dos textos por un puente salían «!» a los ~11 s y luego llegaban ✓✓): al agotarse la
// confirmación de un texto que va POR UN PUENTE (dst) el mensaje queda en cola y se reintenta: el estado es «pendiente», no «fallido».
// Uno directo sin confirmar sigue fallido; uno que ya está en el buzón de internet, enviado.
// Uso: node ackpuente.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'ackpuente' };
  const noop = () => {};
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop;
  global.document = global.document || { addEventListener: noop, removeEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop }), body: { appendChild: noop }, documentElement: { style: {} }, visibilityState: 'visible' };
  const m = await importSrc('ui/ble_ack.js');
  const Cls = m.BleAckSystem;
  const caso = (extra, inBox) => {
    const ack = Object.create(Cls.prototype);
    const estados = [];
    ack.pendingAcks = new Map(); ack.maxRetries = 5;
    ack._dispatchStatus = (id, st) => estados.push(st);
    ack.ble = { _netSafeOut: new Set(inBox ? ['m1'] : []) };
    let rechazo = null;
    ack.pendingAcks.set('m1', Object.assign({ msgId: 'm1', retries: 5, reject: (e) => { rechazo = e; } }, extra));
    ack._onAckTimeout('m1');
    return { estados, rechazo };
  };
  const puente = caso({ dst: 'nx1ff9fcf3' }, false);
  const directo = caso({ dst: null }, false);
  const buzon = caso({ dst: 'nx1ff9fcf3' }, true);
  r.puente_pendiente = puente.estados.join() === 'pending';
  r.puente_rechaza_para_la_cola = !!puente.rechazo;
  r.directo_sigue_fallido = directo.estados.join() === 'failed';
  r.buzon_enviado = buzon.estados.join() === 'sent';
  r.resultado = r.puente_pendiente && r.puente_rechaza_para_la_cola && r.directo_sigue_fallido && r.buzon_enviado ? 'OK' : 'FALLO';
  console.log('ACKPUENTE ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('ACKPUENTE ' + JSON.stringify({ prueba: 'ackpuente', error: String(e && e.stack || e).slice(0, 400), resultado: 'FALLO' })); process.exit(1); });
