/**
 * Minasaty - In-App Browser Detector & Chrome Redirect Gate
 * 
 * يكشف ما إذا كان الزائر يتصفح الموقع من داخل المتصفحات المدمجة لتطبيقات:
 * فيسبوك، ماسنجر، إنستغرام، أو تيليجرام.
 * ويوجه الزائر لفتح الموقع في متصفح Google Chrome لضمان أفضل أداء واستقرار للبث المباشر.
 */
"use strict";

(function () {
  const ua = navigator.userAgent || navigator.vendor || window.opera || "";
  const referrer = document.referrer || "";

  // استبعاد شبكات التواصل الاجتماعي للتأكد من عمل تنبيه كروم لها دائماً
  const isFacebook = /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i.test(ua);
  const isMessenger = /Messenger/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const isTelegram =
    /Telegram|TDesktop|TelegramBot|org\.telegram\.messenger/i.test(ua) ||
    /(?:telegram|t\.me)/i.test(referrer) ||
    Boolean(window.TelegramWebviewProxy || window.TelegramGameProxy || window.Telegram?.WebApp);

  const isSocialInApp = isFacebook || isMessenger || isInstagram || isTelegram;

  // 1. فحص وتمييز التطبيق الجديد عن التطبيق القديم عن المتصفحات العادية (Google Chrome, Safari, etc.)
  if (!isSocialInApp) {
    const isAndroid = /Android/i.test(ua);

    // أ) التحقق مما إذا كان الزائر يستخدم التطبيق الأصلي الحديث (النسخة الجديدة المحدثة)
    function initInAppInstantPlatformUpdate() {
      const CURRENT_VER_KEY = "minasaty_installed_web_version";
      const DISMISS_VER_KEY = "minasaty_web_update_dismissed_v";

      async function checkUpdate() {
        try {
          const res = await fetch("/api/platform-version?_t=" + Date.now(), {
            cache: "no-store",
            headers: { "Pragma": "no-cache" }
          });
          if (!res.ok) return;
          const data = await res.json();
          if (!data || !data.version) return;

          const serverVersion = data.version;
          const installedVersion = localStorage.getItem(CURRENT_VER_KEY);

          // إذا كانت هذه المرة الأولى التي يفتح فيها التطبيق: نخزن الإصدار الحالي ولا نزعج المستخدم
          if (!installedVersion) {
            localStorage.setItem(CURRENT_VER_KEY, serverVersion);
            return;
          }

          // إذا كان الإصدار الحالي مساوياً لإصدار السيرفر: لا يوجد تحديث جديد
          if (installedVersion === serverVersion) {
            return;
          }

          // إذا تم تأجيل التنبيه لهذا الإصدار خلال الجلسة الحالية
          const dismissedVer = sessionStorage.getItem(DISMISS_VER_KEY);
          if (dismissedVer === serverVersion) {
            return;
          }

          showInstantUpdateNotification(data);
        } catch (_) {}
      }

      function showInstantUpdateNotification(updateData) {
        if (document.getElementById("minasaty-instant-web-update-banner")) return;

        const banner = document.createElement("div");
        banner.id = "minasaty-instant-web-update-banner";
        banner.dir = "rtl";
        banner.setAttribute("role", "alert");
        banner.innerHTML = `
          <div class="miu-inner">
            <div class="miu-header">
              <div class="miu-badge">
                <span class="miu-dot"></span>
                <span>تحديث فوري للمنصة</span>
              </div>
              <button id="miu-close-btn" class="miu-close" type="button" aria-label="إغلاق التنبيه">×</button>
            </div>
            <div class="miu-content">
              <h4 class="miu-title">✨ ${updateData.title || "المنصة تحتاج إلى تحديث"}</h4>
              <p class="miu-desc">${updateData.message || "تتوفر الآن ميزات وتحسينات جديدة جاهزة للتطبيق فوراً وبدون الحاجة لإعادة تنزيل التطبيق."}</p>
              <div id="miu-countdown-text" style="font-size: 11px; color: #34d399; margin-bottom: 8px; font-weight: 700;">⏳ سيتم التحديث تلقائياً خلال 4 ثوانٍ...</div>
            </div>
            <div class="miu-actions">
              <button id="miu-apply-btn" class="miu-btn-apply" type="button">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6M2.5 22v-6h6"/><path d="M20 8a8 8 0 0 0-14.7-2M4 16a8 8 0 0 0 14.7 2"/></svg>
                <span>${updateData.actionText || "تحديث فوري الآن"}</span>
              </button>
              <button id="miu-later-btn" class="miu-btn-later" type="button">لاحقاً</button>
            </div>
          </div>
        `;

        const style = document.createElement("style");
        style.id = "minasaty-instant-update-styles";
        style.textContent = `
          #minasaty-instant-web-update-banner {
            position: fixed !important;
            top: max(env(safe-area-inset-top, 0px), 16px) !important;
            left: 14px !important;
            right: 14px !important;
            margin: 0 auto !important;
            max-width: 440px !important;
            z-index: 2147483645 !important;
            pointer-events: auto !important;
            animation: miuSlideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1) !important;
            font-family: 'Cairo', system-ui, -apple-system, sans-serif !important;
          }
          @keyframes miuSlideDown {
            from { transform: translateY(-120%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          .miu-inner {
            background: rgba(10, 20, 36, 0.96) !important;
            backdrop-filter: blur(16px) !important;
            -webkit-backdrop-filter: blur(16px) !important;
            border: 1.8px solid #10b981 !important;
            box-shadow: 0 12px 36px -4px rgba(16, 185, 129, 0.35), 0 4px 16px rgba(0, 0, 0, 0.6) !important;
            border-radius: 16px !important;
            padding: 14px 16px !important;
            color: #f8fafc !important;
          }
          .miu-header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            margin-bottom: 8px !important;
          }
          .miu-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            padding: 3px 10px !important;
            background: rgba(16, 185, 129, 0.16) !important;
            border: 1px solid rgba(16, 185, 129, 0.45) !important;
            border-radius: 9999px !important;
            color: #34d399 !important;
            font-size: 11px !important;
            font-weight: 700 !important;
          }
          .miu-dot {
            width: 7px !important;
            height: 7px !important;
            border-radius: 50% !important;
            background: #10b981 !important;
            box-shadow: 0 0 8px #10b981 !important;
          }
          .miu-close {
            background: transparent !important;
            border: none !important;
            color: #94a3b8 !important;
            font-size: 20px !important;
            line-height: 1 !important;
            cursor: pointer !important;
            padding: 2px 6px !important;
            border-radius: 6px !important;
          }
          .miu-close:hover { color: #f8fafc !important; background: rgba(255, 255, 255, 0.08) !important; }
          .miu-title {
            margin: 0 0 5px 0 !important;
            font-size: 15px !important;
            font-weight: 800 !important;
            color: #ffffff !important;
            line-height: 1.3 !important;
          }
          .miu-desc {
            margin: 0 0 12px 0 !important;
            font-size: 12px !important;
            color: #cbd5e1 !important;
            line-height: 1.5 !important;
          }
          .miu-actions {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
          }
          .miu-btn-apply {
            flex: 1 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 7px !important;
            padding: 9px 16px !important;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
            color: #ffffff !important;
            border: none !important;
            border-radius: 10px !important;
            font-size: 13px !important;
            font-weight: 800 !important;
            cursor: pointer !important;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4) !important;
            transition: transform 0.15s ease, filter 0.15s ease !important;
          }
          .miu-btn-apply:active { transform: scale(0.97) !important; }
          .miu-btn-later {
            padding: 9px 14px !important;
            background: rgba(30, 41, 59, 0.75) !important;
            color: #94a3b8 !important;
            border: 1px solid rgba(148, 163, 184, 0.22) !important;
            border-radius: 10px !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            cursor: pointer !important;
            transition: color 0.15s ease, background 0.15s ease !important;
          }
          .miu-btn-later:hover { color: #f1f5f9 !important; background: rgba(51, 65, 85, 0.8) !important; }
        `;

        (document.head || document.documentElement).appendChild(style);
        document.body ? document.body.appendChild(banner) : document.documentElement.appendChild(banner);

        let autoUpdateCountdownTimer = null;
        let countdownSeconds = 4;

        function dismissBanner() {
          if (autoUpdateCountdownTimer) {
            clearInterval(autoUpdateCountdownTimer);
            autoUpdateCountdownTimer = null;
          }
          sessionStorage.setItem(DISMISS_VER_KEY, updateData.version);
          banner.style.animation = "none";
          banner.style.transition = "transform 0.25s ease, opacity 0.25s ease";
          banner.style.transform = "translateY(-120%)";
          banner.style.opacity = "0";
          setTimeout(() => {
            banner.remove();
            style.remove();
          }, 260);
        }

        async function applyInstantUpdate() {
          if (autoUpdateCountdownTimer) {
            clearInterval(autoUpdateCountdownTimer);
            autoUpdateCountdownTimer = null;
          }

          const btn = document.getElementById("miu-btn-apply");
          if (btn) {
            btn.disabled = true;
            btn.style.opacity = "0.75";
            btn.innerHTML = `<span>⏳ جارٍ التحديث التلقائي...</span>`;
          }

          localStorage.setItem(CURRENT_VER_KEY, updateData.version);

          const performReload = () => {
            const targetUrl = new URL(window.location.href);
            targetUrl.searchParams.set("app", "true");
            targetUrl.searchParams.set("ts", Date.now().toString());
            window.location.replace(targetUrl.toString());
          };

          // صمام أمان لضمان إعادة التحميل الفوري حتى لو تعطلت دوال حذف الكاش
          const fallbackTimer = setTimeout(performReload, 600);

          try {
            if ("caches" in window) {
              const cacheNames = await Promise.race([
                caches.keys(),
                new Promise((res) => setTimeout(() => res([]), 350))
              ]);
              await Promise.all(cacheNames.map((name) => caches.delete(name)));
            }
          } catch (_) {}

          try {
            if (navigator.serviceWorker) {
              const registrations = await Promise.race([
                navigator.serviceWorker.getRegistrations(),
                new Promise((res) => setTimeout(() => res([]), 350))
              ]);
              await Promise.all(registrations.map((r) => r.unregister()));
            }
          } catch (_) {}

          clearTimeout(fallbackTimer);
          performReload();
        }

        document.getElementById("miu-close-btn")?.addEventListener("click", dismissBanner);
        document.getElementById("miu-later-btn")?.addEventListener("click", dismissBanner);
        document.getElementById("miu-btn-apply")?.addEventListener("click", applyInstantUpdate);

        // التحديث التلقائي التنازلي إذا لم يكن المستخدم داخل بث مباشر
        const isInsideLiveSession = window.location.pathname.includes("student-live.html") || window.location.pathname.includes("teacher-live");
        if (!isInsideLiveSession) {
          autoUpdateCountdownTimer = setInterval(() => {
            countdownSeconds -= 1;
            const countdownEl = document.getElementById("miu-countdown-text");
            if (countdownEl) {
              if (countdownSeconds > 0) {
                countdownEl.textContent = `⏳ سيتم التحديث تلقائياً خلال ${countdownSeconds} ثوانٍ...`;
              } else {
                countdownEl.textContent = "⏳ جارٍ التحديث التلقائي الآن...";
              }
            }
            if (countdownSeconds <= 0) {
              clearInterval(autoUpdateCountdownTimer);
              autoUpdateCountdownTimer = null;
              void applyInstantUpdate();
            }
          }, 1000);
        } else {
          const countdownEl = document.getElementById("miu-countdown-text");
          if (countdownEl) countdownEl.style.display = "none";
        }
      }

      // تشغيل الفحص بعد اكتمال جاهزية الصفحة
      setTimeout(checkUpdate, 1500);

      // وفحص عند العودة إلى واجهة التطبيق
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          checkUpdate();
        }
      });
    }

    const isNewNativeApp = Boolean(
      (window.MinasatyNative && typeof window.MinasatyNative.startLiveService === "function") ||
      (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform()) ||
      window.location.search.includes("app=true") ||
      (typeof localStorage !== "undefined" && localStorage.getItem("minasaty_in_app") === "true")
    );

    // إذا كان التطبيق الجديد: يعمل طبيعياً ويفحص التحديثات البرمجية الفورية
    if (isNewNativeApp) {
      document.documentElement.classList.add("inside-native-app");
      document.body?.classList?.add("inside-native-app");
      try { localStorage.setItem("minasaty_in_app", "true"); } catch (_) {}
      const hideStyle = document.createElement("style");
      hideStyle.id = "minasaty-hide-app-download-elements";
      hideStyle.textContent = `
        #pwa-dash-float-btn, .pwa-dash-floating-btn, .pwa-dash-overlay, #minasaty-floating-app-btn, #minasaty-app-modal {
          display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(hideStyle);

      initInAppInstantPlatformUpdate();
      return; // خروج: التطبيق الأصلي لا يعرض نوافذ التطبيق القديم أو روابط التثبيت الخارجية
    }

    // ب) التحقق بدقة مما إذا كان الزائر يفتح المنصة من داخل (التطبيق القديم) حصراً
    // التطبيق القديم يضيف 'MinasatyApp/1.0' في UserAgent أو يحقن كلاس 'inside-native-app' أو نمط 'native-hide-app-download-style'
    const isOldAppSignature = Boolean(
      /MinasatyApp|com\.comminasatyacadimia/i.test(ua) ||
      typeof window.MinasatyApp !== "undefined" ||
      (typeof window.Android !== "undefined" && !isNewNativeApp) ||
      (typeof window.AndroidInterface !== "undefined" && !isNewNativeApp) ||
      document.body?.classList?.contains("inside-native-app") ||
      Boolean(document.getElementById("native-hide-app-download-style")) ||
      (isAndroid && (/;\s*wv\b|Version\/[0-9.]+\s+Chrome/i.test(ua) || window.location.search.includes("app=true")))
    );

    // إذا تم الكشف عن التطبيق القديم:
    if (isOldAppSignature) {
      // إزالة أي ستايل كان يحقنه التطبيق القديم لإخفاء نوافذ التحديث
      const oldInjectedStyle = document.getElementById("native-hide-app-download-style");
      if (oldInjectedStyle) {
        try { oldInjectedStyle.remove(); } catch (_) {}
      }

      // فحص كتم التنبيه المؤقت للجلسة الحالية
      const OLD_APP_STORAGE_KEY = "minasaty_old_app_prompt_dismissed";
      try {
        const dismissedTime = Number(sessionStorage.getItem(OLD_APP_STORAGE_KEY) || 0);
        if (dismissedTime && Date.now() < dismissedTime) {
          return;
        }
      } catch (_) {}

      // عرض نافذة التحديث الإجباري للتطبيق القديم
      function showOldAppUpdateModal() {
        if (document.getElementById("minasaty-old-app-update-overlay")) return;

        // حقن أنماط نافذة التحديث
        const updateStyle = document.createElement("style");
        updateStyle.id = "minasaty-old-app-update-styles";
        updateStyle.textContent = `
          #minasaty-old-app-update-overlay {
            position: fixed !important;
            inset: 0 !important;
            z-index: 2147483647 !important;
            background: rgba(4, 12, 28, 0.92) !important;
            backdrop-filter: blur(12px) !important;
            -webkit-backdrop-filter: blur(12px) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 18px !important;
            box-sizing: border-box !important;
            direction: rtl !important;
            text-align: right !important;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Tahoma, sans-serif !important;
            animation: minasatyFadeIn 0.25s ease forwards !important;
          }
          @keyframes minasatyFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes minasatyPopIn {
            0% { opacity: 0; transform: scale(0.92) translateY(14px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
          }
          .minasaty-old-app-card {
            background: linear-gradient(155deg, #0d213f 0%, #061122 100%) !important;
            border: 1.5px solid rgba(245, 158, 11, 0.5) !important;
            border-radius: 22px !important;
            width: 100% !important;
            max-width: 430px !important;
            padding: 24px 20px !important;
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(245, 158, 11, 0.22) !important;
            color: #ffffff !important;
            box-sizing: border-box !important;
            position: relative !important;
            animation: minasatyPopIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
          }
          .minasaty-old-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            background: rgba(245, 158, 11, 0.16) !important;
            border: 1px solid rgba(251, 191, 36, 0.45) !important;
            color: #fbbf24 !important;
            font-size: 0.82rem !important;
            font-weight: 700 !important;
            padding: 5px 12px !important;
            border-radius: 20px !important;
            margin-bottom: 14px !important;
          }
          .minasaty-old-icon-box {
            display: flex !important;
            justify-content: center !important;
            margin: 4px 0 16px 0 !important;
          }
          .minasaty-old-pulse-icon {
            width: 72px !important;
            height: 72px !important;
            border-radius: 20px !important;
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-shadow: 0 10px 25px rgba(245, 158, 11, 0.38) !important;
            color: #ffffff !important;
          }
          .minasaty-old-title {
            font-size: 1.25rem !important;
            font-weight: 800 !important;
            color: #ffffff !important;
            text-align: center !important;
            margin: 0 0 8px 0 !important;
            line-height: 1.4 !important;
          }
          .minasaty-old-subtitle {
            font-size: 0.94rem !important;
            font-weight: 700 !important;
            color: #fca5a5 !important;
            text-align: center !important;
            margin: 0 0 14px 0 !important;
          }
          .minasaty-old-desc {
            font-size: 0.92rem !important;
            color: #cbd5e1 !important;
            line-height: 1.65 !important;
            margin: 0 0 16px 0 !important;
            text-align: center !important;
          }
          .minasaty-old-perks {
            background: rgba(15, 33, 64, 0.75) !important;
            border: 1px solid rgba(147, 197, 253, 0.25) !important;
            border-radius: 14px !important;
            padding: 12px 14px !important;
            margin-bottom: 18px !important;
          }
          .minasaty-old-perk-item {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            color: #e2e8f0 !important;
            font-size: 0.88rem !important;
            margin-bottom: 7px !important;
            line-height: 1.4 !important;
          }
          .minasaty-old-perk-item:last-child {
            margin-bottom: 0 !important;
          }
          .minasaty-old-perk-check {
            color: #34d399 !important;
            font-weight: 800 !important;
            font-size: 1rem !important;
            flex-shrink: 0 !important;
          }
          .minasaty-old-btn-update {
            width: 100% !important;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
            border: 1px solid #34d399 !important;
            color: #ffffff !important;
            font-weight: 800 !important;
            font-size: 1.05rem !important;
            padding: 14px 18px !important;
            border-radius: 14px !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 10px !important;
            box-shadow: 0 10px 24px rgba(16, 185, 129, 0.35) !important;
            text-decoration: none !important;
            box-sizing: border-box !important;
            transition: transform 0.15s, filter 0.15s !important;
          }
          .minasaty-old-btn-update:active {
            transform: scale(0.98) !important;
          }
          .minasaty-old-btn-update:hover {
            filter: brightness(1.08) !important;
          }
          .minasaty-old-btn-chrome {
            width: 100% !important;
            background: rgba(255, 255, 255, 0.08) !important;
            border: 1px solid rgba(255, 255, 255, 0.18) !important;
            color: #93c5fd !important;
            font-weight: 700 !important;
            font-size: 0.88rem !important;
            padding: 11px 16px !important;
            border-radius: 12px !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 8px !important;
            margin-top: 10px !important;
            transition: all 0.2s !important;
          }
          .minasaty-old-btn-chrome:hover {
            background: rgba(255, 255, 255, 0.15) !important;
            color: #ffffff !important;
          }
          .minasaty-old-dismiss {
            width: 100% !important;
            background: transparent !important;
            border: none !important;
            color: #94a3b8 !important;
            font-size: 0.85rem !important;
            padding: 10px !important;
            margin-top: 6px !important;
            cursor: pointer !important;
            text-decoration: underline !important;
            text-underline-offset: 4px !important;
            text-align: center !important;
          }
          .minasaty-old-status-box {
            display: none;
            background: rgba(16, 185, 129, 0.15) !important;
            border: 1px solid rgba(52, 211, 153, 0.4) !important;
            color: #6ee7b7 !important;
            border-radius: 12px !important;
            padding: 12px 14px !important;
            font-size: 0.88rem !important;
            line-height: 1.6 !important;
            margin-top: 14px !important;
            text-align: center !important;
            animation: minasatyFadeIn 0.3s ease forwards !important;
          }
        `;
        (document.head || document.documentElement).appendChild(updateStyle);

        const overlay = document.createElement("div");
        overlay.id = "minasaty-old-app-update-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");

        overlay.innerHTML = `
          <div class="minasaty-old-app-card">
            <div style="text-align: center;">
              <span class="minasaty-old-badge">⚠️ تطبيق المنصة بحاجة إلى تحديث</span>
            </div>

            <div class="minasaty-old-icon-box">
              <div class="minasaty-old-pulse-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </div>
            </div>

            <h2 class="minasaty-old-title">حدّث التطبيق لمتابعة الحصص</h2>
            <p class="minasaty-old-subtitle">الإصدار القديم لم يعد يعمل بشكل ممتاز</p>

            <p class="minasaty-old-desc">
              أنت تستخدم حالياً <strong>النسخة القديمة</strong> من التطبيق ولن تتمكن من متابعة البث المباشر في الخلفية بصورة سليمة. يرجى تنزيل <strong>النسخة الجديدة المحدثة</strong> للاستمرار في الدراسة بسلاسة.
            </p>

            <div class="minasaty-old-perks">
              <div class="minasaty-old-perk-item">
                <span class="minasaty-old-perk-check">✓</span>
                <span>استمرار الصوت والبث المباشر حتى عند قفل الشاشة</span>
              </div>
              <div class="minasaty-old-perk-item">
                <span class="minasaty-old-perk-check">✓</span>
                <span>ميزة الصورة داخل صورة (النافذة العائمة PiP)</span>
              </div>
              <div class="minasaty-old-perk-item">
                <span class="minasaty-old-perk-check">✓</span>
                <span>استقرار وسرعة اتصال ممتازة وحل مشاكل التقطيع</span>
              </div>
            </div>

            <div class="minasaty-old-actions">
              <button id="minasaty-old-btn-download" class="minasaty-old-btn-update" type="button">
                <span>📥 تحديث التطبيق الآن (تنزيل النسخة الجديدة)</span>
              </button>

              <button id="minasaty-old-btn-chrome" class="minasaty-old-btn-chrome" type="button">
                <span>🌐 إذا لم يبدأ التحميل: اضغط هنا للتحميل عبر Google Chrome</span>
              </button>

              <button id="minasaty-old-btn-dismiss" class="minasaty-old-dismiss" type="button">
                المتابعة داخل النسخة القديمة مؤقتاً
              </button>
            </div>

            <div id="minasaty-old-status-box" class="minasaty-old-status-box">
              ⏳ <strong>جاري بدء التحميل...</strong><br />
              تفقّد شريط الإشعارات أعلى الشاشة، وبمجرد اكتمال تنزيل الملف، افتحه واضغط على <strong>[تثبيت / Installer]</strong>.
            </div>
          </div>
        `;

        document.body.appendChild(overlay);

        // وظيفة بدء التحميل
        const startDownload = () => {
          const statusBox = document.getElementById("minasaty-old-status-box");
          if (statusBox) statusBox.style.display = "block";

          const updateBtn = document.getElementById("minasaty-old-btn-download");
          if (updateBtn) {
            updateBtn.innerHTML = "<span>⏳ بدأ التحميل... تفقّد شريط الإشعارات</span>";
            updateBtn.style.opacity = "0.85";
          }

          const fullApkUrl = window.location.origin + "/acadimia.apk";

          // 1. إذا كان التطبيق يوفر واجهة تنزيل وتثبيت أصلية (Android Native Bridge)
          if (window.MinasatyNative?.downloadAndInstallApk) {
            try {
              window.MinasatyNative.downloadAndInstallApk("/acadimia.apk");
              return;
            } catch (_) {}
          }

          // 2. إطلاق مدير التنزيلات عبر Intent أندرويد لفتح متصفح النظام فوراً
          try {
            const hostAndPath = (window.location.host + "/acadimia.apk").replace(/^https?:\/\//i, "");
            const genericIntent = "intent://" + hostAndPath + "#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end;";
            window.location.href = genericIntent;
          } catch (_) {}

          // 3. محاولة فتح الرابط عبر المتصفح الخارجي _system أو Chrome
          setTimeout(() => {
            try {
              window.open(fullApkUrl, "_system");
            } catch (_) {}
          }, 300);

          setTimeout(() => {
            const hostAndPath = (window.location.host + "/acadimia.apk").replace(/^https?:\/\//i, "");
            const chromeIntent = "intent://" + hostAndPath + "#Intent;scheme=https;package=com.android.chrome;end;";
            window.location.href = chromeIntent;
          }, 700);

          // 4. رابط مباشر كخيار احتياطي
          setTimeout(() => {
            const link = document.createElement("a");
            link.href = fullApkUrl + "?t=" + Date.now();
            link.setAttribute("download", "acadimia.apk");
            link.setAttribute("target", "_blank");
            link.rel = "noopener noreferrer";
            document.body.appendChild(link);
            link.click();
            setTimeout(() => link.remove(), 1000);
          }, 1200);
        };

        // زر التحميل المباشر
        document.getElementById("minasaty-old-btn-download")?.addEventListener("click", startDownload);

        // زر التحميل عبر Google Chrome الخارجي في حال كان الـ WebView يمنع التنزيلات المباشرة
        document.getElementById("minasaty-old-btn-chrome")?.addEventListener("click", () => {
          const fullApkUrl = window.location.origin + "/acadimia.apk";
          const hostAndPath = (window.location.host + "/acadimia.apk").replace(/^https?:\/\//i, "");
          const intentUrl = "intent://" + hostAndPath + "#Intent;scheme=https;package=com.android.chrome;end;";
          window.location.href = intentUrl;
          setTimeout(() => {
            window.open(fullApkUrl, "_blank");
          }, 1200);
        });

        // زر التخطي المؤقت
        document.getElementById("minasaty-old-btn-dismiss")?.addEventListener("click", () => {
          try {
            sessionStorage.setItem(OLD_APP_STORAGE_KEY, String(Date.now() + 30 * 60 * 1000));
          } catch (_) {}
          overlay.style.transition = "opacity 0.25s ease, transform 0.25s ease";
          overlay.style.opacity = "0";
          setTimeout(() => overlay.remove(), 250);
        });
      }

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", showOldAppUpdateModal);
      } else {
        showOldAppUpdateModal();
      }

      // فحص إضافي بعد ثوانٍ تحسباً لحقن الأنماط المتأخر في WebView القديم
      setTimeout(() => {
        const oldStyle = document.getElementById("native-hide-app-download-style");
        if (oldStyle) {
          try { oldStyle.remove(); } catch (_) {}
        }
        showOldAppUpdateModal();
      }, 400);

      return; // إنهاء السكربت للمستخدمين داخل التطبيق القديم بعد إظهار التنبيه
    }

    // ج) إذا كان المستخدم يتصفح عبر Google Chrome أو Safari أو غيرهما بشكل طبيعي:
    // نتركه كما هو تماماً دون أي إزعاج أو نوافذ
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
