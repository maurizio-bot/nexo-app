// P2 (diagnóstico real 01-11, pedido del dueño): al ABRIR el chat con un contacto DORMIDO por Android no se mandaba el
// «toque» FCM; el toque solo salía AL ENVIAR. Resultado: el 1er mensaje esperaba (o se perdía) y el subtítulo quedaba
// VACÍO (no se veía el tipo de conexión). Arreglo: openChat llama a `_wakeSleepingPeer`, que si NO hay enlace vivo pide
// `net.wakeFor(nx)` (toque FCM si tenemos su token y hay internet) y marca «despertando» para que el subtítulo muestre
// «Conectando…» hasta que llega la presencia del otro. Esta prueba comprueba el gate de forma determinista (sin red real).
// Uso: node wakeopen.js
'use strict';
(async () => {
  const r = { prueba: 'wakeopen' };
  const { BLE_LINK_METHODS } = await import('../../src/ui/ble_links.js');
  const { NetLink } = await import('../../src/net/net_link.js');

  // --- 1) _wakeSleepingPeer: decide si despertar según el enlace actual ---
  function mkSelf(via, wakeOk) {
    var calls = [];
    return {
      _calls: calls,
      linkOf: function () { return via; },
      net: { wakeFor: function (nx) { calls.push(nx); return wakeOk; } },
    };
  }
  // Dormido (sin enlace) y con token → lanza el toque y queda «waking»
  var s1 = mkSelf('none', true);
  var v1 = BLE_LINK_METHODS._wakeSleepingPeer.call(s1, 'nxb0000002');
  r.dormido_toca = v1 === 'waking' && s1._calls.length === 1;
  r.dormido_marca_waking = BLE_LINK_METHODS.isWaking.call(s1, 'nxb0000002') === true;
  r.isWaking_otro_no = BLE_LINK_METHODS.isWaking.call(s1, 'nxc0000003') === false;
  // Ya hay enlace (Wi-Fi / Bluetooth / internet) → NO despierta
  var s2 = mkSelf('wifi', true);
  var v2 = BLE_LINK_METHODS._wakeSleepingPeer.call(s2, 'nxb0000002');
  r.con_wifi_no_toca = v2 === 'wifi' && s2._calls.length === 0;
  var s2b = mkSelf('internet', true);
  r.con_internet_no_toca = BLE_LINK_METHODS._wakeSleepingPeer.call(s2b, 'nxb0000002') === 'internet' && s2b._calls.length === 0;
  var s2c = mkSelf('bluetooth', true);
  r.con_bt_no_toca = BLE_LINK_METHODS._wakeSleepingPeer.call(s2c, 'nxb0000002') === 'bluetooth' && s2c._calls.length === 0;
  // Dormido pero sin a quién despertar (sin token) → intenta pero no queda «waking»
  var s3 = mkSelf('none', false);
  var v3 = BLE_LINK_METHODS._wakeSleepingPeer.call(s3, 'nxb0000002');
  r.sin_token_no_waking = v3 === 'none' && s3._calls.length === 1 && BLE_LINK_METHODS.isWaking.call(s3, 'nxb0000002') === false;
  // «waking» caduca (>30 s) → el subtítulo vuelve a vacío (no se queda «Conectando…» para siempre)
  var s4 = mkSelf('none', true);
  BLE_LINK_METHODS._wakeSleepingPeer.call(s4, 'nxb0000002');
  s4._wakingPeer.t -= 31000;
  r.waking_caduca = BLE_LINK_METHODS.isWaking.call(s4, 'nxb0000002') === false;

  // --- 2) NetLink.wakeFor: solo con token + internet; reusa _wake (toque FCM) ---
  var fetches = 0;
  var realFetch = global.fetch;
  global.fetch = function () { fetches++; return Promise.resolve({ status: 200 }); };
  try {
    var net = new NetLink({ localNexoId: 'nxa0000001' });
    net.state.senderUrl = 'https://example.test/wake';
    // con token + online → true y manda el toque (una vez)
    net.peers.set('nxb0000002', { fcmToken: 'token-de-prueba-0123456789', up: false });
    net.online = function () { return true; };
    r.wakefor_con_token = net.wakeFor('nxb0000002') === true;
    r.wakefor_manda_toque = fetches === 1;
    // sin token → false y no manda nada
    fetches = 0;
    net.peers.set('nxd0000004', { up: false });
    r.wakefor_sin_token = net.wakeFor('nxd0000004') === false && fetches === 0;
    // con token pero SIN internet → false (no tiene sentido decir «Conectando…»)
    fetches = 0;
    net.online = function () { return false; };
    net.peers.set('nxe0000005', { fcmToken: 'otro-token-0123456789abcd', up: false });
    r.wakefor_offline_no = net.wakeFor('nxe0000005') === false && fetches === 0;
  } finally {
    if (realFetch) global.fetch = realFetch; else { try { delete global.fetch; } catch (e) {} }
  }

  const ok = r.dormido_toca && r.dormido_marca_waking && r.isWaking_otro_no && r.con_wifi_no_toca &&
    r.con_internet_no_toca && r.con_bt_no_toca && r.sin_token_no_waking && r.waking_caduca &&
    r.wakefor_con_token && r.wakefor_manda_toque && r.wakefor_sin_token && r.wakefor_offline_no;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WAKEOPEN ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('WAKEOPEN FALLO:', e && e.stack); process.exit(1); });
