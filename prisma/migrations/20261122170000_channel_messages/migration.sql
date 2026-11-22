-- O valor novo do enum não pode nascer dentro da transação da migration.
COMMIT;
ALTER TYPE "ChatbotChannel" ADD VALUE 'FACEBOOK';
BEGIN;

CREATE TYPE "ChannelMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "ChannelMessageAuthor" AS ENUM ('LEAD', 'BOT', 'ADMIN');
CREATE TYPE "ChannelMessageKind" AS ENUM ('TEXT', 'AUDIO_TRANSCRIPT');

CREATE TABLE "channel_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "channel" "ChatbotChannel" NOT NULL,
    "direction" "ChannelMessageDirection" NOT NULL,
    "author" "ChannelMessageAuthor" NOT NULL,
    "kind" "ChannelMessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "external_message_id" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_messages_external_message_id_key" ON "channel_messages"("external_message_id");
CREATE INDEX "channel_messages_conversation_id_created_at_idx" ON "channel_messages"("conversation_id", "created_at");

ALTER TABLE "channel_messages"
  ADD CONSTRAINT "channel_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "joana_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill dos turnos já guardados no JSON do modelo. Áudios antigos ficam como TEXT.
INSERT INTO "channel_messages" (
  "id",
  "conversation_id",
  "channel",
  "direction",
  "author",
  "kind",
  "body",
  "created_at"
)
SELECT
  'hist_' || c."id" || '_' || (t.ord - 1)::text,
  c."id",
  c."active_channel",
  CASE WHEN t.elem->>'role' = 'assistant' THEN 'OUTBOUND'::"ChannelMessageDirection" ELSE 'INBOUND'::"ChannelMessageDirection" END,
  CASE WHEN t.elem->>'role' = 'assistant' THEN 'BOT'::"ChannelMessageAuthor" ELSE 'LEAD'::"ChannelMessageAuthor" END,
  'TEXT'::"ChannelMessageKind",
  left(t.elem->>'text', 8000),
  c."created_at" + ((t.ord - 1) * interval '1 millisecond')
FROM "joana_conversations" c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(c."history"::jsonb) = 'array' THEN c."history"::jsonb
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS t(elem, ord)
WHERE coalesce(t.elem->>'text', '') <> '';
