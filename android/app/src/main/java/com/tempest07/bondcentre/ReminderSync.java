package com.tempest07.bondcentre;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.net.URLEncoder;

final class ReminderSync {
    private static final String PREFS = "tempest07-bond-centre";

    private ReminderSync() {
    }

    static void handleReminderPayload(Context context, String payload) {
        try {
            JSONObject root = new JSONObject(payload);
            JSONArray reminders = root.optJSONArray("reminders");
            if (reminders == null) return;

            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            Set<String> activeIds = new HashSet<>();
            for (int index = 0; index < reminders.length(); index += 1) {
                JSONObject item = reminders.optJSONObject(index);
                if (item == null) continue;
                Reminder reminder = Reminder.fromJson(item);
                if (reminder.id.isEmpty()) continue;
                activeIds.add(reminder.id);
                if (reminder.shouldNotifyNow() && markNotified(preferences, reminder)) {
                    ReminderReceiver.showNotification(context, reminder.notificationTitle(), reminder.notificationText(), reminder.openUrl, reminder.id);
                }
                scheduleReminder(context, reminder);
            }
            preferences.edit().putStringSet("activeReminderIds", activeIds).apply();
        } catch (Exception ignored) {
            // Bad bridge or network payloads should never crash the app shell.
        }
    }

    private static boolean markNotified(SharedPreferences preferences, Reminder reminder) {
        String key = "notified:" + reminder.id;
        String signature = reminder.signature();
        if (signature.equals(preferences.getString(key, ""))) return false;
        preferences.edit().putString(key, signature).apply();
        return true;
    }

    private static void scheduleReminder(Context context, Reminder reminder) {
        long triggerAt = reminder.triggerAt();
        if (triggerAt <= System.currentTimeMillis() + 5000) return;
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.putExtra("title", reminder.notificationTitle());
        intent.putExtra("text", reminder.notificationText());
        intent.putExtra("url", reminder.openUrl);
        intent.putExtra("reminderId", reminder.id);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.stableRequestCode("alarm:" + reminder.id),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
        }
    }

    private static final class Reminder {
        final String id;
        final String kind;
        final String moduleLabel;
        final String subject;
        final String title;
        final String detail;
        final String severity;
        final String timing;
        final String pushPolicy;
        final String dueAt;
        final String openUrl;

        Reminder(String id, String kind, String moduleLabel, String subject, String title, String detail, String severity, String timing, String pushPolicy, String dueAt, String openUrl) {
            this.id = id;
            this.kind = kind;
            this.moduleLabel = moduleLabel;
            this.subject = subject;
            this.title = title;
            this.detail = detail;
            this.severity = severity;
            this.timing = timing;
            this.pushPolicy = pushPolicy;
            this.dueAt = dueAt;
            this.openUrl = openUrl;
        }

        static Reminder fromJson(JSONObject item) {
            return new Reminder(
                item.optString("id", ""),
                item.optString("kind", ""),
                item.optString("moduleLabel", ""),
                item.optString("subject", ""),
                item.optString("title", ""),
                item.optString("detail", ""),
                item.optString("severity", ""),
                item.optString("timing", ""),
                item.optString("pushPolicy", ""),
                item.optString("dueAt", ""),
                routeUrl(item)
            );
        }

        boolean shouldNotifyNow() {
            return "critical".equals(severity) || "immediate".equals(pushPolicy);
        }

        String notificationTitle() {
            if (!subject.isEmpty()) return subject;
            if (!moduleLabel.isEmpty()) return moduleLabel;
            return "Bond Centre 待办";
        }

        String notificationText() {
            String text = joinNonEmpty(moduleLabel, title, detail);
            return text.isEmpty() ? "有新的债券工作待办" : text;
        }

        String signature() {
            return joinNonEmpty(id, severity, timing, title, detail, dueAt);
        }

        long triggerAt() {
            long parsed = parseDueAt(dueAt);
            if (kind.startsWith("project-payment") && "daily".equals(pushPolicy) && "today".equals(timing)) {
                long paymentCheck = todayAt(15, 30);
                if (paymentCheck > System.currentTimeMillis()) return paymentCheck;
            }
            if (parsed > System.currentTimeMillis()) return parsed;
            return -1;
        }

        private static long parseDueAt(String value) {
            if (value == null || value.trim().isEmpty()) return -1;
            String normalized = value.trim();
            String pattern = normalized.length() <= 10 ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm";
            if (normalized.length() > 16) normalized = normalized.substring(0, 16);
            try {
                Date date = new SimpleDateFormat(pattern, Locale.CHINA).parse(normalized);
                return date == null ? -1 : date.getTime();
            } catch (ParseException error) {
                return -1;
            }
        }

        private static long todayAt(int hour, int minute) {
            SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA);
            String today = dateFormat.format(new Date());
            return parseDueAt(today + "T" + twoDigits(hour) + ":" + twoDigits(minute));
        }

        private static String twoDigits(int value) {
            return value < 10 ? "0" + value : String.valueOf(value);
        }

        private static String joinNonEmpty(String... values) {
            StringBuilder builder = new StringBuilder();
            for (String value : values) {
                if (value == null || value.trim().isEmpty()) continue;
                if (builder.length() > 0) builder.append(" · ");
                builder.append(value.trim());
            }
            return builder.toString();
        }

        private static String routeUrl(JSONObject item) {
            JSONObject route = item.optJSONObject("route");
            if (route == null) return MainActivity.BASE_URL + "#reminders";
            String view = route.optString("view", "reminders").trim();
            if (view.isEmpty()) view = "reminders";
            StringBuilder builder = new StringBuilder(MainActivity.BASE_URL)
                .append("#")
                .append(encode(view));
            appendQueryParam(builder, "target", route.optString("target", ""));
            appendQueryParam(builder, "step", route.optString("step", ""));
            appendQueryParam(builder, "trancheId", route.optString("trancheId", ""));
            appendQueryParam(builder, "kind", item.optString("kind", ""));
            return builder.toString();
        }

        private static void appendQueryParam(StringBuilder builder, String key, String value) {
            if (value == null || value.trim().isEmpty()) return;
            builder.append(builder.indexOf("?") >= 0 ? "&" : "?")
                .append(encode(key))
                .append("=")
                .append(encode(value.trim()));
        }

        private static String encode(String value) {
            try {
                return URLEncoder.encode(String.valueOf(value), "UTF-8");
            } catch (Exception error) {
                return String.valueOf(value);
            }
        }
    }
}
