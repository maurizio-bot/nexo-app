// C-1 (#dueño 07-11, Tanda 1): backoff de reconexión CON "jitter". EL FALLO: sin jitter, la espera entre reintentos era
// determinista (2, 4, 8, 16, 30 s clavados); si VARIOS teléfonos se cortan en el MISMO instante —el dueño de un grupo se
// va, todos pierden señal en un concierto, el Bluetooth del coche se apaga— TODOS reintentaban a la vez y chocaban en la
// radio (que es compartida): colisiones de GATT (error 133) y la ventana de escaneo de Android (5/30 s) llena para todos
// al mismo tiempo, justo cuando más se necesita reconectar. EL ARREGLO: una sola regla `_jitteredBackoff` (la misma
// fórmula en JS y en Kotlin): mitad fija (suelo = exp/2) + mitad aleatoria → los reintentos se reparten en el tiempo.
// Prueba del INVARIANTE (no de un caso): la espera queda SIEMPRE en [exp/2, exp], respeta el tope, el suelo crece con el
// intento, y —lo importante— N teléfonos en el mismo intento ya NO caen en el mismo instante. Uso: node jitter.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'jitter' };
  const { _jitteredBackoff } = await importSrc('ui/ble_helpers.js');
  const BASE = 2000, CAP = 30000;
  const expOf = (a) => Math.min(BASE * Math.pow(2, a), CAP);

  // (0) REPRODUCIR EL FALLO: la fórmula vieja (determinista) daba a 100 teléfonos la MISMA espera → tromba sincronizada.
  const viejo = (a) => Math.min(BASE * Math.pow(2, a), CAP);
  const antes = new Set(); for (let i = 0; i < 100; i++) antes.add(viejo(4));
  r.antes_todos_igual = antes.size === 1;                 // 100 teléfonos, 1 sola espera = el choque

  // (1) ARREGLO: 300 teléfonos en el mismo intento ya NO caen en el mismo instante (se reparten).
  const muestras = [];
  for (let i = 0; i < 300; i++) muestras.push(_jitteredBackoff(4, BASE, CAP));
  const distintos = new Set(muestras).size;
  r.ahora_repartido = distintos >= 250;                   // deben ser casi todos distintos (rango de 15 s en ms)
  r.distintos = distintos;

  // (2) INVARIANTE DE LÍMITES: para intentos 0..7, 500 muestras cada uno SIEMPRE en [exp/2, exp]. Nunca por debajo del
  //     suelo (no martillar la radio con esperas casi cero) ni por encima del tope.
  let dentro = true, minPorIntento = [];
  for (let a = 0; a <= 7; a++) {
    const exp = expOf(a), suelo = exp / 2;
    let mn = Infinity;
    for (let i = 0; i < 500; i++) {
      const d = _jitteredBackoff(a, BASE, CAP);
      if (d < suelo || d > exp) dentro = false;
      if (d < mn) mn = d;
    }
    minPorIntento.push(mn);
  }
  r.siempre_en_rango = dentro;

  // (3) EL SUELO CRECE con el intento hasta el tope (la espera de verdad se alarga; no se queda en 2 s como el bug viejo).
  const suelos = [0, 1, 2, 3, 4, 5].map((a) => expOf(a) / 2);   // 1000, 2000, 4000, 8000, 15000, 15000
  let crece = true; for (let i = 1; i < suelos.length; i++) if (suelos[i] < suelos[i - 1]) crece = false;
  r.suelo_crece = crece && suelos[0] === 1000 && suelos[4] === 15000;

  // (4) TOPE: pasado el intento 4, exp = tope; nunca supera 30 s y nunca baja de 15 s.
  let topeOk = true;
  for (let i = 0; i < 500; i++) { const d = _jitteredBackoff(10, BASE, CAP); if (d > CAP || d < CAP / 2) topeOk = false; }
  r.respeta_tope = topeOk;

  // (5) ROBUSTEZ de la función: intento negativo o no-número = intento 0 (no NaN, no negativo); defaults 2000/30000.
  const neg = _jitteredBackoff(-5, BASE, CAP), nan = _jitteredBackoff('x', BASE, CAP);
  r.intento_invalido_ok = neg >= 1000 && neg <= 2000 && nan >= 1000 && nan <= 2000;
  const def = _jitteredBackoff(0);
  r.defaults_ok = def >= 1000 && def <= 2000;

  const ok = r.antes_todos_igual && r.ahora_repartido && r.siempre_en_rango && r.suelo_crece &&
    r.respeta_tope && r.intento_invalido_ok && r.defaults_ok;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('JITTER ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('JITTER FALLO:', e && e.stack); process.exit(1); });
