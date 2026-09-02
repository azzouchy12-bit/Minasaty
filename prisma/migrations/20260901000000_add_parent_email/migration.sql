ALTER TABLE "ParentCredential"
ADD COLUMN "email" TEXT,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ParentCredential_email_key"
ON "ParentCredential"("email");

