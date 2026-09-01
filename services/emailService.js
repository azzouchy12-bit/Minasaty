"use strict";

const nodemailer = require("nodemailer");

const EMAIL_REQUEST_TIMEOUT_MS = 15_000;
let transporter = null;
let transporterKey = "";

function getEmailConfig() {
  const provider = String(process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const password = String(process.env.SMTP_PASSWORD || "");
  const from = String(process.env.EMAIL_FROM || user).trim();
  const configured = provider === "smtp" && Boolean(host && Number.isInteger(port) && port > 0 && port <= 65_535 && user && password && from);
  return { provider, host, port, user, password, from, configured };
}

function getEmailStatus() {
  const config = getEmailConfig();
  return {
    configured: config.configured,
    provider: config.provider,
    reason: config.configured ? null : "EMAIL_NOT_CONFIGURED",
  };
}

function getTransporter(config) {
  const key = `${config.host}:${config.port}:${config.user}:${config.from}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: EMAIL_REQUEST_TIMEOUT_MS,
      greetingTimeout: EMAIL_REQUEST_TIMEOUT_MS,
      socketTimeout: EMAIL_REQUEST_TIMEOUT_MS,
    });
    transporterKey = key;
  }
  return transporter;
}

async function sendEmail({ to, subject, html = "", text = "" } = {}) {
  const config = getEmailConfig();
  if (!config.configured) return { sent: false, configured: false, skipped: true, reason: "EMAIL_NOT_CONFIGURED" };

  const recipient = String(to || "").trim();
  const title = String(subject || "").trim();
  const htmlBody = String(html || "");
  const textBody = String(text || "");
  if (!recipient || !title || (!htmlBody && !textBody)) {
    return { sent: false, configured: true, skipped: true, reason: "INVALID_EMAIL_MESSAGE" };
  }

  const result = await getTransporter(config).sendMail({
    from: config.from,
    to: recipient,
    subject: title,
    ...(htmlBody ? { html: htmlBody } : {}),
    ...(textBody ? { text: textBody } : {}),
  });
  return { sent: true, configured: true, messageId: result.messageId || null };
}

module.exports = { getEmailConfig, getEmailStatus, sendEmail };
