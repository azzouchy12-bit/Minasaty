# Forgot PIN API fix verified

Railway production logs identified the root cause:

```text
Unknown field `temporaryPinExpiresAt` for select statement on model `PasswordResetRequest`.
```

The Prisma schema field is `temporaryExpiresAt`. The code was corrected in commit `f5b5b72`.

Live verification after deployment:

- `teacher-dashboard.html` loads the forgot-PIN tab and badge.
- The tab badge shows `1` request.
- Opening `#forgot-pin-requests-panel` successfully renders one real request:
  - Student: `شارف يوسف`
  - Phone: `0500000000`
  - Action: `إنشاء كلمة مرور مؤقتة`
- The previous red error `تعذر تحميل طلبات نسيان كلمة المرور` is gone.
