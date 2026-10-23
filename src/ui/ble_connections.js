/**
 * NEXO — Conexiones Bluetooth (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * supervisor de enlaces, pings, reconexión, búsqueda de contactos perdidos, teléfonos encontrados al escanear y
 * esperar a que un enlace esté listo.
 */
import { BLE_STATES, SUPERVISOR_STATES, _addBLEContact, _getBLEContacts, _getContactByDeviceId, _getContactByUUID, _hasNativeMethod, _isBLEContact, _isResendable, _normId, _normMac, _safeDispatchEvent, _safeNativeCall, _saveBLEContacts, _vNx, _vaultGetOrCreateContact, _vaultLoadMessages } from './ble_helpers.js';


export const BLE_CONNECTION_METHODS = {
  _startConnectionSupervisor() {
    var self = this;
    if (self._supervisorTimer) { clearInterval(self._supervisorTimer); self._supervisorTimer = null; }
    self._supervisorTimer = setInterval(function() { self._runSupervisorCycle(); }, self._supervisorIntervalMs);
    console.log('[BLEInterface] Supervisor iniciado');
    if (self.relay) self.relay.start();
    if (self.fenix) self.fenix.init();
    if (self.lan) self.lan.init();
    if (self.net) self.net.init();
    if (self.wifiDirect) self.wifiDirect.init().then(function(st) {
      // Los ya conectados aún no sabían que tenemos Wi-Fi Direct: repetir el kx con wd:1
      if (st && st.supported) self._deviceStates.forEach(function(v, k) {
        if (v.state === BLE_STATES.READY_TO_CHAT || v.state === BLE_STATES.NOTIFICATIONS_READY) self._sendKx(k, false, true);
      });
    });
  },

  _stopConnectionSupervisor() {
    if (this._supervisorTimer) { clearInterval(this._supervisorTimer); this._supervisorTimer = null; }
    this._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    this._pendingPings.clear();
    this._backoffTimers.forEach(function(t) { clearTimeout(t); });
    this._backoffTimers.clear();
  },

  _hasActiveFileTransfer(deviceId) {
    try {
      if (!this.ackSystem) return false;
      if (typeof this.ackSystem.hasActiveTransfer === 'function') {
        return this.ackSystem.hasActiveTransfer(deviceId);
      }
      // Fallback: mirar si hay outgoing transfers pendientes
      if (typeof this.ackSystem.getOutgoingTransfers === 'function') {
        var outs = this.ackSystem.getOutgoingTransfers(deviceId);
        return outs && outs.length > 0;
      }
    } catch (e) {}
    return false;
  },

  _runSupervisorCycle() {
    var self = this;
    if (self._cameraBlePaused) return;
    if (!self._activeChatDeviceId && self.connectedDevices.size === 0) return;
    self.connectedDevices.forEach(function(device, deviceId) {
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) return;

      // Protección: no matar la conexión mientras se envía un archivo
      if (self._hasActiveFileTransfer(deviceId)) {
        console.log('[BLEInterface] Supervisor: transferencia activa, skip ping/zombie para', deviceId);
        return;
      }

      var lastPong = self._lastPongTime.get(deviceId) || 0;
      var timeSincePong = Date.now() - lastPong;
      if (lastPong === 0 || timeSincePong > 16000) {
        self._pingDevice(deviceId).then(function(result) {
          self._pingFailCount.set(deviceId, 0);
          var prevState = self._supervisorStates.get(deviceId);
          if (prevState && prevState.state === SUPERVISOR_STATES.ZOMBIE) {
            var nx = self._macToNexoId.get(_normMac(deviceId));
            if (nx && self.ackSystem && self.ackSystem.sendSessionSync) {
              console.log('[BLEInterface] Zombie recovery, enviando session sync a', nx);
              self.ackSystem.sendSessionSync(deviceId, nx);
            }
          }
          self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now(), rtt: result.rtt });
        }).catch(function(err) {
          var fails = (self._pingFailCount.get(deviceId) || 0) + 1;
          self._pingFailCount.set(deviceId, fails);
          if (fails >= self._pingMaxFails) {
            // Solo forzar si NO hay transferencia activa
            if (!self._hasActiveFileTransfer(deviceId)) {
              self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.ZOMBIE, since: Date.now() });
              self._forceDisconnectAndReconnect(deviceId);
            } else {
              console.log('[BLEInterface] Supervisor: zombie detectado pero transferencia activa → no reconectar');
            }
          } else {
            self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.DEGRADED, since: Date.now(), failCount: fails });
          }
        });
      }
    });
  },

  _pingDevice(deviceId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('No deviceId')); return; }
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) { reject(new Error('Not ready')); return; }
      var pingId = 'ping_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      var payload = JSON.stringify({ v: 1, type: 'ping', pingId: pingId, ts: Date.now(), fromNexoId: self.localNexoId || self.localDeviceUUID, bf: 1 });
      var timer = setTimeout(function() {
        var p = self._pendingPings.get(pingId);
        if (p) { self._pendingPings.delete(pingId); reject(new Error('Ping timeout')); }
      }, self._pingTimeoutMs);
      self._pendingPings.set(pingId, { resolve: resolve, reject: reject, timer: timer, ts: Date.now() });
      self._sendMessageNative(deviceId, payload, pingId).catch(function(e) {
        var p = self._pendingPings.get(pingId);
        if (p) { clearTimeout(p.timer); self._pendingPings.delete(pingId); reject(e); }
      });
    });
  },

  _forceDisconnectAndReconnect(deviceId) {
    var self = this;
    self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
    self.connectedDevices.delete(deviceId);
    self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.RECONNECTING, since: Date.now() });
    var oldTimer = self._backoffTimers.get(deviceId);
    if (oldTimer) { clearTimeout(oldTimer); self._backoffTimers.delete(deviceId); }
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
        .catch(function() {}).finally(function() { setTimeout(function() { self._attemptAutoReconnect(deviceId); }, 500); });
    } else { setTimeout(function() { self._attemptAutoReconnect(deviceId); }, 500); }
    var nx = self._macToNexoId.get(_normMac(deviceId));
    _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: nx, reason: 'supervisor_zombie' });
  },

  _attemptAutoReconnect(deviceId) {
    var self = this;
    var nx = self._macToNexoId.get(_normMac(deviceId));
    self._autoScanForKnownContacts();
    if (nx) {
      var contact = _getContactByUUID(nx);
      if (contact && contact.deviceId) setTimeout(function() { self._autoConnectGATT(contact.deviceId, { name: contact.name, deviceUUID: nx }); }, 800);
    }
    var attempt = self._reconnectAttempts.get(deviceId) || 0;
    var delay = Math.min(2000 * Math.pow(2, attempt), 30000);
    self._reconnectAttempts.set(deviceId, attempt + 1);
    var timer = setTimeout(function() {
      self._reconnectAttempts.delete(deviceId);
      var currentState = self._getDeviceState(deviceId);
      if (currentState.state === BLE_STATES.DISCONNECTED || currentState.state === BLE_STATES.ERROR) self._attemptAutoReconnect(deviceId);
    }, delay);
    self._backoffTimers.set(deviceId, timer);
  },

  _seedNativeConnections() {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'getConnectedDevices')) return;
    _safeNativeCall(self.nativePlugin, 'getConnectedDevices', {}).then(function(res) {
      var list = (res && res.devices) || [];
      list.forEach(function(d) {
        var deviceId = d.id || d.address;
        if (!deviceId || !d.ready) return;
        var st = self._getDeviceState(deviceId);
        if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) return;
        var contact = _getContactByDeviceId(deviceId);
        var nx = self._macToNexoId.get(_normMac(deviceId)) || (contact ? _normId(contact.nexoId || contact.deviceUUID) : null);
        self.connectedDevices.set(deviceId, { id: deviceId, name: d.name || '', direction: d.direction, role: d.role, servicesReady: true, deviceUUID: nx });
        self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { role: d.role, seeded: true });
        console.log('[BLEInterface] Conexión existente recuperada al arrancar:', deviceId, nx || '(sin id)');
        if (nx) {
          self._notifyPeerReady(deviceId, nx);
          if (self.ackSystem && self.ackSystem.sendSessionSync) self.ackSystem.sendSessionSync(deviceId, nx);
          self._resendPendingMessages(nx);
        }
      });
    }).catch(function() {});
  },

  _kickPeer(deviceId, nexoId) {
    var nx = _normId(nexoId);
    if (!nx || !deviceId) return;
    var nd = _normMac(deviceId);
    if (!this._macToNexoId.get(nd)) this._macToNexoId.set(nd, nx);
    if (!this._nexoIdToMac.get(nx) && !_vNx(deviceId)) this._nexoIdToMac.set(nx, nd);
    if (!this._lastKick) this._lastKick = new Map();
    var now = Date.now();
    if (now - (this._lastKick.get(nx) || 0) < 4000) return;
    this._lastKick.set(nx, now);
    var st = this._getDeviceState(deviceId);
    if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) {
      this._processPendingMessages(deviceId);
      this._resendPendingMessages(nx);
    }
  },

  _markPeerLost(nexoId) {
    var nx = _normId(nexoId);
    if (!nx) return;
    this._lostPeers.add(nx);
    this._startReconnectScanLoop();
  },

  _startReconnectScanLoop() {
    var self = this;
    if (self._reconnectScanTimer || self.isDummyMode || !self.nativePlugin) return;
    self._reconnectScanAttempts = 0;
    self._reconnectLoopStart = Date.now();
    function schedule(ms) { self._reconnectScanTimer = setTimeout(tick, ms); }
    function tick() {
      self._reconnectScanTimer = null;
      var now = Date.now();
      var presence = now < (self._presenceUntil || 0) && self._hasUnreadyContacts();
      if (self._lostPeers.size === 0 && !presence) { self._reconnectScanAttempts = 0; return; }
      var elapsed = now - self._reconnectLoopStart;
      var hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      var interval = hidden ? 60000 : (self._reconnectScanAttempts < 8 ? 15000 : 60000);
      var go = function() {
        // v6.1.13: escanear comparte la radio con las conexiones; durante una transferencia de archivo
        // se salta este turno (en el teléfono real la foto/vídeo iba más lenta)
        if (self._transferActive()) { console.log('[BLEInterface] Re-búsqueda aplazada: transferencia en curso'); return; }
        if (!self._cameraBlePaused && !self.isScanning) {
          self._reconnectScanAttempts++;
          console.log('[BLEInterface] Re-búsqueda de contactos', Array.from(self._lostPeers), presence ? '(+presencia)' : '', 'intento', self._reconnectScanAttempts, hidden ? 'oculta' : '');
          self._autoScanForKnownContacts({ filtered: hidden });
        }
      };
      if (elapsed < 1800000 || presence) { go(); schedule(interval); return; }
      self._lostPeersWithPending().then(function(withPending) {
        if (withPending.length === 0) { self._reconnectScanAttempts = 0; return; }
        go(); schedule(300000);
      }).catch(function() { schedule(300000); });
    }
    schedule(2000);
  },

  _stopAutoScan() {
    var self = this;
    if (!self.isScanning || !self._autoScanActive || !self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'stopScan')) return;
    self._autoScanActive = false;
    console.log('[BLEInterface] Escaneo automático detenido: transferencia en curso');
    _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() { self.isScanning = false; self.updateScanButton(); }).catch(function() { self.isScanning = false; });
  },

  _transferActive() {
    var ack = this.ackSystem;
    if (!ack) return false;
    var busy = false, now = Date.now();
    // v6.2.0: solo si el otro sigue confirmando (si cerró la app a mitad, el flujo sigue vivo hasta su
    // tiempo máximo y sin re-búsqueda no se le volvía a encontrar para continuar)
    if (ack.outgoingStreams) ack.outgoingStreams.forEach(function(st) { if (st && st.type === 'file' && !st.aborted && now - (st.lastAckAt || 0) < 10000) busy = true; });
    if (!busy && ack.incomingBuffers) ack.incomingBuffers.forEach(function(b) { if (b && !b.isChat && now - (b.lastActivity || 0) < 5000) busy = true; });
    return busy;
  },

  _hasUnreadyContacts() {
    var self = this;
    return (_getBLEContacts() || []).some(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (!nx) return false;
      var dev = self._resolveDeviceIdForNexoId(nx);
      if (!dev) return true;
      var st = self._getDeviceState(dev).state;
      return st !== BLE_STATES.READY_TO_CHAT && st !== BLE_STATES.NOTIFICATIONS_READY;
    });
  },

  _lostPeersWithPending() {
    var peers = Array.from(this._lostPeers);
    return Promise.all(peers.map(function(nx) {
      return _vaultLoadMessages(nx).then(function(msgs) { return (msgs || []).some(_isResendable) ? nx : null; }).catch(function() { return null; });
    })).then(function(r) { return r.filter(Boolean); });
  },

  _startPresenceSearch(ms) {
    this._presenceUntil = Date.now() + (ms || 120000);
    if (this._reconnectScanTimer) { clearTimeout(this._reconnectScanTimer); this._reconnectScanTimer = null; }
    this._startReconnectScanLoop();
  },

  _waitForReadyToChat(deviceId, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('deviceId invalido')); return; }
      var state = self._getDeviceState(deviceId);
      if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) {
        resolve();
        return;
      }
      var timer = setTimeout(function() {
        self._readyResolvers.delete(_normMac(deviceId));
        reject(new Error('Timeout esperando READY_TO_CHAT'));
      }, timeoutMs || 12000);
      self._readyResolvers.set(_normMac(deviceId), { resolve: resolve, timer: timer });
    });
  },

  _resolveReadyToChat(deviceId) {
    if (!deviceId) return;
    var resolver = this._readyResolvers.get(_normMac(deviceId));
    if (resolver) {
      clearTimeout(resolver.timer);
      resolver.resolve();
      this._readyResolvers.delete(_normMac(deviceId));
    }
    this._processPendingMessages(deviceId);
  },

  _autoScanForKnownContacts(opts) {
    var self = this;
    if (self._cameraBlePaused) return;
    if (self.isScanning) return;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'startScan')) return;
    console.log('[BLEInterface] Auto-scan iniciado');
    // v6.12.0: lo que se ve en "dispositivos nuevos" sigue sirviendo hasta que el escaneo lo vuelva a encontrar
    // (antes el "+" de esas filas no hacía nada: el dispositivo ya no estaba en foundDevices)
    self._recentFound = new Map(self.foundDevices);
    self.foundDevices.clear();
    _safeNativeCall(self.nativePlugin, 'startScan', { filtered: !!(opts && opts.filtered) })
      .then(function() {
        self.isScanning = true;
        self._autoScanActive = true;
        var token = self._autoScanToken = (self._autoScanToken || 0) + 1;
        self.updateScanButton();
        setTimeout(function() {
          // Solo si sigue siendo este escaneo automático (no cortar uno posterior del usuario)
          if (self._autoScanToken !== token || !self._autoScanActive) return;
          self._autoScanActive = false;
          if (self.isScanning && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
            _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() {
              self.isScanning = false;
              self.updateScanButton();
            }).catch(function() {
              self.isScanning = false;
              self.updateScanButton();
            });
          }
        }, 6000);
      }).catch(function(e) { console.warn('[BLEInterface] Auto-scan fallo:', e.message); });
  },

  _stopPingInterval() {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    this._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    this._pendingPings.clear();
  },

  onDeviceFound(device) {
    var deviceId = device.id || '';
    if (!deviceId) return;
    var nexoId = device.nexoId || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      return;
    }
    var nd = _normMac(deviceId);
    var nx = _normId(nexoId);
    if (nd && nx) {
      this._nexoIdToMac.set(nx, nd);
      this._macToNexoId.set(nd, nx);
    }
    var isContact = _isBLEContact(nexoId);
    if (isContact) {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) {
        return _normId(c.nexoId || c.deviceUUID) === nx;
      });
      if (idx >= 0) {
        contacts[idx].online = true;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].deviceId = deviceId;
        if (device.name && !contacts[idx].name) {
          contacts[idx].name = device.name;
        }
        _saveBLEContacts(contacts);
      }
      this.renderContactsList();
      this.renderOnlineStrip();
      var state = this._getDeviceState(deviceId);
      // v6.1.6: también desde ERROR (p.ej. se conectó cuando el otro tenía la app cerrada)
      if (state.state === BLE_STATES.DISCONNECTED || state.state === BLE_STATES.ERROR) {
        this._autoConnectGATT(deviceId, device);
      }
      return;
    }
    var existing = this.foundDevices.get(nx);
    if (!existing) {
      device.lastSeen = Date.now();
      device.deviceUUID = nexoId;
      this.foundDevices.set(nx, device);
      // Escaneo de Jump (buscar camino para otros): no avisar de "dispositivo nuevo"
      if (!this._relayScan) { this.newDevicesCount++; this.updateBadge(); }
      this.renderNewDeviceBar();
    } else {
      existing.id = deviceId;
      existing.name = device.name || existing.name || '';
      existing.rssi = device.rssi;
      existing.lastSeen = Date.now();
      existing.deviceUUID = nexoId;
      this.foundDevices.set(nx, existing);
      this.renderNewDeviceBar();
    }
  },

  _addNewDevice(deviceId) {
    var self = this;
    if (!deviceId) {
      var bar = this.elements.newDeviceBar;
      if (bar && bar.dataset) {
        deviceId = bar.dataset.deviceId || '';
      }
    }
    var device = this.foundDevices.get(deviceId) || (this._recentFound && this._recentFound.get(deviceId));
    if (!device) return;
    var name = device.name || device.deviceUUID || 'Nexo Device';
    var nexoId = device.deviceUUID || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      console.warn('[BLEInterface] Sin NEXO ID');
      return;
    }
    if (!_isBLEContact(nexoId)) {
      _addBLEContact({
        deviceUUID: nexoId,
        name: name,
        deviceId: device.id || null
      });
      _vaultGetOrCreateContact(nexoId, name, device.name);
    } else {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) {
        return _normId(c.nexoId || c.deviceUUID) === _normId(nexoId);
      });
      if (idx >= 0) {
        contacts[idx].deviceId = device.id || contacts[idx].deviceId;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].online = true;
        _saveBLEContacts(contacts);
      }
    }
    this._autoConnectGATT(device.id || deviceId, device);
    this.foundDevices.delete(deviceId);
    this.renderNewDeviceBar();
    this.renderContactsList();
    this.renderOnlineStrip();
    this.togglePanel();
  },

  _autoConnectGATT(deviceId, device) {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    var state = self._getDeviceState(deviceId);
    if (state.state === BLE_STATES.CONNECTING && state.timestamp && (Date.now() - state.timestamp > 8000)) {
      self._forceDisconnectAndReconnect(deviceId);
      return Promise.resolve();
    }
    if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) return Promise.resolve();
    self._setDeviceState(deviceId, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
    self.connectedDevices.set(deviceId, { id: deviceId, name: (device && device.name) || '', direction: 'outgoing', servicesReady: false, deviceUUID: device && device.deviceUUID });
    var connTarget = deviceId;
    var normTarget = _normMac(deviceId);
    if (!/^[0-9a-f]{12}$/.test(normTarget)) {
      var mapped = self._nexoIdToMac.get(_normId(deviceId));
      if (mapped) connTarget = mapped;
    }
    return _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: connTarget })
      .then(function(result) {
        if (result && (result.connected || result.alreadyConnected)) {
          return self._waitForReadyToChat(deviceId, 8000).then(function() {});
        } else {
          self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
        }
      })
      .catch(function(e) {
        self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
      });
  },

  disconnect(deviceId) {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    var bt = self._backoffTimers.get(deviceId);
    if (bt) { clearTimeout(bt); self._backoffTimers.delete(deviceId); }
    self._reconnectAttempts.delete(deviceId);
    if (_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      return _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
        .then(function() {
          if (self._activeChatDeviceId) {
            self._activeChatDeviceId = null;
            self._activeChatDeviceIdNative = null;
            self.updateBadge();
          }
        }).catch(function() {});
    }
    return Promise.resolve();
  }
};
