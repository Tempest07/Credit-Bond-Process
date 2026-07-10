package com.tempest07.bondcentre;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL_ID = "bond-centre-reminders";

    @Override
    public void onReceive(Context context, Intent intent) {
        String title = intent.getStringExtra("title");
        String text = intent.getStringExtra("text");
        String url = intent.getStringExtra("url");
        String reminderId = intent.getStringExtra("reminderId");
        showNotification(context, title, text, url, reminderId);
    }

    static void showNotification(Context context, String title, String text, String url, String reminderId) {
        ensureChannel(context);

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.putExtra("url", url == null || url.isEmpty() ? MainActivity.BASE_URL + "#reminders" : url);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            stableRequestCode("open:" + reminderId),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, CHANNEL_ID)
            : new Notification.Builder(context);
        builder
            .setSmallIcon(R.drawable.ic_stat_bond)
            .setContentTitle(emptyToDefault(title, "Bond Centre 待办"))
            .setContentText(emptyToDefault(text, "有新的债券工作待办"))
            .setStyle(new Notification.BigTextStyle().bigText(emptyToDefault(text, "有新的债券工作待办")))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setShowWhen(true);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(stableRequestCode(reminderId), builder.build());
        }
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Tempest07 Bond Centre reminders");
        manager.createNotificationChannel(channel);
    }

    static int stableRequestCode(String value) {
        return Math.abs(String.valueOf(value).hashCode());
    }

    private static String emptyToDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }
}
