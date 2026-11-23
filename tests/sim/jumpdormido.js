// 3315 (COLA 1, puente nativo con la app dormida): el nativo del puente dormido ya reenvía el paquete Jump al destino (JumpNativeTest),
// pero no anuncia rutas: sin internet el destino no tenía camino de vuelta para su ✓✓ y el que lo mandó seguía viendo ⏳ aunque el
// mensaje hubiera llegado. Ahora, si no hay ruta hacia el que lo mandó, la confirmación sale TAMBIÉN por el enlace por el que llegó el
// mensaje (el puente la reenvía); la cola de Jump sigue como siempre. Con ruta, o si el enlace no está listo o es de internet/Wi-Fi local, no.
// Uso: node jumpdormido.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'jumpdormido' };
  const noop = () => {};
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop;
  global.document = global.document || { addEventListener: noop, removeEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop }), body: { appendChild: noop }, documentElement: { style: {} }, visibilityState: 'visible' };
  const m = await importSrc('ui/ble_ack.js');
  const Cls = m.BleAckSystem;
  const S = 'nxssssssss';
  const caso = async (opts) => {
    const ack = Object.create(Cls.prototype);
    const escritos = [], cola = [];
    ack.ble = {
      localNexoId: 'nxcccccccc',
      relay: { sendRouted: (o) => cola.push(o), nextHop: () => (opts.ruta ? { deviceId: 'otro', direct: false } : null) },
      _sealObj: (to, o) => Promise.resolve({ v: 1, type: 'sx', to: to, msgId: o.msgId, x: 'sellado' }),
      _getDeviceState: () => ({ state: opts.listo === false ? 'connecting' : 'ready_to_chat' }),
      _sendMessageNative: (dev, json) => { escritos.push({ dev, p: JSON.parse(json) }); return Promise.resolve({ sent: true }); },
    };
    ack._sendRouted({ v: 1, type: 'ack', msgId: 'msg_1', from: 'nxcccccccc', to: S, ts: 1 }, opts.dev || 'AA:BB:CC:DD:EE:01');
    await new Promise((res) => setTimeout(res, 10));
    return { escritos, cola };
  };
  const sinRuta = await caso({});
  r.sin_ruta_por_el_enlace = sinRuta.escritos.length === 1 && sinRuta.escritos[0].dev === 'AA:BB:CC:DD:EE:01' && sinRuta.escritos[0].p.type === 'sx' && sinRuta.escritos[0].p.to === S;
  r.sin_ruta_tambien_cola = sinRuta.cola.length === 1;
  const conRuta = await caso({ ruta: true });
  r.con_ruta_solo_cola = conRuta.escritos.length === 0 && conRuta.cola.length === 1;
  const noListo = await caso({ listo: false });
  r.enlace_no_listo_no = noListo.escritos.length === 0 && noListo.cola.length === 1;
  const net = await caso({ dev: 'net:nxvvvvvvvv' });
  r.internet_no = net.escritos.length === 0;
  r.resultado = r.sin_ruta_por_el_enlace && r.sin_ruta_tambien_cola && r.con_ruta_solo_cola && r.enlace_no_listo_no && r.internet_no ? 'OK' : 'FALLO';
  console.log('JUMPDORMIDO ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('JUMPDORMIDO ' + JSON.stringify({ prueba: 'jumpdormido', error: String(e && e.stack || e).slice(0, 400), resultado: 'FALLO' })); process.exit(1); });
