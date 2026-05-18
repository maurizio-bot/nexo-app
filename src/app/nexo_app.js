/**
 * nexo_app.js v5.1-961-FIX
 * Compatible con NEXO build #961 nativo.
 * Eventos nativos: onDeviceFound, onPayloadReceived, onAdvertiseStarted, 
 * onServerReady, onScanFailed, onDeviceConnected, onDeviceDisconnected, onConnectionFailed
 */

class NexoApp {
  constructor(config = {}) {
    this.plugin = null;
    this.activeContact = null;
    this.deviceCache = new Map(); // MAC -> {name, address, rssi, lastSeen}
    this.isInitialized = false;
    this.logs = [];
    
    this.onVaultStateChange = config.onVaultStateChange || (() => {});
    this.actionCallbacks = config.actionCallbacks || {};
    
    this._log('NexoApp instanciado');
  }

  _log(msg) {
    const line = `[NexoApp] ${msg}`;
    console.log(line);
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
  }

  /**
   * Inicializacion principal. Llamada desde main.js tras permisos OK.
   */
  init(pluginInstance) {
    if (this.isInitialized) {
      this._log('Ya inicializado. Ignorando.');
      return;
    }

    this.plugin = pluginInstance || window.Capacitor?.Plugins?.NexoBLE;
    if (!this.plugin) {
      this._log('FATAL: No hay plugin NexoBLE');
      return;
    }

    this._log('Inicializando...');
    this._registerListeners();
    this._initPhase5_BLEUI();
    this.isInitialized = true;
    this._log('Inicializacion completa.');
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      pluginReady: !!this.plugin,
      activeContact: this.activeContact,
      deviceCount: this.deviceCache.size,
      logs: this.logs.slice(-20)
    };
  }

  /**
   * Enviar mensaje via BLE al dispositivo activo
   */
  async sendMessage(msg) {
    if (!this.plugin) {
      return { success: false, error: 'No plugin' };
    }
    if (!this.activeContact || !this.activeContact.address) {
      return { success: false, error: 'No active contact' };
    }

    const payload = typeof msg === 'string' ? { content: msg } : msg;
    
    try {
      const result = await this.plugin.sendMessage({
        address: this.activeContact.address,
        message: JSON.stringify(payload)
      });
      this._log(`Mensaje enviado a ${this.activeContact.address}`);
      return { success: true, result };
    } catch (e) {
      this._log(`Error sendMessage: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  /**
   * Conectar a dispositivo por MAC
   */
  async connectToDevice(macAddress) {
    if (!this.plugin) return { success: false, error: 'No plugin' };
    if (!macAddress) return { success: false, error: 'No MAC' };

    try {
      const result = await this.plugin.connectToDevice({ address: macAddress });
      this.activeContact = { 
        name: result.name || result.deviceName || 'Desconocido', 
        address: macAddress 
      };
      this._log(`Conectado a ${macAddress}`);
      return { success: true, result };
    } catch (e) {
      this._log(`Error connectToDevice: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  async startScan() {
    if (!this.plugin) return;
    try {
      await this.plugin.startScan();
      this._log('Scan iniciado');
    } catch (e) {
      this._log(`Error startScan: ${e.message}`);
    }
  }

  async stopScan() {
    if (!this.plugin) return;
    try {
      await this.plugin.stopScan();
      this._log('Scan detenido');
    } catch (e) {
      this._log(`Error stopScan: ${e.message}`);
    }
  }

  async startAdvertising(userId) {
    if (!this.plugin) return;
    try {
      await this.plugin.startAdvertising({ userId: userId || '' });
      this._log('Advertising iniciado');
    } catch (e) {
      this._log(`Error startAdvertising: ${e.message}`);
    }
  }

  // ============ PRIVADO ============

  _registerListeners() {
    const events = [
      'onDeviceFound',
      'onPayloadReceived', 
      'onAdvertiseStarted',
      'onServerReady',
      'onScanFailed',
      'onDeviceConnected',
      'onDeviceDisconnected',
      'onConnectionFailed'
    ];

    events.forEach(evt => {
      try {
        this.plugin.addListener(evt, (data) => this._handleEvent(evt, data));
      } catch (e) {
        this._log(`No se pudo registrar ${evt}: ${e.message}`);
      }
    });
  }

  _handleEvent(eventName, data) {
    this._log(`EVENTO ${eventName}: ${JSON.stringify(data || {})}`);

    switch (eventName) {
      case 'onDeviceFound':
        if (data && data.address) {
          this.deviceCache.set(data.address, {
            name: data.name || 'NEXO-Device',
            address: data.address,
            rssi: data.rssi || 0,
            lastSeen: Date.now()
          });
        }
        if (this.actionCallbacks.onDeviceFound) {
          this.actionCallbacks.onDeviceFound(data);
        }
        break;

      case 'onPayloadReceived':
        if (data && data.message) {
          this._log(`Mensaje recibido: ${data.message}`);
          if (this.actionCallbacks.onMessage) {
            this.actionCallbacks.onMessage(data);
          }
        }
        break;

      case 'onDeviceConnected':
        this._log(`Dispositivo conectado: ${data?.address}`);
        break;

      case 'onDeviceDisconnected':
        this._log(`Dispositivo desconectado: ${data?.address}`);
        if (this.activeContact && this.activeContact.address === data?.address) {
          this.activeContact = null;
        }
        break;

      case 'onScanFailed':
        this._log(`Scan fallo: ${data?.error || 'desconocido'}`);
        break;

      case 'onConnectionFailed':
        this._log(`Conexion fallo: ${data?.address} - ${data?.error}`);
        break;
    }
  }

  _initPhase5_BLEUI() {
    this._log('Fase 5: BLE UI lista');
    if (window.initBLEInterface && typeof window.initBLEInterface === 'function') {
      try {
        window.initBLEInterface(this);
        this._log('BLE Interface integrada.');
      } catch (e) {
        this._log(`Error initBLEInterface: ${e.message}`);
      }
    }
  }
}

// Exportar global para main.js
window.NexoApp = new NexoApp();
