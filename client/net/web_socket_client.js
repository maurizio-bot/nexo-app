/**
 * NEXO v9.0 - WebSocket Client (v2.3-NAP-CORRECTED)
 * FIXES: Race condition heartbeat + detección pong estricta + Identificación de fallas (WS-XXX)
 */

const WS_STATES = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

const DEFAULT_CONFIG = {
  urls: ['wss://relay.nexo.app/ws'],
  reconnectInterval: 3000,
  maxReconnectAttempts: 5,
  heartbeatInterval: 30000,
  heartbeatTimeout: 10000,
  maxQueueSize: 1000
};

// [NAP 2.0] Códigos de error únicos para identificación rápida en debugging físico
const ERROR_CODES = {
  CONFIG_INVALID: 'WS-001',        // Configuración inválida (no URLs)
  CONN_CREATION_FAILED: 'WS-002',  // Fallo al crear WebSocket nativo
  CONN_CLOSED_UNCLEAN: 'WS-003',   // Conexión cerrada sin limpieza
  JSON_PARSE_FAILED: 'WS-004',     // JSON inválido recibido (envuelto como texto)
  MSG_PROCESSING_ERROR: 'WS-005',  // Error inesperado en _onMessage
  BINARY_IGNORED: 'WS-006',        // Mensaje binario ignorado
  SEND_FAILED_QUEUED: 'WS-007',    // Envío falló, encolado
  QUEUE_FULL: 'WS-008',            // Cola de mensajes llena
  PONG_TIMEOUT: 'WS-009',          // Timeout de heartbeat (reconectando)
  RECONNECT_MAX_REACHED: 'WS-010', // Máximo reintentos alcanzado
  HEARTBEAT_RACE_BLOCKED: 'WS-011', // Race condition heartbeat prevenida
  NON_JSON_IGNORED: 'WS-012',      // Mensaje no-JSON ignorado (HTML/error)
  TIMEOUT_5MIN: 'WS-013',          // Mensaje expirado en cola (5min)
  DESTROYED_REJECTION: 'WS-014'    // Promesas rechazadas por destrucción
};

export class WebSocketClient {
  constructor(config = {}) {
    this.config = { 
      ...DEFAULT_CONFIG, 
      onConnect: () => {},
      onDisconnect: () => {},
      onMessage: () => {},
      onError: () => {},
      ...config 
    };
    
    if (!Array.isArray(this.config.urls) || this.config.urls.length === 0) {
      throw new Error(`[${ERROR_CODES.CONFIG_INVALID}] WebSocketClient requires at least one URL`);
    }
    
    this.ws = null;
    this.readyState = WS_STATES.CLOSED;
    this.reconnectAttempts = 0;
    this.currentUrlIndex = 0;
    this.messageQueue = [];
    this._connectionPromise = null;
    this._connectionResolve = null;
    this._connectionReject = null;
    
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._pongTimeout = null;
    
    this._onOpenBound = this._onOpen.bind(this);
    this._onMessageBound = this._onMessage.bind(this);
    this._onCloseBound = this._onClose.bind(this);
    this._onErrorBound = this._onError.bind(this);
    
    // [NAP 2.0] Buffer de errores recientes para diagnóstico en UI
    this._errorLog = [];
    this._maxErrorLog = 10;
    
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      reconnections: 0,
      lastConnectedAt: null,
      lastErrorCode: null,
      lastErrorAt: null
    };
  }

  // [NAP 2.0] Helper para logging estructurado de errores
  _logError(code, message, details = {}) {
    const errorEntry = {
      code,
      message: `[${code}] ${message}`,
      timestamp: Date.now(),
      details,
      url: this.config.urls[this.currentUrlIndex]
    };
    
    // Guardar en buffer circular
    this._errorLog.unshift(errorEntry);
    if (this._errorLog.length > this._maxErrorLog) {
      this._errorLog.pop();
    }
    
    // Actualizar stats
    this.stats.lastErrorCode = code;
    this.stats.lastErrorAt = errorEntry.timestamp;
    
    // Console con formato identificable
    console.error(`[WS] ❌ ${errorEntry.message}`, details);
    
    // Notificar a callback con código incluido
    this.config.onError(new Error(errorEntry.message), code, details);
    
    return errorEntry;
  }

  connect() {
    if (this.readyState === WS_STATES.OPEN) {
      return Promise.resolve();
    }
    
    if (this.readyState === WS_STATES.CONNECTING && this._connectionPromise) {
      return this._connectionPromise;
    }
    
    this._connectionPromise = new Promise((resolve, reject) => {
      this._connectionResolve = resolve;
      this._connectionReject = reject;
      this._doConnect();
    });
    
    return this._connectionPromise;
  }

  _doConnect() {
    const url = this.config.urls[this.currentUrlIndex];
    console.log(`[WS] Connecting to ${url}...`);
    
    try {
      this.readyState = WS_STATES.CONNECTING;
      this.ws = new WebSocket(url);
      
      this.ws.addEventListener('open', this._onOpenBound);
      this.ws.addEventListener('message', this._onMessageBound);
      this.ws.addEventListener('close', this._onCloseBound);
      this.ws.addEventListener('error', this._onErrorBound);
      
    } catch (error) {
      this._logError(ERROR_CODES.CONN_CREATION_FAILED, 'Connection creation failed', {
        error: error.message,
        url
      });
      this._scheduleReconnect();
    }
  }

  _onOpen() {
    console.log('[WS] ✅ Connected');
    this.readyState = WS_STATES.OPEN;
    this.reconnectAttempts = 0;
    this.stats.lastConnectedAt = Date.now();
    this.stats.reconnections++;
    
    if (this._connectionResolve) {
      this._connectionResolve();
      this._connectionResolve = null;
      this._connectionReject = null;
      this._connectionPromise = null;
    }
    
    this.config.onConnect();
    this._flushQueue();
    this._startHeartbeat();
  }

  // [NAP 2.0 FIX] Validación defensiva de JSON + códigos de error identificables
  _onMessage(event) {
    try {
      // Validar que sea string
      if (typeof event.data !== 'string') {
        console.warn(`[WS] ⚠️ [${ERROR_CODES.BINARY_IGNORED}] Binary message received, ignoring`);
        return;
      }
      
      // Detección pong estricta
      if (event.data === 'pong') {
        this._handlePong();
        return;
      }
      
      // Validar antes de parsear
      const trimmed = event.data.trim();
      
      // Ignorar mensajes vacíos o que claramente no son JSON
      if (!trimmed || 
          trimmed === '' || 
          trimmed.startsWith('<') || // HTML error
          trimmed.startsWith('Request') || // "Request sent..." etc
          trimmed.startsWith('HTTP') || // HTTP headers
          (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        console.warn(`[WS] ⚠️ [${ERROR_CODES.NON_JSON_IGNORED}] Non-JSON message ignored:`, trimmed.substring(0, 50));
        return;
      }
      
      // Intentar parsear con try-catch específico
      let msg;
      try {
        msg = JSON.parse(trimmed);
        
        // Verificación estricta de pong tras parsear
        if (msg && msg.type === 'pong') {
          this._handlePong();
          return;
        }
      } catch (parseError) {
        // [WS-004] JSON inválido - envolver como texto plano
        this._logError(ERROR_CODES.JSON_PARSE_FAILED, 'JSON parse failed, wrapping as plain text', {
          preview: trimmed.substring(0, 100),
          parseError: parseError.message
        });
        
        msg = {
          type: 'text',
          data: trimmed,
          _raw: true,
          _errorCode: ERROR_CODES.JSON_PARSE_FAILED,
          timestamp: Date.now()
        };
      }
      
      this.stats.messagesReceived++;
      this.config.onMessage(msg);
      
    } catch (error) {
      this._logError(ERROR_CODES.MSG_PROCESSING_ERROR, 'Unexpected error in message processing', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  _onClose(event) {
    const wasClean = event.wasClean;
    const code = event.code;
    
    console.log(`[WS] 🔌 Disconnected (code: ${code}, clean: ${wasClean})`);
    
    const wasConnected = this.readyState === WS_STATES.OPEN;
    this.readyState = WS_STATES.CLOSED;
    this._cleanupConnection();
    
    if (wasConnected) {
      this.config.onDisconnect();
    }
    
    // [WS-003] Detectar cierre no limpio
    if (!wasClean && wasConnected) {
      this._logError(ERROR_CODES.CONN_CLOSED_UNCLEAN, 'Connection closed unexpectedly', {
        closeCode: code,
        reason: event.reason
      });
    }
    
    if (this._connectionReject) {
      this._connectionReject(new Error(`[${ERROR_CODES.CONN_CLOSED_UNCLEAN}] Connection closed`));
      this._connectionResolve = null;
      this._connectionReject = null;
      this._connectionPromise = null;
    }
    
    if (!wasClean || wasConnected) {
      this._scheduleReconnect();
    }
  }

  _onError(error) {
    // Error nativo de WebSocket (usualmente fallo de red)
    this._logError(ERROR_CODES.CONN_CREATION_FAILED, 'WebSocket native error', {
      error: error?.message || 'Unknown network error'
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.log(`[WS] ⚠️ [${ERROR_CODES.RECONNECT_MAX_REACHED}] Max retries reached for current URL, trying next...`);
      this.currentUrlIndex = (this.currentUrlIndex + 1) % this.config.urls.length;
      this.reconnectAttempts = 0;
    }
    
    this.reconnectAttempts++;
    
    const baseDelay = this.config.reconnectInterval;
    const exponentialDelay = baseDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 4));
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.min(exponentialDelay * jitter, 30000);
    
    console.log(`[WS] ⏱️ Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})...`);
    
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._doConnect();
    }, delay);
  }

  async send(data) {
    if (!data || typeof data !== 'object') {
      throw new Error(`[${ERROR_CODES.CONFIG_INVALID}] Invalid data: expected object`);
    }
    
    if (this.readyState === WS_STATES.OPEN && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
        this.stats.messagesSent++;
        return;
      } catch (error) {
        // [WS-007] Fallo de envío, encolando
        this._logError(ERROR_CODES.SEND_FAILED_QUEUED, 'Send failed, queuing message', {
          error: error.message,
          dataPreview: JSON.stringify(data).substring(0, 100)
        });
      }
    }
    
    if (this.messageQueue.length >= this.config.maxQueueSize) {
      throw new Error(`[${ERROR_CODES.QUEUE_FULL}] Message queue full (max ${this.config.maxQueueSize})`);
    }
    
    this.messageQueue.push(data);
    
    if (this.readyState === WS_STATES.CLOSED && !this._reconnectTimer) {
      this._scheduleReconnect();
    }
    
    return new Promise((resolve, reject) => {
      data._resolve = resolve;
      data._reject = reject;
      data._queuedAt = Date.now();
    });
  }

  _flushQueue() {
    while (this.messageQueue.length > 0 && this.readyState === WS_STATES.OPEN) {
      const data = this.messageQueue.shift();
      const resolve = data._resolve;
      const reject = data._reject;
      delete data._resolve;
      delete data._reject;
      delete data._queuedAt;
      
      try {
        this.ws.send(JSON.stringify(data));
        this.stats.messagesSent++;
        if (resolve) resolve();
      } catch (error) {
        this._logError(ERROR_CODES.SEND_FAILED_QUEUED, 'Failed to send queued message', { error: error.message });
        if (reject) reject(error);
      }
    }
    
    const now = Date.now();
    const maxAge = 5 * 60 * 1000;
    this.messageQueue = this.messageQueue.filter(data => {
      if (data._queuedAt && (now - data._queuedAt > maxAge)) {
        // [WS-013] Mensaje expirado
        if (data._reject) {
          data._reject(new Error(`[${ERROR_CODES.TIMEOUT_5MIN}] Message timeout (5min)`));
        }
        return false;
      }
      return true;
    });
  }

  // [NAP 2.0 FIX] Race condition con identificación de prevención
  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      // FIX: Verificación doble con código de prevención
      if (this.readyState !== WS_STATES.OPEN || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        // [WS-011] Race condition prevenida - no es un error real, es defensa
        console.debug(`[WS] 🛡️ [${ERROR_CODES.HEARTBEAT_RACE_BLOCKED}] Heartbeat blocked (socket not ready)`);
        return;
      }
      
      try {
        this.ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      } catch (e) {
        return;
      }
      
      this._pongTimeout = setTimeout(() => {
        // [WS-009] Timeout de pong forzando reconexión
        console.warn(`[WS] ⚠️ [${ERROR_CODES.PONG_TIMEOUT}] Pong timeout, forcing reconnect`);
        if (this.ws) {
          this.ws.close(4000, 'Pong timeout');
        }
      }, this.config.heartbeatTimeout);
      
    }, this.config.heartbeatInterval);
  }

  _handlePong() {
    if (this._pongTimeout) {
      clearTimeout(this._pongTimeout);
      this._pongTimeout = null;
    }
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._pongTimeout) {
      clearTimeout(this._pongTimeout);
      this._pongTimeout = null;
    }
  }

  _cleanupConnection() {
    this._stopHeartbeat();
    
    if (this.ws) {
      this.ws.removeEventListener('open', this._onOpenBound);
      this.ws.removeEventListener('message', this._onMessageBound);
      this.ws.removeEventListener('close', this._onCloseBound);
      this.ws.removeEventListener('error', this._onErrorBound);
      
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close();
        } catch (e) {}
      }
      
      this.ws = null;
    }
  }

  disconnect() {
    console.log('[WS] Disconnecting (intentional)...');
    
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
    
    this._cleanupConnection();
    this.readyState = WS_STATES.CLOSED;
  }

  destroy() {
    this.disconnect();
    
    // [WS-014] Rechazar promesas pendientes por destrucción
    this.messageQueue.forEach(data => {
      if (data._reject) {
        data._reject(new Error(`[${ERROR_CODES.DESTROYED_REJECTION}] Client destroyed`));
      }
    });
    this.messageQueue = [];
    
    this.config = null;
    this.stats = null;
    this._errorLog = [];
  }

  // [NAP 2.0] Nuevos métodos para debugging en UI
  isConnected() {
    return this.readyState === WS_STATES.OPEN && this.ws?.readyState === WebSocket.OPEN;
  }

  getStats() {
    return { 
      ...this.stats, 
      queueSize: this.messageQueue.length,
      currentUrl: this.config.urls[this.currentUrlIndex],
      errorCount: this._errorLog.length
    };
  }

  // [NAP 2.0] Obtener log de errores recientes para mostrar en UI de diagnóstico
  getErrorLog() {
    return this._errorLog.map(e => ({
      code: e.code,
      message: e.message,
      time: new Date(e.timestamp).toLocaleTimeString(),
      url: e.url
    }));
  }

  // [NAP 2.0] Último error rápido para display en status bar
  getLastError() {
    return this._errorLog[0] || null;
  }
}
