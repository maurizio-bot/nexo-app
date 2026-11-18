// 3216 «UNIR LLAMADAS» (dueño 17-11: «si yo estoy en una llamada y me llega otra llamada, incorporarla como si fuera grupo… Hablo con
// A; B no me contesta. Después B me vuelve a marcar y yo le contesto, y al contestarle puedo decidir si involucrarlo en la misma llamada
// que ya tenía con A… quita el condicional de tener que estar todos al mismo tiempo»). Antes: con dos llamadas a la vez no se podía
// pasar a grupo («Con dos llamadas a la vez no se puede pasar a llamada de grupo»).
// Parte 1 — la app entera (jsdom + native_mock), Y (yo), A y B por Bluetooth, contactos entre sí:
//  U1  Y habla con A y le llama B: en la pantalla de la que suena hay «Unir a esta llamada»; al tocarla, los tres en una llamada de
//      grupo (malla completa, se oyen todos) sin que A ni B toquen nada ni les suene nada; sin «perdida»/«cancelada» en el chat;
//  U2  Y ya contestó a B (A en espera): «Unir» (en el sitio de «Agregar») junta las dos; los tres se oyen;
//  U3  A ve «B se unió a la llamada» y a B en la lista; B ve a A y a Y en la lista;
//  R1  B cuelga antes de unir: el botón desaparece, la llamada con A sigue intacta (se oyen) y un toque tardío dice «Ya no hay dos
//      llamadas que unir» sin tocar nada;
//  R2  A cuelga mientras está en espera: sin «Unir», la de B sigue y vuelve sola (sin espera).
// Parte 2 — unidad (group_call.js + call_merge.js con un `ble` de prueba):
//  V1  la videollamada con A pasa a la de grupo sin cortar (A hereda su cámara e imagen); B, que llamaba de VOZ, entra solo con la
//      cámara apagada aunque la invitación dijera vídeo;
//  P1  el «abrir tramo» de A le llega a B antes que su invitación: se guarda y A–B quedan unidos (antes: «me voy» y no se oían);
//  G1  en una llamada de GRUPO (Y, A, C) suena B: «Unir» → B entra solo a la de grupo y queda unido con todos;
//  N1  con A solo por internet: no se une, dice por qué (con su nombre) y no toca ninguna llamada;
//  L1  la de grupo ya tiene 5: no se une («Máximo 5…») y no toca nada.
// Uso: node unirllamada.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, supervisionMs: 3000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _n = (x) => (x || '').toString().toLowerCase().trim();
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }

// ───────────────────────── Parte 2: unidad ─────────────────────────
async function unidad(r) {
  const { webcrypto } = require('crypto');
  if (!global.crypto) global.crypto = webcrypto;
  if (typeof global.btoa !== 'function') global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  if (typeof global.atob !== 'function') global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  const events = [];
  if (typeof global.CustomEvent !== 'function') global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
  global.window = { dispatchEvent(ev) { events.push(ev); }, NEXO_GCALL_RING_MS: 45000, NEXO_FORCE_LANG: 'es' };
  const gmod = await importSrc('ui/group_call.js');
  let merge = null;
  try { merge = await importSrc('ui/call_merge.js'); } catch (e) { r.sin_call_merge = String(e && e.message).slice(0, 80); }
  const { createGroupCall } = gmod;
  const Y_ID = 'nxy0000009', A_ID = 'nxa0000001', B_ID = 'nxb0000002', C_ID = 'nxc0000003';
  const registry = {}, delay = {}; // delay[from>to] = ms (para P1)
  const lane = () => ({ call: null, lastEnded: null, finished: [], _finish(why, notify) { this.finished.push([why, notify]); if (this.call) this.lastEnded = { id: this.call.id, nx: this.call.nx, at: Date.now(), active: this.call.state === 'active', video: !!this.call.video }; this.call = null; } });
  function makeBle(nx) {
    return {
      localNexoId: nx, calls: lane(), calls2: lane(), _quietOut: new Set(), _callOut: new Set(),
      lan: { quality() { return { up: true }; }, canReach() { return true; } }, net: { mailboxOk() { return false; } },
      _bleReadyFor() { return null; },
      sendChatMessage(toNx, json) {
        setTimeout(() => { const t = registry[_n(toNx)]; if (!t) return; let o; try { o = JSON.parse(json); } catch (e) { return; } if (o && o.type === 'nexo_gcall') t.onSignal(nx, o); }, delay[nx + '>' + _n(toNx)] || 0);
        return Promise.resolve();
      },
      _sendMessageNative(link, json) {
        const toNx = String(link).indexOf('lan:') === 0 ? String(link).slice(4) : String(link);
        setTimeout(() => { const t = registry[_n(toNx)]; if (!t) return; let p; try { p = JSON.parse(json); } catch (e) { return; } if (p && p.type === 'vf') t.onFrame(p, 'lan'); }, 0);
        return Promise.resolve();
      },
    };
  }
  function makeHub(opts) {
    const hub = { opts, adopted: !!opts.adopt, camStart: !!opts.cameraStart, start() { return Promise.resolve({ codec: 'opus' }); }, stop() {}, play() {}, playVideo() {}, camera(on) { hub.cam = !!on; }, mute() {}, requestKey() {}, drop() {} };
    return hub;
  }
  async function setup(ids) {
    for (const k of Object.keys(registry)) delete registry[k];
    for (const k of Object.keys(delay)) delete delay[k];
    events.length = 0;
    const o = {};
    for (const id of ids) { const ble = makeBle(id); o[id] = createGroupCall(ble, makeHub); ble.gcall = o[id]; registry[id] = o[id]; }
    return o;
  }
  const legState = (inst, nx) => { const l = inst.gc && inst.gc.legs.get(_n(nx)); return l ? l.state : null; };
  const rings = () => events.filter((e) => e.type === 'nexo:gcallRing').length;
  const hangAll = async (o) => { for (const k of Object.keys(o)) { try { o[k].hangup(); } catch (e) {} } await sleep(50); };

  // V1: Y une su VIDEOllamada con A (en curso) y la de VOZ que B le estaba haciendo (sonando)
  let o = await setup([Y_ID, A_ID, B_ID]);
  const fakeMedia = { stopped: false, stop() { this.stopped = true; } };
  o[A_ID].ble.calls.call = { id: 'clA', nx: Y_ID, state: 'active', dir: 'in', video: true };
  o[A_ID].ble.calls.handoff = function () { const c = this.call; this._finish('upgrade', false); return { media: fakeMedia, nx: c.nx, id: c.id, video: true, muted: false, cameraOff: false, startedAt: 1 }; };
  o[B_ID].ble.calls.call = { id: 'clB', nx: Y_ID, state: 'calling', dir: 'out', video: false };
  await o[Y_ID].start([A_ID, B_ID], true, null, { upgrade: [{ nx: A_ID, id: 'clA', v: 1, ul: 1 }, { nx: B_ID, id: 'clB', v: 1, ul: 1 }] });
  await sleep(150);
  const A = o[A_ID], B = o[B_ID], Y = o[Y_ID];
  r.V1_A_entra_solo = !!(A.gc && A.gc.state === 'active');
  r.V1_A_hereda_video = !!(A.gc && A.gc.adopt && A.gc.hub && A.gc.hub.adopted && A.gc.video && !fakeMedia.stopped);
  r.V1_B_entra_solo = !!(B.gc && B.gc.state === 'active') && B.ble.calls.call === null && (B.ble.calls.finished[0] || [])[1] === false;
  r.V1_B_camara_apagada = !!(B.gc && !B.gc.video && !B.gc.cameraOn && B.gc.hub && !B.gc.hub.camStart);
  r.V1_sin_sonar = rings() === 0;
  r.V1_malla = legState(Y, A_ID) === 'active' && legState(Y, B_ID) === 'active' && legState(A, B_ID) === 'active' && legState(B, A_ID) === 'active';
  await hangAll(o);

  // P1: la invitación de B tarda; el «abrir tramo» de A (NEXO ID menor) le llega antes
  o = await setup([Y_ID, A_ID, B_ID]);
  delay[Y_ID + '>' + B_ID] = 400;
  o[A_ID].ble.calls.call = { id: 'clA2', nx: Y_ID, state: 'active', dir: 'in', video: false };
  o[B_ID].ble.calls.call = { id: 'clB2', nx: Y_ID, state: 'active', dir: 'out', video: false };
  await o[Y_ID].start([A_ID, B_ID], false, null, { upgrade: [{ nx: A_ID, id: 'clA2', v: 0, ul: 1 }, { nx: B_ID, id: 'clB2', v: 0, ul: 1 }] });
  await sleep(700);
  r.P1_A_B = legState(o[A_ID], B_ID); r.P1_B_A = legState(o[B_ID], A_ID);
  r.P1_oferta_temprana = r.P1_A_B === 'active' && r.P1_B_A === 'active';
  await hangAll(o);

  if (!merge) { r.G1_grupo_mas_uno = r.N1_internet = r.L1_tope = false; return; }
  const { mergeCheck, mergeCalls } = merge;
  // G1: Y, A y C en una llamada de grupo; B llama a Y (suena): «Unir» → B entra solo
  o = await setup([Y_ID, A_ID, B_ID, C_ID]);
  await o[Y_ID].start([A_ID, C_ID], false); await sleep(50); o[A_ID].accept(); o[C_ID].accept(); await sleep(150);
  o[Y_ID].ble.calls.call = { id: 'clB3', nx: B_ID, state: 'ringing', dir: 'in', video: false };
  o[B_ID].ble.calls.call = { id: 'clB3', nx: Y_ID, state: 'calling', dir: 'out', video: false };
  o[Y_ID].ble._bleReadyFor = () => 'dev';
  events.length = 0;
  const g1 = mergeCheck(o[Y_ID].ble, (nx) => nx.toUpperCase());
  await mergeCalls(o[Y_ID].ble, (nx) => nx.toUpperCase()).catch((e) => { r.G1_error = e && e.message; });
  await sleep(200);
  r.G1_tipo = g1 && g1.kind;
  r.G1_grupo_mas_uno = !!(g1 && g1.ok && g1.kind === 'group') && !!(o[B_ID].gc && o[B_ID].gc.state === 'active') && rings() === 0 &&
    o[Y_ID].ble.calls.call === null && (o[Y_ID].ble.calls.finished[0] || [])[1] === false && o[B_ID].ble.calls.call === null &&
    [Y_ID, A_ID, C_ID].every((x) => legState(o[B_ID], x) === 'active' && legState(o[x], B_ID) === 'active');
  await hangAll(o);

  // N1: con A solo por internet (sin Bluetooth ni el mismo Wi-Fi): no se une y no toca nada
  const spyLane = (c) => { const l = lane(); l.call = c; return l; };
  const started = [];
  const ble1 = { calls: spyLane({ id: 'clN1', nx: A_ID, state: 'active', dir: 'out' }), calls2: spyLane({ id: 'clN2', nx: B_ID, state: 'ringing', dir: 'in' }),
    gcall: { gc: null, start() { started.push(1); return Promise.resolve(); } }, _bleReadyFor: (nx) => (nx === B_ID ? 'dev' : null), lan: { quality: () => ({ up: false }), canReach: () => false } };
  const n1 = mergeCheck(ble1, (nx) => (nx === A_ID ? 'Ana' : 'Beto'));
  let n1err = ''; await mergeCalls(ble1, (nx) => (nx === A_ID ? 'Ana' : 'Beto')).catch((e) => { n1err = e && e.message; });
  r.N1_por_que = n1err;
  r.N1_internet = !!(n1 && !n1.ok && /Ana/.test(n1.why) && /internet/.test(n1.why)) && n1err === n1.why && !started.length &&
    !ble1.calls.finished.length && !ble1.calls2.finished.length && !!ble1.calls.call && !!ble1.calls2.call;
  // L1: la de grupo ya tiene 5
  const added = [];
  const ble2 = { calls: spyLane({ id: 'clL1', nx: B_ID, state: 'ringing', dir: 'in' }), calls2: lane(),
    gcall: { gc: { state: 'active', roster: new Set([Y_ID, A_ID, C_ID, 'nxd0000004', 'nxe0000005']) }, addMember() { added.push(1); return Promise.resolve(); } }, _bleReadyFor: () => 'dev' };
  const l1 = mergeCheck(ble2); let l1err = ''; await mergeCalls(ble2).catch((e) => { l1err = e && e.message; });
  r.L1_por_que = l1err;
  r.L1_tope = !!(l1 && !l1.ok && /Máximo 5/.test(l1.why)) && !added.length && !ble2.calls.finished.length && !!ble2.calls.call;
}

// ───────────────────────── Parte 1: la app entera ─────────────────────────
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const media = { played: [], gplayed: [] };
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.NEXO_CALL_RING_MS = 30000; win.NEXO_FORCE_LANG = 'es';
      // micrófono falso de la 1-a-1 (como call2.js): un paquete de voz numerado cada 100 ms
      win.NEXO_callMediaFactory = (o) => {
        let t = null, n = 0;
        return {
          opts: o,
          start() { t = setInterval(() => { const f = new Uint8Array(42); f[0] = name.charCodeAt(0); f[1] = (n >> 8) & 255; f[2] = n & 255; f.fill(0x5a, 3); n++; const p = new Uint8Array(4 + f.length); p[0] = 1; p[1] = 1; p[2] = 0; p[3] = f.length; p.set(f, 4); o.onPacket(p); }, 100); return Promise.resolve({ codec: 'opus', video: false }); },
          play(bytes) { if (bytes.length > 6) media.played.push({ from: String.fromCharCode(bytes[4]), at: Date.now() }); },
          playVideo() {}, mute() {}, requestKey() {}, remoteLive() { return true; },
          stop() { clearInterval(t); t = null; }
        };
      };
      // la captura compartida de la llamada de GRUPO, falsa: una voz numerada cada 100 ms a todos los tramos; lo que llega, por tramo
      win.NEXO_gcallMediaFactory = (o) => {
        let t = null, n = 0;
        const hub = {
          start() { t = setInterval(() => { const f = new Uint8Array(42); f[0] = name.charCodeAt(0); f[1] = (n >> 8) & 255; f[2] = n & 255; f.fill(0x5b, 3); n++; o.onPacket(f); }, 100); return Promise.resolve({ codec: 'opus' }); },
          stop() { clearInterval(t); t = null; },
          play(nx, bytes) { if (bytes.length > 6) media.gplayed.push({ from: String.fromCharCode(bytes[0]), at: Date.now() }); },
          playVideo() {}, camera(on) { hub.cam = !!on; }, flip() { return Promise.resolve('user'); }, mute() {}, screen() {}, screenFrame() {}, requestKey() {}, remoteLive() { return false; }, drop() {},
        };
        return hub;
      };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win, media, rings: 0, toasts: [], callLog: [] };
  win.addEventListener('nexo:gcallRing', () => { p.rings++; });
  win.addEventListener('nexo:callLog', (e) => { if (e && e.detail) p.callLog.push(e.detail.text); });
  new win.MutationObserver(() => { const el = win.document.getElementById('perm-error-toast'); if (el && el.textContent && p.toasts[p.toasts.length - 1] !== el.textContent) p.toasts.push(el.textContent); }).observe(win.document.body, { childList: true });
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 100 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}

async function integracion(r) {
  const N = ['Y', 'A', 'B'];
  const radio = new Radio();
  const nat = {}, P = {};
  N.forEach((n, i) => { const h = { Y: 'EE', A: 'AA', B: 'BB' }[n]; nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, opts)); radio.add(nat[n]); nat[n].load(); });
  for (const n of N) P[n] = await boot(n, nat[n]);
  async function pair(x, y) {
    const others = N.filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    await sleep(800);
    await openChatWith(P[x], y); await sendText(P[x], 'hola ' + y); await sleep(2500);
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
    for (let i = 0; i < 40 && !keyOf(y, x); i++) await sleep(500);
    await closeChat(P[x]);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  for (const [x, y] of [['Y', 'A'], ['Y', 'B'], ['A', 'B']]) if (!(await pair(x, y))) { r.error = 'no empareja ' + x + y; return; }
  await sleep(2000);
  const bi = (p) => p.win.bleInterface;
  const st = (p, lane) => { const c = lane === 2 ? bi(p).calls2 : bi(p).calls; return c && c.call ? c.call.state : null; };
  const gst = (p) => { const g = bi(p).gcall; return g && g.gc ? g.gc.state : null; };
  const doc = (p) => p.win.document;
  const q = (p, sel) => doc(p).querySelector(sel);
  const label = (el) => (el ? (el.querySelector('span:last-child') || el).textContent : null);
  const legOk = (p, others) => { const g = bi(p).gcall.gc; return !!g && others.every((o) => { const l = g.legs.get(_n(bi(P[o]).localNexoId)); return l && l.state === 'active'; }); };
  const malla = () => legOk(P.Y, ['A', 'B']) && legOk(P.A, ['Y', 'B']) && legOk(P.B, ['Y', 'A']);
  const sinUnoAuno = (p) => !bi(p).calls.call && !bi(p).calls2.call;
  const oye = (p, who, since) => p.media.gplayed.filter((x) => x.from === who && x.at >= since).length;
  const oye1 = (p, who, since) => p.media.played.filter((x) => x.from === who && x.at >= since).length;
  async function hangAll() {
    for (const n of N) { const b = bi(P[n]); try { if (b.gcall.gc) b.gcall.hangup(); } catch (e) {} try { if (b.calls2.call) b.calls2.hangup(); } catch (e) {} try { if (b.calls.call) b.calls.hangup(); } catch (e) {} }
    await waitFor(() => N.every((n) => !bi(P[n]).gcall.gc && sinUnoAuno(P[n])), 20000);
    await sleep(3000);
  }
  async function yLlamaA() {
    await openChatWith(P.Y, 'A');
    click(P.Y.win, doc(P.Y).getElementById('nexo-call-btn'));
    await waitFor(() => st(P.A, 1) === 'ringing', 20000);
    click(P.A.win, q(P.A, '#nexo-call-screen .call-accept'));
    const s = await waitFor(() => st(P.Y, 1) === 'active' && st(P.A, 1) === 'active', 20000);
    await closeChat(P.Y);
    return s;
  }
  async function bLlamaY() {
    await openChatWith(P.B, 'Y');
    click(P.B.win, doc(P.B).getElementById('nexo-call-btn'));
    const s = await waitFor(() => st(P.Y, 2) === 'ringing', 20000);
    await closeChat(P.B);
    return s;
  }
  const marks = () => N.forEach((n) => { P[n].rings = 0; P[n].toasts.length = 0; P[n].callLog.length = 0; });

  // U1 + U3: «Unir a esta llamada» en la pantalla de la que suena
  marks();
  r.U1_YA_s = await yLlamaA();
  r.U1_suena_B_s = await bLlamaY();
  await sleep(600);
  const bU1 = q(P.Y, '#nexo-call2-screen .call-merge');
  r.U1_boton = label(bU1);
  r.U1_boton_arriba = label(q(P.Y, '#nexo-call-screen .call-merge')); // en la barra de la de A, «Unir» en el sitio de «Agregar»
  click(P.Y.win, bU1);
  r.U1_unidos_s = await waitFor(() => gst(P.Y) === 'active' && gst(P.A) === 'active' && gst(P.B) === 'active' && malla(), 20000);
  r.U1_sin_1a1 = N.every((n) => sinUnoAuno(P[n]));
  r.U1_A_B_sin_sonar = P.A.rings === 0 && P.B.rings === 0;
  r.U1_sin_toques = !q(P.A, '#nexo-gcall-screen .gc-green') && !q(P.B, '#nexo-gcall-screen .gc-green'); // nadie tuvo «Entrar»
  let t1 = Date.now(); await sleep(4000);
  r.U1_se_oyen = { Y_A: oye(P.Y, 'A', t1), Y_B: oye(P.Y, 'B', t1), A_Y: oye(P.A, 'Y', t1), A_B: oye(P.A, 'B', t1), B_Y: oye(P.B, 'Y', t1), B_A: oye(P.B, 'A', t1) };
  r.U1_chat = { Y: P.Y.callLog.slice(), B: P.B.callLog.slice() };
  r.U1_sin_perdida = ![...P.Y.callLog, ...P.B.callLog].some((x) => /perdida|cancelada|rechazada/.test(x));
  const lista = (p) => { const m = q(p, '#nexo-gcall-screen .gc-members'); return m ? m.textContent : ''; };
  r.U3_A_aviso = P.A.toasts.filter((x) => /se unió/.test(x));
  r.U3_A_lista = lista(P.A); r.U3_B_lista = lista(P.B);
  r.U3_ok = r.U3_A_aviso.includes('B se unió a la llamada') && /B/.test(r.U3_A_lista) && /Y/.test(r.U3_A_lista) && /A/.test(r.U3_B_lista) && /Y/.test(r.U3_B_lista);
  r.U3_Y_sin_aviso = !P.Y.toasts.some((x) => /se unió/.test(x)); // el que une no necesita aviso (lo hizo él)
  await hangAll();

  // U2: ya contesté a B (A en espera) → «Unir»
  marks();
  r.U2_YA_s = await yLlamaA();
  await bLlamaY();
  click(P.Y.win, q(P.Y, '#nexo-call2-screen .call-accept'));
  r.U2_dos_s = await waitFor(() => st(P.Y, 1) === 'active' && st(P.Y, 2) === 'active' && st(P.B, 1) === 'active', 20000);
  await sleep(800);
  r.U2_A_en_espera = !!(bi(P.Y).calls.call && bi(P.Y).calls.call.held);
  const bU2 = q(P.Y, '#nexo-call-screen .call-merge');
  r.U2_botones = [label(bU2), label(q(P.Y, '#nexo-call2-screen .call-merge'))];
  r.U2_sin_agregar = !q(P.Y, '#nexo-call-screen .call-add');
  click(P.Y.win, bU2);
  r.U2_unidos_s = await waitFor(() => gst(P.Y) === 'active' && gst(P.A) === 'active' && gst(P.B) === 'active' && malla(), 20000);
  r.U2_sin_sonar = P.A.rings === 0 && P.B.rings === 0 && N.every((n) => sinUnoAuno(P[n]));
  t1 = Date.now(); await sleep(4000);
  r.U2_se_oyen = { Y_A: oye(P.Y, 'A', t1), Y_B: oye(P.Y, 'B', t1), A_Y: oye(P.A, 'Y', t1), A_B: oye(P.A, 'B', t1), B_A: oye(P.B, 'A', t1) };
  r.U2_A_aviso = P.A.toasts.filter((x) => /se unió/.test(x));
  await hangAll();

  // R1: B cuelga antes de unir
  marks();
  await yLlamaA();
  await bLlamaY();
  await sleep(600);
  const viejo = q(P.Y, '#nexo-call2-screen .call-merge');
  r.R1_boton_antes = label(viejo);
  click(P.B.win, q(P.B, '#nexo-call-screen .call-hangup'));
  r.R1_B_colgo_s = await waitFor(() => st(P.Y, 2) === null && st(P.B, 1) === null, 15000);
  await sleep(2500);
  r.R1_sin_boton = !q(P.Y, '.call-merge') && !!q(P.Y, '#nexo-call-screen .call-add');
  click(P.Y.win, viejo); // un toque tardío (el botón ya no está): no toca nada
  await sleep(500);
  r.R1_aviso = P.Y.toasts.slice(-1)[0] || '';
  t1 = Date.now(); await sleep(3000);
  r.R1_A_intacta = st(P.Y, 1) === 'active' && st(P.A, 1) === 'active' && !bi(P.Y).gcall.gc && !bi(P.A).gcall.gc && !bi(P.B).gcall.gc && oye1(P.A, 'Y', t1) > 10 && oye1(P.Y, 'A', t1) > 10;
  await hangAll();

  // R2: A cuelga mientras está en espera
  marks();
  await yLlamaA();
  await bLlamaY();
  click(P.Y.win, q(P.Y, '#nexo-call2-screen .call-accept'));
  await waitFor(() => st(P.Y, 1) === 'active' && st(P.Y, 2) === 'active', 20000);
  await sleep(800);
  click(P.A.win, q(P.A, '#nexo-call-screen .call-hangup'));
  r.R2_A_colgo_s = await waitFor(() => st(P.Y, 1) === null, 15000);
  await sleep(2500);
  const c2 = bi(P.Y).calls2.call;
  t1 = Date.now(); await sleep(3000);
  r.R2_B_sigue = !!c2 && c2.state === 'active' && !c2.held && !q(P.Y, '.call-merge') && !bi(P.Y).gcall.gc && oye1(P.B, 'Y', t1) > 10 && oye1(P.Y, 'B', t1) > 10;
  await hangAll();
  r.errores = logs.filter((l) => /Error procesando|No se pudo descifrar|ilegible|PAGEERROR/.test(l)).slice(0, 3);
}

(async () => {
  const r = { prueba: 'unirllamada', build: path.basename(buildDir) };
  await unidad(r).catch((e) => { r.unidad_error = String(e && e.message).slice(0, 160); });
  await integracion(r).catch((e) => { r.error = String(e && e.message).slice(0, 160); });
  const se = (o, min) => !!o && Object.values(o).every((v) => v > min);
  const U1 = r.U1_boton === 'Unir a esta llamada' && r.U1_boton_arriba === 'Unir' && typeof r.U1_unidos_s === 'number' && r.U1_sin_1a1 && r.U1_A_B_sin_sonar && r.U1_sin_toques && se(r.U1_se_oyen, 20) && r.U1_sin_perdida;
  const U2 = r.U2_A_en_espera && Array.isArray(r.U2_botones) && r.U2_botones.every((x) => x === 'Unir') && r.U2_sin_agregar && typeof r.U2_unidos_s === 'number' && r.U2_sin_sonar && se(r.U2_se_oyen, 20);
  const U3 = r.U3_ok && r.U3_Y_sin_aviso;
  const R = r.R1_boton_antes === 'Unir a esta llamada' && r.R1_sin_boton && r.R1_aviso === 'Ya no hay dos llamadas que unir' && r.R1_A_intacta && r.R2_B_sigue;
  const V = r.V1_A_entra_solo && r.V1_A_hereda_video && r.V1_B_entra_solo && r.V1_B_camara_apagada && r.V1_sin_sonar && r.V1_malla && r.P1_oferta_temprana && r.G1_grupo_mas_uno && r.N1_internet && r.L1_tope;
  r.partes = { U1: !!U1, U2: !!U2, U3: !!U3, R: !!R, unidad: !!V };
  const ok = U1 && U2 && U3 && R && V && !(r.errores || []).length && !r.error && !r.unidad_error;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('UNIRLLAMADA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_unirllamada.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('UNIRLLAMADA ' + JSON.stringify({ prueba: 'unirllamada', resultado: 'FALLO', error: String(e && e.message) })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_unirllamada.txt'), logs.join('\n')); process.exit(1); });
