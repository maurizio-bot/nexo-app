// 3175 (prueba de ciudad 17-11, semillas 1–3): una ACCIÓN que llega ANTES que su mensaje se perdía. La reacción de Fede llegó a
// Hugo 0,2 s antes que su texto largo (buzón de internet) y nunca se vio; el «eliminar para todos» de Dani llegó a los 589 s y la
// foto a los 762 s (custodia de un Jump): Gabi VEÍA y guardaba la foto que Dani había borrado (privacidad). Causa:
// chat_actions._applyChatAction buscaba el mensaje y, si aún no estaba, tiraba la acción (sin cola).
// A y B por Bluetooth. En B se RETIENE lo que manda A (ya descifrado) hasta que llegan sus acciones; luego se suelta:
//  P1  texto que A reacciona (❤️) y edita antes de que llegue: en B queda editado, con «editado» y con la reacción (chat abierto:
//      la burbuja también);
//  P2  texto y FOTO que A elimina para todos antes de que lleguen (chat de B cerrado): en B quedan «Se eliminó este mensaje», sin
//      el texto ni la foto en el disco (ni su archivo), sin «no leído» ni vista previa en la lista; al abrir el chat no se ven;
//  P3  lo mismo con B REINICIADO entre la acción y el mensaje (la lápida y la reacción se guardan en el disco);
//  P4  el orden normal sigue igual: un texto que llega y DESPUÉS se elimina queda en blanco.
// Uso: node acciontemprana.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifi: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const $ = (p, sel) => p.win.document.querySelector(sel);
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(600); }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
async function menuItem(p, sel) { for (let i = 0; i < 20; i++) { const b = $(p, '#nexo-msg-menu ' + sel); if (b) return b; await sleep(100); } return null; }
async function bubbleMenu(p, msgId) {
  const el = $(p, '.message[data-msg-id="' + msgId + '"]');
  if (!el) return false;
  (el.querySelector('.msg-content') || el).dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await sleep(300);
  return !!$(p, '#nexo-msg-menu');
}
async function react(p, msgId, emo) {
  if (!(await bubbleMenu(p, msgId))) return false;
  let b = null; for (let i = 0; i < 15 && !b; i++) { b = Array.from(p.win.document.querySelectorAll('#nexo-msg-menu .mm-react')).find((x) => x.textContent === emo); if (!b) await sleep(100); }
  click(p.win, b); await sleep(500); return !!b;
}
async function edit(p, msgId, text) {
  if (!(await bubbleMenu(p, msgId))) return false;
  const it = await menuItem(p, '.mm-edit'); if (!it) return false;
  click(p.win, it); await sleep(300);
  typeSend(p, text); await sleep(600); return true;
}
async function delAll(p, msgId) {
  if (!(await bubbleMenu(p, msgId))) return false;
  const it = await menuItem(p, '.mm-del-all'); if (!it) return false;
  click(p.win, it); await sleep(500); return true;
}
async function ownWith(p, cid, pred, ms) { let m = null; await waitFor(async () => !!(m = (await p.win.vaultLoadMessages(cid)).filter((x) => x._own && !x.hidden && pred(x)).pop()), ms || 8000); return m; }

// Retener en B lo que llega de A (ya descifrado): textos con una marca, y la siguiente foto
const hold = { tokens: new Set(), files: false, items: [] };
function installHold(P) {
  const bi = P.win.bleInterface;
  const hp = bi._handlePayload;
  bi._handlePayload = function (d) {
    try {
      const c = String((d && (d.content || d.data)) || '');
      for (const tk of hold.tokens) if (c.indexOf(tk) >= 0 && c.indexOf('nexo_act') < 0) { hold.items.push({ tk, kind: 'texto', d, orig: hp, bi }); logs.push(ts() + ' [B] PRUEBA retenido texto ' + tk); return; }
      const m = /act\\?":\\?"(react|edit|del)/.exec(c); if (m) logs.push(ts() + ' [B] PRUEBA acción ' + m[1] + ' llega');
    } catch (e) {}
    return hp.apply(this, arguments);
  };
  const ack = bi.ackSystem, dfc = ack._dispatchFileComplete;
  ack._dispatchFileComplete = function (fileId, data, meta, done, wasE2e) {
    if (wasE2e && hold.files) { hold.files = false; hold.items.push({ tk: 'FOTO', fileId, kind: 'foto', args: Array.from(arguments), orig: dfc, ack }); logs.push(ts() + ' [B] PRUEBA retenida foto ' + fileId); return; }
    return dfc.apply(this, arguments);
  };
}
function release(tk, intoBi) {
  hold.items.filter((x) => x.tk === tk).forEach((x) => {
    logs.push(ts() + ' [B] PRUEBA suelto ' + tk);
    if (x.kind === 'texto') (intoBi ? intoBi._handlePayload.bind(intoBi) : (d) => x.orig.call(x.bi, d))(x.d);
    else x.orig.apply(x.ack, x.args);
  });
  hold.items = hold.items.filter((x) => x.tk !== tk);
}
const held = (tk) => hold.items.some((x) => x.tk === tk);
const actsIn = (kind) => logs.filter((l) => l.indexOf('[B] PRUEBA acción ' + kind + ' llega') >= 0).length;

(async () => {
  const r = { prueba: 'acciontemprana', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const ok = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!ok) { console.log('ACCIONTEMPRANA ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChat(A, idB); typeSend(A, 'hola B'); await sleep(2500);
  r.B_tiene_a_A_s = await waitFor(() => (B.win.vaultLoadContacts() || []).some((c) => String(c.nexoId || '').toLowerCase() === idA), 20000);
  await sleep(3000); // kx con fx
  installHold(B);
  const bMsg = async (pred) => (await B.win.vaultLoadMessages(idA)).find(pred) || null;
  const bDisk = () => nB.files.get('nexo_vault_msgs_v2_' + idA + '.json') || '';

  // ---- P1: reacción y edición antes que el texto (chat de B abierto) ----
  await openChat(B, idA);
  hold.tokens.add('[R1]');
  typeSend(A, '[R1] texto que se va a editar');
  const r1 = await ownWith(A, idB, (m) => /\[R1\]/.test(String(m.content)));
  r.P1_retenido_s = await waitFor(() => held('[R1]'), 20000);
  const nr0 = actsIn('react'), ne0 = actsIn('edit');
  r.P1_A_reacciona = await react(A, r1 && r1.msgId, '❤️');
  r.P1_A_edita = await edit(A, r1 && r1.msgId, '[R1] texto ya editado');
  r.P1_acciones_llegan_s = await waitFor(() => actsIn('react') > nr0 && actsIn('edit') > ne0, 20000);
  await sleep(1500);
  release('[R1]');
  await sleep(3000);
  const m1 = await bMsg((m) => m.msgId === (r1 && r1.msgId));
  r.P1_B_texto = m1 ? String(m1.content).substring(0, 40) : null;
  r.P1_B_editado = !!(m1 && m1.edited && m1.content === '[R1] texto ya editado');
  r.P1_B_reaccion = m1 && m1.reactions ? m1.reactions[idA] || null : null;
  const el1 = r1 && $(B, '.message[data-msg-id="' + r1.msgId + '"]');
  r.P1_burbuja = !!(el1 && /ya editado/.test(el1.textContent) && el1.querySelector('.msg-edited') && /❤/.test((el1.querySelector('.msg-reactions') || {}).textContent || ''));
  await closeChat(B);

  // ---- P2: eliminar para todos un texto y una FOTO antes de que lleguen (chat de B cerrado) ----
  const unread = () => { try { const u = (B.win.bleInterface.unreadSummary() || []).find((x) => String(x.chatId).toLowerCase() === idA); return u ? u.count : 0; } catch (e) { return -1; } };
  const unread0 = unread(), notif0 = nB.notifLog.length;
  hold.tokens.add('[S2]');
  typeSend(A, '[S2] SECRETO-DOS no debe verse');
  const s2 = await ownWith(A, idB, (m) => /\[S2\]/.test(String(m.content)));
  r.P2_texto_retenido_s = await waitFor(() => held('[S2]'), 20000);
  const nd0 = actsIn('del');
  r.P2_A_elimina_texto = await delAll(A, s2 && s2.msgId);
  r.P2_eliminar_llega_s = await waitFor(() => actsIn('del') > nd0, 20000);
  const foto = Buffer.alloc(30000); for (let i = 0; i < foto.length; i++) foto[i] = (i * 13 + 7) & 255; Buffer.from('FOTOSECRETA').copy(foto, 0);
  const fotoB64 = foto.toString('base64');
  hold.files = true;
  A.win.NEXO_sendAttachment('image', fotoB64, { format: 'jpeg', width: 640, height: 480 });
  const p3 = await ownWith(A, idB, (m) => m.attachmentType === 'image');
  r.P2_foto_retenida_s = await waitFor(() => held('FOTO'), 40000);
  const nd1 = actsIn('del');
  r.P2_A_elimina_foto = await delAll(A, p3 && p3.msgId);
  r.P2_eliminar_foto_llega_s = await waitFor(() => actsIn('del') > nd1, 20000);
  await sleep(1500);
  release('[S2]'); release('FOTO');
  await sleep(3500);
  const m2 = await bMsg((m) => m.msgId === (s2 && s2.msgId));
  const m3 = await bMsg((m) => m.msgId === (p3 && p3.msgId));
  r.P2_B_texto = m2 ? (m2.deleted ? 'eliminado' : String(m2.content).substring(0, 30)) : 'no está';
  r.P2_B_foto = m3 ? (m3.deleted ? 'eliminada' : (m3.attachmentRef || m3.attachmentPayload ? 'se ve' : 'sin datos')) : 'no está';
  r.P2_disco_sin_secreto = bDisk().indexOf('SECRETO-DOS') < 0;
  r.P2_archivo_foto = p3 ? Array.from(nB.files.keys()).filter((k) => k.indexOf(p3.msgId) >= 0) : null;
  r.P2_no_leidos_nuevos = unread() - unread0;
  r.P2_avisos_nuevos = nB.notifLog.slice(notif0).filter((n) => n.msgId === (s2 && s2.msgId) || n.msgId === (p3 && p3.msgId)).length;
  const cA = (B.win.vaultLoadContacts() || []).find((c) => String(c.nexoId || '').toLowerCase() === idA) || {};
  r.P2_vista_previa = String(cA.lastMessage || '').substring(0, 40);
  await openChat(B, idA); await sleep(800);
  const shownB = Array.from(B.win.document.querySelectorAll('#messages-container .message')).map((x) => x.textContent).join(' | ');
  r.P2_chat_muestra_secreto = /SECRETO-DOS/.test(shownB);
  r.P2_chat_muestra_foto = !!(p3 && $(B, '.message[data-msg-id="' + p3.msgId + '"] img'));
  r.P2_chat_eliminados = Array.from(B.win.document.querySelectorAll('#messages-container .message .msg-deleted')).length;
  await closeChat(B);

  // ---- P3: B se reinicia entre la acción y el mensaje ----
  hold.tokens.add('[T4]'); hold.tokens.add('[T5]');
  typeSend(A, '[T4] SECRETO-CUATRO tras reiniciar');
  const t4 = await ownWith(A, idB, (m) => /\[T4\]/.test(String(m.content)));
  typeSend(A, '[T5] reacción que espera al reinicio');
  const t5 = await ownWith(A, idB, (m) => /\[T5\]/.test(String(m.content)));
  r.P3_retenidos_s = await waitFor(() => held('[T4]') && held('[T5]'), 20000);
  const nd2 = actsIn('del'), nr2 = actsIn('react');
  r.P3_A_elimina = await delAll(A, t4 && t4.msgId);
  r.P3_A_reacciona = await react(A, t5 && t5.msgId, '😂');
  r.P3_acciones_llegan_s = await waitFor(() => actsIn('del') > nd2 && actsIn('react') > nr2, 20000);
  await sleep(2000);
  B.win.close(); nB.destroyActivity(); await sleep(1500); nB.load(); B = await boot('B', nB);
  release('[T4]', B.win.bleInterface); release('[T5]', B.win.bleInterface);
  await sleep(3500);
  const m4 = await bMsg((m) => m.msgId === (t4 && t4.msgId));
  const m5 = await bMsg((m) => m.msgId === (t5 && t5.msgId));
  r.P3_B_texto = m4 ? (m4.deleted ? 'eliminado' : String(m4.content).substring(0, 30)) : 'no está';
  r.P3_disco_sin_secreto = bDisk().indexOf('SECRETO-CUATRO') < 0;
  r.P3_B_reaccion = m5 && m5.reactions ? m5.reactions[idA] || null : null;

  // ---- P4: orden normal (llega y después se elimina) ----
  typeSend(A, '[N6] SECRETO-SEIS orden normal');
  const n6 = await ownWith(A, idB, (m) => /\[N6\]/.test(String(m.content)));
  r.P4_llega_s = await waitFor(async () => !!(await bMsg((m) => m.msgId === (n6 && n6.msgId))), 20000);
  r.P4_A_elimina = await delAll(A, n6 && n6.msgId);
  r.P4_B_eliminado_s = await waitFor(async () => { const m = await bMsg((x) => x.msgId === (n6 && n6.msgId)); return !!(m && m.deleted && !m.content); }, 20000);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok2 = r.P1_retenido_s !== null && r.P1_acciones_llegan_s !== null && r.P1_B_editado && r.P1_B_reaccion === '❤️' && r.P1_burbuja &&
    r.P2_texto_retenido_s !== null && r.P2_foto_retenida_s !== null && r.P2_eliminar_llega_s !== null && r.P2_eliminar_foto_llega_s !== null &&
    r.P2_B_texto === 'eliminado' && r.P2_B_foto === 'eliminada' && r.P2_disco_sin_secreto && r.P2_archivo_foto && r.P2_archivo_foto.length === 0 &&
    r.P2_no_leidos_nuevos === 0 && r.P2_avisos_nuevos === 0 && !/SECRETO|Foto/.test(r.P2_vista_previa) && !r.P2_chat_muestra_secreto && !r.P2_chat_muestra_foto && r.P2_chat_eliminados >= 2 &&
    r.P3_retenidos_s !== null && r.P3_acciones_llegan_s !== null && r.P3_B_texto === 'eliminado' && r.P3_disco_sin_secreto && r.P3_B_reaccion === '😂' &&
    r.P4_llega_s !== null && r.P4_B_eliminado_s !== null && !r.errores.length;
  r.resultado = ok2 ? 'OK' : 'FALLO';
  console.log('ACCIONTEMPRANA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_acciontemprana.txt'), logs.join('\n'));
  process.exit(ok2 ? 0 : 1);
})().catch((e) => { console.log('ACCIONTEMPRANA ' + JSON.stringify({ prueba: 'acciontemprana', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_acciontemprana.txt'), logs.join('\n')); process.exit(1); });
