const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("plane-button-animation stylesheet and javascript helper exist and define 3D micro-interactions", () => {
  const cssPath = path.join(root, "public", "css", "plane-button-animation.css");
  const jsPath = path.join(root, "public", "js", "plane-button-animation.js");

  assert.ok(fs.existsSync(cssPath), "plane-button-animation.css must exist");
  assert.ok(fs.existsSync(jsPath), "plane-button-animation.js must exist");

  const css = fs.readFileSync(cssPath, "utf8");
  assert.match(css, /\.btn-plane-interactive/);
  assert.match(css, /@keyframes planeOrigamiTakeoff/);
  assert.match(css, /\.plane-flying-icon/);

  const js = fs.readFileSync(jsPath, "utf8");
  assert.match(js, /PlaneButtonAnim/);
  assert.match(js, /triggerPlaneAnimation/);
});

test("student-live.html includes plane button animation assets and interactive chat send buttons", () => {
  const html = fs.readFileSync(path.join(root, "public", "student-live.html"), "utf8");
  assert.match(html, /plane-button-animation\.css/);
  assert.match(html, /plane-button-animation\.js/);
  assert.match(html, /id="chat-send-btn"[^>]*btn-plane-interactive/);
  assert.match(html, /id="open-chat-compose-btn"[^>]*btn-plane-interactive/);

  const js = fs.readFileSync(path.join(root, "public", "js", "student-live.js"), "utf8");
  assert.match(js, /PlaneButtonAnim\.trigger/);
});

test("parent-dashboard.html includes plane button animation assets and interactive subscription buttons", () => {
  const html = fs.readFileSync(path.join(root, "public", "parent-dashboard.html"), "utf8");
  assert.match(html, /plane-button-animation\.css/);
  assert.match(html, /plane-button-animation\.js/);
  assert.match(html, /id="secondary-upgrade-button"[^>]*btn-plane-interactive/);
  assert.match(html, /id="secondary-payment-submit"[^>]*btn-plane-interactive/);

  const js = fs.readFileSync(path.join(root, "public", "js", "parent-dashboard.js"), "utf8");
  assert.match(js, /PlaneButtonAnim\.trigger/);
});

test("student-chat.html and teacher-chat.html include plane button animation assets and interactive send buttons", () => {
  const studentHtml = fs.readFileSync(path.join(root, "public", "student-chat.html"), "utf8");
  assert.match(studentHtml, /plane-button-animation\.css/);
  assert.match(studentHtml, /plane-button-animation\.js/);
  assert.match(studentHtml, /chat-send-button[^>]*btn-plane-interactive/);

  const teacherHtml = fs.readFileSync(path.join(root, "public", "teacher-chat.html"), "utf8");
  assert.match(teacherHtml, /plane-button-animation\.css/);
  assert.match(teacherHtml, /plane-button-animation\.js/);
  assert.match(teacherHtml, /chat-send-button[^>]*btn-plane-interactive/);

  const studentJs = fs.readFileSync(path.join(root, "public", "js", "student-chat.js"), "utf8");
  assert.match(studentJs, /PlaneButtonAnim\.trigger/);

  const teacherJs = fs.readFileSync(path.join(root, "public", "js", "teacher-chat.js"), "utf8");
  assert.match(teacherJs, /PlaneButtonAnim\.trigger/);
});
