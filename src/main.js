import { GestureEngine } from './core/gesture_engine.js';
import { TheStream } from './stream/the_stream.js';
import { VaultPanel } from './vault/vault_panel.js';
import { ChispasSystem } from './vault/chispas/chispas_system.js';
import './styles/main.css';

// Inicialización ordenada
const initNexo = () => {
  // 1. Estado global
  window.NEXO = {
    vaultOpen: false,
    currentContext: null
  };

  // 2. Componentes core
  const stream = new TheStream('video-player', 'stream-container');
  const vault = new VaultPanel('vault-panel', 'contacts-list');
  const chispas = new ChispasSystem('chispas-overlay');
  
  // 3. Engine de gestos (conecta Stream + Vault)
  const gesture = new GestureEngine(
    document.getElementById('stream-container'),
    document.getElementById('vault-panel')
  );

  // 4. Eventos globales
  window.addEventListener('nexo:vault:opened', () => {
    window.NEXO.vaultOpen = true;
    stream.onVaultOpen();
  });
  
  window.addEventListener('nexo:vault:closed', () => {
    window.NEXO.vaultOpen = false;
    stream.onVaultClose();
  });

  console.log('[NEXO] v9.0 iniciado - Arquitectura Lateral activa');
};

document.addEventListener('DOMContentLoaded', initNexo);
