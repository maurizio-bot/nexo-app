/**
 * NEXO Onboarding System v1.2-NAP-CORRECTED
 * Flujo de 5 pantallas: Bienvenida → WebAuthn → Backup → QR → Listo
 */

import { WebAuthnHelper } from './webauthn_helper.js';
import { FenixBackup } from '../fenix/fenix_backup.js';
import { ShardCrypto } from '../fenix/shard_crypto.js';

export class OnboardingController {
  constructor(config) {
    this.container = config.container;
    this.vault = config.vault;
    this.onComplete = config.onComplete || (() => {});
    
    this.currentStep = 0;
    this.steps = ['welcome', 'webauthn', 'backup', 'qr', 'complete'];
    this.credentials = null;
    this.backupShards = null;
    
    this.webauthn = new WebAuthnHelper({
      vault: this.vault
    });
    
    this.abortController = new AbortController();
  }

  async start() {
    this.render();
    this.attachListeners();
    await this.showStep(0);
  }

  render() {
    this.container.innerHTML = `
      <div id="onboarding-container" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      ">
        <!-- Progress Bar -->
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: rgba(255,255,255,0.1);
          z-index: 10001;
        ">
          <div id="onboarding-progress" style="
            height: 100%;
            background: linear-gradient(90deg, #00ff88, #00cc6a);
            width: 0%;
            transition: width 0.5s ease;
          "></div>
        </div>

        <!-- Step Container -->
        <div id="onboarding-step-content" style="
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 40px 24px;
          box-sizing: border-box;
        ">
          <!-- Content injected dynamically -->
        </div>

        <!-- Navigation -->
        <div id="onboarding-nav" style="
          padding: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid rgba(255,255,255,0.1);
        ">
          <button id="onboarding-prev" style="
            background: transparent;
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 12px 24px;
            border-radius: 24px;
            cursor: pointer;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s;
          ">Atrás</button>
          
          <div id="onboarding-dots" style="display: flex; gap: 8px;">
            ${this.steps.map((_, i) => `
              <div class="dot" data-step="${i}" style="
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: ${i === 0 ? '#00ff88' : 'rgba(255,255,255,0.3)'};
                transition: all 0.3s;
              "></div>
            `).join('')}
          </div>

          <button id="onboarding-next" style="
            background: #00ff88;
            border: none;
            color: #0a0a0a;
            padding: 12px 32px;
            border-radius: 24px;
            cursor: pointer;
            font-weight: bold;
            transition: transform 0.2s;
          ">Siguiente</button>
        </div>
      </div>
    `;
  }

  attachListeners() {
    const nextBtn = document.getElementById('onboarding-next');
    const prevBtn = document.getElementById('onboarding-prev');

    nextBtn.addEventListener('click', () => this.nextStep());
    prevBtn.addEventListener('click', () => this.prevStep());
    
    // Touch gesture support
    let touchStartX = 0;
    const container = document.getElementById('onboarding-container');
    
    container.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { signal: this.abortController.signal });
    
    container.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const diff = touchStartX - touchEndX;
      
      if (Math.abs(diff) > 50) {
        if (diff > 0 && this.currentStep < this.steps.length - 1) {
          this.nextStep();
        } else if (diff < 0 && this.currentStep > 0) {
          this.prevStep();
        }
      }
    }, { signal: this.abortController.signal });
  }

  async showStep(index) {
    if (index < 0 || index >= this.steps.length) return;
    
    this.currentStep = index;
    const stepName = this.steps[index];
    const content = document.getElementById('onboarding-step-content');
    const progress = document.getElementById('onboarding-progress');
    const prevBtn = document.getElementById('onboarding-prev');
    const nextBtn = document.getElementById('onboarding-next');

    // Update progress
    progress.style.width = `${((index + 1) / this.steps.length) * 100}%`;
    
    // Update dots
    document.querySelectorAll('.dot').forEach((dot, i) => {
      dot.style.background = i <= index ? '#00ff88' : 'rgba(255,255,255,0.3)';
      dot.style.transform = i === index ? 'scale(1.3)' : 'scale(1)';
    });

    // Update buttons
    prevBtn.style.opacity = index > 0 ? '1' : '0';
    prevBtn.style.pointerEvents = index > 0 ? 'auto' : 'none';
    
    if (index === this.steps.length - 1) {
      nextBtn.textContent = '¡Comenzar!';
      nextBtn.style.background = '#00ff88';
    } else {
      nextBtn.textContent = index === 0 ? 'Comenzar' : 'Siguiente';
    }

    // Render step content
    content.style.opacity = '0';
    await new Promise(r => setTimeout(r, 200));
    
    switch(stepName) {
      case 'welcome':
        content.innerHTML = this.renderWelcome();
        break;
      case 'webauthn':
        content.innerHTML = this.renderWebAuthn();
        break;
      case 'backup':
        content.innerHTML = await this.renderBackup();
        break;
      case 'qr':
        content.innerHTML = this.renderQR();
        break;
      case 'complete':
        content.innerHTML = this.renderComplete();
        break;
    }
    
    content.style.opacity = '1';
    
    // Execute step-specific initialization
    if (stepName === 'webauthn') {
      await this.initWebAuthn();
    } else if (stepName === 'qr') {
      this.initQR();
    }
  }

  renderWelcome() {
    return `
      <div style="text-align: center; max-width: 320px;">
        <div style="
          width: 120px;
          height: 120px;
          margin: 0 auto 32px;
          background: linear-gradient(135deg, #00ff88, #00cc6a);
          border-radius: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 20px 40px rgba(0,255,136,0.3);
          animation: pulse 2s infinite;
        ">
          <span style="font-size: 60px;">⚡</span>
        </div>
        <h1 style="
          font-size: 32px;
          margin-bottom: 16px;
          background: linear-gradient(90deg, #fff, #00ff88);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        ">NEXO</h1>
        <p style="
          color: rgba(255,255,255,0.7);
          font-size: 18px;
          line-height: 1.5;
          margin-bottom: 24px;
        ">Mensajería ultra-rápida, privada y sin servidores.</p>
        <div style="
          background: rgba(0,255,136,0.1);
          border: 1px solid rgba(0,255,136,0.3);
          border-radius: 12px;
          padding: 16px;
          font-size: 14px;
          color: #00ff88;
        ">
          🔒 Sin contraseñas · 🚀 P2P directo · 🛡️ Cifrado total
        </div>
      </div>
      <style>
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      </style>
    `;
  }

  renderWebAuthn() {
    return `
      <div style="text-align: center; max-width: 320px;">
        <div style="
          width: 100px;
          height: 100px;
          margin: 0 auto 32px;
          background: rgba(0,255,136,0.1);
          border: 2px solid rgba(0,255,136,0.3);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <span style="font-size: 48px;">🔐</span>
        </div>
        <h2 style="font-size: 24px; margin-bottom: 16px;">Crea tu identidad segura</h2>
        <p style="
          color: rgba(255,255,255,0.7);
          font-size: 16px;
          line-height: 1.5;
          margin-bottom: 32px;
        ">Usa Face ID, huella digital o PIN de tu dispositivo. Sin contraseñas ni datos personales.</p>
        <div id="webauthn-status" style="
          margin-top: 24px;
          padding: 16px;
          border-radius: 12px;
          background: rgba(255,255,255,0.05);
          display: none;
        "></div>
      </div>
    `;
  }

  async renderBackup() {
    return `
      <div style="text-align: center; max-width: 320px;">
        <div style="
          width: 100px;
          height: 100px;
          margin: 0 auto 32px;
          background: rgba(0,255,136,0.1);
          border: 2px solid rgba(0,255,136,0.3);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <span style="font-size: 48px;">🛡️</span>
        </div>
        <h2 style="font-size: 24px; margin-bottom: 16px;">Protección Fénix</h2>
        <p style="
          color: rgba(255,255,255,0.7);
          font-size: 16px;
          line-height: 1.5;
          margin-bottom: 24px;
        ">Tu identidad se divide en 5 fragmentos cifrados y se distribuye automáticamente entre tus contactos de confianza.</p>
        <div style="
          background: rgba(0,255,136,0.1);
          border: 1px solid rgba(0,255,136,0.3);
          border-radius: 12px;
          padding: 16px;
          text-align: left;
          font-size: 14px;
          color: rgba(255,255,255,0.8);
        ">
          <div style="margin-bottom: 8px;">✅ Recuperación automática</div>
          <div style="margin-bottom: 8px;">✅ Sin preguntas de seguridad</div>
          <div>✅ Solo tú controlas tus datos</div>
        </div>
      </div>
    `;
  }

  renderQR() {
    return `
      <div style="text-align: center; max-width: 320px;">
        <h2 style="font-size: 24px; margin-bottom: 16px;">Agrega tu primer contacto</h2>
        <p style="
          color: rgba(255,255,255,0.7);
          font-size: 16px;
          margin-bottom: 24px;
        ">Escanea el código QR de un amigo o muestra el tuyo.</p>
        <div id="qr-container" style="
          background: white;
          padding: 20px;
          border-radius: 16px;
          margin-bottom: 24px;
          display: inline-block;
        ">
          <div style="
            width: 200px;
            height: 200px;
            background: #f0f0f0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #333;
            font-size: 14px;
          ">Generando QR...</div>
        </div>
        <button id="skip-qr" style="
          background: transparent;
          border: none;
          color: rgba(255,255,255,0.5);
          text-decoration: underline;
          cursor: pointer;
        ">Omitir por ahora</button>
      </div>
    `;
  }

  renderComplete() {
    return `
      <div style="text-align: center; max-width: 320px;">
        <div style="
          width: 100px;
          height: 100px;
          margin: 0 auto 32px;
          background: #00ff88;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: scaleIn 0.5s ease;
        ">
          <span style="font-size: 48px;">✓</span>
        </div>
        <h2 style="font-size: 28px; margin-bottom: 16px;">¡Listo!</h2>
        <p style="
          color: rgba(255,255,255,0.7);
          font-size: 16px;
          line-height: 1.5;
        ">Tu identidad NEXO está protegida y lista. Bienvenido al futuro de la mensajería.</p>
      </div>
      <style>
        @keyframes scaleIn {
          from { transform: scale(0); }
          to { transform: scale(1); }
        }
      </style>
    `;
  }

  async initWebAuthn() {
    const status = document.getElementById('webauthn-status');
    const nextBtn = document.getElementById('onboarding-next');
    
    try {
      nextBtn.disabled = true;
      nextBtn.textContent = 'Verificando...';
      
      this.credentials = await this.webauthn.register();
      
      status.style.display = 'block';
      status.style.background = 'rgba(0,255,136,0.1)';
      status.style.border = '1px solid rgba(0,255,136,0.3)';
      status.innerHTML = '<span style="color: #00ff88;">✓ Identidad creada correctamente</span>';
      
      nextBtn.disabled = false;
      nextBtn.textContent = 'Continuar';
      
    } catch (err) {
      status.style.display = 'block';
      status.style.background = 'rgba(255,68,68,0.1)';
      status.style.border = '1px solid rgba(255,68,68,0.3)';
      status.innerHTML = `<span style="color: #ff4444;">✗ ${err.message}</span>`;
      
      nextBtn.disabled = false;
      nextBtn.textContent = 'Reintentar';
    }
  }

  initQR() {
    const skipBtn = document.getElementById('skip-qr');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.nextStep();
      }, { once: true, signal: this.abortController.signal });
    }

    // Generate QR with user identity
    const container = document.getElementById('qr-container');
    if (container && this.vault) {
      const identity = this.vault.getIdentity();
      if (identity) {
        // Simple QR representation (in production, use a QR library)
        container.innerHTML = `
          <div style="
            width: 200px;
            height: 200px;
            background: linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000),
                        linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000);
            background-size: 20px 20px;
            background-position: 0 0, 10px 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            padding: 10px;
            box-sizing: border-box;
          ">
            ${identity.substring(0, 16)}...
          </div>
        `;
      }
    }
  }

  async nextStep() {
    if (this.currentStep === 1 && !this.credentials) {
      // Retry WebAuthn if failed
      await this.initWebAuthn();
      return;
    }

    if (this.currentStep < this.steps.length - 1) {
      await this.showStep(this.currentStep + 1);
    } else {
      await this.complete();
    }
  }

  async prevStep() {
    if (this.currentStep > 0) {
      await this.showStep(this.currentStep - 1);
    }
  }

  async complete() {
    const nextBtn = document.getElementById('onboarding-next');
    nextBtn.textContent = 'Iniciando...';
    nextBtn.disabled = true;

    // Trigger completion callback
    if (this.onComplete) {
      this.onComplete({
        identity: this.vault?.getIdentity(),
        credentials: this.credentials,
        timestamp: Date.now()
      });
    }
  }

  destroy() {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.webauthn) {
      this.webauthn.destroy();
    }
    const container = document.getElementById('onboarding-container');
    if (container) {
      container.remove();
    }
  }
}
