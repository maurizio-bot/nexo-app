/**
 * main.js v9.3-FINAL
 * Fix botón escanear: toggle correcto + listener nexo:ble:deviceFound
 * Feedback visual: pulse glow al escanear, escala al pulsar
 */

function screenLog(msg, type = 'info') {
  console.log(`[MAIN] ${msg}`);
  let diag = document.getElementById('nexo-diagnostic');
  if (!diag) {
    diag = document.createElement('div');
    diag.id = 'nexo-diagnostic';
    diag.style.cssText = 'position:fixed;top:60px;left:10px;right:10px;max-height:180px;background:rgba(0,0,0,0.95);color:#00ff88;font-family:monospace;font-size:11px;overflow-y:auto;z-index:100000;padding:10px;border-radius:8px;border:1px solid rgba(0,255,136,0.3);';
    document.body.appendChild(diag);
  }
  const color = type === 'error' ? '#ff4444' : type === 'warn' ? '#ffaa00' : '#00ff88';
  diag.innerHTML += `<div style="color:${color};border-bottom:1px solid rgba(255,255,255,0.1);padding:2px 0;">${new Date().toLocaleTimeString()} ${msg}</div>`;
  diag.scrollTop = diag.scrollHeight;
}

screenLog('main.js v9.3 iniciado', 'info');

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
  } catch (e) { screenLog(`Send error: ${e.message}`, 'error'); }
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
  screenLog(`Encontrado: ${device.name || 'Desconocido'}`, 'info');
}

// ===== BLE SCAN TOGGLE =====
async function doScan() {
  if (isScanning) {
    screenLog('Deteniendo scan...', 'info');
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
  screenLog('Scan iniciado', 'info');

  try {
    if (bleInterface?.startBleScan) {
      await bleInterface.startBleScan();
    }
    else if (window.Capacitor?.Plugins?.NexoBLE) {
      await window.Capacitor.Plugins.NexoBLE.startScan();
    }
    else {
      screenLog('BLE no disponible', 'warn');
      isScanning = false;
      els.btnBleScan.textContent = '⟳ Escanear';
      els.btnBleScan.classList.remove('scanning');
      return;
    }
    scanAutoStopTimer = setTimeout(() => {
      if (isScanning) doScan();
    }, 15000);
  } catch (err) {
    screenLog(`Scan falló: ${err.message}`, 'error');
    isScanning = false;
    els.btnBleScan.textContent = '⟳ Escanear';
    els.btnBleScan.classList.remove('scanning');
  }
}

els.btnBleScan?.addEventListener('click', doScan);

// ===== INICIALIZACIÓN =====
async function init() {
  screenLog('Iniciando...', 'info');

  let waited = 0;
  while (!window.Capacitor && waited < 3000) { await new Promise(r => setTimeout(r, 100)); waited += 100; }
  screenLog(`Capacitor: ${window.Capacitor ? 'OK' : 'NO'}`, window.Capacitor ? 'info' : 'warn');

  try {
    screenLog('Importando ble_interface...', 'info');
    bleInterface = await import('./ui/ble_interface.js');
    screenLog('ble_interface OK', 'info');
    
    window.addEventListener('nexo:ble:log', (e) => {
      screenLog(`[BLE_IF] ${e.detail.msg}`, e.detail.type);
    });
    
    // FIX CRITICO: Escuchar dispositivos encontrados via evento DOM de ble_interface.js
    window.addEventListener('nexo:ble:deviceFound', (e) => {
      const device = e.detail;
      const empty = els.bleDevicesList.querySelector('.ble-empty');
      if (empty && empty.textContent === 'Escaneando...') empty.remove();
      else if (empty) empty.remove();
      renderDevice(device);
    });
    
    if (bleInterface.initBLEInterface) {
      await bleInterface.initBLEInterface();
      screenLog('BLE listeners activos', 'info');
    }
  } catch (e) {
    screenLog(`ble_interface falló: ${e.message}`, 'warn');
    bleInterface = null;
  }

  try {
    screenLog('Importando nexo_app...', 'info');
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
    screenLog('NEXO App OK', 'info');
  } catch (e) {
    screenLog(`nexo_app falló: ${e.message}`, 'warn');
  }

  try {
    screenLog('SetupWizard...', 'info');
    const { SetupWizard } = await import('./ui/SetupWizard.js');
    await new Promise((resolve) => {
      const wizard = new SetupWizard('app', resolve);
      wizard.start().catch(() => resolve());
      setTimeout(resolve, 8000);
    });
    screenLog('Wizard OK', 'info');
  } catch (e) {
    screenLog(`Wizard saltado: ${e.message}`, 'warn');
  }

  screenLog('Listo', 'info');
  setTimeout(() => { if (els.splash) { els.splash.style.opacity = '0'; setTimeout(() => els.splash?.remove(), 500); } }, 1000);
  switchView('ble');
}

try { init(); } catch (e) { screenLog(`FATAL: ${e.message}`, 'error'); }
