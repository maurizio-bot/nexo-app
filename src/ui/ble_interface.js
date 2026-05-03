/**
 * ble_interface.js v4.2.2-ARCH — REM Exhaustivo
 * FIX: Retroalimentación detallada en cada paso JS
 */

const SVG_ICONS = {
  chat: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
  ble: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 3 18 9"/><polyline points="6 15 12 21 18 15"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`,
  settings: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  send: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  close: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  logo: `<svg width="120" height="120" viewBox="0 0 100 100"><defs><linearGradient id="nexoGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#00d4ff;stop-opacity:1" /><stop offset="100%" style="stop-color:#7b2cbf;stop-opacity:1" /></linearGradient></defs><circle cx="50" cy="50" r="40" fill="none" stroke="url(#nexoGrad)" stroke-width="2"/><circle cx="50" cy="30" r="8" fill="#00d4ff"/><circle cx="30" cy="60" r="8" fill="#7b2cbf"/><circle cx="70" cy="60" r="8" fill="#00d4ff"/><line x1="50" y1="30" x2="30" y2="60" stroke="#fff" stroke-width="1.5"/><line x1="50" y1="30" x2="70" y2="60" stroke="#fff" stroke-width="1.5"/><line x1="30" y1="60" x2="70" y2="60" stroke="#fff" stroke-width="1.5"/></svg>`
};

let _globalInterface = null;

export function initBLEInterface(meshInstance) {
  const plugin = window.Capacitor?.Plugins?.NexoBLE;
  console.log('[REM-JS-001] initBLEInterface() — INICIO');
  console.log('[REM-JS-002] plugin detectado:', plugin ? 'SÍ' : 'NO', 'tipo:', typeof plugin);

  const state = {
    contacts: new Map(),
    devices: new Map(),
    isScanning: false,
    activeTab: 'main',
    localDeviceAddress: null,
    localDeviceName: null,
    nativePlugin: plugin || null,
    nameLocked: false,
    scanTimer: null,
    scanDuration: 15,
    _listeners: [],
    _activeChatDeviceId: null,
    _messageQueue: [],
    _deviceUUID: null,
  };

  console.log('[REM-JS-003] Estado inicial:', { activeTab: state.activeTab, hasPlugin: !!state.nativePlugin });

  const styleId = 'nexo-ble-interface-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .nexo-app-container { position: fixed; inset: 0; background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; overflow: hidden; }
      .nexo-header { padding: 16px 20px; border-bottom: 1px solid #222; display: flex; align-items: center; justify-content: space-between; }
      .nexo-header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 2px; }
      .nexo-content { flex: 1; overflow-y: auto; position: relative; }
      .nexo-tab { display: none; height: 100%; flex-direction: column; }
      .nexo-tab.active { display: flex; }
      .nexo-main-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 24px; }
      .nexo-logo-graphic { width: 140px; height: 140px; opacity: 0.9; }
      .nexo-version { font-size: 14px; color: #666; letter-spacing: 4px; text-transform: uppercase; }
      .nexo-ble-header { padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #222; }
      .nexo-ble-title { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; }
      .nexo-ble-icon { width: 28px; height: 28px; background: linear-gradient(135deg,#00d4ff,#7b2cbf); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
      .nexo-ble-close { width: 32px; height: 32px; border-radius: 50%; background: #222; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #999; }
      .nexo-scan-status { padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; }
      .nexo-scan-badge { background: #b8860b; color: #000; padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
      .nexo-scan-timer { color: #999; font-size: 13px; font-variant-numeric: tabular-nums; }
      .nexo-device-list { flex: 1; overflow-y: auto; padding: 0 20px; }
      .nexo-device-empty { text-align: center; color: #666; font-style: italic; padding: 40px 20px; }
      .nexo-device-item { padding: 14px 16px; background: #111; border: 1px solid #222; border-radius: 12px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; }
      .nexo-device-item:hover { border-color: #00d4ff; background: #0a1a1f; }
      .nexo-device-info { display: flex; flex-direction: column; gap: 2px; }
      .nexo-device-name { font-size: 15px; font-weight: 600; color: #fff; }
      .nexo-device-mac { font-size: 11px; color: #666; font-family: monospace; }
      .nexo-device-rssi { font-size: 11px; color: #00d4ff; }
      .nexo-device-add { width: 32px; height: 32px; border-radius: 50%; background: #00d4ff; color: #000; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; }
      .nexo-chat-header { padding: 12px 20px; border-bottom: 1px solid #222; display: flex; align-items: center; gap: 12px; }
      .nexo-chat-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg,#00d4ff,#7b2cbf); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
      .nexo-chat-meta { display: flex; flex-direction: column; }
      .nexo-chat-name { font-size: 15px; font-weight: 600; }
      .nexo-chat-subtitle { font-size: 11px; color: #00d4ff; text-transform: uppercase; letter-spacing: 1px; }
      .nexo-chat-messages { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
      .nexo-chat-bubble { max-width: 75%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
      .nexo-chat-bubble.own { align-self: flex-end; background: #0055aa; color: #fff; border-bottom-right-radius: 4px; }
      .nexo-chat-bubble.other { align-self: flex-start; background: #222; color: #fff; border-bottom-left-radius: 4px; }
      .nexo-chat-bubble.pending { opacity: 0.7; }
      .nexo-chat-bubble.confirmed { opacity: 1; }
      .nexo-chat-input-area { padding: 12px 16px; border-top: 1px solid #222; display: flex; align-items: center; gap: 10px; }
      .nexo-chat-input { flex: 1; background: #1a1a2e; border: none; border-radius: 24px; padding: 12px 18px; color: #fff; font-size: 15px; outline: none; }
      .nexo-chat-input::placeholder { color: #666; }
      .nexo-chat-send { width: 44px; height: 44px; border-radius: 50%; background: #0077ff; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; flex-shrink: 0; }
      .nexo-chat-send:active { transform: scale(0.95); }
      .nexo-settings-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 20px; }
      .nexo-settings-icon { width: 80px; height: 80px; color: #444; }
      .nexo-settings-text { color: #666; font-size: 16px; }
      .nexo-bottom-bar { height: 56px; background: #0a0a0a; border-top: 1px solid #222; display: flex; align-items: center; justify-content: space-around; padding: 0 20px; }
      .nexo-bar-btn { flex: 1; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: none; border: none; color: #666; cursor: pointer; transition: all 0.2s; }
      .nexo-bar-btn.active { color: #00d4ff; }
      .nexo-bar-btn svg { width: 22px; height: 22px; }
      .nexo-bar-label { font-size: 10px; font-weight: 500; letter-spacing: 0.5px; }
      .nexo-status-bar { height: 28px; background: #000; border-top: 1px solid #1a1a1a; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; font-size: 11px; font-family: monospace; }
      .nexo-status-left { display: flex; align-items: center; gap: 12px; }
      .nexo-status-phase { color: #00ff88; }
      .nexo-status-mode { color: #ff4444; }
      .nexo-status-id { color: #666; }
      .nexo-status-nexo { color: #fff; font-weight: 700; }
    `;
    document.head.appendChild(style);
  }

  let appContainer = document.getElementById('app');
  if (!appContainer) {
    appContainer = document.createElement('div');
    appContainer.id = 'app';
    appContainer.className = 'nexo-app-container';
    document.body.appendChild(appContainer);
  } else {
    appContainer.className = 'nexo-app-container';
    appContainer.innerHTML = '';
  }

  appContainer.innerHTML = `
    <div class="nexo-header"><h1>NEXO</h1><div id="nexo-header-badge"></div></div>
    <div class="nexo-content" id="nexo-content">
      <div class="nexo-tab active" id="tab-main">
        <div class="nexo-main-screen">
          <div class="nexo-logo-graphic">${SVG_ICONS.logo}</div>
          <div class="nexo-version">NEXO V9.0</div>
        </div>
      </div>
      <div class="nexo-tab" id="tab-ble">
        <div class="nexo-ble-header">
          <div class="nexo-ble-title"><div class="nexo-ble-icon">${SVG_ICONS.ble}</div> BLE Mesh</div>
          <div class="nexo-ble-close" id="btn-ble-close">${SVG_ICONS.close}</div>
        </div>
        <div class="nexo-scan-status">
          <div class="nexo-scan-badge" id="scan-badge" style="display:none">ESCANEANDO...</div>
          <div class="nexo-scan-timer" id="scan-timer"></div>
        </div>
        <div class="nexo-device-list" id="device-list">
          <div class="nexo-device-empty">Buscando dispositivos cercanos...</div>
        </div>
      </div>
      <div class="nexo-tab" id="tab-chat">
        <div class="nexo-chat-header">
          <div class="nexo-chat-avatar" id="chat-avatar">?</div>
          <div class="nexo-chat-meta">
            <div class="nexo-chat-name" id="chat-contact-name">NEXO Device</div>
            <div class="nexo-chat-subtitle" id="chat-contact-subtitle">BLUETOOTH</div>
          </div>
        </div>
        <div class="nexo-chat-messages" id="chat-messages"></div>
        <div class="nexo-chat-input-area">
          <input type="text" class="nexo-chat-input" id="chat-input" placeholder="Mensaje..." />
          <button class="nexo-chat-send" id="chat-send">${SVG_ICONS.send}</button>
        </div>
      </div>
      <div class="nexo-tab" id="tab-settings">
        <div class="nexo-settings-screen">
          <div class="nexo-settings-icon">${SVG_ICONS.settings}</div>
          <div class="nexo-settings-text">Configuración próximamente</div>
        </div>
      </div>
    </div>
    <nav class="nexo-bottom-bar" id="nexo-bottom-bar">
      <button class="nexo-bar-btn" data-tab="chat" id="btn-tab-chat"><div>${SVG_ICONS.chat}</div><span class="nexo-bar-label">CHAT</span></button>
      <button class="nexo-bar-btn active" data-tab="ble" id="btn-tab-ble"><div>${SVG_ICONS.ble}</div><span class="nexo-bar-label">BLE</span></button>
      <button class="nexo-bar-btn" data-tab="settings" id="btn-tab-settings"><div>${SVG_ICONS.settings}</div><span class="nexo-bar-label">AJUSTES</span></button>
    </nav>
    <div class="nexo-status-bar" id="nexo-status-bar">
      <div class="nexo-status-left">
        <span class="nexo-status-nexo">NEXO</span>
        <span class="nexo-status-phase" id="status-phase">INIT</span>
        <span class="nexo-status-mode" id="status-mode">OFFLINE</span>
      </div>
      <span class="nexo-status-id" id="status-id">--</span>
    </div>
  `;

  const tabs = { main: document.getElementById('tab-main'), ble: document.getElementById('tab-ble'), chat: document.getElementById('tab-chat'), settings: document.getElementById('tab-settings') };
  const barBtns = { chat: document.getElementById('btn-tab-chat'), ble: document.getElementById('btn-tab-ble'), settings: document.getElementById('btn-tab-settings') };

  function switchTab(tabName) {
    console.log('[REM-JS-004] switchTab(' + tabName + ') — llamado');
    if (!tabs[tabName]) {
      console.log('[REM-JS-005] switchTab: tab no encontrado:', tabName);
      return;
    }
    state.activeTab = tabName;
    Object.values(tabs).forEach(t => t.classList.remove('active'));
    tabs[tabName].classList.add('active');
    Object.values(barBtns).forEach(b => b.classList.remove('active'));
    if (barBtns[tabName]) barBtns[tabName].classList.add('active');
    if (tabName === 'chat' && state._activeChatDeviceId) updateChatBadge(false);
    if (tabName === 'ble') {
      console.log('[REM-JS-006] switchTab → ble, iniciando scan');
      startScan();
    }
    console.log('[REM-JS-007] switchTab(' + tabName + ') — FIN');
  }

  Object.values(barBtns).forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('btn-ble-close')?.addEventListener('click', () => switchTab('main'));

  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const chatMessages = document.getElementById('chat-messages');

  function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    const msgId = `${Date.now()}-${Math.random().toString(36).substr(2,9)}`;
    console.log('[REM-JS-008] sendChatMessage() msgId=' + msgId + ' len=' + text.length);
    appendChatBubble(text, true, msgId);
    chatInput.value = '';
    window.dispatchEvent(new CustomEvent('nexo:ble:sendMessage', { detail: { content: text, deviceId: state._activeChatDeviceId, messageId: msgId } }));
  }
  chatSend.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });

  function appendChatBubble(text, isOwn, msgId = null) {
    const bubble = document.createElement('div');
    bubble.className = `nexo-chat-bubble ${isOwn ? 'own' : 'other'} pending`;
    if (msgId) bubble.dataset.messageId = msgId;
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubble;
  }

  const deviceListEl = document.getElementById('device-list');
  const scanBadge = document.getElementById('scan-badge');
  const scanTimer = document.getElementById('scan-timer');

  function renderDevices() {
    console.log('[REM-JS-009] renderDevices() — devices.size=' + state.devices.size);
    if (state.devices.size === 0) {
      deviceListEl.innerHTML = '<div class="nexo-device-empty">Buscando dispositivos cercanos...</div>';
      return;
    }
    deviceListEl.innerHTML = '';
    state.devices.forEach((dev, id) => {
      console.log('[REM-JS-010] renderDevices: renderizando id=' + id.substring(0,12) + ' name=' + dev.name);
      const el = document.createElement('div');
      el.className = 'nexo-device-item';
      el.innerHTML = `
        <div class="nexo-device-info">
          <div class="nexo-device-name">${dev.name || 'NEXO Device'}</div>
          <div class="nexo-device-mac">${id.substring(0,12)}</div>
          ${dev.rssi ? `<div class="nexo-device-rssi">${dev.rssi} dBm</div>` : ''}
        </div>
        <div class="nexo-device-add">+</div>
      `;
      el.addEventListener('click', () => {
        console.log('[REM-JS-011] Device clicked: id=' + id.substring(0,12));
        addContact(id, dev.name || `NEXO-${id.substring(0,6).toUpperCase()}`);
        openChat(id, dev.name || `NEXO-${id.substring(0,6).toUpperCase()}`);
      });
      deviceListEl.appendChild(el);
    });
  }

  function addContact(id, name) {
    const normalized = (id || '').toString().toLowerCase().trim().replace(/[^a-f0-9]/g, '');
    if (!normalized) {
      console.log('[REM-JS-012] addContact: id vacío, ignorando');
      return;
    }
    console.log('[REM-JS-013] addContact: normalized=' + normalized.substring(0,12) + ' name=' + name);
    state.contacts.set(normalized, { name, addedAt: Date.now() });
  }

  function openChat(deviceId, name) {
    state._activeChatDeviceId = deviceId;
    document.getElementById('chat-contact-name').textContent = name || 'NEXO Device';
    document.getElementById('chat-contact-subtitle').textContent = 'BLUETOOTH';
    document.getElementById('chat-avatar').textContent = (name || '?').charAt(0).toUpperCase();
    chatMessages.innerHTML = '';
    switchTab('chat');
    console.log('[REM-JS-014] openChat: deviceId=' + deviceId.substring(0,12));
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', { detail: { contactId: deviceId, name, address: deviceId, transport: 'ble' } }));
  }

  function updateChatBadge(show) {
    const badge = document.getElementById('nexo-header-badge');
    if (!badge) return;
    badge.innerHTML = show ? '<span style="background:#ff4444;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">1</span>' : '';
  }

  async function startScan() {
    console.log('[REM-JS-015] startScan() — INICIO isScanning=' + state.isScanning);
    if (state.isScanning) {
      console.log('[REM-JS-016] startScan: ya escaneando, omitiendo');
      return;
    }
    state.isScanning = true;
    state.devices.clear();
    renderDevices();
    scanBadge.style.display = 'block';
    let remaining = state.scanDuration;
    scanTimer.textContent = remaining + 's';
    state.scanTimer = setInterval(() => {
      remaining--;
      scanTimer.textContent = remaining > 0 ? remaining + 's' : '';
      if (remaining <= 0) { clearInterval(state.scanTimer); state.scanTimer = null; }
    }, 1000);

    if (state.nativePlugin?.startScan) {
      try {
        console.log('[REM-JS-017] startScan: llamando nativePlugin.startScan()...');
        await state.nativePlugin.startScan();
        console.log('[REM-JS-018] startScan: nativePlugin.startScan() RESUELTO');
      } catch (e) {
        console.error('[REM-JS-019] startScan: nativePlugin.startScan() ERROR:', e);
      }
    } else {
      console.log('[REM-JS-020] startScan: nativePlugin.startScan NO disponible');
    }

    setTimeout(() => {
      console.log('[REM-JS-021] startScan: auto-stop 15s expirado');
      state.isScanning = false;
      scanBadge.style.display = 'none';
      scanTimer.textContent = '';
    }, state.scanDuration * 1000);
    console.log('[REM-JS-022] startScan() — FIN');
  }

  if (state.nativePlugin?.addListener) {
    console.log('[REM-JS-023] Registrando listeners nativos...');

    const l1 = state.nativePlugin.addListener('onScanResult', (result) => {
      console.log('[REM-JS-024] onScanResult recibido:', JSON.stringify(result));
      const raw = result;
      if (!raw?.deviceId && !raw?.address) {
        console.log('[REM-JS-025] onScanResult: sin deviceId ni address, ignorando');
        return;
      }
      const id = (raw.deviceId || raw.address || '').toLowerCase().replace(/[^a-f0-9]/g, '');
      if (!id) {
        console.log('[REM-JS-026] onScanResult: id vacío tras normalizar');
        return;
      }
      if (state.devices.has(id)) {
        console.log('[REM-JS-027] onScanResult: id ya existe, actualizando RSSI');
        const existing = state.devices.get(id);
        if (raw.rssi != null) existing.rssi = raw.rssi;
        return;
      }
      console.log('[REM-JS-028] onScanResult: NUEVO DISPOSITIVO id=' + id.substring(0,12) + ' name=' + (raw.name || 'NEXO Device'));
      state.devices.set(id, {
        name: raw.name || `NEXO-${id.substring(0,6).toUpperCase()}`,
        address: raw.deviceId || raw.address,
        rssi: raw.rssi,
        foundAt: Date.now()
      });
      renderDevices();
    });
    console.log('[REM-JS-029] Listener onScanResult registrado');

    const l2 = state.nativePlugin.addListener('onMessageReceived', (result) => {
      console.log('[REM-JS-030] onMessageReceived recibido:', JSON.stringify(result));
      const { deviceId, message, senderName, messageId, source, timestamp } = result || {};
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: { deviceId, content: message, senderName, messageId, source, timestamp }
      }));
    });
    console.log('[REM-JS-031] Listener onMessageReceived registrado');

    const l3 = state.nativePlugin.addListener('onAdvertStateChange', (result) => {
      console.log('[REM-JS-032] onAdvertStateChange:', JSON.stringify(result));
    });

    const l4 = state.nativePlugin.addListener('onScanFailed', (result) => {
      console.log('[REM-JS-033] onScanFailed:', JSON.stringify(result));
    });

    const l5 = state.nativePlugin.addListener('bridgeReady', (result) => {
      console.log('[REM-JS-034] bridgeReady:', JSON.stringify(result));
    });

    const l6 = state.nativePlugin.addListener('napAuditEvent', (result) => {
      console.log('[REM-JS-035] napAuditEvent:', JSON.stringify(result));
    });

    state._listeners.push(l1, l2, l3, l4, l5, l6);
    console.log('[REM-JS-036] Total listeners registrados:', state._listeners.length);
  } else {
    console.log('[REM-JS-037] WARNING: nativePlugin.addListener NO disponible');
  }

  window.addEventListener('blePermissionsGranted', () => {
    console.log('[REM-JS-038] Evento blePermissionsGranted recibido');
    if (state.activeTab === 'ble') {
      console.log('[REM-JS-039] blePermissionsGranted → iniciando scan (tab=ble)');
      startScan();
    } else {
      console.log('[REM-JS-040] blePermissionsGranted → tab!=' + state.activeTab + ', esperando tab switch');
    }
  });

  const api = {
    nativePlugin: state.nativePlugin,
    localDeviceAddress: state.localDeviceAddress,
    getContactName: (id) => {
      const n = (id||'').toString().toLowerCase().trim().replace(/[^a-f0-9]/g,'');
      return state.contacts.get(n)?.name || null;
    },
    showMainScreen: () => switchTab('main'),
    switchTab,
    startScan,
    addContact,
    openChat,
    appendChatBubble,
    confirmChatMessage: (msgId) => {
      console.log('[REM-JS-041] confirmChatMessage: msgId=' + msgId);
      const el = chatMessages.querySelector(`[data-message-id="${msgId}"]`);
      if (el) { el.classList.remove('pending'); el.classList.add('confirmed'); }
    },
    updateStatus: (phase, mode, id) => {
      console.log('[REM-JS-042] updateStatus: phase=' + phase + ' mode=' + mode + ' id=' + (id || '--').substring(0,6));
      const p = document.getElementById('status-phase');
      const m = document.getElementById('status-mode');
      const i = document.getElementById('status-id');
      if (p) p.textContent = phase || 'INIT';
      if (m) { m.textContent = mode || 'OFFLINE'; m.style.color = mode === 'READY' || mode === 'P2P_BLE' ? '#00ff88' : mode === 'OFFLINE' ? '#ff4444' : '#ffaa00'; }
      if (i) i.textContent = (id || '--').substring(0,6);
    },
    destroy: () => {
      console.log('[REM-JS-043] destroy() llamado');
      if (state.scanTimer) clearInterval(state.scanTimer);
      state._listeners.forEach(l => l?.remove?.());
      state._listeners = [];
      const s = document.getElementById('nexo-ble-interface-styles');
      if (s) s.remove();
    }
  };

  _globalInterface = api;
  console.log('[REM-JS-044] initBLEInterface() — FIN. API expuesta.');
  return api;
}

export function getGlobalBLEInterface() { return _globalInterface; }
