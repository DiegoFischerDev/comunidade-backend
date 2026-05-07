-- Partner priority within category (admin-managed)
ALTER TABLE "Partner"
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

