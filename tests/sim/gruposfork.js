// COLA 4b «Grupos: administración» — revisión de la sesión principal (22-11): CARRERAS y BIFURCACIONES del estado firmado.
// Varios teléfonos en un solo proceso: cada uno es un `Groups` de verdad (groups.js + group_admin.js + group_state.js de la copia
// compilada) con su propia clave P-256; lo único simulado es el transporte (una cola que entrega los sobres cuando la prueba
// quiere: así se arman a mano los cruces que en la radio simulada salen una vez de cada cien).
//  1. Grupo VIEJO (sin estado): B (no creador) agrega a D como primer cambio → D debe entrar.
//  2. Carrera honesta: el creador A sale (v3b) a la vez que B hace DOS cambios (v3a, v4a) → todos deben acabar en el MISMO estado.
//  3. Grupo viejo donde un teléfono cree que el creador es otro (le llegó primero el mensaje de B): el primer cambio firmado no
//     debe partir el grupo para siempre.
//  4. Firma retocada (S alto ↔ S bajo, mismo contenido): no cuenta como un estado distinto.
//  5. Un admin expulsado abre (app trucada) una rama desde ANTES de su expulsión, aunque sea más larga: nadie la toma.
//  6. Un creador que salió abre una rama desde antes de su salida: no vuelve por la fuerza.
//  7. El creador, sin cobertura, cambia algo; mientras, un admin agrega a D y renombra. Al cruzarse gana el creador (D queda fuera
//     en los demás); el admin vuelve a agregar a D, que viene de la rama que perdió y no puede engancharse: se lo dice al creador,
//     este REAFIRMA el estado y D queda al día.
//  8. Una SALIDA que pierde el cruce con el cambio de un admin sin cobertura: el teléfono del que salió la repite sola.
//  9. A uno lo expulsan y el aviso no le llega: cuando escribe al grupo, quien lo recibe le manda el cambio que lo sacó.
// Uso: node gruposfork.js [dir_build]
'use strict';
const path = require('path');
const { webcrypto } = require('crypto');
const { importSrc, buildDir } = require('./srcmod');
if (!global.crypto) global.crypto = webcrypto;
global.btoa = global.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
global.atob = global.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
class CE { constructor(name, init) { this.type = name; this.detail = init && init.detail; } }
global.CustomEvent = CE;
const listeners = {};
global.window = {
  addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  dispatchEvent() { return true; },
};
const realLog = console.log, realWarn = console.warn;
const logs = [];
console.log = (...a) => { logs.push(a.map(String).join(' ')); };
console.warn = (...a) => { logs.push('WARN ' + a.map(String).join(' ')); };

(async () => {
  const { Groups } = await importSrc('ui/groups.js');
  const G = await importSrc('ui/group_state.js');
  const r = { prueba: 'gruposfork', build: path.basename(buildDir) };

  // ---- un «mundo»: teléfonos + cola de sobres ----
  async function world(names) {
    const W = { phones: {}, queue: [], held: new Set() };
    for (const n of names) {
      const id = 'nx' + n.toLowerCase().repeat(7) + (names.indexOf(n) + 1);
      const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
      W.phones[n] = { n, id, kp, pub, contacts: {} };
    }
    for (const n of names) {
      const p = W.phones[n];
      const ble = {
        localNexoId: p.id, getNextSeq() { return 0; }, net: null,
        addSharedContacts(cards) { (cards || []).forEach((c) => { if (c && c.nexoId && c.publicKey && !p.contacts[c.nexoId]) p.contacts[c.nexoId] = c.publicKey; }); },
        sendChatMessage(to, env, wid) { W.queue.push({ from: p.id, to, env, wid }); return Promise.resolve(); },
      };
      const gs = new Groups(ble);
      gs._sign = async (s) => { s.sg = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, p.kp.privateKey, G.gsSigned(s))).toString('base64'); return s; };
      gs._keyOf = function (nx, cards) { nx = String(nx).toLowerCase(); if (nx === p.id) return p.pub; return p.contacts[nx] || ((cards && this._cardKeys && this._cardKeys[nx]) || null); };
      gs._throttleN = 0;
      gs._throttle = function () { return ++this._throttleN < 200; };   // sin esperar el minuto, pero con tope (un bucle se nota)
      p.gs = gs;
    }
    W.know = (a, b) => { W.phones[a].contacts[W.phones[b].id] = W.phones[b].pub; W.phones[b].contacts[W.phones[a].id] = W.phones[a].pub; };
    W.byId = (id) => Object.values(W.phones).find((x) => x.id === id);
    // Entrega lo que haya en la cola (y lo que se vaya generando) salvo lo de/para los teléfonos «retenidos»
    W.flush = async (max) => {
      let n = 0;
      for (let round = 0; round < (max || 400); round++) {
        const i = W.queue.findIndex((m) => !W.held.has(W.byId(m.from).n) && !W.held.has(W.byId(m.to).n));
        if (i < 0) { await new Promise((res) => setTimeout(res, 5)); if (W.queue.findIndex((m) => !W.held.has(W.byId(m.from).n) && !W.held.has(W.byId(m.to).n)) < 0) break; continue; }
        const m = W.queue.splice(i, 1)[0];
        const dst = W.byId(m.to);
        try { dst.gs.receive(JSON.parse(m.env), m.from, m.wid); } catch (e) { logs.push('EXC ' + (e && e.stack)); }
        n++;
        await new Promise((res) => setTimeout(res, 0));
      }
      return n;
    };
    // Estado firmado «a mano» por un teléfono (app trucada) y sobre que lo lleva a otro
    W.forge = async (n, prev, ch) => { const st = G.gsNext(prev, W.phones[n].id, ch); st.sg = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, W.phones[n].kp.privateKey, G.gsSigned(st))).toString('base64'); return G.gsClean(st); };
    W.inject = (to, from, gid, states) => { const id = 'gmf' + Math.random().toString(36).substring(2, 9); W.phones[to].gs.receive({ type: 'nexo_grp', g: gid, n: '', m: states[0].m, i: id, c: JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), s: states }, W.phones[from].id, id + '_x'); };
    W.dropTo = (n) => { W.queue = W.queue.filter((m) => W.byId(m.to).n !== n); };
    W.cards = (list) => list.map((n) => ({ nexoId: W.phones[n].id, name: n, publicKey: W.phones[n].pub }));
    W.st = (n, gid) => { const g = W.phones[n].gs.get(gid); return g && g.s ? g.s : null; };
    W.sig = (n, gid) => { const s = W.st(n, gid); return s ? s.v + ':' + JSON.stringify([s.cr, s.ad, s.m, s.bl, s.n, s.md]) : 'sin estado'; };
    return W;
  }
  // Grupo NUEVO firmado (v1) creado por `cr` con los demás, entregado a todos
  async function newGroup(W, cr, others, md) {
    const P = W.phones;
    const g = P[cr].gs.create('Grupo', others.map((n) => P[n].id));
    const chain = await P[cr].gs.signGenesis(g.id, md || 'o', 0);
    P[cr].gs.sendText(g.id, JSON.stringify({ type: 'nexo_txt', t: 'creó', gs: 1 }), null, null, null, W.cards([cr].concat(others)), { s: chain });
    await W.flush();
    return g.id;
  }
  // Grupo VIEJO (sin estado): lista y creador puestos a mano en cada teléfono (createdBy puede diferir: `crOf`)
  function oldGroup(W, gid, members, crOf) {
    members.forEach((n) => { W.phones[n].gs.list[gid] = { id: gid, name: 'Viejo', members: members.map((x) => W.phones[x].id), createdBy: W.phones[crOf[n] || crOf['*']].id, createdAt: 1, lastMessageAt: 0, unreadCount: 0 }; });
  }

  // ---- 1. grupo viejo: B (no creador) agrega a D ----
  {
    const W = await world(['A', 'B', 'C', 'D']);
    W.know('A', 'B'); W.know('A', 'C'); W.know('B', 'C'); W.know('B', 'D');
    const gid = 'grviejo001';
    oldGroup(W, gid, ['A', 'B', 'C'], { '*': 'A' });
    await W.phones.B.gs.addMembers(gid, [W.phones.D.id], W.cards(['A', 'B', 'C', 'D']));
    await W.flush();
    r.viejo_A_y_C_aceptan = !!W.st('A', gid) && W.st('A', gid).m.length === 4 && !!W.st('C', gid) && W.st('C', gid).m.length === 4;
    r.viejo_D_entra = !!W.st('D', gid) && W.st('D', gid).m.indexOf(W.phones.D.id) >= 0;
  }

  // ---- 2. carrera: el creador sale a la vez que B hace dos cambios ----
  {
    const W = await world(['A', 'B', 'C']);
    W.know('A', 'B'); W.know('A', 'C'); W.know('B', 'C');
    const gid = await newGroup(W, 'A', ['B', 'C'], 'o');
    await W.phones.A.gs.setAdmins(gid, [W.phones.B.id]); await W.flush();
    r.carrera_base_v2 = ['A', 'B', 'C'].every((n) => W.st(n, gid) && W.st(n, gid).v === 2);
    W.held.add('B');                                  // B sin cobertura: hace dos cambios
    await W.phones.B.gs.renameSigned(gid, 'de B 1');
    await W.phones.B.gs.renameSigned(gid, 'de B 2');
    await W.phones.A.gs.leave(gid); await W.flush();   // mientras, sale el creador (pasa a B) y C lo recibe
    r.carrera_C_ve_salir_a_A = !!W.st('C', gid) && W.st('C', gid).m.length === 2;
    W.held.delete('B'); await W.flush();              // vuelve la cobertura: se cruzan
    await W.phones.C.gs.renameSigned(gid, 'de C').catch(() => {}); await W.flush();
    await W.phones.B.gs.renameSigned(gid, 'de B 3').catch(() => {}); await W.flush();
    r.carrera_B = W.sig('B', gid); r.carrera_C = W.sig('C', gid);
    r.carrera_converge = W.sig('B', gid) === W.sig('C', gid);
    r.carrera_A_fuera = !!W.st('B', gid) && W.st('B', gid).m.indexOf(W.phones.A.id) < 0;
  }

  // ---- 3. grupo viejo con creador distinto según el teléfono ----
  {
    const W = await world(['A', 'B', 'C']);
    W.know('A', 'B'); W.know('A', 'C'); W.know('B', 'C');
    const gid = 'grviejo002';
    oldGroup(W, gid, ['A', 'B', 'C'], { '*': 'A', C: 'B' });   // a C le llegó primero un mensaje de B: cree que lo creó B
    await W.phones.A.gs.renameSigned(gid, 'Nombre nuevo'); await W.flush();
    await W.phones.A.gs.renameSigned(gid, 'Nombre nuevo 2'); await W.flush();
    r.viejo2_B = W.sig('B', gid); r.viejo2_C = W.sig('C', gid);
    r.viejo2_no_se_parte = W.sig('B', gid) === W.sig('C', gid) && W.sig('A', gid) === W.sig('B', gid);
  }

  // ---- 4. firma retocada (mismo contenido, S cambiada) ----
  {
    const W = await world(['A', 'B']);
    W.know('A', 'B');
    const gid = await newGroup(W, 'A', ['B'], 'o');
    await W.phones.A.gs.renameSigned(gid, 'Dos'); await W.flush();
    const s = Object.assign({}, W.st('B', gid));
    const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
    const raw = Buffer.from(s.sg, 'base64');
    const S2 = (N - BigInt('0x' + raw.subarray(32).toString('hex'))).toString(16).padStart(64, '0');
    const twin = Object.assign({}, s, { sg: Buffer.concat([raw.subarray(0, 32), Buffer.from(S2, 'hex')]).toString('base64') });
    r.retocada_verifica = G.gsVerify(G.gsClean(twin), W.phones.A.pub);
    const before = logs.length;
    W.phones.B.gs.receive({ type: 'nexo_grp', g: gid, n: 'Dos', m: s.m, i: 'gmx1', c: JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), s: [twin] }, W.phones.A.id, 'gmx1_b');
    r.retocada_no_cuenta_como_otro = !logs.slice(before).some((l) => /Empate/.test(l));
  }

  // ---- 5. un admin expulsado abre una rama desde antes de su expulsión ----
  {
    const W = await world(['A', 'B', 'C']);
    W.know('A', 'B'); W.know('A', 'C'); W.know('B', 'C');
    const gid = await newGroup(W, 'A', ['B', 'C'], 'o');
    await W.phones.A.gs.setAdmins(gid, [W.phones.B.id]); await W.flush();
    const v2 = Object.assign({}, W.st('B', gid));
    await W.phones.C.gs.renameSigned(gid, 'de C'); await W.flush();              // v3: un miembro normal
    await W.phones.A.gs.kick(gid, W.phones.B.id, false); await W.flush();         // v4: el creador expulsa al admin B
    r.expulsado_base = W.st('C', gid).v === 4 && W.st('C', gid).m.indexOf(W.phones.B.id) < 0;
    const b3 = await W.forge('B', v2, { n: 'vuelvo' }), b4 = await W.forge('B', b3, { n: 'vuelvo 2' }), b5 = await W.forge('B', b4, { n: 'vuelvo 3' });
    W.inject('A', 'B', gid, [b3, b4, b5]); W.inject('C', 'B', gid, [b3, b4, b5]); await W.flush();
    r.expulsado_no_vuelve = ['A', 'C'].every((n) => W.st(n, gid).m.indexOf(W.phones.B.id) < 0 && W.st(n, gid).n === 'de C');
  }

  // ---- 6. un creador que salió abre una rama desde antes de su salida ----
  {
    const W = await world(['A', 'B', 'C']);
    W.know('A', 'B'); W.know('A', 'C'); W.know('B', 'C');
    const gid = await newGroup(W, 'A', ['B', 'C'], 'o');
    await W.phones.A.gs.setAdmins(gid, [W.phones.B.id]); await W.flush();
    const v2 = Object.assign({}, W.st('B', gid));
    await W.phones.A.gs.leave(gid); await W.flush();
    await W.phones.C.gs.renameSigned(gid, 'sin A'); await W.flush();
    const a3 = await W.forge('A', v2, { n: 'sigo siendo el creador' });
    W.inject('B', 'A', gid, [a3]); W.inject('C', 'A', gid, [a3]); await W.flush();
    r.creador_que_salio_no_vuelve = ['B', 'C'].every((n) => W.st(n, gid).cr === W.phones.B.id && W.st(n, gid).m.indexOf(W.phones.A.id) < 0 && W.st(n, gid).n === 'sin A');
  }

  // ---- 7. gana el cambio del creador sin cobertura; el agregado en la rama que perdió se engancha cuando el creador reafirma ----
  {
    const W = await world(['A', 'B', 'C', 'D']);
    W.know('A', 'B'); W.know('A', 'C'); W.know('B', 'C'); W.know('B', 'D');
    const gid = await newGroup(W, 'A', ['B', 'C'], 'c');
    await W.phones.A.gs.setAdmins(gid, [W.phones.B.id]); await W.flush();
    W.held.add('A');
    await W.phones.A.gs.renameSigned(gid, 'del creador');                          // a3, sin cobertura
    await W.phones.B.gs.addMembers(gid, [W.phones.D.id], W.cards(['A', 'B', 'C', 'D'])); await W.flush();   // b3
    await W.phones.B.gs.renameSigned(gid, 'de B'); await W.flush();                // b4: D va en v4
    r.reafirma_D_entra = !!W.st('D', gid) && W.st('D', gid).v === 4;
    const mark = logs.length;
    W.held.delete('A'); await W.flush();
    r.reafirma_gana_el_creador = ['A', 'B', 'C'].every((n) => W.st(n, gid).n === 'del creador' && W.st(n, gid).m.indexOf(W.phones.D.id) < 0);
    r.reafirma_B_avisado = logs.slice(mark).some((l) => /Un cambio mío en .* perdió el cruce/.test(l));
    await W.phones.B.gs.addMembers(gid, [W.phones.D.id], W.cards(['A', 'B', 'C', 'D'])); await W.flush();
    for (let i = 0; i < 4 && W.sig('D', gid) !== W.sig('A', gid); i++) {           // D pide, sigue sin enganchar, se lo dice al creador
      W.phones.D.gs.sendText(gid, 'hola', null, null); await W.flush();
      W.phones.B.gs.sendText(gid, 'hola D', null, null); await W.flush();
    }
    r.reafirma_reafirmo = logs.slice(mark).some((l) => /Reafirmo el estado/.test(l));
    r.reafirma_A = W.sig('A', gid); r.reafirma_D = W.sig('D', gid);
    r.reafirma_todos_igual = ['B', 'C', 'D'].every((n) => W.sig(n, gid) === W.sig('A', gid)) && W.st('A', gid).m.indexOf(W.phones.D.id) >= 0;
    r.reafirma_sin_bucle = Object.values(W.phones).every((p) => p.gs._throttleN < 60);
  }

  // ---- 8. una salida pierde el cruce con el cambio de un admin sin cobertura: se repite sola ----
  {
    const W = await world(['A', 'B', 'C']);
    W.know('A', 'B'); W.know('A', 'C'); W.know('B', 'C');
    const gid = await newGroup(W, 'A', ['B', 'C'], 'o');
    await W.phones.A.gs.setAdmins(gid, [W.phones.B.id]); await W.flush();
    W.held.add('B');
    await W.phones.B.gs.renameSigned(gid, 'de B');                                // b3, sin cobertura
    await W.phones.C.gs.leave(gid); await W.flush();                              // c3: A lo ve salir
    r.salida_A_ve_salir_a_C = W.st('A', gid).m.indexOf(W.phones.C.id) < 0;
    W.held.delete('B'); await W.flush();
    r.salida_A = W.sig('A', gid); r.salida_B = W.sig('B', gid);
    r.salida_se_repite = ['A', 'B'].every((n) => W.st(n, gid).m.indexOf(W.phones.C.id) < 0 && W.st(n, gid).n === 'de B') && W.sig('A', gid) === W.sig('B', gid);
    r.salida_C_sigue_fuera = !!W.phones.C.gs.get(gid).left && !W.phones.C.gs.get(gid).kicked;
  }

  // ---- 9. expulsado que no se enteró: al escribir, le mandan el cambio que lo sacó ----
  {
    const W = await world(['A', 'B', 'C']);
    W.know('A', 'B'); W.know('A', 'C'); W.know('B', 'C');
    const gid = await newGroup(W, 'A', ['B', 'C'], 'o');
    W.held.add('C');
    await W.phones.A.gs.kick(gid, W.phones.C.id, false); await W.flush();
    W.dropTo('C'); W.held.delete('C');                                            // el aviso de la expulsión se perdió
    r.noenterado_C_cree_estar = !W.phones.C.gs.get(gid).kicked;
    W.phones.C.gs.sendText(gid, 'sigo aquí', null, null); await W.flush();
    r.noenterado_C_se_entera = !!W.phones.C.gs.get(gid).kicked && W.st('C', gid).v === 2;
  }

  // ---- 10. la huella de la foto del grupo es SHA-256 ----
  {
    const A = await importSrc('ui/group_admin.js');
    const h = A.groupPhotoHash('data:image/jpeg;base64,AAAA');
    r.foto_huella_sha256 = /^p[0-9a-f]{32}$/.test(h) && h !== A.groupPhotoHash('data:image/jpeg;base64,AAAB') && A.groupPhotoHash('') === '';
  }

  const fails = Object.keys(r).filter((k) => r[k] === false);
  r.resultado = fails.length ? 'FALLO' : 'OK';
  if (fails.length) r.fallan = fails;
  realLog('GRUPOSFORK ' + JSON.stringify(r));
  if (process.env.VERBOSE) realLog(logs.filter((l) => /GROUP|EXC/.test(l)).join('\n'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { realWarn(e); process.exit(1); });
