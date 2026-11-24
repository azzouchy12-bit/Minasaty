const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Voice Dictation: AndroidManifest includes RECORD_AUDIO permission", () => {
  const manifestPath = path.join(__dirname, "../android/app/src/main/AndroidManifest.xml");
  assert.ok(fs.existsSync(manifestPath), "AndroidManifest.xml exists");
  const content = fs.readFileSync(manifestPath, "utf8");
  assert.ok(content.includes('android.permission.RECORD_AUDIO'), "RECORD_AUDIO permission is defined");
});

test("Voice Dictation: geminiAudioService exports core functions", () => {
  const service = require("../services/geminiAudioService");
  assert.equal(typeof service.loadGeminiApiKey, "function");
  assert.equal(typeof service.saveGeminiApiKey, "function");
  assert.equal(typeof service.transcribeAudioWithGemini, "function");
});

test("Voice Dictation: classroomSessions propagates geminiApiKey in publicInfo", () => {
  const { ClassroomSessions } = require("../utils/classroomSessions");
  const sessions = new ClassroomSessions();
  assert.equal(typeof sessions.updateAllGeminiApiKeys, "function");
  
  const testKey = "AIzaSyTest_Key_12345";
  sessions.updateAllGeminiApiKeys(testKey);
  
  const info = sessions.publicInfo("السنة الأولى");
  assert.ok("geminiApiKey" in info, "publicInfo includes geminiApiKey property");
});

test("Voice Dictation: Desktop teacher UI includes settings modal, mic button, and scripts", () => {
  const htmlPath = path.join(__dirname, "../public/teacher-live.html");
  const content = fs.readFileSync(htmlPath, "utf8");

  assert.ok(content.includes("chat-voice-dictation.css"), "Links chat-voice-dictation.css");
  assert.ok(content.includes('id="studio-settings-btn"'), "Has settings button in topbar");
  assert.ok(content.includes('id="studio-settings-modal"'), "Has studio settings modal");
  assert.ok(content.includes('id="gemini-api-key-input"'), "Has Gemini API key input field");
  assert.ok(content.includes('id="save-gemini-key-btn"'), "Has save button");
  assert.ok(content.includes('id="chat-mic-btn"'), "Has chat mic button");
  assert.ok(content.includes('id="chat-lang-btn"'), "Has chat lang button");
  assert.ok(content.includes("chat-voice-dictation.js"), "Includes chat-voice-dictation.js script");
});

test("Voice Dictation: Mobile teacher UI includes settings button, modal, mic button, and scripts", () => {
  const htmlPath = path.join(__dirname, "../public/teacher-live-mobile.html");
  const content = fs.readFileSync(htmlPath, "utf8");

  assert.ok(content.includes("chat-voice-dictation.css"), "Links chat-voice-dictation.css");
  assert.ok(content.includes('id="tm-settings-btn"'), "Has mobile settings button");
  assert.ok(content.includes('id="tm-settings-modal"'), "Has mobile settings modal");
  assert.ok(content.includes('id="tm-gemini-api-key-input"'), "Has mobile Gemini API key input field");
  assert.ok(content.includes('id="tm-gemini-key-save-btn"'), "Has mobile save button");
  assert.ok(content.includes('id="tm-chat-mic-btn"'), "Has mobile chat mic button");
  assert.ok(content.includes('id="tm-chat-lang-btn"'), "Has mobile chat lang button");
  assert.ok(content.includes("chat-voice-dictation.js"), "Includes chat-voice-dictation.js script");
});

test("Voice Dictation: Student UI includes desktop & mobile mic controls and scripts", () => {
  const htmlPath = path.join(__dirname, "../public/student-live.html");
  const content = fs.readFileSync(htmlPath, "utf8");

  assert.ok(content.includes("chat-voice-dictation.css"), "Links chat-voice-dictation.css");
  assert.ok(content.includes('id="student-chat-mic-btn"'), "Has mobile student chat mic button");
  assert.ok(content.includes('id="student-chat-lang-btn"'), "Has mobile student chat lang button");
  assert.ok(content.includes('id="desktop-chat-mic-btn"'), "Has desktop student chat mic button");
  assert.ok(content.includes('id="desktop-chat-lang-btn"'), "Has desktop student chat lang button");
  assert.ok(content.includes("chat-voice-dictation.js"), "Includes chat-voice-dictation.js script");
});

test("Voice Dictation: liveChatRoutes defines gemini-config and transcribe-audio endpoints", () => {
  const routesPath = path.join(__dirname, "../routes/liveChatRoutes.js");
  const content = fs.readFileSync(routesPath, "utf8");

  assert.ok(content.includes('"/gemini-config"'), "Defines /gemini-config route");
  assert.ok(content.includes('"/transcribe-audio"'), "Defines /transcribe-audio route");
});

test("Voice Dictation: server.js handles teacher_update_gemini_key socket event", () => {
  const serverPath = path.join(__dirname, "../server.js");
  const content = fs.readFileSync(serverPath, "utf8");

  assert.ok(content.includes("teacher_update_gemini_key"), "server.js registers teacher_update_gemini_key");
  assert.ok(content.includes("gemini_key_updated"), "server.js broadcasts gemini_key_updated");
});
