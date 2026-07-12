/**
 * NEXO Voice Module v2
 * Grabación de audio, compresión Opus, envío por BLE
 * Integración con NEXOFileTransfer
 * ES5 compatible
   */
var NEXOVoice = (function() {
'use strict';
// === CONFIG ===
var CONFIG = {
AUDIO_FORMAT: 'audio/webm;codecs=opus',
AUDIO_FALLBACK: 'audio/webm',
SAMPLE_RATE: 16000,      // 16 kHz para BLE eficiente
CHANNELS: 1,             // Mono
BITRATE: 16000,          // 16 kbps = 2 KB/s
MAX_DURATION: 300,       // 5 minutos máximo
CHUNK_INTERVAL: 100,     // ms entre chunks
MIN_DURATION: 1          // 1 segundo mínimo
};
// === ESTADO ===
var _mediaRecorder = null;
var _audioChunks = [];
var _startTime = 0;
var _isRecording = false;
var _recordingTimer = null;
var _stream = null;
var _callbacks = {
onRecordingStart: null,
onRecordingStop: null,
onRecordingCancel: null,
onVoiceSent: null,
onVoiceReceived: null,
onError: null,
onDurationUpdate: null
};
// === UTILIDADES ===
function _generateId() {
return 'voice-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}
function _formatDuration(seconds) {
var mins = Math.floor(seconds / 60);
var secs = Math.floor(seconds % 60);
return mins + ':' + (secs < 10 ? '0' + secs : secs);
}
function _getSupportedMimeType() {
var types = [
'audio/webm;codecs=opus',
'audio/webm',
'audio/mp4;codecs=opus',
'audio/ogg;codecs=opus',
'audio/wav'
];
for (var i = 0; i < types.length; i++) {
if (MediaRecorder.isTypeSupported(types[i])) {
return types[i];
}
}
return '';
}
// === GRABACION ===
/**
 * Inicia grabación de voz
 * @returns {Promise}
   */
   function startRecording() {
   return new Promise(function(resolve, reject) {
   if (_isRecording) {
   reject(new Error('Ya hay una grabación en curso'));
   return;
   }
   if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
   reject(new Error('MediaDevices no disponible'));
   return;
   }
   var constraints = {
   audio: {
   sampleRate: { ideal: CONFIG.SAMPLE_RATE },
   channelCount: { ideal: CONFIG.CHANNELS },
   echoCancellation: true,
   noiseSuppression: true,
   autoGainControl: true
   }
   };
   navigator.mediaDevices.getUserMedia(constraints)
   .then(function(stream) {
   _stream = stream;
   var mimeType = _getSupportedMimeType();
   if (!mimeType) {
   _stopStream();
   reject(new Error('Ningún formato de audio soportado'));
   return;
   }
   var options = {
   mimeType: mimeType,
   audioBitsPerSecond: CONFIG.BITRATE
   };
   try {
   _mediaRecorder = new MediaRecorder(stream, options);
   } catch (e) {
   // Fallback sin options
   _mediaRecorder = new MediaRecorder(stream);
   }
   _audioChunks = [];
   _startTime = Date.now();
   _isRecording = true;
   _mediaRecorder.ondataavailable = function(e) {
   if (e.data && e.data.size > 0) {
   _audioChunks.push(e.data);
   }
   };
   _mediaRecorder.onerror = function(e) {
   _cleanupRecording();
   if (_callbacks.onError) _callbacks.onError(new Error('Error en MediaRecorder'));
   };
   _mediaRecorder.onstop = function() {
   _stopStream();
   };
   // Timer para duración máxima y updates
   _recordingTimer = setInterval(function() {
   var elapsed = (Date.now() - _startTime) / 1000;
   if (_callbacks.onDurationUpdate) {
   _callbacks.onDurationUpdate(elapsed);
   }
   if (elapsed >= CONFIG.MAX_DURATION) {
   stopRecording();
   }
   }, 1000);
   // Empezar a recolectar datos
   _mediaRecorder.start(CONFIG.CHUNK_INTERVAL);
   if (_callbacks.onRecordingStart) {
   _callbacks.onRecordingStart();
   }
   resolve();
   })
   .catch(function(err) {
   reject(err);
   });
   });
   }
/**
 * Detiene grabación y devuelve el blob de audio
 * @returns {Promise<Blob>}
   */
   function stopRecording() {
   return new Promise(function(resolve, reject) {
   if (!_isRecording || !_mediaRecorder) {
   reject(new Error('No hay grabación activa'));
   return;
   }
   var duration = (Date.now() - _startTime) / 1000;
   if (duration < CONFIG.MIN_DURATION) {
   cancelRecording();
   reject(new Error('Grabación muy corta (mínimo ' + CONFIG.MIN_DURATION + 's)'));
   return;
   }
   _mediaRecorder.onstop = function() {
   _stopStream();
   _cleanupRecording();
   var mimeType = _mediaRecorder.mimeType || CONFIG.AUDIO_FALLBACK;
   var blob = new Blob(_audioChunks, { type: mimeType });
   if (_callbacks.onRecordingStop) {
   _callbacks.onRecordingStop(blob, duration);
   }
   resolve(blob);
   };
   _mediaRecorder.stop();
   });
   }
/**
 * Cancela grabación sin guardar
   */
   function cancelRecording() {
   if (!_isRecording) return;
if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
_mediaRecorder.stop();
}
_cleanupRecording();
_stopStream();
if (_callbacks.onRecordingCancel) {
_callbacks.onRecordingCancel();
}
}
// === CLEANUP ===
function _cleanupRecording() {
_isRecording = false;
_audioChunks = [];
_mediaRecorder = null;
if (_recordingTimer) {
clearInterval(_recordingTimer);
_recordingTimer = null;
}
}
function _stopStream() {
if (_stream) {
_stream.getTracks().forEach(function(track) {
track.stop();
});
_stream = null;
}
}
// === ENVIO DE VOZ ===
/**
 * Graba, detiene y envía voz en una sola operación
 * @param {String} deviceId - Destinatario
 * @param {Object} options - { onProgress, onComplete }
 * @returns {Promise<String>} msgId
   */
   function sendVoice(deviceId, options) {
   options = options || {};
   return new Promise(function(resolve, reject) {
   startRecording()
   .then(function() {
   // La grabación está en curso, el usuario debe detenerla
   // Este método es para flujo automático (grabar X segundos)
   // Para flujo manual, usar startRecording + stopRecording + sendVoiceBlob
   reject(new Error('Usa startRecording() y stopRecording() para flujo manual'));
   })
   .catch(reject);
   });
   }
/**
 * Envía un blob de audio ya grabado
 * @param {String} deviceId - Destinatario
 * @param {Blob} blob - Audio grabado
 * @param {Object} options - { onProgress, onComplete }
 * @returns {Promise<String>} msgId
   */
   function sendVoiceBlob(deviceId, blob, options) {
   options = options || {};
   return new Promise(function(resolve, reject) {
   if (!blob || blob.size === 0) {
   reject(new Error('Audio vacío'));
   return;
   }
   var duration = options.duration || 0;
   var fileName = 'voice-' + Date.now() + '.webm';
   // Crear File desde Blob
   var file = new File([blob], fileName, { type: blob.type || 'audio/webm' });
   // Usar NEXOFileTransfer
   if (typeof window.NEXOFileTransfer === 'undefined') {
   reject(new Error('NEXOFileTransfer no cargado'));
   return;
   }
   var transfer = window.NEXOFileTransfer;
   transfer.onProgress(function(msgId, progress, bytesSent, totalBytes) {
   if (options.onProgress) options.onProgress(msgId, progress, bytesSent, totalBytes);
   });
   transfer.onComplete(function(msgId, success, error) {
   if (options.onComplete) options.onComplete(msgId, success, error);
   if (_callbacks.onVoiceSent) {
   _callbacks.onVoiceSent(msgId, success, duration);
   }
   });
   transfer.sendFile(deviceId, file, {
   fileName: fileName,
   mimeType: file.type,
   onProgress: options.onProgress,
   onComplete: options.onComplete
   })
   .then(function(msgId) {
   resolve(msgId);
   })
   .catch(reject);
   });
   }
// === REPRODUCCION ===
/**
 * Reproduce audio desde blob o URL
 * @param {Blob|String} source - Blob o URL de audio
 * @returns {Promise<HTMLAudioElement>}
   */
   function playVoice(source) {
   return new Promise(function(resolve, reject) {
   var audio = new Audio();
   var url;
   if (source instanceof Blob) {
   url = URL.createObjectURL(source);
   } else {
   url = source;
   }
   audio.src = url;
   audio.preload = 'auto';
   audio.oncanplay = function() {
   audio.play().then(function() {
   resolve(audio);
   }).catch(reject);
   };
   audio.onerror = function() {
   reject(new Error('Error reproduciendo audio'));
   };
   audio.onended = function() {
   if (source instanceof Blob) {
   URL.revokeObjectURL(url);
   }
   };
   });
   }
// === UI: BURBUJA DE VOZ ===
/**
 * Crea elemento DOM para mensaje de voz
 * @param {Object} voiceData - { msgId, duration, status, isOwn, waveform }
 * @returns {HTMLElement}
   */
   function createVoiceBubble(voiceData) {
   voiceData = voiceData || {};
   var container = document.createElement('div');
   container.className = 'nexo-voice-bubble';
   container.dataset.msgId = voiceData.msgId || '';
var isOwn = voiceData.isOwn === true;
var duration = voiceData.duration || 0;
var formattedDuration = _formatDuration(duration);
// Botón play/pause
var playBtn = document.createElement('button');
playBtn.className = 'nexo-voice-play';
playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
playBtn.style.cssText = 'width:36px;height:36px;border-radius:50%;background:#00c8ff;border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
// Barra de progreso
var progressBar = document.createElement('div');
progressBar.className = 'nexo-voice-progress';
progressBar.style.cssText = 'flex:1;height:3px;background:rgba(255,255,255,0.2);border-radius:2px;margin:0 12px;position:relative;overflow:hidden;';
var progressFill = document.createElement('div');
progressFill.style.cssText = 'height:100%;width:0%;background:#00c8ff;transition:width 0.1s linear;';
progressBar.appendChild(progressFill);
// Duración
var durationEl = document.createElement('span');
durationEl.className = 'nexo-voice-duration';
durationEl.textContent = formattedDuration;
durationEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.7);white-space:nowrap;';
container.appendChild(playBtn);
container.appendChild(progressBar);
container.appendChild(durationEl);
// Estado (checkmarks)
if (voiceData.status) {
var statusEl = document.createElement('span');
statusEl.className = 'nexo-voice-status';
statusEl.textContent = voiceData.status;
statusEl.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);margin-left:4px;';
container.appendChild(statusEl);
}
container.style.cssText = 'display:flex;align-items:center;padding:8px 12px;border-radius:16px;background:' + (isOwn ? 'linear-gradient(135deg,#0082FC,#6B4EFF)' : 'linear-gradient(135deg,#0B3D91,#2E1A47)') + ';color:#fff;max-width:280px;';
// Evento play
var currentAudio = null;
playBtn.addEventListener('click', function() {
if (currentAudio && !currentAudio.paused) {
currentAudio.pause();
playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
} else {
if (voiceData.blob || voiceData.url) {
playVoice(voiceData.blob || voiceData.url)
.then(function(audio) {
currentAudio = audio;
playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
audio.ontimeupdate = function() {
var pct = (audio.currentTime / audio.duration) * 100;
progressFill.style.width = pct + '%';
};
audio.onended = function() {
progressFill.style.width = '0%';
playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
currentAudio = null;
};
})
.catch(function(err) {
console.error('Error reproduciendo:', err);
});
}
}
});
return container;
}
// === CALLBACKS ===
function onRecordingStart(callback) { _callbacks.onRecordingStart = callback; }
function onRecordingStop(callback) { _callbacks.onRecordingStop = callback; }
function onRecordingCancel(callback) { _callbacks.onRecordingCancel = callback; }
function onVoiceSent(callback) { _callbacks.onVoiceSent = callback; }
function onVoiceReceived(callback) { _callbacks.onVoiceReceived = callback; }
function onError(callback) { _callbacks.onError = callback; }
function onDurationUpdate(callback) { _callbacks.onDurationUpdate = callback; }
// === API PUBLICA ===
return {
// Grabación
startRecording: startRecording,
stopRecording: stopRecording,
cancelRecording: cancelRecording,
isRecording: function() { return _isRecording; },
// Envío
sendVoice: sendVoice,
sendVoiceBlob: sendVoiceBlob,
// Reproducción
playVoice: playVoice,
// UI
createVoiceBubble: createVoiceBubble,
// Callbacks
onRecordingStart: onRecordingStart,
onRecordingStop: onRecordingStop,
onRecordingCancel: onRecordingCancel,
onVoiceSent: onVoiceSent,
onVoiceReceived: onVoiceReceived,
onError: onError,
onDurationUpdate: onDurationUpdate,
// Utilidades
formatDuration: _formatDuration,
getSupportedMimeType: _getSupportedMimeType,
// Config
CONFIG: CONFIG
};
})();
// === EXPORT ===
if (typeof module !== 'undefined' && module.exports) {
module.exports = { NEXOVoice: NEXOVoice };
}
if (typeof window !== 'undefined') {
window.NEXOVoice = NEXOVoice;
}
