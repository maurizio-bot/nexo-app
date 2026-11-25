package com.google.firebase.messaging;
public class FirebaseMessagingService extends android.app.Service {
    public void onMessageReceived(RemoteMessage m) {}
    public void onNewToken(String t) {}
    public void onDeletedMessages() {}
    public android.os.IBinder onBind(android.content.Intent i) { return null; }
}
