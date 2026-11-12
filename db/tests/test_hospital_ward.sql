-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- Automated tests: constraints, procedures, transfers, transaction rollback, roles
-- Requires: setup.sql (schema + procedures + security + seed)
-- Everything runs inside one transaction and is ROLLED BACK at the end,
-- so the database is left exactly as it was.
-- Run:  psql -v ON_ERROR_STOP=1 -f tests/test_hospital_ward.sql
-- Stops at the first FAIL; prints "ALL TESTS PASSED" on success.
-- =============================================================================

\set QUIET on
BEGIN;

-- Hide procedure NOTICEs; test results are printed as INFO (always shown)
SET LOCAL client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- Test helpers (temporary, disappear with the session)
-- -----------------------------------------------------------------------------

-- Statement must succeed (optionally as another role)
CREATE PROCEDURE pg_temp.expect_ok(p_name TEXT, p_sql TEXT, p_role TEXT DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_role IS NOT NULL THEN
        EXECUTE format('SET LOCAL ROLE %I', p_role);
    END IF;
    EXECUTE p_sql;
    RESET ROLE;
    RAISE INFO 'PASS  %', p_name;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL  %: unexpected error: %', p_name, SQLERRM;
END;
$$;

-- Statement must fail with an error message matching p_pattern (LIKE)
CREATE PROCEDURE pg_temp.expect_error(p_name TEXT, p_sql TEXT, p_pattern TEXT, p_role TEXT DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        IF p_role IS NOT NULL THEN
            EXECUTE format('SET LOCAL ROLE %I', p_role);
        END IF;
        EXECUTE p_sql;
        RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE p_pattern THEN
            RAISE INFO 'PASS  %', p_name;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL  %: expected error like "%", got: %', p_name, p_pattern, SQLERRM;
    END;
    RAISE EXCEPTION 'FAIL  %: expected error like "%", but statement succeeded', p_name, p_pattern;
END;
$$;

-- Query must return TRUE
CREATE PROCEDURE pg_temp.expect_true(p_name TEXT, p_sql TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    v_Result BOOLEAN;
BEGIN
    EXECUTE p_sql INTO v_Result;
    IF v_Result IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'FAIL  %: condition is not true: %', p_name, p_sql;
    END IF;
    RAISE INFO 'PASS  %', p_name;
END;
$$;

-- Alert numbers are not rolled back with the transaction, so a previous test run
-- may have used some; continue right after the existing alerts (ALT-1007 next)
DO $$
BEGIN
    PERFORM setval('"WardAlert_AlertNo_seq"', (SELECT MAX(substr("AlertID", 5)::INT) FROM "WardAlert"));
END;
$$;

-- -----------------------------------------------------------------------------
-- 0. Seed state
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_true('seed: 8 patients, 4 wards, 6 admissions, 6 nurses, 7 assignments, 6 alerts', $q$
    SELECT (SELECT COUNT(*) FROM "Patient") = 8
       AND (SELECT COUNT(*) FROM "Ward") = 4
       AND (SELECT COUNT(*) FROM "Admission") = 6
       AND (SELECT COUNT(*) FROM "Nurse") = 6
       AND (SELECT COUNT(*) FROM "NurseAssignment") = 7
       AND (SELECT COUNT(*) FROM "WardAlert") = 6 $q$);

CALL pg_temp.expect_true('seed: alert journal has 17 events written by the trigger', $q$
    SELECT COUNT(*) = 17 FROM "AlertEvent" $q$);

-- Head nurse report on the seed alerts (UC-8): response time = acknowledgement - creation
CALL pg_temp.expect_true('report: response time of acknowledged alerts (12 s, 45 s, 50 s)', $q$
    SELECT array_agg(ROW("AlertID", "ResponseSeconds")::TEXT ORDER BY "AlertID")
           = ARRAY['(ALT-1002,12.0)', '(ALT-1004,45.0)', '(ALT-1006,50.0)']
    FROM "vw_AlertResponse" WHERE "Status" = 'ACKNOWLEDGED' $q$);

CALL pg_temp.expect_true('report: unacknowledged alerts have no response time', $q$
    SELECT bool_and("ResponseTime" IS NULL AND "ResponseSeconds" IS NULL)
    FROM "vw_AlertResponse" WHERE "Status" <> 'ACKNOWLEDGED' $q$);

CALL pg_temp.expect_true('report: 2 escalated alerts (ALT-1003, ALT-1006) with recipient names', $q$
    SELECT array_agg(ROW("AlertID", "EscalatedToNurseName")::TEXT ORDER BY "AlertID")
           = ARRAY['(ALT-1003,"Madina Tulegenova")', '(ALT-1006,"Aliya Nurlanova")']
    FROM "vw_AlertResponse" WHERE "WasEscalated" $q$);

CALL pg_temp.expect_true('report: one row per alert, no patient data', $q$
    SELECT (SELECT COUNT(*) FROM "vw_AlertResponse") = (SELECT COUNT(*) FROM "WardAlert")
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'vw_AlertResponse' AND column_name ILIKE '%patient%') $q$);

CALL pg_temp.expect_true('seed: every ward has a primary nurse', $q$
    SELECT COUNT(*) = 4 FROM "NurseAssignment" WHERE "IsPrimary" $q$);

CALL pg_temp.expect_true('seed: nurse PINs are bcrypt hashes of the documented test PINs', $q$
    SELECT bool_and("PinHash" = crypt(p.pin, "PinHash"))
    FROM "Nurse" n
    JOIN (VALUES ('NURSE-01', '1111'), ('NURSE-02', '2222'), ('NURSE-03', '3333'),
                 ('NURSE-04', '4444'), ('NURSE-05', '5555'), ('NURSE-10', '1010')) p(id, pin)
      ON p.id = n."NurseID" $q$);

CALL pg_temp.expect_true('view: ward 101 is full, ward 102 has 2 free beds', $q$
    SELECT (SELECT "AvailableBeds" FROM "vw_WardCapacity" WHERE "WardID" = 101) = 0
       AND (SELECT "AvailableBeds" FROM "vw_WardCapacity" WHERE "WardID" = 102) = 2 $q$);

-- -----------------------------------------------------------------------------
-- 1. Constraints (PK / FK / CHECK / UNIQUE / NOT NULL)
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_error('Ward.Capacity must be > 0', $q$
    INSERT INTO "Ward" VALUES (200, 'Bad Ward', 1, 0, 'Surgery') $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('Ward.WardType is required', $q$
    INSERT INTO "Ward" VALUES (200, 'Bad Ward', 1, 2, NULL) $q$,
    '%violates not-null constraint%');

-- WardType validation: allowed values must be accepted
CALL pg_temp.expect_ok('Ward.WardType accepts a valid category', $q$
    INSERT INTO "Ward"
        ("WardID", "WardName", "FloorNum", "Capacity", "WardType")
    VALUES (201, 'Test Surgery Ward', 2, 5, 'Surgery')
$q$);

-- WardType validation: unknown values must be rejected
CALL pg_temp.expect_error('Ward.WardType rejects an invalid category', $q$
    INSERT INTO "Ward"
        ("WardID", "WardName", "FloorNum", "Capacity", "WardType")
    VALUES (202, 'Test Invalid Ward', 2, 5, 'RandomType')
$q$, '%violates check constraint "CK_Ward_ValidType"%');

CALL pg_temp.expect_error('Patient.DOB is required', $q$
    INSERT INTO "Patient" ("FullName", "Phone") VALUES ('No DOB', '+70000000001') $q$,
    '%violates not-null constraint%');

CALL pg_temp.expect_error('Patient.Phone is unique', $q$
    INSERT INTO "Patient" ("FullName", "DOB", "Phone") VALUES ('Dup', '2000-01-01', '+77015550101') $q$,
    '%duplicate key%');

CALL pg_temp.expect_error('Admission.Status only Active/Discharged', $q$
    UPDATE "Admission" SET "Status" = 'Transferred' WHERE "AdmissionID" = 1 $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('Admission FK: patient must exist', $q$
    INSERT INTO "Admission" ("PatientID", "WardID") VALUES (999, 104) $q$,
    '%violates foreign key constraint%');

CALL pg_temp.expect_error('ON DELETE RESTRICT: ward with admissions', $q$
    DELETE FROM "Ward" WHERE "WardID" = 101 $q$,
    '%violates foreign key constraint%');

CALL pg_temp.expect_error('ON DELETE RESTRICT: patient with admissions', $q$
    DELETE FROM "Patient" WHERE "PatientID" = 1 $q$,
    '%violates foreign key constraint%');

CALL pg_temp.expect_error('one Active admission per patient (direct insert)', $q$
    INSERT INTO "Admission" ("PatientID", "WardID") VALUES (1, 104) $q$,
    '%duplicate key%UX_Admission_OneActivePerPatient%');

CALL pg_temp.expect_error('Discharged admission requires DischargeDate', $q$
    UPDATE "Admission" SET "Status" = 'Discharged' WHERE "AdmissionID" = 1 $q$,
    '%violates check constraint "CK_Admission_DischargeDate"%');

CALL pg_temp.expect_error('DischargeDate cannot be before AdmitDate', $q$
    UPDATE "Admission" SET "DischargeDate" = "AdmitDate" - 1 WHERE "AdmissionID" = 5 $q$,
    '%violates check constraint "CK_Admission_DischargeDate"%');

CALL pg_temp.expect_error('Nurse.Status only Available/Busy/OffShift', $q$
    UPDATE "Nurse" SET "Status" = 'Sleeping' WHERE "NurseID" = 'NURSE-01' $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('Nurse.BadgeID is unique', $q$
    INSERT INTO "Nurse" ("NurseID", "FullName", "BadgeID", "PinHash")
    VALUES ('NURSE-99', 'Dup Badge', 'BADGE-1001', crypt('9999', gen_salt('bf'))) $q$,
    '%duplicate key%');

CALL pg_temp.expect_error('Nurse.PinHash rejects a plain-text PIN', $q$
    INSERT INTO "Nurse" ("NurseID", "FullName", "BadgeID", "PinHash")
    VALUES ('NURSE-99', 'Plain Pin', 'BADGE-9999', '9999') $q$,
    '%violates check constraint "CK_Nurse_PinIsBcrypt"%');

CALL pg_temp.expect_error('one primary nurse per ward', $q$
    UPDATE "NurseAssignment" SET "IsPrimary" = TRUE WHERE "NurseID" = 'NURSE-02' AND "WardID" = 101 $q$,
    '%duplicate key%UX_NurseAssignment_OnePrimaryPerWard%');

CALL pg_temp.expect_error('NurseAssignment FK: nurse must exist', $q$
    INSERT INTO "NurseAssignment" ("NurseID", "WardID") VALUES ('NURSE-99', 101) $q$,
    '%violates foreign key constraint%');

CALL pg_temp.expect_error('WardAlert.Priority only LOW/HIGH/CRITICAL', $q$
    UPDATE "WardAlert" SET "Priority" = 'URGENT' WHERE "AlertID" = 'ALT-1001' $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('WardAlert.Source only MONITOR/CALL_BUTTON', $q$
    UPDATE "WardAlert" SET "Source" = 'PHONE' WHERE "AlertID" = 'ALT-1001' $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('WardAlert FK: assigned nurse must exist', $q$
    UPDATE "WardAlert" SET "AssignedNurseID" = 'NURSE-99' WHERE "AlertID" = 'ALT-1001' $q$,
    '%violates foreign key constraint%');

CALL pg_temp.expect_error('ACKNOWLEDGED alert requires nurse and time', $q$
    UPDATE "WardAlert" SET "Status" = 'ACKNOWLEDGED' WHERE "AlertID" = 'ALT-1001' $q$,
    '%violates check constraint "CK_WardAlert_Acknowledged"%');

CALL pg_temp.expect_error('ESCALATED alert requires target nurse and time', $q$
    UPDATE "WardAlert" SET "Status" = 'ESCALATED' WHERE "AlertID" = 'ALT-1001' $q$,
    '%violates check constraint "CK_WardAlert_Escalated"%');

CALL pg_temp.expect_error('LOW alert can never be escalated', $q$
    UPDATE "WardAlert" SET "EscalatedToNurseID" = 'NURSE-01', "EscalatedAt" = "CreatedAt" + INTERVAL '30 seconds'
    WHERE "AlertID" = 'ALT-1004' $q$,
    '%violates check constraint "CK_WardAlert_NoLowEscalation"%');

CALL pg_temp.expect_error('alert cannot be acknowledged before it was created', $q$
    UPDATE "WardAlert" SET "AcknowledgedAt" = "CreatedAt" - INTERVAL '1 second'
    WHERE "AlertID" = 'ALT-1002' $q$,
    '%violates check constraint "CK_WardAlert_Timeline"%');

CALL pg_temp.expect_error('AlertEvent journal: rows cannot be changed', $q$
    UPDATE "AlertEvent" SET "NurseID" = 'NURSE-04' WHERE "EventID" = 1 $q$,
    'AlertEvent is append-only: UPDATE%');

CALL pg_temp.expect_error('AlertEvent journal: rows cannot be deleted', $q$
    DELETE FROM "AlertEvent" WHERE "EventID" = 1 $q$,
    'AlertEvent is append-only: DELETE%');

CALL pg_temp.expect_error('ON DELETE RESTRICT: alert with journal entries', $q$
    DELETE FROM "WardAlert" WHERE "AlertID" = 'ALT-1001' $q$,
    '%violates foreign key constraint%');

-- -----------------------------------------------------------------------------
-- 2. sp_AdmitPatient
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('admit patient 7 to ward 102', $q$ CALL sp_AdmitPatient(7, 102) $q$);

CALL pg_temp.expect_true('ward 102 occupancy is now 3', $q$
    SELECT "CurrentOccupancy" = 3 FROM "vw_WardCapacity" WHERE "WardID" = 102 $q$);

CALL pg_temp.expect_true('new admission is Active with today''s date', $q$
    SELECT "Status" = 'Active' AND "AdmitDate" = CURRENT_DATE
    FROM "Admission" WHERE "PatientID" = 7 $q$);

CALL pg_temp.expect_error('full ward is rejected', $q$ CALL sp_AdmitPatient(8, 101) $q$,
    'Ward ID 101 is full%');

CALL pg_temp.expect_error('same ward twice is rejected', $q$ CALL sp_AdmitPatient(1, 101) $q$,
    'Patient ID 1 is already admitted to Ward ID 101%');

CALL pg_temp.expect_error('unknown patient is rejected', $q$ CALL sp_AdmitPatient(999, 104) $q$,
    'Patient ID 999 does not exist%');

CALL pg_temp.expect_error('unknown ward is rejected', $q$ CALL sp_AdmitPatient(8, 999) $q$,
    'Ward ID 999 does not exist%');

-- -----------------------------------------------------------------------------
-- 3. Transfers (auto-close previous admission)
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('transfer patient 3 from ward 102 to 103', $q$ CALL sp_AdmitPatient(3, 103) $q$);

CALL pg_temp.expect_true('patient 3: old admission Discharged, only one Active (ward 103)', $q$
    SELECT (SELECT "Status" = 'Discharged' AND "DischargeDate" = CURRENT_DATE
            FROM "Admission" WHERE "AdmissionID" = 3)
       AND (SELECT array_agg("WardID") FROM "Admission"
            WHERE "PatientID" = 3 AND "Status" = 'Active') = ARRAY[103] $q$);

CALL pg_temp.expect_error('transfer into full ward is rejected', $q$ CALL sp_AdmitPatient(4, 101) $q$,
    'Ward ID 101 is full%');

CALL pg_temp.expect_true('failed transfer keeps patient 4 Active in ward 102', $q$
    SELECT "WardID" = 102 FROM "Admission" WHERE "PatientID" = 4 AND "Status" = 'Active' $q$);

-- -----------------------------------------------------------------------------
-- 4. sp_RegisterAndAdmitPatient (admission transaction)
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('register new patient and admit to ward 104', $q$
    CALL sp_RegisterAndAdmitPatient('Dana Seitkali', '1990-02-14', '+77015550109', 'Female', 104) $q$);

CALL pg_temp.expect_true('new patient exists and is Active in ward 104', $q$
    SELECT a."WardID" = 104
    FROM "Patient" p JOIN "Admission" a ON a."PatientID" = p."PatientID" AND a."Status" = 'Active'
    WHERE p."Phone" = '+77015550109' $q$);

CALL pg_temp.expect_ok('existing phone reuses patient 8', $q$
    CALL sp_RegisterAndAdmitPatient('Anna Petrova', '1988-06-18', '+77015550108', 'Female', 104) $q$);

CALL pg_temp.expect_true('no duplicate patient created, patient 8 Active in ward 104', $q$
    SELECT (SELECT COUNT(*) FROM "Patient" WHERE "Phone" = '+77015550108') = 1
       AND (SELECT "WardID" FROM "Admission" WHERE "PatientID" = 8 AND "Status" = 'Active') = 104 $q$);

CALL pg_temp.expect_error('new patient to full ward fails', $q$
    CALL sp_RegisterAndAdmitPatient('Timur Abenov', '1983-09-09', '+77015550110', 'Male', 101) $q$,
    'Ward ID 101 is full%');

CALL pg_temp.expect_true('rollback: failed registration left no patient behind', $q$
    SELECT NOT EXISTS (SELECT 1 FROM "Patient" WHERE "Phone" = '+77015550110') $q$);

-- -----------------------------------------------------------------------------
-- 5. sp_RaiseAlert
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('raise CRITICAL monitor alert for patient 1 in ward 101 (NURSE-01)', $q$
    CALL sp_RaiseAlert(101, 1, 'MONITOR', 'CRITICAL', 'SpO2 83%', 'NURSE-01', NULL) $q$);

CALL pg_temp.expect_true('ALT-1007 is PENDING, assigned to NURSE-01, journal has CREATED + ASSIGNED', $q$
    SELECT (SELECT "Status" = 'PENDING' AND "AssignedNurseID" = 'NURSE-01' AND "WardID" = 101
            FROM "WardAlert" WHERE "AlertID" = 'ALT-1007')
       AND (SELECT array_agg("EventType" ORDER BY "EventID") FROM "AlertEvent"
            WHERE "AlertID" = 'ALT-1007') = ARRAY['CREATED', 'ASSIGNED']::VARCHAR[] $q$);

CALL pg_temp.expect_ok('raise HIGH call-button alert in ward 104 without patient and nurse', $q$
    CALL sp_RaiseAlert(104, NULL, 'CALL_BUTTON', 'HIGH', 'Corridor call button', NULL, NULL) $q$);

CALL pg_temp.expect_true('ALT-1008 is unassigned, journal has only CREATED', $q$
    SELECT (SELECT "AssignedNurseID" IS NULL FROM "WardAlert" WHERE "AlertID" = 'ALT-1008')
       AND (SELECT array_agg("EventType") FROM "AlertEvent"
            WHERE "AlertID" = 'ALT-1008') = ARRAY['CREATED']::VARCHAR[] $q$);

CALL pg_temp.expect_error('raise: unknown ward is rejected', $q$
    CALL sp_RaiseAlert(999, NULL, 'MONITOR', 'HIGH', NULL, NULL, NULL) $q$,
    'Ward ID 999 does not exist%');

CALL pg_temp.expect_error('raise: patient not admitted to this ward is rejected', $q$
    CALL sp_RaiseAlert(102, 1, 'MONITOR', 'HIGH', NULL, 'NURSE-02', NULL) $q$,
    'Patient ID 1 is not admitted to Ward ID 102%');

CALL pg_temp.expect_error('raise: nurse from another ward is rejected', $q$
    CALL sp_RaiseAlert(101, 1, 'MONITOR', 'HIGH', NULL, 'NURSE-04', NULL) $q$,
    'Nurse NURSE-04 is not assigned to Ward ID 101%');

CALL pg_temp.expect_error('raise: off-shift nurse is rejected', $q$
    CALL sp_RaiseAlert(104, NULL, 'CALL_BUTTON', 'HIGH', NULL, 'NURSE-05', NULL) $q$,
    'Nurse NURSE-05 is off shift%');

CALL pg_temp.expect_error('raise: unknown nurse is rejected', $q$
    CALL sp_RaiseAlert(101, 1, 'MONITOR', 'HIGH', NULL, 'NURSE-99', NULL) $q$,
    'Nurse NURSE-99 does not exist%');

-- -----------------------------------------------------------------------------
-- 6. sp_EscalateAlert
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_error('escalate: alert younger than 30 s is rejected', $q$
    CALL sp_EscalateAlert('ALT-1007', 'NURSE-03') $q$,
    'Alert ID ALT-1007 is not overdue yet%');

-- A LOW alert that is already a minute old
CALL pg_temp.expect_ok('raise LOW alert ALT-1009', $q$
    CALL sp_RaiseAlert(102, 4, 'CALL_BUTTON', 'LOW', 'Blanket request', 'NURSE-02', NULL) $q$);

CALL pg_temp.expect_ok('make ALT-1009 1 minute old', $q$
    UPDATE "WardAlert" SET "CreatedAt" = CURRENT_TIMESTAMP - INTERVAL '1 minute'
    WHERE "AlertID" = 'ALT-1009' $q$);

CALL pg_temp.expect_error('escalate: LOW alert is rejected', $q$
    CALL sp_EscalateAlert('ALT-1009', 'NURSE-03') $q$,
    'Alert ID ALT-1009 has priority LOW%');

-- A failed insert still uses up an alert number, so this runs after ALT-1009 exists
CALL pg_temp.expect_error('raise: invalid priority is rejected', $q$
    CALL sp_RaiseAlert(101, 1, 'MONITOR', 'URGENT', NULL, 'NURSE-01', NULL) $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('escalate: Busy nurse is rejected', $q$
    CALL sp_EscalateAlert('ALT-1001', 'NURSE-02') $q$,
    'Nurse NURSE-02 is not Available (status Busy)%');

CALL pg_temp.expect_error('escalate: off-shift nurse is rejected', $q$
    CALL sp_EscalateAlert('ALT-1001', 'NURSE-05') $q$,
    'Nurse NURSE-05 is not Available (status OffShift)%');

CALL pg_temp.expect_error('escalate: the already assigned nurse is rejected', $q$
    CALL sp_EscalateAlert('ALT-1001', 'NURSE-01') $q$,
    'Nurse NURSE-01 is already assigned to alert ALT-1001%');

CALL pg_temp.expect_error('escalate: unknown nurse is rejected', $q$
    CALL sp_EscalateAlert('ALT-1001', 'NURSE-99') $q$,
    'Nurse NURSE-99 does not exist%');

CALL pg_temp.expect_error('escalate: unknown alert is rejected', $q$
    CALL sp_EscalateAlert('ALT-9999', 'NURSE-03') $q$,
    'Alert ID ALT-9999 does not exist%');

CALL pg_temp.expect_ok('escalate overdue CRITICAL ALT-1001 to Available NURSE-03', $q$
    CALL sp_EscalateAlert('ALT-1001', 'NURSE-03') $q$);

CALL pg_temp.expect_true('ALT-1001 is ESCALATED to NURSE-03, still assigned to NURSE-01, journal has ESCALATED', $q$
    SELECT (SELECT "Status" = 'ESCALATED' AND "EscalatedToNurseID" = 'NURSE-03'
                   AND "EscalatedAt" IS NOT NULL AND "AssignedNurseID" = 'NURSE-01'
            FROM "WardAlert" WHERE "AlertID" = 'ALT-1001')
       AND EXISTS (SELECT 1 FROM "AlertEvent"
                   WHERE "AlertID" = 'ALT-1001' AND "EventType" = 'ESCALATED' AND "NurseID" = 'NURSE-03') $q$);

CALL pg_temp.expect_error('escalate: already escalated alert is rejected', $q$
    CALL sp_EscalateAlert('ALT-1001', 'NURSE-04') $q$,
    'Alert ID ALT-1001 is not pending (status ESCALATED)%');

CALL pg_temp.expect_error('escalate: acknowledged alert is rejected', $q$
    CALL sp_EscalateAlert('ALT-1002', 'NURSE-04') $q$,
    'Alert ID ALT-1002 is not pending (status ACKNOWLEDGED)%');

-- -----------------------------------------------------------------------------
-- 7. sp_AcknowledgeAlert
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_true('seed: response time of ALT-1002 is 12 seconds', $q$
    SELECT "AcknowledgedAt" - "CreatedAt" = INTERVAL '12 seconds'
    FROM "WardAlert" WHERE "AlertID" = 'ALT-1002' $q$);

CALL pg_temp.expect_ok('escalation target NURSE-03 acknowledges ALT-1001', $q$
    CALL sp_AcknowledgeAlert('ALT-1001', 'NURSE-03') $q$);

CALL pg_temp.expect_true('ALT-1001 acknowledged by NURSE-03, assigned nurse NURSE-01 is kept, journal has ACKNOWLEDGED', $q$
    SELECT (SELECT "Status" = 'ACKNOWLEDGED' AND "AcknowledgedByNurseID" = 'NURSE-03'
                   AND "AcknowledgedAt" IS NOT NULL AND "AssignedNurseID" = 'NURSE-01'
            FROM "WardAlert" WHERE "AlertID" = 'ALT-1001')
       AND EXISTS (SELECT 1 FROM "AlertEvent"
                   WHERE "AlertID" = 'ALT-1001' AND "EventType" = 'ACKNOWLEDGED' AND "NurseID" = 'NURSE-03') $q$);

CALL pg_temp.expect_ok('assigned nurse NURSE-01 acknowledges ALT-1007', $q$
    CALL sp_AcknowledgeAlert('ALT-1007', 'NURSE-01') $q$);

CALL pg_temp.expect_ok('ward 101 colleague NURSE-02 acknowledges escalated ALT-1003', $q$
    CALL sp_AcknowledgeAlert('ALT-1003', 'NURSE-02') $q$);

CALL pg_temp.expect_ok('re-acknowledging ALT-1002 is a no-op', $q$
    CALL sp_AcknowledgeAlert('ALT-1002', 'NURSE-99') $q$);

CALL pg_temp.expect_true('ALT-1002 keeps original acknowledging nurse NURSE-02', $q$
    SELECT "AcknowledgedByNurseID" = 'NURSE-02' FROM "WardAlert" WHERE "AlertID" = 'ALT-1002' $q$);

CALL pg_temp.expect_error('acknowledge: nurse from another ward is rejected', $q$
    CALL sp_AcknowledgeAlert('ALT-1005', 'NURSE-04') $q$,
    'Nurse NURSE-04 cannot acknowledge alert ALT-1005%');

CALL pg_temp.expect_error('acknowledge: off-shift nurse is rejected', $q$
    CALL sp_AcknowledgeAlert('ALT-1005', 'NURSE-05') $q$,
    'Nurse NURSE-05 is off shift%');

CALL pg_temp.expect_error('acknowledge: unknown nurse is rejected', $q$
    CALL sp_AcknowledgeAlert('ALT-1005', 'NURSE-99') $q$,
    'Nurse NURSE-99 does not exist%');

CALL pg_temp.expect_error('acknowledge: unknown alert is rejected', $q$
    CALL sp_AcknowledgeAlert('ALT-9999', 'NURSE-01') $q$,
    'Alert ID ALT-9999 does not exist%');

-- -----------------------------------------------------------------------------
-- 8. sp_SetNurseStatus
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('NURSE-02 switches to Available', $q$
    CALL sp_SetNurseStatus('NURSE-02', 'Available') $q$);

CALL pg_temp.expect_true('NURSE-02 is Available', $q$
    SELECT "Status" = 'Available' FROM "Nurse" WHERE "NurseID" = 'NURSE-02' $q$);

CALL pg_temp.expect_error('set status: invalid status is rejected', $q$
    CALL sp_SetNurseStatus('NURSE-02', 'Sleeping') $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('set status: unknown nurse is rejected', $q$
    CALL sp_SetNurseStatus('NURSE-99', 'Busy') $q$,
    'Nurse NURSE-99 does not exist%');

-- -----------------------------------------------------------------------------
-- 9. sp_DischargePatient
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('discharge patient 4 from ward 102', $q$ CALL sp_DischargePatient(4) $q$);

CALL pg_temp.expect_true('patient 4: admission Discharged today, no Active admission left', $q$
    SELECT (SELECT "Status" = 'Discharged' AND "DischargeDate" = CURRENT_DATE
            FROM "Admission" WHERE "AdmissionID" = 4)
       AND NOT EXISTS (SELECT 1 FROM "Admission" WHERE "PatientID" = 4 AND "Status" = 'Active') $q$);

CALL pg_temp.expect_error('discharge: patient without active admission is rejected', $q$
    CALL sp_DischargePatient(4) $q$,
    'Patient ID 4 has no active admission%');

CALL pg_temp.expect_error('discharge: unknown patient is rejected', $q$
    CALL sp_DischargePatient(999) $q$,
    'Patient ID 999 does not exist%');

CALL pg_temp.expect_ok('discharged patient 4 can be admitted again', $q$ CALL sp_AdmitPatient(4, 104) $q$);

-- -----------------------------------------------------------------------------
-- 10. Security (roles)
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('public staff can read ward capacity view',
    $q$ SELECT * FROM "vw_WardCapacity" $q$, 'medbase_public_staff');

CALL pg_temp.expect_error('public staff cannot read Patient',
    $q$ SELECT * FROM "Patient" $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_error('public staff cannot read Admission',
    $q$ SELECT * FROM "Admission" $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_error('public staff cannot admit patients',
    $q$ CALL sp_AdmitPatient(5, 103) $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_ok('admissions staff can read Patient',
    $q$ SELECT * FROM "Patient" $q$, 'medbase_admissions');

CALL pg_temp.expect_ok('admissions staff can admit patients',
    $q$ CALL sp_AdmitPatient(5, 103) $q$, 'medbase_admissions');

CALL pg_temp.expect_ok('admissions staff can register and admit',
    $q$ CALL sp_RegisterAndAdmitPatient('Role Test', '2000-01-01', '+77015550111', 'Male', 103) $q$,
    'medbase_admissions');

CALL pg_temp.expect_error('admissions staff cannot delete patients',
    $q$ DELETE FROM "Patient" WHERE "PatientID" = 6 $q$, 'permission denied%', 'medbase_admissions');

CALL pg_temp.expect_error('admissions staff cannot change ward capacity',
    $q$ UPDATE "Ward" SET "Capacity" = 10 WHERE "WardID" = 101 $q$, 'permission denied%', 'medbase_admissions');

CALL pg_temp.expect_ok('admissions staff can discharge patients',
    $q$ CALL sp_DischargePatient(8) $q$, 'medbase_admissions');

CALL pg_temp.expect_error('public staff cannot discharge patients',
    $q$ CALL sp_DischargePatient(1) $q$, 'permission denied%', 'medbase_public_staff');

-- Alerts: nobody but nurses acknowledges, nobody writes alert tables directly
CALL pg_temp.expect_error('public staff cannot read alerts',
    $q$ SELECT * FROM "WardAlert" $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_error('public staff cannot acknowledge alerts',
    $q$ CALL sp_AcknowledgeAlert('ALT-1005', 'NURSE-02') $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_error('admissions staff cannot acknowledge alerts',
    $q$ CALL sp_AcknowledgeAlert('ALT-1005', 'NURSE-02') $q$, 'permission denied%', 'medbase_admissions');

CALL pg_temp.expect_ok('nurse can read alerts',
    $q$ SELECT * FROM "WardAlert" $q$, 'medbase_nurse');

-- Head nurse report (UC-8): only the head nurse reads the report and the journal (FR-31)
CALL pg_temp.expect_error('nurse cannot read the alert journal',
    $q$ SELECT * FROM "AlertEvent" $q$, 'permission denied%', 'medbase_nurse');

CALL pg_temp.expect_error('nurse cannot read the head nurse report',
    $q$ SELECT * FROM "vw_AlertResponse" $q$, 'permission denied%', 'medbase_nurse');

CALL pg_temp.expect_error('admissions staff cannot read the head nurse report',
    $q$ SELECT * FROM "vw_AlertResponse" $q$, 'permission denied%', 'medbase_admissions');

CALL pg_temp.expect_error('public staff cannot read the head nurse report',
    $q$ SELECT * FROM "vw_AlertResponse" $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_error('alert service cannot read the head nurse report',
    $q$ SELECT * FROM "vw_AlertResponse" $q$, 'permission denied%', 'medbase_alert_service');

CALL pg_temp.expect_ok('head nurse can read the report and the journal',
    $q$ SELECT * FROM "vw_AlertResponse" JOIN "AlertEvent" USING ("AlertID") $q$, 'medbase_head_nurse');

CALL pg_temp.expect_true('head nurse keeps every nurse right (inherits medbase_nurse)', $q$
    SELECT pg_has_role('medbase_head_nurse', 'medbase_nurse', 'USAGE')
       AND has_table_privilege('medbase_head_nurse', '"WardAlert"', 'SELECT')
       AND has_function_privilege('medbase_head_nurse', 'sp_AcknowledgeAlert(VARCHAR, VARCHAR)', 'EXECUTE')
       AND has_function_privilege('medbase_head_nurse', 'sp_SetNurseStatus(VARCHAR, VARCHAR)', 'EXECUTE') $q$);

CALL pg_temp.expect_error('head nurse cannot change alerts through the report',
    $q$ UPDATE "vw_AlertResponse" SET "Status" = 'PENDING' WHERE "AlertID" = 'ALT-1002' $q$,
    'cannot update view "vw_AlertResponse"%', 'medbase_head_nurse');

CALL pg_temp.expect_error('head nurse cannot change the journal',
    $q$ DELETE FROM "AlertEvent" WHERE "AlertID" = 'ALT-1002' $q$, 'permission denied%', 'medbase_head_nurse');

CALL pg_temp.expect_error('head nurse cannot read PIN hashes',
    $q$ SELECT "PinHash" FROM "Nurse" $q$, 'permission denied%', 'medbase_head_nurse');

CALL pg_temp.expect_ok('nurse can read nurse names and statuses',
    $q$ SELECT "NurseID", "FullName", "Role", "Status" FROM "Nurse" $q$, 'medbase_nurse');

CALL pg_temp.expect_error('nurse cannot read PIN hashes',
    $q$ SELECT "PinHash" FROM "Nurse" $q$, 'permission denied%', 'medbase_nurse');

CALL pg_temp.expect_error('nurse cannot read patient phone numbers',
    $q$ SELECT "Phone" FROM "Patient" $q$, 'permission denied%', 'medbase_nurse');

CALL pg_temp.expect_ok('nurse can acknowledge alerts',
    $q$ CALL sp_AcknowledgeAlert('ALT-1005', 'NURSE-02') $q$, 'medbase_nurse');

CALL pg_temp.expect_ok('nurse can change own status',
    $q$ CALL sp_SetNurseStatus('NURSE-02', 'Busy') $q$, 'medbase_nurse');

CALL pg_temp.expect_error('nurse cannot change alerts directly',
    $q$ UPDATE "WardAlert" SET "Status" = 'PENDING' WHERE "AlertID" = 'ALT-1005' $q$,
    'permission denied%', 'medbase_nurse');

CALL pg_temp.expect_error('nurse cannot write to the journal',
    $q$ INSERT INTO "AlertEvent" ("AlertID", "EventType", "OccurredAt") VALUES ('ALT-1005', 'CREATED', now()) $q$,
    'permission denied%', 'medbase_nurse');

CALL pg_temp.expect_error('nurse cannot raise alerts',
    $q$ CALL sp_RaiseAlert(101, 1, 'MONITOR', 'HIGH', NULL, 'NURSE-01', NULL) $q$,
    'permission denied%', 'medbase_nurse');

CALL pg_temp.expect_error('nurse cannot admit patients',
    $q$ CALL sp_AdmitPatient(6, 104) $q$, 'permission denied%', 'medbase_nurse');

CALL pg_temp.expect_ok('alert service can raise alerts',
    $q$ CALL sp_RaiseAlert(101, 1, 'MONITOR', 'HIGH', 'Role test', 'NURSE-01', NULL) $q$,
    'medbase_alert_service');

CALL pg_temp.expect_ok('make unassigned ALT-1008 1 minute old', $q$
    UPDATE "WardAlert" SET "CreatedAt" = CURRENT_TIMESTAMP - INTERVAL '1 minute'
    WHERE "AlertID" = 'ALT-1008' $q$);

CALL pg_temp.expect_ok('alert service can escalate overdue alerts',
    $q$ CALL sp_EscalateAlert('ALT-1008', 'NURSE-04') $q$, 'medbase_alert_service');

CALL pg_temp.expect_error('alert service cannot acknowledge alerts',
    $q$ CALL sp_AcknowledgeAlert('ALT-1008', 'NURSE-04') $q$, 'permission denied%', 'medbase_alert_service');

CALL pg_temp.expect_error('alert service cannot read PIN hashes',
    $q$ SELECT "PinHash" FROM "Nurse" $q$, 'permission denied%', 'medbase_alert_service');

CALL pg_temp.expect_ok('alert service can read patient names (device simulator)',
    $q$ SELECT "PatientID", "FullName" FROM "Patient" $q$, 'medbase_alert_service');

CALL pg_temp.expect_error('alert service cannot read patient phone numbers',
    $q$ SELECT "Phone" FROM "Patient" $q$, 'permission denied%', 'medbase_alert_service');

CALL pg_temp.expect_error('alert service cannot change alerts directly',
    $q$ DELETE FROM "WardAlert" WHERE "AlertID" = 'ALT-1008' $q$,
    'permission denied%', 'medbase_alert_service');

-- -----------------------------------------------------------------------------
-- 11. Staff login (fn_AuthenticateStaff) and the backend role medbase_api
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_true('seed: 3 staff accounts, 1 inactive', $q$
    SELECT COUNT(*) = 3 AND COUNT(*) FILTER (WHERE NOT "IsActive") = 1 FROM "StaffAccount" $q$);

CALL pg_temp.expect_error('StaffAccount.Role only Admissions/PublicStaff', $q$
    UPDATE "StaffAccount" SET "Role" = 'Nurse' WHERE "AccountID" = 'ADM-01' $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('StaffAccount.PinHash rejects a plain-text PIN', $q$
    UPDATE "StaffAccount" SET "PinHash" = '2001' WHERE "AccountID" = 'ADM-01' $q$,
    '%violates check constraint "CK_StaffAccount_PinIsBcrypt"%');

CALL pg_temp.expect_error('a nurse badge cannot be given to a staff account', $q$
    INSERT INTO "StaffAccount" ("AccountID", "FullName", "BadgeID", "PinHash", "Role")
    VALUES ('ADM-99', 'Dup Badge', 'BADGE-1001', crypt('9999', gen_salt('bf')), 'Admissions') $q$,
    'Badge BADGE-1001 is already assigned to another person%');

CALL pg_temp.expect_error('a staff badge cannot be given to a nurse', $q$
    UPDATE "Nurse" SET "BadgeID" = 'BADGE-2001' WHERE "NurseID" = 'NURSE-01' $q$,
    'Badge BADGE-2001 is already assigned to another person%');

CALL pg_temp.expect_true('login: nurse with correct PIN', $q$
    SELECT array_agg(ROW("AccountID", "Role")::TEXT) = ARRAY['(NURSE-01,Nurse)']
    FROM fn_AuthenticateStaff('BADGE-1001', '1111') $q$);

CALL pg_temp.expect_true('login: head nurse with correct PIN', $q$
    SELECT array_agg(ROW("AccountID", "Role")::TEXT) = ARRAY['(NURSE-10,HeadNurse)']
    FROM fn_AuthenticateStaff('BADGE-1010', '1010') $q$);

CALL pg_temp.expect_true('login: admissions staff with correct PIN', $q$
    SELECT array_agg(ROW("AccountID", "Role")::TEXT) = ARRAY['(ADM-01,Admissions)']
    FROM fn_AuthenticateStaff('BADGE-2001', '2001') $q$);

CALL pg_temp.expect_true('login: wrong PIN, unknown badge and inactive account return nothing', $q$
    SELECT NOT EXISTS (SELECT 1 FROM fn_AuthenticateStaff('BADGE-1001', '0000'))
       AND NOT EXISTS (SELECT 1 FROM fn_AuthenticateStaff('BADGE-9999', '1111'))
       AND NOT EXISTS (SELECT 1 FROM fn_AuthenticateStaff('BADGE-2002', '2002')) $q$);

CALL pg_temp.expect_error('login function is not available to user roles',
    $q$ SELECT * FROM fn_AuthenticateStaff('BADGE-1001', '1111') $q$,
    'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_ok('backend role can run the login function',
    $q$ SELECT * FROM fn_AuthenticateStaff('BADGE-1001', '1111') $q$, 'medbase_api');

CALL pg_temp.expect_error('backend role on its own cannot read patients',
    $q$ SELECT * FROM "Patient" $q$, 'permission denied%', 'medbase_api');

CALL pg_temp.expect_error('backend role cannot read PIN hashes of staff accounts',
    $q$ SELECT "PinHash" FROM "StaffAccount" $q$, 'permission denied%', 'medbase_api');

CALL pg_temp.expect_true('backend role can switch to every user role but inherits none of them', $q$
    SELECT bool_and(pg_has_role('medbase_api', r, 'SET') AND NOT pg_has_role('medbase_api', r, 'USAGE'))
    FROM unnest(ARRAY['medbase_admissions', 'medbase_public_staff', 'medbase_nurse', 'medbase_head_nurse',
                  'medbase_alert_service']) r $q$);

-- -----------------------------------------------------------------------------
DO $$ BEGIN RAISE INFO 'ALL TESTS PASSED'; END $$;
ROLLBACK;
