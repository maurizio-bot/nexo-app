/**
 * main.js v10.3-FIX
 * FIX: Inicializa permissionShim ANTES de ble_interface.
 * Integra panel BLE Mesh de ble_interface.js.
 * Botones funcionales con fallback nativo.
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

/* ---------- NUEVO: Click unico en dispositivo ---------- */
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
  const name = (device.name || 'NEXO Device').replace(/'/g, "\'");
  const rssi = device.rssi || 0;

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
    <div class="ble-device-name">${name}</div>
    <div class="ble-device-rssi">${rssi} dBm</div>
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
    console.error('[MAIN] Scan fallo:', err.message);
    isScanning = false;
    els.btnBleScan.textContent = 'Escanear';
    els.btnBleScan.classList.remove('scanning');
  }
}

async function init() {
  console.log('[MAIN] Iniciando v10.3-FIX...');

  let waited = 0;
  while (!window.Capacitor && waited < 3000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  console.log(`[MAIN] Capacitor: ${window.Capacitor ? 'OK' : 'NO'}`);

  // FIX v10.3: Inicializar permissionShim ANTES que todo
  try {
    console.log('[MAIN] Inicializando permissionShim...');
    const { permissionShim } = await import('./core/NexoPermissionShim.js');
    window.permissionShim = permissionShim;
    await permissionShim.init();
    console.log('[MAIN] permissionShim inicializado OK');
  } catch (e) {
    console.warn(`[MAIN] permissionShim fallo: ${e.message}`);
    // Fallback: crear shim minimo en memoria
    window.permissionShim = {
      ensurePermissions: async () => {
        try {
          const plugin = window.Capacitor?.Plugins?.NexoBLE;
          if (!plugin) return { success: false };
          const status = await plugin.checkBLEStatus();
          if (status?.allGranted || status?.granted) return { success: true };
          await plugin.initializeBLE();
          await new Promise(r => setTimeout(r, 800));
          const final = await plugin.checkBLEStatus();
          return { success: !!(final?.allGranted || final?.granted) };
        } catch (e) {
          return { success: false };
        }
      }
    };
  }

  // 1. Anti-Samsung: Exencion de bateria
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

  // 3. Importar ble_interface (panel BLE Mesh completo)
  try {
    console.log('[MAIN] Importando ble_interface...');
    const { initBLEInterface } = await import('./ui/ble_interface.js');
    bleInterface = await initBLEInterface();
    console.log('[MAIN] ble_interface OK');
  } catch (e) {
    console.warn(`[MAIN] ble_interface fallo: ${e.message}`);
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
    console.warn(`[MAIN] nexo_app fallo: ${e.message}`);
  }

  // 6. SetupWizard (legacy, con timeout 8s no bloqueante)
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
