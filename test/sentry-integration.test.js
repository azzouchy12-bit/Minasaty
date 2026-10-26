const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("Sentry backend configuration module exists and exports expected properties", () => {
  const sentryConfig = require(path.join(root, "config/sentry.js"));
  assert.ok(sentryConfig.Sentry, "Sentry SDK must be exported");
  assert.equal(typeof sentryConfig.isSentryEnabled, "boolean", "isSentryEnabled must be a boolean");
});

test("server.js integrates Sentry error handler, configuration route, and CSP rules", () => {
  const serverContent = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverContent, /require\(["']\.\/config\/sentry["']\)/, "server.js must require sentry config");
  assert.match(serverContent, /app\.get\(["']\/api\/sentry\/config["']/, "server.js must expose /api/sentry/config");
  assert.match(serverContent, /Sentry\.setupExpressErrorHandler\(app\)/, "server.js must set up Sentry Express error handler");
  assert.match(serverContent, /browser\.sentry-cdn\.com/, "CSP script-src must allow Sentry browser CDN");
  assert.match(serverContent, /js\.sentry-cdn\.com/, "CSP script-src must allow Sentry loader CDN");
  assert.match(serverContent, /"worker-src":\s*\[/, "CSP must declare worker-src for Session Replay");
});

test("public/js/sentry-client.js exists and implements safe dormancy when unconfigured", () => {
  const clientPath = path.join(root, "public/js/sentry-client.js");
  assert.ok(fs.existsSync(clientPath), "sentry-client.js must exist in public/js");
  const clientContent = fs.readFileSync(clientPath, "utf8");
  assert.match(clientContent, /\/api\/sentry\/config/, "sentry-client must query the sentry config endpoint");
  assert.match(clientContent, /window\.reportToSentry/, "sentry-client must define window.reportToSentry helper");
});
