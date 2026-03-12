/**
 * WebSocketClient v2.5-NAP-REM
 * Cliente WebSocket con manejo robusto de offline y cola de mensajes
 * FIX: Sin promesas rechazadas no controladas, encolamiento automático
 */
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.messageQueue = []; // Cola de mensajes pendientes
    this.processedMessageIds = new Set(); // Deduplicación de entrada
    this.isConnecting = false;
    this.intentionalClose = false;
    
    // Callbacks configurables
    this.onOpen = null;
    this.onMessage = null;
    this.onClose = null;
    this.onError = null;
    this.onEco = null;
    
    console.log(`[WS] Client v2.5-NAP-REM initialized for ${url}`);
  }

  connect() {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WS] Ya conectado o conectando, ignorando...');
      return Promise.resolve();
    }

    this.isConnecting = true;
    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          console.log('✅ WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this._startHeartbeat();
          this._flushQueue(); // Enviar mensajes encolados
          this.onOpen?.();
          resolve();
        };

        this.ws.onmessage = (event) => this._onMessage(event);
        
        this.ws.onclose = (event) => {
          this.isConnecting = false;
          this._stopHeartbeat();
          this.onClose?.(event);
          
          if (!this.intentionalClose) {
            console.warn('[WS] Conexión cerrada inesperadamente, reintentando...');
            this._scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          this.isConnecting = false;
          this.onError?.(error);
          reject(error);
        };

      } catch (err) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  /**
   * FIX CRÍTICO: Manejo defensivo de mensajes sin rechazar promesas
   */
  _onMessage(event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      // Silencioso para mensajes no-JSON (heartbeats, etc)
      return;
    }

    // Deduplicación
    const msgId = data.id || data.messageId;
    if (msgId) {
      if (this.processedMessageIds.has(msgId)) {
        return; // Ignorar duplicado silenciosamente
      }
      this.processedMessageIds.add(msgId);
      
      // Limpiar Set si crece mucho
      if (this.processedMessageIds.size > 1000) {
        this.processedMessageIds.clear();
      }
    }

    // Routing
    switch(data.type) {
      case 'eco':
      case 'confirmation':
        console.log('📨 Eco confirmado:', data.id);
        this.onEco?.(data);
        break;
      case 'message':
        this.onMessage?.(data);
        break;
      default:
        this.onMessage?.(data);
    }
  }

  /**
   * FIX CRÍTICO: Send que no rompe en offline, encola automáticamente
   */
  send(data) {
    // Siempre convertir a string si es objeto
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    
    // Si conectado, enviar inmediatamente
    if (this.isConnected()) {
      try {
        this.ws.send(payload);
        return true;
      } catch (err) {
        console.error('[WS] Error enviando, encolando:', err);
        this._queueMessage(payload);
        return false;
      }
    } else {
      // FIX: No rechazar promesa, solo encolar y loguear
      console.warn('[WS] Offline, mensaje encolado para envío posterior');
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
      attempts: 0
    });
    console.log(`[WS] Cola: ${this.messageQueue.length} mensajes pendientes`);
  }

  _flushQueue() {
    if (this.messageQueue.length === 0) return;
    
    console.log(`[WS] Enviando ${this.messageQueue.length} mensajes encolados...`);
    const queue = [...this.messageQueue];
    this.messageQueue = [];
    
    queue.forEach(item => {
      try {
        this.ws.send(item.payload);
      } catch (err) {
        // Si falla, re-encolar
        this._queueMessage(item.payload);
      }
    });
  }

  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, 30000); // Cada 30s
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Máximo de reintentos alcanzado');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WS] Reconectando en ${delay}ms...`);
    
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {}); // Silenciar error en reconnect
    }, delay);
  }

  disconnect() {
    this.intentionalClose = true;
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close();
    }
  }

  getStats() {
    return {
      connected: this.isConnected(),
      queueSize: this.messageQueue.length,
      reconnectAttempts: this.reconnectAttempts,
      processedMessages: this.processedMessageIds.size
    };
  }
}

export { WebSocketClient };
