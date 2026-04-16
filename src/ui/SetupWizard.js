/**
 * NEXO Setup Wizard v1.5-NAP
 * FIX: Verificación real del plugin BLE antes de completar
 */

import { SetupManager } from '../core/SetupManager.js';
import { requestBLEPermissions, checkBLEStatus } from '../core/ble_permissions.js';

const NAP_WIZARD = '[NAP-WIZARD]';

export class SetupWizard {
  constructor(containerId = 'app', onComplete) {
    this.container = document.getElementById(containerId) || document.body;
    this.onComplete = onComplete;
    this.currentStep = 'checking';
  }

  async start() {
    this.renderChecking();
    setTimeout(() => { if (this.currentStep === 'checking') this.renderError(); }, 30000);
    await this.performCheck();
  }

  async performCheck() {
    try {
      const status = await SetupManager.checkInitialStatus();
      if (status.ready) { this.onComplete(); return; }
      if (status.reason === 'permissions') this.renderPermissions();
      else if (status.reason === 'bluetooth') this.renderBluetooth();
      else this.renderError();
    } catch (e) { this.renderError(); }
  }

  renderChecking() {
    this.container.innerHTML = \`<div id="nexo-setup" style="position:fixed;top:0;left:0;right:0;bottom:0;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;"><div style="width:48px;height:48px;border:4px solid #1a1a1a;border-top:4px solid #00f0ff;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:24px;"></div><h3>Verificando sistema NAP...</h3><style>@keyframes spin{to{transform:rotate(360deg)}}</style></div>\`;
  }

  renderPermissions() {
<<<<<<< HEAD
    this.container.innerHTML = \`
      <div id="nexo-setup" style="position:fixed;top:0;left:0;right:0;bottom:0;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;z-index:99999;">
        <div style="font-size:56px;margin-bottom:16px;">🔐</div>
        <h2 style="margin:0 0 12px;font-size:26px;">Permisos BLE necesarios</h2>
        <p style="color:#888;max-width:320px;margin-bottom:32px;">NEXO requiere acceso a Bluetooth para comunicación P2P offline-first.</p>
        <button id="btn-perms" style="background:linear-gradient(135deg,#00f0ff,#007bff);color:#000;border:none;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;width:100%;max-width:320px;box-shadow:0 4px 15px rgba(0,240,255,0.3);">Conceder permisos BLE</button>
        <button id="btn-manual" style="background:none;border:none;color:#00f0ff;font-size:14px;margin-top:12px;text-decoration:underline;">Configuración manual</button>
      </div>\`;
    document.getElementById('btn-perms').addEventListener('click', (e) => this.handleRequestPermissions(e.target));
    document.getElementById('btn-manual').addEventListener('click', () => this.handleOpenSettings());
  }

  // FIX v1.5-NAP: Verificación real del plugin
  async handleRequestPermissions(btn) {
    btn.style.opacity = '0.6';
    btn.style.pointerEvents = 'none';
    btn.textContent = 'Abriendo diálogo...';
    
    try {
=======
    const isManual = this.currentStep === 'permissions_manual';
    
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
      document.getElementById(btnId).addEventListener('click', (e) => this.handleRequestPermissions(e.target));
      document.getElementById(fallbackBtnId).addEventListener('click', () => this.handleOpenSettings());
    }
  }

  // ============================================
  // FIX v1.5-NAP: Verificación real del plugin
  // ============================================
  async handleRequestPermissions(btnElement) {
    const btn = btnElement;
    
    try {
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      btn.textContent = 'Abriendo diálogo Android...';
      
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
      const result = await requestBLEPermissions();
      if (result.granted) {
        const btStatus = await checkBLEStatus();
        if (!btStatus.bluetoothEnabled) {
<<<<<<< HEAD
=======
          console.log(`${NAP_WIZARD} BT apagado, cambiando a pantalla Bluetooth`);
          this.currentStep = 'bluetooth';
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
          this.renderBluetooth();
          return;
        }
        
<<<<<<< HEAD
        // VERIFICAR PLUGIN ANTES DE COMPLETAR
        btn.textContent = 'Verificando BLE...';
        const pluginReady = await this.verifyPluginReady();
        if (!pluginReady) {
          btn.style.background = 'linear-gradient(135deg,#ff6b35,#ff4500)';
          btn.textContent = 'Error BLE - Toca para reintentar';
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
          return;
        }
        
        btn.style.background = 'linear-gradient(135deg,#00ff88,#00cc6a)';
        btn.textContent = '✓ Listo';
        setTimeout(() => this.onComplete(), 800);
      } else {
        btn.textContent = 'Reintentar';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
=======
        // FIX v1.5: Verificar que plugin responde ANTES de completar
        btn.textContent = 'Verificando BLE...';
        const pluginReady = await this.verifyPluginReady();
        
        if (!pluginReady) {
          console.error(`${NAP_WIZARD} Plugin BLE no responde`);
          btn.style.background = 'linear-gradient(135deg, #ff6b35 0%, #ff4500 100%)';
          btn.textContent = 'Error BLE - Toca para reintentar';
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
          return;
        }
        
        // ÉXITO TOTAL: Permisos + BT + Plugin responde
        btn.style.background = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)';
        btn.textContent = '✓ Listo';
        setTimeout(() => this.onComplete(), 800);
        
      } else {
        console.log(`${NAP_WIZARD} Permisos no concedidos:`, result.nap_code, result);
        
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        
        const isPermanent = result.isPermanentDenial === true;
        const isUserCancelled = result.isUserCancelled === true;
        
        if (isPermanent) {
          console.log(`${NAP_WIZARD} Denegación permanente detectada, modo manual`);
          this.currentStep = 'permissions_manual';
          this.renderPermissions();
          return;
        }
        
        if (!isUserCancelled) {
          const count = await SetupManager.recordPermissionDenied();
          this.errorCount = count;
          
          if (count >= 2) {
            console.log(`${NAP_WIZARD} Cambiando a modo MANUAL tras ${count} fallos`);
            this.currentStep = 'permissions_manual';
            this.renderPermissions();
            return;
          }
        } else {
          console.log(`${NAP_WIZARD} Usuario canceló - permitiendo reintento`);
        }
        
        btn.textContent = isUserCancelled ? 'Reintentar (diálogo cerrado)' : 'Reintentar';
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
      }
    } catch (e) {
      btn.textContent = 'Error - Reintentar';
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
<<<<<<< HEAD
=======
      btn.textContent = 'Error - Toca para reintentar';
    }
  }

  // ============================================
  // FIX v1.5-NAP: Nuevo método de verificación
  // ============================================
  async verifyPluginReady() {
    try {
      const { NexoBLE } = window.Capacitor.Plugins;
      if (!NexoBLE) {
        console.error(`${NAP_WIZARD} NexoBLE plugin no encontrado`);
        return false;
      }
      
      // Intentar llamar isBluetoothEnabled para verificar que el bridge funciona
      const response = await Promise.race([
        NexoBLE.isBluetoothEnabled(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000))
      ]);
      
      console.log(`${NAP_WIZARD} Plugin responde:`, response);
      return response && response.enabled === true;
      
    } catch (e) {
      console.error(`${NAP_WIZARD} Plugin no responde:`, e.message);
      return false;
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
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
      return response?.enabled === true;
    } catch (e) { return false; }
  }

  renderBluetooth() {
    this.container.innerHTML = \`
      <div id="nexo-setup" style="position:fixed;top:0;left:0;right:0;bottom:0;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;z-index:99999;">
        <div style="font-size:56px;margin-bottom:16px;">📡</div>
        <h2 style="margin:0 0 12px;">Bluetooth desactivado</h2>
        <p style="color:#888;max-width:320px;margin-bottom:32px;">Activa el Bluetooth para descubrir peers NEXO cercanos.</p>
        <button id="btn-bt-settings" style="background:linear-gradient(135deg,#00f0ff,#007bff);color:#000;border:none;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;width:100%;max-width:320px;">Ir a Configuración Bluetooth</button>
        <button id="btn-retry" style="background:transparent;color:#666;border:1px solid #444;padding:12px 24px;border-radius:10px;font-size:14px;margin-top:12px;">🔄 Verificar de nuevo</button>
      </div>\`;
    document.getElementById('btn-bt-settings').addEventListener('click', () => SetupManager.openBluetoothSettings());
    document.getElementById('btn-retry').addEventListener('click', () => this.performCheck());
  }

  renderError() {
    this.container.innerHTML = \`<div id="nexo-setup" style="position:fixed;top:0;left:0;right:0;bottom:0;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><h2>Error</h2><button onclick="location.reload()" style="background:#00f0ff;color:#000;border:none;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:20px;">🔄 Reintentar</button></div>\`;
  }

  async handleOpenSettings() { await SetupManager.openAppSettings(); }
}

window.SetupWizard = SetupWizard;
