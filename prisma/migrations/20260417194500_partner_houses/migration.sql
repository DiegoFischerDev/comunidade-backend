-- CreateEnum
CREATE TYPE "PartnerHouseStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "partner_houses" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "available_from" TIMESTAMP(3) NOT NULL,
    "price_eur" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "status" "PartnerHouseStatus" NOT NULL DEFAULT 'AVAILABLE',
    "whatsapp_sent_at" TIMESTAMP(3),
    "whatsapp_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_houses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_houses_partner_id_status_idx" ON "partner_houses"("partner_id", "status");

-- CreateIndex
CREATE INDEX "partner_houses_available_from_idx" ON "partner_houses"("available_from");

-- AddForeignKey
ALTER TABLE "partner_houses" ADD CONSTRAINT "partner_houses_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

