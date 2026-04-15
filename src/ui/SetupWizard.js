  async handleRequestPermissions(btnElement) {
    const btn = btnElement;
    
    try {
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      btn.textContent = 'Abriendo diálogo Android...';
      
      const result = await requestBLEPermissions();
      
      if (result.granted) {
        // FIX v1.4.1: Verificar estado Bluetooth explícitamente tras permisos
        const btStatus = await checkBLEStatus();
        console.log(`${NAP_WIZARD} Permisos OK, verificando BT:`, btStatus.bluetoothEnabled);
        
        if (!btStatus.bluetoothEnabled) {
          // Permisos concedidos pero BT apagado - mostrar pantalla BT
          console.log(`${NAP_WIZARD} BT apagado, cambiando a pantalla Bluetooth`);
          this.currentStep = 'bluetooth';
          this.renderBluetooth();
          return;
        }
        
        // ÉXITO TOTAL: Permisos + BT activado
        btn.style.background = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)';
        btn.textContent = '✓ Listo';
        setTimeout(() => this.onComplete(), 800);
        
      } else {
        // ... resto del código de error sin cambios ...
        console.log(`${NAP_WIZARD} Permisos no concedidos:`, result.nap_code, result);
        
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        
        const isPermanent = result.isPermanentDenial === true;
        const canRetry = result.canRetry !== false;
        
        if (isPermanent) {
          console.log(`${NAP_WIZARD} Denegación permanente detectada, modo manual`);
          this.currentStep = 'permissions_manual';
          this.renderPermissions();
          return;
        }
        
        if (!result.isUserCancelled) {
          const count = await SetupManager.recordPermissionDenied();
          this.errorCount = count;
          console.log(`${NAP_WIZARD} Contador denegaciones: ${count}`);
          
          if (count >= 2) {
            console.log(`${NAP_WIZARD} Cambiando a modo MANUAL tras ${count} fallos`);
            this.currentStep = 'permissions_manual';
            this.renderPermissions();
            return;
          }
        } else {
          console.log(`${NAP_WIZARD} Usuario canceló diálogo - permitiendo reintento`);
        }
        
        if (canRetry || result.isUserCancelled) {
          btn.textContent = result.isUserCancelled ? 'Reintentar (diálogo cerrado)' : 'Reintentar';
        } else {
          btn.textContent = 'Error - toca para reintentar';
        }
      }
      
    } catch (error) {
      console.error(`${NAP_WIZARD} Error crítico:`, error);
      
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.textContent = 'Error - Toca para reintentar';
      
      console.log(`${NAP_WIZARD} Error inesperado, manteniendo modo automático para reintento`);
    }
  }
