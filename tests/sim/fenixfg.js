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

  const ok = r.primer_plano_pausa && r.segundo_plano_corre && r.sin_senal_corre && r.null_corre && r.cero_corre && r.truthy_no_pausa;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXFG ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FENIXFG FALLO:', e && e.stack); process.exit(1); });
