"use strict";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email && email.length <= 254 && EMAIL_PATTERN.test(email) ? email : "";
}

module.exports = { normalizeEmail };
