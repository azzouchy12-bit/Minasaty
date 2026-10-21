(() => {
  "use strict";

  /**
   * Minasaty Clean Audio Layer
   * Pure native pass-through ensuring zero distortion, zero compressor pumping,
   * and clean autoplay unlock.
   */

  let sharedAudioContext = null;

  function getAudioContext() {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
      try {
        sharedAudioContext = new AudioCtx();
      } catch (_) {
        return null;
      }
    }

    if (sharedAudioContext && !sharedAudioContext.__stateChangeBound && typeof sharedAudioContext.addEventListener === "function") {
      sharedAudioContext.__stateChangeBound = true;
      try {
        sharedAudioContext.addEventListener("statechange", () => {
          if (sharedAudioContext?.state === "suspended" || sharedAudioContext?.state === "interrupted") {
            sharedAudioContext.resume().catch(() => {});
          }
        });
      } catch (_) {}
    }

    return sharedAudioContext;
  }

  function enhanceMicrophoneStream(rawStream) {
    // Pure clean native pass-through without artificial compressors or distortion
    return rawStream;
  }

  function unlockAudioContext(ctx) {
    if (!ctx) ctx = getAudioContext();
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === "running") return Promise.resolve(true);
    return ctx.resume().then(() => ctx.state === "running").catch(() => false);
  }

  function armAutoplayUnlock(callback) {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const trigger = () => {
      const ctx = getAudioContext();
      if (ctx && (ctx.state === "suspended" || ctx.state === "interrupted")) {
        ctx.resume().catch(() => {});
      }
      if (typeof callback === "function") {
        try { callback(); } catch (_) {}
      }
      events.forEach((ev) => {
        try {
          window.removeEventListener(ev, trigger, true);
          document.removeEventListener(ev, trigger, true);
        } catch (_) {}
      });
    };
    const events = ["touchstart", "touchend", "pointerdown", "click", "keydown"];
    events.forEach((ev) => {
      try {
        window.addEventListener(ev, trigger, { capture: true, passive: true });
        document.addEventListener(ev, trigger, { capture: true, passive: true });
      } catch (_) {}
    });
  }

  const enhancer = {
    isSupported: () => true,
    getAudioContext,
    enhanceStream: enhanceMicrophoneStream,
    enhanceMicrophoneStream,
    unlockAudioContext,
    armAutoplayUnlock,
  };

  if (typeof window !== "undefined") {
    window.MinasatyAudioEnhancer = enhancer;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = enhancer;
  }
})();

