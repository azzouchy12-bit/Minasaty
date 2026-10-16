"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Points System: Prisma schema defines StudentReactionPoint model and relation", () => {
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.match(schema, /model\s+StudentReactionPoint\s*\{/, "schema must declare StudentReactionPoint model");
  assert.match(schema, /@@unique\(\[messageId,\s*reaction\]\)/, "schema must enforce unique [messageId, reaction]");
  assert.match(schema, /reactionPoints\s+StudentReactionPoint\[\]/, "Student model must have reactionPoints relation");
});

test("Points System: server.js defines TEACHER_REACTION_POINTS and socket persistence", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverCode, /TEACHER_REACTION_POINTS/, "server.js must define TEACHER_REACTION_POINTS");
  assert.match(serverCode, /fire:\s*5/, "fire must be +5 points");
  assert.match(serverCode, /love:\s*3/, "love must be +3 points");
  assert.match(serverCode, /like:\s*2/, "like must be +2 points");
  assert.match(serverCode, /cry:\s*0/, "cry must be 0 points");
  assert.match(serverCode, /dislike:\s*-1/, "dislike must be -1 point");

  assert.match(serverCode, /prisma\.studentReactionPoint\.upsert/, "server.js must upsert StudentReactionPoint on toggleOn");
  assert.match(serverCode, /prisma\.studentReactionPoint\.deleteMany/, "server.js must delete StudentReactionPoint on toggleOff");
  assert.match(serverCode, /teacher_reacted_to_message/, "server.js must emit teacher_reacted_to_message to student");
  assert.match(serverCode, /reaction_points_updated/, "server.js must emit reaction_points_updated on student join");
});

test("Points System: attendanceController returns reactionPointsSummary and breakdown", () => {
  const attendanceCode = fs.readFileSync(path.join(root, "controllers/attendanceController.js"), "utf8");
  assert.match(attendanceCode, /prisma\.studentReactionPoint\.findMany/, "attendanceController must query studentReactionPoint");
  assert.match(attendanceCode, /reactionPointsSummary/, "attendanceController must build reactionPointsSummary");
  assert.match(attendanceCode, /pointsSummary:\s*reactionPointsSummary/, "attendanceController must expose pointsSummary alias");
});

test("Points System: academicController returns reactionPointsTotal and reactionPointsSummary", () => {
  const academicCode = fs.readFileSync(path.join(root, "controllers/academicController.js"), "utf8");
  assert.match(academicCode, /reactionPointsTotal/, "academicController must return reactionPointsTotal");
  assert.match(academicCode, /reactionPointsSummary/, "academicController must return reactionPointsSummary");
});

test("Points System: Teacher Dashboard UI displays points card and breakdown", () => {
  const html = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  assert.match(html, /id="student-actions-points-val"/, "teacher-dashboard.html must have #student-actions-points-val");
  assert.match(html, /id="student-actions-points-breakdown"/, "teacher-dashboard.html must have #student-actions-points-breakdown");

  const js = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  assert.match(js, /studentActionsPointsVal/, "teacher-dashboard.js must bind studentActionsPointsVal");
  assert.match(js, /studentActionsPointsBreakdown/, "teacher-dashboard.js must bind studentActionsPointsBreakdown");
  assert.match(js, /reactionPointsSummary/, "teacher-dashboard.js must read reactionPointsSummary");
});

test("Points System: Parent Dashboard displays points KPI and subtitle breakdown", () => {
  const html = fs.readFileSync(path.join(root, "public/parent-dashboard.html"), "utf8");
  assert.match(html, /id="reaction-points-count"/, "parent-dashboard.html must have #reaction-points-count");
  assert.match(html, /id="reaction-points-subtitle"/, "parent-dashboard.html must have #reaction-points-subtitle");

  const js = fs.readFileSync(path.join(root, "public/js/parent-dashboard.js"), "utf8");
  assert.match(js, /reactionPointsCount:\s*document\.getElementById\("reaction-points-count"\)/, "parent-dashboard.js must bind reactionPointsCount");
  assert.match(js, /setActivityStat\(elements\.reactionPointsCount,\s*reactionPointsTotal\)/, "parent-dashboard.js must set reactionPointsCount");
});

test("Points System: Student Live studio displays points badge and handles real-time awards", () => {
  const html = fs.readFileSync(path.join(root, "public/student-live.html"), "utf8");
  assert.match(html, /id="student-points-count"/, "student-live.html must have #student-points-count");

  const js = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  assert.match(js, /pointsCount:\s*document\.getElementById\("student-points-count"\)/, "student-live.js must bind pointsCount");
  assert.match(js, /function setStudentPointsCount/, "student-live.js must declare setStudentPointsCount");
  assert.match(js, /socket\.on\("reaction_points_updated"/, "student-live.js must handle reaction_points_updated");
  assert.match(js, /socket\.on\("teacher_reacted_to_message"/, "student-live.js must handle teacher_reacted_to_message");
  assert.match(js, /showMobileControlToast/, "student-live.js must display congratulatory toast on points award");
});

test("Points System: server.js passes Node.js syntax check without errors", () => {
  const { execFileSync } = require("node:child_process");
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ["--check", path.join(root, "server.js")], { encoding: "utf8" });
  }, "server.js must have valid syntax without uncaught await or parsing errors");
});

test("Manual Stats Adjustment: Schema defines 4 manual adjustment fields on Student", () => {
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.match(schema, /manualAttendanceAdjustment\s+Int\s+@default\(0\)/, "schema must declare manualAttendanceAdjustment");
  assert.match(schema, /manualParticipationAdjustment\s+Int\s+@default\(0\)/, "schema must declare manualParticipationAdjustment");
  assert.match(schema, /manualExercisesAdjustment\s+Int\s+@default\(0\)/, "schema must declare manualExercisesAdjustment");
  assert.match(schema, /manualPointsAdjustment\s+Int\s+@default\(0\)/, "schema must declare manualPointsAdjustment");
});

test("Manual Stats Adjustment: studentController & studentRoutes provide PUT /api/students/:id/activity-stats", () => {
  const controllerCode = fs.readFileSync(path.join(root, "controllers/studentController.js"), "utf8");
  assert.match(controllerCode, /updateStudentActivityStats/, "studentController must export updateStudentActivityStats");
  assert.match(controllerCode, /manualAttendanceAdjustment\s*=\s*target\s*-\s*rawAttendanceTotal/, "adjustment must be delta between target and raw count");

  const routesCode = fs.readFileSync(path.join(root, "routes/studentRoutes.js"), "utf8");
  assert.match(routesCode, /router\.put\(\s*"\/:\w+\/activity-stats",\s*verifyToken,\s*isTeacher,\s*updateStudentActivityStats\s*\)/, "studentRoutes must register PUT /:id/activity-stats");
});

test("Manual Stats Adjustment: attendanceController includes adjustments in all totals", () => {
  const attendanceCode = fs.readFileSync(path.join(root, "controllers/attendanceController.js"), "utf8");
  assert.match(attendanceCode, /student\.manualAttendanceAdjustment/, "attendanceController must factor in manualAttendanceAdjustment");
  assert.match(attendanceCode, /student\.manualParticipationAdjustment/, "attendanceController must factor in manualParticipationAdjustment");
  assert.match(attendanceCode, /student\.manualExercisesAdjustment/, "attendanceController must factor in manualExercisesAdjustment");
  assert.match(attendanceCode, /student\.manualPointsAdjustment/, "attendanceController must factor in manualPointsAdjustment");
  assert.match(attendanceCode, /manualAdjustments:\s*\{/, "attendanceController must return manualAdjustments object");
});

test("Manual Stats Adjustment: Teacher Dashboard UI has edit button, modal and JS bindings", () => {
  const html = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  assert.match(html, /id="student-actions-edit-stats-btn"/, "teacher-dashboard.html must have #student-actions-edit-stats-btn");
  assert.match(html, /id="student-stats-edit-modal"/, "teacher-dashboard.html must have #student-stats-edit-modal");
  assert.match(html, /id="student-stats-edit-attendance"/, "teacher-dashboard.html must have #student-stats-edit-attendance");
  assert.match(html, /id="student-stats-edit-participation"/, "teacher-dashboard.html must have #student-stats-edit-participation");
  assert.match(html, /id="student-stats-edit-exercises"/, "teacher-dashboard.html must have #student-stats-edit-exercises");
  assert.match(html, /id="student-stats-edit-points"/, "teacher-dashboard.html must have #student-stats-edit-points");

  const js = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  assert.match(js, /openStudentStatsEditModal/, "teacher-dashboard.js must define openStudentStatsEditModal");
  assert.match(js, /closeStudentStatsEditModal/, "teacher-dashboard.js must define closeStudentStatsEditModal");
  assert.match(js, /saveStudentStatsEdit/, "teacher-dashboard.js must define saveStudentStatsEdit");
  assert.match(js, /\/activity-stats/, "teacher-dashboard.js must fetch /api/students/:id/activity-stats");
});

