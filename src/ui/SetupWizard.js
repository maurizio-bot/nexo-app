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
      const result = await requestBLEPermissions();
      if (result.granted) {
        const btStatus = await checkBLEStatus();
        if (!btStatus.bluetoothEnabled) {
          this.renderBluetooth();
          return;
        }
        
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
      }
    } catch (e) {
      btn.textContent = 'Error - Reintentar';
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
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
