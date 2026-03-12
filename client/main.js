// client/main.js - FIX DEDUPLICACIÓN v2.4-NAP-CORRECTED
// FIX CRÍTICO: Evita mensajes duplicados usando tracking por ID único

import { NexoApp } from './app/nexo_app.js';
import { OnboardingController } from './auth/onboarding.js';
import { CryptoVault } from './core/crypto_vault.js';

const DIAG = window.NEXO_DIAG || {
  log: (msg) => console.log(`[NEXO] ${msg}`),
  error: (code, msg) => console.error(`[NEXO] ${code}: ${msg}`),
  hideSplash: () => {
    const splash = document.getElementById('splash-native');
    if (splash) {
      setTimeout(() => {
        splash.classList.add('hidden');
        setTimeout(() => splash.remove(), 500);
      }, 2000);
    }
  }
};

async function initNexo() {
  const splash = document.getElementById('splash-native');
  const statusIndicator = document.getElementById('status-indicator');
  const messagesContainer = document.getElementById('messages-container');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');

  DIAG.log('🚀 MAIN.JS v2.4 - Iniciando con deduplicación', 'info');

  // [FIX CRÍTICO 2.4] Tracking de mensajes mostrados para evitar duplicados
  const shownMessageIds = new Set();
  const MESSAGE_ID_MAX_SIZE = 1000;

  try {
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.style.display = 'none';
    if (statusIndicator) statusIndicator.style.display = 'none';

    const hasCompletedOnboarding = localStorage.getItem('nexo_onboarding_done') === 'true';
    const hasExistingIdentity = localStorage.getItem('nexo_identity_exists') === 'true';
    
    if (!hasCompletedOnboarding || !hasExistingIdentity) {
      DIAG.log('👤 PRIMER INICIO - Iniciando Onboarding', 'info');
      
      const onboarding = new OnboardingController({
        container: document.body,
        onComplete: () => {
          localStorage.setItem('nexo_onboarding_done', 'true');
          localStorage.setItem('nexo_identity_exists', 'true');
          window.location.reload();
        },
        onError: (err, phase) => DIAG.error(`ONBOARD-${phase}`, err.message)
      });
      
      await onboarding.start();
      return;
    }

    if (appContainer) appContainer.style.display = 'flex';
    if (statusIndicator) statusIndicator.style.display = 'block';
    
    DIAG.log('🔐 Inicializando CryptoVault...', 'info');
    const vault = new CryptoVault();
    await vault.init();
    const myIdentity = vault.getIdentity() || 'unknown';
    DIAG.log(`✅ Vault OK - ID: ${myIdentity.substring(0, 8)}...`, 'info');
    
    // [FIX 2.4] Helpers para deduplicación
    const generateMessageId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const trimMessageIds = () => {
      if (shownMessageIds.size > MESSAGE_ID_MAX_SIZE) {
        const iterator = shownMessageIds.values();
        for (let i = 0; i < MESSAGE_ID_MAX_SIZE / 2; i++) {
          shownMessageIds.delete(iterator.next().value);
        }
      }
    };
    
    const app = new NexoApp({
      relayUrls: ['wss://echo.websocket.org/'],
      bleTimeout: 10000,
      enableGestures: true,
      enableMesh: true,
      
      onMessage: (msg) => {
        if (!msg || (!msg.text && !msg.data)) return;
        
        // [FIX CRÍTICO 2.4] DEDUPLICACIÓN POR ID
        const msgId = msg._id || msg.id || `${msg.text}-${msg.timestamp}`;
        
        if (shownMessageIds.has(msgId)) {
          DIAG.log(`🔄 Duplicado ignorado: ${msgId.substr(0, 20)}...`, 'info');
          return;
        }
        
        shownMessageIds.add(msgId);
        trimMessageIds();
        
        // Detectar si es mensaje propio
        const isOwn = msg._own === true || msg._sender === myIdentity;
        
        const div = document.createElement('div');
        div.className = `message ${isOwn ? 'own' : 'other'}`;
        div.textContent = msg.text || msg.data;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      },
      
      onStatusChange: (mode) => {
        statusIndicator.className = mode.toLowerCase();
        const labels = {
          P2P: '🟢 P2P', RELAY: '🔵 RELAY', 
          HYBRID: '🟠 HYBRID', OFFLINE: '🔴 OFFLINE'
        };
        statusIndicator.textContent = labels[mode] || mode;
      },
      
      onError: (err, code) => DIAG.error(code || 'APP-ERR', err?.message)
    });

    await app.init();
    window.nexoApp = app;
    
    DIAG.hideSplash();

    // [FIX 2.4] Enviar con ID único
    const sendMessage = () => {
      const text = messageInput?.value?.trim();
      if (!text || !window.nexoApp) return;
      
      const messageId = generateMessageId();
      shownMessageIds.add(messageId); // Pre-registrar para evitar eco
      
      window.nexoApp.sendMessage({
        type: 'chat',
        text: text,
        timestamp: Date.now(),
        _id: messageId, // ID que volverá con el eco
        _sender: myIdentity
      });
      
      messageInput.value = '';
    };

    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    window.addEventListener('beforeunload', () => app?.destroy());

  } catch (err) {
    DIAG.error('INIT-FATAL', err.message);
    if (splash) splash.innerHTML = `...error UI...`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNexo);
} else {
  initNexo();
}
