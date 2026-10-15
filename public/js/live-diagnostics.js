(function () {
  "use strict";
  const queue = [], history = [], last = new Map(), progress = new Map();
  const allowedFields = new Set("signal sfu online hidden micApproved micPresent micEnabled micMuted micEnded micPublished audioReceiving videoReceiving paused muted readyState errorName file line column target source kind direction bytesDelta packetsLost jitter rtt framesDelta audioLevel samplesDelta state durationMs dropped energyDelta".split(" "));
  let adapter, busy = false, sending = false, cursor = 0, dropped = 0, lastFlush = 0, sequence = 0, lastTick = Date.now();
  function report(code, details = {}) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(code || "")) return;
    // Never forward exception messages, URLs, SDP, device labels or tokens.
    const safe = {};
    for (const [key, value] of Object.entries(details).slice(0, 40)) {
      if (!allowedFields.has(key)) continue;
      if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) safe[key] = value;
      else if (typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) && !value.startsWith("eyJ")) safe[key] = value;
    }
    const now = Date.now(), key = code + JSON.stringify(safe);
    if (now - (last.get(key) || 0) < 30000) return;
    if (last.size >= 200) last.delete(last.keys().next().value);
    last.set(key, now);
    const event = { id: ++sequence, code, details: safe, at: now, sessionId: window.minasatyClassroomSession?.sessionId || null };
    if (queue.length >= 100) {
      const routine = queue.findIndex(item => ["rtp_sample", "health_snapshot"].includes(item.code));
      queue.splice(routine < 0 ? 0 : routine, 1); dropped++;
    }
    queue.push(event); history.push(event); if (history.length > 100) history.shift();
    console.info("[LiveDoctor]", event);
  }
  function flush() {
    const socket = adapter?.socket;
    if (!socket?.connected || !adapter.active() || sending || !queue.length || Date.now() - lastFlush < 12000) return;
    lastFlush = Date.now(); sending = true;
    const batch = queue.slice(0, 10);
    socket.timeout(4000).emit("live_diagnostics", { events: batch }, (error, result) => {
      sending = false;
      if (!error && result?.ok) for (const event of batch) { const index = queue.indexOf(event); if (index >= 0) queue.splice(index, 1); }
    });
  }
  async function boundedStats(source) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(source.stats), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(), { name: "StatsTimeout" })), 1500); })]); }
    finally { clearTimeout(timer); }
  }
  async function sample() {
    const delay = Date.now() - lastTick; lastTick = Date.now();
    if (adapter?.active() && delay > 12000) report("page_timer_delayed", { durationMs: delay, hidden: document.visibilityState === "hidden" });
    if (!adapter || busy || !adapter.active()) { flush(); return; }
    busy = true;
    try {
      report("health_snapshot", { ...adapter.snapshot(), online: navigator.onLine, hidden: document.visibilityState === "hidden", dropped });
      const sources = adapter.sources();
      const liveKeys = new Set(sources.map(s => s.id));
      for (const [key, value] of progress) if (!liveKeys.has(value.source)) progress.delete(key);
      // Round-robin bounds CPU and concurrent stats work for large classrooms.
      const selected = [];
      for (let i = 0; i < Math.min(4, sources.length); i++) selected.push(sources[(cursor + i) % sources.length]);
      cursor = sources.length ? (cursor + selected.length) % sources.length : 0;
      await Promise.all(selected.map(async source => {
        try {
          const stats = await boundedStats(source);
          stats?.forEach(row => {
            if (row.type === "candidate-pair" && row.state === "succeeded" && (row.nominated || row.selected)) {
              const networkKey = source.id + ":network";
              const previous = progress.get(networkKey);
              if (!previous || Date.now() - previous.at >= 60000) {
                report("network_sample", { source: source.id, target: source.target || "", rtt: row.currentRoundTripTime });
                progress.set(networkKey, { source: source.id, at: Date.now() });
              }
            }
            if (row.type === "media-source" && row.kind === "audio") {
              const captureKey = source.id + ":capture";
              const previous = progress.get(captureKey), energy = row.totalAudioEnergy;
              if (!previous || Date.now() - previous.at >= 30000) {
                report("microphone_capture_sample", { source: source.id, audioLevel: row.audioLevel,
                  energyDelta: previous && Number.isFinite(energy) ? energy - previous.energy : undefined });
                progress.set(captureKey, { source: source.id, at: Date.now(), energy });
              }
            }
            if (!["inbound-rtp", "outbound-rtp"].includes(row.type) || row.isRemote) return;
            const incoming = row.type === "inbound-rtp", bytes = incoming ? row.bytesReceived : row.bytesSent;
            if (!Number.isFinite(bytes)) return;
            const key = source.id + ":" + row.id, now = Date.now(), old = progress.get(key);
            const kind = row.kind || row.mediaType || "unknown";
            const stalledSince = old && bytes === old.bytes ? old.stalledSince : now;
            const stalled = Boolean(old && bytes === old.bytes && now - stalledSince >= 10000);
            const shouldReport = old && bytes >= old.bytes && (stalled !== old.stalled || now - (old.lastReport || 0) >= 60000);
            if (shouldReport) report(stalled ? "rtp_no_progress" : "rtp_sample", {
              source: source.id, target: source.target || "", kind, direction: incoming ? "inbound" : "outbound",
              bytesDelta: bytes - old.bytes, durationMs: now - old.at, packetsLost: row.packetsLost,
              jitter: row.jitter, audioLevel: row.audioLevel,
              framesDelta: Number.isFinite(row.framesDecoded) ? row.framesDecoded - (old.frames || 0) : undefined,
              samplesDelta: Number.isFinite(row.totalSamplesReceived) ? row.totalSamplesReceived - (old.samples || 0) : undefined,
            });
            progress.set(key, { source: source.id, at: now, bytes, stalledSince, stalled, lastReport: shouldReport ? now : (old?.lastReport || 0), frames: row.framesDecoded, samples: row.totalSamplesReceived });
            if (progress.size > 1000) progress.delete(progress.keys().next().value);
          });
        } catch (error) { report("stats_unavailable", { source: source.id, errorName: error.name }); }
      }));
    } catch (error) { report("diagnostic_probe_failed", { errorName: error.name }); }
    finally { busy = false; flush(); }
  }
  window.LiveDoctor = { report, start(config) {
    adapter = config;
    config.socket.on("disconnect", reason => report("signaling_disconnected", { state: String(reason).replace(/ /g, "_") }));
    config.socket.on("connect", () => { report("signaling_connected"); flush(); });
    config.socket.on("connect_error", error => report("signaling_connect_failed", { errorName: error.name }));
  }, inspect: () => ({ queueLength: queue.length, dropped, events: history.slice() }) };
  window.addEventListener("error", event => report("javascript_error", { errorName: event.error?.name || "ResourceError",
    file: String(event.filename || "").split("/").pop()?.split("?")[0], line: event.lineno, column: event.colno }));
  window.addEventListener("unhandledrejection", event => report("unhandled_rejection", { errorName: event.reason?.name || "UnknownError" }));
  window.addEventListener("offline", () => report("browser_offline"));
  window.addEventListener("online", () => report("browser_online"));
  document.addEventListener("visibilitychange", () => report("visibility_changed", { hidden: document.visibilityState === "hidden" }));
  setInterval(sample, 5000);
})();
