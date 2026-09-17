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
const DEFAULT_LIVEKIT_KEY = "minasaty_sfu_key";
const DEFAULT_LIVEKIT_SECRET = "minasaty_sfu_secret_2026_super_secure_key";

function getLivekitConfig() {
  const host = String(process.env.LIVEKIT_HOST || DEFAULT_LIVEKIT_HOST).trim();
  const port = String(process.env.LIVEKIT_PORT || DEFAULT_LIVEKIT_PORT).trim();
  const key = String(process.env.LIVEKIT_API_KEY || DEFAULT_LIVEKIT_KEY).trim();
  const secret = String(process.env.LIVEKIT_API_SECRET || DEFAULT_LIVEKIT_SECRET).trim();
  const protocol = process.env.LIVEKIT_PROTOCOL || "wss";
  const url = String(
    process.env.LIVEKIT_URL || (port === "443" || host.includes("sslip.io") ? `wss://${host}` : `${protocol}://${host}:${port}`)
  ).trim();
  const enabled = process.env.LIVEKIT_ENABLED !== "false";
  return { host, port, key, secret, url, enabled };
}


router.post("/sfu-token", verifyToken, async (req, res) => {
  try {
    const config = getLivekitConfig();
    if (!config.enabled) {
      return res.status(200).json({ status: "success", enabled: false });
    }

    const roomName = String(req.body.roomName || req.query.roomName || "").trim();
    if (!roomName) {
      return res.status(400).json({ error: "اسم الغرفة roomName مطلوب." });
    }

    const isTeacher = req.user?.role === "teacher";
    const allowMic = Boolean(req.body.allowMic) || isTeacher;
    const participantId = String(req.user?.id || (isTeacher ? "teacher" : `student_${Date.now()}`));
    const participantName = String(req.user?.fullName || req.user?.name || (isTeacher ? "الأستاذ" : "تلميذ"));

    const at = new AccessToken(config.key, config.secret, {
      identity: participantId,
      name: participantName,
      ttl: 6 * 60 * 60, // 6 hours
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: isTeacher || allowMic,
      canPublishSources: isTeacher ? ["camera", "microphone", "screen_share", "screen_share_audio"] : (allowMic ? ["microphone"] : []),
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return res.status(200).json({
      status: "success",
      enabled: true,
      serverUrl: config.url,
      token,
      identity: participantId,
      roomName,
      isTeacher,
    });
  } catch (err) {
    console.error("Failed to generate LiveKit SFU token:", err);
    return res.status(500).json({ error: "تعذر إصدار رمز الاتصال بخادم الوسائط SFU." });
  }
});

module.exports = router;

// The API intentionally keeps the Coturn secret server-side. Only the short-lived
// username and HMAC-derived credential are exposed to an authenticated client.
