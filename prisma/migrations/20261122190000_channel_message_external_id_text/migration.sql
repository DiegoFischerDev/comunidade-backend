-- Mids do Instagram Graph (message.mid) ultrapassam VARCHAR(128); o create falhava
-- em silêncio e o lead não entrava no histórico (o bot grava sem external_message_id).
ALTER TABLE "channel_messages"
  ALTER COLUMN "external_message_id" TYPE TEXT;
