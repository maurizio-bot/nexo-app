import { registerPlugin } from '@capacitor/core';

export interface NexoBLEPlugin {
  initialize(options: { userId: string }): Promise<{ userId: string }>;
  
  startAdvertising(): Promise<void>;
  stopAdvertising(): Promise<void>;
  
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  
  connect(options: { deviceId: string }): Promise<void>;
  disconnect(options: { deviceId: string }): Promise<void>;
  
  sendMessage(options: { deviceId: string; data: number[] }): Promise<void>;
  
  addListener(
    eventName: 'onPeerDiscovered',
    listener: (peer: { id: string; rssi: number; name: string; userId?: string }) => void
  ): Promise<{ remove: () => void }>;
  
  addListener(
    eventName: 'onConnectionStateChanged',
    listener: (state: { deviceId: string; state: 'connected' | 'disconnected' }) => void
  ): Promise<{ remove: () => void }>;
  
  addListener(
    eventName: 'onMessageReceived',
    listener: (msg: { deviceId: string; data: number[] }) => void
  ): Promise<{ remove: () => void }>;
  
  addListener(
    eventName: 'onHandshakeReceived',
    listener: (data: { deviceId: string; type: number; payload: number[] }) => void
  ): Promise<{ remove: () => void }>;
}

const NexoBLE = registerPlugin<NexoBLEPlugin>('NexoBLE', {
  web: () => import('./web').then(m => new m.NexoBLEWeb()),
});

export { NexoBLE };
