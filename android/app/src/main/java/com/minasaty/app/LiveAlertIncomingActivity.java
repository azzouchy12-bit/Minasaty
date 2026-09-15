package com.minasaty.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

/**
 * LiveAlertIncomingActivity:
 * Full-screen incoming call activity displayed on top of the lock screen.
 * Features:
 *  - Displays over lock screen with wake-screen flags.
 *  - Intercepts hardware Volume keys to silence ringtone immediately.
 *  - One-tap instant entry into the live classroom.
 */
public class LiveAlertIncomingActivity extends AppCompatActivity {
    private String targetUrl = "/student-live.html?alert=1";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureLockScreenWindow();
        setContentView(R.layout.activity_live_alert_incoming);

        extractIntentData();
        setupViews();
    }

    private void configureLockScreenWindow() {
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        }
    }

    private void extractIntentData() {
        Intent intent = getIntent();
        if (intent != null) {
            String url = intent.getStringExtra(LiveAlertRingingService.EXTRA_TARGET_URL);
            if (url != null && !url.isEmpty()) {
                targetUrl = url;
            }
            String title = intent.getStringExtra(LiveAlertRingingService.EXTRA_ALERT_TITLE);
            String body = intent.getStringExtra(LiveAlertRingingService.EXTRA_ALERT_BODY);

            TextView tvTitle = findViewById(R.id.tvAlertTitle);
            TextView tvBody = findViewById(R.id.tvAlertBody);

            if (tvTitle != null && title != null && !title.isEmpty()) {
                tvTitle.setText(title);
            }
            if (tvBody != null && body != null && !body.isEmpty()) {
                tvBody.setText(body);
            }
        }
    }

    private void setupViews() {
        Button btnEnterLive = findViewById(R.id.btnEnterLive);
        Button btnDismissAlert = findViewById(R.id.btnDismissAlert);

        if (btnEnterLive != null) {
            btnEnterLive.setOnClickListener(v -> enterLiveClass());
        }

        if (btnDismissAlert != null) {
            btnDismissAlert.setOnClickListener(v -> dismissAlert());
        }
    }

    private void enterLiveClass() {
        LiveAlertRingingService.stopAlert(this);
        MinasatyAlarmReceiver.stopDirectAlarm(this);

        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.setAction(Intent.ACTION_VIEW);
        mainIntent.setData(Uri.parse(targetUrl));
        mainIntent.putExtra("targetUrl", targetUrl);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(mainIntent);

        finish();
    }

    private void dismissAlert() {
        LiveAlertRingingService.stopAlert(this);
        MinasatyAlarmReceiver.stopDirectAlarm(this);
        finish();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Pressing Volume Up or Volume Down silences the ringtone without closing the screen
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            LiveAlertRingingService.stopAlert(this);
            MinasatyAlarmReceiver.stopDirectAlarm(this);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        dismissAlert();
        super.onBackPressed();
    }
}
