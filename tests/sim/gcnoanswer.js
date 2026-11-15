// 3100 (dueño 15-11: «agregué otro dispositivo, pero nunca le apareció o nunca aceptó, entonces quedó ahí»; S24 3054 14-11
// 16:15–16:19: la llamada de grupo siguió 4 min con el invitado en «Conectando…»). La llamada pasa a activa con el primero que
// contesta; el que no contesta quedaba «invitando» para siempre. Prueba de unidad de group_call.js (A, B y X; X nunca contesta):
//  N1  A llama a B y X; B contesta: a los 45 s (aquí 1,5 s) X queda «no contestó» y sale de la llamada (antes, «invitando» siempre);
//  N2  en la llamada A↔B, A agrega a Y, que no contesta: a los 45 s, «no contestó»;
//  N3  B cuelga: A, solo con invitados que no contestaron, termina la llamada (no queda abierta sin nadie).
// Uso: node gcnoanswer.js
'use strict';
const { webcrypto } = require('crypto');
if (!global.crypto) global.crypto = webcrypto;
if (typeof global.btoa !== 'function') global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
if (typeof global.atob !== 'function') global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
// Captura de eventos (nexo:gcall / nexo:gcallEnded) para la prueba de reconexión (#130). Polyfill mínimo de CustomEvent
// (en node pelado no existe; group_call._emit lo usa y, sin él, no emitiría nada).
const _events = [];
if (typeof global.CustomEvent !== 'function') global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
global.window = { dispatchEvent(ev) { _events.push(ev); }, NEXO_GCALL_RING_MS: 1500 };
// Dueño 13-11, compartir pantalla parte 2: el nativo de prueba (permiso concedido; las imágenes y el «Android la paró» se
// disparan a mano por sus oyentes)
const scr = { starts: [], stops: 0, ls: {} };
global.window.Capacitor = { Plugins: { NexoBLE: {
  screenShareStart(o) { scr.starts.push(o); return Promise.resolve({ granted: true }); },
  screenShareStop() { scr.stops++; return Promise.resolve(); },
  addListener(ev, fn) { (scr.ls[ev] = scr.ls[ev] || []).push(fn); return Promise.resolve({ remove() {} }); },
} } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _n = (x) => (x || '').toString().toLowerCase().trim();

const registry = {};         // nx → instancia GroupCall
function makeBle(nx) {
  return {
    localNexoId: nx,
    _quietOut: new Set(), _callOut: new Set(),
    lan: { quality() { return { up: true }; }, canReach() { return true; } },
    net: { mailboxOk() { return false; } },
    _bleReadyFor() { return null; },
    sendChatMessage(toNx, json, mid) {
      setTimeout(() => { const t = registry[_n(toNx)]; if (!t) return; let o; try { o = JSON.parse(json); } catch (e) { return; } if (o && o.type === 'nexo_gcall') t.onSignal(nx, o); }, 0);
      return Promise.resolve();
    },
    _sendMessageNative(link, json) {
      const toNx = String(link).indexOf('lan:') === 0 ? String(link).slice(4) : String(link);
      setTimeout(() => { const t = registry[_n(toNx)]; if (!t) return; let p; try { p = JSON.parse(json); } catch (e) { return; } if (p && p.type === 'vf') t.onFrame(p, 'lan'); }, 0);
      return Promise.resolve();
    },
  };
}
function makeHub(rec) {
  rec.playedV = rec.playedV || []; // #138: imágenes recibidas por tramo
  return function (opts) {
    const hub = {
      _onPacket: opts.onPacket, _onVideoPacket: opts.onVideoPacket, started: false, camOn: false, opts: opts,
      start() { hub.started = true; return Promise.resolve({ codec: 'opus' }); },
      stop() { hub.started = false; },
      play(nx, bytes) { rec.played.push({ nx: nx, len: bytes.length }); },
      playVideo(nx, bytes) { rec.playedV.push({ nx: nx, len: bytes.length }); }, // #138: imagen de un tramo
      camera(on) { hub.camOn = !!on; },  // #138: encender/apagar MI cámara
      flip() { hub.flipped = true; return Promise.resolve('user'); }, // #138
      mute(on) { hub.muted = !!on; },  // #dueño 31-10: silenciar la captura compartida
      screen(on) { hub.scrOn = !!on; }, screenFrame(d, w, h) { hub.scrFrames = (hub.scrFrames || 0) + 1; hub.scrLast = [d, w, h]; }, // 13-11: compartir pantalla
      emit(bytes) { hub._onPacket(bytes); },  // simula salida del micrófono
      emitVideo(bytes) { if (hub._onVideoPacket) hub._onVideoPacket(bytes); },  // #138: simula imagen de la cámara
    };
    rec.hub = hub; return hub;
  };
}
function legState(inst, nx) { const l = inst.gc && inst.gc.legs.get(_n(nx)); return l ? l.state : null; }


(async () => {
  const r = { prueba: 'gcnoanswer' };
  const { createGroupCall } = await import('../../src/ui/group_call.js');
  const A_ID = 'nxa0000001', B_ID = 'nxb0000002', X_ID = 'nxx0000009', Y_ID = 'nxy0000008';
  const recA = { played: [] }, recB = { played: [] };
  const A = createGroupCall(makeBle(A_ID), makeHub(recA));
  const B = createGroupCall(makeBle(B_ID), makeHub(recB));
  registry[A_ID] = A; registry[B_ID] = B; // X e Y no tienen la app abierta: nunca contestan
  await A.start([B_ID, X_ID]);
  await sleep(150);
  B.accept();
  await sleep(300);
  r.activa = !!(A.gc && A.gc.state === 'active');
  r.X_antes = legState(A, X_ID);
  await sleep(1800);
  r.N1_X = legState(A, X_ID);
  r.N1_fuera = !!(A.gc && !A.gc.roster.has(X_ID));
  r.N1_sigue = !!(A.gc && A.gc.state === 'active' && legState(A, B_ID) === 'active');
  await A.addMember(Y_ID).catch(() => {});
  await sleep(200);
  r.Y_antes = legState(A, Y_ID);
  await sleep(1800);
  r.N2_Y = legState(A, Y_ID);
  B.hangup();
  await sleep(400);
  r.N3_A_termina = !A.gc;
  const noAns = (s) => s === 'noanswer';
  const ok = r.activa && r.X_antes === 'inviting' && noAns(r.N1_X) && r.N1_fuera && r.N1_sigue && r.Y_antes === 'inviting' && noAns(r.N2_Y) && r.N3_A_termina;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GCNOANSWER ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('GCNOANSWER ' + JSON.stringify({ prueba: 'gcnoanswer', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); process.exit(1); });
