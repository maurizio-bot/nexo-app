// src/main.js - Punto de entrada NEXO v9.0

// 1. Estilos críticos (NAP + UI base)
import './styles/critical.css';

// 2. Sistema de diagnóstico NAP
import { NEXO_DIAG } from './core/nap.js';

// 3. Módulos core de la Arquitectura Lateral
// (Descomenta según vayas migrando)
// import './core/gesture_engine.js';
// import './stream/the_stream.js';
// import './vault/chispas_system.js';

// 4. App principal (si existe nexo_app.js en src/)
// import './nexo_app.js';

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  // Iniciar sistema de diagnóstico
  NEXO_DIAG.init();
  
  // Ocultar splash cuando todo esté listo
  window.addEventListener('load', () => {
    NEXO_DIAG.hideSplash();
    NEXO_DIAG.log('NEXO v9.0 Iniciado - Arquitectura Lateral', 'info');
  });
  
  // Setup básico de UI (temporal hasta migrar nexo_app.js completo)
  setupBasicUI();
});

function setupBasicUI() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const container = document.getElementById('messages-container');
  
  if (sendBtn && input && container) {
    sendBtn.addEventListener('click', () => sendMessage());
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }
  
  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    
    addMessage(text, 'own');
    input.value = '';
    
    // Simular respuesta (temporal)
    setTimeout(() => {
      addMessage('Mensaje recibido (demo)', 'other');
    }, 1000);
  }
  
  function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }
}
