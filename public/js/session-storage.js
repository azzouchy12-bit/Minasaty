"use strict";

(() => {
  const persistentKeys = new Set([
    "teacherToken",
    "teacherAuth",
    "parentToken",
    "parentPhone",
    "referralCode",
    "referralLink",
    "userRole",
    "forceParentPinChange",
    "selectedStudentId",
    "parentStudents",
    "studentName",
    "level",
    "studentLevel",
    "studentId",
    "currentStudent",
    "currentStudentName",
    "currentStudentLevel",
    "loggedInStudent",
    "student",
  ]);

  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  persistentKeys.forEach((key) => {
    const sessionValue = originalGetItem.call(sessionStorage, key);
    const localValue = originalGetItem.call(localStorage, key);
    if (sessionValue === null && localValue !== null) {
      originalSetItem.call(sessionStorage, key, localValue);
    }
  });

  function notifyNativeBridgeUser() {
    try {
      if (window.MinasatyNative?.registerStudentUser) {
        const phone = originalGetItem.call(localStorage, "parentPhone") || originalGetItem.call(sessionStorage, "parentPhone") || "";
        const studentId = originalGetItem.call(localStorage, "studentId") || originalGetItem.call(sessionStorage, "studentId") || "";
        const studentName = originalGetItem.call(localStorage, "studentName") || originalGetItem.call(sessionStorage, "studentName") || "";
        const level = originalGetItem.call(localStorage, "level") || originalGetItem.call(sessionStorage, "level") || "";
        if (phone || studentId) {
          window.MinasatyNative.registerStudentUser(phone, studentId, studentName, level);
        }
      }
    } catch (_) {}
  }
  window.notifyNativeBridgeUser = notifyNativeBridgeUser;

  // Auto-sync on script execution
  setTimeout(notifyNativeBridgeUser, 600);

  Storage.prototype.setItem = function setItem(key, value) {
    originalSetItem.call(this, key, value);
    if (this === sessionStorage && persistentKeys.has(key)) {
      originalSetItem.call(localStorage, key, value);
    }
    if (key === "parentPhone" || key === "studentId" || key === "studentLevel" || key === "level") {
      notifyNativeBridgeUser();
    }
  };

  Storage.prototype.removeItem = function removeItem(key) {
    originalRemoveItem.call(this, key);
    if (this === sessionStorage && persistentKeys.has(key)) {
      originalRemoveItem.call(localStorage, key);
    }
  };

  Storage.prototype.getItem = function getItem(key) {
    const value = originalGetItem.call(this, key);
    if (this === sessionStorage && value === null && persistentKeys.has(key)) {
      return originalGetItem.call(localStorage, key);
    }
    return value;
  };

  window.enablePushNotifications = async function enablePushNotifications({ requestPermission = true } = {}) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("هذا المتصفح لا يدعم إشعارات الهاتف.");
    if (!window.isSecureContext) throw new Error("تفعيل التنبيهات يحتاج إلى اتصال HTTPS.");
    const token = sessionStorage.getItem("teacherToken") || sessionStorage.getItem("parentToken") || "";
    const parentPhone = sessionStorage.getItem("parentPhone") || localStorage.getItem("parentPhone") || "";
    const studentId = sessionStorage.getItem("studentId") || localStorage.getItem("studentId") || "";
    const level = sessionStorage.getItem("level") || sessionStorage.getItem("studentLevel") || "";

    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    let publicKey = "";

    // Fetch public key
    if (!subscription) {
      const fetchHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      const keyResponse = await fetch("/api/push/public-key", { headers: fetchHeaders });
      const keyData = await keyResponse.json().catch(() => ({}));
      if (!keyResponse.ok || !keyData.publicKey) throw new Error(keyData.error || "إشعارات الهاتف غير مفعلة بعد.");
      publicKey = keyData.publicKey;
    }

    let permission = Notification.permission;
    if (permission !== "granted") {
      if (permission === "denied") throw new Error("لم يسمح المتصفح بإشعارات الهاتف. غيّر الإذن من إعدادات الموقع ثم حاول مرة أخرى.");
      if (!requestPermission) throw new Error("لم يتم طلب إذن التنبيهات بعد.");
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") throw new Error("لم تسمح بإشعارات الهاتف.");

    if (!subscription) {
      const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
      const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const applicationServerKey = Uint8Array.from(atob(paddedBase64), (char) => char.charCodeAt(0));
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }

    const postHeaders = { "Content-Type": "application/json" };
    if (token) postHeaders["Authorization"] = `Bearer ${token}`;

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify({
        ...subscription.toJSON(),
        parentPhone,
        studentId,
        level,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر تفعيل الإشعارات.");
    return data;
  };

  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
    if (Notification.permission === "granted") {
      window.setTimeout(() => {
        if (typeof window.enablePushNotifications === "function") {
          window.enablePushNotifications({ requestPermission: false }).catch(() => {});
        }
      }, 400);
    }
  }

  window.revokeServerSession = function revokeServerSession() {
    const token = sessionStorage.getItem("teacherToken") || sessionStorage.getItem("parentToken");
    if (!token) return Promise.resolve();
    return fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      keepalive: true,
    }).catch(() => {});
  };

  const sessionCheckIntervalMs = 3000;
  let sessionRedirecting = false;

  function clearLocalAuthState() {
    [
      "teacherToken",
      "teacherAuth",
      "parentToken",
      "parentPhone",
      "userRole",
      "forceParentPinChange",
      "selectedStudentId",
      "parentStudents",
      "studentName",
      "level",
      "studentLevel",
      "studentId",
      "currentStudent",
      "currentStudentName",
      "currentStudentLevel",
      "loggedInStudent",
      "student",
    ].forEach((key) => {
      sessionStorage.removeItem(key);
    });
  }

  window.handleSessionTakeover = function handleSessionTakeover() {
    clearLocalAuthState();
    window.location.replace("/index.html?session=takeover");
  };

  async function checkActiveSession() {
    if (sessionRedirecting) return;
    const token = sessionStorage.getItem("teacherToken") || sessionStorage.getItem("parentToken");
    if (!token) return;

    try {
      const response = await fetch("/api/auth/session-status", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (response.ok) return;
      // 428 means the parent must complete the PIN-change flow; do not replace
      // that intentional redirect with the single-session redirect.
      if (response.status === 428) return;
      if (response.status !== 401 && response.status !== 403) return;

      sessionRedirecting = true;
      clearLocalAuthState();
      window.location.replace("/index.html?session=revoked");
    } catch {
      // A temporary network error must not log the user out. The next poll
      // will retry, while the server remains the source of truth.
    }
  }

  if (sessionStorage.getItem("teacherToken") || sessionStorage.getItem("parentToken")) {
    window.setTimeout(checkActiveSession, 1500);
    window.setInterval(checkActiveSession, sessionCheckIntervalMs);
  }
})();
