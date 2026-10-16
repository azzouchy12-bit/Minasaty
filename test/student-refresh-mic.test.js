const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/js/teacher-live-v2.js"), "utf8");
function harness(healthy, ready, state = "connected", signaling = "stable") {
  const offers = [], requests = [];
  const peer = { connectionState: state, signalingState: signaling };
  const context = { classActive: true, isEnding: false, activeLevel: "A", window: { setTimeout: fn => fn() },
    setStudioStatus() {}, ensureTeacherMicrophoneActive: async () => {}, ensureStudentAudioDestination() {},
    rebuildClassroomAudioGraph() {}, syncMixMinusAudioToAllPeers() {}, syncTeacherSfuMedia: async () => {},
    emitWithAcknowledgement: async (event, payload) => requests.push({ event, payload }),
    isTeacherSfuHealthy: () => healthy, studentMediaTransports: new Map([["student", { sfuReady: ready }]]),
    peerConnections: { student: peer }, createAndSendOffer: async (_id, options) => offers.push(options),
    closePeerConnection() { assert.fail("refresh must preserve current receiver"); },
    console: { warn() {}, error(error) { throw error; } },
  };
  vm.createContext(context);
  vm.runInContext(source.match(/^async function resyncSingleStudent\([^]*?^\}/m)[0], context);
  return { offers, requests, peer, run: () => context.resyncSingleStudent("student") };
}
test("refresh of confirmed SFU sends playback refresh without creating parallel P2P", async () => {
  const h = harness(true, true); await h.run();
  assert.equal(h.offers.length, 0);
  assert.equal(h.requests[0].payload.reload, false);
});
test("refresh of connected P2P preserves receiver and does not restart ICE", async () => {
  const h = harness(false, false); await h.run();
  assert.equal(h.offers[0].force, false);
  assert.equal(h.offers[0].iceRestart, false);
  assert.equal(h.offers[0].renegotiate, true);
});
test("refresh during pending negotiation queues a non-forced offer", async () => {
  const h = harness(false, false, "connected", "have-local-offer"); await h.run();
  assert.equal(h.offers[0].force, false);
  assert.equal(h.offers[0].renegotiate, true);
});
test("failed transport can restart ICE without discarding the approved microphone", async () => {
  const h = harness(false, false, "failed"); await h.run();
  assert.equal(h.offers[0].iceRestart, true);
  assert.equal(h.offers[0].force, false);
});
test("repeated join preserves mic button unless server explicitly reports it closed", async () => {
  let handler, enabled;
  const start = source.indexOf('socket.on("student_joined",');
  const end = source.indexOf('socket.on("student_mic_state_changed",', start);
  const ctx = { socket: { on(_event, fn) { handler = fn; } }, rosterEventRevision: 0,
    activeClassroomSessionId: "session", classActive: true, sessionAttendedStudentIds: new Set(),
    upsertAttendee: () => ({}), isTeacherSfuHealthy: () => true, studentMediaTransports: new Map(),
    renderAttendeeTransportStatus() {}, syncStudentMicButton(_row, _id, value) { enabled = value; },
    approvedStudentMicrophones: new Set(["student"]), recordLiveDiagnosticEvent() {}, refreshAbsenteesBadge() {},
  };
  vm.runInNewContext(source.slice(start, end), ctx);
  await handler({ socketId: "student", studentId: "child" });
  assert.equal(enabled, true);
  await handler({ socketId: "student", studentId: "child", micEnabled: false });
  assert.equal(enabled, false);
});
