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

  function enhanceMicrophoneStream(rawStream, options = {}) {
    if (!rawStream || typeof rawStream.getAudioTracks !== "function") return rawStream;
    const rawTrack = rawStream.getAudioTracks()[0];
    if (!rawTrack) return rawStream;

    const ctx = getAudioContext();
    if (
      !ctx ||
      typeof ctx.createMediaStreamSource !== "function" ||
      typeof ctx.createMediaStreamDestination !== "function" ||
      typeof ctx.createBiquadFilter !== "function"
    ) {
      // Clean fallback for environments without Web Audio graph capabilities
      return rawStream;
    }

    try {
      if (ctx.state === "suspended" || ctx.state === "interrupted") {
        ctx.resume().catch(() => {});
      }

      // Avoid double-wrapping an already enhanced stream
      if (rawStream.__isSpeechEnhanced || rawTrack.__isSpeechEnhanced) {
        return rawStream;
      }

      const sourceNode = ctx.createMediaStreamSource(rawStream);

      // 1. High-Pass Filter (Low Cut at 85 Hz): Removes mechanical thumps, desk vibrations, wind/breath rumble
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.setValueAtTime(85, ctx.currentTime);
      highpass.Q.setValueAtTime(0.707, ctx.currentTime);

      // 2. Anti-Muffle Notch (Peaking at 320 Hz, -2.5dB, Q: 1.0):
      // Cleans out the boxy / barrel resonance that causes voices to sound muffled ("صوت مغموم") on mobile mics
      const deMud = ctx.createBiquadFilter();
      deMud.type = "peaking";
      deMud.frequency.setValueAtTime(320, ctx.currentTime);
      deMud.gain.setValueAtTime(-2.5, ctx.currentTime);
      deMud.Q.setValueAtTime(1.0, ctx.currentTime);

      // 3. Speech Clarity & Vocal Consonant Articulation (Peaking at 3200 Hz, +3.5dB, Q: 1.2):
      // Essential for Arabic phonetics & intelligibility: brings out consonants (ت، ث، س، ش، ك، ف)
      const presence = ctx.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.setValueAtTime(3200, ctx.currentTime);
      presence.gain.setValueAtTime(3.5, ctx.currentTime);
      presence.Q.setValueAtTime(1.2, ctx.currentTime);

      // 4. Subtle Air Polish (High Shelf at 7500 Hz, +1.5dB):
      // Restores open, natural sound to compressed speech without harshness
      const air = ctx.createBiquadFilter();
      air.type = "highshelf";
      air.frequency.setValueAtTime(7500, ctx.currentTime);
      air.gain.setValueAtTime(1.5, ctx.currentTime);

      // 5. Soft-Knee Voice Leveler:
      // Smoothly lifts whisper-quiet students and protects against clipping when students shout
      let outputNode = air;
      if (typeof ctx.createDynamicsCompressor === "function") {
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-18, ctx.currentTime);
        compressor.knee.setValueAtTime(12, ctx.currentTime);
        compressor.ratio.setValueAtTime(2.2, ctx.currentTime);
        compressor.attack.setValueAtTime(0.003, ctx.currentTime);
        compressor.release.setValueAtTime(0.12, ctx.currentTime);

        sourceNode.connect(highpass);
        highpass.connect(deMud);
        deMud.connect(presence);
        presence.connect(air);
        air.connect(compressor);
        outputNode = compressor;
      } else {
        sourceNode.connect(highpass);
        highpass.connect(deMud);
        deMud.connect(presence);
        presence.connect(air);
      }

      const destination = ctx.createMediaStreamDestination();
      outputNode.connect(destination);

      const enhancedTrack = destination.stream.getAudioTracks()[0];
      if (!enhancedTrack) return rawStream;

      enhancedTrack.contentHint = "speech";
      enhancedTrack.enabled = rawTrack.enabled;
      enhancedTrack.__isSpeechEnhanced = true;
      enhancedTrack.__rawTrack = rawTrack;

      // Keep track enabled state in lockstep with raw track
      const syncEnabled = () => {
        try { enhancedTrack.enabled = rawTrack.enabled; } catch (_) {}
      };
      rawTrack.addEventListener?.("mute", syncEnabled);
      rawTrack.addEventListener?.("unmute", syncEnabled);
      rawTrack.addEventListener?.("ended", () => {
        try { enhancedTrack.stop(); } catch (_) {}
      }, { once: true });

      destination.stream.__isSpeechEnhanced = true;
      destination.stream.__rawStream = rawStream;
      return destination.stream;
    } catch (error) {
      console.warn("[MinasatyAudioEnhancer] Speech clarity filter fallback to raw stream:", error);
      return rawStream;
    }
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

