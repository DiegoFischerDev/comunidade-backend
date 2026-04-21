-- Foto principal para OG / listagens (opcional; fallback = primeira de image_urls)
ALTER TABLE "partner_houses" ADD COLUMN IF NOT EXISTS "cover_image_url" TEXT;
