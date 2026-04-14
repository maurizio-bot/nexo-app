/**
 * NEXO Setup Wizard v1.3-NAP
 * UI de onboarding para Android 14 BLE
 * NAP 2.0 Certified - UX Feedback & Graceful Degradation
 * 
 * CHANGELOG:
 * - v1.3: Feedback visual en botón de permisos
 * - v1.3: Manejo explícito de granted/denied con NAP codes
 * - v1.3: Timeout extendido para diálogo nativo Android (15s -> 30s)
 */

import { SetupManager } from '../core/SetupManager.js';
import { requestBLEPermissions, checkBLEStatus } from '../core/ble_permissions.js';

// NAP Logging
const NAP_WIZARD = '[NAP-WIZARD]';

export class SetupWizard {
  constructor(containerId = 'app', onComplete) {
    this.container = document.getElementById(containerId) || document.body;
    this.onComplete = onComplete;
    this.currentStep = 'checking';
    this.errorCount = 0;
    
    // Debug global NAP
    window.NEXO_WIZARD = this;
    console.log(`${NAP_WIZARD} Inicializado v1.3-NAP`);
  }

  async start() {
    this.renderChecking();
    
    // NAP: Timeout de seguridad extendido a 30s (diálogo Android tarda)
    setTimeout(() => {
      if (this.currentStep === 'checking') {
        console.warn(`${NAP_WIZARD} Timeout de verificación, forzando error`);
        this.currentStep = 'error';
        this.renderError();
      }
    }, 30000);
    
    await this.performCheck();
  }

  async performCheck() {
    try {
      console.log(`${NAP_WIZARD} Iniciando verificación NAP...`);
      const status = await SetupManager.checkInitialStatus();
      
      console.log(`${NAP_WIZARD} Status recibido:`, status);
      
      if (status.ready) {
        console.log(`${NAP_WIZARD} Sistema listo, completando onboarding...`);
        this.onComplete();
        return;
      }

      if (status.reason === 'permissions') {
        const shouldManual = await SetupManager.shouldGoToSettings();
        console.log(`${NAP_WIZARD} Modo permisos: ${shouldManual ? 'MANUAL' : 'NORMAL'}`);
        this.currentStep = shouldManual ? 'permissions_manual' : 'permissions';
        this.renderPermissions();
      } else if (status.reason === 'bluetooth') {
        console.log(`${NAP_WIZARD} Modo Bluetooth desactivado`);
        this.currentStep = 'bluetooth';
        this.renderBluetooth();
      } else {
        console.error(`${NAP_WIZARD} Error desconocido:`, status.reason);
        this.currentStep = 'error';
        this.renderError();
      }
      
    } catch (error) {
      console.error(`${NAP_WIZARD} Error Boundary:`, error);
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
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Permisos BLE necesarios</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          NEXO requiere acceso a Bluetooth para comunicación P2P offline-first (BLE Mesh v2.3).
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
            opacity: 0.5;
          ">
            <span style="font-size: 22px;">📡</span>
            <span>Escanear dispositivos BLE cercanos</span>
          </div>
          <div style="
            background: #0f0f0f; border: 1px solid #222;
            border-radius: 12px; padding: 16px 20px;
            display: flex; align-items: center; gap: 14px;
            font-size: 15px; text-align: left;
            opacity: 0.5;
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
            ⚠️ Has denegado los permisos múltiples veces. Android requiere activación manual.
          </p>
          <button id="btn-settings" style="
            background: linear-gradient(135deg, #ff6b35 0%, #ff4500 100%);
            color: #fff; border: none; padding: 16px 32px;
            border-radius: 12px; font-size: 16px; font-weight: 700;
            cursor: pointer; width: 100%; max-width: 320px;
            margin-bottom: 12px;
          ">Abrir Configuración de la App</button>
          <p style="color: #555; font-size: 13px; max-width: 280px;">
            Busca "Permisos" → Activa "Dispositivos cercanos" y "Bluetooth"
          </p>
        ` : `
          <button id="btn-perms" style="
            background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%);
            color: #000; border: none; padding: 16px 32px;
            border-radius: 12px; font-size: 16px; font-weight: 700;
            cursor: pointer; width: 100%; max-width: 320px;
            margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,240,255,0.3);
            transition: all 0.3s ease;
          ">Conceder permisos BLE</button>
          <button id="btn-settings" style="
            background: none; border: none; color: #00f0ff;
            font-size: 14px; cursor: pointer; text-decoration: underline;
            opacity: 0.8;
          ">Configuración manual</button>
        `}
      </div>
    `;

    if (!isManual) {
      const btn = document.getElementById('btn-perms');
      btn.addEventListener('click', () => this.handleRequestPermissions(btn));
    }
    document.getElementById('btn-settings').addEventListener('click', () => this.handleOpenSettings());
  }

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
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Bluetooth desactivado</h2>
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
          <span>BLE Status: Desconectado</span>
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
        ">🔄 Verificar de nuevo</button>
      </div>
    `;

    document.getElementById('btn-bt-settings').addEventListener('click', () => this.handleOpenBluetoothSettings());
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

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
        <h2 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 600;">Error de verificación</h2>
        <p style="color: #888; font-size: 16px; max-width: 320px; line-height: 1.4; margin-bottom: 32px;">
          No se pudo verificar el estado del sistema BLE. Puedes continuar con funcionalidad limitada.
        </p>
        <button id="btn-retry" style="
          background: linear-gradient(135deg, #00f0ff 0%, #007bff 100%);
          color: #000; border: none; padding: 16px 32px;
          border-radius: 12px; font-size: 16px; font-weight: 700;
          cursor: pointer; width: 100%; max-width: 320px;
          margin-bottom: 12px;
        ">🔄 Reintentar verificación</button>
        <button id="btn-continue" style="
          background: transparent; color: #666; border: 1px solid #444;
          padding: 12px 24px; border-radius: 10px; font-size: 14px;
          cursor: pointer; margin-top: 8px;
        ">⚠️ Continuar de todos modos</button>
      </div>
    `;

    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
    document.getElementById('btn-continue').addEventListener('click', () => {
      console.warn(`${NAP_WIZARD} Usuario forzando continuación con error`);
      this.onComplete();
    });
  }

  /**
   * NAP: Manejo de solicitud de permisos con UX feedback
   */
  async handleRequestPermissions(btnElement) {
    const btn = btnElement || document.getElementById('btn-perms');
    
    try {
      // NAP UX: Feedback visual inmediato
      if (btn) {
        btn.style.opacity = '0.6';
        btn.style.pointerEvents = 'none';
        btn.textContent = 'Abriendo diálogo Android...';
        console.log(`${NAP_WIZARD} UX: Botón desactivado visualmente`);
      }
      
      console.log(`${NAP_WIZARD} Solicitando permisos BLE...`);
      const result = await requestBLEPermissions();
      
      console.log(`${NAP_WIZARD} Resultado permisos:`, result.nap_code, result);
      
      if (result.granted) {
        // ÉXITO NAP
        if (btn) {
          btn.style.background = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)';
          btn.textContent = '✓ Permisos concedidos';
        }
        console.log(`${NAP_WIZARD} ÉXITO: Permisos concedidos, rechequeando...`);
        setTimeout(() => this.performCheck(), 800);
        
      } else {
        // FALLIDO - Análisis NAP
        console.log(`${NAP_WIZARD} Permisos no concedidos:`, result.nap_code);
        
        // Restaurar botón
        if (btn) {
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
          btn.textContent = 'Conceder permisos BLE';
        }
        
        // Registrar denegación NAP
        const count = await SetupManager.recordPermissionDenied();
        this.errorCount = count;
        console.log(`${NAP_WIZARD} Contador denegaciones: ${count}`);
        
        // Modo manual después de 2 fallos o si es necesario settings manual
        if (count >= 2 || result.needsManualSettings) {
          console.log(`${NAP_WIZARD} Cambiando a modo MANUAL`);
          this.currentStep = 'permissions_manual';
          this.renderPermissions();
        } else {
          // Primer fallo - mantener en pantalla normal para reintento
          console.log(`${NAP_WIZARD} Permitiendo reintento #${count}`);
        }
      }
      
    } catch (error) {
      // NAP ERROR BOUNDARY
      console.error(`${NAP_WIZARD} Error crítico en permisos:`, error);
      
      // Restaurar botón
      if (btn) {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.textContent = 'Conceder permisos BLE';
      }
      
      // Forzar modo manual
      const count = await SetupManager.recordPermissionDenied();
      if (count >= 2) {
        this.currentStep = 'permissions_manual';
        this.renderPermissions();
      }
    }
  }

  async handleOpenSettings() {
    console.log(`${NAP_WIZARD} Abriendo configuración manual...`);
    await SetupManager.openAppSettings();
  }

  async handleOpenBluetoothSettings() {
    console.log(`${NAP_WIZARD} Abriendo configuración Bluetooth...`);
    await SetupManager.openBluetoothSettings();
  }
}

// Export para NAP debug
window.SetupWizard = SetupWizard;


