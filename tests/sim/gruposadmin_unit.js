// COLA 4b «Grupos: administración» (dueño 20-11), G2/G4/G5/G9 — prueba de UNIDAD del estado firmado (src/ui/group_state.js):
// firma (ECDSA P-256 con la clave de identidad), validación de cada paso con los permisos del estado ANTERIOR (lo hace cumplir el
// que recibe), versión y empate, creador no expulsable, un admin no expulsa a otro admin, bloqueo solo del creador, modo Colegas,
// grupo abierto cuando no queda creador ni admins, y la salida del creador (pasa al admin más antiguo).
// Uso: node gruposadmin_unit.js [dir_build]
'use strict';
const path = require('path');
const { webcrypto } = require('crypto');
const { importSrc, buildDir } = require('./srcmod');
global.btoa = global.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
global.atob = global.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));

(async () => {
  const G = await importSrc('ui/group_state.js');
  const r = { prueba: 'gruposadmin_unit', build: path.basename(buildDir) };
  const ids = { a: 'nxaaaaaaa1', b: 'nxbbbbbbb2', c: 'nxccccccc3', d: 'nxddddddd4', e: 'nxeeeeeee5' };
  const keys = {};
  for (const k of Object.keys(ids)) {
    const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    keys[ids[k]] = { kp, pub: Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64') };
  }
  const sign = async (s) => { s.sg = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys[s.by].kp.privateKey, G.gsSigned(s))).toString('base64'); return G.gsClean(s); };
  const step = async (prev, by, ch) => sign(G.gsNext(prev, by, ch));
  const ok = (prev, next) => G.gsStepError(prev, next) === null;
  const { a, b, c, d, e } = ids;
  // v1: A crea en modo CONTROL con B, C, D; solo admins escriben
  const s1 = await sign({ g: 'grtest0001', v: 1, cr: a, ad: [a], md: 'c', ow: 1, oa: 0, m: [a, b, c, d], bl: [], n: 'Equipo', ph: '', by: a, t: 1, sg: '' });
  r.firma_valida = G.gsVerify(s1, keys[a].pub) && G.gsGenesisError(s1) === null;
  r.firma_de_otro_no = !G.gsVerify(s1, keys[b].pub);
  { const x = Object.assign({}, s1, { n: 'Cambiado' }); r.estado_tocado_no_vale = !G.gsVerify(x, keys[a].pub); }
  r.forma_rara_no_entra = [Object.assign({}, s1, { m: s1.m.concat([a]) }), Object.assign({}, s1, { ad: [b] }), Object.assign({}, s1, { bl: [b] }), Object.assign({}, s1, { m: Array(33).fill(0).map((_, i) => 'nx' + String(i).padStart(8, '0')) }), Object.assign({}, s1, { sg: 'x' })].every((x) => G.gsClean(x) === null);
  // permisos en control
  r.control_escribe_solo_admin = G.gsCan(s1, a, 'write') && !G.gsCan(s1, b, 'write');
  r.control_no_admin_no_agrega = !G.gsCan(s1, c, 'add') && G.gsCan(s1, a, 'add');
  r.no_miembro_nada = !G.gsCan(s1, e, 'write');
  // v2: A hace admin a B
  const s2 = await step(s1, a, { ad: [a, b] });
  r.A_hace_admin_a_B = ok(s1, s2);
  // un no admin (C) no hace admin a nadie ni cambia el nombre ni agrega
  r.C_no_designa = !ok(s2, await step(s2, c, { ad: [a, b, c] }));
  r.C_no_renombra = !ok(s2, await step(s2, c, { n: 'Mío' }));
  r.C_no_agrega = !ok(s2, await step(s2, c, { m: s2.m.concat([e]) }));
  // B (admin): agrega, renombra y expulsa a un miembro normal; NO expulsa al creador ni a otro admin; no bloquea; no cambia ajustes
  r.B_agrega = ok(s2, await step(s2, b, { m: s2.m.concat([e]) }));
  r.B_renombra = ok(s2, await step(s2, b, { n: 'Equipo 2' }));
  r.B_expulsa_a_D = ok(s2, await step(s2, b, { m: [a, b, c] }));
  r.B_no_expulsa_al_creador = !ok(s2, await step(s2, b, { m: [b, c, d], ad: [b], cr: b })) && !ok(s2, await step(s2, b, { m: [b, c, d], ad: [b] }));
  r.B_no_bloquea = !ok(s2, await step(s2, b, { m: [a, b, c], bl: [d] }));
  r.B_no_cambia_modo = !ok(s2, await step(s2, b, { md: 'o' })) && !ok(s2, await step(s2, b, { ow: 0 }));
  const s3 = await step(s2, a, { ad: [a, b, c] });   // C también admin
  r.admin_no_expulsa_admin = !ok(s3, await step(s3, b, { m: [a, b, d], ad: [a, b] }));
  r.admin_no_quita_admin = !ok(s3, await step(s3, b, { ad: [a, b] }));
  r.admin_se_quita_a_si_mismo = ok(s3, await step(s3, c, { ad: [a, b] }));
  r.creador_expulsa_admin = ok(s3, await step(s3, a, { m: [a, b, d], ad: [a, b] }));
  r.orden_de_admins_fijo = !ok(s3, await step(s3, a, { ad: [a, c, b] }));
  r.creador_no_se_cambia = !ok(s3, await step(s3, a, { cr: b, ad: [b, a, c] }));
  // bloquear: solo el creador; el bloqueado no vuelve (ni lo agrega un admin) hasta que el creador lo desbloquee
  const s4 = await step(s3, a, { m: [a, b, c], ad: [a, b, c], bl: [d] });
  r.creador_expulsa_y_bloquea = ok(s3, s4);
  r.admin_no_vuelve_a_agregar_bloqueado = G.gsClean(G.gsNext(s4, b, { m: [a, b, c, d] })) === null && !ok(s4, await step(s4, b, { m: [a, b, c, d], bl: [] }));
  r.creador_vuelve_a_agregar_bloqueado = ok(s4, await step(s4, a, { m: [a, b, c, d], bl: [] }));
  r.admin_no_desbloquea = !ok(s4, await step(s4, b, { bl: [] }));
  const s5 = await step(s4, a, { bl: [] });
  r.creador_desbloquea = ok(s4, s5);
  r.bloqueado_firma_nada = !ok(s4, await sign(G.gsNext(s4, d, { n: 'x' })));
  // salir: cualquiera; si sale el creador, pasa al admin más antiguo (B); salida que además cambia otra cosa, no
  const s6 = await step(s5, a, { m: [b, c], ad: [b, c], cr: b });
  r.creador_sale_pasa_a_B = ok(s5, s6) && s6.cr === b;
  r.salida_con_trampa_no = !ok(s5, await step(s5, a, { m: [b, c], ad: [c, b], cr: c })) && !ok(s5, await step(s5, c, { m: [a, b], ad: [a, b], n: 'x' }));
  r.B_no_saca_a_admin_C = !ok(s5, await step(s5, b, { m: [a, b], ad: [a, b] }));
  // sale el creador y no hay admins (dueño 22-11): el mando pasa al MIEMBRO más antiguo (B); el grupo ya no queda «abierto», y el
  // que sale no elige heredero (ni cambiando el orden de los miembros)
  const o1 = await sign({ g: 'grtest0002', v: 1, cr: a, ad: [a], md: 'c', ow: 1, oa: 0, m: [a, b, c], bl: [], n: 'X', ph: '', by: a, t: 1, sg: '' });
  const o2 = await step(o1, a, { m: [b, c], ad: [b], cr: b });
  r.sin_admins_pasa_al_miembro_mas_antiguo = ok(o1, o2) && !G.gsOpen(o2) && G.gsIsBoss(o2, b) && !G.gsCan(o2, c, 'kick', b) && G.gsCan(o2, b, 'kick', c);
  r.ya_no_queda_abierto = !ok(o1, await step(o1, a, { m: [b, c], ad: [], cr: null }));
  r.el_que_sale_no_elige_heredero = !ok(o1, await step(o1, a, { m: [b, c], ad: [c], cr: c })) && !ok(o1, await step(o1, a, { m: [c, b], ad: [c], cr: c }));
  r.orden_de_miembros_fijo = !ok(s3, await step(s3, a, { m: [a, c, b, d] })) && ok(s3, await step(s3, a, { m: [a, b, c, d, e] })) && !ok(s3, await step(s3, a, { m: [e, a, b, c, d] }));
  // modo COLEGAS: todos escriben, agregan, renombran; expulsar solo el creador
  const c1 = await sign({ g: 'grtest0003', v: 1, cr: a, ad: [a], md: 'o', ow: 0, oa: 0, m: [a, b, c], bl: [], n: 'Colegas', ph: '', by: a, t: 1, sg: '' });
  r.colegas_todos = ok(c1, await step(c1, c, { n: 'Nuevo' })) && ok(c1, await step(c1, c, { m: [a, b, c, d] })) && G.gsCan(c1, c, 'write');
  r.colegas_expulsa_solo_creador = !ok(c1, await step(c1, c, { m: [a, c] })) && ok(c1, await step(c1, a, { m: [a, c] }));
  { const c2 = await step(c1, a, { oa: 1 }); r.colegas_solo_admins_agregan = ok(c1, c2) && !ok(c2, await step(c2, c, { m: [a, b, c, d] })); }
  // empate: dos cambios v3 a la vez; gana el del admin más antiguo
  { const x = await step(s2, a, { n: 'de A' }), y = await step(s2, b, { n: 'de B' }); r.empate_gana_el_mas_antiguo = G.gsWins(x, y, s2) && !G.gsWins(y, x, s2); }
  // grupo viejo (sin estado): el creador queda como único admin en modo colegas (todo sigue igual que antes)
  { const im = G.gsImplicit({ id: 'grtest0004', name: 'Viejo', members: [a, b, c], createdBy: a }); r.grupo_viejo = im.v === 0 && im.cr === a && im.ad.join() === a && im.md === 'o' && G.gsCan(im, b, 'write') && G.gsCan(im, b, 'add') && !G.gsCan(im, b, 'kick', c) && G.gsCan(im, a, 'kick', c);
    const v1 = await sign(G.gsNext(im, a, { ad: [a, b] })); r.grupo_viejo_primer_estado = ok(im, v1) && v1.v === 1 && !ok(im, await sign(G.gsNext(im, b, { ad: [a, b] }))); }
  const fails = Object.keys(r).filter((k) => r[k] === false);
  r.resultado = fails.length ? 'FALLO' : 'OK';
  if (fails.length) r.fallan = fails;
  console.log('GRUPOSADMIN_UNIT ' + JSON.stringify(r));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
