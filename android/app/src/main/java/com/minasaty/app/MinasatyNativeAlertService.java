package com.minasaty.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * MinasatyNativeAlertService:
 * Persistent native Android keep-alive service.
 * Operates independently of Firebase Cloud Messaging.
 * Maintains a live HTTP Server-Sent-Events (SSE) stream and fallback check
 * with the Minasaty server (https://acadimia.africacold.fr).
 * When a live class alert is received, it acquires a WakeLock to wake the device,
 * triggers continuous ringing via LiveAlertRingingService, and launches
 * the full-screen call-like alert activity over the lock screen.
 */
public class MinasatyNativeAlertService extends Service {
    private static final String BASE_SERVER_URL = "https://acadimia.africacold.fr";
    private static final String CHANNEL_ID = "minasaty_native_bg_channel";
    private static final int NOTIFICATION_ID = 8844;
    private static final String PREFS_NAME = "minasaty_user_prefs";

    private final AtomicBoolean isRunning = new AtomicBoolean(false);
    private ExecutorService sseExecutor;
    private ScheduledExecutorService pollingExecutor;
    private Handler mainHandler;
    private long lastAlertTimestamp = 0;

    public static void startService(Context context) {
        try {
            Intent intent = new Intent(context, MinasatyNativeAlertService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {}
    }

    public static void updateCredentials(Context context, String phone, String studentId, String level) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString("parent_phone", phone != null ? phone.trim() : "")
            .putString("student_id", studentId != null ? studentId.trim() : "")
            .putString("student_level", level != null ? level.trim() : "")
            .apply();

        // Restart service to connect with updated credentials
        startService(context);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
        startForegroundInternal();

        isRunning.set(true);
        sseExecutor = Executors.newSingleThreadExecutor();
        pollingExecutor = Executors.newSingleThreadScheduledExecutor();

        startSseListener();
        startPeriodicSafetyCheck();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "خدمة التنبيهات المباشرة",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("تبقي تطبيق أكاديمية التفوق مستعداً لإيقاظ الهاتف عند بدء الحصص المباشرة");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void startForegroundInternal() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = null;
        if (launchIntent != null) {
            pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
            );
        }

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("أكاديمية التفوق")
            .setContentText("تنبيهات الحصص المباشرة متصلة وتعمل بالخلفية")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build();

        if (Build.VERSION.SDK_INT >= 34) { // Android 14+
            try {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            } catch (Exception e) {
                startForeground(NOTIFICATION_ID, notification);
            }
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundInternal();
        return START_STICKY;
    }

    private void startSseListener() {
        if (sseExecutor == null || sseExecutor.isShutdown()) {
            sseExecutor = Executors.newSingleThreadExecutor();
        }

        sseExecutor.execute(() -> {
            while (isRunning.get()) {
                HttpURLConnection conn = null;
                BufferedReader reader = null;
                try {
                    SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                    String phone = prefs.getString("parent_phone", "");
                    String studentId = prefs.getString("student_id", "");
                    String level = prefs.getString("student_level", "");

                    String streamUrl = BASE_SERVER_URL + "/api/academic/native-alerts/stream" +
                        "?phone=" + Uri.encode(phone) +
                        "&studentId=" + Uri.encode(studentId) +
                        "&level=" + Uri.encode(level);

                    URL url = new URL(streamUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("Accept", "text/event-stream");
                    conn.setRequestProperty("Cache-Control", "no-cache");
                    conn.setRequestProperty("User-Agent", "MinasatyAndroidNative/1.0");
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(60000); // 60s timeout; server sends heartbeat every 20s

                    int status = conn.getResponseCode();
                    if (status == 200) {
                        InputStream in = conn.getInputStream();
                        reader = new BufferedReader(new InputStreamReader(in));
                        String line;
                        while (isRunning.get() && (line = reader.readLine()) != null) {
                            line = line.trim();
                            if (line.startsWith("data:")) {
                                String jsonStr = line.substring(5).trim();
                                if (!jsonStr.isEmpty()) {
                                    handleAlertJson(jsonStr);
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    // Stream interrupted or network switched - retry after a short delay
                } finally {
                    if (reader != null) {
                        try { reader.close(); } catch (Exception ignored) {}
                    }
                    if (conn != null) {
                        try { conn.disconnect(); } catch (Exception ignored) {}
                    }
                }

                if (isRunning.get()) {
                    try {
                        Thread.sleep(3000); // Backoff before reconnecting
                    } catch (InterruptedException ignored) {
                        break;
                    }
                }
            }
        });
    }

    private void startPeriodicSafetyCheck() {
        if (pollingExecutor == null || pollingExecutor.isShutdown()) {
            pollingExecutor = Executors.newSingleThreadScheduledExecutor();
        }

        // Safety poll every 30 seconds to catch alerts even if SSE was temporarily offline
        pollingExecutor.scheduleWithFixedDelay(() -> {
            if (!isRunning.get()) return;
            HttpURLConnection conn = null;
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String phone = prefs.getString("parent_phone", "");
                String studentId = prefs.getString("student_id", "");
                String level = prefs.getString("student_level", "");

                String checkUrl = BASE_SERVER_URL + "/api/academic/native-alerts/check" +
                    "?phone=" + Uri.encode(phone) +
                    "&studentId=" + Uri.encode(studentId) +
                    "&level=" + Uri.encode(level) +
                    "&since=" + lastAlertTimestamp;

                URL url = new URL(checkUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "application/json");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);

                if (conn.getResponseCode() == 200) {
                    BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String l;
                    while ((l = r.readLine()) != null) {
                        sb.append(l);
                    }
                    r.close();

                    JSONObject res = new JSONObject(sb.toString());
                    if (res.optBoolean("active", false)) {
                        JSONObject alert = res.optJSONObject("alert");
                        if (alert != null) {
                            long timestamp = alert.optLong("timestamp", System.currentTimeMillis());
                            if (timestamp > lastAlertTimestamp) {
                                String title = alert.optString("title", "🔴 تنبيه عاجل: بدأت الحصة المباشرة!");
                                String body = alert.optString("body", "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.");
                                String targetUrl = alert.optString("targetUrl", "/student-live.html?alert=1");
                                triggerCallAlert(title, body, targetUrl, timestamp);
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        }, 15, 30, TimeUnit.SECONDS);
    }

    private void handleAlertJson(String jsonStr) {
        try {
            JSONObject obj = new JSONObject(jsonStr);
            String type = obj.optString("type", "");
            if ("TEACHER_LIVE_ALERT".equals(type) || obj.optBoolean("alertSound", false)) {
                long timestamp = obj.optLong("timestamp", System.currentTimeMillis());
                if (timestamp > lastAlertTimestamp) {
                    String title = obj.optString("title", "🔴 تنبيه عاجل: بدأت الحصة المباشرة!");
                    String body = obj.optString("body", "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.");
                    String targetUrl = obj.optString("targetUrl", obj.optString("link", obj.optString("url", "/student-live.html?alert=1")));
                    triggerCallAlert(title, body, targetUrl, timestamp);
                }
            }
        } catch (Exception ignored) {}
    }

    private void triggerCallAlert(String title, String body, String targetUrl, long timestamp) {
        lastAlertTimestamp = timestamp;

        mainHandler.post(() -> {
            try {
                // 1. Wake up device CPU and turn screen on
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    @SuppressWarnings("deprecation")
                    PowerManager.WakeLock wakeLock = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK |
                        PowerManager.ACQUIRE_CAUSES_WAKEUP |
                        PowerManager.ON_AFTER_RELEASE,
                        "Minasaty:NativeAlertWakeLock"
                    );
                    wakeLock.acquire(30000); // 30 seconds max
                }

                // 2. Start continuous alert ringing and vibration
                LiveAlertRingingService.startAlert(this, title, body, targetUrl);

                // 3. Launch full-screen incoming alert activity on top of lock screen
                Intent alertIntent = new Intent(this, LiveAlertIncomingActivity.class);
                alertIntent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                );
                alertIntent.putExtra(LiveAlertRingingService.EXTRA_ALERT_TITLE, title);
                alertIntent.putExtra(LiveAlertRingingService.EXTRA_ALERT_BODY, body);
                alertIntent.putExtra(LiveAlertRingingService.EXTRA_TARGET_URL, targetUrl);
                startActivity(alertIntent);
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // When the user swipes away the app from recent tasks, schedule an immediate restart
        try {
            Intent restartServiceIntent = new Intent(getApplicationContext(), MinasatyNativeAlertService.class);
            restartServiceIntent.setPackage(getPackageName());
            PendingIntent restartPendingIntent = PendingIntent.getService(
                getApplicationContext(),
                8844,
                restartServiceIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
            );

            AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) {
                alarmManager.set(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + 1500,
                    restartPendingIntent
                );
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        isRunning.set(false);
        if (sseExecutor != null) {
            sseExecutor.shutdownNow();
        }
        if (pollingExecutor != null) {
            pollingExecutor.shutdownNow();
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
