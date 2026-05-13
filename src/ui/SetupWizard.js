/**
 * NEXO Setup Wizard v3.0.2-FIX
 * Compatible con NexoBlePlugin.kt 961 (solo requestPermissions, NO checkBLEStatus)
 * FIX: Usa requestPermissions() directo + polling manual de Bluetooth API
 */

import { requestBLEPermissions } from '../core/ble_permissions.js';

const NAP_WIZARD = '[NAP-WIZARD]';

export class SetupWizard {
  constructor(containerId = 'app', onComplete) {
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'nexo-setup';
    this.overlayContainer.style.cssText = 
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;background:#000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(this.overlayContainer);
    this.container = this.overlayContainer;
    this.onComplete = onComplete;
    this.currentStep = 'checking';
    window.NEXO_WIZARD = this;
  }

  async start() {
    this.renderChecking();
    await this.performCheck();
  }

  async performCheck() {
    try {
      // FIX: Plugin 961 solo tiene requestPermissions, no checkBLEStatus
      const result = await requestBLEPermissions();
      if (result === true || (result && result.scan === 'granted')) {
        this.currentStep = 'success';
        this.renderSuccess();
        setTimeout(() => this.onComplete(), 800);
        return;
      }
    } catch (e) {
      console.warn(NAP_WIZARD, 'Permisos no concedidos:', e.message);
    }
    this.currentStep = 'permissions';
    this.renderPermissions();
  }

  renderChecking() {
    this.container.innerHTML = `
      <div style="text-align:center;color:#fff;">
        <div style="width:40px;height:40px;border:3px solid #0066cc;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
        <p>Verificando permisos BLE...</p>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
  }

  renderPermissions() {
    this.container.innerHTML = `
      <div style="text-align:center;color:#fff;max-width:320px;padding:20px;">
        <h2 style="margin-bottom:10px;font-size:22px;">Permisos necesarios</h2>
        <p style="color:#94a3b8;margin-bottom:24px;font-size:14px;">
          NEXO necesita acceso a Bluetooth y Ubicación para conectar con dispositivos cercanos.
        </p>
        <button id="btn-request-perms" style="
          background:#0066cc;color:#fff;border:none;padding:14px 32px;
          border-radius:28px;font-size:16px;font-weight:600;cursor:pointer;
          width:100%;margin-bottom:12px;
        ">Conceder permisos</button>
        <button id="btn-cancel-perms" style="
          background:transparent;color:#64748b;border:1px solid #334155;
          padding:12px 32px;border-radius:28px;font-size:14px;cursor:pointer;
          width:100%;
        ">Cancelar</button>
      </div>
    `;

    document.getElementById('btn-request-perms').onclick = async () => {
      try {
        const result = await requestBLEPermissions();
        if (result === true || (result && result.scan === 'granted')) {
          this.renderSuccess();
          setTimeout(() => this.onComplete(), 800);
        } else {
          this.renderDenied();
        }
      } catch (e) {
        this.renderDenied();
      }
    };

    document.getElementById('btn-cancel-perms').onclick = () => {
      this.renderDenied();
    };
  }

  renderSuccess() {
    this.container.innerHTML = `
      <div style="text-align:center;color:#fff;">
        <div style="font-size:48px;margin-bottom:16px;">✓</div>
        <h2 style="margin-bottom:8px;">¡Listo!</h2>
        <p style="color:#94a3b8;">Permisos concedidos correctamente.</p>
      </div>
    `;
  }

  renderDenied() {
    this.container.innerHTML = `
      <div style="text-align:center;color:#fff;max-width:320px;padding:20px;">
        <div style="font-size:48px;margin-bottom:16px;">⚠</div>
        <h2 style="margin-bottom:8px;color:#ef4444;">Permisos denegados</h2>
        <p style="color:#94a3b8;margin-bottom:24px;font-size:14px;">
          Sin estos permisos NEXO no puede funcionar. Ve a Ajustes > Aplicaciones > NEXO > Permisos.
        </p>
        <button id="btn-retry-perms" style="
          background:#0066cc;color:#fff;border:none;padding:14px 32px;
          border-radius:28px;font-size:16px;font-weight:600;cursor:pointer;
          width:100%;
        ">Reintentar</button>
      </div>
    `;
    document.getElementById('btn-retry-perms').onclick = () => this.renderPermissions();
  }

  destroy() {
    if (this.overlayContainer) this.overlayContainer.remove();
  }
}
