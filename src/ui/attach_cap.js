/**
 * NEXO — Tope de adjuntos de la galería (#dueño 08-11: «quiero mandar más de una foto a la vez, al menos hasta 10»).
 * Función PURA, sin dependencias (del DOM ni de otros módulos), para poder probarla en el simulador: dada la lista de
 * archivos elegidos y un máximo, devuelve cuáles se mandan (los primeros `max`) y cuántos quedan afuera. El procesado
 * real (leer → comprimir → mandar) lo hace pickers.js DE A UNA, para no llenar la memoria con 10 fotos a la vez.
 */

// Tope de fotos/vídeos que se mandan de una tanda desde la galería.
export var GALLERY_MAX = 10;

// files: FileList o array. Devuelve { send: [primeros max], dropped: cuántos quedaron afuera }.
export function _capAttachments(files, max) {
  var arr = [];
  if (files && typeof files.length === 'number') {
    for (var i = 0; i < files.length; i++) { if (files[i]) arr.push(files[i]); }
  }
  var m = (typeof max === 'number' && max > 0) ? Math.floor(max) : GALLERY_MAX;
  return { send: arr.slice(0, m), dropped: Math.max(0, arr.length - m) };
}
