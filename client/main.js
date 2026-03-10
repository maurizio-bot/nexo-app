// Checkpoint 0: Verificar si es primera vez (antes de cargar todo)
if (window.NEXO_DIAG) {
  window.NEXO_DIAG.log('✅ main.js cargado (módulo ES6)', 'step');
  window.NEXO_DIAG.log('🔍 Verificando si es primera vez...', 'info');
}

// [FIX] Imports incluyen onboarding y helpers
import { NexoApp } from './app/nexo_app.js';
import { OnboardingController } from './auth/onboarding.js';
import { WebAuthnHelper } from './auth/webauthn_helper.js';
import { CryptoVault } from './core/crypto_vault.js';

// Checkpoint 1: Imports exitosos
if (window.NEXO_DIAG) {
  window.NEXO_DIAG.log('✅ Módulos importados (NexoApp, Onboarding, WebAuthn, Vault)', 'step');
}

/**
 * Verifica si el usuario ya tiene identidad o necesita onboarding
 */
async function checkNeedsOnboarding() {
  try {
    // [FIX] Verificar si existe identidad previa sin bloquear la app
    const vault = new CryptoVault();
    await vault.init();
    const identity = vault.getIdentity();
    return !identity; // true si necesita onboarding
  } catch (err) {
    window.NEXO_DIAG?.log(`⚠️  No se pudo verificar identidad: ${err.message}`, 'warn');
    return true; // Asumir primera vez si hay error
  }
}

(async () => {
  try {
    // Verificación DOM (no fatal, modo degradado)
    const elements = {
      diagnosticScreen: document.getElementById('diagnostic-screen'),
      appContainer: document.getElementById('app-container'),
      statusIndicator: document.getElementById('status-indicator'),
      messagesContainer: document.getElementById('messages-container'),
      messageInput: document.getElementById('message-input'),
      sendBtn: document.getElementById('send-btn')
    };

    const missingElements = Object.entries(elements)
      .filter(([name, el]) => !el)
      .map(([name]) => name);

    if (missingElements.length > 0) {
      window.NEXO_DIAG?.log(`⚠️  DOM elements faltantes: ${missingElements.join(', ')}`, 'warn');
      window.NEXO_DIAG?.log('⚠️  Continuando en modo degradado...', 'warn');
      // [FIX] No hacer throw, continuar con lo que haya
    } else {
      window.NEXO_DIAG.log('✅ DOM elements verificados', 'step');
    }

    // [FIX] Paso 1: Onboarding si es necesario
    window.NEXO_DIAG.setStatus('🔍 Verificando identidad...');
    const needsOnboarding = await checkNeedsOnboarding();
    
    if (needsOnboarding) {
      window.NEXO_DIAG.log('👤 Primera vez detectada - Iniciando onboarding...', 'step');
      window.NEXO_DIAG.setStatus('🎨 Mostrando onboarding...');
      
      const onboarding = new OnboardingController({
        container: elements.appContainer || document.body,
        onComplete: () => {
          window.NEXO_DIAG.log('✅ Onboarding completado', 'step');
          window.NEXO_DIAG.log('🔄 Recargando para iniciar app...', 'info');
          // [FIX] Recargar para reiniciar flujo con identidad ya creada
          setTimeout(() => window.location.reload(), 1000);
        },
        onError: (err) => {
          window.NEXO_DIAG.log(`❌ Error en onboarding: ${err.message}`, 'error');
        }
      });
      
      await onboarding.start();
      return; // Detener aquí, el onComplete recargará
    }
    
    window.NEXO_DIAG.log('✅ Usuario ya tiene identidad', 'step');

    // [FIX] Paso 2: Iniciar NexoApp con relay de prueba
    window.NEXO_DIAG.log('🏗️  Creando instancia NexoApp...', 'step');
    
    const app = new NexoApp({
      relayUrls: [
        'wss://echo.websocket.org/',  // [FIX] Relay público de prueba
        // 'wss://relay.nexo.app/ws'  // Tu servidor cuando esté listo
      ],
      bleTimeout: 10000, // [FIX] Más tiempo para encontrar peers BLE
      enableGestures: true,
      enableMesh: true,
      
      onMessage: (msg) => {
        window.NEXO_DIAG?.log(`📨 Mensaje vía ${msg._source || 'desconocido'}: ${msg.text?.substring(0, 30)}...`, 'info');
        
        if (!elements.messagesContainer) return;
        
        const div = document.createElement('div');
        div.className = `message ${msg.own ? 'own' : 'other'}`;
        div.textContent = msg.text || msg.data || JSON.stringify(msg);
        elements.messagesContainer.appendChild(div);
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
      },
      
      onStatusChange: (mode) => {
        window.NEXO_DIAG?.log(`🔄 Modo: ${mode}`, 'info');
        
        if (!elements.statusIndicator) return;
        
        elements.statusIndicator.className = mode.toLowerCase();
        const labels = {
          P2P: '🟢 P2P',
          RELAY: '🔵 RELAY', 
          HYBRID: '🟠 HYBRID',
          OFFLINE: '🔴 OFFLINE'
        };
        elements.statusIndicator.textContent = labels[mode] || mode;
        
        // [FIX] Si está OFFLINE, sugerir verificar relay
        if (mode === 'OFFLINE') {
          window.NEXO_DIAG?.log('⚠️  MODO OFFLINE - Verificar conexión a echo.websocket.org', 'warn');
        }
      },
      
      onError: (err) => {
        window.NEXO_DIAG?.log(`❌ Error: ${err.message || err}`, 'error');
        console.error('NEXO Error:', err);
      }
    });

    window.NEXO_DIAG.log('✅ NexoApp instanciado', 'step');
    window.NEXO_DIAG.setStatus('🚀 Iniciando (timeout 15s)...');

    // [FIX] Timeout de seguridad para app.init()
    const initTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Init timeout (>15s)')), 15000)
    );
    
    await Promise.race([app.init(), initTimeout]);
    
    window.NEXO_DIAG.log('✅ app.init() completado', 'step');
    window.NEXO_DIAG.setStatus('✨ ¡Listo!');
    
    window.nexoApp = app;
    window.NEXO_DIAG.log('🌍 window.nexoApp expuesto', 'info');

    // Configurar UI (solo si existen elementos)
    if (elements.sendBtn && elements.messageInput) {
      window.NEXO_DIAG.log('🎨 Configurando UI...', 'step');
      
      const sendMessage = () => {
        const text = elements.messageInput.value.trim();
        if (!text) {
          window.NEXO_DIAG?.log('⚠️  Mensaje vacío', 'warn');
          return;
        }
        
        window.NEXO_DIAG?.log(`📤 Enviando: "${text.substring(0, 20)}..."`, 'info');
        
        try {
          app.sendMessage({
            type: 'chat',
            text: text,
            timestamp: Date.now()
          });
          elements.messageInput.value = '';
        } catch (err) {
          window.NEXO_DIAG?.log(`❌ Error enviando: ${err.message}`, 'error');
        }
      };
      
      elements.sendBtn.addEventListener('click', sendMessage);
      elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });
      
      window.NEXO_DIAG.log('✅ UI configurada', 'step');
    } else {
      window.NEXO_DIAG.log('⚠️  UI no configurada (faltan elementos)', 'warn');
    }

    // Mostrar app principal
    setTimeout(() => {
      window.NEXO_DIAG?.log('🎬 Mostrando interfaz...', 'step');
      window.NEXO_DIAG?.showApp?.();
    }, 1500);

    // Cleanup
    window.addEventListener('beforeunload', () => {
      window.NEXO_DIAG?.log('👋 Cerrando app...', 'warn');
      app.destroy();
    });
    
  } catch (err) {
    window.NEXO_DIAG?.log(`💥 FATAL: ${err.message || err}`, 'error');
    window.NEXO_DIAG?.log(`📍 Stack: ${err.stack?.substring(0, 200)}`, 'error');
    window.NEXO_DIAG?.setStatus('❌ Error fatal', 'error');
    console.error('Fatal:', err);
  }
})();
