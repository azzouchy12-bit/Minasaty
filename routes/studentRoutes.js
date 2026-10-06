"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const {
  registerStudent,
  getStudentForParent,
  getStudentCard,
  getStudentsByLevel,
  updateStudentStatusAndNotes,
  requestStudentCardReupload,
  confirmStudentCardIdentity,
  replaceStudentCard,
  submitPaymentReceipt,
  getStudentPaymentReceipt,
  updateStudentContact,
  updateStudentSubscriptionDates,
  confirmStudentPaymentReceipt,
  rejectStudentPaymentReceipt,
  deleteStudent,
} = require("../controllers/studentController");
const {
  verifyToken,
  isTeacher,
  isParentAccessingOwnRecord,
} = require("../middleware/authMiddleware");

const router = express.Router();
const uploadDirectory =
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads");
const MAX_CARD_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_SIZE_BYTES = 25 * 1024 * 1024;
const acceptedCardTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

fs.mkdirSync(uploadDirectory, { recursive: true });

const cardStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `student-card-${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

function cardFileFilter(_req, file, callback) {
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedMimeType = acceptedCardTypes.get(extension);

  if (!expectedMimeType || file.mimetype !== expectedMimeType) {
    return callback(new Error("يسمح برفع صورة البطاقة بصيغة PNG أو JPG/JPEG فقط."), false);
  }

  return callback(null, true);
}

const cardUpload = multer({
  storage: cardStorage,
  fileFilter: cardFileFilter,
  limits: { files: 1, fileSize: MAX_CARD_SIZE_BYTES },
});

// Some mobile providers send an empty or generic MIME type. Accept images by
// MIME/extension and accept PDF; the controller preserves PDFs and normalizes images.
const receiptImageExtensions = new Set([
  ".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp", ".heic", ".heif",
  ".avif", ".tif", ".tiff", ".gif", ".bmp", ".ico", ".jxl",
]);

function receiptFileFilter(_req, file, callback) {
  const mimeType = String(file.mimetype || "").toLowerCase();
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const isPdf = mimeType === "application/pdf" || extension === ".pdf";
  const isImage = mimeType.startsWith("image/") || receiptImageExtensions.has(extension);
  if (!isPdf && !isImage) {
    return callback(new Error("يرجى رفع صورة أو ملف PDF فقط لوصل الدفع."), false);
  }
  return callback(null, true);
}

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: receiptFileFilter,
  limits: { files: 1, fileSize: MAX_RECEIPT_SIZE_BYTES },
});

// Public: a new family must be able to register before an account exists.
router.post("/register", cardUpload.single("cardPhoto"), registerStudent);

// Parent-only: the signed phone claim must equal the requested URL phone.
router.get("/parent/:phone", verifyToken, isParentAccessingOwnRecord, getStudentForParent);

// Teacher-only: card photos are never exposed publicly.
router.get("/:id/card-photo", verifyToken, isTeacher, getStudentCard);

// Teacher-only: roster access is never available to parent tokens.
router.get("/level/:level", verifyToken, isTeacher, getStudentsByLevel);

// Teacher-only: a blurred university card can be returned to the student for replacement.
router.put("/:id/request-card-reupload", verifyToken, isTeacher, requestStudentCardReupload);

// Teacher-only: the teacher activates a university account only after reviewing its card.
router.put("/:id/confirm-card-identity", verifyToken, isTeacher, confirmStudentCardIdentity);

// Teacher-only: payment receipts are private and can only be viewed or approved by the teacher.
router.get("/:id/payment-receipt", verifyToken, isTeacher, getStudentPaymentReceipt);
router.put("/:id/confirm-payment-receipt", verifyToken, isTeacher, confirmStudentPaymentReceipt);
router.put("/:id/reject-payment-receipt", verifyToken, isTeacher, rejectStudentPaymentReceipt);

// Parent-only: replacement is allowed only after the teacher requests it.
router.post("/:id/card-photo", verifyToken, cardUpload.single("cardPhoto"), replaceStudentCard);

// Parent-only: a university student can submit an image of the postal payment receipt.
router.post("/:id/payment-receipt", verifyToken, receiptUpload.single("paymentReceipt"), submitPaymentReceipt);

// Teacher-only: contact edits keep the parent account and sibling records consistent.
router.put("/:id/contact", verifyToken, isTeacher, updateStudentContact);

// Teacher-only: subscription date updates
router.put("/:id/subscription-dates", verifyToken, isTeacher, updateStudentSubscriptionDates);

// Teacher-only: payment and teacher-note updates are administrative actions.
router.put("/:id", verifyToken, isTeacher, updateStudentStatusAndNotes);
router.delete("/:id", verifyToken, isTeacher, deleteStudent);

router.use((error, _req, res, next) => {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
                  error: error.field === "paymentReceipt"
          ? "الحد الأقصى لصورة وصل الدفع هو 25 ميغابايت."
          : "الحد الأقصى لصورة البطاقة هو 5 ميغابايت.",
      });
    }

    return res.status(400).json({ error: error.field === "paymentReceipt" ? "تعذر معالجة صورة وصل الدفع المرفوعة." : "تعذر معالجة صورة البطاقة المرفوعة." });
  }

  if (error.message === "يسمح برفع صورة البطاقة بصيغة PNG أو JPG/JPEG فقط." || error.message === "يرجى رفع صورة أو ملف PDF فقط لوصل الدفع.") {
    return res.status(400).json({ error: error.message });
  }

  return next(error);
});

module.exports = router;
