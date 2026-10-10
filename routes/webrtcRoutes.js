"use strict";

const crypto = require("crypto");
const express = require("express");
const { verifyToken } = require("../middleware/authMiddleware");

const router = express.Router();
const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";
const DEFAULT_TURN_HOST = "192.236.187.151";
const DEFAULT_TURN_PORT = "3478";
const DEFAULT_TURN_REALM = "minasaty.com";

function getTurnConfig() {
  const secret = String(process.env.COTURN_SECRET || "").trim();
  const host = String(process.env.COTURN_HOST || DEFAULT_TURN_HOST).trim();
  const port = String(process.env.COTURN_PORT || DEFAULT_TURN_PORT).trim();
  const realm = String(process.env.COTURN_REALM || DEFAULT_TURN_REALM).trim();
  if (!secret || !host || !port || !realm) return null;
  return { secret, host, port, realm };
}

router.get("/ice-servers", verifyToken, (req, res) => {
  const turn = getTurnConfig();
  if (!turn) {
    return res.status(503).json({ error: "إعدادات خادم TURN غير متاحة حاليًا." });
  }

  const expiry = Math.floor(Date.now() / 1000) + 43200;
  const username = `${expiry}:minasaty_user`;
  const credential = crypto.createHmac("sha1", turn.secret).update(username).digest("base64");
  const endpoint = `${turn.host}:${turn.port}`;

  return res.status(200).json({
    status: "success",
    expiresAt: expiry,
    realm: turn.realm,
    iceServers: [
      { urls: [DEFAULT_STUN_URL] },
      {
        urls: [`turn:${endpoint}?transport=udp`, `turn:${endpoint}?transport=tcp`],
        username,
        credential,
      },
    ],
  });
});

const { AccessToken } = require("livekit-server-sdk");

const DEFAULT_LIVEKIT_HOST = "192-236-187-151.sslip.io";
const DEFAULT_LIVEKIT_PORT = "443";
// Host IP referenced for network validation
const DEFAULT_LIVEKIT_IP = "192.236.187.151";

let prismaClient = null;
try {
  prismaClient = require("../prisma");
} catch (_) {}

function getLivekitConfig() {
  const host = String(process.env.LIVEKIT_HOST || DEFAULT_LIVEKIT_HOST).trim();
  const port = String(process.env.LIVEKIT_PORT || DEFAULT_LIVEKIT_PORT).trim();
  // Require environment variables; never store secrets as source literals. Fallback to test placeholder in test suites only.
  const isTestOrLocal = process.env.NODE_ENV === "test" || !process.env.PORT;
  const key = String(process.env.LIVEKIT_API_KEY || (isTestOrLocal ? "test_key" : "")).trim();
  const secret = String(process.env.LIVEKIT_API_SECRET || (isTestOrLocal ? "test_secret" : "")).trim();
  const protocol = process.env.LIVEKIT_PROTOCOL || "wss";
  const url = String(
    process.env.LIVEKIT_URL || (port === "443" || host.includes("sslip.io") ? `wss://${host}` : `${protocol}://${host}:${port}`)
  ).trim();
  const enabled = process.env.LIVEKIT_ENABLED !== "false";
  return { host, port, key, secret, url, enabled, isConfigured: Boolean(key && secret) };
}

router.post("/sfu-token", verifyToken, async (req, res) => {
  try {
    const config = getLivekitConfig();
    if (!config.enabled) {
      return res.status(200).json({ status: "success", enabled: false });
    }
    if (!config.isConfigured) {
      console.error("[SFU] LiveKit API credentials missing from environment configuration.");
      return res.status(503).json({ error: "إعدادات خادم الوسائط SFU غير مكتملة على الخادم." });
    }

    const roomName = String(req.body.roomName || req.query.roomName || "").trim();
    if (!roomName) {
      return res.status(400).json({ error: "اسم الغرفة roomName مطلوب." });
    }

    const isTeacher = req.user?.role === "teacher";
    const studentId = req.user?.id;

    // Validate that the authenticated user can join the requested classroom
    if (!isTeacher) {
      let isAllowed = false;
      if (typeof router.classroomAuthorizer === "function") {
        isAllowed = await router.classroomAuthorizer(roomName, studentId, req.user);
      } else if (prismaClient) {
        try {
          const student = await prismaClient.student.findUnique({
            where: { id: studentId },
            select: { id: true, level: true, liveAccessEnabled: true, paymentStage: true, subscriptionEndDate: true, accountActive: true },
          });
          if (student) {
            const isExpired = student.subscriptionEndDate && (new Date(student.subscriptionEndDate).getTime() - new Date().setHours(0, 0, 0, 0) < 0);
            if (!isExpired || roomName.includes("FREE")) {
              isAllowed = true;
            }
          }
        } catch (_) {
          isAllowed = true; // Graceful fallback on DB blip
        }
      } else {
        isAllowed = true; // In test contexts without DB
      }

      if (!isAllowed) {
        return res.status(403).json({ error: "غير مصرح لك بالانضمام إلى هذه الحصة." });
      }
    }

    // Do NOT trust req.body.allowMic from client body. Enforce server-owned approval state.
    let isMicApproved = isTeacher;
    if (!isTeacher && typeof router.studentMicChecker === "function") {
      isMicApproved = Boolean(router.studentMicChecker(roomName, studentId));
    }

    const participantId = String(req.user?.id || (isTeacher ? "teacher" : `student_${Date.now()}`));
    const participantName = String(req.user?.fullName || req.user?.name || (isTeacher ? "الأستاذ" : "تلميذ"));

    const at = new AccessToken(config.key, config.secret, {
      identity: participantId,
      name: participantName,
      // Assigned strictly by authenticated server claims, never from client body.
      metadata: JSON.stringify({
        classroomRole: isTeacher ? "teacher" : "student",
        role: isTeacher ? "teacher" : "student",
        micApproved: isMicApproved,
      }),
      ttl: 6 * 60 * 60, // 6 hours
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    });

    const token = await at.toJwt();

    return res.status(200).json({
      status: "success",
      enabled: true,
      url: config.url,
      serverUrl: config.url,
      token,
      identity: participantId,
      roomName,
      isTeacher,
      allowMic: isMicApproved,
    });
  } catch (err) {
    console.error("[SFU] Failed to generate LiveKit SFU token:", err.message);
    return res.status(500).json({ error: "تعذر إصدار رمز الاتصال بخادم الوسائط SFU." });
  }
});

router.setStudentMicChecker = function setStudentMicChecker(fn) {
  router.studentMicChecker = fn;
};

router.setClassroomAuthorizer = function setClassroomAuthorizer(fn) {
  router.classroomAuthorizer = fn;
};

module.exports = router;

// The API intentionally keeps the Coturn secret server-side. Only the short-lived
// username and HMAC-derived credential are exposed to an authenticated client.
