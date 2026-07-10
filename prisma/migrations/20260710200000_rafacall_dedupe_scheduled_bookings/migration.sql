-- Remove agendamentos SCHEDULED duplicados no mesmo instante (mantém o mais recente).
DELETE FROM "rafa_call_bookings" a
USING "rafa_call_bookings" b
WHERE a.status = 'SCHEDULED'
  AND b.status = 'SCHEDULED'
  AND a."starts_at" = b."starts_at"
  AND a.id <> b.id
  AND a."created_at" < b."created_at";

-- Impede voltar a criar dois SCHEDULED no mesmo horário de início.
CREATE UNIQUE INDEX IF NOT EXISTS "rafa_call_bookings_scheduled_starts_at_key"
  ON "rafa_call_bookings" ("starts_at")
  WHERE status = 'SCHEDULED';
