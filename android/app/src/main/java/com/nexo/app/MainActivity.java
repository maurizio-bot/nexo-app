package com.nexo.app;

import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.nexo.ble.NexoBlePlugin;  // Import del plugin

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Con el teléfono girado Android deja libre la franja de la cámara frontal y la pinta con el fondo de la ventana
    // (gris en el tema del sistema): el mismo fondo oscuro que la app
    getWindow().setBackgroundDrawable(new ColorDrawable(0xFF070812));
    
    // REGISTRO CRÍTICO: Plugin BLE local
    registerPlugin(NexoBlePlugin.class);
  }
}
