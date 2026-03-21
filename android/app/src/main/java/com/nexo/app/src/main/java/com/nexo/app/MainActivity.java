package com.nexo.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.nexo.ble.NexoBlePlugin;  // Import del plugin local

/**
 * NEXO Main Activity - NAP 2.0 Certified
 * Registra plugins nativos manualmente para Capacitor 5.x
 */
public class MainActivity extends BridgeActivity {
    
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // NAP 2.0: Registro explícito de plugin BLE local
        registerPlugin(NexoBlePlugin.class);
        
        // Aquí se pueden registrar otros plugins locales si es necesario
        // registerPlugin(OtroPlugin.class);
    }
}

