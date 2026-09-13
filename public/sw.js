"use strict";

const CACHE_NAME = "acadimia-pwa-v1";
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

  // Bypass socket.io, api routes, and video streams from service worker cache
  if (
    url.pathname.startsWith("/socket.io") ||
    url.pathname.startsWith("/api") ||
    url.pathname.includes("upload")
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
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch (_) {
    payload = { title: "منصة مِنَسَاتي", body: event.data.text() || "لديك إشعار جديد." };
  }

  const isLiveAlert = payload.type === "TEACHER_LIVE_ALERT";
  const title = payload.title || "منصة مِنَسَاتي";
  const options = {
    body: payload.body || "",
    icon: "/assets/icon-192.png",
    badge: "/assets/icon-192.png",
    tag: isLiveAlert ? "teacher-live-alert" : (payload.tag || "minasaty-notification"),
    requireInteraction: isLiveAlert,
    vibrate: isLiveAlert ? [300, 100, 300, 100, 300, 100, 300] : [200, 100, 200],
    data: {
      url: payload.link || "/",
      type: payload.type || "GENERAL",
      notificationId: payload.notificationId || null,
      alertSound: isLiveAlert,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).pathname === new URL(url, self.location.origin).pathname && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

