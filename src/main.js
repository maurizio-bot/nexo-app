/**
 * main.js v10.4-DEFENSIVE
 * FIX: Ultra-defensivo, nunca crashea. Todos los try/catch necesarios.
 *      Fallback graceful si cualquier modulo falla.
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

window.handleDeviceClick = function(deviceId, name) {
  try {
    console.log('[MAIN] handleDeviceClick: ' + name + ' (' + deviceId + ')');
    if (bleInterface && bleInterface.addContact) bleInterface.addContact(deviceId);
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: { deviceId, name }
    }));
  } catch (e) {
    console.error('[MAIN] handleDeviceClick error:', e.message);
  }
};

function renderDevice(device) {
  try {
    const list = els.bleDevicesList;
    const empty = els.bleEmpty;
    if (empty) empty.style.display = 'none';

    const id = device.deviceId || device.address || 'unknown';
    const name = (device.name || 'NEXO Device').replace(/'/g, "\\'");
    const rssi = device.rssi || 0;

    const existing = document.querySelector('[data-ble-id="' + id + '"]');
    if (existing) {
      existing.setAttribute('data-rssi', rssi);
      return;
    }

    const item = document.createElement('div');
    item.className = 'ble-device-card';
    item.setAttribute('data-ble-id', id);
    item.setAttribute('data-rssi', rssi);
    item.setAttribute('onclick', 'handleDeviceClick("' + id + '", "' + name + '")');
    item.innerHTML = '<div class="ble-device-name">' + name + '</div><div class="ble-device-rssi">' + rssi + ' dBm</div>';
    list.appendChild(item);
    console.log('[MAIN] Device rendered: ' + name + ' (' + id + ')');
  } catch (e) {
    console.error('[MAIN] renderDevice error:', e.message);
  }
}

async function doScan() {
  try {
    if (isScanning) {
      console.log('[MAIN] Deteniendo scan...');
      isScanning = false;
      if (els.btnBleScan) {
        els.btnBleScan.textContent = 'Escanear';
        els.btnBleScan.classList.remove('scanning');
      }
      try {
        const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
        if (plugin && plugin.stopScan) await plugin.stopScan();
      } catch (e) { console.warn('[MAIN] stopScan error:', e.message); }
      return;
    }

    console.log('[MAIN] Iniciando scan manual...');
    isScanning = true;
    if (els.btnBleScan) {
      els.btnBleScan.textContent = 'Detener';
      els.btnBleScan.classList.add('scanning');
    }

    try {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
      if (plugin && plugin.startScan) await plugin.startScan();
      console.log('[MAIN] Scan iniciado OK');
    } catch (err) {
      console.error('[MAIN] Scan fallo:', err.message);
      isScanning = false;
      if (els.btnBleScan) {
        els.btnBleScan.textContent = 'Escanear';
        els.btnBleScan.classList.remove('scanning');
      }
    }
  } catch (e) {
    console.error('[MAIN] doScan error:', e.message);
  }
}

async function init() {
  console.log('[MAIN] Iniciando v10.4-DEFENSIVE...');

  try {
    let waited = 0;
    while (!window.Capacitor && waited < 3000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    console.log('[MAIN] Capacitor: ' + (window.Capacitor ? 'OK' : 'NO'));
  } catch (e) {
    console.warn('[MAIN] Error esperando Capacitor:', e.message);
  }

  // Inicializar permissionShim
  try {
    console.log('[MAIN] Inicializando permissionShim...');
    const { permissionShim } = await import('./core/NexoPermissionShim.js');
    window.permissionShim = permissionShim;
    await permissionShim.init();
    console.log('[MAIN] permissionShim OK');
  } catch (e) {
    console.warn('[MAIN] permissionShim fallo:', e.message);
    window.permissionShim = {
      ensurePermissions: async () => {
        try {
          const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
          if (!plugin) return { success: false };
          const status = await plugin.checkBLEStatus();
          if (status && (status.allGranted || status.granted)) return { success: true };
          if (plugin.initializeBLE) {
            await plugin.initializeBLE();
            await new Promise(r => setTimeout(r, 800));
            const final = await plugin.checkBLEStatus();
            return { success: !!(final && (final.allGranted || final.granted)) };
          }
          return { success: false };
        } catch (e) {
          return { success: false };
        }
      }
    };
  }

  // Importar ble_interface
  try {
    console.log('[MAIN] Importando ble_interface...');
    const { initBLEInterface } = await import('./ui/ble_interface.js');
    bleInterface = initBLEInterface();
    console.log('[MAIN] ble_interface OK');
  } catch (e) {
    console.warn('[MAIN] ble_interface fallo:', e.message);
    console.warn('[MAIN] Stack:', e.stack);
    bleInterface = null;
  }

  // Escuchar dispositivos
  try {
    window.addEventListener('nexo:ble:deviceFound', (e) => {
      try {
        const device = e.detail;
        console.log('[MAIN] nexo:ble:deviceFound:', device);
        renderDevice(device);
      } catch (err) {
        console.error('[MAIN] deviceFound handler error:', err.message);
      }
    });
  } catch (e) {
    console.warn('[MAIN] Error registrando listener deviceFound:', e.message);
  }

  // Importar nexo_app
  try {
    console.log('[MAIN] Importando nexo_app...');
    const { createNexoApp } = await import('./app/nexo_app.js');
    nexoApp = await createNexoApp({
      onMessage: (msg) => {
        try {
          if (msg.source === 'ble_direct' || msg.source === 'nearby') {
            if (typeof appendBubble === 'function') {
              appendBubble(msg.content, false, msg.messageId);
            }
          }
        } catch (err) {
          console.error('[MAIN] onMessage error:', err.message);
        }
      }
    });
    console.log('[MAIN] NEXO App OK');
  } catch (e) {
    console.warn('[MAIN] nexo_app fallo:', e.message);
    console.warn('[MAIN] Stack:', e.stack);
  }

  // SetupWizard legacy
  try {
    console.log('[MAIN] SetupWizard...');
    const { SetupWizard } = await import('./ui/SetupWizard.js');
    await new Promise((resolve) => {
      try {
        const wizard = new SetupWizard('app', resolve);
        wizard.start().catch(() => resolve());
      } catch (e) {
        resolve();
      }
      setTimeout(resolve, 8000);
    });
    console.log('[MAIN] Wizard OK');
  } catch (e) {
    console.warn('[MAIN] Wizard saltado:', e.message);
  }

  console.log('[MAIN] Listo');

  // Ocultar splash
  try {
    setTimeout(() => {
      if (els.splash) {
        els.splash.style.opacity = '0';
        setTimeout(() => {
          if (els.splash) els.splash.remove();
        }, 500);
      }
    }, 1000);
  } catch (e) {
    console.warn('[MAIN] Error ocultando splash:', e.message);
  }

  // Event listeners UI
  try {
    if (els.btnBleScan) els.btnBleScan.addEventListener('click', doScan);
    if (els.btnSend) {
      els.btnSend.addEventListener('click', async () => {
        try {
          const content = $('#message-input') ? $('#message-input').value || '' : '';
          const recipient = (nexoApp && nexoApp.activeContact && (nexoApp.activeContact.rawAddress || nexoApp.activeContact.id)) || '';
          if (nexoApp && nexoApp.sendMessage) {
            await nexoApp.sendMessage({ content, recipient, transport: 'ble' });
          }
          const input = $('#message-input');
          if (input) input.value = '';
        } catch (e) {
          console.error('[MAIN] Send error:', e.message);
        }
      });
    }
  } catch (e) {
    console.error('[MAIN] Error registrando event listeners:', e.message);
  }
}

try {
  init();
} catch (e) {
  console.error('[MAIN] FATAL:', e.message);
  console.error('[MAIN] Stack:', e.stack);
}
