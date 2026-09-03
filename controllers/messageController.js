"use strict";

const fs = require("fs");
const path = require("path");
const prisma = require("../lib/prisma");
const { sendPushToRecipient } = require("../utils/push");
const { notifyTelegram } = require("../services/telegramService");
const { sendEmail } = require("../services/emailService");

const MAX_MESSAGE_LENGTH = 4_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTACHMENT_PREFIX = "[[minasaty-attach]]";
const attachmentUploadDirectory = path.join(
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads"),
  "private-message-files",
);

fs.mkdirSync(attachmentUploadDirectory, { recursive: true });

function normalizeMessage(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeStoredContent(raw) {
  const value = typeof raw === "string" ? raw : "";
  if (!value.startsWith(ATTACHMENT_PREFIX)) {
    return { text: value, attachment: null };
  }
  try {
    const parsed = JSON.parse(value.slice(ATTACHMENT_PREFIX.length));
    return {
      text: normalizeMessage(parsed?.text),
      attachment: parsed?.file && parsed.file.storedName
        ? {
            storedName: String(parsed.file.storedName),
            originalName: String(parsed.file.originalName || "مرفق"),
            mimeType: String(parsed.file.mimeType || "application/octet-stream"),
          }
        : null,
    };
  } catch {
    return { text: value, attachment: null };
  }
}

function encodeStoredContent(text, file) {
  if (!file) return text;
  return `${ATTACHMENT_PREFIX}${JSON.stringify({
    text,
    file: {
      storedName: file.storedName,
      originalName: file.originalName,
      mimeType: file.mimeType,
    },
  })}`;
}

function attachmentPublicUrl(studentId, storedName) {
  return `/api/messages/${studentId}/files/${encodeURIComponent(storedName)}`;
}

function serializeMessage(message, studentName) {
  const decoded = decodeStoredContent(message.content);
  return {
    id: message.id,
    studentId: message.studentId,
    senderId: message.senderId,
    receiverId: message.receiverId,
    senderRole: message.senderRole,
    receiverRole: message.receiverRole,
    content: decoded.text,
    createdAt: message.createdAt,
    isRead: message.isRead,
    senderName: message.senderRole === "teacher" ? "الأستاذ" : studentName,
    attachment: decoded.attachment
      ? {
          name: decoded.attachment.originalName,
          mimeType: decoded.attachment.mimeType,
          url: attachmentPublicUrl(message.studentId, decoded.attachment.storedName),
        }
      : null,
  };
}

function serializeLastMessage(message, studentName) {
  if (!message) return null;
  return serializeMessage(message, studentName);
}

async function removeUploadedFile(filename) {
  if (!filename) return;
  try {
    await fs.promises.unlink(path.join(attachmentUploadDirectory, path.basename(filename)));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Unable to remove private-message attachment:", error.message);
    }
  }
}

async function getStudentForAccess(req, studentId) {
  if (!UUID_PATTERN.test(String(studentId)) || !["teacher", "parent"].includes(req.user?.role)) return null;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, studentName: true, parentPhone: true, level: true },
  });
  if (!student) return null;
  if (req.user.role === "parent" && req.user.phone !== student.parentPhone) return null;
  return student;
}

function messageRoles(req) {
  return req.user.role === "teacher"
    ? { senderRole: "teacher", receiverRole: "student" }
    : { senderRole: "student", receiverRole: "teacher" };
}

function emitMessage(req, message, student) {
  const namespace = req.app.get("privateMessagesNamespace");
  if (!namespace) return;
  const payload = serializeMessage(message, student.studentName);
  namespace.to("teacher").emit("private_message_created", payload);
  namespace.to(`student:${student.id}`).emit("private_message_created", payload);
}

async function listTeacherConversations(req, res) {
  if (req.user?.role !== "teacher") {
    return res.status(403).json({ error: "هذه العملية متاحة للأستاذ فقط." });
  }

  try {
    const students = await prisma.student.findMany({
      select: {
        id: true,
        studentName: true,
        level: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, content: true, createdAt: true, senderRole: true, isRead: true },
        },
      },
    });

    const conversations = students
      .map((student) => ({
        id: student.id,
        studentName: student.studentName,
        level: student.level,
        lastMessage: serializeLastMessage(student.messages[0], student.studentName),
      }))
      .sort((a, b) => {
        const lastMessageDifference = new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0);
        if (lastMessageDifference !== 0) return lastMessageDifference;
        return String(a.studentName || "").localeCompare(String(b.studentName || ""), "ar");
      });

    return res.json({ conversations });
  } catch (error) {
    console.error("Unable to list private-message conversations:", error);
    return res.status(500).json({ error: "تعذر تحميل قائمة الرسائل." });
  }
}

async function getUnreadCount(req, res) {
  try {
    if (req.user?.role === "teacher") {
      const count = await prisma.message.count({ where: { receiverRole: "teacher", isRead: false } });
      return res.json({ count });
    }

    if (req.user?.role === "parent") {
      const students = await prisma.student.findMany({
        where: { parentPhone: req.user.phone },
        select: { id: true },
      });
      const count = await prisma.message.count({
        where: { studentId: { in: students.map((student) => student.id) }, receiverRole: "student", isRead: false },
      });
      return res.json({ count });
    }

    return res.status(403).json({ error: "لا تملك صلاحية الوصول إلى الرسائل." });
  } catch (error) {
    console.error("Unable to count unread private messages:", error);
    return res.status(500).json({ error: "تعذر حساب الرسائل غير المقروءة." });
  }
}

async function listMessages(req, res) {
  const student = await getStudentForAccess(req, req.params.studentId);
  if (!student) return res.status(403).json({ error: "لا تملك صلاحية الوصول إلى هذه المحادثة." });

  try {
    const messages = await prisma.message.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: "asc" },
    });
    return res.json({ student, messages: messages.map((message) => serializeMessage(message, student.studentName)) });
  } catch (error) {
    console.error("Unable to list private messages:", error);
    return res.status(500).json({ error: "تعذر تحميل سجل الرسائل." });
  }
}

async function sendMessage(req, res) {
  const uploaded = req.file;
  const student = await getStudentForAccess(req, req.params.studentId);
  if (!student) {
    if (uploaded?.filename) await removeUploadedFile(uploaded.filename);
    return res.status(403).json({ error: "لا تملك صلاحية إرسال رسالة في هذه المحادثة." });
  }

  const content = normalizeMessage(req.body?.content);
  if ((!content && !uploaded) || content.length > MAX_MESSAGE_LENGTH) {
    if (uploaded?.filename) await removeUploadedFile(uploaded.filename);
    return res.status(400).json({ error: `الرسالة أو المرفق مطلوبان، والنص لا يتجاوز ${MAX_MESSAGE_LENGTH} حرف.` });
  }

  const attachment = uploaded
    ? {
        storedName: uploaded.filename,
        originalName: path.basename(String(uploaded.originalname || "مرفق")).slice(0, 180) || "مرفق",
        mimeType: uploaded.mimetype || "application/octet-stream",
      }
    : null;
  const storedContent = encodeStoredContent(content, attachment);
  const previewText = content || (attachment ? `📎 ${attachment.originalName}` : "");

  const roles = messageRoles(req);
  try {
    const message = await prisma.message.create({
      data: {
        studentId: student.id,
        senderId: req.user.role === "teacher" ? "teacher" : student.id,
        receiverId: req.user.role === "teacher" ? student.id : "teacher",
        senderRole: roles.senderRole,
        receiverRole: roles.receiverRole,
        content: storedContent,
      },
    });
    await prisma.notification.create({
      data: {
        studentId: student.id,
        recipientRole: roles.receiverRole,
        recipientId: roles.receiverRole === "teacher" ? "teacher" : student.parentPhone,
        type: "MESSAGE",
        title: roles.receiverRole === "teacher" ? `رسالة جديدة من ${student.studentName}` : "رسالة جديدة من الأستاذ",
        body: previewText.slice(0, 300),
        link: roles.receiverRole === "teacher" ? "./teacher-chat.html" : "./student-chat.html",
      },
    });
    if (roles.senderRole === "teacher" && roles.receiverRole === "student") {
      void prisma.parentCredential.findUnique({
        where: { parentPhone: student.parentPhone },
        select: { email: true, emailVerifiedAt: true },
      }).then((credential) => {
        if (!credential?.email || !credential.emailVerifiedAt) return null;
        const baseUrl = String(process.env.APP_BASE_URL || process.env.PUBLIC_SITE_URL || "https://dr.africacold.fr").replace(/\/$/, "");
        return sendEmail({
          to: credential.email,
          subject: "رسالة جديدة من الأستاذ",
          text: `الأستاذ أرسل رسالة جديدة بخصوص التلميذ ${student.studentName}.\nادخل إلى المنصة: ${baseUrl}/parent-dashboard.html`,
          html: `<p>الأستاذ أرسل رسالة جديدة بخصوص التلميذ <strong>${student.studentName}</strong>.</p><p><a href="${baseUrl}/parent-dashboard.html">الدخول إلى المنصة</a></p>`,
        });
      }).catch((error) => {
        console.error("Parent message email notification failed:", error);
      });
    }
    emitMessage(req, message, student);
    if (roles.receiverRole === "teacher") {
      void notifyTelegram(req, {
        title: "رسالة جديدة من ولي أو تلميذ",
        body: `التلميذ: ${student.studentName}\nالمستوى: ${student.level}\nالنص: ${previewText.slice(0, 500)}`,
      });
    }
    void sendPushToRecipient(
      roles.receiverRole === "teacher" ? "teacher" : "parent",
      roles.receiverRole === "teacher" ? "teacher" : student.parentPhone,
      {
        title: roles.receiverRole === "teacher" ? `رسالة جديدة من ${student.studentName}` : "رسالة جديدة من الأستاذ",
        body: previewText.slice(0, 160),
        link: roles.receiverRole === "teacher" ? "./teacher-chat.html" : "./student-chat.html",
      },
    ).catch(() => {});
    return res.status(201).json({ message: serializeMessage(message, student.studentName) });
  } catch (error) {
    if (uploaded?.filename) await removeUploadedFile(uploaded.filename);
    console.error("Unable to save private message:", error);
    return res.status(500).json({ error: "تعذر حفظ الرسالة." });
  }
}

async function getMessageAttachment(req, res) {
  const student = await getStudentForAccess(req, req.params.studentId);
  if (!student) return res.status(403).json({ error: "لا تملك صلاحية الوصول إلى هذا المرفق." });

  const storedName = path.basename(String(req.params.fileName || ""));
  const expectedPrefix = `msg-${student.id}-`;
  if (!storedName.startsWith(expectedPrefix)) {
    return res.status(404).json({ error: "المرفق غير موجود." });
  }

  const filePath = path.join(attachmentUploadDirectory, storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "ملف المرفق لم يعد متاحاً." });
  }

  res.setHeader("Cache-Control", "private, max-age=300");
  res.type(path.extname(storedName));
  return res.sendFile(filePath);
}

async function markMessagesRead(req, res) {
  const student = await getStudentForAccess(req, req.params.studentId);
  if (!student) return res.status(403).json({ error: "لا تملك صلاحية تعديل هذه المحادثة." });

  try {
    const receiverRole = req.user.role === "teacher" ? "teacher" : "student";
    const result = await prisma.message.updateMany({
      where: { studentId: student.id, receiverRole, isRead: false },
      data: { isRead: true },
    });
    return res.json({ updated: result.count });
  } catch (error) {
    console.error("Unable to mark private messages read:", error);
    return res.status(500).json({ error: "تعذر تحديث حالة قراءة الرسائل." });
  }
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  attachmentUploadDirectory,
  listTeacherConversations,
  getUnreadCount,
  listMessages,
  sendMessage,
  getMessageAttachment,
  markMessagesRead,
};
