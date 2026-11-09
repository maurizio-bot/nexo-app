// Build 2967 — Fase A (docs/CONTRATOS_ENTREGA_OFFLINE_FASE_AB.md §6 «token en los dos sentidos»): la MARCA del buzón de un
// mensaje NUEVO lleva mi token FCM. Antes el token viajaba SOLO en el saludo (body.f con hello), que caduca en el relé a los
// 10 min (TTL_HELLO=600): un contacto dormido horas leía mi mensaje del buzón (TTL 7 días) pero NO mi token → no podía
// tocarme a mí (mutuo) ni despertarme más tarde si mi token había rotado. Ahora send() pone f también en los mensajes nuevos
// (nid), una vez por mensaje, nunca por trozo/ack/control; y si con el token el sobre se pasa del tope del relé (lección 2964:
// el límite es sobre lo YA codificado) lo manda SIN token antes que no mandarlo. Prueba determinista sin red: NetLink real con
// _pair/_publish/online/_wake de mentira; el sobre publicado se descifra con la misma clave para mirar el cuerpo.
// Uso: node netmark.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'netmark' };
  if (typeof global.window === 'undefined') global.window = {}; // net_link mira window.Capacitor (sin plugin aquí)
  const { NetLink } = await importSrc('net/net_link.js');
  const ME = 'nxa0000001', NX = 'nxb0000002', TOKEN = 'FCMTOK-A-0000000000000000000000000000', TOKB = 'FCMTOK-B-0000000000000000000000000000';
  const MAX_CONTENT = 60000;
  const utf8 = (s) => new TextEncoder().encode(s);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const kraw = crypto.getRandomValues(new Uint8Array(32));
  const net = new NetLink({ localNexoId: ME, getBLEContacts: () => [{ nexoId: NX, nt: 1, publicKey: 'pub-de-prueba' }] });
  net.fcmToken = TOKEN;
  net.online = () => true;
  net.tick = () => Promise.resolve();
  net._pair = async () => ({ pub: 'pub-de-prueba', kraw, aes });
  let published = [], wakes = 0;
  net._publish = (ev) => { published.push(ev); return Promise.resolve(true); };
  net._wake = () => { wakes++; };
  net._saveState = () => {};
  async function open(ev) {
    const raw = Buffer.from(ev.content, 'base64');
    const iv = raw.subarray(0, 12), ct = raw.subarray(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8('NEXO-NET|' + ME + '|' + NX) }, aes, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function sendAndOpen(content, opts) {
    published = [];
    await net.send(NX, content, opts);
    return { body: await open(published[0]), len: published[0].content.length, eventos: published.length };
  }

  // 1) Saludo: lleva el token (como antes)
  const h = await sendAndOpen('', { hello: true });
  r.saludo_lleva_token = h.body.h === 1 && h.body.f === TOKEN && h.eventos === 1;
  // 2) Mensaje NUEVO (msgId) por el buzón: la marca lleva n y f; pide el toque una vez
  wakes = 0;
  const m = await sendAndOpen(JSON.stringify({ type: 'chat', msgId: 'm1', content: 'hola' }));
  r.mensaje_nuevo_lleva_token = m.body.n === 'm1' && m.body.f === TOKEN && m.body.p.indexOf('hola') >= 0 && m.body.h === undefined;
  await new Promise((res) => setTimeout(res, 20)); // el toque se pide al resolverse la publicación
  r.mensaje_nuevo_pide_toque = wakes === 1;
  // 3) Trozo / ack / control (sin msgId): sin n, sin f, sin toque (peso: un archivo son miles de trozos)
  wakes = 0;
  const c = await sendAndOpen(JSON.stringify({ type: 'chunk', id: 'x', i: 3, data: 'AAAA' }));
  const a = await sendAndOpen(JSON.stringify({ type: 'ack', id: 'x' }));
  await new Promise((res) => setTimeout(res, 20));
  r.trozo_sin_token = !('n' in c.body) && !('f' in c.body) && !('n' in a.body) && !('f' in a.body) && wakes === 0;
  // 4) Sin token propio → sin f (nunca una cadena vacía)
  net.fcmToken = '';
  const s = await sendAndOpen(JSON.stringify({ type: 'chat', msgId: 'm2', content: 'sin token' }));
  r.sin_token_propio_sin_f = s.body.n === 'm2' && !('f' in s.body);
  net.fcmToken = TOKEN;
  // 5) TOPE del relé: un mensaje nuevo que CON el token se pasa de MAX_CONTENT pero sin él entra → sale SIN token (nunca se pierde).
  //    El tamaño se calcula igual que lo arma send(): cuerpo {t,w,p,n[,f]} en UTF-8 + iv 12 + etiqueta GCM 16, todo en base64.
  const bodyLen = (p, withF) => utf8(JSON.stringify(Object.assign({ t: Date.now(), w: 0, p: p, n: 'm3' }, withF ? { f: TOKEN } : {}))).length;
  const b64Len = (bytes) => 4 * Math.ceil((12 + bytes + 16) / 3);
  const mk = (L) => JSON.stringify({ type: 'chat', msgId: 'm3', content: 'A'.repeat(L) });
  let pBorde = null;
  for (let L = 44600; L < 45300 && !pBorde; L++) { const p = mk(L); if (b64Len(bodyLen(p, false)) <= MAX_CONTENT && b64Len(bodyLen(p, true)) > MAX_CONTENT) pBorde = p; }
  r.hay_caso_borde = !!pBorde;
  if (pBorde) {
    const e = await sendAndOpen(pBorde);
    r.tope_sin_token_pero_sale = e.body.n === 'm3' && !('f' in e.body) && e.len <= MAX_CONTENT && e.eventos === 1;
  } else r.tope_sin_token_pero_sale = false;
  // 6) Lo que no entra ni sin token se sigue rechazando (NET_TOO_BIG) sin publicar nada, como antes
  let code = null; published = [];
  try { await net.send(NX, mk(46000)); } catch (err) { code = err && err.code; }
  r.demasiado_grande_sigue_rechazado = code === 'NET_TOO_BIG' && published.length === 0;
  // 7) El que recibe guarda el token de CUALQUIER sobre (no solo del saludo) y lo persiste para después
  net.state.peerFcm = {};
  net._deliver(NX, { t: Date.now(), p: JSON.stringify({ type: 'chat', msgId: 'm9', content: 'x' }), n: 'm9', f: TOKB });
  r.receptor_guarda_token_del_mensaje = net.peers.get(NX).fcmToken === TOKB && net.state.peerFcm[NX] === TOKB;
  // 8) Un token basura (corto o enorme) no se guarda
  net._deliver(NX, { t: Date.now(), p: '{}', f: 'corto' });
  net._deliver(NX, { t: Date.now(), p: '{}', f: 'X'.repeat(5000) });
  r.token_basura_ignorado = net.peers.get(NX).fcmToken === TOKB;

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NETMARK ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NETMARK {"resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); process.exit(1); });
