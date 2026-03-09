/**
 * NEXO App v2.2-DEBUG - Con logs de diagnóstico
 */

import { CryptoVault } from '../core/crypto_vault.js';
import { BleMesh } from '../mesh/ble_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { VirtualEngine } from '../perf/virtual_engine.js';
import { TheStream } from '../stream/the_stream.js';

export class NexoApp {
  constructor(config = {}) {
    window.NEXO_DIAG?.log('   [NexoApp.constructor] Iniciando...', 'info');
    
    this.config = {
      relayUrls: config.relayUrls || [],
      bleTimeout: config.bleTimeout || 5000,
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: config.onMessage || (() => {}),
      onStatusChange: config.onStatusChange || (() => {}),
      onError: config.onError || (() => {})
    };
    
    this.vault = null;
    this.mesh = null;
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.initialized = false;
    this.destroyed = false;
    
    window.NEXO_DIAG?.log('   [NexoApp.constructor] Config aplicada', 'step');
  }
  
  async init() {
    if (this.initialized || this.destroyed) {
      throw new Error('App already initialized or destroyed');
    }
    
    window.NEXO_DIAG?.log('🚀 [init] ===== INICIANDO NEXO APP =====', 'step');
    
    try {
      // FASE 1: CRYPTO (Bloqueante)
      window.NEXO_DIAG?.log('🔐 [init] Fase 1/6: CryptoVault...', 'step');
      try {
        this.vault = new CryptoVault();
        window.NEXO_DIAG?.log('   ✓ CryptoVault instanciado', 'step');
        
        await this.vault.init();
        window.NEXO_DIAG?.log('   ✓ CryptoVault.init() completado', 'step');
        window.NEXO_DIAG?.log(`   ℹ️  Identity: ${this.vault.getIdentity()?.substring(0, 8)}...`, 'info');
      } catch (cryptoErr) {
        window.NEXO_DIAG?.log(`   ❌ ERROR en CryptoVault: ${cryptoErr.message}`, 'error');
        throw new Error(`CryptoVault failed: ${cryptoErr.message}`);
      }

      // FASE 2: WEBSOCKET (Fallback siempre disponible)
      window.NEXO_DIAG?.log('🌐 [init] Fase 2/6: WebSocketClient...', 'step');
      try {
        if (this.config.relayUrls.length > 0) {
          this.wsClient = new WebSocketClient({
            urls: this.config.relayUrls,
            onMessage: (msg) => this._handleMessage(msg, 'relay'),
            onConnect: () => {
              window.NEXO_DIAG?.log('   ✓ WebSocket conectado', 'step');
              this._updateStatus();
            },
            onDisconnect: () => {
              window.NEXO_DIAG?.log('   ⚠️  WebSocket desconectado', 'warn');
              this._updateStatus();
            },
            onError: (err) => {
              window.NEXO_DIAG?.log(`   ❌ WebSocket error: ${err.message || err}`, 'error');
              this.config.onError(err);
            }
          });
          
          await this.wsClient.connect();
          window.NEXO_DIAG?.log(`   ✓ WebSocketClient.connect() llamado (estado: ${this.wsClient.isConnected() ? 'conectado' : 'pendiente'})`, 'step');
        } else {
          window.NEXO_DIAG?.log('   ⚠️  Sin URLs de relay configuradas', 'warn');
        }
      } catch (wsErr) {
        window.NEXO_DIAG?.log(`   ❌ ERROR en WebSocket: ${wsErr.message}`, 'error');
        // No lanzamos error, BLE puede funcionar sin relay
      }

      // FASE 3: BLE MESH (Con timeout controlado)
      window.NEXO_DIAG?.log('📡 [init] Fase 3/6: BleMesh...', 'step');
      if (this.config.enableMesh && 'bluetooth' in navigator) {
        window.NEXO_DIAG?.log('   ℹ️  Web Bluetooth API disponible', 'info');
        try {
          this.mesh = new BleMesh({
            onPeer: (peer) => {
              window.NEXO_DIAG?.log(`   ✓ Nuevo peer BLE: ${peer?.id?.substring(0, 8) || 'unknown'}`, 'step');
              this._updateStatus();
            },
            onMessage: (msg, peer) => this._handleMessage(msg, 'ble'),
            onDisconnect: () => {
              window.NEXO_DIAG?.log('   ⚠️  BLE desconectado', 'warn');
              this._updateStatus();
            },
            onError: (err) => {
              window.NEXO_DIAG?.log(`   ❌ BLE error: ${err.message || err}`, 'error');
              this.config.onError(err);
            }
          });
          
          const meshTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Mesh timeout (5s)')), this.config.bleTimeout)
          );
          
          window.NEXO_DIAG?.log(`   ⏳ Intentando BLE (timeout: ${this.config.bleTimeout}ms)...`, 'warn');
          await Promise.race([this.mesh.init(), meshTimeout]);
          window.NEXO_DIAG?.log('   ✓ BleMesh.init() completado', 'step');
          
        } catch (meshErr) {
          window.NEXO_DIAG?.log(`   ⚠️  BLE falló (normal si no hay permisos): ${meshErr.message}`, 'warn');
          this.mesh = null;
        }
      } else {
        window.NEXO_DIAG?.log('   ⚠️  BLE deshabilitado o no soportado', 'warn');
        if (!('bluetooth' in navigator)) {
          window.NEXO_DIAG?.log('   ❌ Web Bluetooth API no disponible en este dispositivo', 'error');
        }
      }

      // FASE 4: BRIDGE (Gestiona P2P vs Relay)
      window.NEXO_DIAG?.log('🌉 [init] Fase 4/6: MeshRelayBridge...', 'step');
      try {
        this.bridge = new MeshRelayBridge({
          mesh: this.mesh,
          relay: this.wsClient,
          onModeChange: (mode) => {
            window.NEXO_DIAG?.log(`   🔄 Modo cambiado: ${mode}`, 'info');
            this.config.onStatusChange(mode);
          },
          onMessage: (msg) => this._handleMessage(msg, 'bridge')
        });
        
        await this.bridge.init();
        window.NEXO_DIAG?.log(`   ✓ Bridge iniciado (modo actual: ${this.bridge.getMode()})`, 'step');
      } catch (bridgeErr) {
        window.NEXO_DIAG?.log(`   ⚠️  Bridge falló (aislado): ${bridgeErr.message}`, 'warn');
        // No bloquear init() general si bridge falla
      }

      // FASE 5: GESTURES
      window.NEXO_DIAG?.log('👆 [init] Fase 5/6: GestureEngine...', 'step');
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
          window.NEXO_DIAG?.log('   ✓ Gestures activados', 'step');
        } catch (gestureErr) {
          window.NEXO_DIAG?.log(`   ⚠️  Gestures falló: ${gestureErr.message}`, 'warn');
        }
      }

      // FASE 6: STREAM (Feed unificado)
      window.NEXO_DIAG?.log('📰 [init] Fase 6/6: TheStream...', 'step');
      try {
        const container = document.getElementById('messages-container');
        if (!container) throw new Error('messages-container no encontrado');
        
        this.stream = new TheStream({
          container: container,
          virtualEngine: new VirtualEngine({
            container: container,
            itemHeight: 80,
            bufferSize: 5
          })
        });
        window.NEXO_DIAG?.log('   ✓ Stream inicializado', 'step');
      } catch (streamErr) {
        window.NEXO_DIAG?.log(`   ⚠️  Stream falló: ${streamErr.message}`, 'warn');
      }

      this.initialized = true;
      this._updateStatus();
      
      window.NEXO_DIAG?.log('🎉 [init] ===== INICIALIZACIÓN COMPLETADA =====', 'step');
      
    } catch (err) {
      window.NEXO_DIAG?.log(`💥 [init] ERROR CRÍTICO: ${err.message}`, 'error');
      await this.destroy();
      throw err;
    }
  }
  
  _handleMessage(msg, source) {
    if (this.destroyed) {
      window.NEXO_DIAG?.log(`   ⚠️  Mensaje ignorado (app destruida) de ${source}`, 'warn');
      return;
    }
    
    const enriched = {
      ...msg,
      _source: source,
      _receivedAt: Date.now(),
      _id: crypto.randomUUID?.() || Math.random().toString(36).substr(2, 9)
    };
    
    this.config.onMessage(enriched);
  }
  
  _updateStatus() {
    if (this.destroyed || !this.bridge) {
      window.NEXO_DIAG?.log(`   ℹ️  Status: OFFLINE (bridge no disponible)`, 'info');
      return;
    }
    
    const mode = this.bridge.getMode?.() || 'OFFLINE';
    window.NEXO_DIAG?.log(`   📊 Status update: ${mode}`, 'info');
    this.config.onStatusChange(mode);
  }
  
  sendMessage(msg) {
    if (!this.initialized || this.destroyed) {
      throw new Error('App not initialized');
    }
    
    window.NEXO_DIAG?.log(`📤 [sendMessage] Tipo: ${msg.type || 'unknown'}`, 'info');
    
    const enriched = {
      ...msg,
      _own: true,
      _sender: this.vault?.getIdentity?.() || 'unknown'
    };
    
    let sent = false;
    if (this.bridge) {
      sent = this.bridge.send(enriched);
      window.NEXO_DIAG?.log(`   → Enviado por bridge: ${sent}`, sent ? 'step' : 'warn');
    }
    
    this._handleMessage(enriched, 'self');
    return sent;
  }
  
  _navigate(direction) { console.log('Navigate:', direction); }
  _showMenu() { console.log('Show menu'); }
  _refresh() { 
    window.NEXO_DIAG?.log('🔄 Refresh solicitado', 'info');
    if (this.stream)
