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
  { name: 'Jump con internet por datos móviles', args: ['jump.js', '--io-delay=25', '--net'], tag: 'JUMP', checks: { estados_A: allDelivered, puentes_leen_algo: isEmpty } },
  { name: 'Wi-Fi (escaneo de la red)', args: ['lanscan.js'], tag: 'LANSCAN', checks: {
    encontrado_por: (v) => typeof v === 'string' && v.length > 0, escrituras_bluetooth: (v) => v === 0 } },
  { name: 'internet (relés)', args: ['net.js'], tag: 'NET', checks: {
    texto_estado_A: (v) => v === 'delivered', 'relés_ven_algo': isEmpty, escrituras_bluetooth: (v) => v === 0,
    datos_moviles_foto_espera: isTrue, errores: isEmpty, contenido_en_registros: (v) => v === 0,
    mensajes_con_aviso: (v) => typeof v === 'string' && /^(\d+)\/\1$/.test(v) && v !== '0/0', avisos_en_saludos_o_confirmaciones: (v) => v === 0 } },
  { name: 'internet (Tor)', args: ['net.js', '--tor'], tag: 'NET', checks: {
    texto_estado_A: (v) => v === 'delivered', 'eventos_a_los_relés_durante_el_envío': (v) => v === 0, impostor_cerrado: isTrue,
    errores: isEmpty, contenido_en_registros: (v) => v === 0 } },
  { name: 'no leídos y notificaciones', args: ['unread.js', '--io-delay=25'], tag: 'UNREAD', checks: {
    contador_corto_largo_foto: (v) => v === 3, notificaciones_con_app_a_la_vista: (v) => v === 0, al_abrir_chat: (v) => v === 0, A_ve_leido: isTrue,
    segundo_plano_cuenta: (v) => v === 2, notificacion: (v) => !!v && v.numero === 2, A_no_ve_leido_en_segundo_plano: isTrue,
    al_volver_cuenta: (v) => v === 0, al_volver_notificacion_quitada: isTrue, al_volver_A_ve_leido: isTrue,
    tocar_abre_chat: isTrue, tocar_cuenta: (v) => v === 0, tocar_notificacion_quitada: isTrue, repetido_cuenta_una_vez: isTrue, permiso_notificaciones_pedido: isTrue, errores: isEmpty } },
  { name: 'ID Bluetooth rotativo (no se ve el NEXO ID en el aire)', args: ['rid.js'], tag: 'RID', checks: { resultado: (v) => v === 'OK' } },
  { name: 'archivos grandes por Wi-Fi (24 MB, corte y reintento)', args: ['big.js'], tag: 'BIG', checks: { resultado: (v) => v === 'OK' } },
  { name: 'archivos grandes por Bluetooth L2CAP (4 MB, corte y reintento)', args: ['big.js', '--l2', '--mb=4'], tag: 'BIG', checks: { resultado: (v) => v === 'OK' } },
  { name: 'trozos binarios por Bluetooth', args: ['binary.js', '--loss=0.02'], tag: 'BINARY', checks: { resultado: (v) => v === 'OK' } },
  { name: 'recibir con la app cerrada (buzón, ✓✓ y aviso)', args: ['background.js', '--scenario=closed', '--io-delay=25', '--app-events'], tag: 'BACKGROUND', checks: {
    llegada_a_B_tras_volver: (v) => Array.isArray(v) && v.every((x) => !/NO LLEGÓ/.test(x)),
    con_B_cerrada: (v) => !!v && v.estado_en_A.every((x) => /delivered|read/.test(x)) && v.notificaciones_B.length >= 1 && v.oculta_en_buzon_sin_aviso === true } },
  { name: 'chats de grupo (crear, escribir, texto largo, salir)', args: ['groups.js', '--io-delay=25'], tag: 'GROUPS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'grupos: vídeo HD y archivo grande (24 MB, uno lo pide al llegar al Wi-Fi)', args: ['group_media.js'], tag: 'GROUP_MEDIA', checks: { resultado: (v) => v === 'OK' } },
  { name: 'envío al teléfono equivocado (informe del dueño: lo de la tablet para el S24 sonaba en el Vivo)', args: ['misroute.js'], tag: 'MISROUTE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'enlace parado 80 s: pings contestados, sin cortes (Bluetooth)', args: ['idle.js'], tag: 'IDLE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'enlace parado 80 s: pings contestados, sin cortes (Wi-Fi)', args: ['idle.js', '--wifi'], tag: 'IDLE', logs: 'last_logs_idle_wifi.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'volver a la app (Wi-Fi sigue), BUSCAR se para solo y reconexión sin ráfagas', args: ['resume.js'], tag: 'RESUME', checks: { resultado: (v) => v === 'OK' } },
  { name: 'lo pendiente al volver el contacto (textos largos una vez y legibles, nota de voz, en orden)', args: ['pending.js'], tag: 'PENDING', checks: { resultado: (v) => v === 'OK' } },
  { name: 'orden en el chat (reloj del otro adelantado; recibido con la app cerrada)', args: ['order.js'], tag: 'ORDER', checks: { resultado: (v) => v === 'OK' } },
  { name: 'cortes del Wi-Fi: breve (llega al volver) y largo (por Bluetooth), sin "!" mientras se espera', args: ['wificut.js'], tag: 'WIFICUT', checks: { resultado: (v) => v === 'OK' } },
  { name: 'borrar y volver a agregar un contacto (sin "Unknown"; nombre al conectar)', args: ['readd.js'], tag: 'READD', checks: { resultado: (v) => v === 'OK' } },
  { name: 'avisos con la pantalla apagada (encender, ajustes, llamada sobre el bloqueo)', args: ['alerts.js'], tag: 'ALERTS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'foto de perfil (elegir, llega a los contactos, al reiniciar, a uno nuevo, quitarla)', args: ['avatar.js'], tag: 'AVATAR', checks: { resultado: (v) => v === 'OK' } },
  { name: 'llamadas de voz (contestar, rechazar, sin respuesta, se corta)', args: ['calls.js', '--io-delay=25'], tag: 'CALLS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'suplantación: textos, archivos y llamadas sin cifrar de un teléfono ajeno que dice ser un contacto', args: ['spoof.js'], tag: 'SPOOF', checks: { resultado: (v) => v === 'OK' } },
  { name: 'llamadas: micrófono y cámara (al colgar, ocupados, cortados, sin imágenes, sin permiso; codificadores y decodificadores que fallan)', args: ['callmedia.js'], tag: 'CALLMEDIA', checks: { resultado: (v) => v === 'OK' } },
  ...['rechazar-cerrada', 'rechazar-viva', 'contestar-viejo', 'cruce', 'reloj', 'oferta-vieja', 'bloqueo', 'repetida', 'wifi-uno', 'video-estado', 'sin-micro', 'timbre'].map((c) => (
    { name: 'llamadas: ' + c, args: ['calls2.js', '--case=' + c], tag: 'CALLS2', logs: 'last_logs_calls2_' + c + '.txt', checks: { resultado: (v) => v === 'OK' } })),
  { name: 'pasar la cuenta a un teléfono nuevo', args: ['move.js', '--io-delay=25'], tag: 'MOVE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'avisos por Bluetooth: segundo plano, app congelada y cerrada', args: ['notify.js', '--via=ble'], tag: 'NOTIFY', checks: { resultado: (v) => v === 'OK' } },
  { name: 'avisos por Jump: segundo plano, app congelada y cerrada', args: ['notify.js', '--via=jump'], tag: 'NOTIFY', checks: { resultado: (v) => v === 'OK' } },
  { name: 'camino de envío (regla del dueño: Wi-Fi, internet, Bluetooth; sin brincar)', args: ['route.js'], tag: 'ROUTE', checks: { resultado: (v) => v === 'OK' } },
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
  // Registros de la app de las pruebas que fallaron (en GitHub no se pueden descargar desde todas partes)
  const fs = require('fs');
  for (const r of bad) {
    const f = path.join(__dirname, r.sc.logs || ('last_logs_' + r.sc.args[0].replace('.js', '') + '.txt'));
    if (!fs.existsSync(f)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/DIAG|Splash|JSDOMERROR/.test(l));
    console.log('\n--- ' + r.sc.name + ': registros (' + lines.length + ' líneas, las últimas 400) ---\n' + lines.slice(-400).map((l) => l.substring(0, 260)).join('\n'));
  }
  console.log('\n' + (bad.length ? bad.length + ' prueba(s) fallaron' : 'Todas las pruebas pasaron (' + results.length + ')'));
  process.exit(bad.length ? 1 : 0);
})();
