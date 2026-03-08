import { NexoApp } from './app/nexo_app.js';

/**
 * NEXO v9.0 - Entry Point v2.0-NAP-CERTIFIED
 * Inicialización con manejo de errores completo y cleanup garantizado
 * 
 * Correcciones NAP:
 * - [FIX 2.0.1] Async IIFE wrapper para await en top-level
 * - [FIX 2.0.2] Cleanup con beforeunload (destroy automático)
 * - [FIX 2.0.3] Validación de funciones auxiliares (showToast)
 * - [FIX 2.0.4] Manejo de errores consistente en todas las operaciones
 * - [FIX 2.0.5] Protección contra re-inicialización (singleton flag)
 */

// [FIX 2.0.5] Protección contra re-inicialización
if (window._nexoAppInitialized) {
  console.warn('NEXO: App ya inicializada, ignorando llamada duplicada');
} else {
  window._nexoAppInitialized = true;
  
  // [FIX 2.0.3] Función auxiliar segura
  const showToast = (message) => {
    // Si existe función global, usarla; si no, console.log
    if (typeof window.showToast === 'function') {
      window.showToast(message);
    } else if (typeof window.nexoToast === 'function') {
      window.nexoToast(message);
    } else {
      console.log('[TOAST]:', message);
    }
  };
  
  // [FIX 2.0.1] Async IIFE wrapper para poder usar await
  (async function initNexoApp() {
    let app = null;
    
    try {
      app = new NexoApp({
        // Múltiples relays fallback
        relayUrls: [
          'wss://relay1.nexo.app/ws',
          'wss://relay2.nexo.app/ws',
          'wss://relay.nexo.network/ws'
        ],
        
        // Timeout BLE: 5s antes de fallback a Relay
        bleTimeout: 5000,
        
        // Callbacks
        onMessage: (message) => {
          console.log('📨 New message:', message.text);
          console.log('From:', message._source); // 'ble', 'relay', o 'self'
          if (message._peerId) {
            console.log('Peer:', message._peerId);
          }
        },
        
        onStatusChange: (mode) => {
          console.log('Connection mode:', mode); // 'BLE' | 'RELAY' | 'HYBRID' | 'OFFLINE'
          
          if (mode === 'OFFLINE') {
            showToast('Sin conexión - mensajes guardados localmente');
          }
        },
        
        onError: (error) => {
          console.error('NEXO Error:', error);
        }
      });
      
      // Guardar referencia global para debugging
      window.nexoApp = app;
      
      // Inicializar con timeout
      const result = await app.init();
      console.log('✅ Connected:', result.mode);
      console.log('Identity:', result.identity);
      
      // [FIX 2.0.2] Cleanup automático al cerrar página
      window.addEventListener('beforeunload', () => {
        console.log('NEXO: Cerrando aplicación...');
        if (app && typeof app.destroy === 'function') {
          try {
            app.destroy();
          } catch (e) {
            console.error('Error en destroy:', e);
          }
        }
      });
      
      // [FIX 2.0.2] Cleanup en navegación SPA (si aplica)
      window.addEventListener('pagehide', () => {
        if (app && typeof app.destroy === 'function') {
          try {
            app.destroy();
          } catch (e) {
            // Ignorar errores en cleanup
          }
        }
      });
      
      // [FIX 2.0.4] Exponer API segura para el resto de la app
      window.nexoAPI = {
        sendMessage: async (data) => {
          if (!app || !app.sendMessage) {
            console.error('NEXO: App no inicializada');
            return { sent: false, error: 'App not initialized' };
          }
          
          try {
            const result = app.sendMessage({
              type: data.type || 'chat',
              text: data.text || '',
              sender: data.sender || 'anonymous'
            });
            
            if (result.sent) {
              console.log('Enviado vía:', result.via); // ['BLE'] o ['RELAY'] o ['BLE','RELAY']
            } else {
              console.log('Guardado offline - se enviará al reconectar');
            }
            
            return result;
          } catch (error) {
            console.error('Error enviando mensaje:', error);
            return { sent: false, error: error.message };
          }
        },
        
        getStats: () => {
          if (!app || !app.getStats) {
            return { state: 'NOT_INITIALIZED' };
          }
          return app.getStats();
        },
        
        getState: () => {
          if (!app) return 'NOT_INITIALIZED';
          return app._isDestroyed ? 'DESTROYED' : (app.state || 'UNKNOWN');
        }
      };
      
      // Log de inicialización exitosa
      console.log('NEXO v9.0 iniciado correctamente');
      console.log('Stats:', window.nexoAPI.getStats());
      
    } catch (error) {
      console.error('💥 Fallo total en inicialización:', error);
      
      // [FIX 2.0.4] Crear API dummy para que el resto de la app no crashee
      window.nexoAPI = {
        sendMessage: () => ({ 
          sent: false, 
          error: 'App initialization failed',
          offline: true 
        }),
        getStats: () => ({ state: 'ERROR', error: error.message }),
        getState: () => 'ERROR'
      };
      
      // Mostrar error al usuario
      showToast('Error iniciando NEXO: ' + error.message);
      
      // Reset flag para permitir retry manual
      window._nexoAppInitialized = false;
    }
  })();
}
