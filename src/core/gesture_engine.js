/**
 * GestureEngine v2.0-IDENTITY
 * Gestos táctiles para NEXO v4.0-IDENTITY
 * * Funcionalidades:
 * 1) Swipe desde borde derecho → abre Vault Panel (en cualquier vista)
 * 2) Swipe desde borde izquierdo → abre BLE Panel (en cualquier vista)
 * 3) Swipe horizontal en chat → volver a lista de conversaciones (back gesture)
 * 4) Swipe down en lista → pull-to-refresh
 * 5) Tap en overlay → cierra paneles abiertos
 * 6) Doble tap en header chat → editar nombre contacto
 * * FIXES v2.0:
 * - Compatible con 3 vistas: conversations, chat, create-group
 * - No interfiere con scroll vertical de listas/mensajes
 * - Zonas de activación inteligentes
 * - Snap con momentum en todos los paneles
 */

export class GestureEngine {
  constructor(options = {}) {
    this.options = {
      vaultPanelId: 'vault-panel',
      blePanelId: 'ble-interface-panel',  // v4.0.1: ID corregido
      streamId: 'nexo-stream',
      conversationsViewId: 'view-conversations',
      chatViewId: 'view-chat',
      createGroupViewId: 'view-create-group',
      edgeThreshold: 60,        // px desde borde para activar
      swipeThreshold: 80,       // px mínimos para considerar swipe
      velocityThreshold: 0.5,   // px/ms para swipe rápido
      ...options
    };

    this.isDragging = false;
    this.dragType = null;      // 'vault' | 'ble' | 'back' | 'refresh'
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.startTime = 0;
    this.vaultOffset = 0;      // 0 = cerrado, 1 = abierto
    this.bleOffset = 0;        // 0 = cerrado, 1 = abierto
    this.backOffset = 0;       // 0 = normal, 1 = volviendo

    this.elements = {};
    this.touchId = null;

    this._boundHandlers = {};
    this.init();
  }

  init() {
    this._cacheElements();
    this._bindEvents();
    console.log('[GestureEngine] v2.0-IDENTITY initialized');
  }

  _cacheElements() {
    const o = this.options;
    this.elements.vault = document.getElementById(o.vaultPanelId);
    this.elements.ble = document.getElementById(o.blePanelId);
    this.elements.stream = document.getElementById(o.streamId);
    this.elements.conversations = document.getElementById(o.conversationsViewId);
    this.elements.chat = document.getElementById(o.chatViewId);
    this.elements.createGroup = document.getElementById(o.createGroupViewId);
    this.elements.body = document.body;
  }

  _bindEvents() {
    const self = this;

    // Touch events
    this._boundHandlers.touchStart = function(e) { self._handleTouchStart(e); };
    this._boundHandlers.touchMove = function(e) { self._handleTouchMove(e); };
    this._boundHandlers.touchEnd = function(e) { self._handleTouchEnd(e); };

    // Mouse events (para desktop/testing)
    this._boundHandlers.mouseDown = function(e) { self._handleTouchStart(e); };
    this._boundHandlers.mouseMove = function(e) { self._handleTouchMove(e); };
    this._boundHandlers.mouseUp = function(e) { self._handleTouchEnd(e); };

    document.addEventListener('touchstart', this._boundHandlers.touchStart, { passive: false });
    document.addEventListener('touchmove', this._boundHandlers.touchMove, { passive: false });
    document.addEventListener('touchend', this._boundHandlers.touchEnd);
    document.addEventListener('touchcancel', this._boundHandlers.touchEnd);

    document.addEventListener('mousedown', this._boundHandlers.mouseDown);
    document.addEventListener('mousemove', this._boundHandlers.mouseMove);
    document.addEventListener('mouseup', this._boundHandlers.mouseUp);

    // Cerrar paneles al tocar overlay/fuera
    document.addEventListener('click', function(e) {
      self._handleOverlayClick(e);
    });

    // Doble tap en header chat para editar nombre
    const chatHeader = document.getElementById('chat-header');
    if (chatHeader) {
      chatHeader.addEventListener('dblclick', function() {
        const nameInput = document.getElementById('chat-contact-name');
        if (nameInput) {
          nameInput.focus();
          nameInput.select();
        }
      });
    }
  }

  _getPointer(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY, id: e.touches[0].identifier };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY, id: e.changedTouches[0].identifier };
    }
    return { x: e.clientX, y: e.clientY, id: 'mouse' };
  }

  _handleTouchStart(e) {
    const ptr = this._getPointer(e);
    if (!ptr) return;

    this.touchId = ptr.id;
    this.startX = ptr.x;
    this.startY = ptr.y;
    this.currentX = ptr.x;
    this.currentY = ptr.y;
    this.startTime = Date.now();
    this.isDragging = false;
    this.dragType = null;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const edge = this.options.edgeThreshold;

    // Determinar tipo de gesto basado en zona de inicio
    const isRightEdge = ptr.x >= (screenW - edge);
    const isLeftEdge = ptr.x <= edge;
    const isTopEdge = ptr.y <= edge;
    const currentView = window.NEXO ? window.NEXO.currentView : 'conversations';

    // 1) Borde derecho → Vault (siempre disponible)
    if (isRightEdge) {
      this.dragType = 'vault';
      this.isDragging = true;
      this._disableTransitions();
      return;
    }

    // 2) Borde izquierdo → BLE Panel (siempre disponible)
    if (isLeftEdge) {
      this.dragType = 'ble';
      this.isDragging = true;
      this._disableTransitions();
      return;
    }

    // 3) En vista chat, swipe desde izquierda (no borde) → volver
    if (currentView === 'chat' && ptr.x < screenW * 0.3 && ptr.x > edge) {
      this.dragType = 'back';
      this.isDragging = true;
      this._disableTransitions();
      return;
    }

    // 4) En vista conversations, swipe down desde top → refresh
    if (currentView === 'conversations' && isTopEdge) {
      this.dragType = 'refresh';
      this.isDragging = true;
      return;
    }
  }

  _handleTouchMove(e) {
    if (!this.isDragging) return;

    const ptr = this._getPointer(e);
    if (!ptr || (this.touchId !== null && ptr.id !== this.touchId)) return;

    this.currentX = ptr.x;
    this.currentY = ptr.y;

    const deltaX = this.currentX - this.startX;
    const deltaY = this.currentY - this.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Si el movimiento es mayormente vertical y NO es refresh, dejar que el scroll nativo maneje
    if (this.dragType !== 'refresh' && absY > absX && absY > 10) {
      this.isDragging = false;
      this.dragType = null;
      return;
    }

    // Prevenir scroll horizontal durante gestos horizontales
    if (absX > absY && absX > 5) {
      e.preventDefault();
    }

    const screenW = window.innerWidth;

    switch (this.dragType) {
      case 'vault':
        // Delta negativo (izquierda) abre vault
        this.vaultOffset = Math.max(0, Math.min(1, -deltaX / (screenW * 0.7)));
        this._renderVault();
        break;

      case 'ble':
        // Delta positivo (derecha) abre BLE
        this.bleOffset = Math.max(0, Math.min(1, deltaX / (screenW * 0.7)));
        this._renderBLE();
        break;

      case 'back':
        // Delta positivo (derecha) mueve chat hacia derecha
        this.backOffset = Math.max(0, Math.min(1, deltaX / (screenW * 0.5)));
        this._renderBack();
        break;

      case 'refresh':
        // Delta positivo (abajo) pull to refresh
        const refreshProgress = Math.max(0, Math.min(1, deltaY / 120));
        this._renderRefresh(refreshProgress);
        break;
    }
  }

  _handleTouchEnd(e) {
    if (!this.isDragging) return;

    const ptr = this._getPointer(e);
    if (ptr && this.touchId !== null && ptr.id !== this.touchId) return;

    const deltaX = this.currentX - this.startX;
    const deltaY = this.currentY - this.startY;
    const elapsed = Date.now() - this.startTime;
    const velocityX = Math.abs(deltaX) / (elapsed || 1);
    const velocityY = Math.abs(deltaY) / (elapsed || 1);
    const screenW = window.innerWidth;

    this.isDragging = false;
    this.touchId = null;

    // Snap con momentum
    const fastSwipe = velocityX > this.options.velocityThreshold || velocityY > this.options.velocityThreshold;

    switch (this.dragType) {
      case 'vault':
        if (this.vaultOffset > 0.3 || (fastSwipe && deltaX < -this.options.swipeThreshold)) {
          this._animateVault(1);
        } else {
          this._animateVault(0);
        }
        break;

      case 'ble':
        if (this.bleOffset > 0.3 || (fastSwipe && deltaX > this.options.swipeThreshold)) {
          this._animateBLE(1);
        } else {
          this._animateBLE(0);
        }
        break;

      case 'back':
        if (this.backOffset > 0.4 || (fastSwipe && deltaX > this.options.swipeThreshold)) {
          this._animateBack(1, true); // volver y cambiar vista
        } else {
          this._animateBack(0, false);
        }
        break;

      case 'refresh':
        const refreshProgress = Math.max(0, Math.min(1, deltaY / 120));
        if (refreshProgress > 0.7 || (fastSwipe && deltaY > this.options.swipeThreshold)) {
          this._triggerRefresh();
        }
        this._animateRefresh(0);
        break;
    }

    this.dragType = null;
  }

  // ==================== RENDERIZADO ====================

  _disableTransitions() {
    if (this.elements.vault) this.elements.vault.style.transition = 'none';
    if (this.elements.ble) this.elements.ble.style.transition = 'none';
    if (this.elements.chat) this.elements.chat.style.transition = 'none';
  }

  _renderVault() {
    if (!this.elements.vault) return;
    const vaultX = 100 - (this.vaultOffset * 100);
    this.elements.vault.style.transform = `translateX(${vaultX}%)`;

    // Efecto parallax en stream si está visible
    if (this.elements.stream) {
      const streamX = -(this.vaultOffset * 15);
      this.elements.stream.style.transform = `translateX(${streamX}%)`;
      this.elements.stream.style.filter = `brightness(${1 - this.vaultOffset * 0.15})`;
    }
  }

  _renderBLE() {
    if (!this.elements.ble) return;
    const bleX = -100 + (this.bleOffset * 100);
    this.elements.ble.style.transform = `translateX(${bleX}%)`;
  }

  _renderBack() {
    if (!this.elements.chat) return;
    const chatX = this.backOffset * 100;
    const scale = 1 - (this.backOffset * 0.05);
    this.elements.chat.style.transform = `translateX(${chatX}%) scale(${scale})`;
    this.elements.chat.style.opacity = 1 - (this.backOffset * 0.3);
  }

  _renderRefresh(progress) {
    const conversations = this.elements.conversations;
    if (!conversations) return;
    conversations.style.transform = `translateY(${progress * 60}px)`;

    // Spinner visual
    let spinner = document.getElementById('refresh-spinner');
    if (!spinner && progress > 0.1) {
      spinner = document.createElement('div');
      spinner.id = 'refresh-spinner';
      spinner.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);width:24px;height:24px;border:2px solid #00d4ff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;z-index:9999;';
      document.body.appendChild(spinner);
    }
    if (spinner) {
      spinner.style.opacity = progress;
    }
  }

  // ==================== ANIMACIONES SNAP ====================

  _animateVault(target) {
    this._animateProperty('vaultOffset', target, (val) => {
      this.vaultOffset = val;
      this._renderVault();
    }, () => {
      if (target === 1) {
        window.dispatchEvent(new Event('nexo:vault:opened'));
        if (this.elements.vault) this.elements.vault.classList.add('vault-visible');
      } else {
        window.dispatchEvent(new Event('nexo:vault:closed'));
        if (this.elements.vault) this.elements.vault.classList.remove('vault-visible');
      }
    });
  }

  _animateBLE(target) {
    this._animateProperty('bleOffset', target, (val) => {
      this.bleOffset = val;
      this._renderBLE();
    }, () => {
      if (target === 1) {
        window.dispatchEvent(new Event('nexo:ble:panelOpened'));
        if (this.elements.ble) this.elements.ble.classList.add('active');
      } else {
        window.dispatchEvent(new Event('nexo:ble:panelClosed'));
        if (this.elements.ble) this.elements.ble.classList.remove('active');
      }
    });
  }

  _animateBack(target, shouldNavigate) {
    this._animateProperty('backOffset', target, (val) => {
      this.backOffset = val;
      this._renderBack();
    }, () => {
      if (shouldNavigate && target === 1) {
        // Navegar a conversaciones
        if (window.NEXO && window.NEXO.currentView) {
          window.NEXO.currentView = 'conversations';
        }
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        if (this.elements.conversations) this.elements.conversations.classList.add('active');
        // Reset transform
        if (this.elements.chat) {
          this.elements.chat.style.transform = '';
          this.elements.chat.style.opacity = '';
        }
        this.backOffset = 0;
      }
    });
  }

  _animateRefresh(target) {
    this._animateProperty('refreshProgress', target, (val) => {
      this._renderRefresh(val);
    }, () => {
      const spinner = document.getElementById('refresh-spinner');
      if (spinner) spinner.remove();
      if (this.elements.conversations) this.elements.conversations.style.transform = '';
    });
  }

  _animateProperty(propName, target, onUpdate, onComplete) {
    const start = this[propName] || 0;
    const diff = target - start;
    const duration = 300;
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      onUpdate(start + (diff * ease));

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        onUpdate(target);
        if (onComplete) onComplete();
      }
    };

    requestAnimationFrame(animate);
  }

  // ==================== EVENTOS AUXILIARES ====================

  _handleOverlayClick(e) {
    // Cerrar paneles si se toca fuera de ellos
    const vault = this.elements.vault;
    const ble = this.elements.ble;

    if (vault && vault.classList.contains('vault-visible')) {
      const rect = vault.getBoundingClientRect();
      if (e.clientX < rect.left) {
        this._animateVault(0);
      }
    }

    if (ble && ble.classList.contains('active')) {
      const rect = ble.getBoundingClientRect();
      if (e.clientX > rect.right) {
        this._animateBLE(0);
      }
    }
  }

  _triggerRefresh() {
    window.dispatchEvent(new Event('nexo:conversations:refresh'));
    console.log('[GestureEngine] Pull to refresh triggered');
  }

  // ==================== API PÚBLICA ====================

  openVault() {
    this._animateVault(1);
  }

  closeVault() {
    this._animateVault(0);
  }

  openBLE() {
    this._animateBLE(1);
  }

  closeBLE() {
    this._animateBLE(0);
  }

  isVaultOpen() {
    return this.vaultOffset > 0.5;
  }

  isBLEOpen() {
    return this.bleOffset > 0.5;
  }

  destroy() {
    document.removeEventListener('touchstart', this._boundHandlers.touchStart);
    document.removeEventListener('touchmove', this._boundHandlers.touchMove);
    document.removeEventListener('touchend', this._boundHandlers.touchEnd);
    document.removeEventListener('touchcancel', this._boundHandlers.touchEnd);
    document.removeEventListener('mousedown', this._boundHandlers.mouseDown);
    document.removeEventListener('mousemove', this._boundHandlers.mouseMove);
    document.removeEventListener('mouseup', this._boundHandlers.mouseUp);
    console.log('[GestureEngine] Destroyed');
  }
}

export default GestureEngine;
