# Root cause confirmed

Railway production logs show the exact failure for `GET /api/auth/parent/forgot-requests`:

```text
Unknown field `temporaryPinExpiresAt` for select statement on model `PasswordResetRequest`.
Available options include `temporaryExpiresAt`.
```

The active deployment is using `authController.js` with `temporaryPinExpiresAt` in the `PasswordResetRequest.findMany()` select, while Prisma schema/client defines the field as `temporaryExpiresAt`.

This is why the teacher dashboard shows `تعذر تحميل طلبات نسيان كلمة المرور` and count `0`; the request list API returns an error before it can render any rows.

Fix: change only the `PasswordResetRequest` select field to `temporaryExpiresAt`, then run syntax/tests, deploy, and verify the API no longer emits this Prisma validation error.
