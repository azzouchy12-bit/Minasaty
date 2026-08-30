"use strict";

/**
 * Student live-viewer controller.
 *
 * This page intentionally represents only one remote peer: the teacher. It
 * never receives, renders, or requests a list of any other students.
 */

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
const parentSessionToken = sessionStorage.getItem("parentToken") || "";
const socket = typeof window.io === "function"
  ? window.io({
      auth: parentSessionToken ? { token: parentSessionToken } : {},
      transports: ["websocket", "polling"],
    })
  : createUnavailableStudentSocket();

const rtcConfig = {
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

const storedStudent = readStoredStudent();
const studentId = storedStudent.studentId;
const studentName = storedStudent.studentName;
const level = {
  "السنة الأولى متوسط": "السنة الأولى",
  "السنة الثانية متوسط": "السنة الثانية",
  "السنة الثالثة متوسط": "السنة الثالثة",
  "السنة الرابعة متوسط": "السنة الرابعة",
}[storedStudent.level] || storedStudent.level;
// The classroom is entered from the parent dashboard. Once identity is known,
// keep the viewer hands-free even after a teacher ends and later restarts class.
initialAutoJoinPending = initialAutoJoinPending || Boolean(studentId && level);

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

function exitLiveClass() {
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

function updateRotationControls() {
  // The phone sensor must not change this page by itself. The in-app rotate
  // button is the only control that enables the landscape interface.
  const rotationState = getStudentRotationState();
  const nativeLandscape = rotationState.requested && (window.matchMedia?.("(orientation: landscape)").matches || false);
  const isLandscape = rotationState.requested && (nativeLandscape || rotationState.virtual);
  const showUnrotate = isLandscape;
  if (elements.rotateButton) elements.rotateButton.hidden = isLandscape;
  if (elements.unrotateButton) elements.unrotateButton.hidden = !showUnrotate;
  if (elements.centerRotateButton) elements.centerRotateButton.hidden = showUnrotate;
  if (elements.centerUnrotateButton) elements.centerUnrotateButton.hidden = !showUnrotate;
  syncLandscapeCaptureButton(showUnrotate);
  document.documentElement.classList.toggle("student-landscape-mode", isLandscape);
  document.documentElement.classList.toggle("student-virtual-landscape-mode", rotationState.virtual);
  document.body.classList.toggle("hide-ui-for-rotation", rotationState.virtual);
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
    studentZoomState.translateX = clampStudentZoomTranslation(
      studentZoomState.panStartTranslateX + event.clientX - studentZoomState.panStartX,
      studentZoomState.scale,
      width
    );
    studentZoomState.translateY = clampStudentZoomTranslation(
      studentZoomState.panStartTranslateY + event.clientY - studentZoomState.panStartY,
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
  const deltaX = center.x - studentZoomState.startCenter.x;
  const deltaY = center.y - studentZoomState.startCenter.y;
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

async function lockStudentOrientation(orientation) {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }

    if (orientation.startsWith("landscape")) {
      const orientationController = screen.orientation;
      if (!orientationController?.lock) {
        throw new Error("Screen orientation lock is unavailable.");
      }

      // The lock is requested only from the student's in-app button. The phone
      // sensor is not listened to as an independent trigger.
      await orientationController.lock("landscape");
      getStudentRotationState().virtual = false;
      updateRotationControls();
      showMobileControlToast("تم تفعيل التدوير اليدوي داخل المنصة.");
      return true;
    }

    getStudentRotationState().virtual = false;
    updateRotationControls();
    showMobileControlToast("تم إلغاء تدوير الشاشة.");
    return true;
  } catch (error) {
    // Never leave the page sideways inside a portrait viewport. A CSS rotation
    // fallback looks broken on real phones, so keep the page portrait and tell
    // the student exactly why the request could not be completed.
    console.warn("Unable to lock student screen orientation:", error);
    getStudentRotationState().virtual = false;
    getStudentRotationState().requested = false;
    document.documentElement.classList.remove("student-landscape-mode", "student-virtual-landscape-mode");
    document.body.classList.remove("hide-ui-for-rotation");
    try {
      screen.orientation?.unlock?.();
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (cleanupError) {
      console.warn("Unable to clean up failed student orientation request:", cleanupError);
    }
    updateRotationControls();
    showMobileControlToast("تعذر تدوير الشاشة. افتح الحصة في Chrome ثم اضغط الزر مرة أخرى.");
    return false;
  }
}

async function rotateStudentScreen() {
  getStudentRotationState().requested = true;
  await lockStudentOrientation("landscape");
}

async function unrotateStudentScreen() {
  try {
    getStudentRotationState().requested = false;
    getStudentRotationState().virtual = false;
    document.documentElement.classList.remove("student-virtual-landscape-mode");
    document.body.classList.remove("hide-ui-for-rotation");
    // Unlock only when the student explicitly presses the in-app cancel button;
    // the phone sensor never starts this transition by itself.
    if (screen.orientation?.unlock) {
      screen.orientation.unlock();
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
    resetStudentZoom();
    updateRotationControls();
    showMobileControlToast("تم إلغاء تدوير الشاشة.");
  } catch (error) {
    console.warn("Unable to unlock student screen orientation:", error);
    updateRotationControls();
    showMobileControlToast("أدر الهاتف يدويًا إلى الوضع العمودي.");
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

function appendStudentChatMessage({ sender, message = "", kind, imageUrl = null }) {
  const safeMessage = normalizeChatMessage(message);
  if ((!safeMessage && !imageUrl) || !elements.chatBox) {
    return;
  }

  // Match modern messengers: follow the newest message only while the viewer
  // is already at the bottom. Scrolling upward keeps older messages in place.
  const shouldFollowNewestMessage = isViewingLatestMessages(elements.chatBox);
  elements.chatEmpty?.remove();

  const bubble = document.createElement("article");
  bubble.className = `student-chat-message ${kind === "teacher" ? "teacher-reply" : "own-message"}`;

  const senderLabel = document.createElement("strong");
  senderLabel.className = "student-chat-sender";
  senderLabel.textContent = sender;

  bubble.append(senderLabel);

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
  elements.chatBox.append(bubble);

  if (shouldFollowNewestMessage) {
    requestAnimationFrame(() => {
      elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
    });
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
      sender: entry.kind === "teacher" ? "الأستاذ" : "أنا",
      message: entry.message || "",
      kind: entry.kind === "teacher" ? "teacher" : "student",
      imageUrl,
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

    await emitWithAcknowledgement("student_send_message", {
      level,
      studentName,
      message,
      imageId,
    });

    appendStudentChatMessage({ sender: "أنا", message, kind: "student", imageUrl: localImageUrl });
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
  const canInteract = joinedClass && !microphonePermissionGranted;
  const button = elements.raiseHandButton;
  button.hidden = !canInteract;
  button.disabled = !canInteract;
  button.classList.toggle("hand-raised", waiting);
  button.setAttribute("aria-pressed", String(waiting));
  button.setAttribute(
    "aria-label",
    waiting ? "تنزيل اليد وإلغاء طلب التحدث" : "رفع اليد وطلب التحدث"
  );
  button.title = waiting ? "تنزيل اليد وإلغاء طلب التحدث" : "رفع اليد وطلب التحدث";
  setButtonLabel(button, waiting ? "تنزيل اليد" : "رفع اليد");

  // The same primary button is the complete toggle. Keep the legacy waiting
  // wrapper hidden so no second or third hand-control button can appear.
  elements.handWaitingActions.hidden = true;
  elements.handWaitingActions.classList.remove("hand-raised");
  const waitingLabel = elements.handWaitingActions.querySelector(".hand-waiting-label");
  if (waitingLabel) waitingLabel.textContent = "";
}

function toggleRaisedHand() {
  if (elements.raiseHandButton.classList.contains("hand-raised")) {
    lowerHand();
    return;
  }
  raiseHand();
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

  localAudioStream = undefined;
  microphonePermissionGranted = false;
  microphonePrepared = false;
  isPreparingMicrophone = false;
  isRequestingMicrophone = false;
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
      clearRememberedStudentMicrophonePermission();
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
    return localStorage.getItem(STUDENT_MIC_PERMISSION_STORAGE_KEY) === "granted";
  } catch (error) {
    return false;
  }
}

function clearRememberedStudentMicrophonePermission() {
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

  await completeStudentPrejoinAndJoin();
}

async function completeStudentPrejoinAndJoin() {
  prejoinCompleted = true;
  initialAutoJoinPending = true;
  setStudentPrejoinHidden(true);
  setPlaceholder("جاري الدخول إلى الحصة", "سيظهر بث الأستاذ تلقائياً عند توفر الحصة.");
  setViewerStatus("جارٍ الدخول إلى الحصة…", "warning");
  if (socket.connected) {
    void joinClass();
  }
}

async function initializeStudentPrejoin() {
  if (!elements.prejoinOverlay) return;

  prejoinCompleted = false;
  initialAutoJoinPending = false;

  const rememberedPermission = hasRememberedStudentMicrophonePermission();
  setStudentPrejoinHidden(rememberedPermission);
  updatePrejoinControls("يجب تفعيل الميكروفون أولاً قبل دخول الحصة.");

  const browserPermission = await readBrowserMicrophonePermission();
  const canReusePermission = rememberedPermission && browserPermission !== "prompt" && browserPermission !== "denied";

  if (canReusePermission) {
    const ready = await prepareStudentMicrophone();
    if (ready) {
      await completeStudentPrejoinAndJoin();
      return;
    }
    clearRememberedStudentMicrophonePermission();
  }

  // A completed or in-progress join must never reopen the click-blocking layer.
  if (joinedClass || isJoining || prejoinCompleted) return;
  setStudentPrejoinHidden(false);
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
    await pc.setLocalDescription(offer);

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
      scheduleClassRecovery(3_000);
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
  if (existingTrack) {
    existingTrack.enabled = true;
    const isAlreadyAttached = pc.getSenders().some((sender) => sender.track?.id === existingTrack.id);
    if (!isAlreadyAttached) {
      pc.addTrack(existingTrack, localAudioStream);
    }
    updateMicControl();
    await negotiateStudentMicrophone();
    // All approved student audio arrives through the teacher's master mix.

    return;
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

    localAudioStream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, localAudioStream);
    });

    updateMicControl();
    // Do not depend only on negotiationneeded: explicitly create the offer so
    // the approved microphone works consistently across browsers.
    await negotiateStudentMicrophone();
    // All approved student audio arrives through the teacher's master mix.

  } catch (error) {
    console.error("Unable to access student microphone:", error);
    microphonePermissionGranted = false;
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

  if ((joinedClass && !isRecoveringStream) || isJoining) {
    return;
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

  socket.emit("student_raise_hand", { level, studentName }, (response) => {
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
    globalFreeClass = Boolean(data.globalFree);
    waitingForNextClass = false;
    teacherSocketId = data.teacherSocketId || teacherSocketId;
    screenShareActive = Boolean(data.screenShareActive);
    setParticipationCount(data.participationCount);
    updateRemoteVideoPresentation();
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
  const eventLevel = {
    "السنة الأولى متوسط": "السنة الأولى",
    "السنة الثانية متوسط": "السنة الثانية",
    "السنة الثالثة متوسط": "السنة الثالثة",
    "السنة الرابعة متوسط": "السنة الرابعة",
  }[String(data.level || "").trim()] || String(data.level || "").trim();
  if (!eventLevel || eventLevel !== level) return;
  renderTeacherAbsenceNotice(data.isAbsent === true);
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
    sender: "الأستاذ",
    message: data.message || "",
    kind: "teacher",
    imageUrl: imageData,
  });
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
    await peerConnection.setLocalDescription(answer);

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

  microphonePermissionGranted = true;
  clearHandResetTimer();
  // Resolve the student's request immediately. The waiting controls disappear
  // and the teacher-owned microphone track is opened without a self-mute UI.
  setRaisedHandState({ waiting: false });
  elements.raiseHandButton.hidden = true;
  elements.handWaitingActions.hidden = true;
  updateMicControl();
  await enableApprovedMicrophone();
});

socket.on("microphone_revoked", () => {
  clearHandResetTimer();
  microphonePermissionGranted = false;

  const audioTrack = localAudioStream?.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = false;
  }
  setRaisedHandState({ waiting: false });
  elements.handWaitingActions.hidden = true;
  updateMicControl();
  setViewerStatus("أغلق الأستاذ المايك. يمكنك رفع اليد عند الحاجة.", "neutral");
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

window.addEventListener("pagehide", () => {
  clearHandResetTimer();
  clearRecoveryTimer();
  clearSelectedQuestionImage();
  closeSubscriptionUpgradeModal();
  closePeerConnection();
  stopLocalAudio();
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
  setPlaceholder("جاري تجهيز الدخول إلى الحصة", "ستظهر صورة مستواك وصوت الأستاذ بعد إكمال فحص الميكروفون.");
  updateMicControl();
  updateChatControls();
  setViewerStatus("بانتظار تجهيز الميكروفون…", "neutral");
  void initializeStudentPrejoin();
}
