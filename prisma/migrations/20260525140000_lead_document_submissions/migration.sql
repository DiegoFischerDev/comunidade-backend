-- ============================================================================
-- Suporte para upload de documentos por leads de financiamento.
--   * `Lead.docs_sent_at` — timestamp do primeiro envio (qualquer modo).
--   * Nova tabela `lead_document_submissions` — histórico de envios (modo
--     principal, cônjuge, extra) sem persistir ficheiros (vão direto por email).
-- ============================================================================

ALTER TABLE "leads"
    ADD COLUMN "docs_sent_at" TIMESTAMP(3);

CREATE TABLE "lead_document_submissions" (
    "id"              TEXT NOT NULL,
    "lead_id"         TEXT NOT NULL,
    "mode"            TEXT NOT NULL,
    "document_count"  INTEGER NOT NULL,
    "vinculo_laboral" TEXT,
    "estado_civil"    TEXT,
    "submitted_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_document_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_document_submissions_lead_id_submitted_at_idx"
    ON "lead_document_submissions"("lead_id", "submitted_at");

ALTER TABLE "lead_document_submissions"
    ADD CONSTRAINT "lead_document_submissions_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
