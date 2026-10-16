"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Exercise Photo Count: attendanceController includes live question images as exercisesSummary", () => {
  const attendanceCode = fs.readFileSync(path.join(root, "controllers/attendanceController.js"), "utf8");
  assert.match(attendanceCode, /prisma\.liveQuestionImage\.findMany/, "getAttendanceForStudent must query liveQuestionImage");
  assert.match(attendanceCode, /exercisesSummary\s*=\s*\{\s*totalCount:\s*questionImages\.length/, "getAttendanceForStudent must return exercisesSummary with totalCount");
});

test("Exercise Photo Count: academicController returns liveQuestionImagesCount in getProgress and listAssignments", () => {
  const academicCode = fs.readFileSync(path.join(root, "controllers/academicController.js"), "utf8");
  assert.match(academicCode, /liveQuestionImagesCount/, "academicController must return liveQuestionImagesCount");
  assert.match(academicCode, /liveExercises:\s*questionImages/, "listAssignments must return liveExercises");
});

test("Exercise Photo Count: parent-dashboard.html labels KPI and section as 'المشاركة - حل التمارين أثناء الحصة'", () => {
  const html = fs.readFileSync(path.join(root, "public/parent-dashboard.html"), "utf8");
  assert.match(html, /<small>المشاركة - حل التمارين أثناء الحصة<\/small>/, "KPI card must be labeled المشاركة - حل التمارين أثناء الحصة");
  assert.match(html, /id="student-homework-title">المشاركة - حل التمارين أثناء الحصة<\/strong>/, "Section title must be labeled المشاركة - حل التمارين أثناء الحصة");
});

test("Exercise Photo Count: parent-dashboard.js sets homeworkCount to exercise photos total", () => {
  const js = fs.readFileSync(path.join(root, "public/js/parent-dashboard.js"), "utf8");
  assert.match(js, /exercisesTotal/, "parent-dashboard.js must calculate exercisesTotal");
  assert.match(js, /setActivityStat\(elements\.homeworkCount,\s*exercisesTotal\)/, "parent-dashboard.js must set homeworkCount to exercisesTotal");
});

test("Exercise Photo Count: teacher-dashboard.html includes student-actions-exercises-val", () => {
  const html = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  assert.match(html, /id="student-actions-exercises-val"/, "teacher-dashboard.html must have student-actions-exercises-val");
  const js = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  assert.match(js, /studentActionsExercisesVal/, "teacher-dashboard.js must bind studentActionsExercisesVal");
});
