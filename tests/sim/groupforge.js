// Auditoría (ronda 2774): seguridad de los grupos (hallazgo C2). Un miembro de un grupo recibía un sobre y, antes del
// arreglo, podía: reescribir la lista entera (echar a otros, meter desconocidos) y, con esa lista inventada, colar la
// clave pública de un tercero como "miembro" (envenenamiento de claves). Aquí se carga groups.js aislado (sin la app)
// y se comprueba que un sobre de un miembro NO cambia la lista de un grupo ya conocido ni mete claves de terceros.
// Uso: node groupforge.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const file = path.join(buildDir, 'src', 'ui', 'groups.js');
const r = { build: path.basename(buildDir) };

// Carga groups.js sin sus imports: se le dan sustitutos de lo que usa (window, crypto, CustomEvent y dos funciones).
const src = fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
const win = { addEventListener() {}, dispatchEvent() {}, Capacitor: { Plugins: {} } };
function CustomEvent(name, o) { return { type: name, detail: o && o.detail }; }
const vaultDeleteMessage = () => Promise.resolve();
const _failStatus = () => 'failed';
const make = new Function('window', 'crypto', 'CustomEvent', 'vaultDeleteMessage', '_failStatus',
  src + '\nreturn { Groups };');
const { Groups } = make(win, webcrypto, CustomEvent, vaultDeleteMessage, _failStatus);

// Contactos de mentira: registra lo que groups pide guardar como contactos compartidos (para ver si cuela claves)
const shared = [];
const ble = {
  localNexoId: 'nxme000001',
  addSharedContacts(list, by, opts) { list.forEach((c) => shared.push({ id: (c.nexoId || '').toLowerCase(), pk: c.publicKey || '', by: by })); },
};
const gs = new Groups(ble);
gs._save = function () {}; // sin disco

const GID = 'graaaaaaaa';
const me = 'nxme000001', creator = 'nxcreator1', bob = 'nxbob00001', evil = 'nxevil0001', target = 'nxtarget01';

// 1. El creador me mete en el grupo con [yo, creador, bob]
gs.receive({ type: 'nexo_grp', g: GID, n: 'Amigos', m: [me, creator, bob], i: 'gm1', c: 'hola' }, creator, 'w1');
var g = gs.list[GID];
r.lista_inicial = g ? g.members.slice().sort().join(',') : null;

// 2. Un miembro del grupo (bob) manda un sobre que intenta: echar al creador, meter a un desconocido (evil) y a un
//    objetivo (target) con una clave, y renombrar nada raro. Antes esto reescribía la lista y colaba la clave.
gs.receive({
  type: 'nexo_grp', g: GID, n: 'Amigos', i: 'gm2', c: 'hola2',
  m: [me, bob, evil, target],
  k: [{ nexoId: 'NXTARGET01', name: 'Banco', publicKey: 'A'.repeat(88) }, { nexoId: 'NXEVIL0001', name: 'X', publicKey: 'B'.repeat(88) }],
}, bob, 'w2');
g = gs.list[GID];
r.lista_tras_ataque = g ? g.members.slice().sort().join(',') : null;
r.creador_sigue = !!(g && g.members.indexOf(creator) >= 0);
r.no_metio_desconocidos = !!(g && g.members.indexOf(evil) < 0 && g.members.indexOf(target) < 0);
r.no_colo_claves_de_terceros = !shared.some((s) => s.id === target || s.id === evil);

// 3. Lo legítimo sigue: el creador manda la tarjeta de un miembro de verdad (bob) → sí se guarda
gs.receive({ type: 'nexo_grp', g: GID, i: 'gm3', c: 'hola3', m: [me, creator, bob],
  k: [{ nexoId: 'NXBOB00001', name: 'Bob', publicKey: 'C'.repeat(88) }] }, creator, 'w3');
r.tarjeta_de_miembro_de_verdad_si = shared.some((s) => s.id === bob);

// 4. Un no miembro no cambia nada
gs.receive({ type: 'nexo_grp', g: GID, n: 'Secuestrado', m: [me, evil], i: 'gm4', c: 'x' }, evil, 'w4');
g = gs.list[GID];
r.no_miembro_no_renombra = g && g.name === 'Amigos';

// 5. Salir sí quita (al propio)
gs.receive({ type: 'nexo_grp', g: GID, m: [me, creator, bob], i: 'gm5', c: JSON.stringify({ gl: 1 }) }, bob, 'w5');
g = gs.list[GID];
r.salir_quita_al_propio = !!(g && g.members.indexOf(bob) < 0);

const ok = r.lista_inicial === [me, creator, bob].sort().join(',') &&
  r.creador_sigue && r.no_metio_desconocidos && r.no_colo_claves_de_terceros &&
  r.tarjeta_de_miembro_de_verdad_si && r.no_miembro_no_renombra && r.salir_quita_al_propio;
r.resultado = ok ? 'OK' : 'FALLO';
console.log('GROUPFORGE ' + JSON.stringify(r));
process.exit(ok ? 0 : 1);
