(() => {
  const token = sessionStorage.getItem("parentToken");
  if (!token) {
    window.location.replace("./parent-login.html");
    return;
  }

  const selected = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("currentStudent") || "null");
    } catch {
      return null;
    }
  })();

  window.parentScreen = {
    token,
    student: selected,
    async api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(options.headers || {}) },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem("parentToken");
        window.location.replace("./parent-login.html");
        throw new Error("انتهت جلسة الولي.");
      }
      if (!response.ok) throw new Error(payload.error || "تعذر تحميل البيانات.");
      return payload;
    },
    showError(message) {
      const node = document.getElementById("parent-screen-error");
      if (node) { node.hidden = !message; node.textContent = message || ""; }
    },
  };

  const studentName = document.getElementById("parent-screen-student-name");
  const studentLevel = document.getElementById("parent-screen-student-level");
  if (studentName) studentName.textContent = selected?.studentName || "التلميذ الحالي";
  if (studentLevel) studentLevel.textContent = selected?.level || "اختر تلميذًا من لوحة الولي";
  document.getElementById("parent-screen-logout")?.addEventListener("click", () => {
    sessionStorage.removeItem("parentToken");
    sessionStorage.removeItem("currentStudent");
    sessionStorage.removeItem("selectedStudentId");
    window.location.replace("./parent-login.html");
  });
})();
