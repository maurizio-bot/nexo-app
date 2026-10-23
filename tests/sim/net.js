// Internet por relés públicos (Nostr, src/net/net_link.js): A y B se conocen en persona y luego cada uno está en su
// casa (Wi-Fi con módems distintos, sin Bluetooth). Dos relés locales con el protocolo de los públicos (uno pide
// identificarse, NIP-42). Comprueba: en línea por internet; textos, texto largo y foto; nada legible en los relés;
// buzón (B con la app cerrada: ✓ al guardarse, llega al volver, ✓✓); con datos móviles textos sí y la foto espera al Wi-Fi.
// --tor: los dos con Tor (modelo de native_mock): se pasan la .onion en el saludo cifrado y hablan directamente por
// Tor (sin relés); un impostor X con Tor que dice ser B no consigue nada y se le cierra la conexión.
// Uso: node net.js <dir_build> [--tor]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
let RELAYS = [];
const withTor = process.argv.includes('--tor');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const tokenOf = (nx, day) => crypto.createHash('sha256').update('nexo-lan|' + nx + '|' + day).digest('hex').substring(0, 16);

(async () => {
  // Dos relés como los públicos: uno normal y otro que pide identificarse para leer mensajes privados (NIP-42)
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  // A en casa y B en la oficina: los dos con Wi-Fi, módems distintos
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: !withTor })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: !withTor }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir), redes: 'A casa, B oficina (módems distintos)', tor: withTor };
  // Se conocen en persona (Bluetooth): claves y "nt"
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('NET ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  // Cada uno se va a su casa: sin Bluetooth
  radio.block(nA, nB);
  const viaA = () => A.win.bleInterface.linkOf(idB), viaB = () => B.win.bleInterface.linkOf(idA);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => viaA() === 'internet' && viaB() === 'internet', 60000);
  await sleep(500);
  r.cabecera_A = A.win.document.getElementById('chat-contact-subtitle').textContent;
  r.B_sabe_que_A_tiene_internet = !!(B.win.bleInterface.getBLEContacts().find((c) => c.nexoId.toLowerCase() === idA) || {}).nt;
  const has = async (p, from, f) => (await p.win.vaultLoadMessages(from)).some(f);
  const status = (p, text) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(text) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
  if (withTor) {
    r.por_tor_s = await waitFor(() => logs.some((l) => /\[A\].*conectado por Tor/.test(l)) && logs.some((l) => /\[B\].*conectado por Tor/.test(l)), 60000);
  }
  const ev0 = r1.events.length + r2.events.length;
  // 1) Textos (corto y largo) y foto por internet
  const ble0 = nA.sent.length;
  sendText(A, 'SECRETO-corto por internet');
  r.texto_llega_s = await waitFor(() => has(B, idA, (m) => m.content === 'SECRETO-corto por internet'), 30000);
  r.texto_estado_A = await waitFor(() => ['delivered', 'read'].includes(status(A, 'SECRETO-corto por internet')), 20000) !== null ? status(A, 'SECRETO-corto por internet') : status(A, 'SECRETO-corto por internet');
  const largo = 'SECRETO-largo ' + 'abcdefghij'.repeat(300);
  sendText(A, largo);
  r.texto_largo_llega_s = await waitFor(() => has(B, idA, (m) => m.content === largo), 30000);
  const foto = await sendFile(A, 'foto.jpg', 300000);
  r.foto_300KB_llega_s = await waitFor(() => has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === foto.toString('base64')), 90000);
  r.escrituras_bluetooth = nA.sent.length - ble0;
  r.eventos_a_los_relés_durante_el_envío = r1.events.length + r2.events.length - ev0;
  if (withTor) r.paquetes_por_tor = nA.stats.torOut || 0;
  sendText(B, 'respuesta de B');
  r.respuesta_llega_s = await waitFor(() => has(A, idB, (m) => m.content === 'respuesta de B'), 30000);
  // 2) Qué ven los relés: nada legible, ni NEXO IDs
  const all = r1.events.concat(r2.events).map((e) => JSON.stringify(e)).join('\n');
  r.relés_ven_algo = ['SECRETO', idA, idB, 'abcdefghij', '"type"', 'hola B'].filter((x) => all.toLowerCase().indexOf(x.toLowerCase()) >= 0);
  r.eventos_guardados = r1.events.length + '+' + r2.events.length;
  r.claves_distintas_por_evento = new Set(r1.events.map((e) => e.pubkey)).size === r1.events.length;
  r.rechazados_por_relés = r1.stats.rejected.concat(r2.stats.rejected).slice(0, 3);
  r.identificaciones_NIP42 = r2.stats.auths;
  // 2c) Aviso para la escucha nativa en segundo plano (NetBg.kt): solo los mensajes nuevos llevan n = msgId dentro del sobre
  {
    const opened = [];
    for (const ev of r1.events) { const o = await B.win.bleInterface.net._open(idA, ev.content); if (o) opened.push(o); }
    const kind = (o) => { if (o.h) return 'saludo'; let p = null; try { p = JSON.parse(o.p); } catch (e) {} if (p && p.type === 'chat') return 'mensaje'; if (p && (p.t === 'c' || p.t === 'f') && p.i === 0 && !p.hf) return 'mensaje'; return 'otro'; };
    const msgs = opened.filter((o) => kind(o) === 'mensaje'), rest = opened.filter((o) => kind(o) !== 'mensaje');
    r.sobres_de_A_para_B = opened.length;
    r.mensajes_con_aviso = msgs.filter((o) => typeof o.n === 'string' && o.n.length > 0).length + '/' + msgs.length;
    r.avisos_en_saludos_o_confirmaciones = rest.filter((o) => o.n).length;
    const cfg = nB.netBg || {};
    const cA = (cfg.contacts || []).find((c) => c.nx === idA);
    r.config_segundo_plano = { me_ok: cfg.me === idB, relés: (cfg.relays || []).length, contacto_A: !!cA, secreto_pareja: !!(cA && /^[0-9a-f]{64}$/.test(cA.kraw)), since: cfg.since > 0 };
  }
  // 2b) Impostor con Tor que dice ser B (conoce la .onion de A: por ejemplo, la vio en otro teléfono)
  if (withTor) {
    const nX = new NativePhone('X', 'EE:EE:EE:EE:EE:09', Object.assign({}, base, { wifi: 'calle' }));
    radio.add(nX); nX.load(); radio.block(nX, nA); radio.block(nX, nB);
    const pX = nX.plugin();
    await pX.torStart({ nexoId: idB });
    await sleep(2000);
    await pX.torConnect({ host: nA.tor.onion, port: 9878 });
    await sleep(1500);
    await pX.torSend({ nx: idA, content: Buffer.from('soy B, de verdad').toString('base64') });
    await sleep(1500);
    r.impostor_cerrado = logs.some((l) => /\[A\].*Conexión Tor de .* no se puede comprobar: se cierra/.test(l));
    r.A_sigue_hablando_con_B = viaA() === 'internet';
  }
  // 3) Buzón: B cierra la app; A escribe; B vuelve y lo recibe; A ve ✓ y luego ✓✓
  B.win.close(); nB.destroyActivity();
  await waitFor(() => viaA() !== 'internet', 200000);
  r.A_ve_que_B_no_esta = viaA();
  sendText(A, 'SECRETO-buzon');
  r.buzon_estado_A_s = await waitFor(() => status(A, 'SECRETO-buzon') === 'sent', 20000);
  await sleep(5000);
  nB.load(); B = await boot('B', nB);
  r.buzon_llega_al_volver_s = await waitFor(() => has(B, idA, (m) => m.content === 'SECRETO-buzon'), 60000);
  r.buzon_doble_check_s = await waitFor(() => ['delivered', 'read'].includes(status(A, 'SECRETO-buzon')), 60000);
  // 4) B con datos móviles (sin Wi-Fi): textos sí, la foto espera al Wi-Fi
  r.de_vuelta_en_linea_s = await waitFor(() => viaA() === 'internet', 60000);
  nB.setWifi(null);
  await sleep(17000); // el próximo saludo de B ya dice "datos móviles"
  await B.win.bleInterface.net.tick(); B.win.bleInterface.net._helloAll(true);
  await waitFor(() => !A.win.bleInterface.net.bothWifi(idB), 30000);
  sendText(A, 'texto con datos moviles');
  r.datos_moviles_texto_s = await waitFor(() => has(B, idA, (m) => m.content === 'texto con datos moviles'), 30000);
  const foto2 = await sendFile(A, 'foto2.jpg', 200000);
  await sleep(15000);
  const llegó2 = () => has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === foto2.toString('base64'));
  r.datos_moviles_foto_espera = !(await llegó2());
  nB.setWifi('oficina');
  await sleep(1000); await B.win.bleInterface.net.tick(); B.win.bleInterface.net._helloAll(true);
  r.con_wifi_la_foto_llega_s = await waitFor(llegó2, 120000);
  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar/.test(l)).slice(0, 3);
  r.contenido_en_registros = logs.filter((l) => /SECRETO/.test(l)).length;
  console.log('NET ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_net.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_net.txt'), logs.join('\n')); process.exit(1); });
