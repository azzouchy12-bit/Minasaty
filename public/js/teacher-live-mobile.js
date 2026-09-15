/**
 * Minasaty - Teacher Live Mobile Controller
 * Designed specifically for smartphones (iOS & Android)
 * Provides full live-streaming audio, optional camera broadcast,
 * student microphone management, live chat, and attendance.
 */
"use strict";

(() => {
  // ---------------------------------------------------------------------------
  // 1. Authentication & Socket Setup
  // ---------------------------------------------------------------------------
  const teacherToken = sessionStorage.getItem("teacherToken") || "";
  
  const socket = io({
    auth: { token: teacherToken },
    autoConnect: false,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

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

  // ---------------------------------------------------------------------------
  // 2. Constants & Configuration
  // ---------------------------------------------------------------------------
  const LEVEL_WELCOME_IMAGES = {
    "السنة الأولى": "/assets/level-welcome/year-1.webp",
    "السنة الثانية": "/assets/level-welcome/year-2.webp",
    "السنة الثالثة": "/assets/level-welcome/year-3.webp",
    "السنة الرابعة": "/assets/level-welcome/year-4.jpg",
    "طالب جامعي": "/assets/level-welcome/year-4.jpg",
    "FREE": "/assets/level-welcome/year-1.webp",
  };

  const RECOVERY_STORAGE_KEY = "teacherLiveClassRecovery";

  // ---------------------------------------------------------------------------
  // 3. Application State
  // ---------------------------------------------------------------------------
  let classActive = false;
  let activeLevel = "السنة الأولى";
  let activeSubject = "MATH";
  let classResumeToken = null;
  let isStarting = false;
  let isEnding = false;
  let studioStartTime = 0;
  let studioTimerInterval = null;

  // Media Streams & WebRTC
  let micStream = null;
  let cameraStream = null;
  let cameraFacingMode = "environment"; // default to back camera (for notebook/blackboard)
  let isCameraActive = false;
  let isMicActive = true;

  // Audio Graph (Mix-Minus)
  let classroomAudioContext = null;
  const classroomAudioSources = new Map();
  const classroomAudioDestinations = new Map();
  const studentAudioElements = new Map();
  const approvedStudentMicrophones = new Set();

  // WebRTC Peer Connections
  const peerConnections = Object.create(null);
  const pendingIceCandidates = Object.create(null);

  // Attendees & Chat
  const attendeesMap = new Map(); // socketId -> { studentId, studentName, handRaised, micEnabled, count }
  let unreadChatCount = 0;
  let activeTab = "studio";
  const questionImageUrls = new Set();
  let isCompanionMode = false;
  let companionPeerConnection = null;
  let companionPrimaryTeacherSocketId = null;
  let currentAbsenteesData = null;
  let absenteesRefreshTimer = null;

  // ---------------------------------------------------------------------------
  // 4. DOM Elements
  // ---------------------------------------------------------------------------
  const el = {
    // Header
    liveBadge: document.getElementById("tm-live-badge"),
    liveText: document.getElementById("tm-live-text"),

    // Selectors
    levelSelect: document.getElementById("tm-level-select"),
    subjectSelect: document.getElementById("tm-subject-select"),
    subjectGroup: document.getElementById("tm-subject-group"),
    subjectLabel: document.getElementById("tm-subject-label"),

    // Stage
    stageImage: document.getElementById("tm-stage-image"),
    cameraVideo: document.getElementById("tm-camera-video"),
    companionVideo: document.getElementById("tm-companion-video"),
    cameraFlipBtn: document.getElementById("tm-camera-flip-btn"),
    stageModeTag: document.getElementById("tm-stage-mode-tag"),
    stageTimer: document.getElementById("tm-stage-timer"),
    statusBanner: document.getElementById("tm-status-banner"),

    // Action Controls
    startBtn: document.getElementById("tm-start-btn"),
    startBtnIcon: document.getElementById("tm-start-btn-icon"),
    startBtnText: document.getElementById("tm-start-btn-text"),
    micBtn: document.getElementById("tm-mic-btn"),
    micLabel: document.getElementById("tm-mic-label"),
    cameraBtn: document.getElementById("tm-camera-btn"),
    cameraLabel: document.getElementById("tm-camera-label"),
    endBtn: document.getElementById("tm-end-btn"),

    // Stats
    studentCountStat: document.getElementById("tm-student-count-stat"),
    handsCountStat: document.getElementById("tm-hands-count-stat"),
    absentCardBtn: document.getElementById("tm-absent-card-btn"),
    absentCountStat: document.getElementById("tm-absent-count-stat"),

    // Chat
    chatBox: document.getElementById("tm-chat-box"),
    chatEmpty: document.getElementById("tm-chat-empty"),
    chatForm: document.getElementById("tm-chat-form"),
    chatInput: document.getElementById("tm-chat-input"),
    chatSendBtn: document.getElementById("tm-chat-send-btn"),
    chatNavBadge: document.getElementById("tm-chat-nav-badge"),

    // Attendees
    attendeeSearch: document.getElementById("tm-attendee-search"),
    subnavPresentBtn: document.getElementById("tm-subnav-present-btn"),
    subnavAbsentBtn: document.getElementById("tm-subnav-absent-btn"),
    subnavPresentBadge: document.getElementById("tm-subnav-present-badge"),
    subnavAbsentBadge: document.getElementById("tm-subnav-absent-badge"),
    presentView: document.getElementById("tm-present-view"),
    absentView: document.getElementById("tm-absent-view"),
    handsSection: document.getElementById("tm-hands-section"),
    handsBadgeNum: document.getElementById("tm-hands-badge-num"),
    handsList: document.getElementById("tm-hands-list"),
    attendeesContainer: document.getElementById("tm-attendees-container"),
    attendeesEmpty: document.getElementById("tm-attendees-empty"),
    absenteesContainer: document.getElementById("tm-absentees-container"),
    absenteesEmpty: document.getElementById("tm-absentees-empty"),
    handsNavBadge: document.getElementById("tm-hands-nav-badge"),

    // Nav
    navButtons: document.querySelectorAll(".tm-nav-item"),
    tabPanes: document.querySelectorAll(".tm-tab-pane"),

    // Modals
    endModal: document.getElementById("tm-end-modal"),
    confirmEndBtn: document.getElementById("tm-confirm-end-btn"),
    cancelEndBtn: document.getElementById("tm-cancel-end-btn"),
    imageModal: document.getElementById("tm-image-modal"),
    imageModalImg: document.getElementById("tm-image-viewer-img"),
    imageModalClose: document.getElementById("tm-image-viewer-close"),
    toast: document.getElementById("tm-toast"),
  };

  // ---------------------------------------------------------------------------
  // 5. Utility Helpers
  // ---------------------------------------------------------------------------
  function showToast(text, duration = 3000) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.add("is-visible");
    window.clearTimeout(el.toast._timer);
    el.toast._timer = window.setTimeout(() => {
      el.toast.classList.remove("is-visible");
    }, duration);
  }

  function setStatus(text, type = "neutral") {
    if (!el.statusBanner) return;
    el.statusBanner.textContent = text;
    el.statusBanner.className = "tm-status-banner";
    if (type === "live") el.statusBanner.classList.add("is-live");
    if (type === "error") el.statusBanner.classList.add("is-error");
  }

  function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return [
      hrs.toString().padStart(2, "0"),
      mins.toString().padStart(2, "0"),
      secs.toString().padStart(2, "0"),
    ].join(":");
  }

  function generateResumeToken() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    const arr = new Uint32Array(4);
    window.crypto?.getRandomValues(arr);
    return Array.from(arr, (n) => n.toString(36)).join("-") || `${Date.now()}-mob-rec`;
  }

  function emitWithAcknowledgement(eventName, payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const doEmit = () => {
        const timeoutId = window.setTimeout(() => {
          reject(new Error("انتهت مهلة استجابة الخادم."));
        }, timeoutMs);

        socket.emit(eventName, payload, (response) => {
          window.clearTimeout(timeoutId);
          if (response?.ok) {
            resolve(response);
            return;
          }
          reject(new Error(response?.message || response?.error || "تعذر تنفيذ الطلب من الخادم."));
        });
      };

      if (socket.connected) {
        doEmit();
      } else {
        socket.connect();
        const connectTimeout = window.setTimeout(() => {
          reject(new Error("الاتصال بالخادم غير متاح حالياً."));
        }, Math.min(timeoutMs, 6000));

        socket.once("connect", () => {
          window.clearTimeout(connectTimeout);
          doEmit();
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Navigation Tabs & Sub-navigation
  // ---------------------------------------------------------------------------
  function switchTab(targetTab) {
    activeTab = targetTab;
    el.navButtons.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === targetTab);
    });
    el.tabPanes.forEach((pane) => {
      pane.classList.toggle("is-active", pane.dataset.pane === targetTab);
    });

    if (targetTab === "chat") {
      unreadChatCount = 0;
      updateChatNavBadge();
      if (el.chatBox) {
        el.chatBox.scrollTop = el.chatBox.scrollHeight;
      }
    } else if (targetTab === "attendees") {
      if (el.absentView && !el.absentView.hidden) {
        fetchLiveAbsentees();
      }
    }
  }

  el.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  if (el.subnavPresentBtn && el.subnavAbsentBtn) {
    el.subnavPresentBtn.addEventListener("click", () => {
      el.subnavPresentBtn.classList.add("is-active");
      el.subnavAbsentBtn.classList.remove("is-active");
      if (el.presentView) el.presentView.hidden = false;
      if (el.absentView) el.absentView.hidden = true;
      renderAttendees();
    });

    el.subnavAbsentBtn.addEventListener("click", () => {
      el.subnavAbsentBtn.classList.add("is-active");
      el.subnavPresentBtn.classList.remove("is-active");
      if (el.presentView) el.presentView.hidden = true;
      if (el.absentView) el.absentView.hidden = false;
      fetchLiveAbsentees();
    });
  }

  if (el.absentCardBtn) {
    el.absentCardBtn.addEventListener("click", () => {
      switchTab("attendees");
      if (el.subnavAbsentBtn) {
        el.subnavAbsentBtn.click();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Level & Subject Synchronization
  // ---------------------------------------------------------------------------
  function updateLevelSelection(level) {
    activeLevel = level;
    const imgUrl = LEVEL_WELCOME_IMAGES[level] || LEVEL_WELCOME_IMAGES["السنة الأولى"];
    if (el.stageImage) {
      el.stageImage.src = imgUrl;
    }

    const isGlobalFree = level === "FREE";
    const isUniversity = level === "طالب جامعي";

    if (el.subjectGroup) {
      el.subjectGroup.hidden = isGlobalFree;
    }

    if (el.subjectLabel) {
      el.subjectLabel.textContent = isUniversity ? "نوع الاشتراك" : "المادة";
    }

    if (el.subjectSelect) {
      if (isGlobalFree) {
        el.subjectSelect.innerHTML = `<option value="FREE">حصة مجانية</option>`;
      } else if (isUniversity) {
        el.subjectSelect.innerHTML = `
          <option value="PAID">اشتراك مدفوع</option>
          <option value="FREE">تجريبي مجاني</option>
        `;
      } else {
        el.subjectSelect.innerHTML = `
          <option value="MATH">الرياضيات</option>
          <option value="PHYSICS">الفيزياء</option>
        `;
      }
      activeSubject = el.subjectSelect.value;
    }
  }

  function isStandaloneBroadcaster() {
    return classActive && !isCompanionMode;
  }

  el.levelSelect.addEventListener("change", async (e) => {
    if (isStandaloneBroadcaster()) return;
    activeLevel = e.target.value;
    try { localStorage.setItem("tm_last_level", activeLevel); } catch (_) {}
    updateLevelSelection(activeLevel);
    attendeesMap.clear();
    renderAttendees();
    await checkActiveRoomForCompanion(activeLevel, activeSubject);
  });

  el.subjectSelect.addEventListener("change", async (e) => {
    if (isStandaloneBroadcaster()) return;
    activeSubject = e.target.value;
    try { localStorage.setItem("tm_last_subject", activeSubject); } catch (_) {}
    attendeesMap.clear();
    renderAttendees();
    await checkActiveRoomForCompanion(activeLevel, activeSubject);
  });

  // ---------------------------------------------------------------------------
  // 8. Audio Graph (Web Audio API Mix-Minus)
  // ---------------------------------------------------------------------------
  function getAudioContextClass() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  function initClassroomAudio() {
    if (classroomAudioContext && classroomAudioContext.state !== "closed") {
      return true;
    }
    const CtxClass = getAudioContextClass();
    if (!CtxClass) return false;
    classroomAudioContext = new CtxClass();
    return true;
  }

  function rebuildAudioGraph() {
    if (!classroomAudioContext) return;

    classroomAudioSources.forEach(({ node }) => {
      try { node.disconnect(); } catch (_) {}
    });

    classroomAudioDestinations.forEach((destination, destinationSocketId) => {
      const teacherSource = classroomAudioSources.get("__teacher_microphone__");
      if (teacherSource?.enabled) {
        try { teacherSource.node.connect(destination); } catch (_) {}
      }

      // Mix all OTHER students' audio to this student's destination (mix-minus)
      classroomAudioSources.forEach((src, srcKey) => {
        if (srcKey !== "__teacher_microphone__" && srcKey !== destinationSocketId && src.enabled) {
          try { src.node.connect(destination); } catch (_) {}
        }
      });
    });
  }

  function addAudioSource(sourceKey, stream, { enabled = true } = {}) {
    if (!classroomAudioContext || !stream?.getAudioTracks()?.length) return;
    try {
      const node = classroomAudioContext.createMediaStreamSource(stream);
      classroomAudioSources.set(sourceKey, { node, stream, enabled });
      rebuildAudioGraph();
    } catch (err) {
      console.warn("Unable to attach audio source:", sourceKey, err);
    }
  }

  function ensureStudentAudioDestination(studentSocketId) {
    if (!classroomAudioContext || !studentSocketId) return null;
    const existing = classroomAudioDestinations.get(studentSocketId);
    if (existing?.stream?.getAudioTracks?.()?.some((t) => t.readyState === "live")) {
      return existing;
    }
    try {
      const destination = classroomAudioContext.createMediaStreamDestination();
      const track = destination.stream.getAudioTracks()[0];
      if (!track) return null;
      track.contentHint = "speech";
      classroomAudioDestinations.set(studentSocketId, destination);
      rebuildAudioGraph();
      return destination;
    } catch (err) {
      console.warn("Unable to create student audio destination:", err);
      return null;
    }
  }

  function attachStudentAudioElement(peerConnection, studentSocketId) {
    peerConnection.ontrack = (event) => {
      if (event.track?.kind !== "audio") return;

      let audio = studentAudioElements.get(studentSocketId);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.style.display = "none";
        document.body.append(audio);
        studentAudioElements.set(studentSocketId, audio);
      }

      const stream = event.streams?.[0] || new MediaStream([event.track]);
      audio.srcObject = stream;
      addAudioSource(studentSocketId, stream, {
        enabled: approvedStudentMicrophones.has(studentSocketId),
      });

      audio.play().catch(() => {});

      event.track.addEventListener("ended", () => {
        approvedStudentMicrophones.delete(studentSocketId);
        audio.remove();
        studentAudioElements.delete(studentSocketId);
        classroomAudioSources.delete(studentSocketId);
        rebuildAudioGraph();
      }, { once: true });
    };
  }

  // ---------------------------------------------------------------------------
  // 9. WebRTC Peer Connection Management
  // ---------------------------------------------------------------------------
  function createPeerConnection(studentSocketId) {
    closePeerConnection(studentSocketId);

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[studentSocketId] = pc;
    pendingIceCandidates[studentSocketId] = [];

    // 1. Add Teacher Audio Track (via mix-minus destination)
    const destination = ensureStudentAudioDestination(studentSocketId);
    const audioTrack = destination?.stream?.getAudioTracks()[0];
    if (audioTrack) {
      const sender = pc.addTrack(audioTrack, destination.stream);
      sender.__classroomMixMinusAudio = true;
    }

    // 2. Add Camera Video Track if camera is active
    if (isCameraActive && cameraStream) {
      const videoTrack = cameraStream.getVideoTracks().find((t) => t.readyState === "live");
      if (videoTrack) {
        const vSender = pc.addTrack(videoTrack, cameraStream);
        vSender.__classroomVideoTrack = true;
      }
    }

    // 3. Receive Student Audio
    attachStudentAudioElement(pc, studentSocketId);

    // 4. ICE Candidates
    pc.onicecandidate = (event) => {
      if (!event.candidate || !classActive || !socket.connected) return;
      socket.emit("webrtc_ice_candidate", {
        targetSocketId: studentSocketId,
        candidate: event.candidate.toJSON(),
      });
    };

    return pc;
  }

  async function createAndSendOffer(studentSocketId, { iceRestart = false } = {}) {
    if (!classActive) return;

    let pc = peerConnections[studentSocketId];
    if (!pc) {
      pc = createPeerConnection(studentSocketId);
    }

    // Update video track if camera state changed
    if (isCameraActive && cameraStream) {
      const videoTrack = cameraStream.getVideoTracks().find((t) => t.readyState === "live");
      const videoSender = pc.getSenders().find((s) => s.__classroomVideoTrack);
      if (videoSender && videoTrack && videoSender.track !== videoTrack) {
        try { await videoSender.replaceTrack(videoTrack); } catch (_) {}
      } else if (!videoSender && videoTrack) {
        const nextSender = pc.addTrack(videoTrack, cameraStream);
        nextSender.__classroomVideoTrack = true;
      }
    }

    if (pc.makingOffer || pc.signalingState !== "stable" || pc.connectionState === "closed") {
      return;
    }

    pc.makingOffer = true;
    try {
      const offer = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(offer);
      const videoSender = pc.getSenders().find((s) => s.__classroomVideoTrack);
      if (videoSender && typeof videoSender.setParameters === "function") {
        try {
          const params = videoSender.getParameters();
          params.encodings = params.encodings?.length ? params.encodings : [{}];
          params.encodings[0].maxBitrate = 450_000;
          params.encodings[0].maxFramerate = 15;
          params.degradationPreference = "maintain-resolution";
          await videoSender.setParameters(params);
        } catch (_) {}
      }

      await emitWithAcknowledgement("webrtc_offer", {
        targetSocketId: studentSocketId,
        sdp: pc.localDescription,
      }, 15000);
    } catch (err) {
      console.warn(`[WebRTC] Offer failed for student ${studentSocketId}:`, err);
    } finally {
      if (peerConnections[studentSocketId]) {
        peerConnections[studentSocketId].makingOffer = false;
      }
    }
  }

  function closePeerConnection(studentSocketId) {
    const pc = peerConnections[studentSocketId];
    if (pc) {
      try { pc.close(); } catch (_) {}
      delete peerConnections[studentSocketId];
    }
    delete pendingIceCandidates[studentSocketId];

    const audio = studentAudioElements.get(studentSocketId);
    if (audio) {
      try { audio.srcObject = null; audio.remove(); } catch (_) {}
      studentAudioElements.delete(studentSocketId);
    }

    const dest = classroomAudioDestinations.get(studentSocketId);
    if (dest) {
      dest.stream.getTracks().forEach((t) => t.stop());
      classroomAudioDestinations.delete(studentSocketId);
    }
    classroomAudioSources.delete(studentSocketId);
    rebuildAudioGraph();
  }

  function closeAllConnections() {
    Object.keys(peerConnections).forEach(closePeerConnection);
  }

  // ---------------------------------------------------------------------------
  // 10. Camera & Microphone Controls
  // ---------------------------------------------------------------------------
  async function setupMicrophone() {
    if (micStream) return true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      initClassroomAudio();
      addAudioSource("__teacher_microphone__", micStream, { enabled: isMicActive });
      return true;
    } catch (err) {
      console.warn("Unable to access teacher microphone:", err);
      showToast("تعذر الوصول إلى المايكروفون. تحقق من الصلاحيات.");
      return false;
    }
  }

  function toggleTeacherMicrophone() {
    if (!micStream) return;
    isMicActive = !isMicActive;
    micStream.getAudioTracks().forEach((t) => { t.enabled = isMicActive; });

    const src = classroomAudioSources.get("__teacher_microphone__");
    if (src) src.enabled = isMicActive;
    rebuildAudioGraph();

    if (el.micBtn) {
      el.micBtn.classList.toggle("is-mic-active", isMicActive);
    }
    if (el.micLabel) {
      el.micLabel.textContent = isMicActive ? "المايك يعمل" : "المايك مكتوم";
    }
    showToast(isMicActive ? "تم تشغيل المايكروفون 🎙️" : "تم كتم المايكروفون 🔇");
  }

  async function toggleCamera() {
    if (!classActive) return;

    if (isCameraActive) {
      // Turn Camera OFF
      isCameraActive = false;
      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
        cameraStream = null;
      }
      if (el.cameraVideo) {
        el.cameraVideo.srcObject = null;
        el.cameraVideo.classList.remove("is-active");
      }
      if (el.stageImage) {
        el.stageImage.style.display = "block";
      }
      if (el.cameraFlipBtn) {
        el.cameraFlipBtn.classList.remove("is-visible");
      }
      if (el.cameraBtn) {
        el.cameraBtn.classList.remove("is-camera-active");
      }
      if (el.cameraLabel) {
        el.cameraLabel.textContent = "الكاميرا";
      }
      if (el.stageModeTag) {
        el.stageModeTag.innerHTML = `<span>🎙️ صوت وصورة المستوى</span>`;
      }

      // Remove video track from active peers
      for (const [studentSocketId, pc] of Object.entries(peerConnections)) {
        const videoSender = pc.getSenders().find((s) => s.__classroomVideoTrack);
        if (videoSender) {
          try { await videoSender.replaceTrack(null); } catch (_) {}
        }
      }

      // Inform students
      try {
        await emitWithAcknowledgement("teacher_screen_share_state", {
          level: activeLevel,
          active: false,
        });
      } catch (_) {}

      showToast("تم إيقاف الكاميرا");
    } else {
      // Turn Camera ON
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: cameraFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 15, max: 20 },
          },
        });

        if (el.cameraVideo) {
          el.cameraVideo.srcObject = cameraStream;
          el.cameraVideo.classList.add("is-active");
          void el.cameraVideo.play().catch(() => {});
        }
        if (el.stageImage) {
          el.stageImage.style.display = "none";
        }
        if (el.cameraFlipBtn) {
          el.cameraFlipBtn.classList.add("is-visible");
        }
        if (el.cameraBtn) {
          el.cameraBtn.classList.add("is-camera-active");
        }
        if (el.cameraLabel) {
          el.cameraLabel.textContent = "الكاميرا تعمل";
        }
        if (el.stageModeTag) {
          el.stageModeTag.innerHTML = `<span>📹 بث مباشر للكاميرا</span>`;
        }
        isCameraActive = true;

        // Add/replace video track for all active peer connections
        const videoTrack = cameraStream.getVideoTracks()[0];
        for (const [studentSocketId, pc] of Object.entries(peerConnections)) {
          const videoSender = pc.getSenders().find((s) => s.__classroomVideoTrack);
          if (videoSender) {
            try { await videoSender.replaceTrack(videoTrack); } catch (_) {}
          } else {
            const nextSender = pc.addTrack(videoTrack, cameraStream);
            nextSender.__classroomVideoTrack = true;
            void createAndSendOffer(studentSocketId);
          }
        }

        // Inform students that live video stream is active
        try {
          await emitWithAcknowledgement("teacher_screen_share_state", {
            level: activeLevel,
            active: true,
          });
        } catch (_) {}

        showToast("تم تشغيل كاميرا الهاتف 📹");
      } catch (err) {
        console.warn("Unable to access mobile camera:", err);
        showToast("تعذر تشغيل الكاميرا. تحقق من الإذن.");
      }
    }
  }

  async function flipCamera() {
    if (!isCameraActive) return;
    cameraFacingMode = cameraFacingMode === "user" ? "environment" : "user";
    showToast(cameraFacingMode === "user" ? "الكاميرا الأمامية" : "الكاميرا الخلفية");

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 15, max: 20 },
        },
      });

      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
      }
      cameraStream = nextStream;

      if (el.cameraVideo) {
        el.cameraVideo.srcObject = cameraStream;
        void el.cameraVideo.play().catch(() => {});
      }

      const nextTrack = cameraStream.getVideoTracks()[0];
      for (const pc of Object.values(peerConnections)) {
        const videoSender = pc.getSenders().find((s) => s.__classroomVideoTrack);
        if (videoSender) {
          try { await videoSender.replaceTrack(nextTrack); } catch (_) {}
        }
      }
    } catch (err) {
      console.warn("Unable to switch camera:", err);
      showToast("تعذر تبديل الكاميرا.");
    }
  }

  // ---------------------------------------------------------------------------
  // 10.5 Companion Mode (PC Broadcast Synchronizer)
  // ---------------------------------------------------------------------------
  async function checkActiveRoomForCompanion(level, subject) {
    if (isStandaloneBroadcaster()) return;

    try {
      const res = await emitWithAcknowledgement("teacher_check_active_room", { level, subject }, 4000);
      const isRoomActive = Boolean(res?.ok && (res.active || res.hasActiveRoom));
      if (isRoomActive) {
        await enterCompanionMode(res.level, res.subject, res.teacherSocketId, res.presentStudents);
      } else {
        if (isCompanionMode) {
          exitCompanionMode(false);
        }
        await fetchLiveAbsentees();
      }
    } catch (err) {
      console.warn("checkActiveRoomForCompanion error:", err);
      if (isCompanionMode) {
        exitCompanionMode(false);
      }
      await fetchLiveAbsentees();
    }
  }

  async function enterCompanionMode(level, subject, teacherSocketId, initialStudents = []) {
    isCompanionMode = true;
    classActive = true;
    activeLevel = level;
    if (subject) activeSubject = subject;
    companionPrimaryTeacherSocketId = teacherSocketId;

    if (el.levelSelect && el.levelSelect.value !== level) {
      el.levelSelect.value = level;
      updateLevelSelection(level);
    }
    if (el.subjectSelect && subject && el.subjectSelect.value !== subject) {
      el.subjectSelect.value = subject;
    }

    // Keep dropdowns enabled so teacher can switch levels anytime!
    if (el.levelSelect) el.levelSelect.disabled = false;
    if (el.subjectSelect) el.subjectSelect.disabled = false;

    // Populate initial students if provided
    if (Array.isArray(initialStudents) && initialStudents.length > 0) {
      initialStudents.forEach((st) => {
        if (st && st.socketId) {
          upsertAttendee(st.socketId, st.studentId, st.studentName, st.participationCount || 0);
        }
      });
    }

    try {
      const joinRes = await emitWithAcknowledgement("teacher_companion_join", { level }, 5000);
      if (joinRes?.currentStudents && Array.isArray(joinRes.currentStudents)) {
        joinRes.currentStudents.forEach((st) => {
          if (st && st.socketId) {
            upsertAttendee(st.socketId, st.studentId, st.studentName, st.participationCount || 0);
          }
        });
      }
    } catch (err) {
      console.warn("teacher_companion_join acknowledge:", err);
    }

    setLiveState(true);
    setStatus(`🟢 وضع المساعد: متزامن مع بث الحاسوب (${level} - ${activeSubject === "MATH" ? "الرياضيات" : "الفيزياء"})`, "live");
    showToast(`متصل كمساعد لبث ${level} مع الحاسوب 📱💻`);

    if (el.stageModeTag) {
      el.stageModeTag.innerHTML = `<span>📡 شاشة مراقبة الحاسوب مباشرة</span>`;
    }

    if (el.startBtn) {
      el.startBtn.classList.add("is-companion");
      if (el.startBtnText) el.startBtnText.textContent = "🟢 متزامن مع الحاسوب (مراقب للبث)";
      if (el.startBtnIcon) el.startBtnIcon.textContent = "💻";
      el.startBtn.disabled = true;
    }

    if (el.micBtn) {
      el.micBtn.disabled = true;
      if (el.micLabel) el.micLabel.textContent = "المايك (من الحاسوب)";
    }
    if (el.cameraBtn) {
      el.cameraBtn.disabled = true;
      if (el.cameraLabel) el.cameraLabel.textContent = "الكاميرا (من الحاسوب)";
    }
    if (el.endBtn) {
      el.endBtn.disabled = false;
    }

    if (el.chatInput) el.chatInput.disabled = false;
    if (el.chatSendBtn) el.chatSendBtn.disabled = !el.chatInput?.value.trim();

    renderAttendees();
    await fetchLiveAbsentees();
  }

  function exitCompanionMode(resetDropdowns = false) {
    if (companionPeerConnection) {
      try { companionPeerConnection.close(); } catch (_) {}
      companionPeerConnection = null;
    }
    companionPrimaryTeacherSocketId = null;
    if (el.companionVideo) {
      el.companionVideo.srcObject = null;
      el.companionVideo.classList.remove("is-active");
    }

    isCompanionMode = false;
    classActive = false;
    setLiveState(false);
    setStatus("تم الخروج من وضع المساعد. يمكنك بدء بث جديد من الهاتف.", "neutral");
    if (el.stageModeTag) {
      el.stageModeTag.innerHTML = `<span>🎙️ صوت وصورة المستوى</span>`;
    }

    if (el.startBtn) {
      el.startBtn.classList.remove("is-companion");
      if (el.startBtnText) el.startBtnText.textContent = "بدء الحصة المباشرة";
      if (el.startBtnIcon) el.startBtnIcon.textContent = "▶";
      el.startBtn.disabled = false;
    }

    attendeesMap.clear();
    renderAttendees();
    updateControls();
    fetchLiveAbsentees();
  }

  // ---------------------------------------------------------------------------
  // 11. Class Lifecycle (Start / Resume / End)
  // ---------------------------------------------------------------------------
  async function startLiveClass() {
    if (classActive || isStarting || isEnding) return;

    if (!teacherToken) {
      showToast("جلسة الأستاذ غير مسجلة. سجّل الدخول أولاً.");
      setStatus("يرجى تسجيل الدخول كأستاذ أولاً.", "error");
      return;
    }

    isStarting = true;
    setStatus("جارٍ فحص البث والاتصال بالخادم…", "neutral");
    updateControls();

    try {
      // 1. Connect socket if needed
      if (!socket.connected) {
        socket.connect();
        await new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error("تعذر الاتصال بالخادم.")), 10000);
          socket.once("connect", () => {
            window.clearTimeout(timer);
            resolve();
          });
          socket.once("connect_error", (err) => {
            window.clearTimeout(timer);
            reject(err);
          });
        });
      }

      // 2. Check if PC already has an active broadcast for this level
      try {
        const activeCheck = await emitWithAcknowledgement("teacher_check_active_room", { level: activeLevel }, 3000);
        const isRoomActive = Boolean(activeCheck?.ok && (activeCheck.active || activeCheck.hasActiveRoom));
        if (isRoomActive) {
          showToast("تم اكتشاف بث مباشر جارٍ من الحاسوب! جارٍ المزامنة كمساعد…");
          await enterCompanionMode(activeCheck.level, activeCheck.subject, activeCheck.teacherSocketId, activeCheck.presentStudents);
          return;
        }
      } catch (_) {}

      // 3. Acquire mic for mobile standalone broadcast
      await setupMicrophone();

      // 4. Emit teacher_start_room
      classResumeToken = generateResumeToken();
      const response = await emitWithAcknowledgement("teacher_start_room", {
        level: activeLevel,
        subject: activeSubject,
        resumeToken: classResumeToken,
        isRecovery: false,
        forceResume: false,
      });

      classActive = true;
      sessionStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify({
        level: activeLevel,
        subject: activeSubject,
        resumeToken: classResumeToken,
      }));

      // 5. Update UI to Live
      setLiveState(true);
      setStatus(`الحصة مباشرة الآن — ${activeLevel} | ${activeSubject}`, "live");
      showToast(`بدأت الحصة المباشرة لـ ${activeLevel} 🎉`);
      fetchLiveAbsentees();
    } catch (err) {
      console.error("Unable to start live class:", err);
      if (err.message && err.message.includes("توجد حصة مباشرة نشطة لهذا المستوى بالفعل")) {
        showToast("تم اكتشاف بث مباشر جارٍ من الحاسوب! جارٍ المزامنة كمساعد…");
        await checkActiveRoomForCompanion(activeLevel, activeSubject);
        return;
      }
      classActive = false;
      setStatus(err.message || "تعذر بدء الحصة. حاول مرة أخرى.", "error");
      showToast("تعذر بدء الحصة: " + (err.message || "خطأ غير متوقع"));
    } finally {
      isStarting = false;
      updateControls();
    }
  }

  async function endLiveClass() {
    if (!classActive || isEnding) return;

    if (isCompanionMode) {
      exitCompanionMode();
      return;
    }

    isEnding = true;
    setStatus("جارٍ إنهاء الحصة…", "neutral");

    try {
      await emitWithAcknowledgement("teacher_end_class", { level: activeLevel }, 5000);
    } catch (err) {
      console.warn("End class acknowledge warning:", err);
    }

    // Cleanup Local Media
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (classroomAudioContext && classroomAudioContext.state !== "closed") {
      try { classroomAudioContext.close(); } catch (_) {}
      classroomAudioContext = null;
    }

    closeAllConnections();
    attendeesMap.clear();
    sessionStorage.removeItem(RECOVERY_STORAGE_KEY);

    classActive = false;
    isEnding = false;
    isCameraActive = false;

    setLiveState(false);
    setStatus("تم إنهاء الحصة لجميع التلاميذ.", "neutral");
    showToast("تم إنهاء الحصة بنجاح.");
    renderAttendees();
    updateControls();
  }

  function setLiveState(isLive) {
    if (el.liveBadge) el.liveBadge.classList.toggle("is-live", isLive);
    if (el.liveText) el.liveText.textContent = isLive ? "مباشر" : "غير مباشر";

    if (isLive) {
      studioStartTime = Date.now();
      window.clearInterval(studioTimerInterval);
      studioTimerInterval = window.setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - studioStartTime) / 1000);
        if (el.stageTimer) el.stageTimer.textContent = formatDuration(elapsedSec);
      }, 1000);
    } else {
      window.clearInterval(studioTimerInterval);
      if (el.stageTimer) el.stageTimer.textContent = "00:00:00";
    }
  }

  function updateControls() {
    if (el.levelSelect) el.levelSelect.disabled = classActive || isStarting;
    if (el.subjectSelect) el.subjectSelect.disabled = classActive || isStarting;

    if (el.startBtn) {
      el.startBtn.disabled = classActive || isStarting;
      el.startBtn.classList.toggle("is-live", classActive);
      if (el.startBtnText) {
        el.startBtnText.textContent = isStarting
          ? "جارٍ بدء الحصة…"
          : classActive
          ? "الحصة مباشرة الآن"
          : "بدء الحصة المباشرة";
      }
      if (el.startBtnIcon) {
        el.startBtnIcon.textContent = classActive ? "🔴" : "▶";
      }
    }

    if (el.micBtn) {
      el.micBtn.disabled = !classActive;
      el.micBtn.classList.toggle("is-mic-active", classActive && isMicActive);
      if (el.micLabel) {
        el.micLabel.textContent = isMicActive ? "المايك يعمل" : "المايك مكتوم";
      }
    }

    if (el.cameraBtn) {
      el.cameraBtn.disabled = !classActive;
      el.cameraBtn.classList.toggle("is-camera-active", classActive && isCameraActive);
    }

    if (el.endBtn) {
      el.endBtn.disabled = !classActive;
    }
  }

  // ---------------------------------------------------------------------------
  // 12. Attendees & Hands Raised & Absentees
  // ---------------------------------------------------------------------------
  function upsertAttendee(socketId, studentId, studentName = "تلميذ", participationCount = 0) {
    const existing = attendeesMap.get(socketId) || {};
    attendeesMap.set(socketId, {
      ...existing,
      socketId,
      studentId: studentId || existing.studentId || "",
      studentName: studentName || existing.studentName || "تلميذ",
      participationCount: Math.max(0, Number(participationCount) || 0),
      handRaised: existing.handRaised || false,
      micEnabled: existing.micEnabled || false,
    });
    renderAttendees();
    scheduleAbsenteesRefresh();
  }

  function removeAttendee(socketId) {
    attendeesMap.delete(socketId);
    renderAttendees();
    scheduleAbsenteesRefresh();
  }

  function toggleStudentMic(socketId) {
    const student = attendeesMap.get(socketId);
    if (!student || !classActive) return;

    const nextState = !student.micEnabled;
    emitWithAcknowledgement("teacher_set_mic", {
      targetSocketId: socketId,
      enabled: nextState,
    }).then(() => {
      student.micEnabled = nextState;
      if (nextState) {
        approvedStudentMicrophones.add(socketId);
        student.handRaised = false; // lower hand automatically once mic opens
      } else {
        approvedStudentMicrophones.delete(socketId);
      }
      renderAttendees();
      showToast(nextState ? `تم فتح مايك ${student.studentName}` : `تم إغلاق مايك ${student.studentName}`);
    }).catch((err) => {
      showToast("تعذر ضبط مايك التلميذ: " + err.message);
    });
  }

  function renderAttendees() {
    const searchTerm = (el.attendeeSearch?.value || "").trim().toLowerCase();
    const students = Array.from(attendeesMap.values());

    const totalStudents = students.length;
    const handsRaisedList = students.filter((s) => s.handRaised);

    // Update Counts & Badges
    if (el.studentCountStat) el.studentCountStat.textContent = totalStudents;
    if (el.subnavPresentBadge) el.subnavPresentBadge.textContent = totalStudents;
    if (el.handsCountStat) el.handsCountStat.textContent = handsRaisedList.length;

    if (el.handsNavBadge) {
      el.handsNavBadge.textContent = handsRaisedList.length;
      el.handsNavBadge.hidden = handsRaisedList.length === 0;
    }
    if (el.handsBadgeNum) {
      el.handsBadgeNum.textContent = handsRaisedList.length;
    }

    // Render Hands Raised Section
    if (el.handsSection) {
      el.handsSection.hidden = handsRaisedList.length === 0;
    }
    if (el.handsList) {
      el.handsList.innerHTML = "";
      handsRaisedList.forEach((s) => {
        const card = createAttendeeElement(s, true);
        el.handsList.append(card);
      });
    }

    // Render Main Attendees List
    if (el.attendeesContainer) {
      const filtered = students.filter((s) => {
        return !searchTerm || s.studentName.toLowerCase().includes(searchTerm);
      });

      if (el.attendeesEmpty) {
        el.attendeesEmpty.style.display = filtered.length === 0 ? "block" : "none";
      }

      // Preserve empty element
      const cards = filtered.map((s) => createAttendeeElement(s, false));
      el.attendeesContainer.innerHTML = "";
      if (filtered.length === 0 && el.attendeesEmpty) {
        el.attendeesContainer.append(el.attendeesEmpty);
      } else {
        cards.forEach((c) => el.attendeesContainer.append(c));
      }
    }
  }

  function createAttendeeElement(student, isHandSection) {
    const card = document.createElement("div");
    card.className = "tm-attendee-card";
    if (student.handRaised) card.classList.add("is-hand-raised");
    if (student.micEnabled) card.classList.add("is-mic-open");

    const left = document.createElement("div");
    left.className = "tm-attendee-left";

    const avatar = document.createElement("div");
    avatar.className = "tm-attendee-avatar";
    avatar.textContent = (student.studentName || "ت").slice(0, 1);

    const meta = document.createElement("div");
    meta.className = "tm-attendee-meta";

    const nameRow = document.createElement("div");
    nameRow.className = "tm-attendee-name-row";

    const name = document.createElement("span");
    name.className = "tm-attendee-name";
    name.textContent = student.studentName;

    nameRow.append(name);
    if (student.handRaised) {
      const handTag = document.createElement("span");
      handTag.className = "tm-attendee-hand-tag";
      handTag.textContent = "✋";
      nameRow.append(handTag);
    }

    const sub = document.createElement("span");
    sub.className = "tm-attendee-sub";
    sub.textContent = student.micEnabled
      ? "🎙️ المايك مفتوح"
      : student.handRaised
      ? "يريد التحدث"
      : `المشاركات: ${student.participationCount}`;

    meta.append(nameRow, sub);
    left.append(avatar, meta);

    const micBtn = document.createElement("button");
    micBtn.className = "tm-attendee-mic-btn";
    if (student.micEnabled) micBtn.classList.add("is-open");
    micBtn.textContent = student.micEnabled ? "إغلاق المايك" : "فتح المايك";
    micBtn.addEventListener("click", () => toggleStudentMic(student.socketId));

    card.append(left, micBtn);
    return card;
  }

  // ---------------------------------------------------------------------------
  // 12.5 Absence Register & Multi-channel Parent Messaging (WhatsApp / Viber / Telegram / Phone)
  // ---------------------------------------------------------------------------
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
    const subjectName = subject === "MATH" ? "الرياضيات" : subject === "PHYSICS" ? "الفيزياء" : "الحصة المباشرة";
    const text = encodeURIComponent(
      `السلام عليكم ورحمة الله وبركاته،\nولي أمر التلميذ(ة) ${studentName || ""} المحترم، نود إعلامكم بأن الحصة المباشرة لمادة ${subjectName} (${level}) مع الأستاذ د. شارف عز الدين بدأت الآن، والتلميذ مسجل غائب بالمنصة. يرجى دخوله فوراً لمتابعة الحصة.`
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

  function createAbsenteeElement(student) {
    const card = document.createElement("div");
    card.className = "tm-absentee-card";

    const left = document.createElement("div");
    left.className = "tm-absentee-left";

    const nameRow = document.createElement("div");
    nameRow.className = "tm-absentee-name-row";

    const name = document.createElement("span");
    name.className = "tm-absentee-name";
    name.textContent = student.studentName || "تلميذ";

    const tag = document.createElement("span");
    tag.className = "tm-absentee-tag";
    tag.textContent = "غائب";

    nameRow.append(name, tag);

    const phone = document.createElement("span");
    phone.className = "tm-absentee-phone";
    phone.textContent = student.parentPhone ? `هاتف الولي: ${student.parentPhone}` : "لا يوجد هاتف مسجل";

    left.append(nameRow, phone);

    const actions = document.createElement("div");
    actions.className = "tm-absentee-actions";

    if (student.parentPhone) {
      // 1. WhatsApp button
      const waUrl = buildWhatsAppUrl(student.parentPhone, student.studentName, activeLevel, activeSubject);
      const waBtn = document.createElement("a");
      waBtn.className = "tm-btn-whatsapp";
      waBtn.href = waUrl;
      waBtn.target = "_blank";
      waBtn.rel = "noopener noreferrer";
      waBtn.title = "مراسلة ولي التلميذ عبر واتساب";
      waBtn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m.01 1.67c4.56 0 8.27 3.71 8.27 8.27 0 2.21-.86 4.29-2.42 5.85a8.21 8.21 0 0 1-5.85 2.42c-1.42 0-2.82-.37-4.06-1.07l-.29-.17-3.11.82.83-3.03-.19-.3a8.23 8.23 0 0 1-1.26-4.38c0-4.56 3.71-8.27 8.27-8.27m4.54 11.69c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.25-.75-.67-1.25-1.5-1.4-1.75-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.44.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08s.89 2.41 1.01 2.58c.13.17 1.75 2.67 4.24 3.75.59.26 1.05.41 1.41.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.2-.59.2-1.09.14-1.19-.05-.1-.22-.16-.47-.28z"/>
        </svg>
        <span>واتساب</span>
      `;

      // 2. Viber button
      const viberUrl = buildViberUrl(student.parentPhone);
      const viberBtn = document.createElement("a");
      viberBtn.className = "tm-btn-viber";
      viberBtn.href = viberUrl;
      viberBtn.title = "مراسلة أو الاتصال بولي التلميذ عبر فايبر";
      viberBtn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M19.78 14.56c-.57-.45-1.54-.95-2.23-.74-.47.14-.8.53-1.17.84-.36.3-.77.49-1.2.29-.94-.43-1.85-1.04-2.67-1.8-.82-.77-1.46-1.63-1.94-2.53-.22-.41-.05-.82.23-1.18.28-.35.65-.67.77-1.12.18-.68-.28-1.62-.7-2.17-.4-.53-1.05-.72-1.67-.53-.61.19-1.05.74-1.29 1.32-.42 1.02-.45 2.19-.07 3.25.68 1.9 1.83 3.6 3.29 5.02 1.55 1.52 3.4 2.71 5.41 3.39.99.34 2.08.31 3.03-.1.54-.23 1.05-.67 1.23-1.26.19-.62-.02-1.24-.52-1.62-.16-.1-.32-.2-.47-.26zM13.6 4.3c.78.11 1.5.38 2.15.78.65.41 1.2.94 1.62 1.58.42.64.71 1.34.84 2.09.07.39.38.67.77.67.44 0 .8-.38.74-.82-.16-.94-.52-1.83-1.05-2.63-.53-.8-1.22-1.46-2.03-1.97-.81-.5-1.72-.83-2.69-.97-.44-.06-.83.25-.89.69-.06.44.25.83.69.89zm.41 3.12c.57.19 1.08.53 1.48.97.4.44.68.97.82 1.56.09.41.48.68.89.6.41-.09.68-.48.6-.89-.19-.77-.57-1.47-1.1-2.05-.53-.58-1.2-.99-1.95-1.24-.41-.14-.85.08-.99.49-.14.41.08.85.49.99z"/>
        </svg>
        <span>فايبر</span>
      `;

      // 3. Telegram button
      const tgUrl = buildTelegramUrl(student.parentPhone);
      const tgBtn = document.createElement("a");
      tgBtn.className = "tm-btn-telegram";
      tgBtn.href = tgUrl;
      tgBtn.target = "_blank";
      tgBtn.rel = "noopener noreferrer";
      tgBtn.title = "مراسلة ولي التلميذ عبر تيليجرام";
      tgBtn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
        </svg>
        <span>تيليجرام</span>
      `;

      // 4. Phone Call button
      const phoneBtn = document.createElement("a");
      phoneBtn.className = "tm-btn-phone";
      phoneBtn.href = `tel:${student.parentPhone}`;
      phoneBtn.title = "اتصال هاتفي مباشر";
      phoneBtn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
        </svg>
        <span>اتصال</span>
      `;

      actions.append(waBtn, viberBtn, tgBtn, phoneBtn);
    }

    card.append(left, actions);
    return card;
  }

  function renderAbsenteesList(absentees = []) {
    if (!el.absenteesContainer) return;
    const query = (el.attendeeSearch?.value || "").trim().toLowerCase();
    const filtered = absentees.filter((s) => {
      if (!query) return true;
      return (s.studentName || "").toLowerCase().includes(query) || (s.parentPhone || "").includes(query);
    });

    el.absenteesContainer.innerHTML = "";
    if (filtered.length === 0) {
      if (el.absenteesEmpty) {
        el.absenteesEmpty.style.display = "block";
        el.absenteesEmpty.textContent = query
          ? `لا توجد نتائج مطابقة للبحث "${query}".`
          : "لا يوجد تلاميذ غائبون حالياً (جميع المشتركين حاضرون أو لا توجد اشتراكات مفعلة).";
        el.absenteesContainer.append(el.absenteesEmpty);
      }
    } else {
      filtered.forEach((s) => {
        el.absenteesContainer.append(createAbsenteeElement(s));
      });
    }
  }

  async function fetchLiveAbsentees() {
    const level = activeLevel || el.levelSelect?.value || "";
    const subject = activeSubject || el.subjectSelect?.value || "";
    if (!level) return null;

    const presentIds = Array.from(attendeesMap.values())
      .map((s) => s.studentId)
      .filter(Boolean)
      .join(",");

    const params = new URLSearchParams({
      level,
      subject,
      presentIds,
    });

    try {
      const res = await fetch(`/api/academic/live-absentees?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      currentAbsenteesData = data;

      // Sync any present students from server into attendeesMap
      if (Array.isArray(data.present) && data.present.length > 0) {
        data.present.forEach((pStudent) => {
          const alreadyInMap = Array.from(attendeesMap.values()).some((att) => att.studentId === pStudent.id);
          if (!alreadyInMap) {
            attendeesMap.set(`student_${pStudent.id}`, {
              socketId: `student_${pStudent.id}`,
              studentId: pStudent.id,
              studentName: pStudent.studentName,
              participationCount: 0,
              handRaised: false,
              micEnabled: false,
            });
          }
        });
      }

      const count = data.absentCount || 0;
      const presentCount = data.presentCount || attendeesMap.size;

      if (el.absentCountStat) el.absentCountStat.textContent = count;
      if (el.subnavAbsentBadge) el.subnavAbsentBadge.textContent = count;
      if (el.studentCountStat) el.studentCountStat.textContent = presentCount;
      if (el.subnavPresentBadge) el.subnavPresentBadge.textContent = presentCount;

      renderAttendees();

      if (el.absentView && !el.absentView.hidden) {
        renderAbsenteesList(data.absentees || []);
      }
      return data;
    } catch (err) {
      console.warn("fetchLiveAbsentees error:", err);
      return null;
    }
  }

  function scheduleAbsenteesRefresh() {
    clearTimeout(absenteesRefreshTimer);
    absenteesRefreshTimer = setTimeout(() => {
      fetchLiveAbsentees();
    }, 300);
  }

  function handleAttendeeSearch() {
    if (el.absentView && !el.absentView.hidden) {
      renderAbsenteesList(currentAbsenteesData?.absentees || []);
    } else {
      renderAttendees();
    }
  }

  if (el.attendeeSearch) {
    el.attendeeSearch.addEventListener("input", handleAttendeeSearch);
  }

  // ---------------------------------------------------------------------------
  // 13. Chat Management & Question Images
  // ---------------------------------------------------------------------------
  async function loadQuestionImage(imageId) {
    if (!teacherToken || !imageId) throw new Error("صلاحية عرض الصورة غير متوفرة.");
    const response = await fetch(`/api/live-chat/question-image/${encodeURIComponent(imageId)}`, {
      headers: { Authorization: `Bearer ${teacherToken}`, Accept: "image/*" },
    });
    if (!response.ok) throw new Error("تعذر تحميل صورة السؤال.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    questionImageUrls.add(url);
    return url;
  }

  function appendChatMessage({ id = null, sender, message, kind = "student", imageUrl = null, reactions = null }) {
    if (el.chatEmpty) el.chatEmpty.style.display = "none";

    const msgId = id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const bubble = document.createElement("div");
    bubble.className = `tm-chat-bubble is-${kind}`;
    bubble.dataset.messageId = msgId;

    const head = document.createElement("div");
    head.className = "tm-chat-bubble-head";

    const meta = document.createElement("div");
    meta.className = "tm-chat-bubble-meta";

    const name = document.createElement("span");
    name.className = "tm-chat-bubble-name";
    name.textContent = sender;

    const time = document.createElement("span");
    time.textContent = new Date().toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" });

    meta.append(name, time);

    // Quick Reaction Bar for Teacher
    const reactBar = document.createElement("div");
    reactBar.className = "tm-chat-react-bar";

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
      btn.className = "tm-chat-react-btn";
      btn.title = r.title;
      btn.textContent = r.emoji;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        sendChatReaction(msgId, r.key);
      });
      reactBar.append(btn);
    });

    head.append(meta, reactBar);

    const body = document.createElement("div");
    body.className = "tm-chat-bubble-body";
    body.textContent = message;

    bubble.append(head, body);

    if (imageUrl) {
      const imgWrap = document.createElement("div");
      imgWrap.className = "tm-chat-image-wrap";
      imgWrap.title = "اضغط لتكبير الصورة";

      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "صورة سؤال التلميذ";

      const overlay = document.createElement("div");
      overlay.className = "tm-chat-image-overlay";
      overlay.innerHTML = `<span>🔍 تكبير</span>`;

      imgWrap.append(img, overlay);
      imgWrap.addEventListener("click", () => openImageViewer(imageUrl));
      bubble.append(imgWrap);
    }

    // Reaction pills container
    const pillsWrap = document.createElement("div");
    pillsWrap.className = "tm-chat-reactions-pills";
    pillsWrap.dataset.pillsFor = msgId;
    renderReactionPills(pillsWrap, reactions, msgId);
    bubble.append(pillsWrap);

    if (el.chatBox) {
      el.chatBox.append(bubble);
      el.chatBox.scrollTop = el.chatBox.scrollHeight;
    }

    // Increment badge if user is not in chat tab
    if (activeTab !== "chat" && kind === "student") {
      unreadChatCount++;
      updateChatNavBadge();
    }
  }

  function renderReactionPills(container, reactions, messageId) {
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
      const isTeacherReacted = Boolean(
        (typeof reactions.teacherReacted === "object" && reactions.teacherReacted && reactions.teacherReacted[r.key]) ||
        reactions.teacherReacted === r.key ||
        (Array.isArray(reactions.teacherReacted) && reactions.teacherReacted.includes(r.key))
      );
      let count = Number(reactions[r.key] || reactions[`${r.key}Count`] || 0);
      if (isTeacherReacted && count === 0) count = 1;

      if (count > 0) {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = `tm-reaction-pill ${isTeacherReacted ? "is-teacher-reaction" : ""}`;
        pill.title = isTeacherReacted ? `الأستاذ تفاعل بـ ${r.title}` : r.title;
        pill.innerHTML = `<span>${r.emoji}</span> <span>${count}</span>${isTeacherReacted ? ' <small class="tm-teacher-tag">الأستاذ</small>' : ""}`;
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          sendChatReaction(messageId, r.key);
        });
        container.append(pill);
      }
    });
  }

  function sendChatReaction(messageId, reaction) {
    if (!socket || !classActive) return;
    const bubble = document.querySelector(`.tm-chat-bubble[data-message-id="${messageId}"]`);
    const emojiMap = { love: "❤️", like: "👍", cry: "😭", dislike: "👎", fire: "🔥" };
    if (bubble) {
      showFloatingReaction(bubble, emojiMap[reaction] || "❤️");
    }
    socket.emit("classroom_chat_react", {
      messageId,
      reaction,
      level: activeLevel,
    }, (res) => {
      if (res && res.ok) {
        updateMessageReactions(res);
      }
    });
  }

  function showFloatingReaction(targetEl, emoji) {
    if (!targetEl) return;
    const floating = document.createElement("div");
    floating.className = "tm-floating-reaction";
    floating.textContent = emoji;
    const rect = targetEl.getBoundingClientRect();
    floating.style.left = `${rect.left + rect.width / 2}px`;
    floating.style.top = `${rect.top + 10}px`;
    document.body.append(floating);
    setTimeout(() => floating.remove(), 800);
  }

  function updateMessageReactions(data) {
    if (!data || !data.messageId) return;
    const pillsWrap = document.querySelector(`.tm-chat-reactions-pills[data-pills-for="${data.messageId}"]`);
    if (pillsWrap) {
      renderReactionPills(pillsWrap, data.counts || {
        love: data.loveCount,
        like: data.likeCount,
        cry: data.cryCount,
        dislike: data.dislikeCount,
        fire: data.fireCount,
        teacherReacted: data.teacherReacted,
      }, data.messageId);
    }
  }

  function updateChatNavBadge() {
    if (!el.chatNavBadge) return;
    el.chatNavBadge.textContent = unreadChatCount;
    el.chatNavBadge.hidden = unreadChatCount === 0;
  }

  function openImageViewer(url) {
    if (!el.imageModal || !el.imageModalImg) return;
    el.imageModalImg.src = url;
    el.imageModal.hidden = false;
  }

  if (el.imageModalClose) {
    el.imageModalClose.addEventListener("click", () => {
      if (el.imageModal) el.imageModal.hidden = true;
    });
  }

  if (el.chatForm) {
    el.chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = (el.chatInput?.value || "").trim();
      if (!text || !classActive) return;

      el.chatSendBtn.disabled = true;
      try {
        const res = await emitWithAcknowledgement("teacher_send_message", {
          level: activeLevel,
          message: text,
        });

        appendChatMessage({
          id: res?.messageId,
          sender: "أنت (الأستاذ)",
          message: text,
          kind: "teacher",
        });

        el.chatInput.value = "";
      } catch (err) {
        showToast("تعذر إرسال الرسالة: " + err.message);
      } finally {
        el.chatSendBtn.disabled = false;
      }
    });
  }

  if (el.chatInput) {
    el.chatInput.addEventListener("input", () => {
      if (el.chatSendBtn) {
        el.chatSendBtn.disabled = !el.chatInput.value.trim() || !classActive;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 14. Socket Event Handlers
  // ---------------------------------------------------------------------------
  socket.on("connect", () => {
    console.info("[Socket.io] Connected to live studio server.");
    if (!classActive) {
      checkActiveRoomForCompanion(el.levelSelect?.value || activeLevel);
    }
  });

  socket.on("connect_error", (err) => {
    console.warn("[Socket.io] Connection error:", err.message);
    setStatus("انقطع الاتصال بالخادم. جارٍ إعادة المحاولة…", "error");
  });

  socket.on("student_joined", async (data = {}) => {
    const { socketId, studentId, studentName, participationCount } = data;
    if (!classActive || !socketId) return;

    upsertAttendee(socketId, studentId, studentName, participationCount);
    showToast(`انضم ${studentName || "تلميذ"} إلى الحصة 👏`);
    if (!isCompanionMode) {
      await createAndSendOffer(socketId);
    }
  });

  socket.on("student_left", (data = {}) => {
    const socketId = data.socketId;
    if (socketId) {
      removeAttendee(socketId);
      closePeerConnection(socketId);
    }
  });

  socket.on("hand_raised", (data = {}) => {
    const { socketId, studentName } = data;
    if (!socketId) return;
    const student = attendeesMap.get(socketId) || { socketId, studentName: studentName || "تلميذ" };
    student.handRaised = true;
    attendeesMap.set(socketId, student);
    renderAttendees();
    showToast(`✋ ${student.studentName} طلب التحدث!`);
  });

  socket.on("hand_lowered", (data = {}) => {
    const { socketId } = data;
    if (!socketId) return;
    const student = attendeesMap.get(socketId);
    if (student) {
      student.handRaised = false;
      renderAttendees();
    }
  });

  socket.on("student_mic_state_changed", (data = {}) => {
    const { socketId, enabled } = data;
    const student = attendeesMap.get(socketId);
    if (student) {
      student.micEnabled = Boolean(enabled);
      if (enabled) {
        approvedStudentMicrophones.add(socketId);
      } else {
        approvedStudentMicrophones.delete(socketId);
      }
      renderAttendees();
    }
  });

  socket.on("student_participation_updated", (data = {}) => {
    const { socketId, count } = data;
    if (!socketId) return;
    const student = attendeesMap.get(socketId);
    if (student) {
      student.participationCount = Math.max(0, Number(count) || 0);
      renderAttendees();
    }
  });

  socket.on("student_message_received", async (data = {}) => {
    if (!classActive) return;
    let imageUrl = null;
    let fallback = data.message || "";

    if (data.imageId) {
      try {
        imageUrl = await loadQuestionImage(data.imageId);
      } catch (err) {
        fallback = fallback || "أرسل صورة سؤال (تعذر تحميلها)";
      }
    }

    appendChatMessage({
      id: data.id,
      sender: data.studentName || "تلميذ",
      message: fallback,
      kind: "student",
      imageUrl,
      reactions: data.reactions || null,
    });
  });

  socket.on("classroom_chat_reaction_updated", (data = {}) => {
    if (!classActive) return;
    updateMessageReactions(data);
  });

  socket.on("classroom_chat_history", (data = {}) => {
    if (!classActive || !Array.isArray(data.messages)) return;
    data.messages.forEach((msg) => {
      appendChatMessage({
        id: msg.id,
        sender: msg.senderName || msg.sender || (msg.kind === "teacher" ? "الأستاذ" : "تلميذ"),
        message: msg.text || msg.message || "",
        kind: msg.kind === "teacher" || msg.role === "teacher" ? "teacher" : "student",
        imageUrl: msg.imageUrl || msg.imageData || null,
        reactions: msg.reactions || null,
      });
    });
  });

  socket.on("webrtc_offer", async (data = {}) => {
    const { fromSocketId, sdp } = data;
    if (!isCompanionMode || !sdp) return;

    try {
      if (companionPeerConnection) {
        try { companionPeerConnection.close(); } catch (_) {}
      }

      companionPeerConnection = new RTCPeerConnection(rtcConfig);
      companionPrimaryTeacherSocketId = fromSocketId;

      companionPeerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          if (el.companionVideo) {
            el.companionVideo.srcObject = event.streams[0];
            el.companionVideo.classList.add("is-active");
            el.companionVideo.play().catch((err) => console.warn("Companion video autoplay prevented:", err));
          }
        }
      };

      companionPeerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("webrtc_ice_candidate", {
            targetSocketId: fromSocketId,
            candidate: event.candidate,
            level: activeLevel,
          });
        }
      };

      await companionPeerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await companionPeerConnection.createAnswer();
      await companionPeerConnection.setLocalDescription(answer);

      socket.emit("webrtc_answer", {
        targetSocketId: fromSocketId,
        sdp: companionPeerConnection.localDescription,
        level: activeLevel,
      });
    } catch (err) {
      console.warn("Unable to process broadcaster offer on companion:", err);
    }
  });

  socket.on("webrtc_answer", async (data = {}) => {
    const { fromSocketId, sdp } = data;
    const pc = peerConnections[fromSocketId];
    if (!pc || !sdp) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const queued = pendingIceCandidates[fromSocketId]?.splice(0) || [];
      for (const candidate of queued) {
        try { await pc.addIceCandidate(candidate); } catch (_) {}
      }
    } catch (err) {
      console.warn("Unable to apply student WebRTC answer:", err);
    }
  });

  socket.on("webrtc_renegotiation_offer", async (data = {}) => {
    const { fromSocketId, sdp } = data;
    const pc = peerConnections[fromSocketId];
    if (!pc || !sdp) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await emitWithAcknowledgement("webrtc_renegotiation_answer", {
        targetSocketId: fromSocketId,
        sdp: pc.localDescription,
      });
    } catch (err) {
      console.warn("Unable to handle student renegotiation offer:", err);
    }
  });

  socket.on("webrtc_ice_candidate", async (data = {}) => {
    const { fromSocketId, candidate } = data;
    if (!candidate) return;

    if (isCompanionMode && companionPeerConnection && fromSocketId === companionPrimaryTeacherSocketId) {
      try {
        await companionPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (_) {}
      return;
    }

    const pc = peerConnections[fromSocketId];
    if (!pc || !pc.remoteDescription) {
      pendingIceCandidates[fromSocketId] = pendingIceCandidates[fromSocketId] || [];
      pendingIceCandidates[fromSocketId].push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (_) {}
  });

  socket.on("class_ended", () => {
    if (isCompanionMode) {
      showToast("أُنهي البث من الحاسوب.");
      exitCompanionMode();
      return;
    }
    if (classActive) {
      showToast("أُنهيت الحصة.");
      endLiveClass();
    }
  });

  // ---------------------------------------------------------------------------
  // 15. UI Event Listeners & Buttons
  // ---------------------------------------------------------------------------
  el.startBtn.addEventListener("click", startLiveClass);
  el.micBtn.addEventListener("click", toggleTeacherMicrophone);
  el.cameraBtn.addEventListener("click", toggleCamera);
  el.cameraFlipBtn.addEventListener("click", flipCamera);

  // End Class Modal Triggers
  el.endBtn.addEventListener("click", () => {
    if (el.endModal) el.endModal.hidden = false;
  });

  el.cancelEndBtn.addEventListener("click", () => {
    if (el.endModal) el.endModal.hidden = true;
  });

  el.confirmEndBtn.addEventListener("click", () => {
    if (el.endModal) el.endModal.hidden = true;
    endLiveClass();
  });

  document.getElementById("tm-desktop-switch-btn")?.addEventListener("click", () => {
    try { sessionStorage.setItem("teacherDesktopMode", "1"); } catch (_) {}
  });

  // ---------------------------------------------------------------------------
  // 16. Initialization on Load
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    let initialLevel = el.levelSelect?.value || "السنة الأولى";
    let initialSubject = el.subjectSelect?.value || "MATH";

    try {
      const savedLevel = localStorage.getItem("tm_last_level");
      if (savedLevel && el.levelSelect) {
        el.levelSelect.value = savedLevel;
        initialLevel = savedLevel;
      }
      const savedSub = localStorage.getItem("tm_last_subject");
      if (savedSub && el.subjectSelect) {
        el.subjectSelect.value = savedSub;
        initialSubject = savedSub;
      }
    } catch (_) {}

    activeLevel = initialLevel;
    activeSubject = initialSubject;

    updateLevelSelection(initialLevel);
    updateControls();

    // Connect socket to immediately check for running PC broadcast
    if (!socket.connected) {
      socket.connect();
    }
    checkActiveRoomForCompanion(initialLevel, initialSubject);

    // Check for previous active recovery
    try {
      const raw = sessionStorage.getItem(RECOVERY_STORAGE_KEY);
      if (raw) {
        const recovery = JSON.parse(raw);
        if (recovery?.level) {
          el.levelSelect.value = recovery.level;
          updateLevelSelection(recovery.level);
        }
      }
    } catch (_) {}
  });
})();
