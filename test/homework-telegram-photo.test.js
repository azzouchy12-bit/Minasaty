"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Homework Telegram Photo: academicController defines submitHomeworkPhoto", () => {
  const controllerCode = fs.readFileSync(path.join(root, "controllers/academicController.js"), "utf8");
  assert.match(controllerCode, /async function submitHomeworkPhoto/, "academicController must define submitHomeworkPhoto");
  assert.match(controllerCode, /sendTelegramPhoto\(/, "submitHomeworkPhoto must call sendTelegramPhoto");
  assert.match(controllerCode, /حل واجب منزلي جديد/, "Caption must include homework title");
  assert.match(controllerCode, /submitHomeworkPhoto,/, "academicController must export submitHomeworkPhoto");
});

test("Homework Telegram Photo: academicRoutes registers POST /students/:studentId/homework-photo", () => {
  const routesCode = fs.readFileSync(path.join(root, "routes/academicRoutes.js"), "utf8");
  assert.match(routesCode, /submitHomeworkPhoto/, "academicRoutes must import submitHomeworkPhoto");
  assert.match(routesCode, /\/students\/:studentId\/homework-photo/, "academicRoutes must declare /students/:studentId/homework-photo route");
});

test("Homework Telegram Photo: parent-dashboard.html includes Send Homework button and modal with camera and gallery options", () => {
  const html = fs.readFileSync(path.join(root, "public/parent-dashboard.html"), "utf8");
  assert.match(html, /إرسل حل واجبك هنا \.\./, "Dashboard must have 'إرسل حل واجبك هنا ..' button");
  assert.match(html, /id="send-homework-main-btn"/, "Dashboard must have send-homework-main-btn");
  assert.match(html, /id="homework-upload-modal"/, "Dashboard must have homework-upload-modal");
  assert.match(html, /id="hw-btn-camera"/, "Modal must have camera choice button");
  assert.match(html, /id="hw-btn-gallery"/, "Modal must have gallery choice button");
  assert.match(html, /capture="environment"/, "Camera input must have capture='environment'");
  assert.match(html, /id="hw-input-gallery"/, "Modal must have gallery file input");
  assert.match(html, /id="hw-btn-submit"/, "Modal must have submit button");
});

test("Homework Telegram Photo: parent-dashboard.js initializes send homework modal and uploads to endpoint", () => {
  const js = fs.readFileSync(path.join(root, "public/js/parent-dashboard.js"), "utf8");
  assert.match(js, /function initializeSendHomeworkModal/, "parent-dashboard.js must define initializeSendHomeworkModal");
  assert.match(js, /initializeSendHomeworkModal\(\)/, "parent-dashboard.js must invoke initializeSendHomeworkModal");
  assert.match(js, /\/homework-photo/, "parent-dashboard.js must send to homework-photo endpoint");
  assert.match(js, /hw-input-camera/, "parent-dashboard.js must handle camera input");
  assert.match(js, /hw-input-gallery/, "parent-dashboard.js must handle gallery input");
});
