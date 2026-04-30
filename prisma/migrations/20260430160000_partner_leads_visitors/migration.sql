-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_partner_lead_messages" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_partner_lead_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visitors_whatsapp_key" ON "visitors"("whatsapp");

-- AlterTable Partner
ALTER TABLE "Partner" ADD COLUMN "average_response_minutes" DOUBLE PRECISION,
ADD COLUMN "lead_response_sample_count" INTEGER NOT NULL DEFAULT 0;

-- Drop old unique on Lead (Prisma name vs legacy index name)
DROP INDEX IF EXISTS "Lead_partner_id_user_id_key";
ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "lead_partner_user_unique";

-- AlterTable Lead
ALTER TABLE "Lead" ADD COLUMN     "visitor_id" TEXT,
ADD COLUMN     "interest_comment" TEXT,
ADD COLUMN     "attended_at" TIMESTAMP(3);

ALTER TABLE "Lead" ALTER COLUMN "user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Lead_visitor_id_idx" ON "Lead"("visitor_id");

-- Exactly one of user_id or visitor_id
ALTER TABLE "Lead" ADD CONSTRAINT "lead_user_xor_visitor" CHECK (
  ("user_id" IS NOT NULL AND "visitor_id" IS NULL) OR
  ("user_id" IS NULL AND "visitor_id" IS NOT NULL)
);
