const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const teacherSource = fs.readFileSync(path.join(ROOT, "public/js/teacher-live-v2.js"), "utf8");
const studentSource = fs.readFileSync(path.join(ROOT, "public/js/student-live.js"), "utf8");
const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

function extractFunction(source, name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

function fallbackFixture(existingPeer = null) {
  const offers = [];
  const context = {
    classActive: true,
    peerConnections: existingPeer ? { student: existingPeer } : {},
    isTeacherSfuHealthy: () => true,
    isTeacherSfuConnecting: false,
    teacherSfuRoom: { state: "connected" },
    createAndSendOffer: (...args) => offers.push(args),
    recordLiveDiagnosticEvent() {},
    console: { info() {} },
  };
  vm.runInNewContext(extractFunction(teacherSource, "transitionStudentToP2pFallback"), context);
  return { context, offers };
}

test("A persistently nonreceiving student can use targeted P2P while other students stay on SFU", () => {
  const fixture = fallbackFixture();
  fixture.context.transitionStudentToP2pFallback("student", { allowWhileSfuActive: true });
  assert.equal(fixture.offers.length, 1);
  assert.equal(fixture.offers[0][0], "student");
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.offers[0][1])), { iceRestart: true, force: true });
});

test("General P2P fallback remains suppressed while the central SFU is healthy", () => {
  const fixture = fallbackFixture();
  fixture.context.transitionStudentToP2pFallback("student");
  assert.equal(fixture.offers.length, 0);
});

test("A healthy targeted P2P connection is not repeatedly renegotiated", () => {
  const fixture = fallbackFixture({ __teacherP2pFallback: true, connectionState: "connected" });
  fixture.context.transitionStudentToP2pFallback("student", { allowWhileSfuActive: true });
  assert.equal(fixture.offers.length, 0);
});

test("A failed targeted P2P offer is retried after signaling reconnect without starting a class-wide mesh", () => {
  const offers = [];
  const context = {
    classActive: true,
    socket: { connected: true },
    peerConnections: {
      failedStudent: { __teacherP2pFallback: true, __teacherP2pOfferNeedsRetry: true },
      healthyStudent: { __teacherP2pFallback: true, __teacherP2pOfferNeedsRetry: false },
      sfuStudent: { __teacherP2pFallback: false, __teacherP2pOfferNeedsRetry: true },
    },
    createAndSendOffer: (...args) => offers.push(args),
    console: { info() {} },
  };
  vm.runInNewContext(extractFunction(teacherSource, "retryPendingTargetedP2pOffers"), context);

  context.retryPendingTargetedP2pOffers();

  assert.equal(offers.length, 1);
  assert.equal(offers[0][0], "failedStudent");
  assert.deepEqual(JSON.parse(JSON.stringify(offers[0][1])), { iceRestart: true, force: true });
  assert.equal(context.peerConnections.failedStudent.__teacherP2pOfferNeedsRetry, false);
});

test("A timed-out targeted P2P offer stays queued for the next signaling reconnect", () => {
  assert.match(teacherSource, /peerConnection\.__teacherP2pOfferNeedsRetry = true/);
  assert.match(teacherSource, /function resumeLiveClassAfterSocketReconnect\(\)[\s\S]*?retryPendingTargetedP2pOffers\(\)/);
});

test("Student reception reports distinguish real LiveKit audio/video from room connection", () => {
  assert.match(studentSource, /function getTeacherSfuReceptionState\(\)[\s\S]*?__fromSfu === true[\s\S]*?receivingAudio[\s\S]*?receivingVideo/);
  assert.match(studentSource, /receivingAudio: Boolean\(receiving && reception\.receivingAudio\)/);
  assert.match(studentSource, /receivingVideo: Boolean\(receiving && reception\.receivingVideo\)/);
  assert.match(serverSource, /receivingAudio: Boolean\(data\?\.receivingAudio\)[\s\S]*?receivingVideo: Boolean\(data\?\.receivingVideo\)/);
});

test("Student preserves working P2P media when LiveKit reception stalls", () => {
  assert.match(studentSource, /function hasLiveP2pTeacherMedia\(\)/);
  assert.match(studentSource, /if \(typeof hasLiveP2pTeacherMedia === "function" && hasLiveP2pTeacherMedia\(\)\) \{[\s\S]*?p2p_media_preserved[\s\S]*?notifySfuTransportStatus\(false\)[\s\S]*?return;[\s\S]*?disconnectStudentSfu\(\)/);
});

test("Teacher schedules a targeted fallback and switches back only after confirmed SFU media", () => {
  assert.match(teacherSource, /STUDENT_SFU_FALLBACK_DELAY_MS = 5_000/);
  assert.match(teacherSource, /transitionStudentToP2pFallback\(data\.socketId, \{ allowWhileSfuActive: true \}\)/);
  assert.match(teacherSource, /STUDENT_SFU_RETURN_CONFIRM_MS = 3_000/);
  assert.match(teacherSource, /student_sfu_recovered/);
});

test("Repeated no-media reports keep one recovery timer and still trigger targeted fallback", () => {
  let now = 1_000;
  const timers = [];
  const fallbacks = [];
  const context = {
    Date: { now: () => now },
    STUDENT_SFU_FALLBACK_DELAY_MS: 5_000,
    STUDENT_SFU_RETURN_CONFIRM_MS: 3_000,
    studentSfuFallbackTimers: new Map(),
    studentSfuReturnTimers: new Map(),
    studentMediaTransports: new Map(),
    peerConnections: {},
    classActive: true,
    getActiveTeacherAudioTrack: () => ({ readyState: "live", enabled: true }),
    getActiveTeacherVideoTrack: () => ({ readyState: "live", enabled: true }),
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { timer.cleared = true; },
    transitionStudentToP2pFallback: (...args) => fallbacks.push(args),
    recordLiveDiagnosticEvent() {},
    renderAttendeeTransportStatus() {},
    closePeerConnection() {},
    console: { info() {} },
  };
  vm.runInNewContext(extractFunction(teacherSource, "handleStudentTransportUpdated"), context);
  const noMedia = { socketId: "student", transport: "sfu", receiving: false, receivingAudio: false, receivingVideo: false };

  context.handleStudentTransportUpdated(noMedia);
  now += 3_000;
  context.handleStudentTransportUpdated(noMedia);
  assert.equal(timers.length, 1, "repeated reports must not keep pushing fallback later");
  assert.equal(timers[0].delay, 5_000);

  now += 2_000;
  timers[0].callback();
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0][0], "student");
  assert.deepEqual(JSON.parse(JSON.stringify(fallbacks[0][1])), { allowWhileSfuActive: true });
});
