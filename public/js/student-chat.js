"use strict";

const studentChatToken = sessionStorage.getItem("parentToken");
const studentChatId = new URLSearchParams(window.location.search).get("studentId") || sessionStorage.getItem("selectedStudentId") || sessionStorage.getItem("studentId");

if (!studentChatToken || !studentChatId) {
  window.location.replace("./parent-login.html");
}

const studentChatElements = {
  name: document.getElementById("student-chat-name"),
  avatar: document.getElementById("student-chat-avatar"),
  level: document.getElementById("student-chat-level"),
  messages: document.getElementById("student-chat-messages"),
  form: document.getElementById("student-chat-form"),
  input: document.getElementById("student-chat-input"),
  sendButton: document.querySelector("#student-chat-form .chat-send-button"),
  error: document.getElementById("student-chat-error"),
};

const studentChatAttachments = window.ChatAttachments?.initChatComposerAttachments({
  form: studentChatElements.form,
  toolButton: document.getElementById("student-chat-attach-btn"),
  menu: document.getElementById("student-chat-attach-menu"),
  preview: document.getElementById("student-chat-attachment-preview"),
  cameraInput: document.getElementById("student-chat-camera-input"),
  fileInput: document.getElementById("student-chat-file-input"),
  onError: (message) => showStudentChatError(message),
});

const studentRenderedMessageIds = new Set();

async function studentChatFetch(url, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${studentChatToken}`,
      Accept: "application/json",
      ...(isFormData ? {} : options.headers || {}),
    },
  });
  if (response.status === 428) {
    const payload = await response.clone().json().catch(() => ({}));
    if (payload.code === "PARENT_PIN_CHANGE_REQUIRED") {
      sessionStorage.setItem("forceParentPinChange", "1");
      window.location.replace("./force-pin.html");
      throw new Error("يجب تغيير كلمة المرور المؤقتة قبل استعمال المنصة.");
    }
  }
  if (response.status === 401 || response.status === 403) {
    window.location.replace("./parent-login.html");
    throw new Error("انتهت جلسة الولي أو لا تملك صلاحية هذا الطالب.");
  }
  return response;
}

function showStudentChatError(message) {
  studentChatElements.error.textContent = message;
  studentChatElements.error.hidden = false;
  window.setTimeout(() => { studentChatElements.error.hidden = true; }, 4_000);
}

function renderStudentMessage(message) {
  if (!message?.id || studentRenderedMessageIds.has(message.id)) return;
  studentRenderedMessageIds.add(message.id);
  const bubble = document.createElement("article");
  bubble.className = `chat-bubble ${message.senderRole === "student" ? "from-student" : "from-teacher"}`;
  window.ChatAttachments?.appendChatMessageAttachment(bubble, message, studentChatFetch);
  if (message.content) {
    const content = document.createElement("p");
    content.textContent = message.content;
    bubble.append(content);
  }
  const time = document.createElement("time");
  time.textContent = new Intl.DateTimeFormat("ar-DZ", { dateStyle: "short", timeStyle: "short" }).format(new Date(message.createdAt));
  bubble.append(time);
  studentChatElements.messages.append(bubble);
  studentChatElements.messages.scrollTop = studentChatElements.messages.scrollHeight;
}

async function markStudentMessagesRead() {
  await studentChatFetch(`/api/messages/${encodeURIComponent(studentChatId)}/read`, { method: "PUT" });
  window.dispatchEvent(new CustomEvent("private-messages-read"));
}

async function loadStudentConversation() {
  try {
    const response = await studentChatFetch(`/api/messages/${encodeURIComponent(studentChatId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل محادثتك مع الأستاذ.");
    studentChatElements.name.textContent = payload.student.studentName;
    if (studentChatElements.avatar) studentChatElements.avatar.textContent = String(payload.student.studentName || "ت").slice(0, 1);
    studentChatElements.level.textContent = payload.student.level || "";
    studentChatElements.messages.replaceChildren();
    payload.messages.forEach(renderStudentMessage);
    await markStudentMessagesRead();
  } catch (error) {
    showStudentChatError(error.message || "تعذر تحميل الرسائل.");
  }
}

async function sendStudentMessage(event) {
  event.preventDefault();
  const content = studentChatElements.input.value.trim();
  const file = studentChatAttachments?.getFile?.() || null;
  if (!content && !file) return;
  const button = studentChatElements.sendButton;
  if (button) button.disabled = true;
  try {
    const request = window.ChatAttachments?.buildChatMessageRequest(content, file);
    const response = await studentChatFetch(`/api/messages/${encodeURIComponent(studentChatId)}`, {
      method: "POST",
      ...request,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "تعذر إرسال الرسالة.");
    studentChatElements.input.value = "";
    studentChatAttachments?.clear?.();
    renderStudentMessage(payload.message);
  } catch (error) {
    showStudentChatError(error.message || "تعذر إرسال الرسالة.");
  } finally {
    if (button) button.disabled = false;
    studentChatElements.input.focus();
  }
}

function connectStudentChatSocket() {
  if (typeof io !== "function") return;
  const socket = io("/private-messages", {
    auth: { token: studentChatToken, studentId: studentChatId },
  });
  socket.on("private_message_created", (message = {}) => {
    if (message.studentId !== studentChatId) return;
    renderStudentMessage(message);
    if (message.senderRole === "teacher") void markStudentMessagesRead();
  });
}

studentChatElements.form?.addEventListener("submit", (event) => { void sendStudentMessage(event); });
studentChatElements.input?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    studentChatElements.form?.requestSubmit();
  }
});
void loadStudentConversation();
connectStudentChatSocket();
