"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Teacher Student Session Stats: server.js registers teacher_get_student_session_stats socket event", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(
    serverCode,
    /teacher_get_student_session_stats/,
    "server.js must define teacher_get_student_session_stats socket event"
  );
  assert.match(
    serverCode,
    /getStudent24HourParticipation\(studentId\)/,
    "server.js must compute 24-hour participations using getStudent24HourParticipation"
  );
  assert.match(
    serverCode,
    /prisma\.studentReactionPoint\.aggregate/,
    "server.js must query studentReactionPoint for points aggregation"
  );
  assert.match(
    serverCode,
    /sessionParticipations/,
    "server.js must return sessionParticipations in payload"
  );
  assert.match(
    serverCode,
    /sessionPoints/,
    "server.js must return sessionPoints in payload"
  );
});

test("Teacher Student Session Stats: teacher-live.html contains student stats modal structure", () => {
  const html = fs.readFileSync(path.join(root, "public/teacher-live.html"), "utf8");
  assert.match(html, /id="student-stats-modal"/, "teacher-live.html must contain #student-stats-modal");
  assert.match(html, /id="student-stats-session-participations"/, "must have session participations element");
  assert.match(html, /id="student-stats-session-points"/, "must have session points element");
  assert.match(html, /id="student-stats-total-points"/, "must have total points element");
  assert.match(html, /id="student-stats-total-participations"/, "must have total participations element");
  assert.match(html, /id="close-student-stats-modal"/, "must have close button");
});

test("Teacher Student Session Stats: studio-modern.css styles modal and clickable attendee names", () => {
  const css = fs.readFileSync(path.join(root, "public/css/studio-modern.css"), "utf8");
  assert.match(css, /\.student-stats-modal/, "must style .student-stats-modal");
  assert.match(css, /\.student-stat-box\.is-participations/, "must style participations card");
  assert.match(css, /\.student-stat-box\.is-points/, "must style points card");
  assert.match(css, /\.attendee-name\s*\{\s*cursor:\s*pointer/, "attendee-name must have cursor pointer");
});

test("Teacher Student Session Stats: teacher-live-v2.js wires openStudentStatsModal to attendee clicks", () => {
  const js = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  assert.match(js, /function openStudentStatsModal/, "must define openStudentStatsModal");
  assert.match(js, /function closeStudentStatsModal/, "must define closeStudentStatsModal");
  assert.match(js, /teacher_get_student_session_stats/, "must emit teacher_get_student_session_stats");
  assert.match(js, /openStudentStatsModal\(/, "upsertAttendee must bind openStudentStatsModal click handler");
});

test("Teacher Student Session Stats: teacher-live-mobile supports mobile student stats modal", () => {
  const mobileHtml = fs.readFileSync(path.join(root, "public/teacher-live-mobile.html"), "utf8");
  assert.match(mobileHtml, /id="tm-student-stats-modal"/, "must contain mobile student stats modal");

  const mobileJs = fs.readFileSync(path.join(root, "public/js/teacher-live-mobile.js"), "utf8");
  assert.match(mobileJs, /openMobileStudentStats/, "must define openMobileStudentStats");
});
