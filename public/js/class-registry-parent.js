(() => {
  const token = sessionStorage.getItem("parentToken");
  if (!token) return;

  const $ = (id) => document.getElementById(id);
  const section = $("class-registry-student");
  const toggle = $("class-registry-toggle");
  const toggleIcon = $("class-registry-toggle-icon");
  const controls = $("class-registry-controls");
  const termSelect = $("registry-term-select");
  const monthSelect = $("registry-month-select");
  const subjectSelect = $("registry-subject-select");
  const list = $("parent-class-registry-list");
  const upsell = $("registry-upsell-modal");

  let activeStudent = null;
  let isOpen = false;
  let term = "";
  let month = "";
  let subject = "";

  const TERMS = Object.freeze({
    TERM_1: {
      label: "الفصل الأول",
      months: [
        { value: "2026-09", label: "سبتمبر 2026" },
        { value: "2026-10", label: "أكتوبر 2026" },
        { value: "2026-11", label: "نوفمبر 2026" },
      ],
    },
    TERM_2: {
      label: "الفصل الثاني",
      months: [
        { value: "2027-01", label: "جانفي 2027" },
        { value: "2027-02", label: "فيفري 2027" },
      ],
    },
    TERM_3: {
      label: "الفصل الثالث",
      months: [
        { value: "2027-04", label: "أبريل 2027" },
        { value: "2027-05", label: "ماي 2027" },
      ],
    },
  });

  const statusLabels = { PENDING: "لم تُنجز بعد", COMPLETED: "تمت الحصة", TEACHER_ABSENT: "غياب الأستاذ" };
  const subjectLabels = { MATH: "الرياضيات", PHYSICS: "الفيزياء", PAID: "اشتراك مدفوع", FREE: "اشتراك مجاني" };

  function getStoredStudent() {
    try { return JSON.parse(sessionStorage.getItem("currentStudent") || "null"); } catch { return null; }
  }

  function getSubjectChoices() {
    return activeStudent?.level === "طالب جامعي"
      ? [{ value: "PAID", label: "اشتراك مدفوع" }, { value: "FREE", label: "اشتراك مجاني" }]
      : [{ value: "MATH", label: "الرياضيات" }, { value: "PHYSICS", label: "الفيزياء" }];
  }

  function getSelectedTerm() {
    return TERMS[term] || null;
  }

  async function api(path) {
    const response = await fetch(path, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل سجل الحصص.");
    return payload;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("ar-DZ", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Algiers" }).format(date)
      : "تاريخ غير صالح";
  }

  function openUpsell() {
    if (!upsell) return;
    upsell.hidden = false;
    document.body.style.overflow = "hidden";
    $("registry-upsell-close")?.focus();
  }

  function closeUpsell() {
    if (!upsell) return;
    upsell.hidden = true;
    document.body.style.overflow = "";
  }

  function isSafeYouTubeEmbedUrl(value) {
    return /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]{11}.*$/.test(String(value || ""));
  }

  function openVideo(item) {
    const modal = $("lesson-video-modal");
    const frame = $("lesson-video-frame");
    const videoUrl = isSafeYouTubeEmbedUrl(item.youtubeEmbedUrl) ? item.youtubeEmbedUrl : item.previewUrl;
    if (!modal || !frame || !videoUrl) return;
    $("lesson-video-modal-title").textContent = `${subjectLabels[item.subject] || "الحصة"} · ${formatDate(item.scheduledAt)}`;
    $("lesson-video-sidebar-title").textContent = subjectLabels[item.subject] || "مشاهدة الحصة";
    $("lesson-video-sidebar-meta").textContent = `${formatDate(item.scheduledAt)} · مشاهدة داخل المنصة`;
    if (videoUrl.includes("youtube.com")) {
      frame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
      frame.setAttribute("allowfullscreen", "true");
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    } else {
      frame.removeAttribute("allow");
      frame.removeAttribute("allowfullscreen");
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    }
    frame.src = videoUrl;
    frame.setAttribute("title", item.youtubeVideoId ? "فيديو YouTube داخل الأكاديمية" : "فيديو الحصة المسجلة");
    modal.hidden = false;
    document.body.classList.add("lesson-video-open");
  }

  function showMessage(message, className = "class-registry-empty") {
    if (!list) return;
    list.replaceChildren();
    const element = document.createElement("p");
    element.className = className;
    element.textContent = message;
    list.append(element);
  }

  function showSelectionPrompt() {
    if (!isOpen) return;
    if (!term) return showMessage("اختر الفصل الدراسي أولاً.");
    if (!month) return showMessage("اختر الشهر من القائمة.");
    if (!subject) return showMessage("اختر المادة من القائمة.");
    showMessage("جارٍ تحميل سجل الحصص…", "class-registry-loading");
  }

  function fillSelect(select, placeholder, options, selectedValue, disabled) {
    if (!select) return;
    select.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.append(first);
    options.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    select.disabled = disabled;
    select.value = selectedValue || "";
  }

  function renderFilters() {
    fillSelect(
      termSelect,
      "اختر الفصل الدراسي",
      Object.entries(TERMS).map(([value, data]) => ({ value, label: data.label })),
      term,
      false
    );
    fillSelect(
      monthSelect,
      term ? "اختر الشهر" : "اختر الفصل أولاً",
      getSelectedTerm()?.months || [],
      month,
      !term
    );
    fillSelect(
      subjectSelect,
      month ? "اختر المادة" : "اختر الشهر أولاً",
      getSubjectChoices(),
      subject,
      !month
    );
    toggle?.setAttribute("aria-expanded", String(isOpen));
    if (toggleIcon) toggleIcon.textContent = isOpen ? "⌃" : "⌄";
  }

  function render(items) {
    if (!list) return;
    list.replaceChildren();
    if (!items.length) {
      showMessage(`لا توجد حصص مبرمجة في ${subjectLabels[subject] || "هذه المادة"} لهذا الشهر.`);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = `class-registry-item status-${String(item.status || "PENDING").toLowerCase()} ${item.canWatch ? "is-authorized" : "is-locked"}`;
      const copy = document.createElement("div");
      copy.className = "class-registry-item-copy";
      const title = document.createElement("strong");
      title.textContent = subjectLabels[item.subject] || item.subject;
      const date = document.createElement("span");
      date.textContent = formatDate(item.scheduledAt);
      const status = document.createElement("em");
      status.textContent = statusLabels[item.status] || item.status;
      copy.append(title, date, status);
      const action = document.createElement("button");
      action.type = "button";
      action.className = item.canWatch ? "registry-watch-button" : "registry-lock-button";
      action.textContent = item.status === "COMPLETED"
        ? (item.canWatch ? "▶ مشاهدة التسجيل داخل الأكاديمية" : "🔒 ترقية للمشاهدة")
        : item.status === "TEACHER_ABSENT" ? "عرض ملاحظة الغياب" : "في انتظار إنجاز الحصة";
      action.disabled = item.status === "PENDING";
      action.addEventListener("click", () => {
        if (item.status === "TEACHER_ABSENT") return;
        if (!item.canWatch) openUpsell();
        else openVideo(item);
      });
      card.append(copy, action);
      if (item.notes) {
        const note = document.createElement("p");
        note.className = "class-registry-note";
        note.textContent = item.notes;
        card.append(note);
      }
      list.append(card);
    });
  }

  async function load() {
    activeStudent = activeStudent || getStoredStudent();
    if (!activeStudent?.id || !activeStudent.level || !list || !isOpen) return;
    if (!term || !month || !subject) {
      showSelectionPrompt();
      return;
    }
    list.innerHTML = '<p class="class-registry-loading">جارٍ تحميل سجل الحصص…</p>';
    try {
      const payload = await api(`/api/schedules/registry/${encodeURIComponent(activeStudent.level)}?month=${encodeURIComponent(month)}&subject=${encodeURIComponent(subject)}&studentId=${encodeURIComponent(activeStudent.id)}`);
      render(Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      showMessage(error.message);
    }
  }

  function setOpen(nextOpen) {
    isOpen = Boolean(nextOpen);
    if (controls) controls.hidden = !isOpen;
    section?.classList.toggle("is-open", isOpen);
    renderFilters();
    if (isOpen) {
      showSelectionPrompt();
      window.focusExpandedParentPanel?.(section);
    }
  }

  toggle?.addEventListener("click", () => setOpen(!isOpen));
  termSelect?.addEventListener("change", () => {
    term = termSelect.value;
    month = "";
    subject = "";
    renderFilters();
    showSelectionPrompt();
  });
  monthSelect?.addEventListener("change", () => {
    month = monthSelect.value;
    subject = "";
    renderFilters();
    showSelectionPrompt();
  });
  subjectSelect?.addEventListener("change", () => {
    subject = subjectSelect.value;
    renderFilters();
    void load();
  });

  window.addEventListener("active-student-changed", (event) => {
    activeStudent = event.detail || getStoredStudent();
    term = "";
    month = "";
    subject = "";
    renderFilters();
    if (isOpen) showSelectionPrompt();
  });

  // parent-screen-common dispatches this after restoring the selected student.
  // Listen here as well because this standalone page loads the registry script
  // before the shared helper; otherwise the registry can remain without a
  // studentId and never issue the schedule request.
  window.addEventListener("parent-screen-ready", (event) => {
    activeStudent = event.detail || getStoredStudent();
    renderFilters();
    if (isOpen) {
      showSelectionPrompt();
      if (term && month && subject) void load();
    }
  });
  window.addEventListener("class-registry-updated", () => void load());
  window.addEventListener("class-registry-refresh", () => void load());
  $("registry-upsell-close")?.addEventListener("click", closeUpsell);
  upsell?.addEventListener("click", (event) => { if (event.target === upsell) closeUpsell(); });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeUpsell(); });

  activeStudent = getStoredStudent();
  renderFilters();
})();

// Registry terms: 2026 fall, 2027 winter, and 2027 spring months are selected
// before the API request, so the existing level/subject access rules stay intact.
