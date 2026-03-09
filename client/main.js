// Checkpoint 1: Módulo cargado
if (window.NEXO_DIAG) {
  window.NEXO_DIAG.log('✅ main.js cargado (módulo ES6)', 'step');
  window.NEXO_DIAG.log('📦 Importando NexoApp...', 'info');
}

import { NexoApp } from './app/nexo_app.js';

// Checkpoint 2: Import exitoso
if (window.NEXO_DIAG) {
  window.NEXO_DIAG.log('✅ NexoApp importado correctamente', 'step');
  window.NEXO_DIAG.log('🔍 Verificando elementos DOM...', 'info');
}

(async () => {
  try {
    // Verificación DOM
    const elements = {
      diagnosticScreen: document.getElementById('diagnostic-screen'),
      appContainer: document.getElementById('app-container'),
      statusIndicator: document.getElementById('status-indicator'),
      messagesContainer: document.getElementById('messages-container'),
      messageInput: document.getElementById('message-input'),
      sendBtn: document.getElementById('send-btn')
    };

    // Validar elementos críticos
    const missingElements = Object.entries(elements)
      .filter(([name, el]) => !el)
      .map(([name]) => name);

    if (missingElements.length > 0) {
      throw new Error(`Elementos DOM faltantes: ${missingElements.join(', ')}`);
    }

    window.NEXO_DIAG.log('✅ DOM elements verificados', 'step');
    window.NEXO_DIAG.setStatus('⚙️ Instanciando NexoApp...');

    // Checkpoint 3: Instanciación
    window.NEXO_DIAG.log('🏗️  Creando instancia NexoApp...', 'step');
    
    const app = new NexoApp({
      relayUrls: ['wss://relay.nexo.app/ws'],
      bleTimeout: 5000,
      enableGestures: true,
      enableMesh: true,
      
      onMessage: (msg) => {
        window.NEXO_DIAG?.log(`📨 Mensaje recibido vía ${msg._source || 'desconocido'}`, 'info');
        
        if (!elements.messagesContainer) return;
        
        const div = document.createElement('div');
        div.className = `message ${msg.own ? 'own' : 'other'}`;
        div.textContent = msg.text || msg.data || JSON.stringify(msg);
        elements.messagesContainer.appendChild(div);
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
      },
      
      onStatusChange: (mode) => {
        window.NEXO_DIAG?.log(`🔄 Modo de conexión cambiado a: ${mode}`, 'info');
        
        if (!elements.statusIndicator) return;
        
        elements.statusIndicator.className = mode.toLowerCase();
        const labels = {
          P2P: '🟢 P2P',
          RELAY: '🔵 RELAY',
          HYBRID: '🟠 HYBRID',
          OFFLINE: '🔴 OFFLINE'
        };
        elements.statusIndicator.textContent = labels[mode] || mode;
      },
      
      onError: (err) => {
        window.NEXO_DIAG?.log(`❌ Error en NexoApp: ${err.message || err}`, 'error');
        console.error('NEXO Error:', err);
      }
    });

    window.NEXO_DIAG.log('✅ NexoApp instanciado', 'step');
    window.NEXO_DIAG.setStatus('🚀 Llamando app.init()...');

    // Checkpoint 4: Inicialización (ESTO ES DONDE MÁS FALLA)
    window.NEXO_DIAG.log('⏳ Iniciando inicialización (app.init)...', 'step');
    window.NEXO_DIAG.log('   → Esto puede tardar 5-10 segundos...', 'warn');
    
    await app.init();
    
    window.NEXO_DIAG.log('✅ app.init() completado exitosamente', 'step');
    window.NEXO_DIAG.setStatus('✨ ¡Inicialización exitosa!');
    
    // Exponer global para debugging
    window.nexoApp = app;
    window.NEXO_DIAG.log('🌍 window.nexoApp expuesto para debugging', 'info');

    // Configurar UI
    window.NEXO_DIAG.log('🎨 Configurando event listeners de UI...', 'step');
    
    const sendMessage = () => {
      const text = elements.messageInput.value.trim();
      if (!text) {
        window.NEXO_DIAG?.log('⚠️  Mensaje vacío ignorado', 'warn');
        return;
      }
      
      window.NEXO_DIAG?.log(`📤 Enviando mensaje: "${text.substring(0, 20)}..."`, 'info');
      
      try {
        app.sendMessage({
          type: 'chat',
          text: text,
          timestamp: Date.now()
        });
        elements.messageInput.value = '';
        window.NEXO_DIAG?.log('✅ Mensaje enviado a app.sendMessage()', 'step');
      } catch (err) {
        window.NEXO_DIAG?.log(`❌ Error enviando: ${err.message}`, 'error');
      }
    };
    
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    
    window.NEXO_DIAG.log('✅ Event listeners configurados', 'step');

    // Mostrar app real después de 2 segundos (para leer logs)
    setTimeout(() => {
      window.NEXO_DIAG?.log('🎬 Transicionando a interfaz principal...', 'step');
      window.NEXO_DIAG?.showApp();
    }, 2000);

    // Cleanup
    window.addEventListener('beforeunload', () => {
      window.NEXO_DIAG?.log('👋 App cerrándose, ejecutando destroy...', 'warn');
      app.destroy();
    });
    
  } catch (err) {
    window.NEXO_DIAG?.log(`💥 ERROR FATAL en main.js: ${err.message || err}`, 'error');
    window.NEXO_DIAG?.log(`📍 Stack: ${err.stack?.substring(0, 200) || 'No disponible'}`, 'error');
    window.NEXO_DIAG?.setStatus('❌ Error de arranque', 'error');
    
    // Mantener visible la pantalla de diagnóstico
    console.error('Fatal error:', err);
  }
})();
