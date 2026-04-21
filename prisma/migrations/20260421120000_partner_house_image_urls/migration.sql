-- AlterTable
ALTER TABLE "partner_houses" ADD COLUMN "image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
