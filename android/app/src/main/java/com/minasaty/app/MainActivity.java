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
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 1001;
    private static MainActivity instance = null;
    private static String cachedFcmToken = "";

    private static long lastAutoUpdateCheckTime = 0;
    private static boolean isDownloadingUpdate = false;
    private File pendingInstallFile = null;

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

        // Start persistent background alert service and exact alarm clock loop
        MinasatyNativeAlertService.startService(this);
        MinasatyHeartbeatScheduler.scheduleImmediateHeartbeat(this);
        MinasatyHeartbeatScheduler.scheduleNextHeartbeat(this);
        MinasatyAutostartManager.requestIgnoreBatteryOptimization(this);

        // Auto-check for native APK updates immediately on start
        checkAndPerformAutoUpdate();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingInstallFile != null && pendingInstallFile.exists()) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls()) {
                File toInstall = pendingInstallFile;
                pendingInstallFile = null;
                installApkFile(toInstall);
                return;
            }
        }
        checkAndPerformAutoUpdate();
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

    private void checkOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            android.content.SharedPreferences prefs = getSharedPreferences("minasaty_user_prefs", Context.MODE_PRIVATE);
            boolean shown = prefs.getBoolean("overlay_prompt_shown", false);
            if (!shown) {
                prefs.edit().putBoolean("overlay_prompt_shown", true).apply();
                new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("🔴 تنبيهات الحصص مثل ماسنجر")
                    .setMessage("لتظهر لك تنبيهات الحصص المباشرة كنافذة منبثقة عائمة فوق الشاشة مثل تطبيق Messenger أثناء استخدام الهاتف أو إغلاق التطبيق، يرجى تفعيل إذن 'الظهور فوق التطبيقات الأخرى'.")
                    .setPositiveButton("تفعيل الآن", (dialog, which) -> {
                        try {
                            Intent intent = new Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName())
                            );
                            startActivity(intent);
                        } catch (Exception e) {
                            try {
                                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                                startActivity(intent);
                            } catch (Exception ignored) {}
                        }
                    })
                    .setNegativeButton("لاحقاً", null)
                    .show();
            }
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
                MinasatyAlarmReceiver.stopDirectAlarm(this);

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
            runOnUiThread(() -> {
                LiveAlertRingingService.stopAlert(MainActivity.this);
                MinasatyAlarmReceiver.stopDirectAlarm(MainActivity.this);
            });
        }

        @JavascriptInterface
        public boolean isAlertRinging() {
            return LiveAlertRingingService.isAlertRinging();
        }

        @JavascriptInterface
        public void testNativeAlertRinging() {
            runOnUiThread(() -> {
                LiveAlertRingingService.startAlert(
                    MainActivity.this,
                    "🔔 اختبار رنين تنبيه المنصة",
                    "هذا اختبار مباشر للتأكد من وصول التنبيه بصوت قوي واهتزاز الهاتف بنجاح.",
                    "/student-live.html?test=1"
                );
            });
        }

        @JavascriptInterface
        public void openAutostartSettings() {
            runOnUiThread(() -> MinasatyAutostartManager.openOemAutostartSettings(MainActivity.this));
        }

        @JavascriptInterface
        public boolean isBatteryOptimizationIgnored() {
            return MinasatyAutostartManager.isBatteryOptimizationIgnored(MainActivity.this);
        }

        @JavascriptInterface
        public boolean canDrawOverlays() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return Settings.canDrawOverlays(MainActivity.this);
            }
            return true;
        }

        @JavascriptInterface
        public void requestOverlayPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(MainActivity.this)) {
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(
                            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName())
                        );
                        startActivity(intent);
                    } catch (Exception e) {
                        try {
                            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                            startActivity(intent);
                        } catch (Exception ignored) {}
                    }
                });
            }
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
        public void checkAndPerformAutoUpdate() {
            MainActivity.this.checkAndPerformAutoUpdate();
        }

        @JavascriptInterface
        public void downloadAndInstallApk(String url) {
            MainActivity.this.startAutoDownloadAndInstall(url);
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

    public void checkAndPerformAutoUpdate() {
        long now = System.currentTimeMillis();
        if (now - lastAutoUpdateCheckTime < 60_000 || isDownloadingUpdate) {
            return;
        }
        lastAutoUpdateCheckTime = now;

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL("https://acadimia.africacold.fr/api/apk-version?_t=" + System.currentTimeMillis());
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(7000);
                conn.setReadTimeout(7000);
                conn.setRequestProperty("User-Agent", "MinasatyApp/2.0");
                conn.setRequestProperty("Cache-Control", "no-cache");

                if (conn.getResponseCode() == 200) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                    reader.close();

                    JSONObject json = new JSONObject(sb.toString());
                    int serverVersionCode = json.optInt("versionCode", 0);
                    String serverVersionName = json.optString("versionName", "2.0");
                    String apkUrl = json.optString("apkUrl", "https://acadimia.africacold.fr/acadimia.apk");

                    long currentVersionCode = 0;
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                            currentVersionCode = getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
                        } else {
                            currentVersionCode = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
                        }
                    } catch (Exception ignored) {}

                    if (serverVersionCode > currentVersionCode) {
                        runOnUiThread(() -> {
                            Toast.makeText(MainActivity.this, "⚡ تتوفر نسخة جديدة (" + serverVersionName + ")! جارٍ التحديث التلقائي فورا...", Toast.LENGTH_LONG).show();
                            startAutoDownloadAndInstall(apkUrl);
                        });
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }

    public void startAutoDownloadAndInstall(String apkUrl) {
        if (isDownloadingUpdate) return;
        isDownloadingUpdate = true;

        runOnUiThread(() -> {
            try {
                String targetUrl = (apkUrl != null && !apkUrl.isEmpty()) ? apkUrl : "https://acadimia.africacold.fr/acadimia.apk";
                Uri downloadUri = Uri.parse(targetUrl);
                if (!downloadUri.isAbsolute()) {
                    downloadUri = Uri.parse("https://acadimia.africacold.fr" + (targetUrl.startsWith("/") ? "" : "/") + targetUrl);
                }

                File destDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (destDir == null) destDir = getFilesDir();
                File destFile = new File(destDir, "acadimia_update.apk");
                if (destFile.exists()) {
                    destFile.delete();
                }

                Toast.makeText(MainActivity.this, "بدأ التنزيل التلقائي للتحديث... تفقّد الإشعارات", Toast.LENGTH_LONG).show();

                DownloadManager.Request request = new DownloadManager.Request(downloadUri);
                request.setTitle("منصتي | تحديث التطبيق التلقائي");
                request.setDescription("جارٍ تنزيل النسخة الجديدة وتثبيتها فورا...");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationUri(Uri.fromFile(destFile));
                request.setMimeType("application/vnd.android.package-archive");

                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager != null) {
                    long downloadId = manager.enqueue(request);

                    BroadcastReceiver receiver = new BroadcastReceiver() {
                        @Override
                        public void onReceive(Context context, Intent intent) {
                            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                            if (id == downloadId) {
                                isDownloadingUpdate = false;
                                try { unregisterReceiver(this); } catch (Exception ignored) {}
                                installApkFile(destFile);
                            }
                        }
                    };

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
                    } else {
                        registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
                    }
                } else {
                    downloadDirectlyInThread(apkUrl);
                }
            } catch (Exception e) {
                isDownloadingUpdate = false;
                downloadDirectlyInThread(apkUrl);
            }
        });
    }

    private void downloadDirectlyInThread(String apkUrl) {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String targetUrl = (apkUrl != null && !apkUrl.isEmpty()) ? apkUrl : "https://acadimia.africacold.fr/acadimia.apk";
                URL url = new URL(targetUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(15000);
                if (conn.getResponseCode() == 200) {
                    File destDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (destDir == null) destDir = getFilesDir();
                    File destFile = new File(destDir, "acadimia_update.apk");
                    if (destFile.exists()) destFile.delete();

                    InputStream is = conn.getInputStream();
                    FileOutputStream fos = new FileOutputStream(destFile);
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = is.read(buffer)) != -1) {
                        fos.write(buffer, 0, count);
                    }
                    fos.flush();
                    fos.close();
                    is.close();

                    runOnUiThread(() -> installApkFile(destFile));
                }
            } catch (Exception ignored) {
            } finally {
                isDownloadingUpdate = false;
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    public void installApkFile(File apkFile) {
        if (apkFile == null || !apkFile.exists()) return;

        runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!getPackageManager().canRequestPackageInstalls()) {
                        pendingInstallFile = apkFile;
                        Toast.makeText(MainActivity.this, "يرجى تفعيل خيار تثبيت التطبيقات لمتابعة التحديث التلقائي", Toast.LENGTH_LONG).show();
                        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        return;
                    }
                }

                Uri apkUri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    apkUri = FileProvider.getUriForFile(
                        MainActivity.this,
                        getPackageName() + ".fileprovider",
                        apkFile
                    );
                } else {
                    apkUri = Uri.fromFile(apkFile);
                }

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(installIntent);
            } catch (Exception e) {
                e.printStackTrace();
                Toast.makeText(MainActivity.this, "تعذر فتح مثبت التحديث تلقائياً", Toast.LENGTH_SHORT).show();
            }
        });
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
