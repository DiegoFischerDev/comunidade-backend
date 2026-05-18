-- CreateTable
CREATE TABLE "recommended_services" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "partner_share_link_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommended_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recommended_services_partner_share_link_id_key" ON "recommended_services"("partner_share_link_id");

-- CreateIndex
CREATE INDEX "recommended_services_active_sort_order_idx" ON "recommended_services"("active", "sort_order");

-- AddForeignKey
ALTER TABLE "recommended_services" ADD CONSTRAINT "recommended_services_partner_share_link_id_fkey" FOREIGN KEY ("partner_share_link_id") REFERENCES "partner_share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
