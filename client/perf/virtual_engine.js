/**
 * NEXO v9.0 - VirtualEngine v3.1-NAP-FIXED
 * FIX: Null checks en getComputedStyle, validación de elementos DOM, isConnected check
 */

export class VirtualEngine {
  constructor(container, options = {}) {
    if (!container) throw new Error('VirtualEngine: container requerido');
    
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
    
    if (!this.container) throw new Error('VirtualEngine: container no encontrado');
    
    // Verificar que container es un elemento válido
    if (!(this.container instanceof Element)) {
      throw new Error('VirtualEngine: container debe ser un Elemento DOM válido');
    }
    
    this.options = {
      itemHeight: options.itemHeight || 120,
      overscan: options.overscan || 3,
      poolSize: options.poolSize || 15,
      renderFn: options.renderFn || (() => {}),
      onVisible: options.onVisible || (() => {}),
      onHidden: options.onHidden || (() => {})
    };
    
    this.items = [];
    this.heights = [];
    this.positions = [];
    this.totalHeight = 0;
    this.visibleRange = { start: 0, end: 0 };
    this.pool = [];
    this.activeElements = new Map();
    
    this._isDestroyed = false;
    this._isUpdating = false;
    this._scrollRaf = null;
    this._resizeObserver = null;
    this._intersectionObserver = null;
    this._resizeDebounceTimer = null;
    this._pendingMeasurements = new Set();
    
    this._spacer = null;
    this._viewport = null;
    this._viewportHeight = 0;
    this._avgHeight = this.options.itemHeight;
    
    this._handleScroll = this._handleScroll.bind(this);
    this._handleWindowResize = this._handleWindowResize.bind(this);
    this._intersectionCallback = this._intersectionCallback.bind(this);
    
    this.init();
  }

  init() {
    if (this._isDestroyed) return;
    
    this._setupContainer();
    this._createPool();
    this._setupIntersectionObserver();
    this._setupResizeObserver();
    
    this.container.addEventListener('scroll', this._handleScroll, { passive: true });
    window.addEventListener('resize', this._handleWindowResize);
    
    this._measureViewport();
  }

  /**
   * [FIX] Validar que container existe antes de modificar
   */
  _setupContainer() {
    if (!this.container || this._isDestroyed) return;
    
    // Verificar que container está en el DOM
    if (!this.container.isConnected) {
      console.warn('VirtualEngine: Container no está conectado al DOM');
    }
    
    // [FIX] Validar antes de getComputedStyle
    let style;
    try {
      if (!this.container || !this.container.nodeType) {
        throw new Error('Container inválido');
      }
      style = window.getComputedStyle(this.container);
    } catch (e) {
      console.warn('VirtualEngine: No se pudo obtener estilos, usando defaults');
      style = { position: 'static', overflow: 'visible' };
    }
    
    if (style.position === 'static') {
      this.container.style.position = 'relative';
    }
    if (style.overflow === 'visible') {
      this.container.style.overflow = 'auto';
    }
    
    this._spacer = document.createElement('div');
    this._spacer.style.cssText = `
      width: 1px;
      height: 0px;
      position: absolute;
      top: 0px;
      left: 0px;
      visibility: hidden;
      pointer-events: none;
    `;
    this.container.appendChild(this._spacer);
    
    this._viewport = document.createElement('div');
    this._viewport.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      contain: strict;
    `;
    this.container.appendChild(this._viewport);
  }

  _createPool() {
    if (!this._viewport || this._isDestroyed) return;
    
    for (let i = 0; i < this.options.poolSize; i++) {
      const el = document.createElement('div');
      el.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        will-change: transform;
        contain: layout style paint;
        pointer-events: auto;
      `;
      el._virtualIndex = -1;
      el._isActive = false;
      
      this.pool.push(el);
      this._viewport.appendChild(el);
    }
  }

  _setupIntersectionObserver() {
    const margin = this.options.itemHeight * (this.options.overscan + 2);
    
    this._intersectionObserver = new IntersectionObserver(
      this._intersectionCallback, 
      {
        root: this.container,
        rootMargin: `${margin}px 0px`,
        threshold: 0
      }
    );
  }

  _setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    
    this._resizeObserver = new ResizeObserver((entries) => {
      if (this._isDestroyed) return;
      let needsRecalculate = false;
      
      entries.forEach(entry => {
        const el = entry.target;
        // [FIX] Verificar que el elemento sigue siendo válido
        if (!el || !el._isActive || el._virtualIndex === -1) return;
        
        const index = el._virtualIndex;
        if (index < 0 || index >= this.items.length) return;
        
        const newHeight = entry.contentRect.height;
        const oldHeight = this.heights[index] || this.options.itemHeight;
        
        if (Math.abs(newHeight - oldHeight) > 1) {
          this.heights[index] = newHeight;
          needsRecalculate = true;
        }
      });
      
      if (needsRecalculate) {
        this._updateAverageHeight();
        this._calculatePositions();
        this._updatePositions();
      }
    });
  }

  _updateAverageHeight() {
    if (this.heights.length === 0) return;
    const sum = this.heights.reduce((a, b) => a + (b || this.options.itemHeight), 0);
    this._avgHeight = sum / this.heights.length;
  }

  _intersectionCallback(entries) {
    if (this._isDestroyed) return;
    
    entries.forEach(entry => {
      const el = entry.target;
      if (!el || typeof el._virtualIndex === 'undefined') return;
      
      const index = el._virtualIndex;
      
      if (index < 0 || index >= this.items.length) return;
      
      if (entry.isIntersecting) {
        this.options.onVisible(this.items[index], index);
      } else {
        this.options.onHidden(this.items[index], index);
      }
    });
  }

  /**
   * [FIX CRÍTICO] Validar container antes de medir
   */
  _measureViewport() {
    if (!this.container || this._isDestroyed) return;
    
    // [FIX] Verificar que container sigue en el DOM y es válido
    if (!this.container.isConnected || !this.container.nodeType) {
      console.warn('VirtualEngine: Container no disponible para medir');
      this._viewportHeight = 0;
      return;
    }
    
    try {
      this._viewportHeight = this.container.clientHeight || 0;
    } catch (e) {
      console.warn('VirtualEngine: Error al medir viewport:', e);
      this._viewportHeight = 0;
    }
  }

  _handleScroll() {
    if (this._isDestroyed) return;
    
    if (this._scrollRaf) {
      cancelAnimationFrame(this._scrollRaf);
    }
    
    this._scrollRaf = requestAnimationFrame(() => {
      this._scrollRaf = null;
      if (!this._isDestroyed) {
        this._updateVisibleRange();
      }
    });
  }

  _handleWindowResize() {
    if (this._resizeDebounceTimer) {
      clearTimeout(this._resizeDebounceTimer);
    }
    
    this._resizeDebounceTimer = setTimeout(() => {
      if (!this._isDestroyed) {
        this._measureViewport();
        this._updateVisibleRange();
      }
    }, 150);
  }

  _calculatePositions() {
    this.positions = new Array(this.items.length);
    let currentPos = 0;
    
    for (let i = 0; i < this.items.length; i++) {
      this.positions[i] = currentPos;
      currentPos += this.heights[i] || this.options.itemHeight;
    }
    
    this.totalHeight = currentPos;
    if (this._spacer) {
      this._spacer.style.height = `${this.totalHeight}px`;
    }
  }

  _calculatePositionsIncremental(startIndex) {
    if (startIndex === 0 || this.positions.length === 0) {
      this._calculatePositions();
      return;
    }
    
    let currentPos = this.totalHeight;
    
    for (let i = startIndex; i < this.items.length; i++) {
      this.positions[i] = currentPos;
      currentPos += this.heights[i] || this.options.itemHeight;
    }
    
    this.totalHeight = currentPos;
    if (this._spacer) {
      this._spacer.style.height = `${this.totalHeight}px`;
    }
  }

  _updateVisibleRange() {
    if (this._isUpdating || this.items.length === 0 || !this.container) return;
    this._isUpdating = true;
    
    try {
      const scrollTop = this.container.scrollTop || 0;
      const scrollBottom = scrollTop + (this._viewportHeight || 0);
      
      const startIndex = this._findIndexAtPosition(scrollTop) - this.options.overscan;
      const endIndex = this._findIndexAtPosition(scrollBottom) + this.options.overscan;
      
      const clampedStart = Math.max(0, startIndex);
      const clampedEnd = Math.min(this.items.length - 1, endIndex);
      
      if (Math.abs(clampedStart - this.visibleRange.start) > 0 || 
          Math.abs(clampedEnd - this.visibleRange.end) > 0) {
        this.visibleRange = { start: clampedStart, end: clampedEnd };
        this._renderRange(clampedStart, clampedEnd);
      }
    } finally {
      this._isUpdating = false;
    }
  }

  _findIndexAtPosition(position) {
    if (this.positions.length === 0) return 0;
    
    let left = 0;
    let right = this.positions.length - 1;
    let result = 0;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (this.positions[mid] <= position) {
        result = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return result;
  }

  _renderRange(start, end) {
    const toRecycle = [];
    this.activeElements.forEach((el, index) => {
      if (index < start || index > end) {
        toRecycle.push(index);
      }
    });
    
    toRecycle.forEach(index => {
      const el = this.activeElements.get(index);
      if (el) {
        if (this._intersectionObserver) {
          this._intersectionObserver.unobserve(el);
        }
        if (this._resizeObserver) {
          this._resizeObserver.unobserve(el);
        }
        
        el._isActive = false;
        el._virtualIndex = -1;
        el.style.display = 'none';
        el.style.transform = 'translateY(-9999px)';
        
        this.activeElements.delete(index);
      }
    });
    
    for (let i = start; i <= end; i++) {
      if (this.activeElements.has(i)) {
        this._positionElement(this.activeElements.get(i), i);
        continue;
      }
      
      const el = this._getFreeElement();
      if (!el) {
        console.warn('VirtualEngine: Pool agotado');
        continue;
      }
      
      el._virtualIndex = i;
      el._isActive = true;
      el.style.display = 'block';
      
      try {
        this.options.renderFn(el, this.items[i], i);
      } catch (err) {
        console.error(`VirtualEngine: Error en renderFn índice ${i}:`, err);
      }
      
      if (!this.heights[i]) {
        this._scheduleHeightMeasurement(el, i);
      }
      
      if (this._resizeObserver) {
        this._resizeObserver.observe(el);
      }
      if (this._intersectionObserver) {
        this._intersectionObserver.observe(el);
      }
      
      this._positionElement(el, i);
      this.activeElements.set(i, el);
    }
  }

  _getFreeElement() {
    return this.pool.find(el => !el._isActive);
  }

  _positionElement(el, index) {
    if (!el || !el.style) return;
    const y = this.positions[index] || (index * this.options.itemHeight);
    el.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  _updatePositions() {
    this.activeElements.forEach((el, index) => {
      this._positionElement(el, index);
    });
  }

  /**
   * [FIX CRÍTICO] Validar elemento antes de medir
   */
  _scheduleHeightMeasurement(el, index) {
    const rafId = requestAnimationFrame(() => {
      this._pendingMeasurements.delete(rafId);
      
      // [FIX] Verificaciones estrictas antes de medir
      if (this._isDestroyed || !el || el._virtualIndex !== index) return;
      
      // [FIX] Verificar que el elemento está en el DOM y es válido
      if (!el.isConnected || !el.nodeType || el.nodeType !== 1) return;
      
      if (index < 0 || index >= this.heights.length) return;
      
      try {
        const rect = el.getBoundingClientRect();
        const newHeight = rect.height;
        
        if (newHeight > 0 && this.heights[index] !== newHeight) {
          this.heights[index] = newHeight;
          this._updateAverageHeight();
          this._calculatePositions();
          this._updatePositions();
        }
      } catch (e) {
        console.warn(`VirtualEngine: Error midiendo elemento ${index}:`, e);
      }
    });
    
    this._pendingMeasurements.add(rafId);
  }

  setData(items) {
    if (this._isDestroyed || !Array.isArray(items)) return;
    
    if (this._scrollRaf) {
      cancelAnimationFrame(this._scrollRaf);
      this._scrollRaf = null;
    }
    
    this._pendingMeasurements.forEach(id => cancelAnimationFrame(id));
    this._pendingMeasurements.clear();
    
    this.activeElements.forEach((el) => {
      if (this._intersectionObserver) this._intersectionObserver.unobserve(el);
      if (this._resizeObserver) this._resizeObserver.unobserve(el);
      el._isActive = false;
      el._virtualIndex = -1;
      el.style.display = 'none';
      el.style.transform = 'translateY(-9999px)';
    });
    this.activeElements.clear();
    
    this.items = items;
    this.heights = new Array(items.length).fill(0);
    this.positions = [];
    this.totalHeight = 0;
    this._avgHeight = this.options.itemHeight;
    
    this._calculatePositions();
    this._updateVisibleRange();
  }

  appendItems(newItems) {
    if (this._isDestroyed || !Array.isArray(newItems) || newItems.length === 0) return;
    
    const startIndex = this.items.length;
    this.items = this.items.concat(newItems);
    
    this.heights = this.heights.concat(Array.from({length: newItems.length}, () => 0));
    this.positions = this.positions.concat(Array.from({length: newItems.length}, () => 0));
    
    this._calculatePositionsIncremental(startIndex);
    
    const scrollBottom = (this.container?.scrollTop || 0) + this._viewportHeight;
    if (scrollBottom >= this.totalHeight - (this._avgHeight * 3)) {
      this._updateVisibleRange();
    }
  }

  getVisibleRange() {
    return { start: this.visibleRange.start, end: this.visibleRange.end };
  }

  scrollToIndex(index, behavior = 'smooth') {
    if (this._isDestroyed || index < 0 || index >= this.items.length) return;
    const y = this.positions[index] ?? (index * this.options.itemHeight);
    this.container?.scrollTo({ top: y, behavior });
  }

  refresh() {
    if (this._isDestroyed) return;
    
    this.activeElements.forEach((el, index) => {
      try {
        this.options.renderFn(el, this.items[index], index);
      } catch (err) {
        console.error(`VirtualEngine: Error en refresh índice ${index}:`, err);
      }
      this._scheduleHeightMeasurement(el, index);
    });
  }

  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    
    if (this._scrollRaf) cancelAnimationFrame(this._scrollRaf);
    if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
    
    this._pendingMeasurements.forEach(id => cancelAnimationFrame(id));
    this._pendingMeasurements.clear();
    
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    
    this.container?.removeEventListener('scroll', this._handleScroll);
    window.removeEventListener('resize', this._handleWindowResize);
    
    if (this._spacer?.parentNode) {
      this._spacer.parentNode.removeChild(this._spacer);
    }
    if (this._viewport?.parentNode) {
      this._viewport.parentNode.removeChild(this._viewport);
    }
    
    this.items = [];
    this.heights = [];
    this.positions = [];
    this.pool = [];
    this.activeElements.clear();
    this.container = null;
    this._spacer = null;
    this._viewport = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VirtualEngine };
} else if (typeof window !== 'undefined') {
  window.VirtualEngine = VirtualEngine;
}
