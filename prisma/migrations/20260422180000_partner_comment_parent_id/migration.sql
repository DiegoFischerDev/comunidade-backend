-- AlterTable
ALTER TABLE "partner_comments" ADD COLUMN "parent_id" TEXT;

-- AddForeignKey
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "partner_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "partner_comments_parent_id_idx" ON "partner_comments"("parent_id");
