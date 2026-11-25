package androidx.core.content;
public class ContextCompat {
    public static final int RECEIVER_EXPORTED = 2, RECEIVER_NOT_EXPORTED = 4;
    public static int checkSelfPermission(android.content.Context c, String p) { return 0; }
    public static void startForegroundService(android.content.Context c, android.content.Intent i) {}
    public static java.util.concurrent.Executor getMainExecutor(android.content.Context c) { return null; }
    public static android.content.Intent registerReceiver(android.content.Context c, android.content.BroadcastReceiver r, android.content.IntentFilter f, int flags) { return null; }
    public static int getColor(android.content.Context c, int id) { return 0; }
}
