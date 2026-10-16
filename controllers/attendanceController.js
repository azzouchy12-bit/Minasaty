"use strict";

const prisma = require("../lib/prisma");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAlgeriaDateParts(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const partMap = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  const year = partMap.year || "1970";
  const month = partMap.month || "01";
  const day = partMap.day || "01";
  const hour = Number.parseInt(partMap.hour || "0", 10);
  const dateKey = `${year}-${month}-${day}`;

  return { dateKey, hour };
}

function normalizeSubject(subject) {
  const s = String(subject || "").trim().toUpperCase();
  if (s === "MATH" || s === "الرياضيات") return "MATH";
  if (s === "PHYSICS" || s === "الفيزياء") return "PHYSICS";
  if (s === "FREE" || s === "حصة عامة" || s === "عام") return "FREE";
  return s || "MATH";
}

function formatAttendanceDate(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-DZ", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Algiers",
  }).format(date);
}

/**
 * Deduplicate attendances according to the rule:
 * If a student enters during the 08:00 - 21:00 window (or daytime/evening live session),
 * multiple joins/reconnects on the same day for the same subject/session count as EXACTLY 1 attendance.
 */
function summarizeAttendances(records) {
  const sessionMap = new Map();

  for (const rec of records) {
    const parts = getAlgeriaDateParts(rec.joinedAt);
    if (!parts) continue;

    // Filter to the live session window (8:00 to 22:00) or count any valid classroom visit
    const isWithinWindow = parts.hour >= 8 && parts.hour <= 22;
    if (!isWithinWindow && rec.durationMinutes <= 0) {
      continue;
    }

    const subject = normalizeSubject(rec.subject);
    // Grouping key: by sessionKey if present, or by date + subject
    const groupKey = rec.sessionKey
      ? `session_${rec.sessionKey}_${subject}`
      : `day_${parts.dateKey}_${subject}`;

    const existing = sessionMap.get(groupKey);
    const duration = Math.max(0, Number(rec.durationMinutes) || 0);

    if (!existing) {
      sessionMap.set(groupKey, {
        id: rec.id,
        sessionKey: rec.sessionKey || null,
        dateKey: parts.dateKey,
        subject,
        subjectLabel: subject === "MATH" ? "الرياضيات" : subject === "PHYSICS" ? "الفيزياء" : "حصة عامة",
        level: rec.level || "",
        firstJoinedAt: rec.joinedAt,
        latestJoinedAt: rec.joinedAt,
        totalDurationMinutes: duration,
        joinCount: 1,
      });
    } else {
      existing.joinCount += 1;
      existing.totalDurationMinutes += duration;
      if (new Date(rec.joinedAt) < new Date(existing.firstJoinedAt)) {
        existing.firstJoinedAt = rec.joinedAt;
      }
      if (new Date(rec.joinedAt) > new Date(existing.latestJoinedAt)) {
        existing.latestJoinedAt = rec.joinedAt;
      }
    }
  }

  const sessions = Array.from(sessionMap.values()).sort(
    (a, b) => new Date(b.firstJoinedAt) - new Date(a.firstJoinedAt)
  ).map((item) => ({
    ...item,
    formattedDate: formatAttendanceDate(item.firstJoinedAt),
  }));

  const mathCount = sessions.filter((s) => s.subject === "MATH").length;
  const physicsCount = sessions.filter((s) => s.subject === "PHYSICS").length;
  const freeCount = sessions.filter((s) => s.subject === "FREE").length;

  return {
    totalCount: sessions.length,
    mathCount,
    physicsCount,
    freeCount,
    sessions,
  };
}

function summarizeParticipations(records) {
  let mathCount = 0;
  let physicsCount = 0;
  let freeCount = 0;
  let totalCount = 0;

  const sessions = (Array.isArray(records) ? records : []).map((item) => {
    const subject = normalizeSubject(item.subject);
    const count = Math.max(0, Number(item.count) || 0);
    totalCount += count;

    if (subject === "MATH") mathCount += count;
    else if (subject === "PHYSICS") physicsCount += count;
    else freeCount += count;

    return {
      id: item.id,
      sessionKey: item.sessionKey,
      subject,
      subjectLabel: subject === "MATH" ? "الرياضيات" : subject === "PHYSICS" ? "الفيزياء" : "حصة عامة",
      level: item.level,
      count,
      micSeconds: item.micSeconds || 0,
      lastParticipatedAt: item.lastParticipatedAt,
      formattedDate: formatAttendanceDate(item.lastParticipatedAt || item.createdAt),
    };
  }).sort((a, b) => new Date(b.lastParticipatedAt) - new Date(a.lastParticipatedAt));

  return {
    totalCount,
    mathCount,
    physicsCount,
    freeCount,
    sessions,
  };
}

/**
 * GET /api/attendance/student/:id
 *
 * A teacher can inspect any registered student. A parent is limited to the
 * student record whose parent phone matches the verified JWT claim.
 */
async function getAttendanceForStudent(req, res) {
  const studentId = typeof req.params.id === "string" ? req.params.id.trim() : "";

  if (!UUID_PATTERN.test(studentId)) {
    return res.status(400).json({ error: "معرّف التلميذ غير صالح." });
  }

  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, parentPhone: true, studentName: true, level: true },
    });

    if (!student) {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    const isTeacher = req.user?.role === "teacher";
    const isOwningParent =
      req.user?.role === "parent" &&
      typeof req.user.phone === "string" &&
      req.user.phone === student.parentPhone;

    if (!isTeacher && !isOwningParent) {
      return res.status(403).json({
        error: "لا تملك صلاحية الاطلاع على سجل حضور هذا التلميذ.",
      });
    }

    const [attendances, participations] = await Promise.all([
      prisma.attendance.findMany({
        where: { studentId: student.id },
        orderBy: { joinedAt: "desc" },
        select: {
          id: true,
          level: true,
          subject: true,
          sessionKey: true,
          joinedAt: true,
          durationMinutes: true,
        },
      }),
      prisma.classParticipation.findMany({
        where: { studentId: student.id },
        orderBy: { lastParticipatedAt: "desc" },
        select: {
          id: true,
          level: true,
          subject: true,
          sessionKey: true,
          count: true,
          micSeconds: true,
          lastParticipatedAt: true,
          createdAt: true,
        },
      }),
    ]);

    const attendanceSummary = summarizeAttendances(attendances);
    const participationSummary = summarizeParticipations(participations);

    return res.status(200).json({
      status: "success",
      data: attendances,
      attendanceSummary,
      participationSummary,
    });
  } catch (error) {
    console.error("Attendance retrieval failed:", error);
    return res.status(500).json({ error: "تعذر تحميل سجل الحضور حالياً." });
  }
}

module.exports = {
  getAttendanceForStudent,
  summarizeAttendances,
  summarizeParticipations,
};
