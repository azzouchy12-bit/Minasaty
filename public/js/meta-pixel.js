/**
 * Meta Pixel Integration for Minasaty (أكاديمية التفوق)
 * Pixel ID: 1012712520447774
 * Funnel Events:
 * 1. PageView: يُسجل مرة واحدة فقط عند زيارة الواجهة الرئيسية (index.html) ولا يتكرر عند التنقل.
 * 2. CompleteRegistration / Purchase: للمسجل الذي تم تفعيل حسابه فقط.
 * 3. ActiveSubscriber20Days: للمشترك الذي تم تفعيل حسابه ومضى عليه أكثر من 20 يوماً.
 */
(function () {
  const PIXEL_ID = "1012712520447774";

  if (!window.fbq) {
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', PIXEL_ID);
  }

  // 1. الحدث الأول: PageView (الـ View مرة واحدة فقط في الواجهة الرئيسية)
  try {
    const rawPath = (window.location.pathname || "").toLowerCase();
    const isLandingPage = rawPath === "/" || 
                          rawPath === "" || 
                          rawPath.endsWith("/index.html") || 
                          rawPath.endsWith("/");

    if (isLandingPage && !sessionStorage.getItem("meta_landing_pv_tracked")) {
      const pvEventId = "pv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      window.pageViewEventId = pvEventId;
      window.fbq('track', 'PageView', {}, { eventID: pvEventId });
      try { sessionStorage.setItem("meta_landing_pv_tracked", "true"); } catch (_) {}
    }
  } catch (err) {
    console.warn('[MetaPixel] PageView error:', err);
  }

  // دالة مساعدة للتحقق مما إذا كان حساب التلميذ مفعلاً
  function isStudentAccountActivated(student) {
    if (!student) return false;
    const isUniv = student.level === "طالب جامعي";
    if (isUniv) {
      return Boolean(student.accountActive && !student.cardReuploadRequested);
    }
    const stage = student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");
    return ["PAID", "PROMISED"].includes(stage) || 
           student.paymentStatus === true || 
           student.accountActive === true ||
           (student.subscriptionEndDate && new Date(student.subscriptionEndDate) > new Date());
  }

  // 2. الحدث الثاني: المسجل (يعني الذي تم تفعيل حسابه فقط)
  window.trackMetaActivatedStudent = function (student) {
    try {
      if (typeof window.fbq !== 'function' || !student) return;
      if (!isStudentAccountActivated(student)) return; // شرط أساسي: حسابه مفعل

      const studentId = student.id || student.studentId || student._id || 'unknown';
      const cacheKey = "meta_activated_tracked_" + studentId;
      if (sessionStorage.getItem(cacheKey) === "true") return;

      const actEventId = "act_" + studentId + "_" + Date.now();

      // إرسال حدث إكمال التسجيل المفعل (CompleteRegistration)
      window.fbq('track', 'CompleteRegistration', {
        content_name: student.studentName || 'تلميذ مفعل',
        content_category: student.level || 'عام',
        status: 'activated'
      }, { eventID: "reg_" + actEventId });

      // إرسال حدث الاشتراك/الشراء (Purchase)
      window.fbq('track', 'Purchase', {
        content_name: 'اشتراك أكاديمية التفوق',
        content_category: student.level || 'اشتراك',
        value: Number(student.amount || 2500),
        currency: 'DZD'
      }, { eventID: "pur_" + actEventId });

      try { sessionStorage.setItem(cacheKey, "true"); } catch (_) {}
    } catch (err) {
      console.warn('[MetaPixel] trackMetaActivatedStudent error:', err);
    }
  };

  // للتوافق مع أي استدعاءات سابقة لـ trackMetaPurchase
  window.trackMetaPurchase = window.trackMetaActivatedStudent;

  // 3. الحدث الثالث: مشترك نشط أكثر من 20 يوماً وحسابه مفعل
  window.checkAndTrackMetaActive20Days = function (student) {
    try {
      if (typeof window.fbq !== 'function' || !student) return;
      if (!isStudentAccountActivated(student)) return; // شرط أساسي: حسابه مفعل

      const startDateStr = student.subscriptionStartDate || student.createdAt;
      if (!startDateStr) return;

      const startDate = new Date(startDateStr);
      if (Number.isNaN(startDate.getTime())) return;

      const now = new Date();
      const diffTime = now.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 20) {
        const studentId = student.id || student.studentId || student._id || 'unknown';
        const cacheKey = "meta_active_20d_" + studentId;
        if (sessionStorage.getItem(cacheKey) === "true") return;

        const eventId = "act20d_" + studentId + "_" + Date.now();
        window.fbq('trackCustom', 'ActiveSubscriber20Days', {
          student_level: student.level || '',
          days_active: diffDays,
          status: 'loyal_active_subscriber'
        }, { eventID: eventId });

        try { sessionStorage.setItem(cacheKey, "true"); } catch (_) {}
      }
    } catch (err) {
      console.warn('[MetaPixel] checkAndTrackMetaActive20Days error:', err);
    }
  };
})();
