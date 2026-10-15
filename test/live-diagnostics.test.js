"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { cleanEvent, attachClientDiagnostics } = require("../utils/liveDiagnostics");

test("diagnostics discard secrets and arbitrary payloads and preserve numeric evidence", () => {
  const event = cleanEvent({ code: "microphone_failed", role: "teacher", details: {
    token: "secret", message: "Bearer secret", source: "https://host?token=secret", state: "eyJsecret",
    audioLevel: 0.2, errorName: "NotAllowedError", line: 42, rtt: Infinity,
  } });
  assert.deepEqual(event.details, { audioLevel: 0.2, errorName: "NotAllowedError", line: 42 });
  assert.equal(event.role, undefined);
  assert.equal(cleanEvent({ code: "bad\nlog" }), null);
});

test("diagnostic ingestion requires admitted membership, uses server identity and bounds/deduplicates logs", () => {
  const handlers = {}, logs = [], original = console.info;
  const socket = { id: "real-socket", data: {}, rooms: new Set(), on(event, fn) { handlers[event] = fn; } };
  attachClientDiagnostics(socket);
  let ack;
  console.info = line => logs.push(line);
  try {
    const event = { id: 1, code: "rtp_no_progress", role: "teacher", details: { bytesDelta: 0 } };
    handlers.live_diagnostics({ events: [event] }, value => { ack = value; });
    assert.equal(ack.ok, false); assert.equal(logs.length, 0);
    socket.data = { role: "student", roomLevel: "A", studentId: "child", classroomSessionId: "session" };
    socket.rooms.add("A");
    handlers.live_diagnostics({ events: [event] }, value => { ack = value; });
    assert.equal(ack.ok, true);
    const record = JSON.parse(logs[0].slice("[LiveDoctor] ".length));
    assert.equal(record.role, "student"); assert.equal(record.participantId, "child");
    handlers.live_diagnostics({ events: [event] }, () => {});
    assert.equal(logs.length, 1);
    handlers.live_diagnostics({ events: Array(11).fill(event) }, value => { ack = value; });
    assert.equal(ack.ok, false);
    for (let i = 0; i < 7; i++) handlers.live_diagnostics({ events: Array(10).fill({ code: "probe" }) }, value => { ack = value; });
    assert.equal(ack.ok, false);
  } finally { console.info = original; }
});

function browserHarness(sources = () => []) {
  let now = 100000, tick, ack;
  const listeners = {}, batches = [];
  const socket = { connected: false, on(event, fn) { listeners[event] = fn; }, timeout() { return this; },
    emit(event, data, callback) { batches.push({ event, data }); ack = callback; } };
  const context = { window: { addEventListener() {}, minasatyClassroomSession: { sessionId: "session" } },
    document: { visibilityState: "visible", addEventListener() {} }, navigator: { onLine: true },
    console: { info() {} }, Date: class extends Date { static now() { return now; } },
    setInterval(fn) { tick = fn; }, setTimeout, clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/js/live-diagnostics.js"), "utf8"), context);
  const doctor = context.window.LiveDoctor;
  doctor.start({ socket, active: () => true, snapshot: () => ({ signal: socket.connected }), sources });
  return { doctor, socket, batches, async tick(ms = 5000) { now += ms; await tick(); }, ack(error, result) { ack(error, result); } };
}

test("browser queue is bounded, filters secrets, retains failed batches and removes acknowledged events", async () => {
  const h = browserHarness();
  h.doctor.report("probe", { token: "secret", source: "https://host/token", line: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.doctor.inspect().events[0].details)), { line: 7 });
  for (let i = 0; i < 120; i++) h.doctor.report("probe", { line: i });
  assert.equal(h.doctor.inspect().queueLength, 100);
  assert.ok(h.doctor.inspect().dropped > 0);
  h.socket.connected = true;
  await h.tick();
  assert.equal(h.batches[0].data.events.length, 10);
  h.ack(new Error("offline"));
  assert.equal(h.doctor.inspect().queueLength, 100);
  await h.tick(15000);
  h.ack(null, { ok: true });
  assert.equal(h.doctor.inspect().queueLength, 90);
});

test("RTP observations require successive samples and distinguish progress, stalls and recovery", async () => {
  let bytes = 100;
  const h = browserHarness(() => [{ id: "p2p_teacher", stats: async () => new Map([["audio", {
    id: "audio", type: "inbound-rtp", kind: "audio", bytesReceived: bytes, packetsLost: 1, jitter: 0.02,
  }]]) }]);
  await h.tick();
  assert.equal(h.doctor.inspect().events.some(e => e.code === "rtp_no_progress"), false);
  await h.tick(); await h.tick();
  assert.equal(h.doctor.inspect().events.some(e => e.code === "rtp_no_progress"), true);
  bytes = 300; await h.tick();
  const samples = h.doctor.inspect().events.filter(e => e.code === "rtp_sample");
  assert.equal(samples.at(-1).details.bytesDelta, 200);
});

test("a failing stats probe does not stop other sources or the next sample", async () => {
  const h = browserHarness(() => [{ id: "broken", stats: async () => { throw new TypeError("secret-token"); } }]);
  await h.tick(); await h.tick();
  const events = h.doctor.inspect().events;
  assert.ok(events.some(e => e.code === "stats_unavailable"));
  assert.equal(JSON.stringify(events).includes("secret-token"), false);
});
