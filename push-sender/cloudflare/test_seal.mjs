// 14A (dueño 23-11, auditoría T-P1): el sello del toque. Sin red: se simulan Google (OAuth) y FCM. Uso: node test_seal.mjs
import worker from './worker.js';

const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))).toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
const SA_B64 = JSON.stringify({ client_email: 'x@nexo-7994a.iam.gserviceaccount.com', private_key: pem });
const WAKE_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
  const m = JSON.parse(init.body).message; sent.push(m);
  return new Response(JSON.stringify({ name: 'projects/x/messages/1' }), { status: 200 });
};
const post = async (env, body) => { const r = await worker.fetch(new Request('https://w.test/', { method: 'POST', body: JSON.stringify(body) }), env); return { status: r.status, body: await r.json() }; };
const TOK = 'fcm-token-de-prueba-' + 'x'.repeat(140);
const env = { SA_B64, WAKE_KEY };
const r = {};

// 1) pedir el sello: la respuesta NO lo trae; va por FCM al propio token
let a = await post(env, { seal: TOK });
const sm = sent.pop();
r.sello_no_en_respuesta = a.status === 200 && !JSON.stringify(a.body).includes('s1.');
r.sello_al_propio_telefono = !!sm && sm.token === TOK && sm.data.t === 'seal' && /^s1\./.test(sm.data.s);
const SEALED = sm && sm.data.s;
// 2) toque con el sello: Google recibe el token REAL
a = await post(env, { to: SEALED });
const wm = sent.pop();
r.toque_con_sello = a.status === 200 && wm.token === TOK && wm.data.t === 'wake';
// 3) sello tocado / de otra clave → 403, nada a Google
const n0 = sent.length;
const bad = SEALED.slice(0, -3) + (SEALED.endsWith('A') ? 'B' : 'A') + SEALED.slice(-2);
r.sello_alterado_403 = (await post(env, { to: bad })).status === 403;
r.otra_clave_403 = (await post({ SA_B64, WAKE_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') }, { to: SEALED })).status === 403;
r.sello_de_sello_400 = (await post(env, { seal: SEALED })).status === 400;
r.nada_a_google = sent.length === n0;
// 4) transición: crudo aceptado; con ONLY_SEALED=1, rechazado
r.crudo_en_transicion = (await post(env, { to: TOK.replace('x', 'y') })).status === 200;
r.crudo_rechazado_estricto = (await post(Object.assign({ ONLY_SEALED: '1' }, env), { to: TOK.replace('x', 'z') })).status === 403;
r.sello_en_estricto = (await post(Object.assign({ ONLY_SEALED: '1' }, env), { to: SEALED })).status === 200;
// 5) sin WAKE_KEY: el sello no está disponible (503) y un sellado no se abre
r.sin_clave_503 = (await post({ SA_B64 }, { seal: TOK.replace('x', 'w') })).status === 503;
// 6) error interno sin detalles
globalThis.fetch = async () => { throw new Error('secreto: detalle interno'); };
const e = await post(env, { to: TOK.replace('x', 'v') });
r.error_generico = e.status === 500 && e.body.error === 'interno';
const ok = Object.values(r).every((v) => v === true);
console.log('SELLO ' + JSON.stringify(Object.assign(r, { resultado: ok ? 'OK' : 'FALLO' })));
process.exit(ok ? 0 : 1);
