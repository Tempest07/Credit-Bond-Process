package com.tempest07.bondcentre;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.webkit.CookieManager;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class ReminderSyncReceiver extends BroadcastReceiver {
    private static final String REMINDER_API_URL = "https://tempest07.com/api/reminders";
    private static final long SYNC_INTERVAL_MS = 15 * 60 * 1000L;
    private static final int SYNC_REQUEST_CODE = 7403;

    @Override
    public void onReceive(Context context, Intent intent) {
        PendingResult result = goAsync();
        new Thread(() -> {
            try {
                fetchAndSync(context.getApplicationContext());
            } finally {
                result.finish();
            }
        }, "Tempest07ReminderSync").start();
    }

    static void schedulePeriodicSync(Context context) {
        Intent intent = new Intent(context, ReminderSyncReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context,
            SYNC_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        alarmManager.setInexactRepeating(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + SYNC_INTERVAL_MS,
            SYNC_INTERVAL_MS,
            pendingIntent
        );
    }

    static void requestOneShotSync(Context context) {
        context.sendBroadcast(new Intent(context, ReminderSyncReceiver.class));
    }

    private static void fetchAndSync(Context context) {
        String cookie = CookieManager.getInstance().getCookie("https://tempest07.com");
        if (cookie == null || cookie.trim().isEmpty()) return;

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(REMINDER_API_URL).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("User-Agent", "Tempest07Android/0.1");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) return;
            ReminderSync.handleReminderPayload(context, readAll(connection.getInputStream()));
        } catch (Exception ignored) {
            // Background reminder sync is best-effort.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readAll(InputStream inputStream) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }
}
