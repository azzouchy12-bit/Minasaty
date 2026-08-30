"use strict";

/**
 * Teacher live-streaming controller.
 *
 * Every connected student receives a distinct RTCPeerConnection. The teacher's
 * display stream and optional camera/microphone stream are added to each of
 * those connections, while Socket.io forwards the SDP and ICE messages to the
 * exact target socket ID.
 */

// Socket.io is served by the Express server at /socket.io/socket.io.js.
// Start explicitly so the studio can wait for a healthy signaling connection
// before emitting teacher_start_room, while retaining WebSocket/polling fallback.
// The server uses this token to authorize teacher-only control events.
const teacherSocketToken = sessionStorage.getItem("teacherToken") || "";
const socket = io({
  auth: { token: teacherSocketToken },
  autoConnect: false,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 10000,
});

// STUN helps browsers discover a viable peer-to-peer route. A TURN server is
// still recommended for a production deployment where restrictive networks
// may block direct WebRTC connections.
const rtcConfig = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun.cloudflare.com:3478",
      ],
    },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

// Required broadcaster state requested for this phase.
const peerConnections = Object.create(null);
let screenStream;
let cameraStream;

// Extra state used to make negotiation and cleanup predictable.
const pendingIceCandidates = Object.create(null);
const annotationSegments = [];
let isDrawingAnnotation = false;
let previousAnnotationPoint = null;
const attendeeElements = new Map();
const attendeeSocketByStudentId = new Map();
const studentAudioElements = new Map();
// This is the local authoritative mirror of the server's current teacher
// approvals. A received student track is never mixed for the class unless its
// socket ID is present here.
const approvedStudentMicrophones = new Set();
// The teacher browser creates one mix-minus destination per connected student.
// Each destination receives the teacher mic and screen audio plus every approved
// student's audio except the student who owns that destination.
const classroomAudioSources = new Map();
const classroomAudioDestinations = new Map();
let classroomAudioContext;
const iceDisconnectTimers = Object.create(null);
const ICE_DISCONNECT_GRACE_MS = 8_000;
let activeLevel = null;
let activeSubject = null;
let classActive = false;
let screenShareRevision = 0;
let isStarting = false;
let isEnding = false;
let classResumeToken = null;
let reconnectingLiveClass = false;
const renderedQuestionImageUrls = new Set();
let questionImageModalPreviousFocus = null;
let questionImageZoom = 1;
let questionImagePanX = 0;
let questionImagePanY = 0;
let questionImageDragging = false;
let questionImageDragPointerId = null;
let questionImageDragStartX = 0;
let questionImageDragStartY = 0;
let questionImageDragOriginX = 0;
let questionImageDragOriginY = 0;
const QUESTION_IMAGE_MIN_ZOOM = 1;
const QUESTION_IMAGE_MAX_ZOOM = 4;
const QUESTION_IMAGE_ZOOM_STEP = 0.25;
const studentMicStates = new Map();
let activeStudentChatMicMenu = null;
let pendingTeacherChatImageData = "";
const MAX_TEACHER_CHAT_IMAGE_DATA_URL_LENGTH = 1_100_000;
const SUPPORTED_TEACHER_CHAT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const TEACHER_LIVE_RECOVERY_KEY = "teacherLiveClassRecovery";
let pendingPageRecovery = null;
let isPageNavigatingAway = false;
let localMediaRecorder = null;
let localRecordingStream = null;
let localRecordingAudioContext = null;
let localRecordingAudioDestination = null;
let localRecordingSourceNodes = new Map();
let localRecordingSourceSyncTimer = null;
let localRecordingMixedAudioTrack = null;
let localRecordingVideoTrack = null;
let localRecordingIs1080p = false;
let localRecordingVideoElement = null;
let localRecordingCanvas = null;
let localRecordingCanvasContext = null;
let localRecordingAnimationFrame = null;
let localRecordingChunks = [];
let localRecordingMimeType = "video/webm";
let localRecordingStartedAt = 0;
let localRecordingStopResolver = null;
let localRecordingDownloadRequested = true;
let localRecordingFinalized = false;
const LOCAL_RECORDING_WIDTH = 1920;
const LOCAL_RECORDING_HEIGHT = 1080;
const LOCAL_RECORDING_FRAME_RATE = 60;
const LOCAL_RECORDING_VIDEO_BITRATE = 16_000_000;
const LOCAL_RECORDING_AUDIO_BITRATE = 192_000;
const GOOGLE_DRIVE_CLIENT_ID = "938017291163-a6dar2h6u2d5isf5h4nqtaccp7jpkk28.apps.googleusercontent.com";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_DRIVE_ROOT_FOLDER = "تسجيلات أكاديمية التفوق";
const GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
let lastLocalRecording = null;
let googleDriveAccessToken = null;
let googleDriveTokenExpiresAt = 0;
let googleDriveUploadInProgress = false;
let youtubeUploadInProgress = false;
let googleIdentityLoadPromise = null;
let studioDurationStartedAt = 0;

const elements = {
  localVideo: document.getElementById("local-video"),
  teacherCanvas: document.getElementById("teacher-canvas"),
  teacherWelcomeImage: document.getElementById("teacher-welcome-image"),
  annotationColor: document.getElementById("annotation-color"),
  annotationLineWidth: document.getElementById("annotation-line-width"),
  clearBoardButton: document.getElementById("clear-board-btn"),
  screenShareButton: document.getElementById("screen-share-btn"),
  studioLayout: document.querySelector(".studio-layout"),
  attendanceSidebar: document.querySelector(".attendance-sidebar"),
  chatSidebar: document.querySelector(".chat-sidebar"),
  attendanceSidebarToggle: document.getElementById("attendance-sidebar-toggle"),
  chatSidebarToggle: document.getElementById("chat-sidebar-toggle"),
  stageEmptyState: document.getElementById("stage-empty-state"),
  attendeesList: document.getElementById("attendees-list"),
  attendeesEmpty: document.getElementById("attendees-empty"),
  attendeeCount: document.getElementById("attendee-count"),
  levelSelect: document.getElementById("level-select"),
  subjectSelectField: document.getElementById("subject-select-field"),
  subjectSelectLabel: document.getElementById("subject-select-label"),
  subjectSelect: document.getElementById("subject-select"),
  freeClassHint: document.getElementById("free-class-hint"),
  startButton: document.getElementById("start-class-btn"),
  toggleMicButton: document.getElementById("toggle-mic-btn"),
  recordLocalButton: document.getElementById("record-local-btn"),
  localRecordingState: document.getElementById("local-recording-state"),
  saveDriveButton: document.getElementById("save-drive-btn"),
  driveUploadState: document.getElementById("drive-upload-state"),
  driveUploadText: document.getElementById("drive-upload-text"),
  driveUploadProgress: document.getElementById("drive-upload-progress"),
  youtubeUploadState: document.getElementById("youtube-upload-state"),
  youtubeUploadText: document.getElementById("youtube-upload-text"),
  youtubeUploadProgress: document.getElementById("youtube-upload-progress"),
  recordingReadyModal: document.getElementById("recording-ready-modal"),
  uploadYoutubeAfterEndButton: document.getElementById("upload-youtube-after-end-btn"),
  closeRecordingReadyButton: document.getElementById("close-recording-ready-btn"),
  leaveStudioButton: document.getElementById("leave-studio-btn"),
  endClassButton: document.getElementById("end-class-btn"),
  liveStatus: document.getElementById("live-status"),
  liveStatusText: document.getElementById("live-status-text"),
  videoStage: document.querySelector(".video-stage"),
  studioTopbarTitle: document.getElementById("studio-topbar-title"),
  studioDuration: document.getElementById("studio-duration"),
  sidebarAttendeeCount: document.getElementById("sidebar-attendee-count"),
  attendeeSearch: document.getElementById("attendee-search"),
  sidebarTabs: Array.from(document.querySelectorAll("[data-sidebar-tab]")),
  sidebarPanes: Array.from(document.querySelectorAll("[data-sidebar-pane]")),
  chatBox: document.getElementById("chat-box"),
  chatEmpty: document.getElementById("chat-empty"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatSendButton: document.getElementById("chat-send-btn"),
  chatImagePreview: document.getElementById("chat-image-preview"),
  chatImagePreviewImage: document.getElementById("chat-image-preview-img"),
  chatImageRemoveButton: document.getElementById("chat-image-remove-btn"),
  questionImageModal: document.getElementById("question-image-modal"),
  questionImageModalViewport: document.getElementById("question-image-modal-viewport"),
  questionImageModalImage: document.getElementById("question-image-modal-img"),
  questionImageZoomLabel: document.getElementById("question-image-zoom-label"),
  closeQuestionImageModalButton: document.getElementById("close-question-image-modal"),
};

const UNIVERSITY_LEVEL = "طالب جامعي";
const GLOBAL_FREE_LEVEL = "FREE";
const SECONDARY_CLASS_OPTIONS = [
  { value: "MATH", label: "الرياضيات" },
  { value: "PHYSICS", label: "الفيزياء" },
  { value: "FREE", label: "حصة مجانية" },
];
const UNIVERSITY_SUBSCRIPTION_OPTIONS = [
  { value: "PAID", label: "اشتراك مدفوع" },
  { value: "FREE", label: "اشتراك مجاني" },
];
const VALID_CLASS_TYPES = new Set([
  ...SECONDARY_CLASS_OPTIONS.map(({ value }) => value),
  ...UNIVERSITY_SUBSCRIPTION_OPTIONS.map(({ value }) => value),
]);

function isUniversityLevel(level) {
  return level === UNIVERSITY_LEVEL;
}

function getClassTypeName(level, classType) {
  if (level === GLOBAL_FREE_LEVEL) return "حصة مجانية";
  if (isUniversityLevel(level)) {
    return classType === "PAID" ? "اشتراك مدفوع" : "اشتراك مجاني";
  }

  if (classType === "FREE") return "حصة مجانية";
  return classType === "PHYSICS" ? "الفيزياء" : "الرياضيات";
}

function syncClassTypeSelector({ selectedValue = "" } = {}) {
  const selectedLevel = elements.levelSelect.value;
  const isGlobalFree = selectedLevel === GLOBAL_FREE_LEVEL;
  const isUniversity = isUniversityLevel(selectedLevel);
  const options = isGlobalFree
    ? [{ value: "FREE", label: "حصة مجانية" }]
    : isUniversity
      ? UNIVERSITY_SUBSCRIPTION_OPTIONS
      : SECONDARY_CLASS_OPTIONS;
  const nextValue = isGlobalFree
    ? "FREE"
    : options.some(({ value }) => value === selectedValue)
      ? selectedValue
      : options[0].value;

  const isFreeClass = nextValue === "FREE";
  if (elements.subjectSelectField) elements.subjectSelectField.hidden = isGlobalFree;
  elements.subjectSelectLabel.textContent = isUniversity ? "نوع الاشتراك" : isFreeClass ? "نوع الحصة" : "المادة";
  elements.subjectSelect.setAttribute(
    "aria-label",
    isUniversity ? "اختر نوع الاشتراك" : isFreeClass ? "اختر نوع الحصة" : "اختر مادة الحصة"
  );
  if (elements.freeClassHint) {
    elements.freeClassHint.hidden = !isFreeClass || isGlobalFree;
  }
  elements.subjectSelect.replaceChildren(
    ...options.map(({ value, label }) => new Option(label, value, false, value === nextValue))
  );
}

/**
 * Write a short, accessible status without rendering server/user text as HTML.
 * Supported modes are: neutral, live, and error.
 */
function setStudioStatus(message, mode = "neutral") {
  elements.liveStatusText.textContent = message;
  elements.liveStatus.classList.toggle("is-live", mode === "live");
  elements.liveStatus.classList.toggle("is-error", mode === "error");
}

function setStageMode(mode = "idle") {
  const stage = elements.videoStage;
  if (!stage) return;
  const isWelcome = mode === "welcome";
  const isScreen = mode === "screen";
  stage.classList.toggle("welcome-mode", isWelcome);
  stage.classList.toggle("screen-mode", isScreen);
  stage.classList.toggle("idle-mode", mode === "idle");
  if (elements.stageEmptyState) elements.stageEmptyState.hidden = mode !== "idle";
  if (elements.localVideo) elements.localVideo.hidden = !isScreen;
  if (elements.teacherWelcomeImage) elements.teacherWelcomeImage.hidden = !isWelcome;
  if (elements.teacherCanvas) elements.teacherCanvas.hidden = true;
}

function getQuestionImagePanBounds() {
  const viewport = elements.questionImageModalViewport;
  const image = elements.questionImageModalImage;
  if (!viewport || !image) return { x: 0, y: 0 };

  return {
    x: Math.max(0, (image.offsetWidth * questionImageZoom - viewport.clientWidth) / 2),
    y: Math.max(0, (image.offsetHeight * questionImageZoom - viewport.clientHeight) / 2),
  };
}

function clampQuestionImagePan() {
  const bounds = getQuestionImagePanBounds();
  questionImagePanX = Math.min(bounds.x, Math.max(-bounds.x, questionImagePanX));
  questionImagePanY = Math.min(bounds.y, Math.max(-bounds.y, questionImagePanY));
}

function updateQuestionImageZoom() {
  clampQuestionImagePan();
  if (elements.questionImageModalImage) {
    elements.questionImageModalImage.style.transform =
      `translate3d(${questionImagePanX}px, ${questionImagePanY}px, 0) scale(${questionImageZoom})`;
  }
  if (elements.questionImageZoomLabel) {
    elements.questionImageZoomLabel.textContent = `${Math.round(questionImageZoom * 100)}%`;
  }
  elements.questionImageModalViewport?.classList.toggle("is-zoomed", questionImageZoom > 1);
}

function resetQuestionImageZoom() {
  questionImageZoom = QUESTION_IMAGE_MIN_ZOOM;
  questionImagePanX = 0;
  questionImagePanY = 0;
  questionImageDragging = false;
  questionImageDragPointerId = null;
  if (elements.questionImageModalImage) {
    elements.questionImageModalImage.style.transformOrigin = "center center";
  }
  elements.questionImageModalViewport?.classList.remove("is-dragging");
  updateQuestionImageZoom();
}

function startQuestionImageDrag(event) {
  if (event.button !== 0 || questionImageZoom <= QUESTION_IMAGE_MIN_ZOOM) return;
  questionImageDragging = true;
  questionImageDragPointerId = event.pointerId;
  questionImageDragStartX = event.clientX;
  questionImageDragStartY = event.clientY;
  questionImageDragOriginX = questionImagePanX;
  questionImageDragOriginY = questionImagePanY;
  elements.questionImageModalViewport?.classList.add("is-dragging");
  elements.questionImageModalViewport?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveQuestionImageDrag(event) {
  if (!questionImageDragging || event.pointerId !== questionImageDragPointerId) return;
  questionImagePanX = questionImageDragOriginX + event.clientX - questionImageDragStartX;
  questionImagePanY = questionImageDragOriginY + event.clientY - questionImageDragStartY;
  updateQuestionImageZoom();
  event.preventDefault();
}

function stopQuestionImageDrag(event) {
  if (!questionImageDragging || (event.pointerId != null && event.pointerId !== questionImageDragPointerId)) return;
  elements.questionImageModalViewport?.releasePointerCapture?.(questionImageDragPointerId);
  questionImageDragging = false;
  questionImageDragPointerId = null;
  elements.questionImageModalViewport?.classList.remove("is-dragging");
}

function handleQuestionImageWheel(event) {
  if (elements.questionImageModal?.hidden || !elements.questionImageModalImage) return;
  event.preventDefault();
  event.stopPropagation();

  const direction = event.deltaY < 0 ? 1 : -1;
  questionImageZoom = Math.min(
    QUESTION_IMAGE_MAX_ZOOM,
    Math.max(
      QUESTION_IMAGE_MIN_ZOOM,
      Number((questionImageZoom + direction * QUESTION_IMAGE_ZOOM_STEP).toFixed(2))
    )
  );
  updateQuestionImageZoom();
}

function openQuestionImageModal(imageUrl) {
  if (!elements.questionImageModal || !elements.questionImageModalImage || !imageUrl) {
    return;
  }

  questionImageModalPreviousFocus = document.activeElement;
  resetQuestionImageZoom();
  elements.questionImageModalImage.src = imageUrl;
  elements.questionImageModal.hidden = false;
  document.body.style.overflow = "hidden";
  elements.closeQuestionImageModalButton?.focus();
}

function closeQuestionImageModal() {
  if (!elements.questionImageModal || elements.questionImageModal.hidden) {
    return;
  }

  elements.questionImageModal.hidden = true;
  resetQuestionImageZoom();
  elements.questionImageModalImage?.removeAttribute("src");
  document.body.style.overflow = "";
  questionImageModalPreviousFocus?.focus?.();
  questionImageModalPreviousFocus = null;
}

function persistLiveClassRecovery() {
  if (!activeLevel || !activeSubject || !classResumeToken) {
    return;
  }

  sessionStorage.setItem(
    TEACHER_LIVE_RECOVERY_KEY,
    JSON.stringify({ level: activeLevel, subject: activeSubject, resumeToken: classResumeToken })
  );
}

function clearLiveClassRecovery() {
  sessionStorage.removeItem(TEACHER_LIVE_RECOVERY_KEY);
  pendingPageRecovery = null;
}

function readLiveClassRecovery() {
  try {
    const recovery = JSON.parse(sessionStorage.getItem(TEACHER_LIVE_RECOVERY_KEY) || "null");
    if (
      recovery &&
      typeof recovery.level === "string" &&
      VALID_CLASS_TYPES.has(recovery.subject) &&
      typeof recovery.resumeToken === "string" &&
      /^[a-zA-Z0-9-]{16,128}$/.test(recovery.resumeToken)
    ) {
      return recovery;
    }
  } catch {
    // Ignore a malformed stale browser-session value.
  }

  sessionStorage.removeItem(TEACHER_LIVE_RECOVERY_KEY);
  return null;
}

function createClassResumeToken() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  const values = new Uint32Array(4);
  window.crypto?.getRandomValues?.(values);
  return Array.from(values, (value) => value.toString(36)).join("-") || `${Date.now()}-studio-recovery`;
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

  // Keep the teacher studio in its current tab. A separate browser view means
  // the active classroom and its WebRTC session are never replaced by a link.
  event.preventDefault();
  const openedWindow = window.open(parsedUrl.href, "_blank", "noopener,noreferrer");

  if (!openedWindow) {
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

/** Render all chat text through textContent to prevent injected markup. */
function closeStudentChatMicMenu() {
  activeStudentChatMicMenu?.menu.remove();
  activeStudentChatMicMenu = null;
}

function openStudentChatMicMenu({ anchor, socketId, studentId = "", studentName = "تلميذ" }) {
  if (!anchor || !socketId) return;
  if (activeStudentChatMicMenu?.anchor === anchor) {
    closeStudentChatMicMenu();
    return;
  }

  closeStudentChatMicMenu();
  const menu = document.createElement("div");
  menu.className = "student-chat-mic-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `تحكم في ميكروفون ${studentName}`);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "student-chat-mic-action";
  action.dataset.studentId = String(studentId || "");
  const enabled = studentMicStates.has(socketId)
    ? studentMicStates.get(socketId)
    : approvedStudentMicrophones.has(socketId);
  action.dataset.enabled = String(Boolean(enabled));
  action.textContent = enabled ? "غلق الـ microphone" : "فتح الـ microphone";
  action.addEventListener("click", () => {
    void setStudentMicrophone(socketId, !enabled, action);
  });

  menu.append(action);
  anchor.closest(".chat-message-sender-wrap")?.append(menu);
  activeStudentChatMicMenu = { anchor, menu };
}

document.addEventListener("click", (event) => {
  if (!activeStudentChatMicMenu) return;
  if (
    !activeStudentChatMicMenu.anchor.contains(event.target) &&
    !activeStudentChatMicMenu.menu.contains(event.target)
  ) {
    closeStudentChatMicMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeStudentChatMicMenu();
});

/** Render all chat text through textContent to prevent injected markup. */
function appendTeacherChatMessage({ sender, message = "", kind, imageUrl = null, studentSocketId = "", studentId = "" }) {
  const safeMessage = normalizeChatMessage(message);
  if ((!safeMessage && !imageUrl) || !elements.chatBox) {
    return null;
  }

  // Keep the reader's place while reviewing older chat. Only users already at
  // the bottom are followed automatically when the next message is appended.
  const shouldFollowNewestMessage = isViewingLatestMessages(elements.chatBox);
  elements.chatEmpty?.remove();

  const bubble = document.createElement("article");
  bubble.className = `chat-message ${kind === "teacher" ? "teacher-message" : "student-message"}`;

  const senderLabel = document.createElement("strong");
  senderLabel.className = "chat-message-sender";
  senderLabel.textContent = sender;

  if (kind === "student" && studentSocketId) {
    const senderWrap = document.createElement("span");
    senderWrap.className = "chat-message-sender-wrap";
    const senderButton = document.createElement("button");
    senderButton.type = "button";
    senderButton.className = "chat-message-sender-button";
    senderButton.dataset.studentId = String(studentId || "");
    senderButton.dataset.socketId = String(studentSocketId || "");
    senderButton.textContent = sender;
    senderButton.setAttribute("aria-haspopup", "menu");
    senderButton.setAttribute("aria-label", `فتح تحكم ميكروفون ${sender}`);
    senderButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openStudentChatMicMenu({ anchor: senderButton, socketId: senderButton.dataset.socketId, studentId: senderButton.dataset.studentId, studentName: sender });
    });
    senderWrap.append(senderButton);
    bubble.append(senderWrap);
  } else {
    bubble.append(senderLabel);
  }

  if (safeMessage) {
    const body = document.createElement("span");
    body.className = "chat-message-body";
    appendChatBodyWithLinks(body, safeMessage);
    bubble.append(body);
  }

  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "teacher-chat-question-image";
    image.src = imageUrl;
    image.alt = "صورة واجب أو سؤال مرفقة من التلميذ";
    image.loading = "lazy";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "تكبير صورة سؤال التلميذ");
    image.addEventListener("click", () => openQuestionImageModal(imageUrl));
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openQuestionImageModal(imageUrl);
      }
    });
    bubble.append(image);
  }

  elements.chatBox.append(bubble);

  if (shouldFollowNewestMessage) {
    requestAnimationFrame(() => {
      elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
    });
  }

  return bubble;
}

function updateTeacherChatImagePreview() {
  const hasImage = Boolean(pendingTeacherChatImageData);
  if (elements.chatImagePreview) elements.chatImagePreview.hidden = !hasImage;
  if (elements.chatImagePreviewImage) {
    elements.chatImagePreviewImage.hidden = !hasImage;
    elements.chatImagePreviewImage.src = hasImage ? pendingTeacherChatImageData : "";
  }
  if (elements.chatImageRemoveButton) elements.chatImageRemoveButton.disabled = !hasImage;
  updateControls();
}

function clearTeacherChatImage() {
  pendingTeacherChatImageData = "";
  updateTeacherChatImagePreview();
}

function imageFileToTeacherChatDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!SUPPORTED_TEACHER_CHAT_IMAGE_TYPES.has(file?.type?.toLowerCase())) {
      reject(new Error("الصيغ المدعومة هي PNG وJPEG وWebP فقط."));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const maxDimension = 1280;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("تعذر تجهيز الصورة للإرسال.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let dataUrl = canvas.toDataURL("image/jpeg", 0.78);
        if (dataUrl.length > MAX_TEACHER_CHAT_IMAGE_DATA_URL_LENGTH) {
          dataUrl = canvas.toDataURL("image/jpeg", 0.62);
        }
        if (dataUrl.length > MAX_TEACHER_CHAT_IMAGE_DATA_URL_LENGTH) {
          throw new Error("الصورة كبيرة جدًا. الصق صورة أصغر حجمًا.");
        }
        resolve(dataUrl);
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("تعذر قراءة الصورة الملصوقة."));
    };
    image.src = objectUrl;
  });
}

async function handleTeacherChatPaste(event) {
  const imageItems = Array.from(event.clipboardData?.items || []).filter(
    (clipboardItem) => clipboardItem.kind === "file" && clipboardItem.type.startsWith("image/")
  );
  const item = imageItems.find((clipboardItem) => SUPPORTED_TEACHER_CHAT_IMAGE_TYPES.has(clipboardItem.type.toLowerCase()));
  const file = item?.getAsFile?.();
  if (!file) {
    if (imageItems.length) {
      event.preventDefault();
      setStudioStatus("الصيغ المدعومة هي PNG وJPEG وWebP فقط.", "error");
    }
    return;
  }

  event.preventDefault();
  try {
    pendingTeacherChatImageData = await imageFileToTeacherChatDataUrl(file);
    updateTeacherChatImagePreview();
    setStudioStatus("تمت إضافة الصورة. اضغط إرسال لإرسالها للتلاميذ.", "success");
  } catch (error) {
    clearTeacherChatImage();
    setStudioStatus(error.message || "تعذر تجهيز الصورة الملصوقة.", "error");
  }
}

async function loadQuestionImage(imageId) {
  const token = sessionStorage.getItem("teacherToken");
  if (!token || !imageId) {
    throw new Error("تعذر التحقق من صلاحية عرض صورة السؤال.");
  }

  const response = await fetch(`/api/live-chat/question-image/${encodeURIComponent(imageId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "image/*" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "تعذر تحميل صورة السؤال.");
  }

  const imageUrl = URL.createObjectURL(await response.blob());
  renderedQuestionImageUrls.add(imageUrl);
  return imageUrl;
}

function clearTeacherChat() {
  if (!elements.chatBox) {
    return;
  }

  closeQuestionImageModal();
  renderedQuestionImageUrls.forEach((url) => URL.revokeObjectURL(url));
  renderedQuestionImageUrls.clear();
  elements.chatBox.replaceChildren();
  const empty = document.createElement("p");
  empty.id = "chat-empty";
  empty.className = "chat-empty";
  empty.textContent = "لا توجد رسائل بعد.";
  elements.chatBox.append(empty);
  elements.chatEmpty = empty;
}

async function restoreTeacherChatHistory(messages = []) {
  clearTeacherChat();
  for (const entry of Array.isArray(messages) ? messages : []) {
    if (!entry?.message && !entry?.imageId && !entry?.imageData) continue;

    let imageUrl = entry.imageData || null;
    if (!imageUrl && entry.imageId) {
      try {
        imageUrl = await loadQuestionImage(entry.imageId);
      } catch (error) {
        console.warn("Unable to restore a student chat image:", error);
      }
    }

    appendTeacherChatMessage({
      sender: entry.kind === "teacher" ? "الأستاذ" : entry.studentName || "تلميذ",
      message: entry.message || "",
      kind: entry.kind === "teacher" ? "teacher" : "student",
      imageUrl,
      studentSocketId: entry.socketId || "",
      studentId: entry.studentId || "",
    });
  }
}

async function sendTeacherChatMessage(event) {
  event.preventDefault();

  const message = normalizeChatMessage(elements.chatInput.value);
  const imageData = pendingTeacherChatImageData;
  if (!classActive || !activeLevel || (!message && !imageData)) {
    return;
  }

  elements.chatSendButton.disabled = true;

  try {
    await emitWithAcknowledgement("teacher_send_message", {
      level: activeLevel,
      message,
      imageData,
    });

    appendTeacherChatMessage({ sender: "أنا", message, kind: "teacher", imageUrl: imageData || null });
    elements.chatInput.value = "";
    clearTeacherChatImage();
  } catch (error) {
    console.error("Unable to send teacher chat message:", error);
    setStudioStatus(error.message || "تعذر إرسال الرسالة.", "error");
  } finally {
    updateControls();
  }
}

function setButtonLabel(button, label) {
  const labelElement = button.querySelector("span");
  if (labelElement) {
    labelElement.textContent = label;
  }
}

/** Clamp a normalized annotation coordinate to the valid canvas range. */
function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value)));
}

function isValidAnnotationSegment(data) {
  return Boolean(
    data &&
    typeof data.color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(data.color) &&
    [data.x0, data.y0, data.x1, data.y1].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1) &&
    Number.isFinite(Number(data.lineWidth)) &&
    Number(data.lineWidth) >= 1 &&
    Number(data.lineWidth) <= 12
  );
}

function getTeacherAnnotationContext() {
  return elements.teacherCanvas?.getContext("2d") || null;
}

function getTeacherCanvasCssSize() {
  const width = Math.round(elements.videoStage?.clientWidth || elements.localVideo?.clientWidth || 0);
  const height = Math.round(elements.videoStage?.clientHeight || elements.localVideo?.clientHeight || 0);
  return { width, height };
}

function drawTeacherSegment(segment) {
  const context = getTeacherAnnotationContext();
  const { width, height } = getTeacherCanvasCssSize();
  if (!context || width < 1 || height < 1) {
    return;
  }

  context.save();
  context.beginPath();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = segment.color;
  context.lineWidth = Number(segment.lineWidth);
  context.moveTo(clampUnit(segment.x0) * width, clampUnit(segment.y0) * height);
  context.lineTo(clampUnit(segment.x1) * width, clampUnit(segment.y1) * height);
  context.stroke();
  context.restore();
}

function redrawTeacherBoard() {
  const context = getTeacherAnnotationContext();
  const { width, height } = getTeacherCanvasCssSize();
  if (!context || width < 1 || height < 1) {
    return;
  }

  context.clearRect(0, 0, width, height);
  if (elements.videoStage?.classList.contains("welcome-mode")) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  annotationSegments.forEach(drawTeacherSegment);
}

/** Match the backing store to the displayed video while retaining existing ink. */
function resizeTeacherCanvas() {
  const canvas = elements.teacherCanvas;
  const { width, height } = getTeacherCanvasCssSize();
  if (!canvas || width < 1 || height < 1) {
    return;
  }

  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const backingWidth = Math.round(width * pixelRatio);
  const backingHeight = Math.round(height * pixelRatio);

  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = getTeacherAnnotationContext();
    context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  redrawTeacherBoard();
}

function getNormalizedTeacherPoint(event) {
  const rect = elements.teacherCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  return {
    x: clampUnit((event.clientX - rect.left) / rect.width),
    y: clampUnit((event.clientY - rect.top) / rect.height),
  };
}

function makeAnnotationSegment(start, end) {
  return {
    x0: start.x,
    y0: start.y,
    x1: end.x,
    y1: end.y,
    color: elements.annotationColor.value,
    lineWidth: Number(elements.annotationLineWidth.value),
  };
}

function broadcastTeacherSegment(segment) {
  if (!classActive || !activeLevel || !socket.connected) {
    return;
  }

  socket.emit("draw_data", { level: activeLevel, ...segment });
}

function handleAnnotationMouseDown(event) {
  if (!classActive || isEnding || event.button !== 0) {
    return;
  }

  const point = getNormalizedTeacherPoint(event);
  if (!point) {
    return;
  }

  isDrawingAnnotation = true;
  previousAnnotationPoint = point;
  event.preventDefault();
}

function handleAnnotationMouseMove(event) {
  if (!isDrawingAnnotation || !previousAnnotationPoint) {
    return;
  }

  const point = getNormalizedTeacherPoint(event);
  if (!point) {
    return;
  }

  const segment = makeAnnotationSegment(previousAnnotationPoint, point);
  annotationSegments.push(segment);
  drawTeacherSegment(segment);
  broadcastTeacherSegment(segment);
  previousAnnotationPoint = point;
  event.preventDefault();
}

function stopAnnotationDrawing() {
  isDrawingAnnotation = false;
  previousAnnotationPoint = null;
}

function clearTeacherBoard({ broadcast = false } = {}) {
  annotationSegments.length = 0;
  const context = getTeacherAnnotationContext();
  const { width, height } = getTeacherCanvasCssSize();
  context?.clearRect(0, 0, width, height);
  stopAnnotationDrawing();

  if (broadcast && classActive && activeLevel && socket.connected) {
    socket.emit("clear_board", { level: activeLevel });
  }
}

function initializeTeacherCanvas() {
  const canvas = elements.teacherCanvas;
  if (!canvas) {
    return;
  }

  canvas.addEventListener("mousedown", handleAnnotationMouseDown);
  canvas.addEventListener("mousemove", handleAnnotationMouseMove);
  canvas.addEventListener("mouseup", stopAnnotationDrawing);
  canvas.addEventListener("mouseout", stopAnnotationDrawing);
  canvas.addEventListener("mouseleave", stopAnnotationDrawing);
  elements.clearBoardButton?.addEventListener("click", () => {
    clearTeacherBoard({ broadcast: true });
  });
  elements.localVideo?.addEventListener("loadedmetadata", resizeTeacherCanvas);
  window.addEventListener("resize", resizeTeacherCanvas);
  resizeTeacherCanvas();
}

function getAllAudioTracks() {
  // The teacher mic button controls only the teacher microphone. Screen/system
  // audio remains an independent source in the central Mix-Minus graph.
  return cameraStream?.getAudioTracks?.() || [];
}

function isLocalRecording() {
  return Boolean(localMediaRecorder && localMediaRecorder.state === "recording");
}

function canRecordLocalClass() {
  return Boolean(
    classActive &&
    screenStream?.getVideoTracks?.().some((track) => track.readyState === "live") &&
    typeof window.MediaRecorder === "function"
  );
}

function getLocalRecordingMimeType() {
  if (typeof window.MediaRecorder !== "function" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  return [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

function getLocalRecordingFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `recording-${stamp}.webm`;
}

function disposeLocalRecordingResources() {
  if (localRecordingAnimationFrame) {
    window.cancelAnimationFrame(localRecordingAnimationFrame);
    localRecordingAnimationFrame = null;
  }
  localRecordingVideoElement?.pause?.();
  if (localRecordingVideoElement) localRecordingVideoElement.srcObject = null;
  localRecordingVideoElement = null;
  localRecordingCanvas = null;
  localRecordingCanvasContext = null;
  if (localRecordingVideoTrack) {
    localRecordingVideoTrack.stop();
    localRecordingVideoTrack = null;
  }
  localRecordingIs1080p = false;

  if (localRecordingSourceSyncTimer) {
    window.clearInterval(localRecordingSourceSyncTimer);
    localRecordingSourceSyncTimer = null;
  }

  localRecordingSourceNodes.forEach(({ node }) => {
    try {
      node.disconnect();
    } catch {
      // The node may already be disconnected during recorder cleanup.
    }
  });
  localRecordingSourceNodes.clear();

  if (localRecordingMixedAudioTrack) {
    localRecordingMixedAudioTrack.stop();
  }
  localRecordingMixedAudioTrack = null;
  localRecordingAudioDestination = null;
  localRecordingStream = null;
  const context = localRecordingAudioContext;
  localRecordingAudioContext = null;
  if (context && context.state !== "closed") {
    context.close().catch(() => {});
  }
}

function syncLocalRecordingAudioSources() {
  if (!localRecordingAudioContext || !localRecordingAudioDestination) {
    return;
  }

  const activeSources = new Map(
    Array.from(classroomAudioSources.entries())
      .filter(([, source]) => source?.enabled !== false)
      .map(([sourceKey, source]) => [sourceKey, source?.stream])
  );

  // Keep recording resilient if it starts during the brief period before the
  // classroom graph has registered the teacher or screen source.
  const fallbackSources = new Map([
    ["__teacher_microphone__", cameraStream],
    ["__screen_audio__", screenStream],
  ]);
  fallbackSources.forEach((stream, sourceKey) => {
    if (!activeSources.has(sourceKey)) {
      activeSources.set(sourceKey, stream);
    }
  });

  Array.from(activeSources.entries()).forEach(([sourceKey, stream]) => {
    if (!stream?.getAudioTracks?.().some((track) => track.readyState === "live")) {
      activeSources.delete(sourceKey);
    }
  });

  localRecordingSourceNodes.forEach(({ stream, node }, sourceKey) => {
    const currentStream = activeSources.get(sourceKey);
    if (currentStream === stream) {
      return;
    }

    try {
      node.disconnect();
    } catch {
      // The source may already be disconnected during a stream replacement.
    }
    localRecordingSourceNodes.delete(sourceKey);
  });

  activeSources.forEach((stream, sourceKey) => {
    if (localRecordingSourceNodes.has(sourceKey)) {
      return;
    }

    try {
      const node = localRecordingAudioContext.createMediaStreamSource(stream);
      node.connect(localRecordingAudioDestination);
      localRecordingSourceNodes.set(sourceKey, { stream, node });
    } catch (error) {
      console.warn("Unable to add an audio source to the local recording:", error);
    }
  });
}

function build1080pRecordingVideoTrack(sourceTrack) {
  const CanvasConstructor = window.HTMLCanvasElement;
  const VideoConstructor = window.HTMLVideoElement;
  if (!sourceTrack || !CanvasConstructor || !VideoConstructor || typeof CanvasConstructor.prototype.captureStream !== "function") {
    return sourceTrack;
  }

  const canvas = document.createElement("canvas");
  canvas.width = LOCAL_RECORDING_WIDTH;
  canvas.height = LOCAL_RECORDING_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return sourceTrack;

  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([sourceTrack]);
  void video.play().catch(() => {});

  localRecordingCanvas = canvas;
  localRecordingCanvasContext = context;
  localRecordingVideoElement = video;
  const drawFrame = () => {
    if (!localRecordingCanvasContext || !localRecordingVideoElement) return;
    const sourceWidth = video.videoWidth || 16;
    const sourceHeight = video.videoHeight || 9;
    const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
    }
    localRecordingAnimationFrame = window.requestAnimationFrame(drawFrame);
  };
  drawFrame();

  const capturedStream = canvas.captureStream(LOCAL_RECORDING_FRAME_RATE);
  const capturedTrack = capturedStream.getVideoTracks()[0];
  if (!capturedTrack) {
    disposeLocalRecordingResources();
    return sourceTrack;
  }
  localRecordingVideoTrack = capturedTrack;
  localRecordingIs1080p = true;
  return capturedTrack;
}

function buildLocalRecordingStream() {
  const sourceVideoTrack = screenStream?.getVideoTracks?.().find((track) => track.readyState === "live");
  if (!sourceVideoTrack) {
    throw new Error("لا توجد شاشة نشطة لتسجيل الحصة.");
  }

  const videoTrack = build1080pRecordingVideoTrack(sourceVideoTrack);
  const recordingStream = new MediaStream([videoTrack]);

  // Recording must use the live audio sources, not only the teacher's local
  // streams. The classroom audio graph keeps each incoming student's stream in
  // classroomAudioSources; approved student sources have enabled === true.
  // Creating a separate recording graph leaves the WebRTC/Mix-Minus graph intact.
  const recordingSourceStreams = Array.from(classroomAudioSources.values())
    .filter((source) => source?.enabled !== false)
    .map((source) => source?.stream)
    .filter((stream) => stream?.getAudioTracks?.().some((track) => track.readyState === "live"));

  const fallbackSourceStreams = [screenStream, cameraStream]
    .filter(Boolean)
    .filter((stream) => stream.getAudioTracks().some((track) => track.readyState === "live"));

  const uniqueAudioStreams = Array.from(new Set(
    (recordingSourceStreams.length ? recordingSourceStreams : fallbackSourceStreams)
  ));
  const liveAudioTracks = uniqueAudioStreams
    .flatMap((stream) => stream.getAudioTracks())
    .filter((track) => track.readyState === "live");

  if (!liveAudioTracks.length) {
    return recordingStream;
  }

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    // This is only a legacy fallback for browsers without Web Audio. Browsers
    // supporting the live classroom should use the mixed recording path below.
    recordingStream.addTrack(liveAudioTracks[0]);
    return recordingStream;
  }

  const audioContext = new AudioContextConstructor();
  const destination = audioContext.createMediaStreamDestination();
  localRecordingAudioContext = audioContext;
  localRecordingAudioDestination = destination;
  localRecordingSourceNodes = new Map();
  syncLocalRecordingAudioSources();

  // A student can be approved after recording starts. This timer belongs only
  // to the recorder and lets the recording graph add that student's source
  // without changing any classroom WebRTC or Mix-Minus connections.
  localRecordingSourceSyncTimer = window.setInterval(syncLocalRecordingAudioSources, 500);

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  localRecordingMixedAudioTrack = destination.stream.getAudioTracks()[0] || null;
  if (localRecordingMixedAudioTrack) {
    recordingStream.addTrack(localRecordingMixedAudioTrack);
  }

  return recordingStream;
}

function createLocalRecordingArtifact(chunks, mimeType) {
  if (!chunks.length) {
    return null;
  }

  const blob = new Blob(chunks, { type: mimeType || "video/webm" });
  if (blob.size === 0) {
    return null;
  }

  return { ...getLocalRecordingMetadata(), blob };
}

function downloadLocalRecording(recording) {
  if (!recording?.blob || !recording.fileName) {
    return false;
  }

  const fileUrl = URL.createObjectURL(recording.blob);
  const link = document.createElement("a");
  link.href = fileUrl;
  link.download = recording.fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
  return true;
}

function getLocalRecordingMetadata() {
  const safeLabel = (value, fallback) => String(value || fallback)
    .trim()
    .replace(/[\\/:*?\"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48) || fallback;
  const fileName = getLocalRecordingFileName();
  return {
    fileName,
    mimeType: localRecordingMimeType || "video/webm",
    level: safeLabel(activeLevel, "حصص مباشرة"),
    classType: safeLabel(getClassTypeName(activeLevel, activeSubject), "تسجيل"),
    registryLevel: activeLevel || "",
    registrySubject: activeSubject || "",
    recordedAt: localRecordingStartedAt ? new Date(localRecordingStartedAt).toISOString() : new Date().toISOString(),
    recordingWidth: localRecordingIs1080p ? LOCAL_RECORDING_WIDTH : null,
    recordingHeight: localRecordingIs1080p ? LOCAL_RECORDING_HEIGHT : null,
    recordingFrameRate: localRecordingIs1080p ? LOCAL_RECORDING_FRAME_RATE : null,
  };
}

function updateDriveUploadUi({ visible = false, text = "", progress = 0 } = {}) {
  elements.driveUploadState.hidden = !visible;
  elements.driveUploadText.textContent = text;
  elements.driveUploadProgress.value = Math.max(0, Math.min(100, Number(progress) || 0));
}

function updateYoutubeUploadUi({ visible = false, text = "", progress = 0 } = {}) {
  if (!elements.youtubeUploadState) return;
  elements.youtubeUploadState.hidden = !visible;
  elements.youtubeUploadText.textContent = text;
  elements.youtubeUploadProgress.value = Math.max(0, Math.min(100, Number(progress) || 0));
}

async function uploadRecordingToYouTube(recording) {
  if (!recording?.blob || youtubeUploadInProgress) return null;
  
  // Ensure the blob is not empty and has a correct type
  if (recording.blob.size === 0) {
    console.error("YouTube Upload Error: Recording blob is empty.");
    updateYoutubeUploadUi({ visible: true, text: "تعذر رفع التسجيل: ملف الفيديو فارغ. يرجى إعادة المحاولة.", progress: 0 });
    return null;
  }

  const token = sessionStorage.getItem("teacherToken");
  if (!token) {
    updateYoutubeUploadUi({ visible: true, text: "تعذر رفع التسجيل: انتهت جلسة الأستاذ. احفظه يدوياً في Google Drive.", progress: 0 });
    return null;
  }

  youtubeUploadInProgress = true;
  updateYoutubeUploadUi({ visible: true, text: "جارٍ رفع تسجيل الحصة إلى YouTube…", progress: 8 });
  updateControls();
  try {
    // Ensure the blob has a video mime type to prevent YouTube from seeing it as text/plain
    const videoBlob = recording.blob.type.startsWith("video/") 
      ? recording.blob 
      : new Blob([recording.blob], { type: "video/webm" });
      
    console.log(`Preparing YouTube upload. Original Type: ${recording.blob.type}, Final Type: ${videoBlob.type}, Size: ${videoBlob.size}`);
    
    const formData = new FormData();
    formData.append("video", videoBlob, recording.fileName || "recording.webm");
    formData.append("level", recording.registryLevel || recording.level || "");
    formData.append("subject", recording.registrySubject || "");
    formData.append("recordedAt", recording.recordedAt || new Date().toISOString());
    formData.append("title", `حصة ${recording.classType || "مباشرة"} — ${recording.registryLevel || recording.level || "الأكاديمية"}`.slice(0, 100));
    formData.append("description", `تسجيل تلقائي من أكاديمية التفوق للفيزياء والرياضيات\nالمستوى: ${recording.registryLevel || recording.level}\nنوع الحصة: ${recording.classType || recording.registrySubject}`);

    const response = await fetch("/api/youtube/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر رفع التسجيل إلى YouTube.");

    const registryMessage = payload.data?.registryClass
      ? " وتم ربطه تلقائياً بسجل الحصة الرسمية وإتاحته حسب الصلاحيات."
      : " هذا تسجيل تجريبي محفوظ على YouTube فقط ولم يُدرج في السجل الرسمي.";
    updateYoutubeUploadUi({ visible: true, text: `✅ تم الرفع لـ YouTube كفيديو غير مدرج${registryMessage}`, progress: 100 });
    setStudioStatus(
      payload.data?.registryClass
        ? "✅ تم رفع الحصة الرسمية وربطها بالسجل تلقائياً."
        : "✅ تم حفظ التسجيل التجريبي على YouTube فقط.",
      "live"
    );
    window.dispatchEvent(new CustomEvent("class-registry-refresh"));
    return payload.data || null;
  } catch (error) {
    console.error("Unable to upload the class recording to YouTube:", error);
    updateYoutubeUploadUi({ visible: true, text: error.message || "تعذر رفع التسجيل إلى YouTube. يمكنك حفظه يدوياً في Google Drive.", progress: 0 });
    if (classActive && !isEnding) setStudioStatus(error.message || "تعذر رفع التسجيل إلى YouTube.", "error");
    return null;
  } finally {
    youtubeUploadInProgress = false;
    updateControls();
  }
}

function isGoogleDriveTokenUsable() {
  return Boolean(googleDriveAccessToken && Date.now() < googleDriveTokenExpiresAt - 60_000);
}

function ensureGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (googleIdentityLoadPromise) {
    return googleIdentityLoadPromise;
  }

  googleIdentityLoadPromise = new Promise((resolve, reject) => {
    const scriptId = "google-identity-services";
    let script = document.getElementById(scriptId);
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.defer = true;
      document.head.append(script);
    }

    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearInterval(checkTimer);
      window.clearTimeout(timeoutTimer);
      callback(value);
    };
    const ready = () => {
      if (window.google?.accounts?.oauth2) {
        finish(resolve);
      }
    };
    const checkTimer = window.setInterval(ready, 100);
    const timeoutTimer = window.setTimeout(() => {
      finish(reject, new Error("تعذر تحميل خدمة Google. تحقق من اتصال الإنترنت أو من أن Chrome لا يمنع accounts.google.com."));
    }, 10_000);
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", () => {
      finish(reject, new Error("تعذر تحميل خدمة Google. تحقق من اتصال الإنترنت أو من أن Chrome لا يمنع accounts.google.com."));
    }, { once: true });
    ready();
  }).finally(() => {
    if (!window.google?.accounts?.oauth2) {
      googleIdentityLoadPromise = null;
    }
  });

  return googleIdentityLoadPromise;
}

async function requestGoogleDriveAccessToken() {
  if (isGoogleDriveTokenUsable()) {
    return googleDriveAccessToken;
  }

  await ensureGoogleIdentityServices();

  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_DRIVE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        if (response?.error || !response?.access_token) {
          reject(new Error(response?.error_description || "لم يتم منح إذن الحفظ في Google Drive."));
          return;
        }
        googleDriveAccessToken = response.access_token;
        googleDriveTokenExpiresAt = Date.now() + (Number(response.expires_in) || 3_600) * 1_000;
        resolve(googleDriveAccessToken);
      },
      error_callback: (error) => {
        reject(new Error(error?.message || "تم إغلاق نافذة تسجيل الدخول إلى Google."));
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent", include_granted_scopes: false });
  });
}

async function googleDriveRequest(url, options, accessToken) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(details?.error?.message || `تعذر الاتصال بـ Google Drive (${response.status}).`);
  }

  return response;
}

function escapeDriveQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function ensureGoogleDriveFolder(name, parentId, accessToken) {
  const conditions = [
    `name = '${escapeDriveQueryValue(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ];
  if (parentId) {
    conditions.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
  }
  const query = encodeURIComponent(conditions.join(" and "));
  const fields = encodeURIComponent("files(id,name)");
  const listResponse = await googleDriveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=${fields}&pageSize=1`,
    { method: "GET" },
    accessToken
  );
  const existing = await listResponse.json();
  if (existing.files?.[0]?.id) {
    return existing.files[0].id;
  }

  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const createResponse = await googleDriveRequest(
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    },
    accessToken
  );
  const created = await createResponse.json();
  if (!created.id) {
    throw new Error("تعذر إنشاء مجلد التسجيلات في Google Drive.");
  }
  return created.id;
}

async function createGoogleDriveUploadSession(recording, accessToken) {
  const metadata = {
    name: recording.fileName,
    mimeType: recording.mimeType,
    parents: [recording.folderId],
  };
  const response = await googleDriveRequest(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": recording.mimeType,
        "X-Upload-Content-Length": String(recording.blob.size),
      },
      body: JSON.stringify(metadata),
    },
    accessToken
  );
  const sessionUrl = response.headers.get("Location");
  if (!sessionUrl) {
    throw new Error("تعذر تجهيز عملية رفع التسجيل إلى Google Drive.");
  }
  return sessionUrl;
}

async function uploadRecordingToGoogleDrive(recording, accessToken) {
  const rootFolderId = await ensureGoogleDriveFolder(GOOGLE_DRIVE_ROOT_FOLDER, null, accessToken);
  const levelFolderId = await ensureGoogleDriveFolder(recording.level, rootFolderId, accessToken);
  recording.folderId = await ensureGoogleDriveFolder(recording.classType, levelFolderId, accessToken);
  const sessionUrl = await createGoogleDriveUploadSession(recording, accessToken);
  let offset = 0;

  while (offset < recording.blob.size) {
    const end = Math.min(offset + GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE, recording.blob.size);
    const chunk = recording.blob.slice(offset, end);
    const response = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Type": recording.mimeType,
        "Content-Range": `bytes ${offset}-${end - 1}/${recording.blob.size}`,
      },
      body: chunk,
    });

    if (response.status === 308) {
      offset = end;
      updateDriveUploadUi({
        visible: true,
        text: `جارٍ رفع التسجيل إلى Google Drive: ${Math.round((offset / recording.blob.size) * 100)}%`,
        progress: (offset / recording.blob.size) * 100,
      });
      continue;
    }

    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw new Error(details?.error?.message || `تعذر رفع جزء من التسجيل (${response.status}).`);
    }

    return response.json();
  }

  throw new Error("لم يكتمل رفع التسجيل إلى Google Drive.");
}

async function saveLastRecordingToGoogleDrive() {
  if (!lastLocalRecording || googleDriveUploadInProgress) {
    return;
  }

  googleDriveUploadInProgress = true;
  elements.saveDriveButton.disabled = true;
  updateDriveUploadUi({ visible: true, text: "جارٍ فتح موافقة Google Drive…", progress: 0 });

  try {
    const accessToken = await requestGoogleDriveAccessToken();
    updateDriveUploadUi({ visible: true, text: "جارٍ تجهيز مجلد الحصة في Google Drive…", progress: 0 });
    const uploadedFile = await uploadRecordingToGoogleDrive(lastLocalRecording, accessToken);
    updateDriveUploadUi({ visible: true, text: "تم حفظ التسجيل في Google Drive بنجاح.", progress: 100 });
    setStudioStatus("تم حفظ التسجيل في Google Drive.", classActive ? "live" : "neutral");
    if (uploadedFile?.webViewLink) {
      elements.saveDriveButton.dataset.driveFileUrl = uploadedFile.webViewLink;
      setButtonLabel(elements.saveDriveButton, "فتح التسجيل في Google Drive");
    }
  } catch (error) {
    console.error("Unable to upload the class recording to Google Drive:", error);
    updateDriveUploadUi({ visible: true, text: error.message || "تعذر حفظ التسجيل في Google Drive.", progress: 0 });
    setStudioStatus(error.message || "تعذر حفظ التسجيل في Google Drive.", "error");
  } finally {
    googleDriveUploadInProgress = false;
    updateControls();
  }
}

async function stopRecordingAndSaveToGoogleDrive() {
  const permissionPromise = requestGoogleDriveAccessToken();
  const saved = await stopLocalRecording({ download: false });
  if (!saved || !lastLocalRecording) {
    await permissionPromise.catch(() => {});
    return;
  }

  try {
    const accessToken = await permissionPromise;
    googleDriveUploadInProgress = true;
    elements.saveDriveButton.disabled = true;
    updateDriveUploadUi({ visible: true, text: "جارٍ تجهيز مجلد الحصة في Google Drive…", progress: 0 });
    const uploadedFile = await uploadRecordingToGoogleDrive(lastLocalRecording, accessToken);
    updateDriveUploadUi({ visible: true, text: "تم حفظ التسجيل في Google Drive بنجاح.", progress: 100 });
    setStudioStatus("تم حفظ التسجيل في Google Drive.", "live");
    if (uploadedFile?.webViewLink) {
      elements.saveDriveButton.dataset.driveFileUrl = uploadedFile.webViewLink;
      setButtonLabel(elements.saveDriveButton, "فتح التسجيل في Google Drive");
    }
  } catch (error) {
    console.error("Unable to save the class recording to Google Drive:", error);
    updateDriveUploadUi({ visible: true, text: error.message || "تعذر حفظ التسجيل في Google Drive.", progress: 0 });
    setStudioStatus("تعذر الحفظ في Google Drive؛ يمكنك المحاولة من الزر الأخضر.", "error");
  } finally {
    googleDriveUploadInProgress = false;
    updateControls();
  }
}

function showRecordingReadyModal() {
  if (!elements.recordingReadyModal || !lastLocalRecording) return;
  elements.recordingReadyModal.hidden = false;
  elements.recordingReadyModal.classList.add("is-open");
  elements.uploadYoutubeAfterEndButton?.focus();
}

function closeRecordingReadyModal() {
  if (!elements.recordingReadyModal) return;
  elements.recordingReadyModal.hidden = true;
  elements.recordingReadyModal.classList.remove("is-open");
}

function finalizeLocalRecording() {
  if (localRecordingFinalized) {
    return;
  }
  localRecordingFinalized = true;

  const chunks = localRecordingChunks;
  const mimeType = localRecordingMimeType;
  const shouldDownload = localRecordingDownloadRequested;
  const resolver = localRecordingStopResolver;
  const recording = createLocalRecordingArtifact(chunks, mimeType);
  lastLocalRecording = recording;
  elements.saveDriveButton.dataset.driveFileUrl = "";
  setButtonLabel(elements.saveDriveButton, "حفظ آخر تسجيل في Google Drive");
  localMediaRecorder = null;
  localRecordingChunks = [];
  localRecordingStopResolver = null;
  localRecordingStartedAt = 0;
  elements.localRecordingState.hidden = true;
  elements.recordLocalButton.classList.remove("is-recording");
  setButtonLabel(elements.recordLocalButton, "بدء تسجيل الحصة");
  disposeLocalRecordingResources();

  const downloaded = shouldDownload && downloadLocalRecording(recording);
  if (downloaded && classActive && !isEnding && !isPageNavigatingAway) {
    setStudioStatus("تم حفظ تسجيل الحصة محليًا على جهازك.", "live");
  } else if (shouldDownload && !downloaded && classActive && !isEnding) {
    setStudioStatus("تعذر إنشاء ملف التسجيل المحلي.", "error");
  }
  updateControls();
  resolver?.(Boolean(recording));
  if (recording) {
    if (isEnding) showRecordingReadyModal();
    else void uploadRecordingToYouTube(recording);
  }
}

function startLocalRecording() {
  if (!canRecordLocalClass() || isLocalRecording()) {
    return;
  }

  try {
    localRecordingStream = buildLocalRecordingStream();
    const mimeType = getLocalRecordingMimeType();
    const options = mimeType
      ? { mimeType, videoBitsPerSecond: LOCAL_RECORDING_VIDEO_BITRATE, audioBitsPerSecond: LOCAL_RECORDING_AUDIO_BITRATE }
      : { videoBitsPerSecond: LOCAL_RECORDING_VIDEO_BITRATE, audioBitsPerSecond: LOCAL_RECORDING_AUDIO_BITRATE };
    const recorder = new MediaRecorder(localRecordingStream, options);
    localMediaRecorder = recorder;
    localRecordingMimeType = recorder.mimeType || mimeType || "video/webm";
    localRecordingChunks = [];
    localRecordingStartedAt = Date.now();
    localRecordingDownloadRequested = true;
    localRecordingFinalized = false;
    recorder.ondataavailable = (event) => {
      if (event.data?.size) {
        localRecordingChunks.push(event.data);
      }
    };
    recorder.onerror = (event) => {
      console.error("Local class recording failed:", event.error);
      setStudioStatus("تعذر متابعة التسجيل المحلي للحصة.", "error");
    };
    recorder.onstop = finalizeLocalRecording;
    recorder.start(1_000);
    elements.localRecordingState.hidden = false;
    elements.recordLocalButton.classList.add("is-recording");
    setButtonLabel(elements.recordLocalButton, "إيقاف التسجيل والرفع تلقائياً");
    updateControls();
    setStudioStatus(
      localRecordingIs1080p
        ? "جارٍ تسجيل الحصة بدقة 1080p/60fps على جهازك."
        : "جارٍ تسجيل الحصة؛ متصفحك لا يدعم تهيئة 1080p المعزولة.",
      "live"
    );
  } catch (error) {
    console.error("Unable to start local class recording:", error);
    disposeLocalRecordingResources();
    localMediaRecorder = null;
    setStudioStatus("تعذر بدء التسجيل المحلي. استخدم Google Chrome واسمح بمشاركة الشاشة.", "error");
    updateControls();
  }
}

function stopLocalRecording({ download = true } = {}) {
  const recorder = localMediaRecorder;
  if (!recorder) {
    return Promise.resolve(false);
  }

  localRecordingDownloadRequested = download;
  elements.recordLocalButton.disabled = true;
  return new Promise((resolve) => {
    localRecordingStopResolver = resolve;
    if (recorder.state === "inactive") {
      finalizeLocalRecording();
      return;
    }
    try {
      recorder.requestData();
    } catch (_) {
      // requestData is optional; stop() still flushes the final chunk in Chrome.
    }
    try {
      // Force request final data before stopping
      if (recorder.state !== "inactive") {
        recorder.requestData();
      }
      
      recorder.stop();
      
      // Increased delay to ensure all chunks are processed and finalizedLocalRecording is called
      setTimeout(() => {
        if (!localRecordingFinalized) {
          console.warn("Manual finalization fallback triggered.");
          finalizeLocalRecording();
        }
      }, 1500);
    } catch (error) {
      console.warn("Unable to stop local class recorder:", error);
      finalizeLocalRecording();
    }
  });
}

function toggleLocalRecording() {
  if (isLocalRecording()) {
    void stopLocalRecording({ download: false });
  } else {
    startLocalRecording();
  }
}

function handleGoogleDriveButton() {
  const existingFileUrl = elements.saveDriveButton.dataset.driveFileUrl;
  if (existingFileUrl) {
    window.open(existingFileUrl, "_blank", "noopener,noreferrer");
    return;
  }
  void saveLastRecordingToGoogleDrive();
}

function updateControls() {
  const hasAudio = getAllAudioTracks().length > 0;
  if (elements.studioTopbarTitle) {
    const titleLevel = activeLevel || elements.levelSelect?.value || "";
    const titleSubject = activeSubject || elements.subjectSelect?.value || "";
    elements.studioTopbarTitle.textContent = titleLevel === GLOBAL_FREE_LEVEL
      ? "حصة مجانية مفتوحة للجميع"
      : titleLevel && titleSubject
        ? `${getClassTypeName(titleLevel, titleSubject)} - ${titleLevel}`
        : "استوديو البث المباشر";
    elements.studioTopbarTitle.classList.toggle("is-live", Boolean(classActive));
  }

  elements.startButton.disabled = isStarting || isEnding || classActive;
  elements.levelSelect.disabled = isStarting || isEnding || classActive;
  elements.subjectSelect.disabled = isStarting || isEnding || classActive;
  elements.toggleMicButton.disabled = !classActive || !hasAudio || isEnding;
  elements.recordLocalButton.disabled = (!canRecordLocalClass() && !isLocalRecording()) || isEnding;
  elements.saveDriveButton.disabled = !lastLocalRecording || googleDriveUploadInProgress;
  elements.leaveStudioButton.disabled = !classActive || isEnding;
  elements.endClassButton.disabled = !classActive || isEnding;
  if (elements.screenShareButton) {
    elements.screenShareButton.disabled = isStarting || isEnding;
    setButtonLabel(elements.screenShareButton, classActive && screenStream ? "إيقاف الشاشة" : "مشاركة الشاشة");
  }
  elements.chatInput.disabled = !classActive || isEnding;
  elements.chatSendButton.disabled = !classActive || isEnding || (!normalizeChatMessage(elements.chatInput.value) && !pendingTeacherChatImageData);

  const hasSavedClassToResume = Boolean(pendingPageRecovery && !classActive && !isStarting);
  elements.startButton.classList.toggle("is-live", classActive);
  elements.startButton.classList.toggle("is-resume", hasSavedClassToResume);
  setButtonLabel(
    elements.startButton,
    classActive
      ? "الحصة المباشرة نشطة"
      : hasSavedClassToResume
        ? "استئناف الحصة المحفوظة"
        : "بدء الحصة المباشرة"
  );

  const audioIsEnabled = hasAudio && getAllAudioTracks().some((track) => track.enabled);
  setButtonLabel(elements.toggleMicButton, audioIsEnabled ? "إيقاف المايك" : "تشغيل المايك");

}

function updateAttendeeCount() {
  const count = attendeeElements.size;
  if (elements.attendeeCount) {
    elements.attendeeCount.textContent = String(count);
    elements.attendeeCount.setAttribute("aria-label", `عدد الحضور: ${count}`);
  }
  if (elements.sidebarAttendeeCount) elements.sidebarAttendeeCount.textContent = String(count);
  elements.attendeesEmpty.hidden = count > 0;
  filterAttendees();
}

function setSidebarTab(tabName) {
  if (!elements.sidebarTabs.length) return;
  elements.sidebarTabs.forEach((tab) => {
    const active = tab.dataset.sidebarTab === tabName;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  elements.sidebarPanes.forEach((pane) => {
    const active = pane.dataset.sidebarPane === tabName;
    pane.classList.toggle("is-active", active);
    pane.hidden = !active;
  });
}

function setSidebarCollapsed(sidebarName, collapsed) {
  const className = sidebarName === "attendance" ? "attendance-collapsed" : "chat-collapsed";
  const button = sidebarName === "attendance" ? elements.attendanceSidebarToggle : elements.chatSidebarToggle;
  elements.studioLayout?.classList.toggle(className, collapsed);
  button?.setAttribute("aria-expanded", String(!collapsed));
  if (button) button.textContent = sidebarName === "attendance" ? (collapsed ? "‹" : "›") : (collapsed ? "›" : "‹");
  window.requestAnimationFrame(() => resizeTeacherCanvas());
}

function filterAttendees() {
  const query = String(elements.attendeeSearch?.value || "").trim().toLocaleLowerCase("ar");
  attendeeElements.forEach((item) => {
    const name = String(item.querySelector(".attendee-name")?.textContent || "").toLocaleLowerCase("ar");
    item.hidden = Boolean(query && !name.includes(query));
  });
}

function reorderOpenMicrophoneAttendees() {
  const list = elements.attendeesList;
  if (!list) return;

  const items = Array.from(list.children);
  items.sort((first, second) => {
    const firstOpen = first.classList.contains("is-mic-open") ? 1 : 0;
    const secondOpen = second.classList.contains("is-mic-open") ? 1 : 0;
    return secondOpen - firstOpen;
  });
  items.forEach((item) => list.append(item));
}

function formatStudioDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function refreshStudioDuration() {
  if (!elements.studioDuration) return;
  if (!classActive) {
    studioDurationStartedAt = 0;
    elements.studioDuration.hidden = true;
    elements.studioDuration.textContent = "00:00:00";
    return;
  }
  if (!studioDurationStartedAt) studioDurationStartedAt = Date.now();
  const elapsed = Math.max(0, Math.floor((Date.now() - studioDurationStartedAt) / 1000));
  elements.studioDuration.hidden = false;
  elements.studioDuration.textContent = formatStudioDuration(elapsed);
}

window.setInterval(refreshStudioDuration, 1000);

function displayInitials(name) {
  const words = String(name || "تلميذ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("") || "ت";
}

/** Add or refresh a student item without exposing their socket ID visibly. */
function refreshChatStudentSocketTarget(studentId, socketId) {
  const normalizedStudentId = String(studentId || "").trim();
  if (!normalizedStudentId || !socketId) return;
  document.querySelectorAll(".chat-message-sender-button").forEach((button) => {
    if (button.dataset.studentId === normalizedStudentId) {
      button.dataset.socketId = socketId;
    }
  });
}

function upsertAttendee(socketId, studentId, studentName = "تلميذ", participationCount = 0) {
  const stableStudentId = String(studentId || "").trim();
  const previousSocketId = stableStudentId ? attendeeSocketByStudentId.get(stableStudentId) : null;
  if (previousSocketId && previousSocketId !== socketId) {
    // A reconnect may create a new socket before the old disconnect event reaches
    // the teacher. Remove the stale peer and attendee row before rendering the
    // student's new live presence.
    removeStudentConnection(previousSocketId);
  }

  let item = attendeeElements.get(socketId);

  if (item) {
    if (stableStudentId) {
      item.dataset.studentId = stableStudentId;
      attendeeSocketByStudentId.set(stableStudentId, socketId);
      refreshChatStudentSocketTarget(stableStudentId, socketId);
    }
    item.querySelector(".attendee-name").textContent = studentName;
    item.querySelector(".attendee-avatar").textContent = displayInitials(studentName);
    const participation = item.querySelector(".attendee-participation");
    if (participation && Number.isFinite(Number(participationCount))) participation.textContent = `المشاركات: ${Math.max(0, Number(participationCount))}`;
    return item;
  }

  item = document.createElement("li");
  item.className = "attendee-item";
  item.dataset.socketId = socketId;
  if (stableStudentId) item.dataset.studentId = stableStudentId;

  const avatar = document.createElement("span");
  avatar.className = "attendee-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = displayInitials(studentName);

  const details = document.createElement("div");
  details.className = "attendee-details";

  const name = document.createElement("strong");
  name.className = "attendee-name";
  name.textContent = studentName;

  const state = document.createElement("span");
  state.className = "attendee-state";

  const stateDot = document.createElement("span");
  stateDot.className = "attendee-state-dot";
  stateDot.setAttribute("aria-hidden", "true");

  const stateLabel = document.createElement("span");
  stateLabel.textContent = "متصل الآن";

  state.append(stateDot, stateLabel);
  const qos = document.createElement("small");
  qos.className = "attendee-qos";
  qos.textContent = "جودة الاتصال: جارٍ القياس…";
  const participation = document.createElement("small");
  participation.className = "attendee-participation";
  participation.textContent = `المشاركات: ${Math.max(0, Number(participationCount) || 0)}`;
  details.append(name, state, qos, participation);
  item.append(avatar, details);

  elements.attendeesList.append(item);
  attendeeElements.set(socketId, item);
  if (stableStudentId) {
    attendeeSocketByStudentId.set(stableStudentId, socketId);
    refreshChatStudentSocketTarget(stableStudentId, socketId);
  }
  updateAttendeeCount();

  return item;
}

function removeAttendee(socketId) {
  const item = attendeeElements.get(socketId);
  if (item) {
    const studentId = item.dataset.studentId;
    if (studentId && attendeeSocketByStudentId.get(studentId) === socketId) {
      attendeeSocketByStudentId.delete(studentId);
    }
    item.remove();
    attendeeElements.delete(socketId);
    updateAttendeeCount();
  }
}

function removeAttendeeByStudentId(studentId) {
  const socketId = attendeeSocketByStudentId.get(String(studentId || "").trim());
  if (socketId) removeAttendee(socketId);
}

function clearAttendees() {
  attendeeElements.forEach((item) => item.remove());
  attendeeElements.clear();
  attendeeSocketByStudentId.clear();
  updateAttendeeCount();
}

function removeStudentAudio(socketId) {
  const audio = studentAudioElements.get(socketId);
  if (!audio) {
    return;
  }

  audio.pause();
  audio.srcObject = null;
  audio.remove();
  studentAudioElements.delete(socketId);
}

function getClassroomAudioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function rebuildClassroomAudioGraph() {
  // Disconnect every source first. Rebuilding from the authoritative maps keeps
  // the graph idempotent and prevents duplicate connections after renegotiation.
  classroomAudioSources.forEach(({ node }) => {
    try {
      node.disconnect();
    } catch {
      // The node may already be disconnected during cleanup.
    }
  });

  classroomAudioDestinations.forEach((destination, destinationSocketId) => {
    const teacherSource = classroomAudioSources.get("__teacher_microphone__");
    const screenSource = classroomAudioSources.get("__screen_audio__");

    [teacherSource, screenSource].forEach((source) => {
      if (source?.enabled) {
        source.node.connect(destination);
      }
    });

    classroomAudioSources.forEach((source, sourceKey) => {
      if (
        sourceKey !== "__teacher_microphone__" &&
        sourceKey !== "__screen_audio__" &&
        sourceKey !== destinationSocketId &&
        source.enabled
      ) {
        source.node.connect(destination);
      }
    });
  });
}

function removeClassroomAudioSource(sourceKey) {
  const source = classroomAudioSources.get(sourceKey);
  if (!source) {
    return;
  }

  try {
    source.node.disconnect();
  } catch {
    // The source may already be disconnected during class cleanup.
  }
  classroomAudioSources.delete(sourceKey);
  rebuildClassroomAudioGraph();
}

function ensureStudentAudioDestination(studentSocketId) {
  if (!classroomAudioContext || !studentSocketId) {
    return null;
  }

  const existing = classroomAudioDestinations.get(studentSocketId);
  if (existing?.stream?.getAudioTracks?.().some((track) => track.readyState === "live")) {
    return existing;
  }

  if (existing) {
    existing.stream.getTracks().forEach((track) => track.stop());
    classroomAudioDestinations.delete(studentSocketId);
  }

  try {
    const destination = classroomAudioContext.createMediaStreamDestination();
    const track = destination.stream.getAudioTracks()[0];
    if (!track) {
      return null;
    }
    track.contentHint = "speech";
    classroomAudioDestinations.set(studentSocketId, destination);
    rebuildClassroomAudioGraph();
    return destination;
  } catch (error) {
    console.warn("Unable to create the student's mix-minus destination:", error);
    return null;
  }
}

function removeStudentAudioDestination(studentSocketId) {
  const destination = classroomAudioDestinations.get(studentSocketId);
  if (!destination) {
    return;
  }

  try {
    destination.disconnect();
  } catch {
    // MediaStreamAudioDestinationNode may already be detached during cleanup.
  }
  destination.stream.getTracks().forEach((track) => track.stop());
  classroomAudioDestinations.delete(studentSocketId);
  rebuildClassroomAudioGraph();
}

function getStudentAudioTrack(studentSocketId) {
  return classroomAudioDestinations
    .get(studentSocketId)
    ?.stream
    ?.getAudioTracks?.()
    .find((track) => track.readyState === "live") || null;
}

function getStudentAudioSender(peerConnection) {
  return peerConnection?.getSenders?.().find((sender) => sender.__classroomMixMinusAudio === true) || null;
}

function ensureStudentAudioSender(peerConnection, studentSocketId, { renegotiate = true } = {}) {
  const destination = ensureStudentAudioDestination(studentSocketId);
  const audioTrack = getStudentAudioTrack(studentSocketId);
  if (!peerConnection || !destination || !audioTrack || peerConnection.signalingState === "closed") {
    return null;
  }

  const existingSender = getStudentAudioSender(peerConnection);
  if (existingSender) {
    if (existingSender.track !== audioTrack) {
      existingSender.replaceTrack(audioTrack).catch((error) => {
        console.warn("Unable to replace the student's mix-minus audio track:", error);
      });
    }
    return existingSender;
  }

  const sender = peerConnection.addTrack(audioTrack, destination.stream);
  sender.__classroomMixMinusAudio = true;
  sender.__classroomAudioDestinationSocketId = studentSocketId;
  void tuneOutboundSender(sender, "audio");
  if (renegotiate && peerConnection.remoteDescription && peerConnection.signalingState === "stable") {
    void createAndSendOffer(studentSocketId);
  }
  return sender;
}

function syncMixMinusAudioToAllPeers() {
  Object.entries(peerConnections).forEach(([studentSocketId, peerConnection]) => {
    ensureStudentAudioSender(peerConnection, studentSocketId);
  });
}

function applyStudentMicrophoneState(studentSocketId, enabled) {
  if (!studentSocketId) {
    return;
  }

  studentMicStates.set(studentSocketId, Boolean(enabled));

  if (enabled) {
    approvedStudentMicrophones.add(studentSocketId);
  } else {
    approvedStudentMicrophones.delete(studentSocketId);
  }

  const attendee = attendeeElements.get(studentSocketId);
  if (attendee) {
    attendee.classList.remove("is-hand-raised");
    attendee.classList.toggle("is-mic-open", Boolean(enabled));
    attendee.querySelector(".attendee-hand")?.remove();
    syncStudentMicButton(attendee, studentSocketId, Boolean(enabled));
    reorderOpenMicrophoneAttendees();
  }

  const source = classroomAudioSources.get(studentSocketId);
  if (source) {
    source.enabled = Boolean(enabled);
  }
  // Rebuild all destinations so this student's audio reaches every other
  // student immediately, but never reaches the destination owned by this one.
  rebuildClassroomAudioGraph();
}

function getLiveScreenAudioTrack() {
  return screenStream?.getAudioTracks?.().find((track) => track.readyState === "live") || null;
}

function getActiveTeacherVideoTrack() {
  return screenStream?.getVideoTracks?.().find((track) => track.readyState === "live") || null;
}

const LEVEL_WELCOME_IMAGES = {
  "السنة الأولى": "/assets/level-welcome/year-1.webp",
  "السنة الثانية": "/assets/level-welcome/year-2.webp",
  "السنة الثالثة": "/assets/level-welcome/year-3.webp",
  "السنة الرابعة": "/assets/level-welcome/year-4.jpg",
};

function setTeacherWelcomeImage(levelName) {
  const imageUrl = LEVEL_WELCOME_IMAGES[levelName];
  if (!elements.teacherWelcomeImage || !imageUrl) return;
  elements.teacherWelcomeImage.src = imageUrl;
  elements.teacherWelcomeImage.alt = `صورة انتظار ${levelName} متوسط`;
}

async function syncTeacherVideoTrackToAllPeers() {
  const track = getActiveTeacherVideoTrack();
  if (!track) return { updated: 0, failed: 0 };
  const operations = Object.entries(peerConnections).map(async ([studentSocketId, peerConnection]) => {
    const sender = peerConnection.getSenders?.().find((item) => item.__classroomVideoTrack === true);
    if (sender) {
      if (sender.track !== track) await sender.replaceTrack(track);
      return true;
    }
    if (!screenStream) return false;
    const nextSender = peerConnection.addTrack(track, screenStream);
    nextSender.__classroomVideoTrack = true;
    void tuneOutboundSender(nextSender, "video");
    if (peerConnection.remoteDescription && peerConnection.signalingState === "stable") {
      void createAndSendOffer(studentSocketId);
    }
    return true;
  });
  const results = await Promise.allSettled(operations);
  return {
    updated: results.filter((result) => result.status === "fulfilled" && result.value === true).length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

function addClassroomAudioSource(sourceKey, stream, { enabled = true } = {}) {
  if (!classroomAudioContext || !stream?.getAudioTracks?.().length) {
    return false;
  }

  removeClassroomAudioSource(sourceKey);

  try {
    const node = classroomAudioContext.createMediaStreamSource(stream);
    classroomAudioSources.set(sourceKey, { node, stream, enabled: Boolean(enabled) });
    rebuildClassroomAudioGraph();
    return true;
  } catch (error) {
    console.warn("Unable to add an audio source to the classroom mix-minus graph:", error);
    return false;
  }
}

function clearClassroomAudioGraph() {
  classroomAudioSources.forEach(({ node }) => {
    try {
      node.disconnect();
    } catch {
      // The source may already be disconnected during class cleanup.
    }
  });
  classroomAudioSources.clear();

  classroomAudioDestinations.forEach((destination) => {
    try {
      destination.disconnect();
    } catch {
      // The destination may already be detached during cleanup.
    }
    destination.stream.getTracks().forEach((track) => track.stop());
  });
  classroomAudioDestinations.clear();
}

function primeClassroomAudioContext() {
  const AudioContextConstructor = getClassroomAudioContextConstructor();
  if (!AudioContextConstructor || (classroomAudioContext && classroomAudioContext.state !== "closed")) {
    return;
  }

  try {
    classroomAudioContext = new AudioContextConstructor();
    // Called synchronously from the teacher's Start Class click, preserving the
    // browser gesture needed by iOS/Android to permit a running audio context.
    if (classroomAudioContext.state === "suspended") {
      classroomAudioContext.resume().catch(() => {});
    }
  } catch (error) {
    console.warn("Unable to prime classroom audio:", error);
    classroomAudioContext = undefined;
  }
}

async function initializeClassroomAudioMix() {
  clearClassroomAudioGraph();
  primeClassroomAudioContext();

  if (!classroomAudioContext) {
    console.warn("Web Audio API is unavailable; classroom mix-minus cannot start.");
    return false;
  }

  try {
    if (classroomAudioContext.state === "suspended") {
      await classroomAudioContext.resume();
    }

    addClassroomAudioSource("__teacher_microphone__", cameraStream, { enabled: true });
    addClassroomAudioSource("__screen_audio__", screenStream, { enabled: true });
    return classroomAudioContext.state === "running";
  } catch (error) {
    console.warn("Unable to initialize the classroom mix-minus graph:", error);
    stopClassroomAudioMix();
    return false;
  }
}

function stopClassroomAudioMix() {
  clearClassroomAudioGraph();

  const context = classroomAudioContext;
  classroomAudioContext = undefined;
  if (context && context.state !== "closed") {
    context.close().catch(() => {});
  }
}

/** Play an approved student's microphone locally and add it to the stable class mix. */
function attachStudentAudio(peerConnection, studentSocketId) {
  peerConnection.ontrack = (event) => {
    if (event.track?.kind !== 'audio') {
      return;
    }

    let audio = studentAudioElements.get(studentSocketId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.studentSocketId = studentSocketId;
      audio.setAttribute('aria-hidden', 'true');
      audio.style.display = 'none';
      document.body.append(audio);
      studentAudioElements.set(studentSocketId, audio);
    }

    const incomingStream = event.streams?.[0] || new MediaStream([event.track]);
    audio.srcObject = incomingStream;
    // Every approved student stream is routed into every other student's
    // destination, while the speaking student is excluded from its own mix.
    addClassroomAudioSource(studentSocketId, incomingStream, {
      enabled: approvedStudentMicrophones.has(studentSocketId),
    });
    // The hidden local audio element is the teacher's monitoring path. The Web
    // Audio graph below sends this source only to other students' destinations.
    audio.play().catch((error) => {
      console.warn('Unable to play approved student microphone:', error);
    });

    event.track.addEventListener('ended', () => {
      approvedStudentMicrophones.delete(studentSocketId);
      removeStudentAudio(studentSocketId);
      removeClassroomAudioSource(studentSocketId);
    }, { once: true });
  };
}

function clearIceDisconnectTimer(socketId) {
  if (iceDisconnectTimers[socketId]) {
    window.clearTimeout(iceDisconnectTimers[socketId]);
    delete iceDisconnectTimers[socketId];
  }
}

/**
 * Use one cleanup path for server-reported departures and local ICE failures.
 * It closes the RTCPeerConnection, clears pending candidates/timers, and removes
 * the matching attendance row so no ghost viewer remains in the studio.
 */
function removeStudentConnection(socketId, { statusMessage } = {}) {
  clearIceDisconnectTimer(socketId);
  approvedStudentMicrophones.delete(socketId);
  studentMicStates.delete(socketId);
  closePeerConnection(socketId);
  removeAttendee(socketId);

  if (statusMessage && classActive) {
    setStudioStatus(statusMessage, "error");
  }
}

/**
 * Close one peer connection and remove all associated candidate state. This is
 * called both when a student disconnects and while ending the entire class.
 */
function closePeerConnection(socketId) {
  clearIceDisconnectTimer(socketId);
  const peerConnection = peerConnections[socketId];

  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.oniceconnectionstatechange = null;

    if (peerConnection.signalingState !== "closed") {
      peerConnection.close();
    }

    delete peerConnections[socketId];
  }

  delete pendingIceCandidates[socketId];
  teacherVideoQualityProfiles.delete(socketId);
  removeStudentAudio(socketId);
  removeClassroomAudioSource(socketId);
  removeStudentAudioDestination(socketId);
}

function closeAllPeerConnections() {
  approvedStudentMicrophones.clear();
  studentMicStates.clear();
  closeStudentChatMicMenu();
  Object.keys(peerConnections).forEach(closePeerConnection);
  Object.keys(pendingIceCandidates).forEach((socketId) => {
    delete pendingIceCandidates[socketId];
  });
  stopClassroomAudioMix();
}

/** Apply conservative per-peer quality limits so screen sharing stays smooth
 * under changing bandwidth rather than building a growing latency buffer. */
const teacherQosLast = new Map();
const teacherVideoQualityProfiles = new Map();

function getAdaptiveVideoQualityProfile({ rtt = null, loss = 0 } = {}) {
  if ((rtt != null && rtt > 700) || loss > 12) {
    return { name: "low", scaleResolutionDownBy: 2.5, maxBitrate: 700_000, maxFramerate: 15 };
  }
  if ((rtt != null && rtt > 300) || loss > 5) {
    return { name: "medium", scaleResolutionDownBy: 1.5, maxBitrate: 2_500_000, maxFramerate: 30 };
  }
  return { name: "high", scaleResolutionDownBy: 1, maxBitrate: 6_000_000, maxFramerate: 60 };
}

async function applyAdaptiveVideoQuality(studentSocketId, peerConnection, profile) {
  const videoSender = peerConnection?.getSenders?.().find((sender) => sender.__classroomVideoTrack === true);
  if (!videoSender || typeof videoSender.setParameters !== "function") return;
  if (teacherVideoQualityProfiles.get(studentSocketId) === profile.name) return;

  teacherVideoQualityProfiles.set(studentSocketId, profile.name);
  try {
    const parameters = videoSender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].scaleResolutionDownBy = profile.scaleResolutionDownBy;
    parameters.encodings[0].maxBitrate = profile.maxBitrate;
    parameters.encodings[0].maxFramerate = profile.maxFramerate;
    parameters.degradationPreference = "balanced";
    await videoSender.setParameters(parameters);
  } catch (error) {
    teacherVideoQualityProfiles.delete(studentSocketId);
    console.debug("Adaptive video quality was not applied:", error);
  }
}

async function refreshTeacherQos() {
  for (const [studentSocketId, peerConnection] of Object.entries(peerConnections)) {
    if (!peerConnection || peerConnection.connectionState === "closed") continue;
    const attendee = attendeeElements.get(studentSocketId);
    if (!attendee || typeof peerConnection.getStats !== "function") continue;
    try {
      const report = await peerConnection.getStats();
      let outboundVideo = null;
      let remoteInbound = null;
      report.forEach((entry) => {
        if (entry.type === "outbound-rtp" && entry.kind === "video") outboundVideo = entry;
        if (entry.type === "remote-inbound-rtp" && entry.kind === "video") remoteInbound = entry;
      });
      const previous = teacherQosLast.get(studentSocketId);
      const now = performance.now();
      const seconds = previous ? Math.max(0.1, (now - previous.at) / 1000) : 0;
      const bitrate = outboundVideo && previous?.bytesSent && seconds ? Math.round(((outboundVideo.bytesSent - previous.bytesSent) * 8) / seconds / 1000) : null;
      const framesDropped = outboundVideo?.framesDropped ?? 0;
      const packetsLost = remoteInbound?.packetsLost ?? 0;
      const packetsReceived = remoteInbound?.packetsReceived ?? 0;
      const loss = packetsLost + packetsReceived ? (packetsLost / (packetsLost + packetsReceived)) * 100 : 0;
      const rtt = remoteInbound?.roundTripTime ? Math.round(remoteInbound.roundTripTime * 1000) : null;
      let state = "جيدة";
      let stateClass = "good";
      if ((rtt && rtt > 300) || loss > 5) { state = "متوسطة"; stateClass = "warn"; }
      if ((rtt && rtt > 700) || loss > 12) { state = "ضعيفة"; stateClass = "bad"; }
      const qualityProfile = getAdaptiveVideoQualityProfile({ rtt, loss });
      void applyAdaptiveVideoQuality(studentSocketId, peerConnection, qualityProfile);
      const qos = attendee.querySelector(".attendee-qos");
      if (qos) {
        qos.className = `attendee-qos ${stateClass}`;
        qos.textContent = `${state} · ${rtt == null ? "—" : `${rtt}ms`} · ${bitrate == null ? "—" : `${bitrate}kbps`} · إسقاط ${framesDropped}`;
      }
      teacherQosLast.set(studentSocketId, { at: now, bytesSent: outboundVideo?.bytesSent || 0 });
    } catch (error) {
      console.debug("WebRTC QoS stats unavailable:", error);
    }
  }
}

window.setInterval(() => { void refreshTeacherQos(); }, 3000);

async function tuneOutboundSender(sender, kind) {
  try {
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];

    if (kind === "video") {
      // Let WebRTC's congestion controller adapt bitrate, resolution, and frame
      // rate per learner. The source targets 1080p/60, while the browser may
      // scale down toward a low resolution when bandwidth or CPU is limited.
      parameters.encodings[0].maxBitrate = 6_000_000;
      parameters.encodings[0].maxFramerate = 60;
      parameters.degradationPreference = "balanced";
    } else {
      parameters.encodings[0].maxBitrate = 96_000;
      parameters.encodings[0].priority = "high";
      parameters.encodings[0].networkPriority = "high";
    }

    await sender.setParameters(parameters);
  } catch (error) {
    // Browsers differ in the parameters they permit. The default sender still
    // works, so tuning failure must never terminate the class.
    console.debug("Sender quality tuning was not applied:", error);
  }
}

/**
 * Every learner receives the screen plus one personal copy of the stable
 * classroom mix. The mix is created before the offer, so a late learner starts
 * with the same audio channel as all current attendees.
 */
function addTeacherTracks(peerConnection, studentSocketId) {
  const videoStream = screenStream;
  const videoTrack = videoStream?.getVideoTracks?.().find((track) => track.readyState === "live");
  if (videoTrack) {
    videoTrack.contentHint = "detail";
    const sender = peerConnection.addTrack(videoTrack, videoStream);
    sender.__classroomVideoTrack = true;
    void tuneOutboundSender(sender, "video");
  }

  // Every student receives one unique mix-minus track. It contains the teacher
  // microphone, screen audio, and all approved student sources except this one.
  ensureStudentAudioSender(peerConnection, studentSocketId, { renegotiate: false });
}

/**
 * Create a fresh connection for one student. If a stale connection exists for
 * the same socket ID, close it first so renegotiation cannot reuse bad state.
 */
function createPeerConnection(studentSocketId) {
  closePeerConnection(studentSocketId);

  const peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnections[studentSocketId] = peerConnection;
  pendingIceCandidates[studentSocketId] = [];

  addTeacherTracks(peerConnection, studentSocketId);
  // The first offer contains this learner's unique mix-minus audio track;
  // no peer-to-peer student audio route is created.
  attachStudentAudio(peerConnection, studentSocketId);

  peerConnection.onicecandidate = (event) => {
    // `null` means ICE gathering is complete; it does not need a relay.
    if (!event.candidate || !classActive || !socket.connected) {
      return;
    }

    socket.emit("webrtc_ice_candidate", {
      targetSocketId: studentSocketId,
      candidate: event.candidate.toJSON(),
    });
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "failed") {
      console.warn(`WebRTC connection failed for student ${studentSocketId}.`);
      removeStudentConnection(studentSocketId, {
        statusMessage: "انقطع اتصال أحد التلاميذ وتمت إزالة جلسته.",
      });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    const { iceConnectionState } = peerConnection;

    if (iceConnectionState === "connected" || iceConnectionState === "completed") {
      clearIceDisconnectTimer(studentSocketId);
      return;
    }

    if (iceConnectionState === "failed") {
      console.warn(`ICE failed for student ${studentSocketId}.`);
      removeStudentConnection(studentSocketId, {
        statusMessage: "فشل اتصال أحد التلاميذ وتمت إزالة جلسته.",
      });
      return;
    }

    if (iceConnectionState === "disconnected" && !iceDisconnectTimers[studentSocketId]) {
      // Try an ICE restart before dropping the learner. Temporary NAT or Wi‑Fi
      // changes are common and do not require rebuilding the full classroom.
      iceDisconnectTimers[studentSocketId] = window.setTimeout(async () => {
        const currentPeer = peerConnections[studentSocketId];
        if (currentPeer?.iceConnectionState !== "disconnected") {
          return;
        }

        await createAndSendOffer(studentSocketId, { iceRestart: true });

        iceDisconnectTimers[studentSocketId] = window.setTimeout(() => {
          const recoveredPeer = peerConnections[studentSocketId];
          if (recoveredPeer?.iceConnectionState === "disconnected") {
            removeStudentConnection(studentSocketId, {
              statusMessage: "لم يعد اتصال أحد التلاميذ مستقراً وتمت إزالة جلسته.",
            });
          }
        }, ICE_DISCONNECT_GRACE_MS);
      }, 2_500);
    }
  };

  return peerConnection;
}

/** Relay each queued ICE candidate only after an answer is applied. */
async function flushPendingIceCandidates(studentSocketId) {
  const peerConnection = peerConnections[studentSocketId];
  const candidates = pendingIceCandidates[studentSocketId] || [];

  if (!peerConnection || !peerConnection.remoteDescription) {
    return;
  }

  pendingIceCandidates[studentSocketId] = [];

  for (const candidate of candidates) {
    try {
      // A null candidate simply marks the end of ICE gathering and does not
      // need to be passed to addIceCandidate in this broadcaster flow.
      if (candidate) {
        await peerConnection.addIceCandidate(candidate);
      }
    } catch (error) {
      console.warn("Unable to add a queued ICE candidate:", error);
    }
  }
}

/**
 * Send an event with an acknowledgement timeout. This prevents a disabled UI
 * if the server is unavailable or a route is rejected by server-side checks.
 */
function waitForSocketConnection(timeoutMs = 12_000) {
  if (socket.connected) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      socket.off("connect", handleConnect);
      resolve(connected);
    };
    const handleConnect = () => finish(true);

    socket.once("connect", handleConnect);
    socket.connect();
  });
}

async function emitWithAcknowledgement(eventName, payload, timeoutMs = 10_000) {
  if (!socket.connected) {
    const connected = await waitForSocketConnection(Math.min(timeoutMs, 12_000));
    if (!connected || !socket.connected) {
      throw new Error("تعذر الاتصال بالخادم حالياً. حاول مرة أخرى بعد لحظات.");
    }
  }

  return new Promise((resolve, reject) => {
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

/**
 * Generate and send a distinct SDP offer to the newly joined student. The
 * `makingOffer` flag prevents duplicated student_joined events from creating
 * overlapping offers against the same RTCPeerConnection.
 */
async function createAndSendOffer(studentSocketId, { iceRestart = false } = {}) {
  if (!classActive || !getActiveTeacherVideoTrack()) {
    return;
  }

  let peerConnection = peerConnections[studentSocketId];

  if (!peerConnection) {
    peerConnection = createPeerConnection(studentSocketId);
  }

  if (
    peerConnection.makingOffer ||
    peerConnection.signalingState !== "stable" ||
    peerConnection.connectionState === "closed"
  ) {
    return;
  }

  peerConnection.makingOffer = true;

  try {
    const offer = await peerConnection.createOffer({ iceRestart });
    await peerConnection.setLocalDescription(offer);

    await emitWithAcknowledgement("webrtc_offer", {
      targetSocketId: studentSocketId,
      sdp: peerConnection.localDescription,
    });
  } catch (error) {
    console.error("Unable to create or relay a WebRTC offer:", error);
    setStudioStatus("تعذر ربط أحد التلاميذ بالبث.", "error");
    closePeerConnection(studentSocketId);
  } finally {
    if (peerConnections[studentSocketId]) {
      peerConnections[studentSocketId].makingOffer = false;
    }
  }
}

/** Stop every local media track and clear browser video previews. */
function stopLocalStreams() {
  [screenStream, cameraStream].filter(Boolean).forEach((stream) => {
    stream.getTracks().forEach((track) => {
      // Avoid invoking the screen-share ended handler during intentional cleanup.
      track.onended = null;
      track.stop();
    });
  });

  screenStream = undefined;
  cameraStream = undefined;
  elements.localVideo.srcObject = null;
  setStageMode("idle");
}

/**
 * Stop a class from a deliberate user action, a display-share stop, a server
 * class-ended event, or a socket disconnect. The method is idempotent so
 * multiple events during shutdown cannot cause duplicate room-end requests.
 */
async function resumeLiveClassAfterSocketReconnect() {
  if (!classActive || !activeLevel || !activeSubject || !classResumeToken || reconnectingLiveClass) {
    return;
  }

  if (!socket.connected) {
    return;
  }

  reconnectingLiveClass = true;
  try {
    persistLiveClassRecovery();
    setStudioStatus("عاد الاتصال بالخادم. جارٍ استعادة الحصة دون إيقاف الشاشة…", "live");
    const response = await emitWithAcknowledgement("teacher_start_room", {
      level: activeLevel,
      subject: activeSubject,
      resumeToken: classResumeToken,
    }, 12_000);

    if (!response?.resumed) {
      throw new Error("تعذر استعادة جلسة الحصة الحالية.");
    }

    setStudioStatus("تمت استعادة الحصة. جارٍ إعادة ربط التلاميذ بالبث…", "live");
  } catch (error) {
    console.error("Unable to restore live classroom after Socket reconnect:", error);
    setStudioStatus(error.message || "تعذر استعادة الحصة بعد عودة الاتصال.", "error");
  } finally {
    reconnectingLiveClass = false;
  }
}

async function leaveLiveStudio() {
  if (!classActive || isEnding || !activeLevel || !classResumeToken) {
    return;
  }

  const levelToLeave = activeLevel;
  const resumeToken = classResumeToken;
  persistLiveClassRecovery();
  isPageNavigatingAway = true;
  elements.leaveStudioButton.disabled = true;
  setStudioStatus("تمت مغادرة الاستوديو. تبقى الحصة مفتوحة حتى تعود أو تنهيها صراحةً.", "neutral");

  try {
    if (socket.connected) {
      await emitWithAcknowledgement(
        "teacher_leave_studio",
        { level: levelToLeave, resumeToken },
        5_000
      );
    }
  } catch (error) {
    // A network or power interruption follows the same server-side recovery path
    // through the disconnect handler, so preserving the local recovery token is enough.
    console.warn("Unable to confirm studio departure; preserving class for recovery:", error);
  } finally {
    await stopLocalRecording({ download: false });
    classActive = false;
    closeAllPeerConnections();
    clearAttendees();
    clearTeacherChat();
    clearTeacherChatImage();
    stopLocalStreams();
    activeLevel = null;
    activeSubject = null;
    reconnectingLiveClass = false;
    updateControls();
    window.location.assign("./teacher-dashboard.html");
  }
}

async function endLiveClass({ notifyServer = true, statusMessage } = {}) {
  if (isEnding) {
    return;
  }

  const levelToEnd = activeLevel;
  const hadActiveClass = classActive;
  clearLiveClassRecovery();
  isEnding = true;
  classActive = false;
  updateControls();

  try {
    if (notifyServer && hadActiveClass && levelToEnd && socket.connected) {
      try {
        await emitWithAcknowledgement("teacher_end_class", { level: levelToEnd }, 5_000);
      } catch (error) {
        // The server's disconnect handler closes the class if the connection is
        // lost, so local privacy cleanup must proceed even when this ACK fails.
        console.warn("Unable to confirm class termination with server:", error);
      }
    }
  } finally {
    await stopLocalRecording({ download: false });
    closeAllPeerConnections();
    clearAttendees();
    clearTeacherChat();
    clearTeacherChatImage();
    stopLocalStreams();
    activeLevel = null;
    activeSubject = null;
    classResumeToken = null;
    reconnectingLiveClass = false;
    isPageNavigatingAway = false;
    isEnding = false;
    updateControls();
    setStudioStatus(statusMessage || "تم إنهاء الحصة المباشرة.", "neutral");
  }
}

function getMediaErrorMessage(error, source) {
  if (error?.name === "NotAllowedError") {
    return `لم تسمح للمتصفح بالوصول إلى ${source}.`;
  }

  if (error?.name === "NotFoundError") {
    return `لم يتم العثور على جهاز مناسب لـ${source}.`;
  }

  if (error?.name === "NotReadableError") {
    return `يتعذر استخدام ${source} لأنه مستخدم من تطبيق آخر.`;
  }

  return `تعذر تشغيل ${source}. حاول مرة أخرى.`;
}

/**
 * Acquire display media first, then attempt optional camera/microphone media.
 * The class can safely continue with only the screen stream when camera access
 * is denied or a camera device is unavailable.
 */
async function publishScreenShareState(active) {
  if (!activeLevel || !socket.connected) return;
  const revision = ++screenShareRevision;
  try {
    await emitWithAcknowledgement("teacher_screen_share_state", {
      level: activeLevel,
      active: Boolean(active),
      revision,
    }, 5_000);
  } catch (error) {
    console.warn("Unable to publish screen-share state:", error);
  }
}

async function stopScreenShare() {
  const streamToStop = screenStream;
  screenStream = undefined;
  streamToStop?.getTracks?.().forEach((track) => track.stop());
  if (elements.localVideo)   elements.localVideo.srcObject = null;
  setStageMode(classActive ? "welcome" : "idle");
  removeClassroomAudioSource("__screen_audio__");
  if (classActive) {
    await syncTeacherVideoTrackToAllPeers();
    void publishScreenShareState(false);
  }
  setStudioStatus(classActive ? "عادت صورة المستوى؛ بقيت الحصة والصوت مفتوحين." : "تم إيقاف مشاركة الشاشة.", classActive ? "live" : "neutral");
  updateControls();
}

async function replaceScreenShareStream() {
  if (!classActive || isEnding || !navigator.mediaDevices?.getDisplayMedia) return;
  try {
    const replacement = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 60, max: 60 },
      },
      audio: true,
    });
    const nextVideoTrack = replacement.getVideoTracks()[0];
    if (!nextVideoTrack) throw new Error("لم يتم اختيار شاشة للمشاركة.");
    const previousStream = screenStream;
    screenStream = replacement;
    previousStream?.getTracks?.().forEach((track) => track.stop());
    elements.localVideo.srcObject = replacement;
    setStageMode("screen");
    const syncResult = await syncTeacherVideoTrackToAllPeers();
    if (syncResult.failed > 0) {
      console.warn(`Screen-share track replacement failed for ${syncResult.failed} peer(s).`);
    }
    void publishScreenShareState(true);
    addClassroomAudioSource("__screen_audio__", replacement, { enabled: true });
    syncMixMinusAudioToAllPeers();
    nextVideoTrack.onended = () => void stopScreenShare();
    setStudioStatus("تم تشغيل مشاركة الشاشة للحصة.", "live");
    updateControls();
  } catch (error) {
    setStudioStatus(error?.message || "تعذر تغيير مشاركة الشاشة.", "error");
  }
}

async function toggleScreenShare() {
  if (!classActive) {
    await startLiveClass();
    return;
  }
  if (screenStream?.getVideoTracks?.().some((track) => track.readyState === "live")) {
    await stopScreenShare();
    return;
  }
  await replaceScreenShareStream();
}

async function startLiveClass() {
  if (classActive || isStarting || isEnding) {
    return;
  }

  const selectedLevel = elements.levelSelect.value;
  const selectedSubject = elements.subjectSelect.value;
  const selectedSubjectName = getClassTypeName(selectedLevel, selectedSubject);
  const pageRecovery =
    pendingPageRecovery &&
    pendingPageRecovery.level === selectedLevel &&
    pendingPageRecovery.subject === selectedSubject
      ? pendingPageRecovery
      : null;
  const isResumingAfterPageRefresh = Boolean(pageRecovery);
  isStarting = true;
  let microphoneUnavailableMessage = "";

  try {
    updateControls();
    setStudioStatus("جارٍ بدء الحصة — صورة المستوى والصوت جاهزان…", "neutral");
    // Prepare the level image before any network or device await so students
    // receive a stable visual immediately, even before screen sharing begins.
    clearTeacherChat();
    activeLevel = selectedLevel;
    setTeacherWelcomeImage(selectedLevel);
    setStageMode("welcome");
    // This is still called from the Start Class gesture, but it is inside the
    // guarded flow so an unsupported Web Audio API cannot leave the button stuck.
    primeClassroomAudioContext();

    // Capture only the teacher microphone. The camera is deliberately never
    // requested, previewed, or sent so the teacher's face remains private.
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
      } catch (error) {
        microphoneUnavailableMessage = getMediaErrorMessage(error, "المايك");
        console.warn("Teacher microphone is unavailable:", error);
      }
    }

    // Build the stable class-audio channel before students can receive offers.
    // A missing Web Audio API keeps a teacher-audio fallback instead of blocking class.
    const classroomMixReady = await initializeClassroomAudioMix();
    if (!classroomMixReady) {
      microphoneUnavailableMessage = microphoneUnavailableMessage || "تعذر تجهيز صوت الصف الموحد";
    }

    // Set state before emitting. This prevents a very fast student_joined event
    // from being ignored between the server joining the teacher room and its ACK.
    activeLevel = selectedLevel;
    activeSubject = selectedSubject;
    classResumeToken = pageRecovery?.resumeToken || createClassResumeToken();
    classActive = true;

    // Request screen sharing before any network wait. Browsers require the
    // getDisplayMedia call to remain within the user's button activation.
    if (!socket.connected) {
      setStudioStatus("تم اختيار الشاشة. جارٍ الاتصال بخادم الحصة…", "neutral");
      const connected = await waitForSocketConnection(12_000);
      if (!connected || !socket.connected) {
        throw new Error("تعذر الاتصال بالخادم بعد اختيار الشاشة. حاول مرة أخرى.");
      }
    }

    const roomResponse = await emitWithAcknowledgement("teacher_start_room", {
      level: selectedLevel,
      subject: selectedSubject,
      resumeToken: classResumeToken,
    });

    pendingPageRecovery = null;
    persistLiveClassRecovery();
    const baseMessage = selectedLevel === GLOBAL_FREE_LEVEL
      ? `${isResumingAfterPageRefresh || roomResponse?.resumed ? "تم استئناف الحصة المجانية" : "بدأت الحصة المجانية الآن"} — مفتوحة لجميع الحسابات المسجلة`
      : `${isResumingAfterPageRefresh || roomResponse?.resumed ? "تم استئناف الحصة" : "الحصة مباشرة الآن"} — ${selectedLevel} | ${selectedSubjectName}`;
    setStudioStatus(
      microphoneUnavailableMessage ? `${baseMessage} (بدون مايك)` : baseMessage,
      "live"
    );
    void publishScreenShareState(false);
  } catch (error) {
    console.error("Unable to start live class:", error);
    classActive = false;
    activeLevel = null;
    activeSubject = null;
    if (!isResumingAfterPageRefresh) {
      clearLiveClassRecovery();
      classResumeToken = null;
    }
    closeAllPeerConnections();
    clearAttendees();
    stopLocalStreams();
    setStudioStatus(
      error?.message || getMediaErrorMessage(error, "مشاركة الشاشة"),
      "error"
    );
  } finally {
    isStarting = false;
    updateControls();
  }
}

function toggleMicrophone() {
  const audioTracks = getAllAudioTracks();
  if (!classActive || audioTracks.length === 0) {
    return;
  }

  const shouldEnable = !audioTracks.some((track) => track.enabled);
  audioTracks.forEach((track) => {
    track.enabled = shouldEnable;
  });

  setStudioStatus(shouldEnable ? "تم تشغيل المايك." : "تم إيقاف المايك.", "live");
  updateControls();
}

function syncStudentMicButton(attendee, socketId, enabled = false) {
  let button = attendee.querySelector(".attendee-mic-button");

  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "attendee-mic-button";
    button.addEventListener("click", () => {
      const currentlyEnabled = button.dataset.enabled === "true";
      void setStudentMicrophone(socketId, !currentlyEnabled, button);
    });
    attendee.append(button);
  }

  button.dataset.enabled = String(enabled);
  button.classList.toggle("is-open", enabled);
  button.textContent = enabled ? "إغلاق المايك" : "فتح المايك";
  return button;
}

function markHandRaised(socketId, studentName) {
  const attendee = upsertAttendee(socketId, null, studentName);
  attendee.classList.add("is-hand-raised");

  if (!attendee.querySelector(".attendee-hand")) {
    const handLabel = document.createElement("span");
    handLabel.className = "attendee-hand";
    handLabel.textContent = "طلب التحدث";
    attendee.querySelector(".attendee-details").append(handLabel);
  }

  syncStudentMicButton(attendee, socketId, false);
}

async function setStudentMicrophone(socketId, enabled, button) {
  if (!classActive) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = enabled ? "جارٍ فتح الـ microphone…" : "جارٍ غلق الـ microphone…";
  }

  try {
    await emitWithAcknowledgement("teacher_set_mic", {
      targetSocketId: socketId,
      enabled,
    });

    // Apply locally without waiting for any page navigation. The same server
    // event also reaches this browser, keeping state correct after reconnects.
    applyStudentMicrophoneState(socketId, enabled);

    setStudioStatus(
      enabled ? "تم فتح مايك التلميذ وأصبح صوته مسموعًا للصف." : "تم إغلاق مايك التلميذ.",
      "live"
    );
    closeStudentChatMicMenu();
  } catch (error) {
    console.error("Unable to change the student microphone state:", error);
    if (button) {
      button.textContent = button.dataset.enabled === "true" ? "غلق الـ microphone" : "فتح الـ microphone";
    }
    setStudioStatus(error.message || "تعذر تغيير حالة المايك.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

// --- Classroom and signaling events from the Phase 7 Socket.io backend. ---

socket.on("connect", () => {
  if (classActive && classResumeToken) {
    void resumeLiveClassAfterSocketReconnect();
    return;
  }

  if (isStarting) {
    setStudioStatus("تم الاتصال بالخادم. جارٍ تجهيز الحصة…", "neutral");
    return;
  }

  if (!classActive) {
    setStudioStatus("الاستوديو جاهز", "neutral");
  }
});

socket.on("connect_error", () => {
  if (classActive) {
    setStudioStatus("انقطع اتصال الإشارة. جارٍ استعادة الحصة تلقائياً…", "error");
  } else if (isStarting) {
    setStudioStatus("جارٍ إعادة الاتصال بالخادم قبل بدء الحصة…", "neutral");
  } else {
    setStudioStatus("تعذر الاتصال بخادم الحصص المباشرة. جارٍ إعادة المحاولة…", "neutral");
  }
});

socket.on("room_ready", (data) => {
  if (data?.role === "teacher" && classActive) {
    const statusMessage = data.globalFree
      ? "الحصة المجانية مفتوحة لجميع الحسابات المسجلة"
      : `الحصة مباشرة الآن — ${data.level} | ${getClassTypeName(data.level, data.subject)}`;
    setStudioStatus(statusMessage, "live");
  }
});

socket.on("student_joined", async (data = {}) => {
  const { socketId, studentId, studentName, participationCount } = data;

  if (!classActive || !socketId) {
    return;
  }

  const attendee = upsertAttendee(socketId, studentId, studentName || "تلميذ", participationCount);
  syncStudentMicButton(attendee, socketId, false);
  await createAndSendOffer(socketId);
});

socket.on("student_mic_state_changed", (data = {}) => {
  const { socketId, enabled } = data;
  applyStudentMicrophoneState(socketId, Boolean(enabled));
});

socket.on("student_participation_updated", (data = {}) => {
  if (!data.socketId) return;
  const attendee = attendeeElements.get(data.socketId);
  const participation = attendee?.querySelector(".attendee-participation");
  if (participation) participation.textContent = `المشاركات: ${Math.max(0, Number(data.count) || 0)}`;
});

socket.on("recovery_students", async (data = {}) => {
  if (!classActive || !Array.isArray(data.students)) {
    return;
  }

  for (const student of data.students) {
    if (!student?.socketId) {
      continue;
    }

    const attendee = upsertAttendee(student.socketId, student.studentId, student.studentName || "تلميذ", student.participationCount);
    syncStudentMicButton(attendee, student.socketId, Boolean(student.micEnabled));
    applyStudentMicrophoneState(student.socketId, Boolean(student.micEnabled));
    await createAndSendOffer(student.socketId);
  }
});

socket.on("webrtc_answer", async (data = {}) => {
  const { fromSocketId, sdp } = data;
  const peerConnection = peerConnections[fromSocketId];

  if (!peerConnection || !sdp) {
    return;
  }

  try {
    await peerConnection.setRemoteDescription(sdp);
    await flushPendingIceCandidates(fromSocketId);
    // The first offer already contains this learner's persistent classroom mix,
    // so no per-speaker renegotiation is required after the answer.
  } catch (error) {
    console.error("Unable to apply a student WebRTC answer:", error);
    closePeerConnection(fromSocketId);
  }
});

/**
 * A teacher-approved student may add a microphone track after the initial
 * viewer connection is stable. Receive the student's follow-up offer, create
 * the matching answer, and relay it only to that same student.
 */
socket.on("webrtc_renegotiation_offer", async (data = {}) => {
  const { fromSocketId, sdp } = data;
  const peerConnection = peerConnections[fromSocketId];

  if (
    !classActive ||
    !peerConnection ||
    !sdp ||
    peerConnection.signalingState === "closed"
  ) {
    return;
  }

  try {
    // The student only creates this offer after the initial answer has settled.
    // If a stale/repeated offer arrives during another transition, ignore it
    // rather than corrupting the existing screen-stream connection.
    if (peerConnection.signalingState !== "stable") {
      return;
    }

    await peerConnection.setRemoteDescription(sdp);
    await flushPendingIceCandidates(fromSocketId);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await emitWithAcknowledgement("webrtc_renegotiation_answer", {
      targetSocketId: fromSocketId,
      sdp: peerConnection.localDescription,
    });
  } catch (error) {
    console.error("Unable to answer the student microphone renegotiation:", error);
    setStudioStatus("تعذر تشغيل صوت أحد التلاميذ.", "error");
  }
});

socket.on("webrtc_ice_candidate", async (data = {}) => {
  const { fromSocketId, candidate } = data;
  const peerConnection = peerConnections[fromSocketId];

  if (!fromSocketId || candidate === undefined) {
    return;
  }

  // ICE can arrive before the answer; queue it instead of throwing an
  // InvalidStateError from addIceCandidate.
  if (!peerConnection || !peerConnection.remoteDescription) {
    (pendingIceCandidates[fromSocketId] ||= []).push(candidate);
    return;
  }

  try {
    if (candidate) {
      await peerConnection.addIceCandidate(candidate);
    }
  } catch (error) {
    console.warn("Unable to add a student ICE candidate:", error);
  }
});

socket.on("hand_raised", (data = {}) => {
  if (!data.socketId || !classActive) {
    return;
  }

  markHandRaised(data.socketId, data.studentName || "تلميذ");
  setStudioStatus("هناك طلب جديد للتحدث.", "live");
});

socket.on("hand_lowered", (data = {}) => {
  const attendee = attendeeElements.get(data.socketId);
  if (!attendee) {
    return;
  }

  attendee.classList.remove("is-hand-raised");
  attendee.querySelector(".attendee-hand")?.remove();
  if (classActive) {
    setStudioStatus("ألغى التلميذ طلب التحدث.", "live");
  }
});

socket.on("classroom_chat_history", (data = {}) => {
  if (!classActive || data.level !== activeLevel) return;
  void restoreTeacherChatHistory(data.messages);
});

socket.on("student_message_received", async (data = {}) => {
  if (!classActive || (!data?.message && !data?.imageId)) {
    return;
  }

  let imageUrl = null;
  let fallbackMessage = data.message || "";

  if (data.imageId) {
    try {
      imageUrl = await loadQuestionImage(data.imageId);
    } catch (error) {
      console.warn("Unable to load student question image:", error);
      fallbackMessage = fallbackMessage || "أرسل صورة سؤال، لكن تعذر تحميلها.";
      setStudioStatus(error.message || "تعذر تحميل صورة سؤال التلميذ.", "error");
    }
  }

  appendTeacherChatMessage({
    sender: data.studentName || "تلميذ",
    message: fallbackMessage,
    kind: "student",
    imageUrl,
    studentSocketId: data.socketId || "",
    studentId: data.studentId || "",
  });
});

socket.on("student_left", (data = {}) => {
  const socketId = data.socketId || attendeeSocketByStudentId.get(String(data.studentId || "").trim());
  if (socketId) {
    removeStudentConnection(socketId);
    return;
  }
  if (data.studentId) removeAttendeeByStudentId(data.studentId);
});

socket.on("class_ended", (data = {}) => {
  if (!classActive || isEnding) {
    return;
  }

  endLiveClass({
    notifyServer: false,
    statusMessage:
      data.reason === "teacher_disconnected"
        ? "انقطع اتصال الأستاذ؛ تم إغلاق الحصة."
        : "تم إنهاء الحصة المباشرة.",
  });
});

socket.on("classroom_error", (data = {}) => {
  if (data.message) {
    setStudioStatus(data.message, "error");
  }
});

socket.on("disconnect", () => {
  if (!classActive) {
    if (isStarting) setStudioStatus("انقطع الاتصال. جارٍ إعادة الاتصال قبل بدء الحصة…", "neutral");
    return;
  }

  // Preserve local screen/audio capture during a short signaling interruption.
  // The server reserves this exact room for the same teacher token, and the
  // connect handler rebuilds fresh peer connections without a page reload.
  closeAllPeerConnections();
  clearAttendees();
  setStudioStatus("انقطع الاتصال بالخادم. جارٍ استعادة الحصة تلقائياً…", "error");
  updateControls();
});

// --- User controls ---

// Begin the signaling connection as soon as the studio loads. The start button
// still waits for this connection, so a slow first handshake cannot produce a
// false "server unavailable" failure.
socket.connect();

// Bind the critical start action before optional sidebar/recording setup. A
// missing optional element must never make the main classroom button inert.
elements.startButton?.addEventListener("click", () => {
  void startLiveClass().catch((error) => {
    console.error("Unable to start the live class from the button:", error);
    isStarting = false;
    setStudioStatus(error?.message || "تعذر بدء الحصة المباشرة.", "error");
    updateControls();
  });
});

elements.sidebarTabs.forEach((tab) => {
  tab.addEventListener("click", () => setSidebarTab(tab.dataset.sidebarTab));
});
elements.attendanceSidebarToggle?.addEventListener("click", () => {
  setSidebarCollapsed("attendance", !elements.studioLayout?.classList.contains("attendance-collapsed"));
});
elements.chatSidebarToggle?.addEventListener("click", () => {
  setSidebarCollapsed("chat", !elements.studioLayout?.classList.contains("chat-collapsed"));
});
elements.attendeeSearch?.addEventListener("input", filterAttendees);
try {
  setSidebarTab("participants");
  initializeTeacherCanvas();
  // UI-only duration refresh; it reads classActive and never changes media/signaling state.
  refreshStudioDuration();
} catch (error) {
  console.error("Unable to initialize optional studio controls:", error);
}

elements.levelSelect.addEventListener("change", () => {
  if (!classActive && !isStarting && !isEnding) {
    syncClassTypeSelector();
  }
});
elements.screenShareButton?.addEventListener("click", () => void toggleScreenShare());
elements.toggleMicButton.addEventListener("click", toggleMicrophone);
elements.recordLocalButton.addEventListener("click", toggleLocalRecording);
elements.saveDriveButton.addEventListener("click", handleGoogleDriveButton);
elements.uploadYoutubeAfterEndButton?.addEventListener("click", () => {
  if (lastLocalRecording) void uploadRecordingToYouTube(lastLocalRecording);
});
elements.closeRecordingReadyButton?.addEventListener("click", closeRecordingReadyModal);
elements.recordingReadyModal?.addEventListener("click", (event) => {
  if (event.target === elements.recordingReadyModal) closeRecordingReadyModal();
});
elements.leaveStudioButton.addEventListener("click", () => {
  void leaveLiveStudio();
});
elements.endClassButton.addEventListener("click", () => {
  endLiveClass({ notifyServer: true });
});
elements.chatForm.addEventListener("submit", sendTeacherChatMessage);
elements.chatInput.addEventListener("input", updateControls);
elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.chatForm.requestSubmit();
  }
});
elements.chatInput.addEventListener("paste", (event) => {
  void handleTeacherChatPaste(event);
});
elements.chatImageRemoveButton?.addEventListener("click", clearTeacherChatImage);
elements.closeQuestionImageModalButton?.addEventListener("click", closeQuestionImageModal);
elements.questionImageModalViewport?.addEventListener("wheel", handleQuestionImageWheel, { passive: false });
elements.questionImageModalViewport?.addEventListener("pointerdown", startQuestionImageDrag);
elements.questionImageModalViewport?.addEventListener("pointermove", moveQuestionImageDrag);
elements.questionImageModalViewport?.addEventListener("pointerup", stopQuestionImageDrag);
elements.questionImageModalViewport?.addEventListener("pointercancel", stopQuestionImageDrag);
elements.questionImageModalViewport?.addEventListener("lostpointercapture", stopQuestionImageDrag);
elements.questionImageModal?.addEventListener("click", (event) => {
  if (event.target === elements.questionImageModal) {
    closeQuestionImageModal();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeQuestionImageModal();
    closeRecordingReadyModal();
  }
});

function preserveClassroomForPageRefresh() {
  isPageNavigatingAway = true;
  if (classActive) {
    persistLiveClassRecovery();
  }
}

// A refresh must not be interpreted as a teacher ending the class. The browser
// stops local media during navigation; the saved room token lets the teacher
// resume with a new screen selection after the page returns.
window.addEventListener("beforeunload", preserveClassroomForPageRefresh);
window.addEventListener("pagehide", () => {
  preserveClassroomForPageRefresh();
  closeAllPeerConnections();
});

pendingPageRecovery = readLiveClassRecovery();
if (pendingPageRecovery) {
  elements.levelSelect.value = pendingPageRecovery.level;
  syncClassTypeSelector({ selectedValue: pendingPageRecovery.subject });
  setStudioStatus("تم تحديث الاستوديو والحصة ما تزال محفوظة للتلاميذ. اضغط «استئناف الحصة المحفوظة» واختر الشاشة لإعادة البث فورًا.", "neutral");
} else {
  syncClassTypeSelector();
}

updateAttendeeCount();
try {
  updateControls();
} catch (error) {
  console.error("Unable to initialize studio controls:", error);
  setStudioStatus("تعذر تهيئة عناصر الاستوديو. أعد تحميل الصفحة وحاول مرة أخرى.", "error");
}
