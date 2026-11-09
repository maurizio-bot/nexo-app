// Regla del dueño (07-11): «el usuario siempre primero, es el dueño de la radio». Con la app en PRIMER PLANO, el respaldo
// Fénix (y otros procesos de fondo) NO usan la radio; en segundo plano se reanudan. Implementado con `_fenixFgPaused`
// (fenix.js), consultado al inicio de los envíos de respaldo (_put, _putSeg). Clave de seguridad: solo pausa con señal CIERTA
// de primer plano (foreground===true); undefined/false (el simulador, o si falta la señal nativa) → corre, para no dejar nunca
// el respaldo sin hacerse. En uso real el teléfono pasa a segundo plano a cada rato, así que el respaldo tiene ventanas.
// Uso: node fenixfg.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'fenixfg' };
  const { _fenixFgPaused } = await importSrc('fenix/fenix.js');

  // (1) App en PRIMER PLANO (señal cierta): el respaldo se PAUSA (el usuario es la prioridad).
  r.primer_plano_pausa = _fenixFgPaused(true) === true;
  // (2) App en SEGUNDO PLANO: el respaldo CORRE.
  r.segundo_plano_corre = _fenixFgPaused(false) === false;
  // (3) Sin señal (undefined: el simulador, o si el nativo no la manda): CORRE, nunca se deja el respaldo sin hacerse.
  r.sin_senal_corre = _fenixFgPaused(undefined) === false;
  // (4) Robustez: otros valores «falsy» (null, 0) no se confunden con primer plano → corre.
  r.null_corre = _fenixFgPaused(null) === false;
  r.cero_corre = _fenixFgPaused(0) === false;
  // (5) Robustez: solo el booleano true exacto pausa (un valor «truthy» cualquiera NO pausa, evita pausas por accidente).
  r.truthy_no_pausa = _fenixFgPaused(1) === false && _fenixFgPaused('visible') === false;

  // 2973 (diagnóstico del dueño S24 09-11 12:15): la CARRERA «leer del disco ↔ vuelta al frente». _putSeg pasaba la compuerta en
  // segundo plano, tardaba ~400 ms en leer el segmento del disco y, si en ese rato la app volvía al frente, el envío salía igual (en
  // el diagnóstico: un segmento 90 ms después de «App de vuelta en primer plano», y luego 5 reintentos de 8 s sobre un enlace
  // atascado). Ahora re-comprueba la pausa DESPUÉS de leer. Fenix real con un ble mínimo y un «disco» lento que trae la app al frente.
  const { Fenix } = await importSrc('fenix/fenix.js');
  let sent = 0;
  const ble = { _foreground: false, localNexoId: 'nxa0000000', ackSystem: { sendFile: () => { sent++; return Promise.resolve(); } } };
  const slowLoad = () => new Promise((res) => setTimeout(() => { ble._foreground = true; res({ exists: true, content: 'QUJDREVGRw==' }); }, 40));
  global.window = Object.assign(global.window || {}, { crypto: require('crypto').webcrypto, Capacitor: { Plugins: { NexoBLE: { loadFromFile: slowLoad } } } });
  const fx = new Fenix(ble); fx.msgs = { segs: [] }; fx._saveMsgs = async () => {};
  await fx._putSeg('nxa0000001', 'AA:BB:CC:DD:EE:01', { id: 'g1', ts: 1, med: 1, ref: 'nexo_att_g1', bh: 'x', holders: {} });
  r.carrera_disco_vs_frente_no_manda = sent === 0 && !fx.inflight.has('nxa0000001');
  // control: en segundo plano sostenido el mismo segmento SÍ sale (la compuerta no se volvió un «nunca»)
  ble._foreground = false; global.window.Capacitor.Plugins.NexoBLE.loadFromFile = () => Promise.resolve({ exists: true, content: 'QUJDREVGRw==' });
  await fx._putSeg('nxa0000002', 'AA:BB:CC:DD:EE:02', { id: 'g2', ts: 1, med: 1, ref: 'nexo_att_g2', bh: 'x', holders: {} });
  r.segundo_plano_manda = sent === 1;

  const ok = r.primer_plano_pausa && r.segundo_plano_corre && r.sin_senal_corre && r.null_corre && r.cero_corre && r.truthy_no_pausa && r.carrera_disco_vs_frente_no_manda && r.segundo_plano_manda
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXFG ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FENIXFG FALLO:', e && e.stack); process.exit(1); });
