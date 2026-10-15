"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

// Sample SDP with Opus
const sampleSdp = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
].join("\r\n");

function extractOptimizeOpusSdp(code) {
  const start = code.indexOf("function optimizeOpusSdp(");
  if (start === -1) throw new Error("function optimizeOpusSdp not found");
  let openBraces = 0;
  let started = false;
  let end = -1;
  for (let i = start; i < code.length; i++) {
    if (code[i] === "{") {
      openBraces++;
      started = true;
    } else if (code[i] === "}") {
      openBraces--;
      if (started && openBraces === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return code.slice(start, end);
}

test("Layer 1: Opus SDP optimization disables DTX, enforces FEC, 48kbps bitrate, and 20ms ptime across all clients", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  const mobileTeacher = fs.readFileSync(path.join(root, "public/js/teacher-live-mobile.js"), "utf8");

  for (const [name, code] of [["teacher-live-v2", teacherLive], ["student-live", studentLive], ["teacher-live-mobile", mobileTeacher]]) {
    const fnCode = extractOptimizeOpusSdp(code);
    const ctx = {};
    vm.runInNewContext(`${fnCode}\nthis.optimizeOpusSdp = optimizeOpusSdp;`, ctx);

    const tuned = ctx.optimizeOpusSdp(sampleSdp);
    assert.match(tuned, /usedtx=0/, `${name} must explicitly disable DTX to prevent syllable clipping`);
    assert.match(tuned, /useinbandfec=1/, `${name} must enable Opus in-band FEC`);
    assert.match(tuned, /maxaveragebitrate=48000/, `${name} must set bitrate to 48kbps`);
    assert.match(tuned, /cbr=1/, `${name} must enable constant bitrate for transport stability`);
    assert.match(tuned, /ptime=20/, `${name} must set ptime=20ms`);
  }
});

test("Layer 1: LiveKit SFU publication options disable DTX and enable RED packet loss recovery for teacher and student", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

  // Teacher SFU publishTrack
  assert.match(teacherLive, /name:\s*"teacher-audio"[\s\S]*?dtx:\s*false/);
  assert.match(teacherLive, /name:\s*"teacher-audio"[\s\S]*?red:\s*true/);
  assert.match(teacherLive, /name:\s*"teacher-audio"[\s\S]*?audioBitrate:\s*48000/);

  // Student SFU publishTrack
  assert.match(studentLive, /name:\s*"student-mic"[\s\S]*?dtx:\s*false/);
  assert.match(studentLive, /name:\s*"student-mic"[\s\S]*?red:\s*true/);
  assert.match(studentLive, /name:\s*"student-mic"[\s\S]*?audioBitrate:\s*48000/);
});

test("Layer 1: Adaptive Jitter Buffer target is applied on audio receivers for teacher and student", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  const mobileTeacher = fs.readFileSync(path.join(root, "public/js/teacher-live-mobile.js"), "utf8");

  assert.match(teacherLive, /jitterBufferTarget\s*=\s*80/, "teacher-live-v2 must tune jitterBufferTarget");
  assert.match(studentLive, /jitterBufferTarget\s*=\s*80/, "student-live must tune jitterBufferTarget");
  assert.match(mobileTeacher, /jitterBufferTarget\s*=\s*80/, "teacher-live-mobile must tune jitterBufferTarget");
});

test("Layer 2: MinasatyAudioEnhancer creates studio voice chain with highpass filter and dynamics compression", () => {
  const enhancerSource = fs.readFileSync(path.join(root, "public/js/audio-enhancer.js"), "utf8");

  class MockNode {
    constructor() {
      this.connectedTo = [];
    }
    connect(node) {
      this.connectedTo.push(node);
      return node;
    }
    disconnect() {}
  }

  class MockBiquadFilter extends MockNode {
    constructor() {
      super();
      this.frequency = { value: 0 };
      this.Q = { value: 0 };
      this.gain = { value: 0 };
    }
  }

  class MockCompressor extends MockNode {
    constructor() {
      super();
      this.threshold = { value: 0 };
      this.knee = { value: 0 };
      this.ratio = { value: 0 };
      this.attack = { value: 0 };
      this.release = { value: 0 };
    }
  }

  class MockGainNode extends MockNode {
    constructor() {
      super();
      this.gain = { value: 1 };
    }
  }

  let highpassCreated = null;
  let compressorCreated = null;

  const mockEnhancedTrack = {
    id: "enhanced-track-1",
    kind: "audio",
    contentHint: "",
    readyState: "live",
    addEventListener: () => {},
    stop: () => {},
  };
  const mockTrackList = [mockEnhancedTrack];

  class MockAudioContext {
    constructor() {
      this.state = "running";
    }
    createMediaStreamSource() {
      return new MockNode();
    }
    createBiquadFilter() {
      const filter = new MockBiquadFilter();
      if (!highpassCreated) highpassCreated = filter;
      return filter;
    }
    createDynamicsCompressor() {
      compressorCreated = new MockCompressor();
      return compressorCreated;
    }
    createGain() {
      return new MockGainNode();
    }
    createMediaStreamDestination() {
      const dest = new MockNode();
      dest.stream = {
        getAudioTracks: () => mockTrackList,
      };
      return dest;
    }
    resume() {
      return Promise.resolve();
    }
  }

  const rawTrack = {
    id: "raw-mic-1",
    kind: "audio",
    readyState: "live",
    addEventListener: () => {},
    stop: () => {},
  };
  const rawStream = {
    getAudioTracks: () => [rawTrack],
  };

  const ctx = {
    window: {
      AudioContext: MockAudioContext,
      console,
    },
    module: { exports: {} },
  };

  vm.runInNewContext(enhancerSource, ctx);
  const enhancer = ctx.window.MinasatyAudioEnhancer;
  assert.ok(enhancer, "MinasatyAudioEnhancer must be exported to window");
  assert.equal(enhancer.isSupported(), true);

  const enhanced = enhancer.enhanceStream(rawStream);
  assert.ok(enhanced, "enhanceStream must return stream");

  assert.ok(highpassCreated, "Highpass filter must be created");
  assert.equal(highpassCreated.type, "highpass");
  assert.equal(highpassCreated.frequency.value, 85);

  assert.ok(compressorCreated, "Dynamics compressor must be created");
  assert.equal(compressorCreated.threshold.value, -24);
  assert.equal(compressorCreated.ratio.value, 4.0);
  assert.equal(compressorCreated.attack.value, 0.003);
  assert.equal(compressorCreated.release.value, 0.25);

  const enhancedTrack = enhanced.getAudioTracks()[0];
  assert.equal(enhancedTrack.__enhancedByMinasaty, true);
  assert.equal(enhancedTrack.contentHint, "speech");
});

test("Layer 2: Teacher mix-minus graph in teacher-live-v2.js passes teacher mic through highpass and dynamics compressor", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
  assert.match(teacherLive, /createBiquadFilter\(\)[\s\S]*?hp\.type\s*=\s*"highpass"/);
  assert.match(teacherLive, /createDynamicsCompressor\(\)[\s\S]*?comp\.threshold\.value\s*=\s*-24/);
  assert.match(teacherLive, /intermediateNode\.connect\(hp\)/);
  assert.match(teacherLive, /hp\.connect\(comp\)/);
  assert.match(teacherLive, /intermediateNode\.connect\(gainNode\)/);
});

test("Layer 3: Coturn TLS over port 443 and 5349 provides secure fallback in webrtcRoutes.js", () => {
  const routesCode = fs.readFileSync(path.join(root, "routes/webrtcRoutes.js"), "utf8");

  assert.match(routesCode, /DEFAULT_TURN_TLS_PORT\s*=\s*"443"/);
  assert.match(routesCode, /turns:\$\{tlsEndpoint\}\?transport=tcp/);
  assert.match(routesCode, /turns:\$\{turn\.host\}:5349\?transport=tcp/);

  process.env.COTURN_SECRET = "test_turn_secret_123";
  process.env.COTURN_HOST = "relay.minasaty.com";
  process.env.COTURN_PORT = "3478";
  process.env.COTURN_TLS_PORT = "443";
  process.env.COTURN_REALM = "minasaty.com";

  const router = require("../routes/webrtcRoutes");
  const routeLayer = router.stack.find((l) => l.route && l.route.path === "/ice-servers");
  assert.ok(routeLayer, "/ice-servers route must exist in router");

  const handler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
  let responseData = null;
  let statusCode = 200;

  const mockReq = { user: { id: 1, role: "teacher" } };
  const mockRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  };

  handler(mockReq, mockRes);

  assert.equal(statusCode, 200);
  assert.equal(responseData?.status, "success");
  assert.ok(Array.isArray(responseData?.iceServers));

  const turnServer = responseData.iceServers.find((s) => s.urls && s.urls.some((u) => u.startsWith("turn:")));
  assert.ok(turnServer, "Must contain TURN server config");
  assert.ok(turnServer.username, "Must contain temporary username");
  assert.ok(turnServer.credential, "Must contain HMAC credential");

  const urls = turnServer.urls;
  assert.ok(urls.some((u) => u === "turn:relay.minasaty.com:3478?transport=udp"), "Must include UDP TURN 3478");
  assert.ok(urls.some((u) => u === "turn:relay.minasaty.com:3478?transport=tcp"), "Must include TCP TURN 3478");
  assert.ok(urls.some((u) => u === "turns:relay.minasaty.com:443?transport=tcp"), "Must include TLS TURN on port 443");
  assert.ok(urls.some((u) => u === "turns:relay.minasaty.com:5349?transport=tcp"), "Must include TLS TURN on port 5349");
});
