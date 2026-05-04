-- CreateEnum
CREATE TYPE "GrupoTesteMessageStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "grupo_teste_messages" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image_urls" TEXT[],
    "video_url" TEXT,
    "target_group_jid" VARCHAR(160),
    "status" "GrupoTesteMessageStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "whatsapp_error" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grupo_teste_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "grupo_teste_messages_created_at_idx" ON "grupo_teste_messages"("created_at");

ALTER TABLE "grupo_teste_messages" ADD CONSTRAINT "grupo_teste_messages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
