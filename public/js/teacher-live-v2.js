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
const teacherSocketToken = sessionStorage.getItem("teacherToken") || localStorage.getItem("teacherToken") || "";
const socket = io({
  auth: { token: teacherSocketToken },
  autoConnect: true,
  transports: ["polling", "websocket"],
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
const approvedStudentMicrophones = new Set();
const classroomAudioSources = new Map();
const classroomAudioDestinations = new Map();
let classroomAudioContext;
let teacherMicGainNode = null;
let teacherMicRecordingGainNode = null;
let teacherMicAnalyserNode = null;
let teacherMicMeterAnimationFrame = null;

const storedTeacherMicGain = parseFloat(localStorage.getItem("minasaty_teacher_mic_gain") || "1.0");
let teacherMicGainLevel = isNaN(storedTeacherMicGain) ? 1.0 : Math.max(0, Math.min(storedTeacherMicGain, 2.5));
let teacherAgcEnabled = localStorage.getItem("minasaty_teacher_agc_enabled") === "true"; // False by default!
let teacherEchoCancellation = localStorage.getItem("minasaty_teacher_echo_cancellation") !== "false"; // True by default
let teacherNoiseSuppression = localStorage.getItem("minasaty_teacher_noise_suppression") === "true"; // False by default for studio mic
const iceDisconnectTimers = Object.create(null);
const ICE_DISCONNECT_GRACE_MS = 15_000;
let activeLevel = null;
let activeSubject = null;
let classActive = false;

// SFU (LiveKit Media Server) State for zero-lag 70+ student broadcasting
let teacherSfuRoom = null;
let teacherSfuVideoPub = null;
let teacherSfuAudioPub = null;
let sfuActiveForClass = false;
let isSfuMediaSyncing = false;
let pendingSfuMediaSync = false;

async function initTeacherSfuSession(roomName) {
  if (typeof window.fetchMinasatySfuToken !== "function" || !window.LivekitClient?.Room) {
    console.info("[SFU] LiveKit client or helper not available, running in P2P mode.");
    return false;
  }
  try {
    const sfuData = await window.fetchMinasatySfuToken(roomName, true);
    const sfuUrl = sfuData?.url || sfuData?.serverUrl;
    if (!sfuData || !sfuData.enabled || !sfuData.token || !sfuUrl) {
      console.info("[SFU] SFU not enabled by server, running P2P fallback.");
      return false;
    }
    closeTeacherSfuSession();
    const Room = window.LivekitClient.Room;
    teacherSfuRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    teacherSfuRoom.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === "audio") {
        const studentAudio = track.attach();
        studentAudio.id = `sfu-audio-${participant.identity}`;
        studentAudio.style.display = "none";
        document.body.appendChild(studentAudio);
      }
    });

    teacherSfuRoom.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      if (track.kind === "audio") {
        const el = document.getElementById(`sfu-audio-${participant.identity}`);
        if (el) el.remove();
      }
    });

    teacherSfuRoom.on(window.LivekitClient.RoomEvent.Disconnected, () => {
      console.warn("[SFU] Teacher disconnected from SFU room.");
      sfuActiveForClass = false;
    });

    await teacherSfuRoom.connect(sfuUrl, sfuData.token);

    sfuActiveForClass = true;
    console.info("[SFU] Teacher successfully connected to LiveKit SFU:", roomName);
    await syncTeacherSfuMedia();
    return true;
  } catch (error) {
    console.warn("[SFU] Could not connect to SFU, using P2P fallback:", error);
    sfuActiveForClass = false;
    return false;
  }
}

function getActiveTeacherAudioTrack() {
  const micTrack = cameraStream?.getAudioTracks?.().find((track) => track.readyState === "live");
  if (micTrack) return micTrack;
  const screenAudioTrack = screenStream?.getAudioTracks?.().find((track) => track.readyState === "live");
  if (screenAudioTrack) return screenAudioTrack;
  return null;
}

async function syncTeacherSfuMedia() {
  if (!teacherSfuRoom || teacherSfuRoom.state !== "connected") return;
  if (isSfuMediaSyncing) {
    pendingSfuMediaSync = true;
    return;
  }
  isSfuMediaSyncing = true;
  try {
    do {
      pendingSfuMediaSync = false;
      await executeTeacherSfuMediaSync();
    } while (pendingSfuMediaSync && teacherSfuRoom?.state === "connected");
  } finally {
    isSfuMediaSyncing = false;
  }
}

async function executeTeacherSfuMediaSync() {
  if (!teacherSfuRoom || teacherSfuRoom.state !== "connected") return;
  try {
    const allPubs = Array.from(teacherSfuRoom.localParticipant?.trackPublications?.values() || []);

    // 1. Sync Video / Screen track
    const videoTrack = getActiveTeacherVideoTrack();
    const existingVideoPub = (teacherSfuVideoPub && allPubs.includes(teacherSfuVideoPub))
      ? teacherSfuVideoPub
      : allPubs.find((pub) => pub.kind === "video" || pub.source === "screen_share" || pub.trackName === "teacher-screen");

    if (videoTrack && videoTrack.readyState === "live") {
      if (existingVideoPub) {
        teacherSfuVideoPub = existingVideoPub;
        const currentTrack = existingVideoPub.track?.mediaStreamTrack;
        if (currentTrack === videoTrack || currentTrack?.id === videoTrack.id) {
          // Exact same track is already published and live, nothing to do
        } else {
          if (existingVideoPub.track && typeof existingVideoPub.track.replaceTrack === "function") {
            try {
              await existingVideoPub.track.replaceTrack(videoTrack);
            } catch (_) {
              try { await teacherSfuRoom.localParticipant.unpublishTrack(existingVideoPub.track); } catch (_) {}
              teacherSfuVideoPub = await teacherSfuRoom.localParticipant.publishTrack(videoTrack, {
                name: "teacher-screen",
                source: window.LivekitClient?.Track?.Source?.ScreenShare || "screen_share",
                simulcast: true,
              });
            }
          } else {
            try { await teacherSfuRoom.localParticipant.unpublishTrack(existingVideoPub.track); } catch (_) {}
            teacherSfuVideoPub = await teacherSfuRoom.localParticipant.publishTrack(videoTrack, {
              name: "teacher-screen",
              source: window.LivekitClient?.Track?.Source?.ScreenShare || "screen_share",
              simulcast: true,
            });
          }
        }
      } else {
        teacherSfuVideoPub = await teacherSfuRoom.localParticipant.publishTrack(videoTrack, {
          name: "teacher-screen",
          source: window.LivekitClient?.Track?.Source?.ScreenShare || "screen_share",
          simulcast: true,
        });
      }
    } else if (existingVideoPub) {
      try {
        if (existingVideoPub.track) {
          await teacherSfuRoom.localParticipant.unpublishTrack(existingVideoPub.track);
        }
      } catch (_) {}
      teacherSfuVideoPub = null;
    }

    // 2. Sync Audio / Mic track
    const audioTrack = getActiveTeacherAudioTrack();
    const existingAudioPub = (teacherSfuAudioPub && allPubs.includes(teacherSfuAudioPub))
      ? teacherSfuAudioPub
      : allPubs.find((pub) => pub.kind === "audio" || pub.source === "microphone" || pub.trackName === "teacher-audio");

    if (audioTrack && audioTrack.readyState === "live") {
      if (existingAudioPub) {
        teacherSfuAudioPub = existingAudioPub;
        const currentTrack = existingAudioPub.track?.mediaStreamTrack;
        if (currentTrack === audioTrack || currentTrack?.id === audioTrack.id) {
          // Exact same track is already published and live, nothing to do
        } else {
          if (existingAudioPub.track && typeof existingAudioPub.track.replaceTrack === "function") {
            try {
              await existingAudioPub.track.replaceTrack(audioTrack);
            } catch (_) {
              try { await teacherSfuRoom.localParticipant.unpublishTrack(existingAudioPub.track); } catch (_) {}
              teacherSfuAudioPub = await teacherSfuRoom.localParticipant.publishTrack(audioTrack, {
                name: "teacher-audio",
                source: window.LivekitClient?.Track?.Source?.Microphone || "microphone",
                dtx: true,
                red: true,
              });
            }
          } else {
            try { await teacherSfuRoom.localParticipant.unpublishTrack(existingAudioPub.track); } catch (_) {}
            teacherSfuAudioPub = await teacherSfuRoom.localParticipant.publishTrack(audioTrack, {
              name: "teacher-audio",
              source: window.LivekitClient?.Track?.Source?.Microphone || "microphone",
              dtx: true,
              red: true,
            });
          }
        }
      } else {
        teacherSfuAudioPub = await teacherSfuRoom.localParticipant.publishTrack(audioTrack, {
          name: "teacher-audio",
          source: window.LivekitClient?.Track?.Source?.Microphone || "microphone",
          dtx: true,
          red: true,
        });
      }
    } else if (existingAudioPub) {
      try {
        if (existingAudioPub.track) {
          await teacherSfuRoom.localParticipant.unpublishTrack(existingAudioPub.track);
        }
      } catch (_) {}
      teacherSfuAudioPub = null;
    }
  } catch (err) {
    if (err?.name === "TrackInvalidError" || String(err?.message).includes("already been published")) {
      return;
    }
    console.warn("[SFU] Error syncing media with SFU room:", err);
  }
}

function closeTeacherSfuSession() {
  sfuActiveForClass = false;
  isSfuMediaSyncing = false;
  pendingSfuMediaSync = false;
  teacherSfuVideoPub = null;
  teacherSfuAudioPub = null;
  if (teacherSfuRoom) {
    try {
      teacherSfuRoom.disconnect();
    } catch (_) {}
    teacherSfuRoom = null;
  }
}

let screenShareRevision = 0;
let isStarting = false;
let isEnding = false;
let classResumeToken = null;
let activeScheduledClassId = null;
let activeYoutubeVideoId = null;
let reconnectingLiveClass = false;
let reconnectRetryTimer = null;
let reconnectRetryCount = 0;
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
const OPTIMAL_RECORDING_VIDEO_BITRATE = 3_500_000;
const LOCAL_RECORDING_AUDIO_BITRATE = 128_000;

const RECORDING_DB_NAME = "minasaty_recording_cache_v1";
const RECORDING_STORE_NAME = "chunks";
let recordingDbPromise = null;

function getRecordingDb() {
  if (!recordingDbPromise) {
    recordingDbPromise = new Promise((resolve) => {
      if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
        return resolve(null);
      }
      try {
        const request = window.indexedDB.open(RECORDING_DB_NAME, 1);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(RECORDING_STORE_NAME)) {
            db.createObjectStore(RECORDING_STORE_NAME, { keyPath: "id", autoIncrement: true });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          console.warn("IndexedDB not available for recording cache:", request.error);
          resolve(null);
        };
      } catch (err) {
        console.warn("IndexedDB initialization error:", err);
        resolve(null);
      }
    });
  }
  return recordingDbPromise;
}

async function clearRecordingDb() {
  try {
    const db = await getRecordingDb();
    if (!db) return;
    const tx = db.transaction(RECORDING_STORE_NAME, "readwrite");
    tx.objectStore(RECORDING_STORE_NAME).clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (_) {}
}

async function saveRecordingChunkToStorage(chunk) {
  try {
    const db = await getRecordingDb();
    if (!db) return false;
    const tx = db.transaction(RECORDING_STORE_NAME, "readwrite");
    tx.objectStore(RECORDING_STORE_NAME).add({ chunk });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    return true;
  } catch (err) {
    console.warn("Failed to persist recording chunk to IndexedDB:", err);
    return false;
  }
}

async function retrieveRecordingChunksFromStorage() {
  try {
    const db = await getRecordingDb();
    if (!db) return null;
    const tx = db.transaction(RECORDING_STORE_NAME, "readonly");
    const req = tx.objectStore(RECORDING_STORE_NAME).getAll();
    const result = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
    if (!result || !result.length) return null;
    return result.map((item) => item.chunk);
  } catch (err) {
    console.warn("Failed to retrieve recording chunks from IndexedDB:", err);
    return null;
  }
}
const GOOGLE_DRIVE_CLIENT_ID = "938017291163-a6dar2h6u2d5isf5h4nqtaccp7jpkk28.apps.googleusercontent.com";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_DRIVE_ROOT_FOLDER = "تسجيلات أكاديمية التفوق";
const GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
let lastLocalRecording = null;
let googleDriveAccessToken = null;
let googleDriveTokenExpiresAt = 0;
let googleDriveUploadInProgress = false;
let youtubeUploadInProgress = false;
let currentServerUploadId = null;
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
  audioSettingsButton: document.getElementById("audio-settings-btn"),
  toolbarMicGainBadge: document.getElementById("toolbar-mic-gain-badge"),
  audioSettingsModal: document.getElementById("audio-settings-modal"),
  closeAudioSettingsModal: document.getElementById("close-audio-settings-modal"),
  audioSettingsBackdrop: document.getElementById("audio-settings-modal-backdrop"),
  micGainSlider: document.getElementById("mic-gain-slider"),
  micGainDisplay: document.getElementById("mic-gain-display"),
  vuMeterFill: document.getElementById("vu-meter-fill"),
  vuMeterLabel: document.getElementById("vu-meter-label"),
  settingEchoCancellation: document.getElementById("setting-echo-cancellation"),
  settingNoiseSuppression: document.getElementById("setting-noise-suppression"),
  settingBrowserAgc: document.getElementById("setting-browser-agc"),
  applyAudioSettingsButton: document.getElementById("apply-audio-settings-btn"),
  resetAudioSettingsButton: document.getElementById("reset-audio-settings-btn"),
  muteAllMicsButton: document.getElementById("mute-all-mics-btn"),
  sidebarMuteAllButton: document.getElementById("sidebar-mute-all-btn"),
  recordLocalButton: document.getElementById("record-local-btn"),
  localRecordingState: document.getElementById("local-recording-state"),
  saveDriveButton: document.getElementById("save-drive-btn"),
  driveUploadState: document.getElementById("drive-upload-state"),
  driveUploadText: document.getElementById("drive-upload-text"),
  driveUploadProgress: document.getElementById("drive-upload-progress"),
  youtubeUploadState: document.getElementById("youtube-upload-state"),
  youtubeUploadText: document.getElementById("youtube-upload-text"),
  youtubeUploadProgress: document.getElementById("youtube-upload-progress"),
  downloadRecordingButton: document.getElementById("download-recording-btn"),
  forceUploadYoutubeButton: document.getElementById("force-upload-youtube-btn"),
  uploadFromDeviceButton: document.getElementById("upload-from-device-btn"),
  uploadFromDeviceInput: document.getElementById("upload-from-device-input"),
  recordingReadyModal: document.getElementById("recording-ready-modal"),
  recordingReadyTitle: document.getElementById("recording-ready-title"),
  recordingReadySubtitle: document.getElementById("recording-ready-subtitle"),
  youtubeModalProgressbar: document.getElementById("youtube-modal-progressbar"),
  youtubeModalPercent: document.getElementById("youtube-modal-percent"),
  youtubeModalBytes: document.getElementById("youtube-modal-bytes"),
  youtubeStatsGrid: document.getElementById("youtube-stats-grid"),
  youtubeModalSpeed: document.getElementById("youtube-modal-speed"),
  youtubeModalEta: document.getElementById("youtube-modal-eta"),
  youtubeModalAlertBox: document.getElementById("youtube-modal-alert-box"),
  youtubeModalAlertText: document.getElementById("youtube-modal-alert-text"),
  youtubeSuccessCard: document.getElementById("youtube-success-card"),
  youtubeTagFilesize: document.getElementById("youtube-tag-filesize"),
  youtubeModalMinimizeButton: document.getElementById("youtube-modal-minimize-btn"),
  youtubeViewVideoButton: document.getElementById("youtube-view-video-btn"),
  youtubeMinimizedBadge: document.getElementById("youtube-minimized-badge"),
  youtubeMinimizedText: document.getElementById("youtube-minimized-text"),
  modalDownloadRecordingButton: document.getElementById("modal-download-device-btn"),
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
  sendLiveAlertButton: document.getElementById("send-live-alert-btn"),
  teacherAlertModal: document.getElementById("teacher-alert-modal"),
  closeTeacherAlertModalButton: document.getElementById("close-teacher-alert-modal-btn"),
  cancelAlertModalButton: document.getElementById("cancel-alert-modal-btn"),
  submitSendAlertButton: document.getElementById("submit-send-alert-btn"),
  alertSelectAllLevelsButton: document.getElementById("alert-select-all-levels"),
  alertDeselectAllLevelsButton: document.getElementById("alert-deselect-all-levels"),
  alertLevelsGrid: document.getElementById("alert-levels-grid"),
  alertSpecificStudentsWrap: document.getElementById("alert-specific-students-wrap"),
  alertStudentSearchInput: document.getElementById("alert-student-search-input"),
  alertStudentsSelectionList: document.getElementById("alert-students-selection-list"),
  alertSelectedCountBadge: document.getElementById("alert-selected-count-badge"),
  alertAudienceCount: document.getElementById("alert-audience-count"),
  alertTitleInput: document.getElementById("alert-title-input"),
  alertBodyInput: document.getElementById("alert-body-input"),
  absenteesBtn: document.getElementById("absentees-btn"),
  absenteesBadge: document.getElementById("absentees-badge"),
  absenteesModal: document.getElementById("absentees-modal"),
  absenteesModalBackdrop: document.getElementById("absentees-modal-backdrop"),
  absenteesModalClose: document.getElementById("absentees-modal-close"),
  absenteesModalSubtitle: document.getElementById("absentees-modal-subtitle"),
  absenteesStatTotal: document.getElementById("absentees-stat-total"),
  absenteesStatPresent: document.getElementById("absentees-stat-present"),
  absenteesStatAbsent: document.getElementById("absentees-stat-absent"),
  absenteesRefreshBtn: document.getElementById("absentees-refresh-btn"),
  absenteesAlertAllBtn: document.getElementById("absentees-alert-all-btn"),
  absenteesSearchInput: document.getElementById("absentees-search-input"),
  absenteesLoading: document.getElementById("absentees-loading"),
  absenteesEmpty: document.getElementById("absentees-empty"),
  absenteesError: document.getElementById("absentees-error"),
  absenteesErrorText: document.getElementById("absentees-error-text"),
  absenteesList: document.getElementById("absentees-list"),
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
  const selectedLevel = elements.levelSelect?.value || "";
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
  if (elements.subjectSelectLabel) {
    elements.subjectSelectLabel.textContent = isUniversity ? "نوع الاشتراك" : isFreeClass ? "نوع الحصة" : "المادة";
  }
  if (elements.subjectSelect) {
    elements.subjectSelect.setAttribute(
      "aria-label",
      isUniversity ? "اختر نوع الاشتراك" : isFreeClass ? "اختر نوع الحصة" : "اختر مادة الحصة"
    );
    elements.subjectSelect.replaceChildren(
      ...options.map(({ value, label }) => new Option(label, value, false, value === nextValue))
    );
  }
  if (elements.freeClassHint) {
    elements.freeClassHint.hidden = !isFreeClass || isGlobalFree;
  }
}


function setStudioStatus(message, mode = "neutral") {
  if (elements.liveStatusText) elements.liveStatusText.textContent = message;
  if (elements.liveStatus) {
    elements.liveStatus.classList.toggle("is-live", mode === "live");
    elements.liveStatus.classList.toggle("is-error", mode === "error");
  }
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
  localStorage.removeItem("minasaty_is_recording");
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
  } catch {}


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


function appendTeacherChatMessage({ id, sender, message = "", kind, imageUrl = null, studentSocketId = "", studentId = "", reactions = null }) {
  const safeMessage = normalizeChatMessage(message);
  if ((!safeMessage && !imageUrl) || !elements.chatBox) {
    return null;
  }


  const shouldFollowNewestMessage = isViewingLatestMessages(elements.chatBox);
  elements.chatEmpty?.remove();


  const msgId = id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const bubble = document.createElement("article");
  bubble.className = `chat-message ${kind === "teacher" ? "teacher-message" : "student-message"}`;
  bubble.dataset.messageId = msgId;


  const header = document.createElement("div");
  header.className = "chat-message-header";

  const senderLabel = document.createElement("strong");
  senderLabel.className = "chat-message-sender";
  senderLabel.textContent = sender;

  let senderElem = senderLabel;
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
    senderElem = senderWrap;
  }

  // Quick reactions bar for teacher
  const reactBar = document.createElement("div");
  reactBar.className = "chat-message-react-bar";

  const TEACHER_REACTIONS_CONFIG = [
    { key: "love", emoji: "❤️", title: "قلب ❤️" },
    { key: "like", emoji: "👍", title: "إعجاب 👍" },
    { key: "cry", emoji: "😭", title: "بكاء 😭" },
    { key: "dislike", emoji: "👎", title: "لم يعجبني 👎" },
    { key: "fire", emoji: "🔥", title: "نار 🔥" },
  ];

  TEACHER_REACTIONS_CONFIG.forEach((r) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-message-react-btn";
    btn.title = r.title;
    btn.textContent = r.emoji;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      sendTeacherChatReaction(msgId, r.key);
    });
    reactBar.append(btn);
  });

  header.append(senderElem, reactBar);
  bubble.append(header);


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

  // Reactions pills container
  const pillsWrap = document.createElement("div");
  pillsWrap.className = "chat-message-reactions-pills";
  pillsWrap.dataset.pillsFor = msgId;
  renderTeacherReactionPills(pillsWrap, reactions, msgId);
  bubble.append(pillsWrap);


  elements.chatBox.append(bubble);

  // Prune older DOM bubbles to prevent texture memory bloat during long classes
  while (elements.chatBox.children.length > 200) {
    const oldest = elements.chatBox.firstElementChild;
    if (oldest && oldest !== elements.chatEmpty) {
      oldest.remove();
    } else {
      break;
    }
  }

  if (shouldFollowNewestMessage) {
    requestAnimationFrame(() => {
      elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
    });
  }


  return bubble;
}

function renderTeacherReactionPills(container, reactions, messageId) {
  if (!container) return;
  container.innerHTML = "";
  if (!reactions) return;

  const TEACHER_REACTIONS_CONFIG = [
    { key: "love", emoji: "❤️", title: "قلب ❤️" },
    { key: "like", emoji: "👍", title: "إعجاب 👍" },
    { key: "cry", emoji: "😭", title: "بكاء 😭" },
    { key: "dislike", emoji: "👎", title: "لم يعجبني 👎" },
    { key: "fire", emoji: "🔥", title: "نار 🔥" },
  ];

  TEACHER_REACTIONS_CONFIG.forEach((r) => {
    const count = Number(reactions[r.key] || reactions[`${r.key}Count`] || 0);
    const isTeacherReacted = Boolean(
      reactions.teacherReacted?.[r.key] || reactions.teacherReacted === r.key
    );

    if (count > 0) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `chat-reaction-pill ${isTeacherReacted ? "is-teacher-reaction" : ""}`;
      pill.title = isTeacherReacted ? `تفاعلت أنت بـ ${r.title}` : r.title;
      pill.innerHTML = `<span>${r.emoji}</span> <span>${count}</span>${isTeacherReacted ? ' <small class="chat-teacher-tag">أنت</small>' : ""}`;
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        sendTeacherChatReaction(messageId, r.key);
      });
      container.append(pill);
    }
  });
}

function sendTeacherChatReaction(messageId, reaction) {
  if (!socket || !classActive) return;
  const bubble = document.querySelector(`.chat-message[data-message-id="${messageId}"]`);
  const emojiMap = { love: "❤️", like: "👍", cry: "😭", dislike: "👎", fire: "🔥" };
  if (bubble) {
    showTeacherFloatingReaction(bubble, emojiMap[reaction] || "❤️");
  }
  socket.emit("classroom_chat_react", {
    messageId,
    reaction,
    level: activeLevel,
  }, (res) => {
    if (res && res.ok) {
      updateTeacherMessageReactions(res);
    }
  });
}

function showTeacherFloatingReaction(targetEl, emoji) {
  if (!targetEl) return;
  const floating = document.createElement("div");
  floating.className = "chat-floating-reaction";
  floating.textContent = emoji;
  const rect = targetEl.getBoundingClientRect();
  floating.style.left = `${rect.left + rect.width / 2}px`;
  floating.style.top = `${rect.top + 10}px`;
  document.body.append(floating);
  setTimeout(() => floating.remove(), 850);
}

function updateTeacherMessageReactions(data) {
  if (!data || !data.messageId) return;
  const pillsWrap = document.querySelector(`.chat-message-reactions-pills[data-pills-for="${data.messageId}"]`);
  if (pillsWrap) {
    renderTeacherReactionPills(pillsWrap, data.counts || {
      love: data.loveCount,
      like: data.likeCount,
      cry: data.cryCount,
      dislike: data.dislikeCount,
      fire: data.fireCount,
      teacherReacted: data.teacherReacted,
    }, data.messageId);
  }
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
      id: entry.id,
      sender: entry.kind === "teacher" ? "الأستاذ" : entry.studentName || "تلميذ",
      message: entry.message || "",
      kind: entry.kind === "teacher" ? "teacher" : "student",
      imageUrl,
      studentSocketId: entry.socketId || "",
      studentId: entry.studentId || "",
      reactions: entry.reactions || null,
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
    const ack = await emitWithAcknowledgement("teacher_send_message", {
      level: activeLevel,
      message,
      imageData,
    });


    appendTeacherChatMessage({
      id: ack?.messageId || ack?.id,
      sender: "أنا",
      message,
      kind: "teacher",
      imageUrl: imageData || null,
      reactions: { love: 0, like: 0, teacherReacted: null },
    });
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
  const labelElement = button?.querySelector("span") || button;
  if (labelElement) {
    labelElement.textContent = label;
  }
}


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
  if (localRecordingVideoTrack && localRecordingVideoTrack !== screenStream?.getVideoTracks?.()[0]) {
    try {
      localRecordingVideoTrack.stop();
    } catch (_) {}
  }
  localRecordingVideoTrack = null;
  localRecordingIs1080p = false;


  if (localRecordingSourceSyncTimer) {
    window.clearInterval(localRecordingSourceSyncTimer);
    localRecordingSourceSyncTimer = null;
  }


  localRecordingSourceNodes.forEach(({ node, gainNode }) => {
    try {
      node.disconnect();
    } catch {}
    try {
      if (gainNode) gainNode.disconnect();
    } catch {}
  });
  localRecordingSourceNodes.clear();
  teacherMicRecordingGainNode = null;


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


  localRecordingSourceNodes.forEach(({ stream, node, gainNode }, sourceKey) => {
    const currentStream = activeSources.get(sourceKey);
    if (currentStream === stream) {
      return;
    }


    try {
      node.disconnect();
    } catch {}
    try {
      if (gainNode) gainNode.disconnect();
    } catch {}
    if (sourceKey === "__teacher_microphone__") {
      teacherMicRecordingGainNode = null;
    }
    localRecordingSourceNodes.delete(sourceKey);
  });


  activeSources.forEach((stream, sourceKey) => {
    if (localRecordingSourceNodes.has(sourceKey)) {
      return;
    }


    try {
      const node = localRecordingAudioContext.createMediaStreamSource(stream);
      const gainNode = localRecordingAudioContext.createGain();
      if (sourceKey === "__teacher_microphone__") {
        gainNode.gain.value = teacherMicGainLevel;
        teacherMicRecordingGainNode = gainNode;
      } else {
        gainNode.gain.value = 1.0;
      }
      node.connect(gainNode);
      gainNode.connect(localRecordingAudioDestination);
      localRecordingSourceNodes.set(sourceKey, { stream, node, gainNode });
    } catch (error) {
      console.warn("Unable to add an audio source to the local recording:", error);
    }
  });
}


function build1080pRecordingVideoTrack(sourceTrack) {
  if (!sourceTrack || sourceTrack.readyState !== "live") {
    return sourceTrack;
  }

  // Direct zero-copy hardware pass-through:
  // Bypass 60fps software canvas rasterization on the main thread when a live screen track is present.
  // This prevents main-thread starvation of WebRTC audio/video encoding and keeps renderer RAM low.
  const settings = typeof sourceTrack.getSettings === "function" ? sourceTrack.getSettings() : {};
  const isDirectCandidate = sourceTrack.kind === "video" && (settings.displaySurface || sourceTrack.contentHint === "detail" || (settings.width && settings.width >= 1280));
  if (isDirectCandidate) {
    localRecordingIs1080p = (settings.width === LOCAL_RECORDING_WIDTH && settings.height === LOCAL_RECORDING_HEIGHT) || !settings.width || settings.width >= 1280;
    localRecordingVideoTrack = sourceTrack;
    return sourceTrack;
  }

  const CanvasConstructor = window.HTMLCanvasElement;
  const VideoConstructor = window.HTMLVideoElement;
  if (!CanvasConstructor || !VideoConstructor || typeof CanvasConstructor.prototype.captureStream !== "function") {
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
    recordingStream.addTrack(liveAudioTracks[0]);
    return recordingStream;
  }


  const audioContext = new AudioContextConstructor();
  const destination = audioContext.createMediaStreamDestination();
  localRecordingAudioContext = audioContext;
  localRecordingAudioDestination = destination;
  localRecordingSourceNodes = new Map();
  syncLocalRecordingAudioSources();


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
  if (!recording?.blob) {
    return false;
  }

  const fileName = recording.fileName || `recording-${Date.now()}.webm`;
  const fileUrl = URL.createObjectURL(recording.blob);
  const link = document.createElement("a");
  link.href = fileUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
  return true;
}


function handleDownloadRecordingClick() {
  if (lastLocalRecording?.blob && lastLocalRecording.blob.size > 0) {
    const downloaded = downloadLocalRecording(lastLocalRecording);
    if (downloaded) {
      setStudioStatus("✅ بدأ تنزيل ملف تسجيل الحصة على جهازك (مجلد التحميلات).", "live");
    } else {
      setStudioStatus("تعذر تنزيل الملف محلياً. حاول مرة أخرى.", "error");
    }
    return;
  }
  if (isLocalRecording()) {
    alert("التسجيل جارٍ حالياً. اضغط على «إيقاف التسجيل» أو «إنهاء الحصة» أولاً لتنزيل الحصة كاملة.");
    return;
  }
  alert("لا يوجد تسجيل متاح بعد. ابدأ تسجيل الحصة أولاً.");
}


async function handleForceUploadYoutubeClick() {
  if (!lastLocalRecording?.blob || lastLocalRecording.blob.size === 0) {
    if (isLocalRecording()) {
      alert("التسجيل جارٍ حالياً. اضغط على «إيقاف التسجيل» أو «إنهاء الحصة» أولاً لرفعها.");
      return;
    }
    alert("لا يوجد تسجيل متاح لرفعه إلى YouTube.");
    return;
  }

  // نحرر القفل ونجبر الرفع في حال كان هناك رفع سابق معلق بسبب خطأ في الشبكة
  youtubeUploadInProgress = false;

  updateYoutubeUploadUi({
    visible: true,
    text: "جارٍ إجبار إعادة رفع تسجيل الحصة إلى YouTube...",
    progress: 3,
  });
  setStudioStatus("جارٍ إعادة محاولة الرفع إلى YouTube...", "live");

  try {
    const result = await uploadRecordingToYouTube(lastLocalRecording, { force: true });
    if (result) {
      setStudioStatus("✅ تم رفع التسجيل بنجاح إلى YouTube وربطه بالحصة.", "live");
    }
  } catch (error) {
    console.error("Force YouTube upload error:", error);
    updateYoutubeUploadUi({
      visible: true,
      text: `تعذر الرفع: ${error.message || "خطأ في الاتصال"}. يمكنك إعادة المحاولة بالضغط على الزر مرة أخرى.`,
      progress: 0,
    });
    setStudioStatus("تعذر الرفع إلى YouTube؛ ملف الفيديو محفوظ بجهازك ويمكنك إعادة المحاولة بالزر الأحمر.", "error");
  } finally {
    updateControls();
  }
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
    scheduledClassId: activeScheduledClassId || "",
    youtubeVideoId: activeYoutubeVideoId || "",
    recordedAt: localRecordingStartedAt ? new Date(localRecordingStartedAt).toISOString() : new Date().toISOString(),
    recordingWidth: localRecordingIs1080p ? LOCAL_RECORDING_WIDTH : null,
    recordingHeight: localRecordingIs1080p ? LOCAL_RECORDING_HEIGHT : null,
    recordingFrameRate: localRecordingIs1080p ? LOCAL_RECORDING_FRAME_RATE : null,
  };
}


function updateDriveUploadUi({ visible = false, text = "", progress = 0 } = {}) {
  if (!elements.driveUploadState) return;
  elements.driveUploadState.hidden = !visible;
  elements.driveUploadText.textContent = text;
  elements.driveUploadProgress.value = Math.max(0, Math.min(100, Number(progress) || 0));
}


let youtubeBeforeUnloadHandler = null;

function setUploadBeforeUnloadProtection(enabled) {
  if (enabled) {
    if (!youtubeBeforeUnloadHandler) {
      youtubeBeforeUnloadHandler = (e) => {
        if (youtubeUploadInProgress) {
          const msg = "تنبيه: لا يزال تسجيل الحصة قيد الرفع إلى YouTube. إغلاق الصفحة الآن سيؤدي لعدم اكتمال الفيديو في قناتك.";
          e.preventDefault();
          e.returnValue = msg;
          return msg;
        }
      };
      window.addEventListener("beforeunload", youtubeBeforeUnloadHandler);
    }
  } else {
    if (youtubeBeforeUnloadHandler) {
      window.removeEventListener("beforeunload", youtubeBeforeUnloadHandler);
      youtubeBeforeUnloadHandler = null;
    }
  }
}

function playUploadSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, time: 0, dur: 0.22, vol: 0.25 },
      { freq: 659.25, time: 0.12, dur: 0.22, vol: 0.25 },
      { freq: 783.99, time: 0.24, dur: 0.28, vol: 0.28 },
      { freq: 1046.50, time: 0.38, dur: 0.65, vol: 0.32 },
    ];
    notes.forEach(({ freq, time, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + time);
      gain.gain.setValueAtTime(0.001, now + time);
      gain.gain.exponentialRampToValueAtTime(vol, now + time + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + time);
      osc.stop(now + time + dur);
    });
  } catch (err) {
    console.warn("Unable to play upload success chime:", err);
  }
}

function showUploadDesktopNotification(title, body) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          new Notification(title, { body, icon: "/favicon.ico" });
        }
      });
    }
  } catch (_) {}
}

function formatBytesToHuman(bytes) {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "0 MB";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function minimizeYoutubeUploadModal() {
  if (!elements.recordingReadyModal) return;
  elements.recordingReadyModal.hidden = true;
  elements.recordingReadyModal.classList.remove("is-open");
  elements.recordingReadyModal.dataset.minimized = "true";
  if (elements.youtubeMinimizedBadge) {
    elements.youtubeMinimizedBadge.hidden = false;
  }
}

function expandYoutubeUploadModal() {
  if (!elements.recordingReadyModal) return;
  delete elements.recordingReadyModal.dataset.minimized;
  elements.recordingReadyModal.hidden = false;
  elements.recordingReadyModal.classList.add("is-open");
  if (elements.youtubeMinimizedBadge) {
    elements.youtubeMinimizedBadge.hidden = true;
  }
}

function updateYoutubeUploadUi({
  visible = false,
  text = "",
  progress = 0,
  loadedBytes = 0,
  totalBytes = 0,
  speedBps = 0,
  remainingSec = null,
  status = "uploading",
  videoId = null,
} = {}) {
  // Legacy indicator elements
  if (elements.youtubeUploadState) {
    elements.youtubeUploadState.hidden = !visible;
  }
  if (elements.youtubeUploadText) {
    elements.youtubeUploadText.textContent = text;
  }
  if (elements.youtubeUploadProgress) {
    elements.youtubeUploadProgress.value = Math.max(0, Math.min(100, Number(progress) || 0));
  }

  const modal = elements.recordingReadyModal;
  const badge = elements.youtubeMinimizedBadge;

  if (visible) {
    if (modal && modal.dataset.minimized !== "true") {
      modal.hidden = false;
      modal.classList.add("is-open");
    }
  }

  const cleanPercent = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));

  if (elements.youtubeModalProgressbar) {
    elements.youtubeModalProgressbar.style.width = `${cleanPercent}%`;
  }
  if (elements.youtubeModalPercent) {
    elements.youtubeModalPercent.textContent = `${cleanPercent}%`;
  }

  if (elements.youtubeModalBytes) {
    if (totalBytes > 0) {
      const loadedFormatted = formatBytesToHuman(loadedBytes || 0);
      const totalFormatted = formatBytesToHuman(totalBytes);
      elements.youtubeModalBytes.textContent = `${loadedFormatted} / ${totalFormatted}`;
      elements.youtubeModalBytes.setAttribute("dir", "ltr");
    } else if (text) {
      elements.youtubeModalBytes.textContent = text;
    }
  }

  if (elements.youtubeModalSpeed) {
    if (status === "success") {
      elements.youtubeModalSpeed.textContent = "مكتمل 100%";
    } else if (speedBps > 0) {
      const mbpsRate = ((speedBps * 8) / 1_000_000).toFixed(1);
      if (speedBps >= 1024 * 1024) {
        const mb = (speedBps / (1024 * 1024)).toFixed(1);
        elements.youtubeModalSpeed.textContent = `${mb} MB/s (${mbpsRate} Mbps)`;
      } else {
        const kb = (speedBps / 1024).toFixed(0);
        elements.youtubeModalSpeed.textContent = `${kb} KB/s (${mbpsRate} Mbps)`;
      }
    } else {
      elements.youtubeModalSpeed.textContent = "-- MB/s";
    }
  }

  if (elements.youtubeModalEta) {
    if (status === "success") {
      elements.youtubeModalEta.textContent = "تم بنجاح";
    } else if (typeof remainingSec === "number" && remainingSec >= 0) {
      if (remainingSec <= 3) {
        elements.youtubeModalEta.textContent = "بضع ثوانٍ متبقية...";
      } else if (remainingSec < 60) {
        elements.youtubeModalEta.textContent = `باقي ${remainingSec} ثانية تقريباً`;
      } else {
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        elements.youtubeModalEta.textContent = `باقي ${mins} دقيقة و ${secs} ثانية تقريباً`;
      }
    } else {
      elements.youtubeModalEta.textContent = "جارٍ الحساب...";
    }
  }

  if (status === "success") {
    if (elements.recordingReadyTitle) {
      elements.recordingReadyTitle.textContent = "✅ تم حفظ ورفع تسجيل الحصة إلى YouTube بنجاح!";
      elements.recordingReadyTitle.style.color = "#4ade80";
    }
    if (elements.recordingReadySubtitle) {
      elements.recordingReadySubtitle.textContent = "تمت معالجة الفيديو وربطه تلقائياً بسجل الحصة في المنصة.";
    }

    // إخفاء إحصائيات السرعة والوقت المتبقي عند الاكتمال لمنع التلوث البصري
    if (elements.youtubeStatsGrid) {
      elements.youtubeStatsGrid.hidden = true;
    }
    if (elements.youtubeModalAlertBox) {
      elements.youtubeModalAlertBox.hidden = true;
    }

    // إظهار بطاقة معلومات الفيديو المختصرة والأنيقة
    if (elements.youtubeSuccessCard) {
      elements.youtubeSuccessCard.hidden = false;
    }
    if (elements.youtubeTagFilesize) {
      const displaySize = totalBytes > 0 ? totalBytes : (lastLocalRecording?.blob?.size || 0);
      elements.youtubeTagFilesize.textContent = `💾 الحجم: ${formatBytesToHuman(displaySize)}`;
    }

    if (elements.youtubeModalBytes) {
      const displaySize = totalBytes > 0 ? totalBytes : (lastLocalRecording?.blob?.size || 0);
      const formatted = formatBytesToHuman(displaySize);
      elements.youtubeModalBytes.textContent = `${formatted} / ${formatted}`;
      elements.youtubeModalBytes.setAttribute("dir", "ltr");
    }

    if (elements.youtubeModalProgressbar) {
      elements.youtubeModalProgressbar.style.background = "linear-gradient(90deg, #16a34a, #22c55e, #4ade80)";
      elements.youtubeModalProgressbar.style.boxShadow = "0 0 16px rgba(34, 197, 94, 0.7)";
    }
    if (elements.youtubeViewVideoButton && videoId) {
      elements.youtubeViewVideoButton.href = `https://youtu.be/${videoId}`;
      elements.youtubeViewVideoButton.hidden = false;
    }
    if (elements.uploadYoutubeAfterEndButton) {
      elements.uploadYoutubeAfterEndButton.hidden = true;
    }
    if (elements.youtubeModalMinimizeButton) {
      elements.youtubeModalMinimizeButton.hidden = true;
    }
    if (badge) {
      badge.classList.add("is-success");
      if (elements.youtubeMinimizedText) {
        elements.youtubeMinimizedText.textContent = "✅ اكتمل الرفع 100%";
      }
    }
  } else if (status === "error") {
    if (elements.recordingReadyTitle) {
      elements.recordingReadyTitle.textContent = "⚠️ تعذر إكمال الرفع إلى YouTube";
      elements.recordingReadyTitle.style.color = "#f87171";
    }
    if (elements.recordingReadySubtitle) {
      elements.recordingReadySubtitle.textContent = text || "حدث خطأ أثناء الرفع؛ لكن التسجيل محفوظ في جهازك.";
    }
    if (elements.youtubeStatsGrid) {
      elements.youtubeStatsGrid.hidden = true;
    }
    if (elements.youtubeSuccessCard) {
      elements.youtubeSuccessCard.hidden = true;
    }
    if (elements.youtubeModalAlertBox) {
      elements.youtubeModalAlertBox.hidden = false;
      elements.youtubeModalAlertBox.className = "youtube-modal-alert-box error";
    }
    if (elements.youtubeModalAlertText) {
      elements.youtubeModalAlertText.textContent = "تم حفظ نسخة من الفيديو في جهازك (مجلد التنزيلات). يمكنك النقر على زر إعادة المحاولة لرفعها الآن.";
    }
    if (elements.uploadYoutubeAfterEndButton) {
      elements.uploadYoutubeAfterEndButton.hidden = false;
    }
    if (elements.youtubeViewVideoButton) {
      elements.youtubeViewVideoButton.hidden = true;
    }
    if (badge) {
      badge.classList.remove("is-success");
      if (elements.youtubeMinimizedText) {
        elements.youtubeMinimizedText.textContent = "⚠️ تعذر الرفع";
      }
    }
  } else {
    if (elements.recordingReadyTitle) {
      elements.recordingReadyTitle.textContent = "جارٍ رفع تسجيل الحصة إلى YouTube تلقائياً";
      elements.recordingReadyTitle.style.color = "#ffffff";
    }
    if (elements.recordingReadySubtitle) {
      elements.recordingReadySubtitle.textContent = "يرجى إبقاء هذه الصفحة مفتوحة حتى يكتمل الرفع ويتم ربط الحصة بقناتك";
    }
    if (elements.youtubeStatsGrid) {
      elements.youtubeStatsGrid.hidden = false;
    }
    if (elements.youtubeSuccessCard) {
      elements.youtubeSuccessCard.hidden = true;
    }
    if (elements.youtubeModalAlertBox) {
      elements.youtubeModalAlertBox.hidden = false;
      elements.youtubeModalAlertBox.className = "youtube-modal-alert-box info";
    }
    if (elements.youtubeModalAlertText) {
      elements.youtubeModalAlertText.textContent = "💡 يمكنك تصغير نافذة المتصفح ومتابعة أعمالك؛ سنطلق رنة تنبيهية واضحة وإشعاراً فور الاكتمال (100%).";
    }
    if (elements.youtubeModalProgressbar) {
      elements.youtubeModalProgressbar.style.background = "linear-gradient(90deg, #b91c1c 0%, #ef4444 60%, #f87171 100%)";
      elements.youtubeModalProgressbar.style.boxShadow = "0 0 16px rgba(239, 68, 68, 0.65)";
    }
    if (elements.uploadYoutubeAfterEndButton) {
      elements.uploadYoutubeAfterEndButton.hidden = true;
    }
    if (elements.youtubeViewVideoButton) {
      elements.youtubeViewVideoButton.hidden = true;
    }
    if (elements.youtubeModalMinimizeButton) {
      elements.youtubeModalMinimizeButton.hidden = false;
    }
    if (badge) {
      badge.classList.remove("is-success");
      if (elements.youtubeMinimizedText) {
        elements.youtubeMinimizedText.textContent = `رفع YouTube: ${cleanPercent}%`;
      }
    }
  }
}


function uploadFormDataWithProgress(url, formData, { token, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || "{}"); } catch (_) {}
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(payload.error || "تعذر رفع التسجيل إلى YouTube."));
        return;
      }
      resolve(payload);
    };
    xhr.onerror = () => reject(new Error("تعذر الاتصال بخادم رفع التسجيل."));
    xhr.onabort = () => reject(new Error("تم إلغاء رفع التسجيل."));
    xhr.send(formData);
  });
}


async function fixWebmDuration(blob, durationMs) {
  const buf = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const view = new DataView(buf.buffer);
  for (let i = 0; i < buf.length - 11; i++) {
    if (buf[i] === 0x44 && buf[i + 1] === 0x89 && buf[i + 2] === 0x88) {
      const current = view.getFloat64(i + 3, false);
      if (!current || current <= 0 || !Number.isFinite(current)) {
        const full = new Uint8Array(await blob.arrayBuffer());
        new DataView(full.buffer).setFloat64(i + 3, durationMs, false);
        return new Blob([full], { type: blob.type || "video/webm" });
      }
      return blob;
    }
  }
  return blob;
}


function directPutToGoogle(uploadUrl, blob, mimeType, onProgress) {
  const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB chunks (multiple of 256 KB)
  const totalBytes = blob.size;
  const startTime = Date.now();
  let smoothSpeed = 0;
  let lastLoadedForSpeed = 0;
  let lastTimeForSpeed = startTime;
  let isAborted = false;

  function queryGoogleStatus() {
    return new Promise((resolve) => {
      if (isAborted) return resolve({ aborted: true });
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Range", `bytes */${totalBytes}`);
      xhr.onload = () => {
        if (xhr.status === 308) {
          const rangeHeader = xhr.getResponseHeader("Range");
          if (rangeHeader) {
            const match = /bytes=0-(\d+)/.exec(rangeHeader);
            if (match) return resolve({ nextByte: parseInt(match[1], 10) + 1 });
          }
          resolve({ nextByte: 0 });
        } else if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve({ complete: true, data: JSON.parse(xhr.responseText) });
          } catch (_) {
            resolve({ complete: true, data: { id: null } });
          }
        } else {
          resolve({ error: true, status: xhr.status });
        }
      };
      xhr.onerror = () => resolve({ error: true });
      xhr.onabort = () => resolve({ aborted: true });
      xhr.send();
    });
  }

  function uploadChunk(startByte, endByte) {
    return new Promise((resolve, reject) => {
      if (isAborted) return reject(new Error("تم إلغاء الرفع."));

      const chunk = blob.slice(startByte, endByte);
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", mimeType);
      xhr.setRequestHeader("Content-Range", `bytes ${startByte}-${endByte - 1}/${totalBytes}`);

      xhr.upload.onprogress = (e) => {
        if (isAborted) return;
        const chunkLoaded = e.lengthComputable ? e.loaded : 0;
        const currentTotalLoaded = Math.min(totalBytes, startByte + chunkLoaded);
        const now = Date.now();
        const percent = Math.min(99, Math.round((currentTotalLoaded / totalBytes) * 100));
        const elapsedSec = (now - startTime) / 1000;

        const instantElapsed = (now - lastTimeForSpeed) / 1000;
        if (instantElapsed >= 0.4) {
          const instantBytes = currentTotalLoaded - lastLoadedForSpeed;
          const currentSpeed = Math.max(0, instantBytes / instantElapsed);
          smoothSpeed = smoothSpeed === 0 ? currentSpeed : (smoothSpeed * 0.7 + currentSpeed * 0.3);
          lastLoadedForSpeed = currentTotalLoaded;
          lastTimeForSpeed = now;
        } else if (smoothSpeed === 0 && elapsedSec > 0.4) {
          smoothSpeed = currentTotalLoaded / elapsedSec;
        }

        const remainingBytes = Math.max(0, totalBytes - currentTotalLoaded);
        const remainingSec = smoothSpeed > 0 ? Math.ceil(remainingBytes / smoothSpeed) : null;

        onProgress?.({
          percent,
          loadedBytes: currentTotalLoaded,
          totalBytes,
          speedBps: smoothSpeed,
          remainingSec,
        });
      };

      xhr.onload = () => {
        if (xhr.status === 308) {
          const rangeHeader = xhr.getResponseHeader("Range");
          let nextByte = endByte;
          if (rangeHeader) {
            const match = /bytes=0-(\d+)/.exec(rangeHeader);
            if (match) nextByte = parseInt(match[1], 10) + 1;
          }
          resolve({ status: 308, nextByte });
        } else if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve({ status: 200, data: JSON.parse(xhr.responseText) });
          } catch (_) {
            resolve({ status: 200, data: { id: null } });
          }
        } else {
          let msg = "فشل رفع أحد أجزاء الفيديو إلى YouTube.";
          try { msg = JSON.parse(xhr.responseText)?.error?.message || msg; } catch (_) {}
          resolve({ status: xhr.status, errorMsg: msg });
        }
      };

      xhr.onerror = () => resolve({ status: 0, networkError: true });
      xhr.onabort = () => {
        isAborted = true;
        reject(new Error("تم إلغاء الرفع."));
      };

      xhr.send(chunk);
    });
  }

  return new Promise(async (resolve, reject) => {
    let currentStart = 0;
    let consecutiveRetries = 0;
    const MAX_RETRIES = 5;

    while (currentStart < totalBytes) {
      if (isAborted) {
        return reject(new Error("تم إلغاء الرفع."));
      }

      const currentEnd = Math.min(currentStart + CHUNK_SIZE, totalBytes);
      try {
        const result = await uploadChunk(currentStart, currentEnd);

        if (result.status === 308) {
          consecutiveRetries = 0;
          currentStart = result.nextByte;
        } else if (result.status === 200) {
          onProgress?.({
            percent: 100,
            loadedBytes: totalBytes,
            totalBytes,
            speedBps: smoothSpeed,
            remainingSec: 0,
          });
          return resolve(result.data);
        } else {
          consecutiveRetries++;
          if (consecutiveRetries > MAX_RETRIES) {
            return reject(new Error(result.errorMsg || `تعذر استكمال رفع الفيديو بعد عدة محاولات (${result.status || "انقطاع اتصال"}).`));
          }
          const savedMb = (currentStart / (1024 * 1024)).toFixed(1);
          const chunkNum = Math.floor(currentStart / CHUNK_SIZE) + 1;
          onProgress?.({
            percent: Math.min(99, Math.round((currentStart / totalBytes) * 100)),
            loadedBytes: currentStart,
            totalBytes,
            speedBps: 0,
            remainingSec: null,
            statusText: `جارٍ الاستئناف الذكي من الجزء (${chunkNum})... تم حفظ ${savedMb} MB بأمان لدى Google`,
          });
          const delayMs = Math.min(1000 * Math.pow(2, consecutiveRetries - 1), 10000);
          await new Promise((r) => setTimeout(r, delayMs));

          const statusCheck = await queryGoogleStatus();
          if (statusCheck.complete) {
            return resolve(statusCheck.data);
          }
          if (typeof statusCheck.nextByte === "number") {
            currentStart = statusCheck.nextByte;
          }
        }
      } catch (err) {
        if (isAborted || err.message === "تم إلغاء الرفع.") {
          return reject(err);
        }
        consecutiveRetries++;
        if (consecutiveRetries > MAX_RETRIES) {
          return reject(err);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const finalStatus = await queryGoogleStatus();
    if (finalStatus.complete) {
      return resolve(finalStatus.data);
    }
    reject(new Error("اكتمل إرسال الأجزاء ولكن لم يتم تأكيد الاستلام من YouTube."));
  });
}


/**
 * نقل مقاطع التسجيل (5 ميغابايت لكل جزء) تباعاً إلى خادم المنصة.
 * هذه الطريقة تقضي نهائياً على أخطاء 502/504 لأن كل طلب يستغرق ثوانٍ معدودة،
 * مع حساب فوري لسرعة النقل والوقت المتبقي (ETA) وإعادة المحاولة التلقائية.
 */
async function uploadBlobToServerInChunks({
  blob,
  token,
  uploadId,
  title,
  description,
  level,
  subject,
  recordedAt,
  scheduledClassId,
  mimeType,
  onProgress,
}) {
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB لكل مقطع
  const totalBytes = blob.size;
  const totalChunks = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));
  const startTime = Date.now();
  let smoothSpeed = 0;
  let lastLoadedForSpeed = 0;
  let lastTimeForSpeed = startTime;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const startByte = chunkIndex * CHUNK_SIZE;
    const endByte = Math.min(startByte + CHUNK_SIZE, totalBytes);
    const chunkBlob = blob.slice(startByte, endByte);

    let retries = 0;
    const MAX_RETRIES = 5;
    let chunkSuccess = false;

    while (!chunkSuccess) {
      try {
        const formData = new FormData();
        formData.append("chunk", chunkBlob, `chunk-${chunkIndex}.webm`);
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", String(chunkIndex));
        formData.append("totalChunks", String(totalChunks));
        formData.append("title", title);
        formData.append("description", description);
        formData.append("level", level);
        formData.append("subject", subject);
        formData.append("recordedAt", recordedAt);
        formData.append("scheduledClassId", scheduledClassId);
        formData.append("mimeType", mimeType);

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/youtube/server-chunk", true);
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);

          xhr.upload.onprogress = (e) => {
            const chunkLoaded = e.lengthComputable ? e.loaded : 0;
            const currentTotalLoaded = Math.min(totalBytes, startByte + chunkLoaded);
            const now = Date.now();
            const elapsed = (now - lastTimeForSpeed) / 1000;
            if (elapsed >= 0.4) {
              const instantBytes = currentTotalLoaded - lastLoadedForSpeed;
              const instantSpeed = Math.max(0, instantBytes / elapsed);
              smoothSpeed = smoothSpeed === 0 ? instantSpeed : (smoothSpeed * 0.7 + instantSpeed * 0.3);
              lastLoadedForSpeed = currentTotalLoaded;
              lastTimeForSpeed = now;
            }

            const percent = Math.min(99, Math.round((currentTotalLoaded / totalBytes) * 100));
            const remainingBytes = Math.max(0, totalBytes - currentTotalLoaded);
            const remainingSec = smoothSpeed > 0 ? Math.ceil(remainingBytes / smoothSpeed) : null;

            onProgress?.({
              percent,
              loadedBytes: currentTotalLoaded,
              totalBytes,
              speedBps: smoothSpeed,
              remainingSec,
              statusText: `جارٍ نقل التسجيل إلى خادم المنصة (${chunkIndex + 1}/${totalChunks})…`,
            });
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const res = JSON.parse(xhr.responseText);
                resolve(res);
              } catch (_) {
                resolve({ status: "success" });
              }
            } else {
              let msg = `خطأ في استلام المقطع ${chunkIndex + 1}`;
              try {
                const errJson = JSON.parse(xhr.responseText);
                msg = errJson.error || msg;
              } catch (_) {}
              reject(new Error(msg));
            }
          };

          xhr.onerror = () => reject(new Error("انقطاع في الاتصال أثناء نقل المقطع إلى خادم المنصة."));
          xhr.ontimeout = () => reject(new Error("انتهت مهلة الاتصال أثناء نقل المقطع إلى خادم المنصة."));
          xhr.send(formData);
        });

        chunkSuccess = true;
      } catch (err) {
        retries++;
        if (retries > MAX_RETRIES) {
          throw new Error(`تعذر نقل المقطع ${chunkIndex + 1} بعد عدة محاولات: ${err.message}`);
        }
        console.warn(`[Chunk Transfer Retry] Chunk ${chunkIndex + 1}/${totalChunks}, attempt ${retries}:`, err);
        const retryDelay = Math.min(1000 * Math.pow(2, retries - 1), 8000);
        onProgress?.({
          percent: Math.min(99, Math.round((startByte / totalBytes) * 100)),
          loadedBytes: startByte,
          totalBytes,
          speedBps: 0,
          remainingSec: null,
          statusText: `إعادة محاولة نقل المقطع ${chunkIndex + 1} إلى السيرفر (المحاولة ${retries})…`,
        });
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }
  }

  return { success: true, uploadId };
}


async function uploadRecordingToYouTube(recording, { force = false } = {}) {
  if (force) {
    youtubeUploadInProgress = false;
  }
  if (!recording?.blob || youtubeUploadInProgress) return null;

  if (recording.blob.size === 0) {
    console.error("YouTube Upload Error: Recording blob is empty.");
    updateYoutubeUploadUi({ visible: true, text: "تعذر رفع التسجيل: ملف الفيديو فارغ.", progress: 0, status: "error" });
    return null;
  }

  const token = sessionStorage.getItem("teacherToken");
  if (!token) {
    updateYoutubeUploadUi({ visible: true, text: "انتهت جلسة الأستاذ. احفظ الفيديو يدوياً.", progress: 0, status: "error" });
    return null;
  }

  const level = recording.registryLevel || recording.level || activeLevel || elements.levelSelect?.value || "الأكاديمية";
  const subject = recording.classType || recording.registrySubject || activeSubject || elements.subjectSelect?.value || "مباشرة";
  const scheduledClassId = recording.scheduledClassId || activeScheduledClassId || "";
  const title = `حصة ${subject} — ${level} — ${new Date().toLocaleDateString("ar-DZ")}`.slice(0, 100);
  const description = `تسجيل تلقائي من أكاديمية التفوق للفيزياء والرياضيات\nالمستوى: ${level}\nالمادة: ${subject}`;
  const fileSizeMb = (recording.blob.size / (1024 * 1024)).toFixed(1);

  youtubeUploadInProgress = true;
  setUploadBeforeUnloadProtection(true);

  try {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch (_) {}

  showRecordingReadyModal();
  updateYoutubeUploadUi({
    visible: true,
    text: `جارٍ تجهيز تسجيل الحصة ونقله إلى السيرفر (${fileSizeMb} MB)…`,
    progress: 1,
    loadedBytes: 0,
    totalBytes: recording.blob.size,
    status: "preparing",
  });
  updateControls();

  try {
    // الخطوة 1: إصلاح بيانات WebM إن أمكن
    const durationMs = localRecordingStartedAt ? Date.now() - localRecordingStartedAt : 0;
    let videoBlob = recording.blob;
    if (durationMs > 0 && (videoBlob.type || "").includes("webm")) {
      try { videoBlob = await fixWebmDuration(videoBlob, durationMs); } catch (_) {}
    }
    if (!videoBlob.type || !videoBlob.type.startsWith("video/")) {
      videoBlob = new Blob([videoBlob], { type: "video/webm" });
    }

    // الخطوة 2: التنزيل المحلي الفوري على جهاز الأستاذ (Instant Silent Local Backup)
    try {
      if (!recording._autoDownloaded) {
        recording._autoDownloaded = true;
        downloadLocalRecording({ ...recording, blob: videoBlob });
        console.log("Instant silent backup saved to teacher's computer Downloads.");
      }
    } catch (backupErr) {
      console.warn("Unable to trigger initial local backup:", backupErr);
    }

    // الخطوة 3: نقل التسجيل إلى السيرفر عبر أجزاء 5MB (لتفادي أي 502/504)
    const uploadId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    currentServerUploadId = uploadId;
    const mimeType = videoBlob.type || "video/webm";

    updateYoutubeUploadUi({
      visible: true,
      text: `جارٍ نقل التسجيل إلى خادم المنصة فائق السرعة (${fileSizeMb} MB)…`,
      progress: 2,
      loadedBytes: 0,
      totalBytes: videoBlob.size,
      status: "uploading",
    });

    await uploadBlobToServerInChunks({
      blob: videoBlob,
      token,
      uploadId,
      title,
      description,
      level,
      subject,
      recordedAt: recording.recordedAt || new Date().toISOString(),
      scheduledClassId,
      mimeType,
      onProgress: ({ percent, loadedBytes, totalBytes, speedBps, remainingSec, statusText }) => {
        updateYoutubeUploadUi({
          visible: true,
          text: statusText || `جارٍ نقل التسجيل إلى خادم المنصة (${percent}%)…`,
          progress: percent,
          loadedBytes,
          totalBytes,
          speedBps,
          remainingSec,
          status: "uploading",
        });
      },
    });

    // الخطوة 4: تم استلام وتجميع الفيديو بالكامل على السيرفر!
    // تحرير قفل إغلاق الصفحة بأمان تام لأن الملف أصبح في السيرفر
    setUploadBeforeUnloadProtection(false);

    // إطلاق رنة النجاح وإشعار سطح المكتب
    playUploadSuccessChime();
    showUploadDesktopNotification(
      "منصتي — تم تسليم التسجيل للسيرفر بنجاح!",
      `تم استلام تسجيل حصة ${subject} (${level}) في خادم المنصة. السيرفر يرفع الفيديو إلى قناتك في الخلفية بسرعة فائقة، والتسجيل محفوظ في حاسوبك.`
    );

    // الخطوة 5: مسح الفيديو تماماً من متصفح الأستاذ وذاكرة IndexedDB لتحرير RAM
    try {
      await clearRecordingDb();
      console.log("Cleared recording IndexedDB cache successfully after server hand-off.");
    } catch (dbErr) {
      console.warn("Unable to clear recording db:", dbErr);
    }
    localRecordingChunks = [];
    lastLocalRecording = null;

    // الخطوة 6: إشعار الأستاذ بالنجاح التام وإمكانية إغلاق المتصفح بحرية
    updateYoutubeUploadUi({
      visible: true,
      text: "✅ تم تسليم التسجيل إلى خادم المنصة بنجاح!",
      progress: 100,
      loadedBytes: videoBlob.size,
      totalBytes: videoBlob.size,
      status: "success",
    });

    if (elements.recordingReadyTitle) {
      elements.recordingReadyTitle.textContent = "✅ تم تسليم التسجيل إلى خادم المنصة بنجاح!";
      elements.recordingReadyTitle.style.color = "#4ade80";
    }
    if (elements.recordingReadySubtitle) {
      elements.recordingReadySubtitle.textContent = "يقوم خادم المنصة برفع الحصة إلى قناتك على YouTube في الخلفية بسرعة فائقة، والتسجيل محفوظ بنسخة احتياطية في حاسوبك. يمكنك إغلاق هذه الصفحة بأمان تام.";
    }
    if (elements.youtubeModalAlertText) {
      elements.youtubeModalAlertText.textContent = "🚀 السيرفر يرفع الحصة إلى قناتك الآن بصبيب فائق، ولن تتأثر ببطء الإنترنت المنزلي. التسجيل محفوظ أيضاً في مجلد التنزيلات.";
    }
    setStudioStatus("✅ تم تسليم التسجيل إلى السيرفر بنجاح؛ السيرفر يرفع الحصة في الخلفية ونسختك محفوظة بجهازك.", "live");

    return { uploadId, status: "server_processing" };
  } catch (error) {
    console.error("Unable to upload recording to YouTube server:", error);
    setUploadBeforeUnloadProtection(false);

    updateYoutubeUploadUi({
      visible: true,
      text: error.message || "تعذر إكمال نقل التسجيل إلى السيرفر.",
      progress: 0,
      status: "error",
    });
    setStudioStatus("تعذر نقل التسجيل إلى السيرفر؛ الملف محفوظ بجهازك في التنزيلات ويمكنك إعادة المحاولة بالزر الأحمر.", "error");

    // تنزيل احتياطي تلقائي في حال فشل أي شيء
    try {
      if (recording && !recording._autoDownloaded) {
        recording._autoDownloaded = true;
        downloadLocalRecording(recording);
        console.log("Auto-downloaded local recording to PC as backup after upload failure.");
      }
    } catch (_) {}

    return null;
  } finally {
    youtubeUploadInProgress = false;
    updateControls();
  }
}


function handleUploadFromDevice() {
  const input = elements.uploadFromDeviceInput;
  if (!input) return;
  input.value = "";
  input.click();
}


async function handleDeviceFileSelected(event) {
  const file = event.target?.files?.[0];
  if (!file || file.size === 0) { alert("الملف المحدد فارغ أو غير صالح."); return; }
  const token = sessionStorage.getItem("teacherToken");
  if (!token) { alert("انتهت جلسة الأستاذ. سجّل دخولك مرة أخرى."); return; }

  const level = activeLevel || elements.levelSelect?.value || "الأكاديمية";
  const subject = activeSubject || elements.subjectSelect?.value || "مباشرة";
  const scheduledClassId = activeScheduledClassId || "";
  const title = `حصة ${subject} — ${level} — ${new Date().toLocaleDateString("ar-DZ")}`.slice(0, 100);
  const description = `تسجيل مرفوع يدوياً من أكاديمية التفوق\nالمستوى: ${level}\nالمادة: ${subject}`;
  const fileSizeMb = (file.size / (1024 * 1024)).toFixed(1);

  if (!confirm(`سيتم رفع "${file.name}" (${fileSizeMb} MB) مباشرة إلى YouTube.\nالمستوى: ${level} — المادة: ${subject}\n\nهل تريد المتابعة؟`)) return;

  youtubeUploadInProgress = true;
  setUploadBeforeUnloadProtection(true);

  showRecordingReadyModal();
  updateYoutubeUploadUi({
    visible: true,
    text: `جارٍ تجهيز "${file.name}" للرفع…`,
    progress: 1,
    loadedBytes: 0,
    totalBytes: file.size,
    status: "preparing",
  });
  updateControls();

  try {
    const mimeType = file.type || "video/webm";
    const sessionRes = await fetch("/api/youtube/resumable-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, description, mimeType, fileSize: file.size }),
    });
    const sessionPayload = await sessionRes.json().catch(() => ({}));
    if (!sessionRes.ok || !sessionPayload.uploadUrl) throw new Error(sessionPayload.error || "تعذر فتح جلسة الرفع.");

    updateYoutubeUploadUi({
      visible: true,
      text: `جارٍ الرفع المباشر (${fileSizeMb} MB)…`,
      progress: 3,
      loadedBytes: 0,
      totalBytes: file.size,
      status: "uploading",
    });

    const googleResponse = await directPutToGoogle(
      sessionPayload.uploadUrl,
      file,
      mimeType,
      ({ percent, loadedBytes, totalBytes, speedBps, remainingSec }) => {
        updateYoutubeUploadUi({
          visible: true,
          text: `جارٍ الرفع المباشر…`,
          progress: percent,
          loadedBytes,
          totalBytes,
          speedBps,
          remainingSec,
          status: "uploading",
        });
      }
    );
    const videoId = googleResponse?.id;
    if (!videoId) throw new Error("لم تُرجع Google معرّف الفيديو.");

    updateYoutubeUploadUi({
      visible: true,
      text: "جارٍ ربط الفيديو بسجل الحصة في المنصة…",
      progress: 98,
      loadedBytes: file.size,
      totalBytes: file.size,
      status: "preparing",
    });

    const finishRes = await fetch("/api/youtube/resumable-finish", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ videoId, level, subject, recordedAt: new Date().toISOString(), scheduledClassId, title }),
    });
    const finishPayload = await finishRes.json().catch(() => ({}));

    setUploadBeforeUnloadProtection(false);
    playUploadSuccessChime();
    showUploadDesktopNotification("منصتي — تم رفع الملف بنجاح!", `تم رفع ${file.name} بنجاح وربطه بقناتك على YouTube.`);

    updateYoutubeUploadUi({
      visible: true,
      text: "✅ تم الرفع بنجاح!",
      progress: 100,
      loadedBytes: file.size,
      totalBytes: file.size,
      status: "success",
      videoId,
    });
    setStudioStatus("✅ تم رفع الملف إلى YouTube بنجاح.", "live");
  } catch (error) {
    console.error("Device file upload error:", error);
    setUploadBeforeUnloadProtection(false);
    updateYoutubeUploadUi({ visible: true, text: `تعذر الرفع: ${error.message}`, progress: 0, status: "error" });
    setStudioStatus("تعذر رفع الملف إلى YouTube.", "error");
  } finally {
    youtubeUploadInProgress = false;
    updateControls();
  }
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
  if (!elements.recordingReadyModal) return;
  if (elements.recordingReadyModal.dataset.minimized === "true") return;
  elements.recordingReadyModal.hidden = false;
  elements.recordingReadyModal.classList.add("is-open");
}


function closeRecordingReadyModal({ force = false } = {}) {
  if (!elements.recordingReadyModal) return;
  if (youtubeUploadInProgress && !force) {
    const confirmClose = window.confirm(
      "تنبيه: لا يزال تسجيل الحصة قيد الرفع إلى YouTube!\nإذا أغلقت النافذة الآن فسيتم إيقاف الرفع ولن يكتمل في قناتك.\n\nهل تريد تصغير النافذة في زاوية الشاشة ومتابعة الرفع في الخلفية بأمان؟\n(اضغط 'موافق' للتصغير الآمن)"
    );
    if (confirmClose) {
      minimizeYoutubeUploadModal();
    }
    return;
  }
  elements.recordingReadyModal.hidden = true;
  elements.recordingReadyModal.classList.remove("is-open");
  delete elements.recordingReadyModal.dataset.minimized;
  if (elements.youtubeMinimizedBadge) {
    elements.youtubeMinimizedBadge.hidden = true;
  }
}


let teacherAlertAudienceStudents = [];
let teacherAlertDebounceTimer = null;

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m] || m));
}

function openTeacherAlertModal() {
  if (!elements.teacherAlertModal) return;
  elements.teacherAlertModal.hidden = false;

  const currentStudioLevel = elements.levelSelect?.value?.trim();
  if (currentStudioLevel) {
    const matchingCheckbox = document.querySelector(`input[name="alert-level"][value="${currentStudioLevel}"]`);
    if (matchingCheckbox) {
      matchingCheckbox.checked = true;
    }
  }

  void refreshTeacherAlertAudience();
}

function closeTeacherAlertModal() {
  if (!elements.teacherAlertModal) return;
  elements.teacherAlertModal.hidden = true;
}

function getSelectedAlertLevels() {
  return Array.from(document.querySelectorAll('input[name="alert-level"]:checked')).map((el) => el.value);
}

function getSelectedAlertSubject() {
  return document.querySelector('input[name="alert-subject"]:checked')?.value || "ALL";
}

function getSelectedAlertPayment() {
  return document.querySelector('input[name="alert-payment"]:checked')?.value || "ALL";
}

function getSelectedAlertTargetMode() {
  return document.querySelector('input[name="alert-target-mode"]:checked')?.value || "ALL_LEVEL";
}

function refreshTeacherAlertAudience() {
  clearTimeout(teacherAlertDebounceTimer);
  teacherAlertDebounceTimer = setTimeout(async () => {
    const levels = getSelectedAlertLevels();
    const subjectFilter = getSelectedAlertSubject();
    const paymentFilter = getSelectedAlertPayment();
    const targetMode = getSelectedAlertTargetMode();

    if (elements.alertAudienceCount) {
      elements.alertAudienceCount.textContent = "...";
    }

    try {
      const token = sessionStorage.getItem("teacherToken") || "";
      const queryParams = new URLSearchParams({
        levels: levels.join(","),
        subjectFilter,
        paymentFilter,
      });

      const response = await fetch(`/api/academic/teacher-live-alert/audience?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("تعذر جلب إحصائيات التلاميذ.");
      }

      const result = await response.json();
      teacherAlertAudienceStudents = Array.isArray(result.students) ? result.students : [];

      if (elements.alertAudienceCount) {
        elements.alertAudienceCount.textContent = String(result.count ?? 0);
      }

      if (targetMode === "SELECTED") {
        renderAlertStudentsList();
      }
    } catch (err) {
      console.warn("Failed to refresh alert audience:", err);
      if (elements.alertAudienceCount) {
        elements.alertAudienceCount.textContent = "0";
      }
    }
  }, 150);
}

function renderAlertStudentsList() {
  if (!elements.alertStudentsSelectionList) return;
  const searchTerm = (elements.alertStudentSearchInput?.value || "").trim().toLowerCase();

  const filtered = teacherAlertAudienceStudents.filter((s) => {
    if (!searchTerm) return true;
    return (s.studentName || "").toLowerCase().includes(searchTerm);
  });

  if (!filtered.length) {
    elements.alertStudentsSelectionList.innerHTML = '<div class="alert-loading-msg">لا يوجد تلاميذ مطابقين للبحث.</div>';
    return;
  }

  elements.alertStudentsSelectionList.innerHTML = filtered.map((s) => {
    const isPaid = s.paymentStage === "PAID";
    const tagClass = isPaid ? "paid" : "unpaid";
    const tagText = isPaid ? "مدفوع" : (s.paymentStage === "PROMISED" ? "وعد بالدفع" : "غير مدفوع");
    return `
      <label class="alert-student-item">
        <div class="alert-student-item-meta">
          <input type="checkbox" class="alert-student-checkbox" value="${s.id}" data-name="${escapeHtml(s.studentName)}" />
          <span class="alert-student-item-name">${escapeHtml(s.studentName)}</span>
          <span class="alert-student-item-tag">${escapeHtml(s.level)}</span>
        </div>
        <span class="alert-student-item-tag ${tagClass}">${tagText}</span>
      </label>
    `;
  }).join("");

  updateSelectedStudentsCount();
}

function updateSelectedStudentsCount() {
  const checked = document.querySelectorAll(".alert-student-checkbox:checked").length;
  if (elements.alertSelectedCountBadge) {
    elements.alertSelectedCountBadge.textContent = `${checked} محدد`;
  }
}

async function handleSubmitTeacherLiveAlert() {
  const levels = getSelectedAlertLevels();
  const subjectFilter = getSelectedAlertSubject();
  const paymentFilter = getSelectedAlertPayment();
  const targetMode = getSelectedAlertTargetMode();
  const title = (elements.alertTitleInput?.value || "").trim();
  const body = (elements.alertBodyInput?.value || "").trim();

  if (!levels.length) {
    alert("يرجى اختيار مستوى دراسي واحد على الأقل.");
    return;
  }

  let targetStudentIds = [];
  if (targetMode === "SELECTED") {
    targetStudentIds = Array.from(document.querySelectorAll(".alert-student-checkbox:checked")).map((cb) => cb.value);
    if (!targetStudentIds.length) {
      alert("يرجى تحديد تلميذ واحد على الأقل من القائمة.");
      return;
    }
  }

  if (!body) {
    alert("يرجى كتابة نص التنبيه.");
    return;
  }

  const token = sessionStorage.getItem("teacherToken") || "";
  if (!token) {
    alert("جلسة تسجيل الدخول منتهية. سجّل الدخول مجدداً.");
    return;
  }

  const btn = elements.submitSendAlertButton;
  if (btn) {
    btn.disabled = true;
    const span = btn.querySelector("span");
    if (span) span.textContent = "⏳ جارٍ إرسال التنبيه...";
  }

  try {
    const response = await fetch("/api/academic/teacher-live-alert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        levels,
        subjectFilter,
        paymentFilter,
        targetMode,
        targetStudentIds,
        title,
        body,
        link: "/student-live.html",
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "تعذر إرسال التنبيه.");
    }

    alert(result.message || "تم إرسال التنبيه بنجاح إلى التلاميذ وأولياء الأمور!");
    closeTeacherAlertModal();
  } catch (err) {
    alert(err.message || "حدث خطأ أثناء إرسال التنبيه.");
  } finally {
    if (btn) {
      btn.disabled = false;
      const span = btn.querySelector("span");
      if (span) span.textContent = "🔔 إرسال التنبيه الآن";
    }
  }
}

// ── Teacher Live Absentees Management ──
const sessionAttendedStudentIds = new Set();
let currentAbsenteesData = null;
let isAbsenteesModalOpen = false;
let absenteesDebounceTimer = null;

function getActivePresentStudentIds() {
  const ids = new Set(sessionAttendedStudentIds);
  attendeeElements.forEach((item) => {
    const sid = item.dataset.studentId;
    if (sid) ids.add(String(sid).trim());
  });
  attendeeSocketByStudentId.forEach((_sockId, sid) => {
    if (sid) ids.add(String(sid).trim());
  });
  return Array.from(ids);
}

function updateAbsenteesBadge(count) {
  if (!elements.absenteesBadge) return;
  if (typeof count === "number" && count > 0) {
    elements.absenteesBadge.textContent = String(count);
    elements.absenteesBadge.hidden = false;
  } else {
    elements.absenteesBadge.hidden = true;
  }
}

async function fetchLiveAbsentees() {
  const level = activeLevel || elements.levelSelect?.value || "";
  const subject = activeSubject || elements.subjectSelect?.value || "";
  if (!level) return null;

  const presentIds = getActivePresentStudentIds().join(",");
  const token = sessionStorage.getItem("teacherToken") || teacherSocketToken || "";
  const params = new URLSearchParams({
    level,
    subject,
    presentIds,
  });

  const response = await fetch(`/api/academic/live-absentees?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "تعذر جلب بيانات الغائبين.");
  }

  const payload = await response.json();
  currentAbsenteesData = payload;
  updateAbsenteesBadge(payload.absentCount);
  return payload;
}

function refreshAbsenteesBadge() {
  clearTimeout(absenteesDebounceTimer);
  absenteesDebounceTimer = setTimeout(async () => {
    try {
      await fetchLiveAbsentees();
      if (isAbsenteesModalOpen && currentAbsenteesData) {
        updateAbsenteesModalView(currentAbsenteesData);
      }
    } catch (_) {}
  }, 250);
}

function formatAlgerianPhone(rawPhone) {
  if (!rawPhone) return "";
  let cleaned = String(rawPhone).replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "213" + cleaned.slice(1);
  } else if (!cleaned.startsWith("213")) {
    cleaned = "213" + cleaned;
  }
  return cleaned;
}

function buildWhatsAppUrl(rawPhone, studentName, level, subject) {
  const cleaned = formatAlgerianPhone(rawPhone);
  if (!cleaned) return "#";
  const subjectName = getClassTypeName(level, subject);
  const text = encodeURIComponent(
    `السلام عليكم ولي أمر التلميذ(ة) ${studentName || ""}، نود إعلامكم بأن حصة ${subjectName} (${level}) جارية الآن، والتلميذ مسجل غائب في المنصة. يرجى الالتحاق بالبث المباشر.`
  );
  return `https://wa.me/${cleaned}?text=${text}`;
}

function buildViberUrl(rawPhone) {
  const cleaned = formatAlgerianPhone(rawPhone);
  if (!cleaned) return "#";
  return `viber://chat?number=%2B${cleaned}`;
}

function buildTelegramUrl(rawPhone) {
  const cleaned = formatAlgerianPhone(rawPhone);
  if (!cleaned) return "#";
  return `https://t.me/+${cleaned}`;
}

function renderAbsenteesList(absentees, query = "") {
  if (!elements.absenteesList) return;
  const q = String(query || "").trim().toLowerCase();
  const filtered = absentees.filter((s) => {
    if (!q) return true;
    const nameMatch = String(s.studentName || "").toLowerCase().includes(q);
    const phoneMatch = String(s.parentPhone || "").includes(q);
    return nameMatch || phoneMatch;
  });

  elements.absenteesList.replaceChildren();

  if (filtered.length === 0) {
    if (elements.absenteesEmpty) {
      elements.absenteesEmpty.hidden = false;
      const strong = elements.absenteesEmpty.querySelector("strong");
      const p = elements.absenteesEmpty.querySelector("p");
      if (q) {
        if (strong) strong.textContent = "لا توجد نتائج مطابقة للبحث";
        if (p) p.textContent = `لم يتم العثور على أي تلميذ غائب يطابق "${query}".`;
      } else {
        if (strong) strong.textContent = "لا يوجد غائبون!";
        if (p) p.textContent = "جميع التلاميذ المشتركين والمؤهلين لهذه الحصة حاضرون الآن.";
      }
    }
    elements.absenteesList.hidden = true;
    return;
  }

  if (elements.absenteesEmpty) elements.absenteesEmpty.hidden = true;
  elements.absenteesList.hidden = false;

  const currentLvl = activeLevel || elements.levelSelect?.value || "";
  const currentSub = activeSubject || elements.subjectSelect?.value || "";

  filtered.forEach((student) => {
    const li = document.createElement("li");
    li.className = "absentee-card";

    const info = document.createElement("div");
    info.className = "absentee-card-info";

    const avatar = document.createElement("div");
    avatar.className = "absentee-avatar";
    avatar.textContent = displayInitials(student.studentName);

    const details = document.createElement("div");
    details.className = "absentee-details";

    const name = document.createElement("strong");
    name.className = "absentee-name";
    name.textContent = student.studentName || "تلميذ";

    const meta = document.createElement("div");
    meta.className = "absentee-meta";

    const phoneSpan = document.createElement("span");
    phoneSpan.className = "absentee-phone";
    phoneSpan.textContent = `📞 ${student.parentPhone || "—"}`;
    meta.append(phoneSpan);

    if (student.level !== UNIVERSITY_LEVEL) {
      const subjectBadge = document.createElement("span");
      subjectBadge.className = "absentee-subject-badge";
      subjectBadge.textContent =
        student.mathEnrollment && student.physicsEnrollment
          ? "رياضيات وفيزياء"
          : student.mathEnrollment
            ? "رياضيات فقط"
            : student.physicsEnrollment
              ? "فيزياء فقط"
              : "مشترك";
      meta.append(subjectBadge);
    }

    details.append(name, meta);
    info.append(avatar, details);

    const actions = document.createElement("div");
    actions.className = "absentee-card-actions";

    const alertBtn = document.createElement("button");
    alertBtn.type = "button";
    alertBtn.className = "absentee-alert-btn";
    alertBtn.dataset.studentId = student.id;
    alertBtn.dataset.phone = student.parentPhone || "";
    alertBtn.title = "إرسال تنبيه رنان لتطبيق التلميذ";
    alertBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <span>تنبيه</span>
    `;
    alertBtn.addEventListener("click", () => {
      void sendAbsenteeAlert(student.id, alertBtn);
    });
    actions.append(alertBtn);


    if (student.parentPhone) {
      const waUrl = buildWhatsAppUrl(student.parentPhone, student.studentName, currentLvl, currentSub);
      const waBtn = document.createElement("a");
      waBtn.className = "absentee-wa-btn";
      waBtn.href = waUrl;
      waBtn.target = "_blank";
      waBtn.rel = "noopener noreferrer";
      waBtn.title = "مراسلة ولي التلميذ عبر واتساب";
      waBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.23 8.23 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.98-.14.17-.29.18-.54.06-.25-.13-1.06-.39-2.01-1.24-.74-.66-1.24-1.48-1.39-1.73-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44s-.56-1.36-.77-1.86c-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08s.89 2.41 1.01 2.58c.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.53.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.23-.18-.48-.3"/>
        </svg>
        <span>واتساب</span>
      `;
      actions.append(waBtn);

      // 2. Viber button
      const viberUrl = buildViberUrl(student.parentPhone);
      const viberBtn = document.createElement("a");
      viberBtn.className = "absentee-viber-btn";
      viberBtn.href = viberUrl;
      viberBtn.title = "مراسلة أو الاتصال بولي التلميذ عبر فايبر";
      viberBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M19.78 14.56c-.57-.45-1.54-.95-2.23-.74-.47.14-.8.53-1.17.84-.36.3-.77.49-1.2.29-.94-.43-1.85-1.04-2.67-1.8-.82-.77-1.46-1.63-1.94-2.53-.22-.41-.05-.82.23-1.18.28-.35.65-.67.77-1.12.18-.68-.28-1.62-.7-2.17-.4-.53-1.05-.72-1.67-.53-.61.19-1.05.74-1.29 1.32-.42 1.02-.45 2.19-.07 3.25.68 1.9 1.83 3.6 3.29 5.02 1.55 1.52 3.4 2.71 5.41 3.39.99.34 2.08.31 3.03-.1.54-.23 1.05-.67 1.23-1.26.19-.62-.02-1.24-.52-1.62-.16-.1-.32-.2-.47-.26zM13.6 4.3c.78.11 1.5.38 2.15.78.65.41 1.2.94 1.62 1.58.42.64.71 1.34.84 2.09.07.39.38.67.77.67.44 0 .8-.38.74-.82-.16-.94-.52-1.83-1.05-2.63-.53-.8-1.22-1.46-2.03-1.97-.81-.5-1.72-.83-2.69-.97-.44-.06-.83.25-.89.69-.06.44.25.83.69.89zm.41 3.12c.57.19 1.08.53 1.48.97.4.44.68.97.82 1.56.09.41.48.68.89.6.41-.09.68-.48.6-.89-.19-.77-.57-1.47-1.1-2.05-.53-.58-1.2-.99-1.95-1.24-.41-.14-.85.08-.99.49-.14.41.08.85.49.99z"/>
        </svg>
        <span>فايبر</span>
      `;
      actions.append(viberBtn);

      // 3. Telegram button
      const tgUrl = buildTelegramUrl(student.parentPhone);
      const tgBtn = document.createElement("a");
      tgBtn.className = "absentee-tg-btn";
      tgBtn.href = tgUrl;
      tgBtn.target = "_blank";
      tgBtn.rel = "noopener noreferrer";
      tgBtn.title = "مراسلة ولي التلميذ عبر تيليجرام";
      tgBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
        </svg>
        <span>تيليجرام</span>
      `;
      actions.append(tgBtn);

      const callBtn = document.createElement("a");
      callBtn.className = "absentee-call-btn";
      callBtn.href = `tel:${student.parentPhone}`;
      callBtn.title = "اتصال هاتفي مباشر";
      callBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      `;
      actions.append(callBtn);
    }

    li.append(info, actions);
    elements.absenteesList.append(li);
  });
}

async function sendAbsenteeAlert(studentIds, button = null) {
  const ids = Array.isArray(studentIds) ? studentIds : [studentIds];
  if (!ids.length) return;

  const currentLvl = activeLevel || elements.levelSelect?.value || "";
  const currentSub = activeSubject || elements.subjectSelect?.value || "";

  if (button) {
    button.disabled = true;
    button.classList.add("is-loading");
    button.innerHTML = `
      <span class="absentees-btn-spinner" aria-hidden="true"></span>
      <span>جارٍ التنبيه...</span>
    `;
  }

  try {
    const res = await fetch("/api/academic/live-absentees/alert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherSocketToken}`,
      },
      body: JSON.stringify({
        studentIds: ids,
        level: currentLvl,
        subject: currentSub,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "تعذر إرسال التنبيه.");

    if (button) {
      button.classList.remove("is-loading");
      button.classList.add("is-sent");
      button.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>تم التنبيه</span>
      `;
      window.setTimeout(() => {
        if (button && button.classList.contains("is-sent")) {
          button.disabled = false;
        }
      }, 5000);
    }

    setStudioStatus(data.message || `تم إرسال التنبيه والرنين إلى ${ids.length} تلميذ.`, "live");
  } catch (err) {
    console.error("Failed to send absentee alert:", err);
    if (button) {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span>إعادة المحاولة</span>
      `;
    }
    alert(err.message || "تعذر إرسال التنبيه للتلميذ.");
  }
}

async function handleAlertAllAbsentees() {
  if (!currentAbsenteesData?.absentees?.length) {
    alert("لا يوجد تلاميذ غائبون حالياً لتنبيههم.");
    return;
  }

  const count = currentAbsenteesData.absentees.length;
  const confirmed = window.confirm(`هل أنت متأكد من رغبتك في إرسال تنبيه رنان إلى جميع التلاميذ الغائبين (${count} تلميذ) عبر التطبيق؟`);
  if (!confirmed) return;

  const allIds = currentAbsenteesData.absentees.map((s) => s.id).filter(Boolean);
  const btn = elements.absenteesAlertAllBtn;
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.innerHTML = `
      <span class="absentees-btn-spinner" aria-hidden="true"></span>
      <span>جارٍ تنبيه الجميع...</span>
    `;
  }

  try {
    await sendAbsenteeAlert(allIds);

    document.querySelectorAll(".absentee-alert-btn").forEach((b) => {
      b.classList.add("is-sent");
      b.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>تم التنبيه</span>
      `;
    });

    if (btn) {
      btn.classList.remove("is-loading");
      btn.classList.add("is-sent");
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>تم تنبيه الجميع</span>
      `;
      window.setTimeout(() => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove("is-sent");
          btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            <span>تنبيه كل الغائبين</span>
          `;
        }
      }, 5000);
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("is-loading");
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span>تنبيه كل الغائبين</span>
      `;
    }
  }
}

function updateAbsenteesModalView(data) {
  if (!data) return;
  if (elements.absenteesStatTotal) elements.absenteesStatTotal.textContent = String(data.totalEligible || 0);
  if (elements.absenteesStatPresent) elements.absenteesStatPresent.textContent = String(data.presentCount || 0);
  if (elements.absenteesStatAbsent) elements.absenteesStatAbsent.textContent = String(data.absentCount || 0);

  const query = elements.absenteesSearchInput?.value || "";
  renderAbsenteesList(data.absentees || [], query);
}

// Real-time device ringing feedback from native Android devices
socket.on("live_alert_acked", (data) => {
  try {
    const studentId = String(data?.studentId || "").trim();
    const phone = String(data?.phone || "").replace(/\D/g, "");
    document.querySelectorAll(".absentee-alert-btn").forEach((btn) => {
      const btnStudentId = btn.dataset.studentId;
      const btnPhone = (btn.dataset.phone || "").replace(/\D/g, "");
      if ((studentId && btnStudentId === studentId) || (phone && btnPhone && (btnPhone.includes(phone) || phone.includes(btnPhone)))) {
        btn.classList.remove("is-loading");
        btn.classList.remove("is-sent");
        btn.classList.add("is-ringing");
        btn.style.background = "linear-gradient(135deg, #059669, #10b981)";
        btn.style.borderColor = "#34d399";
        btn.style.color = "#ffffff";
        btn.style.boxShadow = "0 0 15px rgba(16, 185, 129, 0.6)";
        btn.innerHTML = `
          <span style="display:inline-block;animation:pulse 0.8s infinite;">📞</span>
          <span>الهاتف يرن الآن!</span>
        `;
      }
    });
  } catch (_) {}
});

async function openAbsenteesModal() {

  if (!elements.absenteesModal) return;
  isAbsenteesModalOpen = true;

  const currentLvl = activeLevel || elements.levelSelect?.value || "";
  const currentSub = activeSubject || elements.subjectSelect?.value || "";
  const subjectName = getClassTypeName(currentLvl, currentSub);

  if (elements.absenteesModalSubtitle) {
    elements.absenteesModalSubtitle.textContent = `حصة ${subjectName} — ${currentLvl || "المستوى المحدد"}`;
  }

  elements.absenteesModal.hidden = false;
  if (elements.absenteesLoading) elements.absenteesLoading.hidden = false;
  if (elements.absenteesEmpty) elements.absenteesEmpty.hidden = true;
  if (elements.absenteesError) elements.absenteesError.hidden = true;
  if (elements.absenteesList) elements.absenteesList.hidden = true;
  if (elements.absenteesSearchInput) elements.absenteesSearchInput.value = "";

  try {
    const data = await fetchLiveAbsentees();
    if (elements.absenteesLoading) elements.absenteesLoading.hidden = true;
    updateAbsenteesModalView(data);
  } catch (err) {
    if (elements.absenteesLoading) elements.absenteesLoading.hidden = true;
    if (elements.absenteesError) elements.absenteesError.hidden = false;
    if (elements.absenteesErrorText) elements.absenteesErrorText.textContent = err.message || "تعذر جلب بيانات الغائبين.";
  }
}

function closeAbsenteesModal() {
  isAbsenteesModalOpen = false;
  if (elements.absenteesModal) elements.absenteesModal.hidden = true;
}



async function finalizeLocalRecording() {
  if (localRecordingFinalized) {
    return;
  }
  localRecordingFinalized = true;

  let chunks = await retrieveRecordingChunksFromStorage();
  if (!chunks || !chunks.length) {
    chunks = localRecordingChunks;
  }
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
  if (elements.localRecordingState) elements.localRecordingState.hidden = true;
  if (elements.recordLocalButton) {
    elements.recordLocalButton.classList.remove("is-recording");
    setButtonLabel(elements.recordLocalButton, "بدء تسجيل الحصة");
  }
  disposeLocalRecordingResources();
  void clearRecordingDb();

  const downloaded = shouldDownload && downloadLocalRecording(recording);
  if (downloaded && classActive && !isEnding && !isPageNavigatingAway) {
    setStudioStatus("تم حفظ تسجيل الحصة محليًا على جهازك.", "live");
  } else if (shouldDownload && !downloaded && classActive && !isEnding) {
    setStudioStatus("تعذر إنشاء ملف التسجيل المحلي.", "error");
  }
  updateControls();
  resolver?.(Boolean(recording));
  if (recording) {
    showRecordingReadyModal();
    void uploadRecordingToYouTube(recording);
  }
}

function startLocalRecording() {
  if (!canRecordLocalClass() || isLocalRecording()) {
    return;
  }

  try {
    void clearRecordingDb();
    localRecordingStream = buildLocalRecordingStream();
    const mimeType = getLocalRecordingMimeType();
    const targetVideoBitrate = OPTIMAL_RECORDING_VIDEO_BITRATE;
    const options = mimeType
      ? { mimeType, videoBitsPerSecond: LOCAL_RECORDING_VIDEO_BITRATE ? targetVideoBitrate : LOCAL_RECORDING_VIDEO_BITRATE, audioBitsPerSecond: LOCAL_RECORDING_AUDIO_BITRATE }
      : { videoBitsPerSecond: LOCAL_RECORDING_VIDEO_BITRATE ? targetVideoBitrate : LOCAL_RECORDING_VIDEO_BITRATE, audioBitsPerSecond: LOCAL_RECORDING_AUDIO_BITRATE };
    const recorder = new MediaRecorder(localRecordingStream, options);
    localMediaRecorder = recorder;
    localRecordingMimeType = recorder.mimeType || mimeType || "video/webm";
    localRecordingChunks = [];
    localRecordingStartedAt = Date.now();
    localRecordingDownloadRequested = true;
    localRecordingFinalized = false;
    recorder.ondataavailable = async (event) => {
      if (event.data?.size) {
        const storedInDb = await saveRecordingChunkToStorage(event.data);
        if (!storedInDb) {
          localRecordingChunks.push(event.data);
        }
      }
    };
    recorder.onerror = (event) => {
      console.error("Local class recording failed:", event.error);
      setStudioStatus("تعذر متابعة التسجيل المحلي للحصة.", "error");
    };
    recorder.onstop = () => { void finalizeLocalRecording(); };
    recorder.start(3_000);
    if (elements.localRecordingState) elements.localRecordingState.hidden = false;
    if (elements.recordLocalButton) {
      elements.recordLocalButton.classList.add("is-recording");
      setButtonLabel(elements.recordLocalButton, "إيقاف التسجيل والرفع تلقائياً");
    }
    updateControls();
    setStudioStatus(
      localRecordingIs1080p
        ? "جارٍ تسجيل الحصة بدقة 1080p على جهازك."
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
    } catch (_) {}
    try {
      if (recorder.state !== "inactive") {
        recorder.requestData();
      }
      recorder.stop();
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


  if (elements.startButton) elements.startButton.disabled = isStarting || isEnding || classActive;
  if (elements.levelSelect) elements.levelSelect.disabled = isStarting || isEnding || classActive;
  if (elements.subjectSelect) elements.subjectSelect.disabled = isStarting || isEnding || classActive;
  if (elements.toggleMicButton) elements.toggleMicButton.disabled = !classActive || !hasAudio || isEnding;
  if (elements.muteAllMicsButton) elements.muteAllMicsButton.disabled = !classActive || isEnding;
  if (elements.sidebarMuteAllButton) elements.sidebarMuteAllButton.disabled = !classActive || isEnding;
  if (elements.recordLocalButton) elements.recordLocalButton.disabled = (!canRecordLocalClass() && !isLocalRecording()) || isEnding;
  if (elements.saveDriveButton) elements.saveDriveButton.disabled = !lastLocalRecording || googleDriveUploadInProgress;

  const hasRecording = Boolean(lastLocalRecording?.blob && lastLocalRecording.blob.size > 0);
  if (elements.downloadRecordingButton) {
    elements.downloadRecordingButton.disabled = !hasRecording;
    elements.downloadRecordingButton.classList.toggle("has-recording", hasRecording);
  }
  if (elements.forceUploadYoutubeButton) {
    elements.forceUploadYoutubeButton.disabled = !hasRecording || youtubeUploadInProgress;
    elements.forceUploadYoutubeButton.classList.toggle("has-recording", hasRecording);
  }
  if (elements.uploadFromDeviceButton) {
    elements.uploadFromDeviceButton.disabled = youtubeUploadInProgress;
  }
  if (elements.modalDownloadRecordingButton) {
    elements.modalDownloadRecordingButton.disabled = !hasRecording;
  }

  if (elements.leaveStudioButton) elements.leaveStudioButton.disabled = !classActive || isEnding;
  if (elements.endClassButton) elements.endClassButton.disabled = !classActive || isEnding;
  if (elements.screenShareButton) {
    elements.screenShareButton.disabled = isStarting || isEnding;
    setButtonLabel(elements.screenShareButton, classActive && screenStream ? "إيقاف الشاشة" : "مشاركة الشاشة");
  }
  if (elements.chatInput) elements.chatInput.disabled = !classActive || isEnding;
  if (elements.chatSendButton) elements.chatSendButton.disabled = !classActive || isEnding || (!normalizeChatMessage(elements.chatInput.value) && !pendingTeacherChatImageData);


  const hasSavedClassToResume = Boolean(pendingPageRecovery && !classActive && !isStarting);
  if (elements.startButton) {
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
  }


  const audioIsEnabled = hasAudio && getAllAudioTracks().some((track) => track.enabled);
  if (elements.toggleMicButton) {
    setButtonLabel(elements.toggleMicButton, audioIsEnabled ? "إيقاف المايك" : "تشغيل المايك");
  }
}


function updateAttendeeCount() {
  const count = attendeeElements.size;
  if (elements.attendeeCount) {
    elements.attendeeCount.textContent = String(count);
    elements.attendeeCount.setAttribute("aria-label", `عدد الحضور: ${count}`);
  }
  if (elements.sidebarAttendeeCount) elements.sidebarAttendeeCount.textContent = String(count);
  if (elements.attendeesEmpty) elements.attendeesEmpty.hidden = count > 0;
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
  classroomAudioSources.forEach(({ node, gainNode }) => {
    try {
      if (gainNode) gainNode.disconnect();
      else node.disconnect();
    } catch {}
  });


  classroomAudioDestinations.forEach((destination, destinationSocketId) => {
    const teacherSource = classroomAudioSources.get("__teacher_microphone__");
    const screenSource = classroomAudioSources.get("__screen_audio__");


    [teacherSource, screenSource].forEach((source) => {
      if (source?.enabled) {
        const outNode = source.gainNode || source.node;
        outNode.connect(destination);
      }
    });


    classroomAudioSources.forEach((source, sourceKey) => {
      if (
        sourceKey !== "__teacher_microphone__" &&
        sourceKey !== "__screen_audio__" &&
        sourceKey !== destinationSocketId &&
        source.enabled
      ) {
        const outNode = source.gainNode || source.node;
        outNode.connect(destination);
      }
    });
  });

  if (teacherMicGainNode && teacherMicAnalyserNode) {
    try {
      teacherMicGainNode.connect(teacherMicAnalyserNode);
    } catch {}
  }
}


function removeClassroomAudioSource(sourceKey) {
  const source = classroomAudioSources.get(sourceKey);
  if (!source) {
    return;
  }


  try {
    source.node.disconnect();
  } catch {}
  try {
    if (source.gainNode) source.gainNode.disconnect();
  } catch {}
  if (sourceKey === "__teacher_microphone__") {
    teacherMicGainNode = null;
    stopLiveMicMeter();
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
  } catch {}
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
  void syncTeacherSfuMedia();
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
  void syncTeacherSfuMedia();
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
    const gainNode = classroomAudioContext.createGain();
    if (sourceKey === "__teacher_microphone__") {
      gainNode.gain.value = teacherMicGainLevel;
      teacherMicGainNode = gainNode;
      setupLiveMicMeter(gainNode);
    } else {
      gainNode.gain.value = 1.0;
    }
    node.connect(gainNode);
    classroomAudioSources.set(sourceKey, { node, gainNode, stream, enabled: Boolean(enabled) });
    rebuildClassroomAudioGraph();
    return true;
  } catch (error) {
    console.warn("Unable to add an audio source to the classroom mix-minus graph:", error);
    return false;
  }
}


function clearClassroomAudioGraph() {
  stopLiveMicMeter();
  classroomAudioSources.forEach(({ node, gainNode }) => {
    try {
      node.disconnect();
    } catch {}
    try {
      if (gainNode) gainNode.disconnect();
    } catch {}
  });
  classroomAudioSources.clear();
  teacherMicGainNode = null;


  classroomAudioDestinations.forEach((destination) => {
    try {
      destination.disconnect();
    } catch {}
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
    if (classroomAudioContext.state === "suspended") {
      classroomAudioContext.resume().catch(() => {});
    }
    classroomAudioContext.onstatechange = () => {
      if (classroomAudioContext?.state === "suspended" && classActive) {
        classroomAudioContext.resume().catch(() => {});
      }
    };
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


function getTeacherMicrophoneConstraints() {
  return {
    audio: {
      echoCancellation: Boolean(teacherEchoCancellation),
      noiseSuppression: Boolean(teacherNoiseSuppression),
      autoGainControl: Boolean(teacherAgcEnabled),
      googAutoGainControl: Boolean(teacherAgcEnabled),
      googAutoGainControl2: Boolean(teacherAgcEnabled),
      googEchoCancellation: Boolean(teacherEchoCancellation),
      googNoiseSuppression: Boolean(teacherNoiseSuppression),
      googHighpassFilter: false,
      channelCount: 1,
    },
  };
}


function setTeacherMicGainLevel(newLevel) {
  const parsed = Math.max(0, Math.min(2.5, Number(newLevel) || 1.0));
  teacherMicGainLevel = parsed;
  try {
    localStorage.setItem("minasaty_teacher_mic_gain", String(parsed));
  } catch (_) {}

  if (teacherMicGainNode && classroomAudioContext && classroomAudioContext.state !== "closed") {
    try {
      teacherMicGainNode.gain.setTargetAtTime(parsed, classroomAudioContext.currentTime, 0.01);
    } catch (_) {
      teacherMicGainNode.gain.value = parsed;
    }
  }

  if (teacherMicRecordingGainNode && localRecordingAudioContext && localRecordingAudioContext.state !== "closed") {
    try {
      teacherMicRecordingGainNode.gain.setTargetAtTime(parsed, localRecordingAudioContext.currentTime, 0.01);
    } catch (_) {
      teacherMicRecordingGainNode.gain.value = parsed;
    }
  }

  updateAudioUi();
}


function updateAudioUi() {
  const percent = Math.round(teacherMicGainLevel * 100);
  if (elements.toolbarMicGainBadge) {
    elements.toolbarMicGainBadge.textContent = `${percent}%`;
  }
  if (elements.micGainSlider) {
    elements.micGainSlider.value = String(percent);
  }
  if (elements.micGainDisplay) {
    let label = `${percent}%`;
    if (percent === 100) label += " (طبيعي)";
    else if (percent > 100) label += " (مضخم)";
    else if (percent < 100) label += " (مخفض)";
    elements.micGainDisplay.textContent = label;
  }

  const pills = document.querySelectorAll(".gain-preset-pill");
  pills.forEach((pill) => {
    const pillGain = Number(pill.dataset.gain);
    pill.classList.toggle("is-active", pillGain === percent);
  });
}


function setupLiveMicMeter(gainNode) {
  if (!classroomAudioContext) return;
  stopLiveMicMeter();
  try {
    teacherMicAnalyserNode = classroomAudioContext.createAnalyser();
    teacherMicAnalyserNode.fftSize = 256;
    teacherMicAnalyserNode.smoothingTimeConstant = 0.5;
    gainNode.connect(teacherMicAnalyserNode);

    const buffer = new Uint8Array(teacherMicAnalyserNode.frequencyBinCount);

    function tickMeter() {
      if (!teacherMicAnalyserNode) return;
      teacherMicAnalyserNode.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i];
      }
      const avg = sum / buffer.length;
      const level = Math.min(100, Math.round((avg / 80) * 100));

      if (elements.vuMeterFill) {
        elements.vuMeterFill.style.width = `${level}%`;
      }
      if (elements.vuMeterLabel) {
        if (level > 85) {
          elements.vuMeterLabel.textContent = `مرتفع جداً (${level}%)`;
          elements.vuMeterLabel.style.color = "#ef4444";
        } else if (level > 20) {
          elements.vuMeterLabel.textContent = `نشط (${level}%)`;
          elements.vuMeterLabel.style.color = "#10b981";
        } else if (level > 3) {
          elements.vuMeterLabel.textContent = `صوت خافت (${level}%)`;
          elements.vuMeterLabel.style.color = "#f59e0b";
        } else {
          elements.vuMeterLabel.textContent = "جاهز للالتقاط (صامت)";
          elements.vuMeterLabel.style.color = "#94a3b8";
        }
      }

      teacherMicMeterAnimationFrame = window.requestAnimationFrame(tickMeter);
    }
    teacherMicMeterAnimationFrame = window.requestAnimationFrame(tickMeter);
  } catch (err) {
    console.warn("Unable to setup VU meter:", err);
  }
}


function stopLiveMicMeter() {
  if (teacherMicMeterAnimationFrame) {
    window.cancelAnimationFrame(teacherMicMeterAnimationFrame);
    teacherMicMeterAnimationFrame = null;
  }
  if (teacherMicAnalyserNode) {
    try { teacherMicAnalyserNode.disconnect(); } catch (_) {}
    teacherMicAnalyserNode = null;
  }
  if (elements.vuMeterFill) {
    elements.vuMeterFill.style.width = "0%";
  }
  if (elements.vuMeterLabel) {
    elements.vuMeterLabel.textContent = "جاهز للالتقاط";
    elements.vuMeterLabel.style.color = "#94a3b8";
  }
}


function openAudioSettingsModal() {
  if (!elements.audioSettingsModal) return;
  elements.audioSettingsModal.hidden = false;
  if (elements.settingEchoCancellation) {
    elements.settingEchoCancellation.checked = teacherEchoCancellation;
  }
  if (elements.settingNoiseSuppression) {
    elements.settingNoiseSuppression.checked = teacherNoiseSuppression;
  }
  if (elements.settingBrowserAgc) {
    elements.settingBrowserAgc.checked = teacherAgcEnabled;
  }
  updateAudioUi();
}


function closeAudioSettingsModal() {
  if (!elements.audioSettingsModal) return;
  elements.audioSettingsModal.hidden = true;
}


async function applyAudioAdvancedSettings() {
  const newEcho = Boolean(elements.settingEchoCancellation?.checked);
  const newNoise = Boolean(elements.settingNoiseSuppression?.checked);
  const newAgc = Boolean(elements.settingBrowserAgc?.checked);

  teacherEchoCancellation = newEcho;
  teacherNoiseSuppression = newNoise;
  teacherAgcEnabled = newAgc;

  try {
    localStorage.setItem("minasaty_teacher_echo_cancellation", String(newEcho));
    localStorage.setItem("minasaty_teacher_noise_suppression", String(newNoise));
    localStorage.setItem("minasaty_teacher_agc_enabled", String(newAgc));
  } catch (_) {}

  closeAudioSettingsModal();

  if (classActive) {
    try {
      setStudioStatus("جارٍ تطبيق إعدادات المايكروفون الجديدة…", "neutral");
      if (cameraStream) {
        cameraStream.getAudioTracks().forEach((t) => t.stop());
      }
      cameraStream = await navigator.mediaDevices.getUserMedia(getTeacherMicrophoneConstraints());
      addClassroomAudioSource("__teacher_microphone__", cameraStream, { enabled: true });
      syncMixMinusAudioToAllPeers();
      setStudioStatus("تم تطبيق إعدادات الصوت وتحديث المايكروفون بنجاح.", "live");
    } catch (err) {
      console.warn("Unable to refresh microphone with new constraints:", err);
      setStudioStatus("تعذر تحديث إعدادات المايكروفون: " + (err?.message || err), "error");
    }
  }
}


async function ensureTeacherMicrophoneActive() {
  let micTrack = cameraStream?.getAudioTracks?.().find((track) => track.readyState === "live");

  if (!micTrack && navigator.mediaDevices?.getUserMedia) {
    try {
      const freshMicStream = await navigator.mediaDevices.getUserMedia(getTeacherMicrophoneConstraints());
      if (freshMicStream?.getAudioTracks?.().length) {
        if (cameraStream) {
          try {
            cameraStream.getAudioTracks().forEach((t) => t.stop());
          } catch (ignored) {}
        }
        cameraStream = freshMicStream;
        micTrack = cameraStream.getAudioTracks()[0];
      }
    } catch (error) {
      console.warn("Unable to re-acquire teacher microphone track:", error);
    }
  }

  if (!classroomAudioContext || classroomAudioContext.state === "closed") {
    primeClassroomAudioContext();
  }
  if (classroomAudioContext && classroomAudioContext.state === "suspended") {
    try {
      await classroomAudioContext.resume();
    } catch (error) {
      console.warn("Unable to resume suspended classroomAudioContext:", error);
    }
  }

  if (classroomAudioContext && cameraStream) {
    addClassroomAudioSource("__teacher_microphone__", cameraStream, { enabled: true });
    if (screenStream) {
      addClassroomAudioSource("__screen_audio__", screenStream, { enabled: true });
    }
    rebuildClassroomAudioGraph();
  }

  syncMixMinusAudioToAllPeers();
  return Boolean(micTrack);
}


function stopClassroomAudioMix() {
  clearClassroomAudioGraph();


  const context = classroomAudioContext;
  classroomAudioContext = undefined;
  if (context && context.state !== "closed") {
    context.close().catch(() => {});
  }
}


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
    addClassroomAudioSource(studentSocketId, incomingStream, {
      enabled: approvedStudentMicrophones.has(studentSocketId),
    });
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


function removeStudentConnection(socketId, { statusMessage } = {}) {
  clearIceDisconnectTimer(socketId);
  approvedStudentMicrophones.delete(socketId);
  studentMicStates.delete(socketId);
  studentQualityPreferences.delete(socketId);
  closePeerConnection(socketId);
  removeAttendee(socketId);


  if (statusMessage && classActive) {
    setStudioStatus(statusMessage, "error");
  }
}


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
  teacherQosAllocations.delete(socketId);
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


const teacherQosLast = new Map();
const teacherQosAllocations = new Map();
const AUDIO_BITRATE_FLOOR = 16_000;
const AUDIO_BITRATE_CEILING = 48_000;
const VIDEO_BITRATE_FLOOR = 40_000;
const VIDEO_BITRATE_CEILING = 600_000;


function computeContinuousBandwidthAllocation(totalAvailableBitrate) {
  const total = Math.max(0, Number(totalAvailableBitrate) || 0);
  if (total <= AUDIO_BITRATE_FLOOR) {
    return { audioBitrate: total, videoBitrate: 0 };
  }


  const audioRange = AUDIO_BITRATE_CEILING - AUDIO_BITRATE_FLOOR;
  const audioBitrate = Math.min(
    AUDIO_BITRATE_CEILING,
    Math.round(AUDIO_BITRATE_FLOOR + audioRange * Math.min(1, (total - AUDIO_BITRATE_FLOOR) / VIDEO_BITRATE_CEILING))
  );
  let videoBitrate = Math.min(VIDEO_BITRATE_CEILING, Math.max(0, total - audioBitrate));
  if (videoBitrate < VIDEO_BITRATE_FLOOR) {
    return { audioBitrate: Math.min(AUDIO_BITRATE_CEILING, total), videoBitrate: 0 };
  }


  return {
    audioBitrate: Math.min(audioBitrate, total),
    videoBitrate: Math.min(videoBitrate, Math.max(0, total - audioBitrate)),
  };
}


const studentQualityPreferences = new Map();

function getAdaptiveVideoQualityProfile(quality = "auto", allocation = null) {
  const normalized = String(quality || "auto").trim().toLowerCase();
  if (normalized === "high") {
    return {
      maxBitrate: 6_000_000,
      maxFramerate: 60,
      scaleResolutionDownBy: 1.0,
      degradationPreference: "maintain-resolution",
    };
  }
  if (normalized === "medium") {
    return {
      maxBitrate: 2_500_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1.0,
      degradationPreference: "maintain-resolution",
    };
  }
  if (normalized === "low") {
    return {
      maxBitrate: 500_000,
      maxFramerate: 20,
      scaleResolutionDownBy: 2.5,
      degradationPreference: "maintain-resolution",
    };
  }
  // Auto adaptive mode optimized for online tutoring slides & blackboard:
  // In mesh topology, 30fps is the golden standard for smooth handwriting and video without network bloat.
  const videoBitrate = Math.min(2_500_000, Math.max(300_000, allocation?.videoBitrate ?? 1_200_000));
  return {
    maxBitrate: videoBitrate,
    maxFramerate: 30,
    scaleResolutionDownBy: 1.0,
    degradationPreference: "maintain-resolution",
  };
}

async function applyAdaptiveVideoQuality(studentSocketId, peerConnection, allocation) {
  const videoSender = peerConnection?.getSenders?.().find((sender) => sender.__classroomVideoTrack === true);
  if (!videoSender || typeof videoSender.setParameters !== "function") return;
  try {
    const studentPref = studentQualityPreferences.get(studentSocketId) || "auto";
    const profile = getAdaptiveVideoQualityProfile(studentPref, allocation);
    const parameters = videoSender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = profile.maxBitrate;
    parameters.encodings[0].maxFramerate = profile.maxFramerate;
    parameters.encodings[0].scaleResolutionDownBy = profile.scaleResolutionDownBy;
    parameters.degradationPreference = profile.degradationPreference;
    await videoSender.setParameters(parameters);
  } catch (error) {
    console.debug("Adaptive video quality was not applied:", error);
  }
}


async function applyAdaptiveAudioQuality(peerConnection, allocation) {
  const audioSender = getStudentAudioSender(peerConnection);
  if (!audioSender || typeof audioSender.setParameters !== "function") return;
  try {
    const parameters = audioSender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    // Guard against repeated audio parameter resets during live stream which glitch the Opus packetizer
    if (parameters.encodings[0].maxBitrate === AUDIO_BITRATE_CEILING && parameters.encodings[0].priority === "high") {
      return;
    }
    parameters.encodings[0].maxBitrate = AUDIO_BITRATE_CEILING;
    parameters.encodings[0].priority = "high";
    parameters.encodings[0].networkPriority = "high";
    await audioSender.setParameters(parameters);
  } catch (error) {
    console.debug("Adaptive audio quality was not applied:", error);
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
      let candidatePair = null;
      report.forEach((entry) => {
        if (entry.type === "outbound-rtp" && entry.kind === "video") outboundVideo = entry;
        if (entry.type === "remote-inbound-rtp" && entry.kind === "video") remoteInbound = entry;
        if (entry.type === "candidate-pair" && entry.state === "succeeded" && Number.isFinite(entry.availableOutgoingBitrate)) {
          if (!candidatePair || entry.availableOutgoingBitrate > candidatePair.availableOutgoingBitrate) candidatePair = entry;
        }
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
      const fallbackBitrate = Math.round(4_000_000 / (1 + (rtt || 0) / 400) / (1 + loss / 8));
      const totalAvailableBitrate = Math.max(0, Math.round(candidatePair?.availableOutgoingBitrate || fallbackBitrate));
      const allocation = computeContinuousBandwidthAllocation(totalAvailableBitrate);
      const targetVideoBitrate = allocation.videoBitrate;
      const lastBitrate = teacherQosAllocations.get(studentSocketId);
      // Hysteresis: only update video sender if target bitrate shifts by at least 150kbps to avoid jitter
      if (lastBitrate == null || Math.abs(lastBitrate - targetVideoBitrate) >= 150_000) {
        teacherQosAllocations.set(studentSocketId, targetVideoBitrate);
        void applyAdaptiveVideoQuality(studentSocketId, peerConnection, allocation);
      }
      let state = "جيدة";
      let stateClass = "good";
      if ((rtt && rtt > 300) || loss > 5) { state = "متوسطة"; stateClass = "warn"; }
      if ((rtt && rtt > 700) || loss > 12) { state = "ضعيفة"; stateClass = "bad"; }
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
      parameters.encodings[0].maxBitrate = VIDEO_BITRATE_CEILING;
      parameters.encodings[0].maxFramerate = 30;
      parameters.degradationPreference = "maintain-resolution";
    } else {
      parameters.encodings[0].maxBitrate = AUDIO_BITRATE_CEILING;
      parameters.encodings[0].priority = "high";
      parameters.encodings[0].networkPriority = "high";
    }


    await sender.setParameters(parameters);
  } catch (error) {
    console.debug("Sender quality tuning was not applied:", error);
  }
}


function addTeacherTracks(peerConnection, studentSocketId) {
  const videoStream = screenStream;
  const videoTrack = videoStream?.getVideoTracks?.().find((track) => track.readyState === "live");
  if (videoTrack) {
    videoTrack.contentHint = "detail";
    const sender = peerConnection.addTrack(videoTrack, videoStream);
    sender.__classroomVideoTrack = true;
    void tuneOutboundSender(sender, "video");
  }


  ensureStudentAudioSender(peerConnection, studentSocketId, { renegotiate: false });
}


function createPeerConnection(studentSocketId) {
  closePeerConnection(studentSocketId);


  const peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnections[studentSocketId] = peerConnection;
  pendingIceCandidates[studentSocketId] = [];


  addTeacherTracks(peerConnection, studentSocketId);
  attachStudentAudio(peerConnection, studentSocketId);


  peerConnection.onicecandidate = (event) => {
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


async function flushPendingIceCandidates(studentSocketId) {
  const peerConnection = peerConnections[studentSocketId];
  const candidates = pendingIceCandidates[studentSocketId] || [];


  if (!peerConnection || !peerConnection.remoteDescription) {
    return;
  }


  pendingIceCandidates[studentSocketId] = [];


  for (const candidate of candidates) {
    try {
      if (candidate) {
        await peerConnection.addIceCandidate(candidate);
      }
    } catch (error) {
      console.warn("Unable to add a queued ICE candidate:", error);
    }
  }
}


function waitForSocketConnection(timeoutMs = 15_000) {
  if (socket.connected) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      resolve(connected);
    };
    const handleConnect = () => finish(true);
    const handleConnectError = (err) => {
      console.warn("[Socket] Connect error while waiting:", err?.message || err);
      if (socket.io?.opts) {
        socket.io.opts.transports = ["polling", "websocket"];
      }
    };

    socket.once("connect", handleConnect);
    socket.on("connect_error", handleConnectError);

    const token = sessionStorage.getItem("teacherToken") || localStorage.getItem("teacherToken") || "";
    if (socket.auth && typeof socket.auth === "object") {
      socket.auth.token = token;
    }

    if (!socket.active && !socket.connected) {
      socket.connect();
    }
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


async function createAndSendOffer(studentSocketId, { iceRestart = false } = {}) {
  if (!classActive || !getActiveTeacherVideoTrack()) {
    return;
  }


  let peerConnection = peerConnections[studentSocketId];


  if (!peerConnection) {
    peerConnection = createPeerConnection(studentSocketId);
  }


  const videoTrack = getActiveTeacherVideoTrack();
  const videoSender = peerConnection.getSenders?.().find((s) => s.__classroomVideoTrack === true);
  if (videoSender && videoTrack && videoSender.track !== videoTrack) {
    try {
      await videoSender.replaceTrack(videoTrack);
    } catch (ignored) {}
  }

  ensureStudentAudioSender(peerConnection, studentSocketId, { renegotiate: false });


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
    const optimizedSdp = optimizeOpusSdp(offer.sdp);
    await peerConnection.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: optimizedSdp }));


    await emitWithAcknowledgement("webrtc_offer", {
      targetSocketId: studentSocketId,
      sdp: peerConnection.localDescription,
    }, 20_000);
  } catch (error) {
    console.warn(`[WebRTC] Unable to create or relay offer to student ${studentSocketId}:`, error.message || error);
    if (error?.message?.includes("تعذر توجيه")) {
      closePeerConnection(studentSocketId);
    }
  } finally {
    if (peerConnections[studentSocketId]) {
      peerConnections[studentSocketId].makingOffer = false;
    }
  }
}


function stopLocalStreams() {
  [screenStream, cameraStream].filter(Boolean).forEach((stream) => {
    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
  });


  screenStream = undefined;
  cameraStream = undefined;
  if (elements.localVideo) elements.localVideo.srcObject = null;
  setStageMode("idle");
  closeTeacherSfuSession();
}



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
    setStudioStatus("عاد الاتصال بالخادم. جارٍ استعادة الحصة وإعادة دمج الصوت والبث…", "live");
    const response = await emitWithAcknowledgement("teacher_start_room", {
      level: activeLevel,
      subject: activeSubject,
      resumeToken: classResumeToken,
      isRecovery: true,
    }, 25_000);


    if (!response?.ok && !response?.resumed) {
      throw new Error("تعذر استعادة جلسة الحصة الحالية.");
    }


    reconnectRetryCount = 0;
    if (reconnectRetryTimer) {
      window.clearTimeout(reconnectRetryTimer);
      reconnectRetryTimer = null;
    }

    await ensureTeacherMicrophoneActive();
    await syncTeacherVideoTrackToAllPeers();
    void initTeacherSfuSession(activeLevel);

    const studentSocketIds = Object.keys(peerConnections);

    for (const studentSocketId of studentSocketIds) {
      void createAndSendOffer(studentSocketId, { iceRestart: true });
    }

    setStudioStatus("تمت استعادة الحصة ومسار الميكروفون بنجاح.", "live");
  } catch (error) {
    console.error("Unable to restore live classroom after Socket reconnect:", error);
    reconnectRetryCount++;
    if (reconnectRetryCount <= 5 && classActive && socket.connected) {
      const delayMs = Math.min(reconnectRetryCount * 2_000, 8_000);
      setStudioStatus(`تعذر ربط الحصة مؤقتاً (${error.message || "خطأ اتصال"}). إعادة المحاولة تلقائياً بعد ${delayMs / 1000} ثوانٍ…`, "warning");
      window.clearTimeout(reconnectRetryTimer);
      reconnectRetryTimer = window.setTimeout(() => {
        void resumeLiveClassAfterSocketReconnect();
      }, delayMs);
    } else {
      setStudioStatus(error.message || "تعذر استعادة الحصة بعد عودة الاتصال.", "error");
    }
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


async function endLiveClass({ notifyServer = true, statusMessage, preserveRecovery = false } = {}) {
  if (isEnding) {
    return;
  }


  const levelToEnd = activeLevel;
  const subjectToRecover = activeSubject;
  const resumeTokenToRecover = classResumeToken;
  const hadActiveClass = classActive;
  if (preserveRecovery && levelToEnd && subjectToRecover && resumeTokenToRecover) {
    persistLiveClassRecovery();
    pendingPageRecovery = { level: levelToEnd, subject: subjectToRecover, resumeToken: resumeTokenToRecover };
  } else {
    clearLiveClassRecovery();
    clearOpenScheduledClassNotice();
  }
  isEnding = true;
  classActive = false;
  updateControls();


  try {
    if (notifyServer && hadActiveClass && levelToEnd && socket.connected) {
      try {
        await emitWithAcknowledgement("teacher_end_class", { level: levelToEnd }, 5_000);
      } catch (error) {
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
    sessionAttendedStudentIds.clear();
    currentAbsenteesData = null;
    updateAbsenteesBadge(0);
    activeLevel = null;
    activeSubject = null;
    activeScheduledClassId = null;
    activeYoutubeVideoId = null;
    classResumeToken = null;
    reconnectingLiveClass = false;
    isPageNavigatingAway = false;
    isEnding = false;
    updateControls();
    setStudioStatus(statusMessage || "تم إنهاء الحصة المباشرة.", "neutral");
    if (lastLocalRecording) {
      showRecordingReadyModal();
    }
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

async function publishTeacherMicState(active) {
  if (!activeLevel || !socket.connected) return;
  try {
    await emitWithAcknowledgement("teacher_mic_state", {
      level: activeLevel,
      active: Boolean(active),
    }, 5_000);
  } catch (error) {
    console.warn("Unable to publish teacher mic state:", error);
  }
}


async function stopScreenShare() {
  const streamToStop = screenStream;
  screenStream = undefined;
  streamToStop?.getTracks?.().forEach((track) => track.stop());
  if (elements.localVideo) elements.localVideo.srcObject = null;
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


let openScheduledClassNotice = null;


function clearOpenScheduledClassNotice() {
  openScheduledClassNotice?.remove();
  openScheduledClassNotice = null;
}


function isLiveRecoveryMessage(message = "") {
  const normalized = String(message).replace(/\s+/g, " ").trim();
  return normalized.includes("تستعيد اتصال الأستاذ") ||
    normalized.includes("إعادة الاتصال") ||
    normalized.includes("استعادة الحصة") ||
    normalized.includes("حصة جارية سابقة") ||
    normalized.includes("حصة جارية حالياً");
}


function showOpenScheduledClassNotice(scheduledClass = null, serverMessage = "") {
  clearOpenScheduledClassNotice();
  if (classActive || !document.body) return;


  const storedRecovery = pendingPageRecovery || readLiveClassRecovery();
  const level = scheduledClass?.level || storedRecovery?.level || elements.levelSelect?.value || "";
  const subject = scheduledClass?.subject || storedRecovery?.subject || elements.subjectSelect?.value || "";
  const resumeToken = storedRecovery?.resumeToken || createClassResumeToken();
  if (!level || !subject) return;


  pendingPageRecovery = { level, subject, resumeToken };
  if (elements.levelSelect && elements.levelSelect.value !== level) {
    elements.levelSelect.value = level;
    syncClassTypeSelector({ selectedValue: subject });
  } else if (elements.subjectSelect && elements.subjectSelect.value !== subject) {
    syncClassTypeSelector({ selectedValue: subject });
  }


  const modal = document.createElement("div");
  modal.className = "live-recovery-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.72)";
  const panel = document.createElement("div");
  panel.style.cssText = "width:min(560px,100%);padding:28px;border-radius:16px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center;color:#172033";
  const title = document.createElement("h2");
  title.textContent = "توجد حصة جارية حالياً بانتظارك لهذا المستوى والمادة والطلاب متصلون";
  title.style.cssText = "margin:0 0 14px;font-size:clamp(20px,3vw,28px);line-height:1.45";
  const details = document.createElement("p");
  details.textContent = `${level} — ${getClassTypeName(level, subject)}`;
  details.style.cssText = "margin:0 0 22px;color:#526071;font-weight:600";
  
  const resumeButton = document.createElement("button");
  resumeButton.type = "button";
  resumeButton.className = "primary-button";
  resumeButton.textContent = "استعادة الحصة الآن والاتصال بالطلاب";
  resumeButton.style.cssText = "width:100%;min-height:52px;padding:12px 18px;border:0;border-radius:10px;background:#0d6efd;color:#fff;font-size:17px;font-weight:700;cursor:pointer";
  
  // زر إلغاء الاستعادة وبدء حصة جديدة
  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.textContent = "إلغاء وبدء حصة جديدة من الصفر";
  dismissButton.style.cssText = "width:100%;margin-top:10px;min-height:44px;padding:10px 18px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#475569;font-size:15px;font-weight:600;cursor:pointer";
  dismissButton.addEventListener("click", () => {
    clearOpenScheduledClassNotice();
    clearLiveClassRecovery();
    setStudioStatus("تم إلغاء الاستعادة، يمكنك الآن اختيار المستوى وبدء حصة جديدة.", "neutral");
  });


  // إغلاق المودال عند النقر في أي مكان فارغ بالخارج
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      clearOpenScheduledClassNotice();
    }
  });


  resumeButton.addEventListener("click", async () => {
    const level = scheduledClass?.level || elements.levelSelect?.value || "";
    const subject = scheduledClass?.subject || elements.subjectSelect?.value || "";
    const resumeToken = scheduledClass?.resumeToken || pendingPageRecovery?.resumeToken || readLiveClassRecovery()?.resumeToken || "";
    const customErrorMessage = serverMessage || "تعذر استعادة الجلسة السابقة.";


    resumeButton.disabled = true;
    resumeButton.textContent = "جاري استعادة الحصة والاتصال...";


    pendingPageRecovery = { level, subject, resumeToken, isRecovery: true, forceResume: true };
    if (elements.levelSelect && level) {
      elements.levelSelect.value = level;
    }
    if (typeof syncClassTypeSelector === "function" && subject) {
      syncClassTypeSelector({ selectedValue: subject });
    }


    clearOpenScheduledClassNotice();


    try {
      await startLiveClass();
    } catch (err) {
      console.error("فشل استعادة الحصة:", err);
    } finally {
      if (!classActive) {
        resumeButton.disabled = false;
        resumeButton.textContent = "استعادة الحصة الآن والاتصال بالطلاب";
        if (!openScheduledClassNotice) {
          showOpenScheduledClassNotice(scheduledClass, customErrorMessage);
        }
      }
    }
  });


  panel.append(title, details, resumeButton, dismissButton);
  modal.append(panel);
  document.body.append(modal);
  openScheduledClassNotice = modal;
  resumeButton.focus();
}


async function checkForOpenScheduledClass() {
  if (classActive || isStarting || isEnding || !socket.connected) return;
  const level = elements.levelSelect?.value;
  const subject = elements.subjectSelect?.value;
  if (!level || !subject) return;
  try {
    const response = await emitWithAcknowledgement("teacher_find_open_class", { level, subject }, 5_000);
    if (response?.scheduledClass) showOpenScheduledClassNotice(response.scheduledClass);
    else clearOpenScheduledClassNotice();
  } catch (_) {
    clearOpenScheduledClassNotice();
  }
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
    clearTeacherChat();
    activeLevel = selectedLevel;
    setTeacherWelcomeImage(selectedLevel);
    setStageMode("welcome");
    primeClassroomAudioContext();


    if (navigator.mediaDevices?.getUserMedia) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia(getTeacherMicrophoneConstraints());
      } catch (error) {
        microphoneUnavailableMessage = getMediaErrorMessage(error, "المايك");
        console.warn("Teacher microphone is unavailable:", error);
      }
    }


    const classroomMixReady = await initializeClassroomAudioMix();
    if (!classroomMixReady) {
      microphoneUnavailableMessage = microphoneUnavailableMessage || "تعذر تجهيز صوت الصف الموحد";
    }


    activeLevel = selectedLevel;
    activeSubject = selectedSubject;
    classResumeToken = pageRecovery?.resumeToken || createClassResumeToken();
    classActive = true;


    if (!socket.connected) {
      setStudioStatus("جارٍ الاتصال بخادم الحصة وتجهيز البث…", "neutral");
      const connected = await waitForSocketConnection(15_000);
      if (!connected || !socket.connected) {
        throw new Error("تعذر الاتصال بالخادم بعد اختيار الشاشة. حاول مرة أخرى.");
      }
    }


    const roomResponse = await emitWithAcknowledgement("teacher_start_room", {
      level: selectedLevel,
      subject: selectedSubject,
      resumeToken: classResumeToken,
      isRecovery: Boolean(pageRecovery?.isRecovery || isResumingAfterPageRefresh),
      forceResume: Boolean(pageRecovery?.forceResume || isResumingAfterPageRefresh),
    });


    activeScheduledClassId = roomResponse?.scheduledClassId || null;
    activeYoutubeVideoId = roomResponse?.youtubeVideoId || null;
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
    void publishTeacherMicState(!microphoneUnavailableMessage && getAllAudioTracks().some((track) => track.enabled));
    void refreshAbsenteesBadge();
    void initTeacherSfuSession(selectedLevel);
  } catch (error) {
    console.error("Unable to start live class:", error);
    classActive = false;
    activeLevel = null;
    activeSubject = null;
    const recoveryError = isLiveRecoveryMessage(error?.message);
    if (!isResumingAfterPageRefresh && !recoveryError) {
      clearLiveClassRecovery();
      classResumeToken = null;
    }
    closeAllPeerConnections();
    clearAttendees();
    stopLocalStreams();
    const errorMessage = error?.message || getMediaErrorMessage(error, "مشاركة الشاشة");
    setStudioStatus(errorMessage, "error");
    if (recoveryError) {
      showOpenScheduledClassNotice(null, errorMessage);
    }
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

  if (shouldEnable && classroomAudioContext && classroomAudioContext.state === "suspended") {
    classroomAudioContext.resume().catch(() => {});
  }

  setStudioStatus(shouldEnable ? "تم تشغيل المايك." : "تم إيقاف المايك.", "live");
  updateControls();
  void publishTeacherMicState(shouldEnable);
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


async function muteAllStudentsMicrophones() {
  if (!classActive || isEnding) return;
  try {
    setStudioStatus("جارٍ كتم ميكروفونات جميع التلاميذ…", "neutral");
    await emitWithAcknowledgement("teacher_mute_all_mics", { level: activeLevel });
    attendeeElements.forEach((attendee, socketId) => {
      applyStudentMicrophoneState(socketId, false);
    });
    approvedStudentMicrophones.clear();
    rebuildClassroomAudioGraph();
    setStudioStatus("تم كتم ميكروفونات جميع التلاميذ بنجاح.", "live");
  } catch (err) {
    console.error("Failed to mute all mics:", err);
    setStudioStatus(err.message || "تعذر كتم ميكروفونات جميع التلاميذ.", "error");
  }
}


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
    void checkForOpenScheduledClass();
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

  if (studentId) {
    sessionAttendedStudentIds.add(String(studentId).trim());
  }

  const attendee = upsertAttendee(socketId, studentId, studentName || "تلميذ", participationCount);
  syncStudentMicButton(attendee, socketId, false);
  await createAndSendOffer(socketId);
  refreshAbsenteesBadge();
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


socket.on("all_student_mics_muted", () => {
  attendeeElements.forEach((attendee, socketId) => {
    applyStudentMicrophoneState(socketId, false);
  });
  approvedStudentMicrophones.clear();
  rebuildClassroomAudioGraph();
});


socket.on("recovery_students", async (data = {}) => {
  if (!classActive || !Array.isArray(data.students)) {
    return;
  }

  await ensureTeacherMicrophoneActive();

  for (const student of data.students) {
    if (!student?.socketId) {
      continue;
    }


    const attendee = upsertAttendee(student.socketId, student.studentId, student.studentName || "تلميذ", student.participationCount);
    syncStudentMicButton(attendee, student.socketId, Boolean(student.micEnabled));
    applyStudentMicrophoneState(student.socketId, Boolean(student.micEnabled));
    await createAndSendOffer(student.socketId, { iceRestart: true });
  }
});


socket.on("youtube_server_upload_completed", (data = {}) => {
  if (data && (!currentServerUploadId || data.uploadId === currentServerUploadId)) {
    console.log("Server background YouTube upload completed:", data);
    if (data.videoId && elements.youtubeViewVideoButton) {
      elements.youtubeViewVideoButton.href = `https://youtu.be/${data.videoId}`;
      elements.youtubeViewVideoButton.hidden = false;
    }
    if (elements.recordingReadyTitle) {
      elements.recordingReadyTitle.textContent = "✅ اكتمل رفع الحصة في قناتك على YouTube!";
      elements.recordingReadyTitle.style.color = "#4ade80";
    }
    if (elements.recordingReadySubtitle) {
      elements.recordingReadySubtitle.textContent = "تم نشر التسجيل في قناتك وربطه بسجل الحصة في المنصة بنجاح.";
    }
    if (elements.youtubeModalAlertText) {
      elements.youtubeModalAlertText.textContent = "🎉 تم اكتمال الرفع والمعالجة على YouTube وربط الفيديو بالقسم بنجاح!";
    }
    setStudioStatus("✅ اكتمل رفع الفيديو إلى قناتك على YouTube وربطه بالحصة بنجاح.", "live");
  }
});


socket.on("youtube_server_upload_failed", (data = {}) => {
  if (data && (!currentServerUploadId || data.uploadId === currentServerUploadId)) {
    console.warn("Server background YouTube upload failed:", data);
    if (elements.youtubeModalAlertText) {
      elements.youtubeModalAlertText.textContent = `⚠️ تنبيه: تعذر رفع الفيديو إلى YouTube (${data.error || "خطأ غير متوقع"}). الملف محفوظ في جهازك (مجلد التنزيلات).`;
    }
    setStudioStatus(`تعذر رفع الحصة إلى YouTube: ${data.error || "خطأ"}. التسجيل محفوظ في جهازك.`, "error");
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
  } catch (error) {
    console.error("Unable to apply a student WebRTC answer:", error);
    closePeerConnection(fromSocketId);
  }
});


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
    if (peerConnection.signalingState !== "stable") {
      return;
    }


    await peerConnection.setRemoteDescription(sdp);
    await flushPendingIceCandidates(fromSocketId);


    const answer = await peerConnection.createAnswer();
    const optimizedSdp = optimizeOpusSdp(answer.sdp);
    await peerConnection.setLocalDescription(new RTCSessionDescription({ type: answer.type, sdp: optimizedSdp }));


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


socket.on("student_quality_preference", async (data = {}) => {
  const studentSocketId = data.studentSocketId;
  const quality = String(data.quality || "auto").trim().toLowerCase();
  if (!studentSocketId) return;
  studentQualityPreferences.set(studentSocketId, quality);
  const pc = peerConnections[studentSocketId];
  if (pc && pc.connectionState !== "closed") {
    const lastAllocation = teacherQosAllocations.get(studentSocketId);
    let parsedAllocation = null;
    if (lastAllocation) {
      const [audioBitrate, videoBitrate] = lastAllocation.split(":").map(Number);
      parsedAllocation = { audioBitrate, videoBitrate };
    }
    await applyAdaptiveVideoQuality(studentSocketId, pc, parsedAllocation);
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
    id: data.id,
    sender: data.studentName || "تلميذ",
    message: fallbackMessage,
    kind: "student",
    imageUrl,
    studentSocketId: data.socketId || "",
    studentId: data.studentId || "",
    reactions: data.reactions || null,
  });
});

socket.on("classroom_chat_reaction_updated", (data = {}) => {
  if (!classActive || data.level !== activeLevel) return;
  updateTeacherMessageReactions(data);
});


socket.on("student_left", (data = {}) => {
  const socketId = data.socketId || attendeeSocketByStudentId.get(String(data.studentId || "").trim());
  if (socketId) {
    removeStudentConnection(socketId);
    refreshAbsenteesBadge();
    return;
  }
  if (data.studentId) removeAttendeeByStudentId(data.studentId);
  refreshAbsenteesBadge();
});


socket.on("class_ended", (data = {}) => {
  if (!classActive || isEnding) {
    return;
  }


  endLiveClass({
    notifyServer: false,
    preserveRecovery: data.reason === "teacher_disconnected",
    statusMessage:
      data.reason === "teacher_disconnected"
        ? "انقطع اتصال الأستاذ؛ الحصة محفوظة بانتظار عودته."
        : "تم إنهاء الحصة المباشرة.",
  });
});


socket.on("classroom_error", (data = {}) => {
  if (data.message) {
    setStudioStatus(data.message, "error");
    if (isLiveRecoveryMessage(data.message)) {
      showOpenScheduledClassNotice(null, data.message);
    }
  }
});


socket.on("disconnect", () => {
  if (!classActive) {
    if (isStarting) setStudioStatus("انقطع الاتصال. جارٍ إعادة الاتصال قبل بدء الحصة…", "neutral");
    return;
  }


  closeAllPeerConnections();
  clearAttendees();
  setStudioStatus("انقطع الاتصال بالخادم. جارٍ استعادة الحصة تلقائياً…", "error");
  updateControls();
});


socket.connect();


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
  refreshStudioDuration();
} catch (error) {
  console.error("Unable to initialize optional studio controls:", error);
}


elements.levelSelect.addEventListener("change", () => {
  if (!classActive && !isStarting && !isEnding) {
    syncClassTypeSelector();
    void checkForOpenScheduledClass();
    void refreshAbsenteesBadge();
  }
});
elements.subjectSelect?.addEventListener("change", () => {
  void checkForOpenScheduledClass();
  void refreshAbsenteesBadge();
});
elements.screenShareButton?.addEventListener("click", () => void toggleScreenShare());
elements.toggleMicButton.addEventListener("click", toggleMicrophone);
elements.audioSettingsButton?.addEventListener("click", openAudioSettingsModal);
elements.closeAudioSettingsModal?.addEventListener("click", closeAudioSettingsModal);
elements.audioSettingsBackdrop?.addEventListener("click", closeAudioSettingsModal);
elements.applyAudioSettingsButton?.addEventListener("click", () => void applyAudioAdvancedSettings());
elements.resetAudioSettingsButton?.addEventListener("click", () => {
  setTeacherMicGainLevel(1.0);
  if (elements.settingEchoCancellation) elements.settingEchoCancellation.checked = true;
  if (elements.settingNoiseSuppression) elements.settingNoiseSuppression.checked = false;
  if (elements.settingBrowserAgc) elements.settingBrowserAgc.checked = false;
  void applyAudioAdvancedSettings();
});

elements.micGainSlider?.addEventListener("input", (e) => {
  const val = Number(e.target.value) / 100;
  setTeacherMicGainLevel(val);
});

document.querySelectorAll(".gain-preset-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = Number(btn.dataset.gain) / 100;
    setTeacherMicGainLevel(val);
  });
});
elements.muteAllMicsButton?.addEventListener("click", () => void muteAllStudentsMicrophones());
elements.sidebarMuteAllButton?.addEventListener("click", () => void muteAllStudentsMicrophones());
elements.recordLocalButton.addEventListener("click", toggleLocalRecording);
elements.downloadRecordingButton?.addEventListener("click", handleDownloadRecordingClick);
elements.forceUploadYoutubeButton?.addEventListener("click", handleForceUploadYoutubeClick);
elements.uploadFromDeviceButton?.addEventListener("click", handleUploadFromDevice);
elements.uploadFromDeviceInput?.addEventListener("change", handleDeviceFileSelected);
elements.modalDownloadRecordingButton?.addEventListener("click", handleDownloadRecordingClick);
elements.saveDriveButton.addEventListener("click", handleGoogleDriveButton);
elements.uploadYoutubeAfterEndButton?.addEventListener("click", handleForceUploadYoutubeClick);
elements.closeRecordingReadyButton?.addEventListener("click", () => closeRecordingReadyModal());
elements.youtubeModalMinimizeButton?.addEventListener("click", () => minimizeYoutubeUploadModal());
elements.youtubeMinimizedBadge?.addEventListener("click", () => expandYoutubeUploadModal());
elements.recordingReadyModal?.addEventListener("click", (event) => {
  if (event.target === elements.recordingReadyModal) {
    if (youtubeUploadInProgress) {
      minimizeYoutubeUploadModal();
    } else {
      closeRecordingReadyModal();
    }
  }
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

// ── Teacher Live Alert Listeners ──
elements.sendLiveAlertButton?.addEventListener("click", openTeacherAlertModal);
elements.closeTeacherAlertModalButton?.addEventListener("click", closeTeacherAlertModal);
elements.cancelAlertModalButton?.addEventListener("click", closeTeacherAlertModal);
elements.teacherAlertModal?.addEventListener("click", (event) => {
  if (event.target === elements.teacherAlertModal) closeTeacherAlertModal();
});

elements.alertSelectAllLevelsButton?.addEventListener("click", () => {
  document.querySelectorAll('input[name="alert-level"]').forEach((cb) => { cb.checked = true; });
  refreshTeacherAlertAudience();
});

elements.alertDeselectAllLevelsButton?.addEventListener("click", () => {
  document.querySelectorAll('input[name="alert-level"]').forEach((cb) => { cb.checked = false; });
  refreshTeacherAlertAudience();
});

document.querySelectorAll('input[name="alert-level"]').forEach((el) => {
  el.addEventListener("change", refreshTeacherAlertAudience);
});

document.querySelectorAll('input[name="alert-subject"]').forEach((el) => {
  el.addEventListener("change", refreshTeacherAlertAudience);
});

document.querySelectorAll('input[name="alert-payment"]').forEach((el) => {
  el.addEventListener("change", refreshTeacherAlertAudience);
});

document.querySelectorAll('input[name="alert-target-mode"]').forEach((el) => {
  el.addEventListener("change", () => {
    const isSelected = el.value === "SELECTED" && el.checked;
    if (elements.alertSpecificStudentsWrap) {
      elements.alertSpecificStudentsWrap.hidden = !isSelected;
    }
    if (isSelected) {
      renderAlertStudentsList();
    }
  });
});

elements.alertStudentSearchInput?.addEventListener("input", renderAlertStudentsList);

elements.alertStudentsSelectionList?.addEventListener("change", (event) => {
  if (event.target?.classList.contains("alert-student-checkbox")) {
    updateSelectedStudentsCount();
  }
});

elements.submitSendAlertButton?.addEventListener("click", () => {
  void handleSubmitTeacherLiveAlert();
});

// ── Absentees Modal & Control Listeners ──
elements.absenteesBtn?.addEventListener("click", openAbsenteesModal);
elements.absenteesModalClose?.addEventListener("click", closeAbsenteesModal);
elements.absenteesModalBackdrop?.addEventListener("click", closeAbsenteesModal);
elements.absenteesRefreshBtn?.addEventListener("click", async () => {
  if (elements.absenteesLoading) elements.absenteesLoading.hidden = false;
  if (elements.absenteesList) elements.absenteesList.hidden = true;
  if (elements.absenteesEmpty) elements.absenteesEmpty.hidden = true;
  if (elements.absenteesError) elements.absenteesError.hidden = true;
  try {
    const data = await fetchLiveAbsentees();
    if (elements.absenteesLoading) elements.absenteesLoading.hidden = true;
    updateAbsenteesModalView(data);
  } catch (err) {
    if (elements.absenteesLoading) elements.absenteesLoading.hidden = true;
    if (elements.absenteesError) elements.absenteesError.hidden = false;
    if (elements.absenteesErrorText) elements.absenteesErrorText.textContent = err.message || "تعذر تحديث قائمة الغائبين.";
  }
});
elements.absenteesAlertAllBtn?.addEventListener("click", handleAlertAllAbsentees);
elements.absenteesSearchInput?.addEventListener("input", (e) => {
  renderAbsenteesList(e.target.value);
});

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
    closeAbsenteesModal();
  }
});


function preserveClassroomForPageRefresh() {
  isPageNavigatingAway = true;
  if (classActive) {
    persistLiveClassRecovery();
  }
}


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


void checkForOpenScheduledClass();
void refreshAbsenteesBadge();
updateAttendeeCount();
try {
  updateControls();
} catch (error) {
  console.error("Unable to initialize studio controls:", error);
  setStudioStatus("تعذر تهيئة عناصر الاستوديو. أعد تحميل الصفحة وحاول مرة أخرى.", "error");
}

function installPullToRefreshBlocker() {
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
  window.addEventListener("touchstart", (e) => {
    if (e.touches && e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const deltaY = e.touches[0].clientY - touchStartY;
    if (deltaY > 0) {
      let target = e.target;
      let scrollable = null;
      while (target && target !== document.body && target !== document.documentElement) {
        const overflowY = window.getComputedStyle(target).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && target.scrollHeight > target.clientHeight) {
          scrollable = target;
          break;
        }
        target = target.parentElement;
      }
      const pageScroll = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      if (!scrollable && pageScroll <= 0) {
        if (e.cancelable) e.preventDefault();
      } else if (scrollable && scrollable.scrollTop <= 0) {
        if (e.cancelable) e.preventDefault();
      }
    }
  }, { passive: false });
}
installPullToRefreshBlocker();
updateAudioUi();

