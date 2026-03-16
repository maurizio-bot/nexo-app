/**
 * NAP - Nexo Architecture Protocol
 * Sistema de revisión, testing y gestión de enlaces
 * v2.0 - NAP-CERTIFIED
 */

class NAPSystem {
  constructor() {
    this.version = '2.0';
    this.certified = new Set();
    this.links = new Map();
    this.logs = [];
    this.maxLogs = 100;
    this.splashVisible = true;
    this.initialized = false;
    this.currentPhase = 'NONE';
  }

  init() {
    if (this.initialized) return this;
    this.log('NAP System v2.0 initialized', 'info', 'NAP_INIT');
    this.initialized = true;
    if (typeof window !== 'undefined') {
      window.NAP = this;
      window.NEXO_DIAG = this;
    }
    return this;
  }

  certify(moduleId, implementation) {
    if (!moduleId || typeof moduleId !== 'string') {
      throw new Error('NAP: moduleId inválido para certificación');
    }
    this.certified.add(moduleId);
    this.log(`Module certified: ${moduleId}`, 'success', 'NAP_CERT');
    if (implementation && typeof implementation === 'object') {
      implementation._napCertified = true;
      implementation._napVersion = this.version;
      implementation._napTimestamp = Date.now();
    }
    return implementation;
  }

  isCertified(moduleId) {
    return this.certified.has(moduleId);
  }

  link(source, target, metadata = {}) {
    if (!source || !target) {
      throw new Error('NAP: source y target requeridos para link');
    }
    const linkId = `${source}::${target}`;
    this.links.set(linkId, {
      id: linkId,
      source,
      target,
      timestamp: Date.now(),
      active: true,
      ...metadata
    });
    this.log(`Link established: ${source} -> ${target}`, 'info', 'NAP_LINK');
    return linkId;
  }

  unlink(linkId) {
    if (this.links.has(linkId)) {
      const link = this.links.get(linkId);
      link.active = false;
      link.destroyedAt = Date.now();
      this.log(`Link destroyed: ${linkId}`, 'warn', 'NAP_UNLINK');
      return true;
    }
    return false;
  }

  getActiveLinks() {
    return Array.from(this.links.values()).filter(link => link.active);
  }

  log(message, type = 'info', code = null) {
    const entry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type,
      message,
      code,
      phase: this.currentPhase
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    const prefix = code ? `[NAP-${code}]` : '[NAP]';
    if (type === 'success') {
      console.log(`%c${prefix} ${message}`, 'color: #00ff88', entry);
    } else if (type === 'error') {
      console.error(`${prefix} ${message}`, entry);
    } else if (type === 'warn') {
      console.warn(`${prefix} ${message}`, entry);
    } else {
      console.log(`${prefix} ${message}`, entry);
    }
    return entry;
  }

  static ERROR_CODES = {
    HTML_001: 'SPLASH_NOT_FOUND',
    HTML_002: 'VAULT_RENDER_FAILED',
    HTML_003: 'DOM_ELEMENT_MISSING',
    APP_001: 'STREAM_APPEND_FAILED',
    APP_002: 'STREAM_INIT_FAILED',
    APP_003: 'BRIDGE_INTERFACE_MISMATCH',
    APP_004: 'VAULT_NOT_INITIALIZED',
    APP_005: 'MESSAGE_HANDLER_ERROR',
    APP_006: 'VIRTUAL_ENGINE_INIT_FAILED',
    APP_007: 'STATUS_UPDATE_FAILED',
    APP_008: 'SEND_MESSAGE_FAILED',
    APP_009: 'GESTURE_INIT_FAILED',
    APP_010: 'CLEANUP_ERROR',
    APP_011: 'MESH_CONNECTION_TIMEOUT',
    APP_012: 'WEBSOCKET_DISCONNECTED'
  };

  getErrorDescription(code) {
    return NAPSystem.ERROR_CODES[code] || 'UNKNOWN_ERROR';
  }

  hideSplash() {
    this.splashVisible = false;
    if (typeof document === 'undefined') return;
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      splash.style.opacity = '0';
      splash.style.transform = 'scale(0.95)';
      setTimeout(() => {
        splash.style.display = 'none';
        this.log('Splash screen hidden', 'info', 'UI_SPLASH');
      }, 500);
    } else {
      this.log('Splash element not found', 'warn', 'HTML_001');
    }
  }

  showSplash() {
    this.splashVisible = true;
    if (typeof document === 'undefined') return;
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.display = 'flex';
      void splash.offsetWidth;
      splash.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      splash.style.opacity = '1';
      splash.style.transform = 'scale(1)';
    }
  }

  isSplashVisible() {
    return this.splashVisible;
  }

  setPhase(phase) {
    this.currentPhase = phase;
    this.log(`Phase transition: ${phase}`, 'info', 'NAP_PHASE');
  }

  getRecentLogs(limit = 10) {
    return this.logs.slice(-limit);
  }

  clearLogs() {
    this.logs = [];
    this.log('Logs cleared', 'info');
  }

  getStatus() {
    return {
      version: this.version,
      initialized: this.initialized,
      phase: this.currentPhase,
      splashVisible: this.splashVisible,
      certifiedModules: Array.from(this.certified),
      activeLinks: this.getActiveLinks().length,
      totalLogs: this.logs.length
    };
  }
}

export const NAP = new NAPSystem();
export const NEXO_DIAG = NAP;
export default NAP;
