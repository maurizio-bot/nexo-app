import { OnboardingController } from './auth/onboarding.js';

// Detectar primera vez
const vault = new CryptoVault();
let needsOnboarding = false;

try {
  await vault.init();
} catch (e) {
  // Vault vacío = primera vez
  needsOnboarding = true;
}

if (needsOnboarding) {
  const onboarding = new OnboardingController({
    container: document.body,
    vault: vault,
    onComplete: () => window.location.reload()
  });
  await onboarding.start();
} else {
  // App normal...
}
