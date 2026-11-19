/**
 * NEXO — Utilidades de archivos (sacadas de main.js en la ronda 2752, sin cambios): extensión y tipo MIME, PDF y su
 * miniatura, icono y tamaño legible, leer un archivo en base64, comprimir una foto y formatear la hora.
 */

// En los registros solo la extensión de un archivo (el nombre puede ser privado)
export function _extOf(name) { var m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || '')); return m ? '*.' + m[1].toLowerCase() : '(sin extensión)'; }

export function _compressImageBase64(base64, maxDim, quality) {
  return new Promise(function(resolve) {
    maxDim = maxDim || 480;
    quality = quality || 0.5;
    try {
      var img = new Image();
      img.onload = function() {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = 1;
          if (w > maxDim || h > maxDim) {
            scale = Math.min(maxDim / w, maxDim / h);
          }
          var tw = Math.max(1, Math.round(w * scale));
          var th = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, tw, th);
          var out = canvas.toDataURL('image/jpeg', quality);
          var b64 = out.split(',')[1] || '';
          console.log('[ATTACH] compress image', w + 'x' + h, '->', tw + 'x' + th, 'b64', base64.length, '->', b64.length);
          resolve({ base64: b64, width: tw, height: th, format: 'jpeg' });
        } catch (e) {
          console.warn('[ATTACH] compress fail, using original', e.message);
          resolve({ base64: base64, width: 0, height: 0, format: 'jpeg' });
        }
      };
      img.onerror = function() {
        resolve({ base64: base64, width: 0, height: 0, format: 'jpeg' });
      };
      img.src = 'data:image/jpeg;base64,' + base64;
    } catch (e) {
      resolve({ base64: base64, width: 0, height: 0, format: 'jpeg' });
    }
  });
}

export function _fmtTime(sec) {
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

export function _readFileBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(evt) {
      var r = String((evt.target && evt.target.result) || '');
      var b64 = r.substring(r.indexOf(',') + 1);
      if (!b64) reject(new Error('archivo vacío')); else resolve(b64);
    };
    reader.onerror = function() { reject((reader.error) || new Error('error de lectura')); };
    reader.readAsDataURL(file);
  });
}

export function _isPdf(mime, name) { return mime === 'application/pdf' || /\.pdf$/i.test(name || ''); }

export var _MIME_BY_EXT = { pdf: 'application/pdf', apk: 'application/vnd.android.package-archive', txt: 'text/plain', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

export function _mimeOf(mime, name) {
  if (mime && mime.indexOf('/') > 0 && mime !== 'application/octet-stream') return mime;
  var ext = String(name || '').split('.').pop().toLowerCase();
  return _MIME_BY_EXT[ext] || mime || 'application/octet-stream';
}

// Primera página de un PDF (lector de PDF de Android, en el plugin). null si no se puede.
export function _pdfThumb(base64) {
  var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (!pl || typeof pl.pdfThumbnail !== 'function') return Promise.resolve(null);
  return Promise.race([
    pl.pdfThumbnail({ base64: base64, width: 320 }).catch(function(e) { console.warn('[ATTACH] Miniatura PDF:', e && e.message); return null; }),
    new Promise(function(r) { setTimeout(function() { r(null); }, 8000); })
  ]);
}

// v9.9.37: burbuja de archivo (PDF, APK, documentos…). Antes solo una etiqueta: no se podía abrir y el
// nombre (lo manda el otro teléfono) se metía como HTML. Ahora: miniatura de la 1.ª página si es PDF,
// nombre como texto, tamaño y, al tocar, se abre con la app que corresponda (plugin openFile).
export var _FILE_ICONS = [[/pdf/, '📄'], [/android\.package-archive/, '📦'], [/zip|rar|7z|compressed|tar/, '🗜️'],
  [/sheet|excel|csv/, '📊'], [/presentation|powerpoint/, '📽️'], [/^text\/|word|document|rtf/, '📝'], [/^audio\//, '🎵']];

export function _fileIcon(mime) {
  for (var i = 0; i < _FILE_ICONS.length; i++) if (_FILE_ICONS[i][0].test(mime)) return _FILE_ICONS[i][1];
  return '📎';
}

export function _fmtSize(b) {
  b = Number(b) || 0;
  return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
}

// 3243 (dueño 18-11: «mandé una foto panorámica y no se refleja en el chat»): una foto se reduce SIN pasar el original a base64 (una
// panorámica de 10–30 MB lo inflaba a 40 MB en memoria antes de decodificarla). Se leen sus medidas por una URL del archivo y se decodifica
// ya reducida (createImageBitmap con tamaño de salida) cuando el WebView lo permite. Si el teléfono no sabe abrir ese formato (p. ej. HEIC),
// falla con code 'UNSUPPORTED' para que se mande como archivo (antes salía el original con la etiqueta «jpeg» y el otro no lo veía).
export function _imageTarget(w, h, maxDim) {
  var scale = (w > maxDim || h > maxDim) ? Math.min(maxDim / w, maxDim / h) : 1;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}
export function _compressImageFile(file, maxDim, quality) {
  maxDim = maxDim || 480; quality = quality || 0.5;
  // Sin lienzo de verdad (simulador sin canvas): el camino de siempre (leer en base64 y reducir)
  var legacy = function() { return _readFileBase64(file).then(function(b64) { return _compressImageBase64(b64, maxDim, quality); }); };
  var ctxOk = false; try { var cv0 = document.createElement('canvas'); ctxOk = !!(cv0.getContext && cv0.getContext('2d')); } catch (e) {}
  if (!ctxOk) return legacy();
  var unsupported = function(why) { var e = new Error('formato de imagen no soportado (' + why + ')'); e.code = 'UNSUPPORTED'; return e; }; // i18n-ok: motivo interno
  return new Promise(function(resolve, reject) {
    var url = null;
    try { url = URL.createObjectURL(file); } catch (e) { reject(unsupported('sin URL')); return; }
    var img = new Image();
    var done = function() { try { URL.revokeObjectURL(url); } catch (e) {} };
    img.onerror = function() { done(); reject(unsupported(file.type || 'desconocido')); };
    img.onload = function() {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) { done(); reject(unsupported('sin medidas')); return; }
      var tg = _imageTarget(w, h, maxDim);
      var draw = function(src) {
        var canvas = document.createElement('canvas');
        canvas.width = tg.w; canvas.height = tg.h;
        canvas.getContext('2d').drawImage(src, 0, 0, tg.w, tg.h);
        var b64 = (canvas.toDataURL('image/jpeg', quality).split(',')[1]) || '';
        canvas.width = canvas.height = 1;
        if (b64.length < 100) throw new Error('lienzo vacío');
        console.log('[ATTACH] compress image', w + 'x' + h, '->', tg.w + 'x' + tg.h, 'archivo', Math.round((file.size || 0) / 1024) + ' KB', '-> b64', b64.length);
        return { base64: b64, width: tg.w, height: tg.h, format: 'jpeg' };
      };
      var viaImg = function() { try { var r = draw(img); done(); resolve(r); } catch (e) { done(); reject(unsupported(e && e.message)); } };
      if (typeof createImageBitmap === 'function' && (tg.w < w || tg.h < h)) {
        createImageBitmap(file, { resizeWidth: tg.w, resizeHeight: tg.h, resizeQuality: 'high' }).then(function(bmp) {
          try { var r = draw(bmp); try { bmp.close(); } catch (e) {} done(); resolve(r); } catch (e) { try { bmp.close(); } catch (e2) {} viaImg(); }
        }, viaImg);
      } else viaImg();
    };
    // Si el teléfono no termina de abrirla en 20 s, el camino de siempre (nunca se queda colgada la tanda)
    var tmo = setTimeout(function() { img.onload = img.onerror = null; done(); legacy().then(resolve, reject); }, 20000);
    var ol = img.onload, oe = img.onerror;
    img.onload = function() { clearTimeout(tmo); ol(); };
    img.onerror = function() { clearTimeout(tmo); oe(); };
    img.src = url;
  });
}
