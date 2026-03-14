-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('VISITOR', 'MEMBER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "membership_expires_at" TIMESTAMP(3),
ADD COLUMN     "tier" "UserTier" NOT NULL DEFAULT 'VISITOR';
