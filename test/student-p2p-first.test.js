const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/js/student-live.js"), "utf8");

function extractFunction(name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

test("student requests an immediate P2P preview once without placing LiveKit on hold", () => {
  const emitted = [];
  const events = [];
  const context = {
    initialP2pPreviewRequested: false,
    socket: { connected: true, emit: (...args) => emitted.push(args) },
    level: "class-a",
    studentId: "student-a",
    recordStudentDiagnosticEvent: (...args) => events.push(args),
  };
  vm.runInNewContext(extractFunction("requestInitialP2pPreview"), context);

  assert.equal(context.requestInitialP2pPreview(), true);
  assert.equal(context.requestInitialP2pPreview(), false);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], "student_request_p2p_stream");
  assert.equal(emitted[0][1].reason, "initial_p2p_preview");
  assert.equal(events[0][0], "p2p_preview_requested");
});

test("room join requests P2P before starting LiveKit in the background", () => {
  const handler = source.slice(source.indexOf('socket.on("room_joined"'), source.indexOf("function clearScreenShareRefreshGuard"));
  assert.ok(handler.indexOf("requestInitialP2pPreview()") < handler.indexOf("void connectStudentSfu("));
  assert.match(handler, /connectStudentSfu\([^;]+\{ backgroundRetry: true \}\)/);
});

test("LiveKit background retries bypass temporary recovery holds and use bounded backoff", () => {
  assert.match(source, /async function connectStudentSfu\(roomName, \{ backgroundRetry = false \} = \{\}\)/);
  assert.match(source, /!backgroundRetry && typeof isStudentSfuRecoveryHeld/);

  let timer;
  let retryArgs;
  const context = {
    joinedClass: true,
    currentStudentSfuRoomName: "class-a",
    studentSfuRoom: null,
    studentSfuRetryTimer: null,
    studentSfuRetryAttempt: 0,
    recordStudentDiagnosticEvent() {},
    window: { setTimeout(callback, delay) { timer = { callback, delay }; return 1; }, clearTimeout() {} },
    connectStudentSfu: (...args) => { retryArgs = args; },
  };
  vm.runInNewContext(extractFunction("scheduleStudentSfuRetry"), context);

  context.scheduleStudentSfuRetry("class-a", "test");
  assert.equal(timer.delay, 1_000);
  timer.callback();
  assert.deepEqual(JSON.parse(JSON.stringify(retryArgs)), ["class-a", { backgroundRetry: true }]);
});

test("LiveKit is not considered ready until both subscribed media kinds show recent packet progress", () => {
  let now = 10_000;
  const context = {
    Date: { now: () => now },
    studentSfuMediaProgress: new Map([["audio", 9_000], ["video", 9_000]]),
    remoteMediaStream: { getTracks: () => [{ kind: "video", readyState: "live", __fromSfu: true }] },
    teacherAudioStream: { getTracks: () => [{ kind: "audio", readyState: "live", __fromSfu: true }] },
  };
  vm.runInNewContext(extractFunction("getTeacherSfuReceptionState"), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getTeacherSfuReceptionState())), {
    receivingAudio: true, receivingVideo: true, receiving: true,
  });
  context.studentSfuMediaProgress.set("audio", 3_000);
  const reception = context.getTeacherSfuReceptionState();
  assert.equal(reception.receivingAudio, false);
  assert.equal(reception.receivingVideo, true);
});

test("student reception monitor confirms audio samples and decoded video frames before LiveKit promotion", async () => {
  let now = 1_000;
  let tick;
  let audioBytes = 100, audioSamples = 10;
  let videoBytes = 100, videoFrames = 2;
  const audioTrack = { kind: "audio", readyState: "live", __fromSfu: true };
  const videoTrack = { kind: "video", readyState: "live", __fromSfu: true };
  const publication = (kind) => ({ kind, track: { kind, async getRTCStatsReport() {
    const report = kind === "audio"
      ? { type: "inbound-rtp", kind, bytesReceived: audioBytes, totalSamplesReceived: audioSamples }
      : { type: "inbound-rtp", kind, bytesReceived: videoBytes, framesDecoded: videoFrames };
    return new Map([[kind, report]]);
  } } });
  const room = { state: "connected", remoteParticipants: new Map([[
    "teacher", { trackPublications: new Map([["audio", publication("audio")], ["video", publication("video")]]) },
  ]]) };
  const context = {
    studentSfuRoom: room,
    joinedClass: true,
    screenShareActive: true,
    document: { visibilityState: "visible" },
    Date: { now: () => now },
    studentSfuMediaProgress: new Map(),
    remoteMediaStream: { getTracks: () => [videoTrack] },
    teacherAudioStream: { getTracks: () => [audioTrack] },
    getSfuParticipantRole: () => "teacher",
    recordStudentDiagnosticEvent() {},
    notifySfuTransportStatus() {},
    hasLiveP2pTeacherMedia: () => true,
    disconnectStudentSfu() {},
    scheduleStudentSfuRetry() {},
    setInterval(callback) { tick = callback; return 1; },
    clearInterval() {},
  };
  const teacherSource = fs.readFileSync(path.join(__dirname, "../public/js/student-live.js"), "utf8");
  const extract = (name) => {
    const match = teacherSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
    assert.ok(match, `${name} must exist`);
    return match[0];
  };
  vm.runInNewContext("let sfuReceptionMonitor = null;\n" + ["stopSfuReceptionMonitor", "startSfuReceptionMonitor", "getTeacherSfuReceptionState"]
    .map(extract).join("\n"), context);
  context.startSfuReceptionMonitor(room);
  await tick();
  assert.equal(context.getTeacherSfuReceptionState().receiving, false, "one stats sample is not proof of packet progress");
  now += 1_500; audioBytes += 100; audioSamples += 10; videoBytes += 100; videoFrames += 1;
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(context.getTeacherSfuReceptionState())), {
    receivingAudio: true, receivingVideo: true, receiving: true,
  });
});

test("Teacher attendee transport badge uses blue for P2P and red for LiveKit", () => {
  const badge = { style: {} };
  const attendee = { querySelector: () => badge };
  const context = {
    attendeeElements: new Map([["student", attendee]]),
    studentMediaTransports: new Map([["student", { p2pActive: true, sfuReady: false }]]),
  };
  const teacherSource = fs.readFileSync(path.join(__dirname, "../public/js/teacher-live-v2.js"), "utf8");
  const match = teacherSource.match(/^(?:async )?function renderAttendeeTransportStatus\([^]*?^\}/m);
  assert.ok(match, "renderAttendeeTransportStatus must exist");
  vm.runInNewContext(match[0], context);
  context.renderAttendeeTransportStatus("student");
  assert.equal(badge.textContent, "يستقبل عبر P2P");
  assert.equal(badge.style.color, "#bfdbfe");
  context.studentMediaTransports.set("student", { p2pActive: false, sfuReady: true });
  context.renderAttendeeTransportStatus("student");
  assert.equal(badge.textContent, "يستقبل عبر LiveKit");
  assert.equal(badge.style.color, "#fecaca");
  context.studentMediaTransports.set("student", { p2pPending: true, p2pActive: false, sfuReady: false });
  context.renderAttendeeTransportStatus("student");
  assert.equal(badge.textContent, "حاضر — جارٍ تجهيز البث");
});

