(() => {
  // 1. قراءة التوكن من sessionStorage أو localStorage
  const token =
    sessionStorage.getItem("parentToken") ||
    localStorage.getItem("parentToken") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

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
  // ✅ التصحيح الأساسي: جعل الصفحة مفتوحة ومفعلة افتراضياً
  let isOpen = true; 
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

  // ✅ تصحيح استرجاع التلميذ ليدعم كلاً من id و studentId والتخزينين
  function getStoredStudent() {
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

  // 1. استخراج وتحويل أي رابط فيديو إلى صيغة تشغيل صالحة
  function extractVideoUrl(item) {
    if (!item) return null;
    let url = item.youtubeEmbedUrl || item.recordingUrl || item.videoUrl || item.previewUrl || item.url;
    
    if (!url && item.youtubeVideoId) {
      return `https://www.youtube.com/embed/${item.youtubeVideoId}?autoplay=1`;
    }
    
    if (!url) return null;

    // تحويل روابط يوتيوب العادية إلى صيغة embed مع التشغيل التلقائي
    const ytMatch = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (ytMatch && ytMatch) {
      return `https://www.youtube.com/embed/${ytMatch}?autoplay=1`;
    }

    return url;
  }

  // 2. فتح وتشغيل الفيديو وضمان إنشاء نافذة العرض تلقائياً
  function openVideo(item) {
    const videoUrl = extractVideoUrl(item);
    if (!videoUrl) {
      alert("عذراً، لم يتم العثور على رابط صالح لتسجيل هذه الحصة.");
      return;
    }

    let modal = $("lesson-video-modal");
    let frame = $("lesson-video-frame");

    // إذا كانت نافذة العرض غير موجودة في الصفحة المستقلة، يتم إنشاؤها فوراً
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "lesson-video-modal";
      modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:15px;";
      
      const content = document.createElement("div");
      content.style.cssText = "width:100%;max-width:850px;background:#000;border-radius:12px;overflow:hidden;position:relative;box-shadow:0 10px 30px rgba(0,0,0,0.6);";

      const header = document.createElement("div");
      header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#1e293b;color:#fff;";
      
      const title = document.createElement("span");
      title.id = "lesson-video-modal-title";
      title.style.cssText = "font-weight:bold;font-size:15px;";
      title.textContent = `${subjectLabels[item.subject] || "الحصة"} · ${formatDate(item.scheduledAt)}`;

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.innerHTML = "&times;";
      closeBtn.style.cssText = "background:none;border:none;color:#fff;font-size:32px;line-height:1;cursor:pointer;padding:0 10px;";
      closeBtn.onclick = () => {
        if (frame) frame.src = "";
        modal.style.display = "none";
      };

      header.append(title, closeBtn);

      const frameContainer = document.createElement("div");
      frameContainer.style.cssText = "position:relative;width:100%;padding-top:56.25%;background:#000;";

      frame = document.createElement("iframe");
      frame.id = "lesson-video-frame";
      frame.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:0;";
      frame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
      frame.setAttribute("allowfullscreen", "true");

      frameContainer.append(frame);
      content.append(header, frameContainer);
      modal.append(content);
      document.body.append(modal);

      // إغلاق عند الضغط خارج نافذة الفيديو
      modal.onclick = (e) => {
        if (e.target === modal) {
          if (frame) frame.src = "";
          modal.style.display = "none";
        }
      };
    }

    const titleElem = $("lesson-video-modal-title");
    if (titleElem) {
      titleElem.textContent = `${subjectLabels[item.subject] || "الحصة"} · ${formatDate(item.scheduledAt)}`;
    }

    frame.src = videoUrl;
    modal.style.display = "flex";
  }

  // 3. الإبقاء على دالة الرسائل كما هي
  function showMessage(message, className = "class-registry-empty") {
    if (!list) return;
    list.replaceChildren();
    const element = document.createElement("p");
    element.className = className;
    element.textContent = message;
    list.append(element);
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
    // ✅ تم إزالة شرط !isOpen ليعمل دائماً
    if (!activeStudent?.id || !activeStudent.level || !list) return;
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
    showSelectionPrompt();
    if (isOpen) {
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
    showSelectionPrompt();
  });

  window.addEventListener("parent-screen-ready", (event) => {
    activeStudent = event.detail || getStoredStudent();
    renderFilters();
    showSelectionPrompt();
    if (term && month && subject) void load();
  });

  window.addEventListener("class-registry-updated", () => void load());
  window.addEventListener("class-registry-refresh", () => void load());
  $("registry-upsell-close")?.addEventListener("click", closeUpsell);
  upsell?.addEventListener("click", (event) => { if (event.target === upsell) closeUpsell(); });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeUpsell(); });

  activeStudent = getStoredStudent();
  if (controls) controls.hidden = false;
  renderFilters();
})();
