/**
 * NEXO Entry Point v2.2-NAP-CERTIFIED
 * FIX: Integración completa con sistema de diagnóstico visual WS-XXX
 */

import { NexoApp } from './app/nexo_app.js';
import { OnboardingController } from './auth/onboarding.js';
import { WebAuthnHelper } from './auth/webauthn_helper.js';
import { CryptoVault } from './core/crypto_vault.js';

(function() {
  // Usar el sistema de diagnóstico nativo del HTML (NO redefinir)
  const DIAG = window.NEXO_DIAG || {
    log: (msg) => console.log(`[NEXO-FALLBACK] ${msg}`),
    error: (code, msg) => console.error(`[NEXO-FALLBACK] ${code}: ${msg}`),
    hideSplash: () => {
      const splash = document.getElementById('splash-native');
      if (splash) splash.classList.add('hidden');
    },
    showFatal: (code, msg) => {
      const fatal = document.getElementById('fatal-error');
      const fatalCode = document.getElementById('fatal-code');
      if (fatal && fatalCode) {
        fatalCode.textContent = `${code}: ${msg}`;
        fatal.classList.add('visible');
      }
    }
  };

  async function initNexo() {
    const loadingScreen = document.getElementById('splash-native');
    const statusIndicator = document.getElementById('status-indicator');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    // CHECKPOINT 0: Inicio
    DIAG.log('🚀 MAIN.JS v2.2 - Inicio de inicialización', 'info');

    try {
      // CHECKPOINT 1: DOM validado
      if (!messagesContainer || !messageInput || !sendBtn) {
        throw new Error('DOM Elements faltantes (HTML-001)');
      }
      DIAG.log('✅ CHECKPOINT 1: DOM Elements cargados', 'info');

      // CHECKPOINT 2: CryptoVault (FASE 🔐)
      DIAG.log('🔐 CHECKPOINT 2: Inicializando CryptoVault...', 'info');
      const vault = new CryptoVault();
      let needsOnboarding = false;
      
      try {
        await vault.init();
        DIAG.log('✅ Vault inicializado - Identidad lista', 'info');
      } catch (e) {
        // Si es "Vault not initialized" o similar, es primera vez
        if (e.message.includes('initialized') || e.message.includes('identity')) {
          DIAG.log('👤 Vault vacío - Primera vez detectada', 'info');
          needsOnboarding = true;
        } else {
          throw e; // Error real de crypto
        }
      }

      // CHECKPOINT 3: Onboarding (si aplica)
      if (needsOnboarding || !vault.getIdentity()) {
        DIAG.log('📱 CHECKPOINT 3: Iniciando OnboardingController...', 'info');
        
        const onboarding = new OnboardingController({
          container: document.body,
          vault: vault,
          onComplete: () => {
            DIAG.log('🎉 Onboarding completado - Recargando...', 'info');
            window.location.reload();
          },
          onError: (err, phase) => {
            DIAG.error(`ONBOARD-${phase || 'UNKNOWN'}`, err.message);
          }
        });
        
        await onboarding.start();
        return; // Stop aquí hasta recarga
      }

      // CHECKPOINT 4: NexoApp (FASES 🌐📡🌉👆📰)
      DIAG.log('⚡ CHECKPOINT 4: Instanciando NexoApp...', 'info');
      
      const app = new NexoApp({
        relayUrls: ['wss://echo.websocket.org/'],
        bleTimeout: 10000,
        enableGestures: true,
        enableMesh: true,
        
        onMessage: (msg) => {
          const preview = msg.text?.substring(0, 30) || 'datos binarios';
          DIAG.log(`📨 [${msg._source}] ${preview}...`, 'info');
          
          const div = document.createElement('div');
          div.className = `message ${msg._own ? 'own' : 'other'}`;
          div.textContent = msg.text || msg.data || '[Mensaje vacío]';
          messagesContainer.appendChild(div);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        },
        
        onStatusChange: (mode) => {
          DIAG.log(`🌐 Modo de red cambiado a: ${mode}`, 'info');
          
          statusIndicator.className = mode.toLowerCase();
          const labels = {
            P2P: '🟢 P2P',
            RELAY: '🔵 RELAY', 
            HYBRID: '🟠 HYBRID',
            OFFLINE: '🔴 OFFLINE'
          };
          statusIndicator.textContent = labels[mode] || `● ${mode}`;
        },
        
        // INTEGRACIÓN CLAVE: Recibir códigos WS-XXX, BLE-XXX, etc.
        onError: (err, code, details) => {
          const errorCode = code || 'APP-UNKNOWN';
          const errorMsg = err?.message || String(err);
          
          // Log al sistema visual con código
          DIAG.error(errorCode, `${errorMsg}${details ? ` (${details})` : ''}`);
          
          // Toast flotante con el código prominente
          const toast = document.createElement('div');
          toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: #ff4444;
            color: white;
            padding: 12px 20px;
            border-radius: 20px;
            font-family: monospace;
            font-size: 13px;
            z-index: 99999;
            box-shadow: 0 4px 20px rgba(255,68,68,0.4);
            text-align: center;
            max-width: 90%;
          `;
          toast.innerHTML = `
            <div style="font-size: 10px; opacity: 0.8; margin-bottom: 4px;">ERROR ${errorCode}</div>
            <div>${errorMsg.substring(0, 40)}${errorMsg.length > 40 ? '...' : ''}</div>
          `;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 4000);
        }
      });

      DIAG.log('⚡ CHECKPOINT 5: Llamando app.init()...', 'info');
      await app.init();
      window.nexoApp = app;
      
      // CHECKPOINT 6: Éxito total
      DIAG.log('🎉 CHECKPOINT 6: INICIALIZACIÓN COMPLETADA', 'info');
      DIAG.log(`📊 Modo final: ${app.bridge?.getMode?.() || 'UNKNOWN'}`, 'info');
      
      // Ocultar splash nativo
      DIAG.hideSplash();

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
      // Error fatal capturado
      const errorCode = err.message?.includes('DOM') ? 'HTML-001' : 
                        err.message?.includes('Vault') ? 'CRYPTO-001' : 
                        'INIT-FATAL';
      
      DIAG.error(errorCode, err.message);
      DIAG.showFatal(errorCode, err.message);
      
      console.error('Fatal error:', err);
    }
  }

  // Iniciar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNexo);
  } else {
    initNexo();
  }
})();
