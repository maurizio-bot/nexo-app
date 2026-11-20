// 3258 (dueño 20-11: «cuando entre el Wi-Fi Direct, sí o sí me va a aparecer en el diagnóstico y tendré datos reales»): el diagnóstico lleva las
// medidas del día de Wi-Fi Direct, de los DOS lados (quien envía y quien recibe), solo números:
//  M1  contadores: intentos y salidos por lado, fallos con su causa, tiempo trabajando
//  M2  tiempos: crear el grupo (con reintentos del sistema y su código), unirse, velocidad PURA de la transferencia
//  M3  efecto sobre el Wi-Fi normal: seguía conectado / cambió de canal / se cayó / no había Wi-Fi
//  M4  por qué sí o no Wi-Fi Direct en un archivo (_whyNot): tamaño, Bluetooth lento (MTU 23), el otro no lo anuncia, sin enlace, ocupado, castigo, Wi-Fi apagado…
//  M5  recibir: un fallo del socket («Accept timed out») y un archivo grande que termina mal quedan con su causa; uno bueno suma «salió»
//  M6  nada se anota si lo que llega no es válido, y sin window.NEXO_noteWd nada se rompe
// Contraprueba 3257: no existía usageNoteWd.
// Uso: node wdmedidas.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'wdmedidas' };
  const noop = () => {};
  const mem = {};
  global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop; global.window.dispatchEvent = noop;
  global.document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' };
  global.window.Capacitor = { Plugins: {} };
  const olog = console.log, owarn = console.warn; console.log = noop; console.warn = noop;
  try {
    const us = await importSrc('ui/usage_stats.js');
    const wdm = await importSrc('ui/wifi_direct.js');
    r.existe = typeof us.usageNoteWd === 'function' && typeof global.window.NEXO_noteWd === 'function';
    const lines = () => us.usageSpeedLines().join('\n');

    // M1-M3: un día de Wi-Fi Direct
    const n = us.usageNoteWd;
    [1, 2, 3].forEach(() => n('try', { dir: 'out' }));
    n('ok', { dir: 'out', act: 8000 }); n('ok', { dir: 'out', act: 6000 });
    n('fail', { dir: 'out', cause: 'no se pudo conectar al grupo', act: 5000 });
    n('try', { dir: 'in' }); n('try', { dir: 'in' });
    n('ok', { dir: 'in', act: 9000 });
    n('fail', { dir: 'in', cause: 'el otro no llegó a conectar (90 s)', act: 90000 });
    n('group', { ms: 4200, attempts: 3, reasons: '2,2,' }); n('group', { ms: 1800, attempts: 1, reasons: '' });
    n('join', { ms: 3000 }); n('join', { ms: 5000 });
    n('xfer', { bytes: 600 * 1024, ms: 4000 }); n('xfer', { bytes: 900 * 1024, ms: 3000 });
    n('ap', { before: 5180, after: 5180 }); n('ap', { before: 5180, after: 5745 }); n('ap', { before: 5180, after: 0 }); n('ap', { before: 0, after: 0 });
    n('use', { why: 'tamaño' }); n('use', { why: 'tamaño' }); n('use', { why: 'Bluetooth lento (MTU 23)' });
    n('no', { why: 'el otro no lo anuncia' });
    const L = lines();
    r.M1 = /Wi-Fi Direct hoy: enviar 3 \(salieron 2, fallaron 1: no se pudo conectar al grupo ×1\) · recibir 2 \(salieron 1, fallaron 1: el otro no llegó a conectar \(90 s\) ×1\)/.test(L) && /trabajando 2 min en total/.test(L);
    r.M2 = /crear el grupo \(quien recibe\) 3 s \(2 veces, de 1,8 a 4,2\), 2 reintento\(s\) del sistema con código 2 ×2/.test(L) && /unirse al grupo \(quien envía\) 4 s \(2 veces, de 3 a 5\)/.test(L)
      && /velocidad pura de la transferencia 214,3 KB\/s \(2 veces, de 150 a 300\)/.test(L);
    r.M3 = /seguía conectado 2 \(cambió de canal 1\) · se cayó 1 · no había Wi-Fi 1/.test(L);
    r.M3_lineas = L.split('\n').filter((l) => /Wi-Fi Direct/.test(l)).map((l) => l.substring(0, 200));

    // M4: _whyNot
    const mtuOf = { v: 517 };
    const links = new Map(); const macs = new Map([['aabbccddee01', 'nx1aaaaaaa']]);
    const ble = { localNexoId: 'nx1zzzzzzz', _macToNexoId: macs, _getDeviceState: (d) => ({ state: links.get(d) || 'disconnected' }), getMtu: () => mtuOf.v, ackSystem: null };
    const wd = new wdm.WifiDirect(ble);
    const dev = 'AA:BB:CC:DD:EE:01';
    r.M4a = wd._whyNot(dev, 150000).no === 'este teléfono no lo tiene';
    wd.status = { supported: true, granted: true, wifiOn: true };
    r.M4b = wd._whyNot(dev, 150000).no === 'el otro no lo anuncia';
    wd.peers.add('nx1aaaaaaa');
    r.M4c = wd._whyNot(dev, 150000).no === 'sin enlace Bluetooth directo';
    links.set(dev, 'ready_to_chat');
    r.M4d = wd._whyNot(dev, 150000).use === 'tamaño';
    r.M4e = /archivo chico/.test(wd._whyNot(dev, 30000).no || '');
    mtuOf.v = 23; r.M4f = wd._whyNot(dev, 30000).use === 'Bluetooth lento (MTU 23)'; mtuOf.v = 517;
    wd.status.wifiOn = false; r.M4g = wd._whyNot(dev, 150000).no === 'Wi-Fi apagado aquí'; wd.status.wifiOn = true;
    wd.busy = true; r.M4h = /ocupado/.test(wd._whyNot(dev, 150000).no); wd.busy = false;
    wd.failUntil['nx1aaaaaaa'] = Date.now() + 60000; r.M4i = /castigo/.test(wd._whyNot(dev, 150000).no); wd.failUntil = {};
    r.M4j = /demasiado grande/.test(wd._whyNot(dev, wdm.WD_MAX_BYTES + 1).no);
    // noteChoice: solo desde 20 KB y suma en el contador del día
    const before = lines(); wd.noteChoice(dev, 5000); const same = lines() === before; wd.noteChoice(dev, 150000);
    r.M4k = same && /elegido por tamaño ×3/.test(lines());

    // M5: recibir (cada intento anota su «try» al aceptar la oferta)
    for (let i = 0; i < 4; i++) us.usageNoteWd('try', { dir: 'in' });
    wd.incoming.set('t1', { meta: {}, deviceId: dev, from: 'nx1aaaaaaa', ts: Date.now() - 5000, apStart: 5180 });
    wd._onReceived({ transferId: 't1', error: 'Accept timed out' });
    wd.incoming.set('t2', { meta: {}, deviceId: dev, from: 'nx1aaaaaaa', ts: Date.now() - 7000, big: true });
    wd.busy = true; wd.bigFinished('t2', false, 'Envío fallido: sin confirmación');
    wd.incoming.set('t3', { meta: {}, deviceId: dev, from: 'nx1aaaaaaa', ts: Date.now() - 4000, big: true });
    wd.busy = true; wd.bigFinished('t3', true, undefined);
    wd.incoming.set('t4', { meta: {}, deviceId: dev, from: 'nx1aaaaaaa', ts: Date.now() - 3000, apStart: 5180 });
    wd._onReceived({ transferId: 't4', data: 'x'.repeat(2000), bytes: 2000, readMs: 500, apMhz: 5180 });
    const L2 = lines();
    r.M5_error_socket = /el otro no llegó a conectar \(90 s\) ×2/.test(L2);
    r.M5_grande_falla = /envío cortado ×1/.test(L2);
    r.M5_suma_ok = /recibir 6 \(salieron 3, fallaron 3: el otro no llegó a conectar \(90 s\) ×2, envío cortado ×1\)/.test(L2);
    r.M5_sin_resultado = (() => { us.usageNoteWd('try', { dir: 'out' }); return /enviar 4 \(salieron 2, fallaron 1: no se pudo conectar al grupo ×1, sin resultado 1\)/.test(lines()); })();
    r.M5_lineas = L2.split('\n').filter((l) => /Wi-Fi Direct hoy/.test(l)).map((l) => l.substring(0, 260));
    r.M5_sin_bigFinished_ajeno = (() => { const b = lines(); wd.bigFinished('no-existe', true); return lines() === b; })();

    // M6: robustez
    const keep = global.window.NEXO_noteWd; delete global.window.NEXO_noteWd;
    let ok6 = true; try { wd.incoming.set('t5', { meta: {}, deviceId: dev, from: 'x', ts: Date.now() }); wd._onReceived({ transferId: 't5', error: 'x' }); wd.noteChoice(dev, 150000); } catch (e) { ok6 = false; }
    global.window.NEXO_noteWd = keep;
    const b6 = lines(); us.usageNoteWd('cosa-rara', {}); us.usageNoteWd('xfer', { bytes: -1, ms: 0 }); us.usageNoteWd('group', {});
    r.M6 = ok6 && lines() === b6;
  } finally { console.log = olog; console.warn = owarn; }
  const ok = Object.keys(r).filter((k) => !/^(prueba|resultado|M3_lineas|M5_lineas)$/.test(k)).every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WDMEDIDAS ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WDMEDIDAS {"resultado":"FALLO","error":"' + String(e && e.stack || e).replace(/"/g, "'").slice(0, 400) + '"}'); process.exit(1); });
