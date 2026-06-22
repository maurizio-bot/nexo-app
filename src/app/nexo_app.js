/**
 * NEXO App v5.0.9d-ARMORED-FIXED
 * Base: v5.0.9c-ARMORED
 * FIX: Timeout BLE 8000ms -> 15000ms para conexion GATT completa
 * FIX: Dedup por MAC ademas de UUID
 * FIX: deviceUUID pasado a _handleMessage
 * ES5 syntax for webpack compatibility
 * Proper named exports for main.js import
 */
import { GestureEngine as CoreGestureEngine } from '../core/gesture_engine.js';
import { CryptoVault } from '../vault/crypto_vault.js';
import { BLEInterface as HybridMesh } from '../mesh/hybrid_mesh.js';
import { NordicMesh } from '../mesh/nordic_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { TheStream } from '../stream/the_stream.js';
import { rem } from '../ui/rem.js';
import { initBLEInterface } from '../ui/ble_interface.js';

function withTimeoutNAP(promise, ms, context) {
var timer;
var timeoutPromise = new Promise(function(_, reject) {
timer = setTimeout(function() { reject(new Error('[NAP_TIMEOUT] ' + context)); }, ms);
});
return Promise.race([promise, timeoutPromise]).finally(function() { if (timer) clearTimeout(timer); });
}

var DEBUG = {
rem: rem,
_logBuffer: [],
log: function(msg, type, code) {
type = type || 'info';
var entry = { ts: Date.now(), time: new Date().toLocaleTimeString(), type: type, code: code, msg: msg };
DEBUG._logBuffer.push(entry);
if (DEBUG._logBuffer.length > 1000) DEBUG._logBuffer.shift();
console.log('[' + entry.time + '] [' + type.toUpperCase() + ']' + (code ? '[' + code + ']' : '') + ' ' + msg);
var method = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warn' ? 'warn' : 'info';
if (code) rem[method](msg, code); else rem[method](msg);
},
error: function(code, msg) { DEBUG.log(msg, 'error', code); },
success: function(msg, code) { DEBUG.log(msg, 'success', code); },
warn: function(msg, code) { DEBUG.log(msg, 'warn', code); },
setPhase: function(p) { rem.updatePhase(p); },
setMode: function(m) { rem.updateMode(m); },
setIdentity: function(id) { if (id) rem.updateIdentity(id); }
};

/* ============================================================
HELPERS DEFENSIVOS
============================================================ */
function _safeCall(obj, method, args, fallback) {
try {
if (obj && typeof obj[method] === 'function') {
return obj[method].apply(obj, args || []);
}
} catch (e) {
console.warn('[NexoApp] SafeCall fallo ' + method + ':', e.message);
}
return fallback;
}
function _safeJSONParse(str, fallback) {
try { return JSON.parse(str); } catch (e) { return fallback; }
}
function _safeJSONStringify(obj) {
try { return JSON.stringify(obj); } catch (e) { return '{}'; }
}
function _normId(id) {
return (id || '').toString().toLowerCase().trim();
}

class NexoApp {
constructor(config) {
config = config || {};
this.config = {
relayUrls: Array.isArray(config.relayUrls) ? config.relayUrls : [],
enableGestures: config.enableGestures !== false,
enableMesh: config.enableMesh !== false,
onMessage: typeof config.onMessage === 'function' ? config.onMessage : function() {},
onStatusChange: typeof config.onStatusChange === 'function' ? config.onStatusChange : function() {},
onError: typeof config.onError === 'function' ? config.onError : function(e) { console.error(e); },
};
if (config.relayUrls) this.config.relayUrls = config.relayUrls;
if (config.enableGestures !== undefined) this.config.enableGestures = config.enableGestures;
if (config.enableMesh !== undefined) this.config.enableMesh = config.enableMesh;
if (config.onMessage) this.config.onMessage = config.onMessage;
if (config.onStatusChange) this.config.onStatusChange = config.onStatusChange;
if (config.onError) this.config.onError = config.onError;
this._resources = { timers: new Set(), listeners: new Set(), handlers: new Set() };
this._isInitializing = false;
this._isDestroyed = false;
this.vault = null;
this.mesh = null;
this.nordicMesh = null;
this.blePeers = new Map();
this.wsClient = null;
this.bridge = null;
this.gestures = null;
this.stream = null;
this.vaultSlider = null;
this.bleInterface = null;
this.initialized = false;
this.activeContact = null;
this._bleChatHandler = null;
this._bleMessageHandler = null;
this._messageDedupMap = new Map();
this._maxProcessedIds = 1000;
this._dedupTTL = 300000;
DEBUG.log('NEXO v5.0.9d-ARMORED iniciando...', 'info', 'APP_INIT');
}
async init() {
if (this.initialized) { DEBUG.warn('Already initialized', 'APP_SKIP'); return this; }
if (this._isInitializing) throw new Error('[APP_018] Initialization in progress');
if (this._isDestroyed) throw new Error('[APP_019] Cannot init destroyed');
this._isInitializing = true;
DEBUG.setPhase('INIT');
try {
await this._initPhase1_Crypto();
await this._initPhase2_WebSocket();
var nativeAvailable = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE);
if (this.config.enableMesh && !nativeAvailable) await this._initPhase3_NordicMesh();
if (this.config.enableMesh && !nativeAvailable) await this._initPhase4_HybridMesh();
await this._initPhase5_BLEUI();
await this._initPhase6_Bridge();
await this._initPhase7_UI();
this.initialized = true;
DEBUG.setPhase('READY');
DEBUG.success('NEXO v5.0.9d-ARMORED Ready', 'APP_READY');
} catch (err) {
DEBUG.error('APP_020', 'Init failed: ' + (err.message || 'unknown'));
await this._partialCleanup();
throw err;
} finally { this._isInitializing = false; }
return this;
}
async _initPhase1_Crypto() {
DEBUG.setPhase('CRYPTO');
try {
this.vault = new CryptoVault();
await withTimeoutNAP(this.vault.init(), 5000, 'CryptoVault.init');
var identity = this.vault.getIdentity ? this.vault.getIdentity() : null;
if (identity) { DEBUG.setIdentity(identity); DEBUG.success('Vault initialized', 'CRYPTO_002'); }
} catch (err) { DEBUG.error('CRYPTO_004', 'Vault init failed: ' + (err.message || 'unknown')); this.vault = null; }
}
async _initPhase2_WebSocket() {
DEBUG.setPhase('WEBSOCKET');
if (this.config.relayUrls.length === 0) { DEBUG.warn('No relay URLs', 'WS_SKIP'); return; }
try {
this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
var self = this;
this.wsClient.onMessage = function(m) { self._handleMessage(m, 'relay'); };
this.wsClient.onOpen = function() { DEBUG.setMode('RELAY'); };
await withTimeoutNAP(this.wsClient.connect(), 8000, 'WebSocket.connect');
} catch (err) { DEBUG.warn('WebSocket unavailable: ' + (err.message || 'unknown'), 'WS_004'); this.wsClient = null; }
}
async _initPhase3_NordicMesh() {
DEBUG.setPhase('NORDIC_MESH');
try {
if (!this.vault) throw new Error('Vault required');
this.nordicMesh = new NordicMesh(this.vault, { rssiThreshold: -85, chunkSize: 507, handshakeTimeout: 30000 });
var self = this;
var unsub1 = this.nordicMesh.on('peerDiscovered', function(p) { self._handleNordicPeer(p); });
var unsub2 = this.nordicMesh.on('sessionEstablished', function(d) { self._handleNordicSession(d); });
var unsub3 = this.nordicMesh.on('messageReceived', function(m) { self._handleNordicMessage(m); });
var unsub4 = this.nordicMesh.on('stateChanged', function(s) { self._updateModeFromNordic(s.to); });
var unsub5 = this.nordicMesh.on('error', function(err) { DEBUG.error('NORDIC_010', err.message); });
this._resources.handlers.add(unsub1);
this._resources.handlers.add(unsub2);
this._resources.handlers.add(unsub3);
this._resources.handlers.add(unsub4);
this._resources.handlers.add(unsub5);
var result = await withTimeoutNAP(this.nordicMesh.init(), 10000, 'NordicMesh.init');
if (!result.success) throw new Error(result.error ? result.error.message : 'Nordic init returned false');
DEBUG.success('Nordic Mesh active [Native:' + result.isNative + ']', 'NORDIC_002');
} catch (err) { DEBUG.error('NORDIC_005', 'Nordic init failed: ' + (err.message || 'unknown')); this.nordicMesh = null; }
}
async _initPhase4_HybridMesh() {
DEBUG.setPhase('MESH');
try {
var self = this;
this.mesh = new HybridMesh({
onDeviceFound: function(d) { DEBUG.log('Hybrid found: ' + (d.name || 'unknown'), 'info', 'MESH_DEVICE'); },
onDeviceConnected: function(d) { DEBUG.success('Hybrid connected: ' + (d.name || 'unknown'), 'MESH_CONN'); },
onDeviceDisconnected: function(d) { DEBUG.log('Hybrid disconnected', 'warn', 'MESH_DISC'); },
onError: function(code, msg) { DEBUG.error('MESH_006', msg); }
});
await withTimeoutNAP(this.mesh.initialize(), 15000, 'HybridMesh.initialize');
DEBUG.success('Hybrid Mesh ready', 'MESH_002');
} catch (err) { DEBUG.error('APP_016', 'Hybrid Mesh: ' + (err.message || 'unknown')); this.mesh = null; }
}
async _initPhase5_BLEUI() {
DEBUG.setPhase('BLE_UI');
try {
var meshInstance = this.nordicMesh || this.mesh || null;
this.bleInterface = initBLEInterface(meshInstance);
if (this.bleInterface) DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (native)'), 'UI_002');
var self = this;
this._bleChatHandler = function(e) {
try {
var detail = e.detail || {};
self.activeContact = { id: detail.contactId, name: detail.name, address: detail.address, transport: detail.transport };
var appContainer = document.getElementById('app');
if (appContainer) appContainer.classList.remove('hidden');
var nameInput = document.getElementById('chat-contact-name');
var subtitle = document.getElementById('chat-contact-subtitle');
if (nameInput) nameInput.value = detail.name || 'NEXO Device';
if (subtitle) subtitle.textContent = detail.transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
DEBUG.success('Chat activo: ' + (detail.name || 'NEXO') + ' [' + (detail.transport || 'unknown').toUpperCase() + ']', 'BLE_CHAT');
self._updateMode('P2P_BLE');
self.config.onStatusChange('CHAT:' + (detail.name || 'NEXO'));
if (self.bleInterface && self.bleInterface.showToast) {
self.bleInterface.showToast('Chat con ' + (detail.name || 'NEXO') + ' listo', 'success');
}
} catch (handlerErr) {
console.error('[NexoApp] Error en _bleChatHandler:', handlerErr);
DEBUG.error('BLE_UI_001', 'Error en chat handler: ' + (handlerErr.message || 'unknown'));
if (self.bleInterface && self.bleInterface.showToast) {
self.bleInterface.showToast('Error al abrir chat: ' + (handlerErr.message || 'desconocido'), 'error');
}
}
};
window.addEventListener('nexo:ble:openChat', this._bleChatHandler);
this._bleMessageHandler = function(e) {
try {
var detail = e.detail || {};
/* FIX DEDUPLICACION BROADCAST: Descartar mensajes propios */
var localUUID = self.bleInterface && self.bleInterface.localDeviceUUID ? self.bleInterface.localDeviceUUID : '';
var senderUUID = detail.deviceUUID || '';
var senderMAC = detail.macAddress || '';
/* FIX: Ignorar mensajes propios por UUID o MAC */
if (senderUUID && localUUID && _normId(senderUUID) === _normId(localUUID)) {
console.log('[BLE_RECV] Mensaje propio ignorado por UUID');
return;
}
if (senderMAC && self.bleInterface && self.bleInterface.localDeviceAddress && _normId(senderMAC) === _normId(self.bleInterface.localDeviceAddress)) {
console.log('[BLE_RECV] Mensaje propio ignorado por MAC');
return;
}
console.log('[BLE_RECV] Mensaje de ' + (detail.senderName || 'NEXO Peer') + ': ' + (detail.content ? detail.content.substring(0, 30) : '') + '...');
var resolvedName = detail.senderName;
if (!resolvedName || resolvedName === 'NEXO Peer') {
var nid = (detail.deviceId || '').toString().toLowerCase().trim();
var connDev = self.bleInterface && self.bleInterface.connectedDevices ? self.bleInterface.connectedDevices.get(nid) : null;
var foundDev = self.bleInterface && self.bleInterface.foundDevices ? self.bleInterface.foundDevices.get(nid) : null;
resolvedName = (connDev && connDev.name) || (foundDev && foundDev.name) || detail.senderName || 'NEXO Peer';
}
self._handleMessage({
content: detail.content,
sender: detail.deviceId,
senderName: resolvedName,
source: detail.source || 'ble_direct',
timestamp: detail.timestamp || Date.now(),
messageId: detail.messageId,
deviceUUID: detail.deviceUUID || detail.deviceId,
macAddress: detail.macAddress || '',
_own: false
}, 'ble_direct');
} catch (handlerErr) {
console.error('[NexoApp] Error en _bleMessageHandler:', handlerErr);
DEBUG.error('BLE_UI_002', 'Error en message handler: ' + (handlerErr.message || 'unknown'));
if (self.bleInterface && self.bleInterface.showToast) {
self.bleInterface.showToast('Error al recibir mensaje: ' + (handlerErr.message || 'desconocido'), 'error');
}
}
};
window.addEventListener('nexo:ble:messageReceived', this._bleMessageHandler);
} catch (err) { DEBUG.error('UI_004', 'BLE UI init failed: ' + (err.message || 'unknown')); this.bleInterface = null; }
}
async _initPhase6_Bridge() {
DEBUG.setPhase('BRIDGE');
try {
if (!this.mesh && !this.nordicMesh && !this.wsClient && !(this.bleInterface && this.bleInterface.nativePlugin)) {
DEBUG.warn('No transports', 'BRIDGE_SKIP');
return;
}
var self = this;
this.bridge = new MeshRelayBridge({
mesh: this.mesh,
nordicMesh: this.nordicMesh,
relay: this.wsClient,
onModeChange: function(mode) { DEBUG.setMode(mode); self.config.onStatusChange(mode); }
});
await withTimeoutNAP(this.bridge.initialize(), 5000, 'Bridge.initialize');
DEBUG.success('Bridge ready', 'BRIDGE_002');
} catch (err) { DEBUG.warn('Bridge init failed: ' + (err.message || 'unknown'), 'BRIDGE_003'); this.bridge = null; }
}
async _initPhase7_UI() {
DEBUG.setPhase('GESTURES');
if (this.config.enableGestures) { try { this.gestures = new GestureEngine({}); this.gestures.init(); } catch (e) {} }
DEBUG.setPhase('VAULT_SLIDER');
var streamEl = document.getElementById('nexo-stream');
var vaultEl = document.getElementById('nexo-vault');
if (streamEl && vaultEl) { try { this.vaultSlider = new CoreGestureEngine(streamEl, vaultEl); } catch (e) {} }
DEBUG.setPhase('STREAM');
var container = document.getElementById('messages-container');
if (container) { try { this.stream = new TheStream(container, {}); } catch (e) {} }
}
_handleNordicPeer(peer) { if (!peer || !peer.id) return; this.blePeers.set(peer.id, Object.assign({}, peer, { discoveredAt: Date.now() })); }
_handleNordicSession(data) { if (!data || !data.deviceId) return; this._updateMode('P2P_BLE'); }
_handleNordicMessage(msg) { if (!msg || !msg.deviceId) return; this._handleMessage({ content: msg.content, sender: msg.deviceId, source: 'ble_nordic', timestamp: msg.timestamp || Date.now() }, 'ble_nordic'); }
_updateModeFromNordic(state) {
switch(state) {
case 'messaging': case 'connected': this._updateMode('P2P_BLE'); break;
case 'offline': if ((!this.mesh || !this.mesh.getPeerCount || this.mesh.getPeerCount() === 0) && (!this.wsClient || !this.wsClient.isConnected || !this.wsClient.isConnected())) this._updateMode('OFFLINE'); break;
}
}
_updateMode(mode) { DEBUG.setMode(mode); this.config.onStatusChange(mode); }
/* ============================================================
ENVIO DE MENSAJES: Anti-crash + Render Lazy + Transport Priority
FIX v5.0.9d: Timeout BLE 8000ms -> 15000ms (tiempo real GATT)
============================================================ */
async sendMessage(msg) {
if (!this.initialized || this._isDestroyed) {
DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send');
if (this.bleInterface && this.bleInterface.showToast) {
this.bleInterface.showToast('Error: App no inicializada', 'error');
}
return false;
}
try {
var messageId = msg.messageId || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));
var isObject = msg && typeof msg === 'object';
var content = isObject ? (msg.content || msg) : msg;
var recipient = isObject ? msg.recipient : null;
var targetId = recipient || (this.activeContact ? this.activeContact.id : null);
var targetTransport = this.activeContact ? this.activeContact.transport : null;
if (!content || (typeof content === 'string' && content.trim() === '')) {
if (this.bleInterface && this.bleInterface.showToast) {
this.bleInterface.showToast('Error: Escribe un mensaje', 'warning');
}
return false;
}
/* === PASO 3: Intentar BLE directo === */
if (targetId && targetTransport === 'ble' && this.bleInterface && typeof this.bleInterface.sendChatMessage === 'function') {
try {
console.log('[NEXO] Enviando via sendChatMessage a UUID:', targetId);
/* FIX v5.0.9d: 15000ms para dar tiempo a conexion GATT completa */
await withTimeoutNAP(this.bleInterface.sendChatMessage(targetId, content, messageId), 15000, 'BLE.sendChatMessage');
this._handleMessage({
content: content,
_own: true,
timestamp: Date.now(),
pending: false,
recipient: targetId,
source: 'ble_direct',
messageId: messageId
}, 'self');
DEBUG.success('Enviado via BLE a ' + targetId, 'MSG_BLE');
if (this.bleInterface && this.bleInterface.showToast) {
this.bleInterface.showToast('Mensaje enviado', 'success');
}
return true;
} catch (e) {
DEBUG.warn('BLE directo fallo: ' + (e.message || 'unknown'), 'MSG_BLE_FAIL');
if (this.bleInterface && this.bleInterface.showToast) {
this.bleInterface.showToast('Fallo envio BLE: ' + (e.message || 'Error desconocido'), 'error');
}
}
}
/* === PASO 7: Intentar Nordic Mesh === */
var nordicPeers = this.nordicMesh && this.nordicMesh.getPeers ? this.nordicMesh.getPeers() : [];
if (nordicPeers.length > 0) {
try {
await this.nordicMesh.sendMessage(nordicPeers[0].id, content);
DEBUG.success('Sent via Nordic', 'MSG_NORDIC');
return true;
}
catch (e) {
DEBUG.error('NORDIC_009', 'Send failed: ' + (e.message || 'unknown'));
}
}
/* === PASO 8: Intentar Hybrid Mesh === */
if (this.mesh && this.mesh.getPeerCount && this.mesh.getPeerCount() > 0) {
try {
await this.mesh.broadcast({ content: content });
DEBUG.success('Sent via Hybrid', 'MSG_HYBRID');
return true;
}
catch (e) {
DEBUG.error('MESH_005', 'Broadcast failed: ' + (e.message || 'unknown'));
}
}
/* === PASO 9: Intentar Bridge === */
if (this.bridge) {
var result = await this.bridge.send({ content: content });
if (result) {
DEBUG.success('Sent via Bridge', 'MSG_BRIDGE');
return true;
}
}
/* === PASO 10: Intentar WebSocket === */
if (this.wsClient && this.wsClient.isConnected && this.wsClient.isConnected()) {
this.wsClient.send({ content: content });
DEBUG.success('Sent via WebSocket', 'MSG_WS');
return true;
}
/* === FALLO: Ningun transporte disponible === */
DEBUG.warn('No hay dispositivos NEXO disponibles.', 'MSG_FAIL');
if (this.bleInterface && this.bleInterface.showToast) {
this.bleInterface.showToast('No hay dispositivos NEXO disponibles. Mensaje no enviado.', 'warning');
}
return false;
} catch (err) {
DEBUG.error('APP_008', 'SendMessage critical: ' + (err.message || 'unknown'));
if (this.bleInterface && this.bleInterface.showToast) {
this.bleInterface.showToast('Error critico al enviar: ' + (err.message || 'desconocido'), 'error');
}
return false;
}
}
_handleMessage(msg, source) {
if (this._isDestroyed) return;
try {
if (msg.messageId) {
var now = Date.now();
if (this._messageDedupMap.has(msg.messageId)) {
if (source !== 'self') {
DEBUG.log('Deduplicado ' + (msg.messageId ? msg.messageId.substring(0, 8) : '') + ' de ' + source, 'debug', 'DEDUP');
}
return;
}
this._messageDedupMap.set(msg.messageId, now);
if (this._messageDedupMap.size > this._maxProcessedIds) {
var oldestKey = null;
var oldestTime = Infinity;
this._messageDedupMap.forEach(function(v, k) {
if (v < oldestTime) { oldestTime = v; oldestKey = k; }
});
if (oldestKey) this._messageDedupMap.delete(oldestKey);
}
var keysToDelete = [];
this._messageDedupMap.forEach(function(v, k) {
if (now - v > this._dedupTTL) keysToDelete.push(k);
}.bind(this));
for (var i = 0; i < keysToDelete.length; i++) {
this._messageDedupMap.delete(keysToDelete[i]);
}
}
var enriched = Object.assign({}, msg, { _source: source, _ts: Date.now(), _id: Math.random().toString(36).substr(2, 9) });
this.config.onMessage(enriched);
if (this.stream && this.stream.appendItems) this.stream.appendItems([enriched]);
} catch (err) {
DEBUG.error('APP_005', 'Message handler: ' + (err.message || 'unknown'));
if (this.bleInterface && this.bleInterface.showToast) {
this.bleInterface.showToast('Error al mostrar mensaje: ' + (err.message || 'desconocido'), 'error');
}
}
}
async _partialCleanup() {
if (this.nordicMesh) { try { if (this.nordicMesh.destroy) await this.nordicMesh.destroy(); } catch(e) {} this.nordicMesh = null; }
if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
if (this.wsClient) { try { if (this.wsClient.disconnect) await this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
}
async destroy() {
if (this._isDestroyed) return;
this._isDestroyed = true;
DEBUG.log('Cleanup...', 'info', 'DESTROY');
if (this._bleChatHandler) {
try { window.removeEventListener('nexo:ble:openChat', this._bleChatHandler); } catch(e) {}
this._bleChatHandler = null;
}
if (this._bleMessageHandler) {
try { window.removeEventListener('nexo:ble:messageReceived', this._bleMessageHandler); } catch(e) {}
this._bleMessageHandler = null;
}
if (this.bleInterface) {
try { this.bleInterface.destroy(); } catch(e) {}
this.bleInterface = null;
}
if (this.nordicMesh) {
this._resources.handlers.forEach(function(unsub) { try { unsub(); } catch(e) {} });
try { if (this.nordicMesh.destroy) await this.nordicMesh.destroy(); } catch(e) {}
this.nordicMesh = null;
}
if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
if (this.wsClient) { try { if (this.wsClient.disconnect) await this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
if (this.vault) { try { if (this.vault.destroy) await this.vault.destroy(); } catch(e) {} this.vault = null; }
this._resources.timers.forEach(function(t) { clearTimeout(t); });
DEBUG.success('Cleanup complete', 'DESTROY_OK');
}
getStatus() {
return {
initialized: this.initialized,
mode: (this.mesh && this.mesh.getStatus) ? this.mesh.getStatus().mode : (this.nordicMesh && this.nordicMesh.getState && this.nordicMesh.getState() === 'messaging' ? 'p2p_ble' : 'offline'),
hasBLEInterface: !!this.bleInterface,
activeContact: this.activeContact ? { name: this.activeContact.name, transport: this.activeContact.transport } : null
};
}
}
export { NexoApp, DEBUG };
export default NexoApp;
