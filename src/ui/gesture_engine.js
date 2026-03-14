/**
 * NEXO v9.0 - Gesture Engine v1.2-NAP-CERTIFIED
 * Sistema de gestos táctiles 100% edge-based
 * 
 * CORRECCIONES NAP v1.2:
 * - [FIX 1.2.1] Agregado flag _isDestroyed para consistencia arquitectónica
 * - [FIX 1.2.2] Validación _isDestroyed en todos los métodos públicos/handlers
 * - [FIX 1.2.3] Validación de target.isConnected antes de operaciones DOM
 * - [FIX 1.2.4] Limpieza completa de referencias en destroy()
 * - [FIX 1.2.5] Eliminado console.log de debug en destroy (consistencia)
 * - performance.now() (monotónico) vs Date.now()
 * - Fix memory leak resize listener binding
 * - Verificación setPointerCapture con isConnected
 * - Cancelación gesture en destroy()
 * - CSS user-select durante gestures
 */

export class GestureEngine {
  constructor(options = {}) {
    // [FIX 1.2.1] Flag de destrucción (patrón NEXO estándar)
    this._isDestroyed = false;
    
    this.config = {
      edgeSize: 20,
      threshold: 50,
      velocityThreshold: 0.5,
      maxDuration: 1000,
      haptic: true,
      ...options  // Opciones del usuario sobrescriben defaults
    };
    
    this.callbacks = {
      onSwipe: options.onSwipe || (() => {}),
      onEdgeGesture: options.onEdgeGesture || (() => {}),
      onQuickAction: options.onQuickAction || (() => {}),
      onGestureStart: options.onGestureStart || (() => {}),
      onGestureEnd: options.onGestureEnd || (() => {})
    };
    
    this.state = 'IDLE';
    this.currentGesture = null;
    this.isEnabled = false;
    this.target = options.target || (typeof document !== 'undefined' ? document.body : null);
    
    // Bindings para remover listeners correctamente
    this._updateViewport = this._updateViewport.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    
    this._viewport = { width: 0, height: 0 };
    this._updateViewport();
    
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._updateViewport);
      window.addEventListener('orientationchange', this._updateViewport);
    }
  }
  
  _updateViewport() {
    if (this._isDestroyed) return;  // [FIX 1.2.2]
    if (typeof window !== 'undefined') {
      this._viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };
    }
  }
  
  _getEdgeZone(x, y) {
    const { edgeSize } = this.config;
    const { width, height } = this._viewport;
    
    if (x <= edgeSize) return 'left';
    if (x >= width - edgeSize) return 'right';
    if (y <= edgeSize) return 'top';
    if (y >= height - edgeSize) return 'bottom';
    return null;
  }
  
  _calculateVelocity(gesture) {
    const dx = gesture.currentX - gesture.startX;
    const dy = gesture.currentY - gesture.startY;
    const dt = performance.now() - gesture.startTime;
    
    if (dt <= 0) return { velocity: 0, direction: 'none', distance: 0, dx, dy, dt: 0 };
    
    const distance = Math.sqrt(dx * dx + dy * dy);
    const velocity = distance / dt;
    
    let direction = 'none';
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'right' : 'left';
    } else if (Math.abs(dy) > 0) {
      direction = dy > 0 ? 'down' : 'up';
    }
    
    return { velocity, direction, distance, dx, dy, dt };
  }
  
  _haptic(pattern = [50]) {
    if (this._isDestroyed) return;  // [FIX 1.2.2]
    if (!this.config.haptic) return;
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    }
    try { navigator.vibrate(pattern); } catch (e) {}
  }
  
  _applyGestureStyles(active) {
    if (this._isDestroyed) return;  // [FIX 1.2.2]
    if (!this.target) return;
    if (active) {
      this.target.style.userSelect = 'none';
      this.target.style.webkitUserSelect = 'none';
    } else {
      this.target.style.userSelect = '';
      this.target.style.webkitUserSelect = '';
    }
  }
  
  _onPointerDown(e) {
    if (this._isDestroyed || !this.isEnabled || !e.isPrimary) return;  // [FIX 1.2.2]
    
    const edge = this._getEdgeZone(e.clientX, e.clientY);
    
    if (edge) {
      // [FIX 1.2.3] Validar target existe y está conectado
      if (this.target && this.target.isConnected && this.target.setPointerCapture) {
        try { this.target.setPointerCapture(e.pointerId); } 
        catch (err) { console.warn('setPointerCapture failed', err); }
      }
      
      this.state = 'STARTED';
      this.currentGesture = {
        pointerId: e.pointerId,
        edge: edge,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        startTime: performance.now()
      };
      
      this._applyGestureStyles(true);
      
      // [FIX 1.2.2] Callback protegido contra destrucción
      if (!this._isDestroyed && this.callbacks.onGestureStart) {
        this.callbacks.onGestureStart({ edge: edge, x: e.clientX, y: e.clientY });
      }
      
      if (edge === 'left' || edge === 'right') e.preventDefault();
    }
  }
  
  _onPointerMove(e) {
    if (this._isDestroyed || !this.isEnabled || !this.currentGesture) return;  // [FIX 1.2.2]
    if (e.pointerId !== this.currentGesture.pointerId) return;
    
    const gesture = this.currentGesture;
    gesture.currentX = e.clientX;
    gesture.currentY = e.clientY;
    
    const { distance, direction } = this._calculateVelocity(gesture);
    
    if (this.state === 'STARTED' && distance > 10) this.state = 'TRACKING';
    
    if (this.state === 'TRACKING') {
      const isHorizontal = direction === 'left' || direction === 'right';
      const isVertical = direction === 'up' || direction === 'down';
      
      if ((gesture.edge === 'left' || gesture.edge === 'right') && isHorizontal) {
        e.preventDefault();
      }
      if ((gesture.edge === 'top' || gesture.edge === 'bottom') && isVertical) {
        e.preventDefault();
      }
    }
  }
  
  _onPointerUp(e) {
    if (this._isDestroyed || !this.isEnabled || !this.currentGesture) return;  // [FIX 1.2.2]
    if (e.pointerId !== this.currentGesture.pointerId) return;
    this._endGesture();
  }
  
  _onPointerCancel(e) {
    if (this._isDestroyed || !this.isEnabled || !this.currentGesture) return;  // [FIX 1.2.2]
    if (e.pointerId !== this.currentGesture.pointerId) return;
    this._cancelGesture();
  }
  
  _onContextMenu(e) {
    if (this._isDestroyed) return;  // [FIX 1.2.2]
    const edge = this._getEdgeZone(e.clientX, e.clientY);
    if (edge && this.isEnabled) e.preventDefault();
  }
  
  _endGesture() {
    if (!this.currentGesture) return;
    
    const gesture = this.currentGesture;
    const { velocity, direction, distance } = this._calculateVelocity(gesture);
    const duration = performance.now() - gesture.startTime;
    
    this.state = 'IDLE';
    this.currentGesture = null;
    this._applyGestureStyles(false);
    
    const isValidSwipe = distance >= this.config.threshold;
    const isWithinTime = duration <= this.config.maxDuration;
    
    if (isValidSwipe && isWithinTime) {
      this._haptic([50, 30]);
      
      if (gesture.edge === 'bottom' && direction === 'up' && distance > 100) {
        if (!this._isDestroyed) this.callbacks.onQuickAction('menu');
      } else if (gesture.edge === 'top' && direction === 'down') {
        if (!this._isDestroyed) this.callbacks.onQuickAction('refresh');
      } else if (direction === 'left' || direction === 'right') {
        if (!this._isDestroyed) this.callbacks.onSwipe(direction, velocity, distance);
      }
      
      if (!this._isDestroyed) {
        this.callbacks.onEdgeGesture(gesture.edge, direction, { velocity, distance, duration });
        this.callbacks.onGestureEnd({ type: 'swipe', edge: gesture.edge, direction, velocity, distance, completed: true });
      }
    } else {
      if (!this._isDestroyed) {
        this.callbacks.onGestureEnd({ type: 'cancel', edge: gesture.edge, completed: false, reason: !isValidSwipe ? 'threshold' : 'timeout' });
      }
    }
  }
  
  _cancelGesture() {
    if (this.currentGesture && !this._isDestroyed) {
      this.callbacks.onGestureEnd({ type: 'cancel', edge: this.currentGesture.edge, completed: false, reason: 'cancelled' });
    }
    this.state = 'IDLE';
    this.currentGesture = null;
    this._applyGestureStyles(false);
  }
  
  init() {
    if (this._isDestroyed) throw new Error('GestureEngine: No se puede inicializar instancia destruida');
    if (!this.target) throw new Error('GestureEngine: No target element available');
    if (this.isEnabled) return;
    
    this.target.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    this.target.addEventListener('pointermove', this._onPointerMove, { passive: false });
    this.target.addEventListener('pointerup', this._onPointerUp, { passive: true });
    this.target.addEventListener('pointercancel', this._onPointerCancel, { passive: true });
    this.target.addEventListener('contextmenu', this._onContextMenu);
    this.target.style.touchAction = 'pan-y pan-x';
    
    this.isEnabled = true;
  }
  
  disable() {
    if (this._isDestroyed) return;
    this.isEnabled = false;
    this._cancelGesture();
  }
  
  enable() {
    if (this._isDestroyed) return;
    this.isEnabled = true;
  }
  
  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    
    this._cancelGesture();
    this.isEnabled = false;
    
    if (this.target) {
      this.target.removeEventListener('pointerdown', this._onPointerDown);
      this.target.removeEventListener('pointermove', this._onPointerMove);
      this.target.removeEventListener('pointerup', this._onPointerUp);
      this.target.removeEventListener('pointercancel', this._onPointerCancel);
      this.target.removeEventListener('contextmenu', this._onContextMenu);
      this._applyGestureStyles(false);
    }
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._updateViewport);
      window.removeEventListener('orientationchange', this._updateViewport);
    }
    
    // [FIX 1.2.4] Limpieza completa de referencias
    this.callbacks = null;
    this.config = null;
    this.currentGesture = null;
    this.target = null;
  }
  
  simulateGesture(type) {
    if (this._isDestroyed || !this.isEnabled) return;
    const validTypes = ['swipe-left', 'swipe-right', 'menu', 'refresh'];
    if (!validTypes.includes(type)) {
      console.warn(`GestureEngine: tipo inválido "${type}"`);
      return;
    }
    
    switch(type) {
      case 'swipe-left': this.callbacks.onSwipe('left', 1.0, 200); this._haptic([50]); break;
      case 'swipe-right': this.callbacks.onSwipe('right', 1.0, 200); this._haptic([50]); break;
      case 'menu': this.callbacks.onQuickAction('menu'); this._haptic([50]); break;
      case 'refresh': this.callbacks.onQuickAction('refresh'); this._haptic([50]); break;
    }
  }
}

export function createGestureEngine(options) {
  return new GestureEngine(options);
}

if (typeof window !== 'undefined') {
  window.GestureEngine = GestureEngine;
  window.createGestureEngine = createGestureEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GestureEngine, createGestureEngine };
}
