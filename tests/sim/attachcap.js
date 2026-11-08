// Mandar varias fotos de una tanda (#dueño 08-11: «quiero mandar más de una foto a la vez, al menos hasta 10»).
// _capAttachments(files, max) toma la lista elegida y devuelve { send: primeros max, dropped: cuántos quedaron afuera }.
// pickers.js la usa para mandar hasta GALLERY_MAX fotos, DE A UNA por dentro (no 10 en memoria a la vez). Función pura.
// Uso: node attachcap.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'attachcap' };
  const { _capAttachments, GALLERY_MAX } = await importSrc('ui/attach_cap.js');
  const files = (n) => Array.from({ length: n }, (_, i) => ({ name: 'f' + i + '.jpg', type: 'image/jpeg' }));
  const eq = (res, send, dropped) => res.send.length === send && res.dropped === dropped;

  r.tope_es_10 = GALLERY_MAX === 10;
  // Menos del tope → se mandan todas, 0 afuera.
  r.pocas_todas = eq(_capAttachments(files(3), 10), 3, 0);
  // Justo el tope → todas, 0 afuera.
  r.justo_el_tope = eq(_capAttachments(files(10), 10), 10, 0);
  // Más del tope → mando las primeras 10, el resto afuera.
  r.mas_del_tope = eq(_capAttachments(files(12), 10), 10, 2);
  // Una sola → una, 0 afuera (no rompe el caso de siempre).
  r.una_sola = eq(_capAttachments(files(1), 10), 1, 0);
  // Ninguna → nada.
  r.ninguna = eq(_capAttachments(files(0), 10), 0, 0);

  // Mantiene el ORDEN de elección (manda las primeras, no otras).
  var res4 = _capAttachments(files(13), 10);
  r.orden = res4.send[0].name === 'f0.jpg' && res4.send[9].name === 'f9.jpg';

  // Acepta un FileList (objeto con .length e índices numéricos), no solo array.
  var fl = { 0: { name: 'a.jpg' }, 1: { name: 'b.jpg' }, length: 2 };
  r.filelist = eq(_capAttachments(fl, 10), 2, 0);

  // Robustez: null/undefined/vacío → nada; filtra entradas falsy.
  r.sin_dato = eq(_capAttachments(null, 10), 0, 0) && eq(_capAttachments(undefined, 10), 0, 0) &&
    eq(_capAttachments([null, undefined, { name: 'x' }], 10), 1, 0);

  // Si no pasan max, usa GALLERY_MAX (10).
  r.max_por_defecto = eq(_capAttachments(files(15)), 10, 5);

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ATTACHCAP ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ATTACHCAP {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
