// Ronda 2768 (revisión de llamadas): lo que fallaba con la 2767, cada caso en su proceso (--case=…). A y B contactos y a
// alcance de Bluetooth; micrófono falso como en calls.js (un paquete numerado cada 100 ms).
//  rechazar-cerrada  B con la app cerrada: A llama, B toca "Rechazar" en el aviso. Antes el aviso volvía a sonar con
//                    cada reenvío de la oferta (9 avisos por una llamada); debe: un aviso y no vuelve a sonar.
//  rechazar-viva     B con la app en segundo plano: "Rechazar" en el aviso llega a la app, que rechaza (cifrado) y A ve
//                    "Rechazada" al momento (antes seguía en "Llamando…" hasta "No contesta").
//  contestar-viejo   B con la app cerrada toca "Contestar" en el aviso de una llamada que A ya colgó; A vuelve a llamar
//                    al poco: antes se contestaba sola con el micrófono abierto; debe sonar sin contestarse.
//  cruce             Los dos se llaman a la vez: antes "Ocupado" en los dos; debe quedar una llamada en los dos.
//  reloj             El reloj de B va 90 s adelantado (sin hora de red): antes nunca sonaba ("Llamada perdida").
//  oferta-vieja      A llama sin B al alcance y se rinde; la oferta quedaba guardada y, al reiniciar A la app, a B le
//                    llegaba "Llamada perdida" y un "Mensaje nuevo" que no existía. Debe: nada guardado ni nada en B.
//  bloqueo           NEXO abierto encima de la pantalla de bloqueo por una llamada que ya no existe, o una oferta que
//                    no suena (vieja): antes NEXO seguía visible sin desbloquear y el aviso sonando; debe volver detrás.
//  repetida          Paquetes de voz grabados del aire y metidos otra vez por un tercero: antes se volvían a oír.
//  video-estado      (2769) Videollamada por Wi-Fi: si la cámara o el micrófono del otro fallan, se ve su foto y el
//                    motivo (antes, negro y sin saber por qué) y un aviso; si falta imagen, el otro manda una completa;
//                    si se va el Wi-Fi (el vídeo solo va por Wi-Fi), su foto y "Sin Wi-Fi: solo voz" y la llamada sigue.
//  sin-micro         (2769) B sin micrófono (permiso quitado): antes no mandaba nada y A cortaba a los 12 s ("Se cortó")
//                    sin saber por qué; debe seguir la llamada (B oye a A) y los dos ver el aviso. (2770) En llamada,
//                    el nativo pone el servicio de micrófono (para la pantalla bloqueada) y pide el foco de audio, y
//                    los quita al colgar.
//  timbre            (2770) Llamada entrante con el teléfono en silencio, en "No molestar", en vibración, normal y con la
//                    app oculta: antes la app pitaba siempre (como multimedia, también en silencio) y, oculta, se sumaba
//                    al aviso del sistema; ahora sin tono en silencio, solo vibra en vibración, y oculta suena el aviso.
//  wifi-uno          Llamada por Wi-Fi; a B se le va el Wi-Fi sin cierre limpio (siguen a alcance de Bluetooth): antes
//                    la voz de A no le volvía a llegar y B cortaba a los 12 s; debe volver enseguida.
// Uso: node calls2.js <dir_build> --case=<caso> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : (isNaN(Number(v)) ? v : Number(v)); };
const CASE = arg('case', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realNow = Date.now.bind(Date);
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
// cfg: skewMs (reloj adelantado), ringMs (timbre), vis (objeto con el estado visible/oculto de la app)
async function boot(name, native, cfg = {}) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const media = { sent: 0, played: [], live: 0 };
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      if (cfg.skewMs) { const sk = cfg.skewMs; win.Date.now = () => realNow() + sk; }
      if (cfg.vis) {
        Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => cfg.vis[name] || 'visible' });
        Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => (cfg.vis[name] || 'visible') === 'hidden' });
      }
      win.NEXO_CALL_RING_MS = cfg.ringMs || 20000;
      // (ronda 2770) el tono de llamada de la app: se cuentan los pitidos (WebAudio) y las vibraciones
      if (cfg.toneSpy) {
        win.AudioContext = class { constructor() { this.currentTime = 0; this.destination = {}; } createOscillator() { media.tones = (media.tones || 0) + 1; return { frequency: {}, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: {}, connect() {} }; } close() { return Promise.resolve(); } };
        Object.defineProperty(win.navigator, 'vibrate', { configurable: true, value: () => { media.vibs = (media.vibs || 0) + 1; return true; } });
      }
      win.NEXO_callMediaFactory = (o) => {
        let t = null, n = 0;
        // (ronda 2769: opts a mano para provocar onState / onNeedKey; requestKey y remoteLive como call_media.js)
        const m = media.cur = {
          opts: o, keyReq: 0, live: true,
          start() {
            media.live++;
            if (cfg.noMic) { // ronda 2769: sin micrófono, como call_media.js: lo dice y manda un "sigo aquí" (2 bytes) cada 2 s
              if (typeof o.onState === 'function') o.onState({ cam: 'none', mic: 'none', micErr: 'NotAllowedError' });
              t = setInterval(() => o.onPacket(new Uint8Array([1, 0])), 2000);
              return Promise.resolve({ codec: 'opus', mic: false, micError: 'NotAllowedError', video: false });
            }
            t = setInterval(() => { const f = new Uint8Array(42); f[0] = name.charCodeAt(0); f[1] = (n >> 8) & 255; f[2] = n & 255; f.fill(0x5a, 3); n++; media.sent++; const p = new Uint8Array(4 + f.length); p[0] = 1; p[1] = 1; p[2] = 0; p[3] = f.length; p.set(f, 4); o.onPacket(p); }, 100); return Promise.resolve({ codec: 'opus', video: false }); },
          play(bytes) { if (bytes.length > 6) media.played.push({ from: String.fromCharCode(bytes[4]), n: (bytes[5] << 8) | bytes[6], at: realNow() }); },
          playVideo() {}, mute() {},
          requestKey() { m.keyReq++; },
          remoteLive() { return m.live; },
          stop() { if (t) media.live--; clearInterval(t); t = null; }
        };
        return m;
      };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, media };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { let row; for (let i = 0; i < 300 && !row; i++) { row = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!row) await sleep(100); } click(p.win, row); await sleep(400); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5 && !(await c()); i++) await sleep(200); return !!(await c()); };
const screen = (p) => { const s = p.win.document.getElementById('nexo-call-screen'); return s ? (s.querySelector('.call-status') || {}).textContent : null; };
const st = (p) => { const c = p.win.bleInterface.calls.call; return c ? c.state : null; };
const callBtn = (p) => click(p.win, p.win.document.getElementById('nexo-call-btn'));
const accept = (p) => click(p.win, p.win.document.querySelector('#nexo-call-screen .call-accept'));

// A y B emparejados (A busca y agrega a B; los dos con el chat abierto)
async function setup(cfg = {}, extraOpts = {}) {
  const opts = Object.assign({ readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 25), asymmetric: true, supervisionMs: 3000 }, extraOpts);
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const vis = {};
  const [A, B] = await Promise.all([boot('A', nA, Object.assign({ vis }, cfg.A || {})), boot('B', nB, Object.assign({ vis }, cfg.B || {}))]);
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChat(A); sendText(A, 'hola'); await sleep(3000); await openChat(B); await sleep(500);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const hide = (p, hidden) => { vis[p.name] = hidden ? 'hidden' : 'visible'; p.native.setAppActive(!hidden); p.win.document.dispatchEvent(new p.win.Event('visibilitychange')); };
  return { radio, nA, nB, A, B, idA, idB, hide, opts, vis };
}
async function closeApp(p) { p.win.close(); p.native.destroyActivity(); await sleep(2000); }
async function reopenApp(p, cfg) { p.native.load(); return boot(p.name, p.native, cfg || {}); }

const CASES = {
  async 'rechazar-cerrada'() {
    const { nB, A, B, idB } = await setup();
    await closeApp(B);
    const r = { puede_llamar: await wait(() => A.win.bleInterface.calls.canCall(idB), 30) };
    const n0 = nB.notifLog.length;
    callBtn(A);
    r.suena = await wait(() => !!nB.callNotif, 20);
    await sleep(1500);
    r.rechazar = nB.declineFromNotification();
    const t0 = realNow(), again = [];
    for (let i = 0; i < 30; i++) { await sleep(1000); if (nB.callNotif) { again.push(Math.round((realNow() - t0) / 1000)); nB.callNotif = null; } }
    r.vuelve_a_sonar_s = again;
    r.avisos_de_llamada = nB.notifLog.slice(n0).filter((x) => x.call).length;
    r.ok = r.puede_llamar && r.suena && r.rechazar && !again.length && r.avisos_de_llamada === 1;
    return r;
  },
  async 'rechazar-viva'() {
    const { nB, A, B, hide } = await setup();
    hide(B, true); await sleep(1000);
    callBtn(A);
    const r = { B_suena: await wait(() => st(B) === 'ringing', 20) };
    r.aviso = await wait(() => !!nB.callNotif, 5);
    const t0 = realNow();
    nB.declineFromNotification();
    r.A_ve_rechazada_ms = await wait(() => screen(A) === 'Rechazada', 6) ? realNow() - t0 : null;
    r.B_sin_llamada = !B.win.bleInterface.calls.call;
    r.ok = r.B_suena && r.aviso && r.A_ve_rechazada_ms !== null && r.B_sin_llamada;
    return r;
  },
  async 'contestar-viejo'() {
    const S = await setup();
    const { nA, nB, A, idB } = S;
    let B = S.B;
    await closeApp(B);
    const r = { puede_llamar: await wait(() => A.win.bleInterface.calls.canCall(idB), 30) };
    callBtn(A);
    r.aviso = await wait(() => !!nB.callNotif, 20);
    await sleep(1000);
    A.win.bleInterface.calls.hangup();
    await wait(() => !A.win.bleInterface.calls.call, 5);
    await sleep(2000);
    // B toca "Contestar" en el aviso (de una llamada que ya no existe): se abre NEXO
    r.contestar = nB.answerFromNotification();
    B = await reopenApp(B);
    r.reconecta = await wait(() => A.win.bleInterface.calls.canCall(idB) && B.win.bleInterface.calls.canCall(A.win.bleInterface.localNexoId), 40);
    await sleep(1500);
    // A vuelve a llamar (dentro de los 90 s que el nativo guarda lo tocado)
    callBtn(A);
    r.B_suena = await wait(() => st(B) === 'ringing' || st(B) === 'active', 20);
    await sleep(3000);
    r.B_estado_3s = st(B);
    r.B_micro_abierto = B.media.live > 0;
    r.ok = r.puede_llamar && r.aviso && r.reconecta && r.B_suena && r.B_estado_3s === 'ringing' && !r.B_micro_abierto;
    void nA;
    return r;
  },
  async 'cruce'() {
    const { A, B } = await setup();
    callBtn(A); callBtn(B);
    const r = { en_llamada: await wait(() => st(A) === 'active' && st(B) === 'active', 15) };
    await sleep(2000);
    r.voz = { A_oye: A.media.played.filter((x) => x.from === 'B').length, B_oye: B.media.played.filter((x) => x.from === 'A').length };
    r.ok = r.en_llamada && r.voz.A_oye > 3 && r.voz.B_oye > 3;
    return r;
  },
  async 'reloj'() {
    const { A, B } = await setup({ B: { skewMs: 90000 } });
    callBtn(A);
    const r = { B_suena: await wait(() => st(B) === 'ringing', 15) };
    accept(B);
    r.en_llamada = await wait(() => st(A) === 'active' && st(B) === 'active', 15);
    r.ok = r.B_suena && r.en_llamada;
    return r;
  },
  async 'oferta-vieja'() {
    const S = await setup({ A: { ringMs: 8000 } });
    const { radio, nA, nB, B, idA, idB } = S;
    let A = S.A;
    const evB = [];
    B.win.addEventListener('nexo:call', (e) => evB.push((e.detail || {}).state));
    B.win.addEventListener('nexo:callLog', (e) => evB.push('LOG ' + ((e.detail || {}).text || '')));
    radio.block(nA, nB);
    const r = { llamar: await A.win.bleInterface.calls.start(idB).then(() => 'ok', (e) => 'error: ' + e.message) };
    r.A_se_rinde = await wait(() => !A.win.bleInterface.calls.call, 30);
    await sleep(1000);
    const tx = (await A.win.vaultGetPendingOutgoingTransfers(idB).catch(() => [])) || [];
    r.oferta_guardada = tx.filter((t) => /^cs[0-9a-f]{12}$/.test(t.transferId || t.msgId || '')).map((t) => (t.transferId || t.msgId) + ':' + t.status);
    // A reinicia la app con B ya al alcance
    nA.pendingQueue.clear(); // el Kotlin no guarda lo escrito sin conexión
    A.win.close(); nA.destroyActivity(); radio.unblock(nA, nB); await sleep(1000);
    A = await reopenApp(A, { ringMs: 8000 });
    const n0 = nB.notifLog.length;
    r.reconecta = await wait(() => A.win.bleInterface.calls.canCall(idB), 60);
    await sleep(12000);
    r.B_eventos = evB;
    r.B_avisos = nB.notifLog.slice(n0).map((x) => (x.chatId === idA ? 'A' : x.chatId) + ': ' + (x.text || 'Mensaje nuevo') + (x.call ? ' [llamada]' : ''));
    r.ok = r.llamar === 'ok' && r.A_se_rinde && !r.oferta_guardada.length && r.reconecta && !evB.length && !r.B_avisos.length;
    return r;
  },
  async 'bloqueo'() {
    const { nB, A, B, idA, idB, hide } = await setup();
    const r = {};
    await sleep(6000); // pasado el repaso de los 8 s al arrancar (calls_ui.js), que no es lo que se prueba
    // 1. NEXO se abrió encima del bloqueo por el aviso de una llamada que ya no existe (y quedó "Contestar" apuntado)
    hide(B, true); await sleep(500);
    nB.overLock = true; nB.pendingAnswer = idA; nB.pendingAnswerOffer = 'cs000000000000';
    const t0 = realNow();
    hide(B, false);
    r.vuelve_detras_s = await wait(() => nB.overLock === false, 20) ? Math.round((realNow() - t0) / 1000) : null;
    r.contestar_descartado = !nB.pendingAnswer;
    // 2. Llega una oferta que no suena (vieja) con NEXO encima del bloqueo: fuera el aviso y detrás del bloqueo
    nB.overLock = true; nB.callNotif = { from: idA, video: false, offer: '' };
    A.win.bleInterface.calls._signal(idB, 'offer', { id: 'clviejo' + Date.now().toString(36), k: '00'.repeat(32), ts: Date.now() - 11 * 60000 });
    r.oferta_vieja_detras = await wait(() => nB.overLock === false, 10);
    r.oferta_vieja_sin_aviso = !nB.callNotif;
    r.B_no_suena = !B.win.bleInterface.calls.call;
    r.ok = r.vuelve_detras_s !== null && r.contestar_descartado && r.oferta_vieja_detras && r.oferta_vieja_sin_aviso && r.B_no_suena;
    return r;
  },
  async 'video-estado'() {
    const { nA, nB, A, B, idA, idB } = await setup({}, { wifi: 'casa' });
    const r = { wifi: await wait(() => A.win.bleInterface.calls.canVideo(idB) && B.win.bleInterface.calls.canVideo(idA), 60) };
    // B tiene abierta la cámara del chat (iba a hacer una foto): al contestar se cierra, la usa la llamada
    const ovB = B.win.document.getElementById('camera-preview-overlay');
    if (ovB) ovB.classList.remove('hidden');
    click(A.win, A.win.document.getElementById('nexo-video-btn'));
    await wait(() => st(B) === 'ringing', 20);
    accept(B);
    r.en_llamada = await wait(() => st(A) === 'active' && st(B) === 'active', 15);
    await sleep(1000);
    r.camara_del_chat_cerrada = !ovB || ovB.classList.contains('hidden');
    const scrA = () => A.win.document.getElementById('nexo-call-screen');
    const noteA = () => ((scrA() || {}).querySelector ? (scrA().querySelector('.call-note') || {}).textContent : '') || '';
    const warnA = () => ((scrA() || {}).querySelector ? (scrA().querySelector('.nc-warnbar') || {}).textContent : '') || '';
    // 1. La cámara de B no está (reintentando): A ve su foto y el motivo, no negro
    (B.media.cur.opts.onState || (() => {}))({ cam: 'retry', mic: 'on' });
    r.A_sabe_camara_B = await wait(() => A.win.bleInterface.calls.call && A.win.bleInterface.calls.call.peerCam === 'retry', 5);
    await sleep(1200);
    r.A_foto_en_vez_de_negro = !!scrA() && scrA().classList.contains('nc-novideo');
    r.A_motivo = noteA();
    // 2. El micrófono de B no responde: A lo ve arriba
    (B.media.cur.opts.onState || (() => {}))({ cam: 'on', mic: 'retry' });
    r.A_aviso_micro_B = await wait(() => /micrófono de/.test(warnA()), 5) ? warnA() : warnA() || null;
    // 3. A no tiene imagen de B: le pide una completa
    const k0 = B.media.cur.keyReq;
    (A.media.cur.opts.onNeedKey || (() => {}))();
    r.B_manda_completa = await wait(() => B.media.cur.keyReq > k0, 5);
    // 4. Todo bien otra vez: imagen de B y sin avisos
    (B.media.cur.opts.onState || (() => {}))({ cam: 'on', mic: 'on' });
    await wait(() => A.win.bleInterface.calls.call && A.win.bleInterface.calls.call.peerMic === 'on', 5);
    await sleep(1200);
    r.A_imagen_otra_vez = !!scrA() && !scrA().classList.contains('nc-novideo') && !warnA();
    r.ilegibles = [A.win.bleInterface.calls.stats.bad, B.win.bleInterface.calls.stats.bad];
    // 5. Se va el Wi-Fi de B: la llamada sigue por Bluetooth (solo voz) y A lo ve en vez de la imagen parada o negra
    nB.setWifi(null);
    A.media.cur.live = false; // (por Bluetooth no llega vídeo)
    r.A_sin_wifi = (await wait(() => /Sin Wi-Fi/.test(noteA()) && scrA().classList.contains('nc-novideo'), 25)) ? noteA() : noteA() || null;
    await sleep(2000);
    r.sigue_sin_wifi = st(A) === 'active' && st(B) === 'active';
    r.ok = r.wifi && r.en_llamada && r.camara_del_chat_cerrada && r.A_sabe_camara_B && r.A_foto_en_vez_de_negro && /no está disponible/.test(r.A_motivo) &&
      /micrófono de/.test(r.A_aviso_micro_B || '') && r.B_manda_completa && r.A_imagen_otra_vez && !r.ilegibles[0] && !r.ilegibles[1] &&
      /Sin Wi-Fi: solo voz/.test(r.A_sin_wifi || '') && r.sigue_sin_wifi;
    void nA;
    return r;
  },
  async 'sin-micro'() {
    const { nA, A, B } = await setup({ B: { noMic: true } });
    callBtn(A);
    await wait(() => st(B) === 'ringing', 20);
    accept(B);
    const r = { en_llamada: await wait(() => st(A) === 'active' && st(B) === 'active', 15) };
    const t0 = realNow();
    const noteOf = (p) => ((p.win.document.querySelector('#nexo-call-screen .call-note') || {}).textContent) || '';
    const statusOf = (p) => ((p.win.document.querySelector('#nexo-call-screen .call-status') || {}).textContent) || '';
    r.A_aviso = (await wait(() => /micrófono de/.test(noteOf(A)), 8)) ? noteOf(A) : noteOf(A) || null;
    r.B_aviso = noteOf(B) || null;
    // 20 s más (antes, a los 12 s sin nada de B, A cortaba)
    let inestable = 0;
    for (let k = 0; k < 20; k++) { await sleep(1000); if (/inestable/.test(statusOf(A))) inestable++; }
    r.segundos = Math.round((realNow() - t0) / 1000);
    r.sigue = st(A) === 'active' && st(B) === 'active';
    r.A_inestable_s = inestable;
    r.B_oye_a_A = B.media.played.filter((x) => x.from === 'A').length;
    r.A_voz_recibida = A.win.bleInterface.calls.stats.got;
    r.A_sigo_aqui = A.win.bleInterface.calls.stats.gotKeep || 0;
    // (2770) servicio de micrófono del nativo en llamada, en el diagnóstico, y fuera al colgar
    r.A_servicio_en_llamada = nA.callFgs || null;
    r.A_diag_segundo_plano = logs.some((l) => /\[A\] .*Sonido del teléfono: .*en segundo plano: micrófono; foco de audio: sí/.test(l));
    r.A_foco_en_llamada = nA.audioFocus === true;
    click(A.win, A.win.document.querySelector('#nexo-call-screen .call-hangup'));
    await wait(() => !A.win.bleInterface.calls.call, 5);
    await sleep(500);
    r.A_servicio_tras_colgar = nA.callFgs || null;
    r.A_foco_tras_colgar = nA.audioFocus === true;
    r.ok = r.en_llamada && /micrófono de .+ no funciona/.test(r.A_aviso || '') && /Sin micrófono \(sin permiso\): .+ no te oye/.test(r.B_aviso || '') && r.sigue &&
      r.B_oye_a_A > 50 && r.A_voz_recibida === 0 && r.A_sigo_aqui >= 5 && r.A_inestable_s <= 2 &&
      r.A_servicio_en_llamada === 'micrófono' && r.A_diag_segundo_plano && r.A_servicio_tras_colgar === 'normal' && r.A_foco_en_llamada && !r.A_foco_tras_colgar;
    return r;
  },
  async 'timbre'() {
    const { nB, A, B, hide } = await setup({ B: { toneSpy: true } });
    const r = {};
    const ring = async (label, mode, dnd, hidden) => {
      nB.ringer = mode; nB.dnd = !!dnd;
      if (hidden) hide(B, true);
      await sleep(300);
      const t0 = B.media.tones || 0, v0 = B.media.vibs || 0;
      callBtn(A);
      const rang = await wait(() => st(B) === 'ringing', 20);
      await sleep(3500);
      r[label] = { suena: rang, pitidos: (B.media.tones || 0) - t0, vibra: (B.media.vibs || 0) - v0, aviso_sistema: !!nB.callNotif };
      click(A.win, A.win.document.querySelector('#nexo-call-screen .call-hangup'));
      await wait(() => !A.win.bleInterface.calls.call && !B.win.bleInterface.calls.call, 10);
      if (hidden) hide(B, false);
      await sleep(1500);
    };
    await ring('silencio', 'silent');
    await ring('no_molestar', 'normal', true);
    await ring('vibracion', 'vibrate');
    await ring('normal', 'normal');
    await ring('oculta', 'normal', false, true);
    r.ok = r.silencio.suena && r.silencio.pitidos === 0 && r.silencio.vibra === 0 && r.no_molestar.suena && r.no_molestar.pitidos === 0 &&
      r.vibracion.suena && r.vibracion.pitidos === 0 && r.vibracion.vibra > 0 && r.normal.suena && r.normal.pitidos > 0 &&
      r.oculta.suena && r.oculta.pitidos === 0 && r.oculta.aviso_sistema;
    return r;
  },
  async 'repetida'() {
    const { nA, nB, A, B } = await setup();
    callBtn(A);
    await wait(() => st(B) === 'ringing', 20);
    accept(B);
    const r = { en_llamada: await wait(() => st(A) === 'active' && st(B) === 'active', 15) };
    await sleep(3000);
    const id = A.win.bleInterface.calls.call.id;
    const vfs = (nA.sent.map((s) => String(s.chunk)).join('').match(new RegExp('\\{"type":"vf","c":"' + id + '","s":\\d+,"d":"[^"]+"\\}', 'g')) || []).slice(0, 20);
    r.grabados = vfs.length;
    const before = B.media.played.filter((x) => x.from === 'A');
    const heard = new Set(before.map((x) => x.n));
    vfs.forEach((j) => nB._processReceivedChunk('CC:CC:CC:CC:CC:03', j, 'gatt_server'));
    await sleep(1500);
    r.oidos_otra_vez = B.media.played.filter((x) => x.from === 'A').slice(before.length).filter((x) => heard.has(x.n)).length;
    r.ok = r.en_llamada && r.grabados >= 10 && r.oidos_otra_vez === 0;
    return r;
  },
  async 'wifi-uno'() {
    const { nB, A, B, idA, idB } = await setup({}, { wifi: 'casa', lanSilent: true });
    const r = { wifi: await wait(() => A.win.bleInterface.calls.canVideo(idB) && B.win.bleInterface.calls.canVideo(idA), 60) };
    callBtn(A);
    await wait(() => st(B) === 'ringing', 20);
    accept(B);
    r.en_llamada = await wait(() => st(A) === 'active' && st(B) === 'active', 15);
    r.camino = A.win.bleInterface.calls._link(idB);
    await sleep(3000);
    const t0 = realNow();
    nB.setWifi(null);
    const after = (p, from) => p.media.played.find((x) => x.from === from && x.at > t0 + 300);
    await wait(() => (after(A, 'B') && after(B, 'A')) || !A.win.bleInterface.calls.call || !B.win.bleInterface.calls.call, 25);
    const hA = after(A, 'B'), hB = after(B, 'A');
    r.voz_vuelve_ms = { A_oye_a_B: hA ? hA.at - t0 : null, B_oye_a_A: hB ? hB.at - t0 : null };
    await sleep(3000);
    r.sigue = st(A) === 'active' && st(B) === 'active';
    r.ok = r.wifi && r.en_llamada && /^lan:/.test(r.camino || '') && hA !== undefined && hB !== undefined && hB.at - t0 < 5000 && r.sigue;
    return r;
  },
};

(async () => {
  const fn = CASES[CASE];
  if (!fn) { console.error('Caso desconocido: ' + CASE + ' (' + Object.keys(CASES).join(', ') + ')'); process.exit(2); }
  const r = Object.assign({ caso: CASE }, await fn());
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.ok && !r.errores.length;
  delete r.ok;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLS2 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_calls2_' + CASE + '.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_calls2_' + CASE + '.txt'), logs.join('\n')); process.exit(1); });
