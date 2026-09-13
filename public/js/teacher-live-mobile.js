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

    // Chat
    chatBox: document.getElementById("tm-chat-box"),
    chatEmpty: document.getElementById("tm-chat-empty"),
    chatForm: document.getElementById("tm-chat-form"),
    chatInput: document.getElementById("tm-chat-input"),
    chatSendBtn: document.getElementById("tm-chat-send-btn"),
    chatNavBadge: document.getElementById("tm-chat-nav-badge"),

    // Attendees
    attendeeSearch: document.getElementById("tm-attendee-search"),
    handsSection: document.getElementById("tm-hands-section"),
    handsBadgeNum: document.getElementById("tm-hands-badge-num"),
    handsList: document.getElementById("tm-hands-list"),
    attendeesContainer: document.getElementById("tm-attendees-container"),
    attendeesEmpty: document.getElementById("tm-attendees-empty"),
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
      if (!socket.connected) {
        reject(new Error("الاتصال بالخادم غير متاح حالياً."));
        return;
      }
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
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Navigation Tabs
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
    }
  }

  el.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

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

  el.levelSelect.addEventListener("change", (e) => {
    if (!classActive) {
      updateLevelSelection(e.target.value);
    }
  });

  el.subjectSelect.addEventListener("change", (e) => {
    if (!classActive) {
      activeSubject = e.target.value;
    }
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
    setStatus("جارٍ إعداد الصوت والاتصال بالخادم…", "neutral");
    updateControls();

    try {
      // 1. Acquire mic
      await setupMicrophone();

      // 2. Connect socket if needed
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

      // 3. Emit teacher_start_room
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

      // 4. Update UI to Live
      setLiveState(true);
      setStatus(`الحصة مباشرة الآن — ${activeLevel} | ${activeSubject}`, "live");
      showToast(`بدأت الحصة المباشرة لـ ${activeLevel} 🎉`);
    } catch (err) {
      console.error("Unable to start live class:", err);
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
  // 12. Attendees & Hands Raised
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
  }

  function removeAttendee(socketId) {
    attendeesMap.delete(socketId);
    renderAttendees();
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

  if (el.attendeeSearch) {
    el.attendeeSearch.addEventListener("input", renderAttendees);
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

  function appendChatMessage({ sender, message, kind = "student", imageUrl = null }) {
    if (el.chatEmpty) el.chatEmpty.style.display = "none";

    const bubble = document.createElement("div");
    bubble.className = `tm-chat-bubble is-${kind}`;

    const head = document.createElement("div");
    head.className = "tm-chat-bubble-head";

    const name = document.createElement("span");
    name.className = "tm-chat-bubble-name";
    name.textContent = sender;

    const time = document.createElement("span");
    time.textContent = new Date().toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" });

    head.append(name, time);

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
        await emitWithAcknowledgement("teacher_send_message", {
          level: activeLevel,
          message: text,
        });

        appendChatMessage({
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
    await createAndSendOffer(socketId);
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
      sender: data.studentName || "تلميذ",
      message: fallback,
      kind: "student",
      imageUrl,
    });
  });

  socket.on("classroom_chat_history", (data = {}) => {
    if (!classActive || !Array.isArray(data.messages)) return;
    data.messages.forEach((msg) => {
      appendChatMessage({
        sender: msg.senderName || msg.sender || "تلميذ",
        message: msg.text || msg.message || "",
        kind: msg.role === "teacher" ? "teacher" : "student",
        imageUrl: msg.imageUrl || null,
      });
    });
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
    const pc = peerConnections[fromSocketId];
    if (!candidate) return;

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

  // ---------------------------------------------------------------------------
  // 16. Initialization on Load
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    updateLevelSelection(el.levelSelect.value || "السنة الأولى");
    updateControls();

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
