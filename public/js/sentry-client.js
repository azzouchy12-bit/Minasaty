/**
 * sentry-client.js
 * Client-side Sentry error monitoring & Session Replay integration for Minasaty.
 * 
 * Automatically initializes Sentry when a DSN is provided via /api/sentry/config
 * or window.MINASATY_SENTRY_DSN.
 * Gracefully remains dormant if no DSN is configured, introducing zero overhead.
 */
(() => {
  "use strict";

  const SENTRY_CDN_URL = "https://browser.sentry-cdn.com/8.54.0/bundle.tracing.replay.min.js";

  function getCurrentUserContext() {
    try {
      const sess = typeof sessionStorage !== "undefined" ? sessionStorage : null;
      const loc = typeof localStorage !== "undefined" ? localStorage : null;

      const teacherToken = sess?.getItem?.("teacherToken") || loc?.getItem?.("teacherToken");
      if (teacherToken) return { role: "teacher" };

      const studentToken = sess?.getItem?.("studentToken") || loc?.getItem?.("studentToken");
      const studentName = sess?.getItem?.("studentName") || loc?.getItem?.("studentName");
      const studentLevel = sess?.getItem?.("studentLevel") || loc?.getItem?.("studentLevel");
      if (studentToken || studentName) {
        return {
          role: "student",
          username: studentName || undefined,
          level: studentLevel || undefined,
        };
      }

      const parentToken = sess?.getItem?.("parentToken") || loc?.getItem?.("parentToken");
      if (parentToken) return { role: "parent" };
    } catch {
      // Storage access blocked or restricted
    }
    return null;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        return resolve();
      }
      const script = document.createElement("script");
      script.src = src;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve();
      script.onerror = (err) => reject(err);
      document.head.appendChild(script);
    });
  }

  async function initSentry() {
    try {
      let dsn = window.MINASATY_SENTRY_DSN || null;
      let environment = "development";

      if (!dsn) {
        const response = await fetch("/api/sentry/config", { credentials: "same-origin" }).catch(() => null);
        if (response && response.ok) {
          const config = await response.json().catch(() => null);
          if (config?.enabled && config?.dsn) {
            dsn = config.dsn;
            environment = config.environment || "production";
          }
        }
      }

      if (!dsn) {
        // Dormant mode: define window.reportToSentry as a safe console fallback
        window.reportToSentry = (err, context) => {
          if (window.console && typeof window.console.warn === "function") {
            console.warn("[Sentry Dormant] Captured error:", err, context);
          }
        };
        return;
      }

      // Load SDK if not already bundled
      if (!window.Sentry) {
        await loadScript(SENTRY_CDN_URL);
      }

      if (!window.Sentry || typeof window.Sentry.init !== "function") {
        return;
      }

      const integrations = [];
      if (typeof window.Sentry.browserTracingIntegration === "function") {
        integrations.push(window.Sentry.browserTracingIntegration());
      }
      if (typeof window.Sentry.replayIntegration === "function") {
        integrations.push(
          window.Sentry.replayIntegration({
            maskAllText: false,
            blockAllMedia: false,
          })
        );
      }

      window.Sentry.init({
        dsn,
        environment,
        integrations,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.05,
        replaysOnErrorSampleRate: 1.0, // 100% replay capture upon errors
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "ResizeObserver loop completed with undelivered notifications",
          "Non-Error promise rejection captured",
          "AbortError: The play() request was interrupted",
        ],
      });

      const user = getCurrentUserContext();
      if (user) {
        window.Sentry.setUser(user);
      }

      window.reportToSentry = (err, context = {}) => {
        if (!window.Sentry) return;
        window.Sentry.withScope((scope) => {
          if (context.tags) scope.setTags(context.tags);
          if (context.extra) scope.setExtras(context.extra);
          window.Sentry.captureException(err);
        });
      };

      console.info("[Sentry] Client monitoring initialized successfully.");
    } catch (e) {
      // Prevent monitoring setup errors from affecting the main application
      console.warn("[Sentry] Failed to initialize client monitoring:", e);
    }
  }

  // Initialize after page is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSentry, { once: true });
  } else {
    initSentry();
  }
})();
