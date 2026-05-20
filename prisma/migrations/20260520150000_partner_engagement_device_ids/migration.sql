-- Reações: visitantes por dispositivo (UUID), utilizadores por user_id.
DROP INDEX IF EXISTS "partner_reaction_user_partner_unique";

ALTER TABLE "partner_reactions" ADD COLUMN "device_id" VARCHAR(64);
ALTER TABLE "partner_reactions" ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "partner_reactions" DROP CONSTRAINT IF EXISTS "partner_reactions_actor_check";
ALTER TABLE "partner_reactions" ADD CONSTRAINT "partner_reactions_actor_check" CHECK (
  ("user_id" IS NOT NULL AND "device_id" IS NULL)
  OR ("user_id" IS NULL AND "device_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "partner_reaction_user_partner_unique" ON "partner_reactions" ("partner_id", "user_id")
WHERE "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "partner_reaction_device_partner_unique" ON "partner_reactions" ("partner_id", "device_id")
WHERE "device_id" IS NOT NULL;

-- Comentários: visitantes com nome opcional, um comentário por dispositivo por parceiro.
ALTER TABLE "partner_comments" ADD COLUMN "device_id" VARCHAR(64);
ALTER TABLE "partner_comments" ADD COLUMN "guest_name" VARCHAR(120);
ALTER TABLE "partner_comments" ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "partner_comments" DROP CONSTRAINT IF EXISTS "partner_comments_author_check";
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_author_check" CHECK (
  ("user_id" IS NOT NULL AND "device_id" IS NULL)
  OR ("user_id" IS NULL AND "device_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "partner_comment_device_partner_unique" ON "partner_comments" ("partner_id", "device_id")
WHERE "device_id" IS NOT NULL;
