// 3281 (PRIORIDAD 1 del dueño, remate de la FASE 3; COLA 29): FOTOS y archivos PEQUEÑOS en la BANDEJA DE SALIDA nativa.
// Dueño 21-11 (S23→S24): una foto de 201 KB estuvo 4,5 h ⏳ con internet disponible en el servicio nativo y llegó en 44 s al reabrir NEXO.
// La página (que Android duerme) era la única que sabía subir un archivo. Ahora, al ocultarse, la app le deja al teléfono el archivo ya
// cifrado y partido en trozos firmados + su aviso (puntero) cifrado para el contacto; el nativo sube los trozos y, con TODOS guardados,
// deja salir el aviso (netbg_mock.pumpOutbox = NetBg.pumpOutbox; el Kotlin: NetOutboxFilesTest).
//  1) App DORMIDA: A sin internet manda un archivo de 201 KB (⏳) y bloquea. Con la mitad de los trozos subidos NO sale ningún aviso (B no
//     ve nada roto). Con todos: B lo baja, lo descifra y es IDÉNTICO, sin que A abra NEXO. Al abrir A: ✓✓, una copia y A NO lo vuelve a subir.
//  2) El nativo se quedó a MEDIAS y A abre NEXO: la app lo sube ella (de cero), llega una copia y el nativo lo suelta.
//  3) Qué entra (función pura).
// Contraprueba: node bandejafoto.js <dir> --sin-archivos (el nativo de antes): con A dormida el archivo NO llega.
// Uso: node bandejafoto.js <dir_build> [--sin-archivos]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { pumpOutbox } = require('./netbg_mock');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, noOutboxFiles: process.argv.includes('--sin-archivos') };
let RELAYS = [];
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
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
const save = () => fs.writeFileSync(path.join(__dirname, 'last_logs_bandejafoto.txt'), logs.join('\n'));

(async () => {
  const sinArchivos = process.argv.includes('--sin-archivos');
  const r = { prueba: 'bandejafoto', build: path.basename(buildDir), sin_archivos: sinArchivos };
  // 3) Qué entra (pura)
  const { outboxFileFits, outboxFits } = await importSrc('ui/ble_outbox.js');
  const F = (o) => Object.assign({ _own: true, status: 'pending', attachmentType: 'image', attachmentRef: 'f1', attachmentMeta: { size: 200000 } }, o);
  r.entra_foto_audio_archivo = outboxFileFits(F({})) === true && outboxFileFits(F({ attachmentType: 'audio', status: 'sending' })) === true && outboxFileFits(F({ attachmentType: 'file', attachmentRef: null, attachmentPayload: 'QUJD'.repeat(1000) })) === true;
  r.no_entra_grande_ni_wifi_ni_jump = outboxFileFits(F({ attachmentMeta: { size: 3000000 } })) === false && outboxFileFits(F({ attachmentMeta: { big: { key: 'k' } } })) === false && outboxFileFits(F({ attachmentMeta: { dst: 'nx1' } })) === false && outboxFileFits(F({ _bigx: true })) === false;
  r.no_entra_ajeno_entregado_ni_sin_datos = outboxFileFits(F({ _own: false })) === false && outboxFileFits(F({ status: 'delivered' })) === false && outboxFileFits(F({ status: 'failed' })) === false && outboxFileFits(F({ attachmentRef: null })) === false && outboxFileFits(F({ hidden: true })) === false && outboxFileFits(null) === false;
  r.un_adjunto_no_es_un_texto = outboxFits(F({})) === false && outboxFileFits({ _own: true, status: 'pending', content: 'hola' }) === false;

  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  const fin = () => { r.fallan = r.fallan || ['sin terminar']; r.resultado = r.fallan.length ? 'FALLO' : 'OK'; console.log('BANDEJAFOTO ' + JSON.stringify(r)); save(); process.exit(r.resultado === 'OK' ? 0 : 1); };
  if (!paired) { r.error = 'no empareja'; return fin(); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  radio.block(nA, nB); // cada uno a su casa: sin Bluetooth
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000) !== null;
  const msgs = (p, id) => p.win.vaultLoadMessages(id);
  const got = async (buf) => (await msgs(B, idA)).filter((m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === buf.toString('base64')).length;
  const ownFile = async (name) => (await msgs(A, idB)).find((m) => m._own && m.attachmentType && ((m.attachmentMeta || {}).name === name || String(m.content || '').indexOf(name) >= 0));
  const cutNet = (p) => { const net = p.win.bleInterface.net; net.relays.forEach((rl) => { try { if (rl.ws) rl.ws.close(); } catch (e) {} }); return sleep(400).then(() => { net.relays.forEach((rl) => { rl.open = false; rl.ws = null; rl.retryAt = Date.now() + 9e6; }); }); };
  const holdNet = (p) => { p.win.bleInterface.net.relays.forEach((rl) => { if (!rl.open) rl.retryAt = Date.now() + 9e6; }); };
  const sinSalir = (st) => st === 'pending' || st === 'sending';
  const subidasDeA = () => logs.filter((l) => l.indexOf('[A]') >= 0 && l.indexOf('buzón de archivos: cifro una vez y subo') >= 0).length;
  const blobEvents = () => [r1, r2].reduce((n, rl) => n + Array.from((rl.events && (rl.events.values ? rl.events.values() : rl.events)) || []).filter((e) => e && e.kind === 1064).length, 0);

  // ===== 1) App DORMIDA: el nativo termina de subir la foto =====
  A.win.NEXO_RETRY_MS = 1500;
  await cutNet(A);
  r.d_sin_internet = await waitFor(() => !A.win.bleInterface.net.online(), 10000) !== null;
  const foto = await sendFile(A, 'foto_dormida.jpg', 201000);
  await sleep(2500);
  const m1 = await ownFile('foto_dormida.jpg');
  r.d_estado = m1 && m1.status;
  r.d_queda_sin_salir = !!m1 && sinSalir(m1.status);
  const id1 = m1 && (m1.msgId || m1.messageId || m1.id);
  A.setActive(false); holdNet(A); // bloquea el teléfono con la foto a medio mandar
  r.d_bandeja_s = await waitFor(() => nA.outbox && nA.outbox.items.some((x) => x.id === id1 && x.chunks && x.chunks.length > 0), 20000);
  const it1 = ((nA.outbox && nA.outbox.items) || []).find((x) => x.id === id1);
  if (sinArchivos) {
    holdNet(A); await sleep(4000);
    await pumpOutbox(nA);
    r.contraprueba_no_llega = (await waitFor(async () => (await got(foto)) > 0, 15000)) === null;
    r.fallan = (r.d_bandeja_s === null && r.contraprueba_no_llega) ? [] : ['contraprueba'];
    return fin();
  }
  r.d_trozos = it1 ? it1.chunks.length : 0;
  r.d_trozos_cuadran = !!it1 && it1.chunks.length === Math.ceil((201000 + 16) / 40960);
  r.d_aviso_cifrado = !!it1 && it1.p.indexOf('file-pointer') < 0 && it1.p.indexOf('foto_dormida') < 0 && (() => { try { const e = JSON.parse(it1.p); return e.type === 'chat' && e.msgId === id1 && e.dn === idB; } catch (e) { return false; } })();
  const crudo = foto.toString('base64').substring(0, 200);
  r.d_trozos_cifrados = !!it1 && it1.chunks.every((k) => k.ev.indexOf(crudo.substring(0, 60)) < 0);
  holdNet(A); await sleep(4000); holdNet(A);
  r.d_contraprueba_B_no_lo_tiene = (await got(foto)) === 0;
  // el nativo sube solo DOS trozos y se queda sin internet: no sale ningún aviso (B no ve un archivo roto)
  const medio = await pumpOutbox(nA, { soloTrozos: 2 });
  r.d_a_medias_sin_aviso = medio.trozos === 2 && medio.a_medias.includes(id1) && medio.publicados.length === 0;
  await sleep(4000);
  r.d_B_sin_nada_roto = (await got(foto)) === 0 && !(await msgs(B, idA)).some((m) => !m._own && m.attachmentType && (m.msgId || m.id) === id1);
  // vuelve el internet del teléfono: el resto de los trozos y, con todos, el aviso
  const resto = await pumpOutbox(nA);
  r.d_nativo_termina = resto.trozos === r.d_trozos - 2 && resto.publicados.includes(id1) && resto.sin_rele.length === 0;
  r.d_llega_identica_s = await waitFor(async () => (await got(foto)) === 1, 90000);
  r.d_A_sigue_dormida = !A.win.bleInterface.net.online();
  const subidas0 = subidasDeA(), ev0 = blobEvents();
  // A abre NEXO: ✓✓ sin volver a subir nada
  A.setActive(true); A.win.bleInterface.net.tick();
  r.d_confirmado_s = await waitFor(async () => { const m = await ownFile('foto_dormida.jpg'); return !!m && ['delivered', 'read'].includes(m.status); }, 90000);
  await sleep(5000);
  r.d_A_no_la_vuelve_a_subir = subidasDeA() === subidas0 && blobEvents() <= ev0;
  r.d_una_copia = (await got(foto)) === 1;
  r.d_nativo_suelta = !nA.outbox.items.some((x) => x.id === id1);

  // ===== 2) El nativo se quedó a medias y A abre NEXO: la sube la app =====
  await waitFor(() => A.win.bleInterface.net.online(), 30000);
  await cutNet(A);
  const foto2 = await sendFile(A, 'foto_a_medias.jpg', 150000);
  await sleep(2500);
  const m2 = await ownFile('foto_a_medias.jpg'), id2 = m2 && (m2.msgId || m2.messageId || m2.id);
  r.m_queda_sin_salir = !!m2 && sinSalir(m2.status);
  A.setActive(false); holdNet(A);
  r.m_bandeja_s = await waitFor(() => nA.outbox && nA.outbox.items.some((x) => x.id === id2 && x.chunks && x.chunks.length > 0), 20000);
  const medio2 = await pumpOutbox(nA, { soloTrozos: 1 });
  r.m_a_medias = medio2.trozos === 1 && medio2.a_medias.includes(id2);
  r.m_B_no_la_tiene = (await got(foto2)) === 0;
  A.setActive(true); A.win.bleInterface.net.tick(); // A abre NEXO con internet
  r.m_llega_s = await waitFor(async () => (await got(foto2)) === 1, 120000);
  r.m_confirmado_s = await waitFor(async () => { const m = await ownFile('foto_a_medias.jpg'); return !!m && ['delivered', 'read'].includes(m.status); }, 90000);
  await sleep(5000);
  r.m_una_copia = (await got(foto2)) === 1;
  r.m_nativo_suelta = !nA.outbox.items.some((x) => x.id === id2) && (nA.outboxDrops || []).includes(id2);

  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar|Puntero rechazado|BLOB_HASH|BLOB_GCM/.test(l)).slice(0, 3);
  const bools = ['entra_foto_audio_archivo', 'no_entra_grande_ni_wifi_ni_jump', 'no_entra_ajeno_entregado_ni_sin_datos', 'un_adjunto_no_es_un_texto', 'en_linea_por_internet', 'd_sin_internet', 'd_queda_sin_salir', 'd_trozos_cuadran', 'd_aviso_cifrado', 'd_trozos_cifrados',
    'd_contraprueba_B_no_lo_tiene', 'd_a_medias_sin_aviso', 'd_B_sin_nada_roto', 'd_nativo_termina', 'd_A_sigue_dormida', 'd_A_no_la_vuelve_a_subir', 'd_una_copia', 'd_nativo_suelta', 'm_queda_sin_salir', 'm_a_medias', 'm_B_no_la_tiene', 'm_una_copia', 'm_nativo_suelta'];
  const nums = ['d_bandeja_s', 'd_llega_identica_s', 'd_confirmado_s', 'm_bandeja_s', 'm_llega_s', 'm_confirmado_s'];
  r.fallan = bools.filter((k) => r[k] !== true).concat(nums.filter((k) => r[k] === null || r[k] === undefined));
  if (r.errores.length) r.fallan.push('errores');
  fin();
})().catch((e) => { console.error('FALLO:', e.stack); save(); console.log('BANDEJAFOTO ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
