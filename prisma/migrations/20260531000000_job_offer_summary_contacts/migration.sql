ALTER TABLE "job_offers" ADD COLUMN "summary" VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE "job_offers" ADD COLUMN "company" TEXT NOT NULL DEFAULT '';
ALTER TABLE "job_offers" ADD COLUMN "advertiser_contacts" JSONB NOT NULL DEFAULT '[]';

UPDATE "job_offers"
SET "summary" = LEFT("description", 500)
WHERE "summary" = '';
