package com.minasaty.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * LiveAlertRingingService:
 * Foreground service that plays the continuous alarm sound, vibrates the device,
 * displays the Facebook Messenger-style floating bubble and high-priority heads-up call banner,
 * and maintains the lock screen notification until the student joins or dismisses the call.
 */
public class LiveAlertRingingService extends Service {
    public static final String ACTION_START_ALERT = "com.minasaty.app.ACTION_START_ALERT";
    public static final String ACTION_STOP_ALERT = "com.minasaty.app.ACTION_STOP_ALERT";
    public static final String ACTION_ENTER_LIVE = "com.minasaty.app.ACTION_ENTER_LIVE";

    public static final String EXTRA_ALERT_TITLE = "extra_alert_title";
    public static final String EXTRA_ALERT_BODY = "extra_alert_body";
    public static final String EXTRA_TARGET_URL = "extra_target_url";

    public static final String CHANNEL_ID = "minasaty_messenger_live_alert_v5";
    private static final int NOTIFICATION_ID = 9110;
    private static final long MAX_RINGING_DURATION_MS = 60000; // Auto-stop after 60 seconds

    private static volatile boolean isRinging = false;

    private MinasatyAlarmManager alarmManager;
    private PowerManager.WakeLock wakeLock;
    private Handler timeoutHandler;
    private Runnable autoStopRunnable;

    public static boolean isAlertRinging() {
        return isRinging;
    }

    public static void startAlert(Context context, String title, String body, String targetUrl) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, LiveAlertRingingService.class);
            intent.setAction(ACTION_START_ALERT);
            intent.putExtra(EXTRA_ALERT_TITLE, title != null ? title : "🔴 تنبيه عاجل: بدأت الحصة المباشرة!");
            intent.putExtra(EXTRA_ALERT_BODY, body != null ? body : "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.");
            intent.putExtra(EXTRA_TARGET_URL, targetUrl != null ? targetUrl : "/student-live.html?alert=1");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {}
    }

    public static void stopAlert(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, LiveAlertRingingService.class);
            intent.setAction(ACTION_STOP_ALERT);
            context.startService(intent);
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        alarmManager = new MinasatyAlarmManager(this);
        timeoutHandler = new Handler(Looper.getMainLooper());
        autoStopRunnable = this::stopRingingAndSelf;
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();

        if (ACTION_STOP_ALERT.equals(action)) {
            stopRingingAndSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_ENTER_LIVE.equals(action)) {
            String targetUrl = intent.getStringExtra(EXTRA_TARGET_URL);
            if (targetUrl == null || targetUrl.isEmpty()) {
                targetUrl = "/student-live.html?alert=1";
            }
            openMainActivityWithUrl(targetUrl);
            stopRingingAndSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START_ALERT.equals(action)) {
            String title = intent.getStringExtra(EXTRA_ALERT_TITLE);
            if (title == null || title.isEmpty()) {
                title = "🔴 تنبيه عاجل: بدأت الحصة المباشرة!";
            }
            String body = intent.getStringExtra(EXTRA_ALERT_BODY);
            if (body == null || body.isEmpty()) {
                body = "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.";
            }
            String targetUrl = intent.getStringExtra(EXTRA_TARGET_URL);
            if (targetUrl == null || targetUrl.isEmpty()) {
                targetUrl = "/student-live.html?alert=1";
            }

            beginContinuousRinging(title, body, targetUrl);
        }

        return START_STICKY;
    }

    private void beginContinuousRinging(String title, String body, String targetUrl) {
        isRinging = true;
        acquireWakeLock();

        if (alarmManager != null) {
            alarmManager.startRingingAndVibration();
        }

        // Show Facebook Messenger-style floating overlay bubble
        LiveAlertFloatingBubbleService.showBubble(this, title, body, targetUrl);

        // Schedule auto-stop timeout after 60 seconds
        timeoutHandler.removeCallbacks(autoStopRunnable);
        timeoutHandler.postDelayed(autoStopRunnable, MAX_RINGING_DURATION_MS);

        // Build high-priority full-screen incoming call notification
        Intent fullScreenIntent = new Intent(this, LiveAlertIncomingActivity.class);
        fullScreenIntent.putExtra(EXTRA_ALERT_TITLE, title);
        fullScreenIntent.putExtra(EXTRA_ALERT_BODY, body);
        fullScreenIntent.putExtra(EXTRA_TARGET_URL, targetUrl);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            101,
            fullScreenIntent,
            pendingFlags
        );

        Intent enterIntent = new Intent(this, LiveAlertRingingService.class);
        enterIntent.setAction(ACTION_ENTER_LIVE);
        enterIntent.putExtra(EXTRA_TARGET_URL, targetUrl);
        PendingIntent enterPendingIntent = PendingIntent.getService(this, 102, enterIntent, pendingFlags);

        Intent dismissIntent = new Intent(this, LiveAlertRingingService.class);
        dismissIntent.setAction(ACTION_STOP_ALERT);
        PendingIntent dismissPendingIntent = PendingIntent.getService(this, 103, dismissIntent, pendingFlags);

        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (ringtoneUri == null) {
            ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        }

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSound(ringtoneUri)
            .setVibrate(new long[]{0, 900, 400, 900, 400, 1200})
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            .addAction(android.R.drawable.ic_media_play, "🚀 دخول الحصة الآن", enterPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "إيقاف الرنين", dismissPendingIntent)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Also launch activity directly if allowed
        try {
            startActivity(fullScreenIntent);
        } catch (Exception ignored) {}
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "Minasaty:LiveAlertRingingWakeLock"
                );
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            try {
                wakeLock.acquire(MAX_RINGING_DURATION_MS + 5000);
            } catch (Exception ignored) {}
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
    }

    private void openMainActivityWithUrl(String targetUrl) {
        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.setAction(Intent.ACTION_VIEW);
        mainIntent.putExtra("targetUrl", targetUrl);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(mainIntent);
    }

    private void stopRingingAndSelf() {
        isRinging = false;
        if (timeoutHandler != null) {
            timeoutHandler.removeCallbacks(autoStopRunnable);
        }
        if (alarmManager != null) {
            alarmManager.stopRingingAndVibration();
        }
        // Remove floating Messenger bubble
        LiveAlertFloatingBubbleService.removeBubble(this);

        releaseWakeLock();
        stopForeground(true);
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "تنبيهات الحصص المباشرة (مثل ماسنجر)",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("تشغيل الرنين ونوافذ المكالمة المنبثقة عند انطلاق الحصة");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 900, 400, 900, 400, 1200});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.enableLights(true);
            channel.setLightColor(Color.RED);
            channel.setBypassDnd(true);

            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            }
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .build();
            channel.setSound(ringtoneUri, audioAttributes);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        stopRingingAndSelf();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
