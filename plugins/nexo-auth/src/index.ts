import { registerPlugin } from '@capacitor/core';
import type { NexoAuthPlugin } from './definitions';

const NexoAuth = registerPlugin<NexoAuthPlugin>('NexoAuth', {
  web: () => import('./web').then(m => new m.NexoAuthWeb()),
});

export * from './definitions';
export { NexoAuth };
