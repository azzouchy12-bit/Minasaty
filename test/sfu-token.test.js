const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const WEBRTC_ROUTES = path.join(ROOT, "routes", "webrtcRoutes.js");
const VENDOR_LIVEKIT = path.join(ROOT, "public", "js", "vendor", "livekit-client.umd.js");
const SETUP_SCRIPT = path.join(ROOT, "scripts", "setup-livekit-vps.sh");

test("webrtcRoutes.js implements /sfu-token endpoint and LiveKit AccessToken generation", () => {
  const code = fs.readFileSync(WEBRTC_ROUTES, "utf8");

  assert.ok(code.includes('router.post("/sfu-token"'), "/sfu-token endpoint must exist");
  assert.ok(code.includes("AccessToken"), "AccessToken from livekit-server-sdk must be imported");
  assert.ok(code.includes("canPublish"), "canPublish permission must be configured");
  assert.ok(code.includes("canSubscribe"), "canSubscribe permission must be configured");
  assert.ok(code.includes("192.236.187.151"), "default VPS host 192.236.187.151 must be referenced");
});

test("Vendor directory includes local livekit-client.umd.js bundle", () => {
  assert.ok(fs.existsSync(VENDOR_LIVEKIT), "livekit-client.umd.js must exist in public/js/vendor/");
  const stat = fs.statSync(VENDOR_LIVEKIT);
  assert.ok(stat.size > 100_000, "livekit-client bundle must be non-empty");
});

test("setup-livekit-vps.sh script exists with correct ports and service configuration", () => {
  assert.ok(fs.existsSync(SETUP_SCRIPT), "setup-livekit-vps.sh must exist");
  const script = fs.readFileSync(SETUP_SCRIPT, "utf8");
  assert.ok(script.includes("port: 7880"), "LiveKit port 7880 must be configured");
  assert.ok(script.includes("livekit-server.service"), "systemd service must be configured");
});

test("teacher-live-v2.js and student-live.js integrate LiveKit SFU client methods with fallback", () => {
  const teacherJs = fs.readFileSync(path.join(ROOT, "public", "js", "teacher-live-v2.js"), "utf8");
  const studentJs = fs.readFileSync(path.join(ROOT, "public", "js", "student-live.js"), "utf8");
  const webrtcIceJs = fs.readFileSync(path.join(ROOT, "public", "js", "webrtc-ice.js"), "utf8");
  const teacherHtml = fs.readFileSync(path.join(ROOT, "public", "teacher-live.html"), "utf8");
  const studentHtml = fs.readFileSync(path.join(ROOT, "public", "student-live.html"), "utf8");

  assert.ok(teacherJs.includes("initTeacherSfuSession"), "teacher-live-v2.js must have initTeacherSfuSession");
  assert.ok(teacherJs.includes("syncTeacherSfuMedia"), "teacher-live-v2.js must have syncTeacherSfuMedia");
  assert.ok(teacherJs.includes("closeTeacherSfuSession"), "teacher-live-v2.js must have closeTeacherSfuSession");

  assert.ok(studentJs.includes("connectStudentSfu"), "student-live.js must have connectStudentSfu");
  assert.ok(studentJs.includes("publishStudentSfuMic"), "student-live.js must have publishStudentSfuMic");
  assert.ok(studentJs.includes("disconnectStudentSfu"), "student-live.js must have disconnectStudentSfu");

  assert.ok(webrtcIceJs.includes("fetchMinasatySfuToken"), "webrtc-ice.js must define fetchMinasatySfuToken");
  assert.ok(teacherHtml.includes("livekit-client.umd.js"), "teacher-live.html must include livekit-client.umd.js");
  assert.ok(studentHtml.includes("livekit-client.umd.js"), "student-live.html must include livekit-client.umd.js");
});

test("classroomAuthorizer in server.js allows enrolled students even when teacher is temporarily offline/reconnecting", async () => {
  const vm = require("node:vm");
  let authorizer;
  const record = { id: "student-1", level: "السنة الثالثة", liveAccessEnabled: true, mathEnrollment: true, accountActive: true, parentPhone: "0555123456" };
  const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const start = serverSrc.indexOf("if (typeof webrtcRoutes?.setClassroomAuthorizer");
  const end = serverSrc.indexOf("\nfunction clearClassroomChatHistory", start);
  const ctx = {
    webrtcRoutes: { setClassroomAuthorizer(fn) { authorizer = fn; } },
    isValidLevel: () => true,
    GLOBAL_FREE_LEVEL: "FREE",
    UNIVERSITY_LEVEL: "UNIVERSITY",
    canonicalLevel: v => v,
    activeTeachersByLevel: new Map(), // Teacher is offline/reconnecting!
    activeSubjectByLevel: new Map(),
    pendingTeacherRecoveryByLevel: new Map(),
    io: { sockets: { sockets: new Map() } },
    isInLevelRoom: () => false,
    isPaidSubscription: () => false,
    prisma: { student: { async findUnique() { return record; }, async findFirst() { return record; } } }
  };
  vm.runInNewContext(serverSrc.slice(start, end), ctx);

  // Student should be authorized even if teacher is offline!
  const allowed = await authorizer("السنة الثالثة", "student-1", { role: "parent", phone: "0555123456" });
  assert.equal(allowed, true, "Enrolled student must not be blocked with 403 when teacher is offline or reconnecting");

  // When studentId is missing, it should resolve via parentPhone
  const resolvedAllowed = await authorizer("السنة الثالثة", "", { role: "parent", phone: "0555123456" });
  assert.equal(resolvedAllowed, true, "Student should be resolved from parent phone and authorized");
});


