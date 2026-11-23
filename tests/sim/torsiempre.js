// Decisión 13A del dueño (23-11, T-X1): «Usar Tor siempre» = TODO lo de internet por Tor (relés, toque y bajadas del buzón).
//  apagado    (de fábrica) los relés se abren directos como siempre y no se toca Tor
//  espera     con Tor siempre y Tor aún sin arrancar: NINGUNA conexión directa al relé (se espera) y se pide arrancar Tor
//             (torStart con always:true), también sin Wi-Fi
//  por_tor    Tor listo: el relé se abre por la parte nativa (torConnect{url}) y por ahí se publica y se baja por id (buzón)
//  toque      wakeFetch: apagado = fetch normal; con Tor siempre, el POST va por torConnect{post}
// La parte nativa (PluginTor/WsClient por el SOCKS de Tor) se imita aquí con un WebSocket de Node que apunta lo que pasa.
// Uso: node torsiempre.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const { NostrRelay } = require('./nostr_relay');
const WS = require('ws');

(async () => {
  const r = { prueba: 'torsiempre' };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const relay = new NostrRelay();
  const U1 = await relay.start();
  const calls = [];
  let net = null;
  const socks = new Map();
  const plugin = {
    torStart: (a) => { calls.push(['torStart', a]); return Promise.resolve({ starting: true }); },
    torStop: () => Promise.resolve({}),
    torConnect: (a) => {
      calls.push(['torConnect', a.url || a.post || a.host]);
      if (a.post) return Promise.resolve({ status: 200 });
      const w = new WS(a.url); socks.set(a.ws, w);
      w.on('open', () => net._onTorWs({ ws: a.ws, ev: 'open' }));
      w.on('message', (d) => net._onTorWs({ ws: a.ws, ev: 'msg', data: String(d) }));
      w.on('close', () => net._onTorWs({ ws: a.ws, ev: 'close' }));
      w.on('error', () => {});
      return Promise.resolve({ connecting: true });
    },
    torSend: (a) => { const w = socks.get(a.ws); if (!w) return Promise.reject(new Error('x')); w.send(a.content); return Promise.resolve({ sent: true }); },
    torDrop: (a) => { const w = socks.get(a.ws); if (w) w.close(); return Promise.resolve({}); },
  };
  global.window = { NEXO_NET_RELAYS: [U1], Capacitor: { Plugins: { NexoBLE: plugin } } };
  const { NetLink } = await importSrc('net/net_link.js');
  const mk = (id, tor) => { const n = new NetLink({ localNexoId: id, getBLEContacts: () => [] }); n.tick = async () => {}; if (tor) n.state.tor = true; return n; };
  const waitOpen = async (n, ms) => { for (let i = 0; i < ms / 50 && !n.openRelayUrls().length; i++) await sleep(50); return n.openRelayUrls().length > 0; };

  // apagado (de fábrica)
  const off = mk('nxa0000001', false); net = off;
  const c0 = relay.stats.conns;
  off._connect(U1);
  r.apagado_directo = await waitOpen(off, 3000) && relay.stats.conns === c0 + 1 && !calls.some((c) => c[0] === 'torConnect');
  r.apagado_toque_normal = off.wakeFetch() === undefined;

  // con Tor siempre, Tor aún no listo: se espera
  const on = mk('nxb0000002', true); net = on;
  on.wifi = false; // con datos móviles también arranca Tor
  const c1 = relay.stats.conns;
  on._connect(U1);
  await sleep(1200);
  r.espera_sin_directo = relay.stats.conns === c1 && !on.openRelayUrls().length;
  const ts = calls.filter((c) => c[0] === 'torStart');
  r.pide_tor_always = ts.length >= 1 && ts[0][1].always === true;
  // Tor listo
  const tReady = Date.now();
  on._onTorReady({ onion: 'abc.onion', port: 9 });
  await sleep(50);
  on._connect(U1); // (lo haría el latido: _torRelaysNow deja el reintento a 0)
  r.por_tor_abre = await waitOpen(on, 3000);
  r.relés_listos_tras_tor_ms = Date.now() - tReady;
  r.por_tor_torconnect = calls.some((c) => c[0] === 'torConnect' && c[1] === U1);
  // publicar (desde el de Tor) y bajar por id (buzón) por la conexión de Tor
  const sk = on.randomKey();
  const ev = on.blobEvent(sk, Buffer.from('hola por tor').toString('base64'), Math.floor(Date.now() / 1000) + 3600);
  const oks = await on.publishEach(ev, 4000);
  r.publica_por_tor = Array.isArray(oks) && oks.length === 1;
  const got = await off.fetchEvents(U1, [ev.id], 3000);
  r.otro_lo_baja = got.length === 1;
  const got2 = await on.fetchEvents(U1, [ev.id], 3000);
  r.baja_por_tor = got2.length === 1;
  // toque por Tor
  const wf = on.wakeFetch();
  const res = typeof wf === 'function' ? await wf('https://nexo-wake.maurizioamistani.workers.dev', { body: '{"to":"x"}' }) : null;
  r.toque_por_tor = !!res && res.status === 200 && calls.some((c) => c[0] === 'torConnect' && /^https:\/\/nexo-wake/.test(c[1]));
  const ok = r.apagado_directo && r.apagado_toque_normal && r.espera_sin_directo && r.pide_tor_always && r.por_tor_abre && r.por_tor_torconnect && r.publica_por_tor && r.otro_lo_baja && r.baja_por_tor && r.toque_por_tor;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TORSIEMPRE ' + JSON.stringify(r));
  socks.forEach((w) => { try { w.terminate(); } catch (e) {} });
  try { off.relays.forEach((x) => { if (x.ws) { x.ws.onclose = null; x.ws.close(); } }); on.relays.forEach((x) => { if (x.ws) { x.ws.onclose = null; x.ws.close(); } }); } catch (e) {}
  await relay.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
