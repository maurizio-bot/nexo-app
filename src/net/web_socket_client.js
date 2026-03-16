/**
 * NEXO v9.0 - WebSocketClient (v2.0-NAP)
 * Protocolo: wss://relay.nexo.local:8080
 * NAP Codes: WEBSOCKET_001-008
 */

const NAP_CODES = {
  WS_INIT_FAILED: 'WEBSOCKET_001',
  WS_CONNECTION_TIMEOUT: 'WEBSOCKET_002',
  WS_AUTH_FAILED: 'WEBSOCKET_003',
  WS_MESSAGE_PARSE_ERROR: 'WEBSOCKET_004',
  WS_SEND_FAILED: 'WEBSOCKET_005',
  WS_RECONNECTING: 'WEBSOCKET_006',
  WS_MAX_RETRIES: 'WEBSOCKET_007',
  WS_PROTOCOL_ERROR: 'WEBSOCKET_008'
};

const DEFAULT_CONFIG = {
  url: 'wss://relay.nexo.local:8080',
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  reconnectDecay: 1.5,
  timeoutInterval: 5000,
  maxRetries: 10,
  authToken: null,
  heartbeatInterval: 30000
};

export class WebSocketClient {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.socket = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.listeners = new Map();
    this.isConnecting = false;
    this.isAuthenticated = false;
    this.lastPong = Date.now();
    
    // REM Integration
    this._rem = typeof window !== 'undefined' ? (window.NEXO_REM || window.NEXO_DIAG) : null;
    
    // Bindings
    this._onOpen = this._onOpen.bind(this);
    this._onMessage = this._onMessage.bind(this);
    this._onError = this._onError.bind(this);
    this._onClose = this._onClose.bind(this);
  }

  _notify(type, message, code = '') {
    if (this._rem) {
      const method = type === 'error' ? 'error' : type === 'warn' ? 'warn' : type === 'success' ? 'success' : 'info';
      this._rem[method](`[WS] ${message}`, code);
    }
    console.log(`[WebSocket] ${type.toUpperCase()}: ${message}${code ? ` (${code})` : ''}`);
  }

  async connect() {
    if (this.isConnecting || (this.socket && this.socket.readyState === WebSocket.OPEN)) {
      return Promise.resolve();
    }

    this.isConnecting = true;
    this._notify('info', `Conectando a ${this.config.url}...`, 'WS_CONNECTING');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isConnecting = false;
        this._notify('error', 'Timeout de conexión', NAP_CODES.WS_CONNECTION_TIMEOUT);
        reject(new Error('Connection timeout'));
        this._scheduleReconnect();
      }, this.config.timeoutInterval);

      try {
        this.socket = new WebSocket(this.config.url);
        
        // Temporal listeners para el promise
        const onOpenOnce = (e) => {
          clearTimeout(timeout);
          this._onOpen(e);
          resolve();
        };
        
        const onErrorOnce = (e) => {
          clearTimeout(timeout);
          this._onError(e);
          reject(new Error('Connection failed'));
        };

        this.socket.addEventListener('open', onOpenOnce, { once: true });
        this.socket.addEventListener('error', onErrorOnce, { once: true });
        this.socket.addEventListener('message', this._onMessage);
        this.socket.addEventListener('close', this._onClose);
        
      } catch (err) {
        clearTimeout(timeout);
        this.isConnecting = false;
        this._notify('error', `Error creando socket: ${err.message}`, NAP_CODES.WS_INIT_FAILED);
        reject(err);
      }
    });
  }

  _onOpen(event) {
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this._notify('success', 'Conexión establecida', 'WS_CONNECTED');
    
    // Enviar auth si hay token
    if (this.config.authToken) {
      this.send({
        type: 'auth',
        token: this.config.authToken,
        timestamp: Date.now()
      });
    } else {
      // Solicitar ID de sesión/relay
      this.send({
        type: 'handshake',
        client: 'nexo-v9',
        timestamp: Date.now()
      });
    }

    // Iniciar heartbeat
    this._startHeartbeat();
    
    // Notificar a la app
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexo:websocket:connected'));
    }
    
    this.emit('connected');
  }

  _onMessage(event) {
    try {
      const data = JSON.parse(event.data);
      
      // Manejar protocolo interno
      if (data.type === 'pong') {
        this.lastPong = Date.now();
        return;
      }
      
      if (data.type === 'auth_success') {
        this.isAuthenticated = true;
        this._notify('success', 'Autenticado en relay', 'WS_AUTH_SUCCESS');
        this.emit('authenticated', data);
        return;
      }
      
      if (data.type === 'auth_error') {
        this.isAuthenticated = false;
        this._notify('error', 'Fallo de autenticación', NAP_CODES.WS_AUTH_FAILED);
        this.emit('auth_error', data);
        return;
      }
      
      if (data.type === 'relay_id') {
        // Recibimos ID de sesión del relay
        this._notify('info', `ID Relay asignado: ${data.id?.substring(0, 8)}...`, 'WS_RELAY_ID');
        this.emit('relay_id', data.id);
        return;
      }

      // Mensaje de datos normal - forward a listeners
      this.emit('message', data);
      
      // Notificar a nexo_app.js vía evento DOM para integración con el bridge
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nexo:message:received', {
          detail: { data, source: 'websocket' }
        }));
      }
      
    } catch (err) {
      this._notify('error', `Error parseando mensaje: ${err.message}`, NAP_CODES.WS_MESSAGE_PARSE_ERROR);
      this.emit('error', { type: 'parse_error', error: err, raw: event.data });
    }
  }

  _onError(event) {
    this.isConnecting = false;
    this._notify('error', 'Error de conexión WebSocket', NAP_CODES.WS_PROTOCOL_ERROR);
    this.emit('error', { type: 'websocket_error', event });
  }

  _onClose(event) {
    this.isConnecting = false;
    this.isAuthenticated = false;
    this._stopHeartbeat();
    
    const wasClean = event.wasClean;
    const code = event.code;
    
    if (wasClean) {
      this._notify('info', `Conexión cerrada limpiamente (code: ${code})`, 'WS_CLOSED_CLEAN');
    } else {
      this._notify('warn', `Conexión perdida (code: ${code})`, 'WS_CLOSED_ERROR');
      this._scheduleReconnect();
    }
    
    this.emit('disconnected', { code, wasClean, reason: event.reason });
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexo:websocket:disconnected', {
        detail: { code, wasClean }
      }));
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.config.maxRetries) {
      this._notify('error', 'Máximo de reintentos alcanzado', NAP_CODES.WS_MAX_RETRIES);
      this.emit('max_retries_reached');
      return;
    }

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(this.config.reconnectDecay, this.reconnectAttempts),
      this.config.maxReconnectInterval
    );

    this.reconnectAttempts++;
    this._notify('warn', `Reconectando en ${Math.round(delay/1000)}s... (intento ${this.reconnectAttempts})`, NAP_CODES.WS_RECONNECTING);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Error manejado en _onError/_onClose, continuará reintentando
      });
    }, delay);
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', timestamp: Date.now() });
        
        // Verificar último pong
        if (Date.now() - this.lastPong > this.config.heartbeatInterval * 2) {
          this._notify('warn', 'Heartbeat fallido, reconectando...', 'WS_HEARTBEAT_FAIL');
          this.socket.close();
        }
      }
    }, this.config.heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  send(data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this._notify('error', 'Intento de send en socket cerrado', NAP_CODES.WS_SEND_FAILED);
      throw new Error('WebSocket not connected');
    }

    try {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      this.socket.send(payload);
      return true;
    } catch (err) {
      this._notify('error', `Error enviando: ${err.message}`, NAP_CODES.WS_SEND_FAILED);
      throw err;
    }
  }

  // API de eventos simple
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error('Error en listener WS:', err);
        }
      });
    }
  }

  disconnect() {
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.socket) {
      // Remover listeners automáticos para evitar reconexión
      this.socket.removeEventListener('close', this._onClose);
      this.socket.close(1000, 'Manual disconnect');
      this.socket = null;
    }
    
    this.reconnectAttempts = 0;
    this._notify('info', 'Desconectado manualmente', 'WS_MANUAL_DISCONNECT');
  }

  getStatus() {
    if (!this.socket) return 'CLOSED';
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    return states[this.socket.readyState] || 'UNKNOWN';
  }

  isReady() {
    return this.socket && this.socket.readyState === WebSocket.OPEN && this.isAuthenticated;
  }
}

// Export singleton factory para nexo_app.js
export const createWebSocket = (config) => new WebSocketClient(config);
export default WebSocketClient;
