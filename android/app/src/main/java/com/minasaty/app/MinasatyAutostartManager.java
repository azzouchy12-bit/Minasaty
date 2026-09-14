package com.minasaty.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import java.util.Arrays;
import java.util.List;

/**
 * MinasatyAutostartManager:
 * Handles aggressive OEM battery managers (Xiaomi HyperOS/MIUI, Samsung OneUI,
 * Huawei EMUI, Oppo ColorOS, Vivo Funtouch, Transsion/Infinix/Tecno) which kill background
 * services when an app is closed.
 * Directs users to the appropriate settings screen to enable "Autostart" and "Unrestricted Battery"
 * so live class alerts wake up the device 100% of the time.
 */
public class MinasatyAutostartManager {
    private static final String TAG = "MinasatyAutostart";
    private static final String PREFS_NAME = "minasaty_autostart_prefs";
    private static final String KEY_AUTOSTART_PROMPTED = "autostart_prompted";

    public static boolean isBatteryOptimizationIgnored(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
        }
        return true;
    }

    public static void requestIgnoreBatteryOptimization(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                if (!isBatteryOptimizationIgnored(context)) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                }
            } catch (Exception e) {
                try {
                    Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(fallback);
                } catch (Exception ignored) {}
            }
        }
    }

    public static boolean hasPromptedAutostart(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_AUTOSTART_PROMPTED, false);
    }

    public static void markAutostartPrompted(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_AUTOSTART_PROMPTED, true).apply();
    }

    /**
     * Attempts to open the OEM-specific Autostart / Background Management settings page.
     */
    public static boolean openOemAutostartSettings(Context context) {
        markAutostartPrompted(context);

        String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER.toLowerCase() : "";

        List<Intent> autostartIntents = Arrays.asList(
            // Xiaomi / Redmi / Poco (MIUI & HyperOS)
            new Intent().setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
            new Intent().setComponent(new ComponentName("com.miui.securitycenter", "com.miui.powercenter.PowerSettings")),

            // Samsung (OneUI)
            new Intent().setComponent(new ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")),
            new Intent().setComponent(new ComponentName("com.samsung.android.sm", "com.samsung.android.sm.ui.battery.BatteryActivity")),

            // Huawei / Honor (EMUI / MagicOS)
            new Intent().setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")),
            new Intent().setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.bootstart.BootStartActivity")),
            new Intent().setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity")),

            // Oppo / Realme (ColorOS / Realme UI)
            new Intent().setComponent(new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")),
            new Intent().setComponent(new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")),
            new Intent().setComponent(new ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")),

            // Vivo / iQOO (FuntouchOS / OriginOS)
            new Intent().setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")),
            new Intent().setComponent(new ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")),
            new Intent().setComponent(new ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager")),

            // Transsion: Infinix, Tecno, Itel (HiOS, XOS)
            new Intent().setComponent(new ComponentName("com.transsion.phonemanager", "com.transsion.phonemanager.settings.AutoRunSettingsActivity")),
            new Intent().setComponent(new ComponentName("com.transsion.phonemanager", "com.transsion.phonemanager.settings.BackgroundManagementActivity")),

            // OnePlus
            new Intent().setComponent(new ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")),

            // Asus
            new Intent().setComponent(new ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"))
        );

        for (Intent intent : autostartIntents) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (context.getPackageManager().resolveActivity(intent, 0) != null) {
                    context.startActivity(intent);
                    return true;
                }
            } catch (Exception ignored) {}
        }

        // Generic fallback: open app details settings
        try {
            Intent appDetails = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            appDetails.setData(Uri.parse("package:" + context.getPackageName()));
            appDetails.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(appDetails);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Fallback to app details failed: " + e.getMessage());
            return false;
        }
    }
}
