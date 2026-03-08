  async init() {
    if (this.initialized) {
      throw new Error('App already initialized');
    }
    if (this.destroyed) {
      throw new Error('App was destroyed, create new instance');
    }

    console.log('[NEXO] Iniciando subsistemas...');
    const startTime = Date.now();

    try {
      // 1. CryptoVault (con timeout de 5s)
      console.log('[NEXO] [1/6] Inicializando CryptoVault...');
      try {
        this.vault = new CryptoVault();
        const vaultTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('CryptoVault timeout (>5s) - IndexedDB bloqueada?')), 5000)
        );
        await Promise.race([this.vault.init(), vaultTimeout]);
        console.log('[NEXO] [1/6] ✓ CryptoVault OK (identidad: ' + (this.vault.getIdentity()?.substring(0,8) || 'N/A') + ')');
      } catch (err) {
        console.error('[NEXO] [1/6] ✗ CryptoVault falló:', err.message);
        // No crítico - continuar en modo efímero
        this.vault = null;
        console.warn('[NEXO] [1/6] ⚠ Continuando sin persistencia (modo efímero)');
      }

      // 2. WebSocket Relay (timeout 3s)
      console.log('[NEXO] [2/6] Conectando WebSocket...');
      if (this.config.relayUrls.length > 0) {
        try {
          this.wsClient = new WebSocketClient({
            urls: this.config.relayUrls,
            onMessage: (msg) => this._handleMessage(msg, 'relay'),
            onConnect: () => {
              console.log('[NEXO] [2/6] WebSocket conectado');
              this._updateStatus();
            },
            onDisconnect: () => {
              console.log('[NEXO] [2/6] WebSocket desconectado');
              this._updateStatus();
            },
            onError: (err) => this.config.onError(err)
          });
          
          // Conectar pero no esperar (non-blocking)
          this.wsClient.connect().catch(err => {
            console.warn('[NEXO] [2/6] WebSocket error conexión:', err.message);
          });
          
          // Esperar máximo 3s a que conecte
          await new Promise((resolve) => {
            const check = setInterval(() => {
              if (this.wsClient.isConnected()) {
                clearInterval(check);
                resolve();
              }
            }, 100);
            setTimeout(() => {
              clearInterval(check);
              resolve(); // Timeout no fatal
            }, 3000);
          });
          
          console.log('[NEXO] [2/6] ✓ WebSocket ' + (this.wsClient.isConnected() ? 'conectado' : 'intentando...'));
        } catch (err) {
          console.error('[NEXO] [2/6] ✗ WebSocket error:', err.message);
          this.wsClient = null;
        }
      } else {
        console.log('[NEXO] [2/6] ⚠ Sin URLs de relay configuradas');
      }

      // 3. BLE Mesh (timeout configurable, default 5s)
      console.log('[NEXO] [3/6] Inicializando BLE Mesh...');
      if (this.config.enableMesh && 'bluetooth' in navigator) {
        try {
          this.mesh = new BleMesh({
            onPeer: (peer) => {
              console.log('[NEXO] [3/6] Nuevo peer BLE:', peer.id);
              this._updateStatus();
            },
            onMessage: (msg, peer) => this._handleMessage(msg, 'ble'),
            onDisconnect: () => {
              console.log('[NEXO] [3/6] BLE desconectado');
              this._updateStatus();
            },
            onError: (err) => this.config.onError(err)
          });
          
          const bleTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`BLE timeout (>${this.config.bleTimeout}ms) - ¿Permisos denegados?`)), this.config.bleTimeout)
          );
          
          await Promise.race([this.mesh.init(), bleTimeout]);
          console.log('[NEXO] [3/6] ✓ BLE Mesh iniciado');
        } catch (err) {
          console.error('[NEXO] [3/6] ✗ BLE falló:', err.message);
          this.mesh = null;
        }
      } else {
        console.log('[NEXO] [3/6] ⚠ BLE deshabilitado o no soportado');
      }

      // 4. MeshRelayBridge
      console.log('[NEXO] [4/6] Inicializando Bridge...');
      try {
        this.bridge = new MeshRelayBridge({
          mesh: this.mesh,
          relay: this.wsClient,
          onModeChange: (mode) => {
            console.log('[NEXO] [4/6] Modo bridge:', mode);
            this.config.onStatusChange(mode);
          },
          onMessage: (msg) => this._handleMessage(msg, 'bridge')
        });
        
        const bridgeTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Bridge timeout (>3s)')), 3000)
        );
        
        await Promise.race([this.bridge.init(), bridgeTimeout]);
        console.log('[NEXO] [4/6] ✓ Bridge OK (modo:', this.bridge.getMode(), ')');
      } catch (err) {
        console.error('[NEXO] [4/6] ✗ Bridge error:', err.message);
        // Crear bridge dummy para no romper
        this.bridge = { getMode: () => 'OFFLINE', send: () => false };
      }

      // 5. Gesture Engine (no bloqueante)
      console.log('[NEXO] [5/6] Inicializando Gestures...');
      if (this.config.enableGestures) {
        try {
          this.gestures = new GestureEngine({
            onSwipeLeft: () => console.log('[GESTURE] Swipe left'),
            onSwipeRight: () => console.log('[GESTURE] Swipe right'),
            onSwipeUp: () => console.log('[GESTURE] Swipe up (menu)'),
            onSwipeDown: () => console.log('[GESTURE] Swipe down (refresh)'),
            onQuickAction: (action) => console.log('[GESTURE] Quick:', action)
          });
          this.gestures.init();
          console.log('[NEXO] [5/6] ✓ Gestures OK');
        } catch (err) {
          console.error('[NEXO] [5/6] ✗ Gestures error:', err.message);
        }
      }

      // 6. The Stream
      console.log('[NEXO] [6/6] Inicializando Stream...');
      try {
        const container = document.getElementById('messages-container');
        if (container) {
          this.stream = new TheStream({
            container: container,
            virtualEngine: new VirtualEngine({
              container: container,
              itemHeight: 80,
              bufferSize: 5
            })
          });
          console.log('[NEXO] [6/6] ✓ Stream OK');
        } else {
          console.warn('[NEXO] [6/6] ⚠ No hay #messages-container, saltando Stream');
        }
      } catch (err) {
        console.error('[NEXO] [6/6] ✗ Stream error:', err.message);
      }

      this.initialized = true;
      const duration = Date.now() - startTime;
      console.log(`[NEXO] ✅ Inicialización completa en ${duration}ms`);
      this._updateStatus();
      
    } catch (err) {
      console.error('[NEXO] 💥 Error durante init():', err);
      throw err; // Re-lanzar para que main.js lo capture
    }
  }
