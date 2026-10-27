"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const enhancerSource = fs.readFileSync(path.join(root, "public/js/audio-enhancer.js"), "utf8");
const studentSource = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

class MockTrack {
  constructor(id, kind = "audio") {
    this.id = id;
    this.kind = kind;
    this.readyState = "live";
    this.enabled = true;
    this.muted = false;
    this.contentHint = "";
    this.listeners = new Map();
    this._settings = {
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
      sampleRate: 48000,
      channelCount: 1,
      deviceId: "mock-mic-dev-1",
      groupId: "mock-mic-group-1",
    };
    this._constraints = {
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
      sampleRate: 48000,
      channelCount: 1,
    };
  }
  getSettings() {
    return { ...this._settings };
  }
  getConstraints() {
    return { ...this._constraints };
  }
  getCapabilities() {
    return {
      echoCancellation: [true, false],
      autoGainControl: [true, false],
      noiseSuppression: [true, false],
      sampleRate: { min: 16000, max: 48000 },
      channelCount: { min: 1, max: 2 },
    };
  }
  addEventListener(event, fn) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
  }
  removeEventListener(event, fn) {
    const list = this.listeners.get(event) || [];
    this.listeners.set(event, list.filter((cb) => cb !== fn));
  }
  stop() {
    this.readyState = "ended";
    const list = this.listeners.get("ended") || [];
    list.forEach((cb) => {
      try { cb(); } catch (_) {}
    });
  }
}

class MockMediaStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(track) {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }
  removeTrack(track) {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}

class MockAudioDestination {
  constructor() {
    this.stream = new MockMediaStream([new MockTrack("enhanced-track", "audio")]);
    this.disconnected = false;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class MockAudioNode {
  constructor(type = "generic") {
    this.type = type;
    this.connectedTo = [];
    this.frequency = { setValueAtTime() {} };
    this.gain = { setValueAtTime() {} };
    this.Q = { setValueAtTime() {} };
    this.threshold = { setValueAtTime() {} };
    this.knee = { setValueAtTime() {} };
    this.ratio = { setValueAtTime() {} };
    this.attack = { setValueAtTime() {} };
    this.release = { setValueAtTime() {} };
    this.fftSize = 256;
    this.smoothingTimeConstant = 0.2;
    this.disconnected = false;
  }
  connect(target) {
    this.connectedTo.push(target);
  }
  disconnect() {
    this.disconnected = true;
    this.connectedTo = [];
  }
  getByteTimeDomainData(array) {
    // Generate a synthetic test sine wave with moderate amplitude (approx 0.25 RMS)
    for (let i = 0; i < array.length; i++) {
      const sample = Math.sin((i / array.length) * 2 * Math.PI) * 0.35;
      array[i] = Math.round(sample * 128 + 128);
    }
  }
}

class MockAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
  }
  createMediaStreamSource() {
    return new MockAudioNode("source");
  }
  createMediaStreamDestination() {
    return new MockAudioDestination();
  }
  createBiquadFilter() {
    return new MockAudioNode("biquad");
  }
  createDynamicsCompressor() {
    return new MockAudioNode("compressor");
  }
  createAnalyser() {
    return new MockAudioNode("analyser");
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

function loadEnhancerContext(sessionStorageData = {}) {
  const store = new Map(Object.entries(sessionStorageData));
  const storage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const windowObj = {
    AudioContext: MockAudioContext,
    sessionStorage: storage,
    location: { search: "" },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    console,
  };
  const ctx = {
    window: windowObj,
    MediaStream: MockMediaStream,
    module: { exports: {} },
  };
  vm.runInNewContext(enhancerSource, ctx);
  return { ctx, enhancer: ctx.window.MinasatyAudioEnhancer, storage };
}

// -----------------------------------------------------------------------------
// Test 1: Diagnostic Mode Selection & Persistence
// -----------------------------------------------------------------------------
test("Student Mic Diagnostic: Default mode is 'current' and supports 3 valid modes", () => {
  const { enhancer, storage } = loadEnhancerContext();
  assert.equal(enhancer.getDiagnosticMode(), "current", "Default diagnostic mode must be 'current'");
  assert.deepEqual(Array.from(enhancer.DIAGNOSTIC_MODES), ["current", "bypass_enhancer", "raw_clean"]);

  // Set to bypass_enhancer
  assert.equal(enhancer.setDiagnosticMode("bypass_enhancer"), true);
  assert.equal(enhancer.getDiagnosticMode(), "bypass_enhancer");
  assert.equal(storage.getItem("minasaty_student_mic_mode"), "bypass_enhancer");

  // Set to raw_clean
  assert.equal(enhancer.setDiagnosticMode("raw_clean"), true);
  assert.equal(enhancer.getDiagnosticMode(), "raw_clean");
  assert.equal(storage.getItem("minasaty_student_mic_mode"), "raw_clean");

  // Reject invalid mode
  assert.equal(enhancer.setDiagnosticMode("invalid_mode_xyz"), false);
  assert.equal(enhancer.getDiagnosticMode(), "raw_clean", "Invalid mode must be rejected and preserve current mode");

  // Re-switch back to current
  assert.equal(enhancer.setDiagnosticMode("current"), true);
  assert.equal(enhancer.getDiagnosticMode(), "current");
});

test("Student Mic Diagnostic: Initializes mode from URL parameters (?micMode=raw_clean)", () => {
  const windowObj = {
    AudioContext: MockAudioContext,
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "?micMode=raw_clean" },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    console,
  };
  const ctx = { window: windowObj, module: { exports: {} } };
  vm.runInNewContext(enhancerSource, ctx);
  const enhancer = ctx.window.MinasatyAudioEnhancer;
  assert.equal(enhancer.getDiagnosticMode(), "raw_clean", "URL parameter ?micMode=raw_clean must set diagnostic mode");
});

// -----------------------------------------------------------------------------
// Test 2: Mode Processing Comparison (Current vs Bypass vs Raw Clean)
// -----------------------------------------------------------------------------
test("Student Mic Diagnostic: 'current' mode applies Web Audio EQ & compressor graph", () => {
  const { enhancer } = loadEnhancerContext();
  enhancer.setDiagnosticMode("current");

  const rawTrack = new MockTrack("raw-student-1");
  const rawStream = new MockMediaStream([rawTrack]);

  const outputStream = enhancer.enhanceStream(rawStream);
  assert.notEqual(outputStream, rawStream, "Mode 'current' must construct enhanced destination stream");
  assert.equal(outputStream.__isSpeechEnhanced, true, "Enhanced stream must be marked __isSpeechEnhanced");
  assert.equal(outputStream.__diagnosticMode, "current");
  assert.equal(outputStream.getAudioTracks()[0].__diagnosticMode, "current");
  assert.equal(outputStream.getAudioTracks()[0].contentHint, "speech");
});

test("Student Mic Diagnostic: 'bypass_enhancer' and 'raw_clean' bypass Web Audio processing completely", () => {
  const { enhancer } = loadEnhancerContext();

  for (const bypassMode of ["bypass_enhancer", "raw_clean"]) {
    enhancer.setDiagnosticMode(bypassMode);

    const rawTrack = new MockTrack("raw-student-" + bypassMode);
    const rawStream = new MockMediaStream([rawTrack]);

    const outputStream = enhancer.enhanceStream(rawStream);
    assert.equal(outputStream, rawStream, `Mode '${bypassMode}' must return raw stream without Web Audio processing`);
    assert.equal(outputStream.__isSpeechEnhanced, false, "Bypassed stream must have __isSpeechEnhanced = false");
    assert.equal(outputStream.__diagnosticMode, bypassMode, `Bypassed stream must record diagnosticMode = ${bypassMode}`);
    assert.equal(rawTrack.__isSpeechEnhanced, false);
    assert.equal(rawTrack.__diagnosticMode, bypassMode);
  }
});

test("Student Mic Diagnostic: options.bypass = true bypasses processing regardless of default mode", () => {
  const { enhancer } = loadEnhancerContext();
  enhancer.setDiagnosticMode("current");

  const rawTrack = new MockTrack("raw-student-opt");
  const rawStream = new MockMediaStream([rawTrack]);

  const outputStream = enhancer.enhanceStream(rawStream, { bypass: true });
  assert.equal(outputStream, rawStream, "Explicit options.bypass = true must bypass Web Audio processing");
  assert.equal(outputStream.__isSpeechEnhanced, false);
});

// -----------------------------------------------------------------------------
// Test 3: Cleanup and Stream Disposal in All Modes
// -----------------------------------------------------------------------------
test("Student Mic Diagnostic: disposeEnhancedStream cleans up enhanced streams and bypassed streams cleanly", () => {
  const { enhancer } = loadEnhancerContext();

  // 1. Enhanced stream disposal
  enhancer.setDiagnosticMode("current");
  const rawTrack1 = new MockTrack("raw-1");
  const rawStream1 = new MockMediaStream([rawTrack1]);
  const enhancedStream = enhancer.enhanceStream(rawStream1);
  const enhancedTrack = enhancedStream.getAudioTracks()[0];

  enhancer.disposeEnhancedStream(enhancedStream, { stopRaw: true });
  assert.equal(rawTrack1.readyState, "ended", "Raw track must be stopped when stopRaw: true");
  assert.equal(enhancedTrack.readyState, "ended", "Enhanced track must reach ended state");

  // 2. Bypassed stream disposal
  enhancer.setDiagnosticMode("bypass_enhancer");
  const rawTrack2 = new MockTrack("raw-2");
  const rawStream2 = new MockMediaStream([rawTrack2]);
  const bypassedStream = enhancer.enhanceStream(rawStream2);

  enhancer.disposeEnhancedStream(bypassedStream, { stopRaw: true });
  assert.equal(rawTrack2.readyState, "ended", "Raw track in bypassed stream must be cleanly stopped");
});

// -----------------------------------------------------------------------------
// Test 4: Input Level Meter (Non-recording, RMS & Peak calculation)
// -----------------------------------------------------------------------------
test("Student Mic Diagnostic: createInputLevelMeter measures RMS and peak without recording audio buffers", () => {
  const { enhancer } = loadEnhancerContext();
  const track = new MockTrack("meter-track");
  const stream = new MockMediaStream([track]);

  const meter = enhancer.createInputLevelMeter(stream);
  assert.ok(meter, "Input level meter must be created");
  assert.equal(typeof meter.getLevel, "function");
  assert.equal(typeof meter.stop, "function");

  // Read active level
  const reading = meter.getLevel();
  assert.ok(reading.level > 0, "Level should register positive value on incoming audio");
  assert.ok(reading.rms > 0, "RMS should be calculated");
  assert.ok(reading.peak > 0, "Peak should be calculated");
  assert.ok(reading.peakPercent >= 0 && reading.peakPercent <= 100);

  // If track is muted, level must immediately drop to 0
  track.muted = true;
  assert.equal(meter.getLevel().level, 0, "Muted track must read 0 level");
  track.muted = false;

  // If track is disabled, level must immediately drop to 0
  track.enabled = false;
  assert.equal(meter.getLevel().level, 0, "Disabled track must read 0 level");
  track.enabled = true;

  // If track is stopped, level must read 0
  track.stop();
  assert.equal(meter.getLevel().level, 0, "Ended track must read 0 level");

  // Clean stop
  meter.stop();
  assert.equal(meter.getLevel().level, 0);
});

// -----------------------------------------------------------------------------
// Test 5: Track Settings and Constraints Diagnostics Extraction
// -----------------------------------------------------------------------------
test("Student Mic Diagnostic: getAudioTrackDiagnostics safely exposes track settings without logging audio", () => {
  const { enhancer } = loadEnhancerContext();
  const track = new MockTrack("diag-track");
  track._settings.noiseSuppression = false;
  track._settings.autoGainControl = false;
  track._settings.echoCancellation = true;

  const diag = enhancer.getAudioTrackDiagnostics(track);
  assert.ok(diag, "Diagnostics object must be returned");
  assert.equal(diag.id, "diag-track");
  assert.equal(diag.kind, "audio");
  assert.equal(diag.readyState, "live");
  assert.equal(diag.enabled, true);
  assert.equal(diag.muted, false);

  // Verify MediaStreamTrack.getSettings() mapping
  assert.equal(diag.settings.echoCancellation, true);
  assert.equal(diag.settings.noiseSuppression, false);
  assert.equal(diag.settings.autoGainControl, false);
  assert.equal(diag.settings.sampleRate, 48000);
  assert.equal(diag.settings.channelCount, 1);

  // Null safety
  assert.equal(enhancer.getAudioTrackDiagnostics(null), null);
  assert.equal(enhancer.getAudioTrackDiagnostics({}), null);
});

// -----------------------------------------------------------------------------
// Test 6: student-live.js Constraints Helper across Diagnostic Modes
// -----------------------------------------------------------------------------
test("Student Mic Diagnostic: getStudentMicrophoneConstraints adjusts browser constraints per mode", () => {
  const ctx = {
    window: {
      MinasatyAudioEnhancer: {
        getDiagnosticMode: () => "current",
      },
    },
  };

  const startFn = studentSource.indexOf("function getStudentMicrophoneConstraints(mode)");
  const endFn = studentSource.indexOf("function clearHandResetTimer()", startFn);
  assert.ok(startFn >= 0 && endFn > startFn, "getStudentMicrophoneConstraints must exist");
  vm.runInNewContext(studentSource.slice(startFn, endFn), ctx);

  // Mode: current
  const currentConstraints = ctx.getStudentMicrophoneConstraints("current");
  assert.equal(currentConstraints.echoCancellation, true);
  assert.equal(currentConstraints.noiseSuppression, true);
  assert.equal(currentConstraints.autoGainControl, true);

  // Mode: bypass_enhancer
  const bypassConstraints = ctx.getStudentMicrophoneConstraints("bypass_enhancer");
  assert.equal(bypassConstraints.echoCancellation, true);
  assert.equal(bypassConstraints.noiseSuppression, true);
  assert.equal(bypassConstraints.autoGainControl, true);

  // Mode: raw_clean (Browser NS=false, AGC=false, EC=true)
  const rawCleanConstraints = ctx.getStudentMicrophoneConstraints("raw_clean");
  assert.equal(rawCleanConstraints.echoCancellation, true, "Echo cancellation must remain enabled by default");
  assert.equal(rawCleanConstraints.noiseSuppression, false, "Noise suppression must be disabled in raw_clean mode");
  assert.equal(rawCleanConstraints.autoGainControl, false, "Auto gain control must be disabled in raw_clean mode");
});

// -----------------------------------------------------------------------------
// Test 7: student-live.js Dynamic Mode Switcher (window.setStudentMicDiagnosticMode)
// -----------------------------------------------------------------------------
test("Student Mic Diagnostic: setStudentMicDiagnosticMode seamlessly updates mode and swaps live track", async () => {
  const rawTrack = new MockTrack("raw-mic-init");
  const rawStream = new MockMediaStream([rawTrack]);

  let replacedTrack = null;
  const mockSender = {
    track: rawTrack,
    replaceTrack: async (track) => {
      replacedTrack = track;
    },
  };

  let unpublishCount = 0;
  let publishCount = 0;
  const mockSfuRoom = {
    localParticipant: {
      unpublishTrack: async () => {
        unpublishCount++;
      },
    },
  };

  let userMediaConstraints = null;
  const mockNavigator = {
    mediaDevices: {
      getUserMedia: async (opts) => {
        userMediaConstraints = opts.audio;
        return new MockMediaStream([new MockTrack("fresh-raw-mic")]);
      },
    },
  };

  let enhancerMode = "current";
  const mockEnhancer = {
    getDiagnosticMode: () => enhancerMode,
    setDiagnosticMode: (m) => { enhancerMode = m; return true; },
    enhanceStream: (stream, opts) => {
      if (opts?.mode === "current") {
        return new MockMediaStream([new MockTrack("enhanced-swapped-track")]);
      }
      return stream;
    },
    disposeEnhancedStream: (stream, opts) => {
      if (opts?.stopRaw) {
        stream?.getTracks?.().forEach((t) => t.stop());
      }
    },
    createInputLevelMeter: () => ({ getLevel: () => ({ level: 25, rms: 0.1, peak: 0.2 }), stop() {} }),
    getAudioTrackDiagnostics: (t) => ({ id: t.id, readyState: t.readyState }),
  };

  const recordedEvents = [];
  const ctx = {
    window: {
      MinasatyAudioEnhancer: mockEnhancer,
    },
    localAudioStream: rawStream,
    localAudioRawStream: rawStream,
    localAudioRawTrack: rawTrack,
    studentP2pMicSender: mockSender,
    studentSfuRoom: mockSfuRoom,
    studentSfuMicPub: { track: rawTrack },
    microphonePrepared: true,
    microphonePermissionGranted: true,
    joinedClass: true,
    navigator: mockNavigator,
    recordStudentDiagnosticEvent: (t, m) => recordedEvents.push({ t, m }),
    updateMicControl: () => {},
    publishStudentSfuMic: async () => {
      publishCount++;
      return true;
    },
  };

  // Run the helper functions in context
  const startConstraints = studentSource.indexOf("function getStudentMicrophoneConstraints(mode)");
  const endConstraints = studentSource.indexOf("function clearHandResetTimer()", startConstraints);
  vm.runInNewContext(studentSource.slice(startConstraints, endConstraints), ctx);

  const startSetupMeter = studentSource.indexOf("function setupStudentMicLevelMeter(streamOrTrack)");
  const endSetupMeter = studentSource.indexOf("function getStudentMicrophoneConstraints(mode)", startSetupMeter);
  vm.runInNewContext(studentSource.slice(startSetupMeter, endSetupMeter), ctx);

  const startSwitcher = studentSource.indexOf("window.setStudentMicDiagnosticMode = async function");
  const endSwitcher = studentSource.indexOf("function stopSfuReceptionMonitor()", startSwitcher);
  vm.runInNewContext(studentSource.slice(startSwitcher, endSwitcher), ctx);

  // Switch to raw_clean
  const result = await ctx.window.setStudentMicDiagnosticMode("raw_clean");
  assert.equal(result.ok, true);
  assert.equal(result.mode, "raw_clean");
  assert.equal(result.switchedLive, true);

  // Verify constraints requested from getUserMedia
  assert.equal(userMediaConstraints.noiseSuppression, false, "Must request noiseSuppression: false");
  assert.equal(userMediaConstraints.autoGainControl, false, "Must request autoGainControl: false");
  assert.equal(userMediaConstraints.echoCancellation, true, "Must request echoCancellation: true");

  // Verify P2P sender was replaced without connection teardown
  assert.ok(replacedTrack, "P2P sender track must be replaced");
  assert.equal(replacedTrack.id, "fresh-raw-mic");

  // Verify SFU unpublish and re-publish
  assert.equal(unpublishCount, 1, "Old SFU mic publication must be unpublished");
  assert.equal(publishCount, 1, "New stream must be published to SFU");

  // Verify old raw track was cleanly stopped
  assert.equal(rawTrack.readyState, "ended", "Old microphone track must be cleanly stopped");

  // Verify diagnostic event was recorded
  assert.ok(recordedEvents.some((e) => e.t === "student_mic_mode_switched" && e.m.includes("raw_clean")));
});

// -----------------------------------------------------------------------------
// Test 8: window.getMinasatyStudentMicDiagnostics payload structure
// -----------------------------------------------------------------------------
test("Student Mic Diagnostic: getMinasatyStudentMicDiagnostics exposes track settings and live input level", () => {
  const track = new MockTrack("live-student-track");
  const stream = new MockMediaStream([track]);

  const ctx = {
    window: {
      MinasatyAudioEnhancer: {
        getDiagnosticMode: () => "current",
        getAudioTrackDiagnostics: (t) => ({
          id: t.id,
          settings: t.getSettings(),
          constraints: t.getConstraints(),
        }),
      },
    },
    localAudioStream: stream,
    localAudioRawStream: stream,
    localAudioRawTrack: track,
    microphonePrepared: true,
    studentP2pMicSender: { track },
    studentSfuMicPub: { track },
    getStudentMicInputLevel: () => ({ level: 42, rms: 0.14, peak: 0.35, peakPercent: 35 }),
  };

  const startDiag = studentSource.indexOf("window.getMinasatyStudentMicDiagnostics = function");
  const endDiag = studentSource.indexOf("window.setStudentMicDiagnosticMode", startDiag);
  assert.ok(startDiag >= 0 && endDiag > startDiag);
  vm.runInNewContext(studentSource.slice(startDiag, endDiag), ctx);

  const diag = ctx.window.getMinasatyStudentMicDiagnostics();
  assert.equal(diag.mode, "current");
  assert.deepEqual(Array.from(diag.availableModes), ["current", "bypass_enhancer", "raw_clean"]);
  assert.equal(diag.isMicrophoneActive, true);
  assert.equal(diag.isMicrophonePrepared, true);
  assert.equal(diag.p2pPublished, true);
  assert.equal(diag.sfuPublished, true);
  assert.equal(diag.inputLevel.level, 42);
  assert.equal(diag.rawTrackSettings.echoCancellation, true);
  assert.equal(diag.rawTrackSettings.noiseSuppression, true);
  assert.equal(diag.rawTrackSettings.autoGainControl, true);
  assert.equal(diag.rawTrackSettings.sampleRate, 48000);
});
