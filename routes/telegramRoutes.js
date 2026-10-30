"use strict";

const crypto = require("crypto");
const express = require("express");
const prisma = require("../lib/prisma");
const { verifyToken, isTeacher } = require("../middleware/authMiddleware");
const {
  createTelegramLink,
  getTelegramBotStatus,
  getTelegramWebhookSecret,
  handleTelegramUpdate,
  getTeacherChatId,
  getTeacherUsername,
  createTeacherTelegramLink,
  checkTelegramBotUpdatesForTeacher,
  deleteTeacherTelegramChatId,
  saveTeacherTelegramChatId,
} = require("../services/telegramService");

const router = express.Router();

function requireParent(req, res, next) {
  if (req.user?.role !== "parent" || !req.user.phone) {
    return res.status(403).json({ error: "هذه العملية متاحة لحساب الولي فقط." });
  }
  return next();
}

router.get("/status", verifyToken, requireParent, async (req, res) => {
  const credential = await prisma.parentCredential.findUnique({
    where: { parentPhone: req.user.phone },
    select: { telegramChatId: true, telegramUsername: true, telegramLinkedAt: true },
  });
  const bot = getTelegramBotStatus();
  return res.json({
    configured: bot.configured,
    botUsername: bot.botUsername,
    linked: Boolean(credential?.telegramChatId),
    username: credential?.telegramUsername || null,
    linkedAt: credential?.telegramLinkedAt || null,
    message: bot.configured
      ? credential?.telegramChatId
        ? "حساب Telegram مرتبط بهذا الحساب."
        : "اربط Telegram لتصلك تنبيهات المنصة."
      : "ربط Telegram غير متاح حاليًا لأن Bot المنصة غير مهيأ.",
  });
});

router.post("/link/start", verifyToken, requireParent, async (req, res) => {
  const bot = getTelegramBotStatus();
  if (!bot.configured) {
    return res.status(503).json({
      error: "لم يتم إعداد Telegram Bot بعد. أضف TELEGRAM_BOT_TOKEN إلى إعدادات الخادم.",
      code: "TELEGRAM_NOT_CONFIGURED",
    });
  }
  try {
    const linkData = await createTelegramLink(req.user.phone);
    return res.json({
      ...linkData,
      instructions: "افتح الرابط واضغط Start. لا ترسل PIN حساب Minasaty إلى Telegram.",
    });
  } catch (error) {
    console.warn("Unable to create Telegram link:", error.message);
    return res.status(502).json({
      error: "تعذر الاتصال بـ Telegram حاليًا. حاول مرة أخرى لاحقًا.",
      code: "TELEGRAM_BOT_UNAVAILABLE",
    });
  }
});

router.delete("/link", verifyToken, requireParent, async (req, res) => {
  await prisma.parentCredential.update({
    where: { parentPhone: req.user.phone },
    data: {
      telegramChatId: null,
      telegramUsername: null,
      telegramLinkedAt: null,
      telegramLinkTokenHash: null,
      telegramLinkExpiresAt: null,
    },
  });
  return res.json({ linked: false, message: "تم فصل حساب Telegram عن حساب Minasaty." });
});

router.get("/teacher/status", verifyToken, isTeacher, async (_req, res) => {
  const bot = getTelegramBotStatus();
  const chatId = getTeacherChatId();
  const username = getTeacherUsername();
  return res.json({
    configured: bot.configured,
    botUsername: bot.botUsername,
    linked: Boolean(chatId),
    chatId: chatId || null,
    username: username || null,
    message: chatId ? "حساب الأستاذ مرتبط بـ Telegram." : "حساب الأستاذ غير مرتبط بـ Telegram.",
  });
});

router.post("/teacher/link/start", verifyToken, isTeacher, async (_req, res) => {
  const bot = getTelegramBotStatus();
  if (!bot.configured) {
    return res.status(503).json({
      error: "لم يتم إعداد Telegram Bot بعد. أضف TELEGRAM_BOT_TOKEN إلى إعدادات الخادم.",
      code: "TELEGRAM_NOT_CONFIGURED",
    });
  }
  try {
    const linkData = await createTeacherTelegramLink();
    return res.json({
      ...linkData,
      instructions: "افتح الرابط واضغط Start في تيليجرام لربط حساب الأستاذ.",
    });
  } catch (error) {
    console.warn("Unable to create teacher Telegram link:", error.message);
    return res.status(502).json({
      error: "تعذر الاتصال بـ Telegram حاليًا. حاول مرة أخرى لاحقًا.",
      code: "TELEGRAM_BOT_UNAVAILABLE",
    });
  }
});

router.post("/teacher/link/verify", verifyToken, isTeacher, async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const chatId = getTeacherChatId();
  if (chatId) {
    return res.json({ linked: true, chatId, username: getTeacherUsername() });
  }
  const checked = await checkTelegramBotUpdatesForTeacher(token);
  if (checked?.linked) {
    return res.json(checked);
  }
  return res.json({ linked: false, message: "بانتظار الضغط على Start في تيليجرام." });
});

router.delete("/teacher/link", verifyToken, isTeacher, async (_req, res) => {
  deleteTeacherTelegramChatId();
  return res.json({ linked: false, message: "تم فصل حساب Telegram عن حساب الأستاذ." });
});

router.post("/teacher/link/manual", verifyToken, isTeacher, async (req, res) => {
  const chatId = String(req.body?.chatId || "").trim();
  if (!chatId || !/^-?\d+$/.test(chatId)) {
    return res.status(400).json({ error: "معرف المحادثة (Chat ID) غير صالح." });
  }
  saveTeacherTelegramChatId({ chatId, username: String(req.body?.username || "").trim() });
  return res.json({ linked: true, chatId, message: "تم حفظ معرف التيليجرام للأستاذ بنجاح." });
});

router.post("/webhook", async (req, res) => {
  const suppliedSecret = String(req.get("x-telegram-bot-api-secret-token") || "");
  const expectedSecret = String(getTelegramWebhookSecret() || "");
  const secretsMatch = suppliedSecret.length === expectedSecret.length
    && expectedSecret.length > 0
    && crypto.timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(expectedSecret));
  if (!secretsMatch) {
    return res.status(403).json({ error: "Webhook غير مصرح." });
  }
  await handleTelegramUpdate(req.body);
  return res.sendStatus(200);
});

module.exports = router;
