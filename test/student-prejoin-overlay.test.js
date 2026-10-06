const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const studentHtml = fs.readFileSync(path.join(root, "public/student-live.html"), "utf8");
const studentJs = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
const portraitCss = fs.readFileSync(path.join(root, "public/css/student-portrait.css"), "utf8");

test("student-live.html prejoin overlay has max z-index and suppresses chat elements while active", () => {
  assert.match(studentHtml, /\.student-prejoin-overlay\s*\{[\s\S]*?z-index:\s*2147483647\s*!important/);
  assert.match(studentHtml, /id="chat-compose-modal"[^>]*hidden/);
  assert.match(studentHtml, /student-prejoin-pending #chat-compose-modal/);
  assert.match(studentHtml, /body:has\(#student-prejoin-overlay:not\(\[hidden\]\)\)\s*#chat-compose-modal/);
});

test("student-portrait.css suppresses mobile composer and controls when prejoin is pending or active", () => {
  assert.match(portraitCss, /body\.student-live-page\s*#student-prejoin-overlay\s*\{[\s\S]*?z-index:\s*2147483647\s*!important/);
  assert.match(portraitCss, /body\.student-prejoin-active\s*#chat-compose-modal/);
  assert.match(portraitCss, /body:has\(#student-prejoin-overlay:not\(\[hidden\]\)\)\s*#chat-compose-modal/);
});

test("student-live.js defines relocateStudentPrejoinOverlay and does not open chat composer during prejoin", () => {
  assert.match(studentJs, /function relocateStudentPrejoinOverlay\(\)/);
  assert.match(studentJs, /relocateStudentPrejoinOverlay\(\);/);
  assert.match(studentJs, /if\s*\(!isDesktopStudentView\(\)\s*&&\s*prejoinCompleted\)\s*openStudentChatComposer/);
});
