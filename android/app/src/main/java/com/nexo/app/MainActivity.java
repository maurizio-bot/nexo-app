package com.nexo.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.nexo.ble.NexoBlePlugin;
import com.nexo.ble.NexoNearbyPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    registerPlugin(NexoBlePlugin.class);
    registerPlugin(NexoNearbyPlugin.class);
  }
}
