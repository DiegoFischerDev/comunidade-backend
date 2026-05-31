-- CreateTable
CREATE TABLE "job_offers" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_offers_active_published_at_idx" ON "job_offers"("active", "published_at" DESC);
