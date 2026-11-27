// Dueño 27-11: la lista de Contactos (chats y grupos) con cada fila como una TARJETA (el rectángulo de Ajustes, sutil). Chromium real a
// 360×780 (y 320×640, el más angosto):
//  T1  cada fila (contacto y grupo) es una tarjeta: fondo visible (no transparente), aro de 1 px, esquinas de 14 px y 6 px entre tarjetas
//  T2  nada se sale: la tarjeta cabe en la pantalla (sin desplazamiento a los lados), el ⋮ y la hora quedan dentro, el nombre largo
//      termina en «…» sin pisar la hora; los toques siguen abriendo el chat
//  T3  cuántas caben por pantalla (se anota para el dueño: ~1 menos que sin tarjetas)
// Contraprueba con la 3170: FALLO (filas sin fondo ni aro).
// Uso: node tarjetaslista.js <dir_build>     (TARJETAS_SHOTS=<carpeta>: capturas)
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const dist = path.join(buildDir, 'dist');
const shots = process.env.TARJETAS_SHOTS ? path.resolve(process.env.TARJETAS_SHOTS) : '';
const logs = [];
const r = { prueba: 'tarjetaslista', build: path.basename(buildDir) };
const fallos = [];
const check = (k, v, info) => { r[k] = v; if (v !== true) fallos.push(k + (info ? ' (' + info + ')' : '')); };
const NAMES = ['Beto', 'Carla Méndez', 'Maximiliano Alejandro de la Fuente Rodríguez', 'Elena Ríos', 'Fernando', 'Gabriela', 'Hugo', 'Isabel', 'Jorge', 'Karla'];

async function medir(vp) {
  process.env.SHOTS_VIEWPORT = vp;
  const browser = await PW.chromium.launch();
  const now = Date.now();
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, noTor: true });
  radio.add(nA); nA.load();
  nA.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: NAMES.map((name, i) => { const id = 'nx' + ('tj' + i + 'xyzabcde').slice(0, 8); return { nexoId: id, deviceUUID: id, name, addedAt: now - 9e6 + i, lastSeen: 0, online: false, unreadCount: i === 1 ? 3 : 0, lastMessage: 'Mensaje de prueba bastante largo para ver el corte ' + i, lastMessageAt: now - (i + 1) * 9 * 60000 }; }), savedAt: now }));
  const ph = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana' });
  const A = ph.page;
  await A.waitForFunction(() => window.NEXO && window.NEXO.initialized && window.bleInterface && window.bleInterface.groups, null, { timeout: 60000 });
  await sleep(4200);
  await A.evaluate(() => { ['nexo-bat-overlay', 'nexo-welcome-overlay'].forEach((id) => { const o = document.getElementById(id); if (o) o.remove(); }); window.bleInterface.groups.create('Equipo de fútbol del domingo', ['nxa1a1a1a1', 'nxb2b2b2b2']); window.bleInterface.renderContactsList(); });
  await sleep(600);
  const m = await A.evaluate(() => {
    const W = document.documentElement.clientWidth, H = window.innerHeight;
    const rows = Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row'));
    const out = { W, filas: rows.length, scrollX: document.documentElement.scrollWidth > W + 1, malos: [], enPantalla: 0, grupo: false };
    let prev = null;
    rows.forEach((row, i) => {
      const cs = getComputedStyle(row), b = row.getBoundingClientRect();
      const nm = row.querySelector('.ble-contact-name');
      if (nm && /Equipo/.test(nm.textContent)) out.grupo = true;
      if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') out.malos.push(i + ': sin fondo');
      if (parseFloat(cs.borderTopWidth) !== 1) out.malos.push(i + ': sin aro');
      if (cs.borderTopLeftRadius !== '14px') out.malos.push(i + ': radio ' + cs.borderTopLeftRadius);
      if (b.left < 0 || b.right > W) out.malos.push(i + ': se sale');
      if (prev && Math.abs(b.top - prev.bottom - 6) > 1) out.malos.push(i + ': separación ' + Math.round(b.top - prev.bottom));
      Array.from(row.querySelectorAll('*')).forEach((e) => { const eb = e.getBoundingClientRect(); if (eb.width > 0 && (eb.left < b.left - 0.5 || eb.right > b.right + 0.5)) out.malos.push(i + ': ' + (e.className || e.tagName) + ' fuera de la tarjeta'); });
      if (nm) { const t = row.querySelector('.ble-contact-time'); if (t && t.getBoundingClientRect().width > 0 && nm.getBoundingClientRect().right > t.getBoundingClientRect().left + 0.5 && nm.getBoundingClientRect().top < t.getBoundingClientRect().bottom - 2) out.malos.push(i + ': el nombre pisa la hora'); }
      if (b.top >= 0 && b.bottom <= H) out.enPantalla++;
      prev = b;
    });
    out.alto = rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : 0;
    return out;
  });
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await A.screenshot({ path: path.join(shots, 'lista_' + vp + '.png') }); }
  // tocar una tarjeta abre su chat
  await A.evaluate(() => { const row = document.querySelectorAll('#main-contacts-list .ble-contact-row')[0]; row.click(); });
  await sleep(900);
  m.abre = await A.evaluate(() => document.body.classList.contains('chat-view-active'));
  await browser.close();
  return m;
}

(async () => {
  r.v360 = await medir('360x780');
  r.v320 = await medir('320x640');
  check('T1_T2_360', r.v360.filas >= 11 && r.v360.grupo && !r.v360.scrollX && !r.v360.malos.length && r.v360.abre, JSON.stringify(r.v360.malos.slice(0, 6)));
  check('T1_T2_320', r.v320.filas >= 11 && !r.v320.scrollX && !r.v320.malos.length && r.v320.abre, JSON.stringify(r.v320.malos.slice(0, 6)));
  r.T3_caben_360 = r.v360.enPantalla; r.T3_alto_fila = r.v360.alto;
  r.errores = logs.filter((l) => /PAGEERROR|TypeError|is not a function/.test(l)).slice(0, 5);
  r.fallos = fallos;
  r.resultado = !fallos.length && !r.errores.length ? 'OK' : 'FALLO';
  console.log('TARJETAS ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('TARJETAS ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', fallos, error: String(e && e.stack).slice(0, 400) }))); process.exit(1); });
