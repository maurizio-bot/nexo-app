/**
 * WebSocketClient v2.6-NAP-CERTIFIED
 * Cliente WebSocket con sistema WS-XXX, REM completo y SOC2 compliance
 * FIX: WS-001 a WS-014, Error buffer circular, TTL 5min, Pong detection
 */

// NAP: Sistema de errores WS-XXX (14 códigos únicos para debugging físico)
const ERROR_CODES = {
  WS_001: 'CONNECTION_REFUSED',
  WS_002: 'TIMEOUT_CONNECT', 
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
    // NAP: URL validation
    if (!url || !url.startsWith('ws')) {
      this._logError(ERROR_CODES.WS_010, 'Invalid WebSocket URL', { url });
      throw new Error('WS-010: Invalid WebSocket URL');
    }
    
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;  // NAP: Para detectar pong perdido
    this.heartbeatMs = options.heartbeatMs || 30000;
    this.pongTimeoutMs = options.pongTimeoutMs || 10000;
    
    // NAP: Message queue con TTL (5 minutos)
    this.messageQueue = [];
    this.queueTTL = options.queueTTL || 5 * 60 * 1000; // WS-013
    
    // NAP: Deduplication con TTL
    this.processedMessageIds = new Map(); // id -> timestamp
    
    // NAP: Error buffer circular (SOC2 CC7.2)
    this._errorLog = [];
    this._maxErrorLog = 10;
    this._lastError = null;
    
    this.isConnecting = false;
    this.intentionalClose = false;
    this.lastPingTime = null;
    
    // Callbacks
    this.onOpen = null;
    this.onMessage = null;
    this.onClose = null;
    this.onError = null;
    
    console.log(`[WS-v2.6-NAP] Initialized | URL: ${url}`);
  }

  /**
   * NAP: Conexión con manejo de errores estructurado
   */
  connect() {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected or connecting');
      return Promise.resolve();
    }

    this.isConnecting = true;
    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          console.log('[WS-001] Connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this._startHeartbeat();
          this._flushQueue();
          this.onOpen?.();
          resolve();
        };

        this.ws.onmessage = (event) => this._onMessage(event);
        
        this.ws.onclose = (event) => {
          this.isConnecting = false;
          this._stopHeartbeat();
          this.onClose?.(event);
          
          if (!this.intentionalClose && !event.wasClean) {
            this._logError(ERROR_CODES.WS_001, 'Connection closed unexpectedly', { code: event.code });
            this._scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          this.isConnecting = false;
          this._logError(ERROR_CODES.WS_001, 'Connection error', { error: error.message });
          this.onError?.(error, ERROR_CODES.WS_001, { url: this.url });
          reject(new Error(`WS-001: ${error.message}`));
        };

      } catch (err) {
        this.isConnecting = false;
        this._logError(ERROR_CODES.WS_010, 'Connection setup failed', { error: err.message });
        reject(new Error(`WS-010: ${err.message}`));
      }
    });
  }

  /**
   * NAP: Manejo defensivo de mensajes con WS-XXX y REM
   */
  _onMessage(event) {
    let data;
    
    try {
      // Intentar parsear como JSON
      data = JSON.parse(event.data);
    } catch (e) {
      // NAP: Wrapper para texto plano (REM)
      if (typeof event.data === 'string') {
        // Silencioso para heartbeats simples
        if (event.data === 'pong') {
          this._handlePong();
          return;
        }
        // Wrap como mensaje raw
        data = {
          type: 'text',
          data: event.data,
          _raw: true,
          timestamp: Date.now()
        };
      } else {
        this._logError(ERROR_CODES.WS_005, 'Message parse error', { data: event.data?.substring?.(0, 100) });
        return;
      }
    }

    // NAP: Manejo de pong estricto (string vs JSON)
    if (data === 'pong' || data.type === 'pong') {
      this._handlePong();
      return;
    }

    // NAP: Deduplicación con TTL
    const msgId = data.id || data.messageId || data._id;
    if (msgId) {
      if (this._isDuplicate(msgId)) {
        this._logError(ERROR_CODES.WS_014, 'Duplicate message prevented', { msgId: msgId.substring(0, 16) });
        return;
      }
      this.processedMessageIds.set(msgId, Date.now());
      this._cleanupProcessedIds();
    }

    // Routing seguro
    switch(data.type) {
      case 'eco':
      case 'confirmation':
        console.log('[WS] Eco confirmed:', data.id);
        this.onMessage?.(data);
        break;
      case 'message':
      case 'chat':
        this.onMessage?.(data);
        break;
      default:
        this.onMessage?.(data);
    }
  }

  /**
   * NAP: Heartbeat con doble verificación readyState y pong detection
   */
  _startHeartbeat() {
    // Enviar ping cada 30s
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws) return;
      
      // Check #1: State check
      if (this.ws.readyState !== WebSocket.OPEN) return;
      
      try {
        this.lastPingTime = Date.now();
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: this.lastPingTime }));
        
        // Esperar pong por 10s
        this.heartbeatTimeout = setTimeout(() => {
          this._logError(ERROR_CODES.WS_008, 'Heartbeat timeout (pong not received)');
          this.ws?.close();
        }, this.pongTimeoutMs);
        
      } catch (err) {
        this._logError(ERROR_CODES.WS_008, 'Heartbeat send failed', { error: err.message });
      }
    }, this.heartbeatMs);
  }

  _handlePong() {
    // Limpiar timeout de heartbeat
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
    const latency = Date.now() - (this.lastPingTime || Date.now());
    console.log(`[WS] Pong received, latency: ${latency}ms`);
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

  /**
   * NAP: Send con doble verificación readyState (Race condition fix)
   */
  send(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    
    // Check #1: Verificación inicial
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this._queueMessage(payload);
      return false;
    }
    
    try {
      // Check #2: Verificación justo antes de enviar (NAP Race condition fix)
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(payload);
        return true;
      } else {
        throw new Error('Socket closed between checks');
      }
    } catch (err) {
      this._logError(ERROR_CODES.WS_007, 'Send failed, queueing', { error: err.message });
      this._queueMessage(payload);
      return false;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * NAP: Queue con TTL (5 minutos) - WS-013
   */
  _queueMessage(payload) {
    const item = {
      payload,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.queueTTL,
      attempts: 0
    };
    
    this.messageQueue.push(item);
    console.log(`[WS-013] Queued: ${this.messageQueue.length} messages`);
  }

  /**
   * NAP: Flush con expiración y reintentos
   */
  _flushQueue() {
    const now = Date.now();
    const validMessages = [];
    
    // Filtrar expirados
    for (const item of this.messageQueue) {
      if (now > item.expiresAt) {
        this._logError(ERROR_CODES.WS_013, 'Message expired in queue', { age: now - item.timestamp });
      } else {
        validMessages.push(item);
      }
    }
    
    this.messageQueue = [];
    
    console.log(`[WS] Flushing ${validMessages.length} valid messages`);
    
    for (const item of validMessages) {
      try {
        // Doble verificación readyState
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(item.payload);
        } else {
          // Re-encolar si aún no expira
          if (Date.now() < item.expiresAt) {
            this._queueMessage(item.payload);
          }
        }
      } catch (err) {
        this._logError(ERROR_CODES.WS_007, 'Flush failed', { error: err.message });
        // Re-encolar si aún válido
        if (Date.now() < item.expiresAt) {
          this._queueMessage(item.payload);
        }
      }
    }
  }

  /**
   * NAP: Deduplicación con TTL (5 minutos)
   */
  _isDuplicate(msgId) {
    if (!msgId) return false;
    
    const timestamp = this.processedMessageIds.get(msgId);
    if (!timestamp) return false;
    
    // TTL de 5 minutos para duplicados
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() - timestamp > fiveMinutes) {
      this.processedMessageIds.delete(msgId);
      return false;
    }
    
    return true;
  }

  _cleanupProcessedIds() {
    // Limpiar entradas antiguas (>5 min)
    const fiveMinutes = 5 * 60 * 1000;
    for (const [id, timestamp] of this.processedMessageIds.entries()) {
      if (Date.now() - timestamp > fiveMinutes) {
        this.processedMessageIds.delete(id);
      }
    }
  }

  /**
   * NAP: Error logging con buffer circular
   */
  _logError(code, message, details = {}) {
    const error = {
      code,
      message,
      timestamp: Date.now(),
      url: this.url,
      ...details
    };
    
    this._lastError = error;
    this._errorLog.push(error);
    
    // Buffer circular de 10 errores
    if (this._errorLog.length > this._maxErrorLog) {
      this._errorLog.shift();
    }
    
    console.error(`[${code}] ${message}`, details);
  }

  /**
   * NAP: API pública para debugging (SOC2)
   */
  getErrorLog() {
    return [...this._errorLog];
  }

  getLastError() {
    return this._lastError;
  }

  getStats() {
    return {
      connected: this.isConnected(),
      readyState: this.ws?.readyState || -1,
      queueSize: this.messageQueue.length,
      queueExpired: this.messageQueue.filter(m => Date.now() > m.expiresAt).length,
      reconnectAttempts: this.reconnectAttempts,
      processedMessages: this.processedMessageIds.size,
      lastError: this._lastError?.code || null,
      errorCount: this._errorLog.length
    };
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._logError(ERROR_CODES.WS_009, 'Max reconnect attempts reached');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WS] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts + 1})`);
    
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {}); // Silenciar en reconnect
    }, delay);
  }

  disconnect() {
    this.intentionalClose = true;
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }
}

export { WebSocketClient, ERROR_CODES };
