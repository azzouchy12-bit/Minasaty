package com.minasaty.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;

/**
 * MinasatyNetworkReceiver:
 * Detects network connectivity changes.
 * When an internet connection becomes available, immediately fires a heartbeat check
 * to ensure that any active live class alert is received without delay.
 */
public class MinasatyNetworkReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;

        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
                boolean isConnected = activeNetwork != null && activeNetwork.isConnectedOrConnecting();
                if (isConnected) {
                    // Trigger immediate heartbeat check & restart persistent service
                    MinasatyHeartbeatScheduler.scheduleImmediateHeartbeat(context);
                    MinasatyNativeAlertService.startService(context);
                }
            }
        } catch (Exception ignored) {}
    }
}
