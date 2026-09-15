package com.minasaty.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class MinasatyFirebaseMessagingService extends FirebaseMessagingService {
    public static final String PREFS_NAME = "minasaty_native_prefs";
    public static final String KEY_FCM_TOKEN = "fcm_device_token";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        if (token != null && !token.isEmpty()) {
            saveTokenToPreferences(token);
            MainActivity.updateCachedFcmToken(token);
        }
    }

    private static long lastAlertProcessedTime = 0;
    private static String lastProcessedMessageId = "";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        if (remoteMessage == null) return;

        // Deduplication check: ignore duplicate message IDs or rapid duplicate fires within 3 seconds
        long now = System.currentTimeMillis();
        String messageId = remoteMessage.getMessageId();
        if (messageId != null && !messageId.isEmpty() && messageId.equals(lastProcessedMessageId)) {
            return;
        }
        if (now - lastAlertProcessedTime < 3000) {
            return;
        }

        Map<String, String> data = remoteMessage.getData();
        boolean isLiveAlert = false;

        if (data != null && !data.isEmpty()) {
            String type = data.get("type");
            isLiveAlert = "TEACHER_LIVE_ALERT".equals(type)
                    || "true".equalsIgnoreCase(data.get("alertSound"))
                    || "teacher-live-alert".equals(data.get("tag"));
        } else if (remoteMessage.getNotification() != null) {
            isLiveAlert = true;
        }

        if (isLiveAlert) {
            lastAlertProcessedTime = now;
            if (messageId != null) {
                lastProcessedMessageId = messageId;
            }

            String title = null;
            String body = null;
            String targetUrl = "/student-live.html?alert=1";

            if (remoteMessage.getNotification() != null) {
                title = remoteMessage.getNotification().getTitle();
                body = remoteMessage.getNotification().getBody();
            }

            if (data != null && !data.isEmpty()) {
                if (data.get("title") != null && !data.get("title").trim().isEmpty()) {
                    title = data.get("title").trim();
                }
                if (data.get("body") != null && !data.get("body").trim().isEmpty()) {
                    body = data.get("body").trim();
                }
                if (data.get("targetUrl") != null && !data.get("targetUrl").trim().isEmpty()) {
                    targetUrl = data.get("targetUrl").trim();
                } else if (data.get("link") != null && !data.get("link").trim().isEmpty()) {
                    targetUrl = data.get("link").trim();
                }
            }

            if (title == null || title.isEmpty()) {
                title = "🔴 بدأت الآن الحصة المباشرة";
            }
            if (body == null || body.isEmpty()) {
                body = "بدأت الحصة المباشرة مع الدكتور شارف عز الدين. اضغط هنا للدخول مباشرة إلى البث.";
            }

            // Post standard text notification with system notification sound
            MinasatyNotificationHelper.postStandardLiveNotification(this, title, body, targetUrl);
        }
    }

    private void saveTokenToPreferences(String token) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_FCM_TOKEN, token).apply();
        } catch (Exception ignored) {}
    }

    public static String getSavedToken(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            return prefs.getString(KEY_FCM_TOKEN, "");
        } catch (Exception ignored) {
            return "";
        }
    }
}
