"use strict";

(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "desktop") return;
    if (sessionStorage.getItem("teacherDesktopMode") === "1") return;
    var isMobile =
      /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ) ||
      (window.screen && window.screen.width <= 900) ||
      window.innerWidth <= 900;
    if (isMobile) {
      window.location.replace("./teacher-live-mobile.html" + window.location.search);
    }
  } catch (_) {}
})();
