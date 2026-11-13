// Foto de perfil COPIADA (dueño 12-11: «hay otros contactos con mi misma foto de perfil»). El registro del Motorola mostró que se
// guardó en la galería la foto de perfil de un contacto (7 KB, desde el visor) y 9 s después se puso como propia en Perfil.
// A = el dueño (con foto P). B y C (contactos de A, con versión vieja: no comparan) ponen una COPIA re-comprimida de P (otros
// bytes, misma imagen). Se espera (3028):
//  1. A NO muestra la foto de B ni la de C (es la misma que la suya); tampoco tras reiniciar A, ni (3059) si al reiniciar no le
//     dio tiempo a calcular las huellas (se reintenta).
//  2. Si B cambia a una foto distinta, A sí la muestra.
//  3. Perfil no deja poner como propia la foto de un contacto (C, ya con la versión nueva, intenta otra copia de P: rechazada).
//  4. El visor de la foto de un contacto no tiene «Guardar en galería».
//  5. (3060) A cambia su foto: la copia de su foto ANTERIOR sigue escondida (también tras reiniciar) y el diagnóstico lo dice.
//  6. (3062, registro del Motorola 13-11: rechazó la foto del dueño a las 08:32:57, la app se reinició a las 08:33:10 al elegir
//     de la galería y a las 08:33:20 la ACEPTÓ; a las 08:33:31 la volvía a rechazar) Perfil justo al abrir la app, con las fotos
//     de los contactos aún cargándose: tiene que rechazar la copia igual (antes: no había con qué comparar y la aceptaba).
//  7. (3062) Un aviso de foto VIEJO que llega después de uno nuevo no gana: B pone una foto y la quita con A fuera de alcance;
//     al volver, el «quitada» (corto) adelanta a la foto (larga, en trozos) y la foto llegaba la última: A se quedaba con una
//     foto que B ya no tiene. Ahora cada aviso lleva cuándo se hizo y A se queda con el más reciente.
// El simulador no tiene canvas: la huella de la imagen la da window.NEXO_avatarPHash (las fotos de la prueba la llevan escrita).
// Uso: node avatardup.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = '0110'.repeat(16), X2 = '1110' + '0110'.repeat(14) + '0111', Q = '0011'.repeat(16);
const mk = (bits, rgb, salt) => 'data:image/jpeg;base64,' + Buffer.from('PH|' + bits + '|' + rgb.join(',') + '|' + salt + '|' + 'x'.repeat(7000)).toString('base64');
const R_BITS = '1001'.repeat(16), S_BITS = '1100'.repeat(16);
const P = mk(X, [120, 100, 90], 'a'), P_B = mk(X2, [122, 101, 88], 'b'), P_C = mk(X, [119, 99, 91], 'c'), P_D = mk(X2, [121, 100, 90], 'd'), Q_B = mk(Q, [40, 160, 200], 'q'), R_A = mk(R_BITS, [200, 60, 60], 'r'), R_E = mk(R_BITS, [202, 61, 58], 'e'), S_B = mk(S_BITS, [30, 200, 60], 's');
const phashOf = (url) => { const m = /^PH\|([01]{64})\|(\d+),(\d+),(\d+)\|/.exec(Buffer.from(String(url).split(',')[1] || '', 'base64').toString('latin1')); return m ? { b: m[1], c: [+m[2], +m[3], +m[4]] } : null; };
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const state = { A: { off: false, next: P }, B: { off: true, next: P_B }, C: { off: true, next: P_C, slowAv: 0 } };
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.NEXO_makeAvatar = () => state[name].next; win.NEXO_avatarPHash = (url) => (state[name].off ? null : phashOf(url));
      // 6: al abrir, las fotos de los contactos tardan en cargarse (en el teléfono: descifrar archivos con la app arrancando)
      const pl = win.Capacitor.Plugins.NexoBLE, lf = pl.loadFromFile;
      pl.loadFromFile = (o) => (state[name].slowAv && /^nexo_av_/.test(String(o && o.filename)) ? sleep(state[name].slowAv).then(() => lf.call(pl, o)) : lf.call(pl, o)); },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p, name) {
  let add = null; const t0 = Date.now();
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 600 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  const s = Math.round((Date.now() - t0) / 100) / 10;
  click(p.win, add); await sleep(2000);
  return add ? s : null;
}
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const rowPhoto = (p, name) => { const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); const av = row && row.querySelector('.ble-contact-avatar'); return !!(av && /url\(["']?data:image\/jpeg/.test(av.getAttribute('style') || '')); };
const rowStyle = (p, name) => { const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); const av = row && row.querySelector('.ble-contact-avatar'); return row ? ((av && av.getAttribute('style')) || '') : null; };
const NAMES = { P, P_B, P_C, P_D, Q_B, R_A, R_E, S_B };
const whose = (st) => { if (st === null) return 'sin fila'; for (const k of Object.keys(NAMES)) if (st.indexOf(NAMES[k]) >= 0) return k; return /data:image/.test(st) ? 'otra' : 'ninguna'; };
async function pickPhoto(p) {
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  click(p.win, p.win.document.getElementById('nexo-av-pick')); await sleep(200);
  const inp = Array.from(p.win.document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
  if (inp) { Object.defineProperty(inp, 'files', { configurable: true, value: [new p.win.File([Buffer.alloc(100)], 'yo.jpg', { type: 'image/jpeg' })] }); inp.dispatchEvent(new p.win.Event('change')); }
  await sleep(800);
  const c = p.win.document.getElementById('nexo-profile-close'); if (c) click(p.win, c);
  await sleep(200);
}
async function myProfilePhoto(p) {
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  const el = p.win.document.getElementById('nexo-profile-av'); const st = (el && el.getAttribute('style')) || '';
  const c = p.win.document.getElementById('nexo-profile-close'); if (c) click(p.win, c);
  await sleep(200);
  return whose(st);
}
const avFile = async (p, nx) => { try { const r0 = await p.win.Capacitor.Plugins.NexoBLE.loadFromFile({ filename: 'nexo_av_' + nx + '.json' }); if (!r0 || !r0.exists || !r0.content) return 'ninguna'; const o = JSON.parse(r0.content); return !o.img ? 'ninguna' : whose(o.img); } catch (e) { return 'error'; } };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  let [A, B, C] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC)]);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'avatardup', build: path.basename(buildDir) };
  await pickPhoto(A);
  A.win.bleInterface.togglePanel(); r.A_agrega_B_s = await addFound(A, 'B'); r.A_agrega_C_s = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000); await closeChat(A);
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(2000); await closeChat(A);
  r.B_ve_foto_de_A = await wait(() => whose(rowStyle(B, 'A')) === 'P', 60);
  r.C_ve_foto_de_A = await wait(() => whose(rowStyle(C, 'A')) === 'P', 60);
  // 1. B y C (versión vieja) ponen una copia de la foto de A
  await pickPhoto(B); await pickPhoto(C);
  r.B_puso_copia = await myProfilePhoto(B);
  r.A_recibe_B = await wait(async () => (await avFile(A, idB)) === 'P_B', 60);
  r.A_recibe_C = await wait(async () => (await avFile(A, idC)) === 'P_C', 60);
  await sleep(1500); A.win.bleInterface.renderContactsList(); await sleep(300);
  r.A_fila_B = whose(rowStyle(A, 'B'));
  r.A_fila_C = whose(rowStyle(A, 'C'));
  r.A_mi_perfil = await myProfilePhoto(A);
  // tras reiniciar A
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA);
  await sleep(2500); A.win.bleInterface.renderContactsList(); await sleep(300);
  r.A_fila_B_reinicio = whose(rowStyle(A, 'B'));
  r.A_fila_C_reinicio = whose(rowStyle(A, 'C'));
  r.A_mi_perfil_reinicio = await myProfilePhoto(A);
  // 1b. (3059, dueño 13-11: «¿por qué Roberto aparece con mi foto todavía?») A se reinicia y al abrir no le da tiempo a calcular
  //     las huellas (la suya y las de B y C; en el teléfono: 2 s con la app arrancando): antes las copias se veían hasta que alguien
  //     cambiara de foto; ahora se reintenta y se esconden solas (a los 4 s / 12 s)
  state.A.off = true;
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA);
  await sleep(2500); A.win.bleInterface.renderContactsList(); await sleep(300);
  r.A_huella_lenta_al_abrir = whose(rowStyle(A, 'B'));
  state.A.off = false;
  r.A_huella_lenta_ocultas = await wait(async () => { A.win.bleInterface.renderContactsList(); await sleep(100); return whose(rowStyle(A, 'B')) === 'ninguna' && whose(rowStyle(A, 'C')) === 'ninguna'; }, 30);
  // 2. B cambia a una foto distinta: A la muestra
  state.B.next = Q_B; await pickPhoto(B);
  r.A_ve_foto_nueva_B = await wait(() => whose(rowStyle(A, 'B')) === 'Q_B', 60);
  r.A_fila_C_sigue_oculta = whose(rowStyle(A, 'C'));
  // 3. C ya con la versión nueva: Perfil no deja poner otra copia de la foto de A
  state.C.off = false; state.C.next = P_D; await pickPhoto(C);
  r.C_mi_perfil_tras_rechazo = await myProfilePhoto(C);
  r.C_rechazo_log = logs.some((l) => /\[C\].*Foto de Perfil rechazada/.test(l));
  // 4. visor de la foto de un contacto sin «Guardar en galería»
  { const row = Array.from(B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === 'A');
    click(B.win, row && row.querySelector('.ble-contact-avatar')); await sleep(400);
    const ov = B.win.document.getElementById('fullscreen-media-overlay');
    r.visor_abre = !!ov; r.visor_sin_guardar = !!ov && !ov.querySelector('.fs-save-btn'); }
  // 5. (3060, dueño 13-11: ese día cambió su foto y Roberto seguía con la de antes) A cambia su foto por otra (R_A): la copia de C
  //    (de la foto ANTERIOR de A) sigue escondida («es una foto que tuviste tú»), también tras reiniciar; la nueva de B se sigue viendo
  state.A.next = R_A; await pickPhoto(A);
  r.A_mi_perfil_nuevo = await myProfilePhoto(A);
  await sleep(1500); A.win.bleInterface.renderContactsList(); await sleep(300);
  r.A_fila_C_tras_cambiar_mi_foto = whose(rowStyle(A, 'C'));
  r.A_fila_B_tras_cambiar_mi_foto = whose(rowStyle(A, 'B'));
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA);
  await sleep(2500); A.win.bleInterface.renderContactsList(); await sleep(300);
  r.A_fila_C_tras_cambiar_y_reiniciar = whose(rowStyle(A, 'C'));
  r.diag_foto_C = typeof A.win.NEXO_avatarDiag === 'function' ? A.win.NEXO_avatarDiag(idC) : null;
  // 6. C (versión nueva) ya tiene la foto actual de A (R_A); se reinicia y, nada más abrir, con las fotos de sus contactos aún
  //    cargándose (8 s), elige en Perfil una copia de R_A: rechazada
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  r.C_tiene_foto_nueva_de_A = await wait(async () => (await avFile(C, idA)) === 'R_A', 60);
  state.C.slowAv = 8000; state.C.next = R_E;
  C.win.close(); nC.destroyActivity(); await sleep(1500); nC.load(); C = await boot('C', nC);
  const nLog = logs.length;
  await pickPhoto(C);
  const after = () => logs.slice(nLog).filter((l) => /^\S+ \[C\]/.test(l));
  await wait(() => after().some((l) => /Foto de Perfil rechazada|Foto de perfil propia puesta ahora/.test(l)), 40);
  await sleep(500);
  state.C.slowAv = 0;
  r.C_perfil_al_abrir = await myProfilePhoto(C);
  r.C_rechazo_al_abrir_log = after().some((l) => /Foto de Perfil rechazada/.test(l)) && !after().some((l) => /Foto de perfil propia puesta ahora/.test(l));
  // 7. B pone otra foto (S_B) y la quita con A fuera de alcance; al volver, A no debe quedarse con S_B
  const idB2 = idB;
  radio.block(nA, nB); await sleep(1500);
  state.B.next = S_B; await pickPhoto(B); await sleep(1500);
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  click(B.win, B.win.document.getElementById('nexo-av-clear')); await sleep(300);
  { const c = B.win.document.getElementById('nexo-profile-close'); if (c) click(B.win, c); }
  r.B_sin_foto = (await myProfilePhoto(B)) === 'ninguna';
  await sleep(2000);
  radio.unblock(nA, nB);
  r.A_recibe_quitada = await wait(async () => { const f = await avFile(A, idB2); return f === 'ninguna'; }, 90);
  await sleep(25000); A.win.bleInterface.renderContactsList(); await sleep(300);
  r.A_fila_B_final = whose(rowStyle(A, 'B'));
  r.A_archivo_B_final = await avFile(A, idB2);
  r.avatar_logs = logs.filter((l) => /\[AVATAR\]/.test(l)).map((l) => l.substring(10)).slice(-24);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.B_ve_foto_de_A && r.C_ve_foto_de_A && r.B_puso_copia === 'P_B' && r.A_recibe_B && r.A_recibe_C && r.A_fila_B === 'ninguna' && r.A_fila_C === 'ninguna' && r.A_mi_perfil === 'P' &&
    r.A_fila_B_reinicio === 'ninguna' && r.A_fila_C_reinicio === 'ninguna' && r.A_mi_perfil_reinicio === 'P' && r.A_huella_lenta_ocultas && r.A_ve_foto_nueva_B && r.A_fila_C_sigue_oculta === 'ninguna' &&
    r.C_mi_perfil_tras_rechazo === 'P_C' && r.C_rechazo_log && r.visor_abre && r.visor_sin_guardar &&
    r.A_mi_perfil_nuevo === 'R_A' && r.A_fila_C_tras_cambiar_mi_foto === 'ninguna' && r.A_fila_B_tras_cambiar_mi_foto === 'Q_B' && r.A_fila_C_tras_cambiar_y_reiniciar === 'ninguna' &&
    /escondida/.test(r.diag_foto_C || '') && r.C_tiene_foto_nueva_de_A && r.C_perfil_al_abrir === 'P_C' && r.C_rechazo_al_abrir_log &&
    r.B_sin_foto && r.A_fila_B_final === 'ninguna' && r.A_archivo_B_final === 'ninguna' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AVATARDUP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_avatardup.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('AVATARDUP ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_avatardup.txt'), logs.join('\n')); process.exit(1); });
