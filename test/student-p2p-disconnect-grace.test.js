const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/js/student-live.js"), "utf8");

function extractFunction(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} must exist`);
  const start = source.lastIndexOf("\n", match.index) + 1;
  const next = source.slice(match.index + 1).search(/\n(?:async\s+)?function\s+[\w$]+\s*\(/);
  return source.slice(start, next < 0 ? source.length : match.index + 1 + next);
}

function createFixture(sfuHealthy) {
  const timers = [];
  const calls = { overlay: 0, hide: 0, recover: 0 };
  class FakePeerConnection {
    constructor() {
      this.connectionState = "new";
      this.iceConnectionState = "new";
    }
  }
  const context = {
    RTCPeerConnection: FakePeerConnection,
    rtcConfig: {},
    pc: null,
    p2pDisconnectTimer: null,
    P2P_DISCONNECT_GRACE_MS: 3_500,
    closePeerConnection() {},
    isStudentSfuHealthy: () => sfuHealthy,
    hideConnectionOverlay() { calls.hide += 1; },
    showConnectionOverlay() { calls.overlay += 1; },
    setViewerStatus() {},
    clearRecoveryTimer() {},
    updateChatControls() {},
    scheduleClassRecovery(delay) { calls.recover += delay; },
    window: {
      setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
      clearTimeout() {},
    },
  };
  vm.runInNewContext(extractFunction("createViewerPeerConnection"), context);
  const peer = context.createViewerPeerConnection();
  return { context, peer, timers, calls };
}

test("student ignores P2P disconnect when LiveKit is already delivering media", () => {
  const { peer, timers, calls } = createFixture(true);
  peer.iceConnectionState = "disconnected";
  peer.oniceconnectionstatechange();
  assert.equal(timers.length, 0);
  assert.equal(calls.overlay, 0);
  assert.equal(calls.recover, 0);
});

test("student waits through a brief P2P ICE disconnect before showing recovery UI", () => {
  const { peer, timers, calls } = createFixture(false);
  peer.iceConnectionState = "disconnected";
  peer.oniceconnectionstatechange();
  assert.equal(calls.overlay, 0);
  assert.equal(calls.recover, 0);
  assert.equal(timers[0].delay, 3_500);

  timers[0].callback();
  assert.equal(calls.overlay, 1);
  assert.equal(calls.recover, 2_000);
});
