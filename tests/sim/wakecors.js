// 3248: el toque sale como petición «simple» (sin pregunta previa) y, si el servicio no manda CORS, se reintenta en modo opaco.
const fs = require('fs'), path = require('path'), os = require('os');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/net/wake_post.js'), 'utf8');
  const tmp = path.join(os.tmpdir(), 'wake_post_' + process.pid + '.mjs'); fs.writeFileSync(tmp, src);
  const { wakePost } = await import(tmp); fs.unlinkSync(tmp);
  const r = {};
  // 1. servicio con CORS: una sola llamada, text/plain, se lee el estado
  let calls = [];
  let a = await wakePost('https://s.test/w', 'TOK-0123456789012345678901', (u, o) => { calls.push(o); return Promise.resolve({ status: 200 }); });
  r.una_llamada = calls.length === 1; r.sin_pregunta_previa = /^text\/plain/.test(calls[0].headers['Content-Type']);
  r.lee_estado = a.status === 200 && a.opaque === false; r.solo_token = JSON.parse(calls[0].body).to === 'TOK-0123456789012345678901' && Object.keys(JSON.parse(calls[0].body)).length === 1;
  // 2. servicio sin CORS (el navegador rechaza al leer): segundo intento opaco, resuelve
  calls = [];
  a = await wakePost('https://s.test/w', 'TOK-0123456789012345678901', (u, o) => { calls.push(o); return o.mode === 'no-cors' ? Promise.resolve({ type: 'opaque' }) : Promise.reject(new TypeError('Failed to fetch')); });
  r.reintenta_opaco = calls.length === 2 && calls[1].mode === 'no-cors'; r.resuelve_opaco = a.opaque === true && a.status === 0;
  // 3. sin red: los dos fallan → se rechaza (el llamador lo anota)
  let fallo = false;
  try { await wakePost('https://s.test/w', 'TOK-0123456789012345678901', () => Promise.reject(new TypeError('Failed to fetch'))); } catch (e) { fallo = true; }
  r.sin_red_rechaza = fallo;
  r.resultado = Object.values(r).every((v) => v === true) ? 'OK' : 'FALLO';
  console.log('WAKECORS ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})();
