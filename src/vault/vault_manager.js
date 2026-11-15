/**
 * vault_manager.js v2.3.6
 * v2.3.6: vaultDeleteMessage (eliminar para mí) y vaultBlankMessage (eliminado para todos: queda el aviso);
 *         ambos borran los archivos del adjunto y del HD.
 * v2.3.5: escrituras del registro de salientes en cola por contacto (antes se pisaban); kx es protocolo.
 * v2.3.4: un mensaje nuevo se escribe al momento; cambios de estado y duplicados, agrupados (300 ms).
 * v2.3.3: vídeo HD: vaultReplaceAttachment (el HD sustituye a la previa), vaultSetMessageFields,
 *         vaultSaveFile y vaultHydrateAttachments(..., { preferHd }) para ver el original propio.
 * v2.3.2: contactos con lastMessageAt (orden de la lista por último mensaje); guardado de contactos
 *         agrupado (300 ms) para no escribir el archivo con cada paquete recibido.
 * FIX v2.3.1: historial sin carreras. Cada cambio (añadir, estado, guardar) va en cola por contacto y
 *             las lecturas simultáneas comparten una carga. Antes, al abrir la app (caché vacía) dos
 *             mensajes seguidos leían el mismo archivo y el segundo guardado borraba el primero.
 * v2.3.0: adjuntos grandes en archivo propio (attachmentRef) + vaultHydrateAttachments; migración automática.
 * FIX v2.2.3: estado de mensaje no se degrada; completar transferencia no pisa el adjunto guardado.
 * FIX: Filtro defensivo anti-protocolo TURBO compacto (t: c/f/n/a/ss/sr)
 * Base: v2.2.1-D2
 */


// Reestructuración 15-11: este archivo es la PUERTA de siempre; el código está en vault_shared.js, vault_contacts.js, vault_messages.js, vault_transfers.js, vault_big.js.
export { initVault, vaultLoadContacts, vaultSaveContacts, vaultSaveContact, vaultFindContactByNexoId, vaultUpdateContactLastSeen, vaultGetOrCreateContact, vaultFlushAll } from './vault_contacts.js';
export { vaultHydrateAttachments, vaultLoadRecent, vaultLoadMessages, vaultSaveMessages, vaultSetUsageHook, vaultAppendMessage, vaultSaveFile, vaultLoadFile, vaultHdFileName, vaultThumbFileName, vaultSetMessageFields, vaultDeleteMessage, vaultBlankMessage, vaultConsumeOnceMessage, vaultEditMessage, vaultReactMessage, vaultReplaceAttachment, vaultUpdateMessageStatus, vaultPatchMessage, vaultGetPendingMessages } from './vault_messages.js';
export { vaultCreateTransfer, vaultAppendChunk, vaultGetTransfer, vaultGetIncompleteTransfers, vaultGetAllTransfers, vaultCompleteTransfer, vaultCancelTransfer, vaultCleanupTransfers, OUT_INLINE_MAX, vaultCreateOutgoingTransfer, vaultSetOutgoingChunkAcked, vaultIncrementOutgoingTimeout, vaultGetOutgoingTransfer, vaultGetPendingOutgoingTransfers, vaultRemoveOutgoingTransfer, vaultSetOutgoingStatus, BIGSEND_MIN_CHARS, BIGSEND_MAX_TRIES, BIGSEND_WINDOW_MS } from './vault_transfers.js';
export { bigSendBlocked, vaultBigSendBegin, vaultBigSendEnd, vaultBigSendBlockedIds, BIGX_SLICE_CHARS, BIGX_BLOCK, BIGX_TTL_MS, bigxSliceName, bigxBlockName, vaultBigxInit, vaultBigxOutHas, vaultBigxOutPut, vaultBigxOutGet, vaultBigxOutDrop, vaultBigxInIndex, vaultBigxInPutBlock, vaultBigxInGetBlock, vaultBigxInDrop, vaultCleanupOutgoingTransfers } from './vault_big.js';
