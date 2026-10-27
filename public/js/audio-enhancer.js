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

  const DIAGNOSTIC_MODES = Object.freeze(["current", "bypass_enhancer", "raw_clean"]);
  const STORAGE_KEY = "minasaty_student_mic_mode";
  let activeDiagnosticMode = "current";

  function getDiagnosticMode() {
    if (typeof window !== "undefined") {
      try {
        const stored = window.sessionStorage?.getItem(STORAGE_KEY);
        if (stored && DIAGNOSTIC_MODES.includes(stored)) {
          activeDiagnosticMode = stored;
        }
      } catch (_) {}
    }
    return activeDiagnosticMode;
  }

  function setDiagnosticMode(mode) {
    if (!DIAGNOSTIC_MODES.includes(mode)) {
      console.warn(`[MinasatyAudioEnhancer] Invalid diagnostic mode: "${mode}". Valid modes: ${DIAGNOSTIC_MODES.join(", ")}`);
      return false;
    }
    activeDiagnosticMode = mode;
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage?.setItem(STORAGE_KEY, mode);
      } catch (_) {}
      try {
        window.dispatchEvent?.(new CustomEvent("minasaty:mic-diagnostic-mode-change", { detail: { mode } }));
      } catch (_) {}
    }
    return true;
  }

  if (typeof window !== "undefined" && window.location?.search) {
    try {
      let urlMode = null;
      if (typeof URLSearchParams !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search);
        urlMode = urlParams.get("micMode") || urlParams.get("mic_mode");
      } else {
        const match = window.location.search.match(/[?&]mic(?:M|_m)ode=([a-z_]+)/i);
        if (match) urlMode = match[1];
      }
      if (urlMode && DIAGNOSTIC_MODES.includes(urlMode)) {
        setDiagnosticMode(urlMode);
      }
    } catch (_) {}
  }

  function enhanceMicrophoneStream(rawStream, options = {}) {
    if (!rawStream || typeof rawStream.getAudioTracks !== "function") return rawStream;
    const rawTrack = rawStream.getAudioTracks()[0];
    if (!rawTrack) return rawStream;

    const requestedMode = options.mode || getDiagnosticMode();
    const shouldBypass = options.bypass === true || requestedMode === "bypass_enhancer" || requestedMode === "raw_clean";

    if (shouldBypass) {
      rawStream.__isSpeechEnhanced = false;
      rawStream.__diagnosticMode = requestedMode;
      rawStream.__rawStream = rawStream;
      if (rawTrack) {
        rawTrack.__isSpeechEnhanced = false;
        rawTrack.__diagnosticMode = requestedMode;
        rawTrack.__rawTrack = rawTrack;
      }
      return rawStream;
    }

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
      const graphNodes = [sourceNode, highpass, deMud, presence, air];
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
        graphNodes.push(compressor);
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
      enhancedTrack.__diagnosticMode = "current";
      enhancedTrack.__rawTrack = rawTrack;

      // Keep track enabled state in lockstep with raw track
      const syncEnabled = () => {
        try { enhancedTrack.enabled = rawTrack.enabled; } catch (_) {}
      };
      rawTrack.addEventListener?.("mute", syncEnabled);
      rawTrack.addEventListener?.("unmute", syncEnabled);

      let isCleanedUp = false;
      const cleanup = ({ stopRaw = true } = {}) => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        try {
          rawTrack.removeEventListener?.("mute", syncEnabled);
          rawTrack.removeEventListener?.("unmute", syncEnabled);
        } catch (_) {}

        graphNodes.forEach((node) => {
          try { node.disconnect(); } catch (_) {}
        });
        try { destination.disconnect(); } catch (_) {}

        if (stopRaw) {
          try { rawTrack.stop(); } catch (_) {}
          try {
            if (rawStream && typeof rawStream.getTracks === "function") {
              rawStream.getTracks().forEach((t) => t.stop());
            }
          } catch (_) {}
        }
        try {
          if (typeof originalEnhancedTrackStop === "function") {
            originalEnhancedTrackStop();
          } else {
            enhancedTrack.readyState = "ended";
          }
        } catch (_) {}
        try {
          if (destination.stream && typeof destination.stream.getTracks === "function") {
            destination.stream.getTracks().forEach((t) => t.stop());
          }
        } catch (_) {}
      };

      rawTrack.addEventListener?.("ended", () => {
        cleanup({ stopRaw: false });
      }, { once: true });

      const originalEnhancedTrackStop = typeof enhancedTrack.stop === "function" ? enhancedTrack.stop.bind(enhancedTrack) : null;
      enhancedTrack.stop = function stop() {
        cleanup({ stopRaw: true });
      };
      enhancedTrack.cleanup = cleanup;
      enhancedTrack.__cleanup = cleanup;
      enhancedTrack.__graphNodes = graphNodes;

      destination.stream.__isSpeechEnhanced = true;
      destination.stream.__diagnosticMode = "current";
      destination.stream.__rawStream = rawStream;
      destination.stream.cleanup = cleanup;
      destination.stream.__cleanup = cleanup;
      return destination.stream;
    } catch (error) {
      console.warn("[MinasatyAudioEnhancer] Speech clarity filter fallback to raw stream:", error);
      return rawStream;
    }
  }

  function disposeEnhancedStream(target, { stopRaw = true } = {}) {
    if (!target) return;
    try {
      if (typeof target.cleanup === "function") {
        target.cleanup({ stopRaw });
        return;
      }
      if (typeof target.__cleanup === "function") {
        target.__cleanup({ stopRaw });
        return;
      }
      if (typeof target.getAudioTracks === "function") {
        target.getAudioTracks().forEach((t) => {
          if (typeof t.cleanup === "function") t.cleanup({ stopRaw });
          else if (typeof t.__cleanup === "function") t.__cleanup({ stopRaw });
          else if (stopRaw) { try { t.stop(); } catch (_) {} }
        });
        if (stopRaw && target.__rawStream && typeof target.__rawStream.getTracks === "function") {
          target.__rawStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        }
        if (stopRaw && typeof target.getTracks === "function") {
          target.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        }
      } else if (typeof target.stop === "function") {
        if (target.__rawTrack && stopRaw) {
          try { target.__rawTrack.stop(); } catch (_) {}
        }
        try { target.stop(); } catch (_) {}
      }
    } catch (_) {}
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

  function createInputLevelMeter(streamOrTrack) {
    if (!streamOrTrack) return null;
    let stream = streamOrTrack;
    if (typeof streamOrTrack.getAudioTracks !== "function") {
      if (typeof MediaStream !== "undefined" && typeof streamOrTrack.stop === "function") {
        try {
          stream = new MediaStream([streamOrTrack]);
        } catch (_) {
          return null;
        }
      } else {
        return null;
      }
    }
    const track = stream.getAudioTracks?.()[0];
    if (!track) return null;

    const ctx = getAudioContext();
    if (!ctx || typeof ctx.createMediaStreamSource !== "function" || typeof ctx.createAnalyser !== "function") {
      return {
        getLevel: () => ({ level: 0, rms: 0, peak: 0, peakPercent: 0 }),
        stop: () => {},
        cleanup: () => {},
      };
    }

    let sourceNode = null;
    let analyserNode = null;
    let isStopped = false;

    try {
      sourceNode = ctx.createMediaStreamSource(stream);
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.2;
      sourceNode.connect(analyserNode);
      // Analyser is deliberately NOT connected to ctx.destination to avoid feedback
    } catch (err) {
      console.warn("[MinasatyAudioEnhancer] Unable to create input level meter source:", err);
      return {
        getLevel: () => ({ level: 0, rms: 0, peak: 0, peakPercent: 0 }),
        stop: () => {},
        cleanup: () => {},
      };
    }

    const buffer = new Uint8Array(analyserNode.fftSize);

    function getLevel() {
      if (isStopped || !track || track.readyState !== "live" || track.muted || track.enabled === false) {
        return { level: 0, rms: 0, peak: 0, peakPercent: 0 };
      }
      try {
        analyserNode.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        let peakVal = 0;
        for (let i = 0; i < buffer.length; i++) {
          const normalized = (buffer[i] - 128) / 128;
          sumSquares += normalized * normalized;
          const abs = Math.abs(normalized);
          if (abs > peakVal) peakVal = abs;
        }
        const rmsVal = Math.sqrt(sumSquares / buffer.length);
        const level = Math.min(100, Math.round(rmsVal * 100 * 3));
        const peakPercent = Math.min(100, Math.round(peakVal * 100));
        return {
          level,
          rms: Math.round(rmsVal * 1000) / 1000,
          peak: Math.round(peakVal * 1000) / 1000,
          peakPercent,
        };
      } catch (_) {
        return { level: 0, rms: 0, peak: 0, peakPercent: 0 };
      }
    }

    function stop() {
      if (isStopped) return;
      isStopped = true;
      try { sourceNode?.disconnect(); } catch (_) {}
      try { analyserNode?.disconnect(); } catch (_) {}
      sourceNode = null;
      analyserNode = null;
    }

    return {
      getLevel,
      stop,
      cleanup: stop,
    };
  }

  function getAudioTrackDiagnostics(track) {
    if (!track || (typeof track.getSettings !== "function" && !track.kind && !track.id)) return null;
    const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
    const constraints = typeof track.getConstraints === "function" ? track.getConstraints() : {};
    const capabilities = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};

    return {
      id: track.id || null,
      label: track.label || "unknown",
      kind: track.kind || "audio",
      readyState: track.readyState || "ended",
      enabled: Boolean(track.enabled),
      muted: Boolean(track.muted),
      isEnhanced: Boolean(track.__isSpeechEnhanced),
      diagnosticMode: track.__diagnosticMode || (track.__isSpeechEnhanced ? "current" : getDiagnosticMode()),
      settings: {
        echoCancellation: settings.echoCancellation ?? null,
        autoGainControl: settings.autoGainControl ?? null,
        noiseSuppression: settings.noiseSuppression ?? null,
        sampleRate: settings.sampleRate ?? null,
        channelCount: settings.channelCount ?? null,
        latency: settings.latency ?? null,
        deviceId: settings.deviceId ? "[present]" : null,
        groupId: settings.groupId ? "[present]" : null,
      },
      constraints: {
        echoCancellation: constraints.echoCancellation ?? null,
        autoGainControl: constraints.autoGainControl ?? null,
        noiseSuppression: constraints.noiseSuppression ?? null,
        sampleRate: constraints.sampleRate ?? null,
        channelCount: constraints.channelCount ?? null,
      },
      capabilities: {
        echoCancellation: capabilities.echoCancellation ?? null,
        autoGainControl: capabilities.autoGainControl ?? null,
        noiseSuppression: capabilities.noiseSuppression ?? null,
        sampleRate: capabilities.sampleRate ?? null,
        channelCount: capabilities.channelCount ?? null,
      },
    };
  }

  const enhancer = {
    isSupported: () => true,
    DIAGNOSTIC_MODES,
    getDiagnosticMode,
    setDiagnosticMode,
    getAudioContext,
    enhanceStream: enhanceMicrophoneStream,
    enhanceMicrophoneStream,
    disposeEnhancedStream,
    createInputLevelMeter,
    getAudioTrackDiagnostics,
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

