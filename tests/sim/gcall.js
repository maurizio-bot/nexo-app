// Llamada en grupo (malla) — señalización + tramos + mezcla (build de grupo, Fase 1 audio). Pedido del dueño.
// Prueba de UNIDAD de group_call.js: 3 participantes (A,B,C) con un `ble` de prueba que enruta las señales (nexo_gcall)
// y los paquetes de voz (vf) entre instancias. Verifica: A invita → B,C suenan → aceptan → malla de tramos activa
// (A↔B, A↔C, B↔C, con la regla «NEXO ID menor inicia»); la voz de A llega a B y C (cifrada, AAD por emisor) y se
// «reproduce» por tramo (mezcla); si C cuelga, A y B cierran SU tramo con C y la llamada sigue.
// Uso: node gcall.js   (no necesita build; importa src/ui/group_call.js)
'use strict';
const { webcrypto } = require('crypto');
if (!global.crypto) global.crypto = webcrypto;
if (typeof global.btoa !== 'function') global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
if (typeof global.atob !== 'function') global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
// Captura de eventos (nexo:gcall / nexo:gcallEnded) para la prueba de reconexión (#130). Polyfill mínimo de CustomEvent
// (en node pelado no existe; group_call._emit lo usa y, sin él, no emitiría nada).
const _events = [];
if (typeof global.CustomEvent !== 'function') global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
global.window = { dispatchEvent(ev) { _events.push(ev); }, NEXO_GCALL_RING_MS: 45000 };

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
  return function (opts) {
    const hub = {
      _onPacket: opts.onPacket, started: false,
      start() { hub.started = true; return Promise.resolve({ codec: 'opus' }); },
      stop() { hub.started = false; },
      play(nx, bytes) { rec.played.push({ nx: nx, len: bytes.length }); },
      emit(bytes) { hub._onPacket(bytes); },  // simula salida del micrófono
    };
    rec.hub = hub; return hub;
  };
}
function legState(inst, nx) { const l = inst.gc && inst.gc.legs.get(_n(nx)); return l ? l.state : null; }

(async () => {
  const r = { prueba: 'gcall' };
  const { createGroupCall, parseGroupCallSignal } = await import('../../src/ui/group_call.js');

  const A_ID = 'nxa0000001', B_ID = 'nxb0000002', C_ID = 'nxc0000003';
  const recA = { played: [] }, recB = { played: [] }, recC = { played: [] };
  const A = createGroupCall(makeBle(A_ID), makeHub(recA));
  const B = createGroupCall(makeBle(B_ID), makeHub(recB));
  const C = createGroupCall(makeBle(C_ID), makeHub(recC));
  registry[A_ID] = A; registry[B_ID] = B; registry[C_ID] = C;

  // A inicia la llamada de grupo con B y C
  await A.start([B_ID, C_ID]);
  await sleep(60);
  r.B_suena = B.gc && B.gc.state === 'ringing' && B.gc.host === A_ID;
  r.C_suena = C.gc && C.gc.state === 'ringing';
  r.invita_con_roster = !!(B.gc && B.gc.roster.has(A_ID) && B.gc.roster.has(C_ID));

  // B y C aceptan (casi a la vez: las dos aceptaciones se procesan antes de que se entreguen las señales → malla limpia)
  B.accept(); C.accept();
  await sleep(120);

  // Malla: cada uno activo con cada otro
  r.A_activa = A.gc && A.gc.state === 'active';
  r.A_tramo_B = legState(A, B_ID); r.A_tramo_C = legState(A, C_ID);
  r.B_tramo_A = legState(B, A_ID); r.B_tramo_C = legState(B, C_ID);
  r.C_tramo_A = legState(C, A_ID); r.C_tramo_B = legState(C, B_ID);
  r.malla_completa = [r.A_tramo_B, r.A_tramo_C, r.B_tramo_A, r.B_tramo_C, r.C_tramo_A, r.C_tramo_B].every((s) => s === 'active');

  // Voz: A «habla» (su hub saca un paquete). Debe llegar a B y C (cifrado, AAD por emisor) y reproducirse por tramo.
  recB.played = []; recC.played = [];
  recA.hub.emit(new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]));
  await sleep(80);
  r.B_oye_a_A = recB.played.some((x) => _n(x.nx) === A_ID);
  r.C_oye_a_A = recC.played.some((x) => _n(x.nx) === A_ID);
  // y B habla → A y C lo oyen (mezcla: cada uno suma al destino)
  recA.played = []; recC.played = [];
  recB.hub.emit(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  await sleep(80);
  r.A_oye_a_B = recA.played.some((x) => _n(x.nx) === B_ID);
  r.C_oye_a_B = recC.played.some((x) => _n(x.nx) === B_ID);

  // Cableado (build 2846, #128): la invariante en la que se apoya ble_messages. Un `vf` cuyo id de tramo NO es de este
  // grupo → onFrame devuelve FALSE (así la app lo deja pasar a la llamada 1-a-1 de calls.js; no se lo traga el grupo).
  r.onframe_ajeno_false = A.onFrame({ type: 'vf', c: 'cl1a1ajeno', s: 1, d: 'AA==' }, 'lan') === false;
  // Un `vf` de un tramo REAL del grupo → onFrame devuelve TRUE (lo maneja el grupo).
  r.onframe_propio_true = A.onFrame({ type: 'vf', c: (A.gc.legs.get(B_ID) || {}).id, s: 777, d: 'AA==' }, 'lan') === true;
  // parseGroupCallSignal: acepta una señal válida y rechaza basura o un `op` inválido (lo usa el enrutado).
  r.parse_ok = !!parseGroupCallSignal(JSON.stringify({ type: 'nexo_gcall', op: 'invite', gid: 'gc123456', from: A_ID }));
  r.parse_basura = parseGroupCallSignal('hola') === null && parseGroupCallSignal(JSON.stringify({ type: 'nexo_gcall', op: 'mal', gid: 'gc123456' })) === null;

  // Un paquete manipulado (AAD/clave equivocada) NO se reproduce (se descarta al descifrar)
  const before = recB.played.length;
  B.onFrame({ type: 'vf', c: (B.gc.legs.get(A_ID) || {}).id, s: 999, d: Buffer.from('basura basura basura basura basura').toString('base64') }, 'lan');
  await sleep(40);
  r.descarta_manipulado = recB.played.length === before;

  // C cuelga → A y B cierran SU tramo con C, la llamada sigue entre A y B
  C.hangup();
  await sleep(120);
  r.C_colgo = C.gc === null;
  r.A_cierra_C = legState(A, C_ID) === 'gone' || legState(A, C_ID) === null;
  r.B_cierra_C = legState(B, C_ID) === 'gone' || legState(B, C_ID) === null;
  r.A_sigue_con_B = A.gc && A.gc.state === 'active' && legState(A, B_ID) === 'active';

  // #130 (dueño 31-10): reconexión por tramo, igual que la 1-a-1. Umbrales acelerados (débil 100 ms, corte 500 ms).
  // Escenario aparte D↔E para no tocar la malla A/B de arriba.
  window.NEXO_GCALL_WEAK_MS = 100; window.NEXO_GCALL_SILENCE_MS = 500;
  const D_ID = 'nxd0000004', E_ID = 'nxe0000005';
  const D = createGroupCall(makeBle(D_ID), makeHub({ played: [] }));
  const E = createGroupCall(makeBle(E_ID), makeHub({ played: [] }));
  registry[D_ID] = D; registry[E_ID] = E;
  await D.start([E_ID], false, 'grp_de_prueba'); // chatId = el chat del grupo (para «Volver a llamar»/volver al chat)
  await sleep(60); E.accept(); await sleep(120);
  r.DE_activa = D.gc && D.gc.state === 'active' && legState(D, E_ID) === 'active';
  r.chatId_guardado = D.gc && D.gc.chatId === 'grp_de_prueba';
  const legE = D.gc.legs.get(E_ID);
  // (1) tramo activo que deja de recibir voz (> débil, < corte) → «Reconectando…», sin cerrarse
  legE.lastRx = Date.now() - 250; D._tick();
  var legView = function (inst, nx) { return (inst.state().legs || []).find((l) => _n(l.nx) === _n(nx)) || {}; };
  r.reconnecting = legView(D, E_ID).reconnecting === true && legState(D, E_ID) === 'active';
  // (2) más silencio (> corte) → ese tramo pasa a «perdido» (los demás seguirían)
  legE.lastRx = Date.now() - 900; D._tick();
  r.tramo_perdido = legState(D, E_ID) === 'lost';
  // (3) sin nadie vivo tras el silencio → corte 'empty' con el chat del grupo y los miembros (para «Volver a llamar»)
  D.gc.startedAt = Date.now() - 1000; // ya lleva un rato en curso
  _events.length = 0; D._tick(); await sleep(20);
  r.D_corto = D.gc === null;
  const endedEv = _events.filter((e) => e.type === 'nexo:gcallEnded').pop();
  r.corte_empty = !!(endedEv && endedEv.detail && endedEv.detail.why === 'empty' && _n(endedEv.detail.chatId) === 'grp_de_prueba' && (endedEv.detail.members || []).map(_n).indexOf(E_ID) >= 0);

  const ok = r.B_suena && r.C_suena && r.invita_con_roster && r.A_activa && r.malla_completa &&
    r.B_oye_a_A && r.C_oye_a_A && r.A_oye_a_B && r.C_oye_a_B && r.descarta_manipulado &&
    r.onframe_ajeno_false && r.onframe_propio_true && r.parse_ok && r.parse_basura &&
    r.C_colgo && r.A_cierra_C && r.B_cierra_C && r.A_sigue_con_B &&
    r.DE_activa && r.chatId_guardado && r.reconnecting && r.tramo_perdido && r.D_corto && r.corte_empty;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GCALL ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('GCALL FALLO:', e && e.stack); process.exit(1); });
