"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const {
  getSubscriptionDaysRemaining,
  isStudentSubscriptionExpired,
  isStudentEligibleForRenewal,
  calculateRenewedSubscriptionDates,
  addOneMonth,
} = require("../utils/subscriptionValidity");

test("subscriptionValidity helper calculates days remaining and expiry accurately", () => {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 3);

  const expiredValidity = getSubscriptionDaysRemaining(pastDate);
  assert.ok(expiredValidity.isExpired, "Past date should be expired");
  assert.ok(expiredValidity.diffDays < 0, "Diff days should be negative");
  assert.ok(expiredValidity.isDueSoon, "Expired date is also due soon/for renewal");

  const futureNearDate = new Date();
  futureNearDate.setDate(futureNearDate.getDate() + 2);

  const nearValidity = getSubscriptionDaysRemaining(futureNearDate);
  assert.strictEqual(nearValidity.isExpired, false, "Near future date should not be expired");
  assert.strictEqual(nearValidity.isDueSoon, true, "Near future date (<= 5 days) should be due soon");

  const futureFarDate = new Date();
  futureFarDate.setDate(futureFarDate.getDate() + 20);

  const farValidity = getSubscriptionDaysRemaining(futureFarDate);
  assert.strictEqual(farValidity.isExpired, false, "Far future date should not be expired");
  assert.strictEqual(farValidity.isDueSoon, false, "Far future date should not be due soon");
});

test("isStudentSubscriptionExpired and isStudentEligibleForRenewal detect expired and renewal states", () => {
  const expiredDate = new Date();
  expiredDate.setDate(expiredDate.getDate() - 5);

  const expiredStudent = {
    paymentStage: "PAID",
    paymentStatus: true,
    subscriptionEndDate: expiredDate.toISOString(),
  };

  assert.strictEqual(isStudentSubscriptionExpired(expiredStudent), true);
  assert.strictEqual(isStudentEligibleForRenewal(expiredStudent), true);

  const urgentDate = new Date();
  urgentDate.setDate(urgentDate.getDate() + 3);

  const urgentStudent = {
    paymentStage: "PAID",
    paymentStatus: true,
    subscriptionEndDate: urgentDate.toISOString(),
  };

  assert.strictEqual(isStudentSubscriptionExpired(urgentStudent), false);
  assert.strictEqual(isStudentEligibleForRenewal(urgentStudent), true);

  const activeDate = new Date();
  activeDate.setDate(activeDate.getDate() + 25);

  const activeStudent = {
    paymentStage: "PAID",
    paymentStatus: true,
    subscriptionEndDate: activeDate.toISOString(),
  };

  assert.strictEqual(isStudentSubscriptionExpired(activeStudent), false);
  assert.strictEqual(isStudentEligibleForRenewal(activeStudent), false);

  const expiredStageStudent = {
    paymentStage: "EXPIRED",
    paymentStatus: false,
    subscriptionEndDate: null,
  };

  assert.strictEqual(isStudentSubscriptionExpired(expiredStageStudent), true);
  assert.strictEqual(isStudentEligibleForRenewal(expiredStageStudent), true);
});

test("calculateRenewedSubscriptionDates extends active dates and resets expired dates", () => {
  const expiredEnd = new Date();
  expiredEnd.setDate(expiredEnd.getDate() - 7);

  const expiredRenewed = calculateRenewedSubscriptionDates(null, expiredEnd);
  const now = new Date();
  assert.strictEqual(
    expiredRenewed.subscriptionStartDate.toDateString(),
    now.toDateString(),
    "Expired renewal start date should be today"
  );
  assert.ok(
    expiredRenewed.subscriptionEndDate > now,
    "Expired renewal end date should be in the future"
  );

  // Active student renewal extends from existing end date
  const activeStart = new Date("2026-09-01T00:00:00Z");
  const activeEnd = new Date();
  activeEnd.setDate(activeEnd.getDate() + 4);

  const activeRenewed = calculateRenewedSubscriptionDates(activeStart, activeEnd);
  assert.strictEqual(
    activeRenewed.subscriptionStartDate.toISOString(),
    activeStart.toISOString(),
    "Active student renewal should preserve original start date"
  );
  assert.ok(
    activeRenewed.subscriptionEndDate > activeEnd,
    "Active student renewal end date should be extended past the current end date"
  );
});

test("addOneMonth handles month length rollovers safely without skipping months", () => {
  const jan31 = new Date(2026, 0, 31); // Jan 31, 2026
  const feb = addOneMonth(jan31);
  assert.strictEqual(feb.getMonth(), 1, "Next month should be February (1)");
  assert.strictEqual(feb.getDate(), 28, "Date should be adjusted to last day of Feb (28)");
});

test("paymentController.js allows expired subscription renewal and updates dates", () => {
  const paymentCtrl = fs.readFileSync(path.join(root, "controllers/paymentController.js"), "utf8");

  // Uses subscription validity
  assert.match(paymentCtrl, /require\("\.\.\/utils\/subscriptionValidity"\)/);
  assert.match(paymentCtrl, /isStudentEligibleForRenewal/);
  assert.match(paymentCtrl, /calculateRenewedSubscriptionDates/);

  // getOwnedStudent selects subscription dates
  assert.match(paymentCtrl, /subscriptionStartDate:\s*true/);
  assert.match(paymentCtrl, /subscriptionEndDate:\s*true/);

  // startSofizPayPayment checks canRenew before blocking
  assert.match(paymentCtrl, /const canRenew = isStudentEligibleForRenewal\(student\);/);
  assert.match(
    paymentCtrl,
    /if\s*\(!canRenew\s*&&\s*requestedSubjectAlreadyEnabled\s*&&\s*\(student\.paymentStage === "PAID" \|\| student\.paymentStatus\)\)/
  );

  // activatePaidTransaction calculates renewed dates and updates student
  assert.match(paymentCtrl, /calculateRenewedSubscriptionDates\(\s*student\.subscriptionStartDate,\s*student\.subscriptionEndDate\s*\)/);
  assert.match(paymentCtrl, /subscriptionStartDate:\s*renewedDates\.subscriptionStartDate/);
  assert.match(paymentCtrl, /subscriptionEndDate:\s*renewedDates\.subscriptionEndDate/);
});

test("studentController.js allows expired receipt submission and updates dates on approval", () => {
  const studentCtrl = fs.readFileSync(path.join(root, "controllers/studentController.js"), "utf8");

  // Uses subscription validity
  assert.match(studentCtrl, /require\("\.\.\/utils\/subscriptionValidity"\)/);
  assert.match(studentCtrl, /isStudentEligibleForRenewal/);
  assert.match(studentCtrl, /calculateRenewedSubscriptionDates/);

  // submitPaymentReceipt selects dates and checks canRenew
  assert.match(studentCtrl, /const canRenew = isStudentEligibleForRenewal\(student\);/);
  assert.match(
    studentCtrl,
    /if\s*\(!canRenew\s*&&\s*\(student\.paymentStage === "PAID" \|\| student\.paymentStatus\)\)/
  );

  // confirmStudentPaymentReceipt updates subscriptionStartDate and subscriptionEndDate
  assert.match(studentCtrl, /subscriptionStartDate:\s*renewedDates\.subscriptionStartDate/);
  assert.match(studentCtrl, /subscriptionEndDate:\s*renewedDates\.subscriptionEndDate/);
  assert.match(studentCtrl, /notifyAccountStatus\(req,\s*updatedStudent\);/);
});

test("lessonVideoController.js restricts access for expired subscriptions and subject enrollments", () => {
  const lessonCtrl = fs.readFileSync(path.join(root, "controllers/lessonVideoController.js"), "utf8");

  assert.match(lessonCtrl, /isStudentSubscriptionExpired/);
  assert.match(lessonCtrl, /if\s*\(isStudentSubscriptionExpired\(student\)\)\s*\{\s*return\s*\{\s*canWatch:\s*false,\s*accessReason:\s*"EXPIRED"\s*\};/);
  assert.match(lessonCtrl, /if\s*\(repositoryType === "MATH" && !student\.mathEnrollment\)\s*\{\s*return\s*\{\s*canWatch:\s*false,\s*accessReason:\s*"PHYSICS_ONLY"\s*\};/);
  assert.match(lessonCtrl, /if\s*\(repositoryType === "PHYSICS" && !student\.physicsEnrollment\)\s*\{\s*return\s*\{\s*canWatch:\s*false,\s*accessReason:\s*"MATH_ONLY"\s*\};/);
});

test("studentController.js updateStudentSubscriptionDates activates student access when extended to valid date", () => {
  const studentCtrl = fs.readFileSync(path.join(root, "controllers/studentController.js"), "utf8");

  assert.match(studentCtrl, /let isNowActive = false;/);
  assert.match(studentCtrl, /updateData\.liveAccessEnabled = true;/);
  assert.match(studentCtrl, /updateData\.paymentStatus = true;/);
  assert.match(studentCtrl, /updateData\.paymentStage = "PAID";/);
  assert.match(studentCtrl, /io\?\.to\(`\$\{currentStudent\.level\}_lobby`\)\.emit\("student_live_access_updated",/);
});

test("server.js grants secondary payment access for active subscriptionEndDate", () => {
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");

  assert.match(serverJs, /const hasSecondaryPaymentAccess =\s*student\.level !== UNIVERSITY_LEVEL && \(Boolean\(student\.subscriptionEndDate/);
});

test("parent-dashboard.js handles EXPIRED in openLessonUpgradeModal and openPaymentAccessModal", () => {
  const parentJs = fs.readFileSync(path.join(root, "public/js/parent-dashboard.js"), "utf8");

  assert.match(parentJs, /video\?\.accessReason === "EXPIRED"\s*\?\s*"lesson-expired"/);
  assert.match(parentJs, /const isExpired = reason === "lesson-expired" \|\| reason === "subscription-expired";/);
});
