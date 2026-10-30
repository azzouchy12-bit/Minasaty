"use strict";

const telegramToken = sessionStorage.getItem("parentToken") || "";
const telegramApi = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${telegramToken}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "تعذر تنفيذ عملية Telegram.");
  return data;
};

const telegramElements = {
  card: document.getElementById("telegram-card"),
  badge: document.getElementById("telegram-status-badge"),
  text: document.getElementById("telegram-status-text"),
  start: document.getElementById("telegram-link-start"),
  remove: document.getElementById("telegram-link-remove"),
  instructions: document.getElementById("telegram-link-instructions"),
};

function setTelegramState({ linked = false, configured = true, username = "", linkedAt = null, message = "" } = {}) {
  if (!telegramElements.card) return;
  telegramElements.badge.textContent = linked ? "مرتبط" : configured ? "غير مرتبط" : "غير متاح";
  telegramElements.badge.classList.toggle("is-connected", linked);
  telegramElements.badge.classList.toggle("is-unavailable", !configured);
  telegramElements.text.textContent = message || (linked
    ? `تم ربط Telegram${username ? ` (@${username})` : ""}${linkedAt ? ` منذ ${new Date(linkedAt).toLocaleString("ar-DZ")}` : ""}.`
    : configured
      ? "اربط Telegram لتصلك تنبيهات الحصص والرسائل المهمة من المنصة."
      : "ربط Telegram غير متاح حاليًا لأن Bot المنصة غير مهيأ.");
  telegramElements.start.hidden = linked || !configured;
  telegramElements.remove.hidden = !linked;
}

async function loadTelegramStatus() {
  try {
    const data = await telegramApi("/api/telegram/status");
    setTelegramState(data);
  } catch (error) {
    setTelegramState({ configured: true, message: error.message });
  }
}

telegramElements.start?.addEventListener("click", async () => {
  telegramElements.start.disabled = true;
  telegramElements.instructions.hidden = true;
  try {
    const data = await telegramApi("/api/telegram/link/start", { method: "POST", body: "{}" });
    telegramElements.instructions.textContent = `${data.instructions} الرابط صالح حتى ${new Date(data.expiresAt).toLocaleTimeString("ar-DZ")}.`;
    telegramElements.instructions.hidden = false;
    if (data.link) {
      window.location.href = data.link;
    }
  } catch (error) {
    telegramElements.text.textContent = error.message;
  } finally {
    telegramElements.start.disabled = false;
  }
});

telegramElements.remove?.addEventListener("click", async () => {
  if (!window.confirm("هل تريد فصل Telegram عن حساب Minasaty؟")) return;
  telegramElements.remove.disabled = true;
  try {
    const data = await telegramApi("/api/telegram/link", { method: "DELETE" });
    telegramElements.instructions.hidden = true;
    setTelegramState({ configured: true, message: data.message });
  } catch (error) {
    telegramElements.text.textContent = error.message;
  } finally {
    telegramElements.remove.disabled = false;
  }
});

if (telegramToken) void loadTelegramStatus();
else setTelegramState({ configured: true, message: "انتهت الجلسة. سجّل الدخول أولًا." });
