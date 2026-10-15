(() => {
  "use strict";

  /**
   * Minasaty Intelligent Voice Enhancer (Layer 2)
   * In-browser voice filtering, presence equalization, and anti-clipping dynamics compression.
   *
   * Features:
   * 1. High-Pass Filter (85 Hz, Q=0.707): Cuts mechanical rumble, fan/AC drone, and low-frequency handling noise.
   * 2. Presence Peak Filter (3000 Hz, +2.5 dB, Q=1.0): Boosts speech clarity & consonant definition.
   * 3. Studio Dynamics Compressor (-24 dB threshold, 4:1 ratio, 3ms attack, 250ms release):
   *    - Fast attack clamps volume spikes & prevents clipping/distortion when shouting or near-mic.
   *    - Smooth release brings up soft whispered speech and sentence endings, preventing voice cutouts.
   * 4. Makeup Gain (1.15x): Normalizes speech energy to broadcast standard.
   */

  let sharedAudioContext = null;

  function getAudioContext() {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
      try {
        sharedAudioContext = new AudioCtx({ latencyHint: "interactive" });
      } catch (_) {
        try {
          sharedAudioContext = new AudioCtx();
        } catch (e) {
          console.warn("[AudioEnhancer] AudioContext initialization failed:", e);
          return null;
        }
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

    if (sharedAudioContext.state === "suspended" || sharedAudioContext.state === "interrupted") {
      sharedAudioContext.resume().catch(() => {});
    }

    return sharedAudioContext;
  }

  function enhanceMicrophoneStream(rawStream) {
    if (!rawStream || typeof rawStream.getAudioTracks !== "function") {
      return rawStream;
    }
    const rawTrack = rawStream.getAudioTracks()[0];
    if (!rawTrack) return rawStream;

    // If already enhanced, return as-is
    if (rawTrack.__enhancedByMinasaty) {
      return rawStream;
    }

    const ctx = getAudioContext();
    if (!ctx) {
      return rawStream;
    }

    try {
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      const sourceNode = ctx.createMediaStreamSource(rawStream);

      // 1. High-pass filter: strip frequencies below 85 Hz (AC hum, rumble, wind)
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 85;
      highpass.Q.value = 0.707;

      // 2. Vocal presence filter: enhance 3000 Hz for speech definition
      const presence = ctx.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.value = 3000;
      presence.Q.value = 1.0;
      presence.gain.value = 2.5;

      // 3. Studio dynamics compressor: anti-clipping & soft-syllable lifter
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 12;
      compressor.ratio.value = 4.0;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      // 4. Output leveler gain
      const makeupGain = ctx.createGain();
      makeupGain.gain.value = 1.15;

      // 5. Destination stream
      const destination = ctx.createMediaStreamDestination();

      // Connect pipeline
      sourceNode.connect(highpass);
      highpass.connect(presence);
      presence.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(destination);

      const enhancedStream = destination.stream;
      const enhancedTrack = enhancedStream.getAudioTracks()[0];

      if (enhancedTrack) {
        enhancedTrack.__enhancedByMinasaty = true;
        enhancedTrack.__rawStream = rawStream;
        if ("contentHint" in enhancedTrack) {
          enhancedTrack.contentHint = "speech";
        }

        // Clean up Web Audio graph when track is ended
        const cleanup = () => {
          try { sourceNode.disconnect(); } catch (_) {}
          try { highpass.disconnect(); } catch (_) {}
          try { presence.disconnect(); } catch (_) {}
          try { compressor.disconnect(); } catch (_) {}
          try { makeupGain.disconnect(); } catch (_) {}
          try { rawTrack.stop(); } catch (_) {}
        };

        rawTrack.addEventListener("ended", () => {
          try { enhancedTrack.stop(); } catch (_) {}
          cleanup();
        }, { once: true });

        enhancedTrack.addEventListener("ended", cleanup, { once: true });

        console.info("[AudioEnhancer] Microphone successfully enhanced with Studio Voice Filter & Anti-Clipping.");
        return enhancedStream;
      }
    } catch (err) {
      console.warn("[AudioEnhancer] Could not build enhancement graph; using direct mic stream:", err);
    }

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
      if (ctx && ctx.state === "suspended") {
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
    isSupported: () => Boolean(typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)),
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
