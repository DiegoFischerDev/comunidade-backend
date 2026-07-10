-- Agendamentos cancelados deixam de ser mantidos (apagados em runtime).
-- Limpa histórico existente e referências órfãs em unlocks.

UPDATE "rafa_call_guest_unlocks"
SET "consumed_booking_id" = NULL,
    "consumed_at" = NULL
WHERE "consumed_booking_id" IN (
  SELECT "id" FROM "rafa_call_bookings" WHERE "status" = 'CANCELLED'
);

DELETE FROM "rafa_call_bookings" WHERE "status" = 'CANCELLED';
