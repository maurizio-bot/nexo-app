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

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return Response.json({ error: 'usa POST' }, { status: 405 });
    let to = '';
    try { to = String(((await request.json()) || {}).to || '').trim(); } catch (e) {}
    if (to.length < 20 || to.length > 4096) return Response.json({ error: 'falta "to" (token FCM)' }, { status: 400 });
    if (rateLimited(to)) return Response.json({ error: 'demasiados toques para ese token; espera' }, { status: 429 });
    try {
      const sa = loadServiceAccount(env);
      const token = await getAccessToken(sa);
      // MISMA forma que la versión Firebase: solo datos { t: 'wake' }, alta prioridad, caduca en 60 s.
      const msg = { message: { token: to, data: { t: 'wake' }, android: { priority: 'high', ttl: '60s' } } };
      const r = await fetch(FCM_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
      if (r.ok) { const d = await r.json(); return Response.json({ ok: true, id: d.name || '' }); }
      const errTxt = await r.text();
      const gone = r.status === 404 || /UNREGISTERED|registration-token-not-registered|NOT_FOUND|invalid-argument/i.test(errTxt);
      return Response.json({ error: 'fcm', status: r.status, gone: gone }, { status: gone ? 404 : 502 });
    } catch (e) {
      return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
    }
  },
};
