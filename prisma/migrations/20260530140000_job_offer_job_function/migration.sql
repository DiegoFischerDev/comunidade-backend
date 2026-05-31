-- AlterTable
ALTER TABLE "job_offers" ADD COLUMN "job_function" TEXT NOT NULL DEFAULT '—';

ALTER TABLE "job_offers" ALTER COLUMN "job_function" DROP DEFAULT;
