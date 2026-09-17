const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("server.js supports teacher_mic_state event, tracking and room_joined payload", () => {
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");

  assert.match(serverJs, /const teacherMicActiveByLevel = new Map\(\);/);
  assert.match(serverJs, /function isTeacherMicActive\(level\)/);
  assert.match(serverJs, /function setTeacherMicActive\(level, active\)/);
  assert.match(serverJs, /socket\.on\("teacher_mic_state",\s*\(data = \{\}, acknowledgement\)\s*=>/);
  assert.match(serverJs, /io\.to\(level\)\.emit\("teacher_mic_state",\s*\{\s*level,\s*active\s*\}\);/);
  assert.match(serverJs, /teacherMicActive:\s*isTeacherMicActive\(classroomLevel\)/);
});

test("teacher-live-v2.js and mobile studio publish teacher mic state", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  assert.match(teacherLive, /async function publishTeacherMicState\(active\)/);
  assert.match(teacherLive, /emitWithAcknowledgement\("teacher_mic_state"/);
  assert.match(teacherLive, /publishTeacherMicState\(shouldEnable\)/);

  const teacherMobile = fs.readFileSync(path.join(root, "public/js/teacher-live-mobile.js"), "utf8");
  assert.match(teacherMobile, /socket\.emit\("teacher_mic_state",\s*\{\s*level:\s*activeLevel,\s*active:\s*isMicActive\s*\}\);/);
});

test("student-live.html contains floating red banner with exact requested text and close button", () => {
  const html = fs.readFileSync(path.join(root, "public/student-live.html"), "utf8");

  assert.match(html, /id="teacher-mic-mute-banner"/);
  assert.match(html, /الأستاذ لا يتحدث وغلق الميكروفون الخاص به/);
  assert.match(html, /id="dismiss-teacher-mic-mute-btn"/);
  assert.match(html, /\.teacher-mic-mute-banner\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(html, /\.teacher-mic-mute-banner\s*\{[\s\S]*?background:\s*linear-gradient/);
});

test("student-live.js controls teacher mic mute banner and handles socket events", () => {
  const studentJs = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

  assert.match(studentJs, /teacherMicMuteBanner:\s*document\.getElementById\("teacher-mic-mute-banner"\)/);
  assert.match(studentJs, /dismissTeacherMicMuteBtn:\s*document\.getElementById\("dismiss-teacher-mic-mute-btn"\)/);
  assert.match(studentJs, /function setTeacherMicMutedState\(isMuted\)/);
  assert.match(studentJs, /socket\.on\("teacher_mic_state"/);
  assert.match(studentJs, /data\.teacherMicActive === false/);
  assert.match(studentJs, /dismissTeacherMicMuteBtn\?\.addEventListener\("click"/);
});
