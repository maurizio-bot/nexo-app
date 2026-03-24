import { WebPlugin } from '@capacitor/core';
import type { NexoBLEPlugin } from './index';

export class NexoBLEWeb extends WebPlugin implements NexoBLEPlugin {
  async initialize(options: { userId: string }): Promise<{ userId: string }> {
    console.warn('[NexoBLE] Web implementation - BLE not available in browser');
    return { userId: options.userId };
  }
  
  async startAdvertising(): Promise<void> {
    throw new Error('BLE advertising not supported in web');
  }
  
  async stopAdvertising(): Promise<void> {
    throw new Error('BLE advertising not supported in web');
  }
  
  async startScan(): Promise<void> {
    throw new Error('BLE scanning not supported in web');
  }
  
  async stopScan(): Promise<void> {
    throw new Error('BLE scanning not supported in web');
  }
  
  async connect(): Promise<void> {
    throw new Error('BLE connection not supported in web');
  }
  
  async disconnect(): Promise<void> {
    throw new Error('BLE disconnection not supported in web');
  }
  
  async sendMessage(): Promise<void> {
    throw new Error('BLE messaging not supported in web');
  }
}
