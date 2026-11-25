// 3318 (llamadas por relés: datos): con la app en segundo plano DURANTE una llamada, la escucha nativa de internet (NetBg) también
// bajaba cada parte de la llamada (la app viva ya la recibe): el doble de datos. El nativo ya no la arranca en llamada; al colgar con la app
// oculta, la app le pasa lo último que vio (si no, bajaría otra vez toda la llamada) y el nativo arranca. Aquí: la parte de la app
// (call_bg.js) y que los dos sitios que cuelgan la usan. Uso: node callbg.js [dir_build]
'use strict';
const fs = require('fs'), path = require('path');
const { importSrc, buildDir } = require('./srcmod');
(async () => {
  const r = { prueba: 'callbg' };
  global.document = { visibilityState: 'hidden' };
  const m = await importSrc('ui/call_bg.js');
  const mk = () => { const net = { calls: 0, _bgSinceDirty: false, _bgConfig() { this.calls++; } }; return { net }; };
  const a = mk(); r.oculta_pasa_lo_ultimo = m.callEndedBg(a) === true && a.net.calls === 1 && a.net._bgSinceDirty === true;
  global.document.visibilityState = 'visible';
  const b = mk(); r.a_la_vista_nada = m.callEndedBg(b) === false && b.net.calls === 0;
  global.document.visibilityState = 'hidden';
  r.sin_red_no_revienta = m.callEndedBg({}) === false && m.callEndedBg(null) === false;
  const src = (f) => fs.readFileSync(path.join(buildDir, 'src/ui', f), 'utf8');
  r.uno_a_uno_la_usa = /if \(!on\) callEndedBg\(_bi\(\)\)/.test(src('calls_ui.js'));
  r.grupo_la_usa = /if \(!on\) callEndedBg\(window\.bleInterface\)/.test(src('groupcall_ui.js'));
  const kt = fs.readFileSync(path.join(__dirname, '../../plugins/nexo-ble/android/src/main/java/com/nexo/ble/NexoBlePlugin.kt'), 'utf8');
  const kc = fs.readFileSync(path.join(__dirname, '../../plugins/nexo-ble/android/src/main/java/com/nexo/ble/PluginCalls.kt'), 'utf8');
  r.nativo_no_arranca_en_llamada = /appInBackground && !BleService\.inCall\) try \{ wifiLockHold\(true\); netBg\(\)\.start\(\)/.test(kt);
  r.nativo_arranca_al_colgar = /netBgAfterCall\(\) \/\/ 3318/.test(kc) && /fun NexoBlePlugin\.netBgAfterCall/.test(kc);
  r.nativo_pausa_al_contestar_oculta = /netBgShared\?\.stop\(\); remLog\("INFO", "NETBG", "llamada en segundo plano/.test(kc);
  r.resultado = Object.keys(r).filter((k) => k !== 'prueba').every((k) => r[k] === true) ? 'OK' : 'FALLO';
  console.log('CALLBG ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('CALLBG ' + JSON.stringify({ prueba: 'callbg', error: String(e && e.stack || e).slice(0, 400), resultado: 'FALLO' })); process.exit(1); });
