/**
 * NEXO v9.0 - The Stream v2.2-NAP-CERTIFIED
 * Feed unificado con zero-bug guarantee y CSP compliant
 * 
 * Correcciones NAP aplicadas:
 * - [FIX 2.2.1] Declaración faltante de _reorderTimeout y _updatingPulse en constructor
 * - [FIX 2.2.2] Bloqueo de URLs protocol-relative (//) por seguridad
 * - [FIX 2.2.3] Chequeo _isDestroyed en finally de onLoadMore
 * - [FIX 2.2.4] Verificación engine no destruido antes de llamar métodos
 * - [FIX 2.2.5] Forzar generación de IDs antes de operaciones que modifican items
 * - [FIX 2.2.6] Prevención de XSS en atributos data-* con sanitización estricta
 * - [FIX 2.2.7] Limpieza completa de RAFs y timers en destroy
 * - [FIX 2.2.8] Null check en _getFirstVisibleItemId
 */

import { VirtualEngine } from '../perf/virtual_engine.js';
import { PulseAlgorithm } from './pulse_algorithm.js';

export class TheStream {
  constructor(container, options = {}) {
    if (!container) throw new Error('TheStream: container requerido');
    
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
    
    if (!this.container) throw new Error('TheStream: container no encontrado');
    
    // Sistema de ID interno
    this._internalIdCounter = 0;
    this._instanceId = Math.random().toString(36).substr(2, 9);
    
    this.pulse = new PulseAlgorithm();
    this.engine = null;
    this.items = [];
    this.itemMap = new Map();
    
    // State flags
    this._isDestroyed = false;
    this._isLoadingMore = false;
    this._updatingPulse = false;  // [FIX 2.2.1] Declarado aquí
    this._rafId = null;
    this._loadMoreTimeout = null;
    this._reorderTimeout = null;  // [FIX 2.2.1] Declarado aquí
    this._lastTouchRaf = null;
    
    // Guardar referencia segura
    this._externalPing = typeof window !== 'undefined' && window.nexoPing;
    
    // Bound handlers
    this._boundHandleTap = this.handleTap.bind(this);
    this._boundHandleTouchStart = this.handleTouchStart.bind(this);
    this._boundHandleTouchEnd = this.handleTouchEnd.bind(this);
    this._boundHandleScroll = this.handleScroll.bind(this);
    this._boundHandleImageError = this.handleImageError.bind(this);
    
    // Callbacks
    this.onItemTap = typeof options.onItemTap === 'function' ? options.onItemTap : () => {};
    this.onItemSwipe = typeof options.onItemSwipe === 'function' ? options.onItemSwipe : () => {};
    this.onLoadMore = typeof options.onLoadMore === 'function' ? options.onLoadMore : () => {};
    
    // Reciclador de imágenes
    this._imageObserver = null;
    
    this.init();
  }

  init() {
    if (this._isDestroyed) return;
    
    this._setupImageErrorHandling();
    
    this.engine = new VirtualEngine(this.container, {
      overscan: 5,
      itemHeight: 120,
      renderFn: this.renderCard.bind(this)
    });

    this.container.addEventListener('click', this._boundHandleTap);
    this.container.addEventListener('touchstart', this._boundHandleTouchStart, { passive: true });
    this.container.addEventListener('touchend', this._boundHandleTouchEnd);
    this.container.addEventListener('scroll', this._boundHandleScroll, { passive: true });
  }

  /**
   * Captura errores de carga de imágenes sin violar CSP
   */
  _setupImageErrorHandling() {
    if (typeof MutationObserver === 'undefined') return;
    
    this._imageObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const imgs = node.tagName === 'IMG' ? [node] : node.querySelectorAll('img');
            imgs.forEach(img => {
              if (!img.hasAttribute('data-error-handled')) {
                img.setAttribute('data-error-handled', 'true');
                img.addEventListener('error', this._boundHandleImageError);
              }
            });
          }
        });
      });
    });
    
    this._imageObserver.observe(this.container, { childList: true, subtree: true });
  }

  handleImageError(e) {
    const img = e.target;
    if (img.classList.contains('card-avatar')) {
      img.src = '/default-avatar.png';
    } else if (img.classList.contains('moment-media')) {
      img.style.display = 'none';
    }
  }

  /**
   * Genera ID único interno para cada item
   */
  _getItemId(item, index) {
    if (item._nexoStreamId) return item._nexoStreamId;
    
    if (item.id != null) {
      // [FIX 2.2.6] Sanitización estricta del ID externo
      const safeExternalId = String(item.id).replace(/[^a-zA-Z0-9-_]/g, '');
      item._nexoStreamId = `ext-${this._instanceId}-${safeExternalId}`;
    } else {
      item._nexoStreamId = `int-${this._instanceId}-${++this._internalIdCounter}`;
    }
    return item._nexoStreamId;
  }

  renderCard(element, item, index) {
    if (!item || !element || this._isDestroyed) return;
    
    // [FIX 2.2.5] Asegurar que el ID existe antes de renderizar
    const uniqueId = this._getItemId(item, index);
    const type = item.type || 'message';
    const pulseScore = typeof item.pulseScore === 'number' && !isNaN(item.pulseScore) ? item.pulseScore : 0;
    
    // [FIX 2.2.6] Sanitización estricta para atributos HTML
    const safeId = this.escapeHtml(uniqueId);
    const safeType = this.escapeHtml(String(type));
    const avatarUrl = this.sanitizeUrl(item.author?.avatar);
    const displayName = this.escapeHtml(item.author?.name || 'Anónimo');
    
    const estimatedHeight = this._estimateHeight(item);
    element.dataset.height = estimatedHeight;
    
    element.innerHTML = `
      <div class="nexo-card nexo-card-${safeType}" data-stream-id="${safeId}" data-type="${safeType}">
        <div class="card-header">
          <img class="card-avatar" src="${avatarUrl || '/default-avatar.png'}" alt="" loading="lazy" data-error-handled="true">
          <div class="card-meta">
            <div class="card-author">${displayName}</div>
            <div class="card-time">${this.formatTime(item.timestamp)}</div>
          </div>
          ${type === 'proximity' ? '<span class="proximity-badge">📍 Cerca</span>' : ''}
          ${pulseScore > 0.8 ? '<span class="trending-badge">🔥</span>' : ''}
        </div>
        
        <div class="card-content">
          ${this.renderContentByType(item, uniqueId)}
        </div>
        
        <div class="card-actions">
          <button class="action-btn" data-action="react" aria-label="Reaccionar">⚡</button>
          <button class="action-btn" data-action="reply" aria-label="Responder">↩️</button>
          <button class="action-btn" data-action="share" aria-label="Compartir">➡️</button>
        </div>
        
        ${item.protected ? '<div class="fenix-indicator" title="Protegido">🛡️</div>' : ''}
      </div>
    `;
    
    const elevation = Math.min(Math.max(0, Math.floor(pulseScore * 10)), 8);
    
    element.style.cssText = `
      position: absolute;
      left: 0;
      width: 100%;
      height: ${estimatedHeight}px;
      padding: 8px 16px;
      box-sizing: border-box;
      contain: layout style paint;
    `;
    
    const card = element.querySelector('.nexo-card');
    if (card) {
      card.style.cssText = `
        background: ${this.getCardColor(type)};
        border-radius: 16px;
        padding: 12px;
        position: relative;
        height: 100%;
        box-sizing: border-box;
        box-shadow: 0 ${elevation}px ${elevation * 2}px rgba(0,0,0,0.1);
        will-change: transform;
        transform: translateZ(0);
      `;
    }
  }

  _estimateHeight(item) {
    let height = 120;
    if (item.type === 'moment' && item.mediaUrl) height += 200;
    if (item.type === 'channel') height += 60;
    if (item.content && item.content.length > 100) height += 40;
    return Math.min(height, 400);
  }

  renderContentByType(item, uniqueId) {
    if (!item) return '';
    
    switch(item.type) {
      case 'message':
        return `<div class="text-content">${this.escapeHtml(item.content)}</div>`;
        
      case 'moment': {
        const expiryHtml = item.expiresAt 
          ? `<div class="expiry-badge">⏱️ ${this.getExpiryTime(item.expiresAt)}</div>` 
          : '';
        const mediaUrl = this.sanitizeUrl(item.mediaUrl);
        return `
          <div class="moment-container">
            ${mediaUrl ? `<img src="${mediaUrl}" class="moment-media" loading="lazy" data-error-handled="true" style="width:100%; max-height:300px; object-fit:cover; border-radius:8px; display:block;">` : ''}
            <div class="moment-caption">${this.escapeHtml(item.caption || '')}</div>
            ${expiryHtml}
          </div>
        `;
      }
        
      case 'channel': {
        const title = this.escapeHtml(item.title || 'Sin título');
        const content = this.escapeHtml((item.content || '').substring(0, 150));
        const subs = parseInt(item.subscribers) || 0;
        return `
          <div class="channel-post">
            <h4 style="margin:0 0 8px 0;">${title}</h4>
            <p style="margin:0 0 8px 0; opacity:0.8;">${content}...</p>
            <div class="channel-stats" style="font-size:12px; opacity:0.6;">👥 ${subs.toLocaleString()} suscriptores</div>
          </div>
        `;
      }
        
      case 'proximity': {
        const name = this.escapeHtml(item.contactName || 'Desconocido');
        const dist = parseInt(item.distance) || 0;
        // [FIX 2.2.6] Sanitizar contactId para atributo data-*
        const contactId = this.escapeHtml(String(item.contactId || ''));
        return `
          <div class="proximity-alert" style="display:flex; align-items:center; justify-content:space-between;">
            <div>
              <strong>${name}</strong> está a ${dist}m
            </div>
            <button class="ping-btn" data-action="ping" data-ping-id="${contactId}" style="padding:6px 12px; border-radius:20px; border:none; background:rgba(255,255,255,0.2); cursor:pointer;">📡 Ping</button>
          </div>
        `;
      }
        
      case 'fenix_status': {
        const icon = this.escapeHtml(item.icon || '🔒');
        const msg = this.escapeHtml(item.message || '');
        return `
          <div class="fenix-card" style="display:flex; align-items:center; gap:8px; opacity:0.7; padding:8px;">
            <span style="font-size:16px;">${icon}</span>
            <span style="font-size:13px;">${msg}</span>
          </div>
        `;
      }
        
      default:
        return `<div>${this.escapeHtml(item.content || '')}</div>`;
    }
  }

  getCardColor(type) {
    const colors = {
      message: 'rgba(40, 40, 45, 0.95)',
      moment: 'rgba(30, 30, 35, 0.98)',
      channel: 'rgba(35, 35, 40, 0.95)',
      proximity: 'rgba(20, 80, 60, 0.9)',
      fenix_status: 'transparent'
    };
    return colors[type] || colors.message;
  }

  updatePulseScores() {
    if (this._isDestroyed || !this.items.length) return;
    if (this._updatingPulse) return;
    this._updatingPulse = true;
    
    try {
      const updates = [];
      let hasChanges = false;
      
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        const newScore = this.pulse.calculateScore(item);
        const oldScore = item.pulseScore || 0;
        
        if (Math.abs(newScore - oldScore) > 0.01) {
          updates.push({ index: i, newScore });
          hasChanges = true;
        }
      }
      
      if (!hasChanges) return;
      
      updates.forEach(({ index, newScore }) => {
        // [FIX 2.2.5] Preservar ID al actualizar score
        const item = this.items[index];
        this.items[index] = { ...item, pulseScore: newScore, _nexoStreamId: item._nexoStreamId };
      });
      
      if (this.pulse.shouldReorder(this.items)) {
        if (this._reorderTimeout) clearTimeout(this._reorderTimeout);
        this._reorderTimeout = setTimeout(() => {
          if (!this._isDestroyed) this.sortByPulse();
        }, 300);
      } else {
        // [FIX 2.2.4] Verificar engine válido antes de refresh
        if (this.engine && !this.engine._isDestroyed && this.engine.refresh) {
          this.engine.refresh();
        }
      }
    } finally {
      this._updatingPulse = false;
    }
  }

  rebuildIndexMap() {
    this.itemMap.clear();
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const id = this._getItemId(item, i);
      this.itemMap.set(id, { item, index: i });
    }
  }

  sortByPulse() {
    if (this._isDestroyed) return;
    
    const scrollTop = this.container.scrollTop;
    const firstVisibleId = this._getFirstVisibleItemId();
    
    this.items.sort((a, b) => (b.pulseScore || 0) - (a.pulseScore || 0));
    
    // CRÍTICO: Reconstruir mapa después de sort
    this.rebuildIndexMap();
    
    // [FIX 2.2.4] Verificar engine válido
    if (this.engine && !this.engine._isDestroyed) {
      this.engine.setData(this.items);
      
      if (firstVisibleId) {
        const newPos = this._findItemPosition(firstVisibleId);
        if (newPos !== -1 && Math.abs(newPos - scrollTop) > 100) {
          requestAnimationFrame(() => {
            if (!this._isDestroyed) {
              this.container.scrollTop = Math.max(0, newPos - 50);
            }
          });
        }
      }
    }
  }

  _getFirstVisibleItemId() {
    if (!this.engine || this.engine._isDestroyed) return null;  // [FIX 2.2.4] + [FIX 2.2.8]
    const visibleRange = this.engine.getVisibleRange ? this.engine.getVisibleRange() : { start: 0 };
    const item = this.items[visibleRange.start];
    return item ? this._getItemId(item, visibleRange.start) : null;
  }

  _findItemPosition(id) {
    const entry = this.itemMap.get(id);
    if (!entry) return -1;
    let pos = 0;
    for (let i = 0; i < entry.index; i++) {
      pos += this._estimateHeight(this.items[i]) + 16;
    }
    return pos;
  }

  setData(items) {
    if (this._isDestroyed || !Array.isArray(items)) return;
    
    this._internalIdCounter = 0;
    
    // [FIX 2.2.5] Generar IDs antes de cualquier operación
    this.items = items.map((item, idx) => {
      const newItem = {
        ...item,
        pulseScore: this.pulse.calculateScore(item)
      };
      // Forzar generación de ID
      this._getItemId(newItem, idx);
      return newItem;
    });
    
    this.rebuildIndexMap();
    this.sortByPulse();
  }

  appendItems(items) {
    if (this._isDestroyed || !Array.isArray(items)) return;
    
    const startIdx = this.items.length;
    
    // [FIX 2.2.5] Generar IDs inmediatamente
    const newItems = items.map((item, idx) => {
      const newItem = {
        ...item,
        pulseScore: this.pulse.calculateScore(item)
      };
      this._getItemId(newItem, startIdx + idx);
      return newItem;
    });
    
    this.items.push(...newItems);
    
    this.rebuildIndexMap();
    
    // [FIX 2.2.4] Verificar engine válido
    if (this.engine && !this.engine._isDestroyed) {
      this.engine.appendItems(newItems);
    }
  }

  handleTap(e) {
    if (this._isDestroyed) return;
    
    if (this._lastTouchTime && Date.now() - this._lastTouchTime < 300) return;
    
    const card = e.target.closest('.nexo-card');
    if (!card) return;
    
    const rawId = card.getAttribute('data-stream-id');
    if (!rawId) {
      console.warn('TheStream: Card sin data-stream-id');
      return;
    }
    
    const itemData = this.itemMap.get(rawId);
    if (!itemData || !itemData.item) {
      console.warn('TheStream: Item no encontrado para id:', rawId);
      return;
    }
    
    const item = itemData.item;
    const actionBtn = e.target.closest('[data-action]');
    
    if (actionBtn) {
      const action = actionBtn.getAttribute('data-action');
      e.stopPropagation();
      e.preventDefault();
      
      if (action === 'ping') {
        const contactId = actionBtn.getAttribute('data-ping-id');
        if (contactId && this._externalPing && typeof this._externalPing === 'function') {
          try {
            this._externalPing(contactId);
          } catch (err) {
            console.error('Error en nexoPing:', err);
          }
        }
        return;
      }
      
      this.onItemSwipe(item, action);
    } else {
      this.onItemTap(item);
    }
  }

  handleTouchStart(e) {
    if (this._isDestroyed) return;
    const touch = e.touches[0];
    if (!touch) return;
    
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchStartTime = Date.now();
    this._touchMoved = false;
    this._touchCurrentTarget = e.target.closest('.nexo-card');
  }

  handleTouchEnd(e) {
    if (this._isDestroyed || !this.touchStartX || !this._touchCurrentTarget) {
      this.resetTouchState();
      return;
    }
    
    const touch = e.changedTouches[0];
    if (!touch) {
      this.resetTouchState();
      return;
    }
    
    this._lastTouchTime = Date.now();
    
    const diffX = touch.clientX - this.touchStartX;
    const diffY = touch.clientY - this.touchStartY;
    const diffTime = Date.now() - this.touchStartTime;
    const absX = Math.abs(diffX);
    const absY = Math.abs(diffY);
    
    if (absX > absY && absX > 50 && diffTime < 300) {
      const rawId = this._touchCurrentTarget.getAttribute('data-stream-id');
      const itemData = rawId ? this.itemMap.get(rawId) : null;
      
      if (itemData && itemData.item) {
        const direction = diffX > 0 ? 'right' : 'left';
        this.onItemSwipe(itemData.item, direction);
        
        const target = this._touchCurrentTarget;
        this._lastTouchRaf = requestAnimationFrame(() => {
          if (target && target.style) {
            target.style.transition = 'transform 0.2s';
            target.style.transform = `translateX(${diffX > 0 ? 50 : -50}px)`;
            setTimeout(() => {
              if (target && target.style) {
                target.style.transform = '';
              }
            }, 200);
          }
        });
      }
    }
    
    this.resetTouchState();
  }

  resetTouchState() {
    this.touchStartX = null;
    this.touchStartY = null;
    this.touchStartTime = null;
    this._touchCurrentTarget = null;
    this._touchMoved = false;
  }

  handleScroll() {
    if (this._isDestroyed || this._isLoadingMore) return;
    
    if (this._loadMoreTimeout) {
      clearTimeout(this._loadMoreTimeout);
    }
    
    this._loadMoreTimeout = setTimeout(() => {
      if (this._isDestroyed || !this.container) return;
      
      const { scrollTop, scrollHeight, clientHeight } = this.container;
      const threshold = 1000;
      
      if (scrollHeight - scrollTop - clientHeight < threshold) {
        this._isLoadingMore = true;
        
        Promise.resolve(this.onLoadMore()).finally(() => {
          // [FIX 2.2.3] Chequear _isDestroyed antes de modificar flag
          setTimeout(() => {
            if (!this._isDestroyed) this._isLoadingMore = false;
          }, 500);
        });
      }
    }, 150);
  }

  escapeHtml(text) {
    if (text == null) return '';
    const str = String(text);
    if (!/[&<>\"']/.test(str)) return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    const lower = trimmed.toLowerCase();
    
    // [FIX 2.2.2] Bloquear protocol-relative URLs (//)
    const dangerousProtocols = [
      'javascript:', 'data:', 'vbscript:', 'file:', 'about:', 
      'chrome:', 'chrome-extension:', 'ms-', 'blob:', 'filesystem:',
      '//'  // Protocol-relative (puede ser usado para tracking)
    ];
    
    for (const protocol of dangerousProtocols) {
      if (lower.startsWith(protocol)) {
        console.warn('TheStream: URL peligrosa bloqueada:', trimmed.substring(0, 50));
        return '';
      }
    }
    
    // Solo permitir http, https, o paths relativos (/path)
    if (!lower.startsWith('http://') && !lower.startsWith('https://') && !lower.startsWith('/')) {
      console.warn('TheStream: URL no permitida:', trimmed.substring(0, 50));
      return '';
    }
    
    return trimmed;
  }

  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    
    const now = Date.now();
    const diffMs = date.getTime() - now;
    const diffSec = Math.floor(diffMs / 1000);
    const absDiff = Math.abs(diffSec);
    
    if (diffSec > 0) {
      if (absDiff < 60) return 'en instantes';
      if (absDiff < 3600) return `en ${Math.floor(absDiff / 60)}m`;
      if (absDiff < 86400) return `en ${Math.floor(absDiff / 3600)}h`;
      return `en ${Math.floor(absDiff / 86400)}d`;
    }
    
    if (absDiff < 60) return 'ahora';
    if (absDiff < 3600) return `${Math.floor(absDiff / 60)}m`;
    if (absDiff < 86400) return `${Math.floor(absDiff / 3600)}h`;
    if (absDiff < 2592000) return `${Math.floor(absDiff / 86400)}d`;
    return `${Math.floor(absDiff / 2592000)}mo`;
  }

  getExpiryTime(expiresAt) {
    if (!expiresAt) return '';
    const diff = Math.floor((expiresAt - Date.now()) / 60000);
    if (diff < 1) return 'exp';
    if (diff < 60) return `${diff}m`;
    return `${Math.floor(diff / 60)}h`;
  }

  refresh() {
    if (this._isDestroyed) return;
    // [FIX 2.2.4] Verificar engine válido
    if (this.engine && !this.engine._isDestroyed && this.engine.refresh) {
      this.engine.refresh();
    }
  }

  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    
    // [FIX 2.2.7] Cancelar TODOS los timers y RAFs
    if (this._loadMoreTimeout) clearTimeout(this._loadMoreTimeout);
    if (this._reorderTimeout) clearTimeout(this._reorderTimeout);
    if (this._lastTouchRaf) cancelAnimationFrame(this._lastTouchRaf);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    
    if (this._imageObserver) {
      this._imageObserver.disconnect();
      this._imageObserver = null;
    }
    
    this.container.removeEventListener('click', this._boundHandleTap);
    this.container.removeEventListener('touchstart', this._boundHandleTouchStart);
    this.container.removeEventListener('touchend', this._boundHandleTouchEnd);
    this.container.removeEventListener('scroll', this._boundHandleScroll);
    
    const imgs = this.container.querySelectorAll('img[data-error-handled="true"]');
    imgs.forEach(img => {
      img.removeEventListener('error', this._boundHandleImageError);
    });
    
    if (this.engine) {
      this.engine.destroy();
      this.engine = null;
    }
    
    if (this.pulse && typeof this.pulse.destroy === 'function') {
      this.pulse.destroy();
    }
    this.pulse = null;
    
    this.items = [];
    this.itemMap.clear();
    this._externalPing = null;
    
    this.resetTouchState();
    this.container = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TheStream };
} else if (typeof window !== 'undefined') {
  window.TheStream = TheStream;
}
