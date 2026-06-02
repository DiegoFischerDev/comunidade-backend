ALTER TYPE "JobOfferWhatsappMessageStatus" ADD VALUE IF NOT EXISTS 'ignored_no_city';

ALTER TABLE "job_offers" ADD COLUMN IF NOT EXISTS "image_url" VARCHAR(2048);
