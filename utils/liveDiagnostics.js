"use strict";
const { randomUUID } = require("node:crypto");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const bootId = randomUUID();
const fields = new Set("signal sfu online hidden micApproved micPresent micEnabled micMuted micEnded micPublished audioReceiving videoReceiving paused muted readyState errorName file line column target source kind direction bytesDelta packetsLost jitter rtt framesDelta audioLevel samplesDelta state durationMs dropped energyDelta".split(" "));
function cleanEvent(input) {
  if (!input || typeof input !== "object" || !/^[a-z][a-z0-9_]{0,63}$/.test(input.code || "")) return null;
  const details = {};
  for (const [key, value] of Object.entries(input.details || {}).slice(0, 40)) {
    if (!fields.has(key)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) details[key] = value;
    else if (typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) && !value.startsWith("eyJ")) details[key] = value;
  }
  return { eventId: Number.isSafeInteger(input.id) && input.id > 0 ? input.id : null, code: input.code, clientAt: Number.isFinite(input.at) ? input.at : null,
    reportedSession: /^[a-f0-9-]{36}$/.test(input.sessionId || "") ? input.sessionId : null, details };
}
function logServer(code, details = {}) {
  console.info("[LiveDoctor] " + JSON.stringify({ origin: "server", code, bootId,
    serverAt: new Date().toISOString(), uptimeSeconds: Math.round(process.uptime()), ...details }));
}
let globalWindow = 0, globalCount = 0;
function attachClientDiagnostics(socket) {
  let windowAt = 0, count = 0;
  const seen = new Set();
  socket.on("disconnect", reason => {
    if (socket.data.classroomSessionId) logServer("participant_disconnected", { sessionId: socket.data.classroomSessionId,
      role: socket.data.role, socketId: socket.id, reason });
  });
  socket.on("live_diagnostics", (payload, ack) => {
    const respond = (ok) => { if (typeof ack === "function") ack({ ok, bootId }); };
    // Only identities already admitted by the server may write diagnostic logs.
    if (!["teacher", "student"].includes(socket.data.role) || !socket.data.roomLevel || !socket.rooms.has(socket.data.roomLevel)) return respond(false);
    const now = Date.now();
    if (now - windowAt >= 60000) { windowAt = now; count = 0; }
    if (now - globalWindow >= 60000) { globalWindow = now; globalCount = 0; }
    if (!Array.isArray(payload?.events) || payload.events.length > 10 || count + payload.events.length > 60 || globalCount + payload.events.length > 3000) return respond(false);
    count += payload.events.length; globalCount += payload.events.length;
    for (const event of payload.events) {
      const clean = cleanEvent(event);
      if (!clean) continue;
      if (clean.eventId && seen.has(clean.eventId)) continue;
      if (clean.eventId) { seen.add(clean.eventId); if (seen.size > 200) seen.delete(seen.values().next().value); }
      console.info("[LiveDoctor] " + JSON.stringify({ origin: "browser", bootId, serverAt: new Date().toISOString(),
        role: socket.data.role, socketId: socket.id, sessionId: socket.data.classroomSessionId || null,
        participantId: socket.data.studentId || socket.data.teacherId || "teacher", ...clean }));
    }
    respond(true);
  });
}
let lastHttpLog = 0;
function requestDiagnostics(req, res, next) {
  const startedAt = Date.now();
  res.once("finish", () => {
    const durationMs = Date.now() - startedAt;
    if ((res.statusCode >= 500 || durationMs > 5000) && Date.now() - lastHttpLog >= 1000) {
      lastHttpLog = Date.now();
      logServer("http_request_problem", { status: res.statusCode, durationMs, method: req.method,
        route: typeof req.route?.path === "string" ? req.route.path : "unmatched" });
    }
  });
  next();
}
function startRuntimeDiagnostics() {
  const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
  logServer("process_started");
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    logServer("runtime_health", { rssMB: Math.round(memory.rss / 1048576), heapMB: Math.round(memory.heapUsed / 1048576),
      loopP99Ms: Math.round(lag.percentile(99) / 1e6), loopMaxMs: Math.round(lag.max / 1e6) });
    lag.reset();
  }, 60000); timer.unref();
  // Monitoring must not install an exception handler that suppresses a crash.
  process.on("uncaughtExceptionMonitor", error => logServer("uncaught_exception", { errorName: String(error?.name || "Error").slice(0, 60) }));
  return () => { clearInterval(timer); lag.disable(); };
}
module.exports = { cleanEvent, attachClientDiagnostics, startRuntimeDiagnostics, logServer, requestDiagnostics };
