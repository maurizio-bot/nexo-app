// #dueño 02-11 (ConnectionService parte 2): la llamada SALIENTE de NEXO también se presenta por Telecom (self-managed),
// como la entrante de la parte 1. Así el sistema la trata como una llamada de verdad (convivencia con una llamada del
// teléfono, mandos del coche/auriculares/reloj, foco de audio) y se puede colgar desde el sistema.
// calls.js avisa al nativo del ciclo de vida: 'out' al empezar a llamar, 'active' cuando el otro contesta, 'end' al
// terminar. Es ADITIVO y con respaldo: si el nativo (o Telecom) no está, NEXO llama EXACTAMENTE como hasta ahora.
// Esta prueba ejercita el medio JS (el puente p.telecom); el nativo lo confirman el compilado de CI y el dueño en los
// teléfonos. Uso: node telecom.js [buildDir]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'telecom' };
  const { createCalls } = await importSrc('ui/calls.js');

  // Grabador del puente nativo p.telecom({op,...})
  const rec = [];
  global.window = { Capacitor: { Plugins: { NexoBLE: { telecom: function (o) { rec.push(o); return Promise.resolve({ ok: true }); } } } } };

  // ble de mentira: enlace Wi-Fi disponible (para que start() proceda, también en videollamada), sin buzón ni envíos reales
  const mkBle = () => ({
    localNexoId: 'nxa0000001',
    _bleReadyFor: function () { return null; },
    lan: { canReach: function () { return true; }, quality: function () { return { up: true }; } },
    net: { mailboxOk: function () { return false; }, canReach: function () { return false; } },
    sendChatMessage: function () { return Promise.resolve(); },
    _sendViaNetMailbox: function () { return Promise.resolve(); },
    _callOut: new Set(), _quietOut: new Set(),
  });
  const media = function () { return { mute: function () {}, wake: function () {} }; };

  // A) Ciclo completo de una llamada de voz saliente: out → active → end
  const callsA = createCalls(mkBle(), media);
  callsA.start('nxb0000002', false).catch(function () {});   // 'out' (síncrono, antes de la promesa de cifrado)
  callsA._begin();                                           // el otro contestó → 'active'
  callsA.hangup();                                           // colgar → 'end' (y limpia temporizadores)
  const opsA = rec.map(function (x) { return x.op; });
  const outA = rec.find(function (x) { return x.op === 'out'; });
  r.voz = { ops: opsA, to: outA && outA.to, video: outA && outA.video };
  const vozOk = opsA[0] === 'out' && outA && outA.to === 'nxb0000002' && outA.video === false &&
    opsA.indexOf('active') >= 0 && opsA[opsA.length - 1] === 'end';

  // B) Videollamada saliente: el puente lleva video:true
  rec.length = 0;
  const callsB = createCalls(mkBle(), media);
  callsB.start('nxb0000003', true).catch(function () {});
  const outB = rec.find(function (x) { return x.op === 'out'; });
  r.video = { to: outB && outB.to, video: outB && outB.video };
  callsB.hangup();
  const videoOk = outB && outB.video === true && outB.to === 'nxb0000003';

  // C) Respaldo (aditivo): si el nativo NO tiene p.telecom, la llamada funciona igual y NO se graba nada ni revienta
  rec.length = 0;
  global.window.Capacitor.Plugins.NexoBLE = {};  // sin método telecom
  const callsC = createCalls(mkBle(), media);
  let threw = false;
  try { callsC.start('nxb0000004', false).catch(function () {}); callsC._begin(); callsC.hangup(); } catch (e) { threw = true; }
  r.respaldo = { threw: threw, grabados: rec.length };
  const fbOk = !threw && rec.length === 0;

  const ok = vozOk && videoOk && fbOk;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TELECOM ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('TELECOM FALLO:', e && e.stack); process.exit(1); });
