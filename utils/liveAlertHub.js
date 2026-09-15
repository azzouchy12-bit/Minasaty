"use strict";

const prisma = require("../lib/prisma");

/**
 * Minasaty Live Alert Hub:
 * Enterprise-grade real-time alert dispatching and tracking engine.
 * Delivers alerts to native Android devices, mobile browsers, and desktops
 * across multiple simultaneous channels:
 *  1. Native SSE (Server-Sent Events) live persistent stream
 *  2. Native Long-Polling fallback queue
 *  3. Native Check API fast-lookup cache
 *  4. Socket.io real-time websocket broadcast
 *  5. Web Push (VAPID) service worker notifications
 *  6. Google Firebase Cloud Messaging (FCM) high-priority data packets
 *  7. Telegram bot alerts to parents
 */

// Active SSE client connections from native Android devices
// Map<string (clientId), { res, phone, studentId, level, connectedAt, lastPing }>
const sseClients = new Map();

// Pending long-poll requests waiting for an alert
// Set<{ res, phone, studentId, level, timeoutId }>
const longPollWaiters = new Set();

// Active alerts cache: Map<string (alertId), AlertObject>
const activeAlerts = new Map();

// Delivery receipts: Map<string (alertId), Set<string (phone/studentId)>>
const alertAcks = new Map();

// Global Socket.io reference
let globalIo = null;
let globalSocketSender = null;

function setSocketInstances(io, sender) {
  globalIo = io || null;
  globalSocketSender = typeof sender === "function" ? sender : null;
}

/**
 * Creates and broadcasts a new live class alert
 */
async function publishLiveAlert(alertData = {}) {
  const alertId = alertData.alertId || `ALERT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const title = String(alertData.title || "🔴 تنبيه عاجل: بدأت الحصة المباشرة!").slice(0, 200);
  const body = String(alertData.body || "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.").slice(0, 1000);
  const targetUrl = String(alertData.targetUrl || alertData.link || alertData.url || "/student-live.html?alert=1").slice(0, 500);
  const level = String(alertData.level || "ALL").trim();
  const subject = String(alertData.subject || "").trim();
  const teacherName = String(alertData.teacherName || "أكاديمية التفوق").slice(0, 100);
  const targetStudentIds = Array.isArray(alertData.targetStudentIds) ? alertData.targetStudentIds.map(String) : [];
  const parentPhones = Array.isArray(alertData.parentPhones) ? alertData.parentPhones.map(String) : [];
  const timestamp = Number(alertData.timestamp) || Date.now();
  const durationMs = Number(alertData.durationMs) || 15 * 60 * 1000; // 15 minutes TTL

  const payload = {
    alertId,
    type: "TEACHER_LIVE_ALERT",
    title,
    body,
    targetUrl,
    link: targetUrl,
    level,
    subject,
    teacherName,
    targetStudentIds,
    parentPhones,
    alertSound: true,
    ringLoop: true,
    timestamp,
    expiresAt: timestamp + durationMs,
  };

  // 1. Store in active cache
  activeAlerts.set(alertId, payload);
  alertAcks.set(alertId, new Set());

  // Automatically clean up expired alerts
  const cleanupTimer = setTimeout(() => {
    activeAlerts.delete(alertId);
    alertAcks.delete(alertId);
  }, durationMs + 60000);
  if (cleanupTimer && typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }


  // 2. Dispatch to Native Android SSE Stream
  const sseChunk = `id: ${alertId}\nevent: live_alert\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const [clientId, client] of sseClients.entries()) {
    try {
      if (matchesAudience(client, payload)) {
        client.res.write(sseChunk);
      }
    } catch (_) {
      sseClients.delete(clientId);
    }
  }

  // 3. Resolve pending Long-Poll waiters
  for (const waiter of Array.from(longPollWaiters)) {
    try {
      if (matchesAudience(waiter, payload)) {
        clearTimeout(waiter.timeoutId);
        longPollWaiters.delete(waiter);
        waiter.res.json({ active: true, alert: payload });
      }
    } catch (_) {
      longPollWaiters.delete(waiter);
    }
  }

  // 4. Broadcast via Socket.io
  try {
    if (globalIo) {
      globalIo.emit("push_notification", {
        title,
        body,
        link: targetUrl,
        icon: "/assets/teacher-azzeddine-charef.jpg",
        tag: "teacher-live-alert",
        data: payload,
        timestamp,
      });
    }
  } catch (err) {
    console.warn("Socket broadcast error:", err.message);
  }

  // 5. Broadcast to Web Push & FCM in background
  void dispatchPushAndFcm(payload).catch((err) => {
    console.warn("Push/FCM background dispatch error:", err.message);
  });

  return {
    success: true,
    alertId,
    sseDelivered: sseClients.size,
    timestamp,
  };
}

function normalizePhone(rawPhone) {
  if (!rawPhone) return "";
  let digits = String(rawPhone).replace(/\D/g, "");
  if (digits.startsWith("213") && digits.length > 9) {
    digits = "0" + digits.slice(3);
  }
  if (digits.length === 9 && (digits.startsWith("5") || digits.startsWith("6") || digits.startsWith("7"))) {
    digits = "0" + digits;
  }
  return digits;
}

function normalizeLevel(rawLevel) {
  const s = String(rawLevel || "").trim().toLowerCase();
  if (!s || s === "all") return "ALL";
  if (s.includes("اولى") || s.includes("أولى") || s.includes("1as") || s.includes("1 ثانوي")) return "1AS";
  if (s.includes("ثانية") || s.includes("ثانيه") || s.includes("2as") || s.includes("2 ثانوي")) return "2AS";
  if (s.includes("ثالثة") || s.includes("ثالثه") || s.includes("3as") || s.includes("بكالوريا") || s.includes("bac")) return "3AS";
  if (s.includes("رابعة") || s.includes("رابعه") || s.includes("4am") || s.includes("بيام") || s.includes("bem")) return "4AM";
  if (s.includes("جامع") || s.includes("univ")) return "UNIV";
  return s.toUpperCase();
}

/**
 * Checks if a client connection matches the audience of an alert
 */
function matchesAudience(client, alert) {
  if (!alert) return false;

  // 1. Level matching (supports comma-separated levels, e.g. "1AS,2AS" or "ALL")
  const alertLevels = String(alert.level || "ALL")
    .split(",")
    .map(normalizeLevel)
    .filter(Boolean);
  const clientLevelNorm = normalizeLevel(client?.level);

  const levelMatches =
    alertLevels.length === 0 ||
    alertLevels.includes("ALL") ||
    clientLevelNorm === "ALL" ||
    !client?.level ||
    alertLevels.includes(clientLevelNorm);

  // 2. Exact Student ID & Phone matching
  const targetStudentIds = (alert.targetStudentIds || []).map(String);
  const studentMatches =
    Boolean(client?.studentId) &&
    targetStudentIds.includes(String(client.studentId));

  const clientNormPhone = normalizePhone(client?.phone);
  const parentPhonesNorm = (alert.parentPhones || []).map(normalizePhone).filter(Boolean);
  const phoneMatches =
    Boolean(clientNormPhone) &&
    parentPhonesNorm.includes(clientNormPhone);

  // If student or phone matches explicitly -> ALWAYS DELIVER
  if (studentMatches || phoneMatches) {
    return true;
  }

  // 3. If device has no phone and no studentId registered yet (newly installed / unauthenticated app):
  // Deliver the live class alert if the level matches!
  if (!client?.phone && !client?.studentId) {
    return levelMatches;
  }

  // 4. Targeted check: if specific individual students were exclusively selected
  const hasSpecificTargets = targetStudentIds.length > 0 || parentPhonesNorm.length > 0;
  const isExplicitlyTargeted =
    alert.targetMode === "SELECTED" ||
    alert.isTargetedExclusive ||
    (hasSpecificTargets && targetStudentIds.length > 0 && targetStudentIds.length < 5);

  if (isExplicitlyTargeted) {
    // Exclusively targeted to specific individuals, client did not match
    return false;
  }

  // 5. General class or level broadcast: deliver to all matching level devices
  return levelMatches;
}

/**
 * Dispatches Web Push and FCM in the background
 */
async function dispatchPushAndFcm(payload) {
  const { sendPushToAllSubscribers, sendPushToMultipleRecipients } = require("./push");
  const { sendFcmToMultipleRecipients } = require("./fcm");

  const pushPayload = {
    title: payload.title,
    body: payload.body,
    link: payload.targetUrl,
    url: payload.targetUrl,
    type: "TEACHER_LIVE_ALERT",
    tag: "teacher-live-alert",
    requireInteraction: true,
    alertSound: true,
    ringLoop: true,
    level: payload.level,
    subject: payload.subject,
    alertId: payload.alertId,
  };

  if (!payload.targetStudentIds.length && !payload.parentPhones.length) {
    // Broadcast
    await sendPushToAllSubscribers(pushPayload).catch(() => {});
  } else {
    // Targeted
    if (payload.parentPhones.length) {
      void sendPushToMultipleRecipients("parent", payload.parentPhones, pushPayload).catch(() => {});
      void sendFcmToMultipleRecipients("parent", payload.parentPhones, pushPayload).catch(() => {});
    }
    if (payload.targetStudentIds.length) {
      void sendPushToMultipleRecipients("student", payload.targetStudentIds, pushPayload).catch(() => {});
      void sendFcmToMultipleRecipients("student", payload.targetStudentIds, pushPayload).catch(() => {});
    }
  }
}

/**
 * Registers an incoming SSE client connection
 */
function registerSseClient(req, res) {
  const phone = String(req.query.phone || "").trim();
  const studentId = String(req.query.studentId || "").trim();
  const level = String(req.query.level || "").trim().toUpperCase();
  const clientId = `SSE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Send handshake
  res.write(`:connected clientId=${clientId}\n\n`);

  const client = {
    clientId,
    res,
    phone,
    studentId,
    level,
    connectedAt: Date.now(),
    lastPing: Date.now(),
  };

  sseClients.set(clientId, client);

  // Check if any active alert matches this client right now
  const now = Date.now();
  for (const alert of activeAlerts.values()) {
    if (alert.expiresAt > now && now - alert.timestamp < 180000) {
      if (matchesAudience(client, alert)) {
        res.write(`id: ${alert.alertId}\nevent: live_alert\ndata: ${JSON.stringify(alert)}\n\n`);
      }
    }
  }

  // Heartbeat every 20 seconds to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      client.lastPing = Date.now();
      res.write(`:ping ${Date.now()}\n\n`);
    } catch (_) {
      clearInterval(heartbeat);
      sseClients.delete(clientId);
    }
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(clientId);
  });

  return clientId;
}

/**
 * Handles Long-Polling request from native devices
 */
function handleLongPoll(req, res) {
  const phone = String(req.query.phone || "").trim();
  const studentId = String(req.query.studentId || "").trim();
  const level = String(req.query.level || "").trim().toUpperCase();
  const since = Number(req.query.since || 0);

  const client = { phone, studentId, level };

  // 1. Check if an alert already exists since the requested timestamp
  const now = Date.now();
  for (const alert of activeAlerts.values()) {
    if (alert.expiresAt > now && alert.timestamp > since) {
      if (matchesAudience(client, alert)) {
        return res.json({ active: true, alert });
      }
    }
  }

  // 2. Otherwise, hold request open for up to 25 seconds
  const waiter = {
    res,
    phone,
    studentId,
    level,
    timeoutId: null,
  };

  waiter.timeoutId = setTimeout(() => {
    longPollWaiters.delete(waiter);
    try {
      res.json({ active: false });
    } catch (_) {}
  }, 25000);

  longPollWaiters.add(waiter);

  req.on("close", () => {
    clearTimeout(waiter.timeoutId);
    longPollWaiters.delete(waiter);
  });
}

/**
 * Instant check for active alert (Fast HTTP Polling)
 */
function checkActiveAlert(req, res) {
  const phone = String(req.query.phone || "").trim();
  const studentId = String(req.query.studentId || "").trim();
  const level = String(req.query.level || "").trim().toUpperCase();
  const since = Number(req.query.since || 0);

  const client = { phone, studentId, level };
  const now = Date.now();

  for (const alert of activeAlerts.values()) {
    if (alert.expiresAt > now && alert.timestamp > since) {
      if (matchesAudience(client, alert)) {
        return res.json({ active: true, alert });
      }
    }
  }

  return res.json({ active: false });
}

/**
 * Acknowledges receipt of alert from a device
 */
function acknowledgeAlert(req, res) {
  const alertId = String(req.body?.alertId || req.query?.alertId || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const studentId = String(req.body?.studentId || "").trim();
  const identifier = String(phone || studentId || req.ip).trim();

  if (alertId && activeAlerts.has(alertId) && identifier) {
    alertAcks.get(alertId).add(identifier);
  }

  // Notify teacher in studio via Socket.io that phone is ringing right now!
  try {
    if (globalIo) {
      globalIo.emit("live_alert_acked", {
        alertId,
        identifier,
        phone,
        studentId,
        timestamp: Date.now(),
      });
    }
  } catch (_) {}

  return res.json({ ok: true, alertId, timestamp: Date.now() });
}

/**
 * Returns list of currently active alerts
 */
function getActiveAlerts() {
  const now = Date.now();
  const list = [];
  for (const alert of activeAlerts.values()) {
    if (alert.expiresAt > now) {
      list.push(alert);
    }
  }
  return list;
}

/**
 * Dismisses an active alert
 */
function dismissAlert(alertId) {
  if (alertId && activeAlerts.has(alertId)) {
    activeAlerts.delete(alertId);
    alertAcks.delete(alertId);
    return true;
  }
  // If no alertId specified, clear all active alerts
  if (!alertId) {
    activeAlerts.clear();
    alertAcks.clear();
    return true;
  }
  return false;
}

/**
 * Returns diagnostic stats
 */
function getHubStats() {
  return {
    activeAlertsCount: activeAlerts.size,
    connectedSseClients: sseClients.size,
    waitingLongPollers: longPollWaiters.size,
    alerts: Array.from(activeAlerts.values()).map((a) => ({
      alertId: a.alertId,
      title: a.title,
      level: a.level,
      timestamp: a.timestamp,
      acksCount: alertAcks.get(a.alertId)?.size || 0,
    })),
  };
}

module.exports = {
  setSocketInstances,
  publishLiveAlert,
  registerSseClient,
  handleLongPoll,
  checkActiveAlert,
  acknowledgeAlert,
  getActiveAlerts,
  dismissAlert,
  getHubStats,
};
