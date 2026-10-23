/**
 * NEXO — Pausa del Bluetooth mientras la cámara está abierta (métodos de BLEInterface sacados de ble_interface.js en
 * la ronda 2752, sin cambios).
 */
import { BLE_STATES, _hasNativeMethod, _normMac, _safeNativeCall } from './ble_helpers.js';


export const BLE_CAMERA_METHODS = {
  pauseBLEForCamera() {
    var self = this;
    if (self._cameraBlePaused) return;
    console.log('[BLEInterface] pauseBLEForCamera');
    self._cameraBlePaused = true;
    self._cameraBlePausedDevices = [];
    self._cameraBleWasAdvertising = self.isAdvertising;

    // Detener scan
    if (self.isScanning && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
      _safeNativeCall(self.nativePlugin, 'stopScan', {}).catch(function() {});
      self.isScanning = false;
      self.updateScanButton();
    }

    // Guardar dispositivos conectados y desconectarlos
    self.connectedDevices.forEach(function(device, deviceId) {
      self._cameraBlePausedDevices.push({
        deviceId: deviceId,
        deviceUUID: device.deviceUUID || self._macToNexoId.get(_normMac(deviceId)),
        name: device.name
      });
      if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
        _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId }).catch(function() {});
      }
      self.connectedDevices.delete(deviceId);
      self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
    });

    // Parar advertising
    if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'stopAdvertising')) {
      _safeNativeCall(self.nativePlugin, 'stopAdvertising', {}).catch(function() {});
      self.isAdvertising = false;
      self.updateVisibilityButton();
    }
  },

  resumeBLEAfterCamera() {
    var self = this;
    if (!self._cameraBlePaused) return Promise.resolve();
    console.log('[BLEInterface] resumeBLEAfterCamera — reconectando', self._cameraBlePausedDevices.length, 'dispositivos');

    self._cameraBlePaused = false;

    // Notificar a todos los waiters
    var waiters = self._cameraBleResumeWaiters.slice();
    self._cameraBleResumeWaiters = [];
    waiters.forEach(function(w) { try { w.resolve(); } catch (e) {} });

    // Restaurar advertising
    if (self._cameraBleWasAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
      _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).then(function() {
        self.isAdvertising = true;
        self.updateVisibilityButton();
      }).catch(function() {});
    }

    // Reconexión ACTIVA de los dispositivos que se desconectaron
    var devices = self._cameraBlePausedDevices.slice();
    self._cameraBlePausedDevices = [];

    var reconnectPromises = devices.map(function(d) {
      return new Promise(function(resolve) {
        setTimeout(function() {
          if (d.deviceId) {
            self._autoConnectGATT(d.deviceId, { name: d.name, deviceUUID: d.deviceUUID })
              .then(function() { resolve(); })
              .catch(function() { resolve(); });
          } else {
            resolve();
          }
        }, 300 + Math.random() * 400);
      });
    });

    return Promise.all(reconnectPromises).then(function() {
      // Auto-scan de seguridad
      setTimeout(function() {
        if (!self.isDummyMode && self.nativePlugin) self._autoScanForKnownContacts();
      }, 800);
    });
  },

  _waitIfCameraPaused() {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!self._cameraBlePaused) {
        resolve();
        return;
      }
      console.log('[BLEInterface] Esperando a que se reanude BLE tras cámara…');
      var timer = setTimeout(function() {
        // Timeout de seguridad: forzar resume
        console.warn('[BLEInterface] Timeout esperando resume de cámara — forzando');
        self._cameraBlePaused = false;
        var waiters = self._cameraBleResumeWaiters.slice();
        self._cameraBleResumeWaiters = [];
        waiters.forEach(function(w) { try { w.resolve(); } catch (e) {} });
        resolve();
      }, 8000);
      self._cameraBleResumeWaiters.push({
        resolve: function() { clearTimeout(timer); resolve(); },
        reject: function(err) { clearTimeout(timer); reject(err); }
      });
    });
  }
};
