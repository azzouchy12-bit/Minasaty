"use strict";

const fs = require("fs");
const path = require("path");
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
 * بث رسالة عبر Socket.IO لكل من التلميذ والأستاذ
 */
function emitPrivateMessage(req, message, student) {
  try {
    const io = req.app?.get?.("io");
    if (!io) return;
    const nsp = io.of("/private-messages") || io;
    const studentName =
      student?.name ||
      `${student?.firstName || ""} ${student?.lastName || ""}`.trim() ||
      "تلميذ";

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
      student: {
        id: student.id,
        name: studentName,
        level: student.level || "",
      },
    };

    nsp.to("teacher").emit("private_message_created", payload);
    nsp.to(`student:${student.id}`).emit("private_message_created", payload);
  } catch (error) {
    console.warn("[Messages] تعذر إرسال حدث السوكت:", error);
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

        const lastMessage = student.messages[0] || null;
        return {
          studentId: student.id,
          studentName:
            student.name ||
            `${student.firstName || ""} ${student.lastName || ""}`.trim() ||
            "تلميذ",
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
 * جلب الرسائل بين التلميذ والأستاذ
 */
async function listMessages(req, res) {
  try {
    const studentId = req.params.studentId || req.user?.id;
    if (!studentId) {
      return res.status(400).json({ success: false, error: "معرّف التلميذ مطلوب." });
    }

    const messages = await prisma.message.findMany({
      where: { studentId },
      orderBy: { createdAt: "asc" },
    });

    return res.json({ success: true, data: messages });
  } catch (error) {
    console.error("[Messages] خطأ في جلب الرسائل:", error);
    return res.status(500).json({ success: false, error: "تعذر جلب الرسائل." });
  }
}

/**
 * إرسال رسالة جديدة (مع دعم الرد الآلي للوكيل الذكي عندما يكون الأستاذ غير متصل)
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

    // 1. حفظ رسالة المستخدم في قاعدة البيانات
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

    // 2. بث الرسالة فورياً عبر السوكت
    emitPrivateMessage(req, message, student);

    // 3. فحص تدخل وكيل الذكاء الاصطناعي:
    // يعمل فقط إذا كان المرسل هو التلميذ، والأستاذ غير متصل (Offline) بالمنصة
    if (senderRole === "student") {
      const teacherIsConnected = isTeacherOnline(req);

      if (!teacherIsConnected && process.env.OPENAI_API_KEY) {
        console.log(`[AIAgent] الأستاذ غير متصل، جاري تحليل سؤال التلميذ: "${content.slice(0, 40)}..."`);

        setImmediate(async () => {
          try {
            if (!getAiAgentResponse) {
              try {
                getAiAgentResponse = require("../services/aiAgentService").getAiAgentResponse;
              } catch (_) {}
            }

            if (typeof getAiAgentResponse === "function") {
              // جلب آخر 5 رسائل سابقة لفهم سياق المحادثة
              const history = await prisma.message.findMany({
                where: { studentId: student.id },
                orderBy: { createdAt: "desc" },
                take: 6,
              });
              history.reverse();

              const studentDisplayName =
                student.name ||
                `${student.firstName || ""} ${student.lastName || ""}`.trim() ||
                "تلميذ";

              const aiReply = await getAiAgentResponse({
                studentMessage: content,
                studentName: studentDisplayName,
                conversationHistory: history,
              });

              if (aiReply) {
                // حفظ رد الذكاء الاصطناعي كرسالة من الأستاذ للتلميذ
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

                // بث رد الذكاء الاصطناعي فورياً للتلميذ
                emitPrivateMessage(req, aiMessage, student);
                console.log(`[AIAgent] تم الرد بنجاح على التلميذ ${studentDisplayName}`);
              }
            }
          } catch (agentErr) {
            console.error("[AIAgent] خطأ أثناء معالجة الرد الآلي:", agentErr);
          }
        });
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
    const filePath = path.join(__dirname, "../uploads/messages", safeName);

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
};

