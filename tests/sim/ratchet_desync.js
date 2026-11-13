// 3067 (diagnóstico del S24 13-11, 12:32–12:40): el Nubia se reinició en plena videollamada y desde entonces TODO lo que
// mandaba al S24 llegaba como «Mensaje ya recibido» (la comprobación del Wi-Fi cada ~12 s durante 8 min; sus textos sin
// confirmar), mientras lo del S24 al Nubia sí llegaba. Firma de un teléfono cuyo estado de cifrado quedó ATRÁS de lo que ya
// había mandado: vuelve a usar números de mensaje que el otro ya recibió (mismas claves, otro contenido) y el otro lo tira
// como repetición. Como el S24 no cambia de cadena hasta que recibe algo nuevo del Nubia, no se arregla nunca solo.
// Aquí: A y B hablan; el almacenamiento de A vuelve a una copia anterior (reinicio); se mide si la pareja se recupera.
// Uso: node ratchet_desync.js   (RATCHET_SRC=<carpeta con e2e_ratchet.js y e2e_crypto.js> para probar otro código)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = process.env.RATCHET_SRC ? path.resolve(process.env.RATCHET_SRC) : path.resolve(__dirname, '../../src/vault');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-desync-'));
const stores = {};
let current = null;
globalThis.window = {
  crypto: globalThis.crypto,
  Capacitor: { Plugins: { get NexoBLE() {
    const st = stores[current];
    return {
      loadFromFile: async ({ filename }) => (filename in st ? { exists: true, content: st[filename] } : { exists: false }),
      saveToFile: async ({ filename, content }) => { st[filename] = content; return { success: true }; },
    };
  } } },
};
const quiet = console.log;
const logs = [];
console.log = (...a) => logs.push(a.join(' '));
console.warn = (...a) => logs.push(a.join(' '));
let copies = 0;
async function phone(name) {
  stores[name] = stores[name] || {};
  const dir = path.join(tmp, name + '-' + (++copies));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'e2e_crypto.mjs'), fs.readFileSync(path.join(SRC, 'e2e_crypto.js')));
  fs.writeFileSync(path.join(dir, 'e2e_ratchet.mjs'), fs.readFileSync(path.join(SRC, 'e2e_ratchet.js'), 'utf8').replace("'./e2e_crypto.js'", "'./e2e_crypto.mjs'")
    .replace("'@noble/post-quantum/ml-kem.js'", "'" + pathToFileURL(path.join(__dirname, '.deps/node_modules/@noble/post-quantum/ml-kem.js')).href + "'"));
  const m = await import(pathToFileURL(path.join(dir, 'e2e_ratchet.mjs')).href);
  const c = await import(pathToFileURL(path.join(dir, 'e2e_crypto.mjs')).href);
  const p = { name, nx: 'nx' + name.toLowerCase(), m, c };
  p.run = async (fn) => { current = name; try { return await fn(m, c); } finally { current = null; } };
  await p.run((m) => m.ratchetInit());
  p.ik = await p.run((m, c) => c.e2eMyPublicKey());
  p.bundle = await p.run((m) => m.ratchetMyBundle());
  return p;
}
const ad = (from, to, id) => from.nx + '|' + to.nx + '|' + id;
async function enc(from, to, text, id) { return from.run((m) => m.ratchetEncryptText(to.nx, to.ik, text, ad(from, to, id))); }
async function dec(to, from, packed, id) {
  try { return await to.run((m) => m.ratchetDecryptText(from.nx, packed, ad(from, to, id))); }
  catch (e) { return { err: e.code || e.message }; }
}
const fields = (packed) => packed.split(':')[1].split('.').length; // 3: sesión en curso; 6/7: sesión nueva (X3DH)

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); quiet((ok ? 'OK   ' : 'FALLO') + ' ' + name + (detail ? ' — ' + detail : '')); }

(async () => {
  let A = await phone('A');
  let B = await phone('B');
  await B.run((m) => m.ratchetNotePeerBundle(A.nx, A.bundle));
  await A.run((m) => m.ratchetNotePeerBundle(B.nx, B.bundle));

  // Conversación normal en los dos sentidos
  let n = 0;
  const talk = async (from, to, k) => { let ok = true; for (let i = 0; i < k; i++) { const id = 'c' + (++n); const t = 'm' + n; const r = await dec(to, from, await enc(from, to, t, id), id); if (r.text !== t) ok = false; } return ok; };
  check('conversación inicial en los dos sentidos', (await talk(A, B, 3)) && (await talk(B, A, 2)) && (await talk(A, B, 3)));

  // 1) Repetición VERDADERA (el mismo paquete) tras reiniciar B (sin la caché en memoria): DUP, y B no abre sesión nueva
  const idR = 'rep1';
  const rep = await enc(A, B, 'se repetirá', idR);
  check('repetición: primera vez se lee', (await dec(B, A, rep, idR)).text === 'se repetirá');
  B = await phone('B');
  const r1 = await dec(B, A, rep, idR);
  check('repetición verdadera tras reiniciar → DUP (se confirma, nada más)', r1.err === 'DUP', JSON.stringify(r1));
  const bAfterRep = await enc(B, A, 'tras la repetición', 'br1');
  check('repetición verdadera: B sigue en la misma sesión (sin cabecera inicial)', fields(bAfterRep) === 3, 'campos ' + fields(bAfterRep));
  check('y A lo lee', (await dec(A, B, bAfterRep, 'br1')).text === 'tras la repetición');

  // 2) El estado de A vuelve ATRÁS: copia guardada; A manda 6 más (B los lee); A arranca con la copia vieja
  check('A manda unos cuantos', await talk(A, B, 2));
  const snapA = JSON.parse(JSON.stringify(stores.A));
  // Después de la copia la conversación sigue en los DOS sentidos (como en la videollamada): las cadenas avanzan
  check('después de la copia siguen hablando (B lee todo)', (await talk(A, B, 6)) && (await talk(B, A, 2)) && (await talk(A, B, 3)) && (await talk(B, A, 1)) && (await talk(A, B, 2)));
  stores.A = snapA;
  A = await phone('A');
  logs.length = 0;

  // Lo nuevo de A reutiliza números que B ya recibió (mismas claves, otro contenido)
  const x1 = await enc(A, B, 'tras volver atrás 1', 'x1');
  const rx1 = await dec(B, A, x1, 'x1');
  check('lo de A tras volver atrás NO se toma por repetición (se detecta el desfase)', rx1.err && rx1.err !== 'DUP', JSON.stringify(rx1));
  // B contesta: tras detectar el desfase debe abrir sesión nueva (A no tiene ya las claves de la cadena actual de B)
  const y1 = await enc(B, A, 'respuesta de B', 'y1');
  check('B tras el desfase empieza sesión nueva (cabecera inicial)', fields(y1) >= 6, 'campos ' + fields(y1));
  const ry1 = await dec(A, B, y1, 'y1');
  check('A lee lo de B', ry1.text === 'respuesta de B', JSON.stringify(ry1));
  // Y ahora lo de A debe llegar (antes: «Mensaje ya recibido» para siempre)
  let back = 0;
  for (let i = 0; i < 10; i++) { const id = 'x' + (i + 2); if ((await dec(B, A, await enc(A, B, 'vuelta ' + i, id), id)).text === 'vuelta ' + i) back++; }
  check('tras la respuesta de B, lo de A vuelve a llegar (10 de 10)', back === 10, back + ' de 10');
  check('y en los dos sentidos', await talk(B, A, 3) && await talk(A, B, 3));
  check('B lo anota en el diagnóstico', logs.some((l) => /desfas|ya usad/i.test(l)), logs.filter((l) => /E2E/.test(l)).slice(0, 3).join(' | '));

  // 3) Tras reiniciar los dos todo sigue (la sesión nueva quedó guardada)
  A = await phone('A'); B = await phone('B');
  check('tras reiniciar los dos, sigue', await talk(A, B, 2) && await talk(B, A, 2));

  // 4) Un paquete del desfase que llega tarde (reintento de algo de antes) no rompe la sesión nueva
  const late = await dec(B, A, x1, 'x1');
  check('un reintento del desfase que llega tarde no se muestra', !late.text, JSON.stringify(late));
  check('y la sesión nueva sigue', await talk(A, B, 2) && await talk(B, A, 1));

  // 5) Desfase cuando la huella ya se olvidó: después de la copia el otro recibió MUCHO más (60 mensajes de otra cadena).
  //    Los primeros números reutilizados son ambiguos (pueden ser repeticiones: se tiran); al pasar del largo que esa
  //    cadena tuvo de verdad (imposible para un teléfono al día) se detecta y se abre sesión nueva.
  let C = await phone('C');
  const D = await phone('D');
  await D.run((m) => m.ratchetNotePeerBundle(C.nx, C.bundle));
  await C.run((m) => m.ratchetNotePeerBundle(D.nx, D.bundle));
  check('C y D hablan', (await talk(C, D, 2)) && (await talk(D, C, 1)) && (await talk(C, D, 2)));
  const snapC = JSON.parse(JSON.stringify(stores.C));
  check('después de la copia: 5 más, respuesta y 60 de otra cadena', (await talk(C, D, 5)) && (await talk(D, C, 1)) && (await talk(C, D, 60)));
  stores.C = snapC;
  C = await phone('C');
  logs.length = 0;
  let firstDesync = -1, dups = 0;
  for (let i = 0; i < 12 && firstDesync < 0; i++) {
    const id = 'z' + i, r = await dec(D, C, await enc(C, D, 'zeta ' + i, id), id);
    if (r.err === 'DESYNC') firstDesync = i; else if (r.err === 'DUP') dups++;
  }
  check('huella olvidada: se detecta al pasar del largo real de la cadena (6.º mensaje)', firstDesync === 5 && dups === 5, 'desfase en ' + firstDesync + ', repeticiones antes ' + dups);
  const w1 = await enc(D, C, 'D abre sesión nueva', 'w1');
  check('D abre sesión nueva y C la lee', fields(w1) >= 6 && (await dec(C, D, w1, 'w1')).text === 'D abre sesión nueva');
  let backC = 0;
  for (let i = 0; i < 5; i++) { const id = 'zz' + i; if ((await dec(D, C, await enc(C, D, 'zz ' + i, id), id)).text === 'zz ' + i) backC++; }
  check('y lo de C vuelve a llegar (5 de 5)', backC === 5, backC + ' de 5');

  // 6) Repeticiones verdaderas de cadenas viejas (muchas, tras reiniciar) NUNCA abren sesión nueva
  const E = await phone('E'), F0 = await phone('F');
  await F0.run((m) => m.ratchetNotePeerBundle(E.nx, E.bundle));
  await E.run((m) => m.ratchetNotePeerBundle(F0.nx, F0.bundle));
  const olds = [];
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < 9; i++) { const id = 'o' + r + '_' + i; const pk = await enc(E, F0, 'o', id); await dec(F0, E, pk, id); olds.push([pk, id]); }
    await talk(F0, E, 1);
  }
  const F = await phone('F'); // sin la caché en memoria
  let allDup = true;
  for (const [pk, id] of olds) { const r = await dec(F, E, pk, id); if (r.err !== 'DUP') { allDup = false; quiet('   ', id, JSON.stringify(r)); break; } }
  check('72 repeticiones verdaderas de 8 cadenas (tras reiniciar) → todas DUP', allDup);
  const fAfter = await enc(F, E, 'sigo en la misma sesión', 'fa');
  check('y F no abre sesión nueva por ellas', fields(fAfter) === 3, 'campos ' + fields(fAfter));

  const fails = results.filter((r) => !r.ok).length;
  quiet('RESULTADO ' + (fails ? 'FALLO ' + fails + ' de ' + results.length : 'OK ' + results.length + ' comprobaciones'));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch((e) => { quiet('ERROR', e && e.stack); process.exit(2); });
