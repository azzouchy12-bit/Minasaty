const fs = require("fs");
const path = require("path");
const prisma = require("../lib/prisma");

let cachedGoogleAuth = null;
let cachedProjectId = null;

function getFirebaseCredentials() {
  // 1. Direct environment variables
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }

  // 2. Service account JSON string in env
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (sa.project_id && sa.client_email && sa.private_key) {
        return {
          projectId: sa.project_id,
          clientEmail: sa.client_email,
          privateKey: sa.private_key,
        };
      }
    } catch (_) {}
  }

  // 3. Local file in data/ or config/
  const possiblePaths = [
    path.join(__dirname, "../data/firebase-service-account.json"),
    path.join(__dirname, "../data/serviceAccountKey.json"),
    path.join(__dirname, "../android/app/google-services.json"),
  ];

  for (const filePath of possiblePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.project_id && parsed.client_email && parsed.private_key) {
          return {
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key,
          };
        }
        // If google-services.json (client side), extract project_id
        if (parsed.project_info?.project_id) {
          cachedProjectId = parsed.project_info.project_id;
        }
      }
    } catch (_) {}
  }

  return null;
}

function isFcmConfigured() {
  const creds = getFirebaseCredentials();
  if (creds) return true;
  if (process.env.FCM_SERVER_KEY) return true;
  return false;
}

async function getAccessToken() {
  const creds = getFirebaseCredentials();
  if (!creds) return null;

  try {
    const { google } = require("googleapis");
    if (!cachedGoogleAuth) {
      cachedGoogleAuth = new google.auth.JWT({
        email: creds.clientEmail,
        key: creds.privateKey,
        scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
      });
      cachedProjectId = creds.projectId;
    }
    const tokenRes = await cachedGoogleAuth.getAccessToken();
    return { token: tokenRes.token, projectId: creds.projectId };
  } catch (err) {
    console.warn("FCM getAccessToken error:", err.message);
    return null;
  }
}

async function saveFcmDeviceToken(recipientRole, recipientId, token, platform = "android") {
  const safeToken = String(token || "").trim();
  const safeRole = String(recipientRole || "").trim();
  const safeId = String(recipientId || "").trim();

  if (!safeToken || !safeRole || !safeId) {
    throw new Error("بيانات جهاز الأندرويد غير مكتملة.");
  }

  return prisma.fcmDeviceToken.upsert({
    where: { token: safeToken },
    create: {
      token: safeToken,
      recipientRole: safeRole,
      recipientId: safeId,
      platform: String(platform || "android").toLowerCase(),
    },
    update: {
      recipientRole: safeRole,
      recipientId: safeId,
      platform: String(platform || "android").toLowerCase(),
    },
  });
}

async function removeFcmDeviceToken(token) {
  const safeToken = String(token || "").trim();
  if (!safeToken) return;
  try {
    await prisma.fcmDeviceToken.deleteMany({ where: { token: safeToken } });
  } catch (_) {}
}

async function sendFcmNotificationToTokens(tokens, dataPayload = {}) {
  if (!tokens || !tokens.length) return { sent: 0, failed: 0 };

  const authData = await getAccessToken();
  const legacyKey = process.env.FCM_SERVER_KEY;

  if (!authData && !legacyKey) {
    console.info("FCM is not configured yet. Skipping FCM dispatch.");
    return { sent: 0, failed: 0, unconfigured: true };
  }

  let sent = 0;
  let failed = 0;

  // Send via FCM HTTP v1 API
  if (authData) {
    const { token: accessToken, projectId } = authData;
    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    for (const deviceToken of tokens) {
      const titleStr = String(dataPayload.title || "🔴 تنبيه عاجل: بدأت الحصة المباشرة!");
      const bodyStr = String(dataPayload.body || "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.");

      const messageBody = {
        message: {
          token: deviceToken,
          notification: {
            title: titleStr,
            body: bodyStr,
          },
          data: {
            type: String(dataPayload.type || "TEACHER_LIVE_ALERT"),
            title: titleStr,
            body: bodyStr,
            targetUrl: String(dataPayload.targetUrl || dataPayload.link || "/student-live.html?alert=1"),
            level: String(dataPayload.level || ""),
            subject: String(dataPayload.subject || ""),
            alertSound: "true",
            tag: "teacher-live-alert",
          },
          android: {
            priority: "high",
            ttl: "3600s",
            direct_boot_ok: true,
            notification: {
              channel_id: "minasaty_text_notifications_v6",
              sound: "default",
              default_sound: true,
              default_vibrate_timings: true,
              priority: "high",
              visibility: "public",
            },
          },
        },
      };

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messageBody),
        });

        if (response.ok) {
          sent++;
        } else {
          failed++;
          const errData = await response.json().catch(() => ({}));
          const errorStatus = errData.error?.status;
          if (errorStatus === "NOT_FOUND" || errorStatus === "UNREGISTERED") {
            await removeFcmDeviceToken(deviceToken);
          }
        }
      } catch (err) {
        failed++;
      }
    }

    return { sent, failed, configured: true };
  }

  // Fallback: Legacy FCM API
  if (legacyKey) {
    const legacyUrl = "https://fcm.googleapis.com/fcm/send";
    for (const deviceToken of tokens) {
      const titleStr = String(dataPayload.title || "🔴 تنبيه عاجل: بدأت الحصة المباشرة!");
      const bodyStr = String(dataPayload.body || "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً.");

      try {
        const response = await fetch(legacyUrl, {
          method: "POST",
          headers: {
            Authorization: `key=${legacyKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: deviceToken,
            priority: "high",
            notification: {
              title: titleStr,
              body: bodyStr,
              sound: "default",
              android_channel_id: "minasaty_text_notifications_v6",
            },
            data: {
              type: dataPayload.type || "TEACHER_LIVE_ALERT",
              title: titleStr,
              body: bodyStr,
              targetUrl: dataPayload.targetUrl || "/student-live.html?alert=1",
              level: dataPayload.level,
              subject: dataPayload.subject,
              alertSound: "true",
            },
          }),
        });

        if (response.ok) {
          sent++;
        } else {
          failed++;
        }
      } catch (_) {
        failed++;
      }
    }
    return { sent, failed, configured: true };
  }

  return { sent, failed };
}

async function sendFcmToMultipleRecipients(recipientRole, recipientIds, payload) {
  if (!recipientIds || !recipientIds.length) return { sent: 0 };
  const records = await prisma.fcmDeviceToken.findMany({
    where: {
      recipientRole,
      recipientId: { in: recipientIds },
    },
    select: { token: true },
  });

  const tokens = records.map((r) => r.token);
  return sendFcmNotificationToTokens(tokens, payload);
}

module.exports = {
  isFcmConfigured,
  saveFcmDeviceToken,
  removeFcmDeviceToken,
  sendFcmNotificationToTokens,
  sendFcmToMultipleRecipients,
};
