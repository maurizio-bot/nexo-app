// Lentitud en Bluetooth (#dueño 07-11, diag. del S24 Ultra): el respaldo Fénix martillaba un custodio con el enlace ATASCADO
// (sendFile type=fenix una y otra vez, «Cola llena» / «Max window retries»), congestionando la radio y retrasando los chats
// (texto «entregado en 11 s» con 5 reintentos vs 261 ms con la radio libre). Arreglo: `_fenixSkipHolder` (fenix.js), usado en
// el reparto de segmentos, SALTA a un custodio atascado — por cooldown tras un fallo, o si su único camino es un Bluetooth
// muerto (dev real + isDead); por internet/Wi-Fi (dev virtual «net…»/«lan…») NUNCA salta. Prueba de la función pura.
// Uso: node fenixcong.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'fenixcong' };
  const { _fenixSkipHolder } = await importSrc('fenix/fenix.js');
  const NOW = 1000000000000, COLD = NOW + 300000; // cooldown que vence en 5 min

  // (1) Sin cooldown y Bluetooth SANO: no se salta (respaldo normal).
  r.bt_sano_no_salta = _fenixSkipHolder(NOW, 0, '7c10154b3752', false) === false;
  // (2) Sin cooldown y Bluetooth MUERTO/atascado: se salta (no martillar la radio).
  r.bt_muerto_salta = _fenixSkipHolder(NOW, 0, '7c10154b3752', true) === true;
  // (3) Internet (dev virtual «net…»), aunque isDead: NUNCA se salta (por ahí va rápido y no estorba).
  r.internet_no_salta = _fenixSkipHolder(NOW, 0, 'netnx1e50c95d', true) === false;
  // (4) Wi-Fi (dev virtual «lan…»), aunque isDead: tampoco se salta.
  r.wifi_no_salta = _fenixSkipHolder(NOW, 0, 'lannx1e50c95d', true) === false;
  // (5) Cooldown ACTIVO (falló hace poco): se salta aunque el Bluetooth parezca sano.
  r.cooldown_salta = _fenixSkipHolder(NOW, COLD, '7c10154b3752', false) === true;
  // (6) Cooldown VENCIDO + Bluetooth sano: vuelve a intentar (no se salta).
  r.cooldown_vencido_reintenta = _fenixSkipHolder(COLD + 1, COLD, '7c10154b3752', false) === false;
  // (7) Robustez: coldUntil 0/undefined y dev vacío → no se salta (sin señales de atasco).
  r.sin_senales_no_salta = _fenixSkipHolder(NOW, undefined, '', false) === false;
  // (8) Cooldown activo gana aunque sea internet (si justo falló, igual conviene esperar un toque).
  r.cooldown_gana_internet = _fenixSkipHolder(NOW, COLD, 'netnx1e50c95d', false) === true;

  const ok = r.bt_sano_no_salta && r.bt_muerto_salta && r.internet_no_salta && r.wifi_no_salta &&
    r.cooldown_salta && r.cooldown_vencido_reintenta && r.sin_senales_no_salta && r.cooldown_gana_internet;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXCONG ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FENIXCONG FALLO:', e && e.stack); process.exit(1); });
