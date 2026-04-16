-- Chamada de vídeo com Rafa (Cal.com + Stripe taxa de novo agendamento)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rafa_call_scheduling_unlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rafa_call_slot_ends_at" TIMESTAMP(3);
