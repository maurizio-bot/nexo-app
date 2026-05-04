/**
 * main.js v9.0-DIAGNOSTICO
 * Ultra-defensivo. Si algo falla, lo muestra en pantalla.
 */

// ===== LOGGING VISUAL EN PANTALLA =====
function screenLog(msg, type = 'info') {
  console.log(`[MAIN] ${msg}`);
  const diag = document.getElementById('nexo-diagnostic');
  if (diag) {
    diag.style.display = 'block';
    diag.classList.add('visible');
    const color = type === 'error' ? '#ff4444' : type === 'warn' ? '#ffaa00' : '#00ff88';
    diag.innerHTML += `<div style="color:${color};border-bottom:1px solid rgba(255,255,255,0.1);padding:2px 0;">${new Date().toLocaleTimeString()} ${msg}</div>`;
    diag.scrollTop = diag.scrollHeight;
  }
}

screenLog('main.js cargado', 'info');

// ===== DETECTAR CAPACITOR (con retry) =====
function waitForCapacitor(maxMs = 5000) {
  return new Promise((resolve) => {
    if (window.Capacitor) { resolve(true); return; }
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 100;
      if (window.Capacitor) { clearInterval(interval); resolve(true); return; }
      if (elapsed >= maxMs) { clearInterval(interval); resolve(false); }
    }, 100);
  });
}

// ===== INICIALIZACIÓN =====
async function init() {
  screenLog('Iniciando...', 'info');

  try {
    // Esperar Capacitor
    const hasCapacitor = await waitForCapacitor(3000);
    screenLog(`Capacitor: ${hasCapacitor ? 'OK' : 'NO DETECTADO'}`, hasCapacitor ? 'info' : 'warn');

    // Importar módulos dinámicamente (si falla una importación, lo vemos)
    screenLog('Importando SetupWizard...', 'info');
    const { SetupWizard } = await import('./ui/SetupWizard.js');
    screenLog('SetupWizard importado OK', 'info');

    screenLog('Importando ble_interface...', 'info');
    const { initBLEInterface, startBleScan, stopBleScan } = await import('./ui/ble_interface.js');
    screenLog('ble_interface importado OK', 'info');

    screenLog('Importando nexo_app...', 'info');
    const { createNexoApp } = await import('./app/nexo_app.js');
    screenLog('nexo_app importado OK', 'info');

    // DOM refs
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
    };

    // Verificar que todos los elementos existen
    for (const [key, el] of Object.entries(els)) {
      if (!el && key !== 'views' && key !== 'navBtns') {
        screenLog(`FALTA elemento: ${key}`, 'warn');
      }
    }

    let currentView = 'home';
    let isScanning = false;
    let nexoApp = null;

    // ===== NAVEGACIÓN =====
    function switchView(name) {
      currentView = name;
      els.views.forEach(v => v.classList.remove('active'));
      const target = document.getElementById(`${name}-view`);
      if (target) target.classList.add('active');
      els.navBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === name);
      });
      if (name === 'chat' && nexoApp?.activeContact) {
        els.app.classList.add('chat-active');
      } else {
        els.app.classList.remove('chat-active');
      }
      screenLog(`Vista: ${name}`, 'info');
    }

    els.navBtns.forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // ===== CHAT =====
    els.sendBtn.addEventListener('click', async () => {
      const content = els.messageInput.value.trim();
      if (!content || !nexoApp?.activeContact) return;
      appendBubble(content, true);
      await nexoApp.sendMessage({ content, recipient: nexoApp.activeContact.id, transport: 'ble' });
      els.messageInput.value = '';
    });

    els.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') els.sendBtn.click();
    });

    function appendBubble(content, isOwn, mid = null) {
      const b = document.createElement('div');
      b.className = `message ${isOwn ? 'own' : 'other'}`;
      b.innerHTML = `<div>${content}</div><div class="message-meta"><span>${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>${isOwn?'<span>✓</span>':''}</div>`;
      if (mid) b.dataset.messageId = mid;
      els.messagesContainer.appendChild(b);
      els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
    }

    // ===== BLE SCAN =====
    els.btnBleScan.addEventListener('click', async () => {
      if (isScanning) {
        screenLog('Deteniendo scan...', 'info');
        try { await stopBleScan(); } catch (e) {}
        isScanning = false;
        els.btnBleScan.textContent = '⟳ Escanear';
        return;
      }

      els.bleDevicesList.innerHTML = '<div class="ble-empty">Escaneando...</div>';
      els.btnBleScan.textContent = '⏹ Detener';
      isScanning = true;
      screenLog('Iniciando scan BLE...', 'info');

      try {
        await startBleScan(
          (device) => {
            const empty = els.bleDevicesList.querySelector('.ble-empty');
            if (empty) empty.remove();
            renderBleDevice(device);
          },
          (error) => {
            screenLog(`Scan error: ${error.description}`, 'error');
            isScanning = false;
            els.btnBleScan.textContent = '⟳ Escanear';
          }
        );
      } catch (err) {
        screenLog(`Scan falló: ${err.message}`, 'error');
        isScanning = false;
        els.btnBleScan.textContent = '⟳ Escanear';
      }
    });

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
        <div><div class="ble-device-name">${device.name || 'Desconocido'}</div>
        <div class="ble-device-meta">${device.address}</div></div>
        <div class="ble-device-rssi">${device.rssi} dBm</div>
      `;
      item.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
          detail: { contactId: device.address, name: device.name || 'NEXO Peer', address: device.address, transport: 'ble' }
        }));
        switchView('chat');
      });
      els.bleDevicesList.appendChild(item);
      screenLog(`Dispositivo: ${device.name || 'Desconocido'}`, 'info');
    }

    // ===== PASO 1: PERMISOS (SetupWizard) =====
    screenLog('Paso 1: Permisos...', 'info');
    try {
      await new Promise((resolve, reject) => {
        const wizard = new SetupWizard('app', resolve);
        // Timeout de seguridad: si el wizard no responde en 10s, seguimos
        setTimeout(() => {
          screenLog('Wizard timeout - continuando', 'warn');
          resolve();
        }, 10000);
        wizard.start().catch(err => {
          screenLog(`Wizard error: ${err.message}`, 'error');
          resolve(); // No bloquear
        });
      });
      screenLog('Permisos OK', 'info');
    } catch (e) {
      screenLog(`Permisos saltados: ${e.message}`, 'warn');
    }

    // ===== PASO 2: BLE Interface =====
    screenLog('Paso 2: BLE Interface...', 'info');
    try {
      await initBLEInterface();
      screenLog('BLE Interface OK', 'info');
    } catch (e) {
      screenLog(`BLE Interface: ${e.message}`, 'warn');
    }

    // ===== PASO 3: NEXO App =====
    screenLog('Paso 3: NEXO App...', 'info');
    try {
      nexoApp = await createNexoApp({
        onMessage: (msg) => {
          if (msg.source === 'ble_direct') appendBubble(msg.content, false, msg.messageId);
        },
        onStatusChange: (status) => {
          if (status.startsWith('CHAT:')) els.chatContactName.value = status.replace('CHAT:', '');
          els.sbPhase.textContent = 'READY';
          els.sbMode.textContent = (status.includes('ONLINE') || status.includes('P2P')) ? 'ONLINE' : 'OFFLINE';
        }
      });
      if (nexoApp._deviceUUID) els.sbId.textContent = nexoApp._deviceUUID.substring(0, 6);
      screenLog('NEXO App OK', 'info');
    } catch (e) {
      screenLog(`NEXO App: ${e.message}`, 'error');
    }

    // ===== PASO 4: Mostrar app =====
    screenLog('Mostrando app...', 'info');
    setTimeout(() => {
      if (els.splash) {
        els.splash.style.opacity = '0';
        setTimeout(() => els.splash?.remove(), 500);
      }
    }, 1000);

    switchView('home');
    screenLog('LISTO', 'info');

  } catch (fatalError) {
    screenLog(`FATAL: ${fatalError.message}`, 'error');
    console.error(fatalError);
    const fatal = document.getElementById('fatal-error');
    if (fatal) {
      fatal.style.display = 'flex';
      document.getElementById('fatal-code').textContent = fatalError.message;
    }
  }
}

// Iniciar inmediatamente (para módulos ES6, DOMContentLoaded ya pasó)
init();
