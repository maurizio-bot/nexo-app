/**
 * NEXO Entry Point v2.1-NAP-CORRECTED
 * FIX: Imports estáticos para evitar top-level await error en ES2020
 */

import { NexoApp } from './app/nexo_app.js';
import { OnboardingController } from './auth/onboarding.js';
import { WebAuthnHelper } from './auth/webauthn_helper.js';
import { CryptoVault } from './core/crypto_vault.js';

(function() {
  // Debug logger seguro
  const DIAG = {
    log: (msg, type = 'info') => {
      console.log(`[NEXO] ${msg}`);
      const diagDiv = document.getElementById('nexo-diagnostics');
      if (diagDiv) {
        const line = document.createElement('div');
        line.textContent = `${new Date().toLocaleTimeString()}: ${msg}`;
        line.style.cssText = type === 'error' ? 'color: #ff4444;' : 'color: #00ff88;';
        diagDiv.appendChild(line);
      }
    },
    error: (msg) => DIAG.log(msg, 'error')
  };

  window.NEXO_DIAG = DIAG;

  async function initNexo() {
    const loadingScreen = document.getElementById('loading-screen');
    const statusIndicator = document.getElementById('status-indicator');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    DIAG.log('🚀 Iniciando NEXO v9.0...', 'step');

    try {
      // 🔐 FASE 1: CryptoVault (identidad)
      DIAG.log('🔐 Inicializando CryptoVault...', 'step');
      const vault = new CryptoVault();
      let needsOnboarding = false;
      
      try {
        await vault.init();
        DIAG.log('✅ CryptoVault OK', 'ok');
      } catch (e) {
        DIAG.log(`⚠️ Vault vacío: ${e.message}`, 'warn');
        needsOnboarding = true;
      }

      // Si es primera vez, mostrar onboarding
      if (needsOnboarding || !vault.getIdentity()) {
        DIAG.log('👤 Primera vez - Mostrando onboarding...', 'step');
        const onboarding = new OnboardingController({
          container: document.body,
          vault: vault,
          onComplete: () => {
            DIAG.log('🎉 Onboarding completado - Recargando...', 'ok');
            window.location.reload();
          }
        });
        await onboarding.start();
        return; // No continuar hasta que complete
      }

      // 🌐 FASE 2-6: App normal
      DIAG.log('🌐 Inicializando NexoApp...', 'step');
      const app = new NexoApp({
        relayUrls: ['wss://echo.websocket.org/'],
        bleTimeout: 10000,
        enableGestures: true,
        enableMesh: true,
        
        onMessage: (msg) => {
          DIAG.log(`📨 Mensaje de ${msg._source}: ${msg.text?.substring(0, 20)}...`, 'msg');
          const div = document.createElement('div');
          div.className = `message ${msg._own ? 'own' : 'other'}`;
          div.textContent = msg.text || msg.data;
          messagesContainer.appendChild(div);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        },
        
        onStatusChange: (mode) => {
          DIAG.log(`🌐 Modo cambiado a: ${mode}`, 'net');
          statusIndicator.className = mode.toLowerCase();
          const labels = {
            P2P: '🟢 P2P',
            RELAY: '🔵 RELAY',
            HYBRID: '🟠 HYBRID',
            OFFLINE: '🔴 OFFLINE'
          };
          statusIndicator.textContent = labels[mode] || mode;
        },
        
        onError: (err) => {
          DIAG.error(`❌ Error: ${err.message}`);
          // Toast notification
          const toast = document.createElement('div');
          toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: #ff4444;
            color: white;
            padding: 12px 24px;
            border-radius: 24px;
            font-size: 14px;
            z-index: 9999;
            animation: slideIn 0.3s ease;
          `;
          toast.textContent = err.message || 'Error de conexión';
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);
        }
      });

      await app.init();
      window.nexoApp = app;
      
      if (loadingScreen) {
        loadingScreen.classList.add('hidden');
      }
      
      DIAG.log('🎉 INICIALIZACIÓN COMPLETADA', 'ok');

      // UI Events
      const sendMessage = () => {
        const text = messageInput.value.trim();
        if (!text) return;
        
        app.sendMessage({
          type: 'chat',
          text: text,
          timestamp: Date.now()
        });
        
        messageInput.value = '';
      };

      sendBtn.addEventListener('click', sendMessage);
      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });

      window.addEventListener('beforeunload', () => {
        app.destroy();
      });

    } catch (err) {
      DIAG.error(`💥 FATAL: ${err.message}`);
      console.error('Fatal error:', err);
      if (loadingScreen) {
        loadingScreen.innerHTML = `<p style="color: #ff4444; padding: 20px;">Error al iniciar: ${err.message}</p>`;
      }
    }
  }

  // Iniciar cuando DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNexo);
  } else {
    initNexo();
  }
})();
