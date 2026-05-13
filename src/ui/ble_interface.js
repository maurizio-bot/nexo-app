/**
 * BLE Interface v3.5-ARCH
 * UI del panel BLE Mesh. Coordina con NexoBlePlugin.kt v4.0.0-ARCH
 * FIX v3.5-ARCH: badge en chat, auto-registro, deduplicación
 */

const _normId = (id) => (id || '').toString().toLowerCase().trim();

const BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v3';

function _getBLEContacts() {
  try { return JSON.parse(localStorage.getItem(BLE_CONTACTS_STORAGE_KEY) || '[]'); }
  catch (e) { return []; }
}
function _addBLEContact(contact) {
  const contacts = _getBLEContacts();
  if (!contacts.find(c => _normId(c.id) === _normId(contact.id))) {
    contacts.push({ ...contact, addedAt: Date.now() });
    localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  }
}
function _removeBLEContact(id) {
  const contacts = _getBLEContacts().filter(c => _normId(c.id) !== _normId(id));
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}
function _getContactName(id) {
  const c = _getBLEContacts().find(c => _normId(c.id) === _normId(id));
  return c?.name || null;
}

class BLEInterface {
  constructor(bleMesh) {
    this.foundDevices = new Map();
    this.connectedDevices = new Map();
    this.nativePlugin = window.Capacitor?.Plugins?.NexoBLE || null;
    this.isDummyMode = !bleMesh && !this.nativePlugin;
    this._activeChatDeviceId = null;
    this._deviceStates = new Map();
    this._renderedDeviceIds = new Set();
  }

  async init() {
    if (this.isDummyMode) {
      console.warn('[BLEInterface] Dummy mode — no hay plugin nativo');
      return this;
    }
    // ... (configuración de listeners nativos)
    return this;
  }

  renderList() {
    const list = document.getElementById('ble-device-list');
    if (!list) return;

    this.foundDevices.forEach((dev, id) => {
      if (this._renderedDeviceIds.has(id)) return;
      
      const html = `
        <div class="ble-device-item" id="dev-${id}">
          <div class="ble-device-info">
            <span class="ble-device-name">${dev.name || 'NEXO Peer'}</span>
            <span class="ble-device-addr">${id}</span>
          </div>
          <div class="ble-device-actions">
            <button class="ble-chat-btn" data-id="${id}">💬</button>
            <button class="ble-add-btn" data-id="${id}">➕</button>
          </div>
        </div>
      `;
      list.insertAdjacentHTML('beforeend', html);
      this._renderedDeviceIds.add(id);
    });

    list.querySelectorAll('.ble-add-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const dev = this.foundDevices.get(id);
        if (dev) {
          _addBLEContact({ id, address: id, name: dev.name || 'NEXO Peer', rssi: dev.rssi });
          btn.textContent = '✓';
          btn.disabled = true;
        }
      };
    });
  }

  destroy() {
    this.nativePlugin?.removeAllListeners?.();
  }
}

export function initBLEInterface(bleMesh) {
  const instance = new BLEInterface(bleMesh);
  instance.init();
  return instance;
}
