/**
 * Meta Pixel Integration for Minasaty (أكاديمية التفوق)
 * Pixel ID: 1012712520447774
 * Supports explicit PageView eventID for CAPI Gateway deduplication
 * and handles Funnel Events: CompleteRegistration, Purchase, and ActiveSubscriber20Days.
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

  // 1. Explicit unique eventID for PageView (Conversions API Gateway deduplication)
  const pvEventId = "pv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  window.pageViewEventId = pvEventId;
  window.fbq('track', 'PageView', {}, { eventID: pvEventId });

  // 2. Event 1: Registration (فتح حساب وتسجيل جديد)
  window.trackMetaRegistration = function (data) {
    try {
      if (typeof window.fbq !== 'function') return;
      const regEventId = "reg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      window.fbq('track', 'CompleteRegistration', {
        content_name: data?.studentName || 'تسجيل تلميذ جديد',
        content_category: data?.level || 'عام',
        status: 'registered'
      }, { eventID: regEventId });
    } catch (err) {
      console.warn('[MetaPixel] trackRegistration error:', err);
    }
  };

  // 3. Event 2: Purchase / Activation (تفعيل الحساب من طرف الأستاذ أو شراء اشتراك)
  window.trackMetaPurchase = function (data) {
    try {
      if (typeof window.fbq !== 'function') return;
      const studentId = data?.studentId || data?.id || 'unknown';
      const purEventId = "pur_" + studentId + "_" + Date.now();
      window.fbq('track', 'Purchase', {
        content_name: 'اشتراك أكاديمية التفوق',
        content_category: data?.level || 'اشتراك شهري',
        value: Number(data?.amount || 2500),
        currency: 'DZD'
      }, { eventID: purEventId });
    } catch (err) {
      console.warn('[MetaPixel] trackPurchase error:', err);
    }
  };

  // 4. Event 3: Active Subscriber > 20 Days (مشترك نشط أكثر من 20 يوماً)
  window.checkAndTrackMetaActive20Days = function (studentData) {
    try {
      if (typeof window.fbq !== 'function' || !studentData) return;
      const startDateStr = studentData.subscriptionStartDate || studentData.createdAt;
      if (!startDateStr) return;

      const startDate = new Date(startDateStr);
      if (Number.isNaN(startDate.getTime())) return;

      const now = new Date();
      const diffTime = now.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 20) {
        const studentKey = studentData.studentId || studentData.id || 'student';
        const cacheKey = "meta_active_20d_" + studentKey;
        if (localStorage.getItem(cacheKey) === "true") return;

        const eventId = "act20d_" + studentKey + "_" + Date.now();
        window.fbq('trackCustom', 'ActiveSubscriber20Days', {
          student_level: studentData.level || '',
          days_active: diffDays,
          status: 'loyal_active_subscriber'
        }, { eventID: eventId });

        try { localStorage.setItem(cacheKey, "true"); } catch (_) {}
      }
    } catch (err) {
      console.warn('[MetaPixel] checkAndTrackMetaActive20Days error:', err);
    }
  };
})();
