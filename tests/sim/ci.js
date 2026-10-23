// Pruebas rápidas para la compilación automática (GitHub): si alguna falla, no se publica la APK.
// Corre los escenarios clave del simulador (de 3 en 3) y comprueba lo esencial de cada resultado.
// Uso: node ci.js <dir_build>     (antes: tests/sim/build.sh wip; CI_ONLY=internet para correr solo algunos)
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const PARALLEL = Number(process.env.CI_PARALLEL) || 3;

const isTrue = (v) => v === true;
const isEmpty = (v) => Array.isArray(v) && v.length === 0;
const allDelivered = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x === 'delivered' || x === 'read');

// tag: prefijo de la línea de resultado; checks: campo → comprobación
const SCENARIOS = [
  { name: 'textos, archivo y sin conexión', args: ['run.js'], tag: 'RESULTADO', checks: {
    corto_llega: isTrue, largo_llega: isTrue, corto_marca_entregado: isTrue, respuesta_B_llega: isTrue,
    archivo_llega_a_B: isTrue, offline_llega_al_volver: isTrue } },
  { name: 'cifrado de extremo a extremo', args: ['e2e.js', '--io-delay=25'], tag: 'E2E', checks: {
    llega_corto: isTrue, llega_largo: isTrue, llega_emojis_identico: isTrue, vista_previa_sin_medio_emoji: isTrue, llega_foto_identica: isTrue, llega_respuesta: isTrue, en_el_aire_en_claro: isEmpty } },
  { name: 'impostor', args: ['impostor.js', '--io-delay=25'], tag: 'IMPOSTOR', checks: {
    A_muestra_mensaje_del_impostor: (v) => v === false, impostor_recibe_algo: (v) => v === false, clave_de_B_intacta: isTrue, errores: isEmpty } },
  { name: 'Jump', args: ['jump.js', '--io-delay=25'], tag: 'JUMP', checks: { estados_A: allDelivered, puentes_leen_algo: isEmpty } },
  { name: 'Wi-Fi (escaneo de la red)', args: ['lanscan.js'], tag: 'LANSCAN', checks: {
    encontrado_por: (v) => typeof v === 'string' && v.length > 0, escrituras_bluetooth: (v) => v === 0 } },
  { name: 'internet (relés)', args: ['net.js'], tag: 'NET', checks: {
    texto_estado_A: (v) => v === 'delivered', 'relés_ven_algo': isEmpty, escrituras_bluetooth: (v) => v === 0,
    datos_moviles_foto_espera: isTrue, errores: isEmpty, contenido_en_registros: (v) => v === 0 } },
  { name: 'internet (Tor)', args: ['net.js', '--tor'], tag: 'NET', checks: {
    texto_estado_A: (v) => v === 'delivered', 'eventos_a_los_relés_durante_el_envío': (v) => v === 0, impostor_cerrado: isTrue,
    errores: isEmpty, contenido_en_registros: (v) => v === 0 } },
  { name: 'Double Ratchet y poscuántico', args: ['ratchet.js'], tag: null },
];

function runOne(sc) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = sc.args[0] === 'ratchet.js' ? sc.args : [sc.args[0], buildDir, ...sc.args.slice(1)];
    const child = spawn(process.execPath, args, { cwd: __dirname });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const secs = Math.round((Date.now() - t0) / 1000);
      const fails = [];
      if (code !== 0) fails.push('salió con código ' + code);
      if (sc.tag) {
        const line = out.split('\n').reverse().find((l) => l.startsWith(sc.tag + ' {'));
        let res = null;
        try { res = line && JSON.parse(line.substring(sc.tag.length + 1)); } catch (e) {}
        if (!res) fails.push('sin resultado ' + sc.tag);
        else {
          if (res.error) fails.push('error: ' + res.error);
          for (const [k, ok] of Object.entries(sc.checks)) if (!ok(res[k])) fails.push(k + ' = ' + JSON.stringify(res[k]));
        }
      }
      resolve({ sc, secs, fails, tail: out.split('\n').slice(-25).join('\n') });
    });
  });
}

(async () => {
  // CI_ONLY=texto: solo los escenarios cuyo nombre lo contiene
  const only = process.env.CI_ONLY;
  const queue = SCENARIOS.filter((sc) => !only || sc.name.includes(only)), results = [];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const r = await runOne(queue.shift());
      console.log((r.fails.length ? '✗ ' : '✓ ') + r.sc.name + ' (' + r.secs + ' s)' + (r.fails.length ? ': ' + r.fails.join('; ') : ''));
      results.push(r);
    }
  }));
  const bad = results.filter((r) => r.fails.length);
  for (const r of bad) console.log('\n--- ' + r.sc.name + ' (final de la salida) ---\n' + r.tail);
  console.log('\n' + (bad.length ? bad.length + ' prueba(s) fallaron' : 'Todas las pruebas pasaron (' + results.length + ')'));
  process.exit(bad.length ? 1 : 0);
})();
