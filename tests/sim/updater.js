// Actualizador automático del APK de probadores (2986; pedido del dueño 10-11: «las actualizaciones automáticas»).
// Un teléfono en jsdom con el plugin nativo SIMULADO (updateCheck/updateInstall). Se comprueba que:
//   (1) con un número de build propio (window.NEXO_BUILD) y un lanzamiento más nuevo, la app consulta SOLA al arrancar y muestra el aviso
//       «Hay una versión nueva» con el número; «Ahora no» lo calla ese número (no vuelve en la siguiente consulta);
//   (2) el límite de tiempo: una segunda consulta automática no llama al nativo; «Buscar ahora» (manual) sí;
//   (3) «Actualizar» llama a updateInstall con la URL del lanzamiento; sin permiso de instalar (install_permission) no hay instalador y
//       el aviso sigue ahí para reintentar;
//   (4) el mismo número (o menor) no ofrece nada y quita el aviso; sin número de build («dev») no consulta; interruptor apagado no consulta;
//   (5) Perfil → Ajustes tiene su tarjeta «Actualizaciones» (interruptor + «Buscar ahora» que informa del resultado);
//   (9) 3208: una descarga cortada por la red se reintenta sola (3 veces, cada vez más espaciado) y luego se rinde.
// Uso: node updater.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
const URL_NEW = 'https://github.com/maurizio-bot/nexo-app/releases/download/nightly-2005/nexo-nightly-2005-abc1234.apk';
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = nA.plugin();
      // 3008: updateInstall con mode: 'status' | 'download' (baja; termina cuando la prueba llama a finish()) | 'open' (instalador con lo ya bajado)
      win.__upd = { checks: 0, installs: [], downloads: [], opens: [], ready: 0, dl: 0, pending: null, autoFinish: true, nextDownload: null, nextOpen: { opened: true }, nextCheck: { build: 2005, tag: 'nightly-2005', url: URL_NEW, size: 25000000 }, notifs: [], cancels: 0 };
      win.__upd.finish = () => { const u = win.__upd, b = u.dl; if (!b) return; u.ready = b; u.dl = 0; nA.emit('onUpdateProgress', { pct: 100 }); nA.emit('onUpdateReady', { build: b }); if (u.pending) { const f = u.pending; u.pending = null; f({ ready: true }); } };
      pl.updateNotify = async (a) => { win.__upd.notifs.push(a && a.build); win.__upd.notifNotes = a && a.notes; };
      pl.updateNotifyCancel = async () => { win.__upd.cancels++; };
      pl.updateCheck = async (a) => { win.__upd.checks++; win.__upd.lastArgs = a || null; return win.__upd.nextCheck; };
      pl.updateInstall = (a) => {
        const u = win.__upd, mode = a && a.mode, b = a && a.build;
        if (mode === 'status') return Promise.resolve({ ready: u.ready === b, downloading: u.dl === b });
        if (mode === 'open') { u.opens.push(b); return Promise.resolve(u.ready === b ? u.nextOpen : { opened: false, reason: 'missing' }); }
        if (mode === 'download') {
          if (u.ready === b) return Promise.resolve({ ready: true });
          if (u.dl === b) return Promise.resolve({ downloading: true });
          u.downloads.push(a.url); u.installs.push(a.url);
          if (u.nextDownload) { const r = u.nextDownload; u.nextDownload = null; return Promise.resolve(r); }
          u.dl = b; nA.emit('onUpdateProgress', { pct: 40 });
          return new Promise((res) => { u.pending = res; if (u.autoFinish) setTimeout(() => u.finish(), 50); });
        }
        u.installs.push(a && a.url); return Promise.resolve({ opened: true });
      };
      win.Capacitor = { Plugins: { NexoBLE: pl } };
      win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  win.NEXO_BUILD = '2000';   // el index.html trae «__NEXO_BUILD__» (lo reemplaza el workflow); la consulta automática sale a los 8 s
  const U = () => win.__nexoUpdater;
  const banner = () => doc.getElementById('nexo-update-banner');
  const r = { prueba: 'updater', build: path.basename(buildDir) };
  r.gancho = !!U();

  // (1) consulta sola al arrancar (a los ~8 s) y avisa
  r.aviso_s = await waitFor(() => !!banner(), 20000);
  r.consulta_sola = win.__upd.checks === 1;
  r.aviso_con_numero = !!banner() && /2005/.test(banner().textContent) && /24 MB/.test(banner().textContent);
  r.disponible = !!(U().available() && U().available().build === 2005);
  // «Ahora no» lo calla ese número
  doc.getElementById('nexo-update-later').click(); await sleep(200);
  r.ahora_no_quita = !banner();

  // (2) límite de tiempo: la consulta automática siguiente NO llama al nativo; la manual sí
  const auto = await U().check(false);
  r.auto_limitada = auto.state === 'skipped' && win.__upd.checks === 1;
  const man = await U().check(true);
  r.manual_consulta = man.state === 'newer' && man.build === 2005 && win.__upd.checks === 2;
  r.silenciado_no_vuelve = !banner();

  // (3) 3008: «Descargar» baja (una vez); «Instalar» abre el instalador con lo YA bajado; sin permiso de instalar no se abre y se puede
  //     reintentar SIN volver a bajar
  win.localStorage.removeItem('nexo_upd_snooze');
  win.__upd.nextDownload = { ready: false, reason: 'net' };
  const d0 = await U().download();
  r.bajada_fallida_reintentable = d0.ready === false && !U().state().busy && /Descargar/.test((doc.getElementById('nexo-update-now') || {}).textContent || '');
  const d1 = await U().download();
  r.descarga = d1.ready === true && win.__upd.downloads.length === 2 && win.__upd.downloads[1] === URL_NEW && U().state().ready === 2005;
  win.__upd.nextOpen = { opened: false, reason: 'install_permission' };
  const i1 = await U().install();
  r.sin_permiso = i1.reason === 'install_permission' && win.__upd.opens.length === 1;
  r.reintento_posible = !!U().available();
  win.__upd.nextOpen = { opened: true };
  const i2 = await U().install();
  r.instala = i2.opened === true && win.__upd.opens.length === 2 && win.__upd.downloads.length === 2;   // abrió el instalador sin volver a bajar

  // (4) mismo número → nada y se quita el aviso; sin número («dev») → no consulta; interruptor apagado → no consulta
  win.__upd.nextCheck = { build: 2000, tag: 'nightly-2000', url: URL_NEW.replace('2005', '2000'), size: 1 };
  const cur = await U().check(true);
  r.mismo_numero_nada = cur.state === 'current' && !U().available() && !banner();
  const before = win.__upd.checks;
  win.NEXO_BUILD = '';
  const dev = await U().check(true);
  r.dev_no_consulta = dev.state === 'unsupported' && win.__upd.checks === before;
  win.NEXO_BUILD = '2000';
  win.__upd.nextCheck = { build: 2005, tag: 'nightly-2005', url: URL_NEW, size: 25000000 };
  U().setEnabled(false);
  win.localStorage.setItem('nexo_upd_last', '0');
  const off = await U().check(false);
  r.apagado_no_consulta = off.state === 'skipped' && win.__upd.checks === before;
  r.apagado_sin_aviso = !banner();
  U().setEnabled(true);

  // (5) Perfil → Ajustes: tarjeta «Actualizaciones»
  // 3110 (dueño 15-11): al abrir Ajustes se consulta sola y el botón dice lo que hay (sin «Buscar ahora»)
  win.NEXO_UPDATER_SETTINGS_GAP_MS = 0;
  win.__upd.nextCheck = { build: 2000, tag: 'nightly-2000', url: URL_NEW, size: 1 };
  const c5 = win.__upd.checks;
  win.dispatchEvent(new win.CustomEvent('nexo:ui:settings')); await sleep(400);
  const sheet = doc.getElementById('nexo-settings-sheet');
  r.tarjeta_ajustes = !!(sheet && sheet.querySelector('#nexo-updater-on') && sheet.querySelector('#nexo-updater-now'));
  if (sheet) {
    const b5 = sheet.querySelector('#nexo-updater-now');
    r.buscar_ahora_informa = win.__upd.checks === c5 + 1 && /Ya tienes la última/.test(sheet.querySelector('#nexo-updater-status').textContent) && /Tienes la última versión/.test(b5.textContent) && b5.disabled === true;
  }

  // (6) 3008 (dueño 11-11): «Buscar ahora» encuentra una versión nueva → «Descargar actualización (N)»; al tocarlo baja. Si se cierra la
  //     ventana mientras baja y se vuelve a abrir, NO pide descargar otra vez: «Descargando…» (y tocar no baja de nuevo). Al terminar avisa
  //     y el único botón es «Instalar actualización (N)» (también en el aviso de abajo: solo «Instalar»); tocarlo abre el instalador sin bajar.
  if (sheet) {
    win.__upd.ready = 0; win.__upd.autoFinish = false;
    win.__upd.nextCheck = { build: 2005, tag: 'nightly-2005', url: URL_NEW, size: 25000000 };
    win.localStorage.removeItem('nexo_upd_snooze');
    sheet.parentNode && sheet.parentNode.removeChild(sheet);   // 3110: se vuelve a abrir Ajustes y la consulta sola encuentra la 2005
    win.dispatchEvent(new win.CustomEvent('nexo:ui:settings')); await sleep(500);
    const sheet6 = doc.getElementById('nexo-settings-sheet');
    const b6 = sheet6.querySelector('#nexo-updater-now');
    r.boton_pasa_a_descargar = /Actualizar a la versión 2005/.test(b6.textContent) && /2005/.test(sheet6.querySelector('#nexo-updater-status').textContent);
    const antes = win.__upd.downloads.length;
    b6.click(); await sleep(300);
    r.boton_descarga = win.__upd.downloads.length === antes + 1 && win.__upd.downloads[antes] === URL_NEW;
    // se cierra la ventana (toque afuera) mientras baja y se vuelve a abrir
    sheet6.parentNode && sheet6.parentNode.removeChild(sheet6);
    win.dispatchEvent(new win.CustomEvent('nexo:ui:settings')); await sleep(400);
    const sheet2 = doc.getElementById('nexo-settings-sheet');
    const b7 = sheet2 && sheet2.querySelector('#nexo-updater-now');
    r.reabrir_sigue_descargando = !!b7 && /Descargando/.test(b7.textContent) && b7.disabled === true;
    b7 && b7.click(); await sleep(300);
    r.no_vuelve_a_bajar = win.__upd.downloads.length === antes + 1;
    // termina de bajar con la ventana cerrada → aviso + «Instalar»
    sheet2.parentNode && sheet2.parentNode.removeChild(sheet2);
    win.__upd.finish(); await sleep(400);
    r.avisa_al_terminar = logs.some((l) => /ya está descargada: lista para instalar/.test(l));
    const bn = banner();
    r.aviso_solo_instalar = !!bn && /2005/.test(bn.textContent) && /descargada/.test(bn.textContent) && !!bn.querySelector('#nexo-update-now') && /Instalar/.test(bn.querySelector('#nexo-update-now').textContent) && !bn.querySelector('#nexo-update-later');
    win.dispatchEvent(new win.CustomEvent('nexo:ui:settings')); await sleep(400);
    const sheet3 = doc.getElementById('nexo-settings-sheet');
    const b8 = sheet3 && sheet3.querySelector('#nexo-updater-now');
    r.abre_ya_con_instalar = !!b8 && /Instalar actualización \(2005\)/.test(b8.textContent) && !b8.disabled;
    const op0 = win.__upd.opens.length;
    b8 && b8.click(); await sleep(400);
    r.instalar_sin_bajar = win.__upd.opens.length === op0 + 1 && win.__upd.downloads.length === antes + 1;
    win.__upd.autoFinish = true;
  }

  // (7) 2994 (pedido del dueño): aviso del sistema «Hay una versión nueva» con botón «Actualizar»
  r.visible_sin_aviso_sistema = win.__upd.notifs.length === 0;                     // con la app a la vista basta el aviso de abajo
  // 3008: una versión YA bajada no repite el aviso «hay una versión nueva» (el nativo ya avisó «descargada · Instalar»): para probar el
  // aviso de «nueva» se parte de una que aún no está bajada
  win.__upd.ready = 0; await U().check(true); await sleep(300);
  r.ya_bajada_no_avisa_nueva = win.__upd.notifs.length === 0;
  win.localStorage.removeItem('nexo_upd_snooze'); win.localStorage.removeItem('nexo_upd_notified');
  let vis = 'hidden'; Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => vis });
  doc.dispatchEvent(new win.Event('visibilitychange')); await sleep(200);
  r.aviso_al_salir = win.__upd.notifs.length === 1 && win.__upd.notifs[0] === 2005;      // te vas de la app con una versión pendiente
  doc.dispatchEvent(new win.Event('visibilitychange')); await sleep(200);
  r.una_vez_por_numero = win.__upd.notifs.length === 1;                            // no se repite para el mismo número
  win.__upd.nextCheck = { build: 2006, tag: 'nightly-2006', url: URL_NEW.replace('2005', '2006'), size: 26000000 };
  const n6 = await U().check(true);
  r.numero_nuevo_avisa = n6.state === 'newer' && win.__upd.notifs.length === 2 && win.__upd.notifs[1] === 2006;
  const instA = win.__upd.downloads.length, canA = win.__upd.cancels;
  nA.emit('onUpdateAction', { install: true, build: 2006 }); await sleep(500);        // botón «Actualizar» del aviso → baja la 2006
  r.boton_aviso_instala = win.__upd.downloads.length === instA + 1 && win.__upd.downloads[instA] === URL_NEW.replace('2005', '2006');
  r.instalar_quita_aviso = win.__upd.cancels > canA;
  win.__upd.nextCheck = { build: 2000, tag: 'nightly-2000', url: URL_NEW, size: 1 };
  const canB = win.__upd.cancels;
  await U().check(true);
  r.al_ya_no_aplicar_quita_aviso = win.__upd.cancels > canB;
  vis = 'visible';

  // (8) 3105 (dueño 15-11: «donde está el botón de actualizar, lo que se tocó y lo que se actualizó… una breve descripción»): las
  //     novedades de la versión nueva (descripción de su lanzamiento, formato de Google Play por idioma) en el aviso («¿Qué trae?») y en
  //     Ajustes, y las de la versión instalada («Lo nuevo de tu versión»). Siempre como texto.
  const NOTES = '<es-419>\n- Dos llamadas a la vez <img src=x>\n</es-419>\n<it-IT>\n- Due chiamate insieme\n</it-IT>\n<en-US>\n- Two calls at once\n</en-US>';
  win.__upd.ready = 0;
  win.__upd.nextCheck = { build: 2007, tag: 'nightly-2007', url: URL_NEW.replace('2005', '2007'), size: 26000000, notes: NOTES, curNotes: '<es-419>\n- Lo de la 2000\n</es-419>' };
  win.localStorage.removeItem('nexo_upd_snooze');
  await U().check(true); await sleep(300);
  r.novedades_pide_actual = !!(win.__upd.lastArgs && win.__upd.lastArgs.current === 2000);
  const bnN = banner(), wn = bnN && bnN.querySelector('#nexo-update-whatsnew');
  r.novedades_aviso = !!wn && /Qué trae/.test(wn.textContent);
  if (wn) wn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  const shN = doc.getElementById('nexo-update-notes-sheet');
  r.novedades_hoja = !!shN && /2007/.test(shN.textContent) && /Dos llamadas a la vez/.test(shN.textContent) && !/Two calls/.test(shN.textContent) && !shN.querySelector('img');
  if (shN) shN.remove();
  const oldS = doc.getElementById('nexo-settings-sheet'); if (oldS && oldS.parentNode) oldS.parentNode.removeChild(oldS);
  win.dispatchEvent(new win.CustomEvent('nexo:ui:settings')); await sleep(400);
  const s9 = doc.getElementById('nexo-settings-sheet'), nb = s9 && s9.querySelector('#nexo-updater-notes'), nt = (nb && nb.textContent) || '';
  r.novedades_ajustes = /Lo nuevo en la versión 2007/.test(nt) && /Dos llamadas a la vez/.test(nt) && /Lo nuevo de tu versión \(2000\)/.test(nt) && /Lo de la 2000/.test(nt) && !nb.querySelector('img');
  r.novedades_idioma = U().notesText(NOTES, 'it') === '- Due chiamate insieme' && U().notesText(NOTES, 'en') === '- Two calls at once' && /Dos llamadas/.test(U().notesText(NOTES, 'fr')) && U().notesText('**Full Changelog**: https://x', 'es') === '';
  win.__upd.nextCheck = { build: 2008, tag: 'nightly-2008', url: URL_NEW.replace('2005', '2008'), size: 26000000 };   // un lanzamiento sin novedades
  await U().check(true); await sleep(300);
  r.sin_novedades_sin_enlace = !!banner() && !banner().querySelector('#nexo-update-whatsnew');
  // 3107: el aviso del sistema «Hay una versión nueva» lleva las novedades (texto del idioma de la app)
  win.__upd.nextCheck = { build: 2009, tag: 'nightly-2009', url: URL_NEW.replace('2005', '2009'), size: 26000000, notes: NOTES };
  await U().check(true); await sleep(200);
  win.localStorage.removeItem('nexo_upd_notified'); win.localStorage.removeItem('nexo_upd_snooze');
  let vis2 = 'hidden'; Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => vis2 });
  doc.dispatchEvent(new win.Event('visibilitychange')); await sleep(200);
  r.aviso_sistema_con_novedades = win.__upd.notifs[win.__upd.notifs.length - 1] === 2009 && /Dos llamadas a la vez/.test(String(win.__upd.notifNotes || '')) && !/Two calls|<es-419>/.test(String(win.__upd.notifNotes || ''));
  vis2 = 'visible';

  // (9) 3208 (Marcos 17-11, build 3043: un corte de 3 s del Wi-Fi tumbó la descarga y había que volver a tocar «Descargar»): una
  //     descarga cortada por la red se reintenta SOLA (aquí a los 0,3 s y a los 0,6 s); el segundo corte también; luego baja y avisa
  win.NEXO_UPD_RETRY_MS = [300, 600, 900];
  win.__upd.ready = 0; win.__upd.dl = 0;
  win.__upd.nextCheck = { build: 2010, tag: 'nightly-2010', url: URL_NEW.replace('2005', '2010'), size: 26000000 };
  await U().check(true); await sleep(200);
  const dl0 = win.__upd.downloads.length;
  win.__upd.nextDownload = { ready: false, reason: 'net' };
  const f9 = await U().download();
  win.__upd.nextDownload = { ready: false, reason: 'net' };   // el primer reintento también se corta
  r.reintento_solo_s = await waitFor(() => U().state().ready === 2010, 5000);
  r.reintento_solo = f9.ready === false && r.reintento_solo_s !== null && win.__upd.downloads.length === dl0 + 3 && logs.some((l) => /la reintento sola en \d+ s \(intento 2 de 3\)/.test(l));
  // sin red de verdad: tras los 3 reintentos se rinde (no se queda probando para siempre)
  win.__upd.ready = 0; win.__upd.dl = 0;
  win.__upd.nextCheck = { build: 2011, tag: 'nightly-2011', url: URL_NEW.replace('2005', '2011'), size: 26000000 };
  await U().check(true); await sleep(200);
  const dl1 = win.__upd.downloads.length;
  const realDl = win.__upd;
  let fails = 0; const origInstall = win.Capacitor.Plugins.NexoBLE.updateInstall;
  win.Capacitor.Plugins.NexoBLE.updateInstall = (a) => (a && a.mode === 'download') ? (fails++, realDl.downloads.push(a.url), Promise.resolve({ ready: false, reason: 'net' })) : origInstall(a);
  await U().download();
  await sleep(2500);
  r.reintento_se_rinde = fails === 4 && win.__upd.downloads.length === dl1 + 4 && U().state().ready !== 2011;
  win.Capacitor.Plugins.NexoBLE.updateInstall = origInstall;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const keys = ['gancho', 'consulta_sola', 'aviso_con_numero', 'disponible', 'ahora_no_quita', 'auto_limitada', 'manual_consulta', 'silenciado_no_vuelve', 'bajada_fallida_reintentable', 'descarga', 'sin_permiso', 'reintento_posible', 'instala', 'mismo_numero_nada', 'dev_no_consulta', 'apagado_no_consulta', 'apagado_sin_aviso', 'tarjeta_ajustes', 'buscar_ahora_informa', 'boton_pasa_a_descargar', 'boton_descarga', 'reabrir_sigue_descargando', 'no_vuelve_a_bajar', 'avisa_al_terminar', 'aviso_solo_instalar', 'abre_ya_con_instalar', 'instalar_sin_bajar', 'visible_sin_aviso_sistema', 'ya_bajada_no_avisa_nueva', 'aviso_al_salir', 'una_vez_por_numero', 'numero_nuevo_avisa', 'boton_aviso_instala', 'instalar_quita_aviso', 'al_ya_no_aplicar_quita_aviso', 'novedades_pide_actual', 'novedades_aviso', 'novedades_hoja', 'novedades_ajustes', 'novedades_idioma', 'sin_novedades_sin_enlace', 'aviso_sistema_con_novedades', 'reintento_solo', 'reintento_se_rinde'];
  const ok = typeof r.aviso_s === 'number' && keys.every((k) => r[k] === true) && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('UPDATER ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_updater.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { try { fs.writeFileSync(path.join(__dirname, 'last_logs_updater.txt'), logs.join('\n')); } catch (x) {} console.log('UPDATER ' + JSON.stringify({ prueba: 'updater', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
