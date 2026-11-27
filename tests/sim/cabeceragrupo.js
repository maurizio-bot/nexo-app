// Dueño 25-11 (captura: grupo «Pura gente del señor Nexo (Ya Se Admite Italia)», 6 personas): en la cabecera de un grupo el nombre largo
// y la línea «6 personas: Roberto, Alex Lopez…» se metían debajo de los botones (llamada, videollamada, ajustes: 3; el hueco era fijo
// para 2). Chromium real a 360 px:
//  1. el nombre y la línea de abajo terminan ANTES del primer botón; el nombre se ve entero en ≤ 2 líneas (letra ≥ 13 px)
//  2. la línea de abajo se corta con «…» (no se sale)        3. un nombre corto conserva su letra normal (20 px; 17 px en ≤ 360 px)
//  4. tocar la línea de abajo abre la lista de integrantes (Ajustes del grupo)
// Uso: node cabeceragrupo.js <dir_build>
'use strict';
const path = require('path');
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x780'; // también: SHOTS_VIEWPORT=412x900
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');
const dist = path.join(path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip')), 'dist');
const logs = [];
(async () => {
  const r = { prueba: 'cabeceragrupo' };
  const browser = await PW.chromium.launch();
  const radio = new Radio(), nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true });
  radio.add(nA); nA.load();
  const p = (await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana' })).page;
  await p.waitForFunction(() => window.NEXO && window.NEXO.initialized && window.bleInterface && window.bleInterface.groups, null, { timeout: 30000 });
  await sleep(800);
  // abrir el grupo como lo hace la lista
  const abrir = async (nombre) => {
    const gid = await p.evaluate((nombre) => window.bleInterface.groups.create(nombre, ['nxa1a1a1a1', 'nxb2b2b2b2', 'nxc3c3c3c3', 'nxd4d4d4d4', 'nxe5e5e5e5']).id, nombre);
    await p.evaluate(() => window.bleInterface.renderContactsList());
    await sleep(300);
    await p.evaluate((nombre) => { const row = Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent.indexOf(nombre) >= 0); row.click(); }, nombre);
    await sleep(900);
    return gid;
  };
  const geo = () => p.evaluate(() => {
    const q = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; };
    const nm = document.getElementById('chat-contact-name'), sub = document.getElementById('chat-contact-subtitle'), act = document.getElementById('chat-head-actions');
    const a = act && act.getBoundingClientRect(), n = nm.getBoundingClientRect(), s = sub.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(nm).fontSize), lh = parseFloat(getComputedStyle(nm).lineHeight) || fs * 1.15;
    return { botones: act ? act.children.length : 0, actL: a ? Math.round(a.left) : null, nomR: Math.round(n.right), subR: Math.round(s.right), fs,
      nomEntero: nm.scrollHeight <= nm.clientHeight + 1, lineas: Math.round(nm.scrollHeight / lh), visibles: Math.round(nm.clientHeight / lh), subCorta: sub.scrollWidth > sub.clientWidth && getComputedStyle(sub).textOverflow === 'ellipsis' };
  });
  await abrir('Pura gente del señor Nexo (Ya Se Admite Italia)');
  r.largo = await geo();
  r.no_se_encima = r.largo.botones >= 2 && r.largo.nomR <= r.largo.actL && r.largo.subR <= r.largo.actL;
  // entero en ≤ 2 líneas; si ni a la letra mínima cabe (teléfono angosto), se ven 2 líneas a 13 px (nunca debajo de los botones)
  r.nombre_entero = r.largo.fs >= 13 && r.largo.visibles <= 2 && (r.largo.nomEntero || r.largo.fs === 13);
  r.subtitulo_con_puntos = r.largo.subCorta;
  await p.evaluate(() => document.getElementById('chat-contact-subtitle').click());
  await sleep(500);
  r.abre_integrantes = await p.evaluate(() => !!document.getElementById('nexo-gset') && document.querySelectorAll('#nexo-gset .gset-member').length >= 6);
  await p.evaluate(() => { const s = document.getElementById('nexo-gset'); if (s) s.remove(); window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })); });
  await sleep(400);
  await abrir('Amigos');
  r.corto = await geo();
  r.corto_tamano_normal = r.corto.fs === 17 || r.corto.fs === 20;
  r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  const ok = r.no_se_encima && r.nombre_entero && r.subtitulo_con_puntos && r.abre_integrantes && r.corto_tamano_normal && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CABECERAGRUPO ' + JSON.stringify(r));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CABECERAGRUPO ' + JSON.stringify({ prueba: 'cabeceragrupo', resultado: 'FALLO', error: String(e && e.stack).slice(0, 400) })); process.exit(1); });
