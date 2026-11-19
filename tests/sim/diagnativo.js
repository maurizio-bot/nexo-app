// 3245: el registro nativo del diagnóstico conserva las líneas clave (toque FCM, vuelve sola, escucha sin la app) aunque
// los latidos del Bluetooth las hayan empujado fuera de las últimas 150 líneas.
const fs = require('fs'), path = require('path'), os = require('os');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/ui/diag_native.js'), 'utf8');
  const tmp = path.join(os.tmpdir(), 'diag_native_' + process.pid + '.mjs'); fs.writeFileSync(tmp, src);
  const { nativeDiagText } = await import(tmp); fs.unlinkSync(tmp);
  const L = [];
  L.push('11-18 21:16:25.000 [INFO][FCM] Despierta recibido (data=1, prio=1/1)');
  L.push('11-18 21:16:25.100 [INFO][VUELVE] NEXO vuelve sola tras un toque');
  L.push('11-18 21:16:26.000 [INFO][NET] Internet sin la app: escuchando 2 contacto(s) en 4 relé(s)');
  L.push('11-18 21:16:27.000 [INFO][NET] sobre de nx1n36c283 (msgId m1): aviso de mensaje nuevo por internet');
  for (let i = 0; i < 300; i++) L.push('11-18 21:2' + (i % 10) + ':00.000 [INFO][GATT_SERVER] RX chunk from AA len=108');
  const t = nativeDiagText(L.join('\n'));
  const r = {
    toque: /Despierta recibido/.test(t), vuelve: /vuelve sola/.test(t), escucha: /Internet sin la app/.test(t), sobre: /sobre de nx1n36c283/.test(t),
    cola_150: (t.match(/RX chunk/g) || []).length === 150, vacio: nativeDiagText('') === '',
    corto_sin_cabecera_extra: !/--- antes/.test(nativeDiagText(L.slice(0, 4).join('\n'))),
  };
  r.resultado = Object.keys(r).every(k => r[k] === true) ? 'OK' : 'FALLO';
  console.log('DIAGNATIVO ' + JSON.stringify(r));
})();
