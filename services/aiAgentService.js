"use strict";

const fs = require("fs");
const path = require("path");

const EMBEDDED_KNOWLEDGE = `
# دليل ومواعيد أكاديمية التفوق (الأستاذ عز الدين شارف - Minasaty)
- المواد: العلوم الفيزيائية، ومادة الرياضيات.

============================================================
1. جدول الحصص المجانية لشهر سبتمبر (مفتوحة ومجانية 100% بالتناوب أسبوع رياضيات / أسبوع فيزياء):
============================================================
- السنة الأولى متوسط (1AM): كل ثلاثاء 13:00 زوالاً.
- السنة الثانية متوسط (2AM): كل سبت 13:00 زوالاً.
- السنة الثالثة متوسط (3AM): كل جمعة 10:00 صباحاً.
- السنة الرابعة متوسط (4AM - BEM): كل جمعة 14:00 زوالاً.

============================================================
2. جدول الحصص الرسمية المدفوعة (طيلة العام الدراسي للأطوار المتوسطة):
============================================================
- 1 متوسط (1AM): فيزياء كل أحد 18:00 مساءً | رياضيات كل خميس 18:00 مساءً.
- 2 متوسط (2AM): فيزياء كل إثنين 18:00 مساءً | رياضيات كل جمعة 18:00 مساءً.
- 3 متوسط (3AM): فيزياء كل ثلاثاء 18:00 مساءً | رياضيات كل سبت 10:00 صباحاً.
- 4 متوسط (4AM - BEM): فيزياء كل أربعاء 18:00 مساءً | رياضيات كل سبت 18:00 مساءً.

============================================================
3. طور الطالب الجامعي (مهم جداً للوكيل لمنع التأليف):
============================================================
- المنصة تدعم مقاييس الرياضيات والفيزياء الجامعية.
- ⚠️ تنبيه صارم: لا توجد مواعيد أسبوعية عامة ثابتة للجامعي مثل المتوسط!
- مواعيد الحصص الجامعية تُحدد وتُبرمج بالتنسيق المباشر مع الأستاذ بعد تفعيل الاشتراك بحسب التخصص والمقياس.
- إذا سأل أي تلميذ/طالب عن موعد حصص الطالب الجامعي، الجواب الصارم الموحد:
  "حصص الطالب الجامعي تكون باشتراك خاص وتُحدد مواعيدها بالتنسيق المباشر مع الأستاذ حسب مقياسك، وسيتواصل معك الأستاذ لتحديد التوقيت."
  ❌ ممنوع منعاً باتاً اختراع أو تأليف أي يوم أو ساعة للحصص الجامعية من خيالك!

============================================================
4. الدفع والاشتراك:
============================================================
- بريدي موب BaridiMob بالـ RIP أو الحساب الجاري CCP.
- بعد الدفع، يرفع التلميذ صورة الوصل في قسم 'الدفع وتأكيد الاشتراك' ليتفعل حسابه فورياً.
`;

function loadKnowledgeBase() {
  const KNOWLEDGE_BASE_PATH = path.join(__dirname, "../data/information-agent/platform-knowledge.md");
  try {
    if (fs.existsSync(KNOWLEDGE_BASE_PATH)) {
      const text = fs.readFileSync(KNOWLEDGE_BASE_PATH, "utf8");
      if (text && text.length > 50) return text;
    }
  } catch (_) {}
  return EMBEDDED_KNOWLEDGE;
}

async function getAiAgentResponse({ studentMessage, studentName, studentLevel = "", conversationHistory = [] }) {
  const rawKey = process.env.OPENAI_API_KEY || "";
  const apiKey = String(rawKey).replace(/[\r\n\t\s"']/g, "").trim();

  if (!apiKey || !studentMessage) return null;

  const knowledgeBase = loadKnowledgeBase();

  const systemInstruction = `
أنت المساعد الذكي للأستاذ عز الدين شارف (أكاديمية التفوق للفيزياء والرياضيات).
تتحدث نيابة عن الأستاذ بذكاء، دقة، إيجاز شديد، وصرامة تامة تمنع التأليف.

⚠️ قواعد الأمان والصدق الصارمة (حظر التأليف التام):
1. ممنوع منعاً باتاً اختراع مواعيد من خيالك (No Hallucinated Schedules):
   - المواعيد الثابتة الوحيدة الموجودة في المنصة هي للسنوات الأربع (1AM إلى 4AM) المذكورة في الدليل أدناه فقط!
   - إذا سُئلت عن موعد حصة "طالب جامعي":
     أجب مباشرة وبكل ثقة: "حصص الطالب الجامعي تُحدد مواعيدها بالتنسيق المباشر مع الأستاذ حسب مقياسك وتخصصك بعد الاشتراك."
   - ❌ لا تخترع يوماً أو ساعة لمستوى جامعي ولا تعتذر بتخبط!

2. الإيجاز المباشر (سطر إلى سطرين فقط):
   - بدون مقدمات ولا مجاملات ولا خاتمات خدمة عملاء.
   - إذا سأل عن توقيت مستوى معين: أعطه اليوم والساعة مباشرة وانتهى.

3. مطابقة لغة التلميذ: دارجة أو عرنسية أو فرنسية أو فصحى باختصار وذكاء.

دليل المنصة الرسمي:
${knowledgeBase}
`;

  const messages = [
    { role: "system", content: systemInstruction },
  ];

  if (Array.isArray(conversationHistory)) {
    conversationHistory.slice(-8).forEach((msg) => {
      messages.push({
        role: msg.senderRole === "teacher" ? "assistant" : "user",
        content: String(msg.content || ""),
      });
    });
  }

  messages.push({
    role: "user",
    content: `${studentName || "تلميذ"}${studentLevel ? ` (${studentLevel})` : ""}: ${studentMessage}`,
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 100, // خفض درجة الحرارة للقضاء التام على التأليف والاختراع
        max_tokens: 30,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[AIAgent] خطأ استجابة OpenAI:", response.status, errText);
      return null;
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("[AIAgent] خطأ اتصال بالذكاء الاصطناعي:", err.message);
    return null;
  }
}

module.exports = { getAiAgentResponse, loadKnowledgeBase };

