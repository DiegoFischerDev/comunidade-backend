-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reset_password_code" TEXT,
ADD COLUMN     "reset_password_expires_at" TIMESTAMP(3);
