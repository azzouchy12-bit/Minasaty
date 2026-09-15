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

  // ── Clean Live Class In-App Notification (Toast Banner) ──
  let liveAlertToast = null;
  let liveAlertToastTimer = null;

  function stopContinuousLiveAlert() {
    if (liveAlertToast) {
      try { liveAlertToast.remove(); } catch (_) {}
      liveAlertToast = null;
    }
    if (liveAlertToastTimer) {
      clearTimeout(liveAlertToastTimer);
      liveAlertToastTimer = null;
    }
    if ("vibrate" in navigator) {
      try { navigator.vibrate(0); } catch (_) {}
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

  function ensureLiveAlertToastStyles() {
    if (document.getElementById("minasaty-live-toast-styles")) return;
    const style = document.createElement("style");
    style.id = "minasaty-live-toast-styles";
    style.textContent = `
      .minasaty-live-toast-banner {
        position: fixed !important;
        top: 14px !important;
        left: 50% !important;
        transform: translateX(-50%) translateY(-120%) !important;
        width: calc(100% - 28px) !important;
        max-width: 480px !important;
        z-index: 2147483647 !important;
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.97) 0%, rgba(30, 41, 59, 0.98) 100%) !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        border: 1.5px solid rgba(16, 185, 129, 0.55) !important;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.65), 0 0 20px rgba(16, 185, 129, 0.25) !important;
        border-radius: 18px !important;
        padding: 12px 14px !important;
        box-sizing: border-box !important;
        direction: rtl !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        cursor: pointer !important;
        transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease !important;
        opacity: 0 !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Tahoma, sans-serif !important;
      }
      .minasaty-live-toast-banner.is-visible {
        transform: translateX(-50%) translateY(0) !important;
        opacity: 1 !important;
      }
      .minasaty-live-toast-avatar {
        width: 46px !important;
        height: 46px !important;
        border-radius: 50% !important;
        object-fit: cover !important;
        border: 2px solid #10b981 !important;
        box-shadow: 0 0 10px rgba(16, 185, 129, 0.4) !important;
        flex-shrink: 0 !important;
      }
      .minasaty-live-toast-content {
        flex: 1 !important;
        min-width: 0 !important;
        text-align: right !important;
      }
      .minasaty-live-toast-title {
        margin: 0 0 3px 0 !important;
        font-size: 0.96rem !important;
        font-weight: 800 !important;
        color: #ffffff !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .minasaty-live-toast-badge {
        display: inline-block !important;
        width: 8px !important;
        height: 8px !important;
        border-radius: 50% !important;
        background: #ef4444 !important;
        box-shadow: 0 0 8px #ef4444 !important;
        flex-shrink: 0 !important;
      }
      .minasaty-live-toast-desc {
        margin: 0 !important;
        font-size: 0.82rem !important;
        color: #cbd5e1 !important;
        line-height: 1.35 !important;
        display: -webkit-box !important;
        -webkit-line-clamp: 2 !important;
        -webkit-box-orient: vertical !important;
        overflow: hidden !important;
      }
      .minasaty-live-toast-close {
        background: transparent !important;
        border: none !important;
        color: #94a3b8 !important;
        font-size: 1.2rem !important;
        line-height: 1 !important;
        padding: 6px 8px !important;
        cursor: pointer !important;
        flex-shrink: 0 !important;
        border-radius: 8px !important;
        transition: color 0.15s ease !important;
      }
      .minasaty-live-toast-close:hover {
        color: #ffffff !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function startContinuousLiveAlert(payload = {}) {
    // If the student is already inside the live classroom, do nothing
    if (window.location.pathname.includes("student-live.html")) {
      return;
    }

    ensureLiveAlertToastStyles();

    const title = payload.title || "🔴 بدأت الآن الحصة المباشرة";
    const body = payload.body || "بدأت الحصة المباشرة مع الدكتور شارف عز الدين. اضغط هنا للدخول مباشرة.";
    const targetLink = payload.link || payload.url || "/student-live.html?alert=1";

    // Clean up any existing toast
    if (liveAlertToast) {
      try { liveAlertToast.remove(); } catch (_) {}
      liveAlertToast = null;
    }
    if (liveAlertToastTimer) {
      clearTimeout(liveAlertToastTimer);
      liveAlertToastTimer = null;
    }

    // Standard gentle phone vibration pulse (like a text message)
    if ("vibrate" in navigator) {
      try { navigator.vibrate([180, 100, 180]); } catch (_) {}
    }

    // Create sleek in-app top toast banner (non-blocking)
    const toast = document.createElement("div");
    toast.className = "minasaty-live-toast-banner";
    toast.setAttribute("role", "alert");
    toast.innerHTML = `
      <img src="/assets/teacher-azzeddine-charef.jpg" alt="الدكتور شارف عز الدين" class="minasaty-live-toast-avatar" />
      <div class="minasaty-live-toast-content">
        <div class="minasaty-live-toast-title">
          <span class="minasaty-live-toast-badge"></span>
          <span>${title}</span>
        </div>
        <p class="minasaty-live-toast-desc">${body}</p>
      </div>
      <button type="button" class="minasaty-live-toast-close" aria-label="إغلاق">&times;</button>
    `;

    document.body ? document.body.appendChild(toast) : document.documentElement.appendChild(toast);
    liveAlertToast = toast;

    // Trigger entrance animation
    requestAnimationFrame(() => {
      toast.classList.add("is-visible");
    });

    // Clicking anywhere on toast opens classroom
    toast.addEventListener("click", (e) => {
      if (e.target.closest(".minasaty-live-toast-close")) return;
      stopContinuousLiveAlert();
      window.location.assign(new URL(targetLink, window.location.origin).href);
    });

    // Dismiss button
    toast.querySelector(".minasaty-live-toast-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      stopContinuousLiveAlert();
    });

    // Auto-dismiss after 8 seconds
    liveAlertToastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => {
        if (liveAlertToast === toast) {
          try { toast.remove(); } catch (_) {}
          liveAlertToast = null;
        }
      }, 350);
    }, 8000);
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
