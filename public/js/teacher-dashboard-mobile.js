"use strict";

(function () {
  const TEACHER_TOKEN_KEY = "teacherToken";

  function getTeacherToken() {
    const token = sessionStorage.getItem(TEACHER_TOKEN_KEY);
    if (!token) {
      window.location.replace("./teacher-login.html");
      return null;
    }
    return token;
  }

  async function teacherFetch(url, options = {}) {
    const token = getTeacherToken();
    if (!token) return Promise.reject(new Error("انتهت الجلسة."));

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 || response.status === 403) {
      sessionStorage.removeItem(TEACHER_TOKEN_KEY);
      window.location.replace("./teacher-login.html");
      throw new Error("انتهت الجلسة. يرجى تسجيل الدخول مجددًا.");
    }
    return response;
  }

  // --------------------------------------------------------------------------
  // Application State
  // --------------------------------------------------------------------------
  let currentLevel = "السنة الأولى";
  let activeView = "students";
  let studentsData = [];
  let scheduledClasses = [];
  let activeFilter = "ALL";
  let activeSearchQuery = "";
  let selectedStudent = null;
  let isAbsent = false;

  const LEVEL_LABELS = {
    "السنة الأولى": "السنة الأولى متوسط",
    "السنة الثانية": "السنة الثانية متوسط",
    "السنة الثالثة": "السنة الثالثة متوسط",
    "السنة الرابعة": "السنة الرابعة متوسط",
    "طالب جامعي": "طالب جامعي",
  };

  const AVATAR_COLORS = [
    "avatar-purple",
    "avatar-blue",
    "avatar-green",
    "avatar-amber",
    "avatar-rose",
    "avatar-cyan",
  ];

  function getAvatarColor(name = "") {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash + name.charCodeAt(i)) % AVATAR_COLORS.length;
    }
    return AVATAR_COLORS[hash] || "avatar-blue";
  }

  function getInitial(name = "") {
    const trimmed = String(name).trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "ت";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    }[c]));
  }

  // --------------------------------------------------------------------------
  // Toast & Alert Helpers
  // --------------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById("tdm-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3000);
  }

  function showAlert(message) {
    const alert = document.getElementById("tdm-alert");
    if (!alert) return;
    if (!message) {
      alert.hidden = true;
      alert.textContent = "";
      return;
    }
    alert.textContent = message;
    alert.hidden = false;
  }

  // --------------------------------------------------------------------------
  // Level Switching
  // --------------------------------------------------------------------------
  function setLevel(level) {
    if (!level) return;
    currentLevel = level;

    // Update level chips
    document.querySelectorAll(".tdm-level-chip").forEach((chip) => {
      const isCurrent = chip.dataset.level === level;
      chip.classList.toggle("is-active", isCurrent);
      chip.setAttribute("aria-current", String(isCurrent));
    });

    const label = LEVEL_LABELS[level] || level;
    const statsLevel = document.getElementById("tdm-stats-level-label");
    if (statsLevel) statsLevel.textContent = label;

    fetchLevelStudents(level);
    loadSchedule();
  }

  // --------------------------------------------------------------------------
  // Section Navigation (Gmail Sub-Tabs)
  // --------------------------------------------------------------------------
  function setView(viewName) {
    activeView = viewName || "students";

    document.querySelectorAll(".tdm-sec-pill").forEach((pill) => {
      pill.classList.toggle("is-active", pill.dataset.view === activeView);
    });

    document.querySelectorAll(".tdm-sub-view").forEach((view) => {
      const isTarget = view.id === `view-${activeView}`;
      view.classList.toggle("is-active", isTarget);
      view.hidden = !isTarget;
    });

    // Reset scroll frame to top
    const frame = document.getElementById("tdm-scroll-frame");
    if (frame) frame.scrollTop = 0;

    if (activeView === "notifications") loadNotifications();
    else if (activeView === "schedule") loadSchedule();
    else if (activeView === "payments") loadPayments();
    else if (activeView === "assignments") loadAssignments();
    else if (activeView === "lessons") loadLessons();
  }

  // --------------------------------------------------------------------------
  // Fetch Students & Stats
  // --------------------------------------------------------------------------
  async function fetchLevelStudents(level = currentLevel) {
    showAlert("");
    const container = document.getElementById("tdm-gmail-students-list");
    if (container) {
      container.innerHTML = `
        <div class="tdm-loading-state">
          <div class="tdm-spinner"></div>
          <p>جارٍ تحميل قائمة التلاميذ…</p>
        </div>`;
    }

    try {
      const response = await teacherFetch(
        `/api/students/level/${encodeURIComponent(level)}?page=1&limit=200`,
        { headers: { Accept: "application/json" } }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "تعذر تحميل قائمة التلاميذ.");
      }

      studentsData = Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload)
        ? payload
        : [];

      // Update counters
      const countEl = document.getElementById("sec-students-count");
      if (countEl) countEl.textContent = studentsData.length;

      const statsCount = document.getElementById("tdm-stats-students-count");
      if (statsCount) statsCount.textContent = `${studentsData.length} تلميذ`;

      renderGmailStudentsList();
    } catch (err) {
      console.error("Fetch students error:", err);
      showAlert(err.message || "تعذر تحميل بيانات المستوى.");
      if (container) {
        container.innerHTML = `<p class="tdm-empty-msg">${escapeHtml(err.message || "تعذر تحميل التلاميذ.")}</p>`;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Render Students List: Gmail Inbox Style
  // --------------------------------------------------------------------------
  function renderGmailStudentsList() {
    const container = document.getElementById("tdm-gmail-students-list");
    if (!container) return;

    let filtered = studentsData.slice();

    // 1. Filter Chips
    if (activeFilter === "PAID") {
      filtered = filtered.filter((s) => s.paymentStage === "PAID" || s.paymentStatus === true);
    } else if (activeFilter === "UNPAID") {
      filtered = filtered.filter((s) => s.paymentStage === "UNPAID" || (!s.paymentStatus && s.paymentStage !== "PROMISED"));
    } else if (activeFilter === "PROMISED") {
      filtered = filtered.filter((s) => s.paymentStage === "PROMISED");
    } else if (activeFilter === "LIVE_ALLOWED") {
      filtered = filtered.filter((s) => Boolean(s.liveAccessEnabled));
    }

    // 2. Search Query
    if (activeSearchQuery) {
      const q = activeSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          (s.studentName && s.studentName.toLowerCase().includes(q)) ||
          (s.parentPhone && s.parentPhone.includes(q)) ||
          (s.studentPin && String(s.studentPin).includes(q))
      );
    }

    // Update count
    const statsCount = document.getElementById("tdm-stats-students-count");
    if (statsCount) statsCount.textContent = `${filtered.length} تلميذ`;

    if (!filtered.length) {
      container.innerHTML = `<p class="tdm-empty-msg">لا توجد نتائج مطابقة للبحث أو التصفية.</p>`;
      return;
    }

    container.innerHTML = "";

    filtered.forEach((student) => {
      const row = document.createElement("div");
      row.className = "tdm-gmail-row";
      row.dataset.id = student.id;

      // Color & Initial
      const avatarColor = getAvatarColor(student.studentName);
      const initial = getInitial(student.studentName);

      // Payment Pill
      let payPill = `<span class="tdm-gmail-pill pill-unpaid">غير مدفوع</span>`;
      if (student.paymentStage === "PAID" || student.paymentStatus === true) {
        payPill = `<span class="tdm-gmail-pill pill-paid">تم الدفع ${student.amountDue ? `(${student.amountDue} دج)` : ""}</span>`;
      } else if (student.paymentStage === "PROMISED") {
        payPill = `<span class="tdm-gmail-pill pill-promised">وعد بالدفع</span>`;
      }

      // Subject tags
      let subPill = "";
      if (student.mathEnrollment && student.physicsEnrollment) {
        subPill = `<span class="tdm-gmail-pill pill-subject">رياضيات وفيزياء</span>`;
      } else if (student.mathEnrollment) {
        subPill = `<span class="tdm-gmail-pill pill-subject">رياضيات</span>`;
      } else if (student.physicsEnrollment) {
        subPill = `<span class="tdm-gmail-pill pill-subject">فيزياء</span>`;
      }

      // Live Access Pill
      const livePill = student.liveAccessEnabled
        ? `<span class="tdm-gmail-pill pill-live-ok">مسموح بالبث 🟢</span>`
        : `<span class="tdm-gmail-pill pill-live-no">محظور 🔒</span>`;

      // Formatted Date (Gmail format e.g. "12 سبتمبر")
      let dateText = "—";
      if (student.createdAt) {
        try {
          const d = new Date(student.createdAt);
          dateText = d.toLocaleDateString("ar-DZ", { day: "numeric", month: "short" });
        } catch (_) {}
      }

      row.innerHTML = `
        <div class="tdm-gmail-avatar ${avatarColor}">${initial}</div>
        <div class="tdm-gmail-body-wrap">
          <div class="tdm-row-top">
            <strong class="tdm-student-sender">${escapeHtml(student.studentName)}</strong>
            <span class="tdm-row-date">${dateText}</span>
          </div>
          <div class="tdm-row-phone">📞 ${escapeHtml(student.parentPhone || "لا يوجد رقم")} · PIN: ${escapeHtml(student.studentPin || "—")}</div>
          <div class="tdm-row-pills">
            ${payPill}
            ${subPill}
            ${livePill}
          </div>
        </div>
        <span class="tdm-row-arrow">‹</span>
      `;

      row.addEventListener("click", () => openStudentActionSheet(student));
      container.appendChild(row);
    });
  }

  // --------------------------------------------------------------------------
  // Gmail Action Bottom Sheet: Tapping on any Student
  // --------------------------------------------------------------------------
  function openStudentActionSheet(student) {
    if (!student) return;
    selectedStudent = student;

    const sheet = document.getElementById("tdm-action-sheet");
    if (!sheet) return;

    // Header info
    const avatar = document.getElementById("sheet-avatar");
    if (avatar) {
      avatar.textContent = getInitial(student.studentName);
      avatar.className = `tdm-sheet-avatar ${getAvatarColor(student.studentName)}`;
    }

    const nameEl = document.getElementById("sheet-student-name");
    if (nameEl) nameEl.textContent = student.studentName;

    const pinEl = document.getElementById("sheet-student-pin");
    if (pinEl) pinEl.textContent = `PIN: ${student.studentPin || "—"}`;

    const payEl = document.getElementById("sheet-student-pay");
    if (payEl) {
      payEl.textContent = student.paymentStage === "PAID" ? "تم الدفع" : student.paymentStage === "PROMISED" ? "وعد بالدفع" : "غير مدفوع";
      payEl.className = `tdm-pay-chip ${student.paymentStage === "PAID" ? "pill-paid" : student.paymentStage === "PROMISED" ? "pill-promised" : "pill-unpaid"}`;
    }

    const subEl = document.getElementById("sheet-student-sub");
    if (subEl) {
      subEl.textContent = student.mathEnrollment && student.physicsEnrollment ? "رياضيات وفيزياء" : student.mathEnrollment ? "رياضيات فقط" : student.physicsEnrollment ? "فيزياء فقط" : "عام";
    }

    // Phone & Call Link
    const rawPhone = String(student.parentPhone || "").replace(/\D/g, "");
    const callBtn = document.getElementById("sheet-call-btn");
    const phoneLabel = document.getElementById("sheet-phone-label");
    if (callBtn && phoneLabel) {
      phoneLabel.textContent = student.parentPhone || "لا يوجد رقم مسجل";
      callBtn.href = rawPhone ? `tel:${rawPhone}` : "#";
      callBtn.style.opacity = rawPhone ? "1" : "0.5";
    }

    // WhatsApp Link
    const waBtn = document.getElementById("sheet-wa-btn");
    if (waBtn) {
      const waNumber = rawPhone.startsWith("0") ? "213" + rawPhone.slice(1) : rawPhone;
      waBtn.href = rawPhone ? `https://wa.me/${waNumber}` : "#";
      waBtn.style.opacity = rawPhone ? "1" : "0.5";
    }

    // Live Access Toggle
    updateSheetLiveState(student.liveAccessEnabled);

    sheet.hidden = false;
  }

  function updateSheetLiveState(isAllowed) {
    const liveLabel = document.getElementById("sheet-live-label");
    const liveBadge = document.getElementById("sheet-live-badge");
    if (liveLabel) {
      liveLabel.textContent = isAllowed ? "الحالة: مسموح بالدخول ✓" : "الحالة: محظور من الدخول 🔒";
    }
    if (liveBadge) {
      liveBadge.textContent = isAllowed ? "مسموح ✓" : "محظور 🔒";
      liveBadge.className = `action-status-pill ${isAllowed ? "is-allowed" : "is-blocked"}`;
    }
  }

  function closeAllSheets() {
    document.querySelectorAll(".tdm-sheet-overlay").forEach((s) => (s.hidden = true));
  }

  // --------------------------------------------------------------------------
  // Live Access Fast Toggle in Action Sheet
  // --------------------------------------------------------------------------
  async function toggleStudentLiveAccess() {
    if (!selectedStudent) return;
    const nextVal = !Boolean(selectedStudent.liveAccessEnabled);

    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(selectedStudent.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          paymentStage: selectedStudent.paymentStage || "UNPAID",
          amountDue: selectedStudent.amountDue === null ? null : Number(selectedStudent.amountDue),
          mathEnrollment: Boolean(selectedStudent.mathEnrollment),
          physicsEnrollment: Boolean(selectedStudent.physicsEnrollment),
          liveAccessEnabled: nextVal,
          mathNote: selectedStudent.mathNote || "",
          physicsNote: selectedStudent.physicsNote || "",
        }),
      });

      if (!response.ok) throw new Error("تعذر تعديل صلاحية الحصة المباشرة.");

      selectedStudent.liveAccessEnabled = nextVal;
      updateSheetLiveState(nextVal);
      renderGmailStudentsList();
      showToast(nextVal ? "تم السماح للتلميذ بدخول الحصة المباشرة ✓" : "تم حظر التلميذ من دخول الحصة 🔒");
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء تعديل صلاحية الحصة.");
    }
  }

  // --------------------------------------------------------------------------
  // Modal: Edit Student Contact (Name & Parent Phone)
  // --------------------------------------------------------------------------
  function openEditContactModal() {
    if (!selectedStudent) return;
    closeAllSheets();

    const modal = document.getElementById("modal-edit-contact");
    if (!modal) return;

    document.getElementById("edit-contact-student-id").value = selectedStudent.id;
    document.getElementById("edit-contact-name").value = selectedStudent.studentName || "";
    document.getElementById("edit-contact-phone").value = selectedStudent.parentPhone || "";

    modal.hidden = false;
  }

  async function handleEditContactSubmit(e) {
    e.preventDefault();
    if (!selectedStudent) return;

    const newName = document.getElementById("edit-contact-name").value.trim();
    const newPhone = document.getElementById("edit-contact-phone").value.trim();
    if (!newName || !newPhone) {
      showToast("يرجى إدخال الاسم ورقم الهاتف.");
      return;
    }

    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(selectedStudent.id)}/contact`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ studentName: newName, parentPhone: newPhone }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "تعذر حفظ تعديل البيانات.");

      selectedStudent.studentName = newName;
      selectedStudent.parentPhone = newPhone;

      closeAllSheets();
      renderGmailStudentsList();
      showToast("تم تحديث اسم ورقم التلميذ بنجاح ✓");
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء حفظ التعديل.");
    }
  }

  // --------------------------------------------------------------------------
  // Modal: Edit Subscription & Payment
  // --------------------------------------------------------------------------
  function openEditSubModal() {
    if (!selectedStudent) return;
    closeAllSheets();

    const modal = document.getElementById("modal-edit-sub");
    if (!modal) return;

    document.getElementById("edit-sub-student-id").value = selectedStudent.id;
    document.getElementById("edit-sub-stage").value = selectedStudent.paymentStage || "UNPAID";
    document.getElementById("edit-sub-amount").value = selectedStudent.amountDue || "";
    document.getElementById("edit-sub-math").checked = Boolean(selectedStudent.mathEnrollment);
    document.getElementById("edit-sub-physics").checked = Boolean(selectedStudent.physicsEnrollment);
    document.getElementById("edit-sub-live-access").checked = Boolean(selectedStudent.liveAccessEnabled);

    modal.hidden = false;
  }

  async function handleEditSubSubmit(e) {
    e.preventDefault();
    if (!selectedStudent) return;

    const paymentStage = document.getElementById("edit-sub-stage").value;
    const amountVal = document.getElementById("edit-sub-amount").value.trim();
    const amountDue = paymentStage === "UNPAID" ? null : amountVal ? Number(amountVal) : 2000;
    const mathEnrollment = document.getElementById("edit-sub-math").checked;
    const physicsEnrollment = document.getElementById("edit-sub-physics").checked;
    const liveAccessEnabled = document.getElementById("edit-sub-live-access").checked;

    if (!mathEnrollment && !physicsEnrollment) {
      showToast("يجب اختيار مادة واحدة على الأقل (الرياضيات أو الفيزياء).");
      return;
    }

    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(selectedStudent.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          paymentStage,
          amountDue,
          mathEnrollment,
          physicsEnrollment,
          liveAccessEnabled,
          mathNote: selectedStudent.mathNote || "",
          physicsNote: selectedStudent.physicsNote || "",
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "تعذر حفظ حالة الاشتراك.");

      selectedStudent.paymentStage = paymentStage;
      selectedStudent.amountDue = amountDue;
      selectedStudent.mathEnrollment = mathEnrollment;
      selectedStudent.physicsEnrollment = physicsEnrollment;
      selectedStudent.liveAccessEnabled = liveAccessEnabled;

      closeAllSheets();
      renderGmailStudentsList();
      showToast("تم تحديث حالة الاشتراك والدفع بنجاح ✓");
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء حفظ الاشتراك.");
    }
  }

  // --------------------------------------------------------------------------
  // Modal: View Attendance Records
  // --------------------------------------------------------------------------
  async function openAttendanceModal() {
    if (!selectedStudent) return;
    closeAllSheets();

    const modal = document.getElementById("modal-attendance");
    const nameEl = document.getElementById("attendance-student-name");
    const listEl = document.getElementById("attendance-records-list");
    if (!modal) return;

    if (nameEl) nameEl.textContent = selectedStudent.studentName;
    if (listEl) listEl.innerHTML = `<p class="tdm-empty-msg">جارٍ تحميل سجل الحضور…</p>`;
    modal.hidden = false;

    try {
      const response = await teacherFetch(`/api/attendance/student/${encodeURIComponent(selectedStudent.id)}`);
      if (!response.ok) throw new Error();
      const data = await response.json().catch(() => ({}));
      const records = Array.isArray(data.attendance) ? data.attendance : [];

      if (!records.length) {
        listEl.innerHTML = `<p class="tdm-empty-msg">لا توجد سجلات حضور مسجلة لهذا التلميذ بعد.</p>`;
        return;
      }

      listEl.innerHTML = records
        .map((rec) => {
          const dt = new Date(rec.joinedAt || rec.createdAt);
          const dateStr = dt.toLocaleDateString("ar-DZ", { weekday: "short", day: "numeric", month: "long" });
          const timeStr = dt.toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" });
          return `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="font-size:0.85rem;">حضر الحصة المباشرة</strong>
                <p style="font-size:0.75rem; color:#64748b;">${dateStr} - ${timeStr}</p>
              </div>
              <span style="color:#059669; font-weight:800; font-size:0.8rem;">حاضر ✓</span>
            </div>
          `;
        })
        .join("");
    } catch (_) {
      listEl.innerHTML = `<p class="tdm-empty-msg">تعذر تحميل سجل الحضور.</p>`;
    }
  }

  // --------------------------------------------------------------------------
  // Modal: Confirm Delete
  // --------------------------------------------------------------------------
  function openDeleteModal() {
    if (!selectedStudent) return;
    closeAllSheets();

    const modal = document.getElementById("modal-delete-confirm");
    const nameLabel = document.getElementById("delete-student-name-label");
    if (!modal) return;

    if (nameLabel) nameLabel.textContent = `«${selectedStudent.studentName}»`;
    modal.hidden = false;
  }

  async function handleConfirmDelete() {
    if (!selectedStudent) return;
    const studentId = selectedStudent.id;
    closeAllSheets();

    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "تعذر حذف التلميذ.");

      studentsData = studentsData.filter((s) => s.id !== studentId);
      selectedStudent = null;
      renderGmailStudentsList();
      showToast("تم حذف حساب التلميذ نهائياً.");
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء الحذف.");
    }
  }

  // --------------------------------------------------------------------------
  // Top Grid Actions (Online Users, Absence, Public Invite)
  // --------------------------------------------------------------------------
  async function fetchOnlineUsersCount() {
    try {
      const response = await teacherFetch("/api/teacher/online-users");
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const count = Number(data.count ?? data.total ?? (Array.isArray(data.users) ? data.users.length : 0));
      const countEl = document.getElementById("tdm-online-count");
      if (countEl) countEl.textContent = count;
    } catch (_) {}
  }

  async function toggleAbsence() {
    isAbsent = !isAbsent;
    try {
      const response = await teacherFetch("/api/teacher/absence", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ isAbsent }),
      });
      if (!response.ok) throw new Error();

      updateAbsenceUI(isAbsent);
      showToast(isAbsent ? "تم الإعلان عن غياب الأستاذ." : "تم إلغاء الغياب: الأستاذ حاضر.");
    } catch (_) {
      // Revert on failure
      isAbsent = !isAbsent;
      showToast("تعذر تغيير حالة الحضور.");
    }
  }

  function updateAbsenceUI(absent) {
    const btnLabel = document.getElementById("tdm-absence-btn-label");
    const presenceChip = document.getElementById("tdm-presence-indicator");
    const presenceText = document.getElementById("tdm-presence-text");
    const absenceBtn = document.getElementById("tdm-btn-absence-toggle");

    if (btnLabel) btnLabel.textContent = absent ? "معلن غائب" : "حاضر";
    if (absenceBtn) absenceBtn.classList.toggle("is-absent", absent);
    if (presenceChip) presenceChip.classList.toggle("is-absent", absent);
    if (presenceText) presenceText.textContent = absent ? "الأستاذ غائب" : "جاهز للإدارة";
  }

  async function handlePublicInvite() {
    try {
      const response = await teacherFetch("/api/classes/public-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (data.inviteUrl) {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(data.inviteUrl);
          showToast("تم نسخ رابط الحصة العامة للحافظة 📋");
        } else {
          alert(`رابط الحصة العامة:\n${data.inviteUrl}`);
        }
      } else {
        showToast("تم إنشاء الحصة العامة بنجاح.");
      }
    } catch (_) {
      showToast("تعذر إنشاء رابط الحصة العامة.");
    }
  }

  // --------------------------------------------------------------------------
  // View 2: Notifications
  // --------------------------------------------------------------------------
  async function loadNotifications() {
    const historyList = document.getElementById("tdm-notif-history");
    if (!historyList) return;

    try {
      const response = await teacherFetch(`/api/teacher/notifications?level=${encodeURIComponent(currentLevel)}`);
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const list = Array.isArray(data.notifications) ? data.notifications : [];

      if (!list.length) {
        historyList.innerHTML = `<p class="tdm-empty-msg">لا توجد تنبيهات سابقة لهذا المستوى.</p>`;
        return;
      }

      historyList.innerHTML = list
        .map(
          (n) => `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong style="font-size:0.9rem;">${escapeHtml(n.title)}</strong>
              <span style="font-size:0.7rem; color:#64748b;">${new Date(n.createdAt).toLocaleDateString("ar-DZ")}</span>
            </div>
            <p style="font-size:0.8rem; color:#475569;">${escapeHtml(n.body)}</p>
          </div>`
        )
        .join("");
    } catch (_) {}
  }

  async function handleNotificationSubmit(e) {
    e.preventDefault();
    const target = document.getElementById("tdm-notif-target").value;
    const subject = document.getElementById("tdm-notif-subject").value;
    const title = document.getElementById("tdm-notif-title").value.trim();
    const body = document.getElementById("tdm-notif-body").value.trim();
    const timing = document.querySelector('input[name="notif-timing"]:checked')?.value || "IMMEDIATE";

    try {
      const response = await teacherFetch("/api/teacher/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          level: currentLevel,
          paymentStage: target,
          subject,
          title,
          body,
          delivery: timing,
        }),
      });

      if (!response.ok) throw new Error("تعذر إرسال التنبيه.");
      showToast("تم إرسال التنبيه بنجاح 🚀");
      e.target.reset();
      loadNotifications();
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء الإرسال.");
    }
  }

  // --------------------------------------------------------------------------
  // View 3: Schedule
  // --------------------------------------------------------------------------
  async function loadSchedule() {
    const list = document.getElementById("tdm-sched-list");
    if (!list) return;

    try {
      const response = await teacherFetch(`/api/schedules/${encodeURIComponent(currentLevel)}`);
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      scheduledClasses = Array.isArray(data.scheduledClasses) ? data.scheduledClasses : [];

      if (!scheduledClasses.length) {
        list.innerHTML = `<p class="tdm-empty-msg">لا توجد حصص مبرمجة حالياً لهذا المستوى.</p>`;
        return;
      }

      list.innerHTML = scheduledClasses
        .map((sc) => {
          const dt = new Date(sc.scheduledAt);
          const dateStr = dt.toLocaleDateString("ar-DZ", { weekday: "long", month: "long", day: "numeric" });
          const timeStr = dt.toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" });
          return `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${sc.subject === "MATH" ? "📐 حصة الرياضيات" : "⚡ حصة الفيزياء"}</strong>
                <button type="button" class="tdm-btn-del-student" style="height:30px; font-size:0.75rem;" data-del-sched="${sc.id}">إلغاء</button>
              </div>
              <p style="font-size:0.78rem; color:#64748b; margin:4px 0 8px;">📅 ${dateStr} الساعة ${timeStr}</p>
              <a href="./teacher-live-mobile.html" class="tdm-submit-btn" style="height:36px; font-size:0.78rem; text-decoration:none; display:flex; align-items:center; justify-content:center;">
                بدء الحصة المباشرة 🎥
              </a>
            </div>
          `;
        })
        .join("");
    } catch (_) {}
  }

  async function handleScheduleSubmit(e) {
    e.preventDefault();
    const subject = document.getElementById("tdm-sched-subject").value;
    const dtVal = document.getElementById("tdm-sched-datetime").value;
    if (!dtVal) {
      showToast("يرجى تحديد التاريخ والوقت.");
      return;
    }

    try {
      const scheduledAt = new Date(dtVal).toISOString();
      const response = await teacherFetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ level: currentLevel, subject, scheduledAt }),
      });
      if (!response.ok) throw new Error("تعذر حفظ الحصة المبرمجة.");

      showToast("تمت برمجة الحصة بنجاح 📅");
      e.target.reset();
      loadSchedule();
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء البرمجة.");
    }
  }

  // --------------------------------------------------------------------------
  // View 5: Payments
  // --------------------------------------------------------------------------
  async function loadPayments(kind = "manual") {
    const panel = document.getElementById("tdm-payments-content");
    const manualBadge = document.getElementById("pay-manual-count");
    if (!panel) return;

    const receipts = studentsData.filter((s) => s.paymentReceiptPending || s.paymentReceiptUrl);
    if (manualBadge) manualBadge.textContent = receipts.length;

    if (kind === "manual") {
      if (!receipts.length) {
        panel.innerHTML = `<p class="tdm-empty-msg">لا توجد وصولات دفع مرفوعة حالياً.</p>`;
        return;
      }

      panel.innerHTML = receipts
        .map(
          (s) => `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong>${escapeHtml(s.studentName)}</strong>
              <span class="tdm-gmail-pill pill-promised">وصل مرفوع</span>
            </div>
            <p style="font-size:0.78rem; color:#64748b;">هاتف الولي: ${escapeHtml(s.parentPhone || "—")}</p>
            ${
              s.paymentReceiptUrl
                ? `<div style="text-align:center; padding:6px; background:#fff; border-radius:8px; margin:6px 0;">
                    <img src="${s.paymentReceiptUrl}" alt="وصل الدفع" style="max-height:160px; max-width:100%; border-radius:6px;" />
                   </div>`
                : ""
            }
            <button type="button" class="tdm-submit-btn" style="height:36px; font-size:0.78rem;" data-confirm-pay="${s.id}">
              تأكيد الدفع وتفعيل الحساب ✓
            </button>
          </div>
        `
        )
        .join("");
    } else {
      panel.innerHTML = `<p class="tdm-empty-msg">جارٍ فحص عمليات الدفع الإلكتروني عبر البطاقة…</p>`;
    }
  }

  async function confirmStudentPayment(studentId) {
    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}/confirm-payment-receipt`, {
        method: "POST",
      });
      if (!response.ok) throw new Error();

      const student = studentsData.find((s) => s.id === studentId);
      if (student) {
        student.paymentStage = "PAID";
        student.paymentReceiptPending = false;
        student.liveAccessEnabled = true;
      }
      loadPayments("manual");
      renderGmailStudentsList();
      showToast("تم تأكيد وصل الدفع وتفعيل الحساب بنجاح ✓");
    } catch (_) {
      showToast("تعذر تأكيد وصل الدفع.");
    }
  }

  // --------------------------------------------------------------------------
  // Initialization & Event Binding
  // --------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (!getTeacherToken()) return;

    // 1. Level Chips
    document.querySelectorAll(".tdm-level-chip").forEach((chip) => {
      chip.addEventListener("click", () => setLevel(chip.dataset.level));
    });

    // 2. Section Navigation Pills
    document.querySelectorAll(".tdm-sec-pill").forEach((pill) => {
      pill.addEventListener("click", () => setView(pill.dataset.view));
    });

    // 3. Quick Action Button for Notifications
    document.getElementById("tdm-btn-quick-notif")?.addEventListener("click", () => setView("notifications"));

    // 4. Search Bar
    const searchInput = document.getElementById("tdm-student-search-input");
    const clearBtn = document.getElementById("tdm-clear-search-btn");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        activeSearchQuery = searchInput.value.trim();
        if (clearBtn) clearBtn.hidden = !activeSearchQuery;
        renderGmailStudentsList();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        activeSearchQuery = "";
        clearBtn.hidden = true;
        renderGmailStudentsList();
      });
    }

    // 5. Filter Chips
    document.querySelectorAll(".tdm-gmail-filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".tdm-gmail-filter-chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        activeFilter = chip.dataset.filter || "ALL";
        renderGmailStudentsList();
      });
    });

    // 6. Action Sheet Event Handlers
    document.getElementById("sheet-close-btn")?.addEventListener("click", closeAllSheets);
    document.getElementById("sheet-live-toggle-btn")?.addEventListener("click", toggleStudentLiveAccess);
    document.getElementById("sheet-edit-contact-btn")?.addEventListener("click", openEditContactModal);
    document.getElementById("sheet-edit-sub-btn")?.addEventListener("click", openEditSubModal);
    document.getElementById("sheet-attendance-btn")?.addEventListener("click", openAttendanceModal);
    document.getElementById("sheet-delete-btn")?.addEventListener("click", openDeleteModal);

    // 7. Modals Close Buttons
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", closeAllSheets);
    });

    // 8. Form Submissions
    document.getElementById("form-edit-contact")?.addEventListener("submit", handleEditContactSubmit);
    document.getElementById("form-edit-sub")?.addEventListener("submit", handleEditSubSubmit);
    document.getElementById("tdm-btn-confirm-delete")?.addEventListener("click", handleConfirmDelete);
    document.getElementById("tdm-notif-form")?.addEventListener("submit", handleNotificationSubmit);
    document.getElementById("tdm-sched-form")?.addEventListener("submit", handleScheduleSubmit);

    // 9. Top Grid Buttons
    document.getElementById("tdm-btn-absence-toggle")?.addEventListener("click", toggleAbsence);
    document.getElementById("tdm-btn-public-invite")?.addEventListener("click", handlePublicInvite);

    document.getElementById("tdm-btn-desktop-switch")?.addEventListener("click", () => {
      sessionStorage.setItem("teacherDashboardDesktopMode", "1");
    });

    document.getElementById("tdm-btn-logout")?.addEventListener("click", () => {
      sessionStorage.removeItem(TEACHER_TOKEN_KEY);
      sessionStorage.removeItem("teacherDashboardDesktopMode");
      window.location.replace("./teacher-login.html");
    });

    // 10. Payments delegation
    document.getElementById("tdm-payments-content")?.addEventListener("click", (e) => {
      const payBtn = e.target.closest("[data-confirm-pay]");
      if (payBtn) confirmStudentPayment(payBtn.dataset.confirmPay);
    });

    document.querySelectorAll("[data-paytab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("[data-paytab]").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        loadPayments(tab.dataset.paytab);
      });
    });

    // 11. Schedule delegation (Cancel class)
    document.getElementById("tdm-sched-list")?.addEventListener("click", async (e) => {
      const delBtn = e.target.closest("[data-del-sched]");
      if (delBtn && confirm("هل تريد إلغاء هذه الحصة؟")) {
        try {
          await teacherFetch(`/api/schedules/${encodeURIComponent(delBtn.dataset.delSched)}`, { method: "DELETE" });
          showToast("تم إلغاء الحصة المبرمجة.");
          loadSchedule();
        } catch (_) {}
      }
    });

    // Initial Load
    setLevel(currentLevel);
    fetchOnlineUsersCount();
    window.setInterval(fetchOnlineUsersCount, 25000);
  });
})();
