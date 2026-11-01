// P5 (diagnóstico real 01-11, dueño): un relé público que FLAPEA (abre y se cae enseguida) desestabiliza internet — en
// el log, wss://relay.damus.io se cerró 37×, a veces 3× en <1 min. Cada vez que abría reseteaba el backoff a 2 s, así que
// reconectaba rápido sin parar. Arreglo: detectar el flapeo (conexiones de vida corta) y apartar ese relé un rato — pero
// SOLO si quedan otros relés abiertos (mejor un relé que flapea que quedarse sin internet). Prueba determinista de
// `_noteRelayClose`. Uso: node relayflap.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'relayflap' };
  const { NetLink } = await importSrc('net/net_link.js');

  function mkNet(openOthers) {
    const net = new NetLink({ localNexoId: 'nxa0000001' });
    net.relays = new Map();
    for (let i = 0; i < openOthers; i++) net.relays.set('wss://otro' + i + '.test', { open: true });
    const url = 'wss://flap.test';
    const rel = { backoff: 2000, waits: new Map(), open: false };
    net.relays.set(url, rel);
    return { net, url, rel };
  }
  const SHORT = 1000;       // vida < RELAY_STABLE_MS (20 s) = flap
  const STABLE = 30000;     // vida >= RELAY_STABLE_MS = conexión estable
  const PENALTY = 300000;   // RELAY_FLAP_PENALTY_MS

  // --- con 2 relés más abiertos: 3 flaps seguidos → se aparta 5 min ---
  {
    const { net, url, rel } = mkNet(2);
    let t = 1000000;
    const d1 = net._noteRelayClose(rel, url, SHORT, t); t += 1000;
    const sidelined1 = rel._sidelined;
    const d2 = net._noteRelayClose(rel, url, SHORT, t); t += 1000;
    const sidelined2 = rel._sidelined;
    const d3 = net._noteRelayClose(rel, url, SHORT, t);
    // los 2 primeros: backoff normal, aún no apartado (un cierre que aparta devuelve PENALTY)
    r.flaps_1_2_no_apartan = sidelined1 === false && sidelined2 === false && d1 < PENALTY && d2 < PENALTY;
    r.flap_3_aparta = rel._sidelined === true && d3 === PENALTY;                        // el 3º: apartado 5 min
    r.retryAt_lejos = rel.retryAt >= t + PENALTY - 1;
  }

  // --- solo 1 relé más abierto (< RELAY_MIN_OTHERS=2): aunque flapee, NO se aparta (no quedarse sin internet) ---
  {
    const { net, url, rel } = mkNet(1);
    let t = 2000000;
    for (let i = 0; i < 5; i++) { net._noteRelayClose(rel, url, SHORT, t); t += 1000; }
    r.pocos_relés_no_aparta = rel._sidelined === false;
  }

  // --- una conexión ESTABLE olvida los flaps viejos (no se le penaliza luego por flaps antiguos) ---
  {
    const { net, url, rel } = mkNet(2);
    let t = 3000000;
    net._noteRelayClose(rel, url, SHORT, t); t += 1000;
    net._noteRelayClose(rel, url, SHORT, t); t += 1000;   // 2 flaps
    net._noteRelayClose(rel, url, STABLE, t); t += 1000;  // estuvo estable → resetea flaps
    const d = net._noteRelayClose(rel, url, SHORT, t);    // 1 flap nuevo: no llega a 3
    r.estable_resetea = rel._sidelined === false && d < PENALTY && (rel.flapTimes || []).length === 1;
  }

  // --- backoff normal se dobla en cierres que no son flap (fallo de conexión, vida 0) ---
  {
    const { net, url, rel } = mkNet(2);
    let t = 4000000;
    const d1 = net._noteRelayClose(rel, url, 0, t); t += 1000;  // 2000
    const d2 = net._noteRelayClose(rel, url, 0, t);             // 4000
    r.backoff_dobla = d1 === 2000 && d2 === 4000 && rel._sidelined === false;
  }

  const ok = r.flaps_1_2_no_apartan && r.flap_3_aparta && r.retryAt_lejos && r.pocos_relés_no_aparta &&
    r.estable_resetea && r.backoff_dobla;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RELAYFLAP ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('RELAYFLAP FALLO:', e && e.stack); process.exit(1); });
