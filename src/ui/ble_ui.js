/**
 * NEXO — Interfaz de la pantalla de contactos (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752,
 * sin cambios): panel, botones de visibilidad y búsqueda, lista de chats, franja de en línea, menú de cada contacto,
 * barra de teléfonos nuevos, insignia y estado.
 */
import { haptic } from './haptics.js'; // NEXO Touch (2968): háptica del sistema
import { avatarOf, paintAvatar } from './avatar.js';
import { t } from './i18n.js'; // #132 idioma
import { BLE_STATES, _formatTime, _niceName, _getBLEContacts, _getGradientForUUID, _getInitials, _getPinnedContacts, _hasNativeMethod, _isBLEContact, _isPinned, _normId, _rssiToBars, _safeDispatchEvent, _safeNativeCall, _showToast, _togglePinnedContact } from './ble_helpers.js';

// #dueño 08-11 (scan rápido): barritas de señal (como el wifi) para una fila de contacto encontrado — de un vistazo se ve
// quién está más cerca, SIN mover la lista de lugar (el orden sigue siendo por aparición). Devuelve null si no hay señal.
function _signalBarsEl(rssi) {
  try {
    var n = _rssiToBars(rssi);
    if (!n) return null;
    var wrap = document.createElement('span');
    wrap.setAttribute('aria-label', 'Señal ' + n + ' de 4');
    wrap.title = 'Señal ' + n + '/4';
    wrap.style.cssText = 'display:inline-flex;align-items:flex-end;gap:2px;height:16px;margin-right:12px;flex-shrink:0;';
    for (var i = 1; i <= 4; i++) {
      var b = document.createElement('span');
      b.style.cssText = 'width:3px;height:' + (4 + i * 3) + 'px;border-radius:1px;background:' + (i <= n ? '#00e0a0' : 'rgba(255,255,255,0.18)') + ';';
      wrap.appendChild(b);
    }
    return wrap;
  } catch (e) { return null; }
}


export const BLE_UI_METHODS = {
  _initVisibility() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(btState) {
          self.canAdvertise = (btState && btState.canAdvertise) || false;
          if (_hasNativeMethod(self.nativePlugin, 'isAdvertising')) {
            return _safeNativeCall(self.nativePlugin, 'isAdvertising', {}).then(function(adState) {
              self.isAdvertising = adState && adState.isAdvertising === true;
              self.updateVisibilityButton();
              self._setupNativeAdvertisingListeners();
            });
          } else {
            self.updateVisibilityButton();
            self._setupNativeAdvertisingListeners();
          }
        }).catch(function(err) { console.error('[BLEInterface] Error estado:', err); });
    }
    self.updateVisibilityButton('');
    return Promise.resolve();
  },

  updateVisibilityButton() {
    var btn = this.elements.visibilityBtn;
    if (!btn) return;
    if (this.isAdvertising) btn.classList.add('active'); else btn.classList.remove('active');
  },

  updateScanButton() {
    var btn = this.elements.scanBtn;
    if (!btn) return;
    var panelActive = this.elements.panel && this.elements.panel.classList.contains('active');
    btn.style.display = panelActive ? 'flex' : 'none';
    if (this.isScanning) btn.classList.add('scanning');
    else btn.classList.remove('scanning');
    if (panelActive) { this.renderPanelLists(); this.updateStatus(); } // (ronda 2771: el número de conectados, al día)
  },

  // Ronda 2771 (revisión, parte 4: interfaz): en "Agregar" no se rellenaban nunca "En línea ahora" ni la lista (decía "No
  // hay contactos" aunque los hubiera): tus contactos cerca y todos (los últimos agregados primero), con el buscador
  _panelMatch(name, id) {
    var q = this._panelQuery || '';
    return !q || (String(name || '') + ' ' + String(id || '')).toLowerCase().indexOf(q) >= 0;
  },
  // Ronda 2813 (pedido del dueño: «en la pantalla de contactos... solo quiero que se vean los que se escanean»): la
  // pantalla «Agregar contactos» YA NO muestra «En línea ahora» ni «Tus contactos» (esos viven en la pestaña Chats);
  // aquí solo los teléfonos NUEVOS que aparecen al escanear, que salen abajo en #ble-new-device (renderNewDeviceBar).
  // Esto invierte la ronda 2771 (que los metía aquí). Queda una pista en el área principal.
  renderPanelLists() {
    var strip = this.elements.onlineStrip, list = this.elements.contactsList;
    if (!list) return;
    var onlineLabel = document.getElementById('ble-online-label');
    var contactsLabel = document.getElementById('ble-contacts-label');
    if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }
    if (onlineLabel) onlineLabel.style.display = 'none';
    if (contactsLabel) contactsLabel.style.display = 'none';
    list.innerHTML = '';
    var hint = document.createElement('div');
    hint.className = 'ble-empty';
    hint.textContent = this.isScanning ? t('ble_scan_hint_on', 'Buscando teléfonos con NEXO cerca… Los que aparezcan salen aquí abajo para agregarlos.')
      : t('ble_scan_hint_off', 'Toca el botón de buscar (abajo) para encontrar teléfonos con NEXO cerca y agregarlos. Tus contactos están en Chats.');
    list.appendChild(hint);
  },

  toggleVisibility() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    var permsReady = false;
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions().then(function(result) { permsReady = result; }).catch(function() { permsReady = true; }).then(function() {
        if (!permsReady) return Promise.resolve();
        if (!self.nativePlugin) return Promise.resolve();
        var promise;
        if (self.isAdvertising) {
          if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {}); else promise = Promise.resolve();
          if (promise) return promise.then(function() { self.isAdvertising = false; self.updateVisibilityButton(); });
          self.isAdvertising = false;
        } else {
          if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {}); else promise = Promise.resolve();
          if (promise) return promise.then(function() { self.isAdvertising = true; self.updateVisibilityButton(); });
          self.isAdvertising = true;
        }
        self.updateVisibilityButton();
        return Promise.resolve();
      }).catch(function(err) {});
    } else { permsReady = true; }
    if (!permsReady) return Promise.resolve();
    if (!self.nativePlugin) return Promise.resolve();
    var promise;
    if (self.isAdvertising) {
      if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {});
      if (promise) return promise.then(function() { self.isAdvertising = false; self.updateVisibilityButton(); });
      self.isAdvertising = false;
    } else {
      if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {});
      if (promise) return promise.then(function() { self.isAdvertising = true; self.updateVisibilityButton(); });
      self.isAdvertising = true;
    }
    self.updateVisibilityButton();
    return Promise.resolve();
  },

  createDOM() {
    var self = this;
    var panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML =
      '<div class="ble-header" style="position:relative;display:flex;align-items:center;justify-content:center;padding:10px 20px 14px;">' +
      '<button id="ble-panel-back" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,200,255,0.3);transition:transform 0.15s ease;z-index:2;">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" transform="scale(-1,1) translate(-24,0)"/></svg>' +
      '</button>' +
      '<div style="text-align:center;"><div class="contacts-title">' + t('add_contacts', 'Agregar contactos') + '</div></div>' +
      '</div>' +
      '<div class="ble-search-bar">' +
      '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>' +
      '<input id="ble-search-input" type="search" placeholder="' + t('ph_search_contact', 'Buscar por nombre o NEXO ID') + '" autocomplete="off" spellcheck="false">' +
      '</div>' +
      // Ronda 2779 (pedido del dueño): agregar a alguien que no está cerca con su NEXO ID (te lo pasa por WhatsApp)
      '<div class="ble-section-label">' + t('add_by_id', 'Agregar por NEXO ID (está lejos)') + '</div>' +
      '<div id="ble-addid-row" style="display:flex;gap:8px;padding:0 12px 4px;">' +
      '<input id="ble-addid-input" type="text" placeholder="' + t('ph_addid', 'NX……… (su NEXO ID)') + '" autocomplete="off" spellcheck="false" maxlength="10" style="flex:1;min-width:0;padding:9px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;font-size:14px;text-transform:uppercase;">' +
      '<button id="ble-addid-btn" style="flex-shrink:0;padding:9px 16px;border-radius:12px;border:none;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">' + t('add', 'Agregar') + '</button>' +
      '</div>' +
      '<div id="ble-addid-note" style="font-size:12px;opacity:.85;text-align:center;padding:0 12px 6px;min-height:1px;"></div>' +
      '<div id="ble-requests" style="display:none;">' +
      '<div class="ble-section-label">' + t('requests_for_you', 'Solicitudes para ti') + '</div>' +
      '<div id="ble-requests-list" style="padding:0 12px 6px;"></div>' +
      '</div>' +
      '<div id="ble-online-label" class="ble-section-label">' + t('online_now', 'En línea ahora') + '</div>' +
      '<div id="ble-online-strip" class="ble-online-strip"></div>' +
      '<div id="ble-contacts-label" class="ble-section-label">' + t('your_contacts', 'Tus contactos') + '</div>' +
      '<div id="ble-contacts-list" class="ble-contacts-list">' +
      '<div class="ble-empty"></div>' +
      '</div>' +
      '<div class="ble-bottom-bar">' +
      '<div id="ble-new-device" class="ble-new-device" style="display:none">' +
      '<span id="ble-new-device-name"></span>' +
      '<button id="ble-add-btn" class="ble-btn-add-small">+</button>' +
      '</div>' +
      '<button id="ble-scan-btn" class="ble-btn-scan-round"></button>' +
      '</div>' +
      '<div id="ble-status-bar" class="ble-status-bar"><span id="ble-status-text"></span></div>' +
      '<div id="ble-visible-note" style="font-size:11px;opacity:.7;text-align:center;padding:0 12px 6px"></div>';
    document.body.appendChild(panel);
    this.elements.panel = panel;
    var overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    document.body.appendChild(overlay);
    this.elements.overlay = overlay;
    var bottomNav = document.createElement('div');
    bottomNav.id = 'ble-bottom-nav';
    bottomNav.className = 'ble-bottom-nav';
    bottomNav.innerHTML =
      '<div class="ble-nav-item active" data-tab="chats">' +
      '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
      '<span>Chats</span>' +
      '</div>' +
      '<div class="ble-nav-item" data-tab="people">' +
      '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>' +
      '<span>Gente</span>' +
      '</div>' +
      '<div class="ble-nav-item" data-tab="map">' +
      '<svg viewBox="0 0 24 24"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>' +
      '<span>Mapa</span>' +
      '</div>' +
      '<div class="ble-nav-item" data-tab="profile">' +
      '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>' +
      '<span>Perfil</span>' +
      '</div>';
    document.body.appendChild(bottomNav);
    this.elements.bottomNav = bottomNav;
    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.contactsList = document.getElementById('ble-contacts-list');
    this.elements.onlineStrip = document.getElementById('ble-online-strip');
    this.elements.newDeviceBar = document.getElementById('ble-new-device');
    this.elements.newDeviceName = document.getElementById('ble-new-device-name');
    this.elements.addBtn = document.getElementById('ble-add-btn');
    this.elements.statusBar = document.getElementById('ble-status-bar');
    this.elements.statusText = document.getElementById('ble-status-text');
    this.elements.mainContactsList = document.getElementById('main-contacts-list');
    this.elements.mainOnlineStrip = document.getElementById('main-contacts-online-strip');
    this.elements.mainEmptyMsg = document.getElementById('main-contacts-empty-msg');
    var fabBtn = document.createElement('button');
    fabBtn.id = 'ble-fab-btn';
    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    fabBtn.style.cssText = 'position:fixed;bottom:80px;right:16px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483643;box-shadow:0 4px 15px rgba(0,200,255,0.3);transition:transform 0.15s ease;';
    fabBtn.addEventListener('click', function() { self.togglePanel(); });
    fabBtn.addEventListener('mousedown', function() { this.style.transform = 'scale(0.92)'; });
    fabBtn.addEventListener('mouseup', function() { this.style.transform = 'scale(1)'; });
    fabBtn.addEventListener('touchstart', function() { this.style.transform = 'scale(0.92)'; });
    fabBtn.addEventListener('touchend', function() { this.style.transform = 'scale(1)'; });
    document.body.appendChild(fabBtn);
    this.elements.fabBtn = fabBtn;
  },

  setupEventListeners() {
    var self = this;
    this.elements.overlay.addEventListener('click', function() { self.togglePanel(); });
    this.elements.scanBtn.addEventListener('click', function() { self.toggleScan(); });
    this.elements.addBtn.addEventListener('click', function() { self._addNewDevice(); });
    // Ronda 2779 (pedido del dueño): agregar por NEXO ID a alguien que está lejos (solicitud por internet) + bandeja
    var addIdBtn = document.getElementById('ble-addid-btn'), addIdInput = document.getElementById('ble-addid-input'), addNote = document.getElementById('ble-addid-note');
    var doAddId = function() {
      if (!addIdInput) return;
      var v = String(addIdInput.value || '').trim().toUpperCase();
      if (!v) return;
      var m = v.match(/NX[0-9A-Z]{8}/); // si pegó un mensaje entero ("Agrégame… ID: NX…"), saca el ID
      if (m) v = m[0];
      if (addNote) { addNote.style.color = ''; addNote.textContent = t('add_sending', 'Enviando solicitud…'); }
      if (typeof self.addByNexoId !== 'function') { if (addNote) addNote.textContent = t('add_unsupported', 'Esta versión no lo permite.'); return; }
      self.addByNexoId(v).then(function() {
        addIdInput.value = '';
        if (addNote) { addNote.style.color = '#22c55e'; addNote.textContent = t('ble_req_sent', 'Solicitud enviada a {id}. Aparecerás cuando la acepte.').replace(/\{id\}/g, v); }
      }).catch(function(e) { if (addNote) { addNote.style.color = '#fbbf24'; addNote.textContent = (e && e.message) || t('ble_req_fail', 'No se pudo enviar la solicitud.'); } });
    };
    if (addIdBtn) addIdBtn.addEventListener('click', doAddId);
    if (addIdInput) addIdInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doAddId(); } });
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('nexo:ble:reqIncoming', function(e) {
        self.renderRequests();
        self.renderContactsList(); // #dueño 04-11: que el aviso de la solicitud salga en la LISTA (antes solo dentro de «Agregar» → si no entrabas ahí, no te enterabas)
        try { var nm = (e && e.detail && e.detail.name) || 'Alguien'; _showToast('👋 ' + nm + ' quiere agregarte — mirá «Solicitudes para ti»', 'info'); } catch (x) {}
      });
      window.addEventListener('nexo:ble:reqAccepted', function(e) {
        self.renderRequests(); self.renderContactsList();
        if (addNote) { addNote.style.color = '#22c55e'; addNote.textContent = t('add_accepted', '{name} te aceptó. Ya están conectados.').replace(/\{name\}/g, (e.detail && (e.detail.name || e.detail.id)) || t('add_your_contact', 'Tu contacto')); }
      });
    }
    // Ronda 2771 (revisión, parte 4): el buscador de "Agregar" filtra tus contactos y los teléfonos encontrados
    var searchInput = document.getElementById('ble-search-input');
    if (searchInput) searchInput.addEventListener('input', function() {
      self._panelQuery = String(searchInput.value || '').trim().toLowerCase();
      self.renderPanelLists();
      self.renderNewDeviceBar();
    });
    var backBtn = document.getElementById('ble-panel-back');
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        self.elements.panel.classList.remove('active');
        self.elements.overlay.classList.remove('active');
        self.updateScanButton();
      });
    }
    var navItems = this.elements.bottomNav.querySelectorAll('.ble-nav-item');
    navItems.forEach(function(item) {
      item.addEventListener('click', function() {
        navItems.forEach(function(n) { n.classList.remove('active'); });
        item.classList.add('active');
        var tab = item.dataset.tab;
        if (tab === 'people') self.togglePanel();
        else if (tab === 'profile') {
          // v6.1.10: Perfil con el registro de diagnóstico (main.js)
          _safeDispatchEvent('nexo:ui:profile', {});
          navItems.forEach(function(n) { n.classList.toggle('active', n.dataset.tab === 'chats'); });
        }
        else if (tab === 'chats') {
          self.elements.panel.classList.remove('active');
          self.elements.overlay.classList.remove('active');
        }
      });
    });
    window.addEventListener('nexo:ble:sendReadReceipt', function(e) {
      try {
        var d = e.detail || {};
        if (!d.nexoId || !d.msgId) return;
        var nxR = _normId(d.nexoId);
        var devId = self._resolveDeviceIdForNexoId(d.nexoId);
        var stR = devId ? self._getDeviceState(devId) : {};
        var directR = stR.state === BLE_STATES.READY_TO_CHAT || stR.state === BLE_STATES.NOTIFICATIONS_READY;
        // Jump: sin enlace directo, la confirmación de lectura va dirigida por las rutas
        if (!directR && self.relay && self.relay.relayHop(d.nexoId)) {
          if (self.ackSystem && self.ackSystem.sendReadReceipt) self.ackSystem.sendReadReceipt(null, d.msgId, nxR);
          return;
        }
        // Ronda 2827 (informe del dueño: por Bluetooth el ✓✓ de «leído» no se ponía azul): el acuse de lectura es un
        // paquete de control de un solo intento; si el enlace Bluetooth no está listo al leer (se cayó, aún reconectando),
        // se perdería sin reintento y el emisor nunca vería el ✓✓ azul. Se recuerda y se reenvía al reconectar
        // (peerReady). Un acuse duplicado es inofensivo: el emisor lo deduplica por tipo+id.
        if (!directR) {
          self._pendingReads = self._pendingReads || new Map();
          var pr = self._pendingReads.get(nxR) || new Set();
          pr.add(d.msgId); if (pr.size > 300) pr.delete(pr.values().next().value);
          self._pendingReads.set(nxR, pr);
        }
        if (!devId) return;
        if (self.ackSystem && self.ackSystem.sendReadReceipt) self.ackSystem.sendReadReceipt(devId, d.msgId);
      } catch (err) {}
    });
    // Ronda 2827: al reconectar con un contacto, reenviar los acuses de lectura que quedaron pendientes (enlace caído al
    // leer), para que el emisor acabe viendo el ✓✓ azul. Mismo patrón que estados/avatar (que también reenvían en peerReady).
    window.addEventListener('nexo:ble:peerReady', function(e) {
      try {
        var nxP = _normId((e.detail && e.detail.nexoId) || '');
        if (!nxP || !self._pendingReads) return;
        var pend = self._pendingReads.get(nxP);
        if (!pend || !pend.size) return;
        self._pendingReads.delete(nxP);
        var dev = self._resolveDeviceIdForNexoId(nxP);
        pend.forEach(function(mid) { if (self.ackSystem && self.ackSystem.sendReadReceipt) self.ackSystem.sendReadReceipt(dev, mid); });
      } catch (err) {}
    });
    window.addEventListener('nexo:ble:closeChat', function() {
      self._activeChatDeviceId = null;
      self._activeChatDeviceIdNative = null;
      self._stopPingInterval();
      self.updateBadge();
      if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'flex';
      if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'flex';
      if (self.elements.panel) self.elements.panel.classList.remove('active');
      if (self.elements.overlay) self.elements.overlay.classList.remove('active');
      self.renderContactsList();
      self.renderOnlineStrip();
    });
    window.addEventListener('nexo:ble:openChat', function() {
      if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'none';
      if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'none';
    });
  },

  togglePanel() {
    this.elements.panel.classList.toggle('active');
    this.elements.overlay.classList.toggle('active');
    // Ronda 2755: con "Agregar" abierto se anuncia el NEXO ID (los demás pueden encontrarte); al cerrar, código rotativo
    if (typeof this.setVisible === 'function') this.setVisible(this.elements.panel.classList.contains('active'));
    if (this.elements.panel.classList.contains('active')) {
      this.newDevicesCount = 0;
      this.updateBadge();
      this._panelQuery = '';
      var si = document.getElementById('ble-search-input');
      if (si) si.value = '';
      this.renderContactsList();
      this.renderOnlineStrip();
      this.renderPanelLists();
      this.renderNewDeviceBar();
      this.renderRequests(); // ronda 2779: solicitudes de alta por ID pendientes
      var self = this;
      // #dueño 08-11 (scan rápido, paso 1): al ABRIR «Agregar» arranca un escaneo con PRIORIDAD DEL USUARIO (inmediato),
      // NO el auto-escaneo de fondo que lleva un throttle de 8 s (si acababa de escanear, abrir «Agregar» no hacía NADA
      // hasta 8 s después → «abro y no veo nada»). El camino del usuario no pasa por ese throttle: arranca al toque.
      setTimeout(function() { self._startUserScan(); }, 150);
    }
    this.updateScanButton();
  },

  // #dueño 08-11 (scan rápido): arranca YA un escaneo con prioridad del usuario. Si ya hay uno en curso (p. ej. uno de
  // fondo), lo ADOPTA como del usuario (no deja que el temporizador automático lo corte a los 6 s) en vez de arrancar otro.
  // El límite de Android (5/30 s) y el diferido si la ventana está llena siguen intactos (es el mismo camino del usuario).
  _startUserScan() {
    var self = this;
    if (self.isDummyMode || !self.nativePlugin) return Promise.resolve();
    if (self.isScanning) {
      self._autoScanActive = false; // deja de ser un auto-escaneo cortable: ahora lo mira el usuario
      self._userScanWanted = Date.now() + 20000;
      try { self.updateScanButton(); } catch (e) {}
      return Promise.resolve();
    }
    return self._doToggleScan();
  },

  _executeToggleScan() {
    var self = this;
    if (self.isScanning) {
      if (_hasNativeMethod(self.nativePlugin, 'stopScan')) {
        return _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() {
          self.isScanning = false;
          self.updateScanButton();
          self.updateStatus();
        });
      }
      self.isScanning = false;
      self.updateScanButton();
      self.updateStatus();
      return Promise.resolve();
    } else {
      // Build 2838: compuerta global ANTES de arrancar — no pasar el límite de Android (5 startScan/30 s), que si no
      // deja de dar resultados SIN avisar (Nordic #18). Si la ventana está llena o venimos de un throttle, se difiere
      // (el usuario pidió buscar, así que no se descarta: arranca solo en cuanto se libere un hueco).
      if (self._scanUnsupported) { try { _showToast(t('scan_unsupported', 'Este teléfono no puede buscar por Bluetooth ahora mismo.'), 'warn'); } catch (e) {} return Promise.resolve(); }
      var waitMs = 0;
      if (Date.now() < (self._scanBlockedUntil || 0)) waitMs = self._scanBlockedUntil - Date.now();
      else if (self._scanWindowFull && self._scanWindowFull()) waitMs = self._scanWindowWaitMs ? self._scanWindowWaitMs() : 2000;
      if (waitMs > 0) {
        try { _showToast('Buscando en un momento…', 'info'); } catch (e) {}
        self._userScanWanted = Date.now() + waitMs + 20000;
        clearTimeout(self._userDeferTimer);
        self._userDeferTimer = setTimeout(function() { if (!self.isScanning) self._executeToggleScan(); }, waitMs + 120);
        return Promise.resolve();
      }
      self.foundDevices.clear();
      self.renderContactsList();
      self.renderNewDeviceBar();
      self.renderOnlineStrip();
      if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
        self._autoScanActive = false; // escaneo del usuario: no lo corta el temporizador automático
        self._userScanWanted = Date.now() + 20000;
        if (self._noteScanStart) self._noteScanStart();
        // Build 2838: con filtro NEXO siempre (el controlador descarta el ruido de una multitud antes de llegar a la app)
        return _safeNativeCall(self.nativePlugin, 'startScan', { filtered: true }).then(function() {
          self._scanFailBackoff = 0;
          self.isScanning = true;
          self._autoScanActive = false;
          self.updateScanButton();
          // Ronda 2766: el nativo para solo a los 15 s; si no avisa (versión anterior), se da por parada igual
          clearTimeout(self._userScanTimer);
          self._userScanTimer = setTimeout(function() { if (self.isScanning && !self._autoScanActive) { self.isScanning = false; self.updateScanButton(); } }, 16000);
        });
      }
      self.isScanning = true;
      self.updateScanButton();
      return Promise.resolve();
    }
  },

  _doToggleScan() {
    var self = this;
    var permsReady = false;
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions().then(function(result) { permsReady = result; }).catch(function() { permsReady = true; }).then(function() {
        if (!permsReady) return Promise.resolve();
        return self._executeToggleScan();
      }).catch(function(err) {
        self.isScanning = false;
        self.updateScanButton();
      });
    } else { permsReady = true; }
    if (!permsReady) return Promise.resolve();
    return self._executeToggleScan();
  },

  toggleScan() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(btState) {
          if (!btState || !btState.enabled) {
            _showToast('Bluetooth apagado: actívalo para buscar.', 'warn');
            self.updateStatusBar('Bluetooth apagado');
            return Promise.resolve();
          }
          return self._doToggleScan();
        }).catch(function() { return self._doToggleScan(); });
    }
    return self._doToggleScan();
  },

  renderOnlineStrip() {
    var self = this;
    var strip = this.elements.mainOnlineStrip;
    if (!strip) return;
    strip.innerHTML = '';
    var contacts = _getBLEContacts();
    var now = Date.now();
    var STRIP_MS = (typeof window !== 'undefined' && Number(window.NEXO_STRIP_MS)) || 60000;
    // Ronda 2784 (pedido del dueño): la franja de conectados NO parpadea. Un contacto entra solo si lleva >=60s en
    // línea y se quita solo si lleva >=60s sin conexión (histéresis): se ignora cualquier cambio de estado que dure
    // menos de 60s, así que un corte breve (p. ej. tras 15s en línea) no lo hace desaparecer.
    var deb = this._stripDeb || (this._stripDeb = {});
    var onlineContacts = contacts.filter(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      var live = !!c.online && (now - (c.lastSeen || 0)) < 60000;
      var s = deb[nx] || (deb[nx] = { on: false, liveSince: live ? now : 0, deadSince: live ? 0 : now });
      if (live) { if (!s.liveSince) s.liveSince = now; s.deadSince = 0; if (!s.on && now - s.liveSince >= STRIP_MS) s.on = true; }
      else { if (!s.deadSince) s.deadSince = now; s.liveSince = 0; if (s.on && now - s.deadSince >= STRIP_MS) s.on = false; }
      return s.on;
    });
    // Re-evaluar cada 10s para que las transiciones (aparecer/quitarse al cruzar el minuto) se cumplan sin un evento nuevo
    if (!this._stripTimer && typeof setInterval === 'function') this._stripTimer = setInterval(function() { try { self.renderOnlineStrip(); } catch (e) {} }, 10000);
    if (onlineContacts.length === 0) { strip.style.display = 'none'; return; }
    strip.style.display = 'flex';
    onlineContacts.forEach(function(contact) {
      var uuid = _normId(contact.nexoId || contact.deviceUUID);
      var item = document.createElement('div');
      item.className = 'ble-online-item';
      var initials = _getInitials(contact.name);
      var gradClass = _getGradientForUUID(uuid);
      item.innerHTML = '<div class="ble-online-avatar ' + gradClass + '"><span></span><div class="ble-online-dot"></div></div><span class="ble-online-name"></span>';
      item.querySelector('.ble-online-avatar span').textContent = initials;
      paintAvatar(item.querySelector('.ble-online-avatar'), uuid, item.querySelector('.ble-online-avatar span')); // ronda 2765: foto de perfil
      item.querySelector('.ble-online-name').textContent = contact.name || '';
      item.addEventListener('click', function() { self.openChat(uuid); });
      strip.appendChild(item);
    });
  },

  // Ronda 2779: bandeja de solicitudes de contacto por ID (aceptar / eliminar). Se oculta si no hay ninguna.
  renderRequests() {
    var self = this;
    var box = document.getElementById('ble-requests'), list = document.getElementById('ble-requests-list');
    if (!box || !list || typeof self.pendingRequests !== 'function') return;
    var reqs = self.pendingRequests() || [];
    if (!reqs.length) { box.style.display = 'none'; list.innerHTML = ''; return; }
    box.style.display = '';
    list.innerHTML = '';
    reqs.forEach(function(req) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);';
      var info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;';
      var nm = document.createElement('div'); nm.style.cssText = 'font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nm.textContent = req.name || String(req.id || '').toUpperCase();
      var sub = document.createElement('div'); sub.style.cssText = 'font-size:11px;opacity:.7;';
      sub.textContent = String(req.id || '').toUpperCase() + (req.acc ? ' · aceptó tu solicitud — confirmá' : ' · quiere agregarte');
      info.appendChild(nm); info.appendChild(sub);
      // #dueño 04-11 (perfil 2b): tarjeta de validación — tel/correo ENMASCARADOS que llegaron en la solicitud (reconocer
      // sin regalar el dato). Los datos COMPLETOS y la foto aparecen al ACEPTAR (por el canal seguro E2E).
      if (req.ph || req.em) {
        var det = document.createElement('div'); det.style.cssText = 'font-size:11px;opacity:.65;margin-top:3px;';
        var bits = [];
        if (req.ph) bits.push('📱 ' + req.ph);
        if (req.em) bits.push('✉️ ' + req.em);
        det.textContent = bits.join('   ·   ');
        info.appendChild(det);
      }
      var ok = document.createElement('button'); ok.textContent = req.acc ? 'Confirmar' : 'Aceptar';
      ok.style.cssText = 'flex-shrink:0;padding:7px 12px;border-radius:10px;border:none;background:#22c55e;color:#fff;font-weight:600;cursor:pointer;';
      var no = document.createElement('button'); no.textContent = 'Eliminar';
      no.style.cssText = 'flex-shrink:0;padding:7px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer;';
      ok.addEventListener('click', function() {
        ok.disabled = no.disabled = true;
        self.acceptRequest(req.id).then(function() { haptic('confirm'); self.renderRequests(); self.renderContactsList(); }).catch(function() { ok.disabled = no.disabled = false; });
      });
      no.addEventListener('click', function() { self.rejectRequest(req.id); self.renderRequests(); });
      row.appendChild(info); row.appendChild(ok); row.appendChild(no);
      list.appendChild(row);
    });
  },

  _prependReqBanner(list) {
    var self = this;
    if (!list) return;
    var reqs = (typeof self.pendingRequests === 'function' && self.pendingRequests()) || [];
    if (!reqs.length) return;
    var banner = document.createElement('div');
    banner.id = 'ble-req-banner';
    banner.style.cssText = 'margin:8px 12px 10px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:9px;box-shadow:0 2px 12px rgba(0,200,255,.35);';
    banner.innerHTML = '<span style="font-size:18px;">👋</span><span>' + reqs.length + ' ' + (reqs.length === 1 ? t('req_banner_one', 'solicitud para ti') : t('req_banner_many', 'solicitudes para ti')) + ' — ' + t('req_banner_tap', 'toca para ver') + '</span>';
    banner.addEventListener('click', function () { try { self.togglePanel(); } catch (e) {} });
    if (list.firstChild) list.insertBefore(banner, list.firstChild);
    else list.appendChild(banner);
  },

  renderContactsList() {
    var self = this;
    var now = Date.now();
    if (self._contactsRenderTimer) return;
    var wait = 300 - (now - (self._lastContactsRender || 0));
    if (wait <= 0) { self._renderContactsListNow(); return; }
    self._contactsRenderTimer = setTimeout(function() { self._contactsRenderTimer = null; self._renderContactsListNow(); }, wait);
  },

  _renderContactsListNow() {
    var self = this;
    self._lastContactsRender = Date.now();
    var list = this.elements.mainContactsList;
    if (!list) return;
    list.innerHTML = '';
    // #dueño 04-11: si hay solicitudes de contacto esperando, avisarlo EN LA LISTA (banner arriba de todo) para que no
    // queden escondidas dentro de «Agregar». Tocarlo abre ese panel (donde se aceptan/eliminan).
    self._prependReqBanner(list);
    var contacts = _getBLEContacts();
    var seenNexoIds = {};
    var deduped = [];
    contacts.forEach(function(c) {
      var nid = _normId(c.nexoId || c.deviceUUID);
      if (!nid) return;
      if (!seenNexoIds[nid]) { seenNexoIds[nid] = true; deduped.push(c); }
      else {
        var existing = deduped.find(function(d) { return _normId(d.nexoId || d.deviceUUID) === nid; });
        if (existing && (c.lastSeen || 0) > (existing.lastSeen || 0)) {
          existing.name = c.name || existing.name;
          existing.lastSeen = c.lastSeen;
          existing.online = c.online;
          existing.lastMessage = c.lastMessage || existing.lastMessage;
          existing.lastMessageAt = Math.max(existing.lastMessageAt || 0, c.lastMessageAt || 0);
          existing.unreadCount = Math.max(existing.unreadCount || 0, c.unreadCount || 0);
          existing.deviceId = c.deviceId || existing.deviceId;
        }
      }
    });
    contacts = deduped;
    // Ronda 2758: los grupos en la misma lista (groups.js)
    var groupRows = self.groups ? self.groups.all().map(function(g) {
      return { nexoId: g.id, name: '👥 ' + g.name, lastMessage: g.lastMessage || '', lastMessageAt: g.lastMessageAt || 0, addedAt: g.createdAt || 0, unreadCount: g.unreadCount || 0, isGroup: true };
    }) : [];
    contacts = contacts.concat(groupRows);
    if (contacts.length === 0) {
      list.innerHTML = '';
      self._prependReqBanner(list); // sin contactos todavía, pero la solicitud pendiente igual tiene que avisarse
      if (this.elements.mainEmptyMsg) this.elements.mainEmptyMsg.classList.add('visible');
      this.renderOnlineStrip();
      return;
    }
    if (this.elements.mainEmptyMsg) this.elements.mainEmptyMsg.classList.remove('visible');
    var pinned = _getPinnedContacts();
    contacts.sort(function(a, b) {
      var aPinned = pinned.indexOf(_normId(a.nexoId || a.deviceUUID)) >= 0 ? 1 : 0;
      var bPinned = pinned.indexOf(_normId(b.nexoId || b.deviceUUID)) >= 0 ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      // v6.1.11: recién agregados desde una tarjeta compartida, arriba hasta abrir su chat
      // #dueño 08-11 (hueco del 2955): solo flota «nuevo» si NO tiene NINGÚN mensaje. Un contacto que ya cruzó un mensaje
      // (lastMessageAt>0) nunca flota, aunque le haya quedado la marca isNewShared vieja de una build anterior (donde solo
      // se limpiaba al ABRIR el chat) — por eso vivo Y03 (06:44) salía clavado arriba de Galaxy («Ahora») en la 2965.
      var aNew = (a.isNewShared && !a.lastMessageAt) ? 1 : 0, bNew = (b.isNewShared && !b.lastMessageAt) ? 1 : 0;
      if (aNew !== bNew) return bNew - aNew;
      // v6.1.8: por último mensaje; sin mensajes, por fecha de alta (estable)
      var d = (b.lastMessageAt || 0) - (a.lastMessageAt || 0);
      if (d !== 0) return d;
      d = (b.addedAt || 0) - (a.addedAt || 0);
      if (d !== 0) return d;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    contacts.forEach(function(contact, index) {
      var uuid = _normId(contact.nexoId || contact.deviceUUID);
      var isOnline = contact.online && (Date.now() - (contact.lastSeen || 0)) < 60000;
      var initials = _getInitials(contact.name);
      var gradClass = _getGradientForUUID(uuid);
      var lastMsg = contact.isGroup ? (contact.lastMessage || 'Grupo') : contact.lastMessage || (contact.isNewShared ? 'Nuevo contacto · listo para escribir' : (isOnline ? 'En línea' : 'Sin conexión'));
      var timeStr = _formatTime(contact.lastMessageAt);
      var unread = contact.unreadCount || 0;
      var row = document.createElement('div');
      row.className = 'ble-contact-row' + ((contact.isNewShared && !contact.lastMessageAt) ? ' ble-contact-new' : '');
      row.addEventListener('click', function(e) {
        if (e.target.closest('.ble-contact-menu') || e.target.closest('.ble-btn-menu')) return;
        self.openChat(uuid);
      });
      var avatar = document.createElement('div');
      avatar.className = 'ble-contact-avatar ' + gradClass;
      avatar.textContent = initials;
      if (!contact.isGroup) paintAvatar(avatar, uuid); // ronda 2765: foto de perfil
      // Ronda 2797 (pedido del dueño): tocar la FOTO del contacto la abre a tamaño grande (solo si tiene foto);
      // tocar el resto de la fila (nombre) entra al chat. Sin foto, el toque en el círculo cae a la fila (abre el chat).
      avatar.addEventListener('click', function(e) {
        if (contact.isGroup) return;
        var ph = avatarOf(uuid);
        // 3028 (dueño 12-11): sin «Guardar en galería» (así se copió la foto de un contacto como propia)
        if (ph && typeof window.__nexoOpenMedia === 'function') { e.stopPropagation(); window.__nexoOpenMedia(ph, 'image', true); }
      });
      row.appendChild(avatar);
      var info = document.createElement('div');
      info.className = 'ble-contact-info';
      // v6.1.11: texto, no HTML (nombres y mensajes vienen de otros teléfonos)
      var nameDiv = document.createElement('div'); nameDiv.className = 'ble-contact-name'; nameDiv.textContent = contact.name || '';
      var msgDiv = document.createElement('div'); msgDiv.className = 'ble-contact-msg'; msgDiv.textContent = lastMsg;
      info.appendChild(nameDiv); info.appendChild(msgDiv);
      row.appendChild(info);
      var meta = document.createElement('div');
      meta.className = 'ble-contact-meta';
      var metaHtml = '<span class="ble-contact-time">' + timeStr + '</span>';
      if (unread > 0) metaHtml += '<div class="ble-unread-badge">' + unread + '</div>';
      meta.innerHTML = metaHtml;
      row.appendChild(meta);
      var menuBtn = document.createElement('button');
      menuBtn.className = 'ble-btn-menu';
      menuBtn.innerHTML = '&#x22EE;';
      menuBtn.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;flex-shrink:0;margin-left:8px;';
      menuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (contact.isGroup && typeof window.NEXO_openGroupMenu === 'function') { window.NEXO_openGroupMenu(uuid); return; }
        self._toggleContactMenu(uuid, menuBtn);
      });
      row.appendChild(menuBtn);
      list.appendChild(row);
      if (index < contacts.length - 1) {
        var divider = document.createElement('div');
        divider.className = 'ble-divider';
        list.appendChild(divider);
      }
    });
    this.renderOnlineStrip();
    if (this.elements.panel && this.elements.panel.classList.contains('active')) this.renderPanelLists();
  },

  _toggleContactMenu(uuid, btn) {
    var self = this;
    var existing = document.querySelector('.ble-contact-menu');
    if (existing) { existing.remove(); return; }
    var menu = document.createElement('div');
    menu.className = 'ble-contact-menu';
    var isPinned = _isPinned(uuid);
    // Ronda 2771: "Cambiar nombre" (el nombre del chat ya se podía tocar y cambiar, pero nada lo decía)
    menu.innerHTML = '<div class="ble-menu-item" data-action="pin">' + (isPinned ? '&#x2606; Desfijar' : '&#x2605; Fijar') + '</div><div class="ble-menu-item" data-action="rename">&#x270F;&#xFE0F; Cambiar nombre</div><div class="ble-menu-item" data-action="profile">&#x1F464; Perfil</div><div class="ble-menu-item ble-menu-delete" data-action="delete">&#x1F5D1; Eliminar</div>';
    var rect = btn.getBoundingClientRect();
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    // #dueño 05-11: el menú se abría SIEMPRE hacia abajo (top = rect.bottom), así que en los contactos del final de
    // la lista se salía por debajo de la pantalla y quedaba recortado (y el botón flotante estorbaba el ⋮). Ahora se
    // mide el alto real y, si no cabe abajo, se abre hacia ARRIBA del botón. Se mide con el menú invisible para que no
    // parpadee saltando de abajo hacia arriba.
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);
    var mh = menu.offsetHeight || 200;
    var vh = window.innerHeight;
    if (rect.bottom + mh + 8 > vh && rect.top - mh - 8 >= 0) {
      menu.style.bottom = (vh - rect.top + 4) + 'px';
    } else {
      menu.style.top = (rect.bottom + 4) + 'px';
    }
    menu.style.visibility = '';
    menu.addEventListener('click', function(e) {
      var action = e.target.dataset.action;
      if (action === 'pin') { _togglePinnedContact(uuid); self.renderContactsList(); }
      else if (action === 'delete') { self.removeContact(uuid); }
      else if (action === 'profile') { _safeDispatchEvent('nexo:ble:goToProfile', { deviceUUID: uuid }); }
      else if (action === 'rename') {
        self.openChat(uuid);
        setTimeout(function() { var ni = document.getElementById('chat-contact-name'); if (ni) { ni.focus(); try { ni.select(); } catch (er) {} } }, 300);
      }
      menu.remove();
    });
    setTimeout(function() {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 10);
  },

  renderNewDeviceBar() {
    var bar = this.elements.newDeviceBar;
    if (!bar) return;
    var self = this;
    var newDevices = [];
    this.foundDevices.forEach(function(device, deviceId) {
      var uuid = device.deviceUUID;
      if (uuid && !_isBLEContact(uuid) && self._panelMatch(_niceName(device.name, uuid), uuid)) newDevices.push({ deviceId: deviceId, device: device });
    });
    // 3012 (regla del dueño 11-11: «cualquiera que tiene NEXO debe aparecer al instante en un escaneo»): los NEXO cercanos que el
    // escaneo ve pero aún no dijeron quiénes son salen YA como «identificando…» (ble_privacy._anonRows) y pasan a su nombre al contestar
    var anonRows = (typeof this._anonRows === 'function' && !this._panelQuery) ? this._anonRows() : [];
    // 3014 (dueño 12-11: «encontrar rápido, pero que se vean solo los que son»; eligió A): los NEXO cercanos que aún no dijeron quiénes
    // son NO salen como filas sin nombre. Una sola línea discreta dice cuántos se están identificando (solo los vistos hace poco: el
    // que no contesta deja de contar) y cada uno aparece, con su nombre, en cuanto contesta.
    var fresh = anonRows.filter(function(a) { return !a.waiting; }).length;
    if (newDevices.length === 0 && fresh === 0) { bar.style.display = 'none'; bar.innerHTML = ''; if (anonRows.length && !this._anonRowTimer) { this._anonRowTimer = setTimeout(function() { self._anonRowTimer = null; try { self.renderNewDeviceBar(); } catch (e) {} }, 2500); } return; }
    bar.style.display = 'flex';
    bar.style.flexDirection = 'column';
    bar.style.gap = '8px';
    // 3012: con muchos teléfonos cerca la lista no se sale de la pantalla: se desplaza
    bar.style.maxHeight = '46vh';
    bar.style.overflowY = 'auto';
    bar.innerHTML = '';
    // (se vuelve a pintar sola mientras haya filas «identificando…»: pasan a «no responde todavía» o caducan)
    if (anonRows.length && !this._anonRowTimer) { this._anonRowTimer = setTimeout(function() { self._anonRowTimer = null; try { self.renderNewDeviceBar(); } catch (e) {} }, 2500); }
    if (fresh > 0) {
      var note = document.createElement('p');
      note.className = 'ble-anon-note';
      note.dataset.n = String(fresh);
      note.textContent = fresh === 1 ? t('add_anon_one', 'Buscando… 1 teléfono NEXO cerca') : t('add_anon_count', 'Buscando… {n} teléfonos NEXO cerca').replace('{n}', String(fresh));
      note.style.cssText = 'width:100%;margin:0;text-align:center;font-size:13px;color:rgba(255,255,255,0.65);padding:2px 0;';
      bar.appendChild(note);
    }
    newDevices.forEach(function(item) {
      var device = item.device;
      var deviceId = item.deviceId;
      var displayName = _niceName(device.name, device.deviceUUID);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 20px;border:2px solid #00c8ff;border-radius:16px;background:rgba(0,20,40,0.9);box-sizing:border-box;';
      var nameSpan = document.createElement('span');
      nameSpan.textContent = displayName;
      nameSpan.style.cssText = 'color:#fff;font-size:16px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:12px;';
      var addBtn = document.createElement('button');
      addBtn.textContent = '+';
      addBtn.style.cssText = 'width:40px;height:40px;border-radius:50%;background:#00c8ff;border:none;color:#fff;font-size:20px;font-weight:700;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        self._addNewDevice(deviceId);
      });
      row.appendChild(nameSpan);
      // #dueño 08-11 (scan rápido): barritas de señal — se ve quién está más cerca sin re-ordenar la lista.
      var barsEl = _signalBarsEl(device.rssi);
      if (barsEl) row.appendChild(barsEl);
      row.appendChild(addBtn);
      bar.appendChild(row);
    });
  },

  updateBadge() {
    var fabBtn = this.elements.fabBtn;
    if (!fabBtn) return;
    if (this._activeChatDeviceId) { fabBtn.style.display = 'none'; return; }
    fabBtn.style.display = 'flex';
    // Ronda 2771: teléfonos nuevos cerca: el icono se queda y el número va en una burbuja (antes, un número suelto)
    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
      (this.newDevicesCount > 0 ? '<span class="ble-fab-badge" style="position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:#ff6b35;border:2px solid #0a0a15;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + Math.min(this.newDevicesCount, 99) + '</span>' : '');
  },

  updateStatusBar(text) {
    if (this.elements.statusText) this.elements.statusText.textContent = text || '';
  },

  updateStatus(customStatus) {
    var self = this;
    if (customStatus) { self.updateStatusBar(customStatus); return Promise.resolve(); }
    if (self.isDummyMode) { self.updateStatusBar('OFFLINE (Dummy)'); return Promise.resolve(); }
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(state) {
          if (state && state.enabled) {
            // (ronda 2771: teléfonos, no enlaces: con el mismo teléfono puede haber dos, uno en cada sentido)
            var peers = {};
            if (self.connectedDevices) self.connectedDevices.forEach(function(d, id) { peers[d && d.deviceUUID ? _normId(d.deviceUUID) : id] = true; });
            var connCount = Object.keys(peers).length;
            self.updateStatusBar('Bluetooth activo · ' + connCount + (connCount === 1 ? ' conectado' : ' conectados'));
          } else {
            self.updateStatusBar('Bluetooth apagado');
          }
        })
        .catch(function() { self.updateStatusBar(''); });
    }
    self.updateStatusBar('');
    return Promise.resolve();
  }
};
