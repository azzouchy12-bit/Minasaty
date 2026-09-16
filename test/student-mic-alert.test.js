const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("mic-alert sound file exists and is a valid 0.5-second WAV", () => {
  const soundPath = path.join(root, "public/sounds/mic-alert.wav");
  assert.ok(fs.existsSync(soundPath), "mic-alert.wav must exist in public/sounds");

  const buf = fs.readFileSync(soundPath);
  assert.ok(buf.length > 44, "File must have at least WAV header");
  assert.equal(buf.toString("ascii", 0, 4), "RIFF", "Header should be RIFF");
  assert.equal(buf.toString("ascii", 8, 12), "WAVE", "Header should be WAVE");

  const sampleRate = buf.readUInt32LE(24);
  const dataSize = buf.readUInt32LE(40);
  const bytesPerSample = buf.readUInt16LE(34) / 8;
  const numChannels = buf.readUInt16LE(22);
  const duration = dataSize / (sampleRate * bytesPerSample * numChannels);

  assert.equal(sampleRate, 44100, "Sample rate should be 44.1kHz");
  assert.equal(numChannels, 1, "Should be mono audio");
  assert.ok(Math.abs(duration - 0.5) < 0.01, `Duration must be ~0.5s, got ${duration}s`);
});

test("student-live.js implements playMicOpenedAlert and connects it to permission_granted", () => {
  const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

  // Verify playMicOpenedAlert function exists
  assert.match(studentLive, /function playMicOpenedAlert\(\)\s*\{/);

  // Verify Web Audio 0.5 second ring synthesis
  assert.match(studentLive, /const totalEnd = now \+ 0\.50;/);
  assert.match(studentLive, /linearRampToValueAtTime\(0, totalEnd\)/);

  // Verify unlock on user gesture
  assert.match(studentLive, /unlockMicAlertAudio/);

  // Verify fallback to mic-alert.wav
  assert.match(studentLive, /mic-alert\.wav/);

  // Verify permission_granted calls playMicOpenedAlert
  assert.match(studentLive, /socket\.on\("permission_granted",\s*async\s*\(\)\s*=>\s*\{[\s\S]*?playMicOpenedAlert\(\);/);
});

test("public/student-live.html includes cache-busted student-live.js script tag", () => {
  const html = fs.readFileSync(path.join(root, "public/student-live.html"), "utf8");
  assert.match(html, /student-live\.js\?v=mic-alert-ring-1/);
});
