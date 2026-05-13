/**
 * src/main.js - Punto de entrada NEXO v9.0-NAP
 * NAP 2.0 Certified - BLE Soberano P2P
 * v3.3.0 - Protocolo GATT NEXO + NordicMesh
 * Build #630: SetupWizard Integration for Android 14 BLE onboarding
 */

import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { SetupManager } from './core/SetupManager.js';
import { SetupWizard } from './ui/SetupWizard.js';

window.NEXO = {
  app: null,
  rem: null,
  diag: null,
  version: '9.0-NAP',
  initialized: false
};

window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;

const SAFETY_TIMEOUT = setTimeout(() => {
  if (NEXO_DIAG.isSplashVisible?.()) {
    rem.warn('Timeout de seguridad - forzando continuar', 'INIT_TIMEOUT');
    NEXO_DIAG.hideSplash();
    document.body.classList.add('nexo-force-ready');
  }
}, 15000);

document.addEventListener('DOMContentLoaded', async () => {
  try {
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();

    window.NEXO.rem = rem;
    rem.init();
    rem.info('REM v2.1 NAP 2.0 initialized', 'REM_INIT');

    rem.info('[Setup] Verificando estado de configuración...', 'SETUP_CHECK');
    const setupStatus = await SetupManager.checkInitialStatus();

    if (!setupStatus.ready) {
      rem.info(`[Setup] Requerido: ${setupStatus.reason}`, 'SETUP_REQUIRED');
      NEXO_DIAG.hideSplash();

      const wizard = new SetupWizard('app', async () => {
        rem.success('[Setup] Wizard completado', 'SETUP_OK');
        wizard.destroy();
        await SetupManager.markCompleted();
        await initializeNexoApp();
      });

      await wizard.start();
      return;
    } else {
      rem.info('[Setup] Configuración ya completada', 'SETUP_SKIP');
      await initializeNexoApp();
    }
  } catch (error) {
    console.error('💥 Error fatal en inicialización:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('INIT_FATAL', error.message);
  }
});

async function initializeNexoApp() {
  try {
    const app = new NexoApp({
      enableMesh: true,
      onMessage: (msg) => {
          // Manejo de mensajes globales
      }
    });
    await app.init();
    window.NEXO.app = app;
    window.NEXO.initialized = true;
    
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.hideSplash();
    console.log('✅ NEXO v9.0-NAP Inicializado');
  } catch (error) {
    console.error('💥 Error en NexoApp:', error);
  }
}

function _ensureDOMStructure() {
    if (!document.getElementById('app')) {
        const app = document.createElement('div');
        app.id = 'app';
        document.body.appendChild(app);
    }
}
