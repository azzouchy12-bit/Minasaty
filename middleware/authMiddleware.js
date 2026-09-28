const { verifySessionToken } = require("../utils/sessionAuth");
const prisma = require("../lib/prisma");
const ENFORCE_PARENT_MESSENGER_LINK = /^(1|true|yes)$/i.test(String(process.env.ENFORCE_PARENT_MESSENGER_LINK || ""));

/**
 * Extracts and verifies a JWT from Authorization: Bearer <token> and, for
 * session-aware tokens, checks that the server-side session is still active.
 */
async function verifyToken(req, res, next) {
  const authorizationHeader = req.get("authorization") || "";
  const [scheme, token] = authorizationHeader.split(/\s+/);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return res.status(401).json({
      error: "يلزم إرسال رمز دخول صالح بصيغة Bearer للوصول إلى هذا المورد.",
    });
  }

  try {
    req.user = await verifySessionToken(token);
    return requireParentPinChangeComplete(req, res, () => requireParentMessengerLink(req, res, next));
  } catch (error) {
    console.warn("JWT verification rejected:", error.name || error.message);
    return res.status(403).json({
      error: "رمز الدخول غير صالح أو منتهي الصلاحية.",
    });
  }
}

function isParentMessengerGateExempt(req) {
  const path = req.originalUrl || req.url || "";
  return (
    (req.method === "GET" && /\/api\/messenger\/status(?:\?|$)/.test(path)) ||
    (req.method === "POST" && /\/api\/messenger\/link\/start(?:\?|$)/.test(path)) ||
    (req.method === "PUT" && /\/api\/auth\/parent\/pin(?:\?|$)/.test(path)) ||
    (req.method === "POST" && /\/api\/auth\/logout(?:\?|$)/.test(path)) ||
    (req.method === "GET" && /\/api\/auth\/session-status(?:\?|$)/.test(path)) ||
    (req.method === "GET" && /\/api\/auth\/sessions(?:\?|$)/.test(path))
  );
}

async function requireParentMessengerLink(req, res, next) {
  // Keep the Messenger integration and gate implementation available, but leave
  // enforcement disabled until the Facebook linking flow is fully validated.
  if (!ENFORCE_PARENT_MESSENGER_LINK || req.user?.role !== "parent" || isParentMessengerGateExempt(req)) return next();
  try {
    const link = await prisma.messengerLink.findUnique({
      where: { parentPhone: req.user.phone },
      select: { status: true },
    });
    if (link?.status === "LINKED") return next();
    return res.status(428).json({
      error: "يجب ربط حساب Minasaty بـ Facebook Messenger قبل استعمال المنصة.",
      code: "PARENT_MESSENGER_LINK_REQUIRED",
      redirect: "/parent-dashboard.html?messenger=required",
    });
  } catch (error) {
    console.error("Parent Messenger gate failed:", error.message);
    return res.status(503).json({ error: "تعذر التحقق من ربط Messenger مؤقتًا." });
  }
}

const parentCredentialStatusCache = new Map();
const CREDENTIAL_CACHE_TTL_MS = 60_000;

async function requireParentPinChangeComplete(req, res, next) {
  if (req.user?.role !== "parent") return next();

  // The forced PIN-change and session status endpoints must not perform redundant DB checks.
  const requestPath = req.originalUrl || req.url || "";
  const isPinChangeRoute = req.method === "PUT" && /\/api\/auth\/parent\/pin(?:\/?(?:\?.*)?)$/.test(requestPath);
  const isLogoutRoute = req.method === "POST" && /\/api\/auth\/logout(?:\/?(?:\?.*)?)$/.test(requestPath);
  const isSessionStatusRoute = req.method === "GET" && /\/api\/auth\/session-status(?:\/?(?:\?.*)?)$/.test(requestPath);
  if (isPinChangeRoute || isLogoutRoute || isSessionStatusRoute) return next();

  const phone = req.user.phone;
  const cached = parentCredentialStatusCache.get(phone);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CREDENTIAL_CACHE_TTL_MS && !cached.mustChangePin) {
    return next();
  }

  try {
    const credential = await prisma.parentCredential.findUnique({
      where: { parentPhone: phone },
      select: { mustChangePin: true, temporaryPinExpiresAt: true },
    });

    if (credential?.mustChangePin) {
      parentCredentialStatusCache.set(phone, { mustChangePin: true, cachedAt: now });
      if (credential.temporaryPinExpiresAt && credential.temporaryPinExpiresAt <= new Date()) {
        return res.status(401).json({
          error: "انتهت صلاحية كلمة المرور المؤقتة. اطلب كلمة مرور مؤقتة جديدة من الأستاذ.",
          code: "TEMPORARY_PIN_EXPIRED",
        });
      }

      return res.status(428).json({
        error: "يجب تغيير كلمة المرور المؤقتة قبل استعمال المنصة.",
        code: "PARENT_PIN_CHANGE_REQUIRED",
        redirect: "/force-pin.html",
      });
    }

    parentCredentialStatusCache.set(phone, { mustChangePin: false, cachedAt: now });
    return next();
  } catch (error) {
    console.error("Parent temporary PIN guard failed:", error);
    return res.status(503).json({ error: "تعذر التحقق من حالة كلمة المرور مؤقتًا." });
  }
}

function isTeacher(req, res, next) {
  if (req.user?.role !== "teacher") {
    return res.status(403).json({
      error: "هذه العملية متاحة للأستاذ فقط.",
    });
  }
  return next();
}

function isParentAccessingOwnRecord(req, res, next) {
  const requestedPhone = typeof req.params.phone === "string" ? req.params.phone.trim() : "";
  if (req.user?.role !== "parent" || !req.user.phone || req.user.phone !== requestedPhone) {
    return res.status(403).json({
      error: "لا تملك صلاحية الوصول إلى بيانات هذا التلميذ.",
    });
  }
  return next();
}

module.exports = {
  verifyToken,
  isTeacher,
  requireParentPinChangeComplete,
  requireParentMessengerLink,
  isParentAccessingOwnRecord,
};
