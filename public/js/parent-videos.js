(function () {
  function getToken() {
    return (
      sessionStorage.getItem("parentToken") ||
      localStorage.getItem("parentToken") ||
      localStorage.getItem("token") ||
      sessionStorage.getItem("token")
    );
  }

  function getStoredStudent() {
    try {
      const raw =
        sessionStorage.getItem("currentStudent") ||
        localStorage.getItem("currentStudent") ||
        localStorage.getItem("selectedStudent") ||
        sessionStorage.getItem("selectedStudent");
      return JSON.parse(raw || "null");
    } catch {
      return null;
    }
  }

  async function resolveStudentLevel(student) {
    if (student && student.level) return student.level;
    if (student && student.academicLevel) return student.academicLevel;

    const storedLevel = sessionStorage.getItem("studentLevel") || localStorage.getItem("studentLevel");
    if (storedLevel) return storedLevel;

    // جلب المستوى الحقيقي للتلميذ مباشرة من السيرفر لضمان الدقة
    const token = getToken();
    const headers = { Accept: "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    const parentPhone = sessionStorage.getItem("parentPhone") || localStorage.getItem("parentPhone") || "0600000000";
    if (parentPhone) {
      try {
        const res = await fetch("/api/students/parent/" + encodeURIComponent(parentPhone), { headers });
        if (res.ok) {
          const data = await res.json();
          const students = Array.isArray(data) ? data : data.students || data.data || [];
          const matched = students.find((s) => s.id === student?.id) || students[0];
          if (matched && (matched.level || matched.academicLevel)) {
            return matched.level || matched.academicLevel;
          }
        }
      } catch (e) {}
    }

    return student?.level || "السنة الثانية";
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
    } catch (e) {
      return [];
    }
  }

  async function loadVideosForStudent(student) {
    const listElem = document.getElementById("lesson-video-list");
    if (!listElem) return;

    if (!student || !student.id) {
      listElem.innerHTML = '<div class="lesson-video-empty">يرجى تسجيل الدخول أولاً لعرض الفيديوهات.</div>';
      return;
    }

    listElem.innerHTML = '<div class="lesson-video-empty">جارٍ جلب الفيديوهات المكملة...</div>';

    const level = await resolveStudentLevel(student);
    const captionElem = document.getElementById("lesson-repository-level-caption");
    if (captionElem) {
      captionElem.textContent = "الفيديوهات المكملة الخاصة بمستوى: " + level;
    }

    let videos = await fetchVideos(level);

    // تجربة الصيغة البديلة لمسمى المستوى تلقائياً (بكلمة متوسط أو بدونها)
    if (!videos || videos.length === 0) {
      const altLevel = level.includes("متوسط") ? level.replace(" متوسط", "").trim() : level + " متوسط";
      const altVideos = await fetchVideos(altLevel);
      if (altVideos && altVideos.length > 0) {
        videos = altVideos;
      }
    }

    if (!videos || videos.length === 0) {
      listElem.innerHTML = '<div class="lesson-video-empty">لا توجد فيديوهات مكملة مضافة لمستوى ' + level + ' حالياً.</div>';
      return;
    }

    listElem.innerHTML = "";
    videos.forEach((vid) => {
      const item = document.createElement("div");
      item.className = "lesson-video-item";
      item.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;background:#fff;padding:14px;border-radius:12px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0;gap:12px;";

      // قراءة روابط اليوتيوب من كافة الحقول المحتملة
      let embedUrl = vid.driveUrl || vid.previewUrl || vid.youtubeEmbedUrl || vid.videoUrl || vid.url;
      if (!embedUrl && (vid.driveFileId || vid.youtubeVideoId)) {
        const vidId = vid.driveFileId || vid.youtubeVideoId;
        embedUrl = "https://www.youtube.com/embed/" + vidId + "?enablejsapi=1&playsinline=1&rel=0";
      } else if (embedUrl && (embedUrl.includes("youtube.com") || embedUrl.includes("youtu.be"))) {
        const m = String(embedUrl).match(
          /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/|watch\?.+&v=))([A-Za-z0-9_-]{11})/
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

  const fsBtn = document.getElementById("lesson-video-fullscreen");
  if (fsBtn) {
    fsBtn.onclick = () => {
      const frame = document.getElementById("lesson-video-frame");
      if (frame) {
        if (frame.requestFullscreen) frame.requestFullscreen();
        else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      }
    };
  }

  window.addEventListener("parent-screen-ready", (event) => {
    const student = (event && event.detail) ? event.detail : getStoredStudent();
    if (student) loadVideosForStudent(student);
  });

  const initialStudent = getStoredStudent();
  if (initialStudent) {
    loadVideosForStudent(initialStudent);
  }
})();    const headers = { Accept: "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    try {
      const res = await fetch("/api/lesson-videos/" + encodeURIComponent(level), { headers });
      if (!res.ok) return [];
      const payload = await res.json().catch(() => []);
      return Array.isArray(payload) ? payload : payload.videos || payload.data || payload.lessonVideos || [];
    } catch (e) {
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

      // ✅ قراءة الرابط من الحقول الحقيقية للسيرفر (driveUrl أو previewUrl أو driveFileId)
      let embedUrl = vid.driveUrl || vid.previewUrl || vid.youtubeEmbedUrl || vid.videoUrl || vid.url;
      
      if (!embedUrl && (vid.driveFileId || vid.youtubeVideoId)) {
        const vidId = vid.driveFileId || vid.youtubeVideoId;
        embedUrl = "https://www.youtube.com/embed/" + vidId + "?enablejsapi=1&playsinline=1&rel=0";
      } else if (embedUrl && (embedUrl.includes("youtube.com") || embedUrl.includes("youtu.be"))) {
        const m = String(embedUrl).match(
          /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/|watch\?.+&v=))([A-Za-z0-9_-]{11})/
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

  // زر الإغلاق ×
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

  // أزرار التحكم بالملء والتدوير في المشغل
  const fsBtn = document.getElementById("lesson-video-fullscreen");
  if (fsBtn) {
    fsBtn.onclick = () => {
      const frame = document.getElementById("lesson-video-frame");
      if (frame) {
        if (frame.requestFullscreen) frame.requestFullscreen();
        else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadVideos);
  } else {
    loadVideos();
  }

  window.addEventListener("parent-screen-ready", loadVideos);
  window.addEventListener("active-student-changed", loadVideos);
})();    const headers = { Accept: "application/json" };
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
      try {
        const res = await fetch("/api/students/parent/" + encodeURIComponent(parentPhone), { headers });
        if (res.ok) {
          const data = await res.json();
          const students = Array.isArray(data) ? data : data.students || data.data || [];
          const matched = students.find((s) => s.id === student?.id) || students[0];
          if (matched && (matched.level || matched.academicLevel)) {
            return matched.level || matched.academicLevel;
          }
        }
      } catch (e) {}
    }

    return student?.level || "السنة الثانية";
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
    } catch (e) {
      return [];
    }
  }

  function extractEmbedUrl(vid) {
    if (!vid) return null;
    let url = vid.driveUrl || vid.previewUrl || vid.youtubeEmbedUrl || vid.videoUrl || vid.url;

    if (!url && (vid.driveFileId || vid.youtubeVideoId)) {
      const vidId = vid.driveFileId || vid.youtubeVideoId;
      return "https://www.youtube.com/embed/" + vidId + "?enablejsapi=1&playsinline=1&rel=0";
    }

    if (url && (url.includes("youtube.com") || url.includes("youtu.be"))) {
      const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/|watch\?.+&v=))([A-Za-z0-9_-]{11})/);
      if (m && m) {
        return "https://www.youtube.com/embed/" + m + "?enablejsapi=1&playsinline=1&rel=0";
      }
    }

    return url || null;
  }

  async function loadVideosForStudent(student) {
    const listElem = document.getElementById("lesson-video-list");
    if (!listElem) return;

    if (!student || !student.id) {
      listElem.innerHTML = '<div class="lesson-video-empty">يرجى تسجيل الدخول أولاً لعرض الفيديوهات.</div>';
      return;
    }

    listElem.innerHTML = '<div class="lesson-video-empty">جارٍ جلب الفيديوهات المكملة...</div>';

    const level = await resolveStudentLevel(student);
    const captionElem = document.getElementById("lesson-repository-level-caption");
    if (captionElem) {
      captionElem.textContent = "الفيديوهات المكملة الخاصة بمستوى: " + level;
    }

    let videos = await fetchVideos(level);

    if (!videos || videos.length === 0) {
      const altLevel = level.includes("متوسط") ? level.replace(" متوسط", "").trim() : level + " متوسط";
      const altVideos = await fetchVideos(altLevel);
      if (altVideos && altVideos.length > 0) {
        videos = altVideos;
      }
    }

    if (!videos || videos.length === 0) {
      listElem.innerHTML = '<div class="lesson-video-empty">لا توجد فيديوهات مكملة مضافة لمستوى ' + level + ' حالياً.</div>';
      return;
    }

    listElem.innerHTML = "";
    videos.forEach((vid) => {
      const item = document.createElement("div");
      item.className = "lesson-video-item";
      item.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;background:#fff;padding:14px;border-radius:12px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0;gap:12px;";

      const embedUrl = extractEmbedUrl(vid);
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

  const fsBtn = document.getElementById("lesson-video-fullscreen");
  if (fsBtn) {
    fsBtn.onclick = () => {
      const frame = document.getElementById("lesson-video-frame");
      if (frame) {
        if (frame.requestFullscreen) frame.requestFullscreen();
        else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      }
    };
  }

  window.addEventListener("parent-screen-ready", (event) => {
    const student = (event && event.detail) ? event.detail : getStoredStudent();
    if (student) loadVideosForStudent(student);
  });

  const initialStudent = getStoredStudent();
  if (initialStudent) {
    loadVideosForStudent(initialStudent);
  }
})();    if (parentPhone) {
      try {
        const res = await fetch("/api/students/parent/" + encodeURIComponent(parentPhone), { headers });
        if (res.ok) {
          const data = await res.json();
          const students = Array.isArray(data) ? data : data.students || data.data || [];
          const matched = students.find((s) => s.id === student?.id) || students[0];
          if (matched && (matched.level || matched.academicLevel)) {
            return matched.level || matched.academicLevel;
          }
        }
      } catch (e) {}
    }

    return student?.level || "السنة الثانية";
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
    } catch (e) {
      return [];
    }
  }

  async function loadVideosForStudent(student) {
    const listElem = document.getElementById("lesson-video-list");
    if (!listElem) return;

    if (!student || !student.id) {
      listElem.innerHTML = '<div class="lesson-video-empty">يرجى تسجيل الدخول أولاً لعرض الفيديوهات.</div>';
      return;
    }

    listElem.innerHTML = '<div class="lesson-video-empty">جارٍ جلب الفيديوهات المكملة...</div>';

    const level = await resolveStudentLevel(student);
    const captionElem = document.getElementById("lesson-repository-level-caption");
    if (captionElem) {
      captionElem.textContent = "الفيديوهات المكملة الخاصة بمستوى: " + level;
    }

    let videos = await fetchVideos(level);

    // تجربة الصيغة البديلة لمسمى المستوى تلقائياً (بكلمة متوسط أو بدونها)
    if (!videos || videos.length === 0) {
      const altLevel = level.includes("متوسط") ? level.replace(" متوسط", "").trim() : level + " متوسط";
      const altVideos = await fetchVideos(altLevel);
      if (altVideos && altVideos.length > 0) {
        videos = altVideos;
      }
    }

    if (!videos || videos.length === 0) {
      listElem.innerHTML = '<div class="lesson-video-empty">لا توجد فيديوهات مكملة مضافة لمستوى ' + level + ' حالياً.</div>';
      return;
    }

    listElem.innerHTML = "";
    videos.forEach((vid) => {
      const item = document.createElement("div");
      item.className = "lesson-video-item";
      item.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;background:#fff;padding:14px;border-radius:12px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e2e8f0;gap:12px;";

      // قراءة روابط اليوتيوب من كافة الحقول المحتملة
      let embedUrl = vid.driveUrl || vid.previewUrl || vid.youtubeEmbedUrl || vid.videoUrl || vid.url;
      if (!embedUrl && (vid.driveFileId || vid.youtubeVideoId)) {
        const vidId = vid.driveFileId || vid.youtubeVideoId;
        embedUrl = "https://www.youtube.com/embed/" + vidId + "?enablejsapi=1&playsinline=1&rel=0";
      } else if (embedUrl && (embedUrl.includes("youtube.com") || embedUrl.includes("youtu.be"))) {
        const m = String(embedUrl).match(
          /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/|watch\?.+&v=))([A-Za-z0-9_-]{11})/
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

  const fsBtn = document.getElementById("lesson-video-fullscreen");
  if (fsBtn) {
    fsBtn.onclick = () => {
      const frame = document.getElementById("lesson-video-frame");
      if (frame) {
        if (frame.requestFullscreen) frame.requestFullscreen();
        else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      }
    };
  }

  window.addEventListener("parent-screen-ready", (event) => {
    const student = (event && event.detail) ? event.detail : getStoredStudent();
    if (student) loadVideosForStudent(student);
  });

  const initialStudent = getStoredStudent();
  if (initialStudent) {
    loadVideosForStudent(initialStudent);
  }
})();    const headers = { Accept: "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    try {
      const res = await fetch("/api/lesson-videos/" + encodeURIComponent(level), { headers });
      if (!res.ok) return [];
      const payload = await res.json().catch(() => []);
      return Array.isArray(payload) ? payload : payload.videos || payload.data || payload.lessonVideos || [];
    } catch (e) {
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

      // ✅ قراءة الرابط من الحقول الحقيقية للسيرفر (driveUrl أو previewUrl أو driveFileId)
      let embedUrl = vid.driveUrl || vid.previewUrl || vid.youtubeEmbedUrl || vid.videoUrl || vid.url;
      
      if (!embedUrl && (vid.driveFileId || vid.youtubeVideoId)) {
        const vidId = vid.driveFileId || vid.youtubeVideoId;
        embedUrl = "https://www.youtube.com/embed/" + vidId + "?enablejsapi=1&playsinline=1&rel=0";
      } else if (embedUrl && (embedUrl.includes("youtube.com") || embedUrl.includes("youtu.be"))) {
        const m = String(embedUrl).match(
          /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/|watch\?.+&v=))([A-Za-z0-9_-]{11})/
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

  // زر الإغلاق ×
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

  // أزرار التحكم بالملء والتدوير في المشغل
  const fsBtn = document.getElementById("lesson-video-fullscreen");
  if (fsBtn) {
    fsBtn.onclick = () => {
      const frame = document.getElementById("lesson-video-frame");
      if (frame) {
        if (frame.requestFullscreen) frame.requestFullscreen();
        else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadVideos);
  } else {
    loadVideos();
  }

  window.addEventListener("parent-screen-ready", loadVideos);
  window.addEventListener("active-student-changed", loadVideos);
})();    const headers = { Accept: "application/json" };
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
