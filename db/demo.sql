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
\echo '--- STEP 1. Tables: beds (Patient, Ward, Admission) and alerts (Nurse, NurseAssignment, WardAlert, AlertEvent) ---'
\dt
SELECT 'Patient' AS "Table", COUNT(*) AS "Rows" FROM "Patient"
UNION ALL SELECT 'Ward', COUNT(*) FROM "Ward"
UNION ALL SELECT 'Admission', COUNT(*) FROM "Admission"
UNION ALL SELECT 'Nurse', COUNT(*) FROM "Nurse"
UNION ALL SELECT 'NurseAssignment', COUNT(*) FROM "NurseAssignment"
UNION ALL SELECT 'WardAlert', COUNT(*) FROM "WardAlert"
UNION ALL SELECT 'AlertEvent', COUNT(*) FROM "AlertEvent";
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
\echo '--- STEP 6. Transfer: move Kuanyshbek (ID 3) from Ward 102 to Surgery Ward 103, then discharge ---'
\echo 'Before:'
SELECT "AdmissionID", "WardID", "AdmitDate", "DischargeDate", "Status"
FROM "Admission" WHERE "PatientID" = 3 ORDER BY "AdmissionID";
CALL sp_AdmitPatient(3, 103);
\echo 'After (old admission closed automatically, only one Active):'
SELECT "AdmissionID", "WardID", "AdmitDate", "DischargeDate", "Status"
FROM "Admission" WHERE "PatientID" = 3 ORDER BY "AdmissionID";
\echo 'Discharge Kuanyshbek (ID 3):'
CALL sp_DischargePatient(3);
SELECT "AdmissionID", "WardID", "AdmitDate", "DischargeDate", "Status"
FROM "Admission" WHERE "PatientID" = 3 ORDER BY "AdmissionID";
\echo 'Discharging again -> rejected (no active admission):'
CALL sp_DischargePatient(3);
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
\echo '--- STEP 8. Nurse workstation (Lab 04): alert, escalation after 30 s, acknowledgement ---'
\echo 'Open alerts:'
SELECT "AlertID", "Priority", "Status", "WardID", "AssignedNurseID", "EscalatedToNurseID",
       EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - "CreatedAt")::INT AS "AgeSeconds"
FROM "WardAlert" WHERE "Status" <> 'ACKNOWLEDGED' ORDER BY "AlertID";
\echo 'a) Monitor of patient 1 raises a CRITICAL alert, sent to the primary nurse of Ward 101:'
CALL sp_RaiseAlert(101, 1, 'MONITOR', 'CRITICAL', 'SpO2 83%', 'NURSE-01', NULL);
\echo 'b) Escalating a fresh alert -> rejected (escalation only after 30 s):'
CALL sp_EscalateAlert('ALT-1007', 'NURSE-03');
\echo 'c) ALT-1001 is 5 minutes old and still PENDING. Escalate to a Busy nurse -> rejected:'
CALL sp_EscalateAlert('ALT-1001', 'NURSE-02');
\echo '   Escalate to Available NURSE-03 -> accepted:'
CALL sp_EscalateAlert('ALT-1001', 'NURSE-03');
\echo 'd) NURSE-04 works in another ward -> cannot acknowledge:'
CALL sp_AcknowledgeAlert('ALT-1001', 'NURSE-04');
\echo '   NURSE-03 acknowledges:'
CALL sp_AcknowledgeAlert('ALT-1001', 'NURSE-03');
\echo 'e) Journal of ALT-1001 (written by a trigger, cannot be changed):'
SELECT "OccurredAt", "EventType", "NurseID"
FROM "AlertEvent" WHERE "AlertID" = 'ALT-1001' ORDER BY "EventID";
\echo '   Deleting the journal -> rejected:'
DELETE FROM "AlertEvent" WHERE "AlertID" = 'ALT-1001';
\echo 'f) Head nurse report: response time of acknowledged alerts:'
SELECT "AlertID", "Priority", "AssignedNurseID", "AcknowledgedByNurseID",
       "AcknowledgedAt" - "CreatedAt" AS "ResponseTime",
       "EscalatedToNurseID" IS NOT NULL AS "WasEscalated"
FROM "WardAlert" WHERE "Status" = 'ACKNOWLEDGED' ORDER BY "CreatedAt";
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- STEP 9. Security: each role sees and does only its own part ---'
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
\echo '...but cannot acknowledge alerts (denied):'
CALL sp_AcknowledgeAlert('ALT-1005', 'NURSE-02');
RESET ROLE;
\echo 'Nurses (medbase_nurse) acknowledge alerts, but cannot read PIN hashes or edit alerts directly:'
SET ROLE medbase_nurse;
CALL sp_AcknowledgeAlert('ALT-1005', 'NURSE-02');
SELECT "PinHash" FROM "Nurse";
UPDATE "WardAlert" SET "Status" = 'PENDING' WHERE "AlertID" = 'ALT-1005';
RESET ROLE;
\prompt 'Press Enter...' _

-- -----------------------------------------------------------------------------
\echo
\echo '--- FINAL. Ward occupancy after the demo ---'
SELECT "WardID", "WardName", "Capacity", "CurrentOccupancy", "AvailableBeds"
FROM "vw_WardCapacity" ORDER BY "WardID";

\echo 'Demo finished. Run it again to start from the seed data.'
