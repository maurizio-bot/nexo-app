// Punto 1 (diagnóstico real 01-11, dueño): «no quiero Tor por defecto siendo más lento». Antes net_link arrancaba Tor
// solo en Wi-Fi y, si estaba arriba, mandaba TODO por Tor (hasta un texto) → internet lento. Ahora Tor NO va por
// defecto: lo normal online va por relés (rápido); Tor solo entra (1) si el usuario lo enciende a mano en Ajustes
// (privacidad), (2) si no hay relés (offline), o (3) bajo demanda (vídeo/archivo grande por internet, que los relés no
// pueden). Y si el usuario lo apagó aposta (state.tor===false), ni siquiera a demanda. El interruptor de Ajustes refleja
// solo la elección MANUAL (no se «palomea» solo por una videollamada). Prueba determinista de las decisiones puras.
// Uso: node tordefault.js [buildDir]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'tordefault' };
  const { NetLink } = await importSrc('net/net_link.js');
  // NetLink sin arrancar (el constructor engancha listeners nativos): solo el estado que tocan las decisiones.
  const mk = (over) => {
    const nl = Object.create(NetLink.prototype);
    nl.state = {};
    nl.tor = { ready: false };
    nl._torNeeded = false;
    nl.tick = function () {};                 // no-op: sin red real
    nl.online = function () { return true; }; // por defecto hay relés
    Object.assign(nl, over || {});
    return nl;
  };

  // torWanted / torManual: por defecto APAGADO
  r.def_wanted_off = mk().torWanted() === false;                               // state.tor indefinido → off
  r.def_manual_off = mk().torManual() === false;
  r.manual_on = mk({ state: { tor: true } }).torManual() === true;             // usuario lo encendió a mano
  r.manual_on_wanted = mk({ state: { tor: true } }).torWanted() === true;
  r.off_stays_off = mk({ state: { tor: false }, _torNeeded: true }).torWanted() === false; // apagado aposta: ni a demanda
  r.ondemand_wanted = mk({ _torNeeded: true }).torWanted() === true;           // bajo demanda → quiere Tor
  r.ondemand_not_manual = mk({ _torNeeded: true }).torManual() === false;      // pero el interruptor NO se palomea solo

  // ensureTor
  const a = mk(); const ea = a.ensureTor();
  r.ensure_sets_needed = a._torNeeded === true && ea === false;                // pide Tor; aún no listo
  const b = mk({ state: { tor: false } }); const eb = b.ensureTor();
  r.ensure_respeta_off = b._torNeeded === false && eb === false;               // si lo apagó el usuario, ni a demanda
  r.ensure_ready = mk({ tor: { ready: true } }).ensureTor() === true;          // si ya está listo → true

  // _preferTor: lo NORMAL online → relés (false)
  r.pref_normal_false = mk()._preferTor() === false;                           // texto normal online → NO Tor (relés)
  r.pref_privacy_true = mk({ state: { tor: true } })._preferTor() === true;    // privacidad → Tor
  r.pref_offline_true = mk({ online: function () { return false; } })._preferTor() === true; // sin relés → Tor único camino
  r.pref_opts_true = mk()._preferTor({ tor: true }) === true;                  // el que llama lo pide (vídeo/archivo) → Tor

  // Migración 10-11: el «true» heredado se quita UNA vez; la elección posterior del usuario se respeta
  const m1 = mk({ state: { tor: true } }); m1._saveState = function () {}; const c1 = m1._migrateState();
  r.mig_quita_true = c1 === true && m1.torManual() === false && m1.state.torMig === 1;
  m1.state.tor = true; const c2 = m1._migrateState();                             // el usuario lo vuelve a encender
  r.mig_una_vez = c2 === false && m1.torManual() === true;
  const m2 = mk({ state: { tor: false } }); m2._saveState = function () {}; m2._migrateState();
  r.mig_respeta_off = m2.state.tor === false;                                     // apagado aposta: se queda
  const ok0 = r.mig_quita_true && r.mig_una_vez && r.mig_respeta_off;
  const ok = ok0 && r.def_wanted_off && r.def_manual_off && r.manual_on && r.manual_on_wanted && r.off_stays_off &&
    r.ondemand_wanted && r.ondemand_not_manual && r.ensure_sets_needed && r.ensure_respeta_off && r.ensure_ready &&
    r.pref_normal_false && r.pref_privacy_true && r.pref_offline_true && r.pref_opts_true;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TORDEFAULT ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('TORDEFAULT FALLO:', e && e.stack); process.exit(1); });
