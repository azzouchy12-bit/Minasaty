// alert-sound-player.js - Cleaned up and disabled per teacher request
(function () {
  "use strict";

  function cleanupAlertUI() {
    try {
      const banner = document.getElementById("live-alert-ringing-banner");
      if (banner) banner.remove();
      const prompt = document.getElementById("live-alert-prompt-banner");
      if (prompt) prompt.remove();
    } catch (_) {}
  }

  // Run cleanup immediately and on DOM ready
  cleanupAlertUI();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", cleanupAlertUI, { once: true });
  }

  window.minasatyAlertSoundPlayer = {
    start: function () {},
    stop: cleanupAlertUI,
  };
})();
