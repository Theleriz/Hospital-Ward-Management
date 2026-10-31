-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- Live demo: step-by-step walkthrough of the database for the presentation
-- Requires: setup.sql (schema + procedures + security)
-- Starts by reloading 04_seed.sql, so it can be re-run any time.
-- Run (interactive, pauses between steps):
--   docker exec -it medbase-postgres psql -U medbase -d hospital_ward -f /db/demo.sql
-- Errors in this script are EXPECTED: they show the business rules working.
-- =============================================================================

\set ON_ERROR_STOP off
\set VERBOSITY terse

\set QUIET on
\ir 04_seed.sql
\set QUIET off

\echo
\echo '=============================================================='
\echo ' Hospital Ward Management - Team MedBase'
\echo ' Main action: admitting a patient and assigning them to a ward'
\echo '=============================================================='
\prompt 'Press Enter to start...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 1. Tables (Patient, Ward, Admission + WardAlert) ---'
\dt
SELECT 'Patient' AS "Table", COUNT(*) AS "Rows" FROM "Patient"
UNION ALL SELECT 'Ward', COUNT(*) FROM "Ward"
UNION ALL SELECT 'Admission', COUNT(*) FROM "Admission"
UNION ALL SELECT 'WardAlert', COUNT(*) FROM "WardAlert";
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 2. Business query: who is admitted right now and where ---'
SELECT "Patient"."FullName", "Ward"."WardName"
FROM "Patient"
JOIN "Admission" ON "Patient"."PatientID" = "Admission"."PatientID"
JOIN "Ward" ON "Admission"."WardID" = "Ward"."WardID"
WHERE "Admission"."Status" = 'Active';

\echo 'Ward occupancy (managers use this to redirect new patients):'
SELECT "WardID", "WardName", "Capacity", "CurrentOccupancy", "AvailableBeds"
FROM "vw_WardCapacity" ORDER BY "WardID";
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 3. Main action: admit Kazbek Shynbulat (ID 7) to General Ward 102 ---'
CALL sp_AdmitPatient(7, 102);
SELECT "WardID", "WardName", "CurrentOccupancy", "AvailableBeds"
FROM "vw_WardCapacity" WHERE "WardID" = 102;
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 4. Business rules inside the procedure ---'
\echo 'a) ICU Ward 101 is full (2/2) -> admission is rejected:'
CALL sp_AdmitPatient(8, 101);
\echo 'b) Patient 1 is already in Ward 101 -> rejected:'
CALL sp_AdmitPatient(1, 101);
\echo 'c) Patient that does not exist -> rejected:'
CALL sp_AdmitPatient(999, 104);
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 5. Data rules (constraints) protect the tables directly ---'
\echo 'a) Capacity must be > 0:'
INSERT INTO "Ward" VALUES (200, 'Broken Ward', 1, 0, 'Surgery');
\echo 'b) Status can only be Active or Discharged:'
UPDATE "Admission" SET "Status" = 'Unknown' WHERE "AdmissionID" = 1;
\echo 'c) Admission without a valid patient (foreign key):'
INSERT INTO "Admission" ("PatientID", "WardID") VALUES (999, 104);
\echo 'd) ON DELETE RESTRICT: a ward with admission history cannot be deleted:'
DELETE FROM "Ward" WHERE "WardID" = 101;
\echo 'e) A patient cannot be Active in two wards at once:'
INSERT INTO "Admission" ("PatientID", "WardID") VALUES (1, 104);
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 6. Transfer: move Kuanyshbek (ID 3) from Ward 102 to Surgery Ward 103 ---'
\echo 'Before:'
SELECT "AdmissionID", "WardID", "AdmitDate", "Status"
FROM "Admission" WHERE "PatientID" = 3 ORDER BY "AdmissionID";
CALL sp_AdmitPatient(3, 103);
\echo 'After (old admission closed automatically, only one Active):'
SELECT "AdmissionID", "WardID", "AdmitDate", "Status"
FROM "Admission" WHERE "PatientID" = 3 ORDER BY "AdmissionID";
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 7. Transaction: register a NEW patient + admit in one step ---'
\echo 'a) Dana Seitkali -> Emergency Ward 104 (succeeds):'
CALL sp_RegisterAndAdmitPatient('Dana Seitkali', '1990-02-14', '+77015550109', 'Female', 104);
\echo 'b) Timur Abenov -> ICU Ward 101, which is full (fails):'
CALL sp_RegisterAndAdmitPatient('Timur Abenov', '1983-09-09', '+77015550110', 'Male', 101);
\echo 'Rollback check: Dana is saved, Timur was NOT left without an admission:'
SELECT p."PatientID", p."FullName", a."WardID", a."Status"
FROM "Patient" p
LEFT JOIN "Admission" a ON a."PatientID" = p."PatientID" AND a."Status" = 'Active'
WHERE p."Phone" IN ('+77015550109', '+77015550110');
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 8. Nurse workstation (Lab 04): acknowledge a CRITICAL alert ---'
\echo 'Open alerts:'
SELECT "AlertID", "Priority", "Status", "NurseID"
FROM "WardAlert" WHERE "Status" <> 'ACKNOWLEDGED' ORDER BY "AlertID";
CALL sp_AcknowledgeAlert('ALT-1001', 'NURSE-03');
\echo 'Open alerts after acknowledgement:'
SELECT "AlertID", "Priority", "Status", "NurseID"
FROM "WardAlert" WHERE "Status" <> 'ACKNOWLEDGED' ORDER BY "AlertID";
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 9. Security: public staff only see ward capacity ---'
SET ROLE medbase_public_staff;
\echo 'a) Ward capacity view (allowed):'
SELECT "WardName", "AvailableBeds" FROM "vw_WardCapacity" ORDER BY "WardID";
\echo 'b) Patient table (denied):'
SELECT * FROM "Patient";
\echo 'c) Admitting a patient (denied):'
CALL sp_AdmitPatient(5, 103);
RESET ROLE;
\echo 'Doctors / admissions staff (medbase_admissions) CAN admit:'
SET ROLE medbase_admissions;
CALL sp_AdmitPatient(5, 103);
RESET ROLE;
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- FINAL. Ward occupancy after the demo ---'
SELECT "WardID", "WardName", "Capacity", "CurrentOccupancy", "AvailableBeds"
FROM "vw_WardCapacity" ORDER BY "WardID";

\echo 'Demo finished. Run it again to start from the seed data.'
