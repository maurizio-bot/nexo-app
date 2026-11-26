// 3328 (diagnóstico automático de Roberto, build 3146, 24-11 10:42–10:44 hora de México): un texto pendiente a Zhelowsky con el
// Bluetooth roto caía a internet y los relés lo rechazaban («rate-limited: too many gift wraps», «slow down matey»); la vuelta de
// reenvío no esperaba (solo esperaba lo que «no confirma») y mandaba otro sobre cada ~12 s, lo que alarga el castigo de los relés.
// _resendWaitErr: el límite de los relés también pide esperar (15 s → 2 min). Contraprueba 3327: rate-limited = false.
// Uso: node reenviolimite.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'reenviolimite' };
  const { _resendWaitErr } = await importSrc('ui/ble_helpers.js');
  const rej = (m) => Object.assign(new Error('Rechazado por los relés: ' + m), { code: 'NET_REJECTED' });
  r.ack_timeout_espera = _resendWaitErr(new Error('ACK timeout msgId=x')) === true;
  r.buzon_espera = _resendWaitErr({ code: 'IN_MAILBOX', message: 'ya en el buzón' }) === true;
  r.rate_limited_espera = _resendWaitErr(rej('rate-limited: too many gift wraps from this address, try again later')) === true;
  r.slow_down_espera = _resendWaitErr(rej('rate-limited: slow down matey')) === true;
  r.banned_espera = _resendWaitErr(rej('banned: too many rate-limit violations, try again later')) === true; // 3347
  r.otro_rechazo_no = _resendWaitErr(rej('blocked: pow required')) === false;
  r.otro_fallo_no = _resendWaitErr(new Error('Contacto no disponible: queda pendiente')) === false && _resendWaitErr(null) === false;
  const ok = Object.keys(r).filter((k) => k !== 'prueba').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REENVIOLIMITE ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REENVIOLIMITE {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
