// GRAVE (diagnóstico real del dueño 01-11): con la videollamada por internet en curso (vídeo funcionando) entró una
// llamada TELEFÓNICA y la videollamada se cortó/trabó. Lo que se quiere (como WhatsApp): la telefónica NO corta la de
// NEXO — si se rechaza, sigue estable; si se acepta, la de NEXO se PAUSA y al terminar la telefónica VUELVE sola.
// Causa: el vigilante corta a los 15 s sin audio (y entra en «Reconectando…»), así que al perder el micro por la
// telefónica los DOS lados cortaban por silencio. Arreglo: el nativo avisa del foco de audio (onCallInterruption);
// calls RETIENE la llamada (held): silencia el micro, avisa al otro (hold) para que su vigilante tampoco corte, y al
// volver el foco reanuda (unhold, micro restaurado, vigilante reiniciado). Esta prueba comprueba la lógica pura.
// Uso: node callhold.js [buildDir]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'callhold' };
  const { createCalls } = await importSrc('ui/calls.js');

  const mk = () => {
    const signals = [], muteCalls = [], woke = { v: false };
    const media = { mute: function (on) { muteCalls.push(!!on); }, wake: function () { woke.v = true; } };
    const calls = createCalls({ localNexoId: 'nxa0000001' }, function () { return media; });
    calls._signal = function (nx, op) { signals.push(op); return Promise.resolve(); }; // capturar, sin red real
    // llamada activa de salida con el otro
    calls.call = { id: 'c1', nx: 'nxb0000002', dir: 'out', state: 'active', muted: false, media: media,
      startedAt: Date.now(), lastRx: Date.now() - 999999 };
    return { calls, c: calls.call, signals, muteCalls, woke };
  };

  // 1) Entra la telefónica (foco perdido) → RETENER: held, avisar hold, silenciar micro, recordar que no estaba muteado
  const a = mk();
  a.calls._onInterruption(true);
  r.pausa_held = a.c.held === true;
  r.pausa_avisa_hold = a.signals[a.signals.length - 1] === 'hold';
  r.pausa_silencia = a.muteCalls[a.muteCalls.length - 1] === true;
  r.pausa_recuerda_no_muteado = a.c._mutedBefore === false;
  // idempotente: otro aviso de pausa no manda otro 'hold'
  const n1 = a.signals.length; a.calls._onInterruption(true);
  r.pausa_idempotente = a.signals.length === n1;

  // 2) Se rechaza/cuelga la telefónica (foco recuperado) → REANUDAR: held off, avisar unhold, micro restaurado, wake, lastRx fresco
  const tPrev = a.c.lastRx; a.c.lastRx = Date.now() - 999999;
  a.calls._onInterruption(false);
  r.reanuda_held_off = a.c.held === false;
  r.reanuda_avisa_unhold = a.signals[a.signals.length - 1] === 'unhold';
  r.reanuda_restaura_mute = a.muteCalls[a.muteCalls.length - 1] === false; // no estaba muteado → vuelve a false
  r.reanuda_wake = a.woke.v === true;
  r.reanuda_vigilante_fresco = a.c.lastRx > Date.now() - 5000;

  // 3) Preserva el silencio MANUAL del usuario: si estaba muteado, al reanudar sigue muteado
  const b = mk(); b.c.muted = true;
  b.calls._onInterruption(true);
  b.calls._onInterruption(false);
  r.preserva_mute_manual = b.muteCalls[b.muteCalls.length - 1] === true;

  // 4) El OTRO entra/sale de su telefónica (hold/unhold por señal) → peerHeld, y al volver reinicia el vigilante
  const d = mk();
  d.calls.onSignal('nxb0000002', { type: 'nexo_call', op: 'hold', id: 'c1' });
  r.peer_hold = d.c.peerHeld === true;
  d.c.lastRx = Date.now() - 999999;
  d.calls.onSignal('nxb0000002', { type: 'nexo_call', op: 'unhold', id: 'c1' });
  r.peer_unhold = d.c.peerHeld === false && d.c.lastRx > Date.now() - 5000;

  // 5) Sin llamada activa, un aviso de interrupción no hace nada (no revienta)
  const e = mk(); e.calls.call = null;
  e.calls._onInterruption(true); e.calls._onInterruption(false);
  r.sin_llamada_ok = true;

  const ok = r.pausa_held && r.pausa_avisa_hold && r.pausa_silencia && r.pausa_recuerda_no_muteado && r.pausa_idempotente &&
    r.reanuda_held_off && r.reanuda_avisa_unhold && r.reanuda_restaura_mute && r.reanuda_wake && r.reanuda_vigilante_fresco &&
    r.preserva_mute_manual && r.peer_hold && r.peer_unhold && r.sin_llamada_ok;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLHOLD ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('CALLHOLD FALLO:', e && e.stack); process.exit(1); });
