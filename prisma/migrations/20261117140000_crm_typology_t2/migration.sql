-- Tipologia em falta no CRM: T2 (dois quartos), entre T1 e T3.
ALTER TYPE "RafaCallCrmPropertyTypology" ADD VALUE IF NOT EXISTS 'T2' AFTER 'T1';
