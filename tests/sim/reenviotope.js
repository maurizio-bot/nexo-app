// COLA 28: tope y espera creciente de reenvío por mensaje (función pura). Uso: node reenviotope.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const { _resendThrottle } = await importSrc('ui/ble_helpers.js');
  const r = { prueba: 'reenviotope' }, memo = {};
  r.tres_primeras_salen = !_resendThrottle(memo, 'a', 0) && !_resendThrottle(memo, 'a', 1) && !_resendThrottle(memo, 'a', 2);
  r.cuarta_espera = _resendThrottle(memo, 'a', 3000) === true;
  r.sale_tras_15s = _resendThrottle(memo, 'a', 20000) === false;
  r.luego_espera_30s = _resendThrottle(memo, 'a', 40000) === true && _resendThrottle(memo, 'a', 52000) === false;
  r.otro_id_libre = _resendThrottle(memo, 'b', 3000) === false;
  const m2 = { z: { n: 40, tl: 0 } };
  r.tope_5min = _resendThrottle(m2, 'z', 299000) === true && _resendThrottle(m2, 'z', 301000) === false;
  r.resultado = Object.keys(r).every(k => k === 'prueba' || r[k] === true) ? 'OK' : 'FALLO';
  console.log('REENVIOTOPE ' + JSON.stringify(r)); process.exit(r.resultado === 'OK' ? 0 : 1);
})();
