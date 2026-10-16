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
 * In any single calendar day (08:00 - 23:00 Algeria time),
 * attendance is counted EXACTLY ONCE per day.
 * Multiple joins/reconnects on the same day are consolidated into 1 attendance session.
 * The primary subject of the day is determined by duration and activity.
 */
function summarizeAttendances(records) {
  const dayMap = new Map();

  for (const rec of (Array.isArray(records) ? records : [])) {
    const parts = getAlgeriaDateParts(rec.joinedAt);
    if (!parts) continue;

    // Filter to live session window (8:00 to 23:00) or any record with duration
    const isWithinWindow = parts.hour >= 8 && parts.hour <= 23;
    if (!isWithinWindow && (rec.durationMinutes || 0) <= 0) {
      continue;
    }

    const groupKey = parts.dateKey; // Strictly ONE attendance per calendar day
    const subject = normalizeSubject(rec.subject);
    const duration = Math.max(0, Number(rec.durationMinutes) || 0);

    const existing = dayMap.get(groupKey);
    if (!existing) {
      dayMap.set(groupKey, {
        id: rec.id,
        dateKey: parts.dateKey,
        firstJoinedAt: rec.joinedAt,
        latestJoinedAt: rec.joinedAt,
        level: rec.level || "",
        totalDurationMinutes: duration,
        joinCount: 1,
        subjectStats: {
          [subject]: { duration, count: 1, lastAt: new Date(rec.joinedAt).getTime() }
        }
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
      if (!existing.subjectStats[subject]) {
        existing.subjectStats[subject] = { duration, count: 1, lastAt: new Date(rec.joinedAt).getTime() };
      } else {
        existing.subjectStats[subject].duration += duration;
        existing.subjectStats[subject].count += 1;
        existing.subjectStats[subject].lastAt = Math.max(existing.subjectStats[subject].lastAt, new Date(rec.joinedAt).getTime());
      }
    }
  }

  // Resolve final dominant subject for each day
  const sessions = Array.from(dayMap.values()).map((item) => {
    let dominantSubject = "MATH";
    let maxDuration = -1;
    let maxCount = -1;
    let latestTime = 0;

    for (const [subj, stats] of Object.entries(item.subjectStats)) {
      if (
        stats.duration > maxDuration ||
        (stats.duration === maxDuration && stats.count > maxCount) ||
        (stats.duration === maxDuration && stats.count === maxCount && stats.lastAt > latestTime)
      ) {
        dominantSubject = subj;
        maxDuration = stats.duration;
        maxCount = stats.count;
        latestTime = stats.lastAt;
      }
    }

    return {
      id: item.id,
      dateKey: item.dateKey,
      subject: dominantSubject,
      subjectLabel: dominantSubject === "MATH" ? "الرياضيات" : dominantSubject === "PHYSICS" ? "الفيزياء" : "حصة عامة",
      level: item.level,
      firstJoinedAt: item.firstJoinedAt,
      latestJoinedAt: item.latestJoinedAt,
      totalDurationMinutes: item.totalDurationMinutes,
      joinCount: item.joinCount,
      formattedDate: formatAttendanceDate(item.firstJoinedAt),
    };
  }).sort((a, b) => new Date(b.firstJoinedAt) - new Date(a.firstJoinedAt));

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
  const dayMap = new Map();
  let totalCount = 0;
  let mathCount = 0;
  let physicsCount = 0;
  let freeCount = 0;

  for (const item of (Array.isArray(records) ? records : [])) {
    const count = Math.max(0, Number(item.count) || 0);
    if (count <= 0) continue;

    const parts = getAlgeriaDateParts(item.lastParticipatedAt || item.createdAt);
    const dateKey = parts ? parts.dateKey : "unknown";
    const subject = normalizeSubject(item.subject);
    const micSeconds = Math.max(0, Number(item.micSeconds) || 0);

    totalCount += count;
    if (subject === "MATH") mathCount += count;
    else if (subject === "PHYSICS") physicsCount += count;
    else freeCount += count;

    const existing = dayMap.get(dateKey);
    const itemDate = item.lastParticipatedAt || item.createdAt;

    if (!existing) {
      dayMap.set(dateKey, {
        id: item.id,
        sessionKey: item.sessionKey,
        dateKey,
        subject,
        subjectLabel: subject === "MATH" ? "الرياضيات" : subject === "PHYSICS" ? "الفيزياء" : "حصة عامة",
        level: item.level || "",
        count,
        micSeconds,
        lastParticipatedAt: itemDate,
        subjectStats: {
          [subject]: count,
        },
      });
    } else {
      existing.count += count;
      existing.micSeconds += micSeconds;
      existing.subjectStats[subject] = (existing.subjectStats[subject] || 0) + count;
      if (new Date(itemDate) > new Date(existing.lastParticipatedAt)) {
        existing.lastParticipatedAt = itemDate;
      }
    }
  }

  const sessions = Array.from(dayMap.values()).map((item) => {
    // Pick dominant subject for the day's participation
    let dominantSubject = item.subject;
    let maxSubjectCount = -1;
    for (const [subj, c] of Object.entries(item.subjectStats)) {
      if (c > maxSubjectCount) {
        dominantSubject = subj;
        maxSubjectCount = c;
      }
    }

    return {
      id: item.id,
      sessionKey: item.sessionKey,
      dateKey: item.dateKey,
      subject: dominantSubject,
      subjectLabel: dominantSubject === "MATH" ? "الرياضيات" : dominantSubject === "PHYSICS" ? "الفيزياء" : "حصة عامة",
      level: item.level,
      count: item.count,
      micSeconds: item.micSeconds,
      lastParticipatedAt: item.lastParticipatedAt,
      formattedDate: formatAttendanceDate(item.lastParticipatedAt),
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

    const [attendances, participations, questionImages] = await Promise.all([
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
      prisma.liveQuestionImage.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          level: true,
          fileName: true,
          createdAt: true,
        },
      }),
    ]);

    const attendanceSummary = summarizeAttendances(attendances);
    const participationSummary = summarizeParticipations(participations);
    const exercisesSummary = {
      totalCount: questionImages.length,
      items: questionImages,
    };

    return res.status(200).json({
      status: "success",
      data: attendances,
      attendanceSummary,
      participationSummary,
      exercisesSummary,
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
