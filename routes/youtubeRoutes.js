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
  createResumableUploadSession,
} = require("../services/youtubeService");

const router = express.Router();

const uploadDirectory = path.join(os.tmpdir(), "minasaty-uploads");
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: 10_000 * 1024 * 1024 }, // 4GB limit for legacy fallback
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

/**
 * 1. بدء جلسة رفع مباشر ومستأنف لـ YouTube (Resumable Upload)
 * تحل مشكلة الـ 502 لحصص الساعتين لأن المتصفح يرفع مباشرة لـ Google
 */
router.post("/resumable-session", verifyToken, isTeacher, async (req, res) => {
  try {
    const title = String(req.body?.title || "حصة مسجلة").slice(0, 100);
    const description = String(req.body?.description || "").slice(0, 5000);
    const mimeType = String(req.body?.mimeType || "video/webm").trim();
    const fileSize = Number(req.body?.fileSize) || 0;

    const session = await createResumableUploadSession({ title, description, mimeType, fileSize });
    return res.status(200).json({ status: "success", uploadUrl: session.uploadUrl });
  } catch (error) {
    console.error("Unable to init resumable YouTube upload:", error);
    return res.status(500).json({ error: error.message || "تعذر فتح جلسة الرفع إلى YouTube." });
  }
});

/**
 * 2. إتمام تسجيل الفيديو في المنصة وربطه بالقسم بعد انتهاء الرفع المباشر
 */
router.post("/resumable-finish", verifyToken, isTeacher, async (req, res) => {
  try {
    const videoId = String(req.body?.videoId || "").trim();
    if (!videoId) {
      return res.status(400).json({ error: "معرّف الفيديو مطلوب." });
    }

    const level = String(req.body?.level || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const recordedAt = String(req.body?.recordedAt || "").trim();
    const scheduledClassId = String(req.body?.scheduledClassId || "").trim();
    const title = String(req.body?.title || "").slice(0, 100);

    const result = {
      id: videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}?controls=1&fs=1&rel=0&playsinline=1&enablejsapi=1&origin=https://dr.africacold.fr`,
      privacyStatus: "unlisted",
    };

    const registryClass = await attachVideoToNearestScheduledClass({
      req,
      level,
      subject,
      videoId,
      recordedAt,
      scheduledClassId,
    }).catch((err) => {
      console.error("Attach registry error:", err);
      return null;
    });

    let repositoryVideo = null;
    if (registryClass) {
      try {
        const repositoryType = canonicalSubject(subject);
        repositoryVideo = await prisma.lessonVideo.create({
          data: {
            title: title.slice(0, 160) || `حصة ${subject}`,
            level: registryClass.level,
            driveFileId: videoId,
            driveUrl: result.embedUrl,
            repositoryType,
          },
        });
        console.log(`Official YouTube video ${videoId} added to Lesson Repository for ${registryClass.level}`);
      } catch (repoErr) {
        console.error("Lesson repo error:", repoErr);
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
    console.error("Resumable finish error:", error);
    return res.status(500).json({ error: error.message || "تعذر إتمام ربط الفيديو بالمنصة." });
  }
});

// المسار التقليدي القديم (مع رفع الحد إلى 4 جيجابايت كاحتياط)
router.post("/upload", verifyToken, isTeacher, (req, res, next) => {
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
  const uploadedPath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "تعذر العثور على ملف الفيديو في الطلب." });
    }
    const level = String(req.body?.level || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const recordedAt = String(req.body?.recordedAt || "").trim();
    const scheduledClassId = String(req.body?.scheduledClassId || "").trim();
    const title = String(req.body?.title || `حصة ${subject || "مباشرة"} - ${level || "الأكاديمية"}`).slice(0, 100);
    const description = String(req.body?.description || "").slice(0, 5000);
    
    let mimeType = req.file.mimetype;
    if (!mimeType || !mimeType.startsWith("video/")) mimeType = "video/webm";
    
    const result = await uploadVideo({ stream: fs.createReadStream(req.file.path), mimeType, title, description });
    const registryClass = await attachVideoToNearestScheduledClass({ req, level, subject, videoId: result.id, recordedAt, scheduledClassId }).catch(() => null);

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
      } catch (_) {}
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
    return res.status(500).json({ error: error.message || "تعذر رفع التسجيل إلى YouTube." });
  } finally {
    if (uploadedPath) fs.promises.unlink(uploadedPath).catch(() => {});
  }
});

module.exports = router;

