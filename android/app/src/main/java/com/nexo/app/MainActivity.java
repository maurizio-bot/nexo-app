package com.nexo.app;

import android.content.Intent;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.nexo.ble.NexoBlePlugin;  // Import del plugin

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Ronda 2778 (pedido del dueño): con la pantalla apagada, una llamada entrante debe ENCENDER la pantalla y aparecer
    // sobre el bloqueo. El aviso de llamada usa un full-screen intent que abre esta actividad con el extra de llamada; si
    // es ese el caso, pedimos "mostrar sobre el bloqueo" y "encender la pantalla" ANTES de nada, para que se encienda al
    // instante (si se hiciera siempre, la app se vería sobre el bloqueo al abrirla normal, lo que no queremos). Para una
    // llamada ya sonando con la app viva, el plugin hace lo mismo al recibir el intent (showOverLock).
    try {
      Intent it = getIntent();
      if (it != null && (it.hasExtra("nexo_call_from") || it.hasExtra("nexo_call_answer"))) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { setShowWhenLocked(true); setTurnScreenOn(true); }
        else {
          getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
      }
    } catch (Exception e) { Log.w("NEXO", "Pantalla de llamada sobre el bloqueo: " + e.getMessage()); }

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

  // Ronda 2801 (pedido del dueño #101): el «atrás» de Android (botón o gesto de borde) primero cierra lo que esté
  // abierto DENTRO de la app (visor de foto/vídeo, estado, cámara, chat) en vez de salir de golpe. Le preguntamos al
  // WebView por window.__nexoHandleBack(): si lo manejó (1) no hacemos nada; si no (0), el comportamiento normal de
  // Capacitor (volver en el historial o mandar la app a segundo plano). evaluateJavascript es asíncrono, así que para
  // el caso "no manejado" re-entramos con una bandera y llamamos a super.
  private boolean nexoBackDefault = false;

  @Override
  public void onBackPressed() {
    if (nexoBackDefault) { nexoBackDefault = false; super.onBackPressed(); return; }
    try {
      WebView wv = (this.getBridge() != null) ? this.getBridge().getWebView() : null;
      if (wv == null) { super.onBackPressed(); return; }
      wv.evaluateJavascript(
        "(function(){try{return (window.__nexoHandleBack&&window.__nexoHandleBack())?1:0}catch(e){return 0}})()",
        value -> {
          if (!"1".equals(value)) {
            runOnUiThread(() -> { nexoBackDefault = true; onBackPressed(); });
          }
        });
    } catch (Exception e) {
      super.onBackPressed();
    }
  }
}
