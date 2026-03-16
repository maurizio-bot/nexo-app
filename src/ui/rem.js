  /**
   * Actualiza solo la fase (para compatibilidad con nexo_app.js)
   */
  updatePhase(phase) {
    const currentMode = this._lastMode || 'OFFLINE';
    const currentId = this._lastId || null;
    this._lastPhase = phase;
    this.updateStatus(phase, currentMode, currentId);
  }

  /**
   * Actualiza solo el modo (para compatibilidad con nexo_app.js)
   */
  updateMode(mode) {
    const currentPhase = this._lastPhase || 'INIT';
    const currentId = this._lastId || null;
    this._lastMode = mode;
    this.updateStatus(currentPhase, mode, currentId);
  }

  /**
   * Actualiza solo el ID (para compatibilidad con nexo_app.js)
   */
  updateIdentity(id) {
    const currentPhase = this._lastPhase || 'INIT';
    const currentMode = this._lastMode || 'OFFLINE';
    this._lastId = id;
    this.updateStatus(currentPhase, currentMode, id);
  }
}
