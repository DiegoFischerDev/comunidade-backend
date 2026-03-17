/*
  Adjusted to add `created_by_user_id` as nullable to support existing rows.
*/
-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "created_by_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
