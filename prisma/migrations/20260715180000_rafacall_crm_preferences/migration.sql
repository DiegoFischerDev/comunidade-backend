-- Preferências de imóvel no CRM (tipologia, cidade, PET)
CREATE TYPE "RafaCallCrmPropertyTypology" AS ENUM ('QUARTO', 'T0', 'T1', 'T3', 'T4', 'T5');

ALTER TABLE "rafa_call_bookings"
  ADD COLUMN "crm_property_typology" "RafaCallCrmPropertyTypology",
  ADD COLUMN "crm_preferred_city" TEXT,
  ADD COLUMN "crm_has_pet" BOOLEAN;
