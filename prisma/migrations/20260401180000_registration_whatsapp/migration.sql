-- CreateEnum
CREATE TYPE "RegistrationChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "registration_channel" "RegistrationChannel" NOT NULL DEFAULT 'EMAIL';
ALTER TABLE "User" ADD COLUMN "whatsapp_verification_code" TEXT;
ALTER TABLE "User" ADD COLUMN "whatsapp_verification_expires_at" TIMESTAMP(3);
