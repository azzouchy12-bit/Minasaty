package com.minasaty.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * BootReceiver:
 * Automatically restarts Minasaty native alert infrastructure upon device boot,
 * app update, or user unlock.
 * Guarantees that students receive live class alerts even if the device was rebooted
 * and the student has not opened the app yet.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;

        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) ||
            Intent.ACTION_USER_PRESENT.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) {

            // 1. Start the periodic exact AlarmClock heartbeat chain
            MinasatyHeartbeatScheduler.scheduleImmediateHeartbeat(context);
            MinasatyHeartbeatScheduler.scheduleNextHeartbeat(context);

            // 2. Start the persistent native foreground service
            try {
                MinasatyNativeAlertService.startService(context);
            } catch (Exception ignored) {}
        }
    }
}
