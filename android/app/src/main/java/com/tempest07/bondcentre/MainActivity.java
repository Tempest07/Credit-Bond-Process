package com.tempest07.bondcentre;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
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

import java.util.Locale;

public class MainActivity extends Activity {
    public static final String BASE_URL = "https://tempest07.com/bond-centre/";

    private static final int FILE_CHOOSER_REQUEST = 7401;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7402;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ReminderReceiver.ensureChannel(this);
        requestNotificationPermissionIfNeeded();
        ReminderSyncReceiver.schedulePeriodicSync(this);
        ReminderSyncReceiver.requestOneShotSync(this);
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
        ReminderSync.handleReminderPayload(this, payload);
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
}
