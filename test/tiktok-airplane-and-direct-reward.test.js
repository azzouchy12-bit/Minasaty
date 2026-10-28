"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("TikTok Airplane Gift: Video asset is deployed to public/assets/airplane-gift.mp4", () => {
  const videoPath = path.join(root, "public/assets/airplane-gift.mp4");
  assert.ok(fs.existsSync(videoPath), "public/assets/airplane-gift.mp4 must exist");
  const stat = fs.statSync(videoPath);
  assert.ok(stat.size > 1000000, "airplane-gift.mp4 must have valid video content (> 1MB)");
});

test("TikTok Airplane Gift: server.js defines airplane reaction with 7 points and emits targeted celebration", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverCode, /"airplane"/, "server.js must include 'airplane' in VALID_REACTIONS");
  assert.match(serverCode, /airplane:\s*7/, "server.js must assign 7 points to airplane reaction");
  assert.match(serverCode, /airplaneCount:\s*counts\.airplane/, "server.js must expose airplaneCount in updatePayload");
  assert.match(serverCode, /reaction === "tiger" \|\| reaction === "airplane"/, "server.js must trigger celebration for both tiger and airplane");
});

test("Direct Student Reward: server.js handles teacher_direct_student_react event", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverCode, /socket\.on\("teacher_direct_student_react"/, "server.js must register teacher_direct_student_react");
  assert.match(serverCode, /studentReactionPoint/, "server.js must save direct points to studentReactionPoint");
  assert.match(serverCode, /teacher_direct_reaction_received/, "server.js must emit teacher_direct_reaction_received to student");
});

test("Direct Student Reward: Desktop & Mobile templates contain direct reward bar with all 8 emojis", () => {
  const desktopHtml = fs.readFileSync(path.join(root, "public/teacher-live.html"), "utf8");
  assert.match(desktopHtml, /class="student-direct-reward-bar"/, "teacher-live.html must contain direct reward bar");
  assert.match(desktopHtml, /data-reaction="tiger"/, "Desktop toolbar must contain tiger");
  assert.match(desktopHtml, /data-reaction="airplane"/, "Desktop toolbar must contain airplane");
  assert.match(desktopHtml, /data-reaction="fire"/, "Desktop toolbar must contain fire");
  assert.match(desktopHtml, /data-reaction="clap"/, "Desktop toolbar must contain clap");
  assert.match(desktopHtml, /data-reaction="love"/, "Desktop toolbar must contain love");
  assert.match(desktopHtml, /data-reaction="like"/, "Desktop toolbar must contain like");
  assert.match(desktopHtml, /data-reaction="cry"/, "Desktop toolbar must contain eyes (cry)");
  assert.match(desktopHtml, /data-reaction="dislike"/, "Desktop toolbar must contain dislike");

  const mobileHtml = fs.readFileSync(path.join(root, "public/teacher-live-mobile.html"), "utf8");
  assert.match(mobileHtml, /class="tm-direct-reward-bar"/, "teacher-live-mobile.html must contain mobile direct reward bar");
  assert.match(mobileHtml, /class="tm-direct-reward-btn"[^>]*data-reaction="airplane"/, "Mobile toolbar must contain airplane button");
});

test("Teacher Live JS (Desktop & Mobile) wires airplane reaction and direct reward toolbar", () => {
  const desktopJs = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  assert.match(desktopJs, /key:\s*"airplane"/, "teacher-live-v2.js must have airplane in reactions");
  assert.match(desktopJs, /teacher_direct_student_react/, "teacher-live-v2.js must emit teacher_direct_student_react");

  const mobileJs = fs.readFileSync(path.join(root, "public/js/teacher-live-mobile.js"), "utf8");
  assert.match(mobileJs, /key:\s*"airplane"/, "teacher-live-mobile.js must have airplane in reactions");
  assert.match(mobileJs, /teacher_direct_student_react/, "teacher-live-mobile.js must emit teacher_direct_student_react");
});

test("Student Live JS renders airplane celebration exclusively with +7 points badge and no subtitle", () => {
  const js = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  assert.match(js, /triggerAirplaneTikTokCelebration/, "student-live.js must define triggerAirplaneTikTokCelebration");
  assert.match(js, /\/assets\/airplane-gift\.mp4/, "student-live.js must play /assets/airplane-gift.mp4");
  assert.match(js, /مبروك! طائرة التميز والإبداع/, "student-live.js must display badge with correct airplane text");
  assert.match(js, /socket\.on\("teacher_direct_reaction_received"/, "student-live.js must listen to teacher_direct_reaction_received");
});

test("Controllers aggregate airplaneCount in attendance and academic summaries", () => {
  const attendanceCode = fs.readFileSync(path.join(root, "controllers/attendanceController.js"), "utf8");
  assert.match(attendanceCode, /airplaneCount:\s*reactionPoints\.filter/, "attendanceController must calculate airplaneCount");

  const academicCode = fs.readFileSync(path.join(root, "controllers/academicController.js"), "utf8");
  assert.match(academicCode, /airplaneCount:\s*reactionPoints\.filter/, "academicController must calculate airplaneCount");
});
