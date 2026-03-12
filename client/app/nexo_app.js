// FASE 6: Stream (UI de mensajes) - CORREGIDO v2.3.1-FINAL
this.currentPhase = 'STREAM';
DEBUG.log('📰 [init] Fase 6/6: TheStream...');

try {
  // [FIX] El contenedor existe en tu HTML como #messages-container
  const container = document.getElementById('messages-container');
  
  if (!container) {
    throw new Error('Elemento #messages-container no encontrado en DOM');
  }
  
  // [FIX CRÍTICO] Verificar que es un Element válido
  if (!(container instanceof Element)) {
    throw new Error('Container no es un Elemento DOM válido');
  }

  // [FIX CRÍTICO] VirtualEngine recibe (container, options) - NO un objeto con container
  this.virtualEngine = new VirtualEngine(container, {
    itemHeight: 80,
    overscan: 3,        // Nombre correcto de la propiedad
    poolSize: 15        // Nombre correcto (no bufferSize)
  });
  
  // [FIX CRÍTICO] TheStream recibe (container, options)
  this.stream = new TheStream(container, {
    onItemTap: (item) => {
      DEBUG.log(`Tap en: ${item.id?.substr(0,8) || 'unknown'}`);
    },
    onItemSwipe: (item, action) => {
      DEBUG.log(`Swipe ${action} en mensaje`);
    },
    onLoadMore: async () => {
      DEBUG.log('Cargando más mensajes...');
    }
  });
  
  // Inicializar vacío
  this.stream.setData([]);
  
  DEBUG.log('✅ TheStream initialized correctamente');

} catch (streamErr) {
  DEBUG.error(`⚠️ Stream failed: ${streamErr.message}`);
  this.stream = null;
  this.virtualEngine = null;
  // No lanzar error - la app funciona sin stream (fallback a main.js)
}
