/**
 * TheStream v2.4-NAP-REM
 * Sistema de renderizado de mensajes - Release Milestone
 * FIX: Manejo defensivo de containerId, recuperación ante fallos, avatares inline
 */
class TheStream {
  constructor(containerId) {
    // FIX CRÍTICO: Validación defensiva del contenedor
    if (!containerId || typeof containerId !== 'string') {
      console.warn('[TheStream] containerId no proporcionado, usando default "message-container"');
      containerId = 'message-container';
    }
    
    this.container = document.getElementById(containerId);
    
    // FIX CRÍTICO: Si no existe el contenedor, crearlo dinámicamente
    if (!this.container) {
      console.warn(`[TheStream] Contenedor #${containerId} no encontrado en DOM, creando...`);
      this.container = document.createElement('div');
      this.container.id = containerId;
      this.container.style.cssText = 'overflow-y: auto; height: calc(100vh - 200px); padding: 16px;';
      
      // Insertar antes del input de mensaje si existe
      const inputContainer = document.querySelector('.input-container') || document.getElementById('input-area');
      if (inputContainer && inputContainer.parentNode) {
        inputContainer.parentNode.insertBefore(this.container, inputContainer);
      } else {
        document.body.appendChild(this.container);
      }
    }
    
    this.messageCache = new Map(); // Deduplicación por ID
    this.avatarColors = new Map(); // Cache de colores por usuario
    this.maxCacheSize = 500;
    this.initialized = true;
    
    console.log('✅ TheStream v2.4-NAP-REM initialized correctly');
  }

  /**
   * Genera avatar SVG inline - Reemplaza URLs rotas de localhost
   */
  generateAvatarSVG(sender, isMe) {
    const key = `${sender}-${isMe}`;
    if (this.avatarColors.has(key)) {
      return this.avatarColors.get(key);
    }
    
    const initial = (sender || 'U').charAt(0).toUpperCase();
    let color;
    
    if (isMe) {
      color = '#00FF88'; // Verde NEXO
    } else {
      // Color determinista por hash del nombre
      const hue = sender.split('').reduce((acc, char) => {
        return acc + char.charCodeAt(0);
      }, 0) % 360;
      color = `hsl(${hue}, 70%, 50%)`;
    }
    
    const svg = `<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="12" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2"/>
      <text x="20" y="27" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="${color}">${initial}</text>
    </svg>`;
    
    const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    this.avatarColors.set(key, dataUri);
    return dataUri;
  }

  /**
   * Renderiza mensaje con validación completa
   */
  renderMessage(message) {
    if (!this.initialized || !this.container) {
      console.error('[TheStream] No inicializado correctamente, no se puede renderizar');
      return;
    }

    // Deduplicación estricta
    if (message.id && this.messageCache.has(message.id)) {
      return; // Silencioso para no llenar logs
    }
    
    if (message.id) {
      this.messageCache.set(message.id, Date.now());
      this._cleanupCache();
    }

    // Validación de contenido
    if (!message.content || String(message.content).trim() === '') {
      console.warn('[TheStream] Mensaje vacío ignorado');
      return;
    }

    const isMe = message.sender === 'Tú' || message.sender === 'me' || message.isMe;
    const avatarSrc = this.generateAvatarSVG(message.sender, isMe);
    const content = this.escapeHtml(String(message.content));
    
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMe ? 'message-me' : 'message-other'}`;
    bubble.dataset.messageId = message.id || Date.now();
    bubble.style.cssText = `
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px;
      border-radius: 16px;
      background: ${isMe ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255,255,255,0.05)'};
      animation: fadeIn 0.3s ease;
    `;
    
    bubble.innerHTML = `
      <div class="message-avatar" style="flex-shrink: 0;">
        <img src="${avatarSrc}" alt="${message.sender}" width="40" height="40" style="border-radius: 12px; display: block;">
      </div>
      <div class="message-content" style="flex: 1; min-width: 0;">
        <div class="message-sender" style="font-weight: 600; color: #fff; margin-bottom: 4px; font-size: 14px;">${message.sender || 'Unknown'}</div>
        <div class="message-text" style="color: #ddd; line-height: 1.4; word-wrap: break-word;">${content}</div>
        <div class="message-meta" style="font-size: 11px; color: #888; margin-top: 4px;">ahora</div>
        <div class="message-actions" style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="action-btn" data-action="react" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer;">⚡</button>
          <button class="action-btn" data-action="reply" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer;">↩️</button>
          <button class="action-btn" data-action="forward" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer;">↗️</button>
        </div>
      </div>
    `;
    
    this.container.appendChild(bubble);
    this.scrollToBottom();
    
    // Confirmar eco si aplica
    if (message.id && window.nexoApp?.wsClient) {
      this.confirmEco(message.id);
    }
  }

  _cleanupCache() {
    if (this.messageCache.size > this.maxCacheSize) {
      const oldest = Array.from(this.messageCache.entries())[0];
      this.messageCache.delete(oldest[0]);
    }
  }

  confirmEco(messageId) {
    if (window.nexoApp?.wsClient?.isConnected?.()) {
      window.nexoApp.wsClient.send({
        type: 'eco',
        id: messageId,
        timestamp: Date.now()
      });
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  scrollToBottom() {
    if (this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  clear() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.messageCache.clear();
  }
}

export { TheStream };
