// Estudio EDC (dueño 17-11): CAPACIDAD. ¿Cuántos contactos, cuántos mensajes por chat y cuántos chats llenos aguanta NEXO?
// El teléfono A (app real en Chromium, CPU frenada ×4 como uno de gama media) arranca con el almacén ya lleno, escrito en
// el formato real del vault: libreta de --contactos contactos (con clave pública P-256 de verdad, como tras el kx), --chats
// chats de --msgs mensajes y UN chat «grande» de --grande mensajes (85 % texto, 10 % fotos referenciadas a su archivo
// nexo_att_*, 3 % vídeos y 2 % archivos con su miniatura dentro del historial, como los guarda la app). Sin radio ni internet.
// Mide: tamaño de los archivos, arranque (hasta la lista pintada) y los primeros 20 s (lo que hace la app sola al abrir),
// pintar la lista, buscar contacto, abrir el chat grande, buscar en él, cargar su historial completo, guardar un mensaje
// nuevo (y cuántos quedan en el disco después), recorrer todos los chats (memoria con la caché llena) y abrir varios.
// La memoria se mide con CDP (JSHeapUsedSize) tras forzar la recolección de basura.
// --io-ms-mb=N: coste del nativo por MB leído/guardado (descifrar/cifrar + puente); 0 = solo el JS (por defecto).
// Uso: node capacidad.js <dir_build> [--contactos=1000] [--chats=50] [--msgs=2000] [--grande=10000] [--cpu=4] [--io-ms-mb=0]
//        [--abrir=10] [--perdidos=50]   (chats que se abren por la interfaz; contactos con chat que quedan «perdidos» 65 s)
// Salida: CAPACIDAD {json}
'use strict';
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { Radio, NativePhone } = require('./native_mock');
const { PW, bootPhone, cdpMetrics, phaseStart, phaseEnd, sleep } = require('./pw_harness');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=') || x === '--' + k); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const C = arg('contactos', 1000), K = arg('chats', 50), M = arg('msgs', 2000), G = arg('grande', 10000), CPU = arg('cpu', 4), IO = arg('io-ms-mb', 0);
const ABRIR = arg('abrir', 10), PERDIDOS = arg('perdidos', 50);
const logs = [];
let _rnd = 12345; const rnd = () => { _rnd = (_rnd * 1664525 + 1013904223) >>> 0; return _rnd / 4294967296; };
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nxId = () => 'NX' + Array.from({ length: 8 }, () => B36[Math.floor(rnd() * 36)]).join('');
const WORDS = 'hola qué tal dónde estás nos vemos en la entrada del escenario principal ya llegué voy por agua me quedé sin batería ahorita te busco cerca de la torre de sonido está increíble el show mándame tu ubicación perdí a los demás espérame junto a los baños vamos a cenar algo regreso en diez minutos'.split(' ');
const sentence = () => { const n = 2 + Math.floor(rnd() * rnd() * 30); const w = []; for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(rnd() * WORDS.length)]); return w.join(' '); };
const fakeB64 = (n) => { const s = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLw'; let o = ''; while (o.length < n) o += s; return o.substring(0, n - (n % 4)); };
const VTHUMB = fakeB64(9000), FTHUMB = fakeB64(6000);
const mb = (n) => Math.round(n / 1048576 * 100) / 100;

function genMsgs(cid, me, n, mark) {
  const out = [], now = Date.now();
  for (let i = 0; i < n; i++) {
    const own = i % 2 === 0, id = 'm' + cid.slice(-6) + '_' + i, ts = now - (n - i) * 40000;
    const m = { msgId: id, messageId: id, text: '', content: '', senderNexoId: own ? me : cid, senderName: own ? '' : 'Contacto', timestamp: ts, seq: i + 1, status: own ? 'read' : 'delivered', _own: own, type: 'text', attachmentType: null, attachmentPayload: null, attachmentMeta: null, attachmentRef: null };
    const r = rnd() * 100;
    if (r < 10) Object.assign(m, { content: '[adjunto]', text: '[adjunto]', attachmentType: 'image', attachmentRef: 'nexo_att_' + id + '.b64', attachmentMeta: { format: 'jpeg', mime: 'image/jpeg', w: 1280, h: 960, size: 180000 } });
    else if (r < 13) Object.assign(m, { content: '[adjunto]', text: '[adjunto]', attachmentType: 'video', attachmentRef: 'nexo_att_' + id + '.b64', attachmentMeta: { format: 'mp4', mime: 'video/mp4', duration: 12, thumb: VTHUMB, preview: true, hdSize: 4200000 } });
    else if (r < 15) Object.assign(m, { content: '[adjunto]', text: '[adjunto]', attachmentType: 'file', attachmentRef: 'nexo_att_' + id + '.b64', attachmentMeta: { name: 'boleto_' + i + '.pdf', mime: 'application/pdf', size: 240000, thumb: FTHUMB, pages: 2 } });
    else { const t = sentence(); m.content = t; m.text = t; }
    if (mark && i === 5) { m.content = m.text = 'el código del casillero es zanahoria 4471'; m.type = 'text'; m.attachmentType = null; m.attachmentRef = null; m.attachmentMeta = null; }
    if (mark && i === n - 3) { m.content = m.text = 'nos vemos en la mandarina gigante'; m.type = 'text'; m.attachmentType = null; m.attachmentRef = null; m.attachmentMeta = null; }
    out.push(m);
  }
  return out;
}

(async () => {
  const res = { prueba: 'capacidad', build: path.basename(buildDir), contactos: C, chats_llenos: K, msgs_por_chat: M, msgs_chat_grande: G, cpu_frenada: CPU + 'x', io_ms_por_MB: IO };
  const browser = await PW.chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { window.NEXO_NET_RELAYS = []; window.NEXO_SPARE_RELAYS = []; window.NEXO_OWN_RELAYS = []; });
  // una foto JPEG real (para los adjuntos que se ven en pantalla)
  const gen = await ctx.newPage(); await gen.goto('about:blank');
  const jpeg = await gen.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d'); for (let i = 0; i < 3000; i++) { x.fillStyle = `hsl(${i % 360},60%,${30 + (i % 40)}%)`; x.fillRect(Math.random() * 640, Math.random() * 480, 14, 14); } return c.toDataURL('image/jpeg', 0.7).split(',')[1]; });
  await gen.close();

  // ---- el almacén lleno ----
  const t0g = Date.now();
  const ME = 'NXAAAA0001', me = ME.toLowerCase();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, ioDelay: 10, pluginThread: IO || 0, ioOffThread: true });
  const io = { load: 0, loadBytes: 0, save: 0, saveBytes: 0, maxLoad: 0 };
  nA.calls = { push(c) { if (!c) return; if (c.name === 'loadFromFile') { io.load++; const s = (nA.files.get(c.args.filename) || '').length; io.loadBytes += s; io.maxLoad = Math.max(io.maxLoad, s); } if (c.name === 'saveToFile') { io.save++; io.saveBytes += String(c.args.content || '').length; } }, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  // (wrap() del simulador clona los argumentos para nA.calls: con archivos de MB eso cuesta en Node; aquí solo se cuentan)
  const origPlugin = NativePhone.prototype.plugin;
  nA.plugin = function () { const api = origPlugin.call(this); return api; };
  const radio = new Radio(); radio.add(nA);
  nA.files.set('nexo_advertising_id.json', JSON.stringify({ nexoId: ME, createdAt: Date.now() - 86400000 * 30 }));
  const contacts = [];
  for (let i = 0; i < C; i++) {
    const e = nodeCrypto.createECDH('prime256v1'); e.generateKeys();
    const id = (i === 0 ? 'NXBIG00000' : nxId()).toLowerCase();
    contacts.push({ nexoId: id, deviceUUID: id, name: 'Persona ' + i + ' ' + WORDS[i % WORDS.length], displayName: 'Persona ' + i, publicKey: e.getPublicKey().toString('base64'), addedAt: Date.now() - 86400000 * (C - i), lastSeen: Date.now() - Math.floor(rnd() * 86400000 * 7), online: false, unreadCount: i % 17 === 0 ? 3 : 0, lastMessage: '', deviceId: 'C0:' + ('0000' + i.toString(16)).slice(-4).toUpperCase().replace(/(..)(..)/, '$1:$2') + ':00:11:22' });
  }
  res.generacion_s = Math.round((Date.now() - t0g) / 100) / 10;
  const fileSizes = { chat_lleno: 0, chat_grande: 0, colas: 0, adjuntos_en_pantalla: 0 };
  const writeChat = (c, n, mark) => {
    const msgs = genMsgs(c.nexoId, me, n, mark), last = msgs[msgs.length - 1];
    const full = JSON.stringify({ messages: msgs, savedAt: Date.now() });
    nA.files.set('nexo_vault_msgs_v2_' + c.nexoId + '.json', full);
    const tail = JSON.stringify({ messages: msgs.slice(-80), savedAt: Date.now(), tail: true });
    nA.files.set('nexo_vault_msgs_v2_' + c.nexoId + '.tail.json', tail); fileSizes.colas += tail.length;
    msgs.slice(-80).forEach((m) => { if (m.attachmentRef) { const p = m.attachmentType === 'image' ? jpeg : fakeB64(20000); nA.files.set(m.attachmentRef, p); fileSizes.adjuntos_en_pantalla += p.length; } });
    c.lastMessage = last.attachmentType ? '📎' : String(last.content).substring(0, 60); c.lastMessageAt = last.timestamp;
    return full.length;
  };
  const tw = Date.now();
  if (G > 0 && C > 0) fileSizes.chat_grande = writeChat(contacts[0], G, true);
  for (let i = 1; i <= K && i < C; i++) fileSizes.chat_lleno = Math.max(fileSizes.chat_lleno, writeChat(contacts[i], M, false));
  res.escritura_datos_s = Math.round((Date.now() - tw) / 100) / 10;
  const cjson = JSON.stringify({ contacts, savedAt: Date.now() });
  nA.files.set('nexo_vault_contacts.json', cjson);
  let total = 0; nA.files.forEach((v) => { total += v.length; });
  res.archivos_MB = { contactos: mb(cjson.length), bytes_por_contacto: Math.round(cjson.length / Math.max(1, C)), chat_grande: mb(fileSizes.chat_grande), bytes_por_mensaje_grande: Math.round(fileSizes.chat_grande / Math.max(1, G)), chat_lleno: mb(fileSizes.chat_lleno), todos_los_chats: mb(fileSizes.chat_lleno * K + fileSizes.chat_grande), colas_tail: mb(fileSizes.colas), vault_total: mb(total) };
  const bigFile = 'nexo_vault_msgs_v2_' + contacts[0].nexoId + '.json';

  // ---- arranque ----
  nA.load();
  const tBoot = Date.now();
  const A = await bootPhone(ctx, 'A', nA, dist, { cpuThrottle: CPU, logs, seedName: 'Yo' });
  res.arranque_ms = A.bootMs;
  const expectRows = Math.min(C, C);
  let rows = 0; for (let i = 0; i < 600 && rows < expectRows; i++) { rows = await A.page.evaluate(() => document.querySelectorAll('#main-contacts-list .ble-contact-row').length); if (rows < expectRows) await sleep(100); }
  res.lista_pintada_ms = Date.now() - tBoot; res.filas_en_lista = rows;
  const gc = async () => { try { await A.cdp.send('HeapProfiler.collectGarbage'); } catch (e) {} };
  const heap = async () => { await gc(); return Math.round((await cdpMetrics(A)).JSHeapUsedSize / 1048576 * 10) / 10; };
  // los primeros 20 s: lo que la app hace sola (cargar pendientes de todos, claves de firma, códigos rotativos…)
  const io0 = Object.assign({}, io);
  let peak = 0; const st0 = await phaseStart([A]);
  for (let i = 0; i < 20; i++) { await sleep(1000); peak = Math.max(peak, (await cdpMetrics(A)).JSHeapUsedSize); }
  const ph0 = await phaseEnd([A], st0);
  res.primeros_20s = Object.assign({}, ph0.A, { heap_pico_MB: Math.round(peak / 1048576), lecturas: io.load - io0.load, MB_leidos: mb(io.loadBytes - io0.loadBytes), escrituras: io.save - io0.save, MB_escritos: mb(io.saveBytes - io0.saveBytes) });
  res.heap_tras_arranque_MB = await heap();
  res.dom_nodos_lista = await A.page.evaluate(() => document.getElementsByTagName('*').length);
  // pintar la lista de contactos (lo que pasa en cada cambio de un contacto, agrupado cada 300 ms)
  res.pintar_lista_ms = await A.page.evaluate(() => { const r = []; for (let k = 0; k < 3; k++) { const t = performance.now(); window.bleInterface._renderContactsListNow(); void document.body.offsetHeight; r.push(Math.round(performance.now() - t)); } return r; });
  // guardar la libreta (cada vez que se ve a un contacto al escanear, llega un mensaje, etc.: _saveBLEContacts)
  res.guardar_libreta_ms = await A.page.evaluate(() => { const t = performance.now(); window.vaultSaveContacts(window.vaultLoadContacts()); const t1 = performance.now(); const s = JSON.stringify({ contacts: window.vaultLoadContacts(), savedAt: Date.now() }); const t2 = performance.now(); return { deduplicar: Math.round(t1 - t), serializar: Math.round(t2 - t1), MB: Math.round(s.length / 10485.76) / 100 }; });
  // ¿es contacto? (se pregunta por cada teléfono visto al escanear, por cada fila de «Agregar»…)
  res.es_contacto_us = await A.page.evaluate(() => { const ids = ['nxzzzzzzzz', 'nxbig00000']; const t = performance.now(); let n = 0; for (let i = 0; i < 200; i++) { const id = ids[i % 2]; if ((window.vaultLoadContacts() || []).some((c) => String(c.nexoId || c.deviceUUID).toLowerCase() === id)) n++; } return Math.round((performance.now() - t) / 200 * 1000); });
  // buscar contacto («Agregar» → buscador)
  res.buscar_contacto = await A.page.evaluate(async () => {
    const bi = window.bleInterface; const t0 = performance.now(); bi.togglePanel(); void document.body.offsetHeight; const abrir = Math.round(performance.now() - t0);
    const si = document.getElementById('ble-search-input'); si.value = 'persona 12'; const t1 = performance.now(); si.dispatchEvent(new Event('input', { bubbles: true })); void document.body.offsetHeight; const filtrar = Math.round(performance.now() - t1);
    si.value = ''; si.dispatchEvent(new Event('input', { bubbles: true }));
    const t2 = performance.now(); bi.togglePanel(); void document.body.offsetHeight; const cerrar = Math.round(performance.now() - t2);
    return { abrir_agregar_ms: abrir, filtrar_ms: filtrar, cerrar_ms: cerrar };
  });
  await sleep(1500);
  // ---- el chat grande ----
  if (G > 0) {
    const openChat = (name) => A.page.evaluate((name) => new Promise((resolve) => {
      const t0 = performance.now();
      const r = Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === name);
      if (!r) return resolve(-1);
      r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const check = () => { const n = document.querySelectorAll('#messages-container .message').length; if (n > 0) requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0)))); else if (performance.now() - t0 > 30000) resolve(-2); else setTimeout(check, 5); };
      check();
    }), name);
    const closeChat = () => A.page.evaluate(() => { const b = document.getElementById('chat-back-btn'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true })); window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })); });
    const bigName = contacts[0].name;
    const stc = await phaseStart([A]);
    const tOpen = await openChat(bigName); await sleep(1500);
    const phc = await phaseEnd([A], stc);
    res.chat_grande = { abrir_ms: tOpen, burbujas: await A.page.evaluate(() => document.querySelectorAll('#messages-container .message').length), abrir_largas: phc.A.largas, abrir_largas_ms: phc.A.largas_ms, heap_MB: await heap() };
    // buscar dentro del chat (lupa del menú «+»): uno reciente y uno viejo (mensaje nº 6 de G)
    res.chat_grande.buscar = await A.page.evaluate(async () => {
      const it = document.querySelector('.attach-menu-item[data-type="search"]'); if (it) it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const inp = document.getElementById('nexo-search-input'); if (!inp) return { error: 'sin buscador' };
      const go = (q) => { inp.value = q; const t = performance.now(); inp.dispatchEvent(new Event('input', { bubbles: true })); void document.body.offsetHeight; return { ms: Math.round(performance.now() - t), cuenta: (document.getElementById('nexo-search-count') || {}).textContent || '', resaltados: document.querySelectorAll('#messages-container .msg-search-hit').length }; };
      const reciente = go('mandarina'), viejo = go('zanahoria'), comun = go('escenario');
      inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
      const x = document.getElementById('nexo-search-close'); if (x) x.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { reciente, viejo_msg6: viejo, palabra_comun: comun };
    });
    // historial completo (al subir a ver anteriores o al enviar): leer + puente + parsear + ordenar
    res.chat_grande.cargar_completo = await A.page.evaluate(async (cid) => { const t = performance.now(); const l = await window.vaultLoadMessages(cid); return { ms: Math.round(performance.now() - t), mensajes: l.length }; }, contacts[0].nexoId);
    res.chat_grande.heap_con_completo_MB = await heap();
    // solo el JS: parsear y serializar ese historial (lo que cuesta cada guardado)
    res.chat_grande.js_puro = await A.page.evaluate(async (f) => {
      const r = await window.Capacitor.Plugins.NexoBLE.loadFromFile({ filename: f });
      const t0 = performance.now(); const o = JSON.parse(r.content); const t1 = performance.now(); const s = JSON.stringify(o); const t2 = performance.now();
      return { parse_ms: Math.round(t1 - t0), stringify_ms: Math.round(t2 - t1), MB: Math.round(s.length / 10485.76) / 100 };
    }, bigFile);
    // guardar un mensaje nuevo en el chat grande (vaultAppendMessage: copia, busca el id, serializa TODO y lo escribe)
    const before = JSON.parse(nA.files.get(bigFile)).messages.length;
    res.chat_grande.guardar_mensaje = await A.page.evaluate(async (cid) => { const r = []; for (let i = 0; i < 5; i++) { const t = performance.now(); await window.vaultAppendMessage(cid, { msgId: 'nuevo_' + i + '_' + Date.now(), content: 'mensaje nuevo ' + i, senderNexoId: 'nxaaaa0001', _own: true, status: 'pending', timestamp: Date.now() }); r.push(Math.round(performance.now() - t)); await new Promise((x) => setTimeout(x, 120)); } return r; }, contacts[0].nexoId);
    await sleep(1500);
    const after = JSON.parse(nA.files.get(bigFile)).messages.length;
    res.chat_grande.mensajes_en_disco = { antes: before, despues_de_5_nuevos: after, perdidos: Math.max(0, before + 5 - after) };
    // enviar por la interfaz (pulsar → burbuja propia pintada), con el chat grande abierto
    res.chat_grande.enviar_burbuja_ms = await A.page.evaluate(async () => { const r = []; for (let k = 0; k < 3; k++) { const txt = 'prueba burbuja ' + k + ' ' + Date.now(); r.push(await new Promise((resolve) => { const t0 = performance.now(); const i = document.getElementById('message-input'); i.value = txt; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); const check = () => { const ok = Array.from(document.querySelectorAll('#messages-container .message.own .msg-content')).some((e) => e.textContent === txt); if (ok) requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))); else if (performance.now() - t0 > 8000) resolve(-1); else setTimeout(check, 5); }; check(); })); await new Promise((x) => setTimeout(x, 400)); } return r; });
    await closeChat(); await sleep(1500);
    res.chat_grande.reabrir_ms = await openChat(bigName); await sleep(800); await closeChat(); await sleep(800);
    // abrir varios chats llenos seguidos (en frío: leen su cola de 80 y pintan)
    if (K > 0) {
      const opens = [];
      for (let i = 1; i <= Math.min(ABRIR, K); i++) { opens.push(await openChat(contacts[i].name)); await sleep(300); await closeChat(); await sleep(300); }
      res.abrir_chats_llenos_ms = { n: opens.length, p50: opens.slice().sort((a, b) => a - b)[Math.floor(opens.length / 2)], max: Math.max(...opens) };
    }
  }
  // ---- todos los chats a tope: cargarlos enteros uno tras otro (como al reenviar pendientes o volver a la app) ----
  if (K > 0) {
    const stk = await phaseStart([A]); const h0 = await heap();
    const serie = [];
    const t0 = Date.now();
    for (let i = 1; i <= K && i < C; i += 10) {
      const ids = contacts.slice(i, Math.min(i + 10, K + 1)).map((c) => c.nexoId);
      await A.page.evaluate(async (ids) => { for (const id of ids) await window.vaultLoadMessages(id); }, ids);
      serie.push(Math.round((await cdpMetrics(A)).JSHeapUsedSize / 1048576));
    }
    const ms = Date.now() - t0;
    const phk = await phaseEnd([A], stk);
    res.todos_los_chats = { cargar_todos_s: Math.round(ms / 100) / 10, heap_antes_MB: h0, heap_cada_10_chats_MB: serie, heap_despues_gc_MB: await heap(), largas: phk.A.largas, largas_ms: phk.A.largas_ms, lag_max: phk.A.lag_max };
    // lo que hace la app al volver al primer plano (_flushAllPendingMessages: pendientes de TODOS los contactos a la vez)
    const io1 = Object.assign({}, io); let pk = 0;
    const stf = await phaseStart([A]);
    await A.page.evaluate(() => window.bleInterface._flushAllPendingMessages());
    for (let i = 0; i < 10; i++) { await sleep(500); pk = Math.max(pk, (await cdpMetrics(A)).JSHeapUsedSize); }
    const phf = await phaseEnd([A], stf);
    res.volver_a_la_app_flush = { lecturas: io.load - io1.load, MB_leidos: mb(io.loadBytes - io1.loadBytes), cpu_s: phf.A.cpu_s, largas: phf.A.largas, largas_ms: phf.A.largas_ms, lag_max: phf.A.lag_max, heap_pico_MB: Math.round(pk / 1048576) };
    // contactos «perdidos» (con chat, fuera de alcance: lo normal en un festival). Jump (relay._periodic, cada 30 s) pregunta
    // por los pendientes de cada perdido (_lostPeersWithPending → historial completo de cada uno)
    if (PERDIDOS > 0) {
      const lost = contacts.slice(1, 1 + Math.min(PERDIDOS, K)).map((c) => c.nexoId);
      const io2 = Object.assign({}, io);
      const stl = await phaseStart([A]);
      await A.page.evaluate((ids) => ids.forEach((nx) => window.bleInterface._markPeerLost(nx)), lost);
      await sleep(65000);
      const phl = await phaseEnd([A], stl);
      res.contactos_perdidos_65s = { perdidos: lost.length, lecturas: io.load - io2.load, MB_leidos: mb(io.loadBytes - io2.loadBytes), cpu_s: phl.A.cpu_s, cpu_pct: phl.A.cpu_pct, largas: phl.A.largas, largas_ms: phl.A.largas_ms, lag_max: phl.A.lag_max };
    }
  }
  res.heap_final_MB = await heap();
  res.lectura_mas_grande_MB = mb(io.maxLoad);
  res.errores_pagina = logs.filter((l) => /PAGEERROR|out of memory|Maximum call/i.test(l)).slice(0, 5);
  res.resultado = 'MEDIDO';
  console.log('CAPACIDAD ' + JSON.stringify(res));
  fs.writeFileSync(process.env.SIM_LOG || path.join(__dirname, 'last_logs_capacidad.txt'), logs.join('\n'));
  await ctx.close(); await browser.close();
  process.exit(0);
})().catch((e) => { console.log('CAPACIDAD ' + JSON.stringify({ prueba: 'capacidad', resultado: 'FALLO', error: String(e && e.message).substring(0, 300) })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_capacidad.txt'), logs.join('\n')); process.exit(1); });
