/**
 * TheStream v2.3-NAP-AVATARFIX
 * Sistema de renderizado de mensajes con avatar inline
 */
class TheStream {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.messageCache = new Map(); // Previene duplicados de renderizado
    this.avatarColors = new Map(); // Cache de colores por usuario
    this.init();
  }

  init() {
    if (!this.container) {
      console.error('[TheStream] Container no encontrado:', containerId);
      return;
    }
    console.log('✅ TheStream initialized');
  }

  /**
   * Genera avatar SVG inline - Reemplaza las URLs rotas de localhost
   */
  generateAvatarSVG(sender, isMe) {
    const initial = (sender || 'U').charAt(0).toUpperCase();
    let color;
    
    if (isMe) {
      color = '#00FF88'; // Verde NEXO para el usuario
    } else {
      // Color determinista por nombre de usuario
      if (!this.avatarColors.has(sender)) {
        const hue = sender.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
        color = `hsl(${hue}, 70%, 50%)`;
        this.avatarColors.set(sender, color);
      } else {
        color = this.avatarColors.get(sender);
      }
    }
    
    // SVG inline base64 - No requiere localhost ni archivos externos
    const svg = `
      <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="12" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2"/>
        <text x="20" y="27" text-anchor="middle" font-family="system-ui" font-size="18" font-weight="600" fill="${color}">
          ${initial}
        </text>
      </svg>
    `;
    
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  /**
   * Renderiza mensaje - CORREGIDO: Valida contenido vacío y evita duplicados
   */
  renderMessage(message) {
    // DEDUPLICACIÓN: No renderizar el mismo ID dos veces
    if (this.messageCache.has(message.id)) {
      console.warn(`[TheStream] Mensaje duplicado ignorado: ${message.id}`);
      return;
    }
    this.messageCache.set(message.id, Date.now());
    
    // Limpieza de cache antigua (evitar memory leak)
    if (this.messageCache.size > 100) {
      const oldest = Array.from(this.messageCache.entries())[0];
      this.messageCache.delete(oldest[0]);
    }

    // VALIDACIÓN: No renderizar mensajes vacíos
    if (!message.content || message.content.trim() === '') {
      console.warn('[TheStream] Mensaje vacío ignorado de:', message.sender);
      return;
    }

    const isMe = message.sender === 'Tú' || message.sender === 'me';
    const avatarSrc = this.generateAvatarSVG(message.sender, isMe);
    
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMe ? 'message-me' : 'message-other'}`;
    bubble.dataset.messageId = message.id;
    
    // HTML corregido - Sin referencias a localhost
    bubble.innerHTML = `
      <div class="message-avatar">
        <img src="${avatarSrc}" alt="${message.sender}" width="40" height="40" style="border-radius: 12px;">
      </div>
      <div class="message-content">
        <div class="message-sender">${message.sender || 'Unknown'}</div>
        <div class="message-text">${this.escapeHtml(message.content)}</div>
        <div class="message-meta">ahora</div>
        <div class="message-actions">
          <button class="action-btn" data-action="react">⚡</button>
          <button class="action-btn" data-action="reply">↩️</button>
          <button class="action-btn" data-action="forward">↗️</button>
        </div>
      </div>
    `;
    
    this.container.appendChild(bubble);
    this.scrollToBottom();
    
    // Confirmación de eco solo si no es duplicado
    this.confirmEco(message.id);
  }

  confirmEco(messageId) {
    // Envía confirmación al WebSocket sin duplicar
    if (window.nexoApp && window.nexoApp.wsClient) {
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
    this.container.scrollTop = this.container.scrollHeight;
  }

  clear() {
    this.container.innerHTML = '';
    this.messageCache.clear();
  }
}

export { TheStream };
