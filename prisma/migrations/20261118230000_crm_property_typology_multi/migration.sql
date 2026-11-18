-- Tipologia passa a aceitar várias opções (ex.: T2 e T3).
ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_property_typology" DROP DEFAULT;

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_property_typology" TYPE "RafaCallCrmPropertyTypology"[]
  USING (
    CASE
      WHEN "crm_property_typology" IS NULL THEN ARRAY[]::"RafaCallCrmPropertyTypology"[]
      ELSE ARRAY["crm_property_typology"]::"RafaCallCrmPropertyTypology"[]
    END
  );

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_property_typology" SET DEFAULT ARRAY[]::"RafaCallCrmPropertyTypology"[];

ALTER TABLE "rafa_call_bookings"
  ALTER COLUMN "crm_property_typology" SET NOT NULL;

ALTER TABLE "crm_leads"
  ALTER COLUMN "crm_property_typology" DROP DEFAULT;

ALTER TABLE "crm_leads"
  ALTER COLUMN "crm_property_typology" TYPE "RafaCallCrmPropertyTypology"[]
  USING (
    CASE
      WHEN "crm_property_typology" IS NULL THEN ARRAY[]::"RafaCallCrmPropertyTypology"[]
      ELSE ARRAY["crm_property_typology"]::"RafaCallCrmPropertyTypology"[]
    END
  );

ALTER TABLE "crm_leads"
  ALTER COLUMN "crm_property_typology" SET DEFAULT ARRAY[]::"RafaCallCrmPropertyTypology"[];

ALTER TABLE "crm_leads"
  ALTER COLUMN "crm_property_typology" SET NOT NULL;
