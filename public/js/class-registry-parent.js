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
    // 1. استخراج الرابط الصحيح للحصة من كافة الحقول المتاحة
    let videoUrl = item.youtubeEmbedUrl;
    if (!videoUrl && item.youtubeVideoId) {
      videoUrl = `https://www.youtube.com/embed/${item.youtubeVideoId}?rel=0&modestbranding=1&playsinline=1`;
    }
    if (!videoUrl && item.previewUrl) {
      videoUrl = item.previewUrl;
    }
    if (!videoUrl) {
      videoUrl = item.driveLink || item.recordingUrl || item.videoUrl;
    }

    // تحويل روابط يوتيوب العادية تلقائياً إلى صيغة embed صالحة للتشغيل
    if (videoUrl && (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be"))) {
      const match = String(videoUrl).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
      if (match && match) {
        videoUrl = `https://www.youtube.com/embed/${match}?rel=0&modestbranding=1&playsinline=1`;
      }
    }

    if (!videoUrl) {
      alert("عذراً، لم يتم العثور على رابط تسجيل صالح لهذه الحصة.");
      return;
    }

    // 2. إخفاء أي نافذة قديمة كانت تظهر بأسفل الصفحة
    const oldModal = $("lesson-video-modal");
    if (oldModal) oldModal.style.display = "none";

    // 3. إنشاء صفحة العرض الكاملة في أعلى الشاشة
    let viewer = $("custom-lesson-page-viewer");
    if (viewer) viewer.remove();

    viewer = document.createElement("div");
    viewer.id = "custom-lesson-page-viewer";
    viewer.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;background:#0b1329;z-index:9999999;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;font-family:inherit;";

    const subjectName = subjectLabels[item.subject] || item.subject || "الحصة";
    const dateFormatted = formatDate(item.scheduledAt);

    viewer.innerHTML = `
      <!-- الشريط العلوي: أزرار العودة والعنوان -->
      <header style="background:#1e293b;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155;position:sticky;top:0;z-index:10;">
        <button id="viewer-back-btn" type="button" style="background:#2563eb;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:6px;">
          ← العودة إلى سجل الحصص
        </button>
        <a href="parent-dashboard.html" style="background:#334155;color:#e2e8f0;text-decoration:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:bold;">
          🏠 الرئيسية
        </a>
      </header>

      <!-- محتوى الصفحة: في الوسط -->
      <main style="flex:1;max-width:960px;width:100%;margin:0 auto;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;">
        
        <!-- بطاقة عنوان الحصة وتاريخها -->
        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px 16px;color:#fff;">
          <h2 style="margin:0 0 6px 0;font-size:18px;color:#60a5fa;">📹 ${subjectName}</h2>
          <p style="margin:0;color:#94a3b8;font-size:14px;">📅 ${dateFormatted}</p>
        </div>

        <!-- مشغل الفيديو التفاعلي مع صلاحيات ملء الشاشة الكاملة -->
        <div id="video-frame-box" style="position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,0.7);border:1px solid #1e293b;">
          <iframe 
            id="lesson-custom-iframe"
            src="${videoUrl}" 
            style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; webkitfullscreen; mozallowfullscreen; fullscreen" 
            allowfullscreen="true"
            webkitallowfullscreen="true"
            mozallowfullscreen="true">
          </iframe>
        </div>

        <!-- زر ملء الشاشة لتكبير وتدوير الفيديو في الهاتف -->
        <div style="display:flex;justify-content:center;">
          <button id="fullscreen-action-btn" type="button" style="background:#059669;color:#fff;border:none;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:8px;">
            ⛶ تكبير الشاشة (ملء الشاشة)
          </button>
        </div>

        <!-- التنبيه الأمني المشدد في الأسفل -->
        <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-radius:12px;padding:16px;color:#fca5a5;margin-top:6px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:22px;">⚠️</span>
            <strong style="color:#ef4444;font-size:16px;">تنبيه أمني هام ومشدد:</strong>
          </div>
          <p style="margin:0;font-size:13.5px;line-height:1.7;color:#fecaca;">
            محتوى هذه الحصة مسجل وحصري ومخصص فقط للتلميذ المسجل في الأكاديمية.<br>
            <strong>يُمنع منعاً باتاً</strong> تصوير أو تسجيل أو تحميل أو مشاركة هذا الفيديو أو رابطه مع أي طرف آخر.<br>
            أي محاولة لمشاركة الفيديو ستؤدي فوراً إلى <strong>إغلاق الحساب نهائياً</strong> وحرمان التلميذ من المنصة دون أي تعويض، مع الاحتفاظ بكامل الحقوق القانونية.
          </p>
        </div>

      </main>
    `;

    document.body.append(viewer);
    document.body.style.overflow = "hidden";

    // وظيفة زر العودة إلى سجل الحصص
    $("viewer-back-btn").onclick = () => {
      const iframe = $("lesson-custom-iframe");
      if (iframe) iframe.src = "";
      viewer.remove();
      document.body.style.overflow = "";
    };

    // وظيفة زر ملء الشاشة وتدويرها في الهاتف
    $("fullscreen-action-btn").onclick = () => {
      const frameBox = $("video-frame-box");
      if (frameBox.requestFullscreen) {
        frameBox.requestFullscreen();
      } else if (frameBox.webkitRequestFullscreen) {
        frameBox.webkitRequestFullscreen();
      } else if (frameBox.mozRequestFullScreen) {
        frameBox.mozRequestFullScreen();
      } else if (frameBox.msRequestFullscreen) {
        frameBox.msRequestFullscreen();
      }
    };
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
})();    },
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
    // 1. استخراج الرابط الصحيح للحصة من كافة الحقول المتاحة
    let videoUrl = item.youtubeEmbedUrl;
    if (!videoUrl && item.youtubeVideoId) {
      videoUrl = `https://www.youtube.com/embed/${item.youtubeVideoId}?rel=0&modestbranding=1&playsinline=1`;
    }
    if (!videoUrl && item.previewUrl) {
      videoUrl = item.previewUrl;
    }
    if (!videoUrl) {
      videoUrl = item.driveLink || item.recordingUrl || item.videoUrl;
    }

// استخراج معرّف يوتيوب النظيف (11 حرفاً بالضبط) وتحويله لنطاق التضمين المباشر
    if (videoUrl) {
      const match = String(videoUrl).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/|watch\?.+&v=))([A-Za-z0-9_-]{11})/);
      if (match && match) {
        // استخدام نطاق youtube-nocookie المخصص للمنصات التعليمية
        videoUrl = `https://www.youtube-nocookie.com/embed/${match}?enablejsapi=1&playsinline=1&rel=0&modestbranding=1`;
      }
    }

    if (!videoUrl) {
      alert("عذراً، لم يتم العثور على رابط تسجيل صالح لهذه الحصة.");
      return;
    }

    // 2. إخفاء أي نافذة قديمة كانت تظهر بأسفل الصفحة
    const oldModal = $("lesson-video-modal");
    if (oldModal) oldModal.style.display = "none";

    // 3. إنشاء صفحة العرض الكاملة في أعلى الشاشة
    let viewer = $("custom-lesson-page-viewer");
    if (viewer) viewer.remove();

    viewer = document.createElement("div");
    viewer.id = "custom-lesson-page-viewer";
    viewer.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;background:#0b1329;z-index:9999999;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;font-family:inherit;";

    const subjectName = subjectLabels[item.subject] || item.subject || "الحصة";
    const dateFormatted = formatDate(item.scheduledAt);

    viewer.innerHTML = `
      <!-- الشريط العلوي: أزرار العودة والعنوان -->
      <header style="background:#1e293b;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155;position:sticky;top:0;z-index:10;">
        <button id="viewer-back-btn" type="button" style="background:#2563eb;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:6px;">
          ← العودة إلى سجل الحصص
        </button>
        <a href="parent-dashboard.html" style="background:#334155;color:#e2e8f0;text-decoration:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:bold;">
          🏠 الرئيسية
        </a>
      </header>

      <!-- محتوى الصفحة: في الوسط -->
      <main style="flex:1;max-width:960px;width:100%;margin:0 auto;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;">
        
        <!-- بطاقة عنوان الحصة وتاريخها -->
        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px 16px;color:#fff;">
          <h2 style="margin:0 0 6px 0;font-size:18px;color:#60a5fa;">📹 ${subjectName}</h2>
          <p style="margin:0;color:#94a3b8;font-size:14px;">📅 ${dateFormatted}</p>
        </div>

        <!-- مشغل الفيديو التفاعلي مع صلاحيات ملء الشاشة الكاملة -->
        <div id="video-frame-box" style="position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,0.7);border:1px solid #1e293b;">
          <iframe 
            id="lesson-custom-iframe"
            src="${videoUrl}" 
            style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; webkitfullscreen; mozallowfullscreen; fullscreen" 
            allowfullscreen="true"
            webkitallowfullscreen="true"
            mozallowfullscreen="true">
          </iframe>
        </div>

        <!-- زر ملء الشاشة لتكبير وتدوير الفيديو في الهاتف -->
        <div style="display:flex;justify-content:center;">
          <button id="fullscreen-action-btn" type="button" style="background:#059669;color:#fff;border:none;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:8px;">
            ⛶ تكبير الشاشة (ملء الشاشة)
          </button>
        </div>

        <!-- التنبيه الأمني المشدد في الأسفل -->
        <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-radius:12px;padding:16px;color:#fca5a5;margin-top:6px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:22px;">⚠️</span>
            <strong style="color:#ef4444;font-size:16px;">تنبيه أمني هام ومشدد:</strong>
          </div>
          <p style="margin:0;font-size:13.5px;line-height:1.7;color:#fecaca;">
            محتوى هذه الحصة مسجل وحصري ومخصص فقط للتلميذ المسجل في الأكاديمية.<br>
            <strong>يُمنع منعاً باتاً</strong> تصوير أو تسجيل أو تحميل أو مشاركة هذا الفيديو أو رابطه مع أي طرف آخر.<br>
            أي محاولة لمشاركة الفيديو ستؤدي فوراً إلى <strong>إغلاق الحساب نهائياً</strong> وحرمان التلميذ من المنصة دون أي تعويض، مع الاحتفاظ بكامل الحقوق القانونية.
          </p>
        </div>

      </main>
    `;

    document.body.append(viewer);
    document.body.style.overflow = "hidden";

    // وظيفة زر العودة إلى سجل الحصص
    $("viewer-back-btn").onclick = () => {
      const iframe = $("lesson-custom-iframe");
      if (iframe) iframe.src = "";
      viewer.remove();
      document.body.style.overflow = "";
    };

    // وظيفة زر ملء الشاشة وتدويرها في الهاتف
    $("fullscreen-action-btn").onclick = () => {
      const frameBox = $("video-frame-box");
      if (frameBox.requestFullscreen) {
        frameBox.requestFullscreen();
      } else if (frameBox.webkitRequestFullscreen) {
        frameBox.webkitRequestFullscreen();
      } else if (frameBox.mozRequestFullScreen) {
        frameBox.mozRequestFullScreen();
      } else if (frameBox.msRequestFullscreen) {
        frameBox.msRequestFullscreen();
      }
    };
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
