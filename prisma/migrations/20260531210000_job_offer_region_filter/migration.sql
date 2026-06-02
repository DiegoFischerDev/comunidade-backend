-- Filtro regional nas rotas WhatsApp (ex.: grupo Norte só recebe vagas do Norte)
CREATE TYPE "JobOfferRegion" AS ENUM (
  'NORTE',
  'CENTRO',
  'LISBOA',
  'ALENTEJO',
  'ALGARVE',
  'ACORES',
  'MADEIRA',
  'OUTRA'
);

ALTER TYPE "JobOfferWhatsappMessageStatus" ADD VALUE IF NOT EXISTS 'skipped_region';

ALTER TABLE "job_offers" ADD COLUMN "region" "JobOfferRegion" NOT NULL DEFAULT 'OUTRA';

ALTER TABLE "job_offer_whatsapp_routes"
  ADD COLUMN "publish_region" "JobOfferRegion";
