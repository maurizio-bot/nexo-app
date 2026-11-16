// 3160 (dueño 16-11: «cuando subo varias fotos, tienen el puntito para palomear varias, quiero que apliques ese concepto en la
// esquina puesta con el "ojo", o sea que al mandar varias también puedes elegir cuáles de una sola vista»).
// A elige en la galería 3 fotos y 1 vídeo (f1, f2, clip, f3). Antes de mandar debe salir la revisión (#nexo-gallery-review) con 4
// miniaturas (URL de objeto) y 4 ojos (3163: el vídeo también, además de su indicador); A enciende el ojo de la 2.ª foto → «Enviar (4)» → salen
// las 4 en el orden elegido, de a una: f2 con «ver una vez», f1 y f3 normales, y así le llegan a B; las URL se liberan al cerrar.
// Además: UNA sola foto → también revisión; la ✕ «Cancelar» y el atrás de Android (__nexoHandleBack) cierran sin mandar nada; solo
// un vídeo → 3163: también revisión (con su ojo; sin tocarlo sale normal); en un GRUPO (A+B) el «una vez» viaja en el sobre del grupo (meta.once) y B lo ve
// como «Toca para ver · una vez», así que ahí también hay ojo.
// Antes (≤ 3159): al volver del selector se mandaba todo enseguida, sin revisión y sin forma de marcar «ver una vez».
// jsdom no decodifica imágenes (ni load ni error) ni tiene URL.createObjectURL: el compresor recibe un «error» y manda la foto
// tal cual (su camino de siempre cuando no puede comprimir), y las URL de objeto se simulan (y se cuentan las liberadas).
// Uso: node galeriaunavez.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const urls = { made: [], revoked: new Set() };
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      let n = 0;
      win.URL.createObjectURL = () => { const u = 'blob:sim/' + name + (++n); urls.made.push(u); return u; };
      win.URL.revokeObjectURL = (u) => { urls.revoked.add(u); };
      // El compresor (new Image + lienzo) no puede decodificar en jsdom: «error» → manda la foto tal cual
      const RealImage = win.Image;
      win.Image = function () {
        const im = new RealImage();
        Object.defineProperty(im, 'src', { configurable: true, get() { return this.getAttribute('src') || ''; }, set(v) { this.setAttribute('src', v); setTimeout(() => { if (typeof this.onerror === 'function') this.onerror(new win.Event('error')); }, 5); } });
        return im;
      };
      win.NEXO_makeVideoPreview = () => { const b = new win.Blob([new Uint8Array(6 * 1024).fill(7)], { type: 'video/webm' }); b.thumb = 'T'.repeat(2000); return Promise.resolve(b); };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, urls };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return !!(await fn()); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
// Elegir en la galería (el selector del sistema se simula: se le ponen los archivos al <input> y se dispara change)
async function pick(p, files) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="gallery"]')); await sleep(400);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: files.map((f) => new p.win.File([f.bytes], f.name, { type: f.type })) });
  fin.dispatchEvent(new p.win.Event('change'));
  await sleep(300);
}
const photo = (name, fill) => ({ name, type: 'image/jpeg', bytes: Buffer.alloc(2400, fill) });
const video = (name) => ({ name, type: 'video/mp4', bytes: Buffer.alloc(10 * 1024, 3) });
const review = (p) => p.win.document.getElementById('nexo-gallery-review');
const own = async (p, chat) => (await p.win.vaultLoadMessages(chat)).filter((m) => m._own && m.attachmentType);
const desc = (m) => (m.attachmentType === 'video' ? 'video' : (m.attachmentMeta && m.attachmentMeta.name) || '?') + (m.attachmentMeta && m.attachmentMeta.once ? '*' : '');

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };
  const finish = (ok) => {
    r.resultado = ok ? 'OK' : 'FALLO';
    console.log('GALERIAUNAVEZ ' + JSON.stringify(r));
    fs.writeFileSync(path.join(__dirname, 'last_logs_galeriaunavez.txt'), logs.join('\n'));
    process.exit(ok ? 0 : 1);
  };

  // Emparejar por Bluetooth y abrir el chat
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { r.error = 'no empareja'; finish(false); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  await openChat(A);

  // 1) 3 fotos + 1 vídeo → revisión con 4 miniaturas y 3 ojos, sin mandar nada todavía
  await pick(A, [photo('f1.jpg', 1), photo('f2.jpg', 2), video('clip.mp4'), photo('f3.jpg', 4)]);
  r.revision_aparece = await waitFor(() => !!review(A), 2000);
  if (!r.revision_aparece) {
    await sleep(2500);
    r.mandado_sin_revision = (await own(A, idB)).map(desc);
    r.error = 'no hay revisión: la galería manda todo al volver del selector, sin poder marcar «ver una vez»';
    finish(false);
  }
  const ov = review(A);
  const cells = Array.from(ov.querySelectorAll('.nx-grev-item'));
  r.miniaturas = cells.length;
  r.miniaturas_url = cells.every((c) => /^blob:/.test((c.querySelector('img,video') || {}).src || ''));
  r.tipos = cells.map((c) => (c.querySelector('video') ? 'video' : c.querySelector('img') ? 'foto' : '?'));
  r.ojos = ov.querySelectorAll('.nx-grev-eye').length;
  r.video_con_ojo_e_indicador = !!cells[2].querySelector('.nx-grev-eye') && !!cells[2].querySelector('.nx-grev-vid');   // 3163
  r.ojos_en_las_fotos = [0, 1, 3].every((i) => !!cells[i].querySelector('.nx-grev-eye'));
  r.nada_antes_de_enviar = (await own(A, idB)).length === 0;
  const sendBtn = ov.querySelector('#nexo-grev-send');
  r.boton = sendBtn && sendBtn.textContent;
  // Encender el ojo de la 2.ª; el de la 3.ª se enciende y se vuelve a apagar (el toque alterna)
  click(A.win, cells[1].querySelector('.nx-grev-eye'));
  click(A.win, cells[3].querySelector('.nx-grev-eye')); click(A.win, cells[3].querySelector('.nx-grev-eye'));
  r.ojo_2_encendido = cells[1].querySelector('.nx-grev-eye').classList.contains('active') && cells[1].querySelector('.nx-grev-eye').getAttribute('aria-pressed') === 'true';
  r.ojo_3_apagado = !cells[3].querySelector('.nx-grev-eye').classList.contains('active') && !cells[0].querySelector('.nx-grev-eye').classList.contains('active');
  const shown1 = cells.map((c) => (c.querySelector('img,video') || {}).src.replace(/#.*$/, ''));
  click(A.win, sendBtn);
  await sleep(200);
  r.revision_cerrada = !review(A);
  r.urls_liberadas = shown1.every((u) => A.urls.revoked.has(u));
  await waitFor(async () => (await own(A, idB)).length >= 4, 15000);
  r.enviado = (await own(A, idB)).map(desc);
  r.orden_y_marcas_ok = JSON.stringify(r.enviado) === JSON.stringify(['f1.jpg', 'f2.jpg*', 'video', 'f3.jpg']);
  // Lo que le llega a B: f2 «ver una vez», f1 y f3 normales
  const recvPhotos = async () => (await B.win.vaultLoadMessages(idA)).filter((m) => !m._own && m.attachmentType === 'image');
  await waitFor(async () => (await recvPhotos()).length >= 3, 40000);
  const rp = await recvPhotos();
  r.B_recibe = rp.map(desc);
  r.B_marcas_ok = rp.length === 3 && ['f1.jpg', 'f2.jpg*', 'f3.jpg'].every((d) => r.B_recibe.indexOf(d) >= 0);

  // 2) UNA sola foto → también revisión; la ✕ «Cancelar» no manda nada y libera la URL
  const before2 = (await own(A, idB)).length;
  await pick(A, [photo('sola.jpg', 5)]);
  r.una_foto_revision = await waitFor(() => !!review(A), 2000);
  r.una_foto_ojo = !!(review(A) && review(A).querySelectorAll('.nx-grev-eye').length === 1);
  const shown2 = review(A) ? Array.from(review(A).querySelectorAll('img')).map((i) => i.src) : [];
  click(A.win, review(A) && review(A).querySelector('#nexo-grev-cancel'));
  await sleep(1500);
  r.cancelar_cierra = !review(A);
  r.cancelar_no_manda = (await own(A, idB)).length === before2;
  r.cancelar_libera = shown2.length === 1 && shown2.every((u) => A.urls.revoked.has(u));

  // 3) El atrás de Android con la revisión abierta = Cancelar (y el chat sigue abierto)
  await pick(A, [photo('g1.jpg', 6), photo('g2.jpg', 8)]);
  const hadReview = !!review(A);
  const back = A.win.__nexoHandleBack();
  await sleep(1500);
  r.atras_cancela = hadReview && back === true && !review(A) && (await own(A, idB)).length === before2;
  r.atras_chat_sigue = A.win.document.body.classList.contains('chat-view-active');

  // 4) Una sola foto, con su ojo encendido → «Enviar (1)» → sale «ver una vez»
  await pick(A, [photo('unica.jpg', 9)]);
  const ov4 = review(A);
  click(A.win, ov4 && ov4.querySelector('.nx-grev-eye'));
  r.boton_una = ov4 && ov4.querySelector('#nexo-grev-send').textContent;
  click(A.win, ov4 && ov4.querySelector('#nexo-grev-send'));
  r.una_foto_una_vez = await waitFor(async () => (await own(A, idB)).some((m) => desc(m) === 'unica.jpg*'), 8000);

  // 5) Solo un vídeo → 3163: también revisión, con su ojo; sin tocarlo, «Enviar (1)» lo manda normal
  const nv = (await own(A, idB)).filter((m) => m.attachmentType === 'video').length;
  await pick(A, [video('solo.mp4')]);
  const ov5 = review(A);
  r.solo_video_revision_con_ojo = !!ov5 && ov5.querySelectorAll('.nx-grev-eye').length === 1;
  click(A.win, ov5 && ov5.querySelector('#nexo-grev-send'));
  r.solo_video_sale = await waitFor(async () => (await own(A, idB)).filter((m) => m.attachmentType === 'video' && !(m.attachmentMeta && m.attachmentMeta.once)).length > nv, 8000);

  // 6) Grupo A+B: el ojo también está y el «una vez» llega en el sobre del grupo
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300);
  const gid = A.win.bleInterface.groups.create('Fotos', [idB]).id;
  A.win.NEXO_openGroupChat(gid); await sleep(600);
  await sendText(A, 'hola grupo');
  r.grupo_en_B = await waitFor(() => !!B.win.bleInterface.groups.get(gid), 30000);
  await pick(A, [photo('gf1.jpg', 10), photo('gf2.jpg', 11)]);
  const ov6 = review(A);
  r.grupo_ojos = ov6 ? ov6.querySelectorAll('.nx-grev-eye').length : 0;
  if (ov6) { click(A.win, ov6.querySelectorAll('.nx-grev-eye')[0]); click(A.win, ov6.querySelector('#nexo-grev-send')); }
  const gRecv = async () => (await B.win.vaultLoadMessages(gid)).filter((m) => !m._own && m.attachmentType === 'image');
  await waitFor(async () => (await gRecv()).length >= 2, 40000);
  r.grupo_B_recibe = (await gRecv()).map(desc);
  r.grupo_marcas_ok = r.grupo_B_recibe.length === 2 && r.grupo_B_recibe.indexOf('gf1.jpg*') >= 0 && r.grupo_B_recibe.indexOf('gf2.jpg') >= 0;
  B.win.NEXO_openGroupChat(gid); await sleep(800);
  const gb = Array.from(B.win.document.querySelectorAll('#messages-container .message.other')).filter((m) => /una vez/.test(m.textContent));
  r.grupo_B_burbuja_una_vez = gb.length === 1 && !gb[0].querySelector('img');

  r.errores = logs.filter((l) => /TypeError|ReferenceError|undefined is not|No se pudo descifrar/.test(l)).slice(0, 4);
  const ok = r.revision_aparece && r.miniaturas === 4 && r.miniaturas_url && JSON.stringify(r.tipos) === '["foto","foto","video","foto"]' && r.ojos === 4 &&
    r.video_con_ojo_e_indicador && r.ojos_en_las_fotos && r.nada_antes_de_enviar && r.boton === 'Enviar (4)' && r.ojo_2_encendido && r.ojo_3_apagado &&
    r.revision_cerrada && r.urls_liberadas && r.orden_y_marcas_ok && r.B_marcas_ok &&
    r.una_foto_revision && r.una_foto_ojo && r.cancelar_cierra && r.cancelar_no_manda && r.cancelar_libera &&
    r.atras_cancela && r.atras_chat_sigue && r.boton_una === 'Enviar (1)' && r.una_foto_una_vez &&
    r.solo_video_revision_con_ojo && r.solo_video_sale &&
    r.grupo_en_B && r.grupo_ojos === 2 && r.grupo_marcas_ok && r.grupo_B_burbuja_una_vez && r.errores.length === 0;
  finish(ok);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_galeriaunavez.txt'), logs.join('\n')); process.exit(1); });
