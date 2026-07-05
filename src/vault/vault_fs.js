/**
 * NEXO Vault FS v1.1
 * Persistencia de conversaciones usando métodos nativos de NexoBLE
 * Soporta 500,000 mensajes por contacto sin límite de espacio
 */

var VAULT_DIR = 'nexo_messages';
var MAX_MESSAGES = 500000;

function _normId(id) {
    return (id || '').toString().toLowerCase().trim();
}

function _filename(contactId) {
    return VAULT_DIR + '/' + _normId(contactId) + '.json';
}

async function _ensureDir() {
    try {
        await Capacitor.Plugins.NexoBLE.saveToFile({
            filename: VAULT_DIR + '/.init',
            content: '1'
        });
    } catch (e) {}
}

export async function vaultSaveMessages(contactId, messages) {
    await _ensureDir();
    var cid = _normId(contactId);
    if (!cid) return;
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
    await Capacitor.Plugins.NexoBLE.saveToFile({
        filename: _filename(contactId),
        content: JSON.stringify(messages)
    });
}

export async function vaultLoadMessages(contactId) {
    try {
        var cid = _normId(contactId);
        if (!cid) return [];
        var result = await Capacitor.Plugins.NexoBLE.loadFromFile({
            filename: _filename(contactId)
        });
        if (!result.exists) return [];
        return JSON.parse(result.content);
    } catch (e) { return []; }
}

export async function vaultAppendMessage(contactId, message) {
    var messages = await vaultLoadMessages(contactId);
    var exists = messages.some(function(m) { return m.messageId === message.messageId; });
    if (!exists) {
        messages.push(message);
        await vaultSaveMessages(contactId, messages);
    }
}

export async function vaultUpdateMessageStatus(contactId, messageId, status) {
    var messages = await vaultLoadMessages(contactId);
    var updated = false;
    for (var i = 0; i < messages.length; i++) {
        if (messages[i].messageId === messageId) {
            messages[i].status = status;
            updated = true;
            break;
        }
    }
    if (updated) await vaultSaveMessages(contactId, messages);
}
