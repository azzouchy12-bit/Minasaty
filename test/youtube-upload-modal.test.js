const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const HTML_FILE = path.join(ROOT, "public", "teacher-live.html");
const CSS_FILE = path.join(ROOT, "public", "css", "studio-modern.css");
const JS_FILE = path.join(ROOT, "public", "js", "teacher-live-v2.js");

test("teacher-live.html includes YouTube Live Upload HUD modal and floating badge", () => {
  const content = fs.readFileSync(HTML_FILE, "utf8");

  assert.ok(content.includes('id="recording-ready-modal"'), "recording-ready-modal must exist");
  assert.ok(content.includes('class="recording-ready-card youtube-upload-dialog"'), "modal must have youtube-upload-dialog class");
  assert.ok(content.includes('id="youtube-modal-progressbar"'), "progressbar must exist");
  assert.ok(content.includes('id="youtube-modal-percent"'), "percent metric must exist");
  assert.ok(content.includes('id="youtube-modal-bytes"'), "bytes metric must exist");
  assert.ok(content.includes('id="youtube-modal-speed"'), "speed metric must exist");
  assert.ok(content.includes('id="youtube-modal-eta"'), "ETA metric must exist");
  assert.ok(content.includes('id="youtube-modal-alert-box"'), "alert box must exist");
  assert.ok(content.includes('id="youtube-modal-minimize-btn"'), "minimize button must exist");
  assert.ok(content.includes('id="youtube-view-video-btn"'), "view video button must exist");
  assert.ok(content.includes('id="youtube-minimized-badge"'), "floating minimized badge must exist");
  assert.ok(content.includes('src="./js/teacher-live-v2.js?v=yt-live-hud-1"'), "teacher-live-v2.js must have cache-busting v=yt-live-hud-1");
});

test("studio-modern.css includes rich styling for YouTube Live Upload HUD and minimized badge", () => {
  const css = fs.readFileSync(CSS_FILE, "utf8");

  assert.ok(css.includes(".youtube-upload-dialog"), "youtube-upload-dialog class must be styled");
  assert.ok(css.includes(".youtube-progress-track"), "youtube-progress-track must be styled");
  assert.ok(css.includes(".youtube-progress-fill"), "youtube-progress-fill must be styled");
  assert.ok(css.includes(".youtube-stats-grid"), "youtube-stats-grid must be styled");
  assert.ok(css.includes(".youtube-minimized-badge"), "youtube-minimized-badge must be styled");
  assert.ok(css.includes(".minimized-badge-pulse"), "pulse animation for badge must exist");
});

test("teacher-live-v2.js implements beforeunload protection, audio chime, desktop notification, and stats calculation", () => {
  const js = fs.readFileSync(JS_FILE, "utf8");

  assert.ok(js.includes("function setUploadBeforeUnloadProtection"), "setUploadBeforeUnloadProtection function must exist");
  assert.ok(js.includes("beforeunload"), "beforeunload event listener must be used");
  assert.ok(js.includes("function playUploadSuccessChime"), "playUploadSuccessChime function must exist");
  assert.ok(js.includes("function showUploadDesktopNotification"), "showUploadDesktopNotification function must exist");
  assert.ok(js.includes("function minimizeYoutubeUploadModal"), "minimizeYoutubeUploadModal function must exist");
  assert.ok(js.includes("function expandYoutubeUploadModal"), "expandYoutubeUploadModal function must exist");
  assert.ok(js.includes("formatBytesToHuman"), "formatBytesToHuman helper must exist");
  assert.ok(js.includes("speedBps"), "directPutToGoogle must calculate speedBps");
  assert.ok(js.includes("remainingSec"), "directPutToGoogle must calculate remainingSec");
});
