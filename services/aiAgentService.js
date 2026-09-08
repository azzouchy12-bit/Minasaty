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

/**
 * جلب بيانات المنصة الحية مباشرة من قاعدة البيانات والملفات (الحصص المبرمجة، المسجلة، الغيابات، الدفع)
 */
async function fetchLivePlatformData(studentLevel = "") {
  let liveDataText = "";

  // 1. استعلام الحصص المبرمجة القادمة مباشرة من قاعدة البيانات الحية
  try {
    const upcomingClasses = await prisma.scheduledClass.findMany({
      where: {
        status: { not: "CANCELLED" },
        ...(studentLevel ? { level: studentLevel } : {}),
      },
      orderBy: { scheduledAt: "asc" },
      take: 8,
    });

    if (upcomingClasses && upcomingClasses.length > 0) {
      liveDataText += "\n📅 الحصص المبرمجة في النظام حالياً (مباشرة من قاعدة البيانات الحية):\n";
      upcomingClasses.forEach((c) => {
        const dateStr = c.scheduledAt ? new Date(c.scheduledAt).toLocaleString("ar-DZ") : "غير محدد";
        liveDataText += `- المستوى: ${c.level} | المادة: ${c.subject} | الموعد: ${dateStr} | الحالة: ${c.status} ${c.notes ? `(ملاحظة/تنبيه: ${c.notes})` : ""}\n`;
      });
    }
  } catch (err) {
    console.warn("[AIAgent] تعذر جلب الحصص المبرمجة من DB:", err.message);
  }

  // 2. استعلام أحدث الحصص المسجلة المتاحة في المنصة
  try {
    const recordedClasses = await prisma.scheduledClass.findMany({
      where: {
        youtubeVideoId: { not: null },
        ...(studentLevel ? { level: studentLevel } : {}),
      },
      orderBy: { scheduledAt: "desc" },
      take: 5,
    });

    if (recordedClasses && recordedClasses.length > 0) {
      liveDataText += "\n🎥 الحصص المسجلة المتاحة في أرشيف المنصة:\n";
      recordedClasses.forEach((c) => {
        liveDataText += `- ${c.level} | ${c.subject} | مسجلة ومتاحة في 'سجل الحصص' في حسابك (رمز الفيديو: ${c.youtubeVideoId})\n`;
      });
    }
  } catch (err) {
    console.warn("[AIAgent] تعذر جلب الحصص المسجلة من DB:", err.message);
  }

  // 3. قراءة بيانات الدفع ديناميكياً من ملفات المنصة في السيرفر
  try {
    const paymentFile = path.join(__dirname, "../public/payment.html");
    if (fs.existsSync(paymentFile)) {
      const html = fs.readFileSync(paymentFile, "utf8");
      const rip = html.match(/007\d{17}/)?.[0];
      const ccp = html.match(/(\d{6,10})\s*(?:clé|مفتاح)\s*(\d{2})/i)?.[0];
      if (rip || ccp) {
        liveDataText += "\n💳 بيانات الدفع الرسمية المستخرجة من ملف payment.html:\n";
        if (rip) liveDataText += `- رقم RIP بريدي موب: ${rip}\n`;
        if (ccp) liveDataText += `- رقم CCP والمفتاح: ${ccp}\n`;
      }
    }
  } catch (_) {}

  return liveDataText;
}

// بنك معارف مدمج واحتياطي يضمن استمرار عمل الوكيل
const BASE_KNOWLEDGE = `
# معلومات أكاديمية التفوق للفيزياء والرياضيات (الأستاذ عز الدين شارف - Minasaty)

1. الحصص المجانية لشهر سبتمبر (مهم جداً):
- طيلة شهر سبتمبر، الحصص مجانية ومسموحة لجميع التلاميذ المسجلين 100% بدون أي دفع.
- نظام الحصص بالتناوب أسبوع بأسبوع: أسبوع رياضيات وأسبوع فيزياء.
- توقيت الحصص المجانية للأطوار المتوسطة:
  * السنة الأولى متوسط (1AM): كل ثلاثاء على الساعة 13:00 زوالاً.
  * السنة الثانية متوسط (2AM): كل سبت على الساعة 13:00 زوالاً.
  * السنة الثالثة متوسط (3AM): كل جمعة على الساعة 10:00 صباحاً.
  * السنة الرابعة متوسط (4AM - بيام BEM): كل جمعة على الساعة 14:00 زوالاً.

2. مواعيد الحصص الدراسية الرسمية والمنتظمة (المدفوعة للأطوار المتوسطة):
1️⃣ سنة أولى متوسط:
- فيزياء: كل أحد على الساعة 6:00 مساءً.
- رياضيات: كل خميس على الساعة 6:00 مساءً.
2️⃣ سنة ثانية متوسط:
- فيزياء: كل إثنين على الساعة 6:00 مساءً.
- رياضيات: كل جمعة على الساعة 6:00 مساءً.
3️⃣ سنة ثالثة متوسط:
- فيزياء: كل ثلاثاء على الساعة 6:00 مساءً.
- رياضيات: كل سبت على الساعة 10:00 صباحاً.
4️⃣ سنة رابعة متوسط (BEM):
- فيزياء: كل أربعاء على الساعة 6:00 مساءً.
- رياضيات: كل سبت على الساعة 6:00 مساءً.

3. غياب الأستاذ واستئناف الحصص:
- في حال غياب الأستاذ أو تأجيل أي حصة، تستأنف الحصة القادمة مباشرة في موعدها الأسبوعي الموالي الموضح في الجدول أعلاه دون أي تغيير.
- الحصص السابقة تبقى مسجلة 100% وتتاح للمراجعة الدائمة في المنصة.

4. الدفع والاشتراك:
- طرق الدفع: بريدي موب BaridiMob، الحساب البريدي الجاري CCP، والبطاقة الذهبية / CIB.
- بعد الدفع يرفع صورة الوصل في قسم 'الدفع وتأكيد الاشتراك' ليتفعل حسابه فورياً.
`;

function loadKnowledgeBase() {
  const KNOWLEDGE_BASE_PATH = path.join(__dirname, "../data/information-agent/platform-knowledge.md");
  try {
    if (fs.existsSync(KNOWLEDGE_BASE_PATH)) {
      const text = fs.readFileSync(KNOWLEDGE_BASE_PATH, "utf8");
      if (text && text.length > 50) return text;
    }
  } catch (_) {}
  return BASE_KNOWLEDGE;
}

async function getAiAgentResponse({ studentMessage, studentName, studentLevel = "", conversationHistory = [] }) {
  const rawKey = process.env.OPENAI_API_KEY || "";
  const apiKey = String(rawKey).replace(/[\r\n\t\s"']/g, "").trim();

  if (!apiKey) {
    console.warn("[AIAgent] تنبيه: متغير OPENAI_API_KEY غير موجود في بيئة السيرفر Railway.");
    return null;
  }
  if (!studentMessage) return null;

  const baseKnowledge = loadKnowledgeBase();
  // جلب البيانات الحية الحقيقية من قاعدة البيانات وملفات المنصة لحظة السؤال
  const liveData = await fetchLivePlatformData(studentLevel);
  const fullContext = `${baseKnowledge}\n${liveData}`;

  const systemInstruction = `
أنت المساعد الذكي الرسمي لمنصة "أكاديمية التفوق" لمادتي الفيزياء والرياضيات (منصة الأستاذ عز الدين شارف).
أنت متصل مباشرة بقاعدة بيانات المنصة وملفاتها، وتجيب عن أسئلة التلاميذ في الشات نيابة عن الأستاذ بصرامة تامة وإيجاز مباشر وبدون أي مقدمات أو كلام زائد.

⚠️ قواعد الأسلوب الصارمة (إلزامية 100%):
1. الصرامة التامة والمباشرة (ممنوع المقدمات والترحيبات والزعبلا نهائياً):
   ❌ ممنوع منعاً باتاً: "أهلاً يا جماعة"، "واش راكم جماعة البيام"، "إن شاء الله تكونوا بخير"، "كيف حالكم"، "يسعدني الإجابة".
   ✔️ ادخل في صلب الموضوع فوراً: صرامة تامة، ماذا تريد؟ هاك الإجابة باختصار شديد.

2. التدرج الذكي عند السؤال عن المواعيد أو الحصص القادمة أو غياب الأستاذ:
   - إذا سأل التلميذ: "متى الحصة القادمة؟" أو "وقتاش الحصة؟" أو سأل عن غياب الأستاذ أو موعد حصته:
     ❌ لا تعطه جميع المواعيد دفعة واحدة.
     ✔️ اسأله باختصار وتدرج لتحديد ما يريده بالضبط:
       1) "هل تقصد الحصص المجانية (سبتمبر) أم الحصص الرسمية المدفوعة؟"
       2) ثم: "في أي مستوى دراسي؟ (أولى، ثانية، ثالثة، رابعة متوسط، جامعي)"
       3) ثم: "في أي مادة؟ (فيزياء أم رياضيات)"
     وعندما تكتمل المعطيات الثلاثة، أعطه موعد الحصة القادمة بدقة من قاعدة البيانات الحية في جملة واحدة فقط!

3. في حالة غياب الأستاذ:
   - بين له باختصار شديد أن الحصة القادمة ستكون في موعدها الأسبوعي الموالي في التاريخ والوقت المحدد في قاعدة البيانات، وأن الحصص السابقة مسجلة وموجودة في حسابه.

4. في حالة السؤال عن الدفع أو الحصص المسجلة:
   - زوده بالمعلومات المستخرجة مباشرة من قاعدة البيانات والملفات الحية بدقة واختصار.

5. مطابقة لغة التلميذ (Language Mirroring):
   - إذا كتب بالدارجة: أجب بالدارجة الصارمة والمباشرة (بدون مقدمات).
   - إذا كتب بالعرنسية / الفرانكو: أجب بنفس الحروف اللاتينية باختصار وصرامة.
   - إذا كتب بالفرنسية: أجب بالفرنسية المباشرة.
   - إذا كتب بالعربية الفصحى: أجب بالعربية الفصحى المباشرة.

6. قاعدة الصدق والأمانة:
   - إذا سألك عن أمر خاص بالأستاذ أو خارج نطاق المنصة والدراسة:
     أجب حصراً وبكلمات معدودة: "الأستاذ يخبرك لاحقاً إن شاء الله." (وبالعرنسية: "l'prof ykhabrek men ba3d nchallah").

7. قاعدة البيانات والمعارف الحية للمنصة:
${fullContext}
`;

  const messages = [
    { role: "system", content: systemInstruction },
  ];

  if (Array.isArray(conversationHistory)) {
    conversationHistory.slice(-6).forEach((msg) => {
      messages.push({
        role: msg.senderRole === "teacher" ? "assistant" : "user",
        content: String(msg.content || ""),
      });
    });
  }

  messages.push({
    role: "user",
    content: `${studentName || "تلميذ"}: ${studentMessage}`,
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.2, // صرامة ودقة عالية جداً
        max_tokens: 250,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[AIAgent] خطأ استجابة OpenAI:", response.status, errText);
      return null;
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    return reply || null;
  } catch (err) {
    console.error("[AIAgent] خطأ اتصال بالذكاء الاصطناعي:", err.message);
    return null;
  }
}

module.exports = { getAiAgentResponse, loadKnowledgeBase, fetchLivePlatformData };

