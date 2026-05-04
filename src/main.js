/**
 * main.js v9.5-FINAL
 * Fix: toggle escanear/detener + battery exemption Samsung + sin diagnóstico visual
 */

const $ = (s) => document.querySelector(s);
const els = {
  splash: $('#splash-native'),
  app: $('#app'),
  views: document.querySelectorAll('.view'),
  navBtns: document.querySelectorAll('.nav-btn'),
  messagesContainer: $('#messages-container'),
  messageInput: $('#message-input'),
  sendBtn: $('#send-btn'),
  bleDevicesList: $('#ble-devices-list'),
  btnBleScan: $('#btn-ble-scan'),
  chatContactName: $('#chat-contact-name'),
  sbPhase: $('#sb-phase'),
  sbMode: $('#sb-mode'),
  sbId: $('#sb-id'),
  setupWizard: $('#setup-wizard'),
};

let currentView = 'ble';
let isScanning = false;
let nexoApp = null;
let bleInterface = null;
let scanAutoStopTimer = null;

function switchView(name) {
  currentView = name;
  els.views.forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`${name}-view`);
  if (target) target.classList.add('active');
  els.navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
  if (name === 'chat' && nexoApp?.activeContact) els.app.classList.add('chat-active');
  else els.app.classList.remove('chat-active');
}

els.navBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

els.sendBtn?.addEventListener('click', async () => {
  const content = els.messageInput.value.trim();
  if (!content || !nexoApp?.activeContact) return;
  appendBubble(content, true);
  try {
    const recipient = nexoApp.activeContact.rawAddress || nexoApp.activeContact.id || nexoApp.activeContact.address || '';
    await nexoApp.sendMessage({ content, recipient, transport: 'ble' });
  } catch (e) { console.error(`[MAIN] Send error: ${e.message}`); }
  els.messageInput.value = '';
});

els.messageInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') els.sendBtn?.click(); });

function appendBubble(content, isOwn, mid = null) {
  const b = document.createElement('div');
  b.className = `message ${isOwn ? 'own' : 'other'}`;
  b.innerHTML = `<div>${content}</div><div class="message-meta"><span>${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>${isOwn?'<span>✓</span>':''}</div>`;
  if (mid) b.dataset.messageId = mid;
  els.messagesContainer.appendChild(b);
  els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

function renderDevice(device) {
  const existing = document.querySelector(`[data-addr="${device.address}"]`);
  if (existing) { existing.querySelector('.ble-device-rssi').textContent = `${device.rssi} dBm`; return; }
  const item = document.createElement('div');
  item.className = 'ble-device';
  item.dataset.addr = device.address;
  item.innerHTML = `<div><div class="ble-device-name">${device.name || 'Desconocido'}</div><div class="ble-device-addr">${device.address}</div></div><div class="ble-device-rssi">${device.rssi} dBm</div>`;
  item.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: { contactId: device.address, name: device.name || 'NEXO Peer', address: device.address, transport: 'ble' }
    }));
    switchView('chat');
  });
  els.bleDevicesList.appendChild(item);
}

// ===== BLE SCAN TOGGLE =====
async function doScan() {
  if (isScanning) {
    console.log('[MAIN] Deteniendo scan...');
    if (scanAutoStopTimer) { clearTimeout(scanAutoStopTimer); scanAutoStopTimer = null; }
    try { 
      if (bleInterface?.stopBleScan) await bleInterface.stopBleScan();
      else if (window.Capacitor?.Plugins?.NexoBLE) await window.Capacitor.Plugins.NexoBLE.stopScan();
    } catch (e) {}
    isScanning = false;
    els.btnBleScan.textContent = '⟳ Escanear';
    els.btnBleScan.classList.remove('scanning');
    return;
  }

  els.bleDevicesList.innerHTML = '<div class="ble-empty">Escaneando...</div>';
  els.btnBleScan.textContent = '⏹ Detener';
  els.btnBleScan.classList.add('scanning');
  isScanning = true;
  console.log('[MAIN] Scan iniciado');

  try {
    if (bleInterface?.startBleScan) {
      await bleInterface.startBleScan();
    }
    else if (window.Capacitor?.Plugins?.NexoBLE) {
      await window.Capacitor.Plugins.NexoBLE.startScan();
    }
    else {
      console.warn('[MAIN] BLE no disponible');
      isScanning = false;
      els.btnBleScan.textContent = '⟳ Escanear';
      els.btnBleScan.classList.remove('scanning');
      return;
    }
    scanAutoStopTimer = setTimeout(() => {
      if (isScanning) doScan();
    }, 15000);
  } catch (err) {
    console.error(`[MAIN] Scan falló: ${err.message}`);
    isScanning = false;
    els.btnBleScan.textContent = '⟳ Escanear';
    els.btnBleScan.classList.remove('scanning');
  }
}

els.btnBleScan?.addEventListener('click', doScan);

// ===== INICIALIZACIÓN =====
async function init() {
  console.log('[MAIN] Iniciando...');

  let waited = 0;
  while (!window.Capacitor && waited < 3000) { await new Promise(r => setTimeout(r, 100)); waited += 100; }
  console.log(`[MAIN] Capacitor: ${window.Capacitor ? 'OK' : 'NO'}`);

  // FIX CRITICO: Solicitar exención de batería para Samsung (Adaptive Battery mata foreground services)
  try {
    const plugin = window.Capacitor?.Plugins?.NexoBLE;
    if (plugin?.requestBatteryOptimizationExemption) {
      const battResult = await plugin.requestBatteryOptimizationExemption();
      console.log(`[MAIN] Battery exemption: ${JSON.stringify(battResult)}`);
    }
  } catch (e) {
    console.warn(`[MAIN] Battery exemption no disponible: ${e.message}`);
  }

  try {
    console.log('[MAIN] Importando ble_interface...');
    bleInterface = await import('./ui/ble_interface.js');
    console.log('[MAIN] ble_interface OK');
    
    window.addEventListener('nexo:ble:deviceFound', (e) => {
      const device = e.detail;
      const empty = els.bleDevicesList.querySelector('.ble-empty');
      if (empty && empty.textContent === 'Escaneando...') empty.remove();
      else if (empty) empty.remove();
      renderDevice(device);
    });
    
    if (bleInterface.initBLEInterface) {
      await bleInterface.initBLEInterface();
      console.log('[MAIN] BLE listeners activos');
    }
  } catch (e) {
    console.warn(`[MAIN] ble_interface falló: ${e.message}`);
    bleInterface = null;
  }

  try {
    console.log('[MAIN] Importando nexo_app...');
    const { createNexoApp } = await import('./app/nexo_app.js');
    nexoApp = await createNexoApp({
      onMessage: (msg) => { if (msg.source === 'ble_direct') appendBubble(msg.content, false, msg.messageId); },
      onStatusChange: (status) => {
        if (status.startsWith('CHAT:')) els.chatContactName.value = status.replace('CHAT:', '');
        els.sbPhase.textContent = 'READY';
        els.sbMode.textContent = (status.includes('ONLINE') || status.includes('P2P')) ? 'ONLINE' : 'OFFLINE';
      }
    });
    if (nexoApp._deviceUUID) els.sbId.textContent = nexoApp._deviceUUID.substring(0, 6);
    console.log('[MAIN] NEXO App OK');
  } catch (e) {
    console.warn(`[MAIN] nexo_app falló: ${e.message}`);
  }

  try {
    console.log('[MAIN] SetupWizard...');
    const { SetupWizard } = await import('./ui/SetupWizard.js');
    await new Promise((resolve) => {
      const wizard = new SetupWizard('app', resolve);
      wizard.start().catch(() => resolve());
      setTimeout(resolve, 8000);
    });
    console.log('[MAIN] Wizard OK');
  } catch (e) {
    console.warn(`[MAIN] Wizard saltado: ${e.message}`);
  }

  console.log('[MAIN] Listo');
  setTimeout(() => { if (els.splash) { els.splash.style.opacity = '0'; setTimeout(() => els.splash?.remove(), 500); } }, 1000);
  switchView('ble');
}

try { init(); } catch (e) { console.error(`[MAIN] FATAL: ${e.message}`); }
