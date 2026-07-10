/**
 * BLE Native — Scan, Conexión, Advertising, Listeners nativos
 * v5.2.2-split-native  (FIXED: import from ble_base.js, not ble_protocol.js)
   */
   import { BLEInterface } from './ble_base.js';
Object.assign(BLEInterface.prototype, {
_loadContactsAndInit() {
var self = this;
_loadContactsFromVault().then(function(contacts) {
if (contacts && contacts.length > 0) {
try { localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts)); } catch (e) {}
}
self._continueInit();
}).catch(function() { self._continueInit(); });
},
_continueInit() {
if (this.isDummyMode) {
this.updateStatus('OFFLINE (Dummy)');
} else {
this.updateStatus();
this._setupNativeScanListeners();
this._setupNativeConnectionListeners();
this._setupNativePayloadListener();
this._setupNativeStateListeners();
this._setupNativeServerReadyListener();
this._loadLocalDeviceInfo();
this._initVisibility();
this._initNexoId();
this._autoStartAdvertising();
}
this._setupAppStateListener();
this.elements.panel.classList.remove('active');
this.elements.overlay.classList.remove('active');
this.renderContactsList();
this.renderOnlineStrip();
var self = this;
setTimeout(function() {
if (!self.isDummyMode && self.nativePlugin) {
self._autoScanForKnownContacts();
}
}, 2000);
},
_initNexoId() {
var self = this;
_getOrCreateNexoId().then(function(nexoId) {
self.localNexoId = nexoId;
console.log('[BLEInterface] NEXO ID:', nexoId);
if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'setAdvertisingData')) {
_safeNativeCall(self.nativePlugin, 'setAdvertisingData', { nexoId: nexoId }).catch(function(e) {});
}
});
},
_setupAppStateListener() {
var self = this;
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
var appPlugin = window.Capacitor.Plugins.App;
if (_hasNativeMethod(appPlugin, 'addListener')) {
appPlugin.addListener('appStateChange', function(state) {
try {
if (state && state.isActive === true) {
_loadContactsFromVault().then(function(contacts) {
if (contacts && contacts.length > 0) {
try { localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts)); } catch (e) {}
self.renderContactsList(); self.renderOnlineStrip();
}
}).catch(function() {});
if (!self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
_safeNativeCall(self.nativePlugin, 'startAdvertising', {})
.then(function() { self.isAdvertising = true; self.updateVisibilityButton(); })
.catch(function(e) {});
}
}
} catch (e) {}
});
}
}
},
_autoStartAdvertising() {
var self = this;
if (self.isDummyMode || !self.nativePlugin) return Promise.resolve();
if (!_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) return Promise.resolve();
return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
.then(function(btState) {
var canAdv = btState && btState.canAdvertise;
var serverReady = btState && btState.serverReady;
if ((canAdv || serverReady) && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
return _safeNativeCall(self.nativePlugin, 'startAdvertising', {})
.then(function() { self.isAdvertising = true; self.canAdvertise = true; self.updateVisibilityButton(); })
.catch(function(e) {});
}
})
.catch(function(e) {});
},
_loadLocalDeviceInfo() {
var self = this;
if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'getLocalDeviceInfo')) return Promise.resolve();
return _safeNativeCall(self.nativePlugin, 'getLocalDeviceInfo', {})
.then(function(info) {
self.localDeviceName = (info && info.deviceName) || '';
})
.catch(function() {});
},
_setupNativeScanListeners() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
var self = this;
this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) {
try {
var deviceId = data.deviceId || '';
var name = data.name || '';
var nexoId = data.nexoId || '';
if (!deviceId) return;
self.onDeviceFound({ id: deviceId, name: name, rssi: data.rssi, nexoId: nexoId });
} catch (e) {}
});
this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
try { self.isScanning = false; self.updateScanButton(); } catch (e) {}
});
},
_setupNativeServerReadyListener() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
var self = this;
this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
try { console.log('[BLEInterface] onServerReady:', data); } catch (e) {}
});
},
_setupNativeConnectionListeners() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
var self = this;
this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
try {
var deviceId = data.deviceId || '';
if (!deviceId) return;
var peerUUID = null;
var contact = _getContactByDeviceId(deviceId);
if (contact) peerUUID = contact.deviceUUID;
var displayName = data.name || (contact ? contact.name : null) || '';
self.connectedDevices.set(deviceId, {
id: deviceId, name: displayName,
direction: data.direction || 'outgoing', role: data.role || 'client',
servicesReady: data.servicesReady || false, deviceUUID: peerUUID
});
self._setDeviceState(deviceId, data.role === 'server' ? BLE_STATES.READY_TO_CHAT : BLE_STATES.CONNECTING, {
direction: data.direction, role: data.role, deviceUUID: peerUUID
});
if (peerUUID) {
var contacts = _getBLEContacts();
var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(peerUUID); });
if (idx >= 0) {
contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); contacts[idx].deviceId = deviceId;
_saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip();
}
}
self._startHeartbeat(deviceId);
_safeDispatchEvent('nexo:ble:deviceConnected', { deviceId: deviceId, deviceUUID: peerUUID, name: displayName });
} catch (e) {}
});
this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
try {
var deviceId = data.deviceId || '';
if (!deviceId) return;
var peerUUID = null;
var contact = _getContactByDeviceId(deviceId);
if (contact) peerUUID = contact.deviceUUID;
self.connectedDevices.delete(deviceId);
self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
self._stopHeartbeat(deviceId);
if (peerUUID) {
var contacts = _getBLEContacts();
var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(peerUUID); });
if (idx >= 0) { contacts[idx].online = false; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
}
_safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: peerUUID });
if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
_safeNativeCall(self.nativePlugin, 'startAdvertising', {}).catch(function(e) {});
}
} catch (e) {}
});
},
_setupNativeStateListeners() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
var self = this;
this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', function(data) {
try {
var deviceId = data.deviceId || '';
if (!deviceId) return;
self._setDeviceState(deviceId, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
var device = self.connectedDevices.get(deviceId);
if (device) { device.servicesReady = true; self.connectedDevices.set(deviceId, device); }
var fallbackTimer = setTimeout(function() {
var st = self._getDeviceState(deviceId);
if (st.state === BLE_STATES.DISCOVERING_SERVICES) {
self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT);
self._resolveReadyToChat(deviceId);
}
}, 3000);
self._notificationFallbackTimers.set(deviceId, fallbackTimer);
} catch (e) {}
});
this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
try {
var deviceId = data.deviceId || '';
if (!deviceId) return;
var ft = self._notificationFallbackTimers.get(deviceId);
if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(deviceId); }
var peerUUID = null;
var contact = _getContactByDeviceId(deviceId);
if (contact) peerUUID = contact.deviceUUID;
self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: peerUUID });
self._resolveReadyToChat(deviceId);
self._processPendingMessages(deviceId);
} catch (e) {}
});
this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
try {
var deviceId = data.deviceId || '';
if (!deviceId) return;
var ft = self._notificationFallbackTimers.get(deviceId);
if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(deviceId); }
self._setDeviceState(deviceId, BLE_STATES.ERROR, { lastError: data.reason });
self._stopHeartbeat(deviceId);
} catch (e) {}
});
},
_setDeviceState(deviceId, state, meta) {
meta = meta || {};
if (!deviceId) return;
var stateObj = Object.assign({}, meta, { state: state, timestamp: Date.now() });
this._deviceStates.set(deviceId, stateObj);
},
_getDeviceState(deviceId) {
if (!deviceId) return { state: BLE_STATES.DISCONNECTED };
return this._deviceStates.get(deviceId) || { state: BLE_STATES.DISCONNECTED };
},
_initVisibility() {
var self = this;
if (self.isDummyMode) return Promise.resolve();
if (_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
.then(function(btState) {
self.canAdvertise = (btState && btState.canAdvertise) || false;
if (_hasNativeMethod(self.nativePlugin, 'isAdvertising')) {
return _safeNativeCall(self.nativePlugin, 'isAdvertising', {}).then(function(adState) {
self.isAdvertising = adState && adState.isAdvertising === true; self.updateVisibilityButton(); self._setupNativeAdvertisingListeners();
});
} else { self.updateVisibilityButton(); self._setupNativeAdvertisingListeners(); }
})
.catch(function(err) { console.error('[BLEInterface] Error consultando estado:', err); });
}
return Promise.resolve();
},
_setupNativeAdvertisingListeners() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
var self = this;
this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', function() {});
this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function() {});
},
updateVisibilityButton() {
var btn = this.elements.visibilityBtn;
if (!btn) return;
if (this.isAdvertising) btn.classList.add('active'); else btn.classList.remove('active');
},
updateScanButton() {
var btn = this.elements.scanBtn;
if (!btn) return;
if (this.isScanning) btn.classList.add('scanning'); else btn.classList.remove('scanning');
},
toggleVisibility() {
var self = this;
if (self.isDummyMode) return Promise.resolve();
var permsReady = false;
if (window.ensureBLEPermissions) {
return window.ensureBLEPermissions().then(function(result) { permsReady = result; }).catch(function() { permsReady = true; }).then(function() {
if (!permsReady) return Promise.resolve();
if (!self.nativePlugin) return Promise.resolve();
var promise;
if (self.isAdvertising) {
if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {}); else promise = Promise.resolve();
if (promise) return promise.then(function() { self.isAdvertising = false; self.updateVisibilityButton(); });
self.isAdvertising = false;
} else {
if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {}); else promise = Promise.resolve();
if (promise) return promise.then(function() { self.isAdvertising = true; self.updateVisibilityButton(); });
self.isAdvertising = true;
}
self.updateVisibilityButton(); return Promise.resolve();
}).catch(function(err) {});
} else { permsReady = true; }
if (!permsReady) return Promise.resolve();
if (!self.nativePlugin) return Promise.resolve();
var promise;
if (self.isAdvertising) {
if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {});
if (promise) return promise.then(function() { self.isAdvertising = false; self.updateVisibilityButton(); });
self.isAdvertising = false;
} else {
if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {});
if (promise) return promise.then(function() { self.isAdvertising = true; self.updateVisibilityButton(); });
self.isAdvertising = true;
}
self.updateVisibilityButton(); return Promise.resolve();
},
_autoScanForKnownContacts() {
var self = this;
if (self.isScanning) return;
if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'startScan')) return;
var contacts = _getBLEContacts();
if (contacts.length === 0) return;
console.log('[BLEInterface] Auto-scan iniciado para ' + contacts.length + ' contactos conocidos');
self.foundDevices.clear();
_safeNativeCall(self.nativePlugin, 'startScan', {})
.then(function() {
self.isScanning = true;
self.updateScanButton();
setTimeout(function() {
if (self.isScanning && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
_safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() {
self.isScanning = false;
self.updateScanButton();
console.log('[BLEInterface] Auto-scan completado');
}).catch(function() {
self.isScanning = false;
self.updateScanButton();
});
}
}, 6000);
})
.catch(function(e) {
console.warn('[BLEInterface] Auto-scan fallo:', e.message);
});
},
_scheduleScanFallback() {
var self = this;
self._cancelScanFallback();
self._scanFallbackTimer = setTimeout(function() {
if (!self.isScanning && !self._activeChatDeviceId) {
self._autoScanForKnownContacts();
}
}, 6000);
},
_cancelScanFallback() {
if (this._scanFallbackTimer) { clearTimeout(this._scanFallbackTimer); this._scanFallbackTimer = null; }
},
triggerScanByAction() {
this._scanActionPending = true;
this._autoScanForKnownContacts();
this._scanActionPending = false;
},
_executeToggleScan() {
var self = this;
if (self.isScanning) {
if (_hasNativeMethod(self.nativePlugin, 'stopScan')) {
return _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() { self.isScanning = false; self.updateScanButton(); self.updateStatus(); });
}
self.isScanning = false; self.updateScanButton(); self.updateStatus(); return Promise.resolve();
} else {
self.foundDevices.clear(); self.renderContactsList(); self.renderNewDeviceBar(); self.renderOnlineStrip();
if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
return _safeNativeCall(self.nativePlugin, 'startScan', {}).then(function() { self.isScanning = true; self.updateScanButton(); });
}
self.isScanning = true; self.updateScanButton(); return Promise.resolve();
}
},
_doToggleScan() {
var self = this;
var permsReady = false;
if (window.ensureBLEPermissions) {
return window.ensureBLEPermissions().then(function(result) { permsReady = result; }).catch(function() { permsReady = true; }).then(function() {
if (!permsReady) return Promise.resolve();
return self._executeToggleScan();
}).catch(function(err) { self.isScanning = false; self.updateScanButton(); });
} else { permsReady = true; }
if (!permsReady) return Promise.resolve();
return self._executeToggleScan();
},
toggleScan() {
var self = this;
if (self.isDummyMode) return Promise.resolve();
if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
.then(function(btState) {
if (!btState || !btState.enabled) {
_showToast('Bluetooth apagado. Actívalo para buscar contactos.', 'warn');
self.updateStatusBar('BLE OFF — Activa Bluetooth');
return Promise.resolve();
}
return self._doToggleScan();
})
.catch(function() { return self._doToggleScan(); });
}
return self._doToggleScan();
},
onDeviceFound(device) {
var deviceId = device.id || '';
if (!deviceId) return;
var nexoId = device.nexoId || '';
if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
return;
}
if (_isBLEContact(nexoId)) {
var contacts = _getBLEContacts();
var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(nexoId); });
if (idx >= 0) {
contacts[idx].online = true;
contacts[idx].lastSeen = Date.now();
contacts[idx].deviceId = deviceId;
_saveBLEContacts(contacts);
}
this._autoConnectGATT(deviceId, device);
this.renderContactsList();
this.renderOnlineStrip();
return;
}
if (!this.foundDevices.has(deviceId)) {
device.lastSeen = Date.now();
device.deviceUUID = nexoId;
this.foundDevices.set(deviceId, device);
this.newDevicesCount++;
this.updateBadge();
this.renderNewDeviceBar();
} else {
var existing = this.foundDevices.get(deviceId);
existing.rssi = device.rssi;
existing.lastSeen = Date.now();
existing.deviceUUID = nexoId;
this.foundDevices.set(deviceId, existing);
this.renderNewDeviceBar();
}
if (_isBLEContact(nexoId)) {
var contacts = _getBLEContacts();
var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(nexoId); });
if (idx >= 0) {
contacts[idx].online = true;
contacts[idx].lastSeen = Date.now();
contacts[idx].deviceId = deviceId;
_saveBLEContacts(contacts);
this.renderContactsList();
this.renderOnlineStrip();
var state = this._getDeviceState(deviceId);
if (state.state === BLE_STATES.DISCONNECTED) {
console.log('[BLEInterface] Auto-reconnect a contacto conocido:', nexoId);
this._autoConnectGATT(deviceId, device);
}
}
}
},
_autoConnectGATT(deviceId, device) {
var self = this;
if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
if (!deviceId) return Promise.resolve();
var state = self._getDeviceState(deviceId);
if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) return Promise.resolve();
self._setDeviceState(deviceId, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
self.connectedDevices.set(deviceId, { id: deviceId, name: (device && device.name) || '', direction: 'outgoing', servicesReady: false, deviceUUID: device && device.deviceUUID });
return _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId })
.then(function(result) {
if (result && (result.connected || result.alreadyConnected)) {
return self._waitForReadyToChat(deviceId, 8000).then(function() {});
} else {
self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
}
})
.catch(function(e) { self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED); });
},
disconnect(deviceId) {
var self = this;
if (self.isDummyMode) return Promise.resolve();
if (!deviceId) return Promise.resolve();
self._stopHeartbeat(deviceId);
if (_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
return _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
.then(function() {
if (self._activeChatDeviceId) {
self._activeChatDeviceId = null; self._activeChatDeviceIdNative = null;
self.updateBadge();
}
}).catch(function(err) {});
}
return Promise.resolve();
},
updateStatusBar(text) {
if (this.elements.statusText) this.elements.statusText.textContent = text || '';
},
updateStatus(customStatus) {
var self = this;
if (customStatus) { self.updateStatusBar(customStatus); return Promise.resolve(); }
if (self.isDummyMode) { self.updateStatusBar('OFFLINE (Dummy)'); return Promise.resolve(); }
if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
.then(function(state) {
if (state && state.enabled) { var connCount = self.connectedDevices ? self.connectedDevices.size : 0; self.updateStatusBar('BLE ON | ' + connCount + ' conectados'); }
else { self.updateStatusBar('BLE OFF'); }
}).catch(function(err) { self.updateStatusBar(''); });
}
self.updateStatusBar('');
return Promise.resolve();
}
});
export { BLEInterface };
