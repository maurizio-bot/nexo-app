// P8 (diagnóstico real 01-11, dueño): «[WIFI-DIRECT] Disponible (falta permiso)». El permiso ya estaba cableado, pero solo
// se pedía al INTENTAR una transferencia grande; si el usuario no estaba cerca en ese momento, se perdía el envío rápido.
// Mejora UX: al ver el 1er contacto cercano con Wi-Fi Direct (markPeer), pedir el permiso de forma PROACTIVA una sola vez
// por sesión, para tenerlo listo. Esta prueba comprueba la decisión `_shouldAskPermNow` y que markPeer la dispara una vez.
// Uso: node wdperm.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'wdperm' };
  const { WifiDirect } = await importSrc('ui/wifi_direct.js');
  const mk = (status, over) => Object.assign(new WifiDirect({ localNexoId: 'nxa0000001' }), over || {}, status ? { status: status } : {});

  // soportado, sin conceder, sin denegar, sin pedir → SÍ pedir
  r.soporta_sin_permiso_pide = mk({ supported: true, granted: false })._shouldAskPermNow() === true;
  // ya concedido → NO
  r.concedido_no = mk({ supported: true, granted: true })._shouldAskPermNow() === false;
  // denegado → NO
  r.denegado_no = mk({ supported: true, granted: false }, { denied: true })._shouldAskPermNow() === false;
  // ya se pidió (lazy) → NO
  r.ya_pedido_no = mk({ supported: true, granted: false }, { _asked: true })._shouldAskPermNow() === false;
  // sin status todavía (no inicializado) → NO (no soporta aún)
  r.sin_status_no = (new WifiDirect({ localNexoId: 'nxa0000001' }))._shouldAskPermNow() === false;

  // markPeer de un contacto nuevo con Wi-Fi Direct dispara la petición proactiva UNA vez
  const wd = mk({ supported: true, granted: false });
  wd.markPeer('nxb0000002');
  r.markpeer_dispara = wd._permProactive === true && wd.peers.has('nxb0000002');
  // tras dispararse, ya no vuelve a pedir (ni por otro contacto)
  r.no_repite = wd._shouldAskPermNow() === false;
  wd.markPeer('nxc0000003'); // otro contacto: no debe re-programar
  r.otro_contacto_no_repite = wd._permProactive === true; // sigue true, no re-pide (no hay forma de contar aquí, pero _shouldAskPermNow ya daba false)

  const ok = r.soporta_sin_permiso_pide && r.concedido_no && r.denegado_no && r.ya_pedido_no && r.sin_status_no &&
    r.markpeer_dispara && r.no_repite && r.otro_contacto_no_repite;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WDPERM ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('WDPERM FALLO:', e && e.stack); process.exit(1); });
