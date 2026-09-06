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
        id: parsed.id || parsed.studentId || parsed._id,
        level:
          parsed.level ||
          parsed.academicLevel ||
          sessionStorage.getItem("studentLevel") ||
          localStorage.getItem("studentLevel") ||
          "السنة الثالثة متوسط"
      };
    } catch {
      return null;
    }
  }

  async function fetchVideos(level) {
    const token = getToken();
    const headers = { Accept: "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    try {
      const res = await fetch("/api/lesson-videos/" + encodeURIComponent(level), { headers });
      if (!res.ok) return [];
      const payload = await res.json().catch(() => []);
      return Array.isArray(payload) ? payload : payload.videos || payload.data || payload.lessonVideos || [];
    } catch {
      return [];
    }
  }

  async function loadVideos() {
    const listElem = document.getElementById("lesson-video-list");
    if (!listElem) return;

    const student = getStudent();
    if (!student || !student.id) {
      listElem.innerHTML = '<div class="lesson-video-empty">يرجى تسجيل الدخول لعرض الفيديوهات.</div>';
      return;
    }

    listElem.innerHTML = '<div class="lesson-video-empty">جارٍ جلب الفيديوهات المكملة...</div>';

    let videos = await fetchVideos(student.level);

    // محاولة بديلة إذا كان المستوى بدون كلمة متوسط أو العكس
    if (!videos || videos.length === 0) {
      const altLevel = student.level.includes("متوسط")
        ? student.level.replace(" متوسط", "").trim()
        : student.level + " متوسط";
      const altVideos = await fetchVideos(altLevel);
      if (altVideos && altVideos.length > 0) videos = altVideos;
    }

    if (!videos || videos.length === 0) {
      listElem.innerHTML = '<div class="lesson-video-empty">لا توجد فيديوهات مكملة مضافة لهذا المستوى حالياً.</div>';
      return;
    }

    listElem.innerHTML = "";
    videos.forEach((vid) => {
      const item = document.createElement("div");
      item.className = "lesson-video-item";
      item.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;background:#fff;padding:14px;border-radius:12px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0;gap:12px;";

      let embedUrl = vid.youtubeEmbedUrl || vid.videoUrl || vid.url;
      if (vid.youtubeVideoId) {
        embedUrl = "https://www.youtube.com/embed/" + vid.youtubeVideoId + "?enablejsapi=1&playsinline=1&rel=0";
      } else if (embedUrl && (embedUrl.includes("youtube.com") || embedUrl.includes("youtu.be"))) {
        const m = String(embedUrl).match(
          /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([A-Za-z0-9_-]{11})/
        );
        if (m && m) embedUrl = "https://www.youtube.com/embed/" + m + "?enablejsapi=1&playsinline=1&rel=0";
      }

      const titleText = vid.title || vid.lessonTitle || "فيديو مكمل";
      const subjectText = vid.subject || "مادة دراسية";
      const descText = vid.description ? " • " + vid.description : "";

      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;min-width:0;">
          <span style="font-size:26px;flex:0 0 auto;">🎬</span>
          <div style="min-width:0;">
            <strong style="display:block;font-size:15px;color:#0f172a;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${titleText}
            </strong>
            <span style="font-size:12px;color:#64748b;">
              ${subjectText}${descText}
            </span>
          </div>
        </div>
        <button type="button" class="watch-video-btn" style="background:#059669;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;flex:0 0 auto;">
          ▶ مشاهدة
        </button>
      `;

      item.querySelector(".watch-video-btn").onclick = () => {
        playVideo(titleText, embedUrl);
      };

      listElem.appendChild(item);
    });
  }

  function playVideo(title, url) {
    if (!url) {
      alert("عذراً، رابط هذا الفيديو غير متوفر.");
      return;
    }
    const modal = document.getElementById("lesson-video-modal");
    const frame = document.getElementById("lesson-video-frame");
    const titleElem = document.getElementById("lesson-video-modal-title");
    if (titleElem) titleElem.textContent = title;
    if (frame) {
      frame.src = url;
      frame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen");
      frame.setAttribute("allowfullscreen", "true");
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    }
    if (modal) {
      modal.hidden = false;
      modal.style.display = "grid";
    }
  }

  // تفعيل زر الإغلاق ×
  const closeBtn = document.getElementById("lesson-video-close");
  if (closeBtn) {
    closeBtn.onclick = () => {
      const modal = document.getElementById("lesson-video-modal");
      const frame = document.getElementById("lesson-video-frame");
      if (frame) frame.src = "";
      if (modal) {
        modal.hidden = true;
        modal.style.display = "none";
      }
    };
  }

  // استدعاء فوري عند تحميل الصفحة
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadVideos);
  } else {
    loadVideos();
  }

  window.addEventListener("parent-screen-ready", loadVideos);
  window.addEventListener("active-student-changed", loadVideos);
})();
