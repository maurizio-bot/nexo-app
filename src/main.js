/**
 * main.js v10.2-ARCH
 * FIX: UI estética unificada. Dispositivo = botón único. Click = agregar + chat automático.
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

/* ---------- NUEVO: Click único en dispositivo ---------- */
window.handleDeviceClick = function(deviceId, name) {
  console.log(`[MAIN] handleDeviceClick: ${name} (${deviceId})`);
  if (bleInterface?.addContact) bleInterface.addContact(deviceId);
  window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
    detail: { deviceId, name }
  }));
};

function renderDevice(device) {
  const list = els.bleDevicesList;
  const empty = els.bleEmpty;
  if (empty) empty.style.display = 'none';

  const id = device.deviceId || device.address || 'unknown';
  const name = (device.name || 'NEXO Device').replace(/'/g, "\\'");
  const rssi = device.rssi || 0;

  // Si ya existe, actualiza RSSI en el atributo (opcional para debug)
  const existing = document.querySelector(`[data-ble-id="${id}"]`);
  if (existing) {
    existing.setAttribute('data-rssi', rssi);
    return;
  }

  const item = document.createElement('div');
  item.className = 'ble-device-card';
  item.setAttribute('data-ble-id', id);
  item.setAttribute('data-rssi', rssi);
  item.setAttribute('onclick', `handleDeviceClick('${id}', '${name}')`);
  item.innerHTML = `
    <div class="ble-device-name-btn">${name}</div>
    <div class="ble-device-signal">
      <span class="ble-signal-bar"></span>
      <span class="ble-signal-bar"></span>
      <span class="ble-signal-bar"></span>
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

  console.log('[MAIN] Iniciando scan manual...');
  isScanning = true;
  els.btnBleScan.textContent = 'Detener';
  els.btnBleScan.classList.add('scanning');

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

async function init() {
  console.log('[MAIN] Iniciando v10.2-ARCH...');

  let waited = 0;
  while (!window.Capacitor && waited < 3000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  console.log(`[MAIN] Capacitor: ${window.Capacitor ? 'OK' : 'NO'}`);

  // 1. Anti-Samsung: Exención de batería
  try {
    const blePlugin = window.Capacitor?.Plugins?.NexoBLE;
    if (blePlugin?.requestBatteryOptimizationExemption) {
      const batt = await blePlugin.requestBatteryOptimizationExemption();
      console.log(`[MAIN] Battery exemption: ${JSON.stringify(batt)}`);
    }
  } catch (e) {
    console.warn(`[MAIN] Battery exemption: ${e.message}`);
  }

  // 2. Anti-Samsung: KeepAliveService
  try {
    const nearbyPlugin = window.Capacitor?.Plugins?.NexoNearby;
    if (nearbyPlugin?.startKeepAliveService) {
      await nearbyPlugin.startKeepAliveService();
      console.log('[MAIN] KeepAliveService iniciado');
    }
  } catch (e) {
    console.warn(`[MAIN] KeepAliveService: ${e.message}`);
  }

  // 3. Importar ble_interface híbrida
  try {
    console.log('[MAIN] Importando ble_interface híbrida...');
    const { initBLEInterface } = await import('./ui/ble_interface.js');
    bleInterface = await initBLEInterface();
    console.log('[MAIN] ble_interface híbrida OK');
  } catch (e) {
    console.warn(`[MAIN] ble_interface falló: ${e.message}`);
    bleInterface = null;
  }

  // 4. Escuchar dispositivos (BLE o Nearby)
  window.addEventListener('nexo:ble:deviceFound', (e) => {
    const device = e.detail;
    console.log('[MAIN] nexo:ble:deviceFound:', device);
    renderDevice(device);
  });

  // 5. Importar nexo_app
  try {
    console.log('[MAIN] Importando nexo_app...');
    const { createNexoApp } = await import('./app/nexo_app.js');
    nexoApp = await createNexoApp({
      onMessage: (msg) => {
        if (msg.source === 'ble_direct' || msg.source === 'nearby') {
          appendBubble(msg.content, false, msg.messageId);
        }
      }
    });
    console.log('[MAIN] NEXO App OK');
  } catch (e) {
    console.warn(`[MAIN] nexo_app falló: ${e.message}`);
  }

  // 6. SetupWizard
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
