"use strict";

/**
 * Student live-viewer controller.
 *
 * This page intentionally represents only one remote peer: the teacher. It
 * never receives, renders, or requests a list of any other students.
 */

// Immediately stop any active ringing live alert upon entering the live room
try {
  if (typeof window.stopContinuousLiveAlert === "function") {
    window.stopContinuousLiveAlert();
  }
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "STOP_ALERT_SOUND" });
  }
} catch (_) { }

// معاملة بيانات الهاتف كأنها شبكة Wi-Fi عالية السرعة دائماً في كافة أجزاء ومكتبات المنصة
try {
  const netConn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (netConn) {
    Object.defineProperty(netConn, "type", { get: () => "wifi", configurable: true });
    Object.defineProperty(netConn, "effectiveType", { get: () => "4g", configurable: true });
    Object.defineProperty(netConn, "saveData", { get: () => false, configurable: true });
  }
} catch (_) { }

function createUnavailableStudentSocket() {
  return {
    connected: false,
    id: null,
    on() { return this; },
    emit(eventName, payload, acknowledgement) {
      if (typeof acknowledgement === "function") {
        acknowledgement({ ok: false, message: "الاتصال بخادم الحصة غير متاح حالياً." });
      }
      return this;
    },
    disconnect() { this.connected = false; return this; },
    connect() { return this; },
  };
}

// Keep the viewer controls initialized even when a static/local preview does
// not expose Socket.io. Production still uses the real Socket.io connection.
const parentSessionToken = sessionStorage.getItem("parentToken") || localStorage.getItem("parentToken") || "";
const socket = typeof window.io === "function"
  ? window.io({
    auth: parentSessionToken ? { token: parentSessionToken } : {},
    transports: ["websocket", "polling"],
  })
  : createUnavailableStudentSocket();

const rtcConfig = {
  iceCandidatePoolSize: 10,
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun.cloudflare.com:3478",
      ],
    },
  ],
};
if (typeof window.getMinasatyRtcConfig === "function") {
  void window.getMinasatyRtcConfig().then((config) => Object.assign(rtcConfig, config));
}

// SFU (LiveKit Media Server) State for centralized high-scale broadcasting
let studentSfuRoom = null;
let studentSfuMicPub = null;
let isStudentMicSyncing = false;
let isStudentSfuConnecting = false;
let currentStudentSfuRoomName = null;
let studentSfuConnectPromise = null;
let studentSfuSessionId = 0;
let studentSfuConnectedAt = 0;
let sfuReceptionMonitor = null;
const SFU_STARTUP_GRACE_PERIOD_MS = 2_500;

// Dedicated Teacher Audio reception state - completely isolated from student mic and classmate audio
let teacherAudioElement = null;
let teacherAudioStream = null;
let teacherInboundAudioTrack = null;
let knownTeacherIdentity = null;
let studentP2pMicSender = null;

const classmateAudioElements = new Map();
const teacherSfuPlaybackTracks = new Map();
let teacherAudioPlaybackBlocked = false;
let studentSfuRecoveryHoldUntil = 0;
let studentSfuRetryTimer = null;
let studentSfuRetryAttempt = 0;
let initialP2pPreviewRequested = false;
const studentSfuMediaProgress = new Map();
const studentP2pMediaProgress = new Map();
let studentP2pReceptionBusy = false;
const studentDiagnosticEvents = [];

function getTeacherAudioElement() {
  if (!teacherAudioElement) {
    if (typeof document !== "undefined" && typeof document.getElementById === "function") {
      teacherAudioElement = document.getElementById("teacher-live-audio");
    }
    if (!teacherAudioElement && typeof document !== "undefined" && typeof document.createElement === "function") {
      teacherAudioElement = document.createElement("audio");
      teacherAudioElement.id = "teacher-live-audio";
      teacherAudioElement.autoplay = true;
      teacherAudioElement.playsInline = true;
      teacherAudioElement.style.display = "none";
      if (document.body && typeof document.body.appendChild === "function") {
        document.body.appendChild(teacherAudioElement);
      }
    }
    if (teacherAudioElement) {
      teacherAudioElement.muted = false;
      teacherAudioElement.volume = 1.0;
    }
  }
  return teacherAudioElement;
}

function setTeacherAudioPlaybackBlocked(blocked) {
  teacherAudioPlaybackBlocked = Boolean(blocked);
  if (elements.enableAudioButton) {
    elements.enableAudioButton.hidden = !teacherAudioPlaybackBlocked;
    elements.enableAudioButton.style.display = teacherAudioPlaybackBlocked ? "" : "none";
  }
}

function detachTeacherSfuPlaybackTrack(kind, expectedTrack = null) {
  const track = teacherSfuPlaybackTracks.get(kind);
  if (!track || (expectedTrack && track !== expectedTrack)) return;
  teacherSfuPlaybackTracks.delete(kind);
  const element = kind === "video" ? elements.remoteVideo : getTeacherAudioElement();
  try { if (element && typeof track.detach === "function") track.detach(element); } catch (_) {}
}

function attachTeacherSfuPlaybackTrack(track, participant) {
  if (!track?.mediaStreamTrack) return;
  const previous = teacherSfuPlaybackTracks.get(track.kind);
  if (previous && previous !== track) detachTeacherSfuPlaybackTrack(track.kind, previous);
  track.mediaStreamTrack.__fromSfu = true;
  attachTeacherTrack({ track: track.mediaStreamTrack, participant });
  if (typeof track.attach !== "function") return;
  const element = track.kind === "video" ? elements.remoteVideo : getTeacherAudioElement();
  if (!element) return;
  // Adaptive stream requires SDK attachment so visibility and size reach the server.
  // Video has its own muted element; teacher audio has exactly one dedicated output.
  if (track.kind === "video") {
    element.srcObject = new MediaStream([track.mediaStreamTrack]);
    element.muted = true;
    if (typeof element?.play === "function") void element.play().catch(() => {});
    if (elements?.placeholder) elements.placeholder.hidden = true;
    if (typeof updateRemoteVideoPresentation === "function") updateRemoteVideoPresentation();
    if (typeof clearRecoveryTimer === "function") clearRecoveryTimer();
    recoveryAttempts = 0;
    isRecoveringStream = false;
    if (typeof hideConnectionOverlay === "function") hideConnectionOverlay();
  }
  track.attach(element);
  if (track.kind === "video") {
    element.muted = true;
    if (typeof element?.play === "function") void element.play().catch(() => {});
    if (elements?.placeholder) elements.placeholder.hidden = true;
    if (typeof updateRemoteVideoPresentation === "function") updateRemoteVideoPresentation();
  }
  teacherSfuPlaybackTracks.set(track.kind, track);
}

function playTeacherInboundAudio(track) {
  if (!track || track.readyState !== "live") return;
  teacherInboundAudioTrack = track;
  const audioEl = getTeacherAudioElement();
  if (!audioEl) return;

  if (!teacherAudioStream) {
    teacherAudioStream = new MediaStream();
    audioEl.srcObject = teacherAudioStream;
  }

  const existingTracks = teacherAudioStream.getAudioTracks();
  if (!existingTracks.some((t) => t.id === track.id)) {
    existingTracks.forEach((oldT) => {
      try { teacherAudioStream.removeTrack(oldT); } catch (_) {}
    });
    teacherAudioStream.addTrack(track);
    if (audioEl.srcObject !== teacherAudioStream) {
      audioEl.srcObject = teacherAudioStream;
    }
  }

  audioEl.muted = false;
  audioEl.volume = 1.0;
  audioEl.play().then(() => {
    if (teacherInboundAudioTrack === track) setTeacherAudioPlaybackBlocked(false);
  }).catch((err) => {
    if (teacherInboundAudioTrack === track && err?.name === "NotAllowedError") setTeacherAudioPlaybackBlocked(true);
    console.warn("[Teacher-Audio] Autoplay blocked or playback failure:", err.message);
    recordStudentDiagnosticEvent("teacher_audio_play_blocked", `Teacher audio play blocked: ${err.message}`);
    if (typeof armAutoUnmuteOnFirstInteraction === "function") armAutoUnmuteOnFirstInteraction();
  });
}

async function ensureTeacherAudioPlayback({ sourceHint = "unknown" } = {}) {
  const teacherEl = getTeacherAudioElement();
  if (!teacherEl) {
    return { ok: false, error: "no_audio_element" };
  }

  const hasAudioTrack = Boolean(
    (teacherAudioStream && teacherAudioStream.getAudioTracks().some((t) => t.readyState === "live")) ||
    (remoteMediaStream && remoteMediaStream.getAudioTracks().some((t) => t.readyState === "live"))
  );

  if (!hasAudioTrack) {
    return { ok: false, error: "no_inbound_audio_track" };
  }

  if (!teacherEl.srcObject && teacherAudioStream) {
    teacherEl.srcObject = teacherAudioStream;
  }

  teacherEl.muted = false;
  if (teacherEl.volume === 0) {
    teacherEl.volume = 1.0;
  }

  try {
    if (teacherEl.paused) {
      await teacherEl.play();
      console.info(`[Teacher-Audio] Resumed teacher playback successfully (source: ${sourceHint})`);
      recordStudentDiagnosticEvent("teacher_audio_resumed", `Teacher audio playback resumed (${sourceHint})`);
    }
    return { ok: true };
  } catch (playErr) {
    console.warn(`[Teacher-Audio] Local playback failure (${sourceHint}):`, playErr.message);
    recordStudentDiagnosticEvent("teacher_audio_playback_failed", `Playback error (${sourceHint}): ${playErr.message}`);
    if (typeof armAutoUnmuteOnFirstInteraction === "function") armAutoUnmuteOnFirstInteraction();
    return { ok: false, error: "playback_failed", details: playErr.message };
  }
}

/** Resume only received audio; keep video, transports, microphone and recording untouched. */
async function refreshClassroomAudioOnly({ sourceHint = "student_mic_opened" } = {}) {
  if (!joinedClass) return { ok: false, error: "not_joined" };
  if (refreshClassroomAudioOnly.pendingPromise) return refreshClassroomAudioOnly.pendingPromise;
  const operation = (async () => {
    try {
      const tracks = remoteMediaStream?.getAudioTracks?.().filter(
        (track) => track.readyState === "live" && track.enabled !== false && !track.muted
      ) || [];
      const teacherTrack = tracks.find((track) => track.__fromSfu) ||
        tracks.find((track) => track === teacherInboundAudioTrack) || tracks[0] ||
        (teacherInboundAudioTrack?.readyState === "live" &&
         teacherInboundAudioTrack.enabled !== false && !teacherInboundAudioTrack.muted
          ? teacherInboundAudioTrack : null);
      if (teacherTrack) playTeacherInboundAudio(teacherTrack);
      const teacherResult = await ensureTeacherAudioPlayback({ sourceHint });
      syncClassmateSfuAudioPlayback();
      const classmates = Array.from(classmateAudioElements.values()).filter((audio) =>
        !audio.muted && audio.srcObject?.getAudioTracks?.().some((track) =>
          track.readyState === "live" && track.enabled !== false && !track.muted));
      const results = await Promise.allSettled(classmates.map((audio) => audio.play()));
      const blocked = results.some((result) => result.status === "rejected");
      if (blocked) armAutoUnmuteOnFirstInteraction();
      recordStudentDiagnosticEvent("classroom_audio_refresh", teacherResult.ok && !blocked
        ? "Received audio playback refreshed" : "Audio refresh requires a live track or playback permission");
      return { ok: teacherResult.ok && !blocked };
    } catch (error) {
      recordStudentDiagnosticEvent("classroom_audio_refresh_failed", "Unable to resume received audio");
      return { ok: false, error: "audio_refresh_failed" };
    }
  })();
  refreshClassroomAudioOnly.pendingPromise = operation;
  try { return await operation; }
  finally {
    if (refreshClassroomAudioOnly.pendingPromise === operation) refreshClassroomAudioOnly.pendingPromise = null;
  }
}

const audioReceptionProgress = new Map();
let audioReceptionReportBusy = false;

function audioPlaybackIsActive(audio, track) {
  return Boolean(audio && track && track.readyState === "live" && track.enabled !== false && !track.muted &&
    !audio.paused && !audio.muted && audio.volume > 0 &&
    audio.srcObject?.getAudioTracks?.().some((current) => current.id === track.id));
}

async function sampleAudioReception(key, track, readStats) {
  if (!track || track.readyState !== "live" || track.muted || track.enabled === false || !readStats) {
    audioReceptionProgress.delete(key); return false;
  }
  let timeout;
  try {
    const stats = await Promise.race([readStats(), new Promise((resolve) => {
      timeout = window.setTimeout(() => resolve(null), 1500);
    })]);
    if (!stats) { audioReceptionProgress.delete(key); return false; }
    let bytes = 0, samples = 0, decodedSamplesAvailable = false;
    stats.forEach((report) => {
      if (report.type !== "inbound-rtp" || (report.kind || report.mediaType) !== "audio") return;
      bytes += Number(report.bytesReceived) || 0;
      if (typeof report.totalSamplesReceived === "number") {
        decodedSamplesAvailable = true; samples += report.totalSamplesReceived;
      }
    });
    const previous = audioReceptionProgress.get(key);
    audioReceptionProgress.set(key, { track, bytes, samples });
    return Boolean(previous?.track === track && bytes > previous.bytes &&
      (!decodedSamplesAvailable || samples > previous.samples));
  } catch (_) { audioReceptionProgress.delete(key); return false; }
  finally { window.clearTimeout(timeout); }
}

async function reportClassroomAudioReception() {
  if (!joinedClass || !socket.connected) { audioReceptionProgress.clear(); return; }
  if (audioReceptionReportBusy) return;
  audioReceptionReportBusy = true;
  const sessionRoom = studentSfuRoom, sessionPeer = pc, teacherId = teacherSocketId;
  const usedKeys = new Set();
  try {
    const tracks = [], pending = [];
    if (sessionRoom?.state === "connected") {
      for (const participant of sessionRoom.remoteParticipants.values()) {
        if (getSfuParticipantRole(participant) !== "student") continue;
        for (const publication of participant.trackPublications.values()) {
          const remoteTrack = publication.track, mediaTrack = remoteTrack?.mediaStreamTrack;
          if (!mediaTrack || mediaTrack.kind !== "audio") continue;
          const key = "sfu:" + participant.identity + ":" + mediaTrack.id; usedKeys.add(key);
          if (pending.length >= 64) continue;
          pending.push(sampleAudioReception(key, mediaTrack,
            typeof remoteTrack.getRTCStatsReport === "function" ? () => remoteTrack.getRTCStatsReport() : null).then((receiving) => {
            tracks.push({ identity: participant.identity, receiving,
              playing: audioPlaybackIsActive(classmateAudioElements.get(participant.identity), mediaTrack) });
          }));
        }
      }
    }
    const mixTrack = teacherInboundAudioTrack;
    const isP2pMix = mixTrack && !mixTrack.__fromSfu && sessionPeer?.connectionState === "connected";
    const mixKey = "p2p:" + mixTrack?.id; if (isP2pMix) usedKeys.add(mixKey);
    const receiver = isP2pMix ? sessionPeer.getReceivers?.().find((item) => item.track === mixTrack) : null;
    const mixReceiving = isP2pMix ? await sampleAudioReception(mixKey, mixTrack,
      typeof receiver?.getStats === "function" ? () => receiver.getStats() : null) : false;
    await Promise.all(pending);
    const sfuMicTrack = sessionRoom?.state === "connected" ? studentSfuMicPub?.track?.mediaStreamTrack : null;
    const micTrack = sfuMicTrack?.readyState === "live" && sfuMicTrack.enabled !== false && !sfuMicTrack.muted
      ? sfuMicTrack : (sessionPeer?.connectionState === "connected" ? studentP2pMicSender?.track : null);
    if (!joinedClass || !socket.connected || teacherSocketId !== teacherId ||
        studentSfuRoom !== sessionRoom || pc !== sessionPeer) return;
    socket.emit("student_audio_reception_report", {
      micPublished: Boolean(microphonePermissionGranted && micTrack?.readyState === "live" && micTrack.enabled !== false && !micTrack.muted),
      tracks: tracks.slice(0, 64),
      p2pMix: { receiving: Boolean(mixReceiving), playing: Boolean(isP2pMix && audioPlaybackIsActive(getTeacherAudioElement(), mixTrack)) },
    });
  } finally {
    for (const key of audioReceptionProgress.keys()) if (!usedKeys.has(key)) audioReceptionProgress.delete(key);
    audioReceptionReportBusy = false;
  }
}

function recordStudentDiagnosticEvent(type, message) {
  window.LiveDoctor?.report(type);
  const sanitized = String(message || "")
    .replace(/token=[^&\s]+/gi, "token=***")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "bearer ***")
    .substring(0, 160);
  studentDiagnosticEvents.unshift({
    timestamp: new Date().toISOString(),
    type: String(type || "info"),
    message: sanitized,
  });
  if (studentDiagnosticEvents.length > 25) studentDiagnosticEvents.pop();
  console.info(`[Student-Diagnostics] [${type}] ${sanitized}`);
}

function getTeacherSfuReceptionState() {
  const tracks = [];
  for (const stream of [remoteMediaStream, teacherAudioStream]) {
    if (typeof stream?.getTracks !== "function") continue;
    tracks.push(...stream.getTracks());
  }
  const now = Date.now();
  const isLiveSfuTrack = (track) => track?.__fromSfu === true && track.readyState === "live";
  const hasRecentProgress = (kind) => {
    const lastProgress = studentSfuMediaProgress.get(kind);
    return Number.isFinite(lastProgress) && now - lastProgress <= 6_000;
  };
  const receivingAudio = tracks.some((track) => track.kind === "audio" && isLiveSfuTrack(track)) && hasRecentProgress("audio");
  const receivingVideo = tracks.some((track) => track.kind === "video" && isLiveSfuTrack(track)) && hasRecentProgress("video");
  return { receivingAudio, receivingVideo, receiving: receivingAudio || receivingVideo };
}

function hasLiveP2pTeacherMedia() {
  const tracks = [];
  for (const stream of [remoteMediaStream, teacherAudioStream]) {
    if (typeof stream?.getTracks !== "function") continue;
    tracks.push(...stream.getTracks());
  }
  return tracks.some((track) => track?.__fromSfu !== true && track.readyState === "live");
}

function getTeacherP2pReceptionState() {
  const peer = typeof pc !== "undefined" ? pc : null;
  const recent = (kind) => Boolean(peer?.connectionState === "connected" &&
    peer.getReceivers?.().some(({ track }) => {
      const progress = studentP2pMediaProgress.get(track);
      return track?.kind === kind && track.__fromSfu !== true && track.readyState === "live" &&
        track.enabled !== false && !track.muted && progress?.peer === peer &&
        progress.lastProgressAt > 0 && Date.now() - progress.lastProgressAt <= 8_000;
    }));
  const receivingAudio = recent("audio"), receivingVideo = recent("video");
  return { receivingAudio, receivingVideo, receiving: receivingAudio || receivingVideo };
}

async function sampleTeacherP2pReception() {
  if (studentP2pReceptionBusy) return;
  const peer = typeof pc !== "undefined" ? pc : null;
  if (!joinedClass || peer?.connectionState !== "connected") {
    studentP2pMediaProgress.clear();
    return;
  }
  studentP2pReceptionBusy = true;
  const activeTracks = new Set();
  try {
    for (const receiver of peer.getReceivers?.() || []) {
      const track = receiver.track;
      if (!track || track.__fromSfu === true || track.readyState !== "live" ||
          track.enabled === false || track.muted || typeof receiver.getStats !== "function") continue;
      activeTracks.add(track);
      let timeout;
      try {
        const stats = await Promise.race([receiver.getStats(), new Promise((resolve) => {
          timeout = window.setTimeout(() => resolve(null), 1_500);
        })]);
        if (pc !== peer || !joinedClass) return;
        let bytes = 0, units = 0, hasUnits = false, found = false;
        stats?.forEach((report) => {
          if (report.type !== "inbound-rtp" || (report.kind || report.mediaType) !== track.kind) return;
          found = true;
          bytes += Number(report.bytesReceived) || 0;
          const decoded = track.kind === "audio" ? report.totalSamplesReceived : report.framesDecoded;
          if (typeof decoded === "number") { hasUnits = true; units += decoded; }
        });
        if (!found) { studentP2pMediaProgress.delete(track); continue; }
        const previous = studentP2pMediaProgress.get(track);
        const advanced = previous?.peer === peer && bytes > previous.bytes &&
          (!hasUnits || !previous.hasUnits || units > previous.units);
        studentP2pMediaProgress.set(track, { peer, bytes, units, hasUnits,
          lastProgressAt: advanced ? Date.now() : (previous?.lastProgressAt || 0) });
      } catch (_) {
        studentP2pMediaProgress.delete(track);
      } finally { window.clearTimeout(timeout); }
    }
    for (const track of studentP2pMediaProgress.keys()) {
      if (!activeTracks.has(track)) studentP2pMediaProgress.delete(track);
    }
    if (pc === peer && joinedClass) notifySfuTransportStatus(true);
  } finally { studentP2pReceptionBusy = false; }
}

function notifySfuTransportStatus(receiving = true) {
  if (socket && socket.connected) {
    const reception = typeof getTeacherSfuReceptionState === "function"
      ? getTeacherSfuReceptionState()
      : { receiving: Boolean(receiving), receivingAudio: false, receivingVideo: false };
    const p2p = typeof getTeacherP2pReceptionState === "function"
      ? getTeacherP2pReceptionState()
      : { receiving: false, receivingAudio: false, receivingVideo: false };
    if (receiving && reception.receivingVideo) {
      try { sessionStorage.setItem("studentMediaTransport", "sfu"); } catch (_) {}
    }
    socket.emit("student_media_transport_status", {
      transport: "sfu",
      receiving: Boolean(receiving && reception.receiving),
      receivingAudio: Boolean(receiving && reception.receivingAudio),
      receivingVideo: Boolean(receiving && reception.receivingVideo),
      p2p,
    });
  }
}

function notifyP2pTransportStatus() {
  if (!socket?.connected) return;
  const p2p = getTeacherP2pReceptionState();
  if (!p2p.receiving) { void sampleTeacherP2pReception(); return; }
  const sfuReception = typeof getTeacherSfuReceptionState === "function"
    ? getTeacherSfuReceptionState()
    : { receiving: false, receivingVideo: false };
  if (typeof isStudentSfuHealthy === "function" && isStudentSfuHealthy() && sfuReception.receivingVideo) {
    notifySfuTransportStatus(true);
    return;
  }
  const sfuActive = Boolean((studentSfuRoom && studentSfuRoom.state === "connected") || sfuReception.receivingVideo);
  if (sfuActive) {
    notifySfuTransportStatus(Boolean(sfuReception.receivingVideo));
    return;
  }
  socket.emit("student_media_transport_status", {
    transport: "sfu",
    receiving: p2p.receiving || sfuReception.receiving,
    receivingAudio: p2p.receivingAudio,
    receivingVideo: sfuReception.receivingVideo,
    p2p,
  });
}

function requestTargetedP2pFallback(reason = "", { holdSfu = true } = {}) {
  if (typeof hasLiveP2pTeacherMedia === "function" && hasLiveP2pTeacherMedia()) return;
  if (holdSfu && typeof holdStudentSfuDuringRecovery === "function") {
    holdStudentSfuDuringRecovery();
  }
  notifySfuTransportStatus(false);
  if (socket && socket.connected) {
    socket.emit("student_request_p2p_stream", {
      level: typeof level !== "undefined" ? level : "",
      studentId: typeof studentId !== "undefined" ? studentId : "",
      reason: String(reason || "sfu_fallback"),
      preferredTransport: "p2p",
    });
    setViewerStatus("جارٍ استقبال بث الأستاذ المباشر…", "warning");
  }
}

function requestInitialP2pPreview() {
  if (initialP2pPreviewRequested || !socket?.connected) return false;
  initialP2pPreviewRequested = true;
  recordStudentDiagnosticEvent("p2p_preview_requested", "Requesting immediate P2P preview while LiveKit connects in the background");
  const storedTransport = (() => {
    try { return sessionStorage.getItem("studentMediaTransport"); } catch (_) { return null; }
  })();
  socket.emit("student_request_p2p_stream", {
    level: typeof level !== "undefined" ? level : "",
    studentId: typeof studentId !== "undefined" ? studentId : "",
    reason: "initial_p2p_preview",
    preferredTransport: storedTransport || undefined,
  });
  return true;
}

function scheduleStudentSfuRetry(roomName, reason = "") {
  if (!joinedClass || !roomName || studentSfuRetryTimer) return;
  const attempt = ++studentSfuRetryAttempt;
  const delay = Math.min(1_000 * (2 ** Math.min(attempt - 1, 4)), 15_000);
  recordStudentDiagnosticEvent("sfu_background_retry", `Scheduling LiveKit background retry ${attempt} in ${delay}ms${reason ? ` (${reason})` : ""}`);
  studentSfuRetryTimer = window.setTimeout(() => {
    studentSfuRetryTimer = null;
    if (joinedClass && (!currentStudentSfuRoomName || currentStudentSfuRoomName === roomName) && (!studentSfuRoom || studentSfuRoom.state !== "connected")) {
      if (studentSfuRoom && studentSfuRoom.state !== "disconnected") disconnectStudentSfu({ notify: false });
      currentStudentSfuRoomName = roomName;
      void connectStudentSfu(roomName, { backgroundRetry: true });
    }
  }, delay);
}

function getSfuParticipantRole(participant) {
  try {
    const meta = typeof participant?.metadata === "string"
      ? JSON.parse(participant.metadata || "{}")
      : (participant?.metadata || {});
    const role = meta.classroomRole || meta.role;
    if (role === "teacher" || role === "student") return role;
  } catch (_) { }
  if (
    participant?.identity === "teacher" ||
    (typeof knownTeacherIdentity !== "undefined" && knownTeacherIdentity && participant?.identity === knownTeacherIdentity) ||
    (typeof teacherSocketId !== "undefined" && teacherSocketId && participant?.identity === teacherSocketId)
  ) {
    return "teacher";
  }
  return null;
}

function syncClassmateSfuAudioPlayback() {
  // A P2P mix-minus track already includes classmates. Never play it twice.
  const hasP2pMix = Boolean(remoteMediaStream?.getAudioTracks?.().some(
    (track) => track.readyState === "live" && !track.__fromSfu && track.enabled !== false && !track.muted
  ));
  classmateAudioElements.forEach((audio) => {
    const wasMuted = audio.muted;
    audio.muted = hasP2pMix;
    if (wasMuted && !hasP2pMix && audio.paused) {
      audio.play().catch(() => {});
    }
  });
}

function playClassmateSfuAudio(participantId, track) {
  if (!participantId || !track) return;
  let audio = classmateAudioElements.get(participantId);
  if (!audio) {
    audio = document.createElement("audio");
    audio.id = `sfu-classmate-audio-${participantId}`;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.style.display = "none";
    document.body.appendChild(audio);
    classmateAudioElements.set(participantId, audio);
  }
  const mediaTrack = track.mediaStreamTrack || track;
  if (audio.srcObject?.getAudioTracks?.().some((current) => current.id === mediaTrack.id)) {
    syncClassmateSfuAudioPlayback();
    return;
  }
  audio.srcObject = new MediaStream([mediaTrack]);
  if (typeof track.attach === "function") {
    try { track.attach(audio); } catch (_) {}
  }
  syncClassmateSfuAudioPlayback();
  mediaTrack.addEventListener?.("ended", () => stopClassmateSfuAudio(participantId, mediaTrack), { once: true });
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch((err) => {
      console.debug("Classmate audio autoplay hint:", err);
      if (typeof armAutoUnmuteOnFirstInteraction === "function") armAutoUnmuteOnFirstInteraction();
      if (typeof window !== "undefined" && window.MinasatyAudioEnhancer?.armAutoplayUnlock) {
        window.MinasatyAudioEnhancer.armAutoplayUnlock(() => {
          audio.play().catch(() => {});
        });
      }
    });
  }
}

function stopClassmateSfuAudio(participantId, track = null) {
  if (!participantId) return;
  const audio = classmateAudioElements.get(participantId);
  const mediaTrack = track?.mediaStreamTrack || track;
  // A delayed unsubscribe for a replaced mic must not remove the new mic.
  if (mediaTrack && !audio?.srcObject?.getAudioTracks?.().some((current) => current.id === mediaTrack.id)) return;
  if (audio) {
    try {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    } catch (_) {}
    classmateAudioElements.delete(participantId);
  }
}

function clearAllClassmateAudio() {
  classmateAudioElements.forEach((audio) => {
    try {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    } catch (_) {}
  });
  classmateAudioElements.clear();
}

window.getMinasatyStudentLiveDiagnostics = function getMinasatyStudentLiveDiagnostics() {
  const teacherEl = getTeacherAudioElement();
  const teacherTracks = teacherAudioStream ? teacherAudioStream.getAudioTracks().map((t) => ({
    id: t.id,
    readyState: t.readyState,
    enabled: t.enabled,
    muted: t.muted,
  })) : [];

  let p2pAudioReceiver = null;
  if (typeof pc !== "undefined" && pc && typeof pc.getReceivers === "function") {
    const rx = pc.getReceivers().find((r) => r.track && r.track.kind === "audio");
    if (rx) {
      const tc = typeof pc.getTransceivers === "function"
        ? pc.getTransceivers().find((t) => t.receiver === rx)
        : null;
      p2pAudioReceiver = {
        trackId: rx.track?.id || null,
        readyState: rx.track?.readyState || null,
        enabled: rx.track?.enabled ?? null,
        muted: rx.track?.muted ?? null,
        direction: tc?.direction || null,
        currentDirection: tc?.currentDirection || null,
      };
    }
  }

  const activeTeacherTrack = teacherInboundAudioTrack || teacherTracks[0] || null;

  return {
    transport: isStudentSfuHealthy() ? "sfu" : (typeof pc !== "undefined" && pc && pc.connectionState === "connected" ? "p2p" : (typeof pc !== "undefined" && pc ? "p2p_connecting" : "idle")),
    sfuConnected: isStudentSfuConnected(),
    sfuHealthy: isStudentSfuHealthy(),
    p2pActive: Boolean(typeof pc !== "undefined" && pc && pc.connectionState === "connected"),
    p2pSignalingState: (typeof pc !== "undefined" && pc?.signalingState) || "none",
    p2pConnectionState: (typeof pc !== "undefined" && pc?.connectionState) || "none",
    p2pAudioReceiver,
    teacherAudioTrackState: activeTeacherTrack ? activeTeacherTrack.readyState : "none",
    teacherInboundTrack: activeTeacherTrack ? {
      id: activeTeacherTrack.id,
      readyState: activeTeacherTrack.readyState,
      enabled: activeTeacherTrack.enabled,
      muted: activeTeacherTrack.muted,
      fromSfu: Boolean(activeTeacherTrack.__fromSfu),
    } : null,
    teacherAudioElementState: teacherEl ? {
      paused: teacherEl.paused,
      muted: teacherEl.muted,
      volume: teacherEl.volume,
      srcObjectAttached: Boolean(teacherEl.srcObject),
      readyState: teacherEl.readyState,
      currentTime: teacherEl.currentTime,
    } : null,
    teacherTracks,
    studentMicPublishedSfu: Boolean(studentSfuMicPub),
    studentMicPublishedP2p: Boolean(typeof studentP2pMicSender !== "undefined" && studentP2pMicSender && studentP2pMicSender.track),
    receivingTracks: remoteMediaStream ? remoteMediaStream.getTracks().map((t) => ({
      kind: t.kind,
      readyState: t.readyState,
      fromSfu: Boolean(t.__fromSfu),
    })) : [],
    signalingConnected: Boolean(typeof socket !== "undefined" && socket?.connected),
    recentEvents: studentDiagnosticEvents.slice(0, 10),
  };
};

window.getMinasatyStudentLiveStatsAsync = async function getMinasatyStudentLiveStatsAsync() {
  const base = typeof window.getMinasatyStudentLiveDiagnostics === "function" ? window.getMinasatyStudentLiveDiagnostics() : {};
  if (typeof pc !== "undefined" && pc && typeof pc.getStats === "function") {
    try {
      const stats = await pc.getStats();
      let inboundAudioStats = null;
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          inboundAudioStats = {
            bytesReceived: report.bytesReceived || 0,
            packetsReceived: report.packetsReceived || 0,
            packetsLost: report.packetsLost || 0,
            jitter: report.jitter || 0,
          };
        }
      });
      base.inboundAudioStats = inboundAudioStats;
    } catch (_) {}
  }
  return base;
};

function stopSfuReceptionMonitor() {
  if (sfuReceptionMonitor) clearInterval(sfuReceptionMonitor);
  sfuReceptionMonitor = null;
}

function startSfuReceptionMonitor(room) {
  stopSfuReceptionMonitor();
  let busy = false;
  let lastTeacherSeen = Date.now();
  let missingVideoSince = null;
  const progressByPublication = new Map();
  sfuReceptionMonitor = setInterval(async () => {
    if (busy || studentSfuRoom !== room || !joinedClass) return;
    if (room.state !== "connected" || document.visibilityState === "hidden") {
      lastTeacherSeen = Date.now();
      progressByPublication.clear();
      missingVideoSince = null;
      return;
    }
    busy = true;
    try {
      const now = Date.now();
      let teacherPresent = false;
      let teacherVideoPublished = false;
      let stalled = false;
      const activePublications = new Set();
      for (const participant of room.remoteParticipants.values()) {
        if (getSfuParticipantRole(participant) !== "teacher") continue;
        teacherPresent = true;
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind === "video" || publication.track?.kind === "video" || publication.source === "screen_share") teacherVideoPublished = true;
          // Intentional mute and adaptive-stream pauses must not trigger recovery.
          if (publication.isMuted || publication.track?.streamState === "paused"
              || publication.isDesired === false) continue;
          activePublications.add(publication);
          let bytes = null;
          let decodedUnits = null;
          const mediaKind = publication.kind || publication.track?.kind;
          if (typeof publication.track?.getRTCStatsReport === "function") {
            const stats = await publication.track.getRTCStatsReport();
            stats?.forEach((report) => {
              const reportKind = report.kind || report.mediaType;
              if (report.type === "inbound-rtp" && (!reportKind || reportKind === mediaKind) && typeof report.bytesReceived === "number") {
                bytes = (bytes || 0) + report.bytesReceived;
                const units = mediaKind === "audio" ? report.totalSamplesReceived : report.framesDecoded;
                if (typeof units === "number") decodedUnits = (decodedUnits || 0) + units;
              }
            });
          }
          // A browser without usable stats is not evidence of an outage.
          if (bytes === null && publication.track) {
            progressByPublication.delete(publication);
            continue;
          }
          const previous = progressByPublication.get(publication);
          const advanced = Boolean(previous && bytes > previous.bytes &&
            (decodedUnits === null || previous.decodedUnits === null || decodedUnits > previous.decodedUnits));
          const progress = advanced ? now : (previous?.progress || now);
          progressByPublication.set(publication, { bytes, decodedUnits, progress, kind: mediaKind });
          if (advanced && (mediaKind === "audio" || mediaKind === "video") && typeof studentSfuMediaProgress !== "undefined") {
            studentSfuMediaProgress.set(mediaKind, now);
          }
          if (previous && now - progress >= 8_000) stalled = true;
        }
      }
      if (studentSfuRoom !== room || room.state !== "connected" || !joinedClass) return;
      for (const publication of progressByPublication.keys()) {
        if (!activePublications.has(publication)) progressByPublication.delete(publication);
      }
      if (teacherPresent) lastTeacherSeen = now;
      // Room presence and working audio do not prove that an already shared screen arrived.
      const expectsVideo = typeof screenShareActive !== "undefined" && screenShareActive;
      if (expectsVideo && !teacherVideoPublished) {
        if (missingVideoSince === null) missingVideoSince = now;
        if (now - missingVideoSince >= 6_000) stalled = true;
      } else {
        missingVideoSince = null;
      }
      notifySfuTransportStatus(true);
      // Each publication has its own clock: moving video cannot hide stalled audio.
      if (!stalled && now - lastTeacherSeen < 8_000) return;
      if (typeof hasLiveP2pTeacherMedia === "function" && hasLiveP2pTeacherMedia()) {
        recordStudentDiagnosticEvent("p2p_media_preserved", "LiveKit reception stalled; preserving working P2P media while LiveKit retries in the background");
        notifySfuTransportStatus(false);
        const roomName = currentStudentSfuRoomName;
        disconnectStudentSfu({ notify: false });
        if (typeof scheduleStudentSfuRetry === "function") scheduleStudentSfuRetry(roomName, "media stalled while P2P is active");
        return;
      }
      recordStudentDiagnosticEvent("teacher_media_stalled", "Teacher reception stalled; requesting recovery");
      clearStaleSfuMedia();
      disconnectStudentSfu();
      scheduleClassRecovery(150);
    } catch (_) {
      // A failed stats read must not tear down a working media session.
    } finally {
      busy = false;
    }
  }, 1_500);
}

function holdStudentSfuDuringRecovery() {
  // Give the targeted peer recovery time to complete without a competing SFU startup.
  studentSfuRecoveryHoldUntil = Date.now() + 45_000;
}

function isStudentSfuRecoveryHeld() {
  return typeof studentSfuRecoveryHoldUntil !== "undefined"
    && Date.now() < studentSfuRecoveryHoldUntil;
}

async function connectStudentSfu(roomName, { backgroundRetry = false } = {}) {
  if (!backgroundRetry && typeof isStudentSfuRecoveryHeld === "function" && isStudentSfuRecoveryHeld()) {
    notifySfuTransportStatus(false);
    recordStudentDiagnosticEvent("sfu_recovery_held", "Using targeted peer recovery before retrying LiveKit");
    return false;
  }
  if (typeof window.fetchMinasatySfuToken !== "function" || !window.LivekitClient?.Room) {
    console.info("[SFU-Student] LiveKit client or helper not available, using P2P.");
    recordStudentDiagnosticEvent("sfu_unavailable", "LiveKit client or helper not on window");
    notifySfuTransportStatus(false);
    return false;
  }
  if (!roomName) return false;

  if (studentSfuRoom && studentSfuRoom.state === "connected" && currentStudentSfuRoomName === roomName) {
    notifySfuTransportStatus(true);
    return true;
  }

  const getConnectPromise = () => (typeof studentSfuConnectPromise !== "undefined" ? studentSfuConnectPromise : (typeof window !== "undefined" ? window.__studentSfuConnectPromise : null));
  const setConnectPromise = (p) => {
    if (typeof studentSfuConnectPromise !== "undefined") studentSfuConnectPromise = p;
    if (typeof window !== "undefined") window.__studentSfuConnectPromise = p;
  };
  const getNextSessionId = () => {
    if (typeof studentSfuSessionId !== "undefined") {
      return ++studentSfuSessionId;
    }
    const target = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});
    target.__studentSfuSessionId = (target.__studentSfuSessionId || 0) + 1;
    return target.__studentSfuSessionId;
  };
  const getCurrentSessionId = () => {
    if (typeof studentSfuSessionId !== "undefined") {
      return studentSfuSessionId;
    }
    const target = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});
    return target.__studentSfuSessionId || 0;
  };
  const setConnectedTimestamp = (ts) => {
    if (typeof studentSfuConnectedAt !== "undefined") studentSfuConnectedAt = ts;
    if (typeof window !== "undefined") window.__studentSfuConnectedAt = ts;
  };
  const getConnectedTimestamp = () => {
    if (typeof studentSfuConnectedAt !== "undefined") return studentSfuConnectedAt;
    if (typeof window !== "undefined") return window.__studentSfuConnectedAt || 0;
    return 0;
  };

  // If already connecting to this room, await the in-flight operation
  const activePromise = getConnectPromise();
  if (isStudentSfuConnecting && currentStudentSfuRoomName === roomName && activePromise) {
    return activePromise;
  }

  // Proper room switching: close previous room if different BEFORE establishing new room
  const previousRoomName = currentStudentSfuRoomName;
  if (previousRoomName && previousRoomName !== roomName) {
    disconnectStudentSfu();
  }

  isStudentSfuConnecting = true;
  currentStudentSfuRoomName = roomName;
  const sessionId = studentSfuRoom && studentSfuRoom.state !== "disconnected"
    ? getCurrentSessionId() : getNextSessionId();

  const connectTask = (async () => {
    try {
      const activeStudentId = (typeof studentId !== "undefined" ? studentId : "") || (typeof currentStudent !== "undefined" ? currentStudent?.id : "");
      const sfuData = await window.fetchMinasatySfuToken(roomName, false, "", activeStudentId);
      if (sessionId !== getCurrentSessionId()) return false;

      const sfuUrl = sfuData?.url || sfuData?.serverUrl;
      if (!sfuData || !sfuData.enabled || !sfuData.token || !sfuUrl) {
        if (sfuData && sfuData.enabled === false) {
          console.info("[SFU-Student] SFU not enabled by server, staying on P2P.");
          recordStudentDiagnosticEvent("sfu_disabled", "SFU not enabled by server response");
          notifySfuTransportStatus(false);
          if (typeof requestTargetedP2pFallback === "function") {
            requestTargetedP2pFallback("SFU disabled on server", { holdSfu: false });
          }
          return false;
        }
        console.warn("[SFU-Student] SFU token temporarily unavailable, requesting P2P fallback and retrying LiveKit in 3s...");
        recordStudentDiagnosticEvent("sfu_retry_pending", "SFU token temporarily unavailable; requesting P2P fallback");
        if (typeof requestTargetedP2pFallback === "function") {
          requestTargetedP2pFallback("SFU token unavailable", { holdSfu: false });
        }
        if (typeof scheduleStudentSfuRetry === "function") scheduleStudentSfuRetry(roomName, "token temporarily unavailable");
        return false;
      }

      if (!studentSfuRoom || studentSfuRoom.state === "disconnected") {
        const Room = window.LivekitClient.Room;
        studentSfuRoom = new Room({
          adaptiveStream: true,
          dynacast: true,
        });

        studentSfuRoom.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (sessionId !== getCurrentSessionId()) return;
          // Prevent student from hearing self-echo
          const isSelf = Boolean(
            participant?.isLocal ||
            participant?.identity === studentSfuRoom?.localParticipant?.identity ||
            (typeof studentId !== "undefined" && studentId && String(participant?.identity) === String(studentId))
          );
          if (isSelf) {
            return;
          }

          const role = getSfuParticipantRole(participant);
          const isTeacher = Boolean(
            role === "teacher" ||
            participant?.identity === "teacher" ||
            (typeof knownTeacherIdentity !== "undefined" && knownTeacherIdentity && participant?.identity === knownTeacherIdentity) ||
            (typeof teacherSocketId !== "undefined" && teacherSocketId && participant?.identity === teacherSocketId)
          );

          if (!isTeacher) {
            if (role === "student" && track.kind === "audio") {
              console.info("[SFU-Student] Received classmate audio track via SFU from:", participant?.identity);
              playClassmateSfuAudio(participant?.identity, track);
              recordStudentDiagnosticEvent("classmate_audio_received", "Classmate audio received via SFU");
            }
            return;
          }

          // Primary teacher broadcast track
          console.info("[SFU-Student] Received teacher track via SFU:", track.kind);
          if (track.mediaStreamTrack) {
            track.mediaStreamTrack.__fromSfu = true;
            attachTeacherSfuPlaybackTrack(track, participant);
            notifySfuTransportStatus(true);
            recordStudentDiagnosticEvent("teacher_track_received", `Subscribed to teacher ${track.kind} track via SFU`);
          }
        });

        if (window.LivekitClient?.RoomEvent?.TrackPublished) {
          studentSfuRoom.on(window.LivekitClient.RoomEvent.TrackPublished, (publication, participant) => {
            if (sessionId !== getCurrentSessionId()) return;
            const isSelf = Boolean(
              participant?.isLocal ||
              participant?.identity === studentSfuRoom?.localParticipant?.identity ||
              (typeof studentId !== "undefined" && studentId && String(participant?.identity) === String(studentId))
            );
            if (isSelf) return;

            const role = getSfuParticipantRole(participant);
            const isTeacher = Boolean(
              role === "teacher" ||
              participant?.identity === "teacher" ||
              (typeof knownTeacherIdentity !== "undefined" && knownTeacherIdentity && participant?.identity === knownTeacherIdentity) ||
              (typeof teacherSocketId !== "undefined" && teacherSocketId && participant?.identity === teacherSocketId)
            );

            if (!isTeacher && role === "student" && publication?.kind === "audio") {
              if (publication.isSubscribed === false && typeof publication.setSubscribed === "function") {
                try { publication.setSubscribed(true); } catch (_) {}
              }
              if (publication.track) {
                console.info("[SFU-Student] Attaching published classmate audio track from:", participant?.identity);
                playClassmateSfuAudio(participant.identity, publication.track);
              }
            }
          });
        }

        studentSfuRoom.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
          if (sessionId !== getCurrentSessionId()) return;
          detachTeacherSfuPlaybackTrack(track.kind, track);
          if (participant?.identity) {
            stopClassmateSfuAudio(participant.identity, track);
          }
          if (track.mediaStreamTrack) {
            if (typeof teacherAudioStream !== "undefined" && teacherAudioStream && teacherAudioStream.getAudioTracks().some((t) => t.id === track.mediaStreamTrack.id)) {
              try { teacherAudioStream.removeTrack(track.mediaStreamTrack); } catch (_) {}
            }
            if (remoteMediaStream) {
              remoteMediaStream.removeTrack(track.mediaStreamTrack);
              if (typeof syncClassmateSfuAudioPlayback === "function") syncClassmateSfuAudioPlayback();
              if (typeof updateRemoteVideoPresentation === "function") updateRemoteVideoPresentation();
            }
          }
          const grace = typeof SFU_STARTUP_GRACE_PERIOD_MS !== "undefined" ? SFU_STARTUP_GRACE_PERIOD_MS : 2_500;
          const healthy = typeof isStudentSfuHealthy === "function" ? isStudentSfuHealthy() : true;
          if (!healthy && (Date.now() - getConnectedTimestamp() > grace)) {
            notifySfuTransportStatus(false);
          }
        });

        studentSfuRoom.on(window.LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
          if (sessionId !== getCurrentSessionId()) return;
          stopClassmateSfuAudio(participant?.identity);
        });

        studentSfuRoom.on(window.LivekitClient.RoomEvent.Reconnecting, () => {
          if (sessionId !== getCurrentSessionId()) return;
          console.info("[SFU-Student] LiveKit room reconnecting...");
          recordStudentDiagnosticEvent("sfu_reconnecting", "LiveKit SFU room reconnecting; holding media state");
        });

        studentSfuRoom.on(window.LivekitClient.RoomEvent.Reconnected, () => {
          if (sessionId !== getCurrentSessionId()) return;
          console.info("[SFU-Student] LiveKit room reconnected successfully.");
          recordStudentDiagnosticEvent("sfu_reconnected", "LiveKit SFU room reconnected successfully");
          notifySfuTransportStatus(true);
          for (const participant of (studentSfuRoom.remoteParticipants?.values?.() || [])) {
            const role = getSfuParticipantRole(participant);
            if (role === "student") {
              for (const pub of (participant.trackPublications?.values?.() || [])) {
                if (pub?.track && (pub.track.kind === "audio" || pub.kind === "audio")) {
                  playClassmateSfuAudio(participant.identity, pub.track);
                }
              }
            }
          }
        });

        studentSfuRoom.on(window.LivekitClient.RoomEvent.Disconnected, () => {
          if (sessionId !== getCurrentSessionId()) return;
          console.warn("[SFU-Student] Disconnected from SFU room.");
          clearAllClassmateAudio();
          if (typeof clearStaleSfuMedia === "function") clearStaleSfuMedia();
          notifySfuTransportStatus(false);
          recordStudentDiagnosticEvent("sfu_disconnected", "Student disconnected from LiveKit SFU room");
          if (typeof joinedClass !== "undefined" && joinedClass && socket?.connected) {
            if (typeof hasLiveP2pTeacherMedia === "function" && hasLiveP2pTeacherMedia()) {
              recordStudentDiagnosticEvent("p2p_media_preserved", "LiveKit disconnected; preserving P2P media while reconnecting LiveKit in the background");
              if (typeof scheduleStudentSfuRetry === "function") scheduleStudentSfuRetry(roomName, "LiveKit disconnected while P2P is active");
              return;
            }
            if (typeof scheduleClassRecovery === "function") scheduleClassRecovery(500);
          }
        });
      }

      if (studentSfuRoom.state !== "connected") {
        const connectOptions = typeof window.getMinasatySfuConnectOptions === "function"
          ? await window.getMinasatySfuConnectOptions() : {};
        if (sessionId !== getCurrentSessionId()) return false;
        await studentSfuRoom.connect(sfuUrl, sfuData.token, connectOptions);
      }
      if (sessionId !== getCurrentSessionId()) return false;
      setConnectedTimestamp(Date.now());
      studentSfuRetryAttempt = 0;
      if (typeof studentSfuRetryTimer !== "undefined" && studentSfuRetryTimer) window.clearTimeout(studentSfuRetryTimer);
      if (typeof studentSfuRetryTimer !== "undefined") studentSfuRetryTimer = null;
      if (typeof startSfuReceptionMonitor === "function") startSfuReceptionMonitor(studentSfuRoom);

      // Immediately subscribe and attach existing teacher tracks without waiting
      for (const participant of (studentSfuRoom.remoteParticipants?.values?.() || [])) {
        const role = getSfuParticipantRole(participant);
        const isTeacher = Boolean(
          role === "teacher" ||
          participant?.identity === "teacher" ||
          (typeof knownTeacherIdentity !== "undefined" && knownTeacherIdentity && participant?.identity === knownTeacherIdentity) ||
          (typeof teacherSocketId !== "undefined" && teacherSocketId && participant?.identity === teacherSocketId)
        );
        if (isTeacher) {
          for (const pub of (participant.trackPublications?.values?.() || [])) {
            if (pub?.track?.mediaStreamTrack) {
              pub.track.mediaStreamTrack.__fromSfu = true;
              attachTeacherSfuPlaybackTrack(pub.track, participant);
              notifySfuTransportStatus(true);
              recordStudentDiagnosticEvent("teacher_track_received_immediate", `Subscribed immediately to existing teacher ${pub.track.kind} track`);
            }
          }
        } else if (role === "student") {
          for (const pub of (participant.trackPublications?.values?.() || [])) {
            if (pub?.kind === "audio" || pub?.track?.kind === "audio") {
              if (pub.isSubscribed === false && typeof pub.setSubscribed === "function") {
                try { pub.setSubscribed(true); } catch (_) {}
              }
              if (pub?.track) {
                console.info("[SFU-Student] Attaching existing classmate audio track from:", participant.identity);
                playClassmateSfuAudio(participant.identity, pub.track);
              }
            }
          }
        }
      }

      console.info("[SFU-Student] Connected to LiveKit SFU room successfully:", roomName);
      recordStudentDiagnosticEvent("sfu_connected", "Connected to LiveKit SFU: " + roomName);
      notifySfuTransportStatus(true);
      return true;
    } catch (error) {
      if (sessionId !== getCurrentSessionId()) return false;
      if (String(error?.message).includes("Client initiated disconnect") || String(error?.message).includes("cancelled")) {
        return false;
      }
      console.warn("[SFU-Student] SFU connection failed, falling back to P2P:", error);
      recordStudentDiagnosticEvent("sfu_connect_failed", error.message || "Failed to connect to SFU");
      notifySfuTransportStatus(false);
      if (typeof requestTargetedP2pFallback === "function") {
        requestTargetedP2pFallback("SFU connection failed: " + (error?.message || "network error"), { holdSfu: false });
      }
      if (typeof scheduleStudentSfuRetry === "function") scheduleStudentSfuRetry(roomName, "connection failed");
      return false;
    } finally {
      if (sessionId === getCurrentSessionId()) {
        isStudentSfuConnecting = false;
        setConnectPromise(null);
      }
    }
  })();

  setConnectPromise(connectTask);
  return connectTask;
}

function isStudentSfuConnected() {
  return Boolean(studentSfuRoom && studentSfuRoom.state === "connected");
}

function isStudentSfuHealthy() {
  if (!studentSfuRoom) {
    return false;
  }
  // Respect LiveKit SDK transient reconnection phase
  if (studentSfuRoom.state === "reconnecting") {
    return true;
  }
  if (studentSfuRoom.state !== "connected") {
    return false;
  }

  // Startup grace period: give teacher media time to arrive and negotiate
  const grace = typeof SFU_STARTUP_GRACE_PERIOD_MS !== "undefined" ? SFU_STARTUP_GRACE_PERIOD_MS : 2_500;
  const connectedAt = typeof studentSfuConnectedAt !== "undefined"
    ? studentSfuConnectedAt
    : (typeof window !== "undefined" ? window.__studentSfuConnectedAt || 0 : 0);
  const timeSinceConnect = Date.now() - connectedAt;
  if (connectedAt > 0 && timeSinceConnect < grace) {
    return true;
  }

  // A LiveKit room and a live track object do not prove that RTP is arriving.
  // Require recent packet and decoded-media progress before treating SFU as ready.
  return Boolean(typeof getTeacherSfuReceptionState === "function" && getTeacherSfuReceptionState().receiving);
}

async function publishStudentSfuMic(audioStream) {
  if (!isStudentSfuConnected()) {
    console.info("[SFU-Student] SFU not connected; cannot publish student mic to SFU.");
    return false;
  }
  const track = audioStream?.getAudioTracks?.()[0];
  if (!track || track.readyState !== "live") {
    return false;
  }
  if (!microphonePermissionGranted || isStudentMicSyncing) return false;
  isStudentMicSyncing = true;
  const room = studentSfuRoom;
  try {
    if (studentSfuMicPub) {
      const currentTrack = studentSfuMicPub.track?.mediaStreamTrack || studentSfuMicPub.track;
      if (currentTrack === track || currentTrack?.id === track.id) {
        return true;
      }
      try {
        await room.localParticipant.unpublishTrack(studentSfuMicPub.track, false);
      } catch (_) {}
      studentSfuMicPub = null;
    }
    const publication = await room.localParticipant.publishTrack(track, {
      name: "student-mic",
      source: window.LivekitClient?.Track?.Source?.Microphone || "microphone",
      dtx: false,
      red: true,
      audioBitrate: 48000,
      stopOnUnpublish: false,
    });
    if (!microphonePermissionGranted || !joinedClass || studentSfuRoom !== room || track.enabled === false) {
      try { await room.localParticipant.unpublishTrack(publication.track || track, false); } catch (_) {}
      return false;
    }
    studentSfuMicPub = publication;
    console.info("[SFU-Student] Successfully published student mic to LiveKit SFU.");
    recordStudentDiagnosticEvent("student_mic_published_sfu", "Published student mic to SFU");
    return true;
  } catch (err) {
    console.warn("[SFU-Student] Failed to publish student mic to SFU:", err);
    window.LiveDoctor?.report("microphone_publish_failed", { source: "sfu", errorName: err?.name || "Error" });
    recordStudentDiagnosticEvent("student_mic_publish_error", err.message || "SFU mic publish failed");
    return false;
  } finally {
    isStudentMicSyncing = false;
  }
}

function unpublishStudentSfuMic() {
  if (studentSfuRoom && studentSfuMicPub) {
    try {
      if (studentSfuMicPub.track) {
        Promise.resolve(studentSfuRoom.localParticipant.unpublishTrack(studentSfuMicPub.track, false)).catch(() => {});
      }
    } catch (_) { }
    studentSfuMicPub = null;
  }
}

async function publishStudentP2pMic(track, stream) {
  if (!pc || !track || track.readyState !== "live") return false;
  const publishingPeer = pc;
  const senders = typeof pc.getSenders === "function" ? pc.getSenders() : [];
  const existingSender = senders.find((s) => s === studentP2pMicSender || s.__isStudentMic);
  if (existingSender && typeof existingSender.replaceTrack === "function") {
    studentP2pMicSender = existingSender;
    try {
      await existingSender.replaceTrack(track);
    } catch (error) {
      window.LiveDoctor?.report("microphone_replace_track_failed", { source: "p2p", errorName: error?.name || "Error" });
      return false;
    }
    if (pc !== publishingPeer || !microphonePermissionGranted) return false;
    microphoneOfferSent = false;
    microphoneNegotiated = false;
    return await negotiateStudentMicrophone();
  }
  try {
    studentP2pMicSender = pc.addTrack(track, stream);
    if (studentP2pMicSender) {
      studentP2pMicSender.__isStudentMic = true;
    }
    microphoneOfferSent = false;
    microphoneNegotiated = false;
    return await negotiateStudentMicrophone();
  } catch (err) {
    console.warn("[P2P-Student] addTrack for mic failed:", err);
    window.LiveDoctor?.report("microphone_publish_failed", { source: "p2p", errorName: err?.name || "Error" });
    return false;
  }
}

function unpublishStudentP2pMic() {
  if (studentP2pMicSender && typeof studentP2pMicSender.replaceTrack === "function") {
    try {
      studentP2pMicSender.replaceTrack(null).catch(() => {});
    } catch (_) { }
  }
}

function clearStaleSfuMedia() {
  detachTeacherSfuPlaybackTrack("video");
  detachTeacherSfuPlaybackTrack("audio");
  if (remoteMediaStream) {
    const sfuTracks = remoteMediaStream.getTracks().filter((t) => t.__fromSfu);
    for (const t of sfuTracks) {
      try {
        remoteMediaStream.removeTrack(t);
        t.stop();
      } catch (_) {}
    }
  }
  if (typeof teacherAudioStream !== "undefined" && teacherAudioStream) {
    const sfuAudio = teacherAudioStream.getTracks().filter((t) => t.__fromSfu);
    for (const t of sfuAudio) {
      try {
        teacherAudioStream.removeTrack(t);
        t.stop();
      } catch (_) {}
    }
  }
  if (typeof updateRemoteVideoPresentation === "function") {
    try { updateRemoteVideoPresentation(); } catch (_) {}
  }
}

function disconnectStudentSfu({ notify = true } = {}) {
  if (typeof studentSfuRetryTimer !== "undefined" && studentSfuRetryTimer) window.clearTimeout(studentSfuRetryTimer);
  if (typeof studentSfuRetryTimer !== "undefined") studentSfuRetryTimer = null;
  if (typeof stopSfuReceptionMonitor === "function") stopSfuReceptionMonitor();
  if (typeof studentSfuMediaProgress !== "undefined") studentSfuMediaProgress.clear();
  if (typeof studentSfuSessionId !== "undefined") {
    studentSfuSessionId++;
  }
  if (typeof window !== "undefined") {
    window.__studentSfuSessionId = (window.__studentSfuSessionId || 0) + 1;
  }
  isStudentSfuConnecting = false;
  if (typeof studentSfuConnectPromise !== "undefined") {
    studentSfuConnectPromise = null;
  }
  if (typeof window !== "undefined") {
    window.__studentSfuConnectPromise = null;
  }
  currentStudentSfuRoomName = null;
  if (typeof studentSfuConnectedAt !== "undefined") {
    studentSfuConnectedAt = 0;
  }
  if (typeof window !== "undefined") {
    window.__studentSfuConnectedAt = 0;
  }
  if (typeof unpublishStudentSfuMic === "function") unpublishStudentSfuMic();
  if (typeof clearAllClassmateAudio === "function") clearAllClassmateAudio();
  if (typeof clearStaleSfuMedia === "function") clearStaleSfuMedia();
  if (studentSfuRoom) {
    try {
      if (studentSfuRoom.state !== "disconnected") {
        studentSfuRoom.disconnect();
      }
    } catch (_) { }
    studentSfuRoom = null;
  }
  if (notify && typeof notifySfuTransportStatus === "function") notifySfuTransportStatus(false);
}


// Required viewer state for this phase.
let pc;
let localAudioStream;
let remoteMediaStream;
let screenShareActive = false;
let lastScreenShareRevision = 0;
let screenShareRefreshScheduled = false;
let globalFreeClass = false;
let teacherAbsentRealtime = false;
const pendingRemoteAudioTracks = [];

let teacherSocketId = null;
let joinedClass = false;
let isJoining = false;
let isMakingRenegotiationOffer = false;
let microphoneOfferSent = false;
let microphoneNegotiated = false;
let microphonePermissionGranted = false;
let studentMicrophoneSelfClosed = false;
// Browser permission and teacher permission are intentionally separate: the
// first is prepared on entry, while the second alone enables transmission.
let microphonePrepared = false;
let isPreparingMicrophone = false;
let isRequestingMicrophone = false;
let isAttemptingTeacherAudio = false;
let handResetTimer = null;
let didLoseSocketConnection = false;
let isRecoveringStream = false;
let recoveryAttempts = 0;
let recoveryTimer = null;
let p2pDisconnectTimer = null;
const P2P_DISCONNECT_GRACE_MS = 3_500;
const MAX_RECOVERY_ATTEMPTS = 8;
const STUDENT_MIC_PERMISSION_STORAGE_KEY = "studentLiveMicPermission:v1";
const STUDENT_PREJOIN_COMPLETED_KEY = "studentLivePrejoinCompleted:v1";
const pendingIceCandidates = [];
const MAX_QUESTION_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_QUESTION_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
let selectedQuestionImageFile = null;
let selectedQuestionImagePreviewUrl = null;
const renderedQuestionImageUrls = new Set();
const directClassEntryRequested =
  sessionStorage.getItem("joinLiveClassImmediately") === "true" ||
  new URLSearchParams(window.location.search).get("join") === "direct";
let initialAutoJoinPending = directClassEntryRequested;
// After the teacher ends a class, the viewer stays in a passive lobby and
// automatically re-enters the next class for the same level.
let waitingForNextClass = false;
let participationCount = 0;
let prejoinCompleted = false;
let prejoinCameraReady = false;
let studentClassJoinedAt = 0;

const elements = {
  videoFrame: document.querySelector(".video-frame"),
  remoteVideo: document.getElementById("remote-video"),
  enableAudioButton: document.getElementById("enable-audio-btn"),
  placeholder: document.getElementById("video-placeholder"),
  placeholderTitle: document.getElementById("placeholder-title"),
  placeholderDescription: document.getElementById("placeholder-description"),
  levelWelcomeImage: document.getElementById("level-welcome-image"),
  classLevelLabel: document.getElementById("class-level-label"),
  classSubjectLabel: document.getElementById("class-subject-label"),
  exitClassButton: document.getElementById("student-exit-class-btn"),
  liveStartNotice: document.getElementById("live-start-notice"),
  liveStartNoticeCopy: document.getElementById("live-start-notice-copy"),
  screenShareNotice: document.getElementById("screen-share-notice"),
  screenShareWatchButton: document.getElementById("screen-share-watch-btn"),
  participationCount: document.getElementById("student-participation-count"),
  pointsCount: document.getElementById("student-points-count"),
  qualityWrapper: document.getElementById("student-quality-wrapper"),
  qualityButton: document.getElementById("student-quality-btn"),
  qualityLabel: document.getElementById("student-quality-label"),
  qualityMenu: document.getElementById("student-quality-menu"),
  qualityModal: document.getElementById("student-quality-modal"),
  closeQualityModalBtn: document.getElementById("close-quality-modal-btn"),
  dismissQualityModalBtn: document.getElementById("dismiss-quality-modal-btn"),
  qualityBackdrop: document.getElementById("student-quality-backdrop"),
  signalFinderButton: document.getElementById("student-signal-finder-btn"),
  signalFinderModal: document.getElementById("student-signal-finder-modal"),
  closeSignalModalBtn: document.getElementById("close-signal-modal-btn"),
  dismissSignalModalBtn: document.getElementById("dismiss-signal-modal-btn"),
  signalBackdrop: document.getElementById("student-signal-backdrop"),
  calculatorButton: document.getElementById("student-calculator-btn"),
  calculatorModal: document.getElementById("student-calculator-modal"),
  closeCalculatorModalBtn: document.getElementById("close-calculator-modal-btn"),
  calculatorBackdrop: document.getElementById("student-calc-backdrop"),
  joinButton: document.getElementById("join-class-btn"),
  raiseHandButton: document.getElementById("raise-hand-btn"),
  handWaitingActions: document.getElementById("hand-waiting-actions"),
  lowerHandButton: document.getElementById("lower-hand-btn"),
  toggleMicButton: document.getElementById("toggle-mic-btn"),
  chatBox: document.getElementById("chat-box"),
  chatEmpty: document.getElementById("chat-empty"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  desktopChatDirectForm: document.getElementById("desktop-chat-direct-form"),
  desktopChatInput: document.getElementById("desktop-chat-input"),
  chatSendButton: document.getElementById("chat-send-btn"),
  openChatComposeButton: document.getElementById("open-chat-compose-btn"),
  closeChatComposeButton: document.getElementById("close-chat-compose-btn"),
  chatComposeModal: document.getElementById("chat-compose-modal"),
  captureQuestionButton: document.getElementById("capture-question-btn"),
  questionImageInput: document.getElementById("question-image-input"),
  questionImagePreview: document.getElementById("question-image-preview"),
  questionImagePreviewImage: document.getElementById("question-image-preview-img"),
  removeQuestionImageButton: document.getElementById("remove-question-image-btn"),
  subscriptionUpgradeModal: document.getElementById("subscription-upgrade-modal"),
  subscriptionUpgradeTitle: document.getElementById("subscription-upgrade-title"),
  subscriptionUpgradeHeadMessage: document.getElementById("subscription-upgrade-head-message"),
  subscriptionUpgradeMessage: document.getElementById("subscription-upgrade-message"),
  subscriptionDeclineButton: document.getElementById("subscription-decline-btn"),
  refreshFab: document.getElementById("student-refresh-fab"),
  rotateButton: document.getElementById("student-rotate-btn"),
  unrotateButton: document.getElementById("student-unrotate-btn"),
  centerRotateButton: document.getElementById("student-center-rotate-btn"),
  centerUnrotateButton: document.getElementById("student-center-unrotate-btn"),
  mobileControlToast: document.getElementById("student-mobile-control-toast"),
  refreshMediaButton: document.getElementById("refresh-media-btn"),
  desktopFullscreenButton: document.getElementById("desktop-fullscreen-btn"),
  desktopFullscreenExitButton: document.getElementById("desktop-fullscreen-exit-btn"),
  desktopFullscreenCaptureButton: document.getElementById("desktop-fullscreen-capture-btn"),
  desktopFullscreenMessageButton: document.getElementById("desktop-fullscreen-message-btn"),
  classContinueOverlay: document.getElementById("class-continue-overlay"),
  classContinueButton: document.getElementById("class-continue-btn"),
  prejoinOverlay: document.getElementById("student-prejoin-overlay"),
  prejoinMicButton: document.getElementById("student-prejoin-mic-btn"),
  prejoinCameraButton: document.getElementById("student-prejoin-camera-btn"),
  prejoinContinueButton: document.getElementById("student-prejoin-continue-btn"),
  prejoinMicStatus: document.getElementById("student-prejoin-mic-status"),
  prejoinCameraStatus: document.getElementById("student-prejoin-camera-status"),
  prejoinMessage: document.getElementById("student-prejoin-message"),
  teacherMicMuteBanner: document.getElementById("teacher-mic-mute-banner"),
  dismissTeacherMicMuteBtn: document.getElementById("dismiss-teacher-mic-mute-btn"),
};

function openSubscriptionUpgradeModal(reason = "university") {
  if (!elements.subscriptionUpgradeModal) {
    return;
  }

  const isExpired = reason === "EXPIRED";
  const isSubjectUpgrade = reason === "PHYSICS" || reason === "MATH";
  const requiredSubject = reason === "PHYSICS" ? "الفيزياء" : "الرياضيات";
  const currentSubject = reason === "PHYSICS" ? "الرياضيات" : "الفيزياء";
  if (elements.subscriptionUpgradeTitle) {
    elements.subscriptionUpgradeTitle.textContent = isExpired
      ? "انتهت فترة الاشتراك"
      : isSubjectUpgrade
        ? `حصة اليوم ${requiredSubject}`
        : "هذه الحصة مخصصة للاشتراك المدفوع";
  }
  if (elements.subscriptionUpgradeHeadMessage) {
    elements.subscriptionUpgradeHeadMessage.textContent = isExpired
      ? "انتهت فترة اشتراكك في المنصة ولا يمكنك الدخول إلى الحصص حتى يتم تجديد الاشتراك."
      : isSubjectUpgrade
        ? `حصة اليوم ${requiredSubject} وأنت مشترك في ${currentSubject} فقط.`
        : "أنت مشترك في المجاني فقط وهذه الحصة المدفوعة الآن للطلبة ذوي الاشتراك المدفوع.";
  }
  if (elements.subscriptionUpgradeMessage) {
    elements.subscriptionUpgradeMessage.textContent = isExpired
      ? "يرجى تسديد الاشتراك وتجديده للاستمرار في متابعة الحصص المباشرة والواجبات، أو الاتصال بالأستاذ مباشرة على الرقم 0556960950."
      : isSubjectUpgrade
        ? `إذا كنت تريد الاشتراك في ${requiredSubject}، اتصل بالأستاذ مباشرة على الرقم 0556960950.`
        : "للترقية إلى الاشتراك المدفوع، اضغط على الزر الأخضر واتصل بالأستاذ مباشرة على الرقم 0556960950.";
  }
  if (elements.subscriptionDeclineButton) {
    elements.subscriptionDeclineButton.textContent = isExpired
      ? "العودة إلى لوحة المتابعة"
      : isSubjectUpgrade
        ? `لا أريد الاشتراك في ${requiredSubject}`
        : "لا أريد الاشتراك";
  }

  elements.subscriptionUpgradeModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeSubscriptionUpgradeModal() {
  if (!elements.subscriptionUpgradeModal) {
    return;
  }

  elements.subscriptionUpgradeModal.hidden = true;
  document.body.style.overflow = "";
}

/**
 * Read the current student's identity from the session keys used by the portal.
 * The direct keys are the canonical format; object fallbacks keep the viewer
 * compatible with a dashboard that stores the logged-in student as JSON.
 */
function readStoredStudent() {
  const recordKeys = ["student", "currentStudent", "loggedInStudent"];
  let storedRecord = null;

  for (const key of recordKeys) {
    const rawValue = sessionStorage.getItem(key);
    if (!rawValue) {
      continue;
    }

    try {
      const parsedValue = JSON.parse(rawValue);
      if (parsedValue && typeof parsedValue === "object") {
        storedRecord = parsedValue;
        break;
      }
    } catch {
      // A non-JSON legacy value is harmless; canonical direct keys are checked below.
    }
  }

  const studentName =
    sessionStorage.getItem("studentName") ||
    sessionStorage.getItem("currentStudentName") ||
    storedRecord?.studentName ||
    storedRecord?.name ||
    "";

  const level =
    sessionStorage.getItem("level") ||
    sessionStorage.getItem("studentLevel") ||
    sessionStorage.getItem("currentStudentLevel") ||
    storedRecord?.level ||
    "";

  const studentId = sessionStorage.getItem("studentId") || storedRecord?.id || "";

  return {
    studentId: String(studentId).trim(),
    studentName: String(studentName).trim(),
    level: String(level).trim(),
    subscriptionEndDate: storedRecord?.subscriptionEndDate || null,
    subscriptionStartDate: storedRecord?.subscriptionStartDate || null,
    paymentStage: storedRecord?.paymentStage || null,
  };
}

function isStudentLiveSubscriptionExpired(endDateValue) {
  if (!endDateValue) return false;
  try {
    const raw = String(endDateValue).trim();
    let end = null;
    const directMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (directMatch) {
      end = new Date(Number(directMatch[1]), Number(directMatch[2]) - 1, Number(directMatch[3]));
    } else {
      end = new Date(endDateValue);
    }
    if (!end || Number.isNaN(end.getTime())) return false;
    const now = new Date();
    const endCalendar = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const nowCalendar = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return (endCalendar.getTime() - nowCalendar.getTime()) < 0;
  } catch {
    return false;
  }
}

const LIVE_LEVEL_ALIASES = Object.freeze({
  "السنة الأولى متوسط": "السنة الأولى",
  "السنة الثانية متوسط": "السنة الثانية",
  "السنة الثالثة متوسط": "السنة الثالثة",
  "السنة الرابعة متوسط": "السنة الرابعة",
  "1am": "السنة الأولى",
  "2am": "السنة الثانية",
  "3am": "السنة الثالثة",
  "4am": "السنة الرابعة",
});
function canonicalLevel(value) {
  const level = String(value || "").trim();
  return LIVE_LEVEL_ALIASES[level] || LIVE_LEVEL_ALIASES[level.toLowerCase()] || level;
}

const storedStudent = readStoredStudent();
const currentStudent = storedStudent;
const studentId = currentStudent.studentId;
const studentName = currentStudent.studentName;
const level = canonicalLevel(currentStudent.level);

function markPermanentStudentPrejoinCompleted() {
  try {
    localStorage.setItem(STUDENT_PREJOIN_COMPLETED_KEY, "true");
    localStorage.setItem(STUDENT_MIC_PERMISSION_STORAGE_KEY, "granted");
    if (studentId) {
      localStorage.setItem(`${STUDENT_PREJOIN_COMPLETED_KEY}:${studentId}`, "true");
    }
  } catch (error) {
    console.info("Unable to save prejoin completion in localStorage:", error);
  }
  try {
    document.cookie = "studentLivePrejoinCompleted=true; path=/; max-age=63072000; SameSite=Lax";
    if (studentId) {
      document.cookie = `studentLivePrejoin_${encodeURIComponent(studentId)}=true; path=/; max-age=63072000; SameSite=Lax`;
    }
  } catch (error) {
    console.info("Unable to save prejoin completion in cookie:", error);
  }
  try {
    sessionStorage.setItem(STUDENT_PREJOIN_COMPLETED_KEY, "true");
  } catch (ignored) { }
  document.documentElement.classList.add("student-prejoin-completed-user");
}

function hasPermanentStudentPrejoinCompleted() {
  // Microphone is strictly mandatory: entry is never permitted without microphone ready
  return Boolean(microphonePrepared);
}

if (directClassEntryRequested && microphonePrepared) {
  prejoinCompleted = true;
  initialAutoJoinPending = true;
  markPermanentStudentPrejoinCompleted();
  document.documentElement.classList.add("student-prejoin-completed-user");
} else {
  prejoinCompleted = hasPermanentStudentPrejoinCompleted();
  if (prejoinCompleted) {
    document.documentElement.classList.add("student-prejoin-completed-user");
  }
}

const isStudentSubExpired = isStudentLiveSubscriptionExpired(currentStudent.subscriptionEndDate);
if (isStudentSubExpired) {
  initialAutoJoinPending = false;
  prejoinCompleted = false;
} else {
  // Auto join is gated strictly by microphone readiness
  initialAutoJoinPending = Boolean(microphonePrepared);
}

/**
 * Keep status text accessible and use explicit modes rather than injecting
 * server-provided strings as markup.
 */
function consumeDirectClassEntry() {
  initialAutoJoinPending = false;
  sessionStorage.removeItem("joinLiveClassImmediately");

  if (window.location.search) {
    window.history.replaceState({}, document.title, "./student-live.html");
  }
}

async function syncTeacherAbsence() {
  if (!parentSessionToken || !level) return;
  try {
    const response = await fetch(`/api/schedules/${encodeURIComponent(level)}`, {
      headers: { Authorization: `Bearer ${parentSessionToken}`, Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || canonicalLevel(payload.level || level) !== level) return;
    renderTeacherAbsenceNotice(payload.teacherAbsent === true);
  } catch (error) {
    console.info("Unable to load teacher absence state:", error?.message || error);
  }
}

function applyLobbyAbsenceState(response = {}) {
  if (canonicalLevel(response.level || level) !== level) return;
  renderTeacherAbsenceNotice(response.teacherAbsent === true);
}

function waitForNextLiveClass(message = "بانتظار بدء الأستاذ للحصة التالية…") {
  waitingForNextClass = true;
  initialAutoJoinPending = false;
  elements.joinButton.hidden = true;
  elements.joinButton.disabled = true;
  elements.raiseHandButton.hidden = true;
  updateChatControls();
  setPlaceholder("بانتظار الحصة التالية", "ستفتح الحصة تلقائياً فور أن يبدأ الأستاذ البث.");
  setViewerStatus(message, "warning");

  if (socket.connected && level) {
    socket.emit("join_level_lobby", { level }, (response) => {
      applyLobbyAbsenceState(response);
      if (waitingForNextClass && response?.isClassLive) {
        waitingForNextClass = false;
        void joinClass({ prepareMicrophone: true });
      }
    });
  }
}

function joinClassAutomaticallyFromLobby() {
  if (!waitingForNextClass || joinedClass || isJoining) {
    return;
  }

  waitingForNextClass = false;
  void joinClass({ prepareMicrophone: true });
}

function setViewerStatus() {
  // The visual status tray was removed to keep the learner interface compact.
  // Connection and classroom operations continue without rendering a bottom notice.
}

const LIVE_LEVEL_DISPLAY_LABELS = Object.freeze({
  "السنة الأولى": "السنة الأولى متوسط",
  "السنة الثانية": "السنة الثانية متوسط",
  "السنة الثالثة": "السنة الثالثة متوسط",
  "السنة الرابعة": "السنة الرابعة متوسط",
  "السنة الأولى متوسط": "السنة الأولى متوسط",
  "السنة الثانية متوسط": "السنة الثانية متوسط",
  "السنة الثالثة متوسط": "السنة الثالثة متوسط",
  "السنة الرابعة متوسط": "السنة الرابعة متوسط",
  "طالب جامعي": "طالب جامعي",
});

function getLiveLevelLabel(value) {
  return LIVE_LEVEL_DISPLAY_LABELS[value] || value || LIVE_LEVEL_DISPLAY_LABELS[level] || level || "مستواك الدراسي";
}

function getLiveSubjectLabel(value) {
  if (value === "PHYSICS") return "الفيزياء";
  if (value === "FREE") return "حصة مجانية";
  return value === "MATH" ? "الرياضيات" : value || "الحصة المباشرة";
}

function showLiveStartNotice(data = {}, resumed = false) {
  if (!elements.liveStartNotice || !elements.liveStartNoticeCopy) return;

  const levelLabel = data.globalFree ? "لجميع المستويات" : getLiveLevelLabel(data.level);
  const subjectLabel = data.subjectLabel || getLiveSubjectLabel(data.subject);
  if (elements.classSubjectLabel) elements.classSubjectLabel.textContent = subjectLabel;
  elements.liveStartNoticeCopy.textContent = data.globalFree
    ? (resumed ? "استؤنفت الحصة المجانية الآن — ادخل للحصة" : "بدأت الحصة المجانية الآن — ادخل للحصة")
    : resumed
      ? `استؤنفت الحصة الآن — ${levelLabel} — ${subjectLabel}`
      : `بدأت الحصة الآن — ${levelLabel} — ${subjectLabel}`;
  elements.liveStartNotice.hidden = false;
  elements.liveStartNotice.classList.remove("is-visible");
  window.requestAnimationFrame(() => elements.liveStartNotice.classList.add("is-visible"));
}

function hideLiveStartNotice() {
  if (!elements.liveStartNotice) return;
  elements.liveStartNotice.classList.remove("is-visible");
  elements.liveStartNotice.hidden = true;
}

function notifyNativeLiveService(action, details = {}) {
  try {
    if (window.MinasatyNative) {
      if (action === "start") {
        const title = details.title || (elements.classLevelLabel?.textContent || "الحصة المباشرة");
        const teacher = details.teacher || "أكاديمية التفوق";
        window.MinasatyNative.startLiveService(title, teacher);
      } else if (action === "stop") {
        window.MinasatyNative.stopLiveService();
      } else if (action === "pip") {
        window.MinasatyNative.enterPip();
      }
    }
  } catch (err) {
    console.warn("Native bridge notification failed:", err);
  }
}

function exitLiveClass() {
  notifyNativeLiveService("stop");
  initialAutoJoinPending = false;
  clearScreenShareRefreshGuard();
  try {
    const currentTransport = (() => {
      try { return sessionStorage.getItem("studentMediaTransport") || (hasLiveP2pTeacherMedia() ? "p2p" : "sfu"); } catch (_) { return "p2p"; }
    })();
    if (currentStudent?.level && (joinedClass || !waitingForNextClass)) {
      sessionStorage.setItem("lastLiveClassState", JSON.stringify({
        isClassLive: true,
        level: currentStudent.level,
        subject: currentSubject || "MATH",
        globalFree: Boolean(isGlobalFreeClass),
        savedAt: Date.now(),
        preferredTransport: currentTransport,
      }));
    }
  } catch (_) {}
  waitingForNextClass = true;
  joinedClass = false;
  studentClassJoinedAt = 0;
  initialP2pPreviewRequested = false;
  setStudentSessionActive(false);
  sessionStorage.removeItem("joinLiveClassImmediately");
  try {
    localAudioStream?.getTracks().forEach((track) => track.stop());
  } catch {
    // The browser may have already released the local stream.
  }
  try {
    socket.disconnect();
  } catch {
    // Navigation below still completes the exit.
  }
  window.location.replace("./parent-dashboard.html");
}


let classContinueShown = false;
let classContinueRefreshPending = false;

function showClassContinueDialog() {
  // Completely removed per user request: entry proceeds directly without interruption
}

function flushClassContinueRefresh() {
  if (!classContinueRefreshPending || !joinedClass || isJoining || isRecoveringStream || !socket.connected || elements.refreshMediaButton?.disabled) return;
  classContinueRefreshPending = false;
  refreshAudioVideo();
}

function continueWatchingClass() {
  // Direct activation without modal
  void startTeacherAudio({ userInitiated: true });
  if (studentSfuRoom && typeof studentSfuRoom.startAudio === "function") {
    void studentSfuRoom.startAudio().catch(() => {});
  }
  if (elements.classContinueOverlay) elements.classContinueOverlay.hidden = true;
  classContinueRefreshPending = true;
  flushClassContinueRefresh();
  if (!joinedClass && !isJoining && socket.connected) void joinClass();
  elements.refreshMediaButton?.focus({ preventScroll: true });
}

function refreshAudioVideo({ automatic = false } = {}) {
  if (!joinedClass) {
    if (!automatic) showMobileControlToast("يعمل تحديث الصوت والصورة بعد الانضمام إلى الحصة.");
    return;
  }
  if (isJoining || isRecoveringStream) {
    if (!automatic) showMobileControlToast("جارٍ استعادة الحصة، انتظر لحظة ثم حاول مرة أخرى.");
    return;
  }
  if (!socket.connected) {
    if (!automatic) showMobileControlToast("الاتصال بالخادم غير متاح حالياً.");
    return;
  }

  // ── Check if video is actually healthy before tearing everything down ──
  const video = elements.remoteVideo;
  const videoTracks = video?.srcObject?.getVideoTracks?.() || [];
  const videoHealthy = videoTracks.some(t => t.readyState === "live" && !t.muted)
    && video && video.readyState >= 2 && video.videoWidth > 0 && !video.paused;

  const button = elements.refreshMediaButton;
  let label = null;
  if (!automatic) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    button?.classList.add("is-refreshing");
    label = button?.querySelector(".refresh-media-label");
  }

  // If video is healthy, the user most likely just lost audio (autoplay block,
  // audio focus switch, mobile background return). A lightweight audio-only
  // refresh avoids tearing down the SFU/P2P pipeline and the dreaded black screen.
  if (videoHealthy) {
    if (!automatic) {
      if (label) label.textContent = "جارٍ تحديث الصوت…";
      showMobileControlToast("جارٍ تحديث الصوت دون قطع الصورة…");
    }
    if (automatic) recordStudentDiagnosticEvent("automatic_audio_only_refresh", "Video healthy; refreshing audio only without tearing down media pipeline");
    void refreshClassroomAudioOnly({ sourceHint: automatic ? "automatic_audio_refresh" : "manual_audio_refresh" }).then((result) => {
      if (!automatic) {
        const msg = result?.ok ? "تم تحديث الصوت بنجاح" : "تعذّر تحديث الصوت. جرّب الضغط مرة أخرى.";
        showMobileControlToast(msg);
      }
    }).catch(() => {}).finally(() => {
      if (!automatic) {
        if (button) button.disabled = false;
        button?.classList.remove("is-refreshing");
        if (label) label.textContent = "تحديث الصوت والصورة";
      }
    });
    return;
  }

  // Video is broken — full stream recovery is unavoidable.
  if (!automatic) {
    if (label) label.textContent = "جارٍ تحديث الصوت والصورة…";
    showMobileControlToast("جارٍ تحديث الصوت والصورة دون مغادرة الحصة…");
  }

  // Rebuild only the peer connection and request a fresh offer. Avoiding a
  // full-page reload prevents the mobile browser from showing a black screen.
  if (typeof holdStudentSfuDuringRecovery === "function") holdStudentSfuDuringRecovery();
  if (automatic) recordStudentDiagnosticEvent("automatic_media_refresh", "Shared screen has not rendered; refreshing audio/video automatically");
  beginStreamRecovery("جارٍ استعادة الصوت والصورة دون تحديث الصفحة…", { force: true });
  if (!automatic) {
    window.setTimeout(() => {
      if (button) button.disabled = false;
      button?.classList.remove("is-refreshing");
      if (label) label.textContent = "تحديث الصوت والصورة";
    }, 1_500);
  }
}


const automaticMediaRefreshState = { missingSince: null, lastAttempt: null, attempts: 0 };

function checkAutomaticMediaRefresh() {
  const state = automaticMediaRefreshState;
  if (!joinedClass) {
    state.missingSince = null;
    state.lastAttempt = null;
    state.attempts = 0;
    return;
  }
  // During initial class entry, allow a brief grace period (3.5 seconds) for initial media negotiations to arrive.
  const joinedAt = typeof studentClassJoinedAt !== "undefined" ? studentClassJoinedAt : 0;
  if (joinedAt && (Date.now() - joinedAt < 3_500)) {
    state.missingSince = null;
    return;
  }
  // If LiveKit SFU is connected and healthy, media is managed smoothly without tearing down connection.
  if (typeof isStudentSfuConnected === "function" && isStudentSfuConnected()) {
    if (typeof isStudentSfuHealthy === "function" && isStudentSfuHealthy()) {
      state.missingSince = null;
      return;
    }
  }
  // If SFU has been connecting for less than 4 seconds, allow it to finish; otherwise do not block recovery
  if (typeof isStudentSfuConnecting !== "undefined" && isStudentSfuConnecting) {
    if (joinedAt && (Date.now() - joinedAt < 4_000)) {
      state.missingSince = null;
      return;
    }
  }
  if (typeof studentSfuRoom !== "undefined" && studentSfuRoom && studentSfuRoom.state === "connecting") {
    if (joinedAt && (Date.now() - joinedAt < 4_000)) {
      state.missingSince = null;
      return;
    }
  }
  // Background tabs intentionally pause video; never rebuild their connection.
  if (document.visibilityState === "hidden" || !screenShareActive) {
    state.missingSince = null;
    return;
  }
  const video = elements.remoteVideo;
  const tracks = video?.srcObject?.getVideoTracks?.() || [];
  const rendered = tracks.some(track => track.readyState === "live" && !track.muted)
    && video.readyState >= 2 && video.videoWidth > 0 && !video.paused;
  if (rendered) {
    state.missingSince = null;
    state.lastAttempt = null;
    state.attempts = 0;
    return;
  }
  // Respect deliberate subscription/mute settings rather than treating them as outages.
  const sdkVideo = teacherSfuPlaybackTracks.get("video");
  if (sdkVideo?.isMuted || sdkVideo?.streamState === "paused") {
    state.missingSince = null;
    return;
  }
  if (isJoining || isRecoveringStream || !socket.connected || elements.refreshMediaButton?.disabled) return;
  const now = Date.now();
  if (state.missingSince === null) state.missingSince = now;
  if (now - state.missingSince < 2_000 || state.attempts >= 3
      || (state.lastAttempt !== null && now - state.lastAttempt < 4_000)) return;
  state.lastAttempt = now;
  state.missingSince = now;
  state.attempts += 1;
  refreshAudioVideo({ automatic: true });
}

const MOBILE_CONTROLS_POSITION_KEY = "studentMobileControlsPosition";
const STUDENT_MIN_ZOOM = 0.5;
const STUDENT_MAX_ZOOM = 4;
let mobileControlDragState = null;
let ignoreNextRefreshClick = false;
let mobileToastTimer = null;
window.__studentRotationState ||= { virtual: false, requested: false };

function getStudentRotationState() {
  window.__studentRotationState ||= { virtual: false, requested: false };
  return window.__studentRotationState;
}
let captureQuestionOriginalParent = null;
let captureQuestionOriginalNextSibling = null;
const studentZoomState = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  pointers: new Map(),
  startDistance: 0,
  startScale: 1,
  startCenter: null,
  startTranslateX: 0,
  startTranslateY: 0,
  panPointerId: null,
  panStartX: 0,
  panStartY: 0,
  panStartTranslateX: 0,
  panStartTranslateY: 0,
};

function showMobileControlToast(message) {
  if (!elements.mobileControlToast) return;
  elements.mobileControlToast.textContent = message;
  elements.mobileControlToast.hidden = false;
  window.clearTimeout(mobileToastTimer);
  mobileToastTimer = window.setTimeout(() => {
    elements.mobileControlToast.hidden = true;
  }, 3200);
}

function clampMobileControlPosition(left, top) {
  const button = elements.refreshFab;
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - (button?.offsetWidth || 48) - margin);
  const maxTop = Math.max(margin, window.innerHeight - (button?.offsetHeight || 48) - margin);
  return {
    left: Math.min(Math.max(margin, Number(left) || margin), maxLeft),
    top: Math.min(Math.max(margin, Number(top) || margin), maxTop),
  };
}

function applyMobileControlPosition(position) {
  if (!elements.refreshFab || !position) return;
  const safePosition = clampMobileControlPosition(position.left, position.top);
  elements.refreshFab.style.left = `${safePosition.left}px`;
  elements.refreshFab.style.top = `${safePosition.top}px`;
  elements.refreshFab.style.right = "auto";
  elements.refreshFab.style.bottom = "auto";
}

function restoreMobileControlPosition() {
  try {
    const stored = JSON.parse(localStorage.getItem(MOBILE_CONTROLS_POSITION_KEY) || "null");
    if (stored && Number.isFinite(Number(stored.left)) && Number.isFinite(Number(stored.top))) {
      applyMobileControlPosition(stored);
    }
  } catch {
    // A malformed saved position should never block the classroom controls.
  }
}

function saveMobileControlPosition() {
  if (!elements.refreshFab) return;
  const rect = elements.refreshFab.getBoundingClientRect();
  localStorage.setItem(MOBILE_CONTROLS_POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
}

function initializeRefreshFab() {
  const button = elements.refreshFab;
  if (!button) return;

  restoreMobileControlPosition();
  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    mobileControlDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    button.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  button.addEventListener("pointermove", (event) => {
    if (!mobileControlDragState || mobileControlDragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - mobileControlDragState.startX;
    const dy = event.clientY - mobileControlDragState.startY;
    if (Math.hypot(dx, dy) > 5) mobileControlDragState.moved = true;
    if (!mobileControlDragState.moved) return;
    applyMobileControlPosition({
      left: event.clientX - mobileControlDragState.offsetX,
      top: event.clientY - mobileControlDragState.offsetY,
    });
    event.preventDefault();
  });

  button.addEventListener("pointerup", (event) => {
    if (!mobileControlDragState || mobileControlDragState.pointerId !== event.pointerId) return;
    if (mobileControlDragState.moved) {
      saveMobileControlPosition();
      ignoreNextRefreshClick = true;
      window.setTimeout(() => { ignoreNextRefreshClick = false; }, 250);
    }
    mobileControlDragState = null;
    button.releasePointerCapture?.(event.pointerId);
  });

  button.addEventListener("pointercancel", () => {
    mobileControlDragState = null;
  });

  button.addEventListener("click", () => {
    if (ignoreNextRefreshClick) return;
    // Try audio-only recovery first to avoid a full page reload black screen.
    // If the student is in a live class and video is healthy, a lightweight
    // audio kickstart is all that's needed (e.g. autoplay block, audio focus loss).
    if (joinedClass && !isJoining && !isRecoveringStream) {
      const video = elements.remoteVideo;
      const vTracks = video?.srcObject?.getVideoTracks?.() || [];
      const vOk = vTracks.some(t => t.readyState === "live" && !t.muted)
        && video && video.readyState >= 2 && video.videoWidth > 0 && !video.paused;
      if (vOk) {
        showMobileControlToast("جارٍ تحديث الصوت…");
        void refreshClassroomAudioOnly({ sourceHint: "fab_audio_refresh" }).then((r) => {
          showMobileControlToast(r?.ok ? "تم تحديث الصوت بنجاح" : "جارٍ إعادة تحميل الصفحة…");
          if (!r?.ok) window.setTimeout(() => window.location.reload(), 600);
        }).catch(() => window.location.reload());
        return;
      }
    }
    window.location.reload();
  });
}

function isStudentMobileZoomEnabled() {
  const mobileViewport = window.matchMedia?.("(max-width: 900px)").matches || false;
  const root = document.documentElement;
  const mobileLandscapeFallback = root.classList.contains("student-landscape-mode") || root.classList.contains("student-virtual-landscape-mode");
  return mobileViewport || mobileLandscapeFallback;
}

function syncStudentZoomToViewport({ reset = false } = {}) {
  if (reset || !isStudentMobileZoomEnabled()) {
    resetStudentZoom();
    return;
  }
  const width = elements.videoFrame?.clientWidth || window.innerWidth;
  const height = elements.videoFrame?.clientHeight || window.innerHeight;
  studentZoomState.translateX = clampStudentZoomTranslation(studentZoomState.translateX, studentZoomState.scale, width);
  studentZoomState.translateY = clampStudentZoomTranslation(studentZoomState.translateY, studentZoomState.scale, height);
  applyStudentZoom();
}

function syncLandscapeCaptureButton(isLandscape) {
  const captureButton = elements.captureQuestionButton;
  const toolbar = document.querySelector(".viewer-actions-control-row");
  const chatActions = document.querySelector(".student-chat-actions");
  if (!captureButton || !toolbar || !chatActions) return;

  if (isLandscape) {
    if (!captureQuestionOriginalParent) {
      captureQuestionOriginalParent = chatActions;
      captureQuestionOriginalNextSibling = elements.openChatComposeButton || null;
    }
    if (captureButton.parentElement !== toolbar) toolbar.append(captureButton);
    captureButton.classList.add("is-landscape-toolbar-item");
    captureButton.hidden = false;
    return;
  }

  if (captureButton.parentElement === toolbar) {
    captureButton.classList.remove("is-landscape-toolbar-item");
    if (captureQuestionOriginalNextSibling?.parentElement === chatActions) {
      chatActions.insertBefore(captureButton, captureQuestionOriginalNextSibling);
    } else {
      chatActions.append(captureButton);
    }
  }
  captureQuestionOriginalParent = null;
  captureQuestionOriginalNextSibling = null;
}

function syncLandscapeComposerVisibility(isLandscape) {
  const modal = elements.chatComposeModal || document.getElementById("chat-compose-modal");
  // A phone in landscape can be wider than 900px in CSS pixels and may also
  // receive student-desktop-mode. The active manual landscape state must still
  // hide the portrait composer; desktop behavior is preserved when not rotating.
  if (!modal || (isDesktopStudentView() && !isLandscape)) return;

  if (isLandscape) {
    // The landscape2 toolbar must remain visible; the portrait composer would
    // otherwise cover the broadcast because its mobile state is intentionally persistent.
    modal.hidden = true;
    modal.style.setProperty("display", "none", "important");
    document.body.classList.remove("student-chat-compose-open");
    resetStudentKeyboardOffset();
    elements.chatInput?.blur();
    return;
  }

  // Restore the persistent mobile composer when returning to portrait.
  modal.hidden = false;
  modal.style.setProperty("display", "grid", "important");
  document.body.classList.add("student-chat-compose-open");
}

function isPhysicalLandscapeMode() {
  return Boolean(
    (window.matchMedia?.("(orientation: landscape)").matches || false) ||
    (typeof window.innerWidth === "number" && typeof window.innerHeight === "number" && window.innerWidth > window.innerHeight)
  );
}

function getScreenOrientationSafe() {
  const sc = typeof window !== "undefined" && window.screen ? window.screen : (typeof screen !== "undefined" ? screen : null);
  return sc?.orientation || null;
}

function updateRotationControls() {
  // The phone sensor must not change this page by itself. The in-app rotate
  // button is the only control that enables the landscape interface.
  const rotationState = getStudentRotationState();
  const physicallyLandscape = isPhysicalLandscapeMode();

  // If the device is physically held in landscape, we don't need CSS 90deg rotation
  if (rotationState.requested && physicallyLandscape) {
    rotationState.virtual = false;
  }

  const nativeLandscape = rotationState.requested && physicallyLandscape;
  const isLandscape = rotationState.requested && (nativeLandscape || rotationState.virtual);
  const showUnrotate = isLandscape;

  if (elements.rotateButton) elements.rotateButton.hidden = isLandscape;
  if (elements.unrotateButton) elements.unrotateButton.hidden = !showUnrotate;
  if (elements.centerRotateButton) elements.centerRotateButton.hidden = showUnrotate;
  if (elements.centerUnrotateButton) elements.centerUnrotateButton.hidden = !showUnrotate;
  syncLandscapeCaptureButton(showUnrotate);
  document.documentElement.classList.toggle("student-landscape-mode", isLandscape);
  document.documentElement.classList.toggle("student-virtual-landscape-mode", Boolean(rotationState.requested && rotationState.virtual));
  document.body.classList.toggle("hide-ui-for-rotation", Boolean(rotationState.requested && rotationState.virtual));
  syncLandscapeComposerVisibility(isLandscape);

  // Keep zoom and one-finger panning available in both mobile orientations.
  // Desktop remains excluded by isStudentMobileZoomEnabled().
  if (!isStudentMobileZoomEnabled()) {
    resetStudentZoom();
  } else {
    syncStudentZoomToViewport();
  }
}

function applyStudentZoom() {
  const transform = `translate3d(${studentZoomState.translateX}px, ${studentZoomState.translateY}px, 0) scale(${studentZoomState.scale})`;
  [elements.remoteVideo, elements.levelWelcomeImage].forEach((target) => {
    if (!target) return;
    target.style.setProperty("transform", transform, "important");
    target.classList.toggle("student-video-zoomed", studentZoomState.scale > 1.01);
  });
}

function resetStudentZoom() {
  studentZoomState.scale = 1;
  studentZoomState.translateX = 0;
  studentZoomState.translateY = 0;
  studentZoomState.pointers.clear();
  studentZoomState.startDistance = 0;
  studentZoomState.startCenter = null;
  studentZoomState.panPointerId = null;
  studentZoomState.panStartX = 0;
  studentZoomState.panStartY = 0;
  studentZoomState.panStartTranslateX = 0;
  studentZoomState.panStartTranslateY = 0;
  [elements.remoteVideo, elements.levelWelcomeImage].forEach((target) => {
    if (!target) return;
    target.style.setProperty("transform", "none", "important");
    target.classList.remove("student-video-zoomed");
  });
}

function clampStudentZoomTranslation(value, scale, axisSize) {
  const maxOffset = Math.max(0, (axisSize * scale - axisSize) / 2);
  return Math.min(maxOffset, Math.max(-maxOffset, value));
}

function isStudentVirtualRotated() {
  const rotationState = typeof getStudentRotationState === "function" ? getStudentRotationState() : null;
  return Boolean(
    (rotationState?.requested && rotationState?.virtual) ||
    document.documentElement.classList.contains("student-virtual-landscape-mode")
  );
}

function getStudentPointerCenter() {
  const points = [...studentZoomState.pointers.values()];
  return {
    x: (points[0].clientX + points[1].clientX) / 2,
    y: (points[0].clientY + points[1].clientY) / 2,
  };
}

function handleStudentZoomPointerDown(event) {
  if (!isStudentMobileZoomEnabled()) return;
  studentZoomState.pointers.set(event.pointerId, event);
  event.currentTarget.setPointerCapture?.(event.pointerId);

  if (studentZoomState.pointers.size === 1) {
    studentZoomState.panPointerId = event.pointerId;
    studentZoomState.panStartX = event.clientX;
    studentZoomState.panStartY = event.clientY;
    studentZoomState.panStartTranslateX = studentZoomState.translateX;
    studentZoomState.panStartTranslateY = studentZoomState.translateY;
    return;
  }

  if (studentZoomState.pointers.size !== 2) return;
  studentZoomState.panPointerId = null;
  const points = [...studentZoomState.pointers.values()];
  studentZoomState.startDistance = Math.hypot(
    points[1].clientX - points[0].clientX,
    points[1].clientY - points[0].clientY
  );
  studentZoomState.startScale = studentZoomState.scale;
  studentZoomState.startCenter = getStudentPointerCenter();
  studentZoomState.startTranslateX = studentZoomState.translateX;
  studentZoomState.startTranslateY = studentZoomState.translateY;
}

function handleStudentZoomPointerMove(event) {
  if (!studentZoomState.pointers.has(event.pointerId)) return;
  studentZoomState.pointers.set(event.pointerId, event);

  if (studentZoomState.pointers.size === 1 && studentZoomState.panPointerId === event.pointerId && studentZoomState.scale > 1.01) {
    const width = elements.videoFrame?.clientWidth || window.innerWidth;
    const height = elements.videoFrame?.clientHeight || window.innerHeight;
    const rawDeltaX = event.clientX - studentZoomState.panStartX;
    const rawDeltaY = event.clientY - studentZoomState.panStartY;

    let effDeltaX = rawDeltaX;
    let effDeltaY = rawDeltaY;
    if (isStudentVirtualRotated()) {
      effDeltaX = rawDeltaY;
      effDeltaY = -rawDeltaX;
    }

    studentZoomState.translateX = clampStudentZoomTranslation(
      studentZoomState.panStartTranslateX + effDeltaX,
      studentZoomState.scale,
      width
    );
    studentZoomState.translateY = clampStudentZoomTranslation(
      studentZoomState.panStartTranslateY + effDeltaY,
      studentZoomState.scale,
      height
    );
    applyStudentZoom();
    event.preventDefault();
    return;
  }

  if (studentZoomState.pointers.size !== 2 || !studentZoomState.startDistance) return;

  const points = [...studentZoomState.pointers.values()];
  const distance = Math.hypot(
    points[1].clientX - points[0].clientX,
    points[1].clientY - points[0].clientY
  );
  const nextScale = Math.min(
    STUDENT_MAX_ZOOM,
    Math.max(STUDENT_MIN_ZOOM, studentZoomState.startScale * (distance / studentZoomState.startDistance))
  );
  const center = getStudentPointerCenter();
  let deltaX = center.x - studentZoomState.startCenter.x;
  let deltaY = center.y - studentZoomState.startCenter.y;
  if (isStudentVirtualRotated()) {
    const origDeltaX = deltaX;
    deltaX = deltaY;
    deltaY = -origDeltaX;
  }
  const width = elements.videoFrame?.clientWidth || window.innerWidth;
  const height = elements.videoFrame?.clientHeight || window.innerHeight;
  studentZoomState.scale = nextScale;
  studentZoomState.translateX = clampStudentZoomTranslation(studentZoomState.startTranslateX + deltaX, nextScale, width);
  studentZoomState.translateY = clampStudentZoomTranslation(studentZoomState.startTranslateY + deltaY, nextScale, height);
  applyStudentZoom();
  event.preventDefault();
}

function handleStudentZoomPointerEnd(event) {
  studentZoomState.pointers.delete(event.pointerId);
  studentZoomState.startDistance = 0;
  studentZoomState.startCenter = null;

  if (studentZoomState.pointers.size === 1 && studentZoomState.scale > 1.01) {
    const [remainingPointerId, remainingPointer] = [...studentZoomState.pointers.entries()][0];
    studentZoomState.panPointerId = remainingPointerId;
    studentZoomState.panStartX = remainingPointer.clientX;
    studentZoomState.panStartY = remainingPointer.clientY;
    studentZoomState.panStartTranslateX = studentZoomState.translateX;
    studentZoomState.panStartTranslateY = studentZoomState.translateY;
  } else if (studentZoomState.pointers.size === 0) {
    studentZoomState.panPointerId = null;
  }
}

function initializeStudentZoom() {
  const target = elements.videoFrame;
  if (!target) return;
  target.addEventListener("pointerdown", handleStudentZoomPointerDown, { passive: false });
  target.addEventListener("pointermove", handleStudentZoomPointerMove, { passive: false });
  target.addEventListener("pointerup", handleStudentZoomPointerEnd, { passive: true });
  target.addEventListener("pointercancel", handleStudentZoomPointerEnd, { passive: true });
  target.addEventListener("pointerleave", handleStudentZoomPointerEnd, { passive: true });
}

function tryNativeAppOrientation(orientation) {
  const isLandscape = String(orientation || "").startsWith("landscape");
  const bridgeCandidates = [
    window.Android,
    window.AndroidInterface,
    window.Minasaty,
    window.MinasatyApp,
    window.MinassatiApp,
    window.JSBridge,
    window.webkit?.messageHandlers?.Android,
  ];

  for (const bridge of bridgeCandidates) {
    if (!bridge) continue;
    try {
      if (isLandscape) {
        if (typeof bridge.setLandscape === "function") { bridge.setLandscape(); return true; }
        if (typeof bridge.setOrientation === "function") { bridge.setOrientation("landscape"); return true; }
        if (typeof bridge.setOrientationLandscape === "function") { bridge.setOrientationLandscape(); return true; }
        if (typeof bridge.lockOrientation === "function") { bridge.lockOrientation("landscape"); return true; }
        if (typeof bridge.rotateToLandscape === "function") { bridge.rotateToLandscape(); return true; }
        if (typeof bridge.rotateScreen === "function") { bridge.rotateScreen("landscape"); return true; }
        if (typeof bridge.rotate === "function") { bridge.rotate("landscape"); return true; }
        if (typeof bridge.setRequestedOrientation === "function") { bridge.setRequestedOrientation(0); return true; }
      } else {
        if (typeof bridge.setPortrait === "function") { bridge.setPortrait(); return true; }
        if (typeof bridge.setOrientation === "function") { bridge.setOrientation("portrait"); return true; }
        if (typeof bridge.setOrientationPortrait === "function") { bridge.setOrientationPortrait(); return true; }
        if (typeof bridge.unlockOrientation === "function") { bridge.unlockOrientation(); return true; }
        if (typeof bridge.rotateToPortrait === "function") { bridge.rotateToPortrait(); return true; }
        if (typeof bridge.rotateScreen === "function") { bridge.rotateScreen("portrait"); return true; }
        if (typeof bridge.rotate === "function") { bridge.rotate("portrait"); return true; }
        if (typeof bridge.setRequestedOrientation === "function") { bridge.setRequestedOrientation(1); return true; }
      }
    } catch (e) {
      console.warn("Native bridge orientation call error:", e);
    }
  }
  return false;
}

function disableNativeSwipeRefresh() {
  const bridgeCandidates = [
    window.Android,
    window.AndroidInterface,
    window.Minasaty,
    window.MinasatyApp,
    window.MinassatiApp,
    window.JSBridge,
    window.webkit?.messageHandlers?.Android,
  ];

  for (const bridge of bridgeCandidates) {
    if (!bridge) continue;
    try {
      if (typeof bridge.disableSwipeRefresh === "function") bridge.disableSwipeRefresh();
      if (typeof bridge.setSwipeRefreshEnabled === "function") bridge.setSwipeRefreshEnabled(false);
      if (typeof bridge.setSwipeRefresh === "function") bridge.setSwipeRefresh(false);
      if (typeof bridge.disablePullToRefresh === "function") bridge.disablePullToRefresh();
      if (typeof bridge.enablePullToRefresh === "function") bridge.enablePullToRefresh(false);
      if (typeof bridge.setRefreshEnabled === "function") bridge.setRefreshEnabled(false);
      if (typeof bridge.setPullToRefreshEnabled === "function") bridge.setPullToRefreshEnabled(false);
      if (typeof bridge.setEnabled === "function") bridge.setEnabled(false);
    } catch (e) {
      console.warn("Native bridge disable swipe refresh call error:", e);
    }
  }
}

function enableNativeSwipeRefresh() {
  const bridgeCandidates = [
    window.Android,
    window.AndroidInterface,
    window.Minasaty,
    window.MinasatyApp,
    window.MinassatiApp,
    window.JSBridge,
    window.webkit?.messageHandlers?.Android,
  ];

  for (const bridge of bridgeCandidates) {
    if (!bridge) continue;
    try {
      if (typeof bridge.enableSwipeRefresh === "function") bridge.enableSwipeRefresh();
      if (typeof bridge.setSwipeRefreshEnabled === "function") bridge.setSwipeRefreshEnabled(true);
      if (typeof bridge.setSwipeRefresh === "function") bridge.setSwipeRefresh(true);
      if (typeof bridge.enablePullToRefresh === "function") bridge.enablePullToRefresh(true);
      if (typeof bridge.setRefreshEnabled === "function") bridge.setRefreshEnabled(true);
      if (typeof bridge.setPullToRefreshEnabled === "function") bridge.setPullToRefreshEnabled(true);
      if (typeof bridge.setEnabled === "function") bridge.setEnabled(true);
    } catch (_) { }
  }
}

function installPullToRefreshBlocker() {
  disableNativeSwipeRefresh();

  try {
    document.documentElement.style.setProperty("overscroll-behavior", "none", "important");
    document.documentElement.style.setProperty("overscroll-behavior-y", "none", "important");
    document.documentElement.style.setProperty("overscroll-behavior-x", "none", "important");
    if (document.body) {
      document.body.style.setProperty("overscroll-behavior", "none", "important");
      document.body.style.setProperty("overscroll-behavior-y", "none", "important");
      document.body.style.setProperty("overscroll-behavior-x", "none", "important");
    }
  } catch (_) { }

  let touchStartY = 0;
  let touchStartX = 0;

  window.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
      }
      disableNativeSwipeRefresh();
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const touchY = e.touches[0].clientY;
      const touchX = e.touches[0].clientX;
      const deltaY = touchY - touchStartY;
      const deltaX = touchX - touchStartX;

      const isLandscapeMode =
        document.documentElement.classList.contains("student-landscape-mode") ||
        document.documentElement.classList.contains("student-virtual-landscape-mode") ||
        window.innerWidth > window.innerHeight;

      let target = e.target;
      let scrollableContainer = null;
      while (target && target !== document.body && target !== document.documentElement) {
        const style = window.getComputedStyle(target);
        const overflowY = style.overflowY;
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          target.scrollHeight > target.clientHeight
        ) {
          scrollableContainer = target;
          break;
        }
        target = target.parentElement;
      }

      if (isLandscapeMode) {
        if (!scrollableContainer) {
          if (e.cancelable) e.preventDefault();
          return;
        }
        if (deltaY > 0 && scrollableContainer.scrollTop <= 0) {
          if (e.cancelable) e.preventDefault();
        } else if (
          deltaY < 0 &&
          scrollableContainer.scrollTop + scrollableContainer.clientHeight >= scrollableContainer.scrollHeight - 1
        ) {
          if (e.cancelable) e.preventDefault();
        }
        return;
      }

      if (deltaY > 0) {
        const pageScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
        if (!scrollableContainer && pageScrollY <= 0) {
          if (e.cancelable) e.preventDefault();
        } else if (scrollableContainer && scrollableContainer.scrollTop <= 0) {
          if (e.cancelable) e.preventDefault();
        }
      }
    },
    { passive: false }
  );
}

installPullToRefreshBlocker();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installPullToRefreshBlocker);
}

async function lockStudentOrientation(orientation) {
  const isLandscape = String(orientation || "").startsWith("landscape");
  const state = getStudentRotationState();

  if (!isLandscape) {
    return unrotateStudentScreen();
  }

  state.requested = true;

  // 1. Fullscreen request (safe attempt without throwing)
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch (fsError) {
    console.info("Safe fullscreen bypass in live viewer:", fsError);
  }

  // 2. Try native Android App bridge if exposed by the Android application wrapper
  const appBridgeRotated = tryNativeAppOrientation("landscape");

  // 3. Try standard W3C screen orientation lock (supported in mobile Chrome)
  let nativeLockSucceeded = false;
  try {
    const orientationController = getScreenOrientationSafe();
    if (orientationController && typeof orientationController.lock === "function") {
      await orientationController.lock("landscape");
      nativeLockSucceeded = true;
    }
  } catch (orientationError) {
    console.info("Native screen orientation lock not supported in this WebView environment, using in-app landscape mode:", orientationError);
  }

  // 4. If device is physically landscape or native rotation succeeded, use direct landscape mode.
  // Otherwise (e.g. inside official Android App WebView holding phone in portrait), activate virtual landscape rotation.
  const physicallyLandscape = isPhysicalLandscapeMode();
  if (nativeLockSucceeded || appBridgeRotated || physicallyLandscape) {
    state.virtual = false;
  } else {
    state.virtual = true;
  }

  updateRotationControls();
  showMobileControlToast("تم تدوير الشاشة بنجاح.");
  return true;
}

async function rotateStudentScreen() {
  getStudentRotationState().requested = true;
  await lockStudentOrientation("landscape");
}

async function unrotateStudentScreen() {
  try {
    const state = getStudentRotationState();
    state.requested = false;
    state.virtual = false;
    document.documentElement.classList.remove("student-virtual-landscape-mode", "student-landscape-mode");
    document.body.classList.remove("hide-ui-for-rotation");

    // Unlock native orientation if supported
    const orientationController = getScreenOrientationSafe();
    if (orientationController?.unlock) {
      try {
        orientationController.unlock();
      } catch (unlockErr) {
        console.info("Screen orientation unlock skipped:", unlockErr);
      }
    }

    // Call native Android bridge for portrait
    tryNativeAppOrientation("portrait");

    // Exit fullscreen if active
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch (exitFsErr) {
        console.info("Exit fullscreen skipped:", exitFsErr);
      }
    }

    resetStudentZoom();
    updateRotationControls();
    showMobileControlToast("تم إلغاء تدوير الشاشة.");
    return true;
  } catch (error) {
    console.warn("Unable to unlock student screen orientation:", error);
    updateRotationControls();
    showMobileControlToast("تم إلغاء تدوير الشاشة.");
    return false;
  }
}

function updateDesktopFullscreenState() {
  const desktopViewport = window.matchMedia?.("(min-width: 901px)").matches || false;
  const isFullscreen = desktopViewport && Boolean(document.fullscreenElement);
  document.documentElement.classList.toggle("student-desktop-fullscreen-mode", isFullscreen);
  if (elements.desktopFullscreenButton) elements.desktopFullscreenButton.hidden = isFullscreen;
  if (elements.desktopFullscreenExitButton) elements.desktopFullscreenExitButton.hidden = !isFullscreen;
  if (elements.desktopFullscreenCaptureButton) elements.desktopFullscreenCaptureButton.hidden = !isFullscreen;
  if (elements.desktopFullscreenMessageButton) elements.desktopFullscreenMessageButton.hidden = !isFullscreen;
}

async function enterDesktopFullscreen() {
  if (!document.documentElement.requestFullscreen) {
    showMobileControlToast("ملء الشاشة غير مدعوم في هذا المتصفح.");
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    console.warn("Unable to enter desktop fullscreen:", error);
    showMobileControlToast("تعذر فتح وضع ملء الشاشة.");
  }
  updateDesktopFullscreenState();
}

async function exitDesktopFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch (error) {
    console.warn("Unable to exit desktop fullscreen:", error);
  }
  updateDesktopFullscreenState();
}

function initializeDesktopFullscreen() {
  elements.desktopFullscreenButton?.addEventListener("click", () => { void enterDesktopFullscreen(); });
  elements.desktopFullscreenExitButton?.addEventListener("click", () => { void exitDesktopFullscreen(); });
  elements.desktopFullscreenCaptureButton?.addEventListener("click", () => elements.captureQuestionButton?.click());
  elements.desktopFullscreenMessageButton?.addEventListener("click", () => elements.openChatComposeButton?.click());
  document.addEventListener("fullscreenchange", updateDesktopFullscreenState);
  window.addEventListener("resize", updateDesktopFullscreenState);
  updateDesktopFullscreenState();
}

function initializeMobileControls() {
  initializeRefreshFab();
  initializeStudentZoom();
  elements.rotateButton?.addEventListener("click", () => { void rotateStudentScreen(); });
  elements.unrotateButton?.addEventListener("click", () => { void unrotateStudentScreen(); });
  elements.centerRotateButton?.addEventListener("click", () => { void rotateStudentScreen(); });
  elements.centerUnrotateButton?.addEventListener("click", () => { void unrotateStudentScreen(); });
  getScreenOrientationSafe()?.addEventListener?.("change", updateRotationControls);
  window.addEventListener("orientationchange", updateRotationControls);
  window.addEventListener("resize", () => {
    if (elements.refreshFab?.style.left) {
      applyMobileControlPosition({
        left: elements.refreshFab.getBoundingClientRect().left,
        top: elements.refreshFab.getBoundingClientRect().top,
      });
    }
    updateRotationControls();
    window.requestAnimationFrame(() => syncStudentZoomToViewport());
  });
  updateRotationControls();
}

// Visual-only keyboard compensation. It never changes a stream, peer
// connection, socket event, or message payload; it only moves the composer
// above the virtual keyboard while the video frame keeps its stable size.
function updateStudentKeyboardOffset() {
  const root = document.documentElement;
  const page = document.body;
  const isMobile = window.matchMedia?.("(max-width: 900px)").matches;
  const viewport = window.visualViewport;
  const inputFocused = document.activeElement === elements.chatInput;

  let keyboardOffset = 0;
  if (isMobile && viewport && inputFocused) {
    const layoutHeight = Math.max(
      document.documentElement?.clientHeight || 0,
      window.innerHeight || 0,
      viewport.height || 0,
    );
    const viewportHeight = viewport.height || layoutHeight;
    const coveredHeight = layoutHeight - viewportHeight - (viewport.offsetTop || 0);
    const keyboardLikelyOpen = viewportHeight < layoutHeight - 80;
    if (keyboardLikelyOpen && coveredHeight > 0) {
      keyboardOffset = Math.min(coveredHeight, Math.round(viewportHeight * 0.65));
    }
  }

  root.style.setProperty("--student-keyboard-offset", `${Math.max(0, Math.round(keyboardOffset))}px`);
  page?.classList.toggle("student-keyboard-open", keyboardOffset > 0);
}

function initializeStudentKeyboardLayout() {
  const input = elements.chatInput;
  if (!input) return;

  const scheduleUpdate = () => window.requestAnimationFrame(updateStudentKeyboardOffset);
  input.addEventListener("focus", scheduleUpdate, { passive: true });
  input.addEventListener("blur", () => window.setTimeout(scheduleUpdate, 120), { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleUpdate, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  window.addEventListener("orientationchange", scheduleUpdate, { passive: true });
  scheduleUpdate();
}

function setParticipationCount(value) {
  participationCount = Math.max(0, Number.parseInt(value, 10) || 0);
  if (elements.participationCount) {
    elements.participationCount.textContent = `مشاركاتي: ${participationCount}`;
  }
}

let studentPointsTotal = 0;

function setStudentPointsCount(value) {
  studentPointsTotal = Math.max(0, Number.parseInt(value, 10) || 0);
  if (elements.pointsCount) {
    elements.pointsCount.textContent = `⭐ نقاطي: ${studentPointsTotal}`;
  }
}

const STUDENT_VIDEO_QUALITY_KEY = "studentLiveVideoQuality:v1";
const VIDEO_QUALITY_LABELS = {
  auto: "تلقائية",
  high: "عالية",
  medium: "متوسطة",
  low: "ضعيفة",
};

let currentVideoQuality = (() => {
  try {
    const saved = localStorage.getItem(STUDENT_VIDEO_QUALITY_KEY);
    if (saved && ["auto", "high", "medium", "low"].includes(saved)) {
      return saved;
    }
  } catch { }
  return "auto";
})();

function updateQualityUI(quality) {
  const normalized = ["auto", "high", "medium", "low"].includes(quality) ? quality : "auto";
  const label = VIDEO_QUALITY_LABELS[normalized] || "تلقائية";
  if (elements.qualityLabel) {
    elements.qualityLabel.textContent = label;
  }
  if (elements.qualityButton) {
    elements.qualityButton.setAttribute("title", `جودة البث: ${label}`);
    elements.qualityButton.setAttribute("aria-label", `جودة البث: ${label}`);
  }
  const options = document.querySelectorAll(".quality-option");
  options.forEach((btn) => {
    const optQuality = btn.getAttribute("data-quality");
    const isSelected = optQuality === normalized;
    btn.classList.toggle("is-active", isSelected);
    btn.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

function setStudentVideoQuality(quality, { notifyServer = true, showToast = false } = {}) {
  const normalized = ["auto", "high", "medium", "low"].includes(quality) ? quality : "auto";
  currentVideoQuality = normalized;
  try {
    localStorage.setItem(STUDENT_VIDEO_QUALITY_KEY, normalized);
  } catch { }

  updateQualityUI(normalized);

  if (notifyServer && socket && socket.connected) {
    socket.emit("student_set_video_quality", { quality: normalized });
  }

  // Adjust local video track constraints if supported
  try {
    const remoteStream = elements.remoteVideo?.srcObject;
    const videoTrack = remoteStream?.getVideoTracks?.()[0];
    if (videoTrack && typeof videoTrack.applyConstraints === "function") {
      if (normalized === "low") {
        videoTrack.applyConstraints({ frameRate: { max: 15 } }).catch(() => { });
      } else if (normalized === "medium") {
        videoTrack.applyConstraints({ frameRate: { max: 30 } }).catch(() => { });
      } else {
        videoTrack.applyConstraints({ frameRate: { max: 60 } }).catch(() => { });
      }
    }
  } catch { }

  if (showToast) {
    const label = VIDEO_QUALITY_LABELS[normalized] || normalized;
    showMobileControlToast(`تم ضبط جودة البث: ${label}`);
  }
}

function openQualityModal() {
  const modal = elements.qualityModal || document.getElementById("student-quality-modal");
  if (!modal) return;
  modal.hidden = false;
  elements.qualityWrapper?.classList.add("is-open");
  elements.qualityButton?.setAttribute("aria-expanded", "true");
  document.body.classList.add("quality-modal-open");
}

function closeQualityModal() {
  const modal = elements.qualityModal || document.getElementById("student-quality-modal");
  if (!modal) return;
  modal.hidden = true;
  elements.qualityWrapper?.classList.remove("is-open");
  elements.qualityButton?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("quality-modal-open");
}

function toggleQualityModal(event) {
  event?.stopPropagation?.();
  const modal = elements.qualityModal || document.getElementById("student-quality-modal");
  if (!modal) return;
  if (modal.hidden) {
    openQualityModal();
  } else {
    closeQualityModal();
  }
}

const openQualityMenu = openQualityModal;
const closeQualityMenu = closeQualityModal;
const toggleQualityMenu = toggleQualityModal;

function initializeQualitySelector() {
  elements.qualityWrapper = document.getElementById("student-quality-wrapper");
  elements.qualityButton = document.getElementById("student-quality-btn");
  elements.qualityLabel = document.getElementById("student-quality-label");
  elements.qualityMenu = document.getElementById("student-quality-menu");
  elements.qualityModal = document.getElementById("student-quality-modal");
  elements.closeQualityModalBtn = document.getElementById("close-quality-modal-btn");
  elements.dismissQualityModalBtn = document.getElementById("dismiss-quality-modal-btn");
  elements.qualityBackdrop = document.getElementById("student-quality-backdrop");

  if (!elements.qualityButton) return;

  updateQualityUI(currentVideoQuality);

  elements.qualityButton.addEventListener("click", toggleQualityModal);

  elements.closeQualityModalBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeQualityModal();
  });

  elements.dismissQualityModalBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeQualityModal();
  });

  elements.qualityBackdrop?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeQualityModal();
  });

  const options = document.querySelectorAll(".quality-option");
  options.forEach((optBtn) => {
    optBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const q = optBtn.getAttribute("data-quality");
      setStudentVideoQuality(q, { notifyServer: true, showToast: true });
      closeQualityModal();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeQualityModal();
    }
  });
}

/* ===== Home Signal Finder (Real-time Speedometer & Radar) ===== */
let signalSamplingTimer = null;
let lastPacketsLost = 0;
let lastPacketsReceived = 0;
let lastSignalScore = 0;
let isSignalQualified = false;
let signalQualifiedStartTime = null;

function openSignalFinderModal() {
  const modal = elements.signalFinderModal || document.getElementById("student-signal-finder-modal");
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("signal-modal-open");
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    try { document.activeElement.blur(); } catch (e) { }
  }
  const btn = elements.signalFinderButton || document.getElementById("student-signal-finder-btn");
  if (btn) btn.setAttribute("aria-expanded", "true");

  isSignalQualified = false;
  signalQualifiedStartTime = null;

  // Run immediate sample then repeat every 600ms
  void sampleConnectionHealth();
  if (signalSamplingTimer) clearInterval(signalSamplingTimer);
  signalSamplingTimer = setInterval(() => {
    void sampleConnectionHealth();
  }, 600);
}

function closeSignalFinderModal() {
  const modal = elements.signalFinderModal || document.getElementById("student-signal-finder-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("signal-modal-open");
  const btn = elements.signalFinderButton || document.getElementById("student-signal-finder-btn");
  if (btn) btn.setAttribute("aria-expanded", "false");

  if (signalSamplingTimer) {
    clearInterval(signalSamplingTimer);
    signalSamplingTimer = null;
  }
  isSignalQualified = false;
  signalQualifiedStartTime = null;
}

function toggleSignalFinderModal(event) {
  event?.stopPropagation?.();
  const modal = elements.signalFinderModal || document.getElementById("student-signal-finder-modal");
  if (!modal) return;
  if (modal.hidden) {
    openSignalFinderModal();
  } else {
    closeSignalFinderModal();
  }
}

async function sampleConnectionHealth() {
  let rttMs = 28;
  let lossRate = 0;
  let jitterMs = 3;
  let connName = "Wi-Fi (5GHz)";
  let isWifi = true;
  let isSim1 = false;
  let isSim2 = false;

  // 1. Check NetworkInformation API (معاملة بيانات الهاتف كأنها شبكة Wi-Fi عالية السرعة دائماً)
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (typeof conn.rtt === "number" && conn.rtt > 0) {
      // تعديل زمن الاستجابة التقديري على شبكات الهاتف ليتطابق مع معيار الواي فاي السريع
      rttMs = Math.min(conn.rtt, 35);
    }
  }

  // 2. Query WebRTC Stats via pc.getStats()
  if (pc && (pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")) {
    try {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === "candidate-pair" && (report.state === "succeeded" || report.nominated || report.selected)) {
          if (typeof report.currentRoundTripTime === "number") {
            rttMs = Math.round(report.currentRoundTripTime * 1000);
          }
        } else if (report.type === "inbound-rtp" && (report.kind === "video" || report.mediaType === "video")) {
          if (typeof report.jitter === "number") {
            jitterMs = Math.round(report.jitter * 1000);
          }
          if (typeof report.packetsLost === "number" && typeof report.packetsReceived === "number") {
            if (lastPacketsReceived > 0) {
              const dLost = Math.max(0, report.packetsLost - lastPacketsLost);
              const dRecv = Math.max(0, report.packetsReceived - lastPacketsReceived);
              if (dRecv + dLost > 0) {
                lossRate = dLost / (dRecv + dLost);
              }
            }
            lastPacketsLost = report.packetsLost;
            lastPacketsReceived = report.packetsReceived;
          }
        }
      });
    } catch (_) { }
  } else {
    // Lightweight latency check fallback
    const t0 = performance.now();
    try {
      await fetch("/manifest.json?t=" + Date.now(), { method: "HEAD", cache: "no-store" });
      const diff = Math.round(performance.now() - t0);
      if (diff > 0 && diff < 1500) {
        rttMs = diff;
      }
    } catch (_) { }
  }

  // 3. Map Health to 0-100 Score
  let latencyScore = Math.max(0, 50 - (rttMs / 8));
  let lossScore = Math.max(0, 35 * (1 - lossRate * 10));
  let jitterScore = Math.max(0, 15 - (jitterMs / 3));

  let score = Math.round(Math.min(100, Math.max(5, latencyScore + lossScore + jitterScore)));

  // Smooth smoothing
  if (lastSignalScore > 0) {
    score = Math.round(lastSignalScore * 0.25 + score * 0.75);
  }
  lastSignalScore = score;

  // 4. Update SVG Needle rotation (-130deg for 0% to +130deg for 100%)
  const angle = -130 + (score / 100) * 260;
  const needle = document.getElementById("signal-gauge-needle");
  if (needle) {
    needle.style.transform = `rotate(${angle.toFixed(1)}deg)`;
  }

  // Readouts
  const scoreNumEl = document.getElementById("signal-score-num");
  if (scoreNumEl) scoreNumEl.textContent = score;

  const rttEl = document.getElementById("signal-rtt-display");
  if (rttEl) rttEl.textContent = `${rttMs} ms`;

  const lossEl = document.getElementById("signal-loss-display");
  if (lossEl) lossEl.textContent = `${(lossRate * 100).toFixed(1)}%`;

  const jitterEl = document.getElementById("signal-jitter-display");
  if (jitterEl) jitterEl.textContent = `${jitterMs} ms`;

  const connTextEl = document.getElementById("signal-conn-text");
  if (connTextEl) connTextEl.textContent = connName;

  const statusBadge = document.getElementById("signal-status-badge");
  if (statusBadge) {
    statusBadge.className = "signal-status-pill";
    if (score >= 80) {
      statusBadge.classList.add("is-high");
      statusBadge.textContent = "ممتازة جداً (High)";
    } else if (score >= 60) {
      statusBadge.classList.add("is-good");
      statusBadge.textContent = "جيدة ومستقرة (Good)";
    } else if (score >= 40) {
      statusBadge.classList.add("is-ok");
      statusBadge.textContent = "مقبولة (OK)";
    } else {
      statusBadge.classList.add("is-low");
      statusBadge.textContent = "ضعيفة (Low)";
    }
  }

  // Connection indicator pills
  const wifiPill = document.getElementById("indicator-wifi");
  const sim1Pill = document.getElementById("indicator-sim1");
  const sim2Pill = document.getElementById("indicator-sim2");
  if (wifiPill) wifiPill.classList.toggle("is-active", isWifi);
  if (sim1Pill) sim1Pill.classList.toggle("is-active", isSim1);
  if (sim2Pill) sim2Pill.classList.toggle("is-active", isSim2);

  // 5. Fixed Guidance Card Logic (Realistic Threshold: Score >= 50% or RTT <= 160ms with 0 loss stable for 2 seconds)
  const guidanceCard = document.getElementById("signal-guidance-card");
  const guidanceIcon = document.getElementById("guidance-card-icon");
  const guidanceTitle = document.getElementById("guidance-card-title");
  const guidanceSub = document.getElementById("guidance-card-sub");

  const qualifies = (score >= 50) || (rttMs <= 160 && lossRate === 0);

  if (qualifies) {
    if (!signalQualifiedStartTime) {
      signalQualifiedStartTime = Date.now();
    }
    // Must remain stable at or above this threshold for 2 consecutive seconds (2000ms)
    if (Date.now() - signalQualifiedStartTime >= 2000) {
      isSignalQualified = true;
    }
  } else {
    // If the score drops below 40% (or heavy loss/latency), revert back to searching state
    if (score < 40 || lossRate > 0.02 || rttMs > 220) {
      isSignalQualified = false;
      signalQualifiedStartTime = null;
    }
  }

  if (guidanceCard && guidanceTitle) {
    if (isSignalQualified) {
      guidanceCard.classList.add("is-qualified");
      if (guidanceIcon) guidanceIcon.textContent = "🎯";
      guidanceTitle.textContent = "🎯 قف هنا! الإشارة في هذا المكان كافية وممتازة لمتابعة الحصة بدون تقطيع.";
      if (guidanceSub) {
        guidanceSub.textContent = "(يمكنك الاستقرار هنا، أو تجربة مكان آخر في المنزل إذا رغبت).";
        guidanceSub.hidden = false;
      }
    } else {
      guidanceCard.classList.remove("is-qualified");
      if (guidanceIcon) guidanceIcon.textContent = "🚶‍♂️";
      guidanceTitle.textContent = "🚶‍♂️ تجول في المنزل وابحث عن مكان مناسب لمتابعة الحصة...";
      if (guidanceSub) {
        guidanceSub.hidden = true;
      }
    }
  }
}

function initializeSignalFinder() {
  elements.signalFinderButton = document.getElementById("student-signal-finder-btn");
  elements.signalFinderModal = document.getElementById("student-signal-finder-modal");
  elements.closeSignalModalBtn = document.getElementById("close-signal-modal-btn");
  elements.dismissSignalModalBtn = document.getElementById("dismiss-signal-modal-btn");
  elements.signalBackdrop = document.getElementById("student-signal-backdrop");

  if (!elements.signalFinderButton) return;

  elements.signalFinderButton.addEventListener("click", toggleSignalFinderModal);

  elements.closeSignalModalBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSignalFinderModal();
  });

  elements.dismissSignalModalBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSignalFinderModal();
  });

  elements.signalBackdrop?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSignalFinderModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && elements.signalFinderModal && !elements.signalFinderModal.hidden) {
      closeSignalFinderModal();
    }
  });
}

/* ==========================================================================
   MINASATY SCIENTIFIC CALCULATOR ENGINE & CONTROLLER
   الدوال المثلثية (DEG/RAD)، الجذور والأسس، الكسور S⇄D، العمليات الحسابية
   ========================================================================== */

const calcState = {
  expression: "",
  result: "0",
  numericResult: 0,
  isFractionDisplay: false,
  angleMode: "DEG", // "DEG" (default in Algerian middle/high schools) or "RAD"
  evaluated: false,
};

function decimalToFraction(x, maxDenominator = 10000) {
  if (!Number.isFinite(x)) return null;
  if (Number.isInteger(x)) return { num: x, den: 1, text: String(x) };

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
  let b = absX;
  for (let i = 0; i < 35; i++) {
    const a = Math.floor(b);
    const auxH = h1;
    h1 = a * h1 + h2;
    h2 = auxH;
    const auxK = k1;
    k1 = a * k1 + k2;
    k2 = auxK;

    if (k1 > maxDenominator) break;
    if (Math.abs(absX - h1 / k1) <= Math.max(1e-8, absX * 1e-7)) {
      const num = sign * h1;
      const den = k1;
      return { num, den, text: `${num}/${den}` };
    }
    const diff = b - a;
    if (Math.abs(diff) < 1e-10) break;
    b = 1 / diff;
  }
  return null;
}

function safeSin(val, mode) {
  if (mode === "DEG") {
    const norm = ((val % 360) + 360) % 360;
    if (norm === 0 || norm === 180) return 0;
    if (norm === 90) return 1;
    if (norm === 270) return -1;
    if (norm === 30 || norm === 150) return 0.5;
    if (norm === 210 || norm === 330) return -0.5;
  }
  const rad = mode === "DEG" ? (val * Math.PI) / 180 : val;
  const res = Math.sin(rad);
  return Math.abs(res) < 1e-12 ? 0 : res;
}

function safeCos(val, mode) {
  if (mode === "DEG") {
    const norm = ((val % 360) + 360) % 360;
    if (norm === 90 || norm === 270) return 0;
    if (norm === 0) return 1;
    if (norm === 180) return -1;
    if (norm === 60 || norm === 300) return 0.5;
    if (norm === 120 || norm === 240) return -0.5;
  }
  const rad = mode === "DEG" ? (val * Math.PI) / 180 : val;
  const res = Math.cos(rad);
  return Math.abs(res) < 1e-12 ? 0 : res;
}

function safeTan(val, mode) {
  if (mode === "DEG") {
    const norm = ((val % 180) + 180) % 180;
    if (norm === 0) return 0;
    if (norm === 45) return 1;
    if (norm === 135) return -1;
    if (norm === 90) throw new Error("غير معرّف (Math Error)");
  }
  const cosV = safeCos(val, mode);
  if (Math.abs(cosV) < 1e-12) throw new Error("غير معرّف (Math Error)");
  const rad = mode === "DEG" ? (val * Math.PI) / 180 : val;
  const res = Math.tan(rad);
  return Math.abs(res) < 1e-12 ? 0 : res;
}

function safeSqrt(val) {
  if (val < 0) throw new Error("جذر سالب (Math Error)");
  return Math.sqrt(val);
}

function evaluateScientificExpression(rawExpr, angleMode = "DEG") {
  if (!rawExpr || !rawExpr.trim()) return 0;

  let s = rawExpr.trim()
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/,/g, ".");

  // Insert implicit multiplication: e.g. 4sin(6), 3(4), 2(3+5), )4
  s = s.replace(/(\d)(\s*)([\(πe]|sin|cos|tan|sqrt|abs)/g, "$1*$3");
  s = s.replace(/(\))(\s*)([\d\(πe]|sin|cos|tan|sqrt|abs)/g, "$1*$3");

  // Percentage handling: e.g. 50% -> (50*0.01)
  s = s.replace(/(\d+(\.\d+)?)%/g, "($1*0.01)");

  // Auto-close missing unclosed parentheses e.g. sin(45 -> sin(45)
  let openCount = 0;
  for (let idx = 0; idx < s.length; idx++) {
    if (s[idx] === "(") openCount++;
    else if (s[idx] === ")") openCount--;
  }
  if (openCount > 0) {
    s = s + ")".repeat(openCount);
  }

  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/\d|\./.test(ch)) {
      let numStr = "";
      while (i < s.length && (/\d|\./.test(s[i]))) {
        numStr += s[i];
        i++;
      }
      tokens.push({ type: "NUM", val: parseFloat(numStr) });
      continue;
    }
    if (ch === "π") {
      tokens.push({ type: "NUM", val: Math.PI });
      i++;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let idStr = "";
      while (i < s.length && /[a-zA-Z]/.test(s[i])) {
        idStr += s[i];
        i++;
      }
      const lower = idStr.toLowerCase();
      if (lower === "e") {
        tokens.push({ type: "NUM", val: Math.E });
      } else if (lower === "pi") {
        tokens.push({ type: "NUM", val: Math.PI });
      } else if (["sin", "cos", "tan", "sqrt", "abs"].includes(lower)) {
        tokens.push({ type: "FN", val: lower });
      } else {
        throw new Error("رمز غير صالح: " + idStr);
      }
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      tokens.push({ type: "OP", val: ch });
      i++;
      continue;
    }
    throw new Error("رمز غير صالح: " + ch);
  }

  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume(expectedVal) {
    const tok = tokens[pos];
    if (expectedVal && (!tok || tok.val !== expectedVal)) {
      throw new Error("رمز غير متوقع: " + (tok ? tok.val : "نهاية التعبير"));
    }
    pos++;
    return tok;
  }

  function parseExpression() {
    return parseAddition();
  }

  function parseAddition() {
    let left = parseMultiplication();
    while (peek() && peek().type === "OP" && (peek().val === "+" || peek().val === "-")) {
      const op = consume().val;
      const right = parseMultiplication();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseMultiplication() {
    let left = parseExponent();
    while (peek() && peek().type === "OP" && (peek().val === "*" || peek().val === "/")) {
      const op = consume().val;
      const right = parseExponent();
      if (op === "/") {
        if (Math.abs(right) < 1e-15) throw new Error("قسمة على الصفر");
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function parseExponent() {
    let base = parseUnary();
    if (peek() && peek().type === "OP" && peek().val === "^") {
      consume("^");
      const exp = parseExponent();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary() {
    if (peek() && peek().type === "OP" && peek().val === "+") {
      consume("+");
      return parseUnary();
    }
    if (peek() && peek().type === "OP" && peek().val === "-") {
      consume("-");
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new Error("تعبير ناقص");

    if (tok.type === "NUM") {
      consume();
      return tok.val;
    }

    if (tok.type === "FN") {
      const fnName = consume().val;
      if (peek() && peek().val === "(") {
        consume("(");
      }
      const arg = parseExpression();
      if (peek() && peek().val === ")") {
        consume(")");
      }
      if (fnName === "sin") return safeSin(arg, angleMode);
      if (fnName === "cos") return safeCos(arg, angleMode);
      if (fnName === "tan") return safeTan(arg, angleMode);
      if (fnName === "sqrt") return safeSqrt(arg);
      if (fnName === "abs") return Math.abs(arg);
      throw new Error("دالة غير معرّفة: " + fnName);
    }

    if (tok.type === "OP" && tok.val === "(") {
      consume("(");
      const val = parseExpression();
      if (peek() && peek().val === ")") {
        consume(")");
      }
      return val;
    }

    throw new Error("رمز غير متوقع: " + tok.val);
  }

  const result = parseExpression();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    if (Number.isNaN(result)) throw new Error("قيمة غير معرّفة");
    throw new Error("خطأ رياضي");
  }

  return Math.round(result * 1e11) / 1e11;
}

function updateCalculatorDisplay() {
  const exprEl = document.getElementById("calc-expression");
  const resEl = document.getElementById("calc-result");
  const modeInd = document.getElementById("calc-mode-indicator");
  const angleBtn = document.getElementById("calc-angle-toggle-btn");
  const fracBadge = document.getElementById("calc-fraction-badge");

  if (modeInd) modeInd.textContent = calcState.angleMode;
  if (angleBtn) {
    angleBtn.textContent = calcState.angleMode;
    angleBtn.classList.toggle("is-rad", calcState.angleMode === "RAD");
  }

  if (exprEl) {
    exprEl.textContent = calcState.expression || "0";
    exprEl.scrollLeft = exprEl.scrollWidth;
  }

  if (resEl) {
    resEl.classList.remove("is-error", "is-fraction");
    if (calcState.isFractionDisplay) {
      resEl.classList.add("is-fraction");
      if (fracBadge) fracBadge.hidden = false;
    } else {
      if (fracBadge) fracBadge.hidden = true;
    }
    resEl.textContent = calcState.result;
  }
}

function calculateCalculatorResult(silent = false) {
  if (!calcState.expression || !calcState.expression.trim()) {
    calcState.result = "0";
    calcState.numericResult = 0;
    calcState.isFractionDisplay = false;
    updateCalculatorDisplay();
    return;
  }

  try {
    const val = evaluateScientificExpression(calcState.expression, calcState.angleMode);
    calcState.numericResult = val;
    calcState.result = String(val);
    calcState.isFractionDisplay = false;
    if (!silent) {
      calcState.evaluated = true;
    }
  } catch (err) {
    if (!silent) {
      calcState.result = err.message || "Math Error";
      const resEl = document.getElementById("calc-result");
      if (resEl) resEl.classList.add("is-error");
      calcState.evaluated = false;
    }
  }
  updateCalculatorDisplay();
}

function toggleFractionDisplay() {
  if (!Number.isFinite(calcState.numericResult)) return;

  if (!calcState.isFractionDisplay) {
    const frac = decimalToFraction(calcState.numericResult);
    if (frac && frac.den !== 1) {
      calcState.result = `${frac.num}/${frac.den}`;
      calcState.isFractionDisplay = true;
    } else {
      calcState.result = String(calcState.numericResult);
    }
  } else {
    calcState.result = String(calcState.numericResult);
    calcState.isFractionDisplay = false;
  }
  updateCalculatorDisplay();
}

function openStudentCalculatorModal() {
  const modal = document.getElementById("student-calculator-modal");
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("calc-modal-open");
  updateCalculatorDisplay();
}

function closeStudentCalculatorModal() {
  const modal = document.getElementById("student-calculator-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("calc-modal-open");
}

function toggleStudentCalculatorModal() {
  const modal = document.getElementById("student-calculator-modal");
  if (!modal) return;
  if (modal.hidden) {
    openStudentCalculatorModal();
  } else {
    closeStudentCalculatorModal();
  }
}

function initializeStudentCalculator() {
  const btn = document.getElementById("student-calculator-btn");
  const modal = document.getElementById("student-calculator-modal");
  const closeBtn = document.getElementById("close-calculator-modal-btn");
  const backdrop = document.getElementById("student-calc-backdrop");
  const angleBtn = document.getElementById("calc-angle-toggle-btn");
  const keypad = document.getElementById("student-calc-keypad");

  if (!btn || !modal) return;

  btn.addEventListener("click", toggleStudentCalculatorModal);
  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeStudentCalculatorModal();
  });
  backdrop?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeStudentCalculatorModal();
  });

  angleBtn?.addEventListener("click", () => {
    calcState.angleMode = calcState.angleMode === "DEG" ? "RAD" : "DEG";
    calculateCalculatorResult(true);
    updateCalculatorDisplay();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) {
      closeStudentCalculatorModal();
    }
  });

  if (keypad) {
    keypad.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (!button) return;

      const insert = button.dataset.insert;
      const op = button.dataset.op;
      const fn = button.dataset.fn;
      const action = button.dataset.action;

      if (insert !== undefined) {
        // If calculation was just evaluated (user pressed =):
        if (calcState.evaluated) {
          // If inserting a number, constant, or open parenthesis, start a new calculation
          if (/\d|\.|π|e|\(/.test(insert)) {
            calcState.expression = "";
          }
          calcState.evaluated = false;
        }

        // Avoid multiple dots in the same number token:
        if (insert === ".") {
          const parts = calcState.expression.split(/[\+\−\×\÷\(\)\^\*\/\-]/);
          const currentToken = parts[parts.length - 1] || "";
          if (currentToken.includes(".")) {
            return;
          }
          if (!currentToken || currentToken === "") {
            calcState.expression += "0";
          }
        }

        calcState.expression += insert;
        calculateCalculatorResult(true);
      } else if (op !== undefined) {
        const visualOp = op === "*" ? "×" : op === "/" ? "÷" : op === "-" ? "−" : "+";

        // If user just pressed = and now presses an operator, continue with Ans
        if (calcState.evaluated) {
          calcState.expression = (calcState.result && !calcState.result.includes("Error"))
            ? calcState.result
            : "0";
          calcState.evaluated = false;
        }

        if (!calcState.expression) {
          if (visualOp === "−") {
            calcState.expression = "−";
            updateCalculatorDisplay();
            return;
          } else {
            calcState.expression = "0" + visualOp;
            updateCalculatorDisplay();
            return;
          }
        }

        // Prevent double operators: if last char is an operator, replace it!
        const lastChar = calcState.expression.slice(-1);
        if (["+", "−", "×", "÷"].includes(lastChar)) {
          calcState.expression = calcState.expression.slice(0, -1) + visualOp;
        } else {
          calcState.expression += visualOp;
        }
        updateCalculatorDisplay();
      } else if (fn !== undefined) {
        if (fn === "frac") {
          if (calcState.evaluated) {
            calcState.expression = (calcState.result && !calcState.result.includes("Error")) ? calcState.result : "";
            calcState.evaluated = false;
          }
          calcState.expression += "÷";
          updateCalculatorDisplay();
        } else if (fn === "sd") {
          toggleFractionDisplay();
        } else if (fn === "sin" || fn === "cos" || fn === "tan" || fn === "sqrt" || fn === "abs") {
          if (calcState.evaluated) {
            calcState.expression = "";
            calcState.evaluated = false;
          }
          if (/\d|\)|π|e$/.test(calcState.expression)) {
            calcState.expression += "×";
          }
          calcState.expression += `${fn}(`;
          updateCalculatorDisplay();
        } else if (fn === "square") {
          if (calcState.evaluated) {
            calcState.expression = (calcState.result && !calcState.result.includes("Error")) ? calcState.result : "";
            calcState.evaluated = false;
          }
          if (calcState.expression) {
            calcState.expression += "^2";
            calculateCalculatorResult(true);
          }
        } else if (fn === "pow") {
          if (calcState.evaluated) {
            calcState.expression = (calcState.result && !calcState.result.includes("Error")) ? calcState.result : "";
            calcState.evaluated = false;
          }
          if (calcState.expression) {
            calcState.expression += "^";
            updateCalculatorDisplay();
          }
        } else if (fn === "inv") {
          if (calcState.evaluated && calcState.numericResult !== 0) {
            calcState.expression = `1/(${calcState.result})`;
            calcState.evaluated = false;
            calculateCalculatorResult(true);
          } else if (calcState.expression) {
            calcState.expression = `1/(${calcState.expression})`;
            calculateCalculatorResult(true);
          }
        }
      } else if (action !== undefined) {
        if (action === "clear") {
          calcState.expression = "";
          calcState.result = "0";
          calcState.numericResult = 0;
          calcState.isFractionDisplay = false;
          calcState.evaluated = false;
          const historyPrev = document.getElementById("calc-history-prev");
          if (historyPrev) historyPrev.textContent = "";
          updateCalculatorDisplay();
        } else if (action === "backspace") {
          if (calcState.evaluated) {
            calcState.expression = "";
            calcState.result = "0";
            calcState.numericResult = 0;
            calcState.evaluated = false;
            updateCalculatorDisplay();
            return;
          }
          const fnMatch = calcState.expression.match(/(sin|cos|tan|sqrt|abs)\($/);
          if (fnMatch) {
            calcState.expression = calcState.expression.slice(0, -fnMatch[0].length);
          } else if (calcState.expression.endsWith("^2")) {
            calcState.expression = calcState.expression.slice(0, -2);
          } else {
            calcState.expression = calcState.expression.slice(0, -1);
          }
          calculateCalculatorResult(true);
        } else if (action === "negate") {
          if (calcState.evaluated) {
            calcState.numericResult = -calcState.numericResult;
            calcState.result = String(calcState.numericResult);
            calcState.expression = calcState.result;
            updateCalculatorDisplay();
            return;
          }
          if (calcState.expression) {
            if (calcState.expression.startsWith("-")) {
              calcState.expression = calcState.expression.slice(1);
            } else {
              calcState.expression = "-" + calcState.expression;
            }
          }
          calculateCalculatorResult(true);
        } else if (action === "calculate") {
          if (!calcState.expression || !calcState.expression.trim()) return;
          const historyExpr = calcState.expression;
          calculateCalculatorResult(false);
          const historyPrev = document.getElementById("calc-history-prev");
          if (historyPrev && !calcState.result.includes("Error")) {
            historyPrev.textContent = historyExpr + " =";
          }
        }
      }
    });
  }
}

if (typeof window !== "undefined") {
  window.MinasatyCalculator = {
    evaluate: evaluateScientificExpression,
    toFraction: decimalToFraction,
    safeSin,
    safeCos,
    safeTan,
    open: openStudentCalculatorModal,
    close: closeStudentCalculatorModal,
    toggle: toggleStudentCalculatorModal,
    getState: () => ({ ...calcState }),
  };
}


const LEVEL_WELCOME_IMAGES = {
  "السنة الأولى": "/assets/level-welcome/year-1.webp",
  "السنة الثانية": "/assets/level-welcome/year-2.webp",
  "السنة الثالثة": "/assets/level-welcome/year-3.webp",
  "السنة الرابعة": "/assets/level-welcome/year-4.jpg",
};

function setLevelWelcomeImage() {
  const imageUrl = LEVEL_WELCOME_IMAGES[level];
  if (!elements.levelWelcomeImage || !imageUrl) return;
  elements.levelWelcomeImage.src = imageUrl;
  elements.levelWelcomeImage.alt = `صورة انتظار ${level} متوسط`;
}

function setPlaceholder(title, description) {
  elements.placeholderTitle.textContent = title;
  elements.placeholderDescription.textContent = description;
  elements.placeholder.hidden = false;
}

/**
 * Creates a local, accessible warning layer on the theater stage. It contains
 * no peer identifiers or attendee information, preserving viewer privacy.
 */
function showConnectionOverlay(message, tone = "error") {
  const videoFrame = elements.remoteVideo?.closest(".video-frame");
  if (!videoFrame) {
    return;
  }

  let overlay = document.getElementById("connection-loss-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "connection-loss-overlay";
    overlay.setAttribute("role", "alert");
    overlay.setAttribute("aria-live", "assertive");
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      zIndex: "4",
      display: "grid",
      placeItems: "center",
      padding: "1.5rem",
      color: "#ffffff",
      background: "rgba(15, 23, 42, 0.88)",
      fontWeight: "800",
      fontSize: "clamp(0.95rem, 2vw, 1.2rem)",
      textAlign: "center",
      lineHeight: "1.9",
      backdropFilter: "blur(4px)",
    });
    videoFrame.append(overlay);
  }

  overlay.textContent = message;
  overlay.style.background =
    tone === "warning" ? "rgba(146, 64, 14, 0.9)" : "rgba(127, 29, 29, 0.9)";
  overlay.hidden = false;
}

function hideConnectionOverlay() {
  const overlay = document.getElementById("connection-loss-overlay");
  if (overlay) {
    overlay.hidden = true;
  }
}

function renderTeacherAbsenceNotice(isAbsent) {
  teacherAbsentRealtime = isAbsent === true;
  const videoFrame = elements.remoteVideo?.closest(".video-frame");
  if (!videoFrame) return;

  let overlay = document.getElementById("teacher-absence-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "teacher-absence-overlay";
    overlay.setAttribute("role", "alert");
    overlay.setAttribute("aria-live", "assertive");
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      zIndex: "5",
      display: "grid",
      placeItems: "center",
      padding: "1.5rem",
      color: "#fff",
      background: "rgba(127, 29, 29, 0.94)",
      fontWeight: "800",
      fontSize: "clamp(1rem, 2.4vw, 1.35rem)",
      textAlign: "center",
      lineHeight: "1.9",
      backdropFilter: "blur(5px)",
    });
    videoFrame.append(overlay);
  }

  overlay.hidden = !teacherAbsentRealtime;
  if (teacherAbsentRealtime) {
    overlay.textContent = "الأستاذ غائب اليوم\nسيتم إعلامك فور تحديث برنامج الحصة.";
    setPlaceholder("الأستاذ غائب اليوم", "تم تحديث الحالة مباشرة من لوحة الأستاذ.");
  }
}

let teacherMicMutedNoticeDismissed = false;

function setTeacherMicMutedState(isMuted) {
  const banner = elements.teacherMicMuteBanner || document.getElementById("teacher-mic-mute-banner");
  if (!banner) return;

  if (isMuted) {
    if (!teacherMicMutedNoticeDismissed) {
      banner.hidden = false;
    }
  } else {
    banner.hidden = true;
    teacherMicMutedNoticeDismissed = false;
  }
}

const MAX_CHAT_MESSAGE_LENGTH = 800;

function normalizeChatMessage(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH) : "";
}

const CHAT_URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+/giu;

function parseChatUrl(value) {
  const trimmed = String(value || "").replace(/[.,!؟،؛:;)]*$/u, "");
  const withProtocol = /^www\./iu.test(trimmed) ? `https://${trimmed}` : trimmed;

  try {
    const parsed = new URL(withProtocol);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function isFacebookUrl(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase().replace(/^www\./u, "");
  return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch" || host === "fb.com";
}

function openChatLinkInSeparateView(event, url) {
  if (typeof url === "string" && (url.startsWith("blob:") || url.startsWith("data:"))) {
    event?.preventDefault?.();
    const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (!openedWindow) {
      const temporaryLink = document.createElement("a");
      temporaryLink.href = url;
      temporaryLink.target = "_blank";
      temporaryLink.rel = "noopener noreferrer";
      document.body.append(temporaryLink);
      temporaryLink.click();
      temporaryLink.remove();
    }
    return;
  }

  const parsedUrl = parseChatUrl(url);
  if (!parsedUrl) {
    return;
  }

  // Never replace the live-class page. Opening a separate browser view keeps
  // the WebRTC page and its current peer connection intact behind the link.
  event.preventDefault();
  const openedWindow = window.open(parsedUrl.href, "_blank", "noopener,noreferrer");

  if (!openedWindow) {
    // Some mobile browsers ignore window features but still honor a normal
    // anchor target. Reuse the existing user gesture without navigating away
    // from the classroom page.
    const temporaryLink = document.createElement("a");
    temporaryLink.href = parsedUrl.href;
    temporaryLink.target = "_blank";
    temporaryLink.rel = "noopener noreferrer";
    document.body.append(temporaryLink);
    temporaryLink.click();
    temporaryLink.remove();
  }
}

function appendChatBodyWithLinks(container, message) {
  const text = String(message || "");
  let cursor = 0;

  for (const match of text.matchAll(CHAT_URL_PATTERN)) {
    const rawUrl = match[0];
    const displayUrl = rawUrl.replace(/[.,!؟،؛:;)]*$/u, "");
    const matchIndex = match.index ?? 0;
    const parsedUrl = parseChatUrl(displayUrl);

    if (!parsedUrl) {
      continue;
    }

    if (matchIndex > cursor) {
      container.append(document.createTextNode(text.slice(cursor, matchIndex)));
    }

    const link = document.createElement("a");
    link.className = "chat-external-link";
    link.href = parsedUrl.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = displayUrl;
    link.title = isFacebookUrl(parsedUrl)
      ? "فتح منشور Facebook في تبويب مستقل مع إبقاء الحصة مفتوحة"
      : "فتح الرابط في تبويب مستقل";
    link.addEventListener("click", (event) => openChatLinkInSeparateView(event, parsedUrl.href));
    container.append(link);
    if (displayUrl.length < rawUrl.length) {
      container.append(document.createTextNode(rawUrl.slice(displayUrl.length)));
    }
    cursor = matchIndex + rawUrl.length;
  }

  if (cursor < text.length || !container.childNodes.length) {
    container.append(document.createTextNode(text.slice(cursor)));
  }
}

function isViewingLatestMessages(container, threshold = 36) {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

const STUDENT_REACTIONS_CONFIG = [
  { key: "love", emoji: "❤️", title: "قلب ❤️" },
  { key: "like", emoji: "👍", title: "إعجاب 👍" },
  { key: "cry", emoji: "😭", title: "بكاء 😭" },
  { key: "dislike", emoji: "👎", title: "لم يعجبني 👎" },
  { key: "fire", emoji: "🔥", title: "نار 🔥" },
];

const myActiveChatReactions = new Map();

// ===== Student Image Modal State & Controllers (Mobile Preview, Zoom & Download) =====
let currentModalImageData = null;
let modalZoomScale = 1;
let modalPanX = 0;
let modalPanY = 0;
let isPanningImage = false;
let startPanPointerX = 0;
let startPanPointerY = 0;
const activeImagePointers = new Map();
let initialImagePinchDist = 0;
let initialImagePinchScale = 1;
let lastImageTapTime = 0;

function applyStudentImageTransform() {
  const wrapper = document.getElementById("student-image-wrapper");
  const indicator = document.getElementById("zoom-level-indicator");
  if (wrapper) {
    wrapper.style.transform = `translate3d(${modalPanX}px, ${modalPanY}px, 0) scale(${modalZoomScale})`;
  }
  if (indicator) {
    indicator.textContent = `${Math.round(modalZoomScale * 100)}%`;
  }
}

function resetStudentImageZoom() {
  modalZoomScale = 1;
  modalPanX = 0;
  modalPanY = 0;
  isPanningImage = false;
  activeImagePointers.clear();
  initialImagePinchDist = 0;
  const wrapper = document.getElementById("student-image-wrapper");
  wrapper?.classList.remove("is-dragging");
  applyStudentImageTransform();
}

function zoomInStudentImage() {
  modalZoomScale = Math.min(modalZoomScale + 0.35, 5);
  applyStudentImageTransform();
}

function zoomOutStudentImage() {
  modalZoomScale = Math.max(modalZoomScale - 0.35, 1);
  if (modalZoomScale <= 1) {
    modalPanX = 0;
    modalPanY = 0;
  }
  applyStudentImageTransform();
}

function openStudentImageModal({ imageUrl, imageId = null, imageName = "", directUrl = null, kind = "teacher" } = {}) {
  const modal = document.getElementById("student-image-modal");
  const modalImg = document.getElementById("student-image-modal-img");
  const downloadBtn = document.getElementById("download-image-modal-btn");
  if (!modal || !modalImg || !imageUrl) return;

  const token = sessionStorage.getItem("parentToken") || localStorage.getItem("parentToken") || sessionStorage.getItem("token") || localStorage.getItem("token") || "";

  let downloadName = imageName || "صورة-الأستاذ.jpg";
  if (!/\.[a-z0-9]{3,4}$/i.test(downloadName)) {
    downloadName += ".jpg";
  }

  // Construct absolute direct download URL
  const hasValidTeacherImageId = typeof imageId === "string" && imageId.startsWith("tci_");
  let resolvedDirectUrl = "";

  if (hasValidTeacherImageId) {
    const cleanId = encodeURIComponent(imageId.trim());
    const query = new URLSearchParams({ download: "1" });
    if (token) query.set("token", token);
    resolvedDirectUrl = `${window.location.origin}/api/live-chat/teacher-image/${cleanId}?${query.toString()}`;
  } else if (directUrl && (directUrl.startsWith("http://") || directUrl.startsWith("https://"))) {
    resolvedDirectUrl = directUrl;
  } else if (directUrl && directUrl.startsWith("/") && !directUrl.includes("/teacher-image/?")) {
    resolvedDirectUrl = `${window.location.origin}${directUrl}`;
  } else if (imageUrl && !imageUrl.startsWith("blob:") && !imageUrl.startsWith("data:")) {
    try {
      const u = new URL(imageUrl, window.location.origin);
      u.searchParams.set("download", "1");
      if (token && !u.searchParams.has("token")) u.searchParams.set("token", token);
      resolvedDirectUrl = u.href;
    } catch (_) {
      resolvedDirectUrl = imageUrl;
    }
  } else {
    resolvedDirectUrl = imageUrl;
  }

  currentModalImageData = {
    imageUrl,
    imageId,
    imageName: downloadName,
    directUrl: resolvedDirectUrl,
    kind,
  };

  modalImg.src = imageUrl;
  resetStudentImageZoom();

  // Pre-configure the anchor so it is immediately clickable without async lag
  if (downloadBtn) {
    downloadBtn.href = resolvedDirectUrl || "#";
    downloadBtn.download = downloadName;
    downloadBtn.setAttribute("download", downloadName);
    downloadBtn.setAttribute("target", "_blank");
    downloadBtn.setAttribute("rel", "noopener noreferrer");
    const textEl = downloadBtn.querySelector(".student-image-download-text");
    if (textEl) textEl.textContent = "تحميل الصورة";
  }

  modal.hidden = false;
  modal.style.setProperty("display", "flex", "important");
  document.body.classList.add("student-image-modal-open");
}

function closeStudentImageModal(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }
  const modal = document.getElementById("student-image-modal");
  if (!modal) return;
  modal.hidden = true;
  modal.style.setProperty("display", "none", "important");
  document.body.classList.remove("student-image-modal-open");
  resetStudentImageZoom();
  currentModalImageData = null;
}

function downloadStudentModalImage(event) {
  if (!currentModalImageData) return;

  const downloadBtn = document.getElementById("download-image-modal-btn");
  const textEl = downloadBtn?.querySelector(".student-image-download-text");
  const origText = textEl?.textContent || "تحميل الصورة";

  const directUrl = currentModalImageData.directUrl || downloadBtn?.href || "";
  const nativeBridge = window.MinasatyNative || window.Android || window.MinasatyApp;

  // Immediate UI feedback for student
  if (textEl) textEl.textContent = "جاري التحميل...";
  window.setTimeout(() => {
    if (textEl) textEl.textContent = "تم التحميل ✓";
    window.setTimeout(() => {
      if (textEl) textEl.textContent = origText;
    }, 2500);
  }, 700);

  // 1. If running inside the Android Native App (Minasaty App / WebView)
  if (nativeBridge && typeof nativeBridge.openExternalUrl === "function" && directUrl && directUrl.startsWith("http")) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
    try {
      nativeBridge.openExternalUrl(directUrl);
      return;
    } catch (bridgeErr) {
      console.warn("Native bridge openExternalUrl failed:", bridgeErr);
    }
  }

  // 2. In Mobile Chrome, Safari, Samsung Internet, or standard browser:
  // If the link has an HTTP/HTTPS URL, DO NOT preventDefault!
  // Allowing the native link click with valid transient user gesture makes the browser
  // handle the Content-Disposition: attachment header directly and save the image immediately!
  if (directUrl && directUrl.startsWith("http")) {
    if (event) {
      event.stopPropagation();
    }
    return;
  }

  // 3. Fallback for local blob: or data: URLs (if directUrl is not http)
  if (event) {
    event.stopPropagation();
  }
}

function initStudentImageModalGestures() {
  const stage = document.getElementById("student-image-stage");
  const wrapper = document.getElementById("student-image-wrapper");
  if (!stage || !wrapper) return;

  stage.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { stage.setPointerCapture?.(e.pointerId); } catch (_) {}
    activeImagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeImagePointers.size === 1) {
      const now = Date.now();
      if (now - lastImageTapTime < 320) {
        lastImageTapTime = 0;
        if (modalZoomScale > 1.2) {
          resetStudentImageZoom();
        } else {
          modalZoomScale = 2.5;
          applyStudentImageTransform();
        }
        return;
      }
      lastImageTapTime = now;

      if (modalZoomScale > 1) {
        isPanningImage = true;
        startPanPointerX = e.clientX - modalPanX;
        startPanPointerY = e.clientY - modalPanY;
        wrapper.classList.add("is-dragging");
      }
    } else if (activeImagePointers.size === 2) {
      isPanningImage = false;
      const pts = Array.from(activeImagePointers.values());
      initialImagePinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialImagePinchScale = modalZoomScale;
    }
  }, { passive: false });

  stage.addEventListener("pointermove", (e) => {
    if (!activeImagePointers.has(e.pointerId)) return;
    activeImagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeImagePointers.size === 2 && initialImagePinchDist > 0) {
      e.preventDefault();
      const pts = Array.from(activeImagePointers.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = currentDist / initialImagePinchDist;
      modalZoomScale = Math.min(Math.max(initialImagePinchScale * ratio, 1), 5);
      if (modalZoomScale <= 1) {
        modalPanX = 0;
        modalPanY = 0;
      }
      applyStudentImageTransform();
    } else if (activeImagePointers.size === 1 && isPanningImage && modalZoomScale > 1) {
      e.preventDefault();
      modalPanX = e.clientX - startPanPointerX;
      modalPanY = e.clientY - startPanPointerY;
      applyStudentImageTransform();
    }
  }, { passive: false });

  const handlePointerEnd = (e) => {
    activeImagePointers.delete(e.pointerId);
    if (activeImagePointers.size < 2) {
      initialImagePinchDist = 0;
    }
    if (activeImagePointers.size === 0) {
      isPanningImage = false;
      wrapper.classList.remove("is-dragging");
      if (modalZoomScale <= 1) {
        resetStudentImageZoom();
      }
    }
  };

  stage.addEventListener("pointerup", handlePointerEnd);
  stage.addEventListener("pointercancel", handlePointerEnd);

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomInStudentImage();
    } else {
      zoomOutStudentImage();
    }
  }, { passive: false });
}

function initializeStudentImageModal() {
  const modal = document.getElementById("student-image-modal");
  const closeBtn = document.getElementById("close-image-modal-btn");
  const downloadBtn = document.getElementById("download-image-modal-btn");
  const zoomInBtn = document.getElementById("zoom-in-image-btn");
  const zoomOutBtn = document.getElementById("zoom-out-image-btn");
  const zoomResetBtn = document.getElementById("zoom-reset-image-btn");
  const backdrop = document.getElementById("student-image-backdrop");

  if (!modal) return;

  closeBtn?.addEventListener("click", (e) => {
    closeStudentImageModal(e);
  });

  downloadBtn?.addEventListener("click", (e) => {
    downloadStudentModalImage(e);
  });

  zoomInBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoomInStudentImage();
  });

  zoomOutBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoomOutStudentImage();
  });

  zoomResetBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetStudentImageZoom();
  });

  backdrop?.addEventListener("click", (e) => {
    closeStudentImageModal(e);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) {
      closeStudentImageModal(e);
    }
  });

  initStudentImageModalGestures();
}

async function triggerOriginalImageDownload({ event, imageId, imageUrl, preferredName, directUrl }) {
  const token = sessionStorage.getItem("parentToken") || localStorage.getItem("parentToken") || "";
  let finalBlob = null;

  // 1. If we already have a blob URL in memory, extract its blob
  if (imageUrl && imageUrl.startsWith("blob:")) {
    try {
      const resp = await fetch(imageUrl);
      if (resp.ok) finalBlob = await resp.blob();
    } catch (_) {}
  }

  // 2. Otherwise fetch the original image bytes from server with Bearer auth
  if (!finalBlob && imageId) {
    try {
      const resp = await fetch(`/api/live-chat/teacher-image/${encodeURIComponent(imageId)}`, {
        headers: token ? { Authorization: `Bearer ${token}`, Accept: "image/*" } : { Accept: "image/*" },
      });
      if (resp.ok) finalBlob = await resp.blob();
    } catch (_) {}
  }

  // 3. Fallback: fetch from data URL or imageUrl
  if (!finalBlob && imageUrl && imageUrl.startsWith("data:")) {
    try {
      const resp = await fetch(imageUrl);
      if (resp.ok) finalBlob = await resp.blob();
    } catch (_) {}
  }
  if (!finalBlob && imageUrl && !imageUrl.startsWith("blob:") && !imageUrl.startsWith("data:")) {
    try {
      const resp = await fetch(imageUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (resp.ok) finalBlob = await resp.blob();
    } catch (_) {}
  }

  let finalName = preferredName || "teacher-original-image.jpg";
  if (finalBlob) {
    if (!/\.[a-z0-9]{3,4}$/i.test(finalName)) {
      const ext = finalBlob.type === "image/png" ? ".png" : finalBlob.type === "image/webp" ? ".webp" : ".jpg";
      finalName = (preferredName ? preferredName.replace(/\.[^.]+$/, "") : "teacher-original-image") + ext;
    }

    if (event) event.preventDefault();
    const blobUrl = URL.createObjectURL(finalBlob);
    const tempLink = document.createElement("a");
    tempLink.href = blobUrl;
    tempLink.download = finalName;
    tempLink.rel = "noopener";
    tempLink.style.display = "none";
    document.body.append(tempLink);
    tempLink.click();
    window.setTimeout(() => {
      tempLink.remove();
      URL.revokeObjectURL(blobUrl);
    }, 30_000);
    return;
  }

  // 4. Fallback: navigate via direct URL with ?download=1
  const fallbackUrl = (directUrl && directUrl !== "#") ? directUrl : imageUrl;
  if (fallbackUrl) {
    if (event) event.preventDefault();
    const tempLink = document.createElement("a");
    tempLink.href = fallbackUrl;
    tempLink.download = finalName;
    tempLink.target = "_blank";
    tempLink.rel = "noopener noreferrer";
    document.body.append(tempLink);
    tempLink.click();
    window.setTimeout(() => tempLink.remove(), 1_000);
    return;
  }
}

function appendStudentChatMessage({ id, sender, message = "", kind, imageUrl = null, imageId = null, imageName = "", reactions = null }) {
  const safeMessage = normalizeChatMessage(message);
  if ((!safeMessage && !imageUrl) || !elements.chatBox) {
    return;
  }

  const shouldFollowNewestMessage = isViewingLatestMessages(elements.chatBox);
  const msgId = id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  elements.chatEmpty?.remove();

  const bubble = document.createElement("article");
  bubble.className = `student-chat-message ${kind === "teacher" ? "teacher-reply" : "own-message"}`;
  bubble.dataset.messageId = msgId;

  const header = document.createElement("div");
  header.className = "student-chat-header";

  const senderLabel = document.createElement("strong");
  senderLabel.className = "student-chat-sender";
  senderLabel.textContent = sender;
  header.append(senderLabel);

  // ONLY show reaction choices on teacher's messages for the student!
  // Student's own message remains completely clean at the top.
  if (kind === "teacher") {
    const reactBar = document.createElement("div");
    reactBar.className = "student-chat-react-bar";
    reactBar.dataset.reactBarFor = msgId;

    STUDENT_REACTIONS_CONFIG.forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "student-chat-react-btn";
      btn.dataset.reactionKey = r.key;
      btn.title = r.title;
      btn.textContent = r.emoji;
      if (myActiveChatReactions.get(msgId)?.has(r.key)) {
        btn.classList.add("is-active");
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleStudentReaction(msgId, r.key);
      });
      reactBar.append(btn);
    });

    header.append(reactBar);
  }

  bubble.append(header);

  if (safeMessage) {
    const body = document.createElement("span");
    body.className = "student-chat-body";
    appendChatBodyWithLinks(body, safeMessage);
    bubble.append(body);
  }

  if (imageUrl) {
    const imageCard = document.createElement("div");
    imageCard.className = "student-chat-image-card";
    const image = document.createElement("img");
    image.className = "student-chat-image";
    image.src = imageUrl;
    image.alt = "صورة سؤال أو واجب مرفقة";
    image.loading = "lazy";

    let downloadName = imageName || "صورة-الأستاذ-الأصلية.jpg";
    if (!/\.[a-z0-9]{3,4}$/i.test(downloadName)) {
      downloadName += ".jpg";
    }

    const token = sessionStorage.getItem("parentToken") || localStorage.getItem("parentToken") || "";
    const directDownloadUrl = token
      ? `/api/live-chat/teacher-image/${encodeURIComponent(imageId || "")}?token=${encodeURIComponent(token)}&download=1`
      : `/api/live-chat/teacher-image/${encodeURIComponent(imageId || "")}?download=1`;

    image.addEventListener("click", (event) => {
      // Keep desktop Chrome PC experience completely untouched!
      if (isDesktopStudentView()) {
        openChatLinkInSeparateView(event, imageUrl);
      } else {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        openStudentImageModal({
          imageUrl,
          imageId,
          imageName: downloadName,
          directUrl: directDownloadUrl,
          kind,
        });
      }
    });

    imageCard.append(image);

    // Desktop mode maintains the download link in the message card.
    // On mobile phone, this download button is hidden/removed from the message card and placed inside the image modal.
    if (kind === "teacher" && imageId?.startsWith("tci_")) {
      const download = document.createElement("a");
      download.className = "student-chat-image-download";
      download.href = directDownloadUrl;
      download.download = downloadName;
      download.textContent = "تنزيل الصورة الأصلية";
      download.setAttribute("aria-label", "تنزيل الصورة المرسلة من الأستاذ بجودتها الأصلية");
      download.setAttribute("role", "button");

      download.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await triggerOriginalImageDownload({
            event,
            imageId,
            imageUrl,
            preferredName: downloadName,
            directUrl: directDownloadUrl,
          });
        } catch (downloadErr) {
          console.warn("Direct image download handler failed:", downloadErr);
        }
      });
      imageCard.append(download);
    }
    bubble.append(imageCard);
  }

  // Reactions container (pills will appear here only when reactions exist)
  const pillsWrap = document.createElement("div");
  pillsWrap.className = "student-chat-reactions-pills";
  pillsWrap.dataset.pillsFor = msgId;
  renderStudentReactionPills(pillsWrap, reactions, msgId);
  bubble.append(pillsWrap);

  elements.chatBox.append(bubble);

  if (shouldFollowNewestMessage) {
    requestAnimationFrame(() => {
      elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
    });
  }
}

function renderStudentReactionPills(container, reactions, messageId) {
  if (!container) return;
  container.innerHTML = "";
  if (!reactions) return;

  STUDENT_REACTIONS_CONFIG.forEach((r) => {
    const isTeacherReacted = Boolean(
      (typeof reactions.teacherReacted === "object" && reactions.teacherReacted && reactions.teacherReacted[r.key]) ||
      reactions.teacherReacted === r.key ||
      (Array.isArray(reactions.teacherReacted) && reactions.teacherReacted.includes(r.key)) ||
      (reactions.isTeacherReactor && (reactions.lastReaction === r.key || reactions.userReaction === r.key))
    );

    let count = Number(reactions[r.key] || reactions[`${r.key}Count`] || (reactions.counts && reactions.counts[r.key]) || 0);
    if (isTeacherReacted && count === 0) count = 1;

    if (count > 0) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `student-reaction-pill ${isTeacherReacted ? "is-teacher-reaction" : ""}`;
      const isMyReaction = myActiveChatReactions.get(messageId)?.has(r.key);
      if (isMyReaction) {
        pill.classList.add("is-my-reaction");
      }
      pill.title = isTeacherReacted ? `الأستاذ تفاعل بـ ${r.title}` : r.title;
      pill.innerHTML = `<span>${r.emoji}</span> <span>${count}</span>${isTeacherReacted ? ' <small class="student-teacher-tag">الأستاذ</small>' : ""}`;
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleStudentReaction(messageId, r.key);
      });
      container.append(pill);
    }
  });
}

function toggleStudentReaction(messageId, reaction) {
  if (!socket || !joinedClass) return;

  if (!myActiveChatReactions.has(messageId)) {
    myActiveChatReactions.set(messageId, new Set());
  }
  const mySet = myActiveChatReactions.get(messageId);
  const willActivate = !mySet.has(reaction);

  if (willActivate) {
    mySet.add(reaction);
    const bubble = document.querySelector(`.student-chat-message[data-message-id="${messageId}"]`);
    const emojiObj = STUDENT_REACTIONS_CONFIG.find((c) => c.key === reaction);
    if (bubble && emojiObj) {
      showStudentFloatingReaction(bubble, emojiObj.emoji);
    }
  } else {
    mySet.delete(reaction);
  }

  // Update button visual state in reaction bar
  const reactBar = document.querySelector(`.student-chat-react-bar[data-react-bar-for="${messageId}"]`);
  if (reactBar) {
    const btn = reactBar.querySelector(`.student-chat-react-btn[data-reaction-key="${reaction}"]`);
    if (btn) {
      btn.classList.toggle("is-active", willActivate);
    }
  }

  socket.emit("classroom_chat_react", {
    messageId,
    reaction,
    level,
  }, (res) => {
    if (res && res.ok) {
      updateStudentMessageReactions(res);
    }
  });
}

function sendStudentChatReaction(messageId, reaction) {
  toggleStudentReaction(messageId, reaction);
}

function showStudentFloatingReaction(targetEl, emoji) {
  if (!targetEl) return;
  const floating = document.createElement("div");
  floating.className = "student-floating-reaction";
  floating.textContent = emoji;
  const rect = targetEl.getBoundingClientRect();
  floating.style.left = `${rect.left + rect.width / 2}px`;
  floating.style.top = `${rect.top + 10}px`;
  document.body.append(floating);
  setTimeout(() => floating.remove(), 850);
}

function updateStudentMessageReactions(data) {
  if (!data || !data.messageId) return;
  const pillsWrap = document.querySelector(`.student-chat-reactions-pills[data-pills-for="${data.messageId}"]`);
  if (pillsWrap) {
    renderStudentReactionPills(pillsWrap, data.counts || {
      love: data.loveCount,
      like: data.likeCount,
      cry: data.cryCount,
      dislike: data.dislikeCount,
      fire: data.fireCount,
      teacherReacted: data.teacherReacted,
    }, data.messageId);
  }

  // Update button active state if socket acknowledgement or sync
  if (data.userReaction && data.toggledOn !== undefined) {
    const reactBar = document.querySelector(`.student-chat-react-bar[data-react-bar-for="${data.messageId}"]`);
    if (reactBar) {
      const btn = reactBar.querySelector(`.student-chat-react-btn[data-reaction-key="${data.userReaction}"]`);
      if (btn) {
        btn.classList.toggle("is-active", Boolean(data.toggledOn));
      }
    }
  }
}

function clearStudentChat() {
  if (!elements.chatBox) {
    return;
  }

  renderedQuestionImageUrls.forEach((url) => URL.revokeObjectURL(url));
  renderedQuestionImageUrls.clear();
  elements.chatBox.replaceChildren();
  const empty = document.createElement("p");
  empty.id = "chat-empty";
  empty.className = "student-chat-empty";
  empty.textContent = "اكتب سؤالك وسيظهر رد الأستاذ هنا.";
  elements.chatBox.append(empty);
  elements.chatEmpty = empty;
}

async function loadStudentQuestionImage(imageId) {
  const token = sessionStorage.getItem("parentToken");
  if (!token || !imageId) return null;

  const response = await fetch(`/api/live-chat/question-image/${encodeURIComponent(imageId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "image/*" },
  });
  if (!response.ok) return null;

  const imageUrl = URL.createObjectURL(await response.blob());
  renderedQuestionImageUrls.add(imageUrl);
  return imageUrl;
}

async function loadTeacherAnswerImage(imageId) {
  const token = sessionStorage.getItem("parentToken") || localStorage.getItem("parentToken");
  if (!token || !imageId) return null;
  const response = await fetch(`/api/live-chat/teacher-image/${encodeURIComponent(imageId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "image/*" },
  });
  if (!response.ok) return null;
  const imageUrl = URL.createObjectURL(await response.blob());
  renderedQuestionImageUrls.add(imageUrl);
  return imageUrl;
}

async function restoreStudentChatHistory(messages = []) {
  clearStudentChat();
  for (const entry of Array.isArray(messages) ? messages : []) {
    if (!entry?.message && !entry?.imageId && !entry?.imageData) continue;

    let imageUrl = entry.imageData || null;
    if (!imageUrl && entry.imageId) {
      imageUrl = entry.kind === "teacher"
        ? await loadTeacherAnswerImage(entry.imageId).catch(() => null)
        : await loadStudentQuestionImage(entry.imageId).catch(() => null);
    }

    appendStudentChatMessage({
      id: entry.id,
      sender: entry.kind === "teacher" ? "الأستاذ" : "أنا",
      message: entry.message || "",
      kind: entry.kind === "teacher" ? "teacher" : "student",
      imageUrl,
      imageId: entry.imageId || null,
      imageName: entry.imageName || "",
      reactions: entry.reactions || null,
    });
  }
}

function updateChatControls() {
  const canSend = joinedClass && !isJoining && !isRecoveringStream && socket.connected;
  elements.chatInput.disabled = !canSend;
  if (elements.desktopChatInput) elements.desktopChatInput.disabled = !canSend;
  elements.questionImageInput.disabled = !canSend;
  elements.captureQuestionButton.disabled = !canSend;
  const desktopMessage = normalizeChatMessage(elements.desktopChatInput?.value || "");
  const activeMessage = isDesktopStudentView() ? desktopMessage : normalizeChatMessage(elements.chatInput.value);
  if (elements.openChatComposeButton) {
    elements.openChatComposeButton.disabled = !canSend || (isDesktopStudentView() && !activeMessage);
  }
  elements.chatSendButton.disabled = !canSend || !normalizeChatMessage(elements.chatInput.value);
}

function relocateStudentChatComposer() {
  const modal = elements.chatComposeModal || document.getElementById("chat-compose-modal");
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
}

function relocateStudentPrejoinOverlay() {
  const overlay = elements.prejoinOverlay || document.getElementById("student-prejoin-overlay");
  if (overlay && overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }
}

function syncStudentKeyboardOffset() {
  const viewport = window.visualViewport;
  if (!viewport) {
    document.documentElement.style.setProperty("--student-keyboard-offset", "0px");
    return;
  }
  const keyboardOffset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
  document.documentElement.style.setProperty("--student-keyboard-offset", `${keyboardOffset}px`);
}

function resetStudentKeyboardOffset() {
  document.documentElement.style.setProperty("--student-keyboard-offset", "0px");
}

function handleChatMessageButtonClick() {
  if (isDesktopStudentView()) {
    elements.desktopChatDirectForm?.requestSubmit();
    return;
  }
  // On mobile the composer is already visible; the green button sends the text.
  if (elements.chatComposeModal?.hidden) {
    openStudentChatComposer();
    return;
  }
  elements.chatForm?.requestSubmit();
}

function openStudentChatComposer({ focus = true } = {}) {
  const modal = elements.chatComposeModal || document.getElementById("chat-compose-modal");
  if (!modal) return;

  relocateStudentChatComposer();
  modal.hidden = false;
  modal.style.setProperty("display", "grid", "important");
  document.body.classList.add("student-chat-compose-open");
  updateChatControls();
  syncStudentKeyboardOffset();
  if (focus) {
    window.requestAnimationFrame(() => {
      elements.chatInput?.focus({ preventScroll: true });
      syncStudentKeyboardOffset();
    });
  }
}

function closeStudentChatComposer() {
  const modal = elements.chatComposeModal || document.getElementById("chat-compose-modal");
  if (!modal) return;
  // The mobile composer is a permanent inline bar, not a dismissible modal.
  if (!isDesktopStudentView()) {
    modal.hidden = false;
    modal.style.setProperty("display", "grid", "important");
    document.body.classList.add("student-chat-compose-open");
    resetStudentKeyboardOffset();
    elements.chatInput?.blur();
    return;
  }
  modal.hidden = true;
  modal.style.setProperty("display", "none", "important");
  document.body.classList.remove("student-chat-compose-open");
  resetStudentKeyboardOffset();
  elements.chatInput?.blur();
}

function clearSelectedQuestionImage() {
  if (selectedQuestionImagePreviewUrl) {
    URL.revokeObjectURL(selectedQuestionImagePreviewUrl);
  }
  selectedQuestionImagePreviewUrl = null;
  selectedQuestionImageFile = null;
  if (elements.questionImageInput) elements.questionImageInput.value = "";
  if (elements.questionImagePreviewImage) elements.questionImagePreviewImage.src = "";
  if (elements.questionImagePreview) elements.questionImagePreview.hidden = true;
  updateChatControls();
}

function selectQuestionImage(file) {
  if (!file) return;

  if (!ACCEPTED_QUESTION_IMAGE_TYPES.has(file.type)) {
    setViewerStatus("صورة السؤال يجب أن تكون بصيغة JPG أو PNG أو WEBP.", "error");
    clearSelectedQuestionImage();
    return;
  }
  if (file.size > MAX_QUESTION_IMAGE_SIZE_BYTES) {
    setViewerStatus("حجم صورة السؤال يجب ألا يتجاوز 5 ميغابايت.", "error");
    clearSelectedQuestionImage();
    return;
  }

  if (selectedQuestionImagePreviewUrl) URL.revokeObjectURL(selectedQuestionImagePreviewUrl);
  selectedQuestionImageFile = file;
  selectedQuestionImagePreviewUrl = URL.createObjectURL(file);
  elements.questionImagePreviewImage.src = selectedQuestionImagePreviewUrl;
  elements.questionImagePreview.hidden = false;
  updateChatControls();
}

async function uploadQuestionImage(file) {
  const token = sessionStorage.getItem("parentToken");
  if (!token) throw new Error("انتهت جلسة الدخول. أعد الدخول للمتابعة.");

  const formData = new FormData();
  formData.append("image", file, file.name || "question.jpg");
  formData.append("studentId", studentId);
  formData.append("level", level);

  const response = await fetch("/api/live-chat/question-image", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data?.imageId) {
    throw new Error(payload.error || "تعذر رفع صورة السؤال.");
  }
  return payload;
}

async function sendStudentQuestionPhotoToTelegram(file) {
  if (!file) return;

  if (!ACCEPTED_QUESTION_IMAGE_TYPES.has(file.type)) {
    setViewerStatus("صورة السؤال يجب أن تكون بصيغة JPG أو PNG أو WEBP.", "error");
    if (elements.questionImageInput) elements.questionImageInput.value = "";
    return;
  }
  if (file.size > MAX_QUESTION_IMAGE_SIZE_BYTES) {
    setViewerStatus("حجم صورة السؤال يجب ألا يتجاوز 5 ميغابايت.", "error");
    if (elements.questionImageInput) elements.questionImageInput.value = "";
    return;
  }

  setViewerStatus("جارٍ إرسال الصورة إلى أستاذك عبر التيليجرام...", "info");
  if (elements.captureQuestionButton) {
    elements.captureQuestionButton.disabled = true;
  }

  try {
    await uploadQuestionImage(file);
    setViewerStatus("تم إرسال الصورة إلى أستاذك عبر التيليجرام بنجاح ✓", "success");

    const photoNotice = "📸 تم إرسال صورتك مباشرة إلى أستاذك عبر التيليجرام بنجاح ✓ (لن تُعرض داخل البث المباشر للحفاظ على ثبات وسرعة البث).";
    let sentMessageId = null;
    if (socket && socket.connected && joinedClass) {
      try {
        const res = await emitWithAcknowledgement("student_send_message", {
          level,
          studentName,
          message: photoNotice,
          isPhotoNotice: true,
        });
        sentMessageId = res?.messageId || null;
      } catch (err) {
        console.warn("Could not dispatch photo notice to teacher socket:", err);
      }
    }

    appendStudentChatMessage({
      id: sentMessageId || `photo-${Date.now()}`,
      sender: "تنبيه الحصة",
      message: photoNotice,
      kind: "student",
    });
  } catch (error) {
    console.error("Failed to send question photo to Telegram:", error);
    setViewerStatus(error.message || "تعذر إرسال الصورة للأستاذ عبر التيليجرام.", "error");
  } finally {
    if (elements.questionImageInput) elements.questionImageInput.value = "";
    clearSelectedQuestionImage();
    updateChatControls();
  }
}

function isDesktopStudentView() {
  return window.matchMedia?.("(min-width: 901px)").matches || false;
}


async function sendStudentChatMessage(event) {
  event.preventDefault();

  const desktopDirect = isDesktopStudentView() && elements.desktopChatInput;
  const messageInput = desktopDirect ? elements.desktopChatInput : elements.chatInput;
  const message = normalizeChatMessage(messageInput.value);
  if (!joinedClass || isJoining || !message) {
    return;
  }

  elements.chatSendButton.disabled = true;
  elements.captureQuestionButton.disabled = true;
  if (window.PlaneButtonAnim) {
    window.PlaneButtonAnim.trigger(elements.chatSendButton, { fastMode: true, successText: "تم الإرسال" });
    if (elements.openChatComposeButton) {
      window.PlaneButtonAnim.trigger(elements.openChatComposeButton, { fastMode: true, successText: "تم" });
    }
  }

  try {
    const res = await emitWithAcknowledgement("student_send_message", {
      level,
      studentName,
      message,
    });

    appendStudentChatMessage({
      id: res?.messageId,
      sender: "أنا",
      message,
      kind: "student",
    });
    elements.chatInput.value = "";
    if (elements.desktopChatInput) elements.desktopChatInput.value = "";
    clearSelectedQuestionImage();
  } catch (error) {
    console.error("Unable to send student chat message:", error);
    setViewerStatus(error.message || "تعذر إرسال السؤال.", "error");
  } finally {
    updateChatControls();
  }
}

function setButtonLabel(button, label) {
  // Target the specific label span if it exists, otherwise fallback to the first non-icon span.
  const labelElement = button.querySelector(".button-label") ||
    button.querySelector("span:not([aria-hidden])") ||
    button.querySelector("span");
  if (labelElement) {
    labelElement.textContent = label;
  }
}

function setRaisedHandState({ waiting = false } = {}) {
  const canInteract = joinedClass;
  const button = elements.raiseHandButton;
  if (!button) return;

  if (microphonePermissionGranted) {
    button.hidden = false;
    button.disabled = false;
    button.classList.remove("hand-raised");
    button.classList.add("microphone-active");
    button.setAttribute("aria-pressed", "true");
    button.setAttribute(
      "aria-label",
      "إغلاق الميكروفون — يستمر سماع الأستاذ"
    );
    button.title = "إغلاق الميكروفون — يستمر سماع الأستاذ";
    const icon = button.querySelector("span[aria-hidden]") || button.querySelector("span:first-child");
    if (icon) icon.textContent = "🎙️";
    setButtonLabel(button, "إغلاق الميكروفون");

    elements.handWaitingActions.hidden = true;
    elements.handWaitingActions.classList.remove("hand-raised");
    const waitingLabel = elements.handWaitingActions.querySelector(".hand-waiting-label");
    if (waitingLabel) waitingLabel.textContent = "";
    return;
  }

  button.classList.remove("microphone-active");
  button.hidden = !canInteract;
  button.disabled = !canInteract;
  button.classList.toggle("hand-raised", waiting);
  button.setAttribute("aria-pressed", String(waiting));
  button.setAttribute(
    "aria-label",
    waiting ? "تنزيل اليد وإلغاء طلب التحدث" : "رفع اليد وطلب التحدث"
  );
  button.title = waiting ? "تنزيل اليد وإلغاء طلب التحدث" : "رفع اليد وطلب التحدث";
  const icon = button.querySelector("span[aria-hidden]") || button.querySelector("span:first-child");
  if (icon) icon.textContent = "✋";
  setButtonLabel(button, waiting ? "تنزيل اليد" : (studentMicrophoneSelfClosed ? "ميكروفون مغلق" : "رفع اليد"));

  // The same primary button is the complete toggle. Keep the legacy waiting
  // wrapper hidden so no second or third hand-control button can appear.
  elements.handWaitingActions.hidden = true;
  elements.handWaitingActions.classList.remove("hand-raised");
  const waitingLabel = elements.handWaitingActions.querySelector(".hand-waiting-label");
  if (waitingLabel) waitingLabel.textContent = "";
}

async function closeOwnMicrophone() {
  if (!joinedClass || !microphonePermissionGranted) return;
  // Silence capture immediately, including in-flight SFU publication and P2P sends.
  stopLocalAudio();
  studentMicrophoneSelfClosed = true;
  clearHandResetTimer();
  setRaisedHandState({ waiting: false });
  showMobileControlToast("الميكروفون مغلق. لطلب الكلام مجددًا ارفع يدك.");
  void ensureTeacherAudioPlayback({ sourceHint: "student_self_mute" });
  try {
    await emitWithAcknowledgement("student_close_mic", {}, 8000);
    if (!microphonePermissionGranted) setViewerStatus("أغلقت ميكروفونك. ما زلت تسمع الأستاذ.", "live");
  } catch (error) {
    if (!microphonePermissionGranted) setViewerStatus("ميكروفونك مغلق محليًا؛ تعذر تأكيد الحالة للأستاذ.", "warning");
  }
}

function toggleRaisedHand() {
  if (microphonePermissionGranted) {
    void closeOwnMicrophone();
    return;
  }
  if (elements.raiseHandButton.classList.contains("hand-raised")) {
    lowerHand();
    return;
  }
  raiseHand();
}

let micAlertAudioContext = null;

function getMicAlertAudioContext() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!micAlertAudioContext || micAlertAudioContext.state === "closed") {
      micAlertAudioContext = new AudioContextClass();
    }
    if (micAlertAudioContext.state === "suspended") {
      micAlertAudioContext.resume().catch(() => { });
    }
    return micAlertAudioContext;
  } catch (err) {
    return null;
  }
}

function unlockMicAlertAudio() {
  const ctx = getMicAlertAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => { });
  }
}

if (typeof window !== "undefined") {
  ["click", "touchstart", "touchend", "pointerdown", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, unlockMicAlertAudio, { passive: true });
  });
}

/**
 * Plays a strong 0.5-second audio alert ring for the student when the teacher
 * opens or approves their microphone, accompanied by tactile and visual feedback.
 */
function playMicOpenedAlert() {
  let playedWithWebAudio = false;

  try {
    const ctx = getMicAlertAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => { });
      }

      const now = ctx.currentTime;
      // Duration: exactly 0.5 seconds
      // Pulse 1: 0.00s to 0.20s (853 Hz + 960 Hz)
      // Pause:   0.20s to 0.25s (silence)
      // Pulse 2: 0.25s to 0.50s (960 Hz + 1175 Hz)
      const pulse1End = now + 0.20;
      const pulse2Start = now + 0.25;
      const totalEnd = now + 0.50;

      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);

      // Pulse 1 gain envelope (fast attack, loud hold, smooth release)
      masterGain.gain.setValueAtTime(0, now);
      masterGain.gain.linearRampToValueAtTime(0.95, now + 0.015);
      masterGain.gain.setValueAtTime(0.95, now + 0.17);
      masterGain.gain.linearRampToValueAtTime(0, pulse1End);

      // Pulse 2 gain envelope (slightly higher volume for strong finish)
      masterGain.gain.setValueAtTime(0, pulse2Start);
      masterGain.gain.linearRampToValueAtTime(1.0, pulse2Start + 0.015);
      masterGain.gain.setValueAtTime(1.0, pulse2Start + 0.21);
      masterGain.gain.linearRampToValueAtTime(0, totalEnd);

      // Pulse 1 Oscillators (urgent alert ring)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = "sine";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(853, now);
      osc2.frequency.setValueAtTime(960, now);
      osc1.connect(masterGain);
      osc2.connect(masterGain);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(pulse1End + 0.01);
      osc2.stop(pulse1End + 0.01);

      // Pulse 2 Oscillators (rising attention ring)
      const osc3 = ctx.createOscillator();
      const osc4 = ctx.createOscillator();
      osc3.type = "sine";
      osc4.type = "sine";
      osc3.frequency.setValueAtTime(960, pulse2Start);
      osc4.frequency.setValueAtTime(1175, pulse2Start);
      osc3.connect(masterGain);
      osc4.connect(masterGain);
      osc3.start(pulse2Start);
      osc4.start(pulse2Start);
      osc3.stop(totalEnd);
      osc4.stop(totalEnd);

      if (ctx.state === "running") {
        playedWithWebAudio = true;
      }
    }
  } catch (audioErr) {
    console.warn("Unable to play alert via Web Audio API:", audioErr);
  }

  // Backup HTMLAudioElement fallback with /sounds/mic-alert.wav if Web Audio was not active
  if (!playedWithWebAudio) {
    try {
      const audioFallback = new Audio("./sounds/mic-alert.wav");
      audioFallback.volume = 1.0;
      audioFallback.play().catch(() => { });
    } catch (fallbackErr) {
      console.warn("Audio element fallback error:", fallbackErr);
    }
  }

  // Mobile vibration: 200ms ring, 50ms pause, 250ms ring (total 0.5s)
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([200, 50, 250]);
    }
  } catch (ignored) { }

  // Prominent visual toast notification for the student
  showMobileControlToast("فتح الأستاذ المايك لك! يمكنك التحدث الآن 🎙️");
}

function updateMicControl() {
  // Microphone state is intentionally controlled by the teacher only. The
  // student never receives a visible control that can mute an approved track.
  elements.toggleMicButton.style.display = "none";
  elements.toggleMicButton.disabled = true;
}

function clearHandResetTimer() {
  if (handResetTimer) {
    window.clearTimeout(handResetTimer);
    handResetTimer = null;
  }
}

function stopLocalAudio() {
  if (localAudioStream) {
    localAudioStream.getTracks().forEach((track) => track.stop());
  }
  unpublishStudentSfuMic();
  unpublishStudentP2pMic();

  localAudioStream = undefined;

  microphonePermissionGranted = false;
  microphonePrepared = false;
  isPreparingMicrophone = false;
  isRequestingMicrophone = false;
  isMakingRenegotiationOffer = false;
  microphoneOfferSent = false;
  microphoneNegotiated = false;
  updateMicControl();
}

/**
 * Runs only from the learner's intentional join click when possible. It asks
 * the browser for microphone access once, immediately turns the local track
 * off, and keeps it private until the teacher explicitly opens the mic.
 */
async function prepareStudentMicrophone() {
  if (microphonePrepared) {
    updatePrejoinControls();
    return true;
  }
  if (isPreparingMicrophone || !navigator.mediaDevices?.getUserMedia) {
    updatePrejoinControls();
    return false;
  }

  isPreparingMicrophone = true;
  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: true,
        googHighpassFilter: true,
        channelCount: 1,
      },
    });
    if (typeof window !== "undefined" && window.MinasatyAudioEnhancer?.enhanceStream) {
      localAudioStream = window.MinasatyAudioEnhancer.enhanceStream(localAudioStream);
    }
    localAudioStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
      if ("contentHint" in track) track.contentHint = "speech";
    });
    microphonePrepared = true;
    rememberStudentMicrophonePermission();
    setViewerStatus("تم تجهيز المايك للحصة بنجاح. لن يعمل إلا عند سماح الأستاذ.", "live");
    updatePrejoinControls("الميكروفون جاهز. يمكنك الآن الضغط على زر الاستمرار للدخول إلى الحصة.");
    return true;
  } catch (error) {
    microphonePrepared = false;
    clearRememberedStudentMicrophonePermission();
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      setViewerStatus("يجب السماح للمتصفح باستخدام الميكروفون للمتابعة. اضغط على أيقونة القفل 🔒 بجانب الرابط أعلى المتصفح واختر السماح للميكروفون.", "error");
      updatePrejoinControls("يجب السماح للمتصفح باستخدام الميكروفون للمتابعة. اضغط على أيقونة القفل 🔒 بجانب الرابط في الأعلى واختر السماح للميكروفون (Allow)، ثم اضغط زر 'تفعيل الميكروفون'.");
    } else if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
      setViewerStatus("لم يتم العثور على ميكروفون متاح بجهازك. يرجى توصيل ميكروفون أو سماعة للدخول للحصة.", "error");
      updatePrejoinControls("لم يتم العثور على ميكروفون متاح. يرجى توصيل ميكروفون أو سماعة ثم إعادة المحاولة.");
    } else {
      setViewerStatus("تعذر الوصول إلى الميكروفون. يرجى التحقق من الصلاحيات والمحاولة مجدداً.", "error");
      updatePrejoinControls("تعذر الوصول إلى الميكروفون. يرجى التحقق من إعدادات المتصفح ثم الضغط على زر 'تفعيل الميكروفون'.");
    }
    return false;
  } finally {
    isPreparingMicrophone = false;
    updateMicControl();
    updatePrejoinControls();
  }
}

function rememberStudentMicrophonePermission() {
  try {
    localStorage.setItem(STUDENT_MIC_PERMISSION_STORAGE_KEY, "granted");
  } catch (error) {
    console.info("Unable to remember student microphone permission locally:", error);
  }
}

function hasRememberedStudentMicrophonePermission() {
  try {
    return localStorage.getItem(STUDENT_MIC_PERMISSION_STORAGE_KEY) === "granted" || hasPermanentStudentPrejoinCompleted();
  } catch (error) {
    return hasPermanentStudentPrejoinCompleted();
  }
}

function clearRememberedStudentMicrophonePermission() {
  if (hasPermanentStudentPrejoinCompleted()) return;
  try {
    localStorage.removeItem(STUDENT_MIC_PERMISSION_STORAGE_KEY);
  } catch (error) {
    console.info("Unable to clear remembered microphone permission:", error);
  }
}

async function readBrowserMicrophonePermission() {
  if (!navigator.permissions?.query) {
    return null;
  }

  try {
    const permissionStatus = await navigator.permissions.query({ name: "microphone" });
    return permissionStatus.state;
  } catch (error) {
    return null;
  }
}

function updatePrejoinControls(message = "") {
  const micReady = Boolean(microphonePrepared);
  const micBusy = Boolean(isPreparingMicrophone);

  if (elements.prejoinMicStatus) {
    elements.prejoinMicStatus.textContent = micBusy ? "جارٍ التحقق..." : micReady ? "جاهز ✓" : "غير مفعّل";
    elements.prejoinMicStatus.classList.toggle("is-ready", micReady);
    elements.prejoinMicStatus.classList.toggle("is-error", !micReady && !micBusy && Boolean(message));
  }

  if (elements.prejoinCameraStatus) {
    elements.prejoinCameraStatus.textContent = prejoinCameraReady ? "جاهزة ✓" : "اختيارية";
    elements.prejoinCameraStatus.classList.toggle("is-ready", prejoinCameraReady);
  }

  if (elements.prejoinMicButton) {
    elements.prejoinMicButton.disabled = micReady || micBusy;
    elements.prejoinMicButton.textContent = micReady ? "الميكروفون مفعّل ✓" : micBusy ? "جارٍ تفعيل الميكروفون..." : "تفعيل الميكروفون";
  }

  if (elements.prejoinCameraButton) {
    elements.prejoinCameraButton.disabled = prejoinCameraReady;
    elements.prejoinCameraButton.textContent = prejoinCameraReady ? "الكاميرا جاهزة ✓" : "اختبار الكاميرا (اختياري)";
  }

  if (elements.prejoinContinueButton) {
    elements.prejoinContinueButton.disabled = !micReady || micBusy || prejoinCompleted;
  }

  if (elements.prejoinMessage && message) {
    elements.prejoinMessage.textContent = message;
  }
}

async function testOptionalStudentCamera() {
  if (prejoinCameraReady || !navigator.mediaDevices?.getUserMedia) return;

  if (elements.prejoinMessage) elements.prejoinMessage.textContent = "جارٍ اختبار الكاميرا الاختيارية...";
  try {
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    cameraStream.getTracks().forEach((track) => track.stop());
    prejoinCameraReady = true;
    updatePrejoinControls("الكاميرا جاهزة، ويمكنك المتابعة دون تشغيلها داخل الحصة.");
  } catch (error) {
    prejoinCameraReady = false;
    updatePrejoinControls(error?.name === "NotAllowedError"
      ? "تم تجاوز الكاميرا؛ هي اختيارية ويمكنك المتابعة الآن."
      : "تعذر اختبار الكاميرا، لكنها اختيارية ويمكنك المتابعة.");
  }
}

function setStudentPrejoinHidden(hidden) {
  const overlay = elements.prejoinOverlay || document.getElementById("student-prejoin-overlay");
  if (!overlay) return;
  overlay.hidden = hidden;
  overlay.style.display = hidden ? "none" : "grid";
  overlay.style.pointerEvents = hidden ? "none" : "auto";
  overlay.style.visibility = hidden ? "hidden" : "visible";
  overlay.setAttribute("aria-hidden", hidden ? "true" : "false");
  if (hidden) {
    document.documentElement.classList.add("student-prejoin-completed-user");
    document.documentElement.classList.remove("student-prejoin-pending", "student-prejoin-active");
    document.body.classList.remove("student-prejoin-active");
  } else {
    document.documentElement.classList.remove("student-prejoin-completed-user");
    document.documentElement.classList.add("student-prejoin-pending", "student-prejoin-active");
    document.body.classList.add("student-prejoin-active");
    const modal = elements.chatComposeModal || document.getElementById("chat-compose-modal");
    if (modal) {
      modal.hidden = true;
      modal.style.setProperty("display", "none", "important");
    }
  }
}

function setStudentSessionActive(active) {
  document.body.classList.toggle("student-session-active", active);
  if (active) setStudentPrejoinHidden(true);
}

async function continueFromStudentPrejoin() {
  if (!microphonePrepared) {
    const ready = await prepareStudentMicrophone();
    if (!ready) {
      updatePrejoinControls("لا يمكن الدخول إلى الحصة أو مشاهدة البث قبل تفعيل الميكروفون والسماح له بالمتصفح.");
      return;
    }
  }

  markPermanentStudentPrejoinCompleted();
  await completeStudentPrejoinAndJoin();
}

async function completeStudentPrejoinAndJoin() {
  if (isStudentLiveSubscriptionExpired(currentStudent.subscriptionEndDate) || currentStudent?.paymentStage === "EXPIRED") {
    openSubscriptionUpgradeModal("EXPIRED");
    return;
  }
  markPermanentStudentPrejoinCompleted();
  prejoinCompleted = true;
  initialAutoJoinPending = true;
  setStudentPrejoinHidden(true);
  setStudentSessionActive(true);
  document.documentElement.classList.remove("student-prejoin-pending", "student-prejoin-active");
  document.body.classList.remove("student-prejoin-active");
  if (!isDesktopStudentView()) {
    openStudentChatComposer({ focus: false });
  }
  void startTeacherAudio({ userInitiated: true });
  armAutoUnmuteOnFirstInteraction();
  setPlaceholder("جاري الدخول إلى الحصة", "سيظهر بث الأستاذ تلقائياً عند توفر الحصة.");
  setViewerStatus("جارٍ الدخول إلى الحصة…", "warning");
  if (socket.connected) {
    void joinClass();
  }
}

async function initializeStudentPrejoin() {
  if (!elements.prejoinOverlay) return;

  // Strict microphone requirement: automatically check and prepare mic on load
  const micReady = await prepareStudentMicrophone();
  if (micReady) {
    prejoinCompleted = true;
    initialAutoJoinPending = true;
    setStudentPrejoinHidden(true);
    setStudentSessionActive(true);
    markPermanentStudentPrejoinCompleted();
    if (!isDesktopStudentView()) {
      openStudentChatComposer({ focus: false });
    }
    void startTeacherAudio({ userInitiated: true });
    armAutoUnmuteOnFirstInteraction();
    if (socket.connected && !joinedClass && !isJoining) {
      void joinClass();
    }
    return;
  }

  // If mic is not ready or blocked, strictly block classroom access
  prejoinCompleted = false;
  initialAutoJoinPending = false;
  setStudentPrejoinHidden(false);
  updatePrejoinControls("يجب السماح للمتصفح باستخدام الميكروفون للمتابعة والدخول إلى الحصة.");
}

function updateRemoteAudioControl() {
  // Native video controls must not enable a second output for the same audio.
  if (elements.remoteVideo && !elements.remoteVideo.muted) {
    elements.remoteVideo.muted = true;
  }
  if (elements.enableAudioButton) {
    elements.enableAudioButton.hidden = !teacherAudioPlaybackBlocked;
    elements.enableAudioButton.style.display = teacherAudioPlaybackBlocked ? "" : "none";
  }
}

let autoUnmuteArmed = false;

function armAutoUnmuteOnFirstInteraction() {
  if (autoUnmuteArmed) return;
  autoUnmuteArmed = true;

  const triggerUnmute = async () => {
    try {
      const audioEl = getTeacherAudioElement();
      if (audioEl) {
        audioEl.muted = false;
        audioEl.volume = 1.0;
        await audioEl.play();
        setTeacherAudioPlaybackBlocked(false);
      }
      if (elements.remoteVideo) {
        elements.remoteVideo.muted = true;
        elements.remoteVideo.volume = 1.0;
        await elements.remoteVideo.play().catch(() => {});
      }
      if (typeof classmateAudioElements !== "undefined" && classmateAudioElements) {
        classmateAudioElements.forEach((el) => {
          if (el && (el.paused || el.muted)) {
            el.muted = false;
            el.volume = 1.0;
            el.play().catch(() => {});
          }
        });
      }
      if (typeof window !== "undefined" && window.MinasatyAudioEnhancer?.unlockAudioContext) {
        window.MinasatyAudioEnhancer.unlockAudioContext();
      }
      autoUnmuteArmed = false;
      const events = ["touchstart", "touchend", "pointerdown", "click", "keydown", "scroll"];
      events.forEach((ev) => {
        window.removeEventListener(ev, triggerUnmute, true);
        document.removeEventListener(ev, triggerUnmute, true);
      });
      console.info("[WebRTC-Student] Audio unmuted automatically via user interaction.");
    } catch (error) {
      if (error?.name === "NotAllowedError") setTeacherAudioPlaybackBlocked(true);
    }
  };

  const events = ["touchstart", "touchend", "pointerdown", "click", "keydown", "scroll"];
  events.forEach((ev) => {
    window.addEventListener(ev, triggerUnmute, { capture: true, passive: true });
    document.addEventListener(ev, triggerUnmute, { capture: true, passive: true });
  });

  // Also retry periodically in case browser policy permits unmuted playback after media buffer warms up
  [200, 600, 1200, 2500].forEach((delay) => {
    window.setTimeout(() => {
      const audioEl = getTeacherAudioElement();
      if ((elements.remoteVideo && elements.remoteVideo.muted) || (audioEl && (audioEl.muted || audioEl.paused))) {
        void triggerUnmute();
      }
    }, delay);
  });
}

async function startTeacherAudio({ userInitiated = false } = {}) {
  if (!remoteMediaStream && !teacherAudioStream) {
    return false;
  }

  isAttemptingTeacherAudio = true;
  if (elements.enableAudioButton) {
    elements.enableAudioButton.hidden = true;
    elements.enableAudioButton.style.display = "none";
  }

  const audioEl = getTeacherAudioElement();
  if (audioEl) {
    audioEl.muted = false;
    audioEl.volume = 1.0;
  }
  if (elements.remoteVideo) {
    elements.remoteVideo.muted = true;
    elements.remoteVideo.volume = 1.0;
  }

  try {
    if (audioEl && audioEl.srcObject) {
      await audioEl.play();
      setTeacherAudioPlaybackBlocked(false);
    }
    if (elements.remoteVideo) {
      await elements.remoteVideo.play();
    }
    if (userInitiated) {
      setViewerStatus("صوت الأستاذ يعمل الآن.", "live");
    }
    return true;
  } catch (error) {
    if (error?.name === "NotAllowedError") setTeacherAudioPlaybackBlocked(true);
    console.warn("Unable to start teacher audio unmuted automatically, arming interaction handler:", error);
    // Never force muted = true on the teacher audio! Keep muted = false so interaction immediately unpauses.
    armAutoUnmuteOnFirstInteraction();
    return false;
  } finally {
    isAttemptingTeacherAudio = false;
    updateRemoteAudioControl();
  }
}

async function enableTeacherAudio() {
  await startTeacherAudio({ userInitiated: true });
}

function updateRemoteVideoPresentation() {
  const hasLiveVideo = Boolean(
    remoteMediaStream?.getVideoTracks?.().some((track) => track.readyState === "live")
  );
  const showScreenShare = screenShareActive && hasLiveVideo;
  const shouldShowRemoteVideo = hasLiveVideo;
  if (elements?.remoteVideo) {
    elements.remoteVideo.controls = showScreenShare;
    elements.remoteVideo.classList?.toggle?.("is-screen-share", showScreenShare);
    elements.remoteVideo.classList?.toggle?.("has-live-video", shouldShowRemoteVideo);
  }
  // The placeholder must disappear as soon as a live video track arrives. The
  // screen-share flag is a status signal and can arrive before the media track.
  if (elements?.placeholder) {
    elements.placeholder.hidden = shouldShowRemoteVideo;
  }

  if (shouldShowRemoteVideo) {
    if (typeof hideScreenShareNotice === "function") hideScreenShareNotice();
    if (typeof hideConnectionOverlay === "function") hideConnectionOverlay();
    if (typeof elements?.remoteVideo?.play === "function") {
      void elements.remoteVideo.play().catch(() => { });
    }
    if (typeof setViewerStatus === "function") {
      setViewerStatus(
        screenShareActive ? "مشاركة شاشة الأستاذ متصلة." : "بث الأستاذ المباشر متصل.",
        "live"
      );
    }
  } else {
    const hasAudio = Boolean(
      (teacherAudioStream && teacherAudioStream.getAudioTracks().some((t) => t.readyState === "live")) ||
      (remoteMediaStream && remoteMediaStream.getAudioTracks().some((t) => t.readyState === "live"))
    );
    if (hasAudio && (typeof joinedClass === "undefined" || joinedClass)) {
      if (typeof setPlaceholder === "function") {
        setPlaceholder("صوت الأستاذ مباشر ومفعّل 🎙️", "الأستاذ يتحدث الآن مباشرة. ستظهر شاشة الحصة هنا فور بدئها.");
      }
      if (typeof setViewerStatus === "function") {
        setViewerStatus("صوت الأستاذ متصل. بانتظار بدء مشاركة الشاشة…", "live");
      }
    }
  }
  // Do not pause the media element while waiting: the same element carries
  // the teacher's audio, which must remain audible before screen sharing.
}

function resetRemoteMedia() {
  detachTeacherSfuPlaybackTrack("video");
  detachTeacherSfuPlaybackTrack("audio");
  setTeacherAudioPlaybackBlocked(false);
  remoteMediaStream = undefined;
  screenShareActive = false;
  lastScreenShareRevision = 0;
  pendingRemoteAudioTracks.length = 0;
  elements.remoteVideo.srcObject = null;
  elements.remoteVideo.muted = true;
  elements.remoteVideo.controls = false;
  elements.remoteVideo.classList.remove("is-screen-share", "has-live-video");
  elements.placeholder.hidden = false;
  isAttemptingTeacherAudio = false;
  updateRemoteAudioControl();
}

function addUniqueTrack(stream, track) {
  if (track.kind === "audio") {
    // Strictly prevent double-audio / echo feedback across classroom playback.
    // Ensure that exactly one primary audio track plays at any time.
    const existingAudio = stream.getAudioTracks();

    // All classroom audio is received directly via P2P WebRTC with teacher mix-minus.
    // If an SFU audio track is ever received, ignore it so dedicated P2P audio remains uninterrupted.
    if (track.__fromSfu) {
      console.info("[Audio-Student] Ignoring SFU audio in favor of dedicated P2P audio.");
      return;
    }

    if (existingAudio.some((currentTrack) => currentTrack.id === track.id)) {
      return;
    }
    existingAudio.forEach((oldTrack) => {
      try {
        stream.removeTrack(oldTrack);
        oldTrack.enabled = false;
      } catch (_) { }
    });
    stream.addTrack(track);
    syncClassmateSfuAudioPlayback();
    if (elements.remoteVideo) {
      if (elements.remoteVideo.srcObject !== stream) {
        elements.remoteVideo.srcObject = stream;
      }
      elements.remoteVideo.muted = true;
      elements.remoteVideo.volume = 1.0;
      if (typeof elements.remoteVideo.play === "function") {
        void elements.remoteVideo.play().catch(() => {});
      }
    }
    return;
  }

  if (track.kind === "video") {
    const existingVideo = stream.getVideoTracks();

    if (track.__fromSfu) {
      // SFU is PRIMARY. Remove any P2P video tracks to save decoding CPU.
      const p2pVideo = existingVideo.filter((t) => !t.__fromSfu);
      p2pVideo.forEach((oldP2p) => {
        try {
          stream.removeTrack(oldP2p);
          oldP2p.enabled = false;
        } catch (_) { }
      });
    } else {
      // Incoming P2P video track. If a live SFU video track is active, discard P2P.
      const hasLiveSfuVideo = existingVideo.some((t) => t.readyState === "live" && t.__fromSfu);
      if (hasLiveSfuVideo) {
        console.info("[WebRTC-Student] Ignoring incoming P2P video because primary SFU video is active and healthy.");
        return;
      }
    }

    if (existingVideo.some((currentTrack) => currentTrack.id === track.id)) {
      return;
    }
    // Remove any stale or previous video tracks so stream has strictly ONE video track at all times
    existingVideo.forEach((oldTrack) => {
      try {
        stream.removeTrack(oldTrack);
        oldTrack.enabled = false;
        if (typeof oldTrack.stop === "function") oldTrack.stop();
      } catch (_) { }
    });
    stream.addTrack(track);
    if (elements.remoteVideo) {
      if (elements.remoteVideo.srcObject !== stream) {
        elements.remoteVideo.srcObject = stream;
      }
      if (typeof elements.remoteVideo.play === "function") {
        void elements.remoteVideo.play().catch(() => {});
      }
    }
    return;
  }

  const alreadyAdded = stream.getTracks().some((currentTrack) => currentTrack.id === track.id);
  if (!alreadyAdded) {
    stream.addTrack(track);
    if (elements.remoteVideo) {
      if (elements.remoteVideo.srcObject !== stream) {
        elements.remoteVideo.srcObject = stream;
      }
      if (typeof elements.remoteVideo.play === "function") {
        void elements.remoteVideo.play().catch(() => {});
      }
    }
  }
}

function attachTeacherTrack(event) {
  const track = event.track;
  if (!track) return;

  if (track.kind === "audio") {
    if (track.__fromSfu && typeof teacherAudioStream !== "undefined" && teacherAudioStream?.getAudioTracks().some((t) => !t.__fromSfu && t.readyState === "live")) {
      return;
    }
    if (typeof playTeacherInboundAudio === "function") {
      playTeacherInboundAudio(track);
    }
    if (event.receiver) {
      try {
        if ("jitterBufferTarget" in event.receiver) {
          event.receiver.jitterBufferTarget = 80;
        } else if ("playoutDelayHint" in event.receiver) {
          event.receiver.playoutDelayHint = 0.08;
        }
      } catch (_) { }
    }
  }

  if (!remoteMediaStream) {
    remoteMediaStream = new MediaStream();
    if (elements?.remoteVideo) elements.remoteVideo.srcObject = remoteMediaStream;
  }
  if (elements?.remoteVideo) elements.remoteVideo.muted = true;
  addUniqueTrack(remoteMediaStream, track);
  if (!track.__fromSfu && typeof notifyP2pTransportStatus === "function") notifyP2pTransportStatus();

  if (track.kind === "video") {
    if (typeof clearRecoveryTimer === "function") clearRecoveryTimer();
    recoveryAttempts = 0;
    isRecoveringStream = false;
    if (typeof updateChatControls === "function") updateChatControls();
    if (typeof hideConnectionOverlay === "function") hideConnectionOverlay();
    if (typeof setViewerStatus === "function") {
      setViewerStatus(
        screenShareActive ? "مشاركة شاشة الأستاذ متصلة." : "بث الأستاذ المباشر متصل.",
        "live"
      );
    }
  } else {
    if (typeof hideConnectionOverlay === "function") hideConnectionOverlay();
    const hasVideo = Boolean(remoteMediaStream?.getVideoTracks?.().some((t) => t.readyState === "live"));
    if (!hasVideo && typeof setViewerStatus === "function") {
      setViewerStatus("صوت الأستاذ متصل. بانتظار بدء مشاركة الشاشة…", "live");
    }
  }

  if (typeof updateRemoteVideoPresentation === "function") updateRemoteVideoPresentation();

  track.addEventListener("ended", () => {
    if (track.kind === "audio" && typeof teacherAudioStream !== "undefined" && teacherAudioStream) {
      try { teacherAudioStream.removeTrack(track); } catch (_) {}
    }
    remoteMediaStream?.removeTrack(track);
    if (typeof syncClassmateSfuAudioPlayback === "function") syncClassmateSfuAudioPlayback();
    if (track.kind === "video") {
      screenShareActive = false;
      if (typeof setViewerStatus === "function") {
        setViewerStatus("توقفت مشاركة الشاشة. صوت الأستاذ ما زال متاحًا.", "live");
      }
      if (typeof updateRemoteVideoPresentation === "function") updateRemoteVideoPresentation();
    }
    if (typeof updateRemoteAudioControl === "function") updateRemoteAudioControl();
  }, { once: true });
  track.addEventListener("unmute", () => {
    if (typeof updateRemoteAudioControl === "function") updateRemoteAudioControl();
    if (typeof updateRemoteVideoPresentation === "function") updateRemoteVideoPresentation();
    if (track.kind === "audio" && typeof playTeacherInboundAudio === "function"
        && remoteMediaStream?.getAudioTracks?.().includes(track)) {
      playTeacherInboundAudio(track);
    }
    if (track.kind === "video" && typeof elements?.remoteVideo?.play === "function") {
      void elements.remoteVideo.play().catch(() => { });
    }
  });

  if (typeof updateRemoteAudioControl === "function") updateRemoteAudioControl();
  if (typeof startTeacherAudio === "function") void startTeacherAudio();
}

function clearRecoveryTimer() {
  if (recoveryTimer) {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
}

function scheduleClassRecovery(delayMs = 1_000) {
  if (!joinedClass || recoveryTimer || recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    return;
  }

  isRecoveringStream = true;
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = null;
    void joinClass({ rejoin: true });
  }, delayMs);
}

/** Keep the same viewer page alive while a fresh WebRTC offer is requested. */
function beginStreamRecovery(message, { force = false } = {}) {
  if (!joinedClass && !isJoining) {
    return;
  }

  // If SFU media is healthy and this is just a transient signaling interruption (not force),
  // do NOT tear down the media session or blackout the screen!
  if (!force && isStudentSfuHealthy()) {
    console.info("[WebRTC-Student] Signaling interrupted, but SFU media stream is healthy. Preserving media playback.");
    recordStudentDiagnosticEvent("signaling_drop_sfu_intact", "Preserving SFU media during signaling drop");
    setViewerStatus("جاري استعادة قناة الإشارات… البث المباشر مستمر", "warning");
    scheduleClassRecovery(Math.min(1_000 * (2 ** recoveryAttempts), 8_000));
    return;
  }

  clearHandResetTimer();
  // A forced refresh reports missing media after room rejoin; do not send a
  // competing offer request while the current peer is about to be discarded.
  disconnectStudentSfu({ notify: !force });
  closePeerConnection();
  resetRemoteMedia();
  if (!microphonePermissionGranted) {
    if (localAudioStream) {
      localAudioStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    updateMicControl();
  }
  isJoining = false;
  joinedClass = true;
  isRecoveringStream = true;
  elements.joinButton.hidden = true;
  elements.joinButton.disabled = true;
  setButtonLabel(elements.joinButton, "جارٍ استعادة البث…");
  elements.raiseHandButton.hidden = true;
  updateChatControls();
  setPlaceholder("جارٍ استعادة الحصة", message || "سيُعاد الاتصال بالبث تلقائياً دون تحديث الصفحة.");
  setViewerStatus(message || "انقطع البث مؤقتاً. جارٍ استعادته تلقائياً…", "warning");
  showConnectionOverlay(message || "انقطع البث مؤقتاً. جارٍ استعادته تلقائياً…", "warning");
  scheduleClassRecovery(force ? 150 : Math.min(1_000 * (2 ** recoveryAttempts), 8_000));
}

function closePeerConnection() {
  if (p2pDisconnectTimer) {
    window.clearTimeout(p2pDisconnectTimer);
    p2pDisconnectTimer = null;
  }
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onnegotiationneeded = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;

    if (pc.signalingState !== "closed") {
      pc.close();
    }
  }

  pc = undefined;
  studentP2pMicSender = null;
  teacherSocketId = null;
  pendingIceCandidates.length = 0;
  isMakingRenegotiationOffer = false;
  microphoneOfferSent = false;
  microphoneNegotiated = false;
}

/**
 * The page is returned to its private idle state when the teacher ends class,
 * the socket disconnects, or the browser starts unloading.
 */
function resetViewerState({ message, mode = "neutral", showJoin = true } = {}) {
  clearScreenShareRefreshGuard();
  clearHandResetTimer();
  clearRecoveryTimer();
  isRecoveringStream = false;
  recoveryAttempts = 0;
  closePeerConnection();
  disconnectStudentSfu();
  stopLocalAudio();
  joinedClass = false;
  studentClassJoinedAt = 0;
  isJoining = false;
  studentSfuRecoveryHoldUntil = 0;
  studentSfuRetryAttempt = 0;
  initialP2pPreviewRequested = false;
  setStudentSessionActive(false);
  globalFreeClass = false;
  setParticipationCount(0);

  resetRemoteMedia();
  // The learner never needs a manual join control inside the live classroom.
  // The button remains hidden for backwards-compatible controller references.
  elements.joinButton.hidden = true;
  elements.joinButton.disabled = true;

  elements.raiseHandButton.hidden = true;
  setRaisedHandState({ waiting: false });
  updateMicControl();
  clearStudentChat();
  updateChatControls();

  setPlaceholder(
    mode === "error" ? "تعذر استمرار الحصة" : "الحصة ليست نشطة الآن",
    message || "يمكنك المحاولة مرة أخرى عند بدء الأستاذ للحصة."
  );
  setViewerStatus(message || "جاهز للانضمام", mode);
}

/**
 * Use acknowledgements for join and microphone renegotiation events so the UI
 * can recover if the server rejects a room/role transition.
 */
function emitWithAcknowledgement(eventName, payload, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error("الاتصال بخادم الحصص غير متاح حالياً."));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      reject(new Error("انتهت مهلة الاستجابة من الخادم."));
    }, timeoutMs);

    socket.emit(eventName, payload, (response) => {
      window.clearTimeout(timeoutId);

      if (response?.ok) {
        resolve(response);
        return;
      }

      reject(
        new Error(
          response?.message || response?.error || "تعذر تنفيذ الطلب من الخادم."
        )
      );
    });
  });
}

function optimizeOpusSdp(sdp) {
  if (!sdp || typeof sdp !== "string") return sdp;
  const lines = sdp.split("\r\n");
  let opusPayload = null;
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/i);
    if (match) {
      opusPayload = match[1];
      break;
    }
  }
  if (!opusPayload) return sdp;

  let fmtpFound = false;
  const modifiedLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(`a=fmtp:${opusPayload} `) || line === `a=fmtp:${opusPayload}`) {
      fmtpFound = true;
      let params = line.substring(`a=fmtp:${opusPayload}`.length).trim();
      const paramMap = new Map();
      params.split(";").forEach((p) => {
        const [k, v] = p.trim().split("=");
        if (k) paramMap.set(k.toLowerCase(), v ?? "");
      });
      paramMap.set("useinbandfec", "1");
      paramMap.set("usedtx", "0");
      paramMap.set("stereo", "0");
      paramMap.set("sprop-stereo", "0");
      paramMap.set("cbr", "1");
      paramMap.set("maxaveragebitrate", "48000");
      paramMap.set("ptime", "20");
      paramMap.set("minptime", "10");
      paramMap.set("maxptime", "40");
      const newParams = Array.from(paramMap.entries())
        .map(([k, v]) => (v ? `${k}=${v}` : k))
        .join(";");
      modifiedLines.push(`a=fmtp:${opusPayload} ${newParams}`);
    } else {
      modifiedLines.push(line);
      if (line.startsWith(`a=rtpmap:${opusPayload} `) && !fmtpFound) {
        const nextLine = lines[i + 1] || "";
        if (!nextLine.startsWith(`a=fmtp:${opusPayload}`)) {
          modifiedLines.push(`a=fmtp:${opusPayload} minptime=10;ptime=20;maxptime=40;useinbandfec=1;usedtx=0;stereo=0;sprop-stereo=0;cbr=1;maxaveragebitrate=48000`);
          fmtpFound = true;
        }
      }
    }
  }
  return modifiedLines.join("\r\n");
}

async function negotiateStudentMicrophone() {
  if (
    !microphonePermissionGranted ||
    !localAudioStream?.getAudioTracks().length ||
    !teacherSocketId ||
    !pc ||
    microphoneOfferSent ||
    microphoneNegotiated ||
    isMakingRenegotiationOffer ||
    pc.signalingState !== "stable"
  ) {
    return false;
  }

  isMakingRenegotiationOffer = true;
  const negotiatingPeer = pc;
  const targetTeacher = teacherSocketId;
  const stillCurrent = () => pc === negotiatingPeer && teacherSocketId === targetTeacher && microphonePermissionGranted;

  try {
    if (typeof window.getMinasatyRtcConfig === "function") {
      Object.assign(rtcConfig, await window.getMinasatyRtcConfig());
      if (!stillCurrent() || negotiatingPeer.signalingState !== "stable") return false;
      if (typeof pc.setConfiguration === "function") pc.setConfiguration(rtcConfig);
    }
    const offer = await negotiatingPeer.createOffer();
    if (!stillCurrent() || negotiatingPeer.signalingState !== "stable") return false;
    const optimizedSdp = optimizeOpusSdp(offer.sdp);
    await negotiatingPeer.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: optimizedSdp }));
    if (!stillCurrent()) return false;

    await emitWithAcknowledgement("webrtc_renegotiation_offer", {
      targetSocketId: targetTeacher,
      sdp: negotiatingPeer.localDescription,
    });
    if (!stillCurrent()) return false;

    microphoneOfferSent = true;
    setViewerStatus("جارٍ ربط مايكك بالأستاذ…", "warning");
    return true;
  } catch (error) {
    console.error("Unable to negotiate the approved microphone track:", error);
    window.LiveDoctor?.report("microphone_negotiation_failed", { errorName: error?.name || "Error" });
    if (stillCurrent()) {
      // A rejected relay must not leave the peer stuck with a pending offer,
      // otherwise the next manual microphone attempt cannot negotiate.
      if (negotiatingPeer.signalingState === "have-local-offer") {
        try { await negotiatingPeer.setLocalDescription({ type: "rollback" }); }
        catch (rollbackError) {
          window.LiveDoctor?.report("microphone_rollback_failed", { errorName: rollbackError?.name || "Error" });
        }
      }
      if (!stillCurrent()) return false;
      microphoneOfferSent = false;
      setViewerStatus("تعذر تشغيل المايك مع الحصة. حاول رفع اليد مرة أخرى.", "error");
    }
    return false;
  } finally {
    if (pc === negotiatingPeer) isMakingRenegotiationOffer = false;
  }
}

function createViewerPeerConnection() {
  closePeerConnection();

  pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (!event.candidate || !teacherSocketId || !socket.connected) {
      return;
    }

    socket.emit("webrtc_ice_candidate", {
      targetSocketId: teacherSocketId,
      candidate: event.candidate.toJSON(),
    });
  };

  /**
   * A teacher may send the display, camera, and microphone as separate streams.
   * Merge every received track into a single playback stream so the student
   * always gets the display and all available audio tracks, independent of the
   * browser's ontrack event ordering.
   */
  pc.ontrack = (event) => {
    attachTeacherTrack(event);
  };

  // Browsers may coalesce or delay negotiationneeded. The track-addition path
  // calls negotiateStudentMicrophone directly as the reliable primary route;
  // this handler remains a safe fallback.
  pc.onnegotiationneeded = () => {
    void negotiateStudentMicrophone();
  };

  pc.onconnectionstatechange = () => {
    if (!pc) {
      return;
    }

    if (pc.connectionState === "connected" && p2pDisconnectTimer) {
      window.clearTimeout(p2pDisconnectTimer);
      p2pDisconnectTimer = null;
    }

    if (pc.connectionState === "failed") {
      if (isStudentSfuHealthy()) {
        console.info("[WebRTC-Student] P2P failed while LiveKit media is healthy; preserving playback.");
        return;
      }
      beginStreamRecovery("انقطع اتصال البث. جارٍ استعادته تلقائياً…");
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (!pc) {
      return;
    }

    const { iceConnectionState } = pc;

    if (iceConnectionState === "connected" || iceConnectionState === "completed") {
      if (p2pDisconnectTimer) {
        window.clearTimeout(p2pDisconnectTimer);
        p2pDisconnectTimer = null;
      }
      clearRecoveryTimer();
      recoveryAttempts = 0;
      isRecoveringStream = false;
      hideConnectionOverlay();
      updateChatControls();
      return;
    }

    if (iceConnectionState === "disconnected") {
      // ICE can briefly report "disconnected" during Wi-Fi jitter even while
      // LiveKit is delivering media. Wait before showing a warning or rejoining.
      if (isStudentSfuHealthy()) {
        hideConnectionOverlay();
        return;
      }
      if (p2pDisconnectTimer) return;
      const disconnectedPeer = pc;
      p2pDisconnectTimer = window.setTimeout(() => {
        p2pDisconnectTimer = null;
        if (pc !== disconnectedPeer || pc.iceConnectionState !== "disconnected" || isStudentSfuHealthy()) return;
        showConnectionOverlay("اتصال البث غير مستقر. جارٍ محاولة الاستعادة…", "warning");
        setViewerStatus("اتصال البث غير مستقر. جارٍ محاولة الاستعادة…", "warning");
        isRecoveringStream = true;
        scheduleClassRecovery(2_000);
      }, P2P_DISCONNECT_GRACE_MS);
      return;
    }

    if (iceConnectionState === "failed") {
      if (p2pDisconnectTimer) {
        window.clearTimeout(p2pDisconnectTimer);
        p2pDisconnectTimer = null;
      }
      if (isStudentSfuHealthy()) {
        console.info("[WebRTC-Student] P2P ICE failed while LiveKit media is healthy; preserving playback.");
        return;
      }
      beginStreamRecovery("فشل اتصال البث. جارٍ إعادة الاتصال تلقائياً…");
    }
  };

  return pc;
}

async function flushPendingIceCandidates() {
  if (!pc || !pc.remoteDescription) {
    return;
  }

  const queuedCandidates = pendingIceCandidates.splice(0);

  for (const candidate of queuedCandidates) {
    try {
      if (candidate) {
        await pc.addIceCandidate(candidate);
      }
    } catch (error) {
      console.warn("Unable to apply a queued teacher ICE candidate:", error);
    }
  }
}

/**
 * Request microphone access only after explicit server-delivered teacher
 * approval. The audio track is never requested at join time.
 */
async function enableApprovedMicrophone() {
  if (!microphonePermissionGranted || isRequestingMicrophone) {
    return;
  }

  const sfuAvailable = isStudentSfuConnected();
  if (!sfuAvailable && (!pc || !teacherSocketId)) {
    setViewerStatus("سيُفعّل المايك فور اتصال البث.", "warning");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setViewerStatus("هذا المتصفح لا يدعم تشغيل المايك للحصة.", "error");
    return;
  }

  const existingTrack = localAudioStream?.getAudioTracks()[0];
  if (existingTrack && existingTrack.readyState === "live") {
    existingTrack.enabled = true;

    // 1. Primary path: Direct P2P Audio
    if (pc) {
      const published = await publishStudentP2pMic(existingTrack, localAudioStream);
      if (!published && microphonePermissionGranted && joinedClass) {
        setViewerStatus("لم يكتمل ربط المايك بالأستاذ. أعد محاولة تشغيل المايك.", "warning");
      } else {
        updateMicControl();
        setViewerStatus("المايك يعمل الآن عبر اتصال P2P المباشر.", "live");
      }
      if (typeof ensureTeacherAudioPlayback === "function") {
        await ensureTeacherAudioPlayback({ sourceHint: "enableApprovedMicrophone_existing_p2p" });
      }
      return;
    }

    // 2. Fallback path if P2P is not connected: SFU
    if (sfuAvailable) {
      const sfuPublished = await publishStudentSfuMic(localAudioStream);
      if (!microphonePermissionGranted || !joinedClass) return;
      if (sfuPublished) {
        updateMicControl();
        setViewerStatus("المايك يعمل الآن عبر البث المباشر (SFU).", "live");
        if (typeof ensureTeacherAudioPlayback === "function") {
          await ensureTeacherAudioPlayback({ sourceHint: "enableApprovedMicrophone_existing_sfu" });
        }
        return;
      }
    }
    return;
  }

  // If track doesn't exist or is ended/stopped, clean it up and get a fresh one
  if (localAudioStream) {
    try {
      localAudioStream.getTracks().forEach((track) => track.stop());
    } catch (_) { }
    localAudioStream = undefined;
  }

  isRequestingMicrophone = true;
  updateMicControl();

  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: true,
        googHighpassFilter: true,
        channelCount: 1,
      },
    });
    if (typeof window !== "undefined" && window.MinasatyAudioEnhancer?.enhanceStream) {
      localAudioStream = window.MinasatyAudioEnhancer.enhanceStream(localAudioStream);
    }
    // Approval may be revoked while the browser permission dialog is open.
    if (!microphonePermissionGranted || !joinedClass) {
      stopLocalAudio();
      return;
    }
    microphonePrepared = true;

    // Immediately resume teacher playback if the browser audio focus paused it during getUserMedia
    if (typeof ensureTeacherAudioPlayback === "function") {
      await ensureTeacherAudioPlayback({ sourceHint: "enableApprovedMicrophone_post_getUserMedia" });
    }

    // The peer/sfu might have been closed while the permission prompt was open.
    if (!microphonePermissionGranted || !joinedClass || (!isStudentSfuConnected() && (!pc || !teacherSocketId))) {
      stopLocalAudio();
      return;
    }

    const newTrack = localAudioStream.getAudioTracks()[0];
    if (newTrack) {
      newTrack.enabled = true;
      if ("contentHint" in newTrack) newTrack.contentHint = "speech";
    }

    // 1. Primary path: Direct P2P Audio (student mic is delivered to teacher who mixes it to classmates)
    if (pc && teacherSocketId && newTrack) {
      const published = await publishStudentP2pMic(newTrack, localAudioStream);
      if (!published && microphonePermissionGranted && joinedClass) {
        setViewerStatus("لم يكتمل ربط المايك بالأستاذ. أعد محاولة تشغيل المايك.", "warning");
      } else {
        updateMicControl();
        setViewerStatus("المايك يعمل الآن عبر اتصال P2P المباشر.", "live");
      }
      if (typeof ensureTeacherAudioPlayback === "function") {
        await ensureTeacherAudioPlayback({ sourceHint: "enableApprovedMicrophone_fresh_p2p" });
      }
      return;
    }

    // 2. Fallback path if P2P is unavailable: SFU
    if (isStudentSfuConnected()) {
      const sfuPublished = await publishStudentSfuMic(localAudioStream);
      if (!microphonePermissionGranted || !joinedClass) return;
      if (sfuPublished) {
        updateMicControl();
        setViewerStatus("المايك يعمل الآن عبر البث المباشر (SFU).", "live");
        if (typeof ensureTeacherAudioPlayback === "function") {
          await ensureTeacherAudioPlayback({ sourceHint: "enableApprovedMicrophone_fresh_sfu" });
        }
        return;
      }
    }
  } catch (error) {
    console.error("Unable to access student microphone:", error);
    window.LiveDoctor?.report("microphone_acquisition_failed", { errorName: error?.name || "Error" });
    microphonePermissionGranted = false;
    setRaisedHandState({ waiting: false });
    updateMicControl();

    if (error?.name === "NotAllowedError") {
      setViewerStatus("لم تسمح للمتصفح بالوصول إلى المايك.", "error");
    } else if (error?.name === "NotFoundError") {
      setViewerStatus("لم يتم العثور على مايك متاح.", "error");
    } else {
      setViewerStatus("تعذر تشغيل المايك الآن.", "error");
    }
  } finally {
    isRequestingMicrophone = false;
    updateMicControl();
  }
}

async function joinClass({ rejoin = false, prepareMicrophone = false } = {}) {
  const hasRecentClassState = (() => {
    try {
      const state = sessionStorage.getItem("lastLiveClassState");
      if (!state) return false;
      const parsed = JSON.parse(state);
      return Boolean(parsed?.savedAt && (Date.now() - parsed.savedAt) < 15 * 60 * 1000);
    } catch (_) { return false; }
  })();
  if (hasRecentClassState) {
    rejoin = true;
  }

  if (!microphonePrepared) {
    const micReady = await prepareStudentMicrophone();
    if (!micReady) {
      setStudentPrejoinHidden(false);
      updatePrejoinControls("يجب السماح للمتصفح باستخدام الميكروفون قبل الدخول ومشاهدة الحصة.");
      return;
    }
  }

  if (!prejoinCompleted && !rejoin && !directClassEntryRequested) {
    return;
  }
  if (directClassEntryRequested) {
    prejoinCompleted = true;
    setStudentPrejoinHidden(true);
    setStudentSessionActive(true);
  }

  if ((!rejoin && joinedClass && !isRecoveringStream) || isJoining) {
    return;
  }

  if (rejoin) {
    isRecoveringStream = true;
  }

  if (!socket.connected) {
    if (rejoin || isRecoveringStream) {
      scheduleClassRecovery(1_000);
      return;
    }
    if (initialAutoJoinPending) {
      elements.joinButton.hidden = true;
      setViewerStatus("جارٍ الاتصال بالخادم للدخول إلى الحصة…", "warning");
      return;
    }
    setViewerStatus("تعذر الانضمام لأن الاتصال بالخادم غير متاح.", "error");
    return;
  }

  // Mark the local state before emitting. The server may notify the teacher,
  // who can send a direct WebRTC offer before the room-join acknowledgement
  // returns to this browser.
  joinedClass = true;
  isJoining = true;
  studentClassJoinedAt = Date.now();
  initialP2pPreviewRequested = false;
  // Once joining starts, the pre-join layer must stop intercepting controls.
  setStudentSessionActive(true);
  if (!rejoin) {
    clearStudentChat();
  }
  updateChatControls();
  hideConnectionOverlay();
  elements.joinButton.disabled = true;
  setButtonLabel(elements.joinButton, rejoin ? "جارٍ استعادة البث…" : "جارٍ الانضمام…");
  setPlaceholder(
    rejoin ? "جارٍ استعادة الحصة" : "بانتظار البث المباشر",
    rejoin ? "يتم طلب بث جديد من الأستاذ تلقائياً." : "تم إرسال طلب الانضمام إلى الأستاذ."
  );
  setViewerStatus(rejoin ? "جارٍ استعادة اتصال البث…" : "بانتظار البث من الأستاذ…", "warning");

  try {
    await emitWithAcknowledgement("student_join_room", {
      level,
      studentId,
      rejoin,
      preferredTransport: "sfu",
    });

    isJoining = false;
    isRecoveringStream = false;
    recoveryAttempts = 0;
    consumeDirectClassEntry();
    clearRecoveryTimer();
    elements.joinButton.hidden = true;
    elements.raiseHandButton.hidden = false;
    setRaisedHandState({ waiting: false });
    updateChatControls();
    setViewerStatus(rejoin ? "تمت إعادة الانضمام. جارٍ استقبال البث…" : "انضممت إلى الحصة. جارٍ استقبال بث الأستاذ…", "warning");
    flushClassContinueRefresh();
  } catch (error) {
    console.error("Unable to join classroom:", error);
    isJoining = false;
    const joinErrorMessage = error.message || "تعذر الانضمام إلى الحصة.";
    const isLiveAccessBlocked = joinErrorMessage.includes("لم تقم بالدفع");
    const isSubscriptionExpiredBlocked = joinErrorMessage.includes("انتهت فترة اشتراك التلميذ");
    const deniedSubject = joinErrorMessage.includes("فيزياء")
      ? "PHYSICS"
      : joinErrorMessage.includes("رياضيات")
        ? "MATH"
        : null;
    const isSubscriptionUpgradeBlocked =
      joinErrorMessage.includes("مخصصة لأصحاب الاشتراك المدفوع") || Boolean(deniedSubject);
    const isIdentityBlocked =
      joinErrorMessage.includes("انتظار تأكيد هوية البطاقة") ||
      joinErrorMessage.includes("رفع بطاقة جديدة");
    const isTemporaryRecovery = rejoin || isRecoveringStream || joinErrorMessage.includes("يعيد الاتصال");

    if (
      isTemporaryRecovery &&
      !isLiveAccessBlocked &&
      !isSubscriptionUpgradeBlocked &&
      !isIdentityBlocked &&
      !isSubscriptionExpiredBlocked &&
      recoveryAttempts < MAX_RECOVERY_ATTEMPTS
    ) {
      recoveryAttempts += 1;
      joinedClass = true;
      isRecoveringStream = true;
      setStudentSessionActive(true);
      elements.joinButton.hidden = true;
      setViewerStatus("الأستاذ يعيد الاتصال. جارٍ إعادة المحاولة تلقائياً…", "warning");
      showConnectionOverlay("الأستاذ يعيد الاتصال. جارٍ إعادة المحاولة تلقائياً…", "warning");
      scheduleClassRecovery(Math.min(1_000 * (2 ** recoveryAttempts), 8_000));
      return;
    }

    joinedClass = false;
    isRecoveringStream = false;
    setStudentSessionActive(false);

    // `room_unavailable` already switches the page into its automatic waiting
    // lobby. Do not overwrite that state with a manual join button here.
    if (waitingForNextClass) {
      return;
    }

    updateChatControls();
    setViewerStatus(joinErrorMessage, "error");
    setPlaceholder(
      isSubscriptionExpiredBlocked
        ? "انتهت فترة الاشتراك"
        : isSubscriptionUpgradeBlocked
          ? "ترقية الاشتراك مطلوبة"
          : isLiveAccessBlocked || isIdentityBlocked
            ? "دخول الحصة غير متاح"
            : "الحصة غير متاحة",
      isLiveAccessBlocked || isSubscriptionUpgradeBlocked || isIdentityBlocked || isSubscriptionExpiredBlocked
        ? joinErrorMessage
        : "بانتظار بدء الأستاذ للحصة تلقائياً."
    );

    if (isSubscriptionExpiredBlocked) {
      openSubscriptionUpgradeModal("EXPIRED");
      return;
    }

    if (isSubscriptionUpgradeBlocked) {
      openSubscriptionUpgradeModal(deniedSubject || "university");
      return;
    }

    if (!isLiveAccessBlocked && !isIdentityBlocked && !isSubscriptionExpiredBlocked) {
      waitForNextLiveClass("الحصة غير نشطة الآن. ستنضم تلقائياً عند بدء الأستاذ للحصة.");
    }
  }
}

function raiseHand() {
  if (!joinedClass) {
    showMobileControlToast("يعمل رفع اليد بعد الانضمام إلى الحصة.");
    return;
  }
  if (!socket.connected) {
    showMobileControlToast("الاتصال بالخادم غير متاح حالياً.");
    return;
  }
  if (isRecoveringStream || isJoining) {
    showMobileControlToast("انتظر اكتمال اتصال الحصة ثم حاول مرة أخرى.");
    return;
  }

  clearHandResetTimer();
  setRaisedHandState({ waiting: true });
  setViewerStatus("تم إرسال طلب التحدث إلى الأستاذ.", "warning");

  const studentDisplayName =
    currentStudent?.studentName || currentStudent?.name || currentStudent?.fullName || studentName;
  socket.emit("student_raise_hand", {
    level,
    studentName: studentDisplayName,
    name: studentDisplayName,
    studentId: currentStudent?.id || studentId,
  }, (response) => {
    if (!response?.ok) {
      setRaisedHandState({ waiting: false });
      setViewerStatus(
        response?.message || response?.error || "تعذر إرسال طلب التحدث.",
        "error"
      );
      return;
    }

    // يبقى الطلب ظاهراً حتى يوافق الأستاذ أو يختار التلميذ «تنزيل اليد».
  });
}

function lowerHand() {
  if (!joinedClass || !socket.connected) {
    return;
  }

  clearHandResetTimer();
  setRaisedHandState({ waiting: false });
  socket.emit("student_lower_hand", { level }, () => { });
  setViewerStatus("تم تنزيل اليد. يمكنك رفعها من جديد عند الحاجة.", "neutral");
}

// --- Socket.io classroom and direct signaling events. ---

socket.on("connect", () => {
  void syncTeacherAbsence();
  if (didLoseSocketConnection) {
    didLoseSocketConnection = false;
    if (joinedClass || isRecoveringStream) {
      setViewerStatus("عاد الاتصال بالخادم. جارٍ استعادة الحصة تلقائياً…", "warning");
      scheduleClassRecovery(250);
      return;
    }
  }

  if (waitingForNextClass) {
    waitForNextLiveClass();
    return;
  }

  if ((initialAutoJoinPending || directClassEntryRequested) && !joinedClass && !isJoining) {
    elements.joinButton.hidden = true;
    setViewerStatus("جارٍ الدخول إلى الحصة مباشرة…", "warning");
    void joinClass();
    return;
  }

  if (!joinedClass && !isJoining) {
    setViewerStatus("جاهز للانضمام", "neutral");
  }
});

socket.on("connect_error", () => {
  setViewerStatus("تعذر الاتصال بخادم الحصص المباشرة.", "error");
});

socket.on("room_joined", (data = {}) => {
  if (data.role === "student") {
    if (data.sessionId && window.minasatyClassroomSession?.sessionId && data.sessionId !== window.minasatyClassroomSession.sessionId) {
      disconnectStudentSfu({ notify: false });
    }
    window.minasatyClassroomSession = { level: data.classroomLevel || data.level, sessionId: data.sessionId || null };
    if (!microphonePermissionGranted) {
      if (localAudioStream) {
        localAudioStream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      updateMicControl();
    }
    globalFreeClass = Boolean(data.globalFree);
    waitingForNextClass = false;
    studentClassJoinedAt = Date.now();
    teacherSocketId = data.teacherSocketId || teacherSocketId;
    if (data.teacherId) {
      knownTeacherIdentity = String(data.teacherId);
    }
    screenShareActive = Boolean(data.screenShareActive);
    if (data.teacherMicActive === false) {
      teacherMicMutedNoticeDismissed = false;
      setTeacherMicMutedState(true);
    } else {
      setTeacherMicMutedState(false);
    }
    setParticipationCount(data.participationCount);
    updateRemoteVideoPresentation();
    setStudentVideoQuality(currentVideoQuality, { notifyServer: true, showToast: false });
    notifyNativeLiveService("start", {
      title: elements.classLevelLabel?.textContent || "الحصة المباشرة",
      teacher: "أكاديمية التفوق"
    });
    if (typeof ensureTeacherAudioPlayback === "function") {
      void ensureTeacherAudioPlayback({ sourceHint: "room_joined" });
    }
    requestInitialP2pPreview();
    void connectStudentSfu(data.classroomLevel || data.level, { backgroundRetry: true });
    window.setTimeout(() => {
      const hasP2p = hasLiveP2pTeacherMedia();
      const hasSfu = isStudentSfuConnected() && (teacherSfuPlaybackTracks.size > 0 || (typeof getTeacherSfuReceptionState === "function" && getTeacherSfuReceptionState().receiving));
      if (joinedClass && !hasP2p && !hasSfu && !isStudentSfuConnected() && !isStudentSfuConnecting) {
        console.info("[SFU-Student] No media received after grace period (7s); requesting stream refresh while keeping SFU active.");
        requestTargetedP2pFallback("No media after grace period", { holdSfu: false });
      }
    }, 7000);
  }
});


function clearScreenShareRefreshGuard() {
  screenShareRefreshScheduled = false;
}

function scheduleScreenSharePageRefresh() {
  if (!joinedClass || screenShareRefreshScheduled) return;

  // Screen-share state is applied in-place. Reloading the page would destroy
  // the WebSocket and RTCPeerConnection and can turn a healthy stream black.
  screenShareRefreshScheduled = true;
  showMobileControlToast("بدأ الأستاذ مشاركة الشاشة. تم تحديث العرض دون إعادة تحميل الصفحة.");
}

function showScreenShareNotice(revision = 0) {
  if (!elements.screenShareNotice) return;
  const hasLiveVideo = Boolean(
    remoteMediaStream?.getVideoTracks?.().some((track) => track.readyState === "live")
  );
  if (hasLiveVideo || joinedClass) {
    elements.screenShareNotice.hidden = true;
    void elements.remoteVideo.play().catch(() => { });
    return;
  }
  if (revision > 0 && elements.screenShareNotice.dataset.revision === String(revision)) return;
  elements.screenShareNotice.dataset.revision = revision > 0 ? String(revision) : "";
  elements.screenShareNotice.hidden = false;
  elements.screenShareWatchButton?.focus({ preventScroll: true });
}

function hideScreenShareNotice() {
  if (!elements.screenShareNotice) return;
  elements.screenShareNotice.hidden = true;
}

function watchCurrentScreenShare() {
  hideScreenShareNotice();
  refreshAudioVideo();
}

let lastLiveAccessRefreshAt = 0;

function handleLiveAccessActivation(data = {}) {
  if (String(data.studentId || "") !== String(studentId || "")) return;

  if (data.subscriptionEndDate && currentStudent) {
    currentStudent.subscriptionEndDate = data.subscriptionEndDate;
  }
  if (data.liveAccessEnabled !== undefined && currentStudent) {
    currentStudent.liveAccessEnabled = data.liveAccessEnabled;
  }
  if (data.paymentStage && currentStudent) {
    currentStudent.paymentStage = data.paymentStage;
  }
  if (data.paymentStatus !== undefined && currentStudent) {
    currentStudent.paymentStatus = data.paymentStatus;
  }

  try {
    for (const key of ["student", "currentStudent", "loggedInStudent"]) {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (String(parsed.id || "") === String(studentId || "")) {
          if (data.subscriptionEndDate) parsed.subscriptionEndDate = data.subscriptionEndDate;
          if (data.liveAccessEnabled !== undefined) parsed.liveAccessEnabled = data.liveAccessEnabled;
          if (data.paymentStage) parsed.paymentStage = data.paymentStage;
          if (data.paymentStatus !== undefined) parsed.paymentStatus = data.paymentStatus;
          sessionStorage.setItem(key, JSON.stringify(parsed));
        }
      }
    }
  } catch (_) {}

  const accessGranted =
    data.liveAccessEnabled === true ||
    data.paymentStatus === true ||
    data.paymentStage === "PAID" ||
    (data.subscriptionEndDate && !isStudentLiveSubscriptionExpired(data.subscriptionEndDate));

  if (accessGranted) {
    closeSubscriptionUpgradeModal();
  }

  if (!joinedClass || isJoining || isRecoveringStream) {
    if (accessGranted && !joinedClass && !isJoining) {
      void joinClassroomRoom();
    }
    return;
  }

  if (!accessGranted) return;

  const now = Date.now();
  if (now - lastLiveAccessRefreshAt < 1_500) return;
  lastLiveAccessRefreshAt = now;
  beginStreamRecovery("تم تفعيل دخولك إلى الحصة. جارٍ تحديث الصوت والصورة تلقائيًا…");
}

socket.on("student_live_access_updated", handleLiveAccessActivation);
socket.on("student_account_status_updated", handleLiveAccessActivation);
socket.on("student_payment_receipt_updated", handleLiveAccessActivation);

socket.on("teacher_absence_updated", (data = {}) => {
  const eventLevel = canonicalLevel(data.level);
  if (!eventLevel || eventLevel !== level) return;
  renderTeacherAbsenceNotice(data.isAbsent === true);
});

socket.on("teacher_mic_state", (data = {}) => {
  if (!globalFreeClass && data.level && data.level !== level) return;
  const isMuted = data.active === false;
  if (isMuted) {
    teacherMicMutedNoticeDismissed = false;
  }
  setTeacherMicMutedState(isMuted);
});

socket.on("screen_share_state", (data = {}) => {
  if (!globalFreeClass && data.level !== level) return;
  const revision = Number(data.revision) || 0;
  if (revision > 0 && revision <= lastScreenShareRevision) return;
  if (revision > 0) lastScreenShareRevision = revision;
  const wasScreenShareActive = screenShareActive;
  screenShareActive = Boolean(data.active);
  updateRemoteVideoPresentation();
  if (screenShareActive) {
    setViewerStatus("جارٍ عرض شاشة الأستاذ…", "live");
    void elements.remoteVideo.play().catch(() => { });
    if (!wasScreenShareActive) {
      showScreenShareNotice(revision);
      scheduleScreenSharePageRefresh();
    }
  } else {
    clearScreenShareRefreshGuard();
    hideScreenShareNotice();
    if (joinedClass) {
      setViewerStatus("صوت الأستاذ متصل. بانتظار مشاركة الشاشة…", "live");
    }
  }
});

// Passive waiting viewers receive this from their level lobby when the teacher
// starts the next class. Rejoin occurs inside the current page with no button.
socket.on("live_class_started", (data = {}) => {
  if (data.globalFree || data.level === level) {
    showLiveStartNotice(data);
    joinClassAutomaticallyFromLobby();
  }
});

socket.on("live_class_resumed", (data = {}) => {
  if (data.globalFree || data.level === level) {
    showLiveStartNotice(data, true);
    joinClassAutomaticallyFromLobby();
  }
});

socket.on("participation_count_updated", (data = {}) => {
  if (joinedClass || globalFreeClass || data.level === level) {
    setParticipationCount(data.count);
  }
});

socket.on("reaction_points_updated", (data = {}) => {
  if (joinedClass || globalFreeClass || data.level === level) {
    setStudentPointsCount(data.points);
  }
});

socket.on("classroom_chat_history", (data = {}) => {
  if (!joinedClass || data.level !== level) return;
  void restoreStudentChatHistory(data.messages);
});

socket.on("teacher_message_received", async (data = {}) => {
  const imageData = data?.imageData || data?.imageUrl || null;
  if (!joinedClass || (!data?.message && !imageData && !data?.imageId)) {
    return;
  }

  const imageUrl = imageData || (data.imageId ? await loadTeacherAnswerImage(data.imageId).catch(() => null) : null);
  if (!joinedClass) return;

  appendStudentChatMessage({
    id: data.id,
    sender: "الأستاذ",
    kind: "teacher",
    imageUrl,
    imageId: data.imageId || null,
    imageName: data.imageName || "",
    message: !imageData && data.imageId && !imageUrl && !data.message
      ? "تعذر تحميل الصورة المرفقة. حاول فتح الحصة من جديد."
      : (data.message || ""),
    reactions: data.reactions || null,
  });
});

socket.on("classroom_chat_reaction_updated", (data = {}) => {
  if (!joinedClass) return;
  updateStudentMessageReactions(data);
});

socket.on("teacher_reacted_to_message", (data = {}) => {
  if (!joinedClass) return;
  const reactionConfig = {
    fire: { emoji: "🔥", label: "نار وتميز", points: 5 },
    love: { emoji: "❤️", label: "إعجاب وتشجيع", points: 3 },
    like: { emoji: "👍", label: "أحسنت", points: 2 },
    cry: { emoji: "😭", label: "بكاء", points: 0 },
    dislike: { emoji: "👎", label: "تنبيه", points: -1 },
  };

  const info = reactionConfig[data.reaction] || { emoji: "⭐", label: "تفاعل", points: data.points || 0 };
  const emoji = info.emoji;

  if (typeof data.totalPoints === "number") {
    setStudentPointsCount(data.totalPoints);
  }

  const targetBubble = data.messageId ? document.querySelector(`.student-chat-message[data-message-id="${data.messageId}"]`) : null;
  if (targetBubble) {
    showStudentFloatingReaction(targetBubble, emoji);
    const pillsWrap = targetBubble.querySelector(`.student-chat-reactions-pills`);
    if (pillsWrap && data.reaction) {
      const teacherReactedObj = {};
      teacherReactedObj[data.reaction] = Boolean(data.toggledOn !== false);
      renderStudentReactionPills(pillsWrap, {
        [data.reaction]: 1,
        teacherReacted: teacherReactedObj,
        isTeacherReactor: true,
      }, data.messageId);
    }
  } else if (elements.chatBox) {
    showStudentFloatingReaction(elements.chatBox, emoji);
  }

  const delta = Number(data.points) || 0;
  const isToggledOn = data.toggledOn !== false;
  let toastMsg = "";

  if (isToggledOn) {
    if (delta > 0) {
      toastMsg = `${emoji} تفاعل المعلم مع إجابتك: +${delta} نقاط! (مجموع نقاطك: ${data.totalPoints ?? studentPointsTotal})`;
    } else if (delta < 0) {
      toastMsg = `${emoji} تفاعل المعلم مع إجابتك: ${delta} نقطة (مجموع نقاطك: ${data.totalPoints ?? studentPointsTotal})`;
    } else {
      toastMsg = `${emoji} تفاعل المعلم مع إجابتك (مجموع نقاطك: ${data.totalPoints ?? studentPointsTotal})`;
    }
  } else {
    toastMsg = `تم إلغاء تفاعل المعلم (${emoji}) • مجموع نقاطك: ${data.totalPoints ?? studentPointsTotal}`;
  }

  if (typeof showMobileControlToast === "function") {
    showMobileControlToast(toastMsg);
  }
});

socket.on("room_unavailable", (data = {}) => {
  hideLiveStartNotice();
  resetViewerState({
    message: data.message || "لا توجد حصة مباشرة نشطة لهذا المستوى حالياً.",
    mode: "neutral",
    showJoin: false,
  });
  waitForNextLiveClass("لا توجد حصة الآن. ستفتح تلقائياً عند بدء الأستاذ للحصة.");
});

/**
 * Exact WebRTC viewer answer sequence: build a connection, set the teacher's
 * offer as remote SDP, set an answer as local SDP, then relay the answer to the
 * only authorized remote peer: `fromSocketId`.
 */
socket.on("classroom_track_state", (data = {}) => {
  if (!joinedClass || data.type !== "student_audio") {
    return;
  }

  // Every joined viewer resumes received audio on the server-owned mic-open signal.
  // Existing video and transport connections remain in place.
  if (data.enabled) {
    setViewerStatus("جارٍ توصيل صوت تلميذ بالحصة…", "live");
    void refreshClassroomAudioOnly({ sourceHint: "classroom_student_mic_opened" });
  }
});

socket.on("webrtc_offer", async (data = {}) => {
  const { fromSocketId, sdp, negotiationId } = data;

  if (!joinedClass || !fromSocketId || !sdp) {
    return;
  }

  try {
    let peerConnection = pc;
    const isSamePeer = Boolean(
      pc &&
      teacherSocketId === fromSocketId &&
      pc.connectionState !== "closed"
    );

    if (isSamePeer) {
      // Handle offer collision as polite peer (Perfect Negotiation pattern):
      // If we made a local renegotiation offer, roll it back instead of closing
      // the peer connection. Closing the peer connection would terminate the active
      // teacher audio receiver track!
      if (peerConnection.signalingState === "have-local-offer") {
        try {
          console.info("[WebRTC-Student] Offer collision detected; rolling back local offer as polite peer.");
          recordStudentDiagnosticEvent("offer_collision_rollback", "Rolled back local offer on teacher offer collision");
          await peerConnection.setLocalDescription({ type: "rollback" });
        } catch (rollbackErr) {
          console.warn("[WebRTC-Student] Rollback failed on teacher offer collision:", rollbackErr);
        }
      }
      if (peerConnection.signalingState !== "stable") {
        console.warn("[WebRTC-Student] Connection not stable after collision handling; recreating peer connection as fallback.");
        peerConnection = createViewerPeerConnection();
      }
    } else {
      peerConnection = createViewerPeerConnection();
    }
    teacherSocketId = fromSocketId;

    // ICE restarts arrive as a fresh teacher offer. Reusing the existing peer
    // preserves the rendered screen and audio instead of briefly blanking the
    // classroom while the network route is recovered.
    if (typeof window.getMinasatyRtcConfig === "function") {
      Object.assign(rtcConfig, await window.getMinasatyRtcConfig());
      if (pc !== peerConnection) return;
      if (typeof peerConnection.setConfiguration === "function") peerConnection.setConfiguration(rtcConfig);
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingIceCandidates();

    const answer = await peerConnection.createAnswer();
    const optimizedSdp = optimizeOpusSdp(answer.sdp);
    await peerConnection.setLocalDescription(new RTCSessionDescription({ type: answer.type, sdp: optimizedSdp }));

    await emitWithAcknowledgement("webrtc_answer", {
      targetSocketId: teacherSocketId,
      sdp: peerConnection.localDescription,
      negotiationId,
    });

    if (typeof ensureTeacherAudioPlayback === "function") {
      await ensureTeacherAudioPlayback({ sourceHint: "webrtc_offer_complete" });
    }

    // A permission event can theoretically arrive before the direct offer.
    // In that rare case, request and attach the mic after the initial answer.
    if (microphonePermissionGranted) {
      await enableApprovedMicrophone();
    }
  } catch (error) {
    console.error("Unable to answer teacher WebRTC offer:", error);
    beginStreamRecovery("تعذر اتصال البث. جارٍ إعادة المحاولة تلقائياً…");
  }
});

socket.on("webrtc_ice_candidate", async (data = {}) => {
  const { fromSocketId, candidate } = data;

  // Discard any unexpected candidate rather than accepting signaling from an
  // unrecognized client. This preserves the one-teacher viewer topology.
  if (!fromSocketId || (teacherSocketId && fromSocketId !== teacherSocketId)) {
    return;
  }

  if (!pc || !pc.remoteDescription) {
    pendingIceCandidates.push(candidate);
    return;
  }

  try {
    if (candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.warn("Unable to add teacher ICE candidate:", error);
  }
});

socket.on("webrtc_renegotiation_answer", async (data = {}) => {
  const { fromSocketId, sdp } = data;

  if (!pc || !sdp || fromSocketId !== teacherSocketId) {
    return;
  }

  try {
    if (pc.signalingState !== "have-local-offer") {
      console.warn("[WebRTC-Student] Ignoring renegotiation answer; signalingState is:", pc.signalingState);
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingIceCandidates();
    microphoneNegotiated = true;
    microphoneOfferSent = true;
    updateMicControl();
    setViewerStatus("صوت المايك متصل بالحصة.", "live");
    if (typeof ensureTeacherAudioPlayback === "function") {
      await ensureTeacherAudioPlayback({ sourceHint: "renegotiation_answer" });
    }
  } catch (error) {
    console.error("Unable to apply microphone renegotiation answer:", error);
    setViewerStatus("تعذر تشغيل صوت المايك مع الحصة.", "error");
  }
});

socket.on("permission_granted", async () => {
  window.LiveDoctor?.report("microphone_permission_received");
  if (!joinedClass) {
    return;
  }

  playMicOpenedAlert();

  microphonePermissionGranted = true;
  studentMicrophoneSelfClosed = false;
  clearHandResetTimer();
  // Resolve the student's request immediately and switch button to active microphone indicator.
  setRaisedHandState({ waiting: false });
  elements.raiseHandButton.hidden = false;
  elements.handWaitingActions.hidden = true;
  updateMicControl();

  // Ensure teacher audio continues playing before and after microphone acquisition
  if (typeof ensureTeacherAudioPlayback === "function") {
    await ensureTeacherAudioPlayback({ sourceHint: "permission_granted_start" });
  }

  await enableApprovedMicrophone();

  if (typeof ensureTeacherAudioPlayback === "function") {
    await ensureTeacherAudioPlayback({ sourceHint: "permission_granted_complete" });
  }
});

socket.on("microphone_revoked", (data = {}) => {
  window.LiveDoctor?.report("microphone_revoked");
  clearHandResetTimer();
  microphonePermissionGranted = false;
  isMakingRenegotiationOffer = false;
  microphoneOfferSent = false;
  microphoneNegotiated = false;
  unpublishStudentSfuMic();
  unpublishStudentP2pMic();

  const audioTrack = localAudioStream?.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = false;
  }
  setRaisedHandState({ waiting: false });
  elements.handWaitingActions.hidden = true;
  updateMicControl();
  setViewerStatus(data.reason === "student_self_mute" ? "ميكروفونك مغلق. يمكنك رفع اليد لطلب الكلام." : "أغلق الأستاذ المايك. يمكنك رفع اليد عند الحاجة.", "neutral");

  // Keep teacher playback intact
  if (typeof ensureTeacherAudioPlayback === "function") {
    void ensureTeacherAudioPlayback({ sourceHint: "microphone_revoked" });
  }
});

socket.on("classroom_all_mics_muted", () => {
  clearHandResetTimer();
  microphonePermissionGranted = false;
  isMakingRenegotiationOffer = false;
  microphoneOfferSent = false;
  microphoneNegotiated = false;
  unpublishStudentSfuMic();
  unpublishStudentP2pMic();

  if (localAudioStream) {
    localAudioStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }

  setRaisedHandState({ waiting: false });
  elements.handWaitingActions.hidden = true;
  updateMicControl();
  setViewerStatus("أغلق الأستاذ ميكروفونات جميع التلاميذ.", "neutral");

  // Keep teacher playback intact
  if (typeof ensureTeacherAudioPlayback === "function") {
    void ensureTeacherAudioPlayback({ sourceHint: "classroom_all_mics_muted" });
  }
});

if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === "function") {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    console.info("[Audio-Devices] Audio/media device change detected; verifying teacher playback.");
    recordStudentDiagnosticEvent("audio_device_change", "Audio input/output device changed");
    if (typeof ensureTeacherAudioPlayback === "function") {
      void ensureTeacherAudioPlayback({ sourceHint: "devicechange" });
    }
  });
}

async function handleImplicitMediaResync(sourceHint = "teacher_force_resync") {
  console.info(`[Resync] Executing implicit background media resync (source: ${sourceHint}).`);

  // 1. Audio restoration is priority #1: ensure teacher audio is unmuted, resumed and playing
  try {
    if (typeof refreshClassroomAudioOnly === "function") {
      await refreshClassroomAudioOnly({ sourceHint });
    }
    if (typeof ensureTeacherAudioPlayback === "function") {
      await ensureTeacherAudioPlayback({ sourceHint });
    }
    if (typeof syncClassmateSfuAudioPlayback === "function") {
      syncClassmateSfuAudioPlayback();
    }
    if (typeof classroomAudioContext !== "undefined" && classroomAudioContext && classroomAudioContext.state === "suspended") {
      await classroomAudioContext.resume().catch(() => {});
    }
    const audioEl = elements.teacherAudioElement || document.getElementById("teacher-live-audio");
    if (audioEl && audioEl.paused && audioEl.srcObject) {
      audioEl.play().catch(() => {});
    }
    // Re-verify student mic tracks if permitted and open
    if (typeof localAudioStream !== "undefined" && localAudioStream && typeof microphonePermissionGranted !== "undefined" && microphonePermissionGranted) {
      localAudioStream.getAudioTracks().forEach((track) => {
        if (track.readyState === "live") track.enabled = true;
      });
      if (pc && typeof publishStudentP2pMic === "function") {
        const liveTrack = localAudioStream.getAudioTracks().find((track) => track.readyState === "live");
        if (liveTrack) void publishStudentP2pMic(liveTrack, localAudioStream);
      }
    }
  } catch (audioErr) {
    console.warn("[Resync] Audio verification warning:", audioErr);
  }

  // 2. Video and Media Routing: Attempt LiveKit first, then fallback to P2P smoothly in background
  try {
    const sfuConnected = typeof isStudentSfuConnected === "function" && isStudentSfuConnected();
    const sfuHealthy = typeof isStudentSfuHealthy === "function" && isStudentSfuHealthy();

    if (sfuConnected && sfuHealthy) {
      console.info("[Resync] Student is already connected and healthy on LiveKit SFU.");
      if (typeof teacherSfuVideoStream !== "undefined" && teacherSfuVideoStream && elements.remoteVideo) {
        if (elements.remoteVideo.srcObject !== teacherSfuVideoStream) {
          elements.remoteVideo.srcObject = teacherSfuVideoStream;
        }
        if (elements.remoteVideo.paused) {
          elements.remoteVideo.play().catch(() => {});
        }
      }
      hideConnectionOverlay();
      setViewerStatus("البث المباشر مستمر", "live");
      return;
    }

    // If not connected or not healthy on SFU, attempt background LiveKit connect first
    const roomToJoin = (typeof activeLevel !== "undefined" ? activeLevel : "") || (typeof level !== "undefined" ? level : "") || "";
    if (roomToJoin && typeof connectStudentSfu === "function") {
      console.info("[Resync] Attempting LiveKit SFU connection in background...");
      const sfuResult = await connectStudentSfu(roomToJoin, { backgroundRetry: true }).catch(() => false);
      if (sfuResult && typeof isStudentSfuHealthy === "function" && isStudentSfuHealthy()) {
        console.info("[Resync] LiveKit SFU connected and healthy in background.");
        if (typeof teacherSfuVideoStream !== "undefined" && teacherSfuVideoStream && elements.remoteVideo) {
          elements.remoteVideo.srcObject = teacherSfuVideoStream;
          elements.remoteVideo.play().catch(() => {});
        }
        hideConnectionOverlay();
        setViewerStatus("البث المباشر مستمر", "live");
        return;
      }
    }

    // If LiveKit is unavailable or unhealthy, smoothly fall back to P2P in the background
    console.info("[Resync] Falling back to targeted P2P stream in background...");
    if (typeof requestTargetedP2pFallback === "function") {
      requestTargetedP2pFallback("teacher_implicit_resync", { holdSfu: false });
    }

    const p2pStream = (typeof remoteMediaStream !== "undefined" && remoteMediaStream) ? remoteMediaStream : (typeof remoteStream !== "undefined" ? remoteStream : null);
    if (elements.remoteVideo && p2pStream) {
      if (elements.remoteVideo.srcObject !== p2pStream) {
        elements.remoteVideo.srcObject = p2pStream;
      }
      if (elements.remoteVideo.paused) {
        elements.remoteVideo.play().catch(() => {});
      }
    }
    hideConnectionOverlay();
    setViewerStatus("البث المباشر مستمر", "live");
  } catch (mediaErr) {
    console.warn("[Resync] Media resync warning:", mediaErr);
  }
}

socket.on("classroom_force_reload", () => {
  // Never reload or disconnect an active learner session; resync silently in background!
  if (joinedClass) {
    console.info("[Resync] Intercepted force reload for active class; performing silent background media resync instead.");
    void handleImplicitMediaResync("classroom_force_reload");
    return;
  }
  console.info("Teacher requested full page reload.");
  window.location.reload();
});

socket.on("classroom_force_resync", async (data = {}) => {
  if (data && (data.reload || data.hardReload) && !joinedClass) {
    console.info("Teacher requested hard resync/reload of student page.");
    window.location.reload();
    return;
  }
  console.info("[Resync] Teacher requested background audio and stream resync for student.");
  void handleImplicitMediaResync("teacher_force_resync");
});

socket.on("teacher_reconnecting", () => {
  beginStreamRecovery("غادر الأستاذ الاستوديو أو انقطع اتصاله. الحصة محفوظة وجارٍ انتظار عودته تلقائياً…");
});

socket.on("teacher_reconnected", () => {
  beginStreamRecovery("عاد الأستاذ. جارٍ ربط البث من جديد…");
  scheduleClassRecovery(100);
});

socket.on("room_recovering", (data = {}) => {
  beginStreamRecovery(data.message || "الحصة محفوظة. جارٍ انتظار عودة الأستاذ دون تحديث الصفحة…");
});

socket.on("teacher_disconnected", () => {
  beginStreamRecovery("انقطع اتصال الأستاذ. الحصة محفوظة وجارٍ الانتظار دون تحديث الصفحة…");
});

socket.on("class_ended", (data = {}) => {
  window.minasatyClassroomSession = null;
  notifyNativeLiveService("stop");
  hideLiveStartNotice();
  const teacherDisconnected = data.reason === "teacher_disconnected";

  resetViewerState({
    message: teacherDisconnected
      ? "انقطع اتصال الأستاذ، لذلك أُغلقت الحصة."
      : "أنهى الأستاذ الحصة المباشرة.",
    mode: "neutral",
    showJoin: false,
  });

  if (teacherDisconnected) {
    showConnectionOverlay("انقطع اتصال الأستاذ. جاري الانتظار...");
  } else {
    hideConnectionOverlay();
  }

  waitForNextLiveClass("انتهت الحصة. ستفتح الحصة التالية تلقائياً عند بدء الأستاذ.");
});

socket.on("class_ended_by_teacher", () => {
  notifyNativeLiveService("stop");
  hideLiveStartNotice();
  resetViewerState({
    message: "انتهت الحصة المباشرة.. شكراً لحضوركم وتفاعلكم!",
    mode: "neutral",
    showJoin: false,
  });
  hideConnectionOverlay();
  waitForNextLiveClass("انتهت الحصة المباشرة.. شكراً لحضوركم وتفاعلكم!");
});

socket.on("classroom_error", (data = {}) => {
  if (data.message) {
    setViewerStatus(data.message, "error");
    if (data.message.includes("انتهت فترة اشتراك")) {
      openSubscriptionUpgradeModal("EXPIRED");
    }
  }
});

socket.on("disconnect", () => {
  didLoseSocketConnection = true;

  if (joinedClass || isJoining || pc) {
    beginStreamRecovery("انقطع الاتصال بالخادم. جارٍ إعادة الاتصال تلقائياً…");
  }

  // Socket.io reconnects automatically; the connect handler asks the server
  // for a fresh WebRTC offer while preserving this same viewer page.
  showConnectionOverlay("انقطع الاتصال بالخادم. جارٍ إعادة الاتصال تلقائياً…", "warning");
});

// --- Viewer controls ---

// No manual join action is exposed in the viewer. The element is retained only
// for compatibility with existing page markup and remains hidden at all times.
relocateStudentPrejoinOverlay();
relocateStudentChatComposer();
if (!isDesktopStudentView() && prejoinCompleted) openStudentChatComposer({ focus: false });
elements.enableAudioButton?.addEventListener("click", enableTeacherAudio);
elements.dismissTeacherMicMuteBtn?.addEventListener("click", () => {
  teacherMicMutedNoticeDismissed = true;
  if (elements.teacherMicMuteBanner) {
    elements.teacherMicMuteBanner.hidden = true;
  }
});
elements.screenShareWatchButton?.addEventListener("click", watchCurrentScreenShare);
elements.remoteVideo?.addEventListener("volumechange", updateRemoteAudioControl);
elements.remoteVideo?.addEventListener("click", () => {
  void startTeacherAudio({ userInitiated: true });
});
elements.raiseHandButton.addEventListener("click", toggleRaisedHand);
elements.lowerHandButton?.addEventListener("click", lowerHand);
elements.chatForm.addEventListener("submit", sendStudentChatMessage);
elements.desktopChatDirectForm?.addEventListener("submit", sendStudentChatMessage);
elements.desktopChatInput?.addEventListener("input", updateChatControls);
elements.openChatComposeButton?.addEventListener("click", handleChatMessageButtonClick);
elements.closeChatComposeButton?.addEventListener("click", closeStudentChatComposer);
elements.chatComposeModal?.addEventListener("click", (event) => {
  if (event.target === elements.chatComposeModal) closeStudentChatComposer();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.chatComposeModal && !elements.chatComposeModal.hidden) {
    closeStudentChatComposer();
  }
  if (event.key === "Escape" && elements.screenShareNotice && !elements.screenShareNotice.hidden) {
    hideScreenShareNotice();
  }
});
elements.chatInput.addEventListener("input", updateChatControls);
elements.chatInput.addEventListener("focus", syncStudentKeyboardOffset);
elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.chatForm.requestSubmit();
  }
});
window.visualViewport?.addEventListener("resize", syncStudentKeyboardOffset);
window.visualViewport?.addEventListener("scroll", syncStudentKeyboardOffset);
window.addEventListener("resize", syncStudentKeyboardOffset);
elements.desktopChatInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.desktopChatDirectForm?.requestSubmit();
  }
});
elements.captureQuestionButton?.addEventListener("click", () => {
  if (!elements.captureQuestionButton.disabled) {
    elements.questionImageInput?.click();
  }
});
elements.questionImageInput?.addEventListener("change", () => {
  const file = elements.questionImageInput.files?.[0];
  if (!file) return;
  // Send the question photo directly to the teacher's Telegram Bot
  // without routing large binary images into the live broadcast room.
  sendStudentQuestionPhotoToTelegram(file);
});
elements.removeQuestionImageButton?.addEventListener("click", clearSelectedQuestionImage);
elements.refreshMediaButton?.addEventListener("click", refreshAudioVideo);
elements.prejoinMicButton?.addEventListener("click", async () => {
  const ready = await prepareStudentMicrophone();
  updatePrejoinControls(ready
    ? "الميكروفون جاهز. اضغط استمرار للدخول إلى الحصة."
    : "يجب السماح للمتصفح باستخدام الميكروفون قبل الاستمرار.");
});
elements.prejoinCameraButton?.addEventListener("click", testOptionalStudentCamera);
elements.prejoinContinueButton?.addEventListener("click", continueFromStudentPrejoin);
elements.subscriptionDeclineButton?.addEventListener("click", () => {
  closeSubscriptionUpgradeModal();
  window.location.assign("./parent-dashboard.html");
});
initializeMobileControls();
initializeDesktopFullscreen();
initializeStudentKeyboardLayout();
initializeQualitySelector();
initializeSignalFinder();
initializeStudentCalculator();
initializeStudentImageModal();

window.addEventListener("pagehide", () => {
  enableNativeSwipeRefresh();
  clearHandResetTimer();
  clearRecoveryTimer();
  clearSelectedQuestionImage();
  closeSubscriptionUpgradeModal();
  closeSignalFinderModal();
  closeStudentCalculatorModal();
  closeStudentImageModal();
  closePeerConnection();
  stopLocalAudio();
});

window.addEventListener("beforeunload", () => {
  enableNativeSwipeRefresh();
});

if (!studentId || !studentName || !level) {
  // The viewer must be entered from the authenticated parent flow, not by
  // manually opening the URL without the student identity/session context.
  window.location.replace("./parent-login.html");
} else {
  const levelDisplayLabels = {
    "السنة الأولى": "السنة الأولى متوسط",
    "السنة الثانية": "السنة الثانية متوسط",
    "السنة الثالثة": "السنة الثالثة متوسط",
    "السنة الرابعة": "السنة الرابعة متوسط",
    "طالب جامعي": "طالب جامعي",
  };
  elements.classLevelLabel.textContent = levelDisplayLabels[level] || level;
  if (elements.classSubjectLabel) elements.classSubjectLabel.textContent = "المادة";
  elements.exitClassButton?.addEventListener("click", exitLiveClass);
  setLevelWelcomeImage();
  if (prejoinCompleted || directClassEntryRequested) {
    setPlaceholder("جاري الدخول إلى الحصة", "سيظهر بث الأستاذ تلقائياً عند توفر الحصة.");
    setViewerStatus("جارٍ الدخول إلى الحصة…", "warning");
  } else {
    setPlaceholder("جاري تجهيز الدخول إلى الحصة", "ستظهر صورة مستواك وصوت الأستاذ بعد إكمال فحص الميكروفون.");
    setViewerStatus("بانتظار تجهيز الميكروفون…", "neutral");
  }
  updateMicControl();
  updateChatControls();
  void initializeStudentPrejoin();
  if (socket.connected && (directClassEntryRequested || initialAutoJoinPending) && !joinedClass && !isJoining) {
    void joinClass();
  }

  window.addEventListener("beforeunload", () => {
    notifyNativeLiveService("stop");
  });
  window.addEventListener("pagehide", () => {
    if (!joinedClass) {
      notifyNativeLiveService("stop");
    }
  });
}


window.setInterval(() => { void reportClassroomAudioReception().catch(() => {}); }, 3000);
window.setInterval(() => { void sampleTeacherP2pReception().catch(() => {}); }, 3000);

window.setInterval(() => {
  flushClassContinueRefresh();
  checkAutomaticMediaRefresh();
}, 2000);

window.LiveDoctor?.start({
  socket, active: () => joinedClass,
  snapshot: () => {
    const mic = localAudioStream?.getAudioTracks?.()[0];
    const sfu = getTeacherSfuReceptionState(), p2p = getTeacherP2pReceptionState();
    if (teacherAudioElement) window.LiveDoctor?.report("teacher_audio_playback_state", {
      paused: teacherAudioElement.paused, muted: teacherAudioElement.muted, readyState: teacherAudioElement.readyState,
    });
    return { signal: socket.connected, sfu: studentSfuRoom?.state || "absent",
      micApproved: microphonePermissionGranted, micPresent: Boolean(mic), micEnabled: Boolean(mic?.enabled),
      micMuted: Boolean(mic?.muted), micEnded: mic?.readyState === "ended", micPublished: Boolean(microphonePermissionGranted && mic?.readyState === "live" && mic.enabled && (studentSfuMicPub || studentP2pMicSender?.track === mic)),
      audioReceiving: sfu.receivingAudio || p2p.receivingAudio, videoReceiving: sfu.receivingVideo || p2p.receivingVideo,
      paused: Boolean(elements.remoteVideo?.paused), muted: Boolean(elements.remoteVideo?.muted), readyState: elements.remoteVideo?.readyState };
  },
  sources: () => {
    const sources = [];
    if (pc?.getStats) sources.push({ id: "p2p_teacher", stats: () => pc.getStats() });
    for (const participant of studentSfuRoom?.remoteParticipants?.values() || []) {
      if (getSfuParticipantRole(participant) !== "teacher") continue;
      for (const publication of participant.trackPublications.values()) {
        if (publication.track?.getRTCStatsReport) sources.push({ id: "sfu_" + publication.trackSid, stats: () => publication.track.getRTCStatsReport() });
      }
    }
    if (studentSfuMicPub?.track?.getRTCStatsReport) sources.push({ id: "sfu_microphone", stats: () => studentSfuMicPub.track.getRTCStatsReport() });
    return sources;
  },
});
