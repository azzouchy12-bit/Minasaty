"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const teacherSource = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
const studentSource = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
const enhancerSource = fs.readFileSync(path.join(root, "public/js/audio-enhancer.js"), "utf8");

class MockTrack {
  constructor(id, kind = "audio") {
    this.id = id;
    this.kind = kind;
    this.readyState = "live";
    this.enabled = true;
    this.muted = false;
    this.listeners = new Map();
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
  constructor(name) {
    this.name = name;
    this.inputs = [];
    this.stream = new MockMediaStream([new MockTrack(name + "-track", "audio")]);
    this.isDisconnected = false;
  }
  disconnect() {
    this.inputs = [];
    this.isDisconnected = true;
  }
}

class MockAudioNode {
  constructor(name) {
    this.name = name;
    this.connectedTo = [];
    this.gain = { value: 1.0 };
    this.isDisconnected = false;
  }
  connect(target) {
    this.connectedTo.push(target);
    if (target instanceof MockAudioDestination) {
      target.inputs.push(this.name);
    }
  }
  disconnect() {
    this.isDisconnected = true;
    this.connectedTo.forEach((target) => {
      if (target instanceof MockAudioDestination) {
        target.inputs = target.inputs.filter((src) => src !== this.name);
      }
    });
    this.connectedTo = [];
  }
}

// -----------------------------------------------------------------------------
// Priority 1: Real Per-Recipient Mix-Minus Verification
// -----------------------------------------------------------------------------
test("Priority 1: Real per-recipient mix-minus graph isolates student's own mic, mixes classmates, and deduplicates SFU/P2P", () => {
  const destinationsCreated = new Map();

  const mockAudioContext = {
    state: "running",
    resume: async () => {},
    createMediaStreamDestination: () => {
      const dest = new MockAudioDestination("dest-" + (destinationsCreated.size + 1));
      destinationsCreated.set(dest.name, dest);
      return dest;
    },
    createMediaStreamSource: (stream) => new MockAudioNode(stream.id || "source-node"),
    createGain: () => new MockAudioNode("gain-node"),
  };

  const teacherGain = new MockAudioNode("__teacher_microphone__");
  const screenGain = new MockAudioNode("__screen_audio__");
  const studentAGain = new MockAudioNode("student-a-mic");
  const studentBGain = new MockAudioNode("student-b-mic");

  const studentAStream = new MockMediaStream([new MockTrack("track-a", "audio")]);
  studentAStream.id = "student-a-mic";
  const studentBStream = new MockMediaStream([new MockTrack("track-b", "audio")]);
  studentBStream.id = "student-b-mic";

  const destA = new MockAudioDestination("student-a-dest");
  const destB = new MockAudioDestination("student-b-dest");

  const classroomAudioSources = new Map([
    ["__teacher_microphone__", { node: teacherGain, gainNode: teacherGain, enabled: true }],
    ["__screen_audio__", { node: screenGain, gainNode: screenGain, enabled: true }],
    ["socket-a", { node: studentAGain, gainNode: studentAGain, stream: studentAStream, enabled: true }],
    ["socket-b", { node: studentBGain, gainNode: studentBGain, stream: studentBStream, enabled: true }],
  ]);

  const classroomAudioDestinations = new Map([
    ["socket-a", destA],
    ["socket-b", destB],
  ]);

  const approvedStudentMicrophones = new Set(["socket-a", "socket-b", "student-a-id", "student-b-id"]);
  const attendeeElements = new Map([
    ["socket-a", { dataset: { studentId: "student-a-id" } }],
    ["socket-b", { dataset: { studentId: "student-b-id" } }],
  ]);
  const attendeeSocketByStudentId = new Map([
    ["student-a-id", "socket-a"],
    ["student-b-id", "socket-b"],
  ]);

  const ctx = {
    classroomAudioContext: mockAudioContext,
    classActive: true,
    classroomAudioSources,
    classroomAudioDestinations,
    approvedStudentMicrophones,
    attendeeElements,
    attendeeSocketByStudentId,
    teacherMicGainNode: teacherGain,
    teacherMicAnalyserNode: null,
    isStudentMicrophoneApproved: (id) => approvedStudentMicrophones.has(id),
    getSocketIdForStudentIdentity: (id) => attendeeSocketByStudentId.get(id) || null,
  };

  const startRebuild = teacherSource.indexOf("function rebuildClassroomAudioGraph()");
  const endRebuild = teacherSource.indexOf("\nfunction removeClassroomAudioSource", startRebuild);
  assert.ok(startRebuild >= 0 && endRebuild > startRebuild);
  vm.runInNewContext(teacherSource.slice(startRebuild, endRebuild), ctx);

  // 1. Rebuild graph with both Student A and Student B speaking
  ctx.rebuildClassroomAudioGraph();

  // Student A destination: receives Teacher mic, Screen audio, and Student B mic. MUST NOT contain Student A's own mic!
  assert.ok(destA.inputs.includes("__teacher_microphone__"), "Student A must hear teacher microphone");
  assert.ok(destA.inputs.includes("__screen_audio__"), "Student A must hear screen audio");
  assert.ok(destA.inputs.includes("student-b-mic"), "Student A must hear Student B's approved microphone");
  assert.equal(destA.inputs.includes("student-a-mic"), false, "Student A's own microphone must be EXCLUDED from Student A's mix");

  // Student B destination: receives Teacher mic, Screen audio, and Student A mic. MUST NOT contain Student B's own mic!
  assert.ok(destB.inputs.includes("__teacher_microphone__"), "Student B must hear teacher microphone");
  assert.ok(destB.inputs.includes("__screen_audio__"), "Student B must hear screen audio");
  assert.ok(destB.inputs.includes("student-a-mic"), "Student B must hear Student A's approved microphone");
  assert.equal(destB.inputs.includes("student-b-mic"), false, "Student B's own microphone must be EXCLUDED from Student B's mix");

  // 2. Revoking Student B's approval removes that mic from every destination
  approvedStudentMicrophones.delete("socket-b");
  approvedStudentMicrophones.delete("student-b-id");
  classroomAudioSources.get("socket-b").enabled = false;

  ctx.rebuildClassroomAudioGraph();

  assert.equal(destA.inputs.includes("student-b-mic"), false, "Revoked Student B must be removed from Student A destination");
  assert.equal(destB.inputs.includes("student-b-mic"), false, "Revoked Student B must not be in Student B destination");
  assert.ok(destA.inputs.includes("__teacher_microphone__"), "Teacher mic must remain intact after revocation");
  assert.ok(destB.inputs.includes("__teacher_microphone__"), "Teacher mic must remain intact on Student B");

  // 3. Deduplication: Student A arriving over both SFU (sfu_student-a-id) and P2P (socket-a)
  approvedStudentMicrophones.add("socket-a");
  approvedStudentMicrophones.add("student-a-id");
  classroomAudioSources.get("socket-a").enabled = true;

  const sfuGainNode = new MockAudioNode("student-a-sfu");
  classroomAudioSources.set("sfu_student-a-id", {
    node: sfuGainNode,
    gainNode: sfuGainNode,
    stream: studentAStream,
    enabled: true,
  });

  ctx.rebuildClassroomAudioGraph();

  // Student B destination should only connect Student A once (no comb filtering / double mixing)
  const studentAOccurrencesInB = destB.inputs.filter((src) => src === "student-a-mic" || src === "student-a-sfu");
  assert.equal(studentAOccurrencesInB.length, 1, "Speaker arriving over both SFU and P2P must only be mixed once");
});

test("Priority 2: Approved student sender continues to receive full mix-minus destination instead of teacher-mic only", () => {
  const destA = new MockAudioDestination("student-a-dest");
  const destB = new MockAudioDestination("student-b-dest");
  const teacherTrack = new MockTrack("teacher-camera-audio-track", "audio");
  const teacherStream = new MockMediaStream([teacherTrack]);

  const mockPc = {
    signalingState: "stable",
    remoteDescription: {},
    senders: [],
    getSenders() { return this.senders; },
    addTrack(track, stream) {
      const sender = { track, stream, replaceTrack: async (t) => { sender.track = t; } };
      this.senders.push(sender);
      return sender;
    },
  };

  const ctx = {
    classroomAudioContext: { state: "running", resume: async () => {}, createMediaStreamDestination: () => destA },
    classroomAudioDestinations: new Map([["socket-a", destA], ["socket-b", destB]]),
    approvedStudentMicrophones: new Set(["socket-a", "student-a-id"]),
    attendeeElements: new Map([["socket-a", { dataset: { studentId: "student-a-id" } }]]),
    cameraStream: teacherStream,
    getActiveTeacherAudioTrack: () => teacherTrack,
    tuneOutboundSender: () => {},
    createAndSendOffer: () => {},
    rebuildClassroomAudioGraph: () => {},
  };

  const startEnsureDest = teacherSource.indexOf("function ensureStudentAudioDestination(");
  const endEnsureDest = teacherSource.indexOf("\nfunction syncMixMinusAudioToAllPeers", startEnsureDest);
  assert.ok(startEnsureDest >= 0 && endEnsureDest > startEnsureDest);
  vm.runInNewContext(teacherSource.slice(startEnsureDest, endEnsureDest), ctx);

  // When ensureStudentAudioSender runs for approved student socket-a:
  const sender = ctx.ensureStudentAudioSender(mockPc, "socket-a", { renegotiate: false });
  assert.ok(sender, "Sender must be created");
  // Sender track must be student-a's mix-minus track, NOT teacher mic alone!
  assert.equal(sender.track, destA.stream.getAudioTracks()[0], "Approved student must receive their distinct mix-minus destination track");
  assert.notEqual(sender.track, teacherTrack, "Approved student must NOT be restricted to teacher track alone");
});

// -----------------------------------------------------------------------------
// Priority 1: Raw Microphone Track Release and Audio Enhancer Teardown
// -----------------------------------------------------------------------------
test("Priority 1: Stopping student microphone stops underlying raw getUserMedia track and disconnects Web Audio graph", () => {
  const rawTrack = new MockTrack("raw-mic-1", "audio");
  const rawStream = new MockMediaStream([rawTrack]);

  const disconnectedNodes = [];
  class MockBiquadFilter {
    constructor() {
      this.type = "";
      this.frequency = { setValueAtTime() {} };
      this.gain = { setValueAtTime() {} };
      this.Q = { setValueAtTime() {} };
    }
    connect(dest) {}
    disconnect() { disconnectedNodes.push(this); }
  }

  class MockCompressor {
    constructor() {
      this.threshold = { setValueAtTime() {} };
      this.knee = { setValueAtTime() {} };
      this.ratio = { setValueAtTime() {} };
      this.attack = { setValueAtTime() {} };
      this.release = { setValueAtTime() {} };
    }
    connect(dest) {}
    disconnect() { disconnectedNodes.push(this); }
  }

  let destNodeCreated = null;
  class MockMediaStreamDestination {
    constructor() {
      this.stream = new MockMediaStream([new MockTrack("enhanced-track-1", "audio")]);
      this.isDisconnected = false;
      destNodeCreated = this;
    }
    disconnect() {
      this.isDisconnected = true;
      disconnectedNodes.push(this);
    }
  }

  class MockAudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; }
    createMediaStreamSource(st) {
      return {
        connect() {},
        disconnect() { disconnectedNodes.push(this); },
      };
    }
    createMediaStreamDestination() { return new MockMediaStreamDestination(); }
    createBiquadFilter() { return new MockBiquadFilter(); }
    createDynamicsCompressor() { return new MockCompressor(); }
    resume() { return Promise.resolve(); }
  }

  const enhancerContext = {
    window: {
      AudioContext: MockAudioContext,
      webkitAudioContext: MockAudioContext,
      addEventListener() {},
      removeEventListener() {},
    },
    document: { addEventListener() {}, removeEventListener() {} },
    console,
    module: { exports: {} },
  };

  vm.runInNewContext(enhancerSource, enhancerContext);
  const enhancer = enhancerContext.window.MinasatyAudioEnhancer;

  // Enhance the raw capture stream
  const enhancedStream = enhancer.enhanceStream(rawStream);
  assert.ok(enhancedStream, "Enhanced stream must be created");
  const enhancedTrack = enhancedStream.getAudioTracks()[0];
  assert.equal(enhancedTrack.readyState, "live");
  assert.equal(rawTrack.readyState, "live");

  // Call disposeEnhancedStream
  enhancer.disposeEnhancedStream(enhancedStream, { stopRaw: true });

  // Both enhanced track and raw capture track must reach 'ended'
  assert.equal(enhancedTrack.readyState, "ended", "Enhanced track must reach ended state");
  assert.equal(rawTrack.readyState, "ended", "Raw capture track must reach ended state");
  assert.ok(destNodeCreated.isDisconnected, "Destination node must be disconnected");
  assert.ok(disconnectedNodes.length >= 4, "All Web Audio graph filter nodes must be disconnected");

  // Test idempotency: calling dispose again must not throw
  assert.doesNotThrow(() => {
    enhancer.disposeEnhancedStream(enhancedStream, { stopRaw: true });
    enhancedTrack.stop();
  });
});

test("Priority 1: student-live.js stopLocalAudio() cleans up raw tracks and enhanced Web Audio stream", () => {
  const rawTrack = new MockTrack("raw-mic-2", "audio");
  const rawStream = new MockMediaStream([rawTrack]);

  let disposedStream = null;
  let disposedStopRaw = null;

  const ctx = {
    localAudioStream: rawStream,
    localAudioRawStream: rawStream,
    localAudioRawTrack: rawTrack,
    unpublishStudentSfuMic: () => {},
    unpublishStudentP2pMic: () => {},
    updateMicControl: () => {},
    window: {
      MinasatyAudioEnhancer: {
        disposeEnhancedStream: (stream, opts) => {
          disposedStream = stream;
          disposedStopRaw = opts?.stopRaw;
        },
      },
    },
  };

  const startStop = studentSource.indexOf("function stopLocalAudio()");
  const endStop = studentSource.indexOf("async function prepareStudentMicrophone", startStop);
  assert.ok(startStop >= 0 && endStop > startStop);

  vm.runInNewContext(studentSource.slice(startStop, endStop), ctx);

  ctx.stopLocalAudio();

  assert.equal(disposedStream, rawStream, "stopLocalAudio must invoke disposeEnhancedStream with localAudioStream");
  assert.equal(disposedStopRaw, true, "stopLocalAudio must request stopRaw = true");
  assert.equal(rawTrack.readyState, "ended", "Raw capture track must reach ended state");
  assert.equal(ctx.localAudioStream, undefined, "localAudioStream must be reset");
  assert.equal(ctx.localAudioRawStream, null, "localAudioRawStream must be cleared");
  assert.equal(ctx.localAudioRawTrack, null, "localAudioRawTrack must be cleared");
});

// -----------------------------------------------------------------------------
// Priority 1: Recording Lifecycle & Waiting for Final Chunk Writes
// -----------------------------------------------------------------------------
test("Priority 1: finalizeLocalRecording awaits pending asynchronous IndexedDB writes before reading and assembling artifact", async () => {
  const savedChunksInDb = [];
  let delayedWritePromiseResolve = null;

  const mockSaveRecordingChunk = (chunk) => {
    return new Promise((resolve) => {
      // Intentionally simulate delayed IndexedDB async write (e.g. disk I/O lag)
      setTimeout(() => {
        savedChunksInDb.push(chunk);
        resolve(true);
      }, 50);
    });
  };

  const mockRetrieveRecordingChunks = async () => {
    return [...savedChunksInDb];
  };

  let finishedArtifact = null;
  const ctx = {
    localRecordingFinalized: false,
    localRecordingFinalizing: false,
    localRecordingPendingChunkWrites: new Set(),
    localRecordingChunks: [],
    localRecordingMimeType: "video/webm",
    localRecordingDownloadRequested: false,
    localRecordingStopResolver: null,
    saveRecordingChunkToStorage: mockSaveRecordingChunk,
    retrieveRecordingChunksFromStorage: mockRetrieveRecordingChunks,
    createLocalRecordingArtifact: (chunks, mimeType) => {
      finishedArtifact = { chunks, count: chunks.length, mimeType };
      return finishedArtifact;
    },
    elements: {
      saveDriveButton: { dataset: {} },
      localRecordingState: {},
      recordLocalButton: { classList: { remove() {} } },
    },
    setButtonLabel: () => {},
    disposeLocalRecordingResources: () => {},
    clearRecordingDb: async () => {},
    downloadLocalRecording: () => false,
    updateControls: () => {},
    showRecordingReadyModal: () => {},
    uploadRecordingToYouTube: async () => {},
    classActive: true,
    isEnding: false,
    isPageNavigatingAway: false,
    setStudioStatus: () => {},
  };

  const startFinalize = teacherSource.indexOf("async function finalizeLocalRecording()");
  const endFinalize = teacherSource.indexOf("function startLocalRecording()", startFinalize);
  assert.ok(startFinalize >= 0 && endFinalize > startFinalize);
  vm.runInNewContext(teacherSource.slice(startFinalize, endFinalize), ctx);

  // Simulate ondataavailable receiving chunk 1, chunk 2, and final chunk 3
  const chunk1 = { size: 1024, name: "chunk-1" };
  const chunk2 = { size: 2048, name: "chunk-2" };
  const chunk3 = { size: 4096, name: "final-chunk-3" };

  for (const chunk of [chunk1, chunk2, chunk3]) {
    const writePromise = (async () => {
      const ok = await ctx.saveRecordingChunkToStorage(chunk);
      if (!ok) ctx.localRecordingChunks.push(chunk);
    })();
    ctx.localRecordingPendingChunkWrites.add(writePromise);
    writePromise.finally(() => {
      ctx.localRecordingPendingChunkWrites.delete(writePromise);
    });
  }

  // Final chunk write is still pending in flight when finalizeLocalRecording is triggered!
  assert.ok(ctx.localRecordingPendingChunkWrites.size > 0, "Writes must be in flight");

  // Call finalizeLocalRecording
  await ctx.finalizeLocalRecording();

  // The finished artifact MUST contain all 3 chunks, including the final chunk!
  assert.ok(finishedArtifact, "Artifact must be created");
  assert.equal(finishedArtifact.count, 3, "Artifact must contain exactly 3 chunks");
  assert.equal(finishedArtifact.chunks[2], chunk3, "Artifact must include the delayed final chunk");
  assert.equal(ctx.localRecordingFinalized, true, "Recording must be finalized");

  // Test idempotency: calling finalize again does not duplicate or re-run
  const firstArtifact = finishedArtifact;
  await ctx.finalizeLocalRecording();
  assert.equal(finishedArtifact, firstArtifact, "Finalization must be strictly idempotent");
});
