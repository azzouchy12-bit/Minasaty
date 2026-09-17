const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const teacherLiveFile = path.join(root, "public/js/teacher-live-v2.js");

test("teacher live recording uses memory-efficient IndexedDB chunk caching and optimized bitrate", () => {
  const code = fs.readFileSync(teacherLiveFile, "utf8");

  // Optimal bitrate to prevent V8 heap explosion and WebRTC audio stuttering
  assert.match(code, /OPTIMAL_RECORDING_VIDEO_BITRATE\s*=\s*3_500_000/, "optimal recording bitrate must be 3.5Mbps");

  // IndexedDB chunk caching methods
  assert.match(code, /function getRecordingDb\s*\(/, "must implement getRecordingDb helper");
  assert.match(code, /async function clearRecordingDb\s*\(/, "must implement clearRecordingDb helper");
  assert.match(code, /async function saveRecordingChunkToStorage\s*\(/, "must implement saveRecordingChunkToStorage helper");
  assert.match(code, /async function retrieveRecordingChunksFromStorage\s*\(/, "must implement retrieveRecordingChunksFromStorage helper");

  // Zero-copy direct hardware track pass-through in build1080pRecordingVideoTrack
  assert.match(code, /isDirectCandidate/, "must check for direct hardware track eligibility");
  assert.match(code, /localRecordingVideoTrack\s*=\s*sourceTrack/, "must pass sourceTrack directly when eligible");

  // Safe resource disposal without terminating live screen share
  assert.match(code, /localRecordingVideoTrack\s*!==\s*screenStream\?\.getVideoTracks/, "dispose must not stop screenStream");

  // Extended ICE grace period to prevent false positive student disconnects
  assert.match(code, /ICE_DISCONNECT_GRACE_MS\s*=\s*15_000/, "ICE grace period must be 15 seconds");

  // Chat DOM pruning
  assert.match(code, /elements\.chatBox\.children\.length\s*>\s*200/, "must prune chatBox children when exceeding 200");
});
