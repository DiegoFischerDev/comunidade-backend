-- Página pública só existe quando o parceiro define um slug (Minha empresa).
ALTER TABLE "Partner" ALTER COLUMN "public_slug" DROP NOT NULL;
