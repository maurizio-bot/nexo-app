/**
 * NEXO — Notas de voz: grabar, con barra de controles para PAUSAR/REANUDAR, BORRAR antes de enviar y ENVIAR
 * (ronda 2781, pedido del dueño). Al empezar a grabar se para cualquier nota de voz que esté sonando. _sendAttachment
 * lo da main.js con voiceUse().
 */
import { _showPermissionError } from './ui_bits.js';
import { _fmtTime } from './file_tools.js';
import { t } from './i18n.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _sendAttachment;
export function voiceUse(d) { _sendAttachment = d._sendAttachment; } // [/pegamento]


export var _mediaRecorder = null;

export var _audioChunks = [];

export var _isRecording = false;

// #dueño 08-11 (nota de voz DOBLE): _startVoiceRecording es async y recién marca _isRecording DESPUÉS de await getUserMedia;
// dos disparos del botón durante ese hueco (p.ej. el click y el temporizador de pulsación larga, o un doble toque) arrancaban
// DOS grabadores → dos notas (una real, una rota que no se reproduce). Esta bandera marca «arranque en vuelo» para no arrancar otra.
export var _voiceStarting = false;

export var _voiceStartTime = 0;

export var _voiceTimerInterval = null;

// Ronda 2781: pausa y borrado de la grabación
var _isPaused = false;
var _pausedMs = 0;     // tiempo total que ha estado en pausa
var _pauseStart = 0;   // cuándo empezó la pausa actual (0 si no está en pausa)
var _discard = false;  // true = se canceló (borrar), no se envía
var _recStream = null; // el micrófono, para pararlo al terminar o cancelar
// #dueño 07-11: el micrófono tarda una fracción de segundo en «encenderse»; si se pide recién al apretar grabar, se come la
// 1.ª palabra. _prewarmMic() lo precalienta apenas tocás el botón (touchstart) para que al grabar ya esté listo.
var _warmStream = null;   // micrófono precalentado, listo para grabar sin esperar
var _warmPromise = null;  // la adquisición en vuelo (se espera en vez de pedir otra)
var _warmTimer = null;    // lo suelta si no grabás en WARM_TTL_MS (no deja el micrófono abierto)
var WARM_TTL_MS = 8000;

function _streamLive(s) {
  try { var ts = s && s.getTracks ? s.getTracks() : []; return ts.length > 0 && ts.some(function (t) { return t.readyState !== 'ended'; }); } catch (e) { return !!s; }
}
function _releaseWarm() {
  if (_warmTimer) { clearTimeout(_warmTimer); _warmTimer = null; }
  if (_warmStream) { try { _warmStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} _warmStream = null; }
}
// Precalentar el micrófono (apenas tocás el botón de grabar). No hace nada si ya estás grabando o ya está precalentado.
export function _prewarmMic() {
  try {
    if (_isRecording || _warmStream || _warmPromise) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    _warmPromise = navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      _warmPromise = null;
      if (_isRecording) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; } // ya se consumió por otra vía
      _warmStream = s;
      if (_warmTimer) clearTimeout(_warmTimer);
      _warmTimer = setTimeout(_releaseWarm, WARM_TTL_MS);
      return s;
    }).catch(function () { _warmPromise = null; });
  } catch (e) {}
}

function _elapsedMs() {
  if (!_voiceStartTime) return 0;
  var end = _pauseStart || Date.now();
  return Math.max(0, end - _voiceStartTime - _pausedMs);
}

// Barra con los controles de grabación: borrar · tiempo · pausar/reanudar · enviar
function _voiceBar() {
  var bar = document.getElementById('voice-bar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'voice-bar';
  bar.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:14px;background:#14152a;color:#fff;border:1px solid rgba(255,255,255,0.12);border-radius:26px;padding:8px 14px;z-index:300;box-shadow:0 4px 18px rgba(0,0,0,0.4);';
  var mk = function(id, txt, color) {
    var b = document.createElement('button');
    b.id = id; b.textContent = txt;
    b.style.cssText = 'width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;font-size:17px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:' + (color || 'rgba(255,255,255,0.14)') + ';color:#fff;';
    return b;
  };
  var cancel = mk('voice-cancel', '🗑', 'rgba(255,59,48,0.22)');
  var dot = document.createElement('span');
  dot.id = 'voice-dot';
  dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#ff3b30;flex-shrink:0;';
  var time = document.createElement('span');
  time.id = 'voice-time';
  time.style.cssText = 'font-variant-numeric:tabular-nums;font-size:15px;min-width:44px;text-align:center;';
  time.textContent = '0:00';
  var pause = mk('voice-pause', '⏸');
  var send = mk('voice-send', '➤', 'linear-gradient(135deg,#00c8ff,#a855f7)');
  cancel.onclick = function (e) { e.stopPropagation(); _cancelVoiceRecording(); };
  pause.onclick = function (e) { e.stopPropagation(); _pauseResumeVoice(); };
  send.onclick = function (e) { e.stopPropagation(); _finishVoiceRecording(); };
  bar.appendChild(cancel); bar.appendChild(dot); bar.appendChild(time); bar.appendChild(pause); bar.appendChild(send);
  document.body.appendChild(bar);
  return bar;
}

function _showVoiceBar(show) {
  var bar = _voiceBar();
  bar.style.display = show ? 'flex' : 'none';
  if (show) _renderVoiceTime();
}

function _renderVoiceTime() {
  var el = document.getElementById('voice-time');
  if (el) el.textContent = _fmtTime(Math.round(_elapsedMs() / 1000));
  var dot = document.getElementById('voice-dot');
  if (dot) dot.style.opacity = _isPaused ? '0.3' : '1';
  var pb = document.getElementById('voice-pause');
  if (pb) pb.textContent = _isPaused ? '▶' : '⏸';
}

export async function _handleVoiceToggle() {
  if (_isRecording) { _finishVoiceRecording(); return; }
  await _startVoiceRecording();
}

async function _startVoiceRecording() {
  // #dueño 08-11 (nota de voz doble): guarda de reentrada. Si ya se está grabando o YA hay un arranque en vuelo (otro
  // disparo del botón que todavía está en el await de getUserMedia), no arrancar un segundo grabador → una sola nota.
  if (_isRecording || _voiceStarting) return;
  _voiceStarting = true;
  // Ronda 2781: parar cualquier nota de voz que esté sonando antes de grabar (no se mezclan ni se graba el altavoz)
  try { if (typeof window !== 'undefined' && window.__nexoStopVoice) window.__nexoStopVoice(); } catch (e) {}
  try {
    // #dueño 07-11: usar el micrófono YA precalentado (apenas tocaste el botón) para no comerse la 1.ª palabra. Si hay una
    // adquisición en vuelo, la esperamos (no pedimos otra); si ya está lista, se usa directo; si no se precalentó, se pide ahora.
    if (_warmTimer) { clearTimeout(_warmTimer); _warmTimer = null; }
    var stream = _warmStream; _warmStream = null;
    if (!stream && _warmPromise) { try { stream = await _warmPromise; } catch (e) { stream = null; } _warmStream = null; }
    if (!_streamLive(stream)) stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _recStream = stream;
    var audioMimeType = '';
    // #dueño 06-11 (micrófono "dejó de funcionar"): en Android el <audio> no reproduce bien el webm («no supported
    // sources»); mp4/AAC sí se reproduce NATIVO siempre. Por eso se prefiere mp4 antes que webm (solo cambia en los
    // teléfonos que soportan grabar mp4, donde es estrictamente mejor; donde no, cae a webm como antes — p.ej. Chrome
    // de escritorio y el simulador graban webm y lo reproducen bien).
    var audioCandidates = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/wav'];
    for (var ai = 0; ai < audioCandidates.length; ai++) {
      if (MediaRecorder.isTypeSupported(audioCandidates[ai])) { audioMimeType = audioCandidates[ai]; console.log('[VOICE] MimeType seleccionado:', audioMimeType); break; }
    }
    var audioOptions = audioMimeType ? { mimeType: audioMimeType } : {};
    _mediaRecorder = new MediaRecorder(stream, audioOptions);
    _audioChunks = [];
    _voiceStartTime = Date.now(); _pausedMs = 0; _pauseStart = 0; _isPaused = false; _discard = false;
    _showVoiceBar(true);
    _voiceTimerInterval = setInterval(_renderVoiceTime, 500);
    _mediaRecorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) _audioChunks.push(e.data); };
    _mediaRecorder.onstop = function () {
      if (_voiceTimerInterval) { clearInterval(_voiceTimerInterval); _voiceTimerInterval = null; }
      _showVoiceBar(false);
      var duration = Math.round(_elapsedMs() / 1000);
      var chunks = _audioChunks; _audioChunks = [];
      if (_recStream) { try { _recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} _recStream = null; }
      if (_discard) { console.log('[ATTACH] Nota de voz borrada (no se envía)'); return; }
      var blobType = audioMimeType || 'audio/webm';
      var blob = new Blob(chunks, { type: blobType });
      if (blob.size === 0) { console.log('[ATTACH] Audio blob vacio'); return; }
      var reader = new FileReader();
      reader.onloadend = function () {
        var base64 = reader.result.split(',')[1];
        var fmt = (audioMimeType || 'webm').split('/')[1];
        if (fmt.indexOf(';') > -1) fmt = fmt.split(';')[0];
        _sendAttachment('audio', base64, { format: fmt, duration: duration, mimeType: audioMimeType || 'audio/webm' });
        console.log('[ATTACH] Audio enviado, duracion:', duration);
      };
      reader.readAsDataURL(blob);
    };
    _mediaRecorder.onerror = function (e) {
      console.log('[ATTACH:VOICE] MediaRecorder error:', e.message);
      _isRecording = false; _isPaused = false; _updateMicIcon(false); _showVoiceBar(false);
      if (_voiceTimerInterval) { clearInterval(_voiceTimerInterval); _voiceTimerInterval = null; }
    };
    try { _mediaRecorder.start(100); } catch (tsErr) { _mediaRecorder.start(); }
    _isRecording = true;
    _voiceStarting = false; // arranque terminado: a partir de acá manda _isRecording (el 2.º toque ya para/envía)
    _updateMicIcon(true);
    console.log('[ATTACH] Grabando voz...');
  } catch (err) {
    _voiceStarting = false; // falló el arranque: liberar la guarda para poder reintentar
    console.log('[ATTACH:VOICE] Error:', err.name, err.message);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') _showPermissionError(t('call_voice_perm_mic', 'micrófono'));
    else if (err.name === 'NotFoundError') _showPermissionError(t('call_voice_mic_not_found', 'No se encontró el micrófono del teléfono'));
    _isRecording = false; _isPaused = false; _updateMicIcon(false); _showVoiceBar(false);
    if (_recStream) { try { _recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} _recStream = null; }
  }
}

// Pausar / reanudar la grabación (ronda 2781)
export function _pauseResumeVoice() {
  if (!_isRecording || !_mediaRecorder) return;
  if (!_isPaused) {
    try { if (typeof _mediaRecorder.pause === 'function' && _mediaRecorder.state === 'recording') _mediaRecorder.pause(); } catch (e) {}
    _isPaused = true; _pauseStart = Date.now();
    console.log('[VOICE] Grabación en pausa');
  } else {
    _pausedMs += Date.now() - _pauseStart; _pauseStart = 0; _isPaused = false;
    try { if (typeof _mediaRecorder.resume === 'function' && _mediaRecorder.state === 'paused') _mediaRecorder.resume(); } catch (e) {}
    console.log('[VOICE] Grabación reanudada');
  }
  _renderVoiceTime();
}

// Borrar la grabación antes de enviarla (ronda 2781)
export function _cancelVoiceRecording() {
  if (!_isRecording) return;
  _discard = true;
  _isRecording = false; _isPaused = false;
  _updateMicIcon(false);
  _stopRecorder();
}

function _finishVoiceRecording() {
  if (!_isRecording) return;
  _discard = false;
  _isRecording = false; _isPaused = false;
  _updateMicIcon(false);
  _stopRecorder();
}

function _stopRecorder() {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    try { if (_mediaRecorder.state === 'paused' && typeof _mediaRecorder.resume === 'function') _mediaRecorder.resume(); } catch (e) {}
    try { _mediaRecorder.requestData(); } catch (e) {}
    setTimeout(function () { try { _mediaRecorder.stop(); } catch (e) {} }, 300);
  } else {
    // Nada que grabar: limpiar igual
    if (_voiceTimerInterval) { clearInterval(_voiceTimerInterval); _voiceTimerInterval = null; }
    _showVoiceBar(false);
    _audioChunks = [];
    if (_recStream) { try { _recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} _recStream = null; }
  }
}

export function _updateMicIcon(recording) {
  var micBtn = document.getElementById('send-btn');
  if (!micBtn) return;
  var visibleSvg = micBtn.querySelector('.mic-icon') || micBtn.querySelector('.send-icon') || micBtn.querySelector('svg');
  if (visibleSvg) {
    visibleSvg.setAttribute('fill', recording ? '#FF3B30' : '#fff');
  }
}
