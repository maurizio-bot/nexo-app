// client/main.js - v2.5-NAP-FINAL
// FIX: Integración con TheStream + deduplicación robusta

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
  DIAG.log('🚀 MAIN.JS v2.5 - Integración TheStream', 'info');

  try {
    // Verificar onboarding
    const hasCompletedOnboarding = localStorage.getItem('nexo_onboarding_done') === 'true';
    const hasExistingIdentity = localStorage.getItem('nexo_identity_exists') === 'true';
    
    if (!hasCompletedOnboarding || !hasExistingIdentity) {
      DIAG.log('👤 PRIMER INICIO - Onboarding', 'info');
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

    // Mostrar app
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.style.display = 'flex';
    
    const statusIndicator = document.getElementById('status-indicator');
    if (statusIndicator) statusIndicator.style.display = 'block';

    // Inicializar Vault
    DIAG.log('🔐 Inicializando CryptoVault...');
    const vault = new CryptoVault();
    await vault.init();
    const myIdentity = vault.getIdentity() || 'unknown';
    DIAG.log(`✅ Vault OK - ID: ${myIdentity.substring(0, 8)}...`);

    // [FIX DEDUPLICACIÓN] Sets para tracking
    const localMessageIds = new Set();  // IDs de mensajes enviados por mí
    const renderedIds = new Set();      // IDs ya renderizados en UI
    const MESSAGE_MAX_CACHE = 500;

    const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const trimCache = (set) => {
      if (set.size > MESSAGE_MAX_CACHE) {
        const iter = set.values();
        for (let i = 0; i < MESSAGE_MAX_CACHE / 2; i++) {
          set.delete(iter.next().value);
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
        
        const msgId = msg._id || msg.id;
        const isOwn = msg._own === true || msg._sender === myIdentity;
        
        // [FIX] Si es eco de mensaje propio, verificar si ya lo mostramos
        if (isOwn && msgId && localMessageIds.has(msgId)) {
          DIAG.log(`🔄 Eco confirmado: ${msgId.substr(0, 20)}...`);
          // Actualizar UI para marcar como "enviado" (check verde)
          updateMessageStatus(msgId, 'sent');
          return;
        }
        
        // [FIX] Verificar duplicado general
        if (msgId && renderedIds.has(msgId)) {
          DIAG.log(`🔄 Duplicado ignorado: ${msgId.substr(0, 20)}...`);
          return;
        }
        
        if (msgId) {
          renderedIds.add(msgId);
          trimCache(renderedIds);
        }
        
        // [FIX] Formato para TheStream
        const streamItem = {
          id: msgId || generateId(),
          type: 'message',
          content: msg.text || msg.data,
          author: {
            name: isOwn ? 'Tú' : (msg._sender?.substring(0, 8) || 'Desconocido'),
            avatar: isOwn ? '/avatar-me.png' : '/avatar-other.png'
          },
          timestamp: msg.timestamp || Date.now(),
          _isOwn: isOwn,
          pulseScore: isOwn ? 1.0 : 0.5
        };
        
        // [FIX] Usar TheStream si está disponible, sino fallback manual
        if (window.nexoApp?.stream) {
          window.nexoApp.stream.appendItems([streamItem]);
        } else {
          addManualMessage(streamItem, isOwn);
        }
      },
      
      onStatusChange: (mode) => {
        const indicator = document.getElementById('status-indicator');
        if (indicator) {
          indicator.className = mode.toLowerCase();
          const labels = {
            P2P: '🟢 P2P', RELAY: '🔵 RELAY', 
            HYBRID: '🟠 HYBRID', OFFLINE: '🔴 OFFLINE'
          };
          indicator.textContent = labels[mode] || mode;
        }
      },
      
      onError: (err, code) => DIAG.error(code || 'APP-ERR', err?.message)
    });

    await app.init();
    window.nexoApp = app;
    window.nexoVault = vault;
    
    DIAG.hideSplash();

    // Setup input
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    
    const sendMessage = () => {
      const text = messageInput?.value?.trim();
      if (!text || !window.nexoApp) return;
      
      const msgId = generateId();
      const timestamp = Date.now();
      
      // Registrar ID local para detectar eco
      localMessageIds.add(msgId);
      trimCache(localMessageIds);
      
      // [FIX] Agregar a UI inmediatamente (optimistic) vía TheStream
      const optimisticItem = {
        id: msgId,
        type: 'message',
        content: text,
        author: { name: 'Tú', avatar: '/avatar-me.png' },
        timestamp: timestamp,
        _isOwn: true,
        _status: 'sending', // Pendiente de confirmación
        pulseScore: 1.0
      };
      
      if (window.nexoApp?.stream) {
        window.nexoApp.stream.appendItems([optimisticItem]);
      } else {
        addManualMessage(optimisticItem, true, 'sending');
      }
      
      // Enviar por red
      window.nexoApp.sendMessage({
        type: 'chat',
        text: text,
        timestamp: timestamp,
        _id: msgId,
        _sender: myIdentity,
        _own: true
      });
      
      messageInput.value = '';
    };

    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    // Helper para fallback manual
    function addManualMessage(item, isOwn, status = 'sent') {
      const container = document.getElementById('messages-container');
      if (!container) return;
      
      // Check duplicado
      if (container.querySelector(`[data-id="${item.id}"]`)) return;
      
      const div = document.createElement('div');
      div.className = `message ${isOwn ? 'own' : 'other'}`;
      div.dataset.id = item.id;
      div.textContent = item.content;
      
      if (status === 'sending') {
        div.style.opacity = '0.7';
      }
      
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
    
    function updateMessageStatus(id, status) {
      // Implementar lógica de check verde aquí si se desea
    }

    window.addEventListener('beforeunload', () => app?.destroy());

  } catch (err) {
    DIAG.error('INIT-FATAL', err.message);
    const fatal = document.getElementById('fatal-error');
    const fatalCode = document.getElementById('fatal-code');
    if (fatal && fatalCode) {
      fatalCode.textContent = `INIT-FATAL: ${err.message}`;
      fatal.classList.add('visible');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNexo);
} else {
  initNexo();
}
