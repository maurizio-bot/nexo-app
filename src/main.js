/**
 * main.js v9.2-SHIM-FIX
 * Ultra-defensivo. Fallback nativo si ble_interface.js o Shim fallan.
 * Integra NexoPermissionShim v1.3-MINIMAL. Sin SetupWizard/SetupManager.
 * Compatible Webpack 5.105.4 (ES5 puro).
 */

(function() {
  'use strict';

  // ========== DIAGNOSTICO EN PANTALLA ==========
  var screenLog = [];
  function log(msg, type) {
    type = type || 'info';
    var line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    screenLog.push({ text: line, type: type });
    console.log(line);
    renderScreenLog();
  }

  function renderScreenLog() {
    var el = document.getElementById('screen-log');
    if (!el) return;
    el.innerHTML = '';
    for (var i = Math.max(0, screenLog.length - 20); i < screenLog.length; i++) {
      var div = document.createElement('div');
      div.textContent = screenLog[i].text;
      div.style.color = screenLog[i].type === 'error' ? '#ff4444' : (screenLog[i].type === 'warn' ? '#ffaa00' : '#00ff88');
      div.style.fontSize = '11px';
      div.style.fontFamily = 'monospace';
      el.appendChild(div);
    }
    el.scrollTop = el.scrollHeight;
  }

  // ========== ESTADO GLOBAL ==========
  var appState = {
    initialized: false,
    bleReady: false,
    scanning: false,
    advertising: false,
    devices: [],
    activeTab: 'cercanos'
  };

  var permissionShim = null;
  var bleInterface = null;
  var nexoApp = null;
  var nativePlugin = null;

  // ========== INICIALIZACION ==========
  function init() {
    log('NEXO v9.2-SHIM-FIX iniciando...');

    // 1. Detectar plugin nativo
    try {
      var cap = window.Capacitor || (window.capacitor && window.capacitor.Capacitor);
      nativePlugin = (cap && cap.Plugins && cap.Plugins.NexoBLE) || (cap && cap.Plugins && cap.Plugins.NexoBle);
      if (nativePlugin) {
        log('Plugin nativo NexoBLE detectado', 'info');
      } else {
        log('Plugin nativo NO detectado — modo simulacion', 'warn');
      }
    } catch (e) {
      log('Error detectando plugin: ' + e.message, 'error');
    }

    // 2. Inicializar Shim (adapter transparente)
    initShim().then(function() {
      // 3. Inicializar BLE Interface si existe
      return initBLEInterface();
    }).then(function() {
      // 4. Inicializar NexoApp si existe
      return initNexoApp();
    }).then(function() {
      appState.initialized = true;
      log('NEXO inicializado correctamente');
      renderUI();
    }).catch(function(e) {
      log('Error en inicializacion: ' + e.message, 'error');
      // Fallback: mostrar UI igual para que usuario pueda interactuar
      appState.initialized = true;
      renderUI();
    });
  }

  function initShim() {
    return new Promise(function(resolve) {
      try {
        // Importar Shim si existe como modulo
        if (window.NexoPermissionShim) {
          permissionShim = window.NexoPermissionShim.getInstance();
        } else if (window.permissionShim) {
          permissionShim = window.permissionShim;
        }

        if (!permissionShim) {
          log('Shim no disponible, usando fallback nativo', 'warn');
          // Fallback: crear shim dummy que delega al nativo
          permissionShim = {
            requestAllPermissions: function() {
              return new Promise(function(res, rej) {
                if (nativePlugin && nativePlugin.checkBLEStatus) {
                  nativePlugin.checkBLEStatus().then(function(s) {
                    if (s && (s.allGranted || s.granted)) {
                      res({ allGranted: true });
                    } else if (nativePlugin.initializeBLE) {
                      nativePlugin.initializeBLE().then(function() {
                        setTimeout(function() {
                          nativePlugin.checkBLEStatus().then(function(fs) {
                            res({ allGranted: !!(fs && (fs.allGranted || fs.granted)) });
                          }).catch(rej);
                        }, 800);
                      }).catch(rej);
                    } else {
                      res({ allGranted: false });
                    }
                  }).catch(rej);
                } else {
                  res({ allGranted: false });
                }
              });
            },
            checkStatus: function() {
              return this.requestAllPermissions();
            }
          };
        }

        // Solicitar permisos via Shim (delega a nativo #961)
        permissionShim.requestAllPermissions().then(function(result) {
          if (result && result.allGranted) {
            log('Permisos BLE concedidos');
            appState.bleReady = true;
          } else {
            log('Permisos BLE pendientes — toca boton BLE para solicitar', 'warn');
          }
          resolve();
        }).catch(function(e) {
          log('Error permisos: ' + e.message, 'error');
          resolve(); // No bloquear
        });
      } catch (e) {
        log('Excepcion Shim: ' + e.message, 'error');
        resolve();
      }
    });
  }

  function initBLEInterface() {
    return new Promise(function(resolve) {
      try {
        if (window.BLEInterface || window.bleInterface) {
          bleInterface = window.BLEInterface || window.bleInterface;
          log('BLE Interface detectada');
        } else {
          log('BLE Interface no detectada — fallback nativo', 'warn');
        }
        resolve();
      } catch (e) {
        log('Error BLE Interface: ' + e.message, 'warn');
        resolve();
      }
    });
  }

  function initNexoApp() {
    return new Promise(function(resolve) {
      try {
        if (window.NexoApp) {
          nexoApp = new window.NexoApp({
            onVaultStateChange: function(state) {
              log('Vault: ' + JSON.stringify(state));
            }
          });
          if (nexoApp.init) nexoApp.init();
          log('NexoApp inicializada');
        } else {
          log('NexoApp no detectada', 'warn');
        }
        resolve();
      } catch (e) {
        log('Error NexoApp: ' + e.message, 'warn');
        resolve();
      }
    });
  }

  // ========== UI RENDER ==========
  function renderUI() {
    var container = document.getElementById('app') || document.body;
    if (!container) {
      log('No existe contenedor #app', 'error');
      return;
    }

    // Si ya hay contenido, no destruir (la app ya renderizo)
    if (container.querySelector('.nexo-main')) return;

    var html = '<div class="nexo-main" style="background:#000;color:#fff;height:100vh;display:flex;flex-direction:column;">' +
      '<div style="padding:12px;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="font-size:18px;font-weight:bold;">BLE Mesh</div>' +
        '<div id="ble-status" style="font-size:12px;color:#888;">' + (appState.bleReady ? 'BLE Listo' : 'BLE Pendiente') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;padding:12px;">' +
        '<button id="btn-visibility" style="flex:1;padding:12px;background:#ffaa00;color:#000;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">' +
          (appState.advertising ? 'Visibilidad ON' : 'Visibilidad OFF') +
        '</button>' +
        '<button id="btn-discover" style="flex:1;padding:12px;background:#00aaff;color:#000;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">' +
          (appState.scanning ? 'Detener' : 'Descubrir') +
        '</button>' +
      '</div>' +
      '<div style="display:flex;gap:4px;padding:0 12px;">' +
        '<button class="tab-btn" data-tab="cercanos" style="flex:1;padding:8px;background:' + (appState.activeTab === 'cercanos' ? '#00aaff' : '#222') + ';color:#fff;border:none;border-radius:6px;cursor:pointer;">Cercanos</button>' +
        '<button class="tab-btn" data-tab="agregados" style="flex:1;padding:8px;background:' + (appState.activeTab === 'agregados' ? '#00aaff' : '#222') + ';color:#fff;border:none;border-radius:6px;cursor:pointer;">Agregados</button>' +
        '<button class="tab-btn" data-tab="conectados" style="flex:1;padding:8px;background:' + (appState.activeTab === 'conectados' ? '#00aaff' : '#222') + ';color:#fff;border:none;border-radius:6px;cursor:pointer;">Conectados</button>' +
      '</div>' +
      '<div id="device-list" style="flex:1;overflow-y:auto;padding:12px;"></div>' +
      '<div id="screen-log" style="max-height:120px;overflow-y:auto;padding:8px;background:#111;border-top:1px solid #333;font-family:monospace;font-size:11px;"></div>' +
    '</div>';

    container.innerHTML = html;

    // Bind events
    bindEvents();
    renderDeviceList();
    renderScreenLog();
  }

  function bindEvents() {
    var btnVis = document.getElementById('btn-visibility');
    var btnDisc = document.getElementById('btn-discover');

    if (btnVis) {
      btnVis.addEventListener('click', function() {
        toggleVisibility();
      });
    }
    if (btnDisc) {
      btnDisc.addEventListener('click', function() {
        toggleDiscover();
      });
    }

    var tabs = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function() {
        appState.activeTab = this.getAttribute('data-tab');
        renderUI();
      });
    }
  }

  // ========== BLE ACTIONS ==========
  function toggleVisibility() {
    if (!appState.bleReady) {
      log('Solicitando permisos primero...');
      permissionShim.requestAllPermissions().then(function(r) {
        if (r && r.allGranted) {
          appState.bleReady = true;
          log('Permisos OK — activando visibilidad');
          doToggleVisibility();
        } else {
          log('Permisos denegados', 'error');
        }
        renderUI();
      }).catch(function(e) {
        log('Error permisos: ' + e.message, 'error');
      });
      return;
    }
    doToggleVisibility();
  }

  function doToggleVisibility() {
    appState.advertising = !appState.advertising;
    log('Visibilidad: ' + (appState.advertising ? 'ON' : 'OFF'));

    if (nativePlugin) {
      if (appState.advertising && nativePlugin.startAdvertising) {
        nativePlugin.startAdvertising().then(function() {
          log('Advertising iniciado');
        }).catch(function(e) {
          log('Error advertising: ' + e.message, 'error');
          appState.advertising = false;
          renderUI();
        });
      } else if (!appState.advertising && nativePlugin.stopAdvertising) {
        nativePlugin.stopAdvertising().then(function() {
          log('Advertising detenido');
        }).catch(function(e) {
          log('Error stop advertising: ' + e.message, 'warn');
        });
      }
    }
    renderUI();
  }

  function toggleDiscover() {
    if (!appState.bleReady) {
      log('Solicitando permisos primero...');
      permissionShim.requestAllPermissions().then(function(r) {
        if (r && r.allGranted) {
          appState.bleReady = true;
          log('Permisos OK — iniciando scan');
          doToggleDiscover();
        } else {
          log('Permisos denegados', 'error');
        }
        renderUI();
      }).catch(function(e) {
        log('Error permisos: ' + e.message, 'error');
      });
      return;
    }
    doToggleDiscover();
  }

  function doToggleDiscover() {
    appState.scanning = !appState.scanning;
    log('Scan: ' + (appState.scanning ? 'ON' : 'OFF'));

    if (nativePlugin) {
      if (appState.scanning && nativePlugin.startScan) {
        nativePlugin.startScan().then(function() {
          log('Scan iniciado');
        }).catch(function(e) {
          log('Error scan: ' + e.message, 'error');
          appState.scanning = false;
          renderUI();
        });
      } else if (!appState.scanning && nativePlugin.stopScan) {
        nativePlugin.stopScan().then(function() {
          log('Scan detenido');
        }).catch(function(e) {
          log('Error stop scan: ' + e.message, 'warn');
        });
      }
    }
    renderUI();
  }

  // ========== DEVICE LIST ==========
  function renderDeviceList() {
    var el = document.getElementById('device-list');
    if (!el) return;

    if (appState.devices.length === 0) {
      el.innerHTML = '<div style="text-align:center;color:#666;margin-top:40px;">' +
        '<div style="font-size:16px;margin-bottom:8px;">Presiona Descubrir para encontrar dispositivos cercanos</div>' +
        '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < appState.devices.length; i++) {
      var d = appState.devices[i];
      html += '<div style="padding:12px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
          '<div style="font-weight:bold;">' + (d.name || 'Desconocido') + '</div>' +
          '<div style="font-size:12px;color:#888;">' + (d.address || d.id || '') + '</div>' +
        '</div>' +
        '<div style="font-size:12px;color:#00ff88;">' + (d.rssi || '') + ' dBm</div>' +
      '</div>';
    }
    el.innerHTML = html;
  }

  // ========== LISTENERS NATIVOS ==========
  function setupNativeListeners() {
    if (!nativePlugin) return;

    // onDeviceFound
    if (nativePlugin.addListener) {
      nativePlugin.addListener('onDeviceFound', function(device) {
        log('Dispositivo encontrado: ' + (device.name || device.address));
        var exists = false;
        for (var i = 0; i < appState.devices.length; i++) {
          if (appState.devices[i].address === device.address || appState.devices[i].id === device.id) {
            exists = true;
            appState.devices[i] = device;
            break;
          }
        }
        if (!exists) appState.devices.push(device);
        renderDeviceList();
      });

      nativePlugin.addListener('onPayloadReceived', function(data) {
        log('Mensaje recibido: ' + JSON.stringify(data));
      });

      nativePlugin.addListener('onAdvertiseStarted', function() {
        log('Advertising nativo iniciado');
        appState.advertising = true;
        renderUI();
      });

      nativePlugin.addListener('onAdvertiseFailed', function(err) {
        log('Advertising fallo: ' + JSON.stringify(err), 'error');
        appState.advertising = false;
        renderUI();
      });
    }
  }

  // ========== ARRANQUE ==========
  document.addEventListener('DOMContentLoaded', function() {
    init();
    setupNativeListeners();
  });

  // Si DOM ya cargo
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(function() {
      init();
      setupNativeListeners();
    }, 1);
  }

})();
EOF
