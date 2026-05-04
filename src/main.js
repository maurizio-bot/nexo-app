/**
 * main.js - Cableado NEXO v9.0
 * Conecta: SetupWizard → ble_interface.js → nexo_app.js → HTML
 */

import { SetupWizard } from './ui/SetupWizard.js';
import { createNexoApp } from './app/nexo_app.js';
import { initBLEInterface, startBleScan, stopBleScan } from './ui/ble_interface.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Referencias DOM
const els = {
  splash: $('#splash-native'),
  app: $('#app'),
  views: $$('.view'),
  navBtns: $$('.nav-btn'),
  messagesContainer: $('#messages-container'),
  messageInput: $('#message-input'),
  sendBtn: $('#send-btn'),
  bleDevicesList: $('#ble-devices-list'),
  btnBleScan: $('#btn-ble-scan'),
  chatContactName: $('#chat-contact-name'),
  sbPhase: $('#sb-phase'),
  sbMode: $('#sb-mode'),
  sbId: $('#sb-id'),
};

let nexoApp = null;
let currentView = 'home';
let isScanning = false;

// ==================== NAVEGACIÓN ====================
function switchView(name) {
  currentView = name;
  els.views.forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`${name}-view`);
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

  // BLE: al entrar, mostrar estado
  if (name === 'ble') {
    if (!isScanning && els.bleDevicesList.children.length === 0) {
      els.bleDevicesList.innerHTML = '<div class="ble-empty">Toca ⟳ Escanear para buscar dispositivos</div>';
    }
  }
}

els.navBtns.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ==================== CHAT ====================
els.sendBtn.addEventListener('click', sendMessage);
els.messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

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

// ==================== BLE SCAN (vía ble_interface.js) ====================
els.btnBleScan.addEventListener('click', async () => {
  if (isScanning) {
    await stopBleScan();
    isScanning = false;
    els.btnBleScan.textContent = '⟳ Escanear';
    return;
  }

  els.bleDevicesList.innerHTML = '<div class="ble-empty">Escaneando...</div>';
  els.btnBleScan.textContent = '⏹ Detener';
  isScanning = true;

  try {
    await startBleScan(
      (device) => renderBleDevice(device), // onDeviceFound
      (error) => { // onError
        console.error('[BLE_SCAN_ERROR]', error);
        els.bleDevicesList.innerHTML = `<div class="ble-empty">Error: ${error.description}</div>`;
        isScanning = false;
        els.btnBleScan.textContent = '⟳ Escanear';
      }
    );
  } catch (err) {
    console.error('[BLE_SCAN]', err);
    els.bleDevicesList.innerHTML = `<div class="ble-empty">Error: ${err.message}</div>`;
    isScanning = false;
    els.btnBleScan.textContent = '⟳ Escanear';
  }
});

function renderBleDevice(device) {
  // Quitar "Escaneando..." si es el primer dispositivo
  const empty = els.bleDevicesList.querySelector('.ble-empty');
  if (empty) empty.remove();

  // Actualizar si ya existe
  const existing = document.querySelector(`[data-addr="${device.address}"]`);
  if (existing) {
    existing.querySelector('.ble-device-rssi').textContent = `${device.rssi} dBm`;
    return;
  }

  const item = document.createElement('div');
  item.className = 'ble-device';
  item.dataset.addr = device.address;
  item.innerHTML = `
    <div>
      <div class="ble-device-name">${device.name || 'Dispositivo desconocido'}</div>
      <div class="ble-device-meta">${device.address}</div>
    </div>
    <div class="ble-device-rssi">${device.rssi} dBm</div>
  `;

  item.addEventListener('click', () => {
    // Disparar evento para nexo_app.js
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: {
        contactId: device.address,
        name: device.name || 'NEXO Peer',
        address: device.address,
        transport: 'ble'
      }
    }));
    switchView('chat');
  });

  els.bleDevicesList.appendChild(item);
}

// ==================== INICIALIZACIÓN ====================
async function init() {
  try {
    // PASO 1: SetupWizard (permisos BLE)
    console.log('[INIT] Iniciando SetupWizard...');
    await new Promise((resolve) => {
      const wizard = new SetupWizard('app', resolve);
      wizard.start();
    });
    console.log('[INIT] SetupWizard completado.');

    // PASO 2: Inicializar BLE Interface (listeners nativos)
    console.log('[INIT] Inicializando BLE Interface...');
    await initBLEInterface();

    // PASO 3: Crear NEXO App
    console.log('[INIT] Creando NEXO App...');
    nexoApp = await createNexoApp({
      onMessage: (msg) => {
        if (msg.source === 'ble_direct') {
          appendBubble(msg.content, false, msg.messageId);
        }
      },
      onStatusChange: (status) => {
        if (status.startsWith('CHAT:')) {
          els.chatContactName.value = status.replace('CHAT:', '');
        }
        els.sbPhase.textContent = 'READY';
        els.sbMode.textContent = (status.includes('ONLINE') || status.includes('P2P')) ? 'ONLINE' : 'OFFLINE';
        if (status.includes('ONLINE')) els.sbMode.classList.add('online');
      }
    });

    if (nexoApp._deviceUUID) {
      els.sbId.textContent = nexoApp._deviceUUID.substring(0, 6);
    }

    // PASO 4: Ocultar splash
    setTimeout(() => {
      els.splash.style.opacity = '0';
      setTimeout(() => els.splash.remove(), 500);
    }, 1500);

    // PASO 5: Mostrar home
    switchView('home');

  } catch (err) {
    console.error('[INIT] Error:', err);
    $('#fatal-error').style.display = 'flex';
    $('#fatal-code').textContent = err.message;
  }
}

// Iniciar cuando Capacitor esté listo
if (window.Capacitor) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
