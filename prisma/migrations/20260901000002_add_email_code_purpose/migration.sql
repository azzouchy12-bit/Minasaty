ALTER TABLE "ParentEmailVerificationCode"
ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'EMAIL_VERIFICATION';

CREATE INDEX "ParentEmailVerificationCode_parentPhone_email_purpose_usedAt_expiresAt_idx"
ON "ParentEmailVerificationCode"("parentPhone", "email", "purpose", "usedAt", "expiresAt");
