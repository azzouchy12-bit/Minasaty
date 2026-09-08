"use strict";

const fs = require("fs");
const path = require("path");

// المسار المعتمد لمجلد حفظ المرفقات والصور الخاصة بالرسائل
const MESSAGE_UPLOAD_DIR = path.resolve(__dirname, "../uploads/messages");
const MESSAGES_UPLOAD_DIR = MESSAGE_UPLOAD_DIR;
const UPLOAD_DIR = MESSAGE_UPLOAD_DIR;
const uploadDir = MESSAGE_UPLOAD_DIR;
const messageUploadDir = MESSAGE_UPLOAD_DIR;
const MESSAGE_ATTACHMENT_DIR = MESSAGE_UPLOAD_DIR;
const ATTACHMENTS_DIR = MESSAGE_UPLOAD_DIR;
const uploadPath = MESSAGE_UPLOAD_DIR;
const messageUploadPath = MESSAGE_UPLOAD_DIR;

// إنشاء المجلد فورياً عند إقلاع السيرفر لتفادي أي خطأ مسار
try {
  if (!fs.existsSync(MESSAGE_UPLOAD_DIR)) {
    fs.mkdirSync(MESSAGE_UPLOAD_DIR, { recursive: true });
  }
} catch (err) {
  console.warn("[Messages] ملاحظة حول مجلد المرفقات:", err.message);
}

let prisma;
try {
  prisma = require("../lib/prisma");
} catch {
  const { PrismaClient } = require("@prisma/client");
  prisma = new PrismaClient();
}

let getAiAgentResponse = null;
try {
  getAiAgentResponse = require("../services/aiAgentService").getAiAgentResponse;
} catch {
  // يتم تحميل الخدمة تلقائياً عند توافرها
}

// مؤقتات انتظار رد الأستاذ قبل تدخل الوكيل الذكي
const pendingAiTimers = new Map();

/**
 * استخراج اسم التلميذ بأمان مهما كانت بنية الحقول في قاعدة البيانات
 */
function extractStudentName(student) {
  if (!student) return "تلميذ";
  return (
    student.studentName ||
    student.name ||
    student.fullName ||
    `${student.firstName || ""} ${student.lastName || ""}`.trim() ||
    student.username ||
    "تلميذ"
  );
}

/**
 * فحص ما إذا كان الأستاذ متصلاً حالياً في غرفة السوكت الخاصة بالرسائل
 */
function isTeacherOnline(req) {
  try {
    const io = req.app?.get?.("io");
    if (!io) return false;
    const nsp = io.of("/private-messages") || io;
    const teacherRoom = nsp.adapter?.rooms?.get("teacher");
    return Boolean(teacherRoom && teacherRoom.size > 0);
  } catch {
    return false;
  }
}

/**
 * بث رسالة عبر Socket.IO لكل من التلميذ والأستاذ مع إرفاق بيانات التلميذ الشاملة
 */
function emitPrivateMessage(req, message, student) {
  try {
    const io = req.app?.get?.("io");
    if (!io) return;
    const nsp = io.of("/private-messages") || io;
    const studentName = extractStudentName(student);

    const studentInfo = {
      id: student?.id || message.studentId,
      studentId: student?.id || message.studentId,
      studentName: studentName,
      name: studentName,
      fullName: studentName,
      level: student?.level || "",
    };

    const payload = {
      id: message.id,
      studentId: message.studentId,
      senderId: message.senderId,
      receiverId: message.receiverId,
      senderRole: message.senderRole,
      receiverRole: message.receiverRole,
      content: message.content,
      createdAt: message.createdAt,
      isRead: message.isRead,
      studentName: studentName,
      student: studentInfo,
    };

    nsp.to("teacher").emit("private_message_created", payload);
    nsp.to(`student:${studentInfo.id}`).emit("private_message_created", payload);
  } catch (error) {
    console.warn("[Messages] تعذر إرسال حدث السوكت:", error);
  }
}

/**
 * تشغيل الرد الذكي وحفظه في قاعدة البيانات وبثه للتلميذ
 */
async function triggerAiAssistantReply(req, student, studentMessage) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("[AIAgent] تنبيه: لا يوجد OPENAI_API_KEY في متغيرات السيرفر.");
      return;
    }

    if (!getAiAgentResponse) {
      try {
        getAiAgentResponse = require("../services/aiAgentService").getAiAgentResponse;
      } catch (err) {
        console.error("[AIAgent] تعذر تحميل ملف services/aiAgentService:", err.message);
        return;
      }
    }

    const history = await prisma.message.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    history.reverse();

    const studentDisplayName = extractStudentName(student);
    console.log(`[AIAgent] جاري استدعاء الذكاء الاصطناعي الشامل للرد على التلميذ: ${studentDisplayName}...`);

    const aiReply = await getAiAgentResponse({
      studentMessage,
      studentName: studentDisplayName,
      studentLevel: student.level || "",
      conversationHistory: history,
    });

    if (!aiReply) {
      console.warn("[AIAgent] لم يتم استلام رد من نموذج الذكاء الاصطناعي.");
      return;
    }

    // حفظ رد الوكيل الذكي في قاعدة البيانات كرسالة من الأستاذ
    const aiMessage = await prisma.message.create({
      data: {
        studentId: student.id,
        senderId: "teacher",
        receiverId: student.id,
        senderRole: "teacher",
        receiverRole: "student",
        content: aiReply,
      },
    });

    // بث الرد فورياً إلى شات التلميذ عبر السوكت
    emitPrivateMessage(req, aiMessage, student);
    console.log(`[AIAgent] تم الرد بنجاح وحفظه في المحادثة: "${aiReply.slice(0, 50)}..."`);
  } catch (error) {
    console.error("[AIAgent] خطأ أثناء معالجة رد الوكيل الذكي:", error);
  }
}

/**
 * قائمة المحادثات للأستاذ
 */
async function listTeacherConversations(req, res) {
  try {
    const students = await prisma.student.findMany({
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const conversations = await Promise.all(
      students.map(async (student) => {
        const unreadCount = await prisma.message.count({
          where: {
            studentId: student.id,
            receiverRole: "teacher",
            isRead: false,
          },
        });

        const studentName = extractStudentName(student);
        const lastMessage = student.messages[0] || null;
        return {
          studentId: student.id,
          studentName: studentName,
          name: studentName,
          student: {
            id: student.id,
            studentName: studentName,
            name: studentName,
            level: student.level || "",
          },
          level: student.level,
          lastMessage: lastMessage?.content || "",
          lastMessageAt: lastMessage?.createdAt || student.createdAt,
          unreadCount,
        };
      })
    );

    return res.json({ success: true, data: conversations });
  } catch (error) {
    console.error("[Messages] خطأ في قائمة المحادثات:", error);
    return res.status(500).json({ success: false, error: "تعذر جلب المحادثات." });
  }
}

/**
 * إجمالي عدد الرسائل غير المقروءة
 */
async function getUnreadCount(req, res) {
  try {
    const role = req.user?.role || "student";
    const studentId = req.user?.id;

    let count = 0;
    if (role === "teacher" || role === "admin") {
      count = await prisma.message.count({
        where: {
          receiverRole: "teacher",
          isRead: false,
        },
      });
    } else if (studentId) {
      count = await prisma.message.count({
        where: {
          studentId,
          receiverRole: "student",
          isRead: false,
        },
      });
    }

    return res.json({ success: true, count });
  } catch (error) {
    console.error("[Messages] خطأ في عدد الرسائل غير المقروءة:", error);
    return res.status(500).json({ success: false, error: "تعذر حساب الرسائل غير المقروءة." });
  }
}

/**
 * جلب الرسائل بين التلميذ والأستاذ (مصححة بنسبة 100% لتفادي خطأ studentName)
 */
async function listMessages(req, res) {
  try {
    const studentId = req.params.studentId || req.user?.id;
    if (!studentId) {
      return res.status(400).json({ success: false, error: "معرّف التلميذ مطلوب." });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
    });

    const studentName = extractStudentName(student);
    const studentInfo = {
      id: studentId,
      studentId: studentId,
      studentName: studentName,
      name: studentName,
      fullName: studentName,
      level: student?.level || "",
      phone: student?.phone || "",
    };

    const rawMessages = await prisma.message.findMany({
      where: { studentId },
      orderBy: { createdAt: "asc" },
    });

    const enrichedMessages = rawMessages.map((msg) => ({
      ...msg,
      studentName: studentName,
      student: studentInfo,
    }));

    enrichedMessages.student = studentInfo;
    enrichedMessages.studentName = studentName;
    enrichedMessages.messages = enrichedMessages;

    return res.json({
      success: true,
      data: enrichedMessages,
      messages: enrichedMessages,
      student: studentInfo,
      studentName: studentName,
    });
  } catch (error) {
    console.error("[Messages] خطأ في جلب الرسائل:", error);
    return res.status(500).json({ success: false, error: "تعذر جلب الرسائل." });
  }
}

/**
 * إرسال رسالة جديدة مع نظام الرد الذكي
 */
async function sendMessage(req, res) {
  try {
    const studentId = req.params.studentId || req.user?.id;
    const content = String(req.body?.content || "").trim();
    const senderRole = req.user?.role === "teacher" || req.user?.role === "admin" ? "teacher" : "student";
    const receiverRole = senderRole === "teacher" ? "student" : "teacher";
    const senderId = String(req.user?.id || senderRole);
    const receiverId = senderRole === "teacher" ? studentId : "teacher";

    if (!content) {
      return res.status(400).json({ success: false, error: "نص الرسالة لا يمكن أن يكون فارغاً." });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      return res.status(404).json({ success: false, error: "حساب التلميذ غير موجود." });
    }

    // 1. حفظ رسالة التلميذ أو الأستاذ في قاعدة البيانات
    const message = await prisma.message.create({
      data: {
        studentId: student.id,
        senderId,
        receiverId,
        senderRole,
        receiverRole,
        content,
      },
    });

    // 2. بث الرسالة فورياً عبر السوكت للطرفين
    emitPrivateMessage(req, message, student);

    // 3. إدارة نظام رد الوكيل الذكي الشامل:
    if (senderRole === "student") {
      const teacherIsConnected = isTeacherOnline(req);
      
      // إذا كان الأستاذ غير متصل: يرد فوراً (ثانية واحدة).
      // إذا كان الأستاذ متصلاً: ينتظر 6 ثوانٍ، إن لم يرد الأستاذ بيده، يجيب الوكيل الذكي!
      const delayMs = teacherIsConnected ? 6000 : 1000;

      if (pendingAiTimers.has(student.id)) {
        clearTimeout(pendingAiTimers.get(student.id));
      }

      console.log(`[AIAgent] استلمنا رسالة من التلميذ (${teacherIsConnected ? "الأستاذ متصل - مهلة 6 ثوانٍ" : "الأستاذ غير متصل - رد فوري"}).`);

      const timer = setTimeout(() => {
        pendingAiTimers.delete(student.id);
        void triggerAiAssistantReply(req, student, content);
      }, delayMs);

      pendingAiTimers.set(student.id, timer);
    } else if (senderRole === "teacher") {
      if (pendingAiTimers.has(studentId)) {
        clearTimeout(pendingAiTimers.get(studentId));
        pendingAiTimers.delete(studentId);
        console.log("[AIAgent] الأستاذ رد بنفسه، تم إلغاء رد الوكيل الذكي.");
      }
    }

    return res.status(201).json({ success: true, data: message });
  } catch (error) {
    console.error("[Messages] خطأ في إرسال الرسالة:", error);
    return res.status(500).json({ success: false, error: "تعذر إرسال الرسالة." });
  }
}

/**
 * تحديد الرسائل كمقروءة
 */
async function markMessagesRead(req, res) {
  try {
    const studentId = req.params.studentId || req.user?.id;
    const role = req.user?.role === "teacher" || req.user?.role === "admin" ? "teacher" : "student";

    if (!studentId) {
      return res.status(400).json({ success: false, error: "معرّف التلميذ مطلوب." });
    }

    await prisma.message.updateMany({
      where: {
        studentId,
        receiverRole: role,
        isRead: false,
      },
      data: { isRead: true },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("[Messages] خطأ في تحديث حالة القراءة:", error);
    return res.status(500).json({ success: false, error: "تعذر تحديث الرسائل." });
  }
}

/**
 * جلب المرفقات في الرسائل
 */
async function getMessageAttachment(req, res) {
  try {
    const { fileName } = req.params;
    if (!fileName) {
      return res.status(400).json({ success: false, error: "اسم الملف غير محدد." });
    }

    const safeName = path.basename(fileName);
    const filePath = path.join(MESSAGE_UPLOAD_DIR, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: "الملف غير موجود." });
    }

    return res.sendFile(filePath);
  } catch (error) {
    console.error("[Messages] خطأ في جلب المرفق:", error);
    return res.status(500).json({ success: false, error: "تعذر تحميل الملف." });
  }
}

module.exports = {
  listTeacherConversations,
  getUnreadCount,
  listMessages,
  sendMessage,
  markMessagesRead,
  getMessageAttachment,
  MESSAGE_UPLOAD_DIR,
  MESSAGES_UPLOAD_DIR,
  UPLOAD_DIR,
  uploadDir,
  messageUploadDir,
  MESSAGE_ATTACHMENT_DIR,
  ATTACHMENTS_DIR,
  uploadPath,
  messageUploadPath,
  isTeacherOnline,
  emitPrivateMessage,
};

