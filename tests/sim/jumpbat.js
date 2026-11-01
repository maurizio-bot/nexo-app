// P7 (diagnóstico real 01-11, dueño): el puente JUMP dejaba de reenviar al 82 % de batería porque el MODO-AHORRO del
// sistema estaba activo (en el log: «[JUMP] Batería baja (82 %, ahorro): dejo de hacer de puente»), y eso rompió una
// ruta a mitad de la videollamada. Además el texto decía «batería baja» al 82 %. Arreglo: el modo-ahorro ya no para el
// puente por sí solo; solo manda la batería (en ahorro se pide 30 %, sin ahorro 15 %), y el texto del registro dice el
// motivo real. Prueba determinista de canRelay()/_relayStopReason(). Uso: node jumpbat.js
'use strict';
(async () => {
  const r = { prueba: 'jumpbat' };
  const { BleRelay } = await import('../../src/ui/ble_relay.js');
  const relay = new BleRelay({ localNexoId: 'nxa0000001' });
  const set = (level, powerSave, charging) => { relay.power = { level: level, charging: !!charging, powerSave: !!powerSave, ts: Date.now() }; };

  // EL FALLO del dueño: 82 % + ahorro → ANTES false; AHORA debe hacer de puente
  set(82, true, false);
  r.alto_con_ahorro_si = relay.canRelay() === true;
  // 82 % sin ahorro → sí
  set(82, false, false);
  r.alto_sin_ahorro_si = relay.canRelay() === true;
  // cargando aunque haya ahorro y poca batería → sí (nunca estorba cargar)
  set(5, true, true);
  r.cargando_si = relay.canRelay() === true;
  // 25 % + ahorro → NO (en ahorro se pide 30 %: conservador con poca batería)
  set(25, true, false);
  r.medio_con_ahorro_no = relay.canRelay() === false;
  r.motivo_ahorro = relay._relayStopReason() === 'Ahorro de energía (25 %)';
  // 25 % sin ahorro → sí (umbral normal 15 %)
  set(25, false, false);
  r.medio_sin_ahorro_si = relay.canRelay() === true;
  // 10 % → NO en cualquier caso (batería baja de verdad)
  set(10, false, false);
  r.bajo_no = relay.canRelay() === false;
  r.motivo_bajo = relay._relayStopReason() === 'Batería baja (10 %)';
  set(10, true, false);
  r.bajo_con_ahorro_no = relay.canRelay() === false;
  // sin dato de batería (level < 0) → no bloquear (compat.)
  set(-1, true, false);
  r.sin_dato_si = relay.canRelay() === true;

  const ok = r.alto_con_ahorro_si && r.alto_sin_ahorro_si && r.cargando_si && r.medio_con_ahorro_no &&
    r.motivo_ahorro && r.medio_sin_ahorro_si && r.bajo_no && r.motivo_bajo && r.bajo_con_ahorro_no && r.sin_dato_si;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('JUMPBAT ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('JUMPBAT FALLO:', e && e.stack); process.exit(1); });
