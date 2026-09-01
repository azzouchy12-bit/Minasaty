CREATE TABLE "ParentEmailVerificationCode" (
    "id" UUID NOT NULL,
    "parentPhone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentEmailVerificationCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ParentEmailVerificationCode_parentPhone_email_usedAt_expiresAt_idx"
ON "ParentEmailVerificationCode"("parentPhone", "email", "usedAt", "expiresAt");

ALTER TABLE "ParentEmailVerificationCode"
ADD CONSTRAINT "ParentEmailVerificationCode_parentPhone_fkey"
FOREIGN KEY ("parentPhone") REFERENCES "ParentCredential"("parentPhone")
ON DELETE CASCADE ON UPDATE CASCADE;
