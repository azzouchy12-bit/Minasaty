"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ClassroomSessions } = require("../utils/classroomSessions");

test("session survives reconnect, isolates classes and changes only after explicit end", () => {
  const sessions = new ClassroomSessions();
  const first = sessions.start("A", "teacher", "MATH");
  assert.equal(sessions.start("A", "teacher", "MATH"), first);
  assert.throws(() => sessions.start("A", "other", "MATH"));
  assert.throws(() => sessions.start("A", "teacher", "PHYSICS"));
  assert.notEqual(sessions.start("B", "teacher", "MATH").roomName, first.roomName);
  assert.equal(sessions.publicInfo("A").sessionId, first.id);
  assert.equal("resumeToken" in sessions.publicInfo("A"), false);
  sessions.end("A");
  assert.equal(sessions.get("A"), null);
  assert.notEqual(sessions.start("A", "teacher", "MATH").roomName, first.roomName);
});

function tokenHarness() {
  const source = fs.readFileSync(path.join(__dirname, "../routes/webrtcRoutes.js"), "utf8");
  const start = source.indexOf('router.post("/sfu-token"');
  const end = source.indexOf("router.setStudentMicChecker", start);
  let handler;
  let issued;
  const sessions = new ClassroomSessions();
  const session = sessions.start("A", "teacher", "MATH");
  const router = {
    post(_path, _auth, fn) { handler = fn; },
    resolveClassroomSession: level => sessions.get(level),
    classroomAuthorizer: async () => true,
    studentMicChecker: () => false,
  };
  vm.runInNewContext(source.slice(start, end), {
    router, verifyToken() {}, prismaClient: null, console,
    getLivekitConfig: () => ({ enabled: true, isConfigured: true, key: "test", secret: "test", url: "wss://test" }),
    TrackSource: { MICROPHONE: 2 },
    AccessToken: class {
      constructor(_key, _secret, options) { issued = { options }; }
      addGrant(grant) { issued.grant = grant; }
      async toJwt() { return "test-token"; }
    },
  });
  return { router, sessions, session, get issued() { return issued; }, async request(user, body = {}) {
    let response;
    const res = { status(code) { this.code = code; return this; }, json(data) { response = { code: this.code, data }; return response; } };
    await handler({ user, body: { roomName: "A", ...body }, query: {} }, res);
    return response;
  } };
}

test("SFU token binds to active class, stable child identity and server mic permission", async () => {
  const h = tokenHarness();
  const result = await h.request({ role: "parent", id: "parent" }, { studentId: "child-one", allowMic: true });
  assert.equal(result.code, 200);
  assert.equal(h.issued.options.identity, "child-one");
  assert.equal(h.issued.grant.room, h.session.roomName);
  assert.equal(h.issued.grant.canPublish, false);
  assert.equal(result.data.sessionId, h.session.id);
  await h.request({ role: "parent", id: "parent" }, { studentId: "child-two" });
  assert.equal(h.issued.options.identity, "child-two");
});

test("SFU rejects stale sessions, inactive rooms and another teacher", async () => {
  const h = tokenHarness();
  assert.equal((await h.request({ role: "teacher" })).code, 200);
  assert.equal((await h.request({ role: "teacher", id: "intruder" })).code, 403);
  assert.equal((await h.request({ role: "teacher" }, { sessionId: "old" })).code, 409);
  h.sessions.end("A");
  assert.equal((await h.request({ role: "teacher" })).code, 409);
});

test("SFU cannot issue token for a class ended during asynchronous authorization", async () => {
  const h = tokenHarness();
  h.router.classroomAuthorizer = async () => { h.sessions.end("A"); h.sessions.start("A", "teacher", "MATH"); return true; };
  assert.equal((await h.request({ role: "parent" }, { studentId: "child" })).code, 409);
  assert.equal(h.issued, undefined);
});

test("roster reconciliation preserves receiving state and ignores responses overtaken by events", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/teacher-live-v2.js"), "utf8");
  const fn = source.match(/^function syncClassroomRoster\([^]*?^\}/m)[0];
  let callback;
  const removed = [];
  const upserted = [];
  const state = { classActive: true, activeClassroomSessionId: "session", rosterSyncPending: false, rosterEventRevision: 0,
    socket: { connected: true, timeout() { return this; }, emit(_event, _data, cb) { callback = cb; } },
    attendeeElements: new Map([["old", {}], ["current", {}]]),
    removeStudentConnection: id => removed.push(id), upsertAttendee: id => { upserted.push(id); return {}; },
    syncStudentMicButton() {}, refreshAbsenteesBadge() {},
  };
  vm.createContext(state);
  vm.runInContext(fn + "\nsyncClassroomRoster();", state);
  state.rosterEventRevision++;
  callback(null, { ok: true, sessionId: "session", students: [] });
  assert.equal(removed.length, 0);
  vm.runInContext("syncClassroomRoster();", state);
  callback(null, { ok: true, sessionId: "session", students: [{ socketId: "current", studentId: "child" }] });
  assert.deepEqual(removed, ["old"]);
  assert.deepEqual(upserted, ["current"]);
});

test("only the active teacher sees a deduplicated roster for this session", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf('  socket.on("classroom_roster_request"');
  const end = source.indexOf('\n  console.info', start);
  let handler;
  const sessions = new ClassroomSessions();
  const session = sessions.start("A", "teacher", "MATH");
  const peer = (id, studentId, joinedAt, sessionId = session.id, roomLevel = "A") => ({ id, connected: true,
    data: { role: "student", studentId, joinedAt, classroomSessionId: sessionId, roomLevel } });
  const socket = { id: "teacher-socket", data: { role: "teacher", roomLevel: "A" }, on(_event, fn) { handler = fn; } };
  const active = new Map([["A", socket.id]]);
  vm.runInNewContext(source.slice(start, end), { socket, classroomSessions: sessions, activeTeachersByLevel: active,
    io: { sockets: { sockets: new Map([
      ["old", peer("old", "child", 1)], ["new", peer("new", "child", 2)],
      ["stale", peer("stale", "other-child", 3, "old-session")],
      ["other-level", peer("other-level", "third", 4, session.id, "B")],
    ]) } }, isStudentMicrophoneOpen: () => true,
  });
  let result;
  handler({}, value => { result = value; });
  assert.equal(result.ok, true);
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].socketId, "new");
  assert.equal(result.students[0].micEnabled, true);
  active.set("A", "replacement-teacher");
  handler({}, value => { result = value; });
  assert.equal(result.ok, false);
  socket.data.role = "student";
  handler({}, value => { result = value; });
  assert.equal(result.ok, false);
});

test("microphone approval updates the independent media room, not the academic level", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../routes/webrtcRoutes.js"), "utf8");
  const fn = source.match(/router.syncStudentMicrophonePermission = async function\([^]*?\n\};/)[0];
  const sessions = new ClassroomSessions();
  const session = sessions.start("A", "teacher", "MATH");
  const calls = [];
  const router = { resolveClassroomSession: level => sessions.get(level) };
  vm.runInNewContext(fn, { router, console, microphonePermissionUpdates: new Map(), TrackSource: { MICROPHONE: 2 },
    getLivekitConfig: () => ({ enabled: true, isConfigured: true, url: "wss://test" }),
    RoomServiceClient: class { async updateParticipant(...args) { calls.push(args); } },
  });
  await router.syncStudentMicrophonePermission("A", "child", true);
  assert.equal(calls[0][0], session.roomName);
  assert.equal(calls[0][1], "child");
  assert.equal(calls[0][2].permission.canPublish, true);
  sessions.end("A");
  await router.syncStudentMicrophonePermission("A", "child", true);
  assert.equal(calls.length, 1);
});
