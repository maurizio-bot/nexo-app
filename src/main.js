import { createNexoApp } from './app/nexo_app.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const els = {
  splash: $('#splash-native'),
  app: $('#app'),
  views: $$('.view'),
  navBtns: $$('.nav-btn'),
  messagesContainer: $('#messages-container'),
  messageInput: $('#message-input'),
  sendBtn: $('#send-btn'),
  bleDevicesList: $('#ble-devices-list'),
  chatContactName: $('#chat-contact-name'),
  sbPhase: $('#sb-phase'),
  sbMode: $('#sb-mode'),
  sbId: $('#sb-id'),
};

let nexoApp = null;
let currentView = 'home';
let bleScanListener = null;

// ===== NAVEGACIÓN =====
function switchView(name) {
  currentView = name;
  els.views.forEach(v => v.classList.remove('active'));
  const target = $(`#${name}-view`);
  if (target) target.classList.add('active');

  els.navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  // Chat activo: mostrar input
  if (name === 'chat' && nexoApp?.activeContact) {
    els.app.classList.add('chat-active');
  } else {
    els.app.classList.remove('chat-active');
  }

  // Si es BLE y venimos del botón nav, iniciar escaneo automático
  if (name === 'ble') {
    startBleScan();
  }
}

els.navBtns.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ===== CHAT =====
els.sendBtn.addEventListener('click', sendMessage);
els.messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

async function sendMessage() {
  const content = els.messageInput.value.trim();
  if (!content || !nexoApp?.activeContact) return;
  appendBubble(content, true);
  await nexoApp.sendMessage({ content, recipient: nexoApp.activeContact.id, transport: 'ble' });
  els.messageInput.value = '';
}

function appendBubble(content, isOwn, mid = null) {
  const b = document.createElement('div');
  b.className = `message ${isOwn ? 'own' : 'other'}`;
  b.innerHTML = `<div>${content}</div><div class="message-meta"><span>${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>${isOwn?'<span>✓</span>':''}</div>`;
  if (mid) b.dataset.messageId = mid;
  els.messagesContainer.appendChild(b);
  els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

// ===== BLE SCAN =====
async function startBleScan() {
  if (!window.Capacitor?.Plugins?.NexoBLE) {
    els.bleDevicesList.innerHTML = '<div class="ble-empty">BLE no disponible en este dispositivo</div>';
    return;
  }
  els.bleDevicesList.innerHTML = '<div class="ble-empty">Escaneando...</div>';

  try {
    const plugin = window.Capacitor.Plugins.NexoBLE;
    if (bleScanListener) { bleScanListener.remove(); bleScanListener = null; }

    bleScanListener = await plugin.addListener('onScanResult', (result) => {
      renderBleDevice(result);
    });

    await plugin.startScan();

    setTimeout(async () => {
      try { await plugin.stopScan(); } catch (e) {}
      if (bleScanListener) { bleScanListener.remove(); bleScanListener = null; }
    }, 15000);

  } catch (err) {
    els.bleDevicesList.innerHTML = `<div class="ble-empty">Error: ${err.message}</div>`;
  }
}

function renderBleDevice(device) {
  const existing = document.querySelector(`[data-addr="${device.address}"]`);
  if (existing) {
    existing.querySelector('.ble-device-rssi').textContent = `${device.rssi} dBm`;
    return;
  }
  const item = document.createElement('div');
  item.className = 'ble-device';
  item.dataset.addr = device.address;
  item.innerHTML = `
    <div><div class="ble-device-name">${device.name || 'Dispositivo desconocido'}</div>
    <div class="ble-device-meta">${device.address}</div></div>
    <div class="ble-device-rssi">${device.rssi} dBm</div>
  `;
  item.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: { contactId: device.address, name: device.name || 'NEXO Peer', address: device.address, transport: 'ble' }
    }));
    switchView('chat');
  });
  const empty = els.bleDevicesList.querySelector('.ble-empty');
  if (empty) empty.remove();
  els.bleDevicesList.appendChild(item);
}

// ===== INICIALIZACIÓN =====
async function init() {
  try {
    nexoApp = await createNexoApp({
      onMessage: (msg) => {
        if (msg.source === 'ble_direct') appendBubble(msg.content, false, msg.messageId);
      },
      onStatusChange: (status) => {
        if (status.startsWith('CHAT:')) els.chatContactName.value = status.replace('CHAT:', '');
        els.sbPhase.textContent = 'READY';
        els.sbMode.textContent = (status.includes('ONLINE') || status.includes('P2P')) ? 'ONLINE' : 'OFFLINE';
        if (status.includes('ONLINE')) els.sbMode.classList.add('online');
      }
    });

    if (nexoApp._deviceUUID) els.sbId.textContent = nexoApp._deviceUUID.substring(0, 6);

    window.addEventListener('nexo:ble:openChat', (e) => {
      els.chatContactName.value = e.detail.name;
      els.app.classList.add('chat-active');
      switchView('chat');
    });

    setTimeout(() => {
      els.splash.style.opacity = '0';
      setTimeout(() => els.splash.remove(), 500);
    }, 2000);

    switchView('home');

  } catch (err) {
    console.error('Init error:', err);
    $('#fatal-error').style.display = 'flex';
    $('#fatal-code').textContent = err.message;
  }
}

if (window.Capacitor) init(); else document.addEventListener('DOMContentLoaded', init);
