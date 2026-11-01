// P4/#129 (diagnóstico real 01-11, dueño): «Cola de escritura llena» (BLE_BUSY) 141× en el log. La cola nativa de
// escritura (con MTU 23 cada mensajito son ~26 escrituras) se llena y drena despacio; eso NO es un fallo del enlace, es
// CONTRAPRESIÓN. Antes el ChatStream lo trataba como fallo de envío: sumaba a _nativeFails → a los 3 intentaba CAMBIAR de
// enlace y a los 120 ABORTABA como PEER_ABSENT, aunque el enlace estuviera SANO. Arreglo: BLE_BUSY se trata como
// contrapresión — esperar más (600→1200→2400 ms) y reintentar el MISMO trozo, sin contar como fallo; solo si NINGÚN trozo
// pasa en ~5 min seguidos se deja pendiente. Prueba de las funciones puras `_isBusyErr`/`_busyBackoffMs`. Uso: node busyback.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'busyback' };
  const { _isBusyErr, _busyBackoffMs } = await importSrc('ui/ble_ack.js');

  // _isBusyErr: solo true para BLE_BUSY (cola llena); un fallo real del enlace (WRONG_PEER, genérico) NO.
  r.busy_si = _isBusyErr({ code: 'BLE_BUSY' }) === true;
  r.wrongpeer_no = _isBusyErr({ code: 'WRONG_PEER' }) === false;
  r.generico_no = _isBusyErr(new Error('x')) === false;
  r.nulo_no = _isBusyErr(null) === false && _isBusyErr(undefined) === false;

  // _busyBackoffMs: espera escalonada 600 → 1200 → 2400 (tope 2400), para dar tiempo a drenar la cola MTU-23.
  r.back_1 = _busyBackoffMs(1) === 600;
  r.back_2 = _busyBackoffMs(2) === 1200;
  r.back_3 = _busyBackoffMs(3) === 2400;
  r.back_4_tope = _busyBackoffMs(4) === 2400;
  r.back_10_tope = _busyBackoffMs(10) === 2400;
  // dentro del límite sigue reintentando (no abandona el enlace sano); pasado el límite (~5 min saturado) se rinde (-1)
  r.back_150_sigue = _busyBackoffMs(150) === 2400;
  r.back_151_rinde = _busyBackoffMs(151) === -1;
  r.back_1000_rinde = _busyBackoffMs(1000) === -1;

  const ok = r.busy_si && r.wrongpeer_no && r.generico_no && r.nulo_no &&
    r.back_1 && r.back_2 && r.back_3 && r.back_4_tope && r.back_10_tope && r.back_150_sigue && r.back_151_rinde && r.back_1000_rinde;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BUSYBACK ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('BUSYBACK FALLO:', e && e.stack); process.exit(1); });
