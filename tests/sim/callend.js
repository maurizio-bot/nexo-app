// #dueño 01-11 («cuando cuelgo/termino la llamada en un teléfono, el otro SIGUE SONANDO»): la señal de colgar (end), y
// también reject/busy/accept, se mandaban SOLO por el enlace vivo (sendChatMessage). Si ese enlace es un Bluetooth con
// MTU 23 congestionado (o parpadea), la señal se atasca y el otro no se entera → sigue sonando hasta el timeout del
// timbre. La OFERTA ya se dejaba además en el buzón de relés; ahora end/reject/busy/accept también. Así el otro recibe
// el «colgué» por internet aunque el enlace vivo falle. ring/hold/unhold NO van al buzón (handshake frecuente).
// Esta prueba comprueba la lógica pura de _signal (a qué caminos va cada señal).
// Uso: node callend.js [buildDir]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'callend' };
  const { createCalls } = await importSrc('ui/calls.js');

  const mk = (mailboxOk) => {
    const sent = [], box = [];
    const ble = {
      localNexoId: 'nxa0000001',
      sendChatMessage: function (nx, json, mid) { try { sent.push(JSON.parse(json).op); } catch (e) {} return Promise.resolve(); },
      _sendViaNetMailbox: function (nx, json, mid) { try { box.push(JSON.parse(json).op); } catch (e) {} return Promise.resolve(); },
      net: { mailboxOk: function () { return mailboxOk !== false; } },
      _callOut: new Set(), _quietOut: new Set(),
    };
    const calls = createCalls(ble, function () { return { mute: function () {}, wake: function () {} }; });
    calls.call = { id: 'c1', nx: 'nxb0000002', dir: 'out', state: 'calling' };
    return { calls, ble, sent, box };
  };

  // Para cada señal: ¿sale por el enlace vivo? ¿se deja también en el buzón?
  const probe = (op) => { const t = mk(true); t.calls._signal('nxb0000002', op, { id: 'c1' }); return { live: t.sent.indexOf(op) >= 0, box: t.box.indexOf(op) >= 0 }; };

  const offer = probe('offer'), end = probe('end'), reject = probe('reject'), busy = probe('busy'), accept = probe('accept'), ring = probe('ring'), hold = probe('hold');
  r.offer = offer; r.end = end; r.reject = reject; r.busy = busy; r.accept = accept; r.ring = ring; r.hold = hold;

  // Sin internet (mailboxOk false): la señal sale igual por el enlace vivo y NO revienta ni intenta buzón
  const nf = mk(false); nf.calls._signal('nxb0000002', 'end', { id: 'c1' });
  r.sin_internet = { live: nf.sent.indexOf('end') >= 0, box: nf.box.length === 0 };

  const ok =
    offer.live && offer.box &&
    end.live && end.box &&           // ← el arreglo: colgar se replica al buzón
    reject.live && reject.box &&
    busy.live && busy.box &&
    accept.live && accept.box &&
    ring.live && !ring.box &&        // handshake: no al buzón
    hold.live && !hold.box &&
    r.sin_internet.live && r.sin_internet.box;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLEND ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('CALLEND FALLO:', e && e.stack); process.exit(1); });
