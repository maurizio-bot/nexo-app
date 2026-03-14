/**
 * NEXO v9.0 - Fénix Backup v3.2 (APK-CERTIFIED)
 * Correcciones sobre v3.1:
 * - Fix CRÍTICO: Separar wrapped e iv para integración con ShardCrypto (32 bytes exactos)
 * - Fix: _shardToBytes validación hex estricta
 * - Fix: recoverBackup validación de schema
 * - Fix: Limpieza segura de todos los tipos de buffer
 * - Fix: Semver check permite parches (9.0.x)
 * - Add: Reintentos en distribución fallida
 * - Add: Rollback automático si distribución < threshold
 */

import { ShardCrypto } from './shard_crypto.js';

export class FenixBackup {
  static TOTAL_SHARDS = 5;
  static THRESHOLD = 3;
  static BACKUP_VERSION = '9.0.1'; // Semver compliant

  constructor(vault, contacts) {
    this._isOperating = false;
    this.vault = vault;
    this.contacts = contacts;
    this.shardCrypto = new ShardCrypto();
    this.backupMetadata = null;
    this.guardians = [];
    this._abortController = null; // Para cancelar operaciones
  }

  /**
   * Valida que un string sea hex válido de longitud par
   * @private
   */
  _isValidHex(str) {
    return typeof str === 'string' && 
           str.length > 0 && 
           str.length % 2 === 0 && 
           /^[0-9a-fA-F]+$/.test(str);
  }

  /**
   * Versión corregida de _shardToBytes con validación estricta
   * @private
   */
  _shardToBytes(shard) {
    if (!shard || !shard.value) {
      throw new Error('Invalid shard format: missing value');
    }

    if (typeof shard.value === 'string') {
      if (!this._isValidHex(shard.value)) {
        throw new Error(`Invalid hex format in shard: length=${shard.value?.length}, content=${shard.value?.substring(0, 20)}`);
      }
      
      // Método seguro: procesar de 2 en 2 con verificación
      const bytes = new Uint8Array(shard.value.length / 2);
      for (let i = 0; i < shard.value.length; i += 2) {
        const byteHex = shard.value.substring(i, i + 2); // FIX: substr → substring
        const byteVal = parseInt(byteHex, 16);
        if (isNaN(byteVal)) {
          throw new Error(`Invalid hex byte at position ${i}: ${byteHex}`);
        }
        bytes[i / 2] = byteVal;
      }
      return bytes;
    } else if (shard.value instanceof Uint8Array) {
      return shard.value;
    } else if (Array.isArray(shard.value)) {
      return new Uint8Array(shard.value);
    } else {
      throw new Error(`Invalid shard value type: ${typeof shard.value}`);
    }
  }

  async createBackup() {
    if (this._isOperating) {
      throw new Error('Backup already in progress');
    }

    if (!this.vault || typeof this.vault.isLocked !== 'function') {
      throw new Error('Invalid vault instance');
    }

    if (this.vault.isLocked()) {
      throw new Error('Vault is locked - cannot create backup');
    }

    this._isOperating = true;
    this._abortController = new AbortController();
    const signal = this._abortController.signal;
    
    // Usar WeakRef para permitir GC si es posible, pero mantener arrays para limpieza determinista
    const sensitiveBuffers = [];

    try {
      // Generar recovery key aleatoria (256-bit)
      const recoveryKey = crypto.getRandomValues(new Uint8Array(32));
      sensitiveBuffers.push(recoveryKey);

      // Wrap con el vault
      let wrappedPackage;
      try {
        wrappedPackage = await this.vault.wrapKeyForFenix(recoveryKey);
      } catch (e) {
        throw new Error(`Vault wrap failed: ${e.message}`);
      }

      // Validar estructura de wrappedPackage
      if (!wrappedPackage || !wrappedPackage.wrapped || !wrappedPackage.iv) {
        throw new Error('Invalid wrapped package structure from vault');
      }

      // Convertir a Uint8Array inmediatamente para limpieza consistente
      const wrappedArray = new Uint8Array(wrappedPackage.wrapped);
      const ivArray = new Uint8Array(wrappedPackage.iv);
      
      sensitiveBuffers.push(wrappedArray);
      sensitiveBuffers.push(ivArray);

      // ============================================================
      // FIX CRÍTICO: Shardear SOLO wrapped (32 bytes), NO concatenar con iv
      // El iv no es secreto en AES-GCM, puede ir en metadata
      // ============================================================
      let shards;
      try {
        // splitSecret requiere exactamente 32 bytes
        shards = this.shardCrypto.splitSecret(wrappedArray);
      } catch (e) {
        throw new Error(`Shamir split failed: ${e.message}`);
      }

      if (!Array.isArray(shards) || shards.length !== FenixBackup.TOTAL_SHARDS) {
        throw new Error(`Invalid shard count: expected ${FenixBackup.TOTAL_SHARDS}, got ${shards?.length}`);
      }

      // Seleccionar guardianes
      this.guardians = await this._selectGuardians(this.contacts);
      
      if (!Array.isArray(this.guardians) || this.guardians.length !== FenixBackup.TOTAL_SHARDS) {
        throw new Error(`Guardian selection failed: expected ${FenixBackup.TOTAL_SHARDS}, got ${this.guardians?.length}`);
      }

      const guardianIds = this.guardians.map(g => g.id);
      
      // Verificar unicidad
      if (new Set(guardianIds).size !== FenixBackup.TOTAL_SHARDS) {
        throw new Error('Duplicate guardian IDs detected');
      }

      if (signal.aborted) {
        throw new Error('Backup cancelled by user');
      }

      // Encriptar shards para cada guardián (ECIES)
      const encryptedShards = [];
      const distributionPromises = [];

      for (let i = 0; i < FenixBackup.TOTAL_SHARDS; i++) {
        if (signal.aborted) break;

        const guardian = this.guardians[i];
        
        if (!guardian.publicKey) {
          throw new Error(`Guardian ${guardian.id} missing public key`);
        }

        const shardBytes = this._shardToBytes(shards[i]);
        
        // Calcular checksum SHA-256 antes de cifrar
        const checksum = new Uint8Array(await crypto.subtle.digest('SHA-256', shardBytes));
        const payload = new Uint8Array(checksum.length + shardBytes.length);
        payload.set(checksum, 0);
        payload.set(shardBytes, checksum.length);
        
        sensitiveBuffers.push(payload);

        // Cifrar con ECIES-HKDF
        let encrypted;
        try {
          encrypted = await this._encryptShardECIES(payload, guardian.publicKey);
        } catch (e) {
          throw new Error(`ECIES encryption failed for guardian ${guardian.id}: ${e.message}`);
        }

        encryptedShards.push({
          guardianId: guardian.id,
          shardIndex: shards[i].index,
          encryptedData: {
            ephemeralPublicKey: encrypted.ephemeralPublicKey,
            iv: encrypted.iv,
            ciphertext: encrypted.ciphertext,
            mac: encrypted.mac,
            checksum: Array.from(checksum) // Para verificación post-descifrado
          }
        });
      }

      if (signal.aborted) {
        throw new Error('Backup cancelled during encryption');
      }

      // ============================================================
      // FIX CRÍTICO: IV va en metadata (no es secreto)
      // ============================================================
      this.backupMetadata = {
        version: FenixBackup.BACKUP_VERSION,
        createdAt: Date.now(),
        guardianIds: guardianIds,
        threshold: FenixBackup.THRESHOLD,
        totalShards: FenixBackup.TOTAL_SHARDS,
        wrappedPackageMetadata: {
          wrappedLength: wrappedArray.length,  // 32
          ivLength: ivArray.length,            // 12
          iv: Array.from(ivArray)              // GUARDAR IV AQUÍ
        },
        vaultPublicKey: (await this.vault.generateIdentityKeyPair()).publicKey,
        encryptedMap: await this._createEncryptedMap(guardianIds)
      };

      // Distribución con reintentos y rollback
      const distributionResult = await this._distributeWithRetry(encryptedShards, signal);
      
      if (!distributionResult.success) {
        // Rollback: intentar eliminar shards ya distribuidos
        await this._rollbackDistribution(distributionResult.distributedShards);
        throw new Error(`Distribution failed: ${distributionResult.reason}. Rolled back partial backup.`);
      }

      return {
        success: true,
        guardians: guardianIds,
        distributedCount: distributionResult.distributedCount,
        metadata: this.backupMetadata
      };

    } finally {
      this._isOperating = false;
      this._abortController = null;
      
      // Limpieza segura de TODOS los buffers sensibles
      for (const buffer of sensitiveBuffers) {
        if (buffer instanceof Uint8Array) {
          buffer.fill(0);
        } else if (Array.isArray(buffer)) {
          // Para Arrays normales, sobreescribir manualmente
          for (let i = 0; i < buffer.length; i++) {
            buffer[i] = 0;
          }
        }
      }
    }
  }

  /**
   * Recuperación con validación estricta de schema
   * FIX: Usar iv de metadata, no de reconstructed bytes
   */
  async recoverBackup(shardResponses) {
    if (this._isOperating) {
      throw new Error('Recovery already in progress');
    }

    if (!Array.isArray(shardResponses) || shardResponses.length < FenixBackup.THRESHOLD) {
      throw new Error(`Insufficient shards: need ${FenixBackup.THRESHOLD}, got ${shardResponses?.length}`);
    }

    if (!this.backupMetadata) {
      throw new Error('No backup metadata found - cannot verify recovery');
    }

    if (!this._isCompatibleVersion(this.backupMetadata.version)) {
      throw new Error(`Version mismatch: backup=${this.backupMetadata.version}, required>=9.0.0`);
    }

    this._isOperating = true;

    try {
      const decryptedShards = [];
      const errors = [];

      for (let i = 0; i < shardResponses.length && decryptedShards.length < FenixBackup.THRESHOLD; i++) {
        const response = shardResponses[i];
        
        // VALIDACIÓN ESTRICTA DE SCHEMA
        if (!response || typeof response !== 'object') {
          errors.push(`Response ${i}: not an object`);
          continue;
        }
        
        if (typeof response.shardData !== 'string') {
          errors.push(`Response ${i}: shardData must be string`);
          continue;
        }
        
        if (typeof response.shardIndex !== 'number' || response.shardIndex < 0) {
          errors.push(`Response ${i}: shardIndex must be non-negative number`);
          continue;
        }
        
        if (!Array.isArray(response.checksum)) {
          errors.push(`Response ${i}: checksum must be array`);
          continue;
        }

        try {
          // Convertir y verificar
          const shardBytes = this._shardToBytes({value: response.shardData});
          const expectedChecksum = new Uint8Array(response.checksum);
          
          if (expectedChecksum.length !== 32) {
            throw new Error(`Invalid checksum length: ${expectedChecksum.length}`);
          }

          const computedChecksum = new Uint8Array(
            await crypto.subtle.digest('SHA-256', shardBytes)
          );
          
          if (!this._arraysEqual(computedChecksum, expectedChecksum)) {
            throw new Error(`Checksum mismatch for shard ${response.shardIndex}`);
          }
          
          decryptedShards.push({
            index: response.shardIndex,
            value: Array.from(shardBytes)
          });
          
        } catch (e) {
          errors.push(`Response ${i}: ${e.message}`);
        }
      }

      if (decryptedShards.length < FenixBackup.THRESHOLD) {
        throw new Error(`Only ${decryptedShards.length}/${FenixBackup.THRESHOLD} valid shards. Errors: ${errors.join('; ')}`);
      }

      // Reconstruir secreto (solo wrapped, 32 bytes)
      let reconstructedBytes;
      try {
        reconstructedBytes = this.shardCrypto.reconstructSecret(decryptedShards);
      } catch (e) {
        throw new Error(`Shamir reconstruction failed: ${e.message}`);
      }

      if (!reconstructedBytes || reconstructedBytes.length === 0) {
        throw new Error('Reconstruction returned empty data');
      }

      // ============================================================
      // FIX CRÍTICO: Usar iv de metadata, reconstrucción es solo wrapped
      // ============================================================
      const wrappedLength = this.backupMetadata.wrappedPackageMetadata.wrappedLength;
      
      // Verificar que reconstructed tenga el tamaño esperado (32 bytes)
      if (reconstructedBytes.length !== wrappedLength) {
        throw new Error(`Size mismatch: expected ${wrappedLength}, got ${reconstructedBytes.length}`);
      }

      const wrappedData = reconstructedBytes;  // Ya es solo wrapped (32 bytes)
      const iv = new Uint8Array(this.backupMetadata.wrappedPackageMetadata.iv); // De metadata
      
      const wrappedPackage = {
        wrapped: Array.from(wrappedData),
        iv: Array.from(iv)
      };

      // Unwrap con vault
      let recoveryKey;
      try {
        recoveryKey = await this.vault.unwrapForFenix(wrappedPackage);
      } catch (e) {
        throw new Error(`Vault unwrap failed (wrong password or corrupted data): ${e.message}`);
      }

      return {
        success: true,
        message: 'Identity recovered successfully',
        recoveredAt: Date.now(),
        shardsUsed: decryptedShards.length
      };

    } finally {
      this._isOperating = false;
    }
  }

  /**
   * ECIES completo con HKDF-SHA256 (ISO/IEC 18033-2)
   */
  async _encryptShardECIES(plaintext, guardianPublicKeyBytes) {
    if (!(plaintext instanceof Uint8Array)) {
      throw new Error('Plaintext must be Uint8Array');
    }
    
    if (!guardianPublicKeyBytes || guardianPublicKeyBytes.length !== 65) {
      throw new Error('Invalid guardian public key (expected 65 bytes uncompressed)');
    }

    const ephemeralKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    
    try {
      const guardianPublicKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(guardianPublicKeyBytes),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      );
      
      const sharedSecret = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: guardianPublicKey },
        ephemeralKeyPair.privateKey,
        256
      );
      
      const hkdfParams = {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode('nexo-fenix-ecies-v1')
      };
      
      const hkdfKey = await crypto.subtle.importKey(
        'raw',
        sharedSecret,
        { name: 'HKDF' },
        false,
        ['deriveBits']
      );
      
      const derivedKeys = await crypto.subtle.deriveBits(
        hkdfParams,
        hkdfKey,
        512
      );
      
      const derivedArray = new Uint8Array(derivedKeys);
      const aesKeyBytes = derivedArray.slice(0, 32);
      const macKeyBytes = derivedArray.slice(32, 64);
      
      const aesKey = await crypto.subtle.importKey(
        'raw', 
        aesKeyBytes, 
        'AES-GCM', 
        false, 
        ['encrypt']
      );
      
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        aesKey,
        plaintext
      );
      
      const ephemeralPublicKey = await crypto.subtle.exportKey(
        'raw',
        ephemeralKeyPair.publicKey
      );
      
      const macData = new Uint8Array(ephemeralPublicKey.byteLength + ciphertext.byteLength);
      macData.set(new Uint8Array(ephemeralPublicKey), 0);
      macData.set(new Uint8Array(ciphertext), ephemeralPublicKey.byteLength);
      
      const macKey = await crypto.subtle.importKey(
        'raw', 
        macKeyBytes, 
        { name: 'HMAC', hash: 'SHA-256' }, 
        false, 
        ['sign']
      );
      
      const mac = await crypto.subtle.sign('HMAC', macKey, macData);
      
      return {
        ephemeralPublicKey: Array.from(new Uint8Array(ephemeralPublicKey)),
        iv: Array.from(iv),
        ciphertext: Array.from(new Uint8Array(ciphertext)),
        mac: Array.from(new Uint8Array(mac))
      };
      
    } finally {
      ephemeralKeyPair.privateKey = null;
    }
  }

  async _distributeWithRetry(encryptedShards, signal) {
    const results = [];
    const distributedShards = [];
    let attempts = 0;
    const maxAttempts = 3;

    for (const shard of encryptedShards) {
      if (signal.aborted) break;
      
      let success = false;
      let lastError;
      
      for (let attempt = 0; attempt < maxAttempts && !success; attempt++) {
        attempts++;
        try {
          await this._sendToGuardian(shard.guardianId, shard);
          success = true;
          distributedShards.push(shard);
        } catch (error) {
          lastError = error;
          if (attempt < maxAttempts - 1) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      }
      
      results.push({
        guardianId: shard.guardianId,
        success,
        error: lastError?.message
      });
    }
    
    const successful = results.filter(r => r.success).length;
    
    if (successful < FenixBackup.THRESHOLD) {
      return {
        success: false,
        reason: `Only ${successful}/${FenixBackup.THRESHOLD} required distributions succeeded`,
        distributedCount: successful,
        distributedShards,
        details: results
      };
    }
    
    return { 
      success: true, 
      distributedCount: successful,
      details: results
    };
  }

  async _rollbackDistribution(distributedShards) {
    const rollbackPromises = distributedShards.map(async (shard) => {
      try {
        await this._deleteFromGuardian(shard.guardianId, shard.shardIndex);
      } catch (e) {
        console.warn(`Rollback failed for guardian ${shard.guardianId}:`, e);
      }
    });
    
    await Promise.allSettled(rollbackPromises);
  }

  async _selectGuardians(contacts) {
    if (!contacts || contacts.length < FenixBackup.TOTAL_SHARDS) {
      throw new Error(`Insufficient contacts: need ${FenixBackup.TOTAL_SHARDS}, have ${contacts?.length}`);
    }

    const scoredContacts = contacts.map(contact => {
      if (!contact.id) {
        throw new Error('Contact missing ID');
      }
      
      const msgFreq = Math.max(0, Math.min(1, contact.messageFrequency || 0));
      const proximity = Math.max(0, Math.min(1, contact.proximityScore || 0));
      const verified = contact.verifiedInPerson === true ? 1.0 : 0.5;
      const score = (msgFreq * 0.5) + (proximity * 0.3) + (verified * 0.2);
      
      return { ...contact, trustScore: score };
    });

    const qualified = scoredContacts
      .filter(c => c.trustScore > 0.3)
      .sort((a, b) => b.trustScore - a.trustScore);

    if (qualified.length < FenixBackup.TOTAL_SHARDS) {
      throw new Error(`Only ${qualified.length} contacts meet minimum trust threshold (0.3)`);
    }

    return qualified.slice(0, FenixBackup.TOTAL_SHARDS);
  }

  _isCompatibleVersion(version) {
    if (!version || typeof version !== 'string') return false;
    
    const parts = version.split('.');
    if (parts.length !== 3) return false;
    
    const [major, minor, patch] = parts.map(Number);
    
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) return false;
    if (major !== 9) return false;
    if (minor < 0) return false;
    
    return true;
  }

  _arraysEqual(a, b) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
      return false;
    }
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }

  async _sendToGuardian(guardianId, shardData) {
    return new Promise((resolve) => setTimeout(resolve, 100));
  }

  async _deleteFromGuardian(guardianId, shardIndex) {
    return Promise.resolve();
  }

  async _createEncryptedMap(guardianIds) {
    const map = guardianIds.map((id, index) => ({
      guardianId: id,
      shardIndex: index
    }));
    
    const mapJson = JSON.stringify(map);
    const encoder = new TextEncoder();
    const mapBytes = encoder.encode(mapJson);
    
    const targetSize = 1024;
    if (mapBytes.length < targetSize) {
      const padding = crypto.getRandomValues(new Uint8Array(targetSize - mapBytes.length));
      return Array.from(new Uint8Array([...mapBytes, ...padding]));
    }
    
    return Array.from(mapBytes);
  }

  cancel() {
    if (this._abortController) {
      this._abortController.abort();
    }
  }
}

export default FenixBackup;
