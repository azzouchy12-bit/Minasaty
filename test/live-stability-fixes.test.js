const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const backgroundJobs = fs.readFileSync(path.join(root, "utils/backgroundJobs.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
const webrtcRoutes = fs.readFileSync(path.join(root, "routes/webrtcRoutes.js"), "utf8");

test("Railway Node process is protected against Container OOM crash with max-old-space-size", () => {
  assert.match(dockerfile, /--max-old-space-size=384/, "Dockerfile CMD must set --max-old-space-size=384");
});

test("backgroundJobs implements sequential execution with overlap lock and staggered intervals", () => {
  assert.match(backgroundJobs, /let isRunningJobs = false;/, "backgroundJobs must maintain concurrency lock");
  assert.match(backgroundJobs, /if \(isRunningJobs\) return;/, "backgroundJobs must prevent overlapping cycles");
  assert.match(backgroundJobs, /tickCount % 30 === 0/, "Weekly reports should run every 30 minutes, not every tick");
  assert.match(backgroundJobs, /tickCount % 15 === 0/, "Expired sessions should run every 15 minutes");
  assert.match(backgroundJobs, /tickCount % 5 === 0/, "SofizPay reconciliation should run every 5 minutes");
});

test("server.js preserves approved student microphone state on soft rejoin / reconnect", () => {
  const studentJoinBlock = server.match(/socket\.on\("student_join_room"[\s\S]*?socket\.on\("disconnect"/)?.[0] || "";
  assert.doesNotMatch(
    studentJoinBlock,
    /socket\.emit\("microphone_revoked"\);[\s\S]*?const existingState = isStudentMicrophoneOpen/,
    "student_join_room must not unconditionally emit microphone_revoked on rejoining students"
  );
  assert.match(studentJoinBlock, /isStudentMicrophoneOpen\(classroomLevel, socket\.id\)/, "Must check existing mic state");
});

test("server.js handles teacher mic approvals and toggles without uncaught rejections", () => {
  assert.match(server, /socket\.on\("teacher_set_mic", async \(data = \{\}, acknowledgement\) => \{[\s\S]*?try \{/);
  assert.match(server, /socket\.on\("teacher_approve_mic", async \(data = \{\}, acknowledgement\) => \{[\s\S]*?try \{/);
});

test("student-live.js verifies live audio track and resets negotiation state on mute/revocation", () => {
  assert.match(studentLive, /existingTrack && existingTrack\.readyState === "live"/, "Must verify track is live, not ended");
  assert.match(studentLive, /socket\.on\("microphone_revoked"[\s\S]*?microphoneNegotiated = false;/, "Must reset microphoneNegotiated on revoke");
  assert.match(studentLive, /socket\.on\("classroom_all_mics_muted"[\s\S]*?microphoneNegotiated = false;/, "Must reset microphoneNegotiated on mute all");
  assert.match(studentLive, /function stopLocalAudio\(\) \{[\s\S]*?microphoneNegotiated = false;/, "stopLocalAudio must reset negotiation flags");
});

test("teacher-live-v2.js handles WebRTC renegotiation offer collision with rollback", () => {
  const renegBlock = teacherLive.match(/socket\.on\("webrtc_renegotiation_offer"[\s\S]*?socket\.on\("webrtc_ice_candidate"/)?.[0] || "";
  assert.match(renegBlock, /peerConnection\.signalingState === "have-local-offer"/, "Must detect have-local-offer");
  assert.match(renegBlock, /setLocalDescription\(\{ type: "rollback" \}\)/, "Must rollback local offer to accept student mic offer");
});

test("teacher-live-v2.js monitors microphone hardware state and keeps audio graph active", () => {
  assert.match(teacherLive, /micTrack\.onended = \(\) => \{[\s\S]*?ensureTeacherMicrophoneActive/, "Must auto-recover when mic track ends");
  assert.match(teacherLive, /rebuildClassroomAudioGraph\(\) \{[\s\S]*?classroomAudioContext\.resume/, "Must resume suspended classroomAudioContext");
});

test("webrtcRoutes grants canPublish permission for LiveKit SFU classroom rooms", () => {
  assert.match(webrtcRoutes, /canPublish:\s*true/, "canPublish must be true in addGrant");
});
