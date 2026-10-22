// Cifrado de extremo a extremo: captura todo lo que pasa por el "aire" y comprueba que ningún contenido
// viaja en claro, que todo se descifra y se guarda bien, y el cambio de clave (B reinstala).
// Uso: node e2e.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
// Todo lo que llega a cualquier teléfono por radio
const air = [];
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir), webcrypto_en_app: !!(A.win.crypto && A.win.crypto.subtle) };
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId;
  const largo = 'SECRETO-largo-' + 'abcdefghij'.repeat(40);
  await sendText(A, 'SECRETO-corto-123'); await sleep(2500);
  await sendText(A, largo); await sleep(4000);
  // Foto (como archivo): contenido reconocible
  const foto = Buffer.alloc(30000); for (let i = 0; i < foto.length; i++) foto[i] = (i * 13 + 7) & 255;
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(A.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new A.win.File([foto], 'SECRETO-foto.bin', { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new A.win.Event('change'));
  await sleep(9000);
  await openChat(B); await sendText(B, 'SECRETO-respuesta'); await sleep(3000);
  // Cabecera de archivo: nombre y miniatura (poster del vídeo) también cifrados
  const thumb = Buffer.from('MINIATURA-SECRETA-'.repeat(40)).toString('base64');
  let thB = null;
  B.win.addEventListener('nexo:ble:fileComplete', (e) => { if (e.detail.fileId === 'th_test_1') thB = e.detail.meta; });
  const devB = A.win.bleInterface.getBLEContacts()[0].deviceId;
  await A.win.bleInterface.ackSystem.sendFile(devB, 'th_test_1', Buffer.alloc(3000, 7).toString('base64'), { type: 'video', mime: 'video/webm', name: 'SECRETO-video.webm', thumb });
  await sleep(2000);
  r.llega_miniatura = !!thB && thB.thumb === thumb;
  r.llega_nombre = !!thB && thB.name === 'SECRETO-video.webm';

  const vB = await B.win.vaultLoadMessages(idA), vA = await A.win.vaultLoadMessages(idB);
  const airText = air.join('\n');
  const fotoB64 = foto.toString('base64');
  r.llega_corto = vB.some((m) => m.content === 'SECRETO-corto-123');
  r.llega_largo = vB.some((m) => m.content === largo);
  const fB = vB.find((m) => m.attachmentType === 'file' || m.attachmentType === 'image');
  let fotoRecibida = fB && (fB.attachmentPayload || (fB.attachmentRef && nB.files.get(fB.attachmentRef)));
  r.llega_foto_identica = fotoRecibida === fotoB64;
  r.llega_respuesta = vA.some((m) => m.content === 'SECRETO-respuesta');
  r.en_el_aire_en_claro = ['SECRETO-corto', 'SECRETO-largo', 'SECRETO-respuesta', 'abcdefghijabcdefghij', fotoB64.substring(1000, 1060), 'SECRETO-foto', 'SECRETO-video', thumb.substring(40, 100)].filter((x) => airText.indexOf(x) >= 0);
  r.paquetes_cifrados_E1 = air.filter((x) => x.indexOf('E1:') >= 0).length;
  r.intercambios_kx = air.filter((x) => x.indexOf('"type":"kx"') >= 0).length;
  const cA = A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {};
  const cB = B.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idA.toLowerCase()) || {};
  r.A_tiene_clave_de_B = !!cA.publicKey; r.B_tiene_clave_de_A = !!cB.publicKey;
  r.aviso_chat_A = ((A.win.document.getElementById('e2e-banner') || {}).textContent || '').substring(0, 40);
  r.estados_A = Array.from(A.win.document.querySelectorAll('#messages-container .message.own .msg-status')).map((e) => e.className.replace('msg-status status-', ''));

  // B "reinstala": identidad nueva. A debe aceptar la clave nueva, avisar y seguir cifrando.
  const oldKey = cA.publicKey;
  B.win.close(); nB.destroyActivity(); nB.files.delete('nexo_e2e_identity.json'); await sleep(2000);
  nB.load(); B = await boot('B', nB); await sleep(8000);
  await sendText(A, 'SECRETO-tras-cambio'); await sleep(8000);
  const cA2 = A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {};
  r.clave_de_B_cambio_en_A = !!cA2.publicKey && cA2.publicKey !== oldKey;
  r.aviso_cambio_en_A = !!cA2.keyChangedAt;
  r.aviso_chat_A_tras_cambio = ((A.win.document.getElementById('e2e-banner') || {}).textContent || '').substring(0, 45);
  r.llega_tras_cambio = (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'SECRETO-tras-cambio');
  r.en_el_aire_tras_cambio = air.join('\n').indexOf('SECRETO-tras-cambio') >= 0;
  r.errores_descifrado = logs.filter((l) => /No se pudo descifrar/.test(l)).length;
  console.log('E2E ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_e2e.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_e2e.txt'), logs.join('\n')); process.exit(1); });
