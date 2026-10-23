/**
 * NEXO — Notas de voz (sacado de main.js en la ronda 2752, sin cambios en su código): grabar, contador e icono del
 * micrófono y envío. _sendAttachment lo da main.js con voiceUse().
 */
import { _showPermissionError } from './ui_bits.js';
import { _fmtTime } from './file_tools.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _sendAttachment;
export function voiceUse(d) { _sendAttachment = d._sendAttachment; } // [/pegamento]


export var _mediaRecorder = null;

export var _audioChunks = [];

export var _isRecording = false;

export var _voiceStartTime = 0;

export var _voiceTimerInterval = null;

export async function _handleVoiceToggle() {
  var timerEl = document.getElementById('voice-timer');
  if (!timerEl) {
    timerEl = document.createElement('div');
    timerEl.id = 'voice-timer';
    timerEl.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(255,59,48,0.9);color:#fff;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;z-index:300;display:none;pointer-events:none;backdrop-filter:blur(4px);';
    document.body.appendChild(timerEl);
  }
  if (!_isRecording) {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var audioMimeType = '';
      var audioCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav'
      ];
      for (var ai = 0; ai < audioCandidates.length; ai++) {
        if (MediaRecorder.isTypeSupported(audioCandidates[ai])) {
          audioMimeType = audioCandidates[ai];
          console.log('[VOICE] MimeType seleccionado:', audioMimeType);
          break;
        }
      }
      var audioOptions = audioMimeType ? { mimeType: audioMimeType } : {};
      _mediaRecorder = new MediaRecorder(stream, audioOptions);
      _audioChunks = [];
      _voiceStartTime = Date.now();
      timerEl.style.display = 'block';
      timerEl.textContent = '00:00';
      _voiceTimerInterval = setInterval(function() {
        var elapsed = Math.round((Date.now() - _voiceStartTime) / 1000);
        timerEl.textContent = _fmtTime(elapsed);
      }, 1000);
      _mediaRecorder.ondataavailable = function(e) {
        if (e.data && e.data.size > 0) _audioChunks.push(e.data);
      };
      _mediaRecorder.onstop = function() {
        if (_voiceTimerInterval) { clearInterval(_voiceTimerInterval); _voiceTimerInterval = null; }
        timerEl.style.display = 'none';
        var duration = 0;
        if (_voiceStartTime > 0) duration = Math.round((Date.now() - _voiceStartTime) / 1000);
        var blobType = audioMimeType || 'audio/webm';
        var blob = new Blob(_audioChunks, { type: blobType });
        if (blob.size === 0) {
          console.log('[ATTACH] Audio blob vacio');
          return;
        }
        var reader = new FileReader();
        reader.onloadend = function() {
          var base64 = reader.result.split(',')[1];
          var fmt = (audioMimeType || 'webm').split('/')[1];
          if (fmt.indexOf(';') > -1) fmt = fmt.split(';')[0];
          _sendAttachment('audio', base64, { format: fmt, duration: duration, mimeType: audioMimeType || 'audio/webm' });
          console.log('[ATTACH] Audio enviado, duracion:', duration);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(function(t) { t.stop(); });
      };
      _mediaRecorder.onerror = function(e) {
        console.log('[ATTACH:VOICE] MediaRecorder error:', e.message);
        _isRecording = false;
        _updateMicIcon(false);
        timerEl.style.display = 'none';
      };
      try {
        _mediaRecorder.start(100);
      } catch (tsErr) {
        _mediaRecorder.start();
      }
      _isRecording = true;
      _updateMicIcon(true);
      console.log('[ATTACH] Grabando voz...');
    } catch (err) {
      console.log('[ATTACH:VOICE] Error:', err.name, err.message);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        _showPermissionError('Microfono');
      } else if (err.name === 'NotFoundError') {
        _showPermissionError('Microfono no encontrado');
      }
      _isRecording = false;
      _updateMicIcon(false);
      timerEl.style.display = 'none';
    }
  } else {
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
      try { _mediaRecorder.requestData(); } catch (e) {}
      setTimeout(function() {
        try { _mediaRecorder.stop(); } catch (e) {}
      }, 300);
    }
    _isRecording = false;
    _updateMicIcon(false);
    if (_voiceTimerInterval) {
      clearInterval(_voiceTimerInterval);
      _voiceTimerInterval = null;
    }
    timerEl.style.display = 'none';
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
