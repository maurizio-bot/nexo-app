package androidx.core.app;
public final class NotificationManagerCompat {
    public static final int IMPORTANCE_NONE = 0, IMPORTANCE_MIN = 1, IMPORTANCE_LOW = 2, IMPORTANCE_DEFAULT = 3, IMPORTANCE_HIGH = 4, IMPORTANCE_MAX = 5;
    public static NotificationManagerCompat from(android.content.Context c) { return null; }
    public void notify(int id, android.app.Notification n) {}
    public void notify(String tag, int id, android.app.Notification n) {}
    public void cancel(int id) {}
    public void cancel(String tag, int id) {}
    public void cancelAll() {}
    public boolean areNotificationsEnabled() { return true; }
    public int getImportance() { return 3; }
    public android.app.NotificationChannel getNotificationChannel(String id) { return null; }
    public void createNotificationChannel(android.app.NotificationChannel c) {}
    public void deleteNotificationChannel(String id) {}
    public java.util.List<android.app.NotificationChannel> getNotificationChannels() { return null; }
    public java.util.List<android.service.notification.StatusBarNotification> getActiveNotifications() { return null; }
}
