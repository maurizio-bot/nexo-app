/**
 * NexoPermissionShim v1.3-MINIMAL
 * ADAPTER transparente: API granular #1057 → API nativa #961.
 * NO reimplementa permisos. NO usa Capacitor Permissions API.
 * Delega 100% al plugin nativo para que Android muestre dialogos nativos.
 * Compatible Webpack 5.105.4 (ES5 puro).
 */

function NexoPermissionShim() {
  this._plugin = null;
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

NexoPermissionShim.prototype.requestAllPermissions = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    if (!self._plugin) {
      self.init().then(function(ok) {
        if (!ok) {
          reject(new Error('Plugin NexoBLE no disponible'));
          return;
        }
        self.requestAllPermissions().then(resolve).catch(reject);
      });
      return;
    }

    // Paso 1: Verificar estado nativo
    self._plugin.checkBLEStatus().then(function(status) {
      var granted = status && (status.allGranted || status.granted);
      if (granted) {
        console.log('[NexoPermissionShim] Permisos nativos ya concedidos');
        resolve({ allGranted: true, nativeStatus: status });
        return;
      }

      // Paso 2: Delegar al nativo para que muestre dialogos Android
      console.log('[NexoPermissionShim] Delegando a initializeBLE() nativo...');
      self._plugin.initializeBLE().then(function() {
        // Esperar a que el usuario responda los dialogos
        setTimeout(function() {
          self._plugin.checkBLEStatus().then(function(finalStatus) {
            var finalGranted = finalStatus && (finalStatus.allGranted || finalStatus.granted);
            resolve({
              allGranted: !!finalGranted,
              nativeStatus: finalStatus
            });
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
  });
};

NexoPermissionShim.prototype.checkStatus = function() {
  var self = this;
  return new Promise(function(resolve) {
    if (!self._plugin) {
      resolve({ allGranted: false });
      return;
    }
    self._plugin.checkBLEStatus().then(function(status) {
      resolve({
        allGranted: !!(status && (status.allGranted || status.granted)),
        nativeStatus: status
      });
    }).catch(function(e) {
      console.warn('[NexoPermissionShim] checkStatus error:', e);
      resolve({ allGranted: false });
    });
  });
};

// Para compatibilidad con main.js si llama requestAdvertisingOnly
NexoPermissionShim.prototype.requestAdvertisingOnly = function() {
  // El nativo #961 maneja advertising dentro de initializeBLE()
  return this.requestAllPermissions();
};

NexoPermissionShim.prototype.cleanup = function() {
  this._plugin = null;
};

var permissionShim = NexoPermissionShim.getInstance();

export { NexoPermissionShim, permissionShim };
export default permissionShim;
