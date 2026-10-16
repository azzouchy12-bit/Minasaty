const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const teacher = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");
const student = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
function fn(source, name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, name);
  return match[0];
}
function fixture() {
  let now = 1_000;
  const timers = [], offers = [], events = [], closed = [];
  const ctx = {
    classActive: true, attendeeElements: new Map([["student", {}]]),
    studentMediaTransports: new Map(), studentSfuFallbackTimers: new Map(), studentSfuReturnTimers: new Map(),
    peerConnections: {}, STUDENT_SFU_FALLBACK_DELAY_MS: 5_000, STUDENT_SFU_RETURN_CONFIRM_MS: 3_000,
    STUDENT_RECOVERY_COOLDOWN_MS: 15_000, MAX_STUDENT_RECOVERY_ATTEMPTS: 3,
    Date: { now: () => now }, isTeacherSfuHealthy: () => true, isTeacherSfuConnecting: false,
    teacherSfuRoom: { state: "connected" },
    getActiveTeacherAudioTrack: () => ({ readyState: "live", enabled: true }),
    getActiveTeacherVideoTrack: () => ({ readyState: "live", enabled: true }),
    setTimeout(callback, delay) { const timer = { callback, at: now + delay }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; },
    createAndSendOffer(id) { offers.push(id); },
    closePeerConnection(id) { closed.push(id); delete ctx.peerConnections[id]; },
    recordLiveDiagnosticEvent(type) { events.push(type); }, renderAttendeeTransportStatus() {},
    console: { info() {} },
  };
  vm.runInNewContext(fn(teacher, "transitionStudentToP2pFallback") + "\n" + fn(teacher, "handleStudentTransportUpdated"), ctx);
  function advance(ms) {
    now += ms;
    for (const timer of timers) {
      if (!timer.cleared && !timer.fired && timer.at <= now) { timer.fired = true; timer.callback(); }
    }
  }
  const report = (overrides = {}) => ctx.handleStudentTransportUpdated({
    socketId: "student", transport: "sfu", receiving: false, receivingAudio: false, receivingVideo: false,
    ...overrides,
  });
  return { ctx, timers, offers, events, closed, advance, report };
}

test("Working P2P survives hundreds of SFU no-media reports without recovery timers", () => {
  const f = fixture();
  for (let i = 0; i < 200; i++) {
    f.report({ p2p: { receiving: true, receivingAudio: true, receivingVideo: true } });
    f.advance(1_500);
  }
  assert.equal(f.timers.length, 0);
  assert.equal(f.offers.length, 0);
  assert.equal(f.events.length, 0);
  assert.equal(f.ctx.studentMediaTransports.get("student").transport, "p2p");
  assert.equal(f.ctx.studentMediaTransports.get("student").sfuReady, false);
});

test("P2P audio alone cannot hide a missing shared screen", () => {
  const f = fixture();
  f.report({ p2p: { receiving: true, receivingAudio: true, receivingVideo: false } });
  f.advance(5_000);
  assert.equal(f.offers.length, 1);
});

test("Persistent no-media recovery has a cooldown, three attempts, and one exhaustion notice", () => {
  const f = fixture();
  for (let i = 0; i < 600; i++) { f.report(); f.advance(1_500); }
  assert.equal(f.offers.length, 3);
  assert.equal(f.events.filter((type) => type === "student_not_receiving").length, 3);
  assert.equal(f.events.filter((type) => type === "student_recovery_exhausted").length, 1);
  assert.equal(f.ctx.studentMediaTransports.get("student").recoveryExhausted, true);
});

test("A connected but stalled P2P peer can be recovered, while working media cancels recovery", () => {
  const f = fixture();
  f.ctx.peerConnections.student = { __teacherP2pFallback: true, connectionState: "connected" };
  f.report(); f.advance(5_000);
  assert.equal(f.offers.length, 1);
  f.report({ p2p: { receiving: true, receivingAudio: true, receivingVideo: true } });
  f.advance(60_000);
  assert.equal(f.offers.length, 1);
  assert.equal(f.ctx.studentMediaTransports.get("student").recoveryAttempts, 0);
});

test("SFU must remain confirmed before ending P2P video fallback; P2P audio is permanently preserved", () => {
  const f = fixture();
  f.ctx.peerConnections.student = { __teacherP2pFallback: true, connectionState: "connected" };
  const healthy = { receiving: true, receivingAudio: true, receivingVideo: true };
  f.report(healthy); f.advance(1_500);
  f.report({ p2p: healthy }); f.advance(3_000);
  assert.equal(f.ctx.peerConnections.student.__teacherP2pFallback, true);
  f.report(healthy); f.advance(1_500); f.report(healthy); f.advance(1_500);
  assert.equal(f.ctx.peerConnections.student.__teacherP2pFallback, false, "Fallback flag must be cleared");
  assert.equal(f.closed.length, 0, "P2P connection must NOT be closed to preserve audio");
});

test("A student leaving before a recovery timer fires receives no stale offer", () => {
  const f = fixture(); f.report();
  f.ctx.attendeeElements.delete("student"); f.advance(5_000);
  assert.equal(f.offers.length, 0);
  f.report(); assert.equal(f.timers.length, 1);
});

test("Legacy P2P reports still cancel recovery even without dual-transport telemetry", () => {
  const f = fixture(); f.report();
  f.report({ transport: "p2p", receiving: true, receivingAudio: true, receivingVideo: true });
  f.advance(10_000); assert.equal(f.offers.length, 0);
});

function p2pFixture() {
  let now = 1_000, bytes = 100, units = 10;
  const track = { kind: "video", readyState: "live", enabled: true, muted: false };
  const receiver = { track, getStats: async () => new Map([["video", { type: "inbound-rtp", kind: "video", bytesReceived: bytes, framesDecoded: units }]]) };
  const ctx = {
    pc: { connectionState: "connected", getReceivers: () => [receiver] }, joinedClass: true,
    studentP2pMediaProgress: new Map(), studentP2pReceptionBusy: false,
    Date: { now: () => now }, window: { setTimeout: () => 1, clearTimeout() {} }, notifySfuTransportStatus() {},
  };
  vm.runInNewContext(fn(student, "getTeacherP2pReceptionState") + "\n" + fn(student, "sampleTeacherP2pReception"), ctx);
  return { ctx, track, receiver, advance: () => { bytes += 100; units++; now += 3_000; }, expire: () => { now += 9_000; } };
}

test("P2P reception requires advancing inbound bytes and decoded frames, and expires on stall", async () => {
  const f = p2pFixture();
  await f.ctx.sampleTeacherP2pReception(); assert.equal(f.ctx.getTeacherP2pReceptionState().receiving, false);
  f.advance(); await f.ctx.sampleTeacherP2pReception(); assert.equal(f.ctx.getTeacherP2pReceptionState().receivingVideo, true);
  f.expire(); await f.ctx.sampleTeacherP2pReception(); assert.equal(f.ctx.getTeacherP2pReceptionState().receiving, false);
});

test("Failed stats, ended tracks and replacement peers cannot claim working P2P", async () => {
  const f = p2pFixture();
  await f.ctx.sampleTeacherP2pReception(); f.advance(); await f.ctx.sampleTeacherP2pReception();
  f.track.readyState = "ended"; assert.equal(f.ctx.getTeacherP2pReceptionState().receiving, false);
  f.track.readyState = "live"; f.receiver.getStats = async () => { throw Error("unavailable"); };
  await f.ctx.sampleTeacherP2pReception(); assert.equal(f.ctx.getTeacherP2pReceptionState().receiving, false);
  f.ctx.pc = { connectionState: "connected", getReceivers: () => [f.receiver] };
  assert.equal(f.ctx.getTeacherP2pReceptionState().receiving, false);
});

function imageFixture(fetch) {
  const ctx = { fetch, AbortController, setTimeout(fn, delay) { if (delay < 10_000) fn(); return 1; }, clearTimeout() {} };
  vm.runInNewContext(fn(teacher, "fetchClassroomImageBlob"), ctx);
  return ctx;
}
test("Question image retries a transient network failure and preserves the original blob", async () => {
  let calls = 0; const original = new Blob(["original-image-bytes"]);
  const ctx = imageFixture(async () => { if (++calls === 1) throw TypeError("HTTP2_PING_FAILED"); return { ok: true, blob: async () => original }; });
  assert.equal(await ctx.fetchClassroomImageBlob("/image", {}), original);
  assert.equal(calls, 2);
});
test("Question image never retries authorization failure and caps temporary failures at three", async () => {
  let calls = 0;
  const ctx = imageFixture(async () => { calls++; return { ok: false, status: 403, json: async () => ({ error: "unauthorized" }) }; });
  await assert.rejects(ctx.fetchClassroomImageBlob("/image", {}), /unauthorized/); assert.equal(calls, 1);
  const failed = imageFixture(async () => { calls++; throw TypeError("network failed"); });
  await assert.rejects(failed.fetchClassroomImageBlob("/image", {}), /network failed/); assert.equal(calls, 4);
});

test("Server forwards independent SFU/P2P reception only for a joined student", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const start = source.indexOf('  socket.on("student_media_transport_status",');
  const end = source.indexOf('  socket.on("student_request_p2p_stream",', start);
  let handler;
  const emitted = [];
  const socket = { id: "student", data: { role: "student", roomLevel: "room" },
    rooms: new Set(["room"]), on(_event, callback) { handler = callback; } };
  const ctx = { socket, activeTeachersByLevel: new Map([["room", "teacher"]]),
    isInLevelRoom: (s, level) => s.rooms.has(level), acknowledge() {},
    io: { to(id) { return { emit(event, data) { emitted.push({ id, event, data }); } }; } } };
  vm.runInNewContext(source.slice(start, end), ctx);
  const report = { transport: "sfu", receiving: false,
    p2p: { receiving: true, receivingAudio: true, receivingVideo: true } };
  handler(report);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].data.receiving, false);
  assert.equal(emitted[0].data.p2p.receivingVideo, true);
  assert.equal(socket.data.isReceivingMedia, true);
  socket.rooms.clear(); handler(report);
  socket.rooms.add("room"); socket.data.role = "teacher"; handler(report);
  assert.equal(emitted.length, 1);
});
