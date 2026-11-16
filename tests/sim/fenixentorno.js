// 3148 — FÉNIX ENTORNO, FASE 1 (oculto tras el interruptor de desarrollo): la cuenta que vuelve NO es la llave vieja (principio A)
// y el teléfono de siempre puede decir «no soy yo» (principio B, veto). Antes (3147): al recuperar, el teléfono nuevo escribía la
// identidad VIEJA (mismas llaves privadas) y los contactos no podían distinguirlo ni deshacerlo; no existían registros firmados.
//  E0  al respaldar (interruptor encendido) la copia NO lleva llaves privadas y sí la lista de guardianes firmada por la llave vieja;
//  E1  un contacto acepta la llave nueva con t atestaciones válidas (un guardián que no conoce cuenta por la lista firmada); queda
//      marcado (recoveredAt, sin verificar, rojo); sin la lista no llegan;
//  E2  rechaza: firma del registro mala, atestación falsificada, atestaciones robadas a otro registro;
//  E3  guardianes desconocidos no cuentan;  E4  pocas atestaciones;
//  E5  repetición (el mismo registro: no se aplica dos veces) y época vieja;
//  E6  veto ANTES de aceptar: el teléfono viejo recibe el reclamo, pide su desbloqueo y veta; el registro se rechaza;
//      sin desbloqueo confirmado no hay veto; sin método de desbloqueo, veto «sin desbloqueo»;
//  E7  veto DESPUÉS de aceptar: vuelve la llave vieja con aviso; un veto falsificado no hace nada; el registro repetido ya no entra;
//  E8  gana la prueba más fuerte: veto sin desbloqueo frente a un registro con retrato y firma vivos → solo aviso; con desbloqueo → deshace;
//  E9  la llave vieja sigue hablando tras la sucesión → conflicto marcado y se le reenvía el registro (para que pueda vetar);
//  E10 interruptor apagado (o APK con número de build) → lo que llega se ignora y se apunta; nada cambia;
//  E11 fenix.js: el guardián añade su atestación al fragmento y el teléfono nuevo NO escribe la identidad vieja (solo encendido).
// Contraprueba: en la 3147 no existe fenix_entorno.js.
// Uso: node fenixentorno.js <dir_build>
'use strict';
const { importSrc } = require('./srcmod');
const subtle = globalThis.crypto.subtle;
const b64 = (u) => Buffer.from(u).toString('base64');
async function phone() {
  const dh = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sg = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const ik = b64(new Uint8Array(await subtle.exportKey('raw', dh.publicKey)));
  const sk = b64(new Uint8Array(await subtle.exportKey('raw', sg.publicKey)));
  const sign = async (text) => b64(new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sg.privateKey, new TextEncoder().encode(text))));
  return { ik, sk, sign, privJwk: await subtle.exportKey('jwk', dh.privateKey) };
}
const tick = () => new Promise((r) => setTimeout(r, 30));
(async () => {
  const r = { prueba: 'fenixentorno' };
  const fs = {}; let writes = [];
  global.window = global.window || {};
  window.crypto = globalThis.crypto;
  window.Capacitor = { Plugins: { NexoBLE: {
    loadFromFile: async ({ filename }) => (fs[filename] != null ? { exists: true, content: fs[filename] } : { exists: false }),
    saveToFile: async ({ filename, content }) => { fs[filename] = content; writes.push(filename); return {}; },
    deleteFile: async () => ({}) } } };
  window.NEXO_FENIX_ENTORNO = true;
  const logs = []; const oLog = console.log, oWarn = console.warn;
  console.log = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
  let FE, FX;
  try { FE = await importSrc('fenix/fenix_entorno.js'); FX = await importSrc('fenix/fenix.js'); }
  catch (e) { console.log = oLog; console.warn = oWarn; r.resultado = 'FALLO'; r.error = 'sin Fénix Entorno: ' + String(e && e.message).slice(0, 120); console.log('FENIXENTORNO ' + JSON.stringify(r)); process.exit(1); }
  const { FenixEntorno, feCheckRecord, feBuildRecord, feAttest, feBuildVeto, feEnabled } = FE;
  const A = 'nxaaaaaaa1', C = 'nxcccccc01', G = ['nxgggggg01', 'nxgggggg02', 'nxgggggg03', 'nxgggggg04'], X = 'nxxxxxxxx1';
  const A0 = await phone(), A1 = await phone(), XK = await phone(), GK = [];
  for (let i = 0; i < 4; i++) GK.push(await phone());
  const bundles = { [A]: { ik: A0.ik, sk: A0.sk }, [G[0]]: { ik: GK[0].ik, sk: GK[0].sk }, [G[1]]: { ik: GK[1].ik, sk: GK[1].sk } }; // lo que C conoce
  const sends = [];
  const mkEnt = (me, signer, contacts, keys, t) => {
    const ble = { localNexoId: me, getBLEContacts: () => contacts.list, _sendMessageNative: async (dev, s) => { sends.push({ by: me, dev, p: JSON.parse(s) }); } };
    const e = new FenixEntorno(ble, { cfg: { t: t || 3 }, _readyDevice: (nx) => 'dev-' + nx });
    e.signer = signer; e.keys = (nx) => (keys || {})[nx] || null; e.ready = Promise.resolve();
    return e;
  };
  // Contactos de C: A con su llave vieja (verificada), G1 y G2 (G3 no es contacto suyo; G4 tampoco)
  const contactsOf = () => ({ list: [{ nexoId: A, name: 'Ana', publicKey: A0.ik, verified: A0.ik }, { nexoId: G[0], publicKey: GK[0].ik }, { nexoId: G[1], publicKey: GK[1].ik }] });
  let saved = null;
  window.vaultSaveContacts = (l) => { saved = l; };

  // E0: el teléfono viejo respalda: sin llaves privadas, lista de guardianes firmada (G1–G3)
  const oldC = { list: [0, 1, 2].map((i) => ({ nexoId: G[i], publicKey: GK[i].ik })) };
  const O = mkEnt(A, A0, oldC, { [G[0]]: bundles[G[0]], [G[1]]: bundles[G[1]], [G[2]]: { ik: GK[2].ik, sk: GK[2].sk } });
  const acc = { nexoId: A, identity: JSON.stringify({ v: 1, priv: A0.privJwk, pub: A0.ik }), ratchet: { ik: A0.ik, sign: { priv: { d: 'secreto' }, pub: A0.sk }, spks: [{ priv: 'x' }] },
    contacts: [], nodes: { [G[0]]: 1, [G[1]]: 2, [G[2]]: 3 }, n: 3, t: 3 };
  await O.decorateAccount(acc);
  const accTxt = JSON.stringify(acc);
  r.E0 = { sin_privadas: !/priv|secreto/.test(accTxt), lista: acc.ros && acc.ros.g.length };
  r.E0_ok = r.E0.sin_privadas && r.E0.lista === 3 && JSON.parse(acc.identity).pub === A0.ik;

  // Recuperación: el teléfono nuevo pide (con su llave de firma nueva) y 4 guardianes atestiguan (G4 no está en la lista)
  const N = mkEnt(A, A1, { list: [] }, {});
  const rec = {}; const extra = N.askExtra(rec);
  const atts = [];
  for (let i = 0; i < 4; i++) {
    const g = mkEnt(G[i], GK[i], { list: [{ nexoId: A, publicKey: A0.ik }] }, {});
    atts.push(await g.attest(A, { pk: A1.ik, fe: g.reqExtra(extra) }));
  }
  const pieces = atts.map((fa, i) => ({ by: G[i], fa }));
  const kept = await N.onRestore(acc, pieces.slice(0, 3), rec);
  const R = N.mine;
  r.E1_registro = { conserva_llave_nueva: kept, atestaciones: R && R.att.length, epoca: R && R.ep };

  // E1: C acepta
  let cC = contactsOf(); const EC = mkEnt(C, null, cC, bundles);
  const noRos = await feBuildRecord(A1.sign, Object.assign({}, R, { ros: null }));
  const resNoRos = await feCheckRecord(noRos, cC.list[0], EC._view(cC.list[0], cC.list));
  const e1 = await EC.onRecord(R, 'devA1');
  let a = cC.list[0];
  r.E1 = { resultado: e1, llave: a.publicKey === A1.ik ? 'nueva' : 'vieja', recuperada: !!a.recoveredAt, verificada: !!a.verified, epoca: a.fe && a.fe.ep, sin_lista: resNoRos.why + ' ' + resNoRos.valid };
  r.E1_ok = kept === true && e1 === 'accepted' && r.E1.llave === 'nueva' && r.E1.recuperada && !r.E1.verificada && r.E1.epoca === 1 && resNoRos.why === 'too_few' && resNoRos.valid === 2;

  // E2: falsificaciones (sobre un contacto C fresco)
  const fresh = () => { const cc = contactsOf(); const e = mkEnt(C, null, cc, bundles); return { cc, e }; };
  const why = async (rec2) => { const { cc, e } = fresh(); return (await feCheckRecord(rec2, cc.list[0], e._view(cc.list[0], cc.list))).why; };
  const tampered = Object.assign({}, R, { ts: R.ts + 1 });
  const forgedAtt = Object.assign({}, R, { att: R.att.map((x, i) => (i === 2 ? Object.assign({}, x, { sig: R.att[0].sig }) : x)) });
  const reSigned = await feBuildRecord(A1.sign, Object.assign({}, R, { att: forgedAtt.att }));
  const stolen = await feBuildRecord(XK.sign, { nx: A, ep: 1, ts: R.ts, n: R.n, old: R.old, nw: { ik: XK.ik, sk: XK.sk }, t: 3, att: R.att, ros: R.ros });
  r.E2 = { firma_mala: await why(tampered), atestacion_falsa: await why(reSigned), atestaciones_robadas: await why(stolen) };
  r.E2_ok = r.E2.firma_mala === 'bad_sig' && r.E2.atestacion_falsa === 'too_few' && r.E2.atestaciones_robadas === 'too_few';

  // E3 / E4: desconocidos y pocos
  const xAtt = await feAttest(XK.sign, { nx: A, ep: 1, n: R.n, oldIk: A0.ik, nwIk: A1.ik, nwSk: A1.sk, g: X, ts: R.ts, ev: ['sh'] });
  const recUnknown = await feBuildRecord(A1.sign, Object.assign({}, R, { att: [R.att[0], atts[3], xAtt] }));
  { const { cc, e } = fresh(); const res = await feCheckRecord(recUnknown, cc.list[0], e._view(cc.list[0], cc.list)); r.E3 = { why: res.why, validas: res.valid, desconocidos: res.unknown }; }
  r.E3_ok = r.E3.why === 'too_few' && r.E3.validas === 1 && r.E3.desconocidos === 2;
  const recFew = await feBuildRecord(A1.sign, Object.assign({}, R, { att: R.att.slice(0, 2) }));
  r.E4 = await why(recFew);
  r.E4_ok = r.E4 === 'too_few';

  // E5: repetición y época vieja
  const again = await EC.onRecord(R, 'devA1');
  const oldEp = await feBuildRecord(A1.sign, Object.assign({}, R, { n: 'f'.repeat(32) }));
  r.E5 = { mismo_registro: again, epoca_vieja: await EC.onRecord(oldEp, 'devX'), llave: cC.list[0].publicKey === A1.ik ? 'nueva' : 'vieja' };
  r.E5_ok = r.E5.mismo_registro === 'dup' && r.E5.epoca_vieja === 'old_epoch' && r.E5.llave === 'nueva';

  // E6: veto ANTES de aceptar. El teléfono viejo recibe el reclamo y veta (con su desbloqueo)
  sends.length = 0;
  const claim = await O.onRecord(R, 'devC');
  O.gate = async () => ({ need: true, ok: false });
  const noAuth = await O.veto(R.n);
  O.gate = async () => ({ need: true, ok: true });
  const vetoRes = await O.veto(R.n);
  const V = (sends.find((s) => s.p.type === 'fv') || {}).p;
  const { cc: c6, e: e6 } = fresh();
  const v6 = await e6.onVeto(V && V.r, 'devA0');
  const rec6 = await e6.onRecord(R, 'devA1');
  const O2 = mkEnt(A, A0, oldC, {}); O2.claims[R.n] = R; O2.gate = async () => ({ need: false, ok: false });
  const vNone = await O2.veto(R.n);
  r.E6 = { reclamo: claim, sin_desbloqueo_confirmado: noAuth, veto: vetoRes, veto_en_contacto: v6, registro: rec6, llave: c6.list[0].publicKey === A0.ik ? 'vieja' : 'nueva', sin_metodo: vNone };
  r.E6_ok = claim === 'claim' && noAuth === 'auth_failed' && vetoRes === 'sent:lock' && v6 === 'store' && rec6 === 'vetoed' && r.E6.llave === 'vieja' && vNone === 'sent:none';

  // E7: veto DESPUÉS de aceptar (C ya aceptó en E1). Primero vetos falsos
  const fakeX = await feBuildVeto(XK.sign, { nx: A, ep: 1, old: A0.ik, ts: Date.now(), au: 'lock' });
  const fakeNew = await feBuildVeto(A1.sign, { nx: A, ep: 1, old: A0.ik, ts: Date.now(), au: 'lock' });
  const f1 = await EC.onVeto(fakeX, 'devX'), f2 = await EC.onVeto(fakeNew, 'devX');
  const still = cC.list[0].publicKey === A1.ik;
  const v7 = await EC.onVeto(V.r, 'devA0');
  a = cC.list[0];
  const replay7 = await EC.onRecord(R, 'devA1');
  r.E7 = { veto_falso_otro: f1, veto_falso_llave_nueva: f2, sigue_nueva_tras_falsos: still, veto: v7, llave: a.publicKey === A0.ik ? 'vieja' : 'nueva', aviso: !!a.feWarn, rechazada: a.rejectedKey === A1.ik, registro_repetido: replay7 };
  r.E7_ok = f1 === 'bad_sig' && f2 === 'bad_sig' && still && v7 === 'rollback' && r.E7.llave === 'vieja' && r.E7.aviso && r.E7.rechazada && replay7 === 'replay';

  // E8: la prueba más fuerte gana (registro con retrato y firma vivos, rango 2)
  const strongAtts = [];
  for (let i = 0; i < 3; i++) strongAtts.push(await feAttest(GK[i].sign, { nx: A, ep: 1, n: 'e'.repeat(32), oldIk: A0.ik, nwIk: A1.ik, nwSk: A1.sk, g: G[i], ts: Date.now(), ev: ['sh', 'rv', 'fv'] }));
  const strongR = await feBuildRecord(A1.sign, { nx: A, ep: 1, ts: Date.now(), n: 'e'.repeat(32), old: { ik: A0.ik, sk: A0.sk }, nw: { ik: A1.ik, sk: A1.sk }, t: 3, att: strongAtts, ros: acc.ros });
  const { cc: c8, e: e8 } = fresh();
  const acc8 = await e8.onRecord(strongR, 'devA1');
  const weak = await feBuildVeto(A0.sign, { nx: A, ep: 1, old: A0.ik, ts: Date.now() + 1, au: 'none' });
  const w8 = await e8.onVeto(weak, 'devA0');
  const keyAfterWeak = c8.list[0].publicKey === A1.ik ? 'nueva' : 'vieja';
  const strongV = await feBuildVeto(A0.sign, { nx: A, ep: 1, old: A0.ik, ts: Date.now() + 2, au: 'lock' });
  const s8 = await e8.onVeto(strongV, 'devA0');
  r.E8 = { aceptado: acc8, veto_sin_desbloqueo: w8, llave_tras_debil: keyAfterWeak, veto_con_desbloqueo: s8, llave_final: c8.list[0].publicKey === A0.ik ? 'vieja' : 'nueva' };
  r.E8_ok = acc8 === 'accepted' && w8 === 'warn' && keyAfterWeak === 'nueva' && s8 === 'rollback' && r.E8.llave_final === 'vieja';

  // E9: la llave vieja sigue hablando tras la sucesión
  const { cc: c9, e: e9 } = fresh();
  await e9.onRecord(R, 'devA1');
  sends.length = 0;
  const k9 = e9.onKx(A, A0.ik, 'devA0');
  await tick();
  const back = sends.find((s) => s.dev === 'devA0' && s.p.type === 'fs');
  const kNew = e9.onKx(A, A1.ik, 'devA1');
  r.E9 = { detectado: k9, conflicto: !!c9.list[0].feConflict, llave: c9.list[0].publicKey === A1.ik ? 'nueva' : 'vieja', verificada: !!c9.list[0].verified, registro_reenviado: !!back, llave_nueva_no_marca: kNew === false };
  r.E9_ok = k9 === true && r.E9.conflicto && r.E9.llave === 'nueva' && !r.E9.verificada && r.E9.registro_reenviado && r.E9.llave_nueva_no_marca;

  // E10: interruptor apagado → se ignora y se apunta
  window.NEXO_FENIX_ENTORNO = false;
  const { cc: c10, e: e10 } = fresh();
  const n0 = logs.length;
  const h10 = e10.handle({ type: 'fs', r: R }, 'devA1');
  await tick();
  const ignoredLog = logs.slice(n0).some((l) => /ignorado: Fénix Entorno desactivado/.test(l));
  const offAttest = await mkEnt(G[0], GK[0], { list: [{ nexoId: A, publicKey: A0.ik }] }, {}).attest(A, { pk: A1.ik, fe: { n: R.n, nk: A1.sk } });
  const offRestore = await mkEnt(A, A1, { list: [] }, {}).onRestore(acc, pieces, rec);
  window.NEXO_FENIX_ENTORNO = true; window.NEXO_BUILD = '3148';
  const onInApk = feEnabled();
  delete window.NEXO_BUILD;
  r.E10 = { consumido: h10, apuntado: ignoredLog, llave: c10.list[0].publicKey === A0.ik ? 'vieja' : 'nueva', atestacion: offAttest, conserva_llave_nueva: offRestore, encendido_en_apk_con_numero: onInApk, por_defecto: FE.FE_ON_DEFAULT };
  r.E10_ok = h10 === true && ignoredLog && r.E10.llave === 'vieja' && offAttest === null && offRestore === false && onInApk === false && FE.FE_ON_DEFAULT === false;

  // E11: los enganches de fenix.js (guardián y teléfono nuevo)
  const e2e = await importSrc('vault/e2e_crypto.js');
  await e2e.initE2E();
  const myPk = e2e.e2eMyPublicKey();
  const files = [];
  const gBle = { localNexoId: G[0], getBLEContacts: () => [{ nexoId: A, publicKey: A0.ik }], ackSystem: { sendFile: async (dev, id, data) => { files.push(data); } } };
  const run11 = async () => {
    const g = new FX.Fenix(gBle); g._saveStore = async () => {}; g.ent.signer = GK[0]; g.ent.ready = Promise.resolve();
    g.store.owners[A] = { idx: 1, share: 'a'.repeat(64), blob: 'x', bh: 'y', ep: 1, n: 3, t: 3, rv: 'bt' };
    g._ensureLink = async () => 'devN';
    g._onRecoveryRequest(Object.assign({ rid: 'r' + files.length, pk: myPk, nm: 'Ana' }, { fe: { n: R.n, nk: A1.sk } }), 'nxnnnnnnn1', 'devN');
    await g.answerRecovery('r' + files.length, A);
    const out = JSON.parse(Buffer.from((await e2e.e2eDecryptToB64(files[files.length - 1])).b64, 'base64').toString('utf8'));
    return !!(out.fa && out.fa.g === G[0] && out.fa.sig);
  };
  const faOn = await run11();
  window.NEXO_FENIX_ENTORNO = false; const faOff = await run11(); window.NEXO_FENIX_ENTORNO = true;
  const restore = async () => {
    const nf = new FX.Fenix({ localNexoId: A, getBLEContacts: () => [] }); nf.ent.signer = A1; nf.recovery = { fe: { n: R.n } };
    writes = [];
    const acc11 = Object.assign({}, acc, { identity: JSON.stringify({ v: 1, priv: A0.privJwk, pub: A0.ik }), ratchet: { ik: A0.ik, sign: { pub: A0.sk }, spks: [] }, contacts: [] });
    await nf._restore(acc11, new Uint8Array(32), ['a'.repeat(64)], 1, pieces.slice(0, 3));
    return { identidad_vieja_escrita: writes.includes('nexo_e2e_identity.json'), registro: !!nf.ent.mine };
  };
  const rOn = await restore();
  window.NEXO_FENIX_ENTORNO = false; const rOff = await restore(); window.NEXO_FENIX_ENTORNO = true;
  r.E11 = { atestacion_en_fragmento: faOn, sin_interruptor: faOff, restaurar_encendido: rOn, restaurar_apagado: rOff };
  r.E11_ok = faOn === true && faOff === false && !rOn.identidad_vieja_escrita && rOn.registro && rOff.identidad_vieja_escrita && !rOff.registro;

  // Higiene: ninguna llave privada en el registro
  r.privadas_en_registro = logs.filter((l) => /"d":"|privJwk|secreto/.test(l)).length;
  console.log = oLog; console.warn = oWarn;
  const ok = r.E0_ok && r.E1_ok && r.E2_ok && r.E3_ok && r.E4_ok && r.E5_ok && r.E6_ok && r.E7_ok && r.E8_ok && r.E9_ok && r.E10_ok && r.E11_ok && r.privadas_en_registro === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXENTORNO ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FENIXENTORNO ' + JSON.stringify({ prueba: 'fenixentorno', resultado: 'FALLO', error: String(e && e.stack).slice(0, 600) })); process.exit(1); });
