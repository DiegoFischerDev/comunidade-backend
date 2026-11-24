-- AlterTable
ALTER TABLE "rag_qa_pairs" ADD COLUMN "code" VARCHAR(16);

-- Backfill codes ordered by created_at (Rag01, Rag02, …)
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM "rag_qa_pairs"
)
UPDATE "rag_qa_pairs" AS p
SET "code" = 'Rag' || LPAD(ordered.rn::text, 2, '0')
FROM ordered
WHERE p.id = ordered.id;

-- Make code required + unique
ALTER TABLE "rag_qa_pairs" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "rag_qa_pairs_code_key" ON "rag_qa_pairs"("code");

-- AlterTable: citations on bot outbound messages
ALTER TABLE "channel_messages" ADD COLUMN "rag_codes" JSONB;
