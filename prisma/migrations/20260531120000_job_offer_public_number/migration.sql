-- ID público numérico para URLs curtas (/ofertas-trabalho/12)
ALTER TABLE "job_offers" ADD COLUMN "public_number" SERIAL NOT NULL;

CREATE UNIQUE INDEX "job_offers_public_number_key" ON "job_offers"("public_number");
