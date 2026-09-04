(() => {
  "use strict";

  const fallbackConfig = {
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    iceCandidatePoolSize: 10,
  };
  let cachedConfigPromise;

  function getToken(tokenOverride = "") {
    if (typeof tokenOverride === "string" && tokenOverride.trim()) return tokenOverride.trim();
    try {
      return sessionStorage.getItem("teacherToken")
        || sessionStorage.getItem("parentToken")
        || sessionStorage.getItem("studentToken")
        || "";
    } catch {
      return "";
    }
  }

  window.getMinasatyRtcConfig = function getMinasatyRtcConfig(tokenOverride = "") {
    if (cachedConfigPromise) return cachedConfigPromise;
    const token = getToken(tokenOverride);
    if (!token) {
      cachedConfigPromise = Promise.resolve(fallbackConfig);
      return cachedConfigPromise;
    }
    cachedConfigPromise = fetch("/api/webrtc/ice-servers", {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      credentials: "same-origin",
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!Array.isArray(payload?.iceServers) || !payload.iceServers.length) return fallbackConfig;
        return { iceServers: payload.iceServers, iceCandidatePoolSize: 10 };
      })
      .catch(() => fallbackConfig);
    return cachedConfigPromise;
  };

  // Fetch immediately so the credentials are normally ready before the first offer.
  void window.getMinasatyRtcConfig();
})();
