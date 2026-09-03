const params = new URLSearchParams(window.location.search);
const level = params.get("level") || sessionStorage.getItem("studentLevel") || sessionStorage.getItem("level") || "";
const subject = params.get("subject") || "";
const scheduledAt = params.get("scheduledAt") || "";
const studentName = params.get("studentName") || sessionStorage.getItem("studentName") || "";

const levelLabels = {
  "السنة الأولى": "السنة الأولى متوسط",
  "السنة الثانية": "السنة الثانية متوسط",
  "السنة الثالثة": "السنة الثالثة متوسط",
  "السنة الرابعة": "السنة الرابعة متوسط",
  "طالب جامعي": "طالب جامعي",
};

const subjectLabels = {
  MATH: "الرياضيات",
  PHYSICS: "الفيزياء",
  BOTH: "الرياضيات والفيزياء",
  FREE: "الحصة المجانية",
};

function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "لا توجد حصة قادمة مبرمجة حاليًا";
  return new Intl.DateTimeFormat("ar-DZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  }).format(date);
}

const levelLabel = levelLabels[level] || level || "المستوى الدراسي";
const subjectLabel = subjectLabels[subject] || subject || "حسب برنامج المستوى";
const timeLabel = formatDate(scheduledAt);

const context = document.getElementById("live-classes-student-context");
const time = document.getElementById("live-classes-frame-time");
const subjectElement = document.getElementById("live-classes-frame-subject");
const note = document.getElementById("live-classes-frame-note");

if (context) {
  context.textContent = studentName
    ? `${studentName} — ${levelLabel}`
    : `${levelLabel} — الحصص المباشرة`;
}
if (time) time.textContent = timeLabel;
if (subjectElement) subjectElement.textContent = `${levelLabel} — ${subjectLabel}`;
if (note && !scheduledAt) {
  note.textContent = "لا توجد حصة قادمة مبرمجة حاليًا. ستظهر المواعيد الجديدة حسب برنامج المستوى.";
}

document.getElementById("live-classes-exit")?.addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.assign("./parent-dashboard.html");
});
