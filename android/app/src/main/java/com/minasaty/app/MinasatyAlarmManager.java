package com.minasaty.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * MinasatyAlarmManager:
 * Dedicated audio focus, ringtone playback, and vibration manager.
 * Configured specifically for high-priority emergency live class alerts.
 * Overpowers background media and overrides low volume settings to guarantee the student hears the alert.
 */
public class MinasatyAlarmManager {
    private static final String TAG = "MinasatyAlarmManager";

    private final Context context;
    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private boolean isPlaying = false;

    public MinasatyAlarmManager(Context context) {
        this.context = context.getApplicationContext();
        this.audioManager = (AudioManager) this.context.getSystemService(Context.AUDIO_SERVICE);
        this.vibrator = (Vibrator) this.context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    public synchronized void startRingingAndVibration() {
        if (isPlaying) return;
        isPlaying = true;

        requestHighPriorityAudioFocus();
        ensureAudibleVolume();
        startSoundLoop();
        startContinuousVibration();
    }

    public synchronized void stopRingingAndVibration() {
        isPlaying = false;
        stopSound();
        stopVibration();
        abandonAudioFocus();
    }

    public synchronized boolean isPlaying() {
        return isPlaying;
    }

    private void requestHighPriorityAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes playbackAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();

                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                    .setAudioAttributes(playbackAttributes)
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener(focusChange -> {})
                    .build();

                audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                audioManager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_ALARM,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
                );
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to request audio focus: " + e.getMessage());
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                audioManager.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {}
    }

    private void ensureAudibleVolume() {
        if (audioManager == null) return;
        try {
            int maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            int curVol = audioManager.getStreamVolume(AudioManager.STREAM_ALARM);
            // If volume is muted or lower than 70% of max, raise it
            int desiredVol = (int) (maxVol * 0.85);
            if (curVol < desiredVol) {
                audioManager.setStreamVolume(AudioManager.STREAM_ALARM, desiredVol, 0);
            }
        } catch (Exception ignored) {}
    }

    private void startSoundLoop() {
        stopSound();
        try {
            // First priority: bundled custom high-quality energetic alert sound
            try {
                mediaPlayer = MediaPlayer.create(context, R.raw.alert);
            } catch (Exception ignored) {}

            // Fallback: system default ringtone or alarm
            if (mediaPlayer == null) {
                Uri alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (alertUri == null) {
                    alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                }
                if (alertUri != null) {
                    mediaPlayer = new MediaPlayer();
                    mediaPlayer.setDataSource(context, alertUri);
                    mediaPlayer.prepare();
                }
            }

            if (mediaPlayer != null) {
                mediaPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                );
                mediaPlayer.setLooping(true);
                mediaPlayer.start();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error starting alert sound: " + e.getMessage());
        }
    }

    private void stopSound() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }
    }

    private void startContinuousVibration() {
        if (vibrator == null || !vibrator.hasVibrator()) return;
        try {
            long[] pattern = { 0, 900, 400, 900, 400, 1200 };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception ignored) {}
    }

    private void stopVibration() {
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {}
        }
    }
}
