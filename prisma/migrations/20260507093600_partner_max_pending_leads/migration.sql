-- Partner max pending leads (admin-managed). 0 = unlimited.
ALTER TABLE "partners"
ADD COLUMN "max_pending_leads" INTEGER NOT NULL DEFAULT 0;

