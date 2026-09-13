const express = require("express");
const multer = require("multer");
const { verifyToken, isTeacher } = require("../middleware/authMiddleware");
const {
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
  getTeacherSmsStatus,
  getTeacherMessengerStatus,
  getTeacherTelegramStatus,
  createTeacherAnnouncement,
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
  getTeacherLiveAlertAudience,
  sendTeacherLiveAlert,
} = require("../controllers/academicController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
});

router.use(verifyToken);

router.get("/students/:studentId/grades", listGrades);
router.post("/students/:studentId/grades", createGrade);
router.get("/students/:studentId/assignments", listAssignments);
router.post("/students/:studentId/assignments/:assignmentId/submissions", upload.single("file"), submitAssignment);
router.get("/students/:studentId/progress", getProgress);
router.get("/students/:studentId/payments", listPaymentHistory);
router.put("/students/:studentId/progress/lessons/:lessonVideoId", updateLessonProgress);
router.get("/students/:studentId/assessments", listAssessments);
router.post("/students/:studentId/assessments/:assessmentId/submit", submitAssessment);

router.get("/assignments", isTeacher, listTeacherAssignments);
router.post("/assignments", isTeacher, upload.fields([{ name: "instructionImage", maxCount: 1 }, { name: "file", maxCount: 1 }]), createAssignment);
router.get("/assignments/:assignmentId/file", getAssignmentFile);
router.get("/assignments/:assignmentId/instruction-image", getAssignmentInstructionImage);
router.delete("/assignments/:assignmentId", isTeacher, deleteAssignment);
router.get("/assignments/:assignmentId/submissions", listSubmissions);
router.get("/submissions/:submissionId/file", getSubmissionFile);
router.put("/submissions/:submissionId/receive", receiveSubmission);
router.put("/submissions/:submissionId/grade", gradeSubmission);
router.post("/questions", createQuestion);
router.post("/assessments", createAssessment);

router.get("/notifications", listNotifications);
router.put("/notifications/:id/read", markNotificationRead);
router.get("/teacher-announcements", isTeacher, listTeacherAnnouncements);
router.get("/teacher-announcements/sms-status", isTeacher, getTeacherSmsStatus);
router.get("/teacher-announcements/messenger-status", isTeacher, getTeacherMessengerStatus);
router.get("/teacher-announcements/telegram-status", isTeacher, getTeacherTelegramStatus);
router.post("/teacher-announcements", isTeacher, createTeacherAnnouncement);
router.post("/teacher-announcements/:id/cancel", isTeacher, cancelTeacherAnnouncement);
router.get("/teacher-live-alert/audience", isTeacher, getTeacherLiveAlertAudience);
router.post("/teacher-live-alert", isTeacher, sendTeacherLiveAlert);
router.get("/analytics", isTeacher, getTeacherAnalytics);
router.get("/audit-logs", listAuditLogs);
router.put("/students/bulk", bulkUpdateStudents);

module.exports = router;
