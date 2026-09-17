const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const HTML_FILE = path.join(ROOT, "public", "teacher-dashboard.html");
const CSS_FILE = path.join(ROOT, "public", "css", "app.css");
const JS_FILE = path.join(ROOT, "public", "js", "class-registry-teacher.js");
const ROUTES_FILE = path.join(ROOT, "routes", "youtubeRoutes.js");

test("teacher-dashboard.html includes YouTube device upload buttons, file input, and HUD modal", () => {
  const content = fs.readFileSync(HTML_FILE, "utf8");

  assert.ok(content.includes('id="registry-upload-video-btn"'), "registry-upload-video-btn must exist");
  assert.ok(content.includes('id="registry-video-file-input"'), "registry-video-file-input must exist");
  assert.ok(content.includes('accept="video/webm,video/mp4,video/*"'), "file input must accept webm and video files");
  assert.ok(content.includes('id="class-registry-direct-upload-btn"'), "direct upload button in class modal must exist");
  assert.ok(content.includes('id="registry-youtube-upload-modal"'), "registry-youtube-upload-modal must exist");
  assert.ok(content.includes('id="registry-upload-progressbar"'), "progressbar must exist in HUD modal");
  assert.ok(content.includes('id="registry-upload-stats-grid"'), "stats grid must exist");
  assert.ok(content.includes('id="registry-upload-speed"'), "speed metric must exist");
  assert.ok(content.includes('id="registry-upload-eta"'), "ETA metric must exist");
  assert.ok(content.includes('id="registry-upload-success-card"'), "success card must exist");
  assert.ok(content.includes('id="registry-upload-watch-btn"'), "watch button must exist");
  assert.ok(content.includes('src="./js/class-registry-teacher.js?v=registry-upload-1"'), "script must have cache-busting v=registry-upload-1");
});

test("app.css includes styling for YouTube upload button, modal, and animations", () => {
  const css = fs.readFileSync(CSS_FILE, "utf8");

  assert.ok(css.includes(".youtube-upload-button"), "youtube-upload-button class must be styled");
  assert.ok(css.includes(".registry-upload-modal-card"), "registry-upload-modal-card must be styled");
  assert.ok(css.includes(".registry-upload-progress-fill"), "registry-upload-progress-fill must be styled");
  assert.ok(css.includes(".registry-upload-stats-grid"), "registry-upload-stats-grid must be styled");
  assert.ok(css.includes(".registry-upload-success-card"), "registry-upload-success-card must be styled");
});

test("class-registry-teacher.js implements resumable upload, progress metrics, chime, and beforeunload guard", () => {
  const js = fs.readFileSync(JS_FILE, "utf8");

  assert.ok(js.includes("function directPutToGoogle"), "directPutToGoogle function must exist");
  assert.ok(js.includes("function startDirectUpload"), "startDirectUpload function must exist");
  assert.ok(js.includes("function openUploadModalForFile"), "openUploadModalForFile function must exist");
  assert.ok(js.includes("function setUploadBeforeUnloadProtection"), "setUploadBeforeUnloadProtection must exist");
  assert.ok(js.includes("function playUploadSuccessChime"), "playUploadSuccessChime must exist");
  assert.ok(js.includes("formatBytesToHuman"), "formatBytesToHuman helper must exist");
  assert.ok(js.includes("formatSpeedToHuman"), "formatSpeedToHuman helper must exist");
  assert.ok(js.includes("formatSecondsToHuman"), "formatSecondsToHuman helper must exist");
  assert.ok(js.includes("/api/youtube/resumable-session"), "resumable-session endpoint must be called");
  assert.ok(js.includes("/api/youtube/resumable-finish"), "resumable-finish endpoint must be called");
});

test("youtubeRoutes.js allows attaching video by scheduledClassId without time constraint", () => {
  const routes = fs.readFileSync(ROUTES_FILE, "utf8");

  // scheduledClassId logic must appear before the isOfficialRecordingTime check
  const classIdIndex = routes.indexOf("if (scheduledClassId)");
  const timeCheckIndex = routes.indexOf("if (!recordingParts || !isOfficialRecordingTime(timestamp)) return null;");

  assert.ok(classIdIndex !== -1, "if (scheduledClassId) must exist");
  assert.ok(timeCheckIndex !== -1, "official recording time check must exist");
  assert.ok(classIdIndex < timeCheckIndex, "scheduledClassId check must occur before official recording time check");
});
