"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("Prisma schema defines subscriptionStartDate and subscriptionEndDate for Student", () => {
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.match(schema, /subscriptionStartDate\s+DateTime\?/);
  assert.match(schema, /subscriptionEndDate\s+DateTime\?/);
});

test("studentRoutes registers PUT /:id/subscription-dates with teacher verification", () => {
  const routes = fs.readFileSync(path.join(root, "routes/studentRoutes.js"), "utf8");
  assert.match(
    routes,
    /router\.put\("\/:id\/subscription-dates",\s*verifyToken,\s*isTeacher,\s*updateStudentSubscriptionDates\)/
  );
});

test("studentController exports updateStudentSubscriptionDates and validates dates", () => {
  const controller = fs.readFileSync(path.join(root, "controllers/studentController.js"), "utf8");
  assert.match(controller, /async function updateStudentSubscriptionDates\s*\(/);
  assert.match(controller, /updateStudentSubscriptionDates,/);
  assert.match(controller, /تاريخ انتهاء الاشتراك يجب أن يكون بعد تاريخ بدء الاشتراك/);
  assert.match(controller, /STUDENT_SUBSCRIPTION_DATES_UPDATED/);
});

test("teacher-dashboard.html includes subscription dates modal, inputs, and presets", () => {
  const html = fs.readFileSync(path.join(root, "public/teacher-dashboard.html"), "utf8");
  assert.match(html, /id="subscription-dates-modal"/);
  assert.match(html, /id="subscription-start-date"/);
  assert.match(html, /id="subscription-end-date"/);
  assert.match(html, /id="preset-1-month"/);
  assert.match(html, /id="preset-3-months"/);
  assert.match(html, /id="preset-school-year"/);
  assert.match(html, /id="subscription-dates-clear-btn"/);
  assert.match(html, /id="subscription-modal-start-date"/);
  assert.match(html, /id="subscription-modal-end-date"/);
});

test("teacher-dashboard.js implements subscription dates modal and action button", () => {
  const js = fs.readFileSync(path.join(root, "public/js/teacher-dashboard.js"), "utf8");
  assert.match(js, /function openSubscriptionDatesModal\s*\(/);
  assert.match(js, /function saveSubscriptionDates\s*\(/);
  assert.match(js, /function applySubscriptionPreset\s*\(/);
  assert.match(js, /function getSubscriptionValidity\s*\(/);
  assert.match(js, /تحديد فترة الاشتراك/);
  assert.match(js, /openSubscriptionDatesModal\(student\)/);
  assert.match(js, /\/api\/students\/\$\{encodeURIComponent\(subscriptionDatesStudentId\)\}\/subscription-dates/);
  assert.match(js, /teacher-subscription-pill/);
});

test("app.css includes styling for subscription dates modal and status pills", () => {
  const css = fs.readFileSync(path.join(root, "public/css/app.css"), "utf8");
  assert.match(css, /\.subscription-dates-card/);
  assert.match(css, /\.subscription-dates-status-box/);
  assert.match(css, /\.subscription-dates-inputs-grid/);
  assert.match(css, /\.subscription-dates-presets/);
  assert.match(css, /\.teacher-subscription-pill/);
});
