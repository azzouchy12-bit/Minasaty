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

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        if (data != null && !data.isEmpty()) {
            String type = data.get("type");
            boolean isLiveAlert = "TEACHER_LIVE_ALERT".equals(type)
                    || "true".equalsIgnoreCase(data.get("alertSound"))
                    || "teacher-live-alert".equals(data.get("tag"));

            if (isLiveAlert) {
                String title = data.get("title");
                if (title == null || title.isEmpty()) {
                    if (remoteMessage.getNotification() != null) {
                        title = remoteMessage.getNotification().getTitle();
                    }
                }
                if (title == null || title.isEmpty()) {
                    title = "🔴 تنبيه عاجل: بدأت الحصة المباشرة!";
                }

                String body = data.get("body");
                if (body == null || body.isEmpty()) {
                    if (remoteMessage.getNotification() != null) {
                        body = remoteMessage.getNotification().getBody();
                    }
                }
                if (body == null || body.isEmpty()) {
                    body = "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.";
                }

                String targetUrl = data.get("targetUrl");
                if (targetUrl == null || targetUrl.isEmpty()) {
                    targetUrl = data.get("link");
                }
                if (targetUrl == null || targetUrl.isEmpty()) {
                    targetUrl = "/student-live.html?alert=1";
                }

                // Post standard text notification with system notification sound
                MinasatyNotificationHelper.postStandardLiveNotification(this, title, body, targetUrl);
            }
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
