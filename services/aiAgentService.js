"use strict";

const fs = require("fs");
const path = require("path");

const EMBEDDED_KNOWLEDGE = `
# دليل ومعلومات أكاديمية التفوق (الأستاذ عز الدين شارف - Minasaty)
المواد: العلوم الفيزيائية والتكنولوجيا، ومادة الرياضيات.

1. الحصص المجانية (شهر سبتمبر فقط - مجانية 100% بالتناوب أسبوع رياضيات وأسبوع فيزياء):
- السنة 1 متوسط (1AM): كل ثلاثاء على 13:00 زوالاً.
- السنة 2 متوسط (2AM): كل سبت على 13:00 زوالاً.
- السنة 3 متوسط (3AM): كل جمعة على 10:00 صباحاً.
- السنة 4 متوسط (4AM - BEM): كل جمعة على 14:00 زوالاً.

2. الحصص الرسمية المدفوعة (طيلة العام الدراسي):
- 1 متوسط (1AM): فيزياء كل أحد 18:00 مساءً | رياضيات كل خميس 18:00 مساءً.
- 2 متوسط (2AM): فيزياء كل إثنين 18:00 مساءً | رياضيات كل جمعة 18:00 مساءً.
- 3 متوسط (3AM): فيزياء كل ثلاثاء 18:00 مساءً | رياضيات كل سبت 10:00 صباحاً.
- 4 متوسط (4AM - BEM): فيزياء كل أربعاء 18:00 مساءً | رياضيات كل سبت 18:00 مساءً.

3. طور الطالب الجامعي:
- حصص باشتراك خاص تُحدد مواعيدها بالتنسيق المباشر مع الأستاذ حسب المقياس والتخصص بعد التسجيل. لا توجد مواعيد أسبوعية عامة ثابتة للجامعي.

4. الدفع وتأكيد الحساب:
- بريدي موب BaridiMob بالـ RIP أو الحساب الجاري CCP.
- تصوير الوصل ورفعه في خانة 'الدفع وتأكيد الاشتراك' ليتفعل حسابه فورياً.
`;

function loadKnowledgeBase() {
  const KNOWLEDGE_BASE_PATH = path.join(__dirname, "../data/information-agent/platform-knowledge.md");
  try {
    if (fs.existsSync(KNOWLEDGE_BASE_PATH)) {
      let text = fs.readFileSync(KNOWLEDGE_BASE_PATH, "utf8");
      // حماية صارمة: منع إرسال ملفات ضخمة كالـ 1000 سؤال لتفادي خطأ 429 Rate Limit
      if (text && text.length > 2500) {
        text = text.slice(0, 2500);
      }
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
تتحدث نيابة عن الأستاذ بذكاء، دقة، وإيجاز شديد في سطر أو سطرين فقط.

قواعد صارمة:
1. إعطاء المعلومة مباشرة في الصميم بدون مقدمات ولا مجاملات ولا عبارات خدمة عملاء.
2. المواعيد الثابتة الوحيدة الموجودة هي للسنوات الأربع (1AM إلى 4AM) في الدليل أدناه.
3. إذا سئلت عن طالب جامعي: "حصص الطالب الجامعي تحدد مواعيدها بالتنسيق المباشر مع الأستاذ بعد التسجيل حسب مقياسك." (ممنوع اختراع مواعيد للجامعي).
4. لغة التلميذ: أجب بنفس لغته (دارجة أو عرنسية أو فرنسية أو فصحى) بإيجاز واحترافية.

دليل المنصة:
${knowledgeBase}
`;

  const messages = [
    { role: "system", content: systemInstruction },
  ];

  // الاحتفاظ بآخر 4 رسائل فقط لتوفير التوكنز وتفادي تجاوز الحد
  if (Array.isArray(conversationHistory)) {
    conversationHistory.slice(-4).forEach((msg) => {
      messages.push({
        role: msg.senderRole === "teacher" ? "assistant" : "user",
        content: String(msg.content || "").slice(0, 200),
      });
    });
  }

  messages.push({
    role: "user",
    content: `${studentName || "تلميذ"}${studentLevel ? ` (${studentLevel})` : ""}: ${studentMessage.slice(0, 300)}`,
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // العودة للموديل الاقتصادي والسريع لحماية الرصيد وتجاوز قيود 429
        messages,
        temperature: 0.2,
        max_tokens: 120,
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
