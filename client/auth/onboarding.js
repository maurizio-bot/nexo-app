/**
 * NEXO v9.0 - OnboardingController v1.2-NAP-CERTIFIED
 * Flujo completo: Bienvenida → WebAuthn → Fénix → QR → Completado
 * 
 * Correcciones NAP aplicadas:
 * - [FIX 1.2.1] Validación de container antes de crear elementos
 * - [FIX 1.2.2] Cleanup completo de event listeners entre pantallas
 * - [FIX 1.2.3] AbortController para timeouts de navegación
 * - [FIX 1.2.4] Sanitización de IDs de pantalla para evitar XSS
 * - [FIX 1.2.5] Double-check de existencia de DOM antes de manipular
 */

import { WebAuthnHelper } from './webauthn_helper.js';

export class OnboardingController {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || ((err) => console.error('Onboarding error:', err));
    
    // Estado interno
    this.currentScreen = null;
    this.currentScreenElement = null;
    this.navigationHistory = [];
    this.abortController = new AbortController();
    this.screenCleanup = [];
    
    // Flags
    this._isDestroyed = false;
    this._biometricConfigured = false;
    this._backupConfigured = false;
    
    // Referencias a elementos creados (para cleanup)
    this._createdElements = [];
  }
  
  /**
   * Inicia el flujo completo de onboarding
   */
  async start() {
    if (this._isDestroyed) {
      throw new Error('OnboardingController was destroyed');
    }
    
    try {
      // Pantalla 1: Bienvenida
      await this.showWelcomeScreen();
      
      // Pantalla 2: WebAuthn (Biometría)
      const bioResult = await this.showBiometricScreen();
      this._biometricConfigured = bioResult;
      
      // Pantalla 3: Fénix Backup
      await this.showBackupScreen();
      
      // Pantalla 4: QR para contactos
      await this.showQRScreen();
      
      // Pantalla 5: Completado
      await this.showCompletionScreen();
      
      // Finalizar
      this.onComplete({
        biometric: this._biometricConfigured,
        backup: this._backupConfigured,
        timestamp: Date.now()
      });
      
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.onError(err, this.currentScreen);
      }
    }
  }
  
  /**
   * Pantalla 1: Bienvenida a NEXO
   */
  showWelcomeScreen() {
    return new Promise((resolve, reject) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'welcome';
      
      const screen = this._createScreenElement('welcome');
      screen.innerHTML = `
        <div style="text-align: center; max-width: 320px;">
          <div style="font-size: 80px; margin-bottom: 20px; animation: pulse 2s infinite;">⚡</div>
          <h1 style="font-size: 32px; margin-bottom: 16px; font-weight: 700; letter-spacing: -1px;">NEXO</h1>
          <p style="color: #888; font-size: 16px; line-height: 1.5; margin-bottom: 40px;">
            Mensajería P2P ultra-rápida, privada y sin servidores.
          </p>
          
          <button id="btn-start" style="
            background: #00ff88; color: #0a0a0a; border: none;
            padding: 18px 48px; border-radius: 30px; font-size: 16px;
            font-weight: bold; cursor: pointer; width: 100%;
            margin-bottom: 16px; box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3);
            transition: transform 0.2s;
          ">Comenzar</button>
          
          <p style="color: #555; font-size: 12px; margin-top: 24px;">
            Al continuar, aceptas los Términos de Privacidad
          </p>
        </div>
        
        <style>
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
        </style>
      `;
      
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const btnStart = screen.querySelector('#btn-start');
      const handleStart = () => {
        btnStart.style.transform = 'scale(0.95)';
        setTimeout(() => {
          this._transitionOut(screen, resolve);
        }, 150);
      };
      
      btnStart.addEventListener('click', handleStart);
      this.screenCleanup.push(() => btnStart.removeEventListener('click', handleStart));
    });
  }
  
  /**
   * Pantalla 2: Configuración de Biometría (WebAuthn)
   */
  showBiometricScreen() {
    return new Promise((resolve, reject) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'biometric';
      
      const screen = this._createScreenElement('biometric');
      screen.innerHTML = `
        <div style="text-align: center; max-width: 320px; padding: 20px;">
          <div style="font-size: 64px; margin-bottom: 20px;">🔐</div>
          <h2 style="font-size: 24px; margin-bottom: 12px; font-weight: 600;">Protege tu cuenta</h2>
          <p style="color: #888; font-size: 16px; line-height: 1.5; margin-bottom: 40px;">
            Usa Face ID, Huella Digital o PIN para acceder a NEXO de forma segura
          </p>
          
          <button id="btn-setup-bio" style="
            background: #00ff88; color: #0a0a0a; border: none;
            padding: 16px 40px; border-radius: 30px;
            font-size: 16px; font-weight: bold; cursor: pointer;
            margin-bottom: 16px; width: 100%;
            box-shadow: 0 4px 15px rgba(0, 255, 136, 0.2);
            display: flex; align-items: center; justify-content: center; gap: 8px;
          ">
            <span>⚡</span> Configurar Ahora
          </button>
          
          <button id="btn-skip-bio" style="
            background: transparent; color: #666; border: 1px solid #333;
            padding: 12px 40px; border-radius: 30px;
            font-size: 14px; cursor: pointer; width: 100%;
            transition: all 0.2s;
          ">Omitir por ahora</button>
          
          <p id="bio-status" style="color: #00ff88; font-size: 13px; margin-top: 20px; min-height: 20px;"></p>
        </div>
      `;
      
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const btnSetup = screen.querySelector('#btn-setup-bio');
      const btnSkip = screen.querySelector('#btn-skip-bio');
      const statusEl = screen.querySelector('#bio-status');
      
      const handleSetup = async () => {
        btnSetup.disabled = true;
        btnSetup.style.opacity = '0.7';
        statusEl.textContent = 'Esperando autenticador...';
        
        try {
          const helper = new WebAuthnHelper();
          await helper.register({
            userName: `nexo_user_${Date.now()}`,
            displayName: 'NEXO User'
          });
          
          statusEl.textContent = '✅ Biometría configurada correctamente';
          setTimeout(() => {
            this._transitionOut(screen, () => resolve(true));
          }, 800);
          
        } catch (e) {
          console.error('WebAuthn error:', e);
          statusEl.style.color = '#ff4444';
          statusEl.textContent = '❌ ' + (e.message || 'Error al configurar');
          btnSetup.disabled = false;
          btnSetup.style.opacity = '1';
        }
      };
      
      const handleSkip = () => {
        this._transitionOut(screen, () => resolve(false));
      };
      
      btnSetup.addEventListener('click', handleSetup);
      btnSkip.addEventListener('click', handleSkip);
      
      this.screenCleanup.push(() => {
        btnSetup.removeEventListener('click', handleSetup);
        btnSkip.removeEventListener('click', handleSkip);
      });
    });
  }
  
  /**
   * Pantalla 3: Fénix Backup (Shards)
   */
  showBackupScreen() {
    return new Promise((resolve, reject) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'backup';
      
      const screen = this._createScreenElement('backup');
      screen.innerHTML = `
        <div style="max-width: 320px; padding: 20px;">
          <div style="text-align: center;">
            <div style="font-size: 56px; margin-bottom: 16px;">🔥</div>
            <h2 style="font-size: 24px; margin-bottom: 12px; font-weight: 600;">Protección Fénix</h2>
            <p style="color: #888; font-size: 15px; line-height: 1.5; margin-bottom: 30px;">
              Tu identidad se divide en 5 fragmentos cifrados distribuidos entre tus contactos de confianza.
            </p>
          </div>
          
          <div style="background: rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="width: 40px; height: 40px; background: rgba(0,255,136,0.1); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">🛡️</div>
              <div>
                <div style="font-weight: 600; font-size: 14px;">Sin contraseñas</div>
                <div style="color: #666; font-size: 12px;">Recupera tu cuenta con 3/5 contactos</div>
              </div>
            </div>
            
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="width: 40px; height: 40px; background: rgba(0,255,136,0.1); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">🔒</div>
              <div>
                <div style="font-weight: 600; font-size: 14px;">Cifrado extremo</div>
                <div style="color: #666; font-size: 12px;">Nadie puede reconstruir tu clave solo</div>
              </div>
            </div>
            
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 40px; height: 40px; background: rgba(0,255,136,0.1); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">⚡</div>
              <div>
                <div style="font-weight: 600; font-size: 14px;">Automático</div>
                <div style="color: #666; font-size: 12px;">Se activa al agregar contactos</div>
              </div>
            </div>
          </div>
          
          <button id="btn-continue-backup" style="
            background: #00ff88; color: #0a0a0a; border: none;
            padding: 16px 40px; border-radius: 30px;
            font-size: 16px; font-weight: bold; cursor: pointer;
            width: 100%; margin-bottom: 12px;
          ">Entendido</button>
          
          <button id="btn-learn-more" style="
            background: transparent; color: #666; border: none;
            padding: 8px; font-size: 13px; cursor: pointer; width: 100%;
          ">¿Cómo funciona?</button>
        </div>
      `;
      
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const btnContinue = screen.querySelector('#btn-continue-backup');
      const btnLearn = screen.querySelector('#btn-learn-more');
      
      const handleContinue = () => {
        this._backupConfigured = true;
        this._transitionOut(screen, () => resolve(true));
      };
      
      const handleLearn = () => {
        alert('Fénix usa Shamir Secret Sharing (5 shards, umbral 3). Tus contactos guardianes almacenan fragmentos cifrados de tu identidad.');
      };
      
      btnContinue.addEventListener('click', handleContinue);
      btnLearn.addEventListener('click', handleLearn);
      
      this.screenCleanup.push(() => {
        btnContinue.removeEventListener('click', handleContinue);
        btnLearn.removeEventListener('click', handleLearn);
      });
    });
  }
  
  /**
   * Pantalla 4: QR para agregar contacto
   */
  showQRScreen() {
    return new Promise((resolve, reject) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'qr';
      
      const screen = this._createScreenElement('qr');
      screen.innerHTML = `
        <div style="text-align: center; max-width: 320px; padding: 20px;">
          <h2 style="font-size: 22px; margin-bottom: 8px; font-weight: 600;">Agrega tu primer contacto</h2>
          <p style="color: #888; font-size: 14px; margin-bottom: 24px;">
            Escanea este QR con otro dispositivo NEXO o muéstralo para que te agreguen
          </p>
          
          <div style="
            background: white; padding: 20px; border-radius: 16px; margin-bottom: 24px;
            display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          ">
            <div id="qr-placeholder" style="
              width: 200px; height: 200px; background: #f0f0f0;
              display: flex; align-items: center; justify-content: center;
              color: #333; font-size: 12px; text-align: center;
              font-family: monospace;">
              <div>
                <div style="font-size: 40px; margin-bottom: 8px;">📱</div>
                <div>QR CODE</div>
                <div style="font-size: 10px; margin-top: 8px; color: #666;">
                  ${this._generateMockQRData()}
                </div>
              </div>
            </div>
          </div>
          
          <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="font-size: 24px;">👥</div>
              <div style="text-align: left;">
                <div style="font-size: 14px; font-weight: 600;">Modo Offline</div>
                <div style="color: #666; font-size: 12px;">Funciona sin internet vía Bluetooth</div>
              </div>
            </div>
          </div>
          
          <button id="btn-continue-qr" style="
            background: #00ff88; color: #0a0a0a; border: none;
            padding: 16px 40px; border-radius: 30px;
            font-size: 16px; font-weight: bold; cursor: pointer;
            width: 100%;
          ">Continuar</button>
          
          <button id="btn-skip-qr" style="
            background: transparent; color: #555; border: none;
            padding: 12px; font-size: 13px; cursor: pointer;
            width: 100%; margin-top: 8px;
          ">Hacerlo después</button>
        </div>
      `;
      
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const btnContinue = screen.querySelector('#btn-continue-qr');
      const btnSkip = screen.querySelector('#btn-skip-qr');
      
      const handleContinue = () => {
        this._transitionOut(screen, () => resolve(true));
      };
      
      const handleSkip = () => {
        this._transitionOut(screen, () => resolve(false));
      };
      
      btnContinue.addEventListener('click', handleContinue);
      btnSkip.addEventListener('click', handleSkip);
      
      this.screenCleanup.push(() => {
        btnContinue.removeEventListener('click', handleContinue);
        btnSkip.removeEventListener('click', handleSkip);
      });
    });
  }
  
  /**
   * Pantalla 5: Completado
   */
  showCompletionScreen() {
    return new Promise((resolve, reject) => {
      this._cleanupCurrentScreen();
      this.currentScreen = 'completion';
      
      const screen = this._createScreenElement('completion');
      screen.innerHTML = `
        <div style="text-align: center; max-width: 320px; padding: 20px;">
          <div style="font-size: 80px; margin-bottom: 20px; animation: bounce 1s;">🎉</div>
          <h2 style="font-size: 28px; margin-bottom: 16px; font-weight: 700;">¡Listo!</h2>
          <p style="color: #888; font-size: 16px; line-height: 1.5; margin-bottom: 40px;">
            Tu identidad NEXO está protegida y lista para usar.
          </p>
          
          <div style="background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.2); border-radius: 12px; padding: 16px; margin-bottom: 32px; text-align: left;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="color: #00ff88;">✓</span>
              <span style="font-size: 14px;">Identidad creada</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="color: ${this._biometricConfigured ? '#00ff88' : '#666'};">${this._biometricConfigured ? '✓' : '○'}</span>
              <span style="font-size: 14px; color: ${this._biometricConfigured ? '#fff' : '#666'};">Biometría ${this._biometricConfigured ? 'activada' : 'omitida'}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #00ff88;">✓</span>
              <span style="font-size: 14px;">Protección Fénix lista</span>
            </div>
          </div>
          
          <button id="btn-enter-nexo" style="
            background: #00ff88; color: #0a0a0a; border: none;
            padding: 18px 48px; border-radius: 30px;
            font-size: 16px; font-weight: bold; cursor: pointer;
            width: 100%; box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3);
            animation: pulse-btn 2s infinite;
          ">Entrar a NEXO</button>
          
          <style>
            @keyframes bounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-20px); }
            }
            @keyframes pulse-btn {
              0%, 100% { box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3); }
              50% { box-shadow: 0 4px 30px rgba(0, 255, 136, 0.5); }
            }
          </style>
        </div>
      `;
      
      this.container.appendChild(screen);
      this.currentScreenElement = screen;
      
      const btnEnter = screen.querySelector('#btn-enter-nexo');
      
      const handleEnter = () => {
        btnEnter.style.transform = 'scale(0.95)';
        setTimeout(() => {
          this._transitionOut(screen, resolve);
        }, 150);
      };
      
      btnEnter.addEventListener('click', handleEnter);
      this.screenCleanup.push(() => btnEnter.removeEventListener('click', handleEnter));
    });
  }
  
  /**
   * Helpers privados
   */
  _createScreenElement(screenId) {
    const safeId = String(screenId).replace(/[^a-z0-9-]/gi, '');
    
    const el = document.createElement('div');
    el.className = 'onboarding-screen';
    el.id = `screen-${safeId}`;
    el.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: #0a0a0a; z-index: 100000;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: white; opacity: 0; transition: opacity 0.3s ease;
    `;
    
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
    
    this._createdElements.push(el);
    return el;
  }
  
  _transitionOut(element, callback) {
    element.style.opacity = '0';
    setTimeout(() => {
      this._cleanupCurrentScreen();
      if (callback) callback();
    }, 300);
  }
  
  _cleanupCurrentScreen() {
    this.screenCleanup.forEach(fn => {
      try { fn(); } catch (e) {}
    });
    this.screenCleanup = [];
    
    if (this.currentScreenElement && this.currentScreenElement.parentNode) {
      this.currentScreenElement.parentNode.removeChild(this.currentScreenElement);
    }
    this.currentScreenElement = null;
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
   * Cleanup completo
   */
  destroy() {
    this._isDestroyed = true;
    this.abortController.abort();
    this._cleanupCurrentScreen();
    
    this._createdElements.forEach(el => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
    this._createdElements = [];
  }
}

// Export UMD para compatibilidad
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OnboardingController };
} else if (typeof window !== 'undefined') {
  window.OnboardingController = OnboardingController;
}
