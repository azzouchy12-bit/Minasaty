/**
 * chat-voice-dictation.js
 * ميزة الإملاء الصوتي الذكي (تحويل الصوت إلى نص) للدردشة للأستاذ والتلميذ
 * 
 * - الأولوية الأولى: SpeechRecognition المباشر في المتصفح (Chrome الحاسوب والأندرويد) - مجاني وبدون استهلاك API.
 * - الأولوية الثانية: MediaRecorder + Gemini Flash API المجاني (عبر المفتاح المحفوظ من إعدادات الأستاذ)
 *   للأجهزة والتطبيقات التي لا تدعم Web Speech API كالهواتف وتطبيق المنصة (WebView).
 */

(function (window, document) {
  "use strict";

  // In-memory key store for the active classroom
  window.__classroomGeminiKey = window.__classroomGeminiKey || "";

  // Helper to get active Gemini API key
  function getGeminiApiKey() {
    return (
      window.__classroomGeminiKey ||
      sessionStorage.getItem("classroomGeminiKey") ||
      localStorage.getItem("classroomGeminiKey") ||
      ""
    );
  }

  function setGeminiApiKey(key) {
    const clean = typeof key === "string" ? key.trim() : "";
    window.__classroomGeminiKey = clean;
    if (clean) {
      sessionStorage.setItem("classroomGeminiKey", clean);
    } else {
      sessionStorage.removeItem("classroomGeminiKey");
    }
  }

  // Audio blob to base64 converter
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function getCleanMimeType(rawMime) {
    if (!rawMime) return "audio/webm";
    const base = rawMime.split(";")[0].trim().toLowerCase();
    if (base.includes("webm")) return "audio/webm";
    if (base.includes("mp4") || base.includes("m4a")) return "audio/mp4";
    if (base.includes("ogg")) return "audio/ogg";
    if (base.includes("wav")) return "audio/wav";
    if (base.includes("aac")) return "audio/aac";
    if (base.includes("mp3")) return "audio/mp3";
    return base || "audio/webm";
  }

  /**
   * Call Gemini API directly or via server fallback
   */
  async function transcribeWithGemini({ audioBlob, lang = "ar" }) {
    const apiKey = getGeminiApiKey();
    const rawMime = audioBlob.type || "audio/webm";
    const cleanMime = getCleanMimeType(rawMime);
    const audioBase64 = await blobToBase64(audioBlob);

    const isFrench = String(lang).toLowerCase().startsWith("fr");
    const promptText = isFrench
      ? "Tu es un transcripteur audio professionnel. Transcris cet enregistrement audio mot à mot avec précision en français uniquement. Écris seulement le texte entendu, sans aucune introduction, sans commentaire et sans guillemets superflus."
      : "أنت مفرغ صوتي محترف. قم بتفريغ هذا التسجيل الصوتي بدقة تامة حرفياً باللغة العربية. اكتب النص المسموع فقط بدون أي مقدمات أو تعليقات أو شروحات أو علامات تنصيص زائدة.";

    // 1. Try direct browser call to Gemini if API key is present
    if (apiKey) {
      const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const payload = {
            contents: [
              {
                parts: [
                  { text: promptText },
                  {
                    inlineData: {
                      mimeType: cleanMime,
                      data: audioBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          };

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (text.trim()) {
              return text.trim();
            }
          } else if (response.status === 404) {
            continue; // try next model
          } else {
            console.warn(`[Gemini-Voice] Direct call failed with status ${response.status}`);
          }
        } catch (fetchErr) {
          console.warn("[Gemini-Voice] Direct call network exception, falling back to server:", fetchErr.message);
          break; // Fall back to server endpoint
        }
      }
    }

    // 2. Try server-side proxy endpoint
    try {
      const token =
        sessionStorage.getItem("teacherToken") ||
        localStorage.getItem("teacherToken") ||
        sessionStorage.getItem("parentToken") ||
        localStorage.getItem("parentToken") ||
        "";

      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/live-chat/transcribe-audio", {
        method: "POST",
        headers,
        body: JSON.stringify({
          audioBase64,
          mimeType: cleanMime,
          lang: isFrench ? "fr" : "ar",
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.text) {
          return json.text.trim();
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "تعذر تفريغ الصوت عبر الخادم.");
      }
    } catch (serverErr) {
      if (!apiKey) {
        throw new Error("يرجى من الأستاذ إدخال مفتاح Gemini API في إعدادات الاستوديو (⚙️) لتفعيل الإملاء الصوتي.");
      }
      throw serverErr;
    }

    throw new Error("لم يتم التعرف على أي كلام في التسجيل.");
  }

  /**
   * Initialize voice dictation on any chat input
   *
   * @param {Object} options
   * @param {HTMLElement} options.inputEl - The textarea or input element
   * @param {HTMLElement} options.micBtn - The microphone button
   * @param {HTMLElement} options.langBtn - The language toggle button
   * @param {HTMLElement} [options.container] - Optional parent container
   * @param {Function} [options.onStatus] - Status message callback
   */
  function setupChatVoiceDictation(options) {
    const { inputEl, micBtn, langBtn, onStatus } = options || {};
    if (!inputEl || !micBtn) return null;

    let currentLang = "ar"; // "ar" | "fr"
    let isRecording = false;
    let isTranscribing = false;
    let speechRecognition = null;
    let mediaRecorder = null;
    let audioStream = null;
    let audioChunks = [];
    let initialTextBeforeRecord = "";
    let interimTranscript = "";

    // Check Web Speech API support
    const SpeechRecognitionClass =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      window.mozSpeechRecognition ||
      window.msSpeechRecognition;

    const hasSpeechRecognition = Boolean(SpeechRecognitionClass);

    // Update language button display
    function updateLangBtnUI() {
      if (!langBtn) return;
      if (currentLang === "ar") {
        langBtn.textContent = "عربي";
        langBtn.setAttribute("aria-label", "لغة الإملاء: العربية (اضغط للتبديل إلى الفرنسية)");
        langBtn.title = "لغة الإملاء: العربية (اضغط للتبديل إلى الفرنسية FR)";
        langBtn.classList.remove("is-french");
      } else {
        langBtn.textContent = "FR";
        langBtn.setAttribute("aria-label", "لغة الإملاء: الفرنسية (اضغط للتبديل إلى العربية)");
        langBtn.title = "Langue: Français (Cliquez pour passer à l'Arabe)";
        langBtn.classList.add("is-french");
      }
    }

    if (langBtn) {
      langBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isRecording) {
          stopRecording();
        }
        currentLang = currentLang === "ar" ? "fr" : "ar";
        updateLangBtnUI();
        if (typeof onStatus === "function") {
          onStatus(currentLang === "ar" ? "تم ضبط لغة الإملاء على: العربية" : "Langue réglée sur : Français");
        }
      });
      updateLangBtnUI();
    }

    function setRecordingUI(active) {
      isRecording = active;
      if (active) {
        micBtn.classList.add("is-recording");
        micBtn.classList.remove("is-transcribing");
        micBtn.setAttribute("aria-pressed", "true");
        micBtn.setAttribute("aria-label", "جارٍ الاستماع والتسجيل... اضغط للإيقاف");
        micBtn.title = "جارٍ الاستماع... اضغط للإيقاف";
      } else {
        micBtn.classList.remove("is-recording");
        micBtn.setAttribute("aria-pressed", "false");
        micBtn.setAttribute("aria-label", "بدء الإملاء الصوتي");
        micBtn.title = "بدء الإملاء الصوتي (تحويل الصوت إلى نص)";
      }
    }

    function setTranscribingUI(active) {
      isTranscribing = active;
      if (active) {
        micBtn.classList.add("is-transcribing");
        micBtn.classList.remove("is-recording");
        micBtn.disabled = true;
        micBtn.setAttribute("aria-label", "جارٍ تفريغ الصوت وتحويله إلى نص...");
        micBtn.title = "جارٍ تحويل الصوت إلى نص عبر الذكاء الاصطناعي...";
      } else {
        micBtn.classList.remove("is-transcribing");
        micBtn.disabled = false;
        micBtn.setAttribute("aria-label", "بدء الإملاء الصوتي");
        micBtn.title = "بدء الإملاء الصوتي (تحويل الصوت إلى نص)";
      }
    }

    function insertTranscriptIntoInput(text) {
      if (!text) return;
      const separator = initialTextBeforeRecord && !initialTextBeforeRecord.endsWith(" ") ? " " : "";
      inputEl.value = (initialTextBeforeRecord ? initialTextBeforeRecord + separator : "") + text;
      // Dispatch events so send button and parent forms update state
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      // Auto-grow textarea if handler exists
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
    }

    // Tier 1: Web Speech API start
    function startSpeechRecognition() {
      try {
        const recognition = new SpeechRecognitionClass();
        speechRecognition = recognition;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = currentLang === "fr" ? "fr-FR" : "ar-DZ";

        initialTextBeforeRecord = inputEl.value.trim();
        interimTranscript = "";

        recognition.onstart = () => {
          setRecordingUI(true);
          if (typeof onStatus === "function") {
            onStatus(currentLang === "fr" ? "Écoute en cours..." : "جارٍ الاستماع...");
          }
        };

        recognition.onresult = (event) => {
          let final = "";
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              final += transcript;
            } else {
              interim += transcript;
            }
          }
          const currentText = final || interim;
          if (currentText) {
            insertTranscriptIntoInput(currentText);
          }
        };

        recognition.onerror = (event) => {
          console.warn("[Voice-Dictation] SpeechRecognition error:", event.error);
          // If browser speech recognition is not allowed or fails due to network/service (common on WebView)
          if (
            event.error === "service-not-allowed" ||
            event.error === "not-allowed" ||
            event.error === "network" ||
            event.error === "audio-capture"
          ) {
            // Gracefully fall back to Tier 2 (MediaRecorder + Gemini)
            console.info("[Voice-Dictation] Falling back to MediaRecorder + Gemini...");
            stopSpeechRecognition();
            startMediaRecorderFallback();
            return;
          }
          setRecordingUI(false);
        };

        recognition.onend = () => {
          setRecordingUI(false);
          speechRecognition = null;
        };

        recognition.start();
      } catch (err) {
        console.warn("[Voice-Dictation] SpeechRecognition start failed, falling back to MediaRecorder:", err);
        startMediaRecorderFallback();
      }
    }

    function stopSpeechRecognition() {
      if (speechRecognition) {
        try {
          speechRecognition.stop();
        } catch (_) {}
        speechRecognition = null;
      }
      setRecordingUI(false);
    }

    // Tier 2: MediaRecorder + Gemini
    async function startMediaRecorderFallback() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("المتصفح لا يدعم تسجيل الصوت.");
        }

        initialTextBeforeRecord = inputEl.value.trim();
        audioChunks = [];

        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        // Determine best supported MIME type
        let mimeType = "";
        const mimeCandidates = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/mp4",
          "audio/aac",
          "audio/ogg;codecs=opus",
        ];
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported) {
          for (const cand of mimeCandidates) {
            if (MediaRecorder.isTypeSupported(cand)) {
              mimeType = cand;
              break;
            }
          }
        }

        const options = mimeType ? { mimeType } : undefined;
        mediaRecorder = new MediaRecorder(audioStream, options);

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunks.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          setRecordingUI(false);
          // Stop media tracks
          if (audioStream) {
            audioStream.getTracks().forEach((track) => track.stop());
            audioStream = null;
          }

          if (audioChunks.length === 0) return;

          const recordedBlob = new Blob(audioChunks, {
            type: mediaRecorder?.mimeType || mimeType || "audio/webm",
          });

          // Process with Gemini API
          setTranscribingUI(true);
          if (typeof onStatus === "function") {
            onStatus(currentLang === "fr" ? "Transcription en cours via Gemini..." : "جارٍ تحويل الصوت إلى نص عبر الذكاء الاصطناعي...");
          }

          try {
            const transcript = await transcribeWithGemini({
              audioBlob: recordedBlob,
              lang: currentLang,
            });

            if (transcript) {
              insertTranscriptIntoInput(transcript);
              if (typeof onStatus === "function") {
                onStatus(currentLang === "fr" ? "Texte dicté avec succès ✓" : "تم تفريغ الصوت بنجاح ✓");
              }
            }
          } catch (err) {
            console.error("[Voice-Dictation] Gemini transcription error:", err);
            const msg = err.message || "تعذر تحويل الصوت إلى نص.";
            if (typeof onStatus === "function") {
              onStatus(msg, "error");
            } else {
              alert(msg);
            }
          } finally {
            setTranscribingUI(false);
          }
        };

        mediaRecorder.start(250);
        setRecordingUI(true);
        if (typeof onStatus === "function") {
          onStatus(currentLang === "fr" ? "Enregistrement en cours... Cliquez pour terminer" : "جارٍ التسجيل... اضغط على الميكروفون مرة أخرى عند الانتهاء");
        }

        // Auto stop after 60 seconds
        setTimeout(() => {
          if (isRecording && mediaRecorder && mediaRecorder.state === "recording") {
            stopRecording();
          }
        }, 60000);
      } catch (err) {
        console.error("[Voice-Dictation] MediaRecorder setup error:", err);
        setRecordingUI(false);
        const errMsg = err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "يرجى السماح بالوصول إلى الميكروفون لاستخدام الإملاء الصوتي."
          : (err.message || "تعذر فتح الميكروفون.");
        if (typeof onStatus === "function") {
          onStatus(errMsg, "error");
        } else {
          alert(errMsg);
        }
      }
    }

    function stopMediaRecorder() {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try {
          mediaRecorder.stop();
        } catch (_) {}
      }
      if (audioStream) {
        try {
          audioStream.getTracks().forEach((track) => track.stop());
        } catch (_) {}
        audioStream = null;
      }
    }

    function startRecording() {
      if (isRecording || isTranscribing) return;
      // Priority 1: SpeechRecognition (in Chrome PC / Android Chrome)
      if (hasSpeechRecognition) {
        startSpeechRecognition();
      } else {
        // Priority 2: MediaRecorder + Gemini Flash
        startMediaRecorderFallback();
      }
    }

    function stopRecording() {
      if (!isRecording) return;
      if (speechRecognition) {
        stopSpeechRecognition();
      }
      if (mediaRecorder && mediaRecorder.state === "recording") {
        stopMediaRecorder();
      }
      setRecordingUI(false);
    }

    micBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isTranscribing) return;
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    });

    return {
      start: startRecording,
      stop: stopRecording,
      setLanguage: (lang) => {
        currentLang = lang === "fr" ? "fr" : "ar";
        updateLangBtnUI();
      },
      getLanguage: () => currentLang,
    };
  }

  // Auto-listen to Socket.io events for Gemini key update
  function attachSocketGeminiListener(socket) {
    if (!socket || typeof socket.on !== "function") return;

    socket.on("gemini_key_updated", (data = {}) => {
      if (typeof data.apiKey === "string") {
        setGeminiApiKey(data.apiKey);
        console.info("[Voice-Dictation] Classroom Gemini key updated via Socket.io");
      }
    });

    socket.on("room_joined", (data = {}) => {
      if (typeof data.geminiApiKey === "string" && data.geminiApiKey) {
        setGeminiApiKey(data.geminiApiKey);
      }
    });

    socket.on("room_ready", (data = {}) => {
      if (typeof data.geminiApiKey === "string" && data.geminiApiKey) {
        setGeminiApiKey(data.geminiApiKey);
      }
    });
  }

  window.ChatVoiceDictation = {
    setup: setupChatVoiceDictation,
    getGeminiApiKey,
    setGeminiApiKey,
    attachSocketListener: attachSocketGeminiListener,
    transcribeWithGemini,
  };
})(window, document);
