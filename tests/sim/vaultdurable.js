// Durabilidad del Vault (auditoría del ZIP 03-11). Dos arreglos:
//   #6 — al externalizar/guardar un adjunto, si el plugin resuelve {frozen:true} (está «pasando la cuenta», NO escribe),
//        NO se da por guardado: la copia en memoria se MANTIENE (antes se borraba y el adjunto se perdía si la migración
//        fallaba). Al descongelar y volcar (vaultFlushAll) se guarda de verdad.
//   #8b — vaultFlushAll ahora vuelca TAMBIÉN el temporizador de contactos (antes solo mensajes/adjuntos): un contacto
//        guardado justo antes de pasar la cuenta sí queda en disco.
// Uso: node vaultdurable.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 220))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { wifi: 'casa', ioDelay: 5 });
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const w = A.win;
  const r = { build: path.basename(buildDir) };

  // ===== #6: adjunto NO se pierde si el guardado resuelve frozen =====
  const FN = 'nexo_att_durable.b64', PAY = 'PAYLOAD_GRANDE_'.repeat(50);
  nA.moveFrozen = true;                                   // simular «pasando la cuenta» (saveToFile resuelve frozen, no escribe)
  await w.vaultSaveFile(FN, PAY); await sleep(50);
  r.sigue_en_memoria_tras_frozen = (await w.vaultLoadFile(FN)) === PAY;   // la copia en memoria se mantiene
  r.no_en_disco_durante_frozen = !nA.files.has(FN);                       // y NO se escribió a disco (frozen)
  nA.moveFrozen = false;                                  // descongelar y volcar: ahora sí se guarda de verdad
  await w.vaultFlushAll(); await sleep(100);
  r.guardado_tras_descongelar = nA.files.get(FN) === PAY;

  // ===== #8b: vaultFlushAll vuelca también los contactos (temporizador de 300 ms) =====
  const okSave = w.vaultSaveContact({ nexoId: 'nxdur00001', displayName: 'Durable' });
  await w.vaultFlushAll(); await sleep(50);              // flush INMEDIATO (antes de los 300 ms del debounce)
  let savedContacts = [];
  try { savedContacts = (JSON.parse(nA.files.get('nexo_vault_contacts.json') || '{}').contacts) || []; } catch (e) {}
  r.contacto_guardado = okSave !== false && savedContacts.some((c) => (c.nexoId || c.deviceUUID) === 'nxdur00001');

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function/.test(l)).slice(0, 5);
  const ok = r.sigue_en_memoria_tras_frozen && r.no_en_disco_durante_frozen && r.guardado_tras_descongelar &&
    r.contacto_guardado && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VAULTDURABLE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_vaultdurable.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_vaultdurable.txt'), logs.join('\n')); process.exit(1); });
