/**
 * main.js - NEXO v10.0
 * Punto de entrada. Navegación entre 3 vistas: chat-list, chat, ble-scan.
   */
// ============================================================
// CONFIG
// ============================================================
const CFG = {
APP_NAME: 'NEXO',
VERSION: '10.0.0',
SPLASH_MS: 2500,
DEDUP_TTL: 30000,
};
// ============================================================
// ESTADO
// ============================================================
const ST = {
initialized: false,
splashHidden: false,
view: 'chat-list',        // chat-list | chat | ble
activeContact: null,
contacts: new Map(),
conversations: new Map(),
seenIds: new Set(),
blePlugin: null,
isScanning: false,
};
// ============================================================
// UTILS
// ============================================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
function gid() {
return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function hashMsg(sender, content, ts) {
let h = 0;
const str = (sender || '') + '|' + (content || '') + '|' + (ts || Date.now());
for (let i = 0; i < str.length; i++) {
h = ((h << 5) - h) + str.charCodeAt(i);
h |= 0;
}
return 'h' + Math.abs(h).toString(36);
}
function fmtTime(ts) {
const d = new Date(ts || Date.now());
return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function escHtml(t) {
const d = document.createElement('div');
d.textContent = t || '';
return d.innerHTML;
}
// ============================================================
// VISTAS
// ============================================================
function showView(name) {
ST.view = name;
$$('.view').forEach(v => v.classList.remove('active'));
const views = {
'chat-list': 'chat-list-view',
'chat': 'chat-view',
'ble': 'ble-view',
};
const el = document.getElementById(views[name]);
if (el) el.classList.add('active');
// Header dinámico
const title = $('#header-title');
const sub = $('#header-subtitle');
const action = $('#header-action');
if (name === 'chat-list') {
if (title) { title.textContent = 'NEXO'; title.style.textAlign = 'center'; }
if (sub) { sub.textContent = 'v10.0'; sub.style.display = 'block'; }
if (action) { action.style.display = 'flex'; action.innerHTML = '◉'; }
$('#scan-container').style.display = 'block';
} else if (name === 'chat') {
if (title) { title.textContent = ST.activeContact || 'Chat'; title.style.textAlign = 'left'; }
if (sub) { sub.style.display = 'none'; }
if (action) { action.style.display = 'none'; }
$('#scan-container').style.display = 'none';
} else if (name === 'ble') {
if (title) { title.textContent = 'BLE Mesh'; title.style.textAlign = 'center'; }
if (sub) { sub.style.display = 'none'; }
if (action) { action.style.display = 'none'; }
$('#scan-container').style.display = 'none';
}
}
// ============================================================
// SPLASH
// ============================================================
function hideSplash() {
const s = $('#splash-native');
if (!s || ST.splashHidden) return;
s.classList.add('hidden');
ST.splashHidden = true;
setTimeout(() => { s.style.display = 'none'; }, 500);
}
// ============================================================
// TOAST
// ============================================================
function toast(msg, type) {
const t = $('#toast');
if (!t) return;
t.textContent = msg;
t.className = 'toast ' + (type || '');
t.classList.add('show');
setTimeout(() => t.classList.remove('show'), 3000);
}
// ============================================================
// CHAT LIST
// ============================================================
function renderChatList() {
const container = $('#chat-list-container');
const empty = $('#chat-empty');
if (!container) return;
container.innerHTML = '';
const contacts = Array.from(ST.contacts.values());
if (contacts.length === 0) {
if (empty) empty.style.display = 'flex';
return;
}
if (empty) empty.style.display = 'none';
contacts.forEach(c => {
const key = c.name.toLowerCase();
const conv = ST.conversations.get(key) || [];
const lastMsg = conv[conv.length - 1];
const unread = conv.filter(m => !m.read).length;
const item = document.createElement('div');
item.className = 'chat-item';
item.dataset.name = c.name;
item.innerHTML = <div class="chat-avatar">${escHtml(c.name[0]?.toUpperCase() || '?')}</div> <div class="chat-info"> <div class="chat-name">${escHtml(c.name)}</div> <div class="chat-preview">${escHtml(lastMsg?.content || 'Sin mensajes')}</div> </div> <div class="chat-meta"> <div class="chat-time">${lastMsg ? fmtTime(lastMsg.timestamp) : ''}</div> ${unread > 0 ?<div class="chat-badge">${unread}</div>: ''} </div>;
item.addEventListener('click', () => openChat(c.name));
container.appendChild(item);
});
}
// ============================================================
// CHAT
// ============================================================
function openChat(name) {
ST.activeContact = name;
const key = name.toLowerCase();
// Marcar como leídos
const conv = ST.conversations.get(key) || [];
conv.forEach(m => m.read = true);
// Actualizar header
const hName = $('#chat-header-name');
const hStatus = $('#chat-header-status');
const hDot = $('#chat-status-dot');
if (hName) hName.textContent = name;
if (hStatus) hStatus.textContent = 'BLUETOOTH';
if (hDot) hDot.style.display = 'inline-block';
// Renderizar mensajes
renderMessages(name);
showView('chat');
}
function renderMessages(contactName) {
const container = $('#messages-container');
if (!container) return;
container.innerHTML = '';
const key = (contactName || '').toLowerCase();
const msgs = ST.conversations.get(key) || [];
msgs.forEach(m => {
const isOwn = m.own || m.sender === 'Tú';
const div = document.createElement('div');
div.className = 'msg ' + (isOwn ? 'sent' : 'rcvd');
div.innerHTML = ${escHtml(m.content)} <span class="msg-time">${fmtTime(m.timestamp)} ${isOwn ? '&#10003;' : ''}</span>;
container.appendChild(div);
});
scrollChat();
}
function scrollChat() {
const area = $('#messages-area');
if (area) area.scrollTop = area.scrollHeight;
}
function sendMessage() {
const input = $('#message-input');
const content = input?.value?.trim();
if (!content) return;
if (!ST.activeContact) {
toast('Selecciona un contacto primero', 'err');
return;
}
const msg = {
id: gid(),
content,
sender: 'Tú',
timestamp: Date.now(),
own: true,
read: true,
};
const key = ST.activeContact.toLowerCase();
if (!ST.conversations.has(key)) ST.conversations.set(key, []);
ST.conversations.get(key).push(msg);
renderMessages(ST.activeContact);
if (input) input.value = '';
// Enviar via BLE
try {
if (ST.blePlugin) {
ST.blePlugin.sendMessage({ content, recipient: ST.activeContact });
} else if (Capacitor?.Plugins?.NexoBLE) {
Capacitor.Plugins.NexoBLE.sendMessage({ content, recipient: ST.activeContact });
}
} catch (e) {
console.error('[NEXO] Send error:', e);
}
renderChatList();
}
function onMessageReceived(payload) {
const content = payload?.content || payload?.text || payload?.message || '';
const sender = payload?.sender || payload?.from || payload?.deviceName || 'Desconocido';
const ts = payload?.timestamp || Date.now();
const id = payload?.id || payload?.messageId || hashMsg(sender, content, ts);
if (ST.seenIds.has(id)) return;
ST.seenIds.add(id);
setTimeout(() => ST.seenIds.delete(id), CFG.DEDUP_TTL);
// Agregar contacto si es nuevo
const sKey = sender.toLowerCase();
if (!ST.contacts.has(sKey)) {
ST.contacts.set(sKey, { name: sender, deviceId: payload?.deviceId, mac: payload?.mac });
}
// Guardar mensaje
if (!ST.conversations.has(sKey)) ST.conversations.set(sKey, []);
ST.conversations.get(sKey).push({ id, content, sender, timestamp: ts, own: false });
// Renderizar si es chat activo
if (ST.view === 'chat' && ST.activeContact?.toLowerCase() === sKey) {
renderMessages(ST.activeContact);
} else {
toast(Nuevo mensaje de ${sender}, 'ok');
renderChatList();
}
}
// ============================================================
// BLE SCAN
// ============================================================
function toggleScan() {
if (ST.isScanning) {
stopScan();
} else {
startScan();
}
}
function startScan() {
ST.isScanning = true;
const btn = $('#scan-btn');
if (btn) {
btn.textContent = '...';
btn.classList.add('scanning');
}
toast('Escaneando dispositivos BLE...', 'ok');
// Limpiar lista
const list = $('#devices-list');
const empty = $('#devices-empty');
if (list) list.innerHTML = '';
if (empty) empty.style.display = 'none';
// Llamar plugin nativo
try {
if (Capacitor?.Plugins?.NexoBLE?.startScan) {
Capacitor.Plugins.NexoBLE.startScan();
}
} catch (e) {
console.warn('[NEXO] startScan:', e);
}
// Auto-stop después de 10s
setTimeout(stopScan, 10000);
}
// ============================================================
// BLE SCAN
// ============================================================
function toggleScan() {
if (ST.isScanning) {
stopScan();
} else {
startScan();
}
}
function startScan() {
ST.isScanning = true;
const btn = $('#scan-btn');
if (btn) {
btn.textContent = '...';
btn.classList.add('scanning');
}
toast('Escaneando dispositivos BLE...', 'ok');
// Limpiar lista
const list = $('#devices-list');
const empty = $('#devices-empty');
if (list) list.innerHTML = '';
if (empty) empty.style.display = 'none';
// Llamar plugin nativo
try {
if (Capacitor?.Plugins?.NexoBLE?.startScan) {
Capacitor.Plugins.NexoBLE.startScan();
}
} catch (e) {
console.warn('[NEXO] startScan:', e);
}
// Auto-stop después de 10s
setTimeout(stopScan, 10000);
}
function stopScan() {
ST.isScanning = false;
const btn = $('#scan-btn');
if (btn) {
btn.textContent = 'SCAN';
btn.classList.remove('scanning');
}
try {
if (Capacitor?.Plugins?.NexoBLE?.stopScan) {
Capacitor.Plugins.NexoBLE.stopScan();
}
} catch (e) {}
}
function onDeviceFound(device) {
const name = device?.name || device?.deviceName || 'Dispositivo';
const mac = device?.address || device?.mac || '';
const key = name.toLowerCase();
if (!ST.contacts.has(key)) {
ST.contacts.set(key, { name, mac, deviceId: device?.deviceId });
}
renderDeviceCard(name, mac, device);
renderChatList();
}
function renderDeviceCard(name, mac, device) {
const list = $('#devices-list');
if (!list) return;
const card = document.createElement('div');
card.className = 'device-card';
card.dataset.name = name;
card.innerHTML = <div class="device-info"> <div class="device-name">${escHtml(name)}</div> <div class="device-status">Disponible</div> ${mac ?<div class="device-mac">${escHtml(mac)}</div>: ''} </div> <div class="device-actions"> <button class="btn-sm btn-chat" data-name="${escHtml(name)}">Chat</button> <button class="btn-sm btn-del" data-name="${escHtml(name)}">&#10005;</button> </div>;
card.querySelector('.btn-chat').addEventListener('click', () => {
addContact(name, device);
openChat(name);
});
card.querySelector('.btn-del').addEventListener('click', () => {
card.remove();
});
list.appendChild(card);
}
function addContact(name, device) {
const key = name.toLowerCase();
if (ST.contacts.has(key)) return;
ST.contacts.set(key, {
name,
mac: device?.address || device?.mac,
deviceId: device?.deviceId,
});
renderChatList();
}
// ============================================================
// BLE INIT
// ============================================================
async function initBLE() {
try {
const plugin = Capacitor?.Plugins?.NexoBLE;
if (!plugin) {
console.warn('[NEXO] Plugin no disponible');
return;
}
ST.blePlugin = plugin;
const status = await plugin.checkBLEStatus?.();
console.log('[NEXO] BLE status:', status);
if (!status?.allGranted) {
await plugin.initializeBLE?.();
}
// Listeners nativos
if (plugin.addListener) {
plugin.addListener('onDeviceFound', (d) => onDeviceFound(d));
plugin.addListener('onPayloadReceived', (p) => onMessageReceived(p));
}
} catch (e) {
console.error('[NEXO] BLE init error:', e);
}
}
// ============================================================
// EVENTS
// ============================================================
function bindEvents() {
// Header BLE button -> abrir vista BLE
const bleBtn = $('#header-action');
if (bleBtn) {
bleBtn.addEventListener('click', () => {
showView('ble');
});
}
// Chat back button
const backBtn = $('#chat-back');
if (backBtn) {
backBtn.addEventListener('click', () => {
showView('chat-list');
});
}
// Scan button
const scanBtn = $('#scan-btn');
if (scanBtn) {
scanBtn.addEventListener('click', toggleScan);
}
// Send button
const sendBtn = $('#send-btn');
if (sendBtn) {
sendBtn.addEventListener('click', sendMessage);
}
// Enter key
const input = $('#message-input');
if (input) {
input.addEventListener('keypress', (e) => {
if (e.key === 'Enter') sendMessage();
});
}
}
// ============================================================
// BOOT
// ============================================================
async function boot() {
console.log([NEXO] Boot ${CFG.APP_NAME} v${CFG.VERSION});
bindEvents();
await initBLE();
renderChatList();
showView('chat-list');
setTimeout(hideSplash, CFG.SPLASH_MS);
// Safety timeout
setTimeout(() => {
if (!ST.splashHidden) hideSplash();
}, 8000);
}
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', boot);
} else {
boot();
}
// Exports
window.NEXO = {
sendMessage,
openChat,
showView,
toast,
ST,
};
