(() => {
  "use strict";

  const fallbackConfig = Object.freeze({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    iceCandidatePoolSize: 10,
  });

  let cachedRtcConfig = null; // { config, expiresAt, isFallback }
  let inFlightRtcPromise = null;
  const sfuInFlightMap = new Map(); // key -> Promise

  const REQUEST_TIMEOUT_MS = 7_000;

  function getToken(tokenOverride = "") {
    if (typeof tokenOverride === "string" && tokenOverride.trim()) return tokenOverride.trim();
    try {
      const sess = typeof sessionStorage !== "undefined" ? sessionStorage : null;
      const loc = typeof localStorage !== "undefined" ? localStorage : null;
      return (
        sess?.getItem?.("teacherToken") ||
        loc?.getItem?.("teacherToken") ||
        sess?.getItem?.("parentToken") ||
        loc?.getItem?.("parentToken") ||
        sess?.getItem?.("studentToken") ||
        loc?.getItem?.("studentToken") ||
        ""
      );
    } catch {
      return "";
    }
  }

  function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer = null;
    if (controller) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
      options.signal = controller.signal;
    }
    return fetch(url, options).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  window.getMinasatyRtcConfig = function getMinasatyRtcConfig(tokenOverride = "") {
    const token = getToken(tokenOverride);

    // If we have an existing non-fallback config that is still fresh, reuse it
    if (cachedRtcConfig && !cachedRtcConfig.isFallback) {
      const nowSec = Math.floor(Date.now() / 1000);
      // Refresh credentials if expiring within 3 minutes
      if (!cachedRtcConfig.expiresAt || nowSec < cachedRtcConfig.expiresAt - 180) {
        return Promise.resolve(cachedRtcConfig.config);
      }
    }

    // Deduplicate concurrent requests
    if (inFlightRtcPromise) {
      return inFlightRtcPromise;
    }

    if (!token) {
      // Do not cache STUN fallback permanently. When the user logs in, the next call will fetch TURN.
      return Promise.resolve(fallbackConfig);
    }

    inFlightRtcPromise = fetchWithTimeout("/api/webrtc/ice-servers", {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      credentials: "same-origin",
    }, REQUEST_TIMEOUT_MS)
      .then((response) => {
        if (!response.ok) {
          console.warn(`[WebRTC-ICE] ICE endpoint responded with HTTP ${response.status}; using transient STUN fallback.`);
          return null;
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload?.iceServers) || !payload.iceServers.length) {
          console.warn("[WebRTC-ICE] Invalid ICE servers payload from server; using transient STUN fallback.");
          return fallbackConfig;
        }
        const config = { iceServers: payload.iceServers, iceCandidatePoolSize: 10 };
        const expiresAt = typeof payload.expiresAt === "number" ? payload.expiresAt : 0;
        cachedRtcConfig = { config, expiresAt, isFallback: false };
        return config;
      })
      .catch((err) => {
        const isTimeout = err?.name === "AbortError";
        console.warn(`[WebRTC-ICE] Failed to fetch ICE servers (${isTimeout ? "timeout" : "network error"}); will retry on next request.`);
        return fallbackConfig;
      })
      .finally(() => {
        inFlightRtcPromise = null;
      });

    return inFlightRtcPromise;
  };

  window.getMinasatySfuConnectOptions = async function getMinasatySfuConnectOptions() {
    const config = await window.getMinasatyRtcConfig();
    const hasTurn = config?.iceServers?.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => /^turns?:/i.test(String(url || ""))) &&
        Boolean(server.username && server.credential);
    });
    // Without an authenticated relay, retain LiveKit's server-provided ICE configuration.
    if (!hasTurn) return {};
    return { rtcConfig: { iceServers: config.iceServers }, peerConnectionTimeout: 25000 };
  };

  window.fetchMinasatySfuToken = async function fetchMinasatySfuToken(roomName, allowMic = false, tokenOverride = "", studentIdOverride = "") {
    const token = getToken(tokenOverride);
    if (!token || !roomName) {
      if (!token) console.warn("[SFU-Token] Cannot fetch token: missing auth token.");
      if (!roomName) console.warn("[SFU-Token] Cannot fetch token: roomName is required.");
      return null;
    }

    const resolvedStudentId = String(
      studentIdOverride ||
      (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("studentId") : "") ||
      (typeof window !== "undefined" && window.currentStudent?.id ? window.currentStudent.id : "") ||
      ""
    ).trim();

    const sessionId = window.minasatyClassroomSession?.level === roomName
      ? window.minasatyClassroomSession.sessionId : null;
    const inFlightKey = `${roomName}_${sessionId || ""}_${Boolean(allowMic)}_${resolvedStudentId}`;
    if (sfuInFlightMap.has(inFlightKey)) {
      return sfuInFlightMap.get(inFlightKey);
    }

    const sfuPromise = (async () => {
      try {
        const payload = { roomName, allowMic };
        if (sessionId) payload.sessionId = sessionId;
        if (resolvedStudentId) {
          payload.studentId = resolvedStudentId;
        }

        const response = await fetchWithTimeout("/api/webrtc/sfu-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          credentials: "same-origin",
        }, 8_000);

        if (!response.ok) {
          console.warn(`[SFU-Token] Server rejected token request with status ${response.status} for room "${roomName}".`);
          return null;
        }
        const data = await response.json();
        if (!data || data.status !== "success" || !data.token) {
          if (data && data.enabled === false) {
            return { enabled: false };
          }
          console.warn("[SFU-Token] Received malformed or disabled SFU token response.");
          return null;
        }
        return data;
      } catch (err) {
        const isTimeout = err?.name === "AbortError";
        console.warn(`[SFU-Token] Failed to fetch SFU token (${isTimeout ? "timeout" : "network error"}).`);
        return null;
      } finally {
        sfuInFlightMap.delete(inFlightKey);
      }
    })();

    sfuInFlightMap.set(inFlightKey, sfuPromise);
    return sfuPromise;
  };

  // Fetch immediately if token is available so credentials are ready before the first offer.
  void window.getMinasatyRtcConfig();
})();

