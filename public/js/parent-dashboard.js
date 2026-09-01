"use strict";

const PARENT_TOKEN_KEY = "parentToken";

const elements = {
  liveBanner: document.getElementById("live-class-banner"),
  liveBannerDetails: document.getElementById("live-class-banner-details"),
  joinLiveClassButton: document.getElementById("join-live-class-btn"),
  dashboardError: document.getElementById("dashboard-error"),
  loadingState: document.getElementById("loading-state"),
  dashboardContent: document.getElementById("dashboard-content"),
  lessonRepositoryCard: document.getElementById("lesson-repository-card"),
  lessonRepositoryToggle: document.getElementById("lesson-repository-toggle"),
  lessonRepositoryControls: document.getElementById("lesson-repository-controls"),
  lessonRepositoryToggleIcon: document.getElementById("lesson-repository-toggle-icon"),
  studentCertificatesCard: document.getElementById("student-certificates-card"),
  studentCertificatesToggle: document.getElementById("student-certificates-toggle"),
  studentCertificatesContent: document.getElementById("student-certificates-content"),
  studentCertificatesToggleIcon: document.getElementById("student-certificates-toggle-icon"),
  studentCertificatesList: document.getElementById("student-certificates-list"),
  studentCertificatesCaption: document.getElementById("student-certificates-caption"),
  studentCertificateModal: document.getElementById("student-certificate-modal"),
  studentCertificateModalImage: document.getElementById("student-certificate-modal-image"),
  studentCertificateModalClose: document.getElementById("student-certificate-modal-close"),
  studentHomeworkCard: document.getElementById("student-homework-card"),
  studentHomeworkToggle: document.getElementById("student-homework-toggle"),
  studentHomeworkContent: document.getElementById("student-homework-content"),
  studentHomeworkToggleIcon: document.getElementById("student-homework-toggle-icon"),
  studentHomeworkList: document.getElementById("student-homework-list"),
  studentHomeworkFileModal: document.getElementById("student-homework-file-modal"),
  studentHomeworkFileTitle: document.getElementById("student-homework-file-title"),
  studentHomeworkFileClose: document.getElementById("student-homework-file-close"),
  studentHomeworkFileHint: document.getElementById("student-homework-file-hint"),
  studentHomeworkFileStage: document.getElementById("student-homework-file-stage"),
  studentHomeworkFileImage: document.getElementById("student-homework-file-image"),
  studentHomeworkFileFrame: document.getElementById("student-homework-file-frame"),
  studentAvatar: document.getElementById("student-avatar"),
  studentName: document.getElementById("student-name"),
  studentLevel: document.getElementById("student-level"),
  accountStatus: document.getElementById("account-status"),
  cardReuploadPanel: document.getElementById("card-reupload-panel"),
  replacementCardInput: document.getElementById("replacement-card-input"),
  replacementCardButton: document.getElementById("replacement-card-button"),
  paymentStatus: document.getElementById("payment-status"),
  secondaryPaymentState: document.getElementById("secondary-payment-state"),
  universityPaymentUpgrade: document.getElementById("university-payment-upgrade"),
  universityUpgradeButton: document.getElementById("university-upgrade-button"),
  universityPaymentTransfer: document.getElementById("university-payment-transfer"),
  parentPaymentReceiptInput: document.getElementById("parent-payment-receipt-input"),
  parentPaymentCapture: document.getElementById("parent-payment-capture"),
  parentPaymentFileChoice: document.getElementById("parent-payment-file-choice"),
  parentPaymentUpload: document.getElementById("parent-payment-upload"),
  parentPaymentChoiceMenu: document.getElementById("parent-payment-choice-menu"),
  parentPaymentFileName: document.getElementById("parent-payment-file-name"),
  parentCardPaymentButton: document.getElementById("university-card-payment-button"),
  parentPaymentSubmit: document.getElementById("parent-payment-submit"),
  parentPaymentPending: document.getElementById("parent-payment-pending"),
  universityPaymentWaiting: document.getElementById("university-payment-waiting"),
  parentPaymentDecision: document.getElementById("parent-payment-decision"),
  parentPaymentConfirmed: document.getElementById("parent-payment-confirmed"),
  secondaryPaymentUpgrade: document.getElementById("secondary-payment-upgrade"),
  secondaryUpgradeButton: document.getElementById("secondary-upgrade-button"),
  secondaryPaymentTransfer: document.getElementById("secondary-payment-transfer"),
  secondarySubscriptionType: document.getElementById("secondary-subscription-type"),
  secondaryPaymentReceiptInput: document.getElementById("secondary-payment-receipt-input"),
  secondaryPaymentCapture: document.getElementById("secondary-payment-capture"),
  secondaryPaymentFileChoice: document.getElementById("secondary-payment-file-choice"),
  secondaryPaymentUpload: document.getElementById("secondary-payment-upload"),
  secondaryPaymentChoiceMenu: document.getElementById("secondary-payment-choice-menu"),
  secondaryPaymentFileName: document.getElementById("secondary-payment-file-name"),
  secondaryCardPaymentButton: document.getElementById("secondary-card-payment-button"),
  secondaryPaymentSubmit: document.getElementById("secondary-payment-submit"),
  secondaryPaymentPending: document.getElementById("secondary-payment-pending"),
  secondaryPaymentWaiting: document.getElementById("secondary-payment-waiting"),
  secondarySofizPayReconcile: document.getElementById("secondary-sofizpay-reconcile"),
  secondarySofizPayOrderNumber: document.getElementById("secondary-sofizpay-order-number"),
  secondarySofizPayReconcileButton: document.getElementById("secondary-sofizpay-reconcile-button"),
  secondarySofizPayReconcileMessage: document.getElementById("secondary-sofizpay-reconcile-message"),
  parentScheduleCard: document.getElementById("parent-schedule-card"),
  parentNextClassStatus: document.getElementById("parent-next-class-status"),
  parentNextClassState: document.getElementById("parent-next-class-state"),
  parentNextClassStateTitle: document.getElementById("parent-next-class-state-title"),
  parentNextClassStateCopy: document.getElementById("parent-next-class-state-copy"),
  parentScheduleList: document.getElementById("parent-schedule-list"),
  liveClassesEntryCard: document.getElementById("live-classes-entry-card"),
  liveClassesEntryButton: document.getElementById("live-classes-entry-button"),
  liveClassesEntryCaption: document.getElementById("live-classes-entry-caption"),
  liveClassesWaitingPanel: document.getElementById("live-classes-waiting-panel"),
  liveClassesWaitingTime: document.getElementById("live-classes-waiting-time"),
  liveClassesWaitingSubject: document.getElementById("live-classes-waiting-subject"),
  liveClassesWaitingExit: document.getElementById("live-classes-waiting-exit"),
  teacherAbsenceNotice: document.getElementById("teacher-absence-notice"),
  logoutButton: document.getElementById("logout-btn"),
  lessonVideoList: document.getElementById("lesson-video-list"),
  lessonRepositoryLevelCaption: document.getElementById("lesson-repository-level-caption"),
  lessonVideoModal: document.getElementById("lesson-video-modal"),
  lessonVideoModalTitle: document.getElementById("lesson-video-modal-title"),
  lessonVideoSidebarTitle: document.getElementById("lesson-video-sidebar-title"),
  lessonVideoSidebarMeta: document.getElementById("lesson-video-sidebar-meta"),
  lessonVideoFrame: document.getElementById("lesson-video-frame"),
  lessonVideoPlayerShell: document.querySelector(".lesson-video-player-shell"),
  lessonVideoZoomLayer: document.getElementById("lesson-video-zoom-layer"),
  lessonVideoZoomHint: document.getElementById("lesson-video-zoom-hint"),
  lessonVideoFullscreen: document.getElementById("lesson-video-fullscreen"),
  lessonVideoRotate: document.getElementById("lesson-video-rotate"),
  lessonVideoClose: document.getElementById("lesson-video-close"),
  materialsList: document.getElementById("materials-list"),
  attendanceCount: document.getElementById("attendance-count"),
  participationCount: document.getElementById("participation-count"),
  homeworkCount: document.getElementById("homework-count"),
  studentSwitcher: document.getElementById("student-switcher"),
  studentSwitcherList: document.getElementById("student-switcher-list"),
  studentSwitcherClose: document.getElementById("student-switcher-close"),
  activeStudentBar: document.getElementById("active-student-bar"),
  activeStudentName: document.getElementById("active-student-name"),
  changeStudentButton: document.getElementById("change-student-button"),
  levelScheduleCard: document.getElementById("level-schedule-card"),
  levelScheduleLevel: document.getElementById("level-schedule-level"),
  levelScheduleImageButton: document.getElementById("level-schedule-image-button"),
  levelScheduleImage: document.getElementById("level-schedule-image"),
  levelScheduleImageModal: document.getElementById("level-schedule-image-modal"),
  levelScheduleImageLarge: document.getElementById("level-schedule-image-large"),
  levelScheduleImageClose: document.getElementById("level-schedule-image-close"),
  paymentAccessModal: document.getElementById("payment-access-modal"),
  paymentAccessTitle: document.getElementById("payment-access-title"),
  paymentAccessHeadMessage: document.getElementById("payment-access-head-message"),
  paymentAccessMessage: document.getElementById("payment-access-message"),
  callTeacherNowButton: document.getElementById("call-teacher-now-btn"),
  upgradeSubjectButton: document.getElementById("upgrade-subject-btn"),
  declineRegistrationButton: document.getElementById("decline-registration-btn"),
  parentKpiSubscription: document.getElementById("parent-kpi-subscription"),
  parentKpiNextClass: document.getElementById("parent-kpi-next-class"),
  parentKpiRating: document.getElementById("parent-kpi-rating"),
  parentSidebar: document.getElementById("parent-sidebar"),
  parentSidebarBackdrop: document.getElementById("parent-sidebar-backdrop"),
  parentSidebarToggle: document.getElementById("parent-sidebar-toggle"),
  parentSidebarClose: document.getElementById("parent-sidebar-close"),
  parentSidebarLogout: document.getElementById("parent-sidebar-logout"),
  parentEmailForm: document.getElementById("parent-email-form"),
  parentAccountEmail: document.getElementById("parent-account-email"),
  parentEmailStatus: document.getElementById("parent-email-status"),
  parentNavLinks: Array.from(document.querySelectorAll(".parent-nav-link")),
  documentFeedbackModal: document.getElementById("document-feedback-modal"),
  documentFeedbackTitle: document.getElementById("document-feedback-title"),
  documentFeedbackMessage: document.getElementById("document-feedback-message"),
  documentFeedbackClose: document.getElementById("document-feedback-close"),
  sofizpayInstructionModal: document.getElementById("sofizpay-instruction-modal"),
  sofizpayInstructionContinue: document.getElementById("sofizpay-instruction-continue"),
  sofizpayInstructionCancel: document.getElementById("sofizpay-instruction-cancel"),
};

let socket = null;
let currentStudent = null;
let globalFreeClassActive = false;
let lessonRepositoryOpen = false;
let studentCertificatesOpen = false;
let studentHomeworkOpen = false;
let certificateImageUrls = new Set();
let homeworkFileObjectUrl = null;
const homeworkFilePointers = new Map();
let homeworkFileScale = 1;
let homeworkFilePanX = 0;
let homeworkFilePanY = 0;
let homeworkFilePinchDistance = 0;
let homeworkFilePinchScale = 1;
let homeworkFilePanStart = null;

function scrollExpandedPanel(panel) {
  if (!panel || panel.hidden) return;
  window.setTimeout(() => {
    const header = document.querySelector(".parent-header");
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const panelHeight = panel.getBoundingClientRect().height;
    const canCenter = panelHeight > 0 && panelHeight <= window.innerHeight * 0.86;
    panel.scrollIntoView({ behavior: "smooth", block: canCenter ? "center" : "start", inline: "nearest" });
    if (!canCenter && headerHeight > 0) {
      window.setTimeout(() => window.scrollBy({ top: -(headerHeight + 12), behavior: "smooth" }), 80);
    }
  }, 90);
}

window.focusExpandedParentPanel = scrollExpandedPanel;

function revokeCertificateImageUrls() {
  certificateImageUrls.forEach((url) => URL.revokeObjectURL(url));
  certificateImageUrls = new Set();
}

function setStudentCertificatesOpen(nextOpen) {
  studentCertificatesOpen = Boolean(nextOpen);
  if (elements.studentCertificatesContent) elements.studentCertificatesContent.hidden = !studentCertificatesOpen;
  elements.studentCertificatesCard?.classList.toggle("is-open", studentCertificatesOpen);
  elements.studentCertificatesToggle?.setAttribute("aria-expanded", String(studentCertificatesOpen));
  if (elements.studentCertificatesToggleIcon) elements.studentCertificatesToggleIcon.textContent = studentCertificatesOpen ? "⌃" : "⌄";
  if (studentCertificatesOpen) scrollExpandedPanel(elements.studentCertificatesCard);
}

function syncStudentCertificatesVisibility(student) {
  const shouldShow = Boolean(student);
  if (elements.studentCertificatesCard) elements.studentCertificatesCard.hidden = !shouldShow;
  if (!shouldShow) elements.studentCertificatesList?.replaceChildren();
  setStudentCertificatesOpen(false);
}

function setStudentHomeworkOpen(nextOpen) {
  studentHomeworkOpen = Boolean(nextOpen);
  if (elements.studentHomeworkContent) elements.studentHomeworkContent.hidden = !studentHomeworkOpen;
  elements.studentHomeworkCard?.classList.toggle("is-open", studentHomeworkOpen);
  elements.studentHomeworkToggle?.setAttribute("aria-expanded", String(studentHomeworkOpen));
  if (elements.studentHomeworkToggleIcon) elements.studentHomeworkToggleIcon.textContent = studentHomeworkOpen ? "⌃" : "⌄";
  if (studentHomeworkOpen) scrollExpandedPanel(elements.studentHomeworkCard);
}

function syncStudentHomeworkVisibility(student) {
  const shouldShow = Boolean(student);
  if (elements.studentHomeworkCard) elements.studentHomeworkCard.hidden = !shouldShow;
  if (!shouldShow) elements.studentHomeworkList?.replaceChildren();
  setStudentHomeworkOpen(false);
}

function homeworkSubjectLabel(subject) {
  return subject === "PHYSICS" ? "الفيزياء" : subject === "MATH" ? "الرياضيات" : subject || "عام";
}

function homeworkStatusMeta(submission) {
  if (!submission) return { label: "لم يُرسل الحل بعد", className: "status-pending" };
  if (submission.status === "RECEIVED") return { label: "تم تأكيد استلام الحل", className: "status-received" };
  if (submission.status === "GRADED") return { label: "تم التصحيح", className: "status-graded" };
  return { label: "تم إرسال الحل", className: "status-submitted" };
}

function formatHomeworkDueDate(value) {
  if (!value) return "دون تاريخ تسليم";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `آخر أجل: ${new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium", timeZone: "Africa/Algiers" }).format(date)}`
    : "تاريخ التسليم غير صالح";
}

function showHomeworkEmptyState(message) {
  const empty = document.createElement("p");
  empty.className = "student-homework-empty";
  empty.textContent = message;
  return empty;
}

function resetHomeworkFileTransform() {
  homeworkFileScale = 1;
  homeworkFilePanX = 0;
  homeworkFilePanY = 0;
  homeworkFilePinchDistance = 0;
  homeworkFilePinchScale = 1;
  homeworkFilePanStart = null;
  if (elements.studentHomeworkFileImage) {
    elements.studentHomeworkFileImage.style.transform = "translate3d(0, 0, 0) scale(1)";
  }
}

function applyHomeworkFileTransform() {
  if (!elements.studentHomeworkFileImage) return;
  elements.studentHomeworkFileImage.style.transform = `translate3d(${homeworkFilePanX}px, ${homeworkFilePanY}px, 0) scale(${homeworkFileScale})`;
}

function closeStudentHomeworkFile() {
  elements.studentHomeworkFileModal?.classList.remove("is-open");
  if (elements.studentHomeworkFileModal) elements.studentHomeworkFileModal.hidden = true;
  if (homeworkFileObjectUrl?.startsWith("blob:")) URL.revokeObjectURL(homeworkFileObjectUrl);
  homeworkFileObjectUrl = null;
  homeworkFilePointers.clear();
  resetHomeworkFileTransform();
  if (elements.studentHomeworkFileImage) {
    elements.studentHomeworkFileImage.removeAttribute("src");
    elements.studentHomeworkFileImage.hidden = true;
  }
  if (elements.studentHomeworkFileFrame) {
    elements.studentHomeworkFileFrame.src = "about:blank";
    elements.studentHomeworkFileFrame.hidden = true;
  }
  document.body.style.overflow = "";
}

function getHomeworkFilePointerDistance() {
  const points = [...homeworkFilePointers.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function handleHomeworkFilePointerDown(event) {
  if (!elements.studentHomeworkFileImage || elements.studentHomeworkFileImage.hidden) return;
  event.preventDefault();
  homeworkFilePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  elements.studentHomeworkFileImage.setPointerCapture?.(event.pointerId);
  if (homeworkFilePointers.size === 2) {
    homeworkFilePinchDistance = getHomeworkFilePointerDistance();
    homeworkFilePinchScale = homeworkFileScale;
    homeworkFilePanStart = null;
  } else if (homeworkFilePointers.size === 1) {
    homeworkFilePanStart = { x: event.clientX, y: event.clientY, panX: homeworkFilePanX, panY: homeworkFilePanY };
  }
}

function handleHomeworkFilePointerMove(event) {
  if (!homeworkFilePointers.has(event.pointerId)) return;
  event.preventDefault();
  homeworkFilePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (homeworkFilePointers.size >= 2 && homeworkFilePinchDistance > 0) {
    const distance = getHomeworkFilePointerDistance();
    homeworkFileScale = Math.min(4, Math.max(1, homeworkFilePinchScale * (distance / homeworkFilePinchDistance)));
    applyHomeworkFileTransform();
    return;
  }
  if (homeworkFilePointers.size === 1 && homeworkFilePanStart && homeworkFileScale > 1) {
    homeworkFilePanX = homeworkFilePanStart.panX + event.clientX - homeworkFilePanStart.x;
    homeworkFilePanY = homeworkFilePanStart.panY + event.clientY - homeworkFilePanStart.y;
    applyHomeworkFileTransform();
  }
}

function handleHomeworkFilePointerUp(event) {
  homeworkFilePointers.delete(event.pointerId);
  if (homeworkFilePointers.size < 2) homeworkFilePinchDistance = 0;
  if (homeworkFilePointers.size === 1) {
    const point = [...homeworkFilePointers.values()][0];
    homeworkFilePanStart = { x: point.x, y: point.y, panX: homeworkFilePanX, panY: homeworkFilePanY };
  } else if (!homeworkFilePointers.size) {
    homeworkFilePanStart = null;
  }
}

function readHomeworkBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("تعذر تجهيز صورة الواجب للعرض."));
    reader.readAsDataURL(blob);
  });
}

function homeworkFileMeta(assignment, source = "attachment") {
  const instruction = source === "instruction";
  return {
    url: instruction ? `/api/academic/assignments/${encodeURIComponent(assignment.id)}/instruction-image` : (assignment.attachmentUrl || `/api/academic/assignments/${encodeURIComponent(assignment.id)}/file`),
    mimeType: instruction ? assignment.instructionImageMimeType : assignment.attachmentMimeType,
    originalName: instruction ? assignment.instructionImageOriginalName : assignment.attachmentOriginalName,
  };
}

function resolveHomeworkFileMimeType(assignment, response, source = "attachment") {
  const meta = homeworkFileMeta(assignment, source);
  const responseType = String(response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  const storedType = String(meta.mimeType || "").split(";", 1)[0].trim().toLowerCase();
  const filename = String(meta.originalName || "").toLowerCase();
  const extensionTypes = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif", pdf: "application/pdf" };
  const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1];
  return storedType && storedType !== "application/octet-stream"
    ? storedType
    : extensionTypes[extension] || (responseType && responseType !== "application/octet-stream" ? responseType : "application/octet-stream");
}

async function fetchHomeworkPreview(assignment, source = "attachment") {
  const meta = homeworkFileMeta(assignment, source);
  const response = await parentFetch(meta.url, { headers: { Accept: "*/*" } });
  if (!response.ok) throw new Error("تعذر فتح صورة الواجب.");
  const mimeType = resolveHomeworkFileMimeType(assignment, response, source);
  const fileBytes = await response.arrayBuffer();
  const blob = new Blob([fileBytes], { type: mimeType });
  const isImage = mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(meta.originalName || "");
  const isPdf = mimeType.includes("pdf") || /\.pdf$/i.test(meta.originalName || "");
  const url = isImage ? await readHomeworkBlobAsDataUrl(blob) : URL.createObjectURL(blob);
  return { url, mimeType, isImage, isPdf };
}

async function openStudentHomeworkFile(assignment, source = "attachment") {
  if (!assignment?.id || !elements.studentHomeworkFileModal) return;
  try {
    closeStudentHomeworkFile();
    const { url, mimeType, isImage, isPdf } = await fetchHomeworkPreview(assignment, source);
    homeworkFileObjectUrl = url;
    if (elements.studentHomeworkFileTitle) elements.studentHomeworkFileTitle.textContent = assignment.title || "معاينة الواجب";
    if (elements.studentHomeworkFileImage) {
      elements.studentHomeworkFileImage.hidden = !isImage;
      if (isImage) elements.studentHomeworkFileImage.src = homeworkFileObjectUrl;
    }
    if (elements.studentHomeworkFileFrame) {
      elements.studentHomeworkFileFrame.hidden = isImage;
      if (!isImage) elements.studentHomeworkFileFrame.src = homeworkFileObjectUrl;
    }
    if (elements.studentHomeworkFileHint) {
      elements.studentHomeworkFileHint.textContent = isImage
        ? "اضغط بإصبعين للتكبير والتحريك."
        : isPdf
          ? "يُعرض ملف PDF داخل المنصة. استخدم أدوات العرض للتكبير والتمرير."
          : "يُعرض الملف داخل المنصة حسب دعم المتصفح لهذا النوع من الملفات.";
    }
    resetHomeworkFileTransform();
    elements.studentHomeworkFileModal.hidden = false;
    elements.studentHomeworkFileModal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    elements.studentHomeworkFileClose?.focus();
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) openDocumentFeedback(error.message || "تعذر فتح ملف الواجب.");
  }
}

async function submitHomeworkSolution(assignmentId, form, submitButton) {
  if (!assignmentId || !currentStudent) return;
  const file = form.querySelector('input[type="file"]')?.files?.[0];
  if (!file) {
    openDocumentFeedback("صوّر الحل أو اختر صورة له قبل الإرسال.", "صورة الحل ناقصة");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  if (submitButton) submitButton.disabled = true;
  try {
    const response = await parentFetch(`/api/academic/students/${encodeURIComponent(currentStudent.id)}/assignments/${encodeURIComponent(assignmentId)}/submissions`, { method: "POST", body: formData });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر إرسال الحل.");
    openDocumentFeedback(payload.message || "تم إرسال الحل للأستاذ بنجاح.", "تم إرسال الحل");
    await loadStudentHomework(currentStudent.id);
    await loadActivityStats(currentStudent.id);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) openDocumentFeedback(error.message || "تعذر إرسال الحل.");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function renderStudentHomework(assignments = []) {
  if (!elements.studentHomeworkList) return;
  elements.studentHomeworkList.replaceChildren();
  if (!assignments.length) {
    elements.studentHomeworkList.append(showHomeworkEmptyState("لا توجد واجبات منشورة لهذا المستوى حالياً."));
    return;
  }

  assignments.forEach((assignment) => {
    const submission = Array.isArray(assignment.submissions) ? assignment.submissions[0] : null;
    const status = homeworkStatusMeta(submission);
    const item = document.createElement("article");
    item.className = "student-homework-item";

    const head = document.createElement("div");
    head.className = "student-homework-head";
    const statusBadge = document.createElement("span");
    statusBadge.className = `student-homework-status ${status.className}`;
    statusBadge.textContent = status.label;
    head.append(statusBadge);

    const subject = document.createElement("small");
    subject.className = "homework-subject";
    subject.textContent = homeworkSubjectLabel(assignment.subject);
    const descriptionText = assignment.description && assignment.description !== "صورة الواجب مرفقة داخل التعليمات." ? assignment.description : "";
    if (descriptionText) {
      const description = document.createElement("p");
      description.className = "student-homework-desc";
      description.textContent = descriptionText;
      item.append(description);
    }

    const zoomNote = document.createElement("div");
    zoomNote.className = "homework-zoom-notice";
    zoomNote.textContent = "كبّر الصورة بإصبعين";
    item.append(subject, zoomNote);

    if (assignment.instructionImageMimeType) {
      const instructionPreview = document.createElement("div");
      instructionPreview.className = "student-homework-instruction-image-wrap";
      const instructionImage = document.createElement("img");
      instructionImage.className = "student-homework-instruction-image";
      instructionImage.alt = "صورة الواجب؛ كبّرها بإصبعين";
      instructionImage.loading = "lazy";
      instructionImage.decoding = "async";
      instructionImage.draggable = false;
      instructionPreview.append(instructionImage);
      void fetchHomeworkPreview(assignment, "instruction").then(({ url, isImage }) => {
        if (isImage) instructionImage.src = url;
      }).catch(() => {
        instructionPreview.hidden = true;
      });
      item.append(instructionPreview);
    }

    if (!submission) {
      const solutionForm = document.createElement("form");
      solutionForm.className = "solution-capture-form";
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.setAttribute("capture", "environment");
      input.hidden = true;
      const captureButton = document.createElement("button");
      captureButton.type = "button";
      captureButton.className = "solution-capture-btn";
      captureButton.textContent = "تصوير الحل";
      captureButton.addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        if (input.files?.[0]) void submitHomeworkSolution(assignment.id, solutionForm, captureButton);
      });
      solutionForm.append(captureButton, input);
      item.append(solutionForm);
    } else if (submission.grade != null) {
      const grade = document.createElement("strong");
      grade.className = "homework-grade";
      grade.textContent = `العلامة: ${submission.grade}`;
      item.append(grade);
    }
    elements.studentHomeworkList.append(item);
  });
}

async function loadStudentHomework(studentId) {
  if (!elements.studentHomeworkList || !studentId) return;
  elements.studentHomeworkList.replaceChildren(showHomeworkEmptyState("جارٍ تحميل الواجبات…"));
  try {
    const response = await parentFetch(`/api/academic/students/${encodeURIComponent(studentId)}/assignments`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل الواجبات.");
    if (!currentStudent || currentStudent.id !== studentId) return;
    renderStudentHomework(Array.isArray(payload.data) ? payload.data : []);
  } catch (error) {
    if (/انتهت الجلسة/.test(error.message)) return;
    console.error("Unable to load student homework:", error);
    if (currentStudent?.id === studentId) elements.studentHomeworkList.replaceChildren(showHomeworkEmptyState("تعذر تحميل الواجبات حالياً."));
  }
}

function showCertificateEmptyState(message) {
  const empty = document.createElement("p");
  empty.className = "student-certificates-empty";
  empty.textContent = message;
  return empty;
}

function openCertificateImage(url, title) {
  if (!elements.studentCertificateModal || !elements.studentCertificateModalImage || !url) return;
  elements.studentCertificateModalImage.src = url;
  elements.studentCertificateModalImage.alt = title || "شهادة التلميذ";
  elements.studentCertificateModal.hidden = false;
  document.body.style.overflow = "hidden";
  elements.studentCertificateModalClose?.focus();
}

function closeCertificateImage() {
  if (elements.studentCertificateModal) elements.studentCertificateModal.hidden = true;
  if (elements.studentCertificateModalImage) elements.studentCertificateModalImage.removeAttribute("src");
  document.body.style.overflow = "";
}

function renderStudentCertificates(certificates) {
  if (!elements.studentCertificatesList) return;
  elements.studentCertificatesList.replaceChildren();
  if (!certificates.length) {
    elements.studentCertificatesList.append(showCertificateEmptyState("لم يحصل التلميذ على شهادات مضافة بعد. استمر في التقدم، وستظهر إنجازاتك هنا."));
    return;
  }

  certificates.forEach((certificate) => {
    const card = document.createElement("article");
    card.className = "student-certificate-card";
    const imageButton = document.createElement("button");
    imageButton.type = "button";
    imageButton.className = "student-certificate-image-button";
    imageButton.setAttribute("aria-label", `تكبير شهادة ${certificate.title}`);
    const image = document.createElement("img");
    image.src = certificate.imageObjectUrl || "";
    image.alt = certificate.title || "شهادة التلميذ";
    image.loading = "lazy";
    image.decoding = "async";
    imageButton.append(image);
    imageButton.addEventListener("click", () => openCertificateImage(certificate.imageObjectUrl, certificate.title));

    const copy = document.createElement("div");
    copy.className = "student-certificate-copy";
    const title = document.createElement("strong");
    title.textContent = certificate.title || "شهادة إنجاز";
    const date = document.createElement("time");
    date.dateTime = certificate.awardedAt || "";
    date.textContent = certificate.awardedAt
      ? `تاريخ الحصول عليها: ${new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium" }).format(new Date(certificate.awardedAt))}`
      : "شهادة إنجاز";
    copy.append(title, date);
    if (certificate.description) {
      const description = document.createElement("p");
      description.textContent = certificate.description;
      copy.append(description);
    }
    card.append(imageButton, copy);
    elements.studentCertificatesList.append(card);
  });
}

async function loadStudentCertificates(studentId) {
  if (!elements.studentCertificatesList || !studentId) return;
  revokeCertificateImageUrls();
  elements.studentCertificatesList.replaceChildren(showCertificateEmptyState("جارٍ تحميل شهادات التلميذ…"));
  try {
    const response = await parentFetch(`/api/certificates/student/${encodeURIComponent(studentId)}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل شهادات التلميذ.");
    if (!currentStudent || currentStudent.id !== studentId) return;
    const certificates = Array.isArray(payload.data) ? payload.data : [];
    for (const certificate of certificates) {
      try {
        const imageResponse = await parentFetch(certificate.imageUrl, { headers: { Accept: "image/*" } });
        if (!imageResponse.ok) continue;
        const imageUrl = URL.createObjectURL(await imageResponse.blob());
        certificate.imageObjectUrl = imageUrl;
        certificateImageUrls.add(imageUrl);
      } catch (error) {
        console.warn("Unable to load certificate image:", error);
      }
    }
    renderStudentCertificates(certificates.filter((certificate) => certificate.imageObjectUrl));
  } catch (error) {
    if (/انتهت الجلسة/.test(error.message)) return;
    console.error("Unable to load student certificates:", error);
    elements.studentCertificatesList.replaceChildren(showCertificateEmptyState("تعذر تحميل الشهادات حاليًا."));
  }
}
let currentStudents = [];
let currentLobbyLevel = null;
let paymentReturnRefreshTimer = null;
let activeLiveClassType = null;
let universityPaymentTransferRequested = false;
let secondaryPaymentTransferRequested = false;
let lessonVideoPreviousFocus = null;
let lessonZoomScale = 1;
let lessonZoomX = 0;
let lessonZoomY = 0;
let lessonZoomPointers = new Map();
let lessonZoomPinchStartDistance = 0;
let lessonZoomPinchStartScale = 1;
let lessonZoomPanStart = null;
let lessonUpgradeContext = null;
let paymentAccessUpgradeType = null;
let parentScheduledClasses = [];
let parentScheduleAdvanceTimer = null;
let parentNextClassStateTimer = null;
let parentScheduleLoading = false;
let parentScheduleError = "";
let parentTeacherAbsent = false;
let teacherAbsenceLevel = null;

const LEVEL_DISPLAY_LABELS = Object.freeze({
  "السنة الأولى": "السنة الأولى متوسط",
  "السنة الثانية": "السنة الثانية متوسط",
  "السنة الثالثة": "السنة الثالثة متوسط",
  "السنة الرابعة": "السنة الرابعة متوسط",
  "طالب جامعي": "طالب جامعي",
});

const LEVEL_SCHEDULE_IMAGES = Object.freeze({
  "السنة الأولى": "./assets/level-schedules/year-1.png",
  "السنة الثانية": "./assets/level-schedules/year-2.png",
  "السنة الثالثة": "./assets/level-schedules/year-3.png",
  "السنة الرابعة": "./assets/level-schedules/year-4.png",
});

function canonicalLevel(level) {
  const value = String(level || "").trim();
  const aliases = {
    "السنة الأولى متوسط": "السنة الأولى",
    "السنة الثانية متوسط": "السنة الثانية",
    "السنة الثالثة متوسط": "السنة الثالثة",
    "السنة الرابعة متوسط": "السنة الرابعة",
    "1am": "السنة الأولى",
    "2am": "السنة الثانية",
    "3am": "السنة الثالثة",
    "4am": "السنة الرابعة",
  };
  return aliases[value] || aliases[value.toLowerCase()] || value;
}

function displayLevelLabel(level) {
  return LEVEL_DISPLAY_LABELS[level] || level || "—";
}

function clearParentSession() {
  [
    PARENT_TOKEN_KEY,
    "parentPhone",
    "studentName",
    "level",
    "studentLevel",
    "studentId",
    "currentStudent",
    "student",
    "loggedInStudent",
    "selectedStudentId",
    "parentStudents",
    "userRole",
    "studentMicPreflight",
  ].forEach((key) => sessionStorage.removeItem(key));
}

function redirectToParentLogin() {
  clearParentSession();
  window.location.replace("./parent-login.html");
}

function getParentToken() {
  const token = sessionStorage.getItem(PARENT_TOKEN_KEY);

  if (!token) {
    redirectToParentLogin();
    return null;
  }

  return token;
}

function showError(message = "") {
  if (!elements.dashboardError) {
    return;
  }

  elements.dashboardError.textContent = message;
  elements.dashboardError.classList.toggle("is-visible", Boolean(message));
}

function clearError() {
  showError();
}

function openDocumentFeedback(message, title = "تعذر إتمام العملية") {
  if (!elements.documentFeedbackModal) {
    showError(message);
    return;
  }
  if (elements.documentFeedbackTitle) elements.documentFeedbackTitle.textContent = title;
  if (elements.documentFeedbackMessage) elements.documentFeedbackMessage.textContent = String(message || "تعذر إتمام العملية.");
  elements.documentFeedbackModal.hidden = false;
  elements.documentFeedbackModal.classList.add("is-open");
  elements.documentFeedbackClose?.focus();
}

function closeDocumentFeedback() {
  elements.documentFeedbackModal?.classList.remove("is-open");
  if (elements.documentFeedbackModal) elements.documentFeedbackModal.hidden = true;
}

function isValidPaymentReceiptImage(file) {
  // Keep the browser permissive; the server validates image/PDF bytes safely.
  return Boolean(file && file.size > 0);
}

function isPaymentReceiptFile(file) {
  return Boolean(file && file.size > 0);
}

function updatePaymentReceiptFileName(input, label) {
  if (!label) return;
  const file = input?.files?.[0];
  label.textContent = file ? `تم اختيار: ${file.name}` : "لم يتم اختيار وصل الدفع";
}

function openPaymentReceiptPicker(input, mode = "upload") {
  if (!input) return;
  if (mode === "capture") {
    input.setAttribute("capture", "environment");
  } else {
    input.removeAttribute("capture");
  }
  input.click();
}

async function startSofizPayPayment(subscriptionTypeOverride = "") {
  const subscriptionType = subscriptionTypeOverride || elements.secondarySubscriptionType?.value;
  if (subscriptionTypeOverride && elements.secondarySubscriptionType) {
    elements.secondarySubscriptionType.value = subscriptionTypeOverride;
  }
  if (!currentStudent) {
    openDocumentFeedback("تعذر تحديد حساب التلميذ الحالي. أعد فتح لوحة الولي وحاول مرة أخرى.", "تعذر تحديد الحساب");
    return;
  }
  if (!["BOTH", "MATH", "PHYSICS"].includes(subscriptionType)) {
    openDocumentFeedback("اختر الرياضيات أو الفيزياء أو المادتين معًا قبل الضغط على الدفع الإلكتروني.", "اختر نوع الاشتراك");
    elements.secondarySubscriptionType?.focus();
    return;
  }

  const button = subscriptionTypeOverride ? elements.upgradeSubjectButton : elements.secondaryCardPaymentButton;
  const originalLabel = button?.textContent || "الدفع بالبطاقة الذهبية أو البنكية";
  if (button) {
    button.disabled = true;
    button.textContent = "جارٍ تجهيز رابط الدفع…";
  }

  try {
    const response = await parentFetch("/api/payments/sofizpay/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: currentStudent.id, subscriptionType }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.data?.paymentUrl) {
      throw new Error(payload.error || "تعذر تجهيز رابط الدفع الإلكتروني.");
    }
    sessionStorage.setItem("sofizpayPendingOrder", JSON.stringify({
      internalOrderId: payload.data.internalOrderId,
      subscriptionType,
      studentId: currentStudent.id,
    }));
    window.location.assign(payload.data.paymentUrl);
  } catch (error) {
    openDocumentFeedback(error.message || "تعذر بدء الدفع الإلكتروني حاليًا.", "تعذر بدء الدفع");
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function showCardPaymentNotice() {
  openDocumentFeedback(
    "الدفع الإلكتروني للطالب الجامعي غير متاح بهذه الخطة حاليًا. يمكنك إرسال وصل الدفع ليؤكده الأستاذ.",
    "الدفع بالبطاقة الذهبية أو البنكية"
  );
}

function closeSofizPayInstruction() {
  if (elements.sofizpayInstructionModal) elements.sofizpayInstructionModal.hidden = true;
}

function openSofizPayInstruction() {
  if (!elements.sofizpayInstructionModal) {
    void startSofizPayPayment();
    return;
  }
  elements.sofizpayInstructionModal.hidden = false;
  elements.sofizpayInstructionContinue?.focus();
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function checkSofizPayReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") !== "sofizpay") return;
  const subscriptionType = params.get("subscription");
  const returnedInternalOrderId = params.get("internal_order_id") || params.get("invoice_id") || params.get("order_id") || "";
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem("sofizpayPendingOrder") || "null");
  } catch {
    pending = null;
  }
  const internalOrderId = returnedInternalOrderId || pending?.internalOrderId || "";
  if (!internalOrderId || (pending?.subscriptionType && pending.subscriptionType !== subscriptionType) || (currentStudent?.id && pending?.studentId && pending.studentId !== currentStudent.id)) {
    openDocumentFeedback("تعذر ربط العودة بطلب الدفع الخاص بهذا الحساب. أعد اختيار الاشتراك من بوابة الولي.", "تعذر مطابقة الدفع");
    return;
  }

  const providerOrderNumber = params.get("order_number") || params.get("cib_transaction_id") || params.get("orderNumber") || params.get("order") || "";
  const query = new URLSearchParams({ internal_order_id: internalOrderId });
  if (providerOrderNumber) query.set("order_number", providerOrderNumber);

  let result = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await parentFetch(`/api/payments/sofizpay/status?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "تعذر التحقق من الدفع.");
      result = payload.data;
      if (result?.paymentStatus !== "PENDING") break;
      if (attempt < 14) await sleep(2000);
    } catch (error) {
      openDocumentFeedback(error.message || "تعذر التحقق من عملية الدفع.", "نتيجة الدفع الإلكتروني");
      return;
    }
  }

  const terminal = result?.paymentStatus === "PAID" || result?.paymentStatus === "FAILED";
  if (result?.paymentStatus === "PAID") {
    sessionStorage.removeItem("sofizpayPendingOrder");
    await loadDashboard({ backgroundRefresh: true });
    const hasBothSubjects = Boolean(currentStudent?.mathEnrollment && currentStudent?.physicsEnrollment);
    const paidSubscriptionMessages = {
      MATH: "مبروك انضمامك إلى الأستاذ شارف عزالدين. تم الدفع بنجاح وتفعيل مادة الرياضيات.",
      PHYSICS: "مبروك انضمامك إلى الأستاذ شارف عزالدين. تم الدفع بنجاح وتفعيل مادة الفيزياء.",
      BOTH: "مبروك انضمامك إلى الأستاذ شارف عزالدين. تم الدفع بنجاح وتفعيل مادتي الرياضيات والفيزياء.",
    };
    const paidMessage = hasBothSubjects
      ? "مبروك انضمامك إلى الأستاذ شارف عزالدين. تم الدفع بنجاح، وأصبح اشتراكك وصلاحيتك مفعّلين في الرياضيات والفيزياء معًا."
      : paidSubscriptionMessages[result.subscriptionType] || result.message || "مبروك، تم تأكيد الدفع وتحديث حسابك بنجاح.";
    openDocumentFeedback(paidMessage, "مبروك، تم تأكيد الدفع");
  } else if (result?.paymentStatus === "FAILED") {
    openDocumentFeedback(result.message || "لم يتم تأكيد عملية الدفع.", "لم يكتمل الدفع");
    sessionStorage.removeItem("sofizpayPendingOrder");
  } else {
    openDocumentFeedback(result?.message || "لم تصلنا بعد بيانات المعاملة من SofizPay. أعد فتح الرابط بعد لحظات.", "الدفع قيد التحقق");
  }

  if (terminal) {
    params.delete("payment");
    params.delete("subscription");
    params.delete("order_number");
    params.delete("cib_transaction_id");
    params.delete("orderNumber");
    params.delete("order");
    const cleanQuery = params.toString();
    window.history.replaceState({}, document.title, `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${window.location.hash}`);
  }
}

function setPaymentReceiptChoiceMenu(menu, toggle, open) {
  if (menu) menu.hidden = !open;
  toggle?.setAttribute("aria-expanded", String(open));
}

function wirePaymentReceiptActions({ input, captureButton, fileChoiceButton, uploadButton, choiceMenu, fileName, cardPaymentButton, submitAfterCapture, onCardPayment = showCardPaymentNotice }) {
  let selectionMode = "upload";

  uploadButton?.addEventListener("click", () => {
    const isOpen = choiceMenu ? choiceMenu.hidden : true;
    setPaymentReceiptChoiceMenu(choiceMenu, uploadButton, isOpen);
  });
  captureButton?.addEventListener("click", () => {
    selectionMode = "capture";
    setPaymentReceiptChoiceMenu(choiceMenu, uploadButton, false);
    openPaymentReceiptPicker(input, "capture");
  });
  fileChoiceButton?.addEventListener("click", () => {
    selectionMode = "upload";
    setPaymentReceiptChoiceMenu(choiceMenu, uploadButton, false);
    openPaymentReceiptPicker(input, "upload");
  });
  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file && !isPaymentReceiptFile(file)) {
      input.value = "";
      updatePaymentReceiptFileName(input, fileName);
      openDocumentFeedback("اختر صورة أو ملف PDF صالحًا لوصل الدفع.", "ملف الوصل غير صالح");
      return;
    }
    updatePaymentReceiptFileName(input, fileName);
    if (selectionMode === "capture" && file) {
      void submitAfterCapture?.();
    }
  });
  cardPaymentButton?.addEventListener("click", () => { void onCardPayment?.(); });
}

function openPaymentAccessModal(reason = "access", subjectOverride = null) {
  if (!elements.paymentAccessModal) return;

  const subscriptionUpgrade = reason === "subscription-upgrade";
  const subjectUpgrade = reason === "subject-upgrade";
  const lessonUpgrade = reason.startsWith("lesson-");
  const lessonFreeOnly = reason === "lesson-free-only";
  const targetSubject = subjectOverride || (subjectUpgrade ? activeLiveClassType : null)
    || (reason === "lesson-math-only" ? "PHYSICS" : null)
    || (reason === "lesson-physics-only" ? "MATH" : null);
  paymentAccessUpgradeType = ["MATH", "PHYSICS"].includes(targetSubject) ? targetSubject : null;
  if (!lessonUpgrade) lessonUpgradeContext = null;

  const targetLabel = targetSubject === "PHYSICS" ? "الفيزياء" : "الرياضيات";
  const currentSubscription = currentStudent?.mathEnrollment && !currentStudent?.physicsEnrollment
    ? "الرياضيات فقط"
    : currentStudent?.physicsEnrollment && !currentStudent?.mathEnrollment
      ? "الفيزياء فقط"
      : "الاشتراك الحالي";

  if (elements.paymentAccessTitle) {
    elements.paymentAccessTitle.textContent = lessonUpgrade
      ? reason === "lesson-unpaid"
        ? "أنت غير مشترك حالياً"
        : lessonFreeOnly
          ? "هذا الدرس مخصص للاشتراك المدفوع"
          : `هذا الدرس في ${targetLabel}`
      : subjectUpgrade
        ? `هذا المحتوى مخصص لـ${targetLabel}`
        : subscriptionUpgrade
          ? "هذه الحصة مخصصة للاشتراك المدفوع"
          : "الدخول للحصة يحتاج إلى تفعيل";
  }
  if (elements.paymentAccessHeadMessage) {
    elements.paymentAccessHeadMessage.textContent = targetSubject && currentStudent
      ? `أنت مسجل في ${currentSubscription}، وهذا المحتوى مخصص لـ${targetLabel}.`
      : lessonUpgrade && reason === "lesson-unpaid"
        ? "أنت لست مشتركاً حاليًا، وحسابك مجاني."
        : subscriptionUpgrade
          ? "أنت مشترك في الحساب المجاني فقط وهذه الحصة مخصصة للاشتراك المدفوع."
          : "لم يتم تفعيل صلاحية الدخول إلى هذا المحتوى بعد.";
  }
  if (elements.paymentAccessMessage) {
    elements.paymentAccessMessage.textContent = targetSubject
      ? `للتسجيل في ${targetLabel} مع الاحتفاظ باشتراكك الحالي، اختر الدفع الإلكتروني أو الوعد بالدفع مع الأستاذ.`
      : lessonUpgrade
        ? "للوصول إلى هذا الدرس، استخدم زر الترقية أو اتصل بالأستاذ للوعد بالدفع."
        : "اختر طريقة تفعيل الوصول إلى الحصة.";
  }
  if (elements.upgradeSubjectButton) {
    elements.upgradeSubjectButton.hidden = !paymentAccessUpgradeType;
    elements.upgradeSubjectButton.textContent = paymentAccessUpgradeType
      ? `ترقية حسابي والتسجيل في ${targetLabel}`
      : "ترقية حسابي";
    elements.upgradeSubjectButton.href = "#";
  }
  if (elements.callTeacherNowButton) {
    elements.callTeacherNowButton.textContent = "اتصل بالأستاذ للوعد بالدفع";
    elements.callTeacherNowButton.href = "tel:0556960950";
  }

  elements.paymentAccessModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function openLessonUpgradeModal(video) {
  lessonUpgradeContext = video || null;
  const reason = video?.accessReason === "UNPAID"
    ? "lesson-unpaid"
    : video?.accessReason === "MATH_ONLY"
      ? "lesson-math-only"
      : video?.accessReason === "PHYSICS_ONLY"
        ? "lesson-physics-only"
        : "lesson-free-only";
  const subject = video?.repositoryType === "PHYSICS" || video?.repositoryType === "MATH" ? video.repositoryType : null;
  openPaymentAccessModal(reason, subject);
}

function closePaymentAccessModal() {
  if (!elements.paymentAccessModal) {
    return;
  }

  elements.paymentAccessModal.hidden = true;
  document.body.style.overflow = "";
}

function setLiveClassVisible(isVisible, liveData = {}) {
  const visible = Boolean(isVisible);
  elements.liveBanner?.classList.toggle("is-visible", visible);

  if (visible && elements.liveBannerDetails) {
    const levelLabel = liveData.globalFree ? "جميع المستويات" : displayLevelLabel(liveData.level || currentStudent?.level);
    const subjectLabel = liveData.globalFree ? "حصة مجانية مفتوحة للجميع" : homeworkSubjectLabel(
      liveData.subject || activeLiveClassType || ""
    );
    elements.liveBannerDetails.textContent = `${levelLabel} — ${subjectLabel} — يمكنك الدخول الآن`;
  } else if (!visible && elements.liveBannerDetails) {
    elements.liveBannerDetails.textContent = "يمكن لابنك الانضمام إلى البث الخاص بمستواه الدراسي.";
  }

  renderParentSchedule();
}

function getInitials(name) {
  const words = String(name || "تلميذ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (
    words
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join("") || "ت"
  );
}

function renderStudentSwitcher(students) {
  if (!elements.studentSwitcher || !elements.studentSwitcherList) {
    return;
  }

  const hasMultipleStudents = students.length > 1;
  elements.studentSwitcher.hidden = !hasMultipleStudents;
  elements.studentSwitcherList.replaceChildren();

  if (!hasMultipleStudents) {
    return;
  }

  for (const student of students) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "student-switcher-card student-switcher-tab";
    button.setAttribute("role", "listitem");
    button.classList.toggle("is-active", currentStudent?.id === student.id);
    button.setAttribute(
      "aria-label",
      `عرض ملف التلميذ ${student.studentName}، ${displayLevelLabel(student.level)}`
    );

    const avatar = document.createElement("span");
    avatar.className = "student-switcher-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = getInitials(student.studentName);

    const copy = document.createElement("span");
    copy.className = "student-switcher-card-copy";

    const name = document.createElement("strong");
    name.textContent = student.studentName;
    const level = document.createElement("small");
    level.textContent = displayLevelLabel(student.level);
    copy.append(name, level);

    const check = document.createElement("span");
    check.className = "student-switcher-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";

    button.append(avatar, copy, check);
    button.addEventListener("click", () => selectStudent(student.id));
    elements.studentSwitcherList.append(button);
  }
}

function scheduleTypeLabel(level, subject) {
  const labels = level === "طالب جامعي"
    ? { PAID: "اشتراك مدفوع", FREE: "اشتراك مجاني" }
    : { MATH: "الرياضيات", PHYSICS: "الفيزياء", FREE: "حصة مجانية" };
  return labels[subject] || "حصة مبرمجة";
}

function formatParentScheduleDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "توقيت غير صالح";
  return new Intl.DateTimeFormat("ar-DZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  }).format(date);
}

function getNextParentScheduledClass() {
  const now = Date.now();
  if (activeLiveClassType) {
    const liveScheduledClass = parentScheduledClasses
      .filter((scheduledClass) => scheduledClass?.subject === activeLiveClassType)
      .map((scheduledClass) => ({ scheduledClass, timestamp: new Date(scheduledClass.scheduledAt).getTime() }))
      .filter(({ timestamp }) => Number.isFinite(timestamp) && Math.abs(timestamp - now) <= 3 * 60 * 60 * 1000)
      .sort((left, right) => Math.abs(left.timestamp - now) - Math.abs(right.timestamp - now))[0]?.scheduledClass;
    return liveScheduledClass
      ? { ...liveScheduledClass, isLiveNow: true }
      : { id: `live-${currentStudent?.level || "level"}-${activeLiveClassType}`, subject: activeLiveClassType, scheduledAt: null, isLiveNow: true };
  }

  return parentScheduledClasses
    .filter((scheduledClass) => {
      const timestamp = new Date(scheduledClass?.scheduledAt).getTime();
      return Number.isFinite(timestamp) && timestamp > now;
    })
    .sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime())[0] || null;
}

function scheduleParentScheduleAdvance(nextClass) {
  window.clearTimeout(parentScheduleAdvanceTimer);
  parentScheduleAdvanceTimer = null;
  if (!nextClass) return;
  const timestamp = new Date(nextClass.scheduledAt).getTime();
  const delay = timestamp - Date.now();
  if (!Number.isFinite(delay) || delay <= 0) return;
  parentScheduleAdvanceTimer = window.setTimeout(() => {
    parentScheduleAdvanceTimer = null;
    renderParentSchedule();
  }, delay + 100);
}

function getLiveClassesEntrySubject(student, nextClass) {
  if (nextClass?.subject) return nextClass.subject;
  if (student?.mathEnrollment && student?.physicsEnrollment) return "BOTH";
  if (student?.physicsEnrollment) return "PHYSICS";
  if (student?.mathEnrollment) return "MATH";
  return "";
}

function openLiveClassesEntryPage() {
  if (!currentStudent) return;
  const nextClass = getNextParentScheduledClass();
  const params = new URLSearchParams({
    studentId: currentStudent.id || "",
    studentName: currentStudent.studentName || "",
    level: currentStudent.level || "",
    subject: getLiveClassesEntrySubject(currentStudent, nextClass),
    scheduledAt: nextClass?.scheduledAt || "",
  });
  persistStudentSession(currentStudent);
  window.location.assign(`./student-live-times-level.html?${params.toString()}`);
}

function renderLiveClassesEntry(nextClass) {
  if (!elements.liveClassesEntryCard) return;
  const hasStudent = Boolean(currentStudent);
  const isLiveNow = Boolean(activeLiveClassType || globalFreeClassActive);
  elements.liveClassesEntryCard.hidden = !hasStudent || isLiveNow;
  if (elements.liveClassesWaitingPanel) elements.liveClassesWaitingPanel.hidden = true;
  if (!hasStudent || isLiveNow) return;

  const subject = getLiveClassesEntrySubject(currentStudent, nextClass);
  if (elements.liveClassesEntryCaption) {
    elements.liveClassesEntryCaption.textContent = `${displayLevelLabel(currentStudent.level)} — ${scheduleTypeLabel(currentStudent.level, subject)}`;
  }
  if (elements.liveClassesEntryButton) {
    elements.liveClassesEntryButton.disabled = false;
    elements.liveClassesEntryButton.title = "فتح صفحة انتظار الحصة المباشرة";
  }
}

function renderParentSchedule() {
  const nextClass = getNextParentScheduledClass();
  renderLiveClassesEntry(nextClass);
  scheduleParentScheduleAdvance(nextClass);
  if (elements.parentScheduleCard) {
    elements.parentScheduleCard.hidden = true;
    elements.parentScheduleCard.setAttribute("aria-hidden", "true");
  }
  const isLiveNow = Boolean(activeLiveClassType);
  if (elements.parentNextClassStatus) {
    elements.parentNextClassStatus.textContent = isLiveNow
      ? "الحصة مفتوحة الآن"
      : "حسب برنامج المستوى";
    elements.parentNextClassStatus.classList.toggle("is-live", isLiveNow);
  }
  if (elements.parentNextClassState) {
    window.clearTimeout(parentNextClassStateTimer);
    parentNextClassStateTimer = null;
    const showClosedState = Boolean(nextClass) && !isLiveNow;
    const showLiveTransition = Boolean(nextClass) && isLiveNow;
    elements.parentNextClassState.hidden = !(showClosedState || showLiveTransition);
    elements.parentNextClassState.classList.toggle("is-closed", showClosedState);
    elements.parentNextClassState.classList.toggle("is-live", showLiveTransition);
    if (showClosedState) {
      elements.parentNextClassStateTitle.textContent = "الحصة غير مفتوحة بعد";
      elements.parentNextClassStateCopy.textContent = "سيبقى المؤشر أحمر حتى يفتح الأستاذ الحصة، ثم تصبح حالة الدخول زرقاء ومفعلة.";
    } else if (showLiveTransition) {
      elements.parentNextClassStateTitle.textContent = "الحصة مفتوحة الآن";
      elements.parentNextClassStateCopy.textContent = "تحول المؤشر إلى الأزرق. يمكنك الدخول من الزر أدناه.";
      parentNextClassStateTimer = window.setTimeout(() => {
        elements.parentNextClassState.hidden = true;
        elements.parentNextClassState.classList.remove("is-live");
      }, 1600);
    }
  }
  const isAbsenceForCurrentStudent = Boolean(
    parentTeacherAbsent &&
    currentStudent &&
    canonicalLevel(teacherAbsenceLevel) === canonicalLevel(currentStudent.level)
  );
  if (elements.teacherAbsenceNotice) {
    elements.teacherAbsenceNotice.hidden = !isAbsenceForCurrentStudent;
  }
  if (elements.parentKpiNextClass) {
    elements.parentKpiNextClass.textContent = nextClass
      ? scheduleTypeLabel(currentStudent?.level, nextClass.subject)
      : "لا توجد";
  }
  if (!elements.parentScheduleList) return;
  elements.parentScheduleList.replaceChildren();

  if (parentScheduleLoading) {
    const loading = document.createElement("p");
    loading.className = "parent-schedule-empty is-loading";
    loading.textContent = "جارٍ تحميل الحصة القادمة…";
    elements.parentScheduleList.append(loading);
    return;
  }

  if (parentScheduleError) {
    const error = document.createElement("p");
    error.className = "parent-schedule-empty is-error";
    error.textContent = "تعذر تحميل برنامج الحصص حاليًا. حاول تحديث الصفحة.";
    elements.parentScheduleList.append(error);
    return;
  }

  if (!nextClass) {
    const empty = document.createElement("p");
    empty.className = "parent-schedule-empty";
    empty.textContent = "لا توجد حصص قادمة مبرمجة حاليًا.";
    elements.parentScheduleList.append(empty);
    return;
  }

  [nextClass].forEach((scheduledClass) => {
    const item = document.createElement("article");
    item.className = "parent-schedule-item";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = scheduleTypeLabel(currentStudent?.level, scheduledClass.subject);
    const date = document.createElement("span");
    date.textContent = scheduledClass.isLiveNow ? "مفتوحة الآن" : formatParentScheduleDate(scheduledClass.scheduledAt);
    content.append(title, date);
    const subjectIcon = document.createElement("i");
    subjectIcon.className = "parent-schedule-subject-icon";
    subjectIcon.setAttribute("aria-hidden", "true");
    subjectIcon.textContent = scheduledClass.subject === "PHYSICS" ? "ϟ" : scheduledClass.subject === "MATH" ? "∠" : "★";
    const join = document.createElement("button");
    join.type = "button";
    join.className = `parent-schedule-join${isLiveNow ? " is-live" : ""}`;
    join.textContent = isLiveNow ? "ادخل الآن — الحصة مفتوحة الآن بسرعة" : "الدخول للحصة";
    join.disabled = !isLiveNow;
    join.title = join.disabled ? "سيتفعل الزر عند بدء حصة هذا المستوى" : "الدخول إلى الحصة المباشرة الآن";
    if (!join.disabled) join.addEventListener("click", () => void enterLiveClass());
    item.append(subjectIcon, content, join);
    elements.parentScheduleList.append(item);
  });
}

async function loadParentSchedule(level) {
  parentScheduleLoading = true;
  parentScheduleError = "";
  renderParentSchedule();
  try {
    const response = await parentFetch(`/api/schedules/${encodeURIComponent(level)}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل برنامج الحصص.");
    if (!currentStudent || canonicalLevel(currentStudent.level) !== canonicalLevel(level)) return;

    parentScheduledClasses = Array.isArray(payload.scheduledClasses) ? payload.scheduledClasses : [];
    parentTeacherAbsent = payload.teacherAbsent === true;
    teacherAbsenceLevel = parentTeacherAbsent
      ? canonicalLevel(payload.level || level)
      : null;
    parentScheduleLoading = false;
    parentScheduleError = "";
    renderParentSchedule();
  } catch (error) {
    console.error("Unable to load parent schedule:", error);
    if (currentStudent && canonicalLevel(currentStudent.level) === canonicalLevel(level)) {
      parentScheduleLoading = false;
      parentScheduleError = "تعذر تحميل برنامج الحصص.";
      renderParentSchedule();
    }
  }
}

function openStudentPicker() {
  if (currentStudents.length < 2 || !elements.studentSwitcher) {
    return;
  }

  elements.studentSwitcher.hidden = false;
  renderStudentSwitcher(currentStudents);
  document.body.classList.add("student-switcher-open");
  elements.studentSwitcher.querySelector(".student-switcher-card")?.focus();
}

function closeStudentPicker() {
  if (elements.studentSwitcher) elements.studentSwitcher.hidden = true;
  document.body.classList.remove("student-switcher-open");
  elements.changeStudentButton?.focus();
}

function updateActiveStudentBar(student) {
  const hasMultipleStudents = currentStudents.length > 1;
  document.body.classList.toggle("has-multiple-students", hasMultipleStudents);
  if (elements.activeStudentBar) {
    elements.activeStudentBar.hidden = !hasMultipleStudents;
  }
  if (elements.activeStudentName) {
    elements.activeStudentName.textContent = student?.studentName || "—";
  }
}

function renderLevelScheduleCard(student) {
  const imageUrl = LEVEL_SCHEDULE_IMAGES[student?.level] || "";
  const hasScheduleImage = Boolean(imageUrl);
  if (elements.levelScheduleCard) elements.levelScheduleCard.hidden = !hasScheduleImage;
  if (!hasScheduleImage) {
    if (elements.levelScheduleImage) elements.levelScheduleImage.removeAttribute("src");
    if (elements.levelScheduleImageLarge) elements.levelScheduleImageLarge.removeAttribute("src");
    return;
  }

  const levelLabel = displayLevelLabel(student.level);
  if (elements.levelScheduleLevel) elements.levelScheduleLevel.textContent = levelLabel;
  if (elements.levelScheduleImage) {
    elements.levelScheduleImage.src = imageUrl;
    elements.levelScheduleImage.alt = `جدول حصص ${levelLabel}`;
  }
  if (elements.levelScheduleImageLarge) {
    elements.levelScheduleImageLarge.src = imageUrl;
    elements.levelScheduleImageLarge.alt = `جدول حصص ${levelLabel} مكبراً`;
  }
  if (elements.levelScheduleImageModal) elements.levelScheduleImageModal.hidden = true;
}

function closeLevelScheduleImageModal() {
  if (elements.levelScheduleImageModal) elements.levelScheduleImageModal.hidden = true;
}

function selectStudent(studentId) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student) {
    return;
  }

  currentStudent = student;
  window.dispatchEvent(new CustomEvent("active-student-changed", { detail: student }));
  // Clear level-specific state before loading the selected student's data so
  // the previous student's schedule or live class cannot flash in the UI.
  parentScheduledClasses = [];
  parentScheduleLoading = true;
  parentScheduleError = "";
  activeLiveClassType = null;
  globalFreeClassActive = false;
  setLiveClassVisible(false);
  parentTeacherAbsent = false;
  teacherAbsenceLevel = null;
  renderParentSchedule();
  sessionStorage.setItem("selectedStudentId", student.id);
  sessionStorage.setItem("parentStudents", JSON.stringify(currentStudents));
  persistStudentSession(student);
  renderStudentSwitcher(currentStudents);
  updateActiveStudentBar(student);
  renderLevelScheduleCard(student);
  closeStudentPicker();
  renderStudent(student);
  elements.dashboardContent.hidden = false;
  clearError();
  emitLobbyJoin(student.level);
  void loadActivityStats(student.id);
  void loadStudentHomework(student.id);
  void loadStudentCertificates(student.id);
  void loadParentSchedule(student.level);
  if (canAccessLessonRepository(student)) {
    void loadLessonVideos(student.level);
  } else {
    elements.lessonVideoList?.replaceChildren();
  }
}

function canAccessLessonRepository(student) {
  // The repository remains visible for every selected student so locked lesson
  // cards can explain the required upgrade instead of appearing to be missing.
  return Boolean(student);
}

function setLessonRepositoryOpen(nextOpen) {
  lessonRepositoryOpen = Boolean(nextOpen);
  if (elements.lessonRepositoryControls) elements.lessonRepositoryControls.hidden = !lessonRepositoryOpen;
  elements.lessonRepositoryCard?.classList.toggle("is-open", lessonRepositoryOpen);
  elements.lessonRepositoryToggle?.setAttribute("aria-expanded", String(lessonRepositoryOpen));
  if (elements.lessonRepositoryToggleIcon) elements.lessonRepositoryToggleIcon.textContent = lessonRepositoryOpen ? "⌃" : "⌄";
  if (lessonRepositoryOpen) scrollExpandedPanel(elements.lessonRepositoryCard);
}

function syncLessonRepositoryVisibility(student) {
  const shouldShow = Boolean(student);
  if (elements.lessonRepositoryCard) {
    elements.lessonRepositoryCard.hidden = !shouldShow;
  }
  if (!shouldShow) {
    elements.lessonVideoList?.replaceChildren();
  }
  setLessonRepositoryOpen(false);
}

function secondaryPaymentStateLabel(student) {
  const stage = student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");
  const amount = Number.isSafeInteger(student.amountDue) && student.amountDue > 0
    ? ` — ${student.amountDue.toLocaleString("ar-DZ")} دج`
    : "";
  return stage === "PAID"
    ? `تم تأكيد الدفع${amount}`
    : stage === "PROMISED"
      ? `الوعد بالدفع${amount}`
      : "لم يتم الدفع";
}

function secondarySubscriptionLabel(student) {
  const paymentStage = student?.paymentStage || (student?.paymentStatus ? "PAID" : "UNPAID");
  const hasMath = Boolean(student?.mathEnrollment);
  const hasPhysics = Boolean(student?.physicsEnrollment);
  if (paymentStage !== "PAID" && !hasMath && !hasPhysics) return "لم تختَر المواد بعد";
  if (hasMath && hasPhysics) return "فيزياء ورياضيات";
  if (hasPhysics) return "فيزياء فقط";
  if (hasMath) return "رياضيات فقط";
  return "لم تختَر المواد بعد";
}

function renderPaymentReceiptDecision(student) {
  const decision = String(student?.paymentReceiptDecision || "").toUpperCase();
  const pending = Boolean(student?.paymentReceiptPending) || decision === "PENDING";
  const element = elements.parentPaymentDecision;
  if (!element) return;

  if (pending) {
    element.hidden = false;
    element.className = "parent-payment-decision is-pending";
    element.textContent = "تم إرسال الوصل، في انتظار مراجعة الأستاذ.";
    return;
  }
  if (decision === "APPROVED") {
    element.hidden = false;
    element.className = "parent-payment-decision is-approved";
    element.textContent = "تم قبول وصل الدفع وتفعيل الاشتراك.";
    return;
  }
  if (decision === "REJECTED") {
    element.hidden = false;
    element.className = "parent-payment-decision is-rejected";
    const reason = String(student?.paymentReceiptDecisionReason || "الوصل غير واضح أو لا يثبت عملية الدفع.").trim();
    element.textContent = `تم رفض وصل الدفع. السبب: ${reason}`;
    return;
  }
  element.hidden = true;
  element.className = "parent-payment-decision";
  element.textContent = "";
}

function renderUniversityPaymentUpgrade(student, isPaidSubscription) {
  renderPaymentReceiptDecision(student);
  const isUniversityStudent = student.level === "طالب جامعي";
  const receiptPending = Boolean(student.paymentReceiptPending);
  const showUpgrade = isUniversityStudent && !isPaidSubscription;

  if (elements.universityPaymentUpgrade) {
    elements.universityPaymentUpgrade.hidden = !showUpgrade;
    elements.universityPaymentUpgrade.classList.toggle("is-payment-pending", showUpgrade && receiptPending);
  }
  if (elements.universityPaymentWaiting) {
    elements.universityPaymentWaiting.hidden = !(showUpgrade && receiptPending);
  }
  if (elements.parentPaymentConfirmed) {
    elements.parentPaymentConfirmed.hidden = !(isUniversityStudent && isPaidSubscription && Boolean(student.paymentReceiptUrl));
  }
  if (!showUpgrade) {
    universityPaymentTransferRequested = false;
    return;
  }

  if (elements.universityUpgradeButton) {
    elements.universityUpgradeButton.hidden = receiptPending;
  }
  if (elements.universityPaymentTransfer) {
    elements.universityPaymentTransfer.hidden = receiptPending || !universityPaymentTransferRequested;
  }
  if (elements.parentPaymentReceiptInput) {
    elements.parentPaymentReceiptInput.disabled = receiptPending;
  }
  if (elements.parentPaymentSubmit) {
    elements.parentPaymentSubmit.disabled = receiptPending;
  }
  [elements.parentPaymentCapture, elements.parentPaymentUpload, elements.parentCardPaymentButton].forEach((button) => {
    if (button) button.disabled = receiptPending;
  });
  if (elements.parentPaymentPending) {
    elements.parentPaymentPending.hidden = !receiptPending;
    elements.parentPaymentPending.textContent = receiptPending
      ? "تم إرسال الوصل، في انتظار مراجعة الأستاذ."
      : "";
  }
}

function renderSecondaryPaymentUpgrade(student) {
  renderPaymentReceiptDecision(student);
  const isSecondaryStudent = Boolean(student) && student.level !== "طالب جامعي";
  const paymentStage = student?.paymentStage || (student?.paymentStatus ? "PAID" : "UNPAID");
  const showUpgrade = isSecondaryStudent && paymentStage === "UNPAID";
  const receiptPending = Boolean(student?.paymentReceiptPending);

  document.body.classList.toggle("has-payment-upgrade", showUpgrade);
  if (elements.secondaryPaymentUpgrade) {
    elements.secondaryPaymentUpgrade.hidden = !showUpgrade;
    elements.secondaryPaymentUpgrade.classList.toggle("is-payment-pending", showUpgrade && receiptPending);
  }
  if (elements.secondaryPaymentWaiting) {
    elements.secondaryPaymentWaiting.hidden = !(showUpgrade && receiptPending);
  }
  if (!showUpgrade) {
    secondaryPaymentTransferRequested = false;
    return;
  }

  if (elements.secondaryUpgradeButton) {
    elements.secondaryUpgradeButton.hidden = receiptPending;
  }
  if (elements.secondaryPaymentTransfer) {
    elements.secondaryPaymentTransfer.hidden = receiptPending || !secondaryPaymentTransferRequested;
  }
  if (elements.secondaryPaymentReceiptInput) {
    elements.secondaryPaymentReceiptInput.disabled = receiptPending;
  }
  if (elements.secondaryPaymentSubmit) {
    elements.secondaryPaymentSubmit.disabled = receiptPending;
  }
  [elements.secondaryPaymentCapture, elements.secondaryPaymentUpload, elements.secondaryCardPaymentButton].forEach((button) => {
    if (button) button.disabled = receiptPending;
  });
  if (elements.secondaryPaymentPending) {
    elements.secondaryPaymentPending.hidden = !receiptPending;
    elements.secondaryPaymentPending.textContent = receiptPending
      ? "تم إرسال الوصل، في انتظار مراجعة الأستاذ."
      : "";
  }
}

function renderStudent(student) {
  syncStudentCertificatesVisibility(student);
  syncStudentHomeworkVisibility(student);
  elements.studentAvatar.textContent = getInitials(student.studentName);
  elements.studentName.textContent = student.studentName;
  elements.studentLevel.textContent = displayLevelLabel(student.level);
  const isUniversityStudent = student.level === "طالب جامعي";
  const paymentStage = student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");
  const accountActive = student.accountActive !== false && !student.cardReuploadRequested;
  const identityPending =
    isUniversityStudent &&
    student.accountActive === false &&
    !student.cardReuploadRequested &&
    Boolean(student.cardPhotoUrl);
  if (elements.accountStatus) {
    const secondaryPaid = !isUniversityStudent && ["PAID", "PROMISED"].includes(paymentStage);
    elements.accountStatus.textContent = !isUniversityStudent
      ? secondaryPaid ? "حساب مدفوع" : "حساب مجاني"
      : student.cardReuploadRequested
        ? "إعادة رفع البطاقة مطلوبة"
        : identityPending
          ? "في انتظار تأكيد هوية البطاقة"
          : accountActive
            ? "حساب مفعل"
            : "حساب غير مفعل";
    elements.accountStatus.classList.toggle("is-active", !isUniversityStudent ? secondaryPaid : accountActive);
    elements.accountStatus.classList.toggle("is-inactive", !isUniversityStudent ? !secondaryPaid : !accountActive && !identityPending);
    elements.accountStatus.classList.toggle("is-pending", isUniversityStudent && identityPending);
  }
  if (elements.cardReuploadPanel) {
    elements.cardReuploadPanel.hidden = !(
      student.level === "طالب جامعي" && Boolean(student.cardReuploadRequested)
    );
  }

  const isPaid = paymentStage === "PAID";
  syncLessonRepositoryVisibility(student);
  elements.paymentStatus.textContent = isUniversityStudent
    ? isPaid ? "اشتراك مدفوع" : "اشتراك مجاني"
    : secondarySubscriptionLabel(student);
  elements.paymentStatus.classList.toggle("is-paid", isUniversityStudent && isPaid);
  elements.paymentStatus.classList.toggle("is-free", isUniversityStudent && !isPaid);
  elements.paymentStatus.classList.toggle("is-subject", !isUniversityStudent);
  // The subscription KPI was intentionally removed from the markup because its information is now part of the unified card.
  if (elements.secondaryPaymentState) {
    const paymentStateValue = elements.secondaryPaymentState.querySelector("strong");
    elements.secondaryPaymentState.hidden = isUniversityStudent;
    if (paymentStateValue) {
      paymentStateValue.textContent = isUniversityStudent ? "" : secondaryPaymentStateLabel(student);
      paymentStateValue.classList.toggle("is-paid", paymentStage === "PAID");
      paymentStateValue.classList.toggle("is-unpaid", paymentStage === "UNPAID");
    } else {
      elements.secondaryPaymentState.textContent = isUniversityStudent
        ? ""
        : `حالة الدفع: ${secondaryPaymentStateLabel(student)}`;
    }
  }
  renderUniversityPaymentUpgrade(student, isPaid);
  renderSecondaryPaymentUpgrade(student);
}

/**
 * Save the exact identity required by student-live.js immediately before any
 * viewer handoff. These fields are not authorization credentials; the parent
 * JWT remains separate and is never exposed to the viewer as a socket token.
 */
function persistStudentSession(student) {
  sessionStorage.setItem("studentName", student.studentName);
  sessionStorage.setItem("level", student.level);
  sessionStorage.setItem("studentLevel", student.level);
  sessionStorage.setItem("studentId", student.id);
  sessionStorage.setItem("currentStudent", JSON.stringify(student));
}

async function parentFetch(url, options = {}) {
  const token = getParentToken();
  if (!token) {
    throw new Error("انتهت جلسة الولي.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });

  if (response.status === 428) {
    const payload = await response.clone().json().catch(() => ({}));
    if (payload.code === "PARENT_PIN_CHANGE_REQUIRED") {
      sessionStorage.setItem("forceParentPinChange", "1");
      window.location.replace("./force-pin.html");
      throw new Error("يجب تغيير كلمة المرور المؤقتة قبل استعمال المنصة.");
    }
  }

  if (response.status === 401 || response.status === 403) {
    redirectToParentLogin();
    throw new Error("انتهت الجلسة أو لا تملك صلاحية الوصول إلى هذه البيانات.");
  }

  return response;
}

function formatLessonVideoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "تاريخ غير متاح";
  return new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium" }).format(date);
}

function isSafeLessonPreviewUrl(value) {
  const url = String(value || "");
  const isDrive = /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{20,200}\/preview$/.test(url);
  const isYouTube = /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]{11}.*$/.test(url);
  return isDrive || isYouTube;
}

function clampLessonZoomValue(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function applyLessonZoom() {
  if (!elements.lessonVideoFrame) return;
  elements.lessonVideoFrame.style.transform = `translate3d(${lessonZoomX}px, ${lessonZoomY}px, 0) scale(${lessonZoomScale})`;
  elements.lessonVideoZoomHint?.classList.toggle("is-visible", lessonZoomScale > 1.01);
}

function clampLessonZoomPan() {
  const layer = elements.lessonVideoZoomLayer;
  if (!layer) return;
  const rect = layer.getBoundingClientRect();
  const maxX = Math.max(0, (rect.width * (lessonZoomScale - 1)) / 2);
  const maxY = Math.max(0, (rect.height * (lessonZoomScale - 1)) / 2);
  lessonZoomX = clampLessonZoomValue(lessonZoomX, -maxX, maxX);
  lessonZoomY = clampLessonZoomValue(lessonZoomY, -maxY, maxY);
}

function resetLessonZoom() {
  lessonZoomScale = 1;
  lessonZoomX = 0;
  lessonZoomY = 0;
  lessonZoomPointers.clear();
  lessonZoomPinchStartDistance = 0;
  lessonZoomPanStart = null;
  elements.lessonVideoZoomLayer?.classList.remove("is-active");
  elements.lessonVideoZoomHint?.classList.remove("is-visible");
  if (elements.lessonVideoFrame) elements.lessonVideoFrame.style.transform = "";
}

function activateLessonZoomLayer() {
  // Capture pinch gestures only over the video image area. The native YouTube
  // control bar remains uncovered so CC, quality, settings, and fullscreen work.
  elements.lessonVideoZoomLayer?.classList.add("is-active");
}

function lessonZoomDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function postLessonVideoPlayCommand() {
  const frameWindow = elements.lessonVideoFrame?.contentWindow;
  if (!frameWindow) return;
  frameWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "https://www.youtube.com");
}

function handleLessonZoomPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const layer = elements.lessonVideoZoomLayer;
  if (!layer) return;
  layer.setPointerCapture?.(event.pointerId);
  lessonZoomPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (lessonZoomPointers.size === 2) {
    const [first, second] = [...lessonZoomPointers.values()];
    lessonZoomPinchStartDistance = Math.max(1, lessonZoomDistance(first, second));
    lessonZoomPinchStartScale = lessonZoomScale;
    lessonZoomPanStart = null;
  } else if (lessonZoomScale > 1) {
    lessonZoomPanStart = { x: event.clientX - lessonZoomX, y: event.clientY - lessonZoomY };
  }
  event.preventDefault();
}

function handleLessonZoomPointerMove(event) {
  if (!lessonZoomPointers.has(event.pointerId)) return;
  lessonZoomPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (lessonZoomPointers.size >= 2) {
    const [first, second] = [...lessonZoomPointers.values()];
    const distance = Math.max(1, lessonZoomDistance(first, second));
    lessonZoomScale = clampLessonZoomValue(lessonZoomPinchStartScale * (distance / lessonZoomPinchStartDistance), 1, 4);
    clampLessonZoomPan();
    applyLessonZoom();
  } else if (lessonZoomScale > 1 && lessonZoomPanStart) {
    lessonZoomX = event.clientX - lessonZoomPanStart.x;
    lessonZoomY = event.clientY - lessonZoomPanStart.y;
    clampLessonZoomPan();
    applyLessonZoom();
  }
  event.preventDefault();
}

function handleLessonZoomPointerUp(event) {
  const wasSingleTap = lessonZoomPointers.size === 1 && lessonZoomScale <= 1.01;
  lessonZoomPointers.delete(event.pointerId);
  if (lessonZoomPointers.size < 2) lessonZoomPinchStartDistance = 0;
  if (lessonZoomPointers.size === 1 && lessonZoomScale > 1) {
    const [remaining] = [...lessonZoomPointers.values()];
    lessonZoomPanStart = { x: remaining.x - lessonZoomX, y: remaining.y - lessonZoomY };
  } else if (!lessonZoomPointers.size) {
    lessonZoomPanStart = null;
    if (wasSingleTap) postLessonVideoPlayCommand();
  }
  event.preventDefault();
}

function updateLessonFullscreenLabel() {
  if (!elements.lessonVideoFullscreen) return;
  const isFullscreen = document.fullscreenElement === elements.lessonVideoPlayerShell;
  elements.lessonVideoFullscreen.textContent = isFullscreen ? "إغلاق ملء الشاشة" : "ملء الشاشة";
  elements.lessonVideoFullscreen.setAttribute("aria-label", isFullscreen ? "إغلاق ملء الشاشة" : "فتح ملء الشاشة");
}

async function toggleLessonFullscreen() {
  const shell = elements.lessonVideoPlayerShell;
  if (!shell) return;
  try {
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen?.();
      screen.orientation?.unlock?.();
      resetLessonZoom();
    } else if (shell.requestFullscreen) {
      await shell.requestFullscreen();
      activateLessonZoomLayer();
    }
  } catch (error) {
    console.warn("Unable to toggle lesson fullscreen:", error);
  } finally {
    updateLessonFullscreenLabel();
  }
}

async function rotateLessonScreen() {
  const shell = elements.lessonVideoPlayerShell;
  if (!shell) return;
  try {
    if (document.fullscreenElement !== shell && shell.requestFullscreen) {
      await shell.requestFullscreen();
    }
    const currentType = screen.orientation?.type || "portrait-primary";
    const targetType = currentType.startsWith("landscape") ? "portrait-primary" : "landscape-primary";
    activateLessonZoomLayer();
    if (screen.orientation?.lock) {
      await screen.orientation.lock(targetType);
    }
  } catch (error) {
    console.warn("Unable to rotate lesson video:", error);
  } finally {
    updateLessonFullscreenLabel();
  }
}

function closeLessonVideo() {
  if (document.fullscreenElement === elements.lessonVideoPlayerShell) {
    void document.exitFullscreen?.().catch?.(() => {});
  }
  screen.orientation?.unlock?.();
  resetLessonZoom();
  if (elements.lessonVideoModal) elements.lessonVideoModal.hidden = true;
  if (elements.lessonVideoFrame) elements.lessonVideoFrame.removeAttribute("src");
  document.body.classList.remove("lesson-video-open");
  const previousFocus = lessonVideoPreviousFocus;
  lessonVideoPreviousFocus = null;
  if (previousFocus && typeof previousFocus.focus === "function") {
    window.setTimeout(() => previousFocus.focus(), 0);
  }
}

function openLessonVideo(video) {
  if (!isSafeLessonPreviewUrl(video?.previewUrl) || !elements.lessonVideoModal || !elements.lessonVideoFrame) {
    return;
  }

  lessonVideoPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const title = video.title || "مشاهدة الحصة";
  const date = `أضيفت في ${formatLessonVideoDate(video.createdAt)}`;
  if (elements.lessonVideoModalTitle) elements.lessonVideoModalTitle.textContent = title;
  if (elements.lessonVideoSidebarTitle) elements.lessonVideoSidebarTitle.textContent = title;
  if (elements.lessonVideoSidebarMeta) elements.lessonVideoSidebarMeta.textContent = `${date} · مشاهدة داخل المنصة`;
  elements.lessonVideoFrame.title = title;
  
  // Ensure YouTube embeds have full permissions
  if (String(video.previewUrl).includes("youtube.com")) {
    elements.lessonVideoFrame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    elements.lessonVideoFrame.setAttribute("allowfullscreen", "true");
    elements.lessonVideoFrame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  } else {
    elements.lessonVideoFrame.removeAttribute("allow");
    elements.lessonVideoFrame.removeAttribute("allowfullscreen");
    elements.lessonVideoFrame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  }
  
  elements.lessonVideoFrame.src = video.previewUrl;
  elements.lessonVideoModal.hidden = false;
  document.body.classList.add("lesson-video-open");
  window.setTimeout(() => elements.lessonVideoClose?.focus(), 0);
}

function createLessonVideoEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "lesson-video-empty";
  empty.innerHTML = '<svg class="lesson-video-empty-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 6.5A1.75 1.75 0 0 1 6.5 4.75h5l1.6 1.75h4.4A1.75 1.75 0 0 1 19.25 8v9.5a1.75 1.75 0 0 1-1.75 1.75h-11a1.75 1.75 0 0 1-1.75-1.75v-11Z"/><path d="m10 11 4 2.5-4 2.5V11Z"/></svg><span></span>';
  empty.querySelector("span").textContent = message;
  return empty;
}

function renderLessonVideos(videos) {
  if (!elements.lessonVideoList) return;
  elements.lessonVideoList.replaceChildren();

  if (!videos.length) {
    elements.lessonVideoList.append(createLessonVideoEmptyState("لا توجد فيديوهات مكملة متاحة حاليًا."));
    return;
  }

  videos.forEach((video, index) => {
    if (!video?.title) return;
    const item = document.createElement("article");
    item.className = `lesson-video-item${video.locked ? " is-locked" : ""}`;
    item.setAttribute("aria-label", `الدرس ${index + 1}: ${video.title || "حصة مسجلة"}`);

    const art = document.createElement("div");
    art.className = "lesson-video-art";
    art.setAttribute("aria-hidden", "true");
    art.innerHTML = video.locked
      ? '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M4.75 5.75A1.75 1.75 0 0 1 6.5 4h11a1.75 1.75 0 0 1 1.75 1.75v9.5A1.75 1.75 0 0 1 17.5 17h-11a1.75 1.75 0 0 1-1.75-1.75v-9.5Z"/><path d="m10 8 5 3.5-5 3.5V8Z"/><path d="M9 20h6M12 17v3"/></svg>';

    const copy = document.createElement("div");
    copy.className = "lesson-video-copy";
    const title = document.createElement("strong");
    title.textContent = video.title || "حصة مسجلة";
    const type = document.createElement("span");
    type.className = "lesson-video-type";
    type.textContent = video.repositoryTypeLabel || "درس مسجل";
    const date = document.createElement("small");
    date.textContent = `أضيفت في ${formatLessonVideoDate(video.createdAt)}`;
    const watch = document.createElement("button");
    watch.type = "button";
    watch.className = `watch-lesson-video-btn${video.locked ? " is-locked" : ""}`;
    watch.textContent = video.locked ? "ترقية الحساب" : "مشاهدة الدرس";
    watch.setAttribute("aria-label", video.locked ? `ترقية الحساب للوصول إلى ${video.title}` : `مشاهدة ${video.title || "الحصة المسجلة"}`);
    watch.addEventListener("click", () => {
      if (video.locked) {
        openLessonUpgradeModal(video);
      } else {
        openLessonVideo(video);
      }
    });
    copy.append(title, type, date, watch);
    item.append(art, copy);
    elements.lessonVideoList.append(item);
  });

  if (!elements.lessonVideoList.childElementCount) renderLessonVideos([]);
}

async function loadLessonVideos(level) {
  if (!elements.lessonVideoList || !level || !canAccessLessonRepository(currentStudent)) return;
  if (elements.lessonRepositoryLevelCaption) {
    elements.lessonRepositoryLevelCaption.textContent = `فيديوهات مكملة لمستوى ${displayLevelLabel(level)}، أضافها الأستاذ يدويًا حسب المادة أو نوع الاشتراك.`;
  }
  elements.lessonVideoList.replaceChildren();
    elements.lessonVideoList.append(createLessonVideoEmptyState("جارٍ تحميل الفيديوهات المكملة…"));

  try {
    const studentId = currentStudent?.id ? `?studentId=${encodeURIComponent(currentStudent.id)}` : "";
    const response = await parentFetch(`/api/lesson-videos/${encodeURIComponent(level)}${studentId}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل مستودع الدروس.");
    if (!currentStudent || currentStudent.level !== level) return;
    renderLessonVideos(Array.isArray(payload.data) ? payload.data : []);
  } catch (error) {
    if (/انتهت الجلسة/.test(error.message)) return;
    console.error("Unable to load lesson videos:", error);
    if (!currentStudent || currentStudent.level !== level) return;
    elements.lessonVideoList.replaceChildren(createLessonVideoEmptyState("تعذر تحميل الفيديوهات المكملة حاليًا."));
  }
}

function updateAttendanceCount(value) {
  if (elements.attendanceCount) {
    elements.attendanceCount.textContent = String(value);
  }
}

async function loadAttendanceCount(studentId) {
  if (!studentId) {
    updateAttendanceCount(0);
    return;
  }

  try {
    const response = await parentFetch(
      `/api/attendance/student/${encodeURIComponent(studentId)}`,
      { headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "تعذر تحميل سجل الحضور.");
    }

    updateAttendanceCount(Array.isArray(payload.data) ? payload.data.length : 0);
  } catch (error) {
    if (/انتهت الجلسة/.test(error.message)) {
      return;
    }

    console.error("Unable to load attendance count:", error);
    updateAttendanceCount(0);
  }
}

function setActivityStat(element, value) {
  if (element) element.textContent = String(value);
}

async function loadActivityStats(studentId) {
  if (!studentId) {
    setActivityStat(elements.attendanceCount, 0);
    setActivityStat(elements.participationCount, 0);
    setActivityStat(elements.homeworkCount, "0 / 0");
    return;
  }

  setActivityStat(elements.attendanceCount, "…");
  setActivityStat(elements.participationCount, "…");
  setActivityStat(elements.homeworkCount, "…");

  try {
    const encodedStudentId = encodeURIComponent(studentId);
    const [attendanceResponse, progressResponse, assignmentsResponse] = await Promise.all([
      parentFetch(`/api/attendance/student/${encodedStudentId}`, { headers: { Accept: "application/json" } }),
      parentFetch(`/api/academic/students/${encodedStudentId}/progress`, { headers: { Accept: "application/json" } }),
      parentFetch(`/api/academic/students/${encodedStudentId}/assignments`, { headers: { Accept: "application/json" } }),
    ]);

    const [attendancePayload, progressPayload, assignmentsPayload] = await Promise.all([
      attendanceResponse.json().catch(() => ({})),
      progressResponse.json().catch(() => ({})),
      assignmentsResponse.json().catch(() => ({})),
    ]);

    if (!attendanceResponse.ok) throw new Error(attendancePayload.error || "تعذر تحميل الحضور.");
    if (!progressResponse.ok) throw new Error(progressPayload.error || "تعذر تحميل المشاركات.");
    if (!assignmentsResponse.ok) throw new Error(assignmentsPayload.error || "تعذر تحميل الواجبات.");
    if (!currentStudent || currentStudent.id !== studentId) return;

    const attendanceRows = Array.isArray(attendancePayload.data) ? attendancePayload.data : [];
    const qualifyingAttendance = attendanceRows.filter((entry) => Number(entry?.durationMinutes) >= 60).length;
    const participationTotal = Number(progressPayload?.data?.participationTotal) || 0;
    const assignments = Array.isArray(assignmentsPayload.data) ? assignmentsPayload.data : [];
    const submittedAssignments = assignments.filter((assignment) => Array.isArray(assignment?.submissions) && assignment.submissions.length > 0).length;

    setActivityStat(elements.attendanceCount, qualifyingAttendance);
    setActivityStat(elements.participationCount, participationTotal);
    setActivityStat(elements.homeworkCount, `${submittedAssignments} / ${assignments.length}`);
  } catch (error) {
    if (/انتهت الجلسة/.test(error.message)) return;
    console.error("Unable to load activity stats:", error);
    if (!currentStudent || currentStudent.id !== studentId) return;
    setActivityStat(elements.attendanceCount, "—");
    setActivityStat(elements.participationCount, "—");
    setActivityStat(elements.homeworkCount, "—");
  }
}

function emitLobbyJoin(level) {
  if (!level || !socket?.connected) {
    return;
  }

  const normalizedLevel = canonicalLevel(level);
  currentLobbyLevel = normalizedLevel;

  socket.emit("join_level_lobby", { level: normalizedLevel }, (response) => {
    if (!response?.ok) {
      showError(
        response?.message || response?.error || "تعذر متابعة حالة الحصة المباشرة."
      );
      return;
    }

    // The acknowledgement restores the existing state; subsequent events keep
    // it current while the parent remains on this dashboard.
    activeLiveClassType = response.isClassLive ? response.subject || null : null;
    globalFreeClassActive = Boolean(response.globalFree);
    if (currentStudent && canonicalLevel(currentStudent.level) === normalizedLevel) {
      parentTeacherAbsent = response.teacherAbsent === true;
      teacherAbsenceLevel = parentTeacherAbsent ? normalizedLevel : null;
      renderParentSchedule();
    }
    setLiveClassVisible(Boolean(response.isClassLive), response);
  });
}

async function loadDashboard({ backgroundRefresh = false } = {}) {
  const parentPhone = sessionStorage.getItem("parentPhone");

  if (!parentPhone || !getParentToken()) {
    return;
  }

  if (!backgroundRefresh) {
    clearError();
    elements.loadingState.hidden = false;
    elements.dashboardContent.hidden = true;
    setLiveClassVisible(false);
  }

  try {
    const response = await parentFetch(
      `/api/students/parent/${encodeURIComponent(parentPhone)}`,
      { headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || payload.message || "تعذر تحميل بيانات التلميذ.");
    }

    const students = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.students)
        ? payload.students
        : payload?.id
          ? [payload]
          : [];

    if (!students.length) {
      throw new Error("لم يتم العثور على تلاميذ مرتبطين بهذا الرقم.");
    }

    currentStudents = students;
    sessionStorage.setItem("parentStudents", JSON.stringify(currentStudents));

    const storedStudentId = sessionStorage.getItem("selectedStudentId");
    const storedStudent = currentStudents.find((student) => student.id === storedStudentId);
    if (currentStudents.length > 1 && !storedStudent) {
      currentStudent = null;
      updateActiveStudentBar(null);
      renderStudentSwitcher(currentStudents);
      if (elements.studentSwitcher) elements.studentSwitcher.hidden = false;
      elements.dashboardContent.hidden = true;
      clearError();
      return;
    }

    selectStudent((storedStudent || currentStudents[0]).id);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to load parent dashboard:", error);
      if (!backgroundRefresh) {
        showError(error.message || "تعذر تحميل بيانات التلميذ. حاول مرة أخرى.");
      }
    }
  } finally {
    if (!backgroundRefresh) {
      elements.loadingState.hidden = true;
    }
  }
}

async function prepareStudentMicrophonePermission() {
  sessionStorage.removeItem("studentMicPreflight");

  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }

  try {
    // This is called inside the parent's intentional classroom-entry click.
    // The stream is immediately stopped: it exists only to save the browser
    // permission for the viewer, not to transmit any student audio here.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    stream.getTracks().forEach((track) => track.stop());
    sessionStorage.setItem("studentMicPreflight", "granted");
  } catch (error) {
    // The class remains viewable if the learner chooses not to share a mic.
    console.info("Student microphone preflight was not granted:", error?.name || error);
  }
}

async function enterLiveClass() {
  if (!currentStudent) {
    showError("تعذر فتح الحصة قبل تحميل بيانات التلميذ.");
    return;
  }

  const isUniversityStudent = currentStudent.level === "طالب جامعي";
  const isPaidSubscription =
    currentStudent.paymentStage === "PAID" || currentStudent.paymentStatus === true;
  const hasSecondaryPaymentAccess =
    !isUniversityStudent && ["PAID", "PROMISED"].includes(currentStudent.paymentStage);
  const isGlobalFreeClass = globalFreeClassActive && activeLiveClassType === "FREE";
  const isFreeSecondaryClass = !isUniversityStudent && activeLiveClassType === "FREE";
  const identityPending =
    isUniversityStudent &&
    currentStudent.accountActive === false &&
    !currentStudent.cardReuploadRequested &&
    Boolean(currentStudent.cardPhotoUrl);

  if (currentStudent.cardReuploadRequested || identityPending) {
    showError(
      currentStudent.cardReuploadRequested
        ? "يجب رفع بطاقة جديدة أولاً قبل دخول الحصة."
        : "حساب الطالب في انتظار تأكيد هوية البطاقة من الأستاذ."
    );
    return;
  }

  const isMissingSecondarySubject =
    !isUniversityStudent &&
    ((activeLiveClassType === "MATH" && !currentStudent.mathEnrollment) ||
      (activeLiveClassType === "PHYSICS" && !currentStudent.physicsEnrollment));
  if (isMissingSecondarySubject) {
    clearError();
    openPaymentAccessModal("subject-upgrade", activeLiveClassType);
    return;
  }

  if (!isGlobalFreeClass && !isFreeSecondaryClass && !currentStudent.liveAccessEnabled && !hasSecondaryPaymentAccess) {
    clearError();
    openPaymentAccessModal();
    return;
  }

  if (!isGlobalFreeClass && isUniversityStudent && !isPaidSubscription && activeLiveClassType === "PAID") {
    clearError();
    openPaymentAccessModal("subscription-upgrade");
    return;
  }

  const originalLabel = elements.joinLiveClassButton?.textContent;
  if (elements.joinLiveClassButton) {
    elements.joinLiveClassButton.disabled = true;
    elements.joinLiveClassButton.textContent = "جارٍ تجهيز الحصة…";
  }

  // Use this exact user gesture to request the browser mic permission once.
  // On return, the viewer keeps the track disabled until teacher approval.
  await prepareStudentMicrophonePermission();
  persistStudentSession(currentStudent);
  sessionStorage.setItem("joinLiveClassImmediately", "true");
  window.location.assign("./student-live.html?join=direct");

  // Navigation normally begins immediately; this is only a safe fallback.
  if (elements.joinLiveClassButton) {
    elements.joinLiveClassButton.disabled = false;
    elements.joinLiveClassButton.textContent = originalLabel || "الدخول إلى الحصة";
  }
}

function refreshAccessAfterReturningFromCall() {
  if (document.hidden || paymentReturnRefreshTimer) {
    return;
  }

  paymentReturnRefreshTimer = window.setTimeout(() => {
    paymentReturnRefreshTimer = null;
    void loadDashboard({ backgroundRefresh: true });
  }, 450);
}

function openUniversityPaymentTransfer() {
  universityPaymentTransferRequested = true;
  if (elements.universityPaymentTransfer) {
    elements.universityPaymentTransfer.hidden = false;
    elements.universityPaymentTransfer.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function openSecondaryPaymentTransfer() {
  secondaryPaymentTransferRequested = true;
  if (elements.secondaryPaymentTransfer) {
    elements.secondaryPaymentTransfer.hidden = false;
    elements.secondarySofizPayReconcile?.removeAttribute("hidden");
    elements.secondaryPaymentTransfer.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function reconcileParentSofizPay() {
  const providerOrderNumber = elements.secondarySofizPayOrderNumber?.value.trim();
  const subscriptionType = elements.secondarySubscriptionType?.value;
  if (!currentStudent || !providerOrderNumber || !["BOTH", "MATH", "PHYSICS"].includes(subscriptionType)) {
    if (elements.secondarySofizPayReconcileMessage) elements.secondarySofizPayReconcileMessage.textContent = "اختر نوع الاشتراك وأدخل رقم معاملة SofizPay أولاً.";
    return;
  }

  const button = elements.secondarySofizPayReconcileButton;
  if (button) {
    button.disabled = true;
    button.textContent = "جارٍ التحقق…";
  }
  if (elements.secondarySofizPayReconcileMessage) elements.secondarySofizPayReconcileMessage.textContent = "يتم الآن التحقق من الرقم لدى SofizPay…";

  try {
    const response = await parentFetch("/api/payments/sofizpay/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        providerOrderNumber,
        subscriptionType,
        studentId: currentStudent.id,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر التحقق من رقم المعاملة.");
    const status = payload?.data?.paymentStatus;
    if (elements.secondarySofizPayReconcileMessage) {
      elements.secondarySofizPayReconcileMessage.textContent = payload?.data?.message || "تم تحديث حالة المعاملة.";
    }
    if (status === "PAID") {
      await loadDashboard({ backgroundRefresh: true });
    }
  } catch (error) {
    if (elements.secondarySofizPayReconcileMessage) elements.secondarySofizPayReconcileMessage.textContent = error.message || "تعذر التحقق من رقم المعاملة.";
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "تحقق وتحديث";
    }
  }
}

async function submitSecondaryPaymentReceipt() {
  const receipt = elements.secondaryPaymentReceiptInput?.files?.[0];
  const subscriptionType = elements.secondarySubscriptionType?.value;
  if (!currentStudent) {
    openDocumentFeedback("تعذر تحديد حساب التلميذ الحالي. أعد فتح لوحة الولي وحاول مرة أخرى.", "تعذر تحديد الحساب");
    return;
  }
  const missing = [];
  if (!receipt) missing.push("لم ترفع وصل الدفع.");
  if (!["BOTH", "MATH", "PHYSICS"].includes(subscriptionType)) missing.push("لم تختَر المادة أو نوع الاشتراك.");
  if (missing.length) {
      openDocumentFeedback(missing.join("\n"), "بيانات الترقية ناقصة");
    if (!receipt) elements.secondaryPaymentReceiptInput?.focus();
    else elements.secondarySubscriptionType?.focus();
    return;
  }

  const originalLabel = elements.secondaryPaymentSubmit?.textContent;
  if (elements.secondaryPaymentSubmit) {
    elements.secondaryPaymentSubmit.disabled = true;
    elements.secondaryPaymentSubmit.textContent = "جارٍ إرسال الوصل…";
  }

  try {
    const formData = new FormData();
    formData.append("paymentReceipt", receipt);
    formData.append("subscriptionType", subscriptionType);
    const response = await parentFetch(
      `/api/students/${encodeURIComponent(currentStudent.id)}/payment-receipt`,
      { method: "POST", body: formData }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "تعذر إرسال صورة أو ملف PDF لوصل الدفع.");
    }

    elements.secondaryPaymentReceiptInput.value = "";
    updatePaymentReceiptFileName(elements.secondaryPaymentReceiptInput, elements.secondaryPaymentFileName);
    secondaryPaymentTransferRequested = true;
    await loadDashboard({ backgroundRefresh: true });
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      openDocumentFeedback(error.message || "تعذر إرسال وصل الدفع.", "تعذر إرسال وصل الدفع");
    }
  } finally {
    if (elements.secondaryPaymentSubmit && !currentStudent?.paymentReceiptPending) {
      elements.secondaryPaymentSubmit.disabled = false;
      elements.secondaryPaymentSubmit.textContent = originalLabel || "إرسال وصل الدفع للأستاذ";
    }
  }
}

async function submitUniversityPaymentReceipt() {
  const receipt = elements.parentPaymentReceiptInput?.files?.[0];
  if (!currentStudent) {
    openDocumentFeedback("تعذر تحديد حساب الطالب الجامعي الحالي. أعد فتح لوحة الولي وحاول مرة أخرى.", "تعذر تحديد الحساب");
    return;
  }
  if (!receipt) {
    openDocumentFeedback("لم ترفع وصل الدفع.", "وصل الدفع مطلوب");
    elements.parentPaymentReceiptInput?.focus();
    return;
  }

  const originalLabel = elements.parentPaymentSubmit?.textContent;
  if (elements.parentPaymentSubmit) {
    elements.parentPaymentSubmit.disabled = true;
    elements.parentPaymentSubmit.textContent = "جارٍ إرسال الوصل…";
  }

  try {
    const formData = new FormData();
    formData.append("paymentReceipt", receipt);
    const response = await parentFetch(
      `/api/students/${encodeURIComponent(currentStudent.id)}/payment-receipt`,
      { method: "POST", body: formData }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "تعذر إرسال صورة أو ملف PDF لوصل الدفع.");
    }

    elements.parentPaymentReceiptInput.value = "";
    updatePaymentReceiptFileName(elements.parentPaymentReceiptInput, elements.parentPaymentFileName);
    universityPaymentTransferRequested = true;
    await loadDashboard({ backgroundRefresh: true });
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      openDocumentFeedback(error.message || "تعذر إرسال وصل الدفع.", "تعذر إرسال وصل الدفع");
    }
  } finally {
    if (elements.parentPaymentSubmit && !currentStudent?.paymentReceiptPending) {
      elements.parentPaymentSubmit.disabled = false;
      elements.parentPaymentSubmit.textContent = originalLabel || "إرسال وصل الدفع للأستاذ";
    }
  }
}

async function uploadReplacementCard() {
  const file = elements.replacementCardInput?.files?.[0];
  if (!file || !currentStudent) {
    return;
  }

  const originalLabel = elements.replacementCardButton?.textContent;
  if (elements.replacementCardButton) {
    elements.replacementCardButton.disabled = true;
    elements.replacementCardButton.textContent = "جارٍ رفع البطاقة…";
  }

  try {
    const formData = new FormData();
    formData.append("cardPhoto", file);
    const response = await parentFetch(
      `/api/students/${encodeURIComponent(currentStudent.id)}/card-photo`,
      { method: "POST", body: formData }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "تعذر رفع البطاقة الجديدة.");
    }

    elements.replacementCardInput.value = "";
    await loadDashboard({ backgroundRefresh: true });
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      showError(error.message || "تعذر رفع البطاقة الجديدة.");
    }
  } finally {
    if (elements.replacementCardButton) {
      elements.replacementCardButton.disabled = false;
      elements.replacementCardButton.textContent = originalLabel || "رفع بطاقة جديدة";
    }
  }
}

function setParentEmailStatus(message = "", isError = false) {
  if (!elements.parentEmailStatus) return;
  elements.parentEmailStatus.textContent = message;
  elements.parentEmailStatus.hidden = !message;
  elements.parentEmailStatus.classList.toggle("is-error", isError);
}

async function loadParentEmail() {
  if (!elements.parentAccountEmail) return;
  try {
    const response = await parentFetch("/api/auth/parent/email", { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل البريد الإلكتروني.");
    elements.parentAccountEmail.value = payload.data?.email || "";
  } catch (error) {
    if (!/انتهت جلسة/.test(error.message)) setParentEmailStatus(error.message || "تعذر تحميل البريد الإلكتروني.", true);
  }
}

async function updateParentEmail(event) {
  event.preventDefault();
  const email = String(elements.parentAccountEmail?.value || "").trim().toLowerCase();
  if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    setParentEmailStatus("أدخل بريدًا إلكترونيًا صحيحًا أو اترك الحقل فارغًا.", true);
    elements.parentAccountEmail?.focus();
    return;
  }
  const button = elements.parentEmailForm?.querySelector("button[type='submit']");
  if (button) button.disabled = true;
  setParentEmailStatus();
  try {
    const response = await parentFetch("/api/auth/parent/email", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحديث البريد الإلكتروني.");
    elements.parentAccountEmail.value = payload.data?.email || "";
    setParentEmailStatus(payload.message || "تم حفظ البريد الإلكتروني.");
  } catch (error) {
    if (!/انتهت جلسة/.test(error.message)) setParentEmailStatus(error.message || "تعذر تحديث البريد الإلكتروني.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

function logout() {
  void window.revokeServerSession?.();
  clearParentSession();
  window.location.replace("./parent-login.html");
}

function setParentSidebarOpen(isOpen) {
  elements.parentSidebar?.classList.toggle("is-open", isOpen);
  if (elements.parentSidebarBackdrop) elements.parentSidebarBackdrop.hidden = !isOpen;
  elements.parentSidebarToggle?.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("parent-sidebar-open", isOpen);
}

function setParentActiveNav(link) {
  elements.parentNavLinks.forEach((item) => item.classList.toggle("is-active", item === link));
}

function initializeLobbySocket() {
  // Socket.io is loaded by parent-dashboard.html before this script.
  if (typeof io !== "function") {
    showError("تعذر متابعة حالة الحصة المباشرة حالياً.");
    return;
  }

  socket = io({
    auth: { token: getParentToken() || "" },
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    if (currentStudent?.level) {
      emitLobbyJoin(currentStudent.level);
    }
  });

  socket.on("live_class_started", (data = {}) => {
    if (!currentStudent || (!data.globalFree && data.level && data.level !== currentStudent.level)) {
      return;
    }

    activeLiveClassType = data.subject || null;
    globalFreeClassActive = Boolean(data.globalFree);
    setLiveClassVisible(true, data);
  });

  socket.on("live_class_resumed", (data = {}) => {
    if (!currentStudent || (!data.globalFree && data.level && data.level !== currentStudent.level)) {
      return;
    }

    activeLiveClassType = data.subject || null;
    globalFreeClassActive = Boolean(data.globalFree);
    setLiveClassVisible(true, data);
  });

  socket.on("live_class_ended", (data = {}) => {
    if (!currentStudent || (!data.globalFree && data.level && data.level !== currentStudent.level)) {
      return;
    }

    activeLiveClassType = null;
    globalFreeClassActive = false;
    setLiveClassVisible(false);
  });

  socket.on("student_live_access_updated", (data = {}) => {
    if (!currentStudent || data.studentId !== currentStudent.id) {
      return;
    }

    // The teacher has just opened or blocked this exact learner's class access.
    // Refresh authenticated dashboard data immediately without reloading the page.
    void loadDashboard({ backgroundRefresh: true });
  });

  socket.on("student_account_status_updated", (data = {}) => {
    if (!currentStudent || data.studentId !== currentStudent.id) {
      return;
    }

    void loadDashboard({ backgroundRefresh: true });
  });

  socket.on("student_payment_receipt_updated", (data = {}) => {
    if (!currentStudent || data.studentId !== currentStudent.id) {
      return;
    }

    void loadDashboard({ backgroundRefresh: true });
  });

  socket.on("class_schedule_updated", (data = {}) => {
    if (!currentStudent || data.level !== currentStudent.level) {
      return;
    }

    void loadParentSchedule(currentStudent.level);
  });

    socket.on("teacher_absence_updated", (data = {}) => {
    const eventLevel = canonicalLevel(data.level);
    if (!currentStudent || !eventLevel || eventLevel !== canonicalLevel(currentStudent.level)) {
      return;
    }
    parentTeacherAbsent = data.isAbsent === true;
    teacherAbsenceLevel = parentTeacherAbsent ? eventLevel : null;
    renderParentSchedule();
  });

  socket.on("disconnect", () => {
    // Never leave an unverified positive state visible while the status socket
    // is unavailable. The ACK restores it once Socket.io reconnects.
    activeLiveClassType = null;
    setLiveClassVisible(false);
  });

  socket.on("classroom_error", (data = {}) => {
    if (data.event === "join_level_lobby" && data.message) {
      showError(data.message);
    }
  });
}

if (!getParentToken()) {
  // getParentToken has already initiated the login redirect.
} else {
  elements.joinLiveClassButton?.addEventListener("click", () => {
    void enterLiveClass();
  });
  elements.liveClassesEntryButton?.addEventListener("click", openLiveClassesEntryPage);
  elements.liveClassesWaitingExit?.addEventListener("click", () => {
    if (elements.liveClassesWaitingPanel) elements.liveClassesWaitingPanel.hidden = true;
  });
  elements.universityUpgradeButton?.addEventListener("click", openUniversityPaymentTransfer);
  wirePaymentReceiptActions({
    input: elements.parentPaymentReceiptInput,
    captureButton: elements.parentPaymentCapture,
    fileChoiceButton: elements.parentPaymentFileChoice,
    uploadButton: elements.parentPaymentUpload,
    choiceMenu: elements.parentPaymentChoiceMenu,
    fileName: elements.parentPaymentFileName,
    cardPaymentButton: elements.parentCardPaymentButton,
    submitAfterCapture: submitUniversityPaymentReceipt,
  });
  elements.parentPaymentSubmit?.addEventListener("click", () => {
    void submitUniversityPaymentReceipt();
  });
  elements.secondaryUpgradeButton?.addEventListener("click", openSecondaryPaymentTransfer);
  wirePaymentReceiptActions({
    input: elements.secondaryPaymentReceiptInput,
    captureButton: elements.secondaryPaymentCapture,
    fileChoiceButton: elements.secondaryPaymentFileChoice,
    uploadButton: elements.secondaryPaymentUpload,
    choiceMenu: elements.secondaryPaymentChoiceMenu,
    fileName: elements.secondaryPaymentFileName,
    cardPaymentButton: elements.secondaryCardPaymentButton,
    submitAfterCapture: submitSecondaryPaymentReceipt,
    onCardPayment: startSofizPayPayment,
  });
  elements.secondaryPaymentSubmit?.addEventListener("click", () => {
    void submitSecondaryPaymentReceipt();
  });
  elements.secondarySofizPayReconcileButton?.addEventListener("click", () => {
    void reconcileParentSofizPay();
  });
  elements.replacementCardButton?.addEventListener("click", () => {
    elements.replacementCardInput?.click();
  });
  elements.replacementCardInput?.addEventListener("change", () => {
    void uploadReplacementCard();
  });
  elements.logoutButton?.addEventListener("click", logout);
  elements.parentEmailForm?.addEventListener("submit", updateParentEmail);
  elements.parentSidebarLogout?.addEventListener("click", logout);
  elements.changeStudentButton?.addEventListener("click", openStudentPicker);
  elements.studentSwitcherClose?.addEventListener("click", closeStudentPicker);
  elements.studentSwitcher?.addEventListener("click", (event) => {
    if (event.target === elements.studentSwitcher) closeStudentPicker();
  });
  elements.parentSidebarToggle?.addEventListener("click", () => setParentSidebarOpen(!elements.parentSidebar?.classList.contains("is-open")));
  elements.parentSidebarClose?.addEventListener("click", () => setParentSidebarOpen(false));
  elements.parentSidebarBackdrop?.addEventListener("click", () => setParentSidebarOpen(false));
  elements.parentNavLinks.forEach((link) => link.addEventListener("click", () => { setParentActiveNav(link); setParentSidebarOpen(false); }));
  elements.documentFeedbackClose?.addEventListener("click", closeDocumentFeedback);
  elements.sofizpayInstructionCancel?.addEventListener("click", closeSofizPayInstruction);
  elements.sofizpayInstructionContinue?.addEventListener("click", () => {
    closeSofizPayInstruction();
    void startSofizPayPayment();
  });
  elements.sofizpayInstructionModal?.addEventListener("click", (event) => {
    if (event.target === elements.sofizpayInstructionModal) closeSofizPayInstruction();
  });
  elements.studentHomeworkFileClose?.addEventListener("click", closeStudentHomeworkFile);
  elements.studentHomeworkFileModal?.addEventListener("click", (event) => {
    if (event.target === elements.studentHomeworkFileModal) closeStudentHomeworkFile();
  });
  elements.studentHomeworkFileImage?.addEventListener("pointerdown", handleHomeworkFilePointerDown, { passive: false });
  elements.studentHomeworkFileImage?.addEventListener("pointermove", handleHomeworkFilePointerMove, { passive: false });
  elements.studentHomeworkFileImage?.addEventListener("pointerup", handleHomeworkFilePointerUp, { passive: false });
  elements.studentHomeworkFileImage?.addEventListener("pointercancel", handleHomeworkFilePointerUp, { passive: false });
  elements.documentFeedbackModal?.addEventListener("click", (event) => {
    if (event.target === elements.documentFeedbackModal) closeDocumentFeedback();
  });
  elements.lessonRepositoryToggle?.addEventListener("click", () => setLessonRepositoryOpen(!lessonRepositoryOpen));
  elements.studentHomeworkToggle?.addEventListener("click", () => setStudentHomeworkOpen(!studentHomeworkOpen));
  elements.studentCertificatesToggle?.addEventListener("click", () => setStudentCertificatesOpen(!studentCertificatesOpen));
  elements.studentCertificateModalClose?.addEventListener("click", closeCertificateImage);
  elements.studentCertificateModal?.addEventListener("click", (event) => {
    if (event.target === elements.studentCertificateModal) closeCertificateImage();
  });
  elements.lessonVideoClose?.addEventListener("click", closeLessonVideo);
  elements.lessonVideoFullscreen?.addEventListener("click", () => { void toggleLessonFullscreen(); });
  elements.lessonVideoRotate?.addEventListener("click", () => { void rotateLessonScreen(); });
  elements.lessonVideoZoomLayer?.addEventListener("pointerdown", handleLessonZoomPointerDown, { passive: false });
  elements.lessonVideoZoomLayer?.addEventListener("pointermove", handleLessonZoomPointerMove, { passive: false });
  elements.lessonVideoZoomLayer?.addEventListener("pointerup", handleLessonZoomPointerUp, { passive: false });
  elements.lessonVideoZoomLayer?.addEventListener("pointercancel", handleLessonZoomPointerUp, { passive: false });
  document.addEventListener("fullscreenchange", updateLessonFullscreenLabel);
  elements.lessonVideoModal?.addEventListener("click", (event) => {
    if (event.target === elements.lessonVideoModal) closeLessonVideo();
  });
  elements.levelScheduleImageButton?.addEventListener("click", () => {
    if (elements.levelScheduleImageModal) elements.levelScheduleImageModal.hidden = false;
    elements.levelScheduleImageClose?.focus();
  });
  elements.levelScheduleImageClose?.addEventListener("click", closeLevelScheduleImageModal);
  elements.levelScheduleImageModal?.addEventListener("click", (event) => {
    if (event.target === elements.levelScheduleImageModal || event.target.matches("[data-close-level-schedule]")) {
      closeLevelScheduleImageModal();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCertificateImage();
    }
  });
  elements.upgradeSubjectButton?.addEventListener("click", (event) => {
    event.preventDefault();
    const subscriptionType = paymentAccessUpgradeType;
    paymentAccessUpgradeType = null;
    lessonUpgradeContext = null;
    closePaymentAccessModal();
    if (subscriptionType) void startSofizPayPayment(subscriptionType);
    else if (currentStudent?.level === "طالب جامعي") void openUniversityPaymentTransfer();
    else void openSecondaryPaymentTransfer();
  });
  elements.callTeacherNowButton?.addEventListener("click", () => {
    paymentAccessUpgradeType = null;
    lessonUpgradeContext = null;
    closePaymentAccessModal();
  });
  elements.declineRegistrationButton?.addEventListener("click", () => {
    paymentAccessUpgradeType = null;
    lessonUpgradeContext = null;
    closePaymentAccessModal();
    window.location.assign("./parent-dashboard.html");
  });
  elements.paymentAccessModal?.addEventListener("click", (event) => {
    if (event.target === elements.paymentAccessModal) {
      closePaymentAccessModal();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setParentSidebarOpen(false);
      closeStudentHomeworkFile();
      closeDocumentFeedback();
      closePaymentAccessModal();
      closeLessonVideo();
      closeLevelScheduleImageModal();
    }
  });
  window.addEventListener("focus", refreshAccessAfterReturningFromCall);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshAccessAfterReturningFromCall();
    }
  });
  initializeLobbySocket();
  void loadDashboard().then(() => {
    void loadParentEmail();
    checkSofizPayReturn();
    window.dispatchEvent(new Event("parent-dashboard-ready"));
  });
}
