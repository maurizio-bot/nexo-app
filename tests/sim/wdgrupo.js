// «No se pudo crear el grupo» de Wi-Fi Direct y demás causas por las que en teléfonos reales casi nunca funciona (COLA 4, 22-11).
// El nativo real (PluginWifiDirect.kt) contesta al montar el grupo con un código de Android (0 error interno, 1 no soportado,
// 2 ocupado) tras ~5 s de reintentos; al unirse, con «no se pudo conectar»; y si el grupo se cae a mitad, «envío fallido».
// Para CADA causa, en un par de teléfonos nuevos, se comprueba:
//  1. el archivo NO se pierde: llega por Bluetooth (u otro camino);
//  2. el usuario ve un texto verdadero y útil (qué pasó y qué puede hacer) en el teléfono que corresponde;
//  3. la causa queda apuntada en las medidas del diagnóstico (usageNoteWd → «Wi-Fi Direct hoy: … fallaron N: causa»);
//  4. no se reintenta en bucle: un segundo archivo enseguida ya ni lo intenta por Wi-Fi Direct (sin nueva oferta ni nuevo grupo).
// Causas: permiso (este / el otro), Wi-Fi apagado, grupo ocupado (2), error interno (0), no soportado (1), no se pudo unir,
// el grupo se cae al segundo, y «el otro no tiene Wi-Fi Direct» (no debe salir ningún aviso falso).
// Uso: node wdgrupo.js <dir_build> [--solo=nombre]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const solo = ((process.argv.find((x) => x.startsWith('--solo=')) || '').split('=')[1]) || '';
const base = { wifiDirect: true, readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
let air = [];
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole(); ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  // avisos que ve el usuario (los toast salen como divs fijos en el body)
  const toasts = [];
  new win.MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && /position:\s*fixed/.test((n.style && n.style.cssText) || '') && n.textContent) toasts.push(n.textContent); }))).observe(win.document.body, { childList: true });
  return { name, native, win, toasts };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function pickFile(p, file) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(300);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [file], configurable: true });
  fin.dispatchEvent(new p.win.Event('change'));
}
const bytes = (n, k) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * k + 7) & 255; return b; };
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
const SIZE = 130000;

// Un caso: dos teléfonos nuevos; pA / pB = opciones del nativo de cada uno antes de arrancar.
async function caso(nombre, pA, pB, esperado) {
  air = []; logs.length = 0;
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, pA)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, pB));
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) throw new Error('no empareja');
  click(A.win, add); await sleep(2500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  click(A.win, A.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500);
  const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId, nxB = idB.toLowerCase();
  const wdA = A.win.bleInterface.wifiDirect;
  if (pB.wifiDirect !== false) await waitFor(() => wdA.peers.has(nxB), 20000);
  await sleep(3500);   // el permiso se pide solo ~2,5 s después de ver al otro
  const has = async (b64) => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentPayload === b64 || (m.attachmentRef && nB.files.get(m.attachmentRef) === b64));
  const chunksOf = (id) => air.filter((x) => x.indexOf('"m":"' + id) >= 0).length;
  const lastAttId = async () => ((await A.win.vaultLoadMessages(idB)).filter((m) => m.attachmentType).pop() || {}).msgId;
  const offers = () => air.filter((x) => x.indexOf('"type":"wq"') >= 0).length;
  const send = async (n, k, name) => { const f = bytes(n, k); await pickFile(A, new A.win.File([f], name, { type: 'application/octet-stream' })); const s = await waitFor(() => has(f.toString('base64')), 300000); return { s, id: await lastAttId() }; };
  const r = { caso: nombre };
  // 3287 («cancelar»): cuánto queda B «ocupado» con el grupo montado desde que lo monta (sin cancelar: los 90 s de la espera)
  const wdB = B.win.bleInterface.wifiDirect;
  let tHost = 0, tFree = 0;
  const poll = setInterval(() => { try { if (!tHost && (nB.stats.wdGroups || 0) > 0) tHost = Date.now(); if (tHost && !tFree && !wdB.busy && !wdB.incoming.size) tFree = Date.now(); } catch (e) {} }, 100);
  const x1 = await send(SIZE, 13, 'uno.bin');
  r.llega_s = x1.s;
  r.por_bluetooth = chunksOf(x1.id) > 10;
  await sleep(6000);   // si hubiera bucle, aquí se vería
  const of1 = offers(), host1 = nB.stats.wdHostCalls || 0;
  const x2 = await send(SIZE, 17, 'dos.bin');
  r.segundo_llega_s = x2.s;
  await sleep(3000);
  r.ofertas = offers(); r.grupos_pedidos_B = nB.stats.wdHostCalls || 0;
  r.sin_bucle = r.ofertas === of1 && r.grupos_pedidos_B === host1 && of1 <= 1 && host1 <= 1;
  const sinPar = (x) => x.filter((m) => !/Solicitud enviada|aceptó tu solicitud/.test(m)).join(' | ');   // los avisos del emparejamiento no cuentan
  const tA = sinPar(A.toasts), tB = sinPar(B.toasts);
  r.aviso_A = tA.substring(0, 170); r.aviso_B = tB.substring(0, 170);
  const mA = A.win.NEXO_speedLines ? A.win.NEXO_speedLines().filter((l) => /Wi-Fi Direct/.test(l)).join('\n') : '', mB = B.win.NEXO_speedLines ? B.win.NEXO_speedLines().filter((l) => /Wi-Fi Direct/.test(l)).join('\n') : '';
  r.medidas_A = mA.substring(0, 300); r.medidas_B = mB.substring(0, 300);
  const mal = [];
  const chk = (k, v) => { if (!v) mal.push(k); };
  chk('llega', r.llega_s !== null && r.segundo_llega_s !== null);
  chk('por_bluetooth', r.por_bluetooth);
  chk('sin_bucle', r.sin_bucle);
  Object.keys(esperado.toastA || {}).forEach((k) => chk('aviso_A_' + k, esperado.toastA[k].test(tA)));
  Object.keys(esperado.toastB || {}).forEach((k) => chk('aviso_B_' + k, esperado.toastB[k].test(tB)));
  if (esperado.sinToast) chk('sin_aviso_falso', !tA && !tB);
  if (esperado.medidasA) chk('medidas_A', esperado.medidasA.test(mA));
  if (esperado.medidasB) chk('medidas_B', esperado.medidasB.test(mB));
  chk('ni_un_byte_por_wd', (nA.stats.wdBytes || 0) === 0);
  clearInterval(poll);
  if (esperado.cancela) {
    r.B_ocupado_s = tHost && tFree ? Math.round((tFree - tHost) / 100) / 10 : null;
    r.cancelaciones_B = nB.stats.wdCancels || 0;
    chk('B_libre_enseguida', r.B_ocupado_s !== null && r.B_ocupado_s < 15);
    chk('B_bajo_el_grupo', r.cancelaciones_B >= 1);
  }
  const errs = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 3);
  chk('sin_errores', !errs.length); if (errs.length) r.errores = errs;
  r.diag_A = logs.filter((l) => l.startsWith('[A]') && /WIFI-DIRECT/.test(l)).map((l) => l.replace(/^\[A\] \w+: /, '').substring(0, 140)).slice(0, 6);
  r.fallos = mal;
  r.resultado = mal.length ? 'FALLO' : 'OK';
  try { A.win.close(); B.win.close(); } catch (e) {}
  return r;
}

(async () => {
  const casos = [
    ['perm_este', { wdNoPerm: true }, {}, { toastA: { permiso: /Dispositivos cercanos/, dalo: /Ajustes/ }, medidasA: /sin permiso/ }],
    ['perm_otro', {}, { wdNoPerm: true }, { toastB: { permiso: /Dispositivos cercanos/, dalo: /Ajustes/ } }],
    ['wifi_apagado_este', { wifiOff: true }, {}, { toastA: { enciende: /Enciende el Wi-Fi/ } }],
    ['grupo_ocupado_2', {}, { wdGroupErr: 2 }, { toastA: { otro: /El otro teléfono no pudo montar Wi-Fi Direct/ }, toastB: { yo: /Android no pudo montar Wi-Fi Direct.*apaga y enciende el Wi-Fi/ }, medidasA: /no se pudo crear el grupo \(2 ocupado\)/, medidasB: /no se pudo crear el grupo \(2 ocupado\)/ }],
    ['grupo_error_interno_0', {}, { wdGroupErr: 0 }, { toastA: { otro: /El otro teléfono no pudo montar Wi-Fi Direct/ }, toastB: { yo: /Android no pudo montar Wi-Fi Direct/ }, medidasA: /no se pudo crear el grupo \(0 interno\)/, medidasB: /no se pudo crear el grupo \(0 interno\)/ }],
    ['grupo_no_soportado_1', {}, { wdGroupErr: 1 }, { toastA: { otro: /El otro teléfono no admite Wi-Fi Direct/ }, toastB: { yo: /Este teléfono no admite Wi-Fi Direct/ }, medidasA: /no se pudo crear el grupo \(1 no soporta\)/, medidasB: /no se pudo crear el grupo \(1 no soporta\)/ }],
    ['no_se_pudo_unir', { wdFail: true }, {}, { toastA: { union: /No se pudo unir al grupo de Wi-Fi Direct/, acerca: /Acerquen/ }, medidasA: /no se pudo conectar al grupo/, cancela: true }],
    ['grupo_se_cae', { wdDropMs: 500 }, {}, { toastA: { corte: /Se cortó Wi-Fi Direct a mitad del envío/ }, medidasA: /envío cortado/ }],
    ['otro_sin_wifi_direct', {}, { wifiDirect: false }, { sinToast: true }],
  ].filter((c) => !solo || c[0] === solo);
  const res = [];
  for (const c of casos) {
    let r;
    try { r = await caso(c[0], c[1], c[2], c[3]); } catch (e) { r = { caso: c[0], resultado: 'FALLO', error: String(e && e.message) }; }
    res.push(r);
    console.log('WDGRUPO_CASO ' + JSON.stringify(r));
  }
  const ok = res.every((r) => r.resultado === 'OK');
  console.log('WDGRUPO ' + JSON.stringify({ prueba: 'wdgrupo', build: path.basename(buildDir), resultado: ok ? 'OK' : 'FALLO', casos: res.map((r) => r.caso + ':' + r.resultado).join(' ') }));
  fs.writeFileSync(path.join(__dirname, 'last_logs_wdgrupo.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WDGRUPO ' + JSON.stringify({ prueba: 'wdgrupo', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); process.exit(1); });
