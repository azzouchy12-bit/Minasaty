"use strict";

const liveAlertHub = require("../utils/liveAlertHub");
const prisma = require("../lib/prisma");

/**
 * Controller for Native Android Real-time Live Class Alerts.
 * Provides high-speed, zero-latency endpoints tailored for Android background services,
 * AlarmManager exact wakeups, and persistent HTTP SSE streaming.
 */

/**
 * GET /api/native-alerts/stream
 * Persistent HTTP Server-Sent Events (SSE) stream for Android devices.
 */
function streamAlerts(req, res) {
  return liveAlertHub.registerSseClient(req, res);
}

/**
 * GET /api/native-alerts/check
 * Ultra-fast in-memory lookup (< 2ms) for AlarmManager exact background wakeups.
 */
function checkAlert(req, res) {
  return liveAlertHub.checkActiveAlert(req, res);
}

/**
 * GET /api/native-alerts/poll
 * Long-polling endpoint holding connection up to 25s for networks where SSE is blocked.
 */
function pollAlert(req, res) {
  return liveAlertHub.handleLongPoll(req, res);
}

/**
 * POST /api/native-alerts/ack
 * Called by Android device immediately when ringtone starts ringing.
 * Notifies teacher dashboard in real-time via Socket.io.
 */
function acknowledgeAlert(req, res) {
  return liveAlertHub.acknowledgeAlert(req, res);
}

/**
 * POST /api/native-alerts/dismiss
 * Dismisses active alert (e.g., when class finishes or teacher ends ringing).
 */
function dismissAlert(req, res) {
  const alertId = req.body?.alertId || req.query?.alertId || null;
  liveAlertHub.dismissAlert(alertId);
  return res.json({ status: "success", message: "تم إلغاء التنبيه بنجاح." });
}

/**
 * GET /api/native-alerts/active
 * Returns currently active live class alert.
 */
function getActiveAlert(_req, res) {
  const activeAlerts = liveAlertHub.getActiveAlerts ? liveAlertHub.getActiveAlerts() : [];
  if (activeAlerts && activeAlerts.length > 0) {
    return res.json({ status: "success", active: true, alert: activeAlerts[0], count: activeAlerts.length });
  }
  return res.json({ status: "success", active: false, alert: null });
}

/**
 * POST /api/native-alerts/register
 * Registers or updates a device's identity and push token.
 */
async function registerDevice(req, res) {
  try {
    const phone = String(req.body?.phone || req.body?.parentPhone || "").trim();
    const studentId = String(req.body?.studentId || "").trim();
    const studentName = String(req.body?.studentName || "").trim();
    const level = String(req.body?.level || "").trim();
    const appVersion = String(req.body?.appVersion || "1.0").trim();
    const manufacturer = String(req.body?.manufacturer || "Unknown").trim();
    const model = String(req.body?.model || "Android").trim();
    const fcmToken = String(req.body?.fcmToken || "").trim();

    // If FCM token provided, save to DB
    if (fcmToken && phone) {
      try {
        const { saveFcmDeviceToken } = require("../utils/fcm");
        await saveFcmDeviceToken("student", phone, fcmToken, "android");
      } catch (_) {}
    }

    return res.json({
      status: "success",
      message: "تم تسجيل جهاز الأندرويد بنجاح في نظام التنبيهات الفورية.",
      registeredAt: Date.now(),
      phone,
      studentId,
      level,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "فشل تسجيل الجهاز." });
  }
}

/**
 * GET /api/native-alerts/stats
 * Diagnostic metrics for platform administrator.
 */
function getStats(_req, res) {
  const stats = liveAlertHub.getHubStats();
  return res.json({
    status: "success",
    timestamp: Date.now(),
    stats,
  });
}

/**
 * POST /api/native-alerts/test
 * Teacher/Admin test endpoint to trigger an immediate test ringing alert.
 */
async function testTriggerAlert(req, res) {
  try {
    const phone = req.body?.phone || req.query?.phone || "";
    const level = req.body?.level || req.query?.level || "ALL";

    const result = await liveAlertHub.publishLiveAlert({
      title: "🔔 اختبار تنبيه الحصة المباشرة (Minasaty Pulse)",
      body: "هذا تنبيه تجريبي للتأكد من إيقاظ الهاتف وتشغيل نغمة الرنين بنجاح أثناء إغلاق التطبيق.",
      level,
      parentPhones: phone ? [phone] : [],
      targetUrl: "/student-live.html?test=1",
      durationMs: 3 * 60 * 1000,
    });

    return res.json({
      status: "success",
      message: "تم إرسال التنبيه التجريبي بنجاح إلى الأجهزة المتصلة.",
      result,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  streamAlerts,
  checkAlert,
  pollAlert,
  acknowledgeAlert,
  dismissAlert,
  getActiveAlert,
  registerDevice,
  getStats,
  testTriggerAlert,
};
