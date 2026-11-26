// Dueño 16-11: opción por chat «Ocultar el texto en los avisos». Con ella puesta, los avisos de ESE chat salen sin vista previa
// (texto vacío → el nativo dice «Mensaje nuevo»); los demás chats siguen con su texto; al quitarla vuelve el texto.
//  A1  sin la opción, el aviso lleva el texto; A2 con la opción en el chat X: aviso de X con texto vacío, el de Y con texto;
//  A3  la opción se guarda y se recupera al reiniciar (archivo del plugin); A4 al quitarla vuelve el texto;
//  A5  el interruptor global (bloqueo de la app) sigue ocultando todo; A6 el menú del contacto y el del grupo la ofrecen
//      (main.js la pasa a notify.js) y está en los 5 idiomas.
// Contraprueba: la 3143 no tiene el módulo → FALLO.
// Uso: node avisoschat.js [dir_build]
'use strict';
const fs = require('fs');
const path = require('path');
const { importSrc, buildDir } = require('./srcmod');
const files = {}, calls = [];
global.document = { visibilityState: 'hidden', addEventListener() {} };
global.window = { addEventListener() {}, Capacitor: { Plugins: { NexoBLE: {
  notifyMessage: async (o) => { calls.push(o); return { count: 1 }; },
  saveToFile: async (o) => { files[o.filename] = o.content; return {}; },
} } } };
(async () => {
  const r = { prueba: 'avisoschat', build: path.basename(buildDir) };
  const hp = await importSrc('ui/chat_hide_preview.js');
  const { createNotifier } = await importSrc('ui/notify.js');
  let lock = false;
  const n = createNotifier({ ble: () => null, currentChat: () => null, hidePreview: (cid) => lock || hp.isPreviewHidden(cid) });
  // (sin loadFromFile al crear el aviso: así no espera a leer lo ya visto; se añade luego para la recarga de la opción)
  window.Capacitor.Plugins.NexoBLE.loadFromFile = async (o) => (o.filename in files ? { exists: true, content: files[o.filename] } : { exists: false });
  let k = 0;
  const send = (cid, txt) => { calls.length = 0; n.incoming({ cid, name: 'N', msgId: 'm' + (++k), preview: txt }); return calls[0] && calls[0].text; };
  r.A1_con_texto = send('aaaa', 'hola secreto') === 'hola secreto';
  hp.toggleHidePreview('AAAA');
  r.A2_oculto = send('aaaa', 'otro secreto') === '' && send('bbbb', 'visible') === 'visible';
  await new Promise((s) => setTimeout(s, 10));
  hp._resetForTest();
  r.A3_antes = hp.isPreviewHidden('aaaa') === false;
  await hp.loadHidePreview();
  r.A3_guardado = hp.isPreviewHidden('aaaa') === true && hp.isPreviewHidden('bbbb') === false;
  hp.toggleHidePreview('aaaa');
  r.A4_quitado = send('aaaa', 'ya se ve') === 'ya se ve';
  lock = true;
  r.A5_global = send('bbbb', 'bloqueo') === '';
  const src = (f) => fs.readFileSync(path.join(buildDir, 'src', f), 'utf8');
  r.A6_menus = /data-action="hidetext"|_mi\('hidetext'/.test(src('ui/ble_ui.js')) && /gm-hidetext/.test(src('ui/groups_ui.js')) && /isPreviewHidden\(cid\)/.test(src('main.js'));
  let i18n = true;
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) { const T = (await importSrc('ui/i18n/' + l + '.js')).default; i18n = i18n && !!T.chat_hide_preview && !!T.chat_show_preview; }
  r.A6_idiomas = i18n;
  const ok = r.A1_con_texto && r.A2_oculto && r.A3_antes && r.A3_guardado && r.A4_quitado && r.A5_global && r.A6_menus && r.A6_idiomas;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AVISOSCHAT ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('AVISOSCHAT ' + JSON.stringify({ prueba: 'avisoschat', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
