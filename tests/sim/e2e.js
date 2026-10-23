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
  // Paquetes de chat que llegan a B (ya reensamblados), para reinyectarlos después
  const chatsToB = [];
  const origPre = B.win.bleInterface._prePayload.bind(B.win.bleInterface);
  B.win.bleInterface._prePayload = (d) => { const c = String((d && (d.content || d.data)) || ''); if (c.indexOf('"type":"chat"') >= 0) chatsToB.push({ deviceId: d.deviceId, content: c }); return origPre(d); };
  const r = { build: path.basename(buildDir), webcrypto_en_app: !!(A.win.crypto && A.win.crypto.subtle) };
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId;
  const largo = 'SECRETO-largo-' + 'abcdefghij'.repeat(40);
  await sendText(A, 'SECRETO-corto-123'); await sleep(2500);
  await sendText(A, largo); await sleep(4000);
  // Emojis (2 y más unidades UTF-16, con modificadores y uniones) y acentos en todas las posiciones de los trozos
  const emojis = 'SECRETO-emoji ' + 'ñandú café 😀👍🏽👨‍👩‍👧 ¿qué? '.repeat(40).trim();
  await sendText(A, emojis); await sleep(4000);
  // Vista previa de la lista (se corta a 50): el emoji cae justo en el corte, no debe quedar medio emoji (�)
  await sendText(A, 'x'.repeat(49) + '😀 fin'); await sleep(3000);
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const prevB = Array.from(B.win.document.querySelectorAll('.ble-contact-msg')).map((e) => e.textContent);
  r.vista_previa_sin_medio_emoji = prevB.length > 0 && !prevB.some((t) => lone.test(t));
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
  r.llega_emojis_identico = vB.some((m) => m.content === emojis);
  const fB = vB.find((m) => m.attachmentType === 'file' || m.attachmentType === 'image');
  let fotoRecibida = fB && (fB.attachmentPayload || (fB.attachmentRef && nB.files.get(fB.attachmentRef)));
  r.llega_foto_identica = fotoRecibida === fotoB64;
  r.llega_respuesta = vA.some((m) => m.content === 'SECRETO-respuesta');
  r.en_el_aire_en_claro = ['SECRETO-corto', 'SECRETO-largo', 'SECRETO-respuesta', 'abcdefghijabcdefghij', fotoB64.substring(1000, 1060), 'SECRETO-foto', 'SECRETO-video', thumb.substring(40, 100)].filter((x) => airText.indexOf(x) >= 0);
  r.paquetes_cifrados_E1 = air.filter((x) => x.indexOf('E1:') >= 0).length;
  r.paquetes_cifrados_E2 = air.filter((x) => x.indexOf('E2:') >= 0).length;
  r.intercambios_kx = air.filter((x) => x.indexOf('"type":"kx"') >= 0).length;
  const cA = A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {};
  const cB = B.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idA.toLowerCase()) || {};
  r.A_tiene_clave_de_B = !!cA.publicKey; r.B_tiene_clave_de_A = !!cB.publicKey;
  r.aviso_chat_A = ((A.win.document.getElementById('e2e-banner') || {}).textContent || '').substring(0, 40);
  r.estados_A = Array.from(A.win.document.querySelectorAll('#messages-container .message.own .msg-status')).map((e) => e.className.replace('msg-status status-', ''));
  r.protocolo_2_en_los_dos = cA.proto === 2 && cB.proto === 2;

  // Protocolo 2: repeticiones. El paquete del texto corto, reinyectado tal cual (mismo id) y con otro id
  const corto = chatsToB.find((x) => x.content.indexOf('E2:') >= 0);
  if (corto) {
    const bi = B.win.bleInterface;
    await bi._prePayload(corto).then((d) => d && bi._handlePayload(d));
    const otro = corto.content.replace(/"msgId":"([^"]+)"/, '"msgId":"$1_rep"');
    await bi._prePayload({ deviceId: corto.deviceId, content: otro }).then((d) => d && bi._handlePayload(d));
    await sleep(1500);
  }
  const vB2 = await B.win.vaultLoadMessages(idA);
  // (con el mismo id: duplicado confirmado; con otro id: la clave de ese mensaje ya se borró → DUP, no se muestra)
  r.repeticion_mismo_y_otro_id_no_se_muestra = !!corto && vB2.filter((m) => m.content === 'SECRETO-corto-123').length === 1 &&
    !vB2.some((m) => /_rep$/.test(m.messageId || m.msgId || ''));
  // Vuelta atrás: A (manipulado) cifra con el protocolo 1 a B, que ya usa el 2 desde hace más del margen
  const setC = (P, id, f) => { const cs = P.win.vaultLoadContacts(); const c = cs.find((x) => x.nexoId.toLowerCase() === id.toLowerCase()); f(c); P.win.vaultSaveContacts(cs); };
  setC(B, idA, (c) => { c.proto2At = Date.now() - 30 * 3600000; });
  setC(A, idB, (c) => { delete c.proto; });
  await sendText(A, 'SECRETO-protocolo-1'); await sleep(4000);
  r.protocolo_1_rechazado = !(await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'SECRETO-protocolo-1') && logs.some((l) => /protocolo 1 descartado/.test(l));
  setC(A, idB, (c) => { c.proto = 2; c.proto2At = Date.now(); });
  // Al volver al 2, ese mensaje sale cifrado con el 2 y llega
  const t0 = Date.now();
  let llega1 = false;
  while (!llega1 && Date.now() - t0 < 90000) { await sleep(1000); llega1 = (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'SECRETO-protocolo-1'); }
  r.luego_llega_con_el_2_s = llega1 ? Math.round((Date.now() - t0) / 1000) : null;
  // Número de seguridad: el mismo en los dos teléfonos; "verificado"
  const sn = async (P) => { const b = P.win.document.getElementById('e2e-banner'); click(P.win, b); for (let i = 0; i < 40; i++) { await sleep(250); const t = (P.win.document.querySelector('#e2e-banner .e2e-fp') || {}).textContent || ''; const m = t.replace(/\s+/g, ' ').match(/(\d{5} ){11}\d{5}/); if (m) return m[0]; } return null; };
  const snA = await sn(A), snB = await sn(B);
  r.numero_seguridad_igual = !!snA && snA === snB;
  click(A.win, A.win.document.querySelector('#e2e-banner .e2e-verify')); await sleep(500);
  r.verificado = ((A.win.document.querySelector('#e2e-banner .e2e-text') || {}).textContent || '').indexOf('Verificaste') >= 0;

  // B "reinstala": identidad nueva. A NO debe aceptarla sola (podría ser un impostor): queda pendiente,
  // no se le envía nada hasta que el usuario de A la acepte; después todo sigue cifrado con la nueva.
  const oldKey = cA.publicKey;
  B.win.close(); nB.destroyActivity(); nB.files.delete('nexo_e2e_identity.json'); await sleep(2000);
  nB.load(); B = await boot('B', nB); await sleep(8000);
  await sendText(A, 'SECRETO-tras-cambio'); await sleep(8000);
  const cA2 = A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {};
  r.clave_vieja_se_mantiene = cA2.publicKey === oldKey;
  const pendKey = cA2.pendingKey;
  r.clave_nueva_pendiente = !!pendKey && pendKey !== oldKey;
  r.aviso_chat_A_tras_cambio = ((A.win.document.querySelector('#e2e-banner .e2e-text') || {}).textContent || '').substring(0, 45);
  r.botones_aceptar_rechazar = !!A.win.document.querySelector('#e2e-banner .e2e-accept') && !!A.win.document.querySelector('#e2e-banner .e2e-reject');
  r.no_sale_antes_de_aceptar = !(await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'SECRETO-tras-cambio');
  click(A.win, A.win.document.querySelector('#e2e-banner .e2e-accept'));
  const t1 = Date.now();
  let llega = false;
  while (!llega && Date.now() - t1 < 60000) { await sleep(500); llega = (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'SECRETO-tras-cambio'); }
  r.llega_tras_aceptar_s = llega ? Math.round((Date.now() - t1) / 100) / 10 : null;
  const cA3 = A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {};
  r.clave_nueva_aceptada = cA3.publicKey === pendKey && !cA3.pendingKey;
  r.tras_aceptar_protocolo_2_sin_verificar = cA3.proto === 2 && !cA3.verified;
  r.en_el_aire_tras_cambio = air.join('\n').indexOf('SECRETO-tras-cambio') >= 0;
  r.errores_descifrado = logs.filter((l) => /No se pudo descifrar/.test(l)).length;
  // Seguridad: ningún contenido ni nombre de archivo en los registros (se guardan y salen en el diagnóstico)
  r.contenido_en_registros = logs.filter((l) => /SECRETO/.test(l)).map((l) => l.substring(0, 80)).slice(0, 3);
  console.log('E2E ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_e2e.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_e2e.txt'), logs.join('\n')); process.exit(1); });
