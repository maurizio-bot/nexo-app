// Chat tipo WhatsApp: A con B y C. Menú al mantener pulsado (clic derecho en jsdom), responder (menú y
// deslizando), reenviar texto y archivo a otro chat, copiar, eliminar para mí y para todos, y que una acción
// falsa (B intenta borrar un mensaje de A) no haga nada. Nada de JSON a la vista ni en la lista de chats.
// Uso: node chatactions.js <dir_build> [--io-delay=25]
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
      win.HTMLElement.prototype.scrollTo = function () {}; Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { win.__copied = t; } } }); 
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
  const names = ['A', 'B', 'C'];
  const nat = {}, P = {};
  names.forEach((n, i) => { nat[n] = new NativePhone(n, n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':0' + (i + 1), opts); radio.add(nat[n]); nat[n].load(); });
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  for (const x of ['B', 'C']) {
    const other = x === 'B' ? 'C' : 'B';
    radio.block(nat.A, nat[other]);
    P.A.win.bleInterface.togglePanel(); const ok = await addFound(P.A, x); P.A.win.bleInterface.togglePanel();
    await sleep(800);
    await openChatWith(P.A, x); await sendText(P.A, 'hola ' + x); await sleep(2500); await closeChat(P.A);
    radio.unblock(nat.A, nat[other]);
    if (!ok) { console.log('CHATACT ' + JSON.stringify({ error: 'no empareja A' + x })); process.exit(0); }
  }
  await sleep(3000); // kx con fx:1 (entienden respuestas y acciones)
  const A = P.A, B = P.B, C = P.C;
  const bubbles = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.progress-placeholder)'));
  const bubbleWith = (p, t) => bubbles(p).find((m) => m.textContent.indexOf(t) >= 0);
  const ctx = (p, el) => el && el.dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const menuItem = async (p, cls) => { for (let i = 0; i < 20; i++) { const b = p.win.document.querySelector('#nexo-msg-menu .' + cls); if (b) return b; await sleep(100); } return null; };
  const shown = (p) => bubbles(p).map((m) => (m.querySelector('.msg-content') || {}).textContent || '');

  await openChatWith(B, 'A'); await sendText(B, 'pregunta de B'); await sleep(2500);
  await openChatWith(A, 'B'); await sleep(800);
  // 1) Responder desde el menú
  ctx(A, bubbleWith(A, 'pregunta de B'));
  const mr = await menuItem(A, 'mm-reply');
  r.menu_opciones = Array.from(A.win.document.querySelectorAll('#nexo-msg-menu .mm-item')).map((b) => b.className.replace('mm-item ', ''));
  click(A.win, mr); await sleep(300);
  r.barra_respuesta = ((A.win.document.getElementById('reply-bar') || {}).textContent || '').substring(0, 60);
  await sendText(A, 'esta es mi respuesta'); await sleep(3000);
  const qB = bubbleWith(B, 'esta es mi respuesta');
  r.B_ve_cita = !!(qB && qB.querySelector('.msg-quote') && qB.querySelector('.msg-quote').textContent.indexOf('pregunta de B') >= 0);
  r.B_cita_de = qB && qB.querySelector('.msg-quote') ? qB.querySelector('.msg-quote div').textContent : null;
  r.A_ve_cita = !!(bubbleWith(A, 'esta es mi respuesta') || {}).querySelector && !!bubbleWith(A, 'esta es mi respuesta').querySelector('.msg-quote');
  r.barra_desaparece = !A.win.document.getElementById('reply-bar');
  // 2) Responder deslizando la burbuja a la derecha
  const sw = bubbleWith(A, 'pregunta de B');
  const pe = (type, x) => sw.dispatchEvent(new A.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: 300 }));
  pe('pointerdown', 100); pe('pointermove', 150); pe('pointermove', 190); pe('pointerup', 190); await sleep(400);
  r.deslizar_responde = !!A.win.document.getElementById('reply-bar');
  click(A.win, A.win.document.querySelector('#reply-bar .reply-cancel')); await sleep(200);
  // 2b) Responder deslizando a la IZQUIERDA (ronda 2783, lo que pidió el dueño; antes solo a la derecha)
  const swl = bubbleWith(A, 'pregunta de B');
  const pel = (type, x) => swl.dispatchEvent(new A.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: 300 }));
  pel('pointerdown', 200); pel('pointermove', 150); pel('pointermove', 110); pel('pointerup', 110); await sleep(400);
  r.deslizar_izq_responde = !!A.win.document.getElementById('reply-bar');
  click(A.win, A.win.document.querySelector('#reply-bar .reply-cancel')); await sleep(200);
  // 2c) F (informe del dueño 28-10): al deslizar la burbuja aparece una flecha ↩ (realimentación); al soltar se quita.
  const swf = bubbleWith(A, 'pregunta de B');
  const pef = (type, x) => swf.dispatchEvent(new A.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: 300 }));
  pef('pointerdown', 100); pef('pointermove', 140); pef('pointermove', 185);
  r.desliz_muestra_flecha = !!A.win.document.getElementById('nexo-reply-hint');
  pef('pointerup', 185); await sleep(60);
  r.desliz_quita_flecha = !A.win.document.getElementById('nexo-reply-hint');
  const rbc = A.win.document.querySelector('#reply-bar .reply-cancel'); if (rbc) click(A.win, rbc); await sleep(200);
  // 2d) E (informe del dueño 28-10): responder a una UBICACIÓN muestra «Ubicación», no el código crudo. _msgSummary
  //     maneja el adjunto codificado DENTRO de content (forma b) y como campo suelto (forma a).
  const ms = A.win.__nexoMsgSummary;
  r.resumen_ubic_contenido = ms ? ms({ content: '{"type":"attachment","attachmentType":"location","payload":"{\\"lat\\":19.4,\\"lng\\":-99.1}"}' }).s : null;
  r.resumen_ubic_campo = ms ? ms({ attachmentType: 'location', content: '' }).s : null;
  r.resumen_texto = ms ? ms({ content: 'hola mundo' }).s : null;
  // 2e) F (informe del dueño 29-10): responder a un ARCHIVO muestra su NOMBRE (no «Archivo») y NUNCA el código crudo,
  //     ya venga como campo (attachmentMeta.name), codificado en content, o como descriptor de protocolo suelto.
  r.resumen_archivo_nombre = ms ? ms({ attachmentType: 'file', attachmentMeta: { name: 'informe.pdf' } }).s : null;         // «📎 informe.pdf»
  r.resumen_archivo_contenido = ms ? ms({ content: '{"type":"attachment","attachmentType":"file","payload":"AAA","meta":{"name":"foto.jpg"}}' }).s : null;
  r.resumen_archivo_descriptor = ms ? ms({ content: '{"v":1,"t":"f","m":"x","fn":"video.mp4","n":4}' }).s : null;          // «📎 video.mp4»
  r.resumen_sin_codigo = ms ? (ms({ content: '{"v":1,"t":"f","m":"x","n":4}' }).s.indexOf('{') === -1) : null;             // nunca JSON crudo
  // 2f) Transporte del chat como SÍMBOLO (pedido del dueño 29-10): icono SVG en vez de la palabra; el tooltip la conserva.
  const vs = A.win.__nexoViaSubtitle;
  r.subt_wifi_icono = vs ? (vs('wifi', 0).html.indexOf('<svg') > -1 && vs('wifi', 0).text.indexOf('Wi-Fi') > -1) : null;
  r.subt_internet_icono = vs ? (vs('internet', 0).html.indexOf('<svg') > -1 && vs('internet', 0).text.indexOf('Internet') > -1) : null;
  r.subt_bluetooth_icono = vs ? (vs('bluetooth', 0).html.indexOf('<svg') > -1 && vs('bluetooth', 0).text.indexOf('Bluetooth') > -1) : null;
  r.subt_solo_icono = vs ? (vs('wifi', 0).html.replace(/<[^>]*>/g, '').indexOf('Wi-Fi') === -1) : null;                     // la palabra no se ve (solo icono)
  r.subt_senal_debil = vs ? (vs('bluetooth', 23).html.indexOf('⚠') > -1) : null;
  r.nombre_es_textarea = A.win.document.getElementById('chat-contact-name') ? (A.win.document.getElementById('chat-contact-name').tagName === 'TEXTAREA') : null;
  // 2g) Emoji grande sin burbuja (pedido del dueño 29-10): un mensaje de 1–3 emojis sueltos se marca «jumbo»; con texto o
  //     con 4+ emojis, no. Se prueba la detección pura (window.__nexoEmojiOnly).
  const eo = A.win.__nexoEmojiOnly;
  r.emoji_1 = eo ? eo('😀') : null;             // 1
  r.emoji_2 = eo ? eo('😀😁') : null;           // 2
  r.emoji_piel = eo ? eo('👍🏽') : null;         // 1 (tono de piel)
  r.emoji_bandera = eo ? eo('🇲🇽') : null;       // 1 (bandera)
  r.emoji_muchos = eo ? eo('😀😁😂😃') : null;   // 0 (más de 3)
  r.emoji_texto = eo ? eo('hola') : null;       // 0
  r.emoji_mixto = eo ? eo('😀 hola') : null;    // 0 (emoji + texto)
  // 3) Copiar
  ctx(A, bubbleWith(A, 'pregunta de B')); click(A.win, await menuItem(A, 'mm-copy')); await sleep(300);
  r.copiar_aviso = ((A.win.document.getElementById('perm-error-toast') || {}).textContent || '');
  r.copiado = A.win.__copied || null;
  // 4) Reenviar texto y un archivo a C
  ctx(A, bubbleWith(A, 'pregunta de B')); click(A.win, await menuItem(A, 'mm-forward')); await sleep(300);
  const rowC = Array.from(A.win.document.querySelectorAll('#nexo-forward-sheet .fw-row')).find((x) => x.textContent === 'C');
  if (rowC) { const cb = rowC.querySelector('input'); cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); }
  click(A.win, A.win.document.querySelector('#nexo-forward-sheet .fw-send'));
  const file = Buffer.alloc(20000); for (let i = 0; i < file.length; i++) file[i] = (i * 7 + 3) & 255;
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(A.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new A.win.File([file], 'doc.bin', { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new A.win.Event('change'));
  await waitFor(async () => (await B.win.vaultLoadMessages(id('A'))).some((m) => m.attachmentType), 60000);
  await sleep(1500);
  const fileBubble = bubbles(A).filter((m) => m.querySelector('.msg-content') && /doc\.bin/.test(m.textContent)).pop();
  ctx(A, fileBubble); click(A.win, await menuItem(A, 'mm-forward')); await sleep(300);
  const rowC2 = Array.from(A.win.document.querySelectorAll('#nexo-forward-sheet .fw-row')).find((x) => x.textContent === 'C');
  if (rowC2) { const cb = rowC2.querySelector('input'); cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); }
  click(A.win, A.win.document.querySelector('#nexo-forward-sheet .fw-send'));
  const cHas = async (f) => (await C.win.vaultLoadMessages(id('A'))).some(f);
  r.C_recibe_texto_reenviado_s = await waitFor(() => cHas((m) => /pregunta de B/.test(String(m.content)) && /"fw":1/.test(String(m.content))), 60000);
  r.C_recibe_archivo_identico_s = await waitFor(() => cHas((m) => m.attachmentType === 'file' && ((m.attachmentPayload === file.toString('base64')) || (m.attachmentRef && nat.C.files.get(m.attachmentRef) === file.toString('base64')))), 90000);
  r.A_chat_B_sin_burbujas_de_C = !bubbles(A).some((m) => /↪ Reenviado/.test(m.textContent));
  await openChatWith(C, 'A'); await sleep(1000);
  r.C_ve_reenviado = !!bubbleWith(C, '↪ Reenviado');
  await closeChat(C);
  // 4b) Editar un mensaje propio (ronda 2782)
  await sendText(A, 'texto con herror'); await waitFor(async () => (await B.win.vaultLoadMessages(id('A'))).some((m) => m.content === 'texto con herror'), 30000);
  ctx(A, bubbleWith(A, 'texto con herror')); click(A.win, await menuItem(A, 'mm-edit')); await sleep(300);
  r.barra_editar = !!A.win.document.getElementById('edit-bar');
  const einp = A.win.document.getElementById('message-input');
  r.caja_tiene_el_texto = einp.value === 'texto con herror';
  einp.value = 'texto corregido'; einp.dispatchEvent(new A.win.Event('input', { bubbles: true }));
  click(A.win, A.win.document.getElementById('send-btn')); await sleep(500);
  r.barra_editar_desaparece = !A.win.document.getElementById('edit-bar');
  const edA = bubbleWith(A, 'texto corregido');
  r.A_ve_editado = !!(edA && edA.querySelector('.msg-edited')) && !bubbleWith(A, 'texto con herror');
  r.B_recibe_edicion_s = await waitFor(async () => { const vb = await B.win.vaultLoadMessages(id('A')); return vb.some((m) => m.content === 'texto corregido' && m.edited) && !vb.some((m) => m.content === 'texto con herror'); }, 30000);
  const edB = bubbleWith(B, 'texto corregido');
  r.B_ve_editado = !!(edB && edB.querySelector('.msg-edited'));
  // 4c) Reaccionar (ronda 2783): doble toque en una burbuja = ❤️; el otro lo ve. Menú "Reaccionar" para elegir otro.
  const rbt = bubbleWith(A, 'pregunta de B');
  const tap2 = (x, y) => { rbt.dispatchEvent(new A.win.MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y })); rbt.dispatchEvent(new A.win.MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y })); };
  tap2(120, 300); await sleep(60); tap2(120, 300); await sleep(700);
  const rbA = bubbleWith(A, 'pregunta de B');
  r.doble_toque_reacciona = !!(rbA && rbA.querySelector('.msg-reactions') && /❤/.test(rbA.querySelector('.msg-reactions').textContent));
  r.B_recibe_reaccion_s = await waitFor(async () => { const vb = await B.win.vaultLoadMessages(id('A')); return vb.some((m) => m.reactions && m.reactions[id('A')]); }, 30000);
  ctx(A, bubbleWith(A, 'pregunta de B'));
  const laugh = await (async () => { for (let i = 0; i < 20; i++) { const l = Array.from(A.win.document.querySelectorAll('#nexo-msg-menu .mm-react')).find((b) => b.textContent === '😂'); if (l) return l; await sleep(100); } return null; })();
  r.menu_tiene_reacciones = A.win.document.querySelectorAll('#nexo-msg-menu .mm-react').length;
  click(A.win, laugh); await sleep(700);
  const rbA2 = bubbleWith(A, 'pregunta de B');
  r.menu_reacciona = !!(rbA2 && /😂/.test(((rbA2.querySelector('.msg-reactions') || {}).textContent) || ''));
  // 5) Eliminar para mí
  ctx(A, bubbleWith(A, 'hola B')); click(A.win, await menuItem(A, 'mm-del-me')); await sleep(800);
  r.eliminar_para_mi = !bubbleWith(A, 'hola B') && !(await A.win.vaultLoadMessages(id('B'))).some((m) => m.content === 'hola B') && (await B.win.vaultLoadMessages(id('A'))).some((m) => m.content === 'hola B');
  // 6) Eliminar para todos
  await sendText(A, 'SECRETO-borrame'); await waitFor(async () => (await B.win.vaultLoadMessages(id('A'))).some((m) => m.content === 'SECRETO-borrame'), 30000);
  ctx(A, bubbleWith(A, 'SECRETO-borrame')); click(A.win, await menuItem(A, 'mm-del-all'));
  r.B_ve_eliminado_s = await waitFor(() => !!bubbleWith(B, 'Se eliminó este mensaje') && !bubbleWith(B, 'SECRETO-borrame'), 30000);
  r.A_ve_eliminaste = !!bubbleWith(A, 'Eliminaste este mensaje');
  r.B_vault_sin_contenido = !(await B.win.vaultLoadMessages(id('A'))).some((m) => /SECRETO-borrame/.test(String(m.content)));
  // 7) Acción falsa: B intenta borrar para todos un mensaje de A
  const target = (await B.win.vaultLoadMessages(id('A'))).find((m) => /esta es mi respuesta/.test(String(m.content)));
  const aMsgId = target && (target.msgId || target.messageId);
  B.win.bleInterface.sendChatMessage(id('A'), JSON.stringify({ type: 'nexo_act', act: 'del', id: aMsgId }), 'fake_' + Date.now());
  await sleep(4000);
  r.accion_falsa_ignorada = !!bubbleWith(A, 'esta es mi respuesta') && !(await A.win.vaultLoadMessages(id('B'))).find((m) => (m.msgId || m.messageId) === aMsgId).deleted;
  // Nada de JSON a la vista ni en la lista de chats
  r.json_visible = shown(A).concat(shown(B)).filter((t) => /"type":"nexo_/.test(t)).length;
  // 4d) Deslizar el chat hacia ABAJO = cerrarlo (ronda 2783). En jsdom mc.scrollTop es 0, así que el gesto cuenta.
  const mcA = A.win.document.getElementById('messages-container');
  const teA = (type, y) => { const ev = new A.win.Event(type, { bubbles: true, cancelable: true }); ev.touches = [{ clientX: 60, clientY: y }]; mcA.dispatchEvent(ev); };
  r.chat_abierto = A.win.document.body.classList.contains('chat-view-active');
  teA('touchstart', 80); teA('touchmove', 200); teA('touchmove', 340); teA('touchend', 340); await sleep(900);
  r.deslizar_abajo_cierra = r.chat_abierto && !A.win.document.body.classList.contains('chat-view-active');
  // 4e) Zoom de la foto en el visor: pellizco (dos dedos) para acercar/alejar y doble toque para alternar (ronda 2783)
  if (typeof A.win.__nexoOpenMedia === 'function') {
    A.win.__nexoOpenMedia('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'image');
    await sleep(150);
    const vimg = A.win.document.querySelector('#fullscreen-media-overlay img');
    const tev = (type, pts) => { const ev = new A.win.Event(type, { bubbles: true, cancelable: true }); ev.touches = pts.map((p) => ({ clientX: p[0], clientY: p[1] })); vimg.dispatchEvent(ev); };
    tev('touchstart', [[120, 300], [180, 300]]); tev('touchmove', [[40, 300], [340, 300]]); tev('touchend', []);  // abrir los dedos: acercar
    r.foto_pellizco_zoom = /scale\((?:[2-9]|1\.[3-9])/.test(vimg.style.transform || '');
    tev('touchstart', [[100, 300], [200, 300]]); tev('touchmove', [[145, 300], [155, 300]]); tev('touchend', []);  // juntar los dedos: alejar
    r.foto_pellizco_aleja = (vimg.style.transform || '').indexOf('scale(1)') >= 0;
    const dtap = () => { tev('touchstart', [[120, 300]]); tev('touchend', []); };
    dtap(); await sleep(60); dtap(); await sleep(120);
    r.foto_doble_toque_amplia = /scale\(2\.5\)/.test(vimg.style.transform || '');
    const ov = A.win.document.getElementById('fullscreen-media-overlay'); if (ov) ov.remove();
  }
  await closeChat(A); await closeChat(B); await sleep(500);
  r.lista_A = Array.from(A.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((x) => x.textContent.substring(0, 50));
  r.lista_B = Array.from(B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((x) => x.textContent.substring(0, 50));
  // Reabrir el chat: lo eliminado sigue eliminado y la cita se ve
  await openChatWith(B, 'A'); await sleep(1500);
  r.reabrir_B_cita = !!(bubbleWith(B, 'esta es mi respuesta') || { querySelector: () => null }).querySelector('.msg-quote');
  r.reabrir_B_eliminado = !!bubbleWith(B, 'Se eliminó este mensaje');
  // Ronda 2758: A (quien borró) reabre el chat: su acción oculta no aparece como texto
  await closeChat(B); await openChatWith(A, 'B'); await sleep(1500);
  r.reabrir_A_json_visible = shown(A).filter((t) => /"type":"nexo_/.test(t)).length;
  r.errores = logs.filter((l) => / error: /.test(l)).slice(0, 4);
  console.log('CHATACT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_chatactions.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_chatactions.txt'), logs.join('\n')); process.exit(1); });
