"use strict";

const fs = require("fs");
const path = require("path");

const GEMINI_CONFIG_FILE = path.join(__dirname, "../data/gemini-config.json");

let cachedApiKey = null;

function loadGeminiApiKey() {
  if (cachedApiKey !== null) {
    return cachedApiKey;
  }
  try {
    if (fs.existsSync(GEMINI_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(GEMINI_CONFIG_FILE, "utf8"));
      if (typeof data.apiKey === "string") {
        cachedApiKey = data.apiKey.trim();
        return cachedApiKey;
      }
    }
  } catch (err) {
    console.warn("[Gemini-Config] Failed to load gemini-config.json:", err.message);
  }

  // Fallback to environment variable if configured
  const envKey = (process.env.GEMINI_API_KEY || "").trim();
  cachedApiKey = envKey;
  return cachedApiKey;
}

function saveGeminiApiKey(apiKey) {
  const cleanKey = typeof apiKey === "string" ? apiKey.trim() : "";
  cachedApiKey = cleanKey;
  try {
    const dir = path.dirname(GEMINI_CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      GEMINI_CONFIG_FILE,
      JSON.stringify({ apiKey: cleanKey, updatedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
    return true;
  } catch (err) {
    console.error("[Gemini-Config] Failed to persist gemini-config.json:", err.message);
    return false;
  }
}

function getCleanMimeType(rawMime) {
  if (!rawMime) return "audio/webm";
  const base = rawMime.split(";")[0].trim().toLowerCase();
  if (base.includes("webm")) return "audio/webm";
  if (base.includes("mp4") || base.includes("m4a")) return "audio/mp4";
  if (base.includes("ogg")) return "audio/ogg";
  if (base.includes("wav")) return "audio/wav";
  if (base.includes("aac")) return "audio/aac";
  if (base.includes("mp3") || base.includes("mpeg")) return "audio/mp3";
  return base || "audio/webm";
}

async function transcribeAudioWithGemini({ audioBase64, mimeType = "audio/webm", lang = "ar" }) {
  const apiKey = loadGeminiApiKey();
  if (!apiKey) {
    throw new Error("لم يتم ضبط مفتاح Gemini API في إعدادات الأستاذ.");
  }
  if (!audioBase64) {
    throw new Error("الملف الصوتي مفقود أو فارغ.");
  }

  const cleanMime = getCleanMimeType(mimeType);
  const isFrench = String(lang).toLowerCase().startsWith("fr");
  const promptText = isFrench
    ? "Tu es un transcripteur audio professionnel. Transcris cet enregistrement audio mot à mot avec précision en français uniquement. Écris seulement le texte entendu, sans aucune introduction, sans commentaire et sans guillemets superflus."
    : "أنت مفرغ صوتي محترف. قم بتفريغ هذا التسجيل الصوتي بدقة تامة حرفياً باللغة العربية. اكتب النص المسموع فقط بدون أي مقدمات أو تعليقات أو شروحات أو علامات تنصيص زائدة.";

  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        let errorMsg = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(errorBody);
          if (parsed.error?.message) {
            errorMsg = parsed.error.message;
          }
        } catch (_) {}

        // If model not found (404), try next model
        if (response.status === 404) {
          lastError = new Error(`النموذج ${model} غير متوفر (${errorMsg})`);
          continue;
        }

        // Check for invalid API key
        if (response.status === 400 && errorMsg.includes("API key not valid")) {
          throw new Error("مفتاح Gemini API غير صالح، يرجى التحقق منه وتحديثه من إعدادات الأستاذ.");
        }

        throw new Error(`خطأ من Gemini API: ${errorMsg}`);
      }

      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return text.trim();
    } catch (err) {
      lastError = err;
      if (err.message.includes("مفتاح Gemini API غير صالح")) {
        throw err;
      }
    }
  }

  throw lastError || new Error("تعذر تفريغ الصوت عبر Gemini API.");
}

module.exports = {
  loadGeminiApiKey,
  saveGeminiApiKey,
  transcribeAudioWithGemini,
};
