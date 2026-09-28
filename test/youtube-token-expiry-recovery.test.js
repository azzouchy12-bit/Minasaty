const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { isInvalidGrantError } = require("../services/youtubeService");

test("isInvalidGrantError accurately detects Google token expiry and revocation errors", () => {
  assert.equal(isInvalidGrantError(null), false);
  assert.equal(isInvalidGrantError(new Error("Network timeout")), false);

  assert.equal(isInvalidGrantError(new Error("invalid_grant")), true);
  assert.equal(isInvalidGrantError(new Error("GaxiosError: invalid_grant")), true);
  assert.equal(isInvalidGrantError({ message: "invalid_grant", response: { data: { error: "invalid_grant" } } }), true);
  assert.equal(isInvalidGrantError({ message: "Request failed", response: { data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } } }), true);
  assert.equal(isInvalidGrantError(new Error("Token has been expired or revoked.")), true);
});

test("youtubeRoutes.js and teacher-live.html provide reconnect flow on invalid_grant", () => {
  const routesPath = path.join(__dirname, "..", "routes", "youtubeRoutes.js");
  const routes = fs.readFileSync(routesPath, "utf8");

  assert.ok(routes.includes("isInvalidGrantError"), "isInvalidGrantError must be imported and checked");
  assert.ok(routes.includes("isTokenExpired"), "isTokenExpired flag must be emitted in socket payload");
  assert.ok(routes.includes('router.post("/disconnect"'), "/disconnect endpoint must exist for manual reset");

  const liveHtmlPath = path.join(__dirname, "..", "public", "teacher-live.html");
  const liveHtml = fs.readFileSync(liveHtmlPath, "utf8");
  assert.ok(liveHtml.includes('id="youtube-modal-reconnect-btn"'), "youtube-modal-reconnect-btn must exist in modal actions");

  const liveJsPath = path.join(__dirname, "..", "public", "js", "teacher-live-v2.js");
  const liveJs = fs.readFileSync(liveJsPath, "utf8");
  assert.ok(liveJs.includes("youtubeModalReconnectBtn"), "youtubeModalReconnectBtn element must be bound");
  assert.ok(liveJs.includes("data.isTokenExpired"), "socket event must inspect isTokenExpired");
  assert.ok(liveJs.includes('elements.youtubeModalReconnectBtn.hidden = !isExpired'), "reconnect button must be shown when token is expired");
});
