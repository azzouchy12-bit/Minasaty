(function () {
  function getToken() {
    return (
      sessionStorage.getItem("parentToken") ||
      localStorage.getItem("parentToken") ||
      localStorage.getItem("token") ||
      sessionStorage.getItem("token")
    );
  }

  function getStudent() {
    try {
      const raw =
        sessionStorage.getItem("currentStudent") ||
        localStorage.getItem("currentStudent") ||
        localStorage.getItem("selectedStudent") ||
        sessionStorage.getItem("selectedStudent");
      const parsed = JSON.parse(raw || "null");
      if (!parsed) return null;
      return {
        ...parsed,
        id: parsed.id || parsed.studentId || parsed._id
      };
    } catch {
      return null;
    }
  }

  async function fetchHomework(studentId) {
    const token = getToken();
    const headers = { Accept: "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    try {
      const res = await fetch("/api/academic/students/" + encodeURIComponent(studentId) + "/assignments", { headers });
      if (!res.ok) return [];
      const payload = await res.json().catch(() => []);
      return Array.isArray(payload) ? payload : payload.assignments || payload.data || [];
    } catch (e) {
      return [];
    }
  }

  async function loadHomework() {
    const student = getStudent();
    if (!student || !student.id) return;

    if (typeof window.loadStudentHomework === "function") {
      try {
        await window.loadStudentHomework(student.id);
        return;
      } catch (e) {
        console.warn("Fallback to standalone homework loader");
      }
    }

    const container =
      document.getElementById("parent-homework-list") ||
      document.getElementById("homework-list") ||
      document.querySelector(".homework-list") ||
      document.querySelector(".videos-content-card");

    if (!container) return;

    const items = await fetchHomework(student.id);
    if (!items || items.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:#64748b;font-weight:bold;">لا توجد واجبات مدرسية مضافة حالياً.</div>';
      return;
    }

    container.innerHTML = "";
    items.forEach((item) => {
      const card = document.createElement("div");
      card.style.cssText = "background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);display:flex;justify-content:space-between;align-items:center;gap:12px;";
      card.innerHTML = `
        <div>
          <strong style="font-size:15px;color:#0f172a;display:block;margin-bottom:4px;">📝 ${item.title || "واجب مدرسي"}</strong>
          <span style="font-size:12px;color:#64748b;">${item.subject || "مادة دراسية"}</span>
        </div>
        <span style="font-size:12px;font-weight:bold;color:#059669;background:#dcfce7;padding:4px 10px;border-radius:6px;">متاح</span>
      `;
      container.appendChild(card);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadHomework);
  } else {
    loadHomework();
  }

  window.addEventListener("parent-screen-ready", loadHomework);
  window.addEventListener("active-student-changed", loadHomework);
})();
