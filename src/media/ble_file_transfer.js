/**
 * NEXO File Transfer JS v1.1
 * FIX: Cableado real a BleAckSystem (ruta JS validada en v3.2.8)
 *      - Elimina dependencia de sendFileNative (no validado)
 *      - Imagenes: envia PREVIEW por defecto (capas progresivas)
 *      - Progreso real via evento nexo:ble:fileProgress
 *      - Recepcion via nexo:ble:fileComplete -> blob URL
 * ES5 compatible
 */
var NEXOFileTransfer = (function() {
    'use strict';

    var CONFIG = {
        MAX_FILE_SIZE: 5242880,          // 5MB hard limit
        RECOMMENDED_MAX: 1048576,        // 1MB recomendado (aviso, no bloqueo)
        SEND_ORIGINAL_IMAGES: false      // por defecto enviar preview (640px webp)
    };

    var _callbacks = {
        onProgress: null,
        onComplete: null,
        onReceived: null,
        onThumbnail: null,
        onPreview: null
    };
    var _activeTransfers = {};
    var _mediaRecorder = null;
    var _audioChunks = [];
    var _listenersSetup = false;

    function _generateMsgId() {
        return 'ft-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    function _normId(id) {
        return (id || '').toString().toLowerCase().trim();
    }

    // === ACCESO A BleAckSystem (ruta JS real) ===
    function _getAckSystem() {
        var bi = window.bleInterface;
        if (!bi) return null;
        return bi.ackSystem || bi._ackSystem || bi.bleAck || null;
    }

    // === Base64 helpers ===
    function _blobToBase64(blob) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var dataUrl = e.target.result || '';
                var comma = dataUrl.indexOf(',');
                if (comma < 0) { reject(new Error('Formato Base64 invalido')); return; }
                resolve(dataUrl.substring(comma + 1));
            };
            reader.onerror = function() { reject(new Error('Error leyendo archivo')); };
            reader.readAsDataURL(blob);
        });
    }
    function _base64ToBlob(base64, mimeType) {
        try {
            var byteChars = atob(base64);
            var byteNums = new Array(byteChars.length);
            for (var i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
            var byteArray = new Uint8Array(byteNums);
            return new Blob([byteArray], { type: mimeType || 'application/octet-stream' });
        } catch (e) { return null; }
    }
    function _base64ToBlobUrl(base64, mimeType) {
        var blob = _base64ToBlob(base64, mimeType);
        if (!blob) return null;
        var url = URL.createObjectURL(blob);
        // Limpieza automatica a los 10 min
        setTimeout(function() { try { URL.revokeObjectURL(url); } catch (e) {} }, 600000);
        return url;
    }

    // === Compresion de imagen ===
    function _compressImage(file, maxDimension, quality, format) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var img = new Image();
                img.onload = function() {
                    try {
                        var canvas = document.createElement('canvas');
                        var ctx = canvas.getContext('2d');
                        var width = img.width, height = img.height;
                        if (width > height) {
                            if (width > maxDimension) { height = Math.round(height * (maxDimension / width)); width = maxDimension; }
                        } else {
                            if (height > maxDimension) { width = Math.round(width * (maxDimension / height)); height = maxDimension; }
                        }
                        canvas.width = width; canvas.height = height;
                        ctx.fillStyle = '#000000';
                        ctx.fillRect(0, 0, width, height);
                        ctx.drawImage(img, 0, 0, width, height);
                        canvas.toBlob(function(blob) {
                            if (blob) resolve(blob); else reject(new Error('Canvas toBlob fallo'));
                        }, format, quality);
                    } catch (err) { reject(err); }
                };
                img.onerror = function() { reject(new Error('Error cargando imagen')); };
                img.src = e.target.result;
            };
            reader.onerror = function() { reject(new Error('Error leyendo imagen')); };
            reader.readAsDataURL(file);
        });
    }
    function _generateProgressiveLayers(file) {
        return new Promise(function(resolve) {
            var layers = { thumbnail: null, preview: null, original: file };
            _compressImage(file, 150, 0.5, 'image/webp')
                .then(function(thumb) {
                    layers.thumbnail = thumb;
                    return _compressImage(file, 640, 0.6, 'image/webp');
                })
                .then(function(preview) { layers.preview = preview; resolve(layers); })
                .catch(function() {
                    _compressImage(file, 150, 0.5, 'image/jpeg')
                        .then(function(thumb) {
                            layers.thumbnail = thumb;
                            return _compressImage(file, 640, 0.6, 'image/jpeg');
                        })
                        .then(function(preview) { layers.preview = preview; resolve(layers); })
                        .catch(function() { resolve(layers); });
                });
        });
    }

    // === ENVIO por BleAckSystem ===
    /**
     * Envia archivo via ruta JS (ChatStream tipo 'file')
     * Imagenes: envia preview por defecto (options.sendOriginal = true para original)
     */
    function sendFile(deviceId, file, options) {
        options = options || {};
        return new Promise(function(resolve, reject) {
            if (!file) { reject(new Error('Archivo requerido')); return; }
            if (file.size <= 0) { reject(new Error('Archivo vacio')); return; }
            if (file.size > CONFIG.MAX_FILE_SIZE) { reject(new Error('Archivo excede 5MB')); return; }

            var ack = _getAckSystem();
            if (!ack || typeof ack.sendFile !== 'function') {
                reject(new Error('BleAckSystem no disponible (bleInterface no listo)'));
                return;
            }

            var msgId = _generateMsgId();
            var isImage = !!file.type && file.type.indexOf('image/') === 0;

            var transfer = {
                deviceId: _normId(deviceId),
                fileName: options.fileName || file.name || 'archivo',
                mimeType: options.mimeType || file.type || 'application/octet-stream',
                originalSize: file.size,
                state: 'preparing',
                progress: 0,
                isImage: isImage,
                startTime: Date.now()
            };
            _activeTransfers[msgId] = transfer;

            var preparePromise = isImage
                ? _generateProgressiveLayers(file)
                : Promise.resolve({ thumbnail: null, preview: null, original: file });

            preparePromise.then(function(layers) {
                // Elegir payload
                var sendOriginal = options.sendOriginal === true;
                var payloadBlob = file;
                if (isImage && layers.preview && !sendOriginal && !CONFIG.SEND_ORIGINAL_IMAGES) {
                    payloadBlob = layers.preview;
                    transfer.sentLayer = 'preview';
                } else {
                    transfer.sentLayer = 'original';
                }
                transfer.payloadSize = payloadBlob.size;

                if (payloadBlob.size > CONFIG.RECOMMENDED_MAX && !options.skipSizeWarning) {
                    console.warn('[NEXOFileTransfer] Archivo grande (' +
                        Math.round(payloadBlob.size/1024) + 'KB). Sobre BLE puede tardar mucho. ' +
                        'Considera sendOriginal=false para imagenes.');
                }

                transfer.state = 'sending';
                if (options.onProgress) options.onProgress(msgId, 0, 0, payloadBlob.size);

                return _blobToBase64(payloadBlob).then(function(base64) {
                    return ack.sendFile(deviceId, msgId, base64, {
                        type: 'file',
                        name: transfer.fileName,
                        size: payloadBlob.size,
                        format: transfer.mimeType,
                        originalSize: file.size,
                        originalName: file.name,
                        layer: transfer.sentLayer
                    });
                });
            }).then(function() {
                // La confirmacion real llega por nexo:ble:fileProgress/status
                resolve(msgId);
            }).catch(function(err) {
                transfer.state = 'error';
                _fireComplete(msgId, false, err.message, options);
                reject(err);
            });
        });
    }

    function _fireComplete(msgId, success, error, options) {
        if (options && options.onComplete) options.onComplete(msgId, success, error);
        if (_callbacks.onComplete) _callbacks.onComplete(msgId, success, error);
    }

    // === LISTENERS GLOBALES (eventos de ble_ack) ===
    function _setupGlobalListeners() {
        if (_listenersSetup) return;
        _listenersSetup = true;

        window.addEventListener('nexo:ble:fileProgress', function(e) {
            var d = e.detail || {};
            var msgId = d.fileId;
            if (!msgId || !_activeTransfers[msgId]) return;
            var t = _activeTransfers[msgId];
            t.progress = d.percent || 0;
            if (t.progress >= 100) t.state = 'completed';
            if (_callbacks.onProgress) {
                _callbacks.onProgress(msgId, t.progress, d.sent || 0, d.total || 0);
            }
        });

        window.addEventListener('nexo:ble:fileComplete', function(e) {
            var d = e.detail || {};
            var msgId = d.fileId;
            var meta = d.meta || {};

            // 1) Confirmacion de salida (el otro lado ensamblo completo)
            if (msgId && _activeTransfers[msgId]) {
                var t = _activeTransfers[msgId];
                t.state = 'completed';
                t.progress = 100;
                if (_callbacks.onProgress) _callbacks.onProgress(msgId, 100, t.payloadSize || 0, t.payloadSize || 0);
                _fireComplete(msgId, true, null, null);
                return;
            }

            // 2) Archivo entrante: data = base64 ensamblado
            if (d.data && _callbacks.onReceived) {
                var mime = meta.format || meta.mimeType || 'application/octet-stream';
                var blobUrl = _base64ToBlobUrl(d.data, mime);
                _callbacks.onReceived({
                    msgId: msgId,
                    fileId: msgId,
                    blobUrl: blobUrl,
                    base64: d.data,
                    mimeType: mime,
                    fileName: meta.name || 'archivo',
                    size: meta.size || 0,
                    originalSize: meta.originalSize || meta.size || 0,
                    layer: meta.layer || 'original',
                    senderId: meta.senderNexoId || meta.fr || '',
                    timestamp: meta.ts || Date.now(),
                    meta: meta
                });
            }
        });
    }

    // === VOZ ===
    function _startVoiceRecording() {
        return new Promise(function(resolve, reject) {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                reject(new Error('MediaDevices no disponible')); return;
            }
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
                var mimeType = 'audio/webm;codecs=opus';
                var opts = {};
                if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)) {
                    opts.mimeType = mimeType;
                }
                _mediaRecorder = new MediaRecorder(stream, opts);
                _audioChunks = [];
                _mediaRecorder.ondataavailable = function(e) {
                    if (e.data && e.data.size > 0) _audioChunks.push(e.data);
                };
                _mediaRecorder.start(100);
                resolve();
            }).catch(reject);
        });
    }
    function _stopVoiceRecording() {
        return new Promise(function(resolve, reject) {
            if (!_mediaRecorder) { reject(new Error('No hay grabacion activa')); return; }
            var recorder = _mediaRecorder;
            recorder.onstop = function() {
                var blob = new Blob(_audioChunks, { type: recorder.mimeType || 'audio/webm' });
                _mediaRecorder = null; _audioChunks = [];
                resolve(blob);
            };
            recorder.stop();
        });
    }
    function startVoiceRecording() { return _startVoiceRecording(); }
    function sendVoice(deviceId, options) {
        options = options || {};
        return _stopVoiceRecording().then(function(blob) {
            return sendFile(deviceId, blob, {
                fileName: 'voice-' + Date.now() + '.webm',
                mimeType: blob.type || 'audio/webm',
                onProgress: options.onProgress,
                onComplete: options.onComplete,
                skipSizeWarning: true
            });
        });
    }

    function cancelTransfer(msgId) {
        var ack = _getAckSystem();
        if (ack && typeof ack.cancelFileSend === 'function') {
            ack.cancelFileSend(msgId);
        }
        if (_activeTransfers[msgId]) _activeTransfers[msgId].state = 'cancelled';
        return Promise.resolve(true);
    }

    // === CALLBACKS ===
    function onProgress(cb) { _callbacks.onProgress = cb; }
    function onComplete(cb) { _callbacks.onComplete = cb; }
    function onReceived(cb) { _callbacks.onReceived = cb; }
    function onThumbnail(cb) { _callbacks.onThumbnail = cb; }
    function onPreview(cb) { _callbacks.onPreview = cb; }

    function getTransfer(msgId) { return _activeTransfers[msgId] || null; }
    function getAllTransfers() {
        var out = {};
        for (var k in _activeTransfers) out[k] = _activeTransfers[k];
        return out;
    }

    _setupGlobalListeners();

    return {
        sendFile: sendFile,
        sendVoice: sendVoice,
        startVoiceRecording: startVoiceRecording,
        cancelTransfer: cancelTransfer,
        onProgress: onProgress,
        onComplete: onComplete,
        onReceived: onReceived,
        onThumbnail: onThumbnail,
        onPreview: onPreview,
        getTransfer: getTransfer,
        getAllTransfers: getAllTransfers,
        base64ToBlobUrl: _base64ToBlobUrl,
        CONFIG: CONFIG
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NEXOFileTransfer: NEXOFileTransfer };
}
if (typeof window !== 'undefined') {
    window.NEXOFileTransfer = NEXOFileTransfer;
}
