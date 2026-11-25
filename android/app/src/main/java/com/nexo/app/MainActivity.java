package com.nexo.app;

import android.content.Intent;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
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
      // S-C1 (auditoría 23-11): esta pantalla está exportada; solo con el MISMO testigo que comprueba el plugin
      // (PluginAlerts.checkNotificationIntent: MsgNotifier.callIntentToken, que va dentro de nuestros PendingIntent de llamada).
      // Sin él, otra app podía abrir NEXO encima del bloqueo y encender la pantalla con solo poner el extra.
      String tok = (it != null) ? it.getStringExtra(com.nexo.ble.MsgNotifier.EXTRA_CALL_TOKEN) : null;
      boolean tokOk = tok != null && tok.equals(com.nexo.ble.MsgNotifier.getCallIntentToken());
      if (tokOk && (it.hasExtra(com.nexo.ble.MsgNotifier.EXTRA_CALL_FROM) || it.hasExtra(com.nexo.ble.MsgNotifier.EXTRA_ANSWER))) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { setShowWhenLocked(true); setTurnScreenOn(true); }
        else {
          getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
      }
    } catch (Exception e) { Log.w("NEXO", "Pantalla de llamada sobre el bloqueo: " + e.getMessage()); }

    super.onCreate(savedInstanceState);
    // 3120: guardar las primeras líneas de un fallo al caer (lo lee el diagnóstico: «Cierres de la app»)
    try { com.nexo.ble.CrashLog.install(getApplicationContext()); } catch (Throwable t) {}
    // Con el teléfono girado Android deja libre la franja de la cámara frontal y la pinta con el fondo de la ventana
    // (gris en el tema del sistema): el mismo fondo oscuro que la app
    getWindow().setBackgroundDrawable(new ColorDrawable(0xFF070812));
    nexoSystemBars();
    nexoBackSetup();

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
  // WebView por window.__nexoHandleBack(): si lo manejó (1) no hacemos nada; si no (0), lo normal de Android (la app
  // a segundo plano). 3319 (Google Play, targetSdk 36): desde Android 16 onBackPressed() ya no se llama («atrás
  // predictivo»): el atrás va por el OnBackPressedDispatcher, que funciona igual en todas las versiones.
  private OnBackPressedCallback nexoBack;

  private void nexoBackSetup() {
    nexoBack = new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        try {
          WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
          if (wv == null) { nexoBackDefault(); return; }
          wv.evaluateJavascript(
            "(function(){try{return (window.__nexoHandleBack&&window.__nexoHandleBack())?1:0}catch(e){return 0}})()",
            value -> { if (!"1".equals(value)) runOnUiThread(() -> nexoBackDefault()); });
        } catch (Exception e) { nexoBackDefault(); }
      }
    };
    getOnBackPressedDispatcher().addCallback(this, nexoBack);
  }

  // Lo normal de Android: se aparta nuestro manejador un momento y el despachador hace lo de siempre
  private void nexoBackDefault() {
    if (nexoBack == null) return;
    nexoBack.setEnabled(false);
    try { getOnBackPressedDispatcher().onBackPressed(); } finally { nexoBack.setEnabled(true); }
  }

  // 3319 (Google Play, targetSdk 36): desde Android 15 la ventana va SIEMPRE de borde a borde (ya no se puede pedir lo
  // contrario en Android 16): la página quedaría debajo de la barra de estado, de la de navegación y del teclado. Se le pone
  // al contenido el margen de las barras, del recorte de la cámara y del teclado (como antes de Android 15: la app se ve
  // igual y el teclado sigue empujando la barra de escribir); detrás de las barras, el mismo fondo oscuro de la app, con
  // los iconos claros. En la miniatura de la videollamada no hay barras: margen 0.
  private void nexoSystemBars() {
    try {
      if (Build.VERSION.SDK_INT < 35) return; // antes de Android 15: como siempre (el sistema deja la página entre las barras)
      WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
      WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightNavigationBars(false);
      View content = findViewById(android.R.id.content);
      if (content == null) return;
      ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
        return WindowInsetsCompat.CONSUMED;
      });
      ViewCompat.requestApplyInsets(content);
    } catch (Exception e) { Log.w("NEXO", "Barras del sistema: " + e.getMessage()); }
  }

  // #dueño 01-11: en una VIDEOLLAMADA, al irse de la app con el gesto de inicio («deslizar hacia arriba») entrar en
  // Picture-in-Picture (miniatura flotante) en vez de dejar la videollamada atrás. El audio/vídeo NO se cortan (ya corre
  // el servicio en primer plano de la llamada). enterPictureInPictureMode debe llamarse aquí, síncrono, al irse el usuario.
  @Override
  public void onUserLeaveHint() {
    super.onUserLeaveHint();
    com.nexo.ble.BleService.setLeaveHintAt(System.currentTimeMillis());
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
          && getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)
          && com.nexo.ble.BleService.pipOnLeave()) { // 3282: marca puesta Y llamada con audio en marcha (la marca sola podía ser vieja)
        android.app.PictureInPictureParams params = new android.app.PictureInPictureParams.Builder()
            .setAspectRatio(new android.util.Rational(9, 16)).build();
        enterPictureInPictureMode(params);
      }
    } catch (Exception e) { Log.w("NEXO", "PiP onUserLeaveHint: " + e.getMessage()); }
  }

  // Al entrar/salir de la miniatura, avisar al WebView para que la pantalla de llamada muestre solo el vídeo (sin
  // controles) en la ventanita y los recupere al volver a pantalla completa.
  @Override
  public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, android.content.res.Configuration newConfig) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
    try {
      final WebView wv = (this.getBridge() != null) ? this.getBridge().getWebView() : null;
      if (wv != null) {
        final boolean in = isInPictureInPictureMode;
        runOnUiThread(() -> {
          try {
            wv.evaluateJavascript(
              "(function(){try{window.__nexoPipChanged&&window.__nexoPipChanged(" + (in ? "true" : "false") + ")}catch(e){}})()", null);
          } catch (Exception e) {}
        });
      }
    } catch (Exception e) {}
  }
}
