-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "catalog_image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];
