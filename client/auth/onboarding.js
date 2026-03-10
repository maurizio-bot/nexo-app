/**
 * NEXO Onboarding System v1.1-NAP-CERTIFIED-CORRECTED
 * Fixes: Memory leaks, AbortController reset, null checks, button debounce
 */

export class OnboardingController {
  constructor(config = {}) {
    // ... validaciones existentes ...
    
    this.currentStep = 0;
    this.totalSteps = 5;
    this.credentials = null;
    this.abortController = new AbortController();
    this.eventListeners = [];
    this.stylesInjected = false;
    this.destroyed = false;
    this.isTransitioning = false; // [FIX] Prevenir clicks durante transiciones
    
    // [FIX] Referencia al elemento progress para evitar recreación constante
    this.progressElement = null;
    
    // Bindings... (mantener todos)
  }
  
  async start() {
    if (this.destroyed) {
      throw new Error('OnboardingController: Cannot start after destroy');
    }
    
    // [FIX] Prevenir doble inicialización
    if (this.isTransitioning) return;
    
    try {
      this.isTransitioning = true;
      this.container.innerHTML = '';
      this.container.className = 'onboarding-container';
      this._injectStyles();
      await this._showStep(0);
    } catch (err) {
      console.error('Onboarding start failed:', err);
      throw err;
    } finally {
      this.isTransitioning = false;
    }
  }
  
  _updateProgress() {
    if (this.destroyed) return;
    
    // [FIX] Reutilizar elemento existente en lugar de recrear
    if (!this.progressElement) {
      this.progressElement = document.createElement('div');
      this.progressElement.className = 'onboarding-progress';
      // [FIX] Append al body o a un contenedor padre estable, no al container que se limpia
      document.body.appendChild(this.progressElement);
    }
    
    this.progressElement.innerHTML = '';
    
    for (let i = 0; i < this.totalSteps; i++) {
      const dot = document.createElement('div');
      dot.className = 'progress-dot' + (i === this.currentStep ? ' active' : '');
      this.progressElement.appendChild(dot);
    }
  }
  
  async _showStep(step) {
    if (this.destroyed || this.isTransitioning) return; // [FIX] Bloquear durante transición
    if (step < 0 || step >= this.totalSteps) return;
    
    this.isTransitioning = true;
    this.currentStep = step;
    
    try {
      this._cleanupCurrentStep(); // [FIX] Limpiar listeners antes de cambiar DOM
      this._updateProgress();
      
      const stepContainer = document.createElement('div');
      stepContainer.className = 'onboarding-step';
      
      switch(step) {
        case 0: await this._renderWelcome(stepContainer); break;
        case 1: await this._renderWebAuthn(stepContainer); break;
        case 2: await this._renderBackup(stepContainer); break;
        case 3: await this._renderQR(stepContainer); break;
        case 4: await this._renderReady(stepContainer); break;
      }
      
      // [FIX] Transición suave sin innerHTML violento
      this.container.innerHTML = '';
      this.container.appendChild(stepContainer);
      
    } catch (err) {
      console.error(`Error rendering step ${step}:`, err);
      this._showError('Error al cargar pantalla');
    } finally {
      this.isTransitioning = false;
    }
  }
  
  // [FIX] Nuevo método para cleanup específico de step
  _cleanupCurrentStep() {
    this.eventListeners.forEach(({ element, event, handler }) => {
      if (element && element.removeEventListener) {
        element.removeEventListener(event, handler);
      }
    });
    this.eventListeners = [];
  }
  
  _renderQR(container) {
    let identityId = 'unknown';
    
    // [FIX] Todo dentro del try-catch, validación antes de slice
    try {
      if (this.vault?.initialized) {
        const identity = this.vault.getIdentity();
        if (identity && typeof identity === 'string' && identity.length > 0) {
          identityId = identity.slice(0, 16) + '...';
        }
      }
    } catch (err) {
      console.warn('Could not get identity for QR:', err);
      identityId = 'unknown';
    }
    
    container.innerHTML = `
      <div class="security-icon">👋</div>
      <h1 class="onboarding-title">Agrega tu primer contacto</h1>
      <p class="onboarding-subtitle">Escanea el QR de un amigo o muéstrale el tuyo. Funciona sin internet usando Bluetooth.</p>
      <div class="qr-container" id="qr-display">
        Tu ID: ${identityId}
        <br><br>
        [QR Code Placeholder]
      </div>
      <button class="onboarding-button" id="btn-scan">Escanear QR</button>
      <button class="onboarding-button secondary" id="btn-skip-qr">Omitir por ahora</button>
    `;
    
    const btnScan = container.querySelector('#btn-scan');
    const btnSkip = container.querySelector('#btn-skip-qr');
    
    // [FIX] Debounce: verificar isTransitioning en handlers
    const safeScan = () => {
      if (this.isTransitioning) return;
      this._boundHandleScan();
    };
    const safeSkip = () => {
      if (this.isTransitioning) return;
      this._boundHandleSkipQR();
    };
    
    if (btnScan) {
      btnScan.addEventListener('click', safeScan);
      this.eventListeners.push({ element: btnScan, event: 'click', handler: safeScan });
    }
    
    if (btnSkip) {
      btnSkip.addEventListener('click', safeSkip);
      this.eventListeners.push({ element: btnSkip, event: 'click', handler: safeSkip });
    }
  }
  
  async _setupWebAuthn() {
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn no soportado');
    }
    
    // [FIX] Crear nuevo AbortController si el anterior fue abortado
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }
    
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);
    
    const rpId = location.hostname && location.hostname !== '' ? location.hostname : 'nexo.app';
    
    const options = {
      publicKey: {
        challenge: challenge,
        rp: { name: 'NEXO', id: rpId },
        user: {
          id: userId,
          name: 'nexo-user-' + Date.now(),
          displayName: 'NEXO User'
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred'
        },
        timeout: 60000,
        signal: this.abortController.signal
      }
    };
    
    try {
      this.credentials = await navigator.credentials.create(options);
      return !!this.credentials;
    } catch (err) {
      // [FIX] Manejo específico de errores comunes
      if (err.name === 'AbortError') return false;
      if (err.name === 'NotAllowedError') {
        throw new Error('Permiso denegado. Verifica la configuración de seguridad de tu dispositivo.');
      }
      if (err.name === 'InvalidStateError') {
        throw new Error('Ya existe una credencial registrada. Usa "Recuperar cuenta" o elimina la credencial anterior.');
      }
      throw err;
    }
  }
  
  // [FIX] Debounce en todos los handlers de navegación
  _handleStart() { 
    if (this.isTransitioning) return;
    this._showStep(1); 
  }
  
  // [FIX] Cleanup progreso en destroy
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    
    this.abortController.abort();
    
    // [FIX] Limpiar progress bar del body si existe
    if (this.progressElement && this.progressElement.parentNode) {
      this.progressElement.remove();
    }
    
    this._cleanupCurrentStep();
    
    // [FIX] Limpiar toasts huérfanos
    const toasts = document.querySelectorAll('.error-toast');
    toasts.forEach(t => t.remove());
    
    if (this.container && this.container.parentNode) {
      this.container.innerHTML = '';
      this.container.classList.remove('onboarding-container');
    }
    
    this.credentials = null;
    this.vault = null;
  }
}
