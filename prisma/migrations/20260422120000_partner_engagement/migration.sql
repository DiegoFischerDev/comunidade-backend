-- CreateEnum
CREATE TYPE "PartnerReactionType" AS ENUM ('LIKE', 'DISLIKE');

-- AlterTable
ALTER TABLE "partners" ADD COLUMN "share_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "partner_reactions" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "PartnerReactionType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_comments" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_reactions_partner_id_idx" ON "partner_reactions"("partner_id");

-- CreateIndex
CREATE INDEX "partner_reactions_type_idx" ON "partner_reactions"("type");

-- CreateIndex
CREATE INDEX "partner_comments_partner_id_created_at_idx" ON "partner_comments"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_comments_user_id_idx" ON "partner_comments"("user_id");

-- AddForeignKey
ALTER TABLE "partner_reactions" ADD CONSTRAINT "partner_reactions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_reactions" ADD CONSTRAINT "partner_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "partner_reaction_user_partner_unique" ON "partner_reactions"("user_id", "partner_id");
