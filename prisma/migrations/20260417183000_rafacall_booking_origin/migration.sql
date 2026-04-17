-- Add RafaCall booking origin (paid vs affiliate) and current unlock origin on User.

-- CreateEnum
CREATE TYPE "RafaCallBookingOrigin" AS ENUM ('USER_PAID', 'AFFILIATE_FREE');

-- AlterTable: User
ALTER TABLE "User" ADD COLUMN "rafa_call_unlock_origin" "RafaCallBookingOrigin";

-- AlterTable: rafa_call_bookings
ALTER TABLE "rafa_call_bookings" ADD COLUMN "origin" "RafaCallBookingOrigin" NOT NULL DEFAULT 'USER_PAID';

