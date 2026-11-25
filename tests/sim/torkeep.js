// 3324 (cierres nativos del S24 23-11 18:24, 21:26 y 24-11 06:01: SIGABRT en el hilo «tor», «pthread_mutex_lock called on a destroyed
// mutex» en tor_cond_wait). Apagar Tor dentro del proceso (soltar la última conexión con TorService) lo tumba. Guardia estática del
// nativo (el fallo es de la librería: no se reproduce en el simulador):
//  sin_unbind    nadie suelta la conexión con TorService (ni la vista previa, ni «Usar Tor», ni la escucha sin la app)
//  una_conexion  todos pasan por TorKeep.bind (una sola conexión para todo el proceso)
//  se_duerme     cuando nadie lo usa, Tor se duerme (DORMANT) y se despierta (ACTIVE) antes de usarlo
// Uso: node torkeep.js
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../../plugins/nexo-ble/android/src/main/java/com/nexo/ble');
const r = { prueba: 'torkeep' }, mal = [];
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.kt'));
const torFiles = files.filter((f) => /TorService/.test(read(f)));
r.archivos_con_tor = torFiles;
r.sin_unbind = torFiles.every((f) => !/unbindService/.test(read(f)));
r.una_conexion = torFiles.filter((f) => f !== 'TorKeep.kt').every((f) => !/bindService\(/.test(read(f))) && files.filter((f) => /TorKeep\.bind\(/.test(read(f))).length >= 2;
const keep = read('TorKeep.kt');
r.se_duerme = /signal\("DORMANT"\)/.test(keep) && /signal\("ACTIVE"\)/.test(keep) && /TorKeep\.dormant\(\)/.test(read('PluginLinkPreview.kt')) && /TorKeep\.dormant\(\)/.test(read('PluginTor.kt')) && /TorKeep\.active\(\)/.test(read('PluginLinkPreview.kt'));
['sin_unbind', 'una_conexion', 'se_duerme'].forEach((k) => { if (!r[k]) mal.push(k); });
r.fallos = mal; r.resultado = mal.length ? 'FALLO' : 'OK';
console.log('TORKEEP ' + JSON.stringify(r));
process.exit(mal.length ? 1 : 0);
