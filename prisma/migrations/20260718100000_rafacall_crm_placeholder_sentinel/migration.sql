-- Converte slots fictícios antigos (now − 30 dias) no sentinela CRM.
-- Assim, leads em «Realizou vídeo chamada» (ou colunas seguintes) sem horário
-- real passam a aparecer como vídeo chamada indefinida.
UPDATE "rafa_call_bookings"
SET
  "starts_at" = TIMESTAMPTZ '1970-01-01 12:00:00+00',
  "ends_at" = TIMESTAMPTZ '1970-01-01 12:40:00+00'
WHERE "status" = 'COMPLETED'
  AND "starts_at" < "created_at" - INTERVAL '14 days'
  AND EXTRACT(EPOCH FROM ("ends_at" - "starts_at")) BETWEEN 2300 AND 2500;
