const { configured, saveSubscription, removeSubscription, getPublicKey: getPublicKeyUtil } = require("../utils/push");
const { saveFcmDeviceToken, removeFcmDeviceToken } = require("../utils/fcm");

function normalizeDigits(value, maxDigits = 10) {
  return String(value || "")
    .replace(/[^\d]/g, "")
    .slice(0, maxDigits);
}

function recipientFromUser(user, body = {}) {
  if (user?.role === "teacher") return { role: "teacher", id: "teacher" };
  if (user?.role === "parent" && user.phone) return { role: "parent", id: user.phone };
  if (user?.role === "student") return { role: "student", id: user.id || user.studentId || user.phone || "student" };
  if (body.parentPhone) return { role: "parent", id: normalizeDigits(body.parentPhone, 10) };
  if (body.studentId) return { role: "student", id: String(body.studentId).trim() };
  if (body.recipientRole && body.recipientId) return { role: String(body.recipientRole).trim(), id: String(body.recipientId).trim() };
  return { role: "student", id: "all_students" };
}

async function getPublicKey(_req, res) {
  const publicKey = getPublicKeyUtil();
  if (!publicKey) {
    return res.status(503).json({ error: "إشعارات الهاتف غير مفعلة بعد." });
  }
  return res.json({ publicKey });
}

async function subscribe(req, res) {
  try {
    const recipient = recipientFromUser(req.user, req.body);
    const subscriptionData = req.body?.subscription || req.body;
    if (!subscriptionData?.endpoint) {
      return res.status(400).json({ error: "بيانات اشتراك Push غير مكتملة." });
    }
    await saveSubscription(recipient.role, recipient.id, subscriptionData, req.user?.sessionId || null);
    return res.status(201).json({ status: "success", message: "تم تفعيل إشعارات الهاتف بنجاح." });
  } catch (error) {
    return res.status(400).json({ error: error.message || "تعذر تفعيل الإشعارات." });
  }
}

async function unsubscribe(req, res) {
  try {
    if (!req.body?.endpoint) return res.status(400).json({ error: "عنوان الاشتراك غير موجود." });
    await removeSubscription(req.body.endpoint);
    return res.json({ status: "success" });
  } catch {
    return res.status(500).json({ error: "تعذر إلغاء إشعارات الهاتف." });
  }
}

async function registerFcmToken(req, res) {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "رمز جهاز الأندرويد مطلوب." });
    }
    const recipient = recipientFromUser(req.user, req.body);
    const platform = String(req.body?.platform || "android");
    await saveFcmDeviceToken(recipient.role, recipient.id, token, platform);
    return res.status(201).json({ status: "success", message: "تم تسجيل جهاز الأندرويد للتنبيه الفوري بنجاح." });
  } catch (error) {
    return res.status(400).json({ error: error.message || "تعذر تسجيل جهاز الأندرويد." });
  }
}

module.exports = { getPublicKey, subscribe, unsubscribe, registerFcmToken };

