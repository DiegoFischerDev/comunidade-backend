-- CreateTable
CREATE TABLE "joana_settings" (
    "id" TEXT NOT NULL,
    "context_text" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "joana_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "joana_conversations" (
    "id" TEXT NOT NULL,
    "whatsapp_digits" TEXT NOT NULL,
    "instance" TEXT,
    "display_name" VARCHAR(80),
    "buffer" JSONB NOT NULL DEFAULT '[]',
    "last_inbound_at" TIMESTAMP(3),
    "pending_confirmation" JSONB,
    "history" JSONB NOT NULL DEFAULT '[]',
    "pending_outbound" TEXT,
    "far_guidance_sent" BOOLEAN NOT NULL DEFAULT false,
    "scheduling_link_sent" BOOLEAN NOT NULL DEFAULT false,
    "processing" BOOLEAN NOT NULL DEFAULT false,
    "processing_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "joana_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "joana_conversations_whatsapp_digits_key" ON "joana_conversations"("whatsapp_digits");

-- CreateIndex
CREATE INDEX "joana_conversations_processing_last_inbound_at_idx" ON "joana_conversations"("processing", "last_inbound_at");
