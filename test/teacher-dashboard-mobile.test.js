const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mobileHtml = fs.readFileSync(path.join(root, "public/teacher-dashboard-mobile.html"), "utf8");
const mobileJs = fs.readFileSync(path.join(root, "public/js/teacher-dashboard-mobile.js"), "utf8");
const mobileCss = fs.readFileSync(path.join(root, "public/css/teacher-dashboard-mobile.css"), "utf8");
const registryJs = fs.readFileSync(path.join(root, "public/js/class-registry-teacher.js"), "utf8");
const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("teacher-dashboard-mobile.html includes class registry triple filters and YouTube upload toolbar", () => {
  const filtersSection = mobileHtml.slice(
    mobileHtml.indexOf("class-registry-filters"),
    mobileHtml.indexOf("class-registry-list")
  );
  const termIdx = filtersSection.indexOf('id="class-registry-term"');
  const monthIdx = filtersSection.indexOf('id="class-registry-month"');
  const subjectIdx = filtersSection.indexOf('id="class-registry-subject"');

  assert.ok(termIdx >= 0 && termIdx < monthIdx && monthIdx < subjectIdx, "Filters must be ordered: term -> month -> subject");
  assert.match(filtersSection, /id="class-registry-month"\s+class="tdm-form-input"\s+disabled/);
  assert.match(filtersSection, /id="class-registry-subject"\s+class="tdm-form-input"\s+disabled/);

  assert.match(mobileHtml, /id="youtube-connect-button"/);
  assert.match(mobileHtml, /id="registry-upload-video-btn"/);
  assert.match(mobileHtml, /id="registry-video-file-input"/);
  assert.match(mobileHtml, /id="youtube-connection-status"/);
  assert.match(mobileHtml, /id="class-registry-list"/);
});

test("teacher-dashboard-mobile.html includes required action modals and scripts", () => {
  assert.match(mobileHtml, /id="class-registry-action-modal"/);
  assert.match(mobileHtml, /id="youtube-video-picker-modal"/);
  assert.match(mobileHtml, /id="registry-youtube-upload-modal"/);
  assert.match(mobileHtml, /id="online-users-modal"/);

  assert.match(mobileHtml, /<script\s+src="\/socket\.io\/socket\.io\.js"><\/script>/);
  assert.match(mobileHtml, /<script(?:\s+defer)?\s+src="\.\/js\/class-registry-teacher\.js\?v=registry-upload-3"><\/script>/);
});

test("server.js defines /api/teacher/online-users endpoint with teacher authorization", () => {
  assert.match(serverJs, /app\.get\(\s*["']\/api\/teacher\/online-users["'],\s*verifyToken,\s*isTeacher/);
  assert.match(serverJs, /onlinePresenceSnapshot\(\)/);
});

test("class-registry-teacher.js dynamically supports university vs secondary subject options and mobile error alerts", () => {
  assert.match(registryJs, /function getRegistrySubjectOptions\(/);
  assert.match(registryJs, /level === "طالب جامعي"/);
  assert.match(registryJs, /value:\s*"PAID",\s*label:\s*"اشتراك مدفوع"/);
  assert.match(registryJs, /value:\s*"FREE",\s*label:\s*"اشتراك مجاني"/);
  assert.match(registryJs, /value:\s*"MATH",\s*label:\s*"الرياضيات"/);
  assert.match(registryJs, /value:\s*"PHYSICS",\s*label:\s*"الفيزياء"/);
  assert.match(registryJs, /#tdm-alert/);
  assert.match(registryJs, /\.tdm-level-chip\.is-active/);
  assert.match(registryJs, /class-registry-refresh/);
});

test("teacher-dashboard-mobile.js synchronizes subject types, handles global absence, notifications, online users, and electronic payments", () => {
  // 1. Schedule & Lesson Subject Options
  assert.match(mobileJs, /function scheduleTypeOptions\(/);
  assert.match(mobileJs, /function scheduleTypeLabel\(/);
  assert.match(mobileJs, /function syncScheduleSubjectOptions\(/);
  assert.match(mobileJs, /function syncLessonTypeOptions\(/);

  // 2. Global Absence
  assert.match(mobileJs, /\/api\/schedules\/absence\/global/);
  assert.match(mobileJs, /async function fetchGlobalAbsence\(\)/);
  assert.match(mobileJs, /async function toggleAbsence\(\)/);

  // 3. Online Users Modal & Socket Presence
  assert.match(mobileJs, /async function openOnlineUsersModal\(\)/);
  assert.match(mobileJs, /function initSocketPresence\(\)/);
  assert.match(mobileJs, /online-users-modal/);

  // 4. Notifications using academic announcements
  assert.match(mobileJs, /\/api\/academic\/teacher-announcements/);
  assert.match(mobileJs, /targetMode:\s*"ALL_LEVEL"/);
  assert.match(mobileJs, /recipientType:\s*"PARENTS"/);

  // 5. Electronic Payments
  assert.match(mobileJs, /\/api\/payments\/teacher\/electronic\?level=/);

  // 6. Unread Messages Badge
  assert.match(mobileJs, /\/api\/messages\/unread-count/);
  assert.match(mobileJs, /async function fetchUnreadMessagesCount\(\)/);

  // 7. Event binding for online users
  assert.match(mobileJs, /tdm-btn-online-users/);
  assert.match(mobileJs, /online-users-modal-close/);
});

test("teacher-dashboard-mobile.css contains responsive styles for modals and registry items", () => {
  assert.match(mobileCss, /\.tdm-modal-overlay/);
  assert.match(mobileCss, /\.tdm-modal-dialog/);
  assert.match(mobileCss, /\.class-registry-item/);
  assert.match(mobileCss, /\.registry-action/);
  assert.match(mobileCss, /\.youtube-video-picker-item/);
});
