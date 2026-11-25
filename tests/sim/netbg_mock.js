// Modelo para el simulador de la BANDEJA DE SALIDA nativa (3268, fase 3; Kotlin: NetOutbox.kt + NetBg.pumpOutbox). La app deja en el
// teléfono (native.outbox, plugin netOutboxSet) sus textos pendientes ya cifrados de punta a punta; esto hace lo que hace el nativo sin
// la app: los sube a los relés con el MISMO sobre (AES-GCM con el secreto de la pareja y AAD NEXO-NET|yo|él, etiqueta del día del que
// recibe, evento kind 1059 firmado con una clave al azar y caducidad de 7 días). El Kotlin de verdad se prueba en tests/kotlin
// (NetOutboxTest, NetBgOutboxTest); aquí se comprueba el recorrido entero con la app real de los dos lados.
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const WebSocket = require('ws');
const wc = require('crypto').webcrypto;

let _libs = null;
async function libs() {
  if (_libs) return _libs;
  const deps = path.join(__dirname, '.deps/node_modules');
  const { schnorr } = await import(pathToFileURL(path.join(deps, '@noble/curves/secp256k1.js')).href);
  const { sha256 } = await import(pathToFileURL(path.join(deps, '@noble/hashes/sha2.js')).href);
  const { hmac } = await import(pathToFileURL(path.join(deps, '@noble/hashes/hmac.js')).href);
  const { bytesToHex, hexToBytes } = await import(pathToFileURL(path.join(deps, '@noble/hashes/utils.js')).href);
  _libs = { schnorr, sha256, hmac, bytesToHex, hexToBytes };
  return _libs;
}
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const utf8 = (s) => new TextEncoder().encode(s);
const day = (o) => new Date(Date.now() + (o || 0) * 86400000).toISOString().substring(0, 10);

// Como NetOutbox.valid
const validItem = (x) => !!x && /^[A-Za-z0-9_.:-]{4,96}$/.test(String(x.id || '')) && /^nx[0-9a-z]{8}$/.test(String(x.nx || '')) && typeof x.p === 'string' && x.p.length > 0 && x.p.length <= 40000;

// El sobre que sube el nativo para un elemento de la bandeja (NetBg.sealedEvent con body {t, w, p, n, f})
async function sealedEvent(me, c, item, myToken) {
  const L = await libs();
  const kraw = L.hexToBytes(c.kraw);
  const body = { t: Date.now(), w: 0, p: item.p, n: item.id };
  if (myToken) body.f = myToken;
  const key = await wc.subtle.importKey('raw', kraw, 'AES-GCM', false, ['encrypt']);
  const iv = wc.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8('NEXO-NET|' + me + '|' + c.nx) }, key, utf8(JSON.stringify(body))));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  const content = Buffer.from(all).toString('base64');
  const x = BigInt('0x' + L.bytesToHex(L.hmac(L.sha256, kraw, utf8('tag|' + c.nx + '|' + day(0))))) % (N - 1n) + 1n;
  const tagPub = L.bytesToHex(L.schnorr.getPublicKey(L.hexToBytes(x.toString(16).padStart(64, '0'))));
  const sk = L.schnorr.utils.randomSecretKey ? L.schnorr.utils.randomSecretKey() : L.schnorr.utils.randomPrivateKey();
  const pubkey = L.bytesToHex(L.schnorr.getPublicKey(sk));
  const created_at = Math.floor(Date.now() / 1000), kind = 1059;
  const tags = [['p', tagPub], ['expiration', String(created_at + 7 * 86400)]];
  const id = L.sha256(utf8(JSON.stringify([0, pubkey, created_at, kind, tags, content])));
  return { id: L.bytesToHex(id), pubkey, created_at, kind, tags, content, sig: L.bytesToHex(L.schnorr.sign(id, sk)) };
}

function publish(url, ev, ms) {
  return new Promise((resolve) => {
    let done = false, ws;
    const end = (ok) => { if (done) return; done = true; try { ws.close(); } catch (e) {} resolve(ok); };
    try { ws = new WebSocket(url); } catch (e) { resolve(false); return; }
    ws.on('open', () => { try { ws.send(JSON.stringify(['EVENT', ev])); } catch (e) { end(false); } });
    ws.on('message', (d) => { let m = null; try { m = JSON.parse(String(d)); } catch (e) {} if (m && m[0] === 'OK' && m[1] === ev.id) end(m[2] === true); });
    ws.on('error', () => end(false));
    ws.on('close', () => end(false));
    setTimeout(() => end(false), ms || 4000);
  });
}

// Una vuelta de la bandeja (NetBg.pumpOutbox): sube lo pendiente a los relés que la app dio en netBgConfig. Devuelve
// { publicados: [ids que algún relé aceptó], sin_rele: [ids que ninguno aceptó], sin_contacto: [ids sin secreto de pareja] }.
// 3281: de un archivo, primero sus trozos (eventos ya firmados por la app, tal cual; opts.soloTrozos = cuántos subir en esta vuelta,
// para cortar a la mitad) y SOLO con todos guardados sale su aviso; trozos: cuántos se subieron en esta vuelta.
async function pumpOutbox(native, opts) {
  const out = native.outbox || { items: [] }, cfg = native.netBg || {};
  const r = { publicados: [], sin_rele: [], sin_contacto: [], trozos: 0, a_medias: [] };
  let cupo = (opts && opts.soloTrozos != null) ? opts.soloTrozos : Infinity;
  for (const item of (out.items || []).slice()) {
    const c = (cfg.contacts || []).find((x) => String(x.nx || '').toLowerCase() === item.nx);
    if (!c || !cfg.me) { r.sin_contacto.push(item.id); continue; }
    for (const k of (item.chunks || [])) {
      if (k.ok || cupo <= 0) continue;
      cupo--;
      const oks = await Promise.all((cfg.relays || []).slice(0, 3).map((u) => publish(u, JSON.parse(k.ev))));
      if (oks.some(Boolean)) { k.ok = true; r.trozos++; }
    }
    if ((item.chunks || []).some((k) => !k.ok)) { r.a_medias.push(item.id); continue; } // el aviso no sale sin todos sus trozos
    const ev = await sealedEvent(String(cfg.me).toLowerCase(), c, item, out.f);
    if (ev.content.length > 60000) { r.sin_rele.push(item.id); continue; }
    const oks = await Promise.all((cfg.relays || []).map((u) => publish(u, ev)));
    (oks.some(Boolean) ? r.publicados : r.sin_rele).push(item.id);
    if (oks.some(Boolean)) item.okAt = Date.now();
  }
  return r;
}

module.exports = { pumpOutbox, sealedEvent, validItem };
