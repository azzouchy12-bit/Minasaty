const role = sessionStorage.getItem("userRole") || (sessionStorage.getItem("teacherToken") ? "teacher" : "parent");
const token = role === "teacher" ? sessionStorage.getItem("teacherToken") : sessionStorage.getItem("parentToken");
const $ = (id) => document.getElementById(id);

function showError(message = "") {
  const element = $("academic-error");
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "تعذر تحميل البيانات الأكاديمية.");
  return payload;
}

function getCurrentStudent() {
  const direct = sessionStorage.getItem("selectedStudentId") || sessionStorage.getItem("studentId");
  if (direct) return { id: direct, studentName: sessionStorage.getItem("studentName") || "التلميذ", level: sessionStorage.getItem("level") || sessionStorage.getItem("studentLevel") || "" };
  try {
    const students = JSON.parse(sessionStorage.getItem("parentStudents") || "[]");
    return students[0] || null;
  } catch { return null; }
}

function renderList(container, items, renderer) {
  if (!container) return;
  container.innerHTML = items?.length ? items.map(renderer).join("") : "";
}

function renderStudentProgress(data) {
  const grades = data.grades || [];
  const average = grades.length ? grades.reduce((sum, item) => sum + (Number(item.score) / Number(item.maxScore || 100)) * 100, 0) / grades.length : null;
  const participationTotal = Number(data.participationTotal || 0);
  const participationTotalCard = $("student-participation-total");
  if (participationTotalCard) {
    const totalValue = participationTotalCard.querySelector("strong");
    if (totalValue) totalValue.textContent = String(participationTotal);
  }
  renderList($("student-participations"), data.participations, (item) => `<div class="academic-list-item participation-list-item"><div><strong>${escapeHtml(item.subject === "PHYSICS" ? "الفيزياء" : item.subject === "MATH" ? "الرياضيات" : item.subject)}</strong><small>${escapeHtml(item.level)} · آخر مشاركة: ${new Date(item.lastParticipatedAt || item.updatedAt || item.createdAt).toLocaleDateString("ar-DZ")}</small></div><strong>${Number(item.count || 0)} مشاركة</strong></div>`);
  $("student-average").textContent = average === null ? "—" : `${Math.round(average)}%`;
  $("student-completed").textContent = (data.progress || []).filter((item) => item.completed).length;
  const exercisePhotosCount = data.liveQuestionImagesCount != null ? Number(data.liveQuestionImagesCount) : (data.assignments || []).length;
  $("student-submissions").textContent = String(exercisePhotosCount);
  $("student-badges").textContent = (data.badges || []).length;
  renderList($("student-path"), data.path, (item) => `<div class="academic-list-item"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subject)} · ${escapeHtml(item.status)}</small></div><span class="status-pill ${item.status === "DONE" ? "" : "pending"}">${item.status === "DONE" ? "مكتمل" : "قيد المتابعة"}</span></div>`);
  const evaluationEntries = [
    ...(data.participations || []).map((item) => ({
      kind: "participation",
      title: "مشاركة في الحصة",
      subject: item.subject,
      category: "مشاركة",
      count: item.count,
      level: item.level,
      at: item.lastParticipatedAt || item.updatedAt || item.createdAt,
    })),
    ...grades,
  ].slice(0, 20);
  renderList($("student-grades"), evaluationEntries, (item) => item.kind === "participation"
    ? `<div class="academic-list-item participation-list-item"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.level)} · ${item.at ? new Date(item.at).toLocaleDateString("ar-DZ") : "حصة مباشرة"}</small></div><strong>${Number(item.count || 0)} مشاركة</strong></div>`
    : `<div class="academic-list-item"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subject)} · ${escapeHtml(item.category)}</small></div><strong>${Number(item.score)}/${Number(item.maxScore)}</strong></div>`);
  renderList($("student-assignments"), data.assignments, (item) => `<div class="academic-list-item"><div><strong>${escapeHtml(item.assignment?.title || "واجب")}</strong><small>${item.grade == null ? "لم يُصحح بعد" : `العلامة: ${item.grade}`}</small></div><span class="status-pill ${item.status === "GRADED" ? "" : "pending"}">${item.status === "GRADED" ? "مصحح" : "مسلّم"}</span></div>`);
  renderList($("student-assessments"), data.assessments, (item) => `<div class="academic-list-item"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subject)} · ${item.questions?.length || 0} سؤال</small></div><span class="status-pill">متاح</span></div>`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

async function loadStudent() {
  const student = getCurrentStudent();
  if (!student?.id) throw new Error("لم يتم العثور على الطالب الحالي. عد إلى لوحة الولي واختر الطالب أولًا.");
  $("academic-title").textContent = `مركز تقدم ${student.studentName || "الطالب"}`;
  const [progress, assessments] = await Promise.all([
    api(`/api/academic/students/${encodeURIComponent(student.id)}/progress`),
    api(`/api/academic/students/${encodeURIComponent(student.id)}/assessments`),
  ]);
  progress.data.assessments = assessments.data;
  renderStudentProgress(progress.data);
}

async function loadTeacherAnalytics() {
  const analytics = await api("/api/academic/analytics");
  const data = analytics.data;
  $("teacher-students").textContent = data.students ?? "—";
  $("teacher-attendance").textContent = data.attendance ?? "—";
  $("teacher-submissions").textContent = data.submissions ?? "—";
  $("teacher-average").textContent = data.averageGrade == null ? "—" : `${Math.round(data.averageGrade)}%`;
  const health = await api("/api/health/detailed");
  $("teacher-health").innerHTML = `<div class="academic-list-item"><div><strong>قاعدة البيانات</strong><small>اتصال PostgreSQL</small></div><span class="status-pill">${escapeHtml(health.data?.database || health.database || "ok")}</span></div><div class="academic-list-item"><div><strong>الاتصالات الفورية</strong><small>عدد Socket.io الحالي</small></div><strong>${health.metrics?.socketConnections ?? "—"}</strong></div><div class="academic-list-item"><div><strong>طلبات الخدمة</strong><small>منذ تشغيل الخادم</small></div><strong>${health.metrics?.requests ?? "—"}</strong></div>`;
}

async function submitForm(form, endpoint, successMessage) {
  const formData = new FormData(form);
  const body = Object.fromEntries(formData.entries());
  const response = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
  form.reset();
  showError(`${successMessage}: ${response.data?.title || "تم الحفظ"}`);
  setTimeout(() => showError(""), 3500);
}

function initializeTeacher() {
  $("academic-title").textContent = "مركز الأستاذ الأكاديمي";
  $("academic-subtitle").textContent = "أنشئ واجبات وأسئلة، راقب الحضور، واقرأ تقدم الأكاديمية من لوحة واحدة.";
  $("back-link").href = "./teacher-dashboard.html";
  $("back-link").textContent = "لوحة الأستاذ";
  $("student-view").hidden = true;
  $("teacher-view").hidden = false;
  $("assignment-form")?.addEventListener("submit", async (event) => { event.preventDefault(); try { await submitForm(event.currentTarget, "/api/academic/assignments", "تم نشر الواجب"); } catch (error) { showError(error.message); } });
  $("question-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form).entries()); body.answer = body.answer ? JSON.stringify(body.answer) : ""; try { await api("/api/academic/questions", { method: "POST", body: JSON.stringify(body) }); form.reset(); showError("تم حفظ السؤال في بنك الأسئلة."); setTimeout(() => showError(""), 3500); } catch (error) { showError(error.message); } });
  $("refresh-analytics")?.addEventListener("click", () => void loadTeacherAnalytics().catch((error) => showError(error.message)));
  $("download-backup")?.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/admin/backup", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("تعذر إنشاء النسخة الاحتياطية.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `akademiat-altawafuq-backup-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showError("تم إنشاء النسخة الاحتياطية وتنزيلها.");
      setTimeout(() => showError(""), 3500);
    } catch (error) { showError(error.message); }
  });
  void loadTeacherAnalytics().catch((error) => showError(error.message));
}

function initializeStudent() {
  $("teacher-view").hidden = true;
  $("student-view").hidden = false;
  void loadStudent().catch((error) => showError(error.message));
}

$("academic-logout")?.addEventListener("click", () => { void window.revokeServerSession?.(); ["teacherToken", "parentToken", "userRole", "selectedStudentId"].forEach((key) => sessionStorage.removeItem(key)); window.location.replace(role === "teacher" ? "./teacher-login.html" : "./parent-login.html"); });

if (!token) {
  showError("انتهت الجلسة. سجّل الدخول للوصول إلى المركز الأكاديمي.");
} else if (role === "teacher") {
  initializeTeacher();
} else {
  initializeStudent();
}
