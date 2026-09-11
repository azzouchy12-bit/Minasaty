// إذا كان الدخول من تطبيق الأكاديمية الرسمي، تجاوز التنبيه وادخل مباشرة
if (navigator.userAgent.includes("MinasatyApp") || navigator.userAgent.includes("com.comminasatyacadimia.minasaty")) {
    return;
}
(() => {
  "use strict";
(() => {
  "use strict";

  // 🚨 إذا كان الدخول من تطبيق الأكاديمية الرسمي، احذف زر التحميل وتجاوز التنبيه تماماً
  if (
    navigator.userAgent.includes("MinasatyApp") ||
    navigator.userAgent.includes("com.comminasatyacadimia.minasaty") ||
    navigator.userAgent.includes("WebIntoApp") ||
    /;\s*wv\b|Android.*Version\//i.test(navigator.userAgent) ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  ) {
    // 1. حقن كود CSS فوري في رأس الصفحة لإخفاء الزر نهائياً
    const hideStyle = document.createElement("style");
    hideStyle.textContent = "#pwa-dash-float-btn, .pwa-dash-floating-btn { display: none !important; }";
    if (document.head) {
      document.head.appendChild(hideStyle);
    } else {
      document.addEventListener("DOMContentLoaded", () => document.head.appendChild(hideStyle));
    }

    // 2. حذف الزر تماماً من عناصر الصفحة
    const removeBtn = () => {
      const btn = document.getElementById("pwa-dash-float-btn");
      if (btn) {
        btn.style.setProperty("display", "none", "important");
        btn.remove();
      }
    };
    removeBtn();
    document.addEventListener("DOMContentLoaded", removeBtn);
    window.addEventListener("load", removeBtn);

    // 3. إنهاء السكربت فوراً بدون إظهار أي نافذة
    return;
  }
  function ensureFallbackStyles() {
    if (document.querySelector('link[href*="/css/style.css"], link[href*="./css/style.css"]') || document.getElementById("in-app-browser-fallback-style")) return;
    const style = document.createElement("style");
    style.id = "in-app-browser-fallback-style";
    style.textContent = `
      .in-app-browser-modal { position: fixed; z-index: 2147483640; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgba(2,6,23,.82); font-family: Arial,Tahoma,sans-serif; }
      .in-app-browser-modal[hidden] { display: none; }
      .in-app-browser-card { width: min(100%, 31rem); padding: 2rem; color: #e2e8f0; text-align: center; background: linear-gradient(145deg,#142d55,#0b1c34); border: 1px solid #93c5fd; border-radius: 1.2rem; box-shadow: 0 25px 75px rgba(0,0,0,.46); }
      .in-app-browser-card h2 { margin: .4rem 0; color: #fff; }
      .in-app-browser-copy,.in-app-browser-instruction { color: #cbd5e1; line-height: 1.8; }
      .in-app-browser-actions { margin-top: 1rem; }
      .in-app-browser-primary { width: 100%; min-height: 2.9rem; color: #052e16; background: #4ade80; border: 1px solid #86efac; border-radius: .7rem; font: inherit; font-weight: 900; cursor: pointer; }
    `;
    document.head.append(style);
  }

  function ensureGateMarkup() {
    let modal = document.getElementById("in-app-browser-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "in-app-browser-modal";
    modal.className = "in-app-browser-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "in-app-browser-title");
    modal.hidden = true;
    modal.innerHTML = `
      <section class="in-app-browser-card">
        <div class="in-app-browser-icon" aria-hidden="true">↗</div>
        <p class="in-app-browser-kicker">تنبيه لتحسين تجربة التصفح</p>
        <h2 id="in-app-browser-title">افتح الموقع في متصفح كامل</h2>
        <p class="in-app-browser-copy">للاستفادة من جميع مزايا الموقع، افتحه خارج المتصفح الداخلي لتطبيق Telegram أو Facebook أو Messenger.</p>
        <p id="in-app-browser-instruction" class="in-app-browser-instruction"></p>
        <div class="in-app-browser-actions">
          <button id="open-external-browser-btn" class="in-app-browser-primary" type="button">اضغط هنا للدخول فقط</button>
        </div>
      </section>
    `;
    document.body.append(modal);
    return modal;
  }

  const userAgent = navigator.userAgent || "";
  const referrer = document.referrer || "";
  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const hasTelegramReferrer = /(?:telegram|org\.telegram\.messenger|t\.me)/i.test(referrer);
  const hasTelegramRuntime = Boolean(
    window.TelegramWebviewProxy ||
    window.TelegramGameProxy ||
    window.Telegram?.WebApp
  );
  const isStandalone = Boolean(
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches
  );
  const hasInAppToken = /(FBAN|FBAV|FB_IAB|Instagram|Messenger|Telegram|TDesktop|TelegramBot|Line\/|Twitter|Snapchat|TikTok|GSA\/)/i.test(userAgent);
  const isAndroidWebView = isAndroid && (
    /;\s*wv\)/i.test(userAgent) ||
    (/Version\/4\.0/i.test(userAgent) && /Chrome\//i.test(userAgent))
  );
  const isIOSWebView = isIOS && !/Safari\//i.test(userAgent) && !/CriOS|FxiOS|OPiOS/i.test(userAgent);
  // Telegram may open the link in a Chrome Custom Tab whose User-Agent looks
  // like ordinary Chrome. The Android referrer and Telegram runtime markers
  // cover that case without storing any dismissal state.
  const isInAppBrowser = !isStandalone && (
    hasInAppToken ||
    hasTelegramReferrer ||
    hasTelegramRuntime ||
    isAndroidWebView ||
    isIOSWebView
  );

  if (!isInAppBrowser) return;

  ensureFallbackStyles();
  const modal = ensureGateMarkup();
  const openButton = document.getElementById("open-external-browser-btn");
  const instruction = document.getElementById("in-app-browser-instruction");
  if (!modal || !openButton) return;

  const currentUrl = window.location.href;
  if (instruction) {
    instruction.textContent = isAndroid
      ? "اضغط على الزر الأخضر للانتقال إلى Google Chrome."
      : isIOS
        ? "اضغط على الزر الأخضر لفتح الموقع في Safari أو متصفح خارجي."
        : "اضغط على الزر الأخضر لفتح الموقع في متصفح كامل.";
  }

  const showModal = () => {
    modal.hidden = false;
    modal.classList.add("is-open");
    document.body.classList.add("in-app-browser-notice-open");
    openButton.focus();
  };

  openButton.addEventListener("click", () => {
    if (isAndroid) {
      const intentUrl = `intent://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}#Intent;scheme=https;package=com.android.chrome;end`;
      window.location.href = intentUrl;
      return;
    }

    // iOS and desktop in-app browsers only allow an external tab after a user gesture.
    const openedWindow = window.open(currentUrl, "_blank", "noopener,noreferrer");
    if (!openedWindow) window.location.href = currentUrl;
  });

  // No dismissal state is stored: Telegram, Facebook, Messenger, and other
  // in-app browsers must show this gate on every visit.
  window.setTimeout(showModal, 120);
})();
