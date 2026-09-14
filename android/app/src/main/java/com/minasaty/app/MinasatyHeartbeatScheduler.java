package com.minasaty.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * MinasatyHeartbeatScheduler:
 * Manages exact, recurring background wake-up alarms using the Android AlarmManager.
 * Employs setAlarmClock() - the most privileged alarm in Android OS:
 *  1. Completely exempt from Doze mode (deep sleep).
 *  2. Bypasses App Standby Buckets and aggressive battery savers.
 *  3. Guaranteed to fire even after task removal (swiping app away from recent apps).
 *  4. Android 12+ explicitly permits starting foreground services / notifications from an AlarmClock callback.
 */
public class MinasatyHeartbeatScheduler {
    private static final String TAG = "MinasatyHeartbeat";
    public static final String ACTION_HEARTBEAT_ALARM = "com.minasaty.app.ACTION_HEARTBEAT_ALARM";
    public static final int HEARTBEAT_REQUEST_CODE = 9911;
    public static final long DEFAULT_HEARTBEAT_INTERVAL_MS = 25000; // 25 seconds

    /**
     * Schedules the next periodic heartbeat check.
     */
    public static void scheduleNextHeartbeat(Context context) {
        scheduleHeartbeat(context, DEFAULT_HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Schedules an immediate heartbeat check (e.g. after task removed or network restored).
     */
    public static void scheduleImmediateHeartbeat(Context context) {
        scheduleHeartbeat(context, 1000); // 1 second
    }

    /**
     * Schedules a heartbeat check after a specific delay.
     */
    public static void scheduleHeartbeat(Context context, long delayMillis) {
        if (context == null) return;
        Context appContext = context.getApplicationContext();

        try {
            AlarmManager alarmManager = (AlarmManager) appContext.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            Intent intent = new Intent(appContext, MinasatyAlarmReceiver.class);
            intent.setAction(ACTION_HEARTBEAT_ALARM);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                appContext,
                HEARTBEAT_REQUEST_CODE,
                intent,
                flags
            );

            long triggerAtMillis = System.currentTimeMillis() + delayMillis;

            // 1. Preferred: setAlarmClock() - Highest OS priority, completely immune to Doze & App Standby
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                Intent showIntent = new Intent(appContext, MainActivity.class);
                PendingIntent showPendingIntent = PendingIntent.getActivity(
                    appContext,
                    HEARTBEAT_REQUEST_CODE + 1,
                    showIntent,
                    flags
                );

                AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(triggerAtMillis, showPendingIntent);
                try {
                    alarmManager.setAlarmClock(clockInfo, pendingIntent);
                    return;
                } catch (SecurityException se) {
                    Log.w(TAG, "setAlarmClock security exception: " + se.getMessage());
                } catch (Exception e) {
                    Log.w(TAG, "setAlarmClock failed, falling back: " + e.getMessage());
                }
            }

            // 2. Fallback: setExactAndAllowWhileIdle()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                boolean canExact = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    canExact = alarmManager.canScheduleExactAlarms();
                }

                if (canExact) {
                    try {
                        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent);
                        return;
                    } catch (SecurityException ignored) {}
                }

                // Fallback to inexact allow while idle if exact alarms permission not granted
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent);
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent);
            }

        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule heartbeat alarm: " + e.getMessage());
        }
    }

    /**
     * Cancels the heartbeat alarm loop.
     */
    public static void cancelHeartbeat(Context context) {
        if (context == null) return;
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            Intent intent = new Intent(context, MinasatyAlarmReceiver.class);
            intent.setAction(ACTION_HEARTBEAT_ALARM);

            int flags = PendingIntent.FLAG_NO_CREATE;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                HEARTBEAT_REQUEST_CODE,
                intent,
                flags
            );

            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent);
                pendingIntent.cancel();
            }
        } catch (Exception ignored) {}
    }
}
