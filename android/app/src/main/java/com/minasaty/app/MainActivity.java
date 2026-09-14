package com.minasaty.app;

import android.Manifest;
import android.app.DownloadManager;
import android.app.PictureInPictureParams;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.util.Rational;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 1001;
    private static MainActivity instance = null;
    private static String cachedFcmToken = "";

    private boolean isLiveSessionActive = false;
    private String currentClassTitle = "الحصة المباشرة";
    private String currentTeacherName = "أكاديمية التفوق";

    public static MainActivity getInstance() {
        return instance;
    }

    public static void updateCachedFcmToken(String token) {
        cachedFcmToken = token != null ? token : "";
        if (instance != null) {
            instance.notifyWebViewFcmToken(cachedFcmToken);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        checkAndRequestPermissions();
        configureWebView();
        fetchFcmToken();
        handleIncomingAlertIntent(getIntent());

        // Start persistent background alert service
        MinasatyNativeAlertService.startService(this);
        requestBatteryOptimizationExemption();
    }

    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingAlertIntent(intent);
    }

    private void handleIncomingAlertIntent(Intent intent) {
        if (intent == null) return;

        String targetUrl = intent.getStringExtra("targetUrl");
        if (targetUrl == null && intent.getData() != null) {
            targetUrl = intent.getData().toString();
        }

        if (targetUrl != null && !targetUrl.isEmpty()) {
            final String finalUrl = targetUrl;
            runOnUiThread(() -> {
                // Ensure native ringing stops when opening the class
                LiveAlertRingingService.stopAlert(this);

                if (getBridge() != null && getBridge().getWebView() != null) {
                    WebView webView = getBridge().getWebView();
                    String script = "if (window.location.pathname !== '" + finalUrl + "') { window.location.assign('" + finalUrl + "'); }";
                    webView.evaluateJavascript(script, null);
                }
            });
        }
    }

    private void fetchFcmToken() {
        // First check locally saved token
        String saved = MinasatyFirebaseMessagingService.getSavedToken(this);
        if (saved != null && !saved.isEmpty()) {
            cachedFcmToken = saved;
        }

        // Fetch latest from Firebase Messaging
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful() && task.getResult() != null) {
                        String token = task.getResult();
                        cachedFcmToken = token;
                        notifyWebViewFcmToken(token);
                    }
                });
        } catch (Exception ignored) {
            // Firebase may not be initialized if google-services.json is missing during local dev
        }
    }

    private void notifyWebViewFcmToken(String token) {
        if (token == null || token.isEmpty()) return;
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                String js = "window.MinasatyNativeFCMToken = '" + token + "';" +
                            "if (typeof window.onNativeFcmToken === 'function') { window.onNativeFcmToken('" + token + "'); }";
                webView.evaluateJavascript(js, null);
            }
        });
    }

    private void configureWebView() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);

            // Add JavaScript interfaces for web-to-native communication
            MinasatyNativeBridge nativeBridge = new MinasatyNativeBridge();
            webView.addJavascriptInterface(nativeBridge, "MinasatyNative");
            webView.addJavascriptInterface(nativeBridge, "MinasatyApp");
            webView.addJavascriptInterface(nativeBridge, "Android");

            // Attach native download listener for APK updates and downloads
            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                if (url != null && (url.endsWith(".apk") || url.contains(".apk"))) {
                    nativeBridge.downloadAndInstallApk(url);
                } else {
                    nativeBridge.openExternalUrl(url);
                }
            });
        }
    }

    private void checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            String[] permissions = {
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA,
                Manifest.permission.POST_NOTIFICATIONS
            };
            boolean needsRequest = false;
            for (String perm : permissions) {
                if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                    needsRequest = true;
                    break;
                }
            }
            if (needsRequest) {
                ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQ_CODE);
            }
        } else {
            String[] permissions = {
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA
            };
            boolean needsRequest = false;
            for (String perm : permissions) {
                if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                    needsRequest = true;
                    break;
                }
            }
            if (needsRequest) {
                ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQ_CODE);
            }
        }
    }

    public class MinasatyNativeBridge {
        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public void registerStudentUser(String phone, String studentId, String studentName, String level) {
            MinasatyNativeAlertService.updateCredentials(MainActivity.this, phone, studentId, level);
        }

        @JavascriptInterface
        public String getFcmToken() {
            return cachedFcmToken != null ? cachedFcmToken : "";
        }

        @JavascriptInterface
        public void stopAlertRinging() {
            runOnUiThread(() -> LiveAlertRingingService.stopAlert(MainActivity.this));
        }

        @JavascriptInterface
        public boolean isAlertRinging() {
            return LiveAlertRingingService.isAlertRinging();
        }

        @JavascriptInterface
        public void startLiveService(String title, String teacher) {
            isLiveSessionActive = true;
            if (title != null && !title.isEmpty()) currentClassTitle = title;
            if (teacher != null && !teacher.isEmpty()) currentTeacherName = teacher;

            Intent serviceIntent = new Intent(MainActivity.this, LiveAudioForegroundService.class);
            serviceIntent.setAction(LiveAudioForegroundService.ACTION_START);
            serviceIntent.putExtra(LiveAudioForegroundService.EXTRA_CLASS_TITLE, currentClassTitle);
            serviceIntent.putExtra(LiveAudioForegroundService.EXTRA_TEACHER_NAME, currentTeacherName);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        }

        @JavascriptInterface
        public void stopLiveService() {
            isLiveSessionActive = false;
            Intent serviceIntent = new Intent(MainActivity.this, LiveAudioForegroundService.class);
            serviceIntent.setAction(LiveAudioForegroundService.ACTION_STOP);
            startService(serviceIntent);
        }

        @JavascriptInterface
        public void enterPip() {
            runOnUiThread(() -> enterPictureInPicture());
        }

        @JavascriptInterface
        public void downloadAndInstallApk(String url) {
            runOnUiThread(() -> {
                try {
                    String targetUrl = url;
                    if (targetUrl == null || targetUrl.isEmpty()) {
                        targetUrl = "/acadimia.apk";
                    }
                    Uri downloadUri = Uri.parse(targetUrl);
                    if (!downloadUri.isAbsolute()) {
                        downloadUri = Uri.parse("https://acadimia.africacold.fr" + (targetUrl.startsWith("/") ? "" : "/") + targetUrl);
                    }

                    Toast.makeText(MainActivity.this, "بدأ تنزيل التحديث... تفقّد شريط الإشعارات", Toast.LENGTH_LONG).show();

                    DownloadManager.Request request = new DownloadManager.Request(downloadUri);
                    request.setTitle("منصتي | تحديث التطبيق");
                    request.setDescription("جارٍ تنزيل النسخة الجديدة من تطبيق منصتي...");
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "acadimia.apk");
                    request.setMimeType("application/vnd.android.package-archive");

                    DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (manager != null) {
                        long downloadId = manager.enqueue(request);

                        BroadcastReceiver receiver = new BroadcastReceiver() {
                            @Override
                            public void onReceive(Context context, Intent intent) {
                                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                                if (id == downloadId) {
                                    promptInstallApk(downloadId);
                                    try { unregisterReceiver(this); } catch (Exception ignored) {}
                                }
                            }
                        };

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
                        } else {
                            registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
                        }
                    }
                } catch (Exception e) {
                    // Fallback to opening in external browser (Google Chrome)
                    openExternalUrl(url);
                }
            });
        }

        @JavascriptInterface
        public void openExternalUrl(String url) {
            runOnUiThread(() -> {
                try {
                    String targetUrl = url;
                    if (targetUrl == null || targetUrl.isEmpty()) {
                        targetUrl = "https://acadimia.africacold.fr/acadimia.apk";
                    }
                    Uri uri = Uri.parse(targetUrl);
                    if (!uri.isAbsolute()) {
                        uri = Uri.parse("https://acadimia.africacold.fr" + (targetUrl.startsWith("/") ? "" : "/") + targetUrl);
                    }
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {}
            });
        }
    }

    private void promptInstallApk(long downloadId) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) return;

            Uri apkUri = manager.getUriForDownloadedFile(downloadId);
            if (apkUri != null) {
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(installIntent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void enterPictureInPicture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Rational aspectRatio = new Rational(16, 9);
                PictureInPictureParams.Builder pipBuilder = new PictureInPictureParams.Builder();
                pipBuilder.setAspectRatio(aspectRatio);
                enterPictureInPictureMode(pipBuilder.build());
            } catch (Exception e) {
                // Fallback if device does not support PiP
            }
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Automatically enter Picture-in-Picture if a live session is running when user presses Home
        if (isLiveSessionActive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            enterPictureInPicture();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, @NonNull Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        // Inform web UI about PiP state change
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(
                "if (window.onNativePipChanged) { window.onNativePipChanged(" + isInPictureInPictureMode + "); }",
                null
            );
        }
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        if (isLiveSessionActive) {
            Intent serviceIntent = new Intent(this, LiveAudioForegroundService.class);
            serviceIntent.setAction(LiveAudioForegroundService.ACTION_STOP);
            startService(serviceIntent);
        }
        super.onDestroy();
    }
}
