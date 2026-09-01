"use strict";

const fs = require("fs");
const path = require("path");
const { Prisma } = require("@prisma/client");
const { normalizeParentPhone } = require("../utils/phone");
const { normalizeEmail } = require("../utils/email");
const {
  normalizeParentPin,
  hashParentPin,
  verifyParentPin,
} = require("../utils/parentPin");
const prisma = require("../lib/prisma");
const { removeImageFile } = require("./liveChatController");
const { logAudit } = require("../utils/audit");
const { normalizeReferralCode, ensureReferralProfile, awardReferralCommission } = require("../utils/referral");
const { sendPushToRecipient } = require("../utils/push");
const { notificationRoom } = require("../utils/socketNotifications");
const { notifyTelegram, sendTelegramToParent } = require("../services/telegramService");

const uploadDirectory =
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads");

const DOCUMENT_KINDS = Object.freeze({
  CARD: "CARD",
  PAYMENT_RECEIPT: "PAYMENT_RECEIPT",
});

function documentReference(kind) {
  return `db:${kind}`;
}

function text(value, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function readUploadedFileBuffer(uploadedFile) {
  if (uploadedFile?.buffer) return uploadedFile.buffer;
  if (!uploadedFile?.path) {
    throw new Error("الملف المرفوع غير متاح للحفظ.");
  }
  return fs.promises.readFile(uploadedFile.path);
}

function inferReceiptMimeType(fileName, buffer, providedMimeType) {
  const supplied = String(providedMimeType || "").toLowerCase().trim();
  const extensionMimeType = RECEIPT_MIME_BY_EXTENSION[path.extname(String(fileName || "")).toLowerCase()];
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (supplied && supplied !== "application/octet-stream") return supplied;
  return extensionMimeType || supplied || "application/octet-stream";
}

const RECEIPT_MIME_BY_EXTENSION = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jpe": "image/jpeg",
  ".jfif": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".jxl": "image/jxl",
  ".pdf": "application/pdf",
});

async function normalizePaymentReceiptImage(uploadedFile) {
  const sourceBuffer = await readUploadedFileBuffer(uploadedFile);
  const originalName = path.basename(uploadedFile.originalname || "payment-receipt");
  const extension = path.extname(originalName).toLowerCase();
  const originalMimeType = String(uploadedFile.mimetype || "").toLowerCase();
  const mimeType = originalMimeType.startsWith("image/") || originalMimeType === "application/pdf"
    ? originalMimeType
    : RECEIPT_MIME_BY_EXTENSION[extension] || "application/octet-stream";
  const isAllowedDocument = mimeType.startsWith("image/") || mimeType === "application/pdf" || RECEIPT_MIME_BY_EXTENSION[extension];
  if (!isAllowedDocument) {
    const error = new Error("ملف وصل الدفع ليس صورة أو PDF صالحًا.");
    error.code = "UNSUPPORTED_PAYMENT_IMAGE";
    throw error;
  }

  // Keep the uploaded bytes intact. This avoids codec failures on phones that
  // produce HEIC/HEIF/AVIF while preserving PDFs exactly for teacher review.
  return {
    ...uploadedFile,
    buffer: sourceBuffer,
    originalname: originalName,
    mimetype: mimeType,
  };
}

async function upsertStudentDocument(tx, { studentId, kind, uploadedFile, buffer }) {
  const data = buffer || await readUploadedFileBuffer(uploadedFile);
  return tx.studentDocument.upsert({
    where: { studentId_kind: { studentId, kind } },
    create: {
      studentId,
      kind,
      originalName: uploadedFile.originalname || `${kind.toLowerCase()}.jpg`,
      mimeType: inferReceiptMimeType(uploadedFile.originalname, data, uploadedFile.mimetype),
      fileSize: data.length,
      data,
    },
    update: {
      originalName: uploadedFile.originalname || `${kind.toLowerCase()}.jpg`,
      mimeType: inferReceiptMimeType(uploadedFile.originalname, data, uploadedFile.mimetype),
      fileSize: data.length,
      data,
    },
  });
}

async function getStudentDocument(studentId, kind, legacyFilename) {
  const stored = await prisma.studentDocument.findUnique({
    where: { studentId_kind: { studentId, kind } },
  });
  if (stored) return stored;

  // Backward compatibility: migrate a legacy disk file to PostgreSQL on first access.
  const safeFilename = legacyFilename ? path.basename(legacyFilename) : "";
  if (!safeFilename) return null;
  const filePath = path.join(uploadDirectory, safeFilename);
  try {
    const data = await fs.promises.readFile(filePath);
    const legacyMimeType = RECEIPT_MIME_BY_EXTENSION[path.extname(safeFilename).toLowerCase()] || "application/octet-stream";
    return prisma.studentDocument.upsert({
      where: { studentId_kind: { studentId, kind } },
      create: {
        studentId,
        kind,
        originalName: safeFilename,
        mimeType: legacyMimeType,
        fileSize: data.length,
        data,
      },
      update: {
        originalName: safeFilename,
        fileSize: data.length,
        data,
      },
    });
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Unable to migrate legacy document:", error.message);
    return null;
  }
}

function sendStudentDocument(res, document) {
  const data = Buffer.from(document.data);
  const storedMimeType = String(document.mimeType || "").toLowerCase();
  const extensionMimeType = RECEIPT_MIME_BY_EXTENSION[path.extname(String(document.originalName || "")).toLowerCase()];
  const mimeType = data.subarray(0, 5).toString("ascii") === "%PDF-"
    ? "application/pdf"
    : storedMimeType && storedMimeType !== "application/octet-stream"
      ? storedMimeType
      : extensionMimeType || "application/octet-stream";
  const fileName = String(document.originalName || "payment-receipt").replace(/[\r\n"\\]/g, "_");
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Length", String(document.fileSize || document.data.length));
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(data);
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const PAYMENT_STAGES = new Set(["PAID", "UNPAID", "PROMISED"]);
const MAX_AMOUNT_DUE = 10_000_000;

class RequestValidationError extends Error {}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

const ACADEMIC_LEVEL_ALIASES = Object.freeze({
  "السنة الأولى": "السنة الأولى متوسط",
  "السنة الثانية": "السنة الثانية متوسط",
  "السنة الثالثة": "السنة الثالثة متوسط",
  "السنة الرابعة": "السنة الرابعة متوسط",
  "السنة الأولى متوسط": "السنة الأولى متوسط",
  "السنة الثانية متوسط": "السنة الثانية متوسط",
  "السنة الثالثة متوسط": "السنة الثالثة متوسط",
  "السنة الرابعة متوسط": "السنة الرابعة متوسط",
  "طالب جامعي": "طالب جامعي",
});

function academicLevelCandidates(value) {
  const normalized = normalizeText(value);
  const canonical = ACADEMIC_LEVEL_ALIASES[normalized] || normalized;
  return [...new Set([
    canonical,
    ...Object.entries(ACADEMIC_LEVEL_ALIASES)
      .filter(([, target]) => target === canonical)
      .map(([alias]) => alias),
  ].filter(Boolean))];
}

function notifyTeacherRosterChanged(req, levels, reason) {
  const io = req.app.get("io");
  const room = notificationRoom("teacher", "teacher");
  if (!io || !room) return;
  const changedLevels = [...new Set((Array.isArray(levels) ? levels : [levels])
    .flatMap(academicLevelCandidates)
    .map((level) => ACADEMIC_LEVEL_ALIASES[level] || level)
    .filter(Boolean))];
  io.to(room).emit("student_roster_changed", {
    levels: changedLevels,
    reason: normalizeText(reason).slice(0, 40) || "updated",
    timestamp: Date.now(),
  });
}

/**
 * Parse an optional URL query value as a positive safe integer. The page-size
 * ceiling prevents clients from bypassing the pagination contract.
 */
function parsePositiveInteger(value, fallback, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === "") {
    return fallback;
  }

  if (Array.isArray(value) || !/^\d+$/.test(String(value))) {
    throw new RequestValidationError(`${label} يجب أن يكون رقماً صحيحاً موجباً.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RequestValidationError(
      `${label} يجب أن يكون بين 1 و${maximum.toLocaleString("en-US")}.`
    );
  }

  return parsed;
}

function parsePagination(query) {
  const page = parsePositiveInteger(query.page, DEFAULT_PAGE, "رقم الصفحة");
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, "حجم الصفحة", MAX_LIMIT);
  const skip = (page - 1) * limit;

  if (!Number.isSafeInteger(skip)) {
    throw new RequestValidationError("رقم الصفحة كبير جداً.");
  }

  return { page, limit, skip };
}

/** POST /api/students/register — public student registration. */
async function registerStudent(req, res) {
  const uploadedCardFile = req.file;

  try {
    const studentName = normalizeText(req.body?.studentName);
    const parentPhone = normalizeParentPhone(req.body?.parentPhone);
    const parentPin = normalizeParentPin(req.body?.parentPin);
    const emailInput = String(req.body?.email || "").trim();
    const email = normalizeEmail(emailInput);
    const level = normalizeText(req.body?.level);
    if (emailInput && !email) {
      if (uploadedCardFile?.filename) await removeUploadedCard(uploadedCardFile.filename);
      return res.status(400).json({ error: "أدخل بريدًا إلكترونيًا صحيحًا." });
    }
    const referralCode = normalizeReferralCode(req.body?.referralCode);

    if (!studentName || !parentPhone || !parentPin || !level) {
      if (uploadedCardFile?.filename) await removeUploadedCard(uploadedCardFile.filename);
      return res.status(400).json({
        error: "الاسم ورقم الهاتف وكلمة المرور من 4 أرقام والمستوى الدراسي حقول مطلوبة.",
      });
    }

    const existingStudent = await prisma.student.findFirst({
      where: { studentName, parentPhone, level },
      select: { id: true },
    });

    if (existingStudent) {
      if (uploadedCardFile?.filename) await removeUploadedCard(uploadedCardFile.filename);
      return res.status(400).json({
        error: "هذا التلميذ مسجل بالفعل في هذا المستوى الدراسي بهذا الرقم.",
      });
    }

    const isUniversityStudent = level === "طالب جامعي";
    if (isUniversityStudent && !uploadedCardFile) {
      return res.status(400).json({ error: "صورة بطاقة الطالب الجامعي مطلوبة لإكمال التسجيل." });
    }
    if (!isUniversityStudent && uploadedCardFile) {
      await removeUploadedCard(uploadedCardFile.filename);
      return res.status(400).json({ error: "رفع صورة البطاقة متاح للطلاب الجامعيين فقط." });
    }

    const existingCredential = await prisma.parentCredential.findUnique({
      where: { parentPhone },
      select: { pinHash: true, email: true },
    });

    if (existingCredential) {
      const pinMatches = await verifyParentPin(parentPin, existingCredential.pinHash);
      if (!pinMatches) {
        if (uploadedCardFile?.filename) await removeUploadedCard(uploadedCardFile.filename);
        return res.status(401).json({
          error: "كلمة المرور لهذا الرقم غير صحيحة. استخدم كلمة المرور ذات 4 أرقام التي أنشأتها سابقًا.",
        });
      }
    }

    const student = await prisma.$transaction(async (tx) => {
      if (!existingCredential) {
        await tx.parentCredential.create({
          data: { parentPhone, email: email || null, pinHash: await hashParentPin(parentPin) },
        });
      } else if (email && !existingCredential.email) {
        await tx.parentCredential.update({ where: { parentPhone }, data: { email, emailVerifiedAt: null } });
      }

      const createdStudent = await tx.student.create({
        data: {
          studentName,
          parentPhone,
          level,
          paymentStatus: false,
          paymentStage: "UNPAID",
          amountDue: null,
          // New secondary students start with no paid subject selected.
          // University accounts keep both flags for backward-compatible academic flows.
          mathEnrollment: isUniversityStudent,
          physicsEnrollment: isUniversityStudent,
          liveAccessEnabled: false,
          mathNote: "",
          physicsNote: "",
          cardPhotoUrl: uploadedCardFile ? documentReference(DOCUMENT_KINDS.CARD) : null,
          paymentReceiptUrl: null,
          paymentReceiptPending: false,
          paymentReceiptSubmittedAt: null,
          accountActive: !isUniversityStudent,
          cardReuploadRequested: false,
        },
      });

      await ensureReferralProfile(tx, parentPhone, referralCode);

      if (uploadedCardFile) {
        await upsertStudentDocument(tx, {
          studentId: createdStudent.id,
          kind: DOCUMENT_KINDS.CARD,
          uploadedFile: uploadedCardFile,
        });
      }

      return createdStudent;
    });

    void notifyTelegram(req, {
      title: "تسجيل جديد",
      body: `تم تسجيل تلميذ جديد.\nالاسم: ${student.studentName}\nرقم الولي: ${student.parentPhone}\nالمستوى: ${student.level}`,
    });
    notifyTeacherRosterChanged(req, student.level, "created");
    return res.status(201).json({ status: "success", data: student });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (uploadedCardFile?.filename) await removeUploadedCard(uploadedCardFile.filename);
      return res.status(400).json({ error: "هذا التلميذ مسجل بالفعل في هذا المستوى الدراسي بهذا الرقم." });
    }

    if (uploadedCardFile?.filename) await removeUploadedCard(uploadedCardFile.filename);
    console.error("Student registration failed:", error);
    return res.status(500).json({ error: "تعذر تسجيل التلميذ حالياً." });
  }
}

/** GET /api/students/parent/:phone — ownership is enforced by middleware. */
async function getStudentForParent(req, res) {
  try {
    const parentPhone = normalizeParentPhone(req.params.phone);
    const students = await prisma.student.findMany({
      where: { parentPhone },
      orderBy: { createdAt: "desc" },
    });

    if (!students || students.length === 0) {
      return res.status(404).json({ error: "رقم الهاتف غير مسجل." });
    }

    // Return the array of students for the parent to choose from.
    return res.status(200).json(students);
  } catch (error) {
    console.error("Parent students lookup failed:", error);
    return res.status(500).json({ error: "تعذر تحميل بيانات التلاميذ حالياً." });
  }
}

/**
 * GET /api/students/level/:level?page=1&limit=50
 *
 * Returns a stable, bounded teacher roster page and total count metadata. Both
 * database operations use the same level condition and run concurrently.
 */
async function getStudentCard(req, res) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: { id: true, cardPhotoUrl: true },
    });

    if (!student?.cardPhotoUrl) {
      return res.status(404).json({ error: "لا توجد صورة بطاقة لهذا الطالب." });
    }

    const document = await getStudentDocument(
      student.id,
      DOCUMENT_KINDS.CARD,
      student.cardPhotoUrl.startsWith("db:") ? null : student.cardPhotoUrl
    );
    if (!document) {
      return res.status(404).json({ error: "صورة البطاقة غير متاحة حالياً." });
    }

    return sendStudentDocument(res, document);
  } catch (error) {
    console.error("Student card lookup failed:", error);
    return res.status(500).json({ error: "تعذر عرض صورة البطاقة حالياً." });
  }
}

async function getStudentsByLevel(req, res) {
  try {
    const level = normalizeText(req.params.level);
    if (!level) {
      return res.status(400).json({ error: "المستوى الدراسي مطلوب." });
    }

    const { page, limit, skip } = parsePagination(req.query);
    const where = { level: { in: academicLevelCandidates(level) } };

    const [totalRecords, students] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return res.status(200).json({
      status: "success",
      data: students,
      meta: {
        totalRecords,
        currentPage: page,
        totalPages: Math.ceil(totalRecords / limit),
        limit,
      },
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return res.status(400).json({ error: error.message });
    }

    console.error("Paginated level roster lookup failed:", error);
    return res.status(500).json({ error: "تعذر تحميل قائمة التلاميذ حالياً." });
  }
}

async function removeUploadedCard(filename) {
  if (!filename) {
    return;
  }

  const safeFilename = path.basename(filename);
  const filePath = path.join(uploadDirectory, safeFilename);

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Unable to remove student card file:", error.message);
    }
  }
}

function notifyAccountStatus(req, student) {
  const io = req.app.get("io");
  io?.to(`${student.level}_lobby`).emit("student_account_status_updated", {
    studentId: student.id,
    accountActive: student.accountActive,
    cardReuploadRequested: student.cardReuploadRequested,
  });
}

function notifyPaymentReceiptStatus(req, student) {
  const io = req.app.get("io");
  io?.to(`${student.level}_lobby`).emit("student_payment_receipt_updated", {
    studentId: student.id,
    paymentStage: student.paymentStage,
    paymentReceiptPending: student.paymentReceiptPending,
  });
}

async function notifyParentPaymentReceiptDecision(req, { student, approved, reason = "" }) {
  const parentPhone = String(student.parentPhone || "").trim();
  if (!parentPhone) return;

  const title = approved ? "تم قبول وصل الدفع" : "تم رفض وصل الدفع";
  const body = approved
    ? `تم قبول وصل الدفع للتلميذ ${student.studentName || "التلميذ"} وتفعيل الاشتراك.`
    : `تم رفض وصل الدفع للتلميذ ${student.studentName || "التلميذ"}. ${reason || "يمكنك رفع وصل صحيح من جديد."}`;
  const link = `/parent-dashboard.html?studentId=${encodeURIComponent(student.id)}&paymentReceipt=${approved ? "approved" : "rejected"}`;
  const dedupeKey = `PAYMENT_RECEIPT_DECISION:${student.id}:${student.paymentReceiptSubmittedAt?.getTime?.() || Date.now()}:${approved ? "APPROVED" : "REJECTED"}`;
  let notificationId = null;

  try {
    const notification = await prisma.notification.create({
      data: {
        studentId: student.id,
        recipientRole: "parent",
        recipientId: parentPhone,
        type: approved ? "PAYMENT_RECEIPT_APPROVED" : "PAYMENT_RECEIPT_REJECTED",
        title,
        body,
        link,
        dedupeKey,
      },
      select: { id: true },
    });
    notificationId = notification.id;
  } catch (error) {
    if (error?.code === "P2002") {
      const existing = await prisma.notification.findUnique({ where: { dedupeKey }, select: { id: true } }).catch(() => null);
      notificationId = existing?.id || null;
    } else {
      console.warn("Payment receipt decision notification persistence failed:", error.message);
    }
  }

  const payload = {
    title,
    body,
    link,
    tag: `payment-receipt-${student.id}-${approved ? "approved" : "rejected"}`,
    data: { type: approved ? "payment_receipt_approved" : "payment_receipt_rejected", studentId: student.id, notificationId },
    notificationId,
  };
  try {
    req.app.get("sendSocketNotification")?.({ role: "parent", recipientId: parentPhone, ...payload });
  } catch (error) {
    console.warn("Payment receipt decision socket notification failed:", error.message);
  }
  try {
    await sendPushToRecipient("parent", parentPhone, payload);
  } catch (pushError) {
    console.warn("Payment receipt decision push notification failed:", pushError.message);
  }
  try {
    await sendTelegramToParent(parentPhone, { title: payload.title, body: payload.body });
  } catch (telegramError) {
    console.warn("Payment receipt decision Telegram notification failed:", telegramError.message);
  }
}

function isUniversityIdentityPending(student) {
  return (
    student.level === "طالب جامعي" &&
    student.accountActive === false &&
    student.cardReuploadRequested === false &&
    Boolean(student.cardPhotoUrl)
  );
}

/** PUT /api/students/:id/request-card-reupload — teacher-only. */
async function requestStudentCardReupload(req, res) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: { id: true, level: true },
    });

    if (!student) {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    if (student.level !== "طالب جامعي") {
      return res.status(400).json({ error: "إعادة رفع البطاقة متاحة للطالب الجامعي فقط." });
    }

    const updatedStudent = await prisma.student.update({
      where: { id: student.id },
      data: { accountActive: false, cardReuploadRequested: true },
    });
    notifyAccountStatus(req, updatedStudent);
    void logAudit(req, {
      action: "CARD_REUPLOAD_REQUESTED",
      entityType: "Student",
      entityId: student.id,
      studentId: student.id,
      metadata: { level: student.level },
    });

    return res.status(200).json({
      status: "success",
      message: "تم إرسال طلب إعادة رفع البطاقة للطالب.",
      data: updatedStudent,
    });
  } catch (error) {
    console.error("Card reupload request failed:", error);
    return res.status(500).json({ error: "تعذر إرسال طلب إعادة رفع البطاقة حالياً." });
  }
}

/** PUT /api/students/:id/confirm-card-identity — teacher-only confirmation after review. */
async function confirmStudentCardIdentity(req, res) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        level: true,
        cardPhotoUrl: true,
        accountActive: true,
        cardReuploadRequested: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    if (student.level !== "طالب جامعي") {
      return res.status(400).json({ error: "تأكيد البطاقة متاح للطالب الجامعي فقط." });
    }

    if (!student.cardPhotoUrl) {
      return res.status(400).json({ error: "لا توجد بطاقة مرفوعة لتأكيد الهوية." });
    }

    if (student.cardReuploadRequested) {
      return res.status(400).json({ error: "ينتظر النظام رفع بطاقة جديدة من الطالب أولاً." });
    }

    if (!isUniversityIdentityPending(student)) {
      return res.status(400).json({ error: "هوية هذا الطالب مؤكدة بالفعل." });
    }

    const updatedStudent = await prisma.student.update({
      where: { id: student.id },
      data: { accountActive: true, cardReuploadRequested: false },
    });
    notifyAccountStatus(req, updatedStudent);
    void logAudit(req, {
      action: "CARD_IDENTITY_CONFIRMED",
      entityType: "Student",
      entityId: student.id,
      studentId: student.id,
      metadata: { level: student.level },
    });

    return res.status(200).json({
      status: "success",
      message: "تم تأكيد هوية البطاقة وتفعيل حساب الطالب.",
      data: updatedStudent,
    });
  } catch (error) {
    console.error("Student card identity confirmation failed:", error);
    return res.status(500).json({ error: "تعذر تأكيد هوية البطاقة حالياً." });
  }
}

/** POST /api/students/:id/card-photo — owning parent uploads a replacement card. */
async function replaceStudentCard(req, res) {
  const uploadedCardFile = req.file;

  try {
    if (!uploadedCardFile?.filename) {
      return res.status(400).json({ error: "اختر صورة بطاقة بصيغة JPG أو PNG أولاً." });
    }

    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        parentPhone: true,
        level: true,
        cardPhotoUrl: true,
        cardReuploadRequested: true,
      },
    });

    if (!student || student.parentPhone !== req.user?.phone) {
      await removeUploadedCard(uploadedCardFile.filename);
      return res.status(403).json({ error: "لا تملك صلاحية تحديث بطاقة هذا الطالب." });
    }

    if (student.level !== "طالب جامعي" || !student.cardReuploadRequested) {
      await removeUploadedCard(uploadedCardFile.filename);
      return res.status(400).json({ error: "لم يطلب الأستاذ إعادة رفع بطاقة هذا الطالب." });
    }

    const updatedStudent = await prisma.$transaction(async (tx) => {
      const data = await readUploadedFileBuffer(uploadedCardFile);
      const updated = await tx.student.update({
        where: { id: student.id },
        data: {
          cardPhotoUrl: documentReference(DOCUMENT_KINDS.CARD),
          // الصورة البديلة تحتاج مراجعة الأستاذ مثل البطاقة الأولى.
          accountActive: false,
          cardReuploadRequested: false,
        },
      });
      await upsertStudentDocument(tx, {
        studentId: student.id,
        kind: DOCUMENT_KINDS.CARD,
        uploadedFile: uploadedCardFile,
        buffer: data,
      });
      return updated;
    });
    await removeUploadedCard(student.cardPhotoUrl?.startsWith("db:") ? null : student.cardPhotoUrl);
    await removeUploadedCard(uploadedCardFile.filename);
    notifyAccountStatus(req, updatedStudent);

    return res.status(200).json({
      status: "success",
      message: "تم رفع البطاقة الجديدة بنجاح.",
      data: updatedStudent,
    });
  } catch (error) {
    if (uploadedCardFile?.filename) {
      await removeUploadedCard(uploadedCardFile.filename);
    }
    console.error("Student card replacement failed:", error);
    return res.status(500).json({ error: "تعذر رفع البطاقة الجديدة حالياً." });
  }
}

/** POST /api/students/:id/payment-receipt — owning parent submits payment proof. */
async function submitPaymentReceipt(req, res) {
  const uploadedReceiptFile = req.file;

  try {
    if (!uploadedReceiptFile?.buffer && !uploadedReceiptFile?.path) {
      return res.status(400).json({ error: "اختر صورة أو ملف PDF لوصل الدفع أولاً." });
    }

    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        parentPhone: true,
        level: true,
        paymentStage: true,
        paymentStatus: true,
        paymentReceiptUrl: true,
      },
    });

    if (!student || student.parentPhone !== req.user?.phone) {
      await removeUploadedCard(uploadedReceiptFile.filename);
      return res.status(403).json({ error: "لا تملك صلاحية إرسال وصل دفع لهذا الطالب." });
    }

    if (student.paymentStage === "PAID" || student.paymentStatus) {
      await removeUploadedCard(uploadedReceiptFile.filename);
      return res.status(400).json({ error: "هذا الحساب لديه اشتراك مدفوع بالفعل." });
    }

    const isUniversityStudent = student.level === "طالب جامعي";
    const subscriptionType = normalizeText(req.body?.subscriptionType).toUpperCase();
    const validSubscriptionTypes = new Set(["BOTH", "MATH", "PHYSICS"]);
    if (!isUniversityStudent && !validSubscriptionTypes.has(subscriptionType)) {
      await removeUploadedCard(uploadedReceiptFile.filename);
      return res.status(400).json({ error: "اختر نوع الاشتراك قبل إرسال وصل الدفع." });
    }

    const normalizedReceiptFile = await normalizePaymentReceiptImage(uploadedReceiptFile);
    const updateData = {
      paymentReceiptUrl: normalizedReceiptFile.filename || null,
      paymentReceiptPending: true,
      paymentReceiptSubmittedAt: new Date(),
      paymentReceiptDecision: "PENDING",
      paymentReceiptDecisionReason: null,
      paymentReceiptDecidedAt: null,
      pendingSubscriptionType: isUniversityStudent ? null : subscriptionType,
    };
    if (!isUniversityStudent) {
      updateData.mathEnrollment = ["BOTH", "MATH"].includes(subscriptionType);
      updateData.physicsEnrollment = ["BOTH", "PHYSICS"].includes(subscriptionType);
      updateData.amountDue = subscriptionType === "BOTH" ? 2000 : 1000;
    }

    const updatedStudent = await prisma.$transaction(async (tx) => {
      const data = normalizedReceiptFile.buffer;
      const updated = await tx.student.update({
        where: { id: student.id },
        data: {
          ...updateData,
          paymentReceiptUrl: documentReference(DOCUMENT_KINDS.PAYMENT_RECEIPT),
        },
      });
      await upsertStudentDocument(tx, {
        studentId: student.id,
        kind: DOCUMENT_KINDS.PAYMENT_RECEIPT,
        uploadedFile: normalizedReceiptFile,
        buffer: data,
      });
      return updated;
    });
    await removeUploadedCard(student.paymentReceiptUrl?.startsWith("db:") ? null : student.paymentReceiptUrl);
    await removeUploadedCard(uploadedReceiptFile.filename);
    notifyPaymentReceiptStatus(req, updatedStudent);
    void notifyTelegram(req, {
      title: "وصل دفع يدوي جديد",
      body: `رفع الولي وصل دفع جديدًا.\nالتلميذ: ${updatedStudent.studentName}\nرقم الولي: ${updatedStudent.parentPhone}\nالمستوى: ${updatedStudent.level}\nالمبلغ المطلوب: ${updatedStudent.amountDue ?? "غير محدد"} دج`,
    });
    void logAudit(req, {
      action: "PAYMENT_RECEIPT_SUBMITTED",
      entityType: "PaymentEvent",
      entityId: student.id,
      studentId: student.id,
      metadata: {
        level: student.level,
        subscriptionType: isUniversityStudent ? "UNIVERSITY" : subscriptionType,
        amountDue: updatedStudent.amountDue,
      },
    });

    return res.status(200).json({
      status: "success",
      message: isUniversityStudent
        ? "تم إرسال وصل الدفع. سيؤكد الأستاذ الترقية بعد مراجعة الوصل."
        : "تم إرسال الوصل واختيار الاشتراك. سيؤكد الأستاذ الدفع بعد المراجعة.",
      data: updatedStudent,
    });
  } catch (error) {
    if (uploadedReceiptFile?.filename) {
      await removeUploadedCard(uploadedReceiptFile.filename);
    }
    console.error("Payment receipt submission failed:", error);
    return res.status(500).json({ error: "تعذر إرسال وصل الدفع حالياً." });
  }
}

/** GET /api/students/:id/payment-receipt — teacher-only protected receipt preview. */
async function getStudentPaymentReceipt(req, res) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: { id: true, paymentReceiptUrl: true },
    });

    if (!student?.paymentReceiptUrl) {
      return res.status(404).json({ error: "لا يوجد وصل دفع مرفوع لهذا الطالب." });
    }

    const document = await getStudentDocument(
      student.id,
      DOCUMENT_KINDS.PAYMENT_RECEIPT,
      student.paymentReceiptUrl.startsWith("db:") ? null : student.paymentReceiptUrl
    );
    if (!document) {
      return res.status(404).json({ error: "وصل الدفع غير متاح حالياً." });
    }

    return sendStudentDocument(res, document);
  } catch (error) {
    console.error("Payment receipt lookup failed:", error);
    return res.status(500).json({ error: "تعذر عرض وصل الدفع حالياً." });
  }
}

/** PUT /api/students/:id/confirm-payment-receipt — teacher approves a payment receipt. */
async function confirmStudentPaymentReceipt(req, res) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        studentName: true,
        parentPhone: true,
        level: true,
        paymentReceiptUrl: true,
        paymentReceiptPending: true,
        paymentReceiptSubmittedAt: true,
        pendingSubscriptionType: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    if (!student.paymentReceiptUrl || !student.paymentReceiptPending) {
      return res.status(400).json({ error: "لا يوجد وصل دفع جديد بانتظار التأكيد." });
    }

    const updatedStudent = await prisma.$transaction(async (tx) => {
      const updated = await tx.student.update({
        where: { id: student.id },
        data: {
          paymentStatus: true,
          paymentStage: "PAID",
          amountDue: 0,
          paymentReceiptPending: false,
          paymentReceiptDecision: "APPROVED",
          paymentReceiptDecisionReason: null,
          paymentReceiptDecidedAt: new Date(),
          pendingSubscriptionType: null,
          liveAccessEnabled: true,
        },
      });
      await awardReferralCommission(tx, {
        referredParentPhone: student.parentPhone,
        level: student.level,
        subscriptionType: student.pendingSubscriptionType,
      });
      return updated;
    });
    notifyPaymentReceiptStatus(req, updatedStudent);
    void notifyParentPaymentReceiptDecision(req, {
      student,
      approved: true,
    });
    void notifyTelegram(req, {
      title: "تم قبول وصل دفع يدوي",
      body: `تم قبول الوصل وتفعيل الاشتراك.\nالتلميذ: ${updatedStudent.studentName}\nرقم الولي: ${updatedStudent.parentPhone}\nالمستوى: ${updatedStudent.level}`,
    });
    void prisma.paymentEvent.create({
      data: {
        studentId: student.id,
        stage: "PAID",
        amount: 0,
        actorRole: req.user?.role || "teacher",
        actorId: req.user?.sessionId || null,
        note: "تم تأكيد وصل الدفع",
      },
    }).catch(() => {});
    void logAudit(req, {
      action: "PAYMENT_RECEIPT_CONFIRMED",
      entityType: "PaymentEvent",
      entityId: student.id,
      studentId: student.id,
      metadata: { level: updatedStudent.level, stage: "PAID" },
    });

    const io = req.app.get("io");
    io?.to(`${updatedStudent.level}_lobby`).emit("student_live_access_updated", {
      studentId: updatedStudent.id,
      liveAccessEnabled: true,
    });

    return res.status(200).json({
      status: "success",
      message: updatedStudent.level === "طالب جامعي"
        ? "تم تأكيد الدفع. أصبح الحساب مدفوعًا ويمكنه دخول جميع الحصص."
        : "تم تأكيد وصل الدفع. أصبح اشتراك التلميذ مدفوعًا ويمكنه دخول الحصص المختارة.",
      data: updatedStudent,
    });
  } catch (error) {
    console.error("Payment receipt confirmation failed:", error);
    return res.status(500).json({ error: "تعذر تأكيد وصل الدفع حالياً." });
  }
}

/** PUT /api/students/:id/reject-payment-receipt — teacher rejects an invalid payment proof. */
async function rejectStudentPaymentReceipt(req, res) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        studentName: true,
        parentPhone: true,
        level: true,
        paymentReceiptUrl: true,
        paymentReceiptPending: true,
        paymentReceiptSubmittedAt: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    if (!student.paymentReceiptUrl || !student.paymentReceiptPending) {
      return res.status(400).json({ error: "لا يوجد وصل دفع جديد بانتظار الرفض." });
    }

    const rejectionReason = text(req.body?.reason, 500);
    const oldReceiptUrl = student.paymentReceiptUrl;
    const updatedStudent = await prisma.$transaction(async (tx) => {
      await tx.studentDocument.deleteMany({
        where: {
          studentId: student.id,
          kind: DOCUMENT_KINDS.PAYMENT_RECEIPT,
        },
      });
      return tx.student.update({
        where: { id: student.id },
        data: {
          paymentReceiptUrl: null,
          paymentReceiptPending: false,
          paymentReceiptSubmittedAt: null,
          paymentReceiptDecision: "REJECTED",
          paymentReceiptDecisionReason: rejectionReason || "الوصل غير واضح أو لا يثبت عملية الدفع.",
          paymentReceiptDecidedAt: new Date(),
          pendingSubscriptionType: null,
        },
      });
    });

    if (!oldReceiptUrl.startsWith("db:")) {
      await removeUploadedCard(oldReceiptUrl);
    }

    notifyPaymentReceiptStatus(req, updatedStudent);
    void notifyParentPaymentReceiptDecision(req, {
      student,
      approved: false,
      reason: rejectionReason,
    });
    void notifyTelegram(req, {
      title: "تم رفض وصل دفع يدوي",
      body: `تم رفض وصل الدفع.\nالتلميذ: ${student.studentName}\nرقم الولي: ${student.parentPhone}\nالمستوى: ${student.level}\nالسبب: ${rejectionReason || "الوصل غير واضح أو غير صالح"}`,
    });
    void prisma.paymentEvent.create({
      data: {
        studentId: student.id,
        stage: "RECEIPT_REJECTED",
        amount: 0,
        actorRole: req.user?.role || "teacher",
        actorId: req.user?.sessionId || null,
        note: rejectionReason || "تم رفض وصل الدفع المرفوع لأنه غير صالح أو لا يثبت عملية الدفع.",
      },
    }).catch(() => {});
    void logAudit(req, {
      action: "PAYMENT_RECEIPT_REJECTED",
      entityType: "PaymentEvent",
      entityId: student.id,
      studentId: student.id,
      metadata: { level: updatedStudent.level, stage: "RECEIPT_REJECTED" },
    });

    return res.status(200).json({
      status: "success",
      message: "تم رفض الوصل وحذفه، وتم إشعار ولي الأمر. يمكن للولي إرسال وصل صحيح من جديد.",
      data: updatedStudent,
    });
  } catch (error) {
    console.error("Payment receipt rejection failed:", error);
    return res.status(500).json({ error: "تعذر رفض وصل الدفع حالياً." });
  }
}

/** DELETE /api/students/:id — teacher-only user deletion. */
async function deleteStudent(req, res) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          parentPhone: true,
          cardPhotoUrl: true,
          paymentReceiptUrl: true,
          studentName: true,
          level: true,
          questionImages: { select: { fileName: true } },
        },
      });

      if (!student) return null;

      await tx.student.delete({ where: { id: student.id } });
      const remainingStudents = await tx.student.count({ where: { parentPhone: student.parentPhone } });
      let parentAccountDeleted = false;

      if (remainingStudents === 0) {
        const now = new Date();
        await tx.session.updateMany({
          where: { role: "parent", subjectId: student.parentPhone, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.passwordResetRequest.deleteMany({ where: { parentPhone: student.parentPhone } });
        await tx.messengerLink.deleteMany({ where: { parentPhone: student.parentPhone } });
        await tx.parentCredential.deleteMany({ where: { parentPhone: student.parentPhone } });
        parentAccountDeleted = true;
      }

      return { student, remainingStudents, parentAccountDeleted };
    });

    if (!result) {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    await removeUploadedCard(result.student.cardPhotoUrl);
    await removeUploadedCard(result.student.paymentReceiptUrl);
    await Promise.all(result.student.questionImages.map((image) => removeImageFile(image.fileName)));
    void logAudit(req, {
      action: "STUDENT_DELETED",
      entityType: "Student",
      entityId: result.student.id,
      metadata: {
        studentName: result.student.studentName,
        parentPhone: result.student.parentPhone,
        remainingStudents: result.remainingStudents,
        parentAccountDeleted: result.parentAccountDeleted,
      },
    });
    notifyTeacherRosterChanged(req, result.student.level, "deleted");

    return res.status(200).json({
      status: "success",
      parentAccountDeleted: result.parentAccountDeleted,
      message: result.parentAccountDeleted
        ? `تم حذف التلميذ ${result.student.studentName} وحساب الولي المرتبط به نهائيًا.`
        : `تم حذف التلميذ ${result.student.studentName}. بقي حساب الولي لأن لديه تلاميذ آخرين.`,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    console.error("Student deletion failed:", error);
    return res.status(500).json({ error: "تعذر حذف المستخدم حالياً." });
  }
}

/** PUT /api/students/:id/contact — teacher-only authorization is enforced by middleware. */
async function updateStudentContact(req, res) {
  try {
    const { id } = req.params;
    const studentName = text(req.body?.studentName, 120);
    const parentPhone = normalizeParentPhone(req.body?.parentPhone);

    if (!studentName || studentName.length < 2 || !parentPhone) {
      return res.status(400).json({
        error: "أدخل اسمًا صحيحًا ورقم هاتف جزائريًا صحيحًا يبدأ بـ 05 أو 06 أو 07.",
      });
    }

    const currentStudent = await prisma.student.findUnique({
      where: { id },
      select: { id: true, studentName: true, parentPhone: true, level: true },
    });
    if (!currentStudent) {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    const oldParentPhone = currentStudent.parentPhone;
    const phoneChanged = oldParentPhone !== parentPhone;
    const duplicate = await prisma.student.findFirst({
      where: {
        id: { not: id },
        studentName,
        parentPhone,
        level: currentStudent.level,
      },
      select: { id: true },
    });
    if (duplicate) {
      return res.status(409).json({ error: "يوجد تلميذ آخر بالاسم نفسه ورقم الهاتف والمستوى نفسه." });
    }

    if (phoneChanged) {
      const targetCredential = await prisma.parentCredential.findUnique({
        where: { parentPhone },
        select: { parentPhone: true },
      });
      if (targetCredential) {
        return res.status(409).json({
          error: "رقم الهاتف الجديد مرتبط بحساب ولي موجود. استخدم رقمًا غير مرتبط بحساب آخر.",
        });
      }
    }

    const updatedStudent = await prisma.$transaction(async (tx) => {
      if (phoneChanged) {
        const credential = await tx.parentCredential.findUnique({ where: { parentPhone: oldParentPhone } });
        if (credential) {
          await tx.parentCredential.create({
            data: {
              parentPhone,
              pinHash: credential.pinHash,
              mustChangePin: credential.mustChangePin,
              temporaryPinIssuedAt: credential.temporaryPinIssuedAt,
              temporaryPinExpiresAt: credential.temporaryPinExpiresAt,
              baridiMobAccount: credential.baridiMobAccount,
              baridiMobName: credential.baridiMobName,
            },
          });

          const messengerLink = await tx.messengerLink.findUnique({ where: { parentPhone: oldParentPhone } });
          if (messengerLink) {
            await tx.messengerLink.create({
              data: {
                parentPhone,
                pageId: messengerLink.pageId,
                psid: messengerLink.psid,
                status: messengerLink.status,
                linkedAt: messengerLink.linkedAt,
                lastInteractionAt: messengerLink.lastInteractionAt,
              },
            });
          }
        }

        await tx.student.updateMany({
          where: { parentPhone: oldParentPhone },
          data: { parentPhone },
        });
        await tx.session.updateMany({
          where: { role: "parent", subjectId: oldParentPhone, revokedAt: null },
          data: { subjectId: parentPhone, revokedAt: new Date() },
        });
        await tx.notification.updateMany({
          where: { recipientRole: "parent", recipientId: oldParentPhone },
          data: { recipientId: parentPhone },
        });

        const referralProfile = await tx.referralProfile.findUnique({ where: { parentPhone: oldParentPhone } });
        if (referralProfile) {
          await tx.referralProfile.update({
            where: { parentPhone: oldParentPhone },
            data: { parentPhone },
          });
        }
        await tx.passwordResetRequest.updateMany({
          where: { parentPhone: oldParentPhone },
          data: { parentPhone },
        });
        if (credential) {
          await tx.parentCredential.delete({ where: { parentPhone: oldParentPhone } });
        }
      }

      return tx.student.update({
        where: { id },
        data: { studentName, parentPhone },
        select: { id: true, studentName: true, parentPhone: true, level: true },
      });
    });

    void logAudit(req, {
      action: "STUDENT_CONTACT_UPDATED",
      entityType: "Student",
      entityId: updatedStudent.id,
      studentId: updatedStudent.id,
      metadata: JSON.stringify({
        oldStudentName: currentStudent.studentName,
        newStudentName: updatedStudent.studentName,
        oldParentPhone,
        newParentPhone: updatedStudent.parentPhone,
        phoneChanged,
      }),
    });
    notifyTeacherRosterChanged(req, [currentStudent.level, updatedStudent.level], "contact-updated");

    return res.status(200).json({
      status: "success",
      message: phoneChanged
        ? "تم تعديل الاسم ورقم الهاتف، وتم تسجيل خروج حساب الولي لإعادة الدخول بالرقم الجديد."
        : "تم تعديل اسم التلميذ بنجاح.",
      data: updatedStudent,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }
    console.error("Student contact update failed:", error);
    return res.status(500).json({ error: "تعذر تعديل اسم التلميذ ورقم الهاتف حاليًا." });
  }
}

/** PUT /api/students/:id — teacher-only authorization is enforced by middleware. */
async function updateStudentStatusAndNotes(req, res) {
  try {
    const { id } = req.params;
    const {
      paymentStage,
      amountDue,
      mathEnrollment,
      physicsEnrollment,
      liveAccessEnabled,
      accountActive,
      mathNote,
      physicsNote,
    } = req.body || {};
    const normalizedAmount = amountDue === null || amountDue === "" ? null : Number(amountDue);

    if (
      !PAYMENT_STAGES.has(paymentStage) ||
      (normalizedAmount !== null &&
        (!Number.isSafeInteger(normalizedAmount) ||
          normalizedAmount < 0 ||
          normalizedAmount > MAX_AMOUNT_DUE)) ||
      typeof mathEnrollment !== "boolean" ||
      typeof physicsEnrollment !== "boolean" ||
      (paymentStage !== "UNPAID" && !mathEnrollment && !physicsEnrollment) ||
      typeof liveAccessEnabled !== "boolean" ||
      (accountActive !== undefined && typeof accountActive !== "boolean") ||
      typeof mathNote !== "string" ||
      typeof physicsNote !== "string"
    ) {
      return res.status(400).json({
        error: "بيانات الاشتراك والدفع والمبلغ وصلاحية الحصة أو الملاحظات غير صحيحة. يجب اختيار مادة واحدة على الأقل.",
      });
    }

    const student = await prisma.student.update({
      where: { id },
      data: {
        paymentStatus: paymentStage === "PAID",
        paymentStage,
        amountDue: normalizedAmount,
        paymentReceiptPending: paymentStage === "PAID" ? false : undefined,
        mathEnrollment,
        physicsEnrollment,
        liveAccessEnabled,
        ...(accountActive !== undefined ? { accountActive } : {}),
        mathNote: mathNote.trim(),
        physicsNote: physicsNote.trim(),
      },
    });

    // Parent dashboards observing this level receive only the changed student
    // identifier and current class-access flag. They then refresh their own
    // authenticated data without a manual page reload.
    void prisma.paymentEvent.create({
      data: {
        studentId: student.id,
        stage: paymentStage,
        amount: normalizedAmount,
        actorRole: req.user?.role || "teacher",
        actorId: req.user?.sessionId || null,
        note: "تحديث حالة الاشتراك من لوحة الأستاذ",
      },
    }).catch(() => {});
    void logAudit(req, {
      action: "STUDENT_SUBSCRIPTION_UPDATED",
      entityType: "Student",
      entityId: student.id,
      studentId: student.id,
      metadata: {
        paymentStage,
        amountDue: normalizedAmount,
        mathEnrollment,
        physicsEnrollment,
        liveAccessEnabled,
        ...(accountActive !== undefined ? { accountActive } : {}),
      },
    });

    if (accountActive !== undefined) notifyAccountStatus(req, student);
    notifyTeacherRosterChanged(req, student.level, "status-updated");
    const io = req.app.get("io");
    io?.to(`${student.level}_lobby`).emit("student_live_access_updated", {
      studentId: student.id,
      liveAccessEnabled: student.liveAccessEnabled,
    });

    return res.status(200).json({
      status: "success",
      data: student,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    console.error("Student update failed:", error);
    return res.status(500).json({ error: "تعذر تحديث بيانات التلميذ حالياً." });
  }
}

module.exports = {
  registerStudent,
  getStudentForParent,
  getStudentCard,
  getStudentsByLevel,
  updateStudentContact,
  updateStudentStatusAndNotes,
  requestStudentCardReupload,
  confirmStudentCardIdentity,
  replaceStudentCard,
  submitPaymentReceipt,
  getStudentPaymentReceipt,
  confirmStudentPaymentReceipt,
  rejectStudentPaymentReceipt,
  deleteStudent,
};
