"use strict";

const fs = require("fs");
const path = require("path");

const KNOWLEDGE_BASE_PATH = path.join(__dirname, "../data/information-agent/platform-knowledge.md");
let cachedKnowledge = null;

function loadKnowledgeBase() {
  if (cachedKnowledge) return cachedKnowledge;
  try {
    if (fs.existsSync(KNOWLEDGE_BASE_PATH)) {
      cachedKnowledge = fs.readFileSync(KNOWLEDGE_BASE_PATH, "utf8");
      return cachedKnowledge;
    }
  } catch (err) {
    console.warn("[AIAgent] تعذر قراءة ملف قاعدة المعارف:", err);
  }
  return "أكاديمية التفوق للفيزياء والرياضيات - الأستاذ عز الدين شارف. حصص تفاعلية مباشرة ومسجلة لجميع أطوار المتوسط وطالب جامعي.";
}

/**
 * توليد رد ذكي مخصص للتلميذ في الرسائل الخاصة عندما يكون الأستاذ غير متصل
 */
async function getAiAgentResponse({ studentMessage, studentName, conversationHistory = [] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !studentMessage) {
    return null;
  }

  const knowledgeBase = loadKnowledgeBase();

  const systemInstruction = `
أنت المساعد الذكي الرسمي والتربوي لمنصة "أكاديمية التفوق" (منصة الأستاذ عز الدين شارف - Minasaty) لمادتي الفيزياء والرياضيات.
أنت ترد نيابة عن الأستاذ فقط عندما يكون الأستاذ غير متصل (Offline).

قواعد صارمة وإلزامية في أسلوب الرد:
1. مطابقة لغة وأسلوب التلميذ بدقة تامة (Language & Style Mirroring):
   - إذا كتب التلميذ بالدارجة الجزائرية: أجب بالدارجة الجزائرية المهذبة المشجعة.
   - إذا كتب بالعرنسية / الفرانكو (عربية بحروف فرنسية ولاتينية، مثل: salam, wktash la seance, kifash nssajal): أجب بنفس الطريقة بالعرنسية تماماً وبنفس الأحرف والأرقام المعتادة.
   - إذا كتب باللغة الفرنسية: أجب بالفرنسية السليمة والواضحة.
   - إذا كتب بالعربية الفصحى: أجب بالعربية الفصحى الواضحة والراقية.
2. قاعدة المعارف والحقائق:
   - اعتمد حصراً على المعلومات التالية الخاصة بأكاديمية التفوق:
${knowledgeBase}
3. قاعدة الصدق والأمانة (إلزامية وصارمة):
   - إذا كان السؤال خاصاً جداً، أو شخصياً يخص الأستاذ، أو يطلب تصحيح تمرين معقد لم يُشرح، أو يسأل عن معلومة غير مؤكدة في ملف المعارف:
     يجب أن تعتذر بلطف وتخبره حصراً:
     * بالعربية/الدارجة: "الأستاذ يخبرك لاحقاً إن شاء الله" (مع إعلامه أن سؤاله مسجل).
     * بالعرنسية/الفرانكو: "l'prof ykhabrek men ba3d nchallah"
     * بالفرنسية: "L'enseignant vous répondra un peu plus tard."
4. لا تطل في الكلام، واجعل الإجابة مفيدة وسريعة ومباشرة كأنها رسالة شات طبيعية.
`;

  const messages = [
    { role: "system", content: systemInstruction },
  ];

  // إرفاق آخر الرسائل السابقة بين التلميذ والأستاذ ليفهم السياق
  if (Array.isArray(conversationHistory)) {
    conversationHistory.slice(-4).forEach((msg) => {
      messages.push({
        role: msg.senderRole === "teacher" ? "assistant" : "user",
        content: String(msg.content || ""),
      });
    });
  }

  messages.push({
    role: "user",
    content: `التلميذ (${studentName || "تلميذ"}): ${studentMessage}`,
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // النموذج الاقتصادي الأقل استهلاكاً والأسرع
        messages,
        temperature: 0.5,
        max_tokens: 350,
      }),
    });

    if (!response.ok) {
      const errorDetails = await response.text().catch(() => "");
      console.warn("[AIAgent] فشل استدعاء OpenAI:", response.status, errorDetails);
      return null;
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    return reply || null;
  } catch (error) {
    console.error("[AIAgent] خطأ أثناء توليد الرد:", error);
    return null;
  }
}

module.exports = { getAiAgentResponse, loadKnowledgeBase };


