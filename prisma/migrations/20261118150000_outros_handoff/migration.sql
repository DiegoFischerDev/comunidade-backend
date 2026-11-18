-- AlterEnum
ALTER TYPE "ChatbotEngineKind" ADD VALUE 'HANDOFF_OTHER';

-- AlterTable
ALTER TABLE "crm_leads" ADD COLUMN "subject_summary" VARCHAR(200);
