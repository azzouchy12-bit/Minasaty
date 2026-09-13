const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const prisma = require("../lib/prisma");

let cachedVapid = null;

function getVapidDetails() {
  if (cachedVapid) return cachedVapid;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cachedVapid = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT || "mailto:admin@minasaty.dz",
    };
    return cachedVapid;
  }

  const vapidFilePath = path.join(__dirname, "../data/vapid.json");
  try {
    if (fs.existsSync(vapidFilePath)) {
      const data = JSON.parse(fs.readFileSync(vapidFilePath, "utf8"));
      if (data.publicKey && data.privateKey) {
        cachedVapid = {
          publicKey: data.publicKey,
          privateKey: data.privateKey,
          subject: data.subject || process.env.VAPID_SUBJECT || "mailto:admin@minasaty.dz",
        };
        return cachedVapid;
      }
    }
  } catch (err) {
    console.warn("Could not read vapid.json:", err.message);
  }

  // Generate and persist new keys if none exist
  try {
    const keys = webpush.generateVAPIDKeys();
    const generated = {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: process.env.VAPID_SUBJECT || "mailto:admin@minasaty.dz",
    };
    fs.mkdirSync(path.dirname(vapidFilePath), { recursive: true });
    fs.writeFileSync(vapidFilePath, JSON.stringify(generated, null, 2), "utf8");
    cachedVapid = generated;
    return cachedVapid;
  } catch (err) {
    console.warn("Could not generate VAPID keys:", err.message);
  }

  return null;
}

function configured() {
  const details = getVapidDetails();
  return Boolean(details?.publicKey && details?.privateKey);
}

function configure() {
  const details = getVapidDetails();
  if (details?.publicKey && details?.privateKey) {
    webpush.setVapidDetails(details.subject, details.publicKey, details.privateKey);
  }
}

function getPublicKey() {
  const details = getVapidDetails();
  return details?.publicKey || "";
}

async function saveSubscription(recipientRole, recipientId, subscription, sessionId = null) {
  if (!configured()) throw new Error("إشعارات الهاتف غير مفعلة بعد. تحقق من إعدادات VAPID.");
  configure();
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new Error("اشتراك Push غير صالح.");
  return prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, recipientRole, recipientId, sessionId: sessionId || null },
    update: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, recipientRole, recipientId, sessionId: sessionId || null },
  });
}

async function removeSubscription(endpoint) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

async function sendPushSubscriptions(subscriptions, payload) {
  if (!configured()) return { sent: 0, configured: false };
  configure();
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        {
          TTL: 86400,
          urgency: "high",
          headers: {
            Urgency: "high",
            TTL: "86400",
          },
        }
      );
      sent += 1;
    } catch (error) {
      console.warn("webpush send error for endpoint:", subscription.endpoint?.slice(0, 35), error.statusCode, error.message);
      if (error.statusCode === 404 || error.statusCode === 410) {
        await removeSubscription(subscription.endpoint);
      }
    }
  }
  return { sent, configured: true };
}

async function sendPushToRecipient(recipientRole, recipientId, payload) {
  if (!configured()) return { sent: 0, configured: false };
  const subscriptions = await prisma.pushSubscription.findMany({ where: { recipientRole, recipientId } });
  return sendPushSubscriptions(subscriptions, payload);
}

async function sendPushToMultipleRecipients(recipientRole, recipientIds, payload) {
  if (!configured() || !Array.isArray(recipientIds) || recipientIds.length === 0) return { sent: 0, configured: false };
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { recipientRole, recipientId: { in: recipientIds } }
  });
  return sendPushSubscriptions(subscriptions, payload);
}

async function sendPushToAllSubscribers(payload) {
  if (!configured()) return { sent: 0, configured: false };
  const subscriptions = await prisma.pushSubscription.findMany();
  return sendPushSubscriptions(subscriptions, payload);
}

async function sendPushToSession(sessionId, payload) {
  const safeSessionId = String(sessionId || "").trim();
  if (!safeSessionId) return { sent: 0, configured: configured() };
  const subscriptions = await prisma.pushSubscription.findMany({ where: { sessionId: safeSessionId } });
  return sendPushSubscriptions(subscriptions, payload);
}

module.exports = {
  getPublicKey,
  configured,
  saveSubscription,
  removeSubscription,
  sendPushToRecipient,
  sendPushToMultipleRecipients,
  sendPushToAllSubscribers,
  sendPushToSession,
};

