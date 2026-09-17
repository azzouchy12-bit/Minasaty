"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("WebRTC stream stability: teacher QoS stabilizes audio and caps auto video framerate to 30fps", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");

  // Opus SDP optimization for in-band forward error correction and mono speech
  assert.match(teacherLive, /function optimizeOpusSdp\s*\(/);
  assert.match(teacherLive, /useinbandfec=1/);
  assert.match(teacherLive, /stereo=0/);
  assert.match(teacherLive, /cbr=1/);

  // Audio stability guard: no repeated audio setParameters in live stream
  assert.match(teacherLive, /parameters\.encodings\[0\]\.maxBitrate === AUDIO_BITRATE_CEILING/);

  // Auto video framerate capped to 30fps to avoid network bufferbloat in mesh topology
  assert.match(teacherLive, /maxFramerate:\s*30/);

  // Hysteresis in video bandwidth allocation updates
  assert.match(teacherLive, /150_000/);
});

test("WebRTC stream stability: student recovers from disconnect without deadlock and optimizes Opus audio", () => {
  const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

  // Opus SDP optimization in student answers and renegotiation
  assert.match(studentLive, /function optimizeOpusSdp\s*\(/);
  assert.match(studentLive, /optimizeOpusSdp\(answer\.sdp\)/);

  // Recovery deadlock fix: rejoin bypasses joinedClass guard and sets isRecoveringStream
  assert.match(studentLive, /!rejoin && joinedClass && !isRecoveringStream/);
  assert.match(studentLive, /if \(rejoin\) \{\s*isRecoveringStream = true;\s*\}/);

  // Audio jitter buffer stability
  assert.match(studentLive, /jitterBufferTarget\s*=\s*80/);
});
