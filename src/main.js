/**
 * main.js v9.6-FINAL
 * FIX: Escucha nexo:ble:deviceFound, battery exemption, toggle scan robusto.
 */

const $ = (s) => document.querySelector(s);
const els = {
  splash: $('#splash-native'),
  btnSend: $('#btn-send'),
  btnBleScan: $('#btn-ble-scan'),
  bleDevicesList: $('#ble-devices-list'),
  bleEmpty: $('#ble-empty'),
};

let bleInterface = null;
let nexoApp = null;
let isScanning = false;

// ===== RENDER DEVICE =====
function renderDevice(device) {
  const list = els.bleDevicesList;
  const empty = els.bleEmpty;
  if (empty) empty.style.display = 'none';

  const id = device.deviceId || device.address || 'unknown';
  const name = device.name || 'NEXO Device';
  const rssi = device.rssi || 0;

  // Evitar duplicados
  if (document.querySelector(`[data-ble-id="${id}"]`)) return;

  const item = document.createElement('div');
  item.className = 'ble-device-item';
  item.setAttribute('data-ble-id', id);
  item.innerHTML = `
    <div class="ble-device-info">
      <span class="ble-device-name">${name}</span>
      <span class="ble-device-id">${id.substring(0, 8)}...</span>
      <span class="ble-device-rssi">${rssi} dBm</span>
    </div>
    <div class="ble-device-actions">
      <button class="ble-btn-add" onclick="addContact('${id}')">Agregar</button>
      <button class="ble-btn-chat" onclick="openChat('${id}', '${name}')">Chat</button>
    </div>
  `;
  list.appendChild(item);
  console.log(`[MAIN] Device rendered: ${name} (${id})`);
}

function addContact(deviceId) {
  console.log(`[MAIN] addContact: ${deviceId}`);
  if (bleInterface?.addContact) bleInterface.addContact(deviceId);
}

function openChat(deviceId, name) {
  console.log(`[MAIN] openChat: ${deviceId}`);
  window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
    detail: { deviceId, name }
  }));
}

// ===== BLE SCAN TOGGLE =====
async function doScan() {
  if (isScanning) {
    console.log('[MAIN] Deteniendo scan...');
    isScanning = false;
    els.btnBleScan.textContent = 'Escanear';
    els.btnBleScan.classList.remove('scanning');
    try {
      if (bleInterface?.stopBleScan) await bleInterface.stopBleScan();
      else await window.Capacitor.Plugins.NexoBLE.stopScan();
    } catch (e) { console.warn('[MAIN] stopScan error:', e.message); }
    return;
  }

  console.log('[MAIN] Iniciando scan...');
  isScanning = true;
  els.btnBleScan.textContent = 'Detener';
  els.btnBleScan.classList.add('scanning');
  els.bleDevicesList.innerHTML = '';
  if (els.bleEmpty) els.bleEmpty.style.display = 'block';

  try {
    if (bleInterface?.startBleScan) await bleInterface.startBleScan();
    else await window.Capacitor.Plugins.NexoBLE.startScan();
    console.log('[MAIN] Scan iniciado OK');
  } catch (err) {
    console.error('[MAIN] Scan falló:', err.message);
    isScanning = false;
    els.btnBleScan.textContent = 'Escanear';
    els.btnBleScan.classList.remove('scanning');
  }
}

// ===== INICIALIZACIÓN =====
async function init() {
  console.log('[MAIN] Iniciando...');

  let waited = 0;
  while (!window.Capacitor && waited < 3000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  console.log(`[MAIN] Capacitor: ${window.Capacitor ? 'OK' : 'NO'}`);

  // FIX: Solicitar exención de batería para Samsung (Adaptive Battery mata foreground services)
  try {
    const plugin = window.Capacitor?.Plugins?.NexoBLE;
    if (plugin?.requestBatteryOptimizationExemption) {
      const battResult = await plugin.requestBatteryOptimizationExemption();
      console.log(`[MAIN] Battery exemption: ${JSON.stringify(battResult)}`);
    }
  } catch (e) {
    console.warn(`[MAIN] Battery exemption no disponible: ${e.message}`);
  }

  // Importar ble_interface.js
  try {
    console.log('[MAIN] Importando ble_interface...');
    const { initBLEInterface } = await import('./ui/ble_interface.js');
    bleInterface = await initBLEInterface();
    console.log('[MAIN] ble_interface OK');
  } catch (e) {
    console.warn(`[MAIN] ble_interface falló: ${e.message}`);
    bleInterface = null;
  }

  // FIX CRÍTICO: Escuchar dispositivos encontrados via evento DOM de ble_interface.js
  window.addEventListener('nexo:ble:deviceFound', (e) => {
    const device = e.detail;
    console.log('[MAIN] nexo:ble:deviceFound received:', device);
    renderDevice(device);
  });

  // Importar nexo_app.js
  try {
    console.log('[MAIN] Importando nexo_app...');
    const { createNexoApp } = await import('./app/nexo_app.js');
    nexoApp = await createNexoApp({
      onMessage: (msg) => {
        if (msg.source === 'ble_direct') appendBubble(msg.content, false, msg.messageId);
      }
    });
    console.log('[MAIN] NEXO App OK');
  } catch (e) {
    console.warn(`[MAIN] nexo_app falló: ${e.message}`);
  }

  // SetupWizard
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
  setTimeout(() => {
    if (els.splash) {
      els.splash.style.opacity = '0';
      setTimeout(() => els.splash?.remove(), 500);
    }
  }, 1000);

  // Event listeners UI
  els.btnBleScan?.addEventListener('click', doScan);
  els.btnSend?.addEventListener('click', async () => {
    try {
      const content = $('#message-input')?.value || '';
      const recipient = nexoApp?.activeContact?.rawAddress || nexoApp?.activeContact?.id || '';
      await nexoApp?.sendMessage({ content, recipient, transport: 'ble' });
      $('#message-input').value = '';
    } catch (e) {
      console.error(`[MAIN] Send error: ${e.message}`);
    }
  });
}

try { init(); } catch (e) { console.error(`[MAIN] FATAL: ${e.message}`); }

