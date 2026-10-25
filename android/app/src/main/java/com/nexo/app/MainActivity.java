package com.nexo.app;

import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
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

    // Auditoría de robustez (ronda 2774): si el proceso del WebView muere (p. ej. Android recupera memoria, o una
    // imagen/vídeo con un fallo lo tira), Capacitor por defecto devuelve false y el sistema CIERRA la app. En su lugar
    // rehacemos la pantalla (los chats se recargan del disco) y devolvemos true para que no se cierre. Lo nativo
    // (Bluetooth, Wi-Fi) sigue vivo en el servicio en primer plano aunque se rehaga la ventana.
    try {
      this.getBridge().addWebViewListener(new WebViewListener() {
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
          Log.w("NEXO", "El proceso del WebView murió" + (detail != null && detail.didCrash() ? " (fallo)" : " (memoria)") + ": se rehace la pantalla");
          try { runOnUiThread(() -> { try { recreate(); } catch (Exception e) {} }); } catch (Exception e) {}
          return true; // true = lo manejamos nosotros: Android no cierra la app
        }
      });
    } catch (Exception e) {
      Log.w("NEXO", "No se pudo registrar la recuperación del WebView: " + e.getMessage());
    }
  }
}
