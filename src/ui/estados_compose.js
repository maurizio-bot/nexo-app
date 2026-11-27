import { _overlay, _blobUrl, _b64Of, MAX_LEN, makeStatusImage, _validImg, _bigOf, _toast, _validAud, AUD_SECS, BIG_MAX, _validVid, VID_HD_TARGET, addMyStatus } from './estados.js';
import { t } from './i18n.js';
import { _b64ToBlob, _blobToB64, _makeVideoPreview } from './video_tools.js';
// estados.js — publicar un estado (la ventana «Mi estado»: texto, foto, audio grabado y video elegido).
// Reestructuración 17-11: movido TAL CUAL desde estados.js (solo declaraciones; lo que se ejecuta al arrancar sigue allí, en su orden).
// Tipo de un video elegido (si el selector no lo da, por la extensión); '' si no se sabe
var VID_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska' };
function _vidMime(f) {
  var ty = String((f && f.type) || '').split(';')[0].trim().toLowerCase();
  if (/^video\/[a-z0-9.+-]{1,30}$/.test(ty)) return ty;
  var m = /\.([a-z0-9]{2,4})$/i.exec(String((f && f.name) || ''));
  return (m && VID_EXT[m[1].toLowerCase()]) || '';
}
// Los bytes de un archivo (o de un trozo); falla con el error de Chromium si ya no se deja leer (NotReadableError)
function _readBytes(b) {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise(function(resolve, reject) { var r = new FileReader(); r.onload = function() { resolve(r.result); }; r.onerror = function() { reject(r.error); }; r.readAsArrayBuffer(b); });
}
function _compose() {
  var o = _overlay();
  var box = document.createElement('div');
  box.className = 'nx-ask-card nx-ask-flex'; // B-EST (26-11): la tarjeta del aviso común, con su título y sus botones parejos
  var h = document.createElement('div'); h.className = 'nx-ask-title'; h.textContent = t('grp_my_status_24h', 'Mi estado (24 h)');
  var m = null;   // 3032: «Publicar» crea un estado NUEVO (hasta 10); los anteriores se ven y se quitan en «Mis estados»
  var picked = { img: '', mime: '', aud: '', amime: '', vid: '', vmime: '' };
  // previa de la foto (si hay)
  var prev = document.createElement('img');
  prev.style.cssText = 'width:100%;max-height:200px;object-fit:contain;border-radius:14px;background:#000;' + (picked.img ? '' : 'display:none;');
  if (picked.img) prev.src = picked.img;
  // previa del video (si hay). 3200: desde una URL blob: (la CSP no deja «data:» en un <video>)
  var vidPrev = document.createElement('video'); vidPrev.id = 'estado-video-previa'; vidPrev.controls = true; vidPrev.playsInline = true; vidPrev.preload = 'metadata';
  vidPrev.style.cssText = 'width:100%;max-height:200px;border-radius:14px;background:#000;display:none;';
  // 3200: portada genérica cuando este teléfono no puede abrir el video elegido (en vez del reproductor roto); se publica tal cual
  var vidCover = document.createElement('div'); vidCover.id = 'estado-video-portada';
  vidCover.style.cssText = 'display:none;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;min-height:150px;padding:14px;box-sizing:border-box;border-radius:14px;background:#000;border:1px solid var(--nx-line);text-align:center;';
  // previa del audio (si hay)
  var audPrev = document.createElement('audio'); audPrev.controls = true;
  audPrev.style.cssText = 'width:100%;display:none;';
  var busy = false;   // 3200: se está leyendo o preparando un video (Publicar espera)
  // 3200: pone (o quita, sin blob) la media de una previa desde una URL blob: y suelta la anterior
  function _prevSrc(el, blob) {
    if (el.getAttribute('src')) { try { el.pause(); } catch (e) {} el.removeAttribute('src'); try { el.load(); } catch (e) {} }
    if (el._nxUrl) { try { URL.revokeObjectURL(el._nxUrl); } catch (e) {} el._nxUrl = ''; }
    if (blob) { el._nxUrl = _blobUrl(o, blob); if (el._nxUrl) el.src = el._nxUrl; }
  }
  function _noVid() { picked.vid = ''; vidPrev._nxInfo = null; _prevSrc(vidPrev, null); vidPrev.style.display = 'none'; vidCover.style.display = 'none'; }
  function _noAud() { picked.aud = ''; _prevSrc(audPrev, null); audPrev.style.display = 'none'; }
  function _noImg() { picked.img = ''; prev.removeAttribute('src'); prev.style.display = 'none'; }
  // el video elegido (data URI que se publica) y su previa (blob); info: { desc, name, size } para la portada y el registro
  function _useVid(d, mime, blob, info) {
    _noImg(); _noAud(); // una sola media por estado
    picked.vid = d; picked.vmime = mime;
    vidCover.style.display = 'none'; vidPrev.style.display = 'block';
    vidPrev._nxInfo = info;
    _prevSrc(vidPrev, blob || _b64ToBlob(_b64Of(d), mime));
  }
  vidPrev.addEventListener('loadedmetadata', function() {
    var inf = vidPrev._nxInfo; if (!inf || inf.ok) return; inf.ok = 1;
    var du = vidPrev.duration;
    console.log('[VIDEO] Estado: video elegido (' + inf.desc + ', ' + (isFinite(du) && du > 0 ? Math.round(du * 10) / 10 + ' s' : 'duración desconocida') + ', ' + vidPrev.videoWidth + 'x' + vidPrev.videoHeight + '): se ve');
  });
  vidPrev.addEventListener('error', function() {
    var inf = vidPrev._nxInfo;
    if (!inf || !picked.vid || !vidPrev._nxUrl || vidPrev.getAttribute('src') !== vidPrev._nxUrl) return;
    var er = vidPrev.error;
    console.warn('[VIDEO] Estado: este teléfono no puede abrir el video elegido (' + inf.desc + ', duración desconocida, código ' + (er && er.code) + (er && er.message ? ': ' + er.message : '') + '): se publica tal cual, sin vista previa');
    vidPrev.style.display = 'none';
    vidCover.innerHTML = '';
    var ic = document.createElement('div'); ic.style.cssText = 'font-size:40px;line-height:1;'; ic.textContent = '🎥';
    var nm = document.createElement('div'); nm.style.cssText = 'font-size:13px;color:#fff;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nm.textContent = (inf.name || '') + ' · ' + (inf.size >= 1048576 ? (Math.round(inf.size / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(inf.size / 1024)) + ' KB');
    var nt = document.createElement('div'); nt.className = 'estado-video-nota'; nt.style.cssText = 'font-size:12.5px;color:var(--nx-muted);line-height:1.4;';
    nt.textContent = t('est_vid_no_preview', 'Tu teléfono no puede mostrar este video aquí, pero se publicará tal cual.');
    vidCover.appendChild(ic); vidCover.appendChild(nm); vidCover.appendChild(nt);
    vidCover.style.display = 'flex';
  });
  var ta = document.createElement('textarea');
  ta.id = 'estado-input';
  ta.maxLength = MAX_LEN;
  ta.placeholder = t('grp_status_ph', '¿Qué estás pensando?');
  ta.className = 'nx-input'; ta.style.cssText = 'min-height:70px;resize:none;';
  // elegir foto
  var fin = document.createElement('input'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none';
  fin.addEventListener('change', function() {
    var f = fin.files && fin.files[0]; if (!f) return;
    makeStatusImage(f).then(function(dataUri) {
      if (!_validImg(dataUri) && !_bigOf(dataUri)) { _toast(t('est_img_too_big', 'La foto es muy pesada para un estado')); return; }
      picked.img = dataUri; picked.mime = 'image/jpeg'; prev.src = dataUri; prev.style.display = 'block';
      _noAud(); _noVid(); // una sola media por estado
    }).catch(function() { _toast(t('misc_avatar_not_image', 'no es una imagen')); });
  });
  var photoBtn = document.createElement('button');
  photoBtn.id = 'estado-foto';
  photoBtn.textContent = '📷 ' + t('est_add_photo', 'Foto');
  photoBtn.className = 'nx-btn';
  photoBtn.addEventListener('click', function(e) { e.stopPropagation(); fin.click(); });
  // grabar audio (grabador propio, autocontenido; tope AUD_SECS). Un segundo toque detiene.
  var rec = null, recChunks = [], recTimer = null, recStart = 0;
  function _stopRec() { if (recTimer) { clearInterval(recTimer); recTimer = null; } try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {} }
  var audBtn = document.createElement('button');
  audBtn.id = 'estado-audio-btn';
  audBtn.textContent = '🎤 ' + t('est_add_audio', 'Audio');
  audBtn.className = 'nx-btn';
  audBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (rec && rec.state === 'recording') { _stopRec(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') { _toast(t('est_no_mic', 'No se puede grabar audio aquí')); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      recChunks = []; rec = new MediaRecorder(stream);
      rec.ondataavailable = function(ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
      rec.onstop = function() {
        try { stream.getTracks().forEach(function(tk) { tk.stop(); }); } catch (e) {}
        audBtn.textContent = '🎤 ' + t('est_add_audio', 'Audio');
        var blob = new Blob(recChunks, { type: (rec && rec.mimeType) || 'audio/webm' });
        // 3200: el data URI con el tipo SIN «;codecs=…» (el grabador da «audio/webm;codecs=opus»: con eso no lo aceptaban _validAud
        // ni _bigOf y siempre salía «El audio es muy largo/pesado»)
        var amime = (blob.type || 'audio/webm').split(';')[0];
        _blobToB64(blob).then(function(b64) {
          var d = 'data:' + amime + ';base64,' + b64;
          if (!_validAud(d) && !_bigOf(d)) { _toast(t('est_aud_too_big', 'El audio es muy largo/pesado para un estado')); return; }
          _noImg(); _noVid(); // una sola media por estado
          picked.aud = d; picked.amime = amime;
          _prevSrc(audPrev, blob); audPrev.style.display = 'block';   // 3200: blob:, no «data:»
        }).catch(function() { _toast(t('est_no_mic', 'No se puede grabar audio aquí')); });
      };
      rec.start(); recStart = Date.now();
      recTimer = setInterval(function() {
        var s = Math.floor((Date.now() - recStart) / 1000);
        audBtn.textContent = '⏹ ' + t('est_stop', 'Detener') + ' (' + s + 's)';
        if (s >= AUD_SECS) _stopRec();
      }, 250);
    }).catch(function() { _toast(t('est_no_mic', 'No se puede grabar audio aquí')); });
  });
  // elegir video: se re-codifica a una previa 240p liviana (reusa _makeVideoPreview; stub NEXO_makeVideoPreview en pruebas)
  var vidBtn = document.createElement('button');
  vidBtn.id = 'estado-video-btn';
  vidBtn.textContent = '🎥 ' + t('est_add_video', 'Video');
  vidBtn.className = 'nx-btn';
  var vfin = document.createElement('input'); vfin.type = 'file'; vfin.accept = 'video/*'; vfin.style.display = 'none';
  function _busy(on) { busy = on; vidBtn.disabled = on; vidBtn.textContent = '🎥 ' + (on ? t('est_processing', 'Procesando…') : t('est_add_video', 'Video')); }
  function _readFail(e, desc) {
    console.warn('[VIDEO] Estado: no se pudo leer el video elegido (' + desc + '): ' + ((e && (e.name || e.message)) || e));
    _toast(t('est_vid_read_fail', 'No se pudo leer el video: vuelve a elegirlo'));
  }
  vfin.addEventListener('change', function() {
    var f = vfin.files && vfin.files[0]; if (!f) return;
    var vt = _vidMime(f), desc = (vt || f.type || '?') + ', ' + Math.round(f.size / 1024) + ' KB';
    _busy(true);
    // 3032: un video de hasta 5 MB va tal cual (sin recomprimir); más grande, se recodifica.
    // 3200: se lee entero al elegirlo (y se avisa si no se deja leer: antes no pasaba nada); la previa sale de esa copia
    if (vt && f.size && f.size <= BIG_MAX) {
      _readBytes(f).then(function(buf) {
        var blob = new Blob([buf], { type: vt });
        return _blobToB64(blob).then(function(b64) {
          _busy(false);
          var dv = 'data:' + vt + ';base64,' + b64;
          if (!_validVid(dv) && !_bigOf(dv)) { _toast(t('est_vid_too_big', 'El video quedó muy pesado para un estado')); return; }
          _useVid(dv, vt, blob, { desc: desc, name: f.name, size: f.size });
        });
      }).catch(function(e) { _busy(false); _readFail(e, desc); });
      return;
    }
    var mk = (typeof window.NEXO_makeVideoPreview === 'function') ? window.NEXO_makeVideoPreview : _makeVideoPreview;
    // 3035 (dueño 13-11: videos de otras apps, tipo TikTok): más de 5 MB → se recodifica en 720p con el bitrate justo para
    // caber (VID_HD_TARGET); si ese HD no sale o no cabe, la previa liviana de siempre.
    // 3200: antes, que se deje leer (si no, se decía «No se pudo preparar»); si este teléfono no puede abrir el video (p. ej. un
    // códec que su WebView no trae), se dice qué hacer y queda en el registro con su tipo, tamaño, duración y código
    _readBytes(f.slice(0, 64)).then(function() {
      var rep = {};
      return Promise.resolve(mk(f, undefined, { hdTargetBytes: VID_HD_TARGET, report: rep })).then(function(res) {
        if (!res || res.tooLong || !res.size) {
          _busy(false);
          if (res && res.tooLong) { _toast(t('est_vid_too_long', 'El video es muy largo para un estado')); return; }
          console.warn('[VIDEO] Estado: no se pudo preparar el video elegido (' + desc + ', duración ' + (rep.dur ? Math.round(rep.dur * 10) / 10 + ' s' : 'desconocida') + (rep.code ? ', código ' + rep.code + (rep.msg ? ': ' + rep.msg : '') : '') + '; ' + (rep.why || '?') + ')');
          _toast(t('est_vid_cant_prepare', 'Este video no se puede preparar en tu teléfono: elige uno más corto o más ligero (máx. 5 MB) y se publicará tal cual.'));
          return;
        }
        if (res.hd && res.hd.size > 0 && res.hd.size <= BIG_MAX) { console.log('[ESTADO] Video de ' + Math.round(f.size / 1024) + ' KB → 720p de ' + Math.round(res.hd.size / 1024) + ' KB'); res = res.hd; } // i18n-ok
        return _blobToB64(res).then(function(b64) {
          _busy(false);
          var mime = (res.type || 'video/webm').split(';')[0], d = 'data:' + mime + ';base64,' + b64;
          if (!_validVid(d) && !_bigOf(d)) { _toast(t('est_vid_too_big', 'El video quedó muy pesado para un estado')); return; }
          _useVid(d, mime, res, { desc: mime + ', ' + Math.round(res.size / 1024) + ' KB (de ' + desc + ')', name: f.name, size: res.size });
        });
      });
    }, function(e) { _busy(false); _readFail(e, desc); }).catch(function() { _busy(false); _toast(t('est_vid_fail', 'No se pudo preparar el video')); });
  });
  vidBtn.addEventListener('click', function(e) { e.stopPropagation(); try { vfin.value = ''; } catch (x) {} vfin.click(); });   // 3200: el mismo video se puede volver a elegir
  var row = document.createElement('div'); row.className = 'nx-ask-actions';
  var pub = document.createElement('button');
  pub.id = 'estado-publicar';
  pub.textContent = t('grp_publish', 'Publicar');
  pub.className = 'nx-btn nx-btn-primary';
  pub.addEventListener('click', function(e) {
    e.stopPropagation();
    // 3200: grabando un audio, este toque lo termina (sale su previa y se publica con el siguiente; antes salía sin el audio)
    var grabando = !!(rec && rec.state === 'recording'); _stopRec(); if (grabando) return;
    // 3200: con un video a medio preparar se espera (antes salía solo el texto y el video se perdía, o no pasaba nada); vacío, se dice
    if (busy) { _toast(t('est_vid_wait', 'Espera: el video aún se está preparando')); return; }
    if (!ta.value && !picked.img && !picked.aud && !picked.vid) { _toast(t('est_empty', 'Escribe algo o elige una foto, un audio o un video')); return; }
    if (addMyStatus(ta.value, picked.img, picked.mime, picked.aud, picked.amime, picked.vid, picked.vmime)) o.remove();
  });
  row.appendChild(pub);
  box.appendChild(h); box.appendChild(prev); box.appendChild(vidPrev); box.appendChild(vidCover); box.appendChild(audPrev); box.appendChild(ta);
  var mrow = document.createElement('div'); mrow.className = 'nx-ask-actions';
  mrow.appendChild(photoBtn); mrow.appendChild(audBtn); mrow.appendChild(vidBtn);
  box.appendChild(mrow); box.appendChild(fin); box.appendChild(vfin); box.appendChild(row);
  o.appendChild(box);
  setTimeout(function() { try { ta.focus(); } catch (e) {} }, 50);
}

export { VID_EXT, _vidMime, _readBytes, _compose };
