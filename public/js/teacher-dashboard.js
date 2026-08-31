"use strict";

const TEACHER_TOKEN_KEY = "teacherToken";

const elements = {
  levelButtons: Array.from(document.querySelectorAll(".level-btn[data-level], [data-level].level-button")),
  currentLevelTitle: document.querySelector("#current-level-title, #current-level, [data-current-level]"),
  studentsTableBody: document.querySelector("#students-table-body, #students-tbody, table tbody"),
  tableEmptyState: document.querySelector("#table-empty-state, #empty-state"),
  studentActionsModal: document.getElementById("student-actions-modal"),
  studentActionsModalClose: document.getElementById("student-actions-modal-close"),
  studentActionsTitle: document.getElementById("student-actions-title"),
  studentActionsLevel: document.getElementById("student-actions-level"),
  studentActionsList: document.getElementById("student-actions-list"),
  studentContactModal: document.getElementById("student-contact-modal"),
  studentContactModalClose: document.getElementById("student-contact-modal-close"),
  studentContactForm: document.getElementById("student-contact-form"),
  studentContactName: document.getElementById("student-contact-name"),
  studentContactPhone: document.getElementById("student-contact-phone"),
  studentContactMessage: document.getElementById("student-contact-message"),
  studentContactSubmit: document.getElementById("student-contact-submit"),
  dashboardError: document.querySelector("#dashboard-error, #message-box"),
  logoutButton: document.querySelector("#logout-btn, [data-action='logout']"),
  publicInviteButton: document.getElementById("public-invite-btn"),
  sidebar: document.getElementById("teacher-sidebar"),
  sidebarBackdrop: document.getElementById("teacher-sidebar-backdrop"),
  sidebarToggle: document.getElementById("teacher-sidebar-toggle"),
  sidebarClose: document.getElementById("teacher-sidebar-close"),
  sidebarLogout: document.getElementById("sidebar-logout-btn"),
  sidebarLinks: Array.from(document.querySelectorAll(".teacher-nav-link")),
  pageTitle: document.getElementById("teacher-page-title"),
  deleteModal: document.getElementById("confirm-delete-modal"),
  deleteModalMessage: document.getElementById("confirm-delete-message"),
  deleteModalClose: document.getElementById("close-confirm-delete"),
  deleteModalCancel: document.getElementById("cancel-confirm-delete"),
  deleteModalApprove: document.getElementById("approve-confirm-delete"),
  documentFeedbackModal: document.getElementById("document-feedback-modal"),
  documentFeedbackTitle: document.getElementById("document-feedback-title"),
  documentFeedbackMessage: document.getElementById("document-feedback-message"),
  documentFeedbackClose: document.getElementById("document-feedback-close"),

  toast: document.querySelector("#toast, #success-toast"),
  searchInput: document.getElementById("student-search"),
  studentSearchTrigger: document.getElementById("student-search-trigger"),
  studentSearchModal: document.getElementById("student-search-modal"),
  studentSearchForm: document.getElementById("student-search-form"),
  studentSearchModalInput: document.getElementById("student-search-modal-input"),
  studentSearchModalClose: document.getElementById("student-search-modal-close"),
  studentSearchModalCancel: document.getElementById("student-search-modal-cancel"),
  paymentFilter: document.getElementById("payment-filter"),
  rosterFilterButtons: Array.from(document.querySelectorAll(".roster-filter-button[data-payment-filter]")),
  summaryTotal: document.getElementById("summary-total"),
  summaryPaid: document.getElementById("summary-paid"),
  summaryUnpaid: document.getElementById("summary-unpaid"),
  filteredResultsLabel: document.getElementById("filtered-results-label"),
  attendanceModal: document.getElementById("attendance-modal"),
  attendanceStudentName: document.getElementById("attendance-student-name"),
  attendanceList: document.getElementById("attendance-list"),
  attendanceEmpty: document.getElementById("attendance-empty"),
  closeAttendanceButton: document.getElementById("close-attendance-modal"),
  subscriptionModal: document.getElementById("subscription-modal"),
  subscriptionForm: document.getElementById("subscription-form"),
  subscriptionStudentName: document.getElementById("subscription-student-name"),
  subscriptionPaymentStage: document.getElementById("subscription-payment-stage"),
  subscriptionTypeLabel: document.getElementById("subscription-type-label"),
  subscriptionLiveAccess: document.getElementById("subscription-live-access"),
  closeSubscriptionButton: document.getElementById("close-subscription-modal"),
  dashboardDate: document.getElementById("dashboard-date"),
  overviewSelectedLevel: document.getElementById("overview-selected-level"),
  overviewClassState: document.getElementById("overview-class-state"),
  overviewMonthlyRegistrations: document.getElementById("overview-monthly-registrations"),
  overviewTotalCaption: document.getElementById("overview-total-caption"),
  overviewConfirmedRevenue: document.getElementById("overview-confirmed-revenue"),
  overviewRevenueCaption: document.getElementById("overview-revenue-caption"),
  overviewPromisedCount: document.getElementById("overview-promised-count"),
  overviewPendingReceipts: document.getElementById("overview-pending-receipts"),
  overviewPaymentAttempts: document.getElementById("overview-payment-attempts"),
  overviewForgotPin: document.getElementById("overview-forgot-pin"),
  overviewClassTitle: document.getElementById("overview-class-title"),
  overviewClassCopy: document.getElementById("overview-class-copy"),
  bentoCurrentLevel: document.getElementById("bento-current-level"),
  quizCurrentLevel: document.getElementById("quiz-current-level"),
  bentoLiveEnabled: document.getElementById("bento-live-enabled"),
  bentoTotalCaption: document.getElementById("bento-total-caption"),
  paymentProgressBar: document.getElementById("payment-progress-bar"),
  paymentProgressCaption: document.getElementById("payment-progress-caption"),
  bentoMathCount: document.getElementById("bento-math-count"),
  bentoPhysicsCount: document.getElementById("bento-physics-count"),
  bentoLatestStudent: document.getElementById("bento-latest-student"),
  bentoLatestCaption: document.getElementById("bento-latest-caption"),
  bentoActivityStatus: document.getElementById("bento-activity-status"),
  focusStudentSearchButton: document.getElementById("focus-student-search"),
  jumpToRosterButton: document.getElementById("jump-to-roster"),
  studentsPanel: document.getElementById("students-panel"),
  studentPaymentHeading: document.getElementById("student-payment-heading"),
  paymentStatusModal: document.getElementById("payment-status-modal"),
  paymentStatusForm: document.getElementById("payment-status-form"),
  paymentStatusStudentName: document.getElementById("payment-status-student-name"),
  paymentStatusStage: document.getElementById("payment-status-stage"),
  paymentStatusAmount: document.getElementById("payment-status-amount"),
  paymentAmountField: document.getElementById("payment-amount-field"),
  closePaymentStatusButton: document.getElementById("close-payment-status-modal"),
  electronicPaymentsTableBody: document.getElementById("electronic-payments-table-body"),
  electronicPaymentsEmpty: document.getElementById("electronic-payments-empty"),
  electronicPaymentsCount: document.getElementById("electronic-payments-count"),
  electronicPaymentsSuccessCount: document.getElementById("electronic-payments-success-count"),
  electronicPaymentsAttemptCount: document.getElementById("electronic-payments-attempt-count"),
  manualPaymentsTableBody: document.getElementById("manual-payments-table-body"),
  manualPaymentsEmpty: document.getElementById("manual-payments-empty"),
  manualPaymentsCount: document.getElementById("manual-payments-count"),
  forgotPinRequestsTableBody: document.getElementById("forgot-pin-requests-table-body"),
  forgotPinRequestsEmpty: document.getElementById("forgot-pin-requests-empty"),
  forgotPinRequestsCount: document.getElementById("forgot-pin-requests-count"),
  teacherNotificationForm: document.getElementById("teacher-notification-form"),
  teacherNotificationSubject: document.getElementById("teacher-notification-subject"),
  teacherNotificationTitle: document.getElementById("teacher-notification-title-input"),
  teacherNotificationBody: document.getElementById("teacher-notification-body-input"),
  teacherNotificationChannelStatus: document.getElementById("teacher-notification-channel-status"),
  teacherNotificationSmsOption: document.querySelector('input[name="notification-channel"][value="SMS"]'),
  teacherNotificationBothOption: document.querySelector('input[name="notification-channel"][value="BOTH"]'),
  teacherNotificationMessengerOption: document.querySelector('input[name="notification-channel"][value="MESSENGER"]'),
  teacherNotificationImmediate: document.getElementById("teacher-notification-immediate"),
  teacherNotificationScheduled: document.getElementById("teacher-notification-scheduled"),
  teacherNotificationScheduleFields: document.getElementById("teacher-notification-schedule-fields"),
  teacherNotificationScheduledDate: document.getElementById("teacher-notification-scheduled-date"),
  teacherNotificationScheduledTime: document.getElementById("teacher-notification-scheduled-time"),
  teacherNotificationSubmit: document.getElementById("teacher-notification-submit"),
  teacherNotificationFeedback: document.getElementById("teacher-notification-feedback"),
  teacherNotificationAudienceText: document.getElementById("teacher-notification-audience-text"),
  teacherNotificationRecipientCount: document.getElementById("teacher-notification-recipient-count"),
  teacherNotificationTargetPicker: document.getElementById("teacher-notification-student-picker"),
  teacherNotificationStudentList: document.getElementById("teacher-notification-student-list"),
  teacherNotificationSelectAll: document.getElementById("teacher-notification-select-all"),
  teacherNotificationSentCount: document.getElementById("teacher-notification-sent-count"),
  teacherNotificationReadCount: document.getElementById("teacher-notification-read-count"),
  teacherNotificationUnreadCount: document.getElementById("teacher-notification-unread-count"),
  teacherNotificationHistoryList: document.getElementById("teacher-notification-history-list"),
  teacherNotificationRefresh: document.getElementById("teacher-notification-refresh"),
  cardPreviewModal: document.getElementById("student-card-preview-modal"),
  cardPreviewTitle: document.getElementById("student-card-preview-title"),
  cardPreviewStatus: document.getElementById("student-card-preview-status"),
  cardPreviewImage: document.getElementById("student-card-preview-image"),
  cardPreviewSaveDriveButton: document.getElementById("save-student-card-to-drive"),
  closeCardPreviewButton: document.getElementById("close-student-card-preview"),
  paymentReceiptPreviewModal: document.getElementById("payment-receipt-preview-modal"),
  paymentReceiptPreviewStatus: document.getElementById("payment-receipt-preview-status"),
  paymentReceiptPreviewImage: document.getElementById("payment-receipt-preview-image"),
  paymentReceiptPreviewFrame: document.getElementById("payment-receipt-preview-frame"),
  paymentReceiptPreviewPdf: document.getElementById("payment-receipt-preview-pdf"),
  paymentReceiptOpenButton: document.getElementById("open-payment-receipt-pdf"),
  paymentReceiptSaveDriveButton: document.getElementById("save-payment-receipt-to-drive"),
  closePaymentReceiptPreviewButton: document.getElementById("close-payment-receipt-preview"),
  scheduleManager: document.getElementById("schedule-manager"),
  scheduleManagerToggle: document.getElementById("schedule-manager-toggle"),
  scheduleManagerContent: document.getElementById("schedule-manager-content"),
  scheduleManagerToggleIcon: document.getElementById("schedule-manager-toggle-icon"),
  scheduleForm: document.getElementById("schedule-form"),
  scheduleSubject: document.getElementById("schedule-subject"),
  scheduleDateTime: document.getElementById("schedule-datetime"),
  scheduleSubmitButton: document.getElementById("schedule-submit-btn"),
  scheduleCancelButton: document.getElementById("schedule-cancel-edit-btn"),
  scheduledClassList: document.getElementById("scheduled-class-list"),
  scheduleLevelCaption: document.getElementById("schedule-level-caption"),
  teacherAbsenceButton: document.getElementById("teacher-absence-btn"),
  teacherAbsenceStatus: document.getElementById("teacher-absence-status"),
  globalAbsenceButton: document.getElementById("teacher-global-absence-btn"),
  globalAbsenceStatus: document.getElementById("teacher-global-absence-status"),
  onlineUsersButton: document.getElementById("online-users-button"),
  onlineUsersCount: document.getElementById("online-users-count"),
  onlineUsersModal: document.getElementById("online-users-modal"),
  onlineUsersModalClose: document.getElementById("online-users-modal-close"),
  onlineUsersSummary: document.getElementById("online-users-summary"),
  onlineUsersList: document.getElementById("online-users-list"),
  lessonVideoForm: document.getElementById("lesson-video-form"),
  lessonVideoType: document.getElementById("lesson-video-type"),
  lessonVideoTypeHelp: document.getElementById("lesson-video-type-help"),
  driveVideoTypeLabel: document.getElementById("drive-video-type-label"),
  lessonVideoTitle: document.getElementById("lesson-video-title"),
  lessonVideoUrl: document.getElementById("lesson-video-url"),
  lessonVideoSubmit: document.getElementById("lesson-video-submit"),
  lessonVideoPicker: document.getElementById("lesson-video-picker"),
  lessonVideoList: document.getElementById("teacher-lesson-video-list"),
  lessonVideoModal: document.getElementById("lesson-video-modal"),
  lessonVideoModalOpen: document.getElementById("lesson-video-modal-open"),
  lessonVideoModalClose: document.getElementById("lesson-video-modal-close"),
  driveVideoModal: document.getElementById("drive-video-modal"),
  closeDriveVideoModal: document.getElementById("close-drive-video-modal"),
  driveVideoList: document.getElementById("drive-video-list"),
  lessonRepositoryManager: document.getElementById("lesson-repository-manager"),
  lessonRepositoryToggle: document.getElementById("lesson-repository-toggle"),
  lessonRepositoryControls: document.getElementById("lesson-repository-controls"),
  lessonRepositoryToggleIcon: document.getElementById("lesson-repository-toggle-icon"),
  lessonRepositoryCaption: document.getElementById("lesson-repository-caption"),
  assignmentManager: document.getElementById("assignment-manager"),
  assignmentManagerToggle: document.getElementById("assignment-manager-toggle"),
  assignmentManagerControls: document.getElementById("assignment-manager-controls"),
  assignmentManagerToggleIcon: document.getElementById("assignment-manager-toggle-icon"),
  assignmentLevelCaption: document.getElementById("assignment-level-caption"),
  assignmentForm: document.getElementById("assignment-form"),
  assignmentSubject: document.getElementById("assignment-subject"),
  assignmentDueAt: document.getElementById("assignment-due-at"),
  assignmentTitle: document.getElementById("assignment-title"),
  assignmentDescription: document.getElementById("assignment-description"),
  assignmentFile: document.getElementById("assignment-file"),
  assignmentSubmit: document.getElementById("assignment-submit"),
  teacherAssignmentsList: document.getElementById("teacher-assignments-list"),
  teacherSubmissionsModal: document.getElementById("teacher-submissions-modal"),
  teacherSubmissionsModalClose: document.getElementById("teacher-submissions-modal-close"),
  teacherSubmissionsAssignmentTitle: document.getElementById("teacher-submissions-assignment-title"),
  teacherSubmissionsList: document.getElementById("teacher-submissions-list"),
  studentCertificatesModal: document.getElementById("student-certificates-modal"),
  studentCertificatesModalClose: document.getElementById("student-certificates-modal-close"),
  studentCertificatesStudentName: document.getElementById("student-certificates-student-name"),
  studentCertificateForm: document.getElementById("student-certificate-form"),
  studentCertificateTitle: document.getElementById("student-certificate-title"),
  studentCertificateAwardedAt: document.getElementById("student-certificate-awarded-at"),
  studentCertificateDescription: document.getElementById("student-certificate-description"),
  studentCertificateImage: document.getElementById("student-certificate-image"),
  studentCertificateSubmit: document.getElementById("student-certificate-submit"),
  teacherStudentCertificatesList: document.getElementById("teacher-student-certificates-list"),
};

let currentLevel =
  document.querySelector(".level-btn.is-active, .level-btn.active, .level-button.is-active")?.dataset
    .level || "السنة الأولى";

const LEVEL_DISPLAY_LABELS = Object.freeze({
  "السنة الأولى": "السنة الأولى متوسط",
  "السنة الثانية": "السنة الثانية متوسط",
  "السنة الثالثة": "السنة الثالثة متوسط",
  "السنة الرابعة": "السنة الرابعة متوسط",
  "طالب جامعي": "طالب جامعي",
});

function displayLevelLabel(level) {
  return LEVEL_DISPLAY_LABELS[level] || level || "—";
}

// Prompt 14 source of truth: complete API data for the selected level.
let currentStudents = [];
let subscriptionStudentId = null;
let toastTimer = null;
let scheduledClasses = [];
let teacherAbsent = false;
let globalTeacherAbsent = false;
let globalAbsenceBusy = false;
let editingScheduledClassId = null;
let scheduleManagerOpen = false;
let lessonRepositoryOpen = false;
let assignmentManagerOpen = false;
let assignmentPastedImage = null;
let assignmentPastedImageUrl = null;
let activeSubmissionImageUrls = new Set();
let paymentStatusStudentId = null;
let lessonVideos = [];
let googlePickerApiKey = null;
let googlePickerAppId = null;
let googlePickerLoadPromise = null;
let googleDriveListPromise = null;
let googlePickerAccessToken = null;
let googlePickerTokenExpiresAt = 0;
let googleDriveUploadAccessToken = null;
let googleDriveUploadTokenExpiresAt = 0;
let cardPreviewObjectUrl = null;
let cardPreviewRequestId = 0;
let cardPreviewPreviousFocus = null;
let cardPreviewStudentId = null;
let paymentReceiptPreviewObjectUrl = null;
let paymentReceiptPreviewRequestId = 0;
let paymentReceiptPreviewStudentId = null;
let electronicPayments = [];
let electronicPaymentsLevel = "";
let forgotPinRequests = [];
let forgotPinRequestsLevel = "";
let forgotPinPollTimer = null;
let pendingDeleteStudentId = null;
const driveFileUploadInProgress = new Set();

function clearTeacherSession() {
  sessionStorage.removeItem(TEACHER_TOKEN_KEY);
  sessionStorage.removeItem("teacherAuth");
  sessionStorage.removeItem("userRole");
}

function redirectToTeacherLogin() {
  clearTeacherSession();
  window.location.replace("./teacher-login.html");
}

function getTeacherToken() {
  const token = sessionStorage.getItem(TEACHER_TOKEN_KEY);

  if (!token) {
    redirectToTeacherLogin();
    return null;
  }

  return token;
}

function openDocumentFeedback(message, title = "تعذر إتمام العملية") {
  if (!elements.documentFeedbackModal) {
    showDashboardError(message);
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

function showDashboardError(message = "") {
  if (!elements.dashboardError) {
    return;
  }

  elements.dashboardError.textContent = message;
  elements.dashboardError.hidden = !message;
  elements.dashboardError.classList.toggle("is-visible", Boolean(message));
}

function secondarySubscriptionMode(student) {
  if (student.mathEnrollment && student.physicsEnrollment) return "BOTH";
  if (student.physicsEnrollment) return "PHYSICS";
  if (student.mathEnrollment) return "MATH";
  return "NONE";
}

function paymentStageMeta(student) {
  if (student.level !== "طالب جامعي") {
    const mode = secondarySubscriptionMode(student);
    return mode === "BOTH"
      ? { label: "فيزياء ورياضيات", className: "is-paid" }
      : mode === "PHYSICS"
        ? { label: "فيزياء فقط", className: "is-unpaid" }
        : mode === "MATH"
          ? { label: "رياضيات فقط", className: "is-unpaid" }
          : { label: "لم تختَر المواد بعد", className: "is-unpaid" };
  }

  const stage = student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");
  return stage === "PAID"
    ? { label: "اشتراك مدفوع", className: "is-paid" }
    : { label: "اشتراك مجاني", className: "is-unpaid" };
}

function secondaryPaymentStatusMeta(student) {
  const stage = student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");
  const amount = Number.isSafeInteger(student.amountDue) && student.amountDue > 0
    ? ` — ${student.amountDue.toLocaleString("ar-DZ")} دج`
    : "";
  return stage === "PAID"
    ? { label: `تم تأكيد الدفع${amount}`, className: "is-paid" }
    : stage === "PROMISED"
      ? { label: `الوعد بالدفع${amount}`, className: "is-promised" }
      : { label: "لم يتم الدفع", className: "is-unpaid" };
}

function accountStatusMeta(student) {
  if (student.level === "طالب جامعي") {
    if (student.cardReuploadRequested) {
      return { label: "إعادة رفع البطاقة مطلوبة", className: "is-inactive" };
    }

    if (student.accountActive === false && student.cardPhotoUrl) {
      return { label: "في انتظار تأكيد هوية البطاقة", className: "is-pending" };
    }
  }

  return student.accountActive !== false
    ? { label: "حساب مفعّل", className: "is-active" }
    : { label: "حساب غير مفعّل", className: "is-inactive" };
}

function showToast(message) {
  if (!elements.toast) {
    return;
  }

  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  elements.toast.classList.add("is-visible");

  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
    elements.toast.classList.remove("is-visible");
  }, 3_000);
}

/**
 * Performs a protected API request. Any expired, invalid, or unauthorized JWT
 * immediately ends the local teacher session and returns the user to login.
 */
async function teacherFetch(url, options = {}) {
  const token = getTeacherToken();
  if (!token) {
    throw new Error("انتهت جلسة الأستاذ.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 || response.status === 403) {
    redirectToTeacherLogin();
    throw new Error("انتهت الجلسة أو لا تملك الصلاحية المطلوبة.");
  }

  return response;
}

const GOOGLE_DRIVE_CLIENT_ID = "938017291163-a6dar2h6u2d5isf5h4nqtaccp7jpkk28.apps.googleusercontent.com";
const GOOGLE_DRIVE_FILE_SCOPE = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ");
const GOOGLE_DRIVE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/drive.file";
const VIDEO_MIME_TYPES = "video/mp4,video/webm,video/quicktime,video/x-matroska,video/avi,video/mpeg";
const GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

function isGooglePickerTokenUsable() {
  return Boolean(googlePickerAccessToken && Date.now() < googlePickerTokenExpiresAt - 60_000);
}

function waitForGoogleScript(scriptId, src, isReady) {
  if (isReady()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let script = document.getElementById(scriptId);
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = src;
      script.defer = true;
      document.head.append(script);
    }

    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearInterval(checkTimer);
      window.clearTimeout(timeoutTimer);
      callback(value);
    };
    const check = () => {
      if (isReady()) finish(resolve);
    };
    const checkTimer = window.setInterval(check, 100);
    const timeoutTimer = window.setTimeout(() => {
      finish(reject, new Error("تعذر تحميل خدمة Google. تحقق من اتصال الإنترنت أو من إعدادات Chrome."));
    }, 10_000);
    script.addEventListener("load", check, { once: true });
    script.addEventListener("error", () => {
      finish(reject, new Error("تعذر تحميل خدمة Google. تحقق من اتصال الإنترنت أو من إعدادات Chrome."));
    }, { once: true });
    check();
  });
}

async function ensureGooglePickerReady() {
  if (!googlePickerLoadPromise) {
    googlePickerLoadPromise = waitForGoogleScript(
      "google-identity-services",
      "https://accounts.google.com/gsi/client",
      () => Boolean(window.google?.accounts?.oauth2),
    ).catch((error) => {
      googlePickerLoadPromise = null;
      throw error;
    });
  }
  return googlePickerLoadPromise;
}

async function loadGooglePickerConfiguration() {
  if (googlePickerApiKey && googlePickerAppId) return;
  const response = await teacherFetch("/api/google-picker/config", {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.apiKey || !payload.appId) {
    throw new Error(payload.error || "تعذر إعداد اختيار ملفات Google Drive.");
  }
  googlePickerApiKey = payload.apiKey;
  googlePickerAppId = payload.appId;
}

async function requestGooglePickerToken() {
  if (isGooglePickerTokenUsable()) return googlePickerAccessToken;
  await ensureGooglePickerReady();

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_DRIVE_CLIENT_ID,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        if (response?.error || !response?.access_token) {
          reject(new Error(response?.error_description || "لم يتم منح إذن اختيار فيديو من Google Drive."));
          return;
        }
        googlePickerAccessToken = response.access_token;
        googlePickerTokenExpiresAt = Date.now() + (Number(response.expires_in) || 3_600) * 1_000;
        resolve(googlePickerAccessToken);
      },
      error_callback: (error) => {
        reject(new Error(error?.message || "تم إغلاق نافذة تسجيل الدخول إلى Google."));
      },
    });
    tokenClient.requestAccessToken({ prompt: "", include_granted_scopes: false });
  });
}

async function requestGoogleDriveUploadToken() {
  if (googleDriveUploadAccessToken && Date.now() < googleDriveUploadTokenExpiresAt - 60_000) {
    return googleDriveUploadAccessToken;
  }
  await ensureGooglePickerReady();

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_DRIVE_CLIENT_ID,
      scope: GOOGLE_DRIVE_UPLOAD_SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        if (response?.error || !response?.access_token) {
          reject(new Error(response?.error_description || "لم يتم منح صلاحية رفع المستند إلى Google Drive."));
          return;
        }
        googleDriveUploadAccessToken = response.access_token;
        googleDriveUploadTokenExpiresAt = Date.now() + (Number(response.expires_in) || 3_600) * 1_000;
        resolve(googleDriveUploadAccessToken);
      },
      error_callback: (error) => {
        reject(new Error(error?.message || "تم إغلاق نافذة صلاحية Google Drive."));
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent", include_granted_scopes: false });
  });
}

function safeDriveFilePart(value, fallback = "ملف") {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || fallback;
}

async function teacherDriveRequest(url, options, accessToken) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(details?.error?.message || `تعذر الاتصال بـ Google Drive (${response.status}).`);
  }
  return response;
}

function escapeTeacherDriveQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function ensureTeacherDriveFolder(name, parentId, accessToken) {
  const conditions = [
    `name = '${escapeTeacherDriveQueryValue(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ];
  if (parentId) conditions.push(`'${escapeTeacherDriveQueryValue(parentId)}' in parents`);
  const query = encodeURIComponent(conditions.join(" and "));
  const fields = encodeURIComponent("files(id,name)");
  const listResponse = await teacherDriveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=${fields}&pageSize=1`,
    { method: "GET" },
    accessToken
  );
  const existing = await listResponse.json();
  if (existing.files?.[0]?.id) return existing.files[0].id;

  const createResponse = await teacherDriveRequest(
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
    accessToken
  );
  const created = await createResponse.json();
  if (!created.id) throw new Error("تعذر إنشاء مجلد مستندات الطلبة في Google Drive.");
  return created.id;
}

async function uploadStudentBlobToDrive({ student, kind, blob, accessToken }) {
  const isCard = kind === "card";
  const rootFolderId = await ensureTeacherDriveFolder("مستندات الطلبة", null, accessToken);
  const typeFolderId = await ensureTeacherDriveFolder(isCard ? "بطاقات الطلبة" : "وصول الدفع", rootFolderId, accessToken);
  const levelFolderId = await ensureTeacherDriveFolder(
    displayLevelLabel(student.level || "غير محدد"),
    typeFolderId,
    accessToken
  );
  const mimeType = blob.type || "application/octet-stream";
  const extension = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const label = isCard ? "بطاقة-الطالب" : "وصل-الدفع";
  const fileName = `${safeDriveFilePart(student.studentName, "طالب")}-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  const sessionResponse = await teacherDriveRequest(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(blob.size),
      },
      body: JSON.stringify({ name: fileName, mimeType, parents: [levelFolderId] }),
    },
    accessToken
  );
  const sessionUrl = sessionResponse.headers.get("Location");
  if (!sessionUrl) throw new Error("تعذر تجهيز رفع المستند إلى Google Drive.");

  let offset = 0;
  while (offset < blob.size) {
    const end = Math.min(offset + GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE, blob.size);
    const response = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mimeType,
        "Content-Range": `bytes ${offset}-${end - 1}/${blob.size}`,
      },
      body: blob.slice(offset, end),
    });
    if (response.status === 308) {
      offset = end;
      showToast(`جارٍ رفع ${isCard ? "البطاقة" : "وصل الدفع"}: ${Math.round((offset / blob.size) * 100)}%`);
      continue;
    }
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw new Error(details?.error?.message || `تعذر رفع المستند (${response.status}).`);
    }
    return response.json();
  }
  throw new Error("لم يكتمل رفع المستند إلى Google Drive.");
}

async function saveStudentDocumentToDrive(studentId, kind, button) {
  const student = currentStudents.find((item) => item.id === studentId);
  const fileUrl = kind === "card" ? student?.cardPhotoUrl : student?.paymentReceiptUrl;
  if (!student || !fileUrl) {
    openDocumentFeedback(kind === "card" ? "لا توجد صورة بطاقة محفوظة لهذا المستخدم." : "وصل الدفع غير متاح حالياً لهذا المستخدم.", kind === "card" ? "البطاقة غير متاحة" : "وصل الدفع غير متاح");
    return;
  }

  const uploadKey = `${kind}:${studentId}`;
  if (driveFileUploadInProgress.has(uploadKey)) return;
  driveFileUploadInProgress.add(uploadKey);
  const originalLabel = button?.textContent || "حفظ في Google Drive";
  if (button) {
    button.disabled = true;
    button.textContent = "جارٍ الحفظ…";
  }

  try {
    const response = await teacherFetch(
      `/api/students/${encodeURIComponent(studentId)}/${kind === "card" ? "card-photo" : "payment-receipt"}`,
      { headers: { Accept: "image/*, application/pdf" } }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "تعذر تحميل الملف قبل حفظه.");
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("الملف المرفوع فارغ.");
    const isPdf = blob.type === "application/pdf";
    const isImage = blob.type.startsWith("image/");
    if (!isPdf && !isImage && blob.type !== "application/octet-stream") throw new Error("الملف المرفوع ليس صورة أو PDF صالحًا.");

    showToast("جارٍ فتح صلاحية Google Drive…");
    const accessToken = await requestGoogleDriveUploadToken();
    await uploadStudentBlobToDrive({ student, kind, blob, accessToken });
    showToast(`تم حفظ ${kind === "card" ? "بطاقة الطالب" : "وصل الدفع"} في Google Drive.`);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to save student document to Google Drive:", error);
      openDocumentFeedback(error.message || "تعذر حفظ الملف في Google Drive.", "تعذر حفظ الوثيقة");
    }
  } finally {
    driveFileUploadInProgress.delete(uploadKey);
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function closeDriveVideoModal() {
  if (elements.driveVideoModal) {
    elements.driveVideoModal.hidden = true;
    elements.driveVideoModal.classList.remove("is-visible");
  }
}

async function fetchGoogleDriveVideos(accessToken) {
  const query = "mimeType contains 'video/' and trashed = false";
  const fields = "files(id, name, mimeType, size, modifiedTime, webViewLink)";
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=50&orderBy=modifiedTime desc`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || "تعذر تحميل قائمة الفيديوهات من Google Drive.");
  }

  const data = await response.json();
  return data.files || [];
}

function renderDriveVideoList(files) {
  if (!elements.driveVideoList) return;
  elements.driveVideoList.innerHTML = "";

  if (!files || files.length === 0) {
    const empty = document.createElement("p");
    empty.className = "drive-video-empty";
    empty.textContent = "لا توجد ملفات فيديو في حسابك على Google Drive.";
    elements.driveVideoList.append(empty);
    return;
  }

  files.forEach((file) => {
    const button = document.createElement("button");
    button.className = "drive-video-item";
    button.type = "button";

    const copy = document.createElement("div");
    copy.className = "drive-video-item-copy";

    const title = document.createElement("span");
    title.className = "drive-video-item-title";
    title.textContent = file.name;

    const meta = document.createElement("span");
    meta.className = "drive-video-item-meta";
    const date = new Date(file.modifiedTime).toLocaleDateString("ar-DZ");
    const size = file.size ? `${(Number(file.size) / (1024 * 1024)).toFixed(1)} MB` : "حجم غير معروف";
    meta.textContent = `${date} — ${size}`;

    copy.append(title, meta);

    const icon = document.createElement("span");
    icon.className = "drive-video-item-icon";
    icon.textContent = "🎬";

    button.append(copy, icon);

    button.addEventListener("click", () => {
      const driveUrl = `https://drive.google.com/file/d/${file.id}/view`;
      if (elements.lessonVideoTitle) elements.lessonVideoTitle.value = file.name;
      if (elements.lessonVideoUrl) elements.lessonVideoUrl.value = driveUrl;
      closeDriveVideoModal();
      void saveLessonVideo(null, { title: file.name, driveUrl });
    });

    elements.driveVideoList.append(button);
  });
}

async function openGoogleDriveVideoPicker() {
  if (!elements.lessonVideoPicker || !elements.driveVideoModal) return;
  updateLessonVideoTypeLabel();
  elements.lessonVideoPicker.disabled = true;
  const originalLabel = elements.lessonVideoPicker.textContent;
  elements.lessonVideoPicker.textContent = "جارٍ الاتصال بـ Google…";

  try {
    await ensureGooglePickerReady();
    const accessToken = await requestGooglePickerToken();

    elements.driveVideoModal.hidden = false;
    elements.driveVideoModal.classList.add("is-visible");
    if (elements.driveVideoList) {
      elements.driveVideoList.innerHTML = '<p class="drive-video-loading">جارٍ تحميل قائمة الفيديوهات…</p>';
    }

    const files = await fetchGoogleDriveVideos(accessToken);
    renderDriveVideoList(files);
  } catch (error) {
    console.error("Unable to list Google Drive videos:", error);
    showDashboardError(error.message || "تعذر فتح فيديوهات Google Drive.");
    closeDriveVideoModal();
  } finally {
    elements.lessonVideoPicker.disabled = false;
    elements.lessonVideoPicker.textContent = originalLabel || "اختيار فيديو من Google Drive";
  }
}

function setActiveLevelButton(level) {
  elements.levelButtons.forEach((button) => {
    const isActive = button.dataset.level === level;
    button.classList.toggle("is-active", isActive);
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-current", isActive ? "true" : "false");
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function setCurrentLevelHeading(level) {
  if (elements.currentLevelTitle) {
    elements.currentLevelTitle.textContent = displayLevelLabel(level);
  }
  if (elements.bentoCurrentLevel) {
    elements.bentoCurrentLevel.textContent = displayLevelLabel(level);
  }
  if (elements.overviewSelectedLevel) {
    elements.overviewSelectedLevel.textContent = displayLevelLabel(level);
  }
  if (elements.quizCurrentLevel) {
    elements.quizCurrentLevel.textContent = displayLevelLabel(level);
  }
  if (elements.studentPaymentHeading) {
    elements.studentPaymentHeading.textContent = level === "طالب جامعي" ? "بطاقة الطالب" : "حالة الدفع";
  }
}

function getLessonVideoTypeOptions(level) {
  return level === "طالب جامعي"
    ? [
        { value: "FREE", label: "حصص مجانية" },
        { value: "PAID", label: "حصص مدفوعة" },
      ]
    : [
        { value: "MATH", label: "دروس الرياضيات" },
        { value: "PHYSICS", label: "دروس الفيزياء" },
      ];
}

function syncLessonVideoTypeOptions() {
  if (!elements.lessonVideoType) return;
  const options = getLessonVideoTypeOptions(currentLevel);
  const previousValue = elements.lessonVideoType.value;
  elements.lessonVideoType.replaceChildren();
  options.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    elements.lessonVideoType.append(option);
  });
  if (options.some((option) => option.value === previousValue)) {
    elements.lessonVideoType.value = previousValue;
  }
  updateLessonVideoTypeLabel();
}

function updateLessonVideoTypeLabel() {
  const selected = getLessonVideoTypeOptions(currentLevel).find(
    (option) => option.value === elements.lessonVideoType?.value,
  );
  const label = selected?.label || "التصنيف المحدد";
  if (elements.lessonVideoTypeHelp) {
    elements.lessonVideoTypeHelp.textContent = currentLevel === "طالب جامعي"
      ? `${label}: يظهر الفيديو للطالب المجاني أو المدفوع حسب نوع الاشتراك.`
      : `${label}: يظهر الفيديو فقط للتلميذ المسجل في هذه المادة.`;
  }
  if (elements.driveVideoTypeLabel) {
    elements.driveVideoTypeLabel.textContent = label;
  }
}

function truncateText(value, maxLength = 55) {
  const text = String(value || "").trim();
  if (!text) {
    return "—";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function scheduleTypeOptions(level) {
  return level === "طالب جامعي"
    ? [
        { value: "PAID", label: "اشتراك مدفوع" },
        { value: "FREE", label: "اشتراك مجاني" },
      ]
    : [
        { value: "MATH", label: "الرياضيات" },
        { value: "PHYSICS", label: "الفيزياء" },
      ];
}

function scheduleTypeLabel(level, subject) {
  return scheduleTypeOptions(level).find((item) => item.value === subject)?.label || "نوع غير معروف";
}

function toDateTimeLocalValue(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatScheduledDate(value) {
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

function syncScheduleSubjectOptions(selectedValue) {
  if (!elements.scheduleSubject) return;
  const previousValue = selectedValue || elements.scheduleSubject.value;
  elements.scheduleSubject.replaceChildren();
  scheduleTypeOptions(currentLevel).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    elements.scheduleSubject.append(option);
  });
  const values = scheduleTypeOptions(currentLevel).map((item) => item.value);
  elements.scheduleSubject.value = values.includes(previousValue) ? previousValue : values[0];
}

function resetScheduleForm() {
  editingScheduledClassId = null;
  if (elements.scheduleForm) elements.scheduleForm.reset();
  syncScheduleSubjectOptions();
  if (elements.scheduleSubmitButton) elements.scheduleSubmitButton.textContent = "إضافة حصة";
  if (elements.scheduleCancelButton) elements.scheduleCancelButton.hidden = true;
}

function renderScheduledClasses() {
  if (!elements.scheduledClassList) return;
  elements.scheduledClassList.replaceChildren();

  if (!scheduledClasses.length) {
    const empty = document.createElement("p");
    empty.className = "scheduled-class-empty";
    empty.textContent = "لا توجد حصص مبرمجة لهذا المستوى بعد.";
    elements.scheduledClassList.append(empty);
    return;
  }

  scheduledClasses.forEach((scheduledClass) => {
    const item = document.createElement("article");
    item.className = "scheduled-class-item";
    const info = document.createElement("div");
    info.className = "scheduled-class-info";
    const title = document.createElement("strong");
    title.textContent = scheduleTypeLabel(currentLevel, scheduledClass.subject);
    const date = document.createElement("span");
    date.textContent = formatScheduledDate(scheduledClass.scheduledAt);
    info.append(title, date);

    const actions = document.createElement("div");
    actions.className = "scheduled-class-actions";
    actions.append(
      createButton("تعديل", "edit", () => beginScheduleEdit(scheduledClass.id)),
      createButton("حذف", "delete", () => void deleteScheduledClass(scheduledClass.id))
    );
    item.append(info, actions);
    elements.scheduledClassList.append(item);
  });
}

function setAssignmentManagerOpen(nextOpen) {
  assignmentManagerOpen = Boolean(nextOpen);
  if (elements.assignmentManagerControls) elements.assignmentManagerControls.hidden = !assignmentManagerOpen;
  elements.assignmentManager?.classList.toggle("is-open", assignmentManagerOpen);
  elements.assignmentManagerToggle?.setAttribute("aria-expanded", String(assignmentManagerOpen));
  if (elements.assignmentManagerToggleIcon) elements.assignmentManagerToggleIcon.textContent = assignmentManagerOpen ? "⌃" : "⌄";
}

function setLessonRepositoryOpen(nextOpen) {
  lessonRepositoryOpen = Boolean(nextOpen);
  if (elements.lessonRepositoryControls) elements.lessonRepositoryControls.hidden = !lessonRepositoryOpen;
  elements.lessonRepositoryManager?.classList.toggle("is-open", lessonRepositoryOpen);
  elements.lessonRepositoryToggle?.setAttribute("aria-expanded", String(lessonRepositoryOpen));
  if (elements.lessonRepositoryToggleIcon) elements.lessonRepositoryToggleIcon.textContent = lessonRepositoryOpen ? "⌃" : "⌄";
}

function setScheduleManagerOpen(nextOpen) {
  scheduleManagerOpen = Boolean(nextOpen);
  if (elements.scheduleManagerContent) elements.scheduleManagerContent.hidden = !scheduleManagerOpen;
  elements.scheduleManager?.classList.toggle("is-open", scheduleManagerOpen);
  elements.scheduleManagerToggle?.setAttribute("aria-expanded", String(scheduleManagerOpen));
  if (elements.scheduleManagerToggleIcon) elements.scheduleManagerToggleIcon.textContent = scheduleManagerOpen ? "⌃" : "⌄";
}

function renderGlobalTeacherAbsence() {
  if (elements.globalAbsenceButton) {
    elements.globalAbsenceButton.classList.toggle("is-active", globalTeacherAbsent);
    elements.globalAbsenceButton.setAttribute("aria-pressed", String(globalTeacherAbsent));
    elements.globalAbsenceButton.disabled = globalAbsenceBusy;
    elements.globalAbsenceButton.textContent = globalTeacherAbsent
      ? "إلغاء إعلان الغياب"
      : "الإعلان عن الغياب";
  }
  if (elements.globalAbsenceStatus) {
    elements.globalAbsenceStatus.classList.toggle("is-absent", globalTeacherAbsent);
    elements.globalAbsenceStatus.classList.toggle("is-present", !globalTeacherAbsent);
    elements.globalAbsenceStatus.textContent = globalTeacherAbsent
      ? "الأستاذ غائب"
      : "الأستاذ حاضر";
  }
}

async function loadGlobalTeacherAbsence() {
  try {
    const response = await teacherFetch("/api/schedules/absence/global", {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل حالة الغياب العامة.");
    globalTeacherAbsent = payload.data?.isAbsent === true;
    renderGlobalTeacherAbsence();
    updateOverviewClassState();
  } catch (error) {
    console.error("Unable to load global teacher absence:", error);
    showDashboardError(error.message || "تعذر تحميل حالة الغياب العامة.");
  }
}

async function toggleGlobalTeacherAbsence() {
  if (globalAbsenceBusy) return;
  globalAbsenceBusy = true;
  renderGlobalTeacherAbsence();
  try {
    const response = await teacherFetch("/api/schedules/absence/global", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ isAbsent: !globalTeacherAbsent }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحديث حالة الغياب العامة.");

    globalTeacherAbsent = payload.data?.isAbsent === true;
    renderGlobalTeacherAbsence();
    updateOverviewClassState();
    showToast(payload.message || "تم تحديث حالة الغياب العامة.");
  } catch (error) {
    console.error("Unable to update global teacher absence:", error);
    showDashboardError(error.message || "تعذر تحديث حالة الغياب العامة.");
  } finally {
    globalAbsenceBusy = false;
    renderGlobalTeacherAbsence();
  }
}

function renderTeacherAbsence() {
  if (elements.scheduleLevelCaption) {
    elements.scheduleLevelCaption.textContent = `أضف وعدّل واحذف حصص ${displayLevelLabel(currentLevel)}.`;
  }
  if (elements.teacherAbsenceButton) {
    elements.teacherAbsenceButton.classList.toggle("is-active", teacherAbsent);
    elements.teacherAbsenceButton.textContent = teacherAbsent
      ? "إلغاء حالة غياب الأستاذ"
      : "الأستاذ غائب اليوم";
  }
  if (elements.teacherAbsenceStatus) {
    elements.teacherAbsenceStatus.hidden = !teacherAbsent;
    elements.teacherAbsenceStatus.textContent = teacherAbsent
      ? "الأستاذ غائب اليوم. ستظهر هذه الرسالة لتلاميذ هذا المستوى."
      : "";
  }
  updateOverviewClassState();
}

async function loadLevelSchedule() {
  try {
    const response = await teacherFetch(`/api/schedules/${encodeURIComponent(currentLevel)}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل برنامج الحصص.");

    scheduledClasses = Array.isArray(payload.scheduledClasses) ? payload.scheduledClasses : [];
    teacherAbsent = payload.teacherAbsent === true;
    renderTeacherAbsence();
    renderScheduledClasses();
  } catch (error) {
    console.error("Unable to load level schedule:", error);
    showDashboardError(error.message || "تعذر تحميل برنامج الحصص.");
  }
}

function renderLessonVideos() {
  if (elements.lessonRepositoryCaption) {
    elements.lessonRepositoryCaption.textContent = `أضف رابط YouTube وعنوانًا لفيديو مكمل لمستوى ${displayLevelLabel(currentLevel)} ليشاهده التلاميذ المؤهلون داخل حساباتهم.`;
  }
  if (!elements.lessonVideoList) return;

  elements.lessonVideoList.replaceChildren();
  if (!lessonVideos.length) {
    const empty = document.createElement("p");
    empty.className = "teacher-lesson-empty";
    empty.textContent = "لا توجد فيديوهات مكملة مضافة لهذا المستوى بعد.";
    elements.lessonVideoList.append(empty);
    return;
  }

  lessonVideos.forEach((video) => {
    const item = document.createElement("article");
    item.className = "teacher-lesson-video-item";
    const copy = document.createElement("div");
    copy.className = "teacher-lesson-video-copy";
    const title = document.createElement("strong");
    title.textContent = video.title || "حصة مسجلة";
    const date = document.createElement("small");
    date.textContent = `أضيفت في ${formatScheduledDate(video.createdAt)}`;
    const type = document.createElement("span");
    type.className = "teacher-lesson-video-type";
    type.textContent = video.repositoryTypeLabel || "تصنيف غير معروف";
    copy.append(title, type, date);

    const actions = document.createElement("div");
    actions.className = "teacher-lesson-video-actions";
    const open = document.createElement("a");
    open.href = video.previewUrl || video.driveUrl;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "فتح الرابط";
    const remove = createButton("حذف", "delete", () => void deleteLessonVideo(video.id));
    actions.append(open, remove);
    item.append(copy, actions);
    elements.lessonVideoList.append(item);
  });
}

async function loadLessonVideos() {
  if (!elements.lessonVideoList) return;

  try {
    const response = await teacherFetch(`/api/lesson-videos/${encodeURIComponent(currentLevel)}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل الفيديوهات المكملة.");
    lessonVideos = Array.isArray(payload.data) ? payload.data : [];
    renderLessonVideos();
  } catch (error) {
    console.error("Unable to load lesson videos:", error);
    lessonVideos = [];
    renderLessonVideos();
    showDashboardError(error.message || "تعذر تحميل مستودع الدروس.");
  }
}

function extractYouTubeVideoId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
    if (!["youtube.com", "m.youtube.com"].includes(host)) return "";
    const queryId = parsed.searchParams.get("v") || "";
    const pathId = parsed.pathname.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/)?.[1] || "";
    const id = queryId || pathId;
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

async function saveLessonVideo(event, selectedVideo = null) {
  event?.preventDefault();
  const title = selectedVideo?.title || elements.lessonVideoTitle?.value.trim() || "";
  const youtubeUrl = selectedVideo?.previewUrl || elements.lessonVideoUrl?.value.trim() || "";
  const youtubeVideoId = extractYouTubeVideoId(youtubeUrl);
  const repositoryType = selectedVideo?.repositoryType || elements.lessonVideoType?.value || "";
  if (!title || !youtubeUrl) {
    showDashboardError("أدخل عنوان الحصة ورابط YouTube أولاً.");
    return;
  }
  if (!youtubeVideoId) {
    showDashboardError("أدخل رابط YouTube صحيحاً من نوع youtube.com أو youtu.be.");
    elements.lessonVideoUrl?.focus();
    return;
  }
  if (!repositoryType) {
    showDashboardError("اختر مادة الحصة أو نوع الاشتراك أولاً.");
    elements.lessonVideoType?.focus();
    return;
  }

  elements.lessonVideoSubmit.disabled = true;
  try {
    const response = await teacherFetch("/api/lesson-videos", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ level: currentLevel, title, youtubeUrl, youtubeVideoId, repositoryType }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر حفظ رابط الحصة.");

    elements.lessonVideoForm.reset();
    syncLessonVideoTypeOptions();
    showToast("تم نشر الفيديو المكمل في التصنيف المحدد.");
    await loadLessonVideos();
  } catch (error) {
    console.error("Unable to save lesson video:", error);
    showDashboardError(error.message || "تعذر حفظ رابط الحصة.");
  } finally {
    elements.lessonVideoSubmit.disabled = false;
  }
}

async function deleteLessonVideo(videoId) {
  if (!window.confirm("هل تريد حذف رابط هذه الحصة من المستودع؟ لن يُحذف الفيديو من YouTube.")) {
    return;
  }

  try {
    const response = await teacherFetch(`/api/lesson-videos/${encodeURIComponent(videoId)}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر حذف الفيديو المكمل.");

    showToast("تم حذف الفيديو المكمل.");
    await loadLessonVideos();
  } catch (error) {
    console.error("Unable to delete lesson video:", error);
    showDashboardError(error.message || "تعذر حذف رابط الحصة.");
  }
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createCell(content, className = "") {
  const cell = document.createElement("td");
  if (className) {
    cell.className = className;
  }

  if (content instanceof Node) {
    cell.append(content);
  } else {
    cell.textContent = content;
  }

  return cell;
}

let certificateStudentId = null;
let teacherCertificateImageUrls = new Set();

function revokeTeacherCertificateImageUrls() {
  teacherCertificateImageUrls.forEach((url) => URL.revokeObjectURL(url));
  teacherCertificateImageUrls = new Set();
}

function renderTeacherCertificates(certificates) {
  if (!elements.teacherStudentCertificatesList) return;
  elements.teacherStudentCertificatesList.replaceChildren();
  if (!certificates.length) {
    const empty = document.createElement("p");
    empty.className = "teacher-certificates-empty";
    empty.textContent = "لا توجد شهادات مضافة لهذا التلميذ بعد.";
    elements.teacherStudentCertificatesList.append(empty);
    return;
  }

  certificates.forEach((certificate) => {
    const item = document.createElement("article");
    item.className = "teacher-certificate-item";
    const copy = document.createElement("div");
    copy.className = "teacher-certificate-copy";
    const title = document.createElement("strong");
    title.textContent = certificate.title;
    const date = document.createElement("small");
    date.textContent = certificate.awardedAt ? new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium" }).format(new Date(certificate.awardedAt)) : "دون تاريخ";
    copy.append(title, date);
    if (certificate.description) {
      const description = document.createElement("p");
      description.textContent = certificate.description;
      copy.append(description);
    }
    const actions = document.createElement("div");
    actions.className = "teacher-certificate-actions";
    const preview = createButton("معاينة", "certificate-preview-btn", () => window.open(certificate.imageUrl, "_blank", "noopener,noreferrer"));
    const remove = createButton("حذف", "delete", () => void deleteStudentCertificate(certificate.id));
    actions.append(preview, remove);
    item.append(copy, actions);
    elements.teacherStudentCertificatesList.append(item);
  });
}

async function loadTeacherCertificates(studentId) {
  if (!studentId || !elements.teacherStudentCertificatesList) return;
  revokeTeacherCertificateImageUrls();
  elements.teacherStudentCertificatesList.replaceChildren(Object.assign(document.createElement("p"), { className: "teacher-certificates-empty", textContent: "جارٍ تحميل الشهادات…" }));
  try {
    const response = await teacherFetch(`/api/certificates/student/${encodeURIComponent(studentId)}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل الشهادات.");
    if (certificateStudentId !== studentId) return;
    const certificates = Array.isArray(payload.data) ? payload.data : [];
    for (const certificate of certificates) {
      try {
        const imageResponse = await teacherFetch(certificate.imageUrl, { headers: { Accept: "image/*" } });
        if (!imageResponse.ok) continue;
        const imageUrl = URL.createObjectURL(await imageResponse.blob());
        certificate.imageUrl = imageUrl;
        teacherCertificateImageUrls.add(imageUrl);
      } catch (error) {
        console.warn("Unable to load teacher certificate image:", error);
      }
    }
    renderTeacherCertificates(certificates.filter((certificate) => certificate.imageUrl?.startsWith("blob:")));
  } catch (error) {
    console.error("Unable to load teacher certificates:", error);
    elements.teacherStudentCertificatesList.replaceChildren(Object.assign(document.createElement("p"), { className: "teacher-certificates-empty", textContent: error.message || "تعذر تحميل الشهادات." }));
  }
}

function openStudentCertificatesModal(student) {
  certificateStudentId = student.id;
  elements.studentCertificatesStudentName.textContent = `${student.studentName} — ${displayLevelLabel(student.level)}`;
  elements.studentCertificateForm?.reset();
  if (elements.studentCertificateAwardedAt) elements.studentCertificateAwardedAt.value = new Date().toISOString().slice(0, 10);
  elements.studentCertificatesModal.hidden = false;
  elements.studentCertificateTitle?.focus();
  void loadTeacherCertificates(student.id);
}

function closeStudentCertificatesModal() {
  certificateStudentId = null;
  revokeTeacherCertificateImageUrls();
  if (elements.studentCertificatesModal) elements.studentCertificatesModal.hidden = true;
  elements.studentCertificateForm?.reset();
}

async function submitStudentCertificate(event) {
  event.preventDefault();
  const studentId = certificateStudentId;
  const title = elements.studentCertificateTitle?.value.trim() || "";
  const image = elements.studentCertificateImage?.files?.[0];
  if (!studentId || !title || !image) {
    showDashboardError("أدخل عنوان الشهادة وارفع صورتها أولًا.");
    return;
  }
  const formData = new FormData();
  formData.append("title", title);
  formData.append("awardedAt", elements.studentCertificateAwardedAt?.value || "");
  formData.append("description", elements.studentCertificateDescription?.value.trim() || "");
  formData.append("image", image);
  elements.studentCertificateSubmit.disabled = true;
  try {
    const response = await teacherFetch(`/api/certificates/student/${encodeURIComponent(studentId)}`, { method: "POST", body: formData, headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر حفظ الشهادة.");
    elements.studentCertificateForm.reset();
    elements.studentCertificateAwardedAt.value = new Date().toISOString().slice(0, 10);
    showToast("تم رفع الشهادة ونشرها للتلميذ.");
    await loadTeacherCertificates(studentId);
  } catch (error) {
    console.error("Unable to submit student certificate:", error);
    showDashboardError(error.message || "تعذر حفظ الشهادة.");
  } finally {
    elements.studentCertificateSubmit.disabled = false;
  }
}

async function deleteStudentCertificate(certificateId) {
  if (!certificateId) return;
  try {
    const response = await teacherFetch(`/api/certificates/${encodeURIComponent(certificateId)}`, { method: "DELETE", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر حذف الشهادة.");
    showToast("تم حذف الشهادة.");
    if (certificateStudentId) await loadTeacherCertificates(certificateStudentId);
  } catch (error) {
    console.error("Unable to delete student certificate:", error);
    showDashboardError(error.message || "تعذر حذف الشهادة.");
  }
}

function closeStudentActionsModal() {
  elements.studentActionsModal?.classList.remove("is-open");
  if (elements.studentActionsModal) elements.studentActionsModal.hidden = true;
}

function closeStudentContactModal() {
  if (!elements.studentContactModal) return;
  elements.studentContactModal.hidden = true;
  elements.studentContactModal.classList.remove("is-open");
  elements.studentContactMessage?.setAttribute("hidden", "");
  if (elements.studentContactMessage) elements.studentContactMessage.textContent = "";
}

function showStudentContactMessage(message, isError = false) {
  if (!elements.studentContactMessage) return;
  elements.studentContactMessage.textContent = message;
  elements.studentContactMessage.hidden = !message;
  elements.studentContactMessage.dataset.state = isError ? "error" : "success";
}

function openStudentContactModal(student) {
  if (!student || !elements.studentContactModal || !elements.studentContactForm) return;
  elements.studentContactForm.dataset.studentId = student.id;
  elements.studentContactName.value = student.studentName || "";
  elements.studentContactPhone.value = student.parentPhone || "";
  showStudentContactMessage("");
  elements.studentContactSubmit.disabled = false;
  elements.studentContactModal.hidden = false;
  elements.studentContactModal.classList.add("is-open");
  elements.studentContactName.focus();
}

async function saveStudentContact(event) {
  event.preventDefault();
  const studentId = elements.studentContactForm?.dataset.studentId;
  const studentName = String(elements.studentContactName?.value || "").trim();
  const parentPhone = String(elements.studentContactPhone?.value || "").trim();
  if (!studentId || !studentName || !parentPhone) {
    showStudentContactMessage("أدخل اسم التلميذ ورقم هاتف الولي.", true);
    return;
  }

  elements.studentContactSubmit.disabled = true;
  showStudentContactMessage("جارٍ حفظ البيانات…");
  try {
    const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}/contact`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ studentName, parentPhone }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تعديل بيانات التلميذ.");
    showToast(payload.message || "تم تعديل بيانات التلميذ.");
    closeStudentContactModal();
    await fetchStudents(currentLevel);
  } catch (error) {
    console.error("Unable to update student contact:", error);
    showStudentContactMessage(error.message || "تعذر تعديل بيانات التلميذ.", true);
    elements.studentContactSubmit.disabled = false;
  }
}

function openStudentActionsModal(student) {
  if (!student || !elements.studentActionsModal || !elements.studentActionsList) return;
  elements.studentActionsTitle.textContent = student.studentName || "التلميذ";
  elements.studentActionsLevel.textContent = displayLevelLabel(student.level);
  elements.studentActionsList.replaceChildren();

  const actions = [
    createButton("تعديل الاسم ورقم الهاتف", "student-action-modal-button", () => {
      closeStudentActionsModal();
      openStudentContactModal(student);
    }),
    createButton("تعديل الاشتراك", "student-action-modal-button", () => {
      closeStudentActionsModal();
      openSubscriptionModal(student.id);
    }),
    createButton(student.liveAccessEnabled ? "منع دخول الحصة" : "السماح بدخول الحصة", "student-action-modal-button", () => {
      closeStudentActionsModal();
      void toggleLiveAccess(student.id);
    }),
    createButton("سجل الحضور", "student-action-modal-button", () => {
      closeStudentActionsModal();
      void openAttendanceModal(student.id);
    }),
    createButton("الشهادات", "student-action-modal-button", () => {
      closeStudentActionsModal();
      openStudentCertificatesModal(student);
    }),
    createButton("حذف التلميذ", "student-action-modal-button danger", () => {
      closeStudentActionsModal();
      void deleteStudent(student.id);
    }),
  ];

  if (student.paymentReceiptUrl) {
    actions.unshift(createButton("عرض وصل الدفع", "student-action-modal-button", () => {
      closeStudentActionsModal();
      void viewStudentPaymentReceipt(student.id);
    }));
  }
  if (student.level === "طالب جامعي" && student.cardPhotoUrl) {
    actions.unshift(createButton("عرض بطاقة الطالب", "student-action-modal-button", () => {
      closeStudentActionsModal();
      void viewStudentCard(student.id);
    }));
  }

  elements.studentActionsList.append(...actions);
  elements.studentActionsModal.hidden = false;
  elements.studentActionsModal.classList.add("is-open");
  elements.studentActionsModalClose?.focus();
}

const PAYMENT_STAGE_PRIORITY = Object.freeze({ PROMISED: 0, PAID: 1, UNPAID: 2 });

function getStudentPaymentStage(student) {
  return student?.paymentStage || (student?.paymentStatus === true ? "PAID" : "UNPAID");
}

function sortStudentsByPaymentPriority(studentsArray) {
  return (Array.isArray(studentsArray) ? studentsArray : [])
    .map((student, index) => ({ student, index }))
    .sort((left, right) => {
      const leftPriority = PAYMENT_STAGE_PRIORITY[getStudentPaymentStage(left.student)] ?? PAYMENT_STAGE_PRIORITY.UNPAID;
      const rightPriority = PAYMENT_STAGE_PRIORITY[getStudentPaymentStage(right.student)] ?? PAYMENT_STAGE_PRIORITY.UNPAID;
      return leftPriority - rightPriority || left.index - right.index;
    })
    .map(({ student }) => student);
}

function renderTable(studentsArray) {
  const students = Array.isArray(studentsArray) ? studentsArray : [];

  if (!elements.studentsTableBody) {
    return;
  }

  elements.studentsTableBody.replaceChildren();

  if (elements.tableEmptyState) {
    elements.tableEmptyState.hidden = students.length > 0;
  }

  if (students.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "لا يوجد تلاميذ مسجلون في هذا المستوى حالياً.";
    cell.className = "empty-table-cell";
    row.append(cell);
    elements.studentsTableBody.append(row);
    return;
  }

  for (const student of students) {
    const row = document.createElement("tr");

    const paymentMeta = paymentStageMeta(student);
    const paymentButton = createButton(
      paymentMeta.label,
      `payment-toggle ${paymentMeta.className}`,
      () => openSubscriptionModal(student.id)
    );
    paymentButton.title = "اضغط لتعديل حالة الدفع والمبلغ";

    const liveAccessButton = createButton(
      student.liveAccessEnabled ? "↗" : "🔒",
      `payment-toggle ${student.liveAccessEnabled ? "is-paid" : "is-unpaid"}`,
      () => toggleLiveAccess(student.id)
    );
    liveAccessButton.setAttribute("aria-pressed", String(Boolean(student.liveAccessEnabled)));
    liveAccessButton.title = student.liveAccessEnabled
      ? "اضغط لمنع هذا التلميذ من دخول الحصة"
      : "اضغط للسماح لهذا التلميذ بدخول الحصة";

    const subscriptionButton = createButton(
      "✎",
      "edit-notes-btn icon-action",
      () => openSubscriptionModal(student.id)
    );
    const attendanceButton = createButton(
      "◉",
      "attendance-log-btn icon-action",
      () => openAttendanceModal(student.id)
    );
    const deleteButton = createButton(
      "⌫",
      "delete-student-btn icon-action",
      () => deleteStudent(student.id)
    );
    const actionGroup = document.createElement("div");
    actionGroup.className = "table-action-group";
    const certificatesButton = createButton(
      "الشهادات",
      "student-certificates-btn",
      () => openStudentCertificatesModal(student)
    );
    certificatesButton.title = "إضافة أو إدارة شهادات هذا التلميذ";
    actionGroup.append(
      liveAccessButton,
      subscriptionButton,
      attendanceButton,
      certificatesButton,
      deleteButton
    );

    const identity = document.createElement("div");
    identity.className = "teacher-student-identity";
    const studentName = document.createElement("button");
    studentName.type = "button";
    studentName.className = "student-name-action";
    studentName.textContent = student.studentName;
    studentName.title = "فتح إجراءات التلميذ";
    studentName.addEventListener("click", () => openStudentActionsModal(student));
    const accountStatus = document.createElement("span");
    const accountMeta = accountStatusMeta(student);
    accountStatus.className = `teacher-account-status ${accountMeta.className}`;
    accountStatus.textContent = accountMeta.label;
    identity.append(studentName, accountStatus);

    if (student.level === "طالب جامعي") {
      const reuploadButton = createButton(
        student.cardReuploadRequested ? "تم طلب إعادة الرفع" : "أعد رفع البطاقة",
        "card-reupload-btn",
        () => requestCardReupload(student.id)
      );
      reuploadButton.disabled = Boolean(student.cardReuploadRequested);
      reuploadButton.title = student.cardReuploadRequested
        ? "ينتظر رفع الطالب للصورة الجديدة"
        : "اطلب من الطالب رفع صورة أوضح للبطاقة";
      actionGroup.append(reuploadButton);

      const identityPending =
        student.accountActive === false &&
        !student.cardReuploadRequested &&
        Boolean(student.cardPhotoUrl);
      if (identityPending) {
          const confirmIdentityButton = createButton(
          "تأكيد هوية البطاقة",
          "card-confirm-btn",
          () => confirmCardIdentity(student.id)
        );
        confirmIdentityButton.title = "بعد مراجعة البطاقة، اضغط لتفعيل حساب الطالب";
        actionGroup.append(confirmIdentityButton);
      }

    }

    const paymentReceiptPending =
      Boolean(student.paymentReceiptPending) && Boolean(student.paymentReceiptUrl);
    if (student.paymentReceiptUrl) {
      const viewReceiptButton = createButton(
        "عرض وصل الدفع",
        "payment-receipt-view-btn",
        () => viewStudentPaymentReceipt(student.id)
      );
      viewReceiptButton.title = "عرض وصل الدفع المرفوع من الولي";
      const saveReceiptButton = createButton(
        "حفظ في Drive",
        "student-document-drive-btn",
        (event) => saveStudentDocumentToDrive(student.id, "receipt", event.currentTarget)
      );
      saveReceiptButton.title = "حفظ نسخة من وصل الدفع في Google Drive";
      actionGroup.append(viewReceiptButton, saveReceiptButton);
      if (paymentReceiptPending) {
        const confirmPaymentButton = createButton(
          "تأكيد وصل الدفع",
          "payment-receipt-confirm-btn",
          () => confirmPaymentReceipt(student.id)
        );
        confirmPaymentButton.title = "تأكيد الدفع وتفعيل اشتراك التلميذ";
        actionGroup.append(confirmPaymentButton);
        const rejectPaymentButton = createButton(
          "رفض الوصل",
          "payment-receipt-reject-btn",
          () => rejectPaymentReceipt(student.id)
        );
        rejectPaymentButton.title = "رفض الوصل غير الصحيح وإتاحة رفع وصل جديد";
        actionGroup.append(rejectPaymentButton);
      }
    }

    const cardCell = document.createElement("td");
    cardCell.className = "card-photo-cell";
    if (student.level !== "طالب جامعي") {
      const paymentStatusMeta = secondaryPaymentStatusMeta(student);
      const paymentStatusButton = createButton(
        paymentStatusMeta.label,
        `secondary-payment-status ${paymentStatusMeta.className}`,
        () => openPaymentStatusModal(student.id)
      );
      paymentStatusButton.title = "اضغط لتحديد حالة الدفع والقيمة";
      cardCell.append(paymentStatusButton);
    } else if (student.cardPhotoUrl) {
      const cardButton = createButton(
        "عرض البطاقة",
        "card-view-btn",
        () => viewStudentCard(student.id)
      );
      cardButton.title = "عرض صورة بطاقة الطالب الجامعي";
      const saveCardButton = createButton(
        "حفظ في Drive",
        "student-document-drive-btn",
        (event) => saveStudentDocumentToDrive(student.id, "card", event.currentTarget)
      );
      saveCardButton.title = "حفظ نسخة من بطاقة الطالب في Google Drive";
      cardCell.append(cardButton, saveCardButton);
    } else {
      cardCell.textContent = "غير متوفرة";
      cardCell.classList.add("muted-cell");
    }

    row.append(
      createCell(identity),
      createCell(student.parentPhone, "phone-cell"),
      createCell(paymentButton, "payment-cell"),
      cardCell,
      createCell(actionGroup, "actions-cell")
    );

    elements.studentsTableBody.append(row);
  }

}

/** Updates the three cards from the same array visible in the table. */
function updateSummary(studentsArray) {
  const total = studentsArray.length;
  const paid = studentsArray.filter((student) => student.paymentStatus === true).length;
  const unpaid = total - paid;

  if (elements.summaryTotal) elements.summaryTotal.textContent = String(total);
  if (elements.summaryPaid) elements.summaryPaid.textContent = String(paid);
  if (elements.summaryUnpaid) elements.summaryUnpaid.textContent = String(unpaid);
  if (elements.filteredResultsLabel) {
    elements.filteredResultsLabel.textContent = `${total} نتيجة معروضة`;
  }

  updateBentoInsights(currentStudents);
}

function formatOverviewMoney(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString("ar-DZ")} دج`;
}

function isCurrentMonth(value) {
  const date = new Date(value);
  const now = new Date();
  return Number.isFinite(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function updateOverviewClassState() {
  const absent = teacherAbsent || globalTeacherAbsent;
  const nextClass = scheduledClasses
    .map((scheduledClass) => ({ scheduledClass, timestamp: new Date(scheduledClass?.scheduledAt).getTime() }))
    .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp >= Date.now())
    .sort((left, right) => left.timestamp - right.timestamp)[0]?.scheduledClass;

  if (absent) {
    if (elements.overviewClassState) elements.overviewClassState.textContent = "الأستاذ غائب اليوم";
    if (elements.overviewClassTitle) elements.overviewClassTitle.textContent = "إعلان غياب مفعل";
    if (elements.overviewClassCopy) elements.overviewClassCopy.textContent = "تم تعميم إعلان الغياب على هذا المستوى.";
    return;
  }

  if (nextClass) {
    const subjectLabel = scheduleTypeLabel(currentLevel, nextClass.subject);
    const formattedDate = formatScheduledDate(nextClass.scheduledAt);
    if (elements.overviewClassState) elements.overviewClassState.textContent = "حصة مبرمجة";
    if (elements.overviewClassTitle) elements.overviewClassTitle.textContent = `الحصة القادمة: ${subjectLabel}`;
    if (elements.overviewClassCopy) elements.overviewClassCopy.textContent = formattedDate;
    return;
  }

  if (elements.overviewClassState) elements.overviewClassState.textContent = "الحصة غير مبرمجة";
  if (elements.overviewClassTitle) elements.overviewClassTitle.textContent = "لا توجد حصة قادمة";
  if (elements.overviewClassCopy) elements.overviewClassCopy.textContent = "يمكنك برمجة حصة لهذا المستوى أو فتح الاستوديو مباشرة.";
}

function updateBentoInsights(studentsArray = currentStudents) {
  const students = Array.isArray(studentsArray) ? studentsArray : [];
  const stages = students.map(getStudentPaymentStage);
  const total = students.length;
  const paid = students.filter((student, index) => stages[index] === "PAID");
  const promised = students.filter((student, index) => stages[index] === "PROMISED");
  const pendingReceipts = students.filter((student) => Boolean(student.paymentReceiptPending && student.paymentReceiptUrl));
  const unpaid = students.filter((student, index) => stages[index] === "UNPAID" && !pendingReceipts.includes(student));
  const liveEnabled = students.filter((student) => student.liveAccessEnabled).length;
  const confirmedRevenue = paid.reduce((sum, student) => sum + (Number(student.amountDue) || 0), 0);
  const monthlyRegistrations = students.filter((student) => isCurrentMonth(student.createdAt)).length;
  const paymentAttempts = electronicPayments.filter((payment) => String(payment?.status || "").toUpperCase() !== "PAID").length;
  const paymentRate = total ? Math.round((paid.length / total) * 100) : 0;
  const latestStudent = students[0];

  if (elements.bentoLiveEnabled) elements.bentoLiveEnabled.textContent = String(liveEnabled);
  if (elements.summaryTotal) elements.summaryTotal.textContent = String(total);
  if (elements.summaryPaid) elements.summaryPaid.textContent = String(paid.length);
  if (elements.summaryUnpaid) elements.summaryUnpaid.textContent = String(unpaid.length);
  if (elements.overviewMonthlyRegistrations) elements.overviewMonthlyRegistrations.textContent = String(monthlyRegistrations);
  if (elements.overviewTotalCaption) elements.overviewTotalCaption.textContent = total ? `${total} تلميذ في العرض` : "لا يوجد تلاميذ بعد";
  if (elements.overviewConfirmedRevenue) elements.overviewConfirmedRevenue.textContent = formatOverviewMoney(confirmedRevenue);
  if (elements.overviewRevenueCaption) elements.overviewRevenueCaption.textContent = confirmedRevenue ? "إجمالي القيم المؤكدة قبل احتساب المصاريف" : "لا توجد مداخيل مؤكدة لهذا المستوى بعد";
  if (elements.overviewPromisedCount) elements.overviewPromisedCount.textContent = String(promised.length);
  if (elements.overviewPendingReceipts) elements.overviewPendingReceipts.textContent = String(pendingReceipts.length);
  if (elements.overviewPaymentAttempts) elements.overviewPaymentAttempts.textContent = String(paymentAttempts);
  if (elements.overviewForgotPin) elements.overviewForgotPin.textContent = String(forgotPinRequests.length);
  if (elements.bentoTotalCaption) elements.bentoTotalCaption.textContent = total ? `${total} تلميذ في العرض` : "بانتظار التلاميذ";
  if (elements.paymentProgressBar) elements.paymentProgressBar.style.width = `${paymentRate}%`;
  if (elements.paymentProgressCaption) elements.paymentProgressCaption.textContent = total ? `${paid.length} مدفوع، ${promised.length} وعد بالدفع، ${unpaid.length} دون دفع` : "ستظهر حالة الاشتراكات بعد تحميل القائمة.";
  if (elements.bentoMathCount) elements.bentoMathCount.textContent = String(paid.length);
  if (elements.bentoPhysicsCount) elements.bentoPhysicsCount.textContent = String(unpaid.length);
  if (elements.bentoLatestStudent) elements.bentoLatestStudent.textContent = latestStudent?.studentName || "لا يوجد تلاميذ في هذا المستوى";
  if (elements.bentoLatestCaption) elements.bentoLatestCaption.textContent = latestStudent ? `آخر تلميذ ظاهر: ${displayLevelLabel(latestStudent.level || currentLevel)}` : "غيّر المستوى أو أضف تلميذًا جديدًا للبدء.";
  if (elements.bentoActivityStatus) elements.bentoActivityStatus.textContent = total ? `تم تحديث ${total} تلميذ` : "تحديث مباشر للبيانات";
  updateOverviewClassState();
}

/** Applies both controls to the in-memory array; no extra API call is made. */
function setActivePaymentFilter(value) {
  const selected = value || "all";
  elements.rosterFilterButtons.forEach((button) => {
    const isActive = button.dataset.paymentFilter === selected;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function applyFilters() {
  const query = String(elements.searchInput?.value || "")
    .trim()
    .toLocaleLowerCase("ar");
  const paymentSelection = elements.paymentFilter?.value || "all";
  setActivePaymentFilter(paymentSelection);

  const filteredStudents = currentStudents.filter((student) => {
    const matchesName =
      !query || String(student.studentName || "").toLocaleLowerCase("ar").includes(query);
    const matchesPayment =
      paymentSelection === "all" ||
      (paymentSelection === "paid" && student.paymentStatus === true) ||
      (paymentSelection === "unpaid" && student.paymentStatus === false);

    return matchesName && matchesPayment;
  });

  const orderedStudents = sortStudentsByPaymentPriority(filteredStudents);
  renderTable(orderedStudents);
  updateSummary(orderedStudents);
}

function formatTeacherPaymentDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-DZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Algiers",
  }).format(date);
}

function teacherPaymentCountLabel(count) {
  const value = Number(count) || 0;
  return `${value} ${value === 1 ? "تلميذ" : "تلاميذ"}`;
}

function teacherPaymentOperationCountLabel(count) {
  const value = Number(count) || 0;
  return `${value} ${value === 1 ? "عملية" : "عمليات"}`;
}

function electronicSubscriptionLabel(type) {
  return type === "BOTH"
    ? "الرياضيات والفيزياء"
    : type === "PHYSICS"
      ? "الفيزياء فقط"
      : type === "MATH"
        ? "الرياضيات فقط"
        : type || "—";
}

function appendPaymentEmptyRow(tbody, colSpan, message) {
  if (!tbody) return;
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = colSpan;
  cell.className = "payment-muted";
  cell.textContent = message;
  row.append(cell);
  tbody.append(row);
}

function renderManualPayments(studentsArray = currentStudents) {
  const students = Array.isArray(studentsArray)
    ? studentsArray.filter((student) => Boolean(student.paymentReceiptUrl))
    : [];
  const tbody = elements.manualPaymentsTableBody;
  if (!tbody) return;

  tbody.replaceChildren();
  if (elements.manualPaymentsCount) {
    elements.manualPaymentsCount.textContent = teacherPaymentCountLabel(students.length);
  }
  if (elements.manualPaymentsEmpty) elements.manualPaymentsEmpty.hidden = students.length > 0;

  if (!students.length) {
    appendPaymentEmptyRow(tbody, 5, "لا توجد وصولات دفع مرفوعة لهذا المستوى.");
    return;
  }

  students.forEach((student) => {
    const row = document.createElement("tr");
    const status = document.createElement("span");
    status.className = `payment-status-badge${student.paymentReceiptPending ? " is-pending" : ""}`;
    status.textContent = student.paymentReceiptPending ? "في انتظار المراجعة" : "وصل مرفوع";
    const viewButton = createButton("عرض الوصل", "payment-receipt-view-btn", () => {
      void viewStudentPaymentReceipt(student.id);
    });
    viewButton.title = "عرض وصل الدفع المرفوع من الولي";
    const actionCell = document.createElement("td");
    actionCell.className = "payment-actions-cell";
    actionCell.append(viewButton);
    if (student.paymentReceiptPending) {
      const rejectButton = createButton("رفض الوصل", "payment-receipt-reject-btn", () => {
        void rejectPaymentReceipt(student.id);
      });
      rejectButton.title = "رفض الوصل غير الصحيح وإتاحة رفع وصل جديد";
      actionCell.append(rejectButton);
    }
    row.append(
      createCell(student.studentName || "—", "payment-student-name"),
      createCell(student.parentPhone || "—"),
      createCell(status),
      createCell(formatTeacherPaymentDate(student.paymentReceiptSubmittedAt)),
      actionCell,
    );
    tbody.append(row);
  });
}

function electronicPaymentStatusMeta(status) {
  if (status === "PAID") return { label: "الدفع ناجح", className: "is-paid" };
  if (status === "FAILED") return { label: "فشل الدفع", className: "is-failed" };
  return { label: "قيد التحقق من SofizPay", className: "is-pending" };
}

function renderElectronicPayments(payments = electronicPayments, summary = null) {
  const rows = Array.isArray(payments) ? payments : [];
  const tbody = elements.electronicPaymentsTableBody;
  if (!tbody) return;

  const successfulCount = Number(summary?.successful ?? rows.filter((payment) => payment.status === "PAID").length);
  const attemptCount = Number(summary?.attempts ?? rows.filter((payment) => payment.status !== "PAID").length);
  tbody.replaceChildren();
  if (elements.electronicPaymentsCount) elements.electronicPaymentsCount.textContent = teacherPaymentOperationCountLabel(rows.length);
  if (elements.electronicPaymentsSuccessCount) elements.electronicPaymentsSuccessCount.textContent = `${successfulCount} ناجحة`;
  if (elements.electronicPaymentsAttemptCount) elements.electronicPaymentsAttemptCount.textContent = `${attemptCount} محاولة`;
  if (elements.electronicPaymentsEmpty) elements.electronicPaymentsEmpty.hidden = rows.length > 0;

  if (!rows.length) {
    appendPaymentEmptyRow(tbody, 8, "لا توجد دفعات أو محاولات دفع إلكترونية لهذا المستوى.");
    return;
  }

  rows.forEach((payment) => {
    const student = payment.student || {};
    const row = document.createElement("tr");
    const statusMeta = electronicPaymentStatusMeta(payment.status);
    const status = document.createElement("span");
    status.className = `payment-status-badge ${statusMeta.className}`;
    status.textContent = statusMeta.label;
    const actionCell = document.createElement("td");
    actionCell.className = "payment-actions-cell";
    if (payment.status !== "PAID") {
      const reconcileButton = createButton("تحقق من SofizPay", "payment-reconcile-btn", () => {
        void reconcileElectronicPayment(payment);
      });
      reconcileButton.title = "أدخل رقم المعاملة للتحقق من حالتها وتفعيل الاشتراك إذا أكد SofizPay نجاحها";
      const dismissButton = createButton("حذف الإشعار", "payment-attempt-dismiss-btn", () => {
        void dismissElectronicPayment(payment.id);
      });
      dismissButton.title = "حذف إشعار محاولة الدفع بعد الاطلاع عليه";
      actionCell.append(reconcileButton, dismissButton);
    } else {
      const retained = document.createElement("span");
      retained.className = "payment-retained-label";
      retained.textContent = "سجل محفوظ";
      actionCell.append(retained);
    }
    row.append(
      createCell(student.studentName || "—", "payment-student-name"),
      createCell(student.parentPhone || "—"),
      createCell(electronicSubscriptionLabel(payment.subscriptionType)),
      createCell(`${Number(payment.amount || 0).toLocaleString("ar-DZ")} ${payment.currency || "DZD"}`),
      createCell(status),
      createCell(formatTeacherPaymentDate(payment.paidAt || payment.verifiedAt || payment.createdAt)),
      createCell(payment.providerOrderNumber || payment.internalOrderId || "—", "payment-muted"),
      actionCell,
    );
    tbody.append(row);
  });
}

async function loadElectronicPayments(level = currentLevel) {
  const requestedLevel = level;
  try {
    const response = await teacherFetch(
      `/api/payments/teacher/electronic?level=${encodeURIComponent(requestedLevel)}`,
      { headers: { Accept: "application/json" } },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر تحميل الدفعات الإلكترونية.");
    if (requestedLevel !== currentLevel) return;
    electronicPayments = Array.isArray(data?.data) ? data.data : [];
    electronicPaymentsLevel = requestedLevel;
    renderElectronicPayments(electronicPayments, data?.summary);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to fetch electronic payments:", error);
      showDashboardError(error.message || "تعذر تحميل الدفعات الإلكترونية.");
      electronicPayments = [];
      electronicPaymentsLevel = "";
      renderElectronicPayments([]);
    }
  }
}

function requestSofizPayOrderNumber(payment) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sofizpay-reconcile-overlay";
    const dialog = document.createElement("div");
    dialog.className = "sofizpay-reconcile-dialog";
    const title = document.createElement("h3");
    title.textContent = "التحقق من معاملة SofizPay";
    const copy = document.createElement("p");
    copy.textContent = `أدخل رقم المعاملة للتحقق من الدفع الخاص بـ ${payment?.student?.studentName || "التلميذ"}.`;
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.placeholder = "مثال: 4554614174";
    input.value = payment?.providerOrderNumber || "";
    input.autocomplete = "off";
    const actions = document.createElement("div");
    actions.className = "sofizpay-reconcile-actions";
    const cancel = createButton("إلغاء", "sofizpay-reconcile-cancel", () => finish(""));
    const confirm = createButton("تحقق الآن", "sofizpay-reconcile-confirm", () => finish(input.value.trim()));
    actions.append(cancel, confirm);
    dialog.append(title, copy, input, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    input.focus();

    function finish(value) {
      overlay.remove();
      resolve(value);
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish("");
      if (event.key === "Enter") finish(input.value.trim());
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish("");
    });
  });
}

async function reconcileElectronicPayment(payment) {
  const providerOrderNumber = await requestSofizPayOrderNumber(payment);
  if (!providerOrderNumber) return;

  try {
    const response = await teacherFetch(`/api/payments/teacher/electronic/${encodeURIComponent(payment.id)}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ providerOrderNumber: providerOrderNumber.trim() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر التحقق من معاملة SofizPay.");
    showToast(payload?.data?.message || "تم تحديث حالة معاملة SofizPay.");
    await loadElectronicPayments(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to reconcile SofizPay payment:", error);
      showDashboardError(error.message || "تعذر التحقق من معاملة SofizPay.");
    }
  }
}

async function dismissElectronicPayment(transactionId) {
  const confirmed = window.confirm("هل تريد حذف إشعار محاولة الدفع هذه؟ لن يُحذف حساب التلميذ ولن تتأثر أي بيانات أخرى.");
  if (!confirmed) return;

  try {
    const response = await teacherFetch(`/api/payments/teacher/electronic/${encodeURIComponent(transactionId)}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر حذف إشعار محاولة الدفع.");
    showToast(payload.message || "تم حذف إشعار محاولة الدفع.");
    await loadElectronicPayments(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to dismiss electronic payment attempt:", error);
      showDashboardError(error.message || "تعذر حذف إشعار محاولة الدفع.");
    }
  }
}

function updateForgotPinTabBadge(count) {
  const tabButton = document.querySelector('.teacher-tab-button[data-dashboard-tab="forgot-pin-requests"]');
  if (!tabButton) return;
  let badge = tabButton.querySelector(".forgot-pin-tab-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "forgot-pin-tab-badge";
    badge.setAttribute("aria-label", "طلبات نسيان كلمة المرور");
    tabButton.append(badge);
  }
  const safeCount = Number(count) || 0;
  badge.textContent = safeCount > 99 ? "99+" : String(safeCount);
  badge.hidden = safeCount === 0;
  tabButton.classList.toggle("has-forgot-pin-requests", safeCount > 0);
}

function renderForgotPinRequests(requests = forgotPinRequests) {
  const rows = Array.isArray(requests) ? requests : [];
  const tbody = elements.forgotPinRequestsTableBody;
  if (!tbody) return;

  tbody.replaceChildren();
  const studentRows = rows.flatMap((request) => (request.students || []).map((student) => ({ request, student })));
  if (elements.forgotPinRequestsCount) {
    elements.forgotPinRequestsCount.textContent = `${rows.length} طلب`;
  }
  updateForgotPinTabBadge(rows.length);
  if (elements.forgotPinRequestsEmpty) elements.forgotPinRequestsEmpty.hidden = studentRows.length > 0;

  if (!studentRows.length) {
    appendPaymentEmptyRow(tbody, 4, "لا توجد طلبات استرجاع لهذا المستوى.");
    return;
  }

  studentRows.forEach(({ request, student }) => {
    const row = document.createElement("tr");
    const issueButton = createButton("إنشاء كلمة مرور مؤقتة", "payment-receipt-view-btn", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const response = await teacherFetch(`/api/auth/parent/forgot-requests/${encodeURIComponent(request.id)}/issue`, { method: "PUT", headers: { Accept: "application/json" } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "تعذر إنشاء كلمة المرور المؤقتة.");
        const temporaryPin = data.data?.temporaryPin || "";
        window.alert(`كلمة المرور المؤقتة للحساب ${request.parentPhone}: ${temporaryPin}\\n\\nأعطها لصاحب الحساب هاتفيًا. ستنتهي صلاحيتها خلال 30 دقيقة، وسيُطلب منه تغييرها عند أول دخول.`);
        await loadForgotPinRequests(currentLevel);
      } catch (error) {
        if (!/انتهت الجلسة/.test(error.message)) showDashboardError(error.message || "تعذر إنشاء كلمة المرور المؤقتة.");
        button.disabled = false;
      }
    });
    issueButton.title = "تُعرض الكلمة المؤقتة مرة واحدة فقط";
    row.append(
      createCell(student.studentName || "—", "payment-student-name"),
      createCell(student.parentPhone || request.parentPhone || "—"),
      createCell(formatTeacherPaymentDate(request.requestedAt)),
      createCell(issueButton),
    );
    tbody.append(row);
  });
}

async function loadForgotPinRequests(level = currentLevel, { silent = false } = {}) {
  const requestedLevel = level;
  try {
    const response = await teacherFetch(`/api/auth/parent/forgot-requests?level=${encodeURIComponent(requestedLevel)}`, { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر تحميل طلبات نسيان كلمة المرور.");
    if (requestedLevel !== currentLevel) return;
    forgotPinRequests = Array.isArray(data?.data) ? data.data : [];
    forgotPinRequestsLevel = requestedLevel;
    renderForgotPinRequests(forgotPinRequests);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to fetch forgotten PIN requests:", error);
      if (!silent) showDashboardError(error.message || "تعذر تحميل طلبات نسيان كلمة المرور.");
      forgotPinRequests = [];
      forgotPinRequestsLevel = "";
      renderForgotPinRequests([]);
    }
  }
}

async function fetchStudents(level = currentLevel) {
  if (!getTeacherToken()) {
    return;
  }

  currentLevel = level;
  if (elements.searchInput) elements.searchInput.value = "";
  if (elements.studentSearchModalInput) elements.studentSearchModalInput.value = "";
  setActiveLevelButton(level);
  setCurrentLevelHeading(level);
  syncLessonVideoTypeOptions();
  showDashboardError();

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
    const remainingPages = totalPages > 1
      ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => requestRosterPage(index + 2)))
      : [];
    currentStudents = [
      ...firstStudents,
      ...remainingPages.flatMap((pageData) => Array.isArray(pageData?.data) ? pageData.data : Array.isArray(pageData) ? pageData : []),
    ];
    renderTeacherNotificationStudentPicker();
    updateTeacherNotificationAudience();
    electronicPayments = [];
    electronicPaymentsLevel = "";
    forgotPinRequests = [];
    forgotPinRequestsLevel = "";
    renderManualPayments(currentStudents);
    renderForgotPinRequests([]);
    resetScheduleForm();
    await Promise.all([loadLevelSchedule(), loadLessonVideos(), loadAssignments(), loadElectronicPayments(level), loadForgotPinRequests(level, { silent: true })]);
    updateBentoInsights(currentStudents);
    applyFilters();
    if (tabFromHash() === "electronic-payments") {
      void loadElectronicPayments(level);
    }
    if (tabFromHash() === "forgot-pin-requests") {
      void loadForgotPinRequests(level);
    }
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to fetch teacher roster:", error);
      showDashboardError(error.message || "تعذر تحميل قائمة التلاميذ.");
    }
  }
}

function assignmentSubjectLabel(subject) {
  return subject === "PHYSICS" ? "الفيزياء" : subject === "MATH" ? "الرياضيات" : subject || "عام";
}

function formatAssignmentDate(value) {
  if (!value) return "دون تاريخ تسليم";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `آخر أجل: ${new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium", timeZone: "Africa/Algiers" }).format(date)}`
    : "تاريخ التسليم غير صالح";
}

function escapeTeacherText(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));
}

function renderAssignments(assignments = []) {
  if (!elements.teacherAssignmentsList) return;
  elements.teacherAssignmentsList.replaceChildren();
  if (elements.assignmentLevelCaption) {
    elements.assignmentLevelCaption.textContent = `أضف واجبات ${displayLevelLabel(currentLevel)} وتابع عدد الحلول المرسلة.`;
  }

  if (!assignments.length) {
    const empty = document.createElement("p");
    empty.className = "teacher-assignment-empty";
    empty.textContent = "لا توجد واجبات منشورة لهذا المستوى بعد.";
    elements.teacherAssignmentsList.append(empty);
    return;
  }

  for (const assignment of assignments) {
    const card = document.createElement("article");
    card.className = "teacher-assignment-card";

    const header = document.createElement("div");
    header.className = "teacher-assignment-header";
    const title = document.createElement("h4");
    title.textContent = assignment.title || "واجب دون عنوان";
    const subject = document.createElement("span");
    subject.className = "teacher-assignment-subject";
    subject.textContent = assignmentSubjectLabel(assignment.subject);
    header.append(title, subject);

    const description = document.createElement("p");
    description.className = "teacher-assignment-description";
    description.textContent = assignment.description || "لا توجد تعليمات إضافية.";

    const meta = document.createElement("div");
    meta.className = "teacher-assignment-meta";
    const due = document.createElement("span");
    due.textContent = formatAssignmentDate(assignment.dueAt);
    const submissions = document.createElement("span");
    submissions.textContent = `${Number(assignment._count?.submissions) || 0} حل مرسل`;
    meta.append(due, submissions);

    const actions = document.createElement("div");
    actions.className = "teacher-assignment-actions";
    const submissionsButton = document.createElement("button");
    submissionsButton.type = "button";
    submissionsButton.className = "btn-view-submissions";
    submissionsButton.textContent = `أرى الحلول (${Number(assignment._count?.submissions) || 0})`;
    submissionsButton.addEventListener("click", () => void openTeacherSubmissions(assignment));
    actions.append(submissionsButton);
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-action";
    deleteButton.textContent = "حذف الواجب";
    deleteButton.addEventListener("click", () => void deleteTeacherAssignment(assignment.id));
    actions.append(deleteButton);

    card.append(header, description, meta, actions);
    elements.teacherAssignmentsList.append(card);
  }
}

async function loadAssignments() {
  if (!elements.teacherAssignmentsList) return;
  elements.teacherAssignmentsList.innerHTML = '<p class="teacher-assignment-empty">جارٍ تحميل واجبات المستوى…</p>';
  try {
    const response = await teacherFetch(`/api/academic/assignments?level=${encodeURIComponent(currentLevel)}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل واجبات المستوى.");
    renderAssignments(Array.isArray(payload.data) ? payload.data : []);
  } catch (error) {
    if (/انتهت الجلسة/.test(error.message)) return;
    console.error("Unable to load teacher assignments:", error);
    if (elements.teacherAssignmentsList) elements.teacherAssignmentsList.innerHTML = `<p class="teacher-assignment-empty">${escapeTeacherText(error.message || "تعذر تحميل الواجبات.")}</p>`;
  }
}

function clearAssignmentPastedImage() {
  if (assignmentPastedImageUrl) URL.revokeObjectURL(assignmentPastedImageUrl);
  assignmentPastedImage = null;
  assignmentPastedImageUrl = null;
  const preview = elements.assignmentDescription?.querySelector(".assignment-pasted-image");
  preview?.remove();
}

function handleAssignmentDescriptionPaste(event) {
  const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;
  const imageFile = imageItem.getAsFile();
  if (!imageFile) return;
  event.preventDefault();
  clearAssignmentPastedImage();
  assignmentPastedImage = imageFile;
  assignmentPastedImageUrl = URL.createObjectURL(imageFile);
  const image = document.createElement("img");
  image.className = "assignment-pasted-image";
  image.src = assignmentPastedImageUrl;
  image.alt = "معاينة صورة الواجب الملصقة";
  image.draggable = false;
  elements.assignmentDescription?.append(image);
}

function resetAssignmentForm() {
  elements.assignmentForm?.reset();
  clearAssignmentPastedImage();
  if (elements.assignmentDescription) elements.assignmentDescription.replaceChildren();
}

async function submitAssignment(event) {
  event.preventDefault();
  if (!elements.assignmentForm) return;

  const description = elements.assignmentDescription?.innerText?.trim() || "";
  const subject = elements.assignmentSubject?.value;
  if (!subject || (!description && !assignmentPastedImage)) {
    showDashboardError("اختر المادة ثم اكتب التعليمات أو ألصق صورة الواجب.");
    return;
  }

  const formData = new FormData();
  formData.append("level", currentLevel);
  formData.append("subject", subject);
  if (description) formData.append("description", description);
  if (assignmentPastedImage) formData.append("instructionImage", assignmentPastedImage, "homework-image.png");

  if (elements.assignmentSubmit) elements.assignmentSubmit.disabled = true;
  try {
    const response = await teacherFetch("/api/academic/assignments", { method: "POST", body: formData });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر نشر الواجب.");
    resetAssignmentForm();
    showToast(payload.message || "تم نشر الواجب بنجاح.");
    await loadAssignments();
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to submit teacher assignment:", error);
      showDashboardError(error.message || "تعذر نشر الواجب.");
    }
  } finally {
    if (elements.assignmentSubmit) elements.assignmentSubmit.disabled = false;
  }
}

async function openTeacherAssignmentFile(assignment) {
  if (!assignment?.id) return;
  try {
    const popup = window.open("about:blank", "_blank");
    const response = assignment.attachmentUrl
      ? await teacherFetch(assignment.attachmentUrl, { headers: { Accept: "*/*" } })
      : await teacherFetch(`/api/academic/assignments/${encodeURIComponent(assignment.id)}/file`, { headers: { Accept: "*/*" } });
    if (!response.ok) throw new Error("تعذر فتح ملف الواجب.");
    const url = URL.createObjectURL(await response.blob());
    if (popup) popup.location.href = url;
    else {
      const link = document.createElement("a");
      link.href = url;
      link.download = assignment.attachmentOriginalName || "assignment";
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    showDashboardError(error.message || "تعذر فتح ملف الواجب.");
  }
}

function closeTeacherSubmissions() {
  for (const url of activeSubmissionImageUrls) URL.revokeObjectURL(url);
  activeSubmissionImageUrls.clear();
  elements.teacherSubmissionsModal?.classList.remove("is-open");
  if (elements.teacherSubmissionsModal) elements.teacherSubmissionsModal.hidden = true;
  if (elements.teacherSubmissionsList) elements.teacherSubmissionsList.replaceChildren();
}

async function openTeacherSubmissionFile(submission, container) {
  if (!submission?.id || !container) return;
  const existing = container.querySelector(".teacher-submission-preview");
  if (existing) {
    existing.remove();
    return;
  }
  try {
    const response = await teacherFetch(`/api/academic/submissions/${encodeURIComponent(submission.id)}/file`, { headers: { Accept: "*/*" } });
    if (!response.ok) throw new Error("تعذر فتح صورة الحل.");
    const mimeType = submission.attachmentMimeType || response.headers.get("Content-Type") || "image/*";
    const blob = new Blob([await response.arrayBuffer()], { type: mimeType });
    const imageUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("تعذر تجهيز صورة الحل."));
      reader.readAsDataURL(blob);
    });
    const image = document.createElement("img");
    image.className = "teacher-submission-preview";
    image.src = imageUrl;
    image.alt = `حل التلميذ ${submission.student?.studentName || ""}`;
    image.loading = "lazy";
    container.append(image);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) showDashboardError(error.message || "تعذر فتح صورة الحل.");
  }
}

async function receiveTeacherSubmission(submissionId) {
  if (!submissionId) return;
  try {
    const response = await teacherFetch(`/api/academic/submissions/${encodeURIComponent(submissionId)}/receive`, { method: "PUT", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تأكيد استلام الحل.");
    showToast(payload.message || "تم تأكيد استلام الحل.");
    const assignmentId = elements.teacherSubmissionsModal?.dataset.assignmentId;
    if (assignmentId) {
      const assignment = { id: assignmentId, title: elements.teacherSubmissionsAssignmentTitle?.textContent || "الواجب" };
      await openTeacherSubmissions(assignment);
    }
    await loadAssignments();
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) showDashboardError(error.message || "تعذر تأكيد استلام الحل.");
  }
}

async function openTeacherSubmissions(assignment) {
  if (!assignment?.id || !elements.teacherSubmissionsModal || !elements.teacherSubmissionsList) return;
  elements.teacherSubmissionsModal.dataset.assignmentId = assignment.id;
  elements.teacherSubmissionsAssignmentTitle.textContent = assignment.title || "حلول الواجب";
  elements.teacherSubmissionsList.replaceChildren(Object.assign(document.createElement("p"), { className: "teacher-assignment-empty", textContent: "جارٍ تحميل الحلول…" }));
  elements.teacherSubmissionsModal.hidden = false;
  elements.teacherSubmissionsModal.classList.add("is-open");
  try {
    const response = await teacherFetch(`/api/academic/assignments/${encodeURIComponent(assignment.id)}/submissions`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل حلول التلاميذ.");
    const submissions = Array.isArray(payload.data) ? payload.data : [];
    elements.teacherSubmissionsList.replaceChildren();
    if (!submissions.length) {
      elements.teacherSubmissionsList.append(Object.assign(document.createElement("p"), { className: "teacher-assignment-empty", textContent: "لم يرسل أي تلميذ حلاً بعد." }));
      return;
    }
    for (const submission of submissions) {
      const card = document.createElement("article");
      card.className = "teacher-submission-card";
      const header = document.createElement("div");
      header.className = "teacher-submission-head";
      const name = document.createElement("strong");
      name.textContent = submission.student?.studentName || "تلميذ";
      const status = document.createElement("span");
      status.className = `teacher-submission-status ${submission.status === "RECEIVED" || submission.status === "GRADED" ? "is-received" : "is-pending"}`;
      status.textContent = submission.status === "RECEIVED" || submission.status === "GRADED" ? "تم تأكيد الاستلام" : "حل جديد";
      header.append(name, status);
      card.append(header);
      if (submission.answerText) {
        const answer = document.createElement("p");
        answer.className = "teacher-submission-answer";
        answer.textContent = submission.answerText;
        card.append(answer);
      }
      const actions = document.createElement("div");
      actions.className = "teacher-submission-actions";
      if (submission.attachmentUrl || submission.attachmentMimeType) {
        const view = document.createElement("button");
        view.type = "button";
        view.className = "btn-view-submissions";
        view.textContent = "أرى الحل";
        view.addEventListener("click", () => void openTeacherSubmissionFile(submission, card));
        actions.append(view);
      }
      if (submission.status !== "RECEIVED" && submission.status !== "GRADED") {
        const receive = document.createElement("button");
        receive.type = "button";
        receive.className = "confirm-receipt-btn";
        receive.textContent = "تأكيد الاستلام";
        receive.addEventListener("click", () => void receiveTeacherSubmission(submission.id));
        actions.append(receive);
      }
      card.append(actions);
      elements.teacherSubmissionsList.append(card);
    }
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) elements.teacherSubmissionsList.replaceChildren(Object.assign(document.createElement("p"), { className: "teacher-assignment-empty", textContent: error.message || "تعذر تحميل الحلول." }));
  }
}

async function deleteTeacherAssignment(assignmentId) {
  if (!assignmentId || !window.confirm("هل تريد حذف هذا الواجب؟")) return;
  try {
    const response = await teacherFetch(`/api/academic/assignments/${encodeURIComponent(assignmentId)}`, { method: "DELETE", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر حذف الواجب.");
    showToast(payload.message || "تم حذف الواجب.");
    await loadAssignments();
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) showDashboardError(error.message || "تعذر حذف الواجب.");
  }
}

function beginScheduleEdit(scheduledClassId) {
  const scheduledClass = scheduledClasses.find((item) => item.id === scheduledClassId);
  if (!scheduledClass) return;
  editingScheduledClassId = scheduledClass.id;
  syncScheduleSubjectOptions(scheduledClass.subject);
  elements.scheduleDateTime.value = toDateTimeLocalValue(scheduledClass.scheduledAt);
  elements.scheduleSubmitButton.textContent = "حفظ التعديل";
  elements.scheduleCancelButton.hidden = false;
  setScheduleManagerOpen(true);
  elements.scheduleForm?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function saveScheduledClass(event) {
  event.preventDefault();
  const subject = elements.scheduleSubject?.value;
  const localDateTime = elements.scheduleDateTime?.value;
  const scheduledAt = localDateTime ? new Date(localDateTime).toISOString() : "";
  if (!subject || !scheduledAt) {
    showDashboardError("حدد نوع الحصة والتاريخ والتوقيت أولاً.");
    return;
  }

  const isEditing = Boolean(editingScheduledClassId);
  try {
    const response = await teacherFetch(
      isEditing ? `/api/schedules/${encodeURIComponent(editingScheduledClassId)}` : "/api/schedules",
      {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ level: currentLevel, subject, scheduledAt }),
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر حفظ الحصة المبرمجة.");

    showToast(payload.message || "تم حفظ الحصة المبرمجة.");
    resetScheduleForm();
    await loadLevelSchedule();
  } catch (error) {
    console.error("Unable to save scheduled class:", error);
    showDashboardError(error.message || "تعذر حفظ الحصة المبرمجة.");
  }
}

async function deleteScheduledClass(scheduledClassId) {
  if (!window.confirm("هل تريد حذف هذه الحصة المبرمجة؟")) return;
  try {
    const response = await teacherFetch(`/api/schedules/${encodeURIComponent(scheduledClassId)}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر حذف الحصة المبرمجة.");

    showToast(payload.message || "تم حذف الحصة المبرمجة.");
    if (editingScheduledClassId === scheduledClassId) resetScheduleForm();
    await loadLevelSchedule();
  } catch (error) {
    console.error("Unable to delete scheduled class:", error);
    showDashboardError(error.message || "تعذر حذف الحصة المبرمجة.");
  }
}

async function toggleTeacherAbsence() {
  try {
    const response = await teacherFetch(`/api/schedules/absence/${encodeURIComponent(currentLevel)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ isAbsent: !teacherAbsent }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحديث حالة الغياب.");

    teacherAbsent = payload.data?.isAbsent === true;
    renderTeacherAbsence();
    showToast(payload.message || "تم تحديث حالة غياب الأستاذ.");
  } catch (error) {
    console.error("Unable to update teacher absence:", error);
    showDashboardError(error.message || "تعذر تحديث حالة الغياب.");
  }
}

async function updateStudent(studentId, updates) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student) {
    throw new Error("تعذر العثور على بيانات التلميذ الحالية.");
  }

  const payload = {
    paymentStage:
      typeof updates.paymentStage === "string"
        ? updates.paymentStage
        : student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID"),
    amountDue:
      Object.prototype.hasOwnProperty.call(updates, "amountDue")
        ? updates.amountDue
        : student.amountDue ?? null,
    mathEnrollment:
      typeof updates.mathEnrollment === "boolean" ? updates.mathEnrollment : Boolean(student.mathEnrollment),
    physicsEnrollment:
      typeof updates.physicsEnrollment === "boolean" ? updates.physicsEnrollment : Boolean(student.physicsEnrollment),
    liveAccessEnabled:
      typeof updates.liveAccessEnabled === "boolean"
        ? updates.liveAccessEnabled
        : Boolean(student.liveAccessEnabled),
    ...(typeof updates.accountActive === "boolean" ? { accountActive: updates.accountActive } : {}),
    physicsNote: "",
    mathNote: "",
  };

  const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "تعذر حفظ تحديثات التلميذ.");
  }

  return data;
}

async function requestCardReupload(studentId) {
  try {
    const response = await teacherFetch(
      `/api/students/${encodeURIComponent(studentId)}/request-card-reupload`,
      { method: "PUT", headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "تعذر إرسال طلب إعادة رفع البطاقة.");
    }

    showToast(payload.message || "تم إرسال طلب إعادة رفع البطاقة.");
    await fetchStudents(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to request card reupload:", error);
      showDashboardError(error.message || "تعذر إرسال طلب إعادة رفع البطاقة.");
    }
  }
}

async function confirmCardIdentity(studentId) {
  try {
    const response = await teacherFetch(
      `/api/students/${encodeURIComponent(studentId)}/confirm-card-identity`,
      { method: "PUT", headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "تعذر تأكيد هوية البطاقة.");
    }

    showToast(payload.message || "تم تأكيد هوية البطاقة وتفعيل الحساب.");
    await fetchStudents(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to confirm student card identity:", error);
      showDashboardError(error.message || "تعذر تأكيد هوية البطاقة.");
    }
  }
}

async function toggleLiveAccess(studentId) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student) {
    return;
  }

  try {
    const nextValue = !Boolean(student.liveAccessEnabled);
    await updateStudent(studentId, {
      liveAccessEnabled: nextValue,
      ...(nextValue ? { accountActive: true } : {}),
    });
    showToast(nextValue
      ? "تم تفعيل الحساب والسماح للتلميذ بدخول الحصة مع بقاء الاشتراك مجانيًا."
      : "تم منع التلميذ من دخول الحصة، ولم يتغير نوع الاشتراك.");
    await fetchStudents(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to update live access:", error);
      showDashboardError(error.message || "تعذر تحديث صلاحية دخول الحصة.");
    }
  }
}

function configureSubscriptionTypeOptions(student) {
  if (!elements.subscriptionPaymentStage) return;
  const isUniversityStudent = student.level === "طالب جامعي";
  const options = isUniversityStudent
    ? [
        { value: "PAID", label: "اشتراك مدفوع" },
        { value: "UNPAID", label: "اشتراك مجاني" },
      ]
    : [
        { value: "BOTH", label: "فيزياء ورياضيات" },
        { value: "PHYSICS", label: "فيزياء فقط" },
        { value: "MATH", label: "رياضيات فقط" },
      ];

  elements.subscriptionPaymentStage.replaceChildren();
  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    elements.subscriptionPaymentStage.append(option);
  });
  if (elements.subscriptionTypeLabel) {
    elements.subscriptionTypeLabel.firstChild.textContent = isUniversityStudent ? "نوع اشتراك الجامعة" : "اشتراك الحصص";
  }
  elements.subscriptionPaymentStage.value = isUniversityStudent
    ? student.paymentStage === "PAID" || student.paymentStatus ? "PAID" : "UNPAID"
    : secondarySubscriptionMode(student);
}

function syncPaymentAmountField() {
  const needsAmount = elements.paymentStatusStage?.value !== "UNPAID";
  if (elements.paymentAmountField) elements.paymentAmountField.hidden = !needsAmount;
  if (elements.paymentStatusAmount) {
    elements.paymentStatusAmount.required = needsAmount;
    if (!needsAmount) elements.paymentStatusAmount.value = "";
  }
}

function openPaymentStatusModal(studentId) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student || student.level === "طالب جامعي" || !elements.paymentStatusModal) return;

  paymentStatusStudentId = studentId;
  elements.paymentStatusStudentName.textContent = student.studentName;
  elements.paymentStatusStage.value = student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");
  elements.paymentStatusAmount.value = Number.isSafeInteger(student.amountDue) ? String(student.amountDue) : "";
  syncPaymentAmountField();
  elements.paymentStatusModal.hidden = false;
  elements.paymentStatusModal.classList.add("is-open");
}

function closePaymentStatusModal() {
  paymentStatusStudentId = null;
  elements.paymentStatusModal?.classList.remove("is-open");
  if (elements.paymentStatusModal) elements.paymentStatusModal.hidden = true;
}

async function savePaymentStatus(event) {
  event.preventDefault();
  if (!paymentStatusStudentId) return;
  const student = currentStudents.find((item) => item.id === paymentStatusStudentId);
  if (!student) return;

  const paymentStage = elements.paymentStatusStage.value;
  const amountValue = elements.paymentStatusAmount.value.trim();
  const amountDue = paymentStage === "UNPAID" ? null : Number(amountValue);
  if (paymentStage !== "UNPAID" && (!Number.isSafeInteger(amountDue) || amountDue <= 0)) {
    showDashboardError("حدد قيمة صحيحة للدفع أو الوعد بالدفع.");
    return;
  }

  const submitButton = elements.paymentStatusForm?.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  try {
    await updateStudent(paymentStatusStudentId, {
      paymentStage,
      amountDue,
      liveAccessEnabled: paymentStage !== "UNPAID",
    });
    closePaymentStatusModal();
    showToast(paymentStage === "UNPAID" ? "تم منع الطالب غير المدفوع من دخول الحصة." : "تم حفظ حالة الدفع والقيمة.");
    await fetchStudents(currentLevel);
  } catch (error) {
    console.error("Unable to save payment status:", error);
    showDashboardError(error.message || "تعذر حفظ حالة الدفع.");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function openSubscriptionModal(studentId) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student || !elements.subscriptionModal) {
    return;
  }

  subscriptionStudentId = studentId;
  elements.subscriptionStudentName.textContent = student.studentName;
  configureSubscriptionTypeOptions(student);
  elements.subscriptionLiveAccess.checked = Boolean(student.liveAccessEnabled);
  elements.subscriptionModal.hidden = false;
  elements.subscriptionModal.classList.add("is-open");
}

function closeSubscriptionModal() {
  subscriptionStudentId = null;
  elements.subscriptionModal?.classList.remove("is-open");
  if (elements.subscriptionModal) {
    elements.subscriptionModal.hidden = true;
  }
}

async function saveSubscription(event) {
  event.preventDefault();
  if (!subscriptionStudentId) {
    return;
  }

  const student = currentStudents.find((item) => item.id === subscriptionStudentId);
  if (!student) return;
  const selectedMode = elements.subscriptionPaymentStage.value;
  const isUniversityStudent = student.level === "طالب جامعي";
  const enrollment = isUniversityStudent
    ? { mathEnrollment: true, physicsEnrollment: true }
    : selectedMode === "BOTH"
      ? { mathEnrollment: true, physicsEnrollment: true }
      : selectedMode === "PHYSICS"
        ? { mathEnrollment: false, physicsEnrollment: true }
        : { mathEnrollment: true, physicsEnrollment: false };
  const paymentStage = isUniversityStudent
    ? selectedMode
    : student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");

  const submitButton = elements.subscriptionForm?.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;

  try {
    await updateStudent(subscriptionStudentId, {
      paymentStage,
      ...enrollment,
      liveAccessEnabled: Boolean(elements.subscriptionLiveAccess?.checked),
    });
    closeSubscriptionModal();
    showToast("تم حفظ نوع اشتراك التلميذ.");
    await fetchStudents(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to save subscription settings:", error);
      showDashboardError(error.message || "تعذر حفظ اشتراك التلميذ.");
    }
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function revokeCardPreviewObjectUrl() {
  if (cardPreviewObjectUrl) {
    URL.revokeObjectURL(cardPreviewObjectUrl);
    cardPreviewObjectUrl = null;
  }
}

function closeStudentCardPreview() {
  cardPreviewRequestId += 1;
  cardPreviewStudentId = null;
  revokeCardPreviewObjectUrl();
  if (elements.cardPreviewImage) {
    elements.cardPreviewImage.onload = null;
    elements.cardPreviewImage.onerror = null;
    elements.cardPreviewImage.removeAttribute("src");
    elements.cardPreviewImage.hidden = true;
  }
  if (elements.cardPreviewModal) {
    elements.cardPreviewModal.hidden = true;
    elements.cardPreviewModal.classList.remove("is-open");
  }
  if (elements.cardPreviewStatus) {
    elements.cardPreviewStatus.textContent = "";
    elements.cardPreviewStatus.classList.remove("is-error");
  }
  if (elements.cardPreviewSaveDriveButton) {
    elements.cardPreviewSaveDriveButton.disabled = true;
    elements.cardPreviewSaveDriveButton.textContent = "حفظ البطاقة في Google Drive";
  }
  cardPreviewPreviousFocus?.focus?.();
  cardPreviewPreviousFocus = null;
  document.body.style.overflow = "";
}

async function viewStudentCard(studentId) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student?.cardPhotoUrl) {
    showDashboardError("لا توجد صورة بطاقة لهذا المستخدم.");
    return;
  }

  if (!elements.cardPreviewModal || !elements.cardPreviewImage) {
    showDashboardError("عارض بطاقة الطالب غير متاح حالياً.");
    return;
  }

  const requestId = ++cardPreviewRequestId;
  cardPreviewStudentId = studentId;
  cardPreviewPreviousFocus = document.activeElement;
  revokeCardPreviewObjectUrl();
  elements.cardPreviewTitle.textContent = `بطاقة الطالب: ${student.studentName || "طالب جامعي"}`;
  elements.cardPreviewStatus.textContent = "جارٍ تحميل صورة البطاقة…";
  elements.cardPreviewStatus.classList.remove("is-error");
  elements.cardPreviewImage.hidden = true;
  elements.cardPreviewImage.removeAttribute("src");
  elements.cardPreviewModal.hidden = false;
  elements.cardPreviewModal.classList.add("is-open");
  document.body.style.overflow = "hidden";
  elements.closeCardPreviewButton?.focus();

  try {
    const response = await teacherFetch(
      `/api/students/${encodeURIComponent(studentId)}/card-photo`,
      { headers: { Accept: "image/*, application/pdf" } }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "تعذر عرض صورة البطاقة.");
    }

    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error("الملف المحفوظ ليس صورة بطاقة صالحة.");
    }
    if (requestId !== cardPreviewRequestId || elements.cardPreviewModal.hidden) return;

    const imageUrl = URL.createObjectURL(blob);
    cardPreviewObjectUrl = imageUrl;
    elements.cardPreviewImage.onload = () => {
      if (requestId === cardPreviewRequestId) {
        elements.cardPreviewStatus.textContent = "تم تحميل البطاقة. يمكنك مراجعتها ثم حفظها في Google Drive أو إغلاقها.";
        elements.cardPreviewImage.hidden = false;
        if (elements.cardPreviewSaveDriveButton) elements.cardPreviewSaveDriveButton.disabled = false;
      }
    };
    elements.cardPreviewImage.onerror = () => {
      if (requestId === cardPreviewRequestId) {
        elements.cardPreviewStatus.textContent = "تعذر فك صورة البطاقة.";
        elements.cardPreviewStatus.classList.add("is-error");
        elements.cardPreviewImage.hidden = true;
      }
    };
    elements.cardPreviewImage.src = imageUrl;
  } catch (error) {
    if (requestId !== cardPreviewRequestId) return;
    elements.cardPreviewStatus.textContent = error.message || "تعذر عرض صورة البطاقة.";
    elements.cardPreviewStatus.classList.add("is-error");
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to view student card:", error);
    }
  }
}

function closePaymentReceiptPreview() {
  if (paymentReceiptPreviewObjectUrl) {
    URL.revokeObjectURL(paymentReceiptPreviewObjectUrl);
    paymentReceiptPreviewObjectUrl = null;
  }
  paymentReceiptPreviewRequestId += 1;
  paymentReceiptPreviewStudentId = null;
  if (elements.paymentReceiptPreviewModal) {
    elements.paymentReceiptPreviewModal.hidden = true;
    elements.paymentReceiptPreviewModal.classList.remove("is-open");
  }
  if (elements.paymentReceiptPreviewImage) {
    elements.paymentReceiptPreviewImage.hidden = true;
    elements.paymentReceiptPreviewImage.removeAttribute("src");
  }
  if (elements.paymentReceiptPreviewPdf) {
    elements.paymentReceiptPreviewPdf.hidden = true;
    elements.paymentReceiptPreviewPdf.removeAttribute("src");
  }
  if (elements.paymentReceiptPreviewStatus) {
    elements.paymentReceiptPreviewStatus.textContent = "جارٍ تحميل الوصل…";
    elements.paymentReceiptPreviewStatus.classList.remove("is-error");
  }
  if (elements.paymentReceiptOpenButton) {
    elements.paymentReceiptOpenButton.hidden = true;
    elements.paymentReceiptOpenButton.disabled = true;
  }
  if (elements.paymentReceiptSaveDriveButton) {
    elements.paymentReceiptSaveDriveButton.disabled = true;
    elements.paymentReceiptSaveDriveButton.textContent = "حفظ الوصل في Google Drive";
  }
  document.body.style.overflow = "";
}

async function viewStudentPaymentReceipt(studentId) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student?.paymentReceiptUrl) {
    openDocumentFeedback("وصل الدفع غير متاح حالياً لهذا المستخدم.", "وصل الدفع غير متاح");
    return;
  }
  if (!elements.paymentReceiptPreviewModal || !elements.paymentReceiptPreviewImage || !elements.paymentReceiptPreviewPdf) {
    openDocumentFeedback("عارض وصل الدفع غير متاح حالياً.", "تعذر عرض الوثيقة");
    return;
  }

  const requestId = ++paymentReceiptPreviewRequestId;
  paymentReceiptPreviewStudentId = studentId;
  if (paymentReceiptPreviewObjectUrl) URL.revokeObjectURL(paymentReceiptPreviewObjectUrl);
  paymentReceiptPreviewObjectUrl = null;
  elements.paymentReceiptPreviewStatus.textContent = "جارٍ تحميل الوصل…";
  elements.paymentReceiptPreviewStatus.classList.remove("is-error");
  elements.paymentReceiptPreviewImage.hidden = true;
  elements.paymentReceiptPreviewImage.removeAttribute("src");
  elements.paymentReceiptPreviewPdf.hidden = true;
  elements.paymentReceiptPreviewPdf.removeAttribute("src");
  if (elements.paymentReceiptOpenButton) {
    elements.paymentReceiptOpenButton.hidden = true;
    elements.paymentReceiptOpenButton.disabled = true;
  }
  elements.paymentReceiptSaveDriveButton.disabled = true;
  elements.paymentReceiptPreviewModal.hidden = false;
  elements.paymentReceiptPreviewModal.classList.add("is-open");
  document.body.style.overflow = "hidden";

  try {
    const response = await teacherFetch(
      `/api/students/${encodeURIComponent(studentId)}/payment-receipt`,
      { headers: { Accept: "image/*, application/pdf" } }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "تعذر عرض وصل الدفع.");
    }
    const blob = await response.blob();
    const isPdf = blob.type === "application/pdf" || String(response.headers.get("Content-Disposition") || "").toLowerCase().includes(".pdf");
    const isImage = blob.type.startsWith("image/");
    if (!isPdf && !isImage) throw new Error("الملف المحفوظ ليس صورة أو PDF صالحًا.");
    if (requestId !== paymentReceiptPreviewRequestId || elements.paymentReceiptPreviewModal.hidden) return;

    const documentUrl = URL.createObjectURL(blob);
    paymentReceiptPreviewObjectUrl = documentUrl;
    if (isPdf) {
      elements.paymentReceiptPreviewStatus.textContent = "تم تحميل ملف PDF. يمكنك مراجعته ثم حفظه في Google Drive.";
      elements.paymentReceiptPreviewPdf.hidden = false;
      if (elements.paymentReceiptOpenButton) {
        elements.paymentReceiptOpenButton.hidden = false;
        elements.paymentReceiptOpenButton.disabled = false;
      }
      elements.paymentReceiptSaveDriveButton.disabled = false;
      elements.paymentReceiptPreviewPdf.src = documentUrl;
    } else {
      elements.paymentReceiptPreviewImage.onload = () => {
        if (requestId === paymentReceiptPreviewRequestId) {
          elements.paymentReceiptPreviewStatus.textContent = "تم تحميل الصورة. يمكنك مراجعتها ثم حفظها في Google Drive.";
          elements.paymentReceiptPreviewImage.hidden = false;
          elements.paymentReceiptSaveDriveButton.disabled = false;
        }
      };
      elements.paymentReceiptPreviewImage.onerror = () => {
        if (requestId === paymentReceiptPreviewRequestId) {
          elements.paymentReceiptPreviewStatus.textContent = "تعذر فك صورة وصل الدفع.";
          elements.paymentReceiptPreviewStatus.classList.add("is-error");
          elements.paymentReceiptPreviewImage.hidden = true;
        }
      };
      elements.paymentReceiptPreviewImage.src = documentUrl;
    }
  } catch (error) {
    if (requestId !== paymentReceiptPreviewRequestId) return;
    elements.paymentReceiptPreviewStatus.textContent = error.message || "تعذر عرض وصل الدفع.";
    elements.paymentReceiptPreviewStatus.classList.add("is-error");
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to view payment receipt:", error);
    }
  }
}

async function confirmPaymentReceipt(studentId) {
  try {
    const response = await teacherFetch(
      `/api/students/${encodeURIComponent(studentId)}/confirm-payment-receipt`,
      { method: "PUT", headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "تعذر تأكيد وصل الدفع.");
    }

    showToast(payload.message || "تم تأكيد الدفع وتفعيل الاشتراك المدفوع.");
    await fetchStudents(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to confirm payment receipt:", error);
      showDashboardError(error.message || "تعذر تأكيد وصل الدفع.");
    }
  }
}

async function rejectPaymentReceipt(studentId) {
  const confirmed = window.confirm("هل تريد رفض هذا الوصل وحذفه؟ سيتمكن الولي من إرسال وصل صحيح من جديد.");
  if (!confirmed) return;
  const reason = window.prompt("اكتب سبب رفض الوصل ليصل إلى ولي الأمر:", "الوصل غير واضح أو لا يثبت عملية الدفع.");
  if (reason === null) return;

  try {
    const response = await teacherFetch(
      `/api/students/${encodeURIComponent(studentId)}/reject-payment-receipt`,
      {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim().slice(0, 500) }),
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "تعذر رفض وصل الدفع.");
    }

    showToast(payload.message || "تم رفض الوصل وإتاحة رفع وصل جديد.");
    await fetchStudents(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to reject payment receipt:", error);
      showDashboardError(error.message || "تعذر رفض وصل الدفع.");
    }
  }
}

const ANNOUNCEMENT_PAYMENT_LABELS = { ALL: "كل الحسابات", FREE: "الحسابات المجانية", PAID: "الحسابات المدفوعة" };
const ANNOUNCEMENT_SUBJECT_LABELS = { ALL: "كل المواد", MATH: "الرياضيات", PHYSICS: "الفيزياء", BOTH: "الرياضيات والفيزياء" };
const ANNOUNCEMENT_CHANNEL_LABELS = { BROWSER: "المتصفح", SMS: "SMS", BOTH: "المتصفح وSMS", MESSENGER: "Facebook Messenger" };
let teacherSmsConfigured = false;
let teacherMessengerConfigured = false;
const ANNOUNCEMENT_STATUS_LABELS = { PENDING: "مجدول", PROCESSING: "جارٍ الإرسال", SENT: "تم الإرسال", FAILED: "فشل الإرسال", CANCELLED: "ملغى" };

function announcementFormValue(name, fallback = "") {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function notificationTargetMode() {
  return announcementFormValue("notification-target-mode", "ALL_LEVEL");
}

function notificationDeliveryChannel() {
  return announcementFormValue("notification-channel", "BROWSER");
}

function syncTeacherNotificationChannel() {
  const channel = notificationDeliveryChannel();
  if (!elements.teacherNotificationChannelStatus) return;
  elements.teacherNotificationChannelStatus.classList.toggle("is-sms", channel === "SMS" || channel === "BOTH");
  elements.teacherNotificationChannelStatus.classList.toggle("is-messenger", channel === "MESSENGER");
  elements.teacherNotificationChannelStatus.classList.toggle("is-configured", channel === "MESSENGER" ? teacherMessengerConfigured : teacherSmsConfigured);
  elements.teacherNotificationChannelStatus.textContent = channel === "BROWSER"
    ? (teacherSmsConfigured ? "المتصفح يعمل وSMS مهيّأ" : "تنبيه المتصفح يعمل حاليًا")
    : channel === "MESSENGER"
      ? (teacherMessengerConfigured ? "Messenger مهيّأ — الإرسال إلى الأولياء المرتبطين فقط" : "يتطلب Messenger إعدادات Meta على الخادم")
      : (teacherSmsConfigured ? "SMS مهيّأ ويمكن اختياره" : "يتطلب SMS إعدادات المزود في الخادم");
}

async function loadTeacherSmsStatus() {
  const options = [elements.teacherNotificationSmsOption, elements.teacherNotificationBothOption].filter(Boolean);
  options.forEach((input) => {
    input.disabled = true;
    input.closest("label")?.classList.add("is-disabled");
  });
  try {
    const response = await teacherFetch("/api/academic/teacher-announcements/sms-status", { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر التحقق من خدمة SMS.");
    const status = payload.data || {};
    teacherSmsConfigured = status.configured === true;
    if (status.configured) {
      options.forEach((input) => {
        input.disabled = false;
        input.closest("label")?.classList.remove("is-disabled");
      });
      if (elements.teacherNotificationChannelStatus) {
        elements.teacherNotificationChannelStatus.textContent = `SMS مفعّل عبر ${status.provider || "المزود"}`;
        elements.teacherNotificationChannelStatus.classList.add("is-configured");
      }
    } else if (elements.teacherNotificationChannelStatus) {
      elements.teacherNotificationChannelStatus.textContent = status.message || "SMS غير مفعّل — بانتظار مفاتيح المزود";
    }
  } catch (error) {
    if (elements.teacherNotificationChannelStatus) elements.teacherNotificationChannelStatus.textContent = "تعذر التحقق من SMS؛ بقيت القناة معطلة.";
    console.info("SMS status is unavailable:", error.message);
  }
  syncTeacherNotificationChannel();
}

async function loadTeacherMessengerStatus() {
  const option = elements.teacherNotificationMessengerOption;
  if (!option) return;
  option.disabled = true;
  option.closest("label")?.classList.add("is-disabled");
  try {
    const response = await teacherFetch("/api/academic/teacher-announcements/messenger-status", { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر التحقق من خدمة Messenger.");
    const status = payload.data || {};
    teacherMessengerConfigured = status.configured === true;
    if (teacherMessengerConfigured) {
      option.disabled = false;
      option.closest("label")?.classList.remove("is-disabled");
      if (elements.teacherNotificationChannelStatus && notificationDeliveryChannel() === "MESSENGER") {
        elements.teacherNotificationChannelStatus.textContent = status.policyMessage || "Messenger مهيّأ — الإرسال إلى الأولياء المرتبطين فقط";
        elements.teacherNotificationChannelStatus.classList.add("is-configured");
      }
    } else if (elements.teacherNotificationChannelStatus && notificationDeliveryChannel() === "MESSENGER") {
      elements.teacherNotificationChannelStatus.textContent = status.message || "Messenger غير مفعّل — بانتظار إعدادات Meta";
    }
  } catch (error) {
    if (elements.teacherNotificationChannelStatus && notificationDeliveryChannel() === "MESSENGER") {
      elements.teacherNotificationChannelStatus.textContent = "تعذر التحقق من Messenger؛ بقيت القناة معطلة.";
    }
    console.info("Messenger status is unavailable:", error.message);
  }
  syncTeacherNotificationChannel();
}

function selectedTeacherNotificationStudentIds() {
  return [...document.querySelectorAll("#teacher-notification-student-list input[data-notification-student]:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function renderTeacherNotificationStudentPicker() {
  if (!elements.teacherNotificationStudentList) return;
  if (!currentStudents.length) {
    elements.teacherNotificationStudentList.innerHTML = "<p>لا يوجد تلاميذ في المستوى المختار.</p>";
    return;
  }
  elements.teacherNotificationStudentList.innerHTML = currentStudents.map((student) => {
    const name = escapeTeacherText(student.studentName || "تلميذ دون اسم");
    const phone = escapeTeacherText(student.parentPhone || "");
    const status = student.paymentStatus ? "مدفوع" : "غير مدفوع";
    return `<label class="teacher-notification-student-option"><input type="checkbox" data-notification-student value="${escapeTeacherText(student.id)}"><span><strong>${name}</strong><small>${phone} · ${status}</small></span></label>`;
  }).join("");
  elements.teacherNotificationStudentList.querySelectorAll("input[data-notification-student]").forEach((input) => {
    input.addEventListener("change", updateTeacherNotificationAudience);
  });
}

function syncTeacherNotificationTargetMode() {
  const selected = notificationTargetMode() === "SELECTED";
  if (elements.teacherNotificationTargetPicker) elements.teacherNotificationTargetPicker.hidden = !selected;
  updateTeacherNotificationAudience();
}

function updateTeacherNotificationAudience() {
  const paymentFilter = announcementFormValue("notification-payment", "ALL");
  const subjectFilter = elements.teacherNotificationSubject?.value || "ALL";
  const targetMode = notificationTargetMode();
  const selectedIds = new Set(selectedTeacherNotificationStudentIds());
  const uniqueParents = new Set();
  let eligibleStudents = 0;
  for (const student of currentStudents) {
    if (targetMode === "SELECTED" && !selectedIds.has(String(student.id))) continue;
    if (paymentFilter === "FREE" && student.paymentStatus) continue;
    if (paymentFilter === "PAID" && !student.paymentStatus) continue;
    if (subjectFilter === "MATH" && !student.mathEnrollment) continue;
    if (subjectFilter === "PHYSICS" && !student.physicsEnrollment) continue;
    if (subjectFilter === "BOTH" && !(student.mathEnrollment && student.physicsEnrollment)) continue;
    eligibleStudents += 1;
    if (student.parentPhone) uniqueParents.add(student.parentPhone);
  }
  const targetLabel = targetMode === "SELECTED"
    ? `${selectedIds.size} تلميذ محدد`
    : "جميع تلاميذ المستوى";
  const textValue = `أولياء الأمور · ${displayLevelLabel(currentLevel)} · ${targetLabel} · ${ANNOUNCEMENT_PAYMENT_LABELS[paymentFilter] || ANNOUNCEMENT_PAYMENT_LABELS.ALL} · ${ANNOUNCEMENT_SUBJECT_LABELS[subjectFilter] || ANNOUNCEMENT_SUBJECT_LABELS.ALL}`;
  if (elements.teacherNotificationAudienceText) elements.teacherNotificationAudienceText.textContent = textValue;
  if (elements.teacherNotificationRecipientCount) elements.teacherNotificationRecipientCount.textContent = eligibleStudents ? `${uniqueParents.size} حسابًا · ${eligibleStudents} تلميذ` : targetMode === "SELECTED" ? "اختر تلميذًا واحدًا على الأقل" : "سيتم حساب العدد";
}

function setTeacherNotificationFeedback(message, isError = false) {
  if (!elements.teacherNotificationFeedback) return;
  elements.teacherNotificationFeedback.hidden = !message;
  elements.teacherNotificationFeedback.textContent = message;
  elements.teacherNotificationFeedback.classList.toggle("is-error", isError);
}

function formatAnnouncementDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Algiers" }).format(date);
}

function renderTeacherAnnouncementHistory(campaigns = []) {
  const container = elements.teacherNotificationHistoryList;
  if (!container) return;
  container.replaceChildren();
  if (!campaigns.length) {
    const empty = document.createElement("p");
    empty.className = "teacher-notification-empty";
    empty.textContent = "لا توجد تنبيهات بعد.";
    container.append(empty);
    return;
  }
  campaigns.forEach((campaign) => {
    const item = document.createElement("article");
    item.className = "teacher-notification-history-item";
    const heading = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = campaign.title || "تنبيه";
    const details = document.createElement("small");
    const channelLabel = ANNOUNCEMENT_CHANNEL_LABELS[campaign.deliveryChannel] || "المتصفح";
    details.textContent = `${campaign.targetLevel || "المستوى"} · ${ANNOUNCEMENT_PAYMENT_LABELS[campaign.paymentFilter] || "كل الحسابات"} · ${ANNOUNCEMENT_SUBJECT_LABELS[campaign.subjectFilter] || "كل المواد"} · ${channelLabel}`;
    heading.append(title, details);
    const meta = document.createElement("span");
    meta.className = `teacher-notification-history-status status-${String(campaign.status || "").toLowerCase()}`;
    meta.textContent = `${ANNOUNCEMENT_STATUS_LABELS[campaign.status] || campaign.status || "—"} · ${campaign.recipientCount || 0} حساب`;
    item.append(heading, meta);
    const statistics = document.createElement("small");
    statistics.className = "teacher-notification-history-statistics";
    statistics.textContent = `مرسل: ${Number(campaign.sentCount) || 0} · مقروء: ${Number(campaign.readCount) || 0} · غير مقروء: ${Number(campaign.unreadCount) || 0}`;
    item.append(statistics);
    if (campaign.status === "PENDING" && campaign.deliveryMode === "SCHEDULED") {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "teacher-notification-cancel";
      cancel.textContent = "إلغاء";
      cancel.addEventListener("click", () => void cancelTeacherAnnouncement(campaign.id));
      item.append(cancel);
    }
    const date = document.createElement("small");
    date.className = "teacher-notification-history-date";
    date.textContent = campaign.deliveryMode === "SCHEDULED" ? `موعد الإرسال: ${formatAnnouncementDate(campaign.scheduledAt)}` : `تاريخ الإرسال: ${formatAnnouncementDate(campaign.sentAt || campaign.createdAt)}`;
    item.append(date);
    container.append(item);
  });
}

async function loadTeacherAnnouncements() {
  try {
    const response = await teacherFetch("/api/academic/teacher-announcements", { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل سجل التنبيهات.");
    const summary = payload.summary || {};
    if (elements.teacherNotificationSentCount) elements.teacherNotificationSentCount.textContent = String(Number(summary.sentCount) || 0);
    if (elements.teacherNotificationReadCount) elements.teacherNotificationReadCount.textContent = String(Number(summary.readCount) || 0);
    if (elements.teacherNotificationUnreadCount) elements.teacherNotificationUnreadCount.textContent = String(Number(summary.unreadCount) || 0);
    renderTeacherAnnouncementHistory(Array.isArray(payload.data) ? payload.data : []);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) console.error("Unable to load teacher announcements:", error);
  }
}

function syncTeacherNotificationDelivery() {
  const scheduled = Boolean(elements.teacherNotificationScheduled?.checked);
  if (elements.teacherNotificationScheduleFields) elements.teacherNotificationScheduleFields.hidden = !scheduled;
  if (elements.teacherNotificationSubmit) elements.teacherNotificationSubmit.textContent = scheduled ? "حفظ التنبيه المبرمج" : "إرسال التنبيه الآن";
}

function scheduledAnnouncementDate() {
  const date = elements.teacherNotificationScheduledDate?.value;
  const time = elements.teacherNotificationScheduledTime?.value;
  if (!date || !time) return "";
  const local = new Date(`${date}T${time}`);
  return Number.isNaN(local.getTime()) ? "" : local.toISOString();
}

async function submitTeacherAnnouncement(event) {
  event.preventDefault();
  const scheduled = Boolean(elements.teacherNotificationScheduled?.checked);
  const targetMode = notificationTargetMode();
  const targetStudentIds = selectedTeacherNotificationStudentIds();
  const payload = {
    targetLevel: currentLevel,
    recipientType: "PARENTS",
    targetMode,
    targetStudentIds,
    paymentFilter: announcementFormValue("notification-payment", "ALL"),
    subjectFilter: elements.teacherNotificationSubject?.value || "ALL",
    deliveryChannel: notificationDeliveryChannel(),
    title: elements.teacherNotificationTitle?.value?.trim() || "",
    body: elements.teacherNotificationBody?.value?.trim() || "",
    deliveryMode: scheduled ? "SCHEDULED" : "IMMEDIATE",
  };
  if (scheduled) payload.scheduledAt = scheduledAnnouncementDate();
  if (!payload.title || !payload.body) {
    setTeacherNotificationFeedback("اكتب عنوان التنبيه ونص الرسالة أولًا.", true);
    return;
  }
  if (targetMode === "SELECTED" && !targetStudentIds.length) {
    setTeacherNotificationFeedback("اختر تلميذًا واحدًا أو مجموعة تلاميذ أولًا.", true);
    return;
  }
  if (scheduled && !payload.scheduledAt) {
    setTeacherNotificationFeedback("اختر تاريخًا ووقتًا مستقبليين صالحين.", true);
    return;
  }
  if (elements.teacherNotificationSubmit) elements.teacherNotificationSubmit.disabled = true;
  setTeacherNotificationFeedback(scheduled ? "جارٍ حفظ التنبيه المبرمج…" : "جارٍ إرسال التنبيه…");
  try {
    const response = await teacherFetch("/api/academic/teacher-announcements", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "تعذر تنفيذ التنبيه.");
    setTeacherNotificationFeedback(scheduled ? `تمت برمجة التنبيه بنجاح في ${formatAnnouncementDate(result.data?.scheduledAt)}.` : `تم إرسال التنبيه إلى ${result.recipientCount || 0} حسابًا بنجاح.`);
    if (!scheduled) {
      elements.teacherNotificationTitle.value = "";
      elements.teacherNotificationBody.value = "";
    }
    await loadTeacherAnnouncements();
  } catch (error) {
    setTeacherNotificationFeedback(error.message || "تعذر تنفيذ التنبيه.", true);
  } finally {
    if (elements.teacherNotificationSubmit) elements.teacherNotificationSubmit.disabled = false;
  }
}

async function cancelTeacherAnnouncement(id) {
  try {
    const response = await teacherFetch(`/api/academic/teacher-announcements/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "تعذر إلغاء التنبيه.");
    setTeacherNotificationFeedback(payload.message || "تم إلغاء التنبيه المبرمج.");
    await loadTeacherAnnouncements();
  } catch (error) {
    setTeacherNotificationFeedback(error.message || "تعذر إلغاء التنبيه.", true);
  }
}

function initializeTeacherNotifications() {
  elements.teacherNotificationForm?.addEventListener("submit", submitTeacherAnnouncement);
  elements.teacherNotificationImmediate?.addEventListener("change", syncTeacherNotificationDelivery);
  elements.teacherNotificationScheduled?.addEventListener("change", syncTeacherNotificationDelivery);
  elements.teacherNotificationSubject?.addEventListener("change", updateTeacherNotificationAudience);
  document.querySelectorAll('input[name="notification-channel"]').forEach((input) => input.addEventListener("change", syncTeacherNotificationChannel));
  document.querySelectorAll('input[name="notification-payment"]').forEach((input) => input.addEventListener("change", updateTeacherNotificationAudience));
  document.querySelectorAll('input[name="notification-target-mode"]').forEach((input) => input.addEventListener("change", syncTeacherNotificationTargetMode));
  elements.teacherNotificationSelectAll?.addEventListener("click", () => {
    document.querySelectorAll("#teacher-notification-student-list input[data-notification-student]").forEach((input) => {
      input.checked = true;
    });
    updateTeacherNotificationAudience();
  });
  elements.teacherNotificationRefresh?.addEventListener("click", () => void loadTeacherAnnouncements());
    syncTeacherNotificationDelivery();
  syncTeacherNotificationChannel();
  void loadTeacherSmsStatus();
  void loadTeacherMessengerStatus();
  updateTeacherNotificationAudience();
  window.setInterval(() => {
    if (!document.hidden) void loadTeacherAnnouncements();
  }, 30_000);
}
const DASHBOARD_TAB_HASHES = {
  overview: "#overview",
  students: "#students-panel",
  schedule: "#schedule-manager",
  registry: "#class-registry-manager",
  assignments: "#assignment-manager",
  lessons: "#lesson-repository-manager",
  quiz: "#quiz-panel",
  "electronic-payments": "#electronic-payments-panel",
  "manual-payments": "#manual-payments-panel",
  "referral-withdrawals": "#referral-withdrawals-panel",
  "forgot-pin-requests": "#forgot-pin-requests-panel",
  "facebook-messenger": "#facebook-messenger-panel",
  notifications: "#teacher-notifications-panel",
};

function tabFromHash(hash = window.location.hash) {
  const entry = Object.entries(DASHBOARD_TAB_HASHES).find(([, value]) => value === hash);
  return entry?.[0] || "overview";
}

function setDashboardTab(tabName, { updateHash = true, focusSearch = false } = {}) {
  const tab = DASHBOARD_TAB_HASHES[tabName] ? tabName : "overview";
  document.querySelectorAll("[data-dashboard-panel]").forEach((panel) => {
    const active = panel.dataset.dashboardPanel === tab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  document.querySelectorAll(".teacher-tab-button[data-dashboard-tab]").forEach((button) => {
    const active = button.dataset.dashboardTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const sidebarLink = document.querySelector(`.teacher-nav-link[data-dashboard-tab="${tab}"]`);
  updateSidebarActive(sidebarLink);
  document.querySelectorAll(".teacher-nav-link[data-dashboard-tab]").forEach((link) => {
    link.classList.toggle("is-active", link === sidebarLink);
  });
  if (updateHash && window.location.hash !== DASHBOARD_TAB_HASHES[tab]) {
    window.history.replaceState(null, "", DASHBOARD_TAB_HASHES[tab]);
  }
  if (tab === "manual-payments") {
    renderManualPayments(currentStudents);
  }
  if (tab === "referral-withdrawals") {
    window.loadTeacherReferralWithdrawals?.();
  }
  if (tab === "electronic-payments") {
    if (electronicPaymentsLevel === currentLevel) {
      renderElectronicPayments(electronicPayments);
    } else {
      void loadElectronicPayments(currentLevel);
    }
  }
  if (tab === "notifications") {
    updateTeacherNotificationAudience();
    void loadTeacherAnnouncements();
  }
  if (tab === "forgot-pin-requests") {
    if (forgotPinRequestsLevel === currentLevel) {
      renderForgotPinRequests(forgotPinRequests);
    } else {
      void loadForgotPinRequests(currentLevel);
    }
  }
  if (focusSearch) {
    window.setTimeout(() => elements.searchInput?.focus(), 0);
  }
}

function startForgotPinPolling() {
  window.clearInterval(forgotPinPollTimer);
  forgotPinPollTimer = window.setInterval(() => {
    if (!sessionStorage.getItem(TEACHER_TOKEN_KEY)) return;
    void loadForgotPinRequests(currentLevel, { silent: true });
  }, 15_000);
}

function renderOnlineUsers(users = []) {
  const onlineUsers = Array.isArray(users) ? users : [];
  if (elements.onlineUsersCount) elements.onlineUsersCount.textContent = String(onlineUsers.length);
  if (elements.onlineUsersSummary) elements.onlineUsersSummary.textContent = `${onlineUsers.length} مستخدم متصل حاليًا`;
  if (!elements.onlineUsersList) return;
  elements.onlineUsersList.replaceChildren();
  if (!onlineUsers.length) {
    const empty = document.createElement("p");
    empty.className = "online-users-empty";
    empty.textContent = "لا يوجد مستخدمون متصلون حاليًا.";
    elements.onlineUsersList.append(empty);
    return;
  }
  onlineUsers.forEach((user) => {
    const item = document.createElement("article");
    item.className = "online-user-item";
    const name = document.createElement("strong");
    name.textContent = user.name || "مستخدم";
    const meta = document.createElement("span");
    const roleLabels = { student: "طالب", teacher: "أستاذ", admin: "إدارة" };
    meta.textContent = `${roleLabels[user.role] || "مستخدم"}${user.level ? ` · ${user.level}` : ""}`;
    item.append(name, meta);
    elements.onlineUsersList.append(item);
  });
}

function initializeOnlineUsers() {
  if (!elements.onlineUsersButton || typeof window.io !== "function") return;
  const token = getTeacherToken();
  if (!token) return;
  const onlineSocket = window.io({ auth: { token }, transports: ["websocket", "polling"] });
  const openOnlineUsers = () => {
    elements.onlineUsersModal.hidden = false;
    elements.onlineUsersButton.setAttribute("aria-expanded", "true");
  };
  const closeOnlineUsers = () => {
    elements.onlineUsersModal.hidden = true;
    elements.onlineUsersButton.setAttribute("aria-expanded", "false");
  };
  elements.onlineUsersButton.addEventListener("click", openOnlineUsers);
  elements.onlineUsersModalClose?.addEventListener("click", closeOnlineUsers);
  elements.onlineUsersModal.addEventListener("click", (event) => {
    if (event.target === elements.onlineUsersModal) closeOnlineUsers();
  });
  onlineSocket.on("online_users_updated", (payload = {}) => renderOnlineUsers(payload.users));
  onlineSocket.on("connect", () => {
    onlineSocket.emit("register_online_presence", { token }, (result = {}) => {
      if (result.ok) renderOnlineUsers(result.users);
    });
  });
  onlineSocket.on("connect_error", () => {
    if (elements.onlineUsersSummary) elements.onlineUsersSummary.textContent = "تعذر تحديث قائمة المتصلين حاليًا.";
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.onlineUsersModal.hidden) closeOnlineUsers();
  });
}

function initializeDashboardTabs() {
  document.querySelectorAll(".teacher-tab-button[data-dashboard-tab]").forEach((button) => {
    button.addEventListener("click", () => setDashboardTab(button.dataset.dashboardTab));
  });
  document.querySelectorAll("[data-dashboard-tab].teacher-nav-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setDashboardTab(link.dataset.dashboardTab);
      setSidebarOpen(false);
    });
  });
  document.querySelectorAll('a[href="#students-panel"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setDashboardTab("students");
    });
  });
  window.addEventListener("hashchange", () => setDashboardTab(tabFromHash(), { updateHash: false }));
  setDashboardTab(tabFromHash(), { updateHash: false });
}

function openLessonVideoModal() {
  if (!elements.lessonVideoModal) return;
  elements.lessonVideoModal.hidden = false;
  document.body.classList.add("teacher-modal-open");
  elements.lessonVideoTitle?.focus();
}

function closeLessonVideoModal() {
  if (!elements.lessonVideoModal) return;
  elements.lessonVideoModal.hidden = true;
  document.body.classList.remove("teacher-modal-open");
}

function setSidebarOpen(isOpen) {
  elements.sidebar?.classList.toggle("is-open", isOpen);
  if (elements.sidebarBackdrop) elements.sidebarBackdrop.hidden = !isOpen;
  elements.sidebarToggle?.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("teacher-sidebar-open", isOpen);
}

function updateSidebarActive(link) {
  elements.sidebarLinks.forEach((item) => item.classList.toggle("is-active", item === link));
  if (elements.pageTitle && link) elements.pageTitle.textContent = link.textContent.trim();
}

function openDeleteConfirmation(studentId) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student || !elements.deleteModal) return;
  pendingDeleteStudentId = studentId;
  if (elements.deleteModalMessage) elements.deleteModalMessage.textContent = `سيتم حذف التلميذ ${student.studentName} وبياناته وسجل حضوره نهائيًا. إذا كان آخر تلميذ مرتبط برقم الهاتف، سيُحذف حساب الولي وبيانات دخوله أيضًا. لا يمكن التراجع عن هذا الإجراء.`;
  elements.deleteModal.hidden = false;
  elements.deleteModal.classList.add("is-open");
  elements.deleteModalApprove?.focus();
}

function closeDeleteConfirmation() {
  pendingDeleteStudentId = null;
  elements.deleteModal?.classList.remove("is-open");
  if (elements.deleteModal) elements.deleteModal.hidden = true;
}

async function approveDeleteConfirmation() {
  const studentId = pendingDeleteStudentId;
  closeDeleteConfirmation();
  if (studentId) await deleteStudent(studentId, true);
}

async function deleteStudent(studentId, confirmed = false) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student) {
    return;
  }

  if (!confirmed) {
    openDeleteConfirmation(studentId);
    return;
  }

  try {
    const response = await teacherFetch(`/api/students/${encodeURIComponent(studentId)}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "تعذر حذف المستخدم.");
    }

    showToast(payload.message || "تم حذف المستخدم بنجاح.");
    await fetchStudents(currentLevel);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to delete student:", error);
      showDashboardError(error.message || "تعذر حذف المستخدم.");
    }
  }
}

function formatAttendanceDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "تاريخ غير متاح";
  }

  return new Intl.DateTimeFormat("ar-DZ", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Algiers",
  }).format(date);
}

function renderAttendanceRecords(records) {
  if (!elements.attendanceList) {
    return;
  }

  elements.attendanceList.replaceChildren();

  if (!records.length) {
    const empty = document.createElement("p");
    empty.id = "attendance-empty";
    empty.className = "attendance-empty";
    empty.textContent = "لا يوجد سجل حضور للحصص المباشرة حتى الآن.";
    elements.attendanceList.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "attendance-records";

  for (const record of records) {
    const item = document.createElement("li");
    item.className = "attendance-record";

    const date = document.createElement("strong");
    date.textContent = formatAttendanceDate(record.joinedAt);

    const level = document.createElement("span");
    level.textContent = record.level || "المستوى الدراسي";

    item.append(date, level);
    list.append(item);
  }

  elements.attendanceList.append(list);
}

async function openAttendanceModal(studentId) {
  const student = currentStudents.find((item) => item.id === studentId);
  if (!student || !elements.attendanceModal) {
    return;
  }

  if (elements.attendanceStudentName) {
    elements.attendanceStudentName.textContent = student.studentName;
  }

  renderAttendanceRecords([]);
  elements.attendanceModal.hidden = false;
  elements.attendanceModal.classList.add("is-open");

  try {
    const response = await teacherFetch(
      `/api/attendance/student/${encodeURIComponent(studentId)}`,
      { headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "تعذر تحميل سجل الحضور.");
    }

    renderAttendanceRecords(Array.isArray(payload.data) ? payload.data : []);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to load attendance history:", error);
      renderAttendanceRecords([]);
      showDashboardError(error.message || "تعذر تحميل سجل الحضور.");
    }
  }
}

function closeAttendanceModal() {
  elements.attendanceModal?.classList.remove("is-open");
  if (elements.attendanceModal) {
    elements.attendanceModal.hidden = true;
  }
}

function updateDashboardDate() {
  if (!elements.dashboardDate) {
    return;
  }

  elements.dashboardDate.textContent = new Intl.DateTimeFormat("ar-DZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function openStudentSearchModal() {
  if (!elements.studentSearchModal) return;
  if (typeof elements.studentSearchModal.showModal === "function") {
    if (!elements.studentSearchModal.open) elements.studentSearchModal.showModal();
  } else {
    elements.studentSearchModal.setAttribute("open", "");
  }
  if (elements.studentSearchModalInput) {
    elements.studentSearchModalInput.value = elements.searchInput?.value || "";
    window.setTimeout(() => elements.studentSearchModalInput.focus(), 0);
  }
}

function closeStudentSearchModal() {
  if (!elements.studentSearchModal) return;
  if (typeof elements.studentSearchModal.close === "function" && elements.studentSearchModal.open) {
    elements.studentSearchModal.close();
  } else {
    elements.studentSearchModal.removeAttribute("open");
  }
}

function submitStudentSearch(event) {
  event.preventDefault();
  if (elements.searchInput && elements.studentSearchModalInput) {
    elements.searchInput.value = elements.studentSearchModalInput.value.trim();
  }
  closeStudentSearchModal();
  applyFilters();
}

function focusStudentSearch() {
  setDashboardTab("students");
  openStudentSearchModal();
}
function jumpToRoster() {
  setDashboardTab("students");
}

function logoutTeacher() {
  void window.revokeServerSession?.();
  clearTeacherSession();
  window.location.replace("./teacher-login.html");
}

async function createPublicInvite() {
  const createSecureId = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 16)}`;
  const roomId = createSecureId();
  const hostToken = createSecureId();
  const hostUrl = new URL("./public-class.html", window.location.href);
  hostUrl.searchParams.set("host", roomId);
  hostUrl.searchParams.set("token", hostToken);
  showToast("تم فتح الحصة العامة. سيظهر زر الدخول في الصفحة الرئيسية للزوار.");

  const publicWindow = window.open(hostUrl.toString(), "_blank");
  if (publicWindow) publicWindow.opener = null;
  else window.location.assign(hostUrl.toString());
}

if (!getTeacherToken()) {
  // getTeacherToken has already redirected; no protected initialization occurs.
} else {
  elements.levelButtons.forEach((button) => {
    button.addEventListener("click", () => fetchStudents(button.dataset.level));
  });
  elements.publicInviteButton?.addEventListener("click", () => { void createPublicInvite(); });
  elements.sidebarToggle?.addEventListener("click", () => setSidebarOpen(!elements.sidebar?.classList.contains("is-open")));
  elements.sidebarClose?.addEventListener("click", () => setSidebarOpen(false));
  elements.sidebarBackdrop?.addEventListener("click", () => setSidebarOpen(false));
  elements.sidebarLogout?.addEventListener("click", logoutTeacher);
  elements.sidebarLinks.forEach((link) => link.addEventListener("click", () => { updateSidebarActive(link); setSidebarOpen(false); }));
  elements.deleteModalClose?.addEventListener("click", closeDeleteConfirmation);
  elements.deleteModalCancel?.addEventListener("click", closeDeleteConfirmation);
  elements.deleteModalApprove?.addEventListener("click", () => { void approveDeleteConfirmation(); });
  elements.deleteModal?.addEventListener("click", (event) => { if (event.target === elements.deleteModal) closeDeleteConfirmation(); });
  elements.documentFeedbackClose?.addEventListener("click", closeDocumentFeedback);
  elements.documentFeedbackModal?.addEventListener("click", (event) => { if (event.target === elements.documentFeedbackModal) closeDocumentFeedback(); });
  elements.studentCertificatesModalClose?.addEventListener("click", closeStudentCertificatesModal);
  elements.studentContactModalClose?.addEventListener("click", closeStudentContactModal);
  elements.studentContactForm?.addEventListener("submit", saveStudentContact);
  elements.studentContactModal?.addEventListener("click", (event) => {
    if (event.target === elements.studentContactModal) closeStudentContactModal();
  });
  elements.studentCertificatesModal?.addEventListener("click", (event) => {
    if (event.target === elements.studentCertificatesModal) closeStudentCertificatesModal();
  });
  elements.studentCertificateForm?.addEventListener("submit", submitStudentCertificate);

  elements.paymentStatusForm?.addEventListener("submit", savePaymentStatus);
  elements.paymentStatusStage?.addEventListener("change", syncPaymentAmountField);
  elements.closePaymentStatusButton?.addEventListener("click", closePaymentStatusModal);
  elements.paymentStatusModal?.addEventListener("click", (event) => {
    if (event.target === elements.paymentStatusModal) closePaymentStatusModal();
  });
  elements.scheduleForm?.addEventListener("submit", saveScheduledClass);
  elements.lessonVideoForm?.addEventListener("submit", saveLessonVideo);
  elements.lessonVideoModalOpen?.addEventListener("click", openLessonVideoModal);
  elements.lessonVideoModalClose?.addEventListener("click", closeLessonVideoModal);
  elements.lessonVideoModal?.addEventListener("click", (event) => {
    if (event.target === elements.lessonVideoModal) closeLessonVideoModal();
  });
  elements.assignmentForm?.addEventListener("submit", submitAssignment);
  elements.assignmentDescription?.addEventListener("paste", handleAssignmentDescriptionPaste);
  elements.scheduleManagerToggle?.addEventListener("click", () => setScheduleManagerOpen(!scheduleManagerOpen));
  elements.lessonRepositoryToggle?.addEventListener("click", () => setLessonRepositoryOpen(!lessonRepositoryOpen));
  elements.assignmentManagerToggle?.addEventListener("click", () => setAssignmentManagerOpen(!assignmentManagerOpen));
  elements.teacherSubmissionsModalClose?.addEventListener("click", closeTeacherSubmissions);
  elements.teacherSubmissionsModal?.addEventListener("click", (event) => { if (event.target === elements.teacherSubmissionsModal) closeTeacherSubmissions(); });
  elements.scheduleCancelButton?.addEventListener("click", resetScheduleForm);
  elements.teacherAbsenceButton?.addEventListener("click", () => void toggleTeacherAbsence());
  elements.globalAbsenceButton?.addEventListener("click", () => void toggleGlobalTeacherAbsence());
  elements.subscriptionForm?.addEventListener("submit", saveSubscription);
  elements.closeSubscriptionButton?.addEventListener("click", closeSubscriptionModal);
  elements.logoutButton?.addEventListener("click", logoutTeacher);

  elements.editModal?.addEventListener("click", (event) => {
    if (event.target === elements.editModal) {
      closeEditModal();
    }
  });
  elements.subscriptionModal?.addEventListener("click", (event) => {
    if (event.target === elements.subscriptionModal) {
      closeSubscriptionModal();
    }
  });
  elements.closeAttendanceButton?.addEventListener("click", closeAttendanceModal);
  elements.closeCardPreviewButton?.addEventListener("click", closeStudentCardPreview);
  elements.cardPreviewSaveDriveButton?.addEventListener("click", (event) => {
    if (cardPreviewStudentId) {
      void saveStudentDocumentToDrive(cardPreviewStudentId, "card", event.currentTarget);
    }
  });
  elements.paymentReceiptOpenButton?.addEventListener("click", () => {
    if (paymentReceiptPreviewObjectUrl) {
      const openedWindow = window.open(paymentReceiptPreviewObjectUrl, "_blank", "noopener,noreferrer");
      if (!openedWindow) window.location.href = paymentReceiptPreviewObjectUrl;
    }
  });
  elements.paymentReceiptSaveDriveButton?.addEventListener("click", (event) => {
    if (paymentReceiptPreviewStudentId) {
      void saveStudentDocumentToDrive(paymentReceiptPreviewStudentId, "receipt", event.currentTarget);
    }
  });
  elements.closePaymentReceiptPreviewButton?.addEventListener("click", closePaymentReceiptPreview);
  elements.paymentReceiptPreviewModal?.addEventListener("click", (event) => {
    if (event.target === elements.paymentReceiptPreviewModal) closePaymentReceiptPreview();
  });
  elements.cardPreviewModal?.addEventListener("click", (event) => {
    if (event.target === elements.cardPreviewModal) {
      closeStudentCardPreview();
    }
  });
  elements.attendanceModal?.addEventListener("click", (event) => {
    if (event.target === elements.attendanceModal) {
      closeAttendanceModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.studentActionsModal && !elements.studentActionsModal.hidden) {
      closeStudentActionsModal();
      return;
    }
    if (event.key === "Escape" && elements.studentCertificatesModal && !elements.studentCertificatesModal.hidden) {
      closeStudentCertificatesModal();
      return;
    }
    if (event.key === "Escape" && elements.documentFeedbackModal && !elements.documentFeedbackModal.hidden) {
      closeDocumentFeedback();
      return;
    }
    if (event.key === "Escape" && elements.deleteModal && !elements.deleteModal.hidden) {
      closeDeleteConfirmation();
      return;
    }
    if (event.key === "Escape" && elements.sidebar?.classList.contains("is-open")) {
      setSidebarOpen(false);
      return;
    }
    if (event.key === "Escape" && elements.cardPreviewModal && !elements.cardPreviewModal.hidden) {
      closeStudentCardPreview();
      return;
    }
    if (event.key === "Escape" && elements.paymentReceiptPreviewModal && !elements.paymentReceiptPreviewModal.hidden) {
      closePaymentReceiptPreview();
    }
  });
  elements.searchInput?.addEventListener("input", applyFilters);
  elements.paymentFilter?.addEventListener("change", applyFilters);
  elements.rosterFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (elements.paymentFilter) elements.paymentFilter.value = button.dataset.paymentFilter || "all";
      setActivePaymentFilter(elements.paymentFilter?.value || "all");
      applyFilters();
    });
  });
  elements.studentActionsModalClose?.addEventListener("click", closeStudentActionsModal);
  elements.studentActionsModal?.addEventListener("click", (event) => {
    if (event.target === elements.studentActionsModal) closeStudentActionsModal();
  });
  elements.studentSearchTrigger?.addEventListener("click", () => {
    setDashboardTab("students");
    openStudentSearchModal();
  });
  elements.studentSearchForm?.addEventListener("submit", submitStudentSearch);
  elements.studentSearchModalClose?.addEventListener("click", closeStudentSearchModal);
  elements.studentSearchModalCancel?.addEventListener("click", closeStudentSearchModal);
  elements.studentSearchModal?.addEventListener("click", (event) => {
    if (event.target === elements.studentSearchModal) closeStudentSearchModal();
  });
  elements.focusStudentSearchButton?.addEventListener("click", focusStudentSearch);
  elements.jumpToRosterButton?.addEventListener("click", jumpToRoster);

  initializeDashboardTabs();
  initializeOnlineUsers();
  initializeTeacherNotifications();
  updateDashboardDate();
  renderGlobalTeacherAbsence();
  void loadGlobalTeacherAbsence();
  fetchStudents(currentLevel);
  startForgotPinPolling();
  void loadForgotPinRequests(currentLevel, { silent: true });
}
