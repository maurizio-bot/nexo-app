// Diagnósticos del dueño 13-11 (S24 APK 3031, 20:06–20:42):
//  §1 APK de 25 MB a …c1ee y …707a (56 h): «Adjunto pendiente sin sus datos (no se pudo leer del teléfono tras varios intentos)» y
//     aun así se volvía a cargar del disco en CADA vuelta del reenvío (25 MB cada 15–60 s) y salía «pendiente viejo» una y otra vez.
//     3038: tras darlo por ilegible queda ✗ con la marca attMissing: ni reenvío automático ni «pendiente viejo»; «Reintentar» la quita.
//  §2 un texto largo para …ab2f (ausente) arrancaba en cada reenvío de OTRO contacto (cada 15–30 s, casi 2 h) y se rendía a los 10 s.
//     3038: tras rendirse, la reanudación espera 15 s, 30 s… 10 min, salvo que el enlace de ESE contacto esté listo.
//  §4 (3041, Honor …c1ee 21:25): la transferencia de una copia de estado ya borrada del historial (huérfana) se borra, no se reanuda.
//  §3 (3040, aviso «openchat_mac_vieja» 21:15 / S24 21:28): abrir el chat de un contacto en pausa Bluetooth no fuerza la conexión.
//  §1b (3063, diagnósticos automáticos S24 3041 13-11 09:18–09:22: el APK de 25 MB del 10-11 seguía «pendiente viejo» 4117 min y se
//     releía del disco cada vez que su contacto aparecía): la cuenta de intentos fallidos vivía solo en memoria y la app se cerraba
//     antes de juntar 3 intentos en 5 min. Ahora se guarda con el mensaje: varias sesiones cortas también lo dan por ilegible.
// Uso: node cola3038.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 220))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return false; }

(async () => {
  const r = { prueba: 'cola3038', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface, idB = B.win.bleInterface.localNexoId.toLowerCase();
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(2500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  r.enlace = await waitFor(() => !!biA._bleReadyFor(idB), 20000);

  // §1 adjunto ilegible: un archivo propio pendiente sin datos ni referencia (como el APK de 25 MB que ya no se lee)
  const mid = 'msg_attmiss_3038';
  await A.win.vaultAppendMessage(idB, { msgId: mid, _own: true, status: 'pending', timestamp: Date.now() - 3 * 3600000, content: '[adjunto]', attachmentType: 'file', attachmentMeta: { name: 'doc.pdf', size: 51200 } });
  biA._attMiss = { [mid]: { n: 2, t0: Date.now() - 400000, tl: Date.now() - 120000 } }; // ya lleva 2 intentos y > 5 min
  biA._resendPendingMessages(idB);
  await waitFor(async () => { const m = (await A.win.vaultLoadMessages(idB)).find((x) => x.msgId === mid); return m && m.status === 'failed'; }, 15000);
  await sleep(800);
  let m = (await A.win.vaultLoadMessages(idB)).find((x) => x.msgId === mid);
  r.s1_estado = m && m.status; r.s1_marca = !!(m && m.attMissing);
  // otra vuelta del reenvío: ya no lo vuelve a cargar del disco
  const k = logs.length; biA._resendPendingMessages(idB); await sleep(1500);
  r.s1_no_relee = !logs.slice(k).some((l) => /\[A\].*se cargan .*adjunto/.test(l));
  // «Reintentar» a mano: vuelve a la lista
  if (typeof A.win.vaultPatchMessage === 'function') await A.win.vaultPatchMessage(idB, mid, { attMissing: false });
  const k2 = logs.length; biA._attMiss = {}; biA._resendPendingMessages(idB); await sleep(1500);
  r.s1_reintentar_vuelve = logs.slice(k2).some((l) => /\[A\].*(se cargan .*adjunto|Adjunto pendiente sin sus datos)/.test(l));
  // §1b (3063) otro adjunto ilegible en TRES sesiones cortas (al «reiniciar» se pierde lo que había en memoria; entre la 2.ª y la 3.ª
  //     pasan 6 min: se simula moviendo atrás la hora guardada del primer intento)
  {
    const mid2 = 'msg_attmiss_3063';
    await A.win.vaultAppendMessage(idB, { msgId: mid2, _own: true, status: 'pending', timestamp: Date.now() - 3 * 3600000, content: '[adjunto]', attachmentType: 'file', attachmentMeta: { name: 'app.zip', size: 61440 } }); // por Bluetooth (uno de 25 MB ni se intenta: espera Wi-Fi/internet)
    const ronda = async () => { biA._attMiss = {}; biA._resendPendingMessages(idB); await sleep(1500); };
    const get2 = async () => (await A.win.vaultLoadMessages(idB)).find((x) => x.msgId === mid2);
    await ronda();
    await ronda();
    const m2 = await get2();
    r.s1b_cuenta_guardada = m2 ? (m2.attMissN || 0) : -1;
    if (m2 && m2.attMissT0) await A.win.vaultPatchMessage(idB, mid2, { attMissT0: m2.attMissT0 - 360000 });
    await ronda();
    await waitFor(async () => { const x = await get2(); return x && x.status === 'failed'; }, 8000);
    const m3 = await get2();
    r.s1b_estado = m3 && m3.status; r.s1b_marca = !!(m3 && m3.attMissing);
  }

  // §2 espera creciente al reanudar: una transferencia de un contacto ausente C que siempre se rinde
  const ack = biA.ackSystem, idC = 'nx0zz3038c';
  const orig = { gp: A.win.vaultGetPendingOutgoingTransfers, drop: ack._dropDeliveredTransfers, run: ack._resumeRunOne };
  const tx = { transferId: 'msg_resume_3038', status: 'pending', type: 'chat', chunks: ['x'], meta: {} };
  let runs = 0;
  const realContacts = biA.getBLEContacts;
  biA.getBLEContacts = () => [{ nexoId: idC, deviceId: 'CC:CC:CC:CC:CC:03' }];
  A.win.vaultGetPendingOutgoingTransfers = (cid) => Promise.resolve(cid === idC ? [Object.assign({}, tx)] : []);
  ack._dropDeliveredTransfers = (c, l) => Promise.resolve(l);
  ack._resumeRunOne = () => { runs++; return Promise.reject(new Error('Contacto no disponible: queda pendiente')); };
  const scan = async (dev) => { ack._resumeScanAt = 0; ack._resumeScanBusy = false; ack.resumeOutgoingTransfers(dev); await sleep(300); };
  await scan(); r.s2_primera = runs;                 // 1: arranca y se rinde
  await scan(); await scan(); r.s2_en_espera = runs; // sigue en 1: no arranca en cada reenvío de otros
  biA._resolveNexoId = biA._resolveNexoId || (() => null);
  ack._resolveNexoId = (d) => (d === 'CC:CC:CC:CC:CC:03' ? idC : null);
  await scan('CC:CC:CC:CC:CC:03'); r.s2_su_enlace = runs; // 2: su propio enlace listo → sin esperar
  const f = ack._resumeFail && ack._resumeFail.get(tx.transferId); if (f) f.at = Date.now() - 3600000;
  await scan(); r.s2_tras_espera = runs;             // 3: pasada la espera, vuelve a probar
  biA.getBLEContacts = realContacts; // (§2 lo cambió)
  // §3 (diagnóstico S24 21:28 con …707a, Bluetooth apagado): abrir el chat de un contacto en pausa Bluetooth no fuerza la
  //    conexión (antes: otro no_service y la pausa crecía); sin pausa, sí (como siempre)
  {
    radio.block(nA, nB); await sleep(2500);
    let conn = 0; const realConn = biA.nativePlugin.connectToDevice;
    biA.nativePlugin.connectToDevice = function () { conn++; return Promise.resolve({ connected: false }); };
    biA._bleCooldownUntil = biA._bleCooldownUntil || new Map();
    biA._bleCooldownUntil.set(idB, Date.now() + 60000);
    await biA.openChat(idB).catch(() => {}); await sleep(300);
    r.s3_en_pausa_no_fuerza = conn === 0;
    biA._bleCooldownUntil.delete(idB);
    await biA.openChat(idB).catch(() => {}); await sleep(300);
    r.s3_sin_pausa_fuerza = conn > 0;
    biA.nativePlugin.connectToDevice = realConn;
  }
  // §4 (3041, diagnóstico Honor …c1ee 21:25): la transferencia de una copia de estado cuyo mensaje ya no está (huérfana) se borra
  //    sin reanudarla; un texto normal sin mensaje en el historial NO se toca (p. ej. copias de grupo, guardadas en el grupo)
  {
    A.win.vaultGetPendingOutgoingTransfers = orig.gp; ack._dropDeliveredTransfers = orig.drop;
    let runs4 = []; ack._resumeRunOne = (j) => { runs4.push(j.tx.transferId); return Promise.reject(new Error('x')); };
    const big = 'x'.repeat(2000);
    const st = JSON.stringify({ type: 'nexo_act', act: 'st', sid: 'st3041aaaa', m: 'data:image/jpeg;base64,' + big });
    await A.win.vaultCreateOutgoingTransfer(idB, 'msg_orphan_st_3041', 'chat', 2, [st.slice(0, 1000), st.slice(1000)], {}, '');
    await A.win.vaultCreateOutgoingTransfer(idB, 'msg_orphan_txt_3041', 'chat', 1, ['hola, texto normal largo'], {}, '');
    ack._resumeFail && ack._resumeFail.clear(); ack._resumeScanAt = 0; ack._resumeScanBusy = false;
    ack.resumeOutgoingTransfers(); await sleep(1500);
    const left = (await A.win.vaultGetPendingOutgoingTransfers(idB)).map((t) => t.transferId);
    r.s4_estado_huerfano_borrado = left.indexOf('msg_orphan_st_3041') < 0 && runs4.indexOf('msg_orphan_st_3041') < 0;
    r.s4_texto_sigue = left.indexOf('msg_orphan_txt_3041') >= 0 && runs4.indexOf('msg_orphan_txt_3041') >= 0;
    ack._resumeRunOne = orig.run;
  }
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT/.test(l)).slice(0, 5);
  const ok = r.enlace && r.s1_estado === 'failed' && r.s1_marca && r.s1b_cuenta_guardada === 2 && r.s1b_estado === 'failed' && r.s1b_marca && r.s1_no_relee && r.s1_reintentar_vuelve &&
    r.s2_primera === 1 && r.s2_en_espera === 1 && r.s2_su_enlace === 2 && r.s2_tras_espera === 3 && r.s3_en_pausa_no_fuerza && r.s3_sin_pausa_fuerza && r.s4_estado_huerfano_borrado && r.s4_texto_sigue && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('COLA3038 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_cola3038.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('COLA3038 ' + JSON.stringify({ prueba: 'cola3038', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_cola3038.txt'), logs.join('\n')); process.exit(1); });
