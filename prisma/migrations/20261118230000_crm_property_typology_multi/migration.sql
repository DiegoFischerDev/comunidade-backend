-- Tipologia passa a aceitar várias opções (ex.: T2 e T3).
-- Idempotente: se a coluna já for array (retry após falha parcial), não altera.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rafa_call_bookings'
      AND column_name = 'crm_property_typology'
      AND udt_name = 'RafaCallCrmPropertyTypology'
  ) THEN
    ALTER TABLE "rafa_call_bookings"
      ALTER COLUMN "crm_property_typology" DROP DEFAULT;

    ALTER TABLE "rafa_call_bookings"
      ALTER COLUMN "crm_property_typology" TYPE "RafaCallCrmPropertyTypology"[]
      USING (
        CASE
          WHEN "crm_property_typology" IS NULL THEN ARRAY[]::"RafaCallCrmPropertyTypology"[]
          ELSE ARRAY["crm_property_typology"]
        END
      );

    ALTER TABLE "rafa_call_bookings"
      ALTER COLUMN "crm_property_typology" SET DEFAULT ARRAY[]::"RafaCallCrmPropertyTypology"[];

    ALTER TABLE "rafa_call_bookings"
      ALTER COLUMN "crm_property_typology" SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_leads'
      AND column_name = 'crm_property_typology'
      AND udt_name = 'RafaCallCrmPropertyTypology'
  ) THEN
    ALTER TABLE "crm_leads"
      ALTER COLUMN "crm_property_typology" DROP DEFAULT;

    ALTER TABLE "crm_leads"
      ALTER COLUMN "crm_property_typology" TYPE "RafaCallCrmPropertyTypology"[]
      USING (
        CASE
          WHEN "crm_property_typology" IS NULL THEN ARRAY[]::"RafaCallCrmPropertyTypology"[]
          ELSE ARRAY["crm_property_typology"]
        END
      );

    ALTER TABLE "crm_leads"
      ALTER COLUMN "crm_property_typology" SET DEFAULT ARRAY[]::"RafaCallCrmPropertyTypology"[];

    ALTER TABLE "crm_leads"
      ALTER COLUMN "crm_property_typology" SET NOT NULL;
  END IF;
END $$;
