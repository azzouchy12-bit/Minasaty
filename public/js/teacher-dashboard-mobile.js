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
    if (!token) return Promise.reject(new Error("انتهت جلسة الأستاذ."));

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
  let studentsData = [];
  let scheduledClasses = [];
  let activeFilter = "ALL";
  let activeSearchQuery = "";
  let pendingDeleteStudentId = null;

  const LEVEL_LABELS = {
    "السنة الأولى": "السنة الأولى متوسط",
    "السنة الثانية": "السنة الثانية متوسط",
    "السنة الثالثة": "السنة الثالثة متوسط",
    "السنة الرابعة": "السنة الرابعة متوسط",
    "طالب جامعي": "طالب جامعي",
  };

  function displayLevel(level) {
    return LEVEL_LABELS[level] || level;
  }

  // --------------------------------------------------------------------------
  // UI Helpers: Toast & Alert
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
  // Router: Dedicated Views Architecture
  // --------------------------------------------------------------------------
  const VIEWS = {
    "": "view-hub",
    hub: "view-hub",
    students: "view-students",
    notifications: "view-notifications",
    schedule: "view-schedule",
    registry: "view-registry",
    payments: "view-payments",
    assignments: "view-assignments",
    lessons: "view-lessons",
    messenger: "view-messenger",
  };

  function handleRoute() {
    const hash = window.location.hash.replace(/^#/, "").trim();
    const targetViewId = VIEWS[hash] || "view-hub";

    document.querySelectorAll(".tdm-view").forEach((view) => {
      const isTarget = view.id === targetViewId;
      view.classList.toggle("is-active", isTarget);
      view.hidden = !isTarget;
    });

    window.scrollTo({ top: 0, behavior: "smooth" });

    // Refresh view data when entered
    if (targetViewId === "view-students") {
      renderStudentsList();
    } else if (targetViewId === "view-schedule") {
      loadSchedule();
    } else if (targetViewId === "view-notifications") {
      loadNotifications();
    } else if (targetViewId === "view-payments") {
      loadPayments();
    }
  }

  window.addEventListener("hashchange", handleRoute);

  // --------------------------------------------------------------------------
  // Level Switching
  // --------------------------------------------------------------------------
  function setLevel(level) {
    if (!level) return;
    currentLevel = level;

    // Update level chips in header
    document.querySelectorAll(".tdm-level-chip").forEach((chip) => {
      const isCurrent = chip.dataset.level === level;
      chip.classList.toggle("is-active", isCurrent);
      chip.setAttribute("aria-current", String(isCurrent));
    });

    // Update level titles across sub-views
    const label = displayLevel(level);
    const hubBadge = document.getElementById("hub-level-badge");
    if (hubBadge) hubBadge.textContent = label;

    const studentsTitle = document.getElementById("students-view-title");
    if (studentsTitle) studentsTitle.textContent = `تلاميذ ${label}`;

    const notifTag = document.getElementById("notif-level-tag");
    if (notifTag) notifTag.textContent = label;

    const schedTag = document.getElementById("schedule-level-tag");
    if (schedTag) schedTag.textContent = label;

    const payTag = document.getElementById("payments-level-tag");
    if (payTag) payTag.textContent = label;

    const assignTag = document.getElementById("assignments-level-tag");
    if (assignTag) assignTag.textContent = label;

    const lessonTag = document.getElementById("lessons-level-tag");
    if (lessonTag) lessonTag.textContent = label;

    // Fetch new level data
    fetchLevelData(level);
  }

  // --------------------------------------------------------------------------
  // Data Fetching: Level Data, Students, KPIs
  // --------------------------------------------------------------------------
  async function fetchLevelData(level = currentLevel) {
    showAlert("");
    try {
      const response = await teacherFetch(
        `/api/students/level/${encodeURIComponent(level)}?page=1&limit=150`,
        { headers: { Accept: "application/json" } }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "تعذر تحميل بيانات المستوى.");
      }

      studentsData = Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload)
        ? payload
        : [];

      updateKPIs(studentsData);
      renderStudentsList();
      loadSchedule();
    } catch (err) {
      console.error("Error loading level data:", err);
      showAlert(err.message || "تعذر الاتصال بالخادم.");
    }
  }

  function updateKPIs(students) {
    const total = students.length;
    const paidCount = students.filter(
      (s) => s.paymentStage === "PAID" || s.paymentStatus === true
    ).length;
    const liveAllowed = students.filter((s) => s.liveAccessEnabled).length;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthlyRegs = students.filter((s) => {
      const date = new Date(s.createdAt);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    }).length;

    const totalRevenue = students
      .filter((s) => s.paymentStage === "PAID")
      .reduce((sum, s) => sum + (Number(s.amountDue) || 2000), 0);

    const elTotal = document.getElementById("kpi-total-students");
    if (elTotal) elTotal.textContent = total;

    const elRegs = document.getElementById("kpi-monthly-regs");
    if (elRegs) elRegs.textContent = monthlyRegs;

    const elLive = document.getElementById("kpi-live-allowed");
    if (elLive) elLive.textContent = liveAllowed;

    const elRev = document.getElementById("kpi-confirmed-rev");
    if (elRev) elRev.textContent = `${totalRevenue.toLocaleString("ar-DZ")} دج`;

    // Badges in menu cards
    const badgeStudents = document.getElementById("menu-badge-students");
    if (badgeStudents) badgeStudents.textContent = `${total} تلميذ`;

    const pendingReceipts = students.filter((s) => s.paymentReceiptPending).length;
    const badgeReceipts = document.getElementById("menu-badge-receipts");
    if (badgeReceipts) {
      badgeReceipts.textContent = `${pendingReceipts} وصل`;
      badgeReceipts.classList.toggle("tdm-badge-warning", pendingReceipts > 0);
    }
  }

  // --------------------------------------------------------------------------
  // View 1: Students Roster Rendering & Actions
  // --------------------------------------------------------------------------
  function renderStudentsList() {
    const container = document.getElementById("tdm-students-list");
    if (!container) return;

    let filtered = studentsData.slice();

    // Apply filter chip
    if (activeFilter === "PAID") {
      filtered = filtered.filter((s) => s.paymentStage === "PAID" || s.paymentStatus === true);
    } else if (activeFilter === "UNPAID") {
      filtered = filtered.filter((s) => s.paymentStage === "UNPAID" || (!s.paymentStatus && s.paymentStage !== "PROMISED"));
    } else if (activeFilter === "PROMISED") {
      filtered = filtered.filter((s) => s.paymentStage === "PROMISED");
    } else if (activeFilter === "LIVE_ALLOWED") {
      filtered = filtered.filter((s) => s.liveAccessEnabled);
    }

    // Apply search query
    if (activeSearchQuery) {
      const q = activeSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          (s.studentName && s.studentName.toLowerCase().includes(q)) ||
          (s.parentPhone && s.parentPhone.includes(q)) ||
          (s.studentPin && String(s.studentPin).includes(q))
      );
    }

    // Update count in header
    const viewCount = document.getElementById("students-view-count");
    if (viewCount) viewCount.textContent = `${filtered.length} تلميذ`;

    if (!filtered.length) {
      container.innerHTML = `<p class="tdm-empty-text">لا توجد نتائج مطابقة للتصفية أو البحث.</p>`;
      return;
    }

    container.innerHTML = "";

    filtered.forEach((student) => {
      const card = document.createElement("article");
      card.className = "tdm-student-card";
      card.dataset.id = student.id;

      // Payment meta badge
      let payPill = `<span class="tdm-meta-pill tdm-pill-unpaid">غير مدفوع</span>`;
      if (student.paymentStage === "PAID" || student.paymentStatus === true) {
        payPill = `<span class="tdm-meta-pill tdm-pill-paid">تم الدفع ${student.amountDue ? `(${student.amountDue} دج)` : ""}</span>`;
      } else if (student.paymentStage === "PROMISED") {
        payPill = `<span class="tdm-meta-pill tdm-pill-promised">وعد بالدفع</span>`;
      }

      // Subject tags
      let subTags = "";
      if (student.mathEnrollment && student.physicsEnrollment) {
        subTags = `<span class="tdm-meta-pill tdm-pill-sub">رياضيات وفيزياء</span>`;
      } else if (student.mathEnrollment) {
        subTags = `<span class="tdm-meta-pill tdm-pill-sub">رياضيات</span>`;
      } else if (student.physicsEnrollment) {
        subTags = `<span class="tdm-meta-pill tdm-pill-sub">فيزياء</span>`;
      }

      const isLiveAllowed = Boolean(student.liveAccessEnabled);

      // Clean phone number for links
      const phoneDigits = String(student.parentPhone || "").replace(/\D/g, "");
      const waNumber = phoneDigits.startsWith("0") ? "213" + phoneDigits.slice(1) : phoneDigits;

      card.innerHTML = `
        <div class="tdm-card-top">
          <div>
            <h3 class="tdm-student-name">${escapeHtml(student.studentName)}</h3>
            <div class="tdm-card-meta">
              ${payPill}
              ${subTags}
            </div>
          </div>
          <span class="tdm-pin-badge" title="رمز PIN">${escapeHtml(student.studentPin || "—")}</span>
        </div>

        <div class="tdm-contact-row">
          <span class="tdm-phone-number">📞 ${escapeHtml(student.parentPhone || "لا يوجد هاتف")}</span>
          <div class="tdm-contact-actions">
            ${phoneDigits ? `<a href="tel:${phoneDigits}" class="tdm-call-btn">اتصال</a>` : ""}
            ${phoneDigits ? `<a href="https://wa.me/${waNumber}" target="_blank" rel="noopener" class="tdm-whatsapp-btn">WhatsApp</a>` : ""}
          </div>
        </div>

        <div class="tdm-live-control">
          <span class="tdm-live-status-label">حالة البث المباشر:</span>
          <button type="button" class="tdm-toggle-btn ${isLiveAllowed ? "is-allowed" : "is-blocked"}" data-toggle-live="${student.id}">
            ${isLiveAllowed ? "مسموح بالدخول ✓" : "دخول محظور 🔒"}
          </button>
        </div>

        <div class="tdm-card-footer">
          <button type="button" class="tdm-btn-edit-sub" data-edit-sub="${student.id}">
            تعديل الاشتراك والدفع ⚙️
          </button>
          <button type="button" class="tdm-btn-del-student" data-delete-student="${student.id}">
            حذف 🗑️
          </button>
        </div>
      `;

      container.appendChild(card);
    });
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
  // Live Access Fast Toggle
  // --------------------------------------------------------------------------
  async function toggleLiveAccess(studentId) {
    const student = studentsData.find((s) => s.id === studentId);
    if (!student) return;

    const nextValue = !Boolean(student.liveAccessEnabled);
    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          paymentStage: student.paymentStage || "UNPAID",
          amountDue: student.amountDue === null ? null : Number(student.amountDue),
          mathEnrollment: Boolean(student.mathEnrollment),
          physicsEnrollment: Boolean(student.physicsEnrollment),
          liveAccessEnabled: nextValue,
          mathNote: student.mathNote || "",
          physicsNote: student.physicsNote || "",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "تعذر تحديث إذن البث.");
      }

      student.liveAccessEnabled = nextValue;
      updateKPIs(studentsData);
      renderStudentsList();
      showToast(nextValue ? "تم السماح للتلميذ بدخول الحصة المباشرة ✓" : "تم حظر التلميذ من دخول الحصة 🔒");
    } catch (err) {
      console.error("Live toggle error:", err);
      showToast(err.message || "حدث خطأ أثناء تعديل صلاحية الحصة.");
    }
  }

  // --------------------------------------------------------------------------
  // Edit Subscription Modal
  // --------------------------------------------------------------------------
  function openSubModal(studentId) {
    const student = studentsData.find((s) => s.id === studentId);
    if (!student) return;

    const modal = document.getElementById("tdm-sub-modal");
    if (!modal) return;

    document.getElementById("tdm-sub-student-id").value = student.id;
    document.getElementById("tdm-sub-student-name").textContent = student.studentName;
    document.getElementById("tdm-sub-payment-stage").value = student.paymentStage || "UNPAID";
    document.getElementById("tdm-sub-amount").value = student.amountDue || "";
    document.getElementById("tdm-sub-enroll-math").checked = Boolean(student.mathEnrollment);
    document.getElementById("tdm-sub-enroll-physics").checked = Boolean(student.physicsEnrollment);
    document.getElementById("tdm-sub-live-toggle").checked = Boolean(student.liveAccessEnabled);

    modal.hidden = false;
  }

  function closeModals() {
    document.querySelectorAll(".tdm-modal").forEach((m) => (m.hidden = true));
  }

  async function handleSubFormSubmit(e) {
    e.preventDefault();
    const studentId = document.getElementById("tdm-sub-student-id").value;
    const student = studentsData.find((s) => s.id === studentId);
    if (!student) return;

    const paymentStage = document.getElementById("tdm-sub-payment-stage").value;
    const amountVal = document.getElementById("tdm-sub-amount").value.trim();
    const amountDue = paymentStage === "UNPAID" ? null : amountVal ? Number(amountVal) : 2000;
    const mathEnrollment = document.getElementById("tdm-sub-enroll-math").checked;
    const physicsEnrollment = document.getElementById("tdm-sub-enroll-physics").checked;
    const liveAccessEnabled = document.getElementById("tdm-sub-live-toggle").checked;

    if (!mathEnrollment && !physicsEnrollment) {
      alert("يجب اختيار مادة واحدة على الأقل (الرياضيات أو الفيزياء).");
      return;
    }

    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          paymentStage,
          amountDue,
          mathEnrollment,
          physicsEnrollment,
          liveAccessEnabled,
          mathNote: student.mathNote || "",
          physicsNote: student.physicsNote || "",
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "تعذر حفظ تعديلات الاشتراك.");

      // Update local state
      student.paymentStage = paymentStage;
      student.amountDue = amountDue;
      student.mathEnrollment = mathEnrollment;
      student.physicsEnrollment = physicsEnrollment;
      student.liveAccessEnabled = liveAccessEnabled;

      closeModals();
      updateKPIs(studentsData);
      renderStudentsList();
      showToast("تم تحديث بيانات الاشتراك بنجاح ✓");
    } catch (err) {
      console.error("Save subscription error:", err);
      showToast(err.message || "تعذر حفظ التعديلات.");
    }
  }

  // --------------------------------------------------------------------------
  // Delete Student
  // --------------------------------------------------------------------------
  function openDeleteModal(studentId) {
    const student = studentsData.find((s) => s.id === studentId);
    if (!student) return;

    pendingDeleteStudentId = studentId;
    document.getElementById("tdm-delete-student-name").textContent = student.studentName;
    document.getElementById("tdm-delete-modal").hidden = false;
  }

  async function confirmDeleteStudent() {
    if (!pendingDeleteStudentId) return;
    const studentId = pendingDeleteStudentId;
    closeModals();

    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "تعذر حذف التلميذ.");

      studentsData = studentsData.filter((s) => s.id !== studentId);
      updateKPIs(studentsData);
      renderStudentsList();
      showToast("تم حذف حساب التلميذ نهائياً.");
    } catch (err) {
      console.error("Delete student error:", err);
      showToast(err.message || "حدث خطأ أثناء الحذف.");
    }
  }

  // --------------------------------------------------------------------------
  // View 2: Notifications
  // --------------------------------------------------------------------------
  async function loadNotifications() {
    const historyContainer = document.getElementById("tdm-notifications-history");
    if (!historyContainer) return;

    try {
      const response = await teacherFetch(`/api/teacher/notifications?level=${encodeURIComponent(currentLevel)}`);
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const list = Array.isArray(data.notifications) ? data.notifications : [];

      if (!list.length) {
        historyContainer.innerHTML = `<p class="tdm-empty-text">لا توجد تنبيهات مرسلة لهذا المستوى بعد.</p>`;
        return;
      }

      historyContainer.innerHTML = list
        .map(
          (n) => `
        <article class="tdm-student-card">
          <div class="tdm-card-top">
            <strong>${escapeHtml(n.title)}</strong>
            <span class="tdm-pin-badge">${new Date(n.createdAt).toLocaleDateString("ar-DZ")}</span>
          </div>
          <p style="font-size:0.8rem; color:#475569;">${escapeHtml(n.body)}</p>
        </article>`
        )
        .join("");
    } catch (_) {}
  }

  async function handleNotificationSubmit(e) {
    e.preventDefault();
    const payment = document.querySelector('input[name="notif-payment"]:checked')?.value || "ALL";
    const subject = document.getElementById("tdm-notif-subject").value;
    const title = document.getElementById("tdm-notif-title").value.trim();
    const body = document.getElementById("tdm-notif-body").value.trim();
    const delivery = document.querySelector('input[name="notif-delivery"]:checked')?.value || "IMMEDIATE";

    if (!title || !body) {
      showToast("يرجى ملء عنوان ونص التنبيه.");
      return;
    }

    try {
      const response = await teacherFetch("/api/teacher/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          level: currentLevel,
          paymentStage: payment,
          subject,
          title,
          body,
          delivery,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "تعذر إرسال التنبيه.");

      showToast("تم إرسال التنبيه بنجاح 🚀");
      e.target.reset();
      loadNotifications();
    } catch (err) {
      console.error("Notif send error:", err);
      showToast(err.message || "تعذر إرسال التنبيه.");
    }
  }

  // --------------------------------------------------------------------------
  // View 3: Schedule
  // --------------------------------------------------------------------------
  async function loadSchedule() {
    const listContainer = document.getElementById("tdm-schedule-list");
    const badge = document.getElementById("menu-badge-schedule");
    if (!listContainer) return;

    try {
      const response = await teacherFetch(`/api/schedules/${encodeURIComponent(currentLevel)}`);
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      scheduledClasses = Array.isArray(data.scheduledClasses) ? data.scheduledClasses : [];

      if (badge) badge.textContent = `${scheduledClasses.length} حصة`;

      if (!scheduledClasses.length) {
        listContainer.innerHTML = `<p class="tdm-empty-text">لا توجد حصص مبرمجة حالياً لهذا المستوى.</p>`;
        return;
      }

      listContainer.innerHTML = scheduledClasses
        .map((sc) => {
          const dt = new Date(sc.scheduledAt);
          const dateStr = dt.toLocaleDateString("ar-DZ", { weekday: "long", month: "long", day: "numeric" });
          const timeStr = dt.toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" });
          return `
          <article class="tdm-student-card">
            <div class="tdm-card-top">
              <div>
                <strong>${sc.subject === "MATH" ? "حصة الرياضيات" : "حصة الفيزياء"}</strong>
                <p style="font-size:0.78rem; color:#64748b;">📅 ${dateStr} - الساعة ${timeStr}</p>
              </div>
              <button type="button" class="tdm-btn-del-student" data-del-schedule="${sc.id}">إلغاء</button>
            </div>
            <a href="./teacher-live-mobile.html" class="tdm-btn-primary" style="text-align:center; text-decoration:none; display:flex; align-items:center; justify-content:center; height:38px; font-size:0.8rem;">
              بدء الحصة الآن 🎥
            </a>
          </article>
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
      showToast("يرجى اختيار تاريخ وتوقيت الحصة.");
      return;
    }

    try {
      const scheduledAt = new Date(dtVal).toISOString();
      const response = await teacherFetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ level: currentLevel, subject, scheduledAt }),
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
  // View 5: Payments (Manual Receipts & Electronic)
  // --------------------------------------------------------------------------
  async function loadPayments() {
    const manualPanel = document.getElementById("tdm-manual-payments-panel");
    const manualCount = document.getElementById("manual-receipts-count");
    if (!manualPanel) return;

    const receipts = studentsData.filter((s) => s.paymentReceiptPending || s.paymentReceiptUrl);
    if (manualCount) manualCount.textContent = receipts.length;

    if (!receipts.length) {
      manualPanel.innerHTML = `<p class="tdm-empty-text">لا توجد وصولات دفع مرفوعة حالياً.</p>`;
      return;
    }

    manualPanel.innerHTML = receipts
      .map(
        (s) => `
      <article class="tdm-student-card">
        <div class="tdm-card-top">
          <div>
            <strong>${escapeHtml(s.studentName)}</strong>
            <p style="font-size:0.75rem; color:#64748b;">هاتف الولي: ${escapeHtml(s.parentPhone || "—")}</p>
          </div>
          <span class="tdm-meta-pill ${s.paymentStage === "PAID" ? "tdm-pill-paid" : "tdm-pill-promised"}">
            ${s.paymentStage === "PAID" ? "تم التأكيد" : "وصل قيد المراجعة"}
          </span>
        </div>
        ${
          s.paymentReceiptUrl
            ? `<div style="text-align:center; padding:6px; background:#f1f5f9; border-radius:10px;">
                <img src="${s.paymentReceiptUrl}" alt="وصل الدفع" style="max-height:180px; max-width:100%; border-radius:6px;" />
               </div>`
            : ""
        }
        <div class="tdm-card-footer">
          <button type="button" class="tdm-btn-primary" style="height:36px; font-size:0.78rem;" data-confirm-receipt="${s.id}">
            تأكيد الدفع وتفعيل الحساب ✓
          </button>
        </div>
      </article>
    `
      )
      .join("");
  }

  async function confirmReceipt(studentId) {
    try {
      const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}/confirm-payment-receipt`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("تعذر تأكيد الوصل.");

      const student = studentsData.find((s) => s.id === studentId);
      if (student) {
        student.paymentStage = "PAID";
        student.paymentReceiptPending = false;
        student.liveAccessEnabled = true;
      }
      updateKPIs(studentsData);
      loadPayments();
      showToast("تم تأكيد وصل الدفع وتفعيل حساب التلميذ بنجاح ✓");
    } catch (err) {
      showToast(err.message || "حدث خطأ أثناء التأكيد.");
    }
  }

  // --------------------------------------------------------------------------
  // Event Delegations & Initialization
  // --------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // 1. Check Auth
    if (!getTeacherToken()) return;

    // 2. Level Chips Clicking
    document.querySelectorAll(".tdm-level-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        setLevel(chip.dataset.level);
      });
    });

    // 3. Search & Clear Search
    const searchInput = document.getElementById("tdm-students-search");
    const clearBtn = document.getElementById("tdm-clear-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        activeSearchQuery = searchInput.value.trim();
        if (clearBtn) clearBtn.hidden = !activeSearchQuery;
        renderStudentsList();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        activeSearchQuery = "";
        clearBtn.hidden = true;
        renderStudentsList();
      });
    }

    // 4. Filter Chips
    document.querySelectorAll("#students-filter-chips .tdm-filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#students-filter-chips .tdm-filter-chip").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        activeFilter = btn.dataset.filter || "ALL";
        renderStudentsList();
      });
    });

    // 5. Dynamic Student Card Actions (Live toggle, Edit, Delete)
    const studentsContainer = document.getElementById("tdm-students-list");
    if (studentsContainer) {
      studentsContainer.addEventListener("click", (e) => {
        const toggleBtn = e.target.closest("[data-toggle-live]");
        if (toggleBtn) {
          toggleLiveAccess(toggleBtn.dataset.toggleLive);
          return;
        }

        const editBtn = e.target.closest("[data-edit-sub]");
        if (editBtn) {
          openSubModal(editBtn.dataset.editSub);
          return;
        }

        const delBtn = e.target.closest("[data-delete-student]");
        if (delBtn) {
          openDeleteModal(delBtn.dataset.deleteStudent);
          return;
        }
      });
    }

    // 6. Modal Close Buttons
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", closeModals);
    });

    // 7. Forms Submit
    document.getElementById("tdm-sub-form")?.addEventListener("submit", handleSubFormSubmit);
    document.getElementById("tdm-notification-form")?.addEventListener("submit", handleNotificationSubmit);
    document.getElementById("tdm-schedule-form")?.addEventListener("submit", handleScheduleSubmit);
    document.getElementById("tdm-confirm-delete-btn")?.addEventListener("click", confirmDeleteStudent);

    // 8. Payments Actions
    document.getElementById("tdm-manual-payments-panel")?.addEventListener("click", (e) => {
      const confirmBtn = e.target.closest("[data-confirm-receipt]");
      if (confirmBtn) {
        confirmReceipt(confirmBtn.dataset.confirmReceipt);
      }
    });

    // 9. Payment Tabs
    document.querySelectorAll(".tdm-seg-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tdm-seg-tab").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        const isManual = tab.dataset.tab === "manual";
        document.getElementById("tdm-manual-payments-panel").hidden = !isManual;
        document.getElementById("tdm-electronic-payments-panel").hidden = isManual;
      });
    });

    // 10. Desktop Switcher & Logout
    document.getElementById("tdm-switch-desktop")?.addEventListener("click", () => {
      sessionStorage.setItem("teacherDashboardDesktopMode", "1");
    });

    document.getElementById("tdm-logout-btn")?.addEventListener("click", () => {
      sessionStorage.removeItem(TEACHER_TOKEN_KEY);
      sessionStorage.removeItem("teacherDashboardDesktopMode");
      window.location.replace("./teacher-login.html");
    });

    // 11. Initial Route & Data Load
    handleRoute();
    setLevel(currentLevel);
  });
})();
