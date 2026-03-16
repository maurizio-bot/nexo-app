/**
 * REM - Retroalimentación Error Message System
 * v2.1 - Sistema de feedback visual para NEXO
 * Fix: Agregados métodos updatePhase(), updateMode(), updateIdentity() para compatibilidad con nexo_app.js
 */

class REMSystem {
  constructor() {
    this.version = '2.1';
    this.visible = true;
    this.history = [];
    this.maxHistory = 100;
    this.toastDuration = 5000;
    this.initialized = false;
    this.elements = {};
    
    // Fix: Variables para mantener estado entre llamadas parciales
    this._lastPhase = 'INIT';
    this._lastMode = 'OFFLINE';
    this._lastId = null;
  }

  /**
   * Inicializa el sistema REM y crea elementos DOM
   */
  init() {
    if (this.initialized) return this;
    if (typeof document === 'undefined') return this;

    this.createToastContainer();
    this.createStatusBar();
    this.injectStyles();
    this.setupKeyboardShortcuts();
    
    this.initialized = true;
    this.info('REM v2.1 initialized', 'REM_INIT');
    
    return this;
  }

  /**
   * Crea el contenedor de toasts
   */
  createToastContainer() {
    if (document.getElementById('rem-toasts')) return;

    const container = document.createElement('div');
    container.id = 'rem-toasts';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
      max-width: 450px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    `;
    
    document.body.appendChild(container);
    this.elements.toasts = container;
  }

  /**
   * Crea la barra de estado inferior
   */
  createStatusBar() {
    if (document.getElementById('rem-status')) return;

    const statusBar = document.createElement('div');
    statusBar.id = 'rem-status';
    statusBar.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 32px;
      background: rgba(0, 0, 0, 0.95);
      color: #00ff00;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 12px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 24px;
      z-index: 2147483646;
      border-top: 1px solid #333;
      backdrop-filter: blur(10px);
      user-select: none;
    `;
    
    statusBar.innerHTML = `
      <span style="font-weight: bold; color: #666;">NEXO</span>
      <span id="rem-phase" style="color: #888;">Phase: INIT</span>
      <span id="rem-mode" style="color: #ff4444; font-weight: bold;">Mode: OFFLINE</span>
      <span id="rem-id" style="color: #666; margin-left: auto;">ID: --</span>
      <span style="color: #333; margin-left: 8px;">REM v2.1</span>
    `;
    
    document.body.appendChild(statusBar);
    this.elements.status = statusBar;
  }

  /**
   * Inyecta estilos CSS necesarios
   */
  injectStyles() {
    if (document.getElementById('rem-styles')) return;

    const style = document.createElement('style');
    style.id = 'rem-styles';
    style.textContent = `
      @keyframes rem-slideIn {
        from { transform: translateX(100%) scale(0.9); opacity: 0; }
        to { transform: translateX(0) scale(1); opacity: 1; }
      }
      @keyframes rem-slideOut {
        from { transform: translateX(0) scale(1); opacity: 1; }
        to { transform: translateX(100%) scale(0.9); opacity: 0; }
      }
      @keyframes rem-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      .rem-toast {
        animation: rem-slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto !important;
        cursor: pointer;
      }
      .rem-toast:hover {
        transform: translateX(-4px);
      }
      .rem-toast.rem-hiding {
        animation: rem-slideOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
    `;
    
    document.head.appendChild(style);
  }

  /**
   * Configura atajos de teclado
   */
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+L: Toggle REM visibility
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        this.toggle();
      }
      
      // Ctrl+Shift+H: Show history
      if (e.ctrlKey && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        this.showHistory();
      }
      
      // Ctrl+Shift+V: Toggle Vault (simulado)
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        this.info('Vault toggle requested', 'REM_VAULT');
        window.dispatchEvent(new CustomEvent('nexo:vault:toggle'));
      }
    });
  }

  /**
   * Muestra un error (toast rojo)
   */
  error(message, code = '') {
    return this.show(message, 'error', code);
  }

  /**
   * Muestra una advertencia (toast amarillo/naranja)
   */
  warn(message, code = '') {
    return this.show(message, 'warning', code);
  }

  /**
   * Muestra éxito (toast verde)
   */
  success(message, code = '') {
    return this.show(message, 'success', code);
  }

  /**
   * Muestra información (toast azul)
   */
  info(message, code = '') {
    return this.show(message, 'info', code);
  }

  /**
   * Muestra un toast genérico
   */
  show(message, type = 'info', code = '') {
    if (!this.initialized) this.init();
    if (!this.elements.toasts) return null;

    const colors = {
      error: { bg: '#ff4444', border: '#ff2222', icon: '✕' },
      warning: { bg: '#ffaa00', border: '#ff8800', icon: '⚠' },
      success: { bg: '#00ff88', border: '#00cc66', icon: '✓' },
      info: { bg: '#4488ff', border: '#2266dd', icon: 'ℹ' }
    };

    const theme = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.className = 'rem-toast';
    toast.style.cssText = `
      background: rgba(20, 20, 20, 0.95);
      border-left: 4px solid ${theme.bg};
      color: #fff;
      padding: 14px 18px;
      border-radius: 6px;
      font-size: 13px;
      line-height: 1.5;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2);
      max-width: 400px;
      word-wrap: break-word;
      position: relative;
      overflow: hidden;
    `;

    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
        <span style="color: ${theme.bg}; font-weight: bold; font-size: 14px;">${theme.icon}</span>
        <span style="color: ${theme.bg}; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">
          ${type}
        </span>
        ${code ? `<span style="background: ${theme.bg}22; color: ${theme.bg}; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-family: monospace;">${code}</span>` : ''}
      </div>
      <div style="color: #e0e0e0; padding-left: 22px;">${message}</div>
      <div style="position: absolute; bottom: 0; left: 0; height: 2px; background: ${theme.bg}; width: 100%; transform-origin: left; animation: rem-progress ${this.toastDuration}ms linear;"></div>
    `;

    if (!document.getElementById('rem-progress-style')) {
      const progressStyle = document.createElement('style');
      progressStyle.id = 'rem-progress-style';
      progressStyle.textContent = `
        @keyframes rem-progress {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }
      `;
      document.head.appendChild(progressStyle);
    }

    this.elements.toasts.appendChild(toast);

    this.history.push({
      id: Math.random().toString(36).substr(2, 9),
      type,
      message,
      code,
      timestamp: Date.now()
    });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    toast.addEventListener('click', () => this.hideToast(toast));

    const timeout = setTimeout(() => this.hideToast(toast), this.toastDuration);

    toast.addEventListener('mouseenter', () => {
      clearTimeout(timeout);
      const progress = toast.querySelector('[style*="rem-progress"]');
      if (progress) progress.style.animationPlayState = 'paused';
    });

    return toast;
  }

  /**
   * Oculta un toast específico
   */
  hideToast(toast) {
    if (!toast || toast.classList.contains('rem-hiding')) return;
    
    toast.classList.add('rem-hiding');
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  }

  /**
   * Actualiza la barra de estado inferior (método completo)
   */
  updateStatus(phase, mode, id) {
    if (!this.elements.status) return;

    const phaseEl = document.getElementById('rem-phase');
    const modeEl = document.getElementById('rem-mode');
    const idEl = document.getElementById('rem-id');

    if (phaseEl) {
      phaseEl.textContent = `Phase: ${phase || 'NONE'}`;
      const phaseColors = {
        'INIT': '#888', 'CRYPTO': '#ffaa00', 'WEBSOCKET': '#4488ff',
        'MESH': '#aa66ff', 'BRIDGE': '#66aaff', 'GESTURES': '#ff66aa',
        'VAULT_SLIDER': '#ff66cc', 'STREAM': '#00ff88', 'READY': '#00ff88', 'ERROR': '#ff4444'
      };
      phaseEl.style.color = phaseColors[phase] || '#888';
    }

    if (modeEl) {
      modeEl.textContent = `Mode: ${mode || 'OFFLINE'}`;
      const modeColors = {
        'OFFLINE': '#ff4444',
        'RELAY': '#4488ff',
        'P2P': '#00ff88',
        'HYBRID': '#ffaa00',
        'CONNECTING': '#ffaa00'
      };
      modeEl.style.color = modeColors[mode] || '#888';
    }

    if (idEl) {
      idEl.textContent = `ID: ${id ? id.substr(0, 8) : '--'}`;
    }
  }

  /**
   * FIX CRÍTICO: Actualiza solo la fase (usado por nexo_app.js)
   */
  updatePhase(phase) {
    this._lastPhase = phase;
    this.updateStatus(phase, this._lastMode, this._lastId);
  }

  /**
   * FIX CRÍTICO: Actualiza solo el modo (usado por nexo_app.js)
   */
  updateMode(mode) {
    this._lastMode = mode;
    this.updateStatus(this._lastPhase, mode, this._lastId);
  }

  /**
   * FIX CRÍTICO: Actualiza solo el ID (usado por nexo_app.js)
   */
  updateIdentity(id) {
    this._lastId = id;
    this.updateStatus(this._lastPhase, this._lastMode, id);
  }

  /**
   * Muestra/oculta toda la interfaz REM
   */
  toggle() {
    this.visible = !this.visible;
    
    const containers = [
      document.getElementById('rem-toasts'),
      document.getElementById('rem-status')
    ];
    
    containers.forEach(el => {
      if (el) el.style.display = this.visible ? 'flex' : 'none';
    });
    
    console.log(`[REM] Visibility: ${this.visible ? 'ON' : 'OFF'}`);
  }

  /**
   * Muestra el historial completo en consola
   */
  showHistory() {
    console.group('📋 REM History');
    console.table(this.history.slice(-20));
    console.groupEnd();
    
    this.info(`Showing ${this.history.length} history entries (see console)`, 'REM_HIST');
  }

  /**
   * Obtiene el historial
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Limpia el historial
   */
  clearHistory() {
    this.history = [];
    this.info('History cleared', 'REM_CLEAR');
  }

  /**
   * Destruye el sistema REM (cleanup)
   */
  destroy() {
    ['rem-toasts', 'rem-status', 'rem-styles', 'rem-progress-style'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    this.initialized = false;
    this.elements = {};
  }
}

// Singleton export
export const rem = new REMSystem();
export default rem;
