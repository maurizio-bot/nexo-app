/**
 * CoreGestureEngine - Sistema de slide Stream↔Vault
 * Ubicación: src/core/gesture_engine.js
 * Pattern: NAP 2.0 + Touch/Mouse Hybrid + 60px Edge Zone
 * 
 * Diferencia con UI/GestureEngine:
 * - Este controla el LAYOUT/ANIMACIÓN específica Stream↔Vault
 * - UI/GestureEngine controla gestos táctiles generales (swipes, etc.)
 */

export class GestureEngine {
  constructor(streamEl, vaultEl, options = {}) {
    this.streamEl = streamEl;
    this.vaultEl = vaultEl;
    this.options = {
      edgeZone: options.edgeZone || 60,        // Zona derecha activa (px)
      threshold: options.threshold || 0.3,     // Umbral para abrir (0-1)
      animationDuration: options.animationDuration || 300,
      debug: options.debug || false
    };
    
    this.isDragging = false;
    this.startX = 0;
    this.currentX = 0;
    this.offset = 0;        // 0 = cerrado, 1 = abierto
    this.isOpen = false;
    this.isEnabled = true;
    
    // Elementos DOM internos
    this.overlay = null;
    
    this._boundStart = this._handleStart.bind(this);
    this._boundMove = this._handleMove.bind(this);
    this._boundEnd = this._handleEnd.bind(this);
    
    // Eventos personalizados
    this._events = {
      'vault:opened': [],
      'vault:closed': []
    };
  }
  
  async init() {
    if (!this.streamEl || !this.vaultEl) {
      throw new Error('CoreGestureEngine: Se requieren elementos Stream y Vault');
    }
    
    // Crear overlay oscuro para cuando vault está abierto
    this._createOverlay();
    
    // Configurar estilos iniciales
    this._setupStyles();
    
    // Event listeners
    this._attachListeners();
    
    if (this.options.debug) {
      console.log('[CoreGestureEngine] Inicializado - Zona derecha:', this.options.edgeZone + 'px');
    }
    
    return this;
  }
  
  _createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      opacity: 0;
      pointer-events: none;
      transition: opacity ${this.options.animationDuration}ms ease;
      z-index: 998;
    `;
    document.body.appendChild(this.overlay);
    
    // Click en overlay cierra el vault
    this.overlay.addEventListener('click', () => this.close());
  }
  
  _setupStyles() {
    // Estilos iniciales del Stream
    this.streamEl.style.cssText += `
      transition: transform ${this.options.animationDuration}ms ease;
      will-change: transform;
    `;
    
    // Estilos iniciales del Vault (fuera de pantalla a la derecha)
    this.vaultEl.style.cssText += `
      position: fixed;
      top: 0;
      right: 0;
      width: 85%;
      height: 100%;
      transform: translateX(100%);
      transition: transform ${this.options.animationDuration}ms ease;
      z-index: 999;
      will-change: transform;
      box-shadow: -5px 0 25px rgba(0,0,0,0.3);
    `;
  }
  
  _attachListeners() {
    // Touch events
    document.addEventListener('touchstart', this._boundStart, { passive: false });
    document.addEventListener('touchmove', this._boundMove, { passive: false });
    document.addEventListener('touchend', this._boundEnd);
    
    // Mouse events
    document.addEventListener('mousedown', this._boundStart);
    document.addEventListener('mousemove', this._boundMove);
    document.addEventListener('mouseup', this._boundEnd);
  }
  
  _handleStart(e) {
    if (!this.isEnabled) return;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const screenWidth = window.innerWidth;
    
    // Solo iniciar si está en la zona derecha (60px desde el borde)
    // O si el vault ya está abierto (para poder cerrarlo arrastrando)
    if (!this.isOpen && clientX < screenWidth - this.options.edgeZone) {
      return;
    }
    
    // Ignorar si el target es un input o botón dentro del vault
    if (this.vaultEl.contains(e.target) && this.isOpen) {
      return;
    }
    
    this.isDragging = true;
    this.startX = clientX;
    this.currentX = clientX;
    
    // Deshabilitar transiciones durante el drag
    this.streamEl.style.transition = 'none';
    this.vaultEl.style.transition = 'none';
    this.overlay.style.transition = 'none';
    
    if (this.options.debug) {
      console.log('[CoreGestureEngine] Drag iniciado en x:', clientX);
    }
  }
  
  _handleMove(e) {
    if (!this.isDragging) return;
    
    // Prevenir scroll mientras se arrastra el vault
    if (e.preventDefault) e.preventDefault();
    
    this.currentX = e.touches ? e.touches[0].clientX : e.clientX;
    const deltaX = this.currentX - this.startX;
    const screenWidth = window.innerWidth;
    
    // Calcular offset (0 a 1)
    if (!this.isOpen) {
      // Abriendo: arrastrando desde derecha hacia izquierda (delta negativo)
      this.offset = Math.max(0, Math.min(1, -deltaX / (screenWidth * 0.5)));
    } else {
      // Cerrando: arrastrando desde izquierda hacia derecha (delta positivo)
      this.offset = Math.max(0, Math.min(1, 1 - (deltaX / (screenWidth * 0.5))));
    }
    
    this._render();
  }
  
  _handleEnd(e) {
    if (!this.isDragging) return;
    
    this.isDragging = false;
    
    // Restaurar transiciones
    this.streamEl.style.transition = `transform ${this.options.animationDuration}ms ease`;
    this.vaultEl.style.transition = `transform ${this.options.animationDuration}ms ease`;
    this.overlay.style.transition = `opacity ${this.options.animationDuration}ms ease`;
    
    // Decidir si abrir o cerrar basado en el threshold
    if (this.offset > this.options.threshold) {
      this.open();
    } else {
      this.close();
    }
  }
  
  _render() {
    // Efecto visual durante el drag
    const streamOffset = this.offset * -20; // Mover Stream -20% a la izquierda
    const vaultOffset = 100 - (this.offset * 100); // Vault entra desde 100% a 0%
    
    this.streamEl.style.transform = `translateX(${streamOffset}%)`;
    this.vaultEl.style.transform = `translateX(${vaultOffset}%)`;
    this.overlay.style.opacity = this.offset * 0.5;
    
    // Efectos adicionales de brillo/escala en el Stream
    const scale = 1 - (this.offset * 0.02); // Ligero zoom out
    const brightness = 1 - (this.offset * 0.3); // Oscurecer ligeramente
    this.streamEl.style.filter = `brightness(${brightness})`;
    this.streamEl.style.transform = `translateX(${streamOffset}%) scale(${scale})`;
  }
  
  open() {
    this.isOpen = true;
    this.offset = 1;
    
    this.streamEl.style.transition = `transform ${this.options.animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    this.vaultEl.style.transition = `transform ${this.options.animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    this.overlay.style.transition = `opacity ${this.options.animationDuration}ms ease`;
    
    this._renderFinalState();
    
    // Disparar evento global para REM y otros componentes
    window.dispatchEvent(new CustomEvent('nexo:vault:opened', {
      detail: { source: 'CoreGestureEngine', timestamp: Date.now() }
    }));
    
    if (this.options.debug) {
      console.log('[CoreGestureEngine] Vault abierto');
    }
  }
  
  close() {
    this.isOpen = false;
    this.offset = 0;
    
    this.streamEl.style.transition = `transform ${this.options.animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    this.vaultEl.style.transition = `transform ${this.options.animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    this.overlay.style.transition = `opacity ${this.options.animationDuration}ms ease`;
    
    this._renderFinalState();
    
    // Disparar evento global
    window.dispatchEvent(new CustomEvent('nexo:vault:closed', {
      detail: { source: 'CoreGestureEngine', timestamp: Date.now() }
    }));
    
    if (this.options.debug) {
      console.log('[CoreGestureEngine] Vault cerrado');
    }
  }
  
  _renderFinalState() {
    if (this.isOpen) {
      // Estado abierto
      this.streamEl.style.transform = 'translateX(-20%) scale(0.98)';
      this.streamEl.style.filter = 'brightness(0.7)';
      this.vaultEl.style.transform = 'translateX(0)';
      this.overlay.style.opacity = '1';
      this.overlay.style.pointerEvents = 'auto';
    } else {
      // Estado cerrado
      this.streamEl.style.transform = 'translateX(0) scale(1)';
      this.streamEl.style.filter = 'brightness(1)';
      this.vaultEl.style.transform = 'translateX(100%)';
      this.overlay.style.opacity = '0';
      this.overlay.style.pointerEvents = 'none';
    }
  }
  
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
  
  disable() {
    this.isEnabled = false;
  }
  
  enable() {
    this.isEnabled = true;
  }
  
  destroy() {
    this.close();
    
    // Remover event listeners
    document.removeEventListener('touchstart', this._boundStart);
    document.removeEventListener('touchmove', this._boundMove);
    document.removeEventListener('touchend', this._boundEnd);
    document.removeEventListener('mousedown', this._boundStart);
    document.removeEventListener('mousemove', this._boundMove);
    document.removeEventListener('mouseup', this._boundEnd);
    
    // Remover overlay
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    
    // Resetear estilos
    this.streamEl.style.transform = '';
    this.streamEl.style.filter = '';
    this.streamEl.style.transition = '';
    this.vaultEl.style.transform = '';
    this.vaultEl.style.transition = '';
  }
}

export default GestureEngine;
