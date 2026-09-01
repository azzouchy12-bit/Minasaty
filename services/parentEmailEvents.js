"use strict";

const prisma = require("../lib/prisma");
const { sendEmail } = require("./emailService");

async function sendVerifiedParentEmail({ parentPhone, subject, text, html } = {}) {
  const phone = String(parentPhone || "").trim();
  if (!phone) return { sent: false, skipped: true, reason: "PARENT_PHONE_REQUIRED" };
  const credential = await prisma.parentCredential.findUnique({
    where: { parentPhone: phone },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!credential?.email || !credential.emailVerifiedAt) return { sent: false, skipped: true, reason: "EMAIL_NOT_VERIFIED" };
  return sendEmail({ to: credential.email, subject, text, html });
}

module.exports = { sendVerifiedParentEmail };
