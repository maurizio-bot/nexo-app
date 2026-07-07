/**
 * NEXO v9.0 - Crypto Vault (v9.9-ES5-FULL-FIX)
 * FIX: Todos los template literals eliminados
 * FIX: Todos los const convertidos a var
 * FIX: Todos los asteriscos de métodos corregidos
 * NAP 2.0 Certified - WebCrypto API + IndexedDB
 */
var PBKDF2_ITERATIONS = 600000;
var SALT_LENGTH_BYTES = 32;
var IV_LENGTH_BYTES = 12;
var AES_KEY_SIZE_BITS = 256;
var AES_TAG_LENGTH_BITS = 128;
var INIT_TIMEOUT_MS = 5000;
var DB_TIMEOUT_MS = 3000;
var NAP_CODES = {
  VAULT_INIT_TIMEOUT: 'VAULT_INIT_TIMEOUT',
  VAULT_IDENTITY_FAIL: 'VAULT_IDENTITY_FAIL',
  VAULT_MEMORY_FALLBACK: 'VAULT_MEMORY_FALLBACK',
  VAULT_DB_ERROR: 'VAULT_DB_ERROR',
  VAULT_LOCKED: 'VAULT_LOCKED',
  VAULT_DESTROYED: 'VAULT_DESTROYED'
};

export class CryptoVault {
  constructor() {
    if (CryptoVault._instance) return CryptoVault._instance;
    this._validateEnvironment();
    this.masterKey = null;
    this.salt = null;
    this.db = null;
    this.identity = null;
    this._isLocked = true;
    this._destroyed = false;
    this._useMemoryFallback = false;
    this._memoryStorage = new Map();
    this._initStartTime = 0;
    this._ensureMinimalIdentity();
    CryptoVault._instance = this;
  }

  _getREM() {
    if (typeof window === 'undefined') return null;
    var candidates = [window.NEXO_REM, window.NEXO && window.NEXO.rem, window.NEXO_DIAG];
    for (var i = 0; i < candidates.length; i++) {
      var rem = candidates[i];
      if (rem && typeof rem === 'object' && (typeof rem.info === 'function' || typeof rem.log === 'function')) {
        return rem;
      }
    }
    return null;
  }

  _notifyREM(type, message, code) {
    code = code || '';
    try {
      var rem = this._getREM();
      if (!rem) {
        console.log('[Vault][' + type + '] ' + message);
        return;
      }
      var method = type === 'error' ? 'error' : type === 'warn' ? 'warn' : type === 'success' ? 'success' : 'info';
      if (typeof rem[method] === 'function') {
        rem[method]('[Vault] ' + message, code);
      } else if (typeof rem.log === 'function') {
        rem.log('[' + type.toUpperCase() + '] [Vault] ' + message, type);
      } else {
        console.log('[Vault][' + type + '] ' + message);
      }
    } catch (e) {
      console.log('[Vault][' + type + '] ' + message);
    }
  }

  _validateEnvironment() {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('WebCrypto API not available');
    }
  }

  _ensureMinimalIdentity() {
    if (!this.identity) {
      var id = crypto.randomUUID ? crypto.randomUUID() :
        'nexo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      this.identity = {
        id: id,
        publicKey: [],
        createdAt: Date.now(),
        algorithm: 'pre-init-fallback',
        temporary: true
      };
    }
  }

  init() {
    var self = this;
    if (this._destroyed) {
      this._notifyREM('error', 'Intento de init en vault destruido', NAP_CODES.VAULT_DESTROYED);
      throw new Error('Vault destroyed');
    }
    if (this.db || this._useMemoryFallback) {
      return Promise.resolve(this);
    }
    this._initStartTime = performance.now();
    this._notifyREM('info', 'Iniciando vault...', 'VAULT_INIT_START');
    return new Promise(function(resolve) {
      var timeoutId = setTimeout(function() {
        var elapsed = Math.round(performance.now() - self._initStartTime);
        self._notifyREM('warn', 'Timeout global (' + elapsed + 'ms) - forzando modo memoria', NAP_CODES.VAULT_INIT_TIMEOUT);
        self._activateMemoryFallback();
        resolve(self);
      }, INIT_TIMEOUT_MS);
      self._doInit()
        .then(function() {
          clearTimeout(timeoutId);
          var elapsed = Math.round(performance.now() - self._initStartTime);
          var mode = self._useMemoryFallback ? 'memoria' : 'persistente';
          self._notifyREM('success', 'Vault listo en ' + elapsed + 'ms (modo ' + mode + ')', 'VAULT_INIT_SUCCESS');
          resolve(self);
        })
        .catch(function(err) {
          clearTimeout(timeoutId);
          self._notifyREM('warn', 'Init fallo: ' + err.message + ' - usando memoria', NAP_CODES.VAULT_MEMORY_FALLBACK);
          self._activateMemoryFallback();
          resolve(self);
        });
    });
  }

  _doInit() {
    var self = this;
    return Promise.resolve()
      .then(function() {
        return self._initDBQuick();
      })
      .then(function() {
        return self._getSaltQuick();
      })
      .then(function(salt) {
        self.salt = salt;
        return self._loadIdentityQuick();
      })
      .catch(function(e) {
        if (!self.identity || !self.identity.temporary) {
          self._notifyREM('warn', 'No se pudo cargar identidad previa', NAP_CODES.VAULT_IDENTITY_FAIL);
        }
        self._ensureMinimalIdentity();
      })
      .then(function() {
        return self;
      });
  }

  _initDBQuick() {
    var self = this;
    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() { reject(new Error('DB timeout')); }, DB_TIMEOUT_MS);
      try {
        var request = indexedDB.open('nexo_crypto_v9', 1);
        request.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('keys')) {
            db.createObjectStore('keys', { keyPath: 'id' });
          }
        };
        request.onsuccess = function(e) {
          clearTimeout(timeout);
          self.db = e.target.result;
          self.db.onclose = function() {
            self._notifyREM('warn', 'Base de datos cerrada inesperadamente', 'VAULT_DB_CLOSED');
            self._cleanupDB();
            self._activateMemoryFallback();
          };
          resolve();
        };
        request.onerror = function() {
          clearTimeout(timeout);
          reject(request.error);
        };
        request.onblocked = function() {
          clearTimeout(timeout);
          reject(new Error('DB blocked'));
        };
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  _getSaltQuick() {
    var self = this;
    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() { reject(new Error('Salt timeout')); }, DB_TIMEOUT_MS);
      try {
        if (!self.db) {
          clearTimeout(timeout);
          reject(new Error('DB not available'));
          return;
        }
        var tx = self.db.transaction(['keys'], 'readonly');
        var store = tx.objectStore('keys');
        var request = store.get('master_salt');
        request.onsuccess = function() {
          clearTimeout(timeout);
          if (request.result && request.result.value && request.result.value.length === SALT_LENGTH_BYTES) {
            resolve(new Uint8Array(request.result.value));
          } else {
            var newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
            if (!self.db) {
              resolve(newSalt);
              return;
            }
            var tx2 = self.db.transaction(['keys'], 'readwrite');
            var store2 = tx2.objectStore('keys');
            store2.put({ id: 'master_salt', value: Array.from(newSalt) });
            resolve(newSalt);
          }
        };
        request.onerror = function() {
          clearTimeout(timeout);
          reject(request.error);
        };
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  _loadIdentityQuick() {
    var self = this;
    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() { reject(new Error('Identity timeout')); }, 2000);
      self._getFromStorage('nexo_identity')
        .then(function(stored) {
          clearTimeout(timeout);
          if (stored && stored.id) {
            self.identity = stored;
            self._notifyREM('info', 'Identidad cargada: ' + self.identity.id.substring(0, 8) + '...', 'VAULT_ID_LOADED');
            resolve();
          } else {
            reject(new Error('No identity found'));
          }
        })
        .catch(function(e) {
          clearTimeout(timeout);
          reject(e);
        });
    });
  }

  _activateMemoryFallback() {
    this._useMemoryFallback = true;
    this._cleanupDB();
    this._setupMinimalIdentity();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexo:vault:fallback', {
        detail: { mode: 'memory', identity: this.identity && this.identity.id ? this.identity.id : null }
      }));
    }
  }

  _setupMinimalIdentity() {
    var id = crypto.randomUUID ? crypto.randomUUID() :
      'nexo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    this.identity = {
      id: id,
      publicKey: [],
      createdAt: Date.now(),
      algorithm: 'memory-fallback',
      temporary: true
    };
    if (this._useMemoryFallback) {
      this._memoryStorage.set('nexo_identity', JSON.stringify(this.identity));
    }
    this._notifyREM('info', 'ID temporal: ' + id.substring(0, 8) + '...', 'VAULT_TEMP_ID');
  }

  getIdentityKey() {
    this._ensureMinimalIdentity();
    if (this.identity && this.identity.id) {
      return this.identity.id;
    }
    var emergencyId = 'nexo_emergency_' + Date.now();
    this._notifyREM('warn', 'Usando ID de emergencia', 'VAULT_EMERGENCY_ID');
    return emergencyId;
  }

  isIdentityReady() {
    return !!(this.identity && this.identity.id && !this.identity.temporary);
  }

  getIdentity() {
    return this.identity && this.identity.id ? this.identity.id : null;
  }

  isMemoryFallback() {
    return this._useMemoryFallback;
  }

  initialize(password) {
    var self = this;
    if (this._destroyed) {
      this._notifyREM('error', 'Vault destruido', NAP_CODES.VAULT_DESTROYED);
      throw new Error('Vault destroyed');
    }
    if (!this.salt && !this._useMemoryFallback) {
      this._notifyREM('error', 'Llamar init() primero', NAP_CODES.VAULT_LOCKED);
      throw new Error('Call init() first');
    }
    if (!password || password.length < 12) {
      this._notifyREM('error', 'Password muy corto', 'VAULT_WEAK_PASSWORD');
      throw new Error('Password too short');
    }
    if (!this.salt) {
      this.salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    }
    var encoder = new TextEncoder();
    var passwordBuffer = encoder.encode(password);
    return crypto.subtle.importKey(
      'raw', passwordBuffer, 'PBKDF2', false, ['deriveKey']
    ).then(function(keyMaterial) {
      return crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: self.salt,
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: AES_KEY_SIZE_BITS },
        false,
        ['encrypt', 'decrypt']
      );
    }).then(function(key) {
      self.masterKey = key;
      self._isLocked = false;
      if (self.identity && self.identity.temporary) {
        self.identity.temporary = false;
        self.identity.algorithm = 'AES-GCM-256';
      }
      self._notifyREM('success', 'Vault desbloqueado', 'VAULT_UNLOCKED');
      passwordBuffer.fill(0);
      return true;
    }).catch(function(err) {
      passwordBuffer.fill(0);
      throw err;
    });
  }

  encrypt(plaintext) {
    this._assertUnlocked();
    var data = typeof plaintext === 'string' ?
      new TextEncoder().encode(plaintext) :
      new Uint8Array(plaintext);
    var iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    return crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv, tagLength: AES_TAG_LENGTH_BITS },
      this.masterKey,
      data
    ).then(function(ciphertext) {
      return {
        iv: Array.from(iv),
        ciphertext: Array.from(new Uint8Array(ciphertext)),
        algorithm: 'AES-GCM-256'
      };
    });
  }

  decrypt(packageData) {
    this._assertUnlocked();
    return crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(packageData.iv),
        tagLength: AES_TAG_LENGTH_BITS
      },
      this.masterKey,
      new Uint8Array(packageData.ciphertext)
    ).then(function(plaintext) {
      return new Uint8Array(plaintext);
    });
  }

  _assertUnlocked() {
    if (!this.masterKey) {
      this._notifyREM('error', 'Operacion requiere desbloqueo', NAP_CODES.VAULT_LOCKED);
      throw new Error('Vault locked');
    }
  }

  lock() {
    this.masterKey = null;
    this._isLocked = true;
    this._notifyREM('info', 'Vault bloqueado', 'VAULT_LOCKED');
  }

  isLocked() {
    return this._isLocked || !this.masterKey;
  }

  destroy() {
    this._notifyREM('warn', 'Destruyendo vault...', NAP_CODES.VAULT_DESTROYED);
    this.lock();
    this._cleanupDB();
    this.identity = null;
    this._memoryStorage.clear();
    this._destroyed = true;
    CryptoVault._instance = null;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexo:vault:destroyed'));
    }
  }

  _cleanupDB() {
    if (this.db) {
      try { this.db.close(); } catch (e) {}
      this.db = null;
    }
  }

  _getFromStorage(key) {
    var self = this;
    if (this._useMemoryFallback) {
      var item = this._memoryStorage.get(key);
      return Promise.resolve(item ? JSON.parse(item) : null);
    }
    return new Promise(function(resolve, reject) {
      try {
        if (!self.db) {
          resolve(null);
          return;
        }
        var tx = self.db.transaction(['keys'], 'readonly');
        var store = tx.objectStore('keys');
        var req = store.get(key);
        req.onsuccess = function() { resolve(req.result && req.result.value ? req.result.value : null); };
        req.onerror = function() { reject(req.error); };
      } catch (e) {
        reject(e);
      }
    });
  }
}

var VAULT_CONTACTS_KEY = 'nexo_vault_contacts';
var VAULT_MESSAGES_PREFIX = 'nexo_vault_msgs_';

function _vaultGetStorage() {
  try { return window.localStorage; } catch (e) { return null; }
}

export function vaultLoadContacts() {
  var storage = _vaultGetStorage();
  if (!storage) return [];
  try {
    var raw = storage.getItem(VAULT_CONTACTS_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

export function vaultSaveContact(contact) {
  var storage = _vaultGetStorage();
  if (!storage) return false;
  try {
    var contacts = vaultLoadContacts();
    var idx = contacts.findIndex(function(c) { return c.nexoId === contact.nexoId; });
    var now = Date.now();
    var normalized = {
      nexoId: contact.nexoId || '',
      displayName: contact.displayName || contact.name || '',
      avatarColor: contact.avatarColor || '',
      deviceName: contact.deviceName || contact.displayName || contact.name || '',
      createdAt: contact.createdAt || now,
      lastSeen: contact.lastSeen || now,
      isGuardian: !!contact.isGuardian,
      trustScore: contact.trustScore || 0,
      verifiedInPerson: !!contact.verifiedInPerson,
      messageFrequency: contact.messageFrequency || 0,
      proximityScore: contact.proximityScore || 0,
      publicKey: contact.publicKey || ''
    };
    if (idx >= 0) {
      contacts[idx] = Object.assign({}, contacts[idx], normalized, { createdAt: contacts[idx].createdAt || now });
    } else {
      contacts.push(normalized);
    }
    storage.setItem(VAULT_CONTACTS_KEY, JSON.stringify(contacts));
    return true;
  } catch (e) { return false; }
}

export function vaultFindContactByNexoId(nexoId) {
  var contacts = vaultLoadContacts();
  return contacts.find(function(c) { return c.nexoId === nexoId; }) || null;
}

export function vaultLoadMessages(contactNexoId) {
  var storage = _vaultGetStorage();
  if (!storage || !contactNexoId) return [];
  try {
    var raw = storage.getItem(VAULT_MESSAGES_PREFIX + contactNexoId);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

export function vaultAppendMessage(contactNexoId, message) {
  var storage = _vaultGetStorage();
  if (!storage || !contactNexoId) return false;
  try {
    var messages = vaultLoadMessages(contactNexoId);
    var normalized = {
      msgId: message.msgId || message.messageId || ('msg_' + Date.now()),
      text: message.text || message.content || '',
      senderNexoId: message.senderNexoId || message.sender || '',
      senderName: message.senderName || '',
      timestamp: message.timestamp || message.ts || Date.now(),
      status: message.status || 'pending',
      _own: !!message._own
    };
    var existingIdx = messages.findIndex(function(m) { return m.msgId === normalized.msgId; });
    if (existingIdx >= 0) {
      messages[existingIdx] = Object.assign({}, messages[existingIdx], normalized);
    } else {
      messages.push(normalized);
    }
    if (messages.length > 1000) messages = messages.slice(messages.length - 1000);
    storage.setItem(VAULT_MESSAGES_PREFIX + contactNexoId, JSON.stringify(messages));
    return true;
  } catch (e) { return false; }
}

export function vaultUpdateMessageStatus(contactNexoId, msgId, status) {
  var storage = _vaultGetStorage();
  if (!storage || !contactNexoId || !msgId) return false;
  try {
    var messages = vaultLoadMessages(contactNexoId);
    var idx = messages.findIndex(function(m) { return m.msgId === msgId; });
    if (idx >= 0) {
      messages[idx].status = status;
      storage.setItem(VAULT_MESSAGES_PREFIX + contactNexoId, JSON.stringify(messages));
      return true;
    }
    return false;
  } catch (e) { return false; }
}

export default CryptoVault;
