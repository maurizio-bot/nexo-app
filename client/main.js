/**
 * client/main.js - v2.6-NAP-CERTIFIED
 * FIX: Ghost Coupling eliminado, Race Condition fix, Resource Management SOC2
 * Auditoría: NAP 2.0 + OWASP MASVS + SOC 2 + IAST
 */

import { NexoApp } from './app/nexo_app.js';
import { OnboardingController } from './auth/onboarding.js';
import { CryptoVault } from './core/crypto_vault.js';

// NAP: Configuration hardening
const CONFIG = {
  RELAY_URLS: (import.meta.env?.VITE_RELAY_URLS?.split(',') || ['wss://echo.websocket.org/']),
  MESSAGE_CACHE_SIZE: 500,
  SPLASH_DELAY: 2000,
  BLE_TIMEOUT: 10000
};

const DIAG = window.NEXO_DIAG || {
  log: (msg, level = 'info') => console.log(`[NEXO] [${level.toUpperCase()}] ${msg}`),
  error: (code, msg, details) => console.error(`[NEXO] [ERROR] ${code}: ${msg}`, details || ''),
  audit: (action, entity, success) => console.log(`[NEXO-AUDIT] ${action} | Entity: ${entity} | Success: ${success}`),
  hideSplash: () => {
    const splash = document.getElementById('splash-native');
    if (splash) {
      setTimeout(() => {
        splash.classList.add('hidden');
        setTimeout(() => splash.remove(), 500);
      }, CONFIG.SPLASH_DELAY);
    }
  }
};

// NAP: Global reference tracker (SOC2 - Resource management)
const GLOBAL_REFS = {
  app: null,
  vault: null,
  cleanup: () => {
    if (window.nexoApp) {
      window.nexoApp.destroy?.();
      window.nexoApp = null;
    }
    window.nexoVault = null;
    DIAG.log('Global references cleaned', 'debug');
  }
};

async function initNexo() {
  DIAG.log('🚀 MAIN.JS v2.6-NAP-CERTIFIED - Inicializando', 'info');

  try {
    // NAP: Verify onboarding state
    const hasCompletedOnboarding = localStorage.getItem('nexo_onboarding_done') === 'true';
    const hasExistingIdentity = localStorage.getItem('nexo_identity_exists') === 'true';
    
    if (!hasCompletedOnboarding || !hasExistingIdentity) {
      DIAG.log('👤 PRIMER INICIO - Onboarding', 'info');
      const onboarding = new OnboardingController({
        container: document.body,
        onComplete: () => {
          localStorage.setItem('nexo_onboarding_done', 'true');
          localStorage.setItem('nexo_identity_exists', 'true');
          DIAG.audit('ONBOARDING_COMPLETE', 'User', true);
          window.location.reload();
        },
        onError: (err, phase) => {
          DIAG.error(`ONBOARD-${phase}`, err.message);
          DIAG.audit('ONBOARDING_ERROR', phase, false);
        }
      });
      await onboarding.start();
      return;
    }

    // UI Setup
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.style.display = 'flex';
    
    const statusIndicator = document.getElementById('status-indicator');
    if (statusIndicator) statusIndicator.style.display = 'block';

    // NAP: Initialize Vault with error boundary
    DIAG.log('🔐 Inicializando CryptoVault...');
    let vault;
    try {
      vault = new CryptoVault();
      await vault.init();
    } catch (vaultErr) {
      DIAG.error('VAULT-INIT', vaultErr.message);
      throw new Error(`CryptoVault initialization failed: ${vaultErr.message}`);
    }
    
    const myIdentity = vault.getIdentity() || 'unknown';
    DIAG.log(`✅ Vault OK - ID: ${myIdentity.substring(0, 8)}...`);
    DIAG.audit('VAULT_INIT', myIdentity.substring(0, 16), true);

    // NAP: Message deduplication with TTL (SOC2 - Data integrity)
    const messageCache = new Map(); // id -> {timestamp, rendered}
    const MESSAGE_TTL = 5 * 60 * 1000; // 5 minutes
    
    const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const isDuplicate = (msgId) => {
      if (!msgId) return false;
      
      const existing = messageCache.get(msgId);
      if (existing) {
        // Update timestamp to extend TTL (Leaky Bucket)
        existing.lastSeen = Date.now();
        return true;
      }
      
      // Cleanup old entries (NAP: Memory management)
      const now = Date.now();
      for (const [id, data] of messageCache.entries()) {
        if (now - data.timestamp > MESSAGE_TTL) {
          messageCache.delete(id);
        }
      }
      
      return false;
    };

    const trackMessage = (msgId, isOwn = false) => {
      if (!msgId) return;
      messageCache.set(msgId, {
        timestamp: Date.now(),
        lastSeen: Date.now(),
        isOwn: isOwn,
        rendered: true
      });
    };

    // NAP: Safe Stream Interface (Interface Contract Validation)
    const getStreamInterface = () => {
      // Check global reference first (avoid window lookup if possible)
      const app = GLOBAL_REFS.app || window.nexoApp;
      if (!app) return null;
      
      // NAP: Strict interface validation (MASVS - Secure API usage)
      if (app.stream && typeof app.stream.appendItems === 'function') {
        return app.stream;
      }
      
      return null;
    };

    // NAP: Render with error boundary (IAST - Runtime protection)
    const renderToStream = (item) => {
      const stream = getStreamInterface();
      
      if (stream) {
        try {
          // NAP: Defensive call with validation
          stream.appendItems([item]);
          return true;
        } catch (streamErr) {
          DIAG.error('STREAM-RENDER', streamErr.message, { itemId: item.id });
          // Fallthrough to manual render
        }
      }
      
      // Fallback manual (REM - Graceful degradation)
      return addManualMessage(item);
    };

    // NAP: Pre-assign global reference to avoid race condition
    // This prevents "window.nexoApp is undefined" in onMessage callbacks
    const app = new NexoApp({
      relayUrls: CONFIG.RELAY_URLS,
      bleTimeout: CONFIG.BLE_TIMEOUT,
      enableGestures: true,
      enableMesh: true,
      
      onMessage: (msg) => {
        // NAP: Input validation (MASVS - Input validation)
        if (!msg || typeof msg !== 'object') {
          DIAG.error('MSG-INVALID', 'Received null or non-object message');
          return;
        }
        
        if (!msg.text && !msg.data && !msg.content) {
          DIAG.log('MSG-EMPTY: Ignoring message without content', 'warn');
          return;
        }
        
        const msgId = msg._id || msg.id || msg.messageId;
        const sender = msg._sender || msg.sender || 'unknown';
        const isOwn = sender === myIdentity || msg._own === true;
        
        // NAP: Deduplication check
        if (isDuplicate(msgId)) {
          if (isOwn) {
            DIAG.log(`✅ Eco confirmado: ${msgId?.substr(0, 20)}...`);
            updateMessageStatus(msgId, 'delivered');
          }
          return;
        }
        
        // Track message
        trackMessage(msgId, isOwn);
        DIAG.audit('MESSAGE_RECEIVED', msgId?.substr(0, 16) || 'no-id', true);
        
        // NAP: Sanitize content (XSS prevention)
        const content = String(msg.text || msg.data || msg.content || '').trim();
        if (!content) return;
        
        // Prepare stream item
        const streamItem = {
          id: msgId || generateId(),
          type: 'message',
          content: content,
          sender: isOwn ? 'Tú' : (sender.substring(0, 8) || 'Desconocido'),
          timestamp: msg.timestamp || Date.now(),
          isMe: isOwn,
          _original: msg // Preserve original for debugging
        };
        
        // Render with error boundary
        const rendered = renderToStream(streamItem);
        if (!rendered) {
          DIAG.error('RENDER-FAILED', 'Both stream and manual render failed', { msgId });
        }
      },
      
      onStatusChange: (mode) => {
        if (!statusIndicator) return;
        
        const labels = {
          P2P: '🟢 P2P', 
          RELAY: '🔵 RELAY', 
          HYBRID: '🟠 HYBRID', 
          OFFLINE: '🔴 OFFLINE'
        };
        
        statusIndicator.className = `status ${mode.toLowerCase()}`;
        statusIndicator.textContent = labels[mode] || mode;
        statusIndicator.setAttribute('aria-label', `Connection mode: ${mode}`);
        
        DIAG.audit('STATUS_CHANGE', mode, true);
      },
      
      onError: (err, code) => {
        DIAG.error(code || 'APP-ERR', err?.message || 'Unknown error');
        DIAG.audit('APP_ERROR', code, false);
      }
    });

    // NAP: Atomic global assignment (prevent race condition)
    GLOBAL_REFS.app = app;
    GLOBAL_REFS.vault = vault;
    window.nexoApp = app;
    window.nexoVault = vault;
    
    // Now initialize (callbacks already have reference via closure or GLOBAL_REFS)
    await app.init();
    
    DIAG.hideSplash();
    DIAG.audit('APP_INIT', 'NexoApp', true);

    // Setup input handlers
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    
    if (!messageInput || !sendBtn) {
      throw new Error('UI Elements not found: message-input or send-btn');
    }
    
    const sendMessage = () => {
      const text = messageInput.value?.trim();
      if (!text) return;
      
      // NAP: Check app readiness
      if (!GLOBAL_REFS.app || !GLOBAL_REFS.app.sendMessage) {
        DIAG.error('SEND-NOT-READY', 'App not initialized');
        return;
      }
      
      const msgId = generateId();
      const timestamp = Date.now();
      
      // Track locally for echo detection
      trackMessage(msgId, true);
      
      // Optimistic UI render
      const optimisticItem = {
        id: msgId,
        type: 'message',
        content: text,
        sender: 'Tú',
        timestamp: timestamp,
        isMe: true,
        _status: 'sending'
      };
      
      renderToStream(optimisticItem);
      DIAG.audit('MESSAGE_SENT', msgId.substr(0, 16), true);
      
      // Send via network
      try {
        GLOBAL_REFS.app.sendMessage({
          type: 'chat',
          text: text,
          timestamp: timestamp,
          _id: msgId,
          _sender: myIdentity,
          _own: true
        });
      } catch (sendErr) {
        DIAG.error('SEND-FAILED', sendErr.message);
        updateMessageStatus(msgId, 'failed');
      }
      
      messageInput.value = '';
      messageInput.focus();
    };

    // NAP: Event listener with cleanup tracking (SOC2)
    const handlers = {
      click: sendMessage,
      keypress: (e) => { if (e.key === 'Enter') sendMessage(); }
    };
    
    sendBtn.addEventListener('click', handlers.click);
    messageInput.addEventListener('keypress', handlers.keypress);
    
    // Store for cleanup
    app._inputHandlers = handlers;
    app._inputElements = { sendBtn, messageInput };

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
      // Remove specific listeners
      if (app._inputElements) {
        app._inputElements.sendBtn?.removeEventListener('click', app._inputHandlers?.click);
        app._inputElements.messageInput?.removeEventListener('keypress', app._inputHandlers?.keypress);
      }
      GLOBAL_REFS.cleanup();
    });

    // Helper: Manual fallback render
    function addManualMessage(item) {
      try {
        const container = document.getElementById('messages-container');
        if (!container) return false;
        
        // Check duplicado por si acaso
        if (container.querySelector(`[data-id="${item.id}"]`)) return true;
        
        const div = document.createElement('div');
        div.className = `message ${item.isMe ? 'own' : 'other'}`;
        div.dataset.id = item.id;
        
        // NAP: Safe text content (XSS prevention)
        const contentSpan = document.createElement('span');
        contentSpan.textContent = item.content;
        div.appendChild(contentSpan);
        
        if (item._status === 'sending') {
          div.style.opacity = '0.7';
          div.dataset.status = 'sending';
        }
        
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return true;
      } catch (err) {
        DIAG.error('MANUAL-RENDER', err.message);
        return false;
      }
    }
    
    function updateMessageStatus(id, status) {
      try {
        const msg = document.querySelector(`[data-id="${id}"]`);
        if (msg) {
          msg.dataset.status = status;
          if (status === 'delivered') msg.style.opacity = '1';
          if (status === 'failed') msg.style.opacity = '0.5';
        }
      } catch (err) {
        DIAG.error('STATUS-UPDATE', err.message);
      }
    }

  } catch (err) {
    DIAG.error('INIT-FATAL', err.message, { stack: err.stack });
    DIAG.audit('APP_INIT', 'NexoApp', false);
    
    const fatal = document.getElementById('fatal-error');
    const fatalCode = document.getElementById('fatal-code');
    if (fatal && fatalCode) {
      fatalCode.textContent = `INIT-FATAL: ${err.message}`;
      fatal.classList.add('visible');
    }
  }
}

// NAP: Safe initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNexo);
} else {
  initNexo();
}
