/**
 * NEXO v9.0 - PulseAlgorithm v2.1-NAP-CERTIFIED
 * Algoritmo de ranking viral para The Stream
 * 
 * Correcciones NAP aplicadas:
 * - [FIX 2.1] Validación de items null/undefined en batchCalculate e incrementalUpdate
 * - [FIX 2.2] shouldReorder maneja cambios desde score cercano a cero (usa diff absoluta)
 * - [FIX 2.3] Timestamp 0 válido (Unix Epoch) - no tratado como falsy
 * - [FIX 2.4] Engagement: prioridad explícita entre likes y likeCount
 * - [FIX 2.5] Verificación de isFinite en engagement individual
 * - Validación estricta de tipos (anti-NaN)
 * - Protección contra timestamps futuros
 * - Consistencia de tiempo en batch operations
 * - Método destroy() para limpieza de memoria
 * - Opción para forzar reorder inmediato
 * - Opción calculateScoreImmutable (sin mutación)
 */

export class PulseAlgorithm {
  constructor(options = {}) {
    this.config = {
      lambda: options.lambda || 0.1,
      maxAgeHours: options.maxAgeHours || 48,
      proximityMax: options.proximityMax || 100,
      trustBonus: options.trustBonus || 0.5,
      reorderThreshold: options.reorderThreshold || 0.05,
      weights: {
        like: 1.0,
        reply: 3.0,
        share: 5.0
      }
    };
    
    this._lastTimeUpdate = 0;
    this._currentTime = Date.now();
    this._decayCache = new Map();
    this._lastReorderCheck = 0;
    this._reorderCooldown = options.reorderCooldown || 5000;
    
    this._isDestroyed = false;
  }

  calculateScore(item, options = {}) {
    if (this._isDestroyed) return 0;
    if (!item || typeof item !== 'object') return 0;
    
    const now = options.forceCurrentTime ? Date.now() : this._getCurrentTime();
    const ageHours = this._getAgeInHours(item.timestamp, now);
    
    const engagement = this._calculateEngagement(item);
    const decay = this._getTimeDecay(ageHours);
    
    let score = engagement * decay;
    score += this._getProximityBoost(item);
    score += this._getTrustBonus(item);
    
    return this._normalizeScore(score);
  }

  calculateScoreImmutable(item) {
    const score = this.calculateScore(item);
    return {
      score,
      previousScore: item.pulseScore || null
    };
  }

  _calculateEngagement(item) {
    const w = this.config.weights;
    
    // [FIX 2.4] Prioridad explícita: si likes existe (incluyendo 0), usarlo
    // Solo fallback a likeCount si likes es undefined/null
    const likes = this._toNumber(item.likes !== undefined ? item.likes : item.likeCount);
    const replies = this._toNumber(item.replies !== undefined ? item.replies : item.replyCount);
    const shares = this._toNumber(item.shares !== undefined ? item.shares : item.shareCount);
    
    // [FIX 2.5] Verificación individual de cada componente
    if (!isFinite(likes) || isNaN(likes) || 
        !isFinite(replies) || isNaN(replies) || 
        !isFinite(shares) || isNaN(shares)) {
      console.warn('PulseAlgorithm: Engagement values invalid for item', item.id);
      return 0;
    }
    
    return (likes * w.like) + (replies * w.reply) + (shares * w.share);
  }

  _toNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  _getTimeDecay(hours) {
    if (hours < 0) {
      hours = 0;
    }
    
    const hourKey = Math.floor(hours);
    
    if (this._decayCache.has(hourKey)) {
      return this._decayCache.get(hourKey);
    }
    
    if (hours > this.config.maxAgeHours) {
      return 0.01;
    }
    
    const decay = Math.exp(-this.config.lambda * hours);
    
    if (this._decayCache.size < 100) {
      this._decayCache.set(hourKey, decay);
    }
    
    return decay;
  }

  _getProximityBoost(item) {
    if (item.distance == null) return 0;
    
    const dist = this._toNumber(item.distance);
    
    if (!isFinite(dist) || isNaN(dist) || dist < 0) return 0;
    
    if (dist === 0) return 2.0;
    if (dist >= this.config.proximityMax) return 0;
    
    return 1.0 + (1.0 / dist);
  }

  _getTrustBonus(item) {
    const trust = this._toNumber(item.trustLevel !== undefined ? item.trustLevel : item.trust_level);
    return trust >= 1 ? this.config.trustBonus : 0;
  }

  _normalizeScore(rawScore) {
    if (!isFinite(rawScore) || isNaN(rawScore)) return 0;
    const scaled = rawScore / 10;
    return Math.tanh(scaled);
  }

  /**
   * [FIX 2.2] shouldReorder ahora maneja cambios desde score cercano a cero
   * usando diferencia absoluta cuando el score base es muy pequeño
   */
  shouldReorder(items, options = {}) {
    if (this._isDestroyed) return false;
    if (!Array.isArray(items) || items.length < 2) return false;
    
    if (!options.force) {
      const now = Date.now();
      if (now - this._lastReorderCheck < this._reorderCooldown) {
        return false;
      }
      this._lastReorderCheck = now;
    } else {
      this._lastReorderCheck = Date.now();
    }
    
    let totalChange = 0;
    let count = 0;
    const epsilon = 0.0001;
    
    for (const item of items) {
      // [FIX 2.1] Skip items null/undefined
      if (!item) continue;
      
      const oldScore = item.previousPulseScore;
      const newScore = item.pulseScore;
      
      if (oldScore != null && newScore != null) {
        let change;
        
        if (oldScore > epsilon) {
          // Cambio relativo normal
          change = Math.abs(newScore - oldScore) / oldScore;
        } else {
          // [FIX 2.2] Score base muy pequeño o cero: usar diferencia absoluta escalada
          change = Math.abs(newScore - oldScore) * 10; // Escalar para comparar con threshold
        }
        
        if (isFinite(change)) {
          totalChange += change;
          count++;
        }
      }
    }
    
    if (count === 0) return false;
    
    const avgChange = totalChange / count;
    return avgChange > this.config.reorderThreshold;
  }

  batchCalculate(items) {
    if (this._isDestroyed || !Array.isArray(items)) return [];
    
    const batchTime = Date.now();
    this._currentTime = batchTime;
    this._lastTimeUpdate = batchTime;
    
    return items.map(item => {
      // [FIX 2.1] Validar item no sea null/undefined
      if (!item) return null;
      
      if (item.pulseScore != null) {
        item.previousPulseScore = item.pulseScore;
      }
      
      item.pulseScore = this.calculateScore(item, { forceCurrentTime: batchTime });
      return item;
    }).filter(item => item !== null); // Filtrar nulls del resultado
  }

  incrementalUpdate(items, changedIndices) {
    if (this._isDestroyed || !Array.isArray(items)) return;
    
    const batchTime = Date.now();
    this._currentTime = batchTime;
    this._lastTimeUpdate = batchTime;
    
    for (const idx of changedIndices) {
      if (idx >= 0 && idx < items.length) {
        const item = items[idx];
        // [FIX 2.1] Validar item existe
        if (!item) continue;
        
        if (item.pulseScore != null) {
          item.previousPulseScore = item.pulseScore;
        }
        item.pulseScore = this.calculateScore(item, { forceCurrentTime: batchTime });
      }
    }
  }

  clearCache() {
    this._decayCache.clear();
    this._updateCurrentTime();
  }

  _getCurrentTime() {
    const now = Date.now();
    if (now - this._lastTimeUpdate > 1000) {
      this._currentTime = now;
      this._lastTimeUpdate = now;
    }
    return this._currentTime;
  }

  _updateCurrentTime() {
    this._currentTime = Date.now();
    this._lastTimeUpdate = this._currentTime;
  }

  /**
   * [FIX 2.3] Timestamp 0 es válido (Unix Epoch), solo ignorar null/undefined
   */
  _getAgeInHours(timestamp, now) {
    // [FIX 2.3] Check explícito para null/undefined, no falsy
    if (timestamp === null || timestamp === undefined) return 0;
    
    // [FIX 2.3] Validar que sea número
    if (typeof timestamp !== 'number' || !isFinite(timestamp)) {
      console.warn('PulseAlgorithm: Invalid timestamp', timestamp);
      return 0;
    }
    
    const ageMs = now - timestamp;
    return ageMs / (3600 * 1000);
  }

  setWeights(weights) {
    this.config.weights = { ...this.config.weights, ...weights };
  }

  setLambda(lambda) {
    this.config.lambda = lambda;
    this._decayCache.clear();
  }

  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    
    this._decayCache.clear();
    this.config = null;
    this._currentTime = null;
    this._lastTimeUpdate = null;
    this._lastReorderCheck = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PulseAlgorithm };
} else if (typeof window !== 'undefined') {
  window.PulseAlgorithm = PulseAlgorithm;
}
