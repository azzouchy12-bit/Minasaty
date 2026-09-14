"use strict";

(() => {
  const socketToken = () => {
    const role = sessionStorage.getItem("userRole") || (sessionStorage.getItem("teacherToken") ? "teacher" : "parent");
    const token = role === "teacher" ? sessionStorage.getItem("teacherToken") : sessionStorage.getItem("parentToken");
    return { role, token };
  };

  // Sync student credentials with Android native bridge
  try {
    const phone = sessionStorage.getItem("parentPhone") || localStorage.getItem("parentPhone") || "";
    const studentId = sessionStorage.getItem("studentId") || localStorage.getItem("studentId") || "";
    const studentName = sessionStorage.getItem("studentName") || localStorage.getItem("studentName") || "";
    const level = sessionStorage.getItem("level") || sessionStorage.getItem("studentLevel") || localStorage.getItem("level") || "";
    if (window.MinasatyNative?.registerStudentUser && (phone || studentId)) {
      window.MinasatyNative.registerStudentUser(phone, studentId, studentName, level);
    }
  } catch (_) {}

  const { role, token } = socketToken();
  if (!token || typeof window.io !== "function") return;

  const icon = "/assets/teacher-azzeddine-charef.jpg";
  const notificationSocket = window.io({ transports: ["websocket", "polling"] });
  window.minasatyNotificationSocket = notificationSocket;

  async function markNotificationRead(notificationId) {
    if (!notificationId || !token) return;
    try {
      await fetch(`/api/academic/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch {
      // Reading metrics are best-effort and must never block notification navigation.
    }
  }

  const pendingNotificationId = new URLSearchParams(window.location.search).get("notificationId");
  if (pendingNotificationId) {
    void markNotificationRead(pendingNotificationId);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("notificationId");
    window.history.replaceState({}, document.title, cleanUrl.href);
  }

  function showBrowserNotification(payload = {}) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = String(payload.title || "أكاديمية التفوق").slice(0, 160);
    const notification = new Notification(title, {
      body: String(payload.body || "").slice(0, 2000),
      icon: String(payload.icon || icon),
      tag: String(payload.tag || `minasaty-${Date.now()}`),
      data: { link: payload.link || "/parent-dashboard.html", ...(payload.data || {}) },
      silent: false,
    });
    notification.onclick = () => {
      const target = notification.data?.link || "/parent-dashboard.html";
      void markNotificationRead(notification.data?.notificationId || payload.notificationId);
      window.focus();
      window.location.assign(new URL(target, window.location.origin).href);
      notification.close();
    };
  }

  function registerSocket() {
    notificationSocket.emit("register_online_presence", { token });
    notificationSocket.emit("register_notification_socket", { token }, (result = {}) => {
      if (!result.ok) console.info("Browser notification socket registration unavailable.");
    });
  }

  // ── Continuous Live Class Alert Player ──
  let liveAlertAudio = null;
  let liveAlertVibrateInterval = null;
  let liveAlertOverlay = null;

  function stopContinuousLiveAlert() {
    if (liveAlertAudio) {
      try {
        liveAlertAudio.pause();
        liveAlertAudio.currentTime = 0;
      } catch (_) {}
      liveAlertAudio = null;
    }
    if (liveAlertVibrateInterval) {
      clearInterval(liveAlertVibrateInterval);
      liveAlertVibrateInterval = null;
    }
    if ("vibrate" in navigator) {
      try { navigator.vibrate(0); } catch (_) {}
    }
    if (liveAlertOverlay) {
      try { liveAlertOverlay.remove(); } catch (_) {}
      liveAlertOverlay = null;
    }
    if (navigator.serviceWorker?.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({ type: "STOP_ALERT_SOUND" });
      } catch (_) {}
    }
    if (window.MinasatyNative?.stopAlertRinging) {
      try { window.MinasatyNative.stopAlertRinging(); } catch (_) {}
    }
  }
  window.stopContinuousLiveAlert = stopContinuousLiveAlert;

  function ensureLiveAlertStyles() {
    if (document.getElementById("minasaty-live-alert-ringing-styles")) return;
    const style = document.createElement("style");
    style.id = "minasaty-live-alert-ringing-styles";
    style.textContent = `
      .minasaty-live-alert-overlay {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        background: rgba(3, 10, 24, 0.94) !important;
        backdrop-filter: blur(14px) !important;
        -webkit-backdrop-filter: blur(14px) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 20px !important;
        box-sizing: border-box !important;
        direction: rtl !important;
        text-align: center !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Tahoma, sans-serif !important;
        animation: minasatyFadeIn 0.3s ease forwards !important;
      }
      .minasaty-live-alert-card {
        background: linear-gradient(155deg, #111f38 0%, #081124 100%) !important;
        border: 2px solid rgba(239, 68, 68, 0.75) !important;
        border-radius: 26px !important;
        width: 100% !important;
        max-width: 440px !important;
        padding: 32px 24px !important;
        box-shadow: 0 0 60px rgba(239, 68, 68, 0.35), 0 25px 60px rgba(0, 0, 0, 0.85) !important;
        color: #ffffff !important;
        box-sizing: border-box !important;
        position: relative !important;
      }
      .minasaty-live-alert-pulse-box {
        position: relative !important;
        width: 80px !important;
        height: 80px !important;
        margin: 0 auto 18px auto !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .minasaty-live-alert-pulse-circle {
        position: absolute !important;
        inset: -10px !important;
        border-radius: 50% !important;
        background: rgba(239, 68, 68, 0.25) !important;
        animation: minasatyRingPulse 1.8s ease-out infinite !important;
      }
      .minasaty-live-alert-pulse-circle:nth-child(2) {
        animation-delay: 0.9s !important;
      }
      .minasaty-live-alert-icon-wrap {
        position: relative !important;
        width: 80px !important;
        height: 80px !important;
        border-radius: 50% !important;
        background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        color: #ffffff !important;
        box-shadow: 0 8px 24px rgba(239, 68, 68, 0.5) !important;
        animation: minasatyBellShake 1.2s ease-in-out infinite !important;
      }
      @keyframes minasatyRingPulse {
        0% { transform: scale(0.85); opacity: 0.9; }
        100% { transform: scale(1.6); opacity: 0; }
      }
      @keyframes minasatyBellShake {
        0%, 100% { transform: rotate(0); }
        15% { transform: rotate(14deg); }
        30% { transform: rotate(-14deg); }
        45% { transform: rotate(10deg); }
        60% { transform: rotate(-8deg); }
        75% { transform: rotate(4deg); }
      }
      .minasaty-live-alert-badge {
        display: inline-flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 5px 14px !important;
        background: rgba(239, 68, 68, 0.18) !important;
        border: 1px solid rgba(239, 68, 68, 0.45) !important;
        border-radius: 20px !important;
        color: #fca5a5 !important;
        font-size: 0.85rem !important;
        font-weight: 800 !important;
        margin-bottom: 12px !important;
      }
      .minasaty-live-alert-badge .live-dot {
        width: 8px !important;
        height: 8px !important;
        border-radius: 50% !important;
        background: #ef4444 !important;
        box-shadow: 0 0 10px #ef4444 !important;
        animation: minasatyDotPulse 1.2s ease infinite alternate !important;
      }
      @keyframes minasatyDotPulse {
        from { opacity: 0.4; } to { opacity: 1; }
      }
      .minasaty-live-alert-title {
        font-size: 1.25rem !important;
        font-weight: 800 !important;
        margin: 0 0 10px 0 !important;
        color: #ffffff !important;
        line-height: 1.4 !important;
      }
      .minasaty-live-alert-desc {
        font-size: 0.95rem !important;
        color: #cbd5e1 !important;
        margin: 0 0 24px 0 !important;
        line-height: 1.5 !important;
      }
      .minasaty-live-alert-actions {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
      }
      .minasaty-live-alert-enter-btn {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 10px !important;
        padding: 14px 20px !important;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 14px !important;
        font-size: 1.05rem !important;
        font-weight: 800 !important;
        text-decoration: none !important;
        cursor: pointer !important;
        box-shadow: 0 6px 20px rgba(16, 185, 129, 0.45) !important;
        transition: transform 0.15s ease, filter 0.15s ease !important;
      }
      .minasaty-live-alert-enter-btn:active {
        transform: scale(0.98) !important;
      }
      .minasaty-live-alert-dismiss-btn {
        padding: 10px 16px !important;
        background: transparent !important;
        color: #94a3b8 !important;
        border: 1px solid rgba(148, 163, 184, 0.25) !important;
        border-radius: 12px !important;
        font-size: 0.88rem !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        transition: color 0.15s ease, border-color 0.15s ease !important;
      }
      .minasaty-live-alert-dismiss-btn:hover {
        color: #f1f5f9 !important;
        border-color: rgba(148, 163, 184, 0.45) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function startContinuousLiveAlert(payload = {}) {
    // If the student is already inside the live classroom, do not ring or show modal
    if (window.location.pathname.includes("student-live.html")) {
      return;
    }
    if (liveAlertOverlay) return; // already ringing

    ensureLiveAlertStyles();

    const title = payload.title || "🔴 تنبيه عاجل: بدأت الحصة المباشرة!";
    const body = payload.body || "بدأت الحصة المباشرة الآن! الأستاذ بانتظارك، اضغط للدخول فوراً!";
    const targetLink = payload.link || payload.url || "/student-live.html?alert=1";

    // 1. Play alert sound in loop
    try {
      liveAlertAudio = new Audio("/sounds/alert.mp3");
      liveAlertAudio.loop = true;
      const playPromise = liveAlertAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          const unlock = () => {
            if (liveAlertAudio) {
              liveAlertAudio.play().catch(() => {});
            }
            window.removeEventListener("click", unlock);
            window.removeEventListener("touchstart", unlock);
          };
          window.addEventListener("click", unlock, { once: true });
          window.addEventListener("touchstart", unlock, { once: true });
        });
      }
    } catch (_) {}

    // 2. Vibrate phone continuously in repeating bursts
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate([600, 300, 600, 300, 600, 300, 600]);
        liveAlertVibrateInterval = setInterval(() => {
          try { navigator.vibrate([600, 300, 600, 300, 600, 300, 600]); } catch (_) {}
        }, 3200);
      } catch (_) {}
    }

    // 3. Show full-screen incoming alert
    const overlay = document.createElement("div");
    overlay.className = "minasaty-live-alert-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="minasaty-live-alert-card">
        <div class="minasaty-live-alert-pulse-box">
          <span class="minasaty-live-alert-pulse-circle"></span>
          <span class="minasaty-live-alert-pulse-circle"></span>
          <div class="minasaty-live-alert-icon-wrap">
            <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </div>
        </div>
        <div class="minasaty-live-alert-badge">
          <span class="live-dot"></span>
          <span>الحصة بدأت الآن</span>
        </div>
        <h3 class="minasaty-live-alert-title">${title}</h3>
        <p class="minasaty-live-alert-desc">${body}</p>
        <div class="minasaty-live-alert-actions">
          <a href="${targetLink}" class="minasaty-live-alert-enter-btn" id="minasaty-enter-live-btn">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <span>دخول الحصة المباشرة الآن</span>
          </a>
          <button type="button" class="minasaty-live-alert-dismiss-btn" id="minasaty-dismiss-live-alert-btn">
            إيقاف الرنين والتجاهل
          </button>
        </div>
      </div>
    `;

    document.body ? document.body.appendChild(overlay) : document.documentElement.appendChild(overlay);
    liveAlertOverlay = overlay;

    overlay.querySelector("#minasaty-enter-live-btn")?.addEventListener("click", () => {
      stopContinuousLiveAlert();
    });
    overlay.querySelector("#minasaty-dismiss-live-alert-btn")?.addEventListener("click", () => {
      stopContinuousLiveAlert();
    });
  }

  // Listen to service worker broadcast messages
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "TEACHER_LIVE_ALERT") {
        startContinuousLiveAlert(event.data.payload);
      } else if (event.data?.type === "STOP_ALERT_SOUND") {
        stopContinuousLiveAlert();
      }
    });
  }

  notificationSocket.on("connect", registerSocket);
  notificationSocket.on("push_notification", (payload = {}) => {
    showBrowserNotification(payload);
    if (payload.data?.type === "session_takeover") {
      window.setTimeout(() => {
        if (typeof window.handleSessionTakeover === "function") window.handleSessionTakeover();
        else window.location.replace("/index.html?session=takeover");
      }, 250);
    } else if (payload.data?.type === "TEACHER_LIVE_ALERT" || payload.type === "TEACHER_LIVE_ALERT" || payload.data?.alertSound) {
      startContinuousLiveAlert(payload);
    }
  });
  notificationSocket.on("connect_error", () => {});

  function createTeacherPermissionPrompt() {
    if (role !== "teacher" || !("Notification" in window) || Notification.permission !== "default") return;
    if (localStorage.getItem("minasaty-browser-notification-dismissed-v1") === "1") return;

    const wrapper = document.createElement("aside");
    wrapper.className = "browser-notification-consent";
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-label", "تفعيل تنبيهات المتصفح");
    wrapper.innerHTML = `
      <strong>فعّل تنبيهات أكاديمية التفوق</strong>
      <p>لتصلك تنبيهات الرسائل والإعلانات المهمة حتى أثناء استخدام لوحة الأستاذ.</p>
      <div class="browser-notification-consent-actions">
        <button type="button" data-browser-notification-enable>تفعيل التنبيهات</button>
        <button type="button" data-browser-notification-dismiss>ليس الآن</button>
      </div>
    `;
    document.body.append(wrapper);

    wrapper.querySelector("[data-browser-notification-dismiss]")?.addEventListener("click", () => {
      localStorage.setItem("minasaty-browser-notification-dismissed-v1", "1");
      wrapper.remove();
    });
    wrapper.querySelector("[data-browser-notification-enable]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("لم يتم السماح بإشعارات المتصفح.");
        wrapper.remove();
        registerSocket();
      } catch (error) {
        const paragraph = wrapper.querySelector("p");
        if (paragraph) paragraph.textContent = error.message || "تعذر تفعيل التنبيهات.";
        button.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createTeacherPermissionPrompt, { once: true });
  } else {
    createTeacherPermissionPrompt();
  }

  // ── Native Android FCM Token Synchronization ──
  async function syncNativeFcmToken(deviceToken) {
    const safeToken = String(deviceToken || "").trim();
    if (!safeToken) return;

    const storedRole = sessionStorage.getItem("userRole") || (sessionStorage.getItem("teacherToken") ? "teacher" : "parent");
    const parentPhone = sessionStorage.getItem("parentPhone") || localStorage.getItem("parentPhone") || "";
    const studentId = sessionStorage.getItem("studentId") || localStorage.getItem("studentId") || "";
    const currentToken = sessionStorage.getItem("teacherToken") || sessionStorage.getItem("parentToken") || "";

    const payload = {
      token: safeToken,
      platform: "android",
      parentPhone,
      studentId,
      recipientRole: storedRole,
    };

    const headers = { "Content-Type": "application/json" };
    if (currentToken) headers["Authorization"] = `Bearer ${currentToken}`;

    try {
      await fetch("/api/push/fcm-token", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (_) {}
  }

  window.onNativeFcmToken = (token) => {
    void syncNativeFcmToken(token);
  };

  // Check if token is already cached in Android bridge on page load
  window.setTimeout(() => {
    try {
      if (window.MinasatyNative?.getFcmToken) {
        const initialToken = window.MinasatyNative.getFcmToken();
        if (initialToken) void syncNativeFcmToken(initialToken);
      }
    } catch (_) {}
  }, 1000);
})();
