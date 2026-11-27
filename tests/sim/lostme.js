// 28-11 (diag. 27-11 09:45–09:46, S24 ↔ Austin): un contacto que me perdió confirma SIN firma válida; antes el mensaje se reenviaba sin fin
// sin explicación. Ahora (ack_lostme.js), sin aceptar nunca esa confirmación:
//  M1 la 1.ª confirmación sin firma pide el intercambio de claves (kx con «pídeme la mía») por el enlace que haya, o por otro teléfono;
//  M2 no se repite antes de 10 min (no se inunda), y pasados 10 min sí;
//  M3 a la 3.ª en 10 min se avisa al usuario UNA vez (con el nombre del contacto); no otra vez en 24 h;
//  M4 la confirmación sin firma sigue sin aplicarse (el mensaje no pasa a ✓✓): lo comprueba la batería de siempre (ackforge.js).
// Uso: node lostme.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  global.window = { NEXO_toast: (m) => toasts.push(m) };
  const toasts = [];
  const L = await importSrc('ui/ack_lostme.js');
  const r = { prueba: 'lostme' };
  // pura
  const T0 = 1e12;
  let a = L.lostMeStep(undefined, T0), b = L.lostMeStep(a.st, T0 + 1000), c = L.lostMeStep(b.st, T0 + 2000), d = L.lostMeStep(c.st, T0 + 3000);
  const e = L.lostMeStep(d.st, T0 + 601000);
  r.pasos = [a, b, c, d, e].map((x) => (x.kx ? 'K' : '-') + (x.tell ? 'T' : '-'));
  r.M2 = r.pasos.join() === 'K-,--,-T,--,K-';
  // con un «ble» falso
  const sent = [];
  const ble = { _resolveDeviceIdForNexoId: (nx) => (nx === 'nxaaaaaaaa' ? 'AA:BB:CC:DD:EE:01' : null), _sendKx: (dev, rq) => sent.push(['kx', dev, rq]), _sendKxRouted: (nx, rq) => sent.push(['ruta', nx, rq]) };
  L.noteUnsignedAck(ble, 'nxaaaaaaaa', 'Austin'); L.noteUnsignedAck(ble, 'nxaaaaaaaa', 'Austin'); L.noteUnsignedAck(ble, 'nxaaaaaaaa', 'Austin'); L.noteUnsignedAck(ble, 'nxaaaaaaaa', 'Austin');
  L.noteUnsignedAck(ble, 'nxbbbbbbbb', '');
  r.envios = sent; r.avisos = toasts;
  r.M1 = JSON.stringify(sent) === JSON.stringify([['kx', 'AA:BB:CC:DD:EE:01', true], ['ruta', 'nxbbbbbbbb', true]]);
  r.M3 = toasts.length === 1 && /^Austin (no te tiene como contacto|doesn't have you as a contact)/.test(toasts[0]) && /(acepte tu solicitud|accept your request)/.test(toasts[0]); // sin idioma elegido, t() da inglés
  const ok = r.M1 && r.M2 && r.M3;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LOSTME ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('LOSTME {"resultado":"FALLO","error":' + JSON.stringify(String(e && e.stack)) + '}'); process.exit(1); });
