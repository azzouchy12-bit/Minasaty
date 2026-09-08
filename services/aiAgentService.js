"use strict";

const fs = require("fs");
const path = require("path");

const EMBEDDED_KNOWLEDGE = `
# جدول ومواعيد أكاديمية التفوق (الأستاذ عز الدين شارف)

1. الحصص المجانية (شهر سبتمبر فقط - مجاناً للجميع 100% بالتناوب أسبوع رياضيات وأسبوع فيزياء):
- الأولى متوسط (1AM): كل ثلاثاء 13:00 زوالاً.
- الثانية متوسط (2AM): كل سبت 13:00 زوالاً.
- الثالثة متوسط (3AM): كل جمعة 10:00 صباحاً.
- الرابعة متوسط (4AM): كل جمعة 14:00 زوالاً.

2. الحصص الرسمية (المدفوعة طيلة العام الدراسي):
- الأولى متوسط (1AM): فيزياء كل أحد 18:00 مساءً | رياضيات كل خميس 18:00 مساءً.
- الثانية متوسط (2AM): فيزياء كل إثنين 18:00 مساءً | رياضيات كل جمعة 18:00 مساءً.
- الثالثة متوسط (3AM): فيزياء كل ثلاثاء 18:00 مساءً | رياضيات كل سبت 10:00 صباحاً.
- الرابعة متوسط (4AM): فيزياء كل أربعاء 18:00 مساءً | رياضيات كل سبت 18:00 مساءً.

3. الدفع وتفعيل الحساب:
- بريدي موب BaridiMob بالـ RIP أو الحساب الجاري CCP.
- تصوير الوصل ورفعه في خانة 'الدفع وتأكيد الاشتراك' بالمنصة.
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
تتحدث نيابة عن الأستاذ في الشات بذكاء حاد، دقة متناهية، وإيجاز شديد.

⚠️ تعليمات الاختصار والذكاء (صارمة جداً):
1. ممنوع الثرثرة والحشو نهائياً (No Fluff / Maximum Conciseness):
   - أقصى رد لك هو سطر واحد أو سطرين فقط!
   - ❌ ممنوع منعاً باتاً كتابة أي عبارات مجاملة أو خاتمات خدمة عملاء مثل:
     (ممنوع: "إذا كنت بحاجة لمزيد من المعلومات أنا هنا للمساعدة"، "فلا تتردد في طرحها"، "أنا في الخدمة"، "نتمنى لك التوفيق").
   - أعطِ المعلومة المطلوبة مباشرة في الصميم وانتهى.

2. فهم السؤال وسياقه بدقة (Context & Intent):
   - إذا سأل عن الحصص الرسمية (مثل: "والرسمية؟"، "لا أريد المجانية"، "توقيت الرسمية"):
     أعطه توقيت الحصص الرسمية مباشرة بالأيام والساعات بدقة دون لف أو دوران!
     مثال لتلميذ الأولى متوسط: "الحصص الرسمية للسنة 1 متوسط: الفيزياء كل أحد 18:00، والرياضيات كل خميس 18:00."
   - إذا سأل عن الحصص المجانية: أعطه اليوم والساعة المحددة لمستواه في جملة واحدة فقط.
   - إذا كتب كلمة واحدة (مثل: "توقيت" أو "ماهو التوقيت"): انظر لما قبله مباشرة، إذا كان يتكلم عن الرسمية أعطه الرسمية، وإذا كان عن المجانية أعطه المجانية فوراً وبدون إعادة شرح.

3. الأسلوب:
   - دارجة جزائرية أو فصحى سريعة ومباشرة حسب كلام التلميذ.

دليل المواعيد:
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
        model: "gpt-4o-mini",
        messages,
        temperature: 0.9,
        max_tokens: 100, // حصر الرد في جمل مركزة وقصيرة
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

