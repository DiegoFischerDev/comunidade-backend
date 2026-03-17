-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email_verification_code" TEXT,
ADD COLUMN     "email_verification_expires_at" TIMESTAMP(3),
ADD COLUMN     "email_verified_at" TIMESTAMP(3);
