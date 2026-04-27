/**
 * NEXO Setup Wizard v3.0.1-ARCH
 * Coordinado con NexoBlePlugin.kt v4.0.0-ARCH
 * - Timeout extendido a 35s (nativo puede tardar hasta 16s en retry)
 * - handleConnectionFailed ajustado para exponential backoff nativo
 * FIX v3.0.1-ARCH: Texto de reintentar más descriptivo, estado "Verificando..." en vez de "Esperando..."
 */

import { SetupManager } from '../core/SetupManager.js';
import { requestBLEPermissions, checkBLEStatus } from '../core/ble_permissions.js';

const NAP_WIZARD = '[NAP-WIZARD]';

export class SetupWizard {
  constructor(containerId = 'app', onComplete) {
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'nexo-setup';
    this.overlayContainer.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 99999;';
    document.body.appendChild(this.overlayContainer);
    
    this.container = this.overlayContainer;
    this.onComplete = onComplete;
    this.currentStep = 'checking';
    this.errorCount = 0;
    this.isAwaitingSettingsReturn = false;
    this.settingsCheckInterval = null;
    this.btCheckInterval = null;
    this._successTimeout = null;
    this._connectionAttempt = 0;
    this._stackBrokenShown = false;
    window.NEXO_WIZARD = this;
    
    this.handlePermissionsGranted = this.handlePermissionsGranted.bind(this);
    this.handlePermissionsDenied = this.handlePermissionsDenied.bind(this);
    this.handleAppResume = this.handleAppResume.bind(this);
    this.handleBluetoothStateChange = this.handleBluetoothStateChange.bind(this);
    this.handleConnectionFailed = this.handleConnectionFailed.bind(this);
    this.handleStackBroken = this.handleStackBroken.bind(this);
  }

  async start() {
    this.renderChecking();
    this.setupGlobalListeners();
    
    // v3.0.0-ARCH: Timeout 35s (nativo puede tardar hasta 16s en retry + jitter)
    setTimeout(() => {
      if (this.currentStep === 'checking') {
        this.currentStep = 'error';
        this.renderError();
      }
    }, 35000);
    
    await this.performCheck();
  }
  
  setupGlobalListeners() {
    window.addEventListener('nexo-permissions-granted', this.handlePermissionsGranted);
    window.addEventListener('nexo-permissions-denied', this.handlePermissionsDenied);
    
    if (window.Capacitor?.Plugins?.NexoBLE) {
      const plugin = window.Capacitor.Plugins.NexoBLE;
      plugin.addListener('onBluetoothStateChanged', this.handleBluetoothStateChange);
      plugin.addListener('onConnectionFailed', this.handleConnectionFailed);
      plugin.addListener('onBluetoothStackBroken', this.handleStackBroken);
    }
    
    document.addEventListener('visibilitychange', this.handleAppResume);
  }
  
  handleBluetoothStateChange(state) {
    console.log(NAP_WIZARD, 'BT State Change:', state);
    
    if (state.stateName === 'ON' && this.isAwaitingSettingsReturn) {
      this.isAwaitingSettingsReturn = false;
      this.clearBtCheckInterval();
      this.renderSuccessTransition();
      setTimeout(() => this.onComplete(), 800);
    }
  }
  
  // v3.0.0-ARCH: Nativo usa exponential backoff (2s, 4s, 8s, 16s). No mostrar error prematuro.
  handleConnectionFailed(data) {
    console.log(NAP_WIZARD, 'Connection failed (nativo retry en progreso):', data);
    const attempt = data.attempt || 0;
    const maxAttempts = data.maxAttempts || 3;
    const isRecoverable = data.recoverable !== false;
    
    if (isRecoverable && attempt < maxAttempts) {
      this._connectionAttempt = attempt;
      if (this.currentStep === 'error' || this.currentStep === 'bluetooth') {
        this.renderChecking();
        this.currentStep = 'checking';
      }
    } else {
      this.currentStep = 'error';
      this.renderError(`Conexión fallida: ${data.reason || 'Error desconocido'}`);
    }
  }
  
  handleStackBroken(data) {
    if (this._stackBrokenShown) return;
    this._stackBrokenShown = true;
    console.error(NAP_WIZARD, 'Android 14 Stack Bug detectado:', data);
    
    this.container.innerHTML = `
      <div style="width: 100%; height: 100%; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center;">
        <div style="font-size: 56px; margin-bottom: 16px;">⚠️</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600; color: #ffaa00;">Bluetooth necesita reiniciarse</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          El stack Bluetooth de Android 14 está en estado corrupto. 
          Apaga y enciende Bluetooth desde Configuración.
        </p>
        <button id="btn-bt-restart" style="background: linear-gradient(135deg, #ffaa00 0%, #ff6600 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">
          Abrir Configuración Bluetooth
        </button>
        <button id="btn-retry-after-restart" style="background: transparent; color: #666; border: 1px solid #444; padding: 12px 24px; border-radius: 10px; font-size: 14px; cursor: pointer;">
          🔄 Ya reinicié Bluetooth
        </button>
      </div>
    `;
    
    document.getElementById('btn-bt-restart').addEventListener('click', () => this.handleOpenBluetoothSettings());
    document.getElementById('btn-retry-after-restart').addEventListener('click', () => {
      this._stackBrokenShown = false;
      this.performCheck();
    });
  }
  
  async handleAppResume() {
    if (document.visibilityState !== 'visible') return;
    
    if (this.isAwaitingSettingsReturn) {
      console.log(NAP_WIZARD, 'App resumed - verifying Bluetooth state');
      setTimeout(() => this.verifyBluetoothAfterReturn(), 500);
    }
  }
  
  async verifyBluetoothAfterReturn() {
    try {
      const status = await checkBLEStatus();
      
      if (status.bluetoothEnabled) {
        this.isAwaitingSettingsReturn = false;
        this.clearBtCheckInterval();
        
        try {
          const { startBLEAdvertising } = await import('../core/ble_permissions.js');
          await startBLEAdvertising();
          console.log(NAP_WIZARD, 'Advertising iniciado post-BT');
        } catch (e) {
          console.warn(NAP_WIZARD, 'Advertising no iniciado:', e);
        }
        
        this.renderSuccessTransition();
        setTimeout(() => this.onComplete(), 800);
      } else {
        const btn = document.getElementById('btn-bt-settings');
        if (btn) {
          btn.textContent = 'Ir a Configuración Bluetooth';
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
        }
        this.isAwaitingSettingsReturn = false;
        this.clearBtCheckInterval();
      }
    } catch (e) {
      console.error(NAP_WIZARD, 'Error verifying BT after return:', e);
    }
  }
  
  clearBtCheckInterval() {
    if (this.btCheckInterval) {
      clearInterval(this.btCheckInterval);
      this.btCheckInterval = null;
    }
  }
  
  async handlePermissionsGranted(event) {
    console.log(NAP_WIZARD, 'Permisos concedidos:', event.detail);
    
    if (this.isAwaitingSettingsReturn) {
      this.isAwaitingSettingsReturn = false;
      
      const status = await SetupManager.checkPermissionsRealtime();
      
      if (status.granted) {
        try {
          const { startBLEAdvertising } = await import('../core/ble_permissions.js');
          const advResult = await startBLEAdvertising();
          console.log(NAP_WIZARD, 'Advertising iniciado:', advResult.nap_code);
        } catch (e) {
          console.warn(NAP_WIZARD, 'No se pudo iniciar advertising automáticamente:', e);
        }
        
        this.renderSuccessTransition();
        setTimeout(() => this.onComplete(), 800);
      } else if (!status.bluetoothEnabled) {
        this.currentStep = 'bluetooth';
        this.renderBluetooth();
      }
    }
  }
  
  handlePermissionsDenied(event) {
    console.log(NAP_WIZARD, 'Permisos denegados:', event.detail);
    
    if (this.isAwaitingSettingsReturn) {
      this.isAwaitingSettingsReturn = false;
      this.renderPermissions(true);
    }
  }

  async performCheck() {
    try {
      const status = await SetupManager.checkInitialStatus();
      
      if (status.ready) {
        this.onComplete();
        return;
      }

      if (status.reason === 'permissions') {
        const shouldManual = await SetupManager.shouldGoToSettings();
        this.currentStep = shouldManual ? 'permissions_manual' : 'permissions';
        this.renderPermissions();
      } else if (status.reason === 'bluetooth') {
        this.currentStep = 'bluetooth';
        this.renderBluetooth();
      } else {
        this.currentStep = 'error';
        this.renderError();
      }
    } catch (error) {
      console.error(NAP_WIZARD, 'Error:', error);
      this.currentStep = 'error';
      this.renderError();
    }
  }

  renderChecking() {
    this.container.innerHTML = '<div style="width: 100%; height: 100%; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif;"><div style="width: 48px; height: 48px; border: 4px solid #1a1a1a; border-top: 4px solid #00f0ff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 24px;"></div><h3 style="margin:0; font-size: 20px; font-weight: 600;">Verificando sistema...</h3><style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style></div>';
  }
  
  renderSuccessTransition() {
    this.container.innerHTML = '<div style="width: 100%; height: 100%; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center;"><div style="font-size: 56px; margin-bottom: 16px;">✓</div><h3 style="margin:0; font-size: 20px; font-weight: 600; color: #00ff88;">Listo</h3></div>';
    
    if (this._successTimeout) clearTimeout(this._successTimeout);
    this._successTimeout = setTimeout(() => {
      console.log(NAP_WIZARD, 'Auto-destruyendo wizard por seguridad');
      this.destroy();
    }, 3500);
  }

  renderPermissions(showStillPending = false) {
    const isManual = this.currentStep === 'permissions_manual';
    const btnId = isManual ? 'btn-settings-manual' : 'btn-perms-auto';
    const fallbackBtnId = 'btn-settings-fallback';
    
    let extraMessage = '';
    if (showStillPending && isManual) {
      extraMessage = '<p style="color: #ff6b6b; font-size: 14px; max-width: 320px; background: rgba(255,107,107,0.1); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255,107,107,0.3); margin-bottom: 20px; line-height: 1.5;">⚠️ Aún faltan permisos. Verifica en Configuración.</p>';
    } else if (isManual) {
      extraMessage = '<p style="color: #ffaa00; font-size: 14px; max-width: 320px; background: rgba(255,170,0,0.1); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255,170,0,0.2); margin-bottom: 20px; line-height: 1.5;">⚠️ Has denegado los permisos múltiples veces. Android requiere activación manual.</p>';
    }
    
    this.container.innerHTML = '<div style="width: 100%; height: 100%; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">🔐</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Permisos BLE</h2><p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">NEXO requiere Bluetooth para comunicación P2P.</p>' + extraMessage + 
      (isManual ? 
        '<button id="' + btnId + '" style="background: linear-gradient(135deg, #ff6b35 0%, #ff4500 100%); color: #fff; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">Abrir Configuración</button>' :
        '<button id="' + btnId + '" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,240,255,0.3);">Conceder permisos</button><button id="' + fallbackBtnId + '" style="background: none; border: none; color: #00f0ff; font-size: 14px; cursor: pointer; text-decoration: underline; opacity: 0.8;">Configuración manual</button>'
      ) + '</div>';

    if (isManual) {
      document.getElementById(btnId).addEventListener('click', () => this.handleOpenSettings());
    } else {
      document.getElementById(btnId).addEventListener('click', (e) => this.handleRequestPermissions(e.target));
      document.getElementById(fallbackBtnId).addEventListener('click', () => this.handleOpenSettings());
    }
  }

  async handleRequestPermissions(btnElement) {
    const btn = btnElement;
    
    try {
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      btn.textContent = 'Abriendo diálogo...';
      
      const result = await requestBLEPermissions();
      
      if (result.granted) {
        const btStatus = await checkBLEStatus();
        
        if (!btStatus.bluetoothEnabled) {
          this.currentStep = 'bluetooth';
          this.renderBluetooth();
          return;
        }
        
        const pluginReady = await this.verifyPluginReady();
        
        if (!pluginReady) {
          btn.style.background = 'linear-gradient(135deg, #ff6b35 0%, #ff4500 100%)';
          // FIX v3.0.1-ARCH: Texto descriptivo en vez de genérico "Reintentar"
          btn.textContent = 'Reintentar solicitud';
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
          return;
        }
        
        this.renderSuccessTransition();
        setTimeout(() => this.onComplete(), 800);
        
      } else {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        
        const isPermanent = result.isPermanentDenial === true;
        const isUserCancelled = result.isUserCancelled === true;
        
        if (isPermanent) {
          this.currentStep = 'permissions_manual';
          this.renderPermissions();
          return;
        }
        
        if (!isUserCancelled) {
          const count = await SetupManager.recordPermissionDenied();
          this.errorCount = count;
          
          if (count >= 2) {
            this.currentStep = 'permissions_manual';
            this.renderPermissions();
            return;
          }
        }
        
        // FIX v3.0.1-ARCH: Textos descriptivos según el caso
        btn.textContent = isUserCancelled ? 'Reintentar (diálogo cerrado)' : 'Reintentar solicitud';
      }
      
    } catch (error) {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.textContent = 'Reintentar solicitud';
    }
  }

  async verifyPluginReady() {
    try {
      const { NexoBLE } = window.Capacitor.Plugins;
      if (!NexoBLE) return false;
      
      const response = await Promise.race([
        NexoBLE.isBluetoothEnabled(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000))
      ]);
      
      return response && response.enabled === true;
      
    } catch (e) {
      return false;
    }
  }

  renderBluetooth() {
    this.container.innerHTML = '<div style="width: 100%; height: 100%; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">📡</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Bluetooth desactivado</h2><p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">Activa el Bluetooth para descubrir peers NEXO.</p><button id="btn-bt-settings" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">Ir a Configuración Bluetooth</button><button id="btn-retry" style="background: transparent; color: #666; border: 1px solid #444; padding: 12px 24px; border-radius: 10px; font-size: 14px; cursor: pointer;">🔄 Verificar</button></div>';
    
    document.getElementById('btn-bt-settings').addEventListener('click', () => this.handleOpenBluetoothSettings());
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

  renderError(customMessage = null) {
    const msg = customMessage || 'Error de conexión. Verifica que el otro dispositivo esté visible.';
    this.container.innerHTML = '<div style="width: 100%; height: 100%; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">⚠️</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Error</h2><p style="color: #888; font-size: 14px; max-width: 320px; margin-bottom: 24px;">' + msg + '</p><button id="btn-retry" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer;">🔄 Reintentar</button></div>';
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

  async handleOpenSettings() {
    this.isAwaitingSettingsReturn = true;
    await SetupManager.markAwaitingSettingsReturn();
    await SetupManager.openAppSettings();
    
    const btn = document.getElementById('btn-settings-manual');
    if (btn) {
      // FIX v3.0.1-ARCH: Texto claro en vez de genérico "Esperando..."
      btn.textContent = 'Verificando permisos...';
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
    }
    
    this.settingsCheckInterval = setInterval(async () => {
      if (!this.isAwaitingSettingsReturn) {
        clearInterval(this.settingsCheckInterval);
        return;
      }
      
      try {
        const status = await SetupManager.checkPermissionsRealtime();
        
        if (status.granted) {
          this.isAwaitingSettingsReturn = false;
          clearInterval(this.settingsCheckInterval);
          this.renderSuccessTransition();
          setTimeout(() => this.onComplete(), 800);
        }
      } catch (e) {}
    }, 1500);
  }

  async handleOpenBluetoothSettings() {
    this.isAwaitingSettingsReturn = true;
    await SetupManager.markAwaitingSettingsReturn();
    await SetupManager.openBluetoothSettings();
    
    const btn = document.getElementById('btn-bt-settings');
    if (btn) {
      // FIX v3.0.1-ARCH: Texto claro en vez de genérico "Esperando..."
      btn.textContent = 'Verificando Bluetooth...';
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
    }
    
    this.btCheckInterval = setInterval(async () => {
      if (!this.isAwaitingSettingsReturn) {
        this.clearBtCheckInterval();
        return;
      }
      
      try {
        const status = await checkBLEStatus();
        if (status.bluetoothEnabled) {
          this.isAwaitingSettingsReturn = false;
          this.clearBtCheckInterval();
          this.renderSuccessTransition();
          setTimeout(() => this.onComplete(), 800);
        }
      } catch (e) {}
    }, 2000);
    
    setTimeout(() => {
      if (this.isAwaitingSettingsReturn) {
        this.isAwaitingSettingsReturn = false;
        this.clearBtCheckInterval();
        const btnRetry = document.getElementById('btn-bt-settings');
        if (btnRetry) {
          btnRetry.textContent = 'Ir a Configuración Bluetooth';
          btnRetry.style.opacity = '1';
          btnRetry.style.pointerEvents = 'auto';
        }
      }
    }, 30000);
  }

  destroy() {
    if (this._successTimeout) {
      clearTimeout(this._successTimeout);
      this._successTimeout = null;
    }
    
    window.removeEventListener('nexo-permissions-granted', this.handlePermissionsGranted);
    window.removeEventListener('nexo-permissions-denied', this.handlePermissionsDenied);
    document.removeEventListener('visibilitychange', this.handleAppResume);
    
    if (window.Capacitor?.Plugins?.NexoBLE) {
      const plugin = window.Capacitor.Plugins.NexoBLE;
      plugin.removeAllListeners();
    }
    
    if (this.settingsCheckInterval) {
      clearInterval(this.settingsCheckInterval);
    }
    this.clearBtCheckInterval();
    
    if (this.overlayContainer) {
      this.overlayContainer.remove();
      this.overlayContainer = null;
    }
  }
}
