# Forgot PIN API error diagnosis

User screenshots show the teacher dashboard error: `تعذر تحميل طلبات نسيان كلمة المرور.` and an empty count.

Railway state observed after opening the service:

- ACTIVE deployment: `Add teacher call confirmation after PIN reset request` (commit `6ca7ef5`), successful.
- Previous deployments for `d6d9c0a` and `2883254` are listed as removed after the newer deployment superseded them.
- The failure is therefore in the active server/API/database path, not merely a stale frontend cache.

Next diagnostic step: open the active deployment logs and capture the exact Prisma/API error for `/api/auth/parent/forgot-requests`.
