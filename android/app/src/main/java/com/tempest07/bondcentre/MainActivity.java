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
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

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
        ReminderSyncWorker.schedulePeriodicSync(this);
        ReminderSyncWorker.requestOneShotSync(this);
        hideStatusBar();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(244, 246, 251));
        setContentView(webView);
        configureWebView();
        loadFromIntent(getIntent(), BASE_URL + "#reminders");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadFromIntent(intent, BASE_URL + "#reminders");
    }

    private void hideStatusBar() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) return;
            controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsets.Type.statusBars());
            return;
        }
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " Tempest07Android/" + BuildConfig.VERSION_NAME);
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
        if (uri == null) return true;
        String scheme = String.valueOf(uri.getScheme()).toLowerCase(Locale.ROOT);
        if ("about:blank".equals(uri.toString())) return false;
        if ("https".equals(scheme) && isInternalHost(uri)) return false;
        if (!isAllowedExternalScheme(scheme)) return true;
        Intent external = new Intent(Intent.ACTION_VIEW, uri);
        try {
            startActivity(external);
            return true;
        } catch (ActivityNotFoundException error) {
            return true;
        }
    }

    private boolean isAllowedExternalScheme(String scheme) {
        return "https".equals(scheme)
            || "http".equals(scheme)
            || "mailto".equals(scheme)
            || "tel".equals(scheme)
            || "sms".equals(scheme);
    }

    private boolean isInternalHost(Uri uri) {
        String host = String.valueOf(uri.getHost()).toLowerCase(Locale.ROOT);
        return host.equals("tempest07.com")
            || host.equals("www.tempest07.com")
            || host.endsWith(".tempest07.com")
            || host.equals("credit-bond-process.pages.dev");
    }

    private void loadFromIntent(Intent intent, String fallbackUrl) {
        String url = intent == null ? "" : intent.getStringExtra("url");
        Uri data = intent == null ? null : intent.getData();
        if ((url == null || url.isEmpty()) && data != null) url = data.toString();
        webView.loadUrl(safeInternalUrl(url, fallbackUrl));
    }

    private String safeInternalUrl(String candidate, String fallbackUrl) {
        if (candidate == null || candidate.trim().isEmpty()) return fallbackUrl;
        Uri uri = Uri.parse(candidate.trim());
        String scheme = String.valueOf(uri.getScheme()).toLowerCase(Locale.ROOT);
        return "https".equals(scheme) && isInternalHost(uri) ? uri.toString() : fallbackUrl;
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
    protected void onResume() {
        super.onResume();
        hideStatusBar();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideStatusBar();
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

    public class AndroidBridge {
        @JavascriptInterface
        public void syncReminders(String json) {
            runOnUiThread(() -> handleReminderSync(json));
        }
    }
}
