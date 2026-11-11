// Diagnóstico del dueño (S24, 10-11 12:46): tras reiniciarse la app a mitad de un envío de 25 MB, el adjunto pendiente «no se pudo leer del
// teléfono» y se marcaba ✗ (failed) a la primera y en cada reenvío, aunque quizá solo estuviera a medio escribir. 2995: un adjunto sin datos
// queda ⏳ y se reintenta; solo se da por perdido tras 3 intentos fallidos Y 5 minutos desde el primero. Decisión pura (_attMissDecision).
// Uso: node attmiss.js <dir_build>
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'attmiss' };
  const { _attMissDecision, _attMissCooling } = await importSrc('ui/ble_helpers.js');
  const memo = {}; const t0 = 1000000;
  r.primera_espera = _attMissDecision(memo, 'm1', t0) === 'wait';
  r.segunda_espera = _attMissDecision(memo, 'm1', t0 + 1000) === 'wait';
  r.tercera_pronto_espera = _attMissDecision(memo, 'm1', t0 + 60000) === 'wait';        // 3 intentos pero solo 1 min: todavía no
  r.cuarta_tras_5min_falla = _attMissDecision(memo, 'm1', t0 + 301000) === 'fail';
  r.otro_mensaje_independiente = _attMissDecision(memo, 'm2', t0 + 301000) === 'wait';   // cuenta aparte
  // 3003: el adjunto que acaba de fallar se enfría (no se relee del disco en cada vuelta): 5 s tras el 1.º intento, 10 s tras el 2.º... tope 60 s
  const mc = {}; const c0 = 5000000;
  r.sin_registro_no_enfria = _attMissCooling(mc, 'x', c0) === false && _attMissCooling(undefined, 'x', c0) === false;
  _attMissDecision(mc, 'x', c0);
  r.enfria_1s_despues = _attMissCooling(mc, 'x', c0 + 1000) === true;
  r.libre_a_los_5s = _attMissCooling(mc, 'x', c0 + 5000) === false;
  _attMissDecision(mc, 'x', c0 + 5000);
  r.segundo_enfria_9s = _attMissCooling(mc, 'x', c0 + 5000 + 9000) === true && _attMissCooling(mc, 'x', c0 + 5000 + 10000) === false;
  for (let i = 0; i < 8; i++) _attMissDecision(mc, 'x', c0 + 20000 + i);
  r.tope_60s = _attMissCooling(mc, 'x', c0 + 20007 + 59000) === true && _attMissCooling(mc, 'x', c0 + 20007 + 60000) === false;
  r.otro_mensaje_no_se_enfria = _attMissCooling(mc, 'y', c0 + 1000) === false;
  const ok = Object.keys(r).every((k) => k === 'prueba' || r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ATTMISS ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ATTMISS ' + JSON.stringify({ prueba: 'attmiss', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
