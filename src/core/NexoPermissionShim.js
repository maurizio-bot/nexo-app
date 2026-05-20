/**
 * NexoPermissionShim v1.4-FIX
 * ADAPTER transparente: API granular #1057 → API nativa #961.
 * Delega 100% al plugin nativo para que Android muestre dialogos nativos.
 * FIX v1.4: Agregado ensurePermissions() para compatibilidad con ble_interface.js
 */

function NexoPermissionShim() {
  this._plugin = null;
  this._cache = { lastCheck: 0, result: null };
  this._antiSpam = { lastRequest: 0 };
}

NexoPermissionShim._instance = null;

NexoPermissionShim.getInstance = function() {
  if (!NexoPermissionShim._instance) {
    NexoPermissionShim._instance = new NexoPermissionShim();
  }
  return NexoPermissionShim._instance;
};

NexoPermissionShim.prototype.init = function() {
  var self = this;
  return new Promise(function(resolve) {
    try {
      var cap = window.Capacitor || (window.capacitor && window.capacitor.Capacitor);
      self._plugin = (cap && cap.Plugins && cap.Plugins.NexoBLE) || (cap && cap.Plugins && cap.Plugins.NexoBle);
      if (!self._plugin) {
        console.warn('[NexoPermissionShim] Plugin NexoBLE no detectado');
      } else {
        console.log('[NexoPermissionShim] Plugin detectado OK');
      }
      resolve(!!self._plugin);
    } catch (e) {
      console.error('[NexoPermissionShim] Error init:', e);
      resolve(false);
    }
  });
};

NexoPermissionShim.prototype._ensurePlugin = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    if (self._plugin) { resolve(true); return; }
    self.init().then(function(ok) {
      if (ok) resolve(true);
      else reject(new Error('Plugin NexoBLE no disponible'));
    });
  });
};

NexoPermissionShim.prototype.requestAllPermissions = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self._ensurePlugin().then(function() {
      // Anti-spam: no pedir más de 1 vez cada 2 segundos
      var now = Date.now();
      if (now - self._antiSpam.lastRequest < 2000 && self._cache.result) {
        console.log('[NexoPermissionShim] Anti-spam: reutilizando cache');
        resolve(self._cache.result);
        return;
      }
      self._antiSpam.lastRequest = now;

      // Paso 1: Verificar estado nativo
      self._plugin.checkBLEStatus().then(function(status) {
        var granted = status && (status.allGranted || status.granted);
        if (granted) {
          console.log('[NexoPermissionShim] Permisos nativos ya concedidos');
          var result = { allGranted: true, nativeStatus: status, success: true };
          self._cache = { lastCheck: now, result: result };
          resolve(result);
          return;
        }

        // Paso 2: Delegar al nativo para que muestre dialogos Android
        console.log('[NexoPermissionShim] Delegando a initializeBLE() nativo...');
        self._plugin.initializeBLE().then(function() {
          // Esperar a que el usuario responda los dialogos
          setTimeout(function() {
            self._plugin.checkBLEStatus().then(function(finalStatus) {
              var finalGranted = finalStatus && (finalStatus.allGranted || finalStatus.granted);
              var result = {
                allGranted: !!finalGranted,
                nativeStatus: finalStatus,
                success: !!finalGranted
              };
              self._cache = { lastCheck: Date.now(), result: result };
              resolve(result);
            }).catch(function(e) {
              reject(e);
            });
          }, 800);
        }).catch(function(e) {
          reject(e);
        });
      }).catch(function(e) {
        reject(e);
      });
    }).catch(reject);
  });
};

// FIX v1.4: Alias ensurePermissions → requestAllPermissions (compatibilidad ble_interface.js)
NexoPermissionShim.prototype.ensurePermissions = function() {
  return this.requestAllPermissions();
};

NexoPermissionShim.prototype.checkStatus = function() {
  var self = this;
  return new Promise(function(resolve) {
    if (!self._plugin) {
      resolve({ allGranted: false });
      return;
    }
    self._plugin.checkBLEStatus().then(function(status) {
      var result = {
        allGranted: !!(status && (status.allGranted || status.granted)),
        nativeStatus: status,
        success: !!(status && (status.allGranted || status.granted))
      };
      self._cache = { lastCheck: Date.now(), result: result };
      resolve(result);
    }).catch(function(e) {
      console.warn('[NexoPermissionShim] checkStatus error:', e);
      resolve({ allGranted: false, success: false });
    });
  });
};

NexoPermissionShim.prototype.requestAdvertisingOnly = function() {
  return this.requestAllPermissions();
};

NexoPermissionShim.prototype.cleanup = function() {
  this._plugin = null;
  this._cache = null;
};

var permissionShim = NexoPermissionShim.getInstance();

export { NexoPermissionShim, permissionShim };
export default permissionShim;
