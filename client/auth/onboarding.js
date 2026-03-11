// client/auth/onboarding.js - MÉTODO ADICIONAL PARA BIOMETRÍA
// Agrega este método dentro de tu clase OnboardingController existente:

async showBiometricScreen() {
  return new Promise((resolve) => {
    const screen = document.createElement('div');
    screen.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: #0a0a0a; z-index: 100000;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 40px; color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;
    
    screen.innerHTML = `
      <div style="font-size: 64px; margin-bottom: 20px;">🔐</div>
      <h2 style="font-size: 24px; margin-bottom: 12px; font-weight: 600;">Protege tu cuenta</h2>
      <p style="color: #888; text-align: center; margin-bottom: 40px; line-height: 1.5; font-size: 16px;">
        Usa Face ID, Huella Digital o PIN<br>para acceder a NEXO de forma segura
      </p>
      
      <button id="btn-setup-bio" style="
        background: #00ff88; color: #0a0a0a; border: none;
        padding: 16px 40px; border-radius: 30px;
        font-size: 16px; font-weight: bold; cursor: pointer;
        margin-bottom: 16px; width: 100%; max-width: 300px;
      ">Configurar Ahora</button>
      
      <button id="btn-skip-bio" style="
        background: transparent; color: #666; border: 1px solid #333;
        padding: 12px 40px; border-radius: 30px;
        font-size: 14px; cursor: pointer; width: 100%; max-width: 300px;
      ">Omitir por ahora</button>
    `;
    
    document.body.appendChild(screen);
    
    // Importar WebAuthnHelper dinámicamente o usar el import existente
    screen.querySelector('#btn-setup-bio').onclick = async () => {
      try {
        const { WebAuthnHelper } = await import('./webauthn_helper.js');
        const helper = new WebAuthnHelper();
        await helper.register({
          userName: `nexo_user_${Date.now()}`,
          displayName: 'NEXO User'
        });
        
        // Éxito
        screen.style.transition = 'opacity 0.3s';
        screen.style.opacity = '0';
        setTimeout(() => {
          screen.remove();
          resolve(true);
        }, 300);
        
      } catch (e) {
        console.error('WebAuthn error:', e);
        alert('No se pudo configurar biometría: ' + e.message + '\n\nPuedes omitir este paso y configurarlo más tarde en ajustes.');
      }
    };
    
    screen.querySelector('#btn-skip-bio').onclick = () => {
      screen.style.transition = 'opacity 0.3s';
      screen.style.opacity = '0';
      setTimeout(() => {
        screen.remove();
        resolve(false);
      }, 300);
    };
  });
}

// Asegúrate de llamar este método en el flujo de start(), por ejemplo:
// async start() {
//   await this.showWelcomeScreen();
//   await this.showBiometricScreen(); // <-- AGREGAR ESTA LÍNEA
//   await this.showBackupScreen();
//   await this.showQRScreen();
//   await this.showCompletionScreen();
// }
