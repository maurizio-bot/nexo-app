// client/main.js - COMPLETO Y CORREGIDO v2.3-NAP-CERTIFIED
// FIXES: Onboarding forzado en primer inicio, filtro mensajes vacíos, delay splash

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

  DIAG.log('🚀 MAIN.JS v2.3 - Iniciando', 'info');

  try {
    // CORRECCIÓN: Ocultar UI principal hasta determinar flujo
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.style.display = 'none';
    if (statusIndicator) statusIndicator.style.display = 'none';

    // CORRECCIÓN: Detección robusta de primer inicio
    const hasCompletedOnboarding = localStorage.getItem('nexo_onboarding_done') === 'true';
    const hasExistingIdentity = localStorage.getItem('nexo_identity_exists') === 'true';
    
    // Si NO ha completado onboarding O NO hay identidad guardada
    if (!hasCompletedOnboarding || !hasExistingIdentity) {
      DIAG.log('👤 PRIMER INICIO DETECTADO - Iniciando Onboarding', 'info');
      
      const onboarding = new OnboardingController({
        container: document.body,
        onComplete: () => {
          localStorage.setItem('nexo_onboarding_done', 'true');
          localStorage.setItem('nexo_identity_exists', 'true');
          DIAG.log('✅ Onboarding completado - Recargando', 'info');
          window.location.reload();
        },
        onError: (err, phase) => {
          DIAG.error(`ONBOARD-${phase || 'UNKNOWN'}`, err.message);
        }
      });
      
      await onboarding.start();
      return; // Detener aquí, esperar recarga
    }

    // Usuario existente - mostrar UI normal
    DIAG.log('👤 Usuario existente - Cargando app normal', 'info');
    if (appContainer) appContainer.style.display = 'flex';
    if (statusIndicator) statusIndicator.style.display = 'block';
    
    // Inicializar Vault
    DIAG.log('🔐 Inicializando CryptoVault...', 'info');
    const vault = new CryptoVault();
    await vault.init();
    DIAG.log(`✅ Vault OK - ID: ${vault.getIdentity()?.substring(0, 8)}...`, 'info');
    
    // Inicializar NexoApp
    DIAG.log('🌐 Inicializando NexoApp...', 'info');
    const app = new NexoApp({
      relayUrls: ['wss://echo.websocket.org/'],
      bleTimeout: 10000,
      enableGestures: true,
      enableMesh: true,
      
      onMessage: (msg) => {
        // CORRECCIÓN: Filtrar mensajes vacíos y ecos del servidor
        if (!msg || (!msg.text && !msg.data)) {
          DIAG.log('⚠️ Mensaje vacío ignorado', 'warn');
          return;
        }
        
        // Evitar mostrar ecos del relay como mensajes entrantes
        if (msg._own && msg._source === 'relay') return;
        
        const div = document.createElement('div');
        div.className = `message ${msg._own ? 'own' : 'other'}`;
        div.textContent = msg.text || msg.data;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      },
      
      onStatusChange: (mode) => {
        DIAG.log(`🌐 Modo red: ${mode}`, 'info');
        statusIndicator.className = mode.toLowerCase();
        const labels = {
          P2P: '🟢 P2P',
          RELAY: '🔵 RELAY',
          HYBRID: '🟠 HYBRID',
          OFFLINE: '🔴 OFFLINE'
        };
        statusIndicator.textContent = labels[mode] || `● ${mode}`;
      },
      
      onError: (err, code, details) => {
        DIAG.error(code || 'APP-ERR', err?.message || 'Error desconocido');
      }
    });

    await app.init();
    window.nexoApp = app;
    
    DIAG.log('🎉 INICIALIZACIÓN COMPLETADA', 'info');
    DIAG.log(`📊 Estado: Vault=OK | Bridge=${app.bridge?.getMode?.() || 'UNKNOWN'}`, 'info');
    
    // Ocultar splash con delay
    DIAG.hideSplash();

    // UI Events
    const sendMessage = () => {
      const text = messageInput?.value?.trim();
      if (!text || !window.nexoApp) return;
      
      window.nexoApp.sendMessage({
        type: 'chat',
        text: text,
        timestamp: Date.now()
      });
      
      if (messageInput) messageInput.value = '';
    };

    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    window.addEventListener('beforeunload', () => {
      app?.destroy();
    });

  } catch (err) {
    DIAG.error('INIT-FATAL', err.message);
    console.error(err);
    
    if (splash) {
      splash.innerHTML = `
        <div style="color:#ff4444;padding:40px;text-align:center;">
          <h3>❌ Error al iniciar</h3>
          <p style="font-family:monospace;font-size:14px;margin:20px 0;">${err.message}</p>
          <button onclick="localStorage.clear(); location.reload()" style="
            margin:10px;padding:12px 24px;background:#ff4444;border:none;border-radius:20px;
            color:white;font-weight:bold;cursor:pointer;display:block;width:100%;max-width:300px;
          ">Borrar datos y reintentar</button>
          <button onclick="location.reload()" style="
            margin:10px;padding:12px 24px;background:#00ff88;border:none;border-radius:20px;
            color:#0a0a0a;font-weight:bold;cursor:pointer;display:block;width:100%;max-width:300px;
          ">Solo reintentar</button>
        </div>
      `;
    }
  }
}

// Iniciar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNexo);
} else {
  initNexo();
}
