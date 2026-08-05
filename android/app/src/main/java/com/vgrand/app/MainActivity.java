package com.vgrand.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.view.KeyEvent;
import android.view.View;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.File;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView webView;
    private static final String GITHUB_API = "https://api.github.com/repos/varunkumar06011/Penguin-OS/releases/latest";
    private static final String CURRENT_VERSION = "v1.0.5";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        // Enable hardware acceleration for smoother scrolling and rendering
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(settings.getUserAgentString() + " VGrandApp/" + CURRENT_VERSION);

        // Caching: use WebView cache for static resources (CSS/JS with ?v= params)
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.KITKAT) {
            settings.setAppCacheEnabled(true);
            File cacheDir = getCacheDir();
            if (cacheDir != null) {
                settings.setAppCachePath(cacheDir.getAbsolutePath());
                settings.setAppCacheMaxSize(10 * 1024 * 1024); // 10 MB
            }
        }

        // Enable smooth scrolling and better rendering on mobile
        settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
        settings.setEnableSmoothTransition(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        // Allow JS dialogs (alert, confirm, prompt) to work in WebView
        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Open WhatsApp, phone, email, and external download links outside the WebView
                if (url.startsWith("https://wa.me/") || url.startsWith("whatsapp://") ||
                    url.startsWith("tel:") || url.startsWith("mailto:") ||
                    url.startsWith("https://github.com/") || url.endsWith(".apk")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception e) {
                        // If no app can handle it, load in WebView
                        view.loadUrl(url);
                    }
                    return true;
                }
                view.loadUrl(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject a small CSS snippet to prevent white flash on load
                view.evaluateJavascript(
                    "(function(){" +
                    "  var s=document.createElement('style');" +
                    "  s.textContent='body{background:#f4f5f7;-webkit-tap-highlight-color:transparent;}' +" +
                    "    'button,a,input,select{touch-action:manipulation;}' +" +
                    "    '*{-webkit-touch-callout:none;}' ;" +
                    "  document.head.appendChild(s);" +
                    "})();",
                    null
                );
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            try {
                startActivity(intent);
            } catch (Exception e) {
                // ignore
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl("https://vgrand-infra-tracking.vercel.app");
        }

        checkForUpdate();
    }

    private void checkForUpdate() {
        new Thread(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(GITHUB_API).openConnection();
                conn.setRequestProperty("User-Agent", "VGrandApp");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                int code = conn.getResponseCode();
                if (code != 200) return;
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();
                JSONObject release = new JSONObject(sb.toString());
                String latestVersion = release.optString("tag_name", "");
                if (!latestVersion.isEmpty() && !latestVersion.equals(CURRENT_VERSION)) {
                    String apkUrl = null;
                    org.json.JSONArray assets = release.optJSONArray("assets");
                    if (assets != null) {
                        for (int i = 0; i < assets.length(); i++) {
                            JSONObject asset = assets.optJSONObject(i);
                            if ("penguin-os.apk".equals(asset.optString("name"))) {
                                apkUrl = asset.optString("browser_download_url");
                                break;
                            }
                        }
                    }
                    if (apkUrl != null) {
                        final String finalUrl = apkUrl;
                        final String finalVersion = latestVersion;
                        runOnUiThread(() -> showUpdateDialog(finalVersion, finalUrl));
                    }
                }
            } catch (Exception e) {
                // Silent fail — update check is non-blocking
            }
        }).start();
    }

    private void showUpdateDialog(String newVersion, String apkUrl) {
        new AlertDialog.Builder(this)
            .setTitle("Update Available")
            .setMessage("A new version (" + newVersion + ") is available. Download update?")
            .setPositiveButton("Download", (dialog, which) -> {
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl));
                startActivity(browserIntent);
            })
            .setNegativeButton("Later", null)
            .setCancelable(true)
            .show();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if ((keyCode == KeyEvent.KEYCODE_BACK) && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
