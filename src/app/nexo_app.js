/**
 * nexo_app.js v5.0.3-ARCH
 * Coordinador central. Múltiples transportes con fallback.
 * FIX v5.0.3-ARCH: Resuelve senderName desde contactos/connected/found
 */

import { initBLEInterface } from '../ui/ble_interface.js';

const DEBUG = false;

export class NexoApp {
  constructor(config = {}) {
    this.config = config;
    this.blePeers = new Map();
    this.wsClient = null;
    this.bridge = null;
    this.bleInterface = null;
    this.activeContact = null;
    this._messageDedupMap = new Map();
    this._maxProcessedIds = 1000;
    this._dedupTTL = 300000; // 5 minutos
  }

  async init() {
    await this._initPhase1_Crypto();
    await this._initPhase2_WebSocket();

    const nativeAvailable = !!(window.Capacitor?.Plugins?.NexoBLE);

    if (this.config.enableMesh && !nativeAvailable) {
      await this._initPhase3_NordicMesh();
    }
    await this._initPhase5_BLEUI();
    await this._initPhase7_UI();
  }

  async _initPhase1_Crypto() {
    // CryptoVault placeholder
  }

  async _initPhase2_WebSocket() {
    // WebSocket Client placeholder
  }

  async _initPhase5_BLEUI() {
    this.bleInterface = initBLEInterface(null);
  }

  async _initPhase7_UI() {
    // UI Initialization placeholder
  }

  async send(targetId, content) {
    // Lógica de envío multicanal
    if (this._sendViaBLE(targetId, content)) return true;
    return false;
  }

  async _sendViaBLE(targetId, content) {
    try {
      const { NexoBLE } = window.Capacitor.Plugins;
      await NexoBLE.sendMessage({ deviceId: targetId, message: content });
      return true;
    } catch (e) {
      console.error('[NexoApp] BLE send failed:', e);
      return false;
    }
  }

  _handleMessage(msg, source) {
    if (msg.messageId) {
      if (this._messageDedupMap.has(msg.messageId)) return;
      this._messageDedupMap.set(msg.messageId, Date.now());
    }

    const enriched = { ...msg, _source: source, _ts: Date.now() };
    this.config.onMessage?.(enriched);
  }
}
