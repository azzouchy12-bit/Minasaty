package com.minasaty.app;

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
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * MinasatyNativeAlertService:
 * Persistent native Android keep-alive service.
 * Operates independently of Google Play Services and FCM.
 * Maintains a live HTTP Server-Sent-Events (SSE) stream and fast periodic checks
 * with the Minasaty server (https://acadimia.africacold.fr).
 * Coordinates with MinasatyHeartbeatScheduler to guarantee waking up even when closed.
 */
public class MinasatyNativeAlertService extends Service {
    private static final String TAG = "MinasatyAlertService";
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
        if (context == null) return;
        try {
            Intent intent = new Intent(context, MinasatyNativeAlertService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            Log.w(TAG, "startService exception: " + e.getMessage());
        }
    }

    public static void updateCredentials(Context context, String phone, String studentId, String level) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString("parent_phone", phone != null ? phone.trim() : "")
            .putString("student_id", studentId != null ? studentId.trim() : "")
            .putString("student_level", level != null ? level.trim() : "")
            .apply();

        // Restart service to connect with updated credentials
        startService(context);
        // Also trigger an immediate heartbeat check
        MinasatyHeartbeatScheduler.scheduleImmediateHeartbeat(context);
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

        // Ensure alarm clock chain is scheduled
        MinasatyHeartbeatScheduler.scheduleNextHeartbeat(this);
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
                try {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                } catch (Exception ex) {
                    startForeground(NOTIFICATION_ID, notification);
                }
            }
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundInternal();
        // Keep alarm clock chain active
        MinasatyHeartbeatScheduler.scheduleNextHeartbeat(this);
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

                    String streamUrl = BASE_SERVER_URL + "/api/native-alerts/stream" +
                        "?phone=" + Uri.encode(phone) +
                        "&studentId=" + Uri.encode(studentId) +
                        "&level=" + Uri.encode(level);

                    URL url = new URL(streamUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("Accept", "text/event-stream");
                    conn.setRequestProperty("Cache-Control", "no-cache");
                    conn.setRequestProperty("User-Agent", "MinasatyAndroidNative/2.0");
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(60000); // 60s timeout; server sends heartbeat every 20s

                    int status = conn.getResponseCode();
                    if (status == 200) {
                        InputStream in = conn.getInputStream();
                        reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                        String line;
                        while (isRunning.get() && (line = reader.readLine()) != null) {
                            line = line.trim();
                            if (line.startsWith("data:")) {
                                String jsonStr = line.substring(5).trim();
                                if (!jsonStr.isEmpty()) {
                                    handleAlertJson(jsonStr, phone, studentId);
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {
                    // Stream interrupted or network switched - retry after backoff
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

        // Safety poll every 25 seconds to catch alerts even if SSE was temporarily disconnected
        pollingExecutor.scheduleWithFixedDelay(() -> {
            if (!isRunning.get()) return;
            HttpURLConnection conn = null;
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String phone = prefs.getString("parent_phone", "");
                String studentId = prefs.getString("student_id", "");
                String level = prefs.getString("student_level", "");

                String checkUrl = BASE_SERVER_URL + "/api/native-alerts/check" +
                    "?phone=" + Uri.encode(phone) +
                    "&studentId=" + Uri.encode(studentId) +
                    "&level=" + Uri.encode(level) +
                    "&since=" + lastAlertTimestamp;

                URL url = new URL(checkUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("User-Agent", "MinasatySafetyPoll/2.0");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);

                if (conn.getResponseCode() == 200) {
                    BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
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
                                String alertId = alert.optString("alertId", "");
                                String title = alert.optString("title", "🔴 تنبيه عاجل: بدأت الحصة المباشرة!");
                                String body = alert.optString("body", "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.");
                                String targetUrl = alert.optString("targetUrl", "/student-live.html?alert=1");
                                triggerCallAlert(alertId, title, body, targetUrl, timestamp, phone, studentId);
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
        }, 10, 25, TimeUnit.SECONDS);
    }

    private void handleAlertJson(String jsonStr, String phone, String studentId) {
        try {
            JSONObject obj = new JSONObject(jsonStr);
            String type = obj.optString("type", "");
            if ("TEACHER_LIVE_ALERT".equals(type) || obj.optBoolean("alertSound", false)) {
                long timestamp = obj.optLong("timestamp", System.currentTimeMillis());
                if (timestamp > lastAlertTimestamp) {
                    String alertId = obj.optString("alertId", "");
                    String title = obj.optString("title", "🔴 تنبيه عاجل: بدأت الحصة المباشرة!");
                    String body = obj.optString("body", "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.");
                    String targetUrl = obj.optString("targetUrl", obj.optString("link", obj.optString("url", "/student-live.html?alert=1")));
                    triggerCallAlert(alertId, title, body, targetUrl, timestamp, phone, studentId);
                }
            }
        } catch (Exception ignored) {}
    }

    private void triggerCallAlert(
        String alertId,
        String title,
        String body,
        String targetUrl,
        long timestamp,
        String phone,
        String studentId
    ) {
        lastAlertTimestamp = timestamp;

        mainHandler.post(() -> {
            try {
                // 1. Wake up device CPU and turn screen on
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    @SuppressWarnings("deprecation")
                    PowerManager.WakeLock wakeLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
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

                // 4. Send acknowledgment to server so teacher sees phone is ringing
                sendAcknowledgmentAsync(alertId, phone, studentId);

            } catch (Exception ignored) {}
        });
    }

    private void sendAcknowledgmentAsync(String alertId, String phone, String studentId) {
        if (alertId == null || alertId.isEmpty()) return;
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(BASE_SERVER_URL + "/api/native-alerts/ack");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setDoOutput(true);

                JSONObject payload = new JSONObject();
                payload.put("alertId", alertId);
                payload.put("phone", phone);
                payload.put("studentId", studentId);

                byte[] out = payload.toString().getBytes(StandardCharsets.UTF_8);
                OutputStream stream = conn.getOutputStream();
                stream.write(out);
                stream.flush();
                stream.close();

                conn.getResponseCode();
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // CRITICAL FIX: When user swipes app away from Recent Tasks,
        // trigger MinasatyHeartbeatScheduler which uses a BroadcastReceiver (allowed on Android 8-15)
        // instead of broken PendingIntent.getService()!
        try {
            MinasatyHeartbeatScheduler.scheduleImmediateHeartbeat(getApplicationContext());
            MinasatyHeartbeatScheduler.scheduleNextHeartbeat(getApplicationContext());
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
        // Ensure heartbeat stays armed when service is destroyed
        try {
            MinasatyHeartbeatScheduler.scheduleImmediateHeartbeat(getApplicationContext());
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
