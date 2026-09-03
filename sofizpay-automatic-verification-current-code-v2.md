# الكود الحالي الجديد للتحقق التلقائي من دفع SofizPay

هذا هو الإصدار الحالي بعد إضافة `SOFIZPAY_WEBHOOK_SECRET`، واستجابة `ignored` بـ HTTP 200، وتسجيل أخطاء المصالحة لكل معاملة. أرسله إلى Gemini للمراجعة، واطلب منه فحص صحة الربط وأسماء حقول SofizPay.

> لا ترسل أي قيمة فعلية للمتغيرات السرية. الكود أدناه يعرض أسماء المتغيرات فقط.

## 1. الإعدادات الحالية

المصدر: `controllers/paymentController.js`

```js
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { logAudit } = require("../utils/audit");

const SOFIZPAY_BASE_URL = String(process.env.SOFIZPAY_BASE_URL || "https://sofizpay.com").replace(/\/$/, "");
const SOFIZPAY_ACCOUNT = process.env.SOFIZPAY_ACCOUNT || "GBYAJX2VUMCKQQMTQRKIHFL7GWKPXQGAQNNCJOIV232S3Q73NNYK6JF4";
const SOFIZPAY_CREATE_URL = `${SOFIZPAY_BASE_URL}/make-cib-transaction/`;
const SOFIZPAY_CHECK_URL = `${SOFIZPAY_BASE_URL}/cib-transaction-check/`;
const SOFIZPAY_OPERATION_DETAILS_URL = `${SOFIZPAY_BASE_URL}/operation-details/`;
const SOFIZPAY_ENCRYPTED_SECRET_KEY = String(process.env.SOFIZPAY_ENCRYPTED_SECRET_KEY || "").trim();
const SOFIZPAY_WEBHOOK_SECRET = String(process.env.SOFIZPAY_WEBHOOK_SECRET || "").trim();
const PUBLIC_SITE_URL = String(process.env.APP_BASE_URL || process.env.PUBLIC_SITE_URL || "https://dr.africacold.fr").replace(/\/$/, "");
const SOFIZPAY_WEBHOOK_URL = `${PUBLIC_SITE_URL}/api/payments/sofizpay/webhook?secret=${encodeURIComponent(SOFIZPAY_WEBHOOK_SECRET)}`;

const VALID_SUBSCRIPTIONS = new Map([
  ["BOTH", { amount: 2030, mathEnrollment: true, physicsEnrollment: true, label: "الرياضيات والفيزياء" }],
  ["MATH", { amount: 1030, mathEnrollment: true, physicsEnrollment: false, label: "الرياضيات فقط" }],
  ["PHYSICS", { amount: 1030, mathEnrollment: false, physicsEnrollment: true, label: "الفيزياء فقط" }],
]);
```

## 2. إنشاء الطلب الديناميكي

```js
function normalizeProviderOrderNumber(value) {
  return text(value, 120).replace(/^REF\s*[:#-]?\s*/i, "").trim();
}

function buildInternalOrderId() {
  return `MINA-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function buildSofizPayReturnUrl(internalOrderId, subscriptionType) {
  const url = new URL(`${PUBLIC_SITE_URL}/parent-dashboard.html`);
  url.searchParams.set("payment", "sofizpay");
  url.searchParams.set("subscription", subscriptionType);
  url.searchParams.set("internal_order_id", internalOrderId);
  return url.toString();
}

async function createSofizPayPayment({ student, subscriptionType, amount, internalOrderId }) {
  const phone = text(student.parentPhone, 40);
  const email = `${phone.replace(/[^0-9]/g, "") || "parent"}@dr.africacold.fr`;
  const params = new URLSearchParams({
    account: SOFIZPAY_ACCOUNT,
    amount: String(amount),
    full_name: text(student.studentName, 120) || "Student",
    phone,
    email,
    return_url: buildSofizPayReturnUrl(internalOrderId, subscriptionType),
    webhook_url: SOFIZPAY_WEBHOOK_URL,
    invoice_id: internalOrderId,
    language: "ar",
    memo: `${subscriptionType}-${amount}`,
    redirect: "yes",
    keep_return_url: "True",
  });
  const { response, payload } = await fetchJson(`${SOFIZPAY_CREATE_URL}?${params.toString()}`);
  const paymentUrl = text(payload?.payment_url || payload?.data?.payment_url || payload?.formUrl || payload?.cib_response?.formUrl, 4000);
  if (!response.ok || payload?.success === false || !paymentUrl) {
    throw new Error(payload?.message || payload?.error || "تعذر إنشاء رابط SofizPay مخصص.");
  }
  return {
    paymentUrl,
    providerOrderNumber: extractProviderOrderNumber(payload),
    providerTransactionId: extractProviderTransactionId(payload),
    providerPayload: payload,
  };
}
```

## 3. استخراج معرفات SofizPay وOperation Details

```js
function extractProviderTransactionId(payload) {
  return text(
    payload?.transaction_id ||
    payload?.data?.transaction_id ||
    payload?.operation_id ||
    payload?.operationId ||
    payload?.data?.operation_id ||
    payload?.data?.operationId ||
    payload?.id ||
    payload?.data?.id,
    120
  ) || null;
}

function extractInternalOrderId(payload) {
  return text(
    payload?.invoice_id ||
    payload?.data?.invoice_id ||
    payload?.internal_order_id ||
    payload?.data?.internal_order_id ||
    payload?.order_id ||
    payload?.data?.order_id,
    120
  ) || null;
}

function extractProviderOrderNumber(payload) {
  return normalizeProviderOrderNumber(text(
    payload?.cib_transaction_id ||
    payload?.data?.cib_transaction_id ||
    payload?.cib_response?.orderId ||
    payload?.data?.cib_response?.orderId ||
    payload?.order_number ||
    payload?.orderNumber ||
    payload?.order ||
    findNestedField(payload, [
      "cib_transaction_id",
      "cibTransactionId",
      "order_number",
      "orderNumber",
      "cibOrderNumber",
      "satimOrderNumber",
    ]),
    120
  )) || null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSofizPayOperationDetails(operationId) {
  if (!SOFIZPAY_ENCRYPTED_SECRET_KEY || !operationId) return null;
  const url = new URL(`${SOFIZPAY_OPERATION_DETAILS_URL}${encodeURIComponent(operationId)}/`);
  url.searchParams.set("encrypted_sk", SOFIZPAY_ENCRYPTED_SECRET_KEY);
  const { response, payload } = await fetchJson(url.toString());
  return response.ok && payload && !payload.error ? payload : null;
}
```

## 4. قبول النجاح وتفعيل الطالب

```js
function providerPaymentSignals(payload) {
  const orderStatus = Number(payload?.orderStatus ?? payload?.data?.orderStatus ?? payload?.cib_response?.orderStatus);
  const responseCode = text(
    payload?.respCode ??
    payload?.responseCode ??
    payload?.data?.respCode ??
    payload?.data?.responseCode ??
    payload?.cib_response?.respCode ??
    payload?.cib_response?.responseCode,
    10
  );
  const status = text(payload?.status ?? payload?.data?.status, 60).toLowerCase();
  return { orderStatus, responseCode, status };
}

function providerPaymentAccepted(payload, transaction) {
  const { orderStatus, responseCode, status } = providerPaymentSignals(payload);
  const acceptedStatus = new Set(["paid", "completed", "complete", "success", "succeeded", "approved"]);
  const accepted = orderStatus === 2 || responseCode === "00" || acceptedStatus.has(status);
  if (!accepted) return false;

  const returnedAmount = amountAsNumber(payload?.Amount ?? payload?.amount ?? payload?.data?.Amount ?? payload?.data?.amount ?? payload?.transaction?.amount);
  if (returnedAmount !== null && Math.round(returnedAmount) !== transaction.amount) return false;

  const destination = text(payload?.destination_account ?? payload?.data?.destination_account ?? payload?.destination, 120);
  if (destination && destination !== SOFIZPAY_ACCOUNT) return false;
  return true;
}

function providerPaymentExplicitlyFailed(payload) {
  const { orderStatus, responseCode, status } = providerPaymentSignals(payload);
  const failedStatuses = new Set(["failed", "declined", "cancelled", "canceled", "rejected", "expired", "error", "refunded"]);
  const failedResponseCodes = new Set(["05", "51", "54", "55", "57", "58", "91", "96"]);
  return failedStatuses.has(status) || failedResponseCodes.has(responseCode) || (Number.isFinite(orderStatus) && orderStatus > 2);
}

async function activatePaidTransaction(transaction, providerPayload) {
  if (transaction.status === "PAID") return transaction;
  const subscription = VALID_SUBSCRIPTIONS.get(transaction.subscriptionType);
  if (!subscription) throw new Error("نوع الاشتراك غير صالح.");

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.paymentTransaction.findUnique({ where: { id: transaction.id } });
    if (!fresh) throw new Error("طلب الدفع غير موجود.");
    if (fresh.status === "PAID") return fresh;

    const student = await tx.student.findUnique({ where: { id: fresh.studentId }, select: { id: true } });
    if (!student) throw new Error("التلميذ غير موجود.");

    const paidStudent = await tx.student.update({
      where: { id: fresh.studentId },
      data: {
        paymentStatus: true,
        paymentStage: "PAID",
        amountDue: fresh.amount,
        mathEnrollment: subscription.mathEnrollment,
        physicsEnrollment: subscription.physicsEnrollment,
        liveAccessEnabled: true,
        paymentReceiptPending: false,
      },
    });

    await tx.paymentTransaction.update({
      where: { id: fresh.id },
      data: { status: "PAID", providerPayload: safeJson(providerPayload), verifiedAt: now, paidAt: now },
    });

    await tx.paymentEvent.create({
      data: {
        studentId: fresh.studentId,
        stage: "PAID",
        amount: fresh.amount,
        actorRole: "SOFIZPAY",
        actorId: fresh.providerOrderNumber || fresh.internalOrderId,
        note: `تم تأكيد الدفع الإلكتروني: ${subscription.label}`,
      },
    });

    return { ...fresh, status: "PAID", student: paidStudent };
  });

  void logAudit({ user: { role: "system", sessionId: "sofizpay" }, ip: "sofizpay" }, {
    action: "SOFIZPAY_PAYMENT_VERIFIED",
    entityType: "PaymentTransaction",
    entityId: updated.id,
    studentId: updated.studentId,
    metadata: {
      internalOrderId: updated.internalOrderId,
      providerOrderNumber: updated.providerOrderNumber,
      amount: updated.amount,
      subscriptionType: updated.subscriptionType,
    },
  }).catch(() => {});

  return updated;
}
```

## 5. التحقق الخلفي والمصالحة الدورية

```js
async function verifyTransaction(transaction) {
  if (!transaction?.providerOrderNumber) return { transaction, verified: false, pending: true };
  const checkUrl = new URL(SOFIZPAY_CHECK_URL);
  checkUrl.searchParams.set("order_number", transaction.providerOrderNumber);
  const { response, payload } = await fetchJson(checkUrl.toString());

  if (!response.ok || payload?.error) return { transaction, verified: false, pending: true, providerPayload: payload };
  if (!providerPaymentAccepted(payload, transaction)) {
    if (!providerPaymentExplicitlyFailed(payload)) {
      const pendingTransaction = await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: { providerPayload: safeJson(payload) },
      });
      return { transaction: pendingTransaction, verified: false, pending: true, providerPayload: payload };
    }

    const failedTransaction = await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: { status: "FAILED", providerPayload: safeJson(payload), verifiedAt: new Date() },
    });
    return { transaction: failedTransaction, verified: false, pending: false, failed: true, providerPayload: payload };
  }

  const updated = await activatePaidTransaction(transaction, payload);
  return { transaction: updated, verified: true, pending: false, providerPayload: payload };
}

async function reconcilePendingSofizPayPayments() {
  const transactions = await prisma.paymentTransaction.findMany({
    where: {
      provider: "SOFIZPAY",
      status: "PENDING",
      providerOrderNumber: { not: null },
      createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    },
    orderBy: { updatedAt: "asc" },
    take: 25,
  });

  for (const transaction of transactions) {
    try {
      await verifyTransaction(transaction);
    } catch (error) {
      console.error("Automatic SofizPay verification failed", {
        paymentTransactionId: transaction.id,
        internalOrderId: transaction.internalOrderId,
        providerOrderNumber: transaction.providerOrderNumber,
        error: error.message,
      });
    }
  }
}
```

## 6. Webhook المحمي بالسر

```js
async function receiveSofizPayWebhook(req, res) {
  try {
    if (SOFIZPAY_WEBHOOK_SECRET && text(req.query?.secret, 240) !== SOFIZPAY_WEBHOOK_SECRET) {
      console.warn("SofizPay webhook rejected: invalid secret");
      return res.status(401).json({ status: "unauthorized", message: "Invalid webhook secret." });
    }

    const payload = {
      ...(req.query && typeof req.query === "object" ? req.query : {}),
      ...(req.body && typeof req.body === "object" ? req.body : {}),
    };
    let providerOrderNumber = extractProviderOrderNumber(payload);
    const internalOrderId = extractInternalOrderId(payload);
    const providerTransactionId = extractProviderTransactionId(payload);

    if (!providerOrderNumber && !internalOrderId && !providerTransactionId) {
      console.warn("SofizPay webhook ignored: no transaction identifiers");
      return res.status(200).json({ status: "ignored", message: "Transaction not found or invalid payload." });
    }

    const transaction = await prisma.paymentTransaction.findFirst({
      where: {
        OR: [
          ...(providerOrderNumber ? [{ providerOrderNumber }] : []),
          ...(internalOrderId ? [{ internalOrderId }] : []),
          ...(providerTransactionId ? [{ providerTransactionId }] : []),
        ],
      },
    });

    if (!transaction) {
      console.warn("SofizPay webhook ignored: transaction not found", {
        providerOrderNumber,
        internalOrderId,
        providerTransactionId,
      });
      return res.status(200).json({ status: "ignored", message: "Transaction not found or invalid payload." });
    }

    let operationDetails = null;
    if (!providerOrderNumber && providerTransactionId) {
      operationDetails = await fetchSofizPayOperationDetails(providerTransactionId);
      providerOrderNumber = extractProviderOrderNumber(operationDetails);
    }

    let linkedTransaction = transaction;
    if (providerOrderNumber && transaction.providerOrderNumber && transaction.providerOrderNumber !== providerOrderNumber) {
      const conflict = await prisma.paymentTransaction.findUnique({ where: { providerOrderNumber }, select: { id: true } });
      if (conflict && conflict.id !== transaction.id) {
        return res.status(409).json({ error: "رقم الطلب مرتبط بمعاملة أخرى." });
      }
    }

    if (providerOrderNumber || providerTransactionId || operationDetails) {
      linkedTransaction = await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          ...(providerOrderNumber ? { providerOrderNumber } : {}),
          ...(providerTransactionId ? { providerTransactionId } : {}),
          providerPayload: safeJson({ webhook: payload, operationDetails }),
        },
      });
    }

    if (!linkedTransaction.providerOrderNumber) {
      return res.json({ status: "pending", message: "تم استلام إشعار SofizPay، وننتظر رقم الطلب للتحقق." });
    }

    const result = await verifyTransaction(linkedTransaction);
    return res.json({ status: result.verified ? "paid" : result.pending ? "pending" : "failed" });
  } catch (error) {
    console.error("SofizPay webhook failed:", error);
    return res.status(500).json({ error: "تعذر معالجة إشعار SofizPay." });
  }
}
```

## 7. Route وbody parsers

المصدر: `routes/paymentRoutes.js`

```js
const express = require("express");
const { verifyToken, isTeacher } = require("../middleware/authMiddleware");
const {
  startSofizPayPayment,
  getSofizPayPaymentStatus,
  getTeacherElectronicPayments,
  dismissTeacherElectronicPayment,
  reconcileTeacherElectronicPayment,
  reconcileParentSofizPayPayment,
  receiveSofizPayWebhook,
} = require("../controllers/paymentController");

const router = express.Router();

router.post(
  "/sofizpay/webhook",
  express.urlencoded({ extended: false, limit: "64kb" }),
  express.json({ limit: "64kb" }),
  receiveSofizPayWebhook
);

router.post("/sofizpay/start", verifyToken, startSofizPayPayment);
router.get("/sofizpay/status", verifyToken, getSofizPayPaymentStatus);
router.post("/sofizpay/reconcile", verifyToken, reconcileParentSofizPayPayment);
```

## 8. Background job

المصدر: `utils/backgroundJobs.js`

```js
async function reconcileSofizPayPayments() {
  try {
    const { reconcilePendingSofizPayPayments } = require("../controllers/paymentController");
    await reconcilePendingSofizPayPayments();
  } catch (error) {
    console.error("SofizPay background reconciliation failed:", error.message);
  }
}

function startBackgroundJobs() {
  const run = () => Promise.allSettled([
    sendClassReminders(),
    sendWeeklyReports(),
    cleanExpiredSessions(),
    reconcileSofizPayPayments(),
  ]).catch(() => {});
  void run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
```

## 9. متغيرات البيئة الحالية

المصدر: `.env.example`

```env
SOFIZPAY_BASE_URL="https://sofizpay.com"
SOFIZPAY_ACCOUNT="replace-with-sofizpay-account"
SOFIZPAY_ENCRYPTED_SECRET_KEY="replace-with-encrypted-secret-key"
SOFIZPAY_WEBHOOK_SECRET="replace-with-a-long-random-webhook-secret"
APP_BASE_URL="https://your-public-domain.example"
```

## أسئلة المراجعة التي يجب إرسالها إلى Gemini

1. هل `transaction_id` في رد إنشاء العملية هو نفسه `operation_id` المقبول في Operation Details؟
2. هل أسماء الحقول `invoice_id` و`cib_transaction_id` و`transaction_id` صحيحة في webhook SofizPay؟
3. هل `keep_return_url: "True"` صحيح، أم يجب استعمال `"False"` للحصول على callback موقّع؟
4. هل secret في query parameter مناسب حسب SofizPay، أم يجب استعمال HMAC أو header signature؟
5. هل منطق `orderStatus === 2` أو `respCode === "00"` كافٍ لقبول الدفع؟
6. هل Operation Details يعيد رقم الطلب داخل `order_number` أو `orderId` أو حقل آخر؟
7. هل استجابة `HTTP 200 ignored` للمعاملة غير المعروفة آمنة، أم يجب إعادة الإرسال في بعض الحالات؟
8. هل توجد مشكلة في أن `SOFIZPAY_WEBHOOK_SECRET` إذا كان فارغًا تصبح الحماية معطلة؟
9. هل ينبغي عدم وضع secret داخل URL لأن الخوادم قد تسجله في access logs، واستبداله بـ header أو HMAC؟
10. هل `findNestedField` قد يلتقط رقمًا غير صحيح من payload متداخل؟

لا ترسل إلى Gemini أي قيمة فعلية لـ `SOFIZPAY_ENCRYPTED_SECRET_KEY` أو `SOFIZPAY_WEBHOOK_SECRET`.
