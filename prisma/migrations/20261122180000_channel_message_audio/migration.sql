-- AlterEnum
ALTER TYPE "ChannelMessageKind" ADD VALUE IF NOT EXISTS 'AUDIO';

-- AlterTable
ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "media_url" VARCHAR(512);
