// COLAS 7, 8, 9 y 10 de docs/REDES.md (dueño 20-11: «las medias engañan», fallas por camino, capacidad y cronómetro de actividades):
//  D1  «conexión lista»: con 20 muestras conocidas (1…20 s) la línea trae mediana 10,5 s y p90 18 s (rango más cercano); con 1 muestra NO hay percentiles
//      y con 2–9 solo mediana (a partir de 3) y nunca p90
//  D2  las muestras son acotadas (≤ 200 por camino) y conservan el mínimo y el máximo aunque se pasen de 200 (y el conteo sigue siendo el real)
//  D3  velocidades de archivos: media + mediana + p10 (lo malo de una velocidad es lo lento)
//  F1  fallas por camino: usageNotePathFail cuenta por causa (números normalizados); vía desconocida no cuenta
//  F2  usageNoteLog clasifica líneas reales del registro de Wi-Fi local, relés, Jump y Tor; lo informativo y el duplicado «sin comprobar» no cuentan
//  F3  diag.js pasa cada línea [WIFI]/[NET]/[JUMP]/[GW] por NEXO_noteLog (gancho en el registro; no se tocó lan.js, net/ ni ble_*)
//  C1  pico de enlaces Bluetooth a la vez (lee bleInterface._deviceStates: no cuenta lan/net ni los no listos); con la app dormida no muestrea; el pico no baja
//  C2  pico de transferencias de Wi-Fi Direct a la vez (try/ok/fail)
//  A1  cronómetro: foto y archivo propios, desde que se crean hasta la primera ✓✓, por camino, con media y percentiles; lo que llega con la app dormida no cuenta
//  G1  llamada de grupo: group_call.js mide batería y temperatura (empezar, cada minuto, colgar) y call_power etiqueta «de grupo»; la 1 a 1 queda igual
// Uso: node redesmedidas2.js [dir_build]
'use strict';
const fs = require('fs');
const path = require('path');
const { importSrc, buildDir } = require('./srcmod');

(async () => {
  const r = { prueba: 'redesmedidas2' };
  const noop = () => {};
  const mem = {};
  global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  global.window = global; global.window.removeEventListener = noop; global.window.dispatchEvent = noop; global.window.addEventListener = noop;
  const doc = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' };
  global.document = doc;
  let power = { level: 67, charging: false, temp: 31.4, thermal: 0 };
  global.window.Capacitor = { Plugins: { NexoBLE: { getPowerStatus: () => Promise.resolve(Object.assign({}, power)) } } };
  const logs = []; const olog = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
  const reset = () => { Object.keys(mem).forEach((k) => delete mem[k]); };
  try {
    const us = await importSrc('ui/usage_stats.js');
    const dist = await importSrc('ui/usage_dist.js');
    const lines = () => us.usageSpeedLines().join('\n');
    const conLine = () => (us.usageSpeedLines().find((x) => /conexión lista en/.test(x)) || '');
    const ms1 = (s) => s * 1000;

    // D1: 20 muestras 1…20 s por Wi-Fi local (los tiempos se anotan con la app visible y sin pausas)
    for (let i = 1; i <= 20; i++) us.usageNoteConnect('wifi', ms1(i));
    let L = conLine();
    r.D1_linea = L;
    r.D1_20 = /Wi-Fi local 10,5 s · mediana 10,5 s · p90 18 s \(20 veces, de 1 a 20\)/.test(L);
    // 1 muestra por otro camino: sin percentiles; 2 muestras: sin percentiles; 5: solo mediana
    reset();
    us.usageNoteConnect('internet', ms1(2.1));
    L = conLine();
    r.D1_una = /internet 2,1 s \(1 vez\)/.test(L) && !/mediana|p90/.test(L);
    us.usageNoteConnect('internet', ms1(9.5));
    L = conLine();
    r.D1_dos = /internet 5,8 s \(2 veces, de 2,1 a 9,5\)/.test(L) && !/mediana|p90/.test(L);
    [1, 2, 3].forEach((x) => us.usageNoteConnect('internet', ms1(x)));
    L = conLine();
    r.D1_cinco = /mediana 2,1 s \(5 veces/.test(L) && !/p90/.test(L);
    // distStats directo: 1 muestra → solo n/lo/hi
    const s1 = dist.distStats([7]);
    r.D1_stats_una = s1.n === 1 && s1.med === null && s1.p90 === null && s1.lo === 7 && s1.hi === 7 && dist.distStats([]) === null;

    // D2: 600 muestras, un solitario de 377 s al principio y un mínimo de 0,2 s: el arreglo no pasa de 200 y conserva ambos
    reset();
    us.usageNoteConnect('bluetooth', 1000); us.usageNoteConnect('bluetooth', 200);
    us.usageNoteConnect('bluetooth', 377000);
    for (let i = 0; i < 597; i++) us.usageNoteConnect('bluetooth', 400 + (i % 50) * 10);
    const day = window.__nexoUsage.load()[window.__nexoUsage.key()];
    const arr = day.k.bluetooth.s;
    r.D2_acotado = arr.length <= 200 && day.k.bluetooth.n === 600;
    r.D2_extremos = arr.indexOf(200) >= 0 && arr.indexOf(377000) >= 0;
    L = conLine();
    r.D2_linea = /Bluetooth .* \(600 veces, de 0,2 a 377\)/.test(L) && /mediana 0,6 s/.test(L) && /p90 0,9 s|p90 0,8 s/.test(L);

    // D3: velocidades: 12 envíos de archivos por Wi-Fi Direct, del 1 al 12 MB/s … (bytes y ms)
    reset();
    for (let i = 1; i <= 12; i++) us.usageNoteSpeed('wifi-direct', 'out', i * 100 * 1024, 1000); // 100·i KB/s
    L = lines();
    r.D3_linea = (L.split('\n').find((x) => /archivos por Wi-Fi Direct/.test(x)) || '');
    r.D3 = /enviados 12, media 650 KB\/s · mediana 650 KB\/s · p10 200 KB\/s \(de 100 a 1\.200\)/.test(r.D3_linea) || /enviados 12, media 650 KB\/s · mediana 650 KB\/s · p10 200 KB\/s \(de 100 a 1200\)/.test(r.D3_linea);

    // F1
    reset();
    us.usageNotePathFail('wifi', 'no volvió en 3.0 s'); us.usageNotePathFail('wifi', 'no volvió en 7.5 s'); us.usageNotePathFail('wifi', 'sin comprobar');
    us.usageNotePathFail('internet', 'relé no contesta (sin datos 45 s)'); us.usageNotePathFail('marte', 'x');
    L = lines();
    r.F1_linea = (L.split('\n').find((x) => /fallos con causa/.test(x)) || '');
    r.F1 = /Wi-Fi local 3: no volvió en N s ×2, sin comprobar ×1/.test(r.F1_linea) && /internet 1: relé no contesta \(sin datos N s\) ×1/.test(r.F1_linea) && !/marte/.test(r.F1_linea);
    // F2: líneas reales del registro
    reset();
    const real = [
      '[WIFI] Conexión con "nx1abcdefgh" sin comprobar (su app no contestó en 20 s): se cierra',
      '[WIFI] Sin Wi-Fi con nx1abcdefgh (sin comprobar): sigue por Bluetooth', // duplicado de la anterior: no cuenta
      '[WIFI] Sin Wi-Fi con nx1abcdefgh (no volvió en 3.0 s): sigue por Bluetooth',
      '[WIFI] Señal Wi-Fi mala con nx1abcdefgh (ida y vuelta 900 ms, 20 s sin recibir): lo nuevo por otro camino',
      '[WIFI] nx1abcdefgh en la misma red, pero aún sin su clave: por Bluetooth', // informativo
      '[NET] Relé relay.example.org no contesta (sin datos 45 s): conexión muerta, reconecto',
      '[NET] Relé relay.example.org: la red cambió, reconecto por la nueva', // no es falla
      '[NET] Sin relés: internet no disponible',
      '[NET] Tor no disponible: timeout',
      '[JUMP] No se pudo reenviar msg123: sin ruta (queda en espera)',
      '[JUMP] Caducado sin entregar: msg123',
      '[JUMP] Conexión de paso con ab12 sin éxito: vuelvo a probar en 5 min',
      '[JUMP] msg1 no cabe por Bluetooth: espera Wi-Fi/internet (sin leer del disco)', // informativo
      '[GW] nxa1, nxb2 no contestan en 8 s (dormido o sin servicio): pruebo con otro NEXO cercano',
    ];
    real.forEach((l) => us.usageNoteLog(l));
    const pf = (window.__nexoUsage.load()[window.__nexoUsage.key()] || {}).pf || {};
    r.F2_wifi = JSON.stringify(pf.wifi) === JSON.stringify({ 'sin comprobar (su app no contestó)': 1, 'sin Wi-Fi: no volvió en N s': 1, 'señal mala': 1 }) || (pf.wifi && pf.wifi['señal mala'] === 1 && pf.wifi['sin comprobar (su app no contestó)'] === 1 && Object.keys(pf.wifi).length === 3);
    r.F2_internet = !!pf.internet && pf.internet['sin relés'] === 1 && Object.keys(pf.internet).length === 2;
    r.F2_tor = !!pf.tor && pf.tor['no disponible: timeout'] === 1;
    r.F2_jump = !!pf.jump && Object.keys(pf.jump).length === 4 && pf.jump['caducado sin entregar'] === 1;
    // F3: el registro (diag.js) llama a NEXO_noteLog con las líneas de esos prefijos
    const diagSrc = fs.readFileSync(path.join(buildDir, 'src/ui/diag.js'), 'utf8');
    r.F3_gancho_en_registro = /NEXO_noteLog/.test(diagSrc) && /WIFI\|NET\|JUMP\|GW/.test(diagSrc);
    r.F3_expuesto = typeof window.NEXO_noteLog === 'function' && typeof window.NEXO_notePathFail === 'function';

    // C1
    reset();
    const st = new Map([['aa:01', { state: 'ready_to_chat' }], ['aa:02', { state: 'notifications_ready' }], ['aa:03', { state: 'connecting' }], ['lannx1aaaaaaaa', { state: 'ready_to_chat' }], ['netnx1bbbbbbbb', { state: 'ready_to_chat' }]]);
    window.bleInterface = { _deviceStates: st };
    r.C1_cuenta = us.usageSampleBt() === 2;
    st.set('aa:04', { state: 'ready_to_chat' }); st.set('aa:05', { state: 'ready_to_chat' });
    r.C1_cuatro = us.usageSampleBt() === 4;
    st.delete('aa:04'); st.delete('aa:05'); st.delete('aa:01');
    us.usageSampleBt();
    L = lines();
    r.C1_linea = (L.split('\n').find((x) => /pico de enlaces/.test(x)) || '');
    r.C1_pico_no_baja = /pico de enlaces Bluetooth a la vez: 4 \(a las \d\d:\d\d\)/.test(r.C1_linea);
    doc.visibilityState = 'hidden'; st.set('aa:06', { state: 'ready_to_chat' }); st.set('aa:07', { state: 'ready_to_chat' }); st.set('aa:08', { state: 'ready_to_chat' }); st.set('aa:09', { state: 'ready_to_chat' });
    r.C1_dormida = us.usageSampleBt() === 0 && /pico de enlaces Bluetooth a la vez: 4 /.test(lines());
    doc.visibilityState = 'visible';
    delete window.bleInterface;
    r.C1_sin_interfaz = us.usageSampleBt() === 0;
    // C2
    us.usageNoteWd('try', { dir: 'out' }); us.usageNoteWd('try', { dir: 'in' }); us.usageNoteWd('ok', { dir: 'out' }); us.usageNoteWd('try', { dir: 'out' }); us.usageNoteWd('fail', { dir: 'in', cause: 'x' });
    L = lines();
    r.C2_linea = (L.split('\n').find((x) => /Wi-Fi Direct a la vez/.test(x)) || '');
    r.C2 = /pico de transferencias de Wi-Fi Direct a la vez: 2 \(a las \d\d:\d\d\)/.test(r.C2_linea);

    // A1: foto por Bluetooth (10 muestras de 1 a 10 s) y archivo por Wi-Fi (1 muestra); una más con la app dormida no cuenta
    reset();
    const hook = window.__nexoUsage.hook, now = Date.now();
    const soltar = (id, tipo, haceMs) => hook('msg', 'cid1', { _own: true, msgId: id, attachmentType: tipo, timestamp: now - haceMs });
    for (let i = 1; i <= 10; i++) { soltar('f' + i, 'image', i * 1000); us.usageNoteSent('bluetooth'); us.usageNoteDelivered('bluetooth', i * 1000, 'f' + i); }
    soltar('a1', 'file', 30000); us.usageNoteDelivered('wifi', 30000, 'a1');
    soltar('d1', 'image', 500000); us.usageNoteDelivered('bluetooth', -1, 'd1'); // dormida: la ✓✓ llegó pero el tiempo no es de la red
    soltar('t1', null, 1000); us.usageNoteDelivered('bluetooth', 1000, 't1'); // texto: no cuenta como actividad
    L = lines();
    r.A1_linea = (L.split('\n').find((x) => /cronómetro de actividades/.test(x)) || '');
    r.A1_foto = /foto por Bluetooth media 5,5 s · mediana 5,5 s · p90 9 s \(10 veces, de 1 a 10 s\)/.test(r.A1_linea);
    r.A1_archivo = /archivo por Wi-Fi 30 s \(1 vez\)/.test(r.A1_linea);
    r.A1_solo_dos = (r.A1_linea.match(/ por /g) || []).length === 2;

    // G1: la llamada de grupo mide batería y temperatura
    const gsrc = fs.readFileSync(path.join(buildDir, 'src/ui/group_call.js'), 'utf8');
    r.G1_gancho = /callPowerStart\(g, 'de grupo'\)/.test(gsrc) && /callPowerTick\(g\)/.test(gsrc) && /callPowerEnd\(g,/.test(gsrc);
    const cp = await importSrc('ui/call_power.js');
    logs.length = 0;
    const g = { startedAt: Date.now() };
    cp.callPowerStart(g, 'de grupo'); await new Promise((x) => setTimeout(x, 20));
    g.pw.at = Date.now() - 61000; power = { level: 66, charging: false, temp: 35.0, thermal: 0 };
    cp.callPowerTick(g); await new Promise((x) => setTimeout(x, 20));
    g.pw.a.at -= 12 * 60000; power = { level: 64, charging: false, temp: 36.0, thermal: 2 };
    cp.callPowerEnd(g, 750, 'de grupo'); await new Promise((x) => setTimeout(x, 20));
    const gl = logs.filter((l) => /Batería y temperatura/.test(l));
    r.G1_lineas = gl.map((l) => l.substring(0, 200));
    r.G1 = gl.length === 3 && /al empezar la llamada de grupo: batería 67 %/.test(gl[0]) && /\(llamada de grupo\)/.test(gl[1]) && /en la llamada de grupo \(13 min\)/.test(gl[2]) && /67 % → 64 %/.test(gl[2]);
  } finally { console.log = olog; }
  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado' && !/_linea$|_lineas$/.test(k)).every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REDESMEDIDAS2 ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REDESMEDIDAS2 {"resultado":"FALLO","error":"' + String(e && e.stack || e).replace(/"/g, "'").slice(0, 500) + '"}'); process.exit(1); });
