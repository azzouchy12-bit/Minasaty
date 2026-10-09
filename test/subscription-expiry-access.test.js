const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("parent-dashboard.html places subscription-expiry-alert above live-class-banner in DOM and CSS order", () => {
  const html = fs.readFileSync(path.join(root, "public/parent-dashboard.html"), "utf8");

  const alertIndex = html.indexOf('id="subscription-expiry-alert"');
  const bannerIndex = html.indexOf('id="live-class-banner"');

  assert.ok(alertIndex > 0, "subscription-expiry-alert must exist");
  assert.ok(bannerIndex > 0, "live-class-banner must exist");
  assert.ok(
    alertIndex < bannerIndex,
    "subscription-expiry-alert must appear BEFORE live-class-banner in HTML structure"
  );

  assert.match(html, /\.parent-dashboard-page\s+#subscription-expiry-alert\s*\{[\s\S]*?order:\s*0/);
  assert.match(html, /\.parent-dashboard-page:not\(\.has-multiple-students\)\s+#subscription-expiry-alert\s*\{[\s\S]*?order:\s*0/);
  assert.match(html, /\.parent-dashboard-page:not\(\.has-multiple-students\)\s+#live-class-banner\s*\{[\s\S]*?order:\s*1/);
  assert.match(html, /\.parent-dashboard-page\.has-multiple-students\s+#subscription-expiry-alert\s*\{[\s\S]*?order:\s*2/);
  assert.match(html, /\.parent-dashboard-page\.has-multiple-students\s+#live-class-banner\s*\{[\s\S]*?order:\s*3/);
});

test("parent-dashboard.js blocks live entry when subscription is expired and wires pay button to triggerUpgradeAccount", () => {
  const js = fs.readFileSync(path.join(root, "public/js/parent-dashboard.js"), "utf8");

  assert.match(js, /subscriptionExpiryAlertBtn:\s*document\.getElementById\("subscription-expiry-alert-btn"\)/);
  assert.match(js, /function isStudentSubscriptionExpired\s*\(/);
  assert.match(js, /function triggerUpgradeAccount\s*\(/);

  // Check that enterLiveClass blocks when expired
  assert.match(js, /async function enterLiveClass\(\)\s*\{[\s\S]*?if\s*\(isStudentSubscriptionExpired\(currentStudent\)\)/);

  // Check that openLiveClassesEntryPage blocks when expired
  assert.match(js, /function openLiveClassesEntryPage\(\)\s*\{[\s\S]*?if\s*\(isStudentSubscriptionExpired\(currentStudent\)\)/);

  // Check click wiring for the pay subscription button
  assert.match(js, /elements\.subscriptionExpiryAlertBtn\?\.addEventListener\("click",\s*\(event\)\s*=>\s*\{[\s\S]*?triggerUpgradeAccount\(\)/);

  // Check that renderSecondaryPaymentUpgrade enables upgrade when subscription is expired
  assert.match(js, /const isExpired = isStudentSubscriptionExpired\(student\);/);
  assert.match(js, /const showUpgrade = isSecondaryStudent && \(paymentStage === "UNPAID" \|\| isExpired \|\| receiptPending\);/);
});

test("server.js student_join_room checks subscriptionEndDate and rejects expired subscriptions", () => {
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");

  assert.match(serverJs, /subscriptionEndDate:\s*true/);
  assert.match(
    serverJs,
    /if\s*\(student\.subscriptionEndDate\)\s*\{[\s\S]*?if\s*\(endCalendar\.getTime\(\)\s*-\s*nowCalendar\.getTime\(\)\s*<\s*0\)[\s\S]*?انتهت فترة اشتراك التلميذ/
  );
});

test("student-live.js defines isStudentLiveSubscriptionExpired and blocks class entry with EXPIRED modal", () => {
  const liveJs = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

  assert.match(liveJs, /function isStudentLiveSubscriptionExpired\s*\(/);
  assert.match(liveJs, /isStudentLiveSubscriptionExpired\(currentStudent\.subscriptionEndDate\)/);
  assert.match(liveJs, /openSubscriptionUpgradeModal\("EXPIRED"\)/);
});
