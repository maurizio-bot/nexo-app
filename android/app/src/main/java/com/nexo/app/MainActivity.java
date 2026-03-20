package com.nexo.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.nexo.ble.NexoBlePlugin;  // Import del plugin

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    
    // REGISTRO CRÍTICO: Plugin BLE local
    registerPlugin(NexoBlePlugin.class);
  }
}
