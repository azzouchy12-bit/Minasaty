const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const JWT_ISSUER = "online-tutoring-platform";
const JWT_AUDIENCE = "online-tutoring-platform-web";
// Keep sessions effectively persistent for the user while retaining a server-side
// expiry and explicit revocation controls. A literal infinite bearer token would
// remain usable forever if copied from the browser.
const SESSION_DURATION_DAYS = 36500;
const JWT_EXPIRES_IN = `${SESSION_DURATION_DAYS}d`;
const SESSION_DURATION_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;
let sessionTakeoverNotifier = null;

function setSessionTakeoverNotifier(notifier) {
  sessionTakeoverNotifier = typeof notifier === "function" ? notifier : null;
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short.");
  }
  return secret;
}

function getRequestMetadata(req) {
  return {
    userAgent: typeof req?.get === "function" ? req.get("user-agent")?.slice(0, 1000) : null,
    ipAddress: typeof req?.ip === "string" ? req.ip.slice(0, 100) : null,
  };
}

async function issueSession(payload, req) {
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const role = String(payload.role || "unknown");
  const subjectId = payload.phone ? String(payload.phone) : null;
  const token = jwt.sign(
    { ...payload, sessionId: tokenId },
    getJwtSecret(),
    {
      algorithm: "HS256",
      expiresIn: JWT_EXPIRES_IN,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: tokenId,
    }
  );

  const metadata = getRequestMetadata(req);
  const now = new Date();
  const previousSessions = await prisma.session.findMany({
    where: { role, subjectId, revokedAt: null, expiresAt: { gt: now } },
    select: { tokenId: true, userAgent: true, ipAddress: true },
  });

  const isTeacher = role === "teacher";

  // Only enforce single-session takeover for non-teacher roles (students/parents).
  // The teacher is explicitly permitted to open both PC (computer broadcast) and mobile phone
  // concurrently to manage attendance, WhatsApp contact with absentees, and live chat.
  if (!isTeacher && sessionTakeoverNotifier && previousSessions.length) {
    await Promise.allSettled(previousSessions.map((previousSession) => sessionTakeoverNotifier({
      previousSession,
      role,
      subjectId,
      newSessionId: tokenId,
      metadata,
    })));
  }

  await prisma.$transaction(async (tx) => {
    // One active session per account for parents and students.
    // For teacher, do not revoke existing sessions so PC and phone remain active together.
    if (!isTeacher) {
      await tx.session.updateMany({
        where: {
          role,
          subjectId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
    }
    await tx.session.create({
      data: {
        tokenId,
        role,
        subjectId,
        studentId: payload.studentId || null,
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
        expiresAt,
      },
    });
  });

  return { token, tokenId, expiresAt, expiresIn: JWT_EXPIRES_IN };
}

async function verifySessionToken(token) {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  if (!decoded.sessionId) {
    // Compatibility for tokens issued before the session table was introduced.
    return decoded;
  }

  const session = await prisma.session.findUnique({ where: { tokenId: decoded.sessionId } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new Error("SESSION_REVOKED");
  }

  if (session.lastSeenAt.getTime() < Date.now() - 5 * 60 * 1000) {
    void prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    }).catch(() => {});
  }

  return decoded;
}

async function revokeSessionByTokenId(tokenId) {
  if (!tokenId) return false;
  const result = await prisma.session.updateMany({
    where: { tokenId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

module.exports = {
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_EXPIRES_IN,
  issueSession,
  setSessionTakeoverNotifier,
  verifySessionToken,
  revokeSessionByTokenId,
};
