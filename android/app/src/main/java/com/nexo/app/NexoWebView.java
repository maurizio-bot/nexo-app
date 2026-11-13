package com.nexo.app;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.AttributeSet;
import android.util.Base64;
import android.util.Log;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import androidx.core.view.inputmethod.EditorInfoCompat;
import androidx.core.view.inputmethod.InputConnectionCompat;
import androidx.core.view.inputmethod.InputContentInfoCompat;
import com.getcapacitor.CapacitorWebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONObject;

/**
 * 3035 (dueño 13-11, captura del S23: el teclado de Samsung decía «No es posible introducir este contenido aquí» al elegir un
 * GIF o sticker): el cuadro de escribir es un campo de texto del WebView y Android no le dice al teclado que acepta imágenes.
 * Este WebView (sustituye al de Capacitor por el layout bridge_layout_main.xml de la app) anuncia GIF/PNG/JPEG/WebP y, cuando
 * el teclado manda uno (commitContent), lo lee y se lo pasa a la app: window.__nexoKeyboardImage(mime, dataUrl).
 */
public class NexoWebView extends CapacitorWebView {
    private static final String[] MIMES = new String[] { "image/gif", "image/png", "image/jpeg", "image/webp" };
    private static final int MAX_BYTES = 10 * 1024 * 1024;
    private final Handler main = new Handler(Looper.getMainLooper());

    public NexoWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection ic = super.onCreateInputConnection(outAttrs);
        if (ic == null) return null;
        try {
            EditorInfoCompat.setContentMimeTypes(outAttrs, MIMES);
            return InputConnectionCompat.createWrapper(ic, outAttrs, new InputConnectionCompat.OnCommitContentListener() {
                @Override
                public boolean onCommitContent(InputContentInfoCompat info, int flags, android.os.Bundle opts) {
                    return onKeyboardContent(info, flags);
                }
            });
        } catch (Throwable t) {
            return ic;
        }
    }

    private boolean onKeyboardContent(final InputContentInfoCompat info, int flags) {
        try {
            if (Build.VERSION.SDK_INT >= 25 && (flags & InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0) {
                info.requestPermission();
            }
            String m = "image/gif";
            if (info.getDescription() != null && info.getDescription().getMimeTypeCount() > 0) m = info.getDescription().getMimeType(0);
            final String mime = m;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String js = null;
                    try (InputStream in = getContext().getContentResolver().openInputStream(info.getContentUri())) {
                        if (in != null) {
                            ByteArrayOutputStream out = new ByteArrayOutputStream();
                            byte[] buf = new byte[16384];
                            int n, total = 0;
                            while ((n = in.read(buf)) > 0) {
                                total += n;
                                if (total > MAX_BYTES) { out = null; break; }
                                out.write(buf, 0, n);
                            }
                            if (out != null && total > 0) {
                                String b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                                js = "window.__nexoKeyboardImage && window.__nexoKeyboardImage(" + JSONObject.quote(mime) + "," + JSONObject.quote("data:" + mime + ";base64," + b64) + ")";
                            } else {
                                js = "window.__nexoKeyboardImage && window.__nexoKeyboardImage(" + JSONObject.quote(mime) + ",'')";
                            }
                        }
                    } catch (Throwable t) {
                        Log.w("NEXO", "Imagen del teclado no se pudo leer: " + t.getMessage());
                    } finally {
                        try { info.releasePermission(); } catch (Throwable ignored) { }
                    }
                    final String run = js;
                    if (run != null) main.post(new Runnable() { @Override public void run() { evaluateJavascript(run, null); } });
                }
            }).start();
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
