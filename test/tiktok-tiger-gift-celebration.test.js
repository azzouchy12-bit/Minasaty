"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("TikTok Tiger Gift: Video asset is deployed to public/assets/tiger-gift.mp4", () => {
  const videoPath = path.join(root, "public/assets/tiger-gift.mp4");
  assert.ok(fs.existsSync(videoPath), "public/assets/tiger-gift.mp4 must exist");
  const stat = fs.statSync(videoPath);
  assert.ok(stat.size > 1000000, "tiger-gift.mp4 must have valid video content (> 1MB)");
});

test("TikTok Tiger Gift: server.js defines tiger reaction with 10 points and targets celebration only to awarded student", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverCode, /"tiger"/, "server.js must include 'tiger' in VALID_REACTIONS");
  assert.match(serverCode, /tiger:\s*10/, "server.js must assign 10 points to tiger reaction");
  assert.match(serverCode, /tigerCount:\s*counts\.tiger/, "server.js must expose tigerCount in updatePayload");
  assert.match(serverCode, /tiktok_gift_celebration/, "server.js must emit tiktok_gift_celebration");
  assert.doesNotMatch(serverCode, /io\.to\(level\)\.emit\("tiktok_gift_celebration"/, "server.js must NOT broadcast tiktok_gift_celebration room-wide");
});

test("TikTok Tiger Gift: Teacher Live desktop studio leaves teacher screen clean (no celebration video overlay)", () => {
  const html = fs.readFileSync(path.join(root, "public/teacher-live.html"), "utf8");
  assert.match(html, /\.points-tiger/, "teacher-live.html must style points-tiger badge");

  const js = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  assert.match(js, /key:\s*"tiger"/, "teacher-live-v2.js must include tiger in reaction lists");
  assert.doesNotMatch(js, /triggerTigerTikTokCelebration\(\{ studentName: studentSender/, "teacher-live-v2.js must NOT trigger video on reaction click");
  assert.doesNotMatch(js, /socket\.on\("tiktok_gift_celebration"/, "teacher-live-v2.js must NOT listen to tiktok_gift_celebration");
});

test("TikTok Tiger Gift: Teacher Mobile studio leaves teacher screen clean (no celebration video overlay)", () => {
  const css = fs.readFileSync(path.join(root, "public/css/teacher-mobile.css"), "utf8");
  assert.match(css, /\.points-tiger/, "teacher-mobile.css must style points-tiger badge");

  const js = fs.readFileSync(path.join(root, "public/js/teacher-live-mobile.js"), "utf8");
  assert.match(js, /key:\s*"tiger"/, "teacher-live-mobile.js must include tiger reaction");
  assert.doesNotMatch(js, /triggerTigerTikTokCelebration\(\{ studentName: studentSender/, "teacher-live-mobile.js must NOT trigger video on reaction click");
  assert.doesNotMatch(js, /socket\.on\("tiktok_gift_celebration"/, "teacher-live-mobile.js must NOT listen to tiktok_gift_celebration");
});

test("TikTok Tiger Gift: Student Live UI and JS render celebration exclusively for awarded student without subtitle", () => {
  const html = fs.readFileSync(path.join(root, "public/student-live.html"), "utf8");
  assert.match(html, /\.tiktok-gift-overlay/, "student-live.html must define tiktok-gift-overlay");
  assert.match(html, /\.tiktok-gift-video/, "student-live.html must define tiktok-gift-video");
  assert.match(html, /mask-image:\s*linear-gradient/, "student-live.html must apply gradient mask for transparent top and dark bottom");
  assert.match(html, /\.tiktok-gift-badge/, "student-live.html must style TikTok gift reward badge");

  const js = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  assert.match(js, /key:\s*"tiger"/, "student-live.js must include tiger in STUDENT_REACTIONS_CONFIG");
  assert.match(js, /triggerTigerTikTokCelebration/, "student-live.js must define triggerTigerTikTokCelebration");
  assert.match(js, /\/assets\/tiger-gift\.mp4/, "student-live.js must play /assets/tiger-gift.mp4");
  assert.match(js, /if\s*\(!isTargetStudent\)\s*return/, "student-live.js must guard celebration for target student only");
  assert.doesNotMatch(js, /مكافأة الأستاذ الحماسية للبث المباشر/, "student-live.js must remove subtitle sentence");
});

test("TikTok Tiger Gift: Attendance and Academic controllers aggregate tigerCount", () => {
  const attendanceCode = fs.readFileSync(path.join(root, "controllers/attendanceController.js"), "utf8");
  assert.match(attendanceCode, /tigerCount:\s*reactionPoints\.filter/, "attendanceController must calculate tigerCount");

  const academicCode = fs.readFileSync(path.join(root, "controllers/academicController.js"), "utf8");
  assert.match(academicCode, /tigerCount:\s*reactionPoints\.filter/, "academicController must calculate tigerCount");
});
