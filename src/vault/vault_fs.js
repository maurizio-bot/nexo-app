/**
 * NEXO Vault FS v1.0
 * Persistencia de conversaciones usando Capacitor Filesystem
 * Soporta 500,000 mensajes por contacto sin límite de espacio
   */
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
var VAULT_DIR = 'nexo_messages';
var MAX_MESSAGES = 500000;
function _normId(id) {
return (id || '').toString().toLowerCase().trim();
}
async function _ensureDir() {
try {
await Filesystem.mkdir({ path: VAULT_DIR, directory: Directory.Data, recursive: true });
} catch (e) {}
}
export async function vaultSaveMessages(contactId, messages) {
await _ensureDir();
var cid = _normId(contactId);
if (!cid) return;
if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
await Filesystem.writeFile({
path: VAULT_DIR + '/' + cid + '.json',
data: JSON.stringify(messages),
directory: Directory.Data,
encoding: Encoding.UTF8
});
}
export async function vaultLoadMessages(contactId) {
try {
var cid = _normId(contactId);
if (!cid) return [];
var result = await Filesystem.readFile({
path: VAULT_DIR + '/' + cid + '.json',
directory: Directory.Data,
encoding: Encoding.UTF8
});
return JSON.parse(result.data);
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

