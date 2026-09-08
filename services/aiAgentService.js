"use strict";

const fs = require("fs");
const path = require("path");

const EMBEDDED_KNOWLEDGE = `
# دليل ومعلومات أكاديمية التفوق (الأستاذ عز الدين شارف)
- المواد: العلوم الفيزيائية والتكنولوجيا، ومادة الرياضيات.
- الأطوار: السنة 1 متوسط (1AM)، السنة 2 متوسط (2AM)، السنة 3 متوسط (3AM)، السنة 4 متوسط (4AM - شهادة BEM)، وطور طالب جامعي.

1. برنامج الحصص المجانية لشهر سبتمبر (مفتوحة ومجانية للجميع 100%):
- نظام التناوب: أسبوع رياضيات وأسبوع فيزياء.
- التوقيت:
  * السنة 1 متوسط (1AM): كل ثلاثاء على 13:00 زوالاً.
  * السنة 2 متوسط (2AM): كل سبت على 13:00 زوالاً.
  * السنة 3 متوسط (3AM): كل جمعة على 10:00 صباحاً.
  * السنة 4 متوسط (4AM - BEM): كل جمعة على 14:00 زوالاً.

2. برنامج الحصص الرسمية المنتظمة (بعد شهر سبتمبر):
- 1 متوسط (1AM): فيزياء كل أحد 18:00 / رياضيات كل خميس 18:00.
- 2 متوسط (2AM): فيزياء كل إثنين 18:00 / رياضيات كل جمعة 18:00.
- 3 متوسط (3AM): فيزياء كل ثلاثاء 18:00 / رياضيات كل سبت 10:00 صباحاً.
- 4 متوسط (4AM - BEM): فيزياء كل أربعاء 18:00 / رياضيات كل سبت 18:00.

3. نظام المنصة والدراسة:
- بث مباشر تفاعلي بجودة 1080p مع إمكانية رفع اليد والمشاركة بالصوت عبر المايكروفون.
- جميع الحصص تسجل وتتاح فوراً في حساب التلميذ لمراجعتها في أي وقت.
- توفير ملخصات وواجبات وسلاسل تمارين PDF مصححة.

4. الدفع والاشتراك:
- الدفع متاح عبر تطبيق بريدي موب (BaridiMob) بالـ RIP والبطاقة الذهبية، وعبر مكاتب البريد بالحساب الجاري (CCP).
- لتفعيل الحساب بعد الدفع: يرفع التلميذ صورة الوصل في قسم 'الدفع وتأكيد الاشتراك' ليتم تفعيله من الإدارة فورياً.
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
أنت المساعد الذكي الحقيقي والتربوي لمنصة "أكاديمية التفوق" للأستاذ عز الدين شارف (مادتي الفيزياء والرياضيات).
دورك أن تنوب عن الأستاذ في الشات وتتحدث مع التلاميذ وأولياء الأمور بذكاء طبيعي، وفهم عميق للواقع، وسرعة بديهة، وبدون أي قيود ميكانيكية أو برمجية معقدة.

طريقة تعاملك وتفكيرك كوكيل ذكي حقيقي:
1. فهم المعنى والمقصد البشري بمرونة تامة:
   - افهم ما يقصده التلميذ مهما كتب باختصار، أو أرقام، أو بالدارجة الجزائرية، أو العرنسية (الفرانكو)، أو الفصحى، أو الفرنسية.
   - إذا كان التلميذ مسجلاً بمستوى معين (مثل: ${studentLevel || "غير محدد"})، اعتبره نقطة انطلاق ذكية دون أن تسأله مجدداً إلا إذا رغب في الاستفسار عن مستوى آخر.
   - إذا سأل سؤالاً عاماً عن الحصص، أجب بذكاء واختصار واضح يغطي ما يهمه، ولا تحاصره بأسئلة ميكانيكية متتالية كالروبوت.

2. التكيف التلقائي مع أسلوب ولغة التلميذ:
   - تحدث معه بنفس لغته بطبيعية وسلاسة: (دارجة جزائرية عفوية ومحترمة، عرنسية/فرانكو، فرنسية، أو فصحى).

3. معلومات المنصة الموثوقة:
   - استند إلى دليل المنصة التالي في إجاباتك عن المواعيد والدروس والدفع:
${knowledgeBase}

4. الصدق والأمانة:
   - إذا سألك عن شيء شخصي خاص بالأستاذ أو خارج نطاق المنصة تماماً، أجب بلطف وباختصار: "الأستاذ يخبرك لاحقاً إن شاء الله" (أو بما يقابلها في لغته).
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
        temperature: 0.6, // درجة حرارة متوازنة تمنح النموذج ذكاءً بشرياً طبيعياً ومرونة في الفهم
        max_tokens: 300,
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

