-- Simplifica regiões de ofertas: NORTE, CENTRO e SUL
CREATE TYPE "JobOfferRegion_new" AS ENUM ('NORTE', 'CENTRO', 'SUL');

ALTER TABLE "job_offers" ALTER COLUMN "region" DROP DEFAULT;

ALTER TABLE "job_offers"
  ALTER COLUMN "region" TYPE "JobOfferRegion_new"
  USING (
    CASE "region"::text
      WHEN 'NORTE' THEN 'NORTE'::"JobOfferRegion_new"
      WHEN 'CENTRO' THEN 'CENTRO'::"JobOfferRegion_new"
      ELSE 'SUL'::"JobOfferRegion_new"
    END
  );

ALTER TABLE "job_offers"
  ALTER COLUMN "region" SET DEFAULT 'SUL'::"JobOfferRegion_new";

ALTER TABLE "job_offer_whatsapp_routes"
  ALTER COLUMN "publish_region" TYPE "JobOfferRegion_new"
  USING (
    CASE
      WHEN "publish_region" IS NULL THEN NULL
      WHEN "publish_region"::text = 'NORTE' THEN 'NORTE'::"JobOfferRegion_new"
      WHEN "publish_region"::text = 'CENTRO' THEN 'CENTRO'::"JobOfferRegion_new"
      ELSE 'SUL'::"JobOfferRegion_new"
    END
  );

DROP TYPE "JobOfferRegion";
ALTER TYPE "JobOfferRegion_new" RENAME TO "JobOfferRegion";
