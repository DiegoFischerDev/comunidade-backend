-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "background_image_url" TEXT,
ADD COLUMN     "full_description" TEXT,
ADD COLUMN     "rpm_commission_percent" DOUBLE PRECISION,
ADD COLUMN     "short_description" TEXT;

-- AlterTable
ALTER TABLE "Service" ALTER COLUMN "category_id" DROP NOT NULL;
