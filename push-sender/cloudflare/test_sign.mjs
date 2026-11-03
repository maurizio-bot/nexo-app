// Prueba la criptografía del worker (firma RS256 del JWT de OAuth) con una clave generada, sin tocar la red.
// Confirma que el JWT se arma y FIRMA bien (verificable con la clave pública). No prueba la llamada a FCM (eso
// necesita la clave real + un token). Uso: node test_sign.mjs
import { buildSignedJwt, loadServiceAccount } from './worker.js';

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s); const b = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
  return b;
}

const r = {};
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
const b64 = Buffer.from(pkcs8).toString('base64');
const pem = '-----BEGIN PRIVATE KEY-----\n' + b64.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
const sa = { client_email: 'firebase-adminsdk-xxxxx@nexo-7994a.iam.gserviceaccount.com', private_key: pem };

// 1) arma y firma el JWT
const now = 1700000000;
const jwt = await buildSignedJwt(sa, now);
const parts = jwt.split('.');
r.tres_partes = parts.length === 3;
const header = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
const claim = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
r.header_rs256 = header.alg === 'RS256' && header.typ === 'JWT';
r.claim_ok = claim.iss === sa.client_email && claim.scope.includes('firebase.messaging') && claim.aud.includes('oauth2.googleapis.com') && claim.iat === now && claim.exp === now + 3600;

// 2) la FIRMA es válida con la clave pública (lo que haría Google)
const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
r.firma_valida = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, b64urlToBytes(parts[2]), data);

// 3) loadServiceAccount acepta JSON crudo Y base64
r.lee_json_crudo = loadServiceAccount({ SA_B64: JSON.stringify(sa) }).client_email === sa.client_email;
r.lee_base64 = loadServiceAccount({ SA_B64: Buffer.from(JSON.stringify(sa)).toString('base64') }).client_email === sa.client_email;

const ok = r.tres_partes && r.header_rs256 && r.claim_ok && r.firma_valida && r.lee_json_crudo && r.lee_base64;
r.resultado = ok ? 'OK' : 'FALLO';
console.log('WORKER_SIGN ' + JSON.stringify(r));
process.exit(ok ? 0 : 1);
