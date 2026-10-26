"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Live Celebration: server.js handles clap, targetUserId and celebration trigger", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverCode, /VALID_REACTIONS\s*=\s*new\s+Set\(\[[^\]]*"clap"[^\]]*\]\)/, "server.js must include 'clap' in VALID_REACTIONS");
  assert.match(serverCode, /clap:\s*5/, "server.js must define clap reaction with +5 points");
  assert.match(serverCode, /targetUserId/, "server.js must read and pass targetUserId");
  assert.match(serverCode, /student_celebration_trigger/, "server.js must emit student_celebration_trigger to target student");
  assert.match(serverCode, /classroom_chat_reaction_updated/, "server.js must broadcast reaction update to classroom");
});

test("Live Celebration: Teacher Live UI displays quick reaction buttons (🔥, ❤️, 👏)", () => {
  const html = fs.readFileSync(path.join(root, "public/teacher-live.html"), "utf8");
  assert.match(html, /\.chat-message-actions-bar/, "teacher-live.html must style quick reaction bar");
  assert.match(html, /\.chat-quick-reaction-btn/, "teacher-live.html must style quick reaction buttons");

  const js = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  assert.match(js, /chat-quick-reaction-btn/, "teacher-live-v2.js must render quick reaction buttons");
  assert.match(js, /key:\s*"fire"/, "teacher-live-v2.js must have fire quick reaction");
  assert.match(js, /key:\s*"love"/, "teacher-live-v2.js must have love quick reaction");
  assert.match(js, /key:\s*"clap"/, "teacher-live-v2.js must have clap quick reaction");
  assert.match(js, /targetUserId/, "teacher-live-v2.js must pass targetUserId in classroom_chat_react");
});

test("Live Celebration: Teacher Mobile Live supports quick reaction bar", () => {
  const css = fs.readFileSync(path.join(root, "public/css/teacher-mobile.css"), "utf8");
  assert.match(css, /\.tm-chat-actions-bar/, "teacher-mobile.css must style actions bar");
  assert.match(css, /\.tm-chat-quick-btn/, "teacher-mobile.css must style quick reaction buttons");

  const js = fs.readFileSync(path.join(root, "public/js/teacher-live-mobile.js"), "utf8");
  assert.match(js, /tm-chat-quick-btn/, "teacher-live-mobile.js must render quick reaction buttons");
  assert.match(js, /key:\s*"clap"/, "teacher-live-mobile.js must include clap");
});

test("Live Celebration: Student Live UI includes celebration overlay and canvas-confetti", () => {
  const html = fs.readFileSync(path.join(root, "public/student-live.html"), "utf8");
  assert.match(html, /id="student-celebration-container"/, "student-live.html must have #student-celebration-container");
  assert.match(html, /canvas-confetti/, "student-live.html must load canvas-confetti CDN");
  assert.match(html, /pointer-events:\s*none\s*!important/, "overlay must have pointer-events: none to avoid blocking screen");
  assert.match(html, /@keyframes celebrationPopAnim/, "student-live.html must define celebrationPopAnim animation");
  assert.match(html, /chat-message-reward-pulse/, "student-live.html must define chat-message-reward-pulse for chat comments");
});

test("Live Celebration: Student Live JS implements exclusive chime, confetti and audience separation", () => {
  const js = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  assert.match(js, /playCelebrationChime/, "student-live.js must define playCelebrationChime");
  assert.match(js, /triggerCelebrationConfetti/, "student-live.js must define triggerCelebrationConfetti");
  assert.match(js, /triggerExclusiveCelebration/, "student-live.js must define triggerExclusiveCelebration");
  assert.match(js, /socket\.on\("student_celebration_trigger"/, "student-live.js must listen for student_celebration_trigger");
  assert.match(js, /isTargetStudent/, "student-live.js must differentiate target student from other students");
});
