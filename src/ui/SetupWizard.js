/**
 * NEXO Setup Wizard v1.4-NAP
 * UI de onboarding para Android 14 BLE
 * FIX v1.4: Evitar salto automático a manual, permitir reintentos en botón azul
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
      this.currentStep = 'error';
      this.renderError();
    }
  }

  renderChecking() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="
        position: fixed; top:0; left:0; right:0; bottom:0;
        background: #000; color: #fff;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 99999;
      ">
        <div style="width: 48px; height: 48px; border: 4px solid #1a1a1a; border-top: 4px solid #00f0ff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 24px;"></div>
        <h3 style="margin:0; font-size: 20px; font-weight: 600;">Verificando sistema NAP...</h3>
        <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
      </div>
    `;
  }

  renderPermissions() {
    const isManual = this.currentStep === 'permissions_manual';
    
    // FIX v1.4: IDs únicos para evitar conflictos de listeners
    const btnId = isManual ? 'btn-settings-manual' : 'btn-perms-auto';
    const fallbackBtnId = 'btn-settings-fallback';
    
    this.container.innerHTML = `
      <div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; z-index: 99999; text-align: center;">
        <div style="font-size: 56px; margin-bottom: 16px;">🔐</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Permisos BLE necesarios</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          NEXO requiere acceso a Bluetooth para comunicación P2P offline-first.
        </p>
        
        ${isManual ? `
          <p style="color: #ffaa00; font-size: 14px; max-width: 320px; background: rgba(255,170,0,0.1); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255,170,0,0.2); margin-bottom: 20px; line-height: 1.5;">
            ⚠️ Has denegado los permisos múltiples veces. Android requiere activación manual.
          </p>
          <button id="${btnId}" style="background: linear-gradient(135deg, #ff6b35 0%, #ff4500 100%); color: #fff; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">
            Abrir Configuración de la App
          </button>
        ` : `
          <button id="${btnId}" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,240,255,0.3); transition: all 0.3s ease;">
            Conceder permisos BLE
          </button>
          <button id="${fallbackBtnId}" style="background: none; border: none; color: #00f0ff; font-size: 14px; cursor: pointer; text-decoration: underline; opacity: 0.8;">
            Configuración manual
          </button>
        `}
      </div>
    `;

    if (isManual) {
      document.getElementById(btnId).addEventListener('click', () => this.handleOpenSettings());
    } else {
      // FIX v1.4: Handler del botón azul con lógica de reintento mejorada
      document.getElementById(btnId).addEventListener('click', (e) => this.handleRequestPermissions(e.target));
      document.getElementById(fallbackBtnId).addEventListener('click', () => this.handleOpenSettings());
    }
  }

  /**
   * FIX v1.4: Manejo de permisos con reintentos, sin salto automático a manual
   */
  async handleRequestPermissions(btnElement) {
    const btn = btnElement;
    
    try {
      // Feedback visual
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      btn.textContent = 'Abriendo diálogo Android...';
      
      const result = await requestBLEPermissions();
      
      if (result.granted) {
        // ÉXITO
        btn.style.background = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)';
        btn.textContent = '✓ Permisos concedidos';
        setTimeout(() => this.performCheck(), 800);
        
      } else {
        // FALLIDO - Análisis granular FIX v1.4
        console.log(`${NAP_WIZARD} Permisos no concedidos:`, result.nap_code, result);
        
        // Restaurar botón para reintento
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        
        // FIX v1.4: Solo ir a manual si es denegación permanente o 2+ fallos reales
        const isPermanent = result.isPermanentDenial === true;
        const isTechnical = result.isTechnicalError === true;
        const canRetry = result.canRetry !== false;  // Default true
        
        if (isPermanent) {
          console.log(`${NAP_WIZARD} Denegación permanente detectada, modo manual`);
          this.currentStep = 'permissions_manual';
          this.renderPermissions();
          return;
        }
        
        // Incrementar contador solo si no fue cancelación voluntaria
        if (!result.isUserCancelled) {
          const count = await SetupManager.recordPermissionDenied();
          this.errorCount = count;
          console.log(`${NAP_WIZARD} Contador denegaciones: ${count}`);
          
          // Solo modo manual después de 2 fallos consecutivos NO de cancelación
          if (count >= 2) {
            console.log(`${NAP_WIZARD} Cambiando a modo MANUAL tras ${count} fallos`);
            this.currentStep = 'permissions_manual';
            this.renderPermissions();
            return;
          }
        } else {
          console.log(`${NAP_WIZARD} Usuario canceló diálogo - permitiendo reintento sin penalización`);
        }
        
        // FIX v1.4: Permitir reintento manteniendo botón funcional
        if (canRetry || result.isUserCancelled) {
          btn.textContent = result.isUserCancelled ? 'Reintentar (diálogo cerrado)' : 'Reintentar';
          console.log(`${NAP_WIZARD} Listo para reintento`);
        } else {
          btn.textContent = 'Error - toca para reintentar';
        }
      }
      
    } catch (error) {
      console.error(`${NAP_WIZARD} Error crítico:`, error);
      
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.textContent = 'Error - Toca para reintentar';
      
      // FIX v1.4: No saltar a manual por error inesperado, permitir reintento
      console.log(`${NAP_WIZARD} Error inesperado, manteniendo modo automático para reintento`);
    }
  }

  renderBluetooth() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; z-index: 99999; text-align: center;">
        <div style="font-size: 56px; margin-bottom: 16px;">📡</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Bluetooth desactivado</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          Activa el Bluetooth para descubrir peers NEXO cercanos.
        </p>
        <button id="btn-bt-settings" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">
          Ir a Configuración Bluetooth
        </button>
        <button id="btn-retry" style="background: transparent; color: #666; border: 1px solid #444; padding: 12px 24px; border-radius: 10px; font-size: 14px; cursor: pointer;">
          🔄 Verificar de nuevo
        </button>
      </div>
    `;
    document.getElementById('btn-bt-settings').addEventListener('click', () => this.handleOpenBluetoothSettings());
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

  renderError() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="position: fixed; top:0; left:0; right:0; bottom:0; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; z-index: 99999; text-align: center;">
        <div style="font-size: 56px; margin-bottom: 16px;">⚠️</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Error de verificación</h2>
        <button id="btn-retry" style="background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%); color: #000; border: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; max-width: 320px; margin-bottom: 12px;">
          🔄 Reintentar verificación
        </button>
      </div>
    `;
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

  async handleOpenSettings() {
    await SetupManager.openAppSettings();
  }

  async handleOpenBluetoothSettings() {
    await SetupManager.openBluetoothSettings();
  }
}

window.SetupWizard = SetupWizard;
