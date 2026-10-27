// Seguridad fase 3 (Perfil → Seguridad): bloqueo opcional con huella/PIN y bloquear capturas.
// A y B emparejados. Se comprueba: por defecto nada bloqueado; activar el bloqueo exige la huella (cancelarla
// no lo activa; sin huella en el teléfono no se puede); con "tras 1 minuto" una salida corta no bloquea; con
// "inmediatamente" se tapa al salir y se pide al volver; pedir el PIN (la app "se va" y "vuelve") no provoca
// un bucle; bloqueado, los mensajes siguen llegando; al reabrir la app pide la huella; quitar la huella del
// teléfono no deja al usuario fuera; capturas bloqueadas (FLAG_SECURE) se aplican también al reabrir.
// Uso: node lock.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], asymmetric: true };
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
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } };
      win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    },
  });
  const win = dom.window;
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  // Pantalla tapada justo al arrancar (antes de que la app termine de cargar)
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) { await sleep(100); if (win.document.getElementById('nexo-lock')) p.lockedEarly = true; }
  await sleep(800);
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(600); return !!row;
}
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
const prefs = (nat) => { try { return JSON.parse(nat.files.get('nexo_security.json') || 'null'); } catch (e) { return 'ilegible'; } };
const locked = (p) => !!p.win.document.getElementById('nexo-lock');
const openProfile = async (p) => { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:profile')); await sleep(300); };
const closeProfile = async (p) => { click(p.win, p.win.document.getElementById('nexo-profile-close')); await sleep(200); };
const setCheck = async (p, id, on) => { const el = p.win.document.getElementById(id); el.checked = on; el.dispatchEvent(new p.win.Event('change')); await sleep(600); };
const secMsg = (p) => (p.win.document.getElementById('nexo-sec-msg') || {}).textContent || '';
const bio = (nat) => nat.stats.bioAsked || 0;

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, opts, { noBiometric: true }));
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let A = await boot('A', nA);
  const B = await boot('B', nB);
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  await sleep(800);
  await openChatWith(A, 'B'); await sendText(A, 'hola B'); await sleep(2500);
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300);
  if (!paired) { console.log('LOCK ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  const idA = A.win.bleInterface.localNexoId.toLowerCase();

  // 1) Por defecto: sin bloqueo, capturas permitidas; Perfil muestra el cifrado en reposo
  r.defecto_sin_bloqueo = !locked(A) && !A.lockedEarly && bio(nA) === 0;
  r.defecto_capturas_permitidas = nA.secureScreen !== true && !nA.calls.some((c) => c.name === 'setSecureScreen');
  await openProfile(A);
  r.perfil_seccion = !!A.win.document.getElementById('nexo-sec-lock') && !!A.win.document.getElementById('nexo-sec-secure');
  r.perfil_cifrado_texto = (A.win.document.getElementById('nexo-sec-atrest') || {}).textContent || '';
  r.perfil_tiempo_oculto_sin_bloqueo = A.win.document.getElementById('nexo-sec-after-row').style.display === 'none';

  // 2) Activar exige la huella: cancelarla no lo activa
  nA.bioAnswer = false;
  await setCheck(A, 'nexo-sec-lock', true);
  r.cancelar_huella_no_activa = !A.win.document.getElementById('nexo-sec-lock').checked && !(prefs(nA) && prefs(nA).lock) && bio(nA) === 1;
  nA.bioAnswer = true;
  await setCheck(A, 'nexo-sec-lock', true);
  r.huella_activa = A.win.document.getElementById('nexo-sec-lock').checked && prefs(nA) && prefs(nA).lock === true && bio(nA) === 2;
  r.aviso_activado = secMsg(A);
  r.tiempo_visible_con_bloqueo = A.win.document.getElementById('nexo-sec-after-row').style.display !== 'none';

  // 3) Sin huella ni PIN en el teléfono (B) no se puede activar
  await openProfile(B);
  await setCheck(B, 'nexo-sec-lock', true);
  r.B_sin_huella_no_activa = !B.win.document.getElementById('nexo-sec-lock').checked && !(prefs(nB) && prefs(nB).lock);
  r.B_aviso = secMsg(B);
  await closeProfile(B);

  // 4) "Tras 1 minuto": salir y volver enseguida no bloquea
  const sel = A.win.document.getElementById('nexo-sec-after');
  sel.value = '60000'; sel.dispatchEvent(new A.win.Event('change')); await sleep(300);
  r.prefs_1min = prefs(nA) && prefs(nA).lockAfterMs === 60000;
  await closeProfile(A);
  await sleep(3000); // pasa el margen tras la última huella
  let b0 = bio(nA);
  A.setActive(false); await sleep(400); A.setActive(true); await sleep(600);
  r.salida_corta_no_bloquea = !locked(A) && bio(nA) === b0;

  // 5) "Inmediatamente": se tapa al salir (no se ve en recientes) y se pide al volver
  await openProfile(A);
  sel.value = '0'; A.win.document.getElementById('nexo-sec-after').value = '0';
  A.win.document.getElementById('nexo-sec-after').dispatchEvent(new A.win.Event('change')); await sleep(300);
  await closeProfile(A);
  await sleep(500);
  b0 = bio(nA);
  A.setActive(false); await sleep(300);
  r.inmediato_tapa_al_salir = locked(A);
  // Pedir el PIN abre otra pantalla de Android: la app "se va" y "vuelve" durante la comprobación
  // (vuelve justo después de que responda la huella: el peor orden)
  nA.bioDuring = () => { setTimeout(() => A.setActive(false), 10); setTimeout(() => A.setActive(true), 120); };
  A.setActive(true);
  r.desbloqueo_al_volver_s = await waitFor(() => !locked(A), 5000);
  await sleep(3500);
  nA.bioDuring = null;
  r.sin_bucle_de_huella = bio(nA) - b0 === 1 && !locked(A);

  // 6) Bloqueada, los mensajes siguen llegando
  await sleep(500);
  nA.bioAnswer = false;
  A.setActive(false); await sleep(200); A.setActive(true);
  await sleep(500);
  r.cancelar_deja_bloqueada = locked(A);
  r.B_abre_chat = await openChatWith(B, 'A'); await sendText(B, 'llega con NEXO bloqueado');
  r.mensaje_llega_bloqueada_s = await waitFor(async () => (await A.win.vaultLoadMessages(B.win.bleInterface.localNexoId)).some((m) => m.content === 'llega con NEXO bloqueado'), 30000);
  r.sigue_bloqueada = locked(A);
  nA.bioAnswer = true;
  click(A.win, A.win.document.getElementById('nexo-lock-btn'));
  r.boton_desbloquea_s = await waitFor(() => !locked(A), 5000);

  // 7) Capturas: bloquearlas → FLAG_SECURE
  await sleep(3000);
  await openProfile(A);
  await setCheck(A, 'nexo-sec-secure', true);
  r.capturas_bloqueadas = nA.secureScreen === true && prefs(nA).secure === true;
  r.aviso_capturas = secMsg(A);
  await closeProfile(A);

  // 8) Reabrir la app: tapa enseguida, pide la huella y vuelve a bloquear capturas
  A.win.close(); nA.destroyActivity(); nA.secureScreen = false; nA.calls = [];
  await sleep(1000); nA.load();
  nA.bioAnswer = false;
  const b1 = bio(nA);
  A = await boot('A', nA);
  r.reabrir_tapa = locked(A);
  r.reabrir_pide_huella = bio(nA) > b1;
  r.reabrir_capturas_bloqueadas = nA.secureScreen === true;
  r.reabrir_mismo_id = A.win.bleInterface.localNexoId.toLowerCase() === idA;

  // 9) Si el teléfono ya no tiene huella ni PIN, no se queda fuera para siempre
  nA.opts.noBiometric = true;
  click(A.win, A.win.document.getElementById('nexo-lock-btn'));
  r.sin_huella_desbloquea_s = await waitFor(() => !locked(A), 5000);
  r.sin_huella_quita_bloqueo = prefs(nA).lock === false;
  nA.opts.noBiometric = false;

  // 10) Quitar las capturas bloqueadas
  await openProfile(A);
  await setCheck(A, 'nexo-sec-secure', false);
  r.capturas_permitidas_otra_vez = nA.secureScreen === false && prefs(nA).secure === false;

  // 11) Quitar el bloqueo desde Perfil pidiendo el PIN (la app "se va" y "vuelve"): no se tapa ni pide otra vez
  nA.bioAnswer = true;
  await setCheck(A, 'nexo-sec-lock', true); await sleep(3000);
  const b2 = bio(nA);
  nA.bioDuring = () => { setTimeout(() => A.setActive(false), 10); setTimeout(() => A.setActive(true), 120); };
  await setCheck(A, 'nexo-sec-lock', false); await sleep(2500);
  nA.bioDuring = null;
  r.quitar_con_pin_sin_bucle = bio(nA) - b2 === 1 && !locked(A) && prefs(nA).lock === false;

  // 12) #103 Desbloqueo rápido por rostro (opcional): el ajuste viaja como allowWeak al nativo (biometricStatus/Auth)
  var lastAllow = { status: null, auth: null };
  A.win.Capacitor.Plugins.NexoBLE.biometricStatus = function (o) { lastAllow.status = !!(o && o.allowWeak); return Promise.resolve({ available: true }); };
  A.win.Capacitor.Plugins.NexoBLE.biometricAuth = function (o) { lastAllow.auth = !!(o && o.allowWeak); return Promise.resolve({ ok: true }); };
  await openProfile(A);
  await setCheck(A, 'nexo-sec-lock', true);                 // activar el bloqueo (rostro rápido aún OFF)
  var ffRow = A.win.document.getElementById('nexo-sec-facefast-row');
  r.facefast_fila_visible = !!ffRow && ffRow.style.display !== 'none';
  r.allowweak_off = lastAllow.status === false && lastAllow.auth === false;   // por defecto, biometría fuerte
  await setCheck(A, 'nexo-sec-facefast', true);             // el usuario activa el rostro rápido
  r.facefast_guardado = !!(prefs(nA) && prefs(nA).faceFast === true);
  await setCheck(A, 'nexo-sec-lock', false);                // una comprobación ahora lleva allowWeak:true
  r.allowweak_on = lastAllow.status === true;
  await setCheck(A, 'nexo-sec-facefast', false);
  r.facefast_se_quita = !!(prefs(nA) && prefs(nA).faceFast === false);
  await closeProfile(A);

  // Que los avisos no saquen nada privado al registro
  r.registro_sin_mensaje = !logs.some((l) => /llega con NEXO bloqueado/.test(l));

  console.log('LOCK ' + JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(__dirname, 'last_logs_lock.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
