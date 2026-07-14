-- Lembrete WhatsApp na véspera do agendamento (22:00 Europe/Lisbon).
ALTER TABLE "rafa_call_bookings"
ADD COLUMN "day_before_reminder_sent_at" TIMESTAMP(3);
