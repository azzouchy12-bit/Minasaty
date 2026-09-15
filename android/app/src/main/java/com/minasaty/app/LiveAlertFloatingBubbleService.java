package com.minasaty.app;

import android.annotation.SuppressLint;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import androidx.annotation.Nullable;

/**
 * LiveAlertFloatingBubbleService:
 * Facebook Messenger-style floating interactive overlay window.
 * Displays a floating bubble and popup card directly on top of all applications,
 * allowing instant 1-tap entry into the live classroom.
 */
public class LiveAlertFloatingBubbleService extends Service {
    private static final String TAG = "FloatingBubbleService";

    public static final String ACTION_SHOW_BUBBLE = "com.minasaty.app.ACTION_SHOW_BUBBLE";
    public static final String ACTION_REMOVE_BUBBLE = "com.minasaty.app.ACTION_REMOVE_BUBBLE";

    public static final String EXTRA_BUBBLE_TITLE = "extra_bubble_title";
    public static final String EXTRA_BUBBLE_BODY = "extra_bubble_body";
    public static final String EXTRA_BUBBLE_URL = "extra_bubble_url";

    private WindowManager windowManager;
    private View floatingView;
    private WindowManager.LayoutParams params;
    private Handler handler;
    private Runnable autoDismissRunnable;
    private String targetUrl = "/student-live.html?alert=1";

    public static void showBubble(Context context, String title, String body, String targetUrl) {
        if (context == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            Log.w(TAG, "Cannot show floating bubble: SYSTEM_ALERT_WINDOW permission not granted.");
            return;
        }

        try {
            Intent intent = new Intent(context, LiveAlertFloatingBubbleService.class);
            intent.setAction(ACTION_SHOW_BUBBLE);
            intent.putExtra(EXTRA_BUBBLE_TITLE, title);
            intent.putExtra(EXTRA_BUBBLE_BODY, body);
            intent.putExtra(EXTRA_BUBBLE_URL, targetUrl);
            context.startService(intent);
        } catch (Exception e) {
            Log.w(TAG, "Failed to start LiveAlertFloatingBubbleService: " + e.getMessage());
        }
    }

    public static void removeBubble(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, LiveAlertFloatingBubbleService.class);
            intent.setAction(ACTION_REMOVE_BUBBLE);
            context.startService(intent);
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        autoDismissRunnable = this::removeFloatingViewAndStop;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_REMOVE_BUBBLE.equals(action)) {
            removeFloatingViewAndStop();
            return START_NOT_STICKY;
        }

        if (ACTION_SHOW_BUBBLE.equals(action)) {
            String title = intent.getStringExtra(EXTRA_BUBBLE_TITLE);
            String body = intent.getStringExtra(EXTRA_BUBBLE_BODY);
            String url = intent.getStringExtra(EXTRA_BUBBLE_URL);

            if (url != null && !url.isEmpty()) {
                targetUrl = url;
            }

            displayFloatingBubble(
                title != null ? title : "🔴 تنبيه عاجل: بدأت الحصة المباشرة!",
                body != null ? body : "الأستاذ بانتظارك، اضغط للدخول فوراً."
            );
        }

        return START_NOT_STICKY;
    }

    @SuppressLint("InflateParams")
    private void displayFloatingBubble(String title, String body) {
        if (floatingView != null) {
            updateBubbleTexts(title, body);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            stopSelf();
            return;
        }

        try {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (windowManager == null) {
                stopSelf();
                return;
            }

            LayoutInflater inflater = (LayoutInflater) getSystemService(LAYOUT_INFLATER_SERVICE);
            floatingView = inflater.inflate(R.layout.layout_floating_live_bubble, null);

            int layoutType;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                layoutType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
            } else {
                layoutType = WindowManager.LayoutParams.TYPE_PHONE;
            }

            params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.TRANSLUCENT
            );

            params.gravity = Gravity.TOP | Gravity.START;
            params.x = 24;
            params.y = 160;

            setupBubbleListeners(title, body);

            windowManager.addView(floatingView, params);

            // Auto-dismiss after 60 seconds
            handler.removeCallbacks(autoDismissRunnable);
            handler.postDelayed(autoDismissRunnable, 60000);

        } catch (Exception e) {
            Log.e(TAG, "Error displaying floating bubble: " + e.getMessage());
            removeFloatingViewAndStop();
        }
    }

    private void updateBubbleTexts(String title, String body) {
        if (floatingView == null) return;
        TextView tvTitle = floatingView.findViewById(R.id.tvBubbleTitle);
        TextView tvBody = floatingView.findViewById(R.id.tvBubbleBody);
        if (tvTitle != null && title != null) tvTitle.setText(title);
        if (tvBody != null && body != null) tvBody.setText(body);
    }

    @SuppressLint("ClickableViewAccessibility")
    private void setupBubbleListeners(String title, String body) {
        if (floatingView == null) return;

        updateBubbleTexts(title, body);

        View iconContainer = floatingView.findViewById(R.id.bubbleIconContainer);
        Button btnEnter = floatingView.findViewById(R.id.btnBubbleEnter);
        View btnClose = floatingView.findViewById(R.id.btnBubbleClose);
        View cardContainer = floatingView.findViewById(R.id.bubbleCardContainer);

        if (btnEnter != null) {
            btnEnter.setOnClickListener(v -> enterLiveClass());
        }

        if (btnClose != null) {
            btnClose.setOnClickListener(v -> dismissAlert());
        }

        // Draggable floating head touch listener (Messenger style)
        if (iconContainer != null) {
            iconContainer.setOnTouchListener(new View.OnTouchListener() {
                private int initialX, initialY;
                private float initialTouchX, initialTouchY;
                private long touchStartTime;

                @Override
                public boolean onTouch(View v, MotionEvent event) {
                    switch (event.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            initialX = params.x;
                            initialY = params.y;
                            initialTouchX = event.getRawX();
                            initialTouchY = event.getRawY();
                            touchStartTime = System.currentTimeMillis();
                            return true;

                        case MotionEvent.ACTION_MOVE:
                            params.x = initialX + (int) (event.getRawX() - initialTouchX);
                            params.y = initialY + (int) (event.getRawY() - initialTouchY);
                            try {
                                if (windowManager != null && floatingView != null) {
                                    windowManager.updateViewLayout(floatingView, params);
                                }
                            } catch (Exception ignored) {}
                            return true;

                        case MotionEvent.ACTION_UP:
                            long clickDuration = System.currentTimeMillis() - touchStartTime;
                            float moveDistance = Math.abs(event.getRawX() - initialTouchX) + Math.abs(event.getRawY() - initialTouchY);
                            // If tap without significant dragging, toggle card visibility
                            if (clickDuration < 250 && moveDistance < 20) {
                                if (cardContainer != null) {
                                    int newVis = cardContainer.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE;
                                    cardContainer.setVisibility(newVis);
                                }
                            }
                            return true;
                    }
                    return false;
                }
            });
        }
    }

    private void enterLiveClass() {
        // 1. Stop alert ringing sound and vibration
        LiveAlertRingingService.stopAlert(this);

        // 2. Launch main app directly into the live classroom
        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.setAction(Intent.ACTION_VIEW);
        mainIntent.setData(Uri.parse(targetUrl));
        mainIntent.putExtra("targetUrl", targetUrl);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(mainIntent);

        // 3. Remove floating bubble
        removeFloatingViewAndStop();
    }

    private void dismissAlert() {
        LiveAlertRingingService.stopAlert(this);
        removeFloatingViewAndStop();
    }

    private void removeFloatingViewAndStop() {
        if (handler != null) {
            handler.removeCallbacks(autoDismissRunnable);
        }
        if (windowManager != null && floatingView != null) {
            try {
                windowManager.removeView(floatingView);
            } catch (Exception ignored) {}
            floatingView = null;
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        removeFloatingViewAndStop();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
