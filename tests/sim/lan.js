// Wi-Fi normal (misma red) y cambio automático de camino. A y B se emparejan por Bluetooth y están en la misma
// red Wi-Fi; C (no es contacto) también; X se hace pasar por A en la red. Se comprueba:
//  1) la conexión Wi-Fi se comprueba con el cifrado y pasa a ser el camino (textos y fotos por Wi-Fi, no por
//     Bluetooth); C no se conecta con nadie; nada viaja en claro por la red;
//  2) fuera de alcance de Bluetooth pero en la misma red: textos y fotos siguen llegando;
//  0) B en segundo plano 40 s: el Wi-Fi sigue (latido nativo) y la foto va por Wi-Fi; 1b) corte breve del router a
//     mitad de una foto: termina por Wi-Fi; 1c) mala señal: lo nuevo por Bluetooth y vuelve al Wi-Fi al mejorar;
//  3) B sale de la red a mitad de un archivo (Bluetooth a alcance): tras el margen termina por Bluetooth, idéntico;
//  4) caída silenciosa (el otro no se entera): el latido la detecta y el texto llega por Bluetooth;
//  5) volver a la red: vuelve el Wi-Fi solo;
//  6) un impostor en la red con la marca de A: B no lo usa (sigue por Bluetooth) y la cierra.
// --solo-fondo: solo el caso del segundo plano (la app de B deja de ejecutar código 40 s, como en la galería o con
// la pantalla bloqueada): el Wi-Fi debe seguir y la foto ir por Wi-Fi (informe del dueño con la 2728).
// Uso: node lan.js <dir_build> [--solo-fondo]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, wifi: 'casa' };
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
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  radio.block(nA, nC); radio.block(nB, nC); // C no se empareja con nadie
  const A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('LAN ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  // Al añadir el contacto se busca en la red al momento (sin esperar al minuto)
  A.win.bleInterface.lan.start(); B.win.bleInterface.lan.start();
  const viaA = () => A.win.bleInterface.linkOf(idB), viaB = () => B.win.bleInterface.linkOf(idA);
  r.wifi_comprobado_s = await waitFor(() => viaA() === 'wifi' && viaB() === 'wifi', 30000);
  await sleep(300);
  r.cabecera_chat_B_wifi = B.win.document.getElementById('chat-contact-subtitle').textContent;
  r.C_conectado_con_alguien = !!(nC.lanConns && nC.lanConns.size) || A.win.bleInterface.lan.links.has(idC) || B.win.bleInterface.lan.links.has(idC);
  const has = async (p, from, f) => (await p.win.vaultLoadMessages(from)).some(f);

  // 0) B en segundo plano 40 s (Android no ejecuta su JavaScript: elegir la foto en la galería, pantalla bloqueada…)
  //    y al volver A le manda una foto: debe seguir por Wi-Fi
  {
    const lanB = B.win.bleInterface.lan;
    clearInterval(lanB._timer); lanB._timer = null;
    const origOnMsg = lanB._onMessage.bind(lanB), held = [];
    lanB._onMessage = (ev) => { held.push(ev); }; // lo que llega espera a que la app vuelva
    await sleep(40000);
    r.fondo_A_sigue_wifi = viaA();
    lanB._onMessage = origOnMsg; held.forEach((ev) => origOnMsg(ev));
    lanB._timer = setInterval(() => lanB._tick(), 4000);
    await sleep(500);
    const fotoF = await sendFile(A, 'fondo.jpg', 300000);
    r.fondo_foto_llega_s = await waitFor(() => has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === fotoF.toString('base64')), 120000);
    r.fondo_foto_fue_por = viaA();
    r.fondo_cabecera_B = B.win.document.getElementById('chat-contact-subtitle').textContent;
    if (process.argv.includes('--solo-fondo')) { console.log('LAN ' + JSON.stringify(r, null, 1)); fs.writeFileSync(path.join(__dirname, 'last_logs_lan.txt'), logs.join('\n')); process.exit(0); }
  }

  // 1) Textos y foto por Wi-Fi (no por Bluetooth)
  const ble0 = nA.sent.length, lan0 = nA.stats.lanOut || 0;
  sendText(A, 'texto por wifi');
  r.texto_wifi_s = await waitFor(() => has(B, idA, (m) => m.content === 'texto por wifi'), 15000);
  const foto = await sendFile(A, 'foto.jpg', 400000);
  r.foto_400KB_wifi_s = await waitFor(() => has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === foto.toString('base64')), 30000);
  await sleep(500);
  r.bluetooth_usado_para_eso = nA.sent.length - ble0; // escrituras Bluetooth de A (solo latidos/acks si acaso)
  r.mensajes_por_wifi = (nA.stats.lanOut || 0) - lan0;
  // Nada en claro por la red
  const lanTraffic = [];
  const origEmit = nB.emit.bind(nB);
  nB.emit = (ev, d) => { if (ev === 'onLanMessage') lanTraffic.push(d.content); return origEmit(ev, d); };
  sendText(A, 'SECRETO-wifi');
  await waitFor(() => has(B, idA, (m) => m.content === 'SECRETO-wifi'), 15000);
  r.en_claro_por_la_red = lanTraffic.some((c) => c.indexOf('SECRETO-wifi') >= 0);
  nB.emit = origEmit;

  // 1b) Corte breve del router (3 s) a mitad de una foto: no se pasa a Bluetooth, la foto termina por Wi-Fi
  {
    nA.opts.lanBps = 150000; nB.opts.lanBps = 150000;
    const bleAntes = nA.sent.length;
    const fotoC = await sendFile(A, 'corte.jpg', 400000);
    await waitFor(() => (nA.stats.lanOutBytes || 0) > lan0 + 200000, 20000);
    nA.setWifi(null); nB.setWifi(null);
    await sleep(3000);
    nA.setWifi('casa'); nB.setWifi('casa');
    r.corte_breve_foto_llega_s = await waitFor(() => has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === fotoC.toString('base64')), 60000);
    r.corte_breve_trozos_por_bluetooth = nA.sent.filter((x, i) => i >= bleAntes && /"t":"f"/.test(x.chunk)).length;
    r.corte_breve_sigue_wifi = viaA() === 'wifi' && viaB() === 'wifi';
    nA.opts.lanBps = 0; nB.opts.lanBps = 0;
  }
  // 1c) Mala señal: ida y vuelta de 2,5 s → lo nuevo por Bluetooth (aquí no hay internet); al mejorar, vuelve al Wi-Fi
  //     (2760, regla del dueño: sin brincar, tras ~30 s buenos)
  {
    nA.opts.lanRtt = 2500; nB.opts.lanRtt = 2500;
    r.mala_senal_pasa_a_bluetooth_s = await waitFor(() => viaA() === 'bluetooth', 30000);
    r.mala_senal_cabecera_B = (await waitFor(() => viaB() === 'bluetooth', 15000)) !== null ? B.win.document.getElementById('chat-contact-subtitle').textContent : viaB();
    nA.opts.lanRtt = 0; nB.opts.lanRtt = 0;
    r.buena_senal_vuelve_wifi_s = await waitFor(() => viaA() === 'wifi' && viaB() === 'wifi', 60000);
  }

  // 2) Fuera de alcance de Bluetooth, misma red
  radio.block(nA, nB); await sleep(1500);
  r.depuracion_tras_bloqueo = { perdidos_A: Array.from(A.win.bleInterface._lostPeers), estados_A: Array.from(A.win.bleInterface._deviceStates.entries()).map(([k, v]) => k + '=' + v.state), bucle: !!A.win.bleInterface._reconnectScanTimer };
  sendText(B, 'lejos pero en la misma red');
  r.sin_bluetooth_texto_s = await waitFor(() => has(A, idB, (m) => m.content === 'lejos pero en la misma red'), 15000);
  const foto2 = await sendFile(B, 'foto2.jpg', 300000);
  r.sin_bluetooth_foto_s = await waitFor(() => has(A, idB, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nA.files.get(m.attachmentRef)) === foto2.toString('base64')), 30000);
  radio.unblock(nA, nB);
  // El simulador solo informa de lo visto al empezar a escanear (Android sigue informando): reiniciar
  for (const p of [A, B]) if (p.win.bleInterface.isScanning) { click(p.win, p.win.document.getElementById('ble-scan-btn')); await sleep(300); }
  // Bluetooth de vuelta (para el paso 3)
  r.bluetooth_de_vuelta_s = await waitFor(() => Array.from(A.win.bleInterface._deviceStates.entries()).some(([k, v]) => !/^lan/.test(k) && (v.state === 'ready_to_chat' || v.state === 'notifications_ready')), 60000);
  r.depuracion_tras_volver = { perdidos_A: Array.from(A.win.bleInterface._lostPeers), estados_A: Array.from(A.win.bleInterface._deviceStates.entries()).map(([k, v]) => k + '=' + v.state) };

  // 3) B sale de la red a mitad de un archivo: termina por Bluetooth
  nA.opts.lanBps = 150000; nB.opts.lanBps = 150000; // Wi-Fi lento para cortar a mitad
  const big = await sendFile(A, 'grande.bin', 1200000);
  await waitFor(() => (nA.stats.lanOutBytes || 0) > 600000, 20000);
  nB.setWifi(null);
  r.cambio_a_bluetooth_tras_margen_s = await waitFor(() => viaA() === 'bluetooth', 20000); // primero se intenta recuperar el Wi-Fi (8 s)
  r.archivo_termina_por_bluetooth_s = await waitFor(() => has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === big.toString('base64')), 240000);
  nA.opts.lanBps = 0; nB.opts.lanBps = 0;
  sendText(A, 'sin wifi por bluetooth');
  r.texto_bluetooth_s = await waitFor(() => has(B, idA, (m) => m.content === 'sin wifi por bluetooth'), 30000);
  r.cabecera_chat_B_bluetooth = B.win.document.getElementById('chat-contact-subtitle').textContent;

  // 5) Volver a la red: vuelve el Wi-Fi solo
  nB.setWifi('casa'); A.win.bleInterface.lan.start(); B.win.bleInterface.lan.start();
  r.vuelve_wifi_s = await waitFor(() => viaA() === 'wifi' && viaB() === 'wifi', 30000);

  // 4) Caída silenciosa: A sale sin que B se entere; B escribe → el latido lo detecta → Bluetooth
  nA.opts.lanSilent = true; nB.opts.lanSilent = true;
  nA.setWifi(null);
  r.B_cree_que_sigue_wifi = viaB() === 'wifi';
  sendText(B, 'tras caida silenciosa');
  r.caida_silenciosa_texto_llega_s = await waitFor(() => has(A, idB, (m) => m.content === 'tras caida silenciosa'), 90000);
  r.B_ahora_va_por = viaB();
  nA.opts.lanSilent = false; nB.opts.lanSilent = false;

  // 6) Impostor X en la red con la marca de A (B está solo en la red con él)
  nA.setWifi(null);
  const nX = new NativePhone('X', 'EE:EE:EE:EE:EE:09', Object.assign({}, opts, { wifi: 'casa' })); radio.add(nX);
  const day = new Date().toISOString().substring(0, 10);
  nX.lan = { nx: idA, token: tokenOf(idA, day), port: 45555 };
  nB.setWifi('casa'); B.win.bleInterface.lan.start();
  await waitFor(() => B.win.bleInterface.lan.links.has(idA), 15000);
  r.B_conecta_con_impostor = B.win.bleInterface.lan.links.has(idA);
  await sleep(4000);
  r.impostor_comprobado = B.win.bleInterface.lan.canReach(idA);
  r.B_va_por = viaB();
  sendText(B, 'con impostor en la red');
  r.texto_llega_a_A_de_verdad_s = await waitFor(() => has(A, idB, (m) => m.content === 'con impostor en la red'), 30000);
  r.impostor_recibio = (nX.listeners && 0) || 'sin app (no descifra nada)';
  r.impostor_cerrado_s = await waitFor(() => !B.win.bleInterface.lan.links.has(idA), 45000);

  r.errores = logs.filter((l) => / error: /.test(l)).slice(0, 5);
  r.registro_wifi = logs.filter((l) => /\[WIFI\]/.test(l)).map((l) => l.replace(/^.*\[WIFI\] /, '')).slice(0, 14);
  console.log('LAN ' + JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(__dirname, 'last_logs_lan.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
