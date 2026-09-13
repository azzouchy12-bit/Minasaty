"use strict";

/**
 * Alert Sound Player for Teacher Live Alerts
 * Plays /sounds/alert.mp3 continuously until the student/parent enters the live class
 * or explicitly silences the alert.
 */
(() => {
  const ALERT_SOUND_SRC = "/sounds/alert.mp3";
  let alertAudio = null;
  let isRinging = false;
  let activeNotificationId = null;

  function injectBannerStyles() {
    if (document.getElementById("live-alert-banner-styles")) return;
    const style = document.createElement("style");
    style.id = "live-alert-banner-styles";
    style.textContent = `
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
        max-width: min(650px, 94vw);
      }
      @keyframes live-alert-bounce {
        from { transform: translateX(-50%) translateY(0); }
        to { transform: translateX(-50%) translateY(-4px); }
      }
      .live-alert-bell-pulse {
        font-size: 1.8rem;
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
        padding: 0.55rem 1.1rem;
        background: #15803d;
        color: #ffffff !important;
        border: 1px solid #4ade80;
        border-radius: 10px;
        font-weight: 800;
        font-size: 0.8rem;
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

  function startAlertSound(notificationId) {
    if (isRinging) return;
    isRinging = true;
    activeNotificationId = notificationId || null;

    // Do not ring in loop if already inside student-live.html (student has entered!)
    const isInsideLiveStudio = window.location.pathname.includes("student-live.html");
    if (isInsideLiveStudio) {
      if (notificationId) markAlertRead(notificationId);
      return;
    }

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
          };
          window.addEventListener("pointerdown", onFirstInteraction, { once: true });
          window.addEventListener("keydown", onFirstInteraction, { once: true });
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

  // Check for active alerts on page load
  async function checkForActiveTeacherAlert() {
    const isInsideLiveStudio = window.location.pathname.includes("student-live.html");
    const token = getAuthToken();

    const queryParams = new URLSearchParams(window.location.search);
    const alertParam = queryParams.get("alert");
    const notifParam = queryParams.get("notificationId");

    if (isInsideLiveStudio) {
      if (notifParam) markAlertRead(notifParam);
      return;
    }

    if (alertParam === "1" || notifParam) {
      startAlertSound(notifParam);
      return;
    }

    if (!token) return;

    try {
      const response = await fetch("/api/academic/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      const notifications = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);

      // Look for any unread TEACHER_LIVE_ALERT in the last 2 hours
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      const activeAlert = notifications.find((n) => {
        if (n.isRead || n.type !== "TEACHER_LIVE_ALERT") return false;
        const created = new Date(n.createdAt).getTime();
        return created >= twoHoursAgo;
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
      setTimeout(setupSocketListener, 1000);
      return;
    }

    socket.on("push_notification", (payload = {}) => {
      if (payload.data?.type === "TEACHER_LIVE_ALERT" || payload.type === "TEACHER_LIVE_ALERT" || payload.data?.alertSound) {
        startAlertSound(payload.data?.notificationId || payload.notificationId);
      }
    });
  }

  window.minasatyAlertSoundPlayer = {
    start: startAlertSound,
    stop: stopAlertSound,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      checkForActiveTeacherAlert();
      setupSocketListener();
    }, { once: true });
  } else {
    checkForActiveTeacherAlert();
    setupSocketListener();
  }
})();
