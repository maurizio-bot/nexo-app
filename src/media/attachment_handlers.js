/**
 * attachment_handlers.js v2.5 — NEXO
 *
 * Este archivo NO controla el envío ni la recepción de adjuntos.
 *
 * Flujo único:
 * - Cámara → main.js → _sendAttachment()
 * - Galería → main.js → _sendAttachment()
 * - Archivo → main.js → _sendAttachment()
 * - Audio/voz → main.js
 * - Recepción → ble_ack.js → fileComplete → main.js
 *
 * IMPORTANTE:
 * - No registrar listeners para camera/gallery/file.
 * - No llamar NEXOPhotos.sendPhoto().
 * - No llamar NEXOFileTransfer.sendFile().
 * - No crear burbujas.
 * - No cambiar estados de mensajes.
 * - No procesar recepción.
 *
 * ES5 compatible.
 */
(function() {
'use strict';
console.log('[attachment_handlers v2.5] Flujo de adjuntos delegado exclusivamente a main.js');
})();
