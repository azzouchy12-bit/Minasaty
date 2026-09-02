"use strict";

(() => {
  const role = sessionStorage.getItem("teacherToken") ? "teacher" : "student";
  const token = role === "teacher" ? sessionStorage.getItem("teacherToken") : sessionStorage.getItem("parentToken");
  const studentId = role === "student"
    ? new URLSearchParams(window.location.search).get("studentId") || sessionStorage.getItem("selectedStudentId") || sessionStorage.getItem("studentId")
    : null;
  const bell = document.querySelector("[data-message-bell]");
  const badge = document.querySelector("[data-message-badge]");
  const bellIcon = bell?.querySelector("[data-message-bell-icon], .message-bell-icon");
  const bellLabel = bell?.querySelector("[data-message-bell-label], .message-bell-label");
  if (!token || !bell) return;

  let unreadCount = 0;
  let notificationSocket = null;

  function renderBadge() {
    if (!badge) return;
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.hidden = unreadCount === 0;
    bell.classList.toggle("has-unread", unreadCount > 0);
  }

  function showBrowserNotification(message) {
    if (!("Notification" in window) || document.visibilityState === "visible") return;
    if (Notification.permission === "granted") {
      new Notification(role === "teacher" ? `رسالة جديدة من ${message.senderName || "طالب"}` : "رسالة جديدة من الأستاذ", {
        body: String(message.content || "").slice(0, 160),
        icon: "/assets/teacher-azzeddine-charef.jpg",
        tag: `private-message-${message.studentId || "general"}`,
      });
    }
  }

  function showMessageToast(message) {
    const toast = document.createElement("div");
    toast.className = "message-notification-toast";
    toast.setAttribute("role", "status");
    toast.textContent = role === "teacher"
      ? `رسالة جديدة من ${message.senderName || "طالب"}`
      : "رسالة جديدة من الأستاذ";
    document.body.append(toast);
    window.setTimeout(() => toast.classList.add("is-visible"), 20);
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 220);
    }, 4_000);
  }

  async function loadUnreadCount() {
    try {
      const response = await fetch("/api/messages/unread-count", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (response.ok) {
        const payload = await response.json();
        unreadCount = Number(payload.count) || 0;
        renderBadge();
      }
    } catch (error) {
      console.info("Private-message unread count unavailable:", error?.message || error);
    }
  }

  function connectNotifications() {
    if (typeof io !== "function") return;
    notificationSocket = io("/private-messages", {
      auth: { token, ...(studentId ? { studentId } : {}) },
      transports: ["websocket", "polling"],
    });
    notificationSocket.on("private_message_created", (message = {}) => {
      const incoming = role === "teacher" ? message.senderRole === "student" : message.senderRole === "teacher";
      if (!incoming) return;
      unreadCount += 1;
      renderBadge();
      showMessageToast(message);
      showBrowserNotification(message);
    });
  }

  window.addEventListener("private-messages-read", () => { void loadUnreadCount(); });
  bell.addEventListener("click", () => {
    bell.classList.add("is-contact-active");
    bell.setAttribute("aria-label", "مراسلة الأستاذ");
    if (bellIcon) bellIcon.hidden = true;
    if (bellLabel) bellLabel.hidden = false;
    if (typeof window.enablePushNotifications === "function" && "Notification" in window && Notification.permission !== "denied") {
      window.enablePushNotifications().catch(() => {});
    }
  }, { once: true });
  void loadUnreadCount();
  connectNotifications();
})();
