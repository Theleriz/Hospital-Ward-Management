-- Nurse location for escalation and the ward map (decisions.md, record 14).
-- Run as DB owner on an existing database; stop the old backend first, then start the new one.
-- Additive and re-runnable: existing patients, alerts, accounts and locks survive.
-- Run:  psql -v ON_ERROR_STOP=1 -f db/migrations/20261119_nurse_location.sql
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE "Nurse" ADD COLUMN IF NOT EXISTS "CurrentWardID" INT REFERENCES "Ward"("WardID") ON DELETE RESTRICT;
ALTER TABLE "Nurse" ADD COLUMN IF NOT EXISTS "LocationAt" TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CK_Nurse_Location') THEN
        ALTER TABLE "Nurse" ADD CONSTRAINT "CK_Nurse_Location"
            CHECK (("CurrentWardID" IS NULL) = ("LocationAt" IS NULL));
    END IF;
END;
$$;

-- New sp_SetNurseLocation, sp_SetNurseStatus that forgets the location, new grants
\ir ../02_procedures.sql
\ir ../03_security.sql

COMMIT;
