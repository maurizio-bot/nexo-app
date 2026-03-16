/**
 * src/main.js - Punto de entrada NEXO v9.0-NAP-REM
 */

import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';

window.NEXO = {
  app: null,
  rem: null,
  diag: null,
  version: '9.0-REM',
  initialized: false
};

// Safety timeout: si todo falla, ocultar splash a los 10 segundos
const SAFETY_TIMEOUT = setTimeout(() => {
  if (NEXO_DIAG.isSplashVisible()) {
    rem.warn('Timeout de seguridad - forzando continuar', 'INIT_TIMEOUT');
    NEXO_DIAG.hideSplash();
    document.body.classList.add('nexo-force-ready');
  }
}, 10000);

document.addEventListener('DOMContentLoaded', async () => {
  try {
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    
    _ensureDOMStructure();
    
    window.NEXO.rem = rem;
    rem.info('REM v2.0 initialized', 'REM_INIT');
    rem.info('Sistema REM activo - Inicializando NEXO...', 'REM_INIT');
    
    const nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: 3000,
      enableGestures: true,
      enableMesh: false, // Deshabilitado temporalmente
      onMessage: (msg) => {
        console.log('📨 Mensaje:', msg);
        _renderMessage(msg);
      },
      onStatusChange: (mode) => {
        console.log('🌐 Modo:', mode);
        rem.info(`Modo: ${mode}`, 'NET_MODE');
      },
      onError: (err) => {
        console.error('App error:', err);
        NEXO_DIAG.error('APP_ERR', err.message);
        rem.error(err.message, 'APP_ERR');
      },
      onVaultStateChange: (isOpen) => _toggleVaultUI(isOpen),
      actionCallbacks: {
        onReact: (id) => rem.success('Reacción añadida', 'REACT_OK'),
        onReply: (id) => _focusInput(`@${id?.substr(0,8)} `),
        onForward: (id) => rem.info('Listo para reenviar', 'FORWARD_READY')
      }
    };
    
    rem.info('🚀 [NEXO] App instance created v2.5-NAP', 'NEXO_INIT');
    
    window.NEXO.app = new NexoApp(nexoConfig);
    
    rem.info('[init] ===== INICIANDO NEXO APP v2.5-NAP (src/) =====', 'INIT_START');
    
    // Init con timeout de 8 segundos
    const initPromise = window.NEXO.app.init();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('INIT_TIMEOUT')), 8000)
    );
    
    try {
      await Promise.race([initPromise, timeoutPromise]);
    } catch (timeoutErr) {
      rem.warn('Init timeout - continuando con funcionalidad limitada', 'INIT_WARN');
    }
    
    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);
    
    _setupMessageInput();
    _setupVaultToggle();
    
    NEXO_DIAG.hideSplash();
    rem.success('NEXO Inicializado correctamente', 'INIT_OK');
    console.log('✅ NEXO Inicializado');
    
  } catch (error) {
    console.error('💥 Error:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('INIT_FATAL', error.message);
    rem.error(`Error fatal: ${error.message}`, 'INIT_FATAL');
    NEXO_DIAG.hideSplash();
  }
});

function _ensureDOMStructure() {
  const stream = document.getElementById('nexo-stream') || document.querySelector('.stream-container');
  const vault = document.getElementById('nexo-vault') || document.querySelector('.vault-panel');
  
  if (stream && !stream.id) stream.id = 'nexo-stream';
  if (vault && !vault.id) vault.id = 'nexo-vault';
}

/**
 * FIX: Input se limpia inmediatamente (optimistic UI)
 * No espera confirmación de envío para borrar el texto
 */
function _setupMessageInput() {
  const input = document.getElementById('message-input');
  const btn = document.getElementById('send-btn');
  if (!input || !btn || !window.NEXO.app) return;
  
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    
    // FIX CRÍTICO: Limpiar input inmediatamente (optimistic UI)
    // El usuario ve feedback instantáneo, no espera a la red
    input.value = '';
    input.focus(); // Mantener foco para seguir escribiendo
    
    try {
      const sent = await window.NEXO.app.sendMessage({ text });
      if (sent) {
        rem.success('Enviado', 'MSG_SENT');
      } else {
        // En modo offline, el mensaje se encola automáticamente
        rem.info('En cola (offline)', 'MSG_QUEUED');
      }
    } catch (e) {
      rem.error('Error al enviar', 'MSG_ERR');
      // Opcional: restaurar texto si es crítico
      // input.value = text; 
    }
  };
  
  btn.addEventListener('click', send);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevenir submit de form
      send();
    }
  });
  
  // Focus inicial en el input
  input.focus();
}

function _setupVaultToggle() {
  const vault = document.getElementById('vault-panel');
  if (vault) vault.classList.add('vault-hidden');
  
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      const vault = document.getElementById('vault-panel');
      if (vault) {
        const isHidden = vault.classList.contains('vault-hidden');
        _toggleVaultUI(!isHidden);
      }
    }
  });
}

function _renderMessage(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `message ${msg._own ? 'own' : 'other'}`;
  div.innerHTML = `<div class="message-content">${msg.content || msg.text}</div><div class="message-meta"><span>${new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>${msg._source ? `<span>[${msg._source}]</span>` : ''}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function _toggleVaultUI(isOpen) {
  const vault = document.getElementById('vault-panel');
  if (vault) {
    vault.classList.toggle('vault-hidden', !isOpen);
    vault.classList.toggle('vault-visible', isOpen);
    rem.info(isOpen ? 'Vault abierto' : 'Vault cerrado', 'VAULT_TOGGLE');
  }
}

function _focusInput(text = '') {
  const input = document.getElementById('message-input');
  if (input) { 
    input.focus(); 
    if (text) input.value = text;
  }
}

if (module.hot) module.hot.accept();
