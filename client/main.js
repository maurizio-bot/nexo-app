import { NexoApp } from './app/nexo_app.js';

// Debug UI - muestra progreso en pantalla
const debugDiv = document.createElement('div');
debugDiv.id = 'debug-log';
debugDiv.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;bottom:10px;background:#000;color:#0f0;font-family:monospace;font-size:14px;overflow:auto;padding:10px;z-index:99999;white-space:pre-wrap;';
document.body.appendChild(debugDiv);

const log = (step, msg, type = 'info') => {
  const time = new Date().toLocaleTimeString();
  const color = type === 'error' ? '#ff4444' : (type === 'warn' ? '#ffaa00' : '#00ff88');
  const line = `[${time}] [${step}] ${msg}`;
  console.log(line);
  debugDiv.innerHTML += `<div style="color:${color};margin:2px 0;">${line}</div>`;
  debugDiv.scrollTop = debugDiv.scrollHeight;
};

const errorFatal = (step, err) => {
  log(step, `FALLO CRÍTICO: ${err.message}`, 'error');
  log('SYSTEM', 'Stack: ' + (err.stack || 'No stack'), 'error');
  
  const btn = document.createElement('button');
  btn.textContent = 'Reintentar';
  btn.style.cssText = 'margin-top:20px;padding:10px 20px;background:#ff4444;color:white;border:none;border-radius:5px;cursor:pointer;';
  btn.onclick = () => location.reload();
  debugDiv.appendChild(btn);
  
  throw err; // Re-lanzar para que el catch global lo capture
};

(async () => {
  log('INIT', '🚀 Iniciando NEXO v9.0...');
  
  try {
    // Paso 1: Verificar entorno
    log('ENV', 'Verificando WebView...');
    if (!window.isSecureContext) {
      throw new Error('No es secure context (HTTPS/localhost)');
    }
    log('ENV', '✓ Secure context OK');
    
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('WebCrypto API no disponible');
    }
    log('ENV', '✓ WebCrypto OK');
    
    if (!navigator.bluetooth) {
      log('ENV', '⚠ Web Bluetooth no disponible (modo relay-only)', 'warn');
    } else {
      log('ENV', '✓ Web Bluetooth disponible');
    }

    // Paso 2: Instanciar clase
    log('CTOR', 'Creando instancia NexoApp...');
    let app;
    try {
      app = new NexoApp({
        relayUrls: ['wss://relay.nexo.app/ws'],
        bleTimeout: 5000,
        enableGestures: true,
        enableMesh: true,
        
        onMessage: (msg) => {
          log('MSG', `Recibido: ${JSON.stringify(msg).substring(0,100)}`);
        },
        
        onStatusChange: (mode) => {
          log('STATUS', `Modo cambiado a: ${mode}`);
        },
        
        onError: (err) => {
          log('CB-ERROR', `Error callback: ${err.message}`, 'warn');
        }
      });
      log('CTOR', '✓ Instancia creada OK');
    } catch (err) {
      errorFatal('CTOR', new Error(`Error al instanciar: ${err.message}`));
    }

    // Paso 3: Inicializar con timeout global de seguridad
    log('INIT', 'Ejecutando app.init()...');
    
    const initPromise = app.init();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TIMEOUT GLOBAL: app.init() > 15s')), 15000)
    );
    
    await Promise.race([initPromise, timeoutPromise]);
    log('INIT', '✓ Inicialización completada OK');
    
    // Paso 4: UI normal
    log('UI', 'Cargando interfaz de usuario...');
    document.body.removeChild(debugDiv); // Quitar debug si todo OK
    
    // Tu UI normal aquí (simplificada para debug)
    const container = document.createElement('div');
    container.innerHTML = `
      <div style="padding:20px;color:white;">
        <h1 style="color:#00ff88;">NEXO Online ✓</h1>
        <p>Modo: ${app.bridge?.getMode?.() || 'UNKNOWN'}</p>
        <input type="text" id="msg" placeholder="Mensaje..." style="width:100%;padding:10px;margin:10px 0;">
        <button id="send" style="padding:10px 20px;background:#00ff88;border:none;">Enviar</button>
      </div>
    `;
    document.body.appendChild(container);
    
    document.getElementById('send').onclick = () => {
      const text = document.getElementById('msg').value;
      if (text) {
        app.sendMessage({ type: 'chat', text, timestamp: Date.now() });
        log('SEND', `Enviado: ${text}`);
      }
    };
    
    window.nexoApp = app;
    log('READY', '🎉 Aplicación lista');
    
  } catch (err) {
    errorFatal('GLOBAL', err);
  }
})();
