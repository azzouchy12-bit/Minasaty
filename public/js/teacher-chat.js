"use strict";

const teacherChatToken = sessionStorage.getItem("teacherToken");
if (!teacherChatToken) {
  window.location.replace("./teacher-login.html");
}

const teacherChatElements = {
  list: document.getElementById("conversation-list"),
  empty: document.getElementById("conversation-empty"),
  count: document.getElementById("conversation-count"),
  search: document.getElementById("conversation-search"),
  newButton: document.querySelector(".conversation-new-button"),
  emptyState: document.getElementById("chat-empty-state"),
  panel: document.getElementById("chat-panel"),
  name: document.getElementById("chat-student-name"),
  avatar: document.getElementById("chat-student-avatar"),
  level: document.getElementById("chat-student-level"),
  messages: document.getElementById("chat-messages"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("chat-input"),
  error: document.getElementById("chat-error"),
};

let teacherConversations = [];
let activeConversation = null;
let teacherChatSocket = null;
let renderedMessageIds = new Set();
const requestedStudentId = new URLSearchParams(window.location.search).get("studentId");

async function teacherChatFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${teacherChatToken}`,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 || response.status === 403) {
    sessionStorage.removeItem("teacherToken");
    window.location.replace("./teacher-login.html");
    throw new Error("انتهت جلسة الأستاذ.");
  }
  return response;
}

function showTeacherChatError(message) {
  if (!teacherChatElements.error) return;
  teacherChatElements.error.textContent = message;
  teacherChatElements.error.hidden = false;
  window.setTimeout(() => { teacherChatElements.error.hidden = true; }, 4_000);
}

function formatMessageTime(value) {
  return new Intl.DateTimeFormat("ar-DZ", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function renderConversations() {
  const list = teacherChatElements.list;
  if (!list) return;
  const query = String(teacherChatElements.search?.value || "").trim().toLocaleLowerCase("ar");
  const conversations = teacherConversations.filter((conversation) => {
    if (!query) return true;
    return `${conversation.studentName || ""} ${conversation.level || ""}`.toLocaleLowerCase("ar").includes(query);
  });

  list.replaceChildren();
  teacherChatElements.count.textContent = `${teacherConversations.length} تلميذ`;
  teacherChatElements.empty.hidden = conversations.length > 0;
  teacherChatElements.empty.textContent = teacherConversations.length
    ? "لا توجد نتائج مطابقة للبحث."
    : "لا يوجد تلاميذ مسجلون بعد.";

  conversations.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";
    button.classList.toggle("is-active", activeConversation?.id === conversation.id);
    const unread = conversation.lastMessage?.senderRole === "student" && conversation.lastMessage?.isRead === false;
    button.classList.toggle("has-unread", unread);
    button.innerHTML = `<span class="conversation-avatar">${String(conversation.studentName || "ط").slice(0, 1)}<i class="conversation-unread-dot" aria-hidden="true"></i></span>`;
    const copy = document.createElement("span");
    copy.className = "conversation-copy";
    const name = document.createElement("strong");
    name.textContent = conversation.studentName;
    const meta = document.createElement("small");
    meta.textContent = conversation.lastMessage?.content || conversation.level || "محادثة جديدة";
    copy.append(name, meta);
    const time = document.createElement("time");
    if (conversation.lastMessage?.createdAt) time.textContent = formatMessageTime(conversation.lastMessage.createdAt);
    button.append(copy, time);
    button.querySelector(".conversation-unread-dot")?.classList.toggle("is-visible", unread);
    button.addEventListener("click", () => { void openConversation(conversation.id); });
    list.append(button);
  });
}

function renderMessage(message) {
  if (!message?.id || renderedMessageIds.has(message.id)) return;
  renderedMessageIds.add(message.id);
  const bubble = document.createElement("article");
  bubble.className = `chat-bubble ${message.senderRole === "teacher" ? "from-teacher" : "from-student"}`;
  const content = document.createElement("p");
  content.textContent = message.content;
  const time = document.createElement("time");
  time.textContent = formatMessageTime(message.createdAt);
  bubble.append(content, time);
  teacherChatElements.messages.append(bubble);
  teacherChatElements.messages.scrollTop = teacherChatElements.messages.scrollHeight;
}

async function markActiveRead() {
  if (!activeConversation) return;
  await teacherChatFetch(`/api/messages/${encodeURIComponent(activeConversation.id)}/read`, { method: "PUT" });
  if (activeConversation.lastMessage?.senderRole === "student") activeConversation.lastMessage.isRead = true;
  window.dispatchEvent(new CustomEvent("private-messages-read"));
  renderConversations();
}

async function openConversation(studentId) {
  try {
    const response = await teacherChatFetch(`/api/messages/${encodeURIComponent(studentId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل المحادثة.");
    activeConversation = teacherConversations.find((conversation) => conversation.id === studentId) || payload.student;
    teacherChatElements.emptyState.hidden = true;
    teacherChatElements.panel.hidden = false;
    teacherChatElements.name.textContent = payload.student.studentName;
    if (teacherChatElements.avatar) teacherChatElements.avatar.textContent = String(payload.student.studentName || "ت").slice(0, 1);
    teacherChatElements.level.textContent = payload.student.level || "";
    teacherChatElements.messages.replaceChildren();
    renderedMessageIds = new Set();
    payload.messages.forEach(renderMessage);
    await markActiveRead();
  } catch (error) {
    showTeacherChatError(error.message || "تعذر تحميل المحادثة.");
  }
}

async function loadConversations() {
  try {
    const response = await teacherChatFetch("/api/messages/conversations");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل قائمة المحادثات.");
    teacherConversations = payload.conversations || [];
    renderConversations();
    if (requestedStudentId) {
      const requestedConversation = teacherConversations.find((conversation) => conversation.id === requestedStudentId);
      if (requestedConversation) void openConversation(requestedStudentId);
    }
  } catch (error) {
    showTeacherChatError(error.message || "تعذر تحميل الرسائل.");
  }
}

async function sendTeacherMessage(event) {
  event.preventDefault();
  const content = teacherChatElements.input.value.trim();
  if (!activeConversation || !content) return;
  const button = teacherChatElements.form.querySelector("button");
  button.disabled = true;
  try {
    const response = await teacherChatFetch(`/api/messages/${encodeURIComponent(activeConversation.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "تعذر إرسال الرسالة.");
    teacherChatElements.input.value = "";
    renderMessage(payload.message);
    activeConversation.lastMessage = { ...payload.message, isRead: true };
    renderConversations();
  } catch (error) {
    showTeacherChatError(error.message || "تعذر إرسال الرسالة.");
  } finally {
    button.disabled = false;
    teacherChatElements.input.focus();
  }
}

function connectTeacherChatSocket() {
  if (typeof io !== "function") return;
  teacherChatSocket = io("/private-messages", { auth: { token: teacherChatToken } });
  teacherChatSocket.on("private_message_created", (message = {}) => {
    const existing = teacherConversations.find((conversation) => conversation.id === message.studentId);
    if (!existing && message.senderRole === "student") {
      void loadConversations();
      return;
    }
    if (existing) {
      existing.lastMessage = message;
      teacherConversations = [existing, ...teacherConversations.filter((item) => item.id !== existing.id)];
      renderConversations();
    }
    if (activeConversation?.id === message.studentId) {
      renderMessage(message);
      if (message.senderRole === "student") void markActiveRead();
    }
  });
}

teacherChatElements.form?.addEventListener("submit", (event) => { void sendTeacherMessage(event); });
teacherChatElements.search?.addEventListener("input", renderConversations);
teacherChatElements.newButton?.addEventListener("click", () => teacherChatElements.search?.focus());
teacherChatElements.input?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    teacherChatElements.form?.requestSubmit();
  }
});
void loadConversations();
connectTeacherChatSocket();
