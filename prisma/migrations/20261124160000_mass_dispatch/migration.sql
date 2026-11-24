-- CreateEnum
CREATE TYPE "MassCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "MassCampaignRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MassCampaignSourceType" AS ENUM ('BOOKING', 'CRM_LEAD');

-- CreateTable
CREATE TABLE "mass_campaigns" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(160),
    "status" "MassCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "steps" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "text_variations" JSONB NOT NULL DEFAULT '{}',
    "min_delay_minutes" INTEGER NOT NULL DEFAULT 1,
    "max_delay_minutes" INTEGER NOT NULL DEFAULT 10,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mass_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mass_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "status" "MassCampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "bot_slug" VARCHAR(32) NOT NULL,
    "source_type" "MassCampaignSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "channel" "ChatbotChannel" NOT NULL,
    "whatsapp_digits" TEXT,
    "instagram_user_id" VARCHAR(64),
    "display_name" VARCHAR(120),
    "due_at" TIMESTAMP(3) NOT NULL,
    "variation_index" INTEGER,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mass_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mass_campaigns_status_idx" ON "mass_campaigns"("status");

-- CreateIndex
CREATE INDEX "mass_campaigns_created_at_idx" ON "mass_campaigns"("created_at");

-- CreateIndex
CREATE INDEX "mass_campaign_recipients_campaign_id_status_idx" ON "mass_campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "mass_campaign_recipients_status_due_at_idx" ON "mass_campaign_recipients"("status", "due_at");

-- CreateIndex
CREATE INDEX "mass_campaign_recipients_conversation_id_idx" ON "mass_campaign_recipients"("conversation_id");

-- AddForeignKey
ALTER TABLE "mass_campaigns" ADD CONSTRAINT "mass_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mass_campaign_recipients" ADD CONSTRAINT "mass_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "mass_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
