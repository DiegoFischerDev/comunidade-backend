-- CreateTable
CREATE TABLE "house_relocation_whatsapp_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_jid" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "house_relocation_whatsapp_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "house_relocation_whatsapp_groups_group_jid_key" ON "house_relocation_whatsapp_groups"("group_jid");

-- CreateIndex
CREATE INDEX "house_relocation_whatsapp_groups_active_sort_order_idx" ON "house_relocation_whatsapp_groups"("active", "sort_order");
