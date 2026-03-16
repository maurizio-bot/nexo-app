/**
 * NEXO v9.0 - Crypto Vault (v9.3-CRITICAL-FIX)
 * Fix: Timeout global en init + fallback inmediato a memoria
 */

const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AES_KEY_SIZE_BITS = 256;
const AES_TAG_LENGTH_BITS = 128;

// FIX CRÍTICO: Timeouts más agresivos
const INIT_TIMEOUT_MS = 5000; // Máximo 5 segundos para todo init
const DB_TIMEOUT_MS = 3000;

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
    
    CryptoVault._instance = this;
  }

  _validateEnvironment() {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('WebCrypto API not available');
    }
  }

  // FIX CRÍTICO: Init con timeout global absoluto
  async init() {
    if (this._destroyed) throw new Error('Vault destroyed');
    if (this.db || this._useMemoryFallback) return this;
    
    // Promise con timeout global
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.warn('[CryptoVault] Global init timeout - forcing memory mode');
        this._useMemoryFallback = true;
        this._setupMinimalIdentity();
        resolve(this);
      }, INIT_TIMEOUT_MS);
      
      this._doInit()
        .then(() => {
          clearTimeout(timeoutId);
          resolve(this);
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          console.warn(`[CryptoVault] Init failed: ${err.message} - using memory mode`);
          this._useMemoryFallback = true;
          this._cleanupDB();
          this._setupMinimalIdentity();
          resolve(this); // Nunca rechazamos, siempre resolvemos con fallback
        });
    });
  }

  async _doInit() {
    // Intento rápido de IndexedDB
    try {
      await this._initDBQuick();
      this.salt = await this._getSaltQuick();
    } catch (e) {
      throw new Error('IndexedDB failed');
    }
    
    // Intentar cargar/crear identidad pero con timeout
    try {
      await this._loadIdentityQuick();
    } catch (e) {
      console.warn('[CryptoVault] Identity load failed, creating minimal');
      this._setupMinimalIdentity();
    }
    
    return this;
  }

  _initDBQuick() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DB timeout')), DB_TIMEOUT_MS);
      
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
          resolve();
        };
        
        request.onerror = () => {
          clearTimeout(timeout);
          reject(request.error);
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
        const tx = this.db.transaction(['keys'], 'readonly');
        const store = tx.objectStore('keys');
        const request = store.get('master_salt');
        
        request.onsuccess = () => {
          clearTimeout(timeout);
          if (request.result?.value?.length === SALT_LENGTH_BYTES) {
            resolve(new Uint8Array(request.result.value));
          } else {
            // Crear nuevo salt
            const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
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
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  async _loadIdentityQuick() {
    // Timeout para carga de identidad
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Identity timeout')), 2000);
      
      this._getFromStorage('nexo_identity')
        .then((stored) => {
          clearTimeout(timeout);
          if (stored?.id) {
            this.identity = stored;
            console.log('[CryptoVault] Identity loaded:', this.identity.id.substring(0, 8));
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

  _setupMinimalIdentity() {
    // Crear identidad mínima inmediatamente sin operaciones criptográficas pesadas
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
    
    console.log('[CryptoVault] Minimal identity ready:', id.substring(0, 8));
  }

  getIdentity() {
    return this.identity?.id || null;
  }

  // Resto de métodos (encrypt, decrypt, etc.) permanecen iguales...
  // [Mantén el resto del código original aquí: initialize, encrypt, decrypt, etc.]

  async initialize(password) {
    if (this._destroyed) throw new Error('Vault destroyed');
    if (!this.salt && !this._useMemoryFallback) throw new Error('Call init() first');
    if (!password || password.length < 12) throw new Error('Password too short');
    
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
    if (!this.masterKey) throw new Error('Vault locked');
  }

  lock() {
    this.masterKey = null;
    this._isLocked = true;
  }

  isLocked() {
    return this._isLocked || !this.masterKey;
  }

  async destroy() {
    this.lock();
    this._cleanupDB();
    this.identity = null;
    this._memoryStorage.clear();
    this._destroyed = true;
    CryptoVault._instance = null;
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

// Exportar también como default
export default CryptoVault;
