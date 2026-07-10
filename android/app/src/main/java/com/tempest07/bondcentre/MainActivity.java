package com.tempest07.bondcentre;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    public static final String BASE_URL = "https://tempest07.com/bond-centre/";

    private static final int FILE_CHOOSER_REQUEST = 7401;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7402;
    private static final String PREFS = "tempest07-bond-centre";

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private SharedPreferences preferences;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        ReminderReceiver.ensureChannel(this);
        requestNotificationPermissionIfNeeded();
        buildLayout();
        configureWebView();
        loadFromIntent(getIntent(), BASE_URL + "#reminders");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadFromIntent(intent, BASE_URL + "#reminders");
    }

    private void buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(246, 247, 251));

        LinearLayout topbar = new LinearLayout(this);
        topbar.setOrientation(LinearLayout.HORIZONTAL);
        topbar.setGravity(Gravity.CENTER_VERTICAL);
        topbar.setPadding(dp(14), dp(8), dp(10), dp(8));
        topbar.setBackgroundColor(Color.rgb(16, 24, 47));

        TextView title = new TextView(this);
        title.setText("Tempest07 Bond");
        title.setTextColor(Color.WHITE);
        title.setTextSize(17);
        title.setGravity(Gravity.CENTER_VERTICAL);
        topbar.addView(title, new LinearLayout.LayoutParams(0, dp(42), 1f));

        Button refresh = topButton("刷新");
        refresh.setOnClickListener(view -> webView.reload());
        topbar.addView(refresh, new LinearLayout.LayoutParams(dp(72), dp(38)));
        root.addView(topbar, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(58)
        ));

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));

        LinearLayout bottomNav = new LinearLayout(this);
        bottomNav.setOrientation(LinearLayout.HORIZONTAL);
        bottomNav.setPadding(dp(8), dp(6), dp(8), dp(6));
        bottomNav.setBackgroundColor(Color.WHITE);
        bottomNav.addView(navButton("待办", "reminders"));
        bottomNav.addView(navButton("项目", "ledger"));
        bottomNav.addView(navButton("新增", "generator"));
        bottomNav.addView(navButton("协议", "protocol-transfer"));
        bottomNav.addView(navButton("库存", "secondary-inventory"));
        root.addView(bottomNav, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(60)
        ));

        setContentView(root);
    }

    private Button topButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(13);
        return button;
    }

    private Button navButton(String label, String route) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(12);
        button.setTextColor(Color.rgb(16, 24, 47));
        button.setOnClickListener(view -> openRoute(route));
        button.setLayoutParams(new LinearLayout.LayoutParams(0, dp(48), 1f));
        return button;
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " Tempest07Android/0.1");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        webView.addJavascriptInterface(new AndroidBridge(), "Tempest07Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, WebChromeClient.FileChooserParams fileChooserParams) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = filePathCallback;
                try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    fileChooserCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    private boolean handleUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = String.valueOf(uri.getScheme()).toLowerCase(Locale.ROOT);
        if ("about".equals(scheme)) return false;
        if (isInternalHost(uri)) return false;
        Intent external = new Intent(Intent.ACTION_VIEW, uri);
        try {
            startActivity(external);
            return true;
        } catch (ActivityNotFoundException error) {
            return false;
        }
    }

    private boolean isInternalHost(Uri uri) {
        String host = String.valueOf(uri.getHost()).toLowerCase(Locale.ROOT);
        return host.equals("tempest07.com")
            || host.equals("www.tempest07.com")
            || host.endsWith(".tempest07.com")
            || host.equals("credit-bond-process.pages.dev");
    }

    private void openRoute(String route) {
        webView.loadUrl(BASE_URL + "#" + route);
    }

    private void loadFromIntent(Intent intent, String fallbackUrl) {
        String url = intent == null ? "" : intent.getStringExtra("url");
        Uri data = intent == null ? null : intent.getData();
        if ((url == null || url.isEmpty()) && data != null) url = data.toString();
        webView.loadUrl(url == null || url.isEmpty() ? fallbackUrl : url);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileChooserCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int index = 0; index < count; index += 1) {
                    results[index] = data.getClipData().getItemAt(index).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[] { data.getData() };
            }
        }
        fileChooserCallback.onReceiveValue(results);
        fileChooserCallback = null;
    }

    private void handleReminderSync(String payload) {
        try {
            JSONObject root = new JSONObject(payload);
            JSONArray reminders = root.optJSONArray("reminders");
            if (reminders == null) return;
            Set<String> activeIds = new HashSet<>();
            for (int index = 0; index < reminders.length(); index += 1) {
                JSONObject item = reminders.optJSONObject(index);
                if (item == null) continue;
                Reminder reminder = Reminder.fromJson(item);
                if (reminder.id.isEmpty()) continue;
                activeIds.add(reminder.id);
                if (reminder.shouldNotifyNow() && markNotified(reminder)) {
                    ReminderReceiver.showNotification(this, reminder.notificationTitle(), reminder.notificationText(), BASE_URL + "#reminders", reminder.id);
                }
                scheduleReminder(reminder);
            }
            preferences.edit().putStringSet("activeReminderIds", activeIds).apply();
        } catch (Exception ignored) {
            // Bad bridge payloads should never crash the app shell.
        }
    }

    private boolean markNotified(Reminder reminder) {
        String key = "notified:" + reminder.id;
        String signature = reminder.signature();
        if (signature.equals(preferences.getString(key, ""))) return false;
        preferences.edit().putString(key, signature).apply();
        return true;
    }

    private void scheduleReminder(Reminder reminder) {
        long triggerAt = reminder.triggerAt();
        if (triggerAt <= System.currentTimeMillis() + 5000) return;
        Intent intent = new Intent(this, ReminderReceiver.class);
        intent.putExtra("title", reminder.notificationTitle());
        intent.putExtra("text", reminder.notificationText());
        intent.putExtra("url", BASE_URL + "#reminders");
        intent.putExtra("reminderId", reminder.id);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            this,
            ReminderReceiver.stableRequestCode("alarm:" + reminder.id),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void syncReminders(String json) {
            runOnUiThread(() -> handleReminderSync(json));
        }
    }

    private static class Reminder {
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

        Reminder(String id, String kind, String moduleLabel, String subject, String title, String detail, String severity, String timing, String pushPolicy, String dueAt) {
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
                item.optString("dueAt", "")
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
    }
}
