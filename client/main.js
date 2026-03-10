/**
 * NEXO Main Entry Point v2.0-NAP-CERTIFIED
 * Integra: Splash → Diagnóstico → Onboarding → App
 * Relay: wss://echo.websocket.org/ (testing)
 */

// ============ SISTEMA DE DIAGNÓSTICO GLOBAL ============
window.NEXO_DIAG = {
  logs: [],
  maxLogs: 100,
  
  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { time: timestamp, message, type };
    this.logs.push(entry);
    
    if (this.logs.length > this.maxLogs) this.logs.shift();
    
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    const container = document.getElementById('diag-logs');
    if (container) {
      const div = document.createElement('div');
      div.className = `diag-log ${type}`;
      div.textContent = `[${timestamp}] ${message}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
    
    const splashStatus = document.getElementById('splash-status');
    if (splashStatus && type !== 'error') {
      splashStatus.textContent = message;
    }
  },
  
  setStatus(status) {
    const el = document.getElementById('diag-status');
    if (el) el.textContent = status;
  },
  
  showApp() {
    document.getElementById('diagnostic-screen')?.classList.add('hidden');
    document.getElementById('app-container')?.classList.add('visible');
    this.log('Interfaz principal activada', 'step');
  },
  
  hideSplash() {
    const splash = document.getElementById('splash-native');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 800);
    }
  }
};

// ============ IMPORTS ============
window.NEXO_DIAG.log('📦 Cargando módulos...', 'step');

import { NexoApp } from './app/nexo_app.js';
import { OnboardingController } from './auth/onboarding.js';
import { WebAuthnHelper } from './auth/webauthn_helper.js';
import { CryptoVault } from './core/crypto_vault.js';

window.NEXO_DIAG.log('✅ Módulos importados', 'step');

// ============ FUNCIONES AUXILIARES ============

async function checkNeedsOnboarding() {
  try {
    window.NEXO_DIAG.log('🔍 Verificando identidad existente...', 'step');
    const vault = new CryptoVault();
    await vault.init();
    const identity = vault.getIdentity();
    const needsOnboard = !identity;
    window.NEXO_DIAG.log(needsOnboard ? '👤 Nueva identidad detectada' : '✅ Identidad existente', needsOnboard ? 'info' : 'step');
    return needsOnboard;
  } catch (err) {
    window.NEXO_DIAG.log(`⚠️  Error verificando identidad: ${err.message}`, 'warn');
    return true;
  }
}

function hideSplash() {
  setTimeout(() => {
    window.NEXO_DIAG.hideSplash();
  }, 1500);
}

// ============ MAIN ============
(async () => {
  try {
    window.NEXO_DIAG.setStatus('Inicializando...');
    
    const elements = {
      diagnosticScreen: document.getElementById('diagnostic-screen'),
      appContainer: document.getElementById('app-container'),
      statusIndicator: document.getElementById('status-indicator'),
      messagesContainer: document.getElementById('messages-container'),
      messageInput: document.getElementById('message-input'),
      sendBtn: document.getElementById('send-btn')
    };

    const missing = Object.entries(elements)
      .filter(([name, el]) => !el)
      .map(([name]) => name);
    
    if (missing.length > 0) {
      window.NEXO_DIAG.log(`⚠️  Elementos faltantes: ${missing.join(', ')}`, 'warn');
    } else {
      window.NEXO_DIAG.log('✅ DOM listo', 'step');
    }

    const needsOnboarding = await checkNeedsOnboarding();
    
    if (needsOnboarding) {
      window.NEXO_DIAG.log('🎨 Iniciando onboarding...', 'step');
      window.NEXO_DIAG.setStatus('Onboarding...');
      
      hideSplash();
      
      const onboarding = new OnboardingController({
        container: elements.appContainer || document.body,
        vault: null,
        onComplete: () => {
          window.NEXO_DIAG.log('✅ Onboarding completado - Recargando...', 'step');
          setTimeout(() => window.location.reload(), 1000);
        },
        onError: (err) => {
          window.NEXO_DIAG.log(`❌ Onboarding error: ${err.message}`, 'error');
        }
      });
      
      await onboarding.start();
      return;
      
    } else {
      hideSplash();
    }

    window.NEXO_DIAG.log('🏗️  Creando NexoApp...', 'step');
    
    const app = new NexoApp({
      relayUrls: [
        'wss://echo.websocket.org/',
        'wss://relay.nexo.app/ws'
      ],
      bleTimeout: 10000,
      enableGestures: true,
      enableMesh: true,
      
      onMessage: (msg) => {
        window.NEXO_DIAG.log(`📨 ${msg._source?.toUpperCase() || 'MSG'}: ${msg.text?.substring(0, 30)}...`, 'info');
        
        if (!elements.messagesContainer) return;
        
        const div = document.createElement('div');
        div.className = `message ${msg.own ? 'own' : 'other'}`;
        div.textContent = msg.text || msg.data || JSON.stringify(msg);
        elements.messagesContainer.appendChild(div);
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
      },
      
      onStatusChange: (mode) => {
        window.NEXO_DIAG.log(`🔄 Modo: ${mode}`, 'info');
        
        if (!elements.statusIndicator) return;
        
        elements.statusIndicator.className = mode.toLowerCase();
        const labels = {
          P2P: '🟢 P2P',
          RELAY: '🔵 RELAY',
          HYBRID: '🟠 HYBRID',
          OFFLINE: '🔴 OFFLINE'
        };
        elements.statusIndicator.textContent = labels[mode] || mode;
        
        if (mode === 'OFFLINE') {
          window.NEXO_DIAG.log('⚠️  SIN CONEXIÓN - Revisa relay o BLE', 'warn');
        }
      },
      
      onError: (err) => {
        window.NEXO_DIAG.log(`❌ Error: ${err.message || err}`, 'error');
        console.error('NEXO Error:', err);
      }
    });

    window.NEXO_DIAG.log('⏳ Iniciando conexiones (timeout 15s)...', 'step');
    window.NEXO_DIAG.setStatus('Conectando...');
    
    const initTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout de inicialización (>15s)')), 15000)
    );
    
    await Promise.race([app.init(), initTimeout]);
    
    window.NEXO_DIAG.log('✅ NEXO Listo', 'step');
    window.NEXO_DIAG.setStatus('Conectado');
    
    window.nexoApp = app;
    
    if (elements.sendBtn && elements.messageInput) {
      const sendMessage = () => {
        const text = elements.messageInput.value.trim();
        if (!text) return;
        
        try {
          app.sendMessage({
            type: 'chat',
            text: text,
            timestamp: Date.now()
          });
          elements.messageInput.value = '';
        } catch (err) {
          window.NEXO_DIAG.log(`❌ Error enviando: ${err.message}`, 'error');
        }
      };
      
      elements.sendBtn.addEventListener('click', sendMessage);
      elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });
    }
    
    setTimeout(() => {
      window.NEXO_DIAG.showApp();
    }, 2000);
    
    window.addEventListener('beforeunload', () => {
      app.destroy();
    });
    
  } catch (err) {
    window.NEXO_DIAG.log(`💥 FATAL: ${err.message}`, 'error');
    window.NEXO_DIAG.log(`📍 ${err.stack?.substring(0, 200)}`, 'error');
    window.NEXO_DIAG.setStatus('Error fatal');
    console.error('Fatal:', err);
  }
})();
