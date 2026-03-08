/**
 * NEXO App v2.2-NAP
 * Orquestador principal - FIXES APLICADOS (2 bugs mínimos)
 */

import { CryptoVault } from '../core/crypto_vault.js';
import { FenixBackup } from '../fenix/fenix_backup.js';
import { BleMesh } from '../mesh/ble_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { VirtualEngine } from '../perf/virtual_engine.js';
import { TheStream } from '../stream/the_stream.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { PulseAlgorithm } from '../stream/pulse_algorithm.js';

export class NexoApp {
  constructor(config = {}) {
    this.config = {
      relayUrls: config.relayUrls || ['wss://relay.nexo.app/ws'],
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      enableFenix: config.enableFenix !== false,
      onStatusChange: config.onStatusChange || (() => {}),
      onMessage: config.onMessage || (() => {}),
      onError: config.onError || (() => {}),
      container: config.container || document.body
    };

    this.state = {
      initialized: false,
      destroyed: false,
      connectionMode: 'OFFLINE',
      identity: null,
      stats: {
        messagesReceived: 0,
        messagesSent: 0,
        peersConnected: 0,
        lastSync: null
      }
    };

    this.vault = null;
    this.mesh = null;
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.fenix = null;
    this.pulse = null;
  }

  async init() {
    console.log('[NEXO] 🚀 Iniciando subsistemas...');
    const startTime = Date.now();

    if (this.state.initialized || this.state.destroyed) {
      throw new Error('App ya inicializada o destruida');
    }

    try {
      // 1. Inicializar crypto (identidad)
      console.log('[NEXO] [1/8] Inicializando CryptoVault...');
      try {
        this.vault = new CryptoVault();
        await this.vault.init();
        console.log('[NEXO] [1/8] ✓ CryptoVault OK (identidad: ' + (this.vault.getIdentity()?.substring(0,8) || 'N/A') + ')');
      } catch (err) {
        console.error('[NEXO] [1/8] ✗ FALLO CRÍTICO CryptoVault:', err.message);
        throw new Error(`CryptoVault falló: ${err.message}`);
      }

      // 2. Inicializar WebSocket (fallback)
      console.log('[NEXO] [2/8] Conectando WebSocket...');
      if (this.config.relayUrls.length > 0) {
        try {
          this.wsClient = new WebSocketClient({
            urls: this.config.relayUrls,
            onMessage: (msg) => this._handleMessage(msg, 'relay'),
            onConnect: () => this._updateStatus(),
            onDisconnect: () => this._updateStatus(),
            onError: (err) => this.config.onError(err)
          });
          await this.wsClient.connect();
          console.log('[NEXO] [2/8] ✓ WebSocket conectado');
        } catch (err) {
          console.error('[NEXO] [2/8] ✗ WebSocket falló:', err.message);
          // No es crítico, continuar sin relay
          this.wsClient = null;
        }
      } else {
        console.log('[NEXO] [2/8] ⚠ Sin URLs de relay configuradas');
      }

      // 3. Inicializar BLE Mesh
      console.log('[NEXO] [3/8] Inicializando BLE Mesh...');
      if (this.config.enableMesh && navigator.bluetooth) {
        try {
          this.mesh = new BleMesh({
            onPeer: () => this._updateStatus(),
            onMessage: (msg, peer) => this._handleMessage(msg, 'ble'),
            onDisconnect: () => this._updateStatus(),
            onError: (err) => this.config.onError(err)
          });
          
          const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Mesh timeout (>5000ms) - ¿Permisos denegados?')), 5000)
          );
          
          await Promise.race([this.mesh.init(), timeout]);
          console.log('[NEXO] [3/8] ✓ BLE Mesh iniciado');
        } catch (err) {
          console.error('[NEXO] [3/8] ✗ BLE Mesh no disponible:', err.message);
          this.mesh = null;
        }
      } else {
        console.log('[NEXO] [3/8] ⚠ BLE deshabilitado o no soportado');
      }

      // 4. Inicializar Bridge
      console.log('[NEXO] [4/8] Inicializando Bridge...');
      try {
        this.bridge = new MeshRelayBridge({
          mesh: this.mesh,
          relay: this.wsClient,
          onModeChange: (mode) => this.config.onStatusChange(mode),
          onMessage: (msg) => this._handleMessage(msg, 'bridge')
        });
        
        await this.bridge.init();
        console.log('[NEXO] [4/8] ✓ Bridge OK (modo:', this.bridge.getMode?.() || 'UNKNOWN', ')');
      } catch (err) {
        console.error('[NEXO] [4/8] ✗ Bridge init failed (aislado):', err.message);
        // No crítico, continuar sin bridge
      }

      // 5. Inicializar Gestures
      console.log('[NEXO] [5/8] Inicializando Gestures...');
      if (this.config.enableGestures) {
        try {
          this.gestures = new GestureEngine({
            onSwipeLeft: () => this._navigate('back'),
            onSwipeRight: () => this._navigate('forward'),
            onSwipeUp: () => this._showMenu(),
            onSwipeDown: () => this._refresh(),
            onQuickAction: (action) => this._handleQuickAction(action)
          });
          this.gestures.init();
          console.log('[NEXO] [5/8] ✓ Gestures OK');
        } catch (err) {
          console.error('[NEXO] [5/8] ✗ Gestures error:', err.message);
        }
      } else {
        console.log('[NEXO] [5/8] ⚠ Gestures deshabilitado');
      }

      // 6. Inicializar Stream
      console.log('[NEXO] [6/8] Inicializando Stream...');
      try {
        this.stream = new TheStream({
          container: this.config.container,
          virtualEngine: new VirtualEngine({
            container: this.config.container,
            itemHeight: 80,
            bufferSize: 5
          })
        });
        console.log('[NEXO] [6/8] ✓ Stream OK');
      } catch (err) {
        console.error('[NEXO] [6/8] ✗ Stream error:', err.message);
      }

      // 7. Inicializar Fénix (backup)
      console.log('[NEXO] [7/8] Inicializando Fénix...');
      if (this.config.enableFenix) {
        try {
          this.fenix = new FenixBackup({
            vault: this.vault
          });
          console.log('[NEXO] [7/8] ✓ Fénix OK');
        } catch (err) {
          console.error('[NEXO] [7/8] ✗ Fénix error:', err.message);
        }
      } else {
        console.log('[NEXO] [7/8] ⚠ Fénix deshabilitado');
      }

      // 8. Inicializar Pulse (algoritmo viral)
      console.log('[NEXO] [8/8] Inicializando Pulse...');
      try {
        this.pulse = new PulseAlgorithm();
        console.log('[NEXO] [8/8] ✓ Pulse OK');
      } catch (err) {
        console.error('[NEXO] [8/8] ✗ Pulse error:', err.message);
      }

      this.state.initialized = true;
      this.state.identity = this.vault.getIdentity();
      this._updateStatus();
      
      const duration = Date.now() - startTime;
      console.log(`[NEXO] ✅ Inicialización completa en ${duration}ms`);

      return true;
    } catch (err) {
      console.error('[NEXO] 💥 Error fatal durante init():', err);
      await this.destroy();
      throw err;
    }
  }

  _handleMessage(msg, source) {
    if (this.state.destroyed) return;

    const enriched = {
      ...msg,
      _source: source,
      _receivedAt: Date.now(),
      _id: crypto.randomUUID?.() || Math.random().toString(36).substr(2, 9)
    };

    this.state.stats.messagesReceived++;
    this.config.onMessage(enriched);
  }

  _updateStatus() {
    if (this.state.destroyed || !this.bridge) return;

    const mode = this.bridge.getMode?.() || 'OFFLINE';
    this.state.connectionMode = mode;
    this.config.onStatusChange(mode);
  }

  sendMessage(msg) {
    if (!this.state.initialized || this.state.destroyed) {
      throw new Error('App no inicializada');
    }

    const enriched = {
      ...msg,
      _own: true,
      _sender: this.state.identity,
      _timestamp: Date.now()
    };

    // Enviar por bridge
    if (this.bridge) {
      this.bridge.send(enriched);
    }

    // Mostrar localmente
    this._handleMessage(enriched, 'self');
    this.state.stats.messagesSent++;
  }

  _navigate(direction) {
    console.log('[NexoApp] Navigate:', direction);
  }

  _showMenu() {
    console.log('[NexoApp] Show menu');
  }

  _refresh() {
    console.log('[NexoApp] Refresh');
    if (this.stream) this.stream.refresh();
  }

  _handleQuickAction(action) {
    console.log('[NexoApp] Quick action:', action);
  }

  getStats() {
    return {
      ...this.state.stats,
      mode: this.state.connectionMode,
      identity: this.state.identity
    };
  }

  async destroy() {
    if (this.state.destroyed) return;
    this.state.destroyed = true;

    if (this.gestures) {
      try { this.gestures.destroy(); } catch (e) {}
    }

    if (this.stream) {
      try { this.stream.destroy(); } catch (e) {}
    }

    if (this.bridge) {
      try { await this.bridge.destroy(); } catch (e) {}
    }

    if (this.mesh) {
      try { await this.mesh.destroy(); } catch (e) {}
    }

    if (this.wsClient) {
      try { await this.wsClient.disconnect(); } catch (e) {}
    }

    if (this.vault) {
      // FIX: Limpiar identity ANTES del await
      const identity = this.vault.identity;
      if (identity && identity.privateKey) {
        identity.privateKey = null;
      }
      try { await this.vault.destroy(); } catch (e) {}
    }

    this.state.initialized = false;
  }
}
