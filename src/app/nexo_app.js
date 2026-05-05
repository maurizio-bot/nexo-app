  async _initPhase5_BLEUI() {
    DEBUG.setPhase('BLE_UI');
    try {
      const meshInstance = this.nordicMesh || this.mesh || null;
      this.bleInterface = initBLEInterface();
      if (this.bleInterface) {
        DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (native)'), 'UI_002');
      }

      const nativePlugin = window.Capacitor?.Plugins?.NexoBLE;
      if (nativePlugin?.getDeviceUUID) {
        try {
          const uuidResult = await nativePlugin.getDeviceUUID();
          this._deviceUUID = uuidResult?.deviceUUID || null;
          if (this._deviceUUID) {
            DEBUG.success(`DeviceUUID: ${this._deviceUUID.substring(0, 8)}...`, 'UUID_OK');
          }
        } catch (e) {
          DEBUG.warn(`getDeviceUUID fallo: ${e.message}`, 'UUID_WARN');
        }
      }

      if (nativePlugin?.initializeBLE && !this._bleInitialized) {
        try {
          const initResult = await nativePlugin.initializeBLE({
            userId: this._deviceUUID || undefined,
            userName: 'NEXO User'
          });
          if (initResult?.deviceUUID && !this._deviceUUID) {
            this._deviceUUID = initResult.deviceUUID;
          }
          this._bleInitialized = true;
          DEBUG.success('BLE nativo inicializado', 'BLE_INIT');
          if (nativePlugin.startAdvertising) {
            await nativePlugin.startAdvertising({ deviceName: 'NEXO' });
            DEBUG.success('Advertising BLE iniciado', 'BLE_ADVERT');
          }
        } catch (e) {
          DEBUG.warn(`BLE nativo init: ${e.message}`, 'BLE_INIT_WARN');
        }
      }

      // INICIALIZACIÓN NEARBY — CRÍTICO PARA VISIBILIDAD
      const nearbyPlugin = window.Capacitor?.Plugins?.NexoNearby;
      if (nearbyPlugin) {
        try {
          await nearbyPlugin.startKeepAliveService();
          DEBUG.success('Nearby KeepAlive iniciado', 'NEARBY_KEEPALIVE');
        } catch (e) {
          DEBUG.warn(`Nearby KeepAlive: ${e.message}`, 'NEARBY_WARN');
        }
        try {
          await nearbyPlugin.startAdvertising({});
          DEBUG.success('Nearby Advertising iniciado', 'NEARBY_ADVERT');
        } catch (e) {
          DEBUG.warn(`Nearby Advertising: ${e.message}`, 'NEARBY_WARN');
        }
        try {
          await nearbyPlugin.startDiscovery();
          DEBUG.success('Nearby Discovery iniciado', 'NEARBY_DISCOVERY');
        } catch (e) {
          DEBUG.warn(`Nearby Discovery: ${e.message}`, 'NEARBY_WARN');
        }
      } else {
        DEBUG.warn('Plugin NexoNearby no disponible', 'NEARBY_MISSING');
      }

      const displayId = this._deviceUUID || this.vault?.getIdentity?.()?.id || this.bleInterface?.localDeviceAddress || '--';
      this.bleInterface.updateStatus('INIT', 'OFFLINE', displayId);

      this._bleChatHandler = (e) => {
        const { contactId, name, address, transport } = e.detail;
        const normalizedId = this._normalizeForCompare(contactId);
        const rawAddress = address || contactId || '';
        this.activeContact = { 
          id: normalizedId, 
          rawAddress: rawAddress,
          name, 
          address: rawAddress, 
          transport 
        };
        DEBUG.success(`💬 Chat activo: ${name} [${transport.toUpperCase()}]`, 'BLE_CHAT');
        this._updateMode('P2P_BLE');
        this.config.onStatusChange(`CHAT:${name}`);
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);

      this._bleMessageHandler = (e) => {
        const { deviceId, content, senderName, messageId, source, timestamp } = e.detail;
        const nid = this._normalizeForCompare(deviceId);
        const localNormalized = this._normalizeForCompare(this.bleInterface?.localDeviceAddress);
        if (localNormalized && nid === localNormalized) {
          DEBUG.log(`Eco propio ignorado de ${deviceId?.substring(0,8)}`, 'debug', 'DEDUP_ECHO');
          return;
        }
        let resolvedName = senderName;
        if (this.bleInterface && typeof this.bleInterface.getContactName === 'function') {
          const persisted = this.bleInterface.getContactName(nid);
          if (persisted) resolvedName = persisted;
        }
        if (!resolvedName || resolvedName === 'NEXO Peer') {
          resolvedName = `NEXO-${nid.substring(0, 6).toUpperCase()}`;
        }
        this._handleMessage({ content, sender: nid, senderName: resolvedName, source: source || 'ble_direct', timestamp: timestamp || Date.now(), messageId: messageId || null, _own: false }, 'ble_direct');
      };
      window.addEventListener('nexo:ble:messageReceived', this._bleMessageHandler);

      this._bleSendHandler = (e) => {
        const { content, deviceId, messageId } = e.detail;
        const targetAddr = deviceId || this.activeContact?.rawAddress || this.activeContact?.address || '';
        this.sendMessage({ content, recipient: targetAddr, messageId, transport: 'ble' });
      };
      window.addEventListener('nexo:ble:sendMessage', this._bleSendHandler);

    } catch (err) { DEBUG.error('UI_004', `BLE UI init failed: ${err.message}`); this.bleInterface = null; }
  }
