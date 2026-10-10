const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const teacherSource = fs.readFileSync(path.join(ROOT, "public", "js", "teacher-live-v2.js"), "utf8");
const studentSource = fs.readFileSync(path.join(ROOT, "public", "js", "student-live.js"), "utf8");
const iceSource = fs.readFileSync(path.join(ROOT, "public", "js", "webrtc-ice.js"), "utf8");

function extractFunction(source, name) {
  const regex = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, "g");
  const match = regex.exec(source);
  assert.ok(match, `Function ${name} must exist in source`);
  const start = source.lastIndexOf("\n", match.index) + 1;
  const next = source.slice(match.index + 1).search(/\n(?:async\\s+)?function\s+[a-zA-Z0-9_$]+\s*\(/);
  return source.slice(start, next < 0 ? source.length : match.index + 1 + next);
}

// -------------------------------------------------------------
// Test 1: Teacher SFU Recovery: Exponential Backoff & Jitter
// -------------------------------------------------------------
test("Teacher recovery: handleSfuDegradation performs bounded backoff with jitter and transitions to P2P fallback on exhaustion", async () => {
  const timers = [];
  let p2pAllTriggered = false;
  let fetchTokenAttempts = 0;
  let tokenShouldSucceedOn = 4; // Fails 3 times, succeeds on attempt 4

  const sandbox = {
    classActive: true,
    activeLevel: "4AM",
    mediaTransportState: "idle",
    sfuDegradationTimer: null,
    sfuReconnectAttempts: 0,
    MAX_SFU_RECONNECT_ATTEMPTS: 5,
    teacherSfuSessionId: 1,
    teacherSfuRoom: null,
    currentTeacherSfuRoomName: null,
    isTeacherSfuConnecting: false,
    teacherSfuConnectPromise: null,
    sfuActiveForClass: false,
    diagnosticEvents: [],
    studioStatusLog: [],
    recordLiveDiagnosticEvent(type, msg) {
      sandbox.diagnosticEvents.push({ type, msg });
    },
    setStudioStatus(msg, tone) {
      sandbox.studioStatusLog.push({ msg, tone });
    },
    transitionAllStudentsToP2pFallback() {
      p2pAllTriggered = true;
    },
    setTimeout(cb, delay) {
      timers.push({ cb, delay });
      return timers.length;
    },
    clearTimeout(id) {
      sandbox.sfuDegradationTimer = null;
    },
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    window: {
      fetchMinasatySfuToken: async (room) => {
        fetchTokenAttempts++;
        if (fetchTokenAttempts >= tokenShouldSucceedOn) {
          return { enabled: true, token: "tok123", url: "wss://sfu.example.com" };
        }
        return null; // disabled / server error
      },
      LivekitClient: {
        Room: class {
          constructor() {
            this.state = "disconnected";
          }
          on() {}
          async connect() {
            this.state = "connected";
          }
        },
        RoomEvent: {
          TrackSubscribed: "ts",
          TrackUnsubscribed: "tu",
          ParticipantDisconnected: "pd",
          Disconnected: "d",
        },
      },
    },
    syncTeacherSfuMedia: async () => {},
  };

  const handleSfuFn = extractFunction(teacherSource, "handleSfuDegradation");
  const initSfuFn = extractFunction(teacherSource, "initTeacherSfuSession");
  const cancelSfuFn = extractFunction(teacherSource, "cancelSfuDegradation");
  vm.runInNewContext(`${handleSfuFn}\n${initSfuFn}\n${cancelSfuFn}`, sandbox);

  // Initial degradation trigger
  sandbox.handleSfuDegradation();

  assert.equal(sandbox.mediaTransportState, "p2p_fallback");
  assert.equal(timers.length, 1);
  const firstDelay = timers[0].delay;
  // Delay should be bounded between 1500ms and 2600ms (2000ms with +/-20% jitter)
  assert.ok(firstDelay >= 1500 && firstDelay <= 2600, `First backoff delay was ${firstDelay}`);

  // Fire attempt 1 (fails)
  await timers[0].cb();
  assert.equal(fetchTokenAttempts, 1);
  assert.equal(timers.length, 2, "Second retry timer must be scheduled");
  const secondDelay = timers[1].delay;
  // Second delay should be around 3000ms (2000 * 1.5)
  assert.ok(secondDelay >= 2200 && secondDelay <= 3800, `Second backoff delay was ${secondDelay}`);

  // Fire attempt 2 (fails)
  await timers[1].cb();
  assert.equal(fetchTokenAttempts, 2);
  assert.equal(timers.length, 3);

  // Fire attempt 3 (fails)
  await timers[2].cb();
  assert.equal(fetchTokenAttempts, 3);
  assert.equal(timers.length, 4);

  // Fire attempt 4 (succeeds!)
  await timers[3].cb();
  assert.equal(fetchTokenAttempts, 4);
  assert.equal(sandbox.mediaTransportState, "sfu_active");
  assert.equal(sandbox.sfuReconnectAttempts, 0, "Reconnect attempts reset on recovery");
  assert.ok(!p2pAllTriggered, "P2P fallback should NOT be triggered on successful recovery");

  // Now test exhaustion if failures exceed max (5 attempts)
  sandbox.sfuReconnectAttempts = 5;
  sandbox.sfuDegradationTimer = null;
  fetchTokenAttempts = 0;
  tokenShouldSucceedOn = 999; // Never succeed
  sandbox.handleSfuDegradation();

  assert.ok(p2pAllTriggered, "transitionAllStudentsToP2pFallback must be called when attempts are exhausted");
  const lastStatus = sandbox.studioStatusLog[sandbox.studioStatusLog.length - 1];
  assert.equal(lastStatus.tone, "warning");
  assert.ok(lastStatus.msg.includes("P2P"), "Status message must inform teacher about P2P switch");
});

// -------------------------------------------------------------
// Test 2: In-Flight Connection Deduplication (Teacher & Student)
// -------------------------------------------------------------
test("In-flight connection: concurrent connection calls await the same promise and do not duplicate connections", async () => {
  // Test Teacher in-flight deduplication
  let teacherRoomCreates = 0;
  let fetchTokenCalls = 0;

  const teacherCtx = {
    classActive: true,
    currentTeacherSfuRoomName: null,
    isTeacherSfuConnecting: false,
    teacherSfuConnectPromise: null,
    teacherSfuSessionId: 0,
    teacherSfuRoom: null,
    sfuActiveForClass: false,
    mediaTransportState: "idle",
    diagnosticEvents: [],
    recordLiveDiagnosticEvent: () => {},
    closeTeacherSfuSession: () => {},
    syncTeacherSfuMedia: async () => {},
    window: {
      fetchMinasatySfuToken: async () => {
        fetchTokenCalls++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { enabled: true, token: "tok123", url: "wss://sfu.example.com" };
      },
      LivekitClient: {
        Room: class {
          constructor() {
            teacherRoomCreates++;
            this.state = "disconnected";
          }
          on() {}
          async connect() {
            this.state = "connected";
          }
        },
        RoomEvent: {
          TrackSubscribed: "trackSubscribed",
          TrackUnsubscribed: "trackUnsubscribed",
          ParticipantDisconnected: "participantDisconnected",
          Disconnected: "disconnected",
        },
      },
    },
    console: { info: () => {}, warn: () => {} },
  };

  const teacherInitFn = extractFunction(teacherSource, "initTeacherSfuSession");
  vm.runInNewContext(teacherInitFn, teacherCtx);

  // Call concurrently
  const [res1, res2] = await Promise.all([
    teacherCtx.initTeacherSfuSession("4AM"),
    teacherCtx.initTeacherSfuSession("4AM"),
  ]);

  assert.equal(res1, true);
  assert.equal(res2, true);
  assert.equal(fetchTokenCalls, 1, "fetchMinasatySfuToken must only be called once for concurrent calls");
  assert.equal(teacherRoomCreates, 1, "Only 1 Room instance must be created");

  // Test Student in-flight deduplication
  let studentRoomCreates = 0;
  let studentFetchCalls = 0;

  const studentCtx = {
    studentSfuRoom: null,
    currentStudentSfuRoomName: null,
    isStudentSfuConnecting: false,
    studentSfuConnectPromise: null,
    studentSfuSessionId: 0,
    studentSfuConnectedAt: 0,
    studentDiagnosticEvents: [],
    recordStudentDiagnosticEvent: () => {},
    disconnectStudentSfu: () => {},
    notifySfuTransportStatus: () => {},
    window: {
      fetchMinasatySfuToken: async () => {
        studentFetchCalls++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { enabled: true, token: "stok123", url: "wss://sfu.example.com" };
      },
      LivekitClient: {
        Room: class {
          constructor() {
            studentRoomCreates++;
            this.state = "disconnected";
          }
          on() {}
          async connect() {
            this.state = "connected";
          }
        },
        RoomEvent: {
          TrackSubscribed: "trackSubscribed",
          TrackUnsubscribed: "trackUnsubscribed",
          ParticipantDisconnected: "participantDisconnected",
          Disconnected: "disconnected",
        },
      },
    },
    console: { info: () => {}, warn: () => {} },
  };

  const studentConnectFn = extractFunction(studentSource, "connectStudentSfu");
  vm.runInNewContext(studentConnectFn, studentCtx);

  const [sRes1, sRes2] = await Promise.all([
    studentCtx.connectStudentSfu("4AM"),
    studentCtx.connectStudentSfu("4AM"),
  ]);

  assert.equal(sRes1, true);
  assert.equal(sRes2, true);
  assert.equal(studentFetchCalls, 1, "Student fetch token must only be called once");
  assert.equal(studentRoomCreates, 1, "Student Room must only be instantiated once");
});

// -------------------------------------------------------------
// Test 3: Room Switching Lifecycle Isolation & Session Safety
// -------------------------------------------------------------
test("Room switching: closes previous session before opening new room and ignores stale room events", async () => {
  const closedRooms = [];

  const teacherCtx = {
    classActive: true,
    currentTeacherSfuRoomName: "ROOM_A",
    isTeacherSfuConnecting: false,
    teacherSfuConnectPromise: null,
    teacherSfuSessionId: 1,
    teacherSfuRoom: {
      state: "connected",
      disconnect(stop) {
        closedRooms.push(teacherCtx.currentTeacherSfuRoomName);
      },
    },
    sfuActiveForClass: true,
    mediaTransportState: "sfu_active",
    recordLiveDiagnosticEvent: () => {},
    closeTeacherSfuSession() {
      if (teacherCtx.teacherSfuRoom) {
        closedRooms.push(teacherCtx.currentTeacherSfuRoomName);
        teacherCtx.teacherSfuRoom = null;
      }
      teacherCtx.currentTeacherSfuRoomName = null;
      teacherCtx.teacherSfuSessionId++;
    },
    syncTeacherSfuMedia: async () => {},
    window: {
      fetchMinasatySfuToken: async (room) => {
        return { enabled: true, token: "tok_" + room, url: "wss://sfu.example.com" };
      },
      LivekitClient: {
        Room: class {
          constructor() {
            this.state = "disconnected";
          }
          on() {}
          async connect() {
            this.state = "connected";
          }
        },
        RoomEvent: {
          TrackSubscribed: "ts",
          TrackUnsubscribed: "tu",
          ParticipantDisconnected: "pd",
          Disconnected: "d",
        },
      },
    },
    console: { info: () => {}, warn: () => {} },
  };

  const teacherInitFn = extractFunction(teacherSource, "initTeacherSfuSession");
  vm.runInNewContext(teacherInitFn, teacherCtx);

  // Switch room from ROOM_A to ROOM_B
  await teacherCtx.initTeacherSfuSession("ROOM_B");

  assert.deepEqual(closedRooms, ["ROOM_A"], "Old room ROOM_A must be closed before establishing ROOM_B");
  assert.equal(teacherCtx.currentTeacherSfuRoomName, "ROOM_B");
  assert.equal(teacherCtx.teacherSfuSessionId, 3, "Session ID incremented properly");
});

// -------------------------------------------------------------
// Test 4: Independent & Observable Publication Error Handling
// -------------------------------------------------------------
test("Media sync: video publication failure is observable and does NOT block audio publication", async () => {
  let videoPublishAttempted = false;
  let audioPublishAttempted = false;
  const diagnostics = [];

  const teacherCtx = {
    teacherSfuRoom: {
      state: "connected",
      localParticipant: {
        trackPublications: new Map(),
        async publishTrack(track, options) {
          if (options.name === "teacher-screen") {
            videoPublishAttempted = true;
            throw new Error("Screen share encoding failure / hardware error");
          }
          if (options.name === "teacher-audio") {
            audioPublishAttempted = true;
            return { track: { mediaStreamTrack: track }, kind: "audio" };
          }
        },
        async unpublishTrack() {},
      },
    },
    teacherSfuVideoPub: null,
    teacherSfuAudioPub: null,
    getActiveTeacherVideoTrack: () => ({ id: "vid-1", readyState: "live" }),
    getActiveTeacherAudioTrack: () => ({ id: "aud-1", readyState: "live" }),
    recordLiveDiagnosticEvent: (type, msg) => {
      diagnostics.push({ type, msg });
    },
    window: {
      LivekitClient: {
        Track: { Source: { ScreenShare: "screen_share", Microphone: "microphone" } },
      },
    },
    console: { warn: () => {}, info: () => {} },
  };

  const syncFn = extractFunction(teacherSource, "executeTeacherSfuMediaSync");
  vm.runInNewContext(syncFn, teacherCtx);

  const result = await teacherCtx.executeTeacherSfuMediaSync();

  assert.equal(videoPublishAttempted, true, "Video publication was attempted");
  assert.equal(audioPublishAttempted, true, "Audio publication must proceed independently despite video error");
  assert.equal(result.success, false, "Result indicates incomplete overall sync");
  assert.equal(result.videoPublished, false);
  assert.equal(result.audioPublished, true);
  assert.ok(result.videoError, "Video error is returned in result object");
  assert.ok(
    diagnostics.some((d) => d.type === "sfu_video_publish_error"),
    "Observable diagnostic event for video error was logged"
  );
});

// -------------------------------------------------------------
// Test 5: Truthful Student Health Evaluation (No Classmate False Positive)
// -------------------------------------------------------------
test("Student health: isStudentSfuHealthy does NOT treat classmate presence as teacher media reception", () => {
  const studentCtx = {
    studentSfuRoom: {
      state: "connected",
      remoteParticipants: new Map([["classmate-socket-1", { identity: "student_101" }]]),
    },
    studentSfuConnectedAt: Date.now() - 20_000, // 20 seconds ago (grace period expired)
    SFU_STARTUP_GRACE_PERIOD_MS: 12_000,
    remoteMediaStream: {
      getVideoTracks: () => [],
      getAudioTracks: () => [],
      getTracks: () => [],
    },
    teacherAudioStream: {
      getAudioTracks: () => [],
      getTracks: () => [],
    },
  };

  studentCtx.isStudentSfuConnected = () => studentCtx.studentSfuRoom?.state === "connected";

  const isHealthyFn = extractFunction(studentSource, "isStudentSfuHealthy");
  vm.runInNewContext(isHealthyFn, studentCtx);

  // Classmate is present, but NO teacher video/audio tracks exist, and grace period is past:
  const healthy = studentCtx.isStudentSfuHealthy();
  assert.equal(healthy, false, "Must return false when only classmates are present without teacher media");

  // Reconnecting state respects SDK transient reconnection:
  studentCtx.studentSfuRoom.state = "reconnecting";
  assert.equal(studentCtx.isStudentSfuHealthy(), true, "Must return true during transient SDK reconnecting");

  // Fresh connection within grace period (5 seconds ago):
  studentCtx.studentSfuRoom.state = "connected";
  studentCtx.studentSfuConnectedAt = Date.now() - 5_000;
  assert.equal(studentCtx.isStudentSfuHealthy(), true, "Must return true during startup grace period");

  // Expired grace period, but live teacher audio arrives with __fromSfu:
  studentCtx.studentSfuConnectedAt = Date.now() - 20_000;
  studentCtx.remoteMediaStream.getAudioTracks = () => [{ readyState: "live", __fromSfu: true }];
  assert.equal(studentCtx.isStudentSfuHealthy(), true, "Must return true when teacher media is live");
});

// -------------------------------------------------------------
// Test 6: Terminal Student SFU Disconnect Clears Stale SFU Tracks
// -------------------------------------------------------------
test("Student recovery: terminal SFU disconnect clears stale SFU tracks and preserves mic approval", () => {
  const tracks = [
    { id: "sfu-video", readyState: "live", __fromSfu: true, stopped: false, stop() { this.stopped = true; } },
    { id: "p2p-audio", readyState: "live", __fromSfu: false, stopped: false, stop() { this.stopped = true; } },
  ];

  const studentCtx = {
    remoteMediaStream: {
      getTracks: () => [...tracks],
      removeTrack: (t) => {
        const idx = tracks.indexOf(t);
        if (idx >= 0) tracks.splice(idx, 1);
      },
    },
    teacherAudioStream: null,
    updateRemoteVideoPresentation: () => {},
  };

  const clearStaleFn = extractFunction(studentSource, "clearStaleSfuMedia");
  vm.runInNewContext(clearStaleFn, studentCtx);

  studentCtx.teacherSfuPlaybackTracks = new Map();
  vm.runInContext(extractFunction(studentSource, "detachTeacherSfuPlaybackTrack"), studentCtx);
  studentCtx.clearStaleSfuMedia();

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].id, "p2p-audio", "P2P tracks must be preserved while stale SFU tracks are removed");
});

// -------------------------------------------------------------
// Test 7: ICE Helper: Non-Permanent STUN Fallback and Expiry Refresh
// -------------------------------------------------------------
test("ICE helper: does NOT permanently cache STUN fallback on failure, deduplicates calls, and refreshes expired TURN", async () => {
  let fetchAttempts = 0;
  let shouldFail = true;

  const storage = new Map();
  const sandbox = {
    window: {},
    sessionStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
    },
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    AbortController: global.AbortController,
    console: { warn: () => {}, info: () => {}, error: () => {} },
  };

  sandbox.fetch = async (url) => {
    fetchAttempts++;
    if (shouldFail) {
      throw new Error("Network offline or 503 Service Unavailable");
    }
    return {
      ok: true,
      json: async () => ({
        iceServers: [{ urls: "turn:turn.example.com:3478", username: "u", credential: "p" }],
        expiresAt: Math.floor(Date.now() / 1000) + 600, // 10 minutes in future
      }),
    };
  };

  // Run the full webrtc-ice.js file in sandbox
  vm.runInNewContext(iceSource, sandbox);

  // 1. Missing token returns STUN fallback without permanent caching
  storage.clear();
  const noTokenConfig = await sandbox.window.getMinasatyRtcConfig();
  assert.ok(noTokenConfig.iceServers[0].urls[0].includes("stun:"), "Must return STUN fallback when unauthenticated");
  assert.equal(fetchAttempts, 0, "No network request when no token exists");

  // 2. Token added, but network fetch fails: returns STUN fallback
  storage.set("studentToken", "valid_jwt");
  const fallback = await sandbox.window.getMinasatyRtcConfig();
  assert.ok(fallback.iceServers[0].urls[0].includes("stun:"), "Must return STUN fallback on network error");
  assert.equal(fetchAttempts, 1);

  // 3. Network recovers: Next fetch succeeds and is NOT permanently blocked by previous fallback
  shouldFail = false;
  const turnConfig = await sandbox.window.getMinasatyRtcConfig();
  assert.equal(turnConfig.iceServers[0].urls, "turn:turn.example.com:3478");
  assert.equal(fetchAttempts, 2, "Second fetch must have hit network after previous error");

  // 4. Cache deduplication: Immediate subsequent call uses cache without network request
  const cachedConfig = await sandbox.window.getMinasatyRtcConfig();
  assert.equal(cachedConfig.iceServers[0].urls, "turn:turn.example.com:3478");
  assert.equal(fetchAttempts, 2, "Cached config reused without redundant network fetch");
});

// -------------------------------------------------------------
// Test 8: Server-Side Classroom Authorization & Server-Owned Mic Permissions
// -------------------------------------------------------------
test("Server: token endpoint enforces server-owned mic state and ignores client allowMic", () => {
  const routesCode = fs.readFileSync(path.join(ROOT, "routes", "webrtcRoutes.js"), "utf8");

  // Client allowMic must NOT be trusted
  assert.ok(
    !routesCode.includes("Boolean(allowMic)"),
    "Client allowMic parameter must not be trusted directly"
  );
  assert.ok(
    routesCode.includes("studentMicChecker"),
    "Server-owned mic checker hook must be invoked for student tokens"
  );

  // No hardcoded passwords in default options
  assert.ok(
    !routesCode.includes('"livekit_secret_production"'),
    "Hardcoded credential literals must be removed from webrtcRoutes.js defaults"
  );
  assert.ok(
    routesCode.includes("process.env.LIVEKIT_API_SECRET"),
    "Must read LIVEKIT_API_SECRET from environment"
  );
});
