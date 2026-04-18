/**
 * NEXO Setup Wizard v2.0-NAP-PROD
 * FIX: Verificación real del plugin BLE antes de completar
 * FIX: Auto-verificación al retornar de Settings mediante eventos de sistema
 */

import { SetupManager } from '../core/SetupManager.js';
import { requestBLEPermissions, checkBLEStatus } from '../core/ble_permissions.js';

const NAP_WIZARD = '[NAP-WIZARD]';

export class SetupWizard {
  constructor(containerId = 'app', onComplete) {
    this.container = document.getElementById(containerId) || document.body;
    this.onComplete = onComplete;
    this.currentStep = 'checking';
    this.errorCount = 0;
    this.isAwaitingSettingsReturn = false;
    this.settingsCheckInterval = null;
    window.NEXO_WIZARD = this;
    
    // Bindings para event listeners
    this.handlePermissionsGranted = this.handlePermissionsGranted.bind(this);
    this.handlePermissionsDenied = this.handlePermissionsDenied.bind(this);
  }

  async start() {
    this.renderChecking();
    
    // Setup listeners de eventos globales para auto-verificación
    this.setupGlobalListeners();
    
    // Safety timeout 30s (aumentado para dar tiempo a interacción humana)
    setTimeout(() => {
      if (this.currentStep === 'checking') {
        this.currentStep = 'error';
        this.renderError();
      }
    }, 30000);
    
    await this.performCheck();
  }
  
  /**
   * NUEVO v2.0: Escuchar eventos globales de permisos desde SetupManager
   */
  setupGlobalListeners() {
    window.addEventListener('nexo-permissions-granted', this.handlePermissionsGranted);
    window.addEventListener('nexo-permissions-denied', this.handlePermissionsDenied);
  }
  
  /**
   * NUEVO v2.0: Handler cuando se detectan permisos concedidos (ej: al volver de Settings)
   */
  async handlePermissionsGranted(event) {
    console.log(NAP_WIZARD, ' Evento permisos concedidos detectado:', event.detail);
    
    if (this.isAwaitingSettingsReturn && this.currentStep === 'permissions_manual') {
      this.isAwaitingSettingsReturn = false;
      
      // Verificar que realmente todo está OK antes de completar
      const status = await SetupManager.checkPermissionsRealtime();
      
      if (status.granted) {
        this.renderSuccessTransition();
        setTimeout(() => this.onComplete(), 800);
      } else {
        // Si aún falta BT, cambiar a pantalla BT
        if (!status.bluetoothEnabled) {
          this.currentStep = 'bluetooth';
          this.renderBluetooth();
        } else {
          // Permisos aún faltantes - mantener en manual con mensaje actualizado
          this.renderPermissions(true); // true = mostrar mensaje de "aún faltan permisos"
        }
      }
    }
  }
  
  /**
   * NUEVO v2.0: Handler cuando se detecta que permisos siguen denegados
   */
  handlePermissionsDenied(event) {
    console.log(NAP_WIZARD, ' Permisos aún denegados post-Settings:', event.detail);
    
    if (this.isAwaitingSettingsReturn) {
      this.isAwaitingSettingsReturn = false;
      // Mantener en modo manual con feedback visual
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
      console.error(NAP_WIZARD, ' Error en performCheck:', error);
      this.currentStep = 'error';
      this.renderError();
    }
  }

  renderChecking() {
    this.container.innerHTML = '<div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999;"><div style="width: 48px; height: 48px; border: 4px solid #1a1a1a; border-top: 4px solid #00f0ff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 24px;"></div><h3 style="margin:0; font-size: 20px; font-weight: 600;">Verificando sistema NAP...</h3><style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style></div>';
  }
  
  /**
   * NUEVO v2.0: Mostrar transición de éxito antes de completar
   */
  renderSuccessTransition() {
    const existing = document.getElementById('nexo-setup');
    if (existing) {
      existing.innerHTML = '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center;"><div style="font-size: 56px; margin-bottom: 16px;">✓</div><h3 style="margin:0; font-size: 20px; font-weight: 600; color: #00ff88;">Configuración completa</h3></div>';
    }
  }

  renderPermissions(showStillPending = false) {
    const isManual = this.currentStep === 'permissions_manual';
    const btnId = isManual ? 'btn-settings-manual' : 'btn-perms-auto';
    const fallbackBtnId = 'btn-settings-fallback';
    
    let extraMessage = '';
    if (showStillPending && isManual) {
      extraMessage = '<p style="color: #ff6b6b; font-size: 14px; max-width: 320px; background: rgba(255,107,107,0.1); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255,107,107,0.3); margin-bottom: 20px; line-height: 1.5;">⚠️ Aún faltan permisos. Verifica que activaste todos los permisos BLE en Configuración.</p>';
    } else if (isManual) {
      extraMessage = '<p style="color: #ffaa00; font-size: 14px; max-width: 320px; background: rgba(255,170,0,0.1); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255,170,0,0.2); margin-bottom: 20px; line-height: 1.5;">⚠️ Has denegado los permisos múltiples veces. Android requiere activación manual.</p>';
    }
    
    this.container.innerHTML = '<div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">🔐</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Permisos BLE necesarios</h2><p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">NEXO requiere acceso a Bluetooth para comunicación P2P offline-first.</p>' + extraMessage + 
      (isManual ? 
        '<button id="' + btnId + '" style="background: linear-gradient(135deg, #ff6b35 0%, #ff4500 100%); color: #fff; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">Abrir Configuración de la App</button>' :
        '<button id="' + btnId + '" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,240,255,0.3); transition: all 0.3s ease;">Conceder permisos BLE</button><button id="' + fallbackBtnId + '" style="background: none; border: none; color: #00f0ff; font-size: 14px; cursor: pointer; text-decoration: underline; opacity: 0.8;">Configuración manual</button>'
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
      btn.textContent = 'Abriendo diálogo Android...';
      
      const result = await requestBLEPermissions();
      
      if (result.granted) {
        const btStatus = await checkBLEStatus();
        console.log(NAP_WIZARD + ' Permisos OK, verificando BT:', btStatus.bluetoothEnabled);
        
        if (!btStatus.bluetoothEnabled) {
          console.log(NAP_WIZARD + ' BT apagado, cambiando a pantalla Bluetooth');
          this.currentStep = 'bluetooth';
          this.renderBluetooth();
          return;
        }
        
        btn.textContent = 'Verificando BLE...';
        const pluginReady = await this.verifyPluginReady();
        
        if (!pluginReady) {
          console.error(NAP_WIZARD + ' Plugin BLE no responde');
          btn.style.background = 'linear-gradient(135deg, #ff6b35 0%, #ff4500 100%)';
          btn.textContent = 'Error BLE - Toca para reintentar';
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
          return;
        }
        
        this.renderSuccessTransition();
        setTimeout(() => this.onComplete(), 800);
        
      } else {
        console.log(NAP_WIZARD + ' Permisos no concedidos:', result.nap_code, result);
        
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        
        // NUEVO v2.0: Detectar denegación permanente real
        const isPermanent = result.isPermanentDenial === true;
        const isUserCancelled = result.isUserCancelled === true;
        
        if (isPermanent) {
          console.log(NAP_WIZARD + ' Denegación permanente detectada, modo manual');
          this.currentStep = 'permissions_manual';
          this.renderPermissions();
          return;
        }
        
        if (!isUserCancelled) {
          const count = await SetupManager.recordPermissionDenied();
          this.errorCount = count;
          
          if (count >= 2) {
            console.log(NAP_WIZARD + ' Cambiando a modo MANUAL tras ' + count + ' fallos');
            this.currentStep = 'permissions_manual';
            this.renderPermissions();
            return;
          }
        }
        
        btn.textContent = isUserCancelled ? 'Reintentar (diálogo cerrado)' : 'Reintentar';
      }
      
    } catch (error) {
      console.error(NAP_WIZARD + ' Error crítico:', error);
      
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.textContent = 'Error - Toca para reintentar';
    }
  }

  async verifyPluginReady() {
    try {
      const { NexoBLE } = window.Capacitor.Plugins;
      if (!NexoBLE) {
        console.error(NAP_WIZARD + ' NexoBLE plugin no encontrado');
        return false;
      }
      
      const response = await Promise.race([
        NexoBLE.isBluetoothEnabled(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000))
      ]);
      
      console.log(NAP_WIZARD + ' Plugin responde:', response);
      return response && response.enabled === true;
      
    } catch (e) {
      console.error(NAP_WIZARD + ' Plugin no responde:', e.message);
      return false;
    }
  }

  renderBluetooth() {
    this.container.innerHTML = '<div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">📡</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Bluetooth desactivado</h2><p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">Activa el Bluetooth para descubrir peers NEXO cercanos.</p><button id="btn-bt-settings" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">Ir a Configuración Bluetooth</button><button id="btn-retry" style="background: transparent; color: #666; border: 1px solid #444; padding: 12px 24px; border-radius: 10px; font-size: 14px; cursor: pointer;">🔄 Verificar de nuevo</button></div>';
    
    document.getElementById('btn-bt-settings').addEventListener('click', () => this.handleOpenBluetoothSettings());
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

  renderError() {
    this.container.innerHTML = '<div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">⚠️</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Error de verificación</h2><button id="btn-retry" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">🔄 Reintentar verificación</button></div>';
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

  /**
   * NUEVO v2.0: Abrir Settings y marcar estado de espera para auto-verificación
   */
  async handleOpenSettings() {
    this.isAwaitingSettingsReturn = true;
    await SetupManager.markAwaitingSettingsReturn();
    
    // Mostrar estado de espera visual
    const btn = document.getElementById('btn-settings-manual');
    if (btn) {
      btn.textContent = 'Esperando cambios...';
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
    }
    
    await SetupManager.openAppSettings();
  }

  async handleOpenBluetoothSettings() {
    await SetupManager.markAwaitingSettingsReturn();
    await SetupManager.openBluetoothSettings();
    
    // Cambiar botón a modo espera
    const btn = document.getElementById('btn-bt-settings');
    if (btn) {
      btn.textContent = 'Esperando activación...';
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
    }
  }
  
  /**
   * Cleanup: Remover listeners al destruir
   */
  destroy() {
    window.removeEventListener('nexo-permissions-granted', this.handlePermissionsGranted);
    window.removeEventListener('nexo-permissions-denied', this.handlePermissionsDenied);
    SetupManager.cleanup();
  }
}

window.SetupWizard = SetupWizard;
