package org.torproject.jni;
public class TorService extends android.app.Service {
    public static final String ACTION_STATUS = "org.torproject.android.intent.action.STATUS", EXTRA_STATUS = "org.torproject.android.intent.extra.STATUS";
    public static final String STATUS_ON = "ON", STATUS_OFF = "OFF", STATUS_STARTING = "STARTING", STATUS_STOPPING = "STOPPING";
    public class LocalBinder extends android.os.Binder { public TorService getService() { return null; } }
    public int getSocksPort() { return 0; }
    public int getHttpTunnelPort() { return 0; }
    public net.freehaven.tor.control.TorControlConnection getTorControlConnection() { return null; }
    public android.os.IBinder onBind(android.content.Intent i) { return null; }
    public static java.io.File getTorrc(android.content.Context c) { return null; }
    public static java.io.File getDefaultsTorrc(android.content.Context c) { return null; }
}
