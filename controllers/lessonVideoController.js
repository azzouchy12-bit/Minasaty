"use strict";

const prisma = require("../lib/prisma");
const { isStudentSubscriptionExpired } = require("../utils/subscriptionValidity");

const MAX_TITLE_LENGTH = 160;
const VALID_LEVELS = new Set([
  "السنة الأولى",
  "السنة الثانية",
  "السنة الثالثة",
  "السنة الرابعة",
  "طالب جامعي",
]);
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SECONDARY_REPOSITORY_TYPES = new Set(["MATH", "PHYSICS"]);
const UNIVERSITY_REPOSITORY_TYPES = new Set(["FREE", "PAID"]);
const LEGACY_REPOSITORY_TYPE = "UNCLASSIFIED";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLevel(value) {
  const level = normalizeText(value);
  return VALID_LEVELS.has(level) ? level : "";
}

function normalizeRepositoryType(value) {
  const repositoryType = normalizeText(value).toUpperCase();
  return repositoryType;
}

function repositoryTypeLabel(level, repositoryType) {
  if (level === "طالب جامعي") {
    return repositoryType === "PAID" ? "اشتراك مدفوع" : "اشتراك مجاني";
  }
  return repositoryType === "PHYSICS" ? "الفيزياء" : "الرياضيات";
}

function isValidRepositoryType(level, repositoryType) {
  const allowedTypes = level === "طالب جامعي" ? UNIVERSITY_REPOSITORY_TYPES : SECONDARY_REPOSITORY_TYPES;
  return allowedTypes.has(repositoryType);
}

function extractGoogleDriveFileId(value) {
  const rawUrl = normalizeText(value);
  if (!rawUrl) {
    return "";
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "drive.google.com" && host !== "docs.google.com") {
      return "";
    }

    const pathMatch = parsed.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{20,200})/);
    const queryId = parsed.searchParams.get("id");
    const fileId = pathMatch?.[1] || queryId || "";
    return DRIVE_FILE_ID_PATTERN.test(fileId) ? fileId : "";
  } catch {
    return "";
  }
}

function extractYouTubeVideoId(value) {
  const rawUrl = normalizeText(value);
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : "";
    }
    if (!["youtube.com", "m.youtube.com"].includes(host)) return "";
    const queryId = parsed.searchParams.get("v") || "";
    const pathId = parsed.pathname.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/)?.[1] || "";
    const id = queryId || pathId;
    return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : "";
  } catch {
    return "";
  }
}

function youtubeEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${videoId}?controls=1&fs=1&rel=0&playsinline=1&enablejsapi=1&origin=https://dr.africacold.fr`;
}

function serializeLessonVideo(video, access = { canWatch: true, accessReason: null }) {
  const repositoryType = video.repositoryType || LEGACY_REPOSITORY_TYPE;
  const youtubeMatch = String(video.driveUrl || "").match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  const youtubeVideoId = youtubeMatch?.[1] || "";
  const isYouTube = Boolean(youtubeVideoId);
  const youtubePreviewUrl = isYouTube
    ? `https://www.youtube.com/embed/${youtubeVideoId}?controls=1&fs=1&rel=0&playsinline=1&enablejsapi=1&origin=https://dr.africacold.fr`
    : "";

  return {
    id: video.id,
    title: video.title,
    level: video.level,
    repositoryType,
    repositoryTypeLabel: repositoryType === LEGACY_REPOSITORY_TYPE
      ? "قديم — غير مصنف"
      : repositoryTypeLabel(video.level, repositoryType),
    driveUrl: access.canWatch ? video.driveUrl : null,
    previewUrl: access.canWatch ? (youtubePreviewUrl || `https://drive.google.com/file/d/${video.driveFileId}/preview`) : null,
    canWatch: Boolean(access.canWatch),
    locked: !access.canWatch,
    accessReason: access.accessReason || null,
    upgradeRequired: !access.canWatch,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
}

async function getParentStudentForLevel(parentPhone, level, studentId) {
  if (!parentPhone || !level) {
    return null;
  }

  return prisma.student.findFirst({
    where: {
      parentPhone,
      level,
      ...(studentId ? { id: studentId } : {}),
    },
    select: {
      id: true,
      level: true,
      paymentStage: true,
      paymentStatus: true,
      mathEnrollment: true,
      physicsEnrollment: true,
      subscriptionStartDate: true,
      subscriptionEndDate: true,
    },
  });
}

function getStudentRepositoryTypes(student) {
  if (!student) return [];
  if (student.level === "طالب جامعي") {
    const types = student.paymentStage === "PAID" || student.paymentStatus === true
      ? ["FREE", "PAID"]
      : ["FREE"];
    return [...types, "UNCLASSIFIED"];
  }

  const types = [
    student.mathEnrollment ? "MATH" : null,
    student.physicsEnrollment ? "PHYSICS" : null,
  ].filter(Boolean);

  return [...types, "UNCLASSIFIED"];
}

function getLessonAccess(student, video) {
  const repositoryType = video.repositoryType || LEGACY_REPOSITORY_TYPE;
  const paymentStage = student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");

  if (isStudentSubscriptionExpired(student)) {
    return { canWatch: false, accessReason: "EXPIRED" };
  }

  if (student.level !== "طالب جامعي" && paymentStage === "UNPAID") {
    return { canWatch: false, accessReason: "UNPAID" };
  }

  if (student.level === "طالب جامعي") {
    const paid = paymentStage === "PAID" || student.paymentStatus === true;
    if (repositoryType === "PAID" && !paid) {
      return { canWatch: false, accessReason: "FREE_ONLY" };
    }
    return { canWatch: true, accessReason: null };
  }

  if (repositoryType === "MATH" && !student.mathEnrollment) {
    return { canWatch: false, accessReason: "PHYSICS_ONLY" };
  }
  if (repositoryType === "PHYSICS" && !student.physicsEnrollment) {
    return { canWatch: false, accessReason: "MATH_ONLY" };
  }

  return { canWatch: true, accessReason: null };
}

/** Teacher-only: add a YouTube video link to a study level. */
async function createLessonVideo(req, res) {
  const level = normalizeLevel(req.body?.level);
  const title = normalizeText(req.body?.title);
  const repositoryType = normalizeRepositoryType(req.body?.repositoryType);
  const youtubeVideoId = extractYouTubeVideoId(req.body?.youtubeUrl || req.body?.driveUrl);

  if (!level || !title || title.length > MAX_TITLE_LENGTH || !youtubeVideoId || !isValidRepositoryType(level, repositoryType)) {
    return res.status(400).json({
      error: level === "طالب جامعي"
        ? "اختر نوع المستودع: اشتراك مجاني أو اشتراك مدفوع، ثم أدخل عنوان الحصة ورابط YouTube الصحيح."
        : "اختر مادة الحصة: الرياضيات أو الفيزياء، ثم أدخل العنوان ورابط YouTube الصحيح.",
    });
  }

  try {
    const lessonVideo = await prisma.lessonVideo.create({
      data: {
        title,
        level,
        driveFileId: youtubeVideoId,
        driveUrl: youtubeEmbedUrl(youtubeVideoId),
        repositoryType,
      },
    });

    return res.status(201).json({ status: "success", data: serializeLessonVideo(lessonVideo) });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "رابط هذه الحصة مضاف بالفعل إلى هذا التصنيف." });
    }
    console.error("Unable to create lesson video:", error);
    return res.status(500).json({ error: "تعذر حفظ رابط الحصة الآن." });
  }
}

/** Teacher may list any level; a parent may list levels belonging to their children only. */
async function getLessonVideosByLevel(req, res) {
  const level = normalizeLevel(req.params.level);
  if (!level) {
    return res.status(400).json({ error: "المستوى الدراسي غير صالح." });
  }

  try {
    const query = normalizeText(req.query?.q).slice(0, 160);
    const requestedRepositoryType = normalizeRepositoryType(req.query?.repositoryType);
    const createdFrom = req.query?.createdFrom ? new Date(req.query.createdFrom) : null;
    const createdTo = req.query?.createdTo ? new Date(req.query.createdTo) : null;
    let where = {
      level,
      ...(query ? { title: { contains: query, mode: "insensitive" } } : {}),
      ...(requestedRepositoryType ? { repositoryType: requestedRepositoryType } : {}),
      ...(createdFrom || createdTo ? { createdAt: { ...(createdFrom ? { gte: createdFrom } : {}), ...(createdTo ? { lte: createdTo } : {}) } } : {}),
    };
    let parentStudent = null;
    if (req.user?.role === "parent") {
      parentStudent = await getParentStudentForLevel(req.user.phone, level, normalizeText(req.query?.studentId));
      if (!parentStudent) {
        return res.status(403).json({ error: "لا تملك صلاحية الاطلاع على مستودع هذا المستوى." });
      }
      // Return all lesson cards for this level. The per-video serializer below
      // removes the playback URL for locked lessons and includes the reason.
      where = { ...where };
    } else if (req.user?.role !== "teacher") {
      return res.status(403).json({ error: "لا تملك صلاحية الاطلاع على مستودع الدروس." });
    }

    const videos = await prisma.lessonVideo.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      status: "success",
      data: videos.map((video) => serializeLessonVideo(
        video,
        parentStudent ? getLessonAccess(parentStudent, video) : { canWatch: true, accessReason: null },
      )),
    });
  } catch (error) {
    console.error("Unable to list lesson videos:", error);
    return res.status(500).json({ error: "تعذر تحميل مستودع الدروس الآن." });
  }
}

/** Teacher-only: remove a lesson entry. This never deletes the original Drive video. */
async function deleteLessonVideo(req, res) {
  const videoId = normalizeText(req.params.id);
  if (!/^[a-f0-9-]{36}$/i.test(videoId)) {
    return res.status(400).json({ error: "معرّف الحصة غير صالح." });
  }

  try {
    const deleted = await prisma.lessonVideo.deleteMany({ where: { id: videoId } });
    if (!deleted.count) {
      return res.status(404).json({ error: "لم يتم العثور على رابط الحصة." });
    }

    return res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Unable to delete lesson video:", error);
    return res.status(500).json({ error: "تعذر حذف رابط الحصة الآن." });
  }
}

module.exports = {
  createLessonVideo,
  getLessonVideosByLevel,
  deleteLessonVideo,
};
