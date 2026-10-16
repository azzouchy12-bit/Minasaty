"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("Prisma schema defines subject for Attendance model", () => {
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.match(schema, /model\s+Attendance\s*\{[\s\S]*?subject\s+String\?/);
});

test("server.js stores subject upon student_join_room attendance record creation", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(
    serverCode,
    /subject:\s*activeSubjectByLevel\.get\(classroomLevel\)\s*\|\|\s*"MATH"/,
    "Should record current active subject or default MATH in attendance"
  );
});

test("server.js microphone participation threshold is updated to 5 seconds", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  // Check that participation duration threshold is 5000ms / 5s
  assert.match(serverCode, /Date\.now\(\)\s*-\s*micStartedAt\s*>=\s*5000/);
  assert.match(serverCode, /micDurationSeconds\s*>=\s*5/);
  // Ensure the old 10s checks were replaced
  assert.doesNotMatch(serverCode, /Date\.now\(\)\s*-\s*micStartedAt\s*>=\s*10000/);
  assert.doesNotMatch(serverCode, /micDurationSeconds\s*>=\s*10/);
});

test("server.js sets micStartedAt when teacher approves mic", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(
    serverCode,
    /targetSocket\.data\.micStartedAt\s*=\s*Date\.now\(\)/,
    "micStartedAt must be initialized on teacher_approve_mic"
  );
});

test("attendanceController.js exports getAttendanceForStudent and summarizes attendances and participations", () => {
  const controller = require(path.join(root, "controllers/attendanceController.js"));
  assert.strictEqual(typeof controller.getAttendanceForStudent, "function");
  assert.strictEqual(typeof controller.summarizeAttendances, "function");
  assert.strictEqual(typeof controller.summarizeParticipations, "function");
});

test("summarizeAttendances deduplicates multiple joins on the same day into 1 attendance per subject session", () => {
  const { summarizeAttendances } = require(path.join(root, "controllers/attendanceController.js"));

  // Mock student joins: 3 times on Oct 10 (Math), 2 times on Oct 11 (Physics), 1 time on Oct 12 (Math)
  const mockRecords = [
    {
      id: "att-1",
      joinedAt: new Date("2026-10-10T09:00:00Z"),
      durationMinutes: 20,
      level: "2AS_SCIENTIFIC",
      subject: "MATH"
    },
    {
      id: "att-2",
      joinedAt: new Date("2026-10-10T09:25:00Z"),
      durationMinutes: 25,
      level: "2AS_SCIENTIFIC",
      subject: "MATH"
    },
    {
      id: "att-3",
      joinedAt: new Date("2026-10-10T10:00:00Z"),
      durationMinutes: 40,
      level: "2AS_SCIENTIFIC",
      subject: "MATH"
    },
    {
      id: "att-4",
      joinedAt: new Date("2026-10-11T14:00:00Z"),
      durationMinutes: 30,
      level: "2AS_SCIENTIFIC",
      subject: "PHYSICS"
    },
    {
      id: "att-5",
      joinedAt: new Date("2026-10-11T14:35:00Z"),
      durationMinutes: 40,
      level: "2AS_SCIENTIFIC",
      subject: "PHYSICS"
    },
    {
      id: "att-6",
      joinedAt: new Date("2026-10-12T09:00:00Z"),
      durationMinutes: 90,
      level: "2AS_SCIENTIFIC",
      subject: "MATH"
    }
  ];

  const summary = summarizeAttendances(mockRecords);

  // Even though there are 6 join records:
  // - Oct 10 MATH: 3 joins -> 1 attendance
  // - Oct 11 PHYSICS: 2 joins -> 1 attendance
  // - Oct 12 MATH: 1 join -> 1 attendance
  // Total attendances should be 3 (2 Math, 1 Physics)
  assert.strictEqual(summary.totalCount, 3, "Total attendance count should be 3 unique sessions");
  assert.strictEqual(summary.mathCount, 2, "Math attendance count should be 2");
  assert.strictEqual(summary.physicsCount, 1, "Physics attendance count should be 1");
  assert.strictEqual(summary.freeCount, 0);
  assert.strictEqual(summary.sessions.length, 3, "There should be 3 distinct session records");
  
  // Verify session 1 (Oct 10) accumulated duration is 20 + 25 + 40 = 85 mins and joinCount is 3
  const oct10Session = summary.sessions.find(s => s.dateKey === "2026-10-10");
  assert.ok(oct10Session, "Oct 10 session should exist");
  assert.strictEqual(oct10Session.subject, "MATH");
  assert.strictEqual(oct10Session.totalDurationMinutes, 85);
  assert.strictEqual(oct10Session.joinCount, 3);
});

test("summarizeParticipations groups by subject and session", () => {
  const { summarizeParticipations } = require(path.join(root, "controllers/attendanceController.js"));

  const mockParticipations = [
    {
      id: "p1",
      sessionKey: "MATH-2026-10-10-MORNING",
      subject: "MATH",
      count: 2,
      micSeconds: 15,
      lastParticipatedAt: new Date("2026-10-10T09:30:00Z")
    },
    {
      id: "p2",
      sessionKey: "MATH-2026-10-10-AFTERNOON",
      subject: "MATH",
      count: 1,
      micSeconds: 8,
      lastParticipatedAt: new Date("2026-10-10T15:15:00Z")
    },
    {
      id: "p3",
      sessionKey: "PHYSICS-2026-10-11-EVENING",
      subject: "PHYSICS",
      count: 3,
      micSeconds: 30,
      lastParticipatedAt: new Date("2026-10-11T14:45:00Z")
    }
  ];

  const summary = summarizeParticipations(mockParticipations);
  // Total count = 2 + 1 + 3 = 6 participations across 2 calendar day sessions (Oct 10 & Oct 11)
  assert.strictEqual(summary.totalCount, 6, "Total participations should be 6");
  assert.strictEqual(summary.mathCount, 3, "Math participations should be 3");
  assert.strictEqual(summary.physicsCount, 3, "Physics participations should be 3");
  assert.strictEqual(summary.sessions.length, 2, "Oct 10 morning and afternoon should be consolidated to 1 session for that day");
});

test("summarizeAttendances consolidates multiple joins across a single day (e.g. 8:13, 8:18, 8:22, 8:23) into exactly 1 attendance row", () => {
  const { summarizeAttendances } = require(path.join(root, "controllers/attendanceController.js"));

  // Exactly like the user's screenshot on Sept 9, 2026:
  const sept9Records = [
    { id: "1", joinedAt: new Date("2026-09-09T19:13:44Z"), durationMinutes: 1, subject: "MATH", level: "السنة الرابعة" },
    { id: "2", joinedAt: new Date("2026-09-09T19:14:33Z"), durationMinutes: 0, subject: "MATH", level: "السنة الرابعة" },
    { id: "3", joinedAt: new Date("2026-09-09T19:18:38Z"), durationMinutes: 0, subject: "MATH", level: "السنة الرابعة" },
    { id: "4", joinedAt: new Date("2026-09-09T19:22:19Z"), durationMinutes: 0, subject: "PHYSICS", level: "السنة الرابعة" },
    { id: "5", joinedAt: new Date("2026-09-09T19:23:20Z"), durationMinutes: 20, subject: "PHYSICS", level: "السنة الرابعة" },
    { id: "6", joinedAt: new Date("2026-09-09T19:44:14Z"), durationMinutes: 20, subject: "PHYSICS", level: "السنة الرابعة" },
    { id: "7", joinedAt: new Date("2026-09-09T20:05:23Z"), durationMinutes: 29, subject: "PHYSICS", level: "السنة الرابعة" },
    { id: "8", joinedAt: new Date("2026-09-09T20:36:38Z"), durationMinutes: 38, subject: "PHYSICS", level: "السنة الرابعة" },
    { id: "9", joinedAt: new Date("2026-09-09T21:15:10Z"), durationMinutes: 5, subject: "PHYSICS", level: "السنة الرابعة" },
  ];

  const summary = summarizeAttendances(sept9Records);
  assert.strictEqual(summary.totalCount, 1, "Must be exactly 1 attendance for the entire day");
  assert.strictEqual(summary.physicsCount, 1, "Dominant subject of that day must be PHYSICS");
  assert.strictEqual(summary.mathCount, 0);
  assert.strictEqual(summary.sessions.length, 1);
  assert.strictEqual(summary.sessions[0].joinCount, 9);
  assert.strictEqual(summary.sessions[0].totalDurationMinutes, 113);
  assert.strictEqual(summary.sessions[0].subject, "PHYSICS");
});

test("parent-dashboard.js uses attendanceSummary.totalCount instead of 60 minute duration check", () => {
  const parentJs = fs.readFileSync(path.join(root, "public/js/parent-dashboard.js"), "utf8");
  assert.match(
    parentJs,
    /attendancePayload\.attendanceSummary\.totalCount/,
    "Parent dashboard should use attendanceSummary.totalCount"
  );
  // Ensure durationMinutes >= 60 attendance filter is removed
  assert.doesNotMatch(
    parentJs,
    /record\.durationMinutes\s*>=\s*60/,
    "durationMinutes >= 60 attendance requirement must be removed"
  );
});

test("teacher-dashboard.html contains attendance and participation cards and dashboard modals", () => {
  const html = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  // Student actions modal stats cards
  assert.match(html, /id="student-actions-attendance-card"/);
  assert.match(html, /id="student-actions-participation-card"/);
  assert.match(html, /id="student-actions-attendance-val"/);
  assert.match(html, /id="student-actions-participation-val"/);
  // Attendance dashboard modal
  assert.match(html, /id="attendance-modal"/);
  assert.match(html, /id="attendance-total-count"/);
  assert.match(html, /id="attendance-math-count"/);
  assert.match(html, /id="attendance-physics-count"/);
  // Participation dashboard modal
  assert.match(html, /id="participation-modal"/);
  assert.match(html, /id="participation-total-count"/);
  assert.match(html, /id="participation-math-count"/);
  assert.match(html, /id="participation-physics-count"/);
});

test("teacher-dashboard.js implements participation modal and stat pill interactions", () => {
  const js = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  assert.match(js, /function fetchStudentStats\s*\(/);
  assert.match(js, /function openParticipationModal\s*\(/);
  assert.match(js, /function closeParticipationModal\s*\(/);
  assert.match(js, /function renderParticipationRecords\s*\(/);
  assert.match(js, /student-actions-attendance-card/);
  assert.match(js, /student-actions-participation-card/);
  assert.match(js, /سجل المشاركات/);
});

test("app.css includes rich styling for attendance and participation cards and dashboard modals", () => {
  const css = fs.readFileSync(path.join(root, "public/css/app.css"), "utf8");
  assert.match(css, /\.student-actions-stats/);
  assert.match(css, /\.student-stat-pill/);
  assert.match(css, /\.attendance-dashboard-card/);
  assert.match(css, /\.participation-dashboard-card/);
  assert.match(css, /\.dash-kpi-card/);
  assert.match(css, /\.dash-subject-tag/);
});
