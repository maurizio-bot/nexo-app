// Protocolo 2 (src/vault/e2e_ratchet.js) solo, sin la app: varios "teléfonos" en el mismo proceso, cada uno
// con su copia del módulo y su almacenamiento. Orden, desorden, pérdidas, repeticiones, datos manipulados,
// inicio simultáneo, reinicio, relleno, número de seguridad e impostor.
// Uso: node ratchet.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.resolve(__dirname, '../../src/vault');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ratchet-'));
const stores = {};      // nombre → { archivo: contenido }
let current = null;     // teléfono que está operando (las operaciones se esperan una a una)
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
console.log = () => {};
let copies = 0;
// Una "app" = una copia nueva de los módulos (reiniciar = otra copia con el mismo almacenamiento)
async function phone(name) {
  stores[name] = stores[name] || {};
  const dir = path.join(tmp, name + '-' + (++copies));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'e2e_crypto.mjs'), fs.readFileSync(path.join(SRC, 'e2e_crypto.js')));
  fs.writeFileSync(path.join(dir, 'e2e_ratchet.mjs'), fs.readFileSync(path.join(SRC, 'e2e_ratchet.js'), 'utf8').replace("'./e2e_crypto.js'", "'./e2e_crypto.mjs'"));
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
async function dec(to, from, packed, id, adOverride) {
  try { return await to.run((m) => m.ratchetDecryptText(from.nx, packed, adOverride || ad(from, to, id))); }
  catch (e) { return { err: e.code || e.message }; }
}

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); quiet((ok ? 'OK   ' : 'FALLO') + ' ' + name + (detail ? ' — ' + detail : '')); }

(async () => {
  let A = await phone('A');
  let B = await phone('B');

  // Paquetes de claves
  const bad = Object.assign({}, A.bundle, { spk: B.bundle.spk });
  check('paquete con firma falsa rechazado', (await B.run((m) => m.ratchetNotePeerBundle(A.nx, bad))) === false);
  check('paquetes válidos aceptados', (await B.run((m) => m.ratchetNotePeerBundle(A.nx, A.bundle))) && (await A.run((m) => m.ratchetNotePeerBundle(B.nx, B.bundle))));
  check('sin paquete no se puede cifrar', !(await A.run((m) => m.ratchetCanEncrypt('nxz', B.ik))) && await A.run((m) => m.ratchetCanEncrypt(B.nx, B.ik)));

  // Primer mensaje y varios antes de respuesta, recibidos en desorden
  const a = [];
  for (let i = 0; i < 4; i++) a.push(await enc(A, B, 'hola ' + i, 'm' + i));
  check('formato E2 con cabecera inicial', a.every((x) => x.startsWith('E2:') && x.split(':')[1].split('.').length === 6));
  const order = [0, 3, 1, 2];
  let okAll = true;
  for (const i of order) { const r = await dec(B, A, a[i], 'm' + i); if (r.text !== 'hola ' + i || r.senderKey !== A.ik) { okAll = false; quiet('   ', i, r); } }
  check('primeros mensajes en desorden', okAll);
  check('reintento idéntico → DUP (se confirma sin mostrar)', (await dec(B, A, a[1], 'm1')).dup === true);

  // Respuesta: paso del ratchet; luego conversación
  const b0 = await enc(B, A, 'respuesta', 'r0');
  check('respuesta sin cabecera inicial', b0.split(':')[1].split('.').length === 3);
  check('A descifra la respuesta', (await dec(A, B, b0, 'r0')).text === 'respuesta');
  const a4 = await enc(A, B, 'ya sin cabecera', 'm4');
  check('A deja de enviar la cabecera inicial', a4.split(':')[1].split('.').length === 3);
  check('B la descifra', (await dec(B, A, a4, 'm4')).text === 'ya sin cabecera');
  okAll = true;
  for (let i = 0; i < 6; i++) {
    const x = await enc(i % 2 ? A : B, i % 2 ? B : A, 'turno ' + i, 't' + i);
    const r = await dec(i % 2 ? B : A, i % 2 ? A : B, x, 't' + i);
    if (r.text !== 'turno ' + i) okAll = false;
  }
  check('conversación alterna (6 turnos)', okAll);

  // Pérdidas y llegada tardía
  const l = [];
  for (let i = 0; i < 5; i++) l.push(await enc(A, B, 'lote ' + i, 'l' + i));
  const r4 = await dec(B, A, l[4], 'l4');
  const r1 = await dec(B, A, l[1], 'l1');
  check('mensaje perdido no bloquea los siguientes y uno tardío llega', r4.text === 'lote 4' && r1.text === 'lote 1');

  // Datos manipulados
  check('id del sobre cambiado → no se descifra', (await dec(B, A, l[2], 'l2', ad(A, B, 'otro'))).err === 'BAD');
  check('emisor del sobre cambiado → no se descifra', (await dec(B, A, l[2], 'l2', 'nxq|' + B.nx + '|l2')).err === 'BAD');
  const parts = l[2].split(':');
  const ctb = Buffer.from(parts[2], 'base64'); ctb[5] ^= 1;
  check('texto cifrado alterado → no se descifra', (await dec(B, A, parts[0] + ':' + parts[1] + ':' + ctb.toString('base64'), 'l2')).err === 'BAD');
  const hf = parts[1].split('.'); hf[2] = String(Number(hf[2]) + 1);
  check('cabecera alterada → no se descifra', (await dec(B, A, parts[0] + ':' + hf.join('.') + ':' + parts[2], 'l2')).err === 'BAD');
  check('tras los intentos fallidos el bueno sigue descifrando', (await dec(B, A, l[2], 'l2')).text === 'lote 2');
  check('un mensaje para B no lo descifra C', await (async () => { const C = await phone('C'); return (await dec(C, A, a[0], 'm0')).err === 'BAD'; })());

  // Reinicio de B: estado guardado; repeticiones detectadas sin la caché
  const prevB = B.ik;
  B = await phone('B');
  check('tras reiniciar B, misma identidad', B.ik === prevB);
  check('reinicio: repetición de uno ya leído → DUP', (await dec(B, A, l[4], 'l4')).err === 'DUP');
  check('reinicio: repetición de un primer mensaje → DUP', (await dec(B, A, a[0], 'm0')).err === 'DUP');
  check('reinicio: repetición de una cadena anterior → DUP', (await dec(B, A, a4, 'm4')).err === 'DUP');
  check('reinicio: el saltado (lote 3) aún llega', (await dec(B, A, l[3], 'l3')).text === 'lote 3');
  check('reinicio: y ya no otra vez', (await dec(B, A, l[3], 'l3')).dup === true);
  A = await phone('A');
  const x1 = await enc(A, B, 'tras reiniciar los dos', 'x1');
  const y1 = await enc(B, A, 'seguimos', 'y1');
  check('reinicio de los dos: siguen hablando', (await dec(B, A, x1, 'x1')).text === 'tras reiniciar los dos' && (await dec(A, B, y1, 'y1')).text === 'seguimos');

  // Secreto hacia delante: ninguna clave de mensaje recibido queda guardada
  const stB = JSON.parse(stores.B['nexo_ratchet.json']);
  const sess = stB.sessions[A.nx];
  check('sin claves de mensajes saltados pendientes salvo los perdidos', sess[0].skippedOrder.length <= 1, 'pendientes: ' + sess[0].skippedOrder.length);

  // Inicio simultáneo
  const C = await phone('C2'), D = await phone('D');
  await C.run((m) => m.ratchetNotePeerBundle(D.nx, D.bundle));
  await D.run((m) => m.ratchetNotePeerBundle(C.nx, C.bundle));
  const c0 = await enc(C, D, 'de C', 'c0'), d0 = await enc(D, C, 'de D', 'd0');
  okAll = (await dec(D, C, c0, 'c0')).text === 'de C' && (await dec(C, D, d0, 'd0')).text === 'de D';
  for (let i = 0; i < 8; i++) {
    const s = i % 3 ? C : D, t = s === C ? D : C;
    const x = await enc(s, t, 'sim ' + i, 's' + i);
    if ((await dec(t, s, x, 's' + i)).text !== 'sim ' + i) okAll = false;
  }
  check('inicio simultáneo: los dos se entienden después', okAll);

  // Relleno
  const pad = A.m.ratchetPad, unpad = A.m.ratchetUnpad;
  let padOk = true;
  for (const n of [0, 1, 158, 159, 160, 4000, 5000, 100000, 1234567]) {
    const src = new Uint8Array(n).fill(7);
    const pp = pad(src);
    if (unpad(pp).length !== n || pp.length < n + 1 || (n < 4096 && pp.length % 160) || pp.length > (n + 1) * 1.13 + 160) padOk = false;
  }
  check('relleno: tamaños por tramos y vuelta exacta', padOk);
  const short = await enc(A, B, 'si', 'p1'), longer = await enc(A, B, 'x'.repeat(120), 'p2');
  check('"si" y un texto de 120 letras miden lo mismo cifrados', short.split(':')[2].length === longer.split(':')[2].length);
  await dec(B, A, short, 'p1'); await dec(B, A, longer, 'p2');

  // Archivos (bytes)
  const big = Buffer.alloc(1500000); for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
  const packed = await A.run((m) => m.ratchetEncryptB64(B.nx, B.ik, big.toString('base64'), ad(A, B, 'f1')));
  const back = await B.run((m) => m.ratchetDecryptToB64(A.nx, packed, ad(A, B, 'f1')));
  check('archivo de 1,5 MB ida y vuelta', back.b64 === big.toString('base64'));

  // Número de seguridad
  const snA = await A.run((m) => m.ratchetSafetyNumber(A.nx, B.nx, B.ik));
  const snB = await B.run((m) => m.ratchetSafetyNumber(B.nx, A.nx, A.ik));
  check('número de seguridad: 60 cifras e igual en los dos', snA === snB && /^(\d{5} ){11}\d{5}$/.test(snA), snA);
  const E = await phone('E');
  const snE = await B.run((m) => m.ratchetSafetyNumber(B.nx, A.nx, E.ik));
  check('número de seguridad distinto con otra clave', snE !== snA);

  // Impostor: E (y otra clave más) dicen ser A ante B; B lo sabe por senderKey y las sesiones buenas siguen
  const E2 = await phone('E2');
  for (const imp of [E, E2]) {
    await imp.run((m) => m.ratchetNotePeerBundle(B.nx, B.bundle));
    const fake = await imp.run((m) => m.ratchetEncryptText(B.nx, B.ik, 'soy A', A.nx + '|' + B.nx + '|e'));
    const r = await dec(B, A, fake, 'e');
    if (r.senderKey !== imp.ik) check('impostor: clave del emisor real', false, JSON.stringify(r));
  }
  check('impostor: se descifra pero con su propia clave (quien llama lo retiene)', true);
  const z = await enc(A, B, 'sigo siendo A', 'z1');
  check('impostor con dos claves no echa la sesión buena', (await dec(B, A, z, 'z1')).text === 'sigo siendo A');
  const zb = await enc(B, A, 'te leo', 'z2');
  check('B sigue cifrando para la clave aceptada', (await dec(A, B, zb, 'z2')).text === 'te leo');
  await B.run((m) => m.ratchetForget(A.nx, E.ik));
  check('olvidar la clave rechazada', !JSON.parse(stores.B['nexo_ratchet.json']).sessions[A.nx].some((s) => s.rik === E.ik));

  // El otro perdió su estado del protocolo 2 (misma identidad, clave previa nueva) antes de responder: la
  // sesión iniciada no le sirve; con su paquete nuevo (kx al reconectar) se empieza otra
  const F = await phone('F'), G = await phone('G');
  await F.run((m) => m.ratchetNotePeerBundle(G.nx, G.bundle));
  const f0 = await enc(F, G, 'antes', 'f0');
  delete stores.G['nexo_ratchet.json'];
  const G2 = await phone('G');
  check('estado perdido: lo iniciado antes no se descifra', (await dec(G2, F, f0, 'f0')).err === 'BAD');
  await F.run((m) => m.ratchetNotePeerBundle(G2.nx, G2.bundle));
  const f1 = await enc(F, G2, 'después', 'f1');
  check('estado perdido: con el paquete nuevo se inicia otra sesión', f1.split(':')[1].split('.').length === 6 && (await dec(G2, F, f1, 'f1')).text === 'después');
  const g1 = await enc(G2, F, 'ok', 'g1');
  check('estado perdido: y sigue la conversación', (await dec(F, G2, g1, 'g1')).text === 'ok');

  // Mensaje antiguo con cabecera inicial reenviado a un B "reinstalado" (identidad nueva) → no se descifra
  stores.B2 = {};
  const B2 = await phone('B2');
  check('identidad nueva no descifra lo anterior', (await dec(B2, A, a[0], 'm0')).err === 'BAD');

  const fails = results.filter((r) => !r.ok).length;
  quiet('RESULTADO ' + (fails ? 'FALLO ' + fails + ' de ' + results.length : 'OK ' + results.length + ' comprobaciones'));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch((e) => { quiet('ERROR', e && e.stack); process.exit(2); });
