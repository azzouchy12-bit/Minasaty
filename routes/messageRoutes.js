"use strict";

const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");

let verifyToken = (req, res, next) => next();
try {
  const authMiddleware = require("../middleware/authMiddleware");
  if (typeof authMiddleware.verifyToken === "function") {
    verifyToken = authMiddleware.verifyToken;
  } else if (typeof authMiddleware === "function") {
    verifyToken = authMiddleware;
  }
} catch (_) {}

let messageController = {};
try {
  messageController = require("../controllers/messageController");
} catch (_) {}

// مسار المرفقات الآمن الذي لا يمكن أن يكون undefined أبداً
const uploadDir =
  messageController.MESSAGE_UPLOAD_DIR ||
  messageController.UPLOAD_DIR ||
  path.resolve(__dirname, "../uploads/messages");

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn("Upload dir notice:", err.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const cleanExt = ext ? ext.toLowerCase() : ".bin";
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + cleanExt);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(verifyToken);

router.get("/conversations", (req, res, next) => {
  if (typeof messageController.listTeacherConversations === "function") {
    return messageController.listTeacherConversations(req, res, next);
  }
  return res.status(501).json({ error: "Not implemented" });
});

router.get("/unread-count", (req, res, next) => {
  if (typeof messageController.getUnreadCount === "function") {
    return messageController.getUnreadCount(req, res, next);
  }
  return res.status(501).json({ error: "Not implemented" });
});

router.get("/:studentId", (req, res, next) => {
  if (typeof messageController.listMessages === "function") {
    return messageController.listMessages(req, res, next);
  }
  return res.status(501).json({ error: "Not implemented" });
});

router.post("/:studentId", upload.any(), (req, res, next) => {
  if (typeof messageController.sendMessage === "function") {
    return messageController.sendMessage(req, res, next);
  }
  return res.status(501).json({ error: "Not implemented" });
});

router.put("/:studentId/read", (req, res, next) => {
  if (typeof messageController.markMessagesRead === "function") {
    return messageController.markMessagesRead(req, res, next);
  }
  return res.status(501).json({ error: "Not implemented" });
});

router.get("/:studentId/files/:fileName", (req, res, next) => {
  if (typeof messageController.getMessageAttachment === "function") {
    return messageController.getMessageAttachment(req, res, next);
  }
  return res.status(501).json({ error: "Not implemented" });
});

module.exports = router;

