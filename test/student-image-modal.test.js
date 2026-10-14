const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const studentHtml = fs.readFileSync(path.join(root, "public", "student-live.html"), "utf8");
const studentJs = fs.readFileSync(path.join(root, "public", "js", "student-live.js"), "utf8");

test("student-live.html includes the mobile student image preview and zoom modal with red close button and download button", () => {
  assert.match(studentHtml, /id="student-image-modal"/, "Modal container #student-image-modal must exist");
  assert.match(studentHtml, /id="student-image-backdrop"/, "Backdrop #student-image-backdrop must exist");
  assert.match(studentHtml, /id="student-image-dialog"/, "Dialog #student-image-dialog must exist");

  // Red close button 'X'
  assert.match(studentHtml, /id="close-image-modal-btn"/, "Close button #close-image-modal-btn must exist");
  assert.match(studentHtml, /class="student-image-close-btn"/, "Close button class .student-image-close-btn must exist");

  // Download button beside X
  assert.match(studentHtml, /id="download-image-modal-btn"/, "Download button #download-image-modal-btn must exist");
  assert.match(studentHtml, /class="student-image-download-btn"/, "Download button class .student-image-download-btn must exist");
  assert.match(studentHtml, /تحميل الصورة/, "Download button text 'تحميل الصورة' must exist");

  // Zoom controls
  assert.match(studentHtml, /id="zoom-in-image-btn"/, "Zoom in button #zoom-in-image-btn must exist");
  assert.match(studentHtml, /id="zoom-out-image-btn"/, "Zoom out button #zoom-out-image-btn must exist");
  assert.match(studentHtml, /id="zoom-reset-image-btn"/, "Zoom reset button #zoom-reset-image-btn must exist");
  assert.match(studentHtml, /id="zoom-level-indicator"/, "Zoom level indicator #zoom-level-indicator must exist");

  // Stage and image
  assert.match(studentHtml, /id="student-image-stage"/, "Image stage #student-image-stage must exist");
  assert.match(studentHtml, /id="student-image-wrapper"/, "Image wrapper #student-image-wrapper must exist");
  assert.match(studentHtml, /id="student-image-modal-img"/, "Image preview element #student-image-modal-img must exist");
});

test("student-live.html CSS includes distinct red styling for close button and hides card download link on mobile", () => {
  // Red close button style
  assert.match(studentHtml, /\.student-image-close-btn\s*\{[\s\S]*?background:\s*#dc2626/i, "Close button must have red background (#dc2626)");

  // Modal styling with high z-index
  assert.match(studentHtml, /\.student-image-modal\s*\{[\s\S]*?z-index:\s*2147483646/i, "Modal must have safe high z-index");

  // Responsive rule hiding card download button on mobile (relocated to modal)
  assert.match(studentHtml, /@media\s*\(max-width:\s*900px\)\s*\{\s*\.student-chat-image-card\s+\.student-chat-image-download\s*\{\s*display:\s*none\s*!important;/, "Mobile rule must hide card download button on mobile");
  assert.match(studentHtml, /\.student-desktop-mode\s+\.student-chat-image-card\s+\.student-chat-image-download\s*\{\s*display:\s*inline-flex\s*!important;/, "Desktop mode must preserve card download button");
});

test("student-live.js implements image modal lifecycle, zoom controls, download, and preserves desktop behavior", () => {
  assert.match(studentJs, /function openStudentImageModal\(/, "openStudentImageModal must exist");
  assert.match(studentJs, /function closeStudentImageModal\(/, "closeStudentImageModal must exist");
  assert.match(studentJs, /function downloadStudentModalImage\(/, "downloadStudentModalImage must exist");
  assert.match(studentJs, /function zoomInStudentImage\(/, "zoomInStudentImage must exist");
  assert.match(studentJs, /function zoomOutStudentImage\(/, "zoomOutStudentImage must exist");
  assert.match(studentJs, /function resetStudentImageZoom\(/, "resetStudentImageZoom must exist");
  assert.match(studentJs, /function initializeStudentImageModal\(/, "initializeStudentImageModal must exist");

  // Verify closeStudentImageModal stops propagation so stream is never affected
  assert.match(studentJs, /event\.stopPropagation\(\)/, "Event propagation must be stopped");

  // Verify desktop view branch vs mobile branch
  assert.match(studentJs, /if\s*\(isDesktopStudentView\(\)\)\s*\{[\s\S]*?openChatLinkInSeparateView\(event,\s*imageUrl\);[\s\S]*?\}\s*else\s*\{[\s\S]*?openStudentImageModal\(/, "Desktop view must preserve openChatLinkInSeparateView while mobile view opens openStudentImageModal");

  // Verify initialization and cleanup
  assert.match(studentJs, /initializeStudentImageModal\(\);/, "initializeStudentImageModal must be called on setup");
  assert.match(studentJs, /closeStudentImageModal\(\);/, "closeStudentImageModal must be called on pagehide");
});

test("student-live image modal download button uses native anchor and supports Android app bridge", () => {
  // Download button is an anchor tag for direct browser file saving
  assert.match(studentHtml, /<a\s+id="download-image-modal-btn"[^>]*download=""/, "Download button must be an anchor tag with download attribute");

  // openStudentImageModal pre-populates downloadBtn href and download attributes
  assert.match(studentJs, /downloadBtn\.href\s*=\s*resolvedDirectUrl/, "openStudentImageModal must set downloadBtn.href");
  assert.match(studentJs, /downloadBtn\.download\s*=\s*downloadName/, "openStudentImageModal must set downloadBtn.download");

  // downloadStudentModalImage integrates with Android app native bridge (openExternalUrl)
  assert.match(studentJs, /nativeBridge\.openExternalUrl\(directUrl\)/, "downloadStudentModalImage must call nativeBridge.openExternalUrl for Android app");
});
