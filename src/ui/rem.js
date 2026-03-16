/**
 * REM - Retroalimentación Error Message System v2.0
 * Sistema visual de errores y estados para NEXO
 * Pattern: NAP 2.0 + Non-intrusive UI + SOC2 Audit Trail
 */

const REM_STYLES = {
  container: 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px;max-width:400px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;pointer-events:none;',
  toast: 'background:rgba(15,23,42,0.95);color:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.3);border-left:4px solid;transform:translateX(120%);transition:all 0.3s ease;pointer-events:auto;font-size:13px;line-height:1.4;backdrop-filter:blur(10px);',
  toastError: 'border-left-color:#ef4444;background:rgba(239,68,68,0.1);color:#fecaca;',
  toastWarn: 'border-left-color:#f59e0b;background:rgba(245,158,11,0.1);color:#fde68a;',
  toastSuccess: 'border-left-color:#10b981;background:rgba(16,185,129,0.1);color:#a7f3d0;',
  toastInfo: 'border-left-color:#3b82f6;background:rgba(59,130,246,0.1);color:#bfdbfe;',
  code: 'font-family:monospace;font-size:11px;font-weight:bold;opacity:0.8;margin-right:6px;',
  closeBtn: 'margin-left:12px;opacity:0.5;cursor:pointer;float:right;font-size:16px;line-height:1;',
  statusBar: 'position:fixed;bottom:0;left:0;right:0;height:32px;background:rgba(15,23,42,0.9);color:#94a3b8;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:11px;z-index:9999;border-top:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(10px);',
  statusLeft: 'display:flex;gap:12px;align-items:center;',
  statusBadge: 'padding:2px 8px;border-radius:12px;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:0.5px;',
  badgeOnline: 'background:#10b981;color:#064e3b;',
  badgeOffline: 'background:#ef4444;color:#7f1d1d;',
  badgeConnecting: 'background:#f59e0b;color:#78350f;',
  badgeError: 'background:#dc2626;color:#fef2f2;animation:pulse 2s infinite;',
  phase: 'font-family:monospace;color:#64748b;'
};

const REM_ICONS = {
  error: '✕',
  warn: '⚠',
  success: '✓',
  info: 'ℹ'
};

export class REM {
  constructor(options = {}) {
    this.maxToasts = options.maxToasts || 5;
    this.duration = options.duration || 5000;
    this.toasts = [];
    this.container = null;
    this.statusBar = null;
    this.currentPhase = 'NONE';
    this.currentMode = 'OFFLINE';
    this.isVisible = false;
    this.logHistory = [];
    this.maxHistory = 100;
    
    this._injectStyles();
    this._createContainer();
    this._createStatusBar();
    this._setupKeyboardShortcuts();
  }

  _injectStyles() {
    if (document.getElementById('rem-styles')) return;
    const style = document.createElement('style');
    style.id = 'rem-styles';
    style.textContent = `
      @keyframes remSlideIn { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes remSlideOut { to { transform: translateX(120%); opacity: 0; } }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      .rem-toast { animation: remSlideIn 0.3s ease forwards; }
      .rem-toast.rem-hiding { animation: remSlideOut 0.3s ease forwards; }
    `;
    document.head.appendChild(style);
  }

  _createContainer() {
    this.container = document.createElement('div');
    this.container.className = 'rem-container';
    this.container.style.cssText = REM_STYLES.container;
    document.body.appendChild(this.container);
    this.isVisible = true;
  }

  _createStatusBar() {
    this.statusBar = document.createElement('div');
    this.statusBar.className = 'rem-status-bar';
    this.statusBar.style.cssText = REM_STYLES.statusBar;
    this.statusBar.innerHTML = `
      <div style="${REM_STYLES.statusLeft}">
        <span class="rem-phase" style="${REM_STYLES.phase}">PHASE: NONE</span>
        <span class="rem-mode-badge" style="${REM_STYLES.statusBadge} ${REM_STYLES.badgeOffline}">OFFLINE</span>
        <span class="rem-identity" style="color:#64748b;"></span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="rem-shortcut" style="color:#475569;font-size:10px;">Ctrl+Shift+L</span>
        <span style="color:#475569;">|</span>
        <span class="rem-version">NEXO v2.5</span>
      </div>
    `;
    document.body.appendChild(this.statusBar);
  }

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        this.toggleVisibility();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        this.showHistory();
      }
    });
  }

  show(message, type = 'info', code = null) {
    const toast = document.createElement('div');
    toast.className = 'rem-toast';
    
    const styles = {
      error: REM_STYLES.toastError,
      warn: REM_STYLES.toastWarn,
      success: REM_STYLES.toastSuccess,
      info: REM_STYLES.toastInfo
    }[type] || REM_STYLES.toastInfo;

    toast.style.cssText = REM_STYLES.toast + styles;
    
    const icon = REM_ICONS[type] || REM_ICONS.info;
    const codeStr = code ? `<span style="${REM_STYLES.code}">[${code}]</span>` : '';
    
    toast.innerHTML = `
      <span style="margin-right:8px;">${icon}</span>
      ${codeStr}${message}
      <span class="rem-close" style="${REM_STYLES.closeBtn}">×</span>
    `;

    // Auto-remove
    const timeout = setTimeout(() => this._removeToast(toast), this.duration);
    
    // Click to close
    toast.querySelector('.rem-close').addEventListener('click', () => {
      clearTimeout(timeout);
      this._removeToast(toast);
    });

    // Pause on hover
    toast.addEventListener('mouseenter', () => clearTimeout(timeout));
    toast.addEventListener('mouseleave', () => {
      setTimeout(() => this._removeToast(toast), 1000);
    });

    this.container.appendChild(toast);
    this.toasts.push(toast);

    // Limit toasts
    if (this.toasts.length > this.maxToasts) {
      this._removeToast(this.toasts[0]);
    }

    // Log to history
    this.logHistory.push({
      timestamp: new Date().toISOString(),
      message,
      type,
      code
    });
    if (this.logHistory.length > this.maxHistory) {
      this.logHistory.shift();
    }

    return toast;
  }

  _removeToast(toast) {
    if (!toast.parentNode) return;
    toast.classList.add('rem-hiding');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
        this.toasts = this.toasts.filter(t => t !== toast);
      }
    }, 300);
  }

  updatePhase(phase) {
    this.currentPhase = phase;
    const el = this.statusBar.querySelector('.rem-phase');
    if (el) el.textContent = `PHASE: ${phase}`;
    
    if (phase === 'ERROR') {
      this.statusBar.style.borderTop = '2px solid #ef4444';
    } else if (phase === 'READY') {
      this.statusBar.style.borderTop = '2px solid #10b981';
    } else {
      this.statusBar.style.borderTop = '1px solid rgba(255,255,255,0.1)';
    }
  }

  updateMode(mode) {
    this.currentMode = mode;
    const badge = this.statusBar.querySelector('.rem-mode-badge');
    const styles = {
      'OFFLINE': REM_STYLES.badgeOffline,
      'RELAY': REM_STYLES.badgeOnline,
      'P2P': REM_STYLES.badgeOnline,
      'HYBRID': REM_STYLES.badgeOnline,
      'ERROR': REM_STYLES.badgeError,
      'CONNECTING': REM_STYLES.badgeConnecting
    }[mode] || REM_STYLES.badgeOffline;

    badge.className = 'rem-mode-badge';
    badge.style.cssText = REM_STYLES.statusBadge + ' ' + styles;
    badge.textContent = mode;
  }

  updateIdentity(identity) {
    const el = this.statusBar.querySelector('.rem-identity');
    if (el && identity) {
      el.textContent = `ID: ${identity.substring(0, 8)}...`;
    }
  }

  error(message, code) { return this.show(message, 'error', code); }
  warn(message, code) { return this.show(message, 'warn', code); }
  success(message, code) { return this.show(message, 'success', code); }
  info(message, code) { return this.show(message, 'info', code); }

  toggleVisibility() {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'flex' : 'none';
    this.statusBar.style.display = this.isVisible ? 'flex' : 'none';
  }

  showHistory() {
    console.table(this.logHistory.slice(-20));
    this.info('Historial de errores en consola (Ctrl+Shift+H)', 'REM_001');
  }

  destroy() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    if (this.statusBar) {
      this.statusBar.remove();
      this.statusBar = null;
    }
    const styles = document.getElementById('rem-styles');
    if (styles) styles.remove();
  }
}

// Singleton para toda la app
export const rem = new REM();
