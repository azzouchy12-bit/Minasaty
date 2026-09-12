/**
 * Minasaty - In-App Browser Detector & Chrome Redirect Gate
 * 
 * يكشف ما إذا كان الزائر يتصفح الموقع من داخل المتصفحات المدمجة لتطبيقات:
 * فيسبوك، ماسنجر، إنستغرام، أو تيليجرام.
 * ويوجه الزائر لفتح الموقع في متصفح Google Chrome لضمان أفضل أداء واستقرار للبث المباشر.
 */
"use strict";

(function () {
  // 1. فحص شامل ومؤكد لاستثناء تطبيق المنصة الرسمي الخاص بك (MinasatyApp)
  const ua = navigator.userAgent || navigator.vendor || window.opera || "";
  
  // فحص توقيع التطبيق في الـ User-Agent أو كائنات الواجهة البرمجية المحقونة
  const isOfficialAppSignature =
    /MinasatyApp|com\.comminasatyacadimia\.minasaty|Minasaty/i.test(ua) ||
    typeof window.MinasatyApp !== "undefined" ||
    typeof window.Android !== "undefined" ||
    typeof window.AndroidInterface !== "undefined" ||
    typeof window.ReactNativeWebView !== "undefined" ||
    window.IS_APP === true ||
    document.body?.classList?.contains("is-app");

  // فحص معلمات الرابط أو الذاكرة المحلية الخاصة بالتطبيق
  let isAppStorageOrParam = false;
  try {
    if (localStorage.getItem("minasaty_in_app") === "true") {
      isAppStorageOrParam = true;
    }
    const params = new URLSearchParams(window.location.search);
    if (
      params.get("mode") === "app" ||
      params.get("app") === "true" ||
      params.get("app") === "1" ||
      params.get("source") === "apk" ||
      params.get("source") === "app" ||
      params.get("standalone") === "true" ||
      window.location.hash.includes("app-mode") ||
      window.location.hash.includes("standalone")
    ) {
      localStorage.setItem("minasaty_in_app", "true");
      isAppStorageOrParam = true;
    }
  } catch (_) {}

  // فحص نمط الشاشة المستقلة PWA Standalone
  const isStandaloneMode =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
    window.navigator.standalone === true;

  // إذا كان الزائر داخل تطبيقك الخاص بالمنصة، يتم إيقاف السكربت فوراً وبشكل كلي
  if (isOfficialAppSignature || isAppStorageOrParam || isStandaloneMode) {
    try { localStorage.setItem("minasaty_in_app", "true"); } catch (_) {}
    return;
  }

  // 2. كشف التطبيقات المدمجة المستهدفة
  const isFacebook = /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i.test(ua);
  const isMessenger = /Messenger/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const referrer = document.referrer || "";
  const isTelegram =
    /Telegram|TDesktop|TelegramBot|org\.telegram\.messenger/i.test(ua) ||
    /(?:telegram|t\.me)/i.test(referrer) ||
    Boolean(window.TelegramWebviewProxy || window.TelegramGameProxy || window.Telegram?.WebApp);

  const isInApp = isFacebook || isMessenger || isInstagram || isTelegram;
  if (!isInApp) {
    return;
  }

  // 3. تحديد نوع نظام التشغيل
  const isAndroid = /Android/i.test(ua);
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // 4. تحديد اسم التطبيق الحالي لعرضه بوضوح للمستخدم
  let appName = "هذا التطبيق";
  if (isFacebook) appName = "فيسبوك (Facebook)";
  else if (isMessenger) appName = "ماسنجر (Messenger)";
  else if (isInstagram) appName = "إنستغرام (Instagram)";
  else if (isTelegram) appName = "تيليجرام (Telegram)";

  // 5. فحص حالة الإغلاق المؤقت (خلال الجلسة الحالية لتفادي الإزعاج إذا اختار المتابعة)
  const STORAGE_KEY = "minasaty_inapp_gate_dismissed";
  try {
    const dismissedUntil = Number(sessionStorage.getItem(STORAGE_KEY) || 0);
    if (dismissedUntil && Date.now() < dismissedUntil) {
      return;
    }
  } catch (_) {}

  function dismissModal() {
    try {
      // كتم التنبيه لمدة ساعة في نفس الجلسة
      sessionStorage.setItem(STORAGE_KEY, String(Date.now() + 60 * 60 * 1000));
    } catch (_) {}
    const overlay = document.getElementById("minasaty-inapp-gate-overlay");
    if (overlay) {
      overlay.style.opacity = "0";
      overlay.style.transform = "scale(0.96)";
      setTimeout(() => overlay.remove(), 250);
    }
  }

  // 6. حقن أنماط التصميم (CSS) الخاصة بالنافذة لتكون مستقلة ومطابقة لهوية المنصة
  function injectStyles() {
    if (document.getElementById("minasaty-inapp-gate-styles")) return;
    const style = document.createElement("style");
    style.id = "minasaty-inapp-gate-styles";
    style.textContent = `
      #minasaty-inapp-gate-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(3, 10, 24, 0.88);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        box-sizing: border-box;
        direction: rtl;
        text-align: right;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Tahoma, sans-serif;
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      .minasaty-inapp-card {
        background: linear-gradient(155deg, #0f2546 0%, #08152a 100%);
        border: 1px solid rgba(147, 197, 253, 0.35);
        border-radius: 22px;
        width: 100%;
        max-width: 440px;
        padding: 26px 22px;
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7), 0 0 35px rgba(59, 130, 246, 0.25);
        color: #ffffff;
        box-sizing: border-box;
        position: relative;
        animation: minasatyInAppPop 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes minasatyInAppPop {
        0% { opacity: 0; transform: scale(0.92) translateY(12px); }
        100% { opacity: 1; transform: scale(1) translateY(0); }
      }
      .minasaty-inapp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
      }
      .minasaty-inapp-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(239, 68, 68, 0.18);
        border: 1px solid rgba(248, 113, 113, 0.4);
        color: #fca5a5;
        font-size: 0.82rem;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 20px;
      }
      .minasaty-inapp-close {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #94a3b8;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        font-size: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .minasaty-inapp-close:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #ffffff;
      }
      .minasaty-inapp-icon-wrap {
        display: flex;
        justify-content: center;
        margin: 6px 0 16px 0;
      }
      .minasaty-inapp-chrome-logo {
        width: 68px;
        height: 68px;
        filter: drop-shadow(0 6px 14px rgba(66, 133, 244, 0.35));
      }
      .minasaty-inapp-title {
        font-size: 1.25rem;
        font-weight: 800;
        color: #ffffff;
        text-align: center;
        margin: 0 0 10px 0;
        line-height: 1.4;
      }
      .minasaty-inapp-desc {
        font-size: 0.96rem;
        color: #cbd5e1;
        text-align: center;
        line-height: 1.65;
        margin: 0 0 20px 0;
      }
      .minasaty-inapp-desc strong {
        color: #67e8f9;
      }
      .minasaty-inapp-ios-box {
        background: rgba(15, 33, 64, 0.85);
        border: 1px solid rgba(96, 165, 250, 0.3);
        border-radius: 14px;
        padding: 14px 14px;
        margin-bottom: 18px;
      }
      .minasaty-inapp-ios-head {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #38bdf8;
        font-size: 0.9rem;
        font-weight: 700;
        margin-bottom: 8px;
      }
      .minasaty-inapp-ios-steps {
        margin: 0;
        padding-right: 20px;
        color: #e2e8f0;
        font-size: 0.88rem;
        line-height: 1.7;
      }
      .minasaty-inapp-ios-steps li {
        margin-bottom: 4px;
      }
      .minasaty-inapp-ios-steps strong {
        color: #fef08a;
      }
      .minasaty-inapp-btn-chrome {
        width: 100%;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        border: 1px solid #34d399;
        color: #ffffff;
        font-weight: 800;
        font-size: 1.05rem;
        padding: 14px 18px;
        border-radius: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-shadow: 0 10px 22px rgba(16, 185, 129, 0.35);
        transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
        text-decoration: none;
        box-sizing: border-box;
      }
      .minasaty-inapp-btn-chrome:active {
        transform: scale(0.98);
      }
      .minasaty-inapp-btn-chrome:hover {
        filter: brightness(1.08);
        box-shadow: 0 12px 26px rgba(16, 185, 129, 0.45);
      }
      .minasaty-inapp-btn-copy {
        width: 100%;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #93c5fd;
        font-weight: 700;
        font-size: 0.92rem;
        padding: 11px 16px;
        border-radius: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-top: 10px;
        transition: all 0.2s;
      }
      .minasaty-inapp-btn-copy:hover {
        background: rgba(255, 255, 255, 0.14);
        color: #ffffff;
      }
      .minasaty-inapp-btn-dismiss {
        width: 100%;
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 0.88rem;
        padding: 10px;
        margin-top: 6px;
        cursor: pointer;
        transition: color 0.2s;
        text-decoration: underline;
        text-underline-offset: 4px;
      }
      .minasaty-inapp-btn-dismiss:hover {
        color: #cbd5e1;
      }
    `;
    document.head.appendChild(style);
  }

  // 7. بناء وعرض النافذة المنبثقة
  function showModal() {
    if (document.getElementById("minasaty-inapp-gate-overlay")) return;
    injectStyles();

    const overlay = document.createElement("div");
    overlay.id = "minasaty-inapp-gate-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    // شعار Google Chrome بألوانه الرسمية بصيغة SVG عالية الدقة
    const chromeSvg = `
      <svg class="minasaty-inapp-chrome-logo" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="23" fill="#ffffff" />
        <path d="M44.5 20H24V28H35.8C34.6 31.5 31.6 34.3 27.9 35.4L33.7 41.2C39.6 37.8 44.5 30.6 44.5 20Z" fill="#34A853"/>
        <path d="M12.1 33.7C10.7 31 10 27.9 10 24.5C10 21.1 10.7 18 12.1 15.3L5.8 9.5C3.3 14 2 19.1 2 24.5C2 29.9 3.3 35 5.8 39.5L12.1 33.7Z" fill="#FBBC05"/>
        <path d="M24 10C28.2 10 31.5 11.5 34 13.9L40 7.9C35.7 3.9 30.3 1.5 24 1.5C16.3 1.5 9.7 5.7 5.8 11.8L12.1 17.6C13.8 13.2 18.5 10 24 10Z" fill="#EA4335"/>
        <circle cx="24" cy="24" r="9" fill="#4285F4"/>
        <circle cx="24" cy="24" r="6" fill="#ffffff"/>
      </svg>
    `;

    // إرشادات آيفون
    const iosGuidanceHtml = `
      <div class="minasaty-inapp-ios-box">
        <div class="minasaty-inapp-ios-head">
          <span>🍏 لمستخدمي هواتف iPhone (iOS):</span>
        </div>
        <ol class="minasaty-inapp-ios-steps">
          <li>اضغط على النقاط الثلاث <strong>( ••• )</strong> أو زر المشاركة <strong>[ ⎋ ]</strong> في أعلى/أسفل الشاشة.</li>
          <li>اختر <strong>«فتح في المتصفح الخارجي»</strong> (أو Safari / Chrome).</li>
        </ol>
      </div>
    `;

    overlay.innerHTML = `
      <div class="minasaty-inapp-card">
        <div class="minasaty-inapp-header">
          <span class="minasaty-inapp-badge">⚠️ متصفح مدمج: ${appName}</span>
          <button class="minasaty-inapp-close" id="minasaty-inapp-close-btn" aria-label="إغلاق" title="إغلاق">✕</button>
        </div>

        <div class="minasaty-inapp-icon-wrap">
          ${chromeSvg}
        </div>

        <h2 class="minasaty-inapp-title">يُرجى الفتح في متصفح Google Chrome</h2>

        <p class="minasaty-inapp-desc">
          لتصفح المنصة بشكل أفضل وبدون مشاكل، ولضمان جودة الصوت والصورة في البث المباشر، يُرجى فتح الرابط في متصفح <strong>Google Chrome</strong>.
        </p>

        ${isIOS ? iosGuidanceHtml : ""}

        <div class="minasaty-inapp-actions">
          <button id="minasaty-inapp-btn-open-chrome" class="minasaty-inapp-btn-chrome" type="button">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
            </svg>
            <span>فتح في Google Chrome</span>
          </button>

          <button id="minasaty-inapp-btn-copy-link" class="minasaty-inapp-btn-copy" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span id="minasaty-inapp-copy-text">نسخ رابط الصفحة</span>
          </button>

          <button id="minasaty-inapp-btn-dismiss" class="minasaty-inapp-btn-dismiss" type="button">
            المتابعة داخل التطبيق على أي حال
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 8. زر الفتح في Google Chrome
    const openBtn = document.getElementById("minasaty-inapp-btn-open-chrome");
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        const currentUrl = window.location.href;
        const urlWithoutScheme = currentUrl.replace(/^https?:\/\//i, "");

        if (isAndroid) {
          // استخدام رابط التوجيه المباشر Intent لأجهزة أندرويد لفتح كروم تلقائياً
          const intentUrl = `intent://${urlWithoutScheme}#Intent;scheme=https;package=com.android.chrome;end;`;
          window.location.href = intentUrl;

          // إجراء احتياطي إضافي
          setTimeout(() => {
            window.open(currentUrl, "_blank");
          }, 1500);
        } else if (isIOS) {
          // لنظام iOS: محاولة مخطط googlechrome:// ثم فتح نافذة خارجية
          const chromeIosUrl = `googlechrome://${urlWithoutScheme}`;
          window.location.href = chromeIosUrl;
          setTimeout(() => {
            window.open(currentUrl, "_blank");
          }, 800);
        } else {
          window.open(currentUrl, "_blank");
        }
      });
    }

    // 9. زر نسخ الرابط
    const copyBtn = document.getElementById("minasaty-inapp-btn-copy-link");
    const copyText = document.getElementById("minasaty-inapp-copy-text");
    if (copyBtn && copyText) {
      copyBtn.addEventListener("click", async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(window.location.href);
          } else {
            const input = document.createElement("input");
            input.value = window.location.href;
            document.body.appendChild(input);
            input.select();
            document.execCommand("copy");
            input.remove();
          }
          copyText.textContent = "✓ تم نسخ الرابط بنجاح! الصقه في كروم";
          copyBtn.style.borderColor = "#34d399";
          copyBtn.style.color = "#34d399";
          setTimeout(() => {
            copyText.textContent = "نسخ رابط الصفحة";
            copyBtn.style.borderColor = "";
            copyBtn.style.color = "";
          }, 3000);
        } catch (_) {
          copyText.textContent = "تعذر النسخ التلقائي";
        }
      });
    }

    // 10. تفعيل أزرار الإغلاق والتخطي
    document
      .getElementById("minasaty-inapp-close-btn")
      ?.addEventListener("click", dismissModal);

    document
      .getElementById("minasaty-inapp-btn-dismiss")
      ?.addEventListener("click", dismissModal);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        dismissModal();
      }
    });
  }

  // 11. تشغيل الفحص والظهور عند اكتمال تحميل عناصر الصفحة
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showModal);
  } else {
    showModal();
  }
})();
