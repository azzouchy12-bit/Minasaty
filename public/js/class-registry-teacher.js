"use strict";

(() => {
  const token = sessionStorage.getItem("teacherToken");
  if (!token) return;

  const $ = (id) => document.getElementById(id);
  const term = $("class-registry-term");
  const month = $("class-registry-month");
  const subject = $("class-registry-subject");
  const list = $("class-registry-list");
  const registryToggle = $("class-registry-toggle");
  const registryControls = $("class-registry-controls");
  const registryToggleIcon = $("class-registry-toggle-icon");
  const modal = $("class-registry-action-modal");
  const form = $("class-registry-action-form");
  const title = $("class-registry-action-title");
  const driveField = $("class-registry-drive-field");
  const driveInput = $("class-registry-drive-link");
  const notesField = $("class-registry-notes-field");
  const notesInput = $("class-registry-notes");
  const youtubeField = $("class-registry-youtube-field");
  const youtubePickerButton = $("class-registry-youtube-picker");
  const youtubeVideoIdInput = $("class-registry-youtube-video-id");
  const youtubeSelectedLabel = $("class-registry-youtube-selected");
  const youtubeConnectButton = $("youtube-connect-button");
  const youtubeConnectionStatus = $("youtube-connection-status");
  const youtubePickerModal = $("youtube-video-picker-modal");
  const youtubePickerList = $("youtube-video-picker-list");
  const registryUploadVideoBtn = $("registry-upload-video-btn");
  const registryVideoFileInput = $("registry-video-file-input");
  const classRegistryDirectUploadBtn = $("class-registry-direct-upload-btn");

  const uploadModal = $("registry-youtube-upload-modal");
  const uploadModalClose = $("registry-upload-modal-close");
  const uploadFileName = $("registry-upload-file-name");
  const uploadFileSize = $("registry-upload-file-size");
  const uploadVideoTitle = $("registry-upload-video-title");
  const uploadTargetClassRow = $("registry-upload-class-select-row");
  const uploadTargetClassSelect = $("registry-upload-target-class");
  const uploadFileInfoBox = $("registry-upload-file-info");
  const uploadStartBtn = $("registry-upload-start-btn");
  const uploadProgressBox = $("registry-upload-progress-box");
  const uploadProgressbar = $("registry-upload-progressbar");
  const uploadPercent = $("registry-upload-percent");
  const uploadBytes = $("registry-upload-bytes");
  const uploadSpeed = $("registry-upload-speed");
  const uploadEta = $("registry-upload-eta");
  const uploadStatusText = $("registry-upload-status-text");
  const uploadSuccessCard = $("registry-upload-success-card");
  const uploadWatchBtn = $("registry-upload-watch-btn");
  const uploadCopyBtn = $("registry-upload-copy-btn");
  const uploadDoneBtn = $("registry-upload-done-btn");

  let currentLevel = document.querySelector(".level-btn.is-active")?.dataset.level || "السنة الأولى";
  let selectedTerm = "";
  let selectedMonth = "";
  let selectedSubject = "";
  let selectedClass = null;
  let currentClasses = [];
  let pendingUploadFile = null;
  let activeUploadXhr = null;
  let isUploadingToYoutube = false;
  let youtubeConnected = false;
  let registryOpen = false;

  function setRegistryOpen(nextOpen) {
    registryOpen = Boolean(nextOpen);
    if (registryControls) registryControls.hidden = !registryOpen;
    registryToggle?.setAttribute("aria-expanded", String(registryOpen));
    if (registryToggleIcon) registryToggleIcon.textContent = registryOpen ? "⌃" : "⌄";
    if (registryOpen) showSelectionPrompt();
  }

  const labels = {
    MATH: "الرياضيات",
    PHYSICS: "الفيزياء",
    PAID: "اشتراك مدفوع",
    FREE: "اشتراك مجاني",
  };
  const statusLabels = {
    PENDING: "لم تُنجز بعد",
    COMPLETED: "تمت الحصة",
    TEACHER_ABSENT: "غياب الأستاذ",
  };
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

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تنفيذ العملية.");
    return payload;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("ar-DZ", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Algiers" }).format(date)
      : "تاريخ غير صالح";
  }

  function showError(message) {
    const error = document.querySelector("#dashboard-error, #message-box");
    if (error) {
      error.textContent = message;
      error.hidden = false;
      error.classList.add("is-visible");
    }
  }

  function getSelectedTerm() {
    return TERMS[selectedTerm] || null;
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
      term,
      "اختر الفصل الدراسي",
      Object.entries(TERMS).map(([value, data]) => ({ value, label: data.label })),
      selectedTerm,
      false
    );
    fillSelect(
      month,
      selectedTerm ? "اختر الشهر" : "اختر الفصل أولًا",
      getSelectedTerm()?.months || [],
      selectedMonth,
      !selectedTerm
    );
    fillSelect(
      subject,
      selectedMonth ? "اختر المادة" : "اختر الشهر أولًا",
      [
        { value: "MATH", label: "الرياضيات" },
        { value: "PHYSICS", label: "الفيزياء" },
      ],
      selectedSubject,
      !selectedMonth
    );
  }

  function showSelectionPrompt() {
    if (!registryOpen || !list) return;
    if (!selectedTerm) {
      list.innerHTML = '<p class="class-registry-empty">اختر الفصل الدراسي أولًا.</p>';
      return;
    }
    if (!selectedMonth) {
      list.innerHTML = '<p class="class-registry-empty">اختر الشهر من القائمة.</p>';
      return;
    }
    if (!selectedSubject) {
      list.innerHTML = '<p class="class-registry-empty">اختر المادة من القائمة.</p>';
    }
  }

  function setYoutubeStatus(text, connected = youtubeConnected) {
    if (youtubeConnectionStatus) youtubeConnectionStatus.textContent = text;
    youtubeConnectButton?.classList.toggle("is-connected", connected);
    if (youtubeConnectButton) youtubeConnectButton.textContent = connected ? "إدارة قناة YouTube" : "ربط قناة YouTube";
  }

  async function loadYoutubeStatus() {
    try {
      const payload = await api("/api/youtube/status");
      youtubeConnected = Boolean(payload.data?.connected);
      setYoutubeStatus(youtubeConnected ? "قناة YouTube مرتبطة" : "لم تُربط قناة YouTube بعد");
    } catch (error) {
      youtubeConnected = false;
      setYoutubeStatus("تعذر التحقق من قناة YouTube", false);
      console.warn("Unable to read YouTube status:", error);
    }
  }

  async function connectYoutube() {
    try {
      const payload = await api("/api/youtube/connect");
      const popup = window.open(payload.authorizationUrl, "youtube-oauth", "popup,width=560,height=760");
      if (!popup) showError("اسمح بالنوافذ المنبثقة لإكمال ربط قناة YouTube.");
    } catch (error) {
      showError(error.message);
    }
  }

  function closeYoutubePicker() {
    if (youtubePickerModal) youtubePickerModal.hidden = true;
  }

  function selectYoutubeVideo(video) {
    youtubeVideoIdInput.value = video.id;
    youtubeSelectedLabel.textContent = `تم اختيار: ${video.title}`;
    youtubeSelectedLabel.title = video.title;
    closeYoutubePicker();
  }

  function renderYoutubeVideos(videos) {
    youtubePickerList.replaceChildren();
    if (!videos.length) {
      const empty = document.createElement("p");
      empty.className = "class-registry-empty";
      empty.textContent = "لا توجد فيديوهات متاحة في القناة.";
      youtubePickerList.append(empty);
      return;
    }
    videos.forEach((video) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "youtube-video-picker-item";
      const image = document.createElement("img");
      image.src = video.thumbnail || "";
      image.alt = "";
      image.loading = "lazy";
      const copy = document.createElement("span");
      const titleElement = document.createElement("strong");
      titleElement.textContent = video.title;
      const meta = document.createElement("small");
      meta.textContent = video.publishedAt ? new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium" }).format(new Date(video.publishedAt)) : "فيديو من القناة";
      copy.append(titleElement, meta);
      button.append(image, copy);
      button.addEventListener("click", () => selectYoutubeVideo(video));
      youtubePickerList.append(button);
    });
  }

  async function openYoutubePicker() {
    if (!youtubeConnected) {
      await connectYoutube();
      return;
    }
    youtubePickerModal.hidden = false;
    youtubePickerList.innerHTML = '<p class="class-registry-loading">جارٍ تحميل فيديوهات القناة…</p>';
    try {
      const payload = await api("/api/youtube/videos?limit=20");
      renderYoutubeVideos(Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      youtubePickerList.innerHTML = `<p class="class-registry-empty">${error.message}</p>`;
    }
  }

  function openAction(item, nextStatus) {
    selectedClass = item;
    form.dataset.status = nextStatus;
    title.textContent = nextStatus === "COMPLETED" ? "تسجيل الحصة كمكتملة" : "تسجيل غياب الأستاذ";
    driveField.hidden = nextStatus !== "COMPLETED";
    youtubeField.hidden = nextStatus !== "COMPLETED";
    notesField.hidden = nextStatus === "PENDING";
    driveInput.value = item.driveLink || "";
    youtubeVideoIdInput.value = item.youtubeVideoId || "";
    youtubeSelectedLabel.textContent = item.youtubeVideoId ? "يوجد فيديو YouTube مرتبط بهذه الحصة" : "لم يتم اختيار فيديو YouTube";
    notesInput.value = item.notes || "";
    modal.hidden = false;
    driveField.hidden && youtubeField.hidden ? notesInput.focus() : (item.youtubeVideoId ? notesInput.focus() : youtubePickerButton.focus());
  }

  function closeAction() {
    modal.hidden = true;
    selectedClass = null;
    form.reset();
  }

  function button(text, className, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
  }

  function render(items) {
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "class-registry-empty";
      empty.textContent = "لا توجد حصص مسجلة لهذا الشهر والمادة.";
      list.append(empty);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = `class-registry-item status-${item.status.toLowerCase()}`;
      const copy = document.createElement("div");
      copy.className = "class-registry-item-copy";
      const name = document.createElement("strong");
      name.textContent = labels[item.subject] || item.subject;
      const date = document.createElement("span");
      date.textContent = formatDate(item.scheduledAt);
      const status = document.createElement("em");
      status.textContent = statusLabels[item.status] || item.status;
      copy.append(name, date, status);
      const actions = document.createElement("div");
      actions.className = "class-registry-item-actions";
      if (item.status === "COMPLETED") {
        actions.append(button("تعديل التسجيل", "registry-action registry-complete", () => openAction(item, "COMPLETED")));
      } else {
        actions.append(button("تمت الحصة", "registry-action registry-complete", () => openAction(item, "COMPLETED")));
      }
      if (item.status === "TEACHER_ABSENT") {
        actions.append(button("تعديل الملاحظة", "registry-action registry-absent", () => openAction(item, "TEACHER_ABSENT")));
      } else {
        actions.append(button("غياب الأستاذ", "registry-action registry-absent", () => openAction(item, "TEACHER_ABSENT")));
      }
      if (item.status !== "PENDING") {
        actions.append(button("إعادة إلى الانتظار", "registry-action registry-pending", () => update(item, "PENDING")));
      }
      card.append(copy, actions);
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
    if (!list || !term || !month || !subject || !selectedTerm || !selectedMonth || !selectedSubject) {
      showSelectionPrompt();
      return;
    }
    list.innerHTML = '<p class="class-registry-loading">جارٍ تحميل سجل الحصص…</p>';
    try {
      const payload = await api(`/api/schedules/registry/${encodeURIComponent(currentLevel)}?month=${encodeURIComponent(selectedMonth)}&subject=${encodeURIComponent(selectedSubject)}`);
      currentClasses = Array.isArray(payload.data) ? payload.data : [];
      render(currentClasses);
    } catch (error) {
      currentClasses = [];
      list.innerHTML = `<p class="class-registry-empty">${error.message}</p>`;
    }
  }

  async function update(item, status, fields = {}) {
    try {
      await api(`/api/schedules/registry/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...fields }),
      });
      closeAction();
      await load();
    } catch (error) {
      showError(error.message);
    }
  }

  function formatBytesToHuman(bytes) {
    if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "0 MB";
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatSpeedToHuman(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0 || !Number.isFinite(bytesPerSec)) return "0 KB/s (0 Mbps)";
    const mbps = ((bytesPerSec * 8) / 1_000_000).toFixed(1);
    if (bytesPerSec >= 1024 * 1024) {
      const mb = (bytesPerSec / (1024 * 1024)).toFixed(1);
      return `${mb} MB/s (${mbps} Mbps)`;
    }
    const kb = (bytesPerSec / 1024).toFixed(0);
    return `${kb} KB/s (${mbps} Mbps)`;
  }

  function formatSecondsToHuman(seconds) {
    if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return "أقل من ثانية";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs} ثانية`;
    if (secs === 0) return `${mins} دقيقة`;
    return `${mins} دقيقة و ${secs} ثانية`;
  }

  function playUploadSuccessChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const notes = [
        { freq: 523.25, time: 0, dur: 0.22, vol: 0.25 },
        { freq: 659.25, time: 0.12, dur: 0.22, vol: 0.25 },
        { freq: 783.99, time: 0.24, dur: 0.28, vol: 0.28 },
        { freq: 1046.50, time: 0.38, dur: 0.65, vol: 0.32 },
      ];
      notes.forEach(({ freq, time, dur, vol }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + time);
        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.exponentialRampToValueAtTime(vol, now + time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + time);
        osc.stop(now + time + dur);
      });
    } catch (err) {
      console.warn("Unable to play upload success chime:", err);
    }
  }

  function onBeforeUnloadGuard(e) {
    if (!isUploadingToYoutube) return;
    e.preventDefault();
    e.returnValue = "يجري حالياً رفع الفيديو إلى YouTube. إذا أغلقت الصفحة سينقطع الرفع.";
    return e.returnValue;
  }

  function setUploadBeforeUnloadProtection(enabled) {
    isUploadingToYoutube = Boolean(enabled);
    if (isUploadingToYoutube) {
      window.addEventListener("beforeunload", onBeforeUnloadGuard);
    } else {
      window.removeEventListener("beforeunload", onBeforeUnloadGuard);
    }
  }

  function directPutToGoogle(uploadUrl, blob, mimeType, onProgress) {
    const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB chunks (multiple of 256 KB)
    const totalBytes = blob.size;
    const startTime = Date.now();
    let smoothSpeed = 0;
    let lastLoadedForSpeed = 0;
    let lastTimeForSpeed = startTime;
    let isAborted = false;

    function queryGoogleStatus() {
      return new Promise((resolve) => {
        if (isAborted) return resolve({ aborted: true });
        const xhr = new XMLHttpRequest();
        activeUploadXhr = xhr;
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Range", `bytes */${totalBytes}`);
        xhr.onload = () => {
          activeUploadXhr = null;
          if (xhr.status === 308) {
            const rangeHeader = xhr.getResponseHeader("Range");
            if (rangeHeader) {
              const match = /bytes=0-(\d+)/.exec(rangeHeader);
              if (match) return resolve({ nextByte: parseInt(match[1], 10) + 1 });
            }
            resolve({ nextByte: 0 });
          } else if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve({ complete: true, data: JSON.parse(xhr.responseText) });
            } catch (_) {
              resolve({ complete: true, data: { id: null } });
            }
          } else {
            resolve({ error: true, status: xhr.status });
          }
        };
        xhr.onerror = () => {
          activeUploadXhr = null;
          resolve({ error: true });
        };
        xhr.onabort = () => {
          activeUploadXhr = null;
          resolve({ aborted: true });
        };
        xhr.send();
      });
    }

    function uploadChunk(startByte, endByte) {
      return new Promise((resolve, reject) => {
        if (isAborted) return reject(new Error("تم إلغاء الرفع."));

        const chunk = blob.slice(startByte, endByte);
        const xhr = new XMLHttpRequest();
        activeUploadXhr = xhr;
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", mimeType);
        xhr.setRequestHeader("Content-Range", `bytes ${startByte}-${endByte - 1}/${totalBytes}`);

        xhr.upload.onprogress = (e) => {
          if (isAborted) return;
          const chunkLoaded = e.lengthComputable ? e.loaded : 0;
          const currentTotalLoaded = Math.min(totalBytes, startByte + chunkLoaded);
          const now = Date.now();
          const percent = Math.min(99, Math.round((currentTotalLoaded / totalBytes) * 100));
          const elapsedSec = (now - startTime) / 1000;

          const instantElapsed = (now - lastTimeForSpeed) / 1000;
          if (instantElapsed >= 0.4) {
            const instantBytes = currentTotalLoaded - lastLoadedForSpeed;
            const currentSpeed = Math.max(0, instantBytes / instantElapsed);
            smoothSpeed = smoothSpeed === 0 ? currentSpeed : (smoothSpeed * 0.7 + currentSpeed * 0.3);
            lastLoadedForSpeed = currentTotalLoaded;
            lastTimeForSpeed = now;
          } else if (smoothSpeed === 0 && elapsedSec > 0.4) {
            smoothSpeed = currentTotalLoaded / elapsedSec;
          }

          const remainingBytes = Math.max(0, totalBytes - currentTotalLoaded);
          const remainingSec = smoothSpeed > 0 ? Math.ceil(remainingBytes / smoothSpeed) : null;

          onProgress?.({
            percent,
            loadedBytes: currentTotalLoaded,
            totalBytes,
            speedBps: smoothSpeed,
            remainingSec,
          });
        };

        xhr.onload = () => {
          activeUploadXhr = null;
          if (xhr.status === 308) {
            const rangeHeader = xhr.getResponseHeader("Range");
            let nextByte = endByte;
            if (rangeHeader) {
              const match = /bytes=0-(\d+)/.exec(rangeHeader);
              if (match) nextByte = parseInt(match[1], 10) + 1;
            }
            resolve({ status: 308, nextByte });
          } else if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve({ status: 200, data: JSON.parse(xhr.responseText) });
            } catch (_) {
              resolve({ status: 200, data: { id: null } });
            }
          } else {
            let msg = "فشل رفع أحد أجزاء الفيديو.";
            try { msg = JSON.parse(xhr.responseText)?.error?.message || msg; } catch (_) {}
            resolve({ status: xhr.status, errorMsg: msg });
          }
        };

        xhr.onerror = () => {
          activeUploadXhr = null;
          resolve({ status: 0, networkError: true });
        };

        xhr.onabort = () => {
          activeUploadXhr = null;
          isAborted = true;
          reject(new Error("تم إلغاء الرفع."));
        };

        xhr.send(chunk);
      });
    }

    return new Promise(async (resolve, reject) => {
      let currentStart = 0;
      let consecutiveRetries = 0;
      const MAX_RETRIES = 5;

      while (currentStart < totalBytes) {
        if (isAborted) {
          return reject(new Error("تم إلغاء الرفع."));
        }

        const currentEnd = Math.min(currentStart + CHUNK_SIZE, totalBytes);
        try {
          const result = await uploadChunk(currentStart, currentEnd);

          if (result.status === 308) {
            consecutiveRetries = 0;
            currentStart = result.nextByte;
          } else if (result.status === 200) {
            onProgress?.({
              percent: 100,
              loadedBytes: totalBytes,
              totalBytes,
              speedBps: smoothSpeed,
              remainingSec: 0,
            });
            return resolve(result.data);
          } else {
            consecutiveRetries++;
            if (consecutiveRetries > MAX_RETRIES) {
              return reject(new Error(result.errorMsg || `تعذر استكمال رفع الفيديو بعد عدة محاولات (${result.status || "انقطاع اتصال"}).`));
            }
            const delayMs = Math.min(1000 * Math.pow(2, consecutiveRetries - 1), 10000);
            await new Promise((r) => setTimeout(r, delayMs));

            const statusCheck = await queryGoogleStatus();
            if (statusCheck.complete) {
              return resolve(statusCheck.data);
            }
            if (typeof statusCheck.nextByte === "number") {
              currentStart = statusCheck.nextByte;
            }
          }
        } catch (err) {
          if (isAborted || err.message === "تم إلغاء الرفع.") {
            return reject(err);
          }
          consecutiveRetries++;
          if (consecutiveRetries > MAX_RETRIES) {
            return reject(err);
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      const finalStatus = await queryGoogleStatus();
      if (finalStatus.complete) {
        return resolve(finalStatus.data);
      }
      reject(new Error("اكتمل إرسال الأجزاء ولكن لم يتم تأكيد الاستلام من YouTube."));
    });
  }

  function openUploadModalForFile(file, classToTarget = selectedClass) {
    if (!file) return;
    pendingUploadFile = file;

    uploadFileInfoBox.hidden = false;
    uploadProgressBox.hidden = true;
    uploadSuccessCard.hidden = true;
    uploadStartBtn.disabled = false;
    uploadStartBtn.textContent = "🚀 بدء الرفع المباشر إلى YouTube";

    uploadFileName.textContent = file.name;
    uploadFileSize.textContent = formatBytesToHuman(file.size);

    const baseName = file.name.replace(/\.[^/.]+$/, "").trim();
    if (classToTarget) {
      const subjectLabel = labels[classToTarget.subject] || classToTarget.subject;
      uploadVideoTitle.value = `حصة ${subjectLabel} — ${currentLevel} — ${baseName}`;
    } else {
      uploadVideoTitle.value = baseName || `حصة ${currentLevel} مسجلة`;
    }

    if (uploadTargetClassSelect && uploadTargetClassRow) {
      uploadTargetClassSelect.replaceChildren();
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "رفع إلى القناة فقط (دون ربط بحصة محددة)";
      uploadTargetClassSelect.append(defaultOption);

      if (currentClasses && currentClasses.length > 0) {
        uploadTargetClassRow.hidden = false;
        currentClasses.forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          const statusText = statusLabels[c.status] || c.status;
          opt.textContent = `${labels[c.subject] || c.subject} — ${formatDate(c.scheduledAt)} (${statusText})`;
          if (classToTarget && classToTarget.id === c.id) {
            opt.selected = true;
          }
          uploadTargetClassSelect.append(opt);
        });
      } else {
        uploadTargetClassRow.hidden = true;
      }
    }

    uploadModal.hidden = false;
  }

  function closeUploadModal() {
    if (isUploadingToYoutube) {
      if (!confirm("هل أنت متأكد من رغبتك في إلغاء عملية الرفع الجارية؟")) {
        return;
      }
      if (activeUploadXhr) {
        activeUploadXhr.abort();
      }
      setUploadBeforeUnloadProtection(false);
    }
    uploadModal.hidden = true;
    pendingUploadFile = null;
    activeUploadXhr = null;
  }

  async function startDirectUpload() {
    if (!pendingUploadFile || isUploadingToYoutube) return;

    if (!youtubeConnected) {
      await connectYoutube();
      return;
    }

    const file = pendingUploadFile;
    const titleText = (uploadVideoTitle?.value || "").trim().slice(0, 100) || file.name.replace(/\.[^/.]+$/, "");
    const targetClassId = uploadTargetClassSelect?.value || selectedClass?.id || "";

    uploadFileInfoBox.hidden = true;
    uploadProgressBox.hidden = false;
    uploadSuccessCard.hidden = true;

    uploadProgressbar.style.width = "2%";
    uploadPercent.textContent = "2%";
    uploadBytes.textContent = `0 MB / ${formatBytesToHuman(file.size)}`;
    uploadSpeed.textContent = "0 KB/s";
    uploadEta.textContent = "جارٍ البدء…";
    uploadStatusText.textContent = "جارٍ فتح جلسة الرفع مع YouTube…";

    setUploadBeforeUnloadProtection(true);

    try {
      const mimeType = file.type || "video/webm";
      const sessionRes = await fetch("/api/youtube/resumable-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: titleText,
          description: `تسجيل مرفوع من منصتي\nالمستوى: ${currentLevel}`,
          mimeType,
          fileSize: file.size,
        }),
      });

      const sessionPayload = await sessionRes.json().catch(() => ({}));
      if (!sessionRes.ok || !sessionPayload.uploadUrl) {
        throw new Error(sessionPayload.error || "تعذر فتح جلسة الرفع إلى YouTube.");
      }

      uploadStatusText.textContent = "جارٍ الرفع المباشر إلى YouTube بحالة غير مدرج (Unlisted)…";

      const googleResponse = await directPutToGoogle(
        sessionPayload.uploadUrl,
        file,
        mimeType,
        ({ percent, loadedBytes, totalBytes, speedBps, remainingSec }) => {
          uploadProgressbar.style.width = `${percent}%`;
          uploadPercent.textContent = `${percent}%`;
          uploadBytes.textContent = `${formatBytesToHuman(loadedBytes)} / ${formatBytesToHuman(totalBytes)}`;
          uploadSpeed.textContent = formatSpeedToHuman(speedBps);
          uploadEta.textContent = formatSecondsToHuman(remainingSec);
        }
      );

      const videoId = googleResponse?.id;
      if (!videoId) throw new Error("لم تُرجع YouTube معرّف الفيديو بعد الرفع.");

      uploadStatusText.textContent = "تم الرفع بنجاح! جارٍ تسجيل الفيديو بالمنصة…";
      uploadProgressbar.style.width = "100%";
      uploadPercent.textContent = "100%";

      await fetch("/api/youtube/resumable-finish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          videoId,
          level: currentLevel,
          subject: selectedSubject || "MATH",
          scheduledClassId: targetClassId || "",
          title: titleText,
        }),
      });

      setUploadBeforeUnloadProtection(false);
      playUploadSuccessChime();

      uploadProgressBox.hidden = true;
      uploadSuccessCard.hidden = false;

      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      uploadWatchBtn.href = videoUrl;

      uploadCopyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(`https://youtu.be/${videoId}`);
          uploadCopyBtn.textContent = "تم نسخ الرابط! ✓";
          setTimeout(() => { uploadCopyBtn.textContent = "نسخ رابط الفيديو"; }, 2500);
        } catch (_) {
          prompt("انسخ رابط الفيديو:", `https://youtu.be/${videoId}`);
        }
      };

      if (targetClassId) {
        if (selectedClass && selectedClass.id === targetClassId) {
          youtubeVideoIdInput.value = videoId;
          youtubeSelectedLabel.textContent = `تم اختيار: ${titleText} (${videoId})`;
          youtubeSelectedLabel.title = titleText;
        }
        await load();
      }

      window.dispatchEvent(new CustomEvent("class-registry-refresh"));
    } catch (error) {
      setUploadBeforeUnloadProtection(false);
      uploadProgressBox.hidden = true;
      uploadFileInfoBox.hidden = false;
      alert(error.message || "حدث خطأ أثناء رفع الفيديو.");
    }
  }

  registryToggle?.addEventListener("click", () => setRegistryOpen(!registryOpen));
  term?.addEventListener("change", () => {
    selectedTerm = term.value;
    selectedMonth = "";
    selectedSubject = "";
    renderFilters();
    showSelectionPrompt();
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!selectedClass) return;
    void update(selectedClass, form.dataset.status, { driveLink: driveInput.value.trim(), youtubeVideoId: youtubeVideoIdInput.value.trim(), notes: notesInput.value.trim() });
  });
  $("class-registry-action-close")?.addEventListener("click", closeAction);
  modal?.addEventListener("click", (event) => { if (event.target === modal) closeAction(); });
  $("youtube-video-picker-close")?.addEventListener("click", closeYoutubePicker);
  youtubePickerModal?.addEventListener("click", (event) => { if (event.target === youtubePickerModal) closeYoutubePicker(); });
  youtubePickerButton?.addEventListener("click", () => void openYoutubePicker());
  youtubeConnectButton?.addEventListener("click", () => void connectYoutube());

  registryUploadVideoBtn?.addEventListener("click", async () => {
    if (!youtubeConnected) {
      await connectYoutube();
      return;
    }
    registryVideoFileInput?.click();
  });

  classRegistryDirectUploadBtn?.addEventListener("click", async () => {
    if (!youtubeConnected) {
      await connectYoutube();
      return;
    }
    registryVideoFileInput?.click();
  });

  registryVideoFileInput?.addEventListener("change", (e) => {
    const file = e.target?.files?.[0];
    if (!file || file.size === 0) return;
    openUploadModalForFile(file, selectedClass);
    e.target.value = "";
  });

  uploadModalClose?.addEventListener("click", closeUploadModal);
  uploadDoneBtn?.addEventListener("click", closeUploadModal);
  uploadStartBtn?.addEventListener("click", () => void startDirectUpload());
  uploadModal?.addEventListener("click", (event) => {
    if (event.target === uploadModal) closeUploadModal();
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === "youtube-connected") {
      youtubeConnected = true;
      setYoutubeStatus("قناة YouTube مرتبطة", true);
    }
    if (event.data?.type === "youtube-connect-failed") setYoutubeStatus("فشل ربط قناة YouTube", false);
  });
  month?.addEventListener("change", () => {
    selectedMonth = month.value;
    selectedSubject = "";
    renderFilters();
    showSelectionPrompt();
  });
  subject?.addEventListener("change", () => {
    selectedSubject = subject.value;
    renderFilters();
    void load();
  });
  document.querySelectorAll(".level-btn[data-level]").forEach((button) => button.addEventListener("click", () => {
    currentLevel = button.dataset.level;
    selectedTerm = "";
    selectedMonth = "";
    selectedSubject = "";
    renderFilters();
    window.setTimeout(() => void load(), 0);
  }));
  window.addEventListener("class-registry-refresh", () => void load());
  renderFilters();
  void loadYoutubeStatus();
  void load();
})();
