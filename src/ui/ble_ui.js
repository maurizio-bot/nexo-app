/**
 * BLE UI — DOM, Render, Event Listeners, Panel
 * v5.2.1-split-ui
 * Importa: ble_native.js
   */
   import { BLEInterface } from './ble_native.js';
Object.assign(BLEInterface.prototype, {
createDOM() {
var self = this;
var panel = document.createElement('div');
panel.id = 'ble-panel';
panel.innerHTML =
'<div class="ble-header" style="position:relative;display:flex;align-items:center;justify-content:center;padding:10px 20px 14px;">' +
'<button id="ble-panel-back" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,200,255,0.3);transition:transform 0.15s ease;z-index:2;">' +
'<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" transform="scale(-1,1) translate(-24,0)"/></svg>' +
'</button>' +
'<div style="text-align:center;">' +
'<div class="contacts-title">Agregar contactos</div>' +
'</div>' +
'</div>' +
'<div class="ble-search-bar">' +
'<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>' +
'<span>Buscar contacto...</span>' +
'</div>' +
'<div class="ble-section-label">En linea ahora</div>' +
'<div id="ble-online-strip" class="ble-online-strip"></div>' +
'<div class="ble-section-label">Recientes</div>' +
'<div id="ble-contacts-list" class="ble-contacts-list">' +
'<div class="ble-empty">No hay contactos. Presiona Buscar para encontrar dispositivos.</div>' +
'</div>' +
'<div class="ble-bottom-bar">' +
'<div id="ble-new-device" class="ble-new-device" style="display:none">' +
'<span id="ble-new-device-name"></span>' +
'<button id="ble-add-btn" class="ble-btn-add-small">+</button>' +
'</div>' +
'<button id="ble-scan-btn" class="ble-btn-scan-round"></button>' +
'</div>' +
'<div id="ble-status-bar" class="ble-status-bar"><span id="ble-status-text"></span></div>';
document.body.appendChild(panel);
this.elements.panel = panel;
var overlay = document.createElement('div');
overlay.id = 'ble-overlay';
document.body.appendChild(overlay);
this.elements.overlay = overlay;
var bottomNav = document.createElement('div');
bottomNav.id = 'ble-bottom-nav';
bottomNav.className = 'ble-bottom-nav';
bottomNav.innerHTML =
'<div class="ble-nav-item active" data-tab="chats">' +
'<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
'<span>Chats</span>' +
'</div>' +
'<div class="ble-nav-item" data-tab="people">' +
'<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>' +
'<span>Gente</span>' +
'</div>' +
'<div class="ble-nav-item" data-tab="map">' +
'<svg viewBox="0 0 24 24"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>' +
'<span>Mapa</span>' +
'</div>' +
'<div class="ble-nav-item" data-tab="profile">' +
'<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>' +
'<span>Perfil</span>' +
'</div>';
document.body.appendChild(bottomNav);
this.elements.bottomNav = bottomNav;
this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
this.elements.scanBtn = document.getElementById('ble-scan-btn');
this.elements.contactsList = document.getElementById('ble-contacts-list');
this.elements.onlineStrip = document.getElementById('ble-online-strip');
this.elements.newDeviceBar = document.getElementById('ble-new-device');
this.elements.newDeviceName = document.getElementById('ble-new-device-name');
this.elements.addBtn = document.getElementById('ble-add-btn');
this.elements.statusBar = document.getElementById('ble-status-bar');
this.elements.statusText = document.getElementById('ble-status-text');
this.elements.mainContactsList = document.getElementById('main-contacts-list');
this.elements.mainOnlineStrip = document.getElementById('main-contacts-online-strip');
this.elements.mainEmptyMsg = document.getElementById('main-contacts-empty-msg');
var fabBtn = document.createElement('button');
fabBtn.id = 'ble-fab-btn';
fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
fabBtn.style.cssText = 'position:fixed;bottom:80px;right:16px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483643;box-shadow:0 4px 15px rgba(0,200,255,0.3);transition:transform 0.15s ease;';
fabBtn.addEventListener('click', function() { self.togglePanel(); });
fabBtn.addEventListener('mousedown', function() { this.style.transform = 'scale(0.92)'; });
fabBtn.addEventListener('mouseup', function() { this.style.transform = 'scale(1)'; });
fabBtn.addEventListener('touchstart', function() { this.style.transform = 'scale(0.92)'; });
fabBtn.addEventListener('touchend', function() { this.style.transform = 'scale(1)'; });
document.body.appendChild(fabBtn);
this.elements.fabBtn = fabBtn;
},
setupEventListeners() {
var self = this;
this.elements.overlay.addEventListener('click', function() { self.togglePanel(); });
this.elements.scanBtn.addEventListener('click', function() { self.toggleScan(); });
this.elements.addBtn.addEventListener('click', function() { self._addNewDevice(); });
var backBtn = document.getElementById('ble-panel-back');
if (backBtn) {
backBtn.addEventListener('click', function() {
self.elements.panel.classList.remove('active');
self.elements.overlay.classList.remove('active');
});
}
var navItems = this.elements.bottomNav.querySelectorAll('.ble-nav-item');
navItems.forEach(function(item) {
item.addEventListener('click', function() {
navItems.forEach(function(n) { n.classList.remove('active'); });
item.classList.add('active');
var tab = item.dataset.tab;
if (tab === 'people') self.togglePanel();
else if (tab === 'chats') {
self.elements.panel.classList.remove('active');
self.elements.overlay.classList.remove('active');
}
});
});
window.addEventListener('nexo:ble:closeChat', function() {
self._activeChatDeviceId = null; self._activeChatDeviceIdNative = null;
self.updateBadge();
if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'flex';
if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'flex';
self.renderContactsList(); self.renderOnlineStrip();
self._scheduleScanFallback();
});
window.addEventListener('nexo:ble:openChat', function() {
if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'none';
if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'none';
self._cancelScanFallback();
});
},
togglePanel() {
this.elements.panel.classList.toggle('active');
this.elements.overlay.classList.toggle('active');
if (this.elements.panel.classList.contains('active')) {
this.newDevicesCount = 0; this.updateBadge(); this.renderContactsList(); this.renderOnlineStrip();
this.triggerScanByAction();
}
},
renderOnlineStrip() {
var self = this;
var strip = this.elements.mainOnlineStrip;
if (!strip) return;
strip.innerHTML = '';
var contacts = _getBLEContacts();
var onlineContacts = contacts.filter(function(c) { return c.online && (Date.now() - (c.lastSeen || 0)) < 60000; });
if (onlineContacts.length === 0) { strip.style.display = 'none'; return; }
strip.style.display = 'flex';
onlineContacts.forEach(function(contact) {
var uuid = _normId(contact.deviceUUID);
var item = document.createElement('div');
item.className = 'ble-online-item';
var initials = _getInitials(contact.name);
var gradClass = _getGradientForUUID(uuid);
item.innerHTML = '<div class="ble-online-avatar ' + gradClass + '">' + initials + '<div class="ble-online-dot"></div></div><span class="ble-online-name">' + (contact.name || '') + '</span>';
item.addEventListener('click', function() { self.openChat(uuid); });
strip.appendChild(item);
});
},
renderContactsList() {
var self = this;
var list = this.elements.mainContactsList;
if (!list) return;
list.innerHTML = '';
var contacts = _getBLEContacts();
var seenNexoIds = {};
var deduped = [];
contacts.forEach(function(c) {
var nid = _normId(c.deviceUUID);
if (!nid) return;
if (!seenNexoIds[nid]) {
seenNexoIds[nid] = true;
deduped.push(c);
} else {
var existing = deduped.find(function(d) { return _normId(d.deviceUUID) === nid; });
if (existing && (c.lastSeen || 0) > (existing.lastSeen || 0)) {
existing.name = c.name || existing.name;
existing.lastSeen = c.lastSeen;
existing.online = c.online;
existing.lastMessage = c.lastMessage || existing.lastMessage;
existing.unreadCount = Math.max(existing.unreadCount || 0, c.unreadCount || 0);
existing.deviceId = c.deviceId || existing.deviceId;
}
}
});
contacts = deduped;
if (contacts.length === 0) {
list.innerHTML = '';
if (this.elements.mainEmptyMsg) this.elements.mainEmptyMsg.classList.add('visible');
this.renderOnlineStrip();
return;
}
if (this.elements.mainEmptyMsg) this.elements.mainEmptyMsg.classList.remove('visible');
var pinned = _getPinnedContacts();
contacts.sort(function(a, b) {
var aPinned = pinned.indexOf(_normId(a.deviceUUID)) >= 0 ? 1 : 0;
var bPinned = pinned.indexOf(_normId(b.deviceUUID)) >= 0 ? 1 : 0;
if (aPinned !== bPinned) return bPinned - aPinned;
return (b.lastSeen || 0) - (a.lastSeen || 0);
});
contacts.forEach(function(contact, index) {
var uuid = _normId(contact.deviceUUID);
var isOnline = contact.online && (Date.now() - (contact.lastSeen || 0)) < 60000;
var initials = _getInitials(contact.name);
var gradClass = _getGradientForUUID(uuid);
var lastMsg = contact.lastMessage || (isOnline ? 'En linea' : 'Offline');
var timeStr = _formatTime(contact.lastSeen);
var unread = contact.unreadCount || 0;
var row = document.createElement('div');
row.className = 'ble-contact-row';
row.addEventListener('click', function(e) { if (e.target.closest('.ble-contact-menu') || e.target.closest('.ble-btn-menu')) return; self.openChat(uuid); });
var avatar = document.createElement('div');
avatar.className = 'ble-contact-avatar ' + gradClass;
avatar.textContent = initials;
row.appendChild(avatar);
var info = document.createElement('div');
info.className = 'ble-contact-info';
info.innerHTML = '<div class="ble-contact-name">' + (contact.name || '') + '</div><div class="ble-contact-msg">' + lastMsg + '</div>';
row.appendChild(info);
var meta = document.createElement('div');
meta.className = 'ble-contact-meta';
var metaHtml = '<span class="ble-contact-time">' + timeStr + '</span>';
if (unread > 0) metaHtml += '<div class="ble-unread-badge">' + unread + '</div>';
meta.innerHTML = metaHtml;
row.appendChild(meta);
var menuBtn = document.createElement('button');
menuBtn.className = 'ble-btn-menu';
menuBtn.innerHTML = '⋮';
menuBtn.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;flex-shrink:0;margin-left:8px;';
menuBtn.addEventListener('click', function(e) { e.stopPropagation(); self._toggleContactMenu(uuid, menuBtn); });
row.appendChild(menuBtn);
list.appendChild(row);
if (index < contacts.length - 1) { var divider = document.createElement('div'); divider.className = 'ble-divider'; list.appendChild(divider); }
});
this.renderOnlineStrip();
},
_toggleContactMenu(uuid, btn) {
var self = this;
var existing = document.querySelector('.ble-contact-menu');
if (existing) { existing.remove(); return; }
var menu = document.createElement('div');
menu.className = 'ble-contact-menu';
var isPinned = _isPinned(uuid);
menu.innerHTML = '<div class="ble-menu-item" data-action="pin">' + (isPinned ? '☆ Desfijar' : '★ Fijar') + '</div><div class="ble-menu-item" data-action="profile">👤 Perfil</div><div class="ble-menu-item ble-menu-delete" data-action="delete">🗑 Eliminar</div>';
var rect = btn.getBoundingClientRect();
menu.style.top = (rect.bottom + 4) + 'px';
menu.style.right = (window.innerWidth - rect.right) + 'px';
document.body.appendChild(menu);
menu.addEventListener('click', function(e) {
var action = e.target.dataset.action;
if (action === 'pin') { _togglePinnedContact(uuid); self.renderContactsList(); }
else if (action === 'delete') { self.removeContact(uuid); }
else if (action === 'profile') { _safeDispatchEvent('nexo:ble:goToProfile', { deviceUUID: uuid }); }
menu.remove();
});
setTimeout(function() {
document.addEventListener('click', function closeMenu(e) {
if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } });
}, 10);
},
renderNewDeviceBar() {
var bar = this.elements.newDeviceBar;
var nameSpan = this.elements.newDeviceName;
var newDevice = null, newDeviceId = null;
this.foundDevices.forEach(function(device, deviceId) {
var uuid = device.deviceUUID;
if (!uuid || !_isBLEContact(uuid)) { newDevice = device; newDeviceId = deviceId; }
});
if (newDevice && newDeviceId) {
var displayName = newDevice.deviceUUID || 'Nexo Device';
nameSpan.textContent = displayName;
bar.style.display = 'flex';
bar.dataset.deviceId = newDeviceId;
}
else { bar.style.display = 'none'; bar.dataset.deviceId = ''; }
},
_addNewDevice() {
var self = this;
var bar = this.elements.newDeviceBar;
var deviceId = bar.dataset.deviceId || '';
var device = this.foundDevices.get(deviceId);
if (!device) return;
var name = device.deviceUUID || 'Nexo Device';
var nexoId = device.deviceUUID || '';
if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
console.warn('[BLEInterface] No se puede agregar: dispositivo sin NEXO ID');
return;
}
_addBLEContact({ deviceUUID: nexoId, name: name, deviceId: deviceId });
this._autoConnectGATT(deviceId, device);
this.foundDevices.delete(deviceId);
this._closePanelAndRefresh();
},
_closePanelAndRefresh() {
this.elements.panel.classList.remove('active');
this.elements.overlay.classList.remove('active');
this.renderContactsList();
this.renderOnlineStrip();
this.renderNewDeviceBar();
},
openChat(deviceUUID) {
var self = this;
return new Promise(function(resolve, reject) {
try {
var uuid = _normId(deviceUUID);
if (!uuid) { reject(new Error('ID invalido')); return; }
var contact = _getContactByUUID(uuid);
var deviceId = contact ? contact.deviceId : null;
if (!deviceId && contact) {
self.foundDevices.forEach(function(d) { if (!deviceId && _normId(d.deviceUUID) === uuid) deviceId = d.id; });
self.connectedDevices.forEach(function(d) { if (!deviceId && _normId(d.deviceUUID) === uuid) deviceId = d.id; });
}
var displayName = (contact && contact.name) || '';
if (!deviceId) { reject(new Error('Dispositivo no conectado')); return; }
self._activeChatDeviceId = uuid; self._activeChatDeviceIdNative = deviceId;
self.newDevicesCount = 0; self.updateBadge();
if (contact) {
contact.unreadCount = 0; var contacts = _getBLEContacts();
var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === uuid; });
if (idx >= 0) { contacts[idx].unreadCount = 0; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
}
var state = self._getDeviceState(deviceId);
var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
function finishOpenChat() {
var appContainer = document.getElementById('app');
if (appContainer) appContainer.classList.remove('hidden');
var nameInput = document.getElementById('chat-contact-name');
var subtitle = document.getElementById('chat-contact-subtitle');
if (nameInput) nameInput.value = displayName;
if (subtitle) subtitle.textContent = '';
_safeDispatchEvent('nexo:ble:openChat', { contactId: uuid, name: displayName, deviceId: deviceId, transport: 'ble', source: 'ble_interface' });
self.elements.panel.classList.remove('active'); self.elements.overlay.classList.remove('active');
}
finishOpenChat();
resolve();
if (!isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
if (!isConnecting) {
_safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId }).catch(function(e) {});
}
}
} catch (fatalErr) { console.error('[BLEInterface] FATAL openChat:', fatalErr); reject(fatalErr); }
});
},
removeContact(deviceUUID) {
try { _removeBLEContact(deviceUUID); this.renderContactsList(); this.renderNewDeviceBar(); this.renderOnlineStrip(); } catch (e) {}
},
updateBadge() {
var fabBtn = this.elements.fabBtn;
if (!fabBtn) return;
if (this._activeChatDeviceId) { fabBtn.style.display = 'none'; return; }
fabBtn.style.display = 'flex';
if (this.newDevicesCount > 0) { fabBtn.innerHTML = '<span style="color:#fff;font-size:14px;font-weight:700;">' + this.newDevicesCount + '</span>'; }
else { fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>'; }
},
getContacts() {
return _getBLEContacts();
},
getContactByUUID(deviceUUID) {
return _getContactByUUID(deviceUUID);
},
destroy() {
var self = this;
try {
if (self._cleanupSeenMsgsTimer) { clearInterval(self._cleanupSeenMsgsTimer); self._cleanupSeenMsgsTimer = null; }
if (self._scanFallbackTimer) { clearTimeout(self._scanFallbackTimer); self._scanFallbackTimer = null; }
if (self._heartbeatTimers) {
self._heartbeatTimers.forEach(function(rec, deviceId) {
if (rec && rec.intervalId) clearInterval(rec.intervalId);
});
self._heartbeatTimers.clear();
}
if (self._notificationFallbackTimers) {
self._notificationFallbackTimers.forEach(function(t) { clearTimeout(t); });
self._notificationFallbackTimers.clear();
}
if (self._readyResolvers) {
self._readyResolvers.forEach(function(r) { if (r.timer) clearTimeout(r.timer); });
self._readyResolvers.clear();
}
if (self._pendingACKs) {
self._pendingACKs.forEach(function(p) { if (p.timer) clearTimeout(p.timer); });
self._pendingACKs.clear();
}
if (self._nativeDeviceFoundListener) { try { self._nativeDeviceFoundListener.remove(); } catch(e) {} }
if (self._nativeScanFailedListener) { try { self._nativeScanFailedListener.remove(); } catch(e) {} }
if (self._nativeServerReadyListener) { try { self._nativeServerReadyListener.remove(); } catch(e) {} }
if (self._nativeDeviceConnectedListener) { try { self._nativeDeviceConnectedListener.remove(); } catch(e) {} }
if (self._nativeDeviceDisconnectedListener) { try { self._nativeDeviceDisconnectedListener.remove(); } catch(e) {} }
if (self._nativeServicesReadyListener) { try { self._nativeServicesReadyListener.remove(); } catch(e) {} }
if (self._nativeNotificationsListener) { try { self._nativeNotificationsListener.remove(); } catch(e) {} }
if (self._nativeConnectionFailedListener) { try { self._nativeConnectionFailedListener.remove(); } catch(e) {} }
if (self._nativeAdStartedListener) { try { self._nativeAdStartedListener.remove(); } catch(e) {} }
if (self._nativeAdFailedListener) { try { self._nativeAdFailedListener.remove(); } catch(e) {} }
if (self._nativePayloadListener) { try { self._nativePayloadListener.remove(); } catch(e) {} }
if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
_safeNativeCall(self.nativePlugin, 'stopScan', {}).catch(function(e) {});
}
if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'stopAdvertising')) {
_safeNativeCall(self.nativePlugin, 'stopAdvertising', {}).catch(function(e) {});
}
self.isScanning = false;
self.isAdvertising = false;
self.connectedDevices.clear();
self.foundDevices.clear();
self._deviceStates.clear();
self._pendingMessageQueue.clear();
self._seenMsgs.clear();
self._receivedMessageIds.clear();
console.log('[BLEInterface] destroy() completado');
} catch (e) { console.warn('[BLEInterface] destroy error:', e); }
}
});
export function initBLEInterface(bleMesh) {
var instance = new BLEInterface(bleMesh).init();
window.bleInterface = instance;
return instance;
}
