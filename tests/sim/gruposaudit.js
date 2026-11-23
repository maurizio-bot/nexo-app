// Auditoría de seguridad 23-11, sección 3 «Grupos»: los hallazgos G-B1, G-B2, G-L1, G-L2, G-O2, G-O3 y G-O4 (sus pruebas de
// concepto, convertidas en prueba). Mismo arnés que gruposfork.js: cada teléfono es un
// `Groups` de verdad (groups.js + group_admin.js + group_state.js de la copia compilada) con su clave P-256; el transporte es una cola.
//  B1  (dueño 10A) la rama de quien NO hace de creador solo gana en una carrera real (la que se descarta mide 1–2 estados):
//      a) carrera real (1 estado): como hoy (gana el NEXO ID menor);  b) un miembro con el NEXO ID menor ya no deshace un agregado
//      que lleva 3 estados (contraprueba: lo deshacía);  c) tampoco rellenando su rama;  d) un estado «sin cambios» solo lo firma
//      quien hace de creador;  e) el expulsado por un admin no vuelve rellenando una rama larga.
//  B2  el creador que ya salió no reescribe su salida (expulsar antes de irse / elegir heredero): gana la de MENOS estados antes.
//  L1  un NO miembro con el id del grupo no saca nombre ni miembros (no se le pide el estado ni se baja su copia del buzón, ni se
//      molesta al creador); la pregunta «mándame tu estado» no lleva nombre ni miembros.
//  L2  el teléfono de quien salió no entrega estados ni tarjetas a un contacto que no es miembro.
//  O2  no se entra a un grupo «abierto» ni con una creación (v1) que no firma su creador.
//  O3  quien salió por su cuenta y lo vuelven a agregar, vuelve (contraprueba: repetía la salida en silencio).
//  O4  llamada de grupo: un `offer` de quien no está en la llamada no lo mete (el que entra tarde, con la clave, sí).
// Uso: node gruposaudit.js [dir_build]
'use strict';
const path = require('path');
const { webcrypto } = require('crypto');
const { importSrc, buildDir } = require('./srcmod');
if (!global.crypto) global.crypto = webcrypto;
global.btoa = global.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
global.atob = global.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
class CE { constructor(name, init) { this.type = name; this.detail = init && init.detail; } }
global.CustomEvent = CE;
global.window = { addEventListener() {}, dispatchEvent() { return true; }, NEXO_GCALL_RING_MS: 45000 };
const realLog = console.log, realWarn = console.warn;
const logs = [];
console.log = (...a) => { logs.push(a.map(String).join(' ')); };
console.warn = (...a) => { logs.push('WARN ' + a.map(String).join(' ')); };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  const { Groups } = await importSrc('ui/groups.js');
  const G = await importSrc('ui/group_state.js');
  const r = { prueba: 'gruposaudit', build: path.basename(buildDir) };

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
      gs._throttle = function () { return ++this._throttleN < 200; };
      p.gs = gs;
    }
    W.know = (a, b) => { W.phones[a].contacts[W.phones[b].id] = W.phones[b].pub; W.phones[b].contacts[W.phones[a].id] = W.phones[a].pub; };
    W.knowAll = (l) => l.forEach((a) => l.forEach((b) => { if (a < b) W.know(a, b); }));
    W.byId = (id) => Object.values(W.phones).find((x) => x.id === id);
    W.flush = async (max) => {
      for (let round = 0; round < (max || 400); round++) {
        const ok = (m) => !W.held.has(W.byId(m.from).n) && !W.held.has(W.byId(m.to).n);
        const i = W.queue.findIndex(ok);
        if (i < 0) { await sleep(5); if (W.queue.findIndex(ok) < 0) break; continue; }
        const m = W.queue.splice(i, 1)[0];
        try { W.byId(m.to).gs.receive(JSON.parse(m.env), m.from, m.wid); } catch (e) { logs.push('EXC ' + (e && e.stack)); }
        await sleep(0);
      }
    };
    W.signAs = async (n, st) => { st.sg = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, W.phones[n].kp.privateKey, G.gsSigned(st))).toString('base64'); return G.gsClean(st); };
    W.forge = async (n, prev, ch) => W.signAs(n, G.gsNext(prev, W.phones[n].id, ch));
    W.inject = (to, from, gid, states, more) => { const id = 'gmf' + Math.random().toString(36).substring(2, 9); W.phones[to].gs.receive(Object.assign({ type: 'nexo_grp', g: gid, n: '', m: states[0].m, i: id, c: JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), s: states }, more || {}), W.phones[from].id, id + '_x'); };
    W.cards = (list) => list.map((n) => ({ nexoId: W.phones[n].id, name: n, publicKey: W.phones[n].pub }));
    W.st = (n, gid) => { const g = W.phones[n].gs.get(gid); return g && g.s ? g.s : null; };
    W.sig = (n, gid) => { const s = W.st(n, gid); return s ? s.v + ':' + JSON.stringify([s.cr, s.ad, s.m, s.bl, s.n, s.md]) : 'sin estado'; };
    W.to = (n) => W.queue.filter((m) => m.to === W.phones[n].id).map((m) => JSON.parse(m.env));
    return W;
  }
  async function newGroup(W, cr, others, md) {
    const P = W.phones;
    const g = P[cr].gs.create('Grupo', others.map((n) => P[n].id));
    const chain = await P[cr].gs.signGenesis(g.id, md || 'o', 0);
    P[cr].gs.sendText(g.id, JSON.stringify({ type: 'nexo_txt', t: 'creó', gs: 1 }), null, null, null, W.cards([cr].concat(others)), { s: chain });
    await W.flush();
    return g.id;
  }

  // ---- B1: ids B < C < D < E; creador D; modo colegas (todos agregan y renombran; expulsar, solo el creador) ----
  {
    // a) carrera real: C agrega a E (1 estado) y a la vez B renombra desde el mismo estado → gana B como hoy (NEXO ID menor)
    const W = await world(['B', 'C', 'D', 'E']); const P = W.phones; W.knowAll(['B', 'C', 'D', 'E']);
    const gid = await newGroup(W, 'D', ['B', 'C']);
    const base = W.st('B', gid);
    await P.C.gs.addMembers(gid, [P.E.id], W.cards(['B', 'C', 'D'])); await W.flush();
    const alt = await W.forge('B', base, { n: 'de B' });
    ['C', 'D'].forEach((n) => W.inject(n, 'B', gid, [alt])); await W.flush();
    r.B1a_carrera_real_como_hoy = ['C', 'D'].every((n) => W.st(n, gid).n === 'de B' && !W.st(n, gid).m.includes(P.E.id));
  }
  {
    // b) 3 estados ya establecidos, ninguno del creador (C agrega a E y renombra dos veces); B abre una rama desde antes
    const W = await world(['B', 'C', 'D', 'E']); const P = W.phones; W.knowAll(['B', 'C', 'D', 'E']);
    const gid = await newGroup(W, 'D', ['B', 'C']);
    const base = W.st('B', gid);
    await P.C.gs.addMembers(gid, [P.E.id], W.cards(['B', 'C', 'D'])); await W.flush();
    await P.C.gs.renameSigned(gid, 'uno'); await W.flush();
    await P.C.gs.renameSigned(gid, 'dos'); await W.flush();
    r.B1b_E_dentro_antes = ['B', 'C', 'D', 'E'].every((n) => W.st(n, gid).m.includes(P.E.id));
    const b1 = await W.forge('B', base, { n: 'de B' });
    ['C', 'D', 'E'].forEach((n) => W.inject(n, 'B', gid, [b1])); await W.flush();
    r.B1b_no_deshace_lo_establecido = ['C', 'D', 'E'].every((n) => W.st(n, gid).m.includes(P.E.id) && W.st(n, gid).n === 'dos');
    // c) rellenando su rama hasta igualar (3 estados): tampoco
    const b2 = await W.forge('B', b1, { n: 'de B 2' }), b3 = await W.forge('B', b2, { n: 'de B 3' });
    ['C', 'D', 'E'].forEach((n) => W.inject(n, 'B', gid, [b1, b2, b3])); await W.flush();
    r.B1c_ni_rellenando = ['C', 'D', 'E'].every((n) => W.st(n, gid).m.includes(P.E.id) && W.st(n, gid).n === 'dos');
    // d) un estado «sin cambios» solo lo firma quien hace de creador (no sirve para rellenar)
    const head = W.st('C', gid);
    r.B1d_vacio_de_miembro_no_vale = !!G.gsStepError(head, G.gsNext(head, P.B.id, {})) && !G.gsStepError(head, G.gsNext(head, P.D.id, {}));
    r.B1_todos_igual = W.sig('C', gid) === W.sig('D', gid) && W.sig('D', gid) === W.sig('E', gid);
  }
  {
    // e) modo control: el admin A (no creador) expulsa a M; M abre desde antes una rama larga (no vale: lo sacó quien manda más)
    const W = await world(['K', 'A', 'M', 'N']); const P = W.phones; W.knowAll(['K', 'A', 'M', 'N']);   // K creador, A admin
    const gid = await newGroup(W, 'K', ['A', 'M', 'N'], 'c');
    await P.K.gs.setAdmins(gid, [P.A.id]); await W.flush();
    const base = W.st('N', gid);
    await P.A.gs.kick(gid, P.M.id, false); await W.flush();
    // (relleno con agregados: un miembro puede agregar en este grupo; los «vacíos» ya no valen)
    const fakeIds = ['nxzzzzzzz1', 'nxzzzzzzz2', 'nxzzzzzzz3'];
    let prev = base, chain = [];
    for (const f of fakeIds) { prev = await W.forge('M', prev, { m: prev.m.concat([f]) }); chain.push(prev); }
    ['K', 'A', 'N'].forEach((n) => W.inject(n, 'M', gid, chain)); await W.flush();
    r.B1e_expulsado_no_vuelve_rellenando = ['K', 'A', 'N'].every((n) => !W.st(n, gid).m.includes(P.M.id) && !W.st(n, gid).m.includes('nxzzzzzzz1'));
  }

  // ---- B2: el creador que ya salió reescribe su salida (otra rama: expulsa al heredero y se va) ----
  {
    const W = await world(['A', 'B', 'C']); const P = W.phones; W.knowAll(['A', 'B', 'C']);
    const gid = await newGroup(W, 'A', ['B', 'C']);
    const base = W.st('A', gid);
    await P.A.gs.leaveSigned(gid); await W.flush();
    const exit = W.st('B', gid);
    // varios intentos (con el reloj t) para que su primer estado tenga la huella menor: antes bastaba con 1–2
    let k1 = null;
    for (let t = 1; t < 40; t++) { const s = G.gsNext(base, P.A.id, { m: [P.A.id, P.C.id], ad: [P.A.id] }); s.t = t; const c = await W.signAs('A', s); if (G.gsId(c) < G.gsId(exit)) { k1 = c; break; } }
    const k2 = await W.forge('A', k1, { m: [P.C.id], ad: [P.C.id], cr: P.C.id });
    ['B', 'C'].forEach((n) => W.inject(n, 'A', gid, [k1, k2])); await W.flush();
    r.B2_salida_no_se_reescribe = ['B', 'C'].every((n) => W.st(n, gid).m.includes(P.B.id) && W.st(n, gid).cr === P.B.id) && !P.B.gs.list[gid].kicked;
    r.B2_unidad = G.gsBranchWins([exit], [k1, k2], base) === true && G.gsBranchWins([k1, k2], [exit], base) === false;
  }

  // ---- L1: un NO miembro (X, contacto de V) con el id del grupo ----
  {
    const W = await world(['A', 'B', 'V', 'X']); const P = W.phones;
    W.know('A', 'B'); W.know('A', 'V'); W.know('B', 'V'); W.know('X', 'V');
    const gid = await newGroup(W, 'A', ['B', 'V']);
    await P.A.gs.renameSigned(gid, 'Nombre secreto'); await W.flush();
    const head = W.st('V', gid);
    let fetched = 0; P.V.gs._fetchCopy = () => { fetched++; };
    const bogus = Object.assign({}, head, { v: head.v + 3, p: 'e'.repeat(32), by: P.X.id, m: [P.X.id, P.V.id], ad: [P.X.id], cr: P.X.id });
    const sp = { u: 'x' };
    W.queue = [];
    for (let i = 0; i < 2; i++) P.V.gs.receive({ type: 'nexo_grp', g: gid, n: '', m: [P.X.id, P.V.id], i: 'gmz' + i, c: JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), s: [bogus], sp: sp }, P.X.id, 'gmz' + i + '_x');
    // y un salto falsificado «sin decir que es miembro» (cadena con quien manda de verdad, firmada por A no: por X)
    W.inject('V', 'X', gid, [Object.assign({}, head, { v: head.v + 1, p: G.gsId(head) })]);
    r.L1_no_contesta_al_no_miembro = W.to('X').length === 0;
    r.L1_no_molesta_al_creador = W.to('A').filter((e) => e.qg).length === 0;
    r.L1_no_baja_su_copia = fetched === 0;
    r.L1_estado_igual = W.st('V', gid).v === head.v && W.st('V', gid).n === 'Nombre secreto';
    // la pregunta «mándame tu estado» (a un miembro) no lleva nombre ni miembros
    W.queue = []; P.V.gs._askState(gid, P.B.id);
    const q = W.to('B')[0];
    r.L1_pregunta_sin_nombre_ni_miembros = !!q && q.q === 1 && !q.n && Array.isArray(q.m) && q.m.length === 0 && !q.k;
    await W.flush();
    r.L1_la_pregunta_se_contesta = W.sig('V', gid) === W.sig('B', gid);
  }

  // ---- L2: el teléfono de quien salió no entrega estados a un no miembro ----
  {
    const W = await world(['A', 'B', 'V', 'X']); const P = W.phones;
    W.know('A', 'B'); W.know('A', 'V'); W.know('B', 'V'); W.know('X', 'V');
    const gid = await newGroup(W, 'A', ['B', 'V']);
    await P.V.gs.leave(gid); await W.flush();
    W.queue = [];
    P.V.gs.receive({ type: 'nexo_grp', g: gid, n: '', m: [P.X.id, P.V.id], i: 'gmw', c: 'hola', sv: 9, sh: 'abcdefabcdef' }, P.X.id, 'gmw_x');
    r.L2_salido_no_entrega_a_cualquiera = W.to('X').length === 0;
    // a un miembro sí (sigue el ponerse al día de quien salió)
    P.V.gs.receive({ type: 'nexo_grp', g: gid, n: '', m: [P.A.id, P.V.id], i: 'gmv', c: 'hola', sv: 9, sh: 'abcdefabcdef' }, P.A.id, 'gmv_x');
    r.L2_a_un_miembro_si = W.to('A').length > 0;
  }

  // ---- O2: entrar a un grupo «abierto» o con una creación que no firma su creador ----
  {
    const W = await world(['V', 'X', 'Y']); const P = W.phones; W.knowAll(['V', 'X', 'Y']);
    const open = await W.signAs('X', { g: 'grabierto1', v: 1, p: '', cr: null, ad: [], md: 'o', ow: 0, oa: 0, m: [P.X.id, P.V.id, P.Y.id], bl: [], n: 'abierto', ph: '', by: P.X.id, t: 1, sg: '' });
    W.inject('V', 'X', 'grabierto1', [open], { k: W.cards(['X', 'Y']) });
    r.O2_no_entra_a_grupo_abierto = !P.V.gs.list.grabierto1 || !P.V.gs.list.grabierto1.s;
    // v1 «creado por Y» (Y de creador y admin) pero firmado por X en modo control: no es una creación válida
    const fake = await W.signAs('X', { g: 'grfalso001', v: 1, p: '', cr: P.Y.id, ad: [P.Y.id, P.X.id], md: 'c', ow: 1, oa: 1, m: [P.Y.id, P.X.id, P.V.id], bl: [], n: 'falso', ph: '', by: P.X.id, t: 1, sg: '' });
    W.inject('V', 'X', 'grfalso001', [fake], { k: W.cards(['X', 'Y']) });
    r.O2_creacion_ajena_no_vale = !P.V.gs.list.grfalso001 || !P.V.gs.list.grfalso001.s;
    // una creación de verdad sí
    const ok = await W.signAs('X', { g: 'grbueno001', v: 1, p: '', cr: P.X.id, ad: [P.X.id], md: 'c', ow: 0, oa: 0, m: [P.X.id, P.V.id], bl: [], n: 'bueno', ph: '', by: P.X.id, t: 1, sg: '' });
    W.inject('V', 'X', 'grbueno001', [ok]);
    r.O2_creacion_buena_entra = !!(P.V.gs.list.grbueno001 && P.V.gs.list.grbueno001.s);
  }

  // ---- O3: quien salió por su cuenta y lo vuelven a agregar ----
  {
    const W = await world(['A', 'B', 'C']); const P = W.phones; W.knowAll(['A', 'B', 'C']);
    const gid = await newGroup(W, 'A', ['B', 'C']);
    await P.C.gs.leave(gid); await W.flush();
    r.O3_salio = !!P.C.gs.get(gid).left && !W.st('B', gid).m.includes(P.C.id);
    await P.B.gs.addMembers(gid, [P.C.id], W.cards(['A', 'B', 'C'])); await W.flush();
    const gC = P.C.gs.get(gid);
    r.O3_vuelve = !gC.left && !gC.kicked && P.C.gs.all().some((g) => g.id === gid);
    r.O3_no_repite_la_salida = ['A', 'B'].every((n) => W.st(n, gid).m.includes(P.C.id)) && W.sig('C', gid) === W.sig('B', gid);
    // y si después sale otra vez, sale
    await P.C.gs.leave(gid); await W.flush();
    r.O3_puede_volver_a_salir = !!P.C.gs.get(gid).left && !W.st('A', gid).m.includes(P.C.id);
  }

  // ---- O4: llamada de grupo: offer de quien no está en la llamada ----
  {
    const { createGroupCall } = await importSrc('ui/group_call.js');
    const reg = {};
    const mk = (nx) => ({
      localNexoId: nx, _quietOut: new Set(), _callOut: new Set(),
      lan: { quality() { return { up: true }; }, canReach() { return true; } }, net: { mailboxOk() { return false; } }, _bleReadyFor() { return null; },
      sendChatMessage(to, json) { setTimeout(() => { const t = reg[to]; let o; try { o = JSON.parse(json); } catch (e) { return; } if (t && o.type === 'nexo_gcall') t.onSignal(nx, o); }, 0); return Promise.resolve(); },
      _sendMessageNative() { return Promise.resolve(); },
    });
    const hub = () => () => ({ start() { return Promise.resolve({ codec: 'opus' }); }, stop() {}, play() {}, playVideo() {}, camera() {}, mute() {}, flip() { return Promise.resolve('user'); }, drop() {} });
    const A = 'nxa0000001', B = 'nxb0000002', X = 'nxx0000009', F = 'nxf0000006';
    [A, B, X, F].forEach((n) => { reg[n] = createGroupCall(mk(n), hub()); });
    await reg[A].start([B], false, 'grllamada1'); await sleep(40);
    reg[B].accept(); await sleep(80);
    const gidc = reg[A].gc.gid;
    reg[A].onSignal(X, { type: 'nexo_gcall', op: 'offer', gid: gidc, from: X, to: A, ts: Date.now() });
    reg[A].onSignal(X, { type: 'nexo_gcall', op: 'accept', gid: gidc, from: X, to: A, ts: Date.now() });
    reg[A].onSignal(X, { type: 'nexo_gcall', op: 'offer', gid: gidc, from: X, to: A, k: 'f'.repeat(64), ts: Date.now() });
    await sleep(40);
    r.O4_offer_ajeno_no_entra = !reg[A].gc.roster.has(X) && !reg[A].gc.legs.has(X);
    // el que entra tarde (lo agrega B; A no lo tiene en su lista) abre su tramo con A con la clave
    await reg[B].addMember(F); await sleep(40);
    reg[F].accept(); await sleep(120);
    const lf = reg[A].gc.legs.get(F);
    r.O4_el_que_entra_tarde_si = reg[A].gc.roster.has(F) && !!lf && lf.state === 'active';
    Object.values(reg).forEach((c) => { try { c.hangup(); } catch (e) {} });
  }

  const fails = Object.keys(r).filter((k) => r[k] === false);
  r.resultado = fails.length ? 'FALLO' : 'OK';
  if (fails.length) r.fallan = fails;
  const exc = logs.filter((l) => /EXC/.test(l));
  if (exc.length) { r.resultado = 'FALLO'; r.excepciones = exc.slice(0, 2); }
  realLog('GRUPOSAUDIT ' + JSON.stringify(r));
  if (process.env.VERBOSE) realLog(logs.filter((l) => /GROUP|GCALL|EXC/.test(l)).join('\n'));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { realWarn(e); process.exit(1); });
