-- ============================================================================
-- Cria a tabela `leads` para o módulo interno de leads (substitui a antiga
-- integração externa com `ia-app`). Cada lead é atribuído a um parceiro da
-- categoria `financiamento` (round-robin total-time).
-- ============================================================================

CREATE TABLE "leads" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "whatsapp"    TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "comment"     TEXT,
    "outcome_key" TEXT,
    "partner_id"  TEXT NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leads_partner_id_created_at_idx" ON "leads"("partner_id", "created_at");

ALTER TABLE "leads"
    ADD CONSTRAINT "leads_partner_id_fkey"
    FOREIGN KEY ("partner_id") REFERENCES "Partner"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
