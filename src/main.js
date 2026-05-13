/**
 * src/main.js - Punto de entrada NEXO v9.1-FIX
 * FIX: SetupManager usa requestBLEPermissions en vez de checkBLEStatus (no existe en plugin 961)
 * Fondo #000000 forzado
 */

import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { SetupWizard } from './ui/SetupWizard.js';
import { requestBLEPermissions } from './core/ble_permissions.js';

window.NEXO = {
  app: null,
  rem: null,
  diag: null,
  version: '9.1-FIX',
  initialized: false
};

window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;

// FIX: Fuerza fondo negro puro inmediatamente
document.documentElement.style.backgroundColor = '#000000';
document.body.style.backgroundColor = '#000000';

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
    
    // FIX: Reemplaza SetupManager.checkInitialStatus() por check directo con requestBLEPermissions
    let needsSetup = false;
    try {
      const permResult = await requestBLEPermissions();
      // Plugin 961 devuelve boolean o objeto {scan, connect}
      const hasPerms = permResult === true || (permResult && permResult.scan === 'granted');
      if (!hasPerms) needsSetup = true;
    } catch (e) {
      console.warn('[MAIN] Error check permisos:', e.message);
      needsSetup = true;
    }

    if (needsSetup) {
      rem.info('[Setup] Requerido: permissions', 'SETUP_REQUIRED');
      NEXO_DIAG.hideSplash();

      const wizard = new SetupWizard('app', async () => {
        rem.success('[Setup] Wizard completado', 'SETUP_OK');
        wizard.destroy();
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
    console.log('✅ NEXO v9.1-FIX Inicializado');
  } catch (error) {
    console.error('💥 Error en NexoApp:', error);
  }
}

function _ensureDOMStructure() {
    if (!document.getElementById('app')) {
        const app = document.createElement('div');
        app.id = 'app';
        app.style.backgroundColor = '#000000';
        document.body.appendChild(app);
    }
}
