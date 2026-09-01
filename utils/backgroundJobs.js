const prisma = require("../lib/prisma");
const { sendEmail } = require("../services/emailService");

let lastWeeklyReportKey = "";

async function sendOptionalPush(role, recipientId, payload) {
  try {
    const { sendPushToRecipient } = require("./push");
    await sendPushToRecipient(role, recipientId, payload);
  } catch {
    // Push is optional; a missing VAPID configuration must not stop jobs.
  }
}

function weekKey(date = new Date()) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - first) / 86400000) + first.getUTCDay() + 1) / 7);
  return `${date.getUTCFullYear()}-${week}`;
}

async function sendClassReminders(now = new Date()) {
  const reminderWindows = [
    { key: "120m", fromMinutes: 115, toMinutes: 125, label: "ساعتين تقريبًا" },
    { key: "60m", fromMinutes: 55, toMinutes: 65, label: "ساعة تقريبًا" },
  ];

  for (const reminderWindow of reminderWindows) {
    const from = new Date(now.getTime() + reminderWindow.fromMinutes * 60 * 1000);
    const to = new Date(now.getTime() + reminderWindow.toMinutes * 60 * 1000);
    const classes = await prisma.scheduledClass.findMany({ where: { scheduledAt: { gte: from, lte: to } }, take: 100 });
    for (const scheduledClass of classes) {
      const students = await prisma.student.findMany({ where: { level: scheduledClass.level }, select: { id: true, parentPhone: true, studentName: true } });
      if (!students.length) continue;
      const classTime = new Date(scheduledClass.scheduledAt).toLocaleString("ar-DZ", { dateStyle: "medium", timeStyle: "short" });
      const reminderBody = `تبدأ حصة ${scheduledClass.subject} خلال ${reminderWindow.label}.`;
      await Promise.allSettled(students.map(async (student) => {
        const dedupeKey = reminderWindow.key === "60m"
          ? `CLASS_REMINDER:${scheduledClass.id}:${student.id}`
          : `CLASS_REMINDER:${scheduledClass.id}:${student.id}:${reminderWindow.key}`;
        let notificationCreated = false;
        try {
          await prisma.notification.create({
            data: {
              studentId: student.id,
              recipientRole: "parent",
              recipientId: student.parentPhone,
              type: "CLASS_REMINDER",
              title: "تذكير بالحصة",
              body: reminderBody,
              link: "./parent-dashboard.html",
              dedupeKey,
            },
          });
          notificationCreated = true;
        } catch (error) {
          if (error?.code !== "P2002") throw error;
        }

        if (notificationCreated) {
          const credential = await prisma.parentCredential.findUnique({
            where: { parentPhone: student.parentPhone },
            select: { email: true, emailVerifiedAt: true },
          }).catch(() => null);
          if (credential?.email && credential.emailVerifiedAt) {
            const baseUrl = String(process.env.APP_BASE_URL || process.env.PUBLIC_SITE_URL || "https://dr.africacold.fr").replace(/\/$/, "");
            await sendEmail({
              to: credential.email,
              subject: `تذكير بحصة ${scheduledClass.subject}`,
              text: `التلميذ: ${student.studentName || "التلميذ"}\nالحصة: ${scheduledClass.subject}\nالوقت: ${classTime}\nالتذكير: ${reminderBody}\nالدخول إلى المنصة: ${baseUrl}/parent-dashboard.html`,
              html: `<p><strong>التلميذ:</strong> ${student.studentName || "التلميذ"}</p><p><strong>الحصة:</strong> ${scheduledClass.subject}</p><p><strong>الوقت:</strong> ${classTime}</p><p>${reminderBody}</p><p><a href="${baseUrl}/parent-dashboard.html">الدخول إلى المنصة</a></p>`,
            }).catch((error) => {
              console.warn("Class reminder email failed:", error.message);
            });
          }
        }

        await sendOptionalPush("parent", student.parentPhone, {
          title: "تذكير بالحصة",
          body: reminderBody,
          link: "./parent-dashboard.html",
        });
      }));
    }
  }
}

async function sendWeeklyReports(now = new Date()) {
  const key = weekKey(now);
  if (key === lastWeeklyReportKey || now.getUTCDay() !== 0 || now.getUTCHours() !== 18) return;
  lastWeeklyReportKey = key;
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const students = await prisma.student.findMany({ select: { id: true, parentPhone: true, studentName: true } });
  for (const student of students) {
    const [attendance, grades, submissions, completed] = await Promise.all([
      prisma.attendance.count({ where: { studentId: student.id, joinedAt: { gte: since } } }),
      prisma.grade.findMany({ where: { studentId: student.id, gradedAt: { gte: since } }, select: { score: true, maxScore: true } }),
      prisma.assignmentSubmission.count({ where: { studentId: student.id, submittedAt: { gte: since } } }),
      prisma.lessonProgress.count({ where: { studentId: student.id, completed: true, updatedAt: { gte: since } } }),
    ]);
    const average = grades.length ? Math.round(grades.reduce((sum, item) => sum + (item.score / item.maxScore) * 100, 0) / grades.length) : null;
    await prisma.notification.create({
      data: {
        studentId: student.id,
        recipientRole: "parent",
        recipientId: student.parentPhone,
        type: "WEEKLY_REPORT",
        title: `تقرير أسبوعي: ${student.studentName}`,
        body: `الحضور: ${attendance}، الواجبات: ${submissions}، الدروس المكتملة: ${completed}، متوسط العلامات: ${average == null ? "لا توجد علامات جديدة" : `${average}%`}.`,
        link: "./academic-center.html",
        dedupeKey: `WEEKLY_REPORT:${student.id}:${key}`,
      },
    }).catch((error) => { if (error?.code !== "P2002") throw error; });
  }
}

async function cleanExpiredSessions() {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

async function processTeacherAnnouncements() {
  try {
    const { processScheduledTeacherAnnouncements } = require("../controllers/academicController");
    await processScheduledTeacherAnnouncements();
  } catch (error) {
    console.error("Teacher announcements background job failed:", error.message);
  }
}

async function reconcileSofizPayPayments() {
  try {
    const { reconcilePendingSofizPayPayments } = require("../controllers/paymentController");
    await reconcilePendingSofizPayPayments();
  } catch (error) {
    console.error("SofizPay background reconciliation failed:", error.message);
  }
}

function startBackgroundJobs() {
  const run = () => Promise.allSettled([
    sendClassReminders(),
    sendWeeklyReports(),
    cleanExpiredSessions(),
    reconcileSofizPayPayments(),
    processTeacherAnnouncements(),
  ]).catch(() => {});
  void run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { sendClassReminders, sendWeeklyReports, cleanExpiredSessions, reconcileSofizPayPayments, processTeacherAnnouncements, startBackgroundJobs };
