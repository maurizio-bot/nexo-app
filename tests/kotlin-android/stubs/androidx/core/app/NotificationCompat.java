package androidx.core.app;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
public class NotificationCompat {
    public static final int PRIORITY_DEFAULT = 0, PRIORITY_LOW = -1, PRIORITY_MIN = -2, PRIORITY_HIGH = 1, PRIORITY_MAX = 2;
    public static final int VISIBILITY_PUBLIC = 1, VISIBILITY_PRIVATE = 0, VISIBILITY_SECRET = -1;
    public static final String CATEGORY_CALL = "call", CATEGORY_MESSAGE = "msg", CATEGORY_RECOMMENDATION = "recommendation", CATEGORY_SOCIAL = "social", CATEGORY_SERVICE = "service", CATEGORY_STATUS = "status", CATEGORY_PROGRESS = "progress", CATEGORY_ERROR = "err", CATEGORY_REMINDER = "reminder";
    public static final int DEFAULT_ALL = -1, DEFAULT_SOUND = 1, DEFAULT_VIBRATE = 2, DEFAULT_LIGHTS = 4;
    public static final int FOREGROUND_SERVICE_IMMEDIATE = 1, FOREGROUND_SERVICE_DEFAULT = 0, FOREGROUND_SERVICE_DEFERRED = 2;
    public static final int GROUP_ALERT_ALL = 0, GROUP_ALERT_SUMMARY = 1, GROUP_ALERT_CHILDREN = 2;
    public static abstract class Style {}
    public static class BigTextStyle extends Style {
        public BigTextStyle bigText(CharSequence c) { return this; }
        public BigTextStyle setBigContentTitle(CharSequence c) { return this; }
        public BigTextStyle setSummaryText(CharSequence c) { return this; }
    }
    public static class BigPictureStyle extends Style {
        public BigPictureStyle bigPicture(android.graphics.Bitmap b) { return this; }
        public BigPictureStyle bigLargeIcon(android.graphics.Bitmap b) { return this; }
    }
    public static class InboxStyle extends Style {
        public InboxStyle addLine(CharSequence c) { return this; }
        public InboxStyle setBigContentTitle(CharSequence c) { return this; }
        public InboxStyle setSummaryText(CharSequence c) { return this; }
    }
    public static class MessagingStyle extends Style {
        public MessagingStyle(Person p) {}
        public MessagingStyle(CharSequence n) {}
        public MessagingStyle addMessage(CharSequence text, long ts, Person p) { return this; }
        public MessagingStyle setConversationTitle(CharSequence c) { return this; }
        public MessagingStyle setGroupConversation(boolean b) { return this; }
    }
    public static class CallStyle extends Style {
        public static CallStyle forIncomingCall(Person p, PendingIntent decline, PendingIntent answer) { return null; }
        public static CallStyle forOngoingCall(Person p, PendingIntent hangUp) { return null; }
        public CallStyle setIsVideo(boolean v) { return this; }
        public CallStyle setAnswerButtonColorHint(int c) { return this; }
        public CallStyle setDeclineButtonColorHint(int c) { return this; }
        public CallStyle setVerificationText(CharSequence c) { return this; }
    }
    public static class Action {
        public Action(int icon, CharSequence title, PendingIntent intent) {}
        public static class Builder {
            public Builder(int icon, CharSequence title, PendingIntent intent) {}
            public Builder addRemoteInput(androidx.core.app.RemoteInput r) { return this; }
            public Builder setAllowGeneratedReplies(boolean b) { return this; }
            public Builder setSemanticAction(int a) { return this; }
            public Builder setShowsUserInterface(boolean b) { return this; }
            public Action build() { return null; }
        }
    }
    public static class Builder {
        public Builder(Context c, String channel) {}
        public Builder(Context c) {}
        public Builder setContentTitle(CharSequence c) { return this; }
        public Builder setContentText(CharSequence c) { return this; }
        public Builder setSubText(CharSequence c) { return this; }
        public Builder setTicker(CharSequence c) { return this; }
        public Builder setSmallIcon(int i) { return this; }
        public Builder setSmallIcon(androidx.core.graphics.drawable.IconCompat i) { return this; }
        public Builder setLargeIcon(android.graphics.Bitmap b) { return this; }
        public Builder setContentIntent(PendingIntent p) { return this; }
        public Builder setDeleteIntent(PendingIntent p) { return this; }
        public Builder setFullScreenIntent(PendingIntent p, boolean high) { return this; }
        public Builder setAutoCancel(boolean b) { return this; }
        public Builder setOngoing(boolean b) { return this; }
        public Builder setOnlyAlertOnce(boolean b) { return this; }
        public Builder setSilent(boolean b) { return this; }
        public Builder setPriority(int p) { return this; }
        public Builder setCategory(String c) { return this; }
        public Builder setVisibility(int v) { return this; }
        public Builder setPublicVersion(Notification n) { return this; }
        public Builder setStyle(Style s) { return this; }
        public Builder setGroup(String g) { return this; }
        public Builder setGroupSummary(boolean b) { return this; }
        public Builder setGroupAlertBehavior(int b) { return this; }
        public Builder setSortKey(String s) { return this; }
        public Builder setNumber(int n) { return this; }
        public Builder setWhen(long w) { return this; }
        public Builder setShowWhen(boolean b) { return this; }
        public Builder setUsesChronometer(boolean b) { return this; }
        public Builder setTimeoutAfter(long ms) { return this; }
        public Builder setColor(int c) { return this; }
        public Builder setColorized(boolean b) { return this; }
        public Builder setDefaults(int d) { return this; }
        public Builder setSound(android.net.Uri u) { return this; }
        public Builder setSound(android.net.Uri u, int stream) { return this; }
        public Builder setVibrate(long[] p) { return this; }
        public Builder setLights(int argb, int on, int off) { return this; }
        public Builder setLocalOnly(boolean b) { return this; }
        public Builder setChannelId(String c) { return this; }
        public Builder setProgress(int max, int progress, boolean indeterminate) { return this; }
        public Builder setExtras(android.os.Bundle b) { return this; }
        public Builder addExtras(android.os.Bundle b) { return this; }
        public android.os.Bundle getExtras() { return null; }
        public Builder setShortcutId(String s) { return this; }
        public Builder setForegroundServiceBehavior(int b) { return this; }
        public Builder setBadgeIconType(int t) { return this; }
        public Builder addPerson(Person p) { return this; }
        public Builder addPerson(String uri) { return this; }
        public Builder addAction(int icon, CharSequence title, PendingIntent intent) { return this; }
        public Builder addAction(Action a) { return this; }
        public Notification build() { return null; }
    }
}
