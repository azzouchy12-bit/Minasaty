const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("teacher-live.html includes resync stream and fix echo buttons in floating toolbar", () => {
  const htmlPath = path.join(__dirname, "..", "public", "teacher-live.html");
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /id="resync-stream-btn"/, "resync-stream-btn must exist");
  assert.match(html, /id="fix-echo-btn"/, "fix-echo-btn must exist");
  assert.match(html, /class="[^"]*studio-button\s+resync-stream[^"]*"/, "resync-stream class must exist");
  assert.match(html, /class="[^"]*studio-button\s+fix-echo[^"]*"/, "fix-echo class must exist");
  assert.match(html, /تحديث البث والصوت/, "resync button Arabic text must exist");
  assert.match(html, /إلغاء الصدى/, "fix echo button Arabic text must exist");
  assert.match(html, /\.attendee-resync-btn/, "attendee-resync-btn CSS must be defined");
});

test("studio-modern.css includes styling for resync stream, fix echo, and attendee resync button", () => {
  const cssPath = path.join(__dirname, "..", "public", "css", "studio-modern.css");
  const css = fs.readFileSync(cssPath, "utf8");

  assert.match(css, /\.studio-button\.resync-stream/, "studio-button.resync-stream CSS must be styled");
  assert.match(css, /\.studio-button\.fix-echo/, "studio-button.fix-echo CSS must be styled");
  assert.match(css, /\.attendee-resync-btn/, "attendee-resync-btn CSS must be styled");
});

test("teacher-live-v2.js implements resynchronization and echo elimination without interrupting local recording", () => {
  const jsPath = path.join(__dirname, "..", "public", "js", "teacher-live-v2.js");
  const js = fs.readFileSync(jsPath, "utf8");

  // Elements bound
  assert.match(js, /resyncStreamButton:\s*document\.getElementById\("resync-stream-btn"\)/);
  assert.match(js, /fixEchoButton:\s*document\.getElementById\("fix-echo-btn"\)/);

  // Core functions implemented
  assert.match(js, /async function resyncClassroomAudioAndStream\(\)/);
  assert.match(js, /async function fixClassroomEcho\(\)/);
  assert.match(js, /async function resyncSingleStudent\(socketId,\s*button\)/);
  assert.match(js, /function syncStudentResyncButton\(attendee,\s*socketId\)/);

  // Force option on createAndSendOffer
  assert.match(js, /async function createAndSendOffer\(studentSocketId,\s*\{\s*iceRestart\s*=\s*false,\s*force\s*=\s*false,\s*renegotiate\s*=\s*false\s*\}\s*=\s*\{\}\)/);

  // Zero-cut recording verification: resync functions must NOT stop local recording
  const resyncFnMatch = js.match(/async function resyncClassroomAudioAndStream\(\)[\s\S]*?finally/);
  assert.ok(resyncFnMatch, "resyncClassroomAudioAndStream body must be extracted");
  assert.doesNotMatch(resyncFnMatch[0], /stopLocalRecording/, "resync must never call stopLocalRecording");
  assert.doesNotMatch(resyncFnMatch[0], /localMediaRecorder\.stop/, "resync must never stop localMediaRecorder");

  const echoFnMatch = js.match(/async function fixClassroomEcho\(\)[\s\S]*?finally/);
  assert.ok(echoFnMatch, "fixClassroomEcho body must be extracted");
  assert.doesNotMatch(echoFnMatch[0], /stopLocalRecording/, "fix echo must never call stopLocalRecording");
  assert.doesNotMatch(echoFnMatch[0], /localMediaRecorder\.stop/, "fix echo must never stop localMediaRecorder");

  // Event listeners bound
  assert.match(js, /elements\.resyncStreamButton\?\.addEventListener\("click",\s*\(\)\s*=>\s*void resyncClassroomAudioAndStream\(\)\)/);
  assert.match(js, /elements\.fixEchoButton\?\.addEventListener\("click",\s*\(\)\s*=>\s*void fixClassroomEcho\(\)\)/);
});

test("server.js defines teacher_force_resync and teacher_force_resync_student handlers", () => {
  const serverPath = path.join(__dirname, "..", "server.js");
  const serverJs = fs.readFileSync(serverPath, "utf8");

  assert.match(serverJs, /socket\.on\("teacher_force_resync",/);
  assert.match(serverJs, /socket\.to\(level\)\.emit\("classroom_force_resync",/);
  assert.match(serverJs, /socket\.on\("teacher_force_resync_student",/);
  assert.match(serverJs, /io\.to\(targetSocketId\)\.emit\("classroom_force_resync",/);
});

test("student-live.js handles classroom_force_resync without crash", () => {
  const studentPath = path.join(__dirname, "..", "public", "js", "student-live.js");
  const studentJs = fs.readFileSync(studentPath, "utf8");

  assert.match(studentJs, /socket\.on\("classroom_force_resync",/);
  assert.match(studentJs, /elements\.remoteVideo\.play\(\)/);
});

test("student-live.js reloads page completely when teacher triggers resync/reload", () => {
  const studentPath = path.join(__dirname, "..", "public", "js", "student-live.js");
  const studentJs = fs.readFileSync(studentPath, "utf8");

  assert.match(studentJs, /socket\.on\("classroom_force_reload",/);
  assert.match(studentJs, /window\.location\.reload\(\)/);
});

test("teacher UI displays student internet strength percentage and actions row", () => {
  const v2Path = path.join(__dirname, "..", "public", "js", "teacher-live-v2.js");
  const v2Js = fs.readFileSync(v2Path, "utf8");
  const cssPath = path.join(__dirname, "..", "public", "css", "studio-modern.css");
  const css = fs.readFileSync(cssPath, "utf8");

  // Percent badge and actions row
  assert.match(v2Js, /attendee-net-percent/);
  assert.match(v2Js, /netBadge\.textContent = `\$\{netPercent\}%`;/);
  assert.match(v2Js, /attendee-actions-row/);

  // CSS exists
  assert.match(css, /\.attendee-net-percent/);
  assert.match(css, /\.attendee-actions-row/);
});

test("fixClassroomEcho does not mute student microphones automatically", () => {
  const v2Path = path.join(__dirname, "..", "public", "js", "teacher-live-v2.js");
  const v2Js = fs.readFileSync(v2Path, "utf8");

  const echoFnMatch = v2Js.match(/async function fixClassroomEcho\(\)[\s\S]*?finally/);
  assert.ok(echoFnMatch, "fixClassroomEcho body must exist");
  assert.doesNotMatch(echoFnMatch[0], /muteAllStudentsMicrophones/, "fixClassroomEcho must never mute student microphones");
});

test("teacher audio plays automatically and enable-audio-btn is hidden without forcing user click", () => {
  const studentPath = path.join(__dirname, "..", "public", "js", "student-live.js");
  const studentJs = fs.readFileSync(studentPath, "utf8");
  const htmlPath = path.join(__dirname, "..", "public", "student-live.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const portraitCssPath = path.join(__dirname, "..", "public", "css", "student-portrait.css");
  const portraitCss = fs.readFileSync(portraitCssPath, "utf8");

  // Audio button is permanently hidden in HTML, JS and CSS
  assert.match(html, /id="enable-audio-btn"[^>]*style="display:\s*none\s*!important;"/);
  assert.match(portraitCss, /body\.student-live-page \.remote-audio-toggle\s*\{[\s\S]*?display:\s*none\s*!important;/);
  assert.match(studentJs, /elements\.enableAudioButton\.hidden = true;/);

  // Video remains muted; the dedicated audio element carries teacher sound
  assert.match(html, /<video id="remote-video"\s+autoplay\s+muted\s+playsinline/);
  assert.match(html, /<audio id="teacher-live-audio"\s+autoplay\s+playsinline/);

  // Audio auto-unmute is implemented on first interaction
  assert.match(studentJs, /armAutoUnmuteOnFirstInteraction/);
  assert.match(studentJs, /elements\.remoteVideo\.muted = true/);
  assert.match(studentJs, /audioEl\.muted = false/);
});


