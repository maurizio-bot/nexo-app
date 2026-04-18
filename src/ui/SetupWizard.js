/**
 * NEXO Setup Wizard v1.7-NAP PRODUCTION
 * UI para onboarding BLE con manejo robusto de estados
 * FIX: Flujo completo Permisos → Bluetooth → App
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
    
    // Timeout de seguridad para no quedarse colgado
    setTimeout(() => {
      if (this.currentStep === 'checking') {
        console.error(NAP_WIZARD + ' Timeout en verificación inicial');
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

      // Determinar qué pantalla mostrar según el estado
      if (status.reason === 'BLE_NOT_OPERATIONAL' || 
          status.reason === 'PERMISSIONS_DENIED' ||
          status.reason === 'PERM_DENIED') {
        this.currentStep = 'permissions';
        this.renderPermissions();
      } else if (status.reason === 'BLUETOOTH_DISABLED' || 
                 status.reason === 'BT_DISABLED') {
        this.currentStep = 'bluetooth';
        this.renderBluetooth();
      } else {
        this.currentStep = 'error';
        this.renderError();
      }
    } catch (error) {
      console.error(NAP_WIZARD + ' Error en performCheck:', error);
      this.currentStep = 'error';
      this.renderError();
    }
  }

  renderChecking() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999;">
        <div style="width: 48px; height: 48px; border: 4px solid #1a1a1a; border-top: 4px solid #00f0ff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 24px;"></div>
        <h3 style="margin:0; font-size: 20px; font-weight: 600;">Verificando sistema NAP...</h3>
        <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
      </div>
    `;
  }

  renderPermissions() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;">
        <div style="font-size: 56px; margin-bottom: 16px;">🔐</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Permisos BLE necesarios</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          NEXO requiere acceso a Bluetooth para comunicación P2P offline-first.
        </p>
        <button id="btn-perms" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,240,255,0.3);">
          Conceder permisos BLE
        </button>
      </div>
    `;

    const btn = document.getElementById('btn-perms');
    btn.addEventListener('click', () => this.handleRequestPermissions(btn));
  }

  async handleRequestPermissions(btnElement) {
    const btn = btnElement;
    
    try {
      // UI Feedback
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      btn.textContent = 'Abriendo diálogo Android...';
      
      const result = await requestBLEPermissions();
      
      console.log(NAP_WIZARD + ' Resultado permisos:', result);
      
      // CASO 1: ÉXITO TOTAL (Permisos + BT encendido)
      if (result.granted === true && result.bluetoothEnabled === true) {
        btn.textContent = '✓ Listo';
        btn.style.background = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)';
        
        await setupManager.markSetupComplete();
        
        setTimeout(() => this.onComplete(), 400);
        return;
      }
      
      // CASO 2: PERMISOS OK pero BT APAGADO (redirigir a pantalla BT)
      if (result.granted === true && 
          (result.bluetoothEnabled === false || result.needsBluetoothOn === true)) {
        console.log(NAP_WIZARD + ' Permisos OK pero BT apagado, redirigiendo...');
        this.currentStep = 'bluetooth';
        this.renderBluetooth();
        return;
      }
      
      // CASO 3: DENEGACIÓN PERMANENTE (ir a Settings)
      if (result.isPermanentDenial === true || result.needsManualSettings === true) {
        console.warn(NAP_WIZARD + ' Denegación permanente detectada');
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.textContent = 'Abrir Configuración';
        btn.onclick = () => {
          // Intentar abrir settings de la app
          if (window.Capacitor && window.Capacitor.Plugins.App) {
            window.Capacitor.Plugins.App.openUrl({
              url: 'app-settings:'
            });
          } else {
            alert('Por favor habilita los permisos de Bluetooth manualmente en:\nConfiguración > Apps > NEXO > Permisos');
          }
        };
        return;
      }
      
      // CASO 4: CANCELACIÓN O DENEGACIÓN TEMPORAL (reintentar)
      console.log(NAP_WIZARD + ' Permisos denegados o cancelados:', result.nap_code);
      
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.textContent = 'Reintentar';
      
    } catch (error) {
      console.error(NAP_WIZARD + ' Error crítico:', error);
      
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.textContent = 'Error - Toca para reintentar';
    }
  }

  renderBluetooth() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;">
        <div style="font-size: 56px; margin-bottom: 16px;">📡</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Bluetooth desactivado</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          Activa el Bluetooth para descubrir peers NEXO cercanos.
        </p>
        <button id="btn-retry-bt" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px;">
          Verificar de nuevo
        </button>
      </div>
    `;
    
    document.getElementById('btn-retry-bt').addEventListener('click', () => {
      this.performCheck();
    });
  }

  renderError() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; z-index: 99999; text-align: center;">
        <div style="font-size: 56px; margin-bottom: 16px;">⚠️</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Error de verificación</h2>
        <button id="btn-retry" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">
          Reintentar verificación
        </button>
      </div>
    `;
    
    document.getElementById('btn-retry').addEventListener('click', () => {
      this.performCheck();
    });
  }
}

window.SetupWizard = SetupWizard;
