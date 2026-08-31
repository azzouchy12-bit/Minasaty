"use strict";

(() => {
  const socketToken = () => {
    const role = sessionStorage.getItem("userRole") || (sessionStorage.getItem("teacherToken") ? "teacher" : "parent");
    const token = role === "teacher" ? sessionStorage.getItem("teacherToken") : sessionStorage.getItem("parentToken");
    return { role, token };
  };

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

  notificationSocket.on("connect", registerSocket);
  notificationSocket.on("push_notification", (payload = {}) => {
    showBrowserNotification(payload);
    if (payload.data?.type === "session_takeover") {
      window.setTimeout(() => {
        if (typeof window.handleSessionTakeover === "function") window.handleSessionTakeover();
        else window.location.replace("/index.html?session=takeover");
      }, 250);
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
})();
