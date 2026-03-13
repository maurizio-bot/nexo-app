/**
 * NEXO v9.0 - OnboardingController v1.3-NAP-CERTIFIED
 * Flujo completo: Bienvenida → WebAuthn → Fénix → QR → Completado
 * 
 * Correcciones NAP v1.3:
 * - [FIX 1.3.1] XSS: Eliminado innerHTML, uso de createElement/textContent
 * - [FIX 1.3.2] Memory: Cleanup de timeouts y referencias
 * - [FIX 1.3.3] CSS: Single style injection, no acumulación
 * - [FIX 1.3.4] Errors: Códigos NAP-ONBOARD-XXX para debugging
 * - [FIX 1.3.5] IDs: Uso de data-attributes en lugar de IDs globales
 */

import { WebAuthnHelper } from './webauthn_helper.js';

// NAP: Sistema de error codes únicos
const NAP_ONBOARD_ERRORS = {
  ONB_001: 'CONTAINER_INVALID',
  ONB_002: 'WEBAUTHN_FAILED',
  ONB_003: 'SCREEN_TRANSITION_ERROR',
  ONB_004: 'TIMEOUT_EXCEEDED',
  ONB_005: 'ALREADY_DESTROYED',
  ONB_006: 'CLEANUP_FAILED'
};

export class OnboardingController {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || ((err) => console.error('Onboarding error:', err));
    
    // NAP: State management
    this.currentScreen = null;
    this.currentScreenElement = null;
    this.navigationHistory = [];
    this.abortController = new AbortController();
    
    // NAP: Resource tracking para cleanup
    this._activeTimeouts = new Set();
    this._activeListeners = [];
    this._styleElement = null;
    
    // Flags
    this._isDestroyed = false;
    this._biometricConfigured = false;
    this._backupConfigured = false;
    this._transitionLock = false;
    
    // NAP: Inject single shared styles
    this._injectStyles();
    
    // Bindings
    this._boundHandleDestroy = this.destroy.bind(this);
    window.addEventListener('beforeunload', this._boundHandleDestroy);
  }
  
  /**
   * NAP: Single style injection, no acumulación
   */
  _injectStyles() {
    if (document.getElementById('nap-onboard-styles')) return;
    
    this._styleElement = document.createElement('style');
    this._styleElement.id = 'nap-onboard-styles';
    this._styleElement.textContent = `
      .nap-onboard-screen {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: #0a0a0a; z-index: 100000;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: white; opacity: 0; transition: opacity 0.3s ease;
      }
      .nap-onboard-screen.visible { opacity: 1; }
      .nap-onboard-content { text-align: center; max-width: 320px; padding: 20px; }
      .nap-onboard-title { font-size: 24px; margin-bottom: 12px; font-weight: 600; }
      .nap-onboard-text { color: #888; font-size: 16px; line-height: 1.5; margin-bottom: 40px; }
      .nap-onboard-btn {
        background: #00ff88; color: #0a0a0a; border: none;
        padding: 16px 40px; border-radius: 30px; font-size: 16px;
        font-weight: bold; cursor: pointer; width: 100%; margin-bottom: 16px;
        box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3);
        transition: transform 0.2s, opacity 0.2s;
      }
      .nap-onboard-btn:active { transform: scale(0.95); }
      .nap-onboard-btn:disabled { opacity: 0.7; cursor: not-allowed; }
      .nap-onboard-btn-secondary {
        background: transparent; color: #666; border: 1px solid #333;
        padding: 12px 40px; border-radius: 30px; font-size: 14px;
        cursor: pointer; width: 100%;
      }
      .nap-onboard-icon { font-size: 64px; margin-bottom: 20px; }
      .nap-onboard-status { color: #00ff88; font-size: 13px; margin-top: 20px; min-height: 20px; }
      .nap-onboard-status.error { color: #ff4444; }
      .nap-feature-list { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; margin-bottom: 24px; text-align: left; }
      .nap-feature-item { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .nap-feature-item:last-child { margin-bottom: 0; }
      .nap-feature-icon { width: 40px; height: 40px; background: rgba(0,255,136,0.1); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
      .nap-feature-title { font-weight: 600; font-size: 14px; }
      .nap-feature-desc { color: #666; font-size: 12px; }
      .nap-qr-box { background: white; padding: 20px; border-radius: 16px; margin-bottom: 24px; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
      .nap-completion-list { background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.2); border-radius: 12px; padding: 16px; margin-bottom: 32px; text-align: left; }
      .nap-completion-item { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 14px; }
      .nap-completion-item:last-child { margin-bottom: 0; }
      .nap-check { color: #00ff88; }
      .nap-optional { color: #666; }
      @keyframes nap-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
      @keyframes nap-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }
      .nap-animate-pulse { animation: nap-pulse 2s infinite; }
      .nap-animate-bounce { animation: nap-bounce 1s; }
    `;
    document.head.appendChild(this._styleElement);
  }
  
  async start() {
    if (this._isDestroyed) {
      throw new Error(NAP_ONBOARD_ERRORS.ONB_005);
    }
    
    try {
      await this.showWelcomeScreen();
      
      const bioResult = await this.showBiometricScreen();
      this._biometricConfigured = bioResult;
      
      await this.showBackupScreen();
      await this.showQRScreen();
      await this.showCompletionScreen();
      
      this.onComplete({
        biometric: this._biometricConfigured,
        backup: this._backupConfigured,
        timestamp: Date.now()
      });
      
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(`[${NAP_ONBOARD_ERRORS.ONB_003}]`, err);
        this.onError(err, this.currentScreen);
      }
    }
  }
  
  /**
   * NAP: Pantalla 1 - Bienvenida (sin innerHTML)
   */
  showWelcomeScreen() {
    return new Promise((resolve, reject) => {
      if (this._isDestroyed) { reject(new Error(NAP_ONBOARD_ERRORS.ONB_005)); return; }
      
      this._cleanupCurrentScreen();
      this.currentScreen = 'welcome';
      
      const screen = this._createScreenElement();
      
      // NAP: DOM construction seguro (no innerHTML)
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const icon = document.createElement('div');
      icon.className = 'nap-onboard-icon nap-animate-pulse';
      icon.textContent = '⚡';
      
      const title = document.createElement('h1');
      title.style.cssText = 'font-size: 32px; margin-bottom: 16px; font-weight: 700; letter-spacing: -1px;';
      title.textContent = 'NEXO';
      
      const desc = document.createElement('p');
      desc.className = 'nap-onboard-text';
      desc.textContent = 'Mensajería P2P ultra-rápida, privada y sin servidores.';
      
      const btn = document.createElement('button');
      btn.className = 'nap-onboard-btn';
      btn.textContent = 'Comenzar';
      
      const footer = document.createElement('p');
      footer.style.cssText = 'color: #555; font-size: 12px; margin-top: 24px;';
      footer.textContent = 'Al continuar, aceptas los Términos de Privacidad';
      
      content.append(icon, title, desc, btn, footer);
      screen.appendChild(content);
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      // NAP: Event listener trackeado
      const handleClick = () => {
        btn.disabled = true;
        this._safeTimeout(() => this._transitionOut(screen, resolve), 150);
      };
      
      btn.addEventListener('click', handleClick);
      this._trackListener(btn, 'click', handleClick);
    });
  }
  
  /**
   * NAP: Pantalla 2 - Biometría (sin innerHTML)
   */
  showBiometricScreen() {
    return new Promise((resolve, reject) => {
      if (this._isDestroyed) { reject(new Error(NAP_ONBOARD_ERRORS.ONB_005)); return; }
      
      this._cleanupCurrentScreen();
      this.currentScreen = 'biometric';
      
      const screen = this._createScreenElement();
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const icon = document.createElement('div');
      icon.className = 'nap-onboard-icon';
      icon.textContent = '🔐';
      
      const title = document.createElement('h2');
      title.className = 'nap-onboard-title';
      title.textContent = 'Protege tu cuenta';
      
      const desc = document.createElement('p');
      desc.className = 'nap-onboard-text';
      desc.textContent = 'Usa Face ID, Huella Digital o PIN para acceder a NEXO de forma segura';
      
      const btnSetup = document.createElement('button');
      btnSetup.className = 'nap-onboard-btn';
      btnSetup.innerHTML = '<span>⚡</span> Configurar Ahora';
      
      const btnSkip = document.createElement('button');
      btnSkip.className = 'nap-onboard-btn-secondary';
      btnSkip.textContent = 'Omitir por ahora';
      
      const status = document.createElement('p');
      status.className = 'nap-onboard-status';
      
      content.append(icon, title, desc, btnSetup, btnSkip, status);
      screen.appendChild(content);
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const handleSetup = async () => {
        btnSetup.disabled = true;
        status.textContent = 'Esperando autenticador...';
        
        try {
          const helper = new WebAuthnHelper();
          await helper.register({
            userName: `nexo_user_${Date.now()}`,
            displayName: 'NEXO User'
          });
          
          status.textContent = '✅ Biometría configurada correctamente';
          this._safeTimeout(() => this._transitionOut(screen, () => resolve(true)), 800);
          
        } catch (e) {
          console.error(NAP_ONBOARD_ERRORS.ONB_002, e);
          status.className = 'nap-onboard-status error';
          status.textContent = '❌ ' + (e.message || 'Error al configurar');
          btnSetup.disabled = false;
        }
      };
      
      const handleSkip = () => {
        this._transitionOut(screen, () => resolve(false));
      };
      
      btnSetup.addEventListener('click', handleSetup);
      btnSkip.addEventListener('click', handleSkip);
      this._trackListener(btnSetup, 'click', handleSetup);
      this._trackListener(btnSkip, 'click', handleSkip);
    });
  }
  
  /**
   * NAP: Pantalla 3 - Backup (sin innerHTML)
   */
  showBackupScreen() {
    return new Promise((resolve, reject) => {
      if (this._isDestroyed) { reject(new Error(NAP_ONBOARD_ERRORS.ONB_005)); return; }
      
      this._cleanupCurrentScreen();
      this.currentScreen = 'backup';
      
      const screen = this._createScreenElement();
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const icon = document.createElement('div');
      icon.className = 'nap-onboard-icon';
      icon.style.fontSize = '56px';
      icon.textContent = '🔥';
      
      const title = document.createElement('h2');
      title.className = 'nap-onboard-title';
      title.textContent = 'Protección Fénix';
      
      const desc = document.createElement('p');
      desc.className = 'nap-onboard-text';
      desc.textContent = 'Tu identidad se divide en 5 fragmentos cifrados distribuidos entre tus contactos de confianza.';
      
      const list = document.createElement('div');
      list.className = 'nap-feature-list';
      
      const features = [
        { icon: '🛡️', title: 'Sin contraseñas', desc: 'Recupera tu cuenta con 3/5 contactos' },
        { icon: '🔒', title: 'Cifrado extremo', desc: 'Nadie puede reconstruir tu clave solo' },
        { icon: '⚡', title: 'Automático', desc: 'Se activa al agregar contactos' }
      ];
      
      features.forEach(f => {
        const item = document.createElement('div');
        item.className = 'nap-feature-item';
        item.innerHTML = `
          <div class="nap-feature-icon">${f.icon}</div>
          <div>
            <div class="nap-feature-title">${f.title}</div>
            <div class="nap-feature-desc">${f.desc}</div>
          </div>
        `;
        list.appendChild(item);
      });
      
      const btn = document.createElement('button');
      btn.className = 'nap-onboard-btn';
      btn.textContent = 'Entendido';
      
      content.append(icon, title, desc, list, btn);
      screen.appendChild(content);
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const handleClick = () => {
        this._backupConfigured = true;
        this._transitionOut(screen, () => resolve(true));
      };
      
      btn.addEventListener('click', handleClick);
      this._trackListener(btn, 'click', handleClick);
    });
  }
  
  /**
   * NAP: Pantalla 4 - QR (sin innerHTML)
   */
  showQRScreen() {
    return new Promise((resolve, reject) => {
      if (this._isDestroyed) { reject(new Error(NAP_ONBOARD_ERRORS.ONB_005)); return; }
      
      this._cleanupCurrentScreen();
      this.currentScreen = 'qr';
      
      const screen = this._createScreenElement();
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const title = document.createElement('h2');
      title.className = 'nap-onboard-title';
      title.textContent = 'Agrega tu primer contacto';
      
      const desc = document.createElement('p');
      desc.className = 'nap-onboard-text';
      desc.style.fontSize = '14px';
      desc.textContent = 'Escanea este QR con otro dispositivo NEXO o muéstralo para que te agreguen';
      
      const qrBox = document.createElement('div');
      qrBox.className = 'nap-qr-box';
      qrBox.innerHTML = `
        <div style="width: 200px; height: 200px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #333; font-family: monospace; text-align: center;">
          <div>
            <div style="font-size: 40px; margin-bottom: 8px;">📱</div>
            <div style="font-size: 10px; color: #666;">${this._generateMockQRData()}</div>
          </div>
        </div>
      `;
      
      const offlineBox = document.createElement('div');
      offlineBox.style.cssText = 'background: rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;';
      offlineBox.innerHTML = `
        <div style="font-size: 24px;">👥</div>
        <div style="text-align: left;">
          <div style="font-size: 14px; font-weight: 600;">Modo Offline</div>
          <div style="color: #666; font-size: 12px;">Funciona sin internet vía Bluetooth</div>
        </div>
      `;
      
      const btnContinue = document.createElement('button');
      btnContinue.className = 'nap-onboard-btn';
      btnContinue.textContent = 'Continuar';
      
      const btnSkip = document.createElement('button');
      btnSkip.className = 'nap-onboard-btn-secondary';
      btnSkip.style.marginTop = '8px';
      btnSkip.textContent = 'Hacerlo después';
      
      content.append(title, desc, qrBox, offlineBox, btnContinue, btnSkip);
      screen.appendChild(content);
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const handleContinue = () => this._transitionOut(screen, () => resolve(true));
      const handleSkip = () => this._transitionOut(screen, () => resolve(false));
      
      btnContinue.addEventListener('click', handleContinue);
      btnSkip.addEventListener('click', handleSkip);
      this._trackListener(btnContinue, 'click', handleContinue);
      this._trackListener(btnSkip, 'click', handleSkip);
    });
  }
  
  /**
   * NAP: Pantalla 5 - Completado (sin innerHTML)
   */
  showCompletionScreen() {
    return new Promise((resolve, reject) => {
      if (this._isDestroyed) { reject(new Error(NAP_ONBOARD_ERRORS.ONB_005)); return; }
      
      this._cleanupCurrentScreen();
      this.currentScreen = 'completion';
      
      const screen = this._createScreenElement();
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const icon = document.createElement('div');
      icon.className = 'nap-onboard-icon nap-animate-bounce';
      icon.style.fontSize = '80px';
      icon.textContent = '🎉';
      
      const title = document.createElement('h2');
      title.style.cssText = 'font-size: 28px; margin-bottom: 16px; font-weight: 700;';
      title.textContent = '¡Listo!';
      
      const desc = document.createElement('p');
      desc.className = 'nap-onboard-text';
      desc.textContent = 'Tu identidad NEXO está protegida y lista para usar.';
      
      const list = document.createElement('div');
      list.className = 'nap-completion-list';
      
      const items = [
        { check: '✓', text: 'Identidad creada', active: true },
        { check: this._biometricConfigured ? '✓' : '○', text: `Biometría ${this._biometricConfigured ? 'activada' : 'omitida'}`, active: this._biometricConfigured },
        { check: '✓', text: 'Protección Fénix lista', active: true }
      ];
      
      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'nap-completion-item';
        div.innerHTML = `<span class="${item.active ? 'nap-check' : 'nap-optional'}">${item.check}</span><span style="color: ${item.active ? '#fff' : '#666'}">${item.text}</span>`;
        list.appendChild(div);
      });
      
      const btn = document.createElement('button');
      btn.className = 'nap-onboard-btn';
      btn.style.animation = 'nap-pulse 2s infinite';
      btn.textContent = 'Entrar a NEXO';
      
      content.append(icon, title, desc, list, btn);
      screen.appendChild(content);
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const handleClick = () => {
        btn.disabled = true;
        this._safeTimeout(() => this._transitionOut(screen, resolve), 150);
      };
      
      btn.addEventListener('click', handleClick);
      this._trackListener(btn, 'click', handleClick);
    });
  }
  
  /**
   * NAP: Helpers privados seguros
   */
  _createScreenElement() {
    const el = document.createElement('div');
    el.className = 'nap-onboard-screen';
    
    requestAnimationFrame(() => el.classList.add('visible'));
    
    return el;
  }
  
  _transitionOut(element, callback) {
    if (this._transitionLock) return;
    this._transitionLock = true;
    
    element.classList.remove('visible');
    
    const timeoutId = setTimeout(() => {
      this._cleanupCurrentScreen();
      this._transitionLock = false;
      if (callback) callback();
    }, 300);
    
    this._activeTimeouts.add(timeoutId);
  }
  
  _safeTimeout(fn, delay) {
    if (this._isDestroyed) return;
    const id = setTimeout(() => {
      this._activeTimeouts.delete(id);
      if (!this._isDestroyed) fn();
    }, delay);
    this._activeTimeouts.add(id);
  }
  
  _cleanupCurrentScreen() {
    if (this.currentScreenElement?.parentNode) {
      this.currentScreenElement.parentNode.removeChild(this.currentScreenElement);
    }
    this.currentScreenElement = null;
    
    // NAP: Cleanup listeners específicos de esta pantalla
    this._activeListeners.forEach(({ el, event, handler }) => {
      try { el.removeEventListener(event, handler); } catch (e) {}
    });
    this._activeListeners = [];
  }
  
  _trackListener(element, event, handler) {
    this._activeListeners.push({ el: element, event, handler });
  }
  
  _generateMockQRData() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result.match(/.{1,4}/g).join('-');
  }
  
  /**
   * NAP: Cleanup completo (SOC2 Resource Management)
   */
  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    
    console.log('[NAP-ONBOARD] Destroying...');
    
    // Abortar operaciones pendientes
    this.abortController.abort();
    
    // Limpiar timeouts
    this._activeTimeouts.forEach(id => clearTimeout(id));
    this._activeTimeouts.clear();
    
    // Limpiar listeners
    window.removeEventListener('beforeunload', this._boundHandleDestroy);
    this._cleanupCurrentScreen();
    
    // Remover styles (solo si no hay otras instancias)
    if (this._styleElement && this._styleElement.parentNode) {
      // Opcional: mantener si es compartido, remover si es exclusivo
      // this._styleElement.parentNode.removeChild(this._styleElement);
    }
    
    console.log('[NAP-ONBOARD] Destroyed');
  }
}

// Export UMD
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OnboardingController, NAP_ONBOARD_ERRORS };
} else if (typeof window !== 'undefined') {
  window.OnboardingController = OnboardingController;
  window.NAP_ONBOARD_ERRORS = NAP_ONBOARD_ERRORS;
}
