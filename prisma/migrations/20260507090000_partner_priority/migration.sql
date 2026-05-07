-- Partner priority within category (admin-managed)
ALTER TABLE "partners"
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

