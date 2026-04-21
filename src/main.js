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

// NAP 2.0: Exponer REM globalmente para subsistemas
window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;

// NAP 2.0: Safety timeout 15s (tiempo para BLE init + permisos)
const SAFETY_TIMEOUT = setTimeout(() => {
  if (NEXO_DIAG.isSplashVisible?.()) {
    rem.warn('Timeout de seguridad - forzando continuar', 'INIT_TIMEOUT');
    NEXO_DIAG.hideSplash();
    document.body.classList.add('nexo-force-ready');
  }
}, 15000);

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Inicializar diagnostico NAP
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    
    _ensureDOMStructure();
    
    // Inicializar REM
    window.NEXO.rem = rem;
    rem.init();
    rem.info('REM v2.1 NAP 2.0 initialized', 'REM_INIT');
    
    // ============================================
    // Build #630: Setup Wizard Integration
    // Verificar onboarding BLE antes de iniciar app
    // ============================================
    rem.info('[Setup] Verificando estado de configuración...', 'SETUP_CHECK');
    
    const setupStatus = await SetupManager.checkInitialStatus();
    
    if (!setupStatus.ready) {
      rem.info(`[Setup] Requerido: ${setupStatus.reason}`, 'SETUP_REQUIRED');
      
      // Ocultar splash para mostrar wizard
      NEXO_DIAG.hideSplash();
      
      // Crear e iniciar wizard
      const wizard = new SetupWizard('app', async () => {
        // Callback cuando wizard termina exitosamente
        rem.success('[Setup] Wizard completado', 'SETUP_OK');
        await SetupManager.markCompleted();
        
        // Continuar con inicialización normal
        await initializeNexoApp();
      });
      
      await wizard.start();
      return; // El wizard se encarga de llamar initializeNexoApp cuando termine
      
    } else {
      rem.info('[Setup] Configuración ya completada', 'SETUP_SKIP');
      // Setup ya hecho, iniciar directamente
      await initializeNexoApp();
    }
    
  } catch (error) {
    console.error('💥 Error fatal en inicialización:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('INIT_FATAL', error.message);
    rem.error(`Error fatal: ${error.message}`, 'INIT_FATAL');
    NEXO_DIAG.hideSplash();
    
    // NAP 2.0: Intentar modo degradado
    _enableFallbackMode();
  }
});

/**
 * Inicialización de la aplicación principal NexoApp
 * Extraída a función separada para poder llamarla desde el wizard o directamente
 */
async function initializeNexoApp() {
  try {
    // Configuración NEXO App
    const nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: 10000,
      enableGestures: true,
      enableMesh: true, // NAP 2.0: Activar NordicMesh + HybridMesh
      onMessage: (msg) => {
        console.log('📨 Mensaje:', msg);
        _renderMessage(msg);
      },
      onStatusChange: (mode) => {
        console.log('🌐 Modo:', mode);
        rem.updateMode(mode);
      },
      onError: (err) => {
        console.error('App error:', err);
        rem.error(err.message, 'APP_ERR');
      },
      onVaultStateChange: (isOpen) => _toggleVaultUI(isOpen),
      actionCallbacks: {
        onReact: (id) => rem.success('Reacción añadida', 'REACT_OK'),
        onReply: (id) => _focusInput(`@${id?.substr(0,8)} `),
        onForward: (id) => rem.info('Listo para reenviar', 'FORWARD_READY')
      }
    };
    
    rem.info('🚀 [NEXO] App instance v3.3.0-NAP', 'NEXO_INIT');
    
    // Crear instancia
    window.NEXO.app = new NexoApp(nexoConfig);
    
    rem.info('[init] ===== INICIANDO NEXO v3.3.0-NAP =====', 'INIT_START');
    
    // Init con timeout de 12 segundos (NAP 2.0 Resource Management)
    const initPromise = window.NEXO.app.init();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('INIT_TIMEOUT')), 12000)
    );
    
    try {
      await Promise.race([initPromise, timeoutPromise]);
      rem.success('==== INICIALIZACIÓN NAP 2.0 COMPLETADA ====', 'INIT_OK');
    } catch (timeoutErr) {
      // NAP 2.0: Graceful degradation
      rem.warn('Init timeout - continuando con funcionalidad limitada', 'INIT_WARN');
      rem.info('BLE puede no estar disponible, verifica permisos', 'INIT_FALLBACK');
    }
    
    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);
    
    // Setup UI
    _setupMessageInput();
    _setupVaultToggle();
    _setupKeyboardShortcuts(); // NAP 2.0: Atajos adicionales
    
    NEXO_DIAG.hideSplash();
    rem.success('NEXO v9.0-NAP Listo', 'INIT_OK');
    console.log('✅ NEXO v9.0-NAP Inicializado');
    
    // ============================================
    // FIX VISTAS: Abrir panel BLE como vista inicial
    // El chat permanece oculto hasta que usuario pulse "Escribir"
    // ============================================
    if (window.NEXO.app?.bleInterface?.togglePanel) {
      const blePanel = document.getElementById('ble-panel');
      if (blePanel && !blePanel.classList.contains('active')) {
        window.NEXO.app.bleInterface.togglePanel();
        rem.info('[UI] Panel BLE abierto como vista inicial', 'BLE_PANEL_OPEN');
      }
    }
    
    // Log estado final
    const status = window.NEXO.app.getStatus?.();
    if (status) {
      console.log('[NEXO STATUS]', status);
    }
    
  } catch (error) {
    console.error('💥 Error en NexoApp:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('APP_INIT_ERROR', error.message);
    rem.error(`Error al iniciar app: ${error.message}`, 'APP_ERR');
    NEXO_DIAG.hideSplash();
    _enableFallbackMode();
  }
}

// NAP 2.0: Estructura DOM mínima garantizada
function _ensureDOMStructure() {
  const stream = document.getElementById('nexo-stream') || document.querySelector('.stream-container');
  const vault = document.getElementById('nexo-vault') || document.querySelector('.vault-panel');
  
  if (stream && !stream.id) stream.id = 'nexo-stream';
  if (vault && !vault.id) vault.id = 'nexo-vault';
  
  // Crear contenedor de mensajes si no existe
  if (!document.getElementById('messages-container')) {
    const msgContainer = document.createElement('div');
    msgContainer.id = 'messages-container';
    msgContainer.className = 'messages-container';
    (stream || document.body).appendChild(msgContainer);
  }
}

function _setupMessageInput() {
  const input = document.getElementById('message-input');
  const btn = document.getElementById('send-btn');
  if (!input || !btn || !window.NEXO.app) return;
  
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    input.focus();
    
    try {
      const sent = await window.NEXO.app.sendMessage({ content: text });
      if (sent) {
        rem.success('Enviado', 'MSG_SENT');
      } else {
        rem.info('En cola (offline)', 'MSG_QUEUED');
      }
    } catch (e) {
      rem.error('Error al enviar', 'MSG_ERR');
    }
  };
  
  btn.addEventListener('click', send);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
  
  input.focus();
}

function _setupVaultToggle() {
  const vault = document.getElementById('vault-panel');
  if (vault) vault.classList.add('vault-hidden');
}

// NAP 2.0: Atajos de teclado
function _setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+V: Toggle Vault
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      const vault = document.getElementById('vault-panel');
      if (vault) {
        const isHidden = vault.classList.contains('vault-hidden');
        _toggleVaultUI(!isHidden);
      }
    }
    
    // Ctrl+Shift+L: Toggle REM visibility
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      e.preventDefault();
      rem.toggle?.();
    }
    
    // Ctrl+Shift+H: REM History
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      rem.showHistory?.();
    }
  });
}

function _renderMessage(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;
  
  const div = document.createElement('div');
  div.className = `message ${msg._own ? 'own' : 'other'}`;
  
  // NAP 2.0: Mostrar fuente del mensaje (BLE, Relay, etc.)
  const sourceBadge = msg._source ? 
    `<span class="msg-source" title="${msg._source}">${_getSourceIcon(msg._source)}</span>` : '';
  
  div.innerHTML = `
    <div class="message-content">${msg.content || msg.text}</div>
    <div class="message-meta">
      <span>${new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
      ${sourceBadge}
    </div>
  `;
  
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function _getSourceIcon(source) {
  const icons = {
    'ble_nordic': '🔷', // Nordic Mesh BLE
    'ble_hybrid': '📡', // Hybrid Mesh BLE/WiFi
    'relay': '🌐',      // WebSocket Relay
    'self': '✓'         // Mensaje propio
  };
  return icons[source] || '•';
}

function _toggleVaultUI(isOpen) {
  const vault = document.getElementById('vault-panel');
  const stream = document.getElementById('nexo-stream');
  
  if (vault) {
    vault.classList.toggle('vault-hidden', !isOpen);
    vault.classList.toggle('vault-visible', isOpen);
    rem.info(isOpen ? '[VAULT] Abierto' : '[VAULT] Cerrado', 'VAULT_TOGGLE');
  }
  
  if (stream) {
    stream.style.transform = isOpen ? 'translateX(-20%)' : 'translateX(0)';
  }
}

function _focusInput(text = '') {
  const input = document.getElementById('message-input');
  if (input) { 
    input.focus(); 
    if (text) input.value = text;
  }
}

// NAP 2.0: Modo degradado si init falla completamente
function _enableFallbackMode() {
  console.warn('[NEXO] Activando modo fallback');
  const body = document.body;
  body.classList.add('nexo-fallback-mode');
  
  // Mostrar mensaje al usuario
  const msg = document.createElement('div');
  msg.className = 'fallback-notice';
  msg.innerHTML = `
    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                background: #ff4444; color: white; padding: 20px; border-radius: 8px; z-index: 99999;">
      <h3>⚠️ Error de Inicialización</h3>
      <p>La app no pudo iniciar completamente.</p>
      <button onclick="location.reload()" style="padding: 10px 20px; margin-top: 10px;">Reintentar</button>
    </div>
  `;
  body.appendChild(msg);
}

// HMR
if (module.hot) module.hot.accept();
