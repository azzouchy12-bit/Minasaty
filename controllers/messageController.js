"use strict";

const fs = require("fs");
const path = require("path");

const MESSAGE_UPLOAD_DIR = path.resolve(__dirname, "../uploads/messages");
const MESSAGES_UPLOAD_DIR = MESSAGE_UPLOAD_DIR;
const UPLOAD_DIR = MESSAGE_UPLOAD_DIR;
const uploadDir = MESSAGE_UPLOAD_DIR;
const messageUploadDir = MESSAGE_UPLOAD_DIR;
const MESSAGE_ATTACHMENT_DIR = MESSAGE_UPLOAD_DIR;
const ATTACHMENTS_DIR = MESSAGE_UPLOAD_DIR;
const uploadPath = MESSAGE_UPLOAD_DIR;
const messageUploadPath = MESSAGE_UPLOAD_DIR;

try {
  if (!fs.existsSync(MESSAGE_UPLOAD_DIR)) {
    fs.mkdirSync(MESSAGE_UPLOAD_DIR, { recursive: true });
  }
} catch (_) {}

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
} catch (_) {}

const pendingAiTimers = new Map();

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

function isTeacherOnline(req) {
  try {
    const io = req.app?.get?.("io");
    if (!io) return false;
    const nsp = io.of("/private-messages") || io;
    const teacherRoom = nsp.adapter?.rooms?.get("teacher") || nsp.adapter?.rooms?.get("admin");
    return Boolean(teacherRoom && teacherRoom.size > 0);
  } catch {
    return false;
  }
}

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
      attachment: message.attachment || null,
      studentName: studentName,
      student: studentInfo,
    };

    nsp.to("teacher").emit("private_message_created", payload);
    nsp.to("admin").emit("private_message_created", payload);
    nsp.to(`student:${studentInfo.id}`).emit("private_message_created", payload);
  } catch (error) {
    console.warn("[Messages] تعذر إرسال حدث السوكت:", error);
  }
}

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

    emitPrivateMessage(req, aiMessage, student);
    console.log(`[AIAgent] تم الرد بنجاح وحفظه في المحادثة: "${aiReply.slice(0, 50)}..."`);
  } catch (error) {
    console.error("[AIAgent] خطأ أثناء معالجة رد الوكيل الذكي:", error);
  }
}

/**
 * قائمة المحادثات للأستاذ
 * مرتبة تماماً مثل فيسبوك وماسنجر:
 * التلميذ الذي أرسل أو تفاعل مؤخراً يظهر في قمة القائمة أولاً
 */
async function listTeacherConversations(req, res) {
  try {
    let students = [];
    try {
      students = await prisma.student.findMany({
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
      });
    } catch (queryErr) {
      console.warn("[Messages] fallback student query without include:", queryErr.message);
      students = await prisma.student.findMany();
    }

    const conversations = await Promise.all(
      students.map(async (student) => {
        let unreadCount = 0;
        try {
          unreadCount = await prisma.message.count({
            where: {
              studentId: student.id,
              receiverRole: "teacher",
              isRead: false,
            },
          });
        } catch (_) {}

        const studentName = extractStudentName(student);
        const lastMsg = student.messages?.[0] || null;

        return {
          id: student.id,
          studentId: student.id,
          studentName: studentName,
          name: studentName,
          level: student.level || "",
          lastMessage: lastMsg
            ? {
                id: lastMsg.id,
                content: lastMsg.content || "",
                senderRole: lastMsg.senderRole,
                isRead: Boolean(lastMsg.isRead),
                createdAt: lastMsg.createdAt,
                attachment: lastMsg.attachment || null,
              }
            : null,
          unreadCount,
        };
      })
    );

    // 🔥 الترتيب الاحترافي على طريقة فيسبوك وماسنجر:
    // المحادثات التي تحتوي على أحدث رسالة تظهر أولاً في أعلى القائمة
    conversations.sort((a, b) => {
      const timeA = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const timeB = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
      if (timeB !== timeA) {
        return timeB - timeA; // الأحدث زماناً يسبق دائماً
      }
      return 0;
    });

    return res.json({
      success: true,
      conversations: conversations,
      data: conversations,
      students: conversations,
    });
  } catch (error) {
    console.error("[Messages] خطأ في قائمة المحادثات للأستاذ:", error);
    return res.status(500).json({ success: false, error: "تعذر جلب المحادثات." });
  }
}

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

async function listMessages(req, res) {
  try {
    const studentId =
      req.params.studentId ||
      req.query.studentId ||
      (req.user?.role === "student" ? req.user?.id : null);

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

    return res.json({
      success: true,
      student: studentInfo,
      messages: rawMessages,
      data: rawMessages,
    });
  } catch (error) {
    console.error("[Messages] خطأ في جلب الرسائل:", error);
    return res.status(500).json({ success: false, error: "تعذر جلب الرسائل." });
  }
}

async function sendMessage(req, res) {
  try {
    const studentId = req.params.studentId || req.query.studentId || req.user?.id;
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

    emitPrivateMessage(req, message, student);

    if (senderRole === "student") {
      const teacherIsConnected = isTeacherOnline(req);
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

    return res.status(201).json({
      success: true,
      message: message,
      data: message,
    });
  } catch (error) {
    console.error("[Messages] خطأ في إرسال الرسالة:", error);
    return res.status(500).json({ success: false, error: "تعذر إرسال الرسالة." });
  }
}

async function markMessagesRead(req, res) {
  try {
    const studentId = req.params.studentId || req.query.studentId || req.user?.id;
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

