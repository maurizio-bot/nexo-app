// #221 (dueño 15-11: «agregué otro dispositivo…»; pendiente: al «Agregar» a alguien a una llamada 1-a-1, el que ya estaba tenía que
// volver a contestar la de grupo). Prueba de UNIDAD de group_call.js (como gcall.js, con un `ble` de prueba):
//  U1  B estaba hablando con A (llamada 1-a-1 «cl1», ya colgada por el «Agregar»): la invitación de grupo de A lleva up:cl1 → B entra
//      SOLO (sin sonar ni contestar); C suena como siempre y al contestar la malla queda completa;
//  U2  el «colgar» de la 1-a-1 aún no le llegó a B (sigue activa con A): B la cierra él (sin avisar) y entra solo;
//  U3  un id que no es el de la llamada que tuvo con A, o una que terminó hace más de 20 s: suena como siempre;
//  U4  C nunca estuvo en llamada con A: aunque la invitación lleve up, suena como siempre.
//  U5  (3152) «en espera» de una llamada de grupo (hold/unhold, #222) se entiende como señal (antes no pasaba del filtro y llegaba al
//      chat como un mensaje más; el otro nunca sabía que estaba en espera).
//  U0  (lo destapó U1) sin «Agregar»: B contesta enseguida y C más tarde: el tramo B–C también se forma (antes, el «abrir tramo» de B
//      le llegaba a C mientras sonaba y se perdía: B y C no se oían).
// Uso: node gcupgrade.js [dir_build]   (importa src/ui/group_call.js del build)
'use strict';
const { webcrypto } = require('crypto');
if (!global.crypto) global.crypto = webcrypto;
if (typeof global.btoa !== 'function') global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
if (typeof global.atob !== 'function') global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
const _events = [];
if (typeof global.CustomEvent !== 'function') global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
global.window = { dispatchEvent(ev) { _events.push(ev); }, NEXO_GCALL_RING_MS: 45000 };
const { importSrc } = require('./srcmod');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _n = (x) => (x || '').toString().toLowerCase().trim();

const registry = {};         // nx → instancia GroupCall
function makeBle(nx) {
  return {
    localNexoId: nx,
    calls: { call: null, lastEnded: null, finished: [], _finish(why, notify) { this.finished.push([why, notify]); if (this.call) this.lastEnded = { id: this.call.id, nx: this.call.nx, at: Date.now(), active: true }; this.call = null; } },
    calls2: { call: null, lastEnded: null, _finish() { this.call = null; } },
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
  const r = { prueba: 'gcupgrade' };
  const { createGroupCall, parseGroupCallSignal } = await importSrc('ui/group_call.js');
  r.U5_espera_es_senal = ['hold', 'unhold'].every((op) => !!parseGroupCallSignal(JSON.stringify({ type: 'nexo_gcall', op, gid: 'gc12345678', from: 'nxa0000001', to: 'nxb0000002', ts: Date.now() })));
  const A_ID = 'nxa0000001', B_ID = 'nxb0000002', C_ID = 'nxc0000003';
  async function setup() {
    for (const k of Object.keys(registry)) delete registry[k];
    const rec = { A: { played: [] }, B: { played: [] }, C: { played: [] } };
    const A = createGroupCall(makeBle(A_ID), makeHub(rec.A)), B = createGroupCall(makeBle(B_ID), makeHub(rec.B)), C = createGroupCall(makeBle(C_ID), makeHub(rec.C));
    registry[A_ID] = A; registry[B_ID] = B; registry[C_ID] = C;
    return { A, B, C };
  }
  // U0: B contesta a los 0,2 s y C a los 1,5 s (sin «Agregar»)
  let { A, B, C } = await setup();
  await A.start([B_ID, C_ID]); await sleep(200); B.accept(); await sleep(1300); C.accept(); await sleep(300);
  r.U0_B_C = legState(B, C_ID); r.U0_C_B = legState(C, B_ID);
  r.U0_malla_escalonada = r.U0_B_C === 'active' && r.U0_C_B === 'active';
  A.hangup && A.hangup(); B.hangup && B.hangup(); C.hangup && C.hangup(); await sleep(50);
  const rings = () => _events.filter((e) => e.type === 'nexo:gcallRing').map((e) => e.detail && e.detail.gid);
  // U1: la 1-a-1 de B con A ya terminó (por el «Agregar» de A)
  ({ A, B, C } = await setup());
  B.ble.calls.lastEnded = { id: 'cl1', nx: A_ID, at: Date.now() - 1500, active: true };
  _events.length = 0;
  await A.start([B_ID, C_ID], false, null, { upgrade: { nx: B_ID, id: 'cl1' } });
  await sleep(120);
  r.U1_B_entra_solo = !!(B.gc && B.gc.state === 'active');
  r.U1_B_no_suena = rings().length === 1; // solo C
  r.U1_C_suena = !!(C.gc && C.gc.state === 'ringing');
  r.U1_A_activa = !!(A.gc && A.gc.state === 'active');
  C.accept(); await sleep(150);
  r.U1_malla = legState(A, B_ID) === 'active' && legState(A, C_ID) === 'active' && legState(B, C_ID) === 'active' && legState(C, B_ID) === 'active';
  A.hangup && A.hangup(); B.hangup && B.hangup(); C.hangup && C.hangup(); await sleep(50);
  // U2: el «colgar» de la 1-a-1 aún no llegó: B sigue en ella con A
  ({ A, B, C } = await setup());
  B.ble.calls.call = { id: 'cl2', nx: A_ID, state: 'active' };
  await A.start([B_ID, C_ID], false, null, { upgrade: { nx: B_ID, id: 'cl2' } });
  await sleep(120);
  r.U2_cierra_la_suya = B.ble.calls.call === null && B.ble.calls.finished.length === 1 && B.ble.calls.finished[0][1] === false;
  r.U2_B_entra_solo = !!(B.gc && B.gc.state === 'active');
  A.hangup && A.hangup(); B.hangup && B.hangup(); C.hangup && C.hangup(); await sleep(50);
  // U3: otro id, u otra que terminó hace más de 20 s → suena
  ({ A, B, C } = await setup());
  B.ble.calls.lastEnded = { id: 'cl3', nx: A_ID, at: Date.now() - 1000, active: true };
  await A.start([B_ID, C_ID], false, null, { upgrade: { nx: B_ID, id: 'otro' } });
  await sleep(120);
  r.U3_id_ajeno_suena = !!(B.gc && B.gc.state === 'ringing');
  A.hangup && A.hangup(); B.reject && B.reject(); C.reject && C.reject(); await sleep(50);
  ({ A, B, C } = await setup());
  B.ble.calls.lastEnded = { id: 'cl4', nx: A_ID, at: Date.now() - 25000, active: true };
  await A.start([B_ID, C_ID], false, null, { upgrade: { nx: B_ID, id: 'cl4' } });
  await sleep(120);
  r.U3_viejo_suena = !!(B.gc && B.gc.state === 'ringing');
  A.hangup && A.hangup(); B.reject && B.reject(); C.reject && C.reject(); await sleep(50);
  // U4: invitación con up a C (que no estuvo en llamada con A) → suena
  ({ A, B, C } = await setup());
  await A.start([B_ID, C_ID], false, null, { upgrade: { nx: C_ID, id: 'cl1' } });
  await sleep(120);
  r.U4_ajeno_suena = !!(C.gc && C.gc.state === 'ringing');
  const ok = r.U5_espera_es_senal && r.U0_malla_escalonada && r.U1_B_entra_solo && r.U1_B_no_suena && r.U1_C_suena && r.U1_A_activa && r.U1_malla && r.U2_cierra_la_suya && r.U2_B_entra_solo && r.U3_id_ajeno_suena && r.U3_viejo_suena && r.U4_ajeno_suena;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GCUPGRADE ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('GCUPGRADE ' + JSON.stringify({ prueba: 'gcupgrade', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
