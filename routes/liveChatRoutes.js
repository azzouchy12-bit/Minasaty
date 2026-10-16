"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { verifyToken } = require("../middleware/authMiddleware");
const {
  imageUploadDirectory,
  teacherChatImageDirectory,
  uploadQuestionImage,
  getQuestionImage,
  uploadTeacherChatImage,
  getTeacherChatImage,
} = require("../controllers/liveChatController");

const router = express.Router();
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_TEACHER_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const acceptedImages = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

fs.mkdirSync(imageUploadDirectory, { recursive: true });
fs.mkdirSync(teacherChatImageDirectory, { recursive: true });

// Student live question images are held in memory buffer only and forwarded directly to Telegram bot.
// They are NEVER written to the server's disk to prevent disk bloat and ensure fast streaming.
const imageStorage = multer.memoryStorage();

function imageFileFilter(_req, file, callback) {
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedMimeType = acceptedImages.get(extension);

  if (!expectedMimeType || file.mimetype !== expectedMimeType) {
    return callback(new Error("يسمح برفع صور JPG أو PNG أو WEBP فقط."), false);
  }

  return callback(null, true);
}

const imageUpload = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { files: 1, fileSize: MAX_IMAGE_SIZE_BYTES },
});

const teacherImageStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, teacherChatImageDirectory),
  filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const teacherImageUpload = multer({
  storage: teacherImageStorage,
  fileFilter: imageFileFilter,
  limits: { files: 1, fileSize: MAX_TEACHER_IMAGE_SIZE_BYTES },
});

router.post("/question-image", verifyToken, imageUpload.single("image"), uploadQuestionImage);
router.get("/question-image/:id", verifyToken, getQuestionImage);
router.post("/teacher-image", verifyToken, teacherImageUpload.single("image"), uploadTeacherChatImage);
router.get("/teacher-image/:id", verifyToken, getTeacherChatImage);

router.use((error, _req, res, next) => {
  if (!error) return next();

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      const maxSize = _req.path.includes("teacher-image") ? "20 ميغابايت" : "5 ميغابايت";
      return res.status(400).json({ error: `الحد الأقصى لحجم الصورة هو ${maxSize}.` });
    }
    return res.status(400).json({ error: "تعذر معالجة صورة السؤال المرفوعة." });
  }

  if (error.message === "يسمح برفع صور JPG أو PNG أو WEBP فقط.") {
    return res.status(400).json({ error: error.message });
  }

  return next(error);
});

module.exports = router;
