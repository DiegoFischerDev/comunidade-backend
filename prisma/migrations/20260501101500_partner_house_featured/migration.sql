ALTER TABLE "partner_houses"
ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "partner_houses_featured_idx" ON "partner_houses"("featured");
