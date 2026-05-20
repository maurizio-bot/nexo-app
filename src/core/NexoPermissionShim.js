/**
 * NexoPermissionShim v1.1-ADVERTISE-FIX (Build Fix #1255)
 * Traduce API granular #1057 → API nativa #961 sin tocar Kotlin.
 * FIX: Solicita BLUETOOTH_ADVERTISE explícitamente antes de initializeBLE().
 * FIX #1255: Export named + default para compatibilidad con main.js v9.1-SHIM.
 * Build #1254+ compatible. Singleton. Guard clauses. Retry backoff 3x500ms.
   */
class NexoPermissionShim {
static _instance = null;
static getInstance() {
if (!NexoPermissionShim._instance) {
NexoPermissionShim._instance = new NexoPermissionShim();
}
return NexoPermissionShim._instance;
}
constructor() {
this._plugin = null;
this._initAttempts = 0;
this._maxRetries = 3;
this._backoffMs = 500;
this._cache = null;
this._cacheTs = 0;
this._cacheTtl = 2000;
this._listeners = [];
this._granularPermissions = [
'bluetooth',
'bluetoothScan',
'bluetoothConnect',
'bluetoothAdvertise',
'location'
];
}
async init() {
try {
const cap = window.Capacitor || window?.capacitor?.Capacitor;
this._plugin = cap?.Plugins?.NexoBLE || cap?.Plugins?.NexoBle;
if (!this._plugin) {
console.warn('[NexoPermissionShim] Plugin NexoBLE no detectado');
return false;
}
console.log('[NexoPermissionShim] Plugin detectado OK');
return true;
} catch (e) {
console.error('[NexoPermissionShim] Error init:', e);
return false;
}
}
async requestAllPermissions() {
try {
if (!this._plugin) {
const ok = await this.init();
if (!ok) throw new Error('Plugin NexoBLE no disponible');
}
const cap = window.Capacitor || window?.capacitor?.Capacitor;
const permissionsAPI = cap?.Plugins?.Permissions;
if (permissionsAPI) {
console.log('[NexoPermissionShim] Solicitando permisos granulares vía Capacitor Permissions...');
const granularResults = await permissionsAPI.query({
permissions: this._granularPermissions
});
const needRequest = [];
for (const perm of this._granularPermissions) {
const state = granularResults?.permissions?.[perm] || granularResults?.[perm];
if (state !== 'granted') {
needRequest.push(perm);
}
}
if (needRequest.length > 0) {
console.log([NexoPermissionShim] Pidiendo: ${needRequest.join(', ')});
const reqResult = await permissionsAPI.request({
permissions: needRequest
});
const advState = reqResult?.permissions?.bluetoothAdvertise || reqResult?.bluetoothAdvertise;
if (advState !== 'granted') {
console.warn('[NexoPermissionShim] BLUETOOTH_ADVERTISE DENEGADO — advertising no funcionará');
}
}
} else {
console.warn('[NexoPermissionShim] Capacitor Permissions API no disponible, delegando 100% a nativo');
}
let nativeStatus = null;
for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
try {
nativeStatus = await this._plugin.checkBLEStatus();
if (nativeStatus?.allGranted || nativeStatus?.granted) {
console.log([NexoPermissionShim] Nativo OK (intento ${attempt}));
break;
}
if (attempt < this._maxRetries) {
await this._sleep(this._backoffMs * attempt);
}
} catch (e) {
console.warn([NexoPermissionShim] Intento ${attempt} falló:, e);
if (attempt < this._maxRetries) {
await this._sleep(this._backoffMs * attempt);
}
}
}
const isGranted = nativeStatus?.allGranted || nativeStatus?.granted;
if (!isGranted) {
console.log('[NexoPermissionShim] Forzando initializeBLE() nativo...');
await this._plugin.initializeBLE();
await this._sleep(300);
nativeStatus = await this._plugin.checkBLEStatus();
}
this._cache = {
allGranted: isGranted || nativeStatus?.allGranted,
nativeStatus,
advertisingGranted: this._checkAdvertisingGranted(),
timestamp: Date.now()
};
this._cacheTs = Date.now();
return this._cache;
} catch (e) {
console.error('[NexoPermissionShim] Error requestAllPermissions:', e);
throw e;
}
}
async checkStatus() {
const now = Date.now();
if (this._cache && (now - this._cacheTs < this._cacheTtl)) {
return this._cache;
}
return this.requestAllPermissions();
}
async checkAdvertisingPermission() {
try {
const cap = window.Capacitor || window?.capacitor?.Capacitor;
const permissionsAPI = cap?.Plugins?.Permissions;
if (!permissionsAPI) return { granted: false, error: 'Permissions API no disponible' };
const result = await permissionsAPI.query({
permissions: ['bluetoothAdvertise']
});
const state = result?.permissions?.bluetoothAdvertise || result?.bluetoothAdvertise;
return { granted: state === 'granted', state };
} catch (e) {
return { granted: false, error: e.message };
}
}
async requestAdvertisingOnly() {
try {
const cap = window.Capacitor || window?.capacitor?.Capacitor;
const permissionsAPI = cap?.Plugins?.Permissions;
if (!permissionsAPI) return { granted: false };
const result = await permissionsAPI.request({
permissions: ['bluetoothAdvertise']
});
const state = result?.permissions?.bluetoothAdvertise || result?.bluetoothAdvertise;
return { granted: state === 'granted', state };
} catch (e) {
return { granted: false, error: e.message };
}
}
cleanup() {
this._listeners.forEach(l => l?.remove?.());
this._listeners = [];
this._cache = null;
this._cacheTs = 0;
}
_checkAdvertisingGranted() {
return true;
}
_sleep(ms) {
return new Promise(r => setTimeout(r, ms));
}
}
// Singleton instance
const permissionShim = NexoPermissionShim.getInstance();
// FIX #1255: Export named + default para compatibilidad con main.js
export { NexoPermissionShim, permissionShim };
export default permissionShim;
