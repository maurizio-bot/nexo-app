// Auditoría (defensa en profundidad, 2998): el evento Nostr del buzón se acepta solo si su id es el sha256 canónico (NIP-01) de su contenido y su
// firma Schnorr es válida para su pubkey. Antes no se comprobaba: un relé podía tocar la fecha o las etiquetas de un evento reenviado.
// Prueba pura: un evento propio vale; con cualquier campo tocado (fecha, etiqueta, contenido, id, firma, pubkey) no vale; basura no rompe.
// Uso: node evsig.js <dir_build>
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'evsig' };
  const { netEventValid, netMakeEvent } = await importSrc('net/net_link.js');
  const crypto = require('crypto');
  const sk = new Uint8Array(crypto.randomBytes(32));
  const ev = netMakeEvent(sk, 1059, [['p', 'ab'.repeat(32)], ['expiration', '1900000000']], 'Zm9v');
  const mod = (f) => { const e = JSON.parse(JSON.stringify(ev)); f(e); return e; };
  r.valido = netEventValid(ev) === true;
  r.fecha_tocada = netEventValid(mod((e) => { e.created_at += 100000; })) === false;
  r.etiqueta_tocada = netEventValid(mod((e) => { e.tags[0][1] = 'cd'.repeat(32); })) === false;
  r.contenido_tocado = netEventValid(mod((e) => { e.content = 'YmFy'; })) === false;
  r.id_tocado = netEventValid(mod((e) => { e.id = '00'.repeat(32); })) === false;
  r.firma_tocada = netEventValid(mod((e) => { e.sig = '11'.repeat(64); })) === false;
  r.pubkey_ajena = netEventValid(mod((e) => { e.pubkey = 'ee'.repeat(32); })) === false;
  r.basura_no_rompe = netEventValid(null) === false && netEventValid({}) === false && netEventValid({ id: 5 }) === false && netEventValid('x') === false;
  const ok = Object.keys(r).every((k) => k === 'prueba' || r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('EVSIG ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('EVSIG ' + JSON.stringify({ prueba: 'evsig', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
