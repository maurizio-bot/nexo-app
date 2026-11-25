// Auditoría 23-11 (punto 20, decisión 1A del dueño): un paquete de claves «de B» FABRICADO (la identidad pública de B con otra clave
// de firma y otra clave previa) ya no se acepta: hace falta el certificado de la identidad de B sobre su clave de firma. Antes bastaba
// la firma de la clave que venía en el mismo paquete. Lo de verdad sigue funcionando.
// Uso: node bundleforge.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const directLater = !!arg('direct-later', false);
const shared = !!arg('shared', false), chain = !!arg('chain', false), stranger = !!arg('stranger', false), lowBat = !!arg('low-battery', false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
// Lo que recibe cada teléfono por radio
const air = {};
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { (air[this.name] = air[this.name] || []).push(String(chunk)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
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
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
// Pulsa el "+" de la fila del teléfono `name` en "dispositivos nuevos" (puede haber otros listados)
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
const status = (p, text) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(text) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }

(async () => {
  const radio = new Radio();
  const names = ['A', 'B'];
  const nat = {}, P = {};
  const hx = { A: 'AA', B: 'BB' };
  names.forEach((n, i) => { nat[n] = new NativePhone(n, Array(5).fill(hx[n]).join(':') + ':0' + (i + 1), opts); radio.add(nat[n]); nat[n].load(); });
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  P.A.win.bleInterface.togglePanel(); const ok = await addFound(P.A, 'B'); P.A.win.bleInterface.togglePanel();
  await sleep(1500);
  const r = {};
  if (!ok) { console.log('BUNDLEFORGE ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(0); }
  await openChatWith(P.A, 'B'); await sendText(P.A, 'hola B'); await sleep(4000); await closeChat(P.A);
  const idB = P.B.win.bleInterface.localNexoId.toLowerCase();
  const peerB = () => { try { return (JSON.parse(nat.A.files.get('nexo_ratchet.json') || '{}').peers || {})[idB] || null; } catch (e) { return null; } };
  const real = peerB();
  r.paquete_real_guardado = !!(real && real.sk && real.c);
  // Paquete FABRICADO: la identidad pública de B (ik), con una clave de firma y una clave previa del atacante, bien firmadas por
  // SU clave de firma (lo único que se comprobaba antes). Sin certificado y con uno falso.
  const S = P.A.win.crypto.subtle;
  const ek = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const sk2 = Buffer.from(await S.exportKey('raw', ek.publicKey)).toString('base64');
  const spk = Buffer.from(await S.exportKey('raw', (await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])).publicKey)).toString('base64');
  const sig = Buffer.from(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, ek.privateKey, new TextEncoder().encode('NEXO-SPK|99|' + spk + '|' + real.ik))).toString('base64');
  const fakeC = Buffer.from(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, ek.privateKey, new TextEncoder().encode('NEXO-IKSK-v1|' + real.ik + '|' + sk2))).toString('base64');
  const forged = { v: 2, ik: real.ik, sk: sk2, spk: spk, spkId: 99, sig: sig };
  const bi = P.A.win.bleInterface;
  const r1 = await bi._notePeerBundle(idB, Object.assign({}, forged));
  const r2 = await bi._notePeerBundle(idB, Object.assign({}, forged, { c: fakeC }));
  // También por un kx «de B» (como alguien cerca con from inventado)
  bi._prePayload({ deviceId: 'EE:EE:EE:EE:EE:09', content: JSON.stringify({ v: 1, type: 'kx', from: idB, pk: real.ik, b2: Object.assign({}, forged, { c: fakeC }) }) });
  await sleep(800);
  const after = peerB();
  r.sin_certificado_rechazado = r1 === false; r.certificado_falso_rechazado = r2 === false;
  r.clave_firma_intacta = !!(after && after.sk === real.sk && after.spk === real.spk);
  // Y lo de verdad sigue: B escribe y A lo lee
  await openChatWith(P.B, 'A'); await sendText(P.B, 'respuesta de B'); await sleep(4000);
  r.mensajes_siguen = (await P.A.win.vaultLoadMessages(idB.toUpperCase())).concat(await P.A.win.vaultLoadMessages(idB)).some((m) => /respuesta de B/.test(m.content || ''));
  const okAll = r.paquete_real_guardado && r.sin_certificado_rechazado && r.certificado_falso_rechazado && r.clave_firma_intacta && r.mensajes_siguen;
  r.resultado = okAll ? 'OK' : 'FALLO';
  console.log('BUNDLEFORGE ' + JSON.stringify(r));
  if (!okAll) console.log(logs.filter((l) => /E2E|kx/.test(l)).slice(-30).join('\n'));
  process.exit(0);
})().catch((e) => { console.log('BUNDLEFORGE ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.stack) })); process.exit(1); });
