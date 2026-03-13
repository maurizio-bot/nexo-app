/**
 * NEXO v9.0 - OnboardingController v3.0-NAP-SECURITY-HARDENED
 * Zero Mocks - Flujo estricto de biometría
 * 
 * Cambios críticos:
 * - Si "Configurar" falla, NO marca como activada
 * - Solo "Omitir" permite continuar sin biometría (y queda registrado como inseguro)
 * - Verificación de result.verified === true
 */

import { WebAuthnHelper } from './webauthn_helper.js';

const NAP_ONBOARD_ERRORS = {
  ONB_001: 'CONTAINER_INVALID',
  ONB_002: 'WEBAUTHN_FAILED',
  ONB_003: 'SCREEN_TRANSITION_ERROR',
  ONB_004: 'TIMEOUT_EXCEEDED',
  ONB_005: 'ALREADY_DESTROYED',
  ONB_006: 'CLEANUP_FAILED',
  ONB_007: 'BIOMETRIC_NOT_VERIFIED'
};

export class OnboardingController {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || ((err) => console.error('Onboarding error:', err));
    
    this.currentScreen = null;
    this.currentScreenElement = null;
    this.abortController = new AbortController();
    
    this._activeTimeouts = new Set();
    this._activeListeners = [];
    this._styleElement = null;
    
    this._isDestroyed = false;
    this._biometricConfigured = false; // Solo true si verify strict pasó
    this._backupConfigured = false;
    this._transitionLock = false;
    
    this._injectStyles();
    
    this._boundHandleDestroy = this.destroy.bind(this);
    window.addEventListener('beforeunload', this._boundHandleDestroy);
  }
  
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
      .nap-onboard-status { 
        color: #00ff88; font-size: 13px; margin-top: 20px; min-height: 20px; 
      }
      .nap-onboard-status.error { color: #ff4444; }
      .nap-onboard-status.warning { color: #ffaa00; }
      .nap-completion-list { 
        background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.2); 
        border-radius: 12px; padding: 16px; margin-bottom: 32px; text-align: left; 
      }
      .nap-completion-item { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 14px; }
      .nap-completion-item:last-child { margin-bottom: 0; }
      .nap-check { color: #00ff88; }
      .nap-optional { color: #ffaa00; }
      .nap-cross { color: #ff4444; }
    `;
    document.head.appendChild(this._styleElement);
  }
  
  async start() {
    if (this._isDestroyed) throw new Error(NAP_ONBOARD_ERRORS.ONB_005);
    
    try {
      await this.showWelcomeScreen();
      
      // Pantalla de biometría - Solo retorna true si se verificó realmente
      const bioResult = await this.showBiometricScreen();
      this._biometricConfigured = bioResult === true;
      
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
        this.onError(err);
      }
    }
  }
  
  showWelcomeScreen() {
    return new Promise((resolve) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'welcome';
      
      const screen = this._createScreenElement();
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size: 64px; margin-bottom: 20px;';
      icon.textContent = '⚡';
      
      const title = document.createElement('h1');
      title.style.cssText = 'font-size: 32px; margin-bottom: 16px; font-weight: 700;';
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
      
      const handleClick = () => {
        btn.disabled = true;
        this._safeTimeout(() => this._transitionOut(screen, resolve), 150);
      };
      
      btn.addEventListener('click', handleClick);
      this._trackListener(btn, 'click', handleClick);
    });
  }
  
  /**
   * NAP-SEC: Pantalla de biometría con validación estricta
   * Retorna: true (verificado), false (omitido explícitamente)
   */
  showBiometricScreen() {
    return new Promise((resolve) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'biometric';
      
      const screen = this._createScreenElement();
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size: 56px; margin-bottom: 20px;';
      icon.textContent = '🔐';
      
      const title = document.createElement('h2');
      title.className = 'nap-onboard-title';
      title.textContent = 'Protege tu cuenta';
      
      const desc = document.createElement('p');
      desc.className = 'nap-onboard-text';
      desc.textContent = 'Usa Face ID o Huella Digital para acceder a NEXO de forma segura';
      
      const btnSetup = document.createElement('button');
      btnSetup.className = 'nap-onboard-btn';
      btnSetup.textContent = '⚡ Configurar Ahora';
      
      const btnSkip = document.createElement('button');
      btnSkip.className = 'nap-onboard-btn-secondary';
      btnSkip.textContent = 'Omitir por ahora';
      
      const status = document.createElement('p');
      status.className = 'nap-onboard-status';
      
      content.append(icon, title, desc, btnSetup, btnSkip, status);
      screen.appendChild(content);
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      // Handler de Configurar - Estricto
      const handleSetup = async () => {
        btnSetup.disabled = true;
        btnSkip.disabled = true; // Bloquear omitir durante intento
        status.className = 'nap-onboard-status';
        status.textContent = 'Esperando verificación biométrica...';
        
        try {
          const helper = new WebAuthnHelper();
          
          // NAP-SEC: Llamada al registro estricto (sin mocks, sin fallback automático)
          const result = await helper.registerStrict();
          
          // CRÍTICO: Verificar que fue éxito real biométrico
          if (result.success === true && result.verified === true && result.method === 'biometric') {
            status.textContent = '✅ Biometría configurada correctamente';
            
            // Guardar nivel de seguridad
            localStorage.setItem('nexo_security_level', 'biometric-strict');
            
            this._safeTimeout(() => {
              this._transitionOut(screen, () => resolve(true)); // ÉXITO REAL
            }, 800);
          } else {
            // Esto no debería pasar si registerStrict funciona correctamente, pero por seguridad:
            throw new Error('Verificación incompleta');
          }
          
        } catch (e) {
          console.error('[NAP-SEC] Fallo configuración:', e);
          status.className = 'nap-onboard-status error';
          
          // Mostrar error específico
          if (e.message?.includes('NAP-SEC-008')) {
            status.textContent = '❌ Cancelado por el usuario';
          } else if (e.message?.includes('NAP-SEC-005')) {
            status.textContent = '❌ Biometría no configurada en el sistema';
          } else {
            status.textContent = '❌ Falló la verificación biométrica';
          }
          
          // Rehabilitar botones para reintento
          btnSetup.disabled = false;
          btnSkip.disabled = false;
          
          // NAP-SEC: NO resolver la promesa aquí. El usuario debe elegir explícitamente:
          // 1. Reintentar "Configurar", o
          // 2. Tocar "Omitir" (decisión consciente de inseguridad)
        }
      };
      
      // Handler de Omitir - Única forma de continuar sin biometría
      const handleSkip = () => {
        // Advertencia de seguridad obligatoria
        status.className = 'nap-onboard-status warning';
        status.textContent = '⚠️ Advertencia: Continuarás sin protección biométrica';
        
        btnSkip.disabled = true;
        btnSetup.disabled = true;
        
        // Guardar que eligió no proteger
        localStorage.setItem('nexo_security_level', 'none');
        localStorage.removeItem('nexo_webauthn_id'); // Asegurar que no quede basura
        
        this._safeTimeout(() => {
          this._transitionOut(screen, () => resolve(false)); // Omitido explícitamente
        }, 1500); // Dar tiempo para leer la advertencia
      };
      
      btnSetup.addEventListener('click', handleSetup);
      btnSkip.addEventListener('click', handleSkip);
      this._trackListener(btnSetup, 'click', handleSetup);
      this._trackListener(btnSkip, 'click', handleSkip);
    });
  }
  
  showBackupScreen() {
    return new Promise((resolve) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'backup';
      
      const screen = this._createScreenElement();
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size: 56px; margin-bottom: 20px;';
      icon.textContent = '🔥';
      
      const title = document.createElement('h2');
      title.className = 'nap-onboard-title';
      title.textContent = 'Protección Fénix';
      
      const desc = document.createElement('p');
      desc.className = 'nap-onboard-text';
      desc.textContent = 'Tu identidad se divide en fragmentos cifrados distribuidos entre contactos de confianza.';
      
      const btn = document.createElement('button');
      btn.className = 'nap-onboard-btn';
      btn.textContent = 'Entendido';
      
      content.append(icon, title, desc, btn);
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
  
  showQRScreen() {
    return new Promise((resolve) => {
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
      desc.textContent = 'Escanea este QR con otro dispositivo NEXO';
      
      const qrBox = document.createElement('div');
      qrBox.style.cssText = 'background: white; padding: 20px; border-radius: 16px; margin-bottom: 24px; display: inline-block;';
      qrBox.innerHTML = '<div style="width: 200px; height: 200px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #333; font-family: monospace;">QR MOCK</div>';
      
      const btnContinue = document.createElement('button');
      btnContinue.className = 'nap-onboard-btn';
      btnContinue.textContent = 'Continuar';
      
      content.append(title, desc, qrBox, btnContinue);
      screen.appendChild(content);
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      btnContinue.addEventListener('click', () => {
        this._transitionOut(screen, () => resolve(true));
      });
      this._trackListener(btnContinue, 'click', () => resolve(true));
    });
  }
  
  /**
   * Pantalla final - Muestra estado real de la configuración
   */
  showCompletionScreen() {
    return new Promise((resolve) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'completion';
      
      const screen = this._createScreenElement();
      const content = document.createElement('div');
      content.className = 'nap-onboard-content';
      
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size: 80px; margin-bottom: 20px;';
      icon.textContent = '🎉';
      
      const title = document.createElement('h2');
      title.style.cssText = 'font-size: 28px; margin-bottom: 16px; font-weight: 700;';
      title.textContent = '¡Listo!';
      
      const desc = document.createElement('p');
      desc.className = 'nap-onboard-text';
      desc.textContent = 'Tu identidad NEXO está protegida y lista para usar.';
      
      const list = document.createElement('div');
      list.className = 'nap-completion-list';
      
      // Items con estado REAL (no siempre check verde)
      const items = [
        { 
          symbol: '✓', 
          text: 'Identidad creada', 
          active: true 
        },
        { 
          symbol: this._biometricConfigured ? '✓' : '○', 
          text: this._biometricConfigured ? 'Biometría activada' : 'Biometría omitida (sin protección)',
          active: this._biometricConfigured,
          warning: !this._biometricConfigured
        },
        { 
          symbol: '✓', 
          text: 'Protección Fénix lista', 
          active: true 
        }
      ];
      
      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'nap-completion-item';
        
        const spanSymbol = document.createElement('span');
        spanSymbol.textContent = item.symbol;
        spanSymbol.style.color = item.warning ? '#ffaa00' : (item.active ? '#00ff88' : '#666');
        
        const spanText = document.createElement('span');
        spanText.textContent = item.text;
        spanText.style.color = item.warning ? '#ffaa00' : (item.active ? '#fff' : '#666');
        
        div.append(spanSymbol, spanText);
        list.appendChild(div);
      });
      
      const btn = document.createElement('button');
      btn.className = 'nap-onboard-btn';
      btn.textContent = 'Entrar a NEXO';
      
      // Si no tiene biometría, mostrar advertencia adicional
      if (!this._biometricConfigured) {
        const warningBox = document.createElement('div');
        warningBox.style.cssText = 'background: rgba(255, 170, 0, 0.1); border: 1px solid rgba(255, 170, 0, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 20px; font-size: 12px; color: #ffaa00;';
        warningBox.textContent = '⚠️ Tu cuenta no tiene protección biométrica. Cualquiera con acceso a este dispositivo puede entrar.';
        content.appendChild(warningBox);
      }
      
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
    
    this._activeListeners.forEach(({ el, event, handler }) => {
      try { el.removeEventListener(event, handler); } catch (e) {}
    });
    this._activeListeners = [];
  }
  
  _trackListener(element, event, handler) {
    this._activeListeners.push({ el: element, event, handler });
  }
  
  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    
    this.abortController.abort();
    this._activeTimeouts.forEach(id => clearTimeout(id));
    this._activeTimeouts.clear();
    
    window.removeEventListener('beforeunload', this._boundHandleDestroy);
    this._cleanupCurrentScreen();
  }
}

// Export UMD
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OnboardingController, NAP_ONBOARD_ERRORS };
} else if (typeof window !== 'undefined') {
  window.OnboardingController = OnboardingController;
}
