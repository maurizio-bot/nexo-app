// Política de caminos, PASO 2 (dueño 04-11: «si hay Bluetooth, preparar Wi-Fi Direct»). Base JS (la parte que acelera de
// verdad —mantener el grupo WD caliente— es nativa y va aparte). Esta prueba comprueba la LÓGICA de decisión y el umbral
// DINÁMICO, y sobre todo que SIN preparar (estado de hoy) NADA cambia respecto del comportamiento actual.
// Uso: node wdprep.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'wdprep' };
  const { WifiDirect, WD_MIN_BYTES, WD_MIN_BYTES_READY } = await importSrc('ui/wifi_direct.js');

  const BMAC = 'bbbbbbbbbbbb';           // MAC del contacto B (normalizada, sin ':')
  const fakeBle = {
    localNexoId: 'nxa0000001', mtu: 185,                                           // MTU del enlace BT por defecto: sano
    _macToNexoId: new Map([[BMAC, 'nxb0000002']]),
    _resolveDeviceIdForNexoId(nx) { return nx === 'nxb0000002' ? BMAC : null; },   // solo B tiene Bluetooth directo
    _getDeviceState(dev) { return String(dev).toLowerCase() === BMAC ? { state: 'ready_to_chat' } : null; }, // y está vivo
    getMtu(dev) { return String(dev).toLowerCase() === BMAC ? this.mtu : 185; },   // MTU del BT (configurable en la prueba)
  };
  const mk = () => { const wd = Object.assign(new WifiDirect(fakeBle), { status: { supported: true, granted: true } }); wd.peers.add('nxb0000002'); return wd; };

  // ----- Umbral NORMAL (sin preparar) = comportamiento de HOY -----
  let wd = mk();
  r.grande_va_por_wd = wd.eligible(BMAC, 200000) === true;        // 200 KB ≥ 150 KB → WD, como siempre
  r.mediano_no_sin_preparar = wd.eligible(BMAC, 30000) === false; // 30 KB < 150 KB → NO (igual que hoy)
  r.sin_preparar_isready_false = wd._isWdReady('nxb0000002') === false;

  // ----- Decisión de preparar -----
  r.conviene_preparar_B = wd._shouldPrepareWD('nxb0000002') === true;   // B: soporta + BT directo vivo + no preparado
  r.no_prepara_sin_bt = wd._shouldPrepareWD('nxc0000003') === false;    // C: sin BT directo → no hay por dónde
  r.no_prepara_sin_soporte = (Object.assign(new WifiDirect(fakeBle), { status: { supported: false } }))._shouldPrepareWD('nxb0000002') === false;

  // ----- Con WD PREPARADO (lo marcará el nativo; acá lo simulamos) el umbral BAJA -----
  wd._setWdReady('nxb0000002');
  r.preparado_isready = wd._isWdReady('nxb0000002') === true;
  r.mediano_si_preparado = wd.eligible(BMAC, 30000) === true;     // 30 KB ≥ 20 KB → ahora sí WD
  r.chico_no_aunque_preparado = wd.eligible(BMAC, 10000) === false; // 10 KB < 20 KB → sigue sin WD
  r.ya_preparado_no_reprepara = wd._shouldPrepareWD('nxb0000002') === false;

  // ----- Liberación: soltar el «preparado» devuelve el umbral normal -----
  wd._dropWdReady('nxb0000002');
  r.soltar_sube_umbral = wd.eligible(BMAC, 30000) === false;

  // ----- Se suelta también al fallar (noteFail) y al dejar de estar disponible (unmarkPeer) -----
  wd._setWdReady('nxb0000002'); wd.noteFail('nxb0000002');
  r.fallo_suelta = wd._isWdReady('nxb0000002') === false;
  const wd2 = mk(); wd2._setWdReady('nxb0000002'); wd2.unmarkPeer('nxb0000002');
  r.unmark_suelta = wd2._isWdReady('nxb0000002') === false;

  // ----- TTL: un «preparado» vencido ya no cuenta -----
  const wd3 = mk(); wd3._setWdReady('nxb0000002', -1);
  r.ttl_vencido = wd3._isWdReady('nxb0000002') === false;

  r.constantes = (WD_MIN_BYTES === 100000 && WD_MIN_BYTES_READY === 20000); // 3023: el mínimo baja a 100 000 (dueño 12-11)

  // ----- PASO 1 (dueño 05-11): BT en MTU MÍNIMO (23) → WD para archivos MEDIANOS aunque NO esté preparado (esquivar el BT
  // lento del diagnóstico). Usa el Wi-Fi Direct que YA existe; si falla, cae a Bluetooth. Apagable con NEXO_WD_TINY. -----
  fakeBle.mtu = 23;
  const wdt = mk();
  r.bt_lento_mediano_por_wd = wdt.eligible(BMAC, 30000) === true;   // 30 KB por WD porque el BT va a 23 (lentísimo)
  r.bt_lento_chico_no = wdt.eligible(BMAC, 10000) === false;        // 10 KB sigue sin WD (no compensa montar el grupo)
  fakeBle.mtu = 185;
  r.bt_sano_mediano_no = wdt.eligible(BMAC, 30000) === false;       // con BT sano (185) el mediano NO va por WD (como hoy)
  global.window = { NEXO_WD_TINY: false }; fakeBle.mtu = 23;
  r.interruptor_apaga = wdt.eligible(BMAC, 30000) === false;        // NEXO_WD_TINY=false desactiva el atajo
  delete global.window; fakeBle.mtu = 185;

  const ok = r.grande_va_por_wd && r.mediano_no_sin_preparar && r.sin_preparar_isready_false && r.conviene_preparar_B &&
    r.no_prepara_sin_bt && r.no_prepara_sin_soporte && r.preparado_isready && r.mediano_si_preparado &&
    r.chico_no_aunque_preparado && r.ya_preparado_no_reprepara && r.soltar_sube_umbral && r.fallo_suelta &&
    r.unmark_suelta && r.ttl_vencido && r.constantes &&
    r.bt_lento_mediano_por_wd && r.bt_lento_chico_no && r.bt_sano_mediano_no && r.interruptor_apaga;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WDPREP ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('WDPREP FALLO:', e && e.stack); process.exit(1); });
