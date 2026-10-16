"use strict";

const crypto = require("crypto");
const prisma = require("../lib/prisma");

const TELEGRAM_REQUEST_TIMEOUT_MS = 8_000;
const TELEGRAM_MAX_TEXT_LENGTH = 4_000;
const TELEGRAM_LINK_TOKEN_TTL_MS = 10 * 60 * 1000;
let cachedTelegramBotUsername = "";

function getTelegramConfig() {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
  return {
    botToken,
    chatId,
    botConfigured: Boolean(botToken),
    configured: Boolean(botToken && chatId),
    missing: [!botToken && "TELEGRAM_BOT_TOKEN", !chatId && "TELEGRAM_ADMIN_CHAT_ID"].filter(Boolean),
  };
}

function getTelegramWebhookSecret() {
  const configuredSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (configuredSecret) return configuredSecret;
  const token = getTelegramConfig().botToken;
  return token ? crypto.createHash("sha256").update(token).digest("hex") : "";
}

function getTelegramStatus() {
  const config = getTelegramConfig();
  return {
    configured: config.configured,
    botConfigured: config.botConfigured,
    missing: config.missing,
    message: config.configured
      ? "تنبيهات Telegram مهيأة."
      : "تنبيهات Telegram غير مفعّلة — بانتظار بيانات البوت والمحادثة.",
  };
}

function getTelegramBotStatus() {
  const config = getTelegramConfig();
  return {
    configured: config.botConfigured,
    botUsername: cachedTelegramBotUsername || String(process.env.TELEGRAM_BOT_USERNAME || "").trim(),
    message: config.botConfigured
      ? "Telegram Bot مهيأ."
      : "Telegram Bot غير مهيأ.",
  };
}

function telegramText(title, body = "") {
  return [`[Minasaty] ${String(title || "تنبيه المنصة").trim()}`, String(body || "").trim()]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, TELEGRAM_MAX_TEXT_LENGTH);
}

async function telegramApi(method, body = {}) {
  const { botToken } = getTelegramConfig();
  if (!botToken) return { ok: false, skipped: true, reason: "TELEGRAM_NOT_CONFIGURED" };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      const error = new Error(`TELEGRAM_HTTP_${response.status}`);
      error.telegramDescription = String(payload.description || "").slice(0, 500);
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureTelegramBotUsername() {
  const configuredName = String(process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
  if (configuredName) {
    cachedTelegramBotUsername = configuredName;
    return cachedTelegramBotUsername;
  }
  if (cachedTelegramBotUsername) return cachedTelegramBotUsername;
  const payload = await telegramApi("getMe");
  cachedTelegramBotUsername = String(payload.result?.username || "").trim().replace(/^@/, "");
  return cachedTelegramBotUsername;
}

async function createTelegramLink(parentPhone) {
  const botUsername = await ensureTelegramBotUsername();
  if (!botUsername) throw new Error("TELEGRAM_BOT_USERNAME_UNAVAILABLE");

  const rawToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MS);
  await prisma.parentCredential.update({
    where: { parentPhone },
    data: { telegramLinkTokenHash: tokenHash, telegramLinkExpiresAt: expiresAt },
  });
  return {
    link: `https://t.me/${encodeURIComponent(botUsername)}?start=${encodeURIComponent(rawToken)}`,
    expiresAt,
  };
}

async function sendTelegramMessage({ chatId, title, body, text, replyMarkup } = {}) {
  if (!chatId) return { sent: false, configured: getTelegramConfig().botConfigured, skipped: true, reason: "TELEGRAM_CHAT_NOT_LINKED" };
  const payload = await telegramApi("sendMessage", {
    chat_id: String(chatId),
    text: String(text || telegramText(title, body)).slice(0, TELEGRAM_MAX_TEXT_LENGTH),
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  return { sent: true, configured: true, messageId: payload.result?.message_id || null };
}

async function sendTelegramNotification({ title, body, text } = {}) {
  const config = getTelegramConfig();
  if (!config.configured) return { sent: false, configured: false, skipped: true, reason: "TELEGRAM_NOT_CONFIGURED" };
  return sendTelegramMessage({ chatId: config.chatId, title, body, text });
}

async function sendTelegramPhoto({ chatId, photoBuffer, filename = "question.jpg", mimeType = "image/jpeg", caption = "" } = {}) {
  const config = getTelegramConfig();
  const targetChatId = chatId || config.chatId;
  if (!config.botToken || !targetChatId) {
    return { sent: false, configured: false, skipped: true, reason: "TELEGRAM_NOT_CONFIGURED" };
  }

  if (!photoBuffer) {
    return { sent: false, error: "NO_PHOTO_PROVIDED" };
  }

  const formData = new FormData();
  formData.append("chat_id", String(targetChatId));
  if (caption) {
    formData.append("caption", String(caption).slice(0, 1024));
  }
  formData.append("photo", new Blob([photoBuffer], { type: mimeType }), filename);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendPhoto`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      const error = new Error(`TELEGRAM_HTTP_${response.status}`);
      error.telegramDescription = String(payload.description || "").slice(0, 500);
      throw error;
    }
    return { sent: true, configured: true, messageId: payload.result?.message_id || null };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendTelegramToParent(parentPhone, payload = {}) {
  const credential = await prisma.parentCredential.findUnique({
    where: { parentPhone: String(parentPhone || "") },
    select: { telegramChatId: true },
  });
  if (!credential?.telegramChatId) {
    return { sent: false, configured: getTelegramConfig().botConfigured, skipped: true, reason: "TELEGRAM_PARENT_NOT_LINKED" };
  }
  return sendTelegramMessage({ chatId: credential.telegramChatId, ...payload });
}

async function handleTelegramUpdate(update = {}) {
  const message = update?.message;
  const chatId = String(message?.chat?.id || "");
  if (!message || !chatId || message.chat?.type !== "private") return { handled: false, reason: "TELEGRAM_PRIVATE_CHAT_ONLY" };

  const text = String(message.text || "").trim();
  const startMatch = text.match(/^\/start(?:@[^\s]+)?\s+([^\s]+)$/i);
  if (startMatch) {
    const tokenHash = crypto.createHash("sha256").update(startMatch[1]).digest("hex");
    const credential = await prisma.parentCredential.findFirst({
      where: { telegramLinkTokenHash: tokenHash, telegramLinkExpiresAt: { gt: new Date() } },
      select: { parentPhone: true },
    });
    if (!credential) {
      await sendTelegramMessage({ chatId, text: "رابط ربط Telegram غير صالح أو انتهت صلاحيته. ابدأ طلب ربط جديد من حسابك في Minasaty." });
      return { handled: true, linked: false, reason: "TELEGRAM_LINK_TOKEN_INVALID" };
    }
    try {
      await prisma.parentCredential.update({
        where: { parentPhone: credential.parentPhone },
        data: {
          telegramChatId: chatId,
          telegramUsername: message.from?.username ? String(message.from.username).slice(0, 120) : null,
          telegramLinkedAt: new Date(),
          telegramLinkTokenHash: null,
          telegramLinkExpiresAt: null,
        },
      });
    } catch (error) {
      if (error?.code === "P2002") {
        await sendTelegramMessage({ chatId, text: "هذا الحساب في Telegram مرتبط بحساب Minasaty آخر. افصل الربط القديم أولًا." });
        return { handled: true, linked: false, reason: "TELEGRAM_CHAT_ALREADY_LINKED" };
      }
      throw error;
    }
    await sendTelegramMessage({ chatId, text: "تم ربط Telegram بحساب Minasaty بنجاح. ستصلك تنبيهات الحصص والرسائل المهمة هنا." });
    return { handled: true, linked: true, parentPhone: credential.parentPhone };
  }

  if (/^\/unlink(?:@[^\s]+)?$/i.test(text)) {
    await prisma.parentCredential.updateMany({
      where: { telegramChatId: chatId },
      data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
    });
    await sendTelegramMessage({ chatId, text: "تم فصل Telegram عن حساب Minasaty." });
    return { handled: true, linked: false, unlinked: true };
  }

  if (/^\/start(?:@[^\s]+)?$/i.test(text)) {
    await sendTelegramMessage({ chatId, text: "لربط حسابك، افتح زر «ربط Telegram» من إعدادات حسابك في Minasaty ثم اضغط Start من الرابط الخاص بك." });
    return { handled: true, linked: false, reason: "TELEGRAM_LINK_REQUIRED" };
  }

  return { handled: true, linked: false, reason: "TELEGRAM_UPDATE_IGNORED" };
}

async function configureTelegramWebhook() {
  const config = getTelegramConfig();
  if (!config.botConfigured) return { configured: false, skipped: true, reason: "TELEGRAM_NOT_CONFIGURED" };
  const baseUrl = String(process.env.APP_BASE_URL || process.env.CLIENT_ORIGIN || "").trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl)) return { configured: true, skipped: true, reason: "TELEGRAM_BASE_URL_MISSING" };
  return telegramApi("setWebhook", {
    url: `${baseUrl}/api/telegram/webhook`,
    secret_token: getTelegramWebhookSecret(),
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
}

function notifyTelegram(req, payload) {
  const sender = req?.app?.get("sendTelegramNotification");
  if (typeof sender !== "function") return Promise.resolve({ sent: false, configured: false, skipped: true, reason: "TELEGRAM_SENDER_UNAVAILABLE" });
  return Promise.resolve(sender(payload)).catch((error) => {
    console.warn("Optional Telegram notification failed:", error.message);
    return { sent: false, configured: true, skipped: true, reason: "TELEGRAM_SEND_FAILED" };
  });
}

module.exports = {
  getTelegramConfig,
  getTelegramStatus,
  getTelegramBotStatus,
  getTelegramWebhookSecret,
  createTelegramLink,
  sendTelegramNotification,
  sendTelegramPhoto,
  sendTelegramToParent,
  handleTelegramUpdate,
  configureTelegramWebhook,
  notifyTelegram,
};
