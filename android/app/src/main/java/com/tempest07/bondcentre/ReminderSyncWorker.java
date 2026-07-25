package com.tempest07.bondcentre;

import android.content.Context;
import android.webkit.CookieManager;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public class ReminderSyncWorker extends Worker {
    private static final String REMINDER_API_URL = "https://tempest07.com/api/reminders";
    private static final String PERIODIC_WORK_NAME = "tempest07-periodic-reminder-sync";
    private static final String ONE_SHOT_WORK_NAME = "tempest07-one-shot-reminder-sync";
    private static final long SYNC_INTERVAL_MINUTES = 15L;

    public ReminderSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        return fetchAndSync(getApplicationContext()) ? Result.success() : Result.retry();
    }

    static void schedulePeriodicSync(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            ReminderSyncWorker.class,
            SYNC_INTERVAL_MINUTES,
            TimeUnit.MINUTES
        )
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        );
    }

    static void requestOneShotSync(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ReminderSyncWorker.class)
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(
            ONE_SHOT_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request
        );
    }

    private static Constraints networkConstraints() {
        return new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
    }

    private static boolean fetchAndSync(Context context) {
        String cookie = CookieManager.getInstance().getCookie("https://tempest07.com");
        if (cookie == null || cookie.trim().isEmpty()) return true;

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(REMINDER_API_URL).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("User-Agent", "Tempest07Android/" + BuildConfig.VERSION_NAME);
            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_UNAUTHORIZED || status == HttpURLConnection.HTTP_FORBIDDEN) {
                return true;
            }
            if (status != HttpURLConnection.HTTP_OK) return status < 500;
            ReminderSync.handleReminderPayload(context, readAll(connection.getInputStream()));
            return true;
        } catch (Exception ignored) {
            return false;
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
