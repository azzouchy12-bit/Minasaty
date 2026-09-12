const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const routes = fs.readFileSync(path.join(root, "routes/academicRoutes.js"), "utf8");
const studentController = fs.readFileSync(path.join(root, "controllers/studentController.js"), "utf8");
const parentDashboard = fs.readFileSync(path.join(root, "public/js/parent-dashboard.js"), "utf8");
const { buildStudentAudienceWhere } = require(path.join(root, "utils/studentAudienceFilters.js"));
const authMiddleware = fs.readFileSync(path.join(root, "middleware/authMiddleware.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const parentGate = fs.readFileSync(path.join(root, "public/js/parent-messenger-required.js"), "utf8");
const pageGate = fs.readFileSync(path.join(root, "public/js/parent-messenger-page-gate.js"), "utf8");
const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

test("selected academic models exist", () => {
  for (const model of ["Session", "AuditLog", "Notification", "NotificationCampaign", "PaymentEvent", "Grade", "Assignment", "Question", "Assessment", "LessonProgress", "ClassParticipation"]) {
    assert.match(schema, new RegExp(`model ${model}\\b`));
  }
});

test("academic API exposes the selected core workflows", () => {
  for (const endpoint of ["/grades", "/assignments", "/progress", "/assessments", "/notifications", "/teacher-announcements", "/analytics", "/audit-logs", "/students/bulk"]) {
    assert.match(routes, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("pending subscription type belongs to each student", () => {
  const studentBlock = schema.match(/model Student \{([\s\S]*?)\n\}/)?.[1] || "";
  const parentCredentialBlock = schema.match(/model ParentCredential \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(studentBlock, /pendingSubscriptionType\s+String\?/);
  assert.doesNotMatch(parentCredentialBlock, /pendingSubscriptionType/);
});

test("free secondary accounts start without a selected subject", () => {
  assert.match(studentBlockFromSchema(schema), /mathEnrollment\s+Boolean\s+@default\(false\)/);
  assert.match(studentBlockFromSchema(schema), /physicsEnrollment\s+Boolean\s+@default\(false\)/);
  assert.match(studentController, /mathEnrollment: isUniversityStudent/);
  assert.match(studentController, /physicsEnrollment: isUniversityStudent/);
  assert.match(parentDashboard, /لم تختَر المواد بعد/);
});

function studentBlockFromSchema(schemaText) {
  return schemaText.match(/model Student \{([\s\S]*?)\n\}/)?.[1] || "";
}

test("production server does not log registration bodies", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.equal(server.includes("Register request body:"), false);
});

test("teacher classroom control requires an authenticated teacher session", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  assert.match(server, /async function requireTeacherSocketSession\s*\(/);
  const startHandler = server.match(/socket\.on\("teacher_start_room"[\s\S]*?socket\.on\("student_join_room"/)?.[0] || "";
  const endHandler = server.match(/socket\.on\("teacher_end_class"[\s\S]*?socket\.on\("disconnect"/)?.[0] || "";
  assert.match(startHandler, /requireTeacherSocketSession\(socket, "teacher_start_room"/);
  assert.match(endHandler, /requireTeacherSocketSession\(socket, "teacher_end_class"/);
  assert.match(teacherLive, /auth:\s*\{\s*token:\s*teacherSocketToken\s*\}/);
});

test("teacher roster loads every paginated student page", () => {
  const teacherDashboard = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  assert.match(teacherDashboard, /\?page=\$\{page\}&limit=100/);
  assert.match(teacherDashboard, /firstPage\?\.meta\?\.totalPages/);
  assert.match(teacherDashboard, /Array\.from\(\{ length: totalPages - 1 \}/);
  assert.match(teacherDashboard, /remainingPages\.flatMap/);
});

test("teacher live streaming targets adaptive quality and 1080p60 recording", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  assert.match(teacherLive, /frameRate:\s*\{\s*ideal:\s*60,\s*max:\s*60\s*\}/);
  assert.match(teacherLive, /QUESTION_IMAGE_MAX_ZOOM\s*=\s*4/);
  assert.match(teacherLive, /getAdaptiveVideoQualityProfile\s*\(/);
  assert.match(teacherLive, /scaleResolutionDownBy:\s*2\.5/);
  assert.match(teacherLive, /maxBitrate:\s*6_000_000/);
  assert.match(teacherLive, /LOCAL_RECORDING_WIDTH\s*=\s*1920/);
  assert.match(teacherLive, /LOCAL_RECORDING_HEIGHT\s*=\s*1080/);
  assert.match(teacherLive, /build1080pRecordingVideoTrack\s*\(/);
  assert.match(teacherLive, /LOCAL_RECORDING_FRAME_RATE\s*=\s*60/);
  assert.match(teacherLive, /canvas\.captureStream\(LOCAL_RECORDING_FRAME_RATE\)/);
  assert.match(teacherLive, /videoBitsPerSecond:\s*LOCAL_RECORDING_VIDEO_BITRATE/);
  assert.match(teacherLive, /recordingWidth: localRecordingIs1080p/);
  assert.match(teacherLive, /recordingHeight: localRecordingIs1080p/);
  assert.match(teacherLive, /LOCAL_RECORDING_VIDEO_BITRATE\s*=\s*16_000_000/);
  assert.match(teacherLive, /maxFramerate:\s*60/);
  assert.match(teacherLive, /async function syncTeacherVideoTrackToAllPeers\(\)/);
  assert.match(teacherLive, /await sender\.replaceTrack\(track\)/);
  assert.match(teacherLive, /revision/);
  assert.match(fs.readFileSync(path.join(root, "public/teacher-live.html"), "utf8"), /teacher-live-v2\.js\?v=screen-share-sync-1/);
  const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  assert.match(studentLive, /lastScreenShareRevision/);
  assert.match(studentLive, /revision <= lastScreenShareRevision/);
  const studentLiveHtml = fs.readFileSync(path.join(root, "public/student-live.html"), "utf8");
  assert.match(studentLiveHtml, /parent-messenger-page-gate\.js\?v=disabled-1/);
  assert.match(studentLiveHtml, /student-live\.js\?v=/);
  assert.match(studentLiveHtml, /id="screen-share-notice"/);
  assert.match(studentLiveHtml, /بدأ الأستاذ مشاركة الشاشة/);
  assert.match(studentLiveHtml, /مشاهدة الحصة الآن/);
  assert.doesNotMatch(studentLiveHtml, /متابعة العرض/);
  assert.match(studentLive, /showScreenShareNotice\(revision\)/);
  assert.match(studentLive, /screenShareWatchButton\?\.addEventListener/);
  assert.match(studentLive, /function watchCurrentScreenShare\(\) \{[\s\S]*?refreshAudioVideo\(\);/);
  assert.match(studentLive, /socket\.on\("student_live_access_updated", handleLiveAccessActivation\)/);
  assert.match(studentLive, /socket\.on\("student_payment_receipt_updated", handleLiveAccessActivation\)/);
  assert.match(studentLive, /beginStreamRecovery\("تم تفعيل دخولك إلى الحصة/);
});

test("teacher question image modal supports bounded wheel zoom", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  const teacherHtml = fs.readFileSync(path.join(root, "public/teacher-live.html"), "utf8");
  assert.match(teacherLive, /QUESTION_IMAGE_MAX_ZOOM\s*=\s*4/);
  assert.match(teacherLive, /handleQuestionImageWheel/);
  assert.match(teacherLive, /startQuestionImageDrag/);
  assert.match(teacherLive, /moveQuestionImageDrag/);
  assert.match(teacherLive, /addEventListener\("pointerdown", startQuestionImageDrag\)/);
  assert.match(teacherLive, /addEventListener\("pointermove", moveQuestionImageDrag\)/);
  assert.match(teacherLive, /addEventListener\("wheel", handleQuestionImageWheel, \{ passive: false \}\)/);
  assert.match(teacherLive, /resetQuestionImageZoom\(\)/);
  assert.match(teacherHtml, /id="question-image-modal-viewport"/);
  assert.match(teacherHtml, /question-image-zoom-label/);
});

test("teacher class registry selects term before month and subject", () => {
  const teacherHtml = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  const registry = fs.readFileSync(path.join(root, "public/js/class-registry-teacher.js"), "utf8");
  const filters = teacherHtml.slice(teacherHtml.indexOf("class-registry-filters"), teacherHtml.indexOf("class-registry-list"));
  const termIndex = filters.indexOf("id=\"class-registry-term\"");
  const monthIndex = filters.indexOf("id=\"class-registry-month\"");
  const subjectIndex = filters.indexOf("id=\"class-registry-subject\"");
  assert.ok(termIndex >= 0 && termIndex < monthIndex && monthIndex < subjectIndex);
  assert.match(filters, /id="class-registry-month" disabled/);
  assert.match(filters, /id="class-registry-subject" disabled/);
  assert.match(registry, /const TERMS = Object\.freeze\(/);
  assert.match(registry, /selectedTerm = term\.value/);
  assert.match(registry, /selectedMonth = month\.value/);
  assert.match(registry, /!selectedTerm/);
  assert.match(registry, /!selectedMonth/);
});

test("teacher dashboard keeps level selection above an internal scrollable section nav", () => {
  const teacherHtml = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  const appCss = fs.readFileSync(path.join(root, "public/css/app.css"), "utf8");
  const levelIndex = teacherHtml.indexOf("id=\"teacher-level-strip\"");
  const frameIndex = teacherHtml.indexOf("id=\"teacher-main-frame\"");
  const messengerIndex = teacherHtml.indexOf("id=\"facebook-messenger-panel\"");
  const lessonModalIndex = teacherHtml.indexOf('<div class="lesson-video-modal"');
  const frameClosingIndex = teacherHtml.indexOf('</div>\n</div>\n<div class="lesson-video-modal"');
  assert.ok(levelIndex >= 0 && levelIndex < frameIndex);
  assert.ok(messengerIndex > frameIndex && messengerIndex < lessonModalIndex && messengerIndex < frameClosingIndex);
  assert.match(teacherHtml, /class="teacher-main-frame" id="teacher-main-frame"/);
  assert.match(teacherHtml, /class="teacher-tab-content"/);
  assert.doesNotMatch(teacherHtml, /class="teacher-sidebar"/);
  assert.doesNotMatch(teacherHtml, /class="teacher-profile-card"/);
  for (const tab of ["students", "notifications", "schedule", "registry", "assignments", "lessons", "quiz", "electronic-payments", "manual-payments", "referral-withdrawals", "forgot-pin-requests", "facebook-messenger"]) {
    assert.match(teacherHtml, new RegExp(`data-dashboard-tab="${tab}"`));
  }
  assert.match(appCss, /teacher-main-frame[\s\S]*grid-template-columns/);
  assert.match(appCss, /teacher-main-frame[\s\S]*direction: rtl/);
  assert.match(appCss, /teacher-tabs-nav[\s\S]*overflow-y: auto/);
  assert.match(appCss, /teacher-dashboard-shell \{\s*margin-right: 0;/);
});

test("telegram admin alerts are dormant without credentials and cover key parent events", () => {
  const service = fs.readFileSync(path.join(root, "services/telegramService.js"), "utf8");
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const routes = fs.readFileSync(path.join(root, "routes/telegramRoutes.js"), "utf8");
  const accountHtml = fs.readFileSync(path.join(root, "public/account-center.html"), "utf8");
  const accountJs = fs.readFileSync(path.join(root, "public/js/telegram-link.js"), "utf8");
  const accountCss = fs.readFileSync(path.join(root, "public/css/academic-center.css"), "utf8");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const academicController = fs.readFileSync(path.join(root, "controllers/academicController.js"), "utf8");
  const studentController = fs.readFileSync(path.join(root, "controllers/studentController.js"), "utf8");
  const messageController = fs.readFileSync(path.join(root, "controllers/messageController.js"), "utf8");
  const paymentController = fs.readFileSync(path.join(root, "controllers/paymentController.js"), "utf8");
  const referralController = fs.readFileSync(path.join(root, "controllers/referralController.js"), "utf8");
  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(service, /TELEGRAM_BOT_TOKEN/);
  assert.match(service, /TELEGRAM_ADMIN_CHAT_ID/);
  assert.match(service, /TELEGRAM_NOT_CONFIGURED/);
  assert.match(service, /sendTelegramToParent/);
  assert.match(service, /handleTelegramUpdate/);
  assert.match(service, /configureTelegramWebhook/);
  assert.match(schema, /telegramChatId\s+String\?\s+@unique/);
  assert.match(schema, /telegramLinkTokenHash/);
  assert.match(routes, /\/link\/start/);
  assert.match(routes, /x-telegram-bot-api-secret-token/);
  assert.match(server, /app\.use\("\/api\/telegram", telegramRoutes\)/);
  assert.doesNotMatch(accountHtml, /id="telegram-card"/);
  assert.doesNotMatch(accountHtml, /telegram-link\.js/);
  assert.match(accountJs, /\/api\/telegram\/link\/start/);
  assert.match(accountJs, /\/api\/telegram\/link/);
  assert.match(accountCss, /academic-status-badge/);
  assert.match(academicController, /getTeacherTelegramStatus/);
  assert.match(academicController, /notifyTelegram\(req/);
  assert.match(studentController, /notifyTelegram\(req/);
  assert.match(messageController, /notifyTelegram\(req/);
  assert.match(paymentController, /sendTelegramNotification\(/);
  assert.match(referralController, /notifyTelegram\(req/);
  assert.match(envExample, /TELEGRAM_BOT_TOKEN=/);
  assert.match(envExample, /TELEGRAM_ADMIN_CHAT_ID=/);
});

test("teacher notifications include a dormant SMS channel safely", () => {
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const controller = fs.readFileSync(path.join(root, "controllers/academicController.js"), "utf8");
  const routes = fs.readFileSync(path.join(root, "routes/academicRoutes.js"), "utf8");
  const service = fs.readFileSync(path.join(root, "services/smsService.js"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  assert.match(schema, /deliveryChannel\s+String\s+@default\("BROWSER"\)/);
  assert.match(schema, /smsSentCount\s+Int\s+@default\(0\)/);
  assert.match(controller, /ANNOUNCEMENT_CHANNELS/);
  assert.match(controller, /SMS_NOT_CONFIGURED/);
  assert.match(controller, /sendSms\(/);
  assert.match(routes, /teacher-announcements\/sms-status/);
  assert.match(service, /function getSmsStatus\s*\(/);
  assert.match(service, /SMS_API_KEY/);
  assert.match(dashboard, /notificationDeliveryChannel\s*\(/);
  assert.match(dashboard, /teacher-announcements\/sms-status/);
  assert.match(dashboard, /deliveryChannel: notificationDeliveryChannel\(\)/);
  assert.match(html, /name="notification-channel"[^>]+value="SMS"/);
  assert.match(html, /id="teacher-notification-channel-status"/);
});

test("teacher Messenger is isolated in a policy-safe control panel", () => {
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const controller = fs.readFileSync(path.join(root, "controllers/academicController.js"), "utf8");
  const routes = fs.readFileSync(path.join(root, "routes/academicRoutes.js"), "utf8");
  const messengerRoutes = fs.readFileSync(path.join(root, "routes/messengerRoutes.js"), "utf8");
  const service = fs.readFileSync(path.join(root, "services/messengerService.js"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  assert.match(schema, /messengerSentCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /messengerFailedCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /messengerSkippedCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /model MessengerSettings\b/);
  assert.match(schema, /model MessengerQuota\b/);
  assert.match(controller, /MESSENGER_NOT_CONFIGURED/);
  assert.match(controller, /sendMessengerToParent\(/);
  assert.match(controller, /getTeacherMessengerStatus/);
  assert.match(routes, /teacher-announcements\/messenger-status/);
  assert.match(service, /MESSENGER_STANDARD_WINDOW_MS/);
  assert.match(service, /MESSENGER_WINDOW_EXPIRED/);
  assert.match(service, /rateLimited/);
  assert.match(service, /maxRetries/);
  assert.match(messengerRoutes, /\/teacher\/settings/);
  assert.match(messengerRoutes, /\/teacher\/campaigns/);
  assert.match(dashboard, /teacher-announcements\/messenger-status/);
  assert.match(html, /data-dashboard-tab="facebook-messenger"/);
  assert.match(html, /data-dashboard-panel="facebook-messenger"/);
  assert.match(html, /teacher-messenger-daily-hard/);
  assert.doesNotMatch(html, /name="notification-channel"[^>]+value="MESSENGER"/);
});

test("parent Messenger banner is persistent until linking and does not block classes", () => {
  const html = fs.readFileSync(path.join(root, "public/parent-dashboard.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "public/js/parent-messenger-required.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "public/css/parent-messenger-required.css"), "utf8");
  assert.match(html, /id="parent-messenger-required-banner"/);
  assert.match(html, /id="parent-messenger-required-start"/);
  assert.match(js, /\/api\/messenger\/status/);
  assert.match(js, /\/api\/messenger\/link\/start/);
  assert.match(js, /banner\.hidden = true/);
  assert.match(css, /parent-messenger-required-banner/);
});

test("teacher live chat supports pasted image messages safely", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  const teacherHtml = fs.readFileSync(path.join(root, "public/teacher-live.html"), "utf8");
  const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  assert.match(server, /normalizeTeacherChatImageData\s*\(/);
  assert.ok(server.includes("image\\/(?:jpeg|png|webp)"));
  assert.match(server, /teacher_message_received/);
  assert.match(server, /student_message_received[\s\S]*studentId: socket\.data\.studentId[\s\S]*socketId: socket\.id/);
  assert.match(teacherLive, /addEventListener\("paste"/);
  assert.match(teacherLive, /chatImagePreview/);
  assert.match(teacherLive, /imageData/);
  assert.match(teacherHtml, /id="chat-image-preview"/);
  assert.match(teacherHtml, /id="chat-image-remove-btn"/);
  assert.match(studentLive, /const imageData = data\?\.imageData/);
  assert.match(studentLive, /imageUrl: imageData/);
  assert.match(studentLive, /loadStudentQuestionImage/);
  assert.match(server, /classroomChatHistoryByLevel/);
  assert.match(server, /MAX_CLASSROOM_CHAT_HISTORY/);
  assert.match(server, /emitClassroomChatHistory\(socket, classroomLevel\)/);
  assert.match(server, /emitClassroomChatHistory\(socket, level\)/);
  assert.match(teacherLive, /restoreTeacherChatHistory/);
  assert.match(studentLive, /restoreStudentChatHistory/);
  assert.match(studentLive, /if \(!rejoin\) \{\s*clearStudentChat\(\);\s*\}/);
  assert.match(teacherLive, /classroom_chat_history/);
  assert.match(studentLive, /classroom_chat_history/);
  assert.match(teacherLive, /openStudentChatMicMenu/);
  assert.match(teacherLive, /student-chat-mic-menu/);
  assert.match(teacherLive, /فتح الـ microphone/);
  assert.match(teacherLive, /غلق الـ microphone/);
  assert.match(teacherLive, /reorderOpenMicrophoneAttendees/);
  assert.match(teacherLive, /classList\.contains\("is-mic-open"\)/);
  assert.match(teacherLive, /secondOpen - firstOpen/);
  assert.match(teacherLive, /classList\.toggle\("is-mic-open", Boolean\(enabled\)\)/);
  assert.match(teacherHtml, /id="chat-box"/);
});

test("teacher can edit student contact data through a protected UI action", () => {
  const routes = fs.readFileSync(path.join(root, "routes/studentRoutes.js"), "utf8");
  const controller = fs.readFileSync(path.join(root, "controllers/studentController.js"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  assert.match(routes, /router\.put\("\/:id\/contact", verifyToken, isTeacher, updateStudentContact\)/);
  assert.match(controller, /async function updateStudentContact\s*\(/);
  assert.match(controller, /tx\.student\.updateMany\(/);
  assert.match(dashboard, /تعديل الاسم ورقم الهاتف/);
  assert.match(dashboard, /\/api\/students\/\$\{encodeURIComponent\(studentId\)\}\/contact/);
  assert.match(html, /id="student-contact-modal"/);
});

test("Messenger roster accepts level aliases and refreshes after roster changes", () => {
  const controller = fs.readFileSync(path.join(root, "controllers/studentController.js"), "utf8");
  const messengerJs = fs.readFileSync(path.join(root, "public/js/teacher-messenger.js"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  assert.match(controller, /ACADEMIC_LEVEL_ALIASES/);
  assert.match(controller, /level: \{ in: academicLevelCandidates\(level\) \}/);
  assert.match(controller, /student_roster_changed/);
  assert.match(controller, /notifyTeacherRosterChanged\(req, student\.level, "created"\)/);
  assert.match(controller, /notifyTeacherRosterChanged\(req, result\.student\.level, "deleted"\)/);
  assert.match(controller, /notifyTeacherRosterChanged\(req, \[currentStudent\.level, updatedStudent\.level\], "contact-updated"\)/);
  assert.match(controller, /notifyTeacherRosterChanged\(req, student\.level, "status-updated"\)/);
  assert.match(messengerJs, /messenger\/teacher\/students\?\$\{query\.toString\(\)\}/);
  assert.match(messengerJs, /student_roster_changed/);
  assert.match(messengerJs, /visibilitychange/);
  assert.match(messengerJs, /setInterval\(\(\) => \{/);
  assert.match(messengerJs, /teacher-messenger-refresh-students/);
  assert.match(dashboard, /id="teacher-messenger-refresh-students"/);
});

test("Messenger audience filters distinguish payment stages and enrolled subjects", () => {
  const free = buildStudentAudienceWhere({ level: "السنة الأولى متوسط", paymentFilter: "FREE", subjectFilter: "ALL" });
  assert.deepEqual(free.level.in, ["السنة الأولى متوسط", "السنة الأولى"]);
  assert.equal(free.paymentStage, "UNPAID");
  assert.equal(free.mathEnrollment, false);
  assert.equal(free.physicsEnrollment, false);

  const unpaidMath = buildStudentAudienceWhere({ level: "السنة الأولى", paymentFilter: "UNPAID", subjectFilter: "MATH" });
  assert.equal(unpaidMath.paymentStage, "UNPAID");
  assert.deepEqual(unpaidMath.OR, [{ mathEnrollment: true }, { physicsEnrollment: true }]);
  assert.equal(unpaidMath.mathEnrollment, true);

  const paidBoth = buildStudentAudienceWhere({ level: "طالب جامعي", paymentFilter: "PAID", subjectFilter: "BOTH" });
  assert.equal(paidBoth.paymentStage, "PAID");
  assert.equal(paidBoth.mathEnrollment, true);
  assert.equal(paidBoth.physicsEnrollment, true);

  const promisedPhysics = buildStudentAudienceWhere({ level: "السنة الثانية", paymentFilter: "PROMISED", subjectFilter: "PHYSICS" });
  assert.equal(promisedPhysics.paymentStage, "PROMISED");
  assert.equal(promisedPhysics.physicsEnrollment, true);
});

test("parent Messenger enforcement is retained but disabled by default", () => {
  const parentDashboardHtml = fs.readFileSync(path.join(root, "public/parent-dashboard.html"), "utf8");
  assert.match(authMiddleware, /ENFORCE_PARENT_MESSENGER_LINK/);
  assert.match(authMiddleware, /!ENFORCE_PARENT_MESSENGER_LINK/);
  assert.match(authMiddleware, /PARENT_MESSENGER_LINK_REQUIRED/);
  assert.match(authMiddleware, /isParentMessengerGateExempt/);
  assert.match(server, /ENFORCE_PARENT_MESSENGER_LINK/);
  assert.match(server, /if \(!ENFORCE_PARENT_MESSENGER_LINK\) return true/);
  assert.match(parentDashboard, /auth: \{ token: getParentToken\(\) \|\| "" \}/);
  assert.match(parentGate, /parent-messenger-blocked/);
  assert.match(pageGate, /PARENT_MESSENGER_ENFORCEMENT_ENABLED = false/);
  assert.match(fs.readFileSync(path.join(root, "public/student-live.html"), "utf8"), /parent-messenger-page-gate\.js\?v=disabled-1/);
  assert.match(fs.readFileSync(path.join(root, "public/student-live-times-level.html"), "utf8"), /parent-messenger-page-gate\.js\?v=disabled-1/);
  assert.match(studentLive, /parentSessionToken/);
  assert.match(studentLive, /auth: parentSessionToken \? \{ token: parentSessionToken \} : \{\}/);
  assert.match(parentDashboardHtml, /id="parent-messenger-required-banner"/);
  assert.doesNotMatch(parentDashboardHtml, /parent-messenger-required\.js/);
});

test("Messenger linking and webhooks are dormant without credentials and follow secure patterns", () => {
  const service = fs.readFileSync(path.join(root, "services/messengerService.js"), "utf8");
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const routes = fs.readFileSync(path.join(root, "routes/messengerRoutes.js"), "utf8");
  const accountHtml = fs.readFileSync(path.join(root, "public/account-center.html"), "utf8");
  const accountJs = fs.readFileSync(path.join(root, "public/js/messenger-link.js"), "utf8");
  const parentMessengerRequired = fs.readFileSync(path.join(root, "public/js/parent-messenger-required.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(service, /META_PAGE_ID/);
  assert.match(service, /META_APP_SECRET/);
  assert.match(service, /MESSENGER_NOT_CONFIGURED/);
  assert.match(service, /verifyWebhookSignature/);
  assert.match(service, /verifyWebhookToken/);
  assert.match(service, /handleMessengerWebhook/);
  assert.match(service, /normalizeFallbackCode/);
  assert.match(service, /markLinkFromFallbackCode/);
  assert.match(service, /fallbackCodeHash/);
  assert.match(service, /event\.message\?\.text/);
  assert.match(service, /const url = buildMessengerLink\(rawState\)/);
  assert.match(service, /url,\s*\/\/ Keep the legacy key/);
  assert.match(service, /pageName: config\.pageName/);
  assert.doesNotMatch(service, /\n\s+pageName,\n\s+instructions:/);
  assert.match(schema, /model MessengerLink/);
  assert.match(schema, /model MessengerWebhookEvent/);
  assert.match(schema, /psid\s+String\?/);
  assert.match(schema, /fallbackCodeHash\s+String\?/);
  assert.match(schema, /fallbackCodeExpiresAt\s+DateTime\?/);
  assert.match(schema, /@@index\(\[pageId, psid\]\)/);
  assert.doesNotMatch(schema, /@@unique\(\[pageId, psid\]\)/);
  assert.match(routes, /\/link\/start/);
  assert.match(routes, /\/webhook/);
  assert.match(server, /app\.use\("\/api\/messenger", messengerRoutes\)/);
  assert.match(server, /captureMessengerRawBody/);
  assert.match(server, /verify: captureMessengerRawBody/);
  assert.match(accountHtml, /id="messenger-link-start"/);
  assert.match(accountHtml, /messenger-link\.js/);
  assert.match(accountJs, /\/api\/messenger\/status/);
  assert.match(accountJs, /\/api\/messenger\/link\/start/);
  assert.match(parentMessengerRequired, /payload\?\.url \|\| payload\?\.link/);
  assert.match(parentMessengerRequired, /parsed\.hostname === "m\.me"/);
  assert.match(parentMessengerRequired, /parentMessengerFallbackCode/);
  assert.match(parentMessengerRequired, /fallbackAction/);
  assert.match(parentMessengerRequired, /liteChoice/);
  assert.match(parentMessengerRequired, /start\(\{ openMessenger: false \}\)/);
  assert.match(parentMessengerRequired, /setInterval\(\(\) =>/);
  const parentDashboardHtml = fs.readFileSync(path.join(root, "public/parent-dashboard.html"), "utf8");
  assert.match(parentDashboardHtml, /messenger-banner-4/);
  assert.match(parentDashboardHtml, /parent-messenger-lite-choice/);
  assert.match(parentDashboardHtml, /parent-messenger-fallback/);
  assert.doesNotMatch(parentDashboardHtml, /parent-messenger-required-refresh/);
  assert.match(envExample, /META_PAGE_ID=/);
  assert.match(envExample, /META_APP_SECRET=/);
});
