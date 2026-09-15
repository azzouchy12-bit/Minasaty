"use strict";

const CACHE_NAME = "acadimia-pwa-v5";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Network-first strategy for dynamic content
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Bypass socket.io, api routes, live studio, teacher dashboard, and video streams from service worker cache
  if (
    url.pathname.startsWith("/socket.io") ||
    url.pathname.startsWith("/api") ||
    url.pathname.includes("upload") ||
    url.pathname.includes("teacher-live") ||
    url.pathname.includes("teacher-dashboard")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Push Notification handler ──
self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      payload = { title: "منصة مِنَسَاتي", body: event.data.text() || "لديك إشعار جديد." };
    }
  }

  const isLiveAlert = payload.type === "TEACHER_LIVE_ALERT" || payload.tag === "teacher-live-alert" || Boolean(payload.alertSound);
  const title = payload.title || (isLiveAlert ? "🔴 بدأت الآن الحصة المباشرة" : "منصة مِنَسَاتي");
  const options = {
    body: payload.body || "بدأت الحصة المباشرة مع الدكتور شارف عز الدين. اضغط هنا للدخول مباشرة إلى البث.",
    icon: "/assets/teacher-azzeddine-charef.jpg",
    badge: "/assets/icon-192.png",
    tag: isLiveAlert ? "teacher-live-alert" : (payload.tag || "minasaty-notification"),
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
    actions: isLiveAlert ? [
      { action: "enter_live", title: "🚀 دخول البث المباشر" },
    ] : [],
    data: {
      url: payload.link || payload.url || "/student-live.html?alert=1",
      type: payload.type || (isLiveAlert ? "TEACHER_LIVE_ALERT" : "GENERAL"),
      notificationId: payload.notificationId || null,
      alertSound: false,
    },
  };

  // 1. Show native OS notification with standard vibration and device sound
  const showNotificationPromise = self.registration.showNotification(title, options).catch((err) => {
    console.warn("showNotification error with rich options, falling back:", err);
    return self.registration.showNotification(title, {
      body: options.body,
      icon: "/assets/teacher-azzeddine-charef.jpg",
      tag: "teacher-live-alert",
      requireInteraction: false,
      renotify: true,
      data: options.data,
    });
  });

  // 2. Broadcast to open windows/tabs to show clean in-app toast
  const broadcastPromise = self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      client.postMessage({
        type: "TEACHER_LIVE_ALERT",
        payload: {
          ...payload,
          notificationId: payload.notificationId,
        },
      });
    }
  }).catch(() => {});

  event.waitUntil(Promise.all([showNotificationPromise, broadcastPromise]));
});

// ── Notification click handler ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/student-live.html?alert=1";
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          try {
            client.postMessage({ type: "STOP_ALERT_SOUND" });
            if ("navigate" in client && !client.url.includes("student-live.html")) {
              client.navigate(fullTargetUrl);
            }
          } catch (_) {}
          return client.focus();
        }
      }
      return self.clients.openWindow(fullTargetUrl);
    })
  );
});

// ── Broadcast message receiver from client tabs ──
self.addEventListener("message", (event) => {
  if (event.data?.type === "STOP_ALERT_SOUND") {
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client !== event.source) {
          try { client.postMessage({ type: "STOP_ALERT_SOUND" }); } catch (_) {}
        }
      }
    });
  }
});


