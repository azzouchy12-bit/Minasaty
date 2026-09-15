"use strict";

const test = require("node:test");
const assert = require("node:assert");
const liveAlertHub = require("../utils/liveAlertHub");

test("liveAlertHub: publishes alert and matches audience", async () => {
  // Clear any existing alerts
  liveAlertHub.dismissAlert();

  const publishResult = await liveAlertHub.publishLiveAlert({
    alertId: "TEST_ALERT_1",
    title: "حصة الرياضيات المباشرة",
    body: "بدأت الحصة الآن",
    level: "السنة الثانية ثانوي",
    subject: "MATH",
    targetStudentIds: ["student-123"],
    parentPhones: ["0779036171"],
    targetUrl: "/student-live.html?test=1",
    durationMs: 60000,
  });

  assert.strictEqual(publishResult.success, true);
  assert.strictEqual(publishResult.alertId, "TEST_ALERT_1");

  // 1. Matching by normalized Algerian phone number (+213779036171 vs 0779036171)
  let mockRes1 = null;
  liveAlertHub.checkActiveAlert(
    { query: { phone: "+213779036171", studentId: "", level: "2AS" } },
    { json: (data) => { mockRes1 = data; } }
  );
  assert.strictEqual(mockRes1.active, true);
  assert.strictEqual(mockRes1.alert.title, "حصة الرياضيات المباشرة");

  // 2. Matching by student ID
  let mockRes2 = null;
  liveAlertHub.checkActiveAlert(
    { query: { phone: "", studentId: "student-123", level: "" } },
    { json: (data) => { mockRes2 = data; } }
  );
  assert.strictEqual(mockRes2.active, true);

  // 3. Non-targeted student should NOT match when targeted student list is provided
  let mockRes3 = null;
  liveAlertHub.checkActiveAlert(
    { query: { phone: "0550000000", studentId: "other-student-999", level: "2AS" } },
    { json: (data) => { mockRes3 = data; } }
  );
  assert.strictEqual(mockRes3.active, false);

  // 4. Acknowledging alert
  let ackRes = null;
  liveAlertHub.acknowledgeAlert(
    { body: { alertId: "TEST_ALERT_1", phone: "0779036171", studentId: "student-123" } },
    { json: (data) => { ackRes = data; } }
  );
  assert.strictEqual(ackRes.ok, true);

  // 5. Dismiss alert
  liveAlertHub.dismissAlert("TEST_ALERT_1");
  let mockRes4 = null;
  liveAlertHub.checkActiveAlert(
    { query: { phone: "0779036171", studentId: "student-123", level: "2AS" } },
    { json: (data) => { mockRes4 = data; } }
  );
  assert.strictEqual(mockRes4.active, false);

  // 6. Broadcast class alert: should be received by phone even if credentials are not yet saved (empty phone/studentId)
  await liveAlertHub.publishLiveAlert({
    alertId: "BROADCAST_ALERT_1",
    title: "حصة مباشرة لجميع التلاميذ",
    body: "انطلقت الحصة الآن",
    level: "2AS,3AS",
    targetMode: "ALL",
    targetStudentIds: ["s1", "s2", "s3", "s4", "s5", "s6"],
  });

  let mockRes5 = null;
  liveAlertHub.checkActiveAlert(
    { query: { phone: "", studentId: "", level: "2AS" } },
    { json: (data) => { mockRes5 = data; } }
  );
  assert.strictEqual(mockRes5.active, true);
  assert.strictEqual(mockRes5.alert.alertId, "BROADCAST_ALERT_1");

  // Clean up
  liveAlertHub.dismissAlert("BROADCAST_ALERT_1");
});
