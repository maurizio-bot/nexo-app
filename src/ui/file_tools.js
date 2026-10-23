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
