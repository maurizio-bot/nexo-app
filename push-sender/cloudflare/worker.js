// NEXO — Enviador de «toques» FCM en Cloudflare Workers (alternativa GRATIS a Firebase Functions, SIN tarjeta).
//
// Hace EXACTAMENTE lo mismo que push-sender/index.js: POST { "to": "<token FCM>" } -> manda un mensaje SOLO-DATOS
// de alta prioridad a ese token para que Android ejecute NexoFcmService con la app cerrada. NUNCA ve el contenido.
//
// El «despertar» lo sigue haciendo Firebase (FCM); esto solo le PIDE a FCM que lo haga, firmando con la cuenta de
// servicio del proyecto nexo-7994a. La diferencia con Firebase Functions es solo DÓNDE vive este programita (aquí,
// en Cloudflare, que es gratis y no pide facturación).
//
// Configuración (una vez): en el panel de Cloudflare, variable SECRETA `SA_B64` = el JSON de la cuenta de servicio
// (puede ir el JSON crudo o en base64). Ver push-sender/cloudflare/README.md.

const PROJECT_ID = 'nexo-7994a';
const FCM_URL = 'https://fcm.googleapis.com/v1/projects/' + PROJECT_ID + '/messages:send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// 14A (decisión del dueño 23-11, auditoría T-P1: «firmar el toque»). Antes cualquiera con el token FCM de un teléfono podía mandarle toques
// (no lee nada, pero le gasta batería). Ahora el teléfono pide su SELLO: POST { "seal": "<su token>" }. El servicio NO lo devuelve a quien
// pregunta: se lo manda por FCM al propio teléfono dueño de ese token ({ t: 'seal', s }); solo el teléfono de verdad lo recibe. El sello
// (s1.…) es el token cifrado con WAKE_KEY (AES-GCM, secreto de este servicio) y es lo que el teléfono comparte con sus contactos. Un toque
// { "to": "s1.…" } se abre aquí; uno con el token crudo se acepta mientras ONLY_SEALED no sea "1" (transición: teléfonos aún sin sello).
// Secretos: WAKE_KEY = 32 bytes en base64 (wrangler secret put WAKE_KEY); ONLY_SEALED = "1" cuando todos tengan la versión con sello.
const SEAL_PREFIX = 's1.', SEAL_AAD = new TextEncoder().encode('nexo-wake-v1');
function bytesFromB64(s) { const raw = atob(String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')); const b = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i); return b; }
async function sealKey(env) {
  const k = env && env.WAKE_KEY;
  if (!k) return null;
  const raw = bytesFromB64(k);
  if (raw.length !== 32) throw new Error('WAKE_KEY debe ser de 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function sealToken(env, token) {
  const key = await sealKey(env); if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: SEAL_AAD }, key, new TextEncoder().encode(token)));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12);
  return SEAL_PREFIX + b64urlFromBytes(out);
}
export async function unsealToken(env, sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith(SEAL_PREFIX) || sealed.length > 6000) return null;
  const key = await sealKey(env); if (!key) return null;
  try {
    const b = bytesFromB64(sealed.slice(SEAL_PREFIX.length));
    if (b.length < 12 + 16 + 20) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12), additionalData: SEAL_AAD }, key, b.subarray(12));
    return new TextDecoder().decode(pt);
  } catch (e) { return null; }
}

// Antiabuso v1 (igual que la versión Firebase): tope por token, best-effort en memoria del isolate.
const WINDOW_MS = 5 * 60 * 1000, MAX_PER_WINDOW = 8, MAX_TRACKED = 5000;
const hits = new Map();
function rateLimited(token) {
  const now = Date.now();
  const arr = (hits.get(token) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(token, arr); return true; }
  arr.push(now); hits.set(token, arr);
  if (hits.size > MAX_TRACKED) { for (const k of hits.keys()) { if (hits.size <= MAX_TRACKED) break; hits.delete(k); } }
  return false;
}

function b64urlFromBytes(bytes) {
  let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromString(s) { return b64urlFromBytes(new TextEncoder().encode(s)); }

function pemToPkcs8(pem) {
  const body = String(pem).replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const raw = atob(body); const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

export function loadServiceAccount(env) {
  const txt = env && env.SA_B64;
  if (!txt) throw new Error('falta el secreto SA_B64');
  try { return JSON.parse(txt); } catch (e) { return JSON.parse(atob(String(txt).replace(/\s+/g, ''))); } // JSON crudo o base64
}

// Arma y FIRMA el JWT (RS256) del OAuth de Google. Pura (sin red): probada en test_sign.mjs.
export async function buildSignedJwt(sa, now) {
  now = now || Math.floor(Date.now() / 1000);
  const header = b64urlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlFromString(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signingInput = header + '.' + claim;
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)));
  return signingInput + '.' + b64urlFromBytes(sig);
}

async function getAccessToken(sa) {
  const jwt = await buildSignedJwt(sa);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('oauth sin access_token: ' + JSON.stringify(data));
  return data.access_token;
}

// 3248 (dueño 19-11, diagnóstico del S24: «toque a …: no salió (Failed to fetch)» en TODOS los toques): la app llama a este servicio
// desde el WebView, que antes de un POST con JSON manda una pregunta previa (OPTIONS). Este servicio la contestaba 405 y sin permisos
// CORS → el WebView bloqueaba el toque (nunca llegaba a Google). Ahora contesta la pregunta previa y manda CORS en todas las respuestas.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
function reply(body, init) { init = init || {}; init.headers = Object.assign({}, CORS, init.headers || {}); return Response.json(body, init); }

async function fcmSend(env, message) {
  const sa = loadServiceAccount(env);
  const token = await getAccessToken(sa);
  const r = await fetch(FCM_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  if (r.ok) { const d = await r.json(); return reply({ ok: true, id: d.name || '' }); }
  const errTxt = await r.text();
  const gone = r.status === 404 || /UNREGISTERED|registration-token-not-registered|NOT_FOUND|invalid-argument/i.test(errTxt);
  return reply({ error: 'fcm', status: r.status, gone: gone }, { status: gone ? 404 : 502 });
}
const validToken = (t) => typeof t === 'string' && t.length >= 20 && t.length <= 4096 && !t.startsWith(SEAL_PREFIX);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return reply({ error: 'usa POST' }, { status: 405 });
    let body = {};
    try { body = (await request.json()) || {}; } catch (e) {}
    try {
      // 14A: pedir el sello → va SOLO al teléfono dueño del token (nunca en la respuesta)
      if (body.seal !== undefined) {
        const tok = String(body.seal || '').trim();
        if (!validToken(tok)) return reply({ error: 'falta "seal" (token FCM)' }, { status: 400 });
        if (rateLimited('seal:' + tok)) return reply({ error: 'demasiadas peticiones de sello; espera' }, { status: 429 });
        const s = await sealToken(env, tok);
        if (!s) return reply({ error: 'sello no disponible' }, { status: 503 });
        return await fcmSend(env, { token: tok, data: { t: 'seal', s }, android: { priority: 'normal', ttl: '86400s', collapse_key: 'nexo_seal' } });
      }
      let to = String(body.to || '').trim();
      if (to.startsWith(SEAL_PREFIX)) {
        const opened = await unsealToken(env, to);
        if (!opened || !validToken(opened)) return reply({ error: 'sello no válido' }, { status: 403 });
        to = opened;
      } else if (env && env.ONLY_SEALED === '1') {
        return reply({ error: 'toque sin sello' }, { status: 403 });
      }
      if (!validToken(to)) return reply({ error: 'falta "to" (token FCM)' }, { status: 400 });
      if (rateLimited(to)) return reply({ error: 'demasiados toques para ese token; espera' }, { status: 429 });
      // Solo datos { t: 'wake' }, alta prioridad. 3246 (dueño 18-11, diagnósticos de Katy y Yael: el teléfono estuvo apagado o
      // sin red más de 60 s y el toque caducó; al volver nadie lo despertó hasta abrir la app a mano): ahora el toque espera
      // hasta 24 h en Google y, con collapse_key, solo queda UNO guardado por teléfono (no una ráfaga al reconectar).
      return await fcmSend(env, { token: to, data: { t: 'wake' }, android: { priority: 'high', ttl: '86400s', collapse_key: 'nexo_wake' } });
    } catch (e) {
      // T-P1: sin detalles internos hacia fuera
      return reply({ error: 'interno' }, { status: 500 });
    }
  },
};
