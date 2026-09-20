/**
 * Minasaty - Plane Button Animation Controller
 * Provides smooth 3D origami paper plane takeoff and success state
 */
(function (global) {
  "use strict";

  function preparePlaneButton(button, { successText = "تم بنجاح", fastMode = false } = {}) {
    if (!button || button.dataset.planePrepared === "true") return button;
    button.dataset.planePrepared = "true";
    button.classList.add("btn-plane-interactive");
    if (fastMode) button.classList.add("fast-mode");

    const existingContent = button.querySelector(".btn-plane-content");
    if (!existingContent) {
      const originalHtml = button.innerHTML;
      button.innerHTML = `
        <span class="btn-plane-content">${originalHtml}</span>
        <span class="btn-plane-success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span class="success-label">${successText}</span>
        </span>
        <span class="plane-flying-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </span>
        <span class="plane-trail" aria-hidden="true"></span>
      `;
    }
    return button;
  }

  function triggerPlaneAnimation(button, {
    successText = null,
    successDuration = 1200,
    fastMode = false,
    onComplete = null
  } = {}) {
    if (!button) return;
    preparePlaneButton(button, { successText: successText || "تم بنجاح", fastMode });

    if (successText) {
      const successLabel = button.querySelector(".btn-plane-success .success-label");
      if (successLabel) successLabel.textContent = successText;
    }

    button.classList.remove("is-success");
    button.classList.add("is-flying");
    if (fastMode) button.classList.add("fast-mode");

    const flightTime = fastMode ? 480 : 820;

    window.setTimeout(() => {
      button.classList.remove("is-flying");
      button.classList.add("is-success");

      if (successDuration > 0) {
        window.setTimeout(() => {
          button.classList.remove("is-success");
          if (typeof onComplete === "function") onComplete();
        }, successDuration);
      } else if (typeof onComplete === "function") {
        onComplete();
      }
    }, flightTime);
  }

  global.PlaneButtonAnim = {
    prepare: preparePlaneButton,
    trigger: triggerPlaneAnimation,
  };
})(typeof window !== "undefined" ? window : globalThis);
