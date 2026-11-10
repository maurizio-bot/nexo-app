// Diagnóstico del dueño (S24, 10-11 12:46): tras reiniciarse la app a mitad de un envío de 25 MB, el adjunto pendiente «no se pudo leer del
// teléfono» y se marcaba ✗ (failed) a la primera y en cada reenvío, aunque quizá solo estuviera a medio escribir. 2995: un adjunto sin datos
// queda ⏳ y se reintenta; solo se da por perdido tras 3 intentos fallidos Y 5 minutos desde el primero. Decisión pura (_attMissDecision).
// Uso: node attmiss.js <dir_build>
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'attmiss' };
  const { _attMissDecision } = await importSrc('ui/ble_helpers.js');
  const memo = {}; const t0 = 1000000;
  r.primera_espera = _attMissDecision(memo, 'm1', t0) === 'wait';
  r.segunda_espera = _attMissDecision(memo, 'm1', t0 + 1000) === 'wait';
  r.tercera_pronto_espera = _attMissDecision(memo, 'm1', t0 + 60000) === 'wait';        // 3 intentos pero solo 1 min: todavía no
  r.cuarta_tras_5min_falla = _attMissDecision(memo, 'm1', t0 + 301000) === 'fail';
  r.otro_mensaje_independiente = _attMissDecision(memo, 'm2', t0 + 301000) === 'wait';   // cuenta aparte
  const ok = Object.keys(r).every((k) => k === 'prueba' || r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ATTMISS ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ATTMISS ' + JSON.stringify({ prueba: 'attmiss', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
