// Protocolo Fénix (fase 1, la cuenta) con umbrales reducidos (window.NEXO_FENIX_TEST): A con 5 contactos
// (B–F). Al llegar al mínimo, A reparte sus fragmentos solo; pingeo; E desaparece → se da por perdido y su
// fragmento pasa a F; E vuelve → borra el suyo. Después A "pierde el teléfono": un teléfono nuevo N pide
// recuperar, 3 contactos confirman en pantalla, N vuelve con el NEXO ID, identidad y contactos de A y
// sigue hablando cifrado con ellos.
// Fase 2: A escribe a C y D; sus mensajes van en segmentos cifrados (cada uno en 2 contactos, que no pueden leerlos);
// pingeo de los segmentos; tras recuperar, los contactos se los devuelven y vuelve el historial.
// Uso: node fenix.js <dir_build> [--io-delay=25] [--mirror]  (--mirror: 2 copias de cada fragmento)
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const mirror = !!arg('mirror', false);
const SEG = { segMin: 3, segMaxMs: 20000 }; // fase 2: segmentos de mensajes pronto
const FX = mirror ? Object.assign({ n: 2, t: 2, min: 2, mirror: 4, pingMs: 15000, lostMs: 600000, tickMs: 3000, rebuildMs: 3000 }, SEG)
  : Object.assign({ n: 4, t: 3, min: 4, mirror: 8, pingMs: 15000, lostMs: 60000, tickMs: 3000, rebuildMs: 3000 }, SEG);
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
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } };
      win.HTMLElement.prototype.scrollTo = function () {}; win.NEXO_FENIX_TEST = FX; win.confirm = () => true;
    },
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
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })] }); fin.dispatchEvent(new p.win.Event('change'));
}
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  // El simulador solo informa de lo visto al empezar a escanear (Android sigue informando): reiniciar
  if (p.win.bleInterface.isScanning) { click(p.win, p.win.document.getElementById('ble-scan-btn')); await sleep(400); }
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(500); } return null; }
const json = (nat, f) => { try { return JSON.parse(nat.files.get(f) || 'null'); } catch (e) { return null; } };

(async () => {
  const radio = new Radio();
  const contacts = mirror ? ['B', 'C', 'D', 'E'] : ['B', 'C', 'D', 'E', 'F'];
  const names = ['A'].concat(contacts);
  const nat = {}, P = {};
  names.forEach((n, i) => { nat[n] = new NativePhone(n, n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':0' + (i + 1), opts); radio.add(nat[n]); nat[n].load(); });
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  const id = (n) => P[n].win.bleInterface.localNexoId;
  const idA = id('A').toLowerCase();
  const r = { build: path.basename(buildDir), modo: mirror ? 'dos copias' : 'una copia + curación + recuperación' };

  // A agrega a cada contacto (solo ve a ese mientras lo agrega) y le saluda
  for (const x of contacts) {
    const others = names.filter((n) => n !== 'A' && n !== x);
    others.forEach((o) => radio.block(nat.A, nat[o]));
    P.A.win.bleInterface.togglePanel(); const ok = await addFound(P.A, x); P.A.win.bleInterface.togglePanel();
    await sleep(800);
    await openChatWith(P.A, x); await sendText(P.A, 'hola ' + x); await sleep(2500); await closeChat(P.A);
    others.forEach((o) => radio.unblock(nat.A, nat[o]));
    if (!ok) { console.log('FENIX ' + JSON.stringify({ error: 'no empareja A' + x, scanning: P.A.win.bleInterface.isScanning, relayScan: P.A.win.bleInterface._relayScan, found: Array.from(P.A.win.bleInterface.foundDevices.values()).map((d) => d.name), nuevos: Array.from(P.A.win.document.querySelectorAll('#ble-new-device > div')).map((d) => d.textContent.substring(0, 30)) })); fs.writeFileSync(path.join(__dirname, 'last_logs_fenix.txt'), logs.join('\n')); process.exit(0); }
  }
  const holders = () => contacts.filter((x) => { const s = json(nat[x], 'nexo_fenix_store.json'); return s && s.owners && s.owners[idA]; });
  r.reparto_s = await waitFor(() => holders().length >= FX.n * (mirror ? 2 : 1), Number(process.env.REPARTO_MS || 120000));
  const stA = json(nat.A, 'nexo_fenix.json');
  r.activo_en_A = !!(stA && stA.k && stA.shares && stA.shares.length === FX.n);
  r.guardan = holders();
  const idxOf = (x) => { const s = json(nat[x], 'nexo_fenix_store.json'); return s && s.owners[idA] ? s.owners[idA].idx : null; };
  r.fragmentos = holders().map((x) => x + ':' + idxOf(x)).join(' ');
  if (mirror) {
    const cnt = {};
    holders().forEach((x) => { cnt[idxOf(x)] = (cnt[idxOf(x)] || 0) + 1; });
    r.dos_copias_de_cada_fragmento = Object.keys(cnt).length === FX.n && Object.values(cnt).every((v) => v === 2);
  }
  // Nadie puede leer lo que guarda; y nada de Fénix aparece en sus chats
  r.contenido_legible_en_nodos = holders().some((x) => /SECRETO|privateKey|"d":"/.test(nat[x].files.get('nexo_fenix_store.json') || ''));
  r.basura_en_chats = (await Promise.all(contacts.map(async (x) => (await P[x].win.vaultLoadMessages(idA)).filter((m) => m.attachmentType || /fenix|"type":"f/.test(String(m.content))).length))).reduce((a, b) => a + b, 0);
  r.burbujas_de_progreso = contacts.reduce((a, x) => a + P[x].win.document.querySelectorAll('.progress-placeholder').length, 0);
  if (process.env.STOP_AFTER === 'reparto') { console.log('FENIX ' + JSON.stringify(r)); fs.writeFileSync(path.join(__dirname, 'last_logs_fenix.txt'), logs.join('\n')); process.exit(0); }
  // Pingeo
  r.pingeo_s = await waitFor(() => logs.some((l) => /\[A\].*Pingeo: .* conserva/.test(l)), 60000);

  if (!mirror) {
    // E desaparece: sin pingeo → perdido → su fragmento pasa a F
    const idxE = idxOf('E');
    names.forEach((n) => { if (n !== 'E') radio.block(nat.E, nat[n]); });
    r.E_perdido_s = await waitFor(() => logs.some((l) => /\[A\].*Nodo .* perdido/.test(l)), 150000);
    r.F_recibe_fragmento_de_E_s = idxE ? await waitFor(() => idxOf('F') === idxE, 90000) : null;
    // E vuelve: debe borrar el suyo
    names.forEach((n) => { if (n !== 'E') radio.unblock(nat.E, nat[n]); });
    r.E_borra_al_volver_s = idxE ? await waitFor(() => idxOf('E') === null, 120000) : null;
  }

  // Fase 2: A escribe a C y D; sus mensajes van en segmentos cifrados, cada uno en 2 contactos
  const hist = [], files = [];
  for (const x of ['C', 'D']) {
    await openChatWith(P.A, x);
    for (let i = 1; i <= 3; i++) { const t = 'SECRETO-hist-' + x + '-' + i; hist.push([x, t]); await sendText(P.A, t); await sleep(700); }
    // Fase 3 (ronda 2757): también un archivo a cada uno; tras recuperar debe volver idéntico a su mensaje
    const name = 'secreto-' + x + '.pdf', bytes = Buffer.concat([Buffer.from('%PDF-1.4 SECRETO-ARCHIVO-' + x + ' '), Buffer.alloc(30000, x.charCodeAt(0))]);
    files.push([x, name, bytes.toString('base64')]);
    await sendFile(P.A, name, 'application/pdf', bytes); await sleep(6000);
    await sleep(2000); await closeChat(P.A);
  }
  const segsOk = () => { const m = json(nat.A, 'nexo_fenix_msgs.json'); return !!(m && m.segs && m.segs.length && m.segs.every((g) => Object.values(g.holders || {}).filter((h) => h.ok).length >= 2)); };
  const histInSegs = async () => { const m = json(nat.A, 'nexo_fenix_msgs.json'); return m && m.segs.reduce((a, g) => a + g.n, 0) >= contacts.length + hist.length; };
  r.segmentos_en_2_contactos_s = await waitFor(async () => segsOk() && await histInSegs(), 120000);
  const mA = json(nat.A, 'nexo_fenix_msgs.json') || { segs: [] };
  r.segmentos = mA.segs.map((g) => g.n + 'msg→' + Object.keys(g.holders).map((h) => contacts.find((x) => id(x).toLowerCase() === h) || h).join('')).join(' ');
  r.segmentos_legibles_en_nodos = contacts.some((x) => /SECRETO-hist/.test(nat[x].files.get('nexo_fenix_store.json') || ''));
  r.pingeo_segmentos_s = await waitFor(() => logs.some((l) => /\[A\].*Pingeo: .* conserva \d+ de \d+ segmentos/.test(l)), 60000);
  // Fase 3: los dos archivos como medios, cada uno en 2 contactos; nadie puede leerlos
  const medsOk = () => { const m = json(nat.A, 'nexo_fenix_msgs.json'); const meds = ((m && m.segs) || []).filter((g) => g.med); return meds.length >= files.length && meds.every((g) => Object.values(g.holders || {}).filter((h) => h.ok).length >= 2); };
  r.medios_en_2_contactos_s = await waitFor(medsOk, 120000);
  r.medios = ((json(nat.A, 'nexo_fenix_msgs.json') || { segs: [] }).segs.filter((g) => g.med)).map((g) => Math.round(g.size / 1024) + 'KB→' + Object.keys(g.holders).map((h) => contacts.find((x) => id(x).toLowerCase() === h) || h).join('')).join(' ');
  r.medios_legibles_en_nodos = contacts.some((x) => Array.from(nat[x].files.entries()).some(([k, v]) => /^nexo_fenix_n_/.test(k) && /SECRETO-ARCHIVO/.test(Buffer.from(String(v), 'base64').toString('latin1'))));

  // A pierde el teléfono; N (nuevo) pide recuperar
  const pubA = (json(nat.A, 'nexo_e2e_identity.json') || {}).pub;
  P.A.win.close(); nat.A.destroyActivity();
  names.forEach((n) => { if (n !== 'A') radio.block(nat.A, nat[n]); });
  const nN = new NativePhone('N', 'EE:0E:0E:0E:0E:09', opts); radio.add(nN); nN.load();
  let N = await boot('N', nN);
  r.N_id_antes = N.win.bleInterface.localNexoId;
  N.win.dispatchEvent(new N.win.CustomEvent('nexo:ui:profile'));
  await sleep(500);
  click(N.win, N.win.document.getElementById('nexo-fenix-recover'));
  // Cada contacto ve el aviso y confirma que es A (hasta t confirmaciones)
  const confirmed = [];
  const tAsk = Date.now();
  while (Date.now() - tAsk < 240000 && !nN.files.get('nexo_fenix.json')) {
    for (const x of contacts) {
      if (confirmed.includes(x) || confirmed.length >= FX.t) continue;
      const btn = Array.from(P[x].win.document.querySelectorAll('#nexo-fenix-ask .fenix-yes')).find((b) => b.textContent === 'Es A');
      if (btn) { click(P[x].win, btn); confirmed.push(x); }
    }
    await sleep(1000);
  }
  r.confirmaron = confirmed.join('');
  r.recuperada_s = nN.files.get('nexo_fenix.json') ? Math.round((Date.now() - tAsk) / 1000) : null;
  r.estado_N = ((N.win.document.getElementById('nexo-fenix-status') || {}).textContent || '').substring(0, 80);
  await sleep(4000);
  // La app se reinicia (en Android, location.reload; aquí se vuelve a arrancar)
  N.win.close(); nN.destroyActivity(); await sleep(1500); nN.load(); N = await boot('N', nN); await sleep(4000);
  r.N_es_A = N.win.bleInterface.localNexoId.toLowerCase() === idA;
  r.misma_identidad = (json(nN, 'nexo_e2e_identity.json') || {}).pub === pubA;
  r.contactos_recuperados = N.win.vaultLoadContacts().map((c) => c.name).sort().join('');
  // Fase 2: los contactos le devuelven los segmentos y vuelve el historial
  const histBack = async () => { let n = 0; for (const [x, t] of hist) if ((await N.win.vaultLoadMessages(id(x))).some((m) => m.content === t)) n++; return n; };
  r.historial_recuperado_s = await waitFor(async () => (await histBack()) === hist.length, 120000);
  r.historial_recuperado = (await histBack()) + ' de ' + hist.length;
  // Fase 3: cada archivo vuelve a su mensaje, idéntico
  const filesBack = async () => { let n = 0; for (const [x, name, b64] of files) { const m = (await N.win.vaultLoadMessages(id(x))).find((mm) => mm.attachmentMeta && mm.attachmentMeta.name === name); const pay = m && (m.attachmentPayload || (m.attachmentRef && nN.files.get(m.attachmentRef))); if (pay === b64) n++; } return n; };
  r.archivos_recuperados_s = await waitFor(async () => (await filesBack()) === files.length, 120000);
  r.archivos_recuperados = (await filesBack()) + ' de ' + files.length;
  // Sigue hablando cifrado con un contacto (sesiones nuevas del protocolo 2) sin aviso de clave cambiada
  const B = P.B;
  await openChatWith(N, 'B'); await sendText(N, 'SECRETO-he vuelto');
  r.B_recibe_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'SECRETO-he vuelto'), 90000);
  const cB = B.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idA) || {};
  r.B_sin_aviso_de_clave = !cB.pendingKey;
  await openChatWith(B, 'A'); await sendText(B, 'SECRETO-bienvenido');
  r.N_recibe_respuesta_s = await waitFor(async () => (await N.win.vaultLoadMessages(B.win.bleInterface.localNexoId)).some((m) => m.content === 'SECRETO-bienvenido'), 90000);
  r.errores_descifrado = logs.filter((l) => /No se pudo descifrar/.test(l)).length;
  r.contenido_en_registros = logs.filter((l) => /SECRETO/.test(l)).length;
  r.diag_N = logs.filter((l) => /\[N\].*FENIX/.test(l)).map((l) => l.replace(/^.*?\[N\] \w+: /, '').substring(0, 90)).slice(0, 8);
  console.log('FENIX ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fenix.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_fenix.txt'), logs.join('\n')); process.exit(1); });
