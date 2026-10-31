// Llamadas por INTERNET + reconexión (#dueño 31-10). Prueba de UNIDAD de calls.js con un `ble` de prueba:
//  - El enlace de una llamada puede ser Wi-Fi (lan:), Bluetooth o INTERNET (net:); el vídeo va por Wi-Fi o internet
//    (por Bluetooth solo voz). Sin ningún camino, no se puede llamar.
//  - En una llamada activa: si deja de llegar voz, a los pocos segundos entra en «Reconectando…» (estado reconnecting)
//    y, si no se restablece dentro del margen, se corta con motivo 'lost' (la pantalla, en calls_ui, ofrece «Volver a
//    llamar» 5 s y vuelve al chat; eso se prueba en el navegador).
// Los tiempos se aceleran con window.NEXO_CALL_WEAK_MS / NEXO_CALL_RECONNECT_MS. Uso: node callrecon.js
'use strict';
const { webcrypto } = require('crypto');
if (!global.crypto) global.crypto = webcrypto;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let events = [];
global.window = { dispatchEvent(ev) { if (ev && ev.type === 'nexo:call') events.push(ev.detail); return true; }, NEXO_CALL_WEAK_MS: 500, NEXO_CALL_RECONNECT_MS: 2500, NEXO_CALL_RING_MS: 60000 };
global.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };

// `ble` de prueba con enlaces conmutables (bt / wifi / net)
function makeBle(nx, caps) {
  return {
    localNexoId: 'nxself00001',
    _quietOut: new Set(), _callOut: new Set(),
    _bleReadyFor() { return caps.bt ? ('BT:' + nx) : null; },
    lan: { quality() { return { up: !!caps.wifi }; }, canReach() { return !!caps.wifi; } },
    net: { canReach() { return !!caps.net; }, mailboxOk() { return false; } },
    sendChatMessage() { return Promise.resolve(); },
    _sendMessageNative() { return Promise.resolve(); },
  };
}
function mockMedia() { return { start() { return Promise.resolve({ codec: 'opus', mic: true }); }, stop() {}, mute() {} }; }

(async () => {
  const r = { prueba: 'callrecon' };
  const { createCalls } = await import('../../src/ui/calls.js');
  const NX = 'nxb0000002';

  // 1) Transporte: internet (net:) permitido para llamar Y para vídeo
  let calls = createCalls(makeBle(NX, { net: true }), mockMedia);
  r.net_link = calls._link(NX) === 'net:' + NX;
  r.net_canCall = calls.canCall(NX) === true;
  r.net_canVideo = calls.canVideo(NX) === true;

  // 2) Wi-Fi gana al resto; Bluetooth solo voz (no vídeo); sin nada, no se puede
  calls = createCalls(makeBle(NX, { wifi: true, net: true }), mockMedia);
  r.wifi_pref = calls._link(NX) === 'lan:' + NX && calls.canVideo(NX) === true;
  calls = createCalls(makeBle(NX, { bt: true }), mockMedia);
  r.bt_voz = calls._link(NX) === 'BT:' + NX && calls.canCall(NX) === true && calls.canVideo(NX) === false;
  calls = createCalls(makeBle(NX, {}), mockMedia);
  r.nada_no_llama = calls._link(NX) === null && calls.canCall(NX) === false;

  // 3) Reconexión: una llamada activa que deja de recibir → «Reconectando…» → se corta con 'lost'
  calls = createCalls(makeBle(NX, { net: true }), mockMedia);
  events = [];
  calls.call = { id: 'cl1', nx: NX, dir: 'out', state: 'calling', key: 'k', createdAt: Date.now(), sendSeq: 0, vSeq: 0, lastRx: 0, video: false };
  calls._begin(); // pasa a activa y arranca el vigilante (no alimentamos voz entrante)
  await sleep(1300); // > WEAK(500): debe estar reconectando
  r.reconnecting = !!(calls.call && calls.call.reconnecting) && events.some((e) => e && e.reconnecting === true);
  await sleep(2200); // total > RECONNECT(2500): se corta
  const fin = events.filter((e) => e && e.state === 'ended').pop();
  r.corta_lost = !!fin && fin.reason === 'lost';
  r.llamada_cerrada = calls.call === null;

  const ok = r.net_link && r.net_canCall && r.net_canVideo && r.wifi_pref && r.bt_voz && r.nada_no_llama &&
    r.reconnecting && r.corta_lost && r.llamada_cerrada;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLRECON ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('CALLRECON FALLO:', e && e.stack); process.exit(1); });
