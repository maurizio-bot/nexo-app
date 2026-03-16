/**
 * REM v2.1-COMPACT - Toasts reducidos para pantalla pequeña
 */

class REMSystem {
  constructor() {
    this.version = '2.1';
    this.visible = true;
    this.history = [];
    this.maxHistory = 50; // Reducido
    this.toastDuration = 4000; // Más corto
    this.initialized = false;
    this.elements = {};
    this._lastPhase = 'INIT';
    this._lastMode = 'OFFLINE';
    this._lastId = null;
  }

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

  createToastContainer() {
    if (document.getElementById('rem-toasts')) return;
    const container = document.createElement('div');
    container.id = 'rem-toasts';
    // COMPACTO: Menos espacio, más cerca del borde
    container.style.cssText = `
      position: fixed;
      top: 8px;
      right: 8px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 4px; /* Reducido de 12px */
      pointer-events: none;
      max-width: 320px; /* Más angosto */
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    `;
    document.body.appendChild(container);
    this.elements.toasts = container;
  }

  createStatusBar() {
    if (document.getElementById('rem-status')) return;
    const statusBar = document.createElement('div');
    statusBar.id = 'rem-status';
    // COMPACTO: Altura reducida de 32px a 24px
    statusBar.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 24px; /* Reducido de 32px */
      background: rgba(0, 0, 0, 0.9);
      color: #00ff00;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 10px; /* Más pequeño */
      display: flex;
      align-items: center;
      padding: 0 8px; /* Menos padding */
      gap: 12px; /* Menos gap */
      z-index: 2147483646;
      border-top: 1px solid #333;
      backdrop-filter: blur(10px);
      user-select: none;
    `;
    statusBar.innerHTML = `
      <span style="font-weight: bold; color: #666;">NEXO</span>
      <span id="rem-phase" style="color: #888;">INIT</span>
      <span id="rem-mode" style="color: #ff4444;">OFFLINE</span>
      <span id="rem-id" style="color: #666; margin-left: auto; font-size: 9px;">--</span>
    `;
    document.body.appendChild(statusBar);
    this.elements.status = statusBar;
  }

  injectStyles() {
    if (document.getElementById('rem-styles')) return;
    const style = document.createElement('style');
    style.id = 'rem-styles';
    style.textContent = `
      @keyframes rem-slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes rem-slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
      @keyframes rem-progress {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }
      .rem-toast {
        animation: rem-slideIn 0.2s ease-out;
        pointer-events: auto !important;
        cursor: pointer;
      }
      .rem-toast.rem-hiding {
        animation: rem-slideOut 0.2s ease-in forwards;
      }
    `;
    document.head.appendChild(style);
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        this.toggle();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        this.showHistory();
      }
    });
  }

  error(message, code = '') { return this.show(message, 'error', code); }
  warn(message, code = '') { return this.show(message, 'warning', code); }
  success(message, code = '') { return this.show(message, 'success', code); }
  info(message, code = '') { return this.show(message, 'info', code); }

  show(message, type = 'info', code = '') {
    if (!this.initialized) this.init();
    if (!this.elements.toasts) return null;

    const colors = {
      error: { bg: '#ff4444', icon: '✕' },
      warning: { bg: '#ffaa00', icon: '⚠' },
      success: { bg: '#00ff88', icon: '✓' },
      info: { bg: '#4488ff', icon: 'ℹ' }
    };

    const theme = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.className = 'rem-toast';
    // COMPACTO: Menos padding, fuente más pequeña
    toast.style.cssText = `
      background: rgba(20, 20, 20, 0.95);
      border-left: 3px solid ${theme.bg};
      color: #fff;
      padding: 6px 10px; /* Reducido de 14px 18px */
      border-radius: 4px;
      font-size: 11px; /* Reducido de 13px */
      line-height: 1.3;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 300px;
      word-wrap: break-word;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      gap: 6px;
    `;

    // COMPACTO: Layout horizontal simplificado
    toast.innerHTML = `
      <span style="color: ${theme.bg}; font-size: 12px; flex-shrink: 0;">${theme.icon}</span>
      <div style="flex: 1; min-width: 0;">
        <div style="color: #e0e0e0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${code ? `<span style="color: ${theme.bg}; font-size: 9px; margin-right: 4px;">[${code}]</span>` : ''}
          ${message}
        </div>
      </div>
      <div style="position: absolute; bottom: 0; left: 0; height: 2px; background: ${theme.bg}; width: 100%; transform-origin: left; animation: rem-progress ${this.toastDuration}ms linear;"></div>
    `;

    this.elements.toasts.appendChild(toast);

    this.history.push({ type, message, code, timestamp: Date.now() });
    if (this.history.length > this.maxHistory) this.history.shift();

    toast.addEventListener('click', () => this.hideToast(toast));
    const timeout = setTimeout(() => this.hideToast(toast), this.toastDuration);
    
    toast.addEventListener('mouseenter', () => {
      clearTimeout(timeout);
    });

    return toast;
  }

  hideToast(toast) {
    if (!toast || toast.classList.contains('rem-hiding')) return;
    toast.classList.add('rem-hiding');
    setTimeout(() => toast.remove(), 200);
  }

  updateStatus(phase, mode, id) {
    if (!this.elements.status) return;
    const phaseEl = document.getElementById('rem-phase');
    const modeEl = document.getElementById('rem-mode');
    const idEl = document.getElementById('rem-id');

    if (phaseEl) {
      phaseEl.textContent = phase || 'NONE';
      const colors = {
        'INIT': '#888', 'CRYPTO': '#ffaa00', 'WEBSOCKET': '#4488ff',
        'MESH': '#aa66ff', 'BRIDGE': '#66aaff', 'GESTURES': '#ff66aa',
        'VAULT_SLIDER': '#ff66cc', 'STREAM': '#00ff88', 'READY': '#00ff88', 'ERROR': '#ff4444'
      };
      phaseEl.style.color = colors[phase] || '#888';
    }

    if (modeEl) {
      modeEl.textContent = mode || 'OFFLINE';
      const colors = {
        'OFFLINE': '#ff4444', 'RELAY': '#4488ff', 'P2P': '#00ff88', 'HYBRID': '#ffaa00'
      };
      modeEl.style.color = colors[mode] || '#888';
    }

    if (idEl && id) idEl.textContent = id.substr(0, 6);
  }

  updatePhase(phase) {
    this._lastPhase = phase;
    this.updateStatus(phase, this._lastMode, this._lastId);
  }

  updateMode(mode) {
    this._lastMode = mode;
    this.updateStatus(this._lastPhase, mode, this._lastId);
  }

  updateIdentity(id) {
    this._lastId = id;
    this.updateStatus(this._lastPhase, this._lastMode, id);
  }

  toggle() {
    this.visible = !this.visible;
    [document.getElementById('rem-toasts'), document.getElementById('rem-status')].forEach(el => {
      if (el) el.style.display = this.visible ? 'flex' : 'none';
    });
  }

  showHistory() {
    console.table(this.history.slice(-10));
    this.info(`${this.history.length} entries (see console)`, 'HIST');
  }

  getHistory() { return [...this.history]; }
  
  clearHistory() {
    this.history = [];
    this.info('Cleared', 'CLEAR');
  }

  destroy() {
    ['rem-toasts', 'rem-status', 'rem-styles'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    this.initialized = false;
    this.elements = {};
  }
}

export const rem = new REMSystem();
export default rem;
