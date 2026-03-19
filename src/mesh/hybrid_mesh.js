/**
 * Hybrid Mesh - Sistema híbrido BLE + WebSocket
 * v1.2 - Fix: Exporta clase (no instancia), importa NordicMesh correctamente
 */

import { NordicMesh } from './nordic_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';

class HybridMesh {
  constructor(config = {}) {
    this.config = {
      enableBLE: true,
      enableWebSocket: true,
      fallbackToWebSocket: true,
      ...config
    };
    
    this.nordicMesh = null;
    this.wsClient = null;
    this.isInitialized = false;
    this.currentMode = 'OFFLINE';
    this.peers = new Map();
    
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onMessageReceived = null;
    this.onModeChanged = null;
  }

  /**
   * Inicializa el sistema híbrido
   */
  async initialize() {
    try {
      console.log('[HybridMesh] Inicializando sistema híbrido...');
      
      // Inicializar NordicMesh (BLE)
      if (this.config.enableBLE) {
        this.nordicMesh = new NordicMesh({
          onPeerDiscovered: (peer) => this._handlePeerDiscovered(peer),
          onPeerConnected: (peer) => this._handlePeerConnected(peer),
          onPeerDisconnected: (peer) => this._handlePeerDisconnected(peer),
          onMessageReceived: (msg) => this._handleBLEMessage(msg)
        });
        
        await this.nordicMesh.initialize();
        this.currentMode = 'BLE';
      }
      
      // Inicializar WebSocket como fallback
      if (this.config.enableWebSocket && this.config.fallbackToWebSocket) {
        this.wsClient = new WebSocketClient({
          url: this.config.wsUrl || 'wss://relay.nexo.local:8086',
          onConnect: () => this._handleWSConnect(),
          onDisconnect: () => this._handleWSDisconnect(),
          onMessage: (msg) => this._handleWSMessage(msg)
        });
        
        // Solo conectar WS si BLE no está disponible
        if (this.currentMode === 'OFFLINE') {
          await this.wsClient.connect();
          this.currentMode = 'RELAY';
        }
      }
      
      this.isInitialized = true;
      console.log(`[HybridMesh] Inicializado en modo: ${this.currentMode}`);
      
      if (this.onModeChanged) {
        this.onModeChanged(this.currentMode);
      }
      
      return true;
    } catch (error) {
      console.error('[HybridMesh] Error inicialización:', error);
      
      // Fallback a WebSocket si BLE falla
      if (this.config.fallbackToWebSocket && this.wsClient && this.currentMode === 'OFFLINE') {
        try {
          await this.wsClient.connect();
          this.currentMode = 'RELAY';
          this.isInitialized = true;
          return true;
        } catch (wsError) {
          console.error('[HybridMesh] Fallback WS también falló:', wsError);
        }
      }
      
      throw error;
    }
  }

  /**
   * Envía mensaje por la mejor ruta disponible
   */
  async sendMessage(peerId, data) {
    if (!this.isInitialized) {
      throw new Error('[HybridMesh] Sistema no inicializado');
    }

    // Prioridad 1: BLE (si peer está conectado vía BLE)
    if (this.nordicMesh && this.peers.has(peerId) && this.peers.get(peerId).via === 'BLE') {
      try {
        await this.nordicMesh.sendMessage(peerId, data);
        return { success: true, via: 'BLE' };
      } catch (bleError) {
        console.warn('[HybridMesh] BLE falló, intentando WS:', bleError);
      }
    }

    // Prioridad 2: WebSocket/Relay
    if (this.wsClient && this.wsClient.isConnected()) {
      try {
        await this.wsClient.send({
          type: 'MESSAGE',
          peerId: peerId,
          payload: data
        });
        return { success: true, via: 'RELAY' };
      } catch (wsError) {
        console.error('[HybridMesh] WS también falló:', wsError);
        throw wsError;
      }
    }

    throw new Error('[HybridMesh] No hay conectividad disponible para enviar mensaje');
  }

  /**
   * Busca peers cercanos vía BLE
   */
  async startScan(duration = 10000) {
    if (this.nordicMesh) {
      return await this.nordicMesh.startScan(duration);
    }
    throw new Error('[HybridMesh] BLE no disponible');
  }

  async stopScan() {
    if (this.nordicMesh) {
      return await this.nordicMesh.stopScan();
    }
  }

  /**
   * Conecta a un peer específico
   */
  async connectToPeer(peerId) {
    if (this.nordicMesh) {
      return await this.nordicMesh.connect(peerId);
    }
    throw new Error('[HybridMesh] BLE no disponible para conexión directa');
  }

  /**
   * Desconecta de un peer
   */
  async disconnectPeer(peerId) {
    if (this.nordicMesh && this.peers.get(peerId)?.via === 'BLE') {
      return await this.nordicMesh.disconnect(peerId);
    }
  }

  /**
   * Obtiene lista de peers conectados
   */
  getConnectedPeers() {
    return Array.from(this.peers.entries()).map(([id, info]) => ({
      id,
      ...info
    }));
  }

  /**
   * Retorna modo actual
   */
  getCurrentMode() {
    return this.currentMode;
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.nordicMesh) {
      this.nordicMesh.destroy();
      this.nordicMesh = null;
    }
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }
    this.peers.clear();
    this.isInitialized = false;
    this.currentMode = 'OFFLINE';
  }

  // Handlers privados
  _handlePeerDiscovered(peer) {
    console.log('[HybridMesh] Peer descubierto:', peer);
    if (!this.peers.has(peer.id)) {
      this.peers.set(peer.id, { ...peer, via: 'BLE', status: 'discovered' });
    }
  }

  _handlePeerConnected(peer) {
    console.log('[HybridMesh] Peer conectado vía BLE:', peer);
    this.peers.set(peer.id, { ...peer, via: 'BLE', status: 'connected' });
    if (this.onPeerConnected) this.onPeerConnected(peer);
  }

  _handlePeerDisconnected(peer) {
    console.log('[HybridMesh] Peer desconectado:', peer);
    if (this.peers.has(peer.id)) {
      this.peers.delete(peer.id);
    }
    if (this.onPeerDisconnected) this.onPeerDisconnected(peer);
  }

  _handleBLEMessage(msg) {
    console.log('[HybridMesh] Mensaje BLE recibido:', msg);
    if (this.onMessageReceived) {
      this.onMessageReceived({ ...msg, via: 'BLE' });
    }
  }

  _handleWSConnect() {
    console.log('[HybridMesh] WebSocket conectado');
    if (this.currentMode === 'OFFLINE') {
      this.currentMode = 'RELAY';
      if (this.onModeChanged) this.onModeChanged(this.currentMode);
    }
  }

  _handleWSDisconnect() {
    console.log('[HybridMesh] WebSocket desconectado');
    if (this.currentMode === 'RELAY') {
      this.currentMode = 'OFFLINE';
      if (this.onModeChanged) this.onModeChanged(this.currentMode);
    }
  }

  _handleWSMessage(msg) {
    console.log('[HybridMesh] Mensaje WS recibido:', msg);
    if (this.onMessageReceived) {
      this.onMessageReceived({ ...msg, via: 'RELAY' });
    }
  }
}

// ✅ EXPORT CORREGIDO: Exportar clase (no instancia)
export { HybridMesh };
export default HybridMesh;
