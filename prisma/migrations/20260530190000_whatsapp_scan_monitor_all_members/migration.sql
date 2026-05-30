-- Distinção explícita: «todos os membros» vs lista vazia sem filtro
ALTER TABLE "whatsapp_scan_groups"
ADD COLUMN IF NOT EXISTS "monitor_all_members" BOOLEAN NOT NULL DEFAULT false;

-- Legado: lista vazia significava monitorizar todos
UPDATE "whatsapp_scan_groups"
SET "monitor_all_members" = true
WHERE cardinality("monitored_numbers") = 0;
