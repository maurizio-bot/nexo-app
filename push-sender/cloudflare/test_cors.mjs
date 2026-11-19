// 3248: el servicio del toque contesta la pregunta previa (OPTIONS) y manda CORS en sus respuestas.
import w from './worker.js';
const pre = await w.fetch(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }), {});
const get = await w.fetch(new Request('https://x.test/', { method: 'GET' }), {});
const bad = await w.fetch(new Request('https://x.test/', { method: 'POST', body: '{"to":"corto"}' }), {});
const r = {
  previa_2xx: pre.status === 204, previa_origen: pre.headers.get('Access-Control-Allow-Origin') === '*', previa_cabecera: /content-type/i.test(pre.headers.get('Access-Control-Allow-Headers') || ''),
  get_405_con_cors: get.status === 405 && get.headers.get('Access-Control-Allow-Origin') === '*',
  post_400_con_cors: bad.status === 400 && bad.headers.get('Access-Control-Allow-Origin') === '*',
};
r.resultado = Object.values(r).every(Boolean) ? 'OK' : 'FALLO';
console.log('WORKER_CORS ' + JSON.stringify(r));
process.exit(r.resultado === 'OK' ? 0 : 1);
