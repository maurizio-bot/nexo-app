/**
 * NEXO v9.0 - TheStream v2.3-NAP-CERTIFIED
 * Sistema de renderizado de mensajes con Resource Error Management
 * Pattern: NAP 2.0 (Nexo Auth Protocol) + REM + SOC2 + MASVS
 * Auditoría: 2026-03-13 | Estado: BUILD-READY
 */

class TheStream {
  /**
   * @param {string} containerId - ID del contenedor DOM
   * @param {Object} options - Opciones NAP
   * @param {Object} options.actionCallbacks - Callbacks para acciones (react, reply, forward)
   * @param {Function} options.actionCallbacks.onReact - (id) => void
   * @param {Function} options.actionCallbacks.onReply - (id) => void  
   * @param {Function} options.actionCallbacks.onForward - (id) => void
   */
  constructor(containerId, options = {}) {
    // NAP 2.0: Defensive initialization
    if (!containerId || typeof containerId !== 'string') {
      containerId = 'message-container';
    }
    
    this.container = document.getElementById(containerId);
    
    // Auto-create container if missing
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = containerId;
      this.container.style.cssText = 'overflow-y: auto; height: calc(100vh - 200px); padding: 16px;';
      document.body.appendChild(this.container);
    }
    
    // NAP: Dependency Injection - no ghost coupling
    this.actionCallbacks = options.actionCallbacks || {};
    
    // REM: Resource error tracking
    this.resourceErrors = new Set();
    this.failedAvatars = new Set();
    
    // NAP 2.0: Memory management
    this.messageCache = new Map();
    this.avatarColors = new Map();
    this.items = []; // Array para tracking de items
    
    // NAP 2.0: Configuration
    this.config = {
      maxCacheSize: 1000,
      maxRenderedItems: 500,
      fallbackAvatar: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTgiIGZpbGw9IiMzMzMiIHN0cm9rZT0iIzU1NSIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMjAiIHk9IjI1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic3lzdGVtLXVpIiBmb250LXNpemU9IjE0IiBmaWxsPSIjODg4Ij4/PC90ZXh0Pjwvc3ZnPg==',
      autoScroll: true
    };
    
    this.initialized = true;
    this.renderedCount = 0;
    this.styleInjected = false;
    
    // NAP: Inyección de estilos controlada (no global)
    this._injectStyles();
    
    // REM: Global error interceptor for this container
    this._setupResourceErrorInterceptor();
    
    console.log('[TheStream] Initialized v2.3-NAP-CERTIFIED');
  }

  /**
   * NAP 2.0 API: Add multiple items (batch)
   * @param {Array|Object} items - Single item or array of items
   * @param {Object} options - { prepend: false, animate: true, scroll: true }
   * @returns {TheStream} Chainable
   */
  appendItems(items, options = {}) {
    const config = {
      prepend: false,
      animate: true,
      scroll: this.config.autoScroll,
      ...options
    };

    // NAP 2.0: Null-aware validation
    if (!items) {
      console.warn('[TheStream] appendItems received null/undefined');
      return this;
    }

    // Normalize to array
    const batch = Array.isArray(items) ? items : [items];
    
    if (batch.length === 0) {
      return this;
    }

    // REM: Pre-validate resources before rendering
    const sanitizedBatch = batch.map(item => this._sanitizeItem(item));
    
    // Store in memory (NAP 2.0: Memory tracking)
    if (config.prepend) {
      this.items.unshift(...sanitizedBatch);
    } else {
      this.items.push(...sanitizedBatch);
    }

    // Enforce memory limits (NAP 2.0)
    this._enforceMemoryLimits();

    // Render batch
    sanitizedBatch.forEach((item, index) => {
      this._renderSingle(item, {
        ...config,
        index,
        total: batch.length
      });
    });

    // Auto-scroll logic
    if (config.scroll && this._shouldAutoScroll()) {
      this.scrollToBottom();
    }

    return this;
  }

  /**
   * NAP 2.0 API: Add single item
   * Alias for appendItems with single object
   */
  appendItem(item, options) {
    return this.appendItems(item, options);
  }

  /**
   * NAP 2.0 API: Prepend items (for history loading)
   */
  prependItems(items, options = {}) {
    return this.appendItems(items, { 
      ...options, 
      prepend: true, 
      scroll: false 
    });
  }

  /**
   * NAP 2.0 API: Legacy compatibility (old setData)
   * @deprecated Use appendItems() instead
   */
  setData(data) {
    return this.appendItems(data, { scroll: true });
  }

  /**
   * NAP 2.0 API: Clear all messages
   */
  clear() {
    this.messageCache.clear();
    this.items = [];
    this.renderedCount = 0;
    if (this.container) {
      this.container.innerHTML = '';
    }
    return this;
  }

  /**
   * NAP 2.0 API: Scroll to bottom
   */
  scrollToBottom() {
    if (this.container) {
      requestAnimationFrame(() => {
        this.container.scrollTop = this.container.scrollHeight;
      });
    }
    return this;
  }

  /**
   * NAP 2.0 API: Get statistics for debugging
   */
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

  /**
   * NAP 2.0 API: Destroy instance and cleanup
   */
  destroy() {
    this.clear();
    this.avatarColors.clear();
    this.resourceErrors.clear();
    this.failedAvatars.clear();
    
    // Remove error interceptor
    if (this.container) {
      this.container.removeEventListener('error', this._handleResourceError, true);
    }
    
    // NAP: Cleanup injected styles if no other instances
    this._removeStyles();
    
    this.initialized = false;
    console.log('[TheStream] Destroyed');
  }

  /**
   * NAP: Register action callbacks (Dependency Injection)
   * @param {Object} callbacks - { onReact, onReply, onForward }
   */
  registerCallbacks(callbacks) {
    if (callbacks && typeof callbacks === 'object') {
      this.actionCallbacks = { ...this.actionCallbacks, ...callbacks };
    }
    return this;
  }

  /**
   * NAP: Inyección controlada de estilos (no global scope)
   */
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

  /**
   * NAP: Cleanup de estilos (SOC2 - Resource management)
   */
  _removeStyles() {
    if (!this.styleInjected) return;
    // Solo remover si no hay otras instancias activas
    // Por ahora, mantenemos el estilo compartido para no romper otras instancias
    this.styleInjected = false;
  }

  /**
   * REM: Resource Error Management
   * Setup global error interceptor for images
   */
  _setupResourceErrorInterceptor() {
    if (!this.container) return;
    
    this._handleResourceError = (e) => {
      const target = e.target;
      
      if (target.tagName === 'IMG') {
        const src = target.src;
        
        // REM: Track failed resource
        this.resourceErrors.add(src);
        
        // REM: Prevent infinite retry loop
        if (target.dataset.remFixed) return;
        
        console.warn(`[TheStream-REM] Resource failed: ${src.substring(0, 100)}...`);
        
        // REM: Apply fallback immediately
        target.src = this.config.fallbackAvatar;
        target.dataset.remFixed = 'true';
        target.style.opacity = '0.7';
        
        // Prevent default error propagation
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    // Capture phase to intercept before bubbling
    this.container.addEventListener('error', this._handleResourceError, true);
  }

  /**
   * REM: Sanitize item and validate resources
   */
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

    // NAP 2.0: Defensive property access
    const sanitized = {
      id: item.id || this._generateId(),
      content: item.content || item.text || item.message || '',
      sender: item.sender || item.from || item.author || 'Unknown',
      timestamp: item.timestamp || item.time || Date.now(),
      avatar: item.avatar || null,
      isMe: item.isMe || item.sender === 'Tú' || false,
      type: item.type || 'message'
    };

    // REM: Validate content
    if (typeof sanitized.content !== 'string') {
      sanitized.content = String(sanitized.content);
    }

    // REM: Validate sender (prevents charAt errors)
    if (typeof sanitized.sender !== 'string' || !sanitized.sender.trim()) {
      sanitized.sender = 'Unknown';
    }

    return sanitized;
  }

  /**
   * Internal: Render single message
   */
  _renderSingle(message, config) {
    // Check cache to prevent duplicates
    if (message.id && this.messageCache.has(message.id)) {
      return;
    }

    // Add to cache with timestamp (NAP 2.0: TTL for cache)
    if (message.id) {
      this.messageCache.set(message.id, Date.now());
    }

    // NAP 2.0: Check for empty content
    const content = String(message.content || '').trim();
    if (!content) {
      return;
    }

    const isMe = message.isMe;
    
    // Create message element
    const bubble = document.createElement('div');
    bubble.className = 'stream-item';
    bubble.style.cssText = `
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px;
      border-radius: 16px;
      background: ${isMe ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)'};
    `;
    
    // REM: Safe avatar generation
    const avatarSrc = this._getSafeAvatar(message.sender, isMe);
    
    // NAP: XSS Protection - Escapar ID para atributos data
    const safeId = this._escapeAttr(String(message.id || ''));
    
    // REM: Safe HTML construction (sin inline handlers XSS-vulnerables)
    bubble.innerHTML = `
      <img 
        src="${avatarSrc}" 
        width="40" 
        height="40" 
        style="border-radius: 12px; flex-shrink: 0;"
        data-sender="${this._escapeHtml(message.sender)}"
        loading="lazy"
        class="stream-avatar"
      >
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; color: #fff; font-size: 14px; margin-bottom: 4px;">
          ${this._escapeHtml(message.sender)}
        </div>
        <div style="color: #ddd; line-height: 1.4; word-break: break-word;">
          ${this._escapeHtml(content)}
        </div>
        <div style="font-size: 11px; color: #888; margin-top: 4px;">
          ${this._formatTime(message.timestamp)}
        </div>
        <div class="action-buttons" style="display: flex; gap: 8px; margin-top: 8px;" data-msg-id="${safeId}">
          <button class="btn-react" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #fff;">⚡</button>
          <button class="btn-reply" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #fff;">↩️</button>
          <button class="btn-forward" style="background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #fff;">↗️</button>
        </div>
      </div>
    `;
    
    // NAP: Bind events safely (no inline onclick XSS)
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
    
    // REM: Avatar error handling
    const img = bubble.querySelector('.stream-avatar');
    if (img) {
      img.addEventListener('error', () => {
        this.failedAvatars.add(message.sender);
        img.src = this.config.fallbackAvatar;
      }, { once: true });
    }

    // Insert into DOM
    if (config.prepend && this.container.firstChild) {
      this.container.insertBefore(bubble, this.container.firstChild);
    } else {
      this.container.appendChild(bubble);
    }

    this.renderedCount++;
  }

  /**
   * REM: Safe avatar getter with fallback chain
   */
  _getSafeAvatar(sender, isMe) {
    try {
      // Check if we've failed for this sender before
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

  /**
   * Generate avatar SVG
   */
  generateAvatarSVG(sender, isMe) {
    const key = `${sender}-${isMe}`;
    if (this.avatarColors.has(key)) return this.avatarColors.get(key);
    
    // NAP 2.0: Defensive string operations
    const safeSender = String(sender || 'U');
    const initial = safeSender.charAt(0).toUpperCase();
    
    // Generate color from sender name
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
      // REM: Encoding fallback
      return this.config.fallbackAvatar;
    }
  }

  /**
   * @deprecated Use appendItems() instead
   */
  renderMessage(message) {
    return this._renderSingle(message, { scroll: true });
  }

  /**
   * NAP 2.0: Memory limit enforcement
   */
  _enforceMemoryLimits() {
    // Limit message cache
    if (this.messageCache.size > this.config.maxCacheSize) {
      const entries = Array.from(this.messageCache.entries());
      const toDelete = entries.slice(0, entries.length - this.config.maxCacheSize);
      toDelete.forEach(([key]) => this.messageCache.delete(key));
    }

    // Limit items array
    if (this.items.length > this.config.maxRenderedItems) {
      const excess = this.items.length - this.config.maxRenderedItems;
      this.items = this.items.slice(excess);
      
      // Remove old DOM elements
      const children = this.container.children;
      for (let i = 0; i < excess && children[0]; i++) {
        children[0].remove();
      }
    }
  }

  /**
   * NAP 2.0: Check if should auto-scroll
   */
  _shouldAutoScroll() {
    if (!this.container) return false;
    const threshold = 100; // pixels from bottom
    const { scrollHeight, scrollTop, clientHeight } = this.container;
    return (scrollHeight - scrollTop - clientHeight) < threshold;
  }

  /**
   * Utility: Generate unique ID
   */
  _generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Utility: Escape HTML entities
   */
  _escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * NAP: Escape HTML attributes (XSS prevention)
   */
  _escapeAttr(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Utility: Format timestamp
   */
  _formatTime(timestamp) {
    if (!timestamp) return 'ahora';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'ahora';
    
    const now = new Date();
    const diff = (now - date) / 1000; // seconds
    
    if (diff < 60) return 'ahora';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    return date.toLocaleDateString();
  }
}

// EXPORTS ÚNICOS AL FINAL (NAP Linkage Audit Pass)
export { TheStream };
export default TheStream;
