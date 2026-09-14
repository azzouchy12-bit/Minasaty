package com.minasaty.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * BootReceiver:
 * Restarts MinasatyNativeAlertService automatically upon device boot or app update.
 * Guarantees that students receive live class ringing alerts even if the device was rebooted
 * and the student has not manually opened the app yet.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) {

            MinasatyNativeAlertService.startService(context);
        }
    }
}
