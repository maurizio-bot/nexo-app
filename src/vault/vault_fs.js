/**
 * NEXO Vault FS v1.3
 * Persistencia de conversaciones usando métodos nativos de NexoBLE
 * FIX: Sin límite artificial de mensajes (solo límite físico del dispositivo)
 * FIX: Queue por contactId para evitar race conditions
 * FIX: Fallback a localStorage si plugin nativo no disponible
 * FIX: Cache en memoria para lecturas rápidas
 */

var VAULT_DIR = 'nexo_messages';
var _writeQueues = new Map();
var _memoryCache = new Map();

function _normId(id) {
    return (id || '').toString().toLowerCase().trim();
}

function _filename(contactId) {
    return VAULT_DIR + '/' + _normId(contactId) + '.json';
}

function _getPlugin() {
    if (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.NexoBLE) {
        return Capacitor.Plugins.NexoBLE;
    }
    return null;
}

function _localStorageKey(contactId) {
    return 'nexo_vault_fallback_' + _normId(contactId);
}

function _saveToLocalStorage(contactId, messages) {
    try {
        var key = _localStorageKey(contactId);
        var data = JSON.stringify(messages);
        if (data.length > 5000000) {
            console.warn('[VaultFS] localStorage límite cercano, truncando mensajes antiguos');
            messages = messages.slice(-1000);
            data = JSON.stringify(messages);
        }
        localStorage.setItem(key, data);
        return true;
    } catch (e) {
        console.warn('[VaultFS] Error localStorage:', e.message);
        return false;
    }
}

function _loadFromLocalStorage(contactId) {
    try {
        var key = _localStorageKey(contactId);
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

async function _processQueue(contactId) {
    var queue = _writeQueues.get(contactId);
    if (!queue || queue.processing) return;
    queue.processing = true;
    while (queue.tasks.length > 0) {
        var task = queue.tasks.shift();
        try {
            var result = await task.fn();
            task.resolve(result);
        } catch (e) {
            task.reject(e);
        }
    }
    queue.processing = false;
    if (queue.tasks.length === 0) {
        _writeQueues.delete(contactId);
    } else {
        setTimeout(function() { _processQueue(contactId); }, 0);
    }
}

function _enqueue(contactId, fn) {
    var cid = _normId(contactId);
    if (!cid) return Promise.resolve();
    if (!_writeQueues.has(cid)) {
        _writeQueues.set(cid, { tasks: [], processing: false });
    }
    return new Promise(function(resolve, reject) {
        _writeQueues.get(cid).tasks.push({ fn: fn, resolve: resolve, reject: reject });
        _processQueue(cid);
    });
}

export async function vaultSaveMessages(contactId, messages) {
    var cid = _normId(contactId);
    if (!cid) return;
    return _enqueue(cid, async function() {
        var plugin = _getPlugin();
        if (plugin) {
            try {
                await plugin.saveToFile({
                    filename: _filename(cid),
                    content: JSON.stringify(messages)
                });
                _memoryCache.set(cid, messages.slice());
                return;
            } catch (e) {
                console.warn('[VaultFS] saveToFile nativo falló, fallback localStorage:', e.message);
            }
        }
        _saveToLocalStorage(cid, messages);
        _memoryCache.set(cid, messages.slice());
    });
}

export async function vaultLoadMessages(contactId) {
    var cid = _normId(contactId);
    if (!cid) return [];
    if (_memoryCache.has(cid)) {
        return _memoryCache.get(cid).slice();
    }
    var plugin = _getPlugin();
    if (plugin) {
        try {
            var result = await plugin.loadFromFile({
                filename: _filename(cid)
            });
            if (result.exists) {
                var messages = JSON.parse(result.content);
                _memoryCache.set(cid, messages.slice());
                return messages;
            }
        } catch (e) {
            console.warn('[VaultFS] loadFromFile nativo falló, fallback localStorage:', e.message);
        }
    }
    var messages = _loadFromLocalStorage(cid);
    _memoryCache.set(cid, messages.slice());
    return messages;
}

export async function vaultAppendMessage(contactId, message) {
    var cid = _normId(contactId);
    if (!cid) return;
    return _enqueue(cid, async function() {
        var messages = await vaultLoadMessages(cid);
        var exists = messages.some(function(m) { return m.messageId === message.messageId; });
        if (!exists) {
            messages.push(message);
            await vaultSaveMessages(cid, messages);
        }
    });
}

export async function vaultUpdateMessageStatus(contactId, messageId, status) {
    var cid = _normId(contactId);
    if (!cid || !messageId) return;
    return _enqueue(cid, async function() {
        var messages = await vaultLoadMessages(cid);
        var updated = false;
        for (var i = 0; i < messages.length; i++) {
            if (messages[i].messageId === messageId) {
                messages[i].status = status;
                updated = true;
                break;
            }
        }
        if (updated) await vaultSaveMessages(cid, messages);
    });
}

export function vaultClearCache() {
    _memoryCache.clear();
}
