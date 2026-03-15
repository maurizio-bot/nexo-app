// src/core/nap.js - NEXO Auto-Diagnostic Protocol + REM (Retroalimentación Error Message)

export const NEXO_DIAG = {
  container: null,
  logs: [],
  maxLogs: 100,
  _splashHidden: false,
  
  // Sistema REM - Notificaciones visuales
  _toastContainer: null,
  _activeToasts: [],
  
  init: function() {
    const isDev = location.hostname === 'localhost' || 
                  location.hostname === '127.0.0.1' || 
                  location.protocol === 'file:';
    
    // Crear contenedor de toast si no existe
    this._createToastContainer();
    
    if (isDev) {
      this.container = document.getElementById('nexo-diagnostic');
      if (this.container) this.container.classList.add('visible');
      this.log('HTML-INIT: Modo desarrollo', 'info');
    }
    
    this.log(`HTML-ENV: Host=${location.hostname}, SecureContext=${window.isSecureContext}`);
  },
  
  // REM: Crear contenedor de notificaciones
  _createToastContainer: function() {
    if (this._toastContainer) return;
    
    this._toastContainer = document.createElement('div');
    this._toastContainer.id = 'nexo-rem-toasts';
    this._toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      max-width: 400px;
    `;
    document.body.appendChild(this._toastContainer);
  },
  
  // REM: Mostrar notificación visual (toast)
  showToast: function(message, type = 'error', duration = 5000) {
    if (!this._toastContainer) this._createToastContainer();
    
    const toast = document.createElement('div');
    const colors = {
      error: '#ff4444',
      warning: '#ffaa00',
      info: '#00aaff',
      success: '#00ff88'
    };
    
    toast.style.cssText = `
      background: ${colors[type] || colors.error};
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease;
      pointer-events: auto;
      max-width: 100%;
      word-wrap: break-word;
    `;
    
    toast.innerHTML = `
      <strong style="font-weight: 600; display: block; margin-bottom: 4px;">
        ${type === 'error' ? '⚠️ ERROR' : type === 'warning' ? '⚡ AVISO' : type === 'success' ? '✅ ÉXITO' : 'ℹ️ INFO'}
      </strong>
      ${message}
    `;
    
    this._toastContainer.appendChild(toast);
    this._activeToasts.push(toast);
    
    // Auto-remover
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease forwards';
      setTimeout(() => {
        toast.remove();
        this._activeToasts = this._activeToasts.filter(t => t !== toast);
      }, 300);
    }, duration);
  },
  
  // REM: Código principal - muestra error al usuario
  error: function(code, details) {
    const fullMessage = `[${code}] ${details}`;
    this.log(fullMessage, 'error');
    
    // SIEMPRE mostrar toast al usuario (no solo en consola)
    this.showToast(`${code}: ${details}`, 'error', 6000);
    
    // Si es fatal, mostrar pantalla de error
    if (code.startsWith('FATAL') || code.startsWith('INIT-FATAL') || code.startsWith('APP_')) {
      this.showFatal(code, details);
    }
  },
  
  // REM: Éxito/Info también visible
  success: function(message) {
    this.log(message, 'success');
    this.showToast(message, 'success', 3000);
  },
  
  warning: function(message) {
    this.log(message, 'warning');
    this.showToast(message, 'warning', 4000);
  },
  
  info: function(message) {
    this.log(message, 'info');
    this.showToast(message, 'info', 3000);
  },

  log: function(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('es-ES', {hour12: false});
    const entry = { time, msg, type };
    
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();

    if (this.container && this.container.classList.contains('visible')) {
      const div = document.createElement('div');
      div.className = `log-${type}`;
      div.textContent = `${time} ${msg}`;
      this.container.appendChild(div);
      this.container.scrollTop = this.container.scrollHeight;
    }
    
    console.log(`[NEXO-${type.toUpperCase()}] ${msg}`);
  },

  showFatal: function(code, details) {
    // Crear pantalla de error fatal si no existe
    let fatalScreen = document.getElementById('fatal-error');
    if (!fatalScreen) {
      fatalScreen = document.createElement('div');
      fatalScreen.id = 'fatal-error';
      fatalScreen.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: #000;
        color: #ff4444;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        font-family: monospace;
        padding: 20px;
        text-align: center;
      `;
      document.body.appendChild(fatalScreen);
