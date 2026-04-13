/**
 * NEXO Setup Wizard v1.1
 * UI de onboarding para Android 14 BLE
 * No requiere React - usa DOM manipulation vanilla
 * NAP 2.0 Certified - Error Boundaries & Graceful Degradation
 */

import { SetupManager } from '../core/SetupManager.js';
import { requestBLEPermissions, checkBLEStatus } from '../core/ble_permissions.js';

export class SetupWizard {
  constructor(containerId = 'app', onComplete) {
    this.container = document.getElementById(containerId) || document.body;
    this.onComplete = onComplete;
    this.currentStep = 'checking';
    this.errorCount = 0;
    
    // NAP: Exponer para debugging
    window.NEXO_WIZARD = this;
  }

  /**
   * Iniciar wizard
   * NAP: Con timeout de seguridad
   */
  async start() {
    this.renderChecking();
    
    // NAP: Timeout de seguridad 15s (anti-bloqueo)
    setTimeout(() => {
      if (this.currentStep === 'checking') {
        console.warn('[SetupWizard] NAP: Timeout de verificación, forzando error');
        this.currentStep = 'error';
        this.renderError();
      }
    }, 15000);
    
    await this.performCheck();
  }

  /**
   * Check principal
   * NAP: Try-catch completo, nunca bloquea
   */
  async performCheck() {
    try {
      console.log('[SetupWizard] NAP: Iniciando verificación...');
      const status = await SetupManager.checkInitialStatus();
      
      console.log('[SetupWizard] NAP: Status recibido:', status);
      
      if (status.ready) {
        // NAP: Setup completo, continuar a app
        console.log('[SetupWizard] NAP: Sistema listo, completando...');
        this.onComplete();
        return;
      }

      // Determinar paso siguiente
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
      // NAP: Error boundary - mostrar pantalla de error, no quedarse en spinner
      console.error('[SetupWizard] NAP Error Boundary:', error);
      this.currentStep = 'error';
      this.renderError();
    }
  }

  /**
   * Render: Pantalla de carga
   * NAP: Z-index máximo, no bloqueable
   */
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
        <div style="
          width: 48px; height: 48px;
          border: 4px solid #1a1a1a;
          border-top: 4px solid #00f0ff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 24px;
        "></div>
        <h3 style="margin:0; font-size: 20px; font-weight: 600;">Verificando sistema NAP...</h3>
        <p style="color: #666; margin-top: 8px; font-size: 14px;">BLE Mesh v2.3 | Android 14+</p>
        <style>
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </div>
    `;
  }

  /**
   * Render: Paso de Permisos
   */
  renderPermissions() {
    const isManual = this.currentStep === 'permissions_manual';
    
    this.container.innerHTML = `
      <div id="nexo-setup" style="
        position: fixed; top:0; left:0; right:0; bottom:0;
        background: #000; color: #fff;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 2rem;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 99999;
        text-align: center;
      ">
        <div style="font-size: 56px; margin-bottom: 16px;">🔐</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Permisos NAP necesarios</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          NEXO requiere acceso a Bluetooth para comunicación P2P offline-first (Protocolo NAP 2.0).
        </p>
        
        <div style="
          display: flex; flex-direction: column; gap: 12px;
          width: 100%; max-width: 340px; margin-bottom: 32px;
        ">
          <div style="
            background: #0f0f0f; border: 1px solid #222;
            border-radius: 12px; padding: 16px 20px;
            display: flex; align-items: center; gap: 14px;
            font-size: 15px; text-align: left;
          ">
            <span style="font-size: 22px;">📡</span>
            <span>Escanear dispositivos NAP cercanos</span>
          </div>
          <div style="
            background: #0f0f0f; border: 1px solid #222;
            border-radius: 12px; padding: 16px 20px;
            display: flex; align-items: center; gap: 14px;
            font-size: 15px; text-align: left;
          ">
            <span style="font-size: 22px;">🔗</span>
            <span>Conectar con peers NEXO</span>
          </div>
        </div>

        ${isManual ? `
          <p style="
            color: #ffaa00; font-size: 14px; max-width: 320px;
            background: rgba(255,170,0,0.1); padding: 12px 16px;
            border-radius: 8px; border: 1px solid rgba(255,170,0,0.2);
            margin-bottom: 20px; line-height: 1.5;
          ">
            ⚠️ NAP: Has denegado los permisos múltiples veces. Android requiere activación manual.
          </p>
          <button id="btn-settings" style="
            background: linear-gradient(135deg, #ff6b35 0%, #ff4500 100%);
            color: #fff; border: none; padding: 16px 32px;
            border-radius: 12px; font-size: 16px; font-weight: 700;
            cursor: pointer; width: 100%; max-width: 320px;
            margin-bottom: 12px;
          ">Ir a Configuración del sistema (NAP)</button>
          <p style="color: #555; font-size: 13px; max-width: 280px;">
            Busca "Permisos" → Activa "Dispositivos cercanos"
          </p>
        ` : `
          <button id="btn-perms" style="
            background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%);
            color: #000; border: none; padding: 16px 32px;
            border-radius: 12px; font-size: 16px; font-weight: 700;
            cursor: pointer; width: 100%; max-width: 320px;
            margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,240,255,0.3);
          ">Conceder permisos NAP</button>
          <button id="btn-settings" style="
            background: none; border: none; color: #00f0ff;
            font-size: 14px; cursor: pointer; text-decoration: underline;
            opacity: 0.8;
          ">Configuración manual</button>
        `}
      </div>
    `;

    // Bind events NAP
    if (!isManual) {
      document.getElementById('btn-perms').addEventListener('click', () => this.handleRequestPermissions());
    }
    document.getElementById('btn-settings').addEventListener('click', () => this.handleOpenSettings());
  }

  /**
   * Render: Paso Bluetooth
   */
  renderBluetooth() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="
        position: fixed; top:0; left:0; right:0; bottom:0;
        background: #000; color: #fff;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 2rem;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 99999;
        text-align: center;
      ">
        <div style="font-size: 56px; margin-bottom: 16px;">📡</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Bluetooth NAP desactivado</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          Activa el Bluetooth para descubrir peers NEXO cercanos en modo offline P2P.
        </p>
        
        <div style="
          background: #1a0a0a; border: 1px solid #331111;
          border-radius: 10px; padding: 14px 28px;
          margin-bottom: 28px; display: flex; align-items: center; gap: 10px;
          font-size: 15px; color: #ff6b6b;
        ">
          <span style="
            width: 8px; height: 8px; border-radius: 50%;
            background: #ff4444; box-shadow: 0 0 8px #ff4444;
          "></span>
          <span>NAP Status: Desconectado</span>
        </div>

        <button id="btn-bt-settings" style="
          background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%);
          color: #000; border: none; padding: 16px 32px;
          border-radius: 12px; font-size: 16px; font-weight: 700;
          cursor: pointer; width: 100%; max-width: 320px;
          margin-bottom: 12px;
        ">Ir a Configuración Bluetooth</button>
        
        <p style="color: #555; font-size: 13px; margin-bottom: 20px;">
          Después de activarlo, regresa a NEXO
        </p>
        
        <button id="btn-retry" style="
          background: transparent; color: #666; border: 1px solid #444;
          padding: 12px 24px; border-radius: 10px; font-size: 14px;
          cursor: pointer;
        ">🔄 NAP: Verificar de nuevo</button>
      </div>
    `;

    document.getElementById('btn-bt-settings').addEventListener('click', () => this.handleOpenBluetoothSettings());
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

  /**
   * Render: Error genérico NAP
   */
  renderError() {
    this.container.innerHTML = `
      <div id="nexo-setup" style="
        position: fixed; top:0; left:0; right:0; bottom:0;
        background: #000; color: #fff;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 2rem;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 99999;
        text-align: center;
      ">
        <div style="font-size: 56px; margin-bottom: 16px;">⚠️</div>
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Error NAP de verificación</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          No se pudo verificar el estado del sistema BLE. Puedes continuar con funcionalidad limitada.
        </p>
        <button id="btn-retry" style="
          background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%);
          color: #000; border: none; padding: 16px 32px;
          border-radius: 12px; font-size: 16px; font-weight: 700;
          cursor: pointer; width: 100%; max-width: 320px;
          margin-bottom: 12px;
        ">🔄 Reintentar verificación NAP</button>
        <button id="btn-continue" style="
          background: transparent; color: #666; border: 1px solid #444;
          padding: 12px 24px; border-radius: 10px; font-size: 14px;
          cursor: pointer; margin-top: 8px;
        ">⚠️ Continuar de todos modos</button>
      </div>
    `;

    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
    document.getElementById('btn-continue').addEventListener('click', () => {
      // NAP: Permitir bypass si el usuario quiere (modo degradado)
      console.warn('[SetupWizard] NAP: Usuario forzando continuación con error');
      this.onComplete();
    });
  }

  /**
   * Handlers NAP
   */
  async handleRequestPermissions() {
    try {
      await requestBLEPermissions();
      // NAP: Delay para que Android procese
      setTimeout(() => this.performCheck(), 1000);
    } catch (error) {
      console.error('[SetupWizard] NAP: Permission error:', error);
      const count = await SetupManager.recordPermissionDenied();
      this.errorCount = count;
      
      if (count >= 2) {
        this.currentStep = 'permissions_manual';
        this.renderPermissions();
      }
    }
  }

  async handleOpenSettings() {
    await SetupManager.openAppSettings();
  }

  async handleOpenBluetoothSettings() {
    await SetupManager.openBluetoothSettings();
  }
}
