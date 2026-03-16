/**
 * NEXO v9.0 - Crypto Vault (v9.4-REM-INTEGRATED)
 * Fix: Timeout global + fallback memoria + REM feedback system
 * Códigos NAP: VAULT_INIT_TIMEOUT, VAULT_IDENTITY_FAIL, VAULT_MEMORY_FALLBACK
 */

const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AES_KEY_SIZE_BITS = 256;
const AES_TAG_LENGTH_BITS = 128;
const INIT_TIMEOUT_MS = 5000;
const DB_TIMEOUT_MS = 3000;

// NAP Error Codes para REM
const NAP_CODES = {
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
    
    // Hook a REM si existe
    this._rem = typeof window !== 'undefined' ? (window.NEXO_REM || window.NEXO_DIAG) : null;
    
    CryptoVault._instance = this;
  }

  _validateEnvironment() {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      const err = new Error('WebCrypto API not available');
      this._notifyREM('error', 'WebCrypto no disponible en este entorno', NAP_CODES.VAULT_DB_ERROR);
      throw err;
    }
  }

  /**
   * Notifica al sistema REM si está disponible
   */
  _notifyREM(type, message, code = '') {
    if (this._rem) {
      const method = type === 'error' ? 'error' : 
                    type === 'warn' ? 'warn' : 
                    type === 'success' ? 'success' : 'info';
      this._rem[method](`[Vault] ${message}`, code);
    }
    // Siempre log a consola también
    console.log(`[CryptoVault] ${type.toUpperCase()}: ${message}${code ? ` (${code})` : ''}`);
  }

  /**
   * Inicialización con timeout global y fallback garantizado
   */
  async init() {
    if (this._destroyed) {
      this._notifyREM('error', 'Intento de init en vault destruido', NAP_CODES.VAULT_DESTROYED);
      throw new Error('Vault destroyed');
    }
    
    if (this.db || this._useMemoryFallback) {
      return this;
    }
    
    this._initStartTime = performance.now();
    this._notifyREM('info', 'Iniciando vault...', 'VAULT_INIT_START');
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const elapsed = Math.round(performance.now() - this._initStartTime);
        this._notifyREM('warn', `Timeout global (${elapsed}ms) - forzando modo memoria`, NAP_CODES.VAULT_INIT_TIMEOUT);
        this._activateMemoryFallback();
        resolve(this);
      }, INIT_TIMEOUT_MS);
      
      this._doInit()
        .then(() => {
          clearTimeout(timeoutId);
          const elapsed = Math.round(performance.now() - this._initStartTime);
          const mode = this._useMemoryFallback ? 'memoria' : 'persistente';
          this._notifyREM('success', `Vault listo en ${elapsed}ms (modo ${mode})`, 'VAULT_INIT_SUCCESS');
          resolve(this);
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          this._notifyREM('warn', `Init falló: ${err.message} - usando memoria`, NAP_CODES.VAULT_MEMORY_FALLBACK);
          this._activateMemoryFallback();
          resolve(this);
        });
    });
  }

  async _doInit() {
    try {
      await this._initDBQuick();
      this.salt = await this._getSaltQuick();
    } catch (e) {
      throw new Error(`IndexedDB failed: ${e.message}`);
    }
    
    try {
      await this._loadIdentityQuick();
    } catch (e) {
      this._notifyREM('warn', 'No se pudo cargar identidad previa, creando nueva', NAP_CODES.VAULT_IDENTITY_FAIL);
      this._setupMinimalIdentity();
    }
    
    return this;
  }

  _initDBQuick() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('DB timeout'));
      }, DB_TIMEOUT_MS);
      
      try {
        const request = indexedDB.open('nexo_crypto_v9', 1);
        
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('keys')) {
            db.createObjectStore('keys', { keyPath: 'id' });
          }
        };
        
        request.onsuccess = (e) => {
          clearTimeout(timeout);
          this.db = e.target.result;
          
          // FIX v9.4: Manejar cierre inesperado de DB
          this.db.onclose = () => {
            this._notifyREM('warn', 'Base de datos cerrada inesperadamente', 'VAULT_DB_CLOSED');
            this._cleanupDB();
            this._activateMemoryFallback();
          };
          
          resolve();
        };
        
        request.onerror = () => {
          clearTimeout(timeout);
          reject(request.error);
        };
        
        request.onblocked = () => {
          clearTimeout(timeout);
          reject(new Error('DB blocked by another version'));
        };
        
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  _getSaltQuick() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Salt timeout')), DB_TIMEOUT_MS);
      
      try {
        // FIX v9.4: Verificar que DB sigue abierta antes de transacción
        if (!this.db) {
          clearTimeout(timeout);
          reject(new Error('DB not available'));
          return;
        }
        
        const tx = this.db.transaction(['keys'], 'readonly');
        const store = tx.objectStore('keys');
        const request = store.get('master_salt');
        
        request.onsuccess = () => {
          clearTimeout(timeout);
          if (request.result?.value?.length === SALT_LENGTH_BYTES) {
            resolve(new Uint8Array(request.result.value));
          } else {
            // Crear nuevo salt y guardarlo
            const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
            
            // Verificar DB nuevamente antes de escritura
            if (!this.db) {
              resolve(newSalt); // Devolver salt sin guardar (fallback temporal)
              return;
            }
            
            const tx2 = this.db.transaction(['keys'], 'readwrite');
            const store2 = tx2.objectStore('keys');
            store2.put({ id: 'master_salt', value: Array.from(newSalt) });
            resolve(newSalt);
          }
        };
        
        request.onerror = () => {
          clearTimeout(timeout);
          reject(request.error);
        };
        
        tx.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Transaction failed'));
        };
        
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  _loadIdentityQuick() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Identity timeout')), 2000);
      
      this._getFromStorage('nexo_identity')
        .then((stored) => {
          clearTimeout(timeout);
          if (stored?.id) {
            this.identity = stored;
            this._notifyREM('info', `Identidad cargada: ${this.identity.id.substring(0, 8)}...`, 'VAULT_ID_LOADED');
            resolve();
          } else {
            reject(new Error('No identity found'));
          }
        })
        .catch((e) => {
          clearTimeout(timeout);
          reject(e);
        });
    });
  }

  _activateMemoryFallback() {
    this._useMemoryFallback = true;
    this._cleanupDB();
    this._setupMinimalIdentity();
    // Notificar a nexo_app.js que estamos en modo memoria
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexo:vault:fallback', { 
        detail: { mode: 'memory', identity: this.identity?.id } 
      }));
    }
  }

  _setupMinimalIdentity() {
    const id = crypto.randomUUID ? crypto.randomUUID() : 
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
    
    this._notifyREM('info', `ID temporal asignado: ${id.substring(0, 8)}...`, 'VAULT_TEMP_ID');
  }

  getIdentity() {
    return this.identity?.id || null;
  }

  isMemoryFallback() {
    return this._useMemoryFallback;
  }

  async initialize(password) {
    if (this._destroyed) {
      this._notifyREM('error', 'Vault destruido', NAP_CODES.VAULT_DESTROYED);
      throw new Error('Vault destroyed');
    }
    
    if (!this.salt && !this._useMemoryFallback) {
      this._notifyREM('error', 'Llamar init() primero', NAP_CODES.VAULT_LOCKED);
      throw new Error('Call init() first');
    }
    
    if (!password || password.length < 12) {
      this._notifyREM('error', 'Password muy corto (<12 chars)', 'VAULT_WEAK_PASSWORD');
      throw new Error('Password too short');
    }
    
    if (!this.salt) {
      this.salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    }
    
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    try {
      const keyMaterial = await crypto.subtle.importKey(
        'raw', passwordBuffer, 'PBKDF2', false, ['deriveKey']
      );
      
      this.masterKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: this.salt,
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: AES_KEY_SIZE_BITS },
        false,
        ['encrypt', 'decrypt']
      );
      
      this._isLocked = false;
      this._notifyREM('success', 'Vault desbloqueado', 'VAULT_UNLOCKED');
      return true;
    } finally {
      passwordBuffer.fill(0);
    }
  }

  async encrypt(plaintext) {
    this._assertUnlocked();
    
    const data = typeof plaintext === 'string' ? 
      new TextEncoder().encode(plaintext) : 
      new Uint8Array(plaintext);
    
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: AES_TAG_LENGTH_BITS },
      this.masterKey,
      data
    );
    
    return {
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      algorithm: 'AES-GCM-256'
    };
  }

  async decrypt(packageData) {
    this._assertUnlocked();
    
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(packageData.iv),
        tagLength: AES_TAG_LENGTH_BITS
      },
      this.masterKey,
      new Uint8Array(packageData.ciphertext)
    );
    
    return new Uint8Array(plaintext);
  }

  _assertUnlocked() {
    if (!this.masterKey) {
      this._notifyREM('error', 'Operación requiere desbloqueo', NAP_CODES.VAULT_LOCKED);
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

  async destroy() {
    this._notifyREM('warn', 'Destruyendo vault...', NAP_CODES.VAULT_DESTROYED);
    this.lock();
    this._cleanupDB();
    this.identity = null;
    this._memoryStorage.clear();
    this._destroyed = true;
    CryptoVault._instance = null;
    
    // Notificar destrucción
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

  async _getFromStorage(key) {
    if (this._useMemoryFallback) {
      const item = this._memoryStorage.get(key);
      return item ? JSON.parse(item) : null;
    }
    
    return new Promise((resolve, reject) => {
      try {
        if (!this.db) {
          resolve(null);
          return;
        }
        const tx = this.db.transaction(['keys'], 'readonly');
        const store = tx.objectStore('keys');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result?.value || null);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  }
}

export default CryptoVault;
