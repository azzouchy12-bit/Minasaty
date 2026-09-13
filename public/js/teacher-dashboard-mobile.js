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
  let receiptPreviewObjectUrl = null;
  let receiptPreviewStudentId = null;
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
    }, 3200);
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

    if (activeView === "schedule") loadSchedule();
    else if (activeView === "notifications") loadNotifications();
    else if (activeView === "assignments") loadAssignments();
    else if (activeView === "lessons") loadLessons();
    else if (activeView === "payments") loadPayments();
  }

  // --------------------------------------------------------------------------
  // Section Navigation (Gmail Sub-Tabs)
  // --------------------------------------------------------------------------
  function setView(viewName) {
    activeView = viewName || "students";

    document.querySelectorAll(".tdm-sec-pill").forEach((pill) => {
      const isCurrent = pill.dataset.view === activeView;
      pill.classList.toggle("is-active", isCurrent);
      if (isCurrent) {
        try {
          pill.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        } catch (_) {}
      }
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
  // Fetch Students & Stats (Respecting Backend limit <= 100)
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
      const rosterPath = `/api/students/level/${encodeURIComponent(level)}`;
      const requestRosterPage = async (page = 1) => {
        const response = await teacherFetch(
          `${rosterPath}?page=${page}&limit=100`,
          { headers: { Accept: "application/json" } }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "تعذر تحميل قائمة التلاميذ.");
        }
        return data;
      };

      const firstPage = await requestRosterPage(1);
      const firstStudents = Array.isArray(firstPage?.data)
        ? firstPage.data
        : Array.isArray(firstPage)
        ? firstPage
        : [];
      const totalPages = Math.max(1, Number(firstPage?.meta?.totalPages) || 1);
      const remainingPages =
        totalPages > 1
          ? await Promise.all(
              Array.from({ length: totalPages - 1 }, (_, index) =>
                requestRosterPage(index + 2)
              )
            )
          : [];

      studentsData = [
        ...firstStudents,
        ...remainingPages.flatMap((pageData) =>
          Array.isArray(pageData?.data)
            ? pageData.data
            : Array.isArray(pageData)
            ? pageData
            : []
        ),
      ];

      // Update counters
      const countEl = document.getElementById("sec-students-count");
      if (countEl) countEl.textContent = studentsData.length;

      const statsCount = document.getElementById("tdm-stats-students-count");
      if (statsCount) statsCount.textContent = `${studentsData.length} تلميذ`;

      renderGmailStudentsList();

      // Refresh payments badges
      const manualBadge = document.getElementById("pay-manual-count");
      if (manualBadge) {
        const pendingCount = studentsData.filter(
          (s) => s.paymentReceiptPending || s.paymentReceiptUrl
        ).length;
        manualBadge.textContent = pendingCount;
      }
    } catch (err) {
      console.error("Fetch students error:", err);
      showAlert(err.message || "تعذر تحميل بيانات المستوى.");
      if (container) {
        container.innerHTML = `<div class="tdm-empty-state"><p style="color:#dc2626; font-weight:700;">${escapeHtml(
          err.message || "تعذر تحميل التلاميذ."
        )}</p></div>`;
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
      filtered = filtered.filter(
        (s) => s.paymentStage === "PAID" || s.paymentStatus === true
      );
    } else if (activeFilter === "UNPAID") {
      filtered = filtered.filter(
        (s) =>
          s.paymentStage === "UNPAID" ||
          (!s.paymentStatus && s.paymentStage !== "PROMISED")
      );
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
        payPill = `<span class="tdm-gmail-pill pill-paid">تم الدفع ${
          student.amountDue ? `(${student.amountDue} دج)` : ""
        }</span>`;
      } else if (student.paymentStage === "PROMISED") {
        payPill = `<span class="tdm-gmail-pill pill-promised">وعد بالدفع</span>`;
      }

      // Receipt pill
      let receiptPill = "";
      if (student.paymentReceiptPending || student.paymentReceiptUrl) {
        receiptPill = `<span class="tdm-gmail-pill pill-promised" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a;">📷 وصل مرفوع</span>`;
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
          dateText = d.toLocaleDateString("ar-DZ", {
            day: "numeric",
            month: "short",
          });
        } catch (_) {}
      }

      row.innerHTML = `
        <div class="tdm-gmail-avatar ${avatarColor}">${initial}</div>
        <div class="tdm-gmail-body-wrap">
          <div class="tdm-row-top">
            <strong class="tdm-student-sender">${escapeHtml(
              student.studentName
            )}</strong>
            <span class="tdm-row-date">${dateText}</span>
          </div>
          <div class="tdm-row-phone">📞 ${escapeHtml(
            student.parentPhone || "لا يوجد رقم"
          )} · PIN: ${escapeHtml(student.studentPin || "—")}</div>
          <div class="tdm-row-pills">
            ${payPill}
            ${receiptPill}
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
      avatar.className = `tdm-sheet-avatar ${getAvatarColor(
        student.studentName
      )}`;
    }

    const nameEl = document.getElementById("sheet-student-name");
    if (nameEl) nameEl.textContent = student.studentName;

    const pinEl = document.getElementById("sheet-student-pin");
    if (pinEl) pinEl.textContent = `PIN: ${student.studentPin || "—"}`;

    const payEl = document.getElementById("sheet-student-pay");
    if (payEl) {
      payEl.textContent =
        student.paymentStage === "PAID"
          ? "تم الدفع"
          : student.paymentStage === "PROMISED"
          ? "وعد بالدفع"
          : "غير مدفوع";
      payEl.className = `tdm-pay-chip ${
        student.paymentStage === "PAID"
          ? "pill-paid"
          : student.paymentStage === "PROMISED"
          ? "pill-promised"
          : "pill-unpaid"
      }`;
    }

    const subEl = document.getElementById("sheet-student-sub");
    if (subEl) {
      subEl.textContent =
        student.mathEnrollment && student.physicsEnrollment
          ? "رياضيات وفيزياء"
          : student.mathEnrollment
          ? "رياضيات فقط"
          : student.physicsEnrollment
          ? "فيزياء فقط"
          : "عام";
    }

    // Phone & Call Link
    const rawPhone = String(student.parentPhone || "").replace(/\D/g, "");
    const callBtn = document.getElementById("sheet-call-btn");
    const phoneLabel = document.getElementById("sheet-phone-label");
    if (callBtn && phoneLabel) {
      if (rawPhone) {
        callBtn.href = `tel:${rawPhone}`;
        phoneLabel.textContent = `اتصال مباشر: ${student.parentPhone}`;
        callBtn.style.opacity = "1";
        callBtn.style.pointerEvents = "auto";
      } else {
        callBtn.href = "#";
        phoneLabel.textContent = "لا يوجد رقم مسجل";
        callBtn.style.opacity = "0.5";
        callBtn.style.pointerEvents = "none";
      }
    }

    // WhatsApp Link
    const waBtn = document.getElementById("sheet-wa-btn");
    if (waBtn) {
      if (rawPhone) {
        let dzPhone = rawPhone;
        if (dzPhone.startsWith("0")) dzPhone = "213" + dzPhone.substring(1);
        else if (!dzPhone.startsWith("213")) dzPhone = "213" + dzPhone;
        waBtn.href = `https://wa.me/${dzPhone}`;
        waBtn.style.opacity = "1";
        waBtn.style.pointerEvents = "auto";
      } else {
        waBtn.href = "#";
        waBtn.style.opacity = "0.5";
        waBtn.style.pointerEvents = "none";
      }
    }

    // Live Access state
    updateSheetLiveState(Boolean(student.liveAccessEnabled));

    // Receipt Button
    const receiptBtn = document.getElementById("sheet-receipt-btn");
    const receiptLabel = document.getElementById("sheet-receipt-label");
    if (receiptBtn) {
      if (student.paymentReceiptUrl || student.paymentReceiptPending) {
        receiptBtn.hidden = false;
        if (receiptLabel) {
          receiptLabel.textContent = student.paymentReceiptPending
            ? "وصل جديد بانتظار المراجعة والتأكيد ⚠️"
            : "معاينة الوصل المرفوع ✓";
        }
      } else {
        receiptBtn.hidden = true;
      }
    }

    // Open sheet
    closeAllSheets();
    sheet.hidden = false;
  }

  function updateSheetLiveState(isAllowed) {
    const liveLabel = document.getElementById("sheet-live-label");
    const liveBadge = document.getElementById("sheet-live-badge");
    if (liveLabel) {
      liveLabel.textContent = isAllowed
        ? "الحالة: مسموح بالدخول ✓"
        : "الحالة: محظور من الدخول 🔒";
    }
    if (liveBadge) {
      liveBadge.textContent = isAllowed ? "مسموح ✓" : "محظور 🔒";
      liveBadge.className = `action-status-pill ${
        isAllowed ? "is-allowed" : "is-blocked"
      }`;
    }
  }

  function closeAllSheets() {
    document
      .querySelectorAll(".tdm-sheet-overlay")
      .forEach((s) => (s.hidden = true));
  }

  // --------------------------------------------------------------------------
  // Live Access Fast Toggle in Action Sheet
  // --------------------------------------------------------------------------
  async function toggleStudentLiveAccess() {
    if (!selectedStudent) return;
    const nextVal = !Boolean(selectedStudent.liveAccessEnabled);

    try {
      const response = await teacherFetch(
        `/api/students/${encodeURIComponent(selectedStudent.id)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            paymentStage: selectedStudent.paymentStage || "UNPAID",
            amountDue:
              selectedStudent.amountDue === null
                ? null
                : Number(selectedStudent.amountDue),
            mathEnrollment: Boolean(selectedStudent.mathEnrollment),
            physicsEnrollment: Boolean(selectedStudent.physicsEnrollment),
            liveAccessEnabled: nextVal,
            mathNote: selectedStudent.mathNote || "",
            physicsNote: selectedStudent.physicsNote || "",
          }),
        }
      );

      if (!response.ok) throw new Error("تعذر تعديل صلاحية الحصة المباشرة.");

      selectedStudent.liveAccessEnabled = nextVal;
      updateSheetLiveState(nextVal);
      renderGmailStudentsList();
      showToast(
        nextVal
          ? "تم السماح للتلميذ بدخول الحصة المباشرة ✓"
          : "تم حظر التلميذ من دخول الحصة 🔒"
      );
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

    document.getElementById("edit-contact-student-id").value =
      selectedStudent.id;
    document.getElementById("edit-contact-name").value =
      selectedStudent.studentName || "";
    document.getElementById("edit-contact-phone").value =
      selectedStudent.parentPhone || "";

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
      const response = await teacherFetch(
        `/api/students/${encodeURIComponent(selectedStudent.id)}/contact`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ studentName: newName, parentPhone: newPhone }),
        }
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "تعذر حفظ التعديلات.");
      }

      selectedStudent.studentName = newName;
      selectedStudent.parentPhone = newPhone;

      closeAllSheets();
      renderGmailStudentsList();
      showToast("تم تحديث بيانات التلميذ بنجاح ✓");
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء التعديل.");
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
    document.getElementById("edit-sub-stage").value =
      selectedStudent.paymentStage || "UNPAID";
    document.getElementById("edit-sub-amount").value =
      selectedStudent.amountDue || "";
    document.getElementById("edit-sub-math").checked = Boolean(
      selectedStudent.mathEnrollment
    );
    document.getElementById("edit-sub-physics").checked = Boolean(
      selectedStudent.physicsEnrollment
    );
    document.getElementById("edit-sub-live-access").checked = Boolean(
      selectedStudent.liveAccessEnabled
    );

    modal.hidden = false;
  }

  async function handleEditSubSubmit(e) {
    e.preventDefault();
    if (!selectedStudent) return;

    const stage = document.getElementById("edit-sub-stage").value;
    const amountVal = document.getElementById("edit-sub-amount").value.trim();
    const math = document.getElementById("edit-sub-math").checked;
    const physics = document.getElementById("edit-sub-physics").checked;
    const live = document.getElementById("edit-sub-live-access").checked;

    try {
      const response = await teacherFetch(
        `/api/students/${encodeURIComponent(selectedStudent.id)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            paymentStage: stage,
            amountDue: amountVal ? Number(amountVal) : null,
            mathEnrollment: math,
            physicsEnrollment: physics,
            liveAccessEnabled: live,
            mathNote: selectedStudent.mathNote || "",
            physicsNote: selectedStudent.physicsNote || "",
          }),
        }
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "تعذر تعديل الاشتراك.");
      }

      selectedStudent.paymentStage = stage;
      selectedStudent.amountDue = amountVal ? Number(amountVal) : null;
      selectedStudent.mathEnrollment = math;
      selectedStudent.physicsEnrollment = physics;
      selectedStudent.liveAccessEnabled = live;
      if (stage === "PAID") selectedStudent.paymentStatus = true;

      closeAllSheets();
      renderGmailStudentsList();
      showToast("تم تحديث حالة الاشتراك والدفع بنجاح ✓");
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء التعديل.");
    }
  }

  // --------------------------------------------------------------------------
  // Modal: Student Attendance History
  // --------------------------------------------------------------------------
  async function openAttendanceModal() {
    if (!selectedStudent) return;
    closeAllSheets();

    const modal = document.getElementById("modal-attendance");
    const nameLabel = document.getElementById("attendance-student-name");
    const list = document.getElementById("attendance-records-list");
    if (!modal) return;

    if (nameLabel) nameLabel.textContent = `التلميذ: ${selectedStudent.studentName}`;
    if (list) {
      list.innerHTML = `
        <div class="tdm-loading-state" style="padding:16px;">
          <div class="tdm-spinner"></div>
          <p>جارٍ تحميل سجل الحضور…</p>
        </div>`;
    }

    modal.hidden = false;

    try {
      const response = await teacherFetch(
        `/api/attendance/student/${encodeURIComponent(selectedStudent.id)}`
      );
      if (!response.ok) throw new Error();
      const data = await response.json().catch(() => ({}));
      const records = Array.isArray(data.records) ? data.records : [];

      if (!records.length) {
        list.innerHTML = `<p class="tdm-empty-msg">لا توجد سجلات حضور مسجلة لهذا التلميذ.</p>`;
        return;
      }

      list.innerHTML = records
        .map((rec) => {
          const d = new Date(rec.joinedAt || rec.createdAt);
          const dateStr = d.toLocaleDateString("ar-DZ", {
            weekday: "long",
            year: "numeric",
            month: "short",
            day: "numeric",
          });
          const timeStr = d.toLocaleTimeString("ar-DZ", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; margin-bottom:8px;">
            <strong style="display:block; font-size:0.85rem; color:#1e293b;">${escapeHtml(
              rec.sessionTitle || "حصة مباشرة"
            )}</strong>
            <span style="font-size:0.75rem; color:#64748b;">📅 ${dateStr} - ⏰ ${timeStr}</span>
          </div>`;
        })
        .join("");
    } catch (_) {
      list.innerHTML = `<p class="tdm-empty-msg">تعذر تحميل سجل الحضور حالياً.</p>`;
    }
  }

  // --------------------------------------------------------------------------
  // Modal: Confirm Delete Student
  // --------------------------------------------------------------------------
  function openDeleteModal() {
    if (!selectedStudent) return;
    closeAllSheets();

    const modal = document.getElementById("modal-delete-confirm");
    const nameLabel = document.getElementById("delete-student-name-label");
    if (!modal) return;

    if (nameLabel) nameLabel.textContent = `"${selectedStudent.studentName}"`;
    modal.hidden = false;
  }

  async function handleConfirmDelete() {
    if (!selectedStudent) return;
    const studentId = selectedStudent.id;

    try {
      const response = await teacherFetch(
        `/api/students/${encodeURIComponent(studentId)}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("تعذر حذف حساب التلميذ.");

      studentsData = studentsData.filter((s) => s.id !== studentId);
      selectedStudent = null;

      closeAllSheets();
      renderGmailStudentsList();

      const countEl = document.getElementById("sec-students-count");
      if (countEl) countEl.textContent = studentsData.length;

      showToast("تم حذف التلميذ نهائياً بنجاح 🗑️");
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء الحذف.");
    }
  }

  // --------------------------------------------------------------------------
  // Top Grid Actions: Online Users, Absence, Public Invite
  // --------------------------------------------------------------------------
  async function fetchOnlineUsersCount() {
    try {
      const response = await teacherFetch("/api/teacher/online-users");
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const count = Number(data.onlineCount) || 0;
      const countEl = document.getElementById("tdm-online-count");
      if (countEl) countEl.textContent = count;
    } catch (_) {}
  }

  async function toggleAbsence() {
    const nextState = !isAbsent;
    try {
      const response = await teacherFetch("/api/teacher/absence", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ isAbsent: nextState }),
      });
      if (!response.ok) throw new Error();

      isAbsent = nextState;
      updateAbsenceUI();
      showToast(
        isAbsent ? "تم الإعلان عن الغياب 📢" : "تم إلغاء الغياب (حاضر) ✓"
      );
    } catch (_) {
      showToast("تعذر تحديث حالة التواجد.");
    }
  }

  function updateAbsenceUI() {
    const chip = document.getElementById("tdm-presence-indicator");
    const label = document.getElementById("tdm-presence-text");
    const btnLabel = document.getElementById("tdm-absence-btn-label");

    if (isAbsent) {
      if (chip) {
        chip.className = "tdm-presence-chip is-absent";
      }
      if (label) label.textContent = "غائب حالياً";
      if (btnLabel) btnLabel.textContent = "غائب 📢";
    } else {
      if (chip) {
        chip.className = "tdm-presence-chip is-present";
      }
      if (label) label.textContent = "جاهز للإدارة";
      if (btnLabel) btnLabel.textContent = "حاضر";
    }
  }

  async function handlePublicInvite() {
    try {
      const response = await teacherFetch("/api/classes/public-invite", {
        method: "POST",
      });
      if (!response.ok) throw new Error();
      const data = await response.json().catch(() => ({}));
      const inviteUrl =
        data.inviteUrl ||
        `${window.location.origin}/public-class.html?level=${encodeURIComponent(
          currentLevel
        )}`;

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
        showToast("تم إنشاء ونسخ رابط الحصة العامة بنجاح 📋");
      } else {
        window.prompt("رابط الحصة العامة:", inviteUrl);
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
      const response = await teacherFetch(
        `/api/teacher/notifications?level=${encodeURIComponent(currentLevel)}`
      );
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
              <span style="font-size:0.7rem; color:#64748b;">${new Date(
                n.createdAt
              ).toLocaleDateString("ar-DZ")}</span>
            </div>
            <p style="font-size:0.8rem; color:#475569;">${escapeHtml(
              n.body
            )}</p>
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
    const timing =
      document.querySelector('input[name="notif-timing"]:checked')?.value ||
      "IMMEDIATE";

    try {
      const response = await teacherFetch("/api/teacher/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
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
      const response = await teacherFetch(
        `/api/schedules/${encodeURIComponent(currentLevel)}`
      );
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      scheduledClasses = Array.isArray(data.scheduledClasses)
        ? data.scheduledClasses
        : [];

      if (!scheduledClasses.length) {
        list.innerHTML = `<p class="tdm-empty-msg">لا توجد حصص مبرمجة حالياً لهذا المستوى.</p>`;
        return;
      }

      list.innerHTML = scheduledClasses
        .map((sc) => {
          const dt = new Date(sc.scheduledAt);
          const dateStr = dt.toLocaleDateString("ar-DZ", {
            weekday: "long",
            month: "long",
            day: "numeric",
          });
          const timeStr = dt.toLocaleTimeString("ar-DZ", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${
                  sc.subject === "MATH" ? "📐 حصة الرياضيات" : "⚡ حصة الفيزياء"
                }</strong>
                <button type="button" class="tdm-btn-del-student" style="height:30px; font-size:0.75rem;" data-del-sched="${
                  sc.id
                }">إلغاء</button>
              </div>
              <p style="font-size:0.78rem; color:#64748b; margin:4px 0 8px;">📅 ${dateStr} الساعة ${timeStr}</p>
              <a href="./teacher-live-mobile.html" class="tdm-submit-btn" style="height:34px; font-size:0.78rem; text-decoration:none; display:flex; align-items:center; justify-content:center;">
                بدء الحصة الآن 🎥
              </a>
            </div>`;
        })
        .join("");
    } catch (_) {}
  }

  async function handleScheduleSubmit(e) {
    e.preventDefault();
    const subject = document.getElementById("tdm-sched-subject").value;
    const datetime = document.getElementById("tdm-sched-datetime").value;
    if (!datetime) {
      showToast("يرجى اختيار تاريخ ووقت الحصة.");
      return;
    }

    try {
      const response = await teacherFetch("/api/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          level: currentLevel,
          subject,
          scheduledAt: new Date(datetime).toISOString(),
        }),
      });

      if (!response.ok) throw new Error("تعذر برمجة الحصة.");
      showToast("تمت برمجة الحصة بنجاح 📅");
      e.target.reset();
      loadSchedule();
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء البرمجة.");
    }
  }

  // --------------------------------------------------------------------------
  // View 5: Payments & Receipts
  // --------------------------------------------------------------------------
  let currentPayTab = "manual";

  async function loadPayments(kind = currentPayTab) {
    currentPayTab = kind;
    const panel = document.getElementById("tdm-payments-content");
    const manualBadge = document.getElementById("pay-manual-count");
    const elecBadge = document.getElementById("pay-elec-count");
    if (!panel) return;

    // Filter from current level students
    const receipts = studentsData.filter(
      (s) => s.paymentReceiptPending || s.paymentReceiptUrl
    );
    const paidStudents = studentsData.filter(
      (s) => s.paymentStage === "PAID" || s.paymentStatus === true
    );

    if (manualBadge) manualBadge.textContent = receipts.length;
    if (elecBadge) elecBadge.textContent = paidStudents.length;

    if (kind === "manual") {
      if (!receipts.length) {
        panel.innerHTML = `<p class="tdm-empty-msg">لا توجد وصولات دفع مرفوعة حالياً في ${LEVEL_LABELS[currentLevel] || currentLevel}.</p>`;
        return;
      }

      panel.innerHTML = receipts
        .map(
          (s) => `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="font-size:0.95rem; color:#0f172a;">${escapeHtml(
                s.studentName
              )}</strong>
              <span class="tdm-gmail-pill pill-promised" style="background:#fef3c7; color:#b45309;">
                ${s.paymentReceiptPending ? "وصل بانتظار التأكيد" : "وصل مؤكد"}
              </span>
            </div>
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
              <a href="tel:${String(s.parentPhone || "").replace(/\D/g, "")}" style="font-size:0.8rem; color:#2563eb; text-decoration:none; font-weight:700;">
                📞 ${escapeHtml(s.parentPhone || "لا يوجد رقم")}
              </a>
              <span style="font-size:0.75rem; color:#64748b;">· المبلغ: ${s.amountDue || 0} دج</span>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="tdm-submit-btn" style="flex:1; min-width:110px; height:36px; font-size:0.78rem;" data-preview-receipt="${s.id}">
                👁️ معاينة الوصل
              </button>
              <button type="button" class="tdm-submit-btn" style="flex:1; min-width:110px; height:36px; font-size:0.78rem; background:#059669;" data-confirm-pay="${s.id}">
                ✓ تأكيد الدفع
              </button>
              <button type="button" class="tdm-danger-btn" style="flex:1; min-width:80px; height:36px; font-size:0.78rem;" data-reject-pay="${s.id}">
                ✕ رفض
              </button>
            </div>
          </div>
        `
        )
        .join("");
    } else {
      if (!paidStudents.length) {
        panel.innerHTML = `<p class="tdm-empty-msg">لا يوجد تلاميذ مؤكدو الدفع في ${LEVEL_LABELS[currentLevel] || currentLevel}.</p>`;
        return;
      }

      panel.innerHTML = paidStudents
        .map(
          (s) => `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="display:block; font-size:0.9rem; color:#0f172a;">${escapeHtml(
                s.studentName
              )}</strong>
              <span style="font-size:0.75rem; color:#64748b;">📞 ${escapeHtml(
                s.parentPhone || "—"
              )}</span>
            </div>
            <div style="text-align:left;">
              <span class="tdm-gmail-pill pill-paid" style="display:block; margin-bottom:2px;">تم الدفع ✓</span>
              <small style="color:#059669; font-weight:800; font-size:0.75rem;">${s.amountDue || 0} دج</small>
            </div>
          </div>
        `
        )
        .join("");
    }
  }

  // --------------------------------------------------------------------------
  // Receipt Preview & Approval Handlers
  // --------------------------------------------------------------------------
  async function openReceiptPreview(student) {
    if (!student) return;
    receiptPreviewStudentId = student.id;

    closeAllSheets();

    const modal = document.getElementById("modal-receipt-preview");
    const nameLabel = document.getElementById("receipt-preview-student-name");
    const loading = document.getElementById("receipt-preview-loading");
    const body = document.getElementById("receipt-preview-body");
    const img = document.getElementById("receipt-preview-img");
    const pdf = document.getElementById("receipt-preview-pdf");

    if (!modal) return;
    if (nameLabel) nameLabel.textContent = `📷 وصل الدفع: ${student.studentName}`;
    if (loading) loading.hidden = false;
    if (body) body.hidden = true;
    if (img) img.hidden = true;
    if (pdf) pdf.hidden = true;

    modal.hidden = false;

    if (receiptPreviewObjectUrl) {
      try {
        URL.revokeObjectURL(receiptPreviewObjectUrl);
      } catch (_) {}
      receiptPreviewObjectUrl = null;
    }

    try {
      const response = await teacherFetch(
        `/api/students/${encodeURIComponent(student.id)}/payment-receipt`,
        { headers: { Accept: "image/*, application/pdf" } }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "تعذر تحميل وصل الدفع.");
      }

      const blob = await response.blob();
      const isPdf =
        blob.type === "application/pdf" ||
        String(response.headers.get("Content-Disposition") || "")
          .toLowerCase()
          .includes(".pdf");

      const docUrl = URL.createObjectURL(blob);
      receiptPreviewObjectUrl = docUrl;

      if (loading) loading.hidden = true;
      if (body) body.hidden = false;

      if (isPdf) {
        if (pdf) {
          pdf.src = docUrl;
          pdf.hidden = false;
        }
      } else {
        if (img) {
          img.src = docUrl;
          img.hidden = false;
        }
      }
    } catch (err) {
      if (loading) {
        loading.innerHTML = `<p style="color:#dc2626; font-size:0.85rem;">${escapeHtml(
          err.message || "تعذر عرض وصل الدفع."
        )}</p>`;
      }
    }
  }

  async function confirmStudentPayment(studentId) {
    if (!studentId) return;

    try {
      const response = await teacherFetch(
        `/api/students/${encodeURIComponent(studentId)}/confirm-payment-receipt`,
        {
          method: "PUT",
          headers: { Accept: "application/json" },
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "تعذر تأكيد وصل الدفع.");
      }

      const student = studentsData.find((s) => s.id === studentId);
      if (student) {
        student.paymentStage = "PAID";
        student.paymentReceiptPending = false;
        student.paymentStatus = true;
        student.liveAccessEnabled = true;
      }

      closeAllSheets();
      renderGmailStudentsList();
      loadPayments("manual");
      showToast(payload.message || "تم تأكيد وصل الدفع وتفعيل الحساب بنجاح ✓");
    } catch (err) {
      showToast(err.message || "تعذر تأكيد وصل الدفع.");
    }
  }

  async function rejectStudentPayment(studentId) {
    if (!studentId) return;

    const confirmed = window.confirm(
      "هل تريد رفض هذا الوصل؟ سيتمكن الولي من رفع وصل جديد."
    );
    if (!confirmed) return;

    const reason =
      window.prompt(
        "اكتب سبب الرفض ليصل إلى ولي التلميذ:",
        "الوصل غير واضح أو لا يثبت عملية الدفع."
      ) || "";

    try {
      const response = await teacherFetch(
        `/api/students/${encodeURIComponent(studentId)}/reject-payment-receipt`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ reason: reason.trim() }),
        }
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "تعذر رفض الوصل.");
      }

      const student = studentsData.find((s) => s.id === studentId);
      if (student) {
        student.paymentReceiptPending = false;
        student.paymentReceiptUrl = null;
      }

      closeAllSheets();
      renderGmailStudentsList();
      loadPayments("manual");
      showToast(payload.message || "تم رفض الوصل وإخطار ولي الأمر.");
    } catch (err) {
      showToast(err.message || "تعذر رفض وصل الدفع.");
    }
  }

  // --------------------------------------------------------------------------
  // View 6: Assignments
  // --------------------------------------------------------------------------
  async function loadAssignments() {
    const list = document.getElementById("tdm-assign-list");
    if (!list) return;

    try {
      const response = await teacherFetch(
        `/api/academic/assignments?level=${encodeURIComponent(currentLevel)}`
      );
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const assignments = Array.isArray(data.data) ? data.data : [];

      if (!assignments.length) {
        list.innerHTML = `<p class="tdm-empty-msg">لا توجد واجبات مضافة لهذا المستوى بعد.</p>`;
        return;
      }

      list.innerHTML = assignments
        .map((a) => {
          const due = a.dueAt
            ? new Date(a.dueAt).toLocaleDateString("ar-DZ")
            : "غير محدد";
          return `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="font-size:0.9rem; color:#0f172a;">${escapeHtml(
                a.title
              )}</strong>
              <button type="button" class="tdm-btn-del-student" style="height:28px; font-size:0.72rem;" data-del-assign="${
                a.id
              }">حذف</button>
            </div>
            <p style="font-size:0.78rem; color:#64748b; margin:4px 0;">المادة: ${
              a.subject === "MATH" ? "الرياضيات" : "الفيزياء"
            } · التسليم قبل: ${due}</p>
            ${
              a.description
                ? `<p style="font-size:0.78rem; color:#475569;">${escapeHtml(
                    a.description
                  )}</p>`
                : ""
            }
          </div>`;
        })
        .join("");
    } catch (_) {
      list.innerHTML = `<p class="tdm-empty-msg">تعذر تحميل الواجبات حالياً.</p>`;
    }
  }

  async function handleAssignmentSubmit(e) {
    e.preventDefault();
    const subject = document.getElementById("tdm-assign-subject").value;
    const title = document.getElementById("tdm-assign-title").value.trim();
    const due = document.getElementById("tdm-assign-due").value;
    const desc = document.getElementById("tdm-assign-desc").value.trim();

    if (!title) {
      showToast("يرجى إدخال عنوان الواجب.");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("level", currentLevel);
      formData.append("subject", subject);
      formData.append("title", title);
      if (due) formData.append("dueAt", new Date(due).toISOString());
      if (desc) formData.append("description", desc);

      const response = await teacherFetch("/api/academic/assignments", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("تعذر نشر الواجب.");
      showToast("تم نشر الواجب بنجاح 📝");
      e.target.reset();
      loadAssignments();
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء نشر الواجب.");
    }
  }

  // --------------------------------------------------------------------------
  // View 7: Lesson Videos (Supplementary YouTube Lessons)
  // --------------------------------------------------------------------------
  async function loadLessons() {
    const list = document.getElementById("tdm-lessons-list");
    if (!list) return;

    try {
      const response = await teacherFetch(
        `/api/lesson-videos/${encodeURIComponent(currentLevel)}`
      );
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const lessons = Array.isArray(data.data) ? data.data : [];

      if (!lessons.length) {
        list.innerHTML = `<p class="tdm-empty-msg">لا توجد فيديوهات مكملة مضافة لهذا المستوى بعد.</p>`;
        return;
      }

      list.innerHTML = lessons
        .map(
          (lv) => `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="font-size:0.9rem; color:#0f172a;">${escapeHtml(
                lv.title
              )}</strong>
              <button type="button" class="tdm-btn-del-student" style="height:28px; font-size:0.72rem;" data-del-lesson="${
                lv.id
              }">حذف</button>
            </div>
            <p style="font-size:0.78rem; color:#64748b; margin:4px 0 6px;">التصنيف: ${
              lv.type === "MATH" ? "دروس الرياضيات" : "دروس الفيزياء"
            }</p>
            <a href="${escapeHtml(
              lv.url
            )}" target="_blank" rel="noopener" style="font-size:0.78rem; color:#2563eb; text-decoration:underline;">
              مشاهدة الفيديو على YouTube ↗
            </a>
          </div>`
        )
        .join("");
    } catch (_) {
      list.innerHTML = `<p class="tdm-empty-msg">تعذر تحميل الفيديوهات المكملة حالياً.</p>`;
    }
  }

  async function handleLessonSubmit(e) {
    e.preventDefault();
    const type = document.getElementById("tdm-lesson-type").value;
    const title = document.getElementById("tdm-lesson-title").value.trim();
    const url = document.getElementById("tdm-lesson-url").value.trim();

    if (!title || !url) {
      showToast("يرجى إدخال عنوان الفيديو ورابطه.");
      return;
    }

    try {
      const response = await teacherFetch("/api/lesson-videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          level: currentLevel,
          type,
          title,
          url,
        }),
      });

      if (!response.ok) throw new Error("تعذر نشر الفيديو المكمل.");
      showToast("تمت إضافة الفيديو بنجاح 🎥");
      e.target.reset();
      loadLessons();
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء إضافة الفيديو.");
    }
  }

  // --------------------------------------------------------------------------
  // Initialization & Event Binding
  // --------------------------------------------------------------------------
  function init() {
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
    document
      .getElementById("tdm-btn-quick-notif")
      ?.addEventListener("click", () => setView("notifications"));

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
        document
          .querySelectorAll(".tdm-gmail-filter-chip")
          .forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        activeFilter = chip.dataset.filter || "ALL";
        renderGmailStudentsList();
      });
    });

    // 6. Action Sheet Event Handlers
    document
      .getElementById("sheet-close-btn")
      ?.addEventListener("click", closeAllSheets);
    document
      .getElementById("sheet-live-toggle-btn")
      ?.addEventListener("click", toggleStudentLiveAccess);
    document
      .getElementById("sheet-edit-contact-btn")
      ?.addEventListener("click", openEditContactModal);
    document
      .getElementById("sheet-edit-sub-btn")
      ?.addEventListener("click", openEditSubModal);
    document
      .getElementById("sheet-receipt-btn")
      ?.addEventListener("click", () => openReceiptPreview(selectedStudent));
    document
      .getElementById("sheet-attendance-btn")
      ?.addEventListener("click", openAttendanceModal);
    document
      .getElementById("sheet-delete-btn")
      ?.addEventListener("click", openDeleteModal);

    // 7. Modals Close Buttons
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", closeAllSheets);
    });

    // 8. Form Submissions
    document
      .getElementById("form-edit-contact")
      ?.addEventListener("submit", handleEditContactSubmit);
    document
      .getElementById("form-edit-sub")
      ?.addEventListener("submit", handleEditSubSubmit);
    document
      .getElementById("tdm-btn-confirm-delete")
      ?.addEventListener("click", handleConfirmDelete);
    document
      .getElementById("tdm-notif-form")
      ?.addEventListener("submit", handleNotificationSubmit);
    document
      .getElementById("tdm-sched-form")
      ?.addEventListener("submit", handleScheduleSubmit);
    document
      .getElementById("tdm-assign-form")
      ?.addEventListener("submit", handleAssignmentSubmit);
    document
      .getElementById("tdm-lesson-form")
      ?.addEventListener("submit", handleLessonSubmit);

    // 9. Receipt Modal Buttons
    document
      .getElementById("receipt-modal-confirm-btn")
      ?.addEventListener("click", () => {
        if (receiptPreviewStudentId)
          confirmStudentPayment(receiptPreviewStudentId);
      });
    document
      .getElementById("receipt-modal-reject-btn")
      ?.addEventListener("click", () => {
        if (receiptPreviewStudentId)
          rejectStudentPayment(receiptPreviewStudentId);
      });

    // 10. Top Grid Buttons
    document
      .getElementById("tdm-btn-absence-toggle")
      ?.addEventListener("click", toggleAbsence);
    document
      .getElementById("tdm-btn-public-invite")
      ?.addEventListener("click", handlePublicInvite);

    document
      .getElementById("tdm-btn-desktop-switch")
      ?.addEventListener("click", () => {
        sessionStorage.setItem("teacherDashboardDesktopMode", "1");
      });

    document.getElementById("tdm-btn-logout")?.addEventListener("click", () => {
      sessionStorage.removeItem(TEACHER_TOKEN_KEY);
      sessionStorage.removeItem("teacherDashboardDesktopMode");
      window.location.replace("./teacher-login.html");
    });

    // 11. Payments delegation
    document
      .getElementById("tdm-payments-content")
      ?.addEventListener("click", (e) => {
        const previewBtn = e.target.closest("[data-preview-receipt]");
        if (previewBtn) {
          const student = studentsData.find(
            (s) => s.id === previewBtn.dataset.previewReceipt
          );
          if (student) openReceiptPreview(student);
          return;
        }

        const confirmBtn = e.target.closest("[data-confirm-pay]");
        if (confirmBtn) {
          confirmStudentPayment(confirmBtn.dataset.confirmPay);
          return;
        }

        const rejectBtn = e.target.closest("[data-reject-pay]");
        if (rejectBtn) {
          rejectStudentPayment(rejectBtn.dataset.rejectPay);
          return;
        }
      });

    document.querySelectorAll("[data-paytab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        document
          .querySelectorAll("[data-paytab]")
          .forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        loadPayments(tab.dataset.paytab);
      });
    });

    // 12. Schedule delegation (Cancel class)
    document
      .getElementById("tdm-sched-list")
      ?.addEventListener("click", async (e) => {
        const delBtn = e.target.closest("[data-del-sched]");
        if (delBtn && confirm("هل تريد إلغاء هذه الحصة؟")) {
          try {
            await teacherFetch(
              `/api/schedules/${encodeURIComponent(delBtn.dataset.delSched)}`,
              { method: "DELETE" }
            );
            showToast("تم إلغاء الحصة المبرمجة.");
            loadSchedule();
          } catch (_) {}
        }
      });

    // 13. Assignments delegation (Delete assignment)
    document
      .getElementById("tdm-assign-list")
      ?.addEventListener("click", async (e) => {
        const delBtn = e.target.closest("[data-del-assign]");
        if (delBtn && confirm("هل تريد حذف هذا الواجب؟")) {
          try {
            await teacherFetch(
              `/api/academic/assignments/${encodeURIComponent(
                delBtn.dataset.delAssign
              )}`,
              { method: "DELETE" }
            );
            showToast("تم حذف الواجب.");
            loadAssignments();
          } catch (_) {}
        }
      });

    // 14. Lessons delegation (Delete lesson video)
    document
      .getElementById("tdm-lessons-list")
      ?.addEventListener("click", async (e) => {
        const delBtn = e.target.closest("[data-del-lesson]");
        if (delBtn && confirm("هل تريد حذف هذا الفيديو؟")) {
          try {
            await teacherFetch(
              `/api/lesson-videos/${encodeURIComponent(
                delBtn.dataset.delLesson
              )}`,
              { method: "DELETE" }
            );
            showToast("تم حذف الفيديو المكمل.");
            loadLessons();
          } catch (_) {}
        }
      });

    // Initial Execution
    setLevel(currentLevel);
    fetchOnlineUsersCount();
    window.setInterval(fetchOnlineUsersCount, 25000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
