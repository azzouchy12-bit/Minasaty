package com.minasaty.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
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
        finish();
    }

    @Override
    public void onBackPressed() {
        // Dismiss alert on back press
        dismissAlert();
        super.onBackPressed();
    }
}
