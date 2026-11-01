// P1 (diagnóstico real 01-11, pedido del dueño): la VIDEOLLAMADA por INTERNET no transmitía vídeo. Causa: calls.js solo
// dejaba salir los fotogramas de vídeo por Wi-Fi (lan:); por net: se descartaban TODOS (en el log: audio 4172 frames OK
// pero «vídeo enviado 0»). Arreglo: el vídeo sale por lan: y por net: cuando es Tor DIRECTO (net.via==='tor'); por relés
// no (los inundaría y llegaría con retraso), ni por Bluetooth. Esta prueba comprueba el gate `_videoLinkOk` de forma
// determinista (sin red real). Uso: node netvideo.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'netvideo' };
  const { createCalls } = await importSrc('ui/calls.js');

  // net.via(nx) controlable; el resto del ble, lo mínimo que toca el gate.
  var viaVal = 'relés';
  const ble = {
    localNexoId: 'nxa0000001',
    net: { via: function () { return viaVal; }, canReach: function () { return true; } },
    lan: { canReach: function () { return false; }, quality: function () { return { up: false }; } },
    _bleReadyFor: function () { return null; },
  };
  const calls = createCalls(ble, function () { return { start: function () { return Promise.resolve({}); } }; });

  // Wi-Fi misma red: el vídeo SIEMPRE puede
  r.lan_ok = calls._videoLinkOk('lan:nxb0000002', 'nxb0000002') === true;
  // Internet por Tor DIRECTO: el vídeo puede
  viaVal = 'tor';
  r.net_tor_ok = calls._videoLinkOk('net:nxb0000002', 'nxb0000002') === true;
  // Internet por RELÉS: el vídeo NO (inservible con 15 fps); el audio seguiría aparte
  viaVal = 'relés';
  r.net_reles_no = calls._videoLinkOk('net:nxb0000002', 'nxb0000002') === false;
  // Bluetooth (una MAC): el vídeo NO cabe
  r.bt_no = calls._videoLinkOk('aa:bb:cc:dd:ee:ff', 'nxb0000002') === false;
  // Sin enlace: NO
  r.sin_enlace_no = calls._videoLinkOk(null, 'nxb0000002') === false;
  // canVideo sigue permisivo por internet (para PODER iniciar la videollamada; el audio va enseguida)
  // (no dependemos de _link aquí; solo comprobamos el gate de fotogramas, que es lo que fallaba)

  const ok = r.lan_ok && r.net_tor_ok && r.net_reles_no && r.bt_no && r.sin_enlace_no;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NETVIDEO ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('NETVIDEO FALLO:', e && e.stack); process.exit(1); });
