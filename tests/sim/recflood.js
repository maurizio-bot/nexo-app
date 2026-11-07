// Anti-abuso / anti-IA (#dueño 07-11, plan de seguridad): la recuperación de cuenta (Fénix) ya tenía «una petición a la
// vez» (20 s), pero no un tope por VENTANA: un atacante podía spamear al custodio con avisos de recuperación (cada aviso
// engañado le filtra un fragmento de la clave — hallazgo H4). Arreglo: `_recWindowOk` (fenix.js), llamado en
// `_onRecoveryRequest`, limita a `recMax` peticiones MOSTRADAS por `recWinMs`. Prueba de la función pura (como busyback):
// dentro del tope pasa, pasado el tope se corta, y al salir de la ventana se vuelve a permitir (poda). Uso: node recflood.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'recflood' };
  const { _recWindowOk } = await importSrc('fenix/fenix.js');
  const MAX = 5, WIN = 3600000;

  // (1) Dentro del tope: las primeras MAX peticiones pasan.
  const w = [];
  let base = 1000000000000;                 // un "ahora" ficticio fijo
  let pasaron = 0;
  for (let i = 0; i < MAX; i++) if (_recWindowOk(w, base + i, MAX, WIN)) pasaron++;
  r.dentro_del_tope_pasan = pasaron === MAX;
  r.ventana_tiene_max = w.length === MAX;

  // (2) Pasado el tope (misma ventana): se corta.
  r.sexta_bloqueada = _recWindowOk(w, base + MAX, MAX, WIN) === false;
  r.septima_bloqueada = _recWindowOk(w, base + MAX + 1, MAX, WIN) === false;
  r.ventana_no_crece = w.length === MAX;    // las bloqueadas NO se apuntan

  // (3) Al salir de la ventana (poda): vuelve a permitir. El "ahora" debe dejar fuera TODAS las apuntadas (la última
  //     fue en base+MAX-1), así que base+WIN+MAX las supera todas.
  r.tras_ventana_pasa = _recWindowOk(w, base + WIN + MAX, MAX, WIN) === true;
  r.poda_dejo_una = w.length === 1;         // se podaron todas las viejas, queda solo la nueva

  // (4) Robustez: max=0 bloquea todo; una ventana vacía con max≥1 pasa.
  r.max_cero_bloquea = _recWindowOk([], base, 0, WIN) === false;
  r.vacia_pasa = _recWindowOk([], base, 1, WIN) === true;

  const ok = r.dentro_del_tope_pasan && r.ventana_tiene_max && r.sexta_bloqueada && r.septima_bloqueada &&
    r.ventana_no_crece && r.tras_ventana_pasa && r.poda_dejo_una && r.max_cero_bloquea && r.vacia_pasa;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RECFLOOD ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('RECFLOOD FALLO:', e && e.stack); process.exit(1); });
