-- CreateTable
CREATE TABLE "partner_house_whatsapp_sends" (
    "id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_house_whatsapp_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_house_whatsapp_sends_house_id_sent_at_idx" ON "partner_house_whatsapp_sends"("house_id", "sent_at");

-- AddForeignKey
ALTER TABLE "partner_house_whatsapp_sends" ADD CONSTRAINT "partner_house_whatsapp_sends_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "partner_houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

