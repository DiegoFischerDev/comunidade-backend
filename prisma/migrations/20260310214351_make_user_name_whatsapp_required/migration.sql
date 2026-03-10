/*
  Warnings:

  - Made the column `name` on table `User` required. This step will fail if there are existing NULL values in that column.
  - Made the column `whatsapp` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- Preencher NULLs existentes antes de tornar as colunas obrigatórias
UPDATE "User" SET "name" = '' WHERE "name" IS NULL;
UPDATE "User" SET "whatsapp" = '' WHERE "whatsapp" IS NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "whatsapp" SET NOT NULL;
