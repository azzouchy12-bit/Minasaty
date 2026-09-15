package com.minasaty.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * MinasatyNotificationHelper:
 * Handles posting standard, non-intrusive Android notifications.
 * Uses the phone's native default notification sound (TYPE_NOTIFICATION),
 * features Dr. Charef Azzeddine's portrait icon, and displays in the notification bar
 * (مركز الإشعارات) just like WhatsApp or Messenger.
 */
public class MinasatyNotificationHelper {
    private static final String TAG = "MinasatyNotifHelper";
    public static final String CHANNEL_ID_LIVE = "minasaty_text_notifications_v6";
    public static final int NOTIFICATION_ID_LIVE = 9110;

    public static void createNotificationChannel(Context context) {
        if (context == null) return;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;

                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID_LIVE,
                    "إشعارات الحصص المباشرة",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("إشعارات نصية عند بدء الحصص المباشرة مع الدكتور شارف عز الدين");
                channel.enableLights(true);
                channel.setLightColor(Color.parseColor("#10B981"));
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 250, 150, 250});
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                Uri defaultNotificationSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                if (defaultNotificationSound != null) {
                    AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .build();
                    channel.setSound(defaultNotificationSound, audioAttributes);
                }

                nm.createNotificationChannel(channel);
            }
        } catch (Exception e) {
            Log.w(TAG, "createNotificationChannel error: " + e.getMessage());
        }
    }

    public static void postStandardLiveNotification(Context context, String title, String body, String targetUrl) {
        if (context == null) return;

        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // Ensure channel exists in the OS
            createNotificationChannel(context);

            // Safe defaults
            String safeTitle = (title != null && !title.trim().isEmpty())
                ? title.trim()
                : "🔴 بدأت الآن الحصة المباشرة";
            String safeBody = (body != null && !body.trim().isEmpty())
                ? body.trim()
                : "بدأت الحصة المباشرة مع الدكتور شارف عز الدين. اضغط هنا للدخول مباشرة إلى البث.";
            String safeUrl = (targetUrl != null && !targetUrl.trim().isEmpty())
                ? targetUrl.trim()
                : "/student-live.html?alert=1";

            // Use the phone's native default notification sound (NOT siren, NOT continuous alarm)
            Uri defaultNotificationSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            // Click intent opens MainActivity directly into the live classroom
            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.setAction(Intent.ACTION_VIEW);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            openIntent.putExtra("targetUrl", safeUrl);
            openIntent.setData(Uri.parse(safeUrl.startsWith("http") ? safeUrl : "https://acadimia.africacold.fr" + safeUrl));

            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                (int) System.currentTimeMillis(),
                openIntent,
                pendingFlags
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID_LIVE)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setLargeIcon(BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher))
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText(safeBody)
                    .setSummaryText("أكاديمية التفوق"))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOngoing(false)
                .setContentIntent(pendingIntent)
                .setVibrate(new long[]{0, 250, 150, 250})
                .addAction(android.R.drawable.ic_media_play, "🚀 دخول الحصة الآن", pendingIntent);

            if (defaultNotificationSound != null) {
                builder.setSound(defaultNotificationSound);
            }

            nm.notify(NOTIFICATION_ID_LIVE, builder.build());
            Log.i(TAG, "Standard notification posted successfully: " + safeTitle);

        } catch (Exception e) {
            Log.e(TAG, "Error posting standard live notification: " + e.getMessage(), e);
        }
    }
}
