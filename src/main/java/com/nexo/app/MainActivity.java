package com.nexo.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.nexo.ble.NexoBlePlugin;  // Plugin BLE NEXO v1.2-NAP

/**
 * NEXO MainActivity - NAP 2.0 Certified
 * 
 * Registro manual de plugins nativos para Capacitor 5.x
 * El plugin NexoBLE debe registrarse explícitamente para ser detectado
 * por el Capacitor Bridge en tiempo de ejecución.
 * 
 * @version 9.0-NAP
 * @author NEXO Team
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // NAP 2.0: Registro explícito del plugin BLE nativo
        // Esto es requerido para plugins locales (file:./plugins/nexo-ble)
        // que no son detectados automáticamente por Capacitor CLI
        registerPlugin(NexoBlePlugin.class);
        
        // Log de inicialización (visible en Android Studio Logcat)
        android.util.Log.d("NexoMain", "NexoBLE Plugin registrado - NAP 2.0");
    }
}
