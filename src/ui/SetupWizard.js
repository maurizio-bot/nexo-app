/**
 * NEXO Setup Wizard v1.6-NAP
 * FIX: Imports corregidos (SetupManager -> setupManager)
 * FIX: Usar métodos correctos de SetupManager
 */

import { setupManager } from '../core/SetupManager.js';
import { requestBLEPermissions, checkBLEStatus } from '../core/ble_permissions.js';

const NAP_WIZARD = '[NAP-WIZARD]';

export class SetupWizard {
  constructor(containerId = 'app', onComplete) {
    this.container = document.getElementById(containerId) || document.body;
    this.onComplete = onComplete;
    this.currentStep = 'checking';
    this.errorCount = 0;
    window.NEXO_WIZARD = this;
  }

  async start() {
    this.renderChecking();
    setTimeout(() => {
      if (this.currentStep === 'checking') {
        this.currentStep = 'error';
        this.renderError();
      }
    }, 30000);
    await this.performCheck();
  }

  async performCheck() {
    try {
      const status = await setupManager.checkInitialStatus();
      
      if (status.completed) {
        this.onComplete();
        return;
      }

      if (status.reason === 'BLE_NOT_OPERATIONAL' || status.reason === 'PERMISSIONS_DENIED') {
        this.currentStep = 'permissions';
        this.renderPermissions();
      } else if (status.reason === 'BLUETOOTH_DISABLED' || status.reason === 'BT_DISABLED') {
        this.currentStep = 'bluetooth';
        this.renderBluetooth();
      } else {
        this.currentStep = 'error';
        this.renderError();
      }
    } catch (error) {
      this.currentStep = 'error';
      this.renderError();
    }
  }

  renderChecking() {
    this.container.innerHTML = '<div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999;"><div style="width: 48px; height: 48px; border: 4px solid #1a1a1a; border-top: 4px solid #00f0ff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 24px;"></div><h3 style="margin:0; font-size: 20px; font-weight: 600;">Verificando sistema NAP...</h3><style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style></div>';
  }

  renderPermissions() {
    this.container.innerHTML = '<div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">🔐</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Permisos BLE necesarios</h2><p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">NEXO requiere acceso a Bluetooth para comunicación P2P offline-first.</p><button id="btn-perms" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,240,255,0.3);">Conceder permisos BLE</button></div>';

    document.getElementById('btn-perms').addEventListener('click', (e) => this.handleRequestPermissions(e.target));
  }

  async handleRequestPermissions(btnElement) {
    const btn = btnElement;
    
    try {
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      btn.textContent = 'Abriendo diálogo Android...';
      
      const result = await requestBLEPermissions();
      
      if (result.granted) {
        btn.textContent = 'Verificando BLE...';
        
        const operationalCheck = await this.verifyBLEOperational();
        
        if (!operationalCheck.ready) {
          if (operationalCheck.reason === 'bluetooth') {
            console.log(NAP_WIZARD + ' BT apagado detectado, cambiando a pantalla Bluetooth');
            this.currentStep = 'bluetooth';
            this.renderBluetooth();
            return;
          }
          
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
          btn.textContent = 'Reintentar';
          return;
        }
        
        console.log(NAP_WIZARD + ' BLE operativo confirmado');
        btn.style.background = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)';
        btn.textContent = '✓ Listo';
        
        // Marcar setup como completado
        await setupManager.markSetupComplete();
        
        setTimeout(() => this.onComplete(), 400);
        
      } else {
        console.log(NAP_WIZARD + ' Permisos no concedidos:', result);
        
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.textContent = 'Reintentar';
      }
      
    } catch (error) {
      console.error(NAP_WIZARD + ' Error:', error);
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.textContent = 'Error - Toca para reintentar';
    }
  }

  async verifyBLEOperational(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(NAP_WIZARD + ` Verificación intento ${attempt}/${maxRetries}...`);
        
        const status = await checkBLEStatus();
        
        if (status.isPermanentlyDenied === true) {
          return { ready: false, reason: 'permanent_denial' };
        }
        
        if (status.granted === true && status.bluetoothEnabled === true) {
          return { ready: true, status };
        }
        
        if (status.bluetoothEnabled === false) {
          return { ready: false, reason: 'bluetooth', status };
        }
        
        if (!status.granted && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        
        if (!status.granted) {
          return { ready: false, reason: 'permissions', status };
        }
        
      } catch (e) {
        console.error(NAP_WIZARD + ` Error intento ${attempt}:`, e);
        if (attempt === maxRetries) {
          return { ready: false, reason: 'error', error: e.message };
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    return { ready: false, reason: 'max_retries_exceeded' };
  }

  renderBluetooth() {
    this.container.innerHTML = '<div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">📡</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Bluetooth desactivado</h2><p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">Activa el Bluetooth para descubrir peers NEXO cercanos.</p><button id="btn-retry-bt" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px;">Verificar de nuevo</button></div>';
    
    document.getElementById('btn-retry-bt').addEventListener('click', () => this.performCheck());
  }

  renderError() {
    this.container.innerHTML = '<div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;"><div style="font-size: 56px; margin-bottom: 16px;">⚠️</div><h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Error de verificación</h2><button id="btn-retry" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">Reintentar verificación</button></div>';
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }
}

window.SetupWizard = SetupWizard;
