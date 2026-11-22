-- Resumo curto das dúvidas e solicitações do lead (gerado pela OpenAI, editável no CRM).
ALTER TABLE "rafa_call_bookings" ADD COLUMN "crm_request_summary" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN "crm_request_summary" TEXT;
