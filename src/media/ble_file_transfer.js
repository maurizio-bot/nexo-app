/**
 * NEXO Turbo File Transfer JS API
 * Envio de archivos, fotos y audio por BLE
 * Base funcional v1
 * ES5 compatible
 */

var NEXOFileTransfer = (function() {
    'use strict';
    var CONFIG = {
        THUMB_MAX_SIZE: 5120,
        THUMB_DIMENSIONS: 150,
        PREVIEW_MAX_SIZE: 61440,
        PREVIEW_DIMENSIONS: 640,
        MAX_FILE_SIZE: 5242880,
        AUDIO_FORMAT: 'audio/webm;codecs=opus',
        AUDIO_FALLBACK: 'audio/wav'
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
    function _generateMsgId() {
        return 'ft-' + Date.now() + '-' +
            Math.random().toString(36).substr(2, 9);
    }
    function _normId(id) {
        return (id || '').toString().toLowerCase().trim();
    }
    /*
     * FIX-01
     * El código anterior tenía:
     *     var result = pluginmethod;
     *
     * Eso no llamaba al método nativo.
     */
    function _safeNativeCall(plugin, method, args) {
        return new Promise(function(resolve, reject) {
            if (!plugin || typeof plugin[method] !== 'function') {
                reject(new Error(
                    'Método nativo no disponible: ' + method
                ));
                return;
            }
            try {
                var result = plugin[method](args || {});

                if (result && typeof result.then === 'function') {
                    result.then(resolve).catch(reject);
                } else {
                    resolve(result);
                }
            } catch (e) {
                reject(e);
            }
        });
    }
    function _getNativePlugin() {
        if (!window.Capacitor ||
            !window.Capacitor.Plugins) {
            return null;
        }
        return window.Capacitor.Plugins.NexoBLE || null;
    }
    /*
     * Blob -> Base64
     *
     * Esta primera versión utiliza Base64 únicamente para
     * establecer el cableado funcional.
     *
     * Más adelante lo eliminaremos para pasar el archivo
     * mediante URI/stream nativo y evitar copias de memoria.
     */
    function _blobToBase64(blob) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var dataUrl = e.target.result || '';
                    var comma = dataUrl.indexOf(',');

                    if (comma < 0) {
                        reject(new Error(
                            'Formato Base64 inválido'
                        ));
                        return;
                    }
                    resolve(dataUrl.substring(comma + 1));
                } catch (e) {
                    reject(e);
                }
            };
            reader.onerror = function() {
                reject(new Error('Error leyendo archivo'));
            };
            reader.readAsDataURL(blob);
        });
    }
    function _compressImage(
        file,
        maxDimension,
        quality,
        format
    ) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var img = new Image();
                img.onload = function() {
                    try {
                        var canvas =
                            document.createElement('canvas');
                        var ctx =
                            canvas.getContext('2d');
                        var width = img.width;
                        var height = img.height;
                        if (width > height) {
                            if (width > maxDimension) {
                                height = Math.round(
                                    height *
                                    (maxDimension / width)
                                );
                                width = maxDimension;
                            }
                        } else {
                            if (height > maxDimension) {
                                width = Math.round(
                                    width *
                                    (maxDimension / height)
                                );
                                height = maxDimension;
                            }
                        }
                        canvas.width = width;
                        canvas.height = height;
                        ctx.drawImage(
                            img,
                            0,
                            0,
                            width,
                            height
                        );
                        canvas.toBlob(
                            function(blob) {
                                if (blob) {
                                    resolve(blob);
                                } else {
                                    reject(new Error(
                                        'Canvas toBlob falló'
                                    ));
                                }
                            },
                            format,
                            quality
                        );
                    } catch (err) {
                        reject(err);
                    }
                };
                img.onerror = function() {
                    reject(new Error(
                        'Error cargando imagen'
                    ));
                };
                img.src = e.target.result;
            };
            reader.onerror = function() {
                reject(new Error(
                    'Error leyendo imagen'
                ));
            };
            reader.readAsDataURL(file);
        });
    }
    function _generateProgressiveLayers(file) {
        var self = this;
        return new Promise(function(resolve, reject) {
            var layers = {
                thumbnail: null,
                preview: null,
                original: file
            };
            _compressImage(
                file,
                CONFIG.THUMB_DIMENSIONS,
                0.5,
                'image/webp'
            )
            .then(function(thumb) {
                layers.thumbnail = thumb;

                return _compressImage(
                    file,
                    CONFIG.PREVIEW_DIMENSIONS,
                    0.6,
                    'image/webp'
                );
            })
            .then(function(preview) {
                layers.preview = preview;
                resolve(layers);
            })
            .catch(function() {
                _compressImage(
                    file,
                    CONFIG.THUMB_DIMENSIONS,
                    0.5,
                    'image/jpeg'
                )
                .then(function(thumb) {
                    layers.thumbnail = thumb;

                    return _compressImage(
                        file,
                        CONFIG.PREVIEW_DIMENSIONS,
                        0.6,
                        'image/jpeg'
                    );
                })
                .then(function(preview) {
                    layers.preview = preview;
                    resolve(layers);
                })
                .catch(reject);
            });
        });
    }
    /*
     * En esta primera versión mandamos una sola transferencia
     * nativa. El Kotlin se encarga del chunking BLE.
     */
    function _sendNativeFile(
        deviceId,
        msgId,
        file,
        fileName,
        mimeType,
        layers,
        options
    ) {
        var plugin = _getNativePlugin();
        if (!plugin) {
            return Promise.reject(
                new Error('Plugin NexoBLE no disponible')
            );
        }
        return _blobToBase64(file)
            .then(function(base64) {
                var meta = {
                    v: 1,
                    type: 'file_meta',
                    msgId: msgId,
                    ts: Date.now(),
                    payload: {
                        fileName: fileName,
                        fileSize: file.size,
                        mimeType: mimeType,
                        hasThumbnail: !!(
                            layers &&
                            layers.thumbnail
                        ),
                        hasPreview: !!(
                            layers &&
                            layers.preview
                        )
                    }
                };
                return _safeNativeCall(
                    plugin,
                    'sendFileNative',
                    {
                        deviceId: deviceId,
                        fileId: msgId,
                        fileData: base64,
                        meta: JSON.stringify(meta)
                    }
                );
            })
            .then(function(result) {
                if (result && result.started === false) {
                    throw new Error(
                        result.error ||
                        'No se pudo iniciar transferencia'
                    );
                }

                return result;
            });
    }
    function sendFile(deviceId, file, options) {
        options = options || {};

        return new Promise(function(resolve, reject) {
            if (!file) {
                reject(new Error('Archivo requerido'));
                return;
            }
            if (file.size <= 0) {
                reject(new Error('Archivo vacío'));
                return;
            }
            if (file.size > CONFIG.MAX_FILE_SIZE) {
                reject(new Error(
                    'Archivo excede 5MB'
                ));
                return;
            }
            var msgId = _generateMsgId();
            var transfer = {
                deviceId: _normId(deviceId),
                fileName:
                    options.fileName ||
                    file.name ||
                    'archivo',
                mimeType:
                    options.mimeType ||
                    file.type ||
                    'application/octet-stream',
                fileSize: file.size,
                state: 'preparing',
                progress: 0,
                startTime: Date.now()
            };
            _activeTransfers[msgId] = transfer;
            var isImage =
                !!file.type &&
                file.type.indexOf('image/') === 0;
            var preparePromise;
            if (isImage) {
                preparePromise =
                    _generateProgressiveLayers(file);
            } else {
                preparePromise =
                    Promise.resolve({
                        thumbnail: null,
                        preview: null,
                        original: file
                    });
            }
            preparePromise
                .then(function(layers) {
                    transfer.state = 'sending';

                    transfer.thumbnailSize =
                        layers.thumbnail ?
                        layers.thumbnail.size : 0;

                    transfer.previewSize =
                        layers.preview ?
                        layers.preview.size : 0;

                    if (options.onProgress) {
                        options.onProgress(
                            msgId,
                            0,
                            0,
                            file.size
                        );
                    }

                    /*
                     * Importante:
                     * La capa progresiva sigue existiendo,
                     * pero en esta primera versión solamente
                     * enviamos el ORIGINAL.
                     *
                     * Thumbnail/preview los añadiremos al
                     * protocolo después de validar el camino
                     * completo.
                     */
                    return _sendNativeFile(
                        deviceId,
                        msgId,
                        layers.original,
                        transfer.fileName,
                        transfer.mimeType,
                        null,
                        options
                    );
                })
                .then(function() {
                    resolve(msgId);
                })
                .catch(function(err) {
                    transfer.state = 'error';
                    if (options.onComplete) {
                        options.onComplete(
                            msgId,
                            false,
                            err.message
                        );
                    }
                    if (_callbacks.onComplete) {
                        _callbacks.onComplete(
                            msgId,
                            false,
                            err.message
                        );
                    }
                    reject(err);
                });
        });
    }
    function _startVoiceRecording() {
        return new Promise(function(resolve, reject) {
            if (!navigator.mediaDevices ||
                !navigator.mediaDevices.getUserMedia) {
                reject(new Error(
                    'MediaDevices no disponible'
                ));
                return;
            }
            navigator.mediaDevices
                .getUserMedia({ audio: true })
                .then(function(stream) {
                    var mimeType =
                        CONFIG.AUDIO_FORMAT;
                    var options = {};
                    if (
                        typeof MediaRecorder !==
                        'undefined' &&
                        MediaRecorder.isTypeSupported(
                            mimeType
                        )
                    ) {
                        options.mimeType = mimeType;
                    }
                    _mediaRecorder =
                        new MediaRecorder(
                            stream,
                            options
                        );

                    _audioChunks = [];

                    _mediaRecorder.ondataavailable =
                        function(e) {
                            if (
                                e.data &&
                                e.data.size > 0
                            ) {
                                _audioChunks.push(
                                    e.data
                                );
                            }
                        };

                    _mediaRecorder.start(100);

                    resolve();
                })
                .catch(reject);
        });
    }
    function _stopVoiceRecording() {
        return new Promise(function(resolve, reject) {
            if (!_mediaRecorder) {
                reject(new Error(
                    'No hay grabación activa'
                ));
                return;
            }
            var recorder = _mediaRecorder;
            recorder.onstop = function() {
                var blob = new Blob(
                    _audioChunks,
                    {
                        type:
                            recorder.mimeType ||
                            'audio/webm'
                    }
                );
                _mediaRecorder = null;
                _audioChunks = [];
                resolve(blob);
            };

            recorder.stop();
        });
    }
    function startVoiceRecording() {
        return _startVoiceRecording();
    }
    function sendVoice(deviceId, options) {
        options = options || {};

        return _stopVoiceRecording()
            .then(function(blob) {
                return sendFile(
                    deviceId,
                    blob,
                    {
                        fileName:
                            'voice-' +
                            Date.now() +
                            '.webm',
                        mimeType:
                            blob.type ||
                            'audio/webm',
                        onProgress:
                            options.onProgress,
                        onComplete:
                            options.onComplete
                    }
                );
            });
    }
    function cancelTransfer(msgId) {
        var plugin = _getNativePlugin();

        if (!plugin) {
            return Promise.reject(
                new Error('Plugin no disponible')
            );
        }
        return _safeNativeCall(
            plugin,
            'cancelFileTransfer',
            {
                msgId: msgId
            }
        );
    }
    function onProgress(callback) {
        _callbacks.onProgress = callback;
    }
    function onComplete(callback) {
        _callbacks.onComplete = callback;
    }
    function onReceived(callback) {
        _callbacks.onReceived = callback;
    }
    function onThumbnail(callback) {
        _callbacks.onThumbnail = callback;
    }
    function onPreview(callback) {
        _callbacks.onPreview = callback;
    }
    function _setupNativeListeners() {
        var plugin = _getNativePlugin();

        if (!plugin ||
            typeof plugin.addListener !== 'function') {
            return;
        }
        plugin.addListener(
            'onFileProgress',
            function(data) {
                data = data || {};
                var msgId =
                    data.msgId ||
                    data.fileId ||
                    '';
                var progress =
                    data.progress !== undefined ?
                    data.progress :
                    (
                        data.percent !== undefined ?
                        data.percent :
                        0
                    );
                var bytesSent =
                    data.bytesSent !== undefined ?
                    data.bytesSent :
                    (
                        data.sent !== undefined ?
                        data.sent :
                        0
                    );
                var totalBytes =
                    data.totalBytes !== undefined ?
                    data.totalBytes :
                    (
                        data.total !== undefined ?
                        data.total :
                        0
                    );
                if (_activeTransfers[msgId]) {
                    _activeTransfers[msgId].progress =
                        progress;
                }
                if (_callbacks.onProgress) {
                    _callbacks.onProgress(
                        msgId,
                        progress,
                        bytesSent,
                        totalBytes
                    );
                }
            }
        );
        plugin.addListener(
            'onFileComplete',
            function(data) {
                data = data || {};
                var msgId =
                    data.msgId ||
                    data.fileId ||
                    '';
                var success =
                    data.success === true;
                if (_activeTransfers[msgId]) {
                    _activeTransfers[msgId].state =
                        success ?
                        'completed' :
                        'error';

                    _activeTransfers[msgId].progress =
                        success ? 100 : (
                            _activeTransfers[msgId]
                                .progress || 0
                        );
                }
                if (_callbacks.onComplete) {
                    _callbacks.onComplete(
                        msgId,
                        success,
                        data.error
                    );
                }
            }
        );
        plugin.addListener(
            'onFileReceived',
            function(data) {
                if (_callbacks.onReceived) {
                    _callbacks.onReceived(data);
                }
            }
        );
        plugin.addListener(
            'onThumbnailReceived',
            function(data) {
                if (_callbacks.onThumbnail) {
                    _callbacks.onThumbnail(
                        data.msgId,
                        data.data
                    );
                }
            }
        );
        plugin.addListener(
            'onPreviewReceived',
            function(data) {
                if (_callbacks.onPreview) {
                    _callbacks.onPreview(
                        data.msgId,
                        data.data
                    );
                }
            }
        );
    }
    function getTransfer(msgId) {
        return _activeTransfers[msgId] || null;
    }
    function getAllTransfers() {
        return Object.assign(
            {},
            _activeTransfers
        );
    }
    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            _setupNativeListeners
        );
    } else {
        _setupNativeListeners();
    }
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

        CONFIG: CONFIG
    };
})();

if (
    typeof module !== 'undefined' &&
    module.exports
) {
    module.exports = {
        NEXOFileTransfer:
            NEXOFileTransfer
    };
}
if (typeof window !== 'undefined') {
    window.NEXOFileTransfer =
        NEXOFileTransfer;
}
