package com.minasaty.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MinasatyAlarmReceiver:
 * High-priority BroadcastReceiver triggered by AlarmManager.setAlarmClock().
 * Bypasses Android Doze mode and background execution limits.
 * Performs a fast, non-blocking check against the Minasaty server.
 * When an active live class alert is found, it wakes the device screen,
 * starts the loud continuous ringing service, and displays the incoming call activity.
 */
public class MinasatyAlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "MinasatyAlarmReceiver";
    private static final String BASE_SERVER_URL = "https://acadimia.africacold.fr";
    private static final String PREFS_NAME = "minasaty_user_prefs";
    private static final String CALL_CHANNEL_ID = LiveAlertRingingService.CHANNEL_ID;
    private static final int CALL_NOTIFICATION_ID = 9110;

    private static final ExecutorService backgroundExecutor = Executors.newCachedThreadPool();
    private static long lastTriggeredAlertTimestamp = 0;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) return;
        final Context appContext = context.getApplicationContext();

        // 1. Acquire temporary CPU WakeLock to guarantee code runs even if device was asleep
        PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = null;
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Minasaty:HeartbeatWakeLock");
            try {
                wakeLock.acquire(15000); // 15 seconds max
            } catch (Exception ignored) {}
        }

        final PowerManager.WakeLock finalWakeLock = wakeLock;

        // 2. Perform non-blocking server check in background thread pool
        backgroundExecutor.execute(() -> {
            try {
                checkServerForLiveAlert(appContext);
            } catch (Exception e) {
                Log.w(TAG, "Heartbeat server check error: " + e.getMessage());
            } finally {
                // 3. Re-arm the next heartbeat alarm (unbreakable alarm chain)
                MinasatyHeartbeatScheduler.scheduleNextHeartbeat(appContext);

                // 4. Ensure persistent alert service is also running
                try {
                    MinasatyNativeAlertService.startService(appContext);
                } catch (Exception ignored) {}

                // Release CPU WakeLock
                if (finalWakeLock != null && finalWakeLock.isHeld()) {
                    try {
                        finalWakeLock.release();
                    } catch (Exception ignored) {}
                }
            }
        });
    }

    private void checkServerForLiveAlert(Context context) {
        HttpURLConnection conn = null;
        BufferedReader reader = null;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String phone = prefs.getString("parent_phone", "");
            String studentId = prefs.getString("student_id", "");
            String level = prefs.getString("student_level", "");

            String checkUrl = BASE_SERVER_URL + "/api/native-alerts/check" +
                "?phone=" + Uri.encode(phone) +
                "&studentId=" + Uri.encode(studentId) +
                "&level=" + Uri.encode(level) +
                "&since=" + lastTriggeredAlertTimestamp;

            URL url = new URL(checkUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "MinasatyAlarmEngine/2.0");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);

            int status = conn.getResponseCode();
            if (status == 200) {
                reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }

                JSONObject res = new JSONObject(sb.toString());
                if (res.optBoolean("active", false)) {
                    JSONObject alert = res.optJSONObject("alert");
                    if (alert != null) {
                        long timestamp = alert.optLong("timestamp", System.currentTimeMillis());
                        if (timestamp > lastTriggeredAlertTimestamp) {
                            String alertId = alert.optString("alertId", "");
                            String title = alert.optString("title", "🔴 تنبيه عاجل: بدأت الحصة المباشرة!");
                            String body = alert.optString("body", "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.");
                            String targetUrl = alert.optString("targetUrl", alert.optString("link", alert.optString("url", "/student-live.html?alert=1")));

                            triggerEmergencyLiveAlert(context, alertId, title, body, targetUrl, timestamp, phone, studentId);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "checkServerForLiveAlert exception: " + e.getMessage());
        } finally {
            if (reader != null) {
                try { reader.close(); } catch (Exception ignored) {}
            }
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    private void triggerEmergencyLiveAlert(
        Context context,
        String alertId,
        String title,
        String body,
        String targetUrl,
        long timestamp,
        String phone,
        String studentId
    ) {
        lastTriggeredAlertTimestamp = timestamp;

        try {
            // 1. Wake device screen and turn screen on over lock screen
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock screenWakeLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
                    PowerManager.ACQUIRE_CAUSES_WAKEUP |
                    PowerManager.ON_AFTER_RELEASE,
                    "Minasaty:EmergencyLiveScreenWake"
                );
                screenWakeLock.acquire(30000); // 30 seconds
            }

            // 2. Start high-priority continuous ringing and vibration foreground service
            LiveAlertRingingService.startAlert(context, title, body, targetUrl);

            // 3. Show Facebook Messenger-style floating overlay bubble
            LiveAlertFloatingBubbleService.showBubble(context, title, body, targetUrl);

            // 4. Post full-screen intent notification to pop incoming call UI over lock screen
            postFullScreenCallNotification(context, title, body, targetUrl);

            // 5. Also directly start the Full-Screen Incoming Activity
            Intent activityIntent = new Intent(context, LiveAlertIncomingActivity.class);
            activityIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_CLEAR_TOP |
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            );
            activityIntent.putExtra(LiveAlertRingingService.EXTRA_ALERT_TITLE, title);
            activityIntent.putExtra(LiveAlertRingingService.EXTRA_ALERT_BODY, body);
            activityIntent.putExtra(LiveAlertRingingService.EXTRA_TARGET_URL, targetUrl);
            try {
                context.startActivity(activityIntent);
            } catch (Exception ignored) {}

            // 6. Send acknowledgment to backend so teacher's studio modal updates to "Ringing!"
            sendAlertAcknowledgment(alertId, phone, studentId);

        } catch (Exception e) {
            Log.e(TAG, "triggerEmergencyLiveAlert error: " + e.getMessage());
        }
    }

    private void postFullScreenCallNotification(Context context, String title, String body, String targetUrl) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (ringtoneUri == null) {
            ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CALL_CHANNEL_ID,
                "تنبيهات الحصص المباشرة (مثل ماسنجر)",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("تشغيل الرنين وشاشة المكالمة المنبثقة عند بدء الحصة المباشرة");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 900, 400, 900, 400, 1200});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.enableLights(true);
            channel.setLightColor(Color.RED);
            channel.setBypassDnd(true);

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .build();
            channel.setSound(ringtoneUri, audioAttributes);

            nm.createNotificationChannel(channel);
        }

        Intent fullScreenIntent = new Intent(context, LiveAlertIncomingActivity.class);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra(LiveAlertRingingService.EXTRA_ALERT_TITLE, title);
        fullScreenIntent.putExtra(LiveAlertRingingService.EXTRA_ALERT_BODY, body);
        fullScreenIntent.putExtra(LiveAlertRingingService.EXTRA_TARGET_URL, targetUrl);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
            context,
            201,
            fullScreenIntent,
            pendingFlags
        );

        // Enter live class action
        Intent enterIntent = new Intent(context, LiveAlertRingingService.class);
        enterIntent.setAction(LiveAlertRingingService.ACTION_ENTER_LIVE);
        enterIntent.putExtra(LiveAlertRingingService.EXTRA_TARGET_URL, targetUrl);
        PendingIntent enterPendingIntent = PendingIntent.getService(context, 202, enterIntent, pendingFlags);

        // Dismiss action
        Intent dismissIntent = new Intent(context, LiveAlertRingingService.class);
        dismissIntent.setAction(LiveAlertRingingService.ACTION_STOP_ALERT);
        PendingIntent dismissPendingIntent = PendingIntent.getService(context, 203, dismissIntent, pendingFlags);

        // Caller Person representation (WhatsApp Style)
        Person caller = new Person.Builder()
            .setName("🔴 الدكتور شارف عز الدين")
            .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
            .setImportant(true)
            .build();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CALL_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher))
            .setContentTitle("🔴 مكالمة حصة مباشرة: " + title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSound(ringtoneUri)
            .setVibrate(new long[]{0, 900, 400, 900, 400, 1200})
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            .setStyle(
                NotificationCompat.CallStyle.forIncomingCall(
                    caller,
                    dismissPendingIntent,
                    enterPendingIntent
                )
                .setIsVideo(true)
            )
            .addPerson(caller)
            .addAction(android.R.drawable.ic_media_play, "🚀 دخول الحصة الآن", enterPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "إيقاف الرنين", dismissPendingIntent);

        Notification notification = builder.build();
        nm.notify(CALL_NOTIFICATION_ID, notification);
    }

    private void sendAlertAcknowledgment(String alertId, String phone, String studentId) {
        if (alertId == null || alertId.isEmpty()) return;
        backgroundExecutor.execute(() -> {
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

                conn.getResponseCode(); // Execute
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        });
    }
}
