// server.js
// Online Tutoring Platform — Express API, static frontend, and Socket.io WebRTC signaling.
//
// WebRTC media does not pass through this server. Socket.io only relays the SDP/ICE
// messages required for each teacher <-> student peer connection.

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const pushRoutes = require("./routes/pushRoutes");
const { createClient } = require("redis");
const prisma = require("./lib/prisma");
const { verifyToken, isTeacher } = require("./middleware/authMiddleware");
const { requestMetrics, socketConnected, socketDisconnected, snapshot: metricsSnapshot } = require("./utils/metrics");
const { createDatabaseSnapshot } = require("./utils/backup");
const { createRateLimiter } = require("./middleware/rateLimit");
const { startBackgroundJobs } = require("./utils/backgroundJobs");
const { ensurePublicArchive, recordPublicAttendance, finishPublicArchive, appendPublicChat } = require("./utils/publicArchive");
const { verifySessionToken, setSessionTakeoverNotifier } = require("./utils/sessionAuth");
const { sendPushToSession } = require("./utils/push");
const { sendTelegramNotification, configureTelegramWebhook } = require("./services/telegramService");
const { createSocketNotificationSender, notificationRoom, notificationSessionRoom } = require("./utils/socketNotifications");
const siteAnalyticsRoutes = require("./routes/siteAnalyticsRoutes");
const referralRoutes = require("./routes/referralRoutes");
const telegramRoutes = require("./routes/telegramRoutes");
const messengerRoutes = require("./routes/messengerRoutes");
const ENFORCE_PARENT_MESSENGER_LINK = /^(1|true|yes)$/i.test(String(process.env.ENFORCE_PARENT_MESSENGER_LINK || ""));

/**
 * Socket.io control events must authenticate the teacher independently from
 * socket.data.role. The latter starts as null and is only populated after a
 * successful room join, so it cannot be used as the first authorization check.
 */
async function requireParentMessengerSocketSession(socket, eventName, acknowledgement) {
  if (!ENFORCE_PARENT_MESSENGER_LINK) return true;
  const token = typeof socket.handshake?.auth?.token === "string"
    ? socket.handshake.auth.token.trim()
    : "";
  if (!token) return true;
  try {
    const user = await verifySessionToken(token);
    if (user?.role !== "parent") return true;
    const link = await prisma.messengerLink.findUnique({ where: { parentPhone: user.phone }, select: { status: true } });
    if (link?.status === "LINKED") {
      socket.data.authUser = user;
      return true;
    }
    emitClassroomError(socket, eventName, "يجب ربط حساب Minasaty بـ Facebook Messenger قبل دخول المنصة أو الحصة.", acknowledgement);
    return false;
  } catch (error) {
    emitClassroomError(socket, eventName, "تعذر التحقق من ربط Messenger قبل دخول الحصة.", acknowledgement);
    return false;
  }
}

async function requireTeacherSocketSession(socket, eventName, acknowledgement) {
  const token = typeof socket.handshake?.auth?.token === "string"
    ? socket.handshake.auth.token.trim()
    : "";

  if (!token) {
    emitClassroomError(socket, eventName, "يجب تسجيل دخول الأستاذ قبل التحكم في الحصة.", acknowledgement);
    return null;
  }

  try {
    const user = await verifySessionToken(token);
    if (!user || user.role !== "teacher") {
      emitClassroomError(socket, eventName, "لا تملك صلاحية الأستاذ للتحكم في الحصة.", acknowledgement);
      return null;
    }
    return user;
  } catch (error) {
    emitClassroomError(socket, eventName, "انتهت جلسة الأستاذ. أعد تسجيل الدخول.", acknowledgement);
    return null;
  }
}

const app = express();
const httpServer = http.createServer(app);

// Railway terminates TLS at its proxy. Trusting exactly one proxy is required
// for correct protocol/IP handling without trusting arbitrary forwarded headers.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    // Google Identity uses a controlled Google popup for the teacher's explicit
    // Drive authorization. Allow popups while retaining same-origin isolation.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "media-src": ["'self'", "blob:"],
        "connect-src": ["'self'", "https:", "wss:"],
        // Firebase Auth loads official ES modules from gstatic, while its
        // invisible reCAPTCHA challenge uses Google-hosted scripts and frames.
        "script-src": [
          "'self'",
          "https://www.gstatic.com",
          "https://accounts.google.com",
          "https://apis.google.com",
          "https://www.google.com",
          "https://www.recaptcha.net",
        ],
        "frame-src": [
          "'self'",
          "https://accounts.google.com",
          "https://docs.google.com",
          "https://drive.google.com",
          "https://www.youtube.com",
          "https://www.google.com",
          "https://recaptcha.google.com",
          "https://www.recaptcha.net",
        ],
        "object-src": ["'none'"],
      },
    },
    // YouTube embedded players require a valid cross-origin Referer.
    // Keep the policy privacy-conscious while sending only the origin cross-site.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self)"
  );
  next();
});

// Set CLIENT_ORIGIN to the Railway domain (and any custom domains), separated
// by commas. ENABLE_OPEN_CORS=true is a prototype-only escape hatch and must
// not be used for a production deployment handling authenticated data.
const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const openCorsEnabled = process.env.ENABLE_OPEN_CORS === "true";

function isOriginAllowed(origin) {
  // Non-browser requests such as Railway health checks do not include Origin.
  return !origin || openCorsEnabled || allowedOrigins.includes(origin);
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin is not allowed by CORS policy."));
  },
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Accept"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
function captureMessengerRawBody(req, _res, buffer) {
  const requestPath = String(req.originalUrl || "").split("?", 1)[0];
  if (requestPath === "/api/messenger/webhook") {
    req.rawBody = Buffer.from(buffer);
  }
}

app.use(express.json({ limit: "100kb", verify: captureMessengerRawBody }));
app.use(requestMetrics);

// Never log request bodies: registration and payment payloads contain secrets and identity data.
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// REST API routes. Authentication is mounted before protected student routes
// so both login endpoints and resource endpoints remain available under /api.
const authRoutes = require("./routes/authRoutes");
const studentRoutes = require("./routes/studentRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const liveChatRoutes = require("./routes/liveChatRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const lessonVideoRoutes = require("./routes/lessonVideoRoutes");
const youtubeRoutes = require("./routes/youtubeRoutes");
const messageRoutes = require("./routes/messageRoutes");
const academicRoutes = require("./routes/academicRoutes");
const materialRoutes = require("./routes/materialRoutes");
const certificateRoutes = require("./routes/certificateRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

app.use("/api/site-analytics", siteAnalyticsRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/telegram", telegramRoutes);
app.use("/api/messenger", messengerRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/live-chat", liveChatRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/lesson-videos", lessonVideoRoutes);
app.use("/api/youtube", youtubeRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/academic", academicRoutes);
app.use("/api/materials", materialRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/payments", paymentRoutes);

// Course-material uploads are intentionally disabled. Block the legacy public
// path before the general static middleware so old files cannot be downloaded.
app.use("/uploads", (_req, res) => {
  res.status(410).json({ error: "تم إيقاف ميزة المواد التعليمية." });
});

// Serve index.html, the registration flow, and the portal pages from /public.
app.use(express.static(path.join(__dirname, "public")));
// Keep the public invite page available through an explicit route as well.
app.get("/public-class.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "public-class.html"));
});
app.get("/teacher-chat", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "teacher-chat.html"));
});
app.get("/student-chat", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "student-chat.html"));
});

app.get("/api/google-picker/config", verifyToken, isTeacher, (_req, res) => {
  const apiKey = String(process.env.GOOGLE_PICKER_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(503).json({
      error: "لم يتم إعداد مفتاح Google Picker بعد. أضف GOOGLE_PICKER_API_KEY إلى متغيرات Railway.",
    });
  }

  return res.status(200).json({
    apiKey,
    appId: "938017291163",
  });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});



const backupRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 2, message: "تم إنشاء نسخ احتياطية كثيرة خلال فترة قصيرة." });

app.get("/api/admin/backup", verifyToken, isTeacher, backupRateLimit, async (req, res) => {
  try {
    const includeDocuments = String(req.query.includeDocuments || "") === "true";
    const snapshot = await createDatabaseSnapshot({ includeDocuments });
    res.type("application/json");
    res.setHeader("Content-Disposition", `attachment; filename=akademiat-altawafuq-backup-${Date.now()}.json`);
    return res.status(200).send(JSON.stringify(snapshot));
  } catch (error) {
    console.error("Database backup failed:", error);
    return res.status(500).json({ error: "تعذر إنشاء النسخة الاحتياطية حالياً." });
  }
});

app.get("/api/health/detailed", verifyToken, isTeacher, async (_req, res) => {
  let database = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "error";
  }
  const relayUrl = String(process.env.FACEBOOK_RELAY_URL || "").trim();
  return res.status(database === "ok" ? 200 : 503).json({
    status: database === "ok" ? "ok" : "degraded",
    database,
    relayConfigured: Boolean(relayUrl),
    metrics: metricsSnapshot(),
  });
});

const io = new Server(httpServer, {
  cors: corsOptions,
  maxHttpBufferSize: 1_500_000,
  // These values make transient network interruptions less likely to terminate
  // a classroom socket immediately. They do not affect WebRTC media streams.
  pingInterval: 25_000,
  pingTimeout: 60_000,
});

const privateMessagesNamespace = io.of("/private-messages");
privateMessagesNamespace.use(async (socket, next) => {
  try {
    const token = typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token
      : "";
    if (!token) return next(new Error("يلزم تسجيل الدخول للرسائل."));

    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) return next(new Error("إعداد المصادقة غير متاح."));
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: "online-tutoring-platform",
      audience: "online-tutoring-platform-web",
    });

    if (decoded.role === "teacher") {
      socket.data.privateRole = "teacher";
      socket.data.privateStudentId = null;
      return next();
    }

    if (decoded.role !== "parent" || !decoded.phone) {
      return next(new Error("لا تملك صلاحية استخدام الرسائل."));
    }

    const studentId = String(socket.handshake.auth?.studentId || "").trim();
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, parentPhone: true },
    });
    if (!student || student.parentPhone !== decoded.phone) {
      return next(new Error("لا تملك صلاحية هذه المحادثة."));
    }

    socket.data.privateRole = "student";
    socket.data.privateStudentId = student.id;
    return next();
  } catch (error) {
    return next(new Error("رمز الرسائل غير صالح أو منتهي الصلاحية."));
  }
});

privateMessagesNamespace.on("connection", (socket) => {
  if (socket.data.privateRole === "teacher") {
    socket.join("teacher");
  } else if (socket.data.privateStudentId) {
    socket.join(`student:${socket.data.privateStudentId}`);
  }
});

// REST controllers use this server-owned reference only to publish minimal
// non-sensitive dashboard refresh events after a teacher changes a student.
const sendSocketNotification = createSocketNotificationSender(io);
const { setSocketNotificationSender } = require("./controllers/academicController");
setSocketNotificationSender(sendSocketNotification);
setSessionTakeoverNotifier(async ({ previousSession, role }) => {
  const payload = {
    title: "تنبيه أمني للحساب",
    body: role === "teacher"
      ? "تم تسجيل دخول الأستاذ من جهاز أو متصفح آخر. سيتم تسجيل خروج هذا الجهاز."
      : "تم تسجيل الدخول إلى حساب الولي من جهاز أو متصفح آخر. سيتم تسجيل خروج هذا الجهاز.",
    link: "/index.html?session=takeover",
    tag: `session-takeover-${previousSession.tokenId}`,
    data: { type: "session_takeover", sessionId: previousSession.tokenId },
  };
  sendSocketNotification({ sessionId: previousSession.tokenId, ...payload });
  void sendPushToSession(previousSession.tokenId, payload).catch((error) => {
    console.warn("Previous-session push alert failed:", error.message);
  });
});
app.set("io", io);
app.set("privateMessagesNamespace", privateMessagesNamespace);
app.set("sendSocketNotification", sendSocketNotification);
app.set("sendTelegramNotification", sendTelegramNotification);

/**
 * Maps each study level to its active teacher socket ID.
 *
 * This is intentionally in-memory for the single-process deployment used in
 * this phase. If the app is horizontally scaled, replace this with a shared
 * Socket.io adapter (such as Redis) plus shared classroom state.
 */
const activeTeachersByLevel = new Map();
// Stores the selected class type for each active level: a subject for school levels
// or a subscription type for university students.
const activeSubjectByLevel = new Map();
// Explicit screen-share state lets students distinguish a real shared screen
// from the static level welcome image that remains local to their page.
const screenShareActiveByLevel = new Map();
// A brief signaling outage must not end an otherwise healthy direct WebRTC
// stream. This map reserves a room only for its original teacher while the
// teacher's browser reconnects with its per-class recovery token.
const pendingTeacherRecoveryByLevel = new Map();
// Server-owned microphone state keeps teacher approval authoritative through
// renegotiation and short teacher recovery windows. Media itself remains direct
// WebRTC; this map stores only the current permission state by socket ID.
const openStudentMicsByLevel = new Map();
// Whiteboard authority follows the teacher's microphone decision for the same
// student and classroom. The server remains the source of truth for drawing.
const whiteboardAccessByLevel = new Map();
// Keep a bounded in-memory chat history for the lifetime of an active classroom.
// It is replayed only to the teacher and to the student who authored a message.
const classroomChatHistoryByLevel = new Map();
const MAX_CLASSROOM_CHAT_HISTORY = 100;
// A full browser refresh drops the local screen-share stream. Keep the room
// reserved long enough for the teacher to reload, select the screen again, and
// reclaim the same classroom without forcing students out.
const TEACHER_RECOVERY_GRACE_MS = 180_000;

/**
 * Tracks only active WebRTC classroom sockets, keyed by socket ID. Passive
 * parent lobby sockets are deliberately excluded because they are not peers.
 * Value shape: { role: "teacher" | "student", level: string, name: string }
 */
const users = new Map();
// Independent public invite rooms. They have no student registration, level,
// payment, or subject information and exist only while the host is connected.
const publicInviteRooms = new Map();

// The homepage only needs a public room ID. Host control tokens never leave the
// teacher-generated host URL or the authenticated Socket.io handshake.
app.get("/api/public-class/archives", verifyToken, isTeacher, async (req, res) => {
  try {
    const take = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const archives = await prisma.publicRoomArchive.findMany({ orderBy: { startedAt: "desc" }, take, select: { id: true, roomId: true, title: true, startedAt: true, endedAt: true, recordingUrl: true, recordingDriveFileId: true, attendeeCount: true } });
    return res.json({ status: "success", data: archives });
  } catch (error) {
    console.error("Public archives list failed:", error);
    return res.status(500).json({ error: "تعذر تحميل أرشيف الحصص العامة." });
  }
});

app.get("/api/public-class/archive/:roomId", verifyToken, isTeacher, async (req, res) => {
  try {
    const archive = await prisma.publicRoomArchive.findUnique({ where: { roomId: normalizeText(req.params.roomId) }, include: { attendees: { orderBy: { joinedAt: "asc" } } } });
    if (!archive) return res.status(404).json({ error: "لا يوجد أرشيف لهذه الحصة." });
    return res.json({ status: "success", data: { ...archive, chatArchive: archive.chatArchiveJson ? JSON.parse(archive.chatArchiveJson) : [] } });
  } catch (error) {
    console.error("Public archive load failed:", error);
    return res.status(500).json({ error: "تعذر تحميل أرشيف الحصة." });
  }
});

app.get("/api/public-class/status", (_req, res) => {
  let activeRoomId = null;
  for (const [roomId, room] of publicInviteRooms.entries()) {
    if (room?.hostSocketId && io.sockets.sockets.has(room.hostSocketId)) {
      activeRoomId = roomId;
    }
  }
  return res.status(200).json({ active: Boolean(activeRoomId), roomId: activeRoomId });
});

app.post("/api/public-class/facebook-relay/session", (req, res) => {
  const roomId = normalizeText(req.body?.roomId);
  const hostToken = normalizeText(req.body?.hostToken);
  const room = publicInviteRooms.get(roomId);
  const hostSocket = room?.hostSocketId ? io.sockets.sockets.get(room.hostSocketId) : null;
  const relayUrl = String(process.env.FACEBOOK_RELAY_URL || "").trim();
  const secret = process.env.JWT_SECRET;

  if (!room || !hostSocket || hostSocket.data.publicRole !== "host" || room.hostToken !== hostToken) {
    return res.status(403).json({ error: "لا تملك صلاحية بث هذه الحصة إلى Facebook." });
  }
  if (!relayUrl || !secret || secret.length < 32) {
    return res.status(503).json({ error: "لم يتم إعداد خدمة بث Facebook على الخادم بعد." });
  }

  const relayToken = jwt.sign(
    { role: "public_host", roomId },
    secret,
    {
      algorithm: "HS256",
      expiresIn: "15m",
      issuer: "online-tutoring-platform",
      audience: "facebook-relay",
    }
  );
  return res.json({ relayUrl: relayUrl.replace(/\/$/, ""), relayToken, expiresIn: "15m" });
});

const MAX_LEVEL_LENGTH = 100;
const MAX_NAME_LENGTH = 120;
const MAX_CHAT_MESSAGE_LENGTH = 800;
const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 1_100_000;
const UNIVERSITY_LEVEL = "طالب جامعي";
const GLOBAL_FREE_LEVEL = "FREE";
const LEVEL_ALIASES = Object.freeze({
  "السنة الأولى متوسط": "السنة الأولى",
  "السنة الثانية متوسط": "السنة الثانية",
  "السنة الثالثة متوسط": "السنة الثالثة",
  "السنة الرابعة متوسط": "السنة الرابعة",
  "1am": "السنة الأولى",
  "2am": "السنة الثانية",
  "3am": "السنة الثالثة",
  "4am": "السنة الرابعة",
});
const SCHOOL_SUBJECTS = new Set(["MATH", "PHYSICS", "FREE"]);
const UNIVERSITY_SUBSCRIPTION_TYPES = new Set(["PAID", "FREE"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const PUBLIC_REAL_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[\s'’-]+[\p{L}\p{M}]+)+$/u;
const DISALLOWED_PUBLIC_NAMES = new Set(["guest", "student", "anonymous", "ضيف", "زائر", "مجهول"]);

/** Return a trimmed string, or an empty string for a non-string input. */
function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalLevel(value) {
  const level = normalizeText(value);
  return LEVEL_ALIASES[level] || LEVEL_ALIASES[level.toLowerCase()] || level;
}

function getLiveSubjectLabel(subject) {
  if (subject === "PHYSICS") return "الفيزياء";
  if (subject === "FREE") return "حصة مجانية";
  return "الرياضيات";
}

function isValidLevel(level) {
  return level.length > 0 && level.length <= MAX_LEVEL_LENGTH;
}

function isValidActiveClassType(level, classType) {
  if (level === GLOBAL_FREE_LEVEL) return classType === "FREE";
  return level === UNIVERSITY_LEVEL
    ? UNIVERSITY_SUBSCRIPTION_TYPES.has(classType)
    : SCHOOL_SUBJECTS.has(classType);
}

function isPaidSubscription(student) {
  return student.paymentStage === "PAID" || student.paymentStatus === true;
}

function isValidStudentName(studentName) {
  return studentName.length > 0 && studentName.length <= MAX_NAME_LENGTH;
}

function isValidPublicRealName(value) {
  const name = normalizeText(value).replace(/\s+/g, " ");
  const words = name.split(" ").filter(Boolean);
  const lowered = name.toLocaleLowerCase("en");
  return (
    name.length >= 5 &&
    name.length <= MAX_NAME_LENGTH &&
    words.length >= 2 &&
    !DISALLOWED_PUBLIC_NAMES.has(lowered) &&
    PUBLIC_REAL_NAME_PATTERN.test(name)
  );
}

function normalizeChatMessage(value) {
  const message = normalizeText(value);
  return message.length > 0 && message.length <= MAX_CHAT_MESSAGE_LENGTH ? message : "";
}

function normalizeTeacherChatImageData(value) {
  const imageData = normalizeText(value);
  if (!imageData || imageData.length > MAX_CHAT_IMAGE_DATA_URL_LENGTH) return "";
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(imageData);
  if (!match) return "";
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > 800_000) return "";
  return `data:${match[1].toLowerCase()};base64,${base64}`;
}

function isValidStudentId(studentId) {
  return UUID_PATTERN.test(studentId);
}

function isValidPublicRoomId(roomId) {
  return PUBLIC_ROOM_ID_PATTERN.test(roomId);
}

function publicRoomName(roomId) {
  return `public-invite:${roomId}`;
}

function isInSamePublicRoom(sourceSocket, targetSocket) {
  return Boolean(
    sourceSocket?.data?.publicRoomId &&
      sourceSocket.data.publicRoomId === targetSocket?.data?.publicRoomId
  );
}

function isValidSocketId(socketId) {
  return typeof socketId === "string" && socketId.trim().length > 0;
}

/** Validate the minimum shape of a browser RTCSessionDescriptionInit object. */
function isValidSessionDescription(sdp) {
  return (
    sdp &&
    typeof sdp === "object" &&
    typeof sdp.type === "string" &&
    typeof sdp.sdp === "string" &&
    sdp.sdp.length > 0
  );
}

/**
 * A null ICE candidate is valid and represents end-of-candidates. Otherwise,
 * ensure that the object resembles RTCIceCandidateInit before relaying it.
 */
function isValidIceCandidate(candidate) {
  return (
    candidate === null ||
    (candidate &&
      typeof candidate === "object" &&
      typeof candidate.candidate === "string")
  );
}

/** Validate bounded, normalized teacher annotation data before relaying it. */
function isValidAnnotationSegment(data) {
  const coordinates = [data?.x0, data?.y0, data?.x1, data?.y1];
  const lineWidth = Number(data?.lineWidth);

  return (
    coordinates.every(
      (coordinate) =>
        Number.isFinite(Number(coordinate)) &&
        Number(coordinate) >= 0 &&
        Number(coordinate) <= 1
    ) &&
    typeof data?.color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(data.color) &&
    Number.isFinite(lineWidth) &&
    lineWidth >= 1 &&
    lineWidth <= 12
  );
}

function acknowledge(acknowledgement, payload) {
  if (typeof acknowledgement === "function") {
    acknowledgement(payload);
  }
}

function emitClassroomError(socket, event, message, acknowledgement) {
  const payload = { event, message };
  socket.emit("classroom_error", payload);
  acknowledge(acknowledgement, { ok: false, ...payload });
}

function isInLevelRoom(socket, level) {
  return Boolean(socket && socket.rooms && socket.rooms.has(level));
}

/**
 * Verify that the source and target sockets are current members of the same
 * level room. This is the key privacy boundary for direct signaling.
 */
function shareSameClassroom(sourceSocket, targetSocket, level) {
  return (
    Boolean(targetSocket) &&
    sourceSocket.data.roomLevel === level &&
    targetSocket.data.roomLevel === level &&
    isInLevelRoom(sourceSocket, level) &&
    isInLevelRoom(targetSocket, level)
  );
}

function resetClassroomData(socket, level) {
  if (socket.data.roomLevel === level) {
    socket.data.roomLevel = null;
    socket.data.studentAcademicLevel = null;
    socket.data.role = null;
    socket.data.studentName = null;
    socket.data.studentId = null;
    socket.data.classResumeToken = null;
  }
}

function clearPendingTeacherRecovery(level) {
  const recovery = pendingTeacherRecoveryByLevel.get(level);
  if (recovery?.timer) {
    clearTimeout(recovery.timer);
  }
  pendingTeacherRecoveryByLevel.delete(level);
}

/**
 * Keep an active room reserved when the teacher leaves the studio or loses
 * connectivity. The room is intentionally not auto-closed: only the teacher's
 * explicit “end class” action terminates it for the students.
 */
function holdClassroomForTeacherReturn(level, resumeToken) {
  if (!isValidRecoveryToken(resumeToken)) {
    return false;
  }

  clearPendingTeacherRecovery(level);
  const recovery = {
    resumeToken,
    subject: activeSubjectByLevel.get(level),
    timer: null,
  };
  recovery.timer = setTimeout(() => {
    const currentRecovery = pendingTeacherRecoveryByLevel.get(level);
    const activeTeacherSocketId = activeTeachersByLevel.get(level);
    if (currentRecovery?.resumeToken !== resumeToken || activeTeacherSocketId) {
      return;
    }

    // A teacher did not reclaim the room during the advertised three-minute
    // grace period. Close it so the level never stays blocked indefinitely.
    closeClassroom(level, "teacher_recovery_timeout").catch((error) => {
      console.error(`[Socket.io] recovery timeout cleanup failed for ${level}:`, error);
    });
  }, TEACHER_RECOVERY_GRACE_MS);
  pendingTeacherRecoveryByLevel.set(level, recovery);
  setScreenShareActive(level, false);
  io.to(level).emit("screen_share_state", { level, active: false });
  io.to(level).emit("teacher_reconnecting", { level });
  io.to(`${level}_lobby`).emit("live_class_recovering", { level });
  console.info(`[Socket.io] Holding room ${level} for ${TEACHER_RECOVERY_GRACE_MS / 1000}s until the teacher returns or ends it.`);
  return true;
}

function isScreenShareActive(level) {
  return screenShareActiveByLevel.get(level) === true;
}

function setScreenShareActive(level, active) {
  if (active) {
    screenShareActiveByLevel.set(level, true);
  } else {
    screenShareActiveByLevel.delete(level);
  }
}

function isStudentMicrophoneOpen(level, socketId) {
  return openStudentMicsByLevel.get(level)?.has(socketId) || false;
}

function setStudentMicrophoneOpen(level, socketId, enabled) {
  if (enabled) {
    const openMics = openStudentMicsByLevel.get(level) || new Set();
    openMics.add(socketId);
    openStudentMicsByLevel.set(level, openMics);
    return;
  }
  const openMics = openStudentMicsByLevel.get(level);
  if (!openMics) {
    return;
  }
  openMics.delete(socketId);
  if (openMics.size === 0) {
    openStudentMicsByLevel.delete(level);
  }
}

function isStudentWhiteboardAllowed(level, socketId) {
  return whiteboardAccessByLevel.get(level)?.has(socketId) || false;
}

function setStudentWhiteboardAccess(level, socketId, enabled) {
  if (enabled) {
    const allowed = whiteboardAccessByLevel.get(level) || new Set();
    allowed.add(socketId);
    whiteboardAccessByLevel.set(level, allowed);
    return;
  }
  const allowed = whiteboardAccessByLevel.get(level);
  if (!allowed) return;
  allowed.delete(socketId);
  if (allowed.size === 0) whiteboardAccessByLevel.delete(level);
}

function clearClassroomChatHistory(level) {
  classroomChatHistoryByLevel.delete(level);
}

function appendClassroomChatMessage(level, entry) {
  if (!isValidLevel(level) || !entry?.kind) return;
  const history = classroomChatHistoryByLevel.get(level) || [];
  history.push({ ...entry, sentAt: Date.now() });
  if (history.length > MAX_CLASSROOM_CHAT_HISTORY) {
    history.splice(0, history.length - MAX_CLASSROOM_CHAT_HISTORY);
  }
  classroomChatHistoryByLevel.set(level, history);
}

function getClassroomChatHistory(level, { role, studentId } = {}) {
  const history = classroomChatHistoryByLevel.get(level) || [];
  return history.filter((entry) => (
    role === "teacher" ||
    (entry.kind === "teacher") ||
    String(entry.studentId || "") === String(studentId || "")
  ));
}

function emitClassroomChatHistory(socket, level) {
  socket.emit("classroom_chat_history", {
    level,
    messages: getClassroomChatHistory(level, {
      role: socket.data.role,
      studentId: socket.data.studentId,
    }),
  });
}

async function getClassParticipation(studentId, sessionKey) {
  if (!isValidStudentId(studentId) || !isValidRecoveryToken(sessionKey)) return null;
  try {
    return await prisma.classParticipation.findUnique({
      where: { studentId_sessionKey: { studentId, sessionKey } },
      select: { id: true, studentId: true, level: true, subject: true, sessionKey: true, count: true, lastParticipatedAt: true },
    });
  } catch (error) {
    console.error("Class participation lookup failed:", error);
    return null;
  }
}

async function recordClassParticipation({ studentId, level, subject, sessionKey }) {
  if (!isValidStudentId(studentId) || !isValidLevel(level) || !isValidActiveClassType(level, subject) || !isValidRecoveryToken(sessionKey)) return null;
  try {
    return await prisma.classParticipation.upsert({
      where: { studentId_sessionKey: { studentId, sessionKey } },
      create: { studentId, level, subject, sessionKey, count: 1 },
      update: { count: { increment: 1 }, lastParticipatedAt: new Date() },
      select: { id: true, studentId: true, level: true, subject: true, sessionKey: true, count: true, lastParticipatedAt: true },
    });
  } catch (error) {
    console.error("Class participation record failed:", error);
    return null;
  }
}

function isValidRecoveryToken(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,128}$/.test(value);
}

/**
 * Close a class for every currently connected participant. The class-ended
 * event is emitted before sockets leave, ensuring viewer pages can react.
 */
async function closeClassroom(level, reason) {
  const participants = await io.in(level).fetchSockets();

  // Revoke authority first so no signaling event can be accepted while the
  // room is being cleaned up asynchronously.
  clearPendingTeacherRecovery(level);
  activeTeachersByLevel.delete(level);
  activeSubjectByLevel.delete(level);
  setScreenShareActive(level, false);
  openStudentMicsByLevel.delete(level);
  whiteboardAccessByLevel.delete(level);
  clearClassroomChatHistory(level);
  io.to(level).emit("class_ended", { level, reason });
  // Parent dashboards join a separate passive lobby. They receive only the
  // live-state change—not attendee data, WebRTC signals, or media.
  io.to(`${level}_lobby`).emit("live_class_ended", { level, globalFree: level === GLOBAL_FREE_LEVEL, reason });

  await Promise.all(
    participants.map(async (participant) => {
      await participant.leave(level);
      users.delete(participant.id);
      resetClassroomData(participant, level);
    })
  );

  return participants.length;
}

io.on("connection", (socket) => {
  socketConnected();
  console.info(`[Socket.io] Client connected: ${socket.id}`);

  // Socket data is server-owned after room entry and is used for authorization.
  socket.data.role = null;
      socket.data.roomLevel = null;
    socket.data.studentAcademicLevel = null;
    socket.data.studentName = null;
    socket.data.studentId = null;

  socket.data.lobbyLevel = null;
  socket.data.publicRoomId = null;
  socket.data.publicRole = null;
  socket.data.publicNickname = null;
  socket.data.publicApprovalStatus = null;
  socket.data.publicApproved = false;
  socket.data.publicHandRaised = false;
  socket.data.publicMicOpen = false;
  socket.data.notificationRole = null;
  socket.data.notificationRecipientId = null;
  socket.data.notificationSessionId = null;

  socket.on("register_notification_socket", async (data = {}, acknowledgement) => {
    try {
      const token = typeof data.token === "string" ? data.token.trim() : "";
      if (!token) throw new Error("AUTH_REQUIRED");
      const user = await verifySessionToken(token);
      const role = user.role === "teacher" ? "teacher" : user.role === "parent" ? "parent" : "";
      const recipientId = role === "parent" ? String(user.phone || "") : role === "teacher" ? "teacher" : "";
      const sessionId = String(user.sessionId || "").trim();
      const room = notificationRoom(role, recipientId);
      const sessionRoom = notificationSessionRoom(sessionId);
      if (!room || !sessionRoom) throw new Error("INVALID_RECIPIENT");
      if (socket.data.notificationRole && socket.data.notificationRecipientId) {
        await socket.leave(notificationRoom(socket.data.notificationRole, socket.data.notificationRecipientId));
      }
      if (socket.data.notificationSessionId) {
        await socket.leave(notificationSessionRoom(socket.data.notificationSessionId));
      }
      socket.data.notificationRole = role;
      socket.data.notificationRecipientId = recipientId;
      socket.data.notificationSessionId = sessionId;
      await socket.join(room);
      await socket.join(sessionRoom);
      acknowledge?.({ ok: true, role, recipientId, sessionId });
    } catch (error) {
      acknowledge?.({ ok: false, error: "تعذر تسجيل قناة تنبيهات المتصفح." });
    }
  });

  /**
   * Public invite room: independent from all academic level, payment, subject,
   * and registration rules. The room owner shares screen/audio; visitors join
   * anonymously and receive only the public WebRTC signals and chat messages.
   */
  socket.on("public_host_start", async (data = {}, acknowledgement) => {
    const roomId = normalizeText(data.roomId);
    const hostToken = normalizeText(data.hostToken);
    if (!isValidPublicRoomId(roomId) || !isValidPublicRoomId(hostToken)) {
      return emitClassroomError(socket, "public_host_start", "رابط الدعوة غير صالح.", acknowledgement);
    }

    const roomName = publicRoomName(roomId);
    const existing = publicInviteRooms.get(roomId);
    const existingHost = existing?.hostSocketId ? io.sockets.sockets.get(existing.hostSocketId) : null;
    if (existingHost && existingHost.id !== socket.id) {
      return emitClassroomError(socket, "public_host_start", "هذه الدعوة قيد الاستخدام بالفعل.", acknowledgement);
    }
    if (existing?.hostToken && existing.hostToken !== hostToken) {
      return emitClassroomError(socket, "public_host_start", "رمز تحكم المضيف غير صالح.", acknowledgement);
    }

    await socket.join(roomName);
    socket.data.publicRoomId = roomId;
    socket.data.publicRole = "host";
    publicInviteRooms.set(roomId, { hostSocketId: socket.id, hostToken });
    void ensurePublicArchive(roomId).catch((error) => console.warn("Public archive init failed:", error.message));

    const guests = (await io.in(roomName).fetchSockets())
      .filter((peer) => peer.id !== socket.id && peer.data.publicRole === "guest")
      .map((peer) => ({
        socketId: peer.id,
        nickname: peer.data.publicNickname || "",
        approvalStatus: peer.data.publicApprovalStatus || "pending",
        handRaised: Boolean(peer.data.publicHandRaised),
        micOpen: Boolean(peer.data.publicMicOpen),
      }));
    guests.forEach((guest) => {
      socket.emit("public_guest_join_request", guest);
    });
    acknowledge(acknowledgement, { ok: true, roomId, guests });
  });

  socket.on("public_join_room", async (data = {}, acknowledgement) => {
    const roomId = normalizeText(data.roomId);
    const realName = normalizeText(data.realName || data.nickname).replace(/\s+/g, " ");
    if (!isValidPublicRoomId(roomId)) {
      return emitClassroomError(socket, "public_join_room", "رابط الحصة العامة غير صالح.", acknowledgement);
    }
    if (!isValidPublicRealName(realName)) {
      return emitClassroomError(socket, "public_join_room", "أدخل اسمك الحقيقي الكامل، مثل الاسم واللقب.", acknowledgement);
    }

    const room = publicInviteRooms.get(roomId);
    const hostSocketId = room?.hostSocketId || null;
    const hostSocket = hostSocketId ? io.sockets.sockets.get(hostSocketId) : null;
    if (!room || !hostSocket) {
      return emitClassroomError(socket, "public_join_room", "لا توجد حصة مجانية مفتوحة الآن.", acknowledgement);
    }

    const roomName = publicRoomName(roomId);
    await socket.join(roomName);
    socket.data.publicRoomId = roomId;
    socket.data.publicRole = "guest";
    socket.data.publicNickname = realName;
    socket.data.publicApprovalStatus = "pending";
    socket.data.publicApproved = false;
    socket.data.publicHandRaised = false;
    socket.data.publicMicOpen = false;
    void recordPublicAttendance({ roomId, socketId: socket.id, guestName: realName, event: "joined" }).catch((error) => console.warn("Public attendance save failed:", error.message));

    hostSocket.emit("public_guest_join_request", {
      socketId: socket.id,
      nickname: realName,
      approvalStatus: "pending",
      handRaised: false,
      micOpen: false,
    });
    acknowledge(acknowledgement, { ok: true, roomId, isLive: true, pendingApproval: true });
  });

  socket.on("public_approve_guest", async (data = {}, acknowledgement) => {
    const roomId = socket.data.publicRoomId;
    const targetSocketId = normalizeText(data.targetSocketId);
    const room = roomId ? publicInviteRooms.get(roomId) : null;
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (
      !roomId || socket.data.publicRole !== "host" || room?.hostSocketId !== socket.id ||
      !targetSocket || targetSocket.data.publicRole !== "guest" ||
      targetSocket.data.publicRoomId !== roomId
    ) {
      return emitClassroomError(socket, "public_approve_guest", "تعذر قبول طلب الدخول.", acknowledgement);
    }

    targetSocket.data.publicApproved = true;
    targetSocket.data.publicApprovalStatus = "approved";
    void recordPublicAttendance({ roomId, socketId: targetSocket.id, guestName: targetSocket.data.publicNickname || "ضيف", event: "approved" }).catch((error) => console.warn("Public approval archive failed:", error.message));
    targetSocket.emit("public_guest_approval", { approved: true, message: "تم قبول دخولك من الأستاذ." });
    io.to(socket.id).emit("public_guest_approved", {
      socketId: targetSocket.id,
      nickname: targetSocket.data.publicNickname,
      approvalStatus: "approved",
      handRaised: false,
      micOpen: false,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  socket.on("public_reject_guest", async (data = {}, acknowledgement) => {
    const roomId = socket.data.publicRoomId;
    const targetSocketId = normalizeText(data.targetSocketId);
    const room = roomId ? publicInviteRooms.get(roomId) : null;
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (
      !roomId || socket.data.publicRole !== "host" || room?.hostSocketId !== socket.id ||
      !targetSocket || targetSocket.data.publicRole !== "guest" ||
      targetSocket.data.publicRoomId !== roomId
    ) {
      return emitClassroomError(socket, "public_reject_guest", "تعذر رفض طلب الدخول.", acknowledgement);
    }

    const roomName = publicRoomName(roomId);
    targetSocket.emit("public_guest_approval", {
      approved: false,
      message: "يجب إدخال اسمك الحقيقي الكامل حتى يسمح لك الأستاذ بالدخول.",
    });
    await targetSocket.leave(roomName);
    targetSocket.data.publicRoomId = null;
    targetSocket.data.publicRole = null;
    targetSocket.data.publicNickname = null;
    targetSocket.data.publicApprovalStatus = null;
    targetSocket.data.publicApproved = false;
    io.to(socket.id).emit("public_guest_rejected", { socketId: targetSocket.id });
    acknowledge(acknowledgement, { ok: true });
  });

  socket.on("public_webrtc_offer", (data = {}, acknowledgement) => {
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (
      !["host", "guest"].includes(socket.data.publicRole) ||
      (socket.data.publicRole === "guest" && socket.data.publicApproved !== true) ||
      !targetSocket ||
      !isInSamePublicRoom(socket, targetSocket) ||
      !isValidSessionDescription(data.sdp)
    ) {
      return emitClassroomError(socket, "public_webrtc_offer", "تعذر إرسال بث الدعوة العامة.", acknowledgement);
    }
    targetSocket.emit("public_webrtc_offer", { fromSocketId: socket.id, sdp: data.sdp });
    acknowledge(acknowledgement, { ok: true });
  });

  socket.on("public_webrtc_answer", (data = {}, acknowledgement) => {
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (
      !["host", "guest"].includes(socket.data.publicRole) ||
      (socket.data.publicRole === "guest" && socket.data.publicApproved !== true) ||
      !targetSocket ||
      !isInSamePublicRoom(socket, targetSocket) ||
      !isValidSessionDescription(data.sdp)
    ) {
      return emitClassroomError(socket, "public_webrtc_answer", "تعذر تأكيد بث الدعوة العامة.", acknowledgement);
    }
    targetSocket.emit("public_webrtc_answer", { fromSocketId: socket.id, sdp: data.sdp });
    acknowledge(acknowledgement, { ok: true });
  });

  socket.on("public_webrtc_ice", (data = {}, acknowledgement) => {
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (
      !targetSocket ||
      (socket.data.publicRole === "guest" && socket.data.publicApproved !== true) ||
      !isInSamePublicRoom(socket, targetSocket) ||
      !isValidIceCandidate(data.candidate)
    ) {
      return emitClassroomError(socket, "public_webrtc_ice", "تعذر ربط بث الدعوة العامة.", acknowledgement);
    }
    targetSocket.emit("public_webrtc_ice", { fromSocketId: socket.id, candidate: data.candidate });
    acknowledge(acknowledgement, { ok: true });
  });

  socket.on("public_raise_hand", (data = {}, acknowledgement) => {
    const roomId = socket.data.publicRoomId;
    if (!roomId || socket.data.publicRole !== "guest" || socket.data.publicApproved !== true) {
      return emitClassroomError(socket, "public_raise_hand", "انتظر موافقة الأستاذ أولًا.", acknowledgement);
    }
    socket.data.publicHandRaised = data.raised !== false;
    const room = publicInviteRooms.get(roomId);
    if (room?.hostSocketId) {
      io.to(room.hostSocketId).emit("public_guest_hand_state", {
        socketId: socket.id,
        nickname: socket.data.publicNickname || "ضيف",
        handRaised: socket.data.publicHandRaised,
      });
    }
    acknowledge(acknowledgement, { ok: true, handRaised: socket.data.publicHandRaised });
  });

  socket.on("public_set_guest_mic", (data = {}, acknowledgement) => {
    const roomId = socket.data.publicRoomId;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    const room = roomId ? publicInviteRooms.get(roomId) : null;
    if (
      !roomId || socket.data.publicRole !== "host" || room?.hostSocketId !== socket.id ||
      !targetSocket || targetSocket.data.publicRole !== "guest" || targetSocket.data.publicApproved !== true ||
      !isInSamePublicRoom(socket, targetSocket)
    ) {
      return emitClassroomError(socket, "public_set_guest_mic", "تعذر تحديث مايك الحاضر.", acknowledgement);
    }
    const open = data.open === true;
    targetSocket.data.publicMicOpen = open;
    if (open) targetSocket.data.publicHandRaised = false;
    targetSocket.emit("public_mic_permission", { open });
    io.to(socket.id).emit("public_guest_mic_state", {
      socketId: targetSocket.id,
      nickname: targetSocket.data.publicNickname || "ضيف",
      handRaised: Boolean(targetSocket.data.publicHandRaised),
      micOpen: open,
    });
    acknowledge(acknowledgement, { ok: true, open });
  });

  socket.on("public_chat_message", (data = {}, acknowledgement) => {
    const message = normalizeChatMessage(data.message);
    const roomId = socket.data.publicRoomId;
    if (!roomId || !message || (socket.data.publicRole === "guest" && socket.data.publicApproved !== true)) {
      return emitClassroomError(socket, "public_chat_message", "انتظر موافقة الأستاذ قبل استخدام الدردشة.", acknowledgement);
    }
    const sentAt = new Date().toISOString();
    io.to(publicRoomName(roomId)).emit("public_chat_message", {
      sender: socket.data.publicRole === "host" ? "الأستاذ" : (socket.data.publicNickname || "ضيف"),
      message,
      sentAt,
    });
    void appendPublicChat(roomId, { sender: socket.data.publicRole === "host" ? "الأستاذ" : (socket.data.publicNickname || "ضيف"), message, sentAt }).catch((error) => console.warn("Public chat archive failed:", error.message));
    acknowledge(acknowledgement, { ok: true });
  });

  socket.on("public_host_end", async (_data = {}, acknowledgement) => {
    const roomId = socket.data.publicRoomId;
    const room = roomId ? publicInviteRooms.get(roomId) : null;
    if (!roomId || socket.data.publicRole !== "host" || room?.hostSocketId !== socket.id) {
      return emitClassroomError(socket, "public_host_end", "لا تملك صلاحية إنهاء هذه الدعوة.", acknowledgement);
    }
    const roomName = publicRoomName(roomId);
    publicInviteRooms.delete(roomId);
    void finishPublicArchive(roomId).catch((error) => console.warn("Public archive finish failed:", error.message));
    io.to(roomName).emit("public_room_ended", { roomId });
    const peers = await io.in(roomName).fetchSockets();
    await Promise.all(peers.map(async (peer) => {
      await peer.leave(roomName);
      peer.data.publicRoomId = null;
      peer.data.publicRole = null;
    }));
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Parent dashboards observe a passive room for the student's level. Lobby
   * members never join the WebRTC classroom room and receive no peer details.
   * Payload: { level }
   */
  socket.on("join_level_lobby", async (data = {}, acknowledgement) => {
    try {
      const level = canonicalLevel(data.level);
      if (!(await requireParentMessengerSocketSession(socket, "join_level_lobby", acknowledgement))) return;

      if (!isValidLevel(level) || level === GLOBAL_FREE_LEVEL) {
        return emitClassroomError(
          socket,
          "join_level_lobby",
          "المستوى الدراسي غير صالح.",
          acknowledgement
        );
      }

      if (socket.data.lobbyLevel && socket.data.lobbyLevel !== level) {
        await socket.leave(`${socket.data.lobbyLevel}_lobby`);
      }

      await socket.join(`${level}_lobby`);
      await socket.join(`${GLOBAL_FREE_LEVEL}_lobby`);
      socket.data.lobbyLevel = level;

      const teacherSocketId = activeTeachersByLevel.get(level);
      const teacherSocket = teacherSocketId
        ? io.sockets.sockets.get(teacherSocketId)
        : null;
      const globalTeacherSocketId = activeTeachersByLevel.get(GLOBAL_FREE_LEVEL);
      const globalTeacherSocket = globalTeacherSocketId
        ? io.sockets.sockets.get(globalTeacherSocketId)
        : null;
      const isGlobalFreeLive = Boolean(
        globalTeacherSocket &&
        activeSubjectByLevel.get(GLOBAL_FREE_LEVEL) === "FREE" &&
        isInLevelRoom(globalTeacherSocket, GLOBAL_FREE_LEVEL)
      );
      const isClassLive = Boolean(teacherSocket && isInLevelRoom(teacherSocket, level));
      const isClassRecovering = pendingTeacherRecoveryByLevel.has(level);
      const teacherAbsence = await prisma.teacherAbsence.findUnique({
        where: { level },
        select: { isAbsent: true, updatedAt: true },
      });

      const subject = activeSubjectByLevel.get(level) || null;
      const lobbyClassPayload = {
        level,
        subject,
        subjectLabel: getLiveSubjectLabel(subject),
        startedAt: new Date().toISOString(),
      };
      if (isClassLive) {
        socket.emit("live_class_started", lobbyClassPayload);
      } else if (isClassRecovering) {
        socket.emit("live_class_recovering", lobbyClassPayload);
      } else if (teacherSocketId) {
        activeTeachersByLevel.delete(level);
        activeSubjectByLevel.delete(level);
      }

      if (isGlobalFreeLive) {
        socket.emit("live_class_started", {
          level: GLOBAL_FREE_LEVEL,
          subject: "FREE",
          subjectLabel: "حصة مجانية مفتوحة للجميع",
          globalFree: true,
          startedAt: new Date().toISOString(),
        });
      }

      acknowledge(acknowledgement, {
        ok: true,
        level,
        subject: isGlobalFreeLive ? "FREE" : subject,
        isClassLive: isClassLive || isGlobalFreeLive,
        isClassRecovering: isClassRecovering || pendingTeacherRecoveryByLevel.has(GLOBAL_FREE_LEVEL),
        globalFree: isGlobalFreeLive,
        teacherAbsent: Boolean(teacherAbsence?.isAbsent),
        absenceUpdatedAt: teacherAbsence?.updatedAt || null,
      });
    } catch (error) {
      console.error("[Socket.io] join_level_lobby failed:", error);
      emitClassroomError(
        socket,
        "join_level_lobby",
        "تعذر متابعة حالة الحصة الآن. حاول مرة أخرى.",
        acknowledgement
      );
    }
  });

  /**
   * Teacher starts a classroom for exactly one study level.
   * Payload: { level, subject }
   */
  socket.on("teacher_start_room", async (data = {}, acknowledgement) => {
    try {
      const authenticatedTeacher = await requireTeacherSocketSession(socket, "teacher_start_room", acknowledgement);
      if (!authenticatedTeacher) return;

      const level = normalizeText(data.level);
      let subject = normalizeText(data.subject).toUpperCase();
      const resumeToken = normalizeText(data.resumeToken);

      if (!isValidLevel(level)) {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "المستوى الدراسي غير صالح.",
          acknowledgement
        );
      }

      if (!isValidActiveClassType(level, subject)) {
        const message =
          level === UNIVERSITY_LEVEL
            ? "اختر نوع اشتراك صالحًا للحصة: مدفوع أو مجاني."
            : "اختر مادة صالحة للحصة: الرياضيات أو الفيزياء.";
        return emitClassroomError(socket, "teacher_start_room", message, acknowledgement);
      }

      if (!isValidRecoveryToken(resumeToken)) {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "تعذر تأكيد جلسة الاستوديو. أعد بدء الحصة.",
          acknowledgement
        );
      }

      // A socket must leave/end its current room instead of silently changing
      // role or level, which avoids orphaned classroom state.
      if (socket.data.roomLevel && socket.data.roomLevel !== level) {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "أنهِ أو غادر القسم الحالي قبل بدء قسم جديد.",
          acknowledgement
        );
      }

      if (socket.data.role && socket.data.role !== "teacher") {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "هذه الجلسة منضمة بالفعل إلى القسم كتلميذ.",
          acknowledgement
        );
      }

      const currentTeacherSocketId = activeTeachersByLevel.get(level);
      const currentTeacherSocket = currentTeacherSocketId
        ? io.sockets.sockets.get(currentTeacherSocketId)
        : null;
      const pendingRecovery = pendingTeacherRecoveryByLevel.get(level);
      const isResuming = Boolean(pendingRecovery);

      // At this stage a level accepts one active broadcaster. Authentication
      // middleware should later ensure that only an authenticated teacher can
      // initiate this event.
      if (currentTeacherSocket && currentTeacherSocket.id !== socket.id) {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "توجد حصة مباشرة نشطة لهذا المستوى بالفعل.",
          acknowledgement
        );
      }

      // Only the teacher that started this class can reclaim it during the
      // short recovery window. This prevents another browser from hijacking a
      // live room after an interrupted network connection.
      if (pendingRecovery) {
        if (pendingRecovery.resumeToken !== resumeToken) {
          return emitClassroomError(
            socket,
            "teacher_start_room",
            "الحصة تستعيد اتصال الأستاذ. لا يمكن بدء جلسة جديدة لهذا المستوى الآن.",
            acknowledgement
          );
        }
        if (pendingRecovery.subject !== subject) {
          return emitClassroomError(
            socket,
            "teacher_start_room",
            "لا يمكن تغيير مادة الحصة أثناء استعادة الاتصال.",
            acknowledgement
          );
        }
        clearPendingTeacherRecovery(level);
      } else if (!currentTeacherSocket && currentTeacherSocketId) {
        // Clear only truly stale state. A room in a pending recovery window is
        // deliberately preserved above.
        activeTeachersByLevel.delete(level);
        activeSubjectByLevel.delete(level);
      }

      await socket.join(level);
      socket.data.role = "teacher";
      socket.data.roomLevel = level;
      socket.data.studentName = null;
      socket.data.classResumeToken = resumeToken;
      activeTeachersByLevel.set(level, socket.id);
      activeSubjectByLevel.set(level, subject);
      if (!isResuming && !currentTeacherSocket) {
        clearClassroomChatHistory(level);
      }
      // A new teacher page has no active display stream until it explicitly
      // publishes screen-share state after the room handshake.
      setScreenShareActive(level, false);
      users.set(socket.id, { role: "teacher", level, name: "الأستاذ" });

      const recoveryStudents = isResuming
        ? await Promise.all((await io.in(level).fetchSockets())
            .filter((participant) => participant.id !== socket.id && participant.data.role === "student")
            .map(async (participant) => {
              const participation = await getClassParticipation(participant.data.studentId, resumeToken);
              return {
                socketId: participant.id,
                studentId: participant.data.studentId || null,
                studentName: participant.data.studentName || "تلميذ",
                micEnabled: isStudentMicrophoneOpen(level, participant.id),
                participationCount: participation?.count || 0,
              };
            }))
        : [];

      const isGlobalFreeClass = level === GLOBAL_FREE_LEVEL && subject === "FREE";
      const liveClassPayload = {
        level,
        subject,
        subjectLabel: isGlobalFreeClass ? "حصة مجانية مفتوحة للجميع" : getLiveSubjectLabel(subject),
        globalFree: isGlobalFreeClass,
        startedAt: new Date().toISOString(),
      };

      if (isResuming) {
        io.to(level).emit("teacher_reconnected", { level, subject, globalFree: isGlobalFreeClass });
        if (isGlobalFreeClass) {
          const lobbySockets = await io.fetchSockets();
          lobbySockets.filter((peer) => peer.data.lobbyLevel).forEach((peer) => peer.emit("live_class_resumed", liveClassPayload));
        } else {
          io.to(`${level}_lobby`).emit("live_class_resumed", liveClassPayload);
        }
        socket.emit("recovery_students", { level, students: recoveryStudents });
      } else if (isGlobalFreeClass) {
        const lobbySockets = await io.fetchSockets();
        lobbySockets.filter((peer) => peer.data.lobbyLevel).forEach((peer) => peer.emit("live_class_started", liveClassPayload));
      } else {
        // Notify only passive dashboards/viewers observing this exact level.
        // Socket.io delivers this immediately without requiring a page refresh.
        io.to(`${level}_lobby`).emit("live_class_started", liveClassPayload);
      }

      emitClassroomChatHistory(socket, level);
      socket.emit("room_ready", { level, subject, role: "teacher", resumed: isResuming, globalFree: isGlobalFreeClass });
      acknowledge(acknowledgement, { ok: true, level, subject, role: "teacher", resumed: isResuming, globalFree: isGlobalFreeClass });
      console.info(`[Socket.io] Teacher ${socket.id} ${isResuming ? "resumed" : "started"} room: ${level} (${subject})`);
    } catch (error) {
      console.error("[Socket.io] teacher_start_room failed:", error);
      emitClassroomError(
        socket,
        "teacher_start_room",
        "تعذر بدء الحصة الآن. حاول مرة أخرى.",
        acknowledgement
      );
    }
  });

  /**
   * Student joins the live class for one level.
   * Payload: { level, studentId }. The server resolves the name and level from
   * the database; a client-supplied name is never used for attendance logging.
   */
  socket.on("student_join_room", async (data = {}, acknowledgement) => {
    try {
      const level = canonicalLevel(data.level);
      const studentId = normalizeText(data.studentId);
      if (!(await requireParentMessengerSocketSession(socket, "student_join_room", acknowledgement))) return;

      if (!isValidLevel(level) || !isValidStudentId(studentId)) {
        return emitClassroomError(
          socket,
          "student_join_room",
          "بيانات الالتحاق بالحصة غير صالحة.",
          acknowledgement
        );
      }

      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          studentName: true,
          level: true,
          liveAccessEnabled: true,
          paymentStatus: true,
          paymentStage: true,
          accountActive: true,
          cardReuploadRequested: true,
          mathEnrollment: true,
          physicsEnrollment: true,
        },
      });

      if (!student || canonicalLevel(student.level) !== level || !isValidStudentName(student.studentName)) {
        return emitClassroomError(
          socket,
          "student_join_room",
          "تعذر التحقق من بيانات التلميذ لهذا المستوى.",
          acknowledgement
        );
      }

      const globalTeacherSocketId = activeTeachersByLevel.get(GLOBAL_FREE_LEVEL);
      const globalTeacherSocket = globalTeacherSocketId
        ? io.sockets.sockets.get(globalTeacherSocketId)
        : null;
      const isGlobalFreeActive = Boolean(
        globalTeacherSocket &&
        activeSubjectByLevel.get(GLOBAL_FREE_LEVEL) === "FREE" &&
        isInLevelRoom(globalTeacherSocket, GLOBAL_FREE_LEVEL)
      );
      const classroomLevel = isGlobalFreeActive ? GLOBAL_FREE_LEVEL : level;
      const activeSubject = activeSubjectByLevel.get(classroomLevel);
      const isFreeClass = isGlobalFreeActive || activeSubject === "FREE";

      // Normal classes retain their existing payment rules. A global FREE class
      // is open to every registered student, regardless of payment status.
      const hasSecondaryPaymentAccess =
        student.level !== UNIVERSITY_LEVEL && ["PAID", "PROMISED"].includes(student.paymentStage);
      if (!isGlobalFreeActive && !student.liveAccessEnabled && !hasSecondaryPaymentAccess && !isFreeClass) {
        return emitClassroomError(
          socket,
          "student_join_room",
          "لم تقم بالدفع ولم تخبر الأستاذ أنك ستدفع. يجب الاتصال به على الرقم 0556960950 فورًا.",
          acknowledgement
        );
      }

      if (student.level === UNIVERSITY_LEVEL && !student.accountActive) {
        const message = student.cardReuploadRequested
          ? "يجب رفع بطاقة جديدة قبل دخول الحصة."
          : "حسابك في انتظار تأكيد هوية البطاقة من الأستاذ.";
        return emitClassroomError(socket, "student_join_room", message, acknowledgement);
      }

      const studentName = student.studentName;

      if (socket.data.roomLevel && socket.data.roomLevel !== classroomLevel) {
        return emitClassroomError(
          socket,
          "student_join_room",
          "هذه الجلسة منضمة بالفعل إلى قسم آخر.",
          acknowledgement
        );
      }

      if (socket.data.role && socket.data.role !== "student") {
        return emitClassroomError(
          socket,
          "student_join_room",
          "هذه الجلسة مخصّصة للأستاذ ولا يمكنها الانضمام كتلميذ.",
          acknowledgement
        );
      }

      const teacherSocketId = activeTeachersByLevel.get(classroomLevel);
      const teacherSocket = teacherSocketId
        ? io.sockets.sockets.get(teacherSocketId)
        : null;

      // Do not add students to a room without a reachable broadcaster. During
      // the teacher's short reconnection window, preserve the room state and
      // tell the viewer to retry automatically rather than treating it as ended.
      if (!teacherSocket || !isInLevelRoom(teacherSocket, classroomLevel)) {
        if (pendingTeacherRecoveryByLevel.has(classroomLevel)) {
          const recoveryMessage = "الأستاذ يعيد الاتصال الآن. جارٍ استعادة الحصة تلقائياً…";
          socket.emit("room_recovering", { level, classroomLevel, globalFree: isGlobalFreeActive, message: recoveryMessage });
          return acknowledge(acknowledgement, {
            ok: false,
            recovering: true,
            error: recoveryMessage,
          });
        }
        activeTeachersByLevel.delete(classroomLevel);
        activeSubjectByLevel.delete(classroomLevel);
        socket.emit("room_unavailable", {
          level,
          globalFree: isGlobalFreeActive,
          message: isGlobalFreeActive ? "لا توجد حصة مجانية مفتوحة الآن." : "لا توجد حصة مباشرة نشطة لهذا المستوى حالياً.",
        });

        return acknowledge(acknowledgement, {
          ok: false,
          error: isGlobalFreeActive ? "لا توجد حصة مجانية مفتوحة الآن." : "لا توجد حصة مباشرة نشطة لهذا المستوى حالياً.",
        });
      }

      const isUniversityClass = student.level === UNIVERSITY_LEVEL;
      const isEligibleForActiveSubject = isGlobalFreeActive || (isUniversityClass
        ? (activeSubject === "PAID" && isPaidSubscription(student)) || activeSubject === "FREE"
        : activeSubject === "FREE" ||
          (activeSubject === "MATH" && student.mathEnrollment) ||
          (activeSubject === "PHYSICS" && student.physicsEnrollment));

      if (!isEligibleForActiveSubject) {
        const message = isUniversityClass
          ? activeSubject === "PAID"
            ? "هذه الحصة مخصصة لأصحاب الاشتراك المدفوع."
            : activeSubject === "FREE"
              ? "هذه الحصة مخصصة لأصحاب الاشتراك المجاني."
              : "تعذر التحقق من نوع اشتراك الحصة الحالية. يرجى إعادة المحاولة."
          : activeSubject === "PHYSICS"
            ? "حصة اليوم فيزياء وأنت مشترك في الرياضيات فقط."
            : activeSubject === "MATH"
              ? "حصة اليوم رياضيات وأنت مشترك في الفيزياء فقط."
              : "تعذر التحقق من مادة الحصة الحالية. يرجى إعادة المحاولة.";
        return emitClassroomError(socket, "student_join_room", message, acknowledgement);
      }

      const isAlreadyJoined =
        socket.data.role === "student" &&
        socket.data.roomLevel === classroomLevel &&
        isInLevelRoom(socket, classroomLevel);

      const sessionKey = teacherSocket.data.classResumeToken || null;
      // A repeated join emit from the same socket must not inflate history.
      // A genuinely new connection creates a separate attendance visit.
      if (!isAlreadyJoined) {
        const attendance = await prisma.attendance.create({
          data: { studentId: student.id, level: student.level, sessionKey },
        });
        socket.data.attendanceId = attendance.id;
      }
      socket.data.joinedAt = Date.now();

      await socket.join(classroomLevel);
      socket.data.role = "student";
      socket.data.roomLevel = classroomLevel;
      socket.data.studentAcademicLevel = student.level;
      socket.data.studentName = studentName;
      socket.data.studentId = student.id;
      users.set(socket.id, { role: "student", level: student.level, classroomLevel, name: studentName, studentId: student.id });

      const participation = await getClassParticipation(student.id, sessionKey);
      const participationCount = participation?.count || 0;

      socket.emit("room_joined", {
        level: student.level,
        classroomLevel,
        globalFree: isGlobalFreeActive,
        role: "student",
        teacherSocketId,
        participationCount,
        screenShareActive: isScreenShareActive(classroomLevel),
      });
      emitClassroomChatHistory(socket, classroomLevel);
      if (isStudentMicrophoneOpen(classroomLevel, socket.id)) {
        setStudentWhiteboardAccess(classroomLevel, socket.id, true);
        socket.emit("whiteboard_access_granted", { level: student.level, classroomLevel, globalFree: isGlobalFreeActive });
      }

      // Only the active teacher receives the student identity/socket ID.
      // Other students receive no attendee or signaling information.
      if (!isAlreadyJoined || data.rejoin === true) {
        io.to(teacherSocketId).emit("student_joined", {
          socketId: socket.id,
          studentId: student.id,
          studentName,
          participationCount,
          recovering: data.rejoin === true,
        });
      }

      // The teacher owns the classroom peer connections. Its next offer to this
      // learner includes every currently approved student-audio track.
      io.to(classroomLevel).emit("classroom_track_state", {
        type: "student_joined",
        studentSocketId: socket.id,
      });

      acknowledge(acknowledgement, {
        ok: true,
        level: student.level,
        classroomLevel,
        globalFree: isGlobalFreeActive,
        role: "student",
        teacherSocketId,
      });
      console.info(`[Socket.io] Student ${socket.id} joined room: ${classroomLevel}${isGlobalFreeActive ? " (global free)" : ""}`);
    } catch (error) {
      console.error("[Socket.io] student_join_room failed:", error);
      emitClassroomError(
        socket,
        "student_join_room",
        "تعذر الانضمام إلى الحصة الآن. حاول مرة أخرى.",
        acknowledgement
      );
    }
  });

  /**
   * Relay an SDP offer from the active teacher to exactly one student.
   * Payload: { targetSocketId, sdp }
   */
  socket.on("webrtc_offer", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "teacher" ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isValidSocketId(targetSocketId) ||
      !isValidSessionDescription(data.sdp) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "student"
    ) {
      return emitClassroomError(
        socket,
        "webrtc_offer",
        "تعذر توجيه عرض الاتصال إلى هذا التلميذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_offer", {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Relay an SDP answer from a student to the active teacher only.
   * Payload: { targetSocketId, sdp }
   */
  socket.on("webrtc_answer", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "student" ||
      activeTeachersByLevel.get(level) !== targetSocketId ||
      !isValidSocketId(targetSocketId) ||
      !isValidSessionDescription(data.sdp) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "teacher"
    ) {
      return emitClassroomError(
        socket,
        "webrtc_answer",
        "تعذر توجيه رد الاتصال إلى الأستاذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_answer", {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Relay a follow-up SDP offer after a teacher has explicitly approved a
   * student's microphone. This route remains student -> active teacher only;
   * it cannot be used to contact another student.
   * Payload: { targetSocketId, sdp }
   */
  socket.on("webrtc_renegotiation_offer", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "student" ||
      activeTeachersByLevel.get(level) !== targetSocketId ||
      !isValidSocketId(targetSocketId) ||
      !isValidSessionDescription(data.sdp) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "teacher"
    ) {
      return emitClassroomError(
        socket,
        "webrtc_renegotiation_offer",
        "تعذر توجيه عرض تحديث الصوت إلى الأستاذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_renegotiation_offer", {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Relay the teacher's answer to a student's approved-microphone offer.
   * Payload: { targetSocketId, sdp }
   */
  socket.on("webrtc_renegotiation_answer", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "teacher" ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isValidSocketId(targetSocketId) ||
      !isValidSessionDescription(data.sdp) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "student"
    ) {
      return emitClassroomError(
        socket,
        "webrtc_renegotiation_answer",
        "تعذر توجيه رد تحديث الصوت إلى التلميذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_renegotiation_answer", {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * The teacher explicitly publishes whether a real display stream is active.
   * The static level image is never represented by this flag.
   */
  socket.on("teacher_screen_share_state", (data = {}, acknowledgement) => {
    const level = normalizeText(data.level);
    const active = Boolean(data.active);
    if (
      !isValidLevel(level) ||
      socket.data.role !== "teacher" ||
      socket.data.roomLevel !== level ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isInLevelRoom(socket, level)
    ) {
      return emitClassroomError(
        socket,
        "teacher_screen_share_state",
        "لا تملك صلاحية تغيير حالة مشاركة الشاشة لهذه الحصة.",
        acknowledgement
      );
    }

    const revision = Number.isSafeInteger(data.revision) && data.revision > 0
      ? data.revision
      : Date.now();
    setScreenShareActive(level, active);
    io.to(level).emit("screen_share_state", { level, active, revision });
    acknowledge(acknowledgement, { ok: true, level, active, revision });
  });

  /**
   * Relay one ICE candidate between an active teacher and one of that level's
   * students. Student-to-student routing is rejected by design.
   * Payload: { targetSocketId, candidate }
   */
  socket.on("webrtc_ice_candidate", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    const isTeacherToStudent =
      socket.data.role === "teacher" &&
      activeTeachersByLevel.get(level) === socket.id &&
      targetSocket?.data.role === "student";

    const isStudentToTeacher =
      socket.data.role === "student" &&
      activeTeachersByLevel.get(level) === targetSocketId &&
      targetSocket?.data.role === "teacher";

    if (
      !isValidSocketId(targetSocketId) ||
      !isValidIceCandidate(data.candidate) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      (!isTeacherToStudent && !isStudentToTeacher)
    ) {
      return emitClassroomError(
        socket,
        "webrtc_ice_candidate",
        "تعذر توجيه معلومات الاتصال الشبكي.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_ice_candidate", {
      candidate: data.candidate,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * A student raises a hand. The level and name in the client payload are not
   * trusted; the server uses the level/name saved at join time instead.
   * Payload: { level, studentName } (accepted for frontend compatibility)
   */
  socket.on("student_raise_hand", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const teacherSocketId = activeTeachersByLevel.get(level);
    const teacherSocket = teacherSocketId
      ? io.sockets.sockets.get(teacherSocketId)
      : null;

    if (
      socket.data.role !== "student" ||
      !isValidLevel(level || "") ||
      !teacherSocket ||
      !shareSameClassroom(socket, teacherSocket, level)
    ) {
      return emitClassroomError(
        socket,
        "student_raise_hand",
        "لا يمكنك رفع اليد خارج حصة نشطة.",
        acknowledgement
      );
    }

    const studentDisplayName =
      socket.data.studentName || data.studentName || data.name || data.fullName || "تلميذ";
    io.to(teacherSocketId).emit("hand_raised", {
      socketId: socket.id,
      studentName: studentDisplayName,
      name: studentDisplayName,
      level,
    });
    void sendTelegramNotification({
      title: "طلب رفع اليد",
      body: `طلب التلميذ التحدث في الحصة.\nالتلميذ: ${socket.data.studentName || "غير معروف"}\nالمستوى: ${level}`,
    }).catch((error) => console.warn("Optional Telegram hand-raise notification failed:", error.message));
    acknowledge(acknowledgement, { ok: true });
  });

  /** A student cancels a pending hand-raise request before teacher approval. */
  socket.on("student_lower_hand", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const teacherSocketId = activeTeachersByLevel.get(level);
    const teacherSocket = teacherSocketId ? io.sockets.sockets.get(teacherSocketId) : null;

    if (
      socket.data.role !== "student" ||
      !isValidLevel(level || "") ||
      !teacherSocket ||
      !shareSameClassroom(socket, teacherSocket, level)
    ) {
      return emitClassroomError(
        socket,
        "student_lower_hand",
        "تعذر تنزيل اليد خارج حصة نشطة.",
        acknowledgement
      );
    }

    io.to(teacherSocketId).emit("hand_lowered", { socketId: socket.id });
    void sendTelegramNotification({
      title: "إنزال اليد",
      body: `ألغى التلميذ طلب التحدث.\nالتلميذ: ${socket.data.studentName || "غير معروف"}\nالمستوى: ${level}`,
    }).catch((error) => console.warn("Optional Telegram hand-lower notification failed:", error.message));
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Teacher directly opens or closes a same-level student's microphone.
   * This command is independent of hand-raising, while preserving the same
   * room and role authorization boundaries.
   * Payload: { targetSocketId, enabled }
   */
  socket.on("teacher_set_mic", async (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    const enabled = data.enabled !== false;

    if (
      socket.data.role !== "teacher" ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isValidSocketId(targetSocketId) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "student"
    ) {
      return emitClassroomError(
        socket,
        "teacher_set_mic",
        "تعذر تغيير حالة مايك هذا التلميذ.",
        acknowledgement
      );
    }

    // Persist the teacher decision before notifying the student. This makes the
    // decision available to the teacher browser during a short reconnection and
    // prevents a late-arriving audio track from being rebroadcast after closure.
    const wasOpen = isStudentMicrophoneOpen(level, targetSocketId);
    setStudentMicrophoneOpen(level, targetSocketId, enabled);
    setStudentWhiteboardAccess(level, targetSocketId, enabled);

    const sessionKey = socket.data.classResumeToken;
    if (enabled && !wasOpen) {
      targetSocket.data.micStartedAt = Date.now();
    } else if (!enabled && wasOpen && targetSocket.data.micStartedAt) {
      const micDurationSeconds = Math.floor((Date.now() - targetSocket.data.micStartedAt) / 1000);
      targetSocket.data.micStartedAt = null;
      if (micDurationSeconds >= 10) {
        const participation = await recordClassParticipation({
          studentId: targetSocket.data.studentId,
          level: targetSocket.data.studentAcademicLevel || level,
          subject: activeSubjectByLevel.get(level),
          sessionKey,
        });
        const participationCount = participation?.count || 0;
        io.to(targetSocketId).emit("participation_count_updated", { level, count: participationCount });
        io.to(socket.id).emit("student_participation_updated", { socketId: targetSocketId, count: participationCount });
      }
    }

    io.to(targetSocketId).emit(
      enabled ? "permission_granted" : "microphone_revoked",
      { level }
    );
    io.to(targetSocketId).emit(
      enabled ? "whiteboard_access_granted" : "whiteboard_access_revoked",
      { level }
    );

    // Tell every page that the room's expected audio tracks changed. The teacher
    // then adds/removes the matching sender on every existing RTCPeerConnection
    // and sends a fresh SDP offer to each student without reloading any page.
    io.to(level).emit("classroom_track_state", {
      type: "student_audio",
      speakerSocketId: targetSocketId,
      enabled,
    });

    // The teacher uses this authoritative event to update the existing stable
    // Web Audio mix. No viewer page reload or peer-per-student route is needed.
    io.to(socket.id).emit("student_mic_state_changed", {
      socketId: targetSocketId,
      enabled,
    });
    acknowledge(acknowledgement, { ok: true, enabled });
  });

  // Kept as a compatibility route for teacher pages that are still open while
  // the new client bundle is being deployed.
  socket.on("teacher_approve_mic", async (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "teacher" ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isValidSocketId(targetSocketId) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "student"
    ) {
      return emitClassroomError(
        socket,
        "teacher_approve_mic",
        "تعذر منح الإذن لهذا التلميذ.",
        acknowledgement
      );
    }

    const wasOpen = isStudentMicrophoneOpen(level, targetSocketId);
    setStudentMicrophoneOpen(level, targetSocketId, true);
    setStudentWhiteboardAccess(level, targetSocketId, true);
    const participation = wasOpen
      ? await getClassParticipation(targetSocket.data.studentId, socket.data.classResumeToken)
      : await recordClassParticipation({
          studentId: targetSocket.data.studentId,
          level: targetSocket.data.studentAcademicLevel || level,
          subject: activeSubjectByLevel.get(level),
          sessionKey: socket.data.classResumeToken,
        });
    const participationCount = participation?.count || 0;
    io.to(targetSocketId).emit("participation_count_updated", { level, count: participationCount });
    io.to(socket.id).emit("student_participation_updated", { socketId: targetSocketId, count: participationCount });
    io.to(targetSocketId).emit("permission_granted", { level });
    io.to(targetSocketId).emit("whiteboard_access_granted", { level });
    io.to(level).emit("classroom_track_state", {
      type: "student_audio",
      speakerSocketId: targetSocketId,
      enabled: true,
    });
    io.to(socket.id).emit("student_mic_state_changed", {
      socketId: targetSocketId,
      enabled: true,
    });
    acknowledge(acknowledgement, { ok: true, enabled: true });
  });

  /**
   * Relay a normalized canvas segment from the active teacher or from a student
   * whose microphone is currently open. The level is always server-owned.
   */
  function relayDrawData(data = {}, acknowledgement, eventName = "draw_data") {
    const level = socket.data.roomLevel;
    const isTeacher = socket.data.role === "teacher" && activeTeachersByLevel.get(level) === socket.id;
    const isAllowedStudent = socket.data.role === "student" && isStudentWhiteboardAllowed(level, socket.id);

    if (
      (!isTeacher && !isAllowedStudent) ||
      !isValidLevel(level || "") ||
      !isInLevelRoom(socket, level) ||
      !isValidAnnotationSegment(data)
    ) {
      return emitClassroomError(
        socket,
        eventName,
        "لا تملك صلاحية إرسال الشروحات إلى هذه الحصة.",
        acknowledgement
      );
    }

    const segment = {
      x0: Number(data.x0),
      y0: Number(data.y0),
      x1: Number(data.x1),
      y1: Number(data.y1),
      color: data.color,
      lineWidth: Number(data.lineWidth),
      authorSocketId: socket.id,
    };

    io.to(level).emit("receive_draw_data", segment);
    acknowledge(acknowledgement, { ok: true });
  }

  socket.on("draw_data", (data = {}, acknowledgement) => relayDrawData(data, acknowledgement, "draw_data"));
  socket.on("draw_line", (data = {}, acknowledgement) => relayDrawData(data, acknowledgement, "draw_line"));

  /** Clear the synchronized canvas for every student in the active room. */
  socket.on("clear_board", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;

    if (
      socket.data.role !== "teacher" ||
      !isValidLevel(level || "") ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isInLevelRoom(socket, level)
    ) {
      return emitClassroomError(
        socket,
        "clear_board",
        "لا تملك صلاحية مسح لوحة هذه الحصة.",
        acknowledgement
      );
    }

    socket.to(level).emit("board_cleared");
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Send a student's question only to the active teacher for the student's
   * current room. Client-provided level and name are ignored deliberately.
   */
  socket.on("student_send_message", async (data = {}, acknowledgement) => {
    try {
      const level = socket.data.roomLevel;
      const teacherSocketId = activeTeachersByLevel.get(level);
      const teacherSocket = teacherSocketId
        ? io.sockets.sockets.get(teacherSocketId)
        : null;
      const message = normalizeChatMessage(data.message);
      const imageId = normalizeText(data.imageId);

      if (
        socket.data.role !== "student" ||
        !isValidLevel(level || "") ||
        (!message && !imageId) ||
        !teacherSocket ||
        teacherSocket.data.role !== "teacher" ||
        !shareSameClassroom(socket, teacherSocket, level)
      ) {
        return emitClassroomError(
          socket,
          "student_send_message",
          "تعذر إرسال السؤال إلى الأستاذ. تأكد من اتصال الحصة.",
          acknowledgement
        );
      }

      let approvedImageId = null;
      if (imageId) {
        if (!isValidStudentId(imageId)) {
          return emitClassroomError(
            socket,
            "student_send_message",
            "صورة السؤال غير صالحة.",
            acknowledgement
          );
        }

        const image = await prisma.liveQuestionImage.findUnique({
          where: { id: imageId },
          select: { id: true, studentId: true, level: true },
        });

        if (
          !image ||
          image.studentId !== socket.data.studentId ||
          image.level !== level
        ) {
          return emitClassroomError(
            socket,
            "student_send_message",
            "لا تملك صلاحية إرسال هذه الصورة.",
            acknowledgement
          );
        }

        approvedImageId = image.id;
      }

      const chatEntry = {
        kind: "student",
        level,
        studentId: socket.data.studentId,
        socketId: socket.id,
        studentName: socket.data.studentName,
        message,
        imageId: approvedImageId,
      };
      appendClassroomChatMessage(level, chatEntry);
      // This is intentionally a direct socket emission—not a level-room broadcast.
      io.to(teacherSocketId).emit("student_message_received", chatEntry);
      void sendTelegramNotification({
        title: "رسالة جديدة في الحصة",
        body: `أرسل التلميذ رسالة إلى الأستاذ.\nالتلميذ: ${socket.data.studentName || "غير معروف"}\nالمستوى: ${level}\nالنص: ${message.slice(0, 500)}${approvedImageId ? "\nمرفق: صورة" : ""}`,
      }).catch((error) => console.warn("Optional Telegram live-message notification failed:", error.message));
      acknowledge(acknowledgement, { ok: true, imageId: approvedImageId });
    } catch (error) {
      console.error("student_send_message failed:", error);
      emitClassroomError(
        socket,
        "student_send_message",
        "تعذر إرسال السؤال المصوّر إلى الأستاذ.",
        acknowledgement
      );
    }
  });

  /** Broadcast an active teacher's reply to only the students in that level. */
  socket.on("teacher_send_message", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const message = normalizeChatMessage(data.message);
    const imageData = normalizeTeacherChatImageData(data.imageData);
    const hasInvalidImage = Boolean(data.imageData) && !imageData;

    if (
      socket.data.role !== "teacher" ||
      !isValidLevel(level || "") ||
      (!message && !imageData) ||
      hasInvalidImage ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isInLevelRoom(socket, level)
    ) {
      return emitClassroomError(
        socket,
        "teacher_send_message",
        "تعذر إرسال الرسالة إلى الحصة.",
        acknowledgement
      );
    }

    const chatEntry = {
      kind: "teacher",
      level,
      message,
      imageData: imageData || null,
    };
    appendClassroomChatMessage(level, chatEntry);
    socket.to(level).emit("teacher_message_received", chatEntry);
    acknowledge(acknowledgement, { ok: true, imageSent: Boolean(imageData) });
  });

  /**
   * The teacher can leave the studio without terminating the classroom. The
   * recovery token reserves the room for the same teacher to resume later.
   * Payload: { level, resumeToken }
   */
  socket.on("teacher_leave_studio", async (data = {}, acknowledgement) => {
    try {
      const level = normalizeText(data.level);
      const resumeToken = normalizeText(data.resumeToken);

      if (
        !isValidLevel(level) ||
        socket.data.role !== "teacher" ||
        socket.data.roomLevel !== level ||
        activeTeachersByLevel.get(level) !== socket.id ||
        !isInLevelRoom(socket, level) ||
        !isValidRecoveryToken(resumeToken) ||
        socket.data.classResumeToken !== resumeToken
      ) {
        return emitClassroomError(
          socket,
          "teacher_leave_studio",
          "تعذر مغادرة الاستوديو مع إبقاء الحصة مفتوحة.",
          acknowledgement
        );
      }

      await socket.leave(level);
      users.delete(socket.id);
      setScreenShareActive(level, false);
      io.to(level).emit("screen_share_state", { level, active: false });
      activeTeachersByLevel.delete(level);
      resetClassroomData(socket, level);
      holdClassroomForTeacherReturn(level, resumeToken);

      acknowledge(acknowledgement, { ok: true, level, heldForReturn: true });
      console.info(`[Socket.io] Teacher ${socket.id} left studio; room held: ${level}`);
    } catch (error) {
      console.error("teacher_leave_studio failed:", error);
      emitClassroomError(
        socket,
        "teacher_leave_studio",
        "تعذر حفظ الحصة عند مغادرة الاستوديو.",
        acknowledgement
      );
    }
  });

  /**
   * Active teacher ends their class and removes every socket from the level.
   * Payload: { level }
   */
  socket.on("teacher_end_class", async (data = {}, acknowledgement) => {
    try {
      const authenticatedTeacher = await requireTeacherSocketSession(socket, "teacher_end_class", acknowledgement);
      if (!authenticatedTeacher) return;

      const level = normalizeText(data.level);

      if (
        !isValidLevel(level) ||
        socket.data.role !== "teacher" ||
        socket.data.roomLevel !== level ||
        activeTeachersByLevel.get(level) !== socket.id ||
        !isInLevelRoom(socket, level)
      ) {
        return emitClassroomError(
          socket,
          "teacher_end_class",
          "لا تملك صلاحية إنهاء هذه الحصة.",
          acknowledgement
        );
      }

      const participantCount = await closeClassroom(level, "teacher_ended");
      acknowledge(acknowledgement, { ok: true, level, participantCount });
      console.info(`[Socket.io] Teacher ${socket.id} ended room: ${level}`);
    } catch (error) {
      console.error("[Socket.io] teacher_end_class failed:", error);
      emitClassroomError(
        socket,
        "teacher_end_class",
        "تعذر إنهاء الحصة الآن. حاول مرة أخرى.",
        acknowledgement
      );
    }
  });

  /**
   * Resolve classroom departure using the presence map. A student departure is
   * sent only to the active teacher; a teacher departure alerts viewers before
   * the existing class-close path removes every remaining socket and record.
   */
  socket.on("disconnect", (reason) => {
    socketDisconnected();
    const publicRoomId = socket.data.publicRoomId;
    const publicRole = socket.data.publicRole;
    if (publicRoomId) {
      const roomName = publicRoomName(publicRoomId);
      const publicRoom = publicInviteRooms.get(publicRoomId);
      if (publicRole === "host" && publicRoom?.hostSocketId === socket.id) {
        publicInviteRooms.delete(publicRoomId);
        void finishPublicArchive(publicRoomId).catch((error) => console.warn("Public archive disconnect finish failed:", error.message));
        io.to(roomName).emit("public_room_ended", { roomId: publicRoomId });
      } else if (publicRole === "guest" && publicRoom?.hostSocketId) {
        void recordPublicAttendance({ roomId: publicRoomId, socketId: socket.id, guestName: socket.data.publicNickname || "ضيف", event: "left" }).catch((error) => console.warn("Public attendance leave save failed:", error.message));
        io.to(publicRoom.hostSocketId).emit("public_guest_left", { socketId: socket.id });
      }
    }

    const user = users.get(socket.id);
    users.delete(socket.id);
    console.info(`[Socket.io] Client disconnected: ${socket.id} (${reason})`);

    if (!user) {
      return;
    }

    const { role, level, name } = user;

    if (role === "student") {
      // Global FREE classes keep the student's academic level in `level` but
      // use classroomLevel="FREE" for the actual teacher room.
      const classroomLevel = user.classroomLevel || socket.data.roomLevel || level;
      setStudentMicrophoneOpen(classroomLevel, socket.id, false);
      setStudentWhiteboardAccess(classroomLevel, socket.id, false);

      // Record final attendance duration for this session
      const attendanceId = socket.data.attendanceId;
      const joinedAt = socket.data.joinedAt;
      if (attendanceId && joinedAt) {
        const durationMinutes = Math.floor((Date.now() - joinedAt) / 60000);
        if (durationMinutes > 0) {
          void prisma.attendance.update({
            where: { id: attendanceId },
            data: { durationMinutes: { increment: durationMinutes } }
          }).catch(err => console.error("Failed to update attendance duration on disconnect:", err));
        }
      }

      // Record final mic participation if still open
      if (socket.data.micStartedAt) {
        const micDurationSeconds = Math.floor((Date.now() - socket.data.micStartedAt) / 1000);
        if (micDurationSeconds >= 10) {
          const teacherSocketId = activeTeachersByLevel.get(classroomLevel);
          const teacherSocket = teacherSocketId ? io.sockets.sockets.get(teacherSocketId) : null;
          const sessionKey = teacherSocket?.data?.classResumeToken;
          if (sessionKey) {
            void recordClassParticipation({
              studentId: socket.data.studentId,
              level: socket.data.studentAcademicLevel || level,
              subject: activeSubjectByLevel.get(classroomLevel),
              sessionKey,
            }).catch(err => console.error("Failed to record final mic participation on disconnect:", err));
          }
        }
      }

      const teacherSocketId = activeTeachersByLevel.get(classroomLevel);
      const teacherSocket = teacherSocketId
        ? io.sockets.sockets.get(teacherSocketId)
        : null;

      if (teacherSocket && teacherSocket.id !== socket.id) {
        io.to(teacherSocket.id).emit("student_left", {
          socketId: socket.id,
          studentId: socket.data.studentId || user.studentId || null,
          studentName: name,
        });
      }
      return;
    }

    if (role === "teacher" && activeTeachersByLevel.get(level) === socket.id) {
      const resumeToken = socket.data.classResumeToken;

      if (holdClassroomForTeacherReturn(level, resumeToken)) {
        activeTeachersByLevel.delete(level);
        return;
      }

      // A malformed session has no recovery token, so it cannot safely retain
      // the room and follows the normal closure path.
      closeClassroom(level, "teacher_disconnected").catch((error) => {
        console.error("[Socket.io] disconnect cleanup failed:", error);
      });
    }
  });
});

// Terminal Express error handler. Route-specific handlers can return useful
// 4xx responses; unexpected errors are logged server-side and never expose a
// stack trace or internal database detail to clients.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const incidentId = crypto.randomUUID();
  console.error(`Unhandled Express error [${incidentId}]:`, error);
  void prisma.auditLog.create({
    data: {
      actorRole: req.user?.role || "system",
      actorId: req.user?.sessionId || null,
      action: "HTTP_UNHANDLED_ERROR",
      entityType: "HttpRequest",
      entityId: incidentId,
      metadata: JSON.stringify({ method: req.method, path: req.path, code: error?.code || null }),
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
    },
  }).catch(() => {});
  res.setHeader("X-Incident-ID", incidentId);
  return res.status(500).json({
    status: "error",
    incidentId,
    error: "حدث خطأ غير متوقع في الخادم. حاول مرة أخرى لاحقاً.",
  });
});

const PORT = process.env.PORT || 3000;

function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  const required = ["DATABASE_URL", "JWT_SECRET", "TEACHER_PASSCODE", "CLIENT_ORIGIN"];
  const missing = required.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) {
    throw new Error(`Missing required production configuration: ${missing.join(", ")}`);
  }
  if (process.env.ENABLE_OPEN_CORS === "true") {
    console.warn("WARNING: ENABLE_OPEN_CORS=true in production; restrict CLIENT_ORIGIN before handling sensitive traffic.");
  }
}

let stopBackgroundJobs = null;
let redisClients = [];

async function configureSocketScaling() {
  const redisUrl = String(process.env.REDIS_URL || "").trim();
  if (!redisUrl) {
    console.info("REDIS_URL is not set; Socket.io is running in single-instance mode.");
    return;
  }
  try {
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    pubClient.on("error", (error) => console.warn("Redis pub client error:", error.message));
    subClient.on("error", (error) => console.warn("Redis sub client error:", error.message));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    redisClients = [pubClient, subClient];
    console.info("Socket.io Redis adapter enabled.");
  } catch (error) {
    console.warn("Redis adapter unavailable; continuing in single-instance mode:", error.message);
  }
}

async function shutdown(signal) {
  console.info(`Received ${signal}; closing HTTP server and Prisma connection.`);
  stopBackgroundJobs?.();
  await Promise.allSettled(redisClients.map((client) => client.quit()));
  redisClients = [];

  httpServer.close(async (serverError) => {
    try {
      await prisma.$disconnect();
    } catch (prismaError) {
      console.error("Prisma shutdown error:", prismaError);
    }

    process.exit(serverError ? 1 : 0);
  });

  // Do not allow a hung WebRTC/Socket.io connection to prevent Railway from
  // terminating the process without Prisma cleanup.
  setTimeout(() => process.exit(1), 10_000).unref();
}

if (require.main === module) {
  void (async () => {
    assertProductionConfiguration();
    await configureSocketScaling();
    stopBackgroundJobs = startBackgroundJobs();
    httpServer.listen(PORT, () => {
      console.info(`Server listening on port ${PORT}`);
      void configureTelegramWebhook()
        .then((result) => {
          if (result?.skipped) console.info(`Telegram webhook skipped: ${result.reason}`);
          else if (result?.ok) console.info("Telegram webhook configured.");
        })
        .catch((error) => console.warn("Telegram webhook setup failed:", error.message));
    });
  })().catch((error) => {
    console.error("Unable to start server:", error);
    process.exit(1);
  });

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

// Exporting makes the API and Socket.io server testable without binding a port.
module.exports = { app, httpServer, io };
