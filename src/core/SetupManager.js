/**
 * NEXO Setup Manager v1.4-NAP
 * Checkpoint: 16-04-2026 - Agregado import checkBLEStatus y verificación REAL de BLE
 */

import { checkBLEStatus } from './ble_permissions.js';

class SetupManager {
  constructor() {
    this.STORAGE_KEY = 'nexo_setup_v1_completed';
    this.setupCompleted = false;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return true;
    try {
      const setupFlag = localStorage.getItem(this.STORAGE_KEY);
      this.setupCompleted = setupFlag === 'true';
      this.initialized = true;
      console.log('[SetupManager] Initialized. Setup completed:', this.setupCompleted);
      return true;
    } catch (error) {
      console.error('[SetupManager] Initialization error:', error);
      return false;
    }
  }

  async checkInitialStatus() {
    if (!this.initialized) await this.initialize();
    try {
      const bleStatus = await checkBLEStatus();
      console.log('[SetupManager] BLE Status check:', bleStatus);
      if (!bleStatus.operational) {
        console.log('[SetupManager] BLE not operational, forcing setup re-run');
        return { completed: false, reason: bleStatus.reason || 'BLE_NOT_OPERATIONAL', bleStatus: bleStatus };
      }
      if (this.setupCompleted) {
        return { completed: true, reason: 'SETUP_COMPLETED_AND_BLE_OPERATIONAL', bleStatus: bleStatus };
      }
      return { completed: false, reason: 'BLE_OPERATIONAL_BUT_SETUP_INCOMPLETE', bleStatus: bleStatus };
    } catch (error) {
      console.error('[SetupManager] Error checking BLE status:', error);
      return { completed: false, reason: 'BLE_CHECK_ERROR', error: error.message };
    }
  }

  async markSetupComplete() {
    try {
      localStorage.setItem(this.STORAGE_KEY, 'true');
      this.setupCompleted = true;
      console.log('[SetupManager] Setup marked as complete');
      return true;
    } catch (error) {
      console.error('[SetupManager] Error marking setup complete:', error);
      return false;
    }
  }

  async resetSetup() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      this.setupCompleted = false;
      console.log('[SetupManager] Setup reset');
      return true;
    } catch (error) {
      console.error('[SetupManager] Error resetting setup:', error);
      return false;
    }
  }

  isSetupMarkedComplete() {
    return this.setupCompleted;
  }
}

export const setupManager = new SetupManager();
export default SetupManager;
// NAP-FORCE-1776453587
