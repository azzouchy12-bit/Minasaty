"use strict";

const prisma = require("../lib/prisma");
const { logAudit } = require("../utils/audit");

const LEVELS = new Set([
  "السنة الأولى",
  "السنة الثانية",
  "السنة الثالثة",
  "السنة الرابعة",
  "طالب جامعي",
]);
const UNIVERSITY_LEVEL = "طالب جامعي";
const GLOBAL_ABSENCE_LEVELS = Object.freeze([...LEVELS]);
const LEVEL_ALIASES = Object.freeze({
  "السنة الأولى متوسط": "السنة الأولى",
  "السنة الثانية متوسط": "السنة الثانية",
  "السنة الثالثة متوسط": "السنة الثالثة",
  "السنة الرابعة متوسط": "السنة الرابعة",
  "1am": "السنة الأولى",
  "2am": "السنة الثانية",
  "3am": "السنة الثالثة",
  "4am": "السنة الرابعة",
});
const SECONDARY_TYPES = new Set(["MATH", "PHYSICS"]);
const UNIVERSITY_TYPES = new Set(["PAID", "FREE"]);
const REGISTRY_STATUSES = new Set(["PENDING", "COMPLETED", "TEACHER_ABSENT"]);
const MONTH_KEY_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = Object.freeze({ سبتمبر: "09", أكتوبر: "10", نوفمبر: "11" });
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalLevel(value) {
  const level = normalizeText(value);
  return LEVEL_ALIASES[level] || LEVEL_ALIASES[level.toLowerCase()] || level;
}

function isValidLevel(level) {
  return LEVELS.has(canonicalLevel(level));
}

function isValidClassType(level, subject) {
  return level === UNIVERSITY_LEVEL
    ? UNIVERSITY_TYPES.has(subject)
    : SECONDARY_TYPES.has(subject);
}

function parseScheduledAt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const scheduledAt = new Date(value);
  return Number.isFinite(scheduledAt.getTime()) ? scheduledAt : null;
}

function monthKeyFromDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthNameFromDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  return { 8: "سبتمبر", 9: "أكتوبر", 10: "نوفمبر" }[value.getUTCMonth()] || "";
}

function parseMonthFilter(value) {
  const month = normalizeText(value);
  if (MONTH_KEY_PATTERN.test(month)) return { monthKey: month, monthName: "" };
  if (MONTH_NAMES[month]) return { monthKey: "", monthName: month };
  return { monthKey: "", monthName: "" };
}

function extractGoogleDriveFileId(value) {
  const rawUrl = normalizeText(value);
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "drive.google.com" && host !== "docs.google.com") return "";
    const pathId = parsed.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{20,200})/)?.[1] || "";
    const queryId = parsed.searchParams.get("id") || "";
    const fileId = pathId || queryId;
    return DRIVE_FILE_ID_PATTERN.test(fileId) ? fileId : "";
  } catch {
    return "";
  }
}

function extractYouTubeVideoId(value) {
  const raw = normalizeText(value);
  if (YOUTUBE_VIDEO_ID_PATTERN.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.toLowerCase().replace(/^www\./, "") === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : "";
    }
    if (["youtube.com", "m.youtube.com", "www.youtube.com"].includes(parsed.hostname.toLowerCase())) {
      const embedMatch = parsed.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
      const watchId = parsed.searchParams.get("v") || embedMatch?.[1] || "";
      return YOUTUBE_VIDEO_ID_PATTERN.test(watchId) ? watchId : "";
    }
  } catch {
    // Invalid URLs are rejected as empty values.
  }
  return "";
}

function getRegistryAccess(student, subject) {
  if (!student) return { canWatch: false, reason: "NO_STUDENT" };
  if (student.level === UNIVERSITY_LEVEL) {
    const paid = student.paymentStage === "PAID" || student.paymentStatus === true;
    return { canWatch: subject === "PAID" ? paid : true, reason: paid ? "PAID" : "FREE" };
  }
  const paid = (student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID")) !== "UNPAID";
  const enrolled = subject === "MATH" ? student.mathEnrollment === true : subject === "PHYSICS" && student.physicsEnrollment === true;
  return { canWatch: paid && enrolled, reason: !paid ? "PAYMENT_REQUIRED" : enrolled ? "AUTHORIZED" : "SUBJECT_NOT_ENROLLED" };
}

function serializeRegistryClass(item, { teacher = false, student = null } = {}) {
  const access = teacher ? { canWatch: true, reason: "TEACHER" } : getRegistryAccess(student, item.subject);
  const fileId = extractGoogleDriveFileId(item.driveLink);
  const youtubeVideoId = extractYouTubeVideoId(item.youtubeVideoId);
  const canRevealVideo = item.status === "COMPLETED" && access.canWatch && Boolean(fileId || youtubeVideoId);
  return {
    id: item.id,
    level: item.level,
    subject: item.subject,
    scheduledAt: item.scheduledAt,
    monthKey: item.monthKey || monthKeyFromDate(item.scheduledAt),
    monthName: item.monthName || monthNameFromDate(item.scheduledAt),
    status: item.status || "PENDING",
    notes: item.notes || null,
    canWatch: canRevealVideo,
    accessReason: access.reason,
    driveLink: teacher ? item.driveLink : canRevealVideo ? item.driveLink : null,
    youtubeVideoId: teacher ? youtubeVideoId || null : canRevealVideo ? youtubeVideoId || null : null,
    youtubeEmbedUrl: canRevealVideo && youtubeVideoId ? `https://www.youtube.com/embed/${youtubeVideoId}?controls=1&fs=1&rel=0&playsinline=1&enablejsapi=1&origin=https://dr.africacold.fr` : null,
    previewUrl: canRevealVideo && fileId ? `https://drive.google.com/file/d/${fileId}/preview` : null,
    videoProvider: canRevealVideo ? (youtubeVideoId ? "YOUTUBE" : fileId ? "GOOGLE_DRIVE" : null) : null,
  };
}

async function getParentRegistryStudent(req, level) {
  const studentId = normalizeText(req.query?.studentId);
  level = canonicalLevel(level);
  if (req.user?.role !== "parent" || !req.user.phone || !studentId) return null;
  return prisma.student.findFirst({
    where: { id: studentId, parentPhone: req.user.phone, level },
    select: { id: true, level: true, paymentStage: true, paymentStatus: true, mathEnrollment: true, physicsEnrollment: true },
  });
}

async function notifyScheduleChange(req, level, action = "SCHEDULE_UPDATED") {
  const io = req.app.get("io");
  io?.to(`${level}_lobby`).emit("class_schedule_updated", { level });
  const students = await prisma.student.findMany({ where: { level }, select: { id: true, parentPhone: true } });
  await prisma.notification.createMany({ data: students.map((student) => ({ studentId: student.id, recipientRole: "parent", recipientId: student.parentPhone, type: "SCHEDULE", title: "تحديث برنامج الحصص", body: "تم تعديل برنامج الحصص الخاص بمستواك الدراسي.", link: "./parent-dashboard.html" })) }).catch(() => {});
  void logAudit(req, { action, entityType: "ScheduledClass", metadata: { level } });
}

async function notifyAbsenceChange(req, absence) {
  const io = req.app.get("io");
  const payload = {
    level: absence.level,
    isAbsent: absence.isAbsent,
    updatedAt: absence.updatedAt,
  };
  // Parents listen in the lobby; students already inside the live class listen
  // in the level room. Broadcast to both so the change is instantaneous in both views.
  io?.to(`${absence.level}_lobby`).emit("teacher_absence_updated", payload);
  io?.to(absence.level).emit("teacher_absence_updated", payload);
  if (absence.isAbsent) {
    const students = await prisma.student.findMany({ where: { level: absence.level }, select: { id: true, parentPhone: true } });
    await prisma.notification.createMany({ data: students.map((student) => ({ studentId: student.id, recipientRole: "parent", recipientId: student.parentPhone, type: "ABSENCE", title: "إعلان غياب الأستاذ", body: "الأستاذ غائب اليوم لظروف خاصة.", link: "./parent-dashboard.html" })) }).catch(() => {});
  }
  void logAudit(req, { action: absence.isAbsent ? "TEACHER_ABSENCE_ENABLED" : "TEACHER_ABSENCE_DISABLED", entityType: "TeacherAbsence", entityId: absence.level, metadata: { level: absence.level } });
}

async function getLevelSchedule(req, res) {
  try {
    const level = canonicalLevel(req.params.level);
    if (!isValidLevel(level)) {
      return res.status(400).json({ error: "المستوى الدراسي غير صالح." });
    }

    const [scheduledClasses, absence] = await Promise.all([
      prisma.scheduledClass.findMany({
        where: { level },
        orderBy: { scheduledAt: "asc" },
      }),
      prisma.teacherAbsence.findUnique({ where: { level } }),
    ]);

    return res.status(200).json({
      status: "success",
      level,
      scheduledClasses,
      teacherAbsent: Boolean(absence?.isAbsent),
      absenceUpdatedAt: absence?.updatedAt || null,
    });
  } catch (error) {
    console.error("Unable to load class schedule:", error);
    return res.status(500).json({ error: "تعذر تحميل برنامج الحصص حالياً." });
  }
}

async function createScheduledClass(req, res) {
  try {
    const level = canonicalLevel(req.body?.level);
    const subject = normalizeText(req.body?.subject);
    const scheduledAt = parseScheduledAt(req.body?.scheduledAt);

    if (!isValidLevel(level)) {
      return res.status(400).json({ error: "المستوى الدراسي غير صالح." });
    }
    if (!isValidClassType(level, subject)) {
      return res.status(400).json({
        error: level === UNIVERSITY_LEVEL
          ? "اختر نوع اشتراك صالحًا: مدفوع أو مجاني."
          : "اختر مادة صالحة: الرياضيات أو الفيزياء.",
      });
    }
    if (!scheduledAt) {
      return res.status(400).json({ error: "حدد تاريخًا وتوقيتًا صالحين للحصة." });
    }

    const scheduledClass = await prisma.scheduledClass.create({
      data: { level, subject, scheduledAt, monthKey: monthKeyFromDate(scheduledAt), monthName: monthNameFromDate(scheduledAt), status: "PENDING" },
    });
    void notifyScheduleChange(req, level, "SCHEDULE_CREATED");

    return res.status(201).json({
      status: "success",
      message: "تمت برمجة الحصة بنجاح.",
      data: scheduledClass,
    });
  } catch (error) {
    console.error("Unable to create scheduled class:", error);
    return res.status(500).json({ error: "تعذر برمجة الحصة حالياً." });
  }
}

async function updateScheduledClass(req, res) {
  try {
    const existing = await prisma.scheduledClass.findUnique({
      where: { id: req.params.id },
      select: { id: true, level: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "الحصة المجدولة غير موجودة." });
    }

    const level = canonicalLevel(req.body?.level || existing.level);
    const subject = normalizeText(req.body?.subject);
    const scheduledAt = parseScheduledAt(req.body?.scheduledAt);

    if (!isValidLevel(level)) {
      return res.status(400).json({ error: "المستوى الدراسي غير صالح." });
    }
    if (!isValidClassType(level, subject)) {
      return res.status(400).json({ error: "نوع الحصة غير مناسب للمستوى المحدد." });
    }
    if (!scheduledAt) {
      return res.status(400).json({ error: "حدد تاريخًا وتوقيتًا صالحين للحصة." });
    }

    const scheduledClass = await prisma.scheduledClass.update({
      where: { id: existing.id },
      data: { level, subject, scheduledAt, monthKey: monthKeyFromDate(scheduledAt), monthName: monthNameFromDate(scheduledAt) },
    });
    void notifyScheduleChange(req, existing.level, "SCHEDULE_UPDATED");
    if (existing.level !== level) {
      void notifyScheduleChange(req, level, "SCHEDULE_UPDATED");
    }

    return res.status(200).json({
      status: "success",
      message: "تم تعديل الحصة المجدولة.",
      data: scheduledClass,
    });
  } catch (error) {
    console.error("Unable to update scheduled class:", error);
    return res.status(500).json({ error: "تعذر تعديل الحصة حالياً." });
  }
}

async function deleteScheduledClass(req, res) {
  try {
    const existing = await prisma.scheduledClass.findUnique({
      where: { id: req.params.id },
      select: { id: true, level: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "الحصة المجدولة غير موجودة." });
    }

    await prisma.scheduledClass.delete({ where: { id: existing.id } });
    void notifyScheduleChange(req, existing.level, "SCHEDULE_DELETED");
    return res.status(200).json({ status: "success", message: "تم حذف الحصة المجدولة." });
  } catch (error) {
    console.error("Unable to delete scheduled class:", error);
    return res.status(500).json({ error: "تعذر حذف الحصة حالياً." });
  }
}

async function getClassRegistry(req, res) {
  try {
    const level = normalizeText(req.params.level);
    const monthFilter = parseMonthFilter(req.query?.month);
    const subject = normalizeText(req.query?.subject).toUpperCase();
    if (!isValidLevel(level)) return res.status(400).json({ error: "المستوى الدراسي غير صالح." });
    if (subject && !isValidClassType(level, subject)) return res.status(400).json({ error: "المادة أو نوع الاشتراك غير صالح." });
    if (req.user?.role !== "teacher" && req.user?.role !== "parent") return res.status(403).json({ error: "لا تملك صلاحية الاطلاع على سجل الحصص." });

    const student = req.user.role === "parent" ? await getParentRegistryStudent(req, level) : null;
    if (req.user.role === "parent" && !student) return res.status(403).json({ error: "اختر تلميذًا مرتبطًا بحساب الولي لهذا المستوى." });

    const classes = await prisma.scheduledClass.findMany({
      where: { level, ...(monthFilter.monthKey ? { monthKey: monthFilter.monthKey } : {}), ...(monthFilter.monthName ? { monthName: monthFilter.monthName } : {}), ...(subject ? { subject } : {}) },
      orderBy: { scheduledAt: "asc" },
    });
    return res.status(200).json({
      status: "success",
      level,
      month: monthFilter.monthKey || monthFilter.monthName || null,
      subject: subject || null,
      data: classes.map((item) => serializeRegistryClass(item, { teacher: req.user.role === "teacher", student })),
    });
  } catch (error) {
    console.error("Unable to load class registry:", error);
    return res.status(500).json({ error: "تعذر تحميل سجل الحصص حالياً." });
  }
}

async function updateClassRegistry(req, res) {
  try {
    const status = normalizeText(req.body?.status).toUpperCase();
    const existing = await prisma.scheduledClass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "الحصة غير موجودة في السجل." });
    if (!REGISTRY_STATUSES.has(status)) return res.status(400).json({ error: "حالة الحصة غير صالحة." });

    const notes = normalizeText(req.body?.notes).slice(0, 2000);
    const driveFileId = extractGoogleDriveFileId(req.body?.driveLink) || (status === "COMPLETED" ? extractGoogleDriveFileId(existing.driveLink) : "");
    const youtubeVideoId = extractYouTubeVideoId(req.body?.youtubeVideoId) || (status === "COMPLETED" ? extractYouTubeVideoId(existing.youtubeVideoId) : "");
    if (status === "COMPLETED" && !driveFileId && !youtubeVideoId) return res.status(400).json({ error: "اختر فيديو YouTube أو أدخل رابط Google Drive صحيحًا للحصة المسجلة." });
    if (status === "TEACHER_ABSENT" && !notes) return res.status(400).json({ error: "اكتب سبب غياب الأستاذ أو ملاحظة الحصة." });

    const updated = await prisma.scheduledClass.update({
      where: { id: existing.id },
      data: {
        status,
        driveLink: status === "COMPLETED" && driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null,
        youtubeVideoId: status === "COMPLETED" ? youtubeVideoId || null : null,
        notes: status === "PENDING" ? null : notes || null,
      },
    });
    const io = req.app.get("io");
    io?.to(`${existing.level}_lobby`).emit("class_registry_updated", { level: existing.level, classId: existing.id });
    void logAudit(req, { action: `CLASS_REGISTRY_${status}`, entityType: "ScheduledClass", entityId: existing.id, metadata: { level: existing.level, subject: existing.subject } });
    return res.status(200).json({ status: "success", message: "تم تحديث سجل الحصة.", data: serializeRegistryClass(updated, { teacher: true }) });
  } catch (error) {
    console.error("Unable to update class registry:", error);
    return res.status(500).json({ error: "تعذر تحديث سجل الحصة حالياً." });
  }
}

async function getCalendarIcs(req, res) {
  try {
    const level = normalizeText(req.params.level);
    if (!isValidLevel(level)) return res.status(400).json({ error: "المستوى الدراسي غير صالح." });
    const classes = await prisma.scheduledClass.findMany({ where: { level }, orderBy: { scheduledAt: "asc" } });
    const escapeIcs = (value) => String(value).replace(/([\\,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
    const formatUtc = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Akademiat Altawafuq//AR", "CALSCALE:GREGORIAN"];
    for (const item of classes) {
      lines.push("BEGIN:VEVENT", `UID:${item.id}@dr.africacold.fr`, `DTSTAMP:${formatUtc(item.createdAt)}`, `DTSTART:${formatUtc(item.scheduledAt)}`, `DTEND:${formatUtc(new Date(item.scheduledAt.getTime() + 60 * 60 * 1000))}`, `SUMMARY:${escapeIcs(`أكاديمية التفوق - ${item.subject}`)}`, `DESCRIPTION:${escapeIcs(`حصة المستوى ${item.level}`)}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    res.type("text/calendar; charset=utf-8");
    return res.send(lines.join("\r\n"));
  } catch (error) {
    console.error("Calendar export failed:", error);
    return res.status(500).json({ error: "تعذر تصدير التقويم حالياً." });
  }
}

async function getGlobalTeacherAbsence(req, res) {
  try {
    const absences = await prisma.teacherAbsence.findMany({
      where: { level: { in: GLOBAL_ABSENCE_LEVELS } },
      select: { level: true, isAbsent: true, updatedAt: true },
    });
    const isAbsent = absences.length === GLOBAL_ABSENCE_LEVELS.length
      && absences.every((absence) => absence.isAbsent === true);
    const updatedAt = absences
      .map((absence) => absence.updatedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

    return res.status(200).json({
      status: "success",
      data: { isAbsent, updatedAt },
    });
  } catch (error) {
    console.error("Unable to load global teacher absence:", error);
    return res.status(500).json({ error: "تعذر تحميل حالة الغياب العامة حالياً." });
  }
}

async function updateGlobalTeacherAbsence(req, res) {
  try {
    const isAbsent = req.body?.isAbsent === true;
    const absences = await prisma.$transaction(
      GLOBAL_ABSENCE_LEVELS.map((level) => prisma.teacherAbsence.upsert({
        where: { level },
        create: { level, isAbsent },
        update: { isAbsent },
      })),
    );
    const updatedAt = absences
      .map((absence) => absence.updatedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
    const io = req.app.get("io");

    for (const absence of absences) {
      const payload = {
        level: absence.level,
        isAbsent,
        isGlobal: true,
        updatedAt: absence.updatedAt,
      };
      io?.to(`${absence.level}_lobby`).emit("teacher_absence_updated", payload);
      io?.to(absence.level).emit("teacher_absence_updated", payload);
    }

    if (isAbsent) {
      const students = await prisma.student.findMany({
        where: { level: { in: GLOBAL_ABSENCE_LEVELS } },
        select: { id: true, parentPhone: true },
      });
      await prisma.notification.createMany({
        data: students.map((student) => ({
          studentId: student.id,
          recipientRole: "parent",
          recipientId: student.parentPhone,
          type: "ABSENCE",
          title: "إعلان غياب الأستاذ",
          body: "الأستاذ غائب اليوم لظروف خاصة.",
          link: "./parent-dashboard.html",
        })),
      }).catch(() => {});
    }

    void logAudit(req, {
      action: isAbsent ? "TEACHER_GLOBAL_ABSENCE_ENABLED" : "TEACHER_GLOBAL_ABSENCE_DISABLED",
      entityType: "TeacherAbsence",
      entityId: "GLOBAL",
      metadata: { levels: GLOBAL_ABSENCE_LEVELS },
    });

    return res.status(200).json({
      status: "success",
      message: isAbsent
        ? "تم إعلان غياب الأستاذ لجميع المستويات."
        : "تم إلغاء إعلان الغياب وأصبح الأستاذ حاضرًا لجميع المستويات.",
      data: { isAbsent, updatedAt, levels: GLOBAL_ABSENCE_LEVELS },
    });
  } catch (error) {
    console.error("Unable to update global teacher absence:", error);
    return res.status(500).json({ error: "تعذر تحديث حالة الغياب العامة حالياً." });
  }
}

async function updateTeacherAbsence(req, res) {
  try {
    const level = normalizeText(req.params.level);
    const isAbsent = req.body?.isAbsent === true;
    if (!isValidLevel(level)) {
      return res.status(400).json({ error: "المستوى الدراسي غير صالح." });
    }

    const absence = await prisma.teacherAbsence.upsert({
      where: { level },
      create: { level, isAbsent },
      update: { isAbsent },
    });
    void notifyAbsenceChange(req, absence);

    return res.status(200).json({
      status: "success",
      message: isAbsent ? "تم تفعيل حالة غياب الأستاذ لهذا المستوى." : "تم إلغاء حالة غياب الأستاذ لهذا المستوى.",
      data: absence,
    });
  } catch (error) {
    console.error("Unable to update teacher absence:", error);
    return res.status(500).json({ error: "تعذر تحديث حالة غياب الأستاذ حالياً." });
  }
}

module.exports = {
  getLevelSchedule,
  getClassRegistry,
  updateClassRegistry,
  getCalendarIcs,
  createScheduledClass,
  updateScheduledClass,
  deleteScheduledClass,
  getGlobalTeacherAbsence,
  updateGlobalTeacherAbsence,
  updateTeacherAbsence,
};
