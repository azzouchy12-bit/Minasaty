const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const studentSource = fs.readFileSync(path.join(__dirname, "../public/js/student-live.js"), "utf8");

function extractFunction(source, name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `${name} must exist in source`);
  return match[0];
}

function createStudentAudioRecoveryContext(options = {}) {
  let now = 10_000;
  const emitted = [];
  const events = [];
  let sfuDisconnected = false;
  let remoteMediaReset = false;
  let beginRecoveryCalled = false;
  let beginRecoveryMessage = "";

  const ctx = {
    joinedClass: true,
    isJoining: false,
    level: "test-level",
    studentId: "student-123",
    teacherSocketId: "teacher-socket",
    studentSfuRoom: options.studentSfuRoom || { state: "connected" },
    studentSfuMediaProgress: new Map(),
    studentP2pMediaProgress: new Map(),
    studentSfuConnectedAt: now - 30_000,
    SFU_STARTUP_GRACE_PERIOD_MS: 2_500,
    remoteMediaStream: {
      getTracks: () => options.remoteTracks || [],
      getVideoTracks: () => (options.remoteTracks || []).filter((t) => t.kind === "video"),
      getAudioTracks: () => (options.remoteTracks || []).filter((t) => t.kind === "audio"),
      removeTrack: () => {},
    },
    teacherAudioStream: {
      getAudioTracks: () => options.teacherAudioTracks || [],
      removeTrack: () => {},
    },
    RTCPeerConnection: class FakePeerConnection {
      constructor() {
        this.connectionState = "new";
        this.iceConnectionState = "new";
      }
    },
    rtcConfig: {},
    socket: {
      connected: true,
      emit: (event, data) => emitted.push({ event, data }),
    },
    Date: {
      now: () => now,
    },
    window: {
      setTimeout: (fn, delay) => {
        return { fn, delay, at: now + delay };
      },
      clearTimeout: () => {},
    },
    recordStudentDiagnosticEvent: (type, desc) => events.push({ type, desc }),
    setViewerStatus: () => {},
    hideConnectionOverlay: () => {},
    showConnectionOverlay: () => {},
    clearRecoveryTimer: () => {},
    updateChatControls: () => {},
    scheduleClassRecovery: () => {},
    disconnectStudentSfu: () => { sfuDisconnected = true; },
    resetRemoteMedia: () => { remoteMediaReset = true; },
    beginStreamRecovery: (msg) => {
      beginRecoveryCalled = true;
      beginRecoveryMessage = msg;
    },
    closePeerConnection: () => {
      if (ctx.pc) {
        ctx.pc.connectionState = "closed";
      }
    },
    notifySfuTransportStatus: () => {},
    holdStudentSfuDuringRecovery: () => {},
    console: {
      info: () => {},
      warn: () => {},
      log: () => {},
    },
  };

  // Compile the production functions into the isolated VM context
  const codeToRun = [
    extractFunction(studentSource, "getTeacherSfuReceptionState"),
    extractFunction(studentSource, "getTeacherP2pReceptionState"),
    extractFunction(studentSource, "hasLiveP2pTeacherMedia"),
    extractFunction(studentSource, "isTeacherAudioHealthy"),
    extractFunction(studentSource, "isStudentSfuReconnecting"),
    extractFunction(studentSource, "isStudentSfuHealthy"),
    extractFunction(studentSource, "requestTargetedP2pFallback"),
    studentSource.slice(
      studentSource.indexOf("let p2pAudioRecoveryAttempts = 0;"),
      studentSource.indexOf("async function flushPendingIceCandidates()")
    ),
  ].join("\n\n");

  vm.runInNewContext(codeToRun, ctx);

  return {
    ctx,
    emitted,
    events,
    advanceTime: (ms) => { now += ms; },
    wasSfuDisconnected: () => sfuDisconnected,
    wasRemoteMediaReset: () => remoteMediaReset,
    wasBeginRecoveryCalled: () => beginRecoveryCalled,
    getBeginRecoveryMessage: () => beginRecoveryMessage,
  };
}

// -----------------------------------------------------------------------------
// Test 1: P2P teacher audio fails while LiveKit is "reconnecting"
// -----------------------------------------------------------------------------
test("When P2P teacher audio fails and LiveKit is 'reconnecting' without receiving teacher audio, audio recovery runs", () => {
  const fixture = createStudentAudioRecoveryContext({
    studentSfuRoom: { state: "reconnecting" },
    remoteTracks: [{ kind: "video", readyState: "live", __fromSfu: true }],
    teacherAudioTracks: [],
  });

  const peer = fixture.ctx.createViewerPeerConnection();
  peer.connectionState = "failed";

  // Trigger P2P failure while SFU is in reconnecting state
  peer.onconnectionstatechange();

  // Verification 1: P2P audio recovery must be triggered
  const p2pFallbackRequests = fixture.emitted.filter((e) => e.event === "student_request_p2p_stream");
  assert.equal(p2pFallbackRequests.length, 1, "Must request targeted P2P stream from teacher");
  assert.equal(p2pFallbackRequests[0].data.reason, "p2p_connection_failed");
  assert.equal(p2pFallbackRequests[0].data.restartStalled, true);

  // Verification 2: Video/SFU must NOT be torn down during isolated audio recovery
  assert.equal(fixture.wasSfuDisconnected(), false, "SFU must NOT be disconnected");
  assert.equal(fixture.wasRemoteMediaReset(), false, "Remote media must NOT be reset");
  assert.equal(fixture.wasBeginRecoveryCalled(), false, "Full stream recovery must NOT be called");

  // Verification 3: Diagnostic event recorded
  const recoveryEvents = fixture.events.filter((e) => e.type === "p2p_audio_isolated_recovery");
  assert.equal(recoveryEvents.length, 1, "Must record diagnostic event for isolated audio recovery");
});

// -----------------------------------------------------------------------------
// Test 2: Teacher audio is demonstrably arriving on healthy alternate transport
// -----------------------------------------------------------------------------
test("When teacher audio is demonstrably arriving on a healthy alternate transport, recovery does not interrupt it", () => {
  const audioTrack = { kind: "audio", readyState: "live", __fromSfu: true };
  const fixture = createStudentAudioRecoveryContext({
    studentSfuRoom: { state: "connected" },
    remoteTracks: [audioTrack],
    teacherAudioTracks: [audioTrack],
  });

  // Simulate recent audio packets arriving on SFU (within 6s window)
  fixture.ctx.studentSfuMediaProgress.set("audio", 9_500);

  // Confirm alternate transport audio health
  assert.equal(fixture.ctx.isTeacherAudioHealthy(), true, "Alternate transport must report healthy audio");

  const peer = fixture.ctx.createViewerPeerConnection();
  peer.connectionState = "failed";

  // Trigger P2P connection failure
  peer.onconnectionstatechange();

  // Recovery must be suppressed since teacher audio is healthy
  const p2pFallbackRequests = fixture.emitted.filter((e) => e.event === "student_request_p2p_stream");
  assert.equal(p2pFallbackRequests.length, 0, "Must NOT request P2P fallback when audio is already healthy");
  assert.equal(fixture.wasBeginRecoveryCalled(), false, "Must NOT trigger stream recovery");
});

// -----------------------------------------------------------------------------
// Test 3: A healthy video path remains active while audio is independently recovered
// -----------------------------------------------------------------------------
test("A healthy video path remains active while audio is independently recovered", () => {
  const videoTrack = { kind: "video", readyState: "live", __fromSfu: true };
  const fixture = createStudentAudioRecoveryContext({
    studentSfuRoom: { state: "connected" },
    remoteTracks: [videoTrack],
    teacherAudioTracks: [], // No audio
  });

  // Video has recent progress on SFU
  fixture.ctx.studentSfuMediaProgress.set("video", 9_800);
  assert.equal(fixture.ctx.getTeacherSfuReceptionState().receivingVideo, true, "SFU must have active receiving video");
  assert.equal(fixture.ctx.isTeacherAudioHealthy(), false, "Audio must not be receiving");

  const peer = fixture.ctx.createViewerPeerConnection();
  peer.connectionState = "failed";

  peer.onconnectionstatechange();

  // Audio recovery triggered
  const p2pFallbackRequests = fixture.emitted.filter((e) => e.event === "student_request_p2p_stream");
  assert.equal(p2pFallbackRequests.length, 1, "Must request targeted audio recovery");

  // Video session remains preserved
  assert.equal(fixture.wasSfuDisconnected(), false, "Must NOT disconnect SFU");
  assert.equal(fixture.wasRemoteMediaReset(), false, "Must NOT reset remote video");
  assert.equal(fixture.wasBeginRecoveryCalled(), false, "Must NOT blackout whole class");
});

// -----------------------------------------------------------------------------
// Test 4: Repeated failure signals do not create unbounded or duplicate recovery loops
// -----------------------------------------------------------------------------
test("Repeated failure signals do not create unbounded or duplicate recovery loops", () => {
  const fixture = createStudentAudioRecoveryContext({
    studentSfuRoom: { state: "reconnecting" },
    remoteTracks: [{ kind: "video", readyState: "live", __fromSfu: true }],
    teacherAudioTracks: [],
  });

  const peer = fixture.ctx.createViewerPeerConnection();
  peer.connectionState = "failed";

  // First failure: recovery attempt 1
  peer.onconnectionstatechange();
  let fallbackRequests = fixture.emitted.filter((e) => e.event === "student_request_p2p_stream");
  assert.equal(fallbackRequests.length, 1);

  // Immediate repeated failure signals within 2-second cooldown window must be throttled
  peer.onconnectionstatechange();
  peer.onconnectionstatechange();
  fallbackRequests = fixture.emitted.filter((e) => e.event === "student_request_p2p_stream");
  assert.equal(fallbackRequests.length, 1, "Duplicate requests during cooldown must be throttled");

  // Advance time past cooldown for attempt 2, 3, 4, 5
  for (let i = 2; i <= 5; i++) {
    fixture.advanceTime(2_500);
    const retryPeer = fixture.ctx.createViewerPeerConnection();
    retryPeer.connectionState = "failed";
    retryPeer.onconnectionstatechange();
  }
  fallbackRequests = fixture.emitted.filter((e) => e.event === "student_request_p2p_stream");
  assert.equal(fallbackRequests.length, 5, "Must bound audio recovery attempts at MAX (5)");

  // Attempt 6 (past MAX_P2P_AUDIO_RECOVERY_ATTEMPTS): must gracefully escalate to full recovery
  fixture.advanceTime(2_500);
  const exhaustedPeer = fixture.ctx.createViewerPeerConnection();
  exhaustedPeer.connectionState = "failed";
  exhaustedPeer.onconnectionstatechange();
  assert.equal(fixture.wasBeginRecoveryCalled(), true, "Must escalate to full recovery when audio attempts exhausted");
  const exhaustedEvents = fixture.events.filter((e) => e.type === "p2p_audio_recovery_exhausted");
  assert.equal(exhaustedEvents.length, 1, "Must record exhaustion diagnostic event");
});
