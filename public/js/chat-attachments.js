"use strict";

const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_ATTACHMENT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".pdf", ".doc", ".docx"]);
const CHAT_IMAGE_TYPES = /^image\//i;

function chatAttachmentExtension(file) {
  const fromName = String(file?.name || "").toLowerCase().match(/\.[a-z0-9]+$/);
  if (fromName) return fromName[0];
  const mime = String(file?.type || "").toLowerCase();
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "application/pdf") return ".pdf";
  if (mime === "application/msword") return ".doc";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  return "";
}

function isAllowedChatAttachment(file) {
  if (!file) return false;
  const extension = chatAttachmentExtension(file);
  const mime = String(file.type || "").toLowerCase();
  if (CHAT_ATTACHMENT_EXTENSIONS.has(extension)) return true;
  if (mime.startsWith("image/") || mime === "application/pdf" || mime.includes("word") || mime.includes("officedocument")) return true;
  return false;
}

function formatChatAttachmentSize(bytes) {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

function initChatComposerAttachments({
  form,
  toolButton,
  menu,
  preview,
  cameraInput,
  fileInput,
  onError,
}) {
  let selectedFile = null;
  let previewObjectUrl = "";

  function closeMenu() {
    if (!menu || !toolButton) return;
    menu.hidden = true;
    toolButton.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    if (!menu || !toolButton) return;
    menu.hidden = !menu.hidden;
    toolButton.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
  }

  function clearPreview() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = "";
    }
    selectedFile = null;
    if (cameraInput) cameraInput.value = "";
    if (fileInput) fileInput.value = "";
    if (preview) {
      preview.replaceChildren();
      preview.hidden = true;
    }
  }

  function renderPreview(file) {
    if (!preview) return;
    preview.replaceChildren();
    const card = document.createElement("div");
    card.className = "chat-attachment-preview-card";
    if (CHAT_IMAGE_TYPES.test(file.type)) {
      const image = document.createElement("img");
      image.alt = file.name || "صورة مرفقة";
      previewObjectUrl = URL.createObjectURL(file);
      image.src = previewObjectUrl;
      card.append(image);
    } else {
      const icon = document.createElement("span");
      icon.className = "chat-attachment-preview-icon";
      icon.textContent = chatAttachmentExtension(file) === ".pdf" ? "PDF" : "DOC";
      card.append(icon);
    }
    const meta = document.createElement("span");
    meta.className = "chat-attachment-preview-meta";
    const name = document.createElement("strong");
    name.textContent = file.name || "مرفق";
    const size = document.createElement("small");
    size.textContent = formatChatAttachmentSize(file.size || 0);
    meta.append(name, size);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chat-attachment-preview-remove";
    remove.setAttribute("aria-label", "إزالة المرفق");
    remove.textContent = "×";
    remove.addEventListener("click", () => clearPreview());
    preview.append(card, meta, remove);
    preview.hidden = false;
  }

  function takeFile(file) {
    if (!file) return;
    if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      onError?.("حجم المرفق يجب ألا يتجاوز 10 ميغابايت.");
      return;
    }
    if (!isAllowedChatAttachment(file)) {
      onError?.("يسمح بالصور وملفات PDF وWord فقط.");
      return;
    }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
    selectedFile = file;
    renderPreview(file);
  }

  toolButton?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleMenu();
  });
  menu?.querySelector("[data-attach='camera']")?.addEventListener("click", () => {
    closeMenu();
    cameraInput?.click();
  });
  menu?.querySelector("[data-attach='file']")?.addEventListener("click", () => {
    closeMenu();
    fileInput?.click();
  });
  cameraInput?.addEventListener("change", () => takeFile(cameraInput.files?.[0]));
  fileInput?.addEventListener("change", () => takeFile(fileInput.files?.[0]));
  document.addEventListener("click", (event) => {
    if (!menu || menu.hidden) return;
    if (menu.contains(event.target) || toolButton?.contains(event.target)) return;
    closeMenu();
  });
  form?.addEventListener("reset", () => clearPreview());

  return {
    getFile: () => selectedFile,
    clear: clearPreview,
    closeMenu,
  };
}

function appendChatMessageAttachment(bubble, message, authorizedFetch) {
  if (!message?.attachment?.url) return;
  const isImage = CHAT_IMAGE_TYPES.test(message.attachment.mimeType || "");
  const block = document.createElement(isImage ? "div" : "a");
  block.className = "chat-message-attachment";
  if (!isImage) {
    block.href = message.attachment.url;
    block.rel = "noopener";
    block.textContent = message.attachment.name || "مرفق";
    block.addEventListener("click", (event) => {
      event.preventDefault();
      void authorizedFetch(message.attachment.url).then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = message.attachment.name || "attachment";
        link.rel = "noopener";
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      });
    });
  } else {
    const image = document.createElement("img");
    image.className = "chat-message-attachment-image";
    image.alt = message.attachment.name || "صورة مرفقة";
    block.append(image);
    void authorizedFetch(message.attachment.url).then(async (response) => {
      if (!response.ok) return;
      image.src = URL.createObjectURL(await response.blob());
    });
  }
  bubble.prepend(block);
}

function buildChatMessageRequest(content, file) {
  if (!file) {
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    };
  }
  const body = new FormData();
  body.append("content", content);
  body.append("attachment", file, file.name || "attachment");
  return { body };
}

window.ChatAttachments = {
  initChatComposerAttachments,
  appendChatMessageAttachment,
  buildChatMessageRequest,
};
