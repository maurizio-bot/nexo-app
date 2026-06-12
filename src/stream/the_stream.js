/**
 * NEXO v9.0 - TheStream v2.4.1-NAP
 * FIX v2.4.1: Agregado updateMessage() para actualizar pending status sin duplicar
 *             Preview cards usan senderName si existe, evitando MAC cruda o "Unknown".
 *             Fallback a contacto activo o 'NEXO Peer' antes de mostrar deviceId.
 */

class TheStream {
  constructor(containerId, options = {}) {
    if (!containerId || typeof containerId !== 'string') {
      containerId = 'message-container';
    }

    this.container = document.getElementById(containerId);

    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = containerId;
      this.container.style.cssText = 'overflow-y: auto; height: calc(100vh - 200px); padding: 16px;';
      document.body.appendChild(this.container);
    }

    this.actionCallbacks = options.actionCallbacks || {};
    this.resourceErrors = new Set();
    this.failedAvatars = new Set();
    this.messageCache = new Map();
    this.avatarColors = new Map();
    this.items = [];

    this.config = {
      maxCacheSize: 1000,
      maxRenderedItems: 500,
      fallbackAvatar: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTgiIGZpbGw9IiMzMzMiIHN0cm9rZT0iIzU1NSIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMjAiIHk9IjI1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic3lzdGVtLXVpIiBmb250LXNpemU9IjE0IiBmaWxsPSIjODg4Ij4/PC90ZXh0Pjwvc3ZnPg==',
      autoScroll: true
    };

    this.initialized = true;
    this.renderedCount = 0;
    this.styleInjected = false;

    this._injectStyles();
    this._setupResourceErrorInterceptor();

    console.log('[TheStream] Initialized v2.4.1-NAP');
  }

  // FIX v2.4.1: Actualizar mensaje existente sin duplicar
  updateMessage(messageId, updates) {
    if (!messageId || !updates || typeof updates !== 'object') return this;

    // Actualizar en items array
    const itemIndex = this.items.findIndex(item => item.id === messageId || item.messageId === messageId);
    if (itemIndex >= 0) {
      this.items[itemIndex] = { ...this.items[itemIndex], ...updates };
    }

    // Actualizar en DOM si existe
    const bubbles = this.container.querySelectorAll('.stream-item');
    for (let i = 0; i < bubbles.length; i++) {
      const bubble = bubbles[i];
      const msgIdAttr = bubble.dataset.messageId;
      if (msgIdAttr === messageId) {
        // Actualizar estado pending si aplica
        if (updates.pending !== undefined) {
          const statusEl = bubble.querySelector('.message-status');
          if (statusEl) {
            statusEl.textContent = updates.pending ? '⏳ Enviando...' : '✓ Enviado';
            statusEl.style.color = updates.pending ? '#ffaa00' : '#00ff88';
          }
        }
        // Actualizar source si aplica
        if (updates.source !== undefined) {
          bubble.dataset.source = updates.source;
        }
        break;
      }
    }

    return this;
  }

  appendItems(items, options = {}) {
    const config = {
      prepend: false,
      animate: true,
      scroll: this.config.autoScroll,
      ...options
    };

    if (!items) {
      console.warn('[TheStream] appendItems received null/undefined');
      return this;
    }

    const batch = Array.isArray(items) ? items : [items];

    if (batch.length === 0) {
      return this;
    }

    const sanitizedBatch = batch.map(item => this._sanitizeItem(item));

    if (config.prepend) {
      this.items.unshift(...sanitizedBatch);
    } else {
      this.items.push(...sanitizedBatch);
    }

    this._enforceMemoryLimits();

    sanitizedBatch.forEach((item, index) => {
      this._renderSingle(item, {
        ...config,
        index,
        total: batch.length
      });
    });

    if (config.scroll && this._shouldAutoScroll()) {
      this.scrollToBottom();
    }

    return this;
  }

  appendItem(item, options) {
    return this.appendItems(item, options);
  }

  prependItems(items, options = {}) {
    return this.appendItems(items, { 
      ...options, 
      prepend: true, 
      scroll: false 
    });
  }

  setData(data) {
    return this.appendItems(data, { scroll: true });
  }

  clear() {
    this.messageCache.clear();
    this.items = [];
    this.renderedCount = 0;
    if (this.container) {
      this.container.innerHTML = '';
    }
    return this;
  }

  scrollToBottom() {
    if (this.container) {
      requestAnimationFrame(() => {
        this.container.scrollTop = this.container.scrollHeight;
      });
    }
    return this;
  }

  getStats() {
    return {
      itemsInMemory: this.items.length,
      renderedCount: this.renderedCount,
      cacheSize: this.messageCache.size,
      resourceErrors: this.resourceErrors.size,
      failedAvatars: this.failedAvatars.size,
      containerId: this.container?.id || 'unknown'
    };
  }

  destroy() {
    this.clear();
    this.avatarColors.clear();
    this.resourceErrors.clear();
    this.failedAvatars.clear();

    if (this.container) {
      this.container.removeEventListener('error', this._handleResourceError, true);
    }

    this._removeStyles();

    this.initialized = false;
    console.log('[TheStream] Destroyed');
  }

  registerCallbacks(callbacks) {
    if (callbacks && typeof callbacks === 'object') {
      this.actionCallbacks = { ...this.actionCallbacks, ...callbacks };
    }
    return this;
  }

  _injectStyles() {
    if (this.styleInjected || typeof document === 'undefined') return;

    const styleId = 'thestream-animations';
    let style = document.getElementById(styleId);

    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .stream-item { animation: fadeIn 0.3s ease-out; }
      `;
      document.head.appendChild(style);
    }

    this.styleInjected = true;
  }

  _removeStyles() {
    if (!this.styleInjected) return;
    this.styleInjected = false;
  }

  _setupResourceErrorInterceptor() {
    if (!this.container) return;

    this._handleResourceError = (e) => {
      const target = e.target;

      if (target.tagName === 'IMG') {
        const src = target.src;

        this.resourceErrors.add(src);

        if (target.dataset.remFixed) return;

        console.warn(`[TheStream-REM] Resource failed: ${src.substring(0, 100)}...`);

        target.src = this.config.fallbackAvatar;
        target.dataset.remFixed = 'true';
        target.style.opacity = '0.7';

        e.preventDefault();
        e.stopPropagation();
      }
    };

    this.container.addEventListener('error', this._handleResourceError, true);
  }

  _sanitizeItem(item) {
    if (!item || typeof item !== 'object') {
      return {
        id: this._generateId(),
        content: String(item || ''),
        sender: 'System',
        timestamp: Date.now(),
        type: 'text'
      };
    }

    const sanitized = {
      id: item.id || item.messageId || this._generateId(),
      messageId: item.messageId || item.id || this._generateId(),
      content: item.content || item.text || item.message || '',
      sender: item.sender || item.from || item.author || 'Unknown',
      senderName: item.senderName || item.sender || item.from || 'Unknown',
      timestamp: item.timestamp || item.time || Date.now(),
      avatar: item.avatar || null,
      isMe: item.isMe || item.sender === 'Tú' || item._own || false,
      pending: item.pending || false,
      type: item.type || 'message'
    };

    if (typeof sanitized.content !== 'string') {
      sanitized.content = String(sanitized.content);
    }

    if (typeof sanitized.sender !== 'string' || !sanitized.sender.trim()) {
      sanitized.sender = 'Unknown';
    }

    if (!sanitized.senderName || sanitized.senderName === 'Unknown' || !sanitized.senderName.trim() || /^[a-f0-9]{2}:/i.test(sanitized.senderName)) {
      const activeName = window.nexoApp?.activeContact?.name;
      sanitized.senderName = activeName || sanitized.senderName || 'NEXO Peer';
    }

    return sanitized;
  }

  _renderSingle(message, config) {
    if (message.id && this.messageCache.has(message.id)) {
      return;
    }

    if (message.id) {
      this.messageCache.set(message.id, Date.now());
    }

    const content = String(message.content || '').trim();
    if (!content) {
      return;
    }

    const isMe = message.isMe;
    const isPending = message.pending;

    const bubble = document.createElement('div');
    bubble.className = 'stream-item';
    bubble.dataset.messageId = message.messageId || message.id || '';
    bubble.dataset.source = message.source || 'unknown';
    bubble.style.cssText = `
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px;
      border-radius: 16px;
      background: ${isMe ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)'};
    `;

    const avatarSrc = this._getSafeAvatar(message.senderName || message.sender, isMe);

    const safeId = this._escapeAttr(String(message.id || ''));

    const displayName = message.senderName || message.sender || 'NEXO Peer';
    const statusText = isPending ? '⏳ Enviando...' : '✓ Enviado';
    const statusColor = isPending ? '#ffaa00' : '#00ff88';

    bubble.innerHTML = `
      <img 
        src="${avatarSrc}" 
        width="40" 
        height="40" 
        style="border-radius: 12px; flex-shrink: 0;"
        data-sender="${this._escapeHtml(displayName)}"
        loading="lazy"
        class="stream-avatar"
      >
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; color: #fff; font-size: 14px; margin-bottom: 4px;">
          ${this._escapeHtml(displayName)}
        </div>
        <div style="color: #ddd; line-height: 1.4; word-break: break-word;">
          ${this._escapeHtml(content)}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <span style="font-size: 11px; color: #888;">
            ${this._formatTime(message.timestamp)}
          </span>
          <span class="message-status" style="font-size: 11px; color: ${statusColor};">
            ${statusText}
          </span>
        </div>
        <div class="action-buttons" style="display: flex; gap: 8px; margin-top: 8px;" data-msg-id="${safeId}">
          <button class="btn-react" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #fff;">⚡</button>
          <button class="btn-reply" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #fff;">↩️</button>
          <button class="btn-forward" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #fff;">↗️</button>
        </div>
      </div>
    `;

    const btnContainer = bubble.querySelector('.action-buttons');
    if (btnContainer) {
      const msgId = btnContainer.dataset.msgId;

      const btnReact = btnContainer.querySelector('.btn-react');
      const btnReply = btnContainer.querySelector('.btn-reply');
      const btnForward = btnContainer.querySelector('.btn-forward');

      if (btnReact) {
        btnReact.addEventListener('click', () => {
          this.actionCallbacks.onReact?.(msgId);
        });
      }
      if (btnReply) {
        btnReply.addEventListener('click', () => {
          this.actionCallbacks.onReply?.(msgId);
        });
      }
      if (btnForward) {
        btnForward.addEventListener('click', () => {
          this.actionCallbacks.onForward?.(msgId);
        });
      }
    }

    const img = bubble.querySelector('.stream-avatar');
    if (img) {
      img.addEventListener('error', () => {
        this.failedAvatars.add(message.sender);
        img.src = this.config.fallbackAvatar;
      }, { once: true });
    }

    if (config.prepend && this.container.firstChild) {
      this.container.insertBefore(bubble, this.container.firstChild);
    } else {
      this.container.appendChild(bubble);
    }

    this.renderedCount++;
  }

  _getSafeAvatar(sender, isMe) {
    try {
      if (this.failedAvatars.has(sender)) {
        return this.config.fallbackAvatar;
      }

      return this.generateAvatarSVG(sender, isMe);
    } catch (e) {
      console.warn('[TheStream-REM] Avatar generation failed:', e);
      this.failedAvatars.add(sender);
      return this.config.fallbackAvatar;
    }
  }

  generateAvatarSVG(sender, isMe) {
    const key = `${sender}-${isMe}`;
    if (this.avatarColors.has(key)) return this.avatarColors.get(key);

    const safeSender = String(sender || 'U');
    const initial = safeSender.charAt(0).toUpperCase();

    const hash = safeSender.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const color = isMe 
      ? '#00FF88' 
      : `hsl(${hash % 360}, 70%, 50%)`;

    const svg = `<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="12" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2"/>
      <text x="20" y="27" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="${color}">${initial}</text>
    </svg>`;

    try {
      const uri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      this.avatarColors.set(key, uri);
      return uri;
    } catch (e) {
      return this.config.fallbackAvatar;
    }
  }

  renderMessage(message) {
    return this._renderSingle(message, { scroll: true });
  }

  _enforceMemoryLimits() {
    if (this.messageCache.size > this.config.maxCacheSize) {
      const entries = Array.from(this.messageCache.entries());
      const toDelete = entries.slice(0, entries.length - this.config.maxCacheSize);
      toDelete.forEach(([key]) => this.messageCache.delete(key));
    }

    if (this.items.length > this.config.maxRenderedItems) {
      const excess = this.items.length - this.config.maxRenderedItems;
      this.items = this.items.slice(excess);

      const children = this.container.children;
      for (let i = 0; i < excess && children[0]; i++) {
        children[0].remove();
      }
    }
  }

  _shouldAutoScroll() {
    if (!this.container) return false;
    const threshold = 100;
    const { scrollHeight, scrollTop, clientHeight } = this.container;
    return (scrollHeight - scrollTop - clientHeight) < threshold;
  }

  _generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  _escapeAttr(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _formatTime(timestamp) {
    if (!timestamp) return 'ahora';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'ahora';

    const now = new Date();
    const diff = (now - date) / 1000;

    if (diff < 60) return 'ahora';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    return date.toLocaleDateString();
  }
}

export { TheStream };
export default TheStream;
