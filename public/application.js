"use strict";

// 1. تسجيل عامل الخدمة (Service Worker) فورياً
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const btnInstall = document.getElementById("btn-install");
  const installGuide = document.getElementById("install-guide");
  const guideTitle = document.getElementById("guide-title");
  const guideSteps = document.getElementById("guide-steps");

  let deferredPrompt = null;

  // التقاط حدث التثبيت التلقائي من Chrome و Edge و Android
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnInstall) btnInstall.style.display = "flex";
    if (installGuide) installGuide.style.display = "none";
  });

  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone && btnInstall) {
    btnInstall.innerHTML = "<span>🚀 فتح التطبيق الآن</span>";
    btnInstall.addEventListener("click", () => {
      window.location.href = "/";
    });
  } else if (isIos) {
    if (btnInstall) btnInstall.style.display = "none";
    if (installGuide) {
      installGuide.style.display = "block";
      if (guideTitle) guideTitle.textContent = "🍏 طريقة التثبيت على الآيفون والآيباد:";
      if (guideSteps) {
        guideSteps.innerHTML = `
          <li>اضغط على زر المشاركة <strong>[ ⎋ ]</strong> أسفل متصفح Safari.</li>
          <li>انزل في القائمة واختر: <strong>[ ➕ إضافة إلى الشاشة الرئيسية ]</strong>.</li>
          <li>اضغط <strong>[ إضافة (Add) ]</strong> في الأعلى وسيظهر التطبيق فوراً على شاشتك.</li>
        `;
      }
    }
  }

  btnInstall?.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        btnInstall.innerHTML = "<span>✓ تم تثبيت التطبيق بنجاح!</span>";
        btnInstall.style.background = "#22c55e";
      }
      deferredPrompt = null;
    } else {
      if (installGuide) {
        installGuide.style.display = "block";
        installGuide.scrollIntoView({ behavior: "smooth" });
      }
    }
  });
});
