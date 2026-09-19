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
} catch (_) {}

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
      transports: ["polling", "websocket"],
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

// SFU (LiveKit Media Server) State for zero-lag 70+ student broadcasting
let studentSfuRoom = null;
let studentSfuMicPub = null;
let isStudentMicSyncing = false;
let isStudentSfuConnecting = false;
let currentStudentSfuRoomName = null;

async function connectStudentSfu(roomName) {
  if (typeof window.fetchMinasatySfuToken !== "function" || !window.LivekitClient?.Room) {
    console.info("[SFU-Student] LiveKit client or helper not available, using P2P.");
    return false;
  }
  if (!roomName) return false;

  if (studentSfuRoom && studentSfuRoom.state === "connected" && currentStudentSfuRoomName === roomName) {
    return true;
  }
  if (isStudentSfuConnecting && currentStudentSfuRoomName === roomName) {
    return true;
  }
  isStudentSfuConnecting = true;
  currentStudentSfuRoomName = roomName;

  try {
    const sfuData = await window.fetchMinasatySfuToken(roomName, false);
    const sfuUrl = sfuData?.url || sfuData?.serverUrl;
    if (!sfuData || !sfuData.enabled || !sfuData.token || !sfuUrl) {
      console.info("[SFU-Student] SFU not enabled by server, staying on P2P.");
      isStudentSfuConnecting = false;
      return false;
    }
    if (studentSfuRoom && currentStudentSfuRoomName !== roomName) {
      disconnectStudentSfu();
    }
    if (!studentSfuRoom || studentSfuRoom.state === "disconnected") {
      const Room = window.LivekitClient.Room;
      studentSfuRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      studentSfuRoom.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.info("[SFU-Student] Received teacher track via SFU:", track.kind);
        if (track.mediaStreamTrack) {
          attachTeacherTrack({ track: track.mediaStreamTrack });
        }
      });

      studentSfuRoom.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
        if (track.mediaStreamTrack && remoteMediaStream) {
          remoteMediaStream.removeTrack(track.mediaStreamTrack);
          updateRemoteVideoPresentation();
        }
      });

      studentSfuRoom.on(window.LivekitClient.RoomEvent.Disconnected, () => {
        console.warn("[SFU-Student] Disconnected from SFU room.");
      });
    }

    if (studentSfuRoom.state !== "connected") {
      await studentSfuRoom.connect(sfuUrl, sfuData.token);
    }
    console.info("[SFU-Student] Connected to LiveKit SFU room successfully:", roomName);
    return true;
  } catch (error) {
    if (String(error?.message).includes("Client initiated disconnect") || String(error?.message).includes("cancelled")) {
      return false;
    }
    console.warn("[SFU-Student] SFU connection failed, falling back to P2P:", error);
    return false;
  } finally {
    isStudentSfuConnecting = false;
  }
}

async function publishStudentSfuMic(audioStream) {
  if (!studentSfuRoom || studentSfuRoom.state !== "connected") return;
  const track = audioStream?.getAudioTracks?.()[0];
  if (!track || track.readyState !== "live") return;
  if (isStudentMicSyncing) return;
  isStudentMicSyncing = true;
  try {
    const allPubs = Array.from(studentSfuRoom.localParticipant?.trackPublications?.values() || []);
    const existingPub = (studentSfuMicPub && allPubs.includes(studentSfuMicPub))
      ? studentSfuMicPub
      : allPubs.find((pub) => pub.trackName === "student-mic" || pub.source === "microphone" || pub.kind === "audio");
    if (existingPub) {
      studentSfuMicPub = existingPub;
      const currentTrack = existingPub.track?.mediaStreamTrack;
      if (currentTrack === track || currentTrack?.id === track.id) {
        return;
      }
      if (existingPub.track && typeof existingPub.track.replaceTrack === "function") {
        try {
          await existingPub.track.replaceTrack(track);
        } catch (_) {
          try { await studentSfuRoom.localParticipant.unpublishTrack(existingPub.track); } catch (_) {}
          studentSfuMicPub = await studentSfuRoom.localParticipant.publishTrack(track, { name: "student-mic" });
        }
      } else {
        try { await studentSfuRoom.localParticipant.unpublishTrack(existingPub.track); } catch (_) {}
        studentSfuMicPub = await studentSfuRoom.localParticipant.publishTrack(track, { name: "student-mic" });
      }
    } else {
      studentSfuMicPub = await studentSfuRoom.localParticipant.publishTrack(track, {
        name: "student-mic",
      });
    }
  } catch (e) {
    if (e?.name === "TrackInvalidError" || String(e?.message).includes("already been published")) {
      return;
    }
    console.warn("[SFU-Student] Could not publish mic to SFU:", e);
  } finally {
    isStudentMicSyncing = false;
  }
}

function unpublishStudentSfuMic() {
  isStudentMicSyncing = false;
  if (studentSfuRoom && studentSfuMicPub) {
    try {
      if (studentSfuMicPub.track) {
        studentSfuRoom.localParticipant.unpublishTrack(studentSfuMicPub.track);
      }
    } catch (_) {}
    studentSfuMicPub = null;
  }
}

function disconnectStudentSfu() {
  isStudentSfuConnecting = false;
  currentStudentSfuRoomName = null;
  unpublishStudentSfuMic();
  if (studentSfuRoom) {
    try {
      if (studentSfuRoom.state !== "disconnected") {
        studentSfuRoom.disconnect();
      }
    } catch (_) {}
    studentSfuRoom = null;
  }
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

  const isSubjectUpgrade = reason === "PHYSICS" || reason === "MATH";
  const requiredSubject = reason === "PHYSICS" ? "الفيزياء" : "الرياضيات";
  const currentSubject = reason === "PHYSICS" ? "الرياضيات" : "الفيزياء";
  if (elements.subscriptionUpgradeTitle) {
    elements.subscriptionUpgradeTitle.textContent = isSubjectUpgrade
      ? `حصة اليوم ${requiredSubject}`
      : "هذه الحصة مخصصة للاشتراك المدفوع";
  }
  if (elements.subscriptionUpgradeHeadMessage) {
    elements.subscriptionUpgradeHeadMessage.textContent = isSubjectUpgrade
      ? `حصة اليوم ${requiredSubject} وأنت مشترك في ${currentSubject} فقط.`
      : "أنت مشترك في المجاني فقط وهذه الحصة المدفوعة الآن للطلبة ذوي الاشتراك المدفوع.";
  }
  if (elements.subscriptionUpgradeMessage) {
    elements.subscriptionUpgradeMessage.textContent = isSubjectUpgrade
      ? `إذا كنت تريد الاشتراك في ${requiredSubject}، اتصل بالأستاذ مباشرة على الرقم 0556960950.`
      : "للترقية إلى الاشتراك المدفوع، اضغط على الزر الأخضر واتصل بالأستاذ مباشرة على الرقم 0556960950.";
  }
  if (elements.subscriptionDeclineButton) {
    elements.subscriptionDeclineButton.textContent = isSubjectUpgrade
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
  };
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
  } catch (ignored) {}
  document.documentElement.classList.add("student-prejoin-completed-user");
}

function hasPermanentStudentPrejoinCompleted() {
  try {
    if (
      localStorage.getItem(STUDENT_PREJOIN_COMPLETED_KEY) === "true" ||
      localStorage.getItem(STUDENT_MIC_PERMISSION_STORAGE_KEY) === "granted" ||
      (studentId && localStorage.getItem(`${STUDENT_PREJOIN_COMPLETED_KEY}:${studentId}`) === "true")
    ) {
      return true;
    }
  } catch (error) {}

  try {
    if (
      document.cookie &&
      (document.cookie.includes("studentLivePrejoinCompleted=true") ||
       (studentId && document.cookie.includes(`studentLivePrejoin_${encodeURIComponent(studentId)}=true`)))
    ) {
      return true;
    }
  } catch (error) {}

  try {
    if (sessionStorage.getItem(STUDENT_PREJOIN_COMPLETED_KEY) === "true") {
      return true;
    }
  } catch (error) {}

  return document.documentElement.classList.contains("student-prejoin-completed-user");
}

prejoinCompleted = hasPermanentStudentPrejoinCompleted();
if (prejoinCompleted) {
  document.documentElement.classList.add("student-prejoin-completed-user");
}

// The classroom is entered from the parent dashboard. Once identity is known,
// keep the viewer hands-free even after a teacher ends and later restarts class.
initialAutoJoinPending = initialAutoJoinPending || Boolean(studentId && level) || prejoinCompleted;

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
  waitingForNextClass = true;
  joinedClass = false;
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

function refreshAudioVideo() {
  if (!joinedClass) {
    showMobileControlToast("يعمل تحديث الصوت والصورة بعد الانضمام إلى الحصة.");
    return;
  }
  if (isJoining || isRecoveringStream) {
    showMobileControlToast("جارٍ استعادة الحصة، انتظر لحظة ثم حاول مرة أخرى.");
    return;
  }
  if (!socket.connected) {
    showMobileControlToast("الاتصال بالخادم غير متاح حالياً.");
    return;
  }

  const button = elements.refreshMediaButton;
  if (!button || button.disabled) return;

  button.disabled = true;
  button.classList.add("is-refreshing");
  const label = button.querySelector(".refresh-media-label");
  if (label) label.textContent = "جارٍ تحديث الصوت والصورة…";
  showMobileControlToast("جارٍ تحديث الصوت والصورة دون مغادرة الحصة…");

  // Rebuild only the peer connection and request a fresh offer. Avoiding a
  // full-page reload prevents the mobile browser from showing a black screen.
  beginStreamRecovery("جارٍ استعادة الصوت والصورة دون تحديث الصفحة…");
  window.setTimeout(() => {
    button.disabled = false;
    button.classList.remove("is-refreshing");
    if (label) label.textContent = "تحديث الصوت والصورة";
  }, 1_500);
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
    } catch (_) {}
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
  } catch (_) {}

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
    const orientationController = screen.orientation;
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
    if (screen.orientation?.unlock) {
      try {
        screen.orientation.unlock();
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
  screen.orientation?.addEventListener?.("change", updateRotationControls);
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
  } catch {}
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
  } catch {}

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
        videoTrack.applyConstraints({ frameRate: { max: 15 } }).catch(() => {});
      } else if (normalized === "medium") {
        videoTrack.applyConstraints({ frameRate: { max: 30 } }).catch(() => {});
      } else {
        videoTrack.applyConstraints({ frameRate: { max: 60 } }).catch(() => {});
      }
    }
  } catch {}

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
    try { document.activeElement.blur(); } catch (e) {}
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
  let connName = "Wi-Fi";
  let isWifi = true;
  let isSim1 = false;
  let isSim2 = false;

  // 1. Check NetworkInformation API
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    const type = String(conn.type || "").toLowerCase();
    const eff = String(conn.effectiveType || "").toLowerCase();
    if (type.includes("wifi") || (!type && eff === "4g")) {
      connName = "Wi-Fi (5GHz)";
      isWifi = true;
      isSim1 = false;
    } else if (type.includes("cellular") || eff === "3g" || eff === "2g") {
      connName = "بيانات الهاتف (4G)";
      isWifi = false;
      isSim1 = true;
    } else {
      connName = "Wi-Fi";
      isWifi = true;
    }
    if (typeof conn.rtt === "number" && conn.rtt > 0) {
      rttMs = conn.rtt;
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
    } catch (_) {}
  } else {
    // Lightweight latency check fallback
    const t0 = performance.now();
    try {
      await fetch("/manifest.json?t=" + Date.now(), { method: "HEAD", cache: "no-store" });
      const diff = Math.round(performance.now() - t0);
      if (diff > 0 && diff < 1500) {
        rttMs = diff;
      }
    } catch (_) {}
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

  let s = rawExpr.trim();

  // Replace display symbols with standard arithmetic operators
  s = s.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  s = s.replace(/π/g, `(${Math.PI})`).replace(/\be\b/g, `(${Math.E})`);

  // Insert implicit multiplication: e.g. 2(3), )4, 5sin, )sin
  s = s.replace(/(\d)(\()/g, "$1*$2");
  s = s.replace(/(\))(\d)/g, "$1*$2");
  s = s.replace(/(\))(\()/g, "$1*$2");
  s = s.replace(/(\d)(sin|cos|tan|sqrt|abs)/g, "$1*$2");
  s = s.replace(/(\))(sin|cos|tan|sqrt|abs)/g, "$1*$2");

  // Percentage handling: e.g. 50% -> (50/100)
  s = s.replace(/(\d+(\.\d+)?)%/g, "($1/100)");

  // Powers: a^b -> a**b
  s = s.replace(/\^/g, "**");

  // Token parser / safe evaluator with functions in scope
  const mathScope = {
    sin: (x) => safeSin(x, angleMode),
    cos: (x) => safeCos(x, angleMode),
    tan: (x) => safeTan(x, angleMode),
    sqrt: (x) => safeSqrt(x),
    abs: (x) => Math.abs(x),
  };

  // Check for safe characters: only digits, parens, operators, and scope keys
  const sanitized = s.replace(/[a-zA-Z_]+/g, (id) => {
    if (Object.prototype.hasOwnProperty.call(mathScope, id)) {
      return `scope.${id}`;
    }
    throw new Error("رمز غير صالح");
  });

  const fn = new Function("scope", `"use strict"; return (${sanitized});`);
  const val = fn(mathScope);

  if (typeof val !== "number" || !Number.isFinite(val)) {
    if (Number.isNaN(val)) throw new Error("قيمة غير معرّفة");
    throw new Error("خطأ رياضي");
  }

  // Round floating point residue
  const rounded = Math.round(val * 1e11) / 1e11;
  return rounded;
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
    calcState.evaluated = true;
  } catch (err) {
    if (!silent) {
      calcState.result = err.message || "Math Error";
      const resEl = document.getElementById("calc-result");
      if (resEl) resEl.classList.add("is-error");
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
        if (calcState.evaluated && /\d/.test(insert) && !calcState.expression.endsWith("(")) {
          calcState.expression = "";
        }
        calcState.evaluated = false;
        calcState.expression += insert;
        calculateCalculatorResult(true);
      } else if (op !== undefined) {
        calcState.evaluated = false;
        const visualOp = op === "*" ? "×" : op === "/" ? "÷" : op === "-" ? "−" : "+";
        calcState.expression += visualOp;
        updateCalculatorDisplay();
      } else if (fn !== undefined) {
        if (fn === "frac") {
          // Fraction insertion: inserts division symbol or fraction template
          calcState.evaluated = false;
          calcState.expression += "÷";
          updateCalculatorDisplay();
        } else if (fn === "sd") {
          // S⇄D Fraction <-> Decimal toggle
          toggleFractionDisplay();
        } else if (fn === "sin" || fn === "cos" || fn === "tan" || fn === "sqrt" || fn === "abs") {
          if (calcState.evaluated) calcState.expression = "";
          calcState.evaluated = false;
          calcState.expression += `${fn}(`;
          updateCalculatorDisplay();
        } else if (fn === "square") {
          calcState.evaluated = false;
          calcState.expression += "^2";
          calculateCalculatorResult(true);
        } else if (fn === "pow") {
          calcState.evaluated = false;
          calcState.expression += "^";
          updateCalculatorDisplay();
        } else if (fn === "inv") {
          if (calcState.numericResult !== 0) {
            calcState.expression = `1/(${calcState.result})`;
            calculateCalculatorResult(false);
          }
        }
      } else if (action !== undefined) {
        if (action === "clear") {
          calcState.expression = "";
          calcState.result = "0";
          calcState.numericResult = 0;
          calcState.isFractionDisplay = false;
          calcState.evaluated = false;
          updateCalculatorDisplay();
        } else if (action === "backspace") {
          calcState.evaluated = false;
          calcState.expression = calcState.expression.slice(0, -1);
          calculateCalculatorResult(true);
        } else if (action === "negate") {
          if (calcState.expression) {
            if (calcState.expression.startsWith("-")) {
              calcState.expression = calcState.expression.slice(1);
            } else {
              calcState.expression = "-" + calcState.expression;
            }
          } else if (calcState.result !== "0") {
            calcState.numericResult = -calcState.numericResult;
            calcState.result = String(calcState.numericResult);
          }
          calculateCalculatorResult(true);
        } else if (action === "calculate") {
          calculateCalculatorResult(false);
          const historyPrev = document.getElementById("calc-history-prev");
          if (historyPrev) historyPrev.textContent = calcState.expression;
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

function appendStudentChatMessage({ id, sender, message = "", kind, imageUrl = null, reactions = null }) {
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
    const image = document.createElement("img");
    image.className = "student-chat-image";
    image.src = imageUrl;
    image.alt = "صورة سؤال أو واجب مرفقة";
    image.loading = "lazy";
    image.addEventListener("click", () => openChatLinkInSeparateView({ preventDefault() {} }, imageUrl));
    bubble.append(image);
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

async function restoreStudentChatHistory(messages = []) {
  clearStudentChat();
  for (const entry of Array.isArray(messages) ? messages : []) {
    if (!entry?.message && !entry?.imageId && !entry?.imageData) continue;

    let imageUrl = entry.imageData || null;
    if (!imageUrl && entry.imageId) {
      imageUrl = await loadStudentQuestionImage(entry.imageId).catch(() => null);
    }

    appendStudentChatMessage({
      id: entry.id,
      sender: entry.kind === "teacher" ? "الأستاذ" : "أنا",
      message: entry.message || "",
      kind: entry.kind === "teacher" ? "teacher" : "student",
      imageUrl,
      reactions: entry.reactions || null,
    });
  }
}

function updateChatControls() {
  const canSend = joinedClass && !isJoining && !isRecoveringStream && socket.connected;
  const hasQuestionImage = Boolean(selectedQuestionImageFile);
  elements.chatInput.disabled = !canSend;
  if (elements.desktopChatInput) elements.desktopChatInput.disabled = !canSend;
  elements.questionImageInput.disabled = !canSend;
  elements.captureQuestionButton.disabled = !canSend;
  const desktopMessage = normalizeChatMessage(elements.desktopChatInput?.value || "");
  const activeMessage = isDesktopStudentView() ? desktopMessage : normalizeChatMessage(elements.chatInput.value);
  if (elements.openChatComposeButton) {
    elements.openChatComposeButton.disabled = !canSend || (isDesktopStudentView() && !activeMessage && !hasQuestionImage);
  }
  elements.chatSendButton.disabled = !canSend || (!normalizeChatMessage(elements.chatInput.value) && !hasQuestionImage);
}

function relocateStudentChatComposer() {
  const modal = elements.chatComposeModal || document.getElementById("chat-compose-modal");
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
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
  return payload.data.imageId;
}

function isDesktopStudentView() {
  return window.matchMedia?.("(min-width: 901px)").matches || false;
}


async function sendStudentChatMessage(event) {
  event.preventDefault();

  const desktopDirect = isDesktopStudentView() && elements.desktopChatInput;
  const messageInput = desktopDirect ? elements.desktopChatInput : elements.chatInput;
  const message = normalizeChatMessage(messageInput.value);
  const imageFile = selectedQuestionImageFile;
  if (!joinedClass || isJoining || (!message && !imageFile)) {
    return;
  }

  elements.chatSendButton.disabled = true;
  elements.captureQuestionButton.disabled = true;

  try {
    let imageId = null;
    let localImageUrl = null;
    if (imageFile) {
      imageId = await uploadQuestionImage(imageFile);
      localImageUrl = URL.createObjectURL(imageFile);
      renderedQuestionImageUrls.add(localImageUrl);
    }

    const res = await emitWithAcknowledgement("student_send_message", {
      level,
      studentName,
      message,
      imageId,
    });

    appendStudentChatMessage({
      id: res?.messageId,
      sender: "أنا",
      message,
      kind: "student",
      imageUrl: localImageUrl,
    });
    elements.chatInput.value = "";
    if (elements.desktopChatInput) elements.desktopChatInput.value = "";
    clearSelectedQuestionImage();
    // Keep the permanent mobile composer visible after sending. The chat itself
    // confirms delivery by displaying the submitted question or image.
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
      "الميكروفون مفتوح — الأستاذ يستمع إليك"
    );
    button.title = "الميكروفون مفتوح — الأستاذ يستمع إليك";
    const icon = button.querySelector("span[aria-hidden]") || button.querySelector("span:first-child");
    if (icon) icon.textContent = "🎙️";
    setButtonLabel(button, "ميكروفون مفتوح");

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
  setButtonLabel(button, waiting ? "تنزيل اليد" : "رفع اليد");

  // The same primary button is the complete toggle. Keep the legacy waiting
  // wrapper hidden so no second or third hand-control button can appear.
  elements.handWaitingActions.hidden = true;
  elements.handWaitingActions.classList.remove("hand-raised");
  const waitingLabel = elements.handWaitingActions.querySelector(".hand-waiting-label");
  if (waitingLabel) waitingLabel.textContent = "";
}

function toggleRaisedHand() {
  if (microphonePermissionGranted) {
    showMobileControlToast("الميكروفون مفتوح حالياً — الأستاذ يستمع إلى صوتك");
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
      micAlertAudioContext.resume().catch(() => {});
    }
    return micAlertAudioContext;
  } catch (err) {
    return null;
  }
}

function unlockMicAlertAudio() {
  const ctx = getMicAlertAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
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
        ctx.resume().catch(() => {});
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
      audioFallback.play().catch(() => {});
    } catch (fallbackErr) {
      console.warn("Audio element fallback error:", fallbackErr);
    }
  }

  // Mobile vibration: 200ms ring, 50ms pause, 250ms ring (total 0.5s)
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([200, 50, 250]);
    }
  } catch (ignored) {}

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
        channelCount: 1,
      },
    });
    localAudioStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    microphonePrepared = true;
    rememberStudentMicrophonePermission();
    setViewerStatus("تم تجهيز المايك للحصة. لن يعمل إلا عند سماح الأستاذ.", "live");
    updatePrejoinControls();
    return true;
  } catch (error) {
    microphonePrepared = false;
    if (error?.name === "NotAllowedError") {
      setViewerStatus("يمكنك متابعة الحصة بصوت الأستاذ. لن يعمل مايكك إلا بعد السماح للمتصفح.", "warning");
    } else if (error?.name === "NotFoundError") {
      setViewerStatus("لم يتم العثور على مايك متاح. ستتابع الحصة بصوت الأستاذ.", "warning");
    }
    updatePrejoinControls();
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
  const overlay = elements.prejoinOverlay;
  if (!overlay) return;
  overlay.hidden = hidden;
  overlay.style.display = hidden ? "none" : "grid";
  overlay.style.pointerEvents = hidden ? "none" : "auto";
  overlay.style.visibility = hidden ? "hidden" : "visible";
  overlay.setAttribute("aria-hidden", hidden ? "true" : "false");
  if (hidden) {
    document.documentElement.classList.add("student-prejoin-completed-user");
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
      updatePrejoinControls("لا يمكن الاستمرار قبل السماح للمتصفح باستخدام الميكروفون.");
      return;
    }
  }

  markPermanentStudentPrejoinCompleted();
  await completeStudentPrejoinAndJoin();
}

async function completeStudentPrejoinAndJoin() {
  markPermanentStudentPrejoinCompleted();
  prejoinCompleted = true;
  initialAutoJoinPending = true;
  setStudentPrejoinHidden(true);
  setStudentSessionActive(true);
  setPlaceholder("جاري الدخول إلى الحصة", "سيظهر بث الأستاذ تلقائياً عند توفر الحصة.");
  setViewerStatus("جارٍ الدخول إلى الحصة…", "warning");
  if (socket.connected) {
    void joinClass();
  }
}

async function initializeStudentPrejoin() {
  if (!elements.prejoinOverlay) return;

  if (hasPermanentStudentPrejoinCompleted()) {
    prejoinCompleted = true;
    initialAutoJoinPending = true;
    setStudentPrejoinHidden(true);
    setStudentSessionActive(true);
    markPermanentStudentPrejoinCompleted();

    // Silently attempt background microphone preparation if browser already permitted it,
    // but never block entry or show the prejoin modal.
    if (!microphonePrepared && navigator.mediaDevices?.getUserMedia) {
      void (async () => {
        try {
          const browserPermission = await readBrowserMicrophonePermission();
          if (browserPermission === "granted") {
            await prepareStudentMicrophone();
          }
        } catch (ignored) {}
      })();
    }

    if (socket.connected && !joinedClass && !isJoining) {
      void joinClass();
    }
    return;
  }

  prejoinCompleted = false;
  initialAutoJoinPending = false;
  setStudentPrejoinHidden(false);
  updatePrejoinControls("يجب تفعيل الميكروفون أولاً قبل دخول الحصة.");

  const micWasPreparedDuringEntry = sessionStorage.getItem("studentMicPreflight") === "granted";
  sessionStorage.removeItem("studentMicPreflight");
  if (micWasPreparedDuringEntry) {
    const ready = await prepareStudentMicrophone();
    updatePrejoinControls(ready
      ? "الميكروفون جاهز. اضغط استمرار للدخول إلى الحصة."
      : "يجب السماح للمتصفح باستخدام الميكروفون قبل الاستمرار.");
  }
}

function updateRemoteAudioControl() {
  const hasLiveRemoteAudio = Boolean(
    remoteMediaStream?.getAudioTracks().some((track) => track.readyState === "live")
  );

  if (!elements.enableAudioButton) {
    return;
  }

  elements.enableAudioButton.hidden = !hasLiveRemoteAudio || !elements.remoteVideo.muted;
}

async function startTeacherAudio({ userInitiated = false } = {}) {
  if (!remoteMediaStream || isAttemptingTeacherAudio) {
    return false;
  }

  isAttemptingTeacherAudio = true;
  if (elements.enableAudioButton) elements.enableAudioButton.disabled = true;
  elements.remoteVideo.muted = false;

  try {
    await elements.remoteVideo.play();
    if (userInitiated) {
      setViewerStatus("صوت الأستاذ يعمل الآن.", "live");
    }
    return true;
  } catch (error) {
    // Some mobile browsers forbid audible autoplay after navigation. Keep the
    // lesson visible, show one prominent fallback, and never interrupt WebRTC.
    console.warn("Unable to start teacher audio automatically:", error);
    elements.remoteVideo.muted = true;
    if (userInitiated) {
      setViewerStatus("تعذر تشغيل الصوت. اضغط الزر الظاهر داخل البث مرة واحدة.", "warning");
    } else {
      setViewerStatus("صوت الأستاذ جاهز. إن لم يبدأ تلقائياً اضغط الزر الكبير داخل البث مرة واحدة.", "warning");
    }
    return false;
  } finally {
    isAttemptingTeacherAudio = false;
    if (elements.enableAudioButton) elements.enableAudioButton.disabled = false;
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
  elements.remoteVideo.controls = showScreenShare;
  elements.remoteVideo.classList.toggle("is-screen-share", showScreenShare);
  elements.remoteVideo.classList.toggle("has-live-video", shouldShowRemoteVideo);
  // The placeholder must disappear as soon as a live video track arrives. The
  // screen-share flag is a status signal and can arrive before the media track.
  elements.placeholder.hidden = shouldShowRemoteVideo;

  if (shouldShowRemoteVideo) {
    hideConnectionOverlay();
    void elements.remoteVideo.play().catch(() => {});
  }
  // Do not pause the media element while waiting: the same element carries
  // the teacher's audio, which must remain audible before screen sharing.
}

function resetRemoteMedia() {
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
  const alreadyAdded = stream.getTracks().some((currentTrack) => currentTrack.id === track.id);
  if (!alreadyAdded) {
    stream.addTrack(track);
  }
}

function attachTeacherTrack(event) {
  const track = event.track;
  if (!track) return;

  if (track.kind === "audio" && event.receiver) {
    try {
      if ("jitterBufferTarget" in event.receiver) {
        event.receiver.jitterBufferTarget = 80;
      } else if ("playoutDelayHint" in event.receiver) {
        event.receiver.playoutDelayHint = 0.08;
      }
    } catch (_) {}
  }

  if (!remoteMediaStream) {
    remoteMediaStream = new MediaStream();
    elements.remoteVideo.srcObject = remoteMediaStream;
    elements.remoteVideo.muted = false;
  }
  addUniqueTrack(remoteMediaStream, track);

  if (track.kind === "video") {
    clearRecoveryTimer();
    recoveryAttempts = 0;
    isRecoveringStream = false;
    updateChatControls();
    setViewerStatus(
      screenShareActive ? "مشاركة شاشة الأستاذ متصلة." : "صوت الأستاذ متصل. بانتظار مشاركة الشاشة…",
      "live"
    );
  } else {
    setViewerStatus("صوت الأستاذ متصل. بانتظار مشاركة الشاشة…", "live");
  }

  updateRemoteVideoPresentation();

  track.addEventListener("ended", () => {
    remoteMediaStream?.removeTrack(track);
    if (track.kind === "video") {
      screenShareActive = false;
      setViewerStatus("توقفت مشاركة الشاشة. صوت الأستاذ ما زال متاحًا.", "live");
      updateRemoteVideoPresentation();
    }
    updateRemoteAudioControl();
  }, { once: true });
  track.addEventListener("unmute", () => {
    updateRemoteAudioControl();
    updateRemoteVideoPresentation();
    if (track.kind === "video") void elements.remoteVideo.play().catch(() => {});
  });

  updateRemoteAudioControl();
  void startTeacherAudio();
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
function beginStreamRecovery(message) {
  if (!joinedClass && !isJoining) {
    return;
  }

  clearHandResetTimer();
  closePeerConnection();
  resetRemoteMedia();
  microphonePermissionGranted = false;
  if (localAudioStream) {
    localAudioStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }
  updateMicControl();
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
  scheduleClassRecovery(Math.min(1_000 * (2 ** recoveryAttempts), 8_000));
}

function closePeerConnection() {
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
  stopLocalAudio();
  joinedClass = false;
  isJoining = false;
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
      paramMap.set("stereo", "0");
      paramMap.set("sprop-stereo", "0");
      paramMap.set("cbr", "1");
      if (!paramMap.has("maxaveragebitrate")) {
        paramMap.set("maxaveragebitrate", "32000");
      }
      const newParams = Array.from(paramMap.entries())
        .map(([k, v]) => (v ? `${k}=${v}` : k))
        .join(";");
      modifiedLines.push(`a=fmtp:${opusPayload} ${newParams}`);
    } else {
      modifiedLines.push(line);
      if (line.startsWith(`a=rtpmap:${opusPayload} `) && !fmtpFound) {
        const nextLine = lines[i + 1] || "";
        if (!nextLine.startsWith(`a=fmtp:${opusPayload}`)) {
          modifiedLines.push(`a=fmtp:${opusPayload} minptime=10;useinbandfec=1;stereo=0;sprop-stereo=0;cbr=1;maxaveragebitrate=32000`);
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
    return;
  }

  isMakingRenegotiationOffer = true;

  try {
    const offer = await pc.createOffer();
    const optimizedSdp = optimizeOpusSdp(offer.sdp);
    await pc.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: optimizedSdp }));

    await emitWithAcknowledgement("webrtc_renegotiation_offer", {
      targetSocketId: teacherSocketId,
      sdp: pc.localDescription,
    });

    microphoneOfferSent = true;
    setViewerStatus("جارٍ ربط مايكك بالأستاذ…", "warning");
  } catch (error) {
    console.error("Unable to negotiate the approved microphone track:", error);
    microphoneOfferSent = false;
    setViewerStatus("تعذر تشغيل المايك مع الحصة. حاول رفع اليد مرة أخرى.", "error");
  } finally {
    isMakingRenegotiationOffer = false;
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
  pc.ontrack = attachTeacherTrack;

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

    if (pc.connectionState === "failed") {
      beginStreamRecovery("انقطع اتصال البث. جارٍ استعادته تلقائياً…");
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (!pc) {
      return;
    }

    const { iceConnectionState } = pc;

    if (iceConnectionState === "connected" || iceConnectionState === "completed") {
      clearRecoveryTimer();
      recoveryAttempts = 0;
      isRecoveringStream = false;
      hideConnectionOverlay();
      updateChatControls();
      return;
    }

    if (iceConnectionState === "disconnected") {
      showConnectionOverlay("اتصال البث غير مستقر. جارٍ محاولة الاستعادة…", "warning");
      setViewerStatus("اتصال البث غير مستقر. جارٍ محاولة الاستعادة…", "warning");
      isRecoveringStream = true;
      scheduleClassRecovery(2_000);
      return;
    }

    if (iceConnectionState === "failed") {
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

  if (!pc || !teacherSocketId) {
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
    const isAlreadyAttached = pc.getSenders().some((sender) => sender.track?.id === existingTrack.id);
    if (!isAlreadyAttached) {
      const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio" || !s.track);
      if (audioSender && typeof audioSender.replaceTrack === "function") {
        try {
          await audioSender.replaceTrack(existingTrack);
        } catch (_) {
          pc.addTrack(existingTrack, localAudioStream);
        }
      } else {
        pc.addTrack(existingTrack, localAudioStream);
      }
    }
    updateMicControl();
    microphoneOfferSent = false;
    microphoneNegotiated = false;
    await negotiateStudentMicrophone();
    void publishStudentSfuMic(localAudioStream);
    return;
  }

  // If track doesn't exist or is ended/stopped, clean it up and get a fresh one
  if (localAudioStream) {
    try {
      localAudioStream.getTracks().forEach((track) => track.stop());
    } catch (_) {}
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
        channelCount: 1,
      },
    });
    microphonePrepared = true;

    // The peer might have been closed while the permission prompt was open.
    if (!pc || !teacherSocketId || !joinedClass) {
      stopLocalAudio();
      return;
    }

    const newTrack = localAudioStream.getAudioTracks()[0];
    if (newTrack) {
      newTrack.enabled = true;
      const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio" || !s.track);
      if (audioSender && typeof audioSender.replaceTrack === "function") {
        try {
          await audioSender.replaceTrack(newTrack);
        } catch (_) {
          pc.addTrack(newTrack, localAudioStream);
        }
      } else {
        pc.addTrack(newTrack, localAudioStream);
      }
    }

    updateMicControl();
    // Do not depend only on negotiationneeded: explicitly create the offer so
    // the approved microphone works consistently across browsers.
    microphoneOfferSent = false;
    microphoneNegotiated = false;
    await negotiateStudentMicrophone();
    void publishStudentSfuMic(localAudioStream);
    // All approved student audio arrives through the teacher's master mix.


  } catch (error) {
    console.error("Unable to access student microphone:", error);
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
  if (!prejoinCompleted && !rejoin) {
    return;
  }

  // A user-initiated click is the best moment to obtain browser mic permission.
  // Automatic recovery and direct reconnects never request it unexpectedly.
  if (!rejoin && prepareMicrophone) {
    await prepareStudentMicrophone();
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
    await emitWithAcknowledgement("student_join_room", { level, studentId, rejoin });

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
  } catch (error) {
    console.error("Unable to join classroom:", error);
    isJoining = false;
    const joinErrorMessage = error.message || "تعذر الانضمام إلى الحصة.";
    const isLiveAccessBlocked = joinErrorMessage.includes("لم تقم بالدفع");
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
      isSubscriptionUpgradeBlocked
        ? "ترقية الاشتراك مطلوبة"
        : isLiveAccessBlocked || isIdentityBlocked
          ? "دخول الحصة غير متاح"
          : "الحصة غير متاحة",
      isLiveAccessBlocked || isSubscriptionUpgradeBlocked || isIdentityBlocked
        ? joinErrorMessage
        : "بانتظار بدء الأستاذ للحصة تلقائياً."
    );

    if (isSubscriptionUpgradeBlocked) {
      openSubscriptionUpgradeModal(deniedSubject || "university");
      return;
    }

    if (!isLiveAccessBlocked && !isIdentityBlocked) {
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
  socket.emit("student_lower_hand", { level }, () => {});
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

  if (initialAutoJoinPending && prejoinCompleted && !joinedClass && !isJoining) {
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
    microphonePermissionGranted = false;
    if (localAudioStream) {
      localAudioStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    updateMicControl();
    globalFreeClass = Boolean(data.globalFree);
    waitingForNextClass = false;
    teacherSocketId = data.teacherSocketId || teacherSocketId;
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
    void connectStudentSfu(data.classroomLevel || data.level);
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
  if (!joinedClass || isJoining || isRecoveringStream) return;

  const accessGranted =
    data.liveAccessEnabled === true ||
    data.paymentStatus === true ||
    data.paymentStage === "PAID";
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
    void elements.remoteVideo.play().catch(() => {});
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

socket.on("classroom_chat_history", (data = {}) => {
  if (!joinedClass || data.level !== level) return;
  void restoreStudentChatHistory(data.messages);
});

socket.on("teacher_message_received", (data = {}) => {
  const imageData = data?.imageData || data?.imageUrl || null;
  if (!joinedClass || (!data?.message && !imageData)) {
    return;
  }

  appendStudentChatMessage({
    id: data.id,
    sender: "الأستاذ",
    message: data.message || "",
    kind: "teacher",
    imageUrl: imageData,
    reactions: data.reactions || null,
  });
});

socket.on("classroom_chat_reaction_updated", (data = {}) => {
  if (!joinedClass) return;
  updateStudentMessageReactions(data);
});

socket.on("teacher_reacted_to_message", (data = {}) => {
  if (!joinedClass) return;
  const emojiMap = {
    love: "❤️",
    like: "👍",
    cry: "😭",
    dislike: "👎",
    fire: "🔥",
  };
  const emoji = emojiMap[data.reaction] || "❤️";

  const targetBubble = data.messageId ? document.querySelector(`.student-chat-message[data-message-id="${data.messageId}"]`) : null;
  if (targetBubble) {
    showStudentFloatingReaction(targetBubble, emoji);
    const pillsWrap = targetBubble.querySelector(`.student-chat-reactions-pills`);
    if (pillsWrap && data.reaction) {
      const teacherReactedObj = {};
      teacherReactedObj[data.reaction] = true;
      renderStudentReactionPills(pillsWrap, {
        [data.reaction]: 1,
        teacherReacted: teacherReactedObj,
        isTeacherReactor: true,
      }, data.messageId);
    }
  } else if (elements.chatBox) {
    showStudentFloatingReaction(elements.chatBox, emoji);
  }
  setViewerStatus(`${emoji} تفاعل الأستاذ مع رسالتك!`, "live");
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

  // The actual audio sender arrives through the teacher's immediately following
  // renegotiation offer. This room-wide signal is only a lightweight state hint;
  // it never requires the learner to refresh or press Join again.
  if (data.enabled) {
    setViewerStatus("جارٍ توصيل صوت تلميذ بالحصة…", "live");
  }
});

socket.on("webrtc_offer", async (data = {}) => {
  const { fromSocketId, sdp } = data;

  if (!joinedClass || !fromSocketId || !sdp) {
    return;
  }

  try {
    const canReuseExistingConnection =
      pc &&
      teacherSocketId === fromSocketId &&
      pc.signalingState === "stable" &&
      pc.connectionState !== "closed";

    // createViewerPeerConnection() closes stale state and therefore clears the
    // stored target socket ID. Assign the teacher ID only *after* that cleanup;
    // otherwise the student's SDP answer is sent with a null target and the
    // teacher never completes the WebRTC handshake.
    const peerConnection = canReuseExistingConnection ? pc : createViewerPeerConnection();
    teacherSocketId = fromSocketId;

    // ICE restarts arrive as a fresh teacher offer. Reusing the existing peer
    // preserves the rendered screen and audio instead of briefly blanking the
    // classroom while the network route is recovered.
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingIceCandidates();

    const answer = await peerConnection.createAnswer();
    const optimizedSdp = optimizeOpusSdp(answer.sdp);
    await peerConnection.setLocalDescription(new RTCSessionDescription({ type: answer.type, sdp: optimizedSdp }));

    await emitWithAcknowledgement("webrtc_answer", {
      targetSocketId: teacherSocketId,
      sdp: peerConnection.localDescription,
    });

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
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingIceCandidates();
    microphoneNegotiated = true;
    microphoneOfferSent = true;
    updateMicControl();
    setViewerStatus("صوت المايك متصل بالحصة.", "live");
  } catch (error) {
    console.error("Unable to apply microphone renegotiation answer:", error);
    setViewerStatus("تعذر تشغيل صوت المايك مع الحصة.", "error");
  }
});

socket.on("permission_granted", async () => {
  if (!joinedClass) {
    return;
  }

  playMicOpenedAlert();

  microphonePermissionGranted = true;
  clearHandResetTimer();
  // Resolve the student's request immediately and switch button to active microphone indicator.
  setRaisedHandState({ waiting: false });
  elements.raiseHandButton.hidden = false;
  elements.handWaitingActions.hidden = true;
  updateMicControl();
  await enableApprovedMicrophone();
});

socket.on("microphone_revoked", () => {
  clearHandResetTimer();
  microphonePermissionGranted = false;
  isMakingRenegotiationOffer = false;
  microphoneOfferSent = false;
  microphoneNegotiated = false;
  unpublishStudentSfuMic();

  const audioTrack = localAudioStream?.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = false;
  }
  setRaisedHandState({ waiting: false });
  elements.handWaitingActions.hidden = true;
  updateMicControl();
  setViewerStatus("أغلق الأستاذ المايك. يمكنك رفع اليد عند الحاجة.", "neutral");
});

socket.on("classroom_all_mics_muted", () => {
  clearHandResetTimer();
  microphonePermissionGranted = false;
  isMakingRenegotiationOffer = false;
  microphoneOfferSent = false;
  microphoneNegotiated = false;
  unpublishStudentSfuMic();

  if (localAudioStream) {
    localAudioStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }

  setRaisedHandState({ waiting: false });
  elements.handWaitingActions.hidden = true;
  updateMicControl();
  setViewerStatus("أغلق الأستاذ ميكروفونات جميع التلاميذ.", "neutral");
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
relocateStudentChatComposer();
if (!isDesktopStudentView()) openStudentChatComposer({ focus: false });
elements.enableAudioButton?.addEventListener("click", enableTeacherAudio);
elements.dismissTeacherMicMuteBtn?.addEventListener("click", () => {
  teacherMicMutedNoticeDismissed = true;
  if (elements.teacherMicMuteBanner) {
    elements.teacherMicMuteBanner.hidden = true;
  }
});
elements.screenShareWatchButton?.addEventListener("click", watchCurrentScreenShare);
elements.remoteVideo?.addEventListener("volumechange", updateRemoteAudioControl);
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
  selectQuestionImage(file);
  // Choosing a file or confirming the camera capture is the student's
  // confirmation. Send the image immediately in every view; text messages
  // continue to use their existing send button/modal flow.
  if (selectedQuestionImageFile === file) {
    window.setTimeout(() => sendStudentChatMessage({ preventDefault() {} }), 0);
  }
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
  window.location.assign("./index.html");
});
  initializeMobileControls();
  initializeDesktopFullscreen();
  initializeStudentKeyboardLayout();
  initializeQualitySelector();
  initializeSignalFinder();
  initializeStudentCalculator();

window.addEventListener("pagehide", () => {
  enableNativeSwipeRefresh();
  clearHandResetTimer();
  clearRecoveryTimer();
  clearSelectedQuestionImage();
  closeSubscriptionUpgradeModal();
  closeSignalFinderModal();
  closeStudentCalculatorModal();
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
  if (prejoinCompleted) {
    setPlaceholder("جاري الدخول إلى الحصة", "سيظهر بث الأستاذ تلقائياً عند توفر الحصة.");
    setViewerStatus("جارٍ الدخول إلى الحصة…", "warning");
  } else {
    setPlaceholder("جاري تجهيز الدخول إلى الحصة", "ستظهر صورة مستواك وصوت الأستاذ بعد إكمال فحص الميكروفون.");
    setViewerStatus("بانتظار تجهيز الميكروفون…", "neutral");
  }
  updateMicControl();
  updateChatControls();
  void initializeStudentPrejoin();

  window.addEventListener("beforeunload", () => {
    notifyNativeLiveService("stop");
  });
  window.addEventListener("pagehide", () => {
    if (!joinedClass) {
      notifyNativeLiveService("stop");
    }
  });
}

