 import { WebPlugin } from '@capacitor/core';
import type { NexoAuthPlugin, AuthResult, BiometricOptions } from './definitions';

export class NexoAuthWeb extends WebPlugin implements NexoAuthPlugin {
  async isAvailable() {
    return { available: false, biometric: false, deviceCredential: false };
  }

  async authenticate(): Promise<AuthResult> {
    throw new Error('Biometric auth not available on web');
  }

  async setupIdentity() {
    throw new Error('Biometric setup not available on web');
  }

  async clearIdentity() {}
}
