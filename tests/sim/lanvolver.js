// 3237 (diagnóstico del dueño 18-11 10:27: «Wi-Fi local listo en 382,9 s» y a las 08:59 «su app no contestó en 180 s: se cierra» justo al volver a
// primer plano): con la pantalla apagada la app queda congelada minutos; al volver, la comprobación del Wi-Fi que estaba pendiente cuenta desde
// ESE momento (no se cierra el enlace por un tiempo que la app no estuvo viva) y se repite. Prueba sobre LanLink con el nativo simulado.
// Uso: node lanvolver.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'lanvolver' };
  const vis = {}; const doc = { visibilityState: 'hidden', addEventListener: (ev, fn) => { vis[ev] = fn; } };
  global.document = doc;
  global.window = global.window || global;
  global.Capacitor = { Plugins: { NexoBLE: { lanStatus: async () => ({ supported: true, wifi: true, peers: [] }), addListener: () => ({}), lanStart: async () => ({ wifi: true }), lanConnect: async () => {} } } };
  const { LanLink } = await importSrc('ui/lan.js');
  const lan = new LanLink({ localNexoId: 'nx1n36c283', getBLEContacts: () => [] });
  await lan.init();
  r.hay_escucha_de_visibilidad = typeof vis.visibilitychange === 'function';
  const hace = Date.now() - 300000;
  lan.links.set('nx1905c1ee', { up: true, verified: false, routable: false, upAt: hace, verifyAt: hace });
  doc.visibilityState = 'visible';
  if (vis.visibilitychange) vis.visibilitychange();
  const l = lan.links.get('nx1905c1ee');
  r.cuenta_desde_ahora = Date.now() - l.upAt < 2000;
  r.se_repite_la_comprobacion = l.verifyAt === 0;
  r.marcado_como_vuelta = l.hid === true;
  r.resultado = r.hay_escucha_de_visibilidad && r.cuenta_desde_ahora && r.se_repite_la_comprobacion && r.marcado_como_vuelta ? 'OK' : 'FALLO';
  console.log('LANVOLVER ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('LANVOLVER ' + JSON.stringify({ prueba: 'lanvolver', error: String(e && e.stack || e), resultado: 'FALLO' })); process.exit(1); });
