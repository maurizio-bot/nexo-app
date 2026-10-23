// Jump (mensajes de varios saltos): A y C fuera de alcance, B en medio (A–B–C). A escribe a C (texto
// corto, largo y una foto), C contesta; todo pasa por B sin que B pueda leerlo ni lo muestre. Estados:
// ✓ al quedar en B (custodia), ✓✓ cuando confirma C (ack de extremo a extremo), leído al abrir el chat.
// También: C sale del alcance de B (B lo guarda y lo entrega al volver) y cadena de 3 saltos.
// Uso: node jump.js <dir_build> [--io-delay=25] [--shared] [--chain] [--stranger [--low-battery]]
//   --shared: A nunca ha visto a C (B le comparte el contacto con su clave)
//   --chain[=N]:  N teléfonos en fila (por defecto 4, A–B–C–D); A escribe al último (N-1 saltos)
//   --stranger: B no es contacto de nadie (solo tiene NEXO y está en medio): camino bajo demanda
//   --low-battery: (con --stranger) B al 10 % sin cargar: no debe hacer de puente; luego se enchufa
//   --direct-later: la foto queda en B sin camino a C y luego A y C quedan a alcance: A la reenvía directo
//   --bridge-build=<dir>: B (el puente) con otra build (p. ej. una anterior sin remitente sellado)
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const directLater = !!arg('direct-later', false);
const bridgeA = process.argv.find((x) => x.startsWith('--bridge-build='));
const bridgeDir = bridgeA ? path.resolve(bridgeA.split('=')[1]) : buildDir;
const chainN = arg('chain', 0) === true ? 4 : Number(arg('chain', 0)) || 0;
// --no-route-wait: A escribe justo después de perder el alcance directo con el destino (en GitHub la ruta
//   estaba lista al instante y la foto se quedaba en "enviando")
const noRouteWait = !!arg('no-route-wait', false);
// --net: todos con internet por datos móviles (relé Nostr local): Jump no debe mandar archivos al puente por internet
//   (con datos móviles los archivos no van por internet y se quedaban en "enviando"; visto en GitHub)
const withNet = !!arg('net', false);
let NET_RELAYS = null;
const shared = !!arg('shared', false), chain = chainN >= 3, stranger = !!arg('stranger', false), lowBat = !!arg('low-battery', false);
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
  const dir = name === 'B' ? bridgeDir : buildDir;
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(dir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { if (NET_RELAYS) win.NEXO_NET_RELAYS = NET_RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
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
  let netRelay = null;
  if (withNet) { const { NostrRelay } = require('./nostr_relay'); netRelay = new NostrRelay(); NET_RELAYS = [await netRelay.start()]; }
  const radio = new Radio();
  const names = chain ? 'ABCDEFGHIJ'.substring(0, chainN).split('') : ['A', 'B', 'C'];
  const nat = {}, P = {};
  // Dirección Bluetooth válida (hexadecimal): A..F como antes (AA:AA:…), de G en adelante A6:A6:…
  const hx = (n, i) => (/[A-F]/.test(n) ? n.repeat(2) : (0xA0 + i).toString(16).toUpperCase());
  names.forEach((n, i) => { const h = hx(n, i); nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), opts); radio.add(nat[n]); nat[n].load(); });
  if (lowBat) nat.B.battery = { level: 10, charging: false, powerSave: false };
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  const id = (n) => P[n].win.bleInterface.localNexoId;
  const dest = chain ? names[names.length - 1] : 'C';
  const r = { build: path.basename(buildDir), modo: chain ? 'cadena ' + names.join('-') : stranger ? ('B desconocido en medio' + (lowBat ? ', batería 10 %' : '')) : (shared ? 'A nunca vio a C (contacto compartido)' : 'A y C se conocían') };

  // Emparejar X con Y: X solo ve a Y mientras lo agrega; X saluda para que Y lo conozca
  async function pair(x, y) {
    const others = names.filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    if (process.env.JUMP_DEBUG) { const bi = P[x].win.bleInterface, o = bi._addNewDevice.bind(bi); bi._addNewDevice = (d) => { console.error('addNew', x, d, !!bi.foundDevices.get(d), Array.from(bi.foundDevices.keys()).join(',')); return o(d); }; }
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    if (process.env.JUMP_DEBUG) console.error('pair', x, y, ok, P[x].win.vaultLoadContacts().map((c) => c.name).join(','), Array.from(P[x].win.bleInterface.foundDevices.values()).map((d) => d.name + ':' + d.deviceUUID).join(','));
    await sleep(800);
    await openChatWith(P[x], y); await sendText(P[x], 'hola ' + y); await sleep(2500);
    // Hasta tener la clave del otro (con muchos teléfonos el intercambio tarda más)
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
    await closeChat(P[x]);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  const links = chain ? names.slice(1).map((n, i) => [names[i], n]) : stranger ? [] : [['A', 'B'], ['B', 'C']];
  for (const [x, y] of links) if (!(await pair(x, y))) { console.log('JUMP ' + JSON.stringify({ error: 'no empareja ' + x + y })); process.exit(0); }
  r.contactos_A = P.A.win.vaultLoadContacts().map((c) => c.name);
  if (!shared) { if (!(await pair('A', dest))) { console.log('JUMP ' + JSON.stringify({ error: 'no empareja A' + dest })); process.exit(0); } }
  // Alcance: solo los vecinos de la cadena se ven
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    if (j !== i + 1) radio.block(nat[names[i]], nat[names[j]]);
  }
  if (shared) {
    // B comparte C con A (tarjeta de contacto con su clave pública)
    await openChatWith(P.B, 'A');
    click(P.B.win, P.B.win.document.querySelector('.attach-menu-item[data-type="contact"]')); await sleep(400);
    const sheet = P.B.win.document.getElementById('nexo-share-sheet');
    const rowC = sheet && Array.from(sheet.querySelectorAll('.nexo-pick-row')).find((x) => x.textContent.indexOf('C') === 0);
    if (rowC) { const cb = rowC.querySelector('input'); cb.checked = true; cb.dispatchEvent(new P.B.win.Event('change')); }
    click(P.B.win, sheet && sheet.querySelector('#nexo-share-send')); await sleep(3000);
    await closeChat(P.B);
    await openChatWith(P.A, 'B'); await sleep(800);
    const card = P.A.win.document.querySelector('#messages-container .contact-card');
    click(P.A.win, card && card.querySelector('.contact-card-add')); await sleep(500);
    await closeChat(P.A);
    const cC = P.A.win.vaultLoadContacts().find((c) => (c.nexoId || '').toLowerCase() === id('C').toLowerCase());
    r.A_recibe_contacto_C_con_clave = !!(cC && cC.publicKey);
  }
  // Rutas: esperar a que A tenga ruta al destino (con un desconocido en medio la busca al enviar)
  if (!stranger && !noRouteWait) r.ruta_lista_s = await waitFor(() => !!P.A.win.bleInterface.relay.relayHop(id(dest).toLowerCase()), 60000);
  const airBefore = Object.keys(air).reduce((o, k) => { o[k] = air[k].length; return o; }, {});
  // Remitente sellado: todo lo que los puentes reciben a partir de aquí (paquetes completos)
  const seenByBridge = {};
  names.filter((n) => n !== 'A' && n !== dest).forEach((b) => {
    const bi = P[b].win.bleInterface, orig = bi._prePayload.bind(bi);
    seenByBridge[b] = [];
    bi._prePayload = (d) => { seenByBridge[b].push(String((d && (d.content || d.data)) || '')); return orig(d); };
  });
  const badgeB0 = P.B.win.bleInterface.newDevicesCount || 0;

  // A escribe al destino: corto, largo y foto
  r.contactos_A = P.A.win.vaultLoadContacts().map((c) => c.name);
  if (!(await openChatWith(P.A, dest))) { console.log('JUMP ' + JSON.stringify(Object.assign(r, { error: 'A no tiene el chat de ' + dest }))); fs.writeFileSync(path.join(__dirname, 'last_logs_jump.txt'), logs.join('\n')); process.exit(0); }
  const largo = 'SECRETO-largo-' + 'abcdefghij'.repeat(30);
  await sendText(P.A, 'SECRETO-corto'); await sleep(300);
  r.estado_corto_en_A_al_enviar = status(P.A, 'SECRETO-corto');
  await sendText(P.A, largo);
  const foto = Buffer.alloc(20000); for (let i = 0; i < foto.length; i++) foto[i] = (i * 31 + 3) & 255;
  click(P.A.win, P.A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(P.A.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new P.A.win.File([foto], 'foto.png', { type: 'image/png' })] });
  fin.dispatchEvent(new P.A.win.Event('change'));
  const idA = id('A');
  const has = async (n, pred) => (await P[n].win.vaultLoadMessages(idA)).some(pred);
  if (lowBat) {
    r.con_B_al_10_llega = await waitFor(() => has(dest, (m) => m.content === 'SECRETO-corto'), 70000);
    r.estado_A_con_B_al_10 = status(P.A, 'SECRETO-corto');
    r.B_puentes = logs.filter((l) => /\[B\].*Puente:/.test(l)).length;
    nat.B.battery = { level: 10, charging: true, powerSave: false };
    console.error('B enchufado');
  }
  r.llega_corto_s = await waitFor(() => has(dest, (m) => m.content === 'SECRETO-corto'), lowBat ? 300000 : 60000);
  r.rutas_A = P.A.win.bleInterface.relay.describe();
  r.llega_largo_s = await waitFor(() => has(dest, (m) => m.content === largo), 60000);
  r.llega_foto_s = await waitFor(() => has(dest, (m) => (m.attachmentType === 'file' || m.attachmentType === 'image') && (m.attachmentPayload === foto.toString('base64') || (m.attachmentRef && nat[dest].files.get(m.attachmentRef) === foto.toString('base64')))), 90000);
  r.doble_check_corto_s = await waitFor(() => ['delivered', 'read'].includes(status(P.A, 'SECRETO-corto')), 30000);
  const statusById = (p, mid) => { const s = p.win.document.querySelector('.message[data-msg-id="' + mid + '"] .msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
  const fotoMsg = async () => (await P.A.win.vaultLoadMessages(id(dest))).filter((m) => m.attachmentType).pop();
  await waitFor(async () => { const m = await fotoMsg(); return m && ['delivered', 'read'].includes(statusById(P.A, m.msgId)); }, 30000);
  r.estados_A = ['SECRETO-corto', 'SECRETO-largo'].map((t) => status(P.A, t)).concat([statusById(P.A, ((await fotoMsg()) || {}).msgId)]);
  // El destino abre el chat; lo que llega con el chat abierto se marca leído en A
  await openChatWith(P[dest], 'A');
  await sendText(P.A, 'visto?');
  r.leido_en_A_s = await waitFor(() => status(P.A, 'visto?') === 'read', 30000);
  await sendText(P[dest], 'respuesta de ' + dest);
  r.respuesta_llega_a_A_s = await waitFor(async () => (await P.A.win.vaultLoadMessages(id(dest))).some((m) => m.content === 'respuesta de ' + dest), 60000);
  r.estado_respuesta = await waitFor(() => ['delivered', 'read'].includes(status(P[dest], 'respuesta de ' + dest)), 30000);
  // Los puentes no lo ven ni lo guardan
  const bridges = names.filter((n) => n !== 'A' && n !== dest);
  r.puentes_leen_algo = bridges.filter((b) => air[b].slice(airBefore[b] || 0).join('\n').match(/SECRETO|abcdefghijabcdefghij|respuesta de/));
  // ¿Ven los puentes quién manda lo que va para el destino? (NEXO ID o nombre de A en paquetes para el destino)
  {
    const idAl = id('A').toLowerCase(), dl = id(dest).toLowerCase();
    r.puentes_ven_remitente = [];
    r.sobres_sellados_vistos = 0;
    for (const b of Object.keys(seenByBridge)) {
      for (const raw of seenByBridge[b]) {
        let o = null; try { o = JSON.parse(raw); } catch (e) { continue; }
        const forDest = String(o.to || o.dt || '').toLowerCase() === dl;
        if (o.type === 'sx') r.sobres_sellados_vistos++;
        if (forDest && (raw.toLowerCase().indexOf(idAl) >= 0 || /"f":"A"/.test(raw))) { r.puentes_ven_remitente.push(b + ':' + (o.type || o.t)); }
      }
    }
    r.puentes_ven_remitente = Array.from(new Set(r.puentes_ven_remitente));
  }
  r.puentes_muestran_algo = [];
  for (const b of bridges) {
    const all = [];
    for (const c of P[b].win.vaultLoadContacts()) (await P[b].win.vaultLoadMessages(c.nexoId)).forEach((m) => all.push(m));
    if (all.some((m) => /SECRETO|respuesta de/.test(m.content || '') || (m.attachmentMeta && /foto/.test(m.attachmentMeta.name || '')))) r.puentes_muestran_algo.push(b);
  }
  const nm = (x) => String(x || '').replace(/:/g, '').toLowerCase();
  const cA = P[dest].win.vaultLoadContacts().find((x) => (x.nexoId || '').toLowerCase() === idA.toLowerCase());
  r.destino_no_confunde_A_con_puente = !!cA && !bridges.some((b) => [nat[b].address, nat[b].initAddress].map(nm).includes(nm(cA.deviceId)));

  // Custodia: B ya tiene la foto y C se aleja justo cuando B empieza a reenviarla → B la guarda y la
  // entrega cuando C vuelve
  if (!chain) {
    await closeChat(P.C);
    const foto2 = Buffer.alloc(30000); for (let i = 0; i < foto2.length; i++) foto2[i] = (i * 17 + 11) & 255;
    const nLogs = logs.length;
    click(P.A.win, P.A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
    const fin2 = Array.from(P.A.win.document.querySelectorAll('input[type=file]')).pop();
    Object.defineProperty(fin2, 'files', { value: [new P.A.win.File([foto2], 'foto2.png', { type: 'image/png' })] });
    fin2.dispatchEvent(new P.A.win.Event('change'));
    r.B_recibe_foto2_s = await waitFor(() => logs.slice(nLogs).some((l) => /\[B\].*Puente: file/.test(l)), 60000);
    radio.block(nat.B, nat.C);
    await sleep(4000);
    const m2 = await fotoMsg();
    r.estado_A_con_foto2_en_B = statusById(P.A, m2 && m2.msgId);
    r.C_no_la_tiene_aun = !(await has('C', (m) => m.attachmentPayload === foto2.toString('base64')));
    r.cola_en_B = P.B.win.bleInterface.relay.queue.length;
    await sleep(3000);
    if (directLater) radio.unblock(nat.A, nat.C); else radio.unblock(nat.B, nat.C);
    r.llega_al_volver_C_s = await waitFor(() => has('C', (m) => (m.attachmentPayload === foto2.toString('base64') || (m.attachmentRef && nat.C.files.get(m.attachmentRef) === foto2.toString('base64')))), 120000);
    r.doble_check_al_volver_s = await waitFor(() => ['delivered', 'read'].includes(statusById(P.A, m2 && m2.msgId)), 30000);
    r.cola_en_B_final = P.B.win.bleInterface.relay.queue.length;
    // Qué queda en la cola de B (tipo de paquete → cuántos): ayuda a ver acumulaciones
    r.cola_en_B_tipos = {};
    P.B.win.bleInterface.relay.queue.forEach((it) => { let t = it.kind; try { if (it.data) t += ':' + JSON.parse(it.data).type; } catch (e) {} t += '→' + (it.dst === P.A.win.bleInterface.localNexoId.toLowerCase() ? 'A' : 'C'); r.cola_en_B_tipos[t] = (r.cola_en_B_tipos[t] || 0) + 1; });
    if (directLater) r.reenviado_directo_por_A = logs.some((l) => /\[A\].*se reenvía directo/.test(l));
  }
  if (stranger) {
    r.B_contactos = P.B.win.vaultLoadContacts().map((c) => c.name);
    r.B_avisos_nuevos_por_jump = (P.B.win.bleInterface.newDevicesCount || 0) - badgeB0;
    r.B_lista_chats = Array.from(P.B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).length;
    r.conexiones_de_paso_A_B = [P.A.win.bleInterface.relay.transient.size, P.B.win.bleInterface.relay.transient.size];
    r.cierre_conexiones_de_paso_s = await waitFor(() => P.A.win.bleInterface.relay.transient.size === 0 && P.B.win.bleInterface.relay.transient.size === 0, 150000);
  }
  r.errores = logs.filter((l) => / error: /.test(l)).slice(0, 5);
  r.descifrado_fallido = logs.filter((l) => /No se pudo descifrar/.test(l)).length;
  console.log('JUMP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_jump.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_jump.txt'), logs.join('\n')); process.exit(1); });
