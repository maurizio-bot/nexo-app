/**
 * main.js v10.3-ARCH
 * FIX: UI estética unificada. Dispositivo = botón único. Click = agregar + chat automático.
 * REM v2.1: Agregado screenLog para visibilidad de diagnóstico nativo en pantalla.
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

/* ---------- REM v2.1: ScreenLog para diagnóstico nativo ---------- */
let screenLogEl = null;
function initScreenLog() {
  if (document.getElementById('nexo-screen-log')) return;
  screenLogEl = document.createElement('div');
  screenLogEl.id = 'nexo-screen-log';
  screenLogEl.style.cssText = `
    position: fixed; bottom: 80px; left: 10px; right: 10px;
    max-height: 200px; overflow-y: auto;
    background: rgba(0,0,0,0.85); color: #00ff88;
    font-family: monospace; font-size: 11px; line-height: 1.4;
    padding: 8px; border-radius: 8px; z-index: 100000;
    pointer-events: none; word-break: break-all;
    border: 1px solid #00ff88; opacity: 0.95;
  `;
  document.body.appendChild(screenLogEl);
}

function screenLog(msg, type = 'info') {
  if (!screenLogEl) initScreenLog();
  const color = type === 'error' ? '#ff4444' : type === 'warn' ? '#ffaa00' : type === 'success' ? '#00ff88' : '#88ccff';
  const line = document.createElement('div');
  line.style.color = color;
  line.style.marginBottom = '2px';
  const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
  line.textContent = `[${time}] ${msg}`;
  screenLogEl.appendChild(line);
  screenLogEl.scrollTop = screenLogEl.scrollHeight;
  while (screenLogEl.children.length > 50) {
    screenLogEl.removeChild(screenLogEl.firstChild);
  }
}

// Escuchar REM nativos del bridge
window.addEventListener('nexo:nap:audit', (e) => {
  const { code, message, level } = e.detail;
  const type = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : level === 'SUCCESS' ? 'success' : 'info';
  screenLog(`[${code}] ${message}`, type);
});

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
    <div class="ble-device-id">${id.substring(0, 17)}...</div>
    <div class="ble-device-rssi">${rssi} dBm</div>
  `;
  list.appendChild(item);
  console.log(`[MAIN] Device rendered: ${name} (${id})`);
  screenLog(`[SCAN] ${name} (${id.substring(0,8)}) rssi=${rssi}`, 'success');
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
    screenLog('[SCAN] Deteniendo...', 'info');
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
  screenLog('[SCAN] Iniciando...', 'info');
  isScanning = true;
  els.btnBleScan.textContent = 'Detener';
  els.btnBleScan.classList.add('scanning');

  try {
    if (bleInterface?.startBleScan) await bleInterface.startBleScan();
    else await window.Capacitor.Plugins.NexoBLE.startScan();
    console.log('[MAIN] Scan iniciado OK');
    screenLog('[SCAN] Activo', 'success');
  } catch (err) {
    console.error('[MAIN] Scan falló:', err.message);
    screenLog(`[SCAN] Error: ${err.message}`, 'error');
    isScanning = false;
    els.btnBleScan.textContent = 'Escanear';
    els.btnBleScan.classList.remove('scanning');
  }
}

async function init() {
  console.log('[MAIN] Iniciando v10.3-ARCH...');
  initScreenLog();
  screenLog('[MAIN] v10.3-ARCH iniciando...', 'info');

  let waited = 0;
  while (!window.Capacitor && waited < 3000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  console.log(`[MAIN] Capacitor: ${window.Capacitor ? 'OK' : 'NO'}`);
  screenLog(`[MAIN] Capacitor: ${window.Capacitor ? 'OK' : 'NO'}`, window.Capacitor ? 'success' : 'error');

  // 1. Anti-Samsung: Exención de batería
  try {
    const blePlugin = window.Capacitor?.Plugins?.NexoBLE;
    if (blePlugin?.requestBatteryOptimizationExemption) {
      const batt = await blePlugin.requestBatteryOptimizationExemption();
      console.log(`[MAIN] Battery exemption: ${JSON.stringify(batt)}`);
      screenLog(`[BATT] Exemption: ${batt.requested ? 'solicitado' : 'ya exento'}`, 'info');
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
      screenLog('[NEARBY] KeepAlive iniciado', 'success');
    }
  } catch (e) {
    console.warn(`[MAIN] KeepAliveService: ${e.message}`);
    screenLog(`[NEARBY] KeepAlive: ${e.message}`, 'warn');
  }

  // 3. Importar ble_interface híbrida
  try {
    console.log('[MAIN] Importando ble_interface híbrida...');
    screenLog('[MAIN] Cargando BLE interface...', 'info');
    const { initBLEInterface } = await import('./ui/ble_interface.js');
    bleInterface = await initBLEInterface();
    console.log('[MAIN] ble_interface híbrida OK');
    screenLog('[MAIN] BLE interface OK', 'success');
  } catch (e) {
    console.warn(`[MAIN] ble_interface falló: ${e.message}`);
    screenLog(`[MAIN] BLE interface: ${e.message}`, 'warn');
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
    screenLog('[MAIN] Cargando NEXO App...', 'info');
    const { createNexoApp } = await import('./app/nexo_app.js');
    nexoApp = await createNexoApp({
      onMessage: (msg) => {
        if (msg.source === 'ble_direct' || msg.source === 'nearby' || msg.source === 'jump') {
          appendBubble(msg.content, false, msg.messageId);
        }
      }
    });
    console.log('[MAIN] NEXO App OK');
    screenLog('[MAIN] NEXO App OK', 'success');
  } catch (e) {
    console.warn(`[MAIN] nexo_app falló: ${e.message}`);
    screenLog(`[MAIN] NEXO App: ${e.message}`, 'warn');
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
  screenLog('[MAIN] Listo — prueba física activa', 'success');
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
      screenLog(`[SEND] Error: ${e.message}`, 'error');
    }
  });
}

try { init(); } catch (e) { console.error(`[MAIN] FATAL: ${e.message}`); }
