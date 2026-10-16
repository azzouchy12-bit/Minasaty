"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Telegram Question Photo: telegramService exports sendTelegramPhoto", () => {
  const telegramService = require("../services/telegramService");
  assert.equal(typeof telegramService.sendTelegramPhoto, "function", "sendTelegramPhoto must be an exported function");
});

test("Telegram Question Photo: liveChatController routes uploaded photos to Telegram Bot", () => {
  const controllerCode = fs.readFileSync(path.join(root, "controllers/liveChatController.js"), "utf8");
  assert.match(controllerCode, /sendTelegramPhoto/, "liveChatController must call sendTelegramPhoto");
  const serviceCode = fs.readFileSync(path.join(root, "services/telegramService.js"), "utf8");
  assert.match(serviceCode, /TELEGRAM_ADMIN_CHAT_ID/, "telegramService must configure TELEGRAM_ADMIN_CHAT_ID as destination");
});

test("Telegram Question Photo: server.js prohibits imageId from being broadcasted into live streaming socket", () => {
  const serverCode = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverCode, /imageId:\s*null/, "server.js must nullify imageId to prevent stream stuttering");
});

test("Telegram Question Photo: student-live.js routes photos to Telegram without socket overhead", () => {
  const studentLiveCode = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
  assert.match(studentLiveCode, /sendStudentQuestionPhotoToTelegram/, "student-live.js must define sendStudentQuestionPhotoToTelegram");
  assert.match(studentLiveCode, /elements\.questionImageInput\?\.addEventListener\("change",\s*\(\)\s*=>\s*\{[\s\S]*?sendStudentQuestionPhotoToTelegram/, "questionImageInput change event must trigger sendStudentQuestionPhotoToTelegram");
});

test("Telegram Question Photo: multer uses memoryStorage so photos are never saved to server disk", () => {
  const routesCode = fs.readFileSync(path.join(root, "routes/liveChatRoutes.js"), "utf8");
  assert.match(routesCode, /imageStorage\s*=\s*multer\.memoryStorage\(\)/, "liveChatRoutes must use multer.memoryStorage for question images");
  const controllerCode = fs.readFileSync(path.join(root, "controllers/liveChatController.js"), "utf8");
  assert.match(controllerCode, /cleanupOldLiveQuestionImagesOnDisk/, "liveChatController must include cleanup for disk images");
});
