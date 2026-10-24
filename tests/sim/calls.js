// Llamadas de voz (ronda 2758, plan del dueño punto 16). A y B contactos y a alcance de Bluetooth (--wifi: en el mismo
// Wi-Fi). El micrófono es falso (paquetes numerados cada 100 ms, como hace call_media.js con Opus): se comprueba la
// señalización, el cifrado y que la voz va y vuelve; el audio de verdad se prueba en Chromium (calls_browser.js).
//  1. A llama a B → B ve "Llamada entrante" → contesta → en llamada los dos; la voz llega en los dos sentidos y en orden;
//     en el aire no va nada en claro; A cuelga → los dos ven la línea "📞 Llamada · 0:0N" en el chat.
//  2. A llama y B rechaza → A ve "Rechazada"; línea "Llamada rechazada" en los dos.
//  3. Sin contestar (timbre acortado a 6 s) → A "No contesta"; B "Llamada perdida".
//  4. En llamada, B se aleja → a los ~12 s sin voz los dos cortan ("Se cortó").
//  5. Sin el contacto cerca: aviso y nada sale.
//  7. (--closed) B tiene la app cerrada: A llama → B recibe el aviso "📞 Llamada entrante" (nativo); B abre la app antes
//     de 60 s → suena → contesta → en llamada.
//  6. (--wifi) Videollamada: el vídeo va y vuelve; B sale del Wi-Fi → el vídeo se para y la voz sigue por Bluetooth;
//     sin Wi-Fi, el botón 🎥 avisa de que hace falta el mismo Wi-Fi.
// Uso: node calls.js <dir_build> [--io-delay=25] [--wifi] [--closed]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const WIFI = !!arg('wifi', false);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true, supervisionMs: 3000 };
if (WIFI) opts.wifi = 'casa';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const media = { sent: 0, played: [], started: 0, stopped: 0, vSent: 0, vPlayed: 0 };
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.NEXO_CALL_RING_MS = 6000;
      // Micrófono falso: cada 100 ms un paquete [códec 1][1 trama][largo][quién, n.º, 40 bytes de "voz"]
      win.NEXO_callMediaFactory = (o) => {
        let t = null, tv = null, n = 0;
        return {
          start() { media.started++; const info = { codec: 'opus', video: !!o.video }; if (o.video) tv = setInterval(() => { const f = new Uint8Array(600); f[0] = media.vSent % 30 === 0 ? 1 : 0; f.fill(0x33, 1); media.vSent++; o.onVideoPacket(f); }, 66); t = setInterval(() => { const f = new Uint8Array(42); f[0] = name.charCodeAt(0); f[1] = n & 255; f.fill(0x5a, 2); n++; media.sent++; const p = new Uint8Array(4 + f.length); p[0] = 1; p[1] = 1; p[2] = 0; p[3] = f.length; p.set(f, 4); o.onPacket(p); }, 100); return Promise.resolve(info); },
          play(bytes) { media.played.push({ from: String.fromCharCode(bytes[4]), n: bytes[5] }); },
          playVideo() { media.vPlayed++; },
          mute() {},
          stop() { media.stopped++; clearInterval(t); clearInterval(tv); }
        };
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
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const screen = (p) => { const s = p.win.document.getElementById('nexo-call-screen'); return s ? (s.querySelector('.call-status') || {}).textContent : null; };
const wait = async (c, s) => { for (let i = 0; i < s * 5 && !c(); i++) await sleep(200); return !!c(); };
const lines = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message .msg-content')).map((e) => e.textContent).filter((t) => /📞|🎥/.test(t));

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChat(A); await sendText(A, 'hola'); await sleep(3000); await openChat(B); await sleep(500);
  const idB = B.win.bleInterface.localNexoId;
  if (WIFI) await wait(() => A.win.bleInterface.lan && A.win.bleInterface.lan.canReach(idB.toLowerCase()), 40);
  const r = { modo: WIFI ? 'mismo Wi-Fi' : 'Bluetooth', boton: !!A.win.document.getElementById('nexo-call-btn') };
  // 1. Llamada contestada
  const air0 = nA.sent.length;
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  r.A_llamando = await wait(() => screen(A) === 'Llamando…', 5);
  r.B_suena = await wait(() => screen(B) === 'Llamada entrante', 20);
  click(B.win, B.win.document.querySelector('#nexo-call-screen .call-accept'));
  r.en_llamada = await wait(() => /^\d+:\d\d$/.test(screen(A) || '') && /^\d+:\d\d$/.test(screen(B) || ''), 10);
  await sleep(4000);
  const pa = A.media.played.filter((x) => x.from === 'B'), pb = B.media.played.filter((x) => x.from === 'A');
  r.voz_B_a_A = pa.length; r.voz_A_a_B = pb.length; r.enviados = [A.media.sent, B.media.sent];
  const inOrder = (l) => l.every((x, i) => i === 0 || ((x.n - l[i - 1].n + 256) % 256) <= 3);
  r.en_orden = inOrder(pa) && inOrder(pb);
  r.camino = WIFI ? (nA.calls.some((c) => c.name === 'lanSend' || c.name === 'lanSendTo') ? 'wifi' : '?') : 'bluetooth';
  r.voz_en_el_aire = nA.sent.slice(air0).some((s) => /"type":"vf"/.test(String(s.chunk))) || WIFI;
  r.nada_en_claro = !nA.sent.slice(air0).some((s) => /WlpaWlpaWlpa/.test(String(s.chunk)));
  click(A.win, A.win.document.querySelector('#nexo-call-screen .call-hangup'));
  r.B_ve_fin = await wait(() => !B.win.bleInterface.calls.call, 10);
  await sleep(1500);
  r.linea_A = lines(A); r.linea_B = lines(B);
  r.micro_cerrado = A.media.stopped >= 1 && B.media.stopped >= 1;
  r.senales_no_son_mensajes = !(await A.win.vaultLoadMessages(idB)).some((m) => /nexo_call/.test(m.content || '')) && !(await B.win.vaultLoadMessages(A.win.bleInterface.localNexoId)).some((m) => /nexo_call/.test(m.content || ''));
  await sleep(2500);
  // 2. Rechazada
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  await wait(() => screen(B) === 'Llamada entrante', 20);
  click(B.win, B.win.document.querySelector('#nexo-call-screen .call-reject'));
  r.rechazada_A = await wait(() => screen(A) === 'Rechazada', 10);
  await sleep(2000);
  // 3. Sin contestar
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  await wait(() => screen(B) === 'Llamada entrante', 20);
  r.sin_respuesta_A = await wait(() => screen(A) === 'No contesta', 12);
  await sleep(2000);
  r.lineas_A = lines(A); r.lineas_B = lines(B);
  // 4. Se corta: B se aleja en plena llamada
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  await wait(() => screen(B) === 'Llamada entrante', 20);
  click(B.win, B.win.document.querySelector('#nexo-call-screen .call-accept'));
  await wait(() => /^\d+:\d\d$/.test(screen(A) || ''), 10);
  await sleep(2000);
  const t0 = Date.now();
  if (WIFI) { nB.setWifi(null); } nB.setOffline(true);
  r.se_corta_A = await wait(() => !A.win.bleInterface.calls.call, 25) ? Math.round((Date.now() - t0) / 1000) + ' s' : 'NO';
  r.se_corta_B = await wait(() => !B.win.bleInterface.calls.call, 25);
  await sleep(1500);
  // 6. Videollamada (solo con Wi-Fi)
  if (WIFI) {
    nB.setOffline(false); if (!nB.wifiNet) nB.setWifi('casa'); A.win.bleInterface.lan.start(); B.win.bleInterface.lan.start();
    // Wi-Fi y también el Bluetooth de vuelta (B estuvo lejos en el paso 4)
    const btReady = (p, nx) => { const bi = p.win.bleInterface, d = bi._resolveDeviceIdForNexoId(nx); const st = d && bi._getDeviceState(d); return !!st && /ready_to_chat|notifications_ready/.test(st.state); };
    r.bt_de_vuelta = await wait(() => A.win.bleInterface.calls.canVideo(idB.toLowerCase()) && btReady(A, idB.toLowerCase()) && btReady(B, A.win.bleInterface.localNexoId.toLowerCase()), 90);
    await sleep(2000);
    click(A.win, A.win.document.getElementById('nexo-video-btn'));
    r.video_B_suena = await wait(() => screen(B) === 'Videollamada entrante', 20);
    click(B.win, B.win.document.querySelector('#nexo-call-screen .call-accept'));
    await wait(() => /^\d+:\d\d$/.test(screen(A) || ''), 10);
    const v0 = [A.media.vPlayed, B.media.vPlayed];
    await sleep(3000);
    r.video_llega = [A.media.vPlayed - v0[0], B.media.vPlayed - v0[1]];
    r.boton_camara = !!A.win.document.querySelector('#nexo-call-screen .call-camera');
    // B sale del Wi-Fi (sigue a alcance de Bluetooth): vídeo parado, voz sigue
    nB.setWifi(null); await sleep(4000);
    r.lan_link_A = JSON.stringify(A.win.bleInterface.lan.links.get(idB.toLowerCase()) || null).substring(0, 300);
    r.tras_salir_wifi = { A_lan: A.win.bleInterface.lan.canReach(idB.toLowerCase()), A_enlace: A.win.bleInterface.calls._link(idB.toLowerCase()), B_wifi: nB.wifiNet, A_conns: Array.from((nA.lanConns || new Map()).keys()) };
    const vp = B.media.vPlayed, ap = B.media.played.length;
    await sleep(3000);
    r.sin_wifi_video_parado = B.media.vPlayed - vp <= 2;
    r.sin_wifi_voz_sigue = B.media.played.length - ap >= 15;
    r.sigue_en_llamada = !!A.win.bleInterface.calls.call && !!B.win.bleInterface.calls.call;
    click(A.win, A.win.document.querySelector('#nexo-call-screen .call-hangup')); await sleep(2000);
    r.linea_video = lines(A).filter((t) => /Videollamada/.test(t));
    // Sin Wi-Fi: el botón 🎥 avisa
    click(A.win, A.win.document.getElementById('nexo-video-btn')); await sleep(600);
    r.video_sin_wifi_aviso = Array.from(A.win.document.querySelectorAll('div')).some((d) => /mismo Wi-Fi \(por Bluetooth solo voz\)/.test(d.textContent) && d.children.length === 0);
    r.video_sin_wifi_no_llama = !A.win.bleInterface.calls.call;
    r.B_se_entera_al_colgar = await wait(() => !B.win.bleInterface.calls.call, 5);
    nB.setOffline(true);
    await sleep(5000); // que A note que B ya no está (supervisión del Bluetooth)
  }
  // 7. App cerrada
  if (arg('closed', false)) {
    nB.setOffline(false); await sleep(6000);
    B.win.close(); nB.destroyActivity(); await sleep(2000);
    const n0 = nB.notifLog.length;
    for (let i = 0; i < 100 && !A.win.bleInterface.calls.canCall(idB); i++) await sleep(200);
    click(A.win, A.win.document.getElementById('nexo-call-btn'));
    r.cerrada_aviso = await wait(() => nB.notifLog.slice(n0).some((n) => n.text === '📞 Llamada entrante'), 20);
    r.cerrada_avisos = nB.notifLog.slice(n0).map((n) => n.text + '/' + n.closed); r.cerrada_buzon = (nB.bgInbox || []).map((x) => x.c.substring(0, 160));
    await sleep(3000);
    nB.load(); const B2 = await boot('B', nB);
    r.cerrada_suena_al_abrir = await wait(() => { const s = B2.win.document.getElementById('nexo-call-screen'); return !!s && /Llamada entrante/.test(s.textContent); }, 30);
    click(B2.win, B2.win.document.querySelector('#nexo-call-screen .call-accept'));
    r.cerrada_en_llamada = await wait(() => B2.win.bleInterface.calls.call && B2.win.bleInterface.calls.call.state === 'active' && A.win.bleInterface.calls.call && A.win.bleInterface.calls.call.state === 'active', 30);
    if (A.win.bleInterface.calls.call) A.win.bleInterface.calls.hangup();
    await sleep(2000);
    nB.setOffline(true); await sleep(5000);
  }
  // 5. Sin el contacto cerca
  const before = nA.sent.length;
  click(A.win, A.win.document.getElementById('nexo-call-btn')); await sleep(800);
  r.sin_alcance_aviso = Array.from(A.win.document.querySelectorAll('div')).some((d) => /hace falta tener al contacto cerca/.test(d.textContent) && d.children.length === 0);
  r.sin_alcance_no_llama = !A.win.bleInterface.calls.call;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const ok = r.boton && r.A_llamando && r.B_suena && r.en_llamada && r.voz_B_a_A >= 25 && r.voz_A_a_B >= 25 && r.en_orden && r.voz_en_el_aire && r.nada_en_claro && r.B_ve_fin &&
    r.linea_A.some((t) => /Llamada · 0:0\d/.test(t)) && r.linea_B.some((t) => /Llamada · 0:0\d/.test(t)) && r.micro_cerrado && r.senales_no_son_mensajes &&
    r.rechazada_A && r.lineas_A.some((t) => /rechazada/.test(t)) && r.lineas_B.some((t) => /rechazada/.test(t)) && r.sin_respuesta_A && r.lineas_B.some((t) => /perdida/.test(t)) &&
    r.se_corta_A !== 'NO' && r.se_corta_B && (!arg('closed', false) || (r.cerrada_aviso && r.cerrada_suena_al_abrir && r.cerrada_en_llamada)) && r.sin_alcance_aviso && r.sin_alcance_no_llama && (!WIFI || r.camino === 'wifi') && !r.errores.length &&
    (!WIFI || (r.video_B_suena && r.video_llega[0] >= 30 && r.video_llega[1] >= 30 && r.boton_camara && r.sin_wifi_video_parado && r.sin_wifi_voz_sigue && r.sigue_en_llamada &&
      r.linea_video.length >= 1 && r.B_se_entera_al_colgar && r.video_sin_wifi_aviso && r.video_sin_wifi_no_llama));
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_calls.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_calls.txt'), logs.join('\n')); process.exit(1); });
