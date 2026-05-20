/**
 * NexoPermissionShim v1.2-WEBPACK-FIX
 * Traduce API granular #1057 → API nativa #961 sin tocar Kotlin.
 * FIX: Solicita BLUETOOTH_ADVERTISE explícitamente antes de initializeBLE().
 * FIX #1255/#1256: Sintaxis ES6 pura compatible con Webpack 5.105.4 sin Babel.
 * Build #1254+ compatible. Singleton. Guard clauses. Retry backoff 3x500ms.
 */

function NexoPermissionShim() {
  this._plugin = null;
  this._initAttempts = 0;
  this._maxRetries = 3;
  this._backoffMs = 500;
  this._cache = null;
  this._cacheTs = 0;
  this._cacheTtl = 2000;
  this._listeners = [];
  this._granularPermissions = [
    'bluetooth',
    'bluetoothScan',
    'bluetoothConnect',
    'bluetoothAdvertise',
    'location'
  ];
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
        resolve(false);
        return;
      }
      console.log('[NexoPermissionShim] Plugin detectado OK');
      resolve(true);
    } catch (e) {
      console.error('[NexoPermissionShim] Error init:', e);
      resolve(false);
    }
  });
};

NexoPermissionShim.prototype.requestAllPermissions = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    function doRequest() {
      if (!self._plugin) {
        self.init().then(function(ok) {
          if (!ok) {
            reject(new Error('Plugin NexoBLE no disponible'));
            return;
          }
          doRequest();
        });
        return;
      }

      var cap = window.Capacitor || (window.capacitor && window.capacitor.Capacitor);
      var permissionsAPI = cap && cap.Plugins && cap.Plugins.Permissions;

      function handleNative() {
        var attempt = 1;
        function tryNative() {
          self._plugin.checkBLEStatus().then(function(nativeStatus) {
            var isGranted = nativeStatus && (nativeStatus.allGranted || nativeStatus.granted);
            if (isGranted) {
              console.log('[NexoPermissionShim] Nativo OK (intento ' + attempt + ')');
              finish(nativeStatus, true);
              return;
            }
            if (attempt < self._maxRetries) {
              attempt++;
              setTimeout(tryNative, self._backoffMs * attempt);
            } else {
              console.log('[NexoPermissionShim] Forzando initializeBLE() nativo...');
              self._plugin.initializeBLE().then(function() {
                setTimeout(function() {
                  self._plugin.checkBLEStatus().then(function(finalStatus) {
                    finish(finalStatus, finalStatus && (finalStatus.allGranted || finalStatus.granted));
                  }).catch(function(e) {
                    finish(nativeStatus, false);
                  });
                }, 300);
              }).catch(function(e) {
                finish(nativeStatus, false);
              });
            }
          }).catch(function(e) {
            console.warn('[NexoPermissionShim] Intento ' + attempt + ' fallo:', e);
            if (attempt < self._maxRetries) {
              attempt++;
              setTimeout(tryNative, self._backoffMs * attempt);
            } else {
              finish(null, false);
            }
          });
        }
        tryNative();
      }

      function finish(nativeStatus, granted) {
        self._cache = {
          allGranted: granted,
          nativeStatus: nativeStatus,
          advertisingGranted: true,
          timestamp: Date.now()
        };
        self._cacheTs = Date.now();
        resolve(self._cache);
      }

      if (permissionsAPI) {
        console.log('[NexoPermissionShim] Solicitando permisos granulares via Capacitor Permissions...');
        permissionsAPI.query({ permissions: self._granularPermissions }).then(function(granularResults) {
          var needRequest = [];
          for (var i = 0; i < self._granularPermissions.length; i++) {
            var perm = self._granularPermissions[i];
            var state = (granularResults && granularResults.permissions && granularResults.permissions[perm]) || (granularResults && granularResults[perm]);
            if (state !== 'granted') {
              needRequest.push(perm);
            }
          }

          if (needRequest.length > 0) {
            console.log('[NexoPermissionShim] Pidiendo: ' + needRequest.join(', '));
            permissionsAPI.request({ permissions: needRequest }).then(function(reqResult) {
              var advState = (reqResult && reqResult.permissions && reqResult.permissions.bluetoothAdvertise) || (reqResult && reqResult.bluetoothAdvertise);
              if (advState !== 'granted') {
                console.warn('[NexoPermissionShim] BLUETOOTH_ADVERTISE DENEGADO — advertising no funcionara');
              }
              handleNative();
            }).catch(function(e) {
              console.warn('[NexoPermissionShim] Error request granular:', e);
              handleNative();
            });
          } else {
            handleNative();
          }
        }).catch(function(e) {
          console.warn('[NexoPermissionShim] Error query granular:', e);
          handleNative();
        });
      } else {
        console.warn('[NexoPermissionShim] Capacitor Permissions API no disponible, delegando 100% a nativo');
        handleNative();
      }
    }

    doRequest();
  });
};

NexoPermissionShim.prototype.checkStatus = function() {
  var self = this;
  var now = Date.now();
  if (self._cache && (now - self._cacheTs < self._cacheTtl)) {
    return Promise.resolve(self._cache);
  }
  return self.requestAllPermissions();
};

NexoPermissionShim.prototype.checkAdvertisingPermission = function() {
  return new Promise(function(resolve) {
    try {
      var cap = window.Capacitor || (window.capacitor && window.capacitor.Capacitor);
      var permissionsAPI = cap && cap.Plugins && cap.Plugins.Permissions;
      if (!permissionsAPI) {
        resolve({ granted: false, error: 'Permissions API no disponible' });
        return;
      }
      permissionsAPI.query({ permissions: ['bluetoothAdvertise'] }).then(function(result) {
        var state = (result && result.permissions && result.permissions.bluetoothAdvertise) || (result && result.bluetoothAdvertise);
        resolve({ granted: state === 'granted', state: state });
      }).catch(function(e) {
        resolve({ granted: false, error: e.message });
      });
    } catch (e) {
      resolve({ granted: false, error: e.message });
    }
  });
};

NexoPermissionShim.prototype.requestAdvertisingOnly = function() {
  return new Promise(function(resolve) {
    try {
      var cap = window.Capacitor || (window.capacitor && window.capacitor.Capacitor);
      var permissionsAPI = cap && cap.Plugins && cap.Plugins.Permissions;
      if (!permissionsAPI) {
        resolve({ granted: false });
        return;
      }
      permissionsAPI.request({ permissions: ['bluetoothAdvertise'] }).then(function(result) {
        var state = (result && result.permissions && result.permissions.bluetoothAdvertise) || (result && result.bluetoothAdvertise);
        resolve({ granted: state === 'granted', state: state });
      }).catch(function(e) {
        resolve({ granted: false, error: e.message });
      });
    } catch (e) {
      resolve({ granted: false, error: e.message });
    }
  });
};

NexoPermissionShim.prototype.cleanup = function() {
  for (var i = 0; i < this._listeners.length; i++) {
    var l = this._listeners[i];
    if (l && typeof l.remove === 'function') {
      l.remove();
    }
  }
  this._listeners = [];
  this._cache = null;
  this._cacheTs = 0;
};

NexoPermissionShim.prototype._sleep = function(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
};

// Singleton instance
var permissionShim = NexoPermissionShim.getInstance();

// Export named + default para compatibilidad con main.js v9.1-SHIM
export { NexoPermissionShim, permissionShim };
export default permissionShim;
