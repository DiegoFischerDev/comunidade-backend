-- CreateEnum
CREATE TYPE "WhatsappClientAutomationStepType" AS ENUM ('TEXT', 'AUDIO', 'IMAGE');

-- CreateTable
CREATE TABLE "whatsapp_client_automations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger_phrase" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_client_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_client_automation_steps" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "type" "WhatsappClientAutomationStepType" NOT NULL,
    "text_content" TEXT,
    "media_url" TEXT,
    "media_mime_type" TEXT,
    "media_file_name" TEXT,
    "delay_ms_after" INTEGER NOT NULL DEFAULT 650,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_client_automation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_client_automation_firings" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "whatsapp_digits" TEXT NOT NULL,
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "external_message_id" TEXT,

    CONSTRAINT "whatsapp_client_automation_firings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_client_automations_active_idx" ON "whatsapp_client_automations"("active");

-- CreateIndex
CREATE INDEX "whatsapp_client_automation_steps_automation_id_sort_order_idx" ON "whatsapp_client_automation_steps"("automation_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_client_automation_firings_external_message_id_key" ON "whatsapp_client_automation_firings"("external_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_client_automation_firings_automation_id_whatsapp_digits_fired_at_idx" ON "whatsapp_client_automation_firings"("automation_id", "whatsapp_digits", "fired_at");

-- AddForeignKey
ALTER TABLE "whatsapp_client_automation_steps" ADD CONSTRAINT "whatsapp_client_automation_steps_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "whatsapp_client_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_client_automation_firings" ADD CONSTRAINT "whatsapp_client_automation_firings_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "whatsapp_client_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
