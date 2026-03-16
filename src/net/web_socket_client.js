/**
 * WebSocketClient v2.7-FIX (Timeout en conexión)
 * FIX CRÍTICO: Timeout explícito en connect() para evitar bloqueos indefinidos
 */

const ERROR_CODES = {
  WS_001: 'CONNECTION_REFUSED',
  WS_002: 'TIMEOUT_CONNECT', // Este código ya existía pero no se usaba
  WS_003: 'HANDSHAKE_FAILED',
  WS_004: 'AUTH_FAILED',
  WS_005: 'MESSAGE_PARSE_ERROR',
  WS_006: 'SEND_WHILE_CONNECTING',
  WS_007: 'SEND_FAILED_OFFLINE',
  WS_008: 'HEARTBEAT_TIMEOUT',
  WS_009: 'RECONNECT_EXHAUSTED',
  WS_010: 'INVALID_URL',
  WS_011: 'MESSAGE_TOO_LARGE',
  WS_012: 'PROTOCOL_ERROR',
  WS_013: 'QUEUE_EXPIRED',
  WS_014: 'DUPLICATE_PREVENTED'
};

class WebSocketClient {
  constructor(url, options = {}) {
    if (!url || !url.startsWith('ws')) {
      throw new Error('WS-010: Invalid WebSocket URL');
    }
    
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5; // Reducido a 5
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    this.heartbeatMs = options.heartbeatMs || 30000;
    this.pongTimeoutMs = options.pongTimeoutMs || 10000;
    
    // FIX: Timeout de conexión explícito (default 5s)
    this.connectTimeoutMs = options.connectTimeoutMs || 5000;
    
    this.messageQueue = [];
    this.queueTTL = options.queueTTL || 5 * 60 * 1000;
    this.processedMessageIds = new Map();
    this._errorLog = [];
    this._maxErrorLog = 10;
    this._lastError = null;
    
    this.isConnecting = false;
    this.intentionalClose = false;
    this.lastPingTime = null;
    this._connectTimer = null; // FIX: Referencia al timer de timeout
    
    this.onOpen = null;
    this.onMessage = null;
    this.onClose = null;
    this.onError = null;
  }

  /**
   * FIX CRÍTICO: Conexión con timeout absoluto
   */
  connect() {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.isConnecting = true;
    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      let resolved = false;
      
      // FIX: Timeout de conexión - si no conecta en X segundos, forzar error
      this._connectTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.isConnecting = false;
          this._logError(ERROR_CODES.WS_002, `Connection timeout after ${this.connectTimeoutMs}ms`);
          
          // Cerrar websocket si sigue intentando
          if (this.ws) {
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
            this.ws = null;
          }
          
          reject(new Error(`WS-002: Connection timeout (${this.connectTimeoutMs}ms)`));
        }
      }, this.connectTimeoutMs);

      try {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          if (resolved) return; // Evitar doble resolve
          resolved = true;
          clearTimeout(this._connectTimer);
          
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this._startHeartbeat();
          this._flushQueue();
          this.onOpen?.();
          resolve();
        };

        this.ws.onmessage = (event) => this._onMessage(event);
        
        this.ws.onclose = (event) => {
          if (resolved && !this.isConnecting) {
            // Cierre post-conexión normal
            this._stopHeartbeat();
            this.onClose?.(event);
            
            if (!this.intentionalClose && !event.wasClean) {
              this._scheduleReconnect();
            }
          } else if (!resolved) {
            // Cierre durante intento de conexión (antes de onopen)
            resolved = true;
            clearTimeout(this._connectTimer);
            this.isConnecting = false;
            this._logError(ERROR_CODES.WS_001, 'Connection closed during handshake', { code: event.code });
            reject(new Error(`WS-001: Connection closed (code ${event.code})`));
          }
        };

        this.ws.onerror = (error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(this._connectTimer);
            this.isConnecting = false;
            this._logError(ERROR_CODES.WS_001, 'Connection error', { error: error?.message });
            this.onError?.(error, ERROR_CODES.WS_001, { url: this.url });
            reject(new Error(`WS-001: ${error?.message || 'Connection failed'}`));
          }
        };

      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(this._connectTimer);
          this.isConnecting = false;
          this._logError(ERROR_CODES.WS_010, 'Connection setup failed', { error: err.message });
          reject(new Error(`WS-010: ${err.message}`));
        }
      }
    });
  }

  // ... resto de métodos permanecen iguales ...
  // (copia aquí los demás métodos de tu archivo original: _onMessage, _startHeartbeat, etc.)

  _onMessage(event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      if (typeof event.data === 'string') {
        if (event.data === 'pong') {
          this._handlePong();
          return;
        }
        data = { type: 'text', data: event.data, _raw: true, timestamp: Date.now() };
      } else {
        this._logError(ERROR_CODES.WS_005, 'Message parse error');
        return;
      }
    }

    if (data === 'pong' || data.type === 'pong') {
      this._handlePong();
      return;
    }

    const msgId = data.id || data.messageId || data._id;
    if (msgId) {
      if (this._isDuplicate(msgId)) {
        this._logError(ERROR_CODES.WS_014, 'Duplicate message prevented');
        return;
      }
      this.processedMessageIds.set(msgId, Date.now());
      this._cleanupProcessedIds();
    }

    this.onMessage?.(data);
  }

  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      
      try {
        this.lastPingTime = Date.now();
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: this.lastPingTime }));
        
        this.heartbeatTimeout = setTimeout(() => {
          this._logError(ERROR_CODES.WS_008, 'Heartbeat timeout');
          this.ws?.close();
        }, this.pongTimeoutMs);
        
      } catch (err) {
        this._logError(ERROR_CODES.WS_008, 'Heartbeat send failed');
      }
    }, this.heartbeatMs);
  }

  _handlePong() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  send(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this._queueMessage(payload);
      return false;
    }
    
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(payload);
        return true;
      } else {
        throw new Error('Socket closed');
      }
    } catch (err) {
      this._queueMessage(payload);
      return false;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  _queueMessage(payload) {
    this.messageQueue.push({
      payload,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.queueTTL,
      attempts: 0
    });
  }

  _flushQueue() {
    const now = Date.now();
    const validMessages = this.messageQueue.filter(item => now <= item.expiresAt);
    this.messageQueue = [];
    
    validMessages.forEach(item => {
      try {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(item.payload);
        } else {
          this._queueMessage(item.payload);
        }
      } catch (err) {
        this._queueMessage(item.payload);
      }
    });
  }

  _isDuplicate(msgId) {
    if (!msgId) return false;
    const timestamp = this.processedMessageIds.get(msgId);
    if (!timestamp) return false;
    
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      this.processedMessageIds.delete(msgId);
      return false;
    }
    return true;
  }

  _cleanupProcessedIds() {
    const fiveMinutes = 5 * 60 * 1000;
    for (const [id, timestamp] of this.processedMessageIds.entries()) {
      if (Date.now() - timestamp > fiveMinutes) {
        this.processedMessageIds.delete(id);
      }
    }
  }

  _logError(code, message, details = {}) {
    const error = { code, message, timestamp: Date.now(), url: this.url, ...details };
    this._lastError = error;
    this._errorLog.push(error);
    if (this._errorLog.length > this._maxErrorLog) this._errorLog.shift();
    console.error(`[${code}] ${message}`, details);
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._logError(ERROR_CODES.WS_009, 'Max reconnect attempts reached');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WS] Reconnecting in ${delay}ms...`);
    
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {}); 
    }, delay);
  }

  disconnect() {
    this.intentionalClose = true;
    clearTimeout(this._connectTimer); // Limpiar timer pendiente
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }

  getErrorLog() { return [...this._errorLog]; }
  getLastError() { return this._lastError; }
  getStats() {
    return {
      connected: this.isConnected(),
      readyState: this.ws?.readyState || -1,
      queueSize: this.messageQueue.length,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this._lastError?.code || null
    };
  }
}

export { WebSocketClient, ERROR_CODES };
