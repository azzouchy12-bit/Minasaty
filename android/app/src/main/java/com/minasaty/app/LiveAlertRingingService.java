package com.minasaty.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class LiveAlertRingingService extends Service {
    public static final String ACTION_START_ALERT = "com.minasaty.app.ACTION_START_ALERT";
    public static final String ACTION_STOP_ALERT = "com.minasaty.app.ACTION_STOP_ALERT";
    public static final String ACTION_ENTER_LIVE = "com.minasaty.app.ACTION_ENTER_LIVE";

    public static final String EXTRA_ALERT_TITLE = "extra_alert_title";
    public static final String EXTRA_ALERT_BODY = "extra_alert_body";
    public static final String EXTRA_TARGET_URL = "extra_target_url";

    private static final String CHANNEL_ID = "minasaty_live_call_alert_channel";
    private static final int NOTIFICATION_ID = 9110;

    private static boolean isRinging = false;

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    public static boolean isAlertRinging() {
        return isRinging;
    }

    public static void startAlert(Context context, String title, String body, String targetUrl) {
        Intent intent = new Intent(context, LiveAlertRingingService.class);
        intent.setAction(ACTION_START_ALERT);
        intent.putExtra(EXTRA_ALERT_TITLE, title);
        intent.putExtra(EXTRA_ALERT_BODY, body);
        intent.putExtra(EXTRA_TARGET_URL, targetUrl);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stopAlert(Context context) {
        Intent intent = new Intent(context, LiveAlertRingingService.class);
        intent.setAction(ACTION_STOP_ALERT);
        context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
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
        startSound();
        startVibration();

        // 1. Full-Screen Intent to wake up and display LiveAlertIncomingActivity over lock screen
        Intent fullScreenIntent = new Intent(this, LiveAlertIncomingActivity.class);
        fullScreenIntent.putExtra(EXTRA_ALERT_TITLE, title);
        fullScreenIntent.putExtra(EXTRA_ALERT_BODY, body);
        fullScreenIntent.putExtra(EXTRA_TARGET_URL, targetUrl);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            101,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        // 2. Action: Enter Live Session
        Intent enterIntent = new Intent(this, LiveAlertRingingService.class);
        enterIntent.setAction(ACTION_ENTER_LIVE);
        enterIntent.putExtra(EXTRA_TARGET_URL, targetUrl);
        PendingIntent enterPendingIntent = PendingIntent.getService(
            this,
            102,
            enterIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        // 3. Action: Dismiss / Stop Ringing
        Intent dismissIntent = new Intent(this, LiveAlertRingingService.class);
        dismissIntent.setAction(ACTION_STOP_ALERT);
        PendingIntent dismissPendingIntent = PendingIntent.getService(
            this,
            103,
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
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

        // Also proactively launch the Full-Screen Activity if screen is on or waking
        try {
            startActivity(fullScreenIntent);
        } catch (Exception e) {
            // Background start activity restrictions handled by fullScreenIntent
        }
    }

    private void startSound() {
        if (mediaPlayer != null) {
            try { mediaPlayer.stop(); mediaPlayer.release(); } catch (Exception ignored) {}
            mediaPlayer = null;
        }

        try {
            mediaPlayer = MediaPlayer.create(this, R.raw.alert);
            if (mediaPlayer != null) {
                mediaPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .build()
                );
                mediaPlayer.setLooping(true);
                mediaPlayer.start();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void startVibration() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = { 0, 600, 300, 600, 300, 800, 500 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 = repeat from index 0
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception ignored) {}
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (powerManager != null) {
                    int flags = PowerManager.PARTIAL_WAKE_LOCK
                              | PowerManager.ACQUIRE_CAUSES_WAKEUP
                              | PowerManager.ON_AFTER_RELEASE;
                    wakeLock = powerManager.newWakeLock(flags, "Minasaty::LiveAlertWakeLock");
                    wakeLock.acquire(10 * 60 * 1000L); // Max 10 minutes timeout
                }
            }
        } catch (Exception ignored) {}
    }

    private void openMainActivityWithUrl(String targetUrl) {
        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.setAction(Intent.ACTION_VIEW);
        mainIntent.setData(Uri.parse(targetUrl));
        mainIntent.putExtra("targetUrl", targetUrl);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(mainIntent);
    }

    private void stopRingingAndSelf() {
        isRinging = false;

        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }

        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
            vibrator = null;
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
            wakeLock = null;
        }

        stopForeground(true);
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "تنبيهات الحصص المباشرة",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("رنين وتنبيه فوري عند بدء الحصص المباشرة");
                channel.enableVibration(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                channel.setBypassDnd(true);
                manager.createNotificationChannel(channel);
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
