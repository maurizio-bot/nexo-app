/**
 * hybrid_mesh.js - BLE Interface v2.1 (FIXED)
 * FIX: Agregado sistema de eventos .on() para compatibilidad con NexoApp
 */

export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();
    this.isVisible = false;
    this.elements = {};
    this.newDevicesCount = 0;
    
    // FIX #3: Sistema de eventos requerido por NexoApp
    this._listeners = new Map();
  }

  /**
   * FIX #3: Método .on() requerido por NexoApp v3.3.1
   * Registra callbacks de eventos
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    
    // Retornar función de unsubscribe
    return () => {
      this._listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Emite eventos a los listeners registrados
   */
  _emit(event, data) {
    this._listeners.get(event)?.forEach(cb => {
      try { cb(data); } catch(e) {}
    });
  }

  init() {
    if (!this.bleMesh) {
      console.error('[BLEInterface] Sin bleMesh');
      return this;
    }

    this.createDOM();
    this.injectStyles();
    this.setupEventListeners();
    
    return this;
  }

  createDOM() {
    // Tab
    const tab = document.createElement('div');
    tab.id = 'ble-tab';
    tab.innerHTML = `
      <div class="ble-tab-icon">🔷</div>
      <div class="ble-tab-label">BLE</div>
      <div class="ble-tab-badge" id="ble-tab-badge" style="display: none;">0</div>
    `;
    document.body.appendChild(tab);
    this.elements.tab = tab;

    // Panel
    const panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = `
      <div class="ble-header">
        <h3>BLE Mesh</h3>
        <button id="ble-close">✕</button>
      </div>
      <div class="ble-controls">
        <button id="ble-scan-btn" class="ble-btn">📡 Iniciar Scan</button>
        <span id="ble-status" class="ble-status-offline">OFFLINE</span>
      </div>
      <div class="ble-list" id="ble-devices-list">
        <p class="ble-empty">Presiona scan para buscar dispositivos</p>
      </div>
    `;
    document.body.appendChild(panel);
    this.elements.panel = panel;

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    document.body.appendChild(overlay);
    this.elements.overlay = overlay;

    // Referencias
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.closeBtn = document.getElementById('ble-close');
    this.elements.devicesList = document.getElementById('ble-devices-list');
    this.elements.status = document.getElementById('ble-status');
    this.elements.badge = document.getElementById('ble-tab-badge');
  }

  injectStyles() {
    if (document.getElementById('ble-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'ble-styles';
    style.textContent = `
      #ble-tab {
        position: fixed;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 44px;
        height: 100px;
        background: linear-gradient(180deg, #00d4ff, #0099cc);
        border-radius: 0 12px 12px 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 2147483644;
        color: #000;
        font-weight: bold;
      }
      #ble-tab.hidden { transform: translateY(-50%) translateX(-100%); }
      .ble-tab-badge {
        position: absolute;
        top: 5px;
        right: -5px;
        background: #ff4444;
        color: white;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
      }
      #ble-panel {
        position: fixed;
        top: 0;
        left: 0;
        width: 80vw;
        max-width: 350px;
        height: 100vh;
        background: rgba(15,15,20,0.98);
        transform: translateX(-100%);
        transition: transform 0.3s;
        z-index: 2147483645;
        color: #fff;
        padding: 20px;
      }
      #ble-panel.active { transform: translateX(0); }
      #ble-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: none;
        z-index: 2147483644;
      }
      #ble-overlay.active { display: block; }
      .ble-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        border-bottom: 1px solid #333;
        padding-bottom: 10px;
      }
      .ble-btn {
        width: 100%;
        padding: 15px;
        background: linear-gradient(135deg, #00ffff, #0088ff);
        border: none;
        border-radius: 8px;
        color: #000;
        font-weight: bold;
        cursor: pointer;
        margin-bottom: 10px;
      }
      .ble-btn.scanning {
        background: linear-gradient(135deg, #ff4444, #ff0088);
      }
      .ble-status-offline { color: #ff4444; }
      .ble-status-scanning { color: #ffaa00; }
      .ble-status-connected { color: #00ff88; }
      .ble-list {
        margin-top: 20px;
        max-height: 60vh;
        overflow-y: auto;
      }
      .ble-device-item {
        padding: 15px;
        background: rgba(255,255,255,0.05);
        border: 1px solid #333;
        border-radius: 8px;
        margin-bottom: 10px;
        cursor: pointer;
      }
      .ble-device-item:hover {
        border-color: #00ffff;
        background: rgba(0,255,255,0.1);
      }
      .ble-empty { color: #666; text-align: center; padding: 40px 0; }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    this.elements.tab.addEventListener('click', () => this.show());
    this.elements.closeBtn.addEventListener('click', () => this.hide());
    this.elements.overlay.addEventListener('click', () => this.hide());
    this.elements.scanBtn.addEventListener('click', () => this.toggleScan());

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  show() {
    this.isVisible = true;
    this.elements.panel.classList.add('active');
    this.elements.overlay.classList.add('active');
    this.elements.tab.classList.add('hidden');
    this.newDevicesCount = 0;
    this.updateBadge();
  }

  hide() {
    this.isVisible = false;
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.elements.tab.classList.remove('hidden');
  }

  toggle() {
    this.isVisible ? this.hide() : this.show();
  }

  async toggleScan() {
    if (!this.bleMesh) {
      this.showToast('BLE no disponible', 'error');
      return;
    }

    if (this.isScanning) {
      await this.stopScan();
    } else {
      await this.startScan();
    }
  }

  async startScan() {
    try {
      this.isScanning = true;
      this.foundDevices.clear();
      this.newDevicesCount = 0;
      this.updateBadge();
      this.renderEmpty('Buscando dispositivos...');
      this.startScanUI();

      await this.bleMesh.startScan();
      // FIX: Emitir evento para NexoApp
      this._emit('scanning', { active: true });
      
    } catch (err) {
      this.stopScanUI();
      this.showToast(err.message, 'error');
      this.renderEmpty('Error: ' + err.message);
    }
  }

  async stopScan() {
    try {
      if (this.bleMesh?.stopScan) {
        await this.bleMesh.stopScan();
      }
    } catch(e) {}
    this.stopScanUI();
    this._emit('scanning', { active: false });
  }

  startScanUI() {
    this.elements.scanBtn.textContent = '⏹ Detener Scan';
    this.elements.scanBtn.classList.add('scanning');
    this.elements.status.textContent = 'SCANNING';
    this.elements.status.className = 'ble-status-scanning';
  }

  stopScanUI() {
    this.isScanning = false;
    this.elements.scanBtn.textContent = '📡 Iniciar Scan';
    this.elements.scanBtn.classList.remove('scanning');
    this.updateStatus();
  }

  handleDeviceFound(device) {
    const id = device.id || device.endpointId;
    if (!id || this.foundDevices.has(id)) return;

    this.foundDevices.set(id, {
      ...device,
      id: id,
      timestamp: Date.now()
    });

    if (!this.isVisible) {
      this.newDevicesCount++;
      this.updateBadge();
    }

    this.renderDevices();
    // FIX: Emitir evento para NexoApp
    this._emit('device', device);
  }

  handleDeviceConnected(peer) {
    this.showToast(`Conectado: ${peer.name || 'dispositivo'}`, 'success');
    this.renderDevices();
    this.updateStatus();
    this._emit('connected', peer);
  }

  handleDeviceDisconnected(peer) {
    this.showToast(`Desconectado`, 'info');
    this.renderDevices();
    this.updateStatus();
    this._emit('disconnected', peer);
  }

  updateBadge() {
    if (this.newDevicesCount > 0 && !this.isVisible) {
      this.elements.badge.textContent = this.newDevicesCount > 9 ? '9+' : this.newDevicesCount;
      this.elements.badge.style.display = 'flex';
    } else {
      this.elements.badge.style.display = 'none';
    }
  }

  updateStatus() {
    if (!this.bleMesh) return;
    
    const status = this.bleMesh.getStatus ? this.bleMesh.getStatus() : {};
    const peers = status.peerCount || 0;
    
    if (peers > 0) {
      this.elements.status.textContent = `CONNECTED (${peers})`;
      this.elements.status.className = 'ble-status-connected';
    } else if (this.isScanning) {
      this.elements.status.textContent = 'SCANNING';
      this.elements.status.className = 'ble-status-scanning';
    } else {
      this.elements.status.textContent = 'OFFLINE';
      this.elements.status.className = 'ble-status-offline';
    }
  }

  renderEmpty(msg) {
    this.elements.devicesList.innerHTML = `<p class="ble-empty">${msg}</p>`;
  }

  renderDevices() {
    if (this.foundDevices.size === 0) {
      this.renderEmpty('No hay dispositivos');
      return;
    }

    let html = '';
    this.foundDevices.forEach(device => {
      html += `
        <div class="ble-device-item" onclick="window.bleInterface.connect('${device.id}')">
          <strong>${device.name || 'NEXO Device'}</strong><br>
          <small>${device.id.substr(0,8)}... • ${device.rssi || '?'} dBm</small>
        </div>
      `;
    });
    this.elements.devicesList.innerHTML = html;
  }

  async connect(deviceId) {
    try {
      await this.bleMesh.connect(deviceId);
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  }

  showToast(message, type) {
    if (window.rem) {
      const method = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
      window.rem[method](message, 'BLE');
    } else {
      alert(message);
    }
  }

  destroy() {
    this.hide();
    this.elements.tab?.remove();
    this.elements.panel?.remove();
    this.elements.overlay?.remove();
    document.getElementById('ble-styles')?.remove();
    this._listeners.clear();
  }
}

export let bleInterface = null;

export function initBLEInterface(bleMesh) {
  if (!bleMesh) return null;
  bleInterface = new BLEInterface(bleMesh);
  bleInterface.init();
  window.bleInterface = bleInterface;
  return bleInterface;
}
