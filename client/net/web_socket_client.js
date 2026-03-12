/**
 * WebSocketClient v2.4-NAP-DEDUP
 * Fix: Sistema anti-duplicación de mensajes/ecos
 */
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.processedMessageIds = new Set(); // Set para deduplicación
    this.messageHistory = new Map(); // Map con timestamp para TTL
    this.maxHistory = 200;
    this.ttlMs = 60000; // 1 minuto TTL
  }

  _onMessage(event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.warn('[WS] Mensaje no JSON ignorado');
      return;
    }

    // DEDUPLICACIÓN GLOBAL: Verificar si ya procesamos este ID
    if (data.id || data.messageId) {
      const msgId = data.id || data.messageId;
      
      if (this.processedMessageIds.has(msgId)) {
        // Silencioso en producción, log solo en debug
        if (this.debug) {
          console.log(`[WS] Duplicado ignorado: ${msgId}`);
        }
        return; // Ignorar completamente el duplicado
      }
      
      // Agregar a historial con timestamp
      this.processedMessageIds.add(msgId);
      this.messageHistory.set(msgId, Date.now());
      
      // Limpiar historial antiguo si excede tamaño
      if (this.processedMessageIds.size > this.maxHistory) {
        this._cleanupOldMessages();
      }
    }

    // Procesar según tipo
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
        this.onData?.(data);
    }
  }

  _cleanupOldMessages() {
    const now = Date.now();
    const toDelete = [];
    
    // Encontrar entradas viejas
    for (const [id, timestamp] of this.messageHistory.entries()) {
      if (now - timestamp > this.ttlMs) {
        toDelete.push(id);
      }
    }
    
    // Eliminar
    toDelete.forEach(id => {
      this.processedMessageIds.delete(id);
      this.messageHistory.delete(id);
    });
    
    console.log(`[WS] Cleanup: ${toDelete.length} mensajes antiguos removidos`);
  }

  // Resto de métodos existentes (connect, disconnect, send, etc.) se mantienen igual
}

export { WebSocketClient };
