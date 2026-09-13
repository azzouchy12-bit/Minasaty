"use strict";

/**
 * Alert Sound Player & Push Enabler for Teacher Live Alerts
 * - Prompts users on Chrome / Safari to activate Push Notifications & Audio with 1 click
 * - Plays /sounds/alert.mp3 continuously until the student enters the live class (student-live.html)
 * - Wakes up open & background tabs via Service Worker postMessage
 */
(() => {
  const ALERT_SOUND_SRC = "/sounds/alert.mp3";
  const PROMPT_DISMISS_KEY = "minasaty-live-alert-prompt-dismissed-v2";
  const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

  let alertAudio = null;
  let isRinging = false;
  let activeNotificationId = null;

  function injectBannerStyles() {
    if (document.getElementById("live-alert-banner-styles")) return;
    const style = document.createElement("style");
    style.id = "live-alert-banner-styles";
    style.textContent = `
      /* Ringing Banner (When Live Class Alert is Active) */
      .live-alert-ringing-banner {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.9rem 1.4rem;
        background: linear-gradient(135deg, #b45309 0%, #d97706 100%);
        color: #ffffff;
        border: 2px solid #fbbf24;
        border-radius: 16px;
        box-shadow: 0 10px 30px rgba(180, 83, 9, 0.6), 0 0 20px rgba(251, 191, 36, 0.4);
        direction: rtl;
        font-family: "Tajawal", "Cairo", Tahoma, sans-serif;
        animation: live-alert-bounce 0.6s ease infinite alternate;
        max-width: min(680px, 94vw);
      }
      @keyframes live-alert-bounce {
        from { transform: translateX(-50%) translateY(0); }
        to { transform: translateX(-50%) translateY(-4px); }
      }
      .live-alert-bell-pulse {
        font-size: 1.9rem;
        line-height: 1;
        animation: live-alert-wiggle 0.3s ease infinite alternate;
      }
      @keyframes live-alert-wiggle {
        from { transform: rotate(-15deg); }
        to { transform: rotate(15deg); }
      }
      .live-alert-banner-text {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
      }
      .live-alert-banner-text strong {
        font-size: 0.95rem;
        font-weight: 900;
        color: #fef08a;
      }
      .live-alert-banner-text span {
        font-size: 0.76rem;
        opacity: 0.95;
      }
      .live-alert-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-inline-start: auto;
      }
      .live-alert-join-btn {
        padding: 0.55rem 1.15rem;
        background: #15803d;
        color: #ffffff !important;
        border: 1px solid #4ade80;
        border-radius: 10px;
        font-weight: 800;
        font-size: 0.82rem;
        text-decoration: none;
        white-space: nowrap;
        box-shadow: 0 3px 10px rgba(21, 128, 61, 0.4);
        transition: transform 0.15s ease, background 0.15s ease;
      }
      .live-alert-join-btn:hover {
        background: #16a34a;
        transform: scale(1.04);
      }
      .live-alert-silence-btn {
        padding: 0.55rem 0.85rem;
        background: rgba(0, 0, 0, 0.35);
        color: #fef08a;
        border: 1px solid rgba(254, 240, 138, 0.4);
        border-radius: 10px;
        font-weight: 700;
        font-size: 0.74rem;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s ease;
      }
      .live-alert-silence-btn:hover {
        background: rgba(0, 0, 0, 0.55);
      }

      /* Push & Audio Permission Prompt Banner */
      .live-alert-prompt-banner {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 999990;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.2rem;
        padding: 0.85rem 1.4rem;
        background: rgba(15, 23, 42, 0.94);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1.5px solid rgba(59, 130, 246, 0.4);
        border-radius: 16px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(59, 130, 246, 0.25);
        color: #f8fafc;
        direction: rtl;
        font-family: "Tajawal", "Cairo", Tahoma, sans-serif;
        max-width: min(720px, 94vw);
        transition: opacity 0.3s ease, transform 0.3s ease;
      }
      .live-alert-prompt-content {
        display: flex;
        align-items: center;
        gap: 0.9rem;
        min-width: 0;
      }
      .live-alert-prompt-icon {
        font-size: 1.8rem;
        line-height: 1;
        flex-shrink: 0;
      }
      .live-alert-prompt-info {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .live-alert-prompt-info strong {
        font-size: 0.92rem;
        font-weight: 800;
        color: #60a5fa;
      }
      .live-alert-prompt-info p {
        margin: 0;
        font-size: 0.76rem;
        color: #cbd5e1;
        line-height: 1.35;
      }
      .live-alert-prompt-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
      }
      .live-alert-btn-enable {
        padding: 0.5rem 1rem;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #ffffff;
        border: 1px solid #60a5fa;
        border-radius: 10px;
        font-weight: 800;
        font-size: 0.8rem;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
        transition: transform 0.15s ease, background 0.15s ease;
        white-space: nowrap;
      }
      .live-alert-btn-enable:hover {
        background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
        transform: scale(1.03);
      }
      .live-alert-btn-dismiss {
        padding: 0.5rem 0.8rem;
        background: rgba(255, 255, 255, 0.08);
        color: #94a3b8;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 10px;
        font-weight: 600;
        font-size: 0.75rem;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        white-space: nowrap;
      }
      .live-alert-btn-dismiss:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #f1f5f9;
      }

      @media (max-width: 600px) {
        .live-alert-prompt-banner {
          flex-direction: column;
          align-items: stretch;
          bottom: 12px;
          padding: 0.8rem 1rem;
        }
        .live-alert-prompt-actions {
          margin-top: 0.5rem;
          justify-content: flex-end;
        }
      }
    `;
    document.head.append(style);
  }

  function getAuthToken() {
    return sessionStorage.getItem("parentToken") || sessionStorage.getItem("teacherToken") || "";
  }

  async function markAlertRead(notificationId) {
    if (!notificationId) return;
    const token = getAuthToken();
    if (!token) return;
    try {
      await fetch(`/api/academic/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (_) {}
  }

  function warmUpAudio() {
    try {
      if (!alertAudio) {
        alertAudio = new Audio(ALERT_SOUND_SRC);
        alertAudio.loop = true;
      }
    } catch (_) {}
  }

  function startAlertSound(notificationId) {
    if (isRinging) return;

    // Do not ring in loop if already inside student-live.html (student has entered!)
    const isInsideLiveStudio = window.location.pathname.includes("student-live.html");
    if (isInsideLiveStudio) {
      if (notificationId) markAlertRead(notificationId);
      return;
    }

    isRinging = true;
    activeNotificationId = notificationId || null;

    try {
      if (!alertAudio) {
        alertAudio = new Audio(ALERT_SOUND_SRC);
        alertAudio.loop = true;
      }
      const playPromise = alertAudio.play();
      if (playPromise) {
        playPromise.catch(() => {
          const onFirstInteraction = () => {
            if (isRinging && alertAudio) {
              alertAudio.play().catch(() => {});
            }
            window.removeEventListener("pointerdown", onFirstInteraction);
            window.removeEventListener("keydown", onFirstInteraction);
            window.removeEventListener("click", onFirstInteraction);
          };
          window.addEventListener("pointerdown", onFirstInteraction, { once: true });
          window.addEventListener("keydown", onFirstInteraction, { once: true });
          window.addEventListener("click", onFirstInteraction, { once: true });
        });
      }
    } catch (err) {
      console.warn("Could not play alert audio:", err);
    }

    showRingingBanner();
  }

  function stopAlertSound() {
    isRinging = false;
    if (alertAudio) {
      try {
        alertAudio.pause();
        alertAudio.currentTime = 0;
      } catch (_) {}
    }
    const banner = document.getElementById("live-alert-ringing-banner");
    if (banner) banner.remove();

    if (activeNotificationId) {
      markAlertRead(activeNotificationId);
      activeNotificationId = null;
    }
  }

  function showRingingBanner() {
    injectBannerStyles();
    if (document.getElementById("live-alert-ringing-banner")) return;

    const banner = document.createElement("div");
    banner.id = "live-alert-ringing-banner";
    banner.className = "live-alert-ringing-banner";
    banner.setAttribute("role", "alert");
    banner.innerHTML = `
      <span class="live-alert-bell-pulse" aria-hidden="true">🔔</span>
      <div class="live-alert-banner-text">
        <strong>تنبيه عاجل من الأستاذ: بدأت الحصة المباشرة الآن!</strong>
        <span>انضم إلى البث المباشر فوراً</span>
      </div>
      <div class="live-alert-actions">
        <a href="/student-live.html" class="live-alert-join-btn">🚀 دخول الحصة الآن</a>
        <button type="button" class="live-alert-silence-btn">🔇 إيقاف الصوت</button>
      </div>
    `;

    banner.querySelector(".live-alert-join-btn")?.addEventListener("click", () => {
      stopAlertSound();
    });

    banner.querySelector(".live-alert-silence-btn")?.addEventListener("click", () => {
      stopAlertSound();
    });

    document.body.append(banner);
  }

  // Permission & Sound Activation Prompt for Chrome / Safari
  function renderPermissionPromptIfNeeded() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    if (window.location.pathname.includes("student-live.html")) {
      // In live class, auto-sync subscription silently if permission already granted
      if (Notification.permission === "granted" && typeof window.enablePushNotifications === "function") {
        window.enablePushNotifications({ requestPermission: false }).catch(() => {});
      }
      return;
    }

    if (Notification.permission === "granted") {
      // Already granted! Sync subscription silently
      if (typeof window.enablePushNotifications === "function") {
        window.enablePushNotifications({ requestPermission: false }).catch(() => {});
      }
      return;
    }

    if (Notification.permission === "denied") return;

    // Check if dismissed recently
    try {
      const dismissedAt = Number(localStorage.getItem(PROMPT_DISMISS_KEY));
      if (Number.isFinite(dismissedAt) && Date.now() - dismissedAt < PROMPT_COOLDOWN_MS) {
        return;
      }
    } catch (_) {}

    injectBannerStyles();
    if (document.getElementById("live-alert-prompt-banner")) return;

    const banner = document.createElement("aside");
    banner.id = "live-alert-prompt-banner";
    banner.className = "live-alert-prompt-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "تفعيل تنبيهات الحصص المباشرة");
    banner.innerHTML = `
      <div class="live-alert-prompt-content">
        <span class="live-alert-prompt-icon" aria-hidden="true">🔔</span>
        <div class="live-alert-prompt-info">
          <strong>تفعيل تنبيهات ورنة الحصص المباشرة</strong>
          <p>فعّل التنبيهات لتصلك رنة تنبيه فورية عند بدء الأستاذ للبث حتى لو كان المتصفح مغلقاً أو في الخلفية.</p>
        </div>
      </div>
      <div class="live-alert-prompt-actions">
        <button type="button" class="live-alert-btn-enable" id="live-alert-enable-btn">🔊 تفعيل التنبيهات والصوت</button>
        <button type="button" class="live-alert-btn-dismiss" id="live-alert-dismiss-btn">ليس الآن</button>
      </div>
    `;

    document.body.append(banner);

    const enableBtn = banner.querySelector("#live-alert-enable-btn");
    const dismissBtn = banner.querySelector("#live-alert-dismiss-btn");

    dismissBtn?.addEventListener("click", () => {
      try {
        localStorage.setItem(PROMPT_DISMISS_KEY, String(Date.now()));
      } catch (_) {}
      banner.remove();
    });

    enableBtn?.addEventListener("click", async () => {
      enableBtn.disabled = true;
      enableBtn.textContent = "جارٍ التفعيل…";

      // Unlock audio autoplay by initializing audio in click handler
      warmUpAudio();

      try {
        if (typeof window.enablePushNotifications !== "function") {
          throw new Error("دعم الإشعارات غير متوفر في الصفحة.");
        }
        await window.enablePushNotifications({ requestPermission: true });

        enableBtn.style.background = "#16a34a";
        enableBtn.style.borderColor = "#4ade80";
        enableBtn.textContent = "✓ تم تفعيل التنبيهات بنجاح!";

        setTimeout(() => {
          banner.style.opacity = "0";
          banner.style.transform = "translateX(-50%) translateY(20px)";
          setTimeout(() => banner.remove(), 350);
        }, 1800);
      } catch (err) {
        console.warn("Enable notifications failed:", err);
        enableBtn.disabled = false;
        enableBtn.textContent = "المحاولة مرة أخرى";
        const infoP = banner.querySelector(".live-alert-prompt-info p");
        if (infoP) {
          infoP.textContent = err.message || "تعذر تفعيل التنبيهات. تأكد من السماح بالإشعارات من إعدادات المتصفح.";
          infoP.style.color = "#fca5a5";
        }
      }
    });
  }

  // Check for active alerts on page load
  async function checkForActiveTeacherAlert() {
    const isInsideLiveStudio = window.location.pathname.includes("student-live.html");
    const queryParams = new URLSearchParams(window.location.search);
    const alertParam = queryParams.get("alert");
    const notifParam = queryParams.get("notificationId");

    // If inside student-live.html, stop ringing! The student is now inside the class.
    if (isInsideLiveStudio) {
      stopAlertSound();
      if (notifParam) markAlertRead(notifParam);
      return;
    }

    if (alertParam === "1" || notifParam) {
      startAlertSound(notifParam);
      return;
    }

    // Check public active alert endpoint
    try {
      const activeRes = await fetch("/api/academic/teacher-live-alert/active");
      if (activeRes.ok) {
        const activeData = await activeRes.json();
        if (activeData.active && activeData.alert) {
          startAlertSound(activeData.alert.id);
          return;
        }
      }
    } catch (_) {}

    // Fallback: check personal notifications if user is authenticated
    const token = getAuthToken();
    if (!token) return;

    try {
      const response = await fetch("/api/academic/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      const notifications = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);

      // Look for any unread TEACHER_LIVE_ALERT in the last 60 minutes
      const sixtyMinutesAgo = Date.now() - 60 * 60 * 1000;
      const activeAlert = notifications.find((n) => {
        if (n.isRead || n.type !== "TEACHER_LIVE_ALERT") return false;
        const created = new Date(n.createdAt).getTime();
        return created >= sixtyMinutesAgo;
      });

      if (activeAlert) {
        startAlertSound(activeAlert.id);
      }
    } catch (_) {}
  }

  // Listen for real-time socket alerts
  function setupSocketListener() {
    const socket = window.minasatyNotificationSocket || (typeof window.io === "function" ? window.io() : null);
    if (!socket) {
      setTimeout(setupSocketListener, 1200);
      return;
    }

    socket.on("push_notification", (payload = {}) => {
      if (payload.data?.type === "TEACHER_LIVE_ALERT" || payload.type === "TEACHER_LIVE_ALERT" || payload.data?.alertSound) {
        startAlertSound(payload.data?.notificationId || payload.notificationId);
      }
    });
  }

  // Listen for Service Worker postMessage events (broadcasts from push receipts)
  function setupServiceWorkerListener() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "TEACHER_LIVE_ALERT") {
        startAlertSound(event.data?.payload?.notificationId);
      } else if (event.data?.type === "STOP_ALERT_SOUND") {
        stopAlertSound();
      }
    });
  }

  window.minasatyAlertSoundPlayer = {
    start: startAlertSound,
    stop: stopAlertSound,
  };

  function init() {
    warmUpAudio();
    checkForActiveTeacherAlert();
    setupSocketListener();
    setupServiceWorkerListener();
    renderPermissionPromptIfNeeded();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
