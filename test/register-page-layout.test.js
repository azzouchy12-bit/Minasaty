const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const appCss = fs.readFileSync(path.join(root, "public/css/app.css"), "utf8");
const androidAppCss = fs.readFileSync(path.join(root, "android/app/src/main/assets/public/css/app.css"), "utf8");
const registerHtml = fs.readFileSync(path.join(root, "public/register.html"), "utf8");
const registerJs = fs.readFileSync(path.join(root, "public/js/register.js"), "utf8");

test("register page layout enables dynamic vertical scrolling without fixed-screen traps", () => {
  // Verifies that neither html nor body has overflow: hidden for register-page
  assert.match(appCss, /body\.register-page\s*\{[^}]*overflow-y:\s*auto/);
  assert.doesNotMatch(appCss, /body\.register-page\s*\{[^}]*overflow:\s*hidden/);

  // Verifies auth-layout is not position: fixed and allows natural scroll
  assert.match(appCss, /\.register-page \.auth-layout\s*\{[^}]*position:\s*relative/);
  assert.doesNotMatch(appCss, /\.register-page \.auth-layout\s*\{[^}]*position:\s*fixed/);

  // Verifies auth-card does not clamp max-height to screen height with overflow hidden
  assert.match(appCss, /\.register-page \.auth-card\s*\{[^}]*max-height:\s*none/);
  assert.match(appCss, /\.register-page \.auth-card\s*\{[^}]*overflow:\s*visible/);
  assert.doesNotMatch(appCss, /\.register-page \.auth-card\s*\{[^}]*overflow:\s*hidden/);

  // Verifies stack-form does not clip children
  assert.match(appCss, /\.register-page \.stack-form\s*\{[^}]*overflow:\s*visible/);
});

test("register page styles are kept synchronized between public and android assets", () => {
  assert.match(androidAppCss, /body\.register-page\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(androidAppCss, /\.register-page \.auth-layout\s*\{[\s\S]*?position:\s*relative/);
  assert.match(androidAppCss, /\.register-page \.auth-card\s*\{[\s\S]*?max-height:\s*none/);
  assert.match(androidAppCss, /\.register-page \.auth-card\s*\{[\s\S]*?overflow:\s*visible/);
});

test("register page JS smoothly scrolls submit button into view when university student is chosen", () => {
  assert.match(registerJs, /function syncUniversityCardField\s*\(\)/);
  assert.match(registerJs, /submitBtn\?\.scrollIntoView/);
  assert.match(registerHtml, /<button id="submit-btn"/);
  assert.match(registerHtml, /<div id="university-card-field"/);
});
