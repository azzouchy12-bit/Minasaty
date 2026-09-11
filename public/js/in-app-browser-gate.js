"use strict";

(function () {
  /**
   * فحص دقيق وشامل لاكتشاف ما إذا كان المستخدم داخل التطبيق (APK أو PWA):
   * 1. فحص LocalStorage للحفاظ على استمرارية حالة "داخل التطبيق"
   * 2. فحص معاملات الرابط (Query Parameters) عند بدء تشغيل الـ APK / PWA
   * 3. فحص وضع العرض المستقل (PWA Standalone & Fullscreen)
   * 4. فحص متصفح أندرويد الداخلي (Android WebView المستخدم في حزم الـ APK)
   * 5. فحص مصدر الدخول عبر تطبيق أندرويد (android-app:// referrer)
   * 6. فحص جسور الاتصال البرمجية (Android Javascript Interfaces)
   */
  function checkIfInApp() {
    // 1. فحص الذاكرة المحلية
    try {
      if (localStorage.getItem("minasaty_in_app") === "true") {
        return true;
      }
    } catch (_) {}

    // 2. فحص معلمات الرابط عند فتح التطبيق
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (
        urlParams.get("mode") === "app" ||
        urlParams.get("app") === "true" ||
        urlParams.get("app") === "1" ||
        urlParams.get("source") === "apk" ||
        urlParams.get("source") === "app" ||
        urlParams.get("source") === "pwa" ||
        urlParams.get("standalone") === "true" ||
        window.location.hash.includes("app-mode") ||
        window.location.hash.includes("standalone")
      ) {
        localStorage.setItem("minasaty_in_app", "true");
        return true;
      }
    } catch (_) {}

    // 3. فحص نمط PWA Standalone / Fullscreen
    const isPwaStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches ||
      window.navigator.standalone === true;

    if (isPwaStandalone) {
      try { localStorage.setItem("minasaty_in_app", "true"); } catch (_) {}
      return true;
    }

    // 4. فحص بيئة Android WebView (تطبيقات الـ APK المنشأة للأندرويد)
    const ua = navigator.userAgent || navigator.vendor || window.opera || "";
    const isAndroid = /Android/i.test(ua);
    const isAndroidWebView =
      /;\s*wv/i.test(ua) || // العلامة الدقيقة والمباشرة للـ WebView في أندرويد
      (isAndroid && /Version\/[0-9.]+/i.test(ua) && !/Chrome\/[0-9.]+\s+Mobile/i.test(ua)) ||
      (isAndroid && /Version\/[0-9.]+\s+Chrome/i.test(ua)) ||
      /WebIntoApp|gonative|median|hermit|capacitor|cordova|Crosswalk/i.test(ua);

    if (isAndroidWebView) {
      try { localStorage.setItem("minasaty_in_app", "true"); } catch (_) {}
      return true;
    }

    // 5. فحص مصدر الدخول من تطبيق أندرويد
    if (document.referrer && document.referrer.startsWith("android-app://")) {
      try { localStorage.setItem("minasaty_in_app", "true"); } catch (_) {}
      return true;
    }

    // 6. فحص كائنات البيئة المحقونة
    if (
      typeof window.Android !== "undefined" ||
      typeof window.AndroidInterface !== "undefined" ||
      typeof window.ReactNativeWebView !== "undefined" ||
      window.IS_APP === true ||
      document.body?.classList?.contains("is-app")
    ) {
      try { localStorage.setItem("minasaty_in_app", "true"); } catch (_) {}
      return true;
    }

    return false;
  }

  // إذا كان المستخدم يتصفح من داخل التطبيق، نمنع ظهور أي نافذة أو زر نهائياً
  if (checkIfInApp()) {
    const removeElements = () => {
      document.getElementById("minasaty-floating-app-btn")?.remove();
      document.getElementById("minasaty-app-modal")?.remove();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", removeElements);
    } else {
      removeElements();
    }
    return;
  }

  const STORAGE_KEY = "minasaty_app_modal_dismissed_until";

  function isDismissed() {
    try {
      const until = Number(localStorage.getItem(STORAGE_KEY) || 0);
      return Date.now() < until;
    } catch (_) {
      return false;
    }
  }

  function dismiss(hours = 24) {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now() + hours * 3600 * 1000));
    } catch (_) {}
    const modal = document.getElementById("minasaty-app-modal");
    if (modal) modal.style.display = "none";
  }

  const ua = navigator.userAgent || navigator.vendor || window.opera || "";
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // بناء عناصر النافذة والزر العائم لمتصفح الويب العادي فقط
  function initAppModal() {
    if (checkIfInApp()) return;
    if (document.getElementById("minasaty-app-modal")) return;

    // الزر العائم الصغير في زاوية الشاشة
    const floatingBtn = document.createElement("button");
    floatingBtn.id = "minasaty-floating-app-btn";
    floatingBtn.className = "minasaty-floating-btn";
    floatingBtn.innerHTML = "<span>📱 تطبيق المنصة</span>";
    floatingBtn.title = "تحميل وتثبيت تطبيق الأكاديمية";
    floatingBtn.addEventListener("click", () => showModal());
    document.body.appendChild(floatingBtn);

    // كود المودال المنبثق
    const modal = document.createElement("div");
    modal.id = "minasaty-app-modal";
    modal.className = "minasaty-modal-overlay";
    modal.style.display = isDismissed() ? "none" : "flex";

    const contentHtml = `
      <div class="minasaty-modal-card">
        <button class="minasaty-modal-close" id="minasaty-modal-close-btn" aria-label="إغلاق">✕</button>
        
        <div class="minasaty-modal-avatar">
          <img src="/assets/teacher.jpg" onerror="this.src='/assets/icon-192.png'" alt="الأستاذ عز الدين شارف" />
        </div>

        <h2>تطبيق أكاديمية التفوق متاح الآن! 📱</h2>
        <p class="minasaty-modal-sub">حمّل التطبيق على هاتفك لدخول أسرع للحصص المباشرة وتلقي تنبيهات فورية بالدروس والواجبات.</p>

        <div class="minasaty-modal-actions">
          ${
            isIos
              ? `
            <div class="minasaty-ios-steps">
              <strong>🍏 طريقة التثبيت على الآيفون والآيباد:</strong>
              <ol>
                <li>اضغط على زر المشاركة <strong>[ ⎋ ]</strong> أسفل متصفح Safari.</li>
                <li>اختر: <strong>[ ➕ إضافة إلى الشاشة الرئيسية ]</strong>.</li>
                <li>اضغط <strong>[ إضافة ]</strong> وسيظهر التطبيق على شاشتك فوراً!</li>
              </ol>
            </div>
            `
              : `
            <a href="/downloads/acadimia.apk" download="acadimia.apk" class="minasaty-btn-download-apk" id="minasaty-apk-action-btn">
              <span>📥 تحميل تطبيق أندرويد المباشر (APK)</span>
            </a>
            <small class="minasaty-apk-hint">حجم خفيف جداً • متوافق مع كافة هواتف أندرويد</small>
            `
          }

          <button id="minasaty-enable-notifications-btn" class="minasaty-btn-notifications">
            <span>🔔 تفعيل التنبيهات الفورية للحصص</span>
          </button>
        </div>

        <button id="minasaty-continue-web-btn" class="minasaty-btn-dismiss">
          المتابعة عبر المتصفح
        </button>
      </div>
    `;

    modal.innerHTML = contentHtml;
    document.body.appendChild(modal);

    // تفعيل أزرار الإغلاق
    document
      .getElementById("minasaty-modal-close-btn")
      ?.addEventListener("click", () => dismiss(24));

    document
      .getElementById("minasaty-continue-web-btn")
      ?.addEventListener("click", () => dismiss(24));

    // إغلاق عند النقر في الخلفية
    modal.addEventListener("click", (e) => {
      if (e.target === modal) dismiss(24);
    });

    // تفعيل التنبيهات
    const notifBtn = document.getElementById("minasaty-enable-notifications-btn");
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        if (notifBtn) {
          notifBtn.innerHTML = "<span>✓ التنبيهات مفعلة بنجاح</span>";
          notifBtn.classList.add("is-granted");
          notifBtn.disabled = true;
        }
      } else {
        notifBtn?.addEventListener("click", async () => {
          try {
            const perm = await Notification.requestPermission();
            if (perm === "granted") {
              notifBtn.innerHTML = "<span>✓ تم تفعيل التنبيهات بنجاح!</span>";
              notifBtn.classList.add("is-granted");
              notifBtn.disabled = true;
            } else {
              alert("يرجى تفعيل التنبيهات من إعدادات المتصفح لتلقي مواعيد الحصص.");
            }
          } catch (_) {}
        });
      }
    } else {
      if (notifBtn) notifBtn.style.display = "none";
    }
  }

  function showModal() {
    if (checkIfInApp()) return;
    const modal = document.getElementById("minasaty-app-modal");
    if (modal) modal.style.display = "flex";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAppModal);
  } else {
    initAppModal();
  }
})();
