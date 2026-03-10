/**
 * NEXO Main Entry Point v2.1-DEBUG
 * Máximo diagnóstico para detectar dónde falla
 */

console.log('[NEXO] main.js iniciando...');

// Sistema de diagnóstico de emergencia (por si falla el normal)
if (!window.NEXO_DIAG) {
  window.NEXO_DIAG = {
    log: (msg, type = 'info') => {
      console.log(`[${type}] ${msg}`);
      // Intentar mostrar en pantalla si existe el contenedor
      const container = document.getElementById('diag-logs');
      if (container) {
        const div = document.createElement('div');
        div.style.cssText = 'color: #aaa; margin: 2px 0; font-family: monospace; font-size: 11px;';
        div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        container.appendChild(div);
      }
    },
    setStatus: (s) => {
      const el = document.getElementById('diag-status');
      if (el) el.textContent = s;
    },
    showApp: () => {
      document.getElementById('diagnostic-screen')?.classList.add('hidden');
      document.getElementById('app-container')?.classList.add('visible');
    },
    hideSplash: () => {
      const splash = document.getElementById('splash-native');
      if (splash) splash.style.display = 'none';
    }
  };
}

window.NEXO_DIAG.log('📦 main.js cargado', 'step');

// ============ IMPORTS INDIVIDUALES CON MANEJO DE ERRORES ============
let NexoApp = null;
let OnboardingController = null;
let WebAuthnHelper = null;
let CryptoVault = null;

// Import 1: NexoApp (CRÍTICO - sin esto no funciona)
try {
  window.NEXO_DIAG.log('🔍 Importando NexoApp...', 'step');
  const nexoModule = await import('./app/nexo_app.js');
  NexoApp = nexoModule.NexoApp;
  if (!NexoApp) throw new Error('NexoApp no exportado');
  window.NEXO_DIAG.log('✅ NexoApp OK', 'step');
} catch (err) {
  window.NEXO_DIAG.log(`💥 ERROR NexoApp: ${err.message}`, 'error');
  window.NEXO_DIAG.log(`📍 ¿Existe app/nexo_app.js?`, 'error');
  throw new Error('No se pudo cargar NexoApp - abortando');
}

// Import 2: Onboarding (OPCIONAL - app puede funcionar sin esto inicialmente)
try {
  window.NEXO_DIAG.log('🔍 Importando Onboarding...', 'step');
  const onboardingModule = await import('./auth/onboarding.js');
  OnboardingController = onboardingModule.OnboardingController;
  window.NEXO_DIAG.log('✅ Onboarding OK', 'step');
} catch (err) {
  window.NEXO_DIAG.log(`⚠️ Onboarding falló: ${err.message}`, 'warn');
  window.NEXO_DIAG.log(`   ¿Existe auth/onboarding.js?`, 'warn');
}

// Import 3: WebAuthnHelper (OPCIONAL)
try {
  window.NEXO_DIAG.log('🔍 Importando WebAuthnHelper...', 'step');
  const webauthnModule = await import('./auth/webauthn_helper.js');
  WebAuthnHelper = webauthnModule.WebAuthnHelper;
  window.NEXO_DIAG.log('✅ WebAuthnHelper OK', 'step');
} catch (err) {
  window.NEXO_DIAG.log(`⚠️ WebAuthnHelper falló: ${err.message}`, 'warn');
}

// Import 4: CryptoVault (CRÍTICO)
try {
  window.NEXO_DIAG.log('🔍 Importando CryptoVault...', 'step');
  const vaultModule = await import('./core/crypto_vault.js');
  CryptoVault = vaultModule.CryptoVault;
  if (!CryptoVault) throw new Error('CryptoVault no exportado');
  window.NEXO_DIAG.log('✅ CryptoVault OK', 'step');
} catch (err) {
  window.NEXO_DIAG.log(`💥 ERROR CryptoVault: ${err.message}`, 'error');
  window.NEXO_DIAG.log(`📍 ¿Existe core/crypto_vault.js?`, 'error');
  throw new Error('No se pudo cargar CryptoVault - abortando');
}

window.NEXO_DIAG.log('✅ Todos los imports completados', 'step');

// ============ FUNCIÓN PRINCIPAL ============
async function initNexo() {
  try {
    window.NEXO_DIAG.setStatus('Iniciando...');
    
    // Verificar DOM
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
      window.NEXO_DIAG.log(`⚠️  DOM faltante: ${missing.join(', ')}`, 'warn');
    } else {
      window.NEXO_DIAG.log('✅ DOM listo', 'step');
    }

    // Verificar identidad (solo si tenemos CryptoVault)
    let needsOnboarding = false;
    if (CryptoVault) {
      try {
        window.NEXO_DIAG.log('🔍 Verificando identidad...', 'step');
        const vault = new CryptoVault();
        await vault.init();
        const identity = vault.getIdentity();
        needsOnboarding = !identity;
        window.NEXO_DIAG.log(needsOnboarding ? '👤 Primera vez' : '✅ Ya tiene cuenta', needsOnboarding ? 'info' : 'step');
      } catch (err) {
        window.NEXO_DIAG.log(`⚠️  Vault error: ${err.message}`, 'warn');
        needsOnboarding = true;
      }
    }

    // Onboarding si es necesario
    if (needsOnboarding && OnboardingController) {
      window.NEXO_DIAG.log('🎨 Mostrando onboarding...', 'step');
      hideSplash();
      
      const onboarding = new OnboardingController({
        container: elements.appContainer || document.body,
        onComplete: () => {
          window.NEXO_DIAG.log('✅ Onboarding OK - Recargando...', 'step');
          setTimeout(() => window.location.reload(), 1000);
        },
        onError: (err) => {
          window.NEXO_DIAG.log(`❌ Onboarding error: ${err.message}`, 'error');
        }
      });
      
      await onboarding.start();
      return;
    } else if (needsOnboarding) {
      window.NEXO_DIAG.log('⚠️  Sin onboarding, saltando...', 'warn');
      hideSplash();
    } else {
      hideSplash();
    }

    // Iniciar NexoApp
    window.NEXO_DIAG.log('🏗️  Creando NexoApp...', 'step');
    
    const app = new NexoApp({
      relayUrls: ['wss://echo.websocket.org/'],
      bleTimeout: 10000,
      enableGestures: true,
      enableMesh: true,
      
      onMessage: (msg) => {
        if (!elements.messagesContainer) return;
        const div = document.createElement('div');
        div.className = `message ${msg.own ? 'own' : 'other'}`;
        div.textContent = msg.text || msg.data || JSON.stringify(msg);
        elements.messagesContainer.appendChild(div);
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
      },
      
      onStatusChange: (mode) => {
        if (!elements.statusIndicator) return;
        elements.statusIndicator.className = mode.toLowerCase();
        const labels = { P2P: '🟢 P2P', RELAY: '🔵 RELAY', HYBRID: '🟠 HYBRID', OFFLINE: '🔴 OFFLINE' };
        elements.statusIndicator.textContent = labels[mode] || mode;
      },
      
      onError: (err) => {
        window.NEXO_DIAG.log(`❌ Error: ${err.message}`, 'error');
      }
    });

    window.NEXO_DIAG.log('⏳ Conectando (timeout 15s)...', 'step');
    
    const initTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 15000)
    );
    
    await Promise.race([app.init(), initTimeout]);
    
    window.NEXO_DIAG.log('✅ NEXO Listo', 'step');
    window.NEXO_DIAG.setStatus('Conectado');
    window.nexoApp = app;

    // UI
    if (elements.sendBtn && elements.messageInput) {
      const sendMessage = () => {
        const text = elements.messageInput.value.trim();
        if (!text) return;
        try {
          app.sendMessage({ type: 'chat', text: text, timestamp: Date.now() });
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
    
    setTimeout(() => window.NEXO_DIAG.showApp(), 2000);
    window.addEventListener('beforeunload', () => app.destroy());
    
  } catch (err) {
    window.NEXO_DIAG.log(`💥 FATAL: ${err.message}`, 'error');
    window.NEXO_DIAG.log(`📍 ${err.stack?.substring(0, 300)}`, 'error');
  }
}

function hideSplash() {
  setTimeout(() => window.NEXO_DIAG.hideSplash(), 1000);
}

// Iniciar
initNexo();
