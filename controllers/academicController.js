const prisma = require("../lib/prisma");
const { logAudit } = require("../utils/audit");
const { getSmsStatus, sendSms } = require("../services/smsService");
const { getTelegramStatus, notifyTelegram, sendTelegramToParent } = require("../services/telegramService");
const { getMessengerStatus, getMessengerSettings, sendMessengerToParent } = require("../services/messengerService");
const {
  PAYMENT_FILTERS,
  SUBJECT_FILTERS,
  buildStudentAudienceWhere,
  normalizeFilter,
} = require("../utils/studentAudienceFilters");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEVELS = new Set(["السنة الأولى", "السنة الثانية", "السنة الثالثة", "السنة الرابعة", "طالب جامعي"]);
const SUBJECTS = new Set(["MATH", "PHYSICS", "FREE", "PAID", "GENERAL"]);
const ANNOUNCEMENT_CHANNELS = new Set(["BROWSER", "SMS", "BOTH", "MESSENGER", "BROWSER_MESSENGER", "SMS_MESSENGER", "ALL"]);

// The teacher dashboard sends short labels, while Student.level stores the
// full middle-school labels. Assignments use the full label canonically and
// remain compatible with older records stored with short labels.
const ASSIGNMENT_LEVEL_MAP = Object.freeze({
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
const ASSIGNMENT_CANONICAL_LEVELS = new Set(Object.values(ASSIGNMENT_LEVEL_MAP));
const ASSIGNMENT_LEGACY_LEVELS = Object.freeze({
  "السنة الأولى متوسط": "السنة الأولى",
  "السنة الثانية متوسط": "السنة الثانية",
  "السنة الثالثة متوسط": "السنة الثالثة",
  "السنة الرابعة متوسط": "السنة الرابعة",
});

function normalizeAssignmentLevel(value) {
  const normalized = text(value, 100);
  return ASSIGNMENT_LEVEL_MAP[normalized] || normalized;
}

function assignmentLevelCandidates(value) {
  const canonical = normalizeAssignmentLevel(value);
  const legacy = ASSIGNMENT_LEGACY_LEVELS[canonical];
  return legacy ? [canonical, legacy] : [canonical];
}

function displayLevelLabel(value) {
  return normalizeAssignmentLevel(value) || "المستوى الدراسي";
}

function text(value, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asBinaryBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  return Buffer.from(value);
}

function isTeacher(req) {
  return req.user?.role === "teacher";
}

async function getStudentForUser(req, studentId) {
  if (!UUID.test(studentId)) return null;
  return prisma.student.findFirst({
    where: isTeacher(req) ? { id: studentId } : { id: studentId, parentPhone: req.user?.phone },
  });
}

function requireTeacher(req, res) {
  if (!isTeacher(req)) {
    res.status(403).json({ error: "هذه العملية متاحة للأستاذ فقط." });
    return false;
  }
  return true;
}

async function listGrades(req, res) {
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student) return res.status(403).json({ error: "لا تملك صلاحية هذه البيانات." });
  const grades = await prisma.grade.findMany({ where: { studentId: student.id }, orderBy: { gradedAt: "desc" }, take: 200 });
  return res.json({ status: "success", data: grades });
}

async function createGrade(req, res) {
  if (!requireTeacher(req, res)) return;
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student) return res.status(404).json({ error: "التلميذ غير موجود." });
  const subject = text(req.body?.subject, 40).toUpperCase();
  const score = Number(req.body?.score);
  const maxScore = Number(req.body?.maxScore ?? 100);
  const title = text(req.body?.title, 160);
  if (!SUBJECTS.has(subject) || !title || !Number.isFinite(score) || !Number.isFinite(maxScore) || score < 0 || maxScore <= 0 || score > maxScore) {
    return res.status(400).json({ error: "بيانات العلامة غير صحيحة." });
  }
  const grade = await prisma.grade.create({ data: { studentId: student.id, subject, category: text(req.body?.category, 80) || "تقييم", title, score, maxScore, note: text(req.body?.note, 2000) || null } });
  void logAudit(req, { action: "GRADE_CREATED", entityType: "Grade", entityId: grade.id, studentId: student.id, metadata: { score, maxScore, subject } });
  return res.status(201).json({ status: "success", data: grade });
}

async function createAssignment(req, res) {
  if (!requireTeacher(req, res)) return;
  const requestedLevel = text(req.body?.level, 100);
  const level = normalizeAssignmentLevel(requestedLevel);
  const subject = text(req.body?.subject, 40).toUpperCase();
  const subjectTitle = subject === "PHYSICS" ? "الفيزياء" : subject === "MATH" ? "الرياضيات" : "واجب";
  const title = text(req.body?.title, 160) || `واجب ${subjectTitle}`;
  const description = text(req.body?.description, 10000);
  const instructionImage = Array.isArray(req.files?.instructionImage) ? req.files.instructionImage[0] : null;
  const file = Array.isArray(req.files?.file) ? req.files.file[0] : req.file;
  if (!ASSIGNMENT_CANONICAL_LEVELS.has(level) || !SUBJECTS.has(subject) || (!description && !instructionImage)) return res.status(400).json({ error: "اختر المادة ثم اكتب التعليمات أو ألصق صورة الواجب." });

  const assignment = await prisma.assignment.create({
    data: {
      level,
      subject,
      title,
      description: description || "صورة الواجب مرفقة داخل التعليمات.",
      dueAt: null,
      attachmentUrl: text(req.body?.attachmentUrl, 1000) || null,
      attachmentData: file ? file.buffer : null,
      attachmentMimeType: file ? file.mimetype : null,
      attachmentOriginalName: file ? file.originalname : null,
      instructionImageData: instructionImage ? instructionImage.buffer : null,
      instructionImageMimeType: instructionImage ? instructionImage.mimetype : null,
      instructionImageOriginalName: instructionImage ? instructionImage.originalname : null,
    }
  });
  void logAudit(req, { action: "ASSIGNMENT_CREATED", entityType: "Assignment", entityId: assignment.id, metadata: { requestedLevel, level, subject } });
const { attachmentData, instructionImageData, ...safeAssignment } = assignment;
return res.status(201).json({ status: "success", data: safeAssignment });}

async function listTeacherAssignments(req, res) {
  if (!requireTeacher(req, res)) return;
  const level = normalizeAssignmentLevel(req.query?.level);
  if (!ASSIGNMENT_CANONICAL_LEVELS.has(level)) return res.status(400).json({ error: "المستوى الدراسي غير صالح." });

  const assignments = await prisma.assignment.findMany({
    where: { level: { in: assignmentLevelCandidates(level) } },
    select: {
      id: true,
      title: true,
      description: true,
      level: true,
      subject: true,
      dueAt: true,
      attachmentUrl: true,
      attachmentMimeType: true,
      attachmentOriginalName: true,
      instructionImageMimeType: true,
      instructionImageOriginalName: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { submissions: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json({ status: "success", data: assignments });
}

async function listAssignments(req, res) {
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student) return res.status(403).json({ error: "لا تملك صلاحية هذه البيانات." });
  const assignments = await prisma.assignment.findMany({
    where: { level: { in: assignmentLevelCandidates(student.level) }, ...(req.query.subject ? { subject: text(req.query.subject, 40).toUpperCase() } : {}) },
    select: {
      id: true,
      title: true,
      description: true,
      level: true,
      subject: true,
      dueAt: true,
      attachmentUrl: true,
      attachmentMimeType: true,
      attachmentOriginalName: true,
      instructionImageMimeType: true,
      instructionImageOriginalName: true,
      createdAt: true,
      updatedAt: true,
      submissions: {
        where: { studentId: student.id },
        take: 1,
        select: { id: true, status: true, receivedAt: true, grade: true, teacherNote: true, submittedAt: true, gradedAt: true, attachmentUrl: true, attachmentMimeType: true, attachmentOriginalName: true, answerText: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json({ status: "success", data: assignments });
}

async function submitAssignment(req, res) {
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student || isTeacher(req)) return res.status(403).json({ error: "هذه العملية متاحة للطالب أو الولي صاحب الحساب." });
  const assignment = await prisma.assignment.findUnique({ where: { id: text(req.params.assignmentId, 80) } });
  if (!assignment || !assignmentLevelCandidates(student.level).includes(assignment.level)) return res.status(404).json({ error: "الواجب غير موجود." });

  const file = req.file;
  const submission = await prisma.assignmentSubmission.upsert({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
    create: {
      assignmentId: assignment.id,
      studentId: student.id,
      answerText: text(req.body?.answerText, 10000) || null,
      attachmentUrl: text(req.body?.attachmentUrl, 1000) || null,
      attachmentData: file ? file.buffer : null,
      attachmentMimeType: file ? file.mimetype : null,
      attachmentOriginalName: file ? file.originalname : null,
    },
    update: {
      answerText: text(req.body?.answerText, 10000) || null,
      attachmentUrl: text(req.body?.attachmentUrl, 1000) || null,
      attachmentData: file ? file.buffer : null,
      attachmentMimeType: file ? file.mimetype : null,
      attachmentOriginalName: file ? file.originalname : null,
      status: "SUBMITTED",
      submittedAt: new Date()
    }
  });
  void notifyTelegram(req, {
    title: "إرسال واجب جديد",
    body: `أرسل ولي أو تلميذ حلاً جديدًا.\nالتلميذ: ${student.studentName}\nالمستوى: ${student.level}\nالواجب: ${assignment.title}\nالملف: ${file?.originalname || "لا يوجد ملف مرفق"}`,
  });
  return res.status(201).json({ status: "success", data: submission });
}

async function listSubmissions(req, res) {
  if (!requireTeacher(req, res)) return;
  const assignmentId = text(req.params.assignmentId, 80);
  const submissions = await prisma.assignmentSubmission.findMany({
    where: { assignmentId },
    select: {
      id: true,
      studentId: true,
      answerText: true,
      attachmentUrl: true,
      attachmentMimeType: true,
      attachmentOriginalName: true,
      status: true,
      receivedAt: true,
      grade: true,
      teacherNote: true,
      submittedAt: true,
      gradedAt: true,
      student: { select: { id: true, studentName: true, level: true } },
    },
    orderBy: { submittedAt: "desc" },
  });
  return res.json({ status: "success", data: submissions });
}

async function receiveSubmission(req, res) {
  if (!requireTeacher(req, res)) return;
  const submission = await prisma.assignmentSubmission.update({
    where: { id: text(req.params.submissionId, 80) },
    data: { status: "RECEIVED", receivedAt: new Date() },
    select: { id: true, status: true, receivedAt: true, studentId: true },
  });
  void logAudit(req, { action: "ASSIGNMENT_SUBMISSION_RECEIVED", entityType: "AssignmentSubmission", entityId: submission.id, studentId: submission.studentId });
  return res.json({ status: "success", message: "تم تأكيد استلام الحل وتسجيله للتلميذ.", data: submission });
}

async function gradeSubmission(req, res) {
  if (!requireTeacher(req, res)) return;
  const score = Number(req.body?.grade);
  if (!Number.isFinite(score) || score < 0 || score > 100) return res.status(400).json({ error: "العلامة يجب أن تكون بين 0 و100." });
  const submission = await prisma.assignmentSubmission.update({ where: { id: text(req.params.submissionId, 80) }, data: { grade: score, teacherNote: text(req.body?.teacherNote, 3000) || null, status: "GRADED", gradedAt: new Date() } });
  void logAudit(req, { action: "ASSIGNMENT_GRADED", entityType: "AssignmentSubmission", entityId: submission.id, studentId: submission.studentId, metadata: { grade: score } });
  return res.json({ status: "success", data: submission });
}

async function createQuestion(req, res) {
  if (!requireTeacher(req, res)) return;
  const level = text(req.body?.level, 100);
  const subject = text(req.body?.subject, 40).toUpperCase();
  const prompt = text(req.body?.prompt, 10000);
  if (!LEVELS.has(level) || !SUBJECTS.has(subject) || !prompt) return res.status(400).json({ error: "بيانات السؤال غير مكتملة." });
  const question = await prisma.question.create({ data: { level, subject, prompt, explanation: text(req.body?.explanation, 5000) || null, difficulty: text(req.body?.difficulty, 40).toUpperCase() || "MEDIUM", questionType: text(req.body?.questionType, 40).toUpperCase() || "MCQ", optionsJson: req.body?.options ? JSON.stringify(req.body.options) : null, answerJson: req.body?.answer ? JSON.stringify(req.body.answer) : null } });
  return res.status(201).json({ status: "success", data: question });
}

async function createAssessment(req, res) {
  if (!requireTeacher(req, res)) return;
  const level = text(req.body?.level, 100);
  const subject = text(req.body?.subject, 40).toUpperCase();
  const title = text(req.body?.title, 160);
  const questionIds = Array.isArray(req.body?.questionIds) ? req.body.questionIds.filter((id) => UUID.test(id)).slice(0, 100) : [];
  if (!LEVELS.has(level) || !SUBJECTS.has(subject) || !title || !questionIds.length) return res.status(400).json({ error: "أدخل بيانات الاختبار وسؤالًا واحدًا على الأقل." });
  const assessment = await prisma.assessment.create({ data: { level, subject, title, description: text(req.body?.description, 5000) || null, timeLimitSeconds: Number.isFinite(Number(req.body?.timeLimitSeconds)) ? Number(req.body.timeLimitSeconds) : null, published: Boolean(req.body?.published), questions: { create: questionIds.map((questionId, position) => ({ questionId, position, points: 1 })) } }, include: { questions: { include: { question: true }, orderBy: { position: "asc" } } } });
  void logAudit(req, { action: "ASSESSMENT_CREATED", entityType: "Assessment", entityId: assessment.id, metadata: { level, subject } });
  return res.status(201).json({ status: "success", data: assessment });
}

async function listAssessments(req, res) {
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student) return res.status(403).json({ error: "لا تملك صلاحية هذه البيانات." });
  const assessments = await prisma.assessment.findMany({ where: { level: student.level, published: true, ...(req.query.subject ? { subject: text(req.query.subject, 40).toUpperCase() } : {}) }, include: { questions: { include: { question: true }, orderBy: { position: "asc" } }, attempts: { where: { studentId: student.id }, take: 1 } }, orderBy: { createdAt: "desc" } });
  return res.json({ status: "success", data: assessments });
}

async function submitAssessment(req, res) {
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student || isTeacher(req)) return res.status(403).json({ error: "لا تملك صلاحية إرسال الاختبار." });
  const assessment = await prisma.assessment.findFirst({ where: { id: text(req.params.assessmentId, 80), level: student.level, published: true }, include: { questions: { include: { question: true } } } });
  if (!assessment) return res.status(404).json({ error: "الاختبار غير موجود." });
  const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
  let total = 0;
  let score = 0;
  for (const item of assessment.questions) {
    total += item.points;
    const expected = item.question.answerJson;
    if (expected && JSON.stringify(answers[item.questionId]) === expected) score += item.points;
  }
  const attempt = await prisma.assessmentAttempt.upsert({ where: { assessmentId_studentId: { assessmentId: assessment.id, studentId: student.id } }, create: { assessmentId: assessment.id, studentId: student.id, answersJson: JSON.stringify(answers), score: total ? (score / total) * 100 : 0, submittedAt: new Date(), completed: true }, update: { answersJson: JSON.stringify(answers), score: total ? (score / total) * 100 : 0, submittedAt: new Date(), completed: true } });
  return res.json({ status: "success", data: { attempt, correct: score, total } });
}

async function getProgress(req, res) {
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student) return res.status(403).json({ error: "لا تملك صلاحية هذه البيانات." });
  const [progress, grades, assignments, badges, path, participations] = await Promise.all([
    prisma.lessonProgress.findMany({ where: { studentId: student.id }, include: { lessonVideo: true }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.grade.findMany({ where: { studentId: student.id }, orderBy: { gradedAt: "desc" }, take: 100 }),
    prisma.assignmentSubmission.findMany({ where: { studentId: student.id }, include: { assignment: true }, orderBy: { submittedAt: "desc" }, take: 100 }),
    prisma.studentBadge.findMany({ where: { studentId: student.id }, orderBy: { awardedAt: "desc" } }),
    prisma.learningPathItem.findMany({ where: { studentId: student.id }, orderBy: { position: "asc" } }),
    prisma.classParticipation.findMany({ where: { studentId: student.id }, orderBy: { lastParticipatedAt: "desc" }, take: 100 }),
  ]);
  const participationTotal = participations.reduce((sum, item) => sum + item.count, 0);
  return res.json({ status: "success", data: { progress, grades, assignments, badges, path, participations, participationTotal } });
}

async function updateLessonProgress(req, res) {
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student || isTeacher(req)) return res.status(403).json({ error: "لا تملك صلاحية تحديث التقدم." });
  const lessonVideoId = text(req.params.lessonVideoId, 80);
  const watchedSeconds = Math.max(0, Math.floor(Number(req.body?.watchedSeconds) || 0));
  const durationSeconds = Number.isFinite(Number(req.body?.durationSeconds)) ? Math.max(1, Math.floor(Number(req.body.durationSeconds))) : null;
  const completed = Boolean(req.body?.completed) || (durationSeconds ? watchedSeconds / durationSeconds >= 0.9 : false);
  const progress = await prisma.lessonProgress.upsert({ where: { studentId_lessonVideoId: { studentId: student.id, lessonVideoId } }, create: { studentId: student.id, lessonVideoId, watchedSeconds, durationSeconds, completed }, update: { watchedSeconds: { set: watchedSeconds }, durationSeconds, completed, lastWatchedAt: new Date() } });
  return res.json({ status: "success", data: progress });
}

const ANNOUNCEMENT_PAYMENT_FILTERS = new Set(["ALL", "FREE", "UNPAID", "PAID", "PROMISED"]);
const ANNOUNCEMENT_SUBJECT_FILTERS = new Set(["ALL", "MATH", "PHYSICS", "BOTH"]);
const ANNOUNCEMENT_DELIVERY_MODES = new Set(["IMMEDIATE", "SCHEDULED"]);
const ANNOUNCEMENT_TARGET_MODES = new Set(["ALL_LEVEL", "SELECTED"]);
let scheduledAnnouncementLock = false;
let socketNotificationSender = null;

function setSocketNotificationSender(sender) {
  socketNotificationSender = typeof sender === "function" ? sender : null;
}

function parseAnnouncementStudentIds(value) {
  const source = Array.isArray(value) ? value : (() => {
    try { return JSON.parse(String(value || "[]")); } catch { return []; }
  })();
  return [...new Set(source.map((id) => text(id, 80)).filter(Boolean))].slice(0, 500);
}

function announcementWhere(payload) {
  const level = normalizeAssignmentLevel(payload.targetLevel);
  const where = buildStudentAudienceWhere({
    level,
    paymentFilter: payload.paymentFilter,
    subjectFilter: payload.subjectFilter,
    includeActiveOnly: true,
  });
  if (String(payload.targetMode || "ALL_LEVEL").toUpperCase() === "SELECTED") {
    const targetStudentIds = parseAnnouncementStudentIds(payload.targetStudentIds);
    where.id = { in: targetStudentIds };
  }
  return where;
}

function announcementSummary(campaign, deliveryStats = {}) {
  const deliveryChannel = campaign.deliveryChannel || "BROWSER";
  const browserSentCount = Number(deliveryStats.sentCount ?? (deliveryChannel === "SMS" ? 0 : campaign.recipientCount) ?? 0) || 0;
  const smsSentCount = Number(campaign.smsSentCount || 0) || 0;
  const smsFailedCount = Number(campaign.smsFailedCount || 0) || 0;
  const messengerSentCount = Number(campaign.messengerSentCount || 0) || 0;
  const messengerFailedCount = Number(campaign.messengerFailedCount || 0) || 0;
  const messengerSkippedCount = Number(campaign.messengerSkippedCount || 0) || 0;
  const sentCount = deliveryChannel === "SMS"
    ? smsSentCount
    : deliveryChannel === "MESSENGER"
      ? messengerSentCount
      : browserSentCount;
  const readCount = Number(deliveryStats.readCount ?? 0) || 0;
  return {
    ...campaign,
    deliveryChannel,
    targetLevel: displayLevelLabel(campaign.targetLevel),
    scheduledAt: campaign.scheduledAt?.toISOString?.() || null,
    sentAt: campaign.sentAt?.toISOString?.() || null,
    sentCount,
    readCount,
    unreadCount: Math.max(0, sentCount - readCount),
    smsSentCount,
    smsFailedCount,
    messengerSentCount,
    messengerFailedCount,
    messengerSkippedCount,
  };
}

async function deliverTeacherAnnouncement(campaign, options = {}) {
  const sendSocketNotification = options.sendSocketNotification || socketNotificationSender;
  const deliveryChannel = campaign.deliveryChannel || "BROWSER";
  const sendBrowser = ["BROWSER", "BOTH", "BROWSER_MESSENGER", "ALL"].includes(deliveryChannel);
  const sendSmsChannel = ["SMS", "BOTH", "SMS_MESSENGER", "ALL"].includes(deliveryChannel);
  const sendMessengerChannel = ["MESSENGER", "BROWSER_MESSENGER", "SMS_MESSENGER", "ALL"].includes(deliveryChannel);
  if (sendSmsChannel && !getSmsStatus().configured) {
    const error = new Error("SMS_NOT_CONFIGURED");
    error.code = "SMS_NOT_CONFIGURED";
    throw error;
  }
  if (sendMessengerChannel && !getMessengerStatus().configured) {
    const error = new Error("MESSENGER_NOT_CONFIGURED");
    error.code = "MESSENGER_NOT_CONFIGURED";
    throw error;
  }

  const students = await prisma.student.findMany({
    where: announcementWhere(campaign),
    select: { id: true, parentPhone: true },
  });
  const recipients = new Map();
  for (const student of students) {
    if (!recipients.has(student.parentPhone)) recipients.set(student.parentPhone, student);
  }
  const sendPushToRecipient = require("../utils/push").sendPushToRecipient;
  let sentCount = 0;
  let smsSentCount = 0;
  let smsFailedCount = 0;
  let messengerSentCount = 0;
  let messengerFailedCount = 0;
  let messengerSkippedCount = 0;
  const smsErrors = [];
  const messengerErrors = [];

  for (const [parentPhone, student] of recipients) {
    const dedupeKey = `TEACHER_ANNOUNCEMENT:${campaign.id}:${parentPhone}`;
    let notificationId = null;
    if (sendBrowser) {
      try {
        const notification = await prisma.notification.create({
          data: {
            studentId: student.id,
            recipientRole: "parent",
            recipientId: parentPhone,
            type: "TEACHER_ANNOUNCEMENT",
            title: campaign.title,
            body: campaign.body,
            link: campaign.link || "./parent-dashboard.html",
            dedupeKey,
          },
          select: { id: true },
        });
        notificationId = notification.id;
        sentCount += 1;
      } catch (notificationError) {
        if (notificationError?.code !== "P2002") throw notificationError;
        const existing = await prisma.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
        notificationId = existing?.id || null;
      }
      try {
        sendSocketNotification?.({
          role: "parent",
          recipientId: parentPhone,
          title: campaign.title,
          body: campaign.body,
          link: campaign.link || "./parent-dashboard.html",
          tag: `teacher-announcement-${campaign.id}`,
          data: { type: "TEACHER_ANNOUNCEMENT", campaignId: campaign.id, notificationId },
          notificationId,
        });
      } catch (socketError) {
        console.warn("Optional browser notification failed:", parentPhone, socketError.message);
      }
      try {
        await sendPushToRecipient("parent", parentPhone, {
          title: campaign.title,
          body: campaign.body,
          link: campaign.link || "./parent-dashboard.html",
          notificationId,
        });
      } catch (pushError) {
        console.warn("Optional announcement push failed:", parentPhone, pushError.message);
      }
    }
    try {
      await sendTelegramToParent(parentPhone, {
        title: campaign.title,
        body: campaign.body,
      });
    } catch (telegramError) {
      console.warn("Optional announcement Telegram failed:", parentPhone, telegramError.message);
    }
    if (sendSmsChannel) {
      try {
        const result = await sendSms({ to: parentPhone, title: campaign.title, body: campaign.body });
        if (result.sent) smsSentCount += 1;
        else {
          smsFailedCount += 1;
          smsErrors.push(`${parentPhone}: ${result.reason || "SMS_SEND_SKIPPED"}`);
        }
      } catch (smsError) {
        smsFailedCount += 1;
        smsErrors.push(`${parentPhone}: ${smsError.message || "SMS_SEND_FAILED"}`);
        console.warn("SMS announcement delivery failed:", parentPhone, smsError.message);
      }
    }
    if (sendMessengerChannel) {
      try {
        const result = await sendMessengerToParent(parentPhone, {
          text: `${campaign.title}\n\n${campaign.body}`.trim(),
        });
        if (result.sent) messengerSentCount += 1;
        else {
          messengerSkippedCount += 1;
          messengerErrors.push(`${parentPhone}: ${result.reason || "MESSENGER_SEND_SKIPPED"}`);
        }
      } catch (messengerError) {
        messengerFailedCount += 1;
        messengerErrors.push(`${parentPhone}: ${messengerError.message || "MESSENGER_SEND_FAILED"}`);
        console.warn("Messenger announcement delivery failed:", parentPhone, messengerError.message);
      }
    }
  }

  const allSmsFailed = sendSmsChannel && smsFailedCount > 0 && smsSentCount === 0;
  const allMessengerFailed = sendMessengerChannel && messengerFailedCount > 0 && messengerSentCount === 0 && messengerSkippedCount === 0;
  const updated = await prisma.notificationCampaign.update({
    where: { id: campaign.id },
    data: {
      status: allSmsFailed || allMessengerFailed ? "FAILED" : "SENT",
      recipientCount: recipients.size,
      smsSentCount,
      smsFailedCount,
      messengerSentCount,
      messengerFailedCount,
      messengerSkippedCount,
      sentAt: new Date(),
      lastError: [...smsErrors, ...messengerErrors].length
        ? [...smsErrors, ...messengerErrors].slice(0, 10).join(" | ").slice(0, 2000)
        : null,
    },
  });
  return { campaign: updated, recipientCount: recipients.size, sentCount, smsSentCount, smsFailedCount, messengerSentCount, messengerFailedCount, messengerSkippedCount };
}

async function getTeacherTelegramStatus(req, res) {
  if (!requireTeacher(req, res)) return;
  return res.json({ status: "success", data: getTelegramStatus() });
}

async function getTeacherSmsStatus(req, res) {
  if (!requireTeacher(req, res)) return;
  return res.json({ status: "success", data: getSmsStatus() });
}

async function getTeacherMessengerStatus(req, res) {
  if (!requireTeacher(req, res)) return;
  return res.json({
    status: "success",
    data: {
      ...getMessengerStatus(),
      standardWindowHours: 24,
      policyMessage: "يُرسل Messenger إلى الحسابات المرتبطة التي تفاعلت مع الصفحة خلال نافذة Meta المسموح بها.",
    },
  });
}

async function getTeacherMessengerStudents(req, res) {
  if (!requireTeacher(req, res)) return;
  const level = normalizeAssignmentLevel(text(req.query?.level, 100));
  const paymentFilter = normalizeFilter(req.query?.paymentFilter, PAYMENT_FILTERS, "");
  const subjectFilter = normalizeFilter(req.query?.subjectFilter, SUBJECT_FILTERS, "");
  if (!ASSIGNMENT_CANONICAL_LEVELS.has(level) || !paymentFilter || !subjectFilter) {
    return res.status(400).json({ error: "المستوى أو فلاتر الاشتراك والمادة غير صحيحة." });
  }

  const where = buildStudentAudienceWhere({ level, paymentFilter, subjectFilter });
  const students = await prisma.student.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: {
      id: true,
      studentName: true,
      level: true,
      paymentStatus: true,
      paymentStage: true,
      mathEnrollment: true,
      physicsEnrollment: true,
      accountActive: true,
      parentPhone: false,
    },
  });
  return res.json({
    status: "success",
    data: students,
    meta: { totalRecords: students.length, capped: students.length === 2000 },
    filters: { level, paymentFilter, subjectFilter },
  });
}

async function listTeacherAnnouncements(req, res) {
  if (!requireTeacher(req, res)) return;
  const campaigns = await prisma.notificationCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const campaignIds = new Set(campaigns.map((campaign) => campaign.id));
  const notificationRows = campaignIds.size
    ? await prisma.notification.findMany({
        where: { dedupeKey: { startsWith: "TEACHER_ANNOUNCEMENT:" } },
        select: { dedupeKey: true, isRead: true },
      })
    : [];
  const statsByCampaign = new Map();
  for (const row of notificationRows) {
    const match = /^TEACHER_ANNOUNCEMENT:([^:]+):/.exec(row.dedupeKey || "");
    if (!match || !campaignIds.has(match[1])) continue;
    const stats = statsByCampaign.get(match[1]) || { sentCount: 0, readCount: 0 };
    stats.sentCount += 1;
    if (row.isRead) stats.readCount += 1;
    statsByCampaign.set(match[1], stats);
  }
  const data = campaigns.map((campaign) => announcementSummary(campaign, statsByCampaign.get(campaign.id)));
  const summary = data.reduce((totals, campaign) => ({
    sentCount: totals.sentCount + campaign.sentCount,
    readCount: totals.readCount + campaign.readCount,
  }), { sentCount: 0, readCount: 0 });
  return res.json({
    status: "success",
    data,
    summary: { ...summary, unreadCount: Math.max(0, summary.sentCount - summary.readCount) },
  });
}

async function createTeacherAnnouncement(req, res) {
  if (!requireTeacher(req, res)) return;
  const targetLevel = normalizeAssignmentLevel(text(req.body?.targetLevel || req.body?.level, 100));
  const recipientType = text(req.body?.recipientType, 20).toUpperCase() || "PARENTS";
  const paymentFilter = text(req.body?.paymentFilter, 20).toUpperCase() || "ALL";
  const subjectFilter = text(req.body?.subjectFilter, 20).toUpperCase() || "ALL";
  const targetMode = text(req.body?.targetMode, 20).toUpperCase() || "ALL_LEVEL";
  const targetStudentIds = parseAnnouncementStudentIds(req.body?.targetStudentIds);
  const deliveryMode = text(req.body?.deliveryMode, 20).toUpperCase() || "IMMEDIATE";
  const deliveryChannel = text(req.body?.deliveryChannel, 20).toUpperCase() || "BROWSER";
  const title = text(req.body?.title, 160);
  const body = text(req.body?.body, 10000);
  const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
  if (!ASSIGNMENT_CANONICAL_LEVELS.has(targetLevel) || recipientType !== "PARENTS" || !ANNOUNCEMENT_PAYMENT_FILTERS.has(paymentFilter) || !ANNOUNCEMENT_SUBJECT_FILTERS.has(subjectFilter) || !ANNOUNCEMENT_TARGET_MODES.has(targetMode) || !ANNOUNCEMENT_DELIVERY_MODES.has(deliveryMode) || !ANNOUNCEMENT_CHANNELS.has(deliveryChannel) || !title || !body) {
    return res.status(400).json({ error: "بيانات التنبيه غير صحيحة." });
  }
  if (targetMode === "SELECTED" && !targetStudentIds.length) {
    return res.status(400).json({ error: "اختر تلميذًا واحدًا على الأقل لإرسال التنبيه." });
  }
  if (deliveryMode === "SCHEDULED" && (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date())) {
    return res.status(400).json({ error: "اختر موعدًا مستقبليًا صالحًا للتنبيه." });
  }
  if (["SMS", "BOTH", "SMS_MESSENGER", "ALL"].includes(deliveryChannel) && !getSmsStatus().configured) {
    return res.status(503).json({ error: "خدمة SMS غير مفعّلة حاليًا — أضف بيانات مزود الرسائل إلى متغيرات الخادم أولًا." });
  }
  if (["MESSENGER", "BROWSER_MESSENGER", "SMS_MESSENGER", "ALL"].includes(deliveryChannel) && !getMessengerStatus().configured) {
    return res.status(503).json({ error: "Facebook Messenger غير مهيّأ حاليًا — تحقق من إعدادات Meta وRailway أولًا." });
  }
  if (targetMode === "SELECTED") {
    const eligibleSelected = await prisma.student.count({ where: announcementWhere({ targetLevel, paymentFilter, subjectFilter, targetMode, targetStudentIds }) });
    if (!eligibleSelected) return res.status(400).json({ error: "لا يوجد تلميذ مؤهل ضمن الاختيار الحالي." });
  }
  const campaign = await prisma.notificationCampaign.create({
    data: { targetLevel, recipientType, paymentFilter, subjectFilter, targetMode, targetStudentIds: targetMode === "SELECTED" ? JSON.stringify(targetStudentIds) : null, title, body, link: "./parent-dashboard.html", deliveryMode, deliveryChannel, scheduledAt: deliveryMode === "SCHEDULED" ? scheduledAt : null },
  });
  if (deliveryMode === "IMMEDIATE") {
    const delivered = await deliverTeacherAnnouncement(campaign);
    void logAudit(req, { action: "TEACHER_ANNOUNCEMENT_SENT", entityType: "NotificationCampaign", entityId: campaign.id, metadata: { targetLevel, paymentFilter, subjectFilter, deliveryChannel, recipientCount: delivered.recipientCount, smsSentCount: delivered.smsSentCount || 0, smsFailedCount: delivered.smsFailedCount || 0 } });
    return res.status(201).json({ status: "success", mode: "IMMEDIATE", recipientCount: delivered.recipientCount, data: announcementSummary(delivered.campaign) });
  }
  void logAudit(req, { action: "TEACHER_ANNOUNCEMENT_SCHEDULED", entityType: "NotificationCampaign", entityId: campaign.id, metadata: { targetLevel, paymentFilter, subjectFilter, deliveryChannel, scheduledAt } });
  return res.status(201).json({ status: "success", mode: "SCHEDULED", recipientCount: 0, data: announcementSummary(campaign) });
}

async function createTeacherMessengerCampaign(req, res) {
  if (!getMessengerStatus().configured) {
    return res.status(503).json({ error: "Facebook Messenger غير مهيّأ حاليًا — تحقق من إعدادات Meta وRailway أولًا." });
  }
  const settings = await getMessengerSettings();
  if (!settings.enabled) {
    return res.status(409).json({ error: "إرسال Messenger متوقف يدويًا من إعدادات الأمان." });
  }
  req.body = {
    ...(req.body || {}),
    deliveryChannel: "MESSENGER",
    deliveryMode: "IMMEDIATE",
  };
  return createTeacherAnnouncement(req, res);
}

async function cancelTeacherAnnouncement(req, res) {
  if (!requireTeacher(req, res)) return;
  const id = text(req.params.id, 80);
  const result = await prisma.notificationCampaign.updateMany({ where: { id, status: "PENDING", deliveryMode: "SCHEDULED" }, data: { status: "CANCELLED" } });
  if (!result.count) return res.status(404).json({ error: "التنبيه غير موجود أو تم تنفيذه بالفعل." });
  void logAudit(req, { action: "TEACHER_ANNOUNCEMENT_CANCELLED", entityType: "NotificationCampaign", entityId: id });
  return res.json({ status: "success", message: "تم إلغاء التنبيه المبرمج." });
}

async function processScheduledTeacherAnnouncements(now = new Date()) {
  if (scheduledAnnouncementLock) return { processed: 0, locked: true };
  scheduledAnnouncementLock = true;
  let processed = 0;
  try {
    const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
    const campaigns = await prisma.notificationCampaign.findMany({ where: { OR: [{ status: "PENDING", deliveryMode: "SCHEDULED", scheduledAt: { lte: now } }, { status: "PROCESSING", updatedAt: { lt: staleBefore } }] }, orderBy: { scheduledAt: "asc" }, take: 50 });
    for (const candidate of campaigns) {
      const claimed = await prisma.notificationCampaign.updateMany({ where: { id: candidate.id, OR: [{ status: "PENDING" }, { status: "PROCESSING", updatedAt: { lt: staleBefore } }] }, data: { status: "PROCESSING" } });
      if (!claimed.count) continue;
      const campaign = await prisma.notificationCampaign.findUnique({ where: { id: candidate.id } });
      try {
        await deliverTeacherAnnouncement(campaign);
        processed += 1;
      } catch (error) {
        await prisma.notificationCampaign.update({ where: { id: candidate.id }, data: { status: "FAILED", lastError: text(error?.message, 2000) } }).catch(() => {});
        console.error("Scheduled teacher announcement failed:", candidate.id, error);
      }
    }
    return { processed, locked: false };
  } finally {
    scheduledAnnouncementLock = false;
  }
}

async function listNotifications(req, res) {
  const recipientId = isTeacher(req) ? "teacher" : req.user.phone;
  const notifications = await prisma.notification.findMany({ where: { recipientRole: isTeacher(req) ? "teacher" : "parent", recipientId }, orderBy: { createdAt: "desc" }, take: 100 });
  return res.json({ status: "success", data: notifications });
}

async function markNotificationRead(req, res) {
  const recipientId = isTeacher(req) ? "teacher" : req.user.phone;
  const notification = await prisma.notification.updateMany({ where: { id: text(req.params.id, 80), recipientRole: isTeacher(req) ? "teacher" : "parent", recipientId }, data: { isRead: true, readAt: new Date() } });
  return res.json({ status: "success", updated: notification.count });
}

async function listPaymentHistory(req, res) {
  const student = await getStudentForUser(req, text(req.params.studentId, 80));
  if (!student) return res.status(403).json({ error: "لا تملك صلاحية هذا السجل." });
  const events = await prisma.paymentEvent.findMany({ where: { studentId: student.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return res.json({ status: "success", data: events });
}

async function listAuditLogs(req, res) {
  if (!requireTeacher(req, res)) return;
  const logs = await prisma.auditLog.findMany({ where: req.query.studentId && UUID.test(String(req.query.studentId)) ? { studentId: String(req.query.studentId) } : {}, orderBy: { createdAt: "desc" }, take: 200 });
  return res.json({ status: "success", data: logs });
}

async function bulkUpdateStudents(req, res) {
  if (!requireTeacher(req, res)) return;
  const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds.filter((id) => UUID.test(id)).slice(0, 200) : [];
  if (!studentIds.length) return res.status(400).json({ error: "اختر طالبًا واحدًا على الأقل." });
  const allowed = ["PAID", "PROMISED", "UNPAID"];
  const paymentStage = req.body?.paymentStage === undefined ? undefined : text(req.body.paymentStage, 20).toUpperCase();
  const liveAccessEnabled = req.body?.liveAccessEnabled === undefined ? undefined : Boolean(req.body.liveAccessEnabled);
  if (paymentStage !== undefined && !allowed.includes(paymentStage)) return res.status(400).json({ error: "حالة الدفع غير صالحة." });
  const data = { ...(paymentStage !== undefined ? { paymentStage, paymentStatus: paymentStage === "PAID", paymentReceiptPending: paymentStage === "PAID" ? false : undefined } : {}), ...(liveAccessEnabled !== undefined ? { liveAccessEnabled } : {}) };
  const students = await prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, level: true } });
  await prisma.$transaction(students.map((student) => prisma.student.update({ where: { id: student.id }, data })));
  await Promise.all(students.map((student) => logAudit(req, { action: "BULK_STUDENT_UPDATE", entityType: "Student", entityId: student.id, studentId: student.id, metadata: data })));
  return res.json({ status: "success", updated: students.length });
}

async function getTeacherAnalytics(req, res) {
  if (!requireTeacher(req, res)) return;
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const [students, attendance, grades, submissions, events] = await Promise.all([
    prisma.student.count(),
    prisma.attendance.count({ where: { joinedAt: { gte: from, lte: to } } }),
    prisma.grade.findMany({ where: { gradedAt: { gte: from, lte: to } }, select: { score: true, maxScore: true, subject: true } }),
    prisma.assignmentSubmission.count({ where: { submittedAt: { gte: from, lte: to } } }),
    prisma.analyticsEvent.groupBy({ by: ["eventType"], where: { createdAt: { gte: from, lte: to } }, _count: { _all: true } }),
  ]);
  const average = grades.length ? grades.reduce((sum, item) => sum + (item.score / item.maxScore) * 100, 0) / grades.length : null;
  return res.json({ status: "success", data: { from, to, students, attendance, submissions, gradeCount: grades.length, averageGrade: average, events } });
}

async function getAssignmentInstructionImage(req, res) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: text(req.params.assignmentId, 80) },
    select: {
      instructionImageData: true,
      instructionImageMimeType: true,
      instructionImageOriginalName: true,
    },
  });
  if (!assignment || !assignment.instructionImageData) return res.status(404).json({ error: "صورة التعليمات غير موجودة." });
  const fileBuffer = asBinaryBuffer(assignment.instructionImageData);
  res.setHeader("Content-Type", assignment.instructionImageMimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(fileBuffer.length));
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(assignment.instructionImageOriginalName || "homework-image")}"`);
  return res.end(fileBuffer);
}

async function getAssignmentFile(req, res) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: text(req.params.assignmentId, 80) },
    select: {
      attachmentData: true,
      attachmentMimeType: true,
      attachmentOriginalName: true,
    },
  });
  if (!assignment || !assignment.attachmentData) return res.status(404).json({ error: "الملف غير موجود." });
  const fileBuffer = asBinaryBuffer(assignment.attachmentData);
  res.setHeader("Content-Type", assignment.attachmentMimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(fileBuffer.length));
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(assignment.attachmentOriginalName || "attachment")}"`);
  return res.end(fileBuffer);
}

async function getSubmissionFile(req, res) {
  const submission = await prisma.assignmentSubmission.findUnique({ where: { id: text(req.params.submissionId, 80) }, include: { assignment: true } });
  if (!submission || !submission.attachmentData) return res.status(404).json({ error: "الملف غير موجود." });
  const isOwner = req.user?.studentId === submission.studentId;
  if (!isTeacher(req) && !isOwner) return res.status(403).json({ error: "لا تملك صلاحية عرض هذا الملف." });
  const fileBuffer = asBinaryBuffer(submission.attachmentData);
  res.setHeader("Content-Type", submission.attachmentMimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(fileBuffer.length));
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(submission.attachmentOriginalName || "attachment")}"`);
  return res.end(fileBuffer);
}

async function deleteAssignment(req, res) {
  if (!requireTeacher(req, res)) return;
  const id = text(req.params.assignmentId, 80);
  await prisma.assignment.delete({ where: { id } });
  void logAudit(req, { action: "ASSIGNMENT_DELETED", entityType: "Assignment", entityId: id });
  return res.json({ status: "success", message: "تم حذف الواجب بنجاح." });
}

module.exports = {
  listGrades,
  createGrade,
  createAssignment,
  listTeacherAssignments,
  listAssignments,
  submitAssignment,
  listSubmissions,
  gradeSubmission,
  createQuestion,
  createAssessment,
  listAssessments,
  submitAssessment,
  getProgress,
  updateLessonProgress,
  listNotifications,
  markNotificationRead,
  listTeacherAnnouncements,
  getTeacherTelegramStatus,
  getTeacherSmsStatus,
  getTeacherMessengerStatus,
  getTeacherMessengerStudents,
  createTeacherAnnouncement,
  createTeacherMessengerCampaign,
  cancelTeacherAnnouncement,
  getTeacherAnalytics,
  listPaymentHistory,
  listAuditLogs,
  bulkUpdateStudents,
  getAssignmentFile,
  getAssignmentInstructionImage,
  getSubmissionFile,
  receiveSubmission,
  deleteAssignment,
  processScheduledTeacherAnnouncements,
  setSocketNotificationSender,
};
