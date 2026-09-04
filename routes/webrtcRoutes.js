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

module.exports = router;

// The API intentionally keeps the Coturn secret server-side. Only the short-lived
// username and HMAC-derived credential are exposed to an authenticated client.
