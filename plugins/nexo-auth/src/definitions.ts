export interface BiometricOptions {
  title?: string;
  subtitle?: string;
}

export interface AuthResult {
  success: boolean;
  identity: string;
  method: 'biometric' | 'device_credential';
}

export interface NexoAuthPlugin {
  isAvailable(): Promise<{ 
    available: boolean; 
    biometric: boolean; 
    deviceCredential: boolean 
  }>;
  
  authenticate(options?: BiometricOptions): Promise<AuthResult>;
  
  setupIdentity(options: { identityId: string }): Promise<{ 
    success: boolean; 
    configured: boolean 
  }>;
  
  clearIdentity(): Promise<void>;
}
