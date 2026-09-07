"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { verifyToken, isTeacher } = require("../middleware/authMiddleware");
const prisma = require("../lib/prisma");
const {
  getAuthorizationUrl,
  exchangeCode,
  getConnectionStatus,
  listRecentVideos,
  uploadVideo,
} = require("../services/youtubeService");

const router = express.Router();

// Use a guaranteed writable system temp directory
const uploadDirectory = path.join(os.tmpdir(), "minasaty-uploads");
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: 2_000 * 1024 * 1024 }, // Increased to 2GB
  // Removed fileFilter to prevent silent rejections
});

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "");
  if (secret.length < 32) throw new Error("JWT_SECRET is missing or too short.");
  return secret;
}

function makeState() {
  return jwt.sign(
    { role: "teacher", purpose: "youtube_oauth", nonce: crypto.randomUUID() },
    getJwtSecret(),
    { algorithm: "HS256", expiresIn: "10m" }
  );
}

function verifyState(state) {
  const payload = jwt.verify(String(state || ""), getJwtSecret(), { algorithms: ["HS256"] });
  if (payload.role !== "teacher" || payload.purpose !== "youtube_oauth") throw new Error("YOUTUBE_OAUTH_STATE_INVALID");
  return payload;
}

function originForResponse(req) {
  const configured = String(process.env.CLIENT_ORIGIN || "").split(",")[0].trim();
  const forwardedProtocol = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwardedProtocol || req.protocol;
  return configured || `${protocol}://${req.get("host")}`;
}

const LEVEL_ALIASES = Object.freeze({
  "السنة الأولى متوسط": "السنة الأولى",
  "السنة الثانية متوسط": "السنة الثانية",
  "السنة الثالثة متوسط": "السنة الثالثة",
  "السنة الرابعة متوسط": "السنة الرابعة",
});
const SUBJECT_ALIASES = Object.freeze({
  "الرياضيات": "MATH",
  "الفيزياء": "PHYSICS",
  MATH: "MATH",
  PHYSICS: "PHYSICS",
  PAID: "PAID",
  FREE: "FREE",
});
const ALGIERS_TIME_ZONE = "Africa/Algiers";
const OFFICIAL_RECORDING_START_HOUR = 17;
const OFFICIAL_RECORDING_END_HOUR = 21;

function canonicalLevel(value) {
  const normalized = String(value || "").trim();
  return LEVEL_ALIASES[normalized] || normalized;
}

function canonicalSubject(value) {
  const normalized = String(value || "").trim();
  return SUBJECT_ALIASES[normalized] || normalized;
}

function getAlgiersDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ALGIERS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  };
}

function isOfficialRecordingTime(value) {
  const parts = getAlgiersDateParts(value);
  return Boolean(
    parts &&
    parts.hour >= OFFICIAL_RECORDING_START_HOUR &&
    parts.hour < OFFICIAL_RECORDING_END_HOUR
  );
}

async function attachVideoToNearestScheduledClass({ req, level, subject, videoId, recordedAt, scheduledClassId }) {
  const normalizedLevel = canonicalLevel(level);
  const targetSubject = canonicalSubject(subject);
  if (!normalizedLevel || !targetSubject || !videoId) return null;

  const recordedDate = new Date(recordedAt || Date.now());
  const timestamp = Number.isFinite(recordedDate.getTime()) ? recordedDate : new Date();
  const recordingParts = getAlgiersDateParts(timestamp);
  // Before 17:00 or at/after 21:00, treat the upload as an experiment. It stays
  // on YouTube and is deliberately not attached to the official registry.
  if (!recordingParts || !isOfficialRecordingTime(timestamp)) return null;

  const displayLevel = Object.entries(LEVEL_ALIASES).find(([, canonical]) => canonical === normalizedLevel)?.[0];
  const levelCandidates = [...new Set([normalizedLevel, displayLevel].filter(Boolean))];
  if (scheduledClassId) {
    const resumedClass = await prisma.scheduledClass.findUnique({ where: { id: scheduledClassId } });
    if (resumedClass && levelCandidates.includes(resumedClass.level) && resumedClass.subject === targetSubject && resumedClass.status !== "COMPLETED") {
      const updated = await prisma.scheduledClass.update({
        where: { id: resumedClass.id },
        data: { status: "COMPLETED", youtubeVideoId: videoId },
      });
      req.app.get("io")?.to(`${normalizedLevel}_lobby`).emit("class_registry_updated", { level: normalizedLevel, classId: updated.id });
      return { id: updated.id, level: updated.level, subject: updated.subject, scheduledAt: updated.scheduledAt };
    }
  }

  const candidates = await prisma.scheduledClass.findMany({
    where: {
      level: { in: levelCandidates },
      subject: targetSubject,
      status: "PENDING",
    },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  });
  const sameDayCandidates = candidates.filter((item) => {
    const scheduledParts = getAlgiersDateParts(item.scheduledAt);
    return scheduledParts?.dateKey === recordingParts.dateKey;
  });
  if (!sameDayCandidates.length) return null;

  const nearest = sameDayCandidates.sort((left, right) =>
    Math.abs(new Date(left.scheduledAt).getTime() - timestamp.getTime()) -
    Math.abs(new Date(right.scheduledAt).getTime() - timestamp.getTime())
  )[0];
  const updated = await prisma.scheduledClass.update({
    where: { id: nearest.id },
    data: { status: "COMPLETED", youtubeVideoId: videoId },
  });
  req.app.get("io")?.to(`${normalizedLevel}_lobby`).emit("class_registry_updated", {
    level: normalizedLevel,
    classId: updated.id,
  });
  return { id: updated.id, level: updated.level, subject: updated.subject, scheduledAt: updated.scheduledAt };
}

router.get("/status", verifyToken, isTeacher, async (_req, res) => {
  try {
    return res.status(200).json({ status: "success", data: await getConnectionStatus() });
  } catch (error) {
    console.error("Unable to read YouTube connection status:", error);
    return res.status(503).json({ error: "تعذر قراءة حالة ربط YouTube حالياً." });
  }
});

router.get("/connect", verifyToken, isTeacher, (req, res) => {
  try {
    return res.status(200).json({ status: "success", authorizationUrl: getAuthorizationUrl(makeState()) });
  } catch (error) {
    console.error("Unable to start YouTube OAuth:", error);
    return res.status(503).json({ error: error.code === "YOUTUBE_NOT_CONFIGURED" ? "أضف بيانات YouTube OAuth إلى متغيرات Railway أولاً." : "تعذر بدء ربط قناة YouTube." });
  }
});

router.get("/callback", async (req, res) => {
  const origin = originForResponse(req);
  try {
    verifyState(req.query.state);
    await exchangeCode(req.query.code);
    return res.type("html").send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>تم ربط YouTube</title><body style="font-family:Arial,sans-serif;text-align:center;padding:3rem"><h1>تم ربط قناة YouTube بنجاح</h1><p>يمكنك إغلاق هذه النافذة والعودة إلى لوحة الأستاذ.</p><script>window.opener?.postMessage({type:"youtube-connected"},${JSON.stringify(origin)});setTimeout(()=>window.close(),800);</script></body></html>`);
  } catch (error) {
    console.error("YouTube OAuth callback failed:", error);
    return res.status(400).type("html").send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>تعذر ربط YouTube</title><body style="font-family:Arial,sans-serif;text-align:center;padding:3rem"><h1>تعذر ربط قناة YouTube</h1><p>تحقق من إعدادات OAuth ثم حاول مرة أخرى.</p><script>window.opener?.postMessage({type:"youtube-connect-failed"},${JSON.stringify(origin)});</script></body></html>`);
  }
});

router.get("/videos", verifyToken, isTeacher, async (req, res) => {
  try {
    return res.status(200).json({ status: "success", data: await listRecentVideos(req.query.limit) });
  } catch (error) {
    console.error("Unable to list YouTube videos:", error);
    const status = error.code === "YOUTUBE_NOT_CONNECTED" ? 409 : 503;
    return res.status(status).json({ error: error.message || "تعذر جلب فيديوهات قناة YouTube." });
  }
});



router.post("/upload", verifyToken, isTeacher, (req, res, next) => {
  // Use manual invocation to catch Multer errors specifically
  upload.single("video")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error("Multer Error during upload:", err);
      return res.status(400).json({ error: `خطأ في رفع الملف: ${err.message}` });
    } else if (err) {
      console.error("Unknown error during upload:", err);
      return res.status(500).json({ error: "حدث خطأ غير متوقع أثناء معالجة الملف." });
    }
    next();
  });
}, async (req, res) => {
  console.log("YouTube Upload Request Received:", {
    hasFile: !!req.file,
    fileInfo: req.file ? { size: req.file.size, mimetype: req.file.mimetype, originalname: req.file.originalname } : null,
    body: req.body
  });
  const uploadedPath = req.file?.path;
  try {
    if (!req.file) {
      console.error("Upload Error: No file found in request after Multer processing.");
      return res.status(400).json({ error: "تعذر العثور على ملف الفيديو في الطلب. يرجى التحقق من المتصفح." });
    }
    const level = String(req.body?.level || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const recordedAt = String(req.body?.recordedAt || "").trim();
    const scheduledClassId = String(req.body?.scheduledClassId || "").trim();
    const title = String(req.body?.title || `حصة ${subject || "مباشرة"} - ${level || "الأكاديمية"} - ${new Date().toLocaleDateString("ar-DZ")}`).slice(0, 100);
    const description = String(req.body?.description || `تسجيل من أكاديمية التفوق للفيزياء والرياضيات\nالمستوى: ${level}\nالمادة: ${subject}`).slice(0, 5000);
    
    // Force a video mime type even if the browser/multer misidentified it
    let mimeType = req.file.mimetype;
    if (!mimeType || !mimeType.startsWith("video/")) {
      console.warn(`MimeType mismatch: Received ${mimeType}, forcing video/webm`);
      mimeType = "video/webm";
    }
    
    const result = await uploadVideo({ stream: fs.createReadStream(req.file.path), mimeType, title, description });
    
    // 1. Attach to registry
    const registryClass = await attachVideoToNearestScheduledClass({ req, level, subject, videoId: result.id, recordedAt, scheduledClassId }).catch((error) => {
      console.error("Unable to attach uploaded YouTube video to the class registry:", error);
      return null;
    });

    // Official recordings are also available to the lesson repository. Experimental
    // recordings remain on YouTube only and never enter either official registry.
    let repositoryVideo = null;
    if (registryClass) {
      try {
        const repositoryType = canonicalSubject(subject);
        repositoryVideo = await prisma.lessonVideo.create({
          data: {
            title: title.slice(0, 160),
            level: registryClass.level,
            driveFileId: result.id,
            driveUrl: result.embedUrl,
            repositoryType,
          },
        });
        console.log(`Official YouTube video ${result.id} added to Lesson Repository for ${registryClass.level}`);
      } catch (repoError) {
        console.error("Failed to add official YouTube video to Lesson Repository:", repoError);
      }
    }

    return res.status(201).json({
      status: "success",
      data: {
        ...result,
        registryClass,
        isExperimental: !registryClass,
        repositoryVideoId: repositoryVideo?.id || null,
      },
    });
  } catch (error) {
    console.error("Unable to upload video to YouTube:", error);
    const rawError = `${error?.message || ""} ${error?.response?.data?.error || ""} ${error?.response?.data?.error_description || ""}`.toLowerCase();
    const reauthRequired = rawError.includes("invalid_grant") || rawError.includes("invalid grant");
    if (reauthRequired) {
      let authorizationUrl = null;
      try {
        authorizationUrl = getAuthorizationUrl(makeState());
      } catch (authError) {
        console.error("Unable to create YouTube reauthorization URL:", authError);
      }
      return res.status(409).json({
        error: "انتهت صلاحية ربط YouTube. أعد ربط القناة ثم أعد رفع التسجيل.",
        code: "YOUTUBE_REAUTH_REQUIRED",
        reauthRequired: true,
        authorizationUrl,
      });
    }
    const status = error.code === "YOUTUBE_NOT_CONNECTED" ? 409 : 503;
    return res.status(status).json({ error: error.message || "تعذر رفع التسجيل إلى YouTube." });
  } finally {
    if (uploadedPath) fs.promises.unlink(uploadedPath).catch(() => {});
  }
});

module.exports = router;
