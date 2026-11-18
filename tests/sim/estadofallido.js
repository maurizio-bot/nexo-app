// 3236 (diagnóstico del dueño 18-11: tres textos a un contacto salieron «entregado» y 8 s después «fallido»): un mensaje que el otro ya
// confirmó (entregado/leído) no puede pasar a «fallido» en pantalla; uno que aún no se confirmó sí. Función pura.
// Uso: node estadofallido.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'estadofallido' };
  const { _canUpgradeStatus } = await importSrc('ui/chat_format.js');
  r.entregado_no_pasa_a_fallido = _canUpgradeStatus('delivered', 'failed') === false;
  r.leido_no_pasa_a_fallido = _canUpgradeStatus('read', 'failed') === false;
  r.enviando_si_falla = _canUpgradeStatus('sending', 'failed') === true;
  r.enviado_si_falla = _canUpgradeStatus('sent', 'failed') === true;
  r.sin_estado_si_falla = _canUpgradeStatus(null, 'failed') === true;
  r.fallido_se_recupera = _canUpgradeStatus('failed', 'sent') === true;
  r.no_degrada_entregado = _canUpgradeStatus('delivered', 'sent') === false;
  r.resultado = Object.keys(r).filter((k) => k !== 'prueba').every((k) => r[k] === true) ? 'OK' : 'FALLO';
  console.log('ESTADOFALLIDO ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})();
