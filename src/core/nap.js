// src/core/nap.js - NEXO Auto-Diagnostic Protocol

export const NEXO_DIAG = {
  container: null,
  logs: [],
  maxLogs: 100,
  _splashHidden: false,

  init: function() {
    // Environment detection - mostrar solo en dev/local
    const isDev = location.hostname === 'localhost' || 
                  location.hostname === '127.0.0.1' || 
                  location.protocol === 'file:';
    
    if (isDev) {
      this.container = document.getElementById('nexo-diagnostic');
      if (this.container) this.container.classList.add('visible');
      this.log('HTML-INIT: Modo desarrollo detectado', 'info');
    } else {
      this.log('HTML-INIT: Modo producción - diagnóstico oculto', 'info');
    }

    this.log(`HTML-ENV: Host=${location.hostname}, Protocol=${location.protocol}`);
    this.log(`HTML-ENV: Capacitor=${!!window.Capacitor}, SecureContext=${window.isSecureContext}`);
  },

  // Método audit para SOC2 compliance (llamado desde nexo_app.js y módulos)
  audit: function(action, entity, success) {
    const timestamp = new Date().toLocaleTimeString('es-ES', {hour12: false});
    const msg = `[AUDIT] ${action} | Entity: ${entity} | Success: ${success}`;
    
    // Loggear siempre a consola
    console.log(`[NEXO-AUDIT] ${action}`, { entity, success, timestamp });
    
    // Loggear a UI solo si está visible (modo dev)
    if (this.container && this.container.classList.contains('visible')) {
      this.log(msg, 'info');
    }
  },

  log: function(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('es-ES', {hour12: false});
    const entry = { time, msg, type };
    
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();

    if (this.container && this.container.classList.contains('visible')) {
      const div = document.createElement('div');
      div.className = `log-${type}`;
      
      if (type === 'error') {
        div.innerHTML = `<span class="log-code">ERR</span>${time} ${msg}`;
      } else {
        div.textContent = `${time} ${msg}`;
      }
      
      this.container.appendChild(div);
      this.container.scrollTop = this.container.scrollHeight;
    }
    
    console.log(`[NEXO] ${msg}`);
  },

  error: function(code, details) {
    this.log(`${code}: ${details}`, 'error');
    
    if (code.startsWith('FATAL') || code.startsWith('INIT-FATAL')) {
      this.showFatal(code, details);
    }
  },

  showFatal: function(code, details) {
    const fatalScreen = document.getElementById('fatal-error');
    const fatalCode = document.getElementById('fatal-code');
    
    if (fatalScreen && fatalCode) {
      fatalCode.textContent = `${code}: ${details}`;
      fatalScreen.classList.add('visible');
    }
  },

  // NAP: Splash idempotente - previene múltiples llamadas
  hideSplash: function() {
    if (this._splashHidden) return;
    
    const splash = document.getElementById('splash-native');
    
    if (!splash) {
      this._splashHidden = true;
      return;
    }

    // NAP: Lock para evitar race conditions
    splash.dataset.hiding = 'true';
    this._splashHidden = true;
    this.log('HTML-SPLASH: Ocultando...', 'info');
    
    // Mínimo 2 segundos visibles
    setTimeout(() => {
      splash.classList.add('hidden');
      setTimeout(() => {
        if (splash.parentNode) splash.remove();
      }, 500);
    }, 2000);
  }
};

// Auto-inicializar si estamos en el navegador
if (typeof window !== 'undefined') {
  window.NEXO_DIAG = NEXO_DIAG;
  
  // Resource Error Handler con filtro de scope
  window.addEventListener('error', function(e) {
    const src = e.target.src || e.target?.href;
    
    // NAP: Ignorar recursos externos (CDN, trackers) - reduce ruido
    if (src && !src.includes(window.location.host) && !src.startsWith('blob:')) {
      console.warn('[NEXO] Ignorando error de recurso externo:', src);
      return;
    }
    
    const code = e.target?.tagName === 'IMG' ? 'HTML-IMG-404' : 
                 e.target?.tagName === 'SCRIPT' ? 'HTML-JS-404' : 'HTML-RES-404';
    window.NEXO_DIAG.error(code, `Failed: ${src || 'unknown'}`);
  }, true);

  // Global JS Error Handler
  window.addEventListener('error', function(e) {
    window.NEXO_DIAG.error('HTML-JS-ERROR', `${e.message} at ${e.lineno}:${e.colno}`);
  });

  // Unhandled Promise Rejection Handler
  window.addEventListener('unhandledrejection', function(e) {
    window.NEXO_DIAG.error('HTML-PROMISE-REJECT', e.reason?.message || String(e.reason));
    // Prevenir propagación silenciosa
    e.preventDefault();
  });
}
