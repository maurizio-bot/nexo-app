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

document.addEventListener('DOMContentLoaded', async () => {
  try {
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    
    _ensureDOMStructure();
    
    window.NEXO.rem = rem;
    rem.info('Sistema REM activo - Inicializando NEXO...', 'REM_INIT');
    
    const nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: 5000,
      enableGestures: true,
      enableMesh: true,
      onMessage: (msg) => {
        console.log('📨 Mensaje:', msg);
        _renderMessage(msg);
      },
      onStatusChange: (mode) => console.log('🌐 Modo:', mode),
      onError: (err) => NEXO_DIAG.error('APP_ERR', err.message),
      onVaultStateChange: (isOpen) => _toggleVaultUI(isOpen),
      actionCallbacks: {
        onReact: (id) => rem.success('Reacción añadida', 'REACT_OK'),
        onReply: (id) => _focusInput(`@${id?.substr(0,8)} `),
        onForward: (id) => rem.info('Listo para reenviar', 'FORWARD_READY')
      }
    };
    
    window.NEXO.app = new NexoApp(nexoConfig);
    await window.NEXO.app.init();
    window.NEXO.initialized = true;
    
    _setupMessageInput();
    _setupVaultToggle();
    
    NEXO_DIAG.hideSplash();
    console.log('✅ NEXO Inicializado');
    
  } catch (error) {
    console.error('💥 Error:', error);
    NEXO_DIAG.error('INIT_FATAL', error.message);
    NEXO_DIAG.showFatal('INIT_FATAL', error.message);
  }
});

function _ensureDOMStructure() {
  const stream = document.getElementById('nexo-stream') || document.querySelector('.stream-container');
  const vault = document.getElementById('nexo-vault') || document.querySelector('.vault-panel');
  
  if (stream && !stream.id) stream.id = 'nexo-stream';
  if (vault && !vault.id) vault.id = 'nexo-vault';
}

function _setupMessageInput() {
  const input = document.getElementById('message-input');
  const btn = document.getElementById('send-btn');
  if (!input || !btn || !window.NEXO.app) return;
  
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    const sent = await window.NEXO.app.sendMessage({ text });
    if (sent) {
      input.value = '';
      rem.success('Mensaje enviado', 'MSG_SENT');
    }
  };
  
  btn.addEventListener('click', send);
  input.addEventListener('keypress', (e) => e.key === 'Enter' && send());
}

function _setupVaultToggle() {
  const vault = document.getElementById('vault-panel');
  if (vault) vault.classList.add('vault-hidden');
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
  }
}

function _focusInput(text = '') {
  const input = document.getElementById('message-input');
  if (input) { input.focus(); input.value = text; }
}

if (module.hot) module.hot.accept();
