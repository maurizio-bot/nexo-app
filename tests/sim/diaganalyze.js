// 3020 (C del plan de diagnóstico del dueño 12-11): el analizador tools/diag_analyze.cjs pre-digiere los diagnósticos.
// Con diagnósticos de ejemplo (formato real de la 3020 y uno viejo sin ESTADO) comprueba que:
//   C1: lee la entrada JSON de diag_reader (--json) y el texto pegado a mano;
//   C2: saca zona horaria, teléfono, caminos por contacto y los mensajes con problema (lentos / sin entregar);
//   C3: detecta bucles (líneas compactadas «↳ ×N» y, en uno viejo, las más repetidas);
//   C4: firmas conocidas: con build >= la del arreglo dice REAPARECE y pide aviso; con build anterior, «falta actualizar»;
//   C5: privacidad: no salen NEXO ID completos ni direcciones MAC.
// Uso: node diaganalyze.js   (no necesita build)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const tool = path.join(__dirname, '../../tools/diag_analyze.cjs');
const nuevo = [
  'NEXO diagnóstico AUTOMÁTICO · síntoma: enlace_abre_cierra (nx0abcde12 3 cierres por enlace repetido en 10 min) · build 3020 · 2026-11-12T10:00:00.000Z',
  'NEXO diagnóstico 2026-11-12T10:00:00.000Z (últimos 30 min)', 'NEXO ID: NX1N36C283', 'Build: 3020', 'UA: x', '',
  '===== ESTADO (04:00:00 hora local) =====', 'Zona horaria: UTC-06:00 (America/Mexico_City)',
  'Teléfono: pantalla app visible · batería 55% · red Wi-Fi · relés abiertos 3 (Wi-Fi)',
  'Contactos (2):', '  …de12: camino bluetooth · BT listo MTU 517 · visto 03:59:50 · build 3019', '  …9b3b: camino none · sin internet anunciado · se le busca · build ?',
  'Mensajes propios recientes (línea de tiempo):',
  '  aaaa1111 → …de12 (camino al mandar bluetooth): 03:50:00 sending/bluetooth → 03:50:01 delivered/bluetooth',
  '  bbbb2222 → …de12 (camino al mandar bluetooth): 03:51:00 sending/bluetooth → 03:54:10 delivered/internet  [LENTO]',
  '  cccc3333 → …9b3b (camino al mandar none): 03:52:00 pending',
  '', '===== SESIÓN ACTUAL (últimos 30 min) =====', '--- eventos clave ---',
  '03:40:00.000 [BLEInterface] Dedup: cierro enlace repetido aabbccddeeff de nx0abcde12 (me quedo con el mejor)',
  '03:41:00.000 [BLEInterface] Dedup: cierro enlace repetido aabbccddeeff de nx0abcde12 (me quedo con el mejor)',
  '03:42:00.000 [BLEInterface] Dedup: cierro enlace repetido AA:BB:CC:DD:EE:FF de nx0abcde12 (me quedo con el mejor)',
  '03:43:00.000 [BLEInterface] Re-búsqueda de contactos [nx0zz9b3b3] intento 1', '   ↳ ×30 más iguales hasta 03:58:00',
].join('\n');
const viejo = ['NEXO diagnóstico 2026-11-10T10:00:00.000Z', 'NEXO ID: NX1N36C283', 'Build: 3014', 'UA: x', '===== SESIÓN ACTUAL =====']
  .concat(Array.from({ length: 30 }, (_, i) => '03:' + String(10 + i).padStart(2, '0') + ':00.000 [BLEInterface] openChat: forcing connectToDevice for cc:cc:cc:cc:cc:09 intento ' + i)).join('\n');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagan-'));
const fj = path.join(dir, 'd.json'), ft = path.join(dir, 'v.txt');
fs.writeFileSync(fj, JSON.stringify({ list: [{ sym: 'enlace_abre_cierra', info: 'nx0abcde12 3 cierres', build: '3020', created_at: 1794480000, text: nuevo }] }));
fs.writeFileSync(ft, viejo);
const run = (f) => execFileSync('node', [tool, f], { encoding: 'utf8' });
const a = run(fj), b = run(ft);
const r = { prueba: 'diaganalyze' };
r.C1_json_y_texto = /DIAGNÓSTICOS: 1 · enlace_abre_cierra ×1/.test(a) && /■ manual · build 3014/.test(b);
r.C2_estado = /zona UTC-06:00/.test(a) && /teléfono: .*batería 55%/.test(a) && /…de12: camino bluetooth · BT listo MTU 517/.test(a) && /mensajes: 3 recientes, 2 con problema/.test(a) && /bbbb2222.*\[LENTO\]/.test(a) && /cccc3333.*pending/.test(a);
r.C3_bucles = /BUCLE ×31 \(hasta 03:58:00\): .*Re-búsqueda/.test(a) && /BUCLE ×30: .*openChat: forcing/.test(b);
r.C4_firmas = /firma enlace_repetido_bucle ×3: .*REAPARECE: arreglado en 3019 y este teléfono tiene la 3020/.test(a) && /firma sin_internet ×1: .*informativo/.test(a) && /AVISAR: sí \(enlace_repetido_bucle reaparece en 3020\)/.test(a) &&
  /firma openchat_mac_vieja ×30: .*ya arreglado en 3017: este teléfono tiene la 3014 \(falta actualizar\)/.test(b) && /AVISAR: no/.test(b);
r.C5_privacidad = !/nx0abcde12|nx0zz9b3b3|NX1N36C283|aa:bb:cc|cc:cc:cc/i.test(a + b);
fs.rmSync(dir, { recursive: true, force: true });
const ok = r.C1_json_y_texto && r.C2_estado && r.C3_bucles && r.C4_firmas && r.C5_privacidad;
r.resultado = ok ? 'OK' : 'FALLO';
if (!ok) { console.error(a); console.error(b); }
console.log('DIAGANALYZE ' + JSON.stringify(r));
process.exit(ok ? 0 : 1);
