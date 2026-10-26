const Sentry = require("@sentry/node");

const dsn = (process.env.SENTRY_DSN || "").trim();
const isSentryEnabled = Boolean(dsn);

if (isSentryEnabled) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    ignoreErrors: [
      "ECONNRESET",
      "EPIPE",
      "ECANCELED",
      "Request aborted",
    ],
  });
  console.info(`[Sentry] Initialized for Node.js backend (Environment: ${process.env.NODE_ENV || "development"})`);
} else {
  console.info("[Sentry] SENTRY_DSN is not configured; backend error monitoring is dormant.");
}

module.exports = {
  Sentry,
  isSentryEnabled,
};
