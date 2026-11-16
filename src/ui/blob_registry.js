/**
 * NEXO — 3162: registro de los Blob detrás de cada URL «blob:» que crea la app.
 * Guardar un VÍDEO en la galería leía su URL blob: con fetch(), pero la CSP de index.html (connect-src 'self' ws: wss: https:)
 * no deja leer blob:, así que el botón se ponía rojo siempre (visto al hacer el visor 3159; ya pasaba antes). En vez de abrir la
 * CSP, la app recuerda el Blob de cada URL que crea y lo lee directo. No retiene nada de más: la URL ya mantiene vivo su Blob
 * hasta revocarla, y al revocarla se borra de aquí.
 */
var _blobs = new Map();

export function installBlobRegistry() {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || URL.__nexoBlobReg) return;
  var create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = function(obj) {
    var u = create.call(URL, obj);
    try { if (typeof Blob !== 'undefined' && obj instanceof Blob) _blobs.set(u, obj); } catch (e) {}
    return u;
  };
  URL.revokeObjectURL = function(u) { _blobs.delete(u); return revoke.call(URL, u); };
  URL.__nexoBlobReg = true;
}

export function blobForUrl(u) { return (typeof u === 'string' && _blobs.get(u)) || null; }

installBlobRegistry();
