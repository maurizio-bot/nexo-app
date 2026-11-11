#!/usr/bin/env node
// Lector del CANAL DIRECTO de diagnósticos (2992): baja de los relés los eventos kind 1065 con la etiqueta de la llave de diagnóstico, los DESCIFRA con
// la mitad privada (variable de entorno NEXO_DIAG_PRIV, hex de 32 bytes; jamás en el repositorio) y los imprime ordenados. Pensado para la tarea
// programada de Claude (cada sesión nueva recibe la variable). Formato: src/ui/diag_channel.js.
// Uso:  NEXO_DIAG_PRIV=<hex> node tools/diag_reader.cjs [--horas 26] [--relays wss://a,wss://b] [--json]
// En el entorno de Claude el WebSocket sale por el proxy (HTTPS_PROXY): hace falta `ws` y `https-proxy-agent` (se instalan solos en tools/.deps).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nodeCrypto = require('crypto');

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];
const DIAG_KIND = 1065;

// @noble se busca donde haya (raíz del repo, tests/sim —en CI—, tests/sim/.deps o tools/.deps, donde lo deja ensureDeps)
const { pathToFileURL } = require('url');
function nobleDir() {
  const c = [path.join(__dirname, '.deps/node_modules'), path.join(__dirname, '../node_modules'), path.join(__dirname, '../tests/sim/node_modules'), path.join(__dirname, '../tests/sim/.deps/node_modules')];
  return c.find((d) => fs.existsSync(path.join(d, '@noble/curves/secp256k1.js')));
}
let _noble = null;
async function noble() {
  if (_noble) return _noble;
  const dir = nobleDir();
  if (!dir) throw new Error('faltan @noble/curves y @noble/hashes (npm install --prefix tools/.deps @noble/curves @noble/hashes)');
  const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
  const sec = await imp('@noble/curves/secp256k1.js'), sha = await imp('@noble/hashes/sha2.js'), ut = await imp('@noble/hashes/utils.js');
  return (_noble = { secp: sec.secp256k1, schnorr: sec.schnorr, sha256: sha.sha256, hex: ut.bytesToHex, unhex: ut.hexToBytes });
}
async function tagOf(pubHex) { const n = await noble(); return 'nexo-diag-' + n.hex(n.sha256(n.unhex(pubHex))).slice(0, 16); }
async function pubOf(privHex) { const n = await noble(); return n.hex(n.secp.getPublicKey(n.unhex(privHex), true)); }

// Descifra el contenido (base64) de un evento: modo(1) ‖ pública efímera(33) ‖ nonce(12) ‖ AES-GCM. Devuelve el objeto {v,sym,info,build,at,text} o lanza.
async function openDiag(b64, privHex) {
  const n = await noble();
  const raw = Buffer.from(b64, 'base64');
  if (raw.length < 1 + 33 + 12 + 16) throw new Error('muy corto');
  const mode = raw[0], eph = raw.subarray(1, 34), nonce = raw.subarray(34, 46), ct = raw.subarray(46);
  if (mode !== 1 && mode !== 2) throw new Error('modo desconocido');
  const shared = n.secp.getSharedSecret(n.unhex(privHex), eph, true).slice(1);
  const key = Buffer.from(n.sha256(Buffer.concat([Buffer.from('NEXO-DIAG-v1|'), Buffer.from(shared)])));
  const d = nodeCrypto.createDecipheriv('aes-256-gcm', key, nonce);
  d.setAAD(Buffer.from('NEXO-DIAG-v1')); d.setAuthTag(ct.subarray(ct.length - 16));
  let body = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  if (mode === 2) body = zlib.gunzipSync(body);
  const o = JSON.parse(body.toString('utf8'));
  if (!o || o.v !== 1 || typeof o.text !== 'string') throw new Error('formato');
  return o;
}

// Verifica id y firma de un evento (un relé no puede inventar ni alterar nada sin que se note)
async function eventOk(ev) {
  const n = await noble();
  try {
    const id = n.hex(n.sha256(Buffer.from(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
    return id === ev.id && n.schnorr.verify(n.unhex(ev.sig), n.unhex(ev.id), n.unhex(ev.pubkey));
  } catch (e) { return false; }
}

// Baja los eventos de los relés (REQ kinds [1065], #t [tag], since) y devuelve los descifrados, sin repetidos, ordenados por `at`.
async function readDiagnostics(opts) {
  const { privHex, relays, sinceSec, WebSocket, agent, timeoutMs } = opts;
  const tag = await tagOf(await pubOf(privHex));
  const seen = new Map(), bad = { firma: 0, descifrado: 0 }, errs = [];
  await Promise.all(relays.map((url) => new Promise((resolve) => {
    let ws; const t = setTimeout(() => { try { ws && ws.close(); } catch (e) {} errs.push(url + ': tiempo'); resolve(); }, timeoutMs || 20000);
    try { ws = new WebSocket(url, agent ? { agent } : undefined); } catch (e) { clearTimeout(t); errs.push(url + ': ' + e.message); resolve(); return; }
    ws.on('open', () => ws.send(JSON.stringify(['REQ', 'dg', { kinds: [DIAG_KIND], '#t': [tag], since: sinceSec, limit: 200 }])));
    ws.on('message', async (m) => {
      let a; try { a = JSON.parse(String(m)); } catch (e) { return; }
      if (a[0] === 'EVENT' && a[2]) {
        const ev = a[2];
        if (ev.kind !== DIAG_KIND || seen.has(ev.id)) return;
        if (!(await eventOk(ev))) { bad.firma++; return; }
        try { const o = await openDiag(ev.content, privHex); seen.set(ev.id, { id: ev.id, relay: url, created_at: ev.created_at, ...o }); } catch (e) { bad.descifrado++; }
      } else if (a[0] === 'EOSE') { clearTimeout(t); try { ws.close(); } catch (e) {} resolve(); }
    });
    ws.on('error', (e) => { clearTimeout(t); errs.push(url + ': ' + e.message); resolve(); });
  })));
  const list = Array.from(seen.values()).sort((x, y) => (x.at || 0) - (y.at || 0));
  return { tag, list, bad, errs };
}

async function ensureDeps() {
  const dir = path.join(__dirname, '.deps');
  const need = () => { try { return { WebSocket: require(path.join(dir, 'node_modules/ws')), HPA: require(path.join(dir, 'node_modules/https-proxy-agent')).HttpsProxyAgent }; } catch (e) { return null; } };
  let d = need();
  if (!d) {
    fs.mkdirSync(dir, { recursive: true });
    require('child_process').execSync('npm install --prefix "' + dir + '" ws https-proxy-agent@7 @noble/curves@2.0.1 @noble/hashes@2.0.1 --no-audit --no-fund --silent', { stdio: 'inherit' });
    d = need();
  }
  return d;
}

async function main() {
  const args = process.argv.slice(2), get = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
  const priv = (process.env.NEXO_DIAG_PRIV || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(priv)) { console.error('Falta NEXO_DIAG_PRIV (hex de 32 bytes) en el entorno.'); process.exit(2); }
  const horas = Number(get('--horas', '26')) || 26;
  const relays = (get('--relays', '') || '').split(',').filter(Boolean);
  const d = await ensureDeps();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const r = await readDiagnostics({ privHex: priv, relays: relays.length ? relays : DEFAULT_RELAYS, sinceSec: Math.floor(Date.now() / 1000) - Math.round(horas * 3600), WebSocket: d.WebSocket, agent: proxy ? new d.HPA(proxy) : undefined });
  if (args.includes('--json')) { console.log(JSON.stringify(r)); return; }
  console.log('DIAGNÓSTICOS recibidos en las últimas ' + horas + ' h: ' + r.list.length + ' (etiqueta ' + r.tag + '; firmas malas ' + r.bad.firma + ', no descifrados ' + r.bad.descifrado + (r.errs.length ? '; relés con problema: ' + r.errs.join(' | ') : '') + ')');
  for (const e of r.list) {
    console.log('\n===== ' + new Date(e.at || e.created_at * 1000).toISOString() + ' · ' + e.sym + (e.info ? ' (' + e.info + ')' : '') + ' · build ' + (e.build || '?') + ' =====');
    console.log(e.text);
  }
}

module.exports = { openDiag, readDiagnostics, eventOk, tagOf, pubOf, DIAG_KIND, DEFAULT_RELAYS };
if (require.main === module) main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
