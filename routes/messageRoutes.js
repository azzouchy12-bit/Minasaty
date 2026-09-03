"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { verifyToken } = require("../middleware/authMiddleware");
const {
  attachmentUploadDirectory,
  listTeacherConversations,
  getUnreadCount,
  listMessages,
  sendMessage,
  getMessageAttachment,
  markMessagesRead,
} = require("../controllers/messageController");

const router = express.Router();
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const acceptedExtensions = new Map([
  [".jpg", ["image/jpeg"]],
  [".jpeg", ["image/jpeg"]],
  [".png", ["image/png"]],
  [".webp", ["image/webp"]],
  [".gif", ["image/gif"]],
  [".heic", ["image/heic", "image/heif"]],
  [".heif", ["image/heif", "image/heic"]],
  [".pdf", ["application/pdf"]],
  [".doc", ["application/msword"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
]);

fs.mkdirSync(attachmentUploadDirectory, { recursive: true });

function extensionFromMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "application/pdf") return ".pdf";
  if (mime === "application/msword") return ".doc";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  if (mime === "image/heic") return ".heic";
  if (mime === "image/heif") return ".heif";
  return "";
}

const attachmentStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, attachmentUploadDirectory),
  filename: (req, file, callback) => {
    const fromName = path.extname(String(file.originalname || "")).toLowerCase();
    const extension = acceptedExtensions.has(fromName) ? fromName : extensionFromMime(file.mimetype) || ".bin";
    const studentId = String(req.params.studentId || "unknown");
    callback(null, `msg-${studentId}-${crypto.randomUUID()}${extension}`);
  },
});

function attachmentFileFilter(_req, file, callback) {
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const mimeType = String(file.mimetype || "").toLowerCase();
  const allowedMimes = acceptedExtensions.get(extension);
  if (allowedMimes) {
    if (!mimeType || mimeType === "application/octet-stream" || allowedMimes.includes(mimeType) || mimeType.startsWith("image/")) {
      return callback(null, true);
    }
  }
  if (mimeType.startsWith("image/") || mimeType === "application/pdf" || mimeType.includes("word") || mimeType.includes("officedocument.wordprocessingml")) {
    return callback(null, true);
  }
  return callback(new Error("يسمح برفع الصور وملفات PDF وWord فقط."), false);
}

const attachmentUpload = multer({
  storage: attachmentStorage,
  fileFilter: attachmentFileFilter,
  limits: { files: 1, fileSize: MAX_ATTACHMENT_SIZE_BYTES },
});

function maybeParseAttachment(req, res, next) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.includes("multipart/form-data")) return next();
  return attachmentUpload.single("attachment")(req, res, next);
}

router.use(verifyToken);
router.get("/conversations", listTeacherConversations);
router.get("/unread-count", getUnreadCount);
router.get("/:studentId/files/:fileName", getMessageAttachment);
router.get("/:studentId", listMessages);
router.post("/:studentId", maybeParseAttachment, sendMessage);
router.put("/:studentId/read", markMessagesRead);

router.use((error, _req, res, next) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "الحد الأقصى للمرفق هو 10 ميغابايت." });
    }
    return res.status(400).json({ error: "تعذر معالجة الملف المرفق." });
  }
  if (error.message === "يسمح برفع الصور وملفات PDF وWord فقط.") {
    return res.status(400).json({ error: error.message });
  }
  return next(error);
});

module.exports = router;
