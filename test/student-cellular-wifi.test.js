const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("student-live.js treats mobile cellular data as high-speed Wi-Fi", () => {
  const content = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

  // Verify navigator.connection override exists
  assert.ok(
    content.includes('Object.defineProperty(netConn, "type", { get: () => "wifi"') ||
    content.includes('type: "wifi"'),
    "Expected navigator.connection to be configured with wifi"
  );
  assert.ok(
    content.includes('saveData", { get: () => false') ||
    content.includes('saveData: false'),
    "Expected saveData to be configured to false"
  );

  // Verify sampleConnectionHealth always treats connection as Wi-Fi
  assert.ok(
    content.includes('connName = "Wi-Fi (5GHz)"') || content.includes('connName = "Wi-Fi"'),
    "Expected connName to be Wi-Fi"
  );
  assert.ok(
    content.includes("let isWifi = true;"),
    "Expected isWifi to be true"
  );
  assert.ok(
    content.includes("let isSim1 = false;"),
    "Expected isSim1 to be false"
  );
  // Ensure cellular is not assigned to connName
  assert.ok(
    !content.includes('connName = "بيانات الهاتف (4G)"'),
    "Should not categorize connection as mobile cellular"
  );
});

test("public/application.html treats mobile data as Wi-Fi", () => {
  const content = fs.readFileSync(path.join(root, "public/application.html"), "utf8");
  assert.ok(
    content.includes("wifiPill.classList.add('is-active')") ||
    content.includes('wifiPill.classList.add("is-active")'),
    "Expected indicator-wifi to be active"
  );
});
